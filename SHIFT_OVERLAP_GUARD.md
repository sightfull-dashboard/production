Implemented roster shift overlap guard.

What changed:
- Client users can no longer assign a shift when its start time overlaps the previous day's shift end time.
- Overlapping shift options are visually faded and labelled in the weekly roster dropdown.
- If a client still attempts the selection, a warning toast is shown and the selection is blocked.
- The API also enforces the same rule for non-superadmin users in both Supabase and SQLite modes.

Rule:
- Overnight shifts are supported. Example: a previous shift ending at 06:00 next day will block any next-day shift starting before 06:00.
- Administrative shifts like leave/absent/unshifted are excluded from the overlap rule.
- Super admins are not blocked by this rule.
