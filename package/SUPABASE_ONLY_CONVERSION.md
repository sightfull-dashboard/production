# Supabase-first conversion pass

This package converts the app away from SQLite on the critical runtime path when `DATABASE_PROVIDER=supabase`.

## What changed
- `src/server/db/index.ts`
  - SQLite is now lazy-loaded only when `DATABASE_PROVIDER != supabase`.
  - Supabase mode no longer opens a SQLite database on startup.
- `src/server/routes/supabaseCore.ts`
  - New Supabase-backed route layer for:
    - auth login/me/logout
    - employee login/me/logout
    - employees CRUD + offboard
    - shifts CRUD
    - roster get/save
    - roster-meta get/save
    - leave requests get/create/update/cancel
    - health/readiness
- `server.ts`
  - Registers `registerSupabaseCoreRoutes(...)` when `DATABASE_PROVIDER=supabase`.
  - Skips legacy SQLite auth/workforce/leave route registration in Supabase mode.
  - Skips SQLite initialization/migration/seed path in Supabase mode.
  - Activity logging writes to Supabase in Supabase mode.
  - Trial/feature guards are bypassed in Supabase mode for now to avoid legacy SQLite dependencies.
- `src/server/utils/tenant.ts`
  - Works without a SQLite handle in Supabase mode by relying on session client context.
- `vite.config.ts`
  - Removed client-side secret injection for `GEMINI_API_KEY`.
  - Added Render/localhost allowed hosts.
  - Bound dev/preview to `0.0.0.0`.

## Important limitations
This is a strong conversion pass, but not a perfect end-state rebuild.

Still worth knowing:
- Some legacy SQLite-only helper code remains in the repo for fallback/local compatibility.
- The new Supabase core routes are the active routes in Supabase mode.
- Existing `admin` and `files` routes were already partly Supabase-backed and are still used.
- Trial/feature-lock enforcement in Supabase mode is intentionally relaxed in this pass.
- I did not verify every endpoint against a live Supabase project from inside this container.
- I could not run a full local typecheck/build here because the uploaded ZIP did not include installed `node_modules`.

## Environment expectations
For Supabase mode you still need:
- `DATABASE_PROVIDER=supabase`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- a real `SESSION_SECRET`

Optional depending on your deployment:
- SMTP variables if you want server-side email sending

## Render notes
If you deploy on Render:
- keep SMTP disabled on free plans unless you move off blocked SMTP ports or upgrade
- use real environment variables in Render service settings
