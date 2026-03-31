import { Shift, RosterAssignment, RosterMeta } from '../types';
import { format } from 'date-fns';
import { isSAPublicHoliday } from '../constants';

export interface PayrollResult {
  totalHours: number;
  controlHours: number;
  sunControlHours: number;
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

type ShiftWindow = {
  start: Date;
  end: Date;
  grossMinutes: number;
  paidMinutes: number;
};

const roundHours = (minutes: number) => Math.round((minutes / 60) * 100) / 100;

const parseShiftWindow = (dayIso: string, shift: Shift): ShiftWindow | null => {
  if (!shift.start || !shift.end) return null;

  const [sH, sM] = shift.start.split(':').map(Number);
  const [eH, eM] = shift.end.split(':').map(Number);
  if ([sH, sM, eH, eM].some((value) => Number.isNaN(value))) return null;

  const base = new Date(`${dayIso}T00:00:00`);
  if (Number.isNaN(base.getTime())) return null;

  const start = new Date(base);
  start.setHours(sH, sM, 0, 0);

  const end = new Date(base);
  end.setHours(eH, eM, 0, 0);
  if (end <= start) {
    end.setDate(end.getDate() + 1);
  }

  const grossMinutes = Math.max(0, (end.getTime() - start.getTime()) / 60000);
  const paidMinutes = Math.max(0, grossMinutes - Math.max(0, Number(shift.lunch || 0)));

  return { start, end, grossMinutes, paidMinutes };
};

const getDayStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const getNextDayStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
const isSundayDate = (date: Date) => date.getDay() === 0;

export function calculateEmployeePayroll(
  employeeId: string,
  weekDays: Date[],
  roster: RosterAssignment[],
  shifts: Shift[],
  rosterMeta: RosterMeta[] = []
): PayrollResult {
  const weekStartDate = getDayStart(weekDays[0]);
  const weekEndExclusive = getNextDayStart(weekDays[weekDays.length - 1]);
  const weekStartIso = format(weekStartDate, 'yyyy-MM-dd');
  const daySet = new Set(weekDays.map((day) => format(day, 'yyyy-MM-dd')));
  const meta = rosterMeta.find(m => m.employee_id === employeeId && m.week_start === weekStartIso);

  let controlMinutes = 0;
  let sundayMinutes = 0;
  let holidayMinutes = 0;
  let leaveHours = 0;
  let sickHours = 0;
  let familyHours = 0;

  const employeeAssignments = roster
    .filter((row) => row.employee_id === employeeId && row.shift_id)
    .sort((a, b) => String(a.day_date).localeCompare(String(b.day_date)));

  employeeAssignments.forEach((assignment) => {
    const shift = shifts.find((item) => item.id === assignment.shift_id);
    if (!shift) return;

    const label = String(shift.label || '').toLowerCase();
    const assignmentIso = String(assignment.day_date || '').trim();
    const isAssignmentInsidePeriod = daySet.has(assignmentIso);

    if (label.includes('annual leave')) {
      if (isAssignmentInsidePeriod) leaveHours += 9;
      return;
    }
    if (label.includes('half day')) {
      if (isAssignmentInsidePeriod) leaveHours += 4.5;
      return;
    }
    if (label.includes('sick leave')) {
      if (isAssignmentInsidePeriod) sickHours += 9;
      return;
    }
    if (label.includes('family leave')) {
      if (isAssignmentInsidePeriod) familyHours += 9;
      return;
    }
    if (label.includes('unpaid leave') || label.includes('absent') || label.includes('unshifted')) {
      return;
    }

    const window = parseShiftWindow(assignmentIso, shift);
    if (!window || window.paidMinutes <= 0 || window.grossMinutes <= 0) return;

    const effectiveStart = new Date(Math.max(window.start.getTime(), weekStartDate.getTime()));
    const effectiveEnd = new Date(Math.min(window.end.getTime(), weekEndExclusive.getTime()));
    if (effectiveEnd <= effectiveStart) return;

    let cursor = effectiveStart;
    while (cursor < effectiveEnd) {
      const nextBoundary = getNextDayStart(cursor);
      const segmentEnd = new Date(Math.min(nextBoundary.getTime(), effectiveEnd.getTime()));
      const rawMinutes = Math.max(0, (segmentEnd.getTime() - cursor.getTime()) / 60000);
      if (rawMinutes > 0) {
        const paidSegmentMinutes = (rawMinutes / window.grossMinutes) * window.paidMinutes;
        const segmentDay = getDayStart(cursor);

        if (isSAPublicHoliday(segmentDay)) {
          holidayMinutes += paidSegmentMinutes;
        } else if (isSundayDate(segmentDay)) {
          sundayMinutes += paidSegmentMinutes;
        } else {
          controlMinutes += paidSegmentMinutes;
        }
      }
      cursor = segmentEnd;
    }
  });

  const totalMinutes = controlMinutes + sundayMinutes;
  const totalHours = roundHours(totalMinutes);
  const controlHours = roundHours(controlMinutes);
  const sunControlHours = roundHours(sundayMinutes);
  const holidayHours = roundHours(holidayMinutes);

  const normalHours = Math.min(45, controlHours);
  const ot15 = controlHours >= 45 ? Math.max(0, controlHours - 45) : 0;
  const sun15 = Math.min(9, sunControlHours);
  const sun20 = sunControlHours >= 9 ? Math.max(0, sunControlHours - 9) : 0;

  const result: PayrollResult = {
    totalHours,
    controlHours,
    sunControlHours,
    normalTime: Math.round(normalHours * 100) / 100,
    ot15: Math.round(ot15 * 100) / 100,
    sun15: Math.round(sun15 * 100) / 100,
    sun20: Math.round(sun20 * 100) / 100,
    pph: holidayHours,
    leave: Math.round(leaveHours * 100) / 100,
    sick: Math.round(sickHours * 100) / 100,
    family: Math.round(familyHours * 100) / 100,
  };

  if (meta) {
    Object.entries(meta).forEach(([key, value]) => {
      if (key !== 'employee_id' && key !== 'week_start') {
        result[key] = value;
      }
    });
  }

  return result;
}
