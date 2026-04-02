import { supabaseAdmin } from '../integrations/supabase';

export const CLIENT_STORAGE_LIMIT_BYTES = Number(process.env.CLIENT_STORAGE_LIMIT_BYTES || String(2 * 1024 * 1024 * 1024));
export const PACKAGE_STORAGE_LIMIT_BYTES = Number(process.env.PACKAGE_STORAGE_LIMIT_BYTES || String(100 * 1024 * 1024 * 1024));

export class StorageQuotaError extends Error {
  status = 413;
  code = 'CLIENT_STORAGE_LIMIT_EXCEEDED';
  usage: FileStorageUsage;

  constructor(message: string, usage: FileStorageUsage) {
    super(message);
    this.name = 'StorageQuotaError';
    this.usage = usage;
  }
}

export type FileStorageUsage = {
  clientId: string;
  usedBytes: number;
  limitBytes: number;
  remainingBytes: number;
  percentUsed: number;
  packageLimitBytes: number;
};

const toWholeBytes = (value: unknown) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
};

const DEFAULT_CLIENT_STORAGE_LIMIT_BYTES = CLIENT_STORAGE_LIMIT_BYTES;

let clientStorageQuotaColumnAvailablePromise: Promise<boolean> | null = null;

export const isClientStorageQuotaColumnAvailable = async () => {
  if (!clientStorageQuotaColumnAvailablePromise) {
    clientStorageQuotaColumnAvailablePromise = (async () => {
      const { error } = await supabaseAdmin.from('clients').select('storage_quota_bytes').limit(1);
      if (!error) return true;
      const message = String(error.message || '').toLowerCase();
      if (message.includes('storage_quota_bytes')) return false;
      throw error;
    })().catch((error) => {
      clientStorageQuotaColumnAvailablePromise = null;
      throw error;
    });
  }
  return clientStorageQuotaColumnAvailablePromise;
};

export const resolveClientStorageLimitBytes = async (clientId: string) => {
  const normalizedClientId = String(clientId || '').trim();
  if (!normalizedClientId) return DEFAULT_CLIENT_STORAGE_LIMIT_BYTES;
  const columnAvailable = await isClientStorageQuotaColumnAvailable().catch(() => false);
  if (!columnAvailable) return DEFAULT_CLIENT_STORAGE_LIMIT_BYTES;

  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('storage_quota_bytes')
    .eq('id', normalizedClientId)
    .maybeSingle();

  if (error) {
    const message = String(error.message || '').toLowerCase();
    if (message.includes('storage_quota_bytes')) return DEFAULT_CLIENT_STORAGE_LIMIT_BYTES;
    throw error;
  }

  const resolved = toWholeBytes((data as any)?.storage_quota_bytes);
  return resolved > 0 ? resolved : DEFAULT_CLIENT_STORAGE_LIMIT_BYTES;
};

export const formatBytes = (bytes: number) => {
  const normalized = Math.max(0, Number(bytes) || 0);
  if (normalized >= 1024 ** 3) return `${(normalized / (1024 ** 3)).toFixed(2)} GB`;
  if (normalized >= 1024 ** 2) return `${(normalized / (1024 ** 2)).toFixed(2)} MB`;
  if (normalized >= 1024) return `${(normalized / 1024).toFixed(2)} KB`;
  return `${normalized} B`;
};

export const resolveClientStorageUsage = async (clientId: string): Promise<FileStorageUsage> => {
  const normalizedClientId = String(clientId || '').trim();
  if (!normalizedClientId) {
    return {
      clientId: '',
      usedBytes: 0,
      limitBytes: CLIENT_STORAGE_LIMIT_BYTES,
      remainingBytes: CLIENT_STORAGE_LIMIT_BYTES,
      percentUsed: 0,
      packageLimitBytes: PACKAGE_STORAGE_LIMIT_BYTES,
    };
  }

  const [clientFilesResult, employeeIdsResult] = await Promise.all([
    supabaseAdmin.from('files').select('id,size_bytes').eq('client_id', normalizedClientId),
    supabaseAdmin.from('employees').select('id').eq('client_id', normalizedClientId),
  ]);

  if (clientFilesResult.error) throw clientFilesResult.error;
  if (employeeIdsResult.error) throw employeeIdsResult.error;

  const employeeIds = (employeeIdsResult.data || []).map((row: any) => String(row.id || '').trim()).filter(Boolean);
  const deduped = new Map<string, number>();

  for (const row of clientFilesResult.data || []) {
    deduped.set(String(row.id), toWholeBytes((row as any).size_bytes));
  }

  if (employeeIds.length) {
    const batchSize = 200;
    for (let index = 0; index < employeeIds.length; index += batchSize) {
      const batch = employeeIds.slice(index, index + batchSize);
      const { data, error } = await supabaseAdmin.from('files').select('id,size_bytes').in('employee_id', batch);
      if (error) throw error;
      for (const row of data || []) {
        deduped.set(String(row.id), toWholeBytes((row as any).size_bytes));
      }
    }
  }

  const usedBytes = Array.from(deduped.values()).reduce((sum, size) => sum + size, 0);
  const limitBytes = await resolveClientStorageLimitBytes(normalizedClientId);
  const remainingBytes = Math.max(0, limitBytes - usedBytes);
  const percentUsed = limitBytes > 0 ? Math.min(100, Number(((usedBytes / limitBytes) * 100).toFixed(2))) : 0;

  return {
    clientId: normalizedClientId,
    usedBytes,
    limitBytes,
    remainingBytes,
    percentUsed,
    packageLimitBytes: PACKAGE_STORAGE_LIMIT_BYTES,
  };
};

export const assertClientStorageCapacity = async ({ clientId, incomingBytes }: { clientId: string; incomingBytes: number }) => {
  const usage = await resolveClientStorageUsage(clientId);
  const requestedBytes = Math.max(0, Number(incomingBytes) || 0);
  if (requestedBytes <= 0) return usage;
  if (requestedBytes > usage.remainingBytes) {
    const message = `This client has reached its ${formatBytes(usage.limitBytes)} storage allocation. Please remove older files or contact an administrator.`;
    throw new StorageQuotaError(message, usage);
  }
  return usage;
};
