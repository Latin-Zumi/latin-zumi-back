import { env } from '../config/env.js';

export interface ExchangeRateQuote {
  rate: string;
  source: 'exchangeRate-api' | 'frankfurter';
  observedAt: Date;
}

class RateProviderError extends Error {}
const quoteCache = new Map<string, ExchangeRateQuote>();

function validQuote(rate: unknown, observedAt: Date, source: ExchangeRateQuote['source']): ExchangeRateQuote {
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0 || Number.isNaN(observedAt.getTime())) {
    throw new RateProviderError('Tasa inválida');
  }
  const age = Date.now() - observedAt.getTime();
  if (age < -5 * 60_000 || age > env.EXCHANGE_RATE_MAX_AGE_HOURS * 60 * 60_000) {
    throw new RateProviderError('Tasa vencida o con fecha futura');
  }
  return { rate: String(rate), source, observedAt };
}

async function exchangeRateApi(base: string, quote: string): Promise<ExchangeRateQuote> {
  const response = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`, {
    signal: AbortSignal.timeout(env.EXCHANGE_RATE_TIMEOUT_MS),
  });
  if (!response.ok) throw new RateProviderError(`ExchangeRate-API HTTP ${response.status}`);
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object') throw new RateProviderError('Respuesta inválida');
  const body = data as { result?: unknown; base_code?: unknown; time_last_update_unix?: unknown; rates?: Record<string, unknown> };
  if (body.result !== 'success' || body.base_code !== base || typeof body.time_last_update_unix !== 'number') {
    throw new RateProviderError('Respuesta de ExchangeRate-API inválida');
  }
  const rate = body.rates?.[quote];
  return validQuote(rate, new Date(body.time_last_update_unix * 1000), 'exchangeRate-api');
}

async function frankfurter(base: string, quote: string): Promise<ExchangeRateQuote> {
  const url = new URL('https://api.frankfurter.dev/v1/latest');
  url.searchParams.set('from', base);
  url.searchParams.set('to', quote);
  const response = await fetch(url, { signal: AbortSignal.timeout(env.EXCHANGE_RATE_TIMEOUT_MS) });
  if (!response.ok) throw new RateProviderError(`Frankfurter HTTP ${response.status}`);
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object') throw new RateProviderError('Respuesta inválida');
  const body = data as { amount?: unknown; base?: unknown; date?: unknown; rates?: Record<string, unknown> };
  if (body.base !== base || typeof body.date !== 'string') throw new RateProviderError('Respuesta de Frankfurter inválida');
  const observedAt = new Date(`${body.date}T00:00:00.000Z`);
  return validQuote(body.rates?.[quote], observedAt, 'frankfurter');
}

export async function getExchangeRate(base: string, quote: string): Promise<ExchangeRateQuote> {
  const key = `${base}:${quote}`;
  const cached = quoteCache.get(key);
  if (cached && Date.now() - cached.observedAt.getTime() <= env.EXCHANGE_RATE_MAX_AGE_HOURS * 60 * 60_000) {
    return cached;
  }
  quoteCache.delete(key);
  try {
    const result = await exchangeRateApi(base, quote);
    quoteCache.set(key, result);
    return result;
  } catch (primaryError) {
    try {
      const result = await frankfurter(base, quote);
      quoteCache.set(key, result);
      return result;
    } catch (fallbackError) {
      throw new AggregateError([primaryError, fallbackError], 'No hay una tasa de cambio vigente disponible');
    }
  }
}
