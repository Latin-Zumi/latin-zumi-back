import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findUserByEmail,
  registerUser,
  updateUserProfile,
  getAuthContext,
} = vi.hoisted(() => ({
  findUserByEmail: vi.fn(),
  registerUser: vi.fn(),
  updateUserProfile: vi.fn(),
  getAuthContext: vi.fn(),
}));

vi.mock('../../services/users.service.js', () => ({
  findUserByEmail,
  registerUser,
  updateUserProfile,
}));

vi.mock('../../config/db.js', () => ({
  pool: { connect: vi.fn(), query: vi.fn() },
}));

vi.mock('../../services/firebase-admin.service.js', () => ({
  verifyGoogleIdToken: vi.fn(),
}));

vi.mock('../../services/auth.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/auth.service.js')>();
  return { toAuthUser: actual.toAuthUser };
});

vi.mock('../../middleware/requireAuth.js', () => ({
  getAuthContext,
}));

import { updateMe } from '../../controllers/users.controller.js';

function createResponse() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  return res as unknown as Response & typeof res;
}

describe('updateMe', () => {
  beforeEach(() => {
    updateUserProfile.mockReset();
    getAuthContext.mockReset().mockReturnValue({ userId: 'authenticated-user' });
  });

  it('updates the authenticated profile and returns the AuthUser under user', async () => {
    const user = {
      id: 'authenticated-user',
      username: 'ana',
      email: 'ana@example.com',
      nombre: 'Ana Pérez',
      pais: 'Argentina',
      moneda_preferida: 'ARS',
      roles: ['user'],
      estado: 'activo',
      foto_url: null,
      password_hash: 'sensitive-password-hash',
      access_token: 'sensitive-access-token',
      FIREBASE_PRIVATE_KEY: 'sensitive-private-key',
    };
    updateUserProfile.mockResolvedValueOnce(user);
    const res = createResponse();

    await updateMe({ body: { nombre: ' Ana Pérez ', pais: 'Argentina' } } as Request, res);

    expect(updateUserProfile).toHaveBeenCalledWith(
      'authenticated-user',
      { nombre: 'Ana Pérez', pais: 'Argentina' },
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      user: {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        pais: user.pais,
        moneda_preferida: user.moneda_preferida,
        roles: user.roles,
        estado: user.estado,
        foto_url: user.foto_url,
      },
    });
    const responseBody = res.json.mock.calls[0][0];
    expect(JSON.stringify(responseBody)).not.toContain('sensitive-password-hash');
    expect(JSON.stringify(responseBody)).not.toContain('sensitive-access-token');
    expect(JSON.stringify(responseBody)).not.toContain('sensitive-private-key');
    expect(responseBody.user).not.toHaveProperty('password_hash');
    expect(responseBody.user).not.toHaveProperty('access_token');
    expect(responseBody.user).not.toHaveProperty('FIREBASE_PRIVATE_KEY');
  });

  it('rejects invalid countries and names outside the schema length limits', async () => {
    const res = createResponse();

    await expect(
      updateMe({ body: { pais: 'Brasil' } } as unknown as Request, res),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      updateMe({ body: { nombre: 'Ana2', pais: 'Argentina' } } as Request, res),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      updateMe({ body: { nombre: 'A', pais: 'Argentina' } } as Request, res),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      updateMe({ body: { nombre: 'A'.repeat(51), pais: 'Argentina' } } as Request, res),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      updateMe({ body: { nombre: 'Ana' } } as Request, res),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(updateUserProfile).not.toHaveBeenCalled();
  });

  it('uses username as the public name fallback when the stored name is null', async () => {
    updateUserProfile.mockResolvedValueOnce({
      id: 'authenticated-user',
      username: 'ana',
      email: 'ana@example.com',
      nombre: null,
      pais: 'Argentina',
      moneda_preferida: 'ARS',
      roles: ['user'],
      estado: 'activo',
      foto_url: null,
    });
    const res = createResponse();

    await updateMe({ body: { pais: 'Argentina' } } as Request, res);

    expect(res.json).toHaveBeenCalledWith({
      user: expect.objectContaining({ nombre: 'ana' }),
    });
  });
});
