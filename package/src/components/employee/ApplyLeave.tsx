import React, { useState } from 'react';
import { 
  Calendar, 
  Clock, 
  FileText, 
  AlertCircle, 
  CheckCircle2, 
  Upload,
  Info,
  ChevronRight,
  ArrowLeft,
  Users
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Employee, LeaveType } from '../../types';
import { cn } from '../../lib/utils';
import { format, differenceInBusinessDays, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { appService } from '../../services/appService';

interface ApplyLeaveProps {
  employee: Employee;
  onSuccess: () => void;
  onCancel: () => void;
}

export const ApplyLeave: React.FC<ApplyLeaveProps> = ({ employee, onSuccess, onCancel }) => {
  const [step, setStep] = useState(1);
  const [leaveType, setLeaveType] = useState<LeaveType>('annual');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isHalfDay, setIsHalfDay] = useState(false);
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const calculateDays = () => {
    if (!startDate || !endDate) return 0;
    const start = parseISO(startDate);
    const end = parseISO(endDate);
    if (isHalfDay) return 0.5;
    return Math.max(0, differenceInBusinessDays(end, start) + 1);
  };

  const days = calculateDays();
  const balance = leaveType === 'annual' ? (employee.annual_leave || 0) : 
                  leaveType === 'sick' ? (employee.sick_leave || 0) : (employee.family_leave || 0);
  
  const isInsufficient = days > balance;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isInsufficient) {
      toast.error('Insufficient leave balance');
      return;
    }
    if (!startDate || !endDate) {
      toast.error('Start and end dates are required');
      return;
    }
    if (new Date(startDate) > new Date(endDate)) {
      toast.error('End date cannot be before start date');
      return;
    }

    setIsSubmitting(true);
    try {
      await appService.createLeaveRequest({
        employee_id: employee.id,
        type: leaveType,
        start_date: startDate,
        end_date: endDate,
        is_half_day: isHalfDay,
        notes,
      });
      setStep(3);
    } catch (error: any) {
      toast.error(error?.message || 'Failed to submit leave request');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8 flex items-center justify-between">
        <button 
          onClick={onCancel}
          className="flex items-center gap-2 text-slate-400 hover:text-slate-600 font-bold transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          Back to Dashboard
        </button>
        <div className="flex items-center gap-2">
          {[1, 2, 3].map((s) => (
            <div 
              key={s} 
              className={cn(
                "w-2.5 h-2.5 rounded-full transition-all duration-300",
                step === s ? "w-8 bg-emerald-600" : s < step ? "bg-emerald-200" : "bg-slate-200"
              )} 
            />
          ))}
        </div>
      </div>

      <AnimatePresence mode="wait">
        {step === 1 && (
          <motion.div 
            key="step1"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-8"
          >
            <div className="space-y-2">
              <h2 className="text-3xl font-black text-slate-800 tracking-tight">What type of leave?</h2>
              <p className="text-slate-500 font-bold">Select the category that best fits your request.</p>
            </div>

            <div className="grid grid-cols-1 gap-4">
              {(['annual', 'sick', 'family'] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => { setLeaveType(type); setStep(2); }}
                  className={cn(
                    "flex items-center justify-between p-6 rounded-[32px] border-2 transition-all group",
                    leaveType === type 
                      ? "border-emerald-600 bg-emerald-50 shadow-xl shadow-emerald-100/50" 
                      : "border-slate-100 bg-white hover:border-slate-200"
                  )}
                >
                  <div className="flex items-center gap-6">
                    <div className={cn(
                      "w-16 h-16 rounded-[24px] flex items-center justify-center transition-transform group-hover:scale-110",
                      type === 'annual' ? 'bg-emerald-100 text-emerald-600' : 
                      type === 'sick' ? 'bg-amber-100 text-amber-600' : 'bg-indigo-100 text-indigo-600'
                    )}>
                      {type === 'annual' ? <Calendar className="w-8 h-8" /> : 
                       type === 'sick' ? <Clock className="w-8 h-8" /> : <Users className="w-8 h-8" />}
                    </div>
                    <div className="text-left">
                      <h3 className="text-xl font-black text-slate-800 capitalize">{type} Leave</h3>
                      <p className="text-slate-500 font-bold text-sm">
                        {type === 'annual' ? 'Planned time off for rest and recreation.' : 
                         type === 'sick' ? 'Time off due to illness or medical appointments.' : 'Family responsibilities or emergencies.'}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className={cn("block text-2xl font-black", Number(type === 'annual' ? (employee.annual_leave || 0) : type === 'sick' ? (employee.sick_leave || 0) : (employee.family_leave || 0)) < 0 ? 'text-red-600' : 'text-slate-800')}>
                      {type === 'annual' ? (employee.annual_leave || 0) : 
                       type === 'sick' ? (employee.sick_leave || 0) : (employee.family_leave || 0)}
                    </span>
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Days Left</span>
                  </div>
                </button>
              ))}
            </div>
          </motion.div>
        )}

        {step === 2 && (
          <motion.div 
            key="step2"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-8"
          >
            <div className="space-y-2">
              <h2 className="text-3xl font-black text-slate-800 tracking-tight">When are you away?</h2>
              <p className="text-slate-500 font-bold">Select your dates and provide any additional details.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-8">
              <div className="bg-white rounded-[40px] p-10 shadow-xl shadow-slate-200/50 border border-slate-100 space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-3">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest px-1">Start Date</label>
                    <div className="relative">
                      <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                      <input 
                        type="date" 
                        required
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-slate-800 focus:ring-4 focus:ring-emerald-600/10 focus:border-emerald-600 outline-none transition-all" 
                      />
                    </div>
                  </div>
                  <div className="space-y-3">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest px-1">End Date</label>
                    <div className="relative">
                      <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                      <input 
                        type="date" 
                        required
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-slate-800 focus:ring-4 focus:ring-emerald-600/10 focus:border-emerald-600 outline-none transition-all" 
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                  <button
                    type="button"
                    onClick={() => setIsHalfDay(!isHalfDay)}
                    className={cn(
                      "w-12 h-6 rounded-full transition-all relative",
                      isHalfDay ? "bg-emerald-600" : "bg-slate-300"
                    )}
                  >
                    <div className={cn(
                      "absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
                      isHalfDay ? "left-7" : "left-1"
                    )} />
                  </button>
                  <span className="font-bold text-slate-700">This is a half-day request</span>
                </div>

                <div className="space-y-3">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest px-1">Reason / Notes</label>
                  <textarea 
                    rows={4}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Tell us more about your request..."
                    className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-medium text-slate-800 focus:ring-4 focus:ring-emerald-600/10 focus:border-emerald-600 outline-none transition-all resize-none"
                  />
                </div>

                <div className="p-6 bg-emerald-50 rounded-[32px] border border-emerald-100 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-sm">
                      <Info className="w-6 h-6 text-emerald-600" />
                    </div>
                    <div>
                      <p className="text-sm font-black text-slate-800">Leave Summary</p>
                      <p className="text-xs text-slate-500 font-bold">
                        {days} {days === 1 ? 'day' : 'days'} requested • {balance - days} days remaining
                      </p>
                    </div>
                  </div>
                  {isInsufficient && (
                    <div className="flex items-center gap-2 text-rose-600 font-black text-xs uppercase tracking-widest">
                      <AlertCircle className="w-4 h-4" />
                      Insufficient Balance
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-4">
                <button 
                  type="button"
                  onClick={() => setStep(1)}
                  className="flex-1 py-5 bg-white border border-slate-200 text-slate-600 rounded-[24px] font-black hover:bg-slate-50 transition-all"
                >
                  Change Leave Type
                </button>
                <button 
                  type="submit"
                  disabled={isSubmitting || isInsufficient || !startDate || !endDate}
                  className="flex-[2] py-5 bg-emerald-600 text-white rounded-[24px] font-black hover:bg-emerald-700 disabled:opacity-50 disabled:hover:bg-emerald-600 transition-all shadow-xl shadow-emerald-200 flex items-center justify-center gap-3"
                >
                  {isSubmitting ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    <>
                      Submit Request
                      <ChevronRight className="w-5 h-5" />
                    </>
                  )}
                </button>
              </div>
            </form>
          </motion.div>
        )}

        {step === 3 && (
          <motion.div 
            key="step3"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center py-20 space-y-8"
          >
            <div className="w-32 h-32 bg-emerald-100 rounded-[48px] flex items-center justify-center mx-auto shadow-2xl shadow-emerald-100">
              <CheckCircle2 className="w-16 h-16 text-emerald-600" />
            </div>
            <div className="space-y-4">
              <h2 className="text-4xl font-black text-slate-800 tracking-tight">Request Submitted!</h2>
              <p className="text-slate-500 font-bold text-lg max-w-md mx-auto">
                Your {leaveType} leave request for {days} {days === 1 ? 'day' : 'days'} has been sent to your manager for approval.
              </p>
            </div>
            <button 
              onClick={onSuccess}
              className="px-10 py-5 bg-slate-900 text-white rounded-[24px] font-black hover:bg-slate-800 transition-all shadow-xl shadow-slate-200"
            >
              Back to Dashboard
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
