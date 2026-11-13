import type { DriveFileEntry, OutgoingAttachmentFile } from '../types';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

export async function listUserDriveFiles(
  accessToken: string,
  nameQuery = ''
): Promise<DriveFileEntry[]> {
  const escaped = nameQuery.trim().replace(/'/g, "\\'");
  const q = escaped ? `trashed = false and name contains '${escaped}'` : 'trashed = false';
  const params = new URLSearchParams({
    q,
    pageSize: '25',
    orderBy: 'modifiedTime desc',
    fields: 'files(id, name, mimeType, size, modifiedTime, webViewLink)'
  });

  const res = await fetch(`${DRIVE_API_BASE}/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Google Drive API error (${res.status})`);
  }

  const data = (await res.json()) as {
    files?: Array<{
      id: string;
      name: string;
      mimeType: string;
      size?: string;
      modifiedTime?: string;
      webViewLink?: string;
    }>;
  };

  return (data.files ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    sizeBytes: Number(f.size ?? 0),
    modifiedTime: f.modifiedTime ?? null,
    webViewLink: f.webViewLink ?? null
  }));
}

export async function uploadAttachmentToUserDrive(
  accessToken: string,
  params: {
    fileName: string;
    mimeType: string;
    bytes: Uint8Array;
  }
): Promise<DriveFileEntry> {
  const boundary = `vartalap_drive_${crypto.randomUUID().replace(/-/g, '')}`;
  const metadataPart = JSON.stringify({ name: params.fileName });

  const headerText =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${metadataPart}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${params.mimeType || 'application/octet-stream'}\r\n\r\n`;

  const footerText = `\r\n--${boundary}--`;
  const encoder = new TextEncoder();
  const headerBytes = encoder.encode(headerText);
  const footerBytes = encoder.encode(footerText);

  const combined = new Uint8Array(
    headerBytes.length + params.bytes.length + footerBytes.length
  );
  combined.set(headerBytes, 0);
  combined.set(params.bytes, headerBytes.length);
  combined.set(footerBytes, headerBytes.length + params.bytes.length);

  const res = await fetch(
    `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,name,mimeType,size,modifiedTime,webViewLink`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body: combined
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Failed to upload to Google Drive (${res.status})`);
  }

  const f = (await res.json()) as {
    id: string;
    name: string;
    mimeType: string;
    size?: string;
    modifiedTime?: string;
    webViewLink?: string;
  };

  return {
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    sizeBytes: Number(f.size ?? params.bytes.length),
    modifiedTime: f.modifiedTime ?? null,
    webViewLink: f.webViewLink ?? null
  };
}

export async function downloadDriveFileAsAttachment(
  accessToken: string,
  file: DriveFileEntry
): Promise<OutgoingAttachmentFile> {
  const res = await fetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(file.id)}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) {
    throw new Error(`Could not download "${file.name}" from Google Drive.`);
  }
  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return {
    id: `drive_${file.id}_${Date.now()}`,
    fileName: file.name,
    mimeType: file.mimeType || 'application/octet-stream',
    sizeBytes: bytes.length,
    base64Content: btoa(binary)
  };
}
