import { beforeEach, describe, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../config/db.js', () => ({ pool: { query } }));

import { getAccountsByUserId, getBalanceByAccountId } from '../../services/accounts.service.js';

describe('getAccountsByUserId', () => {
  beforeEach(() => query.mockReset());

  it('returns the account rows for the authenticated user', async () => {
    const accounts = [
      {
        id: '10000000-0000-4000-8000-000000000001',
        user_id: '20000000-0000-4000-8000-000000000001',
        wallet_id: '40000000-0000-4000-8000-000000000001',
        currency: 'USD',
        account_type: 'user',
        allow_negative: false,
        balance: '325.00000000',
      },
      {
        id: '10000000-0000-4000-8000-000000000002',
        user_id: '20000000-0000-4000-8000-000000000001',
        wallet_id: '40000000-0000-4000-8000-000000000001',
        currency: 'ARS',
        account_type: 'user',
        allow_negative: false,
        balance: '0',
      },
    ];
    query.mockResolvedValueOnce({ rows: accounts });

    await expect(
      getAccountsByUserId('20000000-0000-4000-8000-000000000001'),
    ).resolves.toEqual(accounts);

    const [sql, parameters] = query.mock.calls[0];
    expect(parameters).toEqual(['20000000-0000-4000-8000-000000000001']);
    expect(sql).toContain('a.user_id = $1');
    expect(sql).toContain('a.wallet_id');
    expect(sql).toContain("a.account_type = 'user'");
    expect(sql).toContain('a.closed_at IS NULL');
    expect(sql).toContain('LEFT JOIN account_balances b');
    expect(sql).toContain('COALESCE(b.balance, 0)::text AS balance');
    expect(sql).toContain('ORDER BY RTRIM(a.currency), a.id');
  });

  it('returns an empty list when the user has no active accounts', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await expect(getAccountsByUserId('20000000-0000-4000-8000-000000000099'))
      .resolves.toEqual([]);
  });

  it('passes the owner identifier as a parameter rather than embedding user input in SQL', async () => {
    const userId = "20000000-0000-4000-8000-000000000099' OR TRUE --";
    query.mockResolvedValueOnce({ rows: [] });

    await expect(getAccountsByUserId(userId)).resolves.toEqual([]);

    const [sql, parameters] = query.mock.calls[0];
    expect(parameters).toEqual([userId]);
    expect(sql).toContain('a.user_id = $1');
    expect(sql).not.toContain(userId);
  });

  it('propagates database errors to the HTTP error handler', async () => {
    const databaseError = new Error('database unavailable');
    query.mockRejectedValueOnce(databaseError);

    await expect(getAccountsByUserId('20000000-0000-4000-8000-000000000001'))
      .rejects.toBe(databaseError);
  });
});

describe('getBalanceByAccountId', () => {
  beforeEach(() => query.mockReset());

  it('returns the balance of the account including its wallet_id', async () => {
    const balanceAccount = {
      id: '10000000-0000-4000-8000-000000000001',
      user_id: '20000000-0000-4000-8000-000000000001',
      wallet_id: '40000000-0000-4000-8000-000000000001',
      currency: 'USD',
      account_type: 'user',
      allow_negative: false,
      balance: '325.00000000',
    };
    query.mockResolvedValueOnce({ rows: [balanceAccount] });

    await expect(
      getBalanceByAccountId('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001'),
    ).resolves.toEqual({
      account_id: '10000000-0000-4000-8000-000000000001',
      wallet_id: '40000000-0000-4000-8000-000000000001',
      currency: 'USD',
      balance: '325.00000000',
    });

    const [sql, parameters] = query.mock.calls[0];
    expect(parameters).toEqual([
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
    ]);
    expect(sql).toContain('a.user_id = $2');
    expect(sql).toContain('a.wallet_id');
    expect(sql).toContain('COALESCE(b.balance, 0)::text AS balance');
  });

  it('returns null when the account does not belong to the user', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await expect(
      getBalanceByAccountId('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001'),
    ).resolves.toEqual(null);
  });
});
