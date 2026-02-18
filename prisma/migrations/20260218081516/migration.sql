/*
  Warnings:

  - You are about to drop the column `bvnHash` on the `KycData` table. All the data in the column will be lost.
  - You are about to drop the column `ninNumber` on the `KycData` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "KycData_ninNumber_key";

-- AlterTable
ALTER TABLE "KycData" DROP COLUMN "bvnHash",
DROP COLUMN "ninNumber",
ADD COLUMN     "encryptedBvn" TEXT;
