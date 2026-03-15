const jwt = require('jsonwebtoken');
const prisma = require('@/lib/prisma');
const { trackEvent } = require('@/lib/analytics');


if (!process.env.JWT_SECRET) {
    console.error("FATAL: JWT_SECRET env var is not set");
    process.exit(1);
}


// Use the same secret key as your login logic
const JWT_SECRET = process.env.JWT_SECRET;



/**
 * Middleware to protect routes and manage "server sessions"
 * verified user data is attached to req.user
 */
const authMiddleware = async (req, res, next) => {
    try {
        // 1. Get token from header (Expected format: Bearer <token>)
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                status: "ERROR",
                message: "Access denied. No token provided."
            });
        }

        const token = authHeader.split(' ')[1];

        // 2. Verify and Decrypt the Token
        // This confirms the token was signed by your server and hasn't expired
        const decoded = jwt.verify(token, JWT_SECRET);

        // 3. Optional: Verify User still exists in DB
        // Check if token belongs to Staff or User
        if (decoded.isStaff) {
            const staff = await prisma.staff.findUnique({
                where: { id: decoded.userId },
                select: {
                    id: true,
                    email: true,
                    role: true,
                    isActive: true,
                    requiresPasswordChange: true
                }
            });

            if (!staff || !staff.isActive) {
                return res.status(401).json({
                    status: "ERROR",
                    message: "Session invalid. Staff account is inactive or deleted."
                });
            }

            req.user = { ...staff, isStaff: true };
        } else {
            const user = await prisma.user.findUnique({
                where: { id: decoded.userId },
                select: {
                    id: true,
                    email: true,
                    tier: true,
                    isKycVerified: true
                }
            });

            if (!user) {
                return res.status(401).json({
                    status: "ERROR",
                    message: "Session invalid. User no longer exists."
                });
            }

            req.user = { ...user, isStaff: false };
        }

        // PERFORMANCE ANALYTICS: Track route access
        trackEvent(req, 'Route Access');

        next(); // Move to the actual route handler
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                status: "ERROR",
                message: "Session expired. Please login again."
            });
        }

        if (error.name === 'JsonWebTokenError' || error.name === 'NotBeforeError') {
            return res.status(403).json({
                status: "ERROR",
                message: "Invalid or inactive session token."
            });
        }

        // --- RESILIENCE FIX: Don't logout on DB/System errors ---
        console.error("[Auth Middleware Error]:", error.message);
        return res.status(503).json({
            status: "ERROR",
            message: "System busy or database unreachable. Please try again in a moment."
        });
    }
};

/**
 * Standalone Middleware for ADMIN tier users
 */
const authorizeAdmin = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ status: "ERROR", message: "Access denied." });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);

        if (decoded.isStaff) {
            return res.status(403).json({ status: "ERROR", message: "User privileges required." });
        }

        const user = await prisma.user.findUnique({
            where: { id: decoded.userId },
            select: { id: true, tier: true }
        });

        if (user && user.tier === 'ADMIN') {
            req.user = { ...user, isStaff: false };
            next();
        } else {
            return res.status(403).json({ status: "ERROR", message: "Administrative privileges required." });
        }
    } catch (error) {
        return res.status(403).json({ status: "ERROR", message: "Invalid or expired token." });
    }
};

/**
 * Standalone Middleware for Staff (TICKETING_OFFICER or SUPER_ADMIN)
 * Handles both authentication and role verification
 */
const requireTicketStaff = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        console.log("Auth Header:", authHeader);
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            console.error("401 Check: Missing or malformed Auth Header. Header received:", authHeader);
            return res.status(401).json({ status: "ERROR", message: "Access denied. No token provided." });
        }

        const token = authHeader.split(' ')[1];
        const effectiveSecret = JWT_SECRET || process.env.JWT_SECRET;
        console.log("401 Check: Using Secret (prefix):", effectiveSecret ? effectiveSecret.substring(0, 10) : "MISSING");

        const decoded = jwt.verify(token, effectiveSecret);
        console.log("401 Check: Decoded Payload:", decoded);

        if (!decoded.isStaff) {
            return res.status(403).json({ status: "ERROR", message: "Access restricted. Staff authentication required." });
        }

        const staff = await prisma.staff.findUnique({
            where: { id: decoded.userId },
            select: { id: true, email: true, role: true, isActive: true }
        });

        if (!staff || !staff.isActive) {
            console.error("401 Check: Staff not found or inactive. UserID from token:", decoded.userId, "Staff object:", staff);
            return res.status(401).json({ status: "ERROR", message: "Staff account is inactive or deleted." });
        }

        if (staff.role === 'TICKETING_OFFICER' || staff.role === 'SUPER_ADMIN') {
            req.user = { ...staff, isStaff: true };
            next();
        } else {
            return res.status(403).json({ status: "ERROR", message: "Access restricted. Ticketing Staff privileges required." });
        }
    } catch (error) {
        return res.status(error.name === 'TokenExpiredError' ? 401 : 403).json({
            status: "ERROR",
            message: error.name === 'TokenExpiredError' ? "Session expired." : "Invalid or tampered token."
        });
    }
};

/**
 * Standalone Middleware for Staff (SUPER_ADMIN only)
 */
const requireSuperAdmin = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ status: "ERROR", message: "Access denied." });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);

        if (!decoded.isStaff) {
            return res.status(403).json({ status: "ERROR", message: "Staff privileges required." });
        }

        const staff = await prisma.staff.findUnique({
            where: { id: decoded.userId },
            select: { id: true, role: true, isActive: true }
        });

        if (staff && staff.isActive && staff.role === 'SUPER_ADMIN') {
            req.user = { ...staff, isStaff: true };
            next();
        } else {
            return res.status(403).json({ status: "ERROR", message: "Super Admin privileges required." });
        }
    } catch (error) {
        return res.status(403).json({ status: "ERROR", message: "Invalid or expired token." });
    }
};

module.exports = { authMiddleware, authorizeAdmin, requireTicketStaff, requireSuperAdmin };