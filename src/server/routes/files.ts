import express, { type Express, type Request } from 'express';
import path from 'node:path';
import { supabaseAdmin } from '../integrations/supabase';
import { env } from '../config/env';
import { deleteStoredObjectIfPresent, encodeBufferAsDataUrl, resolveDownloadUrl, uploadBase64FileToSupabaseStorage, uploadBinaryFileToSupabaseStorage } from '../utils/storage';
import { enqueueBackgroundJob, getBackgroundJobById, listRecentBackgroundJobs } from '../utils/backgroundJobs';

type Middleware = (req: any, res: any, next: any) => unknown;

type FilesRoutesDeps = {
  app: Express;
  db: any;
  ensureFileAccess: Middleware;
  isSuperAdmin: Middleware;
  logActivity: (req: Request, action: string, details?: any) => void;
  canAccessEmployeeFiles: (req: any, employeeId: string | null | undefined) => boolean;
  canMutateVaultItems: (req: any) => boolean;
  getActorClientId: (req: any) => string | null;
  ensureClientVaultStructure: (clientId: string | null | undefined) => void;
  hydrateFileRow: (row: any) => any;
  buildFolderDownloadPayload: (folderRow: any) => Promise<any>;
  serializePayrollSubmission: (row: any) => any;
  getEffectiveClientId: (db: any, req: any) => string | null;
  toLocalIsoDate: (value: Date) => string;
  isSmtpConfigured: boolean;
  sendPayrollSubmissionEmail: (payload: any) => Promise<any>;
  setLastMailEvent: (payload: any) => void;
  buildRosterAndTimesheetAttachments: (payload: any, context: any) => Array<{ filename: string; content: Buffer; contentType: string }>;
};


const fetchSupabaseUserById = async (id: string | null | undefined) => {
  if (!id) return null;
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, email, client_id')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as any;
};

const fetchSupabaseClientById = async (id: string | null | undefined) => {
  if (!id) return null;
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('id, name, payroll_email, payroll_cc')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as any;
};

const fetchSupabaseClientByName = async (name: string | null | undefined) => {
  const normalized = String(name || '').trim();
  if (!normalized) return null;
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('id, name, payroll_email, payroll_cc')
    .eq('name', normalized)
    .maybeSingle();
  if (error) throw error;
  return data as any;
};

const fetchSupabaseFileById = async (id: string | null | undefined) => {
  if (!id) return null;
  const { data, error } = await supabaseAdmin
    .from('files')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as any;
};


const uploadBinaryLimit = `${env.directUploadLimitMb}mb`;

const getQueryValue = (value: unknown) => typeof value === 'string' ? value.trim() : '';

const normalizeRawBody = (value: any) => {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string') return Buffer.from(value);
  return Buffer.alloc(0);
};

export function registerFilesRoutes({
  app,
  db,
  ensureFileAccess,
  isSuperAdmin,
  logActivity,
  canAccessEmployeeFiles,
  canMutateVaultItems,
  getActorClientId,
  ensureClientVaultStructure,
  hydrateFileRow,
  buildFolderDownloadPayload,
  serializePayrollSubmission,
  getEffectiveClientId,
  toLocalIsoDate,
  isSmtpConfigured,
  sendPayrollSubmissionEmail,
  setLastMailEvent,
  buildRosterAndTimesheetAttachments,
}: FilesRoutesDeps) {
  app.post('/api/files/upload-binary', ensureFileAccess, express.raw({ type: '*/*', limit: uploadBinaryLimit }), async (req, res) => {
    if (!canMutateVaultItems(req)) {
      return res.status(403).json({ error: 'Only super admins can make changes in the document vault.' });
    }

    try {
      const name = getQueryValue(req.query.name);
      const parent_id = getQueryValue(req.query.parent_id) || null;
      const employee_id = getQueryValue(req.query.employee_id) || null;
      if (!name) return res.status(400).json({ error: 'File name is required' });

      const buffer = normalizeRawBody(req.body);
      if (!buffer.length) return res.status(400).json({ error: 'File content is required' });

      const sessionEmployeeId = (req.session as any)?.employeeId;
      const actorClientId = getActorClientId(req);
      const ownerEmployeeId = employee_id || sessionEmployeeId || null;
      const ownerClientId = ownerEmployeeId ? null : actorClientId;
      if (ownerEmployeeId && !canAccessEmployeeFiles(req, ownerEmployeeId)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      if (parent_id) {
        if (env.databaseProvider !== 'supabase') {
          const parent = db.prepare('SELECT id, type FROM files WHERE id = ?').get(parent_id) as any;
          if (!parent || parent.type !== 'folder') return res.status(400).json({ error: 'Parent folder not found' });
        } else {
          const { data: parent } = await supabaseAdmin.from('files').select('id,type').eq('id', parent_id).single();
          if (!parent || parent.type !== 'folder') return res.status(400).json({ error: 'Parent folder not found' });
        }
      }

      const id = Math.random().toString(36).substr(2, 9);
      const date = new Date().toISOString().split('T')[0];
      const contentType = String(req.headers['content-type'] || 'application/octet-stream');
      const extension = path.extname(name).replace(/^\./, '').toLowerCase() || null;

      if (env.databaseProvider !== 'supabase') {
        const url = encodeBufferAsDataUrl({ buffer, contentType });
        db.prepare(`INSERT INTO files (id, name, type, parent_id, employee_id, client_id, size, date, extension, url, password)
          VALUES (?, ?, 'file', ?, ?, ?, ?, ?, ?, ?, NULL)`)
          .run(id, name, parent_id || null, ownerEmployeeId, ownerClientId, `${(buffer.length / 1024 / 1024).toFixed(2)} MB`, date, extension, url);
        logActivity(req, 'UPLOAD_FILE', { fileId: id, name, type: 'file', employeeId: ownerEmployeeId, clientId: ownerClientId, transport: 'binary' });
        const row = db.prepare('SELECT * FROM files WHERE id = ?').get(id) as any;
        return res.status(201).json(hydrateFileRow(row));
      }

      const uploadedAsset = await uploadBinaryFileToSupabaseStorage({
        bucket: env.supabaseBucketVaultFiles,
        fileName: name,
        folder: ownerEmployeeId ? `employee/${ownerEmployeeId}/${id}` : `client/${ownerClientId || 'shared'}/${id}`,
        buffer,
        contentType,
      });
      const payload = {
        id,
        client_id: ownerClientId,
        parent_id: parent_id || null,
        employee_id: ownerEmployeeId,
        name,
        type: 'file',
        mime_type: uploadedAsset.mimeType || extension || null,
        size_bytes: uploadedAsset.sizeBytes,
        storage_bucket: uploadedAsset.storageBucket,
        storage_path: uploadedAsset.storagePath,
        public_url: null,
        password: null,
        uploaded_by: (req.session as any)?.userId || null,
      };
      const { data, error } = await supabaseAdmin.from('files').insert(payload).select('*').single();
      if (error) throw error;
      logActivity(req, 'UPLOAD_FILE', { fileId: id, name, type: 'file', employeeId: ownerEmployeeId, clientId: ownerClientId, transport: 'binary' });
      return res.status(201).json(hydrateFileRow({ ...data, size: data.size_bytes, extension: data.mime_type, url: data.public_url || data.storage_path || null }));
    } catch (error) {
      console.error('Failed to upload binary file item:', error);
      res.status(500).json({ error: 'Failed to upload file item' });
    }
  });

  app.get('/api/files', ensureFileAccess, async (req, res) => {
    try {
      const parentId = typeof req.query.parent_id === 'string' ? req.query.parent_id : null;
      const employeeId = typeof req.query.employee_id === 'string' ? req.query.employee_id : null;
      const actorClientId = getActorClientId(req);
      const sessionEmployeeId = (req.session as any)?.employeeId;

      if (employeeId && !canAccessEmployeeFiles(req, employeeId)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      if (env.databaseProvider !== 'supabase') {
        if (!employeeId && actorClientId) {
          ensureClientVaultStructure(actorClientId);
        }
        const clauses: string[] = [];
        const params: any[] = [];
        if (employeeId) {
          clauses.push('employee_id = ?');
          params.push(employeeId);
        } else if (sessionEmployeeId) {
          clauses.push('employee_id = ?');
          params.push(sessionEmployeeId);
        } else if (actorClientId) {
          clauses.push('client_id = ?');
          params.push(actorClientId);
          clauses.push('employee_id IS NULL');
        } else {
          clauses.push('employee_id IS NULL');
        }
        if (parentId) {
          clauses.push('parent_id = ?');
          params.push(parentId);
        } else {
          clauses.push('parent_id IS NULL');
        }
        const rows = db.prepare(`SELECT * FROM files WHERE ${clauses.join(' AND ')} ORDER BY type DESC, name ASC`).all(...params) as any[];
        return res.json(rows.map(hydrateFileRow));
      }

      let query = supabaseAdmin.from('files').select('*').order('type', { ascending: false }).order('name', { ascending: true });
      if (employeeId) {
        query = query.eq('employee_id', employeeId);
      } else if (sessionEmployeeId) {
        query = query.eq('employee_id', sessionEmployeeId);
      } else if (actorClientId) {
        query = query.eq('client_id', actorClientId).is('employee_id', null);
      } else {
        query = query.is('employee_id', null);
      }
      if (parentId) query = query.eq('parent_id', parentId); else query = query.is('parent_id', null);
      const { data, error } = await query;
      if (error) throw error;
      return res.json((data || []).map((row) => hydrateFileRow({ ...row, size: row.size_bytes, extension: row.mime_type, url: row.public_url || row.storage_path || null })));
    } catch (error) {
      console.error('Failed to load files:', error);
      res.status(500).json({ error: 'Failed to load files' });
    }
  });

  app.post('/api/files', ensureFileAccess, async (req, res) => {
    if (!canMutateVaultItems(req)) {
      return res.status(403).json({ error: 'Only super admins can make changes in the document vault.' });
    }
    try {
      const { name, type, parent_id, employee_id, size, extension, url, password } = req.body || {};
      if (!name || !['file', 'folder'].includes(type)) {
        return res.status(400).json({ error: 'Valid name and type are required' });
      }
      if (type === 'file' && !url) {
        return res.status(400).json({ error: 'File content is required' });
      }
      const sessionEmployeeId = (req.session as any)?.employeeId;
      const actorClientId = getActorClientId(req);
      const ownerEmployeeId = employee_id || sessionEmployeeId || null;
      const ownerClientId = ownerEmployeeId ? null : actorClientId;
      if (ownerEmployeeId && !canAccessEmployeeFiles(req, ownerEmployeeId)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      if (env.databaseProvider !== 'supabase') {
        const id = Math.random().toString(36).substr(2, 9);
        const date = new Date().toISOString().split('T')[0];
        if (parent_id) {
          const parent = db.prepare('SELECT id, type FROM files WHERE id = ?').get(parent_id) as any;
          if (!parent || parent.type !== 'folder') {
            return res.status(400).json({ error: 'Parent folder not found' });
          }
        }
        db.prepare(`INSERT INTO files (id, name, type, parent_id, employee_id, client_id, size, date, extension, url, password)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, name, type, parent_id || null, ownerEmployeeId, ownerClientId, size || null, date, extension || null, url || null, password || null);
        logActivity(req, type === 'folder' ? 'CREATE_FOLDER' : 'UPLOAD_FILE', { fileId: id, name, type, employeeId: ownerEmployeeId, clientId: ownerClientId });
        const row = db.prepare('SELECT * FROM files WHERE id = ?').get(id) as any;
        return res.status(201).json(hydrateFileRow(row));
      }

      if (parent_id) {
        const { data: parent } = await supabaseAdmin.from('files').select('id,type').eq('id', parent_id).single();
        if (!parent || parent.type !== 'folder') return res.status(400).json({ error: 'Parent folder not found' });
      }
      const id = Math.random().toString(36).substr(2, 9);
      const uploadedAsset = type === 'file' && typeof url === 'string'
        ? await uploadBase64FileToSupabaseStorage({
            bucket: env.supabaseBucketVaultFiles,
            fileName: name,
            folder: ownerEmployeeId ? `employee/${ownerEmployeeId}/${id}` : `client/${ownerClientId || 'shared'}/${id}`,
            rawValue: url,
          })
        : null;
      const payload = {
        id,
        client_id: ownerClientId,
        parent_id: parent_id || null,
        employee_id: ownerEmployeeId,
        name,
        type,
        mime_type: uploadedAsset?.mimeType || extension || null,
        size_bytes: uploadedAsset?.sizeBytes || size || null,
        storage_bucket: type === 'file' ? (uploadedAsset?.storageBucket || env.supabaseBucketVaultFiles) : null,
        storage_path: type === 'file' ? (uploadedAsset?.storagePath || `${ownerEmployeeId ? `employee/${ownerEmployeeId}` : `client/${ownerClientId || 'shared'}`}/${id}/${name}`) : null,
        public_url: uploadedAsset ? uploadedAsset.publicUrl : (url || null),
        password: password || null,
        uploaded_by: (req.session as any)?.userId || null,
      };
      const { data, error } = await supabaseAdmin.from('files').insert(payload).select('*').single();
      if (error) throw error;
      logActivity(req, type === 'folder' ? 'CREATE_FOLDER' : 'UPLOAD_FILE', { fileId: id, name, type, employeeId: ownerEmployeeId, clientId: ownerClientId });
      return res.status(201).json(hydrateFileRow({ ...data, size: data.size_bytes, extension: data.mime_type, url: data.public_url || data.storage_path || null }));
    } catch (error) {
      console.error('Failed to create file item:', error);
      res.status(500).json({ error: 'Failed to create file item' });
    }
  });

  app.delete('/api/files/:id', ensureFileAccess, async (req, res) => {
    if (!canMutateVaultItems(req)) {
      return res.status(403).json({ error: 'Only super admins can make changes in the document vault.' });
    }
    try {
      if (env.databaseProvider !== 'supabase') {
        const existing = env.databaseProvider !== 'supabase'
        ? db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id) as any
        : ((await supabaseAdmin.from('files').select('*').eq('id', req.params.id).single()).data as any);
        if (!existing) return res.status(404).json({ error: 'File not found' });
        if (existing.employee_id && !canAccessEmployeeFiles(req, existing.employee_id)) return res.status(403).json({ error: 'Forbidden' });
        const actorClientId = getActorClientId(req);
        const sessionRole = (req.session as any)?.userRole;
        if (actorClientId && sessionRole !== 'superadmin' && existing.client_id && existing.client_id !== actorClientId) return res.status(403).json({ error: 'Forbidden' });
        const removeRecursively = (fileId: string) => {
          const children = db.prepare('SELECT id FROM files WHERE parent_id = ?').all(fileId) as any[];
          children.forEach((child) => removeRecursively(child.id));
          db.prepare('DELETE FROM files WHERE id = ?').run(fileId);
        };
        removeRecursively(req.params.id);
        logActivity(req, 'DELETE_FILE', { fileId: req.params.id, name: existing.name, employeeId: existing.employee_id || null, clientId: existing.client_id || null });
        return res.json({ success: true });
      }

      const { data: existing, error: fetchError } = await supabaseAdmin.from('files').select('*').eq('id', req.params.id).single();
      if (fetchError || !existing) return res.status(404).json({ error: 'File not found' });
      if (existing.employee_id && !canAccessEmployeeFiles(req, existing.employee_id)) return res.status(403).json({ error: 'Forbidden' });
      const actorClientId = getActorClientId(req);
      const sessionRole = (req.session as any)?.userRole;
      if (actorClientId && sessionRole !== 'superadmin' && existing.client_id && existing.client_id !== actorClientId) return res.status(403).json({ error: 'Forbidden' });

      const removeRecursively = async (fileId: string) => {
        const { data: children } = await supabaseAdmin.from('files').select('id').eq('parent_id', fileId);
        for (const child of children || []) await removeRecursively(child.id);
        const row = await fetchSupabaseFileById(fileId);
        await deleteStoredObjectIfPresent({ storageBucket: row?.storage_bucket, storagePath: row?.storage_path });
        await supabaseAdmin.from('files').delete().eq('id', fileId);
      };
      await removeRecursively(req.params.id);
      logActivity(req, 'DELETE_FILE', { fileId: req.params.id, name: existing.name, employeeId: existing.employee_id || null, clientId: existing.client_id || null });
      return res.json({ success: true });
    } catch (error) {
      console.error('Failed to delete file item:', error);
      res.status(500).json({ error: 'Failed to delete file item' });
    }
  });

  app.get('/api/files/:id/download', ensureFileAccess, async (req, res) => {
    try {
      const existing = env.databaseProvider !== 'supabase'
        ? db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id) as any
        : await fetchSupabaseFileById(req.params.id);
      if (!existing) return res.status(404).json({ error: 'File not found' });
      if (existing.employee_id && !canAccessEmployeeFiles(req, existing.employee_id)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const actorClientId = getActorClientId(req);
      const sessionRole = (req.session as any)?.userRole;
      if (actorClientId && sessionRole !== 'superadmin' && existing.client_id && existing.client_id !== actorClientId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      if (existing.type === 'folder') {
        const payload = await buildFolderDownloadPayload(existing);
        return res.json(payload);
      }
      const downloadUrl = env.databaseProvider === 'supabase'
        ? await resolveDownloadUrl({
            storageBucket: existing.storage_bucket,
            storagePath: existing.storage_path,
            fallbackUrl: existing.public_url || existing.url || null,
            ttlSeconds: env.fileDownloadUrlTtlSeconds,
          })
        : (existing.url || existing.public_url || existing.storage_path || null);
      res.json({ id: existing.id, name: existing.name, url: downloadUrl, extension: existing.extension || existing.mime_type || null, size: existing.size || existing.size_bytes || null });
    } catch (error) {
      console.error('Failed to prepare file download:', error);
      res.status(500).json({ error: 'Failed to prepare file download' });
    }
  });

  app.get('/api/background-jobs', ensureFileAccess, isSuperAdmin, async (_req, res) => {
    try {
      const jobs = await listRecentBackgroundJobs(100);
      return res.json(jobs);
    } catch (error) {
      console.error('Failed to load background jobs:', error);
      return res.status(500).json({ error: 'Failed to load background jobs' });
    }
  });

  app.get('/api/background-jobs/:id', ensureFileAccess, isSuperAdmin, async (req, res) => {
    try {
      const job = await getBackgroundJobById(req.params.id);
      if (!job) return res.status(404).json({ error: 'Background job not found' });
      return res.json(job);
    } catch (error) {
      console.error('Failed to load background job:', error);
      return res.status(500).json({ error: 'Failed to load background job' });
    }
  });

  app.get("/api/payroll-submissions", ensureFileAccess, async (req, res) => {
    const sessionUserId = (req.session as any)?.userId;
    const sessionRole = (req.session as any)?.userRole;
    const sessionEmployeeId = (req.session as any)?.employeeId;

    if (sessionEmployeeId) {
      return res.json([]);
    }

    if (env.databaseProvider !== 'supabase') {
      try {
        if (sessionRole === 'superadmin') {
          const rows = db.prepare("SELECT * FROM payroll_submissions ORDER BY datetime(submitted_at) DESC, created_at DESC").all() as any[];
          return res.json(rows.map(serializePayrollSubmission));
        }

        const user = sessionUserId
          ? db.prepare("SELECT id, email, client_id FROM users WHERE id = ?").get(sessionUserId) as any
          : null;

        if (!user) {
          return res.status(401).json({ error: 'Unauthorized' });
        }

        if (!user.client_id) {
          const rows = db.prepare("SELECT * FROM payroll_submissions ORDER BY datetime(submitted_at) DESC, created_at DESC").all() as any[];
          return res.json(rows.map(serializePayrollSubmission));
        }

        const client = db.prepare("SELECT id, name FROM clients WHERE id = ?").get(user.client_id) as any;
        if (!client) {
          return res.json([]);
        }

        const rows = db.prepare(`
          SELECT * FROM payroll_submissions
          WHERE client_id = ? OR client_name = ?
          ORDER BY datetime(submitted_at) DESC, created_at DESC
        `).all(client.id, client.name) as any[];
        return res.json(rows.map(serializePayrollSubmission));
      } catch (error) {
        console.error('Failed to load payroll submissions:', error);
        return res.status(500).json({ error: 'Failed to load payroll submissions' });
      }
    }

    try {
      const user = await fetchSupabaseUserById(sessionUserId);

      let query = supabaseAdmin
        .from('payroll_submissions')
        .select('*')
        .order('submitted_at', { ascending: false });

      if (sessionRole !== 'superadmin') {
        if (!user) {
          return res.status(401).json({ error: 'Unauthorized' });
        }
        if (user.client_id) {
          query = query.eq('client_id', user.client_id);
        }
      }

      const { data, error } = await query;
      if (error) throw error;
      return res.json((data || []).map(serializePayrollSubmission));
    } catch (error) {
      console.error('Failed to load payroll submissions from Supabase:', error);
      return res.status(500).json({ error: 'Failed to load payroll submissions' });
    }
  });

  app.post("/api/payroll-submissions", ensureFileAccess, async (req, res) => {
    const sessionUserId = (req.session as any)?.userId;
    const sessionEmployeeId = (req.session as any)?.employeeId;
    if (sessionEmployeeId) {
      return res.status(403).json({ error: 'Employees cannot submit payroll' });
    }

    const id = `pay_${Math.random().toString(36).slice(2, 10)}`;
    const submittedAt = String(req.body.submittedAt || new Date().toISOString());
    const submittedBy = String(req.body.submittedBy || '').trim();
    const periodStart = String(req.body.periodStart || '').trim();
    const periodEnd = String(req.body.periodEnd || '').trim();
    const period = String(req.body.period || '').trim();
    const clientNameFromBody = String(req.body.clientName || '').trim();

    if (!submittedBy || !periodStart || !periodEnd || !period) {
      return res.status(400).json({ error: 'Missing required payroll submission fields' });
    }

    const user = env.databaseProvider !== 'supabase'
      ? (sessionUserId ? db.prepare("SELECT id, email, client_id FROM users WHERE id = ?").get(sessionUserId) as any : null)
      : await fetchSupabaseUserById(sessionUserId);
    const effectiveClientId = getEffectiveClientId(env.databaseProvider !== 'supabase' ? db : null, req) || user?.client_id || null;
    const client = env.databaseProvider !== 'supabase'
      ? (effectiveClientId
          ? db.prepare("SELECT id, name, payroll_email, payroll_cc FROM clients WHERE id = ?").get(effectiveClientId) as any
          : (clientNameFromBody
              ? db.prepare("SELECT id, name, payroll_email, payroll_cc FROM clients WHERE name = ?").get(clientNameFromBody) as any
              : null))
      : (effectiveClientId
          ? await fetchSupabaseClientById(effectiveClientId)
          : await fetchSupabaseClientByName(clientNameFromBody));

    const startDate = new Date(`${periodStart}T00:00:00`);
    const endDate = new Date(`${periodEnd}T00:00:00`);
    const missingAssignments: string[] = [];

    if (client?.id) {
      if (env.databaseProvider !== 'supabase') {
        const activeEmployees = db.prepare("SELECT id, first_name, last_name FROM employees WHERE client_id = ? AND COALESCE(status, 'active') != 'offboarded'").all(client.id) as any[];
        for (const emp of activeEmployees) {
          for (let cursor = new Date(startDate); cursor <= endDate; cursor.setDate(cursor.getDate() + 1)) {
            const dayIso = toLocalIsoDate(cursor);
            const row: any = db.prepare("SELECT shift_id FROM roster WHERE employee_id = ? AND day_date = ?").get(emp.id, dayIso);
            if (!row?.shift_id) {
              missingAssignments.push(`${emp.first_name} ${emp.last_name}`.trim() + ` on ${dayIso}`);
              break;
            }
          }
          if (missingAssignments.length > 0) break;
        }
      } else {
        const { data: employeeRows, error: employeeError } = await supabaseAdmin
          .from('employees')
          .select('id, first_name, last_name, status')
          .eq('client_id', client.id);
        if (employeeError) {
          console.error('Failed to load employees for payroll submission:', employeeError);
          return res.status(500).json({ error: 'Failed to validate payroll submission' });
        }
        const activeEmployees = (employeeRows || []).filter((emp: any) => String(emp.status || 'active').toLowerCase() !== 'offboarded');
        const employeeIds = activeEmployees.map((emp: any) => emp.id);
        const { data: rosterRows, error: rosterError } = employeeIds.length
          ? await supabaseAdmin
              .from('roster')
              .select('employee_id, day_date, shift_id')
              .in('employee_id', employeeIds)
              .gte('day_date', periodStart)
              .lte('day_date', periodEnd)
          : { data: [], error: null } as any;
        if (rosterError) {
          console.error('Failed to load roster rows for payroll submission:', rosterError);
          return res.status(500).json({ error: 'Failed to validate payroll submission' });
        }
        const rosterMap = new Map<string, Set<string>>();
        for (const row of rosterRows || []) {
          if (!row?.shift_id) continue;
          const current = rosterMap.get(row.employee_id) || new Set<string>();
          current.add(String(row.day_date));
          rosterMap.set(row.employee_id, current);
        }
        for (const emp of activeEmployees as any[]) {
          for (let cursor = new Date(startDate); cursor <= endDate; cursor.setDate(cursor.getDate() + 1)) {
            const dayIso = toLocalIsoDate(cursor);
            if (!rosterMap.get(emp.id)?.has(dayIso)) {
              missingAssignments.push(`${emp.first_name} ${emp.last_name}`.trim() + ` on ${dayIso}`);
              break;
            }
          }
          if (missingAssignments.length > 0) break;
        }
      }
    }
    if (missingAssignments.length > 0) {
      return res.status(400).json({ error: `Cannot submit payroll while roster has empty shifts. First missing shift: ${missingAssignments[0]}.` });
    }

    const clientId = client?.id || null;
    const clientName = client?.name || clientNameFromBody || 'Your Company';
    const employeeBreakdown = Array.isArray(req.body.employeeBreakdown) ? req.body.employeeBreakdown : [];
    const employeeCount = Number(req.body.employeeCount || 0);
    const submissionStatus = String(req.body.status || 'pending');
    const totalHours = Number(req.body.totalHours || 0);
    const totalPay = Number(req.body.totalPay || 0);

    if (env.databaseProvider !== 'supabase') {
      db.prepare(`
        INSERT INTO payroll_submissions (
          id, client_id, client_name, submitted_by, submitted_by_email, submitted_at,
          period_start, period_end, period_label, employee_count, status,
          total_hours, total_pay, breakdown_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(
        id, clientId, clientName, submittedBy, user?.email || null, submittedAt,
        periodStart, periodEnd, period, employeeCount, submissionStatus,
        totalHours, totalPay, JSON.stringify(employeeBreakdown),
      );
    } else {
      const { error: insertError } = await supabaseAdmin.from('payroll_submissions').insert({
        id,
        client_id: clientId,
        client_name: clientName,
        submitted_by: submittedBy,
        submitted_by_email: user?.email || null,
        submitted_at: submittedAt,
        period_start: periodStart,
        period_end: periodEnd,
        period,
        employee_count: employeeCount,
        status: submissionStatus,
        total_hours: totalHours,
        total_pay: totalPay,
        employee_breakdown: employeeBreakdown,
      });
      if (insertError) {
        console.error('Failed to insert payroll submission into Supabase:', insertError);
        return res.status(500).json({ error: 'Failed to save payroll submission' });
      }
    }

    let mailResult: { sent: boolean; queued?: boolean; jobId?: string; error?: string } = { sent: false };
    const payrollEmail = String(client?.payroll_email || '').trim();
    const payrollCc = String(client?.payroll_cc || '').trim();
    console.log('[PAYROLL MAIL] Evaluating payroll mail send', {
      payrollSubmissionId: id,
      sessionUserId: sessionUserId || null,
      effectiveClientId: effectiveClientId || null,
      clientId,
      clientName,
      smtpConfigured: isSmtpConfigured,
      payrollEmail: payrollEmail || null,
      payrollCc: payrollCc || null,
      employeeCount,
      totalHours,
      totalPay,
      asyncMode: env.payrollEmailAsync,
    });
    if (!isSmtpConfigured) {
      console.warn('[PAYROLL MAIL] Skipped because SMTP is not configured');
      mailResult = { sent: false, error: 'SMTP not configured' };
    } else if (!payrollEmail) {
      console.warn('[PAYROLL MAIL] Skipped because client payroll email is blank');
      mailResult = { sent: false, error: 'Client payroll email is blank' };
    } else if (env.payrollEmailAsync) {
      try {
        const queuedJob = await enqueueBackgroundJob({
          jobType: 'payroll_submission_email',
          payload: {
            payrollSubmissionId: id,
            clientId,
            clientName,
            payrollEmail,
            payrollCc,
          },
        });
        mailResult = { sent: false, queued: true, jobId: queuedJob.id };
      } catch (error: any) {
        console.error('[PAYROLL MAIL] Failed to queue payroll submission email:', error);
        mailResult = { sent: false, error: error?.message || 'Failed to queue payroll email' };
      }
    } else {
      try {
        console.log('[PAYROLL MAIL] Sending payroll submission email now');
        let attachmentEmployees: any[] = [];
        let attachmentShifts: any[] = [];
        let attachmentRoster: any[] = [];
        let attachmentRosterMeta: any[] = [];

        if (env.databaseProvider !== 'supabase') {
          attachmentEmployees = clientId
            ? db.prepare(`SELECT * FROM employees WHERE client_id = ? ORDER BY first_name, last_name`).all(clientId)
            : [];
          attachmentShifts = db.prepare(`SELECT * FROM shifts ORDER BY label`).all();
          attachmentRoster = clientId
            ? db.prepare(`
                SELECT r.*
                FROM roster r
                INNER JOIN employees e ON e.id = r.employee_id
                WHERE e.client_id = ?
                  AND r.day_date >= ?
                  AND r.day_date <= ?
                ORDER BY r.employee_id, r.day_date
              `).all(clientId, periodStart, periodEnd)
            : [];
          attachmentRosterMeta = clientId
            ? db.prepare(`
                SELECT rm.*
                FROM roster_meta rm
                INNER JOIN employees e ON e.id = rm.employee_id
                WHERE e.client_id = ?
              `).all(clientId)
            : [];
        } else if (clientId) {
          const { data: employeesData, error: employeesError } = await supabaseAdmin
            .from('employees')
            .select('*')
            .eq('client_id', clientId)
            .order('first_name', { ascending: true })
            .order('last_name', { ascending: true });
          if (employeesError) throw employeesError;
          attachmentEmployees = employeesData || [];

          const { data: shiftsData, error: shiftsError } = await supabaseAdmin
            .from('shifts')
            .select('*')
            .order('label', { ascending: true });
          if (shiftsError) throw shiftsError;
          attachmentShifts = shiftsData || [];

          const employeeIds = attachmentEmployees.map((row: any) => row.id).filter(Boolean);
          if (employeeIds.length > 0) {
            const { data: rosterData, error: rosterError } = await supabaseAdmin
              .from('roster')
              .select('*')
              .in('employee_id', employeeIds)
              .gte('day_date', periodStart)
              .lte('day_date', periodEnd)
              .order('employee_id', { ascending: true })
              .order('day_date', { ascending: true });
            if (rosterError) throw rosterError;
            attachmentRoster = rosterData || [];

            const uniqueWeekStarts = [...new Set((employeeBreakdown || [])
              .map((row: any) => String(row?.weekStart || row?.week_start || '').trim())
              .filter(Boolean))];
            if (uniqueWeekStarts.length > 0) {
              const { data: rosterMetaData, error: rosterMetaError } = await supabaseAdmin
                .from('roster_meta')
                .select('*')
                .in('employee_id', employeeIds)
                .in('week_start', uniqueWeekStarts);
              if (rosterMetaError) throw rosterMetaError;
              attachmentRosterMeta = rosterMetaData || [];
            }
          }
        }

        const attachments = buildRosterAndTimesheetAttachments({
          clientName,
          periodStart,
          periodEnd,
          employeeBreakdown,
        }, {
          employees: attachmentEmployees,
          shifts: attachmentShifts,
          roster: attachmentRoster,
          rosterMeta: attachmentRosterMeta,
        });

        await sendPayrollSubmissionEmail({
          clientName,
          periodLabel: period,
          submittedBy,
          submittedByEmail: user?.email || null,
          payrollEmail,
          payrollCc,
          employeeCount,
          totalHours,
          totalPay,
          employeeBreakdown,
          attachments,
        });
        console.log('[PAYROLL MAIL] Payroll submission email sent successfully');
        setLastMailEvent({ at: new Date().toISOString(), kind: 'payroll', ok: true, to: payrollEmail, subject: `${clientName} Payroll Submission - ${period}`, response: 'Payroll submission email sent' });
        mailResult = { sent: true };
      } catch (error: any) {
        console.error('[PAYROLL MAIL] Failed to send payroll submission email:', error);
        setLastMailEvent({ at: new Date().toISOString(), kind: 'payroll', ok: false, to: payrollEmail, subject: `${clientName} Payroll Submission - ${period}`, error: error?.message || 'Unknown email error' });
        mailResult = { sent: false, error: error?.message || 'Failed to send payroll email' };
      }
    }

    let row: any = null;
    if (env.databaseProvider !== 'supabase') {
      row = db.prepare("SELECT * FROM payroll_submissions WHERE id = ?").get(id) as any;
    } else {
      const { data, error } = await supabaseAdmin.from('payroll_submissions').select('*').eq('id', id).single();
      if (error) {
        console.error('Failed to fetch inserted payroll submission from Supabase:', error);
        return res.status(201).json({ id, clientName, submittedBy, submittedAt, periodStart, periodEnd, period, employeeCount, status: submissionStatus, totalHours, totalPay, employeeBreakdown, mail: mailResult });
      }
      row = data;
    }

    logActivity(req, 'CREATE_PAYROLL_SUBMISSION', {
      payrollSubmissionId: id,
      clientId,
      clientName,
      submittedBy,
      submittedByEmail: user?.email || null,
      periodStart,
      periodEnd,
      periodLabel: period,
      employeeCount,
      status: submissionStatus,
      totalHours,
      totalPay,
      payrollEmail,
      payrollCc,
      payrollMailSent: mailResult.sent,
      payrollMailQueued: Boolean(mailResult.queued),
      payrollMailJobId: mailResult.jobId || null,
      payrollEmailError: mailResult.error || null,
    });
    return res.status(201).json({ ...serializePayrollSubmission(row), mail: mailResult });
  });

  app.put("/api/payroll-submissions/:id/status", ensureFileAccess, async (req, res) => {
    const id = req.params.id;
    const nextStatus = String(req.body.status || '').trim();
    const sessionUserId = (req.session as any)?.userId;
    const sessionRole = (req.session as any)?.userRole;

    if (!['pending', 'processed', 'archived'].includes(nextStatus)) {
      return res.status(400).json({ error: 'Invalid payroll submission status' });
    }

    const actingUser = env.databaseProvider !== 'supabase'
      ? (sessionUserId ? db.prepare("SELECT id, email, client_id FROM users WHERE id = ?").get(sessionUserId) as any : null)
      : await fetchSupabaseUserById(sessionUserId);

    if (env.databaseProvider !== 'supabase') {
      const existing = db.prepare("SELECT * FROM payroll_submissions WHERE id = ?").get(id) as any;
      if (!existing) {
        return res.status(404).json({ error: 'Payroll submission not found' });
      }

      if (sessionRole !== 'superadmin' && actingUser?.client_id) {
        const client = db.prepare("SELECT id, name FROM clients WHERE id = ?").get(actingUser.client_id) as any;
        const sameClient = client && (existing.client_id === client.id || existing.client_name === client.name);
        if (!sameClient) {
          return res.status(403).json({ error: 'Forbidden' });
        }
      }

      const processedBy = nextStatus === 'processed' ? (actingUser?.email || existing.processed_by || 'System Admin') : null;
      const processedByEmail = nextStatus === 'processed' ? (actingUser?.email || existing.processed_by_email || null) : null;
      const processedAt = nextStatus === 'processed' ? new Date().toISOString() : null;

      db.prepare(`
        UPDATE payroll_submissions
        SET status = ?, processed_by = ?, processed_by_email = ?, processed_at = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(nextStatus, processedBy, processedByEmail, processedAt, id);

      const row = db.prepare("SELECT * FROM payroll_submissions WHERE id = ?").get(id) as any;
      logActivity(req, 'UPDATE_PAYROLL_SUBMISSION_STATUS', { payrollSubmissionId: id, status: nextStatus });
      return res.json(serializePayrollSubmission(row));
    }

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('payroll_submissions')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !existing) {
      return res.status(404).json({ error: 'Payroll submission not found' });
    }

    if (sessionRole !== 'superadmin' && actingUser?.client_id && existing.client_id !== actingUser.client_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const processedBy = nextStatus === 'processed' ? (actingUser?.email || existing.processed_by || 'System Admin') : null;
    const processedByEmail = nextStatus === 'processed' ? (actingUser?.email || existing.processed_by_email || null) : null;
    const processedAt = nextStatus === 'processed' ? new Date().toISOString() : null;

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('payroll_submissions')
      .update({
        status: nextStatus,
        processed_by: processedBy,
        processed_by_email: processedByEmail,
        processed_at: processedAt,
      })
      .eq('id', id)
      .select('*')
      .single();

    if (updateError || !updated) {
      console.error('Failed to update payroll submission in Supabase:', updateError);
      return res.status(500).json({ error: 'Failed to update payroll submission' });
    }

    logActivity(req, 'UPDATE_PAYROLL_SUBMISSION_STATUS', { payrollSubmissionId: id, status: nextStatus });
    return res.json(serializePayrollSubmission(updated));
  });

  app.get("/api/support-tickets", ensureFileAccess, async (req, res) => {
    const sessionEmployeeId = (req.session as any)?.employeeId;
    if (sessionEmployeeId) {
      return res.json([]);
    }

    const sessionUserId = (req.session as any)?.userId;
    const sessionRole = (req.session as any)?.userRole;
    const actingUser = env.databaseProvider !== 'supabase'
      ? (sessionUserId ? db.prepare("SELECT id, email, client_id FROM users WHERE id = ?").get(sessionUserId) as any : null)
      : await fetchSupabaseUserById(sessionUserId);

    if (env.databaseProvider !== 'supabase') {
      if (sessionRole === 'superadmin' && !actingUser?.client_id) {
        const rows = db.prepare("SELECT * FROM support_tickets ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC").all();
        return res.json(rows);
      }
      const effectiveClientId = getEffectiveClientId(db, req) || actingUser?.client_id || null;
      if (!effectiveClientId) return res.json([]);
      const client = db.prepare("SELECT id, name FROM clients WHERE id = ?").get(effectiveClientId) as any;
      if (!client) return res.json([]);
      const rows = db.prepare(`SELECT * FROM support_tickets WHERE client_id = ? OR client_name = ? ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC`).all(client.id, client.name);
      return res.json(rows);
    }

    try {
      let query = supabaseAdmin.from('support_tickets').select('*').order('updated_at', { ascending: false }).order('created_at', { ascending: false });
      if (!(sessionRole === 'superadmin' && !actingUser?.client_id)) {
        const effectiveClientId = getEffectiveClientId(env.databaseProvider !== 'supabase' ? db : null, req) || actingUser?.client_id || null;
        if (!effectiveClientId) return res.json([]);
        query = query.eq('client_id', effectiveClientId);
      }
      const { data, error } = await query;
      if (error) throw error;
      return res.json(data || []);
    } catch (error) {
      console.error('Failed to load support tickets:', error);
      return res.status(500).json({ error: 'Failed to load support tickets' });
    }
  });

  app.post("/api/support-tickets", ensureFileAccess, async (req, res) => {
    const id = `ticket_${Math.random().toString(36).slice(2, 10)}`;
    const userId = (req.session as any)?.userId || null;
    const userEmail = String(req.body.user_email || req.body.userEmail || '').trim() || 'unknown@sightfull.local';
    const subject = String(req.body.subject || '').trim();
    const message = String(req.body.message || '').trim();
    const priority = String(req.body.priority || 'medium');
    const clientId = req.body.client_id || req.body.clientId || null;
    const clientName = req.body.client_name || req.body.clientName || null;
    if (!subject || !message) return res.status(400).json({ error: 'Subject and message are required' });

    try {
      if (env.databaseProvider !== 'supabase') {
        db.prepare(`INSERT INTO support_tickets (id, client_id, client_name, user_id, user_email, subject, message, status, priority, admin_notes, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
          .run(id, clientId, clientName, userId, userEmail, subject, message, priority);
        const ticket = db.prepare("SELECT * FROM support_tickets WHERE id = ?").get(id);
        logActivity(req, 'CREATE_SUPPORT_TICKET', { ticketId: id, subject, priority, clientId });
        return res.json(ticket);
      }

      const { data, error } = await supabaseAdmin.from('support_tickets').insert({
        id, client_id: clientId, client_name: clientName, user_id: userId, user_email: userEmail,
        subject, message, status: 'open', priority, admin_notes: '',
      }).select('*').single();
      if (error) throw error;
      logActivity(req, 'CREATE_SUPPORT_TICKET', { ticketId: id, subject, priority, clientId });
      return res.json(data);
    } catch (error) {
      console.error('Failed to create support ticket:', error);
      return res.status(500).json({ error: 'Failed to create support ticket' });
    }
  });

  app.patch("/api/support-tickets/:id", isSuperAdmin, async (req, res) => {
    try {
      if (env.databaseProvider !== 'supabase') {
        const existing = db.prepare("SELECT * FROM support_tickets WHERE id = ?").get(req.params.id) as any;
        if (!existing) return res.status(404).json({ error: 'Support ticket not found' });
        db.prepare(`UPDATE support_tickets SET status = ?, priority = ?, admin_notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .run(req.body.status ?? existing.status, req.body.priority ?? existing.priority, req.body.admin_notes ?? existing.admin_notes ?? '', req.params.id);
        const ticket = db.prepare("SELECT * FROM support_tickets WHERE id = ?").get(req.params.id);
        logActivity(req, 'UPDATE_SUPPORT_TICKET', { ticketId: req.params.id, status: req.body.status ?? existing.status });
        return res.json(ticket);
      }

      const { data: existing, error: fetchError } = await supabaseAdmin.from('support_tickets').select('*').eq('id', req.params.id).single();
      if (fetchError || !existing) return res.status(404).json({ error: 'Support ticket not found' });

      const { data, error } = await supabaseAdmin.from('support_tickets').update({
        status: req.body.status ?? existing.status,
        priority: req.body.priority ?? existing.priority,
        admin_notes: req.body.admin_notes ?? existing.admin_notes ?? '',
      }).eq('id', req.params.id).select('*').single();
      if (error || !data) throw error;
      logActivity(req, 'UPDATE_SUPPORT_TICKET', { ticketId: req.params.id, status: req.body.status ?? existing.status });
      return res.json(data);
    } catch (error) {
      console.error('Failed to update support ticket:', error);
      return res.status(500).json({ error: 'Failed to update support ticket' });
    }
  });
}
