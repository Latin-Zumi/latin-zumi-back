import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getAdminSettings, getExchangeRate } = vi.hoisted(() => ({
  getAdminSettings: vi.fn(),
  getExchangeRate: vi.fn(),
}));

vi.mock('../../services/admin.service.js', () => ({ getAdminSettings }));
vi.mock('../../services/exchange-rate.service.js', () => ({ getExchangeRate }));

import { getWalletRates } from '../../services/wallet-rates.service.js';

describe('getWalletRates', () => {
  beforeEach(() => {
    getAdminSettings.mockReset();
    getExchangeRate.mockReset();
    getAdminSettings.mockResolvedValue({
      exchange_spread_percent: '0.00',
      interest_rates: [
        { currency: 'ARS', annual_percent: '0.00' },
        { currency: 'COP', annual_percent: '0.00' },
        { currency: 'EUR', annual_percent: '0.00' },
        { currency: 'USD', annual_percent: '0.00' },
      ],
    });
  });

  it('returns the four published rates with the oldest observation and the loaded parameters', async () => {
    getExchangeRate.mockImplementation(async (_base: string, currency: string) => ({
      rate: currency === 'ARS' ? '1450.25' : currency === 'COP' ? '4100.5' : '0.92',
      source: 'exchangeRate-api',
      observedAt: new Date('2026-11-04T18:00:00.000Z'),
    }));

    const result = await getWalletRates();

    expect(result).toEqual({
      base: 'USD',
      rates: { USD: '1', ARS: '1450.25', COP: '4100.5', EUR: '0.92' },
      observed_at: '2026-11-04T18:00:00.000Z',
      exchange_spread_percent: '0.00',
      interest_rates: [
        { currency: 'ARS', annual_percent: '0.00' },
        { currency: 'COP', annual_percent: '0.00' },
        { currency: 'EUR', annual_percent: '0.00' },
        { currency: 'USD', annual_percent: '0.00' },
      ],
    });

    expect(getExchangeRate).toHaveBeenCalledTimes(3);
    expect(getExchangeRate).toHaveBeenNthCalledWith(1, 'USD', 'ARS');
    expect(getExchangeRate).toHaveBeenNthCalledWith(2, 'USD', 'COP');
    expect(getExchangeRate).toHaveBeenNthCalledWith(3, 'USD', 'EUR');
  });

  it('does not apply the spread to the published rates', async () => {
    getExchangeRate.mockResolvedValue({ rate: '1450.25', source: 'exchangeRate-api', observedAt: new Date('2026-11-04T18:00:00.000Z') });
    const result = await getWalletRates();

    expect(result.rates.ARS).toBe('1450.25');
    expect(result.exchange_spread_percent).toBe('0.00');
  });

  it('maps a failed rate lookup to CONVERSION_UNAVAILABLE without partial data', async () => {
    getExchangeRate.mockRejectedValueOnce(new AggregateError([new Error('ExchangeRate-API HTTP 500')], 'No hay una tasa de cambio vigente disponible'));

    const promise = getWalletRates();
    await expect(promise).rejects.toMatchObject({ statusCode: 503, code: 'CONVERSION_UNAVAILABLE' });
    await expect(promise).rejects.toThrow('No hay una tasa de cambio vigente disponible; reintenta más tarde');
  });
});
