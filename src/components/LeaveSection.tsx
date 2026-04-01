import React, { useEffect, useMemo, useState } from 'react';
import { 
  CalendarDays, 
  CheckCircle, 
  XCircle, 
  Clock, 
  Lock,
  Search, 
  Plus, 
  AlertCircle,
  User,
  FileText,
  ChevronLeft,
  Calendar as CalendarIcon,
  TrendingUp,
  TrendingDown
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  format, 
  parseISO, 
  startOfWeek, 
  addDays, 
  isSameDay, 
  startOfMonth, 
  endOfMonth, 
  endOfWeek, 
  eachDayOfInterval,
  isSameMonth,
  addMonths,
  subMonths
} from 'date-fns';
import { Employee, LeaveRequest, LeaveType } from '../types';
import { cn } from '../lib/utils';
import { Tooltip } from './Tooltip';
import { toast } from 'sonner';
import { appService } from '../services/appService';

interface LeaveSectionProps {
  employees: Employee[];
  requests: LeaveRequest[];
  setRequests: React.Dispatch<React.SetStateAction<LeaveRequest[]>>;
  onRefresh: (employeeId?: string) => Promise<LeaveRequest[]>;
  onRefreshEmployees?: () => Promise<void>;
  initialSelectedEmployeeId?: string | null;
  clientContextKey?: string | null;
  leaveBalanceDeltas?: Record<string, { annual: number; sick: number; family: number }>;
}

export const LeaveSection: React.FC<LeaveSectionProps> = ({ employees, requests, setRequests, onRefresh, onRefreshEmployees, initialSelectedEmployeeId, clientContextKey: _clientContextKey, leaveBalanceDeltas = {} }) => {
  const pendingLeaveLocked = true;
  const [activeTab, setActiveTab] = useState<'employees' | 'pending' | 'calendar'>('employees');
  const [searchTerm, setSearchTerm] = useState('');
  const [currentMonth, setCurrentMonth] = useState(new Date());
  
  // Selected Employee View
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);

  // Form state for manual log
  const [isLogLeaveModalOpen, setIsLogLeaveModalOpen] = useState(false);
  const [leaveType, setLeaveType] = useState<LeaveType>('annual');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [notes, setNotes] = useState('');

  const renderMovementBadge = (delta: unknown, positiveLabel = 'Accrued', negativeLabel = 'Used') => {
    const numericValue = Number(delta);
    if (!Number.isFinite(numericValue) || Math.abs(numericValue) < 0.00005) return null;
    const isPositive = numericValue > 0;
    return (
      <div
        className={cn(
          'mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest',
          isPositive ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
        )}
      >
        {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
        <span>{isPositive ? positiveLabel : negativeLabel} {isPositive ? `+${Math.abs(numericValue).toFixed(4)}` : `-${Math.abs(numericValue).toFixed(4)}`}</span>
      </div>
    );
  };

  const leaveTypeMeta: Record<LeaveType, { label: string; badge: string }> = {
    annual: { label: 'Annual Leave', badge: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
    sick: { label: 'Sick Leave', badge: 'bg-amber-50 text-amber-700 border-amber-100' },
    family: { label: 'Family Responsibility', badge: 'bg-rose-50 text-rose-700 border-rose-100' },
    unpaid: { label: 'Unpaid Leave', badge: 'bg-slate-100 text-slate-700 border-slate-200' },
    half_day: { label: 'Half Day', badge: 'bg-sky-50 text-sky-700 border-sky-100' },
  };

  useEffect(() => {
    if (!selectedEmployee) return;
    const next = employees.find((employee) => employee.id === selectedEmployee.id) || null;
    if (next) setSelectedEmployee(next);
  }, [employees, selectedEmployee?.id]);

  useEffect(() => {
    if (!initialSelectedEmployeeId) {
      setSelectedEmployee(null);
      return;
    }
    const employeeMatch = employees.find((employee) => String(employee.id) === String(initialSelectedEmployeeId)) || null;
    if (employeeMatch) {
      setSelectedEmployee(employeeMatch);
      setActiveTab('employees');
    }
  }, [employees, initialSelectedEmployeeId]);

  useEffect(() => {
    if (leaveType === 'half_day' && startDate) {
      setEndDate(startDate);
    }
  }, [leaveType, startDate]);

  useEffect(() => {
    if (pendingLeaveLocked && activeTab === 'pending') {
      setActiveTab('employees');
    }
  }, [pendingLeaveLocked, activeTab]);

  const withAdminOverrideRetry = async (action: (overrides?: Record<string, unknown>) => Promise<void>) => {
    try {
      await action();
      return true;
    } catch (error: any) {
      const code = error?.details?.code;
      if (code === 'INSUFFICIENT_LEAVE') {
        const available = Number(error?.details?.available ?? 0);
        const requested = Number(error?.details?.requested ?? 0);
        const confirmed = window.confirm(`This employee has insufficient leave. Available: ${available}. Requested: ${requested}. Continue with admin override?`);
        if (!confirmed) return false;
        await action({ allow_negative_balance: true, admin_override: true });
        return true;
      }
      if (code === 'DOUBLE_BOOKED') {
        const confirmed = window.confirm('This employee already has leave booked for one or more of the selected dates. Continue with admin override?');
        if (!confirmed) return false;
        await action({ override_double_booking: true, admin_override: true });
        return true;
      }
      throw error;
    }
  };

  const handleStatusChange = async (id: string, newStatus: 'approved' | 'declined') => {
    try {
      const completed = await withAdminOverrideRetry((overrides) => appService.updateLeaveStatus(id, newStatus, overrides || {}));
      if (!completed) return;
      await onRefresh();
      await onRefreshEmployees?.();
      toast.success(`Leave request ${newStatus}`);
    } catch (error: any) {
      toast.error(error?.message || `Failed to ${newStatus} leave request`);
    }
  };

  const handleLogLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmployee || !startDate || !endDate) {
      toast.error('Please fill in all required fields');
      return;
    }

    if (new Date(startDate) > new Date(endDate)) {
      toast.error('End date cannot be before start date');
      return;
    }

    try {
      const completed = await withAdminOverrideRetry((overrides) => appService.createLeaveRequest({
        employee_id: selectedEmployee.id,
        type: leaveType,
        start_date: startDate,
        end_date: endDate,
        status: 'approved',
        notes,
        ...(leaveType === 'half_day' ? { is_half_day: true } : {}),
        ...(overrides || {}),
      }));
      if (!completed) return;
      await onRefresh(selectedEmployee.id);
      await onRefreshEmployees?.();
      setIsLogLeaveModalOpen(false);
      toast.success('Leave logged successfully');
    } catch (error: any) {
      toast.error(error?.message || 'Failed to log leave');
      return;
    }
    
    // Reset form
    setLeaveType('annual');
    setStartDate('');
    setEndDate('');
    setNotes('');
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'approved': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case 'declined': return 'bg-rose-100 text-rose-700 border-rose-200';
      default: return 'bg-amber-100 text-amber-700 border-amber-200';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'approved': return <CheckCircle className="w-4 h-4" />;
      case 'declined': return <XCircle className="w-4 h-4" />;
      default: return <Clock className="w-4 h-4" />;
    }
  };

  const filteredEmployees = employees.filter(emp => 
    `${emp.first_name} ${emp.last_name}`.toLowerCase().includes(searchTerm.toLowerCase()) ||
    emp.emp_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
    emp.department.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(monthStart);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const calendarDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd });
  const visibleCalendarRequests = useMemo(() => {
    const deduped = new Map<string, LeaveRequest>();
    requests
      .filter((request) => ['approved', 'pending'].includes(request.status))
      .forEach((request) => {
        const employeeKey = String(request.employee_id || request.employee_name || '').trim().toLowerCase();
        const key = [employeeKey, request.type, String(request.is_half_day ? 'half' : 'full'), String(request.start_date).slice(0, 10), String(request.end_date).slice(0, 10), request.status].join('|');
        const existing = deduped.get(key);
        if (!existing || (existing.source !== 'manual' && request.source !== 'roster')) {
          deduped.set(key, request);
        }
      });
    return [...deduped.values()].sort((a, b) => {
      const dateDiff = new Date(a.start_date).getTime() - new Date(b.start_date).getTime();
      if (dateDiff !== 0) return dateDiff;
      return String(a.employee_name || '').localeCompare(String(b.employee_name || ''));
    });
  }, [requests]);

  // If an employee is selected, show their detailed view
  if (selectedEmployee) {
    const employeeRequests = requests.filter(r => r.employee_id === selectedEmployee.id);
    const pendingCount = employeeRequests.filter(r => r.status === 'pending').length;
    const employeeDelta = leaveBalanceDeltas[String(selectedEmployee.id)] || { annual: 0, sick: 0, family: 0 };

    return (
      <div className="space-y-8">
        <div className="flex items-center gap-4">
          <Tooltip content="Back to Employee List">
            <button 
              onClick={() => setSelectedEmployee(null)}
              className="p-2 hover:bg-slate-200 rounded-full transition-colors"
            >
              <ChevronLeft className="w-6 h-6 text-slate-600" />
            </button>
          </Tooltip>
          <div className="space-y-1">
            <h2 className="text-3xl font-black text-slate-800 tracking-tight">
              {selectedEmployee.first_name} {selectedEmployee.last_name}
            </h2>
            <p className="text-sm text-slate-500 font-bold uppercase tracking-widest">
              {selectedEmployee.emp_id} • {selectedEmployee.department}
            </p>
          </div>
          <div className="ml-auto">
            <Tooltip content="Manually log leave for this employee">
              <button
                onClick={() => setIsLogLeaveModalOpen(true)}
                className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl font-bold text-sm hover:bg-indigo-700 transition-colors flex items-center gap-2 shadow-lg shadow-indigo-200"
              >
                <Plus className="w-4 h-4" />
                Log Leave
              </button>
            </Tooltip>
          </div>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white/80 backdrop-blur-md p-6 rounded-[32px] shadow-xl shadow-indigo-100/20 border border-white/20">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 rounded-2xl bg-emerald-100 flex items-center justify-center text-emerald-600">
                <CalendarDays className="w-6 h-6" />
              </div>
              <div>
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Annual Leave</div>
                <div className={cn("text-2xl font-black", Number(selectedEmployee.annual_leave || 0) < 0 ? "text-red-600" : "text-slate-800")}>{Number(selectedEmployee.annual_leave || 0).toFixed(4)} Days</div>
                {renderMovementBadge(employeeDelta.annual)}
              </div>
            </div>
          </div>
          <div className="bg-white/80 backdrop-blur-md p-6 rounded-[32px] shadow-xl shadow-indigo-100/20 border border-white/20">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 rounded-2xl bg-amber-100 flex items-center justify-center text-amber-600">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div>
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Sick Leave</div>
                <div className={cn("text-2xl font-black", Number(selectedEmployee.sick_leave || 0) < 0 ? "text-red-600" : "text-slate-800")}>{Number(selectedEmployee.sick_leave || 0).toFixed(4)} Days</div>
                {renderMovementBadge(employeeDelta.sick)}
              </div>
            </div>
          </div>
          <div className="bg-white/80 backdrop-blur-md p-6 rounded-[32px] shadow-xl shadow-indigo-100/20 border border-white/20">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 rounded-2xl bg-rose-100 flex items-center justify-center text-rose-600">
                <User className="w-6 h-6" />
              </div>
              <div>
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Family Leave</div>
                <div className={cn("text-2xl font-black", Number(selectedEmployee.family_leave || 0) < 0 ? "text-red-600" : "text-slate-800")}>{Number(selectedEmployee.family_leave || 0).toFixed(4)} Days</div>
                {renderMovementBadge(employeeDelta.family)}
              </div>
            </div>
          </div>
          </div>
        </div>


        <div className="bg-white/80 backdrop-blur-md rounded-[32px] shadow-xl shadow-indigo-100/20 border border-white/20 overflow-hidden flex-1 min-h-0 flex flex-col">
          <div className="p-6 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-lg font-black text-slate-800">Leave History & Requests</h3>
            {pendingCount > 0 && (
              <span className="px-3 py-1 bg-amber-100 text-amber-700 rounded-lg text-[10px] font-black uppercase tracking-widest">
                {pendingCount} Pending
              </span>
            )}
          </div>
          <div className="divide-y divide-slate-100">
            {employeeRequests.length === 0 ? (
              <div className="p-8 text-center text-slate-500 font-medium">
                No leave requests found for this employee.
              </div>
            ) : (
              employeeRequests.map(req => (
                <div key={req.id} className="p-6 hover:bg-slate-50 transition-colors">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-2">
                      <div className="flex items-center gap-3">
                        <span className="inline-flex items-center px-3 py-1 rounded-lg bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest">
                          {leaveTypeMeta[req.type as LeaveType]?.label || req.type}
                        </span>
                        <span className={cn(
                          "inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border",
                          getStatusColor(req.status)
                        )}>
                          {getStatusIcon(req.status)}
                          {req.status}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
                        <CalendarIcon className="w-4 h-4 text-slate-400" />
                        {format(parseISO(req.start_date), 'MMM d, yyyy')} - {format(parseISO(req.end_date), 'MMM d, yyyy')}
                      </div>
                      {req.notes && (
                        <p className="text-sm text-slate-500 font-medium">"{req.notes}"</p>
                      )}
                    </div>
                    
                    {req.status === 'pending' && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleStatusChange(req.id, 'declined')}
                          className="px-4 py-2 rounded-xl font-bold text-xs bg-rose-50 text-rose-600 hover:bg-rose-100 transition-colors"
                        >
                          Decline
                        </button>
                        <button
                          onClick={() => handleStatusChange(req.id, 'approved')}
                          className="px-4 py-2 rounded-xl font-bold text-xs bg-emerald-600 text-white hover:bg-emerald-700 shadow-lg shadow-emerald-200 transition-all active:scale-95"
                        >
                          Approve
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Log Leave Modal */}
        <AnimatePresence>
          {isLogLeaveModalOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsLogLeaveModalOpen(false)}
                className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100]"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-white rounded-[40px] shadow-2xl z-[101] overflow-hidden"
              >
                <div className="p-8 border-b border-slate-100 flex items-center justify-between">
                  <h3 className="text-2xl font-black text-slate-800">Log Leave</h3>
                  <button onClick={() => setIsLogLeaveModalOpen(false)} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                    <XCircle className="w-5 h-5 text-slate-400" />
                  </button>
                </div>
                <form onSubmit={handleLogLeave} className="p-8 space-y-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Leave Type</label>
                    <select
                      value={leaveType}
                      onChange={(e) => setLeaveType(e.target.value as LeaveType)}
                      className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-indigo-600/10 focus:border-indigo-600 outline-none transition-all font-bold text-slate-700 bg-white"
                    >
                      <option value="annual">Annual Leave</option>
                      <option value="sick">Sick Leave</option>
                      <option value="family">Family Responsibility</option>
                      <option value="unpaid">Unpaid Leave</option>
                      <option value="half_day">Half Day</option>
                    </select>
                  </div>
                  {leaveType === 'unpaid' && (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600">
                      Unpaid Leave logs at zero paid hours and does not reduce the employee's leave balance.
                    </div>
                  )}
                  {leaveType === 'half_day' && (
                    <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-700">
                      Half Day logs at half the hours of Annual Leave and deducts 0.5 from Annual Leave balance.
                    </div>
                  )}
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Start Date</label>
                      <input
                        type="date"
                        required
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-indigo-600/10 focus:border-indigo-600 outline-none transition-all font-bold text-slate-700"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">End Date</label>
                      <input
                        type="date"
                        required
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        disabled={leaveType === 'half_day'}
                        className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-indigo-600/10 focus:border-indigo-600 outline-none transition-all font-bold text-slate-700 disabled:bg-slate-100 disabled:text-slate-500"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Notes (Optional)</label>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={3}
                      placeholder="Provide any additional details..."
                      className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-indigo-600/10 focus:border-indigo-600 outline-none transition-all font-medium text-slate-700 resize-none"
                    />
                  </div>

                  <div className="pt-4 flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setIsLogLeaveModalOpen(false)}
                      className="px-6 py-3 rounded-2xl font-bold text-sm text-slate-500 hover:bg-slate-100 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-6 py-3 rounded-2xl font-bold text-sm bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition-all active:scale-95"
                    >
                      Log Leave
                    </button>
                  </div>
                </form>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // Main View (List of Employees or Calendar)
  return (
    <div className="dashboard-section-shell flex flex-col gap-8 min-h-0">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-4xl font-black text-slate-800 tracking-tight">Leave Management</h2>
          <p className="text-sm text-slate-500 font-bold uppercase tracking-widest">Manage employee time off</p>
        </div>
      </div>

      <div className="flex gap-2 p-1.5 bg-white/80 backdrop-blur-md rounded-2xl shadow-sm border border-slate-100 w-fit">
        <button
          onClick={() => setActiveTab('employees')}
          className={cn(
            "px-6 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center gap-2",
            activeTab === 'employees' 
              ? "bg-indigo-600 text-white shadow-md shadow-indigo-200" 
              : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
          )}
        >
          <User className="w-4 h-4" />
          Employees
        </button>
        <button
          type="button"
          onClick={() => toast.info('Pending Leave is coming soon.')}
          aria-disabled="true"
          className="px-6 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center gap-2 bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200"
        >
          <Lock className="w-4 h-4" />
          Pending Leave
          <span className="ml-1.5 px-2 py-0.5 rounded-md text-[10px] font-black bg-white text-slate-500 border border-slate-200">Soon</span>
        </button>
        <button
          onClick={() => setActiveTab('calendar')}
          className={cn(
            "px-6 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center gap-2",
            activeTab === 'calendar' 
              ? "bg-indigo-600 text-white shadow-md shadow-indigo-200" 
              : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
          )}
        >
          <CalendarDays className="w-4 h-4" />
          Company Calendar
        </button>
      </div>

      {activeTab === 'employees' && (
        <div className="bg-white/80 backdrop-blur-md rounded-[32px] shadow-xl shadow-indigo-100/20 border border-white/20 overflow-hidden flex-1 min-h-0 flex flex-col">
          <div className="p-6 border-b border-slate-100 flex items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input 
                type="text" 
                placeholder="Search employees..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-11 pr-4 py-3 rounded-2xl bg-slate-50 border-none focus:ring-2 focus:ring-indigo-600/20 outline-none font-bold text-sm text-slate-700 placeholder:text-slate-400"
              />
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto hide-horizontal-scrollbar">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-sm">
                <tr className="bg-slate-50/50 text-slate-500 text-[10px] uppercase tracking-widest font-black">
                  <th className="px-8 py-6">Employee</th>
                  <th className="px-8 py-6">Department</th>
                  <th className="px-8 py-6">Pending Requests</th>
                  <th className="px-8 py-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredEmployees.map(emp => {
                  const empRequests = requests.filter(r => r.employee_id === emp.id);
                  const pendingCount = empRequests.filter(r => r.status === 'pending').length;
                  
                  return (
                    <tr key={emp.id} className="hover:bg-indigo-50/30 transition-colors group">
                      <td className="px-8 py-6">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-2xl bg-indigo-100 flex items-center justify-center text-indigo-600 font-black text-xs">
                            {emp.first_name.charAt(0)}{emp.last_name.charAt(0)}
                          </div>
                          <div>
                            <span className="block text-sm font-bold text-slate-800">{emp.first_name} {emp.last_name}</span>
                            <span className="block text-xs font-medium text-slate-500 tracking-[1px]">{emp.emp_id}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-8 py-6">
                        <span className="inline-flex items-center px-3 py-1 rounded-lg bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest">
                          {emp.department}
                        </span>
                      </td>
                      <td className="px-8 py-6">
                        {pendingCount > 0 ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-amber-100 text-amber-700 text-[10px] font-black uppercase tracking-widest border border-amber-200">
                            <Clock className="w-3 h-3" />
                            {pendingCount} Pending
                          </span>
                        ) : (
                          <span className="text-slate-400 text-xs font-bold">-</span>
                        )}
                      </td>
                      <td className="px-8 py-6 text-right">
                        <button 
                          onClick={() => setSelectedEmployee(emp)}
                          className="px-4 py-2 bg-slate-100 text-slate-600 hover:bg-indigo-600 hover:text-white rounded-xl font-bold text-xs transition-colors"
                        >
                          Manage Leave
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {filteredEmployees.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-8 py-12 text-center text-slate-500 font-medium">
                      No employees found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'pending' && (
        <div className="bg-white/80 backdrop-blur-md rounded-[32px] shadow-xl shadow-indigo-100/20 border border-white/20 overflow-hidden">
          <div className="p-6 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-lg font-black text-slate-800">Pending Leave Requests</h3>
            <span className="px-3 py-1 bg-amber-100 text-amber-700 rounded-lg text-[10px] font-black uppercase tracking-widest">
              {requests.filter(r => r.status === 'pending').length} Pending
            </span>
          </div>
          <div className="divide-y divide-slate-100">
            {requests.filter(r => r.status === 'pending').length === 0 ? (
              <div className="p-8 text-center text-slate-500 font-medium">
                No pending leave requests.
              </div>
            ) : (
              requests.filter(r => r.status === 'pending').map(req => {
                const emp = employees.find(e => e.id === req.employee_id);
                return (
                  <div key={req.id} className="p-6 hover:bg-slate-50 transition-colors">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="space-y-2">
                        <div className="flex items-center gap-3">
                          <span className="inline-flex items-center px-3 py-1 rounded-lg bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest">
                            {leaveTypeMeta[req.type as LeaveType]?.label || req.type}
                          </span>
                          <span className="font-bold text-slate-800">{req.employee_name}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
                          <CalendarIcon className="w-4 h-4 text-slate-400" />
                          {format(parseISO(req.start_date), 'MMM d, yyyy')} - {format(parseISO(req.end_date), 'MMM d, yyyy')}
                        </div>
                        {req.notes && (
                          <p className="text-sm text-slate-500 font-medium">"{req.notes}"</p>
                        )}
                      </div>
                      
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            if (emp) setSelectedEmployee(emp);
                          }}
                          className="px-4 py-2 rounded-xl font-bold text-xs bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors"
                        >
                          View Employee
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {activeTab === 'calendar' && (
        <div className="bg-white/80 backdrop-blur-md rounded-[32px] shadow-xl shadow-indigo-100/20 border border-white/20 p-8">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-xl font-black text-slate-800">{format(currentMonth, 'MMMM yyyy')}</h2>
            <div className="flex items-center gap-2">
              <Tooltip content="Previous Month">
                <button 
                  onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                  className="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 font-bold text-sm hover:bg-slate-200 transition-colors"
                >
                  Previous Month
                </button>
              </Tooltip>
              <Tooltip content="Go to Current Month">
                <button 
                  onClick={() => setCurrentMonth(new Date())}
                  className="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 font-bold text-sm hover:bg-slate-200 transition-colors"
                >
                  Today
                </button>
              </Tooltip>
              <Tooltip content="Next Month">
                <button 
                  onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                  className="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 font-bold text-sm hover:bg-slate-200 transition-colors"
                >
                  Next Month
                </button>
              </Tooltip>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-px bg-slate-200 rounded-2xl overflow-hidden border border-slate-200">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
              <div key={day} className="bg-slate-50 p-4 text-center text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {day}
              </div>
            ))}
            {calendarDays.map((day, i) => {
              const dayRequests = visibleCalendarRequests.filter((request) => {
                const start = parseISO(`${String(request.start_date).slice(0, 10)}T00:00:00`);
                const end = parseISO(`${String(request.end_date).slice(0, 10)}T00:00:00`);
                return start <= day && end >= day;
              });
              const breakdownRequests = Array.from(new Map(
                dayRequests.map((request) => {
                  const key = [
                    String(request.employee_id || request.employee_name || '').trim().toLowerCase(),
                    String(request.type),
                    String(request.status),
                  ].join('|');
                  return [key, request] as const;
                })
              ).values());
              const uniqueEmployeeCount = new Set(
                breakdownRequests.map((request) => String(request.employee_id || request.employee_name || '').trim().toLowerCase())
              ).size;
              const hoverBreakdown = breakdownRequests
                .map((request) => `${request.employee_name} • ${leaveTypeMeta[request.type as LeaveType]?.label || request.type}${request.status === 'pending' ? ' • Pending' : ''}`)
                .join('
');

              return (
                <div 
                  key={i} 
                  className={cn(
                    "min-h-[140px] bg-white p-2 transition-colors",
                    !isSameMonth(day, monthStart) && "bg-slate-50/50",
                    isSameDay(day, new Date()) && "bg-indigo-50/30"
                  )}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className={cn(
                      "text-xs font-black w-6 h-6 flex items-center justify-center rounded-full",
                      isSameDay(day, new Date()) ? "bg-indigo-600 text-white" : "text-slate-400",
                      !isSameMonth(day, monthStart) && "opacity-30"
                    )}>
                      {format(day, 'd')}
                    </span>
                  </div>
                  
                  <div className="space-y-2">
                    {uniqueEmployeeCount > 0 && (
                      <div
                        title={hoverBreakdown}
                        className="rounded-xl border border-indigo-200 bg-indigo-50 px-2.5 py-2 text-[10px] font-black text-indigo-700 shadow-sm"
                      >
                        {uniqueEmployeeCount} employee{uniqueEmployeeCount === 1 ? '' : 's'} on leave
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>


          <div className="mt-6 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 py-4 text-sm font-bold text-slate-500">
            Approved and pending leave is shown as a daily count. Hover the leave badge in each day to see the employee breakdown, including past and future leave when you move between months.
          </div>        </div>
      )}
    </div>
  );
};

