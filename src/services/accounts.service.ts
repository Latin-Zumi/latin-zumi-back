import { pool } from '../config/db.js';
import type { PoolClient } from 'pg';

type Queryable = Pick<PoolClient, 'query'>;

export interface Account {
  id: string;
  user_id: string | null;
  wallet_id: string;
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

export async function getAccountsByUserId(userId: string, db: Queryable = pool): Promise<Account[]> {
  const result = await db.query<Account>(
    `SELECT a.id,
            a.user_id,
            a.wallet_id,
            RTRIM(a.currency) AS currency,
            a.account_type,
            a.allow_negative,
            COALESCE(b.balance, 0)::text AS balance
       FROM accounts a
       LEFT JOIN account_balances b
         ON b.account_id = a.id AND b.currency = a.currency
      WHERE a.user_id = $1
        AND a.account_type = 'user'
        AND a.closed_at IS NULL
      ORDER BY RTRIM(a.currency), a.id`,
    [userId],
  );

  return result.rows;
}

export async function getWalletByUserId(userId: string, db: Queryable = pool): Promise<{ id: string; primaryCurrency: string } | null> {
  const result = await db.query<{ id: string; primary_currency: string }>(
    `SELECT id, RTRIM(primary_currency) AS primary_currency FROM wallets WHERE user_id = $1 LIMIT 1`, [userId],
  );
  const row = result.rows[0];
  return row ? { id: row.id, primaryCurrency: row.primary_currency } : null;
}

export async function getAccountById(
  accountId: string,
  userId: string,
): Promise<Account | null> {
  const result = await pool.query<Account>(
    `SELECT a.id,
            a.user_id,
            a.wallet_id,
            RTRIM(a.currency) AS currency,
            a.account_type,
            a.allow_negative,
            COALESCE(b.balance, 0)::text AS balance
       FROM accounts a
       LEFT JOIN account_balances b
         ON b.account_id = a.id AND b.currency = a.currency
      WHERE a.id = $1
        AND a.user_id = $2
        AND a.closed_at IS NULL`,
    [accountId, userId],
  );

  return result.rows[0] ?? null;
}

export async function getBalanceByAccountId(
  accountId: string,
  userId: string,
): Promise<AccountBalance | null> {
  const account = await getAccountById(accountId, userId);
  if (!account) return null;

  return {
    account_id: account.id,
    currency: account.currency,
    balance: account.balance,
  };
}
