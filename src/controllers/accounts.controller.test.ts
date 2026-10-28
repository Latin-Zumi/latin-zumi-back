import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openApiSpec } from '../config/swagger.js';

const {
  getAccountsByUserId,
  getAccountById,
  getBalanceByAccountId,
  recordIncomingConversion,
  withdrawFromAccount,
} = vi.hoisted(() => ({
  getAccountsByUserId: vi.fn(),
  getAccountById: vi.fn(),
  getBalanceByAccountId: vi.fn(),
  recordIncomingConversion: vi.fn(),
  withdrawFromAccount: vi.fn(),
}));
vi.mock('../services/accounts.service.js', () => ({
  getAccountsByUserId,
  getAccountById,
  getBalanceByAccountId,
}));
vi.mock('../services/incoming-conversion.service.js', () => ({
  recordIncomingConversion,
}));
vi.mock('../services/withdrawal.service.js', () => ({ withdrawFromAccount }));

import { getAccounts, withdrawAccount } from './accounts.controller.js';

const accountId = '10000000-0000-4000-8000-000000000001';
const userId = '20000000-0000-4000-8000-000000000001';

function createRequest(
  body: unknown,
  id = accountId,
  idempotencyKey: string | undefined = 'withdrawal-123',
): Request {
  return {
    params: { id },
    body,
    auth: { userId },
    header: vi.fn((name: string) => (
      name === 'Idempotency-Key' ? idempotencyKey : undefined
    )),
  } as unknown as Request;
}

function createResponse() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  return res as unknown as Response & typeof res;
}

describe('getAccounts', () => {
  beforeEach(() => getAccountsByUserId.mockReset());

  it('returns the authenticated user accounts and their database balances', async () => {
    const accounts = [
      {
        id: accountId,
        user_id: userId,
        currency: 'USD',
        account_type: 'user',
        allow_negative: false,
        balance: '125.00000000',
      },
    ];
    getAccountsByUserId.mockResolvedValueOnce(accounts);
    const res = createResponse();

    await getAccounts(createRequest({}), res);

    expect(getAccountsByUserId).toHaveBeenCalledWith(userId);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ data: accounts });
  });

  it('returns an empty data array when the authenticated user has no accounts', async () => {
    getAccountsByUserId.mockResolvedValueOnce([]);
    const res = createResponse();

    await getAccounts(createRequest({}), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ data: [] });
  });

  it('rejects a request without an authenticated user', async () => {
    await expect(getAccounts(
      { auth: undefined } as unknown as Request,
      createResponse(),
    )).rejects.toMatchObject({
      statusCode: 401,
      message: 'Autenticación requerida',
    });

    expect(getAccountsByUserId).not.toHaveBeenCalled();
  });
});

describe('withdrawAccount', () => {
  beforeEach(() => withdrawFromAccount.mockReset());

  it('validates input and delegates with the authenticated user', async () => {
    const result = {
      transaction_id: '30000000-0000-4000-8000-000000000123',
      account_id: accountId,
      amount: { currency: 'USD', amount: '50.00' },
    };
    withdrawFromAccount.mockResolvedValueOnce(result);
    const res = createResponse();

    await withdrawAccount(createRequest({ amount: '50' }), res);

    expect(withdrawFromAccount).toHaveBeenCalledWith({
      accountId,
      userId,
      idempotencyKey: 'withdrawal-123',
      amount: '50',
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ data: result });
  });

  it.each([
    { body: { amount: '0' } },
    { body: { amount: '-1.00' } },
    { body: { amount: '1.001' } },
    { body: { amount: '1234567890123.00' } },
    { body: { amount: 10 } },
    { body: { amount: '10.00' }, id: 'invalid-id' },
    { body: { amount: '10.00' }, idempotencyKey: '' },
    { body: { amount: '10.00' }, idempotencyKey: 'bad key' },
  ])('rejects invalid withdrawal input before calling the service', async ({
    body,
    id,
    idempotencyKey,
  }) => {
    await expect(withdrawAccount(
      createRequest(body, id, idempotencyKey),
      createResponse(),
    )).rejects.toMatchObject({ statusCode: 400 });

    expect(withdrawFromAccount).not.toHaveBeenCalled();
  });

  it('documents the authenticated withdrawal contract', () => {
    const operation = openApiSpec.paths['/accounts/{id}/withdraw']?.post;

    expect(operation?.operationId).toBe('withdrawAccount');
    expect(operation?.security).toEqual([{ bearerAuth: [] }]);
    expect(operation?.parameters?.map(({ name }) => name)).toEqual([
      'id',
      'Idempotency-Key',
    ]);
    expect(operation?.responses['200']).toBeDefined();
    expect(operation?.responses['422']).toBeDefined();
  });

  it('documents both implemented health checks and their response states', () => {
    const health = openApiSpec.paths['/health']?.get;
    const readiness = openApiSpec.paths['/health/ready']?.get;

    expect(health?.operationId).toBe('getHealth');
    expect(health?.responses['200']).toBeDefined();
    expect(readiness?.operationId).toBe('getReadiness');
    expect(readiness?.responses['200']).toBeDefined();
    expect(readiness?.responses['503']).toBeDefined();
  });
});
