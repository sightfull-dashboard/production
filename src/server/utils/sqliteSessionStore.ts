import session from 'express-session';

export async function createSqliteSessionStore(sqlitePath: string) {
  const BetterSqlite3 = (await import('better-sqlite3')).default;
  const sqlite = new BetterSqlite3(sqlitePath);
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS app_sessions (
      sid TEXT PRIMARY KEY,
      sess TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_app_sessions_expires_at ON app_sessions(expires_at);
  `);

  class SqliteSessionStore extends session.Store {
    private pruneExpired() {
      sqlite.prepare('DELETE FROM app_sessions WHERE expires_at <= ?').run(Date.now());
    }

    override get(sid: string, callback: (err?: any, session?: session.SessionData | null) => void) {
      try {
        this.pruneExpired();
        const row = sqlite.prepare('SELECT sess FROM app_sessions WHERE sid = ? LIMIT 1').get(sid) as { sess: string } | undefined;
        callback(undefined, row ? JSON.parse(row.sess) : null);
      } catch (error) {
        callback(error);
      }
    }

    override set(sid: string, sess: session.SessionData, callback?: (err?: any) => void) {
      try {
        const now = Date.now();
        const expiresAt = sess.cookie?.expires
          ? new Date(sess.cookie.expires).getTime()
          : now + (sess.cookie?.maxAge || 24 * 60 * 60 * 1000);
        sqlite.prepare(`
          INSERT INTO app_sessions (sid, sess, expires_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(sid) DO UPDATE SET
            sess = excluded.sess,
            expires_at = excluded.expires_at,
            updated_at = excluded.updated_at
        `).run(sid, JSON.stringify(sess), expiresAt, now, now);
        callback?.();
      } catch (error) {
        callback?.(error);
      }
    }

    override destroy(sid: string, callback?: (err?: any) => void) {
      try {
        sqlite.prepare('DELETE FROM app_sessions WHERE sid = ?').run(sid);
        callback?.();
      } catch (error) {
        callback?.(error);
      }
    }

    override touch(sid: string, sess: session.SessionData, callback?: () => void) {
      const now = Date.now();
      const expiresAt = sess.cookie?.expires
        ? new Date(sess.cookie.expires).getTime()
        : now + (sess.cookie?.maxAge || 24 * 60 * 60 * 1000);
      sqlite.prepare('UPDATE app_sessions SET expires_at = ?, updated_at = ? WHERE sid = ?').run(expiresAt, now, sid);
      callback?.();
    }
  }

  return new SqliteSessionStore();
}
