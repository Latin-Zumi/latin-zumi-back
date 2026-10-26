CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    user_id UUID,
    currency CHAR(3) NOT NULL,
    account_type TEXT NOT NULL CHECK (
        account_type IN (
            'user',
            'external',
            'fee',
            'treasury'
        )
    ),
    allow_negative BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT accounts_user_currency_type_unique UNIQUE (
        user_id,
        currency,
        account_type
    ),
    CONSTRAINT accounts_user_id_fk FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    idempotency_key TEXT NOT NULL UNIQUE,
    description TEXT,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE entries (
    id BIGSERIAL PRIMARY KEY,
    transaction_id UUID NOT NULL REFERENCES transactions (id),
    account_id UUID NOT NULL REFERENCES accounts (id),
    amount NUMERIC(20, 8) NOT NULL CHECK (amount > 0),
    direction TEXT NOT NULL CHECK (
        direction IN ('debit', 'credit')
    ),
    currency CHAR(3) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX entries_transaction_id_idx ON entries (transaction_id);

CREATE INDEX entries_account_currency_idx ON entries (account_id, currency);

CREATE FUNCTION assert_transaction_balanced()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    unbalanced_currency CHAR(3);
BEGIN
    SELECT currency
      INTO unbalanced_currency
      FROM entries
     WHERE transaction_id = NEW.transaction_id
     GROUP BY currency
    HAVING SUM(
        CASE WHEN direction = 'debit' THEN amount ELSE -amount END
    ) <> 0
     LIMIT 1;

    IF unbalanced_currency IS NOT NULL THEN
        RAISE EXCEPTION
            'Transaction % is unbalanced for currency %',
            NEW.transaction_id,
            unbalanced_currency
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER entries_transaction_balanced
AFTER INSERT ON entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION assert_transaction_balanced();

CREATE RULE entries_no_update AS ON UPDATE TO entries DO INSTEAD NOTHING;

CREATE RULE entries_no_delete AS ON DELETE TO entries DO INSTEAD NOTHING;

CREATE VIEW account_balances AS
SELECT account_id, currency, SUM(
        CASE
            WHEN direction = 'credit' THEN amount
            ELSE - amount
        END
    ) AS balance
FROM entries
GROUP BY
    account_id,
    currency;
