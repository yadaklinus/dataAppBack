const { z } = require('zod');
const prisma = require('@/lib/prisma');
const vtpassProvider = require('@/services/vtpassProvider');
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
    phoneNo: z.string().regex(/^(\+234|0)[789][01]\d{8}$/, "Invalid Nigerian phone number"),
    amount: z.number().optional() // VTPass renewal may require an explicit amount
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
        const { cableTV } = req.query;
        if (!cableTV) return res.status(400).json({ status: "ERROR", message: "cableTV is required for downloading packages" });
        const packages = await vtpassProvider.fetchCablePackages(cableTV);
        return res.status(200).json({ status: "OK", data: packages });

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
        const result = await vtpassProvider.verifySmartCard(cableTV, smartCardNo);

        return res.status(200).json({ status: "OK", data: result });
    } catch (error) {
        return res.status(400).json({ status: "ERROR", message: error.message });
    }
};

/**
 * Endpoint: Purchase Subscription
 */
const purchaseSubscription = async (req, res) => {
    try {
        // Validate Request Body
        const validation = purchaseSubscriptionSchema.safeParse(req.body);

        if (!validation.success) {
            return res.status(400).json({
                status: "ERROR",
                message: formatZodError(validation.error)
            });
        }

        const { cableTV, packageCode, smartCardNo, phoneNo, amount } = validation.data;
        const userId = req.user.id;

        const verification = await vtpassProvider.verifySmartCard(cableTV, smartCardNo);
        const customerName = verification.customer_name;

        const packages = await vtpassProvider.fetchCablePackages(cableTV);
        const selectedPackage = packages.find(p => p.variation_code === packageCode);

        if (!selectedPackage) {
            return res.status(404).json({ status: "ERROR", message: "Invalid package code" });
        }

        // If they pass an amount (e.g., for renewal), verify it against wallet, else use variation amount
        const amountToDeduct = amount ? Number(amount) : Number(selectedPackage.variation_amount);
        const packageName = selectedPackage.name;

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
                        packageName: packageName,
                        smartCardNo,
                        customerName: customerName,
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
            const providerResponse = await vtpassProvider.buyCableTV(
                cableTV,
                packageCode,
                smartCardNo,
                phoneNo,
                amountToDeduct,
                result.requestId
            );

            const finalStatus = providerResponse.isPending ? TransactionStatus.PENDING : TransactionStatus.SUCCESS;

            await prisma.transaction.update({
                where: { id: result.transaction.id },
                data: {
                    status: finalStatus,
                    providerReference: providerResponse.orderId,
                    providerResponse: providerResponse.status
                }
            });

            if (providerResponse.isPending) {
                return res.status(202).json({
                    status: "PENDING",
                    message: "Cable TV subscription is processing. Please check status history in a moment.",
                    transactionId: result.requestId
                });
            }

            // 🟢 Emit WebSocket Event
            const { getIO } = require('@/lib/socket');
            try {
                getIO().to(userId).emit('transaction_update', {
                    status: 'SUCCESS',
                    type: 'CABLE_TV',
                    amount: amountToDeduct,
                    reference: result.requestId,
                    metadata: {
                        cableTV,
                        packageCode,
                        packageName: packageName,
                    }
                });
            } catch (socketErr) {
                console.error("[Socket Error]", socketErr.message);
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