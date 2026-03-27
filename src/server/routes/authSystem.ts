import bcrypt from 'bcryptjs';
import type { Express, Request } from 'express';

type Middleware = (req: any, res: any, next: any) => unknown;

type AuthSystemDeps = {
  app: Express;
  db: any;
  env: {
    nodeEnv: string;
    appUrl: string;
    smtpUser?: string | null;
    smtpFromEmail?: string | null;
  };
  isSupabaseConfigured: boolean;
  isSmtpConfigured: boolean;
  getDatabaseReadiness: () => any;
  getSupabaseReadiness: () => any;
  getMailerReadiness: () => any;
  getLastMailEvent: () => any;
  sendMailMessage: (payload: { to: string; subject: string; html: string; text: string }) => Promise<any>;
  setLastMailEvent: (payload: any) => void;
  logActivity: (req: Request, action: string, details?: any) => void;
  getSessionUser: (req: any) => any;
  safeJsonParse: <T>(value: string | null | undefined, fallback: T) => T;
  mergeDefinitions: (definitions?: string[] | null) => string[];
  allowedSuperAdminEmails: Set<string>;
  baseRosterDefinitions: readonly string[];
  getUserTrialState: (user: any) => any;
  getClientTrialState: (clientId: string) => any;
  requireAuth: Middleware;
  requireAuthOrLocalMailDebug: Middleware;
};

export function registerAuthSystemRoutes({
  app,
  db,
  env,
  isSupabaseConfigured,
  isSmtpConfigured,
  getDatabaseReadiness,
  getSupabaseReadiness,
  getMailerReadiness,
  getLastMailEvent,
  sendMailMessage,
  setLastMailEvent,
  logActivity,
  getSessionUser,
  safeJsonParse,
  mergeDefinitions,
  allowedSuperAdminEmails,
  baseRosterDefinitions,
  getUserTrialState,
  getClientTrialState,
  requireAuth,
  requireAuthOrLocalMailDebug,
}: AuthSystemDeps) {
  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      environment: env.nodeEnv,
      appUrl: env.appUrl,
      database: getDatabaseReadiness(),
      supabase: getSupabaseReadiness(),
      mailer: getMailerReadiness(),
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/api/system/readiness", (_req, res) => {
    res.json({
      database: getDatabaseReadiness(),
      integrations: {
        supabase: getSupabaseReadiness(),
        mailer: getMailerReadiness(),
      },
      recommendations: {
        shouldMigrateDatabase: !isSupabaseConfigured,
        shouldConfigureMailer: !isSmtpConfigured,
      },
    });
  });

  app.post("/api/auth/login", (req, res) => {
    const { email, password } = req.body;
    console.log(`Login attempt for: ${email}`);
    const user: any = db.prepare("SELECT * FROM users WHERE email = ?").get(email);

    if (user && bcrypt.compareSync(password, user.password)) {
      const normalizedLoginEmail = String(user.email || '').trim().toLowerCase();
      if (allowedSuperAdminEmails.has(normalizedLoginEmail) && user.role !== 'superadmin') {
        db.prepare("UPDATE users SET role = 'superadmin', is_verified = 1 WHERE id = ?").run(user.id);
        user.role = 'superadmin';
        user.is_verified = 1;
      }
      if (user.is_verified === 0) {
        console.warn(`Login denied: User ${email} is not verified`);
        return res.status(403).json({ error: "Account not verified yet." });
      }
      (req.session as any).userId = user.id;
      (req.session as any).userRole = user.role;

      req.session.save((err: any) => {
        if (err) {
          console.error("Session save error:", err);
          return res.status(500).json({ error: "Internal server error" });
        }
        console.log(`Login successful for: ${email} (Role: ${user.role})`);
        db.prepare("UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?").run(user.id);
        logActivity(req, 'LOGIN_SUCCESS', { email: user.email, role: user.role, client_id: user.client_id || null });
        const client: any = user.client_id ? db.prepare("SELECT name, enabled_definitions, locked_features, roster_start_day, roster_duration, roster_mode, roster_seed_week_start, fallback_image FROM clients WHERE id = ?").get(user.client_id) : null;
        const lockedFeatures = user.client_id ? safeJsonParse((client as any)?.locked_features, []) : [];
        const enabledDefinitions = user.client_id ? mergeDefinitions(safeJsonParse((client as any)?.enabled_definitions, [])) : [...baseRosterDefinitions];
        const userTrialState = getUserTrialState(user);
        const clientTrialState = user.client_id ? getClientTrialState(user.client_id) : { isTrial: false, trialStartedAt: null, trialEndDate: null, trialExpired: false, trialDaysRemaining: null };
        const trialState = user.role === 'superadmin' ? userTrialState : (clientTrialState.isTrial ? clientTrialState : userTrialState);
        const displayName = String(user.email || '').split('@')[0].replace(/[._-]+/g, ' ').trim().replace(/\b\w/g, (m) => m.toUpperCase()) || 'User';
        res.json({
          id: user.id,
          email: user.email,
          role: user.role,
          name: user.name || displayName,
          image: user.image || null,
          fallbackImage: client?.fallback_image || null,
          client_id: user.client_id || null,
          client_name: client?.name || null,
          lockedFeatures,
          enabledDefinitions,
          roster_start_day: client?.roster_start_day ?? 1,
          roster_duration: client?.roster_duration || '1_week',
          rosterMode: client?.roster_mode || 'Manual',
          rosterSeedWeekStart: client?.roster_seed_week_start || null,
          ...trialState,
        });
      });
    } else {
      console.warn(`Login failed: Invalid credentials for ${email}`);
      logActivity(req, 'LOGIN_FAILED', { email });
      res.status(401).json({ error: "Invalid credentials" });
    }
  });

  app.get("/api/auth/debug", (req, res) => {
    res.json({
      hasSession: !!req.session,
      userId: (req.session as any)?.userId,
      userRole: (req.session as any)?.userRole,
      cookie: req.session?.cookie,
    });
  });

  app.post("/api/auth/logout", (req, res) => {
    logActivity(req, 'LOGOUT');
    req.session.destroy(() => {
      res.json({ success: true });
    });
  });

  app.get("/api/auth/me", (req, res) => {
    const userId = (req.session as any).userId;
    if (userId) {
      const user: any = db.prepare("SELECT id, email, role, client_id, is_trial, trial_end_date, name, image FROM users WHERE id = ?").get(userId);
      if (user?.email && allowedSuperAdminEmails.has(String(user.email).trim().toLowerCase()) && user.role !== 'superadmin') {
        db.prepare("UPDATE users SET role = 'superadmin', is_verified = 1 WHERE id = ?").run(user.id);
        user.role = 'superadmin';
      }
      const client: any = user?.client_id ? db.prepare("SELECT name, enabled_definitions, locked_features, roster_start_day, roster_duration, roster_mode, roster_seed_week_start, fallback_image FROM clients WHERE id = ?").get(user.client_id) : null;
      const lockedFeatures = user?.client_id ? safeJsonParse((client as any)?.locked_features, []) : [];
      const enabledDefinitions = user?.client_id ? mergeDefinitions(safeJsonParse((client as any)?.enabled_definitions, [])) : [...baseRosterDefinitions];
      const userTrialState = getUserTrialState(user);
      const clientTrialState = user?.client_id ? getClientTrialState(user.client_id) : { isTrial: false, trialStartedAt: null, trialEndDate: null, trialExpired: false, trialDaysRemaining: null };
      const trialState = user?.role === 'superadmin' ? userTrialState : (clientTrialState.isTrial ? clientTrialState : userTrialState);
      const displayName = String(user.email || '').split('@')[0].replace(/[._-]+/g, ' ').trim().replace(/\b\w/g, (m) => m.toUpperCase()) || 'User';
      res.json({
        ...user,
        name: user.name || displayName,
        image: user.image || null,
        fallbackImage: client?.fallback_image || null,
        client_name: client?.name || null,
        lockedFeatures,
        enabledDefinitions,
        roster_start_day: client?.roster_start_day ?? 1,
        roster_duration: client?.roster_duration || '1_week',
        rosterMode: client?.roster_mode || 'Manual',
        rosterSeedWeekStart: client?.roster_seed_week_start || null,
        ...trialState,
      });
    } else {
      res.status(401).json({ error: "Not authenticated" });
    }
  });

  app.post('/api/system/test-email', requireAuthOrLocalMailDebug, async (req, res) => {
    try {
      const requestedTo = String(req.body?.to || '').trim();
      const to = requestedTo || env.smtpUser || env.smtpFromEmail;
      if (!to) {
        return res.status(400).json({ error: 'No destination email provided' });
      }

      const info = await sendMailMessage({
        to,
        subject: 'Sightfull test email',
        html: '<p>This is a test email from Sightfull Dashboard.</p>',
        text: 'This is a test email from Sightfull Dashboard.',
      });

      setLastMailEvent({
        at: new Date().toISOString(),
        kind: 'test',
        ok: true,
        to,
        subject: 'Sightfull test email',
        messageId: info.messageId,
        accepted: Array.isArray(info.accepted) ? info.accepted.map(String) : [],
        rejected: Array.isArray(info.rejected) ? info.rejected.map(String) : [],
        response: info.response,
      });

      console.log('[MAIL TEST] Sent successfully', {
        to,
        messageId: info.messageId,
        accepted: info.accepted,
        rejected: info.rejected,
        response: info.response,
      });

      return res.json({
        ok: true,
        to,
        messageId: info.messageId,
        accepted: info.accepted,
        rejected: info.rejected,
        response: info.response,
      });
    } catch (error: any) {
      setLastMailEvent({
        at: new Date().toISOString(),
        kind: 'test',
        ok: false,
        to: String(req.body?.to || '').trim() || env.smtpUser || env.smtpFromEmail,
        subject: 'Sightfull test email',
        error: error?.message || 'Failed to send test email',
      });
      console.error('[MAIL TEST] Failed', error);
      return res.status(500).json({ error: error?.message || 'Failed to send test email' });
    }
  });

  app.get('/api/system/test-email', requireAuthOrLocalMailDebug, async (req, res) => {
    try {
      const requestedTo = String(req.query?.to || '').trim();
      const to = requestedTo || env.smtpUser || env.smtpFromEmail;
      if (!to) {
        return res.status(400).json({ error: 'No destination email provided' });
      }

      const info = await sendMailMessage({
        to,
        subject: 'Sightfull test email',
        html: '<p>This is a test email from Sightfull Dashboard.</p>',
        text: 'This is a test email from Sightfull Dashboard.',
      });

      setLastMailEvent({
        at: new Date().toISOString(),
        kind: 'test',
        ok: true,
        to,
        subject: 'Sightfull test email',
        messageId: info.messageId,
        accepted: Array.isArray(info.accepted) ? info.accepted.map(String) : [],
        rejected: Array.isArray(info.rejected) ? info.rejected.map(String) : [],
        response: info.response,
      });

      console.log('[MAIL TEST][GET] Sent successfully', {
        to,
        messageId: info.messageId,
        accepted: info.accepted,
        rejected: info.rejected,
        response: info.response,
      });

      return res.json({
        ok: true,
        to,
        messageId: info.messageId,
        accepted: info.accepted,
        rejected: info.rejected,
        response: info.response,
      });
    } catch (error: any) {
      setLastMailEvent({
        at: new Date().toISOString(),
        kind: 'test',
        ok: false,
        to: String(req.query?.to || '').trim() || env.smtpUser || env.smtpFromEmail,
        subject: 'Sightfull test email',
        error: error?.message || 'Failed to send test email',
      });
      console.error('[MAIL TEST][GET] Failed', error);
      return res.status(500).json({ error: error?.message || 'Failed to send test email' });
    }
  });

  app.get('/api/system/mail-status', requireAuthOrLocalMailDebug, (_req, res) => {
    return res.json({
      readiness: getMailerReadiness(),
      lastEvent: getLastMailEvent(),
    });
  });

  app.post("/api/client/roster-preferences", requireAuth, (req, res) => {
    const user = getSessionUser(req);
    if (!user?.client_id) return res.status(400).json({ error: 'No client context' });

    const existing = db.prepare("SELECT roster_mode, roster_seed_week_start FROM clients WHERE id = ?").get(user.client_id) as any;
    if (!existing) return res.status(404).json({ error: 'Client not found' });

    const nextMode = String(req.body.rosterMode || existing.roster_mode || 'Manual');
    const nextSeed = req.body.rosterSeedWeekStart ?? existing.roster_seed_week_start ?? null;
    db.prepare("UPDATE clients SET roster_mode = ?, roster_seed_week_start = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(nextMode, nextSeed, user.client_id);
    const row = db.prepare("SELECT roster_mode, roster_seed_week_start FROM clients WHERE id = ?").get(user.client_id) as any;
    res.json({ rosterMode: row?.roster_mode || 'Manual', rosterSeedWeekStart: row?.roster_seed_week_start || null });
  });
}
