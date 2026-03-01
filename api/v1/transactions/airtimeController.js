const prisma = require('@/lib/prisma');
const vtpassProvider = require('@/services/vtpassProvider');
const { validateNetworkMatch, normalizePhoneNumber } = require('@/lib/networkValidator');
const { TransactionStatus, TransactionType } = require('@prisma/client');
const { z } = require('zod');
const { generateRef } = require('@/lib/crypto');
const { isNetworkError } = require('@/lib/financialSafety');

/**
 * Handles Airtime Purchase Logic
 * Updates wallet balance and increments totalSpent for accountability.
 */

const purchaseAirtimeSchema = z.object({
    network: z.enum(['MTN', 'GLO', 'AIRTEL', '9MOBILE']),
    amount: z.number(),
    phoneNumber: z.string()
});

const purchaseAirtime = async (req, res) => {
    console.log("Airtime Purchase Request:", req.body);
    const parsed = purchaseAirtimeSchema.safeParse(req.body);
    console.log("Airtime Purchase Request:", parsed.success);
    if (!parsed.success) {
        return res.status(400).json({ status: "ERROR", message: parsed.error.errors[0].message });
    }

    const { network, amount, phoneNumber } = parsed.data;

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

        // 1. Database Atomic Operation
        const result = await prisma.$transaction(async (tx) => {
            const wallet = await tx.wallet.findUnique({ where: { userId } });

            if (!wallet || Number(wallet.balance) < sellingPrice) {
                throw new Error("Insufficient wallet balance");
            }

            const requestId = generateRef("AIR")
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
                        profit: 0
                    }
                }
            });

            // 2. Update Wallet: Deduct Balance AND Increment TotalSpent
            await tx.wallet.update({
                where: { userId },
                data: {
                    balance: { decrement: sellingPrice },
                    totalSpent: { increment: sellingPrice } // Increment accountability field
                }
            });

            return { transaction, requestId };
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
                    message: "Airtime purchase is processing. Please check status history in a moment.",
                    transactionId: result.requestId
                });
            }

            // 🟢 Emit WebSocket Event for Real-time Update
            const { getIO } = require('@/lib/socket');
            try {
                getIO().to(userId).emit('transaction_update', {
                    status: 'SUCCESS',
                    type: 'AIRTIME',
                    amount: airtimeAmount,
                    reference: result.requestId
                });
            } catch (socketErr) {
                console.error("[Socket Error]", socketErr.message);
            }

            return res.status(200).json({
                status: "OK",
                message: "Airtime purchase successful",
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

            // Definitive Failure: Revert both balance and totalSpent
            await prisma.$transaction([
                prisma.transaction.update({
                    where: { id: result.transaction.id },
                    data: { status: TransactionStatus.FAILED }
                }),
                prisma.wallet.update({
                    where: { userId },
                    data: {
                        balance: { increment: sellingPrice },
                        totalSpent: { decrement: sellingPrice }
                    }
                })
            ]);

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
            include: { user: { select: { id: true, fullName: true } } }
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
                    const updatedData = await prisma.$transaction([
                        prisma.transaction.update({
                            where: { id: txn.id },
                            data: { status: TransactionStatus.FAILED }
                        }),
                        prisma.wallet.update({
                            where: { userId: txn.userId },
                            data: {
                                balance: { increment: txn.amount },
                                totalSpent: { decrement: txn.amount } // Revert on sync failure
                            }
                        })
                    ]);
                    txn = { ...updatedData[0], user: txn.user };
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