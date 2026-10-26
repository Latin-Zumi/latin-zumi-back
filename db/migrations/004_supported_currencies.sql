-- Preserve historical rows while enforcing the supported currencies on new
-- or updated rows. Existing invalid records must be reviewed separately.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'accounts_currency_supported'
           AND conrelid = 'accounts'::regclass
    ) THEN
        ALTER TABLE accounts
            ADD CONSTRAINT accounts_currency_supported
            CHECK (currency IN ('USD', 'COP', 'ARS', 'EUR')) NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'entries_currency_supported'
           AND conrelid = 'entries'::regclass
    ) THEN
        ALTER TABLE entries
            ADD CONSTRAINT entries_currency_supported
            CHECK (currency IN ('USD', 'COP', 'ARS', 'EUR')) NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'accounts_id_currency_unique'
           AND conrelid = 'accounts'::regclass
    ) THEN
        ALTER TABLE accounts
            ADD CONSTRAINT accounts_id_currency_unique UNIQUE (id, currency);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'entries_account_currency_fk'
           AND conrelid = 'entries'::regclass
    ) THEN
        ALTER TABLE entries
            ADD CONSTRAINT entries_account_currency_fk
            FOREIGN KEY (account_id, currency)
            REFERENCES accounts (id, currency) NOT VALID;
    END IF;
END;
$$;
