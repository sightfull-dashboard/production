import { calculateEmployeePayroll } from '../../services/PayrollService';
import { sendMailMessage } from '../integrations/mailer';

export type PayrollMailBreakdownRow = {
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

export const formatPayrollCsv = (rows: PayrollMailBreakdownRow[]) => {
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

const buildPeriodDays = (periodStart: string, periodEnd: string, toLocalIsoDate: (value: Date) => string) => {
  const start = new Date(`${periodStart}T00:00:00`);
  const end = new Date(`${periodEnd}T00:00:00`);
  const days: string[] = [];
  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    days.push(toLocalIsoDate(cursor));
  }
  return days;
};

export const buildRosterAndTimesheetAttachments = (
  payload: {
    clientName: string;
    periodStart: string;
    periodEnd: string;
    employeeBreakdown: PayrollMailBreakdownRow[];
  },
  context: {
    employees: any[];
    shifts: any[];
    roster: any[];
    rosterMeta: any[];
  },
  deps: {
    mergeDefinitions: (definitions?: string[] | null) => string[];
    toLocalIsoDate: (value: Date) => string;
  },
) => {
  const periodDays = buildPeriodDays(payload.periodStart, payload.periodEnd, deps.toLocalIsoDate);
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
  const rosterPdfBuffer = buildStyledTablePdfBuffer(
    `Roster - ${payload.clientName}`,
    `Period: ${payload.periodStart} to ${payload.periodEnd}`,
    rosterHeader,
    rosterRows,
  );

  const weekDays = periodDays.map((dayIso) => new Date(`${dayIso}T00:00:00`));
  const visibleDefinitions = deps.mergeDefinitions(context.rosterMeta.length ? Object.keys(context.rosterMeta[0]).filter((key) => !['id','client_id','employee_id','week_start','created_at','updated_at'].includes(key)) : undefined);
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

export const sendPayrollSubmissionEmail = async (payload: {
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
