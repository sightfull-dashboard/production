import React, { useState, useEffect } from 'react';
import { Loader2, Search, Calendar, User, Activity, Clock, Lock, ShieldCheck, Files } from 'lucide-react';
import { format, parseISO, isValid } from 'date-fns';
import { cn } from '../lib/utils';

interface Log {
  id: string;
  user_id: string | null;
  user_email: string;
  action: string;
  details: string;
  ip_address: string;
  created_at: string;
}

export function ActivityLogsPanel() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    try {
      const res = await fetch('/api/admin/logs', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
      }
    } catch (error) {
      console.error("Failed to fetch logs", error);
    } finally {
      setLoading(false);
    }
  };

  const filteredLogs = logs.filter((log) => {
    const userEmail = String(log.user_email || '').toLowerCase();
    const action = String(log.action || '').toLowerCase();
    const details = String(log.details || '').toLowerCase();
    const query = searchTerm.toLowerCase();
    return userEmail.includes(query) || action.includes(query) || details.includes(query);
  });

  const formatDetails = (detailsStr: string) => {
    if (!detailsStr) return '-';
    try {
      const details = JSON.parse(detailsStr);
      if (!details || typeof details !== 'object' || Object.keys(details).length === 0) return '-';
      return (
        <div className="text-xs space-y-1">
          {Object.entries(details).map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <span className="font-medium text-slate-500">{k}:</span>
              <span className="text-slate-700 truncate max-w-[200px]" title={String(v)}>{String(v)}</span>
            </div>
          ))}
        </div>
      );
    } catch {
      return detailsStr || '-';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-800 tracking-tight">Activity Logs</h2>
          <p className="text-sm text-slate-500 font-medium">Monitor user actions across the platform</p>
        </div>
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input 
            type="text" 
            placeholder="Search logs..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/20 w-full sm:w-64 shadow-sm"
          />
        </div>
      </div>

      <div className="bg-white/80 backdrop-blur-md rounded-[32px] shadow-xl shadow-indigo-100/20 border border-white/20 overflow-hidden">
        <div className="p-8 max-h-[800px] overflow-y-auto no-scrollbar">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-slate-500 font-medium">No logs found matching your search.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {filteredLogs.map((log, index, arr) => (
                <div key={log.id} className="flex gap-6 relative group">
                  {index !== arr.length - 1 && (
                    <div className="absolute left-6 top-12 bottom-[-24px] w-px bg-slate-100 group-hover:bg-indigo-100 transition-colors" />
                  )}
                  <div className="flex flex-col items-center shrink-0 relative z-10">
                    <div className={cn(
                      "w-12 h-12 rounded-2xl flex items-center justify-center border-4 border-white shadow-sm transition-transform group-hover:scale-110",
                      log.action.includes('LOGIN') ? "bg-indigo-50 text-indigo-600" : 
                      log.action.includes('PAYROLL') ? "bg-emerald-50 text-emerald-600" :
                      log.action.includes('FILE') ? "bg-amber-50 text-amber-600" : "bg-slate-50 text-slate-500"
                    )}>
                      {log.action.includes('LOGIN') ? <Lock className="w-5 h-5" /> : 
                       log.action.includes('PAYROLL') ? <ShieldCheck className="w-5 h-5" /> :
                       log.action.includes('FILE') ? <Files className="w-5 h-5" /> : <Activity className="w-5 h-5" />}
                    </div>
                  </div>
                  <div className="flex-1 bg-white rounded-3xl p-6 shadow-sm border border-slate-100 hover:shadow-md transition-shadow">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-4">
                      <div>
                        <div className="flex items-center gap-3 mb-1.5">
                          <span className="text-base font-black text-slate-800">{log.action.replace(/_/g, ' ')}</span>
                          <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest bg-slate-50 px-2 py-1 rounded-lg border border-slate-100">
                            {log.ip_address}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-sm font-bold text-slate-500">
                          <User className="w-4 h-4 text-slate-400" />
                          {log.user_email}
                        </div>
                      </div>
                      <div className="text-left sm:text-right shrink-0">
                        <p className="text-sm font-black text-slate-800">{new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">{new Date(log.created_at).toLocaleDateString()}</p>
                      </div>
                    </div>
                    <div className="bg-slate-50/50 rounded-2xl p-4 border border-slate-100">
                      {formatDetails(log.details)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
