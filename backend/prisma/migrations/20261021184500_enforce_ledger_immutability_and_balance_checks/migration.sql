-- 1. Create Trigger Function to Prevent UPDATE and DELETE on WalletLedgerEntry
CREATE OR REPLACE FUNCTION prevent_wallet_ledger_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'WalletLedgerEntry records are immutable: UPDATE operations are strictly prohibited. Use COMPENSATING_ADJUSTMENT entries instead.';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'WalletLedgerEntry records are immutable: DELETE operations are strictly prohibited.';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 2. Attach Row-Level Immutability Trigger (BEFORE UPDATE OR DELETE)
DROP TRIGGER IF EXISTS wallet_ledger_immutability_trigger ON "WalletLedgerEntry";
CREATE TRIGGER wallet_ledger_immutability_trigger
BEFORE UPDATE OR DELETE ON "WalletLedgerEntry"
FOR EACH ROW
EXECUTE FUNCTION prevent_wallet_ledger_mutation();

-- 3. Create Statement-Level Trigger Function to Prevent TRUNCATE on WalletLedgerEntry
CREATE OR REPLACE FUNCTION prevent_wallet_ledger_truncate()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'WalletLedgerEntry records are immutable: TRUNCATE operations are strictly prohibited.';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 4. Attach Statement-Level Truncate Trigger
DROP TRIGGER IF EXISTS wallet_ledger_truncate_trigger ON "WalletLedgerEntry";
CREATE TRIGGER wallet_ledger_truncate_trigger
BEFORE TRUNCATE ON "WalletLedgerEntry"
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_wallet_ledger_truncate();

-- 5. Add Balance and Version CHECK Constraints to Wallet
ALTER TABLE "Wallet"
  ADD CONSTRAINT "wallet_available_balance_non_negative" CHECK ("availableBalance" >= 0),
  ADD CONSTRAINT "wallet_reserved_balance_non_negative" CHECK ("reservedBalance" >= 0),
  ADD CONSTRAINT "wallet_version_non_negative" CHECK ("version" >= 0);

-- 6. Add Amount and Bounds CHECK Constraints to WalletHold
ALTER TABLE "WalletHold"
  ADD CONSTRAINT "wallet_hold_held_amount_positive" CHECK ("heldAmount" > 0),
  ADD CONSTRAINT "wallet_hold_remaining_amount_non_negative" CHECK ("remainingAmount" >= 0),
  ADD CONSTRAINT "wallet_hold_remaining_lte_held" CHECK ("remainingAmount" <= "heldAmount");

-- 7. Add Monetary Amount and Snapshot Balance CHECK Constraints to WalletLedgerEntry
ALTER TABLE "WalletLedgerEntry"
  ADD CONSTRAINT "wallet_ledger_amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "wallet_ledger_snapshot_available_non_negative" CHECK ("balanceAfterAvailable" >= 0),
  ADD CONSTRAINT "wallet_ledger_snapshot_reserved_non_negative" CHECK ("balanceAfterReserved" >= 0);
