import { Express } from 'express';
import speakeasy from 'speakeasy';
import qrcode from 'qrcode';
import { env } from '../config/env';
import { supabaseAdmin } from '../integrations/supabase';

export function registerMfaRoutes({
  app,
  db,
  requireMfaPending,
  logActivity,
}: {
  app: Express;
  db: any;
  requireMfaPending: any;
  logActivity: any;
}) {
  app.post('/api/mfa/setup', requireMfaPending, async (req, res) => {
    const userId = (req.session as any).userId;
    try {
      const secret = speakeasy.generateSecret({ name: `App (${userId})` });
      const qrCodeUrl = await qrcode.toDataURL(secret.otpauth_url!);

      // Save secret temporarily in session and persist it before responding.
      (req.session as any).mfaSecret = secret.base32;

      req.session.save((err: any) => {
        if (err) {
          console.error('MFA setup session save error:', err);
          return res.status(500).json({ error: 'Failed to initialize MFA setup' });
        }

        res.json({
          secret: secret.base32,
          qrCodeUrl,
        });
      });
    } catch (error) {
      console.error('MFA setup error:', error);
      res.status(500).json({ error: 'Failed to generate MFA setup' });
    }
  });

  app.post('/api/mfa/verify-setup', requireMfaPending, async (req, res) => {
    const userId = (req.session as any).userId;
    const { token } = req.body;
    const secret = (req.session as any).mfaSecret;

    if (!secret) {
      return res.status(400).json({ error: 'MFA setup not initiated' });
    }

    const verified = speakeasy.totp.verify({
      secret,
      encoding: 'base32',
      token,
    });

    if (verified) {
      try {
        if (env.databaseProvider === 'supabase') {
          await supabaseAdmin.from('users').update({
            mfa_enabled: true,
            mfa_secret: secret,
          }).eq('id', userId);
        } else {
          db.prepare("UPDATE users SET mfa_enabled = 1, mfa_secret = ? WHERE id = ?").run(secret, userId);
        }

        delete (req.session as any).mfaSecret;
        delete (req.session as any).mfaPending;

        req.session.save((err: any) => {
          if (err) {
            console.error("Session save error:", err);
            return res.status(500).json({ error: "Internal server error" });
          }
          logActivity(req, 'MFA_SETUP_SUCCESS', { userId });
          res.json({ success: true });
        });
      } catch (error) {
        console.error('MFA save error:', error);
        res.status(500).json({ error: 'Failed to save MFA settings' });
      }
    } else {
      res.status(400).json({ error: 'Invalid token' });
    }
  });

  app.post('/api/mfa/disable', async (req, res) => {
    const userId = (req.session as any).userId;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    try {
      let user;
      if (env.databaseProvider === 'supabase') {
        const { data } = await supabaseAdmin.from('users').select('mfa_required').eq('id', userId).single();
        user = data;
      } else {
        user = db.prepare("SELECT mfa_required FROM users WHERE id = ?").get(userId);
      }

      if (user?.mfa_required) {
        return res.status(400).json({ error: '2FA is required by administrator and cannot be disabled.' });
      }

      if (env.databaseProvider === 'supabase') {
        await supabaseAdmin.from('users').update({
          mfa_enabled: false,
          mfa_secret: null
        }).eq('id', userId);
      } else {
        db.prepare("UPDATE users SET mfa_enabled = 0, mfa_secret = NULL WHERE id = ?").run(userId);
      }

      logActivity(req, 'MFA_DISABLED', { userId });
      res.json({ success: true });
    } catch (error) {
      console.error('MFA disable error:', error);
      res.status(500).json({ error: 'Failed to disable MFA' });
    }
  });

  app.post('/api/mfa/verify', requireMfaPending, async (req, res) => {
    const userId = (req.session as any).userId;
    const { token } = req.body;

    try {
      let user;
      if (env.databaseProvider === 'supabase') {
        const { data } = await supabaseAdmin.from('users').select('mfa_secret, mfa_enabled').eq('id', userId).single();
        user = data;
      } else {
        user = db.prepare("SELECT mfa_secret, mfa_enabled FROM users WHERE id = ?").get(userId);
      }

      if (!user || !user.mfa_enabled || !user.mfa_secret) {
        return res.status(400).json({ error: 'MFA not enabled for this user' });
      }

      const verified = speakeasy.totp.verify({
        secret: user.mfa_secret,
        encoding: 'base32',
        token,
      });

      if (verified) {
        delete (req.session as any).mfaPending;
        req.session.save((err: any) => {
          if (err) {
            console.error("Session save error:", err);
            return res.status(500).json({ error: "Internal server error" });
          }
          logActivity(req, 'MFA_VERIFY_SUCCESS', { userId });
          res.json({ success: true });
        });
      } else {
        logActivity(req, 'MFA_VERIFY_FAILED', { userId });
        res.status(400).json({ error: 'Invalid token' });
      }
    } catch (error) {
      console.error('MFA verify error:', error);
      res.status(500).json({ error: 'Failed to verify MFA' });
    }
  });
}
