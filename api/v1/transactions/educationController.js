const { z } = require('zod');
const prisma = require('@/lib/prisma');
const eduProvider = require('@/services/educationProvider');
const { TransactionStatus, TransactionType } = require('@prisma/client');
const { generateRef } = require('@/lib/crypto')
// --- SCHEMAS ---

const verifyJambSchema = z.object({
    profileId: z.string().min(10, "JAMB Profile ID is usually 10 digits").max(10, "JAMB Profile ID is usually 10 digits")
});

const purchasePinSchema = z.object({
    provider: z.enum(["WAEC", "JAMB"], {
        errorMap: () => ({ message: "Provider must be either WAEC or JAMB" })
    }),
    examType: z.string().min(1, "Exam type is required"),
    phoneNo: z.string().regex(/^(\+234|0)[789][01]\d{8}$/, "Invalid Nigerian phone number"),
    amount: z.number().min(500, "Minimum PIN cost is ₦500"),
    profileId: z.string().optional()
}).refine((data) => {
    // If provider is JAMB, profileId MUST be present
    if (data.provider === 'JAMB' && !data.profileId) return false;
    return true;
}, {
    message: "JAMB Profile ID is required for JAMB purchases",
    path: ["profileId"]
});

/**
 * Helper: Format Zod errors into a readable string
 */
const formatZodError = (error) => {
    if (!error || !error.issues) return "Validation failed";
    return error.issues.map(err => err.message).join(", ");
};

/**
 * Verify JAMB Profile ID
 */
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
    } catch (error) {
        return res.status(400).json({ status: "ERROR", message: error.message });
    }
};

/**
 * Purchase WAEC or JAMB PIN
 */
const purchasePin = async (req, res) => {
    const validation = purchasePinSchema.safeParse(req.body);

    if (!validation.success) {
        return res.status(400).json({ 
            status: "ERROR", 
            message: formatZodError(validation.error) 
        });
    }

    const { provider, examType, phoneNo, amount, profileId } = validation.data;
    const userId = req.user.id;
    const pinCost = Number(amount);

    try {
        // 1. Database Atomic Operation
        const result = await prisma.$transaction(async (tx) => {
            const wallet = await tx.wallet.findUnique({ where: { userId } });
            
            if (!wallet || Number(wallet.balance) < pinCost) {
                throw new Error("Insufficient wallet balance");
            }

            const requestId = generateRef("EDU")
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

        // 2. Call External Provider
        try {
            const providerResponse = await eduProvider.buyPin(
                provider.toUpperCase(),
                examType,
                phoneNo,
                result.requestId
            );

            // 3. Finalize Transaction with PIN Details
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

        } catch (apiError) {
            // 4. AUTO-REFUND
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

    } catch (error) {
        console.error("Education PIN Error:", error.message);
        return res.status(error.message === "Insufficient wallet balance" ? 402 : 500).json({
            status: "ERROR",
            message: error.message || "Internal server error"
        });
    }
};

module.exports = { verifyJamb, purchasePin };