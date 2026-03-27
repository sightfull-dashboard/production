import type { Express, Request, Response, NextFunction } from 'express';
import { getEffectiveClientId, getSessionRole } from '../utils/tenant';

type Middleware = (req: Request, res: Response, next: NextFunction) => unknown;

const formatDateOnly = (value: Date) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const generateAutoEmployeeId = (db: any, clientId: string | null) => {
  const row = clientId
    ? db.prepare("SELECT COALESCE(MAX(CAST(SUBSTR(emp_id, 4) AS INTEGER)), 0) AS max_emp FROM employees WHERE client_id = ? AND emp_id GLOB 'EMP[0-9]*'").get(clientId) as any
    : db.prepare("SELECT COALESCE(MAX(CAST(SUBSTR(emp_id, 4) AS INTEGER)), 0) AS max_emp FROM employees WHERE emp_id GLOB 'EMP[0-9]*'").get() as any;
  const nextSequence = Number(row?.max_emp || 0) + 1;
  return `EMP${String(nextSequence).padStart(3, '0')}`;
};

type EmployeePayload = {
  emp_id: string;
  pin: string;
  first_name: string;
  last_name: string;
  start_date: string;
  dob: string;
  last_worked: string;
  job_title: string;
  department: string;
  pay_rate: number;
  email: string | null;
  cell: string | null;
  residency: string;
  street_number: string;
  id_number: string;
  passport: string | null;
  bank_name: string;
  portal_enabled: string;
  country_of_issue: string;
  province: string;
  account_holder: string;
  account_no: string;
  account_type: string;
  tax_number: string;
  ismibco: string;
  isunion: string;
  union_name: string;
  address1: string;
  address2: string;
  address3: string;
  address4: string;
  postal_code: string;
  paye_credit: string;
  classification: string;
  annual_leave: number;
  sick_leave: number;
  family_leave: number;
  allow_blank_pin: boolean;
};

type ShiftPayload = {
  id: string;
  label: string;
  start: string;
  end: string;
  lunch: number;
};

type RegisterWorkforceRoutesDeps = {
  app: Express;
  db: any;
  requireActiveTrial: Middleware;
  requireUnlockedFeature: (feature: string) => Middleware;
  logActivity: (req: Request, action: string, details?: any) => void;
  normalizeEmployeePayload: (data: any) => EmployeePayload;
  validateEmployeePayload: (data: EmployeePayload) => string[];
  normalizeShiftPayload: (data: any) => ShiftPayload;
  validateShiftPayload: (data: ShiftPayload) => string[];
};

const PROTECTED_LEAVE_SHIFT_LABELS = ['absent', 'annual leave', 'sick leave', 'family leave', 'unshifted'];

function normalizeShiftLabel(value: string | null | undefined) {
  return String(value || '').trim().toLowerCase();
}

function isProtectedLeaveShiftLabel(value: string | null | undefined) {
  return PROTECTED_LEAVE_SHIFT_LABELS.includes(normalizeShiftLabel(value));
}

function requestIsSuperAdmin(req: any) {
  return getSessionRole(req) === 'superadmin';
}

function isPayrollLockedForDate(db: any, clientId: string | null, dayDate: string) {
  if (!clientId || !dayDate) return false;
  const row = db.prepare(`SELECT id FROM payroll_submissions WHERE client_id = ? AND period_start <= ? AND period_end >= ? LIMIT 1`).get(clientId, dayDate, dayDate) as any;
  return !!row;
}

function isPayrollLockedForPeriod(db: any, clientId: string | null, periodStart: string, periodEnd: string) {
  if (!clientId || !periodStart || !periodEnd) return false;
  const row = db.prepare(`SELECT id FROM payroll_submissions WHERE client_id = ? AND period_start <= ? AND period_end >= ? LIMIT 1`).get(clientId, periodEnd, periodStart) as any;
  return !!row;
}

const getLeaveTypeFromShift = (db: any, shiftId: string | null | undefined) => {
  if (!shiftId) return null;
  const shift = db.prepare('SELECT label FROM shifts WHERE id = ?').get(shiftId) as any;
  const label = normalizeShiftLabel(shift?.label);
  if (label === 'annual leave') return 'annual';
  if (label === 'sick leave') return 'sick';
  if (label === 'family leave') return 'family';
  return null;
};

export function registerWorkforceRoutes({
  app,
  db,
  requireActiveTrial,
  requireUnlockedFeature,
  logActivity,
  normalizeEmployeePayload,
  validateEmployeePayload,
  normalizeShiftPayload,
  validateShiftPayload,
}: RegisterWorkforceRoutesDeps) {
  app.get('/api/employees', requireActiveTrial, requireUnlockedFeature('employee_records'), (req, res) => {
    const role = getSessionRole(req);
    const clientId = getEffectiveClientId(db, req);
    if (clientId && typeof (globalThis as any).reconcileLeaveAccrualsForClient === 'function') {
      (globalThis as any).reconcileLeaveAccrualsForClient(clientId);
    }
    let employees: any[] = [];

    const mapDerivedLastWorkedDate = (rows: any[]) => rows.map((employee) => {
      const lastWorkedRow = db.prepare(`
        SELECT MAX(day_date) AS last_worked_date
        FROM roster
        WHERE employee_id = ? AND shift_id IS NOT NULL AND TRIM(COALESCE(shift_id, '')) <> ''
      `).get(employee.id) as any;

      return {
        ...employee,
        last_worked_date: lastWorkedRow?.last_worked_date || null,
      };
    });

    if (role === 'superadmin' && !clientId) {
      employees = db.prepare('SELECT * FROM employees ORDER BY CAST(SUBSTR(emp_id, 4) AS INTEGER) ASC, emp_id ASC').all();
    } else if (clientId) {
      employees = db.prepare('SELECT * FROM employees WHERE client_id = ? ORDER BY CAST(SUBSTR(emp_id, 4) AS INTEGER) ASC, emp_id ASC').all(clientId);
    }

    res.json(mapDerivedLastWorkedDate(employees));
  });

  app.post('/api/employees', requireActiveTrial, requireUnlockedFeature('employee_records'), (req, res) => {
    const data = normalizeEmployeePayload(req.body);

    const actorRole = getSessionRole(req);
    const isSuperAdmin = actorRole === 'superadmin';
    const actorClientId = getEffectiveClientId(db, req);

    if (!actorClientId) {
      return res.status(400).json({ error: 'No active client dashboard selected.' });
    }

    if (!isSuperAdmin) {
      data.emp_id = generateAutoEmployeeId(db, actorClientId);
      data.annual_leave = 0;
      data.sick_leave = 0;
      data.family_leave = 0;
    }

    const errors = validateEmployeePayload(data);

    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join(' ') });
    }

    const existingEmployeeId = actorClientId
      ? db.prepare('SELECT id FROM employees WHERE lower(emp_id) = lower(?) AND client_id = ?').get(data.emp_id, actorClientId) as any
      : db.prepare('SELECT id FROM employees WHERE lower(emp_id) = lower(?)').get(data.emp_id) as any;
    if (existingEmployeeId) {
      return res.status(400).json({ error: 'Employee ID already exists.' });
    }

    if (data.email) {
      const existingEmail = actorClientId
        ? db.prepare('SELECT id FROM employees WHERE lower(email) = lower(?) AND client_id = ?').get(data.email, actorClientId) as any
        : db.prepare('SELECT id FROM employees WHERE lower(email) = lower(?)').get(data.email) as any;
      if (existingEmail) {
        return res.status(400).json({ error: 'Employee email already exists.' });
      }
    }

    if (data.id_number) {
      const existingIdNumber = actorClientId
        ? db.prepare('SELECT id FROM employees WHERE id_number = ? AND client_id = ?').get(data.id_number, actorClientId) as any
        : db.prepare('SELECT id FROM employees WHERE id_number = ?').get(data.id_number) as any;
      if (existingIdNumber) {
        return res.status(400).json({ error: 'Employee ID number already exists.' });
      }
    }

    if (data.tax_number) {
      const existingTaxNumber = actorClientId
        ? db.prepare('SELECT id FROM employees WHERE tax_number = ? AND client_id = ?').get(data.tax_number, actorClientId) as any
        : db.prepare('SELECT id FROM employees WHERE tax_number = ?').get(data.tax_number) as any;
      if (existingTaxNumber) {
        return res.status(400).json({ error: 'Employee tax number already exists.' });
      }
    }

    const id = Math.random().toString(36).substr(2, 9);
    try {

      const stmt = db.prepare(`
        INSERT INTO employees (
          id, emp_id, pin, first_name, last_name, start_date, dob, last_worked, job_title, department, pay_rate,
          email, cell, residency, street_number, id_number, passport, bank_name, portal_enabled, country_of_issue, province, account_holder, account_no, account_type, tax_number, ismibco, isunion, union_name,
          address1, address2, address3, address4, postal_code, paye_credit, classification, annual_leave, sick_leave, family_leave, client_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        id, data.emp_id, data.pin || null, data.first_name, data.last_name, data.start_date, data.dob, data.last_worked, data.job_title, data.department, data.pay_rate,
        data.email, data.cell, data.residency, data.street_number, data.id_number, data.passport, data.bank_name, data.portal_enabled || 'no', data.country_of_issue, data.province, data.account_holder, data.account_no, data.account_type,
        data.tax_number, data.ismibco || null, data.isunion || null, data.union_name, data.address1, data.address2, data.address3,
        data.address4, data.postal_code, data.paye_credit, data.classification, data.annual_leave, data.sick_leave, data.family_leave, actorClientId,
      );
      db.prepare(`UPDATE employees SET annual_leave_last_accrual_date = COALESCE(annual_leave_last_accrual_date, ?), sick_cycle_start_date = COALESCE(sick_cycle_start_date, ?) WHERE id = ?`).run(data.start_date, data.start_date, id);

      const rootFolderId = Math.random().toString(36).substr(2, 9);
      const now = new Date().toISOString().split('T')[0];

      db.prepare('INSERT INTO files (id, name, type, employee_id, client_id, date) VALUES (?, ?, ?, ?, ?, ?)')
        .run(rootFolderId, `${data.first_name} ${data.last_name}`, 'folder', id, actorClientId, now);

      const subFolders = ['Contracts', 'ID & Passport', 'Tax Documents', 'Certificates', 'Other'];
      const insertSub = db.prepare('INSERT INTO files (id, name, type, parent_id, employee_id, client_id, date) VALUES (?, ?, ?, ?, ?, ?, ?)');
      subFolders.forEach((folderName) => {
        insertSub.run(Math.random().toString(36).substr(2, 9), folderName, 'folder', rootFolderId, id, actorClientId, now);
      });

      logActivity(req, 'CREATE_EMPLOYEE', { emp_id: data.emp_id, name: `${data.first_name} ${data.last_name}` });
      res.json({ id, ...data });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e?.message || 'Failed to save employee' });
    }
  });

  app.put('/api/employees/:id', requireActiveTrial, requireUnlockedFeature('employee_records'), (req, res) => {
    const { id } = req.params;
    const role = getSessionRole(req);
    const clientId = getEffectiveClientId(db, req);
    if (role !== 'superadmin' && clientId) {
      const owned = db.prepare('SELECT id FROM employees WHERE id = ? AND client_id = ?').get(id, clientId) as any;
      if (!owned) return res.status(403).json({ error: 'Employee does not belong to this dashboard.' });
    }
    const data = normalizeEmployeePayload(req.body);
    const errors = validateEmployeePayload(data);

    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join(' ') });
    }

    const actorRole = getSessionRole(req);
    const isSuperAdmin = actorRole === 'superadmin';
    const actorClientId = getEffectiveClientId(db, req);

    const existingEmployee = db.prepare('SELECT emp_id, annual_leave, sick_leave, family_leave FROM employees WHERE id = ?').get(id) as any;
    if (!existingEmployee) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    if (!isSuperAdmin) {
      data.emp_id = existingEmployee.emp_id;
      data.annual_leave = Number(existingEmployee.annual_leave) || 0;
      data.sick_leave = Number(existingEmployee.sick_leave) || 0;
      data.family_leave = Number(existingEmployee.family_leave) || 0;
    }

    const existingEmployeeId = actorClientId
      ? db.prepare('SELECT id FROM employees WHERE lower(emp_id) = lower(?) AND id != ? AND client_id = ?').get(data.emp_id, id, actorClientId) as any
      : db.prepare('SELECT id FROM employees WHERE lower(emp_id) = lower(?) AND id != ?').get(data.emp_id, id) as any;
    if (existingEmployeeId) {
      return res.status(400).json({ error: 'Employee ID already exists.' });
    }

    if (data.email) {
      const existingEmail = actorClientId
        ? db.prepare('SELECT id FROM employees WHERE lower(email) = lower(?) AND id != ? AND client_id = ?').get(data.email, id, actorClientId) as any
        : db.prepare('SELECT id FROM employees WHERE lower(email) = lower(?) AND id != ?').get(data.email, id) as any;
      if (existingEmail) {
        return res.status(400).json({ error: 'Employee email already exists.' });
      }
    }

    if (data.id_number) {
      const existingIdNumber = actorClientId
        ? db.prepare('SELECT id FROM employees WHERE id_number = ? AND id != ? AND client_id = ?').get(data.id_number, id, actorClientId) as any
        : db.prepare('SELECT id FROM employees WHERE id_number = ? AND id != ?').get(data.id_number, id) as any;
      if (existingIdNumber) {
        return res.status(400).json({ error: 'Employee ID number already exists.' });
      }
    }

    if (data.tax_number) {
      const existingTaxNumber = actorClientId
        ? db.prepare('SELECT id FROM employees WHERE tax_number = ? AND id != ? AND client_id = ?').get(data.tax_number, id, actorClientId) as any
        : db.prepare('SELECT id FROM employees WHERE tax_number = ? AND id != ?').get(data.tax_number, id) as any;
      if (existingTaxNumber) {
        return res.status(400).json({ error: 'Employee tax number already exists.' });
      }
    }

    try {
      const stmt = db.prepare(`
        UPDATE employees SET
          emp_id = ?, pin = ?, first_name = ?, last_name = ?, start_date = ?, dob = ?, last_worked = ?, job_title = ?, department = ?, pay_rate = ?,
          email = ?, cell = ?, residency = ?, street_number = ?, id_number = ?, passport = ?, bank_name = ?, portal_enabled = ?, country_of_issue = ?, province = ?, account_holder = ?, account_no = ?, account_type = ?, tax_number = ?, ismibco = ?, isunion = ?, union_name = ?,
          address1 = ?, address2 = ?, address3 = ?, address4 = ?, postal_code = ?, paye_credit = ?, classification = ?, annual_leave = ?, sick_leave = ?, family_leave = ?
        WHERE id = ?
      `);

      const result = stmt.run(
        data.emp_id, data.pin || null, data.first_name, data.last_name, data.start_date, data.dob, data.last_worked, data.job_title, data.department, data.pay_rate,
        data.email, data.cell, data.residency, data.street_number, data.id_number, data.passport, data.bank_name, data.portal_enabled || 'no', data.country_of_issue, data.province, data.account_holder, data.account_no, data.account_type,
        data.tax_number, data.ismibco || null, data.isunion || null, data.union_name, data.address1, data.address2, data.address3,
        data.address4, data.postal_code, data.paye_credit, data.classification, data.annual_leave, data.sick_leave, data.family_leave,
        id,
      );

      if (result.changes === 0) {
        return res.status(404).json({ error: 'Employee not found.' });
      }

      logActivity(req, 'UPDATE_EMPLOYEE', { id, emp_id: data.emp_id, name: `${data.first_name} ${data.last_name}` });
      res.json({ id, ...data });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e?.message || 'Failed to update employee' });
    }
  });

  app.post('/api/employees/:id/offboard', requireActiveTrial, requireUnlockedFeature('employee_records'), (req, res) => {
    const { id } = req.params;
    const { reason, lastWorked, preparePayslip, generateUIF } = req.body;

    try {
      const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(id) as any;
      if (!employee) return res.status(404).json({ error: 'Employee not found' });

      const lastZ = db.prepare("SELECT emp_id FROM employees WHERE emp_id LIKE 'Z%' ORDER BY emp_id DESC LIMIT 1").get() as any;
      let nextZ = 'Z001';
      if (lastZ) {
        const lastNum = parseInt(lastZ.emp_id.substring(1));
        if (!isNaN(lastNum)) {
          nextZ = `Z${(lastNum + 1).toString().padStart(3, '0')}`;
        }
      }

      db.prepare(`
        UPDATE employees SET
          status = 'offboarded',
          emp_id = ?,
          last_worked = ?
        WHERE id = ?
      `).run(nextZ, lastWorked, id);

      logActivity(req, 'OFFBOARD_EMPLOYEE', {
        id,
        emp_id: employee.emp_id,
        new_emp_id: nextZ,
        reason,
        preparePayslip,
        generateUIF,
      });

      res.json({ success: true, new_emp_id: nextZ });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to offboard employee' });
    }
  });

  app.delete('/api/employees/:id', requireActiveTrial, requireUnlockedFeature('employee_records'), (req, res) => {
    const { id } = req.params;

    try {
      const role = getSessionRole(req);
      const clientId = getEffectiveClientId(db, req);
      const employee = role === 'superadmin'
        ? db.prepare('SELECT id, emp_id, first_name, last_name, client_id, status, last_worked FROM employees WHERE id = ?').get(id) as any
        : db.prepare('SELECT id, emp_id, first_name, last_name, client_id, status, last_worked FROM employees WHERE id = ? AND client_id = ?').get(id, clientId) as any;
      if (!employee) {
        return res.status(404).json({ error: 'Employee not found.' });
      }

      const fullName = `${employee.first_name || ''} ${employee.last_name || ''}`.trim();
      const payrollPresence = Number((db.prepare(`
        SELECT COUNT(*) as c
        FROM payroll_submissions
        WHERE (? IS NULL OR client_id = ?)
          AND (
            breakdown_json LIKE ?
            OR breakdown_json LIKE ?
            OR breakdown_json LIKE ?
          )
      `).get(employee.client_id || null, employee.client_id || null, `%${employee.id}%`, `%${employee.emp_id || ''}%`, `%${fullName}%`) as any)?.c || 0);

      if (payrollPresence > 0) {
        const lastZ = employee.client_id
          ? db.prepare("SELECT emp_id FROM employees WHERE client_id = ? AND emp_id LIKE 'Z%' ORDER BY emp_id DESC LIMIT 1").get(employee.client_id) as any
          : db.prepare("SELECT emp_id FROM employees WHERE emp_id LIKE 'Z%' ORDER BY emp_id DESC LIMIT 1").get() as any;

        let nextZ = 'Z001';
        if (lastZ?.emp_id) {
          const lastNum = parseInt(String(lastZ.emp_id).substring(1), 10);
          if (!Number.isNaN(lastNum)) {
            nextZ = `Z${String(lastNum + 1).padStart(3, '0')}`;
          }
        }

        db.prepare(`
          UPDATE employees SET
            status = 'offboarded',
            emp_id = ?,
            delete_reason = ?,
            last_worked = COALESCE(last_worked, date('now'))
          WHERE id = ?
        `).run(nextZ, 'Admin override deleted', id);

        logActivity(req, 'OFFBOARD_EMPLOYEE_DELETE_OVERRIDE', {
          id,
          emp_id: employee.emp_id,
          new_emp_id: nextZ,
          name: fullName,
          reason: 'Admin override deleted',
          payrollPresence,
        });
        return res.json({ success: true, offboarded: true, new_emp_id: nextZ, reason: 'Admin override deleted' });
      }

      db.prepare('DELETE FROM roster WHERE employee_id = ?').run(id);
      db.prepare('DELETE FROM roster_meta WHERE employee_id = ?').run(id);
      db.prepare('DELETE FROM files WHERE employee_id = ?').run(id);
      db.prepare('DELETE FROM employees WHERE id = ?').run(id);
      logActivity(req, 'DELETE_EMPLOYEE', { id, emp_id: employee.emp_id, name: fullName });
      res.json({ success: true, deleted: true });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e?.message || 'Failed to delete employee.' });
    }
  });

  app.get('/api/shifts', requireActiveTrial, requireUnlockedFeature('rostering'), (_req, res) => {
    const shifts = db.prepare('SELECT * FROM shifts').all();
    res.json(shifts);
  });

  app.post('/api/shifts', requireActiveTrial, requireUnlockedFeature('rostering'), (req, res) => {
    const data = normalizeShiftPayload(req.body);
    const errors = validateShiftPayload(data);
    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join(' ') });
    }

    if (!requestIsSuperAdmin(req) && isProtectedLeaveShiftLabel(data.label)) {
      return res.status(403).json({ error: 'Only Super Admin can manage leave shifts.' });
    }

    const existingShift = db.prepare('SELECT id FROM shifts WHERE lower(label) = lower(?)').get(data.label) as any;
    if (existingShift) {
      return res.status(400).json({ error: 'A shift with this label already exists.' });
    }

    const id = data.id || Math.random().toString(36).substr(2, 9);
    try {
      db.prepare('INSERT INTO shifts (id, label, start, end, lunch) VALUES (?, ?, ?, ?, ?)')
        .run(id, data.label, data.start, data.end, data.lunch);
      logActivity(req, 'CREATE_SHIFT', { id, label: data.label });
      res.json({ id, ...data });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e?.message || 'Failed to create shift.' });
    }
  });

  app.put('/api/shifts/:id', requireActiveTrial, requireUnlockedFeature('rostering'), (req, res) => {
    const data = normalizeShiftPayload(req.body);
    const errors = validateShiftPayload(data);
    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join(' ') });
    }

    const existingRecord = db.prepare('SELECT id, label FROM shifts WHERE id = ?').get(req.params.id) as any;
    if (!existingRecord) {
      return res.status(404).json({ error: 'Shift not found.' });
    }

    if (!requestIsSuperAdmin(req) && (isProtectedLeaveShiftLabel(existingRecord.label) || isProtectedLeaveShiftLabel(data.label))) {
      return res.status(403).json({ error: 'Only Super Admin can manage leave shifts.' });
    }

    const existingShift = db.prepare('SELECT id FROM shifts WHERE lower(label) = lower(?) AND id != ?').get(data.label, req.params.id) as any;
    if (existingShift) {
      return res.status(400).json({ error: 'A shift with this label already exists.' });
    }

    try {
      const result = db.prepare('UPDATE shifts SET label = ?, start = ?, end = ?, lunch = ? WHERE id = ?')
        .run(data.label, data.start, data.end, data.lunch, req.params.id);
      if (result.changes === 0) {
        return res.status(404).json({ error: 'Shift not found.' });
      }
      logActivity(req, 'UPDATE_SHIFT', { id: req.params.id, label: data.label });
      res.json({ id: req.params.id, ...data });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e?.message || 'Failed to update shift.' });
    }
  });

  app.delete('/api/shifts/:id', requireActiveTrial, requireUnlockedFeature('rostering'), (req, res) => {
    const existingRecord = db.prepare('SELECT id, label FROM shifts WHERE id = ?').get(req.params.id) as any;
    if (!existingRecord) {
      return res.status(404).json({ error: 'Shift not found.' });
    }

    if (!requestIsSuperAdmin(req) && isProtectedLeaveShiftLabel(existingRecord.label)) {
      return res.status(403).json({ error: 'Only Super Admin can manage leave shifts.' });
    }

    const inUse = db.prepare('SELECT COUNT(*) as count FROM roster WHERE shift_id = ?').get(req.params.id) as any;
    if ((inUse?.count || 0) > 0) {
      return res.status(400).json({ error: 'Cannot delete a shift that is assigned on the roster.' });
    }

    const result = db.prepare('DELETE FROM shifts WHERE id = ?').run(req.params.id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Shift not found.' });
    }
    logActivity(req, 'DELETE_SHIFT', { id: req.params.id });
    res.json({ success: true });
  });

  app.get('/api/roster', requireActiveTrial, requireUnlockedFeature('rostering'), (req, res) => {
    const weekStart = typeof req.query.week_start === 'string' ? req.query.week_start : null;
    const requestedDays = typeof req.query.period_days === 'string' ? Number(req.query.period_days) : null;
    const periodDays = Number.isFinite(requestedDays) && requestedDays && requestedDays > 0 ? Number(requestedDays) : 7;
    const role = getSessionRole(req);
    const clientId = getEffectiveClientId(db, req);

    const conditions: string[] = [];
    const params: any[] = [];
    if (role !== 'superadmin') {
      if (!clientId) return res.json([]);
      conditions.push('employee_id IN (SELECT id FROM employees WHERE client_id = ?)');
      params.push(clientId);
    }

    if (weekStart) {
      const endDate = new Date(`${weekStart}T12:00:00`);
      endDate.setDate(endDate.getDate() + (periodDays - 1));
      const weekEnd = formatDateOnly(endDate);
      conditions.push('day_date <= ?');
      params.push(weekEnd);
    }

    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
    const roster = db.prepare(`SELECT * FROM roster${where} ORDER BY day_date ASC`).all(...params);
    res.json(roster);
  });

  app.post('/api/roster', requireActiveTrial, requireUnlockedFeature('rostering'), (req, res) => {
    const { employee_id, day_date, shift_id } = req.body;
    const role = getSessionRole(req);
    const clientId = getEffectiveClientId(db, req);
    if (role !== 'superadmin' && clientId && employee_id) {
      const owned = db.prepare('SELECT id FROM employees WHERE id = ? AND client_id = ?').get(employee_id, clientId) as any;
      if (!owned) return res.status(403).json({ error: 'Employee does not belong to this dashboard.' });
    }
    if (role !== 'superadmin' && isPayrollLockedForDate(db, clientId, String(day_date || ''))) {
      return res.status(403).json({ error: 'This payroll-submitted roster period is locked. Contact admin through Support for changes.' });
    }
    if (shift_id === null) {
      db.prepare('DELETE FROM roster WHERE employee_id = ? AND day_date = ?').run(employee_id, day_date);
      logActivity(req, 'DELETE_ROSTER', { employee_id, day_date });
    } else {
      db.prepare('INSERT OR REPLACE INTO roster (employee_id, day_date, shift_id) VALUES (?, ?, ?)')
        .run(employee_id, day_date, shift_id);
      logActivity(req, 'UPDATE_ROSTER', { employee_id, day_date, shift_id, leave_type: getLeaveTypeFromShift(db, shift_id) });
    }
    if (employee_id) {
      try {
        (globalThis as any).syncRosterLeaveRecordsForEmployee?.(employee_id);
      } catch (syncError) {
        console.error('Failed to sync roster leave records:', syncError);
        return res.status(500).json({ error: 'Roster updated but leave history could not be synchronized.' });
      }
    }
    res.json({ success: true });
  });

  app.get('/api/roster-meta', requireActiveTrial, requireUnlockedFeature('timesheets'), (req, res) => {
    const weekStart = typeof req.query.week_start === 'string' ? req.query.week_start : null;
    const employeeId = typeof req.query.employee_id === 'string' ? req.query.employee_id : null;
    const role = getSessionRole(req);
    const clientId = getEffectiveClientId(db, req);

    const conditions: string[] = [];
    const params: any[] = [];
    if (role !== 'superadmin') {
      if (!clientId) return res.json([]);
      conditions.push('employee_id IN (SELECT id FROM employees WHERE client_id = ?)');
      params.push(clientId);
    }
    if (weekStart) { conditions.push('week_start = ?'); params.push(weekStart); }
    if (employeeId) { conditions.push('employee_id = ?'); params.push(employeeId); }
    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
    const meta = db.prepare(`SELECT * FROM roster_meta${where}`).all(...params);
    res.json(meta);
  });

  app.post('/api/roster-meta', requireActiveTrial, requireUnlockedFeature('timesheets'), (req, res) => {
    const { employee_id, week_start, field, value } = req.body;
    const role = getSessionRole(req);
    const clientId = getEffectiveClientId(db, req);
    if (role !== 'superadmin' && clientId && employee_id) {
      const owned = db.prepare('SELECT id FROM employees WHERE id = ? AND client_id = ?').get(employee_id, clientId) as any;
      if (!owned) return res.status(403).json({ error: 'Employee does not belong to this dashboard.' });
    }
    const periodStart = String(week_start || '');
    const periodDuration = db.prepare('SELECT roster_duration FROM clients WHERE id = ?').get(clientId) as any;
    const days = periodDuration?.roster_duration === '2_weeks' ? 14 : periodDuration?.roster_duration === '1_month' ? 28 : 7;
    const endDate = new Date(`${periodStart}T12:00:00`);
    endDate.setDate(endDate.getDate() + (days - 1));
    const periodEnd = formatDateOnly(endDate);
    if (role !== 'superadmin' && isPayrollLockedForPeriod(db, clientId, periodStart, periodEnd)) {
      return res.status(403).json({ error: 'This payroll-submitted roster period is locked. Contact admin through Support for changes.' });
    }
    const allowedFields = ['shortages', 'uniform', 'salary_advance', 'staff_loan', 'overthrows', 'oil_spill', 'stock_shortage', 'unpaid_hours', 'annual_bonus', 'incentive_bonus', 'data_allowance', 'night_shift_allowance', 'medical_allowance', 'mibco_health_insurance', 'health_insurance', 'garnishee', 'cell_phone_payment', 'income_tax_registration', 'performance_incentive', 'commission', 'sales_commission', 'notes'];
    if (!allowedFields.includes(field)) {
      return res.status(400).json({ error: 'Invalid field' });
    }

    const exists = db.prepare('SELECT * FROM roster_meta WHERE employee_id = ? AND week_start = ?').get(employee_id, week_start);
    if (exists) {
      db.prepare(`UPDATE roster_meta SET ${field} = ? WHERE employee_id = ? AND week_start = ?`)
        .run(value, employee_id, week_start);
      logActivity(req, 'UPDATE_ROSTER_META', { employee_id, week_start, field, value });
    } else {
      db.prepare(`INSERT INTO roster_meta (employee_id, week_start, ${field}) VALUES (?, ?, ?)`)
        .run(employee_id, week_start, value);
      logActivity(req, 'CREATE_ROSTER_META', { employee_id, week_start, field, value });
    }
    res.json({ success: true });
  });
}
