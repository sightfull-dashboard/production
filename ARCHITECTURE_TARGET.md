# Target architecture

## Backend

- thin entrypoint in `server.ts`
- environment and security bootstrap in `src/server/bootstrap/*`
- one Supabase client definition
- routes remain under `src/server/routes/*`
- next recommended extraction: auth, employees, leave, payroll, files, admin services

## Frontend

- entrypoint now starts through `src/app/AppShell.tsx`
- shell providers now exist for auth and active client state
- next recommended extraction: app layout shells and route-level module containers
