import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('DB_HOST', 'localhost');
vi.stubEnv('DB_NAME', 'test');
vi.stubEnv('DB_USER', 'test');
vi.stubEnv('DB_PASSWORD', 'test');
vi.spyOn(console, 'info').mockImplementation(() => undefined);

let getExchangeRate: typeof import('../../services/exchange-rate.service.js').getExchangeRate;

beforeEach(async () => {
  vi.resetModules();
  ({ getExchangeRate } = await import('../../services/exchange-rate.service.js'));
});

afterEach(() => vi.restoreAllMocks());
afterAll(() => vi.unstubAllEnvs());

const primaryFailure = () => new Response(JSON.stringify({ result: 'error' }), { status: 200 });
const feed = (usd: Record<string, unknown>, date = new Date().toISOString().slice(0, 10)) =>
  new Response(JSON.stringify({ date, usd }), { status: 200 });

describe('getExchangeRate', () => {
  it('preserves the primary provider as the first choice', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      result: 'success', base_code: 'EUR', time_last_update_unix: Math.floor(Date.now() / 1000),
      rates: { ARS: 1234.5 },
    }), { status: 200 }));
    const quote = await getExchangeRate('EUR', 'ARS');
    expect(quote).toMatchObject({ rate: '1234.5', source: 'exchangeRate-api' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('calculates ARS to COP, USD to COP and COP to USD from lowercase USD rates', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).includes('open.er-api')) return primaryFailure();
      return feed({ ars: 1000, cop: 4000 });
    });
    const crossRate = await getExchangeRate('ARS', 'COP');
    expect(crossRate).toMatchObject({ rate: '4', source: 'fawazahmed0-jsdelivr' });
    expect((await getExchangeRate('USD', 'COP')).rate).toBe('4000');
    expect((await getExchangeRate('COP', 'USD')).rate).toBe('0.00025');
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('cdn.jsdelivr')).length).toBe(3);
  });

  it('uses pages.dev when jsDelivr fails', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(primaryFailure())
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(feed({ cop: 4100.5 }));
    const quote = await getExchangeRate('USD', 'COP');
    expect(quote).toMatchObject({ rate: '4100.5', source: 'fawazahmed0-pages' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('tries pages.dev if jsDelivr omits a requested currency', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(primaryFailure())
      .mockResolvedValueOnce(feed({ cop: 4000 }))
      .mockResolvedValueOnce(feed({ ars: 1000, cop: 4000 }));
    const quote = await getExchangeRate('ARS', 'COP');
    expect(quote).toMatchObject({ rate: '4', source: 'fawazahmed0-pages' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('uses a still-valid fallback feed cache if both mirrors fail', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(primaryFailure())
      .mockResolvedValueOnce(feed({ ars: 1000, cop: 4000 }))
      .mockResolvedValueOnce(primaryFailure())
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('', { status: 503 }));
    expect((await getExchangeRate('ARS', 'COP')).rate).toBe('4');
    expect((await getExchangeRate('ARS', 'USD')).rate).toBe('0.001');
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('does not use an expired fallback feed cache', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date());
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(primaryFailure())
      .mockResolvedValueOnce(feed({ ars: 1000, cop: 4000 }))
      .mockResolvedValueOnce(primaryFailure())
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('', { status: 503 }));
    expect((await getExchangeRate('ARS', 'COP')).rate).toBe('4');
    vi.advanceTimersByTime(7 * 60 * 60_000);
    await expect(getExchangeRate('ARS', 'USD')).rejects.toBeInstanceOf(AggregateError);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    vi.useRealTimers();
  });

  it('shares one fallback fetch among simultaneous requests', async () => {
    let resolveFeed!: (response: Response) => void;
    const delayedFeed = new Promise<Response>((resolve) => { resolveFeed = resolve; });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).includes('open.er-api')) return primaryFailure();
      return delayedFeed;
    });
    const first = getExchangeRate('ARS', 'COP');
    const second = getExchangeRate('USD', 'COP');
    await vi.waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => !String(url).includes('open.er-api')).length).toBe(1));
    resolveFeed(feed({ ars: 1000, cop: 4000 }));
    expect((await Promise.all([first, second])).map(({ rate }) => rate)).toEqual(['4', '4000']);
  });

  it('rejects if the primary and both fallback sources fail', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(primaryFailure())
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('', { status: 503 }));
    await expect(getExchangeRate('COP', 'USD')).rejects.toBeInstanceOf(AggregateError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('maps exhausted providers to CONVERSION_UNAVAILABLE for a quote', async () => {
    const { createExchangeQuote } = await import('../../services/exchange-quotes.service.js');
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(primaryFailure())
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('', { status: 503 }));
    await expect(createExchangeQuote({ userId: 'user-1', from: 'COP', to: 'USD', amount: '10.00' }))
      .rejects.toMatchObject({ code: 'CONVERSION_UNAVAILABLE', statusCode: 503 });
  });

  it('rejects zero, negative and non-numeric requested rates', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).includes('open.er-api')) return primaryFailure();
      return feed({ cop: 0, ars: 'not-a-rate', jpy: -1 });
    });
    await expect(getExchangeRate('USD', 'COP')).rejects.toBeInstanceOf(AggregateError);
    await expect(getExchangeRate('ARS', 'COP')).rejects.toBeInstanceOf(AggregateError);
    await expect(getExchangeRate('USD', 'JPY')).rejects.toBeInstanceOf(AggregateError);
    expect(fetchMock).toHaveBeenCalledTimes(9);
  });
});
