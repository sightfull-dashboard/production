import { env, isSmtpConfigured } from '../config/env';
import { db } from '../db/index';
import { supabaseAdmin } from '../integrations/supabase';
import { buildRosterAndTimesheetAttachments, sendPayrollSubmissionEmail } from '../utils/payrollMail';
import { setLastMailEvent } from '../integrations/mailer';
import type { BackgroundJobRecord } from '../utils/backgroundJobs';

const BASE_ROSTER_DEFINITIONS = ['salary_advance', 'shortages', 'unpaid_hours', 'staff_loan', 'notes'] as const;
const mergeDefinitions = (definitions?: string[] | null) => Array.from(new Set([...(definitions || []), ...BASE_ROSTER_DEFINITIONS]));
const toLocalIsoDate = (value: Date) => {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const asArray = (value: any) => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

const loadSqliteSubmissionContext = (submissionId: string) => {
  const submission = db.prepare(`SELECT * FROM payroll_submissions WHERE id = ?`).get(submissionId) as any;
  if (!submission) throw new Error('Payroll submission not found.');
  const client = submission.client_id
    ? db.prepare(`SELECT id, name, payroll_email, payroll_cc, enabled_definitions FROM clients WHERE id = ?`).get(submission.client_id) as any
    : db.prepare(`SELECT id, name, payroll_email, payroll_cc, enabled_definitions FROM clients WHERE name = ?`).get(submission.client_name) as any;
  const employees = submission.client_id
    ? db.prepare(`SELECT * FROM employees WHERE client_id = ? ORDER BY first_name, last_name`).all(submission.client_id) as any[]
    : [];
  const employeeIds = employees.map((row) => row.id).filter(Boolean);
  const shifts = db.prepare(`SELECT * FROM shifts ORDER BY label`).all() as any[];
  const roster = employeeIds.length
    ? db.prepare(`SELECT * FROM roster WHERE employee_id IN (${employeeIds.map(() => '?').join(', ')}) AND day_date >= ? AND day_date <= ? ORDER BY employee_id, day_date`).all(...employeeIds, submission.period_start, submission.period_end) as any[]
    : [];
  const weekStarts = [...new Set(asArray(submission.employee_breakdown || submission.breakdown_json).map((row: any) => String(row?.weekStart || row?.week_start || '').trim()).filter(Boolean))];
  const rosterMeta = employeeIds.length && weekStarts.length
    ? db.prepare(`SELECT * FROM roster_meta WHERE employee_id IN (${employeeIds.map(() => '?').join(', ')}) AND week_start IN (${weekStarts.map(() => '?').join(', ')})`).all(...employeeIds, ...weekStarts) as any[]
    : [];
  return { submission, client, employees, shifts, roster, rosterMeta };
};

const loadSupabaseSubmissionContext = async (submissionId: string) => {
  if (!supabaseAdmin) throw new Error('Supabase is not configured.');
  const { data: submission, error: submissionError } = await supabaseAdmin
    .from('payroll_submissions')
    .select('*')
    .eq('id', submissionId)
    .single();
  if (submissionError || !submission) throw new Error('Payroll submission not found.');

  let client: any = null;
  if (submission.client_id) {
    const { data } = await supabaseAdmin.from('clients').select('id, name, payroll_email, payroll_cc, enabled_definitions').eq('id', submission.client_id).maybeSingle();
    client = data;
  } else if (submission.client_name) {
    const { data } = await supabaseAdmin.from('clients').select('id, name, payroll_email, payroll_cc, enabled_definitions').eq('name', submission.client_name).maybeSingle();
    client = data;
  }

  const effectiveClientId = submission.client_id || client?.id || null;
  const { data: employeesData, error: employeesError } = effectiveClientId
    ? await supabaseAdmin
        .from('employees')
        .select('*')
        .eq('client_id', effectiveClientId)
        .order('first_name', { ascending: true })
        .order('last_name', { ascending: true })
    : { data: [], error: null } as any;
  if (employeesError) throw employeesError;
  const employees = employeesData || [];
  const employeeIds = employees.map((row: any) => row.id).filter(Boolean);

  const { data: shiftsData, error: shiftsError } = await supabaseAdmin.from('shifts').select('*').order('label', { ascending: true });
  if (shiftsError) throw shiftsError;
  const shifts = shiftsData || [];

  let roster: any[] = [];
  let rosterMeta: any[] = [];
  if (employeeIds.length > 0) {
    const { data: rosterData, error: rosterError } = await supabaseAdmin
      .from('roster')
      .select('*')
      .in('employee_id', employeeIds)
      .gte('day_date', submission.period_start)
      .lte('day_date', submission.period_end)
      .order('employee_id', { ascending: true })
      .order('day_date', { ascending: true });
    if (rosterError) throw rosterError;
    roster = rosterData || [];

    const weekStarts = [...new Set(asArray(submission.employee_breakdown || submission.breakdown_json).map((row: any) => String(row?.weekStart || row?.week_start || '').trim()).filter(Boolean))];
    if (weekStarts.length > 0) {
      const { data: rosterMetaData, error: rosterMetaError } = await supabaseAdmin
        .from('roster_meta')
        .select('*')
        .in('employee_id', employeeIds)
        .in('week_start', weekStarts);
      if (rosterMetaError) throw rosterMetaError;
      rosterMeta = rosterMetaData || [];
    }
  }

  return { submission, client, employees, shifts, roster, rosterMeta };
};

const sendPayrollSubmissionEmailJob = async (job: BackgroundJobRecord) => {
  const submissionId = String(job.payload?.payrollSubmissionId || '').trim();
  if (!submissionId) throw new Error('Missing payrollSubmissionId in job payload.');
  if (!isSmtpConfigured) throw new Error('SMTP not configured.');

  const ctx = env.databaseProvider === 'supabase'
    ? await loadSupabaseSubmissionContext(submissionId)
    : loadSqliteSubmissionContext(submissionId);

  const submission = ctx.submission;
  const clientName = String(ctx.client?.name || submission.client_name || 'Your Company');
  const payrollEmail = String(ctx.client?.payroll_email || '').trim();
  const payrollCc = String(ctx.client?.payroll_cc || '').trim();
  if (!payrollEmail) throw new Error('Client payroll email is blank.');

  const attachments = buildRosterAndTimesheetAttachments({
    clientName,
    periodStart: String(submission.period_start || ''),
    periodEnd: String(submission.period_end || ''),
    employeeBreakdown: asArray(submission.employee_breakdown || submission.breakdown_json),
  }, {
    employees: ctx.employees,
    shifts: ctx.shifts,
    roster: ctx.roster,
    rosterMeta: ctx.rosterMeta,
  }, {
    mergeDefinitions: (definitions?: string[] | null) => mergeDefinitions(definitions || asArray(ctx.client?.enabled_definitions)),
    toLocalIsoDate,
  });

  await sendPayrollSubmissionEmail({
    clientName,
    periodLabel: String(submission.period_label || submission.period || ''),
    submittedBy: String(submission.submitted_by || 'System'),
    submittedByEmail: submission.submitted_by_email || null,
    submittedAt: String(submission.submitted_at || submission.created_at || new Date().toISOString()),
    periodStart: String(submission.period_start || ''),
    periodEnd: String(submission.period_end || ''),
    payrollEmail,
    payrollCc: payrollCc || null,
    employeeCount: Number(submission.employee_count || 0),
    totalHours: Number(submission.total_hours || 0),
    totalPay: Number(submission.total_pay || 0),
    employeeBreakdown: asArray(submission.employee_breakdown || submission.breakdown_json),
    attachments,
  });

  setLastMailEvent({
    at: new Date().toISOString(),
    kind: 'payroll',
    ok: true,
    to: payrollEmail,
    subject: `${clientName} Payroll Submission - ${String(submission.period_label || submission.period || '')}`,
    response: 'Payroll submission email sent by background worker',
  });

  return {
    ok: true,
    payrollSubmissionId: submissionId,
    clientName,
    payrollEmail,
    attachedFiles: attachments.map((item) => item.filename),
  };
};

export const processBackgroundJob = async (job: BackgroundJobRecord) => {
  switch (job.job_type) {
    case 'payroll_submission_email':
      return sendPayrollSubmissionEmailJob(job);
    default:
      throw new Error(`Unsupported background job type: ${job.job_type}`);
  }
};
