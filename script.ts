import 'module-alias/register';
import express, { Request, Response, NextFunction, Application } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
const statusMonitor = require('express-status-monitor');
import { startTransactionSync } from '@/jobs/transactionSync';
import { validateEnv } from '@/lib/validateEnv';

// Routes
import authRouterV1 from '@/routes/authRoutes';
import userRouterV1 from '@/routes/userRoutes';
import vtuRouterV1 from '@/routes/vtuRoutes';
import flwRouterV1 from '@/routes/flutterwaveRoutes';
import monifyRouterV1 from '@/routes/monnifyRoutes';
import electricityRouterV1 from '@/routes/electricityRoutes';
import cableRouterV1 from '@/routes/cableRoutes';
import educationRouterV1 from '@/routes/educationRoutes';
import paymentRouterV1 from '@/routes/paymentRoutes';
import adminRouterV1 from '@/routes/adminRoutes';
import { startMonnifyTransactionSync } from './jobs/monnifyTransactionSync';

dotenv.config();

// 1. Validate Environment variables before doing anything else
validateEnv();

const app: Application = express();
const PORT: number = Number(process.env.PORT) || 3009;

// 2. Trust Proxy - CRITICAL for Rate Limiting to work behind Nginx/Heroku/Render
// This ensures req.ip is the user's IP, not the server's IP.
app.set('trust proxy', 1);

// 3. Security & Cross-Origin
app.use(statusMonitor()); // Real-time dashboard at /status
app.use(morgan('dev')); // Structured request logging
app.use(helmet());
app.use(cors({
    origin: process.env.NODE_ENV === 'production' ? ['https://yourdomain.com'] : '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
}));

// 4. Rate Limiting
const globalLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 100, // limit each IP to 100 requests per windowMs
    message: { status: "ERROR", message: "Too many requests. Please slow down." }
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 attempts
    message: { status: "ERROR", message: "Too many login/register attempts. Try again in 15 minutes." },
    standardHeaders: true,
    legacyHeaders: false,
});

// 5. Body Parsing
app.use(express.json({ limit: '10kb' })); // Protection against large JSON payloads
app.use(express.urlencoded({ extended: false, limit: '10kb' }));

// 6. Global Middlewares
app.use(globalLimiter);

// 7. Health Check
app.get("/", (req: Request, res: Response) => {
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
app.use("/api/v1/auth", authLimiter, authRouterV1);
app.use("/api/v1/user", userRouterV1);
app.use("/api/v1/vtu", vtuRouterV1);
app.use("/api/v1/flw", flwRouterV1);
app.use("/api/v1/monnify", monifyRouterV1);
app.use("/api/v1/electricity", electricityRouterV1);
app.use("/api/v1/cable", cableRouterV1);
app.use("/api/v1/education", educationRouterV1);
app.use("/api/v1/payment", paymentRouterV1);
app.use("/api/v1/admin", adminRouterV1);

// 9. Global Error Handling Middleware (Builder Tip: Never let the server crash)
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
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
startTransactionSync();
startMonnifyTransactionSync();

app.listen(PORT, () => {
    console.log(`[Server] Data Padi running on port ${PORT}`);
    console.log(`[System] Background Transaction Sync Active.`);
});