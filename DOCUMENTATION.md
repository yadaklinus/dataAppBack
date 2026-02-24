# Data Padi Backend Documentation

Welcome to the official documentation for the **Data Padi Backend**. This is a high-performance, secure Node.js API designed for digital services like Airtime, Data, Utility bills, and Unified Payment processing.

---

## 🏗️ Architecture Overview

The system is built with a decoupled architecture focusing on security, scalability, and provider abstraction.

### Tech Stack
- **Runtime**: Node.js
- **Framework**: Express (with TypeScript support)
- **Database**: PostgreSQL
- **ORM**: Prisma
- **Validation**: Zod (Schema-based)
- **Security**: JWT (Access/Refresh Tokens), bcrypt (Password Hashing)

### System Flow
```mermaid
graph TD
    A[Client App] --> B[Express Server]
    B --> C{Auth Middleware}
    C -- Valid --> D[Controller Logic]
    C -- Invalid --> E[401/403 Error]
    D --> F[Service Provider]
    D --> G[Prisma / Database]
    F --> H[External APIs (Nellobyte, Monnify, FLW)]
```

---

## 🔐 Security & Authentication

Data Padi uses a multi-layered security approach.

### 1. Dual-Token System
We implement **Access Tokens** (15m expiry) and **Refresh Tokens** (7d expiry). 
- **Token Rotation**: Every time a refresh token is used, it is revoked and a new pair is issued. This detects session hijacking instantly.
- **Revocation**: Users can be logged out from all devices by revoking tokens in the DB.

### 2. Brute-Force Protection
- **Account Lockout**: After 5 failed login attempts, the server locks the account for 15 minutes.
- **Timing Attack Mitigation**: Uses "dummy" password hashes to ensure valid and invalid emails take the same time to process.

### 3. Password Policy
- Minimum 8 characters.
- Must include: Upper, Lower, Numbers, and Special Characters.

---

## 💳 Unified Payment Gateway

The system features a **Switchable Gateway** architecture.

### Global Configuration
Toggle between providers in your `.env` without touching your code:
```bash
ACTIVE_PAYMENT_GATEWAY=MONNIFY # or FLUTTERWAVE
```

### Unified Endpoints
The frontend only needs to know one set of routes:
- `POST /api/v1/payment/fund/init`: Initializes wallet funding.
- `POST /api/v1/payment/kyc/create`: Verifies BVN and creates dedicated accounts.

---

## 🚦 API Reference

All requests must include the `Authorization: Bearer <token>` header (except public routes).

### 🔑 Authentication
| Endpoint | Method | Params | Description |
| --- | --- | --- | --- |
| `/auth/register` | POST | `userName, email, password, phoneNumber` | Creates a new user |
| `/auth/login` | POST | `email, password` | Returns tokens & user info |
| `/auth/refresh` | POST | `refreshToken` | Rotates session tokens |
| `/auth/logout` | POST | `refreshToken` | Revokes a session |

### 👤 User & Dashboard
| Endpoint | Method | Description |
| --- | --- | --- |
| `/user/profile` | GET | Returns profile, KYC status, and balance |
| `/user/dashboard` | GET | Returns balance, statistics, and recent txns |
| `/user/transactions` | GET | Paginated transaction history |

### ⚡ Utility Services
- **Data/Airtime**: Specialized routes under `/api/v1/vtu`.
- **Electricity**: Meter verification and token purchase under `/api/v1/electricity`.
- **Cable TV**: Smartcard verification and subscription under `/api/v1/cable`.
- **Education**: WAEC/JAMB PINs under `/api/v1/education`.

---

## ⚙️ Environment Configuration

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | Prisma/PostgreSQL connection string |
| `JWT_SECRET` | Secret for signing tokens |
| `ENCRYPTION_KEY` | 32-byte key for encrypting sensitive user data (BVN) |
| `ACTIVE_PAYMENT_GATEWAY` | `MONNIFY` or `FLUTTERWAVE` |
| `NELLOBYTE_API_KEY` | Provider key for VTU services |

---

## 📦 Database Schema

The database consists of the following core models:
- **User**: Stores profiles, security state, and tiers.
- **Wallet**: Handles balances, commissions, and spending tracking.
- **Transaction**: Unified ledger for all purchases and funding events.
- **RefreshToken**: Secure storage for active sessions.
- **KycData**: Encrypted storage for verification details and virtual accounts.

---

## 🚀 Deployment

1. **Install Dependencies**: `npm install`
2. **Setup DB**: `npx prisma migrate dev` / `npx prisma generate`
3. **Build**: `npm run build`
4. **Start**: `npm run start`

---

> [!TIP]
> **Converting to PDF**:
> To convert this document to a professional PDF:
> 1. Open this file in **VS Code**.
> 2. Search for the extension ** "Markdown PDF"**.
> 3. Right-click and choose ** "Markdown PDF: Export (pdf)"**.
