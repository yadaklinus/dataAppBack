-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('TICKETING_OFFICER', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "FlightRequestStatus" AS ENUM ('FUTURE_HELD', 'OPTIONS_PROVIDED', 'SELECTION_MADE', 'QUOTED', 'EXPIRED', 'PAID_PROCESSING', 'TICKETED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "FlightTransactionType" AS ENUM ('PAYMENT', 'REFUND');

-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'FLIGHT_BOOKING';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "transactionPin" TEXT;

-- CreateTable
CREATE TABLE "Staff" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL DEFAULT 'TICKETING_OFFICER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "requiresPasswordChange" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlightBookingRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "targetDate" TIMESTAMP(3) NOT NULL,
    "flightClass" TEXT NOT NULL DEFAULT 'ECONOMY',
    "flightOptions" JSONB,
    "selectedOptionId" TEXT,
    "airlineName" TEXT,
    "pnr" TEXT,
    "ticketingTimeLimit" TIMESTAMP(3),
    "netCost" DECIMAL(15,2),
    "sellingPrice" DECIMAL(15,2),
    "eTicketUrl" TEXT,
    "status" "FlightRequestStatus" NOT NULL DEFAULT 'FUTURE_HELD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlightBookingRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Passenger" (
    "id" TEXT NOT NULL,
    "flightRequestId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3) NOT NULL,
    "gender" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Passenger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlightRequestActivity" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "userId" TEXT,
    "staffId" TEXT,
    "previousState" TEXT NOT NULL,
    "newState" TEXT NOT NULL,
    "actionDetails" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlightRequestActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlightTransaction" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "type" "FlightTransactionType" NOT NULL DEFAULT 'PAYMENT',
    "amount" DECIMAL(15,2) NOT NULL,
    "reference" TEXT NOT NULL,
    "flightRequestId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlightTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Staff_email_key" ON "Staff"("email");

-- CreateIndex
CREATE INDEX "FlightBookingRequest_userId_status_idx" ON "FlightBookingRequest"("userId", "status");

-- CreateIndex
CREATE INDEX "FlightBookingRequest_targetDate_idx" ON "FlightBookingRequest"("targetDate");

-- CreateIndex
CREATE UNIQUE INDEX "FlightTransaction_reference_key" ON "FlightTransaction"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "FlightTransaction_flightRequestId_key" ON "FlightTransaction"("flightRequestId");

-- AddForeignKey
ALTER TABLE "FlightBookingRequest" ADD CONSTRAINT "FlightBookingRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Passenger" ADD CONSTRAINT "Passenger_flightRequestId_fkey" FOREIGN KEY ("flightRequestId") REFERENCES "FlightBookingRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlightRequestActivity" ADD CONSTRAINT "FlightRequestActivity_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "FlightBookingRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlightRequestActivity" ADD CONSTRAINT "FlightRequestActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlightRequestActivity" ADD CONSTRAINT "FlightRequestActivity_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlightTransaction" ADD CONSTRAINT "FlightTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlightTransaction" ADD CONSTRAINT "FlightTransaction_flightRequestId_fkey" FOREIGN KEY ("flightRequestId") REFERENCES "FlightBookingRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
