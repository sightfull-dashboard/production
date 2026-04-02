import React, { Suspense, lazy, useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  LayoutDashboard,
  Users,
  Clock,
  CalendarDays,
  FileText,
  Files,
  LogOut,
  X,
  MoreVertical,
  Download,
  Plus,
  ShieldCheck,
  Loader2,
  Building2,
  Activity,
  Eye,
  EyeOff,
  RefreshCw,
  Lock,
  Bell,
  Inbox,
  ClipboardList,
  History,
  MessageSquare,
  AlertCircle,
  Send,
  Settings,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format, startOfWeek, addDays, differenceInDays, subDays } from 'date-fns';
import type { RosterDefinition, Shift, Employee, RosterAssignment, RosterMeta, OffboardReason, User, AuthStatus, LeaveRequest, SupportTicket, PayrollSubmission } from './types';
import { cn } from './lib/utils';
import { ApiError } from './lib/api';
import { buildActiveClientHeaders, clearStoredActiveClientId, getStoredActiveClientId, setStoredActiveClientId } from './lib/activeClient';
import { isEmployeePath, isSuperAdminPath, isInternalRole, isSuperAdminRole, normalizeUserRole } from './lib/auth';
import { COUNTRY_OF_ISSUE_OPTIONS, BANK_NAME_OPTIONS, SIDEBAR_LOGO as sidebarLogo } from './app/shared/formOptions';
import {
  compareEmployeeIds,
  formatAccountDisplayName,
  formatHourlyRateInput,
  formatLeaveInput,
  formatRoleLabel,
  formatStoredHourlyRate,
  generateAutoEmployeeId,
  getSidebarBrandLabel,
  normalizeSouthAfricanCell,
  parseHourlyRateInputToNumber,
  parseLeaveInputToNumber,
  phoneDigitsToLocalSa,
} from './app/shared/formatters';
import { Card, FeatureWrapper, Modal, SidebarItem, SuperAdminSidebarItem } from './app/shared/chrome';
import { ShiftsSection } from './components/ShiftsSection';
import { OffboardModal } from './components/OffboardModal';
import { Login } from './components/Login';
import { SuperAdminLogin } from './components/SuperAdminLogin';
import { EmployeeLogin } from './components/EmployeeLogin';
import { MfaSetup } from './components/MfaSetup';
import { MfaVerify } from './components/MfaVerify';
import { InternalNotifications } from './components/InternalNotifications';
import { Tooltip } from './components/Tooltip';

import { Toaster, toast } from 'sonner';
import { calculateEmployeePayroll } from './services/PayrollService';
import { appService } from './services/appService';
import { adminService } from './services/adminService';
import { isAdministrativeShift } from './lib/shifts';

const EmployeeSection = lazy(() => import('./components/EmployeeSection').then((module) => ({ default: module.EmployeeSection })));
const RosterSection = lazy(() => import('./components/RosterSection').then((module) => ({ default: module.RosterSection })));
const TimesheetSection = lazy(() => import('./components/TimesheetSection').then((module) => ({ default: module.TimesheetSection })));
const PayrollSubmissionsSection = lazy(() => import('./components/PayrollSubmissionsSection').then((module) => ({ default: module.PayrollSubmissionsSection })));
const FilesSection = lazy(() => import('./components/FilesSection').then((module) => ({ default: module.FilesSection })));
const LeaveSection = lazy(() => import('./components/LeaveSection').then((module) => ({ default: module.LeaveSection })));

type LeaveBalanceDelta = { annual: number; sick: number; family: number };
type LeaveBalanceDeltaMap = Record<string, LeaveBalanceDelta>;

const getLeaveBaselineKey = (clientKey: string) => `sd-leave-balance-baseline:${clientKey}`;

const buildLeaveSnapshot = (employees: Employee[]) => Object.fromEntries(
  employees.map((employee) => [String(employee.id), {
    annual: Number(employee.annual_leave || 0),
    sick: Number(employee.sick_leave || 0),
    family: Number(employee.family_leave || 0),
  }])
) as LeaveBalanceDeltaMap;

const buildLeaveDeltaMap = (current: LeaveBalanceDeltaMap, previous: LeaveBalanceDeltaMap | null) => {
  const deltaMap: LeaveBalanceDeltaMap = {};
  if (!previous) return deltaMap;
  for (const [employeeId, balances] of Object.entries(current)) {
    const prior = previous[employeeId];
    if (!prior) continue;
    const annual = Number((balances.annual - prior.annual).toFixed(4));
    const sick = Number((balances.sick - prior.sick).toFixed(4));
    const family = Number((balances.family - prior.family).toFixed(4));
    if (annual || sick || family) {
      deltaMap[employeeId] = { annual, sick, family };
    }
  }
  return deltaMap;
};
const EmployeeDashboard = lazy(() => import('./components/employee/EmployeeDashboard').then((module) => ({ default: module.EmployeeDashboard })));
const ApplyLeave = lazy(() => import('./components/employee/ApplyLeave').then((module) => ({ default: module.ApplyLeave })));
const MyLeave = lazy(() => import('./components/employee/MyLeave').then((module) => ({ default: module.MyLeave })));
const EmployeeCalendar = lazy(() => import('./components/employee/EmployeeCalendar').then((module) => ({ default: module.EmployeeCalendar })));
const EmployeeDocuments = lazy(() => import('./components/employee/EmployeeDocuments').then((module) => ({ default: module.EmployeeDocuments })));
const EmployeeProfile = lazy(() => import('./components/employee/EmployeeProfile').then((module) => ({ default: module.EmployeeProfile })));
const AdminPanel = lazy(() => import('./components/AdminPanel').then((module) => ({ default: module.AdminPanel })));
const InternalPanel = lazy(() => import('./components/InternalPanel').then((module) => ({ default: module.InternalPanel })));
const SupportTicketsPanel = lazy(() => import('./components/SupportTicketsPanel').then((module) => ({ default: module.SupportTicketsPanel })));
const ClientNotificationsPanel = lazy(() => import('./components/ClientNotificationsPanel').then((module) => ({ default: module.ClientNotificationsPanel })));
const AnalyticsSection = lazy(() => import('./components/AnalyticsSection').then((module) => ({ default: module.AnalyticsSection })));
const ActivityLogsPanel = lazy(() => import('./components/ActivityLogsPanel').then((module) => ({ default: module.ActivityLogsPanel })));
const SettingsSection = lazy(() => import('./components/SettingsSection').then((module) => ({ default: module.SettingsSection })));

const SectionLoader = () => (
  <div className="min-h-[240px] flex items-center justify-center">
    <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
  </div>
);

const ROSTER_LEAVE_LABEL_MAP: Record<string, { type: LeaveRequest['type']; isHalfDay?: boolean }> = {
  'annual leave': { type: 'annual' },
  'sick leave': { type: 'sick' },
  'family leave': { type: 'family' },
  'family responsibility leave': { type: 'family' },
  'unpaid leave': { type: 'unpaid' },
  'half day': { type: 'half_day', isHalfDay: true },
};

const toDateOnly = (value: string) => String(value || '').slice(0, 10);
const addDaysToDateOnly = (value: string, days: number) => {
  const date = new Date(`${toDateOnly(value)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return toDateOnly(value);
  date.setDate(date.getDate() + days);
  return format(date, 'yyyy-MM-dd');
};

const getWeekdayLeaveDayCount = (startDate: string, endDate: string, isHalfDay = false) => {
  if (isHalfDay) return startDate === endDate ? 0.5 : 0;
  const start = new Date(`${toDateOnly(startDate)}T00:00:00`);
  const end = new Date(`${toDateOnly(endDate)}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return 0;
  let count = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
};

const buildRosterDerivedLeaveRequests = (
  employees: Employee[],
  roster: RosterAssignment[],
  shifts: Shift[],
  existingRequests: LeaveRequest[]
): LeaveRequest[] => {
  if (!employees.length || !roster.length || !shifts.length) return [];

  const employeeMap = new Map(employees.map((employee) => [employee.id, employee]));
  const shiftMap = new Map(shifts.map((shift) => [shift.id, shift]));
  const existingKeys = new Set(
    existingRequests
      .filter((request) => request.status !== 'cancelled')
      .map((request) => `${request.employee_id}|${request.type}|${toDateOnly(request.start_date)}|${toDateOnly(request.end_date)}`)
  );

  const groupedByEmployee = new Map<string, Array<{ day_date: string; type: LeaveRequest['type']; is_half_day: boolean }>>();
  roster.forEach((assignment) => {
    if (!assignment.shift_id) return;
    const shift = shiftMap.get(String(assignment.shift_id));
    if (!shift) return;
    const leaveMeta = ROSTER_LEAVE_LABEL_MAP[String(shift.label || '').trim().toLowerCase()];
    if (!leaveMeta) return;
    const list = groupedByEmployee.get(assignment.employee_id) || [];
    list.push({ day_date: toDateOnly(assignment.day_date), type: leaveMeta.type, is_half_day: Boolean(leaveMeta.isHalfDay) });
    groupedByEmployee.set(assignment.employee_id, list);
  });

  const derived: LeaveRequest[] = [];
  groupedByEmployee.forEach((entries, employeeId) => {
    const employee = employeeMap.get(employeeId);
    if (!employee) return;
    const sortedEntries = [...entries].sort((a, b) => a.day_date.localeCompare(b.day_date));
    const segments: Array<{ type: LeaveRequest['type']; start_date: string; end_date: string; is_half_day: boolean }> = [];

    sortedEntries.forEach((entry) => {
      const previous = segments[segments.length - 1];
      const canExtend = Boolean(
        previous &&
        previous.type === entry.type &&
        !previous.is_half_day &&
        !entry.is_half_day &&
        addDaysToDateOnly(previous.end_date, 1) === entry.day_date
      );
      if (canExtend && previous) {
        previous.end_date = entry.day_date;
        return;
      }
      segments.push({
        type: entry.type,
        start_date: entry.day_date,
        end_date: entry.day_date,
        is_half_day: entry.is_half_day,
      });
    });

    segments.forEach((segment) => {
      const dedupeKey = `${employeeId}|${segment.type}|${segment.start_date}|${segment.end_date}`;
      if (existingKeys.has(dedupeKey)) return;
      const createdAt = `${segment.start_date}T00:00:00.000Z`;
      derived.push({
        id: `derived-roster-${employeeId}-${segment.type}-${segment.start_date}-${segment.end_date}`,
        employee_id: employeeId,
        employee_name: `${employee.first_name} ${employee.last_name}`.trim(),
        type: segment.type,
        start_date: segment.start_date,
        end_date: segment.end_date,
        is_half_day: segment.is_half_day,
        status: 'approved',
        notes: 'Assigned in roster',
        admin_notes: 'Displayed from roster assignment',
        created_at: createdAt,
        updated_at: createdAt,
        days: getWeekdayLeaveDayCount(segment.start_date, segment.end_date, segment.is_half_day),
        source: 'roster',
      });
    });
  });

  return derived;
};

export default function App() {
  const [isSuperAdminRoute, setIsSuperAdminRoute] = useState(isSuperAdminPath(window.location.pathname));
  const [isEmployeeRoute, setIsEmployeeRoute] = useState(isEmployeePath(window.location.pathname));
  const [auth, setAuth] = useState<AuthStatus>({ user: null, loading: true });
  const [employeeAuth, setEmployeeAuth] = useState<{ employee: Employee | null, loading: boolean }>({ employee: null, loading: true });

  const clearEmployeeAuth = () => setEmployeeAuth({ employee: null, loading: false });
  const [superAdminSection, setSuperAdminSection] = useState<'internal' | 'admin' | 'logs' | 'notifications' | 'tickets' | 'settings'>('internal');
  const [impersonatedClient, setImpersonatedClient] = useState<any | null>(null);
  const [lockedFeatures, setLockedFeatures] = useState<string[]>([]);
  const [enabledDefinitions, setEnabledDefinitions] = useState<RosterDefinition[]>(['salary_advance', 'shortages', 'unpaid_hours', 'staff_loan', 'notes']);
  const [rosterStartDay, setRosterStartDay] = useState<0 | 1 | 2 | 3 | 4 | 5 | 6>(1);
  const [rosterDuration, setRosterDuration] = useState<'1_week' | '2_weeks' | '1_month'>('1_week');
  const [rosterMode, setRosterMode] = useState<'Automated' | 'Hybrid' | 'Manual'>('Manual');
  const [rosterSeedWeekStart, setRosterSeedWeekStart] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState('analytics');
  const [leaveManagementEmployeeId, setLeaveManagementEmployeeId] = useState<string | null>(null);
  const [leaveBalanceDeltas, setLeaveBalanceDeltas] = useState<LeaveBalanceDeltaMap>({});
  const leaveBalanceSnapshotRef = useRef<LeaveBalanceDeltaMap | null>(null);
  const topBannerRef = useRef<HTMLDivElement | null>(null);
  const [topBannerHeight, setTopBannerHeight] = useState(0);
  
  const [clientTickets, setClientTickets] = useState<SupportTicket[]>([]);



  const openTicketsCount = clientTickets.filter(t => t.status === 'open' || t.status === 'in_progress').length;

  const [notifications, setNotifications] = useState<PayrollSubmission[]>([]);

  const superAdminPendingNotificationsCount = React.useMemo(
    () => notifications.filter((n) => n.status === 'pending').length,
    [notifications]
  );

  const [employeeSection, setEmployeeSection] = useState('dashboard');
  const [dobDisplay, setDobDisplay] = useState('');
  const [idNumberDisplay, setIdNumberDisplay] = useState('');
  const [passportDisplay, setPassportDisplay] = useState('');
  const [showCountryOfIssue, setShowCountryOfIssue] = useState(false);
  const [countryOfIssueInput, setCountryOfIssueInput] = useState('');
  const [isCountryOfIssueFocused, setIsCountryOfIssueFocused] = useState(false);
  const [bankNameInput, setBankNameInput] = useState('');
  const [isBankNameFocused, setIsBankNameFocused] = useState(false);
  const [annualLeaveDisplay, setAnnualLeaveDisplay] = useState('');
  const [sickLeaveDisplay, setSickLeaveDisplay] = useState('');
  const [familyLeaveDisplay, setFamilyLeaveDisplay] = useState('');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [roster, setRoster] = useState<RosterAssignment[]>([]);
  const [rosterMeta, setRosterMeta] = useState<RosterMeta[]>([]);
  const leaveOverrideWarningShownRef = useRef<Set<string>>(new Set());
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [currentWeekStart, setCurrentWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const getAlignedRosterStart = (baseDate: Date, startDay: 0 | 1 | 2 | 3 | 4 | 5 | 6) => startOfWeek(baseDate, { weekStartsOn: startDay });
  const getNextUnsubmittedRosterStart = useCallback((submissions: PayrollSubmission[], startDay: 0 | 1 | 2 | 3 | 4 | 5 | 6) => {
    const datedSubmissions = submissions
      .filter((submission) => String(submission.periodEnd || '').trim())
      .map((submission) => ({
        end: new Date(`${String(submission.periodEnd).trim()}T00:00:00`),
      }))
      .filter((entry) => !Number.isNaN(entry.end.getTime()))
      .sort((left, right) => right.end.getTime() - left.end.getTime());

    if (!datedSubmissions.length) {
      return getAlignedRosterStart(new Date(), startDay);
    }

    return getAlignedRosterStart(addDays(datedSubmissions[0].end, 1), startDay);
  }, []);
  
  // Modals
  const [isEmployeeModalOpen, setIsEmployeeModalOpen] = useState(false);
  const [formIsUnion, setFormIsUnion] = useState<'yes' | 'no' | ''>('');
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [autoGeneratedEmployeeId, setAutoGeneratedEmployeeId] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [generatedPin, setGeneratedPin] = useState<string>('');
  const [payRateDisplay, setPayRateDisplay] = useState('R000.0000');
  const [cellLocalDigits, setCellLocalDigits] = useState('');
  const [isShiftModalOpen, setIsShiftModalOpen] = useState(false);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [shiftFormCrossesSaturdayIntoSunday, setShiftFormCrossesSaturdayIntoSunday] = useState(false);
  const [isOffboardModalOpen, setIsOffboardModalOpen] = useState(false);
  const [offboardingEmployee, setOffboardingEmployee] = useState<Employee | null>(null);
  const [isSupportModalOpen, setIsSupportModalOpen] = useState(false);
  const [supportSubject, setSupportSubject] = useState('');
  const [supportMessage, setSupportMessage] = useState('');
  const [supportPriority, setSupportPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium');
  const [isSubmittingSupport, setIsSubmittingSupport] = useState(false);

  const clearClientWorkspaceState = useCallback(() => {
    clearStoredActiveClientId();
    setImpersonatedClient(null);
    setLockedFeatures([]);
    setEnabledDefinitions(['salary_advance', 'shortages', 'unpaid_hours', 'staff_loan', 'notes']);
    setRosterStartDay(1);
    setRosterDuration('1_week');
    setRosterMode('Manual');
    setRosterSeedWeekStart(null);
    setEmployees([]);
    setShifts([]);
    setRoster([]);
    setRosterMeta([]);
    setRequests([]);
    setLeaveManagementEmployeeId(null);
    setEditingEmployee(null);
    setActiveSection('internal');
    setSuperAdminSection('internal');
  }, []);

  const resetDashboardState = useCallback(() => {
    clearClientWorkspaceState();
    setNotifications([]);
    setClientTickets([]);
  }, [clearClientWorkspaceState]);


  const filteredCountryOfIssueOptions = useMemo(() => {
    const query = countryOfIssueInput.trim().toLowerCase();
    if (!query) return [];
    return COUNTRY_OF_ISSUE_OPTIONS.filter((country) => country.toLowerCase().includes(query)).slice(0, 8);
  }, [countryOfIssueInput]);

  const filteredBankNameOptions = useMemo(() => {
    const query = bankNameInput.trim().toLowerCase();
    if (!query) return [];
    return BANK_NAME_OPTIONS.filter((bank) => bank.toLowerCase().includes(query)).slice(0, 8);
  }, [bankNameInput]);

  useEffect(() => {
    const handlePopState = () => {
      setIsSuperAdminRoute(isSuperAdminPath(window.location.pathname));
      setIsEmployeeRoute(isEmployeePath(window.location.pathname));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    const hasClientScopedAccess = isEmployeeRoute
      ? Boolean(employeeAuth.employee)
      : Boolean(auth.user) && (!isSuperAdminRole(auth.user?.role) || Boolean(getVisibleClientId()));

    if (!hasClientScopedAccess) {
      if (!isEmployeeRoute) {
        setEmployees([]);
        setShifts([]);
        setRoster([]);
        setRosterMeta([]);
      }
      return;
    }

    void fetchEmployees();
    void fetchShifts();
    void fetchRoster();
    void fetchRosterMeta();
  }, [auth.user, isEmployeeRoute, employeeAuth.employee, currentWeekStart, impersonatedClient?.id]);

  useEffect(() => {
    const hasClientScopedAccess = isEmployeeRoute
      ? Boolean(employeeAuth.employee)
      : Boolean(auth.user) && (!isSuperAdminRole(auth.user?.role) || Boolean(getVisibleClientId()));

    if (!hasClientScopedAccess) {
      if (!isEmployeeRoute) {
        setRoster([]);
        setRosterMeta([]);
      }
      return;
    }

    void fetchRoster();
    void fetchRosterMeta();
  }, [employees, auth.user, isEmployeeRoute, employeeAuth.employee, impersonatedClient?.id]);

  const fetchEmployees = async () => {
    if (!isEmployeeRoute && isSuperAdminRole(auth.user?.role) && !getVisibleClientId()) {
      setEmployees([]);
      return;
    }
    try {
      const data = await appService.getEmployees();
      const visibleClientId = getVisibleClientId();
      const scoped = visibleClientId && !isEmployeeRoute
        ? data.filter((employee) => employee.client_id === visibleClientId)
        : data;
      setEmployees([...scoped].sort((left, right) => compareEmployeeIds(left.emp_id, right.emp_id)));
    } catch (error) {
      console.error('Failed to fetch employees:', error);
      setEmployees([]);
    } finally {
    }
  };

  const fetchShifts = async () => {
    if (!isEmployeeRoute && isSuperAdminRole(auth.user?.role) && !getVisibleClientId()) {
      setShifts([]);
      return;
    }
    try {
      const data = await appService.getShifts();
      setShifts(data);
    } catch (error) {
      console.error('Failed to fetch shifts:', error);
    } finally {
    }
  };

  const fetchRoster = async () => {
    if (!isEmployeeRoute && isSuperAdminRole(auth.user?.role) && !getVisibleClientId()) {
      setRoster([]);
      return;
    }
    try {
      const periodDays = rosterDuration === '2_weeks' ? 14 : rosterDuration === '1_month' ? 28 : 7;
      const rosterFetchStart = subDays(currentWeekStart, 1);
      const data = await appService.getRoster(format(rosterFetchStart, 'yyyy-MM-dd'), periodDays + 1);
      const employeeIds = new Set(employees.map((employee) => employee.id));
      setRoster(data.filter((row) => employeeIds.size === 0 || employeeIds.has(row.employee_id)));
    } catch (error) {
      console.error('Failed to fetch roster:', error);
      setRoster([]);
    } finally {
    }
  };

  const fetchRosterMeta = async () => {
    if (!isEmployeeRoute && isSuperAdminRole(auth.user?.role) && !getVisibleClientId()) {
      setRosterMeta([]);
      return;
    }
    try {
      const data = await appService.getRosterMeta(format(currentWeekStart, 'yyyy-MM-dd'));
      const employeeIds = new Set(employees.map((employee) => employee.id));
      setRosterMeta(data.filter((row) => employeeIds.size === 0 || employeeIds.has(row.employee_id)));
    } catch (error) {
      console.error('Failed to fetch roster meta:', error);
      setRosterMeta([]);
    } finally {
    }
  };

  const fetchLeaveRequests = async (employeeId?: string) => {
    if (!isEmployeeRoute && isSuperAdminRole(auth.user?.role) && !getVisibleClientId()) {
      setRequests([]);
      return [];
    }
    try {
      const shouldFetchScopedEmployee = Boolean(isEmployeeRoute && employeeId);
      const data = await appService.getLeaveRequests(shouldFetchScopedEmployee ? employeeId : undefined);
      setRequests(data);
      await fetchEmployees();
      return data;
    } catch (error) {
      console.error('Failed to fetch leave requests:', error);
      return [];
    }
  };

  const currentClientName = impersonatedClient?.name || auth.user?.client_name || auth.user?.clientName || null;
  const currentClientId = impersonatedClient?.id || auth.user?.client_id || null;
  const activeTrialSource = (() => {
    // Do not show the trial banner when a super admin is impersonating a client.
    if (impersonatedClient) return auth.user?.isTrial ? (auth.user as any) : null;
    if (impersonatedClient?.isTrial) return impersonatedClient;
    if (auth.user?.isTrial) return auth.user as any;
    return null;
  })();
  const activeTrialEndDate = activeTrialSource?.trialEndDate ? new Date(activeTrialSource.trialEndDate) : null;
  const activeTrialDaysRemaining = activeTrialEndDate && !Number.isNaN(activeTrialEndDate.getTime())
    ? Math.max(0, differenceInDays(activeTrialEndDate, new Date()))
    : null;

  useEffect(() => {
    const hasTopBanner = Boolean(impersonatedClient || activeTrialSource);
    if (!hasTopBanner) {
      setTopBannerHeight(0);
      return;
    }

    const measure = () => {
      setTopBannerHeight(topBannerRef.current?.offsetHeight ?? 0);
    };

    measure();

    const resizeObserver = typeof ResizeObserver !== 'undefined' && topBannerRef.current
      ? new ResizeObserver(() => measure())
      : null;

    if (resizeObserver && topBannerRef.current) {
      resizeObserver.observe(topBannerRef.current);
    }

    window.addEventListener('resize', measure);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [impersonatedClient, activeTrialSource]);
  const currentClientNotifications = React.useMemo(() => {
    if (!currentClientName) {
      return notifications;
    }
    return notifications.filter((n) => n.clientName === currentClientName);
  }, [notifications, currentClientName]);

  const currentClientTickets = React.useMemo(() => {
    if (!currentClientId && !currentClientName) {
      return clientTickets;
    }
    return clientTickets.filter((ticket) => {
      if (currentClientId && ticket.client_id === currentClientId) return true;
      if (currentClientName && ticket.client_name === currentClientName) return true;
      return false;
    });
  }, [clientTickets, currentClientId, currentClientName]);

  const currentClientPendingPayrollCount = React.useMemo(
    () => currentClientNotifications.filter((n) => n.status === 'pending').length,
    [currentClientNotifications]
  );

  const currentClientOpenTicketCount = React.useMemo(
    () => currentClientTickets.filter((ticket) => ticket.status === 'open' || ticket.status === 'in_progress').length,
    [currentClientTickets]
  );

  const fetchPayrollSubmissions = async () => {
    try {
      const data = await appService.getPayrollSubmissions();
      setNotifications(data);
      return data;
    } catch (error) {
      console.error('Failed to fetch payroll submissions:', error);
      return [];
    }
  };

  const fetchSupportTickets = async () => {
    try {
      const data = await appService.getSupportTickets();
      setClientTickets(data);
      return data;
    } catch (error) {
      console.error('Failed to fetch support tickets:', error);
      return [];
    }
  };

  const applyUserDashboardContext = (user: any) => {
    setLockedFeatures(user?.lockedFeatures || []);
    setEnabledDefinitions(user?.enabledDefinitions || ['salary_advance', 'shortages', 'unpaid_hours', 'staff_loan', 'notes']);
    setRosterStartDay(user?.roster_start_day ?? 1);
    setRosterDuration(user?.roster_duration || '1_week');
    const apiRosterMode = user?.rosterMode || user?.roster_mode || 'Manual';
    const apiRosterSeed = user?.rosterSeedWeekStart || user?.roster_seed_week_start || null;
    let localRosterMode = apiRosterMode;
    let localRosterSeed = apiRosterSeed;
    try {
      const key = getRosterPrefsStorageKey(user?.client_id || null);
      const saved = JSON.parse(localStorage.getItem(key) || 'null');
      if (saved?.rosterMode) localRosterMode = saved.rosterMode;
      if (Object.prototype.hasOwnProperty.call(saved || {}, 'rosterSeedWeekStart')) localRosterSeed = saved.rosterSeedWeekStart;
    } catch {}
    setRosterMode(localRosterMode);
    setRosterSeedWeekStart(localRosterSeed);
    setCurrentWeekStart(getAlignedRosterStart(new Date(), user?.roster_start_day ?? 1));
  };

  const applyImpersonatedClientContext = (client: any) => {
    if (!client?.id) return false;
    const clientStatus = String(client?.status || 'active').trim().toLowerCase();
    if (clientStatus === 'deactivated') {
      clearClientWorkspaceState();
      return false;
    }
    setImpersonatedClient(client);
    setStoredActiveClientId(client.id);
    setLockedFeatures(client.lockedFeatures || []);
    setEnabledDefinitions(client.enabledDefinitions || ['salary_advance', 'shortages', 'unpaid_hours', 'staff_loan', 'notes']);
    setRosterStartDay(client.rosterStartDay ?? 1);
    setRosterDuration(client.rosterDuration || '1_week');
    setRosterMode(client.rosterMode || client.roster_mode || 'Manual');
    setRosterSeedWeekStart(client.rosterSeedWeekStart || client.roster_seed_week_start || null);
    setCurrentWeekStart(getAlignedRosterStart(new Date(), client.rosterStartDay ?? 1));
    setActiveSection('analytics');
    return true;
  };

  const restoreStoredSuperAdminClient = async () => {
    const storedClientId = getStoredActiveClientId();
    if (!storedClientId) return null;
    try {
      const clients = await adminService.getClients();
      const matched = (clients || []).find((client: any) => String(client?.id || '') === storedClientId) || null;
      if (!matched || String(matched?.status || 'active').trim().toLowerCase() === 'deactivated') {
        clearStoredActiveClientId();
        return null;
      }
      return matched;
    } catch (error) {
      console.error('Failed to restore stored super admin client context:', error);
      return null;
    }
  };

  const exitImpersonation = () => {
    clearClientWorkspaceState();
    if (auth.user) {
      applyUserDashboardContext(auth.user);
    }
  };

  const checkAuth = async () => {
    if (isEmployeeRoute) {
      setAuth({ user: null, loading: false });
      try {
        const employee = await appService.getEmployeeSession();
        if (!employee) {
          clearEmployeeAuth();
          return;
        }
        setEmployeeAuth({ employee, loading: false });
      } catch (err) {
        clearEmployeeAuth();
      }
      return;
    }

    clearEmployeeAuth();
    try {
      const user = await appService.getAuthUser();
      if (!user) {
        resetDashboardState();
        setAuth({ user: null, loading: false });
        return;
      }
      const normalizedUser = { ...user, role: normalizeUserRole(user.role) ?? 'user' } as any;
      const restoredClient = isInternalRole(normalizedUser.role) ? await restoreStoredSuperAdminClient() : null;
      setAuth({ user: normalizedUser, loading: false });
      if (restoredClient) {
        const restored = applyImpersonatedClientContext(restoredClient);
        if (!restored) {
          toast.error('That client dashboard is deactivated.');
        }
      } else {
        if (isInternalRole(normalizedUser.role)) {
          setImpersonatedClient(null);
          setActiveSection('internal');
          setSuperAdminSection('internal');
        } else {
          clearStoredActiveClientId();
          setActiveSection('analytics');
        }
        applyUserDashboardContext(normalizedUser);
      }
    } catch (err) {
      resetDashboardState();
      setAuth({ user: null, loading: false });
    }
  };

  useEffect(() => {
    checkAuth();
  }, [isEmployeeRoute]);

  useEffect(() => {
    setDobDisplay(editingEmployee?.dob ? toDateInputValue(String(editingEmployee.dob)) : '');
    setIdNumberDisplay(editingEmployee?.id_number || '');
    setPassportDisplay(editingEmployee?.passport || '');
    setShowCountryOfIssue(Boolean(editingEmployee?.passport));
    setCountryOfIssueInput(editingEmployee?.country_of_issue || '');
    setBankNameInput(editingEmployee?.bank_name || '');
    setIsCountryOfIssueFocused(false);
    setIsBankNameFocused(false);
    setPayRateDisplay(editingEmployee?.pay_rate != null ? formatStoredHourlyRate(editingEmployee.pay_rate) : 'R000.0000');
    setAnnualLeaveDisplay(editingEmployee?.annual_leave != null ? formatLeaveInput(String(editingEmployee.annual_leave)) : '00.0000');
    setSickLeaveDisplay(editingEmployee?.sick_leave != null ? formatLeaveInput(String(editingEmployee.sick_leave)) : '00.0000');
    setFamilyLeaveDisplay(editingEmployee?.family_leave != null ? formatLeaveInput(String(editingEmployee.family_leave)) : '00.0000');
  }, [editingEmployee]);

  useEffect(() => {
    try {
      if (impersonatedClient?.id) {
        setStoredActiveClientId(impersonatedClient.id);
      } else if ((auth.user?.role || '').toLowerCase() !== 'superadmin') {
        clearStoredActiveClientId();
      }
    } catch {}
  }, [impersonatedClient?.id, auth.user?.role]);

  useEffect(() => {
    if (!impersonatedClient?.id) return;
    if (String(impersonatedClient?.status || 'active').trim().toLowerCase() !== 'deactivated') return;
    clearClientWorkspaceState();
    toast.error('That client dashboard is deactivated.');
  }, [impersonatedClient?.id, impersonatedClient?.status, clearClientWorkspaceState]);

  useEffect(() => {
    const handleClientDeactivated = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : null;
      const message = typeof detail === 'object' && detail && 'error' in detail
        ? String((detail as { error?: unknown }).error || 'This client dashboard has been deactivated.')
        : 'This client dashboard has been deactivated.';

      if (isSuperAdminRole(auth.user?.role)) {
        clearClientWorkspaceState();
      } else {
        resetDashboardState();
        setAuth({ user: null, loading: false });
      }

      clearEmployeeAuth();
      toast.error(message);
    };

    const handleClientContextCleared = (event: Event) => {
      if (!isSuperAdminRole(auth.user?.role)) return;
      const detail = event instanceof CustomEvent ? event.detail : null;
      const message = typeof detail === 'object' && detail && 'error' in detail
        ? String((detail as { error?: unknown }).error || 'No active client dashboard selected.')
        : 'No active client dashboard selected.';

      clearClientWorkspaceState();
      toast.error(message);
    };

    window.addEventListener('sightfull:client-deactivated', handleClientDeactivated as EventListener);
    window.addEventListener('sightfull:client-context-cleared', handleClientContextCleared as EventListener);
    return () => {
      window.removeEventListener('sightfull:client-deactivated', handleClientDeactivated as EventListener);
      window.removeEventListener('sightfull:client-context-cleared', handleClientContextCleared as EventListener);
    };
  }, [auth.user?.role, clearClientWorkspaceState, resetDashboardState]);


  useEffect(() => {
    if (isEmployeeRoute) {
      if (employeeAuth.employee) {
        void fetchLeaveRequests(employeeAuth.employee.id);
      }
      return;
    }

    if (auth.user && (!isSuperAdminRole(auth.user?.role) || Boolean(getVisibleClientId()))) {
      void fetchLeaveRequests();
    } else if (!isEmployeeRoute) {
      setRequests([]);
    }
  }, [auth.user, employeeAuth.employee, isEmployeeRoute, impersonatedClient?.id]);

  useEffect(() => {
    if (!isEmployeeRoute && auth.user) {
      void fetchPayrollSubmissions();
      void fetchSupportTickets();
      return;
    }

    if (!auth.user) {
      setNotifications([]);
      setClientTickets([]);
    }
  }, [auth.user, isEmployeeRoute]);

  const rosterAutoSelectKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (isEmployeeRoute || !auth.user) return;
    if (isSuperAdminRole(auth.user?.role) && !getVisibleClientId()) return;

    const clientKey = `${getVisibleClientId() || auth.user.client_id || 'default'}:${rosterStartDay}:${rosterDuration}:${currentClientNotifications.length}`;
    if (rosterAutoSelectKeyRef.current === clientKey) return;

    const preferredWeekStart = getNextUnsubmittedRosterStart(currentClientNotifications, rosterStartDay);
    rosterAutoSelectKeyRef.current = clientKey;
    setCurrentWeekStart(preferredWeekStart);
  }, [auth.user, isEmployeeRoute, impersonatedClient?.id, currentClientNotifications, rosterStartDay, rosterDuration, getNextUnsubmittedRosterStart]);

  const handleLogin = async (email: string, password: string) => {
    try {
      const user = await appService.login(email, password);
      const normalizedUser = { ...user, role: normalizeUserRole(user.role) ?? 'user' } as any;
      resetDashboardState();
      setAuth({ user: normalizedUser, loading: false });
      setImpersonatedClient(null);
      clearStoredActiveClientId();
      applyUserDashboardContext(normalizedUser);
      setSuperAdminSection('internal');
      setActiveSection(isInternalRole(normalizedUser.role) ? 'internal' : 'analytics');
      toast.success('Welcome back!');
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(err.message || 'Login failed');
      } else {
        toast.error('An error occurred during login');
      }
      throw err;
    }
  };

  const activeEmployees = useMemo(() => employees.filter(e => e.status !== 'offboarded'), [employees]);

  const combinedLeaveRequests = useMemo(() => {
    const rosterDerivedRequests = buildRosterDerivedLeaveRequests(activeEmployees, roster, shifts, requests);
    return [...requests, ...rosterDerivedRequests].sort((a, b) => {
      const aDate = new Date(a.start_date).getTime();
      const bDate = new Date(b.start_date).getTime();
      return bDate - aDate;
    });
  }, [activeEmployees, roster, shifts, requests]);
  const visibleShiftsForManagement = useMemo(
    () => (isSuperAdminRole(auth.user?.role) ? shifts : shifts.filter((shift) => !isAdministrativeShift(shift))),
    [auth.user?.role, shifts],
  );

  const handleOpenLeaveEmployeeProfile = useCallback((employeeName: string) => {
    const normalizedTarget = String(employeeName || '').trim().toLowerCase();
    if (!normalizedTarget) {
      setLeaveManagementEmployeeId(null);
      setActiveSection('leave');
      return;
    }

    const matchedEmployee = activeEmployees.find((employee) => {
      const fullName = `${employee.first_name || ''} ${employee.last_name || ''}`.trim().toLowerCase();
      const invertedName = `${employee.last_name || ''} ${employee.first_name || ''}`.trim().toLowerCase();
      return fullName === normalizedTarget || invertedName === normalizedTarget;
    }) || null;

    setLeaveManagementEmployeeId(matchedEmployee ? String(matchedEmployee.id) : null);
    setActiveSection('leave');
  }, [activeEmployees]);

  function getVisibleClientId() {
    if (isSuperAdminRole(auth.user?.role)) {
      return impersonatedClient?.id || getStoredActiveClientId() || null;
    }
    return auth.user?.client_id || null;
  }

  const leaveDeltaClientKey = getVisibleClientId() || 'default';

  useEffect(() => {
    if (typeof window === 'undefined') return;
    leaveBalanceSnapshotRef.current = null;
  }, [leaveDeltaClientKey]);

  useEffect(() => {
    const currentSnapshot = buildLeaveSnapshot(activeEmployees);
    if (typeof window === 'undefined') {
      setLeaveBalanceDeltas({});
      return;
    }

    const baselineKey = getLeaveBaselineKey(leaveDeltaClientKey);
    let baselineSnapshot = leaveBalanceSnapshotRef.current;
    if (!baselineSnapshot) {
      try {
        const rawSnapshot = window.sessionStorage.getItem(baselineKey);
        baselineSnapshot = rawSnapshot ? JSON.parse(rawSnapshot) : null;
      } catch {
        baselineSnapshot = null;
      }
    }

    if (!baselineSnapshot || Object.keys(baselineSnapshot).length === 0) {
      baselineSnapshot = currentSnapshot;
      try {
        window.sessionStorage.setItem(baselineKey, JSON.stringify(currentSnapshot));
      } catch {}
    }

    leaveBalanceSnapshotRef.current = baselineSnapshot;
    setLeaveBalanceDeltas(buildLeaveDeltaMap(currentSnapshot, baselineSnapshot));
  }, [activeEmployees, leaveDeltaClientKey]);

  useEffect(() => {
    if (!auth.user) return;
    if (isInternalRole(auth.user.role)) return;
    if (activeSection === 'internal') {
      setActiveSection('analytics');
    }
  }, [auth.user, activeSection]);

  useEffect(() => {
    if (isSuperAdminRole(auth.user?.role) && !impersonatedClient) {
      document.title = 'Super Admin Panel - Sightfull Dashboard';
      return;
    }

    const clientName = String(impersonatedClient?.name || auth.user?.client_name || auth.user?.clientName || '').trim();
    document.title = clientName ? `${clientName} - Sightfull Dashboard` : 'Sightfull Dashboard';
  }, [auth.user?.role, impersonatedClient?.name, auth.user?.client_name, auth.user?.clientName]);


  const getRosterPrefsStorageKey = (clientId?: string | null) => `sightfull:roster-prefs:${clientId || 'default'}`;

  const persistRosterPreferences = async (nextMode: 'Automated' | 'Hybrid' | 'Manual', nextSeedWeekStart: string | null) => {
    const clientId = getVisibleClientId();
    try {
      if (clientId) {
        localStorage.setItem(getRosterPrefsStorageKey(clientId), JSON.stringify({ rosterMode: nextMode, rosterSeedWeekStart: nextSeedWeekStart }));
      }
    } catch {}
    if (!clientId) return;
    try {
      await fetch('/api/client/roster-preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...buildActiveClientHeaders() },
        body: JSON.stringify({ rosterMode: nextMode, rosterSeedWeekStart: nextSeedWeekStart }),
      });
    } catch (error) {
      console.error('Failed to persist roster preferences:', error);
    }
  };

  const sanitizeString = (value: FormDataEntryValue | null) => String(value ?? '').trim();
  const titleCase = (value: string) => value
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
  const normalizeDigits = (value: string) => value.replace(/\D/g, '');
  const normalizeTextInput = (value: string) => value.replace(/\d/g, '');
  const normalizeNumericInput = (value: string) => value.replace(/\D/g, '');
  const handleTextOnlyInput = (event: React.FormEvent<HTMLInputElement>) => {
    const target = event.currentTarget;
    const nextValue = normalizeTextInput(target.value);
    if (target.value !== nextValue) target.value = nextValue;
  };
  const handleNumberOnlyInput = (event: React.FormEvent<HTMLInputElement>) => {
    const target = event.currentTarget;
    const nextValue = normalizeNumericInput(target.value);
    if (target.value !== nextValue) target.value = nextValue;
  };
  const createDigitLimiter = (maxDigits: number) => (event: React.FormEvent<HTMLInputElement>) => {
    const target = event.currentTarget;
    const nextValue = normalizeNumericInput(target.value).slice(0, maxDigits);
    if (target.value !== nextValue) target.value = nextValue;
  };
  const handleDateFieldInput = (event: React.FormEvent<HTMLInputElement>) => {
    const target = event.currentTarget;
    let value = String(target.value || '');
    if (!value) {
      target.setCustomValidity('');
      return;
    }
    const match = value.match(/^(\d{4,})-(\d{2})-(\d{2})$/);
    if (match && match[1].length > 4) {
      value = `${match[1].slice(0, 4)}-${match[2]}-${match[3]}`;
      target.value = value;
    }
    target.setCustomValidity(/^\d{4}-\d{2}-\d{2}$/.test(value) && !isValidDateInput(value) ? 'Please enter a valid calendar date.' : '');
  };
  const normalizeFlexibleDateInput = (value: string) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const match = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})$/);
    if (!match) return raw;
    const [, d, m, y] = match;
    const yy = Number(y);
    const fullYear = y.length === 4 ? yy : (yy <= Number(new Date().getFullYear().toString().slice(-2)) ? 2000 + yy : 1900 + yy);
    return `${String(fullYear).padStart(4,'0')}-${String(Number(m)).padStart(2,'0')}-${String(Number(d)).padStart(2,'0')}`;
  };
  const isValidDateInput = (value: string) => {
    const normalized = normalizeFlexibleDateInput(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return false;
    const [year, month, day] = normalized.split('-').map(Number);
    const candidate = new Date(Date.UTC(year, month - 1, day));
    return candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day;
  };
  const isValidSouthAfricanTaxNumber = (value: string) => {
    const digits = normalizeDigits(value);
    if (!/^[01239]\d{9}$/.test(digits)) return false;
    const baseDigits = digits.slice(0, 9);
    const checkDigit = Number(digits[9]);
    let total = 0;
    for (let index = 0; index < baseDigits.length; index += 1) {
      let digit = Number(baseDigits[index]);
      if (index % 2 === 0) {
        digit *= 2;
        if (digit > 9) digit = Math.floor(digit / 10) + (digit % 10);
      }
      total += digit;
    }
    const lastDigit = total % 10;
    const expectedCheckDigit = lastDigit === 0 ? 0 : 10 - lastDigit;
    return checkDigit === expectedCheckDigit;
  };
  const calculateAge = (dateOfBirth: string) => {
    const today = new Date();
    const dob = new Date(`${dateOfBirth}T00:00:00`);
    let age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
      age -= 1;
    }
    return age;
  };
  const luhnChecksum = (digits: string) => {
    let sum = 0;
    let doubleDigit = false;
    for (let index = digits.length - 1; index >= 0; index -= 1) {
      let digit = Number(digits[index]);
      if (doubleDigit) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
      doubleDigit = !doubleDigit;
    }
    return sum % 10 === 0;
  };
  const isValidSouthAfricanId = (value: string) => {
    const digits = normalizeDigits(value);
    if (!/^\d{13}$/.test(digits)) return false;
    const yy = Number(digits.slice(0, 2));
    const mm = Number(digits.slice(2, 4));
    const dd = Number(digits.slice(4, 6));
    const currentYearTwoDigits = Number(new Date().getFullYear().toString().slice(-2));
    const fullYear = yy <= currentYearTwoDigits ? 2000 + yy : 1900 + yy;
    const candidate = new Date(Date.UTC(fullYear, mm - 1, dd));
    const validDate = candidate.getUTCFullYear() == fullYear && candidate.getUTCMonth() === mm - 1 && candidate.getUTCDate() === dd;
    if (!validDate) return false;
    return luhnChecksum(digits);
  };


  const getDobDisplayFromSouthAfricanId = (value: string) => {
    const digits = normalizeDigits(value);
    if (!isValidSouthAfricanId(digits)) return '';
    const yy = Number(digits.slice(0, 2));
    const mm = digits.slice(2, 4);
    const dd = digits.slice(4, 6);
    const currentYY = Number(new Date().getFullYear().toString().slice(-2));
    const fullYear = yy <= currentYY ? 2000 + yy : 1900 + yy;
    return `${fullYear}-${mm}-${dd}`;
  };


  const toDateInputValue = (value?: string | null) => {
    const normalized = normalizeFlexibleDateInput(String(value || '').replace(/\//g, '-'));
    return normalized || '';
  };

  const normalizeImportedDateValue = (value: unknown) => {
    if (value === null || value === undefined || value === '') return '';

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.toISOString().slice(0, 10);
    }

    const raw = String(value).trim();
    if (!raw) return '';

    if (/^\d{5}(?:\.\d+)?$/.test(raw)) {
      const serial = Number(raw);
      if (!Number.isNaN(serial)) {
        const utcDays = Math.floor(serial - 25569);
        const utcValue = utcDays * 86400;
        return new Date(utcValue * 1000).toISOString().slice(0, 10);
      }
    }

    return normalizeFlexibleDateInput(raw.replace(/\//g, '-'));
  };

  const buildEmployeePayload = (formData: FormData) => {
    const canManageLeaveValues = isSuperAdminRole(auth.user?.role);

    return {
      emp_id: sanitizeString(formData.get('emp_id')),
      pin: sanitizeString(formData.get('pin')),
      first_name: sanitizeString(formData.get('first_name')),
      last_name: sanitizeString(formData.get('last_name')),
      start_date: normalizeFlexibleDateInput(sanitizeString(formData.get('start_date'))),
      dob: normalizeFlexibleDateInput((dobDisplay || sanitizeString(formData.get('dob'))).replace(/\//g, '-')),
      job_title: sanitizeString(formData.get('job_title')),
      department: sanitizeString(formData.get('department')),
      pay_rate: parseHourlyRateInputToNumber(sanitizeString(formData.get('pay_rate'))),
      email: sanitizeString(formData.get('email')),
      cell: normalizeSouthAfricanCell(sanitizeString(formData.get('cell'))),
      residency: sanitizeString(formData.get('residency')),
      street_number: sanitizeString(formData.get('street_number')),
      id_number: sanitizeString(formData.get('id_number')),
      passport: sanitizeString(formData.get('passport')),
      bank_name: sanitizeString(formData.get('bank_name')),
      country_of_issue: showCountryOfIssue ? sanitizeString(formData.get('country_of_issue')) : '',
      province: sanitizeString(formData.get('province')),
      account_holder: sanitizeString(formData.get('account_holder')),
      account_no: sanitizeString(formData.get('account_no')),
      account_type: sanitizeString(formData.get('account_type')),
      tax_number: sanitizeString(formData.get('tax_number')),
      ismibco: sanitizeString(formData.get('ismibco')),
      isunion: sanitizeString(formData.get('isunion')),
      union_name: sanitizeString(formData.get('union_name')),
      address1: sanitizeString(formData.get('address1')),
      address2: sanitizeString(formData.get('address2')),
      address3: sanitizeString(formData.get('address3')),
      address4: sanitizeString(formData.get('address4')),
      postal_code: sanitizeString(formData.get('postal_code')),
      paye_credit: sanitizeString(formData.get('paye_credit')),
      classification: sanitizeString(formData.get('classification')),
      annual_leave: canManageLeaveValues ? parseLeaveInputToNumber(annualLeaveDisplay || sanitizeString(formData.get('annual_leave'))) : 0,
      sick_leave: canManageLeaveValues ? parseLeaveInputToNumber(sickLeaveDisplay || sanitizeString(formData.get('sick_leave'))) : 0,
      family_leave: canManageLeaveValues ? parseLeaveInputToNumber(familyLeaveDisplay || sanitizeString(formData.get('family_leave'))) : 0,
    };
  };

  const validateEmployeeFormPayload = (employeeData: ReturnType<typeof buildEmployeePayload>, options?: { allowBlankPin?: boolean }) => {
    employeeData.emp_id = employeeData.emp_id.toUpperCase();
    employeeData.email = employeeData.email.toLowerCase();
    employeeData.first_name = titleCase(employeeData.first_name);
    employeeData.last_name = titleCase(employeeData.last_name);
    employeeData.job_title = titleCase(employeeData.job_title);
    employeeData.department = titleCase(employeeData.department);
    employeeData.passport = employeeData.passport.toUpperCase();
    employeeData.id_number = normalizeDigits(employeeData.id_number);
    employeeData.tax_number = normalizeDigits(employeeData.tax_number);
    employeeData.postal_code = normalizeDigits(employeeData.postal_code);
    employeeData.account_no = normalizeDigits(employeeData.account_no);
    employeeData.start_date = normalizeFlexibleDateInput(employeeData.start_date);
    employeeData.dob = normalizeFlexibleDateInput(employeeData.dob);
    employeeData.street_number = employeeData.street_number.replace(/\s+/g, ' ').trim();
    employeeData.paye_credit = employeeData.paye_credit.replace(/[^\d.\-]/g, '');
    employeeData.cell = employeeData.cell.replace(/[^\d+]/g, '');

    const missingFields: string[] = [];
    if (!employeeData.first_name) missingFields.push('first name');
    if (!employeeData.last_name) missingFields.push('last name');
    if (!employeeData.start_date) missingFields.push('start date');
    if (!employeeData.pay_rate) missingFields.push('hourly rate');
    if (!(employeeData.id_number || employeeData.passport)) missingFields.push('ID number or passport');
    if (missingFields.length > 0) return `Please complete the following required fields: ${missingFields.join(', ')}.`;
    if (employeeData.id_number && employeeData.passport) return 'Please capture either an ID number or a passport number, not both.';

    if (employeeData.first_name && /\d/.test(employeeData.first_name)) {
      return 'First name cannot contain numbers.';
    }

    if (employeeData.last_name && /\d/.test(employeeData.last_name)) {
      return 'Last name cannot contain numbers.';
    }

    if (employeeData.job_title && /\d/.test(employeeData.job_title)) {
      return 'Job title cannot contain numbers.';
    }

    if (employeeData.department && /\d/.test(employeeData.department)) {
      return 'Department cannot contain numbers.';
    }

    if (employeeData.bank_name && /\d/.test(employeeData.bank_name)) {
      return 'Bank name cannot contain numbers.';
    }

    const addressLinePattern = /^[A-Za-z0-9\s'\-.,/#]+$/;

    if (employeeData.address1 && !addressLinePattern.test(employeeData.address1)) {
      return 'Address Line 1 contains invalid characters.';
    }

    if (employeeData.address2 && !addressLinePattern.test(employeeData.address2)) {
      return 'Address Line 2 contains invalid characters.';
    }

    if (employeeData.address3 && !addressLinePattern.test(employeeData.address3)) {
      return 'Address Line 3 contains invalid characters.';
    }

    if (employeeData.street_number && !addressLinePattern.test(employeeData.street_number)) {
      return 'Street Number contains invalid characters.';
    }

    if (!/^[A-Z0-9_-]{3,20}$/.test(employeeData.emp_id)) {
      return 'Employee ID must be 3 to 20 characters and can only contain letters, numbers, hyphens, and underscores.';
    }

    if (employeeData.pin && !/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/.test(employeeData.pin)) {
      return 'Portal PIN must be at least 8 characters and include uppercase, lowercase, a number, and a special character.';
    }

    if (!/^[A-Za-z .'-]{2,50}$/.test(employeeData.first_name)) {
      return 'Please enter a valid first name.';
    }

    if (!/^[A-Za-z .'-]{2,50}$/.test(employeeData.last_name)) {
      return 'Please enter a valid last name.';
    }

    if (employeeData.id_number && !isValidSouthAfricanId(employeeData.id_number)) return 'Please enter a valid South African ID number.';
    if (employeeData.id_number && isValidSouthAfricanId(employeeData.id_number)) {
      employeeData.dob = getDobDisplayFromSouthAfricanId(employeeData.id_number);
    }

    if (!isValidDateInput(employeeData.dob) || !isValidDateInput(employeeData.start_date)) {
      return 'Please enter valid date values for date of birth and start date.';
    }


    const dobDate = new Date(`${employeeData.dob}T00:00:00`);
    const startDate = new Date(`${employeeData.start_date}T00:00:00`);
    const now = new Date();
    if (dobDate > now) {
      return 'Date of birth cannot be in the future.';
    }

    if (calculateAge(employeeData.dob) < 16) {
      return 'Employee must be at least 16 years old.';
    }

    if (startDate < dobDate) {
      return 'Start date cannot be before date of birth.';
    }

    if (employeeData.passport && !/^[A-Z0-9]{6,20}$/.test(employeeData.passport)) return 'Passport number must be 6 to 20 letters or numbers.';
    if (!employeeData.id_number && employeeData.passport && !employeeData.country_of_issue) return 'Country of issue is required when passport is used.';
    if (!employeeData.id_number && employeeData.passport && !employeeData.dob) return 'Date of birth is required when passport is used.';
    if (employeeData.country_of_issue && !COUNTRY_OF_ISSUE_OPTIONS.includes(employeeData.country_of_issue as typeof COUNTRY_OF_ISSUE_OPTIONS[number])) {
      return 'Please select a valid country of issue from the list.';
    }
    if (employeeData.bank_name && !BANK_NAME_OPTIONS.includes(employeeData.bank_name as typeof BANK_NAME_OPTIONS[number])) {
      return 'Please select a valid bank name from the list.';
    }

    if (employeeData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(employeeData.email)) {
      return 'Please enter a valid employee email address.';
    }

    if (employeeData.cell) {
      const digits = normalizeDigits(employeeData.cell);
      if (!/^27\d{9}$/.test(digits)) {
        return 'Please enter a valid South African cellphone number.';
      }
    }

    if (!Number.isFinite(employeeData.pay_rate) || employeeData.pay_rate <= 0) return 'Hourly rate must be greater than 0.';
    if (String(employeeData.pay_rate).includes('.') && String(employeeData.pay_rate).split('.')[1].length > 4) return 'Hourly rate can have up to 4 decimal places.';

    if (employeeData.tax_number && !/^\d{10}$/.test(employeeData.tax_number)) {
      return 'Tax number must be 10 digits.';
    }
    if (employeeData.tax_number && !isValidSouthAfricanTaxNumber(employeeData.tax_number)) {
      return 'Please enter a valid South African tax number.';
    }

    if (employeeData.postal_code && !/^\d{4}$/.test(employeeData.postal_code)) {
      return 'Postal code must be 4 digits.';
    }

    if (employeeData.account_no && !/^\d{6,20}$/.test(employeeData.account_no)) {
      return 'Account number must be 6 to 20 digits.';
    }

    const hasBankingData = Boolean(employeeData.bank_name || employeeData.account_no || employeeData.account_type);
    if (hasBankingData && !(employeeData.bank_name && employeeData.account_no && employeeData.account_type)) return 'Please complete all banking fields when capturing bank details.';

    if (employeeData.account_type && !['savings', 'cheque', 'current', 'transmission', 'bond'].includes(employeeData.account_type)) {
      return 'Please select a valid account type.';
    }

    if (employeeData.isunion === 'yes' && !employeeData.union_name) {
      return 'Please select a union when union membership is set to Yes.';
    }

    if (employeeData.isunion !== 'yes') {
      employeeData.union_name = '';
    }

    if (isSuperAdminRole(auth.user?.role)) {
      for (const [label, value] of [['Annual leave', employeeData.annual_leave], ['Sick leave', employeeData.sick_leave], ['Family leave', employeeData.family_leave]] as const) {
        if (!Number.isFinite(value) || value < 0) return `${label} must be 0 or more.`;
        if (String(value).includes('.') && String(value).split('.')[1].length > 4) return `${label} can have up to 4 decimal places.`;
      }
    } else {
      employeeData.annual_leave = 0;
      employeeData.sick_leave = 0;
      employeeData.family_leave = 0;
    }

    return null;
  };

  const rosterTitle = rosterDuration === '2_weeks' ? 'Fortnightly Roster' : rosterDuration === '1_month' ? 'Monthly Roster' : 'Weekly Roster';

  useEffect(() => {
    if (!isShiftModalOpen) {
      setShiftFormCrossesSaturdayIntoSunday(false);
      return;
    }
    setShiftFormCrossesSaturdayIntoSunday(Boolean(editingShift?.crosses_saturday_into_sunday));
  }, [isShiftModalOpen, editingShift]);

  const isAdministrativeShiftLabel = (label: string) => isAdministrativeShift({ label });

  const getShiftWindowMinutes = (start: string, end: string) => {
    if (!start || !end) return 0;
    const [startHour, startMinute] = start.split(':').map(Number);
    const [endHour, endMinute] = end.split(':').map(Number);
    if ([startHour, startMinute, endHour, endMinute].some((value) => Number.isNaN(value))) return 0;

    let startTotal = startHour * 60 + startMinute;
    let endTotal = endHour * 60 + endMinute;
    if (endTotal <= startTotal) endTotal += 24 * 60;
    return Math.max(0, endTotal - startTotal);
  };

  const buildShiftPayload = (formData: FormData, shiftId?: string) => {
    const label = sanitizeString(formData.get('label'));
    const isAdministrative = isAdministrativeShiftLabel(label);
    const crossesSaturdayIntoSunday = !isAdministrative && (String(formData.get('crosses_saturday_into_sunday') || '').toLowerCase() === 'on' || String(formData.get('crosses_saturday_into_sunday') || '').toLowerCase() === 'true');
    return {
      id: shiftId || Math.random().toString(36).substr(2, 9),
      label,
      start: isAdministrative ? '' : sanitizeString(formData.get('start')),
      end: isAdministrative ? '' : sanitizeString(formData.get('end')),
      lunch: isAdministrative ? 0 : (Number(sanitizeString(formData.get('lunch'))) || 0),
      crosses_saturday_into_sunday: crossesSaturdayIntoSunday,
      saturday_lunch_hours: isAdministrative || !crossesSaturdayIntoSunday ? 0 : (Number(sanitizeString(formData.get('saturday_lunch_hours'))) || 0),
      sunday_lunch_hours: isAdministrative || !crossesSaturdayIntoSunday ? 0 : (Number(sanitizeString(formData.get('sunday_lunch_hours'))) || 0),
    };
  };

  const validateShiftFormPayload = (shiftData: ReturnType<typeof buildShiftPayload>) => {
    if (!shiftData.label) {
      return 'Please complete all required shift fields.';
    }

    const isAdministrative = isAdministrativeShiftLabel(shiftData.label);
    if (!isAdministrative && (!shiftData.start || !shiftData.end)) {
      return 'Please complete all required shift fields.';
    }

    if (!Number.isInteger(shiftData.lunch) || shiftData.lunch < 0) {
      return 'Lunch must be 0 or more minutes.';
    }

    const shiftWindowMinutes = getShiftWindowMinutes(shiftData.start, shiftData.end);
    if (!isAdministrative && shiftWindowMinutes > 0 && shiftData.lunch > shiftWindowMinutes) {
      return 'Lunch break cannot exceed the shift time window.';
    }

    const saturdayLunchHours = Number(shiftData.saturday_lunch_hours || 0);
    const sundayLunchHours = Number(shiftData.sunday_lunch_hours || 0);
    if (saturdayLunchHours < 0 || sundayLunchHours < 0) {
      return 'Saturday and Sunday lunch hours must be 0 or more.';
    }

    if (!shiftData.crosses_saturday_into_sunday && (saturdayLunchHours > 0 || sundayLunchHours > 0)) {
      return 'Saturday and Sunday lunch hours can only be set when the Saturday to Sunday overlap option is enabled.';
    }

    if (!isAdministrative && shiftData.crosses_saturday_into_sunday) {
      const [startHour, startMinute] = String(shiftData.start || '').split(':').map(Number);
      const [endHour, endMinute] = String(shiftData.end || '').split(':').map(Number);
      if ([startHour, startMinute, endHour, endMinute].some((value) => Number.isNaN(value))) {
        return 'A valid overnight shift is required for the Saturday to Sunday overlap option.';
      }
      const startTotal = startHour * 60 + startMinute;
      const endTotal = endHour * 60 + endMinute;
      if (endTotal > startTotal) {
        return 'The Saturday to Sunday overlap option can only be used on overnight shifts that end the next day.';
      }

      const saturdayPortionHours = Math.max(0, (24 * 60 - startTotal) / 60);
      const sundayPortionHours = Math.max(0, endTotal / 60);
      if (saturdayLunchHours > saturdayPortionHours) {
        return 'Saturday lunch hours cannot exceed the Saturday portion of the shift.';
      }
      if (sundayLunchHours > sundayPortionHours) {
        return 'Sunday lunch hours cannot exceed the Sunday portion of the shift.';
      }
      if (((saturdayLunchHours + sundayLunchHours) * 60) > shiftData.lunch + 0.0001) {
        return 'Saturday and Sunday lunch hours cannot exceed the total lunch minutes.';
      }
    }

    return null;
  };


  const handleLogout = async () => {
    try {
      if (isEmployeeRoute) {
        await appService.logoutEmployee();
        clearEmployeeAuth();
        setEmployeeSection('dashboard');
        toast.success('Signed out successfully');
        return;
      }

      await appService.logout();
      setAuth({ user: null, loading: false });
      clearEmployeeAuth();
      resetDashboardState();
      toast.success('Signed out successfully');
    } catch (error) {
      console.error('Logout failed:', error);
      toast.error('Failed to sign out');
    }
  };

  const handleProcessNotification = async (id: string) => {
    try {
      const updated = await appService.updatePayrollSubmissionStatus(id, 'processed');
      setNotifications(prev => prev.map(n => n.id === id ? updated : n));
      toast.success('Payroll submission marked as processed');
    } catch (error) {
      console.error('Failed to process payroll submission:', error);
      toast.error(error instanceof ApiError ? error.message : 'Failed to update payroll submission');
    }
  };

  const handleRevertNotification = async (id: string) => {
    try {
      const updated = await appService.updatePayrollSubmissionStatus(id, 'pending');
      setNotifications(prev => prev.map(n => n.id === id ? updated : n));
      toast.success('Payroll submission reverted to pending');
    } catch (error) {
      console.error('Failed to revert payroll submission:', error);
      toast.error(error instanceof ApiError ? error.message : 'Failed to update payroll submission');
    }
  };


  const handleDeletePayrollSubmission = async (id: string) => {
    if (!window.confirm('Delete this payroll submission? This cannot be undone.')) return;
    try {
      await appService.deletePayrollSubmission(id);
      setNotifications((prev) => prev.filter((submission) => submission.id !== id));
      toast.success('Payroll submission deleted');
    } catch (error) {
      console.error('Failed to delete payroll submission:', error);
      toast.error(error instanceof ApiError ? error.message : 'Failed to delete payroll submission');
    }
  };

  const handleDeleteSupportTicket = async (ticket: SupportTicket) => {
    if (!window.confirm(`Delete support ticket "${ticket.subject}"? This cannot be undone.`)) return;
    try {
      await appService.deleteSupportTicket(ticket.id);
      setClientTickets((prev) => prev.filter((row) => row.id !== ticket.id));
      toast.success('Support ticket deleted');
    } catch (error) {
      console.error('Failed to delete support ticket:', error);
      toast.error(error instanceof ApiError ? error.message : 'Failed to delete support ticket');
    }
  };

  // --- Handlers ---

  const handleSaveEmployee = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const employeeData = buildEmployeePayload(formData) as ReturnType<typeof buildEmployeePayload>;
    if (!editingEmployee && !isSuperAdminRole(auth.user?.role)) {
      employeeData.emp_id = autoGeneratedEmployeeId || generateAutoEmployeeId(employees);
    }
    const validationError = validateEmployeeFormPayload(employeeData);

    if (validationError) {
      toast.error(validationError);
      return;
    }

    try {
      if (editingEmployee) {
        await appService.saveEmployee(employeeData, editingEmployee.id);
      } else {
        await appService.saveEmployee(employeeData);
      }

      await fetchEmployees();
      setIsEmployeeModalOpen(false);
      setEditingEmployee(null);
      setAutoGeneratedEmployeeId('');
      setPayRateDisplay('R000.0000');
      setBankNameInput('');
      setCellLocalDigits('');
      toast.success(`Employee ${editingEmployee ? 'updated' : 'added'} successfully`);
    } catch (error) {
      console.error('Employee save failed (validation/backend):', error);
      if (error instanceof ApiError) {
        toast.error(error.message || 'Failed to save employee');
      } else {
        toast.error(`An error occurred while saving: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  };

  const handleImportEmployees = async (data: any[]) => {
    if (!isSuperAdminRole(auth.user?.role)) {
      toast.error('Only Super Admin can import employee spreadsheet files');
      return;
    }

    const activeClientId = getVisibleClientId();
    if (!activeClientId) {
      toast.error('Select a client dashboard before importing employees');
      return;
    }

    let successCount = 0;
    let failCount = 0;
    const failures: string[] = [];
    const toastId = toast.loading('Importing employees...');

    const parseImportedLeaveAmount = (value: unknown) => {
      const raw = String(value ?? '').trim();
      if (!raw) return 0;
      const parsed = Number.parseFloat(raw.replace(/,/g, ''));
      if (!Number.isFinite(parsed) || parsed < 0) return 0;
      return Number(parsed.toFixed(4));
    };

    const parseOptionalImportYear = (...values: unknown[]) => {
      for (const value of values) {
        const raw = String(value ?? '').trim();
        if (!raw) continue;
        const parsed = Number.parseInt(raw, 10);
        if (Number.isInteger(parsed) && parsed >= 1900 && parsed <= 3000) return parsed;
      }
      return undefined;
    };

    for (const row of data) {
      const employeeData = {
        emp_id: String(row.emp_id || row['Employee ID'] || '').trim(),
        first_name: String(row.first_name || row['First Name'] || '').trim(),
        last_name: String(row.last_name || row['Last Name'] || '').trim(),
        email: String(row.email || row['Email'] || '').trim(),
        cell: normalizeSouthAfricanCell(String(row.cell || row['Cell'] || '').trim()),
        department: String(row.department || row['Department'] || 'Unassigned').trim(),
        job_title: String(row.job_title || row['Job Title'] || 'Unassigned').trim(),
        pay_rate: parseFloat(row.pay_rate || row['Pay Rate'] || '0') || 0,
        start_date: normalizeImportedDateValue(row.start_date || row['Start Date'] || new Date()),
        dob: normalizeImportedDateValue(row.dob || row['Date of Birth'] || ''),
        id_number: String(row.id_number || row['ID Number'] || '').trim(),
        passport: String(row.passport || row['Passport'] || '').trim(),
        country_of_issue: String(row.country_of_issue || row['Country Of Issue'] || row['Country of Issue'] || '').trim(),
        province: String(row.province || row['Province'] || '').trim(),
        portal_enabled: String(row.portal_enabled || row['Employee Portal'] || 'no').trim().toLowerCase() === 'yes' ? 'yes' : 'no',
        bank_name: String(row.bank_name || row['Bank Name'] || '').trim(),
        account_no: String(row.account_no || row['Account Number'] || '').trim(),
        account_holder: String(row.account_holder || row['Account Holder'] || '').trim(),
        account_type: String(row.account_type || row['Account Type'] || '').trim().toLowerCase(),
        tax_number: String(row.tax_number || row['Tax Number'] || '').trim(),
        paye_credit: String(row.paye_credit || row['PAYE Credit'] || '').trim(),
        classification: String(row.classification || row['Classification'] || '').trim(),
        residency: String(row.residency || row['Residency'] || '').trim(),
        street_number: String(row.street_number || row['Street Number'] || '').trim(),
        address1: String(row.address1 || row['Address Line 1'] || '').trim(),
        address2: String(row.address2 || row['Address Line 2'] || '').trim(),
        address3: String(row.address3 || row['Address Line 3'] || '').trim(),
        address4: String(row.address4 || row['Address Line 4'] || '').trim(),
        postal_code: String(row.postal_code || row['Postal Code'] || '').trim(),
        ismibco: String(row.ismibco || row['MIBCO'] || '').trim().toLowerCase() === 'yes' ? 'yes' : 'no',
        isunion: String(row.isunion || row['Union'] || '').trim().toLowerCase() === 'yes' ? 'yes' : 'no',
        union_name: String(row.union_name || row['Union Name'] || '').trim(),
        annual_leave: parseImportedLeaveAmount(row.annual_leave ?? row['Annual Leave']),
        sick_leave: parseImportedLeaveAmount(row.sick_leave ?? row['Sick Leave']),
        family_leave: parseImportedLeaveAmount(row.family_leave ?? row['Family Leave']),
        family_leave_last_reset_year: parseOptionalImportYear(row.family_leave_last_reset_year, row['Family Leave Last Reset Year'], row['Grant Year Reset'], row.family_leave_last_grant_year, row['Family Leave Last Grant Year']),
        pin: String(row.pin || row['PIN'] || row['Pin'] || '').trim(),
              };

      if (!employeeData.dob && employeeData.id_number && isValidSouthAfricanId(employeeData.id_number)) {
        employeeData.dob = getDobDisplayFromSouthAfricanId(employeeData.id_number);
      }

      const validationError = validateEmployeeFormPayload(employeeData as ReturnType<typeof buildEmployeePayload>, { allowBlankPin: true });
      if (validationError) {
        failCount++;
        failures.push(`${employeeData.first_name || employeeData.emp_id || 'Row'}: ${validationError}`);
        continue;
      }

      try {
        await appService.saveEmployee(employeeData);
        successCount++;
      } catch (error) {
        console.error('Error importing row:', error);
        failCount++;
        failures.push(`${employeeData.first_name || employeeData.emp_id || 'Row'}: ${error instanceof ApiError ? error.message : 'Unknown error'}`);
      }
    }

    await fetchEmployees();
    toast.dismiss(toastId);
    if (successCount > 0) toast.success(`Successfully imported ${successCount} employees`);
    if (failCount > 0) toast.error(`Failed to import ${failCount} rows`, { description: failures.slice(0, 3).join(' | ') });
  };

  const handleDeleteEmployee = async (id: string) => {
    if (!confirm('Are you sure you want to delete this employee? If payroll history exists, the employee will be offboarded instead of fully deleted.')) return;

    try {
      const result = await appService.deleteEmployee(id) as { offboarded?: boolean; deleted?: boolean; reason?: string } | undefined;
      await fetchEmployees();
      await fetchRoster();
      await fetchRosterMeta();
      if (result?.offboarded) {
        toast.success(`Employee was offboarded instead of deleted${result.reason ? ` (${result.reason})` : ''}`);
      } else {
        toast.success('Employee deleted successfully');
      }
    } catch (error) {
      console.error('Error deleting employee:', error);
      if (error instanceof ApiError) {
        toast.error(error.message || 'Failed to delete employee');
      } else {
        toast.error(`An error occurred during deletion: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  };


  const handleRestoreEmployee = async (employee: Employee) => {
    if (!isSuperAdminRole(auth.user?.role)) {
      toast.error('Only Super Admin can restore off-boarded employees');
      return;
    }
    if (!confirm(`Restore ${employee.first_name} ${employee.last_name} and keep all linked history?`)) return;

    try {
      await appService.restoreEmployee(employee.id);
      await fetchEmployees();
      await fetchRoster();
      await fetchRosterMeta();
      toast.success('Employee restored successfully');
    } catch (error) {
      console.error('Error restoring employee:', error);
      if (error instanceof ApiError) {
        toast.error(error.message || 'Failed to restore employee');
      } else {
        toast.error(`An error occurred during restore: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  };

  const handleSaveShift = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const shiftData = buildShiftPayload(formData, editingShift?.id);
    const validationError = validateShiftFormPayload(shiftData);

    if (validationError) {
      toast.error(validationError);
      return;
    }

    try {
      if (editingShift) {
        await appService.saveShift(shiftData, editingShift.id);
      } else {
        await appService.saveShift(shiftData);
      }

      await fetchShifts();
      setIsShiftModalOpen(false);
      setEditingShift(null);
      toast.success(`Shift ${editingShift ? 'updated' : 'added'} successfully`);
    } catch (error) {
      console.error('Error saving shift:', error);
      if (error instanceof ApiError) {
        toast.error(error.message || 'Failed to save shift');
      } else {
        toast.error(`An error occurred while saving shift: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  };

  const handleDeleteShift = async (id: string) => {
    if (!confirm('Are you sure you want to delete this shift?')) return;
    try {
      await appService.deleteShift(id);
      await fetchShifts();
      toast.success('Shift deleted successfully');
    } catch (error) {
      console.error('Error deleting shift:', error);
      if (error instanceof ApiError) {
        toast.error(error.message || 'Failed to delete shift');
      } else {
        toast.error(`An error occurred during deletion: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  };

  const handleOffboard = async (data: { 
    reason: OffboardReason, 
    otherReason?: string, 
    lastWorked: string,
    preparePayslip: boolean,
    generateUIF: boolean
  }) => {
    if (!offboardingEmployee) return;
    if (!isValidDateInput(data.lastWorked)) {
      toast.error('Please enter a valid termination date.');
      return;
    }
    if (offboardingEmployee.start_date && data.lastWorked < offboardingEmployee.start_date) {
      toast.error('Termination date cannot be before the employee start date.');
      return;
    }
    
    try {
      const res = await fetch(`/api/employees/${offboardingEmployee.id}/offboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...buildActiveClientHeaders() },
        body: JSON.stringify(data),
      });

      if (res.ok) {
        await fetchEmployees();
        setIsOffboardModalOpen(false);
        setOffboardingEmployee(null);
        toast.success('Employee off-boarded successfully');
      } else {
        const err = await res.json();
        toast.error(`Failed to offboard employee: ${err.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error offboarding employee:', error);
      toast.error(`An error occurred during offboarding: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleSupportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingSupport(true);

    try {
      await appService.createSupportTicket({
        subject: supportSubject,
        message: supportMessage,
        priority: supportPriority,
        client_id: currentClientId,
        client_name: currentClientName,
        user_email: auth.user?.email || 'unknown@sightfull.local',
      });
      setIsSupportModalOpen(false);
      setSupportSubject('');
      setSupportMessage('');
      setSupportPriority('medium');
      toast.success('Support ticket submitted successfully. Our team will get back to you soon.');
      if (auth.user && isSuperAdminRole(auth.user.role)) {
        await fetchSupportTickets();
      }
    } catch (error) {
      console.error('Failed to submit support ticket:', error);
      toast.error(error instanceof ApiError ? error.message : 'Failed to submit support ticket');
    } finally {
      setIsSubmittingSupport(false);
    }
  };

  const getLeaveWarningMessage = (employeeName: string, shiftLabel: string, balance: number) => `Are you sure you want to assign ${shiftLabel} to ${employeeName}? ${employeeName.split(' ')[0]} currently has ${balance.toFixed(4)} leave days available. You can still continue with an admin override if needed.`;

  const updateRoster = async (employeeId: string, dayDate: string, shiftId: string | null) => {
    const previousRoster = roster;
    setRoster((current) => {
      const withoutCurrent = current.filter((row) => !(row.employee_id === employeeId && row.day_date === dayDate));
      if (!shiftId) return withoutCurrent;
      return [...withoutCurrent, { employee_id: employeeId, day_date: dayDate, shift_id: shiftId } as any];
    });
    try {
      const employee = employees.find(emp => emp.id === employeeId);
      const selectedShift = shifts.find(shift => shift.id === shiftId);
      const normalizedShiftLabel = String(selectedShift?.label || '').trim().toLowerCase();
      const leaveTypeKey = normalizedShiftLabel === 'annual leave' || normalizedShiftLabel === 'half day'
        ? 'annual_leave'
        : normalizedShiftLabel === 'sick leave'
          ? 'sick_leave'
          : normalizedShiftLabel === 'family leave'
            ? 'family_leave'
            : null;

      if (employee && leaveTypeKey) {
        const employeeName = `${employee.first_name} ${employee.last_name}`.trim() || employee.emp_id;
        const balanceRaw = Number((employee as any)[leaveTypeKey] ?? 0);
        const balance = Number.isFinite(balanceRaw) ? balanceRaw : 0;
        const warningKey = employeeId;
        if (balance <= 0 && !leaveOverrideWarningShownRef.current.has(warningKey)) {
          const shouldContinue = window.confirm(
            getLeaveWarningMessage(employeeName, selectedShift?.label || 'leave', balance)
          );
          if (!shouldContinue) return;
          leaveOverrideWarningShownRef.current.add(warningKey);
        }
      }

      const res = await fetch('/api/roster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...buildActiveClientHeaders() },
        body: JSON.stringify({ employee_id: employeeId, day_date: dayDate, shift_id: shiftId, admin_override: true, allow_negative_balance: true }),
      });
      if (res.ok) {
        const savedRow = await res.json();
        setRoster((current) => {
          const withoutCurrent = current.filter((row) => !(row.employee_id === employeeId && row.day_date === dayDate));
          if (!savedRow?.shift_id) return withoutCurrent;
          return [...withoutCurrent, savedRow as any];
        });
        if (!rosterSeedWeekStart) {
          const nextSeed = format(currentWeekStart, 'yyyy-MM-dd');
          setRosterSeedWeekStart(nextSeed);
          void persistRosterPreferences(rosterMode, nextSeed);
        }
        await fetchRoster();
        await fetchLeaveRequests();
        await fetchEmployees();
      } else {
        setRoster(previousRoster);
        const err = await res.json();
        toast.error(`Failed to update roster: ${err.error || 'Unknown error'}`);
      }
    } catch (error) {
      setRoster(previousRoster);
      console.error('Error updating roster:', error);
      toast.error(`An error occurred while updating roster: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const updateMeta = async (employeeId: string, field: keyof RosterMeta, value: string) => {
    const weekStart = format(currentWeekStart, 'yyyy-MM-dd');

    try {
      const res = await fetch('/api/roster-meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...buildActiveClientHeaders() },
        body: JSON.stringify({ 
          employee_id: employeeId, 
          week_start: weekStart, 
          field, 
          value 
        }),
      });
      if (res.ok) {
        const savedMeta = await res.json().catch(() => null);
        setRosterMeta((current) => {
          const withoutCurrent = current.filter((row) => !(row.employee_id === employeeId && row.week_start === weekStart));

          if (savedMeta && typeof savedMeta === 'object') {
            return [...withoutCurrent, savedMeta as RosterMeta];
          }

          const existing = current.find((row) => row.employee_id === employeeId && row.week_start === weekStart);
          return [
            ...withoutCurrent,
            {
              ...(existing || {}),
              employee_id: employeeId,
              week_start: weekStart,
              [field]: value,
            } as RosterMeta,
          ];
        });
      } else {
        const err = await res.json();
        toast.error(`Failed to update additional info: ${err.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error updating roster meta:', error);
      toast.error(`An error occurred while updating additional info: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  // --- Renderers ---

  if (auth.loading || employeeAuth.loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-12 h-12 text-indigo-600 animate-spin" />
      </div>
    );
  }

  if (isEmployeeRoute) {
    if (!employeeAuth.employee) {
      return <EmployeeLogin onLogin={async (identifier, pin) => {
        const employee = await appService.loginEmployee(identifier, pin);
        setEmployeeAuth({ employee, loading: false });
        await fetchLeaveRequests(employee.id);
        toast.success('Welcome to your portal!');
      }} />;
    }
    return (
      <div className="flex min-h-screen bg-slate-50">
        <Toaster position="top-right" richColors />
        <aside className="hidden lg:flex fixed left-0 top-0 bottom-0 w-72 bg-white/80 backdrop-blur-xl border-r border-white/20 p-8 flex-col z-50">
          <div className="flex items-center gap-3 mb-12 px-2">
            <div className="w-12 h-12 bg-emerald-600 rounded-2xl flex items-center justify-center shadow-xl shadow-emerald-200">
              <Users className="w-7 h-7 text-white" />
            </div>
            <div className="flex flex-col">
              <h1 className="text-2xl font-black text-slate-800 tracking-tighter leading-none">SIGHTFULL</h1>
              <span className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.2em] mt-1">Employee Portal</span>
            </div>
          </div>

          <nav className="flex-1 space-y-2">
            <SidebarItem icon={LayoutDashboard} label="Dashboard" active={employeeSection === 'dashboard'} onClick={() => setEmployeeSection('dashboard')} theme="emerald" />
            <SidebarItem icon={Plus} label="Apply Leave" active={employeeSection === 'apply-leave'} onClick={() => setEmployeeSection('apply-leave')} theme="emerald" />
            <SidebarItem icon={Clock} label="My Leave" active={employeeSection === 'my-leave'} onClick={() => setEmployeeSection('my-leave')} theme="emerald" />
            <SidebarItem icon={CalendarDays} label="Calendar" active={employeeSection === 'calendar'} onClick={() => setEmployeeSection('calendar')} theme="emerald" />
            <SidebarItem icon={Files} label="Documents" active={employeeSection === 'documents'} onClick={() => setEmployeeSection('documents')} theme="emerald" />
            <SidebarItem icon={Users} label="Profile" active={employeeSection === 'profile'} onClick={() => setEmployeeSection('profile')} theme="emerald" />
          </nav>

          <div className="pt-8 mt-8 border-t border-slate-100">
            <div className="bg-slate-50 rounded-[24px] p-5 mb-6 border border-slate-100 shadow-sm">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-2xl bg-emerald-100 flex items-center justify-center text-emerald-600 font-black text-sm shadow-sm">
                  {employeeAuth.employee.first_name[0]}{employeeAuth.employee.last_name[0]}
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-black text-slate-800 truncate max-w-[120px]">{employeeAuth.employee.first_name}</span>
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{employeeAuth.employee.job_title}</span>
                </div>
              </div>
              <button 
                onClick={handleLogout}
                className="flex items-center gap-2 w-full text-[10px] font-black text-rose-500 hover:text-rose-600 transition-colors uppercase tracking-widest"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </button>
            </div>
            <p className="text-[9px] text-slate-400 font-black text-center uppercase tracking-[0.3em]">{getSidebarBrandLabel({ clientName: impersonatedClient?.name || auth.user?.client_name || auth.user?.clientName || null, client_name: auth.user?.client_name || null, isSuperAdmin: auth.user?.role === 'superadmin' })}</p>
          </div>
        </aside>

        {/* Mobile Bottom Nav */}
        <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-xl border-t border-slate-100 px-6 py-4 flex items-center justify-between z-50">
          <button onClick={() => setEmployeeSection('dashboard')} className={cn("p-2 rounded-xl transition-all", employeeSection === 'dashboard' ? "bg-emerald-100 text-emerald-600" : "text-slate-400")}>
            <LayoutDashboard className="w-6 h-6" />
          </button>
          <button onClick={() => setEmployeeSection('apply-leave')} className={cn("p-2 rounded-xl transition-all", employeeSection === 'apply-leave' ? "bg-emerald-100 text-emerald-600" : "text-slate-400")}>
            <Plus className="w-6 h-6" />
          </button>
          <button onClick={() => setEmployeeSection('my-leave')} className={cn("p-2 rounded-xl transition-all", employeeSection === 'my-leave' ? "bg-emerald-100 text-emerald-600" : "text-slate-400")}>
            <Clock className="w-6 h-6" />
          </button>
          <button onClick={() => setEmployeeSection('calendar')} className={cn("p-2 rounded-xl transition-all", employeeSection === 'calendar' ? "bg-emerald-100 text-emerald-600" : "text-slate-400")}>
            <CalendarDays className="w-6 h-6" />
          </button>
          <button onClick={() => setEmployeeSection('profile')} className={cn("p-2 rounded-xl transition-all", employeeSection === 'profile' ? "bg-emerald-100 text-emerald-600" : "text-slate-400")}>
            <Users className="w-6 h-6" />
          </button>
        </nav>

        <main className="flex-1 lg:ml-72 p-6 md:p-12 overflow-y-auto pb-32 lg:pb-12">
          <motion.div
            key={employeeSection}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="max-w-7xl mx-auto"
          >
            <Suspense fallback={<SectionLoader />}>
              {employeeSection === 'dashboard' && <EmployeeDashboard employee={employeeAuth.employee} onApplyLeave={() => setEmployeeSection('apply-leave')} />}
              {employeeSection === 'apply-leave' && <ApplyLeave employee={employeeAuth.employee} onSuccess={async () => { await fetchLeaveRequests(employeeAuth.employee.id); setEmployeeSection('my-leave'); }} onCancel={() => setEmployeeSection('dashboard')} />}
              {employeeSection === 'my-leave' && <MyLeave employee={employeeAuth.employee} requests={combinedLeaveRequests.filter(req => req.employee_id === employeeAuth.employee.id)} onCancelRequest={async (id) => { await appService.cancelLeaveRequest(id); await fetchLeaveRequests(employeeAuth.employee.id); toast.success('Leave request cancelled'); }} />}
              {employeeSection === 'calendar' && <EmployeeCalendar employee={employeeAuth.employee} teamLeave={combinedLeaveRequests.filter(req => req.status === 'approved')} />}
              {employeeSection === 'documents' && <EmployeeDocuments employee={employeeAuth.employee} />}
              {employeeSection === 'profile' && <EmployeeProfile employee={employeeAuth.employee} leaveRequests={combinedLeaveRequests.filter(req => req.employee_id === employeeAuth.employee.id)} onLogout={handleLogout} />}
            </Suspense>
          </motion.div>
        </main>
      </div>
    );
  }

  if (!auth.user) {
    if (isSuperAdminRoute) {
      return <SuperAdminLogin onLogin={handleLogin} />;
    }
    return <Login onLogin={handleLogin} />;
  }

  if (auth.user.mfaPending) {
    const handleMfaComplete = async () => {
      try {
        const user = await appService.getAuthUser();
        if (!user) {
          setAuth({ user: null, loading: false });
          return;
        }
        const normalizedUser = { ...user, role: normalizeUserRole(user.role) ?? 'user' } as any;
        setAuth({ user: normalizedUser, loading: false });
      } catch (error) {
        console.error('Failed to refresh session after MFA:', error);
      }
    };

    if (auth.user.mfa_enabled) {
      return <MfaVerify onComplete={handleMfaComplete} onCancel={handleLogout} />;
    }
    return <MfaSetup onComplete={handleMfaComplete} onCancel={handleLogout} />;
  }

  if (isSuperAdminRoute && !isInternalRole(auth.user.role)) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
        <div className="bg-slate-800 p-8 rounded-[32px] text-center space-y-4 max-w-md w-full border border-slate-700 shadow-2xl">
          <ShieldCheck className="w-12 h-12 text-rose-500 mx-auto" />
          <h2 className="text-2xl font-black text-white tracking-tight">Access Denied</h2>
          <p className="text-slate-400 font-medium">You do not have permission to access the Super Admin Panel.</p>
          <button 
            onClick={() => { window.location.href = '/'; }}
            className="mt-6 px-6 py-4 bg-indigo-500 text-white rounded-2xl font-black w-full hover:bg-indigo-600 transition-all shadow-xl shadow-indigo-500/20"
          >
            Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (isInternalRole(auth.user.role) && !impersonatedClient) {
    return (
      <div className="flex min-h-screen bg-slate-50">
        <Toaster position="top-right" richColors />
        <aside className="fixed left-0 top-0 bottom-0 w-72 bg-slate-900 text-white p-8 flex flex-col z-50">
          <div className="flex items-center gap-3 mb-12 px-2">
            <div className="w-12 h-12 flex items-center justify-center">
              <img src={sidebarLogo} alt="Sidebar logo" className="w-full h-full object-contain" />
            </div>
            <div className="flex flex-col">
              <h1 className="text-2xl font-black tracking-tighter leading-none">SIGHTFULL</h1>
              <span className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.2em] mt-1">{isSuperAdminRole(auth.user.role) ? 'Super Admin' : 'Staff Access'}</span>
            </div>
          </div>

          <nav className="flex-1 space-y-2">
            {(isSuperAdminRole(auth.user.role) || auth.user.permissions?.includes('view_clients')) && (
              <SuperAdminSidebarItem icon={Building2} label="Client Dashboards" active={superAdminSection === 'internal'} onClick={() => setSuperAdminSection('internal')} />
            )}
            {(isSuperAdminRole(auth.user.role) || auth.user.permissions?.includes('view_tickets')) && (
              <SuperAdminSidebarItem icon={MessageSquare} label="Support Tickets" active={superAdminSection === 'tickets'} onClick={() => setSuperAdminSection('tickets')} badge={openTicketsCount} />
            )}
            {(isSuperAdminRole(auth.user.role) || auth.user.permissions?.includes('view_payroll')) && (
              <SuperAdminSidebarItem icon={Inbox} label="Client Notifications" active={superAdminSection === 'notifications'} onClick={() => setSuperAdminSection('notifications')} badge={superAdminPendingNotificationsCount} />
            )}
            {isSuperAdminRole(auth.user.role) && (
              <SuperAdminSidebarItem icon={Users} label="User Management" active={superAdminSection === 'admin'} onClick={() => setSuperAdminSection('admin')} />
            )}
            {(isSuperAdminRole(auth.user.role) || auth.user.permissions?.includes('view_global_logs') || auth.user.permissions?.includes('view_logs')) && (
              <SuperAdminSidebarItem icon={Activity} label="Activity Logs" active={superAdminSection === 'logs'} onClick={() => setSuperAdminSection('logs')} />
            )}
            <SuperAdminSidebarItem icon={Settings} label="Settings" active={superAdminSection === 'settings'} onClick={() => setSuperAdminSection('settings')} />
          </nav>

          <div className="pt-8 mt-8 border-t border-slate-800">
            <div className="bg-slate-800/50 rounded-[24px] p-5 mb-6 border border-slate-700 shadow-sm">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-2xl bg-white flex items-center justify-center text-indigo-400 font-black text-sm shadow-sm overflow-hidden border border-slate-200">
                  {auth.user.image || auth.user.fallbackImage ? (
                    <img src={auth.user.image || auth.user.fallbackImage} alt="" className="w-full h-full object-contain bg-white p-1" />
                  ) : (
                    auth.user.email.substring(0, 2).toUpperCase()
                  )}
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-black text-white truncate max-w-[120px]">{formatAccountDisplayName(auth.user)}</span>
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{formatRoleLabel(auth.user.role)}</span>
                </div>
              </div>
              <Tooltip content="Sign out of the Super Admin panel">
                <button 
                  onClick={() => {
                    handleLogout().then(() => {
                      window.location.href = '/admin';
                    });
                  }}
                  className="flex items-center gap-2 w-full text-[10px] font-black text-rose-400 hover:text-rose-300 transition-colors uppercase tracking-widest"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Sign Out
                </button>
              </Tooltip>
            </div>
            <p className="text-[9px] text-slate-500 font-black text-center uppercase tracking-[0.3em]">{getSidebarBrandLabel({ isSuperAdmin: true, clientName: impersonatedClient?.name || null })}</p>
          </div>
        </aside>

        <main className="flex-1 ml-72 p-12 overflow-y-auto">
          <div className="fixed bottom-8 right-8 z-[95]">
            <InternalNotifications 
              currentUser={auth.user || undefined} 
              onNavigate={(section) => {
                setSuperAdminSection(section as any);
              }}
            />
          </div>

          <motion.div
            key={superAdminSection}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="max-w-7xl mx-auto"
          >
            <Suspense fallback={<SectionLoader />}>
            {superAdminSection === 'internal' && <InternalPanel 
              currentUser={auth.user || undefined}
              onLoginAsSuperAdmin={(client) => {
                if (String(client?.status || 'active').trim().toLowerCase() === 'deactivated') {
                  clearClientWorkspaceState();
                  toast.error(`${client.name} is deactivated.`);
                  return;
                }
                applyImpersonatedClientContext(client);
                toast.success(`Logged in as Super Admin for ${client.name}`);
              }} 
            />}
            {superAdminSection === 'tickets' && (
              <SupportTicketsPanel 
                tickets={clientTickets} 
                currentUser={auth.user || undefined}
                onUpdateTicket={async (updatedTicket) => {
                  try {
                    const saved = await appService.updateSupportTicket(updatedTicket.id, {
                      status: updatedTicket.status,
                      priority: updatedTicket.priority,
                      admin_notes: updatedTicket.admin_notes || '',
                    });
                    setClientTickets(prev => prev.map(t => t.id === saved.id ? saved : t));
                    toast.success('Support ticket updated');
                  } catch (error) {
                    console.error('Failed to update support ticket:', error);
                    toast.error(error instanceof ApiError ? error.message : 'Failed to update support ticket');
                  }
                }}
                onDeleteTicket={handleDeleteSupportTicket}
              />
            )}
            {superAdminSection === 'notifications' && (
              <ClientNotificationsPanel 
                notifications={notifications} 
                onProcess={handleProcessNotification}
                onRevert={handleRevertNotification}
                onDelete={handleDeletePayrollSubmission}
                currentUser={auth.user || undefined}
              />
            )}
            {superAdminSection === 'admin' && <AdminPanel />}
            {superAdminSection === 'logs' && <ActivityLogsPanel />}
            {superAdminSection === 'settings' && (
              <SettingsSection 
                user={auth.user} 
                onUpdateUser={(updatedUser) => setAuth(prev => ({ ...prev, user: updatedUser }))}
              />
            )}
            </Suspense>
          </motion.div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <Toaster position="top-right" richColors />
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 bottom-0 w-72 bg-white/80 backdrop-blur-xl border-r border-white/20 p-8 flex flex-col z-50">
        <div className="flex items-center gap-3 mb-12 px-2">
          <div className="w-12 h-12 flex items-center justify-center">
            <img src={sidebarLogo} alt="Sidebar logo" className="w-full h-full object-contain" />
          </div>
          <div className="flex flex-col">
            <h1 className="text-2xl font-black text-slate-800 tracking-tighter leading-none">SIGHTFULL</h1>
            <span className="text-[10px] font-black text-indigo-600 uppercase tracking-[0.2em] mt-1">Dashboard</span>
          </div>
        </div>

        <nav className="flex-1 space-y-2">
          <SidebarItem 
            icon={LayoutDashboard} 
            label="Analytics" 
            active={activeSection === 'analytics'} 
            onClick={() => setActiveSection('analytics')} 
            isLocked={lockedFeatures.includes('analytics')}
          />
          <SidebarItem 
            icon={Users} 
            label="Employee Records" 
            active={activeSection === 'employee-records'} 
            onClick={() => setActiveSection('employee-records')} 
            isLocked={lockedFeatures.includes('employee_records')}
          />
          <SidebarItem 
            icon={CalendarDays} 
            label="Leave Management" 
            active={activeSection === 'leave'} 
            onClick={() => { setLeaveManagementEmployeeId(null); setActiveSection('leave'); }} 
            badge={requests.filter(r => r.status === 'pending').length}
            isLocked={lockedFeatures.includes('leave_management')}
          />
          <SidebarItem 
            icon={Clock} 
            label="Shifts" 
            active={activeSection === 'shifts'} 
            onClick={() => setActiveSection('shifts')} 
          />
          <SidebarItem 
            icon={CalendarDays} 
            label={rosterTitle} 
            active={activeSection === 'roster'} 
            onClick={() => setActiveSection('roster')} 
            isLocked={lockedFeatures.includes('rostering')}
          />
          <SidebarItem 
            icon={FileText} 
            label="Timesheet" 
            active={activeSection === 'timesheet'} 
            onClick={() => setActiveSection('timesheet')} 
            isLocked={lockedFeatures.includes('timesheets')}
          />
          <SidebarItem 
            icon={History} 
            label="Payroll Submissions" 
            active={activeSection === 'payroll-submissions'} 
            onClick={() => setActiveSection('payroll-submissions')} 
            badge={currentClientPendingPayrollCount}
          />
          <SidebarItem 
            icon={Files} 
            label="Document Vault" 
            active={activeSection === 'files'} 
            onClick={() => setActiveSection('files')} 
            isLocked={lockedFeatures.includes('file_vault')}
          />
        </nav>

        <div className="pt-8 mt-8 border-t border-slate-100">
          {impersonatedClient ? (
            <div className="mb-6 p-4 bg-indigo-600 rounded-[24px] text-white shadow-xl shadow-indigo-200">
              <div className="flex items-center gap-2 mb-2">
                <ShieldCheck className="w-4 h-4" />
                <span className="text-[10px] font-black uppercase tracking-widest">Super Admin Mode</span>
              </div>
              <p className="text-xs font-bold mb-3 opacity-90">Managing {impersonatedClient.name}</p>
              <button 
                onClick={exitImpersonation}
                className="w-full py-2 bg-white/20 hover:bg-white/30 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
              >
                Exit Super Admin
              </button>
            </div>
          ) : (
            <div className="bg-slate-50 rounded-[24px] p-5 mb-6 border border-slate-100 shadow-sm">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-2xl bg-white flex items-center justify-center text-indigo-600 font-black text-sm shadow-sm overflow-hidden border border-slate-200">
                  {auth.user.image || auth.user.fallbackImage || impersonatedClient?.fallbackImage ? (
                    <img src={auth.user.image || auth.user.fallbackImage || impersonatedClient?.fallbackImage} alt="" className="w-full h-full object-contain bg-white p-1" />
                  ) : (
                    auth.user.email.substring(0, 2).toUpperCase()
                  )}
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-black text-slate-800 truncate max-w-[120px]">{formatAccountDisplayName(auth.user)}</span>
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{formatRoleLabel(auth.user.role)}</span>
                </div>
              </div>
              <button 
                onClick={handleLogout}
                className="flex items-center gap-2 w-full text-[10px] font-black text-rose-500 hover:text-rose-600 transition-colors uppercase tracking-widest"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </button>
            </div>
          )}
          <p className="text-[9px] text-slate-400 font-black text-center uppercase tracking-[0.3em]">{getSidebarBrandLabel({ clientName: impersonatedClient?.name || auth.user?.client_name || auth.user?.clientName || null, client_name: auth.user?.client_name || null, isSuperAdmin: isSuperAdminRole(auth.user?.role) && !impersonatedClient })}</p>
        </div>
      </aside>

      {/* Main Content */}
      <main
        className="flex-1 ml-72 p-12 overflow-y-auto bg-transparent relative"
        style={{
          ...(topBannerHeight ? { paddingTop: `${topBannerHeight + 48}px` } : {}),
          ['--dashboard-banner-offset' as any]: `${topBannerHeight}px`,
          ['--dashboard-section-height' as any]: `calc(100dvh - ${topBannerHeight + 78}px)`,
          ['--dashboard-table-card-height' as any]: `calc(100dvh - ${topBannerHeight + 78}px)`,
        }}
      >
        {(impersonatedClient || activeTrialSource) && (
          <div className="fixed top-0 left-72 right-0 z-[300]">
              <div ref={topBannerRef} className="space-y-0 shadow-xl">
                {impersonatedClient && (
                  <div className="bg-rose-600/95 text-white py-3 px-10 flex items-center justify-between backdrop-blur-md shadow-rose-900/20">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-white/20 rounded-2xl flex items-center justify-center border border-white/20">
                        <ShieldCheck className="w-6 h-6" />
                      </div>
                      <div>
                        <p className="font-black text-[10px] uppercase tracking-[0.2em] text-rose-100">Super Admin Mode</p>
                        <p className="font-black text-sm">Impersonating {impersonatedClient.name.toUpperCase()}</p>
                      </div>
                    </div>
                    <button 
                      onClick={exitImpersonation}
                      className="px-6 py-2.5 bg-white text-rose-600 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-rose-50 transition-all shadow-lg shadow-rose-900/10"
                    >
                      Exit Impersonation
                    </button>
                  </div>
                )}

                {activeTrialSource && (
                  <div className="bg-amber-500/95 text-white py-3 px-10 flex items-center justify-between backdrop-blur-md shadow-amber-900/20">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-white/20 rounded-2xl flex items-center justify-center border border-white/20">
                        <Clock className="w-6 h-6" />
                      </div>
                      <div>
                        <p className="font-black text-[10px] uppercase tracking-[0.2em] text-amber-100">Trial Mode Active</p>
                        <p className="font-black text-sm">
                          {typeof activeTrialDaysRemaining === 'number' ? (
                            <>
                              {activeTrialDaysRemaining} Days Remaining
                            </>
                          ) : activeTrialSource?.trialEndDate ? (
                            <>Ends {format(new Date(activeTrialSource.trialEndDate), 'dd MMM yyyy')}</>
                          ) : (
                            'Trial Active'
                          )}
                        </p>
                      </div>
                    </div>
                    <button 
                      className="px-6 py-2.5 bg-white text-amber-600 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-amber-50 transition-all shadow-lg shadow-amber-900/10"
                    >
                      Upgrade Now
                    </button>
                  </div>
                )}
              </div>
            </div>
        )}

        <motion.div
          key={activeSection}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="max-w-7xl mx-auto"
        >
          <Suspense fallback={<SectionLoader />}>
          {activeTrialSource?.trialExpired ? (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-2xl p-6 mb-6">
              <h2 className="text-2xl font-black mb-2">Trial Expired</h2>
              <p className="font-medium">This workspace trial ended{activeTrialSource?.trialEndDate ? ` on ${format(new Date(activeTrialSource.trialEndDate), 'dd MMM yyyy')}` : ''}. Core screens remain visible for review, but protected actions may be limited until the account is reactivated.</p>
            </div>
          ) : null}
          {activeSection === 'analytics' && (
            <FeatureWrapper isLocked={lockedFeatures.includes('analytics')} featureName="Analytics">
              <AnalyticsSection
                onViewLeaveEmployeeProfile={handleOpenLeaveEmployeeProfile}
                clientContextKey={getVisibleClientId() || currentClientId || null}
                isClientContextReady={!auth.loading && (!isSuperAdminRole(auth.user?.role) || Boolean(getVisibleClientId()))}
                leaveBalanceDeltas={leaveBalanceDeltas}
              />
            </FeatureWrapper>
          )}
          {activeSection === 'employee-records' && (
            <FeatureWrapper isLocked={lockedFeatures.includes('employee_records')} featureName="Employee Records">
              <EmployeeSection 
                employees={employees} 
                onAdd={() => { setEditingEmployee(null); setAutoGeneratedEmployeeId(isSuperAdminRole(auth.user?.role) ? '' : generateAutoEmployeeId(employees)); setGeneratedPin(''); setShowPin(false); setFormIsUnion(''); setPayRateDisplay('R000.0000'); setCellLocalDigits(''); setCountryOfIssueInput(''); setIsCountryOfIssueFocused(false); setBankNameInput(''); setIsBankNameFocused(false); setIdNumberDisplay(''); setPassportDisplay(''); setShowCountryOfIssue(false); setIsEmployeeModalOpen(true); }}
                onEdit={(emp) => { setEditingEmployee(emp); setAutoGeneratedEmployeeId(emp.emp_id || ''); setGeneratedPin(emp.pin || ''); setShowPin(false); setFormIsUnion(emp.isunion || ''); setPayRateDisplay(formatStoredHourlyRate(emp.pay_rate)); setCellLocalDigits(phoneDigitsToLocalSa(emp.cell || '')); setCountryOfIssueInput(emp.country_of_issue || ''); setIsCountryOfIssueFocused(false); setBankNameInput(emp.bank_name || ''); setIsBankNameFocused(false); setIdNumberDisplay(emp.id_number || ''); setPassportDisplay(emp.passport || ''); setShowCountryOfIssue(Boolean(emp.passport)); setIsEmployeeModalOpen(true); }}
                onDelete={handleDeleteEmployee}
                onOffboard={(emp) => { setOffboardingEmployee(emp); setIsOffboardModalOpen(true); }}
                onImport={handleImportEmployees}
                onRestore={isSuperAdminRole(auth.user?.role) ? handleRestoreEmployee : undefined}
                canImportCsv={isSuperAdminRole(auth.user?.role)}
                fileVaultReadOnly={!isSuperAdminRole(auth.user?.role)}
              />
            </FeatureWrapper>
          )}
          {activeSection === 'shifts' && (
            <ShiftsSection 
              shifts={visibleShiftsForManagement}
              onAdd={() => { setEditingShift(null); setIsShiftModalOpen(true); }}
              onEdit={(shift) => { setEditingShift(shift); setIsShiftModalOpen(true); }}
              onDelete={handleDeleteShift}
              isSuperAdmin={isSuperAdminRole(auth.user?.role)}
            />
          )}
          {activeSection === 'roster' && (
            <FeatureWrapper isLocked={lockedFeatures.includes('rostering')} featureName={rosterTitle}>
              <RosterSection 
                rosterDuration={rosterDuration}
                rosterMode={rosterMode}
                rosterSeedWeekStart={rosterSeedWeekStart}
                onRosterModeChange={(mode) => {
                  setRosterMode(mode);
                  void persistRosterPreferences(mode, rosterSeedWeekStart);
                }}
                enabledDefinitions={enabledDefinitions}
                employees={activeEmployees} 
                shifts={shifts} 
                roster={roster} 
                rosterMeta={rosterMeta}
                currentWeekStart={currentWeekStart}
                onWeekChange={setCurrentWeekStart}
                onUpdateRoster={updateRoster}
                rosterTitle={rosterTitle}
                payrollSubmissions={currentClientNotifications}
                onUpdateMeta={updateMeta}
                isSuperAdmin={isSuperAdminRole(auth.user?.role)}
                onPayrollSubmit={async () => {
                  try {
                    const periodDays = rosterDuration === '2_weeks' ? 14 : rosterDuration === '1_month' ? 28 : 7;
                    const weekDays = Array.from({ length: periodDays }, (_, i) => addDays(currentWeekStart, i));
                    const breakdown = activeEmployees.map(emp => {
                      const payroll = calculateEmployeePayroll(emp.id, weekDays, roster, shifts, rosterMeta);
                      const regularHours = payroll.normalTime;
                      const overtimeHours = payroll.ot15 + payroll.sun15 + payroll.sun20 + payroll.pph;
                      const leaveHours = payroll.leave + payroll.sick + payroll.family;
                      const grossPay = (
                        (regularHours + leaveHours) * Number(emp.pay_rate || 0) +
                        payroll.ot15 * Number(emp.pay_rate || 0) * 1.5 +
                        payroll.sun15 * Number(emp.pay_rate || 0) * 1.5 +
                        payroll.sun20 * Number(emp.pay_rate || 0) * 2 +
                        payroll.pph * Number(emp.pay_rate || 0) * 2
                      );

                      return {
                        employeeName: `${emp.first_name} ${emp.last_name}`.trim(),
                        regularHours: Number(regularHours.toFixed(2)),
                        overtimeHours: Number(overtimeHours.toFixed(2)),
                        leaveHours: Number(leaveHours.toFixed(2)),
                        grossPay: Number(grossPay.toFixed(2)),
                      };
                    });

                    const payload = {
                      clientName: impersonatedClient?.name || 'Your Company',
                      submittedBy: auth.user?.email || 'Admin',
                      submittedAt: new Date().toISOString(),
                      periodStart: format(currentWeekStart, 'yyyy-MM-dd'),
                      periodEnd: format(addDays(currentWeekStart, periodDays - 1), 'yyyy-MM-dd'),
                      period: `${format(currentWeekStart, 'MMM dd')} - ${format(addDays(currentWeekStart, periodDays - 1), 'MMM dd, yyyy')}`,
                      employeeCount: activeEmployees.length,
                      status: 'pending',
                      totalHours: Number(breakdown.reduce((acc, curr) => acc + curr.regularHours + curr.overtimeHours + curr.leaveHours, 0).toFixed(2)),
                      totalPay: Number(breakdown.reduce((acc, curr) => acc + curr.grossPay, 0).toFixed(2)),
                      employeeBreakdown: breakdown,
                    };

                    const saved = await appService.createPayrollSubmission(payload);
                    await fetchPayrollSubmissions();
                    setCurrentWeekStart(addDays(currentWeekStart, periodDays));
                    toast.success(saved ? 'Payroll submitted successfully. Moved to the next roster period.' : 'Payroll submitted successfully. Moved to the next roster period.');
                    toast.message('Previous submitted periods are now locked. Contact admin through Support for changes.');
                  } catch (error) {
                    console.error('Payroll submission failed:', error);
                    const message = error instanceof ApiError ? error.message : (error as any)?.message || 'Failed to submit payroll.';
                    toast.error(`Payroll submission failed: ${message}`);
                  }
                }}
              />
            </FeatureWrapper>
          )}
          {activeSection === 'timesheet' && (
            <FeatureWrapper isLocked={lockedFeatures.includes('timesheets')} featureName="Timesheets">
              <TimesheetSection 
                rosterDuration={rosterDuration}
                rosterMode={rosterMode}
                rosterSeedWeekStart={rosterSeedWeekStart}
                onRosterModeChange={(mode) => {
                  setRosterMode(mode);
                  void persistRosterPreferences(mode, rosterSeedWeekStart);
                }}
                enabledDefinitions={enabledDefinitions}
                employees={activeEmployees} 
                shifts={shifts} 
                roster={roster} 
                rosterMeta={rosterMeta}
                currentWeekStart={currentWeekStart}
                payrollSubmissions={currentClientNotifications}
                rosterTitle={rosterTitle}
                onWeekChange={setCurrentWeekStart}
                onPayrollSubmit={async () => {
                  try {
                    const periodDays = rosterDuration === '2_weeks' ? 14 : rosterDuration === '1_month' ? 28 : 7;
                    const weekDays = Array.from({ length: periodDays }, (_, i) => addDays(currentWeekStart, i));
                    const breakdown = activeEmployees.map(emp => {
                      const payroll = calculateEmployeePayroll(emp.id, weekDays, roster, shifts, rosterMeta);
                      const regularHours = payroll.normalTime;
                      const overtimeHours = payroll.ot15 + payroll.sun15 + payroll.sun20 + payroll.pph;
                      const leaveHours = payroll.leave + payroll.sick + payroll.family;
                      const grossPay = (
                        (regularHours + leaveHours) * Number(emp.pay_rate || 0) +
                        payroll.ot15 * Number(emp.pay_rate || 0) * 1.5 +
                        payroll.sun15 * Number(emp.pay_rate || 0) * 1.5 +
                        payroll.sun20 * Number(emp.pay_rate || 0) * 2 +
                        payroll.pph * Number(emp.pay_rate || 0) * 2
                      );

                      return {
                        employeeName: `${emp.first_name} ${emp.last_name}`.trim(),
                        regularHours: Number(regularHours.toFixed(2)),
                        overtimeHours: Number(overtimeHours.toFixed(2)),
                        leaveHours: Number(leaveHours.toFixed(2)),
                        grossPay: Number(grossPay.toFixed(2)),
                      };
                    });

                    const payload = {
                      clientName: impersonatedClient?.name || 'Your Company',
                      submittedBy: auth.user?.email || 'Admin',
                      submittedAt: new Date().toISOString(),
                      periodStart: format(currentWeekStart, 'yyyy-MM-dd'),
                      periodEnd: format(addDays(currentWeekStart, periodDays - 1), 'yyyy-MM-dd'),
                      period: `${format(currentWeekStart, 'MMM dd')} - ${format(addDays(currentWeekStart, periodDays - 1), 'MMM dd, yyyy')}`,
                      employeeCount: activeEmployees.length,
                      status: 'pending',
                      totalHours: Number(breakdown.reduce((acc, curr) => acc + curr.regularHours + curr.overtimeHours + curr.leaveHours, 0).toFixed(2)),
                      totalPay: Number(breakdown.reduce((acc, curr) => acc + curr.grossPay, 0).toFixed(2)),
                      employeeBreakdown: breakdown,
                    };

                    const saved = await appService.createPayrollSubmission(payload);
                    await fetchPayrollSubmissions();
                    setCurrentWeekStart(addDays(currentWeekStart, periodDays));
                    toast.success(saved ? 'Payroll submitted successfully. Moved to the next roster period.' : 'Payroll submitted successfully. Moved to the next roster period.');
                    toast.message('Previous submitted periods are now locked. Contact admin through Support for changes.');
                  } catch (error) {
                    console.error('Payroll submission failed:', error);
                    const message = error instanceof ApiError ? error.message : (error as any)?.message || 'Failed to submit payroll.';
                    toast.error(`Payroll submission failed: ${message}`);
                  }
                }}
              />
            </FeatureWrapper>
          )}
          {activeSection === 'payroll-submissions' && (
            <PayrollSubmissionsSection 
              submissions={currentClientNotifications}
              onDeleteSubmission={handleDeletePayrollSubmission}
              currentUser={auth.user || undefined}
            />
          )}
          {activeSection === 'leave' && (
            <FeatureWrapper isLocked={lockedFeatures.includes('leave_management')} featureName="Leave Management">
              <LeaveSection employees={activeEmployees} requests={combinedLeaveRequests} setRequests={setRequests} onRefresh={fetchLeaveRequests} onRefreshEmployees={fetchEmployees} initialSelectedEmployeeId={leaveManagementEmployeeId} clientContextKey={getVisibleClientId() || currentClientId || null} leaveBalanceDeltas={leaveBalanceDeltas} />
            </FeatureWrapper>
          )}
          {activeSection === 'files' && (
            <FeatureWrapper isLocked={lockedFeatures.includes('file_vault')} featureName="Document Vault">
              <FilesSection readOnly={!isSuperAdminRole(auth.user?.role)} />
            </FeatureWrapper>
          )}
          </Suspense>
        </motion.div>
      </main>

      {/* Modals */}
      <Modal 
        isOpen={isEmployeeModalOpen} 
        onClose={() => { setIsEmployeeModalOpen(false); setPayRateDisplay('R000.0000'); setCellLocalDigits(''); setCountryOfIssueInput(''); setIsCountryOfIssueFocused(false); setBankNameInput(''); setIsBankNameFocused(false); setIdNumberDisplay(''); setPassportDisplay(''); setShowCountryOfIssue(false); }} 
        title={editingEmployee ? "Edit Employee" : "Add Employee"}
        footer={
          <>
            <button onClick={() => { setIsEmployeeModalOpen(false); setPayRateDisplay('R000.0000'); setCellLocalDigits(''); setCountryOfIssueInput(''); setIsCountryOfIssueFocused(false); setBankNameInput(''); setIsBankNameFocused(false); setIdNumberDisplay(''); setPassportDisplay(''); setShowCountryOfIssue(false); }} className="px-6 py-3 rounded-2xl font-bold text-slate-500 hover:bg-slate-100 transition-all">Cancel</button>
            <button type="submit" form="employee-form" className="px-8 py-3 rounded-2xl font-black text-white bg-indigo-600 hover:bg-indigo-700 shadow-xl shadow-indigo-200 transition-all">Save Employee</button>
          </>
        }
      >
        <form id="employee-form" onSubmit={handleSaveEmployee} className="space-y-8" autoComplete="off" data-form-type="other">
          <input type="text" name="fake-username" autoComplete="username" className="hidden" tabIndex={-1} aria-hidden="true" />
          <input type="password" name="fake-password" autoComplete="new-password" className="hidden" tabIndex={-1} aria-hidden="true" />
          <div className="space-y-6">
            <h4 className="text-xs font-black text-indigo-600 uppercase tracking-widest border-b border-indigo-50 pb-2">Personal Information</h4>
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Employee ID</label>
                <input
                  key={`emp-id-${editingEmployee?.id || 'new'}-${autoGeneratedEmployeeId || 'blank'}-${isSuperAdminRole(auth.user?.role) ? 'superadmin' : 'client'}`}
                  name="emp_id"
                  defaultValue={isSuperAdminRole(auth.user?.role) ? editingEmployee?.emp_id : (editingEmployee?.emp_id || autoGeneratedEmployeeId)}
                  required
                  placeholder={isSuperAdminRole(auth.user?.role) ? 'EMP001' : 'Auto-generated'}
                  readOnly={!isSuperAdminRole(auth.user?.role)}
                  aria-readonly={!isSuperAdminRole(auth.user?.role)}
                  autoComplete="off"
                  title={!isSuperAdminRole(auth.user?.role) ? 'Only Super Admin can edit Employee ID' : undefined}
                  className={`w-full px-4 py-3 rounded-2xl border outline-none text-sm font-bold ${!isSuperAdminRole(auth.user?.role) ? 'border-slate-200 bg-slate-100 text-slate-500 cursor-not-allowed' : 'border-slate-200 focus:ring-2 focus:ring-indigo-600/20'}`}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">First Names</label>
                <input autoComplete="off" name="first_name" defaultValue={editingEmployee?.first_name} required placeholder="John" className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-600/20 outline-none text-sm font-bold"  onInput={handleTextOnlyInput} />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Last Name</label>
                <input autoComplete="off" name="last_name" defaultValue={editingEmployee?.last_name} required placeholder="Doe" className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-600/20 outline-none text-sm font-bold"  onInput={handleTextOnlyInput} />
              </div>
              {!passportDisplay && (
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">ID Number</label>
                  <input
                    autoComplete="off"
                    name="id_number"
                    placeholder="ID Number"
                    value={idNumberDisplay}
                    className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-600/20 outline-none text-sm font-bold"
                    inputMode="numeric"
                    onInput={createDigitLimiter(13)}
                    onChange={(e) => {
                      const next = normalizeDigits(e.currentTarget.value).slice(0, 13);
                      e.currentTarget.value = next;
                      setIdNumberDisplay(next);
                      if (next) {
                        setPassportDisplay('');
                        setShowCountryOfIssue(false);
                        setCountryOfIssueInput('');
                        setIsCountryOfIssueFocused(false);
                      }
                      const autoDob = getDobDisplayFromSouthAfricanId(next);
                      if (autoDob) setDobDisplay(autoDob);
                    }}
                  />
                </div>
              )}
              {!idNumberDisplay && (
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Passport</label>
                  <input
                    autoComplete="off"
                    name="passport"
                    placeholder="Passport"
                    value={passportDisplay}
                    className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-600/20 outline-none text-sm font-bold"
                    onChange={(e) => {
                      const next = e.currentTarget.value.trim().toUpperCase();
                      e.currentTarget.value = next;
                      setPassportDisplay(next);
                      const hasPassport = Boolean(next);
                      if (hasPassport) {
                        setIdNumberDisplay('');
                      }
                      setShowCountryOfIssue(hasPassport);
                      if (!hasPassport) {
                        setCountryOfIssueInput('');
                        setIsCountryOfIssueFocused(false);
                      }
                    }}
                  />
                </div>
              )}
              {showCountryOfIssue && (
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Country of Issue</label>
                  <div className="relative">
                    <input
                      autoComplete="off"
                      name="country_of_issue"
                      value={countryOfIssueInput}
                      placeholder="Type to search country"
                      className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-600/20 outline-none text-sm font-bold"
                      onFocus={() => setIsCountryOfIssueFocused(true)}
                      onBlur={() => window.setTimeout(() => setIsCountryOfIssueFocused(false), 120)}
                      onChange={(e) => setCountryOfIssueInput(e.currentTarget.value.replace(/\s+/g, ' ').trimStart())}
                    />
                    {isCountryOfIssueFocused && filteredCountryOfIssueOptions.length > 0 && (
                      <div className="absolute z-20 mt-2 max-h-56 w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1 shadow-xl">
                        {filteredCountryOfIssueOptions.map((country) => (
                          <button
                            key={country}
                            type="button"
                            className="w-full rounded-xl px-3 py-2 text-left text-sm font-bold text-slate-700 transition hover:bg-slate-100"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setCountryOfIssueInput(country);
                              setIsCountryOfIssueFocused(false);
                            }}
                          >
                            {country}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Date of Birth</label>
                <input
                  autoComplete="off"
                  name="dob"
                  type="date"
                  value={dobDisplay}
                  required={!idNumberDisplay}
                  min="1900-01-01"
                  max="9999-12-31"
                  onInput={handleDateFieldInput}
                  onChange={(e) => setDobDisplay(e.currentTarget.value)}
                  className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-600/20 outline-none text-sm font-bold"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Email</label>
                <input autoComplete="off" name="email" type="email" defaultValue={editingEmployee?.email} placeholder="john.doe@example.com" className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-600/20 outline-none text-sm font-bold" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Cell</label>
                <div className="flex items-center rounded-2xl border border-slate-200 bg-white focus-within:ring-2 focus-within:ring-indigo-600/20">
                  <div className="flex items-center gap-2 border-r border-slate-200 bg-slate-50 px-3 py-3 rounded-l-2xl text-sm font-black text-slate-600">
                    <span className="text-base leading-none">🇿🇦</span>
                    <span>+27</span>
                  </div>
                  <input
                    autoComplete="off"
                    name="cell"
                    value={cellLocalDigits}
                    onChange={(e) => setCellLocalDigits(phoneDigitsToLocalSa(e.target.value))}
                    inputMode="numeric"
                    placeholder="82 123 4567"
                    className="w-full bg-transparent px-4 py-3 outline-none text-sm font-bold text-slate-700"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Start Date</label>
                <input
                  autoComplete="off"
                  name="start_date"
                  type="date"
                  defaultValue={toDateInputValue(editingEmployee?.start_date || "")}
                  required
                  min="1900-01-01"
                  max="9999-12-31"
                  onInput={handleDateFieldInput}
                  className="w-full min-w-0 px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-600/20 outline-none text-sm font-bold"
                />
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <h4 className="text-xs font-black text-indigo-600 uppercase tracking-widest border-b border-indigo-50 pb-2">Residency</h4>
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Street Number</label>
                <input autoComplete="off" name="street_number" defaultValue={editingEmployee?.street_number} placeholder="123A" className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-600/20 outline-none text-sm font-bold" inputMode="text" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Address Line 1 (Street Name)</label>
                <input autoComplete="off" name="address1" defaultValue={editingEmployee?.address1} placeholder="Main Street" className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-600/20 outline-none text-sm font-bold" inputMode="text" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Address Line 2 (Suburb)</label>
                <input autoComplete="off" name="address2" defaultValue={editingEmployee?.address2} placeholder="Suburbia" className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-600/20 outline-none text-sm font-bold" inputMode="text" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Address Line 3 (City)</label>
                <input autoComplete="off" name="address3" defaultValue={editingEmployee?.address3} placeholder="Cape Town" className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-600/20 outline-none text-sm font-bold" inputMode="text" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Province</label>
                <select autoComplete="off" name="province" defaultValue={editingEmployee?.province} className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-600/20 outline-none text-sm font-bold appearance-none bg-white">
                  <option value="">Select Province</option>
                  <option value="Eastern Cape">Eastern Cape</option>
                  <option value="Free State">Free State</option>
                  <option value="Gauteng">Gauteng</option>
                  <option value="KwaZulu-Natal">KwaZulu-Natal</option>
                  <option value="Limpopo">Limpopo</option>
                  <option value="Mpumalanga">Mpumalanga</option>
                  <option value="North West">North West</option>
                  <option value="Northern Cape">Northern Cape</option>
                  <option value="Western Cape">Western Cape</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Postal Code</label>
                <input autoComplete="off" name="postal_code" defaultValue={editingEmployee?.postal_code} placeholder="8001" className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-600/20 outline-none text-sm font-bold" inputMode="numeric" maxLength={4} onInput={createDigitLimiter(4)} />
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <h4 className="text-xs font-black text-indigo-600 uppercase tracking-widest border-b border-indigo-50 pb-2">Financial</h4>
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Tax Number</label>
                <input autoComplete="off" name="tax_number" defaultValue={editingEmployee?.tax_number} placeholder="1234567890" className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-600/20 outline-none text-sm font-bold"  inputMode="numeric" maxLength={10} onInput={createDigitLimiter(10)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Bank Name</label>
                <div className="relative">
                  <input
                    autoComplete="off"
                    name="bank_name"
                    value={bankNameInput}
                    placeholder="Type to search bank"
                    className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-600/20 outline-none text-sm font-bold"
                    onFocus={() => setIsBankNameFocused(true)}
                    onBlur={() => window.setTimeout(() => setIsBankNameFocused(false), 120)}
                    onChange={(e) => setBankNameInput(e.currentTarget.value.replace(/\s+/g, ' ').trimStart())}
                  />
                  {isBankNameFocused && filteredBankNameOptions.length > 0 && (
                    <div className="absolute z-20 mt-2 max-h-56 w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1 shadow-xl">
                      {filteredBankNameOptions.map((bank) => (
                        <button
                          key={bank}
                          type="button"
                          className="w-full rounded-xl px-3 py-2 text-left text-sm font-bold text-slate-700 transition hover:bg-slate-100"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setBankNameInput(bank);
                            setIsBankNameFocused(false);
                          }}
                        >
                          {bank}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Account Number</label>
                <input autoComplete="off" name="account_no" defaultValue={editingEmployee?.account_no} placeholder="123456789" className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-600/20 outline-none text-sm font-bold"  inputMode="numeric" onInput={handleNumberOnlyInput} />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Account Type</label>
                <select autoComplete="off" name="account_type" defaultValue={editingEmployee?.account_type} className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-600/20 outline-none text-sm font-bold appearance-none bg-white">
                  <option value="">Select...</option>
                  <option value="savings">Savings</option>
                  <option value="cheque">Cheque</option>
                  <option value="current">Current</option>
                  <option value="transmission">Transmission</option>
                  <option value="bond">Bond</option>
                </select>
              </div>
              {isSuperAdminRole(auth.user?.role) && (
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">PAYE Credit</label>
                  <input autoComplete="off" name="paye_credit" defaultValue={editingEmployee?.paye_credit} placeholder="e.g. 0.00" className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-600/20 outline-none text-sm font-bold"  inputMode="decimal" />
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <h4 className="text-xs font-black text-indigo-600 uppercase tracking-widest border-b border-indigo-50 pb-2">Classification</h4>
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Job Title</label>
                <input autoComplete="off" name="job_title" defaultValue={editingEmployee?.job_title} required placeholder="Petrol Attendant" className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-600/20 outline-none text-sm font-bold"  onInput={handleTextOnlyInput} />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Department</label>
                <input autoComplete="off" name="department" defaultValue={editingEmployee?.department} required placeholder="Forecourt" className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-600/20 outline-none text-sm font-bold"  onInput={handleTextOnlyInput} />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Hourly Rate (R/hr)</label>
                <input
                  autoComplete="off"
                  name="pay_rate"
                  type="text"
                  inputMode="decimal"
                  value={payRateDisplay}
                  onChange={(e) => setPayRateDisplay(formatHourlyRateInput(e.target.value))}
                  required
                  placeholder="R000.0000"
                  className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-600/20 outline-none text-sm font-bold"
                />
              </div>
            </div>
          </div>

          {isSuperAdminRole(auth.user?.role) && (
            <>
              <div className="space-y-6">
                <h4 className="text-xs font-black text-indigo-600 uppercase tracking-widest border-b border-indigo-50 pb-2">Membership & Leave</h4>
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">MIBCO</label>
                    <select autoComplete="off" name="ismibco" defaultValue={editingEmployee?.ismibco} className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-600/20 outline-none text-sm font-bold appearance-none bg-white">
                      <option value="">Select...</option>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Union</label>
                    <select 
                      autoComplete="off"
                      name="isunion" 
                      value={formIsUnion} 
                      onChange={(e) => setFormIsUnion(e.target.value as any)}
                      className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-600/20 outline-none text-sm font-bold appearance-none bg-white"
                    >
                      <option value="">Select...</option>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </div>
                  {formIsUnion === 'yes' && (
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Select Union</label>
                      <select autoComplete="off" name="union_name" defaultValue={editingEmployee?.union_name} className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-600/20 outline-none text-sm font-bold appearance-none bg-white">
                        <option value="">Select Union...</option>
                        <option value="numsa">NUMSA</option>
                        <option value="misa bronze">MISA Bronze</option>
                        <option value="misa silver">MISA Silver</option>
                        <option value="misa gold">MISA Gold</option>
                        <option value="misa platinum">MISA Platinum</option>
                      </select>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-6">
                <h4 className="text-xs font-black text-indigo-600 uppercase tracking-widest border-b border-indigo-50 pb-2">Leave Balances</h4>
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Annual Leave (Days)</label>
                    <input autoComplete="off" name="annual_leave" type="text" inputMode="decimal" value={annualLeaveDisplay} onChange={(e) => setAnnualLeaveDisplay(formatLeaveInput(e.target.value))} placeholder="00.0000" disabled={!isSuperAdminRole(auth.user?.role)} className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-600/20 outline-none text-sm font-bold disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Sick Leave (Days)</label>
                    <input autoComplete="off" name="sick_leave" type="text" inputMode="decimal" value={sickLeaveDisplay} onChange={(e) => setSickLeaveDisplay(formatLeaveInput(e.target.value))} placeholder="00.0000" disabled={!isSuperAdminRole(auth.user?.role)} className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-600/20 outline-none text-sm font-bold disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Family Leave (Days)</label>
                    <input autoComplete="off" name="family_leave" type="text" inputMode="decimal" value={familyLeaveDisplay} onChange={(e) => setFamilyLeaveDisplay(formatLeaveInput(e.target.value))} placeholder="00.0000" disabled={!isSuperAdminRole(auth.user?.role)} className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-600/20 outline-none text-sm font-bold disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed" />
                  </div>
                </div>
              </div>
            </>
          )}
        </form>
      </Modal>

      <Modal 
        isOpen={isShiftModalOpen} 
        onClose={() => setIsShiftModalOpen(false)} 
        title={editingShift ? "Edit Shift" : "Create Shift"}
        footer={
          <>
            <button onClick={() => setIsShiftModalOpen(false)} className="px-6 py-3 rounded-2xl font-bold text-slate-500 hover:bg-slate-100 transition-all">Cancel</button>
            <button type="submit" form="shift-form" className="px-8 py-3 rounded-2xl font-black text-white bg-indigo-600 hover:bg-indigo-700 shadow-xl shadow-indigo-200 transition-all">Save Shift</button>
          </>
        }
      >
        <form id="shift-form" onSubmit={handleSaveShift} className="space-y-6">
          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Shift Label</label>
            <input name="label" defaultValue={editingShift?.label} required placeholder="Day Shift" className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-600/20 outline-none text-sm font-bold" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Start Time</label>
              <input name="start" type="time" defaultValue={editingShift?.start} className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-600/20 outline-none text-sm font-bold" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">End Time</label>
              <input name="end" type="time" defaultValue={editingShift?.end} className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-600/20 outline-none text-sm font-bold" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Lunch (min)</label>
              <input name="lunch" type="number" min={0} defaultValue={editingShift?.lunch} className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-600/20 outline-none text-sm font-bold" />
            </div>
          </div>
          <div className="rounded-[24px] border border-slate-200 bg-slate-50/70 p-4 space-y-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                name="crosses_saturday_into_sunday"
                type="checkbox"
                checked={shiftFormCrossesSaturdayIntoSunday}
                onChange={(event) => setShiftFormCrossesSaturdayIntoSunday(event.target.checked)}
                className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <div className="space-y-1">
                <p className="text-sm font-black text-slate-800">Saturday to Sunday overlap</p>
                <p className="text-xs font-bold text-slate-500">Enable this when the shift starts on Saturday, runs past midnight into Sunday, and lunch needs to be split between the two days for timesheet calculations.</p>
              </div>
            </label>
            {shiftFormCrossesSaturdayIntoSunday && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Saturday Lunch (hours)</label>
                  <input
                    name="saturday_lunch_hours"
                    type="number"
                    min={0}
                    step="0.25"
                    defaultValue={editingShift?.saturday_lunch_hours ?? 0}
                    className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-600/20 outline-none text-sm font-bold"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Sunday Lunch (hours)</label>
                  <input
                    name="sunday_lunch_hours"
                    type="number"
                    min={0}
                    step="0.25"
                    defaultValue={editingShift?.sunday_lunch_hours ?? 0}
                    className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-600/20 outline-none text-sm font-bold"
                  />
                </div>
              </div>
            )}
          </div>
        </form>
      </Modal>

      <OffboardModal 
        isOpen={isOffboardModalOpen} 
        onClose={() => setIsOffboardModalOpen(false)} 
        onConfirm={handleOffboard} 
        employee={offboardingEmployee} 
      />

      {/* Support Floating Chat */}
      {!impersonatedClient && !isSuperAdminRole(auth.user.role) && (
        <div className="fixed bottom-8 right-8 z-[60] flex flex-col items-end">
          <AnimatePresence>
            {isSupportModalOpen && (
              <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 20, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                className="mb-4 w-[380px] bg-white rounded-[24px] shadow-2xl border border-slate-200 overflow-hidden flex flex-col origin-bottom-right"
              >
                {/* Header */}
                <div className="bg-indigo-600 p-4 flex items-center justify-between text-white">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                      <MessageSquare className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <h3 className="font-black text-sm">Support</h3>
                      <p className="text-[10px] text-indigo-200 font-bold uppercase tracking-widest">We typically reply in 24h</p>
                    </div>
                  </div>
                  <button onClick={() => setIsSupportModalOpen(false)} className="p-2 hover:bg-white/20 rounded-full transition-colors">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Body */}
                <div className="p-6 overflow-y-auto max-h-[60vh] bg-slate-50/50">
                  <form id="support-form" onSubmit={handleSupportSubmit} className="space-y-5">
                    <div className="p-4 bg-indigo-50 rounded-2xl border border-indigo-100">
                      <div className="flex gap-3">
                        <AlertCircle className="w-5 h-5 text-indigo-600 shrink-0" />
                        <p className="text-xs font-bold text-indigo-900 leading-relaxed">
                          Need help? Submit a ticket and our support team will respond within 24 hours.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Subject</label>
                      <input 
                        required
                        value={supportSubject}
                        onChange={(e) => setSupportSubject(e.target.value)}
                        placeholder="Briefly describe the issue" 
                        className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-600/20 outline-none text-sm font-bold bg-white" 
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Message</label>
                      <textarea 
                        required
                        value={supportMessage}
                        onChange={(e) => setSupportMessage(e.target.value)}
                        placeholder="Provide more details about your request..." 
                        rows={4}
                        className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-600/20 outline-none text-sm font-bold resize-none bg-white" 
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Priority</label>
                        <select value={supportPriority} onChange={(e) => setSupportPriority(e.target.value as any)} className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-600/20 outline-none text-sm font-bold appearance-none bg-white">
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                          <option value="urgent">Urgent</option>
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Category</label>
                        <select className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-600/20 outline-none text-sm font-bold appearance-none bg-white">
                          <option value="payroll">Payroll</option>
                          <option value="roster">Rostering</option>
                          <option value="account">Account</option>
                          <option value="technical">Technical Issue</option>
                          <option value="other">Other</option>
                        </select>
                      </div>
                    </div>
                  </form>
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-slate-100 bg-white">
                  <button 
                    type="submit" 
                    form="support-form" 
                    disabled={isSubmittingSupport}
                    className="w-full py-3 rounded-2xl font-black text-white bg-indigo-600 hover:bg-indigo-700 shadow-xl shadow-indigo-200 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isSubmittingSupport ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4" />
                        Send Message
                      </>
                    )}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {!isSupportModalOpen && (
              <motion.button
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                whileHover={{ scale: 1.05, y: -2 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setIsSupportModalOpen(true)}
                className="flex items-center gap-3 px-6 py-4 bg-indigo-600 text-white rounded-[24px] font-black text-sm shadow-2xl shadow-indigo-200 border border-indigo-500 group"
              >
                <MessageSquare className="w-5 h-5 group-hover:rotate-12 transition-transform" />
                <span className="tracking-tight">Support</span>
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
