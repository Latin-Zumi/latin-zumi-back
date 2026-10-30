import { createHash, randomBytes } from 'node:crypto';
import { pool } from '../config/db.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { hashPassword } from '../utils/password.js';
import { findUserByEmail } from './users.service.js';
import { getEmailProvider } from './email/email-provider.js';

export async function requestPasswordReset(
  email: string,
  requestedIp: string | null,
): Promise<void> {
  // Se resuelve antes de buscar al usuario: si el proveedor de producción no
  // está configurado, todos los emails reciben 503, no solo los existentes.
  const provider = getEmailProvider();

  const user = await findUserByEmail(email);
  if (!user) return; // misma respuesta y mismo camino externo

  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');

  await pool.query(
    `UPDATE password_reset_tokens
        SET used_at = now()
      WHERE user_id = $1 AND used_at IS NULL`,
    [user.id],
  );

  await pool.query(
    `INSERT INTO password_reset_tokens
       (user_id, token_hash, expires_at, requested_ip)
     VALUES ($1, $2, now() + make_interval(mins => $3), $4)`,
    [user.id, tokenHash, env.PASSWORD_RESET_TTL_MINUTES, requestedIp],
  );

  const resetUrl = new URL(env.PASSWORD_RESET_URL);
  resetUrl.searchParams.set('token', token);

  // Se envía después de responder. El tiempo de respuesta no depende de si el
  // email existe y el usuario no espera a que Resend termine.
  void provider
    .sendPasswordReset({ to: user.email, nombre: user.nombre, resetUrl: resetUrl.toString() })
    .catch((error: unknown) => {
      console.error(
        'No se pudo enviar el email de recuperación',
        error instanceof Error ? error.message : error,
      );
    });
}

export async function resetPassword(
  token: string,
  password: string,
): Promise<void> {
  const tokenHash = createHash('sha256').update(token).digest('hex');

  // Chequeo barato antes de hashear la contraseña (scrypt es costoso).
  const existing = await pool.query(
    `SELECT 1
       FROM password_reset_tokens
      WHERE token_hash = $1
        AND used_at IS NULL
        AND expires_at > now()`,
    [tokenHash],
  );
  if (existing.rowCount === 0) {
    throw new AppError(
      'El enlace venció o ya fue usado. Pedí uno nuevo.',
      400,
      'INVALID_RESET_TOKEN',
    );
  }

  const passwordHash = await hashPassword(password);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // El UPDATE es la operación atómica de consumo: si dos pedidos usan el
    // mismo token, solo uno obtiene la fila.
    const claimed = await client.query<{ user_id: string }>(
      `UPDATE password_reset_tokens
          SET used_at = now()
        WHERE token_hash = $1
          AND used_at IS NULL
          AND expires_at > now()
        RETURNING user_id`,
      [tokenHash],
    );

    const row = claimed.rows[0];
    if (!row) {
      throw new AppError(
        'El enlace venció o ya fue usado. Pedí uno nuevo.',
        400,
        'INVALID_RESET_TOKEN',
      );
    }

    await client.query(
      'UPDATE users SET password_hash = $2 WHERE id = $1',
      [row.user_id, passwordHash],
    );

    await client.query(
      `UPDATE auth_sessions
          SET revoked_at = now()
        WHERE user_id = $1 AND revoked_at IS NULL`,
      [row.user_id],
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
