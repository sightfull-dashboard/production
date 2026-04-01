import type { Express } from 'express';
import { createRequestSupabaseClient, supabaseAdmin } from '../integrations/supabase';
import { linkAppUserToAuthUser, signInWithSupabasePassword } from '../utils/supabaseAuth';
import { env } from '../config/env';
import { sortShiftsBaseFirst, doesShiftStartOverlapPrevious, formatShiftTimeLabel } from '../../lib/shifts';
import { hashSecret, sanitizeEmployeeForResponse, sanitizeEmployeesForResponse, shouldUpgradeLegacySecret, verifySecret } from '../utils/security';

const parseJsonArray = (value: any) => Array.isArray(value) ? value : (() => {
  try { return value ? JSON.parse(value) : []; } catch { return []; }
})();

const displayNameFromEmail = (email: string | null | undefined) =>
  String(email || '').split('@')[0].replace(/[._-]+/g, ' ').trim().replace(/\b\w/g, (m) => m.toUpperCase()) || 'User';

const getSessionRole = (req: any) => (req.session as any)?.userRole || null;
const getSessionUserId = (req: any) => (req.session as any)?.userId || null;
const getSessionEmployeeId = (req: any) => (req.session as any)?.employeeId || null;
const getSessionClientId = (req: any) => (req.session as any)?.employeeClientId || null;

const getSessionSupabaseAuthUserId = (req: any) => (req.session as any)?.supabaseAuthUserId || null;

const getSessionSupabaseAccessToken = (req: any) => (req.session as any)?.supabaseAccessToken || null;


const safeHandler = (handler: (req: any, res: any, next?: any) => Promise<any> | any) => {
  return (req: any, res: any, next: any) => {
    Promise.resolve(handler(req, res, next)).catch((error: any) => {
      console.error('Supabase route failed:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: error?.message || 'Request failed' });
      }
    });
  };
};

const getTenantDataClient = (_req: any) => {
  // Temporarily force the admin client for app data to avoid request-scoped RLS/session issues
  // taking down shared dashboard routes in production.
  return supabaseAdmin;
};

const clearSessionAuthState = (req: any) => {
  delete (req.session as any).supabaseAccessToken;
  delete (req.session as any).supabaseRefreshToken;
  delete (req.session as any).supabaseAuthUserId;
  delete (req.session as any).authLoginSource;
};

const applyUserSession = (req: any, user: any, allowedSuperAdminEmails: Set<string>, authSession?: { access_token?: string | null; refresh_token?: string | null; user?: { id?: string | null } | null } | null, authSource: 'supabase' = 'supabase') => {
  const normalizedEmail = String(user?.email || '').trim().toLowerCase();
  const effectiveRole = allowedSuperAdminEmails.has(normalizedEmail) ? 'superadmin' : user?.role;
  (req.session as any).userId = user.id;
  (req.session as any).userRole = effectiveRole;
  (req.session as any).userClientId = user.client_id || null;
  if (authSession?.access_token) {
    (req.session as any).supabaseAccessToken = authSession.access_token;
  }
  if (authSession?.refresh_token) {
    (req.session as any).supabaseRefreshToken = authSession.refresh_token;
  }
  const authUserId = authSession?.user?.id || user?.auth_user_id || null;
  if (authUserId) {
    (req.session as any).supabaseAuthUserId = authUserId;
  }
  (req.session as any).authLoginSource = authSource;
  if (user?.mfa_required || user?.mfa_enabled) {
    (req.session as any).mfaPending = true;
  } else {
    delete (req.session as any).mfaPending;
  }
  return effectiveRole;
};

const getRequestedClientId = (req: any) => {
  const header = String(req.headers['x-active-client-id'] || '').trim();
  return header || null;
};

const normalizeClientStatus = (value: unknown) => String(value || 'active').trim().toLowerCase() === 'deactivated' ? 'deactivated' : 'active';
const isClientDeactivated = (client: any) => normalizeClientStatus(client?.status) === 'deactivated';


const calculateTrialState = (row: any) => {
  const isTrial = !!row?.is_trial;
  const trialStartedAt = row?.trial_started_at || null;
  const trialEndDate = row?.trial_end_date || null;
  if (!isTrial || !trialEndDate) {
    return { isTrial, trialStartedAt, trialEndDate, trialExpired: false, trialDaysRemaining: null as number | null };
  }
  const end = new Date(trialEndDate);
  if (Number.isNaN(end.getTime())) {
    return { isTrial, trialStartedAt, trialEndDate, trialExpired: false, trialDaysRemaining: null as number | null };
  }
  const msRemaining = end.getTime() - Date.now();
  const trialExpired = msRemaining < 0;
  const trialDaysRemaining = trialExpired ? 0 : Math.ceil(msRemaining / (1000 * 60 * 60 * 24));
  return { isTrial, trialStartedAt, trialEndDate, trialExpired, trialDaysRemaining };
};

const formatDateOnly = (value: Date) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getPreviousDayIso = (dayDate: string) => {
  const date = new Date(`${dayDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() - 1);
  return formatDateOnly(date);
};


const LEAVE_COLUMNS = {
  annual: 'annual_leave',
  sick: 'sick_leave',
  family: 'family_leave',
} as const;

type BalanceLeaveTypeKey = keyof typeof LEAVE_COLUMNS;
type LeaveTypeKey = BalanceLeaveTypeKey | 'unpaid' | 'half_day';
type LeaveStatusValue = 'pending' | 'approved' | 'declined' | 'cancelled';

const normalizeLeaveType = (value: unknown): LeaveTypeKey | null => value === 'annual' || value === 'sick' || value === 'family' || value === 'unpaid' || value === 'half_day' ? value : null;
const normalizeLeaveStatus = (value: unknown): LeaveStatusValue | null => value === 'pending' || value === 'approved' || value === 'declined' || value === 'cancelled' ? value : null;
const parseBoolean = (value: unknown) => value === true || value === 1 || value === '1';
const getBalanceTrackedLeaveType = (type: LeaveTypeKey): BalanceLeaveTypeKey | null => {
  if (type === 'half_day') return 'annual';
  if (type === 'annual' || type === 'sick' || type === 'family') return type;
  return null;
};
const getWeekdayLeaveDays = (startDate: string, endDate: string, isHalfDay: boolean) => {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return 0;
  if (isHalfDay) return startDate === endDate ? 0.5 : 0;

  let count = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
};
const parseDateOnlyValue = (value: string | null | undefined) => {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};
const startOfToday = () => {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
};
const addMonthsDate = (date: Date, months: number) => {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
};
const getCompletedMonthsBetween = (start: Date, end: Date) => {
  let months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  if (end.getDate() < start.getDate()) months -= 1;
  return Math.max(0, months);
};
const getEmploymentYears = (startDate: Date, asOf: Date) => {
  let years = asOf.getFullYear() - startDate.getFullYear();
  if (asOf.getMonth() < startDate.getMonth() || (asOf.getMonth() === startDate.getMonth() && asOf.getDate() < startDate.getDate())) years -= 1;
  return Math.max(0, years);
};
const getLeavePayrollFrequency = (clientRow: any) => {
  const raw = String(clientRow?.payroll_frequency || clientRow?.roster_duration || '1_week').toLowerCase().trim();
  if (['monthly', '1_month', 'month'].includes(raw)) return 'monthly';
  if (['fortnightly', 'fortnight', '2_weeks', '2_week', 'biweekly'].includes(raw)) return 'fortnightly';
  return 'weekly';
};
const getAnnualLeaveRate = (frequency: string | null | undefined, years: number) => {
  const enhanced = years >= 8;
  if (frequency === 'monthly') return enhanced ? 1.6667 : 1.25;
  if (frequency === 'fortnightly') return enhanced ? 0.7692 : 0.5768;
  return enhanced ? 0.3846 : 0.2884;
};
const roundLeaveAmount = (value: number) => Math.round(value * 10000) / 10000;
const getFamilyLeaveResetYear = (employee: any) => {
  const raw = employee?.family_leave_last_reset_year ?? employee?.family_leave_last_grant_year;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

async function resolveLeaveClientId(req: any, employeeId?: string | null) {
  const explicit = await resolveRequestedClientIdForUser(req);
  if (explicit) return explicit;
  if (employeeId) {
    const employee = await fetchEmployeeById(employeeId);
    if (employee?.client_id) return employee.client_id;
  }
  return getSessionClientId(req) || null;
}

async function adjustEmployeeLeaveBalanceSupabase(employeeId: string, type: LeaveTypeKey, amountDelta: number) {
  const trackedType = getBalanceTrackedLeaveType(type);
  if (!trackedType || amountDelta === 0) return null;
  const employee = await fetchEmployeeById(employeeId);
  if (!employee) return null;
  const column = LEAVE_COLUMNS[trackedType];
  const nextValue = roundLeaveAmount((Number(employee[column]) || 0) + amountDelta);
  const { data, error } = await supabaseAdmin.from('employees').update({ [column]: nextValue, updated_at: new Date().toISOString() }).eq('id', employeeId).select('*').single();
  if (error) throw error;
  return data as any;
}

async function reconcileEmployeeLeaveAccrualSupabase(employeeId: string) {
  const employee = await fetchEmployeeById(employeeId);
  if (!employee || employee.status === 'offboarded') return employee;
  const startDate = parseDateOnlyValue(employee.start_date);
  const today = startOfToday();
  if (!startDate || startDate > today) return employee;

  const client = await fetchClientById(employee.client_id);
  const payrollFrequency = getLeavePayrollFrequency(client);
  const employmentYears = getEmploymentYears(startDate, today);

  let annualLeave = Number(employee.annual_leave) || 0;
  let sickLeave = Number(employee.sick_leave) || 0;
  let familyLeave = Number(employee.family_leave) || 0;
  let annualAnchor = parseDateOnlyValue(employee.annual_leave_last_accrual_date) || startDate;
  let sickCycleStart = parseDateOnlyValue(employee.sick_cycle_start_date) || startDate;
  let sickMonthsCredited = Number(employee.sick_months_credited) || 0;
  let sickCycleFullGrantApplied = Number(employee.sick_cycle_full_grant_applied) || 0;
  let familyResetYear = getFamilyLeaveResetYear(employee);
  let changed = false;

  const annualRate = getAnnualLeaveRate(payrollFrequency, employmentYears);
  if (payrollFrequency === 'monthly') {
    let nextAccrualDate = addMonthsDate(annualAnchor, 1);
    while (nextAccrualDate <= today) {
      annualLeave = roundLeaveAmount(annualLeave + annualRate);
      annualAnchor = nextAccrualDate;
      nextAccrualDate = addMonthsDate(annualAnchor, 1);
      changed = true;
    }
  } else if (payrollFrequency === 'fortnightly') {
    let nextAccrualDate = new Date(annualAnchor);
    nextAccrualDate.setDate(nextAccrualDate.getDate() + 14);
    while (nextAccrualDate <= today) {
      annualLeave = roundLeaveAmount(annualLeave + annualRate);
      annualAnchor = nextAccrualDate;
      nextAccrualDate = new Date(annualAnchor);
      nextAccrualDate.setDate(nextAccrualDate.getDate() + 14);
      changed = true;
    }
  } else {
    let nextAccrualDate = new Date(annualAnchor);
    nextAccrualDate.setDate(nextAccrualDate.getDate() + 7);
    while (nextAccrualDate <= today) {
      annualLeave = roundLeaveAmount(annualLeave + annualRate);
      annualAnchor = nextAccrualDate;
      nextAccrualDate = new Date(annualAnchor);
      nextAccrualDate.setDate(nextAccrualDate.getDate() + 7);
      changed = true;
    }
  }

  while (new Date(sickCycleStart.getFullYear() + 3, sickCycleStart.getMonth(), sickCycleStart.getDate()) <= today) {
    sickCycleStart = new Date(sickCycleStart.getFullYear() + 3, sickCycleStart.getMonth(), sickCycleStart.getDate());
    sickLeave = 0;
    sickMonthsCredited = 0;
    sickCycleFullGrantApplied = 0;
    changed = true;
  }
  const monthsInSickCycle = getCompletedMonthsBetween(sickCycleStart, today);
  if (monthsInSickCycle < 4) {
    while (sickMonthsCredited < monthsInSickCycle) {
      sickLeave = roundLeaveAmount(sickLeave + 1);
      sickMonthsCredited += 1;
      changed = true;
    }
  } else {
    while (sickMonthsCredited < 4) {
      sickLeave = roundLeaveAmount(sickLeave + 1);
      sickMonthsCredited += 1;
      changed = true;
    }
    if (!sickCycleFullGrantApplied) {
      sickLeave = 30;
      sickCycleFullGrantApplied = 1;
      changed = true;
    }
  }

  const familyEligibilityDate = addMonthsDate(startDate, 4);
  if (familyEligibilityDate <= today) {
    const currentYear = today.getFullYear();
    if (familyResetYear !== currentYear) {
      familyLeave = 3;
      familyResetYear = currentYear;
      changed = true;
    }
  }

  if (!changed) return employee;
  const updatePayload: any = {
    annual_leave: annualLeave,
    sick_leave: sickLeave,
    family_leave: familyLeave,
    annual_leave_last_accrual_date: formatDateOnly(annualAnchor),
    sick_cycle_start_date: formatDateOnly(sickCycleStart),
    sick_months_credited: sickMonthsCredited,
    sick_cycle_full_grant_applied: sickCycleFullGrantApplied,
    family_leave_last_reset_year: familyResetYear,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabaseAdmin.from('employees').update(updatePayload).eq('id', employeeId).select('*').single();
  if (error) return employee;
  return data as any;
}

async function getExistingLeaveOverlap(employeeId: string, startDate: string, endDate: string, excludeId?: string | null) {
  let query = supabaseAdmin.from('leave_requests').select('*').eq('employee_id', employeeId).in('status', ['pending','approved']).lte('start_date', endDate).gte('end_date', startDate).order('start_date', { ascending: true });
  if (excludeId) query = query.neq('id', excludeId);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as any[];
}


const normalizeShiftLabel = (value: unknown) => String(value || '').trim().toLowerCase();

const getRosterLeaveConfigFromShift = (shift: any): { type: LeaveTypeKey; isHalfDay: boolean; units: number } | null => {
  const label = normalizeShiftLabel(shift?.label);
  if (label === 'annual leave') return { type: 'annual', isHalfDay: false, units: 1 };
  if (label === 'sick leave') return { type: 'sick', isHalfDay: false, units: 1 };
  if (label === 'family leave' || label === 'family responsibility') return { type: 'family', isHalfDay: false, units: 1 };
  if (label === 'unpaid leave') return { type: 'unpaid', isHalfDay: false, units: 1 };
  if (label === 'half day') return { type: 'half_day', isHalfDay: true, units: 0.5 };
  return null;
};

const enumerateDateRange = (startDate: string, endDate: string) => {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [] as string[];
  const dates: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(formatDateOnly(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
};

const getRosterLeaveRequestId = (employeeId: string, type: LeaveTypeKey, startDate: string, endDate: string) =>
  `roster_${employeeId}_${String(type).replace(/[^a-z0-9_]+/gi, '_')}_${startDate.replace(/-/g, '')}_${endDate.replace(/-/g, '')}`;

async function buildRosterDerivedLeaveRequests(employeeId: string, clientId: string, client: any = supabaseAdmin) {
  const { data: rosterRows, error: rosterError } = await client
    .from('roster')
    .select('employee_id,day_date,shift_id')
    .eq('employee_id', employeeId)
    .not('shift_id', 'is', null)
    .order('day_date', { ascending: true });
  if (rosterError) throw rosterError;

  const rows = (rosterRows || []) as any[];
  if (!rows.length) return [] as any[];

  const shiftIds = Array.from(new Set(rows.map((row: any) => String(row.shift_id || '')).filter(Boolean)));
  if (!shiftIds.length) return [] as any[];

  const { data: shiftsData, error: shiftsError } = await client
    .from('shifts')
    .select('id,label')
    .eq('client_id', clientId)
    .in('id', shiftIds);
  if (shiftsError) throw shiftsError;

  const shiftMap = new Map((shiftsData || []).map((shift: any) => [String(shift.id), shift]));

  const { data: manualLeaveRows, error: manualLeaveError } = await client
    .from('leave_requests')
    .select('id,start_date,end_date')
    .eq('employee_id', employeeId)
    .neq('source', 'roster')
    .in('status', ['pending', 'approved']);
  if (manualLeaveError) throw manualLeaveError;

  const blockedDates = new Set<string>();
  for (const request of (manualLeaveRows || []) as any[]) {
    for (const date of enumerateDateRange(String(request.start_date || '').slice(0, 10), String(request.end_date || '').slice(0, 10))) {
      blockedDates.add(date);
    }
  }

  const entries: any[] = [];
  let current: any = null;

  const flushCurrent = () => {
    if (!current) return;
    entries.push({
      id: getRosterLeaveRequestId(employeeId, current.type, current.start_date, current.end_date),
      employee_id: employeeId,
      type: current.type,
      start_date: current.start_date,
      end_date: current.end_date,
      is_half_day: !!current.is_half_day,
      status: 'approved',
      notes: 'Created from roster assignment',
      admin_notes: '',
      days: roundLeaveAmount(current.days),
      source: 'roster',
      source_ref: `roster:${employeeId}:${current.type}:${current.start_date}:${current.end_date}`,
      attachment_url: '',
      updated_at: new Date().toISOString(),
    });
    current = null;
  };

  for (const row of rows) {
    const dayDate = String(row.day_date || '').slice(0, 10);
    if (!dayDate || blockedDates.has(dayDate)) {
      flushCurrent();
      continue;
    }

    const shift = shiftMap.get(String(row.shift_id || ''));
    const leaveConfig = getRosterLeaveConfigFromShift(shift);
    if (!leaveConfig) {
      flushCurrent();
      continue;
    }

    const entry = {
      type: leaveConfig.type,
      start_date: dayDate,
      end_date: dayDate,
      is_half_day: leaveConfig.isHalfDay,
      days: leaveConfig.units,
    };

    if (!current) {
      current = entry;
      continue;
    }

    const previousEnd = new Date(`${current.end_date}T00:00:00`);
    previousEnd.setDate(previousEnd.getDate() + 1);
    const isAdjacent = formatDateOnly(previousEnd) === dayDate;
    const canMerge = !current.is_half_day && !entry.is_half_day && current.type === entry.type && isAdjacent;

    if (canMerge) {
      current.end_date = dayDate;
      current.days = roundLeaveAmount(Number(current.days || 0) + Number(entry.days || 0));
    } else {
      flushCurrent();
      current = entry;
    }
  }

  flushCurrent();
  return entries;
}

async function syncRosterLeaveRecordsForEmployeeSupabase(employeeId: string, clientId: string) {
  // Do not run the full accrual reconciler as part of roster leave sync.
  // It can reset cycle-based balances (especially sick leave) to entitlement-level
  // amounts before the roster deduction is applied, which makes balances jump up.
  // Roster sync should only compare existing roster-sourced leave entries vs the
  // newly-derived roster leave entries and apply the net balance delta.
  const nextEntries = await buildRosterDerivedLeaveRequests(employeeId, clientId, supabaseAdmin);
  const { data: existingRows, error: existingError } = await supabaseAdmin
    .from('leave_requests')
    .select('*')
    .eq('employee_id', employeeId)
    .eq('source', 'roster');
  if (existingError) throw existingError;

  const existing = (existingRows || []) as any[];
  const sumTrackedDays = (rows: any[]) => {
    const totals: Record<BalanceLeaveTypeKey, number> = { annual: 0, sick: 0, family: 0 };
    for (const row of rows) {
      if (String(row.status || 'approved') !== 'approved') continue;
      const type = normalizeLeaveType(row.type);
      if (!type) continue;
      const trackedType = getBalanceTrackedLeaveType(type);
      if (!trackedType) continue;
      totals[trackedType] = roundLeaveAmount((totals[trackedType] || 0) + (Number(row.days) || 0));
    }
    return totals;
  };

  const previousTotals = sumTrackedDays(existing);
  const nextTotals = sumTrackedDays(nextEntries);

  if (nextEntries.length) {
    const { error: upsertError } = await supabaseAdmin
      .from('leave_requests')
      .upsert(nextEntries, { onConflict: 'id' });
    if (upsertError) throw upsertError;
  }

  const nextIds = new Set(nextEntries.map((row: any) => row.id));
  const staleIds = existing.map((row: any) => row.id).filter((id: string) => !nextIds.has(id));
  if (staleIds.length) {
    const { error: deleteError } = await supabaseAdmin.from('leave_requests').delete().in('id', staleIds);
    if (deleteError) throw deleteError;
  }

  for (const trackedType of ['annual', 'sick', 'family'] as BalanceLeaveTypeKey[]) {
    const adjustment = roundLeaveAmount((previousTotals[trackedType] || 0) - (nextTotals[trackedType] || 0));
    if (adjustment !== 0) {
      await adjustEmployeeLeaveBalanceSupabase(employeeId, trackedType, adjustment);
    }
  }
}

async function fetchUserById(id: string) {
  const { data } = await supabaseAdmin.from('users').select('*').eq('id', id).single();
  return data as any;
}

async function fetchUserByAuthUserId(authUserId: string) {
  const { data } = await supabaseAdmin.from('users').select('*').eq('auth_user_id', authUserId).maybeSingle();
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

async function listEmployeesForClient(clientId: string | null, client: any = supabaseAdmin) {
  let query = client.from('employees').select('*').order('emp_id', { ascending: true });
  if (clientId) query = query.eq('client_id', clientId);
  const { data, error } = await query;
  if (error) throw error;
  const employees = (data || []) as any[];
  if (employees.length === 0) return employees;
  const ids = employees.map((e) => e.id);
  const { data: rosterRows } = await client.from('roster').select('employee_id,day_date,shift_id').in('employee_id', ids).not('shift_id', 'is', null);
  const maxMap = new Map<string, string>();
  for (const row of (rosterRows || []) as any[]) {
    const current = maxMap.get(row.employee_id);
    if (!current || String(row.day_date) > current) maxMap.set(row.employee_id, String(row.day_date));
  }
  return employees.map((employee) => ({ ...employee, last_worked_date: maxMap.get(employee.id) || null }));
}

async function nextEmployeeId(clientId: string | null, client: any = supabaseAdmin) {
  let query = client.from('employees').select('emp_id');
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
  delete next.family_leave_last_grant_year;
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

async function resolveTenantContext(req: any) {
  const role = getSessionRole(req);
  const actor = getSessionUserId(req) ? await fetchUserById(getSessionUserId(req)) : null;
  const requestedClientId = getRequestedClientId(req);
  const clientId = role === 'superadmin' ? (requestedClientId || actor?.client_id || null) : (actor?.client_id || null);
  return { role, actor, requestedClientId, clientId };
}

async function requireTenantContext(req: any, res: any, options: { superadminMustSelectClient?: boolean } = {}) {
  if (!ensureUser(req, res)) return null;
  const context = await resolveTenantContext(req);
  const requireSelection = options.superadminMustSelectClient !== false;
  if (requireSelection && context.role === 'superadmin' && !context.clientId) {
    res.status(400).json({ error: 'No active client dashboard selected.' });
    return null;
  }
  if (!context.clientId) {
    res.status(400).json({ error: 'No client is associated with this account.' });
    return null;
  }
  const client = await fetchClientById(context.clientId);
  if (!client) {
    res.status(404).json({ error: 'Client dashboard not found.' });
    return null;
  }
  if (isClientDeactivated(client)) {
    if (context.role === 'superadmin') {
      res.status(423).json({ error: 'This client dashboard has been deactivated.', clientDeactivated: true, clientId: context.clientId });
    } else {
      req.session.destroy(() => {
        res.status(423).json({ error: 'This client dashboard has been deactivated.', clientDeactivated: true, clientId: context.clientId });
      });
    }
    return null;
  }
  return { ...context, client };
}

async function fetchEmployeeForClient(employeeId: string, clientId: string, client: any = supabaseAdmin) {
  const { data, error } = await client
    .from('employees')
    .select('*')
    .eq('id', employeeId)
    .eq('client_id', clientId)
    .maybeSingle();
  if (error) throw error;
  return data as any;
}

async function listShiftsForClient(clientId: string, client: any = supabaseAdmin) {
  const { data, error } = await client
    .from('shifts')
    .select('*')
    .eq('client_id', clientId)
    .order('label', { ascending: true });
  if (error) throw error;
  return (data || []) as any[];
}

async function fetchShiftForClient(shiftId: string, clientId: string, client: any = supabaseAdmin) {
  const { data, error } = await client
    .from('shifts')
    .select('*')
    .eq('id', shiftId)
    .eq('client_id', clientId)
    .maybeSingle();
  if (error) throw error;
  return data as any;
}

const PROTECTED_ADMINISTRATIVE_SHIFT_LABELS = ['absent', 'annual leave', 'sick leave', 'family leave', 'half day', 'unshifted'];
const isProtectedAdministrativeShiftLabel = (label: string | null | undefined) => PROTECTED_ADMINISTRATIVE_SHIFT_LABELS.includes(String(label || '').trim().toLowerCase());

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
  const role = String(user.role || '').toLowerCase();
  const userTrialState = calculateTrialState(user);
  const clientTrialState = calculateTrialState(client);
  const effectiveTrialState = role === 'superadmin' ? userTrialState : (clientTrialState.isTrial ? clientTrialState : userTrialState);
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    name: user.name || displayNameFromEmail(user.email),
    full_name: user.name || displayNameFromEmail(user.email),
    image: user.image || null,
    fallbackImage: client?.fallback_image || null,
    client_id: user.client_id || null,
    client_name: client?.name || null,
    clientStatus: normalizeClientStatus(client?.status),
    lockedFeatures,
    enabledDefinitions,
    roster_start_day: client?.roster_start_day ?? 1,
    roster_duration: client?.roster_duration || '1_week',
    rosterMode: client?.roster_mode || 'Manual',
    rosterSeedWeekStart: client?.roster_seed_week_start || null,
    mfa_required: !!user.mfa_required,
    mfa_enabled: !!user.mfa_enabled,
    permissions: parseJsonArray(user.permissions).map((value: any) => String(value)).filter(Boolean),
    assigned_clients: parseJsonArray(user.assigned_clients).map((value: any) => String(value)).filter(Boolean),
    status: String(user.status || 'active').toLowerCase() === 'deactivated' ? 'deactivated' : 'active',
    isTrial: effectiveTrialState.isTrial,
    trialStartedAt: effectiveTrialState.trialStartedAt,
    trialEndDate: effectiveTrialState.trialEndDate,
    trialExpired: effectiveTrialState.trialExpired,
    trialDaysRemaining: effectiveTrialState.trialDaysRemaining,
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
      if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

      let user = await fetchUserByEmail(email);
      const supabaseLogin = await signInWithSupabasePassword(email, password).catch((error) => ({ session: null, user: null, error }));
      const authSession = supabaseLogin?.session || null;

      if (!authSession || !supabaseLogin?.user) {
        logActivity(req, 'LOGIN_FAILED', { email, reason: 'supabase_auth_invalid_credentials' });
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      user = user || await fetchUserByAuthUserId(String(supabaseLogin.user.id));
      user = user || await fetchUserByEmail(String(supabaseLogin.user.email || email));

      if (!user) {
        logActivity(req, 'LOGIN_FAILED', { email, reason: 'app_user_not_found_for_auth_user' });
        return res.status(403).json({ error: 'Your account is not linked to an application user. Please contact support.' });
      }

      if (user && !user.auth_user_id) {
        try {
          await linkAppUserToAuthUser(String(user.id), String(supabaseLogin.user.id));
          user = { ...user, auth_user_id: String(supabaseLogin.user.id) };
        } catch (linkError) {
          console.warn('Failed to link app user to Supabase Auth user during login:', linkError);
        }
      }

      if (!user.is_verified && !allowedSuperAdminEmails.has(String(user.email || '').trim().toLowerCase())) {
        return res.status(403).json({ error: 'Account not verified yet.' });
      }

      const effectiveRole = applyUserSession(req, user, allowedSuperAdminEmails, { ...authSession, user: authSession.user || { id: user.auth_user_id || null } }, 'supabase');
      await supabaseAdmin
        .from('users')
        .update({
          last_login: new Date().toISOString(),
          role: effectiveRole,
          is_verified: true,
          ...(user.auth_user_id || getSessionSupabaseAuthUserId(req) ? { auth_user_id: user.auth_user_id || getSessionSupabaseAuthUserId(req) } : {}),
        })
        .eq('id', user.id);
      const payload = await buildAuthResponse({ ...user, role: effectiveRole, is_verified: true, auth_user_id: user.auth_user_id || getSessionSupabaseAuthUserId(req) }, allowedSuperAdminEmails, mergeDefinitions, baseRosterDefinitions);
      if (payload?.role !== 'superadmin' && payload?.client_id && payload?.clientStatus === 'deactivated') {
        return req.session.destroy(() => res.status(423).json({ error: 'This client dashboard has been deactivated.', clientDeactivated: true, clientId: payload.client_id }));
      }
      logActivity(req, 'LOGIN_SUCCESS', { email: user.email, role: payload?.role, client_id: payload?.client_id || null, authSource: (req.session as any).authLoginSource || 'supabase' });
      return res.json({ ...payload, mfaPending: !!(req.session as any).mfaPending });
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Login failed' });
    }
  });


  app.get('/api/auth/me', async (req, res) => {
    let user = getSessionUserId(req) ? await fetchUserById(getSessionUserId(req)) : null;
    if (!user && getSessionSupabaseAuthUserId(req)) {
      user = await fetchUserByAuthUserId(String(getSessionSupabaseAuthUserId(req)));
      if (user?.id) {
        (req.session as any).userId = user.id;
        (req.session as any).userRole = allowedSuperAdminEmails.has(String(user.email || '').trim().toLowerCase()) ? 'superadmin' : user.role;
        (req.session as any).userClientId = user.client_id || null;
      }
    }
    if (!user) return res.json(null);
    const payload = await buildAuthResponse(user, allowedSuperAdminEmails, mergeDefinitions, baseRosterDefinitions);
    if (payload?.role !== 'superadmin' && payload?.client_id && payload?.clientStatus === 'deactivated') {
      return req.session.destroy(() => res.status(423).json({ error: 'This client dashboard has been deactivated.', clientDeactivated: true, clientId: payload.client_id }));
    }
    return res.json({ ...payload, mfaPending: !!(req.session as any).mfaPending, authSource: (req.session as any).authLoginSource || 'supabase' });
  });

  app.post('/api/auth/logout', (req, res) => {
    logActivity(req, 'LOGOUT');
    clearSessionAuthState(req);
    req.session.destroy(() => res.json({ success: true }));
  });

  app.post('/api/employee-auth/login', async (req, res) => {
    try {
      const identifier = String(req.body?.identifier ?? '').trim();
      const pin = String(req.body?.pin ?? '').trim();
      if (!identifier || !pin) return res.status(400).json({ error: 'Identifier and PIN are required' });
      const employee = await fetchEmployeeByIdentifier(identifier);
      if (!employee || !verifySecret(pin, employee.pin)) {
        return res.status(401).json({ error: 'Invalid Email/Phone or PIN' });
      }
      const client = await fetchClientById(employee.client_id);
      if (isClientDeactivated(client)) {
        return res.status(423).json({ error: 'This client dashboard has been deactivated.', clientDeactivated: true, clientId: employee.client_id || null });
      }
      if (shouldUpgradeLegacySecret(pin, employee.pin)) {
        const upgradedPin = hashSecret(pin);
        await supabaseAdmin.from('employees').update({ pin: upgradedPin }).eq('id', employee.id);
        employee.pin = upgradedPin;
      }
      (req.session as any).employeeId = employee.id;
      (req.session as any).employeeClientId = employee.client_id || null;
      return res.json(sanitizeEmployeeForResponse(employee));
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to sign in employee' });
    }
  });

  app.get('/api/employee-auth/me', async (req, res) => {
    const employeeId = getSessionEmployeeId(req);
    if (!employeeId) return res.json(null);
    const employee = await fetchEmployeeById(employeeId);
    if (!employee || employee.status === 'offboarded') return res.json(null);
    const client = await fetchClientById(employee.client_id);
    if (isClientDeactivated(client)) {
      return req.session.destroy(() => res.status(423).json({ error: 'This client dashboard has been deactivated.', clientDeactivated: true, clientId: employee.client_id || null }));
    }
    return res.json(sanitizeEmployeeForResponse({ ...employee, fallback_image: client?.fallback_image || null }));
  });

  app.post('/api/employee-auth/logout', (req, res) => {
    delete (req.session as any).employeeId;
    delete (req.session as any).employeeClientId;
    res.json({ ok: true });
  });

  app.get('/api/employees', safeHandler(async (req, res) => {
    const tenant = await requireTenantContext(req, res);
    if (!tenant) return;
    const dataClient = getTenantDataClient(req);
    const employees = await listEmployeesForClient(tenant.clientId, dataClient);
    res.json(employees);
  }));

  app.post('/api/employees', safeHandler(async (req, res) => {
    const tenant = await requireTenantContext(req, res);
    if (!tenant) return;
    const actorRole = tenant.role;
    const actorClientId = tenant.clientId;
    const data = normalizeEmployeePayload(req.body);
    const dataClient = getTenantDataClient(req);
    if (actorRole !== 'superadmin') {
      data.emp_id = await nextEmployeeId(actorClientId, dataClient);
      data.annual_leave = 0; data.sick_leave = 0; data.family_leave = 0;
    }
    const errors = validateEmployeePayload(data);
    if (errors.length) return res.status(400).json({ error: errors.join(' ') });
    const dupChecks = [
      data.emp_id ? dataClient.from('employees').select('id').eq('client_id', actorClientId).ilike('emp_id', data.emp_id).limit(1) : null,
      data.email ? dataClient.from('employees').select('id').eq('client_id', actorClientId).ilike('email', data.email).limit(1) : null,
      data.id_number ? dataClient.from('employees').select('id').eq('client_id', actorClientId).eq('id_number', data.id_number).limit(1) : null,
      data.tax_number ? dataClient.from('employees').select('id').eq('client_id', actorClientId).eq('tax_number', data.tax_number).limit(1) : null,
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
      pin: data.pin ? hashSecret(data.pin) : null,
      client_id: actorClientId,
      annual_leave_last_accrual_date: data.start_date,
      sick_cycle_start_date: data.start_date,
      family_leave_last_reset_year: null,
    });
    const { error } = await dataClient.from('employees').insert(employeePayload);
    if (error) return res.status(500).json({ error: error.message });
    logActivity(req, 'CREATE_EMPLOYEE', { emp_id: data.emp_id, name: `${data.first_name} ${data.last_name}` });
    res.json(sanitizeEmployeeForResponse({ id, ...employeePayload }));
  }));

  app.put('/api/employees/:id', safeHandler(async (req, res) => {
    const tenant = await requireTenantContext(req, res);
    if (!tenant) return;
    const dataClient = getTenantDataClient(req);
    const existing = await fetchEmployeeForClient(req.params.id, tenant.clientId, dataClient);
    if (!existing) return res.status(404).json({ error: 'Employee not found' });
    const data = normalizeEmployeePayload({ ...existing, ...req.body, emp_id: req.body?.emp_id || existing.emp_id });
    const errors = validateEmployeePayload(data);
    if (errors.length) return res.status(400).json({ error: errors.join(' ') });
    const { allow_blank_pin: _allowBlankPin, ...persistableData } = data as any;
    const updatePayload = sanitizeEmployeeForSupabase({ ...persistableData, pin: data.pin ? hashSecret(data.pin) : existing.pin || null });
    const { data: updated, error } = await dataClient.from('employees').update(updatePayload).eq('id', req.params.id).eq('client_id', tenant.clientId).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(sanitizeEmployeeForResponse(updated));
  }));

  app.post('/api/employees/:id/offboard', safeHandler(async (req, res) => {
    const tenant = await requireTenantContext(req, res);
    if (!tenant) return;
    const dataClient = getTenantDataClient(req);
    const existing = await fetchEmployeeForClient(req.params.id, tenant.clientId, dataClient);
    if (!existing) return res.status(404).json({ error: 'Employee not found' });
    const payload = {
      status: 'offboarded',
      last_worked: req.body?.last_worked || null,
      last_worked_date: req.body?.last_worked || null,
      delete_reason: req.body?.delete_reason || null,
    };
    const { data, error } = await dataClient.from('employees').update(payload).eq('id', req.params.id).eq('client_id', tenant.clientId).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  }));

  app.post('/api/employees/:id/restore', safeHandler(async (req, res) => {
    const tenant = await requireTenantContext(req, res);
    if (!tenant) return;
    if (tenant.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden: Super Admin access required' });

    const dataClient = getTenantDataClient(req);
    const existing = await fetchEmployeeForClient(req.params.id, tenant.clientId, dataClient);
    if (!existing) return res.status(404).json({ error: 'Employee not found' });
    if (String(existing.status || 'active').toLowerCase() !== 'offboarded') {
      return res.status(400).json({ error: 'Employee is not off-boarded' });
    }

    const payload = {
      status: 'active',
      last_worked: null,
      last_worked_date: null,
      delete_reason: null,
    };
    const { data: restored, error } = await dataClient.from('employees').update(payload).eq('id', req.params.id).eq('client_id', tenant.clientId).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(sanitizeEmployeeForResponse(restored));
  }));

  app.delete('/api/employees/:id', safeHandler(async (req, res) => {
    const tenant = await requireTenantContext(req, res);
    if (!tenant) return;
    const dataClient = getTenantDataClient(req);
    const existing = await fetchEmployeeForClient(req.params.id, tenant.clientId, dataClient);
    if (!existing) return res.status(404).json({ error: 'Employee not found' });
    const { error } = await dataClient.from('employees').delete().eq('id', req.params.id).eq('client_id', tenant.clientId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  }));

  app.get('/api/shifts', safeHandler(async (req, res) => {
    const tenant = await requireTenantContext(req, res);
    if (!tenant) return;
    const dataClient = getTenantDataClient(req);
    const data = await listShiftsForClient(tenant.clientId, dataClient);
    res.json(sortShiftsBaseFirst(data));
  }));

  app.post('/api/shifts', safeHandler(async (req, res) => {
    const tenant = await requireTenantContext(req, res);
    if (!tenant) return;
    const dataClient = getTenantDataClient(req);
    const payload = normalizeShiftPayload(req.body);
    const errors = validateShiftPayload(payload);
    if (errors.length) return res.status(400).json({ error: errors.join(' ') });
    if (tenant.role !== 'superadmin' && isProtectedAdministrativeShiftLabel(payload.label)) {
      return res.status(403).json({ error: 'Only Super Admin can manage administrative shifts.' });
    }
    const id = payload.id || Math.random().toString(36).slice(2, 11);
    const { data, error } = await dataClient.from('shifts').insert({ ...payload, id, client_id: tenant.clientId }).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  }));

  app.put('/api/shifts/:id', safeHandler(async (req, res) => {
    const tenant = await requireTenantContext(req, res);
    if (!tenant) return;
    const dataClient = getTenantDataClient(req);
    const existing = await fetchShiftForClient(req.params.id, tenant.clientId, dataClient);
    if (!existing) return res.status(404).json({ error: 'Shift not found' });
    const payload = normalizeShiftPayload({ ...existing, ...req.body, id: req.params.id });
    const errors = validateShiftPayload(payload);
    if (errors.length) return res.status(400).json({ error: errors.join(' ') });
    if (tenant.role !== 'superadmin' && (isProtectedAdministrativeShiftLabel(existing.label) || isProtectedAdministrativeShiftLabel(payload.label))) {
      return res.status(403).json({ error: 'Only Super Admin can manage administrative shifts.' });
    }
    const { data, error } = await dataClient.from('shifts').update({ ...payload, client_id: tenant.clientId }).eq('id', req.params.id).eq('client_id', tenant.clientId).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  }));

  app.delete('/api/shifts/:id', safeHandler(async (req, res) => {
    const tenant = await requireTenantContext(req, res);
    if (!tenant) return;
    const dataClient = getTenantDataClient(req);
    const existing = await fetchShiftForClient(req.params.id, tenant.clientId, dataClient);
    if (!existing) return res.status(404).json({ error: 'Shift not found' });
    if (tenant.role !== 'superadmin' && isProtectedAdministrativeShiftLabel(existing.label)) {
      return res.status(403).json({ error: 'Only Super Admin can manage administrative shifts.' });
    }
    const { error } = await dataClient.from('shifts').delete().eq('id', req.params.id).eq('client_id', tenant.clientId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  }));

  app.get('/api/roster', safeHandler(async (req, res) => {
    const tenant = await requireTenantContext(req, res);
    if (!tenant) return;
    const clientId = tenant.clientId;
    const dataClient = getTenantDataClient(req);
    const weekStart = String(req.query.week_start || '').trim();
    const periodDays = Math.max(1, Number(req.query.period_days || 7));
    let employeeQuery = dataClient.from('employees').select('id').eq('client_id', clientId);
    const { data: employeeRows } = await employeeQuery;
    const ids = (employeeRows || []).map((r: any) => r.id);
    if (ids.length === 0) return res.json([]);
    let rosterQuery = dataClient.from('roster').select('*').in('employee_id', ids);
    if (weekStart) {
      const start = new Date(`${weekStart}T00:00:00`);
      const end = new Date(start);
      end.setDate(start.getDate() + periodDays - 1);
      rosterQuery = rosterQuery.gte('day_date', weekStart).lte('day_date', formatDateOnly(end));
    }
    const { data, error } = await rosterQuery;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  }));

  app.post('/api/roster', safeHandler(async (req, res) => {
    const tenant = await requireTenantContext(req, res);
    if (!tenant) return;
    const payload = {
      employee_id: String(req.body?.employee_id || '').trim(),
      day_date: String(req.body?.day_date || '').trim(),
      shift_id: req.body?.shift_id || null,
      updated_at: new Date().toISOString(),
    };
    if (!payload.employee_id || !payload.day_date) return res.status(400).json({ error: 'employee_id and day_date are required' });

    const dataClient = getTenantDataClient(req);
    const employee = await fetchEmployeeForClient(payload.employee_id, tenant.clientId, dataClient);
    if (!employee) return res.status(403).json({ error: 'Forbidden' });
    if (payload.shift_id) {
      const shift = await fetchShiftForClient(String(payload.shift_id), tenant.clientId, dataClient);
      if (!shift) return res.status(400).json({ error: 'Selected shift does not belong to the active client.' });
    }

    const actorRole = tenant.role;
    const requestedDay = new Date(`${payload.day_date}T00:00:00`);
    const isSundayRequest = !Number.isNaN(requestedDay.getTime()) && requestedDay.getDay() === 0;
    if (actorRole !== 'superadmin' && payload.shift_id && !isSundayRequest) {
      const previousDayIso = getPreviousDayIso(payload.day_date);
      if (previousDayIso) {
        const { data: previousRosterRow } = await dataClient
          .from('roster')
          .select('shift_id')
          .eq('employee_id', payload.employee_id)
          .eq('day_date', previousDayIso)
          .maybeSingle();

        const previousShiftId = previousRosterRow?.shift_id ? String(previousRosterRow.shift_id) : null;
        if (previousShiftId) {
          const shiftIds = [previousShiftId, String(payload.shift_id)];
          const { data: shiftRows, error: shiftError } = await dataClient
            .from('shifts')
            .select('id,label,start,end,client_id')
            .eq('client_id', tenant.clientId)
            .in('id', shiftIds);
          if (shiftError) return res.status(500).json({ error: shiftError.message });

          const previousShift = (shiftRows || []).find((row: any) => String(row.id) === previousShiftId) as any;
          const nextShift = (shiftRows || []).find((row: any) => String(row.id) === String(payload.shift_id)) as any;
          if (doesShiftStartOverlapPrevious(previousShift, nextShift)) {
            return res.status(400).json({
              error: `${String(nextShift?.label || 'Selected shift')} cannot be allocated because it starts before the previous shift ends at ${formatShiftTimeLabel(previousShift?.end)}.`,
            });
          }
        }
      }
    }

    const { data, error } = await dataClient.from('roster').upsert(payload, { onConflict: 'employee_id,day_date' }).select('*').single();
    if (error) return res.status(500).json({ error: error.message });

    let leaveSyncWarning: string | null = null;
    try {
      await syncRosterLeaveRecordsForEmployeeSupabase(payload.employee_id, tenant.clientId);
    } catch (leaveSyncError: any) {
      console.error('Failed to sync Supabase roster leave records:', leaveSyncError);
      leaveSyncWarning = leaveSyncError?.message || 'Leave balances could not be synchronized.';
    }

    if (leaveSyncWarning) {
      return res.json({ ...data, leave_sync_warning: leaveSyncWarning });
    }

    res.json(data);
  }));

  app.get('/api/roster-meta', safeHandler(async (req, res) => {
    const tenant = await requireTenantContext(req, res);
    if (!tenant) return;
    const clientId = tenant.clientId;
    const dataClient = getTenantDataClient(req);
    const weekStart = String(req.query.week_start || '').trim();
    let employeeQuery = dataClient.from('employees').select('id').eq('client_id', clientId);
    const { data: employeeRows } = await employeeQuery;
    const ids = (employeeRows || []).map((r: any) => r.id);
    if (ids.length === 0) return res.json([]);
    let query = dataClient.from('roster_meta').select('*').in('employee_id', ids);
    if (weekStart) query = query.eq('week_start', weekStart);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  }));

  app.post('/api/roster-meta', safeHandler(async (req, res) => {
    const tenant = await requireTenantContext(req, res);
    if (!tenant) return;
    const employeeId = String(req.body?.employee_id || '').trim();
    const weekStart = String(req.body?.week_start || '').trim();
    const field = String(req.body?.field || '').trim();
    const value = req.body?.value ?? '';
    if (!employeeId || !weekStart || !field) return res.status(400).json({ error: 'employee_id, week_start and field are required' });
    const allowedFields = new Set(['salary_advance','shortages','unpaid_hours','loan_amount','staff_loan','uniform','overthrows','oil_spill','stock_shortage','annual_bonus','incentive_bonus','data_allowance','night_shift_allowance','medical_allowance','mibco_health_insurance','health_insurance','garnishee','cell_phone_payment','income_tax_registration','performance_incentive','commission','sales_commission','notes']);
    if (!allowedFields.has(field)) return res.status(400).json({ error: 'Unsupported roster meta field' });
    const dataClient = getTenantDataClient(req);
    const employee = await fetchEmployeeForClient(employeeId, tenant.clientId, dataClient);
    if (!employee) return res.status(403).json({ error: 'Forbidden' });
    const base: any = { employee_id: employeeId, week_start: weekStart, updated_at: new Date().toISOString() };
    base[field] = String(value);
    const { data, error } = await dataClient.from('roster_meta').upsert(base, { onConflict: 'employee_id,week_start' }).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  }));


  app.get('/api/analytics', safeHandler(async (req, res) => {
    const tenant = await requireTenantContext(req, res);
    if (!tenant) return;
    try {
      const dataClient = getTenantDataClient(req);
      const month = String(req.query.month || new Date().toISOString().slice(0, 7));
      const selectedMonthDate = new Date(`${month}-01T00:00:00`);
      if (Number.isNaN(selectedMonthDate.getTime())) {
        return res.status(400).json({ error: 'Invalid month supplied' });
      }

      const buildMonthKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const buildMonthLabel = (monthKey: string) => {
        const [y, m] = monthKey.split('-').map(Number);
        return new Date(y, (m || 1) - 1, 1).toLocaleDateString('en-ZA', { month: 'short', year: 'numeric' });
      };
      const getMonthStart = (monthKey: string) => `${monthKey}-01`;
      const getMonthEnd = (monthKey: string) => {
        const [year, monthNumber] = monthKey.split('-').map(Number);
        return new Date(year, monthNumber, 0).toISOString().slice(0, 10);
      };

      const currentPrefix = buildMonthKey(selectedMonthDate);
      const prevMonthDate = new Date(selectedMonthDate);
      prevMonthDate.setMonth(prevMonthDate.getMonth() - 1);
      const prevPrefix = buildMonthKey(prevMonthDate);

      const trendMonths: string[] = [];
      for (let offset = 5; offset >= 0; offset -= 1) {
        const d = new Date(selectedMonthDate);
        d.setMonth(d.getMonth() - offset);
        trendMonths.push(buildMonthKey(d));
      }
      const trendStart = getMonthStart(trendMonths[0]);
      const trendEnd = getMonthEnd(trendMonths[trendMonths.length - 1]);
      const selectedMonthStart = getMonthStart(currentPrefix);
      const selectedMonthEnd = getMonthEnd(currentPrefix);

      const clientId = tenant.clientId;

      let employeesQuery = dataClient.from('employees').select('*').eq('client_id', clientId);
      const { data: employeesData, error: employeesError } = await employeesQuery;
      if (employeesError) return res.status(500).json({ error: employeesError.message });
      const employees = (employeesData || []) as any[];
      const employeeIds = employees.map((e) => e.id).filter(Boolean);

      const { data: shiftsData, error: shiftsError } = await dataClient.from('shifts').select('*').eq('client_id', clientId);
      if (shiftsError) return res.status(500).json({ error: shiftsError.message });
      const shifts = (shiftsData || []) as any[];

      let roster: any[] = [];
      if (employeeIds.length) {
        const { data: rosterData, error: rosterError } = await dataClient
          .from('roster')
          .select('*')
          .in('employee_id', employeeIds)
          .gte('day_date', trendStart)
          .lte('day_date', trendEnd);
        if (rosterError) return res.status(500).json({ error: rosterError.message });
        roster = (rosterData || []) as any[];
      }

      let leaveRequests: any[] = [];
      if (employeeIds.length) {
        const { data: leaveData, error: leaveError } = await dataClient
          .from('leave_requests')
          .select('*')
          .in('employee_id', employeeIds)
          .lte('start_date', selectedMonthEnd)
          .gte('end_date', selectedMonthStart);
        if (leaveError) return res.status(500).json({ error: leaveError.message });
        leaveRequests = (leaveData || []) as any[];
      }

      let payrollSubmissions: any[] = [];
      let payrollSubmissionsQuery = dataClient
        .from('payroll_submissions')
        .select('id, client_id, client_name, submitted_at, period_start, period_end, period, employee_count, status, total_hours, total_pay');
      if (clientId) {
        payrollSubmissionsQuery = payrollSubmissionsQuery.eq('client_id', clientId);
      }
      payrollSubmissionsQuery = payrollSubmissionsQuery.order('submitted_at', { ascending: false }).limit(12);
      const { data: submissionsData, error: submissionsError } = await payrollSubmissionsQuery;
      if (!submissionsError) {
        payrollSubmissions = (submissionsData || []) as any[];
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
          durationHours = Math.max(0, (endMins - startMins - (Number(s.lunch) || 0)) / 60);
        }
        shiftMap.set(s.id, { ...s, durationHours });
      });

      const calculateEntry = (r: any, emp: any) => {
        const shift = shiftMap.get(r.shift_id);
        if (!shift) return null;
        const date = new Date(`${r.day_date}T00:00:00`);
        const isSunday = date.getDay() === 0;
        let category = 'Normal Time';
        let hours = Number(shift.durationHours) || 0;
        const shiftLabel = String(shift.label || '').toLowerCase();
        if (shiftLabel.includes('unpaid leave') || shiftLabel.includes('absent') || shiftLabel.includes('unshifted')) {
          category = 'Absent';
          hours = 0;
        } else if (shiftLabel.includes('half day')) {
          category = 'Leave';
          hours = 4.5;
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
      const weeklyData: Record<string, { shifts: number; amount: number; hours: number }> = {};
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
      const employeeStats: Record<string, { id: string; name: string; amount: number; annual: number; sick: number; family: number; shifts: number; hours: number }> = {};
      const monthlyBuckets = new Map<string, { amount: number; shifts: number; hours: number }>();
      trendMonths.forEach((monthKey) => monthlyBuckets.set(monthKey, { amount: 0, shifts: 0, hours: 0 }));

      employees.forEach((emp: any) => {
        employeeStats[emp.id] = {
          id: emp.id,
          name: `${emp.first_name || ''} ${emp.last_name || ''}`.trim(),
          amount: 0,
          annual: Number(emp.annual_leave) || 0,
          sick: Number(emp.sick_leave) || 0,
          family: Number(emp.family_leave) || 0,
          shifts: 0,
          hours: 0,
        };
      });

      roster.forEach((r: any) => {
        const emp = employees.find((e: any) => e.id === r.employee_id);
        if (!emp) return;
        const monthKey = String(r.day_date || '').slice(0, 7);
        const entries = calculateEntry(r, emp);
        if (!entries) return;

        let dayTotal = 0;
        let dayHours = 0;
        entries.forEach((entry: any) => {
          dayTotal += entry.amount;
          dayHours += Number(entry.hours) || 0;
          if (monthKey === currentPrefix) {
            breakdown[entry.category] = (breakdown[entry.category] || 0) + entry.amount;
          }
        });

        if (monthlyBuckets.has(monthKey)) {
          const bucket = monthlyBuckets.get(monthKey)!;
          bucket.amount += dayTotal;
          bucket.hours += dayHours;
          bucket.shifts += 1;
        }

        if (monthKey === currentPrefix) {
          currentTotal += dayTotal;
          employeeStats[emp.id].amount += dayTotal;
          employeeStats[emp.id].shifts += 1;
          employeeStats[emp.id].hours += dayHours;
          const date = new Date(`${r.day_date}T00:00:00`);
          const weekNum = Math.ceil(date.getDate() / 7);
          const weekKey = `Week ${weekNum}`;
          if (!weeklyData[weekKey]) weeklyData[weekKey] = { shifts: 0, amount: 0, hours: 0 };
          weeklyData[weekKey].shifts += 1;
          weeklyData[weekKey].amount += dayTotal;
          weeklyData[weekKey].hours += dayHours;
        } else if (monthKey === prevPrefix) {
          prevTotal += dayTotal;
        }
      });

      const activeEmployees = employees.filter((e: any) => e.status !== 'offboarded');
      const totalEmployees = employees.length;
      const activeCount = activeEmployees.length;
      const offboardedCount = totalEmployees - activeCount;
      const activeWorkedThisMonth = Object.values(employeeStats).filter((employee: any) => {
        const employeeRecord = employees.find((sourceEmployee: any) => sourceEmployee.id === employee.id);
        return employee.amount > 0 && employeeRecord && employeeRecord.status !== 'offboarded';
      });
      const avgSalary = activeWorkedThisMonth.length > 0
        ? currentTotal / activeWorkedThisMonth.length
        : 0;
      const nonZeroWeeks = Object.values(weeklyData).filter((w) => w.amount > 0);
      const avgWeeklyBill = nonZeroWeeks.length > 0
        ? nonZeroWeeks.reduce((sum, w) => sum + w.amount, 0) / nonZeroWeeks.length
        : 0;
      const totalHoursThisMonth = Object.values(weeklyData).reduce((sum, w) => sum + w.hours, 0);
      const avgHoursPerShift = currentTotal > 0 && Object.values(weeklyData).reduce((sum, w) => sum + w.shifts, 0) > 0
        ? totalHoursThisMonth / Object.values(weeklyData).reduce((sum, w) => sum + w.shifts, 0)
        : 0;

      const weeklyChart = Object.keys(weeklyData)
        .sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')))
        .map((week) => ({ week, shifts: weeklyData[week].shifts, amount: weeklyData[week].amount, hours: weeklyData[week].hours }));
      const breakdownArray = Object.keys(breakdown)
        .filter((k) => breakdown[k] > 0)
        .map((category) => ({ category, amount: breakdown[category] }));
      const employeeShare = Object.values(employeeStats)
        .filter((e) => e.amount > 0)
        .map((e) => ({
          id: e.id,
          name: e.name,
          amount: e.amount,
          shifts: e.shifts,
          hours: e.hours,
          percentage: currentTotal > 0 ? (e.amount / currentTotal) * 100 : 0,
        }))
        .sort((a, b) => b.amount - a.amount);

      const activeEmployeeIds = new Set(activeEmployees.map((e: any) => e.id));
      const leaveAnalytics = Object.entries(employeeStats)
        .filter(([employeeId]) => activeEmployeeIds.has(employeeId))
        .map(([, e]: any) => ({ id: e.id, name: e.name, annual: e.annual, sick: e.sick, family: e.family }))
        .sort((a: any, b: any) => a.name.localeCompare(b.name));

      const monthlyTrend = trendMonths.map((monthKey) => ({
        month: monthKey,
        label: buildMonthLabel(monthKey),
        amount: monthlyBuckets.get(monthKey)?.amount || 0,
        shifts: monthlyBuckets.get(monthKey)?.shifts || 0,
        hours: monthlyBuckets.get(monthKey)?.hours || 0,
      }));

      const leaveRequestStats = leaveRequests.reduce((acc: any, request: any) => {
        const status = String(request.status || 'pending');
        acc[status] = (acc[status] || 0) + 1;
        if (status === 'approved') {
          acc.approvedDays += Number(request.days) || 0;
        }
        return acc;
      }, { pending: 0, approved: 0, declined: 0, cancelled: 0, approvedDays: 0 });

      const recentPayrollSubmissions = payrollSubmissions.slice(0, 6).map((submission: any) => ({
        id: submission.id,
        period: submission.period || `${submission.period_start || ''} to ${submission.period_end || ''}`.trim(),
        submittedAt: submission.submitted_at,
        status: submission.status || 'pending',
        employeeCount: Number(submission.employee_count) || 0,
        totalHours: Number(submission.total_hours) || 0,
        totalPay: Number(submission.total_pay) || 0,
      }));
      const latestSubmission = recentPayrollSubmissions[0] || null;

      return res.json({
        kpis: {
          currentTotal,
          prevTotal,
          avgSalary,
          avgWeeklyBill,
          totalEmployees,
          activeCount,
          offboardedCount,
          totalHoursThisMonth,
          avgHoursPerShift,
          approvedLeaveDays: leaveRequestStats.approvedDays,
          pendingLeaveRequests: leaveRequestStats.pending,
          latestSubmissionTotal: latestSubmission?.totalPay || 0,
          latestSubmissionEmployeeCount: latestSubmission?.employeeCount || 0,
        },
        weeklyChart,
        monthlyTrend,
        breakdown: breakdownArray,
        employeeShare,
        leaveAnalytics,
        leaveRequestStats,
        recentPayrollSubmissions,
      });
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to load analytics' });
    }
  }));

  app.get('/api/leave-requests', safeHandler(async (req, res) => {
    if (!ensureUserOrEmployee(req, res)) return;
    const employeeSessionId = getSessionEmployeeId(req);
    const tenant = employeeSessionId ? null : await requireTenantContext(req, res);
    if (!employeeSessionId && !tenant) return;
    let employeeId = typeof req.query.employee_id === 'string' ? req.query.employee_id : null;
    if (employeeSessionId) employeeId = employeeSessionId;

    try {
      if (employeeId) {
        await reconcileEmployeeLeaveAccrualSupabase(employeeId);
      }
      const dataClient = getTenantDataClient(req);
      let query = dataClient.from('leave_requests').select('*').order('created_at', { ascending: false });
      if (employeeId) {
        query = query.eq('employee_id', employeeId);
      } else {
        const clientId = tenant.clientId;
        if (clientId) {
          const { data: employeeRows } = await dataClient.from('employees').select('id').eq('client_id', clientId);
          const ids = (employeeRows || []).map((row: any) => row.id);
          if (!ids.length) return res.json([]);
          query = query.in('employee_id', ids);
        }
      }
      const { data, error } = await query;
      if (error) return res.status(500).json({ error: error.message });
      const ids = Array.from(new Set((data || []).map((row: any) => row.employee_id).filter(Boolean)));
      let nameMap = new Map<string, string>();
      if (ids.length) {
        const { data: emps } = await dataClient.from('employees').select('id,first_name,last_name').in('id', ids);
        nameMap = new Map((emps || []).map((e: any) => [e.id, `${e.first_name || ''} ${e.last_name || ''}`.trim()]));
      }
      res.json((data || []).map((row: any) => ({ ...row, employee_name: nameMap.get(row.employee_id) || '' })));
    } catch (error: any) {
      res.status(500).json({ error: error?.message || 'Failed to fetch leave requests' });
    }
  }));

  app.post('/api/leave-requests', safeHandler(async (req, res) => {
    if (!ensureUserOrEmployee(req, res)) return;
    const employeeSessionId = getSessionEmployeeId(req);
    const employee_id = String(req.body?.employee_id || employeeSessionId || '').trim();
    if (!employee_id) return res.status(400).json({ error: 'Employee is required' });

    try {
      await reconcileEmployeeLeaveAccrualSupabase(employee_id);
      const employee = await fetchEmployeeById(employee_id);
      if (!employee) return res.status(404).json({ error: 'Employee not found' });
      const clientId = await resolveLeaveClientId(req, employee_id);
      if (clientId && employee.client_id && String(employee.client_id) !== String(clientId)) return res.status(403).json({ error: 'Forbidden' });

      const type = normalizeLeaveType(req.body?.type);
      const start_date = String(req.body?.start_date || '').slice(0,10);
      const end_date = String(req.body?.end_date || '').slice(0,10);
      const is_half_day = parseBoolean(req.body?.is_half_day);
      const requestedStatus = normalizeLeaveStatus(req.body?.status);
      const status: LeaveStatusValue = getSessionUserId(req) && requestedStatus === 'approved' ? 'approved' : 'pending';
      if (!type || !start_date || !end_date) return res.status(400).json({ error: 'Type, start date and end date are required' });
      if (start_date > end_date) return res.status(400).json({ error: 'End date cannot be before start date' });

      const overlaps = await getExistingLeaveOverlap(employee_id, start_date, end_date, null);
      if (overlaps.length && !parseBoolean(req.body?.override_double_booking)) {
        return res.status(409).json({ error: 'Overlapping leave already exists', details: { code: 'DOUBLE_BOOKED' } });
      }

      const days = Number(req.body?.days || getWeekdayLeaveDays(start_date, end_date, is_half_day));
      const trackedType = getBalanceTrackedLeaveType(type);
      if (status === 'approved' && trackedType && !parseBoolean(req.body?.allow_negative_balance)) {
        const available = Number(employee[LEAVE_COLUMNS[trackedType]]) || 0;
        if (days > available) {
          return res.status(409).json({ error: 'Insufficient leave balance', details: { code: 'INSUFFICIENT_LEAVE', available, requested: days } });
        }
      }

      const id = `leave_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const dataClient = getTenantDataClient(req);
      const payload = {
        id,
        employee_id,
        type,
        start_date,
        end_date,
        is_half_day,
        status,
        notes: String(req.body?.notes || ''),
        admin_notes: String(req.body?.admin_notes || ''),
        days,
        source: 'manual',
        attachment_url: '',
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await dataClient.from('leave_requests').insert(payload).select('*').single();
      if (error) return res.status(500).json({ error: error.message });
      if (status === 'approved') await adjustEmployeeLeaveBalanceSupabase(employee_id, type, -days);
      await reconcileEmployeeLeaveAccrualSupabase(employee_id);
      res.status(201).json(data);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || 'Failed to create leave request' });
    }
  }));

  app.put('/api/leave-requests/:id/status', safeHandler(async (req, res) => {
    if (!ensureUser(req, res)) return;
    const status = normalizeLeaveStatus(req.body?.status);
    if (!status || !['approved','declined'].includes(status)) return res.status(400).json({ error: 'Valid status is required' });

    try {
      const dataClient = getTenantDataClient(req);
      const { data: existing, error: existingError } = await dataClient.from('leave_requests').select('*').eq('id', req.params.id).single();
      if (existingError || !existing) return res.status(404).json({ error: 'Leave request not found' });
      await reconcileEmployeeLeaveAccrualSupabase(existing.employee_id);
      const employee = await fetchEmployeeById(existing.employee_id);
      if (!employee) return res.status(404).json({ error: 'Employee not found' });
      const clientId = await resolveLeaveClientId(req, existing.employee_id);
      if (clientId && employee.client_id && String(employee.client_id) !== String(clientId)) return res.status(403).json({ error: 'Forbidden' });

      const type = normalizeLeaveType(existing.type);
      const days = Number(existing.days || 0);
      if (status === 'approved' && existing.status !== 'approved') {
        const overlaps = await getExistingLeaveOverlap(existing.employee_id, existing.start_date, existing.end_date, existing.id);
        if (overlaps.length && !parseBoolean(req.body?.override_double_booking)) {
          return res.status(409).json({ error: 'Overlapping leave already exists', details: { code: 'DOUBLE_BOOKED' } });
        }
        const trackedType = type ? getBalanceTrackedLeaveType(type) : null;
        if (trackedType && !parseBoolean(req.body?.allow_negative_balance)) {
          const available = Number(employee[LEAVE_COLUMNS[trackedType]]) || 0;
          if (days > available) {
            return res.status(409).json({ error: 'Insufficient leave balance', details: { code: 'INSUFFICIENT_LEAVE', available, requested: days } });
          }
        }
      }

      const { data, error } = await dataClient.from('leave_requests').update({ status, admin_notes: String(req.body?.admin_notes || ''), updated_at: new Date().toISOString() }).eq('id', req.params.id).select('*').single();
      if (error) return res.status(500).json({ error: error.message });
      if (type) {
        if (existing.status === 'approved' && status !== 'approved') await adjustEmployeeLeaveBalanceSupabase(existing.employee_id, type, days);
        if (existing.status !== 'approved' && status === 'approved') await adjustEmployeeLeaveBalanceSupabase(existing.employee_id, type, -days);
      }
      await reconcileEmployeeLeaveAccrualSupabase(existing.employee_id);
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || 'Failed to update leave request' });
    }
  }));

  app.post('/api/leave-requests/:id/cancel', safeHandler(async (req, res) => {
    if (!ensureUserOrEmployee(req, res)) return;
    try {
      const dataClient = getTenantDataClient(req);
      const { data: existing, error: existingError } = await dataClient.from('leave_requests').select('*').eq('id', req.params.id).single();
      if (existingError || !existing) return res.status(404).json({ error: 'Leave request not found' });
      const { data, error } = await dataClient.from('leave_requests').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', req.params.id).select('*').single();
      if (error) return res.status(500).json({ error: error.message });
      const type = normalizeLeaveType(existing.type);
      if (type && existing.status === 'approved') await adjustEmployeeLeaveBalanceSupabase(existing.employee_id, type, Number(existing.days || 0));
      await reconcileEmployeeLeaveAccrualSupabase(existing.employee_id);
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || 'Failed to cancel leave request' });
    }
  }));
}
