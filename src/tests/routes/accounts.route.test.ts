import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { query, findActiveSession } = vi.hoisted(() => ({
  query: vi.fn(),
  findActiveSession: vi.fn(),
}));

vi.mock('../../config/db.js', () => ({ pool: { query } }));
vi.mock('../../services/auth.service.js', () => ({ findActiveSession }));

const ownerId = '20000000-0000-4000-8000-000000000001';
const otherUserId = '20000000-0000-4000-8000-000000000002';
const ownerAccount = {
  id: '10000000-0000-4000-8000-000000000001',
  user_id: ownerId,
  wallet_id: '40000000-0000-4000-8000-000000000001',
  currency: 'USD',
  account_type: 'user',
  allow_negative: false,
  balance: '125.00000000',
};
const otherAccount = {
  ...ownerAccount,
  id: '10000000-0000-4000-8000-000000000002',
  user_id: otherUserId,
};

let server: Server;
let baseUrl: string;

describe('GET /accounts', () => {
  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('DB_HOST', 'localhost');
    vi.stubEnv('DB_PORT', '5432');
    vi.stubEnv('DB_NAME', 'accounts-route-test');
    vi.stubEnv('DB_USER', 'accounts-route-test');
    vi.stubEnv('DB_PASSWORD', 'accounts-route-test');
    vi.stubEnv('PORT', '3000');

    const [{ accountsRouter }, { errorHandler }] = await Promise.all([
      import('../../routes/accounts.route.js'),
      import('../../middleware/errorHandler.js'),
    ]);
    const app = express();
    app.use(accountsRouter);
    app.use(errorHandler);

    await new Promise<void>((resolve, reject) => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('No se pudo obtener la dirección del servidor de prueba'));
          return;
        }
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
      server.once('error', reject);
    });
  });

  beforeEach(() => {
    query.mockReset();
    findActiveSession.mockReset();
    findActiveSession.mockImplementation(async (token: string) => {
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
      return null;
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
    }
    vi.unstubAllEnvs();
  });

  it('returns account balances only for the authenticated owner', async () => {
    query.mockImplementation(async (_sql: string, values: string[]) => ({
      rows: values[0] === ownerId ? [ownerAccount] : [otherAccount],
    }));

    const response = await fetch(`${baseUrl}/accounts?user_id=${otherUserId}`, {
      headers: { Authorization: 'Bearer owner-token' },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [ownerAccount] });
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0][1]).toEqual([ownerId]);
    expect(query.mock.calls[0][0]).toContain('a.user_id = $1');
  });

  it('requires authentication before querying accounts', async () => {
    const response = await fetch(`${baseUrl}/accounts`);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      code: 'UNAUTHORIZED',
      message: 'Autenticación requerida',
    });
    expect(findActiveSession).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('returns an empty list for a user without accounts', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    const response = await fetch(`${baseUrl}/accounts`, {
      headers: { Authorization: 'Bearer owner-token' },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [] });
    expect(query.mock.calls[0][1]).toEqual([ownerId]);
  });

  it('returns the standard internal error response when PostgreSQL fails', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    query.mockRejectedValueOnce(new Error('database unavailable'));

    try {
      const response = await fetch(`${baseUrl}/accounts`, {
        headers: { Authorization: 'Bearer owner-token' },
      });

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        code: 'INTERNAL_ERROR',
        message: 'Error interno del servidor',
      });
    } finally {
      log.mockRestore();
    }
  });
});
