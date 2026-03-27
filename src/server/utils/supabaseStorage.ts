import { env } from '../config/env';
import { supabaseAdmin } from '../integrations/supabase';

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  csv: 'text/csv',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
  json: 'application/json',
};

export const randomId = () => Math.random().toString(36).slice(2, 11);

export const isDataUrl = (value: string | null | undefined) => /^data:/i.test(String(value || '').trim());

export const parseDataUrl = (value: string) => {
  const raw = String(value || '').trim();
  const match = raw.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.+)$/i);
  if (!match) {
    return null;
  }
  const mimeType = String(match[1] || '').trim() || 'application/octet-stream';
  const buffer = Buffer.from(match[2], 'base64');
  return { mimeType, buffer };
};

export const extensionFromName = (name: string | null | undefined) => {
  const raw = String(name || '').trim();
  const idx = raw.lastIndexOf('.');
  return idx >= 0 ? raw.slice(idx + 1).toLowerCase() : '';
};

export const guessMimeType = (name: string | null | undefined, fallback = 'application/octet-stream') => {
  const ext = extensionFromName(name);
  return MIME_BY_EXTENSION[ext] || fallback;
};

const normalizeStoragePath = (value: string) => value.replace(/\\+/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');

export const uploadDataUrlToBucket = async ({
  bucket,
  path,
  dataUrl,
  contentType,
  upsert = true,
}: {
  bucket: string;
  path: string;
  dataUrl: string;
  contentType?: string | null;
  upsert?: boolean;
}) => {
  if (!supabaseAdmin) throw new Error('Supabase is not configured');
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) throw new Error('Invalid data URL payload');
  const finalContentType = contentType || parsed.mimeType || 'application/octet-stream';
  const finalPath = normalizeStoragePath(path);
  const { error } = await supabaseAdmin.storage.from(bucket).upload(finalPath, parsed.buffer, {
    contentType: finalContentType,
    upsert,
  });
  if (error) throw error;
  const { data: publicData } = supabaseAdmin.storage.from(bucket).getPublicUrl(finalPath);
  return {
    storage_bucket: bucket,
    storage_path: finalPath,
    public_url: publicData?.publicUrl || null,
    size_bytes: parsed.buffer.length,
    mime_type: finalContentType,
  };
};

export const uploadBufferToBucket = async ({
  bucket,
  path,
  buffer,
  contentType,
  upsert = true,
}: {
  bucket: string;
  path: string;
  buffer: Buffer;
  contentType?: string | null;
  upsert?: boolean;
}) => {
  if (!supabaseAdmin) throw new Error('Supabase is not configured');
  const finalPath = normalizeStoragePath(path);
  const finalContentType = contentType || 'application/octet-stream';
  const { error } = await supabaseAdmin.storage.from(bucket).upload(finalPath, buffer, {
    contentType: finalContentType,
    upsert,
  });
  if (error) throw error;
  const { data: publicData } = supabaseAdmin.storage.from(bucket).getPublicUrl(finalPath);
  return {
    storage_bucket: bucket,
    storage_path: finalPath,
    public_url: publicData?.publicUrl || null,
    size_bytes: buffer.length,
    mime_type: finalContentType,
  };
};

export const getBucketPublicStatus = (bucket: string) => bucket === env.supabaseBucketClientAssets;

export const getDownloadUrlForStoredObject = async ({
  bucket,
  path,
  expiresIn = 60 * 60,
}: {
  bucket: string;
  path: string;
  expiresIn?: number;
}) => {
  if (!supabaseAdmin) throw new Error('Supabase is not configured');
  if (getBucketPublicStatus(bucket)) {
    const { data } = supabaseAdmin.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  }
  const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUrl(path, expiresIn);
  if (error) throw error;
  return data.signedUrl;
};

export const downloadStoredObjectBuffer = async ({ bucket, path }: { bucket: string; path: string }) => {
  if (!supabaseAdmin) throw new Error('Supabase is not configured');
  const { data, error } = await supabaseAdmin.storage.from(bucket).download(path);
  if (error) throw error;
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
};

export const removeStoredObjects = async (objects: Array<{ bucket: string | null | undefined; path: string | null | undefined }>) => {
  if (!supabaseAdmin) throw new Error('Supabase is not configured');
  const grouped = new Map<string, string[]>();
  for (const item of objects) {
    const bucket = String(item.bucket || '').trim();
    const path = String(item.path || '').trim();
    if (!bucket || !path) continue;
    const current = grouped.get(bucket) || [];
    current.push(path);
    grouped.set(bucket, current);
  }
  for (const [bucket, paths] of grouped.entries()) {
    if (!paths.length) continue;
    const { error } = await supabaseAdmin.storage.from(bucket).remove(paths);
    if (error) throw error;
  }
};

const crc32Table = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

const computeCrc32 = (buffer: Buffer) => {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = crc32Table[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

export const buildZipBuffer = (entries: Array<{ name: string; data: Buffer }>) => {
  const fileParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  entries.forEach((entry) => {
    const nameBuffer = Buffer.from(entry.name.replace(/\\/g, '/'));
    const dataBuffer = entry.data;
    const crc32 = computeCrc32(dataBuffer);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc32, 14);
    localHeader.writeUInt32LE(dataBuffer.length, 18);
    localHeader.writeUInt32LE(dataBuffer.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);
    fileParts.push(localHeader, nameBuffer, dataBuffer);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc32, 16);
    centralHeader.writeUInt32LE(dataBuffer.length, 20);
    centralHeader.writeUInt32LE(dataBuffer.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuffer);

    offset += localHeader.length + nameBuffer.length + dataBuffer.length;
  });

  const centralDirectory = Buffer.concat(centralParts);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(entries.length, 8);
  endRecord.writeUInt16LE(entries.length, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(offset, 16);
  endRecord.writeUInt16LE(0, 20);

  return Buffer.concat([...fileParts, centralDirectory, endRecord]);
};
