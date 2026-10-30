import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { findActiveSession, loginWithGoogle } = vi.hoisted(() => ({
  findActiveSession: vi.fn(),
  loginWithGoogle: vi.fn(),
}));

vi.mock('../../services/auth.service.js', () => ({
  findActiveSession,
  loginWithGoogle,
}));

let server: Server;
let baseUrl: string;

describe('POST /auth/google', () => {
  beforeAll(async () => {
    const [{ authRouter }, { errorHandler }] = await Promise.all([
      import('../../routes/auth.route.js'),
      import('../../middleware/errorHandler.js'),
    ]);

    const app = express();
    app.use(express.json());
    app.use(authRouter);
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
    loginWithGoogle.mockReset();
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
    }
  });

  it('exposes Google login and returns the expected response contract', async () => {
    loginWithGoogle.mockResolvedValueOnce({
      token: 'opaque-session-token',
      user: {
        id: '20000000-0000-4000-8000-000000000001',
        nombre: 'Ana Pérez',
        email: 'ana@example.com',
        pais: null,
        moneda_preferida: 'USD',
        roles: ['user'],
        estado: 'activo',
        foto_url: null,
      },
      passwordChangeRequired: false,
    });

    const response = await fetch(`${baseUrl}/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: 'f'.repeat(20) }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      token: 'opaque-session-token',
      user: { email: 'ana@example.com', pais: null },
      password_change_required: false,
    });
    expect(loginWithGoogle).toHaveBeenCalledWith('f'.repeat(20));
  });

  it('returns 400 for an invalid payload', async () => {
    const response = await fetch(`${baseUrl}/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: 'short' }),
    });

    expect(response.status).toBe(400);
    expect(loginWithGoogle).not.toHaveBeenCalled();
  });
});
