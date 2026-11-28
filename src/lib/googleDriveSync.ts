import {
  GoogleAuthProvider,
  onAuthStateChanged,
  reauthenticateWithPopup,
  signInWithPopup,
} from 'firebase/auth';
import { auth } from './firebase';
import type { WorkspaceBackup } from '../types';

export const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const GOOGLE_DRIVE_FOLDER_NAME = 'ITTC_Backup_Database';
export const GOOGLE_DRIVE_PRIMARY_FILENAME = 'Ideal Technical Training & Testing Center.json';

export interface GoogleDriveFileInfo {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
}

export interface GoogleDriveSessionInfo {
  connected: boolean;
  email: string | null;
  expiresAt: number | null;
}

interface DriveTokenCache {
  accessToken: string;
  email: string | null;
  expiresAt: number;
}

// Strict in-memory token storage ONLY (never persisted to localStorage / sessionStorage / IDB)
let driveTokenCache: DriveTokenCache | null = null;
let driveAuthListenerRegistered = false;
const sessionListeners = new Set<(info: GoogleDriveSessionInfo) => void>();

function notifySessionListeners() {
  const info = getGoogleDriveSession();
  sessionListeners.forEach((cb) => {
    try {
      cb(info);
    } catch {
      // ignore listener errors
    }
  });
}

export function ensureDriveAuthCleanupListener(): void {
  if (driveAuthListenerRegistered) return;
  driveAuthListenerRegistered = true;
  onAuthStateChanged(auth, (user) => {
    if (!user && driveTokenCache) {
      driveTokenCache = null;
      notifySessionListeners();
    }
  });
}

export function subscribeGoogleDriveSession(
  cb: (info: GoogleDriveSessionInfo) => void
): () => void {
  ensureDriveAuthCleanupListener();
  sessionListeners.add(cb);
  cb(getGoogleDriveSession());
  return () => {
    sessionListeners.delete(cb);
  };
}

export function getGoogleDriveSession(): GoogleDriveSessionInfo {
  if (!driveTokenCache || Date.now() >= driveTokenCache.expiresAt) {
    return { connected: false, email: null, expiresAt: null };
  }
  return {
    connected: true,
    email: driveTokenCache.email,
    expiresAt: driveTokenCache.expiresAt,
  };
}

export function clearGoogleDriveSession(): void {
  driveTokenCache = null;
  notifySessionListeners();
}

function getValidAccessTokenOrThrow(): string {
  if (!driveTokenCache || Date.now() >= driveTokenCache.expiresAt) {
    driveTokenCache = null;
    notifySessionListeners();
    throw new Error('Google Drive session expired or not connected. Please connect Google Drive.');
  }
  return driveTokenCache.accessToken;
}

export async function connectGoogleDrive(): Promise<GoogleDriveSessionInfo> {
  ensureDriveAuthCleanupListener();
  const provider = new GoogleAuthProvider();
  provider.addScope(GOOGLE_DRIVE_SCOPE);
  provider.setCustomParameters({
    prompt: 'consent select_account',
  });

  const result = auth.currentUser
    ? await reauthenticateWithPopup(auth.currentUser, provider)
    : await signInWithPopup(auth, provider);

  const credential = GoogleAuthProvider.credentialFromResult(result);
  const accessToken = credential?.accessToken;
  if (!accessToken) {
    throw new Error('Google Drive access token was not granted. Please try again and allow Drive access.');
  }

  driveTokenCache = {
    accessToken,
    email: result.user?.email || auth.currentUser?.email || null,
    expiresAt: Date.now() + 50 * 60 * 1000, // 50-minute conservative TTL in memory
  };
  notifySessionListeners();
  return getGoogleDriveSession();
}

async function driveFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = getValidAccessTokenOrThrow();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(url, {
    ...init,
    headers,
  });

  if (response.status === 401 || response.status === 403) {
    let detail = '';
    try {
      const errJson = (await response.json()) as { error?: { message?: string } };
      detail = errJson?.error?.message || '';
    } catch {
      // ignore parse failure
    }
    if (response.status === 401) {
      clearGoogleDriveSession();
      throw new Error('Google Drive authorization expired. Please click Connect Google Drive again.');
    }
    throw new Error(detail || `Google Drive permission error (HTTP ${response.status}).`);
  }

  if (!response.ok) {
    let message = `Google Drive request failed (HTTP ${response.status})`;
    try {
      const errJson = (await response.json()) as { error?: { message?: string } };
      if (errJson?.error?.message) {
        message = errJson.error.message;
      }
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  return response;
}

async function findOrCreateBackupFolder(): Promise<string> {
  const escaped = GOOGLE_DRIVE_FOLDER_NAME.replace(/'/g, "\\'");
  const q = `mimeType = 'application/vnd.google-apps.folder' and name = '${escaped}' and trashed = false`;
  const params = new URLSearchParams({
    q,
    fields: 'files(id, name)',
    spaces: 'drive',
    pageSize: '5',
  });
  const listRes = await driveFetch(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`
  );
  const listData = (await listRes.json()) as { files?: Array<{ id: string; name: string }> };
  if (Array.isArray(listData.files) && listData.files.length > 0) {
    return listData.files[0].id;
  }

  const createRes = await driveFetch('https://www.googleapis.com/drive/v3/files?fields=id,name', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: GOOGLE_DRIVE_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });
  const created = (await createRes.json()) as { id: string };
  return created.id;
}

export async function listGoogleDriveBackups(): Promise<{
  folderId: string;
  files: GoogleDriveFileInfo[];
}> {
  const folderId = await findOrCreateBackupFolder();
  const q = `'${folderId}' in parents and trashed = false`;
  const params = new URLSearchParams({
    q,
    fields: 'files(id, name, mimeType, size, modifiedTime, webViewLink)',
    orderBy: 'modifiedTime desc',
    pageSize: '25',
  });
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`);
  const data = (await res.json()) as { files?: GoogleDriveFileInfo[] };
  return {
    folderId,
    files: Array.isArray(data.files) ? data.files : [],
  };
}

export async function uploadBackupJsonToGoogleDrive(
  payload: WorkspaceBackup,
  options?: {
    fileName?: string;
    existingFileId?: string;
    folderId?: string;
  }
): Promise<GoogleDriveFileInfo> {
  const folderId = options?.folderId || (await findOrCreateBackupFolder());
  const fileName = options?.fileName || GOOGLE_DRIVE_PRIMARY_FILENAME;

  let targetFileId = options?.existingFileId;
  if (!targetFileId) {
    const escapedName = fileName.replace(/'/g, "\\'");
    const q = `'${folderId}' in parents and name = '${escapedName}' and trashed = false`;
    const params = new URLSearchParams({
      q,
      fields: 'files(id, name)',
      pageSize: '1',
    });
    const searchRes = await driveFetch(
      `https://www.googleapis.com/drive/v3/files?${params.toString()}`
    );
    const searchData = (await searchRes.json()) as { files?: Array<{ id: string }> };
    targetFileId = searchData.files?.[0]?.id;
  }

  const metadata: Record<string, unknown> = {
    name: fileName,
    mimeType: 'application/json',
  };
  if (!targetFileId) {
    metadata.parents = [folderId];
  }

  const boundary = `ittc_drive_boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const jsonContent = JSON.stringify(payload, null, 2);
  const multipartBody =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${jsonContent}\r\n` +
    `--${boundary}--`;

  const uploadUrl = targetFileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(
        targetFileId
      )}?uploadType=multipart&fields=id,name,mimeType,size,modifiedTime,webViewLink`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,modifiedTime,webViewLink`;

  const uploadRes = await driveFetch(uploadUrl, {
    method: targetFileId ? 'PATCH' : 'POST',
    headers: {
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipartBody,
  });

  return (await uploadRes.json()) as GoogleDriveFileInfo;
}

export async function downloadBackupJsonFromGoogleDrive(
  fileId: string
): Promise<WorkspaceBackup> {
  const res = await driveFetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`
  );
  const parsed = (await res.json()) as WorkspaceBackup;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid JSON backup received from Google Drive.');
  }
  return parsed;
}
