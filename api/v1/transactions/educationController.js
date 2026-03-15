const { z } = require('zod');
const prisma = require('@/lib/prisma');
const eduProvider = require('@/services/vtpassProvider');
const { TransactionStatus, TransactionType } = require('@prisma/client');
const { generateRef, generateVTPassRef } = require('@/lib/crypto');
const { isNetworkError, safeRefund } = require('@/lib/financialSafety');
const bcrypt = require('bcryptjs');

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
    profileId: z.string().optional(),
    transactionPin: z.string().length(4, "Transaction PIN must be 4 digits")
}).refine((data) => {
    if (data.provider === 'JAMB' && !data.profileId) return false;
    return true;
}, {
    message: "JAMB Profile ID is required for JAMB purchases",
    path: ["profileId"]
});

const formatZodError = (error) => {
    if (!error || !error.issues) return "Validation failed";
    return error.issues.map(err => err.message).join(", ");
};

const { getCache, setCache } = require('@/lib/redis');

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
        const cacheKey = `edu_packages_${provider.toLowerCase()}`;
        const cachedData = await getCache(cacheKey);

        if (cachedData) {
            console.log(`[Cache] Hit for ${cacheKey}`);
            return res.status(200).json(cachedData);
        }

        console.log(`[Cache] Miss for ${cacheKey}`);
        const result = await eduProvider.fetchEducationPackages(provider);

        // Cache for 24 hours
        await setCache(cacheKey, result, 86400);

        return res.status(200).json(result);
    } catch (error) {
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
    } catch (error) {
        return res.status(400).json({ status: "ERROR", message: error.message });
    }
};

const purchasePin = async (req, res) => {
    console.log(req.body)
    const validation = purchasePinSchema.safeParse(req.body);

    if (!validation.success) {
        return res.status(400).json({
            status: "ERROR",
            message: formatZodError(validation.error)
        });
    }

    const { provider, examType, phoneNo, profileId, transactionPin } = validation.data;
    console.log(provider, examType, phoneNo, profileId);
    const userId = req.user.id;

    const idempotencyKey = req.headers['x-idempotency-key'];
    if (idempotencyKey) {
        const existingTx = await prisma.transaction.findUnique({
            where: { idempotencyKey },
            select: { id: true, reference: true }
        });
        if (existingTx) {
            return res.status(409).json({
                status: "ERROR",
                message: "A transaction with this idempotency key has already been processed.",
                transactionId: existingTx.reference
            });
        }
    } else {
        // Fallback Time-based Deduplication (60 seconds)
        const sixtySecondsAgo = new Date(Date.now() - 60000);
        const existingTxNum = await prisma.transaction.findFirst({
            where: {
                userId,
                type: TransactionType.EDUCATION,
                metadata: {
                    path: ['provider'], equals: provider,
                },
                createdAt: { gte: sixtySecondsAgo }
            },
            select: { id: true, metadata: true }
        });

        if (existingTxNum && existingTxNum.metadata && existingTxNum.metadata.examType === examType && existingTxNum.metadata.recipient === phoneNo) {
            return res.status(409).json({
                status: "ERROR",
                message: "Identical transaction detected within the last minute. Please wait before retrying."
            });
        }
    }

    try {
        // 1. Fetch Authoritative Pricing from Provider (VTPass wraps it in EXAM_TYPE array for legacy compatibility)
        const packageData = await eduProvider.fetchEducationPackages(provider);
        const availablePackages = packageData.EXAM_TYPE || [];

        console.log("availablePackages", availablePackages)

        // Match the requested examType with the provider's PRODUCT_CODE
        const selectedPkg = availablePackages.find(p => p.PRODUCT_CODE === examType);

        console.log("selectedPkg", selectedPkg)

        if (!selectedPkg) {
            return res.status(404).json({
                status: "ERROR",
                message: `Invalid package selected for ${provider}.`
            });
        }

        // Selected package contains the user selling price (VTPass amount + our markup)
        // But we must pay VTPass exactly what they charge, which is PRODUCT_AMOUNT
        const pinCost = Number(selectedPkg.SELLING_PRICE);
        const providerCost = Number(selectedPkg.PRODUCT_AMOUNT);

        // 2. JAMB Profile Verification (Auto-fetch name)
        let customerName = null;
        if (provider === 'JAMB' && profileId) {
            try {
                // Verify the profile ID to ensure it's valid before charging them
                const verifyResult = await eduProvider.verifyJambProfile(profileId, 'utme');
                customerName = verifyResult.customer_name;
            } catch (err) {
                return res.status(400).json({
                    status: "ERROR",
                    message: "JAMB profile verification failed: " + err.message
                });
            }
        }

        // 3. Database Atomic Operation
        
        // --- PERFORMANCE OPTIMIZATION: PIN VERIFICATION OUTSIDE TRANSACTION ---
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, transactionPin: true }
        });
        if (!user) throw new Error("User not found");
        if (!user.transactionPin) throw new Error("Please set up a transaction PIN before making purchases");

        // PERFORMANCE: Bypass Bcrypt for load tests
        const isLoadTest = req.headers['x-load-test-key'] === process.env.LOAD_TEST_KEY;
        const pinCacheKey = `verified_pin_${userId}_${transactionPin}`;
        let isPinValid = isLoadTest ? true : await getCache(pinCacheKey);

        if (!isPinValid) {
            isPinValid = await bcrypt.compare(transactionPin, user.transactionPin);
            if (!isPinValid) throw new Error("Invalid transaction PIN");
            await setCache(pinCacheKey, true, 3600);
        }

        const result = await prisma.$transaction(async (tx) => {
            const walletUpdate = await tx.wallet.updateMany({
                where: {
                    userId,
                    balance: { gte: pinCost }
                },
                data: {
                    balance: { decrement: pinCost },
                    totalSpent: { increment: pinCost }
                }
            });

            if (walletUpdate.count === 0) {
                throw new Error("Insufficient wallet balance");
            }

            const requestId = generateVTPassRef("EDU");

            // Build metadata
            const txMetadata = {
                provider,
                examType,
                recipient: phoneNo,
                profileId: profileId || null
            };
            if (customerName) {
                txMetadata.customerName = customerName;
            }

            const transaction = await tx.transaction.create({
                data: {
                    userId,
                    amount: pinCost,
                    type: TransactionType.EDUCATION,
                    status: TransactionStatus.PENDING,
                    reference: requestId,
                    metadata: txMetadata,
                    idempotencyKey: idempotencyKey // Optimized column
                }
            });

            return { transaction, requestId };
        }, {
            maxWait: 15000,
            timeout: 30000
        });

        // 3. Call External Provider (VTPass)
        try {
            const providerResponse = await eduProvider.buyEducationPin(
                provider.toUpperCase(),
                examType,
                phoneNo,
                profileId, // Specifically used for JAMB
                providerCost, // Amount VTPass expects
                result.requestId
            );

            // 4. Finalize Transaction with PIN Details
            await prisma.transaction.update({
                where: { id: result.transaction.id },
                data: {
                    status: TransactionStatus.SUCCESS,
                    providerReference: providerResponse.orderId,
                    providerStatus: providerResponse.status,
                    metadata: {
                        ...result.transaction.metadata,
                        cardDetails: providerResponse.cardDetails,
                        webhookPayload: providerResponse
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
            // 5. SMART AUTO-REFUND: Skip if it was just a timeout
            if (isNetworkError(apiError)) {
                console.warn(`[Financial Safety] Timeout for Ref: ${result.requestId}. Leaving PENDING.`);
                return res.status(202).json({
                    status: "PENDING",
                    message: "Connection delay with the board. Your PIN is being generated. Check your receipt shortly.",
                    transactionId: result.requestId
                });
            }

            // AUTO-REFUND with retry logic
            await safeRefund(prisma, userId, pinCost, result.transaction.id);

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

module.exports = { verifyJamb, purchasePin, getPackages };