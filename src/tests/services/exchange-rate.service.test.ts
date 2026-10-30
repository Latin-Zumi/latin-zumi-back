import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.stubEnv('DB_HOST', 'localhost');
vi.stubEnv('DB_NAME', 'test');
vi.stubEnv('DB_USER', 'test');
vi.stubEnv('DB_PASSWORD', 'test');

let getExchangeRate: typeof import('../../services/exchange-rate.service.js').getExchangeRate;

beforeAll(async () => {
  ({ getExchangeRate } = await import('../../services/exchange-rate.service.js'));
});

afterAll(() => vi.unstubAllEnvs());

describe('getExchangeRate', () => {
  it('returns the primary provider quote when it is recent and valid', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      result: 'success', base_code: 'EUR', time_last_update_unix: Math.floor(Date.now() / 1000),
      rates: { ARS: 1234.5 },
    }), { status: 200 }));
    const quote = await getExchangeRate('EUR', 'ARS');
    expect(quote).toMatchObject({ rate: '1234.5', source: 'exchangeRate-api' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockRestore();
  });

  it('falls back to Frankfurter when the primary response has no requested currency', async () => {
    const now = new Date();
    const date = `${now.toISOString().slice(0, 10)}`;
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        result: 'success', base_code: 'USD', time_last_update_unix: Math.floor(Date.now() / 1000), rates: {},
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        amount: 1, base: 'USD', date, rates: { COP: 4000 },
      }), { status: 200 }));
    const quote = await getExchangeRate('USD', 'COP');
    expect(quote).toMatchObject({ rate: '4000', source: 'frankfurter' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockRestore();
  });

  it('rejects when both providers fail or return unusable rates', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: 'error' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ amount: 1, base: 'COP', date: '2020-01-01', rates: { USD: 0 } }), { status: 200 }));
    await expect(getExchangeRate('COP', 'USD')).rejects.toBeInstanceOf(AggregateError);
    fetchMock.mockRestore();
  });
});
