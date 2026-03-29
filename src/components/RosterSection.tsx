import React, { useState, useMemo } from 'react';
import { format, addDays, subDays, isSunday, isToday, isBefore, startOfDay, differenceInCalendarDays } from 'date-fns';
import { ChevronLeft, ChevronRight, CheckCircle2, DollarSign, AlertCircle, Clock, CreditCard, FileText, Search, Download } from 'lucide-react';
import { Employee, Shift, RosterAssignment, RosterMeta, PayrollSubmission } from '../types';
import { isSAPublicHoliday } from '../constants';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import { downloadCSV, exportToPDF } from '../utils/exportUtils';
import { sortShiftsBaseFirst, doesShiftStartOverlapPrevious, formatShiftTimeLabel } from '../lib/shifts';

import { Tooltip } from './Tooltip';

import { RosterDefinition } from '../types';

const ROSTER_DEFINITIONS: { id: RosterDefinition; label: string; placeholder: string }[] = [
  { id: 'salary_advance', label: 'Advance', placeholder: 'R 0.00' },
  { id: 'shortages', label: 'Shortage', placeholder: 'R 0.00' },
  { id: 'unpaid_hours', label: 'Unpaid Hours', placeholder: '0.00' },
  { id: 'staff_loan', label: 'Loan', placeholder: 'R 0.00' },
  { id: 'uniform', label: 'Uniform', placeholder: 'R 0.00' },
  { id: 'overthrows', label: 'Overthrows', placeholder: 'R 0.00' },
  { id: 'oil_spill', label: 'Oil Spill', placeholder: 'R 0.00' },
  { id: 'stock_shortage', label: 'Stock Shortage', placeholder: 'R 0.00' },
  { id: 'annual_bonus', label: 'Annual Bonus', placeholder: 'R 0.00' },
  { id: 'incentive_bonus', label: 'Incentive Bonus', placeholder: 'R 0.00' },
  { id: 'data_allowance', label: 'Data Allowance', placeholder: 'R 0.00' },
  { id: 'night_shift_allowance', label: 'Night Shift Allowance', placeholder: 'R 0.00' },
  { id: 'medical_allowance', label: 'Medical Allowance', placeholder: 'R 0.00' },
  { id: 'mibco_health_insurance', label: 'Mibco Health Insurance', placeholder: 'R 0.00' },
  { id: 'health_insurance', label: 'Health Insurance', placeholder: 'R 0.00' },
  { id: 'garnishee', label: 'Garnishee', placeholder: 'R 0.00' },
  { id: 'cell_phone_payment', label: 'Cell Phone Payment', placeholder: 'R 0.00' },
  { id: 'income_tax_registration', label: 'Income Tax Registration', placeholder: 'R 0.00' },
  { id: 'performance_incentive', label: 'Performance Incentive', placeholder: 'R 0.00' },
  { id: 'commission', label: 'Commission', placeholder: 'R 0.00' },
  { id: 'sales_commission', label: 'Sales Commission', placeholder: 'R 0.00' },
  { id: 'notes', label: 'Notes', placeholder: 'Add notes...' },
];

const sanitizeDefinitionValue = (definitionId: RosterDefinition, value: string) => {
  if (definitionId === 'notes') return value;

  const raw = String(value || '').replace(/,/g, '.').replace(/[^\d.]/g, '');
  if (!raw) return '';

  const [whole = '', ...fractionalParts] = raw.split('.');
  const fractional = fractionalParts.join('').slice(0, 2);

  return fractional ? `${whole}.${fractional}` : whole;
};

const getOrderedShiftOptions = (shifts: Shift[]) => sortShiftsBaseFirst(shifts);

interface RosterSectionProps {
  employees: Employee[];
  shifts: Shift[];
  roster: RosterAssignment[];
  rosterMeta: RosterMeta[];
  currentWeekStart: Date;
  rosterDuration?: '1_week' | '2_weeks' | '1_month';
  rosterMode?: 'Automated' | 'Hybrid' | 'Manual';
  rosterSeedWeekStart?: string | null;
  onRosterModeChange?: (mode: 'Automated' | 'Hybrid' | 'Manual') => void;
  enabledDefinitions?: RosterDefinition[];
  onWeekChange: (date: Date) => void;
  onUpdateRoster: (empId: string, date: string, shiftId: string | null) => void;
  onUpdateMeta: (empId: string, field: keyof RosterMeta, value: string) => void;
  onPayrollSubmit?: () => void | Promise<void>;
  isSuperAdmin?: boolean;
  payrollSubmissions?: PayrollSubmission[];
  rosterTitle?: string;
}

export const RosterSection: React.FC<RosterSectionProps> = ({ 
  employees, 
  shifts, 
  roster, 
  rosterMeta,
  currentWeekStart, 
  rosterDuration = '1_week',
  rosterMode = 'Manual',
  rosterSeedWeekStart = null,
  onRosterModeChange,
  enabledDefinitions = ['salary_advance', 'shortages', 'unpaid_hours', 'staff_loan', 'notes'],
  onWeekChange,
  onUpdateRoster,
  onUpdateMeta,
  onPayrollSubmit,
  isSuperAdmin = false,
  payrollSubmissions = [],
  rosterTitle = 'Weekly Roster'
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const payrollMode = rosterMode;
  const setPayrollMode = (mode: 'Automated' | 'Hybrid' | 'Manual') => onRosterModeChange?.(mode);
  const [showExportOptions, setShowExportOptions] = useState(false);
  const periodDays = rosterDuration === '2_weeks' ? 14 : rosterDuration === '1_month' ? 28 : 7;
  const seedDays = periodDays;
  const weekDays = Array.from({ length: periodDays }, (_, i) => addDays(currentWeekStart, i));
  const weekStartIso = format(currentWeekStart, 'yyyy-MM-dd');
  const totalVisibleColumns = 1 + weekDays.length + ROSTER_DEFINITIONS.filter(d => enabledDefinitions.includes(d.id)).length;
  const hasShownPastLockToastRef = React.useRef<string | null>(null);
  const periodEndDate = addDays(currentWeekStart, periodDays - 1);
  const currentPeriodStartIso = format(currentWeekStart, 'yyyy-MM-dd');
  const currentPeriodEndIso = format(periodEndDate, 'yyyy-MM-dd');
  const isPastLockedPeriod = !isSuperAdmin && isBefore(startOfDay(periodEndDate), startOfDay(new Date()));
  const isPayrollSubmittedPeriod = !isSuperAdmin && payrollSubmissions.some(submission => {
    const start = String(submission.periodStart || '').trim();
    const end = String(submission.periodEnd || '').trim();
    if (!start || !end) return false;
    return start <= currentPeriodEndIso && end >= currentPeriodStartIso;
  });
  const isPeriodLocked = isPastLockedPeriod || isPayrollSubmittedPeriod;
  const lockReason = isPayrollSubmittedPeriod
    ? 'This roster period has already been submitted to payroll and is locked. Contact admin through Support for changes.'
    : 'Previous roster periods are locked for clients. Contact admin through Support for changes.';
  const orderedShifts = useMemo(() => getOrderedShiftOptions(shifts), [shifts]);

  // Close export options when clicking outside
  React.useEffect(() => {
    if (!showExportOptions) return;
    const handleClick = () => setShowExportOptions(false);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [showExportOptions]);

  React.useEffect(() => {
    if (!isPeriodLocked) return;
    const key = `${weekStartIso}-${periodDays}-${isSuperAdmin ? 'superadmin' : 'client'}`;
    if (hasShownPastLockToastRef.current === key) return;
    hasShownPastLockToastRef.current = key;
    toast.warning(lockReason);
  }, [isPeriodLocked, lockReason, weekStartIso, periodDays, isSuperAdmin]);

  const filteredEmployees = useMemo(() => {
    return employees.filter(emp => 
      `${emp.first_name} ${emp.last_name}`.toLowerCase().includes(searchTerm.toLowerCase()) ||
      emp.emp_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      emp.department.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [employees, searchTerm]);

  const groupedEmployees = useMemo(() => {
    const groups: { [key: string]: Employee[] } = {};
    filteredEmployees.forEach(emp => {
      const dept = emp.department || 'Unassigned';
      if (!groups[dept]) groups[dept] = [];
      groups[dept].push(emp);
    });
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredEmployees]);

  const allEmployeesByDepartment = useMemo(() => {
    const groups: Record<string, Employee[]> = {};
    employees.forEach(emp => {
      const dept = emp.department || 'Unassigned';
      if (!groups[dept]) groups[dept] = [];
      groups[dept].push(emp);
    });
    Object.keys(groups).forEach(dept => {
      groups[dept] = [...groups[dept]].sort((a, b) => String(a.emp_id || '').localeCompare(String(b.emp_id || '')));
    });
    return groups;
  }, [employees]);

  const seedWeekStartIso = useMemo(() => {
    if (rosterSeedWeekStart) return rosterSeedWeekStart;
    if (!roster.length) return weekStartIso;
    const sortedDates = roster
      .map(r => r.day_date)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    return sortedDates[0] || weekStartIso;
  }, [rosterSeedWeekStart, roster, weekStartIso]);

  const isSeedDate = (dayDate: string) => {
    const diff = differenceInCalendarDays(new Date(`${dayDate}T00:00:00`), new Date(`${seedWeekStartIso}T00:00:00`));
    return diff >= 0 && diff < seedDays;
  };

  const findExplicitRosterValue = (employeeId: string, dayDate: string) => {
    return roster.find(r => r.employee_id === employeeId && r.day_date === dayDate)?.shift_id || "";
  };

  const isLeaveShiftId = (shiftId: string) => {
    const shift = shifts.find(s => s.id === shiftId);
    const label = String(shift?.label || '').toLowerCase();
    return label.includes('leave');
  };

  const getGeneratedRosterValue = (employee: Employee, dayDate: string) => {
    const department = employee.department || 'Unassigned';
    const departmentEmployees = allEmployeesByDepartment[department] || [];
    const employeeIndex = departmentEmployees.findIndex(emp => emp.id === employee.id);
    if (employeeIndex === -1 || departmentEmployees.length === 0) return "";

    const elapsedDays = Math.max(0, differenceInCalendarDays(new Date(`${dayDate}T00:00:00`), new Date(`${seedWeekStartIso}T00:00:00`)));
    const cycleOffset = Math.floor(elapsedDays / seedDays);
    const seedOffset = elapsedDays % seedDays;
    const seedDate = format(addDays(new Date(`${seedWeekStartIso}T00:00:00`), seedOffset), 'yyyy-MM-dd');

    const sourceEmployee = departmentEmployees[
      (employeeIndex - (cycleOffset % departmentEmployees.length) + departmentEmployees.length) % departmentEmployees.length
    ];
    const sourceShiftId = findExplicitRosterValue(sourceEmployee.id, seedDate);

    if (!sourceShiftId) return "";
    if (isLeaveShiftId(sourceShiftId)) return "";

    return sourceShiftId;
  };

  const getPreviousDayShift = (employee: Employee, dayDate: string) => {
    const previousDayIso = format(subDays(new Date(`${dayDate}T00:00:00`), 1), 'yyyy-MM-dd');
    const previousShiftId = getRosterValue(employee, previousDayIso);
    return previousShiftId ? shifts.find(s => s.id === previousShiftId) || null : null;
  };

  const isSundayDate = (dayDate: string) => isSunday(new Date(`${dayDate}T00:00:00`));

  const isShiftBlockedForCell = (employee: Employee, dayDate: string, shiftId: string | null | undefined) => {
    if (isSuperAdmin || !shiftId || isSundayDate(dayDate)) return false;
    const candidateShift = shifts.find(s => s.id === shiftId);
    if (!candidateShift) return false;
    const previousShift = getPreviousDayShift(employee, dayDate);
    return doesShiftStartOverlapPrevious(previousShift, candidateShift);
  };

  const getShiftBlockedReason = (employee: Employee, dayDate: string, shiftId: string | null | undefined) => {
    if (!shiftId || isSundayDate(dayDate)) return null;
    const candidateShift = shifts.find(s => s.id === shiftId);
    const previousShift = getPreviousDayShift(employee, dayDate);
    if (!candidateShift || !previousShift) return null;
    if (!doesShiftStartOverlapPrevious(previousShift, candidateShift)) return null;
    return `${candidateShift.label} cannot be allocated because it starts before the previous shift ends at ${formatShiftTimeLabel(previousShift.end)}.`;
  };

  const handleShiftSelectChange = (employee: Employee, dayDate: string, nextShiftId: string | null) => {
    const blockedReason = getShiftBlockedReason(employee, dayDate, nextShiftId);
    if (blockedReason) {
      toast.warning(blockedReason);
      return;
    }
    onUpdateRoster(employee.id, dayDate, nextShiftId);
  };

  const getRosterValue = (employee: Employee, dayDate: string) => {
    const explicitValue = findExplicitRosterValue(employee.id, dayDate);
    if (explicitValue) return explicitValue;

    if (payrollMode === 'Manual') return "";
    if (isSeedDate(dayDate)) return explicitValue;

    return getGeneratedRosterValue(employee, dayDate);
  };

  const isRosterCellEditable = (dayDate: string) => {
    if (isPeriodLocked) return false;
    if (payrollMode === 'Manual' || payrollMode === 'Hybrid') return true;
    return isSeedDate(dayDate);
  };

  const getMetaValue = (employeeId: string, field: keyof RosterMeta) => {
    const meta = rosterMeta.find(m => m.employee_id === employeeId && m.week_start === weekStartIso);
    return (meta ? (meta[field] as string) : "") ?? "";
  };

  const handleSubmitPayroll = async () => {
    if (onPayrollSubmit) {
      await onPayrollSubmit();
      return;
    }
    toast.success(`${rosterTitle} for period ending ${format(addDays(currentWeekStart, periodDays - 1), 'dd MMM yyyy')} has been submitted successfully!`);
  };

  const handleExportCSV = () => {
    const exportData = filteredEmployees.map(emp => {
      const row: any = {
        'Employee ID': emp.emp_id,
        'Name': `${emp.first_name} ${emp.last_name}`,
        'Department': emp.department,
      };

      weekDays.forEach(day => {
        const dayIso = format(day, 'yyyy-MM-dd');
        const shiftId = getRosterValue(emp, dayIso);
        const shift = shifts.find(s => s.id === shiftId);
        row[format(day, 'EEEE dd MMM')] = shift ? shift.label : 'To Be Rostered';
      });

      ROSTER_DEFINITIONS.filter(d => enabledDefinitions.includes(d.id)).forEach(def => {
        row[def.label] = getMetaValue(emp.id, def.id);
      });

      return row;
    });

    downloadCSV(exportData, `Roster_${format(addDays(currentWeekStart, periodDays - 1), 'yyyy-MM-dd')}.csv`);
    setShowExportOptions(false);
  };

  const handleExportPDF = (includeDefinitions: boolean = false) => {
    const title = `Roster Period: ${format(currentWeekStart, 'dd MMM')} - ${format(addDays(currentWeekStart, periodDays - 1), 'dd MMM yyyy')}`;
    const defs = ROSTER_DEFINITIONS.filter(d => enabledDefinitions.includes(d.id));
    
    const headers = [
      'Employee', 
      ...weekDays.map(d => format(d, 'EEE dd')),
      ...(includeDefinitions ? defs.map(d => d.label) : [])
    ];
    
    const rows: any[] = [];
    
    groupedEmployees.forEach(([dept, deptEmployees]) => {
      // Add Department Separator Row
      rows.push([
        { 
          content: dept.toUpperCase(), 
          colSpan: headers.length, 
          styles: { 
            fillColor: [79, 70, 229], // Indigo 600
            textColor: [255, 255, 255], 
            fontStyle: 'bold',
            halign: 'left',
            fontSize: 8,
            cellPadding: 3
          } 
        }
      ]);

      deptEmployees.forEach(emp => {
        const row = [
          `${emp.first_name} ${emp.last_name}`,
          ...weekDays.map(day => {
            const dayIso = format(day, 'yyyy-MM-dd');
            const shiftId = getRosterValue(emp, dayIso);
            const shift = shifts.find(s => s.id === shiftId);
            return shift ? shift.label : 'To Be Rostered';
          }),
          ...(includeDefinitions ? defs.map(def => getMetaValue(emp.id, def.id)) : [])
        ];
        rows.push(row);
      });
    });

    const filename = `Roster_${includeDefinitions ? 'Full_' : ''}${format(addDays(currentWeekStart, periodDays - 1), 'yyyy-MM-dd')}.pdf`;
    exportToPDF(title, headers, rows, filename);
    setShowExportOptions(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-4xl font-black text-slate-800 tracking-tight">{rosterTitle}</h2>
            <p className="text-sm text-slate-500 font-black uppercase tracking-widest">Period ending {format(addDays(currentWeekStart, periodDays - 1), 'dd MMM yyyy')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-1.5 p-1.5 bg-white/80 backdrop-blur-md rounded-2xl shadow-sm border border-slate-100 w-fit">
              {(['Automated', 'Hybrid', 'Manual'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setPayrollMode(mode)}
                  className={cn(
                    "px-4 py-2 rounded-xl font-bold text-xs transition-all flex items-center gap-2",
                    payrollMode === mode 
                      ? "bg-indigo-600 text-white shadow-md shadow-indigo-200" 
                      : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                  )}
                >
                  {mode}
                </button>
              ))}
            </div>
            <div className="relative">
              <Tooltip content="Export Roster">
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowExportOptions(!showExportOptions);
                  }}
                  className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-indigo-600 transition-all shadow-sm"
                >
                  <Download className="w-5 h-5" />
                </button>
              </Tooltip>
              {showExportOptions && (
                <div 
                  onClick={(e) => e.stopPropagation()}
                  className="absolute right-0 mt-2 w-48 bg-white rounded-2xl shadow-xl border border-slate-100 py-2 z-[100] animate-in fade-in slide-in-from-top-2 duration-200"
                >
                  <button 
                    onClick={handleExportCSV}
                    className="w-full px-4 py-2.5 text-left text-sm font-bold text-slate-600 hover:bg-indigo-50 hover:text-indigo-600 transition-colors flex items-center gap-3"
                  >
                    <FileText className="w-4 h-4" />
                    Export as CSV
                  </button>
                  <button 
                    onClick={() => handleExportPDF(false)}
                    className="w-full px-4 py-2.5 text-left text-sm font-bold text-slate-600 hover:bg-indigo-50 hover:text-indigo-600 transition-colors flex items-center gap-3"
                  >
                    <FileText className="w-4 h-4" />
                    PDF (Roster Only)
                  </button>
                  <button 
                    onClick={() => handleExportPDF(true)}
                    className="w-full px-4 py-2.5 text-left text-sm font-bold text-slate-600 hover:bg-indigo-50 hover:text-indigo-600 transition-colors flex items-center gap-3"
                  >
                    <FileText className="w-4 h-4" />
                    PDF (Full Report)
                  </button>
                </div>
              )}
            </div>
            <Tooltip content="Finalize and Submit Payroll">
              <button 
                onClick={handleSubmitPayroll}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl font-black text-sm bg-slate-800 text-white hover:bg-slate-900 shadow-xl shadow-slate-200 transition-all active:scale-95"
              >
                <CheckCircle2 className="w-4 h-4" />
                Submit Payroll
              </button>
            </Tooltip>
          </div>
        </div>

        <div className="flex flex-col md:flex-row items-center justify-between gap-4 bg-white/60 backdrop-blur-md p-2 rounded-2xl border border-slate-200/60 shadow-sm">
          <div className="relative w-full md:w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search employees by name, ID, or department..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border-none bg-transparent focus:outline-none focus:ring-0 text-sm font-medium placeholder:text-slate-400"
            />
          </div>
          <div className="flex items-center bg-white rounded-xl border border-slate-200 p-1 shadow-sm w-full md:w-auto justify-between md:justify-start">
            <button 
              onClick={() => onWeekChange(subDays(currentWeekStart, periodDays))}
              className="p-2 hover:bg-slate-50 rounded-lg transition-all active:scale-90"
            >
              <ChevronLeft className="w-4 h-4 text-slate-600" />
            </button>
            <div className="px-4 text-xs font-bold text-slate-600 uppercase tracking-widest whitespace-nowrap">
              {format(currentWeekStart, 'MMM dd')} - {format(addDays(currentWeekStart, periodDays - 1), 'MMM dd')}
            </div>
            <button 
              onClick={() => onWeekChange(addDays(currentWeekStart, periodDays))}
              className="p-2 hover:bg-slate-50 rounded-lg transition-all active:scale-90"
            >
              <ChevronRight className="w-4 h-4 text-slate-600" />
            </button>
          </div>
        </div>
      </div>
      <div className="bg-white rounded-[32px] shadow-2xl shadow-slate-200/50 border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-separate border-spacing-0">
            <thead>
              <tr className="bg-slate-50/80 backdrop-blur-sm text-slate-500 text-[10px] uppercase tracking-[0.15em] font-black">
                <th className="pl-10 pr-6 py-5 sticky left-0 bg-slate-50/95 backdrop-blur-md z-[120] border-r border-b border-slate-200 min-w-[255px] shadow-[4px_0_8px_-4px_rgba(0,0,0,0.05)]">
                  Employee Details
                </th>
                {weekDays.map((day, dayIndex) => {
                  const isSun = isSunday(day);
                  const isHol = isSAPublicHoliday(day);
                  const isTdy = isToday(day);
                  return (
                    <th key={day.toISOString()} className={cn(
                      "px-5 py-5 text-center min-w-[155px] border-b border-slate-200 transition-colors relative",
                      dayIndex === 0 && "min-w-[195px]",
                      isSun && "bg-emerald-100 text-emerald-900",
                      isHol && "bg-amber-100 text-amber-900",
                      isTdy && "bg-indigo-50/50 text-indigo-700"
                    )}>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[11px] font-black">{format(day, 'EEEE')}</span>
                        <span className="text-[10px] font-bold opacity-60 font-mono">{format(day, 'dd MMM')}</span>
                        {isHol && (
                          <div className="mt-1.5 px-2 py-0.5 rounded-md bg-amber-200 text-[8px] font-black text-amber-900 inline-block mx-auto">
                            Public Holiday
                          </div>
                        )}
                        {isTdy && (
                          <div className="absolute top-0 left-0 right-0 h-1 bg-indigo-500" />
                        )}
                        {isTdy && (
                          <div className="mt-1 px-2 py-0.5 rounded-md bg-indigo-100 text-[8px] font-black text-indigo-700 inline-block mx-auto">
                            TODAY
                          </div>
                        )}
                      </div>
                    </th>
                  );
                })}
                {ROSTER_DEFINITIONS.filter(d => enabledDefinitions.includes(d.id)).map(def => (
                  <th key={def.id} className="px-4 py-5 text-center min-w-[130px] bg-slate-100/30 border-b border-slate-200 font-black text-slate-400">
                    {def.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {groupedEmployees.map(([dept, deptEmployees]) => (
                <React.Fragment key={dept}>
                  <tr className="bg-indigo-500">
                    <td colSpan={totalVisibleColumns} className="p-0 border-b border-indigo-600/20">
                      <div className="flex items-center h-10">
                        <div className="sticky left-0 flex items-center gap-3 pl-10 pr-6 bg-indigo-500 h-full z-[110] border-r border-indigo-600/20">
                          <div className="w-1.5 h-3 bg-white rounded-full" />
                          <span className="text-[10px] font-black text-white uppercase tracking-[0.25em] whitespace-nowrap">{dept}</span>
                        </div>
                        <div className="flex-1 h-full bg-indigo-500" />
                      </div>
                    </td>
                  </tr>
                  {deptEmployees.map((emp, idx) => (
                    <tr key={emp.id} className={cn(
                      "group transition-all duration-200",
                      idx % 2 === 0 ? "bg-white" : "bg-slate-50/30",
                      "hover:bg-indigo-50"
                    )}>
                      <td className={cn(
                        "pl-10 pr-6 py-5 sticky left-0 z-[100] border-r border-slate-200 shadow-[4px_0_8px_-4px_rgba(0,0,0,0.05)] transition-colors",
                        idx % 2 === 0 ? "bg-white" : "bg-slate-50",
                        "group-hover:bg-indigo-50"
                      )}>
                        <div className="flex flex-col gap-1">
                          <span className="text-[15px] font-black text-slate-800 tracking-tight leading-none">{emp.first_name} {emp.last_name}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{emp.emp_id}</span>
                          </div>
                        </div>
                      </td>
                      {weekDays.map((day, dayIndex) => {
                        const dayIso = format(day, 'yyyy-MM-dd');
                        const val = getRosterValue(emp, dayIso);
                        const editable = isRosterCellEditable(dayIso);
                        const isSun = isSunday(day);
                        const isHol = isSAPublicHoliday(day);
                        const isTdy = isToday(day);
                        
                        return (
                          <td key={dayIso} className={cn(
                            "px-3 py-5 transition-colors relative overflow-visible",
                            dayIndex === 0 && "pl-10 min-w-[195px]",
                            isSun && "bg-emerald-100/70",
                            isHol && "bg-amber-100/80",
                            isTdy && "bg-indigo-50/10",
                            "border-r border-slate-100/50 last:border-r-0"
                          )}>
                            <div className="relative group/select overflow-visible">
                              <select
                                value={val}
                                onChange={(e) => handleShiftSelectChange(emp, dayIso, e.target.value || null)}
                                disabled={!editable}
                                className={cn(
                                  "relative w-full text-[11px] font-black border-2 rounded-xl px-3 py-2.5 transition-all appearance-none outline-none text-center tracking-wider disabled:cursor-not-allowed disabled:opacity-60",
                                  editable
                                    ? (val ? "border-slate-200 text-slate-900 bg-white shadow-sm hover:border-slate-300 cursor-pointer" : "border-slate-200 text-slate-900 bg-slate-50 hover:border-slate-300 cursor-pointer")
                                    : "border-slate-200 text-slate-500 bg-slate-50/70 cursor-not-allowed opacity-80"
                                )}
                              >
                                <option value="" className="font-sans">To Be Rostered</option>
                                {orderedShifts.map(s => {
                                  const blocked = isShiftBlockedForCell(emp, dayIso, s.id);
                                  return (
                                    <option
                                      key={s.id}
                                      value={s.id}
                                      className={cn('font-sans', blocked ? 'text-slate-400' : 'text-slate-900')}
                                      aria-disabled={blocked}
                                    >
                                      {blocked ? `${s.label} (Overlaps previous shift)` : s.label}
                                    </option>
                                  );
                                })}
                              </select>
                              <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none opacity-0 group-hover/select:opacity-100 transition-opacity">
                                <ChevronRight className="w-3 h-3 text-indigo-400 rotate-90" />
                              </div>
                            </div>
                          </td>
                        );
                      })}
                      
                      {/* Meta Fields */}
                      {ROSTER_DEFINITIONS.filter(d => enabledDefinitions.includes(d.id)).map(def => (
                        <td key={def.id} className="px-3 py-5 bg-slate-100/10 border-r border-slate-100 last:border-r-0">
                          <div className="relative">
                            <input 
                              type="text" 
                              inputMode={def.id === 'notes' ? 'text' : 'decimal'}
                              pattern={def.id === 'notes' ? undefined : '\d*(\.\d{0,2})?'}
                              title={def.id === 'notes' ? 'Notes can contain free text' : 'Numbers only, up to 2 decimal places'}
                              maxLength={def.id === 'notes' ? 250 : 12}
                              placeholder={def.placeholder}
                              value={getMetaValue(emp.id, def.id)}
                              onChange={(e) => onUpdateMeta(emp.id, def.id, sanitizeDefinitionValue(def.id, e.target.value))}
                              disabled={isPeriodLocked}
                              className="w-full text-[11px] font-bold border-2 border-slate-100 rounded-xl px-3 py-2.5 bg-white/50 focus:bg-white focus:border-slate-300 focus:ring-4 focus:ring-slate-200/50 outline-none transition-all placeholder:text-slate-300 font-mono" 
                            />
                          </div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
