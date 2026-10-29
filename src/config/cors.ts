import cors from 'cors';
import type { CorsOptions } from 'cors';
import { env } from './env.js';

export function createCorsMiddleware(origins: readonly string[] = env.CORS_ORIGINS) {
  const allowedOrigins = new Set(origins);
  const options: CorsOptions = {
    origin(origin, callback) {
      callback(null, origin === undefined || allowedOrigins.has(origin));
    },
    methods: ['GET', 'POST'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
    credentials: false,
  };

  return cors(options);
}

export const corsMiddleware = createCorsMiddleware();
