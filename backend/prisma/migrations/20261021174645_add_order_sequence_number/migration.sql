-- Create Sequence for Order.sequenceNumber
CREATE SEQUENCE IF NOT EXISTS "Order_sequenceNumber_seq";

-- Add sequenceNumber column nullable first so we can backfill
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "sequenceNumber" BIGINT;

-- Backfill existing orders deterministically using createdAt ASC, id ASC
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, "id" ASC) as rn
  FROM "Order"
)
UPDATE "Order" o
SET "sequenceNumber" = n.rn
FROM numbered n
WHERE o.id = n.id AND o."sequenceNumber" IS NULL;

-- Synchronize sequence with highest allocated number
SELECT setval('"Order_sequenceNumber_seq"', COALESCE((SELECT MAX("sequenceNumber") FROM "Order"), 0) + 1, false);

-- Set DEFAULT and NOT NULL
ALTER TABLE "Order" ALTER COLUMN "sequenceNumber" SET DEFAULT nextval('"Order_sequenceNumber_seq"');
ALTER SEQUENCE "Order_sequenceNumber_seq" OWNED BY "Order"."sequenceNumber";
ALTER TABLE "Order" ALTER COLUMN "sequenceNumber" SET NOT NULL;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Order_eventId_ticketCategoryId_status_price_sequenceNumber_idx" ON "Order"("eventId", "ticketCategoryId", "status", "price", "sequenceNumber");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Order_sequenceNumber_idx" ON "Order"("sequenceNumber");
