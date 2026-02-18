const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const prisma = require('@/lib/prisma');

// Use a strong secret from your .env file
const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_key_123';
const TOKEN_EXPIRY = '24h';

const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        // 1. Basic Validation
        if (!email || !password) {
            return res.status(400).json({
                status: "ERROR",
                message: "Email and password are required"
            });
        }

        // 2. Check if user exists
        const user = await prisma.user.findUnique({
            where: { email },
            include: { kycData: true } // Including KYC in case you need it on the frontend
        });

        if (!user) {
            return res.status(401).json({
                status: "ERROR",
                message: "Invalid credentials"
            });
        }

        // 3. Verify Password
        const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
        if (!isPasswordValid) {
            return res.status(401).json({
                status: "ERROR",
                message: "Invalid credentials"
            });
        }

        // 4. Generate JWT
        // We only put non-sensitive data in the payload
        const token = jwt.sign(
            { 
                userId: user.id, 
                email: user.email, 
                tier: user.tier 
            },
            JWT_SECRET,
            { expiresIn: TOKEN_EXPIRY }
        );

        // 5. Success Response
        return res.status(200).json({
            status: "OK",
            message: "Login successful",
            token,
            user: {
                id: user.id,
                userName: user.fullName,
                email: user.email,
                tier: user.tier,
                isKycVerified: user.isKycVerified
            }
        });

    } catch (error) {
        console.error("Login Error:", error);
        return res.status(500).json({
            status: "ERROR",
            message: "Internal server error"
        });
    }
};

module.exports = login;