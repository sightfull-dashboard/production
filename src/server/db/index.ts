import Database from 'better-sqlite3';
import { env } from '../config/env';

export type DatabaseMode = 'sqlite' | 'supabase';

export const databaseMode: DatabaseMode = env.databaseProvider === 'supabase' ? 'supabase' : 'sqlite';

export const db = new Database(env.sqlitePath);

export const getDatabaseReadiness = () => ({
  provider: databaseMode,
  sqlitePath: env.sqlitePath,
  status: 'connected',
});
