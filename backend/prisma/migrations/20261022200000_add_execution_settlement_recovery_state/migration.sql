-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('PENDING', 'SETTLED', 'MANUAL_REVIEW');

-- AlterTable
ALTER TABLE "Execution"
  ADD COLUMN "settlementStatus" "SettlementStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastAttemptedAt" TIMESTAMP(3),
  ADD COLUMN "lastFailedAt" TIMESTAMP(3),
  ADD COLUMN "nextRetryAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "lastErrorCode" TEXT;

-- Backfill existing settled executions
UPDATE "Execution" e
SET "settlementStatus" = 'SETTLED'
WHERE EXISTS (
  SELECT 1 FROM "TradeSettlement" ts WHERE ts."executionId" = e.id
);

-- CreateIndex
CREATE INDEX "Execution_settlementStatus_nextRetryAt_sequenceNumber_idx"
  ON "Execution"("settlementStatus", "nextRetryAt", "sequenceNumber");
