import type { Request } from 'express';
import { AppError } from './AppError.js';

// La validación del formato vive en el helper para que las rutas de transferencia,
// retiro, ingreso y wallet usen la misma regla sin repetirla.
export function requireIdempotencyKey(req: Request): string {
  const key = req.header('Idempotency-Key');
  if (!key || key.length > 200 || !/^[\x21-\x7E]+$/.test(key)) {
    throw new AppError(
      'Se requiere un Idempotency-Key válido (máximo 200 caracteres)',
      400,
      'INVALID_IDEMPOTENCY_KEY',
    );
  }
  return key;
}
