-- A wallet is the user's logical container; user accounts are its currency
-- balances. Existing account IDs and ledger entries are kept intact.
CREATE TABLE IF NOT EXISTS wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id),
    primary_currency CHAR(3) NOT NULL
        CHECK (primary_currency IN ('USD', 'COP', 'ARS', 'EUR')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS wallet_id UUID
    REFERENCES wallets(id);

INSERT INTO wallets (user_id, primary_currency)
SELECT u.id, RTRIM(a.currency)
  FROM users u
  JOIN accounts a ON a.user_id = u.id
 WHERE a.account_type = 'user'
   AND a.closed_at IS NULL
ON CONFLICT (user_id) DO NOTHING;

UPDATE accounts a
   SET wallet_id = w.id
  FROM wallets w
 WHERE a.user_id = w.user_id
   AND a.account_type = 'user'
   AND a.wallet_id IS NULL;

DROP INDEX IF EXISTS accounts_one_active_user_per_user_idx;
CREATE UNIQUE INDEX IF NOT EXISTS accounts_one_active_user_currency_per_wallet_idx
    ON accounts (wallet_id, currency)
    WHERE account_type = 'user' AND closed_at IS NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'accounts_wallet_user_consistency'
           AND conrelid = 'accounts'::regclass
    ) THEN
        ALTER TABLE accounts ADD CONSTRAINT accounts_wallet_user_consistency
            CHECK ((account_type = 'user' AND wallet_id IS NOT NULL)
                OR (account_type <> 'user' AND wallet_id IS NULL)) NOT VALID;
    END IF;
END;
$$;
