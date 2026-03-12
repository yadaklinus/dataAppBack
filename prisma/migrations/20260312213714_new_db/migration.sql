-- CreateEnum
CREATE TYPE "TripType" AS ENUM ('ONE_WAY', 'ROUND_TRIP');

-- AlterTable
ALTER TABLE "FlightBookingRequest" ADD COLUMN     "returnDate" TIMESTAMP(3),
ADD COLUMN     "tripType" "TripType" NOT NULL DEFAULT 'ONE_WAY';

-- AlterTable
ALTER TABLE "PasswordResetOTP" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "RefreshToken" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
