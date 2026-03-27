import { Shift, Employee, RosterAssignment, RosterMeta } from '../types';
import { format, isSunday, parseISO } from 'date-fns';
import { isSAPublicHoliday } from '../constants';

export interface PayrollResult {
  normalTime: number;
  ot15: number;
  sun15: number;
  sun20: number;
  pph: number;
  leave: number;
  sick: number;
  family: number;
  [key: string]: any;
}

export function calculateEmployeePayroll(
  employeeId: string,
  weekDays: Date[],
  roster: RosterAssignment[],
  shifts: Shift[],
  rosterMeta: RosterMeta[] = []
): PayrollResult {
  let normalMinutes = 0;
  let sundayMinutes = 0;
  let holidayMinutes = 0;
  let leaveHours = 0;
  let sickHours = 0;
  let familyHours = 0;

  const weekStartIso = format(weekDays[0], 'yyyy-MM-dd');
  const meta = rosterMeta.find(m => m.employee_id === employeeId && m.week_start === weekStartIso);

  weekDays.forEach((day) => {
    const dayIso = format(day, 'yyyy-MM-dd');
    const assignment = roster.find(r => r.employee_id === employeeId && r.day_date === dayIso);
    if (!assignment || !assignment.shift_id) return;

    const shift = shifts.find(s => s.id === assignment.shift_id);
    if (!shift) return;

    const label = shift.label.toLowerCase();

    // Handle Leave/Special Shifts
    if (label.includes('annual leave')) {
      leaveHours += 9;
      return;
    }
    if (label.includes('sick leave')) {
      sickHours += 9;
      return;
    }
    if (label.includes('family leave')) {
      familyHours += 9;
      return;
    }
    if (label.includes('unpaid leave') || label.includes('absent') || label.includes('unshifted')) {
      return;
    }

    // Handle Working Shifts
    if (!shift.start || !shift.end) return;

    const [sH, sM] = shift.start.split(':').map(Number);
    const [eH, eM] = shift.end.split(':').map(Number);
    
    let startTotal = sH * 60 + sM;
    let endTotal = eH * 60 + eM;
    
    // Handle cross-midnight
    if (endTotal <= startTotal) endTotal += 24 * 60;
    
    let workedMinutes = endTotal - startTotal - (shift.lunch || 0);
    if (workedMinutes < 0) workedMinutes = 0;

    if (isSAPublicHoliday(day)) {
      holidayMinutes += workedMinutes;
    } else if (isSunday(day)) {
      sundayMinutes += workedMinutes;
    } else {
      normalMinutes += workedMinutes;
    }
  });

  const normalHours = Math.round((normalMinutes / 60) * 100) / 100;
  const sunHours = Math.round((sundayMinutes / 60) * 100) / 100;
  const holHours = Math.round((holidayMinutes / 60) * 100) / 100;

  // SA Rules:
  // Normal capped at 45, excess is OT 1.5
  const cappedNormal = Math.min(45, normalHours);
  const ot15 = Math.max(0, normalHours - 45);

  // Sunday: first 9h at 1.5, rest at 2.0
  const sun15 = Math.min(9, sunHours);
  const sun20 = Math.max(0, sunHours - 9);

  const result: PayrollResult = {
    normalTime: cappedNormal,
    ot15: ot15,
    sun15: sun15,
    sun20: sun20,
    pph: holHours,
    leave: leaveHours,
    sick: sickHours,
    family: familyHours,
  };

  // Add all dynamic meta fields
  if (meta) {
    Object.entries(meta).forEach(([key, value]) => {
      if (key !== 'employee_id' && key !== 'week_start') {
        result[key] = value;
      }
    });
  }

  return result;
}
