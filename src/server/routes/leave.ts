import type { Express, Request, Response, NextFunction } from 'express';
import { hashSecret, sanitizeEmployeeForResponse, shouldUpgradeLegacySecret, verifySecret } from '../utils/security';

type Middleware = (req: Request, res: Response, next: NextFunction) => unknown;

type LeaveRoutesDeps = {
  app: Express;
  db: any;
  requireActiveTrial: Middleware;
  requireUnlockedFeature: (feature: string) => Middleware;
  requireAuth: Middleware;
  getEffectiveClientId: (db: any, req: any) => string | null;
  getSessionUser: (req: any) => any;
  getSessionEmployee: (req: any) => any;
  getEffectiveTenantClientId: (req: any) => string | null;
  leaveRequestSelect: string;
  serializeLeaveRequest: (row: any) => any;
  normalizeLeaveStatus: (value: unknown) => any;
  normalizeLeaveType: (value: unknown) => any;
  adjustEmployeeLeaveBalance: (employeeId: string, type: any, amountDelta: number) => void;
  reconcileEmployeeLeaveAccrual: (employeeId: string) => void;
  reconcileLeaveAccrualsForClient: (clientId: string | null | undefined) => void;
  getOverlapLeaveRequests: (input: { employeeId: string; startDate: string; endDate: string; excludeId?: string | null }) => any[];
  getBalanceTrackedLeaveType: (type: any) => any;
  leaveColumns: Record<string, string>;
  parseBoolean: (value: unknown) => boolean;
  isValidISODate: (value: unknown) => value is string;
  getWeekdayLeaveDays: (startDate: string, endDate: string, isHalfDay: boolean) => number;
  toDateOnly: (value: string) => string;
};

export function registerLeaveRoutes({
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
  leaveColumns,
  parseBoolean,
  isValidISODate,
  getWeekdayLeaveDays,
  toDateOnly,
}: LeaveRoutesDeps) {
  app.patch('/api/leave-requests/:id', requireActiveTrial, requireUnlockedFeature('leave_management'), (req, res) => {
    const request = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(req.params.id) as any;
    if (!request) return res.status(404).json({ error: 'Leave request not found' });
    const status = normalizeLeaveStatus(req.body?.status);
    if (!status) return res.status(400).json({ error: 'Valid status is required' });
    const adminNotes = typeof req.body?.admin_notes === 'string' ? req.body.admin_notes.trim() : request.admin_notes;
    db.prepare('UPDATE leave_requests SET status = ?, admin_notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, adminNotes, req.params.id);
    if (request.status !== 'approved' && status === 'approved') adjustEmployeeLeaveBalance(request.employee_id, request.type, -Number(request.days || 0));
    if (request.status === 'approved' && status !== 'approved') adjustEmployeeLeaveBalance(request.employee_id, request.type, Number(request.days || 0));
    const row = db.prepare(`${leaveRequestSelect} WHERE lr.id = ?`).get(req.params.id) as any;
    res.json(serializeLeaveRequest(row));
  });

  app.get("/api/leave-requests", requireActiveTrial, requireUnlockedFeature("leave_management"), (req, res) => {
    try {
      const sessionUserId = (req.session as any).userId;
      const sessionEmployeeId = (req.session as any).employeeId as string | undefined;
      const activeClientId = getEffectiveClientId(db, req) || (sessionEmployeeId ? ((db.prepare('SELECT client_id FROM employees WHERE id = ?').get(sessionEmployeeId) as any)?.client_id || null) : null);
      reconcileLeaveAccrualsForClient(activeClientId);
      if (!sessionUserId && !sessionEmployeeId) return res.status(401).json({ error: 'Unauthorized' });
      const employeeId = typeof req.query.employee_id === 'string' ? req.query.employee_id : null;
      const status = normalizeLeaveStatus(req.query.status);
      const conditions: string[] = [];
      const params: any[] = [];

      if (sessionEmployeeId) {
        conditions.push('lr.employee_id = ?');
        params.push(sessionEmployeeId);
      } else if (employeeId) {
        conditions.push('lr.employee_id = ?');
        params.push(employeeId);
      }
      if (status) {
        conditions.push('lr.status = ?');
        params.push(status);
      }

      const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
      const rows = db.prepare(`${leaveRequestSelect}${where} ORDER BY lr.created_at DESC`).all(...params) as any[];
      res.json(rows.map(serializeLeaveRequest));
    } catch (error) {
      console.error('Failed to fetch leave requests:', error);
      res.status(500).json({ error: 'Failed to fetch leave requests' });
    }
  });

  app.get("/api/employee-auth/me", (req, res) => {
    try {
      const employeeId = (req.session as any).employeeId;
      if (employeeId) reconcileEmployeeLeaveAccrual(employeeId);
      if (!employeeId) return res.status(401).json({ error: 'Not authenticated' });
      const employee = db.prepare('SELECT e.*, c.fallback_image FROM employees e LEFT JOIN clients c ON c.id = e.client_id WHERE e.id = ?').get(employeeId) as any;
      if (!employee || employee.status === 'offboarded') {
        delete (req.session as any).employeeId;
        delete (req.session as any).employeeClientId;
        return res.status(401).json({ error: 'Employee not found' });
      }
      (req.session as any).employeeClientId = employee.client_id || null;
      res.json(sanitizeEmployeeForResponse(employee));
    } catch (error) {
      console.error('Employee auth check failed:', error);
      res.status(500).json({ error: 'Failed to verify employee session' });
    }
  });

  app.post("/api/employee-auth/login", (req, res) => {
    try {
      const identifier = String(req.body?.identifier ?? '').trim();
      const pin = String(req.body?.pin ?? '').trim();
      if (!identifier || !pin) return res.status(400).json({ error: 'Identifier and PIN are required' });

      const normalizedIdentifier = identifier.toLowerCase();
      const digits = identifier.replace(/\D/g, '');
      const employees = db.prepare('SELECT * FROM employees WHERE status != ? OR status IS NULL').all('offboarded') as any[];
      const employee = employees.find((emp) => {
        const emailMatch = emp.email && String(emp.email).toLowerCase() === normalizedIdentifier;
        const cellDigits = String(emp.cell ?? '').replace(/\D/g, '');
        const cellMatch = digits.length > 0 && cellDigits === digits;
        const exactCellMatch = emp.cell && String(emp.cell) === identifier;
        return emailMatch || cellMatch || exactCellMatch;
      });

      if (!employee || !verifySecret(pin, employee.pin)) {
        return res.status(401).json({ error: 'Invalid Email/Phone or PIN' });
      }

      if (shouldUpgradeLegacySecret(pin, employee.pin)) {
        db.prepare('UPDATE employees SET pin = ? WHERE id = ?').run(hashSecret(pin), employee.id);
        employee.pin = hashSecret(pin);
      }

      (req.session as any).employeeId = employee.id;
      (req.session as any).employeeClientId = employee.client_id || null;
      res.json(sanitizeEmployeeForResponse(employee));
    } catch (error) {
      console.error('Employee login failed:', error);
      res.status(500).json({ error: 'Failed to sign in employee' });
    }
  });

  app.post("/api/employee-auth/logout", (_req, res) => {
    delete (_req.session as any).employeeId;
    delete (_req.session as any).employeeClientId;
    res.json({ ok: true });
  });

  app.post("/api/leave-requests", requireActiveTrial, requireUnlockedFeature("leave_management"), (req, res) => {
    try {
      const employeeSessionId = (req.session as any).employeeId as string | undefined;
      const isAdminUser = !!(req.session as any).userId;
      const employeeId = String(req.body?.employee_id ?? employeeSessionId ?? '').trim();
      const startDate = toDateOnly(String(req.body?.start_date ?? ''));
      const endDate = toDateOnly(String(req.body?.end_date ?? ''));
      const requestedType = normalizeLeaveType(req.body?.type);
      const isHalfDay = requestedType === 'half_day' ? true : parseBoolean(req.body?.is_half_day);
      const type = requestedType;

      const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() : '';
      const adminNotes = typeof req.body?.admin_notes === 'string' ? req.body.admin_notes.trim() : '';
      const requestedStatus = normalizeLeaveStatus(req.body?.status) ?? 'pending';
      const finalStatus = requestedStatus === 'approved' && isAdminUser ? 'approved' : 'pending';
      const allowNegativeBalance = isAdminUser && (parseBoolean(req.body?.allow_negative_balance) || parseBoolean(req.body?.admin_override) || parseBoolean(req.body?.override));
      const allowDoubleBooking = isAdminUser && (parseBoolean(req.body?.override_double_booking) || parseBoolean(req.body?.admin_override) || parseBoolean(req.body?.override));

      if (!employeeId || !type || !isValidISODate(startDate) || !isValidISODate(endDate)) {
        return res.status(400).json({ error: 'Employee, leave type, start date, and end date are required' });
      }

      reconcileEmployeeLeaveAccrual(employeeId);
      const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId) as any;
      if (!employee || employee.status === 'offboarded') return res.status(404).json({ error: 'Employee not found' });

      const days = requestedType === 'unpaid' ? getWeekdayLeaveDays(startDate, endDate, false) : getWeekdayLeaveDays(startDate, endDate, isHalfDay);
      if (days <= 0) return res.status(400).json({ error: 'Leave request must cover at least one valid day' });

      const overlapping = getOverlapLeaveRequests({ employeeId, startDate, endDate }).filter((row) => String(row.source || 'manual') !== 'roster');
      if (overlapping.length > 0 && !allowDoubleBooking) {
        return res.status(409).json({
          error: 'Employee already has leave booked for the selected dates.',
          code: 'DOUBLE_BOOKED',
          conflicts: overlapping.map((row) => ({ id: row.id, type: row.type, start_date: row.start_date, end_date: row.end_date, status: row.status })),
        });
      }

      const balanceTrackedType = getBalanceTrackedLeaveType(type);
      const currentBalance = balanceTrackedType ? (Number(employee[leaveColumns[balanceTrackedType]]) || 0) : Number.POSITIVE_INFINITY;
      if (balanceTrackedType && finalStatus === 'approved' && days > currentBalance && !allowNegativeBalance) {
        return res.status(409).json({
          error: 'Employee has insufficient leave balance.',
          code: 'INSUFFICIENT_LEAVE',
          available: currentBalance,
          requested: days,
        });
      }

      const id = `leave_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO leave_requests (id, employee_id, type, start_date, end_date, is_half_day, status, notes, attachment_url, admin_notes, days, source, source_ref, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', NULL, ?, ?)
      `).run(id, employeeId, type, startDate, endDate, isHalfDay ? 1 : 0, finalStatus, notes, '', adminNotes, days, now, now);

      if (finalStatus === 'approved') adjustEmployeeLeaveBalance(employeeId, type, -days);

      const row = db.prepare(`${leaveRequestSelect} WHERE lr.id = ?`).get(id) as any;
      res.status(201).json(serializeLeaveRequest(row));
    } catch (error) {
      console.error('Failed to create leave request:', error);
      res.status(500).json({ error: 'Failed to create leave request' });
    }
  });

  app.put("/api/leave-requests/:id/status", requireAuth, (req, res) => {
    try {
      const id = req.params.id;
      const nextStatus = normalizeLeaveStatus(req.body?.status);
      const adminNotes = typeof req.body?.admin_notes === 'string' ? req.body.admin_notes.trim() : undefined;
      const allowNegativeBalance = !!(req.session as any).userId && (parseBoolean(req.body?.allow_negative_balance) || parseBoolean(req.body?.admin_override) || parseBoolean(req.body?.override));
      const allowDoubleBooking = !!(req.session as any).userId && (parseBoolean(req.body?.override_double_booking) || parseBoolean(req.body?.admin_override) || parseBoolean(req.body?.override));
      if (!nextStatus || !['approved', 'declined'].includes(nextStatus)) {
        return res.status(400).json({ error: 'Valid status is required' });
      }

      const existing = db.prepare(`${leaveRequestSelect} WHERE lr.id = ?`).get(id) as any;
      if (!existing) return res.status(404).json({ error: 'Leave request not found' });
      reconcileEmployeeLeaveAccrual(existing.employee_id);

      const currentStatus = normalizeLeaveStatus(existing.status) ?? 'pending';
      const type = normalizeLeaveType(existing.type);
      if (!type) return res.status(400).json({ error: 'Invalid leave type' });
      const days = Number(existing.days) || 0;

      if (currentStatus === nextStatus) {
        const row = db.prepare(`${leaveRequestSelect} WHERE lr.id = ?`).get(id) as any;
        return res.json(serializeLeaveRequest(row));
      }

      if (nextStatus === 'approved' && currentStatus !== 'approved') {
        const overlaps = getOverlapLeaveRequests({ employeeId: existing.employee_id, startDate: existing.start_date, endDate: existing.end_date, excludeId: id })
          .filter((row) => String(row.source || 'manual') !== 'roster');
        if (overlaps.length > 0 && !allowDoubleBooking) {
          return res.status(409).json({
            error: 'Employee already has leave booked for the selected dates.',
            code: 'DOUBLE_BOOKED',
            conflicts: overlaps.map((row) => ({ id: row.id, type: row.type, start_date: row.start_date, end_date: row.end_date, status: row.status })),
          });
        }

        const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(existing.employee_id) as any;
        const balanceTrackedType = getBalanceTrackedLeaveType(type);
        const balance = balanceTrackedType ? (Number(employee?.[leaveColumns[balanceTrackedType]]) || 0) : Number.POSITIVE_INFINITY;
        if (balanceTrackedType && days > balance && !allowNegativeBalance) {
          return res.status(409).json({
            error: 'Employee has insufficient leave balance.',
            code: 'INSUFFICIENT_LEAVE',
            available: balance,
            requested: days,
          });
        }
        adjustEmployeeLeaveBalance(existing.employee_id, type, -days);
      }

      if (currentStatus === 'approved' && nextStatus !== 'approved') {
        adjustEmployeeLeaveBalance(existing.employee_id, type, days);
      }

      db.prepare('UPDATE leave_requests SET status = ?, admin_notes = COALESCE(?, admin_notes), updated_at = ? WHERE id = ?')
        .run(nextStatus, adminNotes ?? null, new Date().toISOString(), id);

      const row = db.prepare(`${leaveRequestSelect} WHERE lr.id = ?`).get(id) as any;
      res.json(serializeLeaveRequest(row));
    } catch (error) {
      console.error('Failed to update leave status:', error);
      res.status(500).json({ error: 'Failed to update leave request' });
    }
  });

  app.post("/api/leave-requests/:id/cancel", (req, res) => {
    try {
      const id = req.params.id;
      const employeeSessionId = (req.session as any).employeeId as string | undefined;
      const existing = db.prepare(`${leaveRequestSelect} WHERE lr.id = ?`).get(id) as any;
      if (!existing) return res.status(404).json({ error: 'Leave request not found' });
      reconcileEmployeeLeaveAccrual(existing.employee_id);
      if (employeeSessionId && existing.employee_id !== employeeSessionId) return res.status(403).json({ error: 'You can only cancel your own requests' });
      const currentStatus = normalizeLeaveStatus(existing.status) ?? 'pending';
      if (currentStatus === 'cancelled') {
        const row = db.prepare(`${leaveRequestSelect} WHERE lr.id = ?`).get(id) as any;
        return res.json(serializeLeaveRequest(row));
      }

      const type = normalizeLeaveType(existing.type);
      if (type && currentStatus === 'approved') adjustEmployeeLeaveBalance(existing.employee_id, type, Number(existing.days) || 0);
      db.prepare('UPDATE leave_requests SET status = ?, updated_at = ? WHERE id = ?').run('cancelled', new Date().toISOString(), id);
      const row = db.prepare(`${leaveRequestSelect} WHERE lr.id = ?`).get(id) as any;
      res.json(serializeLeaveRequest(row));
    } catch (error) {
      console.error('Failed to cancel leave request:', error);
      res.status(500).json({ error: 'Failed to cancel leave request' });
    }
  });

  app.get("/api/analytics", requireActiveTrial, requireUnlockedFeature("analytics"), (req, res) => {
    const month = req.query.month as string || new Date().toISOString().substring(0, 7);
    const currentMonthPrefix = month;

    const [yearStr, monthStr] = month.split('-');
    let prevYear = parseInt(yearStr);
    let prevMonth = parseInt(monthStr) - 1;
    if (prevMonth === 0) {
      prevMonth = 12;
      prevYear--;
    }
    const prevMonthPrefix = `${prevYear}-${prevMonth.toString().padStart(2, '0')}`;

    const clientId = getEffectiveTenantClientId(req);

    const employees = clientId
      ? db.prepare("SELECT * FROM employees WHERE client_id = ?").all(clientId) as any[]
      : db.prepare("SELECT * FROM employees").all() as any[];
    const employeeIds = employees.map((e: any) => e.id);
    const shifts = db.prepare("SELECT * FROM shifts").all() as any[];
    const roster = employeeIds.length
      ? db.prepare(`SELECT * FROM roster WHERE employee_id IN (${employeeIds.map(() => '?').join(',')}) AND (day_date LIKE ? OR day_date LIKE ?)`)
          .all(...employeeIds, `${currentMonthPrefix}-%`, `${prevMonthPrefix}-%`) as any[]
      : [];

    const shiftMap = new Map();
    shifts.forEach((s: any) => {
      let durationHours = 0;
      if (s.start && s.end) {
        const [startH, startM] = s.start.split(':').map(Number);
        const [endH, endM] = s.end.split(':').map(Number);
        let startMins = startH * 60 + startM;
        let endMins = endH * 60 + endM;
        if (endMins < startMins) endMins += 24 * 60;
        durationHours = (endMins - startMins - (s.lunch || 0)) / 60;
      }
      shiftMap.set(s.id, { ...s, durationHours });
    });

    const calculateEntry = (r: any, emp: any) => {
      const shift = shiftMap.get(r.shift_id);
      if (!shift) return null;

      const date = new Date(r.day_date);
      const isSunday = date.getDay() === 0;

      let category = 'Normal Time';
      let hours = shift.durationHours;
      let rateMultiplier = 1;
      const shiftLabel = String(shift.label || '').toLowerCase();

      if (shiftLabel.includes('unpaid leave') || shiftLabel.includes('absent') || shiftLabel.includes('unshifted')) {
        category = 'Absent';
        hours = 0;
        rateMultiplier = 0;
      } else if (shiftLabel.includes('leave')) {
        category = 'Leave';
        hours = 8;
        rateMultiplier = 1;
      } else if (isSunday) {
        category = 'Sunday (1.5)';
        rateMultiplier = 1.5;
      }

      let normalHours = hours;
      let overtimeHours = 0;

      if (category === 'Normal Time' && hours > 9) {
        normalHours = 9;
        overtimeHours = hours - 9;
      }

      const payRate = emp.pay_rate || 0;
      const entries = [];
      if (category === 'Absent') {
        return [];
      } else if (category === 'Sunday (1.5)') {
        entries.push({ category: 'Sunday (1.5)', amount: hours * payRate * 1.5, hours });
      } else if (category === 'Leave') {
        entries.push({ category: 'Leave', amount: hours * payRate, hours });
      } else {
        entries.push({ category: 'Normal Time', amount: normalHours * payRate, hours: normalHours });
        if (overtimeHours > 0) {
          entries.push({ category: 'Overtime (1.5)', amount: overtimeHours * payRate * 1.5, hours: overtimeHours });
        }
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
        name: `${emp.first_name} ${emp.last_name}`,
        amount: 0,
        annual: emp.annual_leave || 0,
        sick: emp.sick_leave || 0,
        family: emp.family_leave || 0,
      };
    });

    roster.forEach((r: any) => {
      const emp = employees.find((e: any) => e.id === r.employee_id);
      if (!emp) return;

      const isCurrentMonth = r.day_date.startsWith(currentMonthPrefix);
      const isPrevMonth = r.day_date.startsWith(prevMonthPrefix);

      const entries = calculateEntry(r, emp);
      if (!entries) return;

      let dayTotal = 0;
      entries.forEach((entry: any) => {
        dayTotal += entry.amount;
        if (isCurrentMonth) {
          breakdown[entry.category] = (breakdown[entry.category] || 0) + entry.amount;
        }
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

    const avgSalary = activeCount > 0
      ? activeEmployees.reduce((sum: number, e: any) => sum + (e.pay_rate || 0), 0) / activeCount
      : 0;

    const nonZeroWeeks = Object.values(weeklyData).filter((w) => w.amount > 0);
    const avgWeeklyBill = nonZeroWeeks.length > 0
      ? nonZeroWeeks.reduce((sum, w) => sum + w.amount, 0) / nonZeroWeeks.length
      : 0;

    const weeklyChart = Object.keys(weeklyData).sort().map((week) => ({
      week,
      shifts: weeklyData[week].shifts,
      amount: weeklyData[week].amount,
    }));

    const breakdownArray = Object.keys(breakdown).filter((k) => breakdown[k] > 0).map((category) => ({
      category,
      amount: breakdown[category],
    }));

    const employeeShare = Object.values(employeeStats)
      .filter((e) => e.amount > 0)
      .map((e) => ({
        name: e.name,
        amount: e.amount,
        percentage: currentTotal > 0 ? (e.amount / currentTotal) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    const activeEmployeeIds = new Set(activeEmployees.map((e: any) => e.id));

    const leaveAnalytics = Object.entries(employeeStats)
      .filter(([employeeId]) => activeEmployeeIds.has(employeeId))
      .map(([, e]: any) => ({
        name: e.name,
        annual: e.annual,
        sick: e.sick,
        family: e.family,
      }));

    res.json({
      kpis: {
        currentTotal,
        prevTotal,
        avgSalary,
        avgWeeklyBill,
        totalEmployees,
        activeCount,
        offboardedCount,
      },
      weeklyChart,
      breakdown: breakdownArray,
      employeeShare,
      leaveAnalytics,
    });
  });
}
