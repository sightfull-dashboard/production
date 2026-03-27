# Keep / Kill / Rewrite Audit

## Keep
These files contain solid product logic and should be preserved as source material, then modularized:

- `src/server/routes/leave.ts`
  - Strongest business rules in the app: accruals, overlap checks, approvals, balances.
- `src/server/routes/workforce.ts`
  - Core employee, shift, roster, and timesheet logic is already meaningful.
- `src/server/routes/files.ts`
  - Important payroll submission and vault flows already exist.
- `src/components/employee/*`
  - Good employee portal direction.
- `src/components/LeaveSection.tsx`
  - Mature workflow surface compared with the rest of the UI.
- `src/components/PayrollSubmissionsSection.tsx`
  - Strategically important for the product.

## Rewrite around existing logic
These should not be thrown away, but they should stop being orchestration hubs:

- `server.ts`
  - Too many responsibilities: bootstrap, schema creation, migrations, auth, tenant resolution, business helpers.
- `src/App.tsx`
  - Top-level orchestration is too large and state-heavy.
- `src/components/InternalPanel.tsx`
  - Valuable functionality, but currently a mini-app inside the app.
- `src/components/AdminPanel.tsx`
  - Useful admin surface, but should become smaller module-specific screens.
- `src/components/EmployeeSection.tsx`
  - Keep the flow, reduce the state and prop complexity.
- `src/components/RosterSection.tsx`
  - Preserve product logic, reduce coupling to app root.
- `src/components/FilesSection.tsx`
  - Keep UX direction, rebuild storage and permission flow more cleanly.

## Kill
These are architectural patterns or duplicate implementations that should not survive the rebuild:

- Duplicate Supabase admin client definitions
  - The app had both `src/server/integrations/supabase.ts` and `src/server/supabaseClient.ts` creating admin clients.
- Default employee PIN fallback behavior
  - Implicit `1234` behavior is insecure.
- Placeholder production session secret behavior
  - A production boot should fail without a proper secret.
- Migration logic that relies on stale schema snapshots
  - This is what caused the `staff_loan` duplicate-column problem.
- Route-local tenant resolution duplication
  - Centralize it rather than reimplementing it file by file.

## Refactor priority order
1. `server.ts`
2. `src/App.tsx`
3. `src/components/InternalPanel.tsx`
4. `src/server/routes/files.ts`
5. `src/server/routes/workforce.ts`
6. `src/components/RosterSection.tsx`
7. `src/components/EmployeeSection.tsx`
