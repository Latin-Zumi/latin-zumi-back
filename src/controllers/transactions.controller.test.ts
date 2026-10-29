import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openApiSpec } from '../config/swagger.js';

const { getTransactionById, getTransactionsByUserId } = vi.hoisted(() => ({
  getTransactionById: vi.fn(),
  getTransactionsByUserId: vi.fn(),
}));
vi.mock('../services/transactions.service.js', () => ({
  getTransactionById,
  getTransactionsByUserId,
}));

import { getTransactions } from './transactions.controller.js';

const userId = '20000000-0000-4000-8000-000000000001';

function createRequest(query: Request['query']): Request {
  return { query, auth: { userId } } as Request;
}

function createResponse() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  return res as unknown as Response & typeof res;
}

describe('getTransactions', () => {
  beforeEach(() => {
    getTransactionById.mockReset();
    getTransactionsByUserId.mockReset();
  });

  it('uses the default pagination and returns the service result', async () => {
    const history = {
      data: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
    };
    getTransactionsByUserId.mockResolvedValueOnce(history);
    const res = createResponse();

    await getTransactions(createRequest({}), res);

    expect(getTransactionsByUserId).toHaveBeenCalledWith(userId, {
      page: 1,
      limit: 20,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(history);
  });

  it('rejects invalid filters before querying the service', async () => {
    const res = createResponse();

    await expect(getTransactions(createRequest({
      page: '0',
      limit: '101',
      from: '2026-03-01T00:00:00.000Z',
      to: '2026-02-01T00:00:00.000Z',
    }), res)).rejects.toMatchObject({ statusCode: 400 });

    expect(getTransactionsByUserId).not.toHaveBeenCalled();
  });

  it.each([
    { account_id: 'not-a-uuid' },
    { page: '9007199254740991', limit: '100' },
  ])('rejects invalid UUIDs and unsafe offsets', async (query) => {
    await expect(getTransactions(
      createRequest(query),
      createResponse(),
    )).rejects.toMatchObject({ statusCode: 400 });

    expect(getTransactionsByUserId).not.toHaveBeenCalled();
  });

  it('returns a generic not-found error for an unavailable account filter', async () => {
    getTransactionsByUserId.mockResolvedValueOnce(null);

    await expect(getTransactions(
      createRequest({ account_id: '10000000-0000-4000-8000-000000000099' }),
      createResponse(),
    )).rejects.toMatchObject({
      statusCode: 404,
      message: 'Cuenta no encontrada',
    });
  });

  it('documents the history filters and paginated response', () => {
    const operation = openApiSpec.paths['/transactions']?.get;

    expect(operation?.operationId).toBe('getTransactions');
    expect(operation?.parameters?.map(({ name }) => name)).toEqual([
      'page',
      'limit',
      'account_id',
      'from',
      'to',
    ]);
    expect(operation?.responses['200']).toBeDefined();
  });
});
