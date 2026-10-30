import { beforeEach, describe, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../config/db.js', () => ({ pool: { query } }));

import { getTransactionsByUserId } from '../../services/transactions.service.js';

const userId = '20000000-0000-4000-8000-000000000001';
const transactionId = '30000000-0000-4000-8000-000000000101';
const accountId = '10000000-0000-4000-8000-000000000001';

describe('getTransactionsByUserId', () => {
  beforeEach(() => query.mockReset());

  it('returns a paginated transaction with only the user-owned entries', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ total: '1' }] })
      .mockResolvedValueOnce({
        rows: [{
          id: transactionId,
          idempotency_key: 'seed:portfolio:01:usd:movement-1',
          description: 'Movimiento demo USD 1',
          occurred_at: new Date('2026-02-01T12:00:00.000Z'),
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          transaction_id: transactionId,
          id: '2',
          account_id: accountId,
          amount: '125.00000000',
          direction: 'credit',
          currency: 'USD',
          created_at: new Date('2026-02-01T12:00:00.000Z'),
        }],
      });

    await expect(getTransactionsByUserId(userId, { page: 1, limit: 20 }))
      .resolves.toEqual({
        data: [{
          id: transactionId,
          idempotency_key: 'seed:portfolio:01:usd:movement-1',
          description: 'Movimiento demo USD 1',
          occurred_at: new Date('2026-02-01T12:00:00.000Z'),
          entries: [{
            id: '2',
            account_id: accountId,
            amount: '125.00000000',
            direction: 'credit',
            currency: 'USD',
            created_at: new Date('2026-02-01T12:00:00.000Z'),
          }],
        }],
        meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
      });

    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[0][1]).toEqual([userId]);
    expect(query.mock.calls[0][0]).toContain('visible_account.user_id = $1');
    expect(query.mock.calls[0][0]).toContain('visible_account.closed_at IS NULL');
    expect(query.mock.calls[1][1]).toEqual([userId, 20, 0]);
    expect(query.mock.calls[1][0]).toContain(
      'ORDER BY t.occurred_at DESC, t.id DESC',
    );
    expect(query.mock.calls[2][1]).toEqual([[transactionId], userId]);
    expect(query.mock.calls[2][0]).toContain('a.closed_at IS NULL');
    expect(query.mock.calls[2][0]).toContain('a.user_id = $2');
    expect(query.mock.calls[2][0]).toContain('e.amount::text AS amount');
    expect(query.mock.calls[2][0]).toContain('ORDER BY e.transaction_id, e.id');
  });

  it('validates account ownership and applies account and date filters', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: accountId }] })
      .mockResolvedValueOnce({ rows: [{ total: '0' }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(getTransactionsByUserId(userId, {
      page: 2,
      limit: 10,
      account_id: accountId,
      from: '2026-02-01T00:00:00.000Z',
      to: '2026-02-28T23:59:59.999Z',
    })).resolves.toEqual({
      data: [],
      meta: { page: 2, limit: 10, total: 0, totalPages: 0 },
    });

    expect(query.mock.calls[0][1]).toEqual([accountId, userId]);
    expect(query.mock.calls[1][1]).toEqual([
      userId,
      accountId,
      '2026-02-01T00:00:00.000Z',
      '2026-02-28T23:59:59.999Z',
    ]);
    expect(query.mock.calls[1][0]).toContain('selected_entry.account_id = $2');
    expect(query.mock.calls[1][0]).toContain('t.occurred_at >= $3::timestamptz');
    expect(query.mock.calls[1][0]).toContain('t.occurred_at <= $4::timestamptz');
    expect(query.mock.calls[2][1]).toEqual([
      userId,
      accountId,
      '2026-02-01T00:00:00.000Z',
      '2026-02-28T23:59:59.999Z',
      10,
      10,
    ]);
  });

  it('returns null when the account filter is not an active account of the user', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await expect(getTransactionsByUserId(userId, {
      page: 1,
      limit: 20,
      account_id: accountId,
    })).resolves.toBeNull();

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('user_id = $2');
    expect(query.mock.calls[0][0]).toContain('closed_at IS NULL');
  });
});
