import type { CookieOptions } from 'express';
import { env } from '../config/env';

export function refreshCookieOptions(): CookieOptions {
  const isProd = env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    path: '/api/v1/auth',
    maxAge: env.JWT_REFRESH_TTL * 1000,
  };
}
