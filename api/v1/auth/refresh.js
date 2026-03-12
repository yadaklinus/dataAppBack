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
            include: { user: { select: { id: true, email: true, tier: true } } }
        });

        // 2. Validate Token Existence
        if (!storedToken) {
            return res.status(401).json({ status: "ERROR", message: "Invalid refresh token" });
        }

        // 3. Check for Expiration
        if (storedToken.expiresAt < new Date()) {
            return res.status(401).json({ status: "ERROR", message: "Refresh token expired" });
        }

        // 4. Token Rotation Race Condition Handling (Grace Period)
        if (storedToken.revoked) {
            const gracePeriodMs = 60 * 1000; // Increased to 60 seconds
            const now = new Date();
            const updatedAt = new Date(storedToken.updatedAt);
            const diffMs = now - updatedAt;
            const revokedRecently = diffMs < gracePeriodMs;

            if (!revokedRecently) {
                console.warn(`[Refresh] Revoked token reuse attempt. User: ${storedToken.userId}, TokenSuffix: ...${refreshToken.slice(-8)}, RevokedAt: ${updatedAt.toISOString()}, Now: ${now.toISOString()}, Diff: ${diffMs}ms`);
                return res.status(401).json({ status: "ERROR", message: "Session invalid or expired" });
            }
            // If revoked recently, we allow the refresh to proceed to handle concurrent requests
            console.log(`[Refresh] Grace period refresh for user ${storedToken.userId}. Diff: ${diffMs}ms`);
        }

        const user = storedToken.user;
        if (!user) {
            return res.status(401).json({ status: "ERROR", message: "User session no longer valid" });
        }

        // 5. Revoke the old token (if not already revoked during grace period)
        if (!storedToken.revoked) {
            await prisma.refreshToken.update({
                where: { id: storedToken.id },
                data: { revoked: true }
            });
        }

        // 6. Generate new Access Token
        const newAccessToken = jwt.sign(
            { userId: user.id, email: user.email, tier: user.tier },
            JWT_SECRET,
            { expiresIn: ACCESS_TOKEN_EXPIRY }
        );

        // 7. Generate new Refresh Token
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
        console.error("Refresh Error:", error.stack || error.message);

        // Handle database timeouts or pool exhaustion gracefully
        const isDbError = error.message.includes('Prisma') ||
            error.message.includes('Pool') ||
            error.message.includes('timeout') ||
            error.code?.startsWith('P');

        if (isDbError) {
            return res.status(503).json({ status: "ERROR", message: "System busy. Please retry in a moment." });
        }

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
