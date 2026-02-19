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
 * Verify BVN and Generate Dedicated (Reserved) Virtual Account
 * Logic: Checks if user already has an account before calling Flutterwave.
 */
const verifyBvnAndCreateAccount = async (req, res) => {
    const { bvn, firstName, lastName } = req.body;
    const userId = req.user.id;

    if (!bvn || bvn.length !== 11) {
        return res.status(400).json({ status: "ERROR", message: "A valid 11-digit BVN is required" });
    }
    if (!firstName || !lastName) {
        return res.status(400).json({ status: "ERROR", message: "First and Last names are required" });
    }

    try {
        const user = await prisma.user.findUnique({ 
            where: { id: userId },
            include: { kycData: true }
        });

        if (!user) return res.status(404).json({ status: "ERROR", message: "User not found" });

        // --- BUILDER CHECK: PREVENT DUPLICATE ACCOUNTS ---
        // If the user already has a virtual account number, don't call FLW again.
        if (user.kycData?.virtualAccountNumber) {
            return res.status(200).json({ 
                status: "OK", 
                message: "User already has a dedicated account.", 
                data: {
                    bank: user.kycData.bankName,
                    accountNumber: user.kycData.virtualAccountNumber,
                    accountName: `Data Padi - ${user.fullName}`
                } 
            });
        }

        // 1. Call Flutterwave
        const flwAccount = await paymentProvider.createVirtualAccount({
            email: user.email,
            bvn: bvn,
            phoneNumber: user.phoneNumber,
            fullName: `${firstName} ${lastName}`,
            userId: userId
        });

        // 2. SMART NAME MATCHING
        const returnedFirst = (flwAccount.firstname || "").toUpperCase().trim();
        const returnedLast = (flwAccount.lastname || "").toUpperCase().trim();
        const flwNote = (flwAccount.note || "").toUpperCase().trim();
        
        const searchPool = `${returnedFirst} ${returnedLast} ${flwNote}`;
        const inputFirst = firstName.toUpperCase().trim();
        const inputLast = lastName.toUpperCase().trim();

        const isMatch = searchPool.includes(inputFirst) && searchPool.includes(inputLast);

        if (!isMatch) {
            return res.status(400).json({
                status: "ERROR",
                message: "Identity mismatch. Names do not match the bank record.",
                details: `Bank response note: ${flwAccount.note}`
            });
        }

        // 3. Extract Legal Name
        let legalFullName = `${firstName} ${lastName}`.toUpperCase();
        if (flwAccount.note) {
            const noteUpper = flwAccount.note.toUpperCase();
            const startIdx = noteUpper.indexOf("DATA PADI");
            const endIdx = noteUpper.lastIndexOf("FLW");
            
            if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
                legalFullName = noteUpper.substring(startIdx + 9, endIdx).trim();
            }
        }

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
                    fullName: legalFullName 
                } 
            })
        ]);

        res.status(200).json({ 
            status: "OK", 
            message: "Reserved account created successfully", 
            data: {
                bank: flwAccount.bank_name,
                accountNumber: flwAccount.account_number,
                accountName: `Data Padi - ${legalFullName}`
            } 
        });
    } catch (error) {
        const flwError = error.response?.data?.message || error.message;
        console.error("FLW Reserved Account Error:", flwError);

        return res.status(error.response?.status || 500).json({ 
            status: "ERROR", 
            message: flwError
        });
    }
};

module.exports = { initGatewayFunding, verifyBvnAndCreateAccount };