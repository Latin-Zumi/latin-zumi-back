import { pool } from '../config/db.js';

export interface Account {
  id: string;
  user_id: string | null;
  currency: string;
  account_type: string;
  allow_negative: boolean;
  balance: string;
}

export interface AccountBalance {
  account_id: string;
  currency: string;
  balance: string;
}

export async function getAccountById(
  accountId: string,
): Promise<Account | null> {
  const result = await pool.query<Account>(
    `SELECT a.id,
            a.user_id,
            RTRIM(a.currency) AS currency,
            a.account_type,
            a.allow_negative,
            COALESCE(b.balance, 0)::text AS balance
       FROM accounts a
       LEFT JOIN account_balances b
         ON b.account_id = a.id AND b.currency = a.currency
      WHERE a.id = $1`,
    [accountId],
  );

  return result.rows[0] ?? null;
}

export async function getBalanceByAccountId(
  accountId: string,
): Promise<AccountBalance | null> {
  const account = await getAccountById(accountId);
  if (!account) return null;

  return {
    account_id: account.id,
    currency: account.currency,
    balance: account.balance,
  };
}
