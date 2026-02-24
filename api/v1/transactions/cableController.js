const { z } = require('zod');
const prisma = require('@/lib/prisma');
const cableProvider = require('@/services/cableProvider');
const { TransactionStatus, TransactionType } = require('@prisma/client');

const { generateRef } = require('@/lib/crypto')
const { isNetworkError } = require('@/lib/financialSafety');
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
    phoneNo: z.string().regex(/^(\+234|0)[789][01]\d{8}$/, "Invalid Nigerian phone number")
});

/**
 * Helper: Format Zod errors into a readable string
 */
const formatZodError = (error) => {
    if (!error || !error.issues) return "Validation failed";
    return error.issues.map(err => err.message).join(", ");
};

const getPackages = async (req, res) => {
    try {
        const data = await cableProvider.fetchPackages();

        // Failsafe if the provider structure changes or fails
        if (!data || !data.TV_ID) {
            return res.status(500).json({
                status: "ERROR",
                message: "Could not fetch packages from provider"
            });
        }

        const rawPackages = data.TV_ID;
        const sanitizedPackages = {};

        // Iterate dynamically over all providers (DStv, GOtv, Startimes, etc.)
        for (const [providerName, providerArray] of Object.entries(rawPackages)) {

            sanitizedPackages[providerName] = providerArray.map(provider => {
                return {
                    ...provider, // Keep the ID field (e.g., "ID": "dstv")
                    PRODUCT: provider.PRODUCT.map(product => {
                        // Destructure to extract the fields you DON'T want
                        // The 'cleanProduct' variable catches everything else
                        const {
                            PRODUCT_DISCOUNT_AMOUNT,
                            PRODUCT_DISCOUNT,
                            MINAMOUNT,
                            MAXAMOUNT,
                            ...cleanProduct
                        } = product;

                        return cleanProduct;
                    })
                };
            });
        }

        // Return the stripped-down JSON to the client
        return res.status(200).json({
            status: "OK",
            data: sanitizedPackages
        });

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
        const result = await cableProvider.verifySmartCard(cableTV, smartCardNo);
        return res.status(200).json({ status: "OK", data: result });
    } catch (error) {
        return res.status(400).json({ status: "ERROR", message: error.message });
    }
};

/**
 * Endpoint: Purchase Subscription
 */
const purchaseSubscription = async (req, res) => {
    // Validate Request Body
    const validation = purchaseSubscriptionSchema.safeParse(req.body);

    if (!validation.success) {
        return res.status(400).json({
            status: "ERROR",
            message: formatZodError(validation.error)
        });
    }

    const { cableTV, packageCode, smartCardNo, phoneNo } = validation.data;
    const userId = req.user.id;

    try {
        // 1. Fetch live packages to get current price (Verification of cost)
        const allPackages = await cableProvider.fetchPackages();
        const providerKey = cableTV.toUpperCase();
        // 1. Safely fall back to an empty object if TV_ID is missing
        const safePackages = allPackages?.TV_ID || {};

        // 2. Find the actual key in the object by comparing both as uppercase strings
        const actualKey = Object.keys(safePackages).find(
            (key) => key.toUpperCase() === providerKey.toUpperCase()
        );

        // 3. Extract the array using the matched key, or fallback to an empty array
        const packageList = actualKey ? safePackages[actualKey] : [];

        const selectedPackage = packageList[0].PRODUCT.find(p => p.PACKAGE_ID === packageCode);

        if (!selectedPackage) {
            return res.status(404).json({ status: "ERROR", message: "Invalid package code for this provider" });
        }

        const amountToDeduct = Number(selectedPackage.PACKAGE_AMOUNT);

        // 2. Verify customer name (Safety check against stale inputs)
        const verification = await cableProvider.verifySmartCard(cableTV, smartCardNo);

        // 3. Atomic Wallet Deduction
        const result = await prisma.$transaction(async (tx) => {
            const wallet = await tx.wallet.findUnique({ where: { userId } });

            if (!wallet || Number(wallet.balance) < amountToDeduct) {
                throw new Error("Insufficient wallet balance");
            }

            const requestId = generateRef("CAB")
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
                        packageName: selectedPackage.PRODUCT_NAME,
                        smartCardNo,
                        customerName: verification.customer_name,
                        recipient: phoneNo
                    }
                }
            });

            await tx.wallet.update({
                where: { userId },
                data: {
                    balance: { decrement: amountToDeduct },
                    totalSpent: { increment: amountToDeduct }
                }
            });

            return { transaction, requestId };
        });

        // 4. Call Provider
        try {
            const providerResponse = await cableProvider.subscribe({
                cableTV,
                packageCode,
                smartCardNo,
                phoneNo,
                requestId: result.requestId
            });

            await prisma.transaction.update({
                where: { id: result.transaction.id },
                data: {
                    status: TransactionStatus.SUCCESS,
                    providerReference: providerResponse.orderId
                }
            });

            return res.status(200).json({
                status: "OK",
                message: `${selectedPackage.PRODUCT_NAME} activated successfully for ${verification.customer_name}`,
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

            // 5. AUTO-REFUND
            await prisma.$transaction([
                prisma.transaction.update({
                    where: { id: result.transaction.id },
                    data: { status: TransactionStatus.FAILED }
                }),
                prisma.wallet.update({
                    where: { userId },
                    data: {
                        balance: { increment: amountToDeduct },
                        totalSpent: { decrement: amountToDeduct }
                    }
                })
            ]);

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