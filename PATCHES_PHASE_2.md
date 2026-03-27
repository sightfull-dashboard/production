# Phase 2 Patches Applied

This package adds another pass of concrete fixes on top of the previous audit bundle.

## Patched now

### 1. Tenant scoping hardening
- Centralized active-client storage/header handling into `src/lib/activeClient.ts`.
- Centralized backend tenant resolution in `src/server/utils/tenant.ts`.
- Super admin `x-active-client-id` scope is now normalized and only accepted when the client exists.
- Server-side actor client resolution is now shared instead of duplicated in `server.ts`.

### 2. Environment validation hardening
- `DATABASE_PROVIDER=supabase` now refuses to boot without `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
- Runtime readiness now clearly reports the current hybrid transition state instead of implying a fully clean DB mode split.

### 3. Frontend header duplication cleanup
- Removed repeated localStorage/header-building logic from:
  - `src/App.tsx`
  - `src/components/AnalyticsSection.tsx`
  - `src/lib/api.ts`
- These now use the shared active-client helper.

## Still not fully rebuilt
- The backend is still in a hybrid SQLite/Supabase transition shape.
- `server.ts`, `src/App.tsx`, and `src/components/InternalPanel.tsx` are still oversized.
- Supabase is still not the single source of truth for all domain data yet.
- TypeScript strictness is still not hardened globally.
