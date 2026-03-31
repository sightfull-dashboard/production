import React from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { OffboardReason, Employee } from '../types';
import { OFFBOARD_REASONS } from '../constants';
import { cn } from '../lib/utils';

interface OffboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (data: { 
    reason: OffboardReason, 
    otherReason?: string, 
    lastWorked: string,
    preparePayslip: boolean,
    generateUIF: boolean
  }) => void;
  employee: Employee | null;
}

export const OffboardModal: React.FC<OffboardModalProps> = ({ isOpen, onClose, onConfirm, employee }) => {
  const [reason, setReason] = React.useState<OffboardReason | ''>('');
  const [otherReason, setOtherReason] = React.useState('');
  const [lastWorked, setLastWorked] = React.useState('');
  const [preparePayslip, setPreparePayslip] = React.useState(false);
  const [generateUIF, setGenerateUIF] = React.useState(false);
  const [dateError, setDateError] = React.useState('');

  if (!employee) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason) return;
    if (!lastWorked) {
      setDateError('Termination date is required.');
      return;
    }
    if (employee.start_date && lastWorked < employee.start_date) {
      setDateError('Termination date cannot be before the employee start date.');
      return;
    }
    setDateError('');
    onConfirm({ 
      reason: reason as OffboardReason, 
      otherReason: reason === 'other' ? otherReason : undefined,
      lastWorked,
      preparePayslip,
      generateUIF
    });
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[200]"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-white rounded-[32px] shadow-2xl z-[201] overflow-hidden"
          >
            <div className="p-8">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-rose-50 rounded-2xl flex items-center justify-center">
                    <AlertTriangle className="w-6 h-6 text-rose-500" />
                  </div>
                  <div>
                    <h3 className="text-xl font-black text-slate-800">Off-board Employee</h3>
                    <p className="text-sm text-slate-500 font-medium">{employee.first_name} {employee.last_name}</p>
                  </div>
                </div>
                <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Last Worked Date</label>
                  <input 
                    type="date" 
                    required
                    min={employee.start_date || undefined}
                    value={lastWorked}
                    onChange={(e) => {
                      setLastWorked(e.target.value);
                      if (!e.target.value || !employee.start_date || e.target.value >= employee.start_date) {
                        setDateError('');
                      }
                    }}
                    className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-rose-500/20 outline-none text-sm font-bold" 
                  />
                  {employee.start_date && (
                    <p className="text-xs font-medium text-slate-500">Employee start date: {employee.start_date}</p>
                  )}
                  {dateError && <p className="text-xs font-bold text-rose-500">{dateError}</p>}
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Reason for Off-boarding</label>
                  <select 
                    required
                    value={reason}
                    onChange={(e) => setReason(e.target.value as OffboardReason)}
                    className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-rose-500/20 outline-none text-sm font-bold appearance-none bg-white"
                  >
                    <option value="">Select a reason...</option>
                    {(Object.entries(OFFBOARD_REASONS) as [OffboardReason, string][]).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>

                {reason === 'other' && (
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Specify Reason</label>
                    <textarea 
                      required
                      value={otherReason}
                      onChange={(e) => setOtherReason(e.target.value)}
                      className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-rose-500/20 outline-none text-sm font-bold min-h-[100px]"
                      placeholder="Enter details..."
                    />
                  </div>
                )}

                <div className="space-y-4 pt-2">
                  <label className="flex items-center gap-3 p-4 rounded-2xl border border-slate-100 hover:bg-slate-50 transition-all cursor-pointer group">
                    <div className="relative inline-flex h-6 w-11 items-center rounded-full bg-slate-200 transition-colors group-hover:bg-slate-300">
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={preparePayslip}
                        onChange={(e) => setPreparePayslip(e.target.checked)}
                      />
                      <span
                        className={cn(
                          "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                          preparePayslip ? "translate-x-6" : "translate-x-1"
                        )}
                      />
                      {preparePayslip && <div className="absolute inset-0 bg-indigo-600 rounded-full transition-colors" />}
                      <span
                        className={cn(
                          "absolute inline-block h-4 w-4 transform rounded-full bg-white transition-transform z-10",
                          preparePayslip ? "translate-x-6" : "translate-x-1"
                        )}
                      />
                    </div>
                    <span className="text-sm font-bold text-slate-700">Prepare Final Payslip</span>
                  </label>

                  <label className="flex items-center gap-3 p-4 rounded-2xl border border-slate-100 hover:bg-slate-50 transition-all cursor-pointer group">
                    <div className="relative inline-flex h-6 w-11 items-center rounded-full bg-slate-200 transition-colors group-hover:bg-slate-300">
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={generateUIF}
                        onChange={(e) => setGenerateUIF(e.target.checked)}
                      />
                      <span
                        className={cn(
                          "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                          generateUIF ? "translate-x-6" : "translate-x-1"
                        )}
                      />
                      {generateUIF && <div className="absolute inset-0 bg-indigo-600 rounded-full transition-colors" />}
                      <span
                        className={cn(
                          "absolute inline-block h-4 w-4 transform rounded-full bg-white transition-transform z-10",
                          generateUIF ? "translate-x-6" : "translate-x-1"
                        )}
                      />
                    </div>
                    <span className="text-sm font-bold text-slate-700">Generate UIF Documents</span>
                  </label>
                </div>

                <div className="pt-4 flex gap-3">
                  <button 
                    type="button"
                    onClick={onClose}
                    className="flex-1 px-6 py-4 rounded-2xl font-bold text-slate-600 hover:bg-slate-50 transition-all border border-slate-200"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 px-6 py-4 rounded-2xl font-bold text-white bg-rose-500 hover:bg-rose-600 transition-all shadow-lg shadow-rose-200"
                  >
                    Confirm Off-board
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
