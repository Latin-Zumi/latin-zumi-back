CREATE TABLE IF NOT EXISTS app_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    exchange_spread_percent NUMERIC(5,2) NOT NULL DEFAULT 0
        CHECK (exchange_spread_percent BETWEEN 0 AND 10),
    updated_at TIMESTAMPTZ,
    updated_by UUID REFERENCES users (id)
);
INSERT INTO app_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS interest_rates (
    currency CHAR(3) PRIMARY KEY CHECK (currency IN ('USD','COP','ARS','EUR')),
    annual_percent NUMERIC(5,2) NOT NULL DEFAULT 0
        CHECK (annual_percent BETWEEN 0 AND 50),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO interest_rates (currency) VALUES ('ARS'),('COP'),('USD'),('EUR')
ON CONFLICT (currency) DO NOTHING;

CREATE TABLE IF NOT EXISTS settings_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), field TEXT NOT NULL,
    old_value TEXT, new_value TEXT NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now(), changed_by UUID REFERENCES users (id)
);
CREATE TABLE IF NOT EXISTS interest_runs (
    run_date DATE PRIMARY KEY, executed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE exchange_quotes
    ADD COLUMN IF NOT EXISTS market_rate NUMERIC(30,12),
    ADD COLUMN IF NOT EXISTS spread_percent NUMERIC(5,2) NOT NULL DEFAULT 0;
UPDATE users SET estado = 'bloqueado' WHERE estado = 'inactivo';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_estado_check;
ALTER TABLE users ADD CONSTRAINT users_estado_check CHECK (estado IN ('activo', 'bloqueado'));
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_type_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_type_check
    CHECK (type IN ('deposit', 'transfer', 'withdrawal', 'exchange', 'interest'));
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_account_type_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_account_type_check
    CHECK (account_type IN ('user', 'external', 'fee', 'treasury', 'expense'));
