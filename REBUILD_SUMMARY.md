# Sightfull rebuild summary

This package contains a stabilization rebuild of the uploaded application.

## Completed in this rebuild

- tightened environment handling so production requires `SESSION_SECRET`
- removed duplicate Supabase client definitions
- fixed the `roster_meta.staff_loan` migration duplication bug
- removed default employee PIN fallback from employee login
- removed schema defaults that silently assigned `1234` as a PIN
- added an application shell layer for future provider-driven frontend refactors
- documented the target architecture and environment expectations

## Important note

The repo still depends on `better-sqlite3`, which could not be compiled in this offline container. Because of that, I could not run a full local build here after the code changes. The source has been updated, packaged, and prepared for your environment, but you should run `npm install` and `npm run dev` or `npm run build` on a machine with internet access or with an existing compatible `node_modules` cache.
