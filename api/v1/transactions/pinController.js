const prisma = require('@/lib/prisma');
const pinProvider = require('@/services/pinProvider');
const { TransactionStatus, TransactionType } = require('@prisma/client');

/**
 * Handles the purchase and generation of Recharge Card PINs
 * Updates totalSpent for accountability.
 */
const printPins = async (req, res) => {
    const { network, value, quantity } = req.body;
    const userId = req.user.id;

    if (!network || !value || !quantity) {
        return res.status(400).json({ status: "ERROR", message: "Network, value, and quantity are required" });
    }

    const qty = parseInt(quantity);
    const faceValue = parseInt(value);
    const totalCost = faceValue * qty;

    try {
        const result = await prisma.$transaction(async (tx) => {
            const wallet = await tx.wallet.findUnique({ where: { userId } });
            
            if (!wallet || Number(wallet.balance) < totalCost) {
                throw new Error("Insufficient wallet balance");
            }

            const requestId = `PRT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

            const transaction = await tx.transaction.create({
                data: {
                    userId,
                    amount: totalCost,
                    type: TransactionType.RECHARGE_PIN,
                    status: TransactionStatus.PENDING,
                    reference: requestId,
                    metadata: { network, quantity: qty, faceValue }
                }
            });

            // Update Wallet: Deduct Balance AND Increment TotalSpent
            await tx.wallet.update({
                where: { userId },
                data: { 
                    balance: { decrement: totalCost },
                    totalSpent: { increment: totalCost } 
                }
            });

            return { transaction, requestId };
        });

        try {
            const providerResponse = await pinProvider.buyEpin(network, value, qty, result.requestId);

            const pinRecords = providerResponse.pins.map(p => ({
                transactionId: result.transaction.id,
                network: network.toUpperCase() === '9MOBILE' ? 'NINE_MOBILE' : network.toUpperCase(),
                denomination: parseInt(p.amount),
                pinCode: p.pin,
                serialNumber: p.sno,
                batchNumber: p.batchno,
                isSold: true,
                soldAt: new Date()
            }));

            await tx.rechargePin.createMany({ data: pinRecords });

            await prisma.transaction.update({
                where: { id: result.transaction.id },
                data: { status: TransactionStatus.SUCCESS }
            });

            return res.status(200).json({ status: "OK", message: "PINs generated successfully" });

        } catch (apiError) {
            // AUTO-REFUND
            await prisma.$transaction([
                prisma.transaction.update({
                    where: { id: result.transaction.id },
                    data: { status: TransactionStatus.FAILED }
                }),
                prisma.wallet.update({
                    where: { userId },
                    data: { 
                        balance: { increment: totalCost },
                        totalSpent: { decrement: totalCost } 
                    }
                })
            ]);

            return res.status(502).json({ status: "ERROR", message: "Provider failed. Wallet refunded." });
        }

    } catch (error) {
        return res.status(error.message === "Insufficient wallet balance" ? 402 : 500).json({
            status: "ERROR",
            message: error.message || "Internal server error"
        });
    }
};

module.exports = { printPins, getTransactionPins: async (req, res) => { /* Logic remains same */ } };