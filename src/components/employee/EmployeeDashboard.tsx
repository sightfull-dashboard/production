import React from 'react';
import { Calendar, Clock, Users, Plus, FileText, TrendingUp, History, ArrowRight, CheckCircle2, ChevronRight } from 'lucide-react';
import { format, isAfter, parseISO } from 'date-fns';
import { Employee, LeaveRequest, RosterAssignment, Shift } from '../../types';
import { BrandedState } from '../BrandedStates';
import { cn } from '../../lib/utils';
import { normalizeLeaveRequestsForDisplay } from '../../lib/leaveDisplay';

interface Props {
  employee: Employee;
  requests: LeaveRequest[];
  roster: RosterAssignment[];
  shifts: Shift[];
  onApplyLeave: () => void;
}

const StatCard = ({ label, value, total, color, icon: Icon }: any) => {
  const numericValue = Number(value || 0);
  const isNegative = Number.isFinite(numericValue) && numericValue < 0;
  return (
    <div className="bg-white rounded-[32px] p-8 shadow-sm border border-slate-100">
      <div className="flex items-center justify-between mb-5">
        <div className={cn('w-14 h-14 rounded-[20px] flex items-center justify-center text-white', color)}><Icon className="w-7 h-7" /></div>
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Available</span>
      </div>
      <div className="space-y-1"><p className="text-slate-500 font-bold text-sm">{label}</p><p className={cn('text-3xl font-black', isNegative ? 'text-red-600' : 'text-slate-800')}>{value}<span className="text-slate-300">/{total}</span></p></div>
    </div>
  );
};

export const EmployeeDashboard: React.FC<Props> = ({ employee, requests, roster, shifts, onApplyLeave }) => {
  const employeeRequests = normalizeLeaveRequestsForDisplay(requests).filter(r => r.employee_id === employee.id);
  const pendingRequests = employeeRequests.filter(r => r.status === 'pending').length;
  const upcomingLeave = employeeRequests
    .filter(r => r.status === 'approved' && isAfter(parseISO(r.end_date), new Date()))
    .slice(0, 3)
    .map(r => ({
    type: r.type === 'half_day' ? 'Half Day' : r.type === 'unpaid' ? 'Unpaid Leave' : r.type === 'family' ? 'Family Responsibility' : `${r.type.charAt(0).toUpperCase() + r.type.slice(1)} Leave`,
    date: `${format(parseISO(r.start_date), 'dd MMM')} - ${format(parseISO(r.end_date), 'dd MMM yyyy')}`,
    days: Number(r.days ?? (r.is_half_day ? 0.5 : 1)).toFixed(2)
  }));

  const nextAssignment = roster
    .filter(r => r.employee_id === employee.id && isAfter(parseISO(r.day_date), new Date()))
    .sort((a, b) => a.day_date.localeCompare(b.day_date))[0];
  const nextShift = nextAssignment ? shifts.find(s => s.id === nextAssignment.shift_id) : null;

  const recentActivity = employeeRequests.slice(0, 3).map(r => ({
    type: r.type,
    action: `${(r.type === 'half_day' ? 'Half Day' : r.type === 'unpaid' ? 'Unpaid Leave' : r.type === 'family' ? 'Family Responsibility' : `${r.type.charAt(0).toUpperCase() + r.type.slice(1)} Leave`)} ${r.status}`,
    date: format(parseISO(r.created_at), 'dd MMM yyyy')
  }));

  return (
    <div className="space-y-8">
      <div className="relative overflow-hidden rounded-[40px] bg-gradient-to-br from-emerald-600 via-emerald-500 to-emerald-700 p-10 md:p-12 text-white">
        <div className="relative z-10 flex items-center justify-between gap-8">
          <div className="space-y-4">
            <h1 className="text-4xl md:text-5xl font-black tracking-tighter">Good Morning, <br />{employee.first_name}!</h1>
            <p className="text-emerald-100 font-bold text-lg max-w-md">You have {pendingRequests} pending leave requests{nextShift ? ` and your next shift is ${nextShift.label} on ${nextAssignment?.day_date}.` : '.'}</p>
            <div className="flex flex-wrap gap-3 pt-2">
              <button onClick={onApplyLeave} className="px-6 py-3 bg-white text-emerald-600 rounded-2xl font-black flex items-center gap-2 hover:bg-emerald-50 transition-all shadow-lg shadow-emerald-900/20"><Plus className="w-5 h-5" />Apply for Leave</button>
              <button className="px-6 py-3 bg-emerald-500 text-white rounded-2xl font-black flex items-center gap-2 hover:bg-emerald-400 transition-all">View Roster</button>
            </div>
          </div>
          <div className="hidden lg:block"><div className="w-48 h-48 bg-white/10 backdrop-blur-md rounded-[40px] border border-white/20 p-6 flex flex-col justify-center items-center text-center"><Calendar className="w-12 h-12 mb-2 opacity-50" /><span className="text-sm font-black uppercase tracking-widest opacity-60">Today is</span><span className="text-3xl font-black">{format(new Date(), 'dd')}</span><span className="text-sm font-bold uppercase tracking-widest">{format(new Date(), 'MMMM')}</span></div></div>
        </div>
        <div className="absolute top-[-10%] right-[-5%] w-64 h-64 bg-emerald-500 rounded-full blur-3xl opacity-50" />
        <div className="absolute bottom-[-20%] left-[20%] w-96 h-96 bg-emerald-400 rounded-full blur-3xl opacity-30" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <StatCard label="Annual Leave" value={employee.annual_leave || 0} total={21} color="bg-emerald-500" icon={Calendar} />
            <StatCard label="Sick Leave" value={employee.sick_leave || 0} total={10} color="bg-amber-500" icon={Clock} />
            <StatCard label="Family Leave" value={employee.family_leave || 0} total={3} color="bg-indigo-500" icon={Users} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="bg-white rounded-[32px] p-8 shadow-sm border border-slate-100">
              <div className="flex items-center justify-between mb-6"><h3 className="text-xl font-black text-slate-800 tracking-tight">Upcoming Leave</h3><button className="text-emerald-600 font-black text-xs uppercase tracking-widest hover:underline">View All</button></div>
              <div className="space-y-4">
                {upcomingLeave.length > 0 ? upcomingLeave.map((leave, i) => (
                  <div key={i} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100"><div className="flex items-center gap-4"><div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center"><CheckCircle2 className="w-5 h-5 text-emerald-600" /></div><div><p className="font-black text-slate-800 text-sm">{leave.type}</p><p className="text-xs text-slate-500 font-bold">{leave.date}</p></div></div><span className="px-3 py-1 bg-white rounded-lg text-[10px] font-black text-slate-600 border border-slate-200">{leave.days} Days</span></div>
                )) : <BrandedState type="empty" portal="employee" title="No Upcoming Leave" message="You don't have any upcoming leave scheduled." action={{ label: 'Apply Now', onClick: onApplyLeave }} />}
              </div>
            </div>

            <div className="bg-white rounded-[32px] p-8 shadow-sm border border-slate-100">
              <div className="flex items-center justify-between mb-6"><h3 className="text-xl font-black text-slate-800 tracking-tight">Pending Requests</h3><span className="px-2 py-1 bg-amber-100 text-amber-600 text-[10px] font-black rounded-lg uppercase tracking-widest">{pendingRequests} Active</span></div>
              <div className="space-y-4">
                {employeeRequests.filter(r => r.status === 'pending').slice(0, 2).map((req) => (
                  <div key={req.id} className="p-4 bg-amber-50/50 rounded-2xl border border-amber-100 flex items-center justify-between"><div className="flex items-center gap-4"><div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center"><Clock className="w-5 h-5 text-amber-600" /></div><div><p className="font-black text-slate-800 text-sm">{req.type === 'half_day' ? 'Half Day' : req.type === 'unpaid' ? 'Unpaid Leave' : req.type === 'family' ? 'Family Responsibility' : `${req.type.charAt(0).toUpperCase() + req.type.slice(1)} Leave`}</p><p className="text-xs text-slate-500 font-bold">{format(parseISO(req.start_date), 'dd MMM')} - {format(parseISO(req.end_date), 'dd MMM')}</p></div></div><ChevronRight className="w-5 h-5 text-amber-400" /></div>
                ))}
                {pendingRequests === 0 && <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 text-slate-500 font-bold text-sm">No pending requests right now.</div>}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-8">
          <div className="bg-white rounded-[32px] p-8 shadow-sm border border-slate-100">
            <h3 className="text-xl font-black text-slate-800 tracking-tight mb-6">Quick Actions</h3>
            <div className="grid grid-cols-2 gap-4">
              <button className="p-4 bg-slate-50 rounded-2xl hover:bg-emerald-50 hover:border-emerald-100 border border-transparent transition-all text-center group"><FileText className="w-6 h-6 text-slate-400 group-hover:text-emerald-600 mx-auto mb-2" /><span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Payslip</span></button>
              <button className="p-4 bg-slate-50 rounded-2xl hover:bg-emerald-50 hover:border-emerald-100 border border-transparent transition-all text-center group"><TrendingUp className="w-6 h-6 text-slate-400 group-hover:text-emerald-600 mx-auto mb-2" /><span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Overtime</span></button>
              <button className="p-4 bg-slate-50 rounded-2xl hover:bg-emerald-50 hover:border-emerald-100 border border-transparent transition-all text-center group"><History className="w-6 h-6 text-slate-400 group-hover:text-emerald-600 mx-auto mb-2" /><span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">History</span></button>
              <button className="p-4 bg-slate-50 rounded-2xl hover:bg-emerald-50 hover:border-emerald-100 border border-transparent transition-all text-center group"><ArrowRight className="w-6 h-6 text-slate-400 group-hover:text-emerald-600 mx-auto mb-2" /><span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">More</span></button>
            </div>
          </div>

          <div className="bg-white rounded-[32px] p-8 shadow-sm border border-slate-100">
            <h3 className="text-xl font-black text-slate-800 tracking-tight mb-6">Recent Activity</h3>
            <div className="space-y-6">
              {recentActivity.length > 0 ? recentActivity.map((item, i) => (
                <div key={i} className="flex gap-4 relative">
                  {i !== recentActivity.length - 1 && <div className="absolute left-5 top-10 bottom-[-20px] w-0.5 bg-slate-100" />}
                  <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shrink-0 z-10", item.type === 'annual' ? 'bg-emerald-100 text-emerald-600' : item.type === 'family' ? 'bg-indigo-100 text-indigo-600' : 'bg-amber-100 text-amber-600')}><Calendar className="w-5 h-5" /></div>
                  <div><p className="font-black text-slate-800 text-sm">{item.action}</p><p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{item.date}</p></div>
                </div>
              )) : <div className="text-sm font-bold text-slate-500">No recent leave activity yet.</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
