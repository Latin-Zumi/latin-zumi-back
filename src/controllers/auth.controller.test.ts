import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { loginWithPassword, changeUserPassword, revokeSession } = vi.hoisted(
  () => ({
    loginWithPassword: vi.fn(),
    changeUserPassword: vi.fn(),
    revokeSession: vi.fn(),
  }),
);

vi.mock('../services/auth.service.js', () => ({
  loginWithPassword,
  changeUserPassword,
  revokeSession,
}));

vi.mock('../middleware/requireAuth.js', () => ({
  getAuthContext: vi.fn(),
}));

import { login } from './auth.controller.js';

const session = {
  token: 'token-123',
  user: {
    id: '20000000-0000-4000-8000-000000000001',
    nombre: 'Ana Pérez',
    email: 'ana@example.com',
    pais: 'Argentina',
    moneda_preferida: 'ARS',
    roles: ['user'],
    estado: 'activo',
    foto_url: null,
  },
};

function createResponse() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  return res as unknown as Response & typeof res;
}

describe('login', () => {
  beforeEach(() => loginWithPassword.mockReset());

  it('returns { token, user } without the data envelope', async () => {
    loginWithPassword.mockResolvedValueOnce(session);
    const res = createResponse();

    await login(
      {
        body: {
          identifier: 'ana@example.com',
          password: 'a-long-password-123',
        },
      } as Request,
      res,
    );

    expect(loginWithPassword).toHaveBeenCalledWith(
      'ana@example.com',
      'a-long-password-123',
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(session);
  });

  it('rejects an invalid identifier with 400', async () => {
    const res = createResponse();

    await expect(
      login(
        { body: { identifier: 'a', password: 'a-long-password-123' } } as Request,
        res,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(loginWithPassword).not.toHaveBeenCalled();
  });
});
