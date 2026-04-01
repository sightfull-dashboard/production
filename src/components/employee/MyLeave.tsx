import React, { useState } from 'react';
import { 
  Calendar, 
  Clock, 
  FileText, 
  AlertCircle, 
  CheckCircle2, 
  XCircle,
  Search,
  Filter,
  ChevronRight,
  MoreVertical,
  Download,
  Trash2,
  History
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Employee, LeaveRequest, LeaveStatus } from '../../types';
import { cn } from '../../lib/utils';
import { format, parseISO } from 'date-fns';
import { BrandedState } from '../BrandedStates';
import { normalizeLeaveRequestsForDisplay } from '../../lib/leaveDisplay';

interface MyLeaveProps {
  employee: Employee;
  requests: LeaveRequest[];
  onCancelRequest: (id: string) => void;
}

export const MyLeave: React.FC<MyLeaveProps> = ({ employee, requests, onCancelRequest }) => {
  const leaveTypeMeta: Record<string, { label: string; iconBg: string }> = {
    annual: { label: 'Annual Leave', iconBg: 'bg-emerald-100 text-emerald-600' },
    sick: { label: 'Sick Leave', iconBg: 'bg-amber-100 text-amber-600' },
    family: { label: 'Family Responsibility', iconBg: 'bg-indigo-100 text-indigo-600' },
    unpaid: { label: 'Unpaid Leave', iconBg: 'bg-slate-100 text-slate-600' },
    half_day: { label: 'Half Day', iconBg: 'bg-sky-100 text-sky-600' },
  };
  const [filter, setFilter] = useState<LeaveStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [selectedRequest, setSelectedRequest] = useState<LeaveRequest | null>(null);

  const normalizedRequests = normalizeLeaveRequestsForDisplay(requests);

  const filteredRequests = normalizedRequests.filter(req => {
    const matchesFilter = filter === 'all' || req.status === filter;
    const matchesSearch = req.type.toLowerCase().includes(search.toLowerCase()) || 
                          req.notes?.toLowerCase().includes(search.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const getStatusColor = (status: LeaveStatus) => {
    switch (status) {
      case 'approved': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case 'declined': return 'bg-rose-100 text-rose-700 border-rose-200';
      case 'cancelled': return 'bg-slate-100 text-slate-500 border-slate-200';
      default: return 'bg-amber-100 text-amber-700 border-amber-200';
    }
  };

  const getStatusIcon = (status: LeaveStatus) => {
    switch (status) {
      case 'approved': return <CheckCircle2 className="w-4 h-4" />;
      case 'declined': return <XCircle className="w-4 h-4" />;
      case 'cancelled': return <Trash2 className="w-4 h-4" />;
      default: return <Clock className="w-4 h-4" />;
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-1">
          <h2 className="text-3xl font-black text-slate-800 tracking-tight">My Leave History</h2>
          <p className="text-slate-500 font-bold">Track and manage your leave requests.</p>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search requests..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-12 pr-4 py-3 bg-white border border-slate-100 rounded-2xl font-bold text-slate-800 focus:ring-4 focus:ring-emerald-600/10 focus:border-emerald-600 outline-none transition-all w-64 shadow-sm"
            />
          </div>
          <div className="flex p-1 bg-white border border-slate-100 rounded-2xl shadow-sm">
            {(['all', 'pending', 'approved', 'declined'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={cn(
                  "px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                  filter === s ? "bg-slate-800 text-white shadow-md" : "text-slate-500 hover:bg-slate-50"
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-[40px] shadow-xl shadow-slate-200/50 border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto hide-horizontal-scrollbar">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 text-slate-500 text-[10px] uppercase tracking-widest font-black">
                <th className="px-10 py-6">Type</th>
                <th className="px-10 py-6">Duration</th>
                <th className="px-10 py-6">Status</th>
                <th className="px-10 py-6">Requested On</th>
                <th className="px-10 py-6">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredRequests.map(req => (
                <tr key={req.id} className="hover:bg-slate-50/50 transition-colors group">
                  <td className="px-10 py-6">
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "w-10 h-10 rounded-xl flex items-center justify-center",
                        leaveTypeMeta[req.type]?.iconBg || 'bg-slate-100 text-slate-600'
                      )}>
                        {req.type === 'annual' ? <Calendar className="w-5 h-5" /> : req.type === 'sick' ? <Clock className="w-5 h-5" /> : <History className="w-5 h-5" />}
                      </div>
                      <span className="font-black text-slate-800">{leaveTypeMeta[req.type]?.label || req.type}</span>
                    </div>
                  </td>
                  <td className="px-10 py-6">
                    <div className="text-sm font-bold text-slate-800">
                      {format(parseISO(req.start_date), 'MMM d')} - {format(parseISO(req.end_date), 'MMM d, yyyy')}
                    </div>
                    <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mt-1">
                      {Number(req.days ?? (req.is_half_day ? 0.5 : 1)).toFixed(2)} Day(s)
                    </p>
                  </td>
                  <td className="px-10 py-6">
                    <span className={cn(
                      "inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border",
                      getStatusColor(req.status)
                    )}>
                      {getStatusIcon(req.status)}
                      {req.status}
                    </span>
                  </td>
                  <td className="px-10 py-6 text-sm font-medium text-slate-500">
                    {format(parseISO(req.created_at), 'MMM d, yyyy')}
                  </td>
                  <td className="px-10 py-6">
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => setSelectedRequest(req)}
                        className="p-2 hover:bg-slate-100 rounded-xl transition-colors text-slate-400 hover:text-emerald-600"
                      >
                        <FileText className="w-5 h-5" />
                      </button>
                      {req.status === 'pending' && (
                        <button 
                          onClick={() => onCancelRequest(req.id)}
                          className="p-2 hover:bg-rose-50 rounded-xl transition-colors text-slate-400 hover:text-rose-600"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filteredRequests.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-10 py-20 text-center">
                    <BrandedState 
                      type="empty" 
                      portal="employee" 
                      title="No Requests Found" 
                      message="Try adjusting your filters or search terms." 
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Request Detail Modal */}
      <AnimatePresence>
        {selectedRequest && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedRequest(null)}
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100]"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-white rounded-[40px] shadow-2xl z-[101] overflow-hidden"
            >
              <div className="p-10 space-y-8">
                <div className="flex items-center justify-between">
                  <div className={cn(
                    "w-16 h-16 rounded-[24px] flex items-center justify-center",
                    leaveTypeMeta[selectedRequest.type]?.iconBg || 'bg-slate-100 text-slate-600'
                  )}>
                    {selectedRequest.type === 'annual' ? <Calendar className="w-8 h-8" /> : 
                     selectedRequest.type === 'sick' ? <Clock className="w-8 h-8" /> : <History className="w-8 h-8" />}
                  </div>
                  <span className={cn(
                    "px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border",
                    getStatusColor(selectedRequest.status)
                  )}>
                    {selectedRequest.status}
                  </span>
                </div>

                <div className="space-y-6">
                  <div className="space-y-1">
                    <h3 className="text-3xl font-black text-slate-800 tracking-tight">{leaveTypeMeta[selectedRequest.type]?.label || selectedRequest.type}</h3>
                    <p className="text-slate-500 font-bold">
                      {format(parseISO(selectedRequest.start_date), 'EEEE, MMM d')} - {format(parseISO(selectedRequest.end_date), 'EEEE, MMM d, yyyy')}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-6 p-6 bg-slate-50 rounded-[32px] border border-slate-100">
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Duration</p>
                      <p className="font-black text-slate-800">3 Days</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Requested On</p>
                      <p className="font-black text-slate-800">{format(parseISO(selectedRequest.created_at), 'MMM d, yyyy')}</p>
                    </div>
                  </div>

                  {selectedRequest.notes && (
                    <div className="space-y-2">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">My Notes</p>
                      <div className="p-6 bg-slate-50 rounded-[32px] border border-slate-100 text-slate-700 font-medium">
                        {selectedRequest.notes}
                      </div>
                    </div>
                  )}

                  {selectedRequest.admin_notes && (
                    <div className="space-y-2">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Admin Response</p>
                      <div className="p-6 bg-indigo-50 rounded-[32px] border border-indigo-100 text-indigo-700 font-medium">
                        {selectedRequest.admin_notes}
                      </div>
                    </div>
                  )}
                </div>

                <button 
                  onClick={() => setSelectedRequest(null)}
                  className="w-full py-5 bg-slate-900 text-white rounded-[24px] font-black hover:bg-slate-800 transition-all shadow-xl shadow-slate-200"
                >
                  Close Details
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};
