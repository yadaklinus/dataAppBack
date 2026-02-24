"use strict";
const prisma = require('@/lib/prisma');
const dataProvider = require('@/services/dataProvider');
const { validateNetworkMatch, normalizePhoneNumber } = require('@/lib/networkValidator');
const { TransactionStatus, TransactionType } = require('@prisma/client');
const { z } = require('zod');
const { generateRef } = require('@/lib/crypto');
const { isNetworkError } = require('@/lib/financialSafety');
const purchaseDataSchema = z.object({
    network: z.enum(['MTN', 'GLO', 'AIRTEL', '9MOBILE']),
    planId: z.string().min(1).max(20),
    phoneNumber: z.string().regex(/^(\+?234|0)[7-9][0-1]\d{8}$/),
});
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
    }
    catch (error) {
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
    const { network, planId, phoneNumber } = parsed.data;
    const userId = req.user.id;
    if (!network || !planId || !phoneNumber) {
        return res.status(400).json({ status: "ERROR", message: "Network, Plan ID, and Phone Number are required" });
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
    try {
        const allPlans = await dataProvider.fetchAvailablePlans();
        let selectedPlan = null;
        const inputNet = network.toUpperCase();
        let networkKey;
        if (inputNet === "MTN") {
            networkKey = "MTN";
        }
        else if (inputNet === "9MOBILE") {
            networkKey = "m_9mobile";
        }
        else {
            networkKey = inputNet.charAt(0) + inputNet.slice(1).toLowerCase();
        }
        const networkGroups = allPlans.MOBILE_NETWORK?.[networkKey] || [];
        for (const group of networkGroups) {
            const found = group.PRODUCT.find(p => String(p.PRODUCT_CODE) === String(planId) ||
                String(p.PRODUCT_ID) === String(planId));
            if (found) {
                selectedPlan = found;
                break;
            }
        }
        if (!selectedPlan) {
            return res.status(404).json({
                status: "ERROR",
                message: "Invalid data plan selected"
            });
        }
        const sellingPrice = selectedPlan.SELLING_PRICE;
        const result = await prisma.$transaction(async (tx) => {
            const wallet = await tx.wallet.findUnique({ where: { userId } });
            if (!wallet || Number(wallet.balance) < sellingPrice) {
                throw new Error("Insufficient wallet balance");
            }
            const requestId = generateRef("DAT");
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
                        planName: selectedPlan.PRODUCT_NAME,
                        planId: planId
                    }
                }
            });
            await tx.wallet.update({
                where: { userId },
                data: {
                    balance: { decrement: sellingPrice },
                    totalSpent: { increment: sellingPrice }
                }
            });
            return { transaction, requestId };
        });
        try {
            const providerResponse = await dataProvider.buyData(network, planId, cleanPhone, result.requestId);
            await prisma.transaction.update({
                where: { id: result.transaction.id },
                data: {
                    status: TransactionStatus.SUCCESS,
                    providerReference: providerResponse.orderId
                }
            });
            return res.status(200).json({
                status: "OK",
                message: `Successfully sent ${selectedPlan.PRODUCT_NAME} to ${cleanPhone}`,
                transactionId: result.requestId
            });
        }
        catch (apiError) {
            if (isNetworkError(apiError)) {
                console.warn(`[Financial Safety] Timeout for Ref: ${result.requestId}. Leaving PENDING.`);
                return res.status(202).json({
                    status: "PENDING",
                    message: "Network delay. Your data bundle is being processed. check status shortly.",
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
                        balance: { increment: sellingPrice },
                        totalSpent: { decrement: sellingPrice }
                    }
                })
            ]);
            return res.status(502).json({
                status: "ERROR",
                message: apiError.message || "Provider error. Your wallet has been refunded."
            });
        }
    }
    catch (error) {
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
        if (!txn || txn.userId !== req.user.id)
            return res.status(404).json({ status: "ERROR", message: "Transaction not found" });
        if (txn.status === TransactionStatus.PENDING && txn.providerReference) {
            try {
                const providerStatus = await dataProvider.queryTransaction(txn.providerReference);
                if (providerStatus.statuscode === "200") {
                    txn = await prisma.transaction.update({
                        where: { id: txn.id },
                        data: { status: TransactionStatus.SUCCESS },
                        include: { user: { select: { fullName: true, email: true } } }
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
                                totalSpent: { decrement: txn.amount }
                            }
                        })
                    ]);
                    txn = { ...updatedData[0], user: txn.user };
                }
            }
            catch (queryError) {
                console.error("Auto-sync query failed:", queryError.message);
            }
        }
        return res.status(200).json({ status: "OK", data: txn });
    }
    catch (error) {
        return res.status(500).json({ status: "ERROR", message: "Failed to fetch status" });
    }
};
module.exports = {
    getAvailablePlans,
    purchaseData,
    getDataStatus
};
