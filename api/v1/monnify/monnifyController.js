const prisma = require('@/lib/prisma');
const monnifyProvider = require('@/services/monnifyProvider');
const { encrypt } = require('@/lib/crypto');
const { TransactionType, TransactionStatus } = require('@prisma/client');
const { z } = require('zod');
/**
 * Start Monnify Gateway Funding (Standard Checkout)
 * Initialized with the requested amount; fees are handled internally by the provider service.
 */
const kycSchema = z.object({
    bvn: z.string().length(11, "A valid 11-digit BVN is required")
});

const formatZodError = (error) => {
    if (!error || !error.issues) return "Validation failed";
    return error.issues.map(err => err.message).join(", ");
};

const initGatewayFunding = async (req, res) => {
    const { amount } = req.body;
    const userId = req.user.id;

    if (!amount || amount < 100) {
        return res.status(400).json({ status: "ERROR", message: "Minimum funding amount is ₦100" });
    }


    try {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) return res.status(404).json({ status: "ERROR", message: "User not found" });

        /**
         * 1. Initialize Monnify Dynamic Account
         * We pass the requested amount and user details to get a one-time bank account.
         */
        const paymentData = await monnifyProvider.createDynamicAccount(
            amount,
            user.fullName || "Mufti Pay User",
            user.email,
            `FUND-MNFY-${Date.now()}-${userId}`,
            "Wallet Top-up"
        );

        const primaryAccount = paymentData.accounts[0];

        // 2. Create Pending Transaction Record
        await prisma.transaction.create({
            data: {
                userId,
                amount: amount,
                type: TransactionType.WALLET_FUNDING,
                status: TransactionStatus.PENDING,
                reference: paymentData.paymentReference,
                metadata: {
                    provider: "MONNIFY",
                    transactionReference: paymentData.transactionReference,
                    accountDetails: {
                        accountNumber: primaryAccount.accountNumber,
                        accountName: primaryAccount.accountName,
                        bankName: primaryAccount.bankName,
                        amount: paymentData.amount
                    }
                }
            }
        });

        res.status(200).json({
            status: "OK",
            accountNumber: primaryAccount.accountNumber,
            accountName: primaryAccount.accountName,
            bankName: primaryAccount.bankName,
            amount: paymentData.amount,
            reference: paymentData.paymentReference
        });
    } catch (error) {
        console.error("[Monnify Init Error]:", error.message);
        res.status(500).json({ status: "ERROR", message: "Failed to initialize Monnify gateway" });
    }
};

/**
 * Verify BVN and Create Dedicated Monnify Virtual Account
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

        if (user.kycData?.virtualAccountNumber) {
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
         * 1. Request Monnify Reserved Account
         * We use user.fullName (which is the userName from registration) 
         * as the account name directly.
         */
        const mnfyAccount = await monnifyProvider.createVirtualAccount({
            email: user.email,
            bvn: bvn,
            fullName: user.fullName,
            userId: userId
        });


        // 2. Encrypt BVN for security
        const encryptedBvn = encrypt(bvn);

        // 3. Atomic DB Update
        await prisma.$transaction([
            prisma.kycData.update({
                where: { userId },
                data: {
                    encryptedBvn: encryptedBvn,
                    virtualAccountNumber: mnfyAccount.account_number,
                    bankName: mnfyAccount.bank_name,
                    accountReference: mnfyAccount.order_ref,
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
            message: "Monnify dedicated account activated",
            data: {
                bank: mnfyAccount.bank_name,
                accountNumber: mnfyAccount.account_number,
                accountName: mnfyAccount.account_name // Legal name from Monnify
            }
        });
    } catch (error) {
        console.error("[Monnify KYC Error]:", error.message);
        return res.status(500).json({
            status: "ERROR",
            message: "Failed to create dedicated account. Please check your BVN."
        });
    }
};

module.exports = { initGatewayFunding, createAccount };