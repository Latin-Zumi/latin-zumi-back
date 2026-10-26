CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Legacy accounts may already contain user_id values without corresponding
-- user records. NOT VALID preserves those rows while enforcing the FK for
-- future inserts and updates.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'accounts_user_id_fk'
           AND conrelid = 'accounts'::regclass
    ) THEN
        ALTER TABLE accounts
            ADD CONSTRAINT accounts_user_id_fk
            FOREIGN KEY (user_id) REFERENCES users (id) NOT VALID;
    END IF;
END;
$$;

INSERT INTO users (id, username, email, password_hash)
VALUES (
    '20000000-0000-4000-8000-000000000001',
    'demo-user',
    'demo@example.com',
    'seed-only-not-for-authentication'
)
ON CONFLICT (id) DO NOTHING;
