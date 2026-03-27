import { Shift } from '../types';

export const ADMINISTRATIVE_SHIFT_LABELS = ['absent', 'annual leave', 'sick leave', 'family leave', 'unshifted'];

export const normalizeShiftLabel = (label: string | null | undefined) => String(label || '').trim().toLowerCase();

export const isAdministrativeShift = (shift: Pick<Shift, 'label'> | null | undefined) => {
  return ADMINISTRATIVE_SHIFT_LABELS.includes(normalizeShiftLabel(shift?.label));
};

const shiftSortWeight = (shift: Pick<Shift, 'label'>) => {
  const normalized = normalizeShiftLabel(shift.label);
  if (!ADMINISTRATIVE_SHIFT_LABELS.includes(normalized)) return 0;
  if (normalized === 'absent') return 10;
  if (normalized === 'annual leave') return 11;
  if (normalized === 'sick leave') return 12;
  if (normalized === 'family leave') return 13;
  if (normalized === 'unshifted') return 14;
  return 20;
};

export const sortShiftsBaseFirst = <T extends Pick<Shift, 'label'>>(shifts: T[]): T[] => {
  return [...shifts].sort((a, b) => {
    const weightDiff = shiftSortWeight(a) - shiftSortWeight(b);
    if (weightDiff !== 0) return weightDiff;
    return String(a.label || '').localeCompare(String(b.label || ''));
  });
};
