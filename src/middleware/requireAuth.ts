import type { NextFunction, Request, Response } from 'express';
import { findActiveSession, type AuthContext } from '../services/auth.service.js';
import { AppError } from '../utils/AppError.js';

export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const match = /^Bearer\s+([A-Za-z0-9_-]+)$/i.exec(
    req.headers.authorization ?? '',
  );
  if (!match) throw new AppError('Autenticación requerida', 401);

  const session = await findActiveSession(match[1]);
  if (!session) throw new AppError('Sesión inválida o vencida', 401);

  req.auth = session;
  if (
    session.passwordChangeRequired &&
    !['/auth/change-password', '/auth/logout'].includes(req.path)
  ) {
    throw new AppError('Debes actualizar tu contraseña', 403);
  }
  next();
}

export function getAuthContext(req: Request): AuthContext {
  if (!req.auth) throw new AppError('Autenticación requerida', 401);
  return req.auth;
}
