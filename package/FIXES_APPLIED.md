# Fixes Applied

## Security and auth
- Added runtime validation for `SESSION_SECRET`.
- Production now refuses to boot with a missing or placeholder `SESSION_SECRET`.
- Development uses a dev-only fallback secret instead of the old placeholder.
- Removed employee login fallback that treated missing PINs as `1234`.
- Removed employee schema defaults that silently created `1234` PINs for new rows or migrated rows.
- Removed the UI edit fallback that displayed `1234` for employees with no stored PIN.

## Database and migrations
- Fixed the `roster_meta` migration bug that could add `staff_loan` twice.
- Reworked that migration to use a mutable set of known columns instead of a stale schema snapshot.

## Supabase and integration cleanup
- Deduplicated the Supabase admin client by turning `src/server/supabaseClient.ts` into a re-export of the canonical integration module.
- Updated admin/files routes to consume the canonical Supabase admin client source.

## Tenant scoping cleanup
- Added `src/server/utils/tenant.ts` to centralize session role and effective client resolution.
- Updated workforce route logic to use the shared tenant helper.

## Config hygiene
- Updated `.env.example` to stop advertising the insecure placeholder session secret.

## Still not fully rebuilt
These items are improved but not fully completed in this pass:
- The app still has a SQLite-first runtime shape in large parts of the backend.
- `server.ts`, `src/App.tsx`, and `InternalPanel.tsx` are still oversized.
- Full Supabase/Postgres-first persistence is still a larger migration.
