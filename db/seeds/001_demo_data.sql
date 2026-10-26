INSERT INTO users (id, username, email, password_hash)
VALUES (
    '20000000-0000-4000-8000-000000000001',
    'demo-user',
    'demo@example.com',
    'seed-only-not-for-authentication'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO accounts (id, user_id, currency, account_type)
VALUES
    ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'USD', 'user'),
    ('10000000-0000-4000-8000-000000000002', NULL, 'USD', 'external'),
    ('10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', 'COP', 'user'),
    ('10000000-0000-4000-8000-000000000004', NULL, 'COP', 'external')
ON CONFLICT (id) DO NOTHING;

WITH new_transaction AS (
    INSERT INTO transactions (id, idempotency_key, description, occurred_at)
    VALUES (
        '30000000-0000-4000-8000-000000000001',
        'seed:demo:usd-deposit',
        'Depósito de demostración en USD',
        '2026-01-15T12:00:00Z'
    )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id
)
INSERT INTO entries (transaction_id, account_id, amount, direction, currency)
SELECT new_transaction.id, rows.account_id, rows.amount, rows.direction, rows.currency
FROM new_transaction
CROSS JOIN (VALUES
    ('10000000-0000-4000-8000-000000000002'::UUID, 125.00::NUMERIC, 'debit', 'USD'),
    ('10000000-0000-4000-8000-000000000001'::UUID, 125.00::NUMERIC, 'credit', 'USD')
) AS rows(account_id, amount, direction, currency);

WITH new_transaction AS (
    INSERT INTO transactions (id, idempotency_key, description, occurred_at)
    VALUES (
        '30000000-0000-4000-8000-000000000002',
        'seed:demo:cop-deposit',
        'Depósito de demostración en COP',
        '2026-01-16T12:00:00Z'
    )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id
)
INSERT INTO entries (transaction_id, account_id, amount, direction, currency)
SELECT new_transaction.id, rows.account_id, rows.amount, rows.direction, rows.currency
FROM new_transaction
CROSS JOIN (VALUES
    ('10000000-0000-4000-8000-000000000004'::UUID, 500000.00::NUMERIC, 'debit', 'COP'),
    ('10000000-0000-4000-8000-000000000003'::UUID, 500000.00::NUMERIC, 'credit', 'COP')
) AS rows(account_id, amount, direction, currency);
