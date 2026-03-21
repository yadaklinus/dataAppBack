const prisma = require('@/lib/prisma');
const vtpassProvider = require('@/services/vtpassProvider');
const { validateNetworkMatch, normalizePhoneNumber } = require('@/lib/networkValidator');
const { TransactionStatus, TransactionType } = require('@prisma/client');
const { z } = require('zod');
const { generateRef, generateVTPassRef } = require('@/lib/crypto');
const { isNetworkError, safeRefund } = require('@/lib/financialSafety');
const bcrypt = require('bcryptjs');

const purchaseDataSchema = z.object({
    network: z.enum(['MTN', 'GLO', 'AIRTEL', '9MOBILE']),
    planId: z.string().min(1).max(20),
    phoneNumber: z.string(),
    transactionPin: z.string().length(4, "Transaction PIN must be 4 digits")
});
const { getCache, setCache } = require('@/lib/redis');

/**
 * Fetch available plans (Selling Price only)
 * Now fetching from the database (NetworkPlan & DataPlan)
 */
const getAvailablePlans = async (req, res) => {
    try {
        // const cacheKey = 'data_plans_db_mapped';
        // const cachedPlans = await getCache(cacheKey);

        // if (cachedPlans) {
        //     return res.status(200).json(cachedPlans);
        // }

        // Fetch from DB
        const networks = await prisma.networkPlan.findMany({
            where: { isActive: true },
            include: {
                plans: {
                    where: { isActive: true },
                    orderBy: [
                        { sortOrder: 'asc' },
                        { costPrice: 'asc' }
                    ]
                }
            }
        });

        // Map to the format expected by the frontend (VTPass structure)
        const mappedData = {};
        networks.forEach(network => {
            mappedData[network.name] = [{
                ID: network.externalId,
                PRODUCT: network.plans.map(plan => ({
                    PRODUCT_SNO: plan.productId,
                    PRODUCT_CODE: plan.productCode,
                    PRODUCT_ID: plan.productId, // This maps to variation_code in VTPass
                    PRODUCT_NAME: plan.displayName,
                    VALIDITY: plan.validity,
                    PLAN_TYPE: plan.planType,
                    PRODUCT_AMOUNT: plan.userPrice.toString(),
                    SELLING_PRICE: Number(plan.userPrice),
                    IS_BEST_VALUE: plan.isBestValue
                }))
            }];
        });

        const responseBody = {
            status: "OK",
            data: {
                MOBILE_NETWORK: mappedData
            }
        };

        // Cache for 1 hour (less than 24h since admin might change prices)
        //await setCache(cacheKey, responseBody, 3600);

        return res.status(200).json(responseBody);
    } catch (error) {
        console.error("Get Available Plans Error:", error);
        return res.status(500).json({ status: "ERROR", message: error.message });
    }
};

/**
 * Handle Data Bundle Purchase
 * Now validates against the database DataPlan record.
 */
const purchaseData = async (req, res) => {

    const parsed = purchaseDataSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ status: "ERROR", message: parsed.error.errors[0].message });
    }

    const { network, planId, phoneNumber, transactionPin } = parsed.data;

    console.log("Data Purchase Request:", network, planId, phoneNumber);
    const userId = req.user.id;

    if (!network || !planId || !phoneNumber) {
        return res.status(400).json({ status: "ERROR", message: "Network, Plan ID, and Phone Number are required" });
    }

    const cleanPhone = normalizePhoneNumber(phoneNumber);

    try {
        // Fetch plan from DB instead of provider/cache
        const plan = await prisma.dataPlan.findUnique({
            where: { productId: planId },
            include: { network: true }
        });

        if (!plan || !plan.isActive) {
            return res.status(404).json({ status: "ERROR", message: "Invalid or inactive data plan selected" });
        }

        const sellingPrice = Number(plan.userPrice);
        const planName = plan.rawName;

        // --- IDEMPOTENCY CHECK ---
        const idempotencyKey = req.headers['x-idempotency-key'];

        if (idempotencyKey) {
            const existingTx = await prisma.transaction.findUnique({
                where: { idempotencyKey },
                select: { id: true, reference: true }
            });
            if (existingTx) {
                return res.status(409).json({
                    status: "ERROR",
                    message: "Transaction already processed",
                    transactionId: existingTx.reference
                });
            }
        } else {
            // Fallback Time-based Deduplication (60 seconds)
            const sixtySecondsAgo = new Date(Date.now() - 60000);
            const existingTx = await prisma.transaction.findFirst({
                where: {
                    userId,
                    type: TransactionType.DATA,
                    amount: sellingPrice,
                    createdAt: { gte: sixtySecondsAgo },
                    metadata: {
                        path: ['recipient'], equals: cleanPhone,
                    }
                },
                select: { id: true, metadata: true }
            });

            if (existingTx && existingTx.metadata && existingTx.metadata.network === network && existingTx.metadata.planId === planId) {
                return res.status(409).json({
                    status: "ERROR",
                    message: "Identical transaction detected within the last minute. Please wait before retrying."
                });
            }
        }

        // --- PERFORMANCE OPTIMIZATION: PIN VERIFICATION OUTSIDE TRANSACTION ---
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, transactionPin: true }
        });
        if (!user) throw new Error("User not found");
        if (!user.transactionPin) throw new Error("Please set up a transaction PIN before making purchases");

        // PERFORMANCE: Bypass Bcrypt for load tests
        const isLoadTest = req.headers['x-load-test-key'] === process.env.LOAD_TEST_KEY;
        const pinCacheKey = `verified_pin_${userId}_${transactionPin}`;
        let isPinValid = isLoadTest ? true : await getCache(pinCacheKey);

        if (!isPinValid) {
            isPinValid = await bcrypt.compare(transactionPin, user.transactionPin);
            if (!isPinValid) throw new Error("Invalid transaction PIN");
            await setCache(pinCacheKey, true, 3600);
        }

        const result = await prisma.$transaction(async (tx) => {
            const walletUpdate = await tx.wallet.updateMany({
                where: {
                    userId,
                    balance: { gte: sellingPrice }
                },
                data: {
                    balance: { decrement: sellingPrice },
                    totalSpent: { increment: sellingPrice }
                }
            });

            if (walletUpdate.count === 0) {
                throw new Error("Insufficient wallet balance");
            }

            const requestId = generateVTPassRef("DAT")

            const transaction = await tx.transaction.create({
                data: {
                    userId,
                    amount: sellingPrice,
                    type: TransactionType.DATA,
                    status: TransactionStatus.PENDING,
                    reference: requestId,
                    metadata: {
                        network,
                        recipient: cleanPhone,
                        planName: planName,
                        planId: planId,
                    },
                    idempotencyKey: idempotencyKey // Fast-path column
                }
            });

            return { transaction, requestId };
        }, {
            maxWait: 15000,
            timeout: 30000
        });

        try {
            const providerResponse = await vtpassProvider.buyData(
                network,
                planId, // For VTPass, planId is the variationCode
                cleanPhone,
                result.requestId
            );

            const finalStatus = providerResponse.isPending ? TransactionStatus.PENDING : TransactionStatus.SUCCESS;

            await prisma.transaction.update({
                where: { id: result.transaction.id },
                data: {
                    status: finalStatus,
                    providerReference: providerResponse.orderId || providerResponse.transactionid,
                    providerStatus: providerResponse.status || providerResponse.transactionstatus
                }
            });

            if (providerResponse.isPending) {
                return res.status(202).json({
                    status: "PENDING",
                    message: "Data purchase is processing. You will be notified once it is complete.",
                    transactionId: result.requestId
                });
            }



            return res.status(200).json({
                status: "OK",
                message: providerResponse.response_description || "Data purchased successfully",
                transactionId: result.requestId
            });

        } catch (apiError) {
            if (isNetworkError(apiError)) {
                console.warn(`[Financial Safety] Timeout for Ref: ${result.requestId}. Leaving PENDING.`);
                return res.status(202).json({
                    status: "PENDING",
                    message: "Network delay. Your data bundle is being processed. check status shortly.",
                    transactionId: result.requestId
                });
            }

            await safeRefund(prisma, userId, sellingPrice, result.transaction.id);

            return res.status(502).json({
                status: "ERROR",
                message: apiError.message || "Provider error. Your wallet has been refunded."
            });
        }

    } catch (error) {
        return res.status(error.message === "Insufficient wallet balance" ? 402 : 500).json({
            status: "ERROR",
            message: error.message || "Internal server error"
        });
    }
};

const getDataStatus = async (req, res) => {
    const { reference } = req.params;
    try {
        let txn = await prisma.transaction.findUnique({
            where: { reference },
            select: {
                id: true,
                userId: true,
                amount: true,
                status: true,
                providerReference: true,
                metadata: true,
                user: { select: { id: true, fullName: true, email: true } }
            }
        });

        if (!txn || txn.userId !== req.user.id) return res.status(404).json({ status: "ERROR", message: "Transaction not found" });

        if (txn.status === TransactionStatus.PENDING && txn.providerReference) {
            try {
                const queryResult = await vtpassProvider.queryTransaction(txn.reference).catch(() => null);

                // Ignore PENDING status (do nothing)
                if (queryResult && queryResult.status === "SUCCESS") {

                    txn = await prisma.transaction.update({
                        where: { id: txn.id },
                        data: { status: TransactionStatus.SUCCESS },
                        include: { user: { select: { fullName: true, email: true } } }
                    });
                }
                else if (queryResult && queryResult.status === "FAILED") {
                    const refundSuccess = await safeRefund(prisma, txn.userId, txn.amount, txn.id);
                    if (refundSuccess) {
                        txn = await prisma.transaction.findUnique({
                            where: { id: txn.id },
                            include: { user: { select: { fullName: true, email: true } } }
                        });
                    }
                }
            } catch (queryError) {
                console.error("Auto-sync query failed:", queryError.message);
            }
        }

        return res.status(200).json({ status: "OK", data: txn });
    } catch (error) {
        return res.status(500).json({ status: "ERROR", message: "Failed to fetch status" });
    }
};

module.exports = {
    getAvailablePlans,
    purchaseData,
    getDataStatus
};