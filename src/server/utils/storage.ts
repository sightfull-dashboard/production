import path from 'node:path';
import { supabaseAdmin } from '../integrations/supabase';

export type UploadedStorageAsset = {
  storagePath: string;
  storageBucket: string;
  sizeBytes: number;
  mimeType: string | null;
  publicUrl: string | null;
};

const sanitizePathSegment = (value: string) => value
  .replace(/[^a-zA-Z0-9._-]+/g, '-')
  .replace(/-+/g, '-')
  .replace(/^-|-$/g, '')
  || 'file';

const guessMimeTypeFromName = (fileName: string) => {
  const ext = path.extname(fileName).toLowerCase();
  switch (ext) {
    case '.pdf': return 'application/pdf';
    case '.csv': return 'text/csv';
    case '.txt': return 'text/plain';
    case '.json': return 'application/json';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    case '.gif': return 'image/gif';
    case '.doc': return 'application/msword';
    case '.docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.xls': return 'application/vnd.ms-excel';
    case '.xlsx': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case '.zip': return 'application/zip';
    default: return null;
  }
};

export const parseStoredBinaryValue = (rawValue: string | null | undefined) => {
  const raw = String(rawValue || '').trim();
  if (!raw) return null;
  const dataUrlMatch = raw.match(/^data:(.*?);base64,(.*)$/i);
  if (dataUrlMatch) {
    return {
      buffer: Buffer.from(dataUrlMatch[2], 'base64'),
      mimeType: dataUrlMatch[1] || null,
    };
  }
  return null;
};

export const uploadBase64FileToSupabaseStorage = async ({
  bucket,
  fileName,
  folder,
  rawValue,
}: {
  bucket: string;
  fileName: string;
  folder: string;
  rawValue: string;
}): Promise<UploadedStorageAsset | null> => {
  const parsed = parseStoredBinaryValue(rawValue);
  if (!parsed) return null;

  const safeFileName = sanitizePathSegment(fileName);
  const safeFolder = folder.split('/').map((segment) => sanitizePathSegment(segment)).join('/');
  const storagePath = `${safeFolder}/${safeFileName}`;

  const { error } = await supabaseAdmin.storage
    .from(bucket)
    .upload(storagePath, parsed.buffer, {
      upsert: true,
      contentType: parsed.mimeType || guessMimeTypeFromName(fileName) || 'application/octet-stream',
    });

  if (error) {
    throw error;
  }

  return {
    storagePath,
    storageBucket: bucket,
    sizeBytes: parsed.buffer.byteLength,
    mimeType: parsed.mimeType || guessMimeTypeFromName(fileName),
    publicUrl: null,
  };
};

export const resolveDownloadUrl = async ({
  storageBucket,
  storagePath,
  fallbackUrl,
  ttlSeconds,
}: {
  storageBucket?: string | null;
  storagePath?: string | null;
  fallbackUrl?: string | null;
  ttlSeconds: number;
}) => {
  if (storageBucket && storagePath) {
    const { data, error } = await supabaseAdmin.storage
      .from(storageBucket)
      .createSignedUrl(storagePath, ttlSeconds);
    if (error) throw error;
    return data?.signedUrl || null;
  }
  return fallbackUrl || null;
};

export const deleteStoredObjectIfPresent = async ({
  storageBucket,
  storagePath,
}: {
  storageBucket?: string | null;
  storagePath?: string | null;
}) => {
  if (!storageBucket || !storagePath) return;
  const { error } = await supabaseAdmin.storage.from(storageBucket).remove([storagePath]);
  if (error) {
    console.warn('[storage] Failed to remove object', { storageBucket, storagePath, error: error.message });
  }
};
