
import { pool } from '../config/db.js';
import type { PoolClient } from 'pg';
import { AppError } from '../utils/AppError.js';
import { getInternalAccount } from './internal-account.service.js';
import { multiplyAndRoundHalfUp, normalizeDecimal } from '../utils/decimal.js';

export interface IncomingConversionInput {
  accountId: string;
  userId: string;
  idempotencyKey: string;
  sourceCurrency: string;
  sourceAmount: string;
  destinationCurrency?: string;
}

export interface IncomingConversionResult {
  transaction_id: string;
  wallet_id: string;
  source: { currency: string; amount: string };
  destination: { currency: string; amount: string };
  rate: string;
  rate_source: string;
  rate_observed_at: Date;
  rounding: 'HALF_UP_2';
}

interface WalletAccountRow {
  wallet_id: string;
  primary_currency: string;
  user_id: string;
}

interface ExistingIncoming extends IncomingConversionResult {
  user_id: string;
  account_id: string;
  source_currency: string;
  source_amount: string;
  destination_currency: string;
  destination_amount: string;
}

export interface TransactionSummaryRow {
  id: string;
  description: string | null;
  occurred_at: Date;
}

export async function findTransactionSummary(
  transactionId: string,
): Promise<TransactionSummaryRow> {
  const result = await pool.query<TransactionSummaryRow>(
    `SELECT id, description, occurred_at FROM transactions WHERE id = $1`,
    [transactionId],
  );
  const row = result.rows[0];
  if (!row) throw new AppError('Transacción no encontrada', 404);
  return row;
}

function resultFromRow(row: ExistingIncoming): IncomingConversionResult {
  const sourceAmount = multiplyAndRoundHalfUp(row.source.amount, '1', 2);
  const destinationAmount = multiplyAndRoundHalfUp(row.destination.amount, '1', 2);
  return {
    transaction_id: row.transaction_id,
    wallet_id: row.wallet_id,
    source: { ...row.source, amount: sourceAmount },
    destination: { ...row.destination, amount: destinationAmount },
    rate: row.rate,
    rate_source: row.rate_source,
    rate_observed_at: row.rate_observed_at,
    rounding: row.rounding,
  };
}

export async function recordIncomingConversion(
  input: IncomingConversionInput,
): Promise<IncomingConversionResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const accountResult = await client.query<WalletAccountRow>(
      `SELECT w.id AS wallet_id, RTRIM(w.primary_currency) AS primary_currency,
              w.user_id
         FROM accounts a
         JOIN wallets w ON w.id = a.wallet_id
        WHERE a.id = $1 AND a.account_type = 'user'
          AND a.user_id = $2 AND a.closed_at IS NULL
        FOR UPDATE OF w`,
      [input.accountId, input.userId],
    );
    const wallet = accountResult.rows[0];
    if (!wallet) throw new AppError('Cuenta no encontrada', 404);

    const destinationCurrency = input.destinationCurrency ?? input.sourceCurrency;
    if (destinationCurrency !== input.sourceCurrency) {
      throw new AppError(
        'La moneda del ingreso debe coincidir con la moneda destino',
        400,
        'CURRENCY_MISMATCH',
      );
    }

    const amount = normalizeDecimal(input.sourceAmount, 2);
    if (amount === '0.00') throw new AppError('El importe convertido es menor a 0.01', 422, 'AMOUNT_TOO_SMALL');
    if (amount.split('.')[0].length > 12) throw new AppError('El importe convertido supera el máximo permitido', 422, 'AMOUNT_TOO_LARGE');

    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [`operation:${input.userId}:${input.idempotencyKey}`],
    );
    const previous = await client.query<ExistingIncoming>(
      `SELECT t.id AS transaction_id,
              a.wallet_id,
              a.user_id,
              e.account_id,
              e.currency AS source_currency,
              e.amount::text AS source_amount,
              e.currency AS destination_currency,
              e.amount::text AS destination_amount,
              '1'::text AS rate,
              'identity'::text AS rate_source,
              now() AS rate_observed_at,
              'HALF_UP_2' AS rounding
         FROM transactions t
         JOIN entries e ON e.transaction_id = t.id
         JOIN accounts a ON a.id = e.account_id
        WHERE t.idempotency_key = $1
          AND t.initiator_user_id = $3
          AND e.account_id = $2
          AND e.direction = 'credit'
        LIMIT 1`,
      [input.idempotencyKey, input.accountId, input.userId],
    );
    if (previous.rows[0]) {
      const row = previous.rows[0];
      const sameRequest = row.user_id === input.userId
        && row.wallet_id === wallet.wallet_id
        && row.account_id === input.accountId
        && row.source_currency.trim() === input.sourceCurrency
        && normalizeDecimal(row.source_amount, 2) === normalizeDecimal(input.sourceAmount, 2);
      if (!sameRequest) throw new AppError('Idempotency-Key ya usado con otra solicitud', 409, 'IDEMPOTENCY_CONFLICT');
      await client.query('COMMIT');
      return resultFromRow(row);
    }

    const rate = '1';
    const rateSource = 'identity';
    const observedAt = new Date();

    const transactionResult = await client.query<{ id: string }>(
      `INSERT INTO transactions (idempotency_key, description, type, initiator_user_id)
       VALUES ($1, $2, 'deposit', $3) RETURNING id`,
      [input.idempotencyKey, `Ingreso ${input.sourceCurrency}`, input.userId],
    );
    const transactionId = transactionResult.rows[0].id;
    const externalSource = await getInternalAccount(client, input.sourceCurrency, 'external');
    await client.query(
      `INSERT INTO entries (transaction_id, account_id, amount, direction, currency)
       VALUES ($1, $2, $3, 'debit', $4), ($1, $5, $3, 'credit', $4)`,
      [transactionId, externalSource, amount, input.sourceCurrency, input.accountId],
    );

    await client.query('COMMIT');
    return {
      transaction_id: transactionId,
      wallet_id: wallet.wallet_id,
      source: { currency: input.sourceCurrency, amount },
      destination: { currency: destinationCurrency, amount },
      rate,
      rate_source: rateSource,
      rate_observed_at: observedAt,
      rounding: 'HALF_UP_2',
    };
  } catch (error) {
    await client.query('ROLLBACK');
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
      throw new AppError('Idempotency-Key ya usado con otra solicitud', 409, 'IDEMPOTENCY_CONFLICT');
    }
    throw error;
  } finally {
    client.release();
  }
}
