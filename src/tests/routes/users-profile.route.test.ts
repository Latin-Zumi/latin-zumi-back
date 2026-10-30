import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findActiveSession,
  findUserByEmail,
  registerUser,
  updateUserProfile,
  toAuthUser,
} = vi.hoisted(() => ({
  findActiveSession: vi.fn(),
  findUserByEmail: vi.fn(),
  registerUser: vi.fn(),
  updateUserProfile: vi.fn(),
  toAuthUser: vi.fn((row: {
    id: string;
    username: string;
    email: string;
    nombre: string | null;
    pais: string | null;
    moneda_preferida: string;
    roles: string[];
    estado: string;
    foto_url: string | null;
  }) => ({
    id: row.id,
    nombre: row.nombre?.trim() || row.username,
    email: row.email,
    pais: row.pais,
    moneda_preferida: row.moneda_preferida,
    roles: row.roles,
    estado: row.estado,
    foto_url: row.foto_url,
  })),
}));

vi.mock('../../services/auth.service.js', () => ({
  findActiveSession,
  toAuthUser,
}));

vi.mock('../../services/users.service.js', () => ({
  findUserByEmail,
  registerUser,
  updateUserProfile,
}));

let server: Server;
let baseUrl: string;

describe('PATCH /users/me', () => {
  beforeAll(async () => {
    const [{ usersRouter }, { errorHandler }] = await Promise.all([
      import('../../routes/users.route.js'),
      import('../../middleware/errorHandler.js'),
    ]);

    const app = express();
    app.use(express.json());
    app.use(usersRouter);
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
    findActiveSession.mockReset().mockResolvedValue({
      userId: 'authenticated-user',
      sessionId: 'active-session',
      passwordChangeRequired: false,
    });
    updateUserProfile.mockReset().mockResolvedValue({
      id: 'authenticated-user',
      nombre: 'Ana Pérez',
      email: 'ana@example.com',
      pais: 'Argentina',
      moneda_preferida: 'ARS',
      roles: ['user'],
      estado: 'activo',
      foto_url: null,
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
    }
  });

  it('requires a valid backend session', async () => {
    const response = await fetch(`${baseUrl}/users/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pais: 'Argentina' }),
    });

    expect(response.status).toBe(401);
    expect(updateUserProfile).not.toHaveBeenCalled();
  });

  it('updates the profile belonging to the authenticated session', async () => {
    const response = await fetch(`${baseUrl}/users/me`, {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer valid-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ pais: 'Argentina' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      user: { id: 'authenticated-user', pais: 'Argentina', moneda_preferida: 'ARS' },
    });
    expect(findActiveSession).toHaveBeenCalledWith('valid-token');
    expect(updateUserProfile).toHaveBeenCalledWith(
      'authenticated-user',
      { pais: 'Argentina' },
    );
  });
});
