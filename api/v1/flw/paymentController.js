const prisma = require('@/lib/prisma');
const paymentProvider = require('@/services/paymentProvider');
const { encrypt } = require('@/lib/crypto');
const { TransactionType, TransactionStatus } = require('@prisma/client');

/**
 * Start Gateway Funding (Standard Checkout)
 */
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
 * Verify BVN and Generate Dedicated Virtual Account
 * Logic: Avoids standalone KYC fees by comparing manual input with VA response data.
 */
const verifyBvnAndCreateAccount = async (req, res) => {
    const { bvn, firstName, lastName } = req.body;
    const userId = req.user.id;

    // 1. Basic Validation
    if (!bvn || bvn.length !== 11) {
        return res.status(400).json({ status: "ERROR", message: "A valid 11-digit BVN is required" });
    }
    if (!firstName || !lastName) {
        return res.status(400).json({ status: "ERROR", message: "Please provide your first and last names as they appear on your BVN" });
    }

    try {
        const user = await prisma.user.findUnique({ 
            where: { id: userId },
            include: { kycData: true }
        });

        if (!user) return res.status(404).json({ status: "ERROR", message: "User not found" });
        if (user.isKycVerified) return res.status(400).json({ status: "ERROR", message: "Account already verified" });

        // 2. Provider Call (Virtual Account Generation)
        // FLW internally validates BVN vs Names provided. If mismatch is too high, it throws 400.
        const flwAccount = await paymentProvider.createVirtualAccount({
            email: user.email,
            bvn: bvn,
            phoneNumber: user.phoneNumber,
            fullName: `${firstName} ${lastName}`,
            userId: userId
        });

        // 3. Manual Comparison Logic (Double-Check)
        // Extract legal names returned by the bank/FLW response
        const returnedFirstName = (flwAccount.firstname || "").toUpperCase().trim();
        const returnedLastName = (flwAccount.lastname || "").toUpperCase().trim();
        const inputFirstName = firstName.toUpperCase().trim();
        const inputLastName = lastName.toUpperCase().trim();

        // /**
        //  * BUILDER STRATEGY: 
        //  * Instead of an exact string match (which fails on middle names), 
        //  * we check if the input names are contained within the returned legal names.
        //  */
        const isMatch = returnedFirstName.includes(inputFirstName) && returnedLastName.includes(inputLastName);

        if (!isMatch) {
            return res.status(400).json({
                status: "ERROR",
                message: "Identity mismatch. The names provided do not match the BVN record.",
                details: `Expected names related to ${returnedFirstName} ${returnedLastName}`
            });
        }

        const legalFullName = `${returnedFirstName} ${returnedLastName}`;
        const encryptedBvn = encrypt(bvn);

        // 4. Atomic Database Update
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
                data: { 
                    isKycVerified: true,
                    fullName: legalFullName // Overwrite with verified legal name
                } 
            })
        ]);

        res.status(200).json({ 
            status: "OK", 
            message: "KYC Verified and Virtual Account generated", 
            data: {
                legalName: legalFullName,
                bank: flwAccount.bank_name,
                accountNumber: flwAccount.account_number,
                accountName: `Data Padi - ${legalFullName}`
            } 
        });
    } catch (error) {
        const errorMessage = error.response?.data?.message || "BVN verification failed";
        const statusCode = error.response?.status || 500;
        
        return res.status(statusCode).json({ 
            status: "ERROR", 
            message: errorMessage,
            suggestion: "Please ensure your names match your BVN record exactly."
        });
    }
};

module.exports = { initGatewayFunding, verifyBvnAndCreateAccount };