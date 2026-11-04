import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listWalletTransactions } = vi.hoisted(() => ({ listWalletTransactions: vi.fn() }));
vi.mock('../../services/wallet-transactions.service.js', () => ({ listWalletTransactions }));

import { getWalletTransactions } from '../../controllers/wallet.controller.js';

const auth = {
  userId: '20000000-0000-4000-8000-000000000001',
  sessionId: 'session-id',
  roles: ['user'],
  passwordChangeRequired: false,
};

function request(query: Record<string, unknown>) {
  return { query, auth } as never;
}

function response() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
  return res;
}

describe('getWalletTransactions', () => {
  beforeEach(() => listWalletTransactions.mockReset());

  it('accepts type=interest and forwards the filter', async () => {
    const page = { items: [{ type: 'interest' }], page: 1, limit: 20, total: 1, totalPages: 1 };
    listWalletTransactions.mockResolvedValueOnce(page);
    const res = response();

    await getWalletTransactions(request({ type: 'interest' }), res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(page);
    expect(listWalletTransactions).toHaveBeenCalledWith({
      type: 'interest',
      page: 1,
      limit: 20,
      userId: auth.userId,
    });
  });

  it('keeps rejecting unknown activity types', async () => {
    await expect(getWalletTransactions(request({ type: 'invalid' }), response() as never))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(listWalletTransactions).not.toHaveBeenCalled();
  });
});
