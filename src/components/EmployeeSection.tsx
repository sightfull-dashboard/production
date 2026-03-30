import React, { useState, useMemo } from 'react';
import { Search, Plus, Download, Upload, Edit3, Trash2, Filter, UserMinus, Folder, XCircle, CheckCircle2, AlertCircle, X, RotateCcw } from 'lucide-react';
import { Employee } from '../types';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import { FilesSection } from './FilesSection';
import { motion, AnimatePresence } from 'motion/react';
import { Tooltip } from './Tooltip';

interface EmployeeSectionProps {
  employees: Employee[];
  onAdd: () => void;
  onEdit: (emp: Employee) => void;
  onDelete: (id: string) => void;
  onOffboard: (emp: Employee) => void;
  onImport: (data: any[]) => void;
  onRestore?: (emp: Employee) => void;
  canImportCsv?: boolean;
  fileVaultReadOnly?: boolean;
}

import { downloadCSV } from '../utils/exportUtils';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

export const EmployeeSection: React.FC<EmployeeSectionProps> = ({ employees, onAdd, onEdit, onDelete, onOffboard, onImport, onRestore, canImportCsv = false, fileVaultReadOnly = false }) => {
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [titleFilter, setTitleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'active' | 'offboarded' | ''>('active');
  const [viewingFilesEmployee, setViewingFilesEmployee] = useState<Employee | null>(null);
  const [importData, setImportData] = useState<any[]>([]);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const uniqueDepts = useMemo(() => {
    const depts = new Set(employees.map(emp => emp.department).filter(Boolean));
    return Array.from(depts).sort();
  }, [employees]);

  const uniqueTitles = useMemo(() => {
    const titles = new Set(employees.map(emp => emp.job_title).filter(Boolean));
    return Array.from(titles).sort();
  }, [employees]);

  const filtered = employees.filter(emp => {
    const matchesSearch = (emp.first_name + ' ' + emp.last_name).toLowerCase().includes(search.toLowerCase()) || emp.emp_id.toLowerCase().includes(search.toLowerCase());
    const matchesDept = !deptFilter || emp.department === deptFilter;
    const matchesTitle = !titleFilter || emp.job_title === titleFilter;
    const matchesStatus = !statusFilter || (emp.status || 'active') === statusFilter;
    return matchesSearch && matchesDept && matchesTitle && matchesStatus;
  });

  const handleExport = () => {
    const data = filtered.map(emp => ({
      'Employee ID': emp.emp_id,
      'First Name': emp.first_name,
      'Last Name': emp.last_name,
      'Date of Birth': emp.dob,
      'ID Number': emp.id_number || '',
      'Passport': emp.passport || '',
      'Email': emp.email || '',
      'Cell': emp.cell || '',
      'Start Date': emp.start_date,
      'Street Number': emp.street_number || '',
      'Address Line 1': emp.address1 || '',
      'Address Line 2': emp.address2 || '',
      'Address Line 3': emp.address3 || '',
      'Postal Code': emp.postal_code || '',
      'Tax Number': emp.tax_number || '',
      'Bank Name': emp.bank_name || '',
            'Account Number': emp.account_no || '',
      'Account Type': emp.account_type || '',
      'PAYE Credit': emp.paye_credit || '',
      'Job Title': emp.job_title,
      'Department': emp.department,
      'Last Date Worked': emp.last_worked_date || '-',
      'MIBCO': emp.ismibco || '',
      'Union': emp.isunion || '',
      'Union Name': emp.union_name || '',
      'Annual Leave': emp.annual_leave || 0,
      'Sick Leave': emp.sick_leave || 0,
      'Family Leave': emp.family_leave || 0
    }));
    downloadCSV(data, 'Employees.csv');
  };

  const openImportPreview = (rows: any[]) => {
    setImportData(rows);
    setIsImportModalOpen(true);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const fileName = file.name.toLowerCase();
    const isExcelFile = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');

    if (isExcelFile) {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const data = event.target?.result;
          if (!data) throw new Error('Could not read the selected spreadsheet file.');
          const workbook = XLSX.read(data, { type: 'array', cellDates: true });
          const firstSheetName = workbook.SheetNames[0];
          if (!firstSheetName) throw new Error('No worksheet found in the spreadsheet.');
          const worksheet = workbook.Sheets[firstSheetName];
          const rows = XLSX.utils.sheet_to_json(worksheet, {
            defval: '',
            raw: false,
            dateNF: 'yyyy-mm-dd',
          });
          openImportPreview(rows as any[]);
        } catch (err) {
          console.error('Spreadsheet Parse Error:', err);
          toast.error(`Failed to parse spreadsheet file: ${err instanceof Error ? err.message : 'Unknown error'}`);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      };
      reader.onerror = () => {
        toast.error('Failed to read spreadsheet file.');
        if (fileInputRef.current) fileInputRef.current.value = '';
      };
      reader.readAsArrayBuffer(file);
      return;
    }

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        openImportPreview(results.data as any[]);
      },
      error: (err) => {
        console.error('CSV Parse Error:', err);
        toast.error(`Failed to parse CSV file: ${err.message || 'Unknown error'}`);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h2 className="text-3xl sm:text-4xl font-black text-slate-800 tracking-tight">Employee Records</h2>
        <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search employees..." 
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white/50 focus:outline-none focus:ring-2 focus:ring-indigo-600/20 text-sm font-medium"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button 
            onClick={onAdd}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition-all active:scale-95"
          >
            <Plus className="w-4 h-4" />
            Add Employee
          </button>
        </div>
      </div>

      <div className="bg-white/80 backdrop-blur-md rounded-[24px] sm:rounded-[32px] shadow-xl shadow-indigo-100/20 border border-white/20 overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3 sm:gap-4">
            <span className="text-[10px] sm:text-xs font-black text-slate-400 uppercase tracking-widest">{filtered.length} Employees</span>
            <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-1.5">
              <Filter className="w-3 h-3 text-slate-400" />
              <select 
                className="text-[10px] font-black uppercase tracking-wider focus:outline-none bg-transparent appearance-none pr-4"
                value={deptFilter}
                onChange={(e) => setDeptFilter(e.target.value)}
              >
                <option value="">All Departments</option>
                {uniqueDepts.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-1.5">
              <Filter className="w-3 h-3 text-slate-400" />
              <select 
                className="text-[10px] font-black uppercase tracking-wider focus:outline-none bg-transparent appearance-none pr-4"
                value={titleFilter}
                onChange={(e) => setTitleFilter(e.target.value)}
              >
                <option value="">All Job Titles</option>
                {uniqueTitles.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-1.5">
              <Filter className="w-3 h-3 text-slate-400" />
              <select 
                className="text-[10px] font-black uppercase tracking-wider focus:outline-none bg-transparent appearance-none pr-4"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
              >
                <option value="">All Status</option>
                <option value="active">Active</option>
                <option value="offboarded">Off-boarded</option>
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Tooltip content="Export CSV">
              <button 
                onClick={handleExport}
                className="p-2.5 rounded-xl border border-slate-200 hover:bg-white transition-all text-slate-500 hover:text-indigo-600 shadow-sm"
              >
                <Download className="w-4 h-4" />
              </button>
            </Tooltip>
            {canImportCsv && (
              <>
                <Tooltip content="Import Employees">
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="p-2.5 rounded-xl border border-slate-200 hover:bg-white transition-all text-slate-500 hover:text-indigo-600 shadow-sm"
                  >
                    <Upload className="w-4 h-4" />
                  </button>
                </Tooltip>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileUpload} 
                  accept=".csv,.xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" 
                  className="hidden" 
                />
              </>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 text-slate-500 text-[10px] uppercase tracking-widest font-black">
                <th className="px-6 py-5">ID</th>
                <th className="px-6 py-5">Name</th>
                <th className="px-6 py-5">Department</th>
                <th className="px-6 py-5">Job Title</th>
                <th className="px-6 py-5">Status</th>
                <th className="px-6 py-5">Last Date Worked</th>
                <th className="px-6 py-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(emp => (
                <tr key={emp.id} className="hover:bg-indigo-50/30 transition-colors group">
                  <td className="px-6 py-5 text-xs font-mono text-slate-400">{emp.emp_id}</td>
                  <td className="px-6 py-5">
                    <div className="flex flex-col">
                      <span className="text-sm font-bold text-slate-800">{emp.first_name} {emp.last_name}</span>
                      <span className="block text-xs font-medium text-slate-500 tracking-[1px]">{emp.email}</span>
                    </div>
                  </td>
                  <td className="px-6 py-5">
                    <span className="px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-600 text-[10px] font-black uppercase tracking-widest">
                      {emp.department}
                    </span>
                  </td>
                  <td className="px-6 py-5 text-sm text-slate-600 font-bold">{emp.job_title}</td>
                  <td className="px-6 py-5">
                    <div className="flex flex-col gap-1">
                      <span className={cn(
                        "w-fit px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest",
                        emp.status === 'offboarded' 
                          ? "bg-rose-50 text-rose-600" 
                          : "bg-emerald-50 text-emerald-600"
                      )}>
                        {emp.status || 'active'}
                      </span>
                      {emp.status === 'offboarded' && emp.delete_reason && (
                        <span className="text-[11px] font-semibold text-slate-500">Reason: {emp.delete_reason}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-5 text-sm font-black text-slate-700">{emp.last_worked_date || emp.last_worked ? String(emp.last_worked_date || emp.last_worked) : '-'}</td>
                  <td className="px-6 py-5 text-right">
                    <div className="flex items-center justify-end gap-1 transition-all">
                      <Tooltip content="Edit Employee">
                        <button 
                          onClick={() => onEdit(emp)}
                          className="p-2 hover:bg-indigo-50 rounded-xl text-indigo-400 hover:text-indigo-600 transition-colors"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                      </Tooltip>
                      {emp.status !== 'offboarded' && (
                        <Tooltip content="Off-board Employee">
                          <button 
                            onClick={() => onOffboard(emp)}
                            className="p-2 hover:bg-rose-50 rounded-xl text-rose-400 hover:text-rose-600 transition-colors"
                          >
                            <UserMinus className="w-4 h-4" />
                          </button>
                        </Tooltip>
                      )}
                      {emp.status === 'offboarded' && onRestore && (
                        <Tooltip content="Restore Employee">
                          <button 
                            onClick={() => onRestore(emp)}
                            className="p-2 hover:bg-emerald-50 rounded-xl text-emerald-500 hover:text-emerald-700 transition-colors"
                          >
                            <RotateCcw className="w-4 h-4" />
                          </button>
                        </Tooltip>
                      )}
                      <Tooltip content="Delete Employee">
                        <button 
                          onClick={() => onDelete(emp.id)}
                          className="p-2 hover:bg-rose-50 rounded-xl text-rose-400 hover:text-rose-600 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </Tooltip>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Import Modal */}
      <AnimatePresence>
        {isImportModalOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsImportModalOpen(false)}
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100]"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed left-4 right-4 bottom-4 sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 w-auto sm:w-full sm:max-w-5xl bg-white rounded-[32px] sm:rounded-[40px] shadow-2xl z-[101] overflow-hidden h-[85vh] flex flex-col"
            >
              <div className="p-6 sm:p-8 border-b border-slate-100 flex items-center justify-between shrink-0 bg-white">
                <div>
                  <h3 className="text-xl sm:text-2xl font-black text-slate-800">Import Preview</h3>
                  <div className="flex items-center gap-3 mt-2">
                    <span className="px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-700 text-[10px] font-black uppercase tracking-widest">
                      {importData.filter(row => (row.emp_id || row['Employee ID']) && (row.first_name || row['First Name']) && (row.last_name || row['Last Name'])).length} Valid
                    </span>
                    <span className="px-2.5 py-1 rounded-lg bg-rose-100 text-rose-700 text-[10px] font-black uppercase tracking-widest">
                      {importData.filter(row => !(row.emp_id || row['Employee ID']) || !(row.first_name || row['First Name']) || !(row.last_name || row['Last Name'])).length} Errors
                    </span>
                  </div>
                </div>
                <button onClick={() => setIsImportModalOpen(false)} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>
              
              <div className="flex-1 overflow-hidden bg-white flex flex-col">
                <div className="flex-1 overflow-y-auto">
                  <table className="w-full text-left border-collapse relative">
                      <thead className="sticky top-0 z-10 bg-slate-50/90 backdrop-blur-md shadow-sm">
                        <tr className="border-b border-slate-100">
                        <th className="py-3 px-4 text-[10px] font-black text-slate-400 uppercase tracking-widest w-16">Status</th>
                        <th className="py-3 px-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Employee</th>
                        <th className="py-3 px-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Role</th>
                        <th className="py-3 px-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Issues</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {importData.map((row, index) => {
                        const empId = row.emp_id || row['Employee ID'];
                        const firstName = row.first_name || row['First Name'];
                        const lastName = row.last_name || row['Last Name'];
                        
                        const errors = [];
                        if (!empId) errors.push("Missing ID");
                        if (!firstName) errors.push("Missing First Name");
                        if (!lastName) errors.push("Missing Last Name");
                        
                        const isValid = errors.length === 0;

                        return (
                          <tr key={index} className={cn("hover:bg-slate-50/50 transition-colors", !isValid && "bg-rose-50/30 hover:bg-rose-50/50")}>
                            <td className="py-3 px-4">
                              {isValid ? (
                                <div className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                </div>
                              ) : (
                                <div className="w-6 h-6 rounded-full bg-rose-100 flex items-center justify-center text-rose-600">
                                  <AlertCircle className="w-3.5 h-3.5" />
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex flex-col">
                                <span className="text-sm font-bold text-slate-800">{firstName || '---'} {lastName || '---'}</span>
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{empId || 'NO ID'}</span>
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex flex-col">
                                <span className="text-sm font-bold text-slate-700">{row.job_title || row['Job Title'] || 'Unassigned'}</span>
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{row.department || row['Department'] || 'Unassigned'}</span>
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              {!isValid ? (
                                <div className="flex flex-wrap gap-1">
                                  {errors.map((err, i) => (
                                    <span key={i} className="text-[9px] font-black uppercase tracking-widest text-rose-600 bg-rose-100/50 border border-rose-200 px-1.5 py-0.5 rounded-md">
                                      {err}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest">Ready</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              
            <div className="p-6 sm:p-8 border-t border-slate-100 bg-white flex justify-end gap-3 shrink-0">
                <button 
                  onClick={() => setIsImportModalOpen(false)}
                  className="px-6 py-3 rounded-2xl font-bold text-slate-500 hover:bg-slate-100 transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => {
                    const validData = importData.filter(row => {
                      const empId = row.emp_id || row['Employee ID'];
                      const firstName = row.first_name || row['First Name'];
                      const lastName = row.last_name || row['Last Name'];
                      return empId && firstName && lastName;
                    });
                    onImport(validData);
                    setIsImportModalOpen(false);
                  }}
                  className="px-8 py-3 rounded-2xl font-black text-white bg-indigo-600 hover:bg-indigo-700 shadow-xl shadow-indigo-200 transition-all"
                >
                  Import Valid Entries
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Files Modal */}
      <AnimatePresence>
        {viewingFilesEmployee && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setViewingFilesEmployee(null)}
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100]"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed left-4 right-4 bottom-4 sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 w-auto sm:w-full sm:max-w-5xl bg-white rounded-[32px] sm:rounded-[40px] shadow-2xl z-[101] overflow-hidden max-h-[90vh] flex flex-col"
            >
              <div className="p-6 sm:p-8 border-b border-slate-100 flex items-center justify-between shrink-0">
                <div>
                  <h3 className="text-xl sm:text-2xl font-black text-slate-800">Employee Documents</h3>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
                    {viewingFilesEmployee.first_name} {viewingFilesEmployee.last_name} • {viewingFilesEmployee.emp_id}
                  </p>
                </div>
                <button onClick={() => setViewingFilesEmployee(null)} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                  <XCircle className="w-6 h-6 text-slate-400" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 sm:p-8">
                <FilesSection employeeId={viewingFilesEmployee.id} readOnly={fileVaultReadOnly} />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};
