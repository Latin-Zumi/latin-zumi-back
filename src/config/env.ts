import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_NAME: z.string().min(1),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  DB_MAX: z.coerce.number().int().positive().default(20),
  EXCHANGE_RATE_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  EXCHANGE_RATE_MAX_AGE_HOURS: z.coerce.number().positive().default(24),

});

export const env = envSchema.parse(process.env);
