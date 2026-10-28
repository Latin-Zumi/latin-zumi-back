-- Stable demo identities. Password hashes are deliberately unusable for login.
INSERT INTO users
    (id, username, email, password_hash, nombre, pais, moneda_preferida)
VALUES
    ('20000000-0000-4000-8000-000000000001', 'demo-user', 'demo@example.com', 'seed-only-not-for-authentication', 'Demo User', 'Otro', 'USD'),
    ('20000000-0000-4000-8000-000000000002', 'ana.perez', 'ana@example.com', 'seed-only-not-for-authentication', 'Ana Pérez', 'Argentina', 'ARS'),
    ('20000000-0000-4000-8000-000000000004', 'luca.fernandez', 'luca@example.com', 'seed-only-not-for-authentication', 'Luca Fernández', 'Otro', 'EUR'),
    ('20000000-0000-4000-8000-000000000005', 'sofia.gomez', 'sofia@example.com', 'seed-only-not-for-authentication', 'Sofía Gómez', 'Otro', 'USD'),
    ('20000000-0000-4000-8000-000000000006', 'mateo.rios', 'mateo@example.com', 'seed-only-not-for-authentication', 'Mateo Ríos', 'Colombia', 'COP')
ON CONFLICT DO NOTHING;

INSERT INTO wallets (user_id, primary_currency)
SELECT u.id, seed.currency
  FROM (VALUES
    ('demo-user', 'USD'), ('ana.perez', 'ARS'),
    ('luca.fernandez', 'EUR'), ('sofia.gomez', 'USD'), ('mateo.rios', 'COP')
  ) AS seed(username, currency)
  JOIN users u ON u.username = seed.username
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO accounts (id, user_id, wallet_id, currency, account_type)
SELECT seed.account_id, owner.id, wallet.id, seed.currency, seed.account_type
  FROM (VALUES
    ('10000000-0000-4000-8000-000000000001'::UUID, 'demo-user', 'USD', 'user'),
    ('10000000-0000-4000-8000-000000000002'::UUID, NULL, 'USD', 'external'),
    ('10000000-0000-4000-8000-000000000004'::UUID, NULL, 'COP', 'external'),
    ('10000000-0000-4000-8000-000000000005'::UUID, 'ana.perez', 'ARS', 'user'),
    ('10000000-0000-4000-8000-000000000006'::UUID, 'luca.fernandez', 'EUR', 'user'),
    ('10000000-0000-4000-8000-000000000007'::UUID, 'sofia.gomez', 'USD', 'user'),
    ('10000000-0000-4000-8000-000000000008'::UUID, 'mateo.rios', 'COP', 'user'),
    ('10000000-0000-4000-8000-000000000009'::UUID, NULL, 'ARS', 'external'),
    ('10000000-0000-4000-8000-000000000010'::UUID, NULL, 'EUR', 'external')
  ) AS seed(account_id, username, currency, account_type)
  LEFT JOIN users owner ON owner.username = seed.username
  LEFT JOIN wallets wallet ON wallet.user_id = owner.id
 WHERE seed.account_type <> 'user' OR owner.id IS NOT NULL
ON CONFLICT DO NOTHING;

WITH tx AS (
    INSERT INTO transactions (id, idempotency_key, description, occurred_at, type)
    VALUES ('30000000-0000-4000-8000-000000000101', 'seed:portfolio:01:usd:movement-1', 'Movimiento demo USD 1', '2026-02-01T12:00:00Z', 'deposit')
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id
), inserted_entries AS (
    INSERT INTO entries (transaction_id, account_id, amount, direction, currency)
    SELECT tx.id, movement.account_id, movement.amount, movement.direction, movement.currency
      FROM tx
      CROSS JOIN (VALUES
        ('10000000-0000-4000-8000-000000000002'::UUID, 125.00::NUMERIC, 'debit', 'USD'),
        ('10000000-0000-4000-8000-000000000001'::UUID, 125.00::NUMERIC, 'credit', 'USD')
      ) AS movement(account_id, amount, direction, currency)
    RETURNING id
) SELECT COUNT(*) FROM inserted_entries;

WITH tx AS (
    INSERT INTO transactions (id, idempotency_key, description, occurred_at, type)
    VALUES ('30000000-0000-4000-8000-000000000102', 'seed:portfolio:01:usd:movement-2', 'Movimiento demo USD 2', '2026-02-02T12:00:00Z', 'deposit')
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id
), inserted_entries AS (
    INSERT INTO entries (transaction_id, account_id, amount, direction, currency)
    SELECT tx.id, movement.account_id, movement.amount, movement.direction, movement.currency
      FROM tx
      CROSS JOIN (VALUES
        ('10000000-0000-4000-8000-000000000002'::UUID, 25.00::NUMERIC, 'debit', 'USD'),
        ('10000000-0000-4000-8000-000000000001'::UUID, 25.00::NUMERIC, 'credit', 'USD')
      ) AS movement(account_id, amount, direction, currency)
    RETURNING id
) SELECT COUNT(*) FROM inserted_entries;

WITH tx AS (
    INSERT INTO transactions (id, idempotency_key, description, occurred_at, type)
    VALUES ('30000000-0000-4000-8000-000000000103', 'seed:portfolio:01:usd:movement-3', 'Movimiento demo USD 3', '2026-02-03T12:00:00Z', 'deposit')
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id
), inserted_entries AS (
    INSERT INTO entries (transaction_id, account_id, amount, direction, currency)
    SELECT tx.id, movement.account_id, movement.amount, movement.direction, movement.currency
      FROM tx
      CROSS JOIN (VALUES
        ('10000000-0000-4000-8000-000000000002'::UUID, 50.00::NUMERIC, 'debit', 'USD'),
        ('10000000-0000-4000-8000-000000000001'::UUID, 50.00::NUMERIC, 'credit', 'USD')
      ) AS movement(account_id, amount, direction, currency)
    RETURNING id
) SELECT COUNT(*) FROM inserted_entries;

WITH tx AS (
    INSERT INTO transactions (id, idempotency_key, description, occurred_at, type)
    VALUES ('30000000-0000-4000-8000-000000000107', 'seed:portfolio:03:ars:movement-1', 'Movimiento demo ARS 1', '2026-02-07T12:00:00Z', 'deposit')
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id
), inserted_entries AS (
    INSERT INTO entries (transaction_id, account_id, amount, direction, currency)
    SELECT tx.id, movement.account_id, movement.amount, movement.direction, movement.currency
      FROM tx
      CROSS JOIN (VALUES
        ('10000000-0000-4000-8000-000000000009'::UUID, 125000.00::NUMERIC, 'debit', 'ARS'),
        ('10000000-0000-4000-8000-000000000005'::UUID, 125000.00::NUMERIC, 'credit', 'ARS')
      ) AS movement(account_id, amount, direction, currency)
    RETURNING id
) SELECT COUNT(*) FROM inserted_entries;

WITH tx AS (
    INSERT INTO transactions (id, idempotency_key, description, occurred_at, type)
    VALUES ('30000000-0000-4000-8000-000000000108', 'seed:portfolio:03:ars:movement-2', 'Movimiento demo ARS 2', '2026-02-08T12:00:00Z', 'deposit')
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id
), inserted_entries AS (
    INSERT INTO entries (transaction_id, account_id, amount, direction, currency)
    SELECT tx.id, movement.account_id, movement.amount, movement.direction, movement.currency
      FROM tx
      CROSS JOIN (VALUES
        ('10000000-0000-4000-8000-000000000009'::UUID, 15000.00::NUMERIC, 'debit', 'ARS'),
        ('10000000-0000-4000-8000-000000000005'::UUID, 15000.00::NUMERIC, 'credit', 'ARS')
      ) AS movement(account_id, amount, direction, currency)
    RETURNING id
) SELECT COUNT(*) FROM inserted_entries;

WITH tx AS (
    INSERT INTO transactions (id, idempotency_key, description, occurred_at, type)
    VALUES ('30000000-0000-4000-8000-000000000109', 'seed:portfolio:03:ars:movement-3', 'Movimiento demo ARS 3', '2026-02-09T12:00:00Z', 'deposit')
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id
), inserted_entries AS (
    INSERT INTO entries (transaction_id, account_id, amount, direction, currency)
    SELECT tx.id, movement.account_id, movement.amount, movement.direction, movement.currency
      FROM tx
      CROSS JOIN (VALUES
        ('10000000-0000-4000-8000-000000000009'::UUID, 30000.00::NUMERIC, 'debit', 'ARS'),
        ('10000000-0000-4000-8000-000000000005'::UUID, 30000.00::NUMERIC, 'credit', 'ARS')
      ) AS movement(account_id, amount, direction, currency)
    RETURNING id
) SELECT COUNT(*) FROM inserted_entries;

WITH tx AS (
    INSERT INTO transactions (id, idempotency_key, description, occurred_at, type)
    VALUES ('30000000-0000-4000-8000-000000000110', 'seed:portfolio:04:eur:movement-1', 'Movimiento demo EUR 1', '2026-02-10T12:00:00Z', 'deposit')
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id
), inserted_entries AS (
    INSERT INTO entries (transaction_id, account_id, amount, direction, currency)
    SELECT tx.id, movement.account_id, movement.amount, movement.direction, movement.currency
      FROM tx
      CROSS JOIN (VALUES
        ('10000000-0000-4000-8000-000000000010'::UUID, 125.00::NUMERIC, 'debit', 'EUR'),
        ('10000000-0000-4000-8000-000000000006'::UUID, 125.00::NUMERIC, 'credit', 'EUR')
      ) AS movement(account_id, amount, direction, currency)
    RETURNING id
) SELECT COUNT(*) FROM inserted_entries;

WITH tx AS (
    INSERT INTO transactions (id, idempotency_key, description, occurred_at, type)
    VALUES ('30000000-0000-4000-8000-000000000111', 'seed:portfolio:04:eur:movement-2', 'Movimiento demo EUR 2', '2026-02-11T12:00:00Z', 'deposit')
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id
), inserted_entries AS (
    INSERT INTO entries (transaction_id, account_id, amount, direction, currency)
    SELECT tx.id, movement.account_id, movement.amount, movement.direction, movement.currency
      FROM tx
      CROSS JOIN (VALUES
        ('10000000-0000-4000-8000-000000000010'::UUID, 10.00::NUMERIC, 'debit', 'EUR'),
        ('10000000-0000-4000-8000-000000000006'::UUID, 10.00::NUMERIC, 'credit', 'EUR')
      ) AS movement(account_id, amount, direction, currency)
    RETURNING id
) SELECT COUNT(*) FROM inserted_entries;

WITH tx AS (
    INSERT INTO transactions (id, idempotency_key, description, occurred_at, type)
    VALUES ('30000000-0000-4000-8000-000000000112', 'seed:portfolio:04:eur:movement-3', 'Movimiento demo EUR 3', '2026-02-12T12:00:00Z', 'deposit')
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id
), inserted_entries AS (
    INSERT INTO entries (transaction_id, account_id, amount, direction, currency)
    SELECT tx.id, movement.account_id, movement.amount, movement.direction, movement.currency
      FROM tx
      CROSS JOIN (VALUES
        ('10000000-0000-4000-8000-000000000010'::UUID, 20.00::NUMERIC, 'debit', 'EUR'),
        ('10000000-0000-4000-8000-000000000006'::UUID, 20.00::NUMERIC, 'credit', 'EUR')
      ) AS movement(account_id, amount, direction, currency)
    RETURNING id
) SELECT COUNT(*) FROM inserted_entries;

WITH tx AS (
    INSERT INTO transactions (id, idempotency_key, description, occurred_at, type)
    VALUES ('30000000-0000-4000-8000-000000000113', 'seed:portfolio:05:usd:movement-1', 'Movimiento demo USD 1', '2026-02-13T12:00:00Z', 'deposit')
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id
), inserted_entries AS (
    INSERT INTO entries (transaction_id, account_id, amount, direction, currency)
    SELECT tx.id, movement.account_id, movement.amount, movement.direction, movement.currency
      FROM tx
      CROSS JOIN (VALUES
        ('10000000-0000-4000-8000-000000000002'::UUID, 75.00::NUMERIC, 'debit', 'USD'),
        ('10000000-0000-4000-8000-000000000007'::UUID, 75.00::NUMERIC, 'credit', 'USD')
      ) AS movement(account_id, amount, direction, currency)
    RETURNING id
) SELECT COUNT(*) FROM inserted_entries;

WITH tx AS (
    INSERT INTO transactions (id, idempotency_key, description, occurred_at, type)
    VALUES ('30000000-0000-4000-8000-000000000114', 'seed:portfolio:05:usd:movement-2', 'Movimiento demo USD 2', '2026-02-14T12:00:00Z', 'deposit')
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id
), inserted_entries AS (
    INSERT INTO entries (transaction_id, account_id, amount, direction, currency)
    SELECT tx.id, movement.account_id, movement.amount, movement.direction, movement.currency
      FROM tx
      CROSS JOIN (VALUES
        ('10000000-0000-4000-8000-000000000002'::UUID, 20.00::NUMERIC, 'debit', 'USD'),
        ('10000000-0000-4000-8000-000000000007'::UUID, 20.00::NUMERIC, 'credit', 'USD')
      ) AS movement(account_id, amount, direction, currency)
    RETURNING id
) SELECT COUNT(*) FROM inserted_entries;

WITH tx AS (
    INSERT INTO transactions (id, idempotency_key, description, occurred_at, type)
    VALUES ('30000000-0000-4000-8000-000000000115', 'seed:portfolio:05:usd:movement-3', 'Movimiento demo USD 3', '2026-02-15T12:00:00Z', 'deposit')
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id
), inserted_entries AS (
    INSERT INTO entries (transaction_id, account_id, amount, direction, currency)
    SELECT tx.id, movement.account_id, movement.amount, movement.direction, movement.currency
      FROM tx
      CROSS JOIN (VALUES
        ('10000000-0000-4000-8000-000000000002'::UUID, 30.00::NUMERIC, 'debit', 'USD'),
        ('10000000-0000-4000-8000-000000000007'::UUID, 30.00::NUMERIC, 'credit', 'USD')
      ) AS movement(account_id, amount, direction, currency)
    RETURNING id
) SELECT COUNT(*) FROM inserted_entries;

WITH tx AS (
    INSERT INTO transactions (id, idempotency_key, description, occurred_at, type)
    VALUES ('30000000-0000-4000-8000-000000000116', 'seed:portfolio:06:cop:movement-1', 'Movimiento demo COP 1', '2026-02-16T12:00:00Z', 'deposit')
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id
), inserted_entries AS (
    INSERT INTO entries (transaction_id, account_id, amount, direction, currency)
    SELECT tx.id, movement.account_id, movement.amount, movement.direction, movement.currency
      FROM tx
      CROSS JOIN (VALUES
        ('10000000-0000-4000-8000-000000000004'::UUID, 150000.00::NUMERIC, 'debit', 'COP'),
        ('10000000-0000-4000-8000-000000000008'::UUID, 150000.00::NUMERIC, 'credit', 'COP')
      ) AS movement(account_id, amount, direction, currency)
    RETURNING id
) SELECT COUNT(*) FROM inserted_entries;

WITH tx AS (
    INSERT INTO transactions (id, idempotency_key, description, occurred_at, type)
    VALUES ('30000000-0000-4000-8000-000000000117', 'seed:portfolio:06:cop:movement-2', 'Movimiento demo COP 2', '2026-02-17T12:00:00Z', 'deposit')
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id
), inserted_entries AS (
    INSERT INTO entries (transaction_id, account_id, amount, direction, currency)
    SELECT tx.id, movement.account_id, movement.amount, movement.direction, movement.currency
      FROM tx
      CROSS JOIN (VALUES
        ('10000000-0000-4000-8000-000000000004'::UUID, 35000.00::NUMERIC, 'debit', 'COP'),
        ('10000000-0000-4000-8000-000000000008'::UUID, 35000.00::NUMERIC, 'credit', 'COP')
      ) AS movement(account_id, amount, direction, currency)
    RETURNING id
) SELECT COUNT(*) FROM inserted_entries;

WITH tx AS (
    INSERT INTO transactions (id, idempotency_key, description, occurred_at, type)
    VALUES ('30000000-0000-4000-8000-000000000118', 'seed:portfolio:06:cop:movement-3', 'Movimiento demo COP 3', '2026-02-18T12:00:00Z', 'deposit')
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id
), inserted_entries AS (
    INSERT INTO entries (transaction_id, account_id, amount, direction, currency)
    SELECT tx.id, movement.account_id, movement.amount, movement.direction, movement.currency
      FROM tx
      CROSS JOIN (VALUES
        ('10000000-0000-4000-8000-000000000004'::UUID, 45000.00::NUMERIC, 'debit', 'COP'),
        ('10000000-0000-4000-8000-000000000008'::UUID, 45000.00::NUMERIC, 'credit', 'COP')
      ) AS movement(account_id, amount, direction, currency)
    RETURNING id
) SELECT COUNT(*) FROM inserted_entries;
