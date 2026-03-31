# Phase 3 Patch Notes

This patch set targets the remaining partially-built items from the previous pass.

## What was patched

### 1) Oversized files reduced
- `src/App.tsx` reduced by extracting shared formatting, options, and shell UI pieces into:
  - `src/app/shared/formatters.ts`
  - `src/app/shared/formOptions.ts`
  - `src/app/shared/chrome.tsx`
- `src/components/InternalPanel.tsx` reduced by moving static config into:
  - `src/components/internal-panel/config.ts`
- `server.ts` reduced by moving payroll mail / CSV / PDF attachment logic into:
  - `src/server/utils/payrollMail.ts`

### 2) Runtime/config hardening
- `DATABASE_PROVIDER` is now validated explicitly. Invalid values fail fast.
- Added `runtimeDatabaseShape` to make the current transition state explicit.
- Database readiness now exposes `runtimeStillUsesSqlite: true` so the hybrid state is not hidden.

### 3) TypeScript hardening path
- `tsconfig.json` now includes safer baseline checks:
  - `baseUrl`
  - `forceConsistentCasingInFileNames`
  - `noFallthroughCasesInSwitch`
  - `resolveJsonModule`
- Added `tsconfig.strict.json` for phased strict adoption.
- Added npm script:
  - `npm run lint:strict`

## Line-count impact
- `src/App.tsx`: 2881 -> 2358
- `server.ts`: 2244 -> 1988
- `src/components/InternalPanel.tsx`: 2191 -> 2155

## What this does not claim
This is **not** a full migration to a Supabase/Postgres-first backend.
The app still has a hybrid runtime shape and still depends on SQLite-shaped business logic in major areas.

## Recommended next move after this patch
1. Extract leave/date/trial helpers out of `server.ts`
2. Split `InternalPanel.tsx` into tab-specific subcomponents
3. Move auth/client shell state in `App.tsx` into dedicated hooks/providers
4. Replace SQLite-first domain persistence with Supabase/Postgres tables and migrations
