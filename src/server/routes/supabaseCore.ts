import bcrypt from 'bcryptjs';
import type { Express } from 'express';
import { supabaseAdmin } from '../integrations/supabase';
import { env } from '../config/env';
import { sortShiftsBaseFirst } from '../../lib/shifts';

const parseJsonArray = (value: any) => Array.isArray(value) ? value : (() => {
  try { return value ? JSON.parse(value) : []; } catch { return []; }
})();

const displayNameFromEmail = (email: string | null | undefined) =>
  String(email || '').split('@')[0].replace(/[._-]+/g, ' ').trim().replace(/\b\w/g, (m) => m.toUpperCase()) || 'User';

const getSessionRole = (req: any) => (req.session as any)?.userRole || null;
const getSessionUserId = (req: any) => (req.session as any)?.userId || null;
const getSessionEmployeeId = (req: any) => (req.session as any)?.employeeId || null;
const getSessionClientId = (req: any) => (req.session as any)?.employeeClientId || null;

const getRequestedClientId = (req: any) => {
  const header = String(req.headers['x-active-client-id'] || '').trim();
  return header || null;
};

async function fetchUserById(id: string) {
  const { data } = await supabaseAdmin.from('users').select('*').eq('id', id).single();
  return data as any;
}

async function fetchUserByEmail(email: string) {
  const { data } = await supabaseAdmin.from('users').select('*').ilike('email', email).limit(1);
  return (data?.[0] || null) as any;
}

async function fetchClientById(id: string | null | undefined) {
  if (!id) return null;
  const { data } = await supabaseAdmin.from('clients').select('*').eq('id', id).single();
  return data as any;
}

async function fetchEmployeeById(id: string) {
  const { data } = await supabaseAdmin.from('employees').select('*').eq('id', id).single();
  return data as any;
}

async function fetchEmployeeByIdentifier(identifier: string) {
  const normalizedIdentifier = identifier.toLowerCase();
  const digits = identifier.replace(/\D/g, '');
  const { data } = await supabaseAdmin.from('employees').select('*').neq('status', 'offboarded');
  const employees = (data || []) as any[];
  return employees.find((emp) => {
    const emailMatch = emp.email && String(emp.email).toLowerCase() === normalizedIdentifier;
    const cellDigits = String(emp.cell ?? '').replace(/\D/g, '');
    const cellMatch = digits.length > 0 && cellDigits === digits;
    const exactCellMatch = emp.cell && String(emp.cell) === identifier;
    return emailMatch || cellMatch || exactCellMatch;
  }) || null;
}

async function listEmployeesForClient(clientId: string | null) {
  let query = supabaseAdmin.from('employees').select('*').order('emp_id', { ascending: true });
  if (clientId) query = query.eq('client_id', clientId);
  const { data, error } = await query;
  if (error) throw error;
  const employees = (data || []) as any[];
  if (employees.length === 0) return employees;
  const ids = employees.map((e) => e.id);
  const { data: rosterRows } = await supabaseAdmin.from('roster').select('employee_id,day_date,shift_id').in('employee_id', ids).not('shift_id', 'is', null);
  const maxMap = new Map<string, string>();
  for (const row of (rosterRows || []) as any[]) {
    const current = maxMap.get(row.employee_id);
    if (!current || String(row.day_date) > current) maxMap.set(row.employee_id, String(row.day_date));
  }
  return employees.map((employee) => ({ ...employee, last_worked_date: maxMap.get(employee.id) || null }));
}

async function nextEmployeeId(clientId: string | null) {
  let query = supabaseAdmin.from('employees').select('emp_id');
  if (clientId) query = query.eq('client_id', clientId);
  const { data, error } = await query;
  if (error) throw error;
  const maxEmp = Math.max(0, ...((data || []).map((row: any) => {
    const match = String(row.emp_id || '').match(/^EMP(\d+)$/i);
    return match ? Number(match[1]) : 0;
  })));
  return `EMP${String(maxEmp + 1).padStart(3, '0')}`;
}


function sanitizeEmployeeForSupabase(payload: Record<string, any>) {
  const next = { ...payload } as Record<string, any>;
  const nullableTextFields = [
    'pin','email','cell','residency','street_number','id_number','passport','bank_name','country_of_issue','province','account_holder','account_no','account_type','tax_number','ismibco','isunion','union_name','address1','address2','address3','address4','postal_code','paye_credit','classification','last_worked','last_worked_date','delete_reason','image'
  ];
  const nullableDateFields = ['last_worked', 'last_worked_date', 'annual_leave_last_accrual_date', 'sick_cycle_start_date'];
  for (const field of nullableTextFields) {
    if (Object.prototype.hasOwnProperty.call(next, field) && next[field] === '') next[field] = null;
  }
  for (const field of nullableDateFields) {
    if (Object.prototype.hasOwnProperty.call(next, field) && (!next[field] || String(next[field]).trim() === '')) next[field] = null;
  }
  return next;
}

async function resolveRequestedClientIdForUser(req: any) {
  const role = getSessionRole(req);
  if (role === 'superadmin') {
    return getRequestedClientId(req) || null;
  }
  const actor = await fetchUserById(getSessionUserId(req));
  return actor?.client_id || null;
}

async function buildAuthResponse(user: any, allowedSuperAdminEmails: Set<string>, mergeDefinitions: (definitions?: string[] | null) => string[], baseRosterDefinitions: readonly string[]) {
  if (!user) return null;
  const normalizedEmail = String(user.email || '').trim().toLowerCase();
  if (allowedSuperAdminEmails.has(normalizedEmail) && user.role !== 'superadmin') {
    const { data } = await supabaseAdmin.from('users').update({ role: 'superadmin', is_verified: true }).eq('id', user.id).select('*').single();
    user = data || { ...user, role: 'superadmin', is_verified: true };
  }
  const client = await fetchClientById(user.client_id);
  const lockedFeatures = user.client_id ? parseJsonArray(client?.locked_features) : [];
  const enabledDefinitions = user.client_id ? mergeDefinitions(parseJsonArray(client?.enabled_definitions)) : [...baseRosterDefinitions];
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    name: user.name || displayNameFromEmail(user.email),
    image: user.image || null,
    fallbackImage: client?.fallback_image || null,
    client_id: user.client_id || null,
    client_name: client?.name || null,
    lockedFeatures,
    enabledDefinitions,
    roster_start_day: client?.roster_start_day ?? 1,
    roster_duration: client?.roster_duration || '1_week',
    rosterMode: client?.roster_mode || 'Manual',
    rosterSeedWeekStart: client?.roster_seed_week_start || null,
    isTrial: Boolean(user.is_trial),
    trialStartedAt: client?.trial_started_at || null,
    trialEndDate: user.trial_end_date || client?.trial_end_date || null,
    trialExpired: false,
    trialDaysRemaining: null,
  };
}

function ensureUser(req: any, res: any) {
  if (!getSessionUserId(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

function ensureUserOrEmployee(req: any, res: any) {
  if (!getSessionUserId(req) && !getSessionEmployeeId(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

export function registerSupabaseCoreRoutes({
  app,
  normalizeEmployeePayload,
  validateEmployeePayload,
  normalizeShiftPayload,
  validateShiftPayload,
  allowedSuperAdminEmails,
  mergeDefinitions,
  baseRosterDefinitions,
  getDatabaseReadiness,
  getSupabaseReadiness,
  getMailerReadiness,
  logActivity,
}: {
  app: Express;
  normalizeEmployeePayload: (data: any) => any;
  validateEmployeePayload: (data: any) => string[];
  normalizeShiftPayload: (data: any) => any;
  validateShiftPayload: (data: any) => string[];
  allowedSuperAdminEmails: Set<string>;
  mergeDefinitions: (definitions?: string[] | null) => string[];
  baseRosterDefinitions: readonly string[];
  getDatabaseReadiness: () => any;
  getSupabaseReadiness: () => any;
  getMailerReadiness: () => any;
  logActivity: (req: any, action: string, details?: any) => void;
}) {
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      environment: env.nodeEnv,
      appUrl: env.appUrl,
      database: getDatabaseReadiness(),
      supabase: getSupabaseReadiness(),
      mailer: getMailerReadiness(),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/system/readiness', (_req, res) => {
    res.json({
      database: getDatabaseReadiness(),
      integrations: { supabase: getSupabaseReadiness(), mailer: getMailerReadiness() },
    });
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const email = String(req.body?.email || '').trim();
      const password = String(req.body?.password || '').trim();
      const user = await fetchUserByEmail(email);
      if (!user || !bcrypt.compareSync(password, user.password)) {
        logActivity(req, 'LOGIN_FAILED', { email });
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      if (!user.is_verified && !allowedSuperAdminEmails.has(String(user.email || '').trim().toLowerCase())) {
        return res.status(403).json({ error: 'Account not verified yet.' });
      }
      (req.session as any).userId = user.id;
      (req.session as any).userRole = allowedSuperAdminEmails.has(String(user.email || '').trim().toLowerCase()) ? 'superadmin' : user.role;
      (req.session as any).userClientId = user.client_id || null;
      await supabaseAdmin.from('users').update({ last_login: new Date().toISOString(), role: (req.session as any).userRole, is_verified: true }).eq('id', user.id);
      const payload = await buildAuthResponse({ ...user, role: (req.session as any).userRole, is_verified: true }, allowedSuperAdminEmails, mergeDefinitions, baseRosterDefinitions);
      logActivity(req, 'LOGIN_SUCCESS', { email: user.email, role: payload?.role, client_id: payload?.client_id || null });
      return res.json(payload);
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Login failed' });
    }
  });

  app.get('/api/auth/me', async (req, res) => {
    const userId = getSessionUserId(req);
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });
    const user = await fetchUserById(userId);
    const payload = await buildAuthResponse(user, allowedSuperAdminEmails, mergeDefinitions, baseRosterDefinitions);
    return res.json(payload);
  });

  app.post('/api/auth/logout', (req, res) => {
    logActivity(req, 'LOGOUT');
    req.session.destroy(() => res.json({ success: true }));
  });

  app.post('/api/employee-auth/login', async (req, res) => {
    try {
      const identifier = String(req.body?.identifier ?? '').trim();
      const pin = String(req.body?.pin ?? '').trim();
      if (!identifier || !pin) return res.status(400).json({ error: 'Identifier and PIN are required' });
      const employee = await fetchEmployeeByIdentifier(identifier);
      if (!employee || String(employee.pin ?? '') !== pin) {
        return res.status(401).json({ error: 'Invalid Email/Phone or PIN' });
      }
      (req.session as any).employeeId = employee.id;
      (req.session as any).employeeClientId = employee.client_id || null;
      return res.json(employee);
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to sign in employee' });
    }
  });

  app.get('/api/employee-auth/me', async (req, res) => {
    const employeeId = getSessionEmployeeId(req);
    if (!employeeId) return res.status(401).json({ error: 'Not authenticated' });
    const employee = await fetchEmployeeById(employeeId);
    if (!employee || employee.status === 'offboarded') return res.status(401).json({ error: 'Employee not found' });
    const client = await fetchClientById(employee.client_id);
    return res.json({ ...employee, fallback_image: client?.fallback_image || null });
  });

  app.post('/api/employee-auth/logout', (req, res) => {
    delete (req.session as any).employeeId;
    delete (req.session as any).employeeClientId;
    res.json({ ok: true });
  });

  app.get('/api/employees', async (req, res) => {
    if (!ensureUser(req, res)) return;
    const role = getSessionRole(req);
    const activeClientId = role === 'superadmin' ? getRequestedClientId(req) : (await fetchUserById(getSessionUserId(req)))?.client_id || null;
    const employees = await listEmployeesForClient(activeClientId);
    res.json(employees);
  });

  app.post('/api/employees', async (req, res) => {
    if (!ensureUser(req, res)) return;
    const actor = await fetchUserById(getSessionUserId(req));
    const actorRole = getSessionRole(req);
    const actorClientId = actorRole === 'superadmin' ? (getRequestedClientId(req) || actor?.client_id || null) : actor?.client_id || null;
    if (!actorClientId) return res.status(400).json({ error: 'No active client dashboard selected.' });
    const data = normalizeEmployeePayload(req.body);
    if (actorRole !== 'superadmin') {
      data.emp_id = await nextEmployeeId(actorClientId);
      data.annual_leave = 0; data.sick_leave = 0; data.family_leave = 0;
    }
    const errors = validateEmployeePayload(data);
    if (errors.length) return res.status(400).json({ error: errors.join(' ') });
    const dupChecks = [
      data.emp_id ? supabaseAdmin.from('employees').select('id').eq('client_id', actorClientId).ilike('emp_id', data.emp_id).limit(1) : null,
      data.email ? supabaseAdmin.from('employees').select('id').eq('client_id', actorClientId).ilike('email', data.email).limit(1) : null,
      data.id_number ? supabaseAdmin.from('employees').select('id').eq('client_id', actorClientId).eq('id_number', data.id_number).limit(1) : null,
      data.tax_number ? supabaseAdmin.from('employees').select('id').eq('client_id', actorClientId).eq('tax_number', data.tax_number).limit(1) : null,
    ].filter(Boolean) as any[];
    const [empDup, emailDup, idDup, taxDup] = await Promise.all(dupChecks);
    if (empDup?.data?.length) return res.status(400).json({ error: 'Employee ID already exists.' });
    if (emailDup?.data?.length) return res.status(400).json({ error: 'Employee email already exists.' });
    if (idDup?.data?.length) return res.status(400).json({ error: 'Employee ID number already exists.' });
    if (taxDup?.data?.length) return res.status(400).json({ error: 'Employee tax number already exists.' });

    const id = Math.random().toString(36).slice(2, 11);
    const { allow_blank_pin: _allowBlankPin, ...persistableData } = data as any;
    const employeePayload = sanitizeEmployeeForSupabase({
      id,
      ...persistableData,
      pin: data.pin || null,
      client_id: actorClientId,
      annual_leave_last_accrual_date: data.start_date,
      sick_cycle_start_date: data.start_date,
    });
    const { error } = await supabaseAdmin.from('employees').insert(employeePayload);
    if (error) return res.status(500).json({ error: error.message });
    logActivity(req, 'CREATE_EMPLOYEE', { emp_id: data.emp_id, name: `${data.first_name} ${data.last_name}` });
    res.json({ id, ...employeePayload });
  });

  app.put('/api/employees/:id', async (req, res) => {
    if (!ensureUser(req, res)) return;
    const actor = await fetchUserById(getSessionUserId(req));
    const actorRole = getSessionRole(req);
    const actorClientId = actorRole === 'superadmin' ? (getRequestedClientId(req) || actor?.client_id || null) : actor?.client_id || null;
    const { data: existing } = await supabaseAdmin.from('employees').select('*').eq('id', req.params.id).single();
    if (!existing) return res.status(404).json({ error: 'Employee not found' });
    if (actorClientId && existing.client_id !== actorClientId && actorRole !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
    const data = normalizeEmployeePayload({ ...existing, ...req.body, emp_id: req.body?.emp_id || existing.emp_id });
    const errors = validateEmployeePayload(data);
    if (errors.length) return res.status(400).json({ error: errors.join(' ') });
    const { allow_blank_pin: _allowBlankPin, ...persistableData } = data as any;
    const { data: updated, error } = await supabaseAdmin.from('employees').update(sanitizeEmployeeForSupabase(persistableData)).eq('id', req.params.id).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(updated);
  });

  app.post('/api/employees/:id/offboard', async (req, res) => {
    if (!ensureUser(req, res)) return;
    const payload = {
      status: 'offboarded',
      last_worked: req.body?.last_worked || null,
      last_worked_date: req.body?.last_worked || null,
      delete_reason: req.body?.delete_reason || null,
    };
    const { data, error } = await supabaseAdmin.from('employees').update(payload).eq('id', req.params.id).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.delete('/api/employees/:id', async (req, res) => {
    if (!ensureUser(req, res)) return;
    const { error } = await supabaseAdmin.from('employees').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });

  app.get('/api/shifts', async (_req, res) => {
    const { data, error } = await supabaseAdmin.from('shifts').select('*');
    if (error) return res.status(500).json({ error: error.message });
    res.json(sortShiftsBaseFirst((data || []) as any));
  });

  app.post('/api/shifts', async (req, res) => {
    if (!ensureUser(req, res)) return;
    const payload = normalizeShiftPayload(req.body);
    const errors = validateShiftPayload(payload);
    if (errors.length) return res.status(400).json({ error: errors.join(' ') });
    const id = payload.id || Math.random().toString(36).slice(2, 11);
    const { data, error } = await supabaseAdmin.from('shifts').insert({ ...payload, id }).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.put('/api/shifts/:id', async (req, res) => {
    if (!ensureUser(req, res)) return;
    const payload = normalizeShiftPayload({ ...req.body, id: req.params.id });
    const errors = validateShiftPayload(payload);
    if (errors.length) return res.status(400).json({ error: errors.join(' ') });
    const { data, error } = await supabaseAdmin.from('shifts').update(payload).eq('id', req.params.id).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.delete('/api/shifts/:id', async (req, res) => {
    if (!ensureUser(req, res)) return;
    const { error } = await supabaseAdmin.from('shifts').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });

  app.get('/api/roster', async (req, res) => {
    if (!ensureUser(req, res)) return;
    const actor = await fetchUserById(getSessionUserId(req));
    const actorRole = getSessionRole(req);
    const clientId = actorRole === 'superadmin' ? (getRequestedClientId(req) || actor?.client_id || null) : actor?.client_id || null;
    const weekStart = String(req.query.week_start || '').trim();
    const periodDays = Math.max(1, Number(req.query.period_days || 7));
    let employeeQuery = supabaseAdmin.from('employees').select('id');
    if (clientId) employeeQuery = employeeQuery.eq('client_id', clientId);
    const { data: employeeRows } = await employeeQuery;
    const ids = (employeeRows || []).map((r: any) => r.id);
    if (ids.length === 0) return res.json([]);
    let rosterQuery = supabaseAdmin.from('roster').select('*').in('employee_id', ids);
    if (weekStart) {
      const start = new Date(`${weekStart}T00:00:00`);
      const end = new Date(start);
      end.setDate(start.getDate() + periodDays - 1);
      rosterQuery = rosterQuery.gte('day_date', weekStart).lte('day_date', end.toISOString().slice(0,10));
    }
    const { data, error } = await rosterQuery;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  });

  app.post('/api/roster', async (req, res) => {
    if (!ensureUser(req, res)) return;
    const payload = {
      employee_id: String(req.body?.employee_id || '').trim(),
      day_date: String(req.body?.day_date || '').trim(),
      shift_id: req.body?.shift_id || null,
      updated_at: new Date().toISOString(),
    };
    if (!payload.employee_id || !payload.day_date) return res.status(400).json({ error: 'employee_id and day_date are required' });
    const { data, error } = await supabaseAdmin.from('roster').upsert(payload, { onConflict: 'employee_id,day_date' }).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.get('/api/roster-meta', async (req, res) => {
    if (!ensureUser(req, res)) return;
    const actor = await fetchUserById(getSessionUserId(req));
    const actorRole = getSessionRole(req);
    const clientId = actorRole === 'superadmin' ? (getRequestedClientId(req) || actor?.client_id || null) : actor?.client_id || null;
    const weekStart = String(req.query.week_start || '').trim();
    let employeeQuery = supabaseAdmin.from('employees').select('id');
    if (clientId) employeeQuery = employeeQuery.eq('client_id', clientId);
    const { data: employeeRows } = await employeeQuery;
    const ids = (employeeRows || []).map((r: any) => r.id);
    if (ids.length === 0) return res.json([]);
    let query = supabaseAdmin.from('roster_meta').select('*').in('employee_id', ids);
    if (weekStart) query = query.eq('week_start', weekStart);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  });

  app.post('/api/roster-meta', async (req, res) => {
    if (!ensureUser(req, res)) return;
    const employeeId = String(req.body?.employee_id || '').trim();
    const weekStart = String(req.body?.week_start || '').trim();
    const field = String(req.body?.field || '').trim();
    const value = req.body?.value ?? '';
    if (!employeeId || !weekStart || !field) return res.status(400).json({ error: 'employee_id, week_start and field are required' });
    const allowedFields = new Set(['salary_advance','shortages','unpaid_hours','loan_amount','staff_loan','uniform','overthrows','oil_spill','stock_shortage','annual_bonus','incentive_bonus','data_allowance','night_shift_allowance','medical_allowance','mibco_health_insurance','health_insurance','garnishee','cell_phone_payment','income_tax_registration','performance_incentive','commission','sales_commission','notes']);
    if (!allowedFields.has(field)) return res.status(400).json({ error: 'Unsupported roster meta field' });
    const base: any = { employee_id: employeeId, week_start: weekStart, updated_at: new Date().toISOString() };
    base[field] = String(value);
    const { data, error } = await supabaseAdmin.from('roster_meta').upsert(base, { onConflict: 'employee_id,week_start' }).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });


  app.get('/api/analytics', async (req, res) => {
    if (!ensureUser(req, res)) return;
    try {
      const month = String(req.query.month || new Date().toISOString().slice(0, 7));
      const [yearStr, monthStr] = month.split('-');
      let prevYear = Number(yearStr);
      let prevMonth = Number(monthStr) - 1;
      if (prevMonth === 0) {
        prevMonth = 12;
        prevYear -= 1;
      }
      const currentPrefix = month;
      const prevPrefix = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
      const clientId = await resolveRequestedClientIdForUser(req);

      let employeesQuery = supabaseAdmin.from('employees').select('*');
      if (clientId) employeesQuery = employeesQuery.eq('client_id', clientId);
      const { data: employeesData, error: employeesError } = await employeesQuery;
      if (employeesError) return res.status(500).json({ error: employeesError.message });
      const employees = (employeesData || []) as any[];
      const employeeIds = employees.map((e) => e.id).filter(Boolean);

      const { data: shiftsData, error: shiftsError } = await supabaseAdmin.from('shifts').select('*');
      if (shiftsError) return res.status(500).json({ error: shiftsError.message });
      const shifts = (shiftsData || []) as any[];

      let roster: any[] = [];
      if (employeeIds.length) {
        const { data: rosterData, error: rosterError } = await supabaseAdmin
          .from('roster')
          .select('*')
          .in('employee_id', employeeIds)
          .or(`day_date.like.${currentPrefix}-%25,day_date.like.${prevPrefix}-%25`);
        if (rosterError) return res.status(500).json({ error: rosterError.message });
        roster = (rosterData || []) as any[];
      }

      const shiftMap = new Map<string, any>();
      shifts.forEach((s: any) => {
        let durationHours = 0;
        if (s.start && s.end) {
          const [startH, startM] = String(s.start).split(':').map(Number);
          const [endH, endM] = String(s.end).split(':').map(Number);
          let startMins = startH * 60 + startM;
          let endMins = endH * 60 + endM;
          if (endMins < startMins) endMins += 24 * 60;
          durationHours = (endMins - startMins - (Number(s.lunch) || 0)) / 60;
        }
        shiftMap.set(s.id, { ...s, durationHours });
      });

      const calculateEntry = (r: any, emp: any) => {
        const shift = shiftMap.get(r.shift_id);
        if (!shift) return null;
        const date = new Date(r.day_date);
        const isSunday = date.getDay() === 0;
        let category = 'Normal Time';
        let hours = Number(shift.durationHours) || 0;
        const shiftLabel = String(shift.label || '').toLowerCase();
        if (shiftLabel.includes('unpaid leave') || shiftLabel.includes('absent') || shiftLabel.includes('unshifted')) {
          category = 'Absent';
          hours = 0;
        } else if (shiftLabel.includes('leave')) {
          category = 'Leave';
          hours = 8;
        } else if (isSunday) {
          category = 'Sunday (1.5)';
        }
        let normalHours = hours;
        let overtimeHours = 0;
        if (category === 'Normal Time' && hours > 9) {
          normalHours = 9;
          overtimeHours = hours - 9;
        }
        const payRate = Number(emp.pay_rate) || 0;
        const entries: any[] = [];
        if (category === 'Absent') return [];
        if (category === 'Sunday (1.5)') {
          entries.push({ category: 'Sunday (1.5)', amount: hours * payRate * 1.5, hours });
        } else if (category === 'Leave') {
          entries.push({ category: 'Leave', amount: hours * payRate, hours });
        } else {
          entries.push({ category: 'Normal Time', amount: normalHours * payRate, hours: normalHours });
          if (overtimeHours > 0) entries.push({ category: 'Overtime (1.5)', amount: overtimeHours * payRate * 1.5, hours: overtimeHours });
        }
        return entries;
      };

      let currentTotal = 0;
      let prevTotal = 0;
      const weeklyData: Record<string, { shifts: number; amount: number }> = {};
      const breakdown: Record<string, number> = {
        'Normal Time': 0,
        'Overtime (1.5)': 0,
        'Sunday (1.5)': 0,
        'Sunday (2.0)': 0,
        'Public Holiday': 0,
        'Leave': 0,
        'Bonus': 0,
        'Allowances': 0,
      };
      const employeeStats: Record<string, { name: string; amount: number; annual: number; sick: number; family: number }> = {};
      employees.forEach((emp: any) => {
        employeeStats[emp.id] = {
          name: `${emp.first_name || ''} ${emp.last_name || ''}`.trim(),
          amount: 0,
          annual: Number(emp.annual_leave) || 0,
          sick: Number(emp.sick_leave) || 0,
          family: Number(emp.family_leave) || 0,
        };
      });
      roster.forEach((r: any) => {
        const emp = employees.find((e: any) => e.id === r.employee_id);
        if (!emp) return;
        const isCurrentMonth = String(r.day_date).startsWith(currentPrefix);
        const isPrevMonth = String(r.day_date).startsWith(prevPrefix);
        const entries = calculateEntry(r, emp);
        if (!entries) return;
        let dayTotal = 0;
        entries.forEach((entry: any) => {
          dayTotal += entry.amount;
          if (isCurrentMonth) breakdown[entry.category] = (breakdown[entry.category] || 0) + entry.amount;
        });
        if (isCurrentMonth) {
          currentTotal += dayTotal;
          employeeStats[emp.id].amount += dayTotal;
          const date = new Date(r.day_date);
          const weekNum = Math.ceil(date.getDate() / 7);
          const weekKey = `Week ${weekNum}`;
          if (!weeklyData[weekKey]) weeklyData[weekKey] = { shifts: 0, amount: 0 };
          weeklyData[weekKey].shifts += 1;
          weeklyData[weekKey].amount += dayTotal;
        } else if (isPrevMonth) {
          prevTotal += dayTotal;
        }
      });
      const activeEmployees = employees.filter((e: any) => e.status !== 'offboarded');
      const totalEmployees = employees.length;
      const activeCount = activeEmployees.length;
      const offboardedCount = totalEmployees - activeCount;
      const avgSalary = activeCount > 0 ? activeEmployees.reduce((sum: number, e: any) => sum + (Number(e.pay_rate) || 0), 0) / activeCount : 0;
      const nonZeroWeeks = Object.values(weeklyData).filter((w) => w.amount > 0);
      const avgWeeklyBill = nonZeroWeeks.length > 0 ? nonZeroWeeks.reduce((sum, w) => sum + w.amount, 0) / nonZeroWeeks.length : 0;
      const weeklyChart = Object.keys(weeklyData).sort().map((week) => ({ week, shifts: weeklyData[week].shifts, amount: weeklyData[week].amount }));
      const breakdownArray = Object.keys(breakdown).filter((k) => breakdown[k] > 0).map((category) => ({ category, amount: breakdown[category] }));
      const employeeShare = Object.values(employeeStats).filter((e) => e.amount > 0).map((e) => ({ name: e.name, amount: e.amount, percentage: currentTotal > 0 ? (e.amount / currentTotal) * 100 : 0, })).sort((a, b) => b.amount - a.amount);
      const activeEmployeeIds = new Set(activeEmployees.map((e: any) => e.id));
      const leaveAnalytics = Object.entries(employeeStats).filter(([employeeId]) => activeEmployeeIds.has(employeeId)).map(([, e]: any) => ({ name: e.name, annual: e.annual, sick: e.sick, family: e.family }));
      return res.json({
        kpis: { currentTotal, prevTotal, avgSalary, avgWeeklyBill, totalEmployees, activeCount, offboardedCount },
        weeklyChart,
        breakdown: breakdownArray,
        employeeShare,
        leaveAnalytics,
      });
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to load analytics' });
    }
  });

  app.get('/api/leave-requests', async (req, res) => {
    if (!ensureUserOrEmployee(req, res)) return;
    const employeeSessionId = getSessionEmployeeId(req);
    let employeeId = typeof req.query.employee_id === 'string' ? req.query.employee_id : null;
    if (employeeSessionId) employeeId = employeeSessionId;
    let query = supabaseAdmin.from('leave_requests').select('*').order('created_at', { ascending: false });
    if (employeeId) query = query.eq('employee_id', employeeId);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    const ids = Array.from(new Set((data || []).map((row: any) => row.employee_id).filter(Boolean)));
    let nameMap = new Map<string, string>();
    if (ids.length) {
      const { data: emps } = await supabaseAdmin.from('employees').select('id,first_name,last_name').in('id', ids);
      nameMap = new Map((emps || []).map((e: any) => [e.id, `${e.first_name || ''} ${e.last_name || ''}`.trim()]));
    }
    res.json((data || []).map((row: any) => ({ ...row, employee_name: nameMap.get(row.employee_id) || '' })));
  });

  app.post('/api/leave-requests', async (req, res) => {
    if (!ensureUserOrEmployee(req, res)) return;
    const employeeSessionId = getSessionEmployeeId(req);
    const employee_id = String(req.body?.employee_id || employeeSessionId || '').trim();
    if (!employee_id) return res.status(400).json({ error: 'Employee is required' });
    const id = `leave_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const payload = {
      id,
      employee_id,
      type: String(req.body?.type || '').trim(),
      start_date: String(req.body?.start_date || '').slice(0,10),
      end_date: String(req.body?.end_date || '').slice(0,10),
      is_half_day: Boolean(req.body?.is_half_day),
      status: getSessionUserId(req) && req.body?.status === 'approved' ? 'approved' : 'pending',
      notes: String(req.body?.notes || ''),
      admin_notes: String(req.body?.admin_notes || ''),
      days: Number(req.body?.days || 0),
      source: 'manual',
      attachment_url: '',
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabaseAdmin.from('leave_requests').insert(payload).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
  });

  app.put('/api/leave-requests/:id/status', async (req, res) => {
    if (!ensureUser(req, res)) return;
    const status = String(req.body?.status || '').trim();
    if (!['approved','declined'].includes(status)) return res.status(400).json({ error: 'Valid status is required' });
    const { data, error } = await supabaseAdmin.from('leave_requests').update({ status, admin_notes: String(req.body?.admin_notes || ''), updated_at: new Date().toISOString() }).eq('id', req.params.id).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.post('/api/leave-requests/:id/cancel', async (req, res) => {
    if (!ensureUserOrEmployee(req, res)) return;
    const { data, error } = await supabaseAdmin.from('leave_requests').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', req.params.id).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });
}
