-- CreateTable
CREATE TABLE "UserTicketInventory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ticketCategoryId" TEXT NOT NULL,
    "totalQuantity" INTEGER NOT NULL DEFAULT 0,
    "availableQuantity" INTEGER NOT NULL DEFAULT 0,
    "reservedQuantity" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserTicketInventory_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "check_user_ticket_inventory_total_non_negative" CHECK ("totalQuantity" >= 0),
    CONSTRAINT "check_user_ticket_inventory_available_non_negative" CHECK ("availableQuantity" >= 0),
    CONSTRAINT "check_user_ticket_inventory_reserved_non_negative" CHECK ("reservedQuantity" >= 0),
    CONSTRAINT "check_user_ticket_inventory_conservation" CHECK ("availableQuantity" + "reservedQuantity" <= "totalQuantity")
);

-- CreateIndex
CREATE INDEX "UserTicketInventory_userId_idx" ON "UserTicketInventory"("userId");

-- CreateIndex
CREATE INDEX "UserTicketInventory_ticketCategoryId_idx" ON "UserTicketInventory"("ticketCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "UserTicketInventory_userId_ticketCategoryId_key" ON "UserTicketInventory"("userId", "ticketCategoryId");

-- AddForeignKey
ALTER TABLE "UserTicketInventory" ADD CONSTRAINT "UserTicketInventory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTicketInventory" ADD CONSTRAINT "UserTicketInventory_ticketCategoryId_fkey" FOREIGN KEY ("ticketCategoryId") REFERENCES "TicketCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
