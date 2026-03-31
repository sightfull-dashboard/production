Supabase route patch pass

What was patched in this pass:
- fixed remaining admin/files routes that were still calling SQLite `db.prepare(...)` in Supabase mode
- patched super admin client list to count users/employees/files from Supabase instead of SQLite
- patched payroll submissions list to load the acting user from Supabase in Supabase mode
- patched support tickets list to load the acting user and effective client scope without SQLite in Supabase mode
- patched payroll submission creation to:
  - resolve user/client from Supabase in Supabase mode
  - validate missing roster assignments from Supabase in Supabase mode
  - build payroll email attachments from Supabase tables in Supabase mode
- patched file download lookup to resolve the file row from Supabase in Supabase mode
- patched admin super-panel user routes to use Supabase in Supabase mode:
  - list users
  - create user
  - verify user
  - update user
  - delete user
- patched admin client user routes to use Supabase in Supabase mode:
  - list client users
  - create client user
  - update client user
  - delete client user
- patched admin activity logs and client activity logs to read from Supabase in Supabase mode
- patched admin client delete to delete from Supabase tables in Supabase mode

Important:
- this was syntax-checked with TypeScript transpilation for the changed route files
- this was not fully runtime-tested against a live Supabase project from inside the container
- some legacy SQLite fallback code still remains intentionally for non-Supabase mode
