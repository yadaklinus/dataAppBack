const prisma = require('@/lib/prisma');
const paystackProvider = require('@/services/paystackProvider');
const { encrypt } = require('@/lib/crypto');
const { TransactionType, TransactionStatus } = require('@prisma/client');
const { z } = require('zod');

const kycSchema = z.object({
    bvn: z.string().length(11, "A valid 11-digit BVN is required")
});

const formatZodError = (error) => {
    if (!error || !error.issues) return "Validation failed";
    return error.issues.map(err => err.message).join(", ");
};

/**
 * Initialize Paystack Gateway Funding
 */
const initGatewayFunding = async (req, res) => {
    const { amount } = req.body;
    const userId = req.user.id;

    if (!amount || amount < 100) {
        return res.status(400).json({ status: "ERROR", message: "Minimum funding amount is ₦100" });
    }

    try {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) return res.status(404).json({ status: "ERROR", message: "User not found" });

        // 1. Initialize Paystack Transaction
        const paymentData = await paystackProvider.initializePayment(
            userId,
            amount,
            user.email
        );

        // 2. Create Pending Transaction Record
        await prisma.transaction.create({
            data: {
                userId,
                amount: amount,
                type: TransactionType.WALLET_FUNDING,
                status: TransactionStatus.PENDING,
                reference: paymentData.tx_ref,
                metadata: {
                    provider: "PAYSTACK"
                }
            }
        });

        res.status(200).json({
            status: "OK",
            paymentLink: paymentData.link,
            reference: paymentData.tx_ref
        });
    } catch (error) {
        console.error("[Paystack Init Error]:", error.message);
        res.status(500).json({ status: "ERROR", message: "Failed to initialize Paystack gateway" });
    }
};

/**
 * Create Dedicated Paystack Virtual Account
 */
const createAccount = async (req, res) => {
    const validation = kycSchema.safeParse(req.body);

    if (!validation.success) {
        return res.status(400).json({
            status: "ERROR",
            message: formatZodError(validation.error)
        });
    }

    const { bvn } = validation.data;
    const userId = req.user.id;

    try {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: { kycData: true }
        });

        if (!user) return res.status(404).json({ status: "ERROR", message: "User not found" });

        if (user.kycData?.virtualAccountNumber && user.kycData?.bankName) {
            return res.status(200).json({
                status: "OK",
                message: "Dedicated account already exists.",
                data: {
                    bank: user.kycData.bankName,
                    accountNumber: user.kycData.virtualAccountNumber,
                    accountName: user.fullName
                }
            });
        }

        /**
         * 1. Request Paystack Reserved Account
         * We split full name if needed, or send as is if Paystack allows.
         * Paystack /dedicated_account/assign expects first_name and last_name.
         */
        const nameParts = (user.fullName || "Data Padi User").split(" ");
        const first_name = nameParts[0];
        const last_name = nameParts.slice(1).join(" ") || "User";

        const pstkResponse = await paystackProvider.createVirtualAccount({
            email: user.email,
            first_name,
            last_name,
            phone: user.phoneNumber,
            bvn: bvn,
            userId: userId
        });

        // 2. Encrypt BVN
        const encryptedBvn = encrypt(bvn);

        // 3. Update DB
        // NOTE: Paystack's assign endpoint is often asynchronous. 
        // We mark KYC as VERIFIED but the actual account details might arrive via webhook later.
        // For now, we update the status and store the BVN.
        await prisma.$transaction([
            prisma.kycData.update({
                where: { userId },
                data: {
                    encryptedBvn: encryptedBvn,
                    status: 'VERIFIED',
                    verifiedAt: new Date()
                }
            }),
            prisma.user.update({
                where: { id: userId },
                data: { isKycVerified: true }
            })
        ]);

        res.status(200).json({
            status: "OK",
            message: "Paystack dedicated account assignment initiated.",
            data: {
                status: "PENDING_WEBHOOK",
                message: "Account details will be updated once Paystack completes processing."
            }
        });
    } catch (error) {
        console.error("[Paystack KYC Error]:", error.message);
        return res.status(500).json({
            status: "ERROR",
            message: "Failed to initiate dedicated account. Please check your BVN."
        });
    }
};

module.exports = { initGatewayFunding, createAccount };
