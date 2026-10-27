import { beforeEach, describe, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../config/db.js', () => ({ pool: { query } }));

import { getAccountsByUserId } from './accounts.service.js';

describe('getAccountsByUserId', () => {
  beforeEach(() => query.mockReset());

  it('returns the account rows for the authenticated user', async () => {
    const accounts = [
      {
        id: '10000000-0000-4000-8000-000000000001',
        user_id: '20000000-0000-4000-8000-000000000001',
        currency: 'USD',
        account_type: 'user',
        allow_negative: false,
        balance: '325.00000000',
      },
    ];
    query.mockResolvedValueOnce({ rows: accounts });

    await expect(
      getAccountsByUserId('20000000-0000-4000-8000-000000000001'),
    ).resolves.toEqual(accounts);

    const [sql, parameters] = query.mock.calls[0];
    expect(parameters).toEqual(['20000000-0000-4000-8000-000000000001']);
    expect(sql).toContain('a.user_id = $1');
    expect(sql).toContain("a.account_type = 'user'");
    expect(sql).toContain('a.closed_at IS NULL');
    expect(sql).toContain('COALESCE(b.balance, 0)::text AS balance');
    expect(sql).toContain('ORDER BY RTRIM(a.currency), a.id');
  });

  it('returns an empty list when the user has no active accounts', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await expect(getAccountsByUserId('20000000-0000-4000-8000-000000000099'))
      .resolves.toEqual([]);
  });
});
