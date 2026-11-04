import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { findActiveSession, getWalletRates } = vi.hoisted(() => ({
  findActiveSession: vi.fn(),
  getWalletRates: vi.fn(),
}));

vi.mock('../../services/auth.service.js', () => ({ findActiveSession }));
vi.mock('../../services/wallet-rates.service.js', () => ({ getWalletRates }));

import { walletRouter } from '../../routes/wallet.route.js';
import { errorHandler } from '../../middleware/errorHandler.js';

const ownerId = '20000000-0000-4000-8000-000000000001';
let server: Server;
let baseUrl: string;

describe('GET /wallet/rates', () => {
  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('DB_HOST', 'localhost');
    vi.stubEnv('DB_PORT', '5432');
    vi.stubEnv('DB_NAME', 'wallet-rates-route-test');
    vi.stubEnv('DB_USER', 'wallet-rates-route-test');
    vi.stubEnv('DB_PASSWORD', 'wallet-rates-route-test');
    vi.stubEnv('PORT', '3000');

    const app = express();
    app.use(walletRouter);
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
    findActiveSession.mockReset();
    getWalletRates.mockReset();
    findActiveSession.mockImplementation(async (token: string) => {
      if (token !== 'owner-token') return null;
      return {
        userId: ownerId,
        sessionId: '30000000-0000-4000-8000-000000000001',
        passwordChangeRequired: false,
        roles: ['user'],
      };
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

  it('requires authentication before reading the rates', async () => {
    const response = await fetch(`${baseUrl}/wallet/rates`);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: 'UNAUTHORIZED', message: 'Autenticación requerida' });
    expect(findActiveSession).not.toHaveBeenCalled();
    expect(getWalletRates).not.toHaveBeenCalled();
  });

  it('returns the rates for a user without an admin role', async () => {
    const walletRates = {
      base: 'USD',
      rates: { USD: '1', ARS: '1450.25', COP: '4100.5', EUR: '0.92' },
      observed_at: '2026-11-04T18:00:00.000Z',
      exchange_spread_percent: '0.00',
      interest_rates: [
        { currency: 'ARS', annual_percent: '0.00' },
        { currency: 'COP', annual_percent: '0.00' },
        { currency: 'EUR', annual_percent: '0.00' },
        { currency: 'USD', annual_percent: '0.00' },
      ],
    };
    getWalletRates.mockResolvedValueOnce(walletRates);

    const response = await fetch(`${baseUrl}/wallet/rates`, {
      headers: { Authorization: 'Bearer owner-token' },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: walletRates });
    expect(getWalletRates).toHaveBeenCalledWith();
  });

  it('returns 403 while a password change is pending', async () => {
    findActiveSession.mockImplementation(async (token: string) => {
      if (token !== 'owner-token') return null;
      return {
        userId: ownerId,
        sessionId: '30000000-0000-4000-8000-000000000001',
        passwordChangeRequired: true,
        roles: ['user'],
      };
    });

    const response = await fetch(`${baseUrl}/wallet/rates`, {
      headers: { Authorization: 'Bearer owner-token' },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: 'FORBIDDEN', message: 'Debes actualizar tu contraseña' });
  });
});
