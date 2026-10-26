import { createHash, randomBytes } from 'node:crypto';
import { pool } from '../config/db.js';
import { AppError } from '../utils/AppError.js';
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from '../utils/password.js';

interface UserCredential {
  id: string;
  password_hash: string;
}

interface SessionRow {
  id: string;
  expires_at: Date;
}

export interface LoginSession {
  access_token: string;
  token_type: 'Bearer';
  expires_at: Date;
  password_change_required: boolean;
}

export interface AuthContext {
  userId: string;
  sessionId: string;
  passwordChangeRequired: boolean;
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createLoginSession(
  identifier: string,
  password: string,
): Promise<LoginSession> {
  const normalizedIdentifier = identifier.trim().toLowerCase();
  const userResult = await pool.query<UserCredential>(
    `SELECT id, password_hash
       FROM users
      WHERE username = $1 OR email = $1
      LIMIT 1`,
    [normalizedIdentifier],
  );
  const user = userResult.rows[0];
  const storedHash = user?.password_hash ?? DUMMY_PASSWORD_HASH;
  const verification = await verifyPassword(password, storedHash);

  if (!user || !verification.valid) {
    throw new AppError('Credenciales inválidas', 401);
  }

  const passwordChangeRequired = Array.from(password).length < 15;
  const upgradedHash = verification.needsRehash
    ? await hashPassword(password)
    : user.password_hash;
  const accessToken = randomBytes(32).toString('base64url');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    if (verification.needsRehash) {
      await client.query(
        'UPDATE users SET password_hash = $2 WHERE id = $1',
        [user.id, upgradedHash],
      );
    }

    const sessionResult = await client.query<SessionRow>(
      `INSERT INTO auth_sessions
         (user_id, token_hash, expires_at, password_change_required)
       VALUES ($1, $2, now() + interval '1 hour', $3)
       RETURNING id, expires_at`,
      [user.id, tokenHash(accessToken), passwordChangeRequired],
    );
    await client.query('COMMIT');

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_at: sessionResult.rows[0].expires_at,
      password_change_required: passwordChangeRequired,
    };
  } catch (error) {
    await client.query('ROLLBACK');
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
  if (!user) throw new AppError('Credenciales inválidas', 401);

  const verification = await verifyPassword(currentPassword, user.password_hash);
  if (!verification.valid) throw new AppError('Credenciales inválidas', 401);

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
      throw new AppError('La contraseña cambió; inicia sesión de nuevo', 409);
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
