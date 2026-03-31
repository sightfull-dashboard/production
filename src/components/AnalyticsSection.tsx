import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, ComposedChart, Area
} from 'recharts';
import { Loader2, TrendingUp, TrendingDown, Users, CalendarDays, Search, ChevronRight, Banknote, Activity, Wallet, History } from 'lucide-react';
import { cn } from '../lib/utils';
import { apiFetch } from '../lib/api';
import { format, subMonths } from 'date-fns';

const Card = ({ children, className }: { children: React.ReactNode, className?: string }) => (
  <div className={cn("bg-white rounded-[32px] shadow-sm border border-slate-100 p-6", className)}>
    {children}
  </div>
);

const COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#64748b'];


const SafeResponsiveChart = ({ children, minHeight = 300, className = '' }: { children: React.ReactNode; minHeight?: number; className?: string }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const update = () => {
      const rect = node.getBoundingClientRect();
      setReady(rect.width > 0 && rect.height > 0);
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className={cn('w-full h-full min-w-0', className)} style={{ minHeight }}>
      {ready ? <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer> : <div className="h-full min-h-[300px]" />}
    </div>
  );
};


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
      const json = await apiFetch<any>(`/api/analytics?month=${month}`);
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

  const formatLeaveMetric = (value: unknown) => {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return '0.0000';
    return numericValue.toFixed(4);
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

  const currentTotal = data?.kpis?.currentTotal || 0;
  const prevTotal = data?.kpis?.prevTotal || 0;
  const trend = prevTotal === 0 ? 0 : ((currentTotal - prevTotal) / prevTotal) * 100;
  const isPositiveTrend = trend > 0;
  const isNegativeTrend = trend < 0;

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h2 className="text-3xl font-black text-slate-800 tracking-tight">Analytics Overview</h2>
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
        <Card className="flex flex-col justify-between relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-50 rounded-bl-full -z-10 transition-transform group-hover:scale-110" />
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 rounded-2xl bg-indigo-100 flex items-center justify-center text-indigo-600">
              <Banknote className="w-6 h-6" />
            </div>
            {trend !== 0 && (
              <span className={cn(
                "text-xs font-bold px-3 py-1.5 rounded-full flex items-center gap-1",
                isPositiveTrend ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"
              )}>
                {isPositiveTrend ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {Math.abs(trend).toFixed(1)}%
              </span>
            )}
          </div>
          <div>
            <p className="text-sm font-bold text-slate-500 mb-1">Current Salary Bill</p>
            <h3 className="text-4xl font-black text-slate-800">{formatCurrency(currentTotal)}</h3>
          </div>
          <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Active Employees</span>
            <span className="text-sm font-black text-slate-700">{data?.kpis?.activeCount || 0}</span>
          </div>
        </Card>

        <Card className="flex flex-col justify-between relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-slate-50 rounded-bl-full -z-10 transition-transform group-hover:scale-110" />
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-600">
              <History className="w-6 h-6" />
            </div>
          </div>
          <div>
            <p className="text-sm font-bold text-slate-500 mb-1">Previous Month Bill</p>
            <h3 className="text-4xl font-black text-slate-800">{formatCurrency(prevTotal)}</h3>
          </div>
          <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Total Employees (Inc. Ex)</span>
            <span className="text-sm font-black text-slate-700">{data?.kpis?.totalEmployees || 0}</span>
          </div>
        </Card>

        <Card className="flex flex-col justify-between relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-50 rounded-bl-full -z-10 transition-transform group-hover:scale-110" />
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 rounded-2xl bg-emerald-100 flex items-center justify-center text-emerald-600">
              <Activity className="w-6 h-6" />
            </div>
          </div>
          <div>
            <p className="text-sm font-bold text-slate-500 mb-1">Avg Salary (Active)</p>
            <h3 className="text-4xl font-black text-slate-800">{formatCurrency(data?.kpis?.avgSalary || 0)}</h3>
          </div>
          <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Avg Weekly Bill (Non-Zero)</span>
            <span className="text-sm font-black text-slate-700">{formatCurrency(data?.kpis?.avgWeeklyBill || 0)}</span>
          </div>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="flex flex-col h-[400px]">
          <h4 className="font-bold text-slate-800 mb-6">Shifts vs Salary Bill (Weekly)</h4>
          <div className="flex-1 min-h-[320px] min-w-0">
            {data?.weeklyChart?.length > 0 ? (
              <SafeResponsiveChart minHeight={300}>
                <ComposedChart data={data.weeklyChart} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorAmount" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="#4f46e5" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="week" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12, fontWeight: 500 }} dy={10} />
                  <YAxis yAxisId="left" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12, fontWeight: 500 }} dx={-10} />
                  <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12, fontWeight: 500 }} dx={10} />
                  <Tooltip 
                    contentStyle={{ borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', padding: '12px' }}
                    itemStyle={{ fontWeight: 600 }}
                    formatter={(value: number, name: string) => [name === 'amount' ? formatCurrency(value) : value, name === 'amount' ? 'Salary Bill' : 'Shifts']}
                  />
                  <Legend wrapperStyle={{ paddingTop: '20px' }} iconType="circle" />
                  <Bar yAxisId="left" dataKey="shifts" name="Shifts Count" fill="#e2e8f0" radius={[6, 6, 6, 6]} barSize={32} />
                  <Area yAxisId="right" type="monotone" dataKey="amount" name="Salary Bill" stroke="#4f46e5" strokeWidth={3} fillOpacity={1} fill="url(#colorAmount)" activeDot={{ r: 6, strokeWidth: 0, fill: '#4f46e5' }} />
                </ComposedChart>
              </SafeResponsiveChart>
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
                  <SafeResponsiveChart minHeight={300}>
                    <PieChart>
                      <Pie
                        data={data.breakdown}
                        cx="50%"
                        cy="50%"
                        innerRadius={65}
                        outerRadius={90}
                        paddingAngle={4}
                        dataKey="amount"
                        cornerRadius={6}
                        stroke="none"
                      >
                        {data.breakdown.map((entry: any, index: number) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip 
                        contentStyle={{ borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', padding: '12px' }}
                        itemStyle={{ fontWeight: 600 }}
                        formatter={(value: number) => formatCurrency(value)} 
                      />
                    </PieChart>
                  </SafeResponsiveChart>
                </div>
                <div className="w-1/2 pl-4 overflow-y-auto max-h-full pr-2 min-w-0">
                  <div className="space-y-4">
                    {data.breakdown.map((item: any, idx: number) => (
                      <div key={idx} className="flex items-center justify-between group">
                        <div className="flex items-center gap-3">
                          <div className="w-3 h-3 rounded-full shadow-sm" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                          <span className="text-sm font-bold text-slate-600 group-hover:text-slate-900 transition-colors">{item.category}</span>
                        </div>
                        <span className="text-sm font-black text-slate-800">{formatCurrency(item.amount)}</span>
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
      <div className="grid grid-cols-1 gap-6">
        <Card className="p-0 overflow-hidden flex flex-col h-[420px]">
          <div className="p-6 pb-4 border-b border-slate-100">
            <h4 className="font-bold text-slate-800">Employees & Salary Share</h4>
          </div>
          <div className="overflow-auto flex-1">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50/50">
                <tr>
                  <th className="py-3 px-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">Employee Name</th>
                  <th className="py-3 px-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Salary Amount</th>
                  <th className="py-3 px-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">% of Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {data?.employeeShare?.length > 0 ? (
                  data.employeeShare.map((emp: any, idx: number) => (
                    <tr key={idx} className="hover:bg-slate-50/50 transition-colors group">
                      <td className="py-4 px-6 text-sm font-bold text-slate-700 group-hover:text-slate-900">{emp.name}</td>
                      <td className="py-4 px-6 text-sm font-black text-slate-900 text-right">{formatCurrency(emp.amount)}</td>
                      <td className="py-4 px-6 text-sm font-bold text-indigo-600 text-right">
                        <div className="flex items-center justify-end gap-3">
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

        <Card className="p-0 overflow-hidden flex flex-col h-[420px]">
          <div className="p-6 pb-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <h4 className="font-bold text-slate-800">Leave Analytics</h4>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input 
                type="text" 
                placeholder="Search employee..." 
                value={leaveSearch}
                onChange={(e) => setLeaveSearch(e.target.value)}
                className="pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/20 w-full sm:w-48 transition-all"
              />
            </div>
          </div>
          <div className="overflow-auto flex-1">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50/50">
                <tr>
                  <th className="py-3 px-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">Employee Name</th>
                  <th className="py-3 px-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Annual</th>
                  <th className="py-3 px-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Sick</th>
                  <th className="py-3 px-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Family</th>
                  <th className="py-3 px-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filteredLeave.length > 0 ? (
                  filteredLeave.map((emp: any, idx: number) => (
                    <tr key={idx} className="hover:bg-slate-50/50 transition-colors group">
                      <td className="py-4 px-6 text-sm font-bold text-slate-700 group-hover:text-slate-900">{emp.name}</td>
                      <td className={`py-4 px-6 text-sm font-bold text-center ${getLeaveValueClassName(emp.annual)}`}>{formatLeaveMetric(emp.annual)}</td>
                      <td className={`py-4 px-6 text-sm font-bold text-center ${getLeaveValueClassName(emp.sick)}`}>{formatLeaveMetric(emp.sick)}</td>
                      <td className={`py-4 px-6 text-sm font-bold text-center ${getLeaveValueClassName(emp.family)}`}>{formatLeaveMetric(emp.family)}</td>
                      <td className="py-4 px-6 text-right">
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
