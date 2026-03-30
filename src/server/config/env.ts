import dotenv from 'dotenv';

dotenv.config();

const toInt = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBool = (value: string | undefined, fallback = false) => {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

const normalizeSecret = (value: string | undefined) => String(value ?? '').trim();

const normalizeDatabaseProvider = (value: string | undefined) => {
  const normalized = String(value ?? 'sqlite').trim().toLowerCase();
  if (normalized === 'sqlite' || normalized === 'supabase') return normalized;
  throw new Error(`Unsupported DATABASE_PROVIDER: ${normalized}. Use sqlite or supabase.`);
};

const normalizeSameSite = (value: string | undefined) => {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === 'lax' || normalized === 'strict' || normalized === 'none') return normalized;
  throw new Error('SESSION_COOKIE_SAMESITE must be one of lax, strict, or none.');
};

const parseCsv = (value: string | undefined) => String(value ?? '')
  .split(',')
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);

const INSECURE_SESSION_SECRETS = new Set([
  '',
  'change-me-sightfull-session-secret',
  'changeme',
  'secret',
  'password',
]);
const DEV_ONLY_SESSION_SECRET = 'dev-only-sightfull-session-secret';

const rawNodeEnv = process.env.NODE_ENV ?? 'development';
const isProductionNodeEnv = rawNodeEnv === 'production';
const rawSessionSecret = normalizeSecret(process.env.SESSION_SECRET);
const rawBootstrapSuperAdminPassword = normalizeSecret(process.env.BOOTSTRAP_SUPERADMIN_PASSWORD);
const rawBootstrapSuperAdminEmail = normalizeSecret(process.env.BOOTSTRAP_SUPERADMIN_EMAIL).toLowerCase();
const configuredSuperAdminEmails = parseCsv(process.env.SUPERADMIN_EMAILS);
const sessionCookieSameSite = normalizeSameSite(process.env.SESSION_COOKIE_SAMESITE)
  ?? (isProductionNodeEnv ? 'lax' : 'lax');

const resolveSessionSecret = () => {
  if (rawSessionSecret && !INSECURE_SESSION_SECRETS.has(rawSessionSecret)) {
    return rawSessionSecret;
  }

  if (isProductionNodeEnv) {
    throw new Error('SESSION_SECRET must be set to a strong non-default value in production.');
  }

  return rawSessionSecret || DEV_ONLY_SESSION_SECRET;
};

export const env = {
  nodeEnv: rawNodeEnv,
  port: toInt(process.env.PORT, 3000),
  appUrl: process.env.APP_URL ?? 'http://localhost:3000',
  databaseProvider: normalizeDatabaseProvider(process.env.DATABASE_PROVIDER),
  sqlitePath: process.env.SQLITE_PATH ?? 'sightfull.db',
  sessionSqlitePath: process.env.SESSION_SQLITE_PATH ?? 'sightfull-sessions.db',
  sessionSecret: resolveSessionSecret(),
  sessionMaxAgeMs: toInt(process.env.SESSION_MAX_AGE_MS, 24 * 60 * 60 * 1000),
  sessionCookieSameSite,
  sessionCookieSecure: toBool(process.env.SESSION_COOKIE_SECURE, isProductionNodeEnv),
  trustProxy: toBool(process.env.TRUST_PROXY, isProductionNodeEnv),
  bodyLimitMb: toInt(process.env.BODY_LIMIT_MB, 25),
  authRateLimitWindowMs: toInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
  authRateLimitMaxAttempts: toInt(process.env.AUTH_RATE_LIMIT_MAX_ATTEMPTS, 10),
  fileDownloadUrlTtlSeconds: toInt(process.env.FILE_DOWNLOAD_URL_TTL_SECONDS, 15 * 60),
  superAdminEmails: Array.from(new Set([
    ...configuredSuperAdminEmails,
    ...(rawBootstrapSuperAdminEmail ? [rawBootstrapSuperAdminEmail] : []),
  ])),
  bootstrapSuperAdminEmail: rawBootstrapSuperAdminEmail || '',
  bootstrapSuperAdminPassword: rawBootstrapSuperAdminPassword || '',
  supabaseUrl: process.env.SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  supabaseStorageBucket: process.env.SUPABASE_STORAGE_BUCKET ?? 'client-files',
  supabaseBucketClientAssets: process.env.SUPABASE_BUCKET_CLIENT_ASSETS ?? 'client-assets',
  supabaseBucketEmployeeDocuments: process.env.SUPABASE_BUCKET_EMPLOYEE_DOCUMENTS ?? 'employee-documents',
  supabaseBucketVaultFiles: process.env.SUPABASE_BUCKET_VAULT_FILES ?? 'vault-files',
  supabaseBucketPayrollAttachments: process.env.SUPABASE_BUCKET_PAYROLL_ATTACHMENTS ?? 'payroll-attachments',
  smtpHost: process.env.SMTP_HOST ?? '',
  smtpPort: toInt(process.env.SMTP_PORT, 587),
  smtpSecure: toBool(process.env.SMTP_SECURE, false),
  smtpUser: process.env.SMTP_USER ?? '',
  smtpPass: process.env.SMTP_PASS ?? '',
  smtpFromName: process.env.SMTP_FROM_NAME ?? process.env.MAIL_FROM_NAME ?? 'Sightfull',
  smtpFromEmail: process.env.SMTP_FROM_EMAIL ?? process.env.MAIL_FROM_EMAIL ?? '',
};

export const isProduction = env.nodeEnv === 'production';
export const isSupabaseConfigured = Boolean(env.supabaseUrl && env.supabaseServiceRoleKey);
export const isSupabaseSelected = env.databaseProvider === 'supabase';
export const runtimeDatabaseShape = isSupabaseSelected ? 'hybrid-transition' : 'sqlite-primary';
export const isSmtpConfigured = Boolean(env.smtpHost && env.smtpUser && env.smtpPass && env.smtpFromEmail);

export const runtimeConfigWarnings = [
  !rawSessionSecret || INSECURE_SESSION_SECRETS.has(rawSessionSecret)
    ? 'SESSION_SECRET is missing or using a placeholder value. A dev-only secret will be used outside production.'
    : null,
  isSupabaseSelected
    ? 'DATABASE_PROVIDER=supabase is configured, but some legacy SQLite-shaped logic still exists in the repo. Validate all flows against Supabase before rollout.'
    : null,
  isSupabaseSelected && !isSupabaseConfigured
    ? 'DATABASE_PROVIDER is set to supabase, but SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing. The app cannot safely run in this mode.'
    : null,
  env.superAdminEmails.length === 0
    ? 'No SUPERADMIN_EMAILS configured. Bootstrap a super admin with BOOTSTRAP_SUPERADMIN_EMAIL and BOOTSTRAP_SUPERADMIN_PASSWORD before first production login.'
    : null,
  !env.bootstrapSuperAdminEmail && !env.bootstrapSuperAdminPassword
    ? null
    : (!env.bootstrapSuperAdminEmail || !env.bootstrapSuperAdminPassword)
      ? 'BOOTSTRAP_SUPERADMIN_EMAIL and BOOTSTRAP_SUPERADMIN_PASSWORD must be supplied together.'
      : null,
].filter((warning): warning is string => Boolean(warning));

export const assertRuntimeConfiguration = () => {
  if (isProduction && (!rawSessionSecret || INSECURE_SESSION_SECRETS.has(rawSessionSecret))) {
    throw new Error('Refusing to boot in production with a missing or insecure SESSION_SECRET.');
  }

  if (isProduction && env.sessionCookieSameSite === 'none' && !env.sessionCookieSecure) {
    throw new Error('SESSION_COOKIE_SAMESITE=none requires SESSION_COOKIE_SECURE=true in production.');
  }

  if (isSupabaseSelected && !isSupabaseConfigured) {
    throw new Error('DATABASE_PROVIDER=supabase requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }

  if (isProduction && (env.bodyLimitMb < 1 || env.bodyLimitMb > 100)) {
    throw new Error('BODY_LIMIT_MB must be between 1 and 100 in production.');
  }

  if (env.bootstrapSuperAdminEmail || env.bootstrapSuperAdminPassword) {
    if (!env.bootstrapSuperAdminEmail || !env.bootstrapSuperAdminPassword) {
      throw new Error('BOOTSTRAP_SUPERADMIN_EMAIL and BOOTSTRAP_SUPERADMIN_PASSWORD must be supplied together.');
    }
    if (env.bootstrapSuperAdminPassword.length < 12) {
      throw new Error('BOOTSTRAP_SUPERADMIN_PASSWORD must be at least 12 characters.');
    }
  }
};
