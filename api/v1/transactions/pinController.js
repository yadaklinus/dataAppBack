const prisma = require('@/lib/prisma');
const pinProvider = require('@/services/pinProvider');
const { TransactionStatus, TransactionType } = require('@prisma/client');

/**
 * Handles the purchase and generation of Recharge Card PINs (E-PINs)
 * Integrated with Decoupled Wallet Table (No profit markup)
 */
const printPins = async (req, res) => {
    const { network, value, quantity } = req.body;
    const userId = req.user.id;

    // 1. Validation
    if (!network || !value || !quantity) {
        return res.status(400).json({ status: "ERROR", message: "Network, value, and quantity are required" });
    }

    const qty = parseInt(quantity);
    if (qty < 1 || qty > 100) {
        return res.status(400).json({ status: "ERROR", message: "Quantity must be between 1 and 100" });
    }

    try {
        // 2. Calculate Pricing (Direct Face Value)
        const faceValue = parseInt(value);
        const totalCost = faceValue * qty;

        // 3. Atomic Wallet & Transaction Initialization
        const result = await prisma.$transaction(async (tx) => {
            // Check Wallet Balance specifically from the Wallet table
            const wallet = await tx.wallet.findUnique({ where: { userId } });
            
            if (!wallet || Number(wallet.balance) < totalCost) {
                throw new Error("Insufficient wallet balance");
            }

            const requestId = `PRT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

            // Create the parent transaction
            const transaction = await tx.transaction.create({
                data: {
                    userId,
                    amount: totalCost,
                    type: TransactionType.RECHARGE_PIN,
                    status: TransactionStatus.PENDING,
                    reference: requestId,
                    metadata: {
                        network,
                        quantity: qty,
                        faceValue: faceValue,
                        totalFaceValue: totalCost,
                        margin: 0
                    }
                }
            });

            // Deduct funds from the Wallet table
            await tx.wallet.update({
                where: { userId },
                data: { balance: { decrement: totalCost } }
            });

            return { transaction, requestId };
        });

        // 4. Call External Provider (Nellobyte)
        try {
            const providerResponse = await pinProvider.buyEpin(
                network,
                value,
                qty,
                result.requestId
            );

            // 5. Batch Save PINs to RechargePin table
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

            await prisma.rechargePin.createMany({
                data: pinRecords
            });

            // 6. Finalize Transaction Status
            await prisma.transaction.update({
                where: { id: result.transaction.id },
                data: { status: TransactionStatus.SUCCESS }
            });

            return res.status(200).json({
                status: "OK",
                message: `${qty} PIN(s) generated successfully`,
                reference: result.requestId,
                pins: pinRecords 
            });

        } catch (apiError) {
            // 7. AUTO-REFUND: Update Wallet Table on Failure
            await prisma.$transaction([
                prisma.transaction.update({
                    where: { id: result.transaction.id },
                    data: { status: TransactionStatus.FAILED }
                }),
                prisma.wallet.update({
                    where: { userId },
                    data: { balance: { increment: totalCost } }
                })
            ]);

            return res.status(502).json({
                status: "ERROR",
                message: apiError.message || "Provider failed to generate PINs. Wallet refunded."
            });
        }

    } catch (error) {
        console.error("Printing Error:", error.message);
        return res.status(error.message === "Insufficient wallet balance" ? 402 : 500).json({
            status: "ERROR",
            message: error.message || "Internal server error"
        });
    }
};

/**
 * Fetches the PINs for a specific transaction
 */
const getTransactionPins = async (req, res) => {
    const { reference } = req.params;
    const userId = req.user.id;

    try {
        const transaction = await prisma.transaction.findUnique({
            where: { reference },
            include: { printedPins: true }
        });

        if (!transaction || transaction.userId !== userId) {
            return res.status(404).json({ status: "ERROR", message: "Transaction not found" });
        }

        return res.status(200).json({
            status: "OK",
            data: {
                details: transaction,
                pins: transaction.printedPins
            }
        });
    } catch (error) {
        return res.status(500).json({ status: "ERROR", message: "Error retrieving PINs" });
    }
};

module.exports = {
    printPins,
    getTransactionPins
};