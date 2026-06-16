import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.coerce.number().int().positive(),
  JWT_REFRESH_TTL: z.coerce.number().int().positive(),
  FRONTEND_ORIGIN: z.string().url(),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive(),
  RATE_LIMIT_MAX: z.coerce.number().int().positive(),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive(),
  LOCKOUT_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOCKOUT_DURATION_SECONDS: z.coerce.number().int().positive().default(60),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = Object.freeze(parsed.data);
