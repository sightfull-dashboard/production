Background worker added.

What it does now
- adds a durable background_jobs queue
- adds a separate worker process entrypoint: `npm run worker`
- moves payroll submission email generation/sending off the request thread when `PAYROLL_EMAIL_ASYNC=true`
- adds super-admin API inspection endpoints:
  - `GET /api/background-jobs`
  - `GET /api/background-jobs/:id`

Recommended production setup
- keep the web app and worker as separate processes
- run `BACKGROUND_WORKER_TABLES.sql` in Supabase before enabling the worker in Supabase mode
- set `PAYROLL_EMAIL_ASYNC=true`
- run:
  - web: `npm run dev` or your production server command
  - worker: `npm run worker`

Notes
- UI was left unchanged
- payroll submissions now return `mail.queued=true` and `mail.jobId` when async mode is enabled
- folder ZIP generation is still in-process; the worker foundation is now in place to offload that next
