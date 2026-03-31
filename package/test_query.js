import Database from 'better-sqlite3';

const db = new Database('database.sqlite');

try {
  const rows = db.prepare(`
    SELECT c.*, 
      (SELECT COUNT(*) FROM users u WHERE u.client_id = c.id) as users,
      (SELECT COUNT(*) FROM employees e WHERE e.client_id = c.id AND COALESCE(e.status, 'active') != 'offboarded') as employees,
      (SELECT COUNT(*) FROM files f WHERE f.client_id = c.id) as files,
      (SELECT COALESCE(MAX(created_at), c.updated_at) FROM activity_logs al WHERE al.client_id = c.id) as last_activity,
      (SELECT COUNT(*) FROM roster r JOIN employees e ON e.id = r.employee_id WHERE e.client_id = c.id AND r.day_date BETWEEN '2026-03-23' AND '2026-03-29') as shiftsThisWeek,
      (
        SELECT COALESCE(SUM(
          CASE
            WHEN s.start IS NOT NULL AND s.end IS NOT NULL THEN
              MAX(((CAST(substr(s.end,1,2) AS INTEGER) * 60 + CAST(substr(s.end,4,2) AS INTEGER)) -
                   (CAST(substr(s.start,1,2) AS INTEGER) * 60 + CAST(substr(s.start,4,2) AS INTEGER)) -
                   COALESCE(s.lunch, 0)) / 60.0, 0)
            ELSE 0
          END
        ), 0)
        FROM roster r
        JOIN employees e ON e.id = r.employee_id
        LEFT JOIN shifts s ON s.id = r.shift_id
        WHERE e.client_id = c.id AND r.day_date BETWEEN '2026-03-23' AND '2026-03-29'
      ) as totalHours
    FROM clients c
    ORDER BY datetime(c.created_at) DESC
  `).all();
  console.log('Success:', rows.length);
} catch (err) {
  console.error('Error:', err);
}
