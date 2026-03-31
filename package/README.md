<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/fadc3ea2-ade4-406f-9ec7-22717b9880e0

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`


## Transitional foundation updates

This branch now supports environment-driven runtime configuration for the current local stack and exposes readiness endpoints for the upcoming Supabase + Nodemailer migration.

### New endpoints
- `GET /api/health`
- `GET /api/system/readiness`

### New environment variables
Copy `.env.example` to `.env` and fill in at least:
- `SESSION_SECRET`
- `DATABASE_PROVIDER`
- `SQLITE_PATH`

When you are ready to move infra:
- add Supabase credentials
- add SMTP credentials

### Install note
This pass adds `@supabase/supabase-js` and `nodemailer`, so run `npm install` before starting the app.


## Sightfull SMTP quick setup

Use your mailbox credentials in `.env`:

```env
SMTP_HOST=smtp.sightfull.co.za
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=dashboard@sightfull.co.za
SMTP_PASS=your-mailbox-password
SMTP_FROM_NAME=Sightfull Dashboard
SMTP_FROM_EMAIL=dashboard@sightfull.co.za
```

The app will continue working even if email sending fails; payroll submissions are saved first, then the email is attempted.
