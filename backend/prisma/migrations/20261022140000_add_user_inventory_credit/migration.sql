-- CreateTable
CREATE TABLE "UserInventoryCredit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ticketCategoryId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "purchaseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserInventoryCredit_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "check_user_inventory_credit_qty_positive" CHECK ("quantity" > 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "UserInventoryCredit_idempotencyKey_key" ON "UserInventoryCredit"("idempotencyKey");

-- CreateIndex
CREATE INDEX "UserInventoryCredit_userId_ticketCategoryId_idx" ON "UserInventoryCredit"("userId", "ticketCategoryId");

-- CreateIndex
CREATE INDEX "UserInventoryCredit_idempotencyKey_idx" ON "UserInventoryCredit"("idempotencyKey");

-- AddForeignKey
ALTER TABLE "UserInventoryCredit" ADD CONSTRAINT "UserInventoryCredit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserInventoryCredit" ADD CONSTRAINT "UserInventoryCredit_ticketCategoryId_fkey" FOREIGN KEY ("ticketCategoryId") REFERENCES "TicketCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
