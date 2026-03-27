import { apiDelete, apiGet, apiPatch, apiPost, apiFetch } from "../lib/api";

export const adminService = {
  getClients: () => apiGet<any[]>('/api/admin/clients'),
  createClient: (payload: Record<string, unknown>) => apiPost('/api/admin/clients', payload),
  updateClient: (id: string, payload: Record<string, unknown>) => apiPatch(`/api/admin/clients/${id}`, payload),
  deleteClient: (clientId: string, passphrase: string) => apiFetch<{ success: boolean }>(`/api/admin/clients/${clientId}`, { method: 'DELETE', body: { passphrase } }),
  getClientUsers: (clientId: string) => apiGet<any[]>(`/api/admin/clients/${clientId}/users`),
  createClientUser: (clientId: string, payload: Record<string, unknown>) => apiPost(`/api/admin/clients/${clientId}/users`, payload),
  updateClientUser: (clientId: string, userId: string, payload: Record<string, unknown>) => apiPatch(`/api/admin/clients/${clientId}/users/${userId}`, payload),
  deleteClientUser: (clientId: string, userId: string) => apiDelete(`/api/admin/clients/${clientId}/users/${userId}`),
  getClientFiles: (clientId: string) => apiGet<any[]>(`/api/admin/clients/${clientId}/files`),
  createClientFile: (clientId: string, payload: Record<string, unknown>) => apiPost(`/api/admin/clients/${clientId}/files`, payload),
  updateClientFile: (clientId: string, fileId: string, payload: Record<string, unknown>) => apiPatch(`/api/admin/clients/${clientId}/files/${fileId}`, payload),
  deleteClientFile: (clientId: string, fileId: string) => apiDelete(`/api/admin/clients/${clientId}/files/${fileId}`),
  getClientLogs: (clientId: string) => apiGet<any[]>(`/api/admin/clients/${clientId}/logs`),
  getClientPayrollLogs: (clientId: string) => apiGet<any[]>(`/api/admin/clients/${clientId}/payroll-logs`),
};
