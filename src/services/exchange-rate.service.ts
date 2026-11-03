import { env } from '../config/env.js';

export interface ExchangeRateQuote {
  rate: string;
  source: 'exchangeRate-api' | 'fawazahmed0-jsdelivr' | 'fawazahmed0-pages';
  observedAt: Date;
}

class RateProviderError extends Error {}
const quoteCache = new Map<string, ExchangeRateQuote>();
interface UsdFeed { date: string; rates: Record<string, unknown>; source: 'fawazahmed0-jsdelivr' | 'fawazahmed0-pages'; }
let fallbackCache: { feed: UsdFeed; expiresAt: number } | undefined;
let fallbackInFlight: Promise<UsdFeed> | undefined;
const fallbackUrls = [
  'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
  'https://latest.currency-api.pages.dev/v1/currencies/usd.json',
] as const;

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

function parseUsdFeed(data: unknown, source: UsdFeed['source']): UsdFeed {
  if (!data || typeof data !== 'object') throw new RateProviderError('Respuesta fallback inválida');
  const body = data as { date?: unknown; usd?: unknown };
  if (typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date) ||
      Number.isNaN(new Date(`${body.date}T00:00:00.000Z`).getTime()) ||
      !body.usd || typeof body.usd !== 'object' || Array.isArray(body.usd)) {
    throw new RateProviderError('Respuesta fallback inválida');
  }
  return { date: body.date, rates: body.usd as Record<string, unknown>, source };
}

function rateFromFeed(feed: UsdFeed, base: string, quote: string): ExchangeRateQuote {
  const rates = Object.fromEntries(Object.entries(feed.rates).map(([code, value]) => [code.toUpperCase(), value]));
  const usdPerBase = base === 'USD' ? 1 : rates[base];
  const usdPerQuote = quote === 'USD' ? 1 : rates[quote];
  if (base !== 'USD' && (typeof usdPerBase !== 'number' || !Number.isFinite(usdPerBase) || usdPerBase <= 0)) {
    throw new RateProviderError(`Tasa fallback inválida para ${base}`);
  }
  if (quote !== 'USD' && (typeof usdPerQuote !== 'number' || !Number.isFinite(usdPerQuote) || usdPerQuote <= 0)) {
    throw new RateProviderError(`Tasa fallback inválida para ${quote}`);
  }
  const rate = (usdPerQuote as number) / (usdPerBase as number);
  return validQuote(rate, new Date(`${feed.date}T00:00:00.000Z`), feed.source);
}

async function fetchUsdFeed(base: string, quote: string): Promise<UsdFeed> {
  const errors: unknown[] = [];
  for (let i = 0; i < fallbackUrls.length; i += 1) {
    try {
      const response = await fetch(fallbackUrls[i], { signal: AbortSignal.timeout(env.EXCHANGE_RATE_TIMEOUT_MS) });
      if (!response.ok) throw new RateProviderError(`Fallback HTTP ${response.status}`);
      const feed = parseUsdFeed(await response.json(), i === 0 ? 'fawazahmed0-jsdelivr' : 'fawazahmed0-pages');
      rateFromFeed(feed, base, quote);
      fallbackCache = { feed, expiresAt: Date.now() + env.EXCHANGE_RATE_FALLBACK_CACHE_TTL_HOURS * 60 * 60_000 };
      return feed;
    } catch (error) {
      errors.push(error);
    }
  }
  throw new AggregateError(errors, 'Fallaron las fuentes fallback');
}

async function fawazahmed0(base: string, quote: string): Promise<ExchangeRateQuote> {
  let cacheHit = false;
  let feed: UsdFeed;
  try {
    if (!fallbackInFlight) fallbackInFlight = fetchUsdFeed(base, quote).finally(() => { fallbackInFlight = undefined; });
    feed = await fallbackInFlight;
  } catch (refreshError) {
    if (!fallbackCache || Date.now() >= fallbackCache.expiresAt) throw refreshError;
    feed = fallbackCache.feed;
    cacheHit = true;
  }
  const result = rateFromFeed(feed, base, quote);
  console.info(JSON.stringify({ event: 'exchange_rate_source', source: result.source, cache_hit: cacheHit }));
  return result;
}

export async function getExchangeRate(base: string, quote: string): Promise<ExchangeRateQuote> {
  const key = `${base}:${quote}`;
  const cached = quoteCache.get(key);
  const maxCacheAge = cached?.source === 'exchangeRate-api'
    ? env.EXCHANGE_RATE_MAX_AGE_HOURS * 60 * 60_000
    : env.EXCHANGE_RATE_FALLBACK_CACHE_TTL_HOURS * 60 * 60_000;
  if (cached && Date.now() - cached.observedAt.getTime() <= maxCacheAge) {
    console.info(JSON.stringify({ event: 'exchange_rate_source', source: cached.source, cache_hit: true }));
    return cached;
  }
  quoteCache.delete(key);
  try {
    const result = await exchangeRateApi(base, quote);
    quoteCache.set(key, result);
    console.info(JSON.stringify({ event: 'exchange_rate_source', source: result.source, cache_hit: false }));
    return result;
  } catch (primaryError) {
    try {
      const result = await fawazahmed0(base, quote);
      quoteCache.set(key, result);
      return result;
    } catch (fallbackError) {
      throw new AggregateError([primaryError, fallbackError], 'No hay una tasa de cambio vigente disponible');
    }
  }
}
