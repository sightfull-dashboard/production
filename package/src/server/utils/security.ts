import bcrypt from 'bcryptjs';
import type { RequestHandler } from 'express';
import { supabaseAdmin } from '../integrations/supabase';

const BCRYPT_PREFIX = /^\$2[aby]\$\d{2}\$/;

type RateLimitOptions = {
  windowMs: number;
  maxAttempts: number;
  keyPrefix: string;
  message?: string;
  store?: RateLimitStore;
};

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

export type RateLimitStore = {
  increment: (key: string, windowMs: number, now: number) => Promise<RateLimitEntry>;
};

const rateLimitState = new Map<string, RateLimitEntry>();

const memoryRateLimitStore: RateLimitStore = {
  async increment(key, windowMs, now) {
    const entry = rateLimitState.get(key);
    if (!entry || entry.resetAt <= now) {
      const next = { count: 1, resetAt: now + windowMs };
      rateLimitState.set(key, next);
      return next;
    }
    entry.count += 1;
    return entry;
  },
};

export const createMemoryRateLimitStore = () => memoryRateLimitStore;

export const createSqliteRateLimitStore = async (sqlitePath: string): Promise<RateLimitStore> => {
  const BetterSqlite3 = (await import('better-sqlite3')).default;
  const sqlite = new BetterSqlite3(sqlitePath);
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS app_rate_limits (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      reset_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_app_rate_limits_reset_at ON app_rate_limits(reset_at);
  `);

  return {
    async increment(key, windowMs, now) {
      sqlite.prepare('DELETE FROM app_rate_limits WHERE reset_at <= ?').run(now);
      const existing = sqlite.prepare('SELECT count, reset_at FROM app_rate_limits WHERE key = ? LIMIT 1').get(key) as { count: number; reset_at: number } | undefined;
      if (!existing || existing.reset_at <= now) {
        const next = { count: 1, resetAt: now + windowMs };
        sqlite.prepare(`
          INSERT INTO app_rate_limits (key, count, reset_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET count = excluded.count, reset_at = excluded.reset_at, updated_at = excluded.updated_at
        `).run(key, next.count, next.resetAt, now, now);
        return next;
      }
      const next = { count: existing.count + 1, resetAt: existing.reset_at };
      sqlite.prepare('UPDATE app_rate_limits SET count = ?, updated_at = ? WHERE key = ?').run(next.count, now, key);
      return next;
    },
  };
};

export const createSupabaseRateLimitStore = (): RateLimitStore => {
  if (!supabaseAdmin) {
    throw new Error('Supabase rate-limit store requires Supabase to be configured.');
  }

  return {
    async increment(key, windowMs, now) {
      const nowIso = new Date(now).toISOString();
      const { data: existing, error } = await supabaseAdmin
        .from('app_rate_limits')
        .select('key,count,reset_at')
        .eq('key', key)
        .maybeSingle();
      if (error) throw error;

      const existingResetAtMs = existing?.reset_at ? new Date(existing.reset_at).getTime() : 0;
      if (!existing || !existingResetAtMs || existingResetAtMs <= now) {
        const next = { count: 1, resetAt: now + windowMs };
        const { error: upsertError } = await supabaseAdmin
          .from('app_rate_limits')
          .upsert({
            key,
            count: next.count,
            reset_at: new Date(next.resetAt).toISOString(),
            created_at: nowIso,
            updated_at: nowIso,
          }, { onConflict: 'key' });
        if (upsertError) throw upsertError;
        return next;
      }

      const next = { count: Number(existing.count || 0) + 1, resetAt: existingResetAtMs };
      const { error: updateError } = await supabaseAdmin
        .from('app_rate_limits')
        .update({ count: next.count, updated_at: nowIso })
        .eq('key', key);
      if (updateError) throw updateError;
      return next;
    },
  };
};

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

export const createRateLimitMiddleware = ({ windowMs, maxAttempts, keyPrefix, message, store = memoryRateLimitStore }: RateLimitOptions): RequestHandler => {
  const errorMessage = message || 'Too many requests. Please try again later.';
  return async (req, res, next) => {
    try {
      const now = Date.now();
      const key = `${keyPrefix}:${getRequestIp(req)}:${req.path}`;
      const entry = await store.increment(key, windowMs, now);
      if (entry.count > maxAttempts) {
        const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
        res.setHeader('Retry-After', String(retryAfterSeconds));
        return res.status(429).json({ error: errorMessage });
      }
      return next();
    } catch (error) {
      return next(error);
    }
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
