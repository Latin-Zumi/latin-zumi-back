import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findActiveSession,
  getMyProfile,
  getAccountsByUserId,
  getBalanceByAccountId,
  listWalletTransactions,
  getTransactionById,
} = vi.hoisted(() => ({
  findActiveSession: vi.fn(),
  getMyProfile: vi.fn(),
  getAccountsByUserId: vi.fn(),
  getBalanceByAccountId: vi.fn(),
  listWalletTransactions: vi.fn(),
  getTransactionById: vi.fn(),
}));

vi.mock('../../config/env.js', () => ({ env: { CORS_ORIGINS: [] } }));
vi.mock('../../services/auth.service.js', () => ({ findActiveSession }));
vi.mock('../../services/users.service.js', () => ({ getMyProfile }));
vi.mock('../../services/accounts.service.js', () => ({
  getAccountsByUserId,
  getBalanceByAccountId,
}));
vi.mock('../../services/wallet-transactions.service.js', () => ({
  listWalletTransactions,
}));
vi.mock('../../services/transactions.service.js', () => ({ getTransactionById }));

const ownerId = '20000000-0000-4000-8000-000000000001';
const otherUserId = '20000000-0000-4000-8000-000000000002';
const ownerAccountId = '10000000-0000-4000-8000-000000000001';
const otherAccountId = '10000000-0000-4000-8000-000000000002';
const ownerTransactionId = '30000000-0000-4000-8000-000000000001';
const otherTransactionId = '30000000-0000-4000-8000-000000000002';

let server: Server;
let baseUrl: string;

function createAuthenticatedClient(token: string) {
  const transport = new StreamableHTTPClientTransport(
    new URL(`${baseUrl}/mcp`),
    {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set('Authorization', `Bearer ${token}`);
        return fetch(input, { ...init, headers });
      },
    },
  );
  const client = new Client(
    { name: 'latin-zumi-http-test-client', version: '1.0.0' },
    { versionNegotiation: { mode: 'auto' } },
  );
  return { client, transport };
}

function initializeBody(id: number) {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'latin-zumi-route-test', version: '1.0.0' },
    },
  });
}

async function postMcp(
  token: string,
  body: string,
  origin?: string,
): Promise<Response> {
  const headers = new Headers({
    Authorization: `Bearer ${token}`,
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
  });
  if (origin) headers.set('Origin', origin);

  return fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers,
    body,
  });
}

async function requestMcp(
  token: string,
  method: string,
  body?: string,
): Promise<Response> {
  const headers = new Headers({
    Authorization: `Bearer ${token}`,
    Accept: 'application/json, text/event-stream',
  });
  if (body !== undefined) headers.set('Content-Type', 'application/json');

  return fetch(`${baseUrl}/mcp`, {
    method,
    headers,
    ...(body === undefined ? {} : { body }),
  });
}

describe('MCP Streamable HTTP route', () => {
  beforeAll(async () => {
    const [{ createMcpRouter }, { errorHandler }] = await Promise.all([
      import('../../mcp/router.js'),
      import('../../middleware/errorHandler.js'),
    ]);
    const app = express();
    app.use(express.json({ limit: '100kb' }));
    app.use(createMcpRouter({
      allowedOrigins: ['https://trusted.example'],
      rateLimiter: (_req, _res, next) => next(),
    }));
    app.use(errorHandler);

    await new Promise<void>((resolve, reject) => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('No se pudo iniciar el servidor MCP de prueba'));
          return;
        }
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
      server.once('error', reject);
    });
  });

  beforeEach(() => {
    findActiveSession.mockReset().mockImplementation(async (token: string) => {
      if (token === 'owner-token') {
        return {
          userId: ownerId,
          sessionId: '30000000-0000-4000-8000-000000000001',
          passwordChangeRequired: false,
        };
      }
      if (token === 'other-token') {
        return {
          userId: otherUserId,
          sessionId: '30000000-0000-4000-8000-000000000002',
          passwordChangeRequired: false,
        };
      }
      if (token === 'password-change-token') {
        return {
          userId: ownerId,
          sessionId: '30000000-0000-4000-8000-000000000003',
          passwordChangeRequired: true,
        };
      }
      return null;
    });
    getMyProfile.mockReset();
    getAccountsByUserId.mockReset().mockResolvedValue([]);
    getBalanceByAccountId.mockReset();
    listWalletTransactions.mockReset();
    getTransactionById.mockReset();
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
    }
  });

  it('rejects anonymous access before accessing private services', async () => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ message: 'Autenticación requerida' });
    expect(findActiveSession).not.toHaveBeenCalled();
    expect(getMyProfile).not.toHaveBeenCalled();
  });

  it('reauthenticates each HTTP request instead of trusting an earlier MCP request', async () => {
    findActiveSession.mockReset()
      .mockResolvedValueOnce({
        userId: ownerId,
        sessionId: '30000000-0000-4000-8000-000000000001',
        passwordChangeRequired: false,
      })
      .mockResolvedValueOnce(null);

    const initializeResponse = await postMcp('owner-token', initializeBody(1));
    expect(initializeResponse.status).toBe(200);

    const toolsListResponse = await postMcp('owner-token', JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    }));

    expect(toolsListResponse.status).toBe(401);
    expect(findActiveSession.mock.calls).toEqual([
      ['owner-token'],
      ['owner-token'],
    ]);
  });

  it.each([
    ['invalid-token', 'invalid'],
    ['expired-token', 'expired'],
    ['revoked-token', 'revoked'],
  ])('rejects %s without creating an MCP session', async (token) => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    });

    expect(response.status).toBe(401);
    expect(findActiveSession).toHaveBeenCalledWith(token);
    expect(getMyProfile).not.toHaveBeenCalled();
  });

  it('preserves requireAuth password-change restrictions', async () => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer password-change-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    });

    expect(response.status).toBe(403);
    expect(getMyProfile).not.toHaveBeenCalled();
  });

  it('authenticates with the backend session and lists the five registered tools', async () => {
    const { client, transport } = createAuthenticatedClient('owner-token');
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();

      expect(findActiveSession).toHaveBeenCalledWith('owner-token');
      expect(tools).toHaveLength(5);
      expect(tools.map(({ name }) => name).sort()).toEqual([
        'get_my_account_balance',
        'get_my_profile',
        'get_my_transaction',
        'list_my_accounts',
        'list_my_wallet_activity',
      ]);
    } finally {
      await client.close();
    }
  });

  it('accepts a valid POST request using the authenticated MCP session', async () => {
    const response = await requestMcp(
      'owner-token',
      'POST',
      initializeBody(1),
    );

    expect(response.status).toBe(200);
    expect(findActiveSession).toHaveBeenCalledWith('owner-token');
  });

  it.each(['GET', 'DELETE'])(
    'delegates %s to the stateless SDK handler, which responds with 405',
    async (method) => {
      const response = await requestMcp('owner-token', method);

      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('POST');
      expect(findActiveSession).toHaveBeenCalledWith('owner-token');
    },
  );

  it.each(['PUT', 'PATCH'])(
    'rejects unsupported %s requests with the SDK response',
    async (method) => {
      const response = await requestMcp('owner-token', method);

      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('POST');
      expect(findActiveSession).toHaveBeenCalledWith('owner-token');
    },
  );

  it('rejects JSON bodies larger than 100 KB with HTTP 413 before MCP authentication or services', async () => {
    const body = JSON.stringify({ payload: 'a'.repeat(100 * 1024) });
    const response = await requestMcp('owner-token', 'POST', body);

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      code: 'PAYLOAD_TOO_LARGE',
      message: 'El cuerpo de la solicitud supera el límite permitido de 100 KB',
    });
    expect(findActiveSession).not.toHaveBeenCalled();
    expect(getMyProfile).not.toHaveBeenCalled();
    expect(getAccountsByUserId).not.toHaveBeenCalled();
    expect(getBalanceByAccountId).not.toHaveBeenCalled();
    expect(listWalletTransactions).not.toHaveBeenCalled();
    expect(getTransactionById).not.toHaveBeenCalled();
  });

  it('preserves the existing HTTP 400 response for malformed JSON', async () => {
    const response = await requestMcp('owner-token', 'POST', '{"jsonrpc":');

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 'INVALID_JSON',
      message: 'JSON inválido en el body',
    });
    expect(findActiveSession).not.toHaveBeenCalled();
    expect(getMyProfile).not.toHaveBeenCalled();
  });

  it('uses the authenticated identity and isolates concurrent clients', async () => {
    getMyProfile.mockImplementation(async (userId: string) => ({
      nombre: userId === ownerId ? 'Owner' : 'Other',
      email: `${userId}@example.test`,
      pais: null,
      moneda_preferida: 'ARS',
      foto_url: null,
    }));
    const owner = createAuthenticatedClient('owner-token');
    const other = createAuthenticatedClient('other-token');

    try {
      await Promise.all([
        owner.client.connect(owner.transport),
        other.client.connect(other.transport),
      ]);
      const [ownerProfile, otherProfile] = await Promise.all([
        owner.client.callTool({ name: 'get_my_profile', arguments: {} }),
        other.client.callTool({ name: 'get_my_profile', arguments: {} }),
      ]);

      expect(ownerProfile.structuredContent).toMatchObject({
        profile: { nombre: 'Owner' },
      });
      expect(otherProfile.structuredContent).toMatchObject({
        profile: { nombre: 'Other' },
      });
      expect(getMyProfile.mock.calls.map(([userId]) => userId).sort())
        .toEqual([ownerId, otherUserId].sort());
    } finally {
      await Promise.all([owner.client.close(), other.client.close()]);
    }
  });

  it('passes the authenticated identity to every account and transaction lookup', async () => {
    const accountIds = new Map([
      [ownerId, ownerAccountId],
      [otherUserId, otherAccountId],
    ]);
    const transactionIds = new Map([
      [ownerId, ownerTransactionId],
      [otherUserId, otherTransactionId],
    ]);
    getAccountsByUserId.mockImplementation(async (userId: string) => [{
      id: accountIds.get(userId),
      user_id: userId,
      wallet_id: '40000000-0000-4000-8000-000000000001',
      currency: 'ARS',
      account_type: 'user',
      allow_negative: false,
      balance: '10.00',
    }]);
    getBalanceByAccountId.mockImplementation(async (
      accountId: string,
      userId: string,
    ) => accountIds.get(userId) === accountId
      ? {
        account_id: accountId,
        wallet_id: '40000000-0000-4000-8000-000000000001',
        currency: 'ARS',
        balance: '10.00',
      }
      : null);
    listWalletTransactions.mockImplementation(async ({ userId, page, limit }) => ({
      items: [],
      page,
      limit,
      total: 0,
      totalPages: 0,
      owner: userId,
    }));
    getTransactionById.mockImplementation(async (
      transactionId: string,
      userId: string,
    ) => transactionIds.get(userId) === transactionId
      ? {
        id: transactionId,
        idempotency_key: 'private-key',
        description: 'private',
        occurred_at: new Date('2026-10-30T12:00:00.000Z'),
        entries: [],
      }
      : null);

    const owner = createAuthenticatedClient('owner-token');
    const other = createAuthenticatedClient('other-token');
    try {
      await Promise.all([
        owner.client.connect(owner.transport),
        other.client.connect(other.transport),
      ]);
      const results = await Promise.all([
        owner.client.callTool({ name: 'list_my_accounts', arguments: {} }),
        other.client.callTool({ name: 'list_my_accounts', arguments: {} }),
        owner.client.callTool({
          name: 'get_my_account_balance',
          arguments: { account_id: ownerAccountId },
        }),
        other.client.callTool({
          name: 'get_my_account_balance',
          arguments: { account_id: otherAccountId },
        }),
        owner.client.callTool({
          name: 'list_my_wallet_activity',
          arguments: {},
        }),
        other.client.callTool({
          name: 'list_my_wallet_activity',
          arguments: {},
        }),
        owner.client.callTool({
          name: 'get_my_transaction',
          arguments: { transaction_id: ownerTransactionId },
        }),
        other.client.callTool({
          name: 'get_my_transaction',
          arguments: { transaction_id: otherTransactionId },
        }),
      ]);

      expect(results.every(({ isError }) => !isError)).toBe(true);
      expect(getAccountsByUserId.mock.calls.map(([userId]) => userId).sort())
        .toEqual([ownerId, otherUserId].sort());
      expect(getBalanceByAccountId.mock.calls).toEqual([
        [ownerAccountId, ownerId],
        [otherAccountId, otherUserId],
      ]);
      expect(listWalletTransactions.mock.calls.map(([{ userId }]) => userId).sort())
        .toEqual([ownerId, otherUserId].sort());
      expect(getTransactionById.mock.calls).toEqual([
        [ownerTransactionId, ownerId],
        [otherTransactionId, otherUserId],
      ]);
    } finally {
      await Promise.all([owner.client.close(), other.client.close()]);
    }
  });

  it('does not accept a client-supplied userId as authorization input', async () => {
    const { client, transport } = createAuthenticatedClient('owner-token');
    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: 'get_my_profile',
        arguments: { userId: otherUserId },
      });

      expect(result.isError).toBe(true);
      expect(getMyProfile).not.toHaveBeenCalled();
    } finally {
      await client.close();
    }
  });

  it('rejects untrusted browser origins', async () => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer owner-token',
        Origin: 'https://untrusted.example',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    });

    expect(response.status).toBe(403);
    expect(getMyProfile).not.toHaveBeenCalled();
  });

  it.each([
    ['allowed origin', 'https://trusted.example'],
    ['no Origin header', undefined],
  ])('accepts MCP requests with %s', async (_label, origin) => {
    const response = await postMcp('owner-token', initializeBody(1), origin);

    expect(response.status).toBe(200);
    expect(findActiveSession).toHaveBeenCalledWith('owner-token');
  });

  it('enforces a real per-IP rate limiter and returns HTTP 429 above the limit', async () => {
    const [{ createMcpRouter }, { AppError }] = await Promise.all([
      import('../../mcp/router.js'),
      import('../../utils/AppError.js'),
    ]);
    const app = express();
    app.use(express.json());
    app.use(createMcpRouter({
      allowedOrigins: [],
    }));
    app.use((
      error: InstanceType<typeof AppError>,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(error.statusCode ?? 500).json({
        code: error.code ?? 'INTERNAL_ERROR',
        message: error.message,
      });
    });

    let limitedServer: Server | undefined;
    const limitedBaseUrl = await new Promise<string>((resolve, reject) => {
      limitedServer = app.listen(0, '127.0.0.1', () => {
        const address = limitedServer?.address();
        if (!address || typeof address === 'string') {
          reject(new Error('No se pudo iniciar el servidor MCP con rate limit'));
          return;
        }
        resolve(`http://127.0.0.1:${address.port}`);
      });
      limitedServer.once('error', reject);
    });

    try {
      for (let id = 1; id <= 60; id += 1) {
        const response = await fetch(`${limitedBaseUrl}/mcp`, {
          method: 'POST',
          headers: {
            Authorization: 'Bearer owner-token',
            Accept: 'application/json, text/event-stream',
            'Content-Type': 'application/json',
          },
          body: initializeBody(id),
        });
        expect(response.status).toBe(200);
      }

      const limitedResponse = await fetch(`${limitedBaseUrl}/mcp`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer owner-token',
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
        },
        body: initializeBody(61),
      });

      expect(limitedResponse.status).toBe(429);
      expect(findActiveSession).toHaveBeenCalledTimes(60);
    } finally {
      if (limitedServer) {
        await new Promise<void>((resolve, reject) => {
          limitedServer?.close((error) => (error ? reject(error) : resolve()));
          limitedServer?.closeAllConnections();
        });
      }
    }
  });
});
