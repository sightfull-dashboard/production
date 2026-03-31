# Tenant lockdown notes

This patch does three main things:

1. Locks Supabase tenant-scoped reads and writes to the active client context.
2. Treats shifts as tenant-owned data instead of a global library.
3. Removes SQLite from the runtime path so the app boots in Supabase-only mode.

## Files changed

- `src/server/routes/supabaseCore.ts`
- `src/server/routes/files.ts`
- `src/server/workers/jobHandlers.ts`
- `src/server/config/env.ts`
- `src/server/db/index.ts`
- `server.ts`
- `src/types.ts`
- `SUPABASE_SHIFTS_TENANT_LOCKDOWN.sql`

## Required database action

Run `SUPABASE_SHIFTS_TENANT_LOCKDOWN.sql` in Supabase before using this build.

Without that migration, the patched code will correctly expect `public.shifts.client_id`, and shift-scoped endpoints will fail until the column exists.

## Main behavior changes

- Super admin tenant-scoped endpoints now require an active client selection.
- `/api/shifts` now reads/writes only shifts for the active client.
- `/api/analytics` now reads only employees, roster, leave, payroll submissions, and shifts for the active client.
- Roster writes now verify that both the employee and the shift belong to the active client.
- Payroll attachment generation and payroll email jobs now use client-scoped shifts.
- Payroll submission list and support ticket list respect active client scope for super admin client-dashboard usage.
- Runtime database mode is Supabase-only.
