import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  loginWithPassword,
  changeUserPassword,
  registerAccount,
  revokeSession,
  requestPasswordReset,
  resetPassword,
} = vi.hoisted(() => ({
  loginWithPassword: vi.fn(),
  changeUserPassword: vi.fn(),
  registerAccount: vi.fn(),
  revokeSession: vi.fn(),
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
}));

vi.mock('../../services/auth.service.js', () => ({
  loginWithPassword,
  changeUserPassword,
  registerAccount,
  revokeSession,
}));

vi.mock('../../services/password-reset.service.js', () => ({
  requestPasswordReset,
  resetPassword,
}));

vi.mock('../../middleware/requireAuth.js', () => ({
  getAuthContext: vi.fn(),
}));

import { changePassword, forgotPassword, login, register, resetPasswordHandler } from '../../controllers/auth.controller.js';
import { getAuthContext } from '../../middleware/requireAuth.js';

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
    end: vi.fn(),
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

describe('register', () => {
  const validBody = {
    nombre: 'Ana Pérez',
    email: 'ana@example.com',
    pais: 'Argentina',
    password: '12345678',
  };

  beforeEach(() => registerAccount.mockReset());

  it('accepts a password with the minimum length', async () => {
    registerAccount.mockResolvedValueOnce(session);
    const res = createResponse();

    await register({ body: validBody } as Request, res);

    expect(registerAccount).toHaveBeenCalledWith(validBody);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('rejects a password shorter than the minimum with a clear message', async () => {
    const res = createResponse();

    await expect(
      register({ body: { ...validBody, password: '1234567' } } as Request, res),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'La contraseña debe tener al menos 8 caracteres',
    });
    expect(registerAccount).not.toHaveBeenCalled();
  });

  it('rejects a password longer than the maximum with a clear message', async () => {
    const res = createResponse();

    await expect(
      register(
        { body: { ...validBody, password: 'a'.repeat(129) } } as Request,
        res,
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'La contraseña no puede superar los 128 caracteres',
    });
    expect(registerAccount).not.toHaveBeenCalled();
  });
});

describe('changePassword', () => {
  beforeEach(() => {
    changeUserPassword.mockReset();
    vi.mocked(getAuthContext).mockReturnValue({
      userId: 'user-1',
      sessionId: 'session-1',
      passwordChangeRequired: false,
    } as never);
  });

  it('rejects a new password shorter than the minimum with a clear message', async () => {
    const res = createResponse();

    await expect(
      changePassword(
        {
          body: { current_password: 'current', new_password: '1234567' },
        } as Request,
        res,
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'La contraseña debe tener al menos 8 caracteres',
    });
    expect(changeUserPassword).not.toHaveBeenCalled();
  });

  it('accepts a new password with the minimum length', async () => {
    const res = createResponse();
    changeUserPassword.mockResolvedValueOnce(undefined);

    await changePassword(
      {
        body: { current_password: 'current', new_password: '12345678' },
      } as Request,
      res,
    );

    expect(changeUserPassword).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
      'current',
      '12345678',
    );
    expect(res.status).toHaveBeenCalledWith(204);
  });
});

describe('forgotPassword', () => {
  beforeEach(() => requestPasswordReset.mockReset());

  it('returns 202 with the generic message for a valid email', async () => {
    requestPasswordReset.mockResolvedValueOnce(undefined);
    const res = createResponse();

    await forgotPassword(
      { body: { email: 'ana@example.com' }, ip: '203.0.113.10' } as Request,
      res,
    );

    expect(requestPasswordReset).toHaveBeenCalledWith(
      'ana@example.com',
      '203.0.113.10',
    );
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith({
      message:
        'Si el email está registrado, te enviamos instrucciones para restablecer la contraseña.',
    });
  });

  it('rejects an invalid email with 400 before calling the service', async () => {
    const res = createResponse();

    await expect(
      forgotPassword({ body: { email: 'no-valid-email' } } as Request, res),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(requestPasswordReset).not.toHaveBeenCalled();
  });
});

describe('resetPassword', () => {
  beforeEach(() => resetPassword.mockReset());

  it('rejects a password shorter than the minimum with a clear message', async () => {
    const res = createResponse();

    await expect(
      resetPasswordHandler(
        { body: { token: 'a'.repeat(32), password: '1234567' } } as Request,
        res,
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'La contraseña debe tener al menos 8 caracteres',
    });
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it('accepts a valid token and password, returning 204', async () => {
    resetPassword.mockResolvedValueOnce(undefined);
    const res = createResponse();

    await resetPasswordHandler(
      { body: { token: 'a'.repeat(32), password: '12345678' } } as Request,
      res,
    );

    expect(resetPassword).toHaveBeenCalledWith('a'.repeat(32), '12345678');
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
  });
});
