"use strict";
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const prisma = require('@/lib/prisma');
const crypto = require('crypto');
const DUMMY_HASH = "$2b$12$invalidhashtopreventtimingattacksXXXXXXXXXXXXXXXXXX";
if (!process.env.JWT_SECRET) {
    console.error("FATAL: JWT_SECRET env var is not set");
    process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;
const ACCESS_TOKEN_EXPIRY = '15m'; // Short-lived
const REFRESH_TOKEN_EXPIRY_DAYS = 7;
const login = async (req, res) => {
    try {
        const { password } = req.body;
        const email = req.body.email?.toLowerCase().trim();
        if (!email || !password) {
            return res.status(400).json({ status: "ERROR", message: "Email and password are required" });
        }
        const user = await prisma.user.findUnique({
            where: { email },
            include: { kycData: true }
        });
        // 1. Brute-force Protection: Check Lockout
        if (user && user.lockoutUntil && user.lockoutUntil > new Date()) {
            const minutesLeft = Math.ceil((user.lockoutUntil - new Date()) / (60 * 1000));
            return res.status(423).json({
                status: "ERROR",
                message: `Account is temporarily locked. Try again in ${minutesLeft} minutes.`
            });
        }
        const hashToCompare = user ? user.passwordHash : DUMMY_HASH;
        const isPasswordValid = await bcrypt.compare(password, hashToCompare);
        if (!user || !isPasswordValid) {
            if (user) {
                // Increment failed attempts
                const newAttempts = user.failedLoginAttempts + 1;
                let lockoutUntil = null;
                if (newAttempts >= 5) {
                    lockoutUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 mins lockout
                }
                await prisma.user.update({
                    where: { id: user.id },
                    data: {
                        failedLoginAttempts: newAttempts,
                        lockoutUntil
                    }
                });
            }
            return res.status(401).json({
                status: "ERROR",
                message: "Invalid credentials"
            });
        }
        // 2. Clear failed attempts on success
        await prisma.user.update({
            where: { id: user.id },
            data: { failedLoginAttempts: 0, lockoutUntil: null }
        });
        // 3. Generate Tokens
        const accessToken = jwt.sign({ userId: user.id, email: user.email, tier: user.tier }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
        // Generate a random refresh token
        const refreshTokenString = crypto.randomBytes(40).toString('hex');
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);
        // 4. Save Refresh Token to DB
        await prisma.refreshToken.create({
            data: {
                token: refreshTokenString,
                userId: user.id,
                expiresAt
            }
        });
        return res.status(200).json({
            status: "OK",
            message: "Login successful",
            accessToken,
            refreshToken: refreshTokenString,
            user: {
                id: user.id,
                userName: user.fullName,
                email: user.email,
                tier: user.tier,
                isKycVerified: user.isKycVerified
            }
        });
    }
    catch (error) {
        console.error("Login Error:", error);
        return res.status(500).json({
            status: "ERROR",
            message: "Internal server error"
        });
    }
};
module.exports = login;
