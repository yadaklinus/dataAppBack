const prisma = require('@/lib/prisma');
const dataProvider = require('@/services/dataProvider');
const { TransactionStatus, TransactionType } = require('@prisma/client');

/**
 * Fetch available plans (Selling Price only)
 */
const getAvailablePlans = async (req, res) => {
    try {
        const plans = await dataProvider.fetchAvailablePlans();
        return res.status(200).json({
            status: "OK",
            data: plans
        });
    } catch (error) {
        return res.status(500).json({ status: "ERROR", message: error.message });
    }
};

/**
 * Handle Data Bundle Purchase
 * Integrated with Decoupled Wallet Table
 */
const purchaseData = async (req, res) => {
    const { network, planId, phoneNumber } = req.body;
    const userId = req.user.id;

    if (!network || !planId || !phoneNumber) {
        return res.status(400).json({ status: "ERROR", message: "Network, Plan ID, and Phone Number are required" });
    }

    try {
        // 1. SECURITY CHECK: Re-verify the price from the provider
        const allPlans = await dataProvider.fetchAvailablePlans();
        let selectedPlan = null;

        for (const net in allPlans.MOBILE_NETWORK) {
            allPlans.MOBILE_NETWORK[net].forEach(group => {
                const found = group.PRODUCT.find(p => String(p.PRODUCT_CODE) === String(planId));
                if (found) selectedPlan = found;
            });
        }

        if (!selectedPlan) {
            return res.status(404).json({ status: "ERROR", message: "Invalid data plan selected" });
        }

        const sellingPrice = selectedPlan.SELLING_PRICE;

        // 2. Database Atomic Operation
        const result = await prisma.$transaction(async (tx) => {
            // A. Check Wallet Balance specifically from the Wallet table
            const wallet = await tx.wallet.findUnique({ where: { userId } });
            
            if (!wallet || Number(wallet.balance) < sellingPrice) {
                throw new Error("Insufficient wallet balance");
            }

            const requestId = `DAT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
            
            // B. Create Pending Transaction
            const transaction = await tx.transaction.create({
                data: {
                    userId,
                    amount: sellingPrice,
                    type: TransactionType.DATA,
                    status: TransactionStatus.PENDING,
                    reference: requestId,
                    metadata: {
                        network,
                        recipient: phoneNumber,
                        planName: selectedPlan.PRODUCT_NAME,
                        planId: planId
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

        // 3. Call External Provider API
        try {
            const providerResponse = await dataProvider.buyData(
                network,
                planId,
                phoneNumber,
                result.requestId
            );

            // 4. Update Transaction on Success
            await prisma.transaction.update({
                where: { id: result.transaction.id },
                data: {
                    status: TransactionStatus.SUCCESS,
                    providerReference: providerResponse.orderId
                }
            });

            return res.status(200).json({
                status: "OK",
                message: `Successfully sent ${selectedPlan.PRODUCT_NAME} to ${phoneNumber}`,
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
                message: apiError.message || "Provider error. Your wallet has been refunded."
            });
        }

    } catch (error) {
        console.error("Data Purchase Error:", error.message);
        return res.status(error.message === "Insufficient wallet balance" ? 402 : 500).json({
            status: "ERROR",
            message: error.message || "Internal server error"
        });
    }
};

/**
 * Get Data Transaction Status & Sync with Provider
 */
const getDataStatus = async (req, res) => {
    const { reference } = req.params;
    try {
        let txn = await prisma.transaction.findUnique({
            where: { reference },
            include: { user: { select: { id: true, fullName: true, email: true } } }
        });
        
        if (!txn) return res.status(404).json({ status: "ERROR", message: "Transaction not found" });

        // ACTIVE SYNC: If still pending, ask the provider for the truth
        if (txn.status === TransactionStatus.PENDING && txn.providerReference) {
            try {
                const providerStatus = await dataProvider.queryTransaction(txn.providerReference);
                
                // Nellobyte statuscode "200" = ORDER_COMPLETED
                if (providerStatus.statuscode === "200") {
                    txn = await prisma.transaction.update({
                        where: { id: txn.id },
                        data: { status: TransactionStatus.SUCCESS },
                        include: { user: { select: { fullName: true, email: true } } }
                    });
                } 
                // Handle cancellation or failure by refunding the Wallet
                else if (["ORDER_CANCELLED", "ORDER_FAILED"].includes(providerStatus.status)) {
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