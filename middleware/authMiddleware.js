const jwt = require('jsonwebtoken');
const prisma = require('@/lib/prisma');


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
        // This acts as a "Server Session" check to ensure the account wasn't deleted
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

        // 4. Attach user info to the request object
        // Now any route using this middleware can access req.user
        req.user = user;

        next(); // Move to the actual route handler
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                status: "ERROR",
                message: "Session expired. Please login again."
            });
        }

        return res.status(403).json({
            status: "ERROR",
            message: "Invalid or tampered token."
        });
    }
};

/**
 * Middleware to restrict access to ADMIN only
 */
const authorizeAdmin = (req, res, next) => {
    if (req.user && req.user.tier === 'ADMIN') {
        next();
    } else {
        return res.status(403).json({
            status: "ERROR",
            message: "Access restricted. Administrative privileges required."
        });
    }
};

module.exports = { authMiddleware, authorizeAdmin };