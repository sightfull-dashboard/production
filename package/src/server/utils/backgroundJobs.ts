import { randomUUID } from 'node:crypto';
import { env } from '../config/env';
import { db } from '../db/index';
import { supabaseAdmin } from '../integrations/supabase';

export type BackgroundJobType = 'payroll_submission_email';
export type BackgroundJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export type BackgroundJobRecord = {
  id: string;
  job_type: BackgroundJobType;
  status: BackgroundJobStatus;
  payload: any;
  result: any;
  attempts: number;
  max_attempts: number;
  available_at: string;
  locked_at: string | null;
  locked_by: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
};

const STALE_LOCK_MS = 15 * 60 * 1000;
const nowIso = () => new Date().toISOString();
const parseJson = (value: any, fallback: any = null) => {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const normalizeRow = (row: any): BackgroundJobRecord | null => {
  if (!row) return null;
  return {
    id: String(row.id),
    job_type: String(row.job_type) as BackgroundJobType,
    status: String(row.status) as BackgroundJobStatus,
    payload: parseJson(row.payload),
    result: parseJson(row.result),
    attempts: Number(row.attempts || 0),
    max_attempts: Number(row.max_attempts || 3),
    available_at: String(row.available_at || row.created_at || nowIso()),
    locked_at: row.locked_at ? String(row.locked_at) : null,
    locked_by: row.locked_by ? String(row.locked_by) : null,
    last_error: row.last_error ? String(row.last_error) : null,
    created_at: String(row.created_at || nowIso()),
    updated_at: String(row.updated_at || nowIso()),
    finished_at: row.finished_at ? String(row.finished_at) : null,
  };
};

const resolveJobClientId = (job: Partial<BackgroundJobRecord> & { payload?: any }) => {
  const payload = parseJson((job as any)?.payload, {});
  const direct = payload?.clientId ?? payload?.client_id ?? null;
  return direct ? String(direct) : null;
};

const resolveJobClientName = (job: Partial<BackgroundJobRecord> & { payload?: any }) => {
  const payload = parseJson((job as any)?.payload, {});
  const direct = payload?.clientName ?? payload?.client_name ?? null;
  return direct ? String(direct) : null;
};

const resolveJobActor = (job: Partial<BackgroundJobRecord> & { payload?: any }) => {
  const payload = parseJson((job as any)?.payload, {});
  return {
    userId: payload?.requestedByUserId ? String(payload.requestedByUserId) : null,
    userEmail: payload?.requestedByEmail ? String(payload.requestedByEmail) : null,
  };
};

const insertActivityLogRow = async (input: {
  clientId: string | null;
  action: string;
  details?: Record<string, any>;
  userId?: string | null;
  userEmail?: string | null;
  ipAddress?: string | null;
}) => {
  if (!input.clientId) return;
  const row = {
    id: randomUUID(),
    user_id: input.userId || null,
    user_email: input.userEmail || 'System/Worker',
    action: input.action,
    details: JSON.stringify(input.details || {}),
    ip_address: input.ipAddress || 'worker',
    client_id: input.clientId,
    created_at: nowIso(),
  };

  if (env.databaseProvider !== 'supabase') {
    db.prepare(`
      INSERT INTO activity_logs (id, user_id, user_email, action, details, ip_address, client_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(row.id, row.user_id, row.user_email, row.action, row.details, row.ip_address, row.client_id);
    return;
  }

  if (!supabaseAdmin) throw new Error('Supabase is not configured for activity logging.');
  const { error } = await supabaseAdmin.from('activity_logs').insert(row);
  if (error) throw error;
};

const logWorkerJobEvent = async (
  action: string,
  job: Partial<BackgroundJobRecord> & { payload?: any },
  extraDetails: Record<string, any> = {},
  options: { userId?: string | null; userEmail?: string | null; ipAddress?: string | null } = {},
) => {
  try {
    const clientId = resolveJobClientId(job);
    if (!clientId) return;
    const clientName = resolveJobClientName(job);
    const actor = resolveJobActor(job);
    const payload = parseJson((job as any)?.payload, {});
    await insertActivityLogRow({
      clientId,
      action,
      userId: options.userId ?? actor.userId ?? null,
      userEmail: options.userEmail ?? actor.userEmail ?? null,
      ipAddress: options.ipAddress ?? 'worker',
      details: {
        jobId: job.id || null,
        jobType: job.job_type || null,
        clientName,
        payrollSubmissionId: payload?.payrollSubmissionId || null,
        attempts: job.attempts ?? null,
        maxAttempts: job.max_attempts ?? null,
        status: job.status || null,
        ...extraDetails,
      },
    });
  } catch (error) {
    console.warn('[WORKER LOGS] Failed to write worker activity log:', error instanceof Error ? error.message : error);
  }
};

export const ensureBackgroundJobTables = async () => {
  if (env.databaseProvider === 'supabase') return;
  db.prepare(`
    CREATE TABLE IF NOT EXISTS background_jobs (
      id TEXT PRIMARY KEY,
      job_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      payload TEXT,
      result TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      available_at TEXT NOT NULL,
      locked_at TEXT,
      locked_by TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT
    )
  `).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_background_jobs_status_available ON background_jobs(status, available_at, created_at)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_background_jobs_locked_at ON background_jobs(locked_at)`).run();
};

export const enqueueBackgroundJob = async (input: {
  jobType: BackgroundJobType;
  payload: any;
  availableAt?: string;
  maxAttempts?: number;
}) => {
  const id = randomUUID();
  const now = nowIso();
  const row = {
    id,
    job_type: input.jobType,
    status: 'queued',
    payload: input.payload ?? null,
    result: null,
    attempts: 0,
    max_attempts: Math.max(1, Number(input.maxAttempts || env.workerMaxAttempts || 3)),
    available_at: input.availableAt || now,
    locked_at: null,
    locked_by: null,
    last_error: null,
    created_at: now,
    updated_at: now,
    finished_at: null,
  };

  if (env.databaseProvider !== 'supabase') {
    await ensureBackgroundJobTables();
    db.prepare(`
      INSERT INTO background_jobs (
        id, job_type, status, payload, result, attempts, max_attempts,
        available_at, locked_at, locked_by, last_error, created_at, updated_at, finished_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.id,
      row.job_type,
      row.status,
      JSON.stringify(row.payload),
      null,
      row.attempts,
      row.max_attempts,
      row.available_at,
      null,
      null,
      null,
      row.created_at,
      row.updated_at,
      null,
    );
    return normalizeRow(row)!;
  }

  if (!supabaseAdmin) throw new Error('Supabase is not configured for background jobs.');
  const { data, error } = await supabaseAdmin
    .from('background_jobs')
    .insert({
      id: row.id,
      job_type: row.job_type,
      status: row.status,
      payload: row.payload,
      result: null,
      attempts: row.attempts,
      max_attempts: row.max_attempts,
      available_at: row.available_at,
      locked_at: null,
      locked_by: null,
      last_error: null,
      created_at: row.created_at,
      updated_at: row.updated_at,
      finished_at: null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return normalizeRow(data)!;
};

export const claimNextBackgroundJob = async (workerId: string, allowedTypes?: BackgroundJobType[]) => {
  const now = new Date();
  const staleBeforeIso = new Date(now.getTime() - STALE_LOCK_MS).toISOString();
  const nowIsoValue = now.toISOString();
  const allowedList = Array.isArray(allowedTypes) && allowedTypes.length > 0 ? allowedTypes : null;

  if (env.databaseProvider !== 'supabase') {
    await ensureBackgroundJobTables();
    const claimTransaction = db.transaction(() => {
      let sql = `
        SELECT *
        FROM background_jobs
        WHERE (
          (status = 'queued' AND available_at <= ?)
          OR (status = 'running' AND locked_at IS NOT NULL AND locked_at <= ?)
        )
      `;
      const params: any[] = [nowIsoValue, staleBeforeIso];
      if (allowedList) {
        sql += ` AND job_type IN (${allowedList.map(() => '?').join(', ')})`;
        params.push(...allowedList);
      }
      sql += ` ORDER BY created_at ASC LIMIT 1`;
      const row = db.prepare(sql).get(...params) as any;
      if (!row) return null;
      db.prepare(`
        UPDATE background_jobs
        SET status = 'running',
            attempts = COALESCE(attempts, 0) + 1,
            locked_at = ?,
            locked_by = ?,
            updated_at = ?,
            last_error = NULL
        WHERE id = ?
      `).run(nowIsoValue, workerId, nowIsoValue, row.id);
      const updated = db.prepare(`SELECT * FROM background_jobs WHERE id = ?`).get(row.id) as any;
      return normalizeRow(updated);
    });
    const claimed = claimTransaction();
    if (claimed) {
      await logWorkerJobEvent('WORKER_TASK_STARTED', claimed, { workerId }, { userEmail: 'System/Worker' });
    }
    return claimed;
  }

  if (!supabaseAdmin) throw new Error('Supabase is not configured for background jobs.');
  const { data, error } = await supabaseAdmin.rpc('claim_background_job', {
    p_worker_id: workerId,
    p_allowed_types: allowedList,
  });
  if (error) {
    throw new Error(`Supabase background worker claim failed. Run BACKGROUND_WORKER_TABLES.sql first. ${error.message}`);
  }
  const row = Array.isArray(data) ? data[0] : data;
  const normalized = normalizeRow(row);
  if (normalized) {
    await logWorkerJobEvent('WORKER_TASK_STARTED', normalized, { workerId }, { userEmail: 'System/Worker' });
  }
  return normalized;
};

export const markBackgroundJobCompleted = async (job: BackgroundJobRecord, result: any = null) => {
  const now = nowIso();
  if (env.databaseProvider !== 'supabase') {
    await ensureBackgroundJobTables();
    db.prepare(`
      UPDATE background_jobs
      SET status = 'completed',
          result = ?,
          locked_at = NULL,
          locked_by = NULL,
          last_error = NULL,
          finished_at = ?,
          updated_at = ?
      WHERE id = ?
    `).run(JSON.stringify(result ?? null), now, now, job.id);
    await logWorkerJobEvent('WORKER_TASK_COMPLETED', { ...job, status: 'completed', result, finished_at: now, updated_at: now }, {}, { userEmail: 'System/Worker' });
    return;
  }
  if (!supabaseAdmin) throw new Error('Supabase is not configured for background jobs.');
  const { error } = await supabaseAdmin
    .from('background_jobs')
    .update({
      status: 'completed',
      result,
      locked_at: null,
      locked_by: null,
      last_error: null,
      finished_at: now,
      updated_at: now,
    })
    .eq('id', job.id);
  if (error) throw error;
  await logWorkerJobEvent('WORKER_TASK_COMPLETED', { ...job, status: 'completed', result, finished_at: now, updated_at: now }, {}, { userEmail: 'System/Worker' });
};

export const markBackgroundJobFailed = async (job: BackgroundJobRecord, errorMessage: string) => {
  const now = nowIso();
  const attempts = Number(job.attempts || 0);
  const maxAttempts = Number(job.max_attempts || env.workerMaxAttempts || 3);
  const shouldRetry = attempts < maxAttempts;
  const retryDelayMs = Math.min(60_000, Math.max(5_000, attempts * 5_000));
  const nextAvailable = new Date(Date.now() + retryDelayMs).toISOString();
  const nextStatus: BackgroundJobStatus = shouldRetry ? 'queued' : 'failed';
  const finishedAt = shouldRetry ? null : now;

  if (env.databaseProvider !== 'supabase') {
    await ensureBackgroundJobTables();
    db.prepare(`
      UPDATE background_jobs
      SET status = ?,
          available_at = ?,
          locked_at = NULL,
          locked_by = NULL,
          last_error = ?,
          finished_at = ?,
          updated_at = ?
      WHERE id = ?
    `).run(nextStatus, shouldRetry ? nextAvailable : job.available_at, errorMessage, finishedAt, now, job.id);
    await logWorkerJobEvent(shouldRetry ? 'WORKER_TASK_RETRY_SCHEDULED' : 'WORKER_TASK_FAILED', {
      ...job,
      status: nextStatus,
      available_at: shouldRetry ? nextAvailable : job.available_at,
      last_error: errorMessage,
      finished_at: finishedAt,
      updated_at: now,
    }, { error: errorMessage, retryScheduledFor: shouldRetry ? nextAvailable : null }, { userEmail: 'System/Worker' });
    return;
  }
  if (!supabaseAdmin) throw new Error('Supabase is not configured for background jobs.');
  const { error } = await supabaseAdmin
    .from('background_jobs')
    .update({
      status: nextStatus,
      available_at: shouldRetry ? nextAvailable : job.available_at,
      locked_at: null,
      locked_by: null,
      last_error: errorMessage,
      finished_at: finishedAt,
      updated_at: now,
    })
    .eq('id', job.id);
  if (error) throw error;
  await logWorkerJobEvent(shouldRetry ? 'WORKER_TASK_RETRY_SCHEDULED' : 'WORKER_TASK_FAILED', {
    ...job,
    status: nextStatus,
    available_at: shouldRetry ? nextAvailable : job.available_at,
    last_error: errorMessage,
    finished_at: finishedAt,
    updated_at: now,
  }, { error: errorMessage, retryScheduledFor: shouldRetry ? nextAvailable : null }, { userEmail: 'System/Worker' });
};

export const getBackgroundJobById = async (jobId: string) => {
  if (env.databaseProvider !== 'supabase') {
    await ensureBackgroundJobTables();
    const row = db.prepare(`SELECT * FROM background_jobs WHERE id = ?`).get(jobId) as any;
    return normalizeRow(row);
  }
  if (!supabaseAdmin) throw new Error('Supabase is not configured for background jobs.');
  const { data, error } = await supabaseAdmin
    .from('background_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle();
  if (error) throw error;
  return normalizeRow(data);
};

export const listRecentBackgroundJobs = async (limit = 50) => {
  const safeLimit = Math.max(1, Math.min(200, Number(limit || 50)));
  if (env.databaseProvider !== 'supabase') {
    await ensureBackgroundJobTables();
    const rows = db.prepare(`SELECT * FROM background_jobs ORDER BY created_at DESC LIMIT ?`).all(safeLimit) as any[];
    return rows.map((row) => normalizeRow(row)).filter(Boolean) as BackgroundJobRecord[];
  }
  if (!supabaseAdmin) throw new Error('Supabase is not configured for background jobs.');
  const { data, error } = await supabaseAdmin
    .from('background_jobs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(safeLimit);
  if (error) throw error;
  return (data || []).map((row) => normalizeRow(row)).filter(Boolean) as BackgroundJobRecord[];
};

export const pruneCompletedBackgroundJobs = async () => {
  const cutoff = new Date(Date.now() - (env.workerRetentionHours * 60 * 60 * 1000)).toISOString();
  if (env.databaseProvider !== 'supabase') {
    await ensureBackgroundJobTables();
    db.prepare(`DELETE FROM background_jobs WHERE finished_at IS NOT NULL AND finished_at <= ?`).run(cutoff);
    return;
  }
  if (!supabaseAdmin) throw new Error('Supabase is not configured for background jobs.');
  const { error } = await supabaseAdmin
    .from('background_jobs')
    .delete()
    .not('finished_at', 'is', null)
    .lte('finished_at', cutoff);
  if (error) throw error;
};
