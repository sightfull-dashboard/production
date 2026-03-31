import { createClient } from '@supabase/supabase-js';
import { env, isSupabaseConfigured } from '../config/env';

export const supabaseAdmin = isSupabaseConfigured
  ? createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

export const createRequestSupabaseClient = (accessToken?: string | null) => {
  if (!isSupabaseConfigured || !env.supabaseAnonKey) {
    throw new Error('Supabase anon key is not configured.');
  }

  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: accessToken
      ? { headers: { Authorization: `Bearer ${accessToken}` } }
      : undefined,
  });
};

export const getSupabaseReadiness = () => ({
  configured: isSupabaseConfigured,
  urlPresent: Boolean(env.supabaseUrl),
  serviceRolePresent: Boolean(env.supabaseServiceRoleKey),
  anonKeyPresent: Boolean(env.supabaseAnonKey),
  storageBucket: env.supabaseStorageBucket,
});
