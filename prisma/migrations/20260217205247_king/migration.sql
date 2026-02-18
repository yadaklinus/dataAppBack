-- CreateEnum
CREATE TYPE "UserTier" AS ENUM ('SMART_USER', 'RESELLER', 'API_PARTNER');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('DATA', 'AIRTIME', 'RECHARGE_PIN', 'CABLE_TV', 'ELECTRICITY', 'WALLET_FUNDING');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "Network" AS ENUM ('MTN', 'GLO', 'AIRTEL', 'NINE_MOBILE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "fullName" TEXT,
    "email" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "walletBalance" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "tier" "UserTier" NOT NULL DEFAULT 'SMART_USER',
    "isKycVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycData" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bvnHash" TEXT,
    "ninNumber" TEXT,
    "virtualAccountNumber" TEXT,
    "bankName" TEXT,
    "accountReference" TEXT,
    "status" "KycStatus" NOT NULL DEFAULT 'PENDING',
    "verifiedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycData_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "fee" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "type" "TransactionType" NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "reference" TEXT NOT NULL,
    "providerReference" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RechargePin" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT,
    "network" "Network" NOT NULL,
    "denomination" INTEGER NOT NULL,
    "pinCode" TEXT NOT NULL,
    "serialNumber" TEXT,
    "batchNumber" TEXT,
    "isSold" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "soldAt" TIMESTAMP(3),

    CONSTRAINT "RechargePin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_phoneNumber_key" ON "User"("phoneNumber");

-- CreateIndex
CREATE INDEX "User_email_phoneNumber_idx" ON "User"("email", "phoneNumber");

-- CreateIndex
CREATE UNIQUE INDEX "KycData_userId_key" ON "KycData"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "KycData_ninNumber_key" ON "KycData"("ninNumber");

-- CreateIndex
CREATE UNIQUE INDEX "KycData_virtualAccountNumber_key" ON "KycData"("virtualAccountNumber");

-- CreateIndex
CREATE UNIQUE INDEX "KycData_accountReference_key" ON "KycData"("accountReference");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_reference_key" ON "Transaction"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_providerReference_key" ON "Transaction"("providerReference");

-- CreateIndex
CREATE INDEX "Transaction_userId_status_type_idx" ON "Transaction"("userId", "status", "type");

-- CreateIndex
CREATE INDEX "RechargePin_network_denomination_isSold_idx" ON "RechargePin"("network", "denomination", "isSold");

-- AddForeignKey
ALTER TABLE "KycData" ADD CONSTRAINT "KycData_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RechargePin" ADD CONSTRAINT "RechargePin_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
