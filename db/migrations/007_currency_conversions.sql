CREATE TABLE IF NOT EXISTS currency_conversions (
    transaction_id UUID PRIMARY KEY REFERENCES transactions(id),
    wallet_id UUID NOT NULL REFERENCES wallets(id),
    account_id UUID NOT NULL REFERENCES accounts(id),
    user_id UUID NOT NULL REFERENCES users(id),
    source_currency CHAR(3) NOT NULL
        CHECK (source_currency IN ('USD', 'COP', 'ARS', 'EUR')),
    source_amount NUMERIC(20, 8) NOT NULL CHECK (source_amount > 0),
    destination_currency CHAR(3) NOT NULL
        CHECK (destination_currency IN ('USD', 'COP', 'ARS', 'EUR')),
    destination_amount NUMERIC(20, 8) NOT NULL CHECK (destination_amount > 0),
    rate NUMERIC(30, 12) NOT NULL CHECK (rate > 0),
    rate_source TEXT NOT NULL,
    rate_observed_at TIMESTAMPTZ NOT NULL,
    rounding TEXT NOT NULL CHECK (rounding = 'HALF_UP_2'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS currency_conversions_wallet_id_idx
    ON currency_conversions (wallet_id, created_at DESC);
