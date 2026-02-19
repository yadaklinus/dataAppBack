const prisma = require('@/lib/prisma');
const airtimeProvider = require('@/services/airtimeProvider');
const { validateNetworkMatch, normalizePhoneNumber } = require('@/lib/networkValidator');
const { TransactionStatus, TransactionType } = require('@prisma/client');

/**
 * Handles Airtime Purchase Logic
 * Updates wallet balance and increments totalSpent for accountability.
 */
const purchaseAirtime = async (req, res) => {
    const { network, amount, phoneNumber } = req.body;
    const userId = req.user.id; 

    if (!network || !amount || !phoneNumber) {
        return res.status(400).json({ status: "ERROR", message: "Missing required fields" });
    }

     // --- BUILDER ADDITION: PREFIX VALIDATION ---
    const isNetworkMatch = validateNetworkMatch(network, phoneNumber);
    if (!isNetworkMatch) {
        return res.status(400).json({ 
            status: "ERROR", 
            message: `The number ${phoneNumber} does not appear to be a valid ${network} line.` 
        });
    }

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

            const requestId = `AIR-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
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
            const providerResponse = await airtimeProvider.buyAirtime(
                network,
                airtimeAmount,
                cleanPhone,
                result.requestId
            );

            await prisma.transaction.update({
                where: { id: result.transaction.id },
                data: {
                    status: TransactionStatus.SUCCESS,
                    providerReference: providerResponse.orderId
                }
            });

            return res.status(200).json({
                status: "OK",
                message: "Airtime purchase successful",
                transactionId: result.requestId
            });

        } catch (apiError) {
            // 4. AUTO-REFUND: Revert both balance and totalSpent on failure
            await prisma.$transaction([
                prisma.transaction.update({
                    where: { id: result.transaction.id },
                    data: { status: TransactionStatus.FAILED }
                }),
                prisma.wallet.update({
                    where: { userId },
                    data: { 
                        balance: { increment: sellingPrice },
                        totalSpent: { decrement: sellingPrice } // Revert accountability field
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
        
        if (!txn) return res.status(404).json({ status: "ERROR", message: "Transaction not found" });

        if (txn.status === TransactionStatus.PENDING && txn.providerReference) {
            try {
                const providerStatus = await airtimeProvider.queryTransaction(txn.providerReference);
                
                if (providerStatus.statuscode === "200") {
                    txn = await prisma.transaction.update({
                        where: { id: txn.id },
                        data: { status: TransactionStatus.SUCCESS },
                        include: { user: { select: { fullName: true } } }
                    });
                } 
                else if (["ORDER_CANCELLED", "ORDER_FAILED"].includes(providerStatus.status)) {
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