import React, { useState, useEffect } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, ComposedChart
} from 'recharts';
import { Loader2, TrendingUp, Users, CalendarDays, Search, ChevronRight } from 'lucide-react';
import { cn } from '../lib/utils';
import { buildActiveClientHeaders } from '../lib/activeClient';
import { format, subMonths } from 'date-fns';

const Card = ({ children, className }: { children: React.ReactNode, className?: string }) => (
  <div className={cn("bg-white/80 backdrop-blur-md rounded-[32px] shadow-xl shadow-indigo-100/20 border border-white/20 p-6", className)}>
    {children}
  </div>
);

const COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#64748b'];

interface AnalyticsSectionProps {
  onViewLeaveEmployeeProfile?: (employeeName: string) => void;
}

export function AnalyticsSection({ onViewLeaveEmployeeProfile }: AnalyticsSectionProps) {
  const [month, setMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [leaveSearch, setLeaveSearch] = useState('');

  useEffect(() => {
    fetchAnalytics();
  }, [month]);

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/analytics?month=${month}`, {
        headers: buildActiveClientHeaders(),
      });
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok) {
        throw new Error(`Analytics request failed with status ${res.status}`);
      }
      if (!contentType.includes('application/json')) {
        throw new Error('Analytics endpoint did not return JSON.');
      }
      const json = await res.json();
      setData(json);
    } catch (error) {
      console.error("Failed to fetch analytics", error);
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(amount);
  };

  const getLeaveValueClassName = (value: unknown) => {
    const numericValue = Number(value);
    if (Number.isFinite(numericValue) && numericValue < 0) {
      return 'text-red-600';
    }
    return 'text-slate-600';
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-12 h-12 text-indigo-600 animate-spin" />
      </div>
    );
  }

  const filteredLeave = data?.leaveAnalytics?.filter((e: any) => 
    e.name.toLowerCase().includes(leaveSearch.toLowerCase())
  ) || [];

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h2 className="text-4xl font-black text-slate-800 tracking-tight">Analytics Overview</h2>
        <div className="flex items-center gap-3 bg-white p-2 rounded-2xl shadow-sm border border-slate-100">
          <CalendarDays className="w-5 h-5 text-slate-400 ml-2" />
          <input 
            type="month" 
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="bg-transparent font-bold text-slate-700 outline-none cursor-pointer"
          />
        </div>
      </div>

      {loading && data && (
        <div className="fixed top-4 right-4 bg-indigo-600 text-white px-4 py-2 rounded-full shadow-lg flex items-center gap-2 z-50 animate-pulse">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm font-bold">Updating...</span>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="bg-indigo-600 text-white border-none overflow-hidden relative group">
          <div className="absolute -right-4 -top-4 w-24 h-24 bg-white/10 rounded-full blur-2xl group-hover:scale-150 transition-transform duration-500" />
          <div className="relative z-10 space-y-4">
            <div className="flex items-center justify-between">
              <div className="w-8 h-8 rounded-full bg-white/15 text-indigo-50 flex items-center justify-center text-sm font-black">R</div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-100">Current Total Salary Bill</span>
            </div>
            <div className="space-y-1">
              <h3 className="text-4xl font-black">{formatCurrency(data?.kpis?.currentTotal || 0)}</h3>
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/10">
                <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-200">Active Employees</span>
                <span className="text-sm font-black">{data?.kpis?.activeCount || 0}</span>
              </div>
            </div>
          </div>
        </Card>

        <Card className="bg-slate-800 text-white border-none overflow-hidden relative group">
          <div className="absolute -right-4 -top-4 w-24 h-24 bg-white/10 rounded-full blur-2xl group-hover:scale-150 transition-transform duration-500" />
          <div className="relative z-10 space-y-4">
            <div className="flex items-center justify-between">
              <TrendingUp className="w-8 h-8 text-slate-400" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Previous Month Salary Bill</span>
            </div>
            <div className="space-y-1">
              <h3 className="text-4xl font-black">{formatCurrency(data?.kpis?.prevTotal || 0)}</h3>
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/10">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Employees (Inc. Ex)</span>
                <span className="text-sm font-black">{data?.kpis?.totalEmployees || 0}</span>
              </div>
            </div>
          </div>
        </Card>

        <Card className="bg-emerald-500 text-white border-none overflow-hidden relative group">
          <div className="absolute -right-4 -top-4 w-24 h-24 bg-white/10 rounded-full blur-2xl group-hover:scale-150 transition-transform duration-500" />
          <div className="relative z-10 space-y-4">
            <div className="flex items-center justify-between">
              <Users className="w-8 h-8 text-emerald-200" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-100">Average Salary Metrics</span>
            </div>
            <div className="space-y-1">
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-100">Avg Salary (Active)</span>
                  <span className="text-xl font-black">{formatCurrency(data?.kpis?.avgSalary || 0)}</span>
                </div>
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/10">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-100">Avg Weekly Bill (Non-Zero)</span>
                  <span className="text-xl font-black">{formatCurrency(data?.kpis?.avgWeeklyBill || 0)}</span>
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="flex flex-col h-[400px]">
          <h4 className="font-bold text-slate-800 mb-6">Shifts vs Salary Bill (Weekly)</h4>
          <div className="flex-1 min-h-[320px] min-w-0">
            {data?.weeklyChart?.length > 0 ? (
              <ResponsiveContainer minHeight={300} width="100%" height="100%">
                <ComposedChart data={data.weeklyChart} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="week" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} dy={10} />
                  <YAxis yAxisId="left" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} dx={-10} />
                  <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} dx={10} />
                  <Tooltip 
                    contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                    formatter={(value: number, name: string) => [name === 'amount' ? formatCurrency(value) : value, name === 'amount' ? 'Salary Bill' : 'Shifts']}
                  />
                  <Legend wrapperStyle={{ paddingTop: '20px' }} />
                  <Bar yAxisId="left" dataKey="shifts" name="Shifts Count" fill="#e2e8f0" radius={[4, 4, 0, 0]} barSize={40} />
                  <Line yAxisId="right" type="monotone" dataKey="amount" name="Salary Bill" stroke="#4f46e5" strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6 }} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-400 font-medium">No data available for selected month</div>
            )}
          </div>
        </Card>

        <Card className="flex flex-col h-[400px]">
          <h4 className="font-bold text-slate-800 mb-6">Salary Bill Breakdown</h4>
          <div className="flex-1 min-h-[320px] min-w-0 flex items-center">
            {data?.breakdown?.length > 0 ? (
              <>
                <div className="w-1/2 h-full min-w-0 min-h-[280px]">
                  <ResponsiveContainer minHeight={300} width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={data.breakdown}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="amount"
                      >
                        {data.breakdown.map((entry: any, index: number) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value: number) => formatCurrency(value)} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="w-1/2 pl-4 overflow-y-auto max-h-full pr-2 min-w-0">
                  <div className="space-y-3">
                    {data.breakdown.map((item: any, idx: number) => (
                      <div key={idx} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                          <span className="text-sm font-bold text-slate-700">{item.category}</span>
                        </div>
                        <span className="text-sm font-black text-slate-900">{formatCurrency(item.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-slate-400 font-medium">No data available for selected month</div>
            )}
          </div>
        </Card>
      </div>

      {/* Tables Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <h4 className="font-bold text-slate-800 mb-6">Employees & Salary Share</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="pb-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Employee Name</th>
                  <th className="pb-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Salary Amount</th>
                  <th className="pb-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">% of Total</th>
                </tr>
              </thead>
              <tbody>
                {data?.employeeShare?.length > 0 ? (
                  data.employeeShare.map((emp: any, idx: number) => (
                    <tr key={idx} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50 transition-colors">
                      <td className="py-4 text-sm font-bold text-slate-700">{emp.name}</td>
                      <td className="py-4 text-sm font-black text-slate-900 text-right">{formatCurrency(emp.amount)}</td>
                      <td className="py-4 text-sm font-bold text-indigo-600 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <span>{emp.percentage.toFixed(1)}%</span>
                          <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${emp.percentage}%` }} />
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="py-8 text-center text-slate-400 font-medium">No data available</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="flex flex-col">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <h4 className="font-bold text-slate-800">Leave Analytics</h4>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input 
                type="text" 
                placeholder="Search employee..." 
                value={leaveSearch}
                onChange={(e) => setLeaveSearch(e.target.value)}
                className="pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/20 w-full sm:w-48"
              />
            </div>
          </div>
          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="pb-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Employee Name</th>
                  <th className="pb-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Annual</th>
                  <th className="pb-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Sick</th>
                  <th className="pb-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Family</th>
                  <th className="pb-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredLeave.length > 0 ? (
                  filteredLeave.map((emp: any, idx: number) => (
                    <tr key={idx} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50 transition-colors">
                      <td className="py-4 text-sm font-bold text-slate-700">{emp.name}</td>
                      <td className={`py-4 text-sm font-bold text-center ${getLeaveValueClassName(emp.annual)}`}>{emp.annual}</td>
                      <td className={`py-4 text-sm font-bold text-center ${getLeaveValueClassName(emp.sick)}`}>{emp.sick}</td>
                      <td className={`py-4 text-sm font-bold text-center ${getLeaveValueClassName(emp.family)}`}>{emp.family}</td>
                      <td className="py-4 text-right">
                        <button
                          type="button"
                          onClick={() => onViewLeaveEmployeeProfile?.(emp.name)}
                          className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-indigo-600 hover:text-indigo-700 transition-colors"
                        >
                          View More <ChevronRight className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-400 font-medium">No employees found</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
