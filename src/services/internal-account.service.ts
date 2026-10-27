import type { PoolClient } from 'pg';

export async function getInternalAccount(
  client: PoolClient,
  currency: string,
  type: 'external' | 'treasury',
): Promise<string> {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtext($1))',
    [`internal:${type}:${currency}`],
  );
  const result = await client.query<{ id: string }>(
    `SELECT id FROM accounts
      WHERE account_type = $1 AND user_id IS NULL AND currency = $2
      ORDER BY id LIMIT 1`,
    [type, currency],
  );
  if (result.rows[0]) return result.rows[0].id;

  const created = await client.query<{ id: string }>(
    `INSERT INTO accounts (currency, account_type, allow_negative)
     VALUES ($1, $2, true) RETURNING id`,
    [currency, type],
  );
  return created.rows[0].id;
}
