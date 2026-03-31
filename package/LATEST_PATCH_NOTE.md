Latest patch set:
- Added a Supabase-mode /api/analytics endpoint so analytics no longer falls through to HTML.
- Normalized optional employee fields before Supabase insert/update so blank nullable dates become null instead of ''.
- Removed the Account Holder field from the employee form UI.
- Relaxed banking validation so bank details require bank name + account number + account type only.
- Removed brittle browser pattern attributes from address inputs.
- Sanity-checked changed TypeScript files with transpilation parsing.
