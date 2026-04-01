import React, { useEffect, useMemo, useState } from 'react';
import { format, addDays, subDays } from 'date-fns';
import { ChevronLeft, ChevronRight, Download, FileText, Search, Loader2 } from 'lucide-react';
import { Employee, Shift, RosterAssignment, RosterMeta, RosterDefinition, PayrollSubmission } from '../types';
import { calculateEmployeePayroll } from '../services/PayrollService';
import { cn } from '../lib/utils';
import { Tooltip } from './Tooltip';
import { downloadCSV, exportToPDF } from '../utils/exportUtils';
import { toast } from 'sonner';

const ROSTER_DEFINITIONS: { id: RosterDefinition; label: string }[] = [
  { id: 'salary_advance', label: 'Advance' },
  { id: 'shortages', label: 'Shortage' },
  { id: 'unpaid_hours', label: 'Unpaid Hours' },
  { id: 'staff_loan', label: 'Loan' },
  { id: 'uniform', label: 'Uniform' },
  { id: 'overthrows', label: 'Overthrows' },
  { id: 'oil_spill', label: 'Oil Spill' },
  { id: 'stock_shortage', label: 'Stock Shortage' },
  { id: 'annual_bonus', label: 'Annual Bonus' },
  { id: 'incentive_bonus', label: 'Incentive Bonus' },
  { id: 'data_allowance', label: 'Data Allowance' },
  { id: 'night_shift_allowance', label: 'Night Shift Allowance' },
  { id: 'medical_allowance', label: 'Medical Allowance' },
  { id: 'mibco_health_insurance', label: 'Mibco Health Insurance' },
  { id: 'health_insurance', label: 'Health Insurance' },
  { id: 'garnishee', label: 'Garnishee' },
  { id: 'cell_phone_payment', label: 'Cell Phone Payment' },
  { id: 'income_tax_registration', label: 'Income Tax Registration' },
  { id: 'performance_incentive', label: 'Performance Incentive' },
  { id: 'commission', label: 'Commission' },
  { id: 'sales_commission', label: 'Sales Commission' },
  { id: 'notes', label: 'Notes' },
];

interface TimesheetSectionProps {
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
  payrollSubmissions?: PayrollSubmission[];
  rosterTitle?: string;
  onWeekChange: (date: Date) => void;
  onPayrollSubmit?: () => void | Promise<void>;
  isLoading?: boolean;
}

const formatValue = (val: number | string | undefined) => {
  if (val === undefined || val === null || val === 0 || val === '0' || val === '0.00') return '-';
  if (typeof val === 'number') return val.toFixed(2);
  const numeric = Number(val);
  if (Number.isFinite(numeric)) return numeric.toFixed(2);
  return String(val || '').trim() || '-';
};

export const TimesheetSection: React.FC<TimesheetSectionProps> = ({
  employees,
  shifts,
  roster,
  rosterMeta,
  currentWeekStart,
  rosterDuration = '1_week',
  enabledDefinitions = ['salary_advance', 'shortages', 'unpaid_hours', 'staff_loan', 'notes'],
  payrollSubmissions = [],
  rosterTitle = 'Weekly Roster',
  onWeekChange,
  onPayrollSubmit,
  isLoading = false,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [showExportOptions, setShowExportOptions] = useState(false);
  const periodDays = rosterDuration === '2_weeks' ? 14 : rosterDuration === '1_month' ? 28 : 7;
  const weekDays = Array.from({ length: periodDays }, (_, i) => addDays(currentWeekStart, i));
  const visibleDefinitions = useMemo(
    () => ROSTER_DEFINITIONS.filter(d => enabledDefinitions.includes(d.id)),
    [enabledDefinitions]
  );
  const currentPeriodStartIso = format(currentWeekStart, 'yyyy-MM-dd');
  const currentPeriodEndIso = format(addDays(currentWeekStart, periodDays - 1), 'yyyy-MM-dd');

  useEffect(() => {
    if (!showExportOptions) return;
    const handleClick = () => setShowExportOptions(false);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [showExportOptions]);

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

  const getPayrollForEmployee = (employeeId: string) => calculateEmployeePayroll(employeeId, weekDays, roster, shifts, rosterMeta);

  const handleGoToPrevious = () => onWeekChange(subDays(currentWeekStart, periodDays));

  const handleGoToNext = () => onWeekChange(addDays(currentWeekStart, periodDays));

  const buildExportRows = (includeDefinitions: boolean) => {
    return filteredEmployees.map(emp => {
      const payroll = getPayrollForEmployee(emp.id);
      const row: Record<string, string> = {
        'Employee ID': emp.emp_id,
        'Name': `${emp.first_name} ${emp.last_name}`,
        'Department': emp.department || 'Unassigned',
        'Normal (45h)': formatValue(payroll.normalTime),
        'OT 1.5': formatValue(payroll.ot15),
        'Sun 1.5': formatValue(payroll.sun15),
        'Sun 2.0': formatValue(payroll.sun20),
        'Public Holiday': formatValue(payroll.pph),
        'Annual Leave': formatValue(payroll.leave),
        'Sick Leave': formatValue(payroll.sick),
        'Family Leave': formatValue(payroll.family),
      };

      if (includeDefinitions) {
        visibleDefinitions.forEach(def => {
          row[def.label] = formatValue(payroll[def.id]);
        });
      }

      return row;
    });
  };

  const handleExportCSV = () => {
    downloadCSV(buildExportRows(true), `Timesheet_${format(addDays(currentWeekStart, periodDays - 1), 'yyyy-MM-dd')}.csv`);
    setShowExportOptions(false);
  };

  const handleExportPDF = async (includeDefinitions: boolean) => {
    const headers = [
      'Employee',
      'Department',
      'Normal (45h)',
      'OT 1.5',
      'Sun 1.5',
      'Sun 2.0',
      'Public Holiday',
      ...(includeDefinitions ? ['Leave', 'Annual Leave', 'Sick Leave', 'Family Leave'] : []),
      ...(includeDefinitions ? ['Definitions', ...visibleDefinitions.map(def => def.label)] : []),
    ];

    const leaveSeparatorIndex = includeDefinitions ? 7 : -1;
    const definitionSeparatorIndex = includeDefinitions ? 11 : -1;

    const rows: any[] = [];
    groupedEmployees.forEach(([dept, deptEmployees]) => {
      rows.push([
        {
          content: dept.toUpperCase(),
          colSpan: headers.length,
          styles: {
            fillColor: [79, 70, 229],
            textColor: [255, 255, 255],
            fontStyle: 'bold',
            halign: 'left',
            fontSize: 8,
            cellPadding: 3,
          },
        },
      ]);

      deptEmployees.forEach(emp => {
        const payroll = getPayrollForEmployee(emp.id);
        rows.push([
          `${emp.first_name} ${emp.last_name}`,
          emp.department || 'Unassigned',
          formatValue(payroll.normalTime),
          formatValue(payroll.ot15),
          formatValue(payroll.sun15),
          formatValue(payroll.sun20),
          formatValue(payroll.pph),
          ...(includeDefinitions ? [
            '',
            formatValue(payroll.leave),
            formatValue(payroll.sick),
            formatValue(payroll.family),
          ] : []),
          ...(includeDefinitions ? ['', ...visibleDefinitions.map(def => formatValue(payroll[def.id]))] : []),
        ]);
      });
    });

    const baseColumnStyles: Record<number, any> = {
      0: { cellWidth: 38 },
      1: { cellWidth: 28 },
      2: { cellWidth: 17 },
      3: { cellWidth: 16 },
      4: { cellWidth: 16 },
      5: { cellWidth: 16 },
      6: { cellWidth: 21 },
    };

    if (includeDefinitions) {
      baseColumnStyles[leaveSeparatorIndex] = { cellWidth: 10 };
      baseColumnStyles[8] = { cellWidth: 17 };
      baseColumnStyles[9] = { cellWidth: 17 };
      baseColumnStyles[10] = { cellWidth: 18 };
      baseColumnStyles[definitionSeparatorIndex] = { cellWidth: 14 };
      visibleDefinitions.forEach((_, idx) => {
        baseColumnStyles[definitionSeparatorIndex + 1 + idx] = { cellWidth: 20 };
      });
    }

    await exportToPDF(
      `Timesheet Period: ${format(currentWeekStart, 'dd MMM')} - ${format(addDays(currentWeekStart, periodDays - 1), 'dd MMM yyyy')}`,
      headers,
      rows,
      `Timesheet_${includeDefinitions ? 'Full_' : ''}${format(addDays(currentWeekStart, periodDays - 1), 'yyyy-MM-dd')}.pdf`,
      {
        format: includeDefinitions ? 'a3' : 'a4',
        styles: {
          fontSize: includeDefinitions ? 5.5 : 7,
          cellPadding: includeDefinitions ? 1.8 : 2.8,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
        },
        headStyles: {
          fontSize: includeDefinitions ? 5.5 : 7,
          cellPadding: includeDefinitions ? 1.8 : 2.8,
        },
        margin: includeDefinitions ? { top: 35, right: 6, bottom: 10, left: 6 } : { top: 35, right: 10, bottom: 10, left: 10 },
        columnStyles: baseColumnStyles,
        didParseCell: (data: any) => {
          const columnIndex = data.column.index;

          if (includeDefinitions && columnIndex === leaveSeparatorIndex) {
            data.cell.styles.fillColor = [224, 231, 255];
            data.cell.styles.textColor = [67, 56, 202];
            data.cell.styles.fontStyle = 'bold';
            data.cell.styles.halign = 'center';
          }

          if (includeDefinitions && columnIndex === definitionSeparatorIndex) {
            data.cell.styles.fillColor = [237, 233, 254];
            data.cell.styles.textColor = [109, 40, 217];
            data.cell.styles.fontStyle = 'bold';
            data.cell.styles.halign = 'center';
          }
        },
      }
    );
    setShowExportOptions(false);
  };

  return (
    <div className="dashboard-section-shell flex flex-col gap-6 min-h-0">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-4xl font-black text-slate-800 tracking-tight">Payroll Timesheet</h2>
            <p className="text-sm text-slate-500 font-black uppercase tracking-widest">
              {rosterTitle.replace('Roster', 'Timesheet')} • Period ending {format(addDays(currentWeekStart, periodDays - 1), 'dd MMM yyyy')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <Tooltip content="Export Timesheet">
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
                  className="absolute right-0 mt-2 w-52 bg-white rounded-2xl shadow-xl border border-slate-100 py-2 z-[100] animate-in fade-in slide-in-from-top-2 duration-200"
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
                    Export as PDF
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
          </div>
        </div>


        {isLoading && (
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-slate-500 px-1">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-500" />
            Loading timesheet...
          </div>
        )}

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
              onClick={handleGoToPrevious}
              className="p-2 hover:bg-slate-50 rounded-lg transition-all active:scale-90"
            >
              <ChevronLeft className="w-4 h-4 text-slate-600" />
            </button>
            <div className="px-4 text-xs font-bold text-slate-600 uppercase tracking-widest whitespace-nowrap">
              {format(currentWeekStart, 'MMM dd')} - {format(addDays(currentWeekStart, periodDays - 1), 'MMM dd')}
            </div>
            <button
              onClick={handleGoToNext}
              className="p-2 rounded-lg transition-all hover:bg-slate-50 active:scale-90"
            >
              <ChevronRight className="w-4 h-4 text-slate-600" />
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-[32px] shadow-2xl shadow-slate-200/50 border border-slate-200 overflow-hidden flex-1 min-h-0 flex flex-col">
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto hide-horizontal-scrollbar isolate bg-white">
          <table className="w-full text-left border-separate border-spacing-0 min-w-[1200px]">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-[10px] uppercase tracking-[0.15em] font-black">
                <th className="pl-10 pr-6 py-5 sticky top-0 left-0 bg-slate-50 z-[220] border-r border-b border-slate-200 min-w-[255px] shadow-[4px_0_8px_-4px_rgba(0,0,0,0.05)] whitespace-nowrap">
                  Employee Details
                </th>
                <th className="px-3 py-5 text-center min-w-[110px] border-b border-slate-200 whitespace-nowrap sticky top-0 z-[200] bg-slate-50">Normal (45h)</th>
                <th className="px-3 py-5 text-center min-w-[90px] border-b border-slate-200 whitespace-nowrap sticky top-0 z-[200] bg-slate-50">OT 1.5</th>
                <th className="px-3 py-5 text-center min-w-[90px] border-b border-slate-200 whitespace-nowrap sticky top-0 z-[200] bg-slate-50">Sun 1.5</th>
                <th className="px-3 py-5 text-center min-w-[90px] border-b border-slate-200 whitespace-nowrap sticky top-0 z-[200] bg-slate-50">Sun 2.0</th>
                <th className="px-3 py-5 text-center min-w-[120px] border-b border-slate-200 whitespace-nowrap sticky top-0 z-[200] bg-slate-50">Public Holiday</th>
                <th className="w-10 min-w-[40px] px-0 py-0 bg-amber-300 border-x border-amber-400/60 align-middle sticky top-0 z-[200]"></th>
                <th className="px-3 py-5 text-center min-w-[110px] border-b border-slate-200 bg-slate-50 whitespace-nowrap sticky top-0 z-[200]">Annual Leave</th>
                <th className="px-3 py-5 text-center min-w-[110px] border-b border-slate-200 bg-slate-50 whitespace-nowrap sticky top-0 z-[200]">Sick Leave</th>
                <th className="px-3 py-5 text-center min-w-[110px] border-b border-slate-200 bg-slate-50 whitespace-nowrap sticky top-0 z-[200]">Family Leave</th>
                <th className="w-10 min-w-[40px] px-0 py-0 bg-indigo-300 border-x border-indigo-400/60 align-middle sticky top-0 z-[200]"></th>
                {visibleDefinitions.map(def => (
                  <th key={def.id} className="px-3 py-5 text-center min-w-[110px] bg-slate-100 border-b border-slate-200 font-black text-slate-500 whitespace-nowrap sticky top-0 z-[200]">
                    {def.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {groupedEmployees.map(([dept, deptEmployees]) => (
                <React.Fragment key={dept}>
                  <tr className="bg-indigo-500">
                    <td colSpan={11 + visibleDefinitions.length} className="p-0 border-b border-indigo-600/20">
                      <div className="flex items-center h-10">
                        <div className="sticky left-0 flex items-center gap-3 pl-10 pr-6 bg-indigo-500 h-full z-[90] border-r border-indigo-600/20">
                          <div className="w-1.5 h-3 bg-white rounded-full" />
                          <span className="text-[10px] font-black text-white uppercase tracking-[0.25em] whitespace-nowrap">{dept}</span>
                        </div>
                        <div className="flex-1 h-full bg-indigo-500" />
                      </div>
                    </td>
                  </tr>
                  {deptEmployees.map((emp, idx) => {
                    const payroll = getPayrollForEmployee(emp.id);
                    return (
                      <tr
                        key={emp.id}
                        className={cn(
                          'group transition-all duration-200',
                          idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/30',
                          'hover:bg-indigo-50'
                        )}
                      >
                        <td
                          className={cn(
                            'pl-10 pr-6 py-5 sticky left-0 z-[80] border-r border-slate-200 shadow-[4px_0_8px_-4px_rgba(0,0,0,0.05)] transition-colors',
                            idx % 2 === 0 ? 'bg-white' : 'bg-slate-50',
                            'group-hover:bg-indigo-50'
                          )}
                        >
                          <div className="flex flex-col gap-1">
                            <span className="block text-sm font-bold text-slate-800">{emp.first_name} {emp.last_name}</span>
                            <span className="block text-xs font-medium text-slate-500 tracking-[1px]">{emp.emp_id}</span>
                          </div>
                        </td>
                        <td className="px-3 py-5 text-center text-sm font-black text-slate-700 border-r border-slate-100/50 whitespace-nowrap">{formatValue(payroll.normalTime)}</td>
                        <td className="px-3 py-5 text-center text-sm text-indigo-600 font-black border-r border-slate-100/50 whitespace-nowrap">{formatValue(payroll.ot15)}</td>
                        <td className="px-3 py-5 text-center text-sm text-emerald-600 font-black border-r border-slate-100/50 whitespace-nowrap">{formatValue(payroll.sun15)}</td>
                        <td className="px-3 py-5 text-center text-sm text-emerald-700 font-black border-r border-slate-100/50 whitespace-nowrap">{formatValue(payroll.sun20)}</td>
                        <td className="px-3 py-5 text-center text-sm text-blue-600 font-black border-r border-slate-200 whitespace-nowrap">{formatValue(payroll.pph)}</td>
                        
                        {idx === 0 && (
                          <td rowSpan={deptEmployees.length} className="w-10 min-w-[40px] bg-amber-200/50 border-x border-amber-300/50 align-middle p-0">
                            <div className="flex items-center justify-center h-full min-h-[100px]">
                              <span className="text-[11px] font-black text-amber-950 uppercase tracking-[0.2em]" style={{ writingMode: 'vertical-rl', textOrientation: 'mixed', transform: 'rotate(180deg)' }}>Leave</span>
                            </div>
                          </td>
                        )}

                        <td className="px-3 py-5 text-center text-sm text-slate-600 font-black bg-slate-50/40 border-r border-slate-100/50 whitespace-nowrap">{formatValue(payroll.leave)}</td>
                        <td className="px-3 py-5 text-center text-sm text-slate-600 font-black bg-slate-50/40 border-r border-slate-100/50 whitespace-nowrap">{formatValue(payroll.sick)}</td>
                        <td className="px-3 py-5 text-center text-sm text-slate-600 font-black bg-slate-50/40 border-r border-slate-200 whitespace-nowrap">{formatValue(payroll.family)}</td>
                        
                        {idx === 0 && (
                          <td rowSpan={deptEmployees.length} className="w-10 min-w-[40px] bg-indigo-200/50 border-x border-indigo-300/50 align-middle p-0">
                            <div className="flex items-center justify-center h-full min-h-[100px]">
                              <span className="text-[11px] font-black text-indigo-950 uppercase tracking-[0.2em]" style={{ writingMode: 'vertical-rl', textOrientation: 'mixed', transform: 'rotate(180deg)' }}>Definitions</span>
                            </div>
                          </td>
                        )}

                        {visibleDefinitions.map(def => (
                          <td key={def.id} className="px-3 py-5 text-center text-sm text-rose-500 font-bold border-r border-slate-100/50 last:border-r-0 bg-slate-100/10 whitespace-nowrap">
                            {formatValue(payroll[def.id])}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
