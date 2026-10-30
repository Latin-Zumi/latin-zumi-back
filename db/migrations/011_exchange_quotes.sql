CREATE TABLE IF NOT EXISTS exchange_quotes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    from_currency CHAR(3) NOT NULL
        CHECK (from_currency IN ('USD', 'COP', 'ARS', 'EUR')),
    to_currency CHAR(3) NOT NULL
        CHECK (to_currency IN ('USD', 'COP', 'ARS', 'EUR')),
    from_amount NUMERIC(20, 8) NOT NULL CHECK (from_amount > 0),
    to_amount NUMERIC(20, 8) NOT NULL CHECK (to_amount > 0),
    rate NUMERIC(30, 12) NOT NULL CHECK (rate > 0),
    rate_source TEXT NOT NULL,
    rate_observed_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_transaction_id UUID REFERENCES transactions (id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT exchange_quotes_different_currencies
        CHECK (from_currency <> to_currency),
    CONSTRAINT exchange_quotes_expiration_after_creation
        CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS exchange_quotes_user_created_idx
    ON exchange_quotes (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS exchange_quotes_pending_idx
    ON exchange_quotes (expires_at)
 WHERE used_transaction_id IS NULL;
