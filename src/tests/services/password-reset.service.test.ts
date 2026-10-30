import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  poolQuery,
  clientQuery,
  release,
  client,
  connect,
  findUserByEmail,
  getEmailProvider,
  hashPassword,
} = vi.hoisted(() => {
  const poolQuery = vi.fn();
  const clientQuery = vi.fn();
  const release = vi.fn();
  const client = { query: clientQuery, release };
  return {
    poolQuery,
    clientQuery,
    release,
    client,
    connect: vi.fn(async () => client),
    findUserByEmail: vi.fn(),
    getEmailProvider: vi.fn(),
    hashPassword: vi.fn(),
  };
});

vi.mock('../../config/db.js', () => ({
  pool: { query: poolQuery, connect },
}));

vi.mock('../../config/env.js', () => ({
  env: {
    EMAIL_PROVIDER: 'console',
    PASSWORD_RESET_TTL_MINUTES: 30,
    PASSWORD_RESET_URL: 'http://localhost:5173/restablecer-contrasena',
  },
}));

vi.mock('../../services/users.service.js', () => ({
  findUserByEmail,
}));

vi.mock('../../services/email/email-provider.js', () => ({
  getEmailProvider,
}));

vi.mock('../../utils/password.js', () => ({
  DUMMY_PASSWORD_HASH: 'dummy-hash',
  hashPassword,
  verifyPassword: vi.fn(),
}));

import { AppError } from '../../utils/AppError.js';
import {
  requestPasswordReset,
  resetPassword,
} from '../../services/password-reset.service.js';

const userId = '20000000-0000-4000-8000-000000000001';
const resetToken = 'reset-token-value-0123456789abcdef';

describe('requestPasswordReset', () => {
  beforeEach(() => {
    poolQuery.mockReset();
    findUserByEmail.mockReset();
    getEmailProvider.mockReset();
    hashPassword.mockReset();
  });

  it('does not send anything and returns early when the user does not exist', async () => {
    findUserByEmail.mockResolvedValueOnce(null);
    getEmailProvider.mockReturnValueOnce({
      sendPasswordReset: vi.fn().mockResolvedValue(undefined),
    });

    await expect(
      requestPasswordReset('nobody@example.com', '203.0.113.10'),
    ).resolves.toBeUndefined();

    expect(findUserByEmail).toHaveBeenCalledWith('nobody@example.com');
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it('invalidates previous tokens and sends a single-use reset link for a known user', async () => {
    const sendPasswordReset = vi.fn().mockResolvedValue(undefined);
    findUserByEmail.mockResolvedValueOnce({
      id: userId,
      nombre: 'Ana Pérez',
      email: 'ana@example.com',
    });
    getEmailProvider.mockReturnValueOnce({ sendPasswordReset });
    poolQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{}] });

    await requestPasswordReset('ana@example.com', '203.0.113.10');

    expect(poolQuery).toHaveBeenCalledTimes(2);
    expect(poolQuery.mock.calls[0][0]).toContain(
      'UPDATE password_reset_tokens',
    );
    expect(poolQuery.mock.calls[0][1]).toEqual([userId]);
    expect(poolQuery.mock.calls[1][0]).toContain(
      'INSERT INTO password_reset_tokens',
    );
    expect(poolQuery.mock.calls[1][1]).toEqual([
      userId,
      expect.any(String),
      30,
      '203.0.113.10',
    ]);

    expect(sendPasswordReset).toHaveBeenCalledTimes(1);
    expect(sendPasswordReset.mock.calls[0][0]).toMatchObject({
      to: 'ana@example.com',
      resetUrl: expect.stringContaining('token='),
    });
  });

  it('returns 503 when the production email provider is not configured', async () => {
    getEmailProvider.mockImplementation(() => {
      throw new AppError(
        'El envío de correos no está configurado',
        503,
        'EMAIL_NOT_CONFIGURED',
      );
    });

    await expect(
      requestPasswordReset('ana@example.com', '203.0.113.10'),
    ).rejects.toMatchObject({ statusCode: 503, code: 'EMAIL_NOT_CONFIGURED' });
    expect(findUserByEmail).not.toHaveBeenCalled();
  });
});

describe('resetPassword', () => {
  beforeEach(() => {
    poolQuery.mockReset();
    clientQuery.mockReset();
    release.mockReset();
    connect.mockClear();
    hashPassword.mockReset();
  });

  it('returns 400 INVALID_RESET_TOKEN when the token is unknown or already used', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(
      resetPassword(resetToken, 'a-new-long-password-123'),
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_RESET_TOKEN' });

    expect(hashPassword).not.toHaveBeenCalled();
    expect(clientQuery).not.toHaveBeenCalled();
  });

  it('consumes the token, updates the password and revokes sessions atomically', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{},], rowCount: 1 });
    hashPassword.mockResolvedValueOnce('new-hash');
    clientQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ user_id: userId }] }) // claimed
      .mockResolvedValueOnce({ rows: [] }) // UPDATE users
      .mockResolvedValueOnce({ rows: [] }) // UPDATE auth_sessions
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    await expect(
      resetPassword(resetToken, 'a-new-long-password-123'),
    ).resolves.toBeUndefined();

    const statements = clientQuery.mock.calls.map(([statement]) => statement);
    expect(statements[0]).toBe('BEGIN');
    expect(statements[1]).toContain('UPDATE password_reset_tokens');
    expect(statements[1]).toContain('RETURNING user_id');
    expect(statements[2]).toContain('UPDATE users SET password_hash');
    expect(statements[3]).toContain('UPDATE auth_sessions');
    expect(statements.at(-1)).toBe('COMMIT');
    expect(release).toHaveBeenCalledOnce();
  });

  it('updates the password hash of the user owned by the token', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{},], rowCount: 1 });
    hashPassword.mockResolvedValueOnce('new-hash');
    clientQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ user_id: userId }] }) // claimed
      .mockResolvedValueOnce({ rows: [] }) // UPDATE users
      .mockResolvedValueOnce({ rows: [] }); // UPDATE auth_sessions

    await resetPassword(resetToken, 'a-new-long-password-123');

    expect(hashPassword).toHaveBeenCalledWith('a-new-long-password-123');
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE users SET password_hash'),
      [userId, 'new-hash'],
    );
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE auth_sessions'),
      [userId],
    );
  });

  it('rolls back and releases the client when the token cannot be claimed', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{},], rowCount: 1 });
    hashPassword.mockResolvedValueOnce('new-hash');
    clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      resetPassword(resetToken, 'a-new-long-password-123'),
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_RESET_TOKEN' });
    expect(clientQuery).toHaveBeenCalledWith('ROLLBACK');
    expect(release).toHaveBeenCalledOnce();
  });
});
