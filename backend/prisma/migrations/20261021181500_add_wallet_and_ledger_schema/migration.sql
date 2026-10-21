-- CreateEnum
CREATE TYPE "HoldStatus" AS ENUM ('ACTIVE', 'PARTIALLY_SETTLED', 'SETTLED', 'RELEASED');

-- CreateEnum
CREATE TYPE "HoldReason" AS ENUM ('ORDER_ESCROW', 'WITHDRAWAL_ESCROW', 'ADMINISTRATIVE_HOLD');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('DEPOSIT', 'WITHDRAWAL_LOCK', 'WITHDRAWAL_SETTLED', 'WITHDRAWAL_REFUNDED', 'ORDER_HOLD', 'ORDER_RELEASE', 'TRADE_SETTLEMENT_DEBIT', 'TRADE_SETTLEMENT_CREDIT', 'FEE_DEBIT', 'COMPENSATING_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "FinancialOperationType" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'ORDER_ESCROW', 'ORDER_RELEASE', 'TRADE_SETTLEMENT', 'REFUND', 'COMPENSATING_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "FinancialOperationStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- DropIndex
DROP INDEX IF EXISTS "Order_sequenceNumber_idx";

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "availableBalance" BIGINT NOT NULL DEFAULT 0,
    "reservedBalance" BIGINT NOT NULL DEFAULT 0,
    "version" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialOperation" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "operationType" "FinancialOperationType" NOT NULL,
    "status" "FinancialOperationStatus" NOT NULL DEFAULT 'PENDING',
    "referenceType" TEXT,
    "referenceId" TEXT,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletHold" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "operationId" TEXT,
    "orderId" TEXT,
    "reason" "HoldReason" NOT NULL DEFAULT 'ORDER_ESCROW',
    "status" "HoldStatus" NOT NULL DEFAULT 'ACTIVE',
    "heldAmount" BIGINT NOT NULL,
    "remainingAmount" BIGINT NOT NULL,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletLedgerEntry" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "operationId" TEXT,
    "sequenceNumber" BIGSERIAL NOT NULL,
    "entryType" "LedgerEntryType" NOT NULL,
    "amount" BIGINT NOT NULL,
    "availableDelta" BIGINT NOT NULL,
    "reservedDelta" BIGINT NOT NULL,
    "balanceAfterAvailable" BIGINT NOT NULL,
    "balanceAfterReserved" BIGINT NOT NULL,
    "holdId" TEXT,
    "orderId" TEXT,
    "executionId" TEXT,
    "idempotencyKey" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_userId_key" ON "Wallet"("userId");

-- CreateIndex
CREATE INDEX "Wallet_userId_idx" ON "Wallet"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialOperation_idempotencyKey_key" ON "FinancialOperation"("idempotencyKey");

-- CreateIndex
CREATE INDEX "FinancialOperation_operationType_status_idx" ON "FinancialOperation"("operationType", "status");

-- CreateIndex
CREATE INDEX "FinancialOperation_referenceType_referenceId_idx" ON "FinancialOperation"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "WalletHold_walletId_status_idx" ON "WalletHold"("walletId", "status");

-- CreateIndex
CREATE INDEX "WalletHold_orderId_idx" ON "WalletHold"("orderId");

-- CreateIndex
CREATE INDEX "WalletHold_operationId_idx" ON "WalletHold"("operationId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletHold_walletId_idempotencyKey_key" ON "WalletHold"("walletId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "WalletLedgerEntry_sequenceNumber_key" ON "WalletLedgerEntry"("sequenceNumber");

-- CreateIndex
CREATE INDEX "WalletLedgerEntry_walletId_sequenceNumber_idx" ON "WalletLedgerEntry"("walletId", "sequenceNumber");

-- CreateIndex
CREATE INDEX "WalletLedgerEntry_walletId_createdAt_idx" ON "WalletLedgerEntry"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX "WalletLedgerEntry_operationId_idx" ON "WalletLedgerEntry"("operationId");

-- CreateIndex
CREATE INDEX "WalletLedgerEntry_holdId_idx" ON "WalletLedgerEntry"("holdId");

-- CreateIndex
CREATE INDEX "WalletLedgerEntry_orderId_idx" ON "WalletLedgerEntry"("orderId");

-- CreateIndex
CREATE INDEX "WalletLedgerEntry_executionId_idx" ON "WalletLedgerEntry"("executionId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletLedgerEntry_walletId_idempotencyKey_key" ON "WalletLedgerEntry"("walletId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Order_sequenceNumber_key" ON "Order"("sequenceNumber");

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletHold" ADD CONSTRAINT "WalletHold_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletHold" ADD CONSTRAINT "WalletHold_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "FinancialOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletHold" ADD CONSTRAINT "WalletHold_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletLedgerEntry" ADD CONSTRAINT "WalletLedgerEntry_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletLedgerEntry" ADD CONSTRAINT "WalletLedgerEntry_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "FinancialOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletLedgerEntry" ADD CONSTRAINT "WalletLedgerEntry_holdId_fkey" FOREIGN KEY ("holdId") REFERENCES "WalletHold"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletLedgerEntry" ADD CONSTRAINT "WalletLedgerEntry_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletLedgerEntry" ADD CONSTRAINT "WalletLedgerEntry_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "Execution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
