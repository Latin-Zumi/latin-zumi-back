ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS initiator_user_id UUID REFERENCES users (id);

UPDATE transactions t
   SET initiator_user_id = (
       SELECT a.user_id
         FROM entries e
         JOIN accounts a ON a.id = e.account_id
        WHERE e.transaction_id = t.id AND a.user_id IS NOT NULL
        ORDER BY (e.direction = 'debit') DESC, e.id
        LIMIT 1
   )
 WHERE t.initiator_user_id IS NULL;

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_idempotency_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS transactions_user_idempotency_idx
    ON transactions (initiator_user_id, idempotency_key)
    WHERE initiator_user_id IS NOT NULL;
