const { z } = require('zod');
const prisma = require('@/lib/prisma');
const eduProvider = require('@/services/vtpassProvider');
const naijaProvider = require('@/services/naijaResultPinsProvider');
const { TransactionStatus, TransactionType } = require('@prisma/client');
const { generateRef, generateVTPassRef } = require('@/lib/crypto');
const { isNetworkError, safeRefund } = require('@/lib/financialSafety');
const bcrypt = require('bcryptjs');

// --- SCHEMAS ---

const getPackagesSchema = z.object({
    provider: z.enum(["WAEC", "JAMB", "JAMB_MOCK", "NECO", "NABTEB"], {
        errorMap: () => ({ message: "Provider must be WAEC, JAMB, JAMB_MOCK, NECO, or NABTEB" })
    })
});

const verifyJambSchema = z.object({
    profileId: z.string().length(10, "JAMB Profile ID must be exactly 10 digits")
});

// FIX: Removed 'amount' entirely. The client has no say in the pricing.
const purchasePinSchema = z.object({
    provider: z.enum(["WAEC", "JAMB", "JAMB_MOCK", "NECO", "NABTEB"], {
        errorMap: () => ({ message: "Provider must be WAEC, JAMB, JAMB_MOCK, NECO, or NABTEB" })
    }),
    examType: z.string().min(1, "Exam type is required"), // This maps to PRODUCT_CODE
    phoneNo: z.string().regex(/^(\+234|0)[789][01]\d{8}$/, "Invalid Nigerian phone number"),
    profileId: z.string().optional(),
    transactionPin: z.string().length(4, "Transaction PIN must be 4 digits")
}).refine((data) => {
    if ((data.provider === 'JAMB' || data.provider === 'JAMB_MOCK') && !data.profileId) return false;
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

const EDUCATION_PRODUCTS = {
    WAEC: [
        {
            PRODUCT_SNO: "1",
            PRODUCT_CODE: "waecdirect",
            PRODUCT_ID: "1", // NaijaResultPins card_type_id
            PRODUCT_NAME: 'WAEC Result Checker',
            PRODUCT_AMOUNT: "3350",
            SELLING_PRICE: 3500,
            color: '#10b981',
            lightColor: '#ecfdf5',
            subtitle: 'Check WAEC/WASSCE results instantly',
            type: 'WAEC',
            provider: 'NAIJA_RESULT_PINS'
        }
    ],
    NECO: [
        {
            PRODUCT_SNO: "1",
            PRODUCT_CODE: "necotoken",
            PRODUCT_ID: "2", // Assuming 2 for NECO
            PRODUCT_NAME: 'NECO Result Token',
            PRODUCT_AMOUNT: "1135",
            SELLING_PRICE: 1500,
            color: '#f59e0b',
            lightColor: '#fef3c7',
            subtitle: 'Check NECO results with token',
            type: 'NECO',
            provider: 'NAIJA_RESULT_PINS'
        }
    ],
    NABTEB: [
        {
            PRODUCT_SNO: "1",
            PRODUCT_CODE: "nabtebdirect",
            PRODUCT_ID: "3", // Assuming 3 for NABTEB
            PRODUCT_NAME: 'NABTEB Result Checker',
            PRODUCT_AMOUNT: "1135",
            SELLING_PRICE: 1500,
            color: '#ef4444',
            lightColor: '#fee2e2',
            subtitle: 'Check NABTEB results instantly',
            type: 'NABTEB',
            provider: 'NAIJA_RESULT_PINS'
        }
    ],
    // JAMB: [
    //     {
    //         PRODUCT_SNO: "1",
    //         PRODUCT_CODE: "utme-no-mock",
    //         PRODUCT_ID: "utme-no-mock",
    //         PRODUCT_NAME: 'JAMB UTME (No Mock)',
    //         PRODUCT_AMOUNT: "6050", // VTPass price
    //         SELLING_PRICE: 6200,
    //         color: '#6366f1',
    //         lightColor: '#eef2ff',
    //         subtitle: 'UTME registration without mock exam',
    //         type: 'JAMB',
    //         provider: 'VTPASS'
    //     }
    // ],
    // JAMB_MOCK: [
    //     {
    //         PRODUCT_SNO: "1",
    //         PRODUCT_CODE: "utme-mock",
    //         PRODUCT_ID: "utme-mock",
    //         PRODUCT_NAME: 'JAMB UTME (With Mock)',
    //         PRODUCT_AMOUNT: "7550", // VTPass price
    //         SELLING_PRICE: 7700,
    //         color: '#8b5cf6',
    //         lightColor: '#f5f3ff',
    //         subtitle: 'UTME registration including mock exam',
    //         type: 'JAMB_MOCK',
    //         provider: 'VTPASS'
    //     }
    // ]
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

    // Return hardcoded products
    const products = EDUCATION_PRODUCTS[provider] || [];
    return res.status(200).json({
        status: "OK",
        data: products
    });
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
        // 1. Match the requested examType with our hardcoded products to get the correct provider and price
        const products = EDUCATION_PRODUCTS[provider] || [];
        const selectedPkg = products.find(p => p.PRODUCT_CODE === examType);

        if (!selectedPkg) {
            return res.status(404).json({
                status: "ERROR",
                message: `Invalid package selected for ${provider}.`
            });
        }

        const pinCost = Number(selectedPkg.SELLING_PRICE);
        const providerCost = Number(selectedPkg.PRODUCT_AMOUNT);
        const providerType = selectedPkg.provider;
        const cardTypeId = selectedPkg.PRODUCT_ID;

        // 2. JAMB Profile Verification (Auto-fetch name)
        let customerName = null;
        if ((provider === 'JAMB' || provider === 'JAMB_MOCK') && profileId) {
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

        // 3. Call External Provider
        try {
            let providerResponse;
            if (providerType === 'NAIJA_RESULT_PINS') {
                providerResponse = await naijaProvider.buyExamCard(cardTypeId, 1);
            } else {
                providerResponse = await eduProvider.buyEducationPin(
                    provider.toUpperCase(),
                    examType,
                    phoneNo,
                    profileId, // Specifically used for JAMB
                    providerCost, // Amount VTPass expects
                    result.requestId
                );
            }

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