-- A user-facing wallet is one active user account. Historical accounts and
-- entries are retained; duplicate accounts are closed instead of deleted.
ALTER TABLE accounts
    ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

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
