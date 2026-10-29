import 'dotenv/config';
import { z } from 'zod';

const optionalEnvString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
);

const corsOriginsEnv = z.preprocess(
  (value) => (value === undefined ? '' : value),
  z.string().transform((value, context) => {
    const origins: string[] = [];

    for (const configuredOrigin of value.split(',')) {
      const origin = configuredOrigin.trim();
      if (!origin) {
        continue;
      }

      let parsedOrigin: URL;
      try {
        parsedOrigin = new URL(origin);
      } catch {
        context.addIssue({
          code: 'custom',
          message: `Origen CORS inválido: ${origin}`,
        });
        continue;
      }

      if (
        !['http:', 'https:'].includes(parsedOrigin.protocol) ||
        parsedOrigin.pathname !== '/' ||
        parsedOrigin.search ||
        parsedOrigin.hash ||
        parsedOrigin.username ||
        parsedOrigin.password ||
        origin.includes('*')
      ) {
        context.addIssue({
          code: 'custom',
          message: `CORS_ORIGINS debe contener orígenes HTTP(S) sin rutas: ${origin}`,
        });
        continue;
      }

      origins.push(parsedOrigin.origin);
    }

    return [...new Set(origins)];
  }),
);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGINS: corsOriginsEnv,

  DATABASE_URL: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().url().optional(),
  ),
  DB_HOST: optionalEnvString,
  DB_PORT: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.coerce.number().int().positive().default(5432),
  ),
  DB_NAME: optionalEnvString,
  DB_USER: optionalEnvString,
  DB_PASSWORD: optionalEnvString,
  DB_MAX: z.coerce.number().int().positive().default(20),
  DB_IDLE_TIMEOUT_MILLIS: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.coerce.number().int().positive().default(30000),
  ),
  DB_CONNECTION_TIMEOUT_MILLIS: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.coerce.number().int().positive().default(2000),
  ),
  EXCHANGE_RATE_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  EXCHANGE_RATE_MAX_AGE_HOURS: z.coerce.number().positive().default(24),

}).refine(
  ({ DATABASE_URL, DB_HOST, DB_NAME, DB_USER, DB_PASSWORD }) =>
    Boolean(DATABASE_URL || (DB_HOST && DB_NAME && DB_USER && DB_PASSWORD)),
  {
    message: 'Configura DATABASE_URL o todos los campos DB_* requeridos',
    path: ['DATABASE_URL'],
  },
);

export const env = envSchema.parse(process.env);
