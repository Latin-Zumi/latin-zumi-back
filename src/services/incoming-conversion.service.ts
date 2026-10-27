import type { PoolClient } from 'pg';
import { pool } from '../config/db.js';
import { getExchangeRate } from './exchange-rate.service.js';
import { multiplyAndRoundHalfUp, normalizeDecimal } from '../utils/decimal.js';
import { AppError } from '../utils/AppError.js';

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

interface ExistingConversion extends IncomingConversionResult {
  user_id: string;
  account_id: string;
}

async function getInternalAccount(
  client: PoolClient,
  currency: string,
  type: 'external' | 'treasury',
): Promise<string> {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`internal:${type}:${currency}`]);
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

function resultFromRow(row: ExistingConversion): IncomingConversionResult {
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
    if (input.destinationCurrency && input.destinationCurrency !== wallet.primary_currency) {
      throw new AppError('destination_currency debe coincidir con la moneda principal de la wallet', 400);
    }

    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`incoming:${input.idempotencyKey}`]);
    const previous = await client.query<ExistingConversion>(
      `SELECT t.id AS transaction_id, c.wallet_id, c.user_id, c.account_id,
              jsonb_build_object('currency', RTRIM(c.source_currency), 'amount', c.source_amount::text) AS source,
              jsonb_build_object('currency', RTRIM(c.destination_currency), 'amount', c.destination_amount::text) AS destination,
              c.rate::text AS rate, c.rate_source,
              c.rate_observed_at, c.rounding
         FROM transactions t
         JOIN currency_conversions c ON c.transaction_id = t.id
        WHERE t.idempotency_key = $1
        FOR UPDATE OF t`,
      [input.idempotencyKey],
    );
    if (previous.rows[0]) {
      const row = previous.rows[0];
      const sameRequest = row.user_id === input.userId
        && row.wallet_id === wallet.wallet_id
        && row.account_id === input.accountId
        && row.source.currency.trim() === input.sourceCurrency
        && normalizeDecimal(row.source.amount, 2) === normalizeDecimal(input.sourceAmount, 2);
      if (!sameRequest) throw new AppError('Idempotency-Key ya usado con otra solicitud', 409);
      await client.query('COMMIT');
      return resultFromRow(row);
    }

    let rate = '1';
    let rateSource = 'identity';
    let observedAt = new Date();
    if (input.sourceCurrency !== wallet.primary_currency) {
      try {
        const quote = await getExchangeRate(input.sourceCurrency, wallet.primary_currency);
        rate = normalizeDecimal(quote.rate, 12);
        rateSource = quote.source;
        observedAt = quote.observedAt;
      } catch {
        throw new AppError('No hay una tasa de cambio vigente disponible; reintenta más tarde', 503);
      }
    }

    const convertedAmount = input.sourceCurrency === wallet.primary_currency
      ? multiplyAndRoundHalfUp(input.sourceAmount, '1', 2)
      : multiplyAndRoundHalfUp(input.sourceAmount, rate, 2);
    if (convertedAmount === '0.00') {
      throw new AppError('El importe convertido es menor a 0.01', 422);
    }
    if (convertedAmount.split('.')[0].length > 12) {
      throw new AppError('El importe convertido supera el máximo permitido', 422);
    }

    const destinationAccount = await client.query<{ id: string }>(
      `SELECT id FROM accounts
        WHERE wallet_id = $1 AND currency = $2 AND account_type = 'user'
          AND closed_at IS NULL
        LIMIT 1`,
      [wallet.wallet_id, wallet.primary_currency],
    );
    if (!destinationAccount.rows[0]) {
      throw new AppError('La wallet no tiene una cuenta para su moneda principal', 500);
    }

    const transactionResult = await client.query<{ id: string }>(
      `INSERT INTO transactions (idempotency_key, description)
       VALUES ($1, $2) RETURNING id`,
      [input.idempotencyKey, `Ingreso ${input.sourceCurrency} convertido a ${wallet.primary_currency}`],
    );
    const transactionId = transactionResult.rows[0].id;
    const externalSource = await getInternalAccount(client, input.sourceCurrency, 'external');

    await client.query(
      `INSERT INTO currency_conversions
        (transaction_id, wallet_id, account_id, user_id,
         source_currency, source_amount, destination_currency, destination_amount,
         rate, rate_source, rate_observed_at, rounding)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'HALF_UP_2')`,
      [transactionId, wallet.wallet_id, input.accountId, input.userId,
       input.sourceCurrency, input.sourceAmount, wallet.primary_currency,
       convertedAmount, rate, rateSource, observedAt],
    );

    if (input.sourceCurrency === wallet.primary_currency) {
      await client.query(
        `INSERT INTO entries (transaction_id, account_id, amount, direction, currency)
         VALUES ($1, $2, $3, 'debit', $4), ($1, $5, $3, 'credit', $4)`,
        [transactionId, externalSource, convertedAmount, input.sourceCurrency, destinationAccount.rows[0].id],
      );
    } else {
      const sourceTreasury = await getInternalAccount(client, input.sourceCurrency, 'treasury');
      const destinationTreasury = await getInternalAccount(client, wallet.primary_currency, 'treasury');
      await client.query(
        `INSERT INTO entries (transaction_id, account_id, amount, direction, currency)
         VALUES ($1, $2, $3, 'debit', $4),
                ($1, $5, $3, 'credit', $4),
                ($1, $6, $7, 'debit', $8),
                ($1, $9, $7, 'credit', $8)`,
        [transactionId, externalSource, input.sourceAmount, input.sourceCurrency,
         sourceTreasury, destinationTreasury, convertedAmount, wallet.primary_currency,
         destinationAccount.rows[0].id],
      );
    }

    await client.query('COMMIT');
    return {
      transaction_id: transactionId,
      wallet_id: wallet.wallet_id,
      source: { currency: input.sourceCurrency, amount: input.sourceAmount },
      destination: { currency: wallet.primary_currency, amount: convertedAmount },
      rate,
      rate_source: rateSource,
      rate_observed_at: observedAt,
      rounding: 'HALF_UP_2',
    };
  } catch (error) {
    await client.query('ROLLBACK');
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
      throw new AppError('Idempotency-Key ya usado con otra solicitud', 409);
    }
    throw error;
  } finally {
    client.release();
  }
}
