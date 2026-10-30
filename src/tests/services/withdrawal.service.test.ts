import { beforeEach, describe, expect, it, vi } from 'vitest';

const { client, connect, query, release } = vi.hoisted(() => {
  const query = vi.fn();
  const release = vi.fn();
  const client = { query, release };
  return { client, connect: vi.fn(async () => client), query, release };
});
vi.mock('../../config/db.js', () => ({ pool: { connect } }));

import { withdrawFromAccount } from '../../services/withdrawal.service.js';

const accountId = '10000000-0000-4000-8000-000000000001';
const userId = '20000000-0000-4000-8000-000000000001';
const transactionId = '30000000-0000-4000-8000-000000000123';
const externalAccountId = '10000000-0000-4000-8000-000000000099';

function queueWalletAndIdempotency(existing: unknown[] = []) {
  query
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({
      rows: [{ wallet_id: 'wallet-id', account_id: accountId, currency: 'USD' }],
    })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: existing });
}

describe('withdrawFromAccount', () => {
  beforeEach(() => {
    query.mockReset();
    release.mockReset();
    connect.mockClear();
  });

  it('records a balanced withdrawal in one transaction', async () => {
    queueWalletAndIdempotency();
    query
      .mockResolvedValueOnce({ rows: [{ sufficient: true }] })
      .mockResolvedValueOnce({ rows: [{ id: transactionId }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: externalAccountId }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(withdrawFromAccount({
      accountId,
      userId,
      idempotencyKey: 'withdrawal-123',
      amount: '50',
    })).resolves.toEqual({
      transaction_id: transactionId,
      account_id: accountId,
      amount: { currency: 'USD', amount: '50.00' },
    });

    const sql = query.mock.calls.map(([statement]) => statement);
    expect(sql[0]).toBe('BEGIN');
    expect(sql[1]).toContain('FOR UPDATE OF w');
    expect(sql[2]).toContain('pg_advisory_xact_lock');
    expect(query.mock.calls[2][1]).toEqual(['operation:withdrawal-123']);
    expect(sql[4]).toContain('COALESCE(b.balance, 0) >= $2::numeric');
    expect(sql[5]).toContain('INSERT INTO transactions');
    expect(sql[8]).toContain("'debit'");
    expect(sql[8]).toContain("'credit'");
    expect(sql.at(-1)).toBe('COMMIT');
    expect(release).toHaveBeenCalledOnce();
  });

  it('returns the original result for the same idempotent request', async () => {
    queueWalletAndIdempotency([{
      transaction_id: transactionId,
      description: 'Retiro de cuenta',
      account_id: accountId,
      amount: '50.00000000',
      currency: 'USD',
    }]);
    query.mockResolvedValueOnce({ rows: [] });

    await expect(withdrawFromAccount({
      accountId,
      userId,
      idempotencyKey: 'withdrawal-123',
      amount: '50.00',
    })).resolves.toEqual({
      transaction_id: transactionId,
      account_id: accountId,
      amount: { currency: 'USD', amount: '50.00' },
    });
    expect(query).toHaveBeenCalledTimes(5);
    expect(query.mock.calls[4][0]).toBe('COMMIT');
  });

  it('rejects an idempotency key already used by another operation', async () => {
    queueWalletAndIdempotency([{
      transaction_id: transactionId,
      description: 'Ingreso USD convertido a USD',
      account_id: null,
      amount: null,
      currency: null,
    }]);
    query.mockResolvedValueOnce({ rows: [] });

    await expect(withdrawFromAccount({
      accountId,
      userId,
      idempotencyKey: 'withdrawal-123',
      amount: '50.00',
    })).rejects.toMatchObject({ statusCode: 409 });
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });

  it('rejects a repeated withdrawal key with a different amount', async () => {
    queueWalletAndIdempotency([{
      transaction_id: transactionId,
      description: 'Retiro de cuenta',
      account_id: accountId,
      amount: '50.00000000',
      currency: 'USD',
    }]);
    query.mockResolvedValueOnce({ rows: [] });

    await expect(withdrawFromAccount({
      accountId,
      userId,
      idempotencyKey: 'withdrawal-123',
      amount: '51.00',
    })).rejects.toMatchObject({ statusCode: 409 });
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });

  it('rejects insufficient balance without creating a transaction', async () => {
    queueWalletAndIdempotency();
    query
      .mockResolvedValueOnce({ rows: [{ sufficient: false }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(withdrawFromAccount({
      accountId,
      userId,
      idempotencyKey: 'withdrawal-123',
      amount: '50.00',
    })).rejects.toMatchObject({ statusCode: 422 });

    expect(query.mock.calls.some(([statement]) => (
      String(statement).includes('INSERT INTO transactions')
    ))).toBe(false);
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });

  it('rolls back both entries when ledger insertion fails', async () => {
    queueWalletAndIdempotency();
    query
      .mockResolvedValueOnce({ rows: [{ sufficient: true }] })
      .mockResolvedValueOnce({ rows: [{ id: transactionId }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: externalAccountId }] })
      .mockRejectedValueOnce(new Error('ledger write failed'))
      .mockResolvedValueOnce({ rows: [] });

    await expect(withdrawFromAccount({
      accountId,
      userId,
      idempotencyKey: 'withdrawal-123',
      amount: '50.00',
    })).rejects.toThrow('ledger write failed');
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });

  it('hides accounts not owned by the authenticated user', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(withdrawFromAccount({
      accountId,
      userId,
      idempotencyKey: 'withdrawal-123',
      amount: '50.00',
    })).rejects.toMatchObject({ statusCode: 404 });
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
});
