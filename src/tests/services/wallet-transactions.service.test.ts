import { beforeEach, describe, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../config/db.js', () => ({ pool: { query } }));

import { listWalletTransactions } from '../../services/wallet-transactions.service.js';

describe('listWalletTransactions', () => {
  beforeEach(() => query.mockReset());

  it('keeps the filtered total when the requested page has no rows', async () => {
    query.mockResolvedValueOnce({ rows: [{ total: 3 }] }).mockResolvedValueOnce({ rows: [] });

    await expect(listWalletTransactions({ userId: 'user-1', page: 999, limit: 20 }))
      .resolves.toEqual({ items: [], page: 999, limit: 20, total: 3, totalPages: 1 });

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0]).toContain('SELECT COUNT(*)::int AS total FROM me');
    expect(query.mock.calls[1][0]).not.toContain('COUNT(*) OVER()');
  });

  it('passes type=interest to both queries without rewriting the filter', async () => {
    query.mockResolvedValueOnce({ rows: [{ total: 0 }] }).mockResolvedValueOnce({ rows: [] });

    await listWalletTransactions({ userId: 'user-1', type: 'interest', page: 1, limit: 20 });

    expect(query.mock.calls[0][1]?.[1]).toBe('interest');
    expect(query.mock.calls[1][1]?.[1]).toBe('interest');
    expect(query.mock.calls[1][0]).toContain('ELSE me.type END=$2');
  });
});
