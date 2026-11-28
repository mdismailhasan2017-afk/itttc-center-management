import { downloadFile } from './format';
import {
  clearBrowserMegaCreds,
  connectMegaDirect,
  downloadMegaDailyExcelDirect,
  getBrowserMegaStatus,
  listMegaDailyExcelDirect,
  pullDatabaseJsonDirect,
  saveBrowserMegaCreds,
  scanMegaRecoveryDirect,
  syncDatabaseAndDailyExcelDirect,
  viewMegaDailyExcelDirect,
  type MegaRecoveryJobCandidate,
  type MegaRecoverySourceInfo,
} from './megaBrowserClient';
import type { CenterDataState } from './store';
import type { WorkspaceBackup } from '../types';

export type { MegaRecoveryJobCandidate, MegaRecoverySourceInfo };

const IDB_NAME = 'ittc-fs-sync';
const IDB_STORE = 'handles';
const TARGET_HANDLE_KEY = 'jobTokenDir';

export interface LocalHandlePermission {
  queryPermission?: (desc: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (desc: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
}

export type SyncDirectoryHandle = FileSystemDirectoryHandle & LocalHandlePermission;
export type SyncFileHandle = FileSystemFileHandle & LocalHandlePermission;
export type SyncTargetHandle = SyncDirectoryHandle | SyncFileHandle;

export interface MegaSyncStatus {
  configured: boolean;
  email: string | null;
  source: 'env' | 'account' | null;
}

export interface ServerLocalStatus {
  supported: boolean;
  defaultPath: string | null;
}

export function buildDatabaseJsonPayload(data: CenterDataState): WorkspaceBackup {
  return {
    version: 'ittc.v2',
    exportedAt: new Date().toISOString(),
    set: data.settings,
    students: data.students,
    jobs: data.jobs,
    outs: data.outs,
    staff: data.staff,
    staffPayments: data.staffPayments,
    companies: data.companies,
    agencyContracts: data.agencyContracts,
    store: data.store,
    storeLogs: data.storeLogs,
    prices: data.prices,
    returns: data.returns,
    cash: data.cash,
    generalAccounts: data.generalAccounts,
    docs: data.docs,
    auditLogs: data.auditLogs,
  };
}

export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export function isSaveFilePickerSupported(): boolean {
  return typeof window !== 'undefined' && 'showSaveFilePicker' in window;
}

export function isEmbeddedPreviewFrame(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function getLocalTargetDisplayName(handle: SyncTargetHandle | null): string | null {
  if (!handle) return null;
  if (handle.kind === 'directory') {
    return `${handle.name}/database.json`;
  }
  return handle.name || 'database.json';
}

function openHandleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveLocalTargetHandle(handle: SyncTargetHandle): Promise<void> {
  try {
    const db = await openHandleDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(handle, TARGET_HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // ignore IndexedDB errors
  }
}

export async function getSavedLocalTargetHandle(): Promise<SyncTargetHandle | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const db = await openHandleDb();
    const handle = await new Promise<SyncTargetHandle | null>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(TARGET_HANDLE_KEY);
      req.onsuccess = () => resolve((req.result as SyncTargetHandle) || null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return handle;
  } catch {
    return null;
  }
}

export async function clearSavedLocalTargetHandle(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  try {
    const db = await openHandleDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(TARGET_HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // ignore
  }
}

export async function ensureTargetWritePermission(
  handle: SyncTargetHandle,
  requestIfPrompted: boolean
): Promise<boolean> {
  try {
    if (typeof handle.queryPermission !== 'function') return true;
    const status = await handle.queryPermission({ mode: 'readwrite' });
    if (status === 'granted') return true;
    if (status === 'prompt' && requestIfPrompted && typeof handle.requestPermission === 'function') {
      const next = await handle.requestPermission({ mode: 'readwrite' });
      return next === 'granted';
    }
    return false;
  } catch {
    return false;
  }
}

export async function pickLocalSyncDirectory(): Promise<SyncDirectoryHandle> {
  const picker = (
    window as unknown as {
      showDirectoryPicker: (opts?: {
        id?: string;
        mode?: 'read' | 'readwrite';
      }) => Promise<SyncDirectoryHandle>;
    }
  ).showDirectoryPicker;
  return picker({
    id: 'ittc-job-token-db',
    mode: 'readwrite',
  });
}

export async function pickLocalSyncFile(): Promise<SyncFileHandle> {
  const picker = (
    window as unknown as {
      showSaveFilePicker: (opts?: {
        id?: string;
        suggestedName?: string;
        types?: Array<{ description?: string; accept: Record<string, string[]> }>;
      }) => Promise<SyncFileHandle>;
    }
  ).showSaveFilePicker;
  return picker({
    id: 'ittc-job-token-file',
    suggestedName: 'database.json',
    types: [
      {
        description: 'JSON Database',
        accept: { 'application/json': ['.json'] },
      },
    ],
  });
}

export async function writeDatabaseJsonToTarget(
  handle: SyncTargetHandle,
  payload: WorkspaceBackup
): Promise<void> {
  const fileHandle =
    handle.kind === 'directory'
      ? await handle.getFileHandle('database.json', { create: true })
      : handle;
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(payload, null, 2));
  await writable.close();
}

const FALLBACK_FOLDER_KEY = 'ittc.pcFolderLabel';

export function getSavedFallbackFolderName(): string | null {
  try {
    const v = localStorage.getItem(FALLBACK_FOLDER_KEY);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

export function saveFallbackFolderName(name: string): void {
  try {
    if (name.trim()) {
      localStorage.setItem(FALLBACK_FOLDER_KEY, name.trim());
    }
  } catch {
    // ignore storage errors
  }
}

export function clearFallbackFolderName(): void {
  try {
    localStorage.removeItem(FALLBACK_FOLDER_KEY);
  } catch {
    // ignore storage errors
  }
}

export function isOpfsSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    Boolean(navigator.storage) &&
    typeof navigator.storage.getDirectory === 'function'
  );
}

export async function writeBackupToOpfs(payload: WorkspaceBackup): Promise<boolean> {
  if (!isOpfsSupported()) return false;
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('JobTokenDatabase', { create: true });
    const fileHandle = await dir.getFileHandle('database.json', { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(payload, null, 2));
    await writable.close();
    return true;
  } catch {
    return false;
  }
}

export async function readBackupFromOpfs(): Promise<WorkspaceBackup | null> {
  if (!isOpfsSupported()) return null;
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('JobTokenDatabase');
    const fileHandle = await dir.getFileHandle('database.json');
    const file = await fileHandle.getFile();
    const text = await file.text();
    const parsed = JSON.parse(text) as WorkspaceBackup;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export async function parseSelectedDirectoryFiles(files: FileList): Promise<{
  folderName: string;
  fileCount: number;
  existingBackup: WorkspaceBackup | null;
  existingBackupFileName: string | null;
}> {
  const list = Array.from(files || []);
  let folderName = 'JobTokenDatabase';
  for (const f of list) {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || '';
    if (rel.includes('/')) {
      folderName = rel.split('/')[0] || folderName;
      break;
    }
  }

  // Prefer database.json or Ideal Technical Training & Testing Center.json inside the selected folder
  const candidates = list.filter((f) => {
    const lower = f.name.toLowerCase();
    return (
      lower === 'database.json' ||
      lower === 'ideal technical training & testing center.json' ||
      lower.endsWith('.json')
    );
  });
  candidates.sort((a, b) => {
    const score = (name: string) => {
      const l = name.toLowerCase();
      if (l === 'database.json') return 0;
      if (l === 'ideal technical training & testing center.json') return 1;
      return 2;
    };
    return score(a.name) - score(b.name) || b.lastModified - a.lastModified;
  });

  for (const file of candidates) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as WorkspaceBackup;
      if (
        parsed &&
        typeof parsed === 'object' &&
        (Array.isArray(parsed.jobs) ||
          Array.isArray(parsed.students) ||
          Array.isArray(parsed.generalAccounts))
      ) {
        return {
          folderName,
          fileCount: list.length,
          existingBackup: parsed,
          existingBackupFileName: file.name,
        };
      }
    } catch {
      // ignore invalid JSON file inside directory
    }
  }

  return {
    folderName,
    fileCount: list.length,
    existingBackup: null,
    existingBackupFileName: null,
  };
}

class ApiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiUnavailableError';
  }
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 24000
): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiUnavailableError('Server request timed out.');
    }
    throw new ApiUnavailableError(
      err instanceof Error ? err.message : 'Network connection to server failed.'
    );
  } finally {
    window.clearTimeout(timer);
  }
}

async function parseApiJson<T>(res: Response, fallbackError: string): Promise<T> {
  if (res.redirected && res.url.includes('__cookie_check')) {
    throw new ApiUnavailableError('Hosting proxy cookie check intercepted the API request.');
  }
  const text = await res.text();
  const trimmed = text.trim();
  const contentType = (res.headers.get('content-type') || '').toLowerCase();

  if (!trimmed) {
    if (res.status === 404 || res.status === 405 || res.status >= 502) {
      throw new ApiUnavailableError(`Server endpoint unavailable (HTTP ${res.status}).`);
    }
    throw new Error(`${fallbackError} (HTTP ${res.status})`);
  }

  if (
    trimmed.startsWith('<') ||
    trimmed.toLowerCase().includes('<!doctype') ||
    trimmed.includes('__cookie_check')
  ) {
    throw new ApiUnavailableError(`Server returned HTML instead of JSON (HTTP ${res.status}).`);
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    if (!contentType.includes('application/json') && (res.status === 404 || res.status === 405 || res.status >= 500)) {
      throw new ApiUnavailableError(`Server returned non-JSON response (HTTP ${res.status}).`);
    }
    throw new Error(`${fallbackError} (Invalid server response HTTP ${res.status})`);
  }
}

export async function fetchServerLocalStatus(): Promise<ServerLocalStatus> {
  try {
    const res = await fetchWithTimeout('/api/local/status', {}, 6000);
    if (!res.ok) return { supported: false, defaultPath: null };
    return await parseApiJson<ServerLocalStatus>(res, 'Local status check failed.');
  } catch {
    return { supported: false, defaultPath: null };
  }
}

export async function saveToServerLocalDrive(payload: WorkspaceBackup): Promise<{
  ok: boolean;
  path?: string;
  savedAt?: string;
  error?: string;
}> {
  const res = await fetchWithTimeout('/api/local/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: payload }),
  });
  const json = await parseApiJson<{
    ok: boolean;
    path?: string;
    savedAt?: string;
    error?: string;
  }>(res, 'Local drive write failed.');
  if (!res.ok || !json.ok) {
    throw new Error(json.error || 'Local drive write failed.');
  }
  return json;
}

const MEGA_SESSION_STORAGE_KEY = 'ittc.megaSessionToken';

function getStoredMegaSessionToken(): string {
  try {
    return localStorage.getItem(MEGA_SESSION_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function setStoredMegaSessionToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(MEGA_SESSION_STORAGE_KEY, token);
    else localStorage.removeItem(MEGA_SESSION_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}

function getMegaRequestHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getStoredMegaSessionToken();
  return {
    ...(token ? { 'x-mega-session': token } : {}),
    ...(extra || {}),
  };
}

export interface MegaConnectResult extends MegaSyncStatus {
  sessionToken?: string;
  remoteFound?: boolean;
  remoteModifiedAt?: string | null;
  remoteBackup?: WorkspaceBackup | null;
}

export interface MegaDailyExcelEntry {
  fileName: string;
  date: string;
  size: number;
  modifiedAt: string;
}

export interface MegaExcelViewResult {
  ok: boolean;
  found: boolean;
  fileName: string;
  date: string;
  size?: number;
  modifiedAt?: string;
  headers?: string[];
  rows?: Array<Array<string | number>>;
  totalRow?: Array<string | number> | null;
}

export async function fetchMegaSyncStatus(): Promise<MegaSyncStatus> {
  try {
    const res = await fetchWithTimeout(
      '/api/mega/status',
      {
        credentials: 'include',
        headers: getMegaRequestHeaders(),
      },
      8000
    );
    if (!res.ok) {
      return getBrowserMegaStatus();
    }
    const serverStatus = await parseApiJson<MegaSyncStatus>(res, 'Mega status check failed.');
    if (serverStatus.configured) return serverStatus;
    return getBrowserMegaStatus();
  } catch {
    return getBrowserMegaStatus();
  }
}

export async function connectMegaAccount(
  email: string,
  password: string
): Promise<MegaConnectResult> {
  const cleanEmail = email.trim();
  try {
    const res = await fetchWithTimeout('/api/mega/connect', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: cleanEmail, password }),
    });
    const json = await parseApiJson<MegaConnectResult & { ok?: boolean; error?: string }>(
      res,
      'Mega account connection failed.'
    );
    if (!res.ok || !json.ok) {
      throw new Error(json.error || 'Mega account connection failed.');
    }
    // Retain browser-direct credentials as seamless fallback if server session expires or another container handles requests
    saveBrowserMegaCreds(cleanEmail, password);
    if (json.sessionToken) {
      setStoredMegaSessionToken(json.sessionToken);
    }
    return {
      configured: Boolean(json.configured),
      email: json.email || cleanEmail,
      source: json.source || 'account',
      sessionToken: json.sessionToken,
      remoteFound: Boolean(json.remoteFound),
      remoteModifiedAt: json.remoteModifiedAt || null,
      remoteBackup: json.remoteBackup || null,
    };
  } catch (err) {
    if (err instanceof ApiUnavailableError) {
      setStoredMegaSessionToken(null);
      return await connectMegaDirect(cleanEmail, password);
    }
    throw err;
  }
}

export async function disconnectMegaAccount(): Promise<MegaSyncStatus> {
  setStoredMegaSessionToken(null);
  clearBrowserMegaCreds();
  try {
    const res = await fetchWithTimeout(
      '/api/mega/disconnect',
      {
        method: 'POST',
        credentials: 'include',
      },
      8000
    );
    const json = await parseApiJson<MegaSyncStatus>(res, 'Mega disconnect failed.');
    return {
      configured: Boolean(json.configured),
      email: json.email || null,
      source: json.source || null,
    };
  } catch {
    return { configured: false, email: null, source: null };
  }
}

export const MEGA_BACKUP_FILENAME = 'Ideal Technical Training & Testing Center.json';

export async function pullDatabaseJsonFromMega(): Promise<{
  ok: boolean;
  found: boolean;
  fileName: string;
  size: number;
  modifiedAt: string | null;
  remoteBackup: WorkspaceBackup | null;
}> {
  const browserActive = getBrowserMegaStatus().configured && !getStoredMegaSessionToken();
  if (browserActive) {
    return await pullDatabaseJsonDirect();
  }
  try {
    const res = await fetchWithTimeout(
      '/api/mega/pull',
      {
        credentials: 'include',
        headers: getMegaRequestHeaders(),
      },
      35000
    );
    const json = await parseApiJson<{
      ok?: boolean;
      found?: boolean;
      fileName?: string;
      size?: number;
      modifiedAt?: string | null;
      remoteBackup?: WorkspaceBackup | null;
      error?: string;
    }>(res, 'Failed to fetch latest data from Mega.');
    if (!res.ok || !json.ok) {
      if ((res.status === 400 || res.status === 401 || res.status === 404 || res.status >= 500) && getBrowserMegaStatus().configured) {
        if (res.status === 400 || res.status === 401) setStoredMegaSessionToken(null);
        return await pullDatabaseJsonDirect();
      }
      throw new Error(json.error || 'Failed to fetch latest data from Mega.');
    }
    return {
      ok: true,
      found: Boolean(json.found),
      fileName: json.fileName || MEGA_BACKUP_FILENAME,
      size: Number(json.size || 0),
      modifiedAt: json.modifiedAt || null,
      remoteBackup: json.remoteBackup || null,
    };
  } catch (err) {
    if (err instanceof ApiUnavailableError && getBrowserMegaStatus().configured) {
      setStoredMegaSessionToken(null);
      return await pullDatabaseJsonDirect();
    }
    throw err;
  }
}

export async function syncDatabaseAndDailyExcelToMega(
  payload: WorkspaceBackup,
  dailyDates: string[] | '__ALL__' = []
): Promise<{
  ok: boolean;
  fileName?: string;
  uploadedAt?: string;
  size?: number;
  excelUploaded?: string[];
  error?: string;
}> {
  const browserActive = getBrowserMegaStatus().configured && !getStoredMegaSessionToken();
  if (browserActive) {
    return await syncDatabaseAndDailyExcelDirect(payload, dailyDates);
  }
  const syncTimeoutMs = dailyDates === '__ALL__' ? 120000 : 45000;
  try {
    const res = await fetchWithTimeout(
      '/api/mega/sync',
      {
        method: 'POST',
        credentials: 'include',
        headers: getMegaRequestHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          fileName: MEGA_BACKUP_FILENAME,
          data: payload,
          dailyDates,
        }),
      },
      syncTimeoutMs
    );
    const json = await parseApiJson<{
      ok: boolean;
      fileName?: string;
      uploadedAt?: string;
      size?: number;
      excelUploaded?: string[];
      error?: string;
    }>(res, 'Mega upload failed.');
    if (!res.ok || !json.ok) {
      if ((res.status === 400 || res.status === 401 || res.status === 404 || res.status >= 500) && getBrowserMegaStatus().configured) {
        if (res.status === 400 || res.status === 401) setStoredMegaSessionToken(null);
        return await syncDatabaseAndDailyExcelDirect(payload, dailyDates);
      }
      throw new Error(json.error || 'Mega upload failed');
    }
    return json;
  } catch (err) {
    if (err instanceof ApiUnavailableError && getBrowserMegaStatus().configured) {
      setStoredMegaSessionToken(null);
      return await syncDatabaseAndDailyExcelDirect(payload, dailyDates);
    }
    throw err;
  }
}

export async function uploadDatabaseJsonToMega(payload: WorkspaceBackup) {
  return syncDatabaseAndDailyExcelToMega(payload, '__ALL__');
}

export async function listMegaDailyExcelFiles(): Promise<MegaDailyExcelEntry[]> {
  const browserActive = getBrowserMegaStatus().configured && !getStoredMegaSessionToken();
  if (browserActive) {
    return await listMegaDailyExcelDirect();
  }
  try {
    const res = await fetchWithTimeout('/api/mega/excel/list', {
      credentials: 'include',
      headers: getMegaRequestHeaders(),
    });
    const json = await parseApiJson<{
      ok?: boolean;
      files?: MegaDailyExcelEntry[];
      error?: string;
    }>(res, 'Failed to load daily Excel files from Mega.');
    if (!res.ok || !json.ok) {
      if ((res.status === 400 || res.status === 401 || res.status === 404 || res.status >= 500) && getBrowserMegaStatus().configured) {
        if (res.status === 400 || res.status === 401) setStoredMegaSessionToken(null);
        return await listMegaDailyExcelDirect();
      }
      throw new Error(json.error || 'Failed to load daily Excel files from Mega.');
    }
    return Array.isArray(json.files) ? json.files : [];
  } catch (err) {
    if (err instanceof ApiUnavailableError && getBrowserMegaStatus().configured) {
      setStoredMegaSessionToken(null);
      return await listMegaDailyExcelDirect();
    }
    throw err;
  }
}

export async function viewMegaDailyExcel(params: {
  date?: string;
  fileName?: string;
}): Promise<MegaExcelViewResult> {
  const browserActive = getBrowserMegaStatus().configured && !getStoredMegaSessionToken();
  if (browserActive) {
    return await viewMegaDailyExcelDirect(params);
  }
  const qs = new URLSearchParams();
  if (params.fileName) qs.set('fileName', params.fileName);
  if (params.date) qs.set('date', params.date);
  try {
    const res = await fetchWithTimeout(`/api/mega/excel/view?${qs.toString()}`, {
      credentials: 'include',
      headers: getMegaRequestHeaders(),
    });
    const json = await parseApiJson<MegaExcelViewResult & { error?: string }>(
      res,
      'Failed to open Excel file from Mega.'
    );
    if (!res.ok || !json.ok) {
      if ((res.status === 400 || res.status === 401 || res.status === 404 || res.status >= 500) && getBrowserMegaStatus().configured) {
        if (res.status === 400 || res.status === 401) setStoredMegaSessionToken(null);
        return await viewMegaDailyExcelDirect(params);
      }
      throw new Error(json.error || 'Failed to open Excel file from Mega.');
    }
    return json;
  } catch (err) {
    if (err instanceof ApiUnavailableError && getBrowserMegaStatus().configured) {
      setStoredMegaSessionToken(null);
      return await viewMegaDailyExcelDirect(params);
    }
    throw err;
  }
}

function triggerBlobDownload(blob: Blob, downloadName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = downloadName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export async function downloadMegaDailyExcel(params: {
  date?: string;
  fileName?: string;
}): Promise<string> {
  const browserActive = getBrowserMegaStatus().configured && !getStoredMegaSessionToken();
  if (browserActive) {
    const { blob, fileName } = await downloadMegaDailyExcelDirect(params);
    triggerBlobDownload(blob, fileName);
    return fileName;
  }
  const qs = new URLSearchParams();
  if (params.fileName) qs.set('fileName', params.fileName);
  if (params.date) qs.set('date', params.date);
  try {
    const res = await fetchWithTimeout(`/api/mega/excel/download?${qs.toString()}`, {
      credentials: 'include',
      headers: getMegaRequestHeaders(),
    });
    if (res.redirected && res.url.includes('__cookie_check')) {
      throw new ApiUnavailableError('Hosting proxy cookie check intercepted the download.');
    }
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (!res.ok || contentType.includes('text/html')) {
      if (contentType.includes('text/html') || res.status === 404 || res.status === 405 || res.status >= 502) {
        throw new ApiUnavailableError(`Server download unavailable (HTTP ${res.status}).`);
      }
      if ((res.status === 400 || res.status === 401 || res.status === 404 || res.status >= 500) && getBrowserMegaStatus().configured) {
        if (res.status === 400 || res.status === 401) setStoredMegaSessionToken(null);
        const { blob, fileName } = await downloadMegaDailyExcelDirect(params);
        triggerBlobDownload(blob, fileName);
        return fileName;
      }
      const errJson = await parseApiJson<{ error?: string }>(
        res,
        'Failed to download Excel file from Mega.'
      );
      throw new Error(errJson.error || 'Failed to download Excel file from Mega.');
    }
    const blob = await res.blob();
    const cd = res.headers.get('content-disposition') || '';
    const nameMatch = /filename="?([^"]+)"?/i.exec(cd);
    const downloadName =
      nameMatch?.[1] ||
      params.fileName ||
      (params.date ? `Jobs_${params.date}.xlsx` : 'Jobs_Register.xlsx');
    triggerBlobDownload(blob, downloadName);
    return downloadName;
  } catch (err) {
    if (err instanceof ApiUnavailableError && getBrowserMegaStatus().configured) {
      setStoredMegaSessionToken(null);
      const { blob, fileName } = await downloadMegaDailyExcelDirect(params);
      triggerBlobDownload(blob, fileName);
      return fileName;
    }
    throw err;
  }
}

export async function scanMegaRecovery(): Promise<{
  ok: boolean;
  sources: MegaRecoverySourceInfo[];
  jobs: MegaRecoveryJobCandidate[];
}> {
  const browserActive = getBrowserMegaStatus().configured && !getStoredMegaSessionToken();
  if (browserActive) {
    return await scanMegaRecoveryDirect();
  }
  try {
    const res = await fetchWithTimeout(
      '/api/mega/recovery/scan',
      {
        credentials: 'include',
        headers: getMegaRequestHeaders(),
      },
      60000
    );
    const json = await parseApiJson<{
      ok?: boolean;
      sources?: MegaRecoverySourceInfo[];
      jobs?: MegaRecoveryJobCandidate[];
      error?: string;
    }>(res, 'Failed to scan MEGA recovery archives.');
    if (!res.ok || !json.ok) {
      if (
        (res.status === 400 || res.status === 401 || res.status === 404 || res.status >= 500) &&
        getBrowserMegaStatus().configured
      ) {
        if (res.status === 400 || res.status === 401) setStoredMegaSessionToken(null);
        return await scanMegaRecoveryDirect();
      }
      throw new Error(json.error || 'Failed to scan MEGA recovery archives.');
    }
    return {
      ok: true,
      sources: Array.isArray(json.sources) ? json.sources : [],
      jobs: Array.isArray(json.jobs) ? json.jobs : [],
    };
  } catch (err) {
    if (err instanceof ApiUnavailableError && getBrowserMegaStatus().configured) {
      setStoredMegaSessionToken(null);
      return await scanMegaRecoveryDirect();
    }
    throw err;
  }
}

export function downloadWindowsMegaSyncScript(): void {
  const script = `// ITTC D:\\JobTokenDatabase -> Mega Cloud Auto-Sync Watcher
// Setup once on Windows:
//   1. mkdir D:\\JobTokenDatabase
//   2. npm init -y && npm install megajs
//   3. Set MEGA_EMAIL and MEGA_PASSWORD env vars, then run: node mega-auto-sync.cjs

const fs = require('fs');
const path = require('path');
const { Storage } = require('megajs');

const dataDir = 'D:\\\\JobTokenDatabase';
const dataFilePath = path.join(dataDir, 'database.json');
const megaFileName = '${MEGA_BACKUP_FILENAME}';

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

let uploading = false;
let pending = false;

async function uploadToMega(filePath) {
  const email = process.env.MEGA_EMAIL;
  const password = process.env.MEGA_PASSWORD;
  if (!email || !password) {
    console.error('Set MEGA_EMAIL and MEGA_PASSWORD environment variables before running.');
    return;
  }

  if (uploading) {
    pending = true;
    return;
  }
  uploading = true;
  let storage = null;

  try {
    storage = new Storage({ email, password, keepalive: false });
    if (storage.on) storage.on('error', () => {});
    if (storage.api && storage.api.on) storage.api.on('error', () => {});
    await storage.ready;

    const fileBuffer = fs.readFileSync(filePath);
    const oldFiles = (storage.root.children || []).filter((c) => !c.directory && c.name === megaFileName);

    await storage.upload({ name: megaFileName, size: fileBuffer.length }, fileBuffer).complete;

    for (const oldFile of oldFiles) {
      try { await oldFile.delete(true); } catch (_) {}
    }

    console.log('[' + new Date().toLocaleTimeString() + '] Uploaded "' + megaFileName + '" to Mega successfully.');
  } catch (err) {
    console.error('Mega upload failed:', err.message);
  } finally {
    if (storage) {
      try { await storage.close(); } catch (_) {}
    }
    uploading = false;
    if (pending) {
      pending = false;
      uploadToMega(filePath);
    }
  }
}

console.log('Watching for updates:', dataFilePath);
fs.watchFile(dataFilePath, { interval: 2000 }, (curr, prev) => {
  if (curr.mtimeMs !== prev.mtimeMs && curr.size > 0) {
    console.log('Detected updated database.json — syncing to Mega...');
    uploadToMega(dataFilePath);
  }
});
`;
  downloadFile('mega-auto-sync.cjs', script, 'text/javascript;charset=utf-8');
}
