import { beforeEach, describe, expect, it, vi } from 'vitest';

const { client, connect, query, release, getInternalAccount } = vi.hoisted(() => {
  const query = vi.fn();
  const release = vi.fn();
  const client = { query, release };
  return {
    client,
    connect: vi.fn(async () => client),
    query,
    release,
    getInternalAccount: vi.fn(),
  };
});

vi.mock('../../config/db.js', () => ({ pool: { connect } }));
vi.mock('../../services/internal-account.service.js', () => ({ getInternalAccount }));

import { accrueInterest } from '../../services/interest.service.js';

const accountId = '10000000-0000-4000-8000-000000000001';
const userId = '20000000-0000-4000-8000-000000000001';
const expenseId = '10000000-0000-4000-8000-000000000099';
const transactionId = '30000000-0000-4000-8000-000000000123';

function mockRunSql({
  days,
  accounts,
  exists = false,
}: {
  days: string[];
  accounts: Array<{ id: string; user_id: string; currency: string; balance: string; rate: string }>;
  exists?: boolean;
}) {
  query.mockImplementation(async (statement: string) => {
    if (statement.includes('FROM interest_runs ORDER BY')) return { rows: days.length ? [{ run_date: '2026-10-31' }] : [] };
    if (statement.includes('FROM generate_series')) return { rows: days.map((day) => ({ day })) };
    if (statement.includes('FROM accounts a LEFT JOIN entries')) return { rows: accounts };
    if (statement.includes('SELECT 1 FROM transactions')) {
      return { rows: exists ? [{ '?column?': 1 }] : [], rowCount: exists ? 1 : 0 };
    }
    if (statement.includes('INSERT INTO transactions')) return { rows: [{ id: transactionId }] };
    return { rows: [] };
  });
}

describe('accrueInterest', () => {
  beforeEach(() => {
    query.mockReset();
    release.mockReset();
    connect.mockClear();
    getInternalAccount.mockReset();
    getInternalAccount.mockResolvedValue(expenseId);
  });

  it('uses the current rate for every pending day and records one balanced transaction', async () => {
    mockRunSql({
      days: ['2026-11-01'],
      accounts: [{ id: accountId, user_id: userId, currency: 'USD', balance: '1000.00000000', rate: '10.00' }],
    });

    await expect(accrueInterest()).resolves.toEqual({ processed_days: 1, transactions: 1 });

    const accountQuery = query.mock.calls.find(([statement]) =>
      String(statement).includes('FROM accounts a LEFT JOIN entries'),
    );
    expect(accountQuery?.[0]).toContain('SELECT r.annual_percent FROM interest_rates r WHERE r.currency=a.currency');
    expect(accountQuery?.[0]).not.toContain('updated_at::date <=');
    expect(query.mock.calls.some(([statement]) => String(statement).includes('INSERT INTO entries'))).toBe(true);
    expect(query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
    expect(release).toHaveBeenCalledOnce();
  });

  it('processes a day without creating a transaction when the current rate is zero', async () => {
    mockRunSql({
      days: ['2026-11-02'],
      accounts: [{ id: accountId, user_id: userId, currency: 'USD', balance: '1000.00000000', rate: '0.00' }],
    });

    await expect(accrueInterest()).resolves.toEqual({ processed_days: 1, transactions: 0 });

    expect(query.mock.calls.some(([statement]) => String(statement).includes('INSERT INTO transactions'))).toBe(false);
  });

  it('advances the run date without duplicating an existing interest transaction', async () => {
    mockRunSql({
      days: ['2026-11-03'],
      accounts: [{ id: accountId, user_id: userId, currency: 'USD', balance: '1000.00000000', rate: '10.00' }],
      exists: true,
    });

    await expect(accrueInterest()).resolves.toEqual({ processed_days: 1, transactions: 0 });

    expect(query.mock.calls.some(([statement]) => String(statement).includes('INSERT INTO entries'))).toBe(false);
  });

  it('reports zero processed days when there are no pending dates', async () => {
    mockRunSql({ days: [], accounts: [] });

    await expect(accrueInterest()).resolves.toEqual({ processed_days: 0, transactions: 0 });
    expect(release).toHaveBeenCalledOnce();
  });
});
