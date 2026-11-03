import { beforeEach, describe, expect, it, vi } from 'vitest';

const { query, getAccountsByUserId, listWalletTransactions } = vi.hoisted(() => ({
  query: vi.fn(),
  getAccountsByUserId: vi.fn(),
  listWalletTransactions: vi.fn(),
}));
vi.mock('../../config/db.js', () => ({ pool: { query } }));
vi.mock('../../services/accounts.service.js', () => ({ getAccountsByUserId }));
vi.mock('../../services/wallet-transactions.service.js', () => ({ listWalletTransactions }));

import { getAdminUser } from '../../services/admin.service.js';

describe('getAdminUser', () => {
  beforeEach(() => {
    query.mockReset();
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
