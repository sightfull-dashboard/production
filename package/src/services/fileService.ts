import { apiDelete, apiGet, apiPost } from "../lib/api";
import type { FileItem } from "../types";

export const fileService = {
  list: (params?: { parent_id?: string | null; employee_id?: string | null }) => {
    const query = new URLSearchParams();
    if (params?.parent_id) query.set('parent_id', params.parent_id);
    if (params?.employee_id) query.set('employee_id', params.employee_id);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return apiGet<FileItem[]>(`/api/files${suffix}`);
  },
  create: (payload: Record<string, unknown>) => apiPost<FileItem>('/api/files', payload),
  remove: (id: string) => apiDelete(`/api/files/${id}`),
  download: (id: string) => apiGet<{ url?: string; name: string }>(`/api/files/${id}/download`),
};
