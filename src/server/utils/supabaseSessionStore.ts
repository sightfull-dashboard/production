import session from 'express-session';
import { supabaseAdmin } from '../integrations/supabase';

const pruneEvery = 50;

export async function createSupabaseSessionStore() {
  if (!supabaseAdmin) {
    throw new Error('Supabase session store requires Supabase to be configured.');
  }

  let operationCount = 0;

  class SupabaseSessionStore extends session.Store {
    private async pruneExpired() {
      operationCount += 1;
      if (operationCount % pruneEvery !== 0) return;
      const { error } = await supabaseAdmin
        .from('app_sessions')
        .delete()
        .lte('expires_at', new Date().toISOString());
      if (error) {
        console.warn('[SESSION] Supabase session prune failed:', error.message);
      }
    }

    override get(sid: string, callback: (err?: any, session?: session.SessionData | null) => void) {
      (async () => {
        try {
          await this.pruneExpired();
          const { data, error } = await supabaseAdmin
            .from('app_sessions')
            .select('sess, expires_at')
            .eq('sid', sid)
            .maybeSingle();
          if (error) throw error;
          if (!data) return callback(undefined, null);

          const expiresAtMs = data.expires_at ? new Date(data.expires_at).getTime() : 0;
          if (expiresAtMs && expiresAtMs <= Date.now()) {
            await supabaseAdmin.from('app_sessions').delete().eq('sid', sid);
            return callback(undefined, null);
          }

          return callback(undefined, JSON.parse(String(data.sess || '{}')));
        } catch (error) {
          return callback(error);
        }
      })();
    }

    override set(sid: string, sess: session.SessionData, callback?: (err?: any) => void) {
      (async () => {
        try {
          const now = Date.now();
          const expiresAt = sess.cookie?.expires
            ? new Date(sess.cookie.expires).getTime()
            : now + Number(sess.cookie?.maxAge || 24 * 60 * 60 * 1000);
          const nowIso = new Date(now).toISOString();
          const { error } = await supabaseAdmin
            .from('app_sessions')
            .upsert({
              sid,
              sess: JSON.stringify(sess),
              expires_at: new Date(expiresAt).toISOString(),
              created_at: nowIso,
              updated_at: nowIso,
            }, { onConflict: 'sid' });
          if (error) throw error;
          callback?.();
        } catch (error) {
          callback?.(error);
        }
      })();
    }

    override destroy(sid: string, callback?: (err?: any) => void) {
      (async () => {
        try {
          const { error } = await supabaseAdmin.from('app_sessions').delete().eq('sid', sid);
          if (error) throw error;
          callback?.();
        } catch (error) {
          callback?.(error);
        }
      })();
    }

    override touch(sid: string, sess: session.SessionData, callback?: () => void) {
      (async () => {
        try {
          const now = Date.now();
          const expiresAt = sess.cookie?.expires
            ? new Date(sess.cookie.expires).getTime()
            : now + Number(sess.cookie?.maxAge || 24 * 60 * 60 * 1000);
          const { error } = await supabaseAdmin
            .from('app_sessions')
            .update({
              sess: JSON.stringify(sess),
              expires_at: new Date(expiresAt).toISOString(),
              updated_at: new Date(now).toISOString(),
            })
            .eq('sid', sid);
          if (error) throw error;
          callback?.();
        } catch {
          callback?.();
        }
      })();
    }
  }

  return new SupabaseSessionStore();
}
