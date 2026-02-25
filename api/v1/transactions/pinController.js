const prisma = require('@/lib/prisma');
const pinProvider = require('@/services/pinProvider');
const { TransactionStatus, TransactionType } = require('@prisma/client');
const { z } = require('zod');
const { generateRef } = require('@/lib/crypto')
const { isNetworkError } = require('@/lib/financialSafety');

/**
 * Handles the purchase and generation of Recharge Card PINs
 * Updates totalSpent for accountability.
 */

const purchasePinSchema = z.object({
    network: z.enum(['MTN', 'GLO', 'AIRTEL', '9MOBILE']),
    value: z.enum(['100', '200', '500']),
    quantity: z.number().min(1).max(100),
});
const printPins = async (req, res) => {
    const parsed = purchasePinSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ status: "ERROR", message: parsed.error.errors[0].message });
    }

    const { network, value, quantity } = parsed.data;
    const userId = req.user.id;

    if (!network || !value || !quantity) {
        return res.status(400).json({ status: "ERROR", message: "Network, value, and quantity are required" });
    }

    const qty = parseInt(quantity);
    const faceValue = parseInt(value);
    const totalCost = faceValue * qty;

    if (isNaN(qty) || qty < 1 || qty > 100) {
        return res.status(400).json({ status: "ERROR", message: "Quantity must be between 1 and 100" });
    }
    if (![100, 200, 500].includes(faceValue)) {
        return res.status(400).json({ status: "ERROR", message: "Value must be 100, 200, or 500" });
    }


    try {
        const result = await prisma.$transaction(async (tx) => {
            const wallet = await tx.wallet.findUnique({ where: { userId } });

            if (!wallet || Number(wallet.balance) < totalCost) {
                throw new Error("Insufficient wallet balance");
            }

            const requestId = generateRef("PRT")
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

            console.log(providerResponse)

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

            await prisma.rechargePin.createMany({ data: pinRecords });

            await prisma.transaction.update({
                where: { id: result.transaction.id },
                data: { status: TransactionStatus.SUCCESS }
            });

            return res.status(200).json({ status: "OK", message: "PINs generated successfully" });

        } catch (apiError) {
            // SMART AUTO-REFUND
            if (isNetworkError(apiError)) {
                console.warn(`[Financial Safety] Timeout for Ref: ${result.requestId}. Leaving PENDING.`);
                return res.status(202).json({
                    status: "PENDING",
                    message: "Process delayed. Your PINs are being generated. Please check your history in a moment.",
                    transactionId: result.requestId
                });
            }

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


const getPrintingOrders = async (req, res) => {
    try {
        const userId = req.user.id;
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, parseInt(req.query.limit) || 20);
        const skip = (page - 1) * limit;

        const [orders, total] = await prisma.$transaction([
            prisma.transaction.findMany({
                where: {
                    userId,
                    type: 'RECHARGE_PIN'
                },
                include: {
                    printedPins: true // This adds the actual pins to each transaction object
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit
            }),
            prisma.transaction.count({
                where: { userId, type: 'RECHARGE_PIN' }
            })
        ]);

        return res.status(200).json({
            status: "OK",
            data: orders,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error("Fetch Printing Orders Error:", error.message);
        return res.status(500).json({ status: "ERROR", message: "Failed to fetch printing history" });
    }
};



module.exports = { printPins, getTransactionPins, getPrintingOrders };