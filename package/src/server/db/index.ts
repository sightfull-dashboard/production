import { env, isSupabaseConfigured } from '../config/env';

export type DatabaseMode = 'supabase';
export const databaseMode: DatabaseMode = 'supabase';
export const db: any = null;
export const runtimeStillUsesSqlite = false;

export const getDatabaseReadiness = () => ({
  provider: databaseMode,
  sqlitePath: null,
  sqliteConnected: false,
  supabaseConfigured: isSupabaseConfigured,
  runtimeShape: 'supabase-primary',
  runtimeStillUsesSqlite,
  status: isSupabaseConfigured ? 'supabase-ready' : 'misconfigured',
});
