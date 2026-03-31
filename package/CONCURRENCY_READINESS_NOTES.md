# Concurrency readiness changes in this build

This build improves concurrency handling without changing the UI.

## Included changes
- Optional **Supabase-backed session store** for shared session state across multiple app instances.
- Optional **Supabase- or SQLite-backed auth rate limiting** instead of in-memory-only counters.
- File vault and Super Admin client-file uploads now use **raw binary uploads** instead of base64 JSON payloads.

## New environment variables
- `SESSION_STORE_DRIVER=sqlite|supabase`
- `AUTH_RATE_LIMIT_STORE_DRIVER=memory|sqlite|supabase`
- `DIRECT_UPLOAD_LIMIT_MB=100`

## Recommended production values
- `DATABASE_PROVIDER=supabase`
- `SESSION_STORE_DRIVER=supabase`
- `AUTH_RATE_LIMIT_STORE_DRIVER=supabase`
- `TRUST_PROXY=true`
- `SESSION_COOKIE_SECURE=true`

## Required Supabase SQL
Run `SUPABASE_CONCURRENCY_TABLES.sql` before enabling the Supabase-backed session or rate-limit stores.

## What this does not fully solve yet
- Folder ZIP downloads are still generated inside the app process.
- There is still no dedicated background worker/queue for heavy jobs.
- This is a substantial improvement, but not the final scaling architecture for very high traffic.
