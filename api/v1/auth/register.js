const { z } = require('zod');
const bcrypt = require('bcrypt');
const prisma = require('@/lib/prisma');
const SALT_ROUNDS = 12;

const registerSchema = z.object({
    userName: z.string().min(3, "Username must be at least 3 characters long").max(50),
    email: z.string().email("Invalid email format").toLowerCase().trim(),
    phoneNumber: z.string().regex(/^(\+234|0)[789][01]\d{8}$/, "Invalid Nigerian phone number"),
    password: z.string()
        .min(8, "Password must be at least 8 characters long")
        .regex(/[a-z]/, "Password must contain at least one lowercase letter")
        .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
        .regex(/[0-9]/, "Password must contain at least one number")
        .regex(/[^a-zA-Z0-9]/, "Password must contain at least one special character")
});

const formatZodError = (error) => {
    return error.issues.map(err => err.message).join(", ");
};

const register = async (req, res) => {
    try {
        const validation = registerSchema.safeParse(req.body);

        if (!validation.success) {
            return res.status(400).json({
                status: "ERROR",
                message: formatZodError(validation.error)
            });
        }

        const { userName, email, phoneNumber, password } = validation.data;

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
        const newUser = await prisma.user.create({
            data: {
                fullName: userName,
                email,
                phoneNumber,
                passwordHash: hashedPassword,
                wallet: {
                    create: {
                        balance: 0.00,
                        bonusBalance: 0.00,
                        totalSpent: 0.00
                    }
                },
                kycData: {
                    create: {
                        status: 'PENDING',
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
