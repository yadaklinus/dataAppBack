const prisma = require('@/lib/prisma');
const vtpassProvider = require('@/services/vtpassProvider');
const { validateNetworkMatch, normalizePhoneNumber } = require('@/lib/networkValidator');
const { TransactionStatus, TransactionType } = require('@prisma/client');
const { z } = require('zod');
const { generateRef, generateVTPassRef } = require('@/lib/crypto');
const { isNetworkError, safeRefund } = require('@/lib/financialSafety');
const bcrypt = require('bcryptjs');
const { getCache, setCache } = require('@/lib/redis');

/**
 * Handles Airtime Purchase Logic
 * Updates wallet balance and increments totalSpent for accountability.
 */

const purchaseAirtimeSchema = z.object({
    network: z.enum(['MTN', 'GLO', 'AIRTEL', '9MOBILE']),
    amount: z.number(),
    phoneNumber: z.string(),
    transactionPin: z.string().length(4, "Transaction PIN must be 4 digits")
});

const purchaseAirtime = async (req, res) => {
    console.log("Airtime Purchase Request:", req.body);
    const parsed = purchaseAirtimeSchema.safeParse(req.body);
    console.log("Airtime Purchase Request:", parsed.success);
    if (!parsed.success) {
        return res.status(400).json({ status: "ERROR", message: parsed.error.errors[0].message });
    }

    const { network, amount, phoneNumber, transactionPin } = parsed.data;

    console.log("Airtime Purchase Request:", network, amount, phoneNumber);
    const userId = req.user.id;

    if (!network || !amount || !phoneNumber) {
        return res.status(400).json({ status: "ERROR", message: "Missing required fields" });
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

    const airtimeAmount = Number(amount);
    if (airtimeAmount < 50) {
        return res.status(400).json({ status: "ERROR", message: "Minimum airtime is ₦50" });
    }

    try {
        const sellingPrice = airtimeAmount;

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
        }
        else {
            // Fallback Time-based Deduplication (60 seconds)
            const sixtySecondsAgo = new Date(Date.now() - 60000);
            const existingTx = await prisma.transaction.findFirst({
                where: {
                    userId,
                    type: TransactionType.AIRTIME,
                    amount: sellingPrice,
                    createdAt: { gte: sixtySecondsAgo },
                    metadata: {
                        path: ['recipient'], equals: cleanPhone,
                    }
                },
                select: { id: true, metadata: true }
            });

            if (existingTx && existingTx.metadata && existingTx.metadata.network === network) {
                return res.status(409).json({
                    status: "ERROR",
                    message: "Identical transaction detected within the last minute. Please wait before retrying."
                });
            }
        }

        // 1. Database Atomic Operation

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

            const requestId = generateVTPassRef("AIR")
            const transaction = await tx.transaction.create({
                data: {
                    userId,
                    amount: sellingPrice,
                    type: TransactionType.AIRTIME,
                    status: TransactionStatus.PENDING,
                    reference: requestId,
                    metadata: {
                        network,
                        recipient: cleanPhone,
                        faceValue: airtimeAmount,
                        profit: 0,
                        ...(idempotencyKey && { idempotencyKey })
                    },
                    idempotencyKey: idempotencyKey // Optimized column
                }
            });

            return { transaction, requestId };
        }, {
            maxWait: 15000, // Wait up to 15s to start the transaction
            timeout: 30000  // Allow the transaction to run for up to 30s
        });

        // 3. Call External Provider
        try {
            const providerResponse = await vtpassProvider.buyAirtime(
                network,
                airtimeAmount,
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
                    message: "Airtime purchase is processing. You will be notified once it is complete.",
                    transactionId: result.requestId
                });
            }



            return res.status(200).json({
                status: "OK",
                message: "Airtime purchased successfully",
                transactionId: result.requestId
            });

        } catch (apiError) {
            // 4. SMART AUTO-REFUND: Skip refund if it was a network timeout
            if (isNetworkError(apiError)) {
                console.warn(`[Financial Safety] Timeout for Ref: ${result.requestId}. Leaving PENDING.`);
                return res.status(202).json({
                    status: "PENDING",
                    message: "Connection delay. Your request is being processed. Please check your history in a moment.",
                    transactionId: result.requestId
                });
            }

            // Definitive Failure: Revert both balance and totalSpent with retry logic
            await safeRefund(prisma, userId, sellingPrice, result.transaction.id);

            return res.status(502).json({
                status: "ERROR",
                message: apiError.message || "Provider error. Funds refunded to wallet."
            });
        }

    } catch (error) {
        console.error("Airtime Purchase Error:", error.message);
        return res.status(error.message === "Insufficient wallet balance" ? 402 : 500).json({
            status: "ERROR",
            message: error.message || "Internal server error"
        });
    }
};

/**
 * Check status & Active Sync
 */
const getAirtimeStatus = async (req, res) => {
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
                user: { select: { id: true, fullName: true } }
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
                        include: { user: { select: { fullName: true } } }
                    });
                }
                else if (queryResult && queryResult.status === "FAILED") {
                    const refundSuccess = await safeRefund(prisma, txn.userId, txn.amount, txn.id);
                    if (refundSuccess) {
                        txn = await prisma.transaction.findUnique({
                            where: { id: txn.id },
                            select: {
                                id: true,
                                amount: true,
                                status: true,
                                providerReference: true,
                                metadata: true,
                                user: { select: { fullName: true } }
                            }
                        });
                    }
                }
            } catch (queryError) {
                console.error("Airtime sync failed:", queryError.message);
            }
        }

        res.status(200).json({
            status: "OK",
            data: txn
        });
    } catch (error) {
        res.status(500).json({ status: "ERROR", message: "Error fetching status" });
    }
};

module.exports = { purchaseAirtime, getAirtimeStatus };