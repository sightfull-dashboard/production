import React, { useState, useMemo } from 'react';
import { Plus, Clock, Edit3, Trash2, Search } from 'lucide-react';
import { Shift } from '../types';
import { Tooltip } from './Tooltip';
import { isAdministrativeShift, sortShiftsBaseFirst } from '../lib/shifts';

const PAID_LEAVE_SHIFT_HOURS: Record<string, number> = {
  'annual leave': 9,
  'sick leave': 9,
  'family leave': 9,
  'half day': 4.5,
};
const isProtectedLeaveShift = (shift: Shift) => isAdministrativeShift(shift);

const getShiftTotalHours = (shift: Shift) => {
  const label = String(shift.label || '').trim().toLowerCase();
  if (label in PAID_LEAVE_SHIFT_HOURS) return PAID_LEAVE_SHIFT_HOURS[label];
  if (!shift.start || !shift.end) return 0;
  const [startHour, startMinute] = shift.start.split(':').map(Number);
  const [endHour, endMinute] = shift.end.split(':').map(Number);
  if ([startHour, startMinute, endHour, endMinute].some((value) => Number.isNaN(value))) return 0;

  let startTotal = startHour * 60 + startMinute;
  let endTotal = endHour * 60 + endMinute;
  if (endTotal <= startTotal) endTotal += 24 * 60;

  const workedMinutes = Math.max(0, endTotal - startTotal - Number(shift.lunch || 0));
  return workedMinutes / 60;
};

interface ShiftsSectionProps {
  shifts: Shift[];
  onAdd: () => void;
  onEdit: (shift: Shift) => void;
  onDelete: (id: string) => void;
  isSuperAdmin?: boolean;
}

export const ShiftsSection: React.FC<ShiftsSectionProps> = ({ shifts, onAdd, onEdit, onDelete, isSuperAdmin = false }) => {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredShifts = useMemo(() => {
    const visible = shifts.filter(s => {
      return s.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (s.start && s.start.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (s.end && s.end.toLowerCase().includes(searchTerm.toLowerCase()));
    });

    return sortShiftsBaseFirst(visible);
  }, [shifts, searchTerm]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-4xl font-black text-slate-800 tracking-tight">Shift Management</h2>
        <div className="flex items-center gap-4">
          <div className="relative w-full md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search shifts..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white/50 focus:outline-none focus:ring-2 focus:ring-indigo-600/20 text-sm font-medium"
            />
          </div>
          <button 
            onClick={onAdd}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl font-black text-sm bg-indigo-600 text-white hover:bg-indigo-700 shadow-xl shadow-indigo-200 transition-all active:scale-95 whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Create Shift
          </button>
        </div>
      </div>

      <div className="bg-white/80 backdrop-blur-md rounded-[32px] shadow-xl shadow-indigo-100/20 border border-white/20 overflow-hidden">
        <div className="p-5 border-b border-slate-100 bg-slate-50/50">
          <span className="text-xs font-black text-slate-400 uppercase tracking-widest">{filteredShifts.length} Shifts Found</span>
        </div>
        <div className="overflow-x-auto hide-horizontal-scrollbar">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 text-slate-500 text-[10px] uppercase tracking-widest font-black">
                <th className="px-6 py-5">Label</th>
                <th className="px-6 py-5">Time Window</th>
                <th className="px-6 py-5">Lunch Break</th>
                <th className="px-6 py-5">Total Hours</th>
                <th className="px-6 py-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredShifts.map(shift => (
                <tr key={shift.id} className="hover:bg-indigo-50/30 transition-colors group">
                  <td className="px-6 py-5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-800">{shift.label}</span>
                      {isProtectedLeaveShift(shift) && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-black uppercase tracking-wide">
                          Administrative
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-5">
                    <div className="flex items-center gap-2 text-sm text-slate-600 font-bold">
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      {shift.start && shift.end ? `${shift.start} — ${shift.end}` : 'N/A'}
                    </div>
                  </td>
                  <td className="px-6 py-5 text-sm text-slate-500 font-bold">{Number(shift.lunch || 0)} minutes</td>
                  <td className="px-6 py-5 text-sm text-slate-500 font-bold">{shift.start && shift.end ? getShiftTotalHours(shift).toFixed(2) : '0.00'}</td>
                  <td className="px-6 py-5 text-right">
                    <div className="flex items-center justify-end gap-1 transition-all">
                      <Tooltip content={!isSuperAdmin && isProtectedLeaveShift(shift) ? "Only Super Admin can edit administrative shifts" : "Edit Shift"}>
                        <button 
                          onClick={() => {
                            if (!isSuperAdmin && isProtectedLeaveShift(shift)) return;
                            onEdit(shift);
                          }}
                          disabled={!isSuperAdmin && isProtectedLeaveShift(shift)}
                          className={`p-2 rounded-xl transition-colors ${!isSuperAdmin && isProtectedLeaveShift(shift) ? 'text-slate-300 cursor-not-allowed' : 'hover:bg-indigo-50 text-indigo-400 hover:text-indigo-600'}`}
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                      </Tooltip>
                      <Tooltip content={!isSuperAdmin && isProtectedLeaveShift(shift) ? "Only Super Admin can delete administrative shifts" : "Delete Shift"}>
                        <button 
                          onClick={() => {
                            if (!isSuperAdmin && isProtectedLeaveShift(shift)) return;
                            onDelete(shift.id);
                          }}
                          disabled={!isSuperAdmin && isProtectedLeaveShift(shift)}
                          className={`p-2 rounded-xl transition-colors ${!isSuperAdmin && isProtectedLeaveShift(shift) ? 'text-slate-300 cursor-not-allowed' : 'hover:bg-rose-50 text-rose-400 hover:text-rose-600'}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </Tooltip>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredShifts.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-slate-500 font-medium">
                    No shifts found matching your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
