import { createClient } from '@supabase/supabase-js';
import { env, isSupabaseConfigured } from '../config/env';

export const supabaseAdmin = isSupabaseConfigured
  ? createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

export const getSupabaseReadiness = () => ({
  configured: isSupabaseConfigured,
  urlPresent: Boolean(env.supabaseUrl),
  serviceRolePresent: Boolean(env.supabaseServiceRoleKey),
  anonKeyPresent: Boolean(env.supabaseAnonKey),
  storageBucket: env.supabaseStorageBucket,
});
