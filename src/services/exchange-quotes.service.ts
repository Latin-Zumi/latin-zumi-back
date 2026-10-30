import { pool } from '../config/db.js';
import { getExchangeRate } from './exchange-rate.service.js';
import { multiplyAndRoundHalfUp, normalizeDecimal } from '../utils/decimal.js';
import { AppError } from '../utils/AppError.js';

export interface ExchangeQuote {
  quote_id: string;
  from: string;
  to: string;
  from_amount: string;
  rate: string;
  to_amount: string;
  expires_at: string;
}

interface ExchangeQuoteRow {
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

export async function createExchangeQuote(input: {
  userId: string;
  from: string;
  to: string;
  amount: string;
}): Promise<ExchangeQuote> {
  if (input.from === input.to) {
    throw new AppError('Las monedas deben ser distintas', 400, 'SAME_CURRENCY');
  }

  const amount = normalizeDecimal(input.amount, 2);
  let quote;
  try {
    quote = await getExchangeRate(input.from, input.to);
  } catch {
    throw new AppError(
      'No hay una tasa de cambio vigente disponible; reintenta más tarde',
      503,
      'CONVERSION_UNAVAILABLE',
    );
  }

  const toAmount = multiplyAndRoundHalfUp(amount, quote.rate, 2);
  if (toAmount === '0.00') {
    throw new AppError('El importe convertido es menor a 0.01', 422, 'AMOUNT_TOO_SMALL');
  }

  const result = await pool.query<ExchangeQuoteRow>(
    `INSERT INTO exchange_quotes
       (user_id, from_currency, to_currency, from_amount, to_amount,
        rate, rate_source, rate_observed_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + interval '60 seconds')
     RETURNING id, user_id,
               RTRIM(from_currency) AS from_currency,
               RTRIM(to_currency) AS to_currency,
               from_amount::text, to_amount::text, rate::text,
               rate_source, rate_observed_at, expires_at, used_transaction_id`,
    [
      input.userId,
      input.from,
      input.to,
      amount,
      toAmount,
      normalizeDecimal(quote.rate, 12),
      quote.source,
      quote.observedAt,
    ],
  );

  const row = result.rows[0];
  return {
    quote_id: row.id,
    from: row.from_currency,
    to: row.to_currency,
    from_amount: row.from_amount,
    rate: row.rate,
    to_amount: row.to_amount,
    expires_at: row.expires_at.toISOString(),
  };
}
