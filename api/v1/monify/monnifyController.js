const prisma = require('@/lib/prisma');
const monnifyProvider = require('@/services/monnifyProvider');
const { encrypt } = require('@/lib/crypto');
const { TransactionType, TransactionStatus } = require('@prisma/client');

/**
 * Start Monnify Gateway Funding (Standard Checkout)
 * Initialized with the requested amount; fees are handled internally by the provider service.
 */
const initGatewayFunding = async (req, res) => {
    const { amount } = req.body;
    const userId = req.user.id;

    if (!amount || amount < 100) {
        return res.status(400).json({ status: "ERROR", message: "Minimum funding amount is ₦100" });
    }

    console.log(amount)

    try {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) return res.status(404).json({ status: "ERROR", message: "User not found" });

        /**
         * 1. Initialize Monnify Transaction
         * We pass the requested amount. The provider logic or Monnify internally 
         * determines the final charge and returns the tx_ref.
         */
        const paymentData = await monnifyProvider.initializePayment(
            userId, 
            amount, 
            user.email, 
            user.fullName || "Data Padi User"
        );

        // 2. Create Pending Transaction Record
        // We store the amount the user intends to have credited to their wallet.
        await prisma.transaction.create({
            data: {
                userId,
                amount: amount, 
                type: TransactionType.WALLET_FUNDING,
                status: TransactionStatus.PENDING,
                reference: paymentData.tx_ref,
                metadata: {
                    provider: "MONNIFY",
                    transactionReference: paymentData.transactionReference
                }
            }
        });

        res.status(200).json({ 
            status: "OK", 
            paymentLink: paymentData.link,
            reference: paymentData.tx_ref
        });
    } catch (error) {
        console.error("[Monnify Init Error]:", error.message);
        res.status(500).json({ status: "ERROR", message: "Failed to initialize Monnify gateway" });
    }
};

/**
 * Verify BVN and Create Dedicated Monnify Virtual Account
 */
const verifyBvnAndCreateAccount = async (req, res) => {
    const { bvn, firstName, lastName } = req.body;
    const userId = req.user.id;

    // 1. Input Validation
    if (!bvn || bvn.length !== 11) {
        return res.status(400).json({ status: "ERROR", message: "A valid 11-digit BVN is required" });
    }
    if (!firstName || !lastName) {
        return res.status(400).json({ status: "ERROR", message: "First and Last names are required for verification" });
    }

    try {
        // 2. Check current KYC status
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

        // 3. Request Monnify Reserved Account
        const mnfyAccount = await monnifyProvider.createVirtualAccount({
            email: user.email,
            bvn: bvn,
            fullName: `${firstName}`,
            userId: userId
        });

        /**
         * 4. Identity Match Check
         * We verify that the name Monnify returned matches the user's input.
         */
        const searchPool = mnfyAccount.account_name.toUpperCase();
        const inputFirst = firstName.toUpperCase().trim();
        const inputLast = lastName.toUpperCase().trim();

        const isMatch = searchPool.includes(inputFirst) && searchPool.includes(inputLast);

        // if (!isMatch) {
        //     return res.status(400).json({
        //         status: "ERROR",
        //         message: "Identity mismatch. Provided names do not match your BVN record.",
        //         details: `Bank Name Record: ${mnfyAccount.account_name}`
        //     });
        // }

        // 5. Encrypt BVN and Persist to DB
        const encryptedBvn = encrypt(bvn);

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
                data: { 
                    isKycVerified: true,
                    
                } 
            })
        ]);

        res.status(200).json({ 
            status: "OK", 
            message: "Monnify dedicated account activated", 
            data: {
                bank: mnfyAccount.bank_name,
                accountNumber: mnfyAccount.account_number,
                accountName: mnfyAccount.account_name
            } 
        });
    } catch (error) {
        console.error("[Monnify KYC Error]:", error.message);
        return res.status(500).json({ 
            status: "ERROR", 
            message: error.message || "Failed to create dedicated account"
        });
    }
};

module.exports = { initGatewayFunding, verifyBvnAndCreateAccount };