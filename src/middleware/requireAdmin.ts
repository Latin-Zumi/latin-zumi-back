import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/AppError.js';

export function requireAdmin(_req: Request, _res: Response, next: NextFunction): void {
  if (!_req.auth?.roles.includes('admin')) {
    throw new AppError('Permisos insuficientes', 403, 'FORBIDDEN');
  }
  next();
}
