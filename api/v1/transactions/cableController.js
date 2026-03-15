const { z } = require('zod');
const prisma = require('@/lib/prisma');
const vtpassProvider = require('@/services/vtpassProvider');
const { TransactionStatus, TransactionType } = require('@prisma/client');

const { generateRef, generateVTPassRef } = require('@/lib/crypto');
const { isNetworkError, safeRefund } = require('@/lib/financialSafety');
const { normalizeProviderDate } = require('@/lib/dateUtils');
const bcrypt = require('bcryptjs');
// --- SCHEMAS ---

const verifyIUCSchema = z.object({
    cableTV: z.enum(["dstv", "gotv", "startimes", "showmax"], {
        errorMap: () => ({ message: "Invalid provider. Choose dstv, gotv, startimes, or showmax" })
    }),
    smartCardNo: z.string().min(8, "SmartCard/IUC number is too short").max(15, "SmartCard/IUC number is too long")
});

const purchaseSubscriptionSchema = z.object({
    cableTV: z.enum(["dstv", "gotv", "startimes", "showmax"]),
    packageCode: z.string().min(1, "Package code is required"),
    smartCardNo: z.string().min(8),
    amount: z.number().optional(), // VTPass renewal may require an explicit amount
    transactionPin: z.string().length(4, "Transaction PIN must be 4 digits")
});

/**
 * Helper: Format Zod errors into a readable string
 */
const formatZodError = (error) => {
    if (!error || !error.issues) return "Validation failed";
    return error.issues.map(err => err.message).join(", ");
};

const { getCache, setCache } = require('@/lib/redis');

const getPackages = async (req, res) => {
    try {
        const cacheKey = 'cable_packages_all';
        const cachedPackages = await getCache(cacheKey);

        if (cachedPackages) {
            console.log('[Cache] Hit for cable_packages_all');
            return res.status(200).json(cachedPackages);
        }

        console.log('[Cache] Miss for cable_packages_all');
        const packages = await vtpassProvider.fetchAllCablePackagesMapped();

        // Cache for 24 hours
        await setCache(cacheKey, packages, 86400);

        console.log("Cable Packages fetched from provider");
        return res.status(200).json(packages);

    } catch (error) {
        console.error("Fetch Cable Packages Error:", error.message);
        return res.status(500).json({
            status: "ERROR",
            message: "Internal server error"
        });
    }
};

/**
 * Endpoint: Verify SmartCard Number
 */
const verifyIUC = async (req, res) => {
    // Validate Query Params
    const validation = verifyIUCSchema.safeParse(req.query);

    if (!validation.success) {
        return res.status(400).json({
            status: "ERROR",
            message: formatZodError(validation.error)
        });
    }

    const { cableTV, smartCardNo } = validation.data;

    try {
        const cacheKey = `verify_cable_${cableTV}_${smartCardNo}`;
        const result = await vtpassProvider.verifySmartCard(cableTV, smartCardNo);

        // Cache for 10 minutes to support the purchase follow-up
        await setCache(cacheKey, result, 600);

        return res.status(200).json({ status: "OK", data: result });
    } catch (error) {
        return res.status(400).json({ status: "ERROR", message: error.message });
    }
};

/**
 * Endpoint: Purchase Subscription
 */
const purchaseSubscription = async (req, res) => {
    let user
    try {
        // Validate Request Body
        const validation = purchaseSubscriptionSchema.safeParse(req.body);

        if (!validation.success) {
            return res.status(400).json({
                status: "ERROR",
                message: formatZodError(validation.error)
            });
        }

        const { cableTV, packageCode, smartCardNo, amount, transactionPin } = validation.data;
        console.log("Cable TV Purchase Request:", cableTV, packageCode, smartCardNo, amount);
        const userId = req.user.id;

        // 1. Optimized Verification Fetch (Cache-first)
        const verifyCacheKey = `verify_cable_${cableTV}_${smartCardNo}`;
        let verification = await getCache(verifyCacheKey);
        
        if (!verification) {
            console.log("[Provider] Cache miss for verification, calling VTPass...");
            verification = await vtpassProvider.verifySmartCard(cableTV, smartCardNo);
        } else {
            console.log("[Cache] Hit for verification results");
        }
        
        const customerName = verification.customer_name;

        // 2. Optimized Idempotency Check (Fast-path column)
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
        }

        // 3. Package Resolution (Optimized)
        const pkgCacheKey = 'cable_packages_all';
        const cachedAll = await getCache(pkgCacheKey);
        let selectedPackage;
        
        if (cachedAll && cachedAll.data && cachedAll.data[cableTV.toUpperCase()]) {
            const providerPackages = cachedAll.data[cableTV.toUpperCase()][0].PRODUCT;
            selectedPackage = providerPackages.find(p => p.PACKAGE_ID === packageCode);
        }

        if (!selectedPackage) {
            const packages = await vtpassProvider.fetchCablePackages(cableTV);
            selectedPackage = packages.find(p => p.variation_code === packageCode);
        }

        if (!selectedPackage) {
            return res.status(404).json({ status: "ERROR", message: "Invalid package code" });
        }

        const amountToDeduct = amount ? Number(amount) : Number(selectedPackage.variation_amount || selectedPackage.PACKAGE_AMOUNT);
        const packageName = selectedPackage.name || selectedPackage.PACKAGE_NAME;

        // Fallback Time-based Deduplication (60 seconds)
        if (!idempotencyKey) {
            const sixtySecondsAgo = new Date(Date.now() - 60000);
            const existingTx = await prisma.transaction.findFirst({
                where: {
                    userId,
                    type: TransactionType.CABLE_TV,
                    amount: amountToDeduct,
                    createdAt: { gte: sixtySecondsAgo },
                    metadata: { path: ['smartCardNo'], equals: smartCardNo }
                },
                select: { id: true, metadata: true }
            });

            if (existingTx && existingTx.metadata && existingTx.metadata.cableTV === cableTV && existingTx.metadata.packageCode === packageCode) {
                return res.status(409).json({
                    status: "ERROR",
                    message: "Identical transaction detected within the last minute. Please wait before retrying."
                });
            }
        }

        // 3. Atomic Wallet Deduction
        
        // --- PERFORMANCE OPTIMIZATION: PIN VERIFICATION OUTSIDE TRANSACTION ---
        user = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, transactionPin: true, phoneNumber: true }
        });
        if (!user) throw new Error("User not found");
        if (!user.transactionPin) throw new Error("Please set up a transaction PIN before making purchases");

        // Check Redis cache for verified PIN
        const pinCacheKey = `verified_pin_${userId}_${transactionPin}`;
        let isPinValid = await getCache(pinCacheKey);

        if (!isPinValid) {
            isPinValid = await bcrypt.compare(transactionPin, user.transactionPin);
            if (!isPinValid) throw new Error("Invalid transaction PIN");
            await setCache(pinCacheKey, true, 3600);
        }

        const result = await prisma.$transaction(async (tx) => {
            const walletUpdate = await tx.wallet.updateMany({
                where: {
                    userId,
                    balance: { gte: amountToDeduct }
                },
                data: {
                    balance: { decrement: amountToDeduct },
                    totalSpent: { increment: amountToDeduct }
                }
            });

            if (walletUpdate.count === 0) {
                throw new Error("Insufficient wallet balance");
            }

            const requestId = generateVTPassRef("CAB")
            const transaction = await tx.transaction.create({
                data: {
                    userId,
                    amount: amountToDeduct,
                    type: TransactionType.CABLE_TV,
                    status: TransactionStatus.PENDING,
                    reference: requestId,
                    metadata: {
                        cableTV,
                        packageCode,
                        packageName: packageName,
                        smartCardNo,
                        dueDate: normalizeProviderDate(verification.Due_Date),
                        customerName: customerName,
                        recipient: user.phoneNumber,
                        ...(idempotencyKey && { idempotencyKey })
                    },
                    idempotencyKey: idempotencyKey // Optimized column
                }
            });

            return { transaction, requestId };
        }, {
            maxWait: 15000,
            timeout: 30000
        });

        // 4. Call Provider
        try {
            const providerResponse = await vtpassProvider.buyCableTV(
                cableTV,
                packageCode,
                smartCardNo,
                user.phoneNumber,
                amountToDeduct,
                result.requestId
            );

            const finalStatus = providerResponse.isPending ? TransactionStatus.PENDING : TransactionStatus.SUCCESS;

            await prisma.transaction.update({
                where: { id: result.transaction.id },
                data: {
                    status: finalStatus,
                    providerReference: providerResponse.orderId,
                    providerStatus: providerResponse.status
                }
            });

            if (providerResponse.isPending) {
                return res.status(202).json({
                    status: "PENDING",
                    message: "Cable TV subscription is processing. Please check status history in a moment.",
                    transactionId: result.requestId
                });
            }

            return res.status(200).json({
                status: "OK",
                message: `${packageName} activated successfully for ${customerName}`,
                transactionId: result.requestId
            });

        } catch (apiError) {
            // SMART AUTO-REFUND
            if (isNetworkError(apiError)) {
                console.warn(`[Financial Safety] Timeout for Ref: ${result.requestId}. Leaving PENDING.`);
                return res.status(202).json({
                    status: "PENDING",
                    message: "Connection delay. Your subscription is being processed. Please check your history shortly.",
                    transactionId: result.requestId
                });
            }

            // 5. AUTO-REFUND with retry logic
            await safeRefund(prisma, userId, amountToDeduct, result.transaction.id);

            return res.status(502).json({
                status: "ERROR",
                message: apiError.message || "Provider error. Your wallet has been refunded."
            });
        }

    } catch (error) {
        console.error("Cable TV Error:", error.message);
        return res.status(error.message === "Insufficient wallet balance" ? 402 : 500).json({
            status: "ERROR",
            message: error.message || "Internal server error"
        });
    }
};


module.exports = { verifyIUC, purchaseSubscription, getPackages };