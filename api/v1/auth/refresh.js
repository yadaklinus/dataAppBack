const jwt = require('jsonwebtoken');
const prisma = require('@/lib/prisma');
const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET;
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY_DAYS = 7;

/**
 * Handle Token Refresh
 * Supports Token Rotation for enhanced security
 */
const refresh = async (req, res) => {
    try {
        const { refreshToken } = req.body;

        if (!refreshToken) {
            return res.status(400).json({ status: "ERROR", message: "Refresh token is required" });
        }

        // 1. Find the token in the DB
        const storedToken = await prisma.refreshToken.findUnique({
            where: { token: refreshToken },
            include: { user: true }
        });

        // 2. Validate Token
        if (!storedToken || storedToken.revoked || storedToken.expiresAt < new Date()) {
            return res.status(401).json({ status: "ERROR", message: "Invalid or expired refresh token" });
        }

        const user = storedToken.user;

        // 3. Optional: Token Rotation logic
        // We revoke the old token and issue a new one
        await prisma.refreshToken.update({
            where: { id: storedToken.id },
            data: { revoked: true }
        });

        // Generate new Access Token
        const newAccessToken = jwt.sign(
            { userId: user.id, email: user.email, tier: user.tier },
            JWT_SECRET,
            { expiresIn: ACCESS_TOKEN_EXPIRY }
        );

        // Generate new Refresh Token
        const newRefreshTokenString = crypto.randomBytes(40).toString('hex');
        const newExpiresAt = new Date();
        newExpiresAt.setDate(newExpiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

        await prisma.refreshToken.create({
            data: {
                token: newRefreshTokenString,
                userId: user.id,
                expiresAt: newExpiresAt
            }
        });

        return res.status(200).json({
            status: "OK",
            accessToken: newAccessToken,
            refreshToken: newRefreshTokenString
        });

    } catch (error) {
        console.error("Refresh Error:", error);
        return res.status(500).json({ status: "ERROR", message: "Internal server error" });
    }
};

/**
 * Handle Logout (Revoke tokens)
 */
const logout = async (req, res) => {
    try {
        const { refreshToken } = req.body;

        if (refreshToken) {
            await prisma.refreshToken.updateMany({
                where: { token: refreshToken },
                data: { revoked: true }
            });
        }

        return res.status(200).json({ status: "OK", message: "Logged out successfully" });
    } catch (error) {
        return res.status(500).json({ status: "ERROR", message: "Logout failed" });
    }
};

module.exports = { refresh, logout };
