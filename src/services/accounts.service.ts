import { pool } from '../config/db.js';

export interface AccountBalance {
  account_id: string;
  currency: string;
  balance: string;
}

export async function getBalanceByAccountId(
  accountId: string,
): Promise<AccountBalance | null> {
  const result = await pool.query<AccountBalance>(
    `SELECT a.id AS account_id,
            RTRIM(a.currency) AS currency,
            COALESCE(b.balance, 0)::text AS balance
       FROM accounts a
       LEFT JOIN account_balances b
         ON b.account_id = a.id AND b.currency = a.currency
      WHERE a.id = $1`,
    [accountId],
  );

  return result.rows[0] ?? null;
}
