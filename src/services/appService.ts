import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "../lib/api";
import type { Employee, InternalNotification, LeaveRequest, PayrollSubmission, RosterAssignment, RosterMeta, Shift, SupportTicket, User, TicketComment } from "../types";

export const appService = {
  getEmployees: () => apiGet<Employee[]>("/api/employees"),
  saveEmployee: (employee: Record<string, unknown>, id?: string) => id ? apiPut<Employee>(`/api/employees/${id}`, employee) : apiPost<Employee>('/api/employees', employee),
  deleteEmployee: (id: string) => apiDelete(`/api/employees/${id}`),
  restoreEmployee: (id: string) => apiPost<Employee>(`/api/employees/${id}/restore`),

  getShifts: () => apiGet<Shift[]>("/api/shifts"),
  saveShift: (shift: Partial<Shift>, id?: string) => id ? apiPut(`/api/shifts/${id}`, shift) : apiPost('/api/shifts', shift),
  deleteShift: (id: string) => apiDelete(`/api/shifts/${id}`),

  getRoster: (weekStart?: string, periodDays?: number) => apiGet<RosterAssignment[]>(weekStart ? `/api/roster?week_start=${encodeURIComponent(weekStart)}${periodDays ? `&period_days=${encodeURIComponent(String(periodDays))}` : ''}` : '/api/roster'),
  getRosterMeta: (weekStart?: string) => apiGet<RosterMeta[]>(weekStart ? `/api/roster-meta?week_start=${encodeURIComponent(weekStart)}` : '/api/roster-meta'),

  getLeaveRequests: (employeeId?: string) => apiGet<LeaveRequest[]>(employeeId ? `/api/leave-requests?employee_id=${encodeURIComponent(employeeId)}` : '/api/leave-requests'),
  createLeaveRequest: (payload: Record<string, unknown>) => apiPost<void>('/api/leave-requests', payload),
  updateLeaveStatus: (id: string, status: string, overrides: Record<string, unknown> = {}) => apiPut<void>(`/api/leave-requests/${id}/status`, { status, ...overrides }),
  cancelLeaveRequest: (id: string) => apiPost(`/api/leave-requests/${id}/cancel`),

  getPayrollSubmissions: () => apiGet<PayrollSubmission[]>('/api/payroll-submissions'),
  createPayrollSubmission: (payload: Record<string, unknown>) => apiPost<PayrollSubmission>('/api/payroll-submissions', payload),
  updatePayrollSubmissionStatus: (id: string, status: string) => apiPut<PayrollSubmission>(`/api/payroll-submissions/${id}/status`, { status }),
  deletePayrollSubmission: (id: string) => apiDelete<{ success: boolean }>(`/api/payroll-submissions/${id}`),

  getSupportTickets: () => apiGet<SupportTicket[]>('/api/support-tickets'),
  createSupportTicket: (payload: Record<string, unknown>) => apiPost('/api/support-tickets', payload),
  updateSupportTicket: (id: string, payload: Record<string, unknown>) => apiPatch<SupportTicket>(`/api/support-tickets/${id}`, payload),
  deleteSupportTicket: (id: string) => apiDelete<{ success: boolean }>(`/api/support-tickets/${id}`),
  getTicketComments: (ticketId: string) => apiGet<TicketComment[]>(`/api/support-tickets/${ticketId}/comments`),
  addTicketComment: (ticketId: string, payload: Record<string, unknown>) => apiPost<TicketComment>(`/api/support-tickets/${ticketId}/comments`, payload),
  getInternalMentionableUsers: (clientId?: string) => apiGet<User[]>(clientId ? `/api/internal/users?client_id=${encodeURIComponent(clientId)}` : '/api/internal/users'),

  getInternalNotifications: () => apiGet<InternalNotification[]>('/api/internal-notifications'),
  markInternalNotificationRead: (id: string) => apiPost<{ success: boolean }>(`/api/internal-notifications/${id}/read`),
  markAllInternalNotificationsRead: () => apiPost<{ updated: number }>('/api/internal-notifications/read-all'),
  dismissInternalNotification: (id: string) => apiDelete<{ success: boolean }>(`/api/internal-notifications/${id}`),

  getAuthUser: () => apiGet<User>('/api/auth/me'),
  login: (email: string, password: string) => apiPost<User>('/api/auth/login', { email, password }),
  logout: () => apiPost('/api/auth/logout'),

  getEmployeeSession: () => apiGet<Employee>('/api/employee-auth/me'),
  loginEmployee: (identifier: string, pin: string) => apiPost<Employee>('/api/employee-auth/login', { identifier, pin }),
  logoutEmployee: () => apiPost('/api/employee-auth/logout'),
};
