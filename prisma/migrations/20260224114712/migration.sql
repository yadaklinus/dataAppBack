-- AlterEnum
ALTER TYPE "UserTier" ADD VALUE 'ADMIN';

-- DropIndex
DROP INDEX "Transaction_userId_status_type_idx";

-- CreateIndex
CREATE INDEX "Transaction_userId_status_type_createdAt_idx" ON "Transaction"("userId", "status", "type", "createdAt");
