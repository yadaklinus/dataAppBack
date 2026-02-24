"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("module-alias/register");
const express_1 = __importDefault(require("express"));
const dotenv_1 = __importDefault(require("dotenv"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const morgan_1 = __importDefault(require("morgan"));
const statusMonitor = require('express-status-monitor');
const transactionSync_1 = require("@/jobs/transactionSync");
const validateEnv_1 = require("@/lib/validateEnv");
// Routes
const authRoutes_1 = __importDefault(require("@/routes/authRoutes"));
const userRoutes_1 = __importDefault(require("@/routes/userRoutes"));
const vtuRoutes_1 = __importDefault(require("@/routes/vtuRoutes"));
const flutterwaveRoutes_1 = __importDefault(require("@/routes/flutterwaveRoutes"));
const monnifyRoutes_1 = __importDefault(require("@/routes/monnifyRoutes"));
const electricityRoutes_1 = __importDefault(require("@/routes/electricityRoutes"));
const cableRoutes_1 = __importDefault(require("@/routes/cableRoutes"));
const educationRoutes_1 = __importDefault(require("@/routes/educationRoutes"));
const paymentRoutes_1 = __importDefault(require("@/routes/paymentRoutes"));
const adminRoutes_1 = __importDefault(require("@/routes/adminRoutes"));
const monnifyTransactionSync_1 = require("./jobs/monnifyTransactionSync");
dotenv_1.default.config();
// 1. Validate Environment variables before doing anything else
(0, validateEnv_1.validateEnv)();
const app = (0, express_1.default)();
const PORT = Number(process.env.PORT) || 3009;
// 2. Trust Proxy - CRITICAL for Rate Limiting to work behind Nginx/Heroku/Render
// This ensures req.ip is the user's IP, not the server's IP.
app.set('trust proxy', 1);
// 3. Security & Cross-Origin
app.use(statusMonitor()); // Real-time dashboard at /status
app.use((0, morgan_1.default)('dev')); // Structured request logging
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)({
    origin: process.env.NODE_ENV === 'production' ? ['https://yourdomain.com'] : '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
}));
// 4. Rate Limiting
const globalLimiter = (0, express_rate_limit_1.default)({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 100, // limit each IP to 100 requests per windowMs
    message: { status: "ERROR", message: "Too many requests. Please slow down." }
});
const authLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 attempts
    message: { status: "ERROR", message: "Too many login/register attempts. Try again in 15 minutes." },
    standardHeaders: true,
    legacyHeaders: false,
});
// 5. Body Parsing
app.use(express_1.default.json({ limit: '10kb' })); // Protection against large JSON payloads
app.use(express_1.default.urlencoded({ extended: false, limit: '10kb' }));
// 6. Global Middlewares
app.use(globalLimiter);
// 7. Health Check
app.get("/", (req, res) => {
    const memoryUsage = process.memoryUsage();
    res.json({
        status: "OK",
        service: "Data Padi API",
        version: "1.0.0",
        uptime: `${Math.floor(process.uptime())}s`,
        memory: {
            rss: `${Math.round(memoryUsage.rss / 1024 / 1024)} MB`,
            heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)} MB`,
            heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)} MB`
        }
    });
});
// 8. Routes
app.use("/api/v1/auth", authLimiter, authRoutes_1.default);
app.use("/api/v1/user", userRoutes_1.default);
app.use("/api/v1/vtu", vtuRoutes_1.default);
app.use("/api/v1/flw", flutterwaveRoutes_1.default);
app.use("/api/v1/monnify", monnifyRoutes_1.default);
app.use("/api/v1/electricity", electricityRoutes_1.default);
app.use("/api/v1/cable", cableRoutes_1.default);
app.use("/api/v1/education", educationRoutes_1.default);
app.use("/api/v1/payment", paymentRoutes_1.default);
app.use("/api/v1/admin", adminRoutes_1.default);
// 9. Global Error Handling Middleware (Builder Tip: Never let the server crash)
app.use((err, req, res, next) => {
    console.error(`[System Error] ${err.stack}`);
    // Handle Prisma specific errors if needed
    if (err.code === 'P2002') {
        return res.status(409).json({ status: "ERROR", message: "Unique constraint failed on database." });
    }
    res.status(err.status || 500).json({
        status: "ERROR",
        message: err.message || "An internal server error occurred."
    });
});
// 10. Start Background Services
// These are your safety net for failed webhooks and timeouts!
(0, transactionSync_1.startTransactionSync)();
(0, monnifyTransactionSync_1.startMonnifyTransactionSync)();
app.listen(PORT, () => {
    console.log(`[Server] Data Padi running on port ${PORT}`);
    console.log(`[System] Background Transaction Sync Active.`);
});
