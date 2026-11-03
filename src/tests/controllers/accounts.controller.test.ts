import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openApiSpec } from '../../config/swagger.js';

const {
  getAccountsByUserId,
} = vi.hoisted(() => ({
  getAccountsByUserId: vi.fn(),
}));
vi.mock('../../services/accounts.service.js', () => ({
  getAccountsByUserId,
}));

import { getAccounts } from '../../controllers/accounts.controller.js';

const accountId = '10000000-0000-4000-8000-000000000001';
const userId = '20000000-0000-4000-8000-000000000001';

function createRequest(
  body: unknown,
): Request {
  return {
    body,
    auth: { userId },
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
        wallet_id: '40000000-0000-4000-8000-000000000001',
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

  it('documents wallet_id and the standard error envelope for GET /accounts', () => {
    const operation = openApiSpec.paths['/accounts']?.get;
    const accountSchema = operation?.responses['200']?.content?.['application/json']
      ?.schema?.properties?.data?.items;
    const errorSchema = operation?.responses['500']?.content?.['application/json']
      ?.schema;

    expect(accountSchema?.required).toContain('wallet_id');
    expect(accountSchema?.properties?.wallet_id).toMatchObject({
      type: 'string',
      format: 'uuid',
    });
    expect(errorSchema?.properties).toMatchObject({
      code: { type: 'string', example: 'INTERNAL_ERROR' },
      message: { type: 'string', example: 'Error interno del servidor' },
    });
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
