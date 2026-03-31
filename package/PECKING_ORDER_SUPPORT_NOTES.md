This update adds two major pieces:

1. Internal access / pecking order foundation
- `staff` is now treated as an internal role alongside `superadmin`
- internal users can carry `permissions` and `assigned_clients`
- the internal shell and client-profile tabs now hide sections based on those permissions
- client lists and support tickets are filtered by assigned clients for staff users

2. Support ticket detail workflow
- each ticket can now open as a detail page in the UI
- internal staff and super admins can add internal comments
- comment tagging stores tagged user IDs
- tickets can be marked resolved from the list/detail page
- resolution metadata is stored on the ticket row

Supabase requirements for this update are in:
- `SUPABASE_INTERNAL_ACCESS_AND_SUPPORT.sql`

If you already ran the earlier concurrency / worker SQL and MFA SQL, you only need to run the new file once because it uses `IF NOT EXISTS` guards.
