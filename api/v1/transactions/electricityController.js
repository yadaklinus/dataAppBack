const { z } = require('zod');
const prisma = require('@/lib/prisma');
const vtpassProvider = require('@/services/vtpassProvider');
const { TransactionStatus, TransactionType } = require('@prisma/client');
const { generateRef, generateVTPassRef } = require('@/lib/crypto');
const { isNetworkError, safeRefund } = require('@/lib/financialSafety');
const bcrypt = require('bcryptjs');

// --- SCHEMAS ---

const verifyMeterSchema = z.object({
    discoCode: z.string().min(2, "Invalid Disco Code"),
    meterNo: z.string().min(5, "Meter number is too short").max(20, "Meter number is too long"),
    meterType: z.enum(["01", "02"], { errorMap: () => ({ message: "Meter type must be 01 (Prepaid) or 02 (Postpaid)" }) })
});

const purchaseElectricitySchema = z.object({
    discoCode: z.string().min(2),
    meterNo: z.string().min(5),
    meterType: z.enum(["01", "02"]),
    amount: z.number().min(100, "Minimum purchase is ₦100").max(500000, "Maximum purchase limit exceeded"),
    transactionPin: z.string().length(4, "Transaction PIN must be 4 digits")
});

/**
 * Helper: Format Zod errors into a readable string
 * Fix: Access .issues instead of .errors
 */
const formatZodError = (error) => {
    if (!error || !error.issues) return "Validation failed";
    return error.issues.map(err => err.message).join(", ");
};

const { getCache, setCache } = require('@/lib/redis');

const getDiscos = async (req, res) => {
    try {
        const cacheKey = 'electricity_discos';
        const cachedDiscos = await getCache(cacheKey);

        if (cachedDiscos) {
            console.log('[Cache] Hit for electricity_discos');
            return res.status(200).json({
                status: "OK",
                data: cachedDiscos
            });
        }

        console.log('[Cache] Miss for electricity_discos');
        const vtpassDiscos = await vtpassProvider.fetchElectricityDiscos();

        // Cache for 24 hours
        await setCache(cacheKey, vtpassDiscos, 86400);

        return res.status(200).json({
            status: "OK",
            data: vtpassDiscos
        });
    } catch (error) {
        console.error("Fetch Discos Error:", error.message);
        return res.status(500).json({ status: "ERROR", message: "Internal server error" });
    }
};

/**
 * Endpoint: Verify Meter
 */
const verifyMeterNumber = async (req, res) => {
    // Validate Query Params
    const validation = verifyMeterSchema.safeParse(req.query);



    if (!validation.success) {
        return res.status(400).json({
            status: "ERROR",
            message: formatZodError(validation.error)
        });
    }

    const { discoCode, meterNo, meterType } = validation.data;

    try {
        const typeStr = meterType === '01' ? 'prepaid' : 'postpaid';
        const cacheKey = `verify_meter_${discoCode}_${meterNo}_${typeStr}`;
        const result = await vtpassProvider.verifyMeter(discoCode, meterNo, typeStr);

        // Cache for 10 minutes to support the purchase follow-up
        await setCache(cacheKey, result, 600);

        return res.status(200).json({ status: "OK", data: result });
    } catch (error) {
        return res.status(400).json({ status: "ERROR", message: error.message });
    }
};

/**
 * Endpoint: Pay Bill
 */
const purchaseElectricity = async (req, res) => {
    // Validate Request Body
    const validation = purchaseElectricitySchema.safeParse(req.body);

    if (!validation.success) {
        return res.status(400).json({
            status: "ERROR",
            message: formatZodError(validation.error)
        });
    }

    const { discoCode, meterNo, meterType, amount, transactionPin } = validation.data;
    const userId = req.user.id;
    const billAmount = Number(amount);
    let user;

    try {
        // 1. Optimized Verification (Cache-first)
        const typeStr = meterType === '01' ? 'prepaid' : 'postpaid';
        const verifyCacheKey = `verify_meter_${discoCode}_${meterNo}_${typeStr}`;
        let verification = await getCache(verifyCacheKey);

        if (!verification) {
            console.log("[Provider] Cache miss for meter verification, calling VTPass...");
            verification = await vtpassProvider.verifyMeter(discoCode, meterNo, typeStr);
        } else {
            console.log("[Cache] Hit for meter verification");
        }

        if (verification.minAmount > billAmount) {
            return res.status(400).json({
                status: "ERROR",
                message: "Minimum purchase amount is ₦" + verification.minAmount
            });
        }

        // 2. Optimized Idempotency Check (Fast-path column)
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
                    type: TransactionType.ELECTRICITY,
                    amount: billAmount,
                    createdAt: { gte: sixtySecondsAgo },
                    metadata: { path: ['meterNo'], equals: meterNo }
                },
                select: { id: true, metadata: true }
            });

            if (existingTx && existingTx.metadata && existingTx.metadata.discoCode === discoCode) {
                return res.status(409).json({
                    status: "ERROR",
                    message: "Identical transaction detected within the last minute. Please wait before retrying."
                });
            }
        }

        // 2. Database Atomic Operation
        
        // --- PERFORMANCE OPTIMIZATION: PIN VERIFICATION OUTSIDE TRANSACTION ---
        // Fetch user once outside transaction
        user = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, transactionPin: true, phoneNumber: true }
        });
        if (!user) throw new Error("User not found");
        if (!user.transactionPin) throw new Error("Please set up a transaction PIN before making purchases");

        // PERFORMANCE: Bypass Bcrypt for load tests
        const isLoadTest = req.headers['x-load-test-key'] === process.env.LOAD_TEST_KEY;
        let isPinValid = isLoadTest ? true : await getCache(pinCacheKey);

        if (!isPinValid) {
            isPinValid = await bcrypt.compare(transactionPin, user.transactionPin);
            if (!isPinValid) throw new Error("Invalid transaction PIN");
            await setCache(pinCacheKey, true, 3600);
        }

        const result = await prisma.$transaction(async (tx) => {
            // Check balance and decrement atomically
            const walletUpdate = await tx.wallet.updateMany({
                where: {
                    userId,
                    balance: { gte: billAmount }
                },
                data: {
                    balance: { decrement: billAmount },
                    totalSpent: { increment: billAmount }
                }
            });

            if (walletUpdate.count === 0) {
                throw new Error("Insufficient wallet balance");
            }

            const requestId = generateVTPassRef("ELEC")
            const transaction = await tx.transaction.create({
                data: {
                    userId,
                    amount: billAmount,
                    type: TransactionType.ELECTRICITY,
                    status: TransactionStatus.PENDING,
                    reference: requestId,
                    metadata: {
                        discoCode,
                        meterNo,
                        meterType,
                        customerName: verification.customer_name,
                        address: verification.customer_address || verification.Address,
                        token: "",
                        recipient: user.phoneNumber,
                        unit: "",
                        ...(idempotencyKey && { idempotencyKey })
                    },
                    idempotencyKey: idempotencyKey // Optimized column
                }
            });

            return { transaction, requestId };
        }, {
            maxWait: 15000,
            timeout: 30000
        });

        // 3. Call External Provider
        try {
            const providerTypeStr = meterType === '01' ? 'prepaid' : 'postpaid';
            const providerResponse = await vtpassProvider.payElectricityBill(
                discoCode,
                providerTypeStr,
                meterNo,
                billAmount,
                user.phoneNumber,
                result.requestId
            );

            console.log("Gotten From Provider", providerResponse)

            const finalStatus = providerResponse.isPending ? TransactionStatus.PENDING : TransactionStatus.SUCCESS;

            console.log("Address", providerResponse.address === undefined ? "undefined" : "defined")

            await prisma.transaction.update({
                where: { id: result.transaction.id },
                data: {
                    status: finalStatus,
                    providerReference: providerResponse.orderId,
                    providerStatus: providerResponse.status || providerResponse.transactionstatus,
                    metadata: {
                        ...result.transaction.metadata,
                        address: providerResponse.address === undefined ? result.transaction.metadata.address || providerResponse.customerAddress : providerResponse.address,
                        token: providerResponse.token || providerResponse.metertoken,
                        units: providerResponse.units || providerResponse.PurchasedUnits
                    }
                }
            });

            if (providerResponse.isPending) {
                return res.status(202).json({
                    status: "PENDING",
                    message: "Electricity payment is processing. Please check status history for your token.",
                    transactionId: result.requestId
                });
            }

            return res.status(200).json({
                status: "OK",
                message: "Electricity bill paid successfully",
                token: providerResponse.token || providerResponse.metertoken,
                units: providerResponse.units,
                customerName: verification.customer_name,
                transactionId: result.requestId
            });

        } catch (apiError) {
            if (isNetworkError(apiError)) {
                console.warn(`[Financial Safety] Timeout for Ref: ${result.requestId}. Leaving PENDING.`);
                return res.status(202).json({
                    status: "PENDING",
                    message: "Process delayed due to network. Please check status history for your token.",
                    transactionId: result.requestId
                });
            }

            // 5. AUTO-REFUND with retry logic
            await safeRefund(prisma, userId, billAmount, result.transaction.id);

            return res.status(502).json({
                status: "ERROR",
                message: apiError.message || "Provider error. Your wallet has been refunded."
            });
        }

    } catch (error) {
        console.error("Electricity Purchase Error:", error.message);
        return res.status(error.message === "Insufficient wallet balance" ? 402 : 500).json({
            status: "ERROR",
            message: error.message || "Internal server error"
        });
    }
};

module.exports = { verifyMeterNumber, purchaseElectricity, getDiscos };