# Production deployment checklist

## What was hardened in this package
- Removed hardcoded default super-admin seeding.
- Added optional secure bootstrap super-admin via environment variables.
- Added persistent SQLite-backed session storage for Express sessions.
- Added security response headers and same-origin mutation protection.
- Added rate limiting for login and test-mail endpoints.
- Switched employee portal PIN handling to bcrypt hashing with lazy migration from legacy plaintext values.
- Stopped returning employee PIN values to the frontend.
- Upgraded Supabase file uploads from raw base64 metadata storage to real Supabase Storage uploads.
- Added signed download URLs for Supabase-hosted files.
- Added recursive Supabase-backed folder zip downloads.

## Required environment variables before production
- `NODE_ENV=production`
- `APP_URL=https://your-domain.example`
- `SESSION_SECRET=<long random secret>`
- `SESSION_COOKIE_SECURE=true`
- `TRUST_PROXY=true` when behind Render/Nginx/Cloudflare/etc.
- `SUPERADMIN_EMAILS=<comma-separated emails>`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY`
- SMTP values if payroll emails must send from the app

## First secure boot
Use one of these approaches:
1. Set `BOOTSTRAP_SUPERADMIN_EMAIL` and `BOOTSTRAP_SUPERADMIN_PASSWORD` for the first boot, log in, then remove the bootstrap password from the environment.
2. Pre-create a super-admin row in the database and include that email in `SUPERADMIN_EMAILS`.

## Important operational notes
- Sessions now persist to `SESSION_SQLITE_PATH`. Keep that file on persistent disk.
- Supabase buckets used by the app must already exist.
- Signed download links expire after `FILE_DOWNLOAD_URL_TTL_SECONDS`.
- Legacy employee PINs will automatically migrate to bcrypt hashes the first time each employee successfully logs in.

## Recommended rollout order
1. Set production environment variables.
2. Deploy.
3. Verify `/api/health` and `/api/system/readiness`.
4. Create/login as super admin.
5. Verify client login and employee portal login.
6. Upload a file to the vault and confirm signed download works.
7. Submit a payroll test email.
