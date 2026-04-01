import { addDays, parseISO } from 'date-fns';
import { LeaveRequest } from '../types';

const toDateOnly = (value?: string | null) => String(value || '').slice(0, 10);

const normalizeEmployeeName = (request: LeaveRequest) =>
  String(request.employee_name || '').trim() || 'Employee';

const isRosterLike = (request: LeaveRequest) => request.source === 'roster';

const areMergeCompatible = (left: LeaveRequest, right: LeaveRequest) => {
  if (!isRosterLike(left) || !isRosterLike(right)) return false;
  if (left.employee_id !== right.employee_id) return false;
  if (left.type !== right.type) return false;
  if (left.status !== right.status) return false;
  if (!!left.is_half_day || !!right.is_half_day) return false;
  return true;
};

const areAdjacentOrOverlapping = (leftEnd: string, rightStart: string) => {
  const leftDate = parseISO(`${toDateOnly(leftEnd)}T00:00:00`);
  const rightDate = parseISO(`${toDateOnly(rightStart)}T00:00:00`);
  if (Number.isNaN(leftDate.getTime()) || Number.isNaN(rightDate.getTime())) return false;
  return addDays(leftDate, 1) >= rightDate;
};

export const normalizeLeaveRequestsForDisplay = (requests: LeaveRequest[]) => {
  const sorted = [...requests]
    .filter((request) => !!request?.id)
    .sort((a, b) => {
      const keyA = [a.employee_id, a.type, a.status, a.source || 'manual', toDateOnly(a.start_date), toDateOnly(a.end_date), a.id].join('|');
      const keyB = [b.employee_id, b.type, b.status, b.source || 'manual', toDateOnly(b.start_date), toDateOnly(b.end_date), b.id].join('|');
      return keyA.localeCompare(keyB);
    });

  const merged: LeaveRequest[] = [];
  for (const request of sorted) {
    const current: LeaveRequest = {
      ...request,
      employee_name: normalizeEmployeeName(request),
      start_date: toDateOnly(request.start_date),
      end_date: toDateOnly(request.end_date),
    };

    const previous = merged[merged.length - 1];
    if (
      previous &&
      areMergeCompatible(previous, current) &&
      areAdjacentOrOverlapping(previous.end_date, current.start_date)
    ) {
      previous.end_date = previous.end_date > current.end_date ? previous.end_date : current.end_date;
      previous.days = Number((Number(previous.days || 0) + Number(current.days || 0)).toFixed(4));
      if (!previous.notes && current.notes) previous.notes = current.notes;
      if (current.created_at && (!previous.created_at || current.created_at < previous.created_at)) previous.created_at = current.created_at;
      if (current.updated_at && (!previous.updated_at || current.updated_at > previous.updated_at)) previous.updated_at = current.updated_at;
      continue;
    }

    merged.push({
      ...current,
      days: typeof current.days === 'number'
        ? Number(current.days.toFixed(4))
        : current.is_half_day
          ? 0.5
          : current.days,
    });
  }

  return merged.sort((a, b) => {
    const startDiff = new Date(b.start_date).getTime() - new Date(a.start_date).getTime();
    if (startDiff !== 0) return startDiff;
    return new Date(b.created_at || b.start_date).getTime() - new Date(a.created_at || a.start_date).getTime();
  });
};
