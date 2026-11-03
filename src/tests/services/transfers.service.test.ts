import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  query,
  release,
  client,
  connect,
  findUserByEmail,
  getWalletByUserId,
  getAccountsByUserId,
  getExchangeRate,
  getInternalAccount,
} = vi.hoisted(() => {
  const query = vi.fn();
  const release = vi.fn();
  const client = { query, release };
  return {
    query,
    release,
    client,
    connect: vi.fn(),
    findUserByEmail: vi.fn(),
    getWalletByUserId: vi.fn(),
    getAccountsByUserId: vi.fn(),
    getExchangeRate: vi.fn(),
    getInternalAccount: vi.fn(),
  };
});

vi.mock('../../config/db.js', () => ({
  pool: { connect },
}));

vi.mock('../../services/accounts.service.js', () => ({
  getAccountsByUserId,
  getWalletByUserId,
}));

vi.mock('../../services/users.service.js', () => ({
  findUserByEmail,
}));

import { transferBetweenUsers } from '../../services/transfers.service.js';

const senderWalletId = '10000000-0000-4000-8000-000000000001';
const recipientWalletId = '20000000-0000-4000-8000-000000000001';
const occurredAt = new Date('2026-10-30T00:00:00.000Z');

function configureLedgerQueries() {
  query.mockImplementation(async (statement: string, values?: unknown[]) => {
    if (statement === 'BEGIN' || statement === 'COMMIT' || statement === 'ROLLBACK') {
      return { rows: [] };
    }
    if (statement.includes('SELECT id FROM wallets WHERE id=$1 FOR UPDATE')) {
      const walletId = String(values?.[0]);
      return { rows: [{ id: walletId }] };
    }
    if (statement.startsWith('SELECT t.id, t.description')) {
      return { rows: [] };
    }
    if (statement.includes('SELECT a.id AS account_id')) {
      return { rows: [{ account_id: 'sender-account', sufficient: true }] };
    }
    if (statement.includes('SELECT id FROM accounts')) {
      return { rows: [{ id: 'recipient-account' }] };
    }
    if (statement.includes('INSERT INTO transactions')) {
      return { rows: [{ id: 'transaction-id', occurred_at: occurredAt }] };
    }
    if (statement.includes('INSERT INTO entries')) return { rows: [] };
    if (statement.includes('INSERT INTO accounts')) return { rows: [{ id: 'created-recipient-account' }] };
    return { rows: [] };
  });
}

function transferInput(currency = 'USD') {
  return {
    userId: 'sender-user',
    idempotencyKey: 'transfer-idempotency-key',
    recipientEmail: 'recipient@example.com',
    currency,
    amount: '10.00',
  };
}

describe('transferBetweenUsers', () => {
  beforeEach(() => {
    query.mockReset();
    release.mockReset();
    connect.mockReset().mockResolvedValue(client);
    findUserByEmail.mockReset().mockResolvedValue({
      id: 'recipient-user',
      nombre: 'Recipient',
      email: 'recipient@example.com',
    });
    getWalletByUserId.mockReset().mockImplementation(async (userId: string) => {
      const walletId = userId === 'sender-user' ? senderWalletId : recipientWalletId;
      return {
        id: walletId,
        primaryCurrency: 'USD',
      };
    });
    getAccountsByUserId.mockReset().mockResolvedValue([]);
    getExchangeRate.mockReset();
    getInternalAccount.mockReset();
  });

  it('transfers in the same currency without conversion', async () => {
    configureLedgerQueries();

    const result = await transferBetweenUsers(transferInput('USD'));

    expect(result.recipient).toEqual({ currency: 'USD', amount: '10.00', rate: '1.000000000000' });
    expect(getExchangeRate).not.toHaveBeenCalled();
    expect(getInternalAccount).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledWith('COMMIT');
    expect(query.mock.calls.some(([statement]) =>
      String(statement).includes('currency_conversions'),
    )).toBe(false);
  });

  it('creates the recipient account in the transfer currency and moves the balance', async () => {
    configureLedgerQueries();
    query.mockImplementation(async (statement: string, values?: unknown[]) => {
      if (statement.includes('SELECT id FROM accounts')) return { rows: [] };
      if (statement.includes('INSERT INTO accounts')) return { rows: [{ id: 'created-recipient-account' }] };
      if (statement === 'BEGIN' || statement === 'COMMIT' || statement === 'ROLLBACK') return { rows: [] };
      if (statement.includes('SELECT id FROM wallets WHERE id=$1 FOR UPDATE')) {
        const walletId = String(values?.[0]);
        return { rows: [{ id: walletId }] };
      }
      if (statement.startsWith('SELECT t.id, t.description')) return { rows: [] };
      if (statement.includes('SELECT a.id AS account_id')) {
        return { rows: [{ account_id: 'sender-account', sufficient: true }] };
      }
      if (statement.includes('INSERT INTO transactions')) {
        return { rows: [{ id: 'transaction-id', occurred_at: occurredAt }] };
      }
      if (statement.includes('INSERT INTO entries')) return { rows: [] };
      return { rows: [] };
    });

    const result = await transferBetweenUsers(transferInput('USD'));

    expect(result.recipient.currency).toBe('USD');
    const insertCall = query.mock.calls.find(([statement]) =>
      String(statement).includes('INSERT INTO accounts'),
    );
    expect(insertCall?.[0]).toContain('INSERT INTO accounts');
    expect(insertCall?.[1]).toEqual(['recipient-user', recipientWalletId, 'USD']);
    expect(query.mock.calls.some(([statement]) =>
      String(statement).includes('currency_conversions'),
    )).toBe(false);
  });
});
