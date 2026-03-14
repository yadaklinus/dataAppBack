-- AlterTable
ALTER TABLE "FlightBookingRequest" ADD COLUMN     "arrivalTime" TEXT,
ADD COLUMN     "departureTime" TEXT,
ADD COLUMN     "legs" JSONB;
