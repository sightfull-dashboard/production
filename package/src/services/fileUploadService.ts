import { ApiError } from '../lib/api';
import { buildActiveClientHeaders } from '../lib/activeClient';
import type { FileItem } from '../types';

const parseResponse = async <T>(response: Response): Promise<T> => {
  const contentType = response.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  const payload = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    const message = typeof payload === 'object' && payload && 'error' in payload
      ? String((payload as { error?: unknown }).error)
      : response.statusText || 'Request failed';
    throw new ApiError(message, response.status, payload);
  }

  return payload as T;
};

const buildUploadUrl = (basePath: string, params: Record<string, string | null | undefined>) => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    const normalized = String(value ?? '').trim();
    if (normalized) query.set(key, normalized);
  });
  const suffix = query.toString();
  return suffix ? `${basePath}?${suffix}` : basePath;
};

const buildUploadHeaders = (file: File) => {
  const headers = new Headers(buildActiveClientHeaders());
  headers.set('Content-Type', file.type || 'application/octet-stream');
  return headers;
};

export const fileUploadService = {
  uploadVaultFile: async ({ file, parentId, employeeId }: { file: File; parentId?: string | null; employeeId?: string | null }) => {
    const response = await fetch(buildUploadUrl('/api/files/upload-binary', {
      name: file.name,
      parent_id: parentId || null,
      employee_id: employeeId || null,
    }), {
      method: 'POST',
      credentials: 'include',
      headers: buildUploadHeaders(file),
      body: file,
    });
    return parseResponse<FileItem>(response);
  },
  uploadAdminClientFile: async ({ clientId, file, parentId }: { clientId: string; file: File; parentId?: string | null }) => {
    const response = await fetch(buildUploadUrl(`/api/admin/clients/${encodeURIComponent(clientId)}/files/upload-binary`, {
      name: file.name,
      parent_id: parentId || null,
    }), {
      method: 'POST',
      credentials: 'include',
      headers: buildUploadHeaders(file),
      body: file,
    });
    return parseResponse<FileItem>(response);
  },
};
