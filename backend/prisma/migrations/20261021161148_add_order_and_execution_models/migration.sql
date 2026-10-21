-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "OrderSide" AS ENUM ('BID', 'ASK');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'REJECTED');

-- CreateTable
CREATE TABLE "BuyerSeller" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kycStatus" "KycStatus" NOT NULL DEFAULT 'PENDING',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuyerSeller_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "ticketCategoryId" TEXT NOT NULL,
    "side" "OrderSide" NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'OPEN',
    "price" INTEGER NOT NULL,
    "initialQuantity" INTEGER NOT NULL,
    "remainingQuantity" INTEGER NOT NULL,
    "idempotencyKey" TEXT,
    "stoppedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Execution" (
    "id" TEXT NOT NULL,
    "incomingOrderId" TEXT NOT NULL,
    "restingOrderId" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "sequenceNumber" BIGSERIAL NOT NULL,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Execution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BuyerSeller_userId_key" ON "BuyerSeller"("userId");

-- CreateIndex
CREATE INDEX "Order_eventId_ticketCategoryId_status_price_createdAt_idx" ON "Order"("eventId", "ticketCategoryId", "status", "price", "createdAt");

-- CreateIndex
CREATE INDEX "Order_userId_createdAt_idx" ON "Order"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_userId_idempotencyKey_key" ON "Order"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Execution_incomingOrderId_idx" ON "Execution"("incomingOrderId");

-- CreateIndex
CREATE INDEX "Execution_restingOrderId_idx" ON "Execution"("restingOrderId");

-- CreateIndex
CREATE INDEX "Execution_sequenceNumber_idx" ON "Execution"("sequenceNumber");

-- AddForeignKey
ALTER TABLE "BuyerSeller" ADD CONSTRAINT "BuyerSeller_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_ticketCategoryId_fkey" FOREIGN KEY ("ticketCategoryId") REFERENCES "TicketCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Execution" ADD CONSTRAINT "Execution_incomingOrderId_fkey" FOREIGN KEY ("incomingOrderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Execution" ADD CONSTRAINT "Execution_restingOrderId_fkey" FOREIGN KEY ("restingOrderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
