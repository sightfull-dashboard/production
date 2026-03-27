import React, { useState, useEffect } from 'react';
import { Loader2, Search, Calendar, User, Activity, Clock } from 'lucide-react';
import { format, isValid, parseISO } from 'date-fns';

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

  const filteredLogs = logs.filter(log => 
    log.user_email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    log.action.toLowerCase().includes(searchTerm.toLowerCase()) ||
    log.details.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const formatDetails = (detailsStr: string) => {
    try {
      const details = JSON.parse(detailsStr);
      if (Object.keys(details).length === 0) return '-';
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
      return detailsStr;
    }
  };

  const getActionColor = (action: string) => {
    if (action.includes('LOGIN')) return 'text-emerald-600 bg-emerald-50 border-emerald-200';
    if (action.includes('LOGOUT')) return 'text-slate-600 bg-slate-50 border-slate-200';
    if (action.includes('CREATE')) return 'text-indigo-600 bg-indigo-50 border-indigo-200';
    if (action.includes('UPDATE')) return 'text-amber-600 bg-amber-50 border-amber-200';
    if (action.includes('DELETE')) return 'text-rose-600 bg-rose-50 border-rose-200';
    return 'text-slate-600 bg-slate-50 border-slate-200';
  };

  const formatTimestamp = (value: string) => {
    if (!value) return '-';

    const candidates = [
      value,
      /[zZ]|[+-]\d\d:?\d\d$/.test(value) ? null : `${value}Z`,
    ].filter(Boolean) as string[];

    for (const candidate of candidates) {
      const parsed = parseISO(candidate);
      if (isValid(parsed)) {
        return format(parsed, 'MMM d, yyyy HH:mm:ss');
      }

      const fallback = new Date(candidate);
      if (isValid(fallback)) {
        return format(fallback, 'MMM d, yyyy HH:mm:ss');
      }
    }

    return value;
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

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/50">
                <th className="py-4 px-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  <div className="flex items-center gap-2"><Clock className="w-3 h-3" /> Timestamp</div>
                </th>
                <th className="py-4 px-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  <div className="flex items-center gap-2"><User className="w-3 h-3" /> User</div>
                </th>
                <th className="py-4 px-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  <div className="flex items-center gap-2"><Activity className="w-3 h-3" /> Action</div>
                </th>
                <th className="py-4 px-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">Details</th>
                <th className="py-4 px-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">IP Address</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center">
                    <Loader2 className="w-8 h-8 text-indigo-600 animate-spin mx-auto" />
                  </td>
                </tr>
              ) : filteredLogs.length > 0 ? (
                filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="py-4 px-6 text-sm text-slate-600 font-medium whitespace-nowrap">
                      {formatTimestamp(log.created_at)}
                    </td>
                    <td className="py-4 px-6">
                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-slate-800">{log.user_email}</span>
                        {log.user_id && <span className="text-[10px] text-slate-400 font-mono">{log.user_id}</span>}
                      </div>
                    </td>
                    <td className="py-4 px-6">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-[10px] font-black tracking-widest uppercase border ${getActionColor(log.action)}`}>
                        {log.action.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="py-4 px-6">
                      {formatDetails(log.details)}
                    </td>
                    <td className="py-4 px-6 text-xs font-mono text-slate-500">
                      {log.ip_address}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-500 font-medium">
                    No logs found matching your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
