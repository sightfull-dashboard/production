import { supabaseAdmin } from '../integrations/supabase';
import { env } from '../config/env';
import bcrypt from 'bcryptjs';
import type { Express, Request } from 'express';
import { deleteStoredObjectIfPresent, uploadBase64FileToSupabaseStorage } from '../utils/storage';

type Middleware = (req: any, res: any, next: any) => unknown;

type RegisterAdminRoutesDeps = {
  app: Express;
  db: any;
  isSuperAdmin: Middleware;
  logActivity: (req: Request, action: string, details?: any) => void;
  ensureClientVaultStructure: (clientId: string) => void;
  hydrateFileRow: (row: any) => any;
  serializePayrollSubmission: (row: any) => any;
  normalizeClientTrialColumns: (input: any) => any;
  mergeDefinitions: (definitions?: string[] | null) => string[];
  safeJsonParse: <T>(value: string | null | undefined, fallback: T) => T;
  getWeekBounds: () => { start: string; end: string };
  serializeAdminClient: (row: any) => any;
};

const mapAdminUserRow = (row: any) => ({
  id: row.id,
  name: row.name || row.email?.split('@')[0] || 'User',
  email: row.email,
  role: row.role,
  is_verified: !!row.is_verified,
  client_id: row.client_id ?? null,
  lastLogin: row.last_login || 'Never',
  image: row.image || null,
});

const parseJsonArray = (value: any) => Array.isArray(value) ? value : (() => {
  try { return value ? JSON.parse(value) : []; } catch { return []; }
})();

const serializeSupabaseClient = (row: any, extras?: { users?: number; employees?: number; files?: number }) => ({
  id: row.id,
  name: row.name,
  status: row.status,
  users: Number(extras?.users) || 0,
  files: Number(extras?.files) || 0,
  lastActive: row.updated_at || row.created_at,
  dashboardType: row.dashboard_type || 'rostering',
  lockedFeatures: parseJsonArray(row.locked_features),
  enabledDefinitions: parseJsonArray(row.enabled_definitions),
  rosterStartDay: row.roster_start_day ?? 1,
  rosterDuration: row.roster_duration || '1_week',
  rosterMode: row.roster_mode || 'Manual',
  rosterSeedWeekStart: row.roster_seed_week_start || null,
  isTrial: !!row.is_trial,
  trialDuration: row.trial_duration || 7,
  payrollEmail: row.payroll_email || '',
  payrollCc: row.payroll_cc || '',
  payrollSubmissionDay: row.payroll_submission_day || 1,
  fallbackImage: row.fallback_image || null,
  created_at: row.created_at,
  data: {
    employees: Number(extras?.employees) || 0,
    shiftsThisWeek: 0,
    totalHours: 0,
  },
});


const fetchSupabaseUserById = async (id: string | null | undefined) => {
  if (!id) return null;
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as any;
};

const fetchSupabaseClientById = async (id: string | null | undefined) => {
  if (!id) return null;
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('id, name')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as any;
};

const countSupabaseRows = async (table: string, column: string, value: string) => {
  const { count, error } = await supabaseAdmin
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq(column, value);
  if (error) throw error;
  return Number(count) || 0;
};

const countSupabaseEmployees = async (clientId: string) => {
  const { data, error } = await supabaseAdmin
    .from('employees')
    .select('status')
    .eq('client_id', clientId);
  if (error) throw error;
  return (data || []).filter((row: any) => String(row.status || 'active').toLowerCase() !== 'offboarded').length;
};


export function registerAdminRoutes({
  app,
  db,
  isSuperAdmin,
  logActivity,
  ensureClientVaultStructure,
  hydrateFileRow,
  serializePayrollSubmission,
  normalizeClientTrialColumns,
  mergeDefinitions,
  safeJsonParse,
  getWeekBounds,
  serializeAdminClient,
}: RegisterAdminRoutesDeps) {
  app.get("/api/admin/users", isSuperAdmin, async (_req, res) => {
    if (env.databaseProvider !== 'supabase') {
      const users = db.prepare("SELECT id, email, role, is_verified, client_id, name, image, last_login FROM users WHERE client_id IS NULL ORDER BY email ASC").all() as any[];
      return res.json(users.map(mapAdminUserRow));
    }

    try {
      const { data, error } = await supabaseAdmin
        .from('users')
        .select('id, email, role, is_verified, client_id, name, image, last_login')
        .is('client_id', null)
        .order('email', { ascending: true });
      if (error) throw error;
      return res.json((data || []).map(mapAdminUserRow));
    } catch (error) {
      console.error('Failed to load admin users:', error);
      return res.status(500).json({ error: 'Failed to load admin users' });
    }
  });

  app.get("/api/admin/logs", isSuperAdmin, async (_req, res) => {
    if (env.databaseProvider !== 'supabase') {
      const logs = db.prepare(`
        SELECT al.*
        FROM activity_logs al
        INNER JOIN users u ON u.id = al.user_id
        WHERE u.role = 'superadmin' AND u.client_id IS NULL
        ORDER BY al.created_at DESC
        LIMIT 500
      `).all();
      return res.json(logs);
    }

    try {
      const { data: users, error: usersError } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('role', 'superadmin')
        .is('client_id', null);
      if (usersError) throw usersError;
      const userIds = (users || []).map((row: any) => row.id).filter(Boolean);
      if (userIds.length === 0) return res.json([]);
      const { data, error } = await supabaseAdmin
        .from('activity_logs')
        .select('*')
        .in('user_id', userIds)
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      return res.json(data || []);
    } catch (error) {
      console.error('Failed to load admin logs:', error);
      return res.status(500).json({ error: 'Failed to load admin logs' });
    }
  });

  app.get("/api/admin/clients/:id/users", isSuperAdmin, async (req, res) => {
    if (env.databaseProvider !== 'supabase') {
      const rows = db.prepare("SELECT id, email, role, is_verified, client_id, name, image, last_login FROM users WHERE client_id = ? ORDER BY email ASC").all(req.params.id) as any[];
      return res.json(rows.map(mapAdminUserRow));
    }

    try {
      const { data, error } = await supabaseAdmin
        .from('users')
        .select('id, email, role, is_verified, client_id, name, image, last_login')
        .eq('client_id', req.params.id)
        .order('email', { ascending: true });
      if (error) throw error;
      return res.json((data || []).map(mapAdminUserRow));
    } catch (error) {
      console.error('Failed to load client users:', error);
      return res.status(500).json({ error: 'Failed to load client users' });
    }
  });

  app.post("/api/admin/clients/:id/users", isSuperAdmin, async (req, res) => {
    const { email, password, role, name, image } = req.body || {};
    if (!email || !password || !role) return res.status(400).json({ error: 'Email, password and role are required' });

    try {
      const id = Math.random().toString(36).substr(2, 9);
      if (env.databaseProvider !== 'supabase') {
        db.prepare("INSERT INTO users (id, email, password, role, is_verified, client_id, name, image, last_login) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .run(id, email, bcrypt.hashSync(password, 10), role, 1, req.params.id, name || null, image || null, null);

        logActivity(req, 'CREATE_CLIENT_USER', { clientId: req.params.id, userId: id, email, role });
        const row = db.prepare("SELECT id, email, role, is_verified, client_id, name, image, last_login FROM users WHERE id = ?").get(id) as any;
        return res.status(201).json(mapAdminUserRow(row));
      }

      const { data, error } = await supabaseAdmin
        .from('users')
        .insert({ id, email, password: bcrypt.hashSync(password, 10), role, is_verified: true, client_id: req.params.id, name: name || null, image: image || null, last_login: null })
        .select('id, email, role, is_verified, client_id, name, image, last_login')
        .single();
      if (error) {
        if (String(error.message || '').toLowerCase().includes('duplicate')) return res.status(400).json({ error: 'User already exists' });
        throw error;
      }
      logActivity(req, 'CREATE_CLIENT_USER', { clientId: req.params.id, userId: id, email, role });
      return res.status(201).json(mapAdminUserRow(data));
    } catch (error: any) {
      if (error.message?.includes('UNIQUE constraint failed')) return res.status(400).json({ error: 'User already exists' });
      console.error('Create client user error:', error);
      res.status(500).json({ error: 'Failed to create user' });
    }
  });

  app.patch("/api/admin/clients/:clientId/users/:userId", isSuperAdmin, async (req, res) => {
    const existing = env.databaseProvider !== 'supabase'
      ? db.prepare("SELECT * FROM users WHERE id = ? AND client_id = ?").get(req.params.userId, req.params.clientId) as any
      : await fetchSupabaseUserById(req.params.userId);
    if (!existing || existing.client_id !== req.params.clientId) return res.status(404).json({ error: 'User not found' });

    const nextEmail = req.body.email ?? existing.email;
    const nextRole = req.body.role ?? existing.role;
    const nextName = req.body.name ?? existing.name;
    const nextImage = req.body.image ?? existing.image ?? null;
    const nextPassword = req.body.password ? bcrypt.hashSync(req.body.password, 10) : existing.password;
    const nextVerified = typeof req.body.is_verified === 'undefined' ? existing.is_verified : !!req.body.is_verified;

    try {
      if (env.databaseProvider !== 'supabase') {
        db.prepare("UPDATE users SET email = ?, password = ?, role = ?, name = ?, image = ?, is_verified = ? WHERE id = ?")
          .run(nextEmail, nextPassword, nextRole, nextName, nextImage, nextVerified ? 1 : 0, req.params.userId);
        logActivity(req, 'UPDATE_CLIENT_USER', { clientId: req.params.clientId, userId: req.params.userId, email: nextEmail, role: nextRole });
        const row = db.prepare("SELECT id, email, role, is_verified, client_id, name, image, last_login FROM users WHERE id = ?").get(req.params.userId) as any;
        return res.json(mapAdminUserRow(row));
      }

      const { data, error } = await supabaseAdmin
        .from('users')
        .update({ email: nextEmail, password: nextPassword, role: nextRole, name: nextName, image: nextImage, is_verified: nextVerified })
        .eq('id', req.params.userId)
        .eq('client_id', req.params.clientId)
        .select('id, email, role, is_verified, client_id, name, image, last_login')
        .single();
      if (error) {
        if (String(error.message || '').toLowerCase().includes('duplicate')) return res.status(400).json({ error: 'Email already exists' });
        throw error;
      }
      logActivity(req, 'UPDATE_CLIENT_USER', { clientId: req.params.clientId, userId: req.params.userId, email: nextEmail, role: nextRole });
      return res.json(mapAdminUserRow(data));
    } catch (error: any) {
      if (error.message?.includes('UNIQUE constraint failed')) return res.status(400).json({ error: 'Email already exists' });
      console.error('Update client user error:', error);
      res.status(500).json({ error: 'Failed to update user' });
    }
  });

  app.delete("/api/admin/clients/:clientId/users/:userId", isSuperAdmin, async (req, res) => {
    if (env.databaseProvider !== 'supabase') {
      const result = db.prepare("DELETE FROM users WHERE id = ? AND client_id = ?").run(req.params.userId, req.params.clientId);
      if (!result.changes) return res.status(404).json({ error: 'User not found' });
      logActivity(req, 'DELETE_CLIENT_USER', { clientId: req.params.clientId, userId: req.params.userId });
      return res.json({ success: true });
    }

    const { data, error } = await supabaseAdmin.from('users').delete().eq('id', req.params.userId).eq('client_id', req.params.clientId).select('id').single();
    if (error || !data) return res.status(404).json({ error: 'User not found' });
    logActivity(req, 'DELETE_CLIENT_USER', { clientId: req.params.clientId, userId: req.params.userId });
    return res.json({ success: true });
  });

  app.get("/api/admin/clients/:id/files", isSuperAdmin, async (req, res) => {
    try {
      if (env.databaseProvider !== 'supabase') {
        ensureClientVaultStructure(req.params.id);
        const rows = db.prepare("SELECT * FROM files WHERE client_id = ? ORDER BY type DESC, name ASC").all(req.params.id);
        return res.json(rows.map(hydrateFileRow));
      }
      const { data, error } = await supabaseAdmin.from('files').select('*').eq('client_id', req.params.id).order('type', { ascending: false }).order('name', { ascending: true });
      if (error) throw error;
      return res.json((data || []).map((row) => hydrateFileRow({
        ...row,
        size: row.size_bytes,
        extension: row.mime_type,
        url: row.public_url || row.storage_path || null,
      })));
    } catch (error) {
      console.error('Failed to load client files:', error);
      return res.status(500).json({ error: 'Failed to load client files' });
    }
  });

  app.post("/api/admin/clients/:id/files", isSuperAdmin, async (req, res) => {
    const { name, type, parent_id, size, extension, url, password } = req.body || {};
    if (!name || !['file', 'folder'].includes(type)) return res.status(400).json({ error: 'Valid name and type are required.' });
    if (type === 'file' && !url) return res.status(400).json({ error: 'File content is required.' });

    const id = Math.random().toString(36).substr(2, 9);
    const date = new Date().toISOString().split('T')[0];

    try {
      if (env.databaseProvider !== 'supabase') {
        if (parent_id) {
          const parent = db.prepare("SELECT id, type, client_id FROM files WHERE id = ?").get(parent_id) as any;
          if (!parent || parent.type !== 'folder' || parent.client_id !== req.params.id) return res.status(400).json({ error: 'Parent folder not found.' });
        }
        db.prepare("INSERT INTO files (id, name, type, parent_id, employee_id, client_id, size, date, extension, url, password) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)")
          .run(id, name, type, parent_id || null, req.params.id, size || null, date, extension || null, url || null, password || null);
        logActivity(req, type === 'folder' ? 'CREATE_CLIENT_FOLDER' : 'UPLOAD_CLIENT_FILE', { clientId: req.params.id, fileId: id, name, type });
        return res.status(201).json(db.prepare("SELECT * FROM files WHERE id = ?").get(id));
      }

      if (parent_id) {
        const { data: parent } = await supabaseAdmin.from('files').select('id,type,client_id').eq('id', parent_id).single();
        if (!parent || parent.type !== 'folder' || parent.client_id !== req.params.id) return res.status(400).json({ error: 'Parent folder not found.' });
      }

      const uploadedAsset = type === 'file' && typeof url === 'string'
        ? await uploadBase64FileToSupabaseStorage({
            bucket: env.supabaseBucketVaultFiles,
            fileName: name,
            folder: `client/${req.params.id}/${id}`,
            rawValue: url,
          })
        : null;
      const payload = {
        id,
        client_id: req.params.id,
        parent_id: parent_id || null,
        employee_id: null,
        name,
        type,
        mime_type: uploadedAsset?.mimeType || extension || null,
        size_bytes: uploadedAsset?.sizeBytes || size || null,
        storage_bucket: type === 'file' ? (uploadedAsset?.storageBucket || env.supabaseBucketVaultFiles) : null,
        storage_path: type === 'file' ? (uploadedAsset?.storagePath || `client/${req.params.id}/${id}/${name}`) : null,
        public_url: uploadedAsset ? uploadedAsset.publicUrl : (url || null),
        password: password || null,
        uploaded_by: (req.session as any)?.userId || null,
      };
      const { data, error } = await supabaseAdmin.from('files').insert(payload).select('*').single();
      if (error) throw error;
      logActivity(req, type === 'folder' ? 'CREATE_CLIENT_FOLDER' : 'UPLOAD_CLIENT_FILE', { clientId: req.params.id, fileId: id, name, type });
      return res.status(201).json(hydrateFileRow({ ...data, size: data.size_bytes, extension: data.mime_type, url: data.public_url || data.storage_path || null }));
    } catch (error) {
      console.error('Failed to create client file:', error);
      return res.status(500).json({ error: 'Failed to create client file' });
    }
  });

  app.patch("/api/admin/clients/:clientId/files/:fileId", isSuperAdmin, async (req, res) => {
    try {
      if (env.databaseProvider !== 'supabase') {
        const existing = db.prepare("SELECT * FROM files WHERE id = ? AND client_id = ?").get(req.params.fileId, req.params.clientId) as any;
        if (!existing) return res.status(404).json({ error: 'File not found' });
        db.prepare("UPDATE files SET name = ?, password = ? WHERE id = ?").run(req.body.name ?? existing.name, req.body.password ?? existing.password ?? null, req.params.fileId);
        logActivity(req, 'UPDATE_CLIENT_FILE', { clientId: req.params.clientId, fileId: req.params.fileId, name: req.body.name ?? existing.name });
        return res.json(db.prepare("SELECT * FROM files WHERE id = ?").get(req.params.fileId));
      }

      const { data: existing, error: fetchError } = await supabaseAdmin.from('files').select('*').eq('id', req.params.fileId).eq('client_id', req.params.clientId).single();
      if (fetchError || !existing) return res.status(404).json({ error: 'File not found' });

      const { data, error } = await supabaseAdmin.from('files').update({
        name: req.body.name ?? existing.name,
        password: req.body.password ?? existing.password ?? null,
      }).eq('id', req.params.fileId).select('*').single();
      if (error || !data) throw error;
      logActivity(req, 'UPDATE_CLIENT_FILE', { clientId: req.params.clientId, fileId: req.params.fileId, name: req.body.name ?? existing.name });
      return res.json(hydrateFileRow({ ...data, size: data.size_bytes, extension: data.mime_type, url: data.public_url || data.storage_path || null }));
    } catch (error) {
      console.error('Failed to update client file:', error);
      return res.status(500).json({ error: 'Failed to update client file' });
    }
  });

  app.delete("/api/admin/clients/:clientId/files/:fileId", isSuperAdmin, async (req, res) => {
    try {
      if (env.databaseProvider !== 'supabase') {
        const removeRecursively = (fileId: string) => {
          const children = db.prepare("SELECT id FROM files WHERE parent_id = ? AND client_id = ?").all(fileId, req.params.clientId) as any[];
          children.forEach((child) => removeRecursively(child.id));
          db.prepare("DELETE FROM files WHERE id = ? AND client_id = ?").run(fileId, req.params.clientId);
        };
        const existing = db.prepare("SELECT * FROM files WHERE id = ? AND client_id = ?").get(req.params.fileId, req.params.clientId) as any;
        if (!existing) return res.status(404).json({ error: 'File not found' });
        removeRecursively(req.params.fileId);
        logActivity(req, 'DELETE_CLIENT_FILE', { clientId: req.params.clientId, fileId: req.params.fileId, name: existing.name });
        return res.json({ success: true });
      }

      const { data: existing, error: fetchError } = await supabaseAdmin.from('files').select('*').eq('id', req.params.fileId).eq('client_id', req.params.clientId).single();
      if (fetchError || !existing) return res.status(404).json({ error: 'File not found' });

      const removeRecursively = async (fileId: string) => {
        const { data: children } = await supabaseAdmin.from('files').select('id').eq('parent_id', fileId).eq('client_id', req.params.clientId);
        for (const child of children || []) await removeRecursively(child.id);
        const { data: row } = await supabaseAdmin.from('files').select('storage_bucket,storage_path').eq('id', fileId).eq('client_id', req.params.clientId).maybeSingle();
        await deleteStoredObjectIfPresent({ storageBucket: row?.storage_bucket, storagePath: row?.storage_path });
        await supabaseAdmin.from('files').delete().eq('id', fileId).eq('client_id', req.params.clientId);
      };
      await removeRecursively(req.params.fileId);
      logActivity(req, 'DELETE_CLIENT_FILE', { clientId: req.params.clientId, fileId: req.params.fileId, name: existing.name });
      return res.json({ success: true });
    } catch (error) {
      console.error('Failed to delete client file:', error);
      return res.status(500).json({ error: 'Failed to delete client file' });
    }
  });

  app.get("/api/admin/clients/:id/logs", isSuperAdmin, async (req, res) => {
    if (env.databaseProvider !== 'supabase') {
      const rows = db.prepare("SELECT * FROM activity_logs WHERE client_id = ? ORDER BY created_at DESC LIMIT 500").all(req.params.id);
      return res.json(rows);
    }

    try {
      const { data, error } = await supabaseAdmin
        .from('activity_logs')
        .select('*')
        .eq('client_id', req.params.id)
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      return res.json(data || []);
    } catch (error) {
      console.error('Failed to load client activity logs:', error);
      return res.status(500).json({ error: 'Failed to load client activity logs' });
    }
  });

  app.get("/api/admin/clients/:id/payroll-logs", isSuperAdmin, async (req, res) => {
    const client = env.databaseProvider !== 'supabase'
      ? db.prepare("SELECT id, name FROM clients WHERE id = ?").get(req.params.id) as any
      : await fetchSupabaseClientById(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    try {
      if (env.databaseProvider !== 'supabase') {
        const rows = db.prepare(`
          SELECT * FROM payroll_submissions
          WHERE client_id = ? OR client_name = ?
          ORDER BY datetime(submitted_at) DESC, created_at DESC
        `).all(client.id, client.name) as any[];
        return res.json(rows.map(serializePayrollSubmission));
      }

      const { data, error } = await supabaseAdmin
        .from('payroll_submissions')
        .select('*')
        .eq('client_id', client.id)
        .order('submitted_at', { ascending: false });

      if (error) throw error;
      return res.json((data || []).map(serializePayrollSubmission));
    } catch (error) {
      console.error('Failed to load client payroll logs:', error);
      return res.status(500).json({ error: 'Failed to load client payroll logs' });
    }
  });

  app.delete("/api/admin/clients/:id", isSuperAdmin, async (req, res) => {
    const existing = env.databaseProvider !== 'supabase'
      ? db.prepare("SELECT * FROM clients WHERE id = ?").get(req.params.id) as any
      : await supabaseAdmin.from('clients').select('*').eq('id', req.params.id).maybeSingle().then(({ data }) => data as any);
    if (!existing) return res.status(404).json({ error: 'Client not found' });

    const passphrase = String((req.body as any)?.passphrase || '').trim();
    if (passphrase !== 'DELETE') {
      return res.status(400).json({ error: 'Passphrase must be exactly DELETE to remove this dashboard' });
    }

    try {
      if (env.databaseProvider !== 'supabase') {
        const tx = db.transaction(() => {
          db.prepare("DELETE FROM payroll_submissions WHERE client_id = ? OR client_name = ?").run(req.params.id, existing.name);
          db.prepare("DELETE FROM activity_logs WHERE client_id = ?").run(req.params.id);
          db.prepare("DELETE FROM files WHERE client_id = ?").run(req.params.id);
          db.prepare("DELETE FROM leave_requests WHERE employee_id IN (SELECT id FROM employees WHERE client_id = ?)").run(req.params.id);
          db.prepare("DELETE FROM roster_meta WHERE employee_id IN (SELECT id FROM employees WHERE client_id = ?)").run(req.params.id);
          db.prepare("DELETE FROM roster WHERE employee_id IN (SELECT id FROM employees WHERE client_id = ?)").run(req.params.id);
          db.prepare("DELETE FROM employees WHERE client_id = ?").run(req.params.id);
          db.prepare("DELETE FROM users WHERE client_id = ?").run(req.params.id);
          db.prepare("DELETE FROM clients WHERE id = ?").run(req.params.id);
        });
        tx();
      } else {
        const { data: employeeRows, error: employeesError } = await supabaseAdmin.from('employees').select('id').eq('client_id', req.params.id);
        if (employeesError) throw employeesError;
        const employeeIds = (employeeRows || []).map((row: any) => row.id).filter(Boolean);
        await supabaseAdmin.from('payroll_submissions').delete().or(`client_id.eq.${req.params.id},client_name.eq.${existing.name}`);
        await supabaseAdmin.from('activity_logs').delete().eq('client_id', req.params.id);
        await supabaseAdmin.from('files').delete().eq('client_id', req.params.id);
        if (employeeIds.length > 0) {
          await supabaseAdmin.from('leave_requests').delete().in('employee_id', employeeIds);
          await supabaseAdmin.from('roster_meta').delete().in('employee_id', employeeIds);
          await supabaseAdmin.from('roster').delete().in('employee_id', employeeIds);
        }
        await supabaseAdmin.from('employees').delete().eq('client_id', req.params.id);
        await supabaseAdmin.from('users').delete().eq('client_id', req.params.id);
        await supabaseAdmin.from('clients').delete().eq('id', req.params.id);
      }
      logActivity(req, 'DELETE_CLIENT', { clientId: req.params.id, name: existing.name, mode: 'kill_switch' });
      res.json({ success: true });
    } catch (error) {
      console.error('Delete client error:', error);
      res.status(500).json({ error: 'Failed to delete client' });
    }
  });

  app.post("/api/admin/users", isSuperAdmin, async (req, res) => {
    console.log("Creating user with data:", { ...req.body, password: "[REDACTED]" });
    const { email, password, role, image } = req.body;

    if (!email || !password || !role) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);

    try {
      const id = Math.random().toString(36).substr(2, 9);
      if (env.databaseProvider !== 'supabase') {
        db.prepare("INSERT INTO users (id, email, password, role, is_verified, client_id, name, image, last_login) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)")
          .run(id, email, hashedPassword, role, 1, req.body.name || null, image || null, null);
      } else {
        const { error } = await supabaseAdmin.from('users').insert({ id, email, password: hashedPassword, role, is_verified: true, client_id: null, name: req.body.name || null, image: image || null, last_login: null });
        if (error) {
          if (String(error.message || '').toLowerCase().includes('duplicate')) return res.status(400).json({ error: 'User already exists' });
          throw error;
        }
      }

      console.log(`User created: ${email} with role ${role}`);
      logActivity(req, 'CREATE_USER', { email, role, scope: 'super_panel' });
      res.json({ success: true });
    } catch (error: any) {
      console.error("User creation error:", error);
      if (error.message?.includes("UNIQUE constraint failed")) {
        res.status(400).json({ error: "User already exists" });
      } else {
        res.status(500).json({ error: "Failed to create user: " + error.message });
      }
    }
  });

  app.patch("/api/admin/users/:id/verify", isSuperAdmin, async (req, res) => {
    if (env.databaseProvider !== 'supabase') {
      const existing = db.prepare("SELECT * FROM users WHERE id = ? AND client_id IS NULL").get(req.params.id) as any;
      if (!existing) return res.status(404).json({ error: "User not found" });
      db.prepare("UPDATE users SET is_verified = 1 WHERE id = ? AND client_id IS NULL").run(req.params.id);
      logActivity(req, 'VERIFY_USER', { userId: req.params.id });
      return res.json({ success: true });
    }

    const { data, error } = await supabaseAdmin.from('users').update({ is_verified: true }).eq('id', req.params.id).is('client_id', null).select('id').single();
    if (error || !data) return res.status(404).json({ error: 'User not found' });
    logActivity(req, 'VERIFY_USER', { userId: req.params.id });
    return res.json({ success: true });
  });

  app.delete("/api/admin/users/:id", isSuperAdmin, async (req, res) => {
    if (env.databaseProvider !== 'supabase') {
      const result = db.prepare("DELETE FROM users WHERE id = ? AND client_id IS NULL").run(req.params.id);
      if (!result.changes) return res.status(404).json({ error: "User not found" });
      logActivity(req, 'DELETE_USER', { userId: req.params.id, scope: 'super_panel' });
      return res.json({ success: true });
    }

    const { data, error } = await supabaseAdmin.from('users').delete().eq('id', req.params.id).is('client_id', null).select('id').single();
    if (error || !data) return res.status(404).json({ error: 'User not found' });
    logActivity(req, 'DELETE_USER', { userId: req.params.id, scope: 'super_panel' });
    return res.json({ success: true });
  });

  app.patch("/api/admin/users/:id", isSuperAdmin, async (req, res) => {
    const { email, password, role, is_verified } = req.body;
    const existing = env.databaseProvider !== 'supabase'
      ? db.prepare("SELECT * FROM users WHERE id = ? AND client_id IS NULL").get(req.params.id) as any
      : await fetchSupabaseUserById(req.params.id);
    if (!existing || existing.client_id !== null) return res.status(404).json({ error: "User not found" });

    const nextEmail = email ?? existing.email;
    const nextRole = role ?? existing.role;
    const nextVerified = typeof is_verified === 'undefined' ? existing.is_verified : !!is_verified;
    const nextPassword = password ? bcrypt.hashSync(password, 10) : existing.password;

    try {
      if (env.databaseProvider !== 'supabase') {
        db.prepare("UPDATE users SET email = ?, password = ?, role = ?, is_verified = ?, name = ?, image = ? WHERE id = ? AND client_id IS NULL")
          .run(nextEmail, nextPassword, nextRole, nextVerified ? 1 : 0, req.body.name ?? existing.name ?? null, req.body.image ?? existing.image ?? null, req.params.id);
        logActivity(req, 'UPDATE_USER', { userId: req.params.id, email: nextEmail, role: nextRole, scope: 'super_panel' });
        const updated = db.prepare("SELECT id, email, role, is_verified, client_id, name, image, last_login FROM users WHERE id = ? AND client_id IS NULL").get(req.params.id) as any;
        return res.json(updated);
      }

      const { data, error } = await supabaseAdmin.from('users').update({
        email: nextEmail,
        password: nextPassword,
        role: nextRole,
        is_verified: nextVerified,
        name: req.body.name ?? existing.name ?? null,
        image: req.body.image ?? existing.image ?? null,
      }).eq('id', req.params.id).is('client_id', null).select('id, email, role, is_verified, client_id, name, image, last_login').single();
      if (error) {
        if (String(error.message || '').toLowerCase().includes('duplicate')) return res.status(400).json({ error: 'Email already exists' });
        throw error;
      }
      logActivity(req, 'UPDATE_USER', { userId: req.params.id, email: nextEmail, role: nextRole, scope: 'super_panel' });
      return res.json(data);
    } catch (error: any) {
      if (error.message?.includes("UNIQUE constraint failed")) {
        return res.status(400).json({ error: "Email already exists" });
      }
      res.status(500).json({ error: "Failed to update user" });
    }
  });

  app.get("/api/admin/clients", isSuperAdmin, async (_req, res) => {
    const { start, end } = getWeekBounds();
    if (env.databaseProvider !== 'supabase') {
      try {
        const rows = db.prepare(`
          SELECT c.*, 
            (SELECT COUNT(*) FROM users u WHERE u.client_id = c.id) as users,
            (SELECT COUNT(*) FROM employees e WHERE e.client_id = c.id AND COALESCE(e.status, 'active') != 'offboarded') as employees,
            (SELECT COUNT(*) FROM files f WHERE f.client_id = c.id) as files,
            (SELECT COALESCE(MAX(created_at), c.updated_at) FROM activity_logs al WHERE al.client_id = c.id) as last_activity,
            (SELECT COUNT(*) FROM roster r JOIN employees e ON e.id = r.employee_id WHERE e.client_id = c.id AND r.day_date BETWEEN ? AND ?) as shiftsThisWeek,
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
              WHERE e.client_id = c.id AND r.day_date BETWEEN ? AND ?
            ) as totalHours
          FROM clients c
          ORDER BY datetime(c.created_at) DESC
        `).all(start, end, start, end) as any[];
        return res.json(rows.map(serializeAdminClient));
      } catch (error) {
        console.error('Failed to load clients from SQLite:', error);
        return res.status(500).json({ error: 'Failed to load clients' });
      }
    }

    try {
      const { data: clients, error } = await supabaseAdmin
        .from('clients')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;

      const rows = await Promise.all((clients || []).map(async (client: any) => {
        const [users, employees, files] = await Promise.all([
          countSupabaseRows('users', 'client_id', client.id),
          countSupabaseEmployees(client.id),
          countSupabaseRows('files', 'client_id', client.id),
        ]);
        return serializeSupabaseClient(client, { users, employees, files });
      }));

      return res.json(rows);
    } catch (error) {
      console.error('Failed to load clients from Supabase:', error);
      return res.status(500).json({ error: 'Failed to load clients' });
    }
  });

  app.post("/api/admin/clients", isSuperAdmin, async (req, res) => {
    try {
      const id = req.body.id || `c_${Math.random().toString(36).slice(2, 10)}`;
      const name = String(req.body.name || '').trim();
      if (!name) return res.status(400).json({ error: 'Client name is required' });

      const trialColumns = normalizeClientTrialColumns({
        isTrial: typeof req.body.isTrial === 'boolean' ? req.body.isTrial : false,
        trialDuration: req.body.trialDuration,
      });

      if (env.databaseProvider !== 'supabase') {
        db.prepare(`INSERT INTO clients (
          id, name, status, fallback_image, dashboard_type, locked_features, enabled_definitions,
          roster_start_day, roster_duration, roster_mode, roster_seed_week_start, is_trial, trial_duration, trial_started_at, trial_end_date,
          payroll_email, payroll_cc, payroll_submission_day, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`)
          .run(
            id, name, req.body.status || 'active', req.body.fallbackImage || null, req.body.dashboardType || 'rostering',
            JSON.stringify(req.body.lockedFeatures || []), JSON.stringify(mergeDefinitions(req.body.enabledDefinitions || [])),
            req.body.rosterStartDay ?? 1, req.body.rosterDuration || '1_week', req.body.rosterMode || 'Manual',
            req.body.rosterSeedWeekStart || null, trialColumns.is_trial, trialColumns.trial_duration, trialColumns.trial_started_at, trialColumns.trial_end_date,
            String(req.body.payrollEmail || '').trim(), String(req.body.payrollCc || '').trim(), req.body.payrollSubmissionDay || 1,
          );
        ensureClientVaultStructure(id);
        const row = db.prepare(`SELECT c.*, 0 as users, 0 as employees, (SELECT COUNT(*) FROM files f WHERE f.client_id = c.id) as files, c.updated_at as last_activity, 0 as shiftsThisWeek, 0 as totalHours FROM clients c WHERE c.id = ?`).get(id) as any;
        logActivity(req, 'CREATE_CLIENT', { clientId: id, name });
        return res.status(201).json(serializeAdminClient(row));
      }

      const payload = {
        id,
        name,
        status: req.body.status || 'active',
        fallback_image: req.body.fallbackImage || null,
        dashboard_type: req.body.dashboardType || 'rostering',
        locked_features: req.body.lockedFeatures || [],
        enabled_definitions: mergeDefinitions(req.body.enabledDefinitions || []),
        roster_start_day: req.body.rosterStartDay ?? 1,
        roster_duration: req.body.rosterDuration || '1_week',
        roster_mode: req.body.rosterMode || 'Manual',
        roster_seed_week_start: req.body.rosterSeedWeekStart || null,
        is_trial: !!trialColumns.is_trial,
        trial_duration: trialColumns.trial_duration || 7,
        payroll_email: String(req.body.payrollEmail || '').trim(),
        payroll_cc: String(req.body.payrollCc || '').trim(),
        payroll_submission_day: req.body.payrollSubmissionDay || 1,
      };

      const { data, error } = await supabaseAdmin.from('clients').insert(payload).select('*').single();
      if (error) {
        if (String(error.message || '').toLowerCase().includes('duplicate')) return res.status(400).json({ error: 'Client already exists' });
        throw error;
      }

      logActivity(req, 'CREATE_CLIENT', { clientId: id, name });
      return res.status(201).json(serializeSupabaseClient(data, { users: 0, employees: 0, files: 0 }));
    } catch (error: any) {
      console.error('Create client error:', error);
      res.status(500).json({ error: 'Failed to create client' });
    }
  });

  app.patch("/api/admin/clients/:id", isSuperAdmin, async (req, res) => {
    if (env.databaseProvider !== 'supabase') {
      const existing = db.prepare("SELECT * FROM clients WHERE id = ?").get(req.params.id) as any;
      if (!existing) return res.status(404).json({ error: 'Client not found' });

      const trialColumns = normalizeClientTrialColumns({
        isTrial: typeof req.body.isTrial === 'boolean' ? req.body.isTrial : undefined,
        trialDuration: req.body.trialDuration,
        existing,
      });

      db.prepare(`UPDATE clients SET name = ?, status = ?, fallback_image = ?, dashboard_type = ?, locked_features = ?, enabled_definitions = ?, roster_start_day = ?, roster_duration = ?, roster_mode = ?, roster_seed_week_start = ?, is_trial = ?, trial_duration = ?, trial_started_at = ?, trial_end_date = ?, payroll_email = ?, payroll_cc = ?, payroll_submission_day = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(
          req.body.name ?? existing.name, req.body.status ?? existing.status, req.body.fallbackImage ?? existing.fallback_image ?? null,
          req.body.dashboardType ?? existing.dashboard_type, JSON.stringify(req.body.lockedFeatures ?? safeJsonParse(existing.locked_features, [])),
          JSON.stringify(mergeDefinitions(req.body.enabledDefinitions ?? safeJsonParse(existing.enabled_definitions, []))),
          req.body.rosterStartDay ?? existing.roster_start_day ?? 1, req.body.rosterDuration ?? existing.roster_duration ?? '1_week',
          req.body.rosterMode || existing.roster_mode || 'Manual', req.body.rosterSeedWeekStart ?? existing.roster_seed_week_start ?? null,
          trialColumns.is_trial, trialColumns.trial_duration, trialColumns.trial_started_at, trialColumns.trial_end_date,
          String(req.body.payrollEmail ?? existing.payroll_email ?? '').trim(), String(req.body.payrollCc ?? existing.payroll_cc ?? '').trim(),
          req.body.payrollSubmissionDay ?? existing.payroll_submission_day ?? 1, req.params.id
        );
      const row = db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM users u WHERE u.client_id = c.id) as users, (SELECT COUNT(*) FROM employees e WHERE e.client_id = c.id AND COALESCE(e.status, 'active') != 'offboarded') as employees, (SELECT COUNT(*) FROM files f WHERE f.client_id = c.id) as files, (SELECT COALESCE(MAX(created_at), c.updated_at) FROM activity_logs al WHERE al.client_id = c.id) as last_activity, 0 as shiftsThisWeek, 0 as totalHours FROM clients c WHERE c.id = ?`).get(req.params.id) as any;
      logActivity(req, 'UPDATE_CLIENT', { clientId: req.params.id, name: req.body.name ?? existing.name });
      return res.json(serializeAdminClient(row));
    }

    const { data: existing, error: fetchError } = await supabaseAdmin.from('clients').select('*').eq('id', req.params.id).single();
    if (fetchError || !existing) return res.status(404).json({ error: 'Client not found' });

    const trialColumns = normalizeClientTrialColumns({
      isTrial: typeof req.body.isTrial === 'boolean' ? req.body.isTrial : undefined,
      trialDuration: req.body.trialDuration,
      existing,
    });

    const updatePayload = {
      name: req.body.name ?? existing.name,
      status: req.body.status ?? existing.status,
      fallback_image: req.body.fallbackImage ?? existing.fallback_image ?? null,
      dashboard_type: req.body.dashboardType ?? existing.dashboard_type,
      locked_features: req.body.lockedFeatures ?? parseJsonArray(existing.locked_features),
      enabled_definitions: mergeDefinitions(req.body.enabledDefinitions ?? parseJsonArray(existing.enabled_definitions)),
      roster_start_day: req.body.rosterStartDay ?? existing.roster_start_day ?? 1,
      roster_duration: req.body.rosterDuration ?? existing.roster_duration ?? '1_week',
      roster_mode: req.body.rosterMode || existing.roster_mode || 'Manual',
      roster_seed_week_start: req.body.rosterSeedWeekStart ?? existing.roster_seed_week_start ?? null,
      is_trial: !!trialColumns.is_trial,
      trial_duration: trialColumns.trial_duration || 7,
      payroll_email: String(req.body.payrollEmail ?? existing.payroll_email ?? '').trim(),
      payroll_cc: String(req.body.payrollCc ?? existing.payroll_cc ?? '').trim(),
      payroll_submission_day: req.body.payrollSubmissionDay ?? existing.payroll_submission_day ?? 1,
    };

    const { data: updated, error: updateError } = await supabaseAdmin.from('clients').update(updatePayload).eq('id', req.params.id).select('*').single();
    if (updateError || !updated) {
      console.error('Update client error:', updateError);
      return res.status(500).json({ error: 'Failed to update client' });
    }

    const [users, employees, files] = await Promise.all([
      countSupabaseRows('users', 'client_id', req.params.id),
      countSupabaseEmployees(req.params.id),
      countSupabaseRows('files', 'client_id', req.params.id),
    ]);

    logActivity(req, 'UPDATE_CLIENT', { clientId: req.params.id, name: updatePayload.name });
    return res.json(serializeSupabaseClient(updated, { users, employees, files }));
  });

  app.get('/api/internal/clients', isSuperAdmin, (_req, res) => res.redirect(307, '/api/admin/clients'));
  app.post('/api/internal/clients', isSuperAdmin, (_req, res) => res.redirect(307, '/api/admin/clients'));
  app.patch('/api/internal/clients/:id', isSuperAdmin, (req, res) => res.redirect(307, `/api/admin/clients/${req.params.id}`));
  app.get('/api/internal/clients/:id/users', isSuperAdmin, (req, res) => res.redirect(307, `/api/admin/clients/${req.params.id}/users`));
  app.post('/api/internal/clients/:id/users', isSuperAdmin, (req, res) => res.redirect(307, `/api/admin/clients/${req.params.id}/users`));
  app.put('/api/internal/clients/:clientId/users/:userId', isSuperAdmin, (req, res) => res.redirect(307, `/api/admin/clients/${req.params.clientId}/users/${req.params.userId}`));
  app.delete('/api/internal/clients/:clientId/users/:userId', isSuperAdmin, (req, res) => res.redirect(307, `/api/admin/clients/${req.params.clientId}/users/${req.params.userId}`));
  app.get('/api/internal/clients/:id/files', isSuperAdmin, (req, res) => res.redirect(307, `/api/admin/clients/${req.params.id}/files`));
  app.post('/api/internal/clients/:id/files', isSuperAdmin, (req, res) => res.redirect(307, `/api/admin/clients/${req.params.id}/files`));
  app.put('/api/internal/clients/:clientId/files/:fileId', isSuperAdmin, (req, res) => res.redirect(307, `/api/admin/clients/${req.params.clientId}/files/${req.params.fileId}`));
  app.delete('/api/internal/clients/:clientId/files/:fileId', isSuperAdmin, (req, res) => res.redirect(307, `/api/admin/clients/${req.params.clientId}/files/${req.params.fileId}`));
  app.get('/api/internal/clients/:id/logs', isSuperAdmin, (req, res) => res.redirect(307, `/api/admin/clients/${req.params.id}/logs`));
}