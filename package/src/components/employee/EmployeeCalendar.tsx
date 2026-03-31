import React, { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Users } from 'lucide-react';
import { Employee, LeaveRequest } from '../../types';
import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, parseISO, startOfMonth, startOfWeek } from 'date-fns';
import { cn } from '../../lib/utils';

interface Props {
  employee: Employee;
  teamLeave: LeaveRequest[];
}

export const EmployeeCalendar: React.FC<Props> = ({ teamLeave }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  const leaveByDay = useMemo(() => {
    const map = new Map<string, LeaveRequest[]>();
    teamLeave.filter(r => r.status === 'approved' || r.status === 'pending').forEach((req) => {
      const range = eachDayOfInterval({ start: parseISO(req.start_date), end: parseISO(req.end_date) });
      range.forEach((day) => {
        const key = format(day, 'yyyy-MM-dd');
        const existing = map.get(key) || [];
        existing.push(req);
        map.set(key, existing);
      });
    });
    return map;
  }, [teamLeave]);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div><h2 className="text-3xl font-black text-slate-800 tracking-tight">Team Calendar</h2><p className="text-slate-500 font-bold">Approved and pending leave at a glance.</p></div>
        <div className="flex items-center gap-3"><button onClick={() => setCurrentDate(addMonths(currentDate, -1))} className="p-3 rounded-2xl bg-white border border-slate-100"><ChevronLeft className="w-5 h-5" /></button><div className="px-6 py-3 rounded-2xl bg-white border border-slate-100 font-black text-slate-800">{format(currentDate, 'MMMM yyyy')}</div><button onClick={() => setCurrentDate(addMonths(currentDate, 1))} className="p-3 rounded-2xl bg-white border border-slate-100"><ChevronRight className="w-5 h-5" /></button></div>
      </div>

      <div className="bg-white rounded-[40px] overflow-hidden border border-slate-100 shadow-sm">
        <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50/60">
          {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((d) => <div key={d} className="py-4 text-center text-[10px] font-black uppercase tracking-widest text-slate-400">{d}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const key = format(day, 'yyyy-MM-dd');
            const entries = leaveByDay.get(key) || [];
            return (
              <div key={key} className={cn('min-h-[130px] p-3 border-b border-r border-slate-100 align-top', !isSameMonth(day, currentDate) && 'bg-slate-50/40')}>
                <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center font-black mb-3', isSameDay(day, new Date()) ? 'bg-emerald-600 text-white' : 'text-slate-800')}>{format(day, 'd')}</div>
                <div className="space-y-2">
                  {entries.slice(0, 3).map((entry) => <div key={entry.id} className={cn('px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest', entry.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700')}>{entry.employee_name}</div>)}
                  {entries.length > 3 && <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">+{entries.length - 3} more</div>}
                </div>
              </div>
            );
          })}
        </div>
        <div className="p-8 space-y-8">
          <div className="flex items-center gap-4 p-6 bg-indigo-50 rounded-[32px] border border-indigo-100"><div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-sm"><Users className="w-6 h-6 text-indigo-600" /></div><div><p className="text-sm font-black text-slate-800">Team Availability</p><p className="text-xs text-slate-500 font-bold">{new Set(teamLeave.map(r => r.employee_id)).size} team members have leave activity in this view.</p></div></div>
          <div className="bg-slate-900 rounded-[40px] p-10 text-white relative overflow-hidden"><div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-8"><div className="space-y-4"><h3 className="text-3xl font-black tracking-tight">Need to plan ahead?</h3><p className="text-slate-400 font-bold text-lg max-w-md">Use this calendar to spot overlap before confirming leave.</p><button className="px-8 py-4 bg-emerald-600 text-white rounded-2xl font-black hover:bg-emerald-500 transition-all shadow-xl shadow-emerald-900/20">Open Full Calendar</button></div><CalendarDays className="w-48 h-48 text-white/5 absolute right-[-20px] bottom-[-20px]" /></div></div>
        </div>
      </div>
    </div>
  );
};
