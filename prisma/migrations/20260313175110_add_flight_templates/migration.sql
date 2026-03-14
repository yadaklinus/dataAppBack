-- CreateTable
CREATE TABLE "SavedFlightTemplate" (
    "id" TEXT NOT NULL,
    "airlineName" TEXT NOT NULL,
    "flightNumber" TEXT,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "flightDate" TIMESTAMP(3),
    "departureTime" TEXT,
    "arrivalTime" TEXT,
    "flightClass" TEXT NOT NULL,
    "basePrice" DECIMAL(15,2) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedFlightTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavedFlightTemplate_origin_destination_idx" ON "SavedFlightTemplate"("origin", "destination");
