"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("module-alias/register");
const express_1 = __importDefault(require("express"));
const dotenv_1 = __importDefault(require("dotenv"));
// Import your routers (ensure these files are also converted to .ts)
const authRoutes_1 = __importDefault(require("@/routes/authRoutes"));
const userRoutes_1 = __importDefault(require("@/routes/userRoutes"));
const vtuRoutes_1 = __importDefault(require("@/routes/vtuRoutes"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = Number(process.env.PORT) || 3009;
// Middleware
app.use(express_1.default.json());
app.get("/", (req, res) => {
    res.json("work");
});
// Routes
app.use("/api/v1/auth", authRoutes_1.default);
app.use("/api/v1/user", userRoutes_1.default);
app.use("/api/v1/vtu", vtuRoutes_1.default);
app.listen(PORT, () => {
    console.log(`Running on port ${PORT}`);
});
