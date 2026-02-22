const prisma = require('@/lib/prisma');
const paymentProvider = require('@/services/paymentProvider');
const { encrypt } = require('@/lib/crypto');
const { TransactionType, TransactionStatus } = require('@prisma/client');

/**
 * Start Gateway Funding (Standard Checkout)
 */
const kycSchema = z.object({
    bvn: z.string().length(11, "A valid 11-digit BVN is required")
});

/**
 * Helper: Format Zod errors
 */
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
        const { link, tx_ref } = await paymentProvider.initializePayment(userId, amount, user.email, user.fullName);

        await prisma.transaction.create({
            data: {
                userId,
                amount,
                type: TransactionType.WALLET_FUNDING,
                status: TransactionStatus.PENDING,
                reference: tx_ref
            }
        });

        res.status(200).json({ status: "OK", paymentLink: link });
    } catch (error) {
        console.error("Funding Init Error:", error.response?.data || error.message);
        res.status(500).json({ status: "ERROR", message: "Failed to initialize payment gateway" });
    }
};

/**
 * Verify BVN and Generate Dedicated (Reserved) Virtual Account
 * Logic: Checks if user already has an account before calling Flutterwave.
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
        // 1. Fetch user with existing KYC state
        const user = await prisma.user.findUnique({ 
            where: { id: userId },
            include: { kycData: true }
        });

        if (!user) return res.status(404).json({ status: "ERROR", message: "User not found" });

        // 2. Idempotency Check
        if (user.kycData?.virtualAccountNumber) {
            return res.status(200).json({ 
                status: "OK", 
                message: "Dedicated account already exists.", 
                data: {
                    bank: user.kycData.bankName,
                    accountNumber: user.kycData.virtualAccountNumber,
                    accountName: `Data Padi - ${user.fullName}`
                } 
            });
        }

        /**
         * 3. Request Flutterwave Reserved Account
         * We pass user.fullName (the userName from registration) directly.
         */
        const flwAccount = await paymentProvider.createVirtualAccount({
            email: user.email,
            bvn: bvn,
            phoneNumber: user.phoneNumber,
            fullName: user.fullName, // Use stored registration name
            userId: userId
        });

        // 4. Secure the sensitive data
        const encryptedBvn = encrypt(bvn);

        /**
         * 5. Atomic DB Persistance
         * We update KYC and the user's verification flag in one go.
         */
        await prisma.$transaction([
            prisma.kycData.update({
                where: { userId },
                data: {
                    encryptedBvn: encryptedBvn, 
                    virtualAccountNumber: flwAccount.account_number,
                    bankName: flwAccount.bank_name,
                    accountReference: flwAccount.order_ref, 
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
            message: "Dedicated bank account activated", 
            data: {
                bank: flwAccount.bank_name,
                accountNumber: flwAccount.account_number,
                accountName: `Data Padi - ${user.fullName}`
            } 
        });
    } catch (error) {
        console.error("[Flutterwave KYC Error]:", error.message);
        
        // Handle common FLW errors (like BVN mismatch on their end)
        const errorMessage = error.message?.includes("invalid") || error.message?.includes("mismatch")
            ? "Identity verification failed. Please ensure your BVN is correct."
            : "Failed to create dedicated account. Please try again later.";

        return res.status(500).json({
            status: "ERROR",
            message: errorMessage
        });
    }
};

module.exports = { initGatewayFunding, createAccount };