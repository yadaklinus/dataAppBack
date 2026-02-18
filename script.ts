import 'module-alias/register';
import express, { Request, Response, Application } from 'express';
import dotenv from 'dotenv';

// Import your routers (ensure these files are also converted to .ts)
import authRouterV1 from '@/routes/authRoutes';
import userRouterV1 from '@/routes/userRoutes';
import vtuRouterV1 from '@/routes/vtuRoutes';
import flwRouterV1 from '@/routes/paymentRoutes';

dotenv.config();

const app: Application = express();
const PORT: number = Number(process.env.PORT) || 3009;

// Middleware
app.use(express.json());

app.get("/", (req: Request, res: Response) => {
    res.json("work");
});

// Routes
app.use("/api/v1/auth", authRouterV1);
app.use("/api/v1/user", userRouterV1);
app.use("/api/v1/vtu", vtuRouterV1);
app.use("/api/v1/flw", flwRouterV1);

app.listen(PORT, () => {
    console.log(`Running on port ${PORT}`);
});