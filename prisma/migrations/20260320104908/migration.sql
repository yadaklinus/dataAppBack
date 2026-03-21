/*
  Warnings:

  - A unique constraint covering the columns `[idempotencyKey]` on the table `Transaction` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "idempotencyKey" TEXT;

-- CreateTable
CREATE TABLE "NetworkPlan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "logoUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NetworkPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataPlan" (
    "id" TEXT NOT NULL,
    "networkId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productCode" TEXT NOT NULL,
    "rawName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "planType" TEXT NOT NULL,
    "validity" TEXT NOT NULL,
    "costPrice" DECIMAL(15,2) NOT NULL,
    "userPrice" DECIMAL(15,2) NOT NULL,
    "resellerPrice" DECIMAL(15,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isBestValue" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NetworkPlan_name_key" ON "NetworkPlan"("name");

-- CreateIndex
CREATE UNIQUE INDEX "NetworkPlan_externalId_key" ON "NetworkPlan"("externalId");

-- CreateIndex
CREATE INDEX "NetworkPlan_externalId_idx" ON "NetworkPlan"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "DataPlan_productId_key" ON "DataPlan"("productId");

-- CreateIndex
CREATE INDEX "DataPlan_networkId_idx" ON "DataPlan"("networkId");

-- CreateIndex
CREATE INDEX "DataPlan_productId_idx" ON "DataPlan"("productId");

-- CreateIndex
CREATE INDEX "FlightBookingRequest_status_createdAt_idx" ON "FlightBookingRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "FlightBookingRequest_createdAt_idx" ON "FlightBookingRequest"("createdAt");

-- CreateIndex
CREATE INDEX "FlightRequestActivity_requestId_idx" ON "FlightRequestActivity"("requestId");

-- CreateIndex
CREATE INDEX "FlightTransaction_walletId_idx" ON "FlightTransaction"("walletId");

-- CreateIndex
CREATE INDEX "KycData_status_idx" ON "KycData"("status");

-- CreateIndex
CREATE INDEX "Passenger_flightRequestId_idx" ON "Passenger"("flightRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_idempotencyKey_key" ON "Transaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Transaction_status_type_idx" ON "Transaction"("status", "type");

-- CreateIndex
CREATE INDEX "Transaction_createdAt_idx" ON "Transaction"("createdAt");

-- CreateIndex
CREATE INDEX "Transaction_userId_createdAt_idx" ON "Transaction"("userId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "DataPlan" ADD CONSTRAINT "DataPlan_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "NetworkPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
