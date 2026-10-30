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

vi.mock('../../services/exchange-rate.service.js', () => ({
  getExchangeRate,
}));

vi.mock('../../services/internal-account.service.js', () => ({
  getInternalAccount,
}));

vi.mock('../../services/users.service.js', () => ({
  findUserByEmail,
}));

import { transferBetweenUsers } from '../../services/transfers.service.js';

const senderWalletId = '10000000-0000-4000-8000-000000000001';
const recipientWalletId = '20000000-0000-4000-8000-000000000001';
const occurredAt = new Date('2026-10-30T00:00:00.000Z');

let initialCurrencies: Map<string, string>;
let currentCurrencies: Map<string, string>;

function configureLedgerQueries(
  beforeWalletLock?: (walletId: string) => Promise<void>,
) {
  query.mockImplementation(async (statement: string, values?: unknown[]) => {
    if (statement === 'BEGIN' || statement === 'COMMIT' || statement === 'ROLLBACK') {
      return { rows: [] };
    }

    if (statement.includes('SELECT id FROM wallets WHERE id=$1 FOR UPDATE')) {
      const walletId = String(values?.[0]);
      await beforeWalletLock?.(walletId);
      return { rows: [{ id: walletId }] };
    }

    if (statement.includes('SELECT id, RTRIM(primary_currency) AS primary_currency')) {
      return {
        rows: [...currentCurrencies.entries()]
          .map(([id, primary_currency]) => ({ id, primary_currency }))
          .sort((left, right) => left.id.localeCompare(right.id)),
      };
    }

    if (statement.includes('pg_advisory_xact_lock')) return { rows: [] };
    if (statement.startsWith('SELECT t.id, t.description')) return { rows: [] };
    if (statement.includes('SELECT a.id AS account_id')) {
      return { rows: [{ account_id: 'sender-account', sufficient: true }] };
    }
    if (statement.includes('SELECT id FROM accounts WHERE wallet_id')) {
      return { rows: [{ id: 'recipient-account' }] };
    }
    if (statement.includes('INSERT INTO transactions')) {
      return { rows: [{ id: 'transaction-id', occurred_at: occurredAt }] };
    }
    if (statement.includes('INSERT INTO entries')) return { rows: [] };
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

describe('transferBetweenUsers wallet currency locking', () => {
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
        primaryCurrency: initialCurrencies.get(walletId),
      };
    });
    getAccountsByUserId.mockReset().mockResolvedValue([]);
    getExchangeRate.mockReset().mockResolvedValue({
      rate: '1.250000000000',
      source: 'test',
      observedAt: occurredAt,
    });
    getInternalAccount.mockReset();
    initialCurrencies = new Map([
      [senderWalletId, 'USD'],
      [recipientWalletId, 'USD'],
    ]);
    currentCurrencies = new Map(initialCurrencies);
  });

  it('uses the locked wallet state when the currency did not change', async () => {
    configureLedgerQueries();

    const result = await transferBetweenUsers(transferInput());

    expect(result.recipient.currency).toBe('USD');
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT id, RTRIM(primary_currency) AS primary_currency'),
      [[senderWalletId, recipientWalletId]],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('RTRIM(currency)=$2'),
      [recipientWalletId, 'USD'],
    );
    expect(query).toHaveBeenCalledWith('COMMIT');
    expect(getExchangeRate).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });

  it('detects a destination currency change while waiting for the wallet lock and rolls back', async () => {
    let releaseWalletLock!: () => void;
    let signalLockAttempt!: () => void;
    const walletLockAttempted = new Promise<void>((resolve) => {
      signalLockAttempt = resolve;
    });
    const walletLockWait = new Promise<void>((resolve) => {
      releaseWalletLock = resolve;
    });
    configureLedgerQueries(async (walletId) => {
      if (walletId !== recipientWalletId) return;
      signalLockAttempt();
      await walletLockWait;
    });

    const pendingTransfer = transferBetweenUsers(transferInput('EUR'));
    await walletLockAttempted;
    currentCurrencies.set(recipientWalletId, 'ARS');
    releaseWalletLock();

    await expect(pendingTransfer).rejects.toMatchObject({
      statusCode: 409,
      code: 'TRANSFER_WALLET_CURRENCY_CHANGED',
      message: 'La moneda de la wallet destinataria cambió; reintentá la transferencia',
    });

    expect(getExchangeRate).toHaveBeenCalledOnce();
    expect(getExchangeRate).toHaveBeenCalledWith('EUR', 'USD');
    expect(query.mock.calls.some(([statement]) =>
      String(statement).includes('INSERT INTO transactions')
      || String(statement).includes('INSERT INTO entries'),
    )).toBe(false);
    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(query).not.toHaveBeenCalledWith('COMMIT');
    expect(release).toHaveBeenCalledOnce();
  });

  it('rolls back when the locked wallet re-read omits the sender wallet', async () => {
    configureLedgerQueries();
    query.mockImplementation(async (statement: string, values?: unknown[]) => {
      if (statement.includes('SELECT id, RTRIM(primary_currency) AS primary_currency')) {
        return {
          rows: [{ id: recipientWalletId, primary_currency: 'USD' }],
        };
      }
      if (
        statement === 'BEGIN'
        || statement === 'ROLLBACK'
        || statement.includes('SELECT id FROM wallets WHERE id=$1 FOR UPDATE')
      ) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    await expect(transferBetweenUsers(transferInput())).rejects.toMatchObject({
      statusCode: 409,
      code: 'TRANSFER_WALLET_STATE_CHANGED',
    });
    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(query).not.toHaveBeenCalledWith('COMMIT');
    expect(query.mock.calls.some(([statement]) =>
      String(statement).includes('INSERT INTO transactions')
      || String(statement).includes('INSERT INTO entries'),
    )).toBe(false);
    expect(release).toHaveBeenCalledOnce();
  });
});
