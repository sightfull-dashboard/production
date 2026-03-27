import { env, isSupabaseConfigured, isSupabaseSelected } from '../config/env';

export type DatabaseMode = 'sqlite' | 'supabase';
export const databaseMode: DatabaseMode = isSupabaseSelected ? 'supabase' : 'sqlite';

let sqliteDb: any = null;
if (!isSupabaseSelected) {
  const BetterSqlite3 = (await import('better-sqlite3')).default;
  sqliteDb = new BetterSqlite3(env.sqlitePath);
}

export const db = sqliteDb;
export const runtimeStillUsesSqlite = !isSupabaseSelected;

export const getDatabaseReadiness = () => ({
  provider: databaseMode,
  sqlitePath: env.sqlitePath,
  sqliteConnected: !isSupabaseSelected,
  supabaseConfigured: isSupabaseConfigured,
  runtimeShape: isSupabaseSelected ? 'supabase-primary' : 'sqlite-primary',
  runtimeStillUsesSqlite,
  status: isSupabaseSelected ? (isSupabaseConfigured ? 'supabase-ready' : 'misconfigured') : 'connected',
});
