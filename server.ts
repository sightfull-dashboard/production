import express from "express";
import { createServer as createViteServer } from "vite";
import session from "express-session";
import bcrypt from "bcryptjs";
import path from "node:path";
import { env, isProduction, isSmtpConfigured, isSupabaseConfigured } from "./src/server/config/env";
import { db, getDatabaseReadiness } from "./src/server/db/index";
import { getLastMailEvent, getMailerReadiness, sendMailMessage, setLastMailEvent, verifyMailTransport } from "./src/server/integrations/mailer";
import { calculateEmployeePayroll } from "./src/services/PayrollService";
import { getSupabaseReadiness } from "./src/server/integrations/supabase";
import { registerAdminRoutes } from "./src/server/routes/admin";
import { registerAuthSystemRoutes } from "./src/server/routes/authSystem";
import { registerFilesRoutes } from "./src/server/routes/files";
import { registerLeaveRoutes } from "./src/server/routes/leave";
import { registerWorkforceRoutes } from "./src/server/routes/workforce";


const getEffectiveClientId = (db: typeof import('./src/server/db/index').db, req: express.Request) => {
  const session: any = req.session || {};
  const role = session.userRole || session.role;
  if (role === 'superadmin') {
    const headerValue = req.get('x-active-client-id');
    if (headerValue && String(headerValue).trim()) return String(headerValue).trim();
  }
  if (session.userId) {
    const row = db.prepare('SELECT client_id FROM users WHERE id = ?').get(session.userId) as any;
    if (row?.client_id) return row.client_id as string;
  }
  if (session.employeeId) {
    const row = db.prepare('SELECT client_id FROM employees WHERE id = ?').get(session.employeeId) as any;
    if (row?.client_id) return row.client_id as string;
  }
  return null;
};

function getSessionUser(req: any) {
  const userId = (req.session as any)?.userId;
  if (!userId) return null;
  return db.prepare(`
    SELECT u.id, u.email, u.role, u.client_id, u.is_trial, u.trial_end_date, c.name as client_name, c.locked_features
    FROM users u
    LEFT JOIN clients c ON c.id = u.client_id
    WHERE u.id = ?
  `).get(userId) as any;
}

const LEAVE_COLUMNS = {
  annual: 'annual_leave',
  sick: 'sick_leave',
  family: 'family_leave',
} as const;

type BalanceLeaveTypeKey = keyof typeof LEAVE_COLUMNS;
type LeaveTypeKey = BalanceLeaveTypeKey | 'unpaid' | 'half_day';
type LeaveStatusValue = 'pending' | 'approved' | 'declined' | 'cancelled';

const isValidISODate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const normalizeLeaveType = (value: unknown): LeaveTypeKey | null => value === 'annual' || value === 'sick' || value === 'family' || value === 'unpaid' || value === 'half_day' ? value : null;
const getBalanceTrackedLeaveType = (type: LeaveTypeKey): BalanceLeaveTypeKey | null => {
  if (type === 'half_day') return 'annual';
  if (type === 'annual' || type === 'sick' || type === 'family') return type;
  return null;
};
const normalizeLeaveStatus = (value: unknown): LeaveStatusValue | null => value === 'pending' || value === 'approved' || value === 'declined' || value === 'cancelled' ? value : null;
const parseBoolean = (value: unknown) => value === true || value === 1 || value === '1';
const toDateOnly = (value: string) => value.split('T')[0];
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

const adjustEmployeeLeaveBalance = (employeeId: string, type: LeaveTypeKey, amountDelta: number) => {
  const trackedType = getBalanceTrackedLeaveType(type);
  if (!trackedType) return;
  const column = LEAVE_COLUMNS[trackedType];
  db.prepare(`UPDATE employees SET ${column} = COALESCE(${column}, 0) + ? WHERE id = ?`).run(amountDelta, employeeId);
};

const overlapWhereSql = `lr.start_date <= ? AND lr.end_date >= ?`;
const dateRangesOverlap = (startA: string, endA: string, startB: string, endB: string) => startA <= endB && startB <= endA;
const getDateOnlyPlusDays = (dateOnly: string, days: number) => {
  const date = new Date(`${dateOnly}T00:00:00`);
  date.setDate(date.getDate() + days);
  return toLocalIsoDate(date);
};
const getLeaveTypeFromShiftLabel = (label: unknown): LeaveTypeKey | null => {
  const normalized = String(label || '').trim().toLowerCase();
  if (normalized === 'annual leave') return 'annual';
  if (normalized === 'sick leave') return 'sick';
  if (normalized === 'family leave') return 'family';
  return null;
};

const leaveRequestSelect = `
  SELECT lr.*, e.first_name, e.last_name
  FROM leave_requests lr
  JOIN employees e ON e.id = lr.employee_id
`;

const getOverlapLeaveRequests = ({ employeeId, startDate, endDate, excludeId }: { employeeId: string; startDate: string; endDate: string; excludeId?: string | null }) => {
  const params: any[] = [employeeId, endDate, startDate];
  let sql = `${leaveRequestSelect} WHERE lr.employee_id = ? AND lr.status IN ('pending', 'approved') AND ${overlapWhereSql}`;
  if (excludeId) {
    sql += ' AND lr.id != ?';
    params.push(excludeId);
  }
  sql += ' ORDER BY lr.start_date ASC, lr.created_at ASC';
  return db.prepare(sql).all(...params) as any[];
};

const cancelLeaveRequestForRosterOverride = (requestRow: any, reason: string) => {
  const type = normalizeLeaveType(requestRow.type);
  if (type && normalizeLeaveStatus(requestRow.status) === 'approved') {
    adjustEmployeeLeaveBalance(requestRow.employee_id, type, Number(requestRow.days) || 0);
  }
  const mergedNotes = [requestRow.admin_notes, reason].filter(Boolean).join(' | ');
  db.prepare(`UPDATE leave_requests SET status = 'cancelled', admin_notes = ?, updated_at = ? WHERE id = ?`).run(mergedNotes, new Date().toISOString(), requestRow.id);
};

const syncRosterLeaveRecordsForEmployee = (employeeId: string) => {
  const existingRosterRows = db.prepare(`${leaveRequestSelect} WHERE lr.employee_id = ? AND COALESCE(lr.source, 'manual') = 'roster' ORDER BY lr.start_date ASC`).all(employeeId) as any[];
  const oldTotals: Record<BalanceLeaveTypeKey, number> = { annual: 0, sick: 0, family: 0 };
  existingRosterRows.forEach((row) => {
    const type = normalizeLeaveType(row.type);
    const trackedType = type ? getBalanceTrackedLeaveType(type) : null;
    if (trackedType && normalizeLeaveStatus(row.status) === 'approved') {
      oldTotals[trackedType] += Number(row.days) || 0;
    }
  });

  const rosterLeaveRows = db.prepare(`
    SELECT r.day_date, s.label
    FROM roster r
    JOIN shifts s ON s.id = r.shift_id
    WHERE r.employee_id = ?
      AND lower(trim(s.label)) IN ('annual leave', 'sick leave', 'family leave')
    ORDER BY r.day_date ASC
  `).all(employeeId) as Array<{ day_date: string; label: string }>;

  const segments: Array<{ type: LeaveTypeKey; start_date: string; end_date: string; days: number }> = [];
  rosterLeaveRows.forEach((row) => {
    const type = getLeaveTypeFromShiftLabel(row.label);
    if (!type) return;
    const last = segments[segments.length - 1];
    const expectedNext = last ? getDateOnlyPlusDays(last.end_date, 1) : null;
    if (last && last.type === type && expectedNext === row.day_date) {
      last.end_date = row.day_date;
      last.days = getWeekdayLeaveDays(last.start_date, last.end_date, false);
      return;
    }
    segments.push({ type, start_date: row.day_date, end_date: row.day_date, days: getWeekdayLeaveDays(row.day_date, row.day_date, false) });
  });

  segments.forEach((segment) => {
    const overlaps = db.prepare(`${leaveRequestSelect} WHERE lr.employee_id = ? AND COALESCE(lr.source, 'manual') != 'roster' AND lr.status IN ('pending', 'approved') AND ${overlapWhereSql}`)
      .all(employeeId, segment.end_date, segment.start_date) as any[];
    overlaps.forEach((row) => cancelLeaveRequestForRosterOverride(row, `Overridden by roster leave from ${segment.start_date} to ${segment.end_date}.`));
  });

  db.prepare(`DELETE FROM leave_requests WHERE employee_id = ? AND COALESCE(source, 'manual') = 'roster'`).run(employeeId);

  const newTotals: Record<BalanceLeaveTypeKey, number> = { annual: 0, sick: 0, family: 0 };
  const now = new Date().toISOString();
  const insertStmt = db.prepare(`
    INSERT INTO leave_requests (id, employee_id, type, start_date, end_date, is_half_day, status, notes, attachment_url, admin_notes, days, source, source_ref, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 0, 'approved', ?, '', ?, ?, 'roster', ?, ?, ?)
  `);
  segments.forEach((segment, index) => {
    newTotals[segment.type] += Number(segment.days) || 0;
    insertStmt.run(
      `leave_roster_${employeeId}_${segment.type}_${segment.start_date}_${segment.end_date}_${index}`,
      employeeId,
      segment.type,
      segment.start_date,
      segment.end_date,
      'Auto-created from roster',
      'Roster leave entry',
      segment.days,
      `${employeeId}:${segment.type}:${segment.start_date}:${segment.end_date}`,
      now,
      now,
    );
  });

  (Object.keys(LEAVE_COLUMNS) as BalanceLeaveTypeKey[]).forEach((type) => {
    const delta = oldTotals[type] - newTotals[type];
    if (delta !== 0) adjustEmployeeLeaveBalance(employeeId, type, delta);
  });
};
(globalThis as any).syncRosterLeaveRecordsForEmployee = syncRosterLeaveRecordsForEmployee;

const serializeLeaveRequest = (row: any) => ({
  id: row.id,
  employee_id: row.employee_id,
  employee_name: `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim(),
  type: row.type,
  start_date: row.start_date,
  end_date: row.end_date,
  is_half_day: Boolean(row.is_half_day),
  status: row.status,
  notes: row.notes ?? '',
  attachment_url: row.attachment_url ?? '',
  admin_notes: row.admin_notes ?? '',
  days: Number(row.days) || 0,
  source: row.source || 'manual',
  created_at: row.created_at,
  updated_at: row.updated_at ?? row.created_at,
});


type PayrollSubmissionStatus = 'pending' | 'processed' | 'archived';

const normalizePayrollSubmissionStatus = (value: unknown): PayrollSubmissionStatus | null =>
  value === 'pending' || value === 'processed' || value === 'archived' ? value : null;

const safeJsonParse = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};



type PayrollMailBreakdownRow = {
  employeeName: string;
  regularHours: number;
  overtimeHours: number;
  leaveHours: number;
  grossPay: number;
};

const csvEscape = (value: unknown) => {
  const raw = String(value ?? '');
  return /[",\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
};

const formatPayrollCsv = (rows: PayrollMailBreakdownRow[]) => {
  const header = ['Employee Name', 'Regular Hours', 'Overtime Hours', 'Leave Hours', 'Gross Pay'];
  const body = rows.map((row) => [
    row.employeeName,
    Number(row.regularHours || 0).toFixed(2),
    Number(row.overtimeHours || 0).toFixed(2),
    Number(row.leaveHours || 0).toFixed(2),
    Number(row.grossPay || 0).toFixed(2),
  ]);
  return [header, ...body].map((line) => line.map(csvEscape).join(',')).join('\n');
};


const PDF_PAGE_WIDTH = 595.28;
const PDF_PAGE_HEIGHT = 841.89;
const PDF_MARGIN = 40;
const PDF_FONT_SIZE = 10;
const PDF_LINE_HEIGHT = 14;

const escapePdfText = (value: string) => String(value || '').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

const buildSimplePdfBuffer = (title: string, lines: string[]) => {
  const contentLines: string[] = [];
  let currentY = PDF_PAGE_HEIGHT - PDF_MARGIN;
  let pageContent = 'BT\n/F1 ' + PDF_FONT_SIZE + ' Tf\n';

  const flushLine = (line: string) => {
    pageContent += `1 0 0 1 ${PDF_MARGIN} ${currentY.toFixed(2)} Tm (${escapePdfText(line)}) Tj\n`;
    currentY -= PDF_LINE_HEIGHT;
  };

  const startNewPage = () => {
    contentLines.push(pageContent + 'ET\n');
    currentY = PDF_PAGE_HEIGHT - PDF_MARGIN;
    pageContent = 'BT\n/F1 ' + PDF_FONT_SIZE + ' Tf\n';
  };

  [title, '', ...lines].forEach((line) => {
    if (currentY < PDF_MARGIN) startNewPage();
    flushLine(line);
  });
  contentLines.push(pageContent + 'ET\n');

  const objects: string[] = [];
  objects.push('1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj');
  const pageRefs = contentLines.map((_, index) => `${3 + index} 0 R`).join(' ');
  objects.push(`2 0 obj << /Type /Pages /Kids [${pageRefs}] /Count ${contentLines.length} >> endobj`);

  const fontObjectNumber = 3 + contentLines.length;
  const contentObjectNumbers: number[] = [];

  contentLines.forEach((content, index) => {
    const pageObjectNumber = 3 + index;
    const contentObjectNumber = fontObjectNumber + 1 + index;
    contentObjectNumbers.push(contentObjectNumber);
    objects.push(`${pageObjectNumber} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_PAGE_WIDTH} ${PDF_PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontObjectNumber} 0 R >> >> /Contents ${contentObjectNumber} 0 R >> endobj`);
  });

  objects.push(`${fontObjectNumber} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj`);
  contentLines.forEach((content, index) => {
    const contentObjectNumber = contentObjectNumbers[index];
    const byteLength = Buffer.byteLength(content, 'utf8');
    objects.push(`${contentObjectNumber} 0 obj << /Length ${byteLength} >> stream\n${content}endstream\nendobj`);
  });

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  objects.forEach((obj) => {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += obj + '\n';
  });
  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
};


const buildStyledTablePdfBuffer = (title: string, subtitle: string, headers: string[], rows: Array<Array<string | number>>) => {
  const headerLine = headers.join(' | ');
  const divider = headers.map((header) => '-'.repeat(Math.max(String(header).length, 3))).join('-+-');
  const bodyLines = rows.map((row) => row.map((cell) => String(cell ?? '')).join(' | '));
  return buildSimplePdfBuffer(title, [subtitle, '', headerLine, divider, ...bodyLines]);
};

const buildPeriodDays = (periodStart: string, periodEnd: string) => {
  const start = new Date(`${periodStart}T00:00:00`);
  const end = new Date(`${periodEnd}T00:00:00`);
  const days: string[] = [];
  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    days.push(toLocalIsoDate(cursor));
  }
  return days;
};

const buildRosterAndTimesheetAttachments = (payload: {
  clientName: string;
  periodStart: string;
  periodEnd: string;
  employeeBreakdown: PayrollMailBreakdownRow[];
}, context: {
  employees: any[];
  shifts: any[];
  roster: any[];
  rosterMeta: any[];
}) => {
  const periodDays = buildPeriodDays(payload.periodStart, payload.periodEnd);
  const rosterHeader = ['Employee ID', 'Employee', 'Department', ...periodDays];
  const rosterRows = context.employees.map((employee) => {
    const base = [employee.emp_id || '', `${employee.first_name || ''} ${employee.last_name || ''}`.trim(), employee.department || 'Unassigned'];
    const daily = periodDays.map((dayIso) => {
      const assignment = context.roster.find((row) => row.employee_id === employee.id && row.day_date === dayIso);
      const shift = context.shifts.find((item) => item.id === assignment?.shift_id);
      return shift?.label || 'Unassigned';
    });
    return [...base, ...daily];
  });
  const rosterCsv = [rosterHeader, ...rosterRows].map((line) => line.map(csvEscape).join(',')).join('\n');
  const rosterPdfBuffer = buildStyledTablePdfBuffer(
    `Roster - ${payload.clientName}`,
    `Period: ${payload.periodStart} to ${payload.periodEnd}`,
    rosterHeader,
    rosterRows,
  );

  const weekDays = periodDays.map((dayIso) => new Date(`${dayIso}T00:00:00`));
  const visibleDefinitions = mergeDefinitions(context.rosterMeta.length ? Object.keys(context.rosterMeta[0]).filter((key) => !['id','client_id','employee_id','week_start','created_at','updated_at'].includes(key)) : undefined);
  const timesheetHeader = ['Employee ID', 'Employee', 'Department', 'Normal (45h)', 'OT 1.5', 'Sun 1.5', 'Sun 2.0', 'Public Holiday', 'Annual Leave', 'Sick Leave', 'Family Leave', ...visibleDefinitions.map((d) => d)];
  const timesheetRows = context.employees.map((employee) => {
    const payroll = calculateEmployeePayroll(employee.id, weekDays, context.roster as any, context.shifts as any, context.rosterMeta as any) as any;
    return [
      employee.emp_id || '',
      `${employee.first_name || ''} ${employee.last_name || ''}`.trim(),
      employee.department || 'Unassigned',
      Number(payroll.normalTime || 0).toFixed(2),
      Number(payroll.ot15 || 0).toFixed(2),
      Number(payroll.sun15 || 0).toFixed(2),
      Number(payroll.sun20 || 0).toFixed(2),
      Number(payroll.pph || 0).toFixed(2),
      Number(payroll.leave || 0).toFixed(2),
      Number(payroll.sick || 0).toFixed(2),
      Number(payroll.family || 0).toFixed(2),
      ...visibleDefinitions.map((d) => typeof payroll[d] === 'number' ? Number(payroll[d]).toFixed(2) : String(payroll[d] || '-')),
    ];
  });
  const timesheetCsv = [timesheetHeader, ...timesheetRows].map((line) => line.map(csvEscape).join(',')).join('\n');
  const timesheetPdfBuffer = buildStyledTablePdfBuffer(
    `Timesheet - ${payload.clientName}`,
    `Period: ${payload.periodStart} to ${payload.periodEnd}`,
    timesheetHeader,
    timesheetRows,
  );

  const safeBase = `${payload.clientName}-${payload.periodEnd}`.replace(/\s+/g, '-');
  return [
    { filename: `${safeBase}-payroll.csv`, content: Buffer.from(formatPayrollCsv(payload.employeeBreakdown), 'utf-8'), contentType: 'text/csv; charset=utf-8' },
    { filename: `${safeBase}-roster.pdf`, content: rosterPdfBuffer, contentType: 'application/pdf' },
    { filename: `${safeBase}-timesheet.csv`, content: Buffer.from(timesheetCsv, 'utf-8'), contentType: 'text/csv; charset=utf-8' },
    { filename: `${safeBase}-timesheet.pdf`, content: timesheetPdfBuffer, contentType: 'application/pdf' },
  ];
};

const sendPayrollSubmissionEmail = async (payload: {
  clientName: string;
  payrollEmail: string;
  payrollCc?: string | null;
  submittedBy: string;
  submittedByEmail?: string | null;
  submittedAt: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  employeeCount: number;
  totalHours: number;
  totalPay: number;
  employeeBreakdown: PayrollMailBreakdownRow[];
  attachments?: Array<{ filename: string; content: Buffer; contentType?: string }>;
}) => {
  const csv = formatPayrollCsv(payload.employeeBreakdown);
  const subject = `${payload.clientName} Payroll Submission - ${payload.periodLabel}`;
  const submittedAtLabel = new Date(payload.submittedAt).toLocaleString('en-ZA', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const submittedByLine = `${payload.submittedBy}${payload.submittedByEmail ? ` (${payload.submittedByEmail})` : ''}`;
  const html = `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5;">
      <h2 style="margin: 0 0 12px;">Payroll submission received</h2>
      <p style="margin: 0 0 12px;">A payroll submission has been logged for <strong>${payload.clientName}</strong>.</p>
      <table style="border-collapse: collapse; margin: 12px 0;">
        <tr><td style="padding: 6px 12px 6px 0;"><strong>Period</strong></td><td>${payload.periodLabel}</td></tr>
        <tr><td style="padding: 6px 12px 6px 0;"><strong>Start</strong></td><td>${payload.periodStart}</td></tr>
        <tr><td style="padding: 6px 12px 6px 0;"><strong>End</strong></td><td>${payload.periodEnd}</td></tr>
        <tr><td style="padding: 6px 12px 6px 0;"><strong>Submitted by</strong></td><td>${submittedByLine}</td></tr>
        <tr><td style="padding: 6px 12px 6px 0;"><strong>Submitted at</strong></td><td>${submittedAtLabel}</td></tr>
        <tr><td style="padding: 6px 12px 6px 0;"><strong>Employees</strong></td><td>${payload.employeeCount}</td></tr>
        <tr><td style="padding: 6px 12px 6px 0;"><strong>Total hours</strong></td><td>${Number(payload.totalHours || 0).toFixed(2)}</td></tr>
        <tr><td style="padding: 6px 12px 6px 0;"><strong>Total pay</strong></td><td>R${Number(payload.totalPay || 0).toFixed(2)}</td></tr>
      </table>
      <p style="margin: 12px 0 0;">The payroll breakdown, roster and timesheet files are attached in CSV and PDF format.</p>
    </div>
  `;
  const text = [
    'Payroll submission received',
    '',
    `Client: ${payload.clientName}`,
    `Period: ${payload.periodLabel}`,
    `Start: ${payload.periodStart}`,
    `End: ${payload.periodEnd}`,
    `Submitted by: ${submittedByLine}`,
    `Submitted at: ${submittedAtLabel}`,
    `Employees: ${payload.employeeCount}`,
    `Total hours: ${Number(payload.totalHours || 0).toFixed(2)}`,
    `Total pay: R${Number(payload.totalPay || 0).toFixed(2)}`,
    '',
    'The payroll breakdown, roster and timesheet files are attached in CSV and PDF format.',
  ].join('\n');

  return sendMailMessage({
    to: payload.payrollEmail,
    cc: payload.payrollCc || undefined,
    subject,
    html,
    text,
    attachments: payload.attachments && payload.attachments.length > 0
      ? payload.attachments
      : [
          {
            filename: `${payload.clientName}-${payload.periodEnd}-payroll.csv`.replace(/\s+/g, '-'),
            content: Buffer.from(csv, 'utf-8'),
            contentType: 'text/csv; charset=utf-8',
          },
        ],
  });
};

const BASE_ROSTER_DEFINITIONS = ['salary_advance', 'shortages', 'unpaid_hours', 'staff_loan', 'notes'] as const;
const mergeDefinitions = (definitions?: string[] | null) => Array.from(new Set([...(definitions || []), ...BASE_ROSTER_DEFINITIONS]));

type ClientRosterDuration = '1_week' | '2_weeks' | '1_month';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const startOfToday = () => {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
};
const parseDateOnlyValue = (value: unknown) => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const normalized = raw.replace(/\//g, '-');
  const date = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
};
const formatDateOnlyValue = (value: Date) => value.toISOString().slice(0, 10);
const addDaysDate = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};
const addMonthsDate = (date: Date, months: number) => {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
};
const addYearsDate = (date: Date, years: number) => {
  const next = new Date(date);
  next.setFullYear(next.getFullYear() + years);
  return next;
};
const getCompletedMonthsBetween = (start: Date, end: Date) => {
  let months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  if (end.getDate() < start.getDate()) months -= 1;
  return Math.max(0, months);
};
const getEmploymentYears = (startDate: Date, asOf: Date) => {
  let years = asOf.getFullYear() - startDate.getFullYear();
  if (asOf.getMonth() < startDate.getMonth() || (asOf.getMonth() === startDate.getMonth() && asOf.getDate() < startDate.getDate())) {
    years -= 1;
  }
  return Math.max(0, years);
};
const getAnnualLeaveRate = (duration: string | null | undefined, years: number) => {
  const enhanced = years >= 8;
  if (duration === '1_month') return enhanced ? 1.6667 : 1.25;
  if (duration === '2_weeks') return enhanced ? 0.7692 : 0.5768;
  return enhanced ? 0.3846 : 0.2884;
};
const roundLeaveAmount = (value: number) => Math.round(value * 10000) / 10000;

const reconcileEmployeeLeaveAccrual = (employeeId: string) => {
  const employee = db.prepare(`
    SELECT e.*, c.roster_duration
    FROM employees e
    LEFT JOIN clients c ON c.id = e.client_id
    WHERE e.id = ?
  `).get(employeeId) as any;
  if (!employee || employee.status === 'offboarded') return;

  const today = startOfToday();
  const startDate = parseDateOnlyValue(employee.start_date);
  if (!startDate || startDate > today) return;

  let annualLeave = Number(employee.annual_leave) || 0;
  let sickLeave = Number(employee.sick_leave) || 0;
  let familyLeave = Number(employee.family_leave) || 0;
  let changed = false;

  const rosterDuration = String(employee.roster_duration || '1_week') as ClientRosterDuration;
  const employmentYears = getEmploymentYears(startDate, today);

  let annualAnchor = parseDateOnlyValue(employee.annual_leave_last_accrual_date) || startDate;
  const annualRate = getAnnualLeaveRate(rosterDuration, employmentYears);
  const annualStepDays = rosterDuration === '2_weeks' ? 14 : rosterDuration === '1_month' ? 0 : 7;
  if (rosterDuration === '1_month') {
    let nextAccrualDate = addMonthsDate(annualAnchor, 1);
    while (nextAccrualDate <= today) {
      annualLeave = roundLeaveAmount(annualLeave + annualRate);
      annualAnchor = nextAccrualDate;
      nextAccrualDate = addMonthsDate(annualAnchor, 1);
      changed = true;
    }
  } else {
    let nextAccrualDate = addDaysDate(annualAnchor, annualStepDays);
    while (nextAccrualDate <= today) {
      annualLeave = roundLeaveAmount(annualLeave + annualRate);
      annualAnchor = nextAccrualDate;
      nextAccrualDate = addDaysDate(annualAnchor, annualStepDays);
      changed = true;
    }
  }

  let sickCycleStart = parseDateOnlyValue(employee.sick_cycle_start_date) || startDate;
  let sickMonthsCredited = Number(employee.sick_months_credited) || 0;
  let sickCycleFullGrantApplied = Number(employee.sick_cycle_full_grant_applied) || 0;
  while (addYearsDate(sickCycleStart, 3) <= today) {
    sickCycleStart = addYearsDate(sickCycleStart, 3);
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
      sickLeave = roundLeaveAmount(sickLeave + 26);
      sickCycleFullGrantApplied = 1;
      changed = true;
    }
  }

  let familyGrantYear = Number(employee.family_leave_last_grant_year);
  if (!Number.isFinite(familyGrantYear)) familyGrantYear = NaN;
  const familyEligibilityDate = addMonthsDate(startDate, 4);
  if (familyEligibilityDate <= today) {
    if (!Number.isFinite(familyGrantYear)) {
      familyLeave = roundLeaveAmount(familyLeave + 3);
      familyGrantYear = today.getFullYear();
      changed = true;
    }
    while (familyGrantYear < today.getFullYear()) {
      familyGrantYear += 1;
      familyLeave = roundLeaveAmount(familyLeave + 3);
      changed = true;
    }
  }

  if (!changed) return;
  db.prepare(`
    UPDATE employees
    SET annual_leave = ?,
        sick_leave = ?,
        family_leave = ?,
        annual_leave_last_accrual_date = ?,
        sick_cycle_start_date = ?,
        sick_months_credited = ?,
        sick_cycle_full_grant_applied = ?,
        family_leave_last_grant_year = ?
    WHERE id = ?
  `).run(
    annualLeave,
    sickLeave,
    familyLeave,
    formatDateOnlyValue(annualAnchor),
    formatDateOnlyValue(sickCycleStart),
    sickMonthsCredited,
    sickCycleFullGrantApplied,
    Number.isFinite(familyGrantYear) ? familyGrantYear : null,
    employeeId,
  );
};

const reconcileLeaveAccrualsForClient = (clientId: string | null) => {
  if (!clientId) return;
  const employeeIds = db.prepare(`SELECT id FROM employees WHERE client_id = ? AND COALESCE(status, 'active') != 'offboarded'`).all(clientId) as Array<{ id: string }>;
  employeeIds.forEach((row) => reconcileEmployeeLeaveAccrual(row.id));
};
(globalThis as any).reconcileLeaveAccrualsForClient = reconcileLeaveAccrualsForClient;


const getWeekBounds = (baseDate: Date | string = new Date()) => {
  const date = typeof baseDate === 'string' ? new Date(baseDate) : new Date(baseDate);
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  const day = normalized.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const start = new Date(normalized);
  start.setDate(normalized.getDate() + diffToMonday);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);

  const toISO = (value: Date) => {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  return {
    start: toISO(start),
    end: toISO(end),
  };
};
const addDaysIso = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next.toISOString();
};

const toLocalIsoDate = (value: Date) => {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const getRosterPeriodRange = (dayDate: string, rosterDuration: string | null | undefined, rosterStartDay: number | null | undefined) => {
  const base = new Date(`${dayDate}T00:00:00`);
  const startDay = typeof rosterStartDay === 'number' ? rosterStartDay : 1;
  const day = base.getDay();
  const diff = (day - startDay + 7) % 7;
  const start = new Date(base);
  start.setDate(base.getDate() - diff);
  const durationDays = rosterDuration === '2_weeks' ? 14 : rosterDuration === '1_month' ? 28 : 7;
  const end = new Date(start);
  end.setDate(start.getDate() + durationDays - 1);
  return { start: toLocalIsoDate(start), end: toLocalIsoDate(end), durationDays };
};

const isLockedRosterDateForUser = (db: any, req: any, dayDate: string) => {
  const sessionRole = (req.session as any)?.userRole;
  if (sessionRole === 'superadmin') return false;
  const sessionUser = getSessionUser(req);
  if (!sessionUser?.client_id) return false;
  const client: any = db.prepare('SELECT roster_duration, roster_start_day FROM clients WHERE id = ?').get(sessionUser.client_id);
  const range = getRosterPeriodRange(dayDate, client?.roster_duration, client?.roster_start_day);
  const todayIso = toLocalIsoDate(new Date());
  return range.end < todayIso;
};

const normalizeClientTrialColumns = ({
  isTrial,
  trialDuration,
  existing,
}: {
  isTrial?: boolean;
  trialDuration?: number | string | null;
  existing?: any;
}) => {
  const nextIsTrial = typeof isTrial === 'boolean' ? isTrial : !!existing?.is_trial;
  const parsedDuration = Number(trialDuration ?? existing?.trial_duration ?? 7);
  const nextDuration = Number.isFinite(parsedDuration) && parsedDuration > 0 ? parsedDuration : 7;

  if (!nextIsTrial) {
    return {
      is_trial: 0,
      trial_duration: nextDuration,
      trial_started_at: null,
      trial_end_date: null,
    };
  }

  const trialStartedAt = existing?.trial_started_at || new Date().toISOString();
  const trialEndDate = addDaysIso(new Date(trialStartedAt), nextDuration);

  return {
    is_trial: 1,
    trial_duration: nextDuration,
    trial_started_at: trialStartedAt,
    trial_end_date: trialEndDate,
  };
};
const getUserTrialState = (user: any) => {
  if (user?.is_trial === 1) {
    const trialEndDate = user.trial_end_date || null;
    const trialExpired = trialEndDate ? new Date(trialEndDate).getTime() < Date.now() : false;
    const trialDaysRemaining = trialEndDate ? Math.max(0, Math.ceil((new Date(trialEndDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))) : null;
    return { isTrial: true, trialStartedAt: null, trialEndDate, trialExpired, trialDaysRemaining };
  }
  return { isTrial: false, trialStartedAt: null, trialEndDate: null, trialExpired: false, trialDaysRemaining: null };
};
const getClientTrialState = (clientId?: string | null) => {
  if (!clientId) return { isTrial: false, trialStartedAt: null, trialEndDate: null, trialExpired: false, trialDaysRemaining: null };
  const client: any = db.prepare('SELECT is_trial, trial_duration, trial_started_at, trial_end_date, created_at FROM clients WHERE id = ?').get(clientId);
  if (!client || client.is_trial !== 1) return { isTrial: false, trialStartedAt: null, trialEndDate: null, trialExpired: false, trialDaysRemaining: null };
  const trialStartedAt = client.trial_started_at || client.created_at || new Date().toISOString();
  const calculatedEndDate = client.trial_end_date || addDaysIso(new Date(trialStartedAt), Number(client.trial_duration || 7));
  const msRemaining = new Date(calculatedEndDate).getTime() - Date.now();
  const trialExpired = msRemaining < 0;
  const trialDaysRemaining = trialExpired ? 0 : Math.ceil(msRemaining / (1000 * 60 * 60 * 24));
  return { isTrial: true, trialStartedAt, trialEndDate: calculatedEndDate, trialExpired, trialDaysRemaining };
};

const serializePayrollSubmission = (row: any) => ({
  id: row.id,
  clientId: row.client_id || undefined,
  clientName: row.client_name || row.clientName || 'Unknown Client',
  submittedBy: row.submitted_by || row.submittedBy || row.submitted_by_email || 'Unknown User',
  submittedAt: row.submitted_at || row.submittedAt || row.created_at || new Date().toISOString(),
  periodStart: row.period_start || row.periodStart || undefined,
  periodEnd: row.period_end || row.periodEnd || undefined,
  period: row.period_label || row.period || `${row.period_start || row.periodStart || ''}${(row.period_end || row.periodEnd) ? ` - ${row.period_end || row.periodEnd}` : ''}`.trim() || 'Unknown Period',
  employeeCount: Number(row.employee_count ?? row.employeeCount) || 0,
  status: ['pending', 'processed', 'archived'].includes(row.status) ? row.status : 'pending',
  totalHours: Number(row.total_hours ?? row.totalHours) || 0,
  totalPay: Number(row.total_pay ?? row.totalPay) || 0,
  processedBy: row.processed_by ?? row.processedBy ?? undefined,
  processedAt: row.processed_at ?? row.processedAt ?? undefined,
  employeeBreakdown: Array.isArray(row.employee_breakdown)
    ? row.employee_breakdown
    : safeJsonParse(row.employee_breakdown, safeJsonParse(row.breakdown_json, [])),
});

// Initialize Database
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      is_verified INTEGER DEFAULT 0,
      is_trial INTEGER DEFAULT 0,
      trial_end_date TEXT,
      name TEXT,
      image TEXT,
      last_login TEXT,
      client_id TEXT
    );
  `);

  // Ensure columns exist (for older databases)
  const tableInfo = db.prepare("PRAGMA table_info(users)").all() as any[];
  const columns = tableInfo.map(col => col.name);
  if (!columns.includes('is_verified')) {
    db.exec("ALTER TABLE users ADD COLUMN is_verified INTEGER DEFAULT 0");
  }
  if (!columns.includes('role')) {
    db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
  }
  if (!columns.includes('is_trial')) {
    db.exec("ALTER TABLE users ADD COLUMN is_trial INTEGER DEFAULT 0");
  }
  if (!columns.includes('trial_end_date')) {
    db.exec("ALTER TABLE users ADD COLUMN trial_end_date TEXT");
  }
  if (!columns.includes('name')) {
    db.exec("ALTER TABLE users ADD COLUMN name TEXT");
  }
  if (!columns.includes('image')) {
    db.exec("ALTER TABLE users ADD COLUMN image TEXT");
  }
  if (!columns.includes('last_login')) {
    db.exec("ALTER TABLE users ADD COLUMN last_login TEXT");
  }
  if (!columns.includes('client_id')) {
    db.exec("ALTER TABLE users ADD COLUMN client_id TEXT");
  }
} catch (e) {
  console.error("Database initialization error:", e);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS employees (
    id TEXT PRIMARY KEY,
    emp_id TEXT NOT NULL,
    pin TEXT DEFAULT '1234',
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    start_date TEXT NOT NULL,
    dob TEXT NOT NULL,
    job_title TEXT NOT NULL,
    department TEXT NOT NULL,
    pay_rate REAL NOT NULL,
    email TEXT,
    cell TEXT,
    id_number TEXT,
    passport TEXT,
    address1 TEXT,
    address2 TEXT,
    address3 TEXT,
    address4 TEXT,
    street_number TEXT,
    residency TEXT,
    postal_code TEXT,
    tax_number TEXT,
    bank_name TEXT,
    account_holder TEXT,
    account_no TEXT,
    account_type TEXT,
    classification TEXT,
    paye_credit TEXT,
    portal_enabled TEXT DEFAULT 'no',
    country_of_issue TEXT,
    province TEXT,
    last_worked TEXT,
    delete_reason TEXT,
    ismibco TEXT,
    isunion TEXT,
    union_name TEXT,
    annual_leave REAL DEFAULT 0,
    sick_leave REAL DEFAULT 0,
    family_leave REAL DEFAULT 0,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

try {
  const empTableInfo = db.prepare("PRAGMA table_info(employees)").all() as any[];
  const empColumns = empTableInfo.map(col => col.name);
  if (!empColumns.includes('pin')) {
    db.exec("ALTER TABLE employees ADD COLUMN pin TEXT DEFAULT '1234'");
  }
  if (!empColumns.includes('street_number')) {
    db.exec("ALTER TABLE employees ADD COLUMN street_number TEXT");
  }
  if (!empColumns.includes('residency')) {
    db.exec("ALTER TABLE employees ADD COLUMN residency TEXT");
  }
  if (!empColumns.includes('account_holder')) {
    db.exec("ALTER TABLE employees ADD COLUMN account_holder TEXT");
  }
  if (!empColumns.includes('account_type')) {
    db.exec("ALTER TABLE employees ADD COLUMN account_type TEXT");
  }
  if (!empColumns.includes('classification')) {
    db.exec("ALTER TABLE employees ADD COLUMN classification TEXT");
  }
  if (!empColumns.includes('union_name')) {
    db.exec("ALTER TABLE employees ADD COLUMN union_name TEXT");
  }
  if (!empColumns.includes('status')) {
    db.exec("ALTER TABLE employees ADD COLUMN status TEXT DEFAULT 'active'");
  }
  if (!empColumns.includes('delete_reason')) {
    db.exec("ALTER TABLE employees ADD COLUMN delete_reason TEXT");
  }
  if (!empColumns.includes('province')) {
    db.exec("ALTER TABLE employees ADD COLUMN province TEXT");
  }
  if (!empColumns.includes('country_of_issue')) {
    db.exec("ALTER TABLE employees ADD COLUMN country_of_issue TEXT");
  }
  if (!empColumns.includes('portal_enabled')) {
    db.exec("ALTER TABLE employees ADD COLUMN portal_enabled TEXT DEFAULT 'no'");
  }
} catch (e) {
  console.error("Employee table migration error:", e);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS shifts (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    start TEXT NOT NULL,
    end TEXT NOT NULL,
    lunch INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS roster (
    employee_id TEXT NOT NULL,
    day_date TEXT NOT NULL,
    shift_id TEXT,
    PRIMARY KEY (employee_id, day_date),
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS roster_meta (
    employee_id TEXT NOT NULL,
    week_start TEXT NOT NULL,
    salary_advance TEXT,
    shortages TEXT,
    unpaid_hours TEXT,
    loan_amount TEXT,
    notes TEXT,
    PRIMARY KEY (employee_id, week_start),
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS activity_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    user_email TEXT,
    action TEXT NOT NULL,
    details TEXT,
    ip_address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    parent_id TEXT,
    employee_id TEXT,
    size TEXT,
    date TEXT NOT NULL,
    extension TEXT,
    url TEXT,
    FOREIGN KEY (parent_id) REFERENCES files(id) ON DELETE CASCADE,
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
  );


  CREATE TABLE IF NOT EXISTS payroll_submissions (
    id TEXT PRIMARY KEY,
    client_name TEXT NOT NULL,
    submitted_by TEXT NOT NULL,
    submitted_by_email TEXT,
    submitted_at TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    period_label TEXT NOT NULL,
    employee_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    total_hours REAL NOT NULL DEFAULT 0,
    total_pay REAL NOT NULL DEFAULT 0,
    processed_by TEXT,
    processed_by_email TEXT,
    processed_at TEXT,
    breakdown_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS leave_requests (
    id TEXT PRIMARY KEY,
    employee_id TEXT NOT NULL,
    type TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    is_half_day INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    notes TEXT,
    attachment_url TEXT,
    admin_notes TEXT,
    days REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active',
    fallback_image TEXT,
    roster_start_day INTEGER DEFAULT 1,
    roster_duration TEXT DEFAULT '1_week',
    roster_mode TEXT DEFAULT 'Manual',
    roster_seed_week_start TEXT,
    enabled_definitions TEXT DEFAULT '[]',
    dashboard_type TEXT DEFAULT 'rostering',
    locked_features TEXT DEFAULT '[]',
    is_trial INTEGER DEFAULT 0,
    trial_duration INTEGER DEFAULT 7,
    trial_started_at TEXT,
    trial_end_date TEXT,
    payroll_email TEXT,
    payroll_cc TEXT,
    payroll_submission_day INTEGER DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS support_tickets (
    id TEXT PRIMARY KEY,
    client_id TEXT,
    client_name TEXT,
    user_id TEXT,
    user_email TEXT,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    priority TEXT NOT NULL DEFAULT 'medium',
    admin_notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

try {
  const rosterMetaColumns = db.prepare("PRAGMA table_info(roster_meta)").all() as Array<{ name: string }>;
  const rosterMetaColumnNames = rosterMetaColumns.map((column) => column.name);
  const requiredRosterMetaColumns = [
    'salary_advance',
    'shortages',
    'unpaid_hours',
    'staff_loan',
    'uniform',
    'overthrows',
    'oil_spill',
    'stock_shortage',
    'annual_bonus',
    'incentive_bonus',
    'data_allowance',
    'night_shift_allowance',
    'medical_allowance',
    'mibco_health_insurance',
    'health_insurance',
    'garnishee',
    'cell_phone_payment',
    'income_tax_registration',
    'performance_incentive',
    'commission',
    'sales_commission',
    'notes',
  ];

  if (rosterMetaColumnNames.includes('loan_amount') && !rosterMetaColumnNames.includes('staff_loan')) {
    db.exec("ALTER TABLE roster_meta ADD COLUMN staff_loan TEXT");
    db.exec("UPDATE roster_meta SET staff_loan = COALESCE(staff_loan, loan_amount)");
  }

  requiredRosterMetaColumns.forEach((column) => {
    if (!rosterMetaColumnNames.includes(column)) {
      db.exec(`ALTER TABLE roster_meta ADD COLUMN ${column} TEXT`);
    }
  });
} catch (e) {
  console.error('Roster meta migration error:', e);
}


const ensureColumnExists = (tableName: string, columnName: string, definition: string) => {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as any[];
  const exists = columns.some((column) => column.name === columnName);
  if (!exists) {
    db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`).run();
  }
};

ensureColumnExists('files', 'password', 'TEXT');
ensureColumnExists('employees', 'annual_leave_last_accrual_date', 'TEXT');
ensureColumnExists('employees', 'sick_cycle_start_date', 'TEXT');
ensureColumnExists('employees', 'sick_months_credited', 'INTEGER DEFAULT 0');
ensureColumnExists('employees', 'sick_cycle_full_grant_applied', 'INTEGER DEFAULT 0');
ensureColumnExists('employees', 'family_leave_last_grant_year', 'INTEGER');
db.exec(`UPDATE employees
  SET annual_leave_last_accrual_date = COALESCE(annual_leave_last_accrual_date, start_date),
      sick_cycle_start_date = COALESCE(sick_cycle_start_date, start_date),
      sick_months_credited = COALESCE(sick_months_credited, 0),
      sick_cycle_full_grant_applied = COALESCE(sick_cycle_full_grant_applied, 0)
  WHERE COALESCE(status, 'active') != 'offboarded'
`);
ensureColumnExists('users', 'client_id', 'TEXT');
ensureColumnExists('leave_requests', 'source', `TEXT DEFAULT 'manual'`);
ensureColumnExists('leave_requests', 'source_ref', 'TEXT');
ensureColumnExists('users', 'name', 'TEXT');
ensureColumnExists('users', 'last_login', 'TEXT');
ensureColumnExists('employees', 'client_id', 'TEXT');
ensureColumnExists('employees', 'last_worked', 'TEXT');
ensureColumnExists('files', 'client_id', 'TEXT');
ensureColumnExists('activity_logs', 'client_id', 'TEXT');
ensureColumnExists('payroll_submissions', 'client_id', 'TEXT');
ensureColumnExists('clients', 'roster_mode', "TEXT DEFAULT 'Manual'");
ensureColumnExists('clients', 'roster_seed_week_start', 'TEXT');

const ensureEmployeeIdUniquenessPerClient = () => {
  const uniqueIndexes = db.prepare("PRAGMA index_list(employees)").all() as any[];
  const hasCompositeClientEmpIdIndex = uniqueIndexes.some((index) => {
    if (!index?.unique) return false;
    const columns = db.prepare(`PRAGMA index_info(${index.name})`).all() as any[];
    return columns.length === 2 && columns.some((column) => column.name === 'client_id') && columns.some((column) => column.name === 'emp_id');
  });

  if (hasCompositeClientEmpIdIndex) {
    return;
  }

  const createEmployeesTableSql = `
    CREATE TABLE employees_new (
      id TEXT PRIMARY KEY,
      emp_id TEXT NOT NULL,
      pin TEXT DEFAULT '1234',
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      start_date TEXT NOT NULL,
      dob TEXT NOT NULL,
      job_title TEXT NOT NULL,
      department TEXT NOT NULL,
      pay_rate REAL NOT NULL,
      email TEXT,
      cell TEXT,
      id_number TEXT,
      passport TEXT,
      address1 TEXT,
      address2 TEXT,
      address3 TEXT,
      address4 TEXT,
      street_number TEXT,
      residency TEXT,
      postal_code TEXT,
      tax_number TEXT,
      bank_name TEXT,
      account_holder TEXT,
      account_no TEXT,
      account_type TEXT,
      classification TEXT,
      paye_credit TEXT,
      portal_enabled TEXT DEFAULT 'no',
      country_of_issue TEXT,
      province TEXT,
      last_worked TEXT,
      delete_reason TEXT,
      ismibco TEXT,
      isunion TEXT,
      union_name TEXT,
      annual_leave REAL DEFAULT 0,
      sick_leave REAL DEFAULT 0,
      family_leave REAL DEFAULT 0,
      annual_leave_last_accrual_date TEXT,
      sick_cycle_start_date TEXT,
      sick_months_credited INTEGER DEFAULT 0,
      sick_cycle_full_grant_applied INTEGER DEFAULT 0,
      family_leave_last_grant_year INTEGER,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      client_id TEXT
    );
  `;

  const employeeColumns = [
    'id', 'emp_id', 'pin', 'first_name', 'last_name', 'start_date', 'dob', 'job_title', 'department', 'pay_rate',
    'email', 'cell', 'id_number', 'passport', 'address1', 'address2', 'address3', 'address4', 'street_number', 'residency',
    'postal_code', 'tax_number', 'bank_name', 'account_holder', 'account_no', 'account_type', 'classification', 'paye_credit',
    'portal_enabled', 'country_of_issue', 'province', 'last_worked', 'delete_reason', 'ismibco', 'isunion', 'union_name',
    'annual_leave', 'sick_leave', 'family_leave',
    'annual_leave_last_accrual_date', 'sick_cycle_start_date', 'sick_months_credited', 'sick_cycle_full_grant_applied', 'family_leave_last_grant_year',
    'status', 'created_at', 'client_id'
  ];

  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN TRANSACTION');
  try {
    db.exec('DROP TABLE IF EXISTS employees_new');
    db.exec(createEmployeesTableSql);
    db.exec(`INSERT INTO employees_new (${employeeColumns.join(', ')}) SELECT ${employeeColumns.join(', ')} FROM employees`);
    db.exec('DROP TABLE employees');
    db.exec('ALTER TABLE employees_new RENAME TO employees');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_client_emp_id_unique ON employees(client_id, emp_id)');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
};

ensureEmployeeIdUniquenessPerClient();

// Re-ensure leave accrual columns after any table rebuilds/migrations.
ensureColumnExists('employees', 'annual_leave_last_accrual_date', 'TEXT');
ensureColumnExists('employees', 'sick_cycle_start_date', 'TEXT');
ensureColumnExists('employees', 'sick_months_credited', 'INTEGER DEFAULT 0');
ensureColumnExists('employees', 'sick_cycle_full_grant_applied', 'INTEGER DEFAULT 0');
ensureColumnExists('employees', 'family_leave_last_grant_year', 'INTEGER');

db.prepare("UPDATE clients SET enabled_definitions = ? WHERE enabled_definitions IS NULL OR enabled_definitions = '' OR enabled_definitions = '[]'").run(JSON.stringify(BASE_ROSTER_DEFINITIONS));

// No default client seed data. Clients are created through Super Admin.

// Seed/repair default super admin accounts
const superAdminEmails = ["superadmin@sightfull.co.za", "mudassar.khopatkar@offernet.net"];
const defaultSuperAdminPasswordHash = bcrypt.hashSync("superadmin123", 10);
const allowedSuperAdminEmails = new Set(superAdminEmails.map((email) => String(email).trim().toLowerCase()));
superAdminEmails.forEach(email => {
  const normalizedEmail = String(email).trim().toLowerCase();
  const exists = db.prepare("SELECT * FROM users WHERE lower(email) = ?").get(normalizedEmail) as any;
  if (!exists) {
    db.prepare("INSERT INTO users (id, email, password, role, is_verified) VALUES (?, ?, ?, ?, ?)")
      .run(Math.random().toString(36).substr(2, 9), normalizedEmail, defaultSuperAdminPasswordHash, "superadmin", 1);
  } else {
    db.prepare("UPDATE users SET role = 'superadmin', is_verified = 1 WHERE lower(email) = ?").run(normalizedEmail);
    if (!exists.password) {
      db.prepare("UPDATE users SET password = ? WHERE lower(email) = ?").run(defaultSuperAdminPasswordHash, normalizedEmail);
    }
  }
});

// No default admin/trial seed users. These are created through the app when needed.

// Seed initial shifts
const shiftCount = db.prepare("SELECT COUNT(*) as count FROM shifts").get() as any;
if (shiftCount.count === 0) {
  const initialShifts = [
    { id: '1', label: 'Day Shift', start: '08:00', end: '17:00', lunch: 60 },
    { id: '2', label: 'Night Shift', start: '18:00', end: '06:00', lunch: 60 },
    { id: '900001', label: 'Absent', start: '', end: '', lunch: 0 },
    { id: '900002', label: 'Annual Leave', start: '', end: '', lunch: 0 },
    { id: '900003', label: 'Sick Leave', start: '', end: '', lunch: 0 },
    { id: '900004', label: 'Family Leave', start: '', end: '', lunch: 0 },
    { id: '900005', label: 'Unshifted', start: '', end: '', lunch: 0 },
  ];
  const insertShift = db.prepare("INSERT INTO shifts (id, label, start, end, lunch) VALUES (?, ?, ?, ?, ?)");
  initialShifts.forEach(s => insertShift.run(s.id, s.label, s.start, s.end, s.lunch));
}

// No default employee seed data. Employees are created per client through the dashboard.


// Normalize legacy shift labels
const absentShift = db.prepare("SELECT id FROM shifts WHERE lower(label) = 'absent' LIMIT 1").get() as any;
if (absentShift) {
  db.prepare("DELETE FROM shifts WHERE lower(label) = 'unpaid leave'").run();
} else {
  db.prepare("UPDATE shifts SET label = 'Absent' WHERE lower(label) = 'unpaid leave'").run();
}

const unshiftedShift = db.prepare("SELECT id FROM shifts WHERE lower(label) = 'unshifted' LIMIT 1").get() as any;
if (!unshiftedShift) {
  db.prepare("INSERT INTO shifts (id, label, start, end, lunch) VALUES (?, ?, ?, ?, ?)").run('900005', 'Unshifted', '', '', 0);
}

function logActivity(req: any, action: string, details: any = {}) {
  try {
    const userId = req.session?.userId || null;
    let userEmail = 'System/Unknown';
    if (userId) {
      const user = db.prepare("SELECT email, client_id FROM users WHERE id = ?").get(userId) as any;
      if (user) {
        userEmail = user.email;
        if (!details.clientId && user.client_id) details.clientId = user.client_id;
      }
    } else if (details.email) {
      userEmail = details.email;
    }
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    db.prepare("INSERT INTO activity_logs (id, user_id, user_email, action, details, ip_address, client_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(Math.random().toString(36).substr(2, 9), userId, userEmail, action, JSON.stringify(details), ip, details.clientId || null);
  } catch (e) {
    console.error("Failed to log activity:", e);
  }
}

async function startServer() {
  const app = express();

if (isSmtpConfigured) {
  verifyMailTransport()
    .then(() => console.log(`SMTP ready on ${env.smtpHost}:${env.smtpPort}`))
    .catch((error) => console.error('SMTP verification failed:', error));
}
  const PORT = env.port;

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));
  
  // Request logging middleware
  app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
  });

  const normalizeText = (value: unknown): string | null => {
    if (value === undefined || value === null) return null;
    const normalized = String(value).trim();
    return normalized === '' ? null : normalized;
  };
  const normalizeDigits = (value: string | null) => (value || '').replace(/\D/g, '');
  const titleCase = (value: string | null) => (value || '')
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
  const normalizeFlexibleDateInput = (value: string | null) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const match = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})$/);
    if (match) {
      const [, d, m, y] = match;
      const yy = Number(y);
      const fullYear = y.length === 4 ? yy : (yy <= Number(new Date().getFullYear().toString().slice(-2)) ? 2000 + yy : 1900 + yy);
      const normalized = `${String(fullYear).padStart(4,'0')}-${String(Number(m)).padStart(2,'0')}-${String(Number(d)).padStart(2,'0')}`;
      const candidate = new Date(`${normalized}T00:00:00`);
      if (!Number.isNaN(candidate.getTime())) return normalized;
    }
    return raw;
  };
  const isValidDateInput = (value: string | null) => {
    const normalized = normalizeFlexibleDateInput(value);
    return Boolean(normalized && /^\d{4}-\d{2}-\d{2}$/.test(normalized) && !Number.isNaN(new Date(`${normalized}T00:00:00`).getTime()));
  };
  const calculateAge = (dateOfBirth: string) => {
    const today = new Date();
    const dob = new Date(`${dateOfBirth}T00:00:00`);
    let age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) age -= 1;
    return age;
  };
  const luhnChecksum = (digits: string) => {
    let sum = 0;
    let doubleDigit = false;
    for (let index = digits.length - 1; index >= 0; index -= 1) {
      let digit = Number(digits[index]);
      if (doubleDigit) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
      doubleDigit = !doubleDigit;
    }
    return sum % 10 === 0;
  };

  const parseCurrencyInput = (value: any) => {
    if (typeof value === 'number') return Number(value.toFixed(4));
    const digits = String(value ?? '').replace(/\D/g, '');
    if (!digits) return 0;
    const padded = digits.padStart(8, '0');
    const whole = padded.slice(0, -4).replace(/^0+(?=\d)/, '') || '0';
    const decimals = padded.slice(-4);
    return Number(`${whole}.${decimals}`);
  };

  const parseLeavePrecisionInput = (value: any) => {
    if (typeof value === 'number') return Number(value.toFixed(4));
    const digits = String(value ?? '').replace(/\D/g, '');
    if (!digits) return 0;
    const padded = digits.padStart(6, '0');
    const whole = padded.slice(0, -4).replace(/^0+(?=\d)/, '') || '0';
    const decimals = padded.slice(-4);
    return Number(`${whole}.${decimals}`);
  };
  const isValidSouthAfricanId = (value: string | null) => {
    const digits = normalizeDigits(value);
    if (!/^\d{13}$/.test(digits)) return false;
    const yy = Number(digits.slice(0, 2));
    const mm = Number(digits.slice(2, 4));
    const dd = Number(digits.slice(4, 6));
    const currentYearTwoDigits = Number(new Date().getFullYear().toString().slice(-2));
    const fullYear = yy <= currentYearTwoDigits ? 2000 + yy : 1900 + yy;
    const candidate = new Date(Date.UTC(fullYear, mm - 1, dd));
    const validDate = candidate.getUTCFullYear() === fullYear && candidate.getUTCMonth() === mm - 1 && candidate.getUTCDate() === dd;
    return validDate && luhnChecksum(digits);
  };

  const normalizeEmployeePayload = (data: any) => ({
    emp_id: (normalizeText(data.emp_id) || '').toUpperCase(),
    pin: normalizeText(data.pin) ?? '',
    allow_blank_pin: Boolean(data.allow_blank_pin),
    first_name: titleCase(normalizeText(data.first_name)),
    last_name: titleCase(normalizeText(data.last_name)),
    start_date: normalizeFlexibleDateInput(normalizeText(data.start_date)),
    dob: normalizeFlexibleDateInput(normalizeText(data.dob)),
    last_worked: normalizeFlexibleDateInput(normalizeText(data.last_worked)),
    job_title: titleCase(normalizeText(data.job_title)),
    department: titleCase(normalizeText(data.department)),
    pay_rate: parseCurrencyInput(data.pay_rate),
    email: (normalizeText(data.email) || '').toLowerCase() || null,
    cell: normalizeText(data.cell)?.replace(/[^\d+]/g, '') || null,
    residency: normalizeText(data.residency),
    street_number: normalizeText(data.street_number),
    id_number: normalizeDigits(normalizeText(data.id_number)),
    passport: (normalizeText(data.passport) || '').toUpperCase() || null,
    bank_name: normalizeText(data.bank_name),
    portal_enabled: String(normalizeText(data.portal_enabled) || 'no').toLowerCase() === 'yes' ? 'yes' : 'no',
    country_of_issue: titleCase(normalizeText(data.country_of_issue)),
    province: titleCase(normalizeText(data.province)),
    account_holder: normalizeText(data.account_holder),
    account_no: normalizeDigits(normalizeText(data.account_no)),
    account_type: normalizeText(data.account_type),
    tax_number: normalizeDigits(normalizeText(data.tax_number)),
    ismibco: typeof data.ismibco === 'boolean' ? (data.ismibco ? 'yes' : 'no') : (normalizeText(data.ismibco) ?? ''),
    isunion: typeof data.isunion === 'boolean' ? (data.isunion ? 'yes' : 'no') : (normalizeText(data.isunion) ?? ''),
    union_name: normalizeText(data.union_name),
    address1: normalizeText(data.address1),
    address2: normalizeText(data.address2),
    address3: normalizeText(data.address3),
    address4: normalizeText(data.address4),
    postal_code: normalizeDigits(normalizeText(data.postal_code)),
    paye_credit: normalizeText(data.paye_credit),
    classification: normalizeText(data.classification),
    annual_leave: parseLeavePrecisionInput(data.annual_leave),
    sick_leave: parseLeavePrecisionInput(data.sick_leave),
    family_leave: parseLeavePrecisionInput(data.family_leave),
  });

  const getDobFromSouthAfricanId = (value: string | null) => {
    const digits = normalizeDigits(value);
    if (!/^\d{13}$/.test(digits) || !isValidSouthAfricanId(digits)) return '';
    const yy = Number(digits.slice(0, 2));
    const mm = digits.slice(2, 4);
    const dd = digits.slice(4, 6);
    const currentYearTwoDigits = Number(new Date().getFullYear().toString().slice(-2));
    const fullYear = yy <= currentYearTwoDigits ? 2000 + yy : 1900 + yy;
    return `${fullYear}-${mm}-${dd}`;
  };

  const validateEmployeePayload = (data: ReturnType<typeof normalizeEmployeePayload>) => {
    const errors: string[] = [];
    if (data.id_number && isValidSouthAfricanId(data.id_number)) data.dob = getDobFromSouthAfricanId(data.id_number);
    const addressTextPattern = /^[A-Za-z0-9\s'\-.,/#]*$/;
    if (data.address1 && !addressTextPattern.test(String(data.address1).trim())) errors.push("Address Line 1 contains invalid characters.");
    if (data.address2 && !addressTextPattern.test(String(data.address2).trim())) errors.push("Address Line 2 contains invalid characters.");
    if (data.address3 && !addressTextPattern.test(String(data.address3).trim())) errors.push("Address Line 3 contains invalid characters.");
        const requireField = (cond: boolean, message: string) => { if (!cond) errors.push(message); };
    requireField(!!data.emp_id, 'emp_id is required.');
    requireField(!!data.first_name, 'first_name is required.');
    requireField(!!data.last_name, 'last_name is required.');
    requireField(!!data.start_date, 'start_date is required.');
    requireField(!!data.pay_rate && data.pay_rate > 0, 'pay_rate is required.');
    if (data.last_worked && !/^\d{4}-\d{2}-\d{2}$/.test(data.last_worked)) {
      errors.push('last_worked must be a valid date.');
    }
    requireField(!!data.id_number || !!data.passport, 'Please provide either an ID number or a passport number.');
    if (data.portal_enabled === 'yes' && !data.allow_blank_pin && !data.pin) {
      errors.push('pin is required when employee portal is enabled.');
    }

    if (data.emp_id && !/^[A-Z0-9_-]{3,20}$/.test(data.emp_id)) {
      errors.push('emp_id must be 3 to 20 characters and can only contain letters, numbers, hyphens, and underscores.');
    }

    if (data.pin && !/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/.test(data.pin)) {
      errors.push('pin must be at least 8 characters and include uppercase, lowercase, a number, and a special character.');
    }

    if (data.first_name && !/^[A-Za-z .'-]{2,50}$/.test(data.first_name)) {
      errors.push('first_name contains invalid characters.');
    }

    if (data.last_name && !/^[A-Za-z .'-]{2,50}$/.test(data.last_name)) {
      errors.push('last_name contains invalid characters.');
    }

    if (data.job_title && /\d/.test(data.job_title)) {
      errors.push('job_title cannot contain numbers.');
    }

    if (data.department && /\d/.test(data.department)) {
      errors.push('department cannot contain numbers.');
    }

    if (data.bank_name && /\d/.test(data.bank_name)) errors.push('bank_name cannot contain numbers.');
    if (data.country_of_issue && !/^[A-Za-z .'-]{2,60}$/.test(data.country_of_issue)) errors.push('country_of_issue contains invalid characters.');


    if (data.street_number && !/^[A-Za-z0-9\s'\-.,/#]+$/.test(data.street_number)) {
      errors.push('street_number can only contain letters, numbers, spaces, and standard address punctuation.');
    }

    if (!isValidDateInput(data.start_date)) errors.push('start_date must be a valid date.');
    if (data.id_number && !data.passport && !isValidDateInput(data.dob)) errors.push('dob must be a valid date.');
    if (data.passport && !isValidDateInput(data.dob)) errors.push('dob is required when passport is used.');

    if (data.dob && isValidDateInput(data.dob)) {
      const dobDate = new Date(`${data.dob}T00:00:00`);
      if (dobDate > new Date()) {
        errors.push('dob cannot be in the future.');
      } else if (calculateAge(data.dob) < 16) {
        errors.push('employee must be at least 16 years old.');
      }
    }

    if (data.start_date && data.dob && isValidDateInput(data.start_date) && isValidDateInput(data.dob)) {
      if (new Date(`${data.start_date}T00:00:00`) < new Date(`${data.dob}T00:00:00`)) {
        errors.push('start_date cannot be before dob.');
      }
    }

    if (!data.id_number && !data.passport) {
      errors.push('either id_number or passport is required.');
    }

    if (data.id_number && !isValidSouthAfricanId(data.id_number)) {
      errors.push('id_number must be a valid South African ID number.');
    }

    if (data.passport && !/^[A-Z0-9]{6,20}$/.test(data.passport)) {
      errors.push('passport must be 6 to 20 letters or numbers.');
    }

    if (!Number.isFinite(data.pay_rate) || data.pay_rate <= 0) {
      errors.push('pay rate must be greater than 0.');
    }

    if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      errors.push('Invalid email format.');
    }

    if (data.cell) {
      const digits = normalizeDigits(data.cell);
      if (!/^27\d{9}$/.test(digits)) {
        errors.push('cell must be a valid South African phone number.');
      }
    }

    if (data.tax_number && !/^\d{10}$/.test(data.tax_number)) {
      errors.push('tax_number must be 10 digits.');
    }

    if (data.postal_code && !/^\d{4}$/.test(data.postal_code)) {
      errors.push('postal_code must be 4 digits.');
    }

    if (data.account_no && !/^\d{6,20}$/.test(data.account_no)) {
      errors.push('account_no must be 6 to 20 digits.');
    }

    const hasBankingData = Boolean(data.bank_name || data.account_holder || data.account_no || data.account_type);
    if (hasBankingData && !(data.bank_name && data.account_holder && data.account_no && data.account_type)) {
      errors.push('complete all banking fields when capturing bank details.');
    }

    if (data.account_type && !['savings', 'cheque', 'current', 'transmission', 'bond'].includes(data.account_type)) {
      errors.push('account_type is invalid.');
    }

    if (data.isunion === 'yes' && !data.union_name) {
      errors.push('union_name is required when union is yes.');
    }

    if (data.isunion !== 'yes') {
      data.union_name = null;
    }

    ['annual_leave', 'sick_leave', 'family_leave'].forEach((field) => {
      const value = data[field as keyof typeof data] as number;
      if (!Number.isFinite(value) || value < 0) errors.push(`${field} must be 0 or more.`);
    });

    return errors;
  };

  const ADMINISTRATIVE_SHIFT_LABELS = ['absent', 'annual leave', 'sick leave', 'family leave', 'unshifted'];
  const isAdministrativeShiftLabel = (label: string | null | undefined) => ADMINISTRATIVE_SHIFT_LABELS.includes(normalizeText(label).toLowerCase());
  const getShiftWindowMinutes = (start: string, end: string) => {
    if (!start || !end) return 0;
    const [startHour, startMinute] = start.split(':').map(Number);
    const [endHour, endMinute] = end.split(':').map(Number);
    if ([startHour, startMinute, endHour, endMinute].some(Number.isNaN)) return 0;
    let startTotal = startHour * 60 + startMinute;
    let endTotal = endHour * 60 + endMinute;
    if (endTotal <= startTotal) endTotal += 24 * 60;
    return Math.max(0, endTotal - startTotal);
  };

  const normalizeShiftPayload = (data: any) => {
    const label = normalizeText(data.label);
    const isAdministrative = isAdministrativeShiftLabel(label);
    return {
      id: normalizeText(data.id),
      label,
      start: isAdministrative ? '' : normalizeText(data.start),
      end: isAdministrative ? '' : normalizeText(data.end),
      lunch: isAdministrative ? 0 : (Number(data.lunch) || 0),
    };
  };

  const validateShiftPayload = (data: ReturnType<typeof normalizeShiftPayload>) => {
    const errors: string[] = [];
    if (!data.label) errors.push('label is required.');
    const isAdministrative = isAdministrativeShiftLabel(data.label);
    if (!isAdministrative && !data.start) errors.push('start time is required.');
    if (!isAdministrative && !data.end) errors.push('end time is required.');
    if (!Number.isInteger(data.lunch) || data.lunch < 0) errors.push('lunch must be 0 or more.');
    const shiftWindowMinutes = getShiftWindowMinutes(data.start, data.end);
    if (!isAdministrative && shiftWindowMinutes > 0 && data.lunch > shiftWindowMinutes) errors.push('lunch break cannot exceed the shift time window.');
    return errors;
  };



  const requireAuth = (req: any, res: any, next: any) => {
    const userId = (req.session as any)?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    return next();
  };

  const allowLocalMailDebug = (req: any) => {
    try {
      const host = String(req.headers.host || '');
      const forwardedHost = String(req.headers['x-forwarded-host'] || '');
      const target = `${host} ${forwardedHost}`;
      return target.includes('localhost') || target.includes('127.0.0.1');
    } catch {
      return false;
    }
  };

  const requireAuthOrLocalMailDebug = (req: any, res: any, next: any) => {
    const userId = (req.session as any)?.userId;
    if (userId || allowLocalMailDebug(req)) {
      return next();
    }
    return res.status(401).json({ error: 'Unauthorized' });
  };

  app.set('trust proxy', true); // trust all proxies
  app.use(session({
    secret: env.sessionSecret,
    resave: false,
    saveUninitialized: false,
    proxy: isProduction,
    cookie: {
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      httpOnly: true,
      maxAge: env.sessionMaxAgeMs
    }
  }));


  registerAuthSystemRoutes({
    app,
    db,
    env,
    isSupabaseConfigured,
    isSmtpConfigured,
    getDatabaseReadiness,
    getSupabaseReadiness,
    getMailerReadiness,
    getLastMailEvent,
    sendMailMessage,
    setLastMailEvent,
    logActivity,
    getSessionUser,
    safeJsonParse,
    mergeDefinitions,
    allowedSuperAdminEmails,
    baseRosterDefinitions: BASE_ROSTER_DEFINITIONS,
    getUserTrialState,
    getClientTrialState,
    requireAuth,
    requireAuthOrLocalMailDebug,
  });

  const getSessionEmployee = (req: any) => {
    const employeeId = (req.session as any)?.employeeId;
    if (!employeeId) return null;
    return db.prepare(`
      SELECT e.*, c.name as client_name, c.locked_features
      FROM employees e
      LEFT JOIN clients c ON c.id = e.client_id
      WHERE e.id = ?
    `).get(employeeId) as any;
  };

  const requireActiveTrial = (req: any, res: any, next: any) => {
    const sessionRole = (req.session as any)?.userRole;
    if (sessionRole === 'superadmin') return next();

    const sessionUser = getSessionUser(req);
    if (!sessionUser) {
      const sessionEmployee = getSessionEmployee(req);
      if (!sessionEmployee) return res.status(401).json({ error: 'Not authenticated' });

      const trialState = getClientTrialState(sessionEmployee.client_id);
      if (trialState.isTrial && trialState.trialExpired) {
        return res.status(402).json({
          error: 'Trial expired',
          trialExpired: true,
          trialEndDate: trialState.trialEndDate,
          trialDaysRemaining: 0,
          client_id: sessionEmployee.client_id || null,
          client_name: sessionEmployee.client_name || null,
        });
      }

      return next();
    }

    const trialState = getUserTrialState(sessionUser);
    if (trialState.isTrial && trialState.trialExpired) {
      return res.status(402).json({
        error: 'Trial expired',
        trialExpired: true,
        trialEndDate: trialState.trialEndDate,
        trialDaysRemaining: 0,
        client_id: sessionUser.client_id || null,
        client_name: sessionUser.client_name || null,
      });
    }

    next();
  };

  const requireUnlockedFeature = (featureKey: string) => {
    return (req: any, res: any, next: any) => {
      const sessionRole = (req.session as any)?.userRole;
      if (sessionRole === 'superadmin') return next();

      const sessionUser = getSessionUser(req);
      if (!sessionUser) {
        const sessionEmployee = getSessionEmployee(req);
        if (!sessionEmployee) return res.status(401).json({ error: 'Not authenticated' });

        let employeeLockedFeatures: string[] = [];
        try {
          employeeLockedFeatures = JSON.parse(sessionEmployee.locked_features || '[]');
        } catch {
          employeeLockedFeatures = [];
        }

        if (employeeLockedFeatures.includes(featureKey)) {
          return res.status(423).json({
            error: 'Feature locked',
            feature: featureKey,
            client_id: sessionEmployee.client_id || null,
            client_name: sessionEmployee.client_name || null,
          });
        }

        return next();
      }

      let lockedFeatures: string[] = [];
      try {
        lockedFeatures = JSON.parse(sessionUser.locked_features || '[]');
      } catch {
        lockedFeatures = [];
      }

      if (lockedFeatures.includes(featureKey)) {
        return res.status(423).json({
          error: 'Feature locked',
          feature: featureKey,
          client_id: sessionUser.client_id || null,
          client_name: sessionUser.client_name || null,
        });
      }

      next();
    };
  };


  const canAccessEmployeeFiles = (req: any, employeeId: string | null | undefined) => {
    if (!employeeId) return true;

    const sessionEmployeeId = (req.session as any)?.employeeId;
    const sessionUserId = (req.session as any)?.userId;

    if (sessionEmployeeId) {
      return sessionEmployeeId === employeeId;
    }

    return !!sessionUserId;
  };

  const ensureFileAccess = (req: any, res: any, next: any) => {
    const sessionEmployeeId = (req.session as any)?.employeeId;
    const sessionUserId = (req.session as any)?.userId;

    if (!sessionEmployeeId && !sessionUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    return next();
  };

  const getActorClientId = (req: any) => {
    const sessionRole = (req.session as any)?.userRole;
    const activeClientIdHeader = typeof req.headers['x-active-client-id'] === 'string' ? req.headers['x-active-client-id'] : null;
    if (sessionRole === 'superadmin') {
      return activeClientIdHeader || null;
    }

    const sessionUserId = (req.session as any)?.userId;
    if (sessionUserId) {
      const user = db.prepare('SELECT client_id FROM users WHERE id = ?').get(sessionUserId) as any;
      if (user?.client_id) return user.client_id as string;
    }

    const employeeClientId = (req.session as any)?.employeeClientId;
    if (employeeClientId) return employeeClientId as string;

    const sessionEmployeeId = (req.session as any)?.employeeId;
    if (sessionEmployeeId) {
      const employee = db.prepare('SELECT client_id FROM employees WHERE id = ?').get(sessionEmployeeId) as any;
      return employee?.client_id || null;
    }

    return null;
  };

  const canMutateVaultItems = (req: any) => {
    const sessionRole = (req.session as any)?.userRole;
    const sessionEmployeeId = (req.session as any)?.employeeId;
    if (sessionRole === 'superadmin') return true;
    if (sessionEmployeeId) return true;
    return false;
  };

  const getEffectiveTenantClientId = (req: any) => {
    const sessionRole = (req.session as any)?.userRole;
    const activeClientIdHeader = typeof req.headers['x-active-client-id'] === 'string' ? req.headers['x-active-client-id'] : null;
    if (sessionRole === 'superadmin') return activeClientIdHeader || null;
    const actorClientId = getActorClientId(req);
    return actorClientId || null;
  };

  const hydrateFileRow = (row: any) => ({
    ...row,
    parent_id: row?.parent_id ?? null,
    employee_id: row?.employee_id ?? undefined,
    client_id: row?.client_id ?? undefined,
    size: row?.size ?? undefined,
    extension: row?.extension ?? undefined,
    url: row?.url ?? undefined,
    password: row?.password ?? undefined,
  });


  const normalizeFileBufferFromStoredUrl = (urlValue: string | null | undefined) => {
    const raw = String(urlValue || '').trim();
    if (!raw) return Buffer.alloc(0);
    const dataUrlMatch = raw.match(/^data:.*?;base64,(.*)$/i);
    if (dataUrlMatch) {
      return Buffer.from(dataUrlMatch[1], 'base64');
    }
    return Buffer.from(raw, 'utf8');
  };

  const crc32Table = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  const computeCrc32 = (buffer: Buffer) => {
    let crc = 0xffffffff;
    for (let i = 0; i < buffer.length; i += 1) {
      crc = crc32Table[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };

  const buildStoredZipBuffer = (entries: Array<{ name: string; data: Buffer }>) => {
    const fileParts: Buffer[] = [];
    const centralParts: Buffer[] = [];
    let offset = 0;

    entries.forEach((entry, index) => {
      const normalizedName = entry.name.replace(/^\/+/, '').replace(/\\/g, '/');
      const fileNameBuffer = Buffer.from(normalizedName, 'utf8');
      const data = entry.data;
      const crc = computeCrc32(data);

      const localHeader = Buffer.alloc(30);
      localHeader.writeUInt32LE(0x04034b50, 0);
      localHeader.writeUInt16LE(20, 4);
      localHeader.writeUInt16LE(0, 6);
      localHeader.writeUInt16LE(0, 8);
      localHeader.writeUInt16LE(0, 10);
      localHeader.writeUInt16LE(0, 12);
      localHeader.writeUInt32LE(crc, 14);
      localHeader.writeUInt32LE(data.length, 18);
      localHeader.writeUInt32LE(data.length, 22);
      localHeader.writeUInt16LE(fileNameBuffer.length, 26);
      localHeader.writeUInt16LE(0, 28);

      fileParts.push(localHeader, fileNameBuffer, data);

      const centralHeader = Buffer.alloc(46);
      centralHeader.writeUInt32LE(0x02014b50, 0);
      centralHeader.writeUInt16LE(20, 4);
      centralHeader.writeUInt16LE(20, 6);
      centralHeader.writeUInt16LE(0, 8);
      centralHeader.writeUInt16LE(0, 10);
      centralHeader.writeUInt16LE(0, 12);
      centralHeader.writeUInt16LE(0, 14);
      centralHeader.writeUInt32LE(crc, 16);
      centralHeader.writeUInt32LE(data.length, 20);
      centralHeader.writeUInt32LE(data.length, 24);
      centralHeader.writeUInt16LE(fileNameBuffer.length, 28);
      centralHeader.writeUInt16LE(0, 30);
      centralHeader.writeUInt16LE(0, 32);
      centralHeader.writeUInt16LE(0, 34);
      centralHeader.writeUInt16LE(0, 36);
      centralHeader.writeUInt32LE(0, 38);
      centralHeader.writeUInt32LE(offset, 42);
      centralParts.push(centralHeader, fileNameBuffer);

      offset += localHeader.length + fileNameBuffer.length + data.length;
    });

    const centralDirectory = Buffer.concat(centralParts);
    const endRecord = Buffer.alloc(22);
    endRecord.writeUInt32LE(0x06054b50, 0);
    endRecord.writeUInt16LE(0, 4);
    endRecord.writeUInt16LE(0, 6);
    endRecord.writeUInt16LE(entries.length, 8);
    endRecord.writeUInt16LE(entries.length, 10);
    endRecord.writeUInt32LE(centralDirectory.length, 12);
    endRecord.writeUInt32LE(offset, 16);
    endRecord.writeUInt16LE(0, 20);

    return Buffer.concat([...fileParts, centralDirectory, endRecord]);
  };

  const buildFolderDownloadPayload = (folderRow: any) => {
    const filesToZip: Array<{ name: string; data: Buffer }> = [];

    const walkFolder = (folderId: string, prefix: string) => {
      const children = db.prepare('SELECT * FROM files WHERE parent_id = ? ORDER BY type DESC, name ASC').all(folderId) as any[];
      children.forEach((child) => {
        if (child.type === 'folder') {
          walkFolder(child.id, `${prefix}${child.name}/`);
          return;
        }
        filesToZip.push({
          name: `${prefix}${child.name}`,
          data: normalizeFileBufferFromStoredUrl(child.url),
        });
      });
    };

    walkFolder(folderRow.id, `${folderRow.name}/`);

    const zipBuffer = buildStoredZipBuffer(filesToZip);
    return {
      id: folderRow.id,
      name: `${folderRow.name}.zip`,
      url: `data:application/zip;base64,${zipBuffer.toString('base64')}`,
      extension: 'zip',
      size: `${(zipBuffer.length / 1024 / 1024).toFixed(2)} MB`,
    };
  };

  const ensureClientVaultStructure = (clientId: string | null | undefined) => {
    const normalizedClientId = String(clientId || '').trim();
    if (!normalizedClientId) return;

    const ensureFolder = (name: string, parentId: string | null = null) => {
      const existing = db.prepare("SELECT id FROM files WHERE client_id = ? AND type = 'folder' AND employee_id IS NULL AND name = ? AND ((parent_id IS NULL AND ? IS NULL) OR parent_id = ?) LIMIT 1").get(
        normalizedClientId,
        name,
        parentId,
        parentId,
      ) as any;
      if (existing?.id) return String(existing.id);

      const id = Math.random().toString(36).slice(2, 11);
      const date = new Date().toISOString();
      db.prepare("INSERT INTO files (id, name, type, parent_id, employee_id, client_id, size, date, extension, url, password) VALUES (?, ?, 'folder', ?, NULL, ?, NULL, ?, NULL, NULL, NULL)").run(
        id,
        name,
        parentId,
        normalizedClientId,
        date,
      );
      return id;
    };

    const labourDocsId = ensureFolder('Labour & Docs');
    const employeesRootId = ensureFolder('Employees');
    for (const name of ['Tax Year 2020', 'Tax Year 2021', 'Tax Year 2022', 'Tax Year 2023', 'Tax Year 2024']) {
      ensureFolder(name);
    }
    const tax2025Id = ensureFolder('Tax Year 2025');
    const tax2026Id = ensureFolder('Tax Year 2026');

    const labourEmployeesFolderId = ensureFolder('Employees', labourDocsId);
    for (const name of ['Hearings Etc', 'Excel', 'Company Docs', 'COIDA']) {
      ensureFolder(name, labourDocsId);
    }
    ensureFolder('Employee Contracts', labourEmployeesFolderId);

    const activeEmployees = db.prepare(`SELECT id, first_name, last_name, emp_id FROM employees WHERE client_id = ? AND COALESCE(status, 'active') != 'offboarded' ORDER BY first_name ASC, last_name ASC`).all(normalizedClientId) as any[];
    activeEmployees.forEach((employee) => {
      const displayName = [employee.first_name, employee.last_name].map((part: any) => String(part || '').trim()).filter(Boolean).join(' ').trim()
        || String(employee.emp_id || employee.id || 'Employee').trim();
      const existingEmployeeFolder = db.prepare("SELECT id, parent_id FROM files WHERE client_id = ? AND type = 'folder' AND employee_id = ? ORDER BY CASE WHEN parent_id IS NULL THEN 0 ELSE 1 END, name ASC LIMIT 1").get(
        normalizedClientId,
        employee.id,
      ) as any;

      if (existingEmployeeFolder?.id) {
        db.prepare('UPDATE files SET name = ?, parent_id = ?, client_id = ? WHERE id = ?').run(displayName, employeesRootId, normalizedClientId, existingEmployeeFolder.id);
        db.prepare('UPDATE files SET client_id = ? WHERE employee_id = ?').run(normalizedClientId, employee.id);
      } else {
        const id = Math.random().toString(36).slice(2, 11);
        const date = new Date().toISOString();
        db.prepare("INSERT INTO files (id, name, type, parent_id, employee_id, client_id, size, date, extension, url, password) VALUES (?, ?, 'folder', ?, ?, ?, NULL, ?, NULL, NULL, NULL)").run(
          id,
          displayName,
          employeesRootId,
          employee.id,
          normalizedClientId,
          date,
        );
      }
    });

    const months = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ];

    const ensureTaxYearStructure = (taxFolderId: string | null) => {
      if (!taxFolderId) return;
      const weeklyId = ensureFolder('Weekly Payroll', taxFolderId);
      ensureFolder('Monthly Payroll', taxFolderId);
      const proofsId = ensureFolder('Proofs', taxFolderId);
      for (const monthName of months) {
        ensureFolder(monthName, weeklyId);
      }
      ensureFolder('SARS', proofsId);
      ensureFolder('Mibco', proofsId);
    };

    ensureTaxYearStructure(tax2025Id);
    ensureTaxYearStructure(tax2026Id);

    const nextYearLabel = `Tax Year ${new Date().getFullYear() + 1}`;
    const nextTaxYearId = ensureFolder(nextYearLabel);
    ensureTaxYearStructure(nextTaxYearId);
  };

  // User Management (Super Admin Only)
  const isSuperAdmin = (req: any, res: any, next: any) => {
    const sessionRole = (req.session as any)?.userRole;
    const userId = (req.session as any)?.userId;

    console.log(`[SuperAdminCheck] SessionRole: ${sessionRole}, UserID: ${userId}, URL: ${req.url}`);

    if (sessionRole === "superadmin") {
      return next();
    }

    // Fallback: Check database if session role is missing but userId exists
    if (userId) {
      try {
        const user: any = db.prepare("SELECT email, role FROM users WHERE id = ?").get(userId);
        const normalizedEmail = String(user?.email || '').trim().toLowerCase();
        if (user?.role === "superadmin" || allowedSuperAdminEmails.has(normalizedEmail)) {
          if (allowedSuperAdminEmails.has(normalizedEmail) && user?.role !== 'superadmin') {
            db.prepare("UPDATE users SET role = 'superadmin', is_verified = 1 WHERE id = ?").run(userId);
          }
          console.log(`[SuperAdminCheck] Verified from DB for user: ${userId}`);
          (req.session as any).userRole = "superadmin"; // Restore to session
          return next();
        }
        console.warn(`[SuperAdminCheck] User ${userId} is not a super admin (Role: ${user?.role})`);
      } catch (dbErr) {
        console.error("[SuperAdminCheck] DB error:", dbErr);
      }
    }

    console.warn(`[SuperAdminCheck] Access denied. SessionRole: ${sessionRole}, UserID: ${userId}`);
    res.status(403).json({ 
      error: "Forbidden: Super Admin access required",
      debug: {
        hasSession: !!req.session,
        role: sessionRole,
        userId: userId
      }
    });
  };

  const serializeAdminClient = (row: any) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    users: Number(row.users) || 0,
    files: Number(row.files) || 0,
    lastActive: row.last_activity || row.updated_at || row.created_at,
    dashboardType: row.dashboard_type || 'rostering',
    lockedFeatures: safeJsonParse(row.locked_features, []),
    enabledDefinitions: mergeDefinitions(safeJsonParse(row.enabled_definitions, [])),
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
      employees: Number(row.employees) || 0,
      shiftsThisWeek: Number(row.shiftsThisWeek) || 0,
      totalHours: Number(row.totalHours) || 0,
    },
  });

  registerAdminRoutes({
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
  });

  registerFilesRoutes({
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
  });

  registerWorkforceRoutes({
    app,
    db,
    requireActiveTrial,
    requireUnlockedFeature,
    logActivity,
    normalizeEmployeePayload,
    validateEmployeePayload,
    normalizeShiftPayload,
    validateShiftPayload,
  });

  registerLeaveRoutes({
    app,
    db,
    requireActiveTrial,
    requireUnlockedFeature,
    requireAuth,
    getEffectiveClientId,
    getSessionUser,
    getSessionEmployee,
    getEffectiveTenantClientId,
    leaveRequestSelect,
    serializeLeaveRequest,
    normalizeLeaveStatus,
    normalizeLeaveType,
    adjustEmployeeLeaveBalance,
    reconcileEmployeeLeaveAccrual,
    reconcileLeaveAccrualsForClient,
    getOverlapLeaveRequests,
    getBalanceTrackedLeaveType,
    leaveColumns: LEAVE_COLUMNS,
    parseBoolean,
    isValidISODate,
    getWeekdayLeaveDays,
    toDateOnly,
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
