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

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: toInt(process.env.PORT, 3000),
  appUrl: process.env.APP_URL ?? 'http://localhost:3000',
  databaseProvider: (process.env.DATABASE_PROVIDER ?? 'sqlite').toLowerCase(),
  sqlitePath: process.env.SQLITE_PATH ?? 'sightfull.db',
  sessionSecret: process.env.SESSION_SECRET ?? 'change-me-sightfull-session-secret',
  sessionMaxAgeMs: toInt(process.env.SESSION_MAX_AGE_MS, 24 * 60 * 60 * 1000),
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
export const isSmtpConfigured = Boolean(env.smtpHost && env.smtpUser && env.smtpPass && env.smtpFromEmail);
