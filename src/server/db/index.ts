import Database from 'better-sqlite3';
import { env, isSupabaseConfigured, isSupabaseSelected, runtimeDatabaseShape } from '../config/env';

export type DatabaseMode = 'sqlite' | 'supabase';

export const databaseMode: DatabaseMode = isSupabaseSelected ? 'supabase' : 'sqlite';

export const db = new Database(env.sqlitePath);
export const runtimeStillUsesSqlite = true;

export const getDatabaseReadiness = () => ({
  provider: databaseMode,
  sqlitePath: env.sqlitePath,
  sqliteConnected: true,
  supabaseConfigured: isSupabaseConfigured,
  runtimeShape: runtimeDatabaseShape,
  runtimeStillUsesSqlite,
  status: isSupabaseSelected ? (isSupabaseConfigured ? 'hybrid-transition-ready' : 'misconfigured') : 'connected',
});
