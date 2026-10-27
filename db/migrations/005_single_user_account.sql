-- Before wallet containers exist, retain one active account per user. After
-- migration 006, retain one active user account per wallet and currency.
ALTER TABLE accounts
    ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'accounts' AND column_name = 'wallet_id'
    ) THEN
        WITH ranked_accounts AS (
            SELECT id,
                   ROW_NUMBER() OVER (
                       PARTITION BY wallet_id, currency
                       ORDER BY id
                   ) AS account_rank
              FROM accounts
             WHERE account_type = 'user'
               AND wallet_id IS NOT NULL
               AND closed_at IS NULL
        )
        UPDATE accounts AS accounts_to_close
           SET closed_at = now()
          FROM ranked_accounts
         WHERE accounts_to_close.id = ranked_accounts.id
           AND ranked_accounts.account_rank > 1;

        DROP INDEX IF EXISTS accounts_one_active_user_per_user_idx;
        CREATE UNIQUE INDEX IF NOT EXISTS accounts_one_active_user_currency_per_wallet_idx
            ON accounts (wallet_id, currency)
            WHERE account_type = 'user' AND closed_at IS NULL;
    ELSE
        WITH ranked_accounts AS (
            SELECT id,
                   ROW_NUMBER() OVER (
                       PARTITION BY user_id
                       ORDER BY CASE currency
                           WHEN 'USD' THEN 1
                           WHEN 'COP' THEN 2
                           WHEN 'ARS' THEN 3
                           WHEN 'EUR' THEN 4
                           ELSE 5
                       END, id
                   ) AS account_rank
              FROM accounts
             WHERE account_type = 'user'
               AND user_id IS NOT NULL
               AND closed_at IS NULL
        )
        UPDATE accounts AS accounts_to_close
           SET closed_at = now()
          FROM ranked_accounts
         WHERE accounts_to_close.id = ranked_accounts.id
           AND ranked_accounts.account_rank > 1;

        CREATE UNIQUE INDEX IF NOT EXISTS accounts_one_active_user_per_user_idx
            ON accounts (user_id)
            WHERE account_type = 'user' AND closed_at IS NULL;
    END IF;
END;
$$;
