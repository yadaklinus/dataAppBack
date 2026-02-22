const bcrypt = require('bcrypt');
const prisma = require('@/lib/prisma');
const SALT_ROUNDS = 12;
const validator = require('validator');


const register = async (req, res) => {
    try {
        const { userName, password, phoneNumber } = req.body;
        const email = req.body.email.toLowerCase().trim();

        // 1. Basic Validation
        if (!email || !password || !phoneNumber) {
            return res.status(400).json({ 
                status: "ERROR", 
                message: "Email, password, and phone number are required" 
            });
        }

        if (!password || password.length < 8) {
            return res.status(400).json({
                status: "ERROR",
                message: "Password must be at least 8 characters long"
            });
        }

        if (!validator.isEmail(email)) {
            return res.status(400).json({ status:"ERROR", message:"Invalid email format" });
        }



        // 2. Uniqueness Check (Email and Phone)
        const existingUser = await prisma.user.findFirst({
            where: {
                OR: [{ email }, { phoneNumber }]
            }
        });

        if (existingUser) {
            return res.status(409).json({ 
                status: "ERROR", 
                message: "A user with this email or phone number already exists" 
            });
        }

        // 3. Secure Password Hashing
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

        // 4. Atomic Database Creation
        // We initialize the Wallet (for balance) and KycData (for future Virtual Account)
        const newUser = await prisma.user.create({
            data: {
                fullName: userName,
                email,
                phoneNumber,
                passwordHash: hashedPassword,
                // Every user gets a wallet regardless of verification
                wallet: {
                    create: {
                        balance: 0.00,
                        bonusBalance: 0.00,
                        totalSpent: 0.00
                    }
                },
                // KycData stores the Virtual Account details once verified
                kycData: {
                    create: {
                        status: 'PENDING',
                        // These will be populated after BVN/NIN verification
                        virtualAccountNumber: null,
                        bankName: null,
                        accountReference: null
                    }
                }
            },
            include: {
                wallet: true,
                kycData: true
            }
        });

        // 5. Success Response
        res.status(201).json({
            status: "OK",
            message: "Registration successful. Complete KYC to get a dedicated bank account.",
            user: {
                id: newUser.id,
                fullName: newUser.fullName,
                email: newUser.email,
                phoneNumber: newUser.phoneNumber,
                tier: newUser.tier,
                walletBalance: newUser.wallet.balance,
                kycStatus: newUser.kycData.status
            }
        });

    } catch (error) {
        console.error("Registration Error:", error);
        res.status(500).json({ 
            status: "ERROR", 
            message: "An internal error occurred during registration" 
        });
    }
}

module.exports = register;