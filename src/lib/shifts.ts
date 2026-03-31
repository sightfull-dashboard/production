import { Shift } from '../types';

export const LEAVE_SHIFT_LABELS = ['annual leave', 'sick leave', 'family leave', 'half day'];
export const NON_WORKING_SHIFT_LABELS = ['absent', 'unshifted'];
export const ADMINISTRATIVE_SHIFT_LABELS = [...LEAVE_SHIFT_LABELS, ...NON_WORKING_SHIFT_LABELS];

export const normalizeShiftLabel = (label: string | null | undefined) => String(label || '').trim().toLowerCase();

export const isAdministrativeShift = (shift: Pick<Shift, 'label'> | null | undefined) => {
  return ADMINISTRATIVE_SHIFT_LABELS.includes(normalizeShiftLabel(shift?.label));
};

const shiftSortWeight = (shift: Pick<Shift, 'label'>) => {
  const normalized = normalizeShiftLabel(shift.label);
  if (!ADMINISTRATIVE_SHIFT_LABELS.includes(normalized)) return 0;
  if (normalized === 'annual leave') return 11;
  if (normalized === 'sick leave') return 12;
  if (normalized === 'family leave') return 13;
  if (normalized === 'half day') return 14;
  if (normalized === 'absent') return 15;
  if (normalized === 'unshifted') return 16;
  return 20;
};

export const sortShiftsBaseFirst = <T extends Pick<Shift, 'label'>>(shifts: T[]): T[] => {
  return [...shifts].sort((a, b) => {
    const weightDiff = shiftSortWeight(a) - shiftSortWeight(b);
    if (weightDiff !== 0) return weightDiff;
    return String(a.label || '').localeCompare(String(b.label || ''));
  });
};

export type ShiftRosterGroup = 'working' | 'leave' | 'non_working';

export const getShiftRosterGroup = (shift: Pick<Shift, 'label'> | null | undefined): ShiftRosterGroup => {
  const normalized = normalizeShiftLabel(shift?.label);
  if (LEAVE_SHIFT_LABELS.includes(normalized)) return 'leave';
  if (NON_WORKING_SHIFT_LABELS.includes(normalized)) return 'non_working';
  return 'working';
};

export const sortRosterDropdownShifts = <T extends Pick<Shift, 'label'>>(shifts: T[]): Record<ShiftRosterGroup, T[]> => {
  const ordered = sortShiftsBaseFirst(shifts);
  return {
    working: ordered.filter((shift) => getShiftRosterGroup(shift) === 'working'),
    leave: ordered.filter((shift) => getShiftRosterGroup(shift) === 'leave'),
    non_working: ordered.filter((shift) => getShiftRosterGroup(shift) === 'non_working'),
  };
};


export const parseShiftTimeToMinutes = (value: string | null | undefined): number | null => {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return (hours * 60) + minutes;
};

export const formatShiftTimeLabel = (value: string | null | undefined): string => {
  const minutes = parseShiftTimeToMinutes(value);
  if (minutes === null) return 'N/A';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
};

export const doesShiftStartOverlapPrevious = (
  previousShift: Pick<Shift, 'start' | 'end' | 'label'> | null | undefined,
  nextShift: Pick<Shift, 'start' | 'end' | 'label'> | null | undefined,
): boolean => {
  if (!previousShift || !nextShift) return false;
  if (isAdministrativeShift(previousShift) || isAdministrativeShift(nextShift)) return false;

  const previousStart = parseShiftTimeToMinutes(previousShift.start);
  const previousEnd = parseShiftTimeToMinutes(previousShift.end);
  const nextStart = parseShiftTimeToMinutes(nextShift.start);

  if (previousStart === null || previousEnd === null || nextStart === null) return false;

  const previousEndAbsolute = previousEnd <= previousStart ? previousEnd + 1440 : previousEnd;
  const nextStartAbsolute = nextStart + 1440;

  return nextStartAbsolute < previousEndAbsolute;
};
