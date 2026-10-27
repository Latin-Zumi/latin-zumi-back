import type { PoolClient } from 'pg';
import { pool } from '../config/db.js';
import { AppError } from '../utils/AppError.js';
import { normalizeDecimal } from '../utils/decimal.js';
import { getInternalAccount } from './internal-account.service.js';

export interface WithdrawalInput {
  accountId: string;
  userId: string;
  idempotencyKey: string;
  amount: string;
}

export interface WithdrawalResult {
  transaction_id: string;
  account_id: string;
  amount: { currency: string; amount: string };
}

interface WithdrawalAccount {
  wallet_id: string;
  account_id: string;
  currency: string;
}

interface ExistingOperation {
  transaction_id: string;
  description: string | null;
  account_id: string | null;
  amount: string | null;
  currency: string | null;
}

async function findExistingOperation(
  client: PoolClient,
  idempotencyKey: string,
): Promise<ExistingOperation | null> {
  const result = await client.query<ExistingOperation>(
    `SELECT t.id AS transaction_id, t.description,
            e.account_id, e.amount::text AS amount, RTRIM(e.currency) AS currency
       FROM transactions t
       LEFT JOIN entries e
         ON e.transaction_id = t.id AND e.direction = 'debit'
      WHERE t.idempotency_key = $1
      ORDER BY e.id
      LIMIT 1`,
    [idempotencyKey],
  );
  return result.rows[0] ?? null;
}

function isSameWithdrawal(
  existing: ExistingOperation,
  input: WithdrawalInput,
  currency: string,
  amount: string,
): boolean {
  return existing.description === 'Retiro de cuenta'
    && existing.account_id === input.accountId
    && existing.currency === currency
    && existing.amount !== null
    && normalizeDecimal(existing.amount, 2) === amount;
}

export async function withdrawFromAccount(
  input: WithdrawalInput,
): Promise<WithdrawalResult> {
  const amount = normalizeDecimal(input.amount, 2);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const accountResult = await client.query<WithdrawalAccount>(
      `SELECT w.id AS wallet_id, a.id AS account_id,
              RTRIM(a.currency) AS currency
         FROM wallets w
         JOIN accounts a ON a.wallet_id = w.id
        WHERE a.id = $1 AND a.user_id = $2 AND w.user_id = $2
          AND a.account_type = 'user' AND a.closed_at IS NULL
        FOR UPDATE OF w`,
      [input.accountId, input.userId],
    );
    const account = accountResult.rows[0];
    if (!account) throw new AppError('Cuenta no encontrada', 404);

    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [`operation:${input.idempotencyKey}`],
    );
    const existing = await findExistingOperation(client, input.idempotencyKey);
    if (existing) {
      if (!isSameWithdrawal(existing, input, account.currency, amount)) {
        throw new AppError('Idempotency-Key ya usado con otra solicitud', 409);
      }

      await client.query('COMMIT');
      return {
        transaction_id: existing.transaction_id,
        account_id: input.accountId,
        amount: { currency: account.currency, amount },
      };
    }

    const balanceResult = await client.query<{ sufficient: boolean }>(
      `SELECT COALESCE(b.balance, 0) >= $2::numeric AS sufficient
         FROM accounts a
         LEFT JOIN account_balances b
           ON b.account_id = a.id AND b.currency = a.currency
        WHERE a.id = $1`,
      [input.accountId, amount],
    );
    if (!balanceResult.rows[0]?.sufficient) {
      throw new AppError('Saldo disponible insuficiente', 422);
    }

    const transactionResult = await client.query<{ id: string }>(
      `INSERT INTO transactions (idempotency_key, description)
       VALUES ($1, 'Retiro de cuenta') RETURNING id`,
      [input.idempotencyKey],
    );
    const transactionId = transactionResult.rows[0].id;
    const externalAccountId = await getInternalAccount(
      client,
      account.currency,
      'external',
    );
    await client.query(
      `INSERT INTO entries
        (transaction_id, account_id, amount, direction, currency)
       VALUES ($1, $2, $3, 'debit', $4), ($1, $5, $3, 'credit', $4)`,
      [
        transactionId,
        input.accountId,
        amount,
        account.currency,
        externalAccountId,
      ],
    );

    await client.query('COMMIT');
    return {
      transaction_id: transactionId,
      account_id: input.accountId,
      amount: { currency: account.currency, amount },
    };
  } catch (error) {
    await client.query('ROLLBACK');
    if (
      typeof error === 'object'
      && error !== null
      && 'code' in error
      && error.code === '23505'
    ) {
      throw new AppError('Idempotency-Key ya usado con otra solicitud', 409);
    }
    throw error;
  } finally {
    client.release();
  }
}
