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

vi.mock('../../config/db.js', () => ({
  pool: { query: poolQuery, connect },
}));

const { verifyPassword, hashPassword } = vi.hoisted(() => ({
  verifyPassword: vi.fn(),
  hashPassword: vi.fn(),
}));
const { verifyGoogleIdToken } = vi.hoisted(() => ({
  verifyGoogleIdToken: vi.fn(),
}));

vi.mock('../../utils/password.js', () => ({
  DUMMY_PASSWORD_HASH: 'dummy-hash',
  hashPassword,
  verifyPassword,
}));
vi.mock('../../services/firebase-admin.service.js', () => ({
  verifyGoogleIdToken,
}));

import {
  changeUserPassword,
  createSessionForUser,
  loginWithGoogle,
  loginWithPassword,
  toAuthUser,
} from '../../services/auth.service.js';

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
const googleIdentity = {
  googleUid: 'google-uid-1',
  email: 'ana@example.com',
  emailVerified: true as const,
  nombre: 'Ana Pérez',
  fotoUrl: 'https://example.com/ana.png',
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

  it.each(['inactivo', 'bloqueado'])(
    'rejects a correctly authenticated %s user without opening a session transaction',
    async (estado) => {
      poolQuery.mockResolvedValueOnce({
        rows: [{ ...userRow, estado }],
      });
      verifyPassword.mockResolvedValueOnce({
        valid: true,
        needsRehash: false,
      });

      await expect(
        loginWithPassword('ana@example.com', 'correct-password'),
      ).rejects.toMatchObject({
        statusCode: 403,
        code: 'USER_BLOCKED',
        message: 'Tu cuenta no está habilitada',
      });

      expect(verifyPassword).toHaveBeenCalledWith(
        'correct-password',
        'stored-hash',
      );
      expect(connect).not.toHaveBeenCalled();
      expect(clientQuery).not.toHaveBeenCalled();
      expect(release).not.toHaveBeenCalled();
    },
  );

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

  it('does not mark passwords at the minimum length as requiring a change', async () => {
    queueSuccessfulLogin();

    await loginWithPassword('ana@example.com', '12345678');

    const insert = clientQuery.mock.calls.find(([statement]) =>
      statement.includes('INSERT INTO auth_sessions'),
    );
    expect(insert?.[1]?.[2]).toBe(false);
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

describe('loginWithGoogle', () => {
  beforeEach(() => {
    clientQuery.mockReset();
    poolQuery.mockReset();
    release.mockReset();
    connect.mockReset().mockResolvedValue(client);
    verifyGoogleIdToken.mockReset();
    verifyGoogleIdToken.mockResolvedValue(googleIdentity);
  });

  it('creates a new Google user, wallet, account, and session transactionally', async () => {
    clientQuery.mockImplementation(async (statement: string) => {
      if (statement.includes('WHERE google_uid =')) return { rows: [] };
      if (statement.includes('WHERE lower(email) =')) return { rows: [] };
      if (statement.includes('INSERT INTO users')) {
        return { rows: [{ ...baseUser, pais: null, moneda_preferida: 'USD' }] };
      }
      if (statement.includes('INSERT INTO wallets')) return { rows: [{ id: 'wallet-id' }] };
      if (statement.includes('INSERT INTO accounts')) return { rows: [{ id: 'account-id' }] };
      if (statement.includes('INSERT INTO auth_sessions')) return { rows: [{ expires_at: expiresAt }] };
      return { rows: [] };
    });

    const result = await loginWithGoogle('firebase-id-token');

    expect(verifyGoogleIdToken).toHaveBeenCalledWith('firebase-id-token');
    expect(result).toMatchObject({
      token: expect.any(String),
      passwordChangeRequired: false,
      user: {
        id: userId,
        email: 'ana@example.com',
        pais: null,
        moneda_preferida: 'USD',
      },
    });
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO users'),
      [
        'ana',
        'ana@example.com',
        null,
        'Ana Pérez',
        null,
        'USD',
        'google-uid-1',
        'https://example.com/ana.png',
      ],
    );
    expect(clientQuery.mock.calls[0][0]).toBe('BEGIN');
    expect(clientQuery.mock.calls.at(-1)?.[0]).toBe('COMMIT');
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO auth_sessions'),
      [userId, expect.any(String), false],
    );
    expect(release).toHaveBeenCalledOnce();
  });

  it.each([
    {
      stage: 'wallet',
      failedStatement: 'INSERT INTO wallets',
      completedStatements: ['INSERT INTO users'],
    },
    {
      stage: 'account',
      failedStatement: 'INSERT INTO accounts',
      completedStatements: ['INSERT INTO users', 'INSERT INTO wallets'],
    },
    {
      stage: 'session',
      failedStatement: 'INSERT INTO auth_sessions',
      completedStatements: [
        'INSERT INTO users',
        'INSERT INTO wallets',
        'INSERT INTO accounts',
      ],
    },
  ])('rolls back when Google user creation fails at the $stage step', async ({
    failedStatement,
    completedStatements,
  }) => {
    const databaseError = new Error('Database operation failed');
    clientQuery.mockImplementation(async (statement: string) => {
      if (statement.includes(failedStatement)) throw databaseError;
      if (statement.includes('WHERE google_uid =')) return { rows: [] };
      if (statement.includes('WHERE lower(email) =')) return { rows: [] };
      if (statement.includes('INSERT INTO users')) {
        return { rows: [{ ...baseUser, pais: null, moneda_preferida: 'USD' }] };
      }
      if (statement.includes('INSERT INTO wallets')) return { rows: [{ id: 'wallet-id' }] };
      if (statement.includes('INSERT INTO accounts')) return { rows: [{ id: 'account-id' }] };
      if (statement.includes('INSERT INTO auth_sessions')) {
        return { rows: [{ expires_at: expiresAt }] };
      }
      return { rows: [] };
    });

    await expect(loginWithGoogle('firebase-id-token')).rejects.toBe(databaseError);

    const statements = clientQuery.mock.calls.map(([statement]) => statement as string);
    expect(statements).toContain('ROLLBACK');
    expect(statements).not.toContain('COMMIT');
    expect(completedStatements.every((completed) =>
      statements.some((statement) => statement.includes(completed)),
    )).toBe(true);
    expect(statements.some((statement) => statement.includes(failedStatement))).toBe(true);
    expect(databaseError.message).not.toContain('firebase-id-token');
    expect(release).toHaveBeenCalledOnce();
  });

  it('links a verified Google identity to an existing account without replacing its password', async () => {
    clientQuery.mockImplementation(async (statement: string) => {
      if (statement.includes('WHERE google_uid =')) return { rows: [] };
      if (statement.includes('WHERE lower(email) =')) {
        return { rows: [{ ...baseUser, google_uid: null }] };
      }
      if (statement.includes('UPDATE users')) return { rows: [baseUser] };
      if (statement.includes('INSERT INTO auth_sessions')) return { rows: [{ expires_at: expiresAt }] };
      return { rows: [] };
    });

    const result = await loginWithGoogle('firebase-id-token');

    expect(result.user).toMatchObject({ id: userId, pais: 'Argentina' });
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('SET google_uid = $2'),
      [userId, 'google-uid-1', googleIdentity.fotoUrl, googleIdentity.nombre],
    );
    expect(clientQuery.mock.calls.some(([statement]) =>
      statement.includes('INSERT INTO wallets'),
    )).toBe(false);
    expect(clientQuery.mock.calls.at(-1)?.[0]).toBe('COMMIT');
  });

  it('reuses an existing Google user and creates a fresh session on repeated login', async () => {
    clientQuery.mockImplementation(async (statement: string) => {
      if (statement.includes('WHERE google_uid =')) return { rows: [baseUser] };
      if (statement.includes('INSERT INTO auth_sessions')) return { rows: [{ expires_at: expiresAt }] };
      return { rows: [] };
    });

    const firstLogin = await loginWithGoogle('firebase-id-token');
    const secondLogin = await loginWithGoogle('firebase-id-token');

    expect(firstLogin.user).toEqual(secondLogin.user);
    expect(firstLogin.token).not.toBe(secondLogin.token);
    expect(clientQuery.mock.calls.filter(([statement]) =>
      statement.includes('INSERT INTO auth_sessions'),
    )).toHaveLength(2);
    expect(clientQuery.mock.calls.some(([statement]) =>
      statement.includes('INSERT INTO users') || statement.includes('INSERT INTO wallets'),
    )).toBe(false);
    expect(clientQuery.mock.calls.filter(([statement]) => statement === 'COMMIT')).toHaveLength(2);
  });

  it('serializes simultaneous logins for the same Google identity', async () => {
    let googleUser: {
      id: string;
      username: string;
      email: string;
      nombre: string | null;
      pais: string | null;
      moneda_preferida: string;
      roles: string[];
      estado: string;
      foto_url: string | null;
    } | null = null;
    let userInsertCount = 0;
    let walletInsertCount = 0;
    let accountInsertCount = 0;
    let sessionInsertCount = 0;
    const mutexes = new Map<string, { tail: Promise<void> }>();
    const acquire = async (key: string): Promise<() => void> => {
      let mutex = mutexes.get(key);
      if (!mutex) {
        mutex = { tail: Promise.resolve() };
        mutexes.set(key, mutex);
      }
      const previous = mutex.tail;
      let releaseLock!: () => void;
      mutex.tail = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });
      await previous;
      return releaseLock;
    };

    connect.mockImplementation(async () => {
      const transactionLocks: Array<() => void> = [];
      return {
        release: vi.fn(),
        query: vi.fn(async (statement: string, values?: unknown[]) => {
          if (statement === 'BEGIN') return { rows: [] };
          if (statement.includes('pg_advisory_xact_lock')) {
            transactionLocks.push(await acquire(String(values?.[0])));
            return { rows: [] };
          }
          if (statement.includes('WHERE google_uid =')) {
            return { rows: googleUser ? [googleUser] : [] };
          }
          if (statement.includes('WHERE lower(email) =')) {
            return { rows: googleUser ? [{ ...googleUser, google_uid: googleIdentity.googleUid }] : [] };
          }
          if (statement.includes('INSERT INTO users')) {
            userInsertCount += 1;
            googleUser = { ...baseUser, pais: null, moneda_preferida: 'USD' };
            return { rows: [googleUser] };
          }
          if (statement.includes('INSERT INTO wallets')) {
            walletInsertCount += 1;
            return { rows: [{ id: 'wallet-id' }] };
          }
          if (statement.includes('INSERT INTO accounts')) {
            accountInsertCount += 1;
            return { rows: [{ id: 'account-id' }] };
          }
          if (statement.includes('INSERT INTO auth_sessions')) {
            sessionInsertCount += 1;
            return { rows: [{ expires_at: expiresAt }] };
          }
          if (statement === 'COMMIT' || statement === 'ROLLBACK') {
            for (const releaseLock of transactionLocks.splice(0).reverse()) {
              releaseLock();
            }
            return { rows: [] };
          }
          return { rows: [] };
        }),
      } as never;
    });

    const results = await Promise.all([
      loginWithGoogle('firebase-id-token'),
      loginWithGoogle('firebase-id-token'),
    ]);

    expect(userInsertCount).toBe(1);
    expect(walletInsertCount).toBe(1);
    expect(accountInsertCount).toBe(1);
    expect(sessionInsertCount).toBe(2);
    expect(results[0].user).toEqual(results[1].user);
    expect(results[0].token).not.toBe(results[1].token);
  });

  it('rejects a Google UID already linked to another account', async () => {
    clientQuery.mockImplementation(async (statement: string) => {
      if (statement.includes('WHERE google_uid =')) return { rows: [] };
      if (statement.includes('WHERE lower(email) =')) {
        return { rows: [{ ...baseUser, google_uid: 'other-google-uid' }] };
      }
      return { rows: [] };
    });

    await expect(loginWithGoogle('firebase-id-token')).rejects.toMatchObject({
      statusCode: 409,
      code: 'GOOGLE_ACCOUNT_CONFLICT',
    });
    expect(clientQuery).toHaveBeenCalledWith('ROLLBACK');
    expect(release).toHaveBeenCalledOnce();
  });

  it('does not create a session for a disabled user', async () => {
    clientQuery.mockImplementation(async (statement: string) => {
      if (statement.includes('WHERE google_uid =')) {
        return { rows: [{ ...baseUser, estado: 'bloqueado' }] };
      }
      return { rows: [] };
    });

    await expect(loginWithGoogle('firebase-id-token')).rejects.toMatchObject({
      statusCode: 403,
      code: 'USER_BLOCKED',
    });
    expect(clientQuery.mock.calls.some(([statement]) =>
      statement.includes('INSERT INTO auth_sessions'),
    )).toBe(false);
    expect(clientQuery).toHaveBeenCalledWith('ROLLBACK');
  });
});

describe('changeUserPassword', () => {
  beforeEach(() => {
    poolQuery.mockReset();
    verifyPassword.mockReset();
    hashPassword.mockReset();
  });

  it('returns PASSWORD_NOT_SET when the user has no password hash', async () => {
    poolQuery.mockResolvedValueOnce({
      rows: [{ id: userId, password_hash: null }],
    });

    await expect(
      changeUserPassword(
        { userId, sessionId: 'session-id', passwordChangeRequired: false },
        'current-password',
        'a-new-long-password-123',
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'PASSWORD_NOT_SET',
    });
    expect(verifyPassword).not.toHaveBeenCalled();
    expect(hashPassword).not.toHaveBeenCalled();
  });
});
