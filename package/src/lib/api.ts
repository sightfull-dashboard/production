import { buildActiveClientHeaders } from './activeClient';

type ApiOptions = Omit<RequestInit, 'body'> & { body?: unknown };

export class ApiError extends Error {
  status: number;
  details: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

const buildInit = (options: ApiOptions = {}): RequestInit => {
  const { body, ...rest } = options;
  const headers = new Headers(rest.headers ?? {});

  const scopedHeaders = buildActiveClientHeaders();
  Object.entries(scopedHeaders).forEach(([key, value]) => {
    if (!headers.has(key)) headers.set(key, value);
  });

  const init: RequestInit = {
    ...rest,
    credentials: rest.credentials ?? 'include',
    headers,
  };

  if (body !== undefined) {
    headers.set('Content-Type', 'application/json');
    init.body = JSON.stringify(body);
  }

  return init;
};

export const apiFetch = async <T>(url: string, options: ApiOptions = {}): Promise<T> => {
  const response = await fetch(url, buildInit(options));
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

export const apiGet = <T>(url: string) => apiFetch<T>(url);
export const apiPost = <T>(url: string, body?: unknown, options: Omit<ApiOptions, 'body' | 'method'> = {}) =>
  apiFetch<T>(url, { ...options, method: 'POST', body });
export const apiPut = <T>(url: string, body?: unknown, options: Omit<ApiOptions, 'body' | 'method'> = {}) =>
  apiFetch<T>(url, { ...options, method: 'PUT', body });
export const apiDelete = <T>(url: string, options: Omit<ApiOptions, 'body' | 'method'> = {}) =>
  apiFetch<T>(url, { ...options, method: 'DELETE' });

export const apiPatch = <T>(url: string, body?: unknown, options: Omit<ApiOptions, 'body' | 'method'> = {}) =>
  apiFetch<T>(url, { ...options, method: 'PATCH', body });
