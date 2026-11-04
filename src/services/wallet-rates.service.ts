import { getAdminSettings } from './admin.service.js';
import { getExchangeRate, type ExchangeRateQuote } from './exchange-rate.service.js';
import { AppError } from '../utils/AppError.js';

const CURRENCIES = ['ARS', 'COP', 'EUR'] as const;

export interface WalletRates {
  base: string;
  rates: Record<string, string>;
  observed_at: string;
  exchange_spread_percent: string;
  interest_rates: Array<{ currency: string; annual_percent: string }>;
}

async function fetchQuotes(): Promise<ExchangeRateQuote[]> {
  try {
    return await Promise.all(CURRENCIES.map((currency) => getExchangeRate('USD', currency)));
  } catch {
    throw new AppError('No hay una tasa de cambio vigente disponible; reintenta más tarde', 503, 'CONVERSION_UNAVAILABLE');
  }
}

export async function getWalletRates(): Promise<WalletRates> {
  const settings = await getAdminSettings();
  const quotes = await fetchQuotes();
  const rates = {
    USD: '1',
    ...Object.fromEntries(CURRENCIES.map((currency, index) => [currency, quotes[index].rate])),
  };
  return {
    base: 'USD',
    rates,
    observed_at: new Date(Math.min(...quotes.map((quote) => quote.observedAt.getTime()))).toISOString(),
    exchange_spread_percent: settings.exchange_spread_percent,
    interest_rates: settings.interest_rates,
  };
}
