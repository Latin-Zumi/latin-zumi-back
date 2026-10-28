ALTER TABLE transactions ADD COLUMN IF NOT EXISTS type TEXT;

UPDATE transactions
   SET type = CASE WHEN description = 'Retiro de cuenta' THEN 'withdrawal' ELSE 'deposit' END
 WHERE type IS NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transactions_type_check' AND conrelid = 'transactions'::regclass) THEN
    ALTER TABLE transactions ADD CONSTRAINT transactions_type_check
      CHECK (type IN ('deposit', 'transfer', 'withdrawal', 'exchange'));
  END IF;
END $$;

ALTER TABLE transactions ALTER COLUMN type SET NOT NULL;
CREATE INDEX IF NOT EXISTS transactions_type_occurred_at_idx ON transactions (type, occurred_at DESC);
