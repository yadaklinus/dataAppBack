const prisma = require('@/lib/prisma');
const airtimeProvider = require('@/services/airtimeProvider');
const { TransactionStatus, TransactionType } = require('@prisma/client');

/**
 * Handles Airtime Purchase Logic
 * Integrated with Decoupled Wallet Table
 */
const purchaseAirtime = async (req, res) => {
    const { network, amount, phoneNumber } = req.body;
    const userId = req.user.id; 

    // 1. Validation
    if (!network || !amount || !phoneNumber) {
        return res.status(400).json({ status: "ERROR", message: "Missing required fields" });
    }

    const airtimeAmount = Number(amount);
    if (airtimeAmount < 50) {
        return res.status(400).json({ status: "ERROR", message: "Minimum airtime is ₦50" });
    }

    try {
        const sellingPrice = airtimeAmount;

        // 2. Database Atomic Operation
        const result = await prisma.$transaction(async (tx) => {
            // A. Check Wallet Balance specifically from the Wallet table
            const wallet = await tx.wallet.findUnique({ where: { userId } });
            
            if (!wallet || Number(wallet.balance) < sellingPrice) {
                throw new Error("Insufficient wallet balance");
            }

            // B. Create Pending Transaction
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
                        recipient: phoneNumber,
                        faceValue: airtimeAmount,
                        profit: 0
                    }
                }
            });

            // C. Deduct money from the Wallet table
            await tx.wallet.update({
                where: { userId },
                data: { balance: { decrement: sellingPrice } }
            });

            return { transaction, requestId };
        });

        // 3. Call External Provider
        try {
            const providerResponse = await airtimeProvider.buyAirtime(
                network,
                airtimeAmount,
                phoneNumber,
                result.requestId
            );

            // 4. Update Transaction Status
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
            // 5. AUTO-REFUND: Update Wallet Table on Failure
            await prisma.$transaction([
                prisma.transaction.update({
                    where: { id: result.transaction.id },
                    data: { status: TransactionStatus.FAILED }
                }),
                prisma.wallet.update({
                    where: { userId },
                    data: { balance: { increment: sellingPrice } }
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
 * Check status & Active Sync with Wallet Table
 */
const getAirtimeStatus = async (req, res) => {
    const { reference } = req.params;
    try {
        let txn = await prisma.transaction.findUnique({ 
            where: { reference },
            include: { user: { select: { id: true, fullName: true } } }
        });
        
        if (!txn) return res.status(404).json({ status: "ERROR", message: "Transaction not found" });

        // ACTIVE SYNC
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
                    // Sync failure and refund back to Wallet table
                    const updatedData = await prisma.$transaction([
                        prisma.transaction.update({
                            where: { id: txn.id },
                            data: { status: TransactionStatus.FAILED }
                        }),
                        prisma.wallet.update({
                            where: { userId: txn.userId },
                            data: { balance: { increment: txn.amount } }
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