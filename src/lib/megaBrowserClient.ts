import { Storage, type MutableFile } from 'megajs';
import * as XLSX from 'xlsx';
import type { WorkspaceBackup } from '../types';

const MEGA_BACKUP_FILENAME = 'Ideal Technical Training & Testing Center.json';
const MEGA_EXCEL_FOLDER = 'ITTC_Daily_Jobs';
const BROWSER_MEGA_STORAGE_KEY = 'ittc.megaBrowserSess';

interface StoredBrowserCreds {
  email: string;
  password: string;
}

interface JobRecordLike {
  date?: string;
  no?: string;
  sname?: string;
  sid?: string;
  cat?: string;
  pay?: number;
  discount?: number;
  note?: string;
}

let inMemoryCreds: StoredBrowserCreds | null = null;
const browserMegaQueues = new Map<string, Promise<unknown>>();

function encodeCreds(creds: StoredBrowserCreds): string {
  const json = JSON.stringify(creds);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) {
    bin += String.fromCharCode(bytes[i] ^ ((i * 31 + 73) & 0xff));
  }
  return btoa(bin);
}

function decodeCreds(encoded: string): StoredBrowserCreds | null {
  try {
    const bin = atob(encoded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) {
      bytes[i] = bin.charCodeAt(i) ^ ((i * 31 + 73) & 0xff);
    }
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<StoredBrowserCreds>;
    if (parsed.email && parsed.password) {
      return { email: String(parsed.email).trim(), password: String(parsed.password) };
    }
  } catch {
    // ignore malformed session
  }
  return null;
}

function getSavedBrowserCreds(): StoredBrowserCreds | null {
  if (inMemoryCreds) return inMemoryCreds;
  try {
    const raw = localStorage.getItem(BROWSER_MEGA_STORAGE_KEY);
    if (!raw) return null;
    const decoded = decodeCreds(raw);
    if (decoded) {
      inMemoryCreds = decoded;
      return decoded;
    }
  } catch {
    // ignore storage errors
  }
  return null;
}

export function saveBrowserMegaCreds(email: string, password: string): void {
  const creds: StoredBrowserCreds = { email: email.trim(), password };
  inMemoryCreds = creds;
  try {
    localStorage.setItem(BROWSER_MEGA_STORAGE_KEY, encodeCreds(creds));
  } catch {
    // ignore storage errors
  }
}

export function clearBrowserMegaCreds(): void {
  inMemoryCreds = null;
  try {
    localStorage.removeItem(BROWSER_MEGA_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}

export function getBrowserMegaStatus(): {
  configured: boolean;
  email: string | null;
  source: 'account' | null;
} {
  const saved = getSavedBrowserCreds();
  return saved
    ? { configured: true, email: saved.email, source: 'account' }
    : { configured: false, email: null, source: null };
}

function enqueueBrowserMegaTask<T>(email: string, fn: () => Promise<T>): Promise<T> {
  const key = email.trim().toLowerCase() || 'default';
  const prev = browserMegaQueues.get(key) || Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  browserMegaQueues.set(
    key,
    next.finally(() => {
      if (browserMegaQueues.get(key) === next) {
        browserMegaQueues.delete(key);
      }
    })
  );
  return next;
}

function attachMegaErrorGuards(storage: Storage): void {
  const s = storage as unknown as {
    on?: (event: string, fn: (...args: unknown[]) => void) => void;
    api?: { on?: (event: string, fn: (...args: unknown[]) => void) => void };
  };
  s.on?.('error', () => {});
  s.api?.on?.('error', () => {});
}

async function closeMegaDirectStorage(storage: Storage | null): Promise<void> {
  if (!storage) return;
  try {
    const s = storage as unknown as {
      sid?: string;
      status?: string;
      api?: { close?: () => void };
      close?: (cb?: () => void) => unknown;
    };
    if (!s.sid) {
      s.status = 'closed';
      s.api?.close?.();
      return;
    }
    await new Promise<void>((resolve) => {
      const done = window.setTimeout(resolve, 2500);
      try {
        const ret = s.close?.(() => {
          window.clearTimeout(done);
          resolve();
        });
        if (ret && typeof (ret as Promise<unknown>).catch === 'function') {
          (ret as Promise<unknown>).catch(() => {}).finally(() => {
            window.clearTimeout(done);
            resolve();
          });
        }
      } catch {
        window.clearTimeout(done);
        resolve();
      }
    });
  } catch {
    // ignore close errors
  }
}

async function connectMegaDirectStorage(email: string, password: string): Promise<Storage> {
  const storage = new Storage({
    email,
    password,
    keepalive: false,
  } as ConstructorParameters<typeof Storage>[0]);
  attachMegaErrorGuards(storage);
  storage.ready.catch(() => {});
  try {
    await Promise.race([
      storage.ready,
      new Promise<never>((_, reject) =>
        window.setTimeout(
          () => reject(new Error('Mega login timed out. Please check your internet connection.')),
          20000
        )
      ),
    ]);
    return storage;
  } catch (err) {
    await closeMegaDirectStorage(storage);
    const rawMsg = err instanceof Error ? err.message : 'Mega authentication failed.';
    if (/ENOENT|EACCESS|EARGS|ESID/i.test(rawMsg)) {
      throw new Error('Invalid Mega email or password (or 2FA is enabled on this Mega account).');
    }
    throw new Error(rawMsg);
  }
}

function pickNewestFile(files: MutableFile[]): MutableFile | null {
  if (!files.length) return null;
  return [...files].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))[0] || null;
}

function toExactUint8Array(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const buf = new ArrayBuffer(data.byteLength);
  const view = new Uint8Array(buf);
  view.set(data);
  return view;
}

async function uploadBytesToMegaDir(
  dir: MutableFile,
  fileName: string,
  bytes: Uint8Array
): Promise<void> {
  const oldCopies = (dir.children || []).filter(
    (child) => !child.directory && child.name === fileName
  );
  const uploadPayload = bytes as unknown as string;
  const stream = dir.upload(
    {
      name: fileName,
      size: bytes.byteLength,
    },
    uploadPayload
  ) as unknown as {
    on?: (event: string, fn: (...args: unknown[]) => void) => void;
    complete: Promise<MutableFile>;
  };
  stream.on?.('error', () => {});
  await stream.complete;

  for (const oldCopy of oldCopies) {
    try {
      await oldCopy.delete(false);
    } catch {
      // ignore cleanup errors
    }
  }
}

const MEGA_HISTORY_FOLDER = 'ITTC_Backup_History';

export interface MegaRecoveryJobCandidate {
  date: string;
  no: string;
  sname: string;
  sid: string;
  cat: string;
  pay: number;
  discount: number;
  paid: number;
  note: string;
  sourceLabel: string;
}

export interface MegaRecoverySourceInfo {
  label: string;
  kind: string;
  modifiedAt: string | null;
  jobsCount: number;
}

function parseJobsFromExcelBytesBrowser(
  buf: Uint8Array,
  fallbackDate: string,
  sourceLabel: string
): MegaRecoveryJobCandidate[] {
  const wb = XLSX.read(buf, { type: 'array' });
  const firstSheetName = wb.SheetNames[0];
  const ws = firstSheetName ? wb.Sheets[firstSheetName] : undefined;
  if (!ws) return [];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as Array<
    Array<string | number>
  >;
  const out: MegaRecoveryJobCandidate[] = [];
  for (let i = 1; i < aoa.length; i += 1) {
    const row = aoa[i];
    if (!row || row.every((c) => String(c ?? '').trim() === '')) continue;
    const jobNo = String(row[2] ?? '').trim();
    if (!jobNo || jobNo.toUpperCase() === 'TOTAL') continue;
    const dateVal = String(row[1] ?? '').trim() || fallbackDate;
    const sname = String(row[3] ?? '').trim();
    const sid = String(row[4] ?? '').trim();
    const cat = String(row[5] ?? '').trim();
    const disc = Math.max(0, Number(row[7] ?? 0) || 0);
    const pay = Math.max(0, Number(row[8] ?? 0) || 0);
    const note = String(row[9] ?? '').trim();
    if (!sname && !sid && !cat) continue;
    out.push({
      date: dateVal,
      no: jobNo,
      sname: sname || 'Student',
      sid: sid || '001',
      cat: cat || '6G TIG',
      pay,
      discount: disc,
      paid: pay,
      note,
      sourceLabel,
    });
  }
  return out;
}

async function findOrCreateMegaFolder(storage: Storage, folderName: string): Promise<MutableFile> {
  const existing = (storage.root.children || []).find(
    (child) => child.directory && child.name === folderName
  );
  if (existing) return existing;
  return await storage.mkdir(folderName);
}

function sanitizeDateString(raw: string): string | null {
  const trimmed = raw.trim();
  if (/^\d{2}-\d{2}-\d{4}$/.test(trimmed)) return trimmed;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [y, m, d] = trimmed.split('-');
    return `${d}-${m}-${y}`;
  }
  return null;
}

function excelFileNameForDate(dateStr: string): string {
  return `Jobs_${dateStr}.xlsx`;
}

function extractDateFromExcelName(name: string): string {
  const match = /^Jobs_(\d{2}-\d{2}-\d{4})\.xlsx$/i.exec(name.trim());
  return match ? match[1] : '';
}

function dateSortScore(ddmmyyyy: string): number {
  const parts = ddmmyyyy.split('-');
  if (parts.length !== 3) return 0;
  return Number(`${parts[2]}${parts[1]}${parts[0]}`) || 0;
}

function buildDailyJobsExcelBytes(jobs: JobRecordLike[], dateStr: string): Uint8Array {
  const dayJobs = jobs.filter((j) => String(j?.date || '').trim() === dateStr);
  const headers = [
    'SL',
    'Date',
    'Job Number',
    'Trainee Name',
    'Student Code',
    'Job Category',
    'Standard Price',
    'Discount',
    'Payable',
    'Note',
  ];

  let totalStandard = 0;
  let totalDiscount = 0;
  let totalPayable = 0;

  const rowsData = dayJobs.map((j, idx) => {
    const pay = Number(j.pay || 0);
    const disc = Number(j.discount || 0);
    const std = pay + disc;
    totalStandard += std;
    totalDiscount += disc;
    totalPayable += pay;
    return [
      idx + 1,
      String(j.date || dateStr),
      String(j.no || ''),
      String(j.sname || ''),
      String(j.sid || ''),
      String(j.cat || ''),
      std,
      disc,
      pay,
      String(j.note || ''),
    ];
  });

  const totalRow = [
    '',
    '',
    'TOTAL',
    `${dayJobs.length} Jobs`,
    '',
    '',
    totalStandard,
    totalDiscount,
    totalPayable,
    '',
  ];

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rowsData, totalRow]);
  ws['!cols'] = [
    { wch: 6 },
    { wch: 13 },
    { wch: 16 },
    { wch: 24 },
    { wch: 14 },
    { wch: 22 },
    { wch: 15 },
    { wch: 11 },
    { wch: 14 },
    { wch: 20 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Daily Job Register');
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer | Uint8Array;
  return out instanceof Uint8Array ? out : new Uint8Array(out);
}

async function readRemoteBackupFromDirectStorage(storage: Storage): Promise<{
  found: boolean;
  fileName: string;
  size: number;
  modifiedAt: string | null;
  remoteBackup: WorkspaceBackup | null;
}> {
  const candidates = (storage.root.children || []).filter(
    (child) => !child.directory && child.name === MEGA_BACKUP_FILENAME
  );
  const newest = pickNewestFile(candidates);
  if (!newest) {
    return {
      found: false,
      fileName: MEGA_BACKUP_FILENAME,
      size: 0,
      modifiedAt: null,
      remoteBackup: null,
    };
  }
  const buf = await newest.downloadBuffer({});
  const text = new TextDecoder().decode(new Uint8Array(buf)).trim();
  const modifiedAt = newest.timestamp ? new Date(newest.timestamp * 1000).toISOString() : null;
  if (!text) {
    return {
      found: false,
      fileName: newest.name || MEGA_BACKUP_FILENAME,
      size: newest.size || buf.length,
      modifiedAt,
      remoteBackup: null,
    };
  }
  const parsed = JSON.parse(text) as WorkspaceBackup;
  return {
    found: true,
    fileName: newest.name || MEGA_BACKUP_FILENAME,
    size: newest.size || buf.length,
    modifiedAt,
    remoteBackup: parsed,
  };
}

function collectExcelFilesFromDirectStorage(storage: Storage): Array<{
  file: MutableFile;
  fileName: string;
  date: string;
  size: number;
  modifiedAt: string;
}> {
  const folder = (storage.root.children || []).find(
    (child) => child.directory && child.name === MEGA_EXCEL_FOLDER
  );
  const combined: MutableFile[] = [
    ...(folder?.children || []).filter(
      (child) => !child.directory && Boolean(child.name && /^Jobs_.*\.xlsx$/i.test(child.name))
    ),
    ...(storage.root.children || []).filter(
      (child) => !child.directory && Boolean(child.name && /^Jobs_.*\.xlsx$/i.test(child.name))
    ),
  ];

  const byName = new Map<string, MutableFile>();
  for (const f of combined) {
    if (!f.name) continue;
    const prev = byName.get(f.name);
    if (!prev || (f.timestamp || 0) >= (prev.timestamp || 0)) {
      byName.set(f.name, f);
    }
  }

  return Array.from(byName.values())
    .map((f) => {
      const fileName = f.name || '';
      const date = extractDateFromExcelName(fileName);
      return {
        file: f,
        fileName,
        date,
        size: Number(f.size || 0),
        modifiedAt: f.timestamp ? new Date(f.timestamp * 1000).toISOString() : new Date().toISOString(),
      };
    })
    .sort((a, b) => {
      const diff = dateSortScore(b.date) - dateSortScore(a.date);
      if (diff !== 0) return diff;
      return b.fileName.localeCompare(a.fileName);
    });
}

export async function connectMegaDirect(email: string, password: string) {
  const cleanEmail = email.trim();
  if (!cleanEmail || !password) {
    throw new Error('Mega email and password are required.');
  }
  let storage: Storage | null = null;
  try {
    storage = await connectMegaDirectStorage(cleanEmail, password);
    const pulled = await readRemoteBackupFromDirectStorage(storage);
    saveBrowserMegaCreds(cleanEmail, password);
    return {
      configured: true,
      email: cleanEmail,
      source: 'account' as const,
      remoteFound: pulled.found,
      remoteModifiedAt: pulled.modifiedAt,
      remoteBackup: pulled.remoteBackup,
    };
  } finally {
    await closeMegaDirectStorage(storage);
  }
}

export async function pullDatabaseJsonDirect() {
  const creds = getSavedBrowserCreds();
  if (!creds) {
    throw new Error('Mega account is not connected.');
  }
  const result = await enqueueBrowserMegaTask(creds.email, async () => {
    let storage: Storage | null = null;
    try {
      storage = await connectMegaDirectStorage(creds.email, creds.password);
      return await readRemoteBackupFromDirectStorage(storage);
    } finally {
      await closeMegaDirectStorage(storage);
    }
  });
  return { ok: true, ...result };
}

export async function syncDatabaseAndDailyExcelDirect(
  payload: WorkspaceBackup,
  dailyDates: string[] | '__ALL__' = []
) {
  const creds = getSavedBrowserCreds();
  if (!creds) {
    throw new Error('Mega account is not connected. Enter your Mega email & password first.');
  }
  const jobsList = Array.isArray(payload.jobs) ? (payload.jobs as JobRecordLike[]) : [];
  const studentsList = Array.isArray(payload.students) ? payload.students : [];
  const useCompactJson = jobsList.length > 500 || studentsList.length > 300;
  const jsonBytes = new TextEncoder().encode(
    useCompactJson ? JSON.stringify(payload) : JSON.stringify(payload, null, 2)
  );
  const targetDatesSet = new Set<string>();

  if (dailyDates === '__ALL__') {
    for (const j of jobsList) {
      const d = sanitizeDateString(String(j?.date || ''));
      if (d) targetDatesSet.add(d);
    }
  } else if (Array.isArray(dailyDates)) {
    for (const rawDate of dailyDates) {
      const d = sanitizeDateString(String(rawDate || ''));
      if (d) targetDatesSet.add(d);
    }
  }

  return enqueueBrowserMegaTask(creds.email, async () => {
    let storage: Storage | null = null;
    try {
      storage = await connectMegaDirectStorage(creds.email, creds.password);
      await uploadBytesToMegaDir(storage.root, MEGA_BACKUP_FILENAME, jsonBytes);

      try {
        const now = new Date();
        const dStr = `${String(now.getDate()).padStart(2, '0')}-${String(
          now.getMonth() + 1
        ).padStart(2, '0')}-${now.getFullYear()}`;
        const histFileName = `Backup_${dStr}.json`;
        const histDir = await findOrCreateMegaFolder(storage, MEGA_HISTORY_FOLDER);
        const existingHist = pickNewestFile(
          (histDir.children || []).filter((c) => !c.directory && c.name === histFileName)
        );
        let shouldWriteHist = !existingHist;
        if (existingHist) {
          const prevAgeMs = existingHist.timestamp
            ? Date.now() - existingHist.timestamp * 1000
            : Infinity;
          if (prevAgeMs > 10 * 60 * 1000 || jsonBytes.byteLength >= (existingHist.size || 0)) {
            shouldWriteHist = true;
          }
        }
        if (shouldWriteHist) {
          await uploadBytesToMegaDir(histDir, histFileName, jsonBytes);
        }
      } catch {
        // non-fatal history snapshot error
      }

      const excelUploaded: string[] = [];
      const datesToUpload = Array.from(targetDatesSet);
      if (datesToUpload.length > 0) {
        const excelDir = await findOrCreateMegaFolder(storage, MEGA_EXCEL_FOLDER);
        for (const dateStr of datesToUpload) {
          const excelName = excelFileNameForDate(dateStr);
          const excelBytes = buildDailyJobsExcelBytes(jobsList, dateStr);
          await uploadBytesToMegaDir(excelDir, excelName, excelBytes);
          excelUploaded.push(excelName);
        }
      }

      return {
        ok: true,
        fileName: MEGA_BACKUP_FILENAME,
        size: jsonBytes.byteLength,
        excelUploaded,
        uploadedAt: new Date().toISOString(),
      };
    } finally {
      await closeMegaDirectStorage(storage);
    }
  });
}

export async function listMegaDailyExcelDirect() {
  const creds = getSavedBrowserCreds();
  if (!creds) {
    throw new Error('Mega account is not connected.');
  }
  return enqueueBrowserMegaTask(creds.email, async () => {
    let storage: Storage | null = null;
    try {
      storage = await connectMegaDirectStorage(creds.email, creds.password);
      return collectExcelFilesFromDirectStorage(storage).map(
        ({ fileName, date, size, modifiedAt }) => ({
          fileName,
          date,
          size,
          modifiedAt,
        })
      );
    } finally {
      await closeMegaDirectStorage(storage);
    }
  });
}

export async function viewMegaDailyExcelDirect(params: { date?: string; fileName?: string }) {
  const creds = getSavedBrowserCreds();
  if (!creds) {
    throw new Error('Mega account is not connected.');
  }
  const reqFileName = String(params.fileName || '').trim();
  const reqDate = sanitizeDateString(String(params.date || ''));
  const targetName = reqFileName || (reqDate ? excelFileNameForDate(reqDate) : '');
  if (!targetName) {
    throw new Error('Provide a valid date (DD-MM-YYYY) or fileName.');
  }

  return enqueueBrowserMegaTask(creds.email, async () => {
    let storage: Storage | null = null;
    try {
      storage = await connectMegaDirectStorage(creds.email, creds.password);
      const entries = collectExcelFilesFromDirectStorage(storage);
      const match = entries.find((e) => e.fileName.toLowerCase() === targetName.toLowerCase());
      if (!match) {
        return {
          ok: true,
          found: false,
          fileName: targetName,
          date: reqDate || extractDateFromExcelName(targetName),
        };
      }

      const buf = await match.file.downloadBuffer({});
      const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
      const firstSheetName = wb.SheetNames[0];
      const ws = firstSheetName ? wb.Sheets[firstSheetName] : undefined;
      const aoa = ws
        ? (XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as Array<Array<string | number>>)
        : [];

      const headers = (aoa[0] || []).map((cell) => String(cell ?? ''));
      const bodyRows = aoa.slice(1);
      let totalRow: Array<string | number> | null = null;
      const dataRows: Array<Array<string | number>> = [];
      for (const row of bodyRows) {
        const col3 = String(row[2] ?? '').trim().toUpperCase();
        if (col3 === 'TOTAL') {
          totalRow = row;
        } else if (row.some((c) => String(c ?? '').trim() !== '')) {
          dataRows.push(row);
        }
      }

      return {
        ok: true,
        found: true,
        fileName: match.fileName,
        date: match.date || reqDate || '',
        size: match.size || buf.length,
        modifiedAt: match.modifiedAt,
        headers,
        rows: dataRows,
        totalRow,
      };
    } finally {
      await closeMegaDirectStorage(storage);
    }
  });
}

export async function downloadMegaDailyExcelDirect(params: { date?: string; fileName?: string }) {
  const creds = getSavedBrowserCreds();
  if (!creds) {
    throw new Error('Mega account is not connected.');
  }
  const reqFileName = String(params.fileName || '').trim();
  const reqDate = sanitizeDateString(String(params.date || ''));
  const targetName = reqFileName || (reqDate ? excelFileNameForDate(reqDate) : '');
  if (!targetName) {
    throw new Error('Provide a valid date (DD-MM-YYYY) or fileName.');
  }

  return enqueueBrowserMegaTask(creds.email, async () => {
    let storage: Storage | null = null;
    try {
      storage = await connectMegaDirectStorage(creds.email, creds.password);
      const entries = collectExcelFilesFromDirectStorage(storage);
      const match = entries.find((e) => e.fileName.toLowerCase() === targetName.toLowerCase());
      if (!match) {
        throw new Error(`Excel file "${targetName}" not found in Mega.`);
      }
      const buf = await match.file.downloadBuffer({});
      const blob = new Blob([toExactUint8Array(new Uint8Array(buf))], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      return { fileName: match.fileName, blob };
    } finally {
      await closeMegaDirectStorage(storage);
    }
  });
}

export async function scanMegaRecoveryDirect(): Promise<{
  ok: boolean;
  sources: MegaRecoverySourceInfo[];
  jobs: MegaRecoveryJobCandidate[];
}> {
  const creds = getSavedBrowserCreds();
  if (!creds) {
    throw new Error('Mega account is not connected.');
  }

  return enqueueBrowserMegaTask(creds.email, async () => {
    let storage: Storage | null = null;
    try {
      storage = await connectMegaDirectStorage(creds.email, creds.password);
      const sources: MegaRecoverySourceInfo[] = [];
      const recoveredJobs: MegaRecoveryJobCandidate[] = [];

      const excelEntries = collectExcelFilesFromDirectStorage(storage);
      for (const entry of excelEntries.slice(0, 15)) {
        try {
          const buf = await entry.file.downloadBuffer({});
          const label = `MEGA Excel: ${entry.fileName}`;
          const parsed = parseJobsFromExcelBytesBrowser(
            new Uint8Array(buf),
            entry.date,
            label
          );
          sources.push({
            label,
            kind: 'mega-excel',
            modifiedAt: entry.modifiedAt,
            jobsCount: parsed.length,
          });
          recoveredJobs.push(...parsed);
        } catch {
          // skip unreadable file
        }
      }

      const histDir = (storage.root.children || []).find(
        (c) => c.directory && c.name === MEGA_HISTORY_FOLDER
      );
      if (histDir?.children) {
        const histFiles = histDir.children
          .filter((c) => !c.directory && Boolean(c.name && /\.json$/i.test(c.name)))
          .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
          .slice(0, 8);
        for (const hf of histFiles) {
          try {
            const buf = await hf.downloadBuffer({});
            const text = new TextDecoder().decode(new Uint8Array(buf));
            const parsed = JSON.parse(text) as WorkspaceBackup;
            const jobsArr = Array.isArray(parsed.jobs) ? parsed.jobs : [];
            const label = `MEGA History: ${hf.name}`;
            sources.push({
              label,
              kind: 'mega-history',
              modifiedAt: hf.timestamp ? new Date(hf.timestamp * 1000).toISOString() : null,
              jobsCount: jobsArr.length,
            });
            for (const j of jobsArr) {
              recoveredJobs.push({
                date: String(j.date || ''),
                no: String(j.no || ''),
                sname: String(j.sname || 'Student'),
                sid: String(j.sid || '001'),
                cat: String(j.cat || '6G TIG'),
                pay: Math.max(0, Number(j.pay || 0)),
                discount: Math.max(0, Number(j.discount || 0)),
                paid: Math.max(0, Number(j.paid ?? j.pay ?? 0)),
                note: String(j.note || ''),
                sourceLabel: label,
              });
            }
          } catch {
            // skip malformed json
          }
        }
      }

      const trashChildren = (storage as unknown as { trash?: MutableFile }).trash?.children || [];
      const trashCandidates = trashChildren
        .filter(
          (c) =>
            !c.directory &&
            Boolean(c.name && (/^Jobs_.*\.xlsx$/i.test(c.name) || /\.json$/i.test(c.name)))
        )
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
        .slice(0, 12);

      for (const tf of trashCandidates) {
        try {
          const buf = await tf.downloadBuffer({});
          const name = tf.name || 'file';
          const mod = tf.timestamp ? new Date(tf.timestamp * 1000).toISOString() : null;
          if (/\.xlsx$/i.test(name)) {
            const label = `MEGA Trash Excel: ${name}`;
            const parsed = parseJobsFromExcelBytesBrowser(
              new Uint8Array(buf),
              extractDateFromExcelName(name),
              label
            );
            sources.push({
              label,
              kind: 'mega-trash',
              modifiedAt: mod,
              jobsCount: parsed.length,
            });
            recoveredJobs.push(...parsed);
          } else {
            const text = new TextDecoder().decode(new Uint8Array(buf));
            const parsed = JSON.parse(text) as WorkspaceBackup;
            const jobsArr = Array.isArray(parsed.jobs) ? parsed.jobs : [];
            const label = `MEGA Trash JSON: ${name}`;
            sources.push({
              label,
              kind: 'mega-trash',
              modifiedAt: mod,
              jobsCount: jobsArr.length,
            });
            for (const j of jobsArr) {
              recoveredJobs.push({
                date: String(j.date || ''),
                no: String(j.no || ''),
                sname: String(j.sname || 'Student'),
                sid: String(j.sid || '001'),
                cat: String(j.cat || '6G TIG'),
                pay: Math.max(0, Number(j.pay || 0)),
                discount: Math.max(0, Number(j.discount || 0)),
                paid: Math.max(0, Number(j.paid ?? j.pay ?? 0)),
                note: String(j.note || ''),
                sourceLabel: label,
              });
            }
          }
        } catch {
          // skip unreadable trash item
        }
      }

      return { ok: true, sources, jobs: recoveredJobs };
    } finally {
      await closeMegaDirectStorage(storage);
    }
  });
}
