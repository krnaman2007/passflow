-- Preserve execution history: an order with executions cannot be deleted.
ALTER TABLE "Execution" DROP CONSTRAINT "Execution_incomingOrderId_fkey";
ALTER TABLE "Execution" DROP CONSTRAINT "Execution_restingOrderId_fkey";
ALTER TABLE "Execution"
  ADD CONSTRAINT "Execution_incomingOrderId_fkey"
  FOREIGN KEY ("incomingOrderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Execution"
  ADD CONSTRAINT "Execution_restingOrderId_fkey"
  FOREIGN KEY ("restingOrderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "TradeSettlement" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "buyerOrderId" TEXT NOT NULL,
    "sellerOrderId" TEXT NOT NULL,
    "buyerHoldId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "executionPricePaise" INTEGER NOT NULL,
    "executionCostPaise" BIGINT NOT NULL,
    "buyerReservedConsumed" BIGINT NOT NULL,
    "priceImprovementPaise" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TradeSettlement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "trade_settlement_quantity_positive" CHECK ("quantity" > 0),
    CONSTRAINT "trade_settlement_price_positive" CHECK ("executionPricePaise" > 0),
    CONSTRAINT "trade_settlement_cost_positive" CHECK ("executionCostPaise" > 0),
    CONSTRAINT "trade_settlement_reserved_positive" CHECK ("buyerReservedConsumed" > 0),
    CONSTRAINT "trade_settlement_improvement_non_negative" CHECK ("priceImprovementPaise" >= 0),
    CONSTRAINT "trade_settlement_accounting" CHECK ("buyerReservedConsumed" = "executionCostPaise" + "priceImprovementPaise")
);

CREATE UNIQUE INDEX "TradeSettlement_executionId_key" ON "TradeSettlement"("executionId");
CREATE INDEX "TradeSettlement_createdAt_idx" ON "TradeSettlement"("createdAt");

ALTER TABLE "TradeSettlement" ADD CONSTRAINT "TradeSettlement_executionId_fkey"
  FOREIGN KEY ("executionId") REFERENCES "Execution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TradeSettlement" ADD CONSTRAINT "TradeSettlement_buyerOrderId_fkey"
  FOREIGN KEY ("buyerOrderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TradeSettlement" ADD CONSTRAINT "TradeSettlement_sellerOrderId_fkey"
  FOREIGN KEY ("sellerOrderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TradeSettlement" ADD CONSTRAINT "TradeSettlement_buyerHoldId_fkey"
  FOREIGN KEY ("buyerHoldId") REFERENCES "WalletHold"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
