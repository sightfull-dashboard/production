import bcrypt from 'bcryptjs';
import type { RequestHandler } from 'express';

const BCRYPT_PREFIX = /^\$2[aby]\$\d{2}\$/;

type RateLimitOptions = {
  windowMs: number;
  maxAttempts: number;
  keyPrefix: string;
  message?: string;
};

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const rateLimitState = new Map<string, RateLimitEntry>();

export const isHashedSecret = (value: unknown) => typeof value === 'string' && BCRYPT_PREFIX.test(value);

export const hashSecret = (value: string) => bcrypt.hashSync(value, 12);

export const verifySecret = (plainTextValue: string, storedValue: unknown) => {
  const normalizedStoredValue = typeof storedValue === 'string' ? storedValue.trim() : '';
  if (!plainTextValue || !normalizedStoredValue) return false;
  if (isHashedSecret(normalizedStoredValue)) {
    return bcrypt.compareSync(plainTextValue, normalizedStoredValue);
  }
  return plainTextValue === normalizedStoredValue;
};

export const shouldUpgradeLegacySecret = (plainTextValue: string, storedValue: unknown) => {
  const normalizedStoredValue = typeof storedValue === 'string' ? storedValue.trim() : '';
  return Boolean(plainTextValue && normalizedStoredValue && !isHashedSecret(normalizedStoredValue) && plainTextValue === normalizedStoredValue);
};

export const sanitizeEmployeeForResponse = <T extends Record<string, any>>(employee: T | null | undefined) => {
  if (!employee) return employee;
  const next: Record<string, any> = { ...employee };
  if ('pin' in next) next.pin = '';
  return next as T;
};

export const sanitizeEmployeesForResponse = <T extends Record<string, any>>(employees: T[]) => employees.map((employee) => sanitizeEmployeeForResponse(employee));

const getRequestIp = (req: any) => {
  const forwardedFor = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwardedFor || req.ip || req.socket?.remoteAddress || 'unknown';
};

export const createRateLimitMiddleware = ({ windowMs, maxAttempts, keyPrefix, message }: RateLimitOptions): RequestHandler => {
  const errorMessage = message || 'Too many requests. Please try again later.';
  return (req, res, next) => {
    const now = Date.now();
    const key = `${keyPrefix}:${getRequestIp(req)}:${req.path}`;
    const entry = rateLimitState.get(key);

    if (!entry || entry.resetAt <= now) {
      rateLimitState.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    entry.count += 1;
    if (entry.count > maxAttempts) {
      const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({ error: errorMessage });
    }

    return next();
  };
};

export const securityHeadersMiddleware: RequestHandler = (_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Origin-Agent-Cluster', '?1');
  next();
};

export const createOriginProtectionMiddleware = (appUrl: string, enabled: boolean): RequestHandler => {
  const appOrigin = (() => {
    try {
      return new URL(appUrl).origin;
    } catch {
      return '';
    }
  })();

  return (req, res, next) => {
    if (!enabled) return next();
    const method = String(req.method || 'GET').toUpperCase();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return next();

    const origin = String(req.headers.origin || '').trim();
    if (!origin || !appOrigin || origin === appOrigin) return next();

    return res.status(403).json({ error: 'Blocked by origin policy' });
  };
};

export const maskProtectedValue = (value: unknown) => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized ? '__protected__' : null;
};
