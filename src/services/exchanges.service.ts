import type { PoolClient } from 'pg';
import { pool } from '../config/db.js';
import { AppError } from '../utils/AppError.js';
import { getAccountsByUserId } from './accounts.service.js';
import { getInternalAccount } from './internal-account.service.js';
import { normalizeDecimal } from '../utils/decimal.js';

export interface ExchangeTransaction {
  id: string;
  type: 'exchange';
  status: 'completed';
  currency: string;
  amount: string;
  created_at: string;
  description: string;
  counterparty: null;
  exchange: { to_currency: string; to_amount: string; rate: string };
}

export interface ExchangeResult {
  transaction: ExchangeTransaction;
  balances: Awaited<ReturnType<typeof getAccountsByUserId>>;
}

interface ExchangeTransactionInput {
  id: string;
  occurred_at: Date;
  description: string | null;
  from_currency: string;
  from_amount: string;
  to_currency: string;
  to_amount: string;
  rate: string;
}

interface ExistingExchange extends ExchangeTransactionInput {
  quote_id: string;
}

interface ExchangeQuoteRecord {
  id: string;
  user_id: string;
  from_currency: string;
  to_currency: string;
  from_amount: string;
  to_amount: string;
  rate: string;
  rate_source: string;
  rate_observed_at: Date;
  expires_at: Date;
  used_transaction_id: string | null;
}

async function findExistingExchange(
  client: PoolClient,
  idempotencyKey: string,
): Promise<ExistingExchange | null> {
  const result = await client.query<ExistingExchange>(
    `SELECT t.id, t.occurred_at, t.description,
            q.id AS quote_id,
            RTRIM(q.from_currency) AS from_currency,
            q.from_amount::text AS from_amount,
            RTRIM(q.to_currency) AS to_currency,
            q.to_amount::text AS to_amount,
            q.rate::text AS rate
       FROM transactions t
       JOIN exchange_quotes q ON q.used_transaction_id = t.id
      WHERE t.idempotency_key = $1`,
    [idempotencyKey],
  );
  return result.rows[0] ?? null;
}

function toExchangeTransaction(row: ExchangeTransactionInput): ExchangeTransaction {
  return {
    id: row.id,
    type: 'exchange',
    status: 'completed',
    currency: row.from_currency,
    amount: normalizeDecimal(row.from_amount, 2),
    created_at: row.occurred_at.toISOString(),
    description: row.description ?? `Cambio ${row.from_currency} a ${row.to_currency}`,
    counterparty: null,
    exchange: {
      to_currency: row.to_currency,
      to_amount: normalizeDecimal(row.to_amount, 2),
      rate: normalizeDecimal(row.rate, 12),
    },
  };
}

export async function executeExchange(input: {
  userId: string;
  idempotencyKey: string;
  quoteId: string;
}): Promise<ExchangeResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const walletResult = await client.query<{ id: string }>(
      `SELECT id FROM wallets WHERE user_id = $1 FOR UPDATE`,
      [input.userId],
    );
    const wallet = walletResult.rows[0];
    if (!wallet) {
      throw new AppError('Wallet no encontrada', 404, 'WALLET_NOT_FOUND');
    }

    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [`operation:${input.idempotencyKey}`],
    );

    const previous = await findExistingExchange(client, input.idempotencyKey);
    if (previous) {
      if (previous.quote_id !== input.quoteId) {
        throw new AppError('Idempotency-Key ya usado con otra solicitud', 409, 'IDEMPOTENCY_CONFLICT');
      }
      const balances = await getAccountsByUserId(input.userId, client);
      await client.query('COMMIT');
      return { transaction: toExchangeTransaction(previous), balances };
    }

    const quoteResult = await client.query<ExchangeQuoteRecord>(
      `SELECT id, user_id, RTRIM(from_currency) AS from_currency,
              RTRIM(to_currency) AS to_currency, from_amount::text AS from_amount,
              to_amount::text AS to_amount, rate::text AS rate,
              rate_source, rate_observed_at, expires_at, used_transaction_id
         FROM exchange_quotes
        WHERE id = $1 AND user_id = $2
        FOR UPDATE`,
      [input.quoteId, input.userId],
    );
    const quote = quoteResult.rows[0];
    if (!quote) {
      throw new AppError('Cotización no encontrada', 404, 'QUOTE_NOT_FOUND');
    }
    if (quote.used_transaction_id) {
      throw new AppError('La cotización ya fue usada', 409, 'QUOTE_ALREADY_USED');
    }
    if (new Date(quote.expires_at) <= new Date()) {
      throw new AppError('La cotización venció', 410, 'QUOTE_EXPIRED');
    }

    const source = await client.query<{ account_id: string; sufficient: boolean }>(
      `SELECT a.id AS account_id,
              COALESCE(b.balance, 0) >= $3::numeric AS sufficient
         FROM accounts a
         LEFT JOIN account_balances b
           ON b.account_id = a.id AND b.currency = a.currency
        WHERE a.wallet_id = $1
          AND RTRIM(a.currency) = $2
          AND a.account_type = 'user'
          AND a.closed_at IS NULL`,
      [wallet.id, quote.from_currency, quote.from_amount],
    );
    if (!source.rows[0]?.sufficient) {
      throw new AppError('Saldo disponible insuficiente', 422, 'INSUFFICIENT_FUNDS');
    }

    let destination = await client.query<{ id: string }>(
      `SELECT id FROM accounts
        WHERE wallet_id = $1 AND RTRIM(currency) = $2
          AND account_type = 'user' AND closed_at IS NULL
        LIMIT 1`,
      [wallet.id, quote.to_currency],
    );
    if (!destination.rows[0]) {
      destination = await client.query<{ id: string }>(
        `INSERT INTO accounts (user_id, wallet_id, currency, account_type, allow_negative)
         VALUES ($1, $2, $3, 'user', false) RETURNING id`,
        [input.userId, wallet.id, quote.to_currency],
      );
    }

    const transactionResult = await client.query<{ id: string; occurred_at: Date }>(
      `INSERT INTO transactions (idempotency_key, description, type)
       VALUES ($1, $2, 'exchange') RETURNING id, occurred_at`,
      [input.idempotencyKey, `Cambio ${quote.from_currency} a ${quote.to_currency}`],
    );
    const transactionId = transactionResult.rows[0].id;

    const sourceTreasury = await getInternalAccount(client, quote.from_currency, 'treasury');
    const destinationTreasury = await getInternalAccount(client, quote.to_currency, 'treasury');
    await client.query(
      `INSERT INTO entries (transaction_id, account_id, amount, direction, currency)
       VALUES ($1, $2, $3, 'debit', $4),
              ($1, $5, $3, 'credit', $4),
              ($1, $6, $7, 'debit', $8),
              ($1, $9, $7, 'credit', $8)`,
      [
        transactionId,
        source.rows[0].account_id,
        quote.from_amount,
        quote.from_currency,
        sourceTreasury,
        destinationTreasury,
        quote.to_amount,
        quote.to_currency,
        destination.rows[0].id,
      ],
    );

    await client.query(
      `INSERT INTO currency_conversions
        (transaction_id, wallet_id, account_id, user_id,
         source_currency, source_amount, destination_currency, destination_amount,
         rate, rate_source, rate_observed_at, rounding)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'HALF_UP_2')`,
      [
        transactionId,
        wallet.id,
        destination.rows[0].id,
        input.userId,
        quote.from_currency,
        quote.from_amount,
        quote.to_currency,
        quote.to_amount,
        quote.rate,
        quote.rate_source,
        quote.rate_observed_at,
      ],
    );

    await client.query(
      `UPDATE exchange_quotes SET used_transaction_id = $1 WHERE id = $2 AND user_id = $3`,
      [transactionId, input.quoteId, input.userId],
    );

    const balances = await getAccountsByUserId(input.userId, client);
    await client.query('COMMIT');

    const transaction = toExchangeTransaction({
      id: transactionId,
      occurred_at: transactionResult.rows[0].occurred_at,
      description: `Cambio ${quote.from_currency} a ${quote.to_currency}`,
      from_currency: quote.from_currency,
      from_amount: quote.from_amount,
      to_currency: quote.to_currency,
      to_amount: quote.to_amount,
      rate: quote.rate,
    });

    return { transaction, balances };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
