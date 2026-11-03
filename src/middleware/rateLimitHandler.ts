import type { Request, Response, NextFunction } from 'express';
import type { Options } from 'express-rate-limit';

export function rateLimitHandler(
  _req: Request,
  res: Response,
  _next: NextFunction,
  _options: Options,
) {
  res.status(429).json({
    code: 'TOO_MANY_REQUESTS',
    message: 'Demasiadas solicitudes; intenta más tarde',
  });
}
