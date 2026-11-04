import { beforeEach, describe, expect, it, vi } from 'vitest';

const { query, connect, clientQuery, release, getAccountsByUserId, listWalletTransactions } = vi.hoisted(() => {
  const clientQuery = vi.fn();
  const release = vi.fn();
  return {
    query: vi.fn(),
    connect: vi.fn(async () => ({ query: clientQuery, release })),
    clientQuery,
    release,
    getAccountsByUserId: vi.fn(),
    listWalletTransactions: vi.fn(),
  };
});
vi.mock('../../config/db.js', () => ({ pool: { query, connect } }));
vi.mock('../../services/accounts.service.js', () => ({ getAccountsByUserId }));
vi.mock('../../services/wallet-transactions.service.js', () => ({ listWalletTransactions }));

import { getAdminUser, patchAdminSettings } from '../../services/admin.service.js';

describe('getAdminUser', () => {
  beforeEach(() => {
    query.mockReset();
    connect.mockClear();
    clientQuery.mockReset();
    release.mockReset();
    getAccountsByUserId.mockReset();
    listWalletTransactions.mockReset();
  });

  it('returns account and wallet transaction shapes from their shared services', async () => {
    const user = { id: 'user-id', nombre: 'Ana', email: 'ana@example.com' };
    const transaction = {
      id: 'tx-id', type: 'deposit', description: 'Ingreso', currency: 'USD',
      amount: '10.00', status: 'completed', created_at: '2026-11-03T12:00:00.000Z',
      counterparty: null, exchange: null,
    };
    query.mockResolvedValueOnce({ rows: [user] });
    getAccountsByUserId.mockResolvedValueOnce([{
      id: 'account-id', user_id: 'user-id', wallet_id: 'wallet-id', currency: 'USD',
      account_type: 'user', allow_negative: false, balance: '20.00',
    }]);
    listWalletTransactions.mockResolvedValueOnce({ items: [transaction] });

    await expect(getAdminUser('user-id')).resolves.toEqual({
      user,
      balances: [{ id: 'account-id', wallet_id: 'wallet-id', account_id: 'account-id', currency: 'USD', balance: '20.00' }],
      recent_transactions: [transaction],
    });
    expect(listWalletTransactions).toHaveBeenCalledWith({ userId: 'user-id', page: 1, limit: 10 });
  });
});

function queueSettingsSnapshot() {
  query
    .mockResolvedValueOnce({ rows: [{ exchange_spread_percent: '5.00', updated_at: '2026-11-04T00:00:00.000Z', updated_by: null }] })
    .mockResolvedValueOnce({ rows: [{ currency: 'USD', annual_percent: '10.00' }] });
}

describe('patchAdminSettings', () => {
  beforeEach(() => {
    query.mockReset();
    connect.mockClear();
    clientQuery.mockReset();
    release.mockReset();
  });

  it('does not update or record history when the spread is unchanged', async () => {
    clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ value: '5.00' }] })
      .mockResolvedValueOnce({ rows: [] });
    queueSettingsSnapshot();

    await expect(patchAdminSettings('admin-id', { exchange_spread_percent: '5.0' }))
      .resolves.toMatchObject({ exchange_spread_percent: '5.00' });

    expect(clientQuery).toHaveBeenCalledTimes(3);
    expect(clientQuery.mock.calls.map(([sql]) => sql)).not.toContainEqual(expect.stringContaining('UPDATE app_settings'));
    expect(clientQuery.mock.calls.map(([sql]) => sql)).not.toContainEqual(expect.stringContaining('INSERT INTO settings_history'));
    expect(release).toHaveBeenCalledOnce();
  });

  it('does not update or record history when an interest rate is unchanged', async () => {
    clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ value: '10.00' }] })
      .mockResolvedValueOnce({ rows: [] });
    queueSettingsSnapshot();

    await patchAdminSettings('admin-id', { interest_rates: { USD: 10 } });

    expect(clientQuery).toHaveBeenCalledTimes(3);
    expect(clientQuery.mock.calls.map(([sql]) => sql)).not.toContainEqual(expect.stringContaining('UPDATE interest_rates'));
    expect(clientQuery.mock.calls.map(([sql]) => sql)).not.toContainEqual(expect.stringContaining('INSERT INTO settings_history'));
  });

  it('updates and records only the field that changed', async () => {
    clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ value: '5.00' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ value: '10.00' }] })
      .mockResolvedValueOnce({ rows: [] });
    queueSettingsSnapshot();

    await patchAdminSettings('admin-id', {
      exchange_spread_percent: 6,
      interest_rates: { USD: '10.00' },
    });

    const statements = clientQuery.mock.calls.map(([sql]) => String(sql));
    expect(statements.filter((sql) => sql.includes('UPDATE app_settings'))).toHaveLength(1);
    expect(statements.filter((sql) => sql.includes('INSERT INTO settings_history'))).toHaveLength(1);
    expect(statements.some((sql) => sql.includes('UPDATE interest_rates'))).toBe(false);
  });
});
