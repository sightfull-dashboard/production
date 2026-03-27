# File-by-File Audit

| File | Action | Why |
|---|---|---|
| `server.ts` | Rewrite around existing logic | It is the main backend risk surface: bootstrap, migrations, auth, tenant logic, route wiring, and business helpers are all mixed together. |
| `src/App.tsx` | Rewrite around existing logic | It is the main frontend orchestration layer and has grown too large to scale safely. |
| `src/components/InternalPanel.tsx` | Rewrite around existing logic | Functionally important, but too large and state-heavy to remain as one component. |
| `src/components/LeaveSection.tsx` | Keep, then modularize | Strong workflow and business rule mapping. |
| `src/components/EmployeeSection.tsx` | Refactor heavily | Good product value, but too coupled to root state. |
| `src/components/RosterSection.tsx` | Refactor heavily | Strong domain value, but should move into a dedicated roster module. |
| `src/components/FilesSection.tsx` | Refactor heavily | Valuable UX, transitional storage architecture underneath. |
| `src/components/AdminPanel.tsx` | Refactor heavily | Good capability surface, but should be split by admin concern. |
| `src/components/TimesheetSection.tsx` | Refactor heavily | Important payroll-adjacent UI, but should be isolated from global app state. |
| `src/components/PayrollSubmissionsSection.tsx` | Keep, then modularize | High product value and directly aligned to the SaaS direction. |
| `src/components/employee/ApplyLeave.tsx` | Keep | Clear employee self-service logic and good domain fit. |
| `src/components/employee/MyLeave.tsx` | Keep | Good reuse candidate in the employee portal. |
| `src/components/employee/EmployeeDashboard.tsx` | Keep | Good portal direction, relatively contained. |
| `src/components/employee/EmployeeDocuments.tsx` | Refactor lightly | Good feature, but storage access will likely change. |
| `src/components/employee/EmployeeProfile.tsx` | Refactor lightly | Useful, but benefits from cleaner employee module boundaries. |
| `src/server/routes/leave.ts` | Keep | Strongest backend business logic in the app. |
| `src/server/routes/workforce.ts` | Keep, then modularize | Core workforce logic is worth preserving. |
| `src/server/routes/files.ts` | Keep, then modularize | Important flows already exist; storage abstraction needs work. |
| `src/server/routes/admin.ts` | Keep, then modularize | Valuable super-admin capability set. |
| `src/server/routes/authSystem.ts` | Refactor lightly | Auth is workable, but should become a cleaner module. |
| `src/server/config/env.ts` | Keep | Needed and now hardened. |
| `src/server/db/index.ts` | Rewrite | This is where the SQLite-first shape still leaks into everything. |
| `src/server/integrations/supabase.ts` | Keep | Canonical Supabase admin client and readiness helper. |
| `src/server/supabaseClient.ts` | Kill as a duplicate implementation | Now reduced to a re-export only. |
| `src/server/integrations/mailer.ts` | Keep | Good service boundary candidate. |
| `src/services/PayrollService.ts` | Keep | Business logic worth preserving and growing. |
| `src/services/adminService.ts` | Refactor lightly | Useful API layer, but should align with a cleaner module split. |
| `src/services/appService.ts` | Refactor lightly | Good candidate to split by domain rather than by whole app. |
| `src/services/fileService.ts` | Refactor lightly | Will need alignment with storage redesign. |
| `src/lib/api.ts` | Keep | Good place for scoped fetch helpers. |
| `src/lib/auth.ts` | Refactor lightly | Should align with app-level auth provider work later. |
| `src/server/utils/tenant.ts` | Keep | New central helper to reduce tenant-resolution duplication. |
| `.env.example` | Keep | Updated to remove insecure secret guidance. |
| `README.md` | Refactor later | Likely out of sync with the final target architecture. |
