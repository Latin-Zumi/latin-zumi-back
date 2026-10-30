import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from '../config/db.js';
import { AppError } from '../utils/AppError.js';
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from '../utils/password.js';
import { PASSWORD_MIN_LENGTH } from '../schemas/password.js';
import { createUserWithWallet, type UserProfileRow } from './users.service.js';
import { currencyForCountry, type Pais } from '../utils/country.js';
import { verifyGoogleIdToken, type GoogleIdentity } from './firebase-admin.service.js';

interface UserCredential {
  id: string;
  password_hash: string | null;
}

export type AuthUserRow = UserProfileRow;

export interface RegisterAccountInput {
  nombre: string;
  email: string;
  pais: Pais;
  password: string;
}

export interface AuthUser {
  id: string;
  nombre: string;
  email: string;
  pais: string | null;
  moneda_preferida: string;
  roles: string[];
  estado: string;
  foto_url: string | null;
}

export interface AuthContext {
  userId: string;
  sessionId: string;
  passwordChangeRequired: boolean;
}

export interface CreatedSession {
  token: string;
  expiresAt: Date;
  passwordChangeRequired: boolean;
}

type Queryable = Pick<PoolClient, 'query'>;

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function toAuthUser(row: AuthUserRow): AuthUser {
  return {
    id: row.id,
    nombre: row.nombre?.trim() || row.username,
    email: row.email,
    pais: row.pais,
    moneda_preferida: row.moneda_preferida,
    roles: row.roles,
    estado: row.estado,
    foto_url: row.foto_url,
  };
}

function buildUsername(email: string): string {
  const localPart = email
    .slice(0, email.indexOf('@'))
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, 30);
  return localPart || 'user';
}

function isEmailUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const databaseError = error as { code?: string; constraint?: string };
  return databaseError.code === '23505' && (
    databaseError.constraint === 'users_email_key' ||
    databaseError.constraint === 'users_email_lower_idx'
  );
}

function isGoogleUidUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const databaseError = error as { code?: string; constraint?: string };
  return databaseError.code === '23505'
    && databaseError.constraint === 'users_google_uid_idx';
}

async function findOrCreateGoogleUser(
  client: PoolClient,
  identity: GoogleIdentity,
): Promise<UserProfileRow> {
  const lockKeys = [
    `google-uid:${identity.googleUid}`,
    `google-email:${identity.email}`,
  ].sort();
  for (const lockKey of lockKeys) {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey]);
  }

  const byGoogle = await client.query<UserProfileRow>(
    `SELECT id, username, email, nombre, pais,
            RTRIM(moneda_preferida) AS moneda_preferida,
            roles, estado, foto_url
       FROM users
      WHERE google_uid = $1
      FOR UPDATE`,
    [identity.googleUid],
  );
  if (byGoogle.rows[0]) return byGoogle.rows[0];

  const byEmail = await client.query<
    UserProfileRow & { google_uid: string | null }
  >(
    `SELECT id, username, email, nombre, pais,
            RTRIM(moneda_preferida) AS moneda_preferida,
            roles, estado, foto_url, google_uid
       FROM users
      WHERE lower(email) = $1
      FOR UPDATE`,
    [identity.email],
  );

  const existing = byEmail.rows[0];
  if (existing) {
    if (existing.google_uid && existing.google_uid !== identity.googleUid) {
      throw new AppError(
        'Ese email ya está vinculado a otra cuenta de Google',
        409,
        'GOOGLE_ACCOUNT_CONFLICT',
      );
    }

    const linked = await client.query<UserProfileRow>(
      `UPDATE users
          SET google_uid = $2,
              foto_url = COALESCE(foto_url, $3),
              nombre = COALESCE(NULLIF(trim(nombre), ''), $4)
        WHERE id = $1
        RETURNING id, username, email, nombre, pais,
                  RTRIM(moneda_preferida) AS moneda_preferida,
                  roles, estado, foto_url`,
      [existing.id, identity.googleUid, identity.fotoUrl, identity.nombre],
    );
    return linked.rows[0];
  }

  const { user } = await createUserWithWallet(client, {
    username: buildUsername(identity.email),
    email: identity.email,
    passwordHash: null,
    nombre: identity.nombre ?? buildUsername(identity.email),
    pais: null,
    monedaPreferida: 'USD',
    googleUid: identity.googleUid,
    fotoUrl: identity.fotoUrl,
  });
  return user;
}

export async function registerAccount(
  input: RegisterAccountInput,
): Promise<{ token: string; user: AuthUser }> {
  const passwordHash = await hashPassword(input.password);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const { user } = await createUserWithWallet(client, {
      username: buildUsername(input.email),
      email: input.email,
      passwordHash,
      nombre: input.nombre,
      pais: input.pais,
      monedaPreferida: currencyForCountry(input.pais),
    });
    const session = await createSessionForUser(user.id, {
      passwordChangeRequired: false,
      client,
    });
    await client.query('COMMIT');
    return { token: session.token, user: toAuthUser(user) };
  } catch (error) {
    await client.query('ROLLBACK');
    if (isEmailUniqueViolation(error)) {
      throw new AppError('Email ya registrado', 409);
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function createSessionForUser(
  userId: string,
  options: { passwordChangeRequired: boolean; client?: Queryable },
): Promise<CreatedSession> {
  const token = randomBytes(32).toString('base64url');
  const queryable = options.client ?? pool;

  const result = await queryable.query<{ expires_at: Date }>(
    `INSERT INTO auth_sessions
       (user_id, token_hash, expires_at, password_change_required)
     VALUES ($1, $2, now() + interval '1 hour', $3)
     RETURNING expires_at`,
    [userId, tokenHash(token), options.passwordChangeRequired],
  );

  return {
    token,
    expiresAt: result.rows[0].expires_at,
    passwordChangeRequired: options.passwordChangeRequired,
  };
}

export async function loginWithPassword(
  identifier: string,
  password: string,
): Promise<{
  token: string;
  user: AuthUser;
  passwordChangeRequired: boolean;
}> {
  const normalized = identifier.trim().toLowerCase();

  const userResult = await pool.query<
    AuthUserRow & { password_hash: string | null }
  >(
    `SELECT id, username, email, nombre, pais,
            RTRIM(moneda_preferida) AS moneda_preferida,
            roles, estado, foto_url, password_hash
       FROM users
      WHERE username = $1 OR email = $1
      LIMIT 1`,
    [normalized],
  );

  const user = userResult.rows[0];
  const storedHash = user?.password_hash ?? DUMMY_PASSWORD_HASH;
  const verification = await verifyPassword(password, storedHash);

  if (!user || !verification.valid) {
    throw new AppError('Credenciales inválidas', 401);
  }

  if (user.estado !== 'activo') {
    throw new AppError('Tu cuenta no está habilitada', 403, 'USER_BLOCKED');
  }

  const passwordChangeRequired = Array.from(password).length < PASSWORD_MIN_LENGTH;
  // scrypt es costoso: se calcula antes de abrir la transacción para no
  // retener una conexión mientras se hashea la contraseña.
  const upgradedHash = verification.needsRehash
    ? await hashPassword(password)
    : null;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    if (upgradedHash) {
      await client.query(
        'UPDATE users SET password_hash = $2 WHERE id = $1',
        [user.id, upgradedHash],
      );
    }

    const session = await createSessionForUser(user.id, {
      passwordChangeRequired,
      client,
    });
    await client.query('COMMIT');

    return {
      token: session.token,
      user: toAuthUser(user),
      passwordChangeRequired: session.passwordChangeRequired,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function loginWithGoogle(idToken: string): Promise<{
  token: string;
  user: AuthUser;
  passwordChangeRequired: boolean;
}> {
  const identity = await verifyGoogleIdToken(idToken);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const user = await findOrCreateGoogleUser(client, identity);
    if (user.estado !== 'activo') {
      throw new AppError('Tu cuenta no está habilitada', 403, 'USER_BLOCKED');
    }

    const session = await createSessionForUser(user.id, {
      passwordChangeRequired: false,
      client,
    });
    await client.query('COMMIT');

    return {
      token: session.token,
      user: toAuthUser(user),
      passwordChangeRequired: false,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    if (isEmailUniqueViolation(error) || isGoogleUidUniqueViolation(error)) {
      throw new AppError(
        'Ese email ya está vinculado a otra cuenta',
        409,
        'GOOGLE_ACCOUNT_CONFLICT',
      );
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function findActiveSession(token: string): Promise<AuthContext | null> {
  const result = await pool.query<AuthContext>(
    `SELECT user_id AS "userId",
            id AS "sessionId",
            password_change_required AS "passwordChangeRequired"
       FROM auth_sessions
      WHERE token_hash = $1
        AND revoked_at IS NULL
        AND expires_at > now()`,
    [tokenHash(token)],
  );

  return result.rows[0] ?? null;
}

export async function revokeSession(userId: string, sessionId: string): Promise<void> {
  await pool.query(
    `UPDATE auth_sessions
        SET revoked_at = now()
      WHERE id = $1
        AND user_id = $2
        AND revoked_at IS NULL`,
    [sessionId, userId],
  );
}

export async function changeUserPassword(
  context: AuthContext,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const userResult = await pool.query<UserCredential>(
    'SELECT id, password_hash FROM users WHERE id = $1',
    [context.userId],
  );
  const user = userResult.rows[0];
  if (!user) {
    throw new AppError('Credenciales inválidas', 401);
  }
  if (!user.password_hash) {
    throw new AppError(
      'Esta cuenta no tiene una contraseña configurada',
      409,
      'PASSWORD_NOT_SET',
    );
  }

  if (currentPassword === newPassword) {
    throw new AppError(
      'La nueva contraseña debe ser distinta de la actual',
      400,
      'PASSWORD_UNCHANGED',
    );
  }

  const verification = await verifyPassword(currentPassword, user.password_hash);
  if (!verification.valid) {
    throw new AppError(
      'La contraseña actual es incorrecta',
      401,
      'INVALID_CURRENT_PASSWORD',
    );
  }

  const newHash = await hashPassword(newPassword);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updateResult = await client.query(
      `UPDATE users
          SET password_hash = $2
        WHERE id = $1 AND password_hash = $3`,
      [context.userId, newHash, user.password_hash],
    );
    if (updateResult.rowCount !== 1) {
      throw new AppError(
        'La contraseña cambió; inicia sesión de nuevo',
        409,
        'CONFLICT',
      );
    }

    await client.query(
      `UPDATE auth_sessions
          SET revoked_at = now()
        WHERE user_id = $1
          AND id <> $2
          AND revoked_at IS NULL`,
      [context.userId, context.sessionId],
    );
    await client.query(
      `UPDATE auth_sessions
          SET password_change_required = false
        WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [context.sessionId, context.userId],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
