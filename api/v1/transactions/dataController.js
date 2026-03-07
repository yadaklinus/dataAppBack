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
/**
 * Fetch available plans (Selling Price only)
 * If provider=VTPASS is passed in query, fetch from VTPass
 */
const getAvailablePlans = async (req, res) => {
    try {
        const plans = await vtpassProvider.fetchAllDataPlansMapped();
        return res.status(200).json(plans);
    } catch (error) {
        return res.status(500).json({ status: "ERROR", message: error.message });
    }
};

/**
 * Handle Data Bundle Purchase
 * Added: Phone number prefix validation to prevent cross-network errors.
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

    // --- BUILDER ADDITION: PREFIX VALIDATION ---
    const isNetworkMatch = validateNetworkMatch(network, phoneNumber);
    // if (!isNetworkMatch) {
    //     return res.status(400).json({
    //         status: "ERROR",
    //         message: `The number ${phoneNumber} does not appear to be a valid ${network} line.`
    //     });
    // }

    const cleanPhone = normalizePhoneNumber(phoneNumber);

    try {
        let selectedPlan = null;
        let sellingPrice = 0;
        let planName = '';

        const allPlans = await vtpassProvider.fetchDataPlans(network);
        selectedPlan = allPlans.find(p => String(p.variation_code) === String(planId));
        if (!selectedPlan) {
            return res.status(404).json({ status: "ERROR", message: "Invalid data plan selected" });
        }
        sellingPrice = selectedPlan.SELLING_PRICE;
        planName = selectedPlan.name;

        // --- IDEMPOTENCY CHECK ---
        const idempotencyKey = req.headers['x-idempotency-key'];

        if (idempotencyKey) {
            // Explicit Idempotency
            const existingTx = await prisma.transaction.findFirst({
                where: {
                    userId,
                    type: TransactionType.DATA,
                    metadata: { path: ['idempotencyKey'], equals: idempotencyKey }
                }
            });
            if (existingTx) {
                return res.status(409).json({
                    status: "ERROR",
                    message: "A transaction with this idempotency key has already been processed."
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
                }
            });

            if (existingTx && existingTx.metadata && existingTx.metadata.network === network && existingTx.metadata.planId === planId) {
                return res.status(409).json({
                    status: "ERROR",
                    message: "Identical transaction detected within the last minute. Please wait before retrying."
                });
            }
        }

        const result = await prisma.$transaction(async (tx) => {
            // Verify Transaction PIN
            const user = await tx.user.findUnique({ where: { id: userId } });
            if (!user) throw new Error("User not found");
            if (!user.transactionPin) throw new Error("Please set up a transaction PIN before making purchases");

            const isPinValid = await bcrypt.compare(transactionPin, user.transactionPin);
            if (!isPinValid) throw new Error("Invalid transaction PIN");

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
                        ...(idempotencyKey && { idempotencyKey })
                    }
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
                    message: "Data purchase is processing. Please check status history in a moment.",
                    transactionId: result.requestId
                });
            }

            return res.status(200).json({
                status: "OK",
                message: `Successfully sent ${planName} to ${cleanPhone}`,
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
            include: { user: { select: { id: true, fullName: true, email: true } } }
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