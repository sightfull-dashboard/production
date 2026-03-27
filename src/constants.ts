import { Shift, Employee, OffboardReason } from './types';
import { format, isSameDay } from 'date-fns';

export const INITIAL_SHIFTS: Shift[] = [];

export const INITIAL_EMPLOYEES: Employee[] = [];

export const OFFBOARD_REASONS: Record<OffboardReason, string> = {
  deceased: 'Deceased',
  retired: 'Retired',
  dismissed: 'Dismissed',
  contract_expired: 'Contract expired',
  resigned: 'Resigned',
  constructively_dismissed: 'Constructively dismissed',
  employers_insolvency: "Employer's insolvency",
  maternity_leave: 'Maternity leave',
  adoption_leave: 'Adoption leave',
  illness_medically_boarded: 'Illness or medically boarded',
  retrenched_staff_reduction: 'Retrenched or staff reduction',
  transfer_branch: 'Transfer to another branch',
  absconded: 'Absconded',
  business_closed: 'Business closed',
  voluntary_severance: 'Voluntary severance package',
  reduced_working_time: 'Reduced working time',
  parental_leave: 'Parental leave',
  other: 'Other'
};

// --- SA Public Holiday Logic ---

function getEasterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

export function getSAPublicHolidays(year: number): Date[] {
  const holidays: Date[] = [
    new Date(year, 0, 1),   // New Year's Day
    new Date(year, 2, 21),  // Human Rights Day
    new Date(year, 3, 27),  // Freedom Day
    new Date(year, 4, 1),   // Workers' Day
    new Date(year, 5, 16),  // Youth Day
    new Date(year, 7, 9),   // National Women's Day
    new Date(year, 8, 24),  // Heritage Day
    new Date(year, 11, 16), // Day of Reconciliation
    new Date(year, 11, 25), // Christmas Day
    new Date(year, 11, 26), // Day of Goodwill
  ];

  const easter = getEasterSunday(year);
  const goodFriday = new Date(easter.getTime());
  goodFriday.setDate(goodFriday.getDate() - 2);
  const familyDay = new Date(easter.getTime());
  familyDay.setDate(familyDay.getDate() + 1);
  
  holidays.push(goodFriday, familyDay);

  // If holiday falls on Sunday, Monday is also a holiday
  const observed: Date[] = [];
  holidays.forEach(h => {
    if (h.getDay() === 0) {
      const monday = new Date(h.getTime());
      monday.setDate(monday.getDate() + 1);
      observed.push(monday);
    }
  });

  return [...holidays, ...observed];
}

export function isSAPublicHoliday(date: Date): boolean {
  const holidays = getSAPublicHolidays(date.getFullYear());
  return holidays.some(h => isSameDay(h, date));
}
