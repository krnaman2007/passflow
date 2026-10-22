-- CreateTable
CREATE TABLE "MarketLease" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "ticketCategoryId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "fencingToken" BIGINT NOT NULL DEFAULT 1,
    "leaseDurationMs" INTEGER NOT NULL DEFAULT 10000,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "renewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketLease_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "fencingToken" BIGINT;

-- CreateIndex
CREATE UNIQUE INDEX "MarketLease_eventId_ticketCategoryId_key" ON "MarketLease"("eventId", "ticketCategoryId");

-- CreateIndex
CREATE INDEX "MarketLease_ownerId_idx" ON "MarketLease"("ownerId");

-- CreateIndex
CREATE INDEX "MarketLease_expiresAt_idx" ON "MarketLease"("expiresAt");

-- AddForeignKey
ALTER TABLE "MarketLease" ADD CONSTRAINT "MarketLease_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketLease" ADD CONSTRAINT "MarketLease_ticketCategoryId_fkey" FOREIGN KEY ("ticketCategoryId") REFERENCES "TicketCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
