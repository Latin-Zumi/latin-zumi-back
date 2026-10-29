-- 008_google_auth_profile.sql
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS nombre TEXT,
    ADD COLUMN IF NOT EXISTS pais TEXT,
    ADD COLUMN IF NOT EXISTS moneda_preferida CHAR(3),
    ADD COLUMN IF NOT EXISTS foto_url TEXT,
    ADD COLUMN IF NOT EXISTS google_uid TEXT,
    ADD COLUMN IF NOT EXISTS roles TEXT[] NOT NULL DEFAULT '{user}',
    ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'activo';

-- 1. Resolver emails duplicados ignorando mayúsculas antes del índice único.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM users
         GROUP BY lower(email)
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION
            'Hay emails duplicados ignorando mayúsculas; resolvelos antes de aplicar 008';
    END IF;
END;
$$;

UPDATE users SET email = lower(email) WHERE email <> lower(email);

-- 2. Backfill de los datos existentes.
UPDATE users
   SET nombre = username
 WHERE nombre IS NULL OR nombre = '';

UPDATE users u
   SET moneda_preferida = RTRIM(w.primary_currency)
  FROM wallets w
 WHERE w.user_id = u.id;

UPDATE users
   SET moneda_preferida = 'USD'
 WHERE moneda_preferida IS NULL;

-- 3. Normalizar nullability y defaults (idempotente si la columna ya existía).
UPDATE users SET roles = '{user}' WHERE roles IS NULL;
ALTER TABLE users ALTER COLUMN roles SET DEFAULT '{user}';
ALTER TABLE users ALTER COLUMN roles SET NOT NULL;

UPDATE users SET estado = 'activo' WHERE estado IS NULL;
ALTER TABLE users ALTER COLUMN estado SET DEFAULT 'activo';
ALTER TABLE users ALTER COLUMN estado SET NOT NULL;

ALTER TABLE users ALTER COLUMN moneda_preferida SET DEFAULT 'USD';
ALTER TABLE users ALTER COLUMN moneda_preferida SET NOT NULL;

ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- 4. Checks del contrato.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'users_pais_check'
           AND conrelid = 'users'::regclass
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_pais_check
            CHECK (pais IN ('Argentina', 'Colombia', 'Otro'));
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'users_moneda_preferida_check'
           AND conrelid = 'users'::regclass
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_moneda_preferida_check
            CHECK (moneda_preferida IN ('USD', 'COP', 'ARS', 'EUR'));
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'users_estado_check'
           AND conrelid = 'users'::regclass
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_estado_check
            CHECK (estado IN ('activo', 'inactivo', 'bloqueado'));
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'users_access_method_check'
           AND conrelid = 'users'::regclass
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_access_method_check
            CHECK (password_hash IS NOT NULL OR google_uid IS NOT NULL);
    END IF;
END;
$$;

-- 5. Unicidad de Google y de email sin distinguir mayúsculas.
CREATE UNIQUE INDEX IF NOT EXISTS users_google_uid_idx
    ON users (google_uid)
 WHERE google_uid IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx
    ON users (lower(email));
