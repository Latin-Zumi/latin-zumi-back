import { beforeEach, describe, expect, it, vi } from 'vitest';

const { clientQuery, poolQuery, release, client, connect } = vi.hoisted(() => {
  const clientQuery = vi.fn();
  const poolQuery = vi.fn();
  const release = vi.fn();
  const client = { query: clientQuery, release };
  return {
    clientQuery,
    poolQuery,
    release,
    client,
    connect: vi.fn(async () => client),
  };
});

vi.mock('../config/db.js', () => ({
  pool: { query: poolQuery, connect },
}));

const { verifyPassword, hashPassword } = vi.hoisted(() => ({
  verifyPassword: vi.fn(),
  hashPassword: vi.fn(),
}));

vi.mock('../utils/password.js', () => ({
  DUMMY_PASSWORD_HASH: 'dummy-hash',
  hashPassword,
  verifyPassword,
}));

import {
  changeUserPassword,
  createSessionForUser,
  loginWithPassword,
  toAuthUser,
} from './auth.service.js';

const userId = '20000000-0000-4000-8000-000000000001';
const expiresAt = new Date('2026-10-27T13:00:00.000Z');

const baseUser = {
  id: userId,
  username: 'ana.perez',
  email: 'ana@example.com',
  nombre: 'Ana Pérez',
  pais: 'Argentina',
  moneda_preferida: 'ARS',
  roles: ['user'],
  estado: 'activo',
  foto_url: null,
};

const userRow = {
  ...baseUser,
  password_hash: 'stored-hash',
};

function queueSuccessfulLogin(row: unknown = userRow) {
  poolQuery.mockResolvedValueOnce({ rows: [row] });
  verifyPassword.mockResolvedValueOnce({ valid: true, needsRehash: false });
  clientQuery.mockResolvedValue({
    rows: [{ expires_at: expiresAt }],
  });
}

describe('toAuthUser', () => {
  it('returns only the public contract fields', () => {
    const user = toAuthUser(baseUser);

    expect(user).toEqual({
      id: userId,
      nombre: 'Ana Pérez',
      email: 'ana@example.com',
      pais: 'Argentina',
      moneda_preferida: 'ARS',
      roles: ['user'],
      estado: 'activo',
      foto_url: null,
    });
    expect(user).not.toHaveProperty('username');
    expect(user).not.toHaveProperty('password_hash');
  });

  it('falls back to username when nombre is null', () => {
    const user = toAuthUser({ ...baseUser, nombre: null });

    expect(user.nombre).toBe('ana.perez');
  });
});

describe('createSessionForUser', () => {
  beforeEach(() => {
    clientQuery.mockReset();
    poolQuery.mockReset();
    connect.mockClear();
  });

  it('uses the provided client and does not open a transaction', async () => {
    clientQuery.mockResolvedValueOnce({ rows: [{ expires_at: expiresAt }] });

    const session = await createSessionForUser(userId, {
      passwordChangeRequired: false,
      client,
    });

    expect(connect).not.toHaveBeenCalled();
    expect(clientQuery).toHaveBeenCalledTimes(1);
    expect(clientQuery.mock.calls[0][0]).toContain('INSERT INTO auth_sessions');
    expect(clientQuery.mock.calls[0][1]).toEqual([
      userId,
      expect.any(String),
      false,
    ]);
    expect(session.token).toEqual(expect.any(String));
    expect(session.passwordChangeRequired).toBe(false);
  });

  it('uses the pool when no client is provided', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ expires_at: expiresAt }] });

    await createSessionForUser(userId, { passwordChangeRequired: true });

    expect(poolQuery).toHaveBeenCalledTimes(1);
    expect(poolQuery.mock.calls[0][0]).toContain('INSERT INTO auth_sessions');
    expect(poolQuery.mock.calls[0][1][2]).toBe(true);
  });
});

describe('loginWithPassword', () => {
  beforeEach(() => {
    poolQuery.mockReset();
    clientQuery.mockReset();
    release.mockReset();
    connect.mockClear();
    verifyPassword.mockReset();
    hashPassword.mockReset();
  });

  it('returns the session envelope for valid credentials', async () => {
    queueSuccessfulLogin();

    const result = await loginWithPassword(
      '  ANA@EXAMPLE.COM ',
      'a-long-password-123',
    );

    expect(poolQuery).toHaveBeenCalledWith(
      expect.stringContaining('FROM users'),
      ['ana@example.com'],
    );
    expect(verifyPassword).toHaveBeenCalledWith(
      'a-long-password-123',
      'stored-hash',
    );
    expect(result.user).toEqual({
      id: userId,
      nombre: 'Ana Pérez',
      email: 'ana@example.com',
      pais: 'Argentina',
      moneda_preferida: 'ARS',
      roles: ['user'],
      estado: 'activo',
      foto_url: null,
    });
    expect(result.token).toEqual(expect.any(String));

    const sql = clientQuery.mock.calls.map(([statement]) => statement);
    expect(sql[0]).toBe('BEGIN');
    expect(sql[1]).toContain('INSERT INTO auth_sessions');
    expect(sql.at(-1)).toBe('COMMIT');
    expect(release).toHaveBeenCalledOnce();
  });

  it('returns 401 for a wrong password', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [userRow] });
    verifyPassword.mockResolvedValueOnce({
      valid: false,
      needsRehash: false,
    });

    await expect(
      loginWithPassword('ana@example.com', 'wrong'),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(connect).not.toHaveBeenCalled();
  });

  it('returns 401 for an unknown user using the dummy hash', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [] });
    verifyPassword.mockResolvedValueOnce({
      valid: false,
      needsRehash: false,
    });

    await expect(
      loginWithPassword('nobody@example.com', 'wrong'),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(verifyPassword).toHaveBeenCalledWith('wrong', 'dummy-hash');
    expect(connect).not.toHaveBeenCalled();
  });

  it('returns 401 for a Google-only user without a password', async () => {
    poolQuery.mockResolvedValueOnce({
      rows: [{ ...userRow, password_hash: null }],
    });
    verifyPassword.mockResolvedValueOnce({
      valid: false,
      needsRehash: false,
    });

    await expect(
      loginWithPassword('ana@example.com', 'wrong'),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(verifyPassword).toHaveBeenCalledWith('wrong', 'dummy-hash');
  });

  it('marks short passwords as requiring a change', async () => {
    queueSuccessfulLogin();

    await loginWithPassword('ana@example.com', 'short');

    const insert = clientQuery.mock.calls.find(([statement]) =>
      statement.includes('INSERT INTO auth_sessions'),
    );
    expect(insert?.[1]?.[2]).toBe(true);
  });

  it('rehashes the password before creating the session', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [userRow] });
    verifyPassword.mockResolvedValueOnce({
      valid: true,
      needsRehash: true,
    });
    hashPassword.mockResolvedValueOnce('new-hash');
    clientQuery.mockResolvedValue({ rows: [{ expires_at: expiresAt }] });

    await loginWithPassword('ana@example.com', 'a-long-password-123');

    const sql = clientQuery.mock.calls.map(([statement]) => statement);
    expect(sql[0]).toBe('BEGIN');
    expect(sql[1]).toContain('UPDATE users SET password_hash');
    expect(clientQuery.mock.calls[1][1]).toEqual([userId, 'new-hash']);
    expect(sql[2]).toContain('INSERT INTO auth_sessions');
  });

  it('rolls back and releases the client if session creation fails', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [userRow] });
    verifyPassword.mockResolvedValueOnce({
      valid: true,
      needsRehash: false,
    });
    clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error('insert failed'));

    await expect(
      loginWithPassword('ana@example.com', 'a-long-password-123'),
    ).rejects.toThrow('insert failed');
    expect(clientQuery).toHaveBeenCalledWith('ROLLBACK');
    expect(release).toHaveBeenCalledOnce();
  });
});

describe('changeUserPassword', () => {
  beforeEach(() => {
    poolQuery.mockReset();
    verifyPassword.mockReset();
    hashPassword.mockReset();
  });

  it('returns 401 when the user has no password hash', async () => {
    poolQuery.mockResolvedValueOnce({
      rows: [{ id: userId, password_hash: null }],
    });

    await expect(
      changeUserPassword(
        { userId, sessionId: 'session-id', passwordChangeRequired: false },
        'current-password',
        'a-new-long-password-123',
      ),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(verifyPassword).not.toHaveBeenCalled();
    expect(hashPassword).not.toHaveBeenCalled();
  });
});
