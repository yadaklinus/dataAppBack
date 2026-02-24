"use strict";
const { z } = require('zod');
const prisma = require('@/lib/prisma');
const eduProvider = require('@/services/educationProvider');
const { TransactionStatus, TransactionType } = require('@prisma/client');
const { generateRef } = require('@/lib/crypto');
const { isNetworkError } = require('@/lib/financialSafety');
// --- SCHEMAS ---
const getPackagesSchema = z.object({
    provider: z.enum(["WAEC", "JAMB"], {
        errorMap: () => ({ message: "Provider must be either WAEC or JAMB" })
    })
});
const verifyJambSchema = z.object({
    profileId: z.string().length(10, "JAMB Profile ID must be exactly 10 digits")
});
// FIX: Removed 'amount' entirely. The client has no say in the pricing.
const purchasePinSchema = z.object({
    provider: z.enum(["WAEC", "JAMB"], {
        errorMap: () => ({ message: "Provider must be either WAEC or JAMB" })
    }),
    examType: z.string().min(1, "Exam type is required"), // This maps to PRODUCT_CODE
    phoneNo: z.string().regex(/^(\+234|0)[789][01]\d{8}$/, "Invalid Nigerian phone number"),
    profileId: z.string().optional()
}).refine((data) => {
    if (data.provider === 'JAMB' && !data.profileId)
        return false;
    return true;
}, {
    message: "JAMB Profile ID is required for JAMB purchases",
    path: ["profileId"]
});
const formatZodError = (error) => {
    if (!error || !error.issues)
        return "Validation failed";
    return error.issues.map(err => err.message).join(", ");
};
const getPackages = async (req, res) => {
    const validation = getPackagesSchema.safeParse(req.query);
    if (!validation.success) {
        return res.status(400).json({
            status: "ERROR",
            message: formatZodError(validation.error)
        });
    }
    const { provider } = validation.data;
    try {
        const result = await eduProvider.fetchPackages(provider);
        return res.status(200).json({ status: "OK", data: result });
    }
    catch (error) {
        return res.status(400).json({ status: "ERROR", message: error.message });
    }
};
const verifyJamb = async (req, res) => {
    const validation = verifyJambSchema.safeParse(req.query);
    if (!validation.success) {
        return res.status(400).json({
            status: "ERROR",
            message: formatZodError(validation.error)
        });
    }
    const { profileId } = validation.data;
    try {
        const result = await eduProvider.verifyJambProfile(profileId);
        return res.status(200).json({ status: "OK", data: result });
    }
    catch (error) {
        return res.status(400).json({ status: "ERROR", message: error.message });
    }
};
const purchasePin = async (req, res) => {
    const validation = purchasePinSchema.safeParse(req.body);
    if (!validation.success) {
        return res.status(400).json({
            status: "ERROR",
            message: formatZodError(validation.error)
        });
    }
    const { provider, examType, phoneNo, profileId } = validation.data;
    const userId = req.user.id;
    try {
        // 1. Fetch Authoritative Pricing from Provider
        const packageData = await eduProvider.fetchPackages(provider);
        const availablePackages = packageData.EXAM_TYPE || [];
        // Match the requested examType with the provider's PRODUCT_CODE
        const selectedPkg = availablePackages.find(p => p.PRODUCT_CODE === examType);
        if (!selectedPkg) {
            return res.status(404).json({
                status: "ERROR",
                message: `Invalid package selected for ${provider}.`
            });
        }
        // Server sets the absolute truth for the cost. 
        // Note: Add your platform markup fee here if you want to make a profit!
        // Example: const pinCost = Number(selectedPkg.PRODUCT_AMOUNT) + 150;
        const pinCost = Number(selectedPkg.PRODUCT_AMOUNT);
        // 2. Database Atomic Operation
        const result = await prisma.$transaction(async (tx) => {
            const wallet = await tx.wallet.findUnique({ where: { userId } });
            if (!wallet || Number(wallet.balance) < pinCost) {
                throw new Error("Insufficient wallet balance");
            }
            const requestId = generateRef("EDU");
            const transaction = await tx.transaction.create({
                data: {
                    userId,
                    amount: pinCost,
                    type: TransactionType.EDUCATION,
                    status: TransactionStatus.PENDING,
                    reference: requestId,
                    metadata: {
                        provider,
                        examType,
                        recipient: phoneNo,
                        profileId: profileId || null
                    }
                }
            });
            await tx.wallet.update({
                where: { userId },
                data: {
                    balance: { decrement: pinCost },
                    totalSpent: { increment: pinCost }
                }
            });
            return { transaction, requestId };
        });
        // 3. Call External Provider
        try {
            const providerResponse = await eduProvider.buyPin(provider.toUpperCase(), examType, phoneNo, result.requestId);
            // 4. Finalize Transaction with PIN Details
            await prisma.transaction.update({
                where: { id: result.transaction.id },
                data: {
                    status: TransactionStatus.SUCCESS,
                    providerReference: providerResponse.orderId,
                    metadata: {
                        ...result.transaction.metadata,
                        cardDetails: providerResponse.cardDetails
                    }
                }
            });
            return res.status(200).json({
                status: "OK",
                message: `${provider} PIN purchase successful`,
                data: {
                    cardDetails: providerResponse.cardDetails,
                    transactionId: result.requestId
                }
            });
        }
        catch (apiError) {
            // 5. SMART AUTO-REFUND: Skip if it was just a timeout
            if (isNetworkError(apiError)) {
                console.warn(`[Financial Safety] Timeout for Ref: ${result.requestId}. Leaving PENDING.`);
                return res.status(202).json({
                    status: "PENDING",
                    message: "Connection delay with the board. Your PIN is being generated. Check your receipt shortly.",
                    transactionId: result.requestId
                });
            }
            // AUTO-REFUND
            await prisma.$transaction([
                prisma.transaction.update({
                    where: { id: result.transaction.id },
                    data: { status: TransactionStatus.FAILED }
                }),
                prisma.wallet.update({
                    where: { userId },
                    data: {
                        balance: { increment: pinCost },
                        totalSpent: { decrement: pinCost }
                    }
                })
            ]);
            return res.status(502).json({
                status: "ERROR",
                message: apiError.message || "Provider error. Wallet refunded."
            });
        }
    }
    catch (error) {
        console.error("Education PIN Error:", error.message);
        return res.status(error.message === "Insufficient wallet balance" ? 402 : 500).json({
            status: "ERROR",
            message: error.message || "Internal server error"
        });
    }
};
module.exports = { verifyJamb, purchasePin, getPackages };
