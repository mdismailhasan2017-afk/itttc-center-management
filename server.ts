import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import express from 'express';
import { GoogleGenAI, ThinkingLevel, Type, type FunctionDeclaration } from '@google/genai';
import { Storage, type MutableFile } from 'megajs';
import * as XLSX from 'xlsx';

const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === 'production';
const MEGA_SESSION_COOKIE = 'ittc_mega_sess';
const MEGA_SECRET_FILE = path.resolve(process.cwd(), '.env.mega.secret');
const MEGA_BACKUP_FILENAME = 'Ideal Technical Training & Testing Center.json';
const MEGA_EXCEL_FOLDER = 'ITTC_Daily_Jobs';
const WINDOWS_DATA_DIR = 'D:\\JobTokenDatabase';
const WINDOWS_DATA_FILE = path.join(WINDOWS_DATA_DIR, 'database.json');

interface MegaCreds {
  email: string;
  password: string;
  source: 'env' | 'account';
}

interface JobRecordInput {
  date?: string;
  no?: string;
  sname?: string;
  sid?: string;
  cat?: string;
  pay?: number;
  discount?: number;
  note?: string;
}

interface WorkspacePayloadInput {
  exportedAt?: string;
  jobs?: JobRecordInput[];
  [key: string]: unknown;
}

function getSessionSecretKey(): Buffer {
  const envSecret = (
    process.env.MEGA_SESSION_SECRET ||
    process.env.SESSION_SECRET ||
    ''
  ).trim();
  if (envSecret) {
    return crypto.createHash('sha256').update(envSecret).digest();
  }
  try {
    if (fs.existsSync(MEGA_SECRET_FILE)) {
      const hex = fs.readFileSync(MEGA_SECRET_FILE, 'utf8').trim();
      if (/^[0-9a-f]{64}$/i.test(hex)) {
        return Buffer.from(hex, 'hex');
      }
    }
    const generated = crypto.randomBytes(32);
    fs.writeFileSync(MEGA_SECRET_FILE, generated.toString('hex'), {
      encoding: 'utf8',
      mode: 0o600,
    });
    return generated;
  } catch {
    return crypto.createHash('sha256').update(`ittc-fallback-${process.cwd()}`).digest();
  }
}

const SESSION_KEY = getSessionSecretKey();

function encryptMegaSessionCookie(email: string, password: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', SESSION_KEY, iv);
  const plaintext = JSON.stringify({ email, password, iat: Date.now() });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64url');
}

function decryptMegaSessionCookie(token: string): { email: string; password: string } | null {
  try {
    const raw = Buffer.from(token, 'base64url');
    if (raw.length < 29) return null;
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ciphertext = raw.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', SESSION_KEY, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    const parsed = JSON.parse(decrypted) as { email?: string; password?: string };
    if (parsed.email && parsed.password) {
      return { email: String(parsed.email).trim(), password: String(parsed.password) };
    }
  } catch {
    // invalid or tampered cookie
  }
  return null;
}

function parseCookies(req: express.Request): Record<string, string> {
  const header = req.headers.cookie || '';
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function setMegaSessionCookie(
  req: express.Request,
  res: express.Response,
  email: string,
  password: string
): string {
  const isHttps =
    req.secure ||
    String(req.headers['x-forwarded-proto'] || '')
      .split(',')[0]
      .trim()
      .toLowerCase() === 'https';
  const value = encryptMegaSessionCookie(email, password);
  res.cookie(MEGA_SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: isHttps ? 'none' : 'lax',
    secure: isHttps,
    path: '/',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
  return value;
}

function clearMegaSessionCookie(req: express.Request, res: express.Response): void {
  const isHttps =
    req.secure ||
    String(req.headers['x-forwarded-proto'] || '')
      .split(',')[0]
      .trim()
      .toLowerCase() === 'https';
  res.clearCookie(MEGA_SESSION_COOKIE, {
    httpOnly: true,
    sameSite: isHttps ? 'none' : 'lax',
    secure: isHttps,
    path: '/',
  });
}

function getActiveMegaCreds(req: express.Request): MegaCreds | null {
  const headerToken = String(req.headers['x-mega-session'] || '').trim();
  if (headerToken) {
    const parsedHeader = decryptMegaSessionCookie(headerToken);
    if (parsedHeader) {
      return { email: parsedHeader.email, password: parsedHeader.password, source: 'account' };
    }
  }
  const cookies = parseCookies(req);
  const sessToken = cookies[MEGA_SESSION_COOKIE];
  if (sessToken) {
    const parsed = decryptMegaSessionCookie(sessToken);
    if (parsed) {
      return { email: parsed.email, password: parsed.password, source: 'account' };
    }
  }
  const envEmail = (process.env.MEGA_EMAIL || '').trim();
  const envPassword = (process.env.MEGA_PASSWORD || '').trim();
  if (envEmail && envPassword) {
    return { email: envEmail, password: envPassword, source: 'env' };
  }
  return null;
}

const megaTaskQueues = new Map<string, Promise<unknown>>();

function enqueueMegaTask<T>(email: string, fn: () => Promise<T>): Promise<T> {
  const key = email.trim().toLowerCase() || 'default';
  const prev = megaTaskQueues.get(key) || Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  megaTaskQueues.set(
    key,
    next.finally(() => {
      if (megaTaskQueues.get(key) === next) {
        megaTaskQueues.delete(key);
      }
    })
  );
  return next;
}

function attachServerMegaErrorGuards(storage: Storage): void {
  const s = storage as unknown as {
    on?: (event: string, fn: (...args: unknown[]) => void) => void;
    api?: { on?: (event: string, fn: (...args: unknown[]) => void) => void };
  };
  s.on?.('error', () => {});
  s.api?.on?.('error', () => {});
}

async function closeMegaStorage(storage: Storage | null): Promise<void> {
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
      const done = setTimeout(resolve, 2500);
      try {
        const ret = s.close?.(() => {
          clearTimeout(done);
          resolve();
        });
        if (ret && typeof (ret as Promise<unknown>).catch === 'function') {
          (ret as Promise<unknown>).catch(() => {}).finally(() => {
            clearTimeout(done);
            resolve();
          });
        }
      } catch {
        clearTimeout(done);
        resolve();
      }
    });
  } catch {
    // ignore close errors
  }
}

async function connectMegaStorage(email: string, password: string): Promise<Storage> {
  const storage = new Storage({
    email,
    password,
    keepalive: false,
  } as ConstructorParameters<typeof Storage>[0]);
  attachServerMegaErrorGuards(storage);
  storage.ready.catch(() => {});
  try {
    await Promise.race([
      storage.ready,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Mega login timed out. Please check your internet connection.')), 20000)
      ),
    ]);
    return storage;
  } catch (err) {
    await closeMegaStorage(storage);
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

async function uploadBufferToDir(
  dir: MutableFile,
  fileName: string,
  fileBuffer: Buffer
): Promise<void> {
  const oldCopies = (dir.children || []).filter(
    (child) => !child.directory && child.name === fileName
  );
  const stream = dir.upload(
    {
      name: fileName,
      size: fileBuffer.length,
    },
    fileBuffer
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

function parseJobsFromExcelBufferServer(
  buf: Buffer,
  fallbackDate: string,
  sourceLabel: string
): Array<{
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
}> {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const firstSheetName = wb.SheetNames[0];
  const ws = firstSheetName ? wb.Sheets[firstSheetName] : undefined;
  if (!ws) return [];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as Array<
    Array<string | number>
  >;
  const out: Array<{
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
  }> = [];
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

function buildDailyJobsExcelBuffer(jobs: JobRecordInput[], dateStr: string): Buffer {
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
  const out = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer | Uint8Array;
  return Buffer.isBuffer(out) ? out : Buffer.from(out);
}

async function readRemoteBackupFromStorage(storage: Storage): Promise<{
  found: boolean;
  fileName: string;
  size: number;
  modifiedAt: string | null;
  remoteBackup: WorkspacePayloadInput | null;
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
  let parsed: WorkspacePayloadInput | null = null;
  try {
    const rawText = buf.toString('utf8').trim();
    if (rawText) {
      const candidate = JSON.parse(rawText) as WorkspacePayloadInput;
      if (candidate && typeof candidate === 'object') {
        parsed = candidate;
      }
    }
  } catch {
    throw new Error(
      `Saved "${MEGA_BACKUP_FILENAME}" in Mega is not valid JSON. Upload a fresh backup to overwrite it.`
    );
  }
  if (!parsed) {
    return {
      found: false,
      fileName: newest.name || MEGA_BACKUP_FILENAME,
      size: newest.size || buf.length,
      modifiedAt: newest.timestamp ? new Date(newest.timestamp * 1000).toISOString() : null,
      remoteBackup: null,
    };
  }
  const modifiedAt = newest.timestamp ? new Date(newest.timestamp * 1000).toISOString() : null;
  return {
    found: true,
    fileName: newest.name || MEGA_BACKUP_FILENAME,
    size: newest.size || buf.length,
    modifiedAt,
    remoteBackup: parsed,
  };
}

function collectExcelFilesFromStorage(storage: Storage): Array<{
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
    ...((folder?.children || []).filter(
      (child) => !child.directory && Boolean(child.name && /^Jobs_.*\.xlsx$/i.test(child.name))
    )),
    ...((storage.root.children || []).filter(
      (child) => !child.directory && Boolean(child.name && /^Jobs_.*\.xlsx$/i.test(child.name))
    )),
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

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  const httpServer = http.createServer(app);
  app.use(express.json({ limit: '150mb' }));

  app.get('/api/local/status', (_req, res) => {
    const supported = process.platform === 'win32';
    res.json({
      supported,
      defaultPath: supported ? WINDOWS_DATA_FILE : null,
    });
  });

  app.post('/api/local/save', (req, res) => {
    if (process.platform !== 'win32') {
      res.status(400).json({
        ok: false,
        error: 'Direct D:\\ drive write on server is only available when running locally on Windows.',
      });
      return;
    }
    const payload = req.body?.data;
    if (!payload || typeof payload !== 'object') {
      res.status(400).json({ ok: false, error: 'Missing database JSON payload.' });
      return;
    }
    try {
      if (!fs.existsSync(WINDOWS_DATA_DIR)) {
        fs.mkdirSync(WINDOWS_DATA_DIR, { recursive: true });
      }
      const jsonString = JSON.stringify(payload, null, 2);
      fs.writeFileSync(WINDOWS_DATA_FILE, jsonString, 'utf8');
      res.json({
        ok: true,
        path: WINDOWS_DATA_FILE,
        savedAt: new Date().toISOString(),
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to write D:\\JobTokenDatabase\\database.json',
      });
    }
  });

  app.get('/api/mega/status', (req, res) => {
    const active = getActiveMegaCreds(req);
    res.json({
      configured: Boolean(active),
      email: active ? active.email : null,
      source: active ? active.source : null,
    });
  });

  app.post('/api/mega/connect', async (req, res) => {
    const email = String(req.body?.email || '').trim();
    const password = String(req.body?.password || '');

    if (!email || !password) {
      res.status(400).json({
        ok: false,
        error: 'Mega email and password are required.',
      });
      return;
    }

    let storage: Storage | null = null;
    try {
      storage = await connectMegaStorage(email, password);
      const pulled = await readRemoteBackupFromStorage(storage);
      const sessionToken = setMegaSessionCookie(req, res, email, password);
      res.json({
        ok: true,
        configured: true,
        email,
        source: 'account',
        sessionToken,
        remoteFound: pulled.found,
        remoteModifiedAt: pulled.modifiedAt,
        remoteBackup: pulled.remoteBackup,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect Mega account.';
      res.status(401).json({
        ok: false,
        error: message,
      });
    } finally {
      await closeMegaStorage(storage);
    }
  });

  app.post('/api/mega/disconnect', (req, res) => {
    clearMegaSessionCookie(req, res);
    const envEmail = (process.env.MEGA_EMAIL || '').trim();
    const envPassword = (process.env.MEGA_PASSWORD || '').trim();
    const hasEnv = Boolean(envEmail && envPassword);
    res.json({
      ok: true,
      configured: hasEnv,
      email: hasEnv ? envEmail : null,
      source: hasEnv ? 'env' : null,
    });
  });

  app.get('/api/mega/pull', async (req, res) => {
    const active = getActiveMegaCreds(req);
    if (!active) {
      res.status(401).json({
        ok: false,
        error: 'Mega account is not connected.',
      });
      return;
    }

    try {
      const result = await enqueueMegaTask(active.email, async () => {
        let storage: Storage | null = null;
        try {
          storage = await connectMegaStorage(active.email, active.password);
          return await readRemoteBackupFromStorage(storage);
        } finally {
          await closeMegaStorage(storage);
        }
      });
      res.json({
        ok: true,
        ...result,
      });
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to fetch latest data from Mega.',
      });
    }
  });

  const handleMegaSync = async (req: express.Request, res: express.Response) => {
    const active = getActiveMegaCreds(req);
    if (!active) {
      res.status(400).json({
        ok: false,
        error: 'Mega account is not connected. Enter your Mega email & password first.',
      });
      return;
    }

    const payload = req.body?.data as WorkspacePayloadInput | undefined;
    if (!payload || typeof payload !== 'object') {
      res.status(400).json({
        ok: false,
        error: 'Missing database JSON payload.',
      });
      return;
    }

    const rawName = String(req.body?.fileName || MEGA_BACKUP_FILENAME).trim();
    const cleaned = rawName.replace(/[\\/:*?"<>|]/g, '_');
    const fileName = cleaned.endsWith('.json') ? cleaned : MEGA_BACKUP_FILENAME;
    const rawDailyDates = req.body?.dailyDates;
    const jobsList = Array.isArray(payload.jobs) ? payload.jobs : [];
    const studentsList = Array.isArray(payload.students) ? payload.students : [];
    const useCompactJson = jobsList.length > 500 || studentsList.length > 300;
    const jsonBuffer = Buffer.from(
      useCompactJson ? JSON.stringify(payload) : JSON.stringify(payload, null, 2),
      'utf8'
    );
    const targetDatesSet = new Set<string>();

    if (rawDailyDates === '__ALL__') {
      for (const j of jobsList) {
        const d = sanitizeDateString(String(j?.date || ''));
        if (d) targetDatesSet.add(d);
      }
    } else if (Array.isArray(rawDailyDates)) {
      for (const rawDate of rawDailyDates) {
        const d = sanitizeDateString(String(rawDate || ''));
        if (d) targetDatesSet.add(d);
      }
    }

    try {
      const result = await enqueueMegaTask(active.email, async () => {
        let storage: Storage | null = null;
        try {
          storage = await connectMegaStorage(active.email, active.password);
          await uploadBufferToDir(storage.root, fileName, jsonBuffer);

          // Also keep a daily non-overwritten checkpoint in ITTC_Backup_History so prior states remain recoverable
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
              if (prevAgeMs > 10 * 60 * 1000 || jsonBuffer.length >= (existingHist.size || 0)) {
                shouldWriteHist = true;
              }
            }
            if (shouldWriteHist) {
              await uploadBufferToDir(histDir, histFileName, jsonBuffer);
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
              const excelBuffer = buildDailyJobsExcelBuffer(jobsList, dateStr);
              await uploadBufferToDir(excelDir, excelName, excelBuffer);
              excelUploaded.push(excelName);
            }
          }

          return {
            ok: true,
            fileName,
            size: jsonBuffer.length,
            excelUploaded,
            uploadedAt: new Date().toISOString(),
          };
        } finally {
          await closeMegaStorage(storage);
        }
      });

      res.json(result);
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Mega cloud upload failed.',
      });
    }
  };

  app.post('/api/mega/sync', handleMegaSync);
  app.post('/api/mega/upload', handleMegaSync);

  app.get('/api/mega/excel/list', async (req, res) => {
    const active = getActiveMegaCreds(req);
    if (!active) {
      res.status(401).json({
        ok: false,
        error: 'Mega account is not connected.',
      });
      return;
    }

    try {
      const files = await enqueueMegaTask(active.email, async () => {
        let storage: Storage | null = null;
        try {
          storage = await connectMegaStorage(active.email, active.password);
          return collectExcelFilesFromStorage(storage).map(({ fileName, date, size, modifiedAt }) => ({
            fileName,
            date,
            size,
            modifiedAt,
          }));
        } finally {
          await closeMegaStorage(storage);
        }
      });
      res.json({ ok: true, files });
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to list daily Excel files from Mega.',
      });
    }
  });

  app.get('/api/mega/excel/view', async (req, res) => {
    const active = getActiveMegaCreds(req);
    if (!active) {
      res.status(401).json({
        ok: false,
        error: 'Mega account is not connected.',
      });
      return;
    }

    const reqFileName = String(req.query.fileName || '').trim();
    const reqDate = sanitizeDateString(String(req.query.date || ''));
    const targetName = reqFileName || (reqDate ? excelFileNameForDate(reqDate) : '');
    if (!targetName) {
      res.status(400).json({ ok: false, error: 'Provide a valid date (DD-MM-YYYY) or fileName.' });
      return;
    }

    try {
      const result = await enqueueMegaTask(active.email, async () => {
        let storage: Storage | null = null;
        try {
          storage = await connectMegaStorage(active.email, active.password);
          const entries = collectExcelFilesFromStorage(storage);
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
          const wb = XLSX.read(buf, { type: 'buffer' });
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
          await closeMegaStorage(storage);
        }
      });

      res.json(result);
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to read Excel file from Mega.',
      });
    }
  });

  app.get('/api/mega/excel/download', async (req, res) => {
    const active = getActiveMegaCreds(req);
    if (!active) {
      res.status(401).json({
        ok: false,
        error: 'Mega account is not connected.',
      });
      return;
    }

    const reqFileName = String(req.query.fileName || '').trim();
    const reqDate = sanitizeDateString(String(req.query.date || ''));
    const targetName = reqFileName || (reqDate ? excelFileNameForDate(reqDate) : '');
    if (!targetName) {
      res.status(400).json({ ok: false, error: 'Provide a valid date (DD-MM-YYYY) or fileName.' });
      return;
    }

    try {
      const result = await enqueueMegaTask(active.email, async () => {
        let storage: Storage | null = null;
        try {
          storage = await connectMegaStorage(active.email, active.password);
          const entries = collectExcelFilesFromStorage(storage);
          const match = entries.find((e) => e.fileName.toLowerCase() === targetName.toLowerCase());
          if (!match) return null;
          const buffer = await match.file.downloadBuffer({});
          return { fileName: match.fileName, buffer };
        } finally {
          await closeMegaStorage(storage);
        }
      });

      if (!result) {
        res.status(404).json({ ok: false, error: `Excel file "${targetName}" not found in Mega.` });
        return;
      }

      const safeDownloadName = result.fileName.replace(/["\\\r\n]/g, '_');
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', `attachment; filename="${safeDownloadName}"`);
      res.setHeader('Content-Length', String(result.buffer.length));
      res.send(result.buffer);
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to download Excel file from Mega.',
      });
    }
  });

  app.get('/api/mega/recovery/scan', async (req, res) => {
    const active = getActiveMegaCreds(req);
    if (!active) {
      res.status(401).json({
        ok: false,
        error: 'Mega account is not connected.',
      });
      return;
    }

    try {
      const scanResult = await enqueueMegaTask(active.email, async () => {
        let storage: Storage | null = null;
        try {
          storage = await connectMegaStorage(active.email, active.password);
          const sources: Array<{ label: string; kind: string; modifiedAt: string | null; jobsCount: number }> = [];
          const recoveredJobs: Array<{
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
          }> = [];

          // 1. Scan Daily Excel files in ITTC_Daily_Jobs & root
          const excelEntries = collectExcelFilesFromStorage(storage);
          for (const entry of excelEntries.slice(0, 15)) {
            try {
              const buf = await entry.file.downloadBuffer({});
              const label = `MEGA Excel: ${entry.fileName}`;
              const parsed = parseJobsFromExcelBufferServer(buf, entry.date, label);
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

          // 2. Scan ITTC_Backup_History/*.json
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
                const parsed = JSON.parse(buf.toString('utf8')) as WorkspacePayloadInput;
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
                    paid: Math.max(0, Number((j as { paid?: number }).paid ?? j.pay ?? 0)),
                    note: String(j.note || ''),
                    sourceLabel: label,
                  });
                }
              } catch {
                // skip malformed json
              }
            }
          }

          // 3. Scan MEGA Rubbish Bin (Trash) for older JSON / Excel copies
          const trashChildren = (storage as unknown as { trash?: MutableFile }).trash?.children || [];
          const trashCandidates = trashChildren
            .filter(
              (c) =>
                !c.directory &&
                Boolean(
                  c.name &&
                    (/^Jobs_.*\.xlsx$/i.test(c.name) ||
                      /\.json$/i.test(c.name))
                )
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
                const parsed = parseJobsFromExcelBufferServer(
                  buf,
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
                const parsed = JSON.parse(buf.toString('utf8')) as WorkspacePayloadInput;
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
                    paid: Math.max(0, Number((j as { paid?: number }).paid ?? j.pay ?? 0)),
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
          await closeMegaStorage(storage);
        }
      });

      res.json(scanResult);
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to scan Mega Cloud for recovery.',
      });
    }
  });

  const itttcToolDeclarations: FunctionDeclaration[] = [
    {
      name: 'update_color_and_theme',
      description:
        'Change the application colors, color grading, theme (light/dark), built-in or custom presets, or save/delete/reset color presets whenever the user asks to change colors or visual theme (e.g., "লাল কালার করে দেও", "make it blue", "ডার্ক মোড করো", "লাইট মোড করো", "রিসেট কালার"). Always choose harmonious, high-contrast 6-digit hex colors so text remains crisp and readable.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          themeMode: {
            type: Type.STRING,
            description: 'Optional theme mode: "light" or "dark".',
          },
          presetId: {
            type: Type.STRING,
            description:
              'Optional preset ID: "default" (Emerald), "midnight" (Midnight Dark), "navy" (Deep Navy), "amber" (Warm Charcoal), or a custom preset ID.',
          },
          colorGradingEnabled: {
            type: Type.BOOLEAN,
            description:
              'Set true to apply custom bgColor/cardColor/accentColor/textColor across the whole UI, or false to revert to standard theme.',
          },
          bgColor: {
            type: Type.STRING,
            description: '6-digit hex page background color (e.g. "#1a0609" for dark red, "#fff1f2" for light rose).',
          },
          cardColor: {
            type: Type.STRING,
            description: '6-digit hex card/sidebar surface color (e.g. "#2d0b10" for dark crimson cards, "#ffffff" for white cards).',
          },
          accentColor: {
            type: Type.STRING,
            description: '6-digit hex primary accent/highlight color (e.g. "#ef4444" red, "#3b82f6" blue, "#10b981" emerald, "#8b5cf6" purple, "#f97316" orange).',
          },
          textColor: {
            type: Type.STRING,
            description: '6-digit hex primary text color with high contrast against bgColor & cardColor (e.g. "#fff1f2" on dark, "#0f172a" on light).',
          },
          accentTheme: {
            type: Type.STRING,
            description: 'Standard mode accent: "emerald", "navy", or "flame".',
          },
          saveAsPresetName: {
            type: Type.STRING,
            description: 'Optional name to save the new colors as a reusable custom preset.',
          },
          deletePresetName: {
            type: Type.STRING,
            description: 'Optional custom preset name or ID to delete.',
          },
          resetColors: {
            type: Type.BOOLEAN,
            description: 'Set true to reset all colors back to Emerald Default.',
          },
          replyMessage: {
            type: Type.STRING,
            description: 'Clear confirmation message in Bengali or English matching user language.',
          },
        },
        required: ['replyMessage'],
      },
    },
    {
      name: 'update_animations_and_motion',
      description:
        'Enable or disable master animations and individual motion graphics effects (Aurora Mesh & Light Sweep, Bento Reveal & Spring Lift, Kinetic Counter, Magnetic Spotlight, Row Highlight Scan).',
      parameters: {
        type: Type.OBJECT,
        properties: {
          animationsEnabled: {
            type: Type.BOOLEAN,
            description: 'Master animation switch (true = on, false = off).',
          },
          fxAuroraSweep: {
            type: Type.BOOLEAN,
            description: 'Toggle Aurora Mesh & Light Sweep animation.',
          },
          fxBentoSpring: {
            type: Type.BOOLEAN,
            description: 'Toggle Bento Reveal & Spring Lift card animation.',
          },
          fxKineticCounter: {
            type: Type.BOOLEAN,
            description: 'Toggle Kinetic Counter number animation.',
          },
          fxSpotlight: {
            type: Type.BOOLEAN,
            description: 'Toggle Magnetic Spotlight cursor glow.',
          },
          fxRowScan: {
            type: Type.BOOLEAN,
            description: 'Toggle Table Row Highlight Scan.',
          },
          replyMessage: {
            type: Type.STRING,
            description: 'Clear confirmation message in Bengali or English matching user language.',
          },
        },
        required: ['replyMessage'],
      },
    },
    {
      name: 'update_graphics_and_typography',
      description:
        'Update dashboard graphics, hero banner title/subtitle, font family, global font scale (85-120%), UI language (bn/en), open the Center Settings drawer, or reset all visual appearance.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          instituteTitle: {
            type: Type.STRING,
            description: 'Optional new hero banner title.',
          },
          instituteSub: {
            type: Type.STRING,
            description: 'Optional new hero banner subtitle.',
          },
          fontFamily: {
            type: Type.STRING,
            description:
              'Optional CSS font family from: "\'Plus Jakarta Sans\', \'Hind Siliguri\', sans-serif", "\'Hind Siliguri\', \'Plus Jakarta Sans\', sans-serif", "\'Noto Sans Bengali\', \'Inter\', sans-serif", "\'Inter\', \'Hind Siliguri\', sans-serif", or "\'JetBrains Mono\', monospace".',
          },
          fontScale: {
            type: Type.NUMBER,
            description: 'Optional global font size percentage from 85 to 120 (default 100).',
          },
          language: {
            type: Type.STRING,
            description: 'Optional UI language switch: "bn" (Bengali) or "en" (English).',
          },
          openSettingsDrawer: {
            type: Type.BOOLEAN,
            description: 'Set true to open the live Center Settings drawer.',
          },
          resetAllAppearance: {
            type: Type.BOOLEAN,
            description: 'Set true to reset all colors, animations, and typography to defaults.',
          },
          replyMessage: {
            type: Type.STRING,
            description: 'Clear confirmation message in Bengali or English matching user language.',
          },
        },
        required: ['replyMessage'],
      },
    },
    {
      name: 'register_student',
      description:
        'Directly register/save a new student into the database when the user provides student details (at least a name) and instructs to add/register them.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, description: 'Full student name.' },
          code: { type: Type.STRING, description: 'Optional Khata code (e.g. 17/25). Auto-generated if omitted.' },
          phone: { type: Type.STRING, description: 'Optional mobile number.' },
          trade: { type: Type.STRING, description: 'Optional trade (e.g. 6G TIG, MIG/MAG, ARC).' },
          contract: { type: Type.NUMBER, description: 'Optional contract fee in BDT.' },
          deposit: { type: Type.NUMBER, description: 'Optional initial deposit paid in BDT.' },
          fatherName: { type: Type.STRING, description: 'Optional father name.' },
          district: { type: Type.STRING, description: 'Optional home district/address.' },
          passportNo: { type: Type.STRING, description: 'Optional passport number.' },
          note: { type: Type.STRING, description: 'Optional note.' },
          replyMessage: { type: Type.STRING, description: 'Confirmation message in user language.' },
        },
        required: ['name', 'replyMessage'],
      },
    },
    {
      name: 'update_student_record',
      description:
        'Update an existing student record (add deposit payment, update contract, trade, phone, interview passed company, overseas status, destination, passportNo, biometric status, or note).',
      parameters: {
        type: Type.OBJECT,
        properties: {
          studentCodeOrName: {
            type: Type.STRING,
            description: 'Exact student Khata code (e.g. 17/1) or exact student name.',
          },
          addDepositAmount: {
            type: Type.NUMBER,
            description: 'Amount in BDT to ADD to the student existing deposit (use when user says "৫০০ টাকা জমা করো").',
          },
          deposit: {
            type: Type.NUMBER,
            description: 'Optional exact new total deposit value (only if user wants to overwrite total deposit).',
          },
          contract: { type: Type.NUMBER, description: 'Optional new contract fee in BDT.' },
          phone: { type: Type.STRING, description: 'Optional updated phone number.' },
          trade: { type: Type.STRING, description: 'Optional updated trade.' },
          companyName: { type: Type.STRING, description: 'Optional company name.' },
          interviewPassedCompany: { type: Type.STRING, description: 'Optional interview passed company name.' },
          overseasStatus: {
            type: Type.STRING,
            description: 'Optional status: "Not Applied", "Interview Attended", "Selected", "Visa Processing", or "Flight Ready".',
          },
          destination: { type: Type.STRING, description: 'Optional destination country.' },
          passportNo: { type: Type.STRING, description: 'Optional passport number.' },
          bioEnrolled: { type: Type.BOOLEAN, description: 'Optional biometric enrolled flag.' },
          note: { type: Type.STRING, description: 'Optional updated note.' },
          logCashEntry: {
            type: Type.BOOLEAN,
            description: 'If true and addDepositAmount > 0, also records a Cashbook IN entry automatically.',
          },
          replyMessage: { type: Type.STRING, description: 'Confirmation message in user language.' },
        },
        required: ['studentCodeOrName', 'replyMessage'],
      },
    },
    {
      name: 'issue_student_job',
      description:
        'Directly record/issue a practical job entry for a student when the user gives both student code/name AND job category and instructs to save/issue it.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          studentCode: { type: Type.STRING, description: 'Exact student Khata code (e.g. 17/1).' },
          category: { type: Type.STRING, description: 'Exact job category name from Job Categories list.' },
          paid: { type: Type.NUMBER, description: 'Optional paid amount in BDT (defaults to category price minus discount).' },
          discount: { type: Type.NUMBER, description: 'Optional discount amount in BDT.' },
          note: { type: Type.STRING, description: 'Optional note.' },
          printSlip: { type: Type.BOOLEAN, description: 'Set true to open the token print preview slip after saving.' },
          replyMessage: { type: Type.STRING, description: 'Confirmation message in user language.' },
        },
        required: ['studentCode', 'category', 'replyMessage'],
      },
    },
    {
      name: 'add_cashbook_entry',
      description:
        'Record an income (in) or expense (out) transaction in the Accounts & Cashbook.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          type: { type: Type.STRING, description: '"in" for income/deposit or "out" for expense.' },
          amt: { type: Type.NUMBER, description: 'Amount in BDT.' },
          category: { type: Type.STRING, description: 'Category label (e.g. "Fee Collection", "Office Expense", "Salary", "Misc").' },
          note: { type: Type.STRING, description: 'Description/reason of the transaction.' },
          date: { type: Type.STRING, description: 'Optional DD/MM/YYYY date (defaults to today).' },
          replyMessage: { type: Type.STRING, description: 'Confirmation message in user language.' },
        },
        required: ['type', 'amt', 'note', 'replyMessage'],
      },
    },
    {
      name: 'manage_job_price_or_limit',
      description:
        'Update an existing job category price/limit OR register a new job category. Note: default categories 01-19 are protected and never deleted.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          category: { type: Type.STRING, description: 'Job category name (existing or new).' },
          price: { type: Type.NUMBER, description: 'Optional fee in BDT.' },
          limit: { type: Type.NUMBER, description: 'Optional student job quota limit.' },
          active: { type: Type.BOOLEAN, description: 'Optional active status.' },
          replyMessage: { type: Type.STRING, description: 'Confirmation message in user language.' },
        },
        required: ['category', 'replyMessage'],
      },
    },
    {
      name: 'add_operational_record',
      description:
        'Add a new operational record to staff, companies, store, returns, or docs when explicitly ordered by the user.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          collection: {
            type: Type.STRING,
            description: 'Target module: "staff", "companies", "store", "returns", or "docs".',
          },
          name: { type: Type.STRING, description: 'Person/Company/Item/Candidate name.' },
          title: { type: Type.STRING, description: 'Document title or secondary label.' },
          role: { type: Type.STRING, description: 'Staff role or designation.' },
          phone: { type: Type.STRING, description: 'Optional phone number.' },
          country: { type: Type.STRING, description: 'Country (for companies).' },
          amount: { type: Type.NUMBER, description: 'Salary or fee amount.' },
          qty: { type: Type.NUMBER, description: 'Quantity (for store).' },
          unit: { type: Type.STRING, description: 'Unit (for store, e.g. pcs, kg, box).' },
          cat: { type: Type.STRING, description: 'Category (for store or returns).' },
          code: { type: Type.STRING, description: 'Optional student/item/passport code.' },
          reason: { type: Type.STRING, description: 'Reason (for returns).' },
          note: { type: Type.STRING, description: 'Additional note.' },
          replyMessage: { type: Type.STRING, description: 'Confirmation message in user language.' },
        },
        required: ['collection', 'name', 'replyMessage'],
      },
    },
    {
      name: 'update_center_profile',
      description:
        'Update center profile metadata (institute name, subtitle, address, phone, slip footer) in the database.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, description: 'Optional institute name.' },
          subtitle: { type: Type.STRING, description: 'Optional subtitle.' },
          address: { type: Type.STRING, description: 'Optional center address.' },
          phone: { type: Type.STRING, description: 'Optional phone number.' },
          slipFooter: { type: Type.STRING, description: 'Optional slip footer note.' },
          replyMessage: { type: Type.STRING, description: 'Confirmation message in user language.' },
        },
        required: ['replyMessage'],
      },
    },
    {
      name: 'sync_cloud_data',
      description:
        'Trigger immediate MEGA Cloud upload/pull or Firestore cloud verification.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          action: {
            type: Type.STRING,
            description: 'Action: "mega_upload", "mega_pull", or "verify_cloud".',
          },
          replyMessage: { type: Type.STRING, description: 'Confirmation message in user language.' },
        },
        required: ['action', 'replyMessage'],
      },
    },
    {
      name: 'navigate_to_page',
      description:
        'Navigate the ITTC application to a specific module/page ONLY when the user explicitly orders or asks to open or go to a page.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          page: {
            type: Type.STRING,
            description:
              'Target page key: dash, students, due, inactive, jobs, outs, returns, cash, generalAccounts, staff, companies, store, prices, docs, reports, monthly, settings, or admin.',
          },
          unlockGeneralAccounts: {
            type: Type.BOOLEAN,
            description:
              'When navigating to generalAccounts, set true if the user asked to open and unlock General Accounts directly.',
          },
          categoryFilter: {
            type: Type.STRING,
            description: 'Optional job category filter if opening the jobs page.',
          },
          inactiveFilter: {
            type: Type.STRING,
            description: 'Optional filter when opening inactive page: "all", "3d", "7d", "14d", or "never".',
          },
          replyMessage: {
            type: Type.STRING,
            description:
              'Short polite confirmation message in Bengali or English matching the user language.',
          },
        },
        required: ['page', 'replyMessage'],
      },
    },
    {
      name: 'add_general_account_entry',
      description:
        'Add a new income, expense, or bank deposit/withdrawal transaction row to GENERAL ACCOUNTS. Supports Cash, Bank, and Bkash accounts, student Khata linking (auto-syncs course deposit on positive income), auto voucher numbering, AND negative amounts (e.g. -5000) when account is Bank or Bkash to deduct directly from the Bank balance without changing Cash balance.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          entryMode: {
            type: Type.STRING,
            description: '"income" (আয়), "expense" (ব্যয়/খরচ), or "bank" (ব্যাংক ডিপোজিট/উত্তোলন).',
          },
          account: {
            type: Type.STRING,
            description: 'Account channel: "Cash", "Bank", or "Bkash". Defaults to "Cash".',
          },
          amount: {
            type: Type.NUMBER,
            description:
              'Transaction amount in BDT. Use a negative number (e.g. -5000) when paying/deducting directly from Bank or Bkash balance (if user puts a minus sign before the amount with Bank/Bkash).',
          },
          description: {
            type: Type.STRING,
            description:
              'Transaction description / payee / purpose (e.g. "সবুজ কাজী (MD) - অফিস খরচ", "সেলিম মাহমুদ", "Welding Fee").',
          },
          date: {
            type: Type.STRING,
            description:
              'Optional date in DD.MM.YYYY format (e.g. 24.11.2026). Defaults to current active date or today.',
          },
          voucher: {
            type: Type.STRING,
            description: 'Optional voucher number (e.g. ME.NO-4601). Auto-incremented if omitted.',
          },
          khataNo: {
            type: Type.STRING,
            description: 'Optional student Khata code (e.g. 17/1) if linked to a student.',
          },
          replyMessage: {
            type: Type.STRING,
            description: 'Confirmation message in Bengali or English matching user language.',
          },
        },
        required: ['entryMode', 'amount', 'description', 'replyMessage'],
      },
    },
    {
      name: 'update_general_account_entry',
      description:
        'Update/edit an existing transaction row in GENERAL ACCOUNTS by rowId (from Live Center Snapshot), voucher, or matching date + text.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          rowId: {
            type: Type.STRING,
            description: 'Exact General Account row ID from Live Center Snapshot (preferred).',
          },
          voucher: {
            type: Type.STRING,
            description: 'Optional voucher number to locate the row if rowId is unavailable.',
          },
          matchDate: {
            type: Type.STRING,
            description: 'Optional DD.MM.YYYY date to help match the row.',
          },
          matchText: {
            type: Type.STRING,
            description: 'Optional text fragment from inDesc/outDesc to locate the row.',
          },
          newDate: { type: Type.STRING, description: 'Optional updated date (DD.MM.YYYY).' },
          inDesc: { type: Type.STRING, description: 'Optional updated income description/voucher string.' },
          inCash: { type: Type.STRING, description: 'Optional updated Cash IN amount string (or empty "").' },
          inBank: {
            type: Type.STRING,
            description: 'Optional updated Bank/Bkash amount string (can be negative e.g. "-5000" to deduct from Bank).',
          },
          outDesc: { type: Type.STRING, description: 'Optional updated expense description string.' },
          outCash: { type: Type.STRING, description: 'Optional updated Cash expense amount string.' },
          replyMessage: {
            type: Type.STRING,
            description: 'Confirmation message in user language.',
          },
        },
        required: ['replyMessage'],
      },
    },
    {
      name: 'delete_general_account_entry',
      description:
        'Delete a specific transaction row from GENERAL ACCOUNTS ONLY when the user explicitly orders to delete/remove it. Use exact rowId from Live Center Snapshot, or voucher, or matchDate + matchText.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          rowId: {
            type: Type.STRING,
            description: 'Exact General Account row ID from Live Center Snapshot.',
          },
          voucher: {
            type: Type.STRING,
            description: 'Optional voucher number of the row to delete.',
          },
          matchDate: {
            type: Type.STRING,
            description: 'Optional DD.MM.YYYY date of the row to delete.',
          },
          matchText: {
            type: Type.STRING,
            description: 'Optional description fragment of the row to delete.',
          },
          replyMessage: {
            type: Type.STRING,
            description: 'Confirmation message in user language.',
          },
        },
        required: ['replyMessage'],
      },
    },
    {
      name: 'manage_general_accounts_opening_and_lock',
      description:
        'Manage GENERAL ACCOUNTS opening balance (পূর্বের ব্যালেন্স), day lock/unlock, panel unlock/lock, or General Accounts passcode change.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          action: {
            type: Type.STRING,
            description:
              'Action to perform: "set_opening", "lock_date", "unlock_date", "unlock_and_open", "lock_panel", or "set_passcode".',
          },
          targetDate: {
            type: Type.STRING,
            description: 'Target date in DD.MM.YYYY format (for set_opening, lock_date, unlock_date).',
          },
          prevDate: {
            type: Type.STRING,
            description: 'Optional previous closing date (DD.MM.YYYY) for set_opening.',
          },
          openingCash: { type: Type.NUMBER, description: 'Opening Cash balance (for set_opening).' },
          openingBank: { type: Type.NUMBER, description: 'Opening Bank balance (for set_opening).' },
          openingBkash: { type: Type.NUMBER, description: 'Opening Bkash balance (for set_opening).' },
          newPasscode: {
            type: Type.STRING,
            description: 'New General Accounts password (ONLY when action is "set_passcode").',
          },
          replyMessage: {
            type: Type.STRING,
            description: 'Confirmation message in user language.',
          },
        },
        required: ['action', 'replyMessage'],
      },
    },
    {
      name: 'open_new_job_modal',
      description:
        'Open the New Student Job entry form modal when the user asks to open the form or issue a job without complete details.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          studentCode: {
            type: Type.STRING,
            description: 'Optional exact student Khata code from the Live Center Snapshot.',
          },
          category: {
            type: Type.STRING,
            description: 'Optional job category such as 6G TIG or 2G HORIZONTAL.',
          },
          replyMessage: {
            type: Type.STRING,
            description:
              'Short polite confirmation message in Bengali or English matching the user language.',
          },
        },
        required: ['replyMessage'],
      },
    },
    {
      name: 'open_register_student_modal',
      description:
        'Open the Register New Student form modal when the user asks to open the admission/registration form.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          replyMessage: {
            type: Type.STRING,
            description:
              'Short polite confirmation message in Bengali or English matching the user language.',
          },
        },
        required: ['replyMessage'],
      },
    },
    {
      name: 'open_student_profile',
      description:
        'Open a specific student profile modal when the user asks to open or inspect a particular student by exact Khata code or exact name.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          studentCode: {
            type: Type.STRING,
            description: 'Exact student Khata code from the Live Center Snapshot (e.g. 17/1).',
          },
          replyMessage: {
            type: Type.STRING,
            description:
              'Short polite confirmation message in Bengali or English matching the user language.',
          },
        },
        required: ['studentCode', 'replyMessage'],
      },
    },
  ];

  let sharedAiClient: GoogleGenAI | null = null;
  let sharedAiClientKey = '';
  let hydrogenCooldownUntil = 0;
  let flashLiteCooldownUntil = 0;

  const getSharedAiClient = (apiKey: string): GoogleGenAI => {
    if (!sharedAiClient || sharedAiClientKey !== apiKey) {
      sharedAiClient = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });
      sharedAiClientKey = apiKey;
    }
    return sharedAiClient;
  };

  app.post('/api/itttc-chat', async (req, res) => {
    const apiKey = (process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      res.status(503).json({
        ok: false,
        error: 'Gemini API key is not configured. Check Settings > Secrets to set GEMINI_API_KEY.',
      });
      return;
    }

    const rawMessages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const cleanedContents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];
    for (const item of rawMessages.slice(-6)) {
      const role = item?.role === 'model' ? 'model' : 'user';
      const text = String(item?.text || '').trim().slice(0, 1500);
      if (!text) continue;
      if (cleanedContents.length === 0 && role === 'model') continue;
      cleanedContents.push({ role, parts: [{ text }] });
    }

    if (cleanedContents.length === 0 || cleanedContents[cleanedContents.length - 1].role !== 'user') {
      res.status(400).json({ ok: false, error: 'A user message is required.' });
      return;
    }

    const lang = req.body?.lang === 'en' ? 'en' : 'bn';
    const centerSummary = String(req.body?.centerSummary || '').trim().slice(0, 24000);
    const nowInDhaka = new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Dhaka',
    }).format(new Date());

    const systemInstruction = [
      'You are "itttc chat", a full-access intelligent AI super-assistant inside the Ideal Technical Training & Testing Center (ITTC) management dashboard.',
      `Current Date & Time (Bangladesh / Asia/Dhaka): ${nowInDhaka}.`,
      'You have FULL ACCESS to execute anything the user asks inside the app using your tool functions:',
      '1. APPEARANCE, COLOR & THEME CONTROL: If the user asks to change colors (e.g. "লাল কালার করে দেও", "নীল করে দেও", "সবুজ থিম দাও", "হলুদ/সোনালি/বেগুনি/কমলা/গোলাপি করো", OR even a general request without naming a color like "কালার পরিবর্তন করে দেও", "রং বদলাও", "change color"), switch dark/light mode, apply/save/delete presets, or reset colors, ALWAYS call `update_color_and_theme` immediately! If no specific color was named, choose a vibrant theme DIFFERENT from the current `accentColor` in UI Appearance State (e.g. Crimson Red bg="#1b070a" card="#2d0b11" accent="#ef4444" text="#fff1f2", Ocean Blue bg="#071326" card="#0e2240" accent="#3b82f6" text="#eff6ff", Royal Purple bg="#130924" card="#1f103a" accent="#a855f7" text="#faf5ff", or Sunset Orange bg="#1a0c05" card="#2c1509" accent="#f97316" text="#fff7ed"). Output clean 6-digit hex strings ONLY (never append commas or trailing characters). Always ensure high contrast between `textColor` and `bgColor`/`cardColor`.',
      '2. ANIMATIONS & MOTION GRAPHICS: If the user asks to turn animations on/off or toggle Aurora Sweep, Bento Spring, Kinetic Counter, Magnetic Spotlight, or Row Scan, call `update_animations_and_motion` immediately.',
      '3. GRAPHICS, FONTS & BRANDING: If the user asks to resize fonts (85-120%), switch font family, update hero title/subtitle, switch Bengali/English language, open Center Settings drawer, or reset appearance, call `update_graphics_and_typography` immediately.',
      '4. FULL DATABASE & OPERATIONS ACCESS: You can register students (`register_student`), update student deposits/contracts/interview pass/status (`update_student_record`), record jobs (`issue_student_job`), add cashbook income/expense (`add_cashbook_entry`), update/add job prices & limits (`manage_job_price_or_limit`), add staff/companies/store/returns/docs (`add_operational_record`), update center profile (`update_center_profile`), trigger MEGA cloud sync (`sync_cloud_data`), navigate to any page (`navigate_to_page`), and open modals. You can invoke MULTIPLE tools in one turn if the user gives a multi-part command!',
      '5. FULL GENERAL ACCOUNTS ACCESS: You have complete read, write, edit, delete, opening balance, day lock/unlock, panel unlock, and passcode access to **GENERAL ACCOUNTS** (`generalAccounts`):\n   - Read any General Accounts balance (Opening Cash/Bank, New Cash In, New Bank/Bkash In, Total Cash, Total Bank, Total Expense, Cash Balance, Grand Total), monthly (1–31) totals, official profiles (সবুজ কাজী MD, সোহেল কাজী DIR, সেলিম মাহমুদ GM), or ledger rows directly from the Live Center Snapshot.\n   - Add new General Accounts income, expense, or bank deposit/withdrawal rows via `add_general_account_entry`. IMPORTANT: When the user provides a payment via Bank or Bkash with a leading minus sign (e.g., `-5000`), pass a negative `amount` (e.g. `-5000`) with `account: "Bank"` or `"Bkash"` so it deducts directly from the Bank balance without affecting Cash balance.\n   - Edit any existing row via `update_general_account_entry` (using `rowId` from the snapshot, `voucher`, or `matchDate` + `matchText`), or delete a specific row via `delete_general_account_entry` when explicitly instructed.\n   - Set opening balances (পূর্বের ব্যালেন্স), lock/unlock dates, unlock & open the GENERAL ACCOUNTS module (`navigate_to_page` with `page: "generalAccounts", unlockGeneralAccounts: true`, or `manage_general_accounts_opening_and_lock` with `action: "unlock_and_open"`), or update the General Accounts passcode when explicitly instructed.',
      '6. SAFETY RULES: Never delete students or protected default job categories 01–19. Never invent student names, Khata codes, General Accounts rows, or taka amounts — rely ONLY on the Live Center Snapshot provided below for read queries.',
      '7. CONVERSATION STYLE: Reply warmly, clearly, and concisely in the user’s language (Bengali if user writes in Bengali; English if in English). For greetings or general chat, do NOT dump student tables unless asked.',
      centerSummary ? `\nLive Center Snapshot:\n${centerSummary}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const extractReadableGeminiError = (err: unknown): { message: string; status: number } => {
      const raw = err instanceof Error ? err.message : 'Failed to generate AI response.';
      let message = raw;
      try {
        const parsed = JSON.parse(raw) as { error?: { message?: string; code?: number; status?: string } };
        if (parsed?.error?.message) {
          message = parsed.error.message;
        }
      } catch {
        // Keep raw message if not JSON
      }
      const status = /API_KEY_INVALID|PERMISSION_DENIED|403|401/i.test(raw)
        ? 403
        : /RESOURCE_EXHAUSTED|429|quota/i.test(raw)
          ? 429
          : /UNAVAILABLE|503|high demand|overloaded|timed out/i.test(raw)
            ? 503
            : 502;

      if (status === 429) {
        message =
          lang === 'bn'
            ? 'দৈনিক ফ্রি AI কোটা শেষ হয়ে গেছে। আরও বেশি কোটার জন্য Settings > Secrets প্যানেল থেকে বিলিং-সক্রিয় API key ব্যবহার করুন অথবা কিছুক্ষণ পর আবার চেষ্টা করুন।'
            : 'Daily free-tier Gemini quota has been reached. To increase your quota, select a billing-enabled API key in Settings > Secrets or retry later.';
      } else if (status === 403) {
        message =
          lang === 'bn'
            ? 'Gemini API key অনুমোদিত নয়। অনুগ্রহ করে Settings > Secrets প্যানেলে আপনার API key যাচাই করুন।'
            : 'Gemini API key is not authorized. Please check or select your API key in the Settings > Secrets panel.';
      } else if (status === 503 && /timed out/i.test(raw)) {
        message =
          lang === 'bn'
            ? 'AI সার্ভার থেকে উত্তর আসতে দেরি হচ্ছে। অনুগ্রহ করে আবার চেষ্টা করুন।'
            : 'The AI service took too long to respond. Please try again.';
      }
      return { message, status };
    };

    const isQuotaError = (msg: string) => /RESOURCE_EXHAUSTED|429|quota exceeded/i.test(msg);

    const isTransientOrDemandError = (msg: string) =>
      /UNAVAILABLE|503|500|502|504|high demand|overloaded|DEADLINE_EXCEEDED|timed out|fetch failed|ECONNRESET|EAI_AGAIN|ETIMEDOUT|socket hang up/i.test(
        msg
      );

    const runWithTimeout = async <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
      let timer: NodeJS.Timeout | undefined;
      try {
        return await Promise.race([
          promise,
          new Promise<T>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    };

    try {
      const ai = getSharedAiClient(apiKey);

      const attemptGenerate = async (
        model: string,
        thinkingLevel: ThinkingLevel,
        timeoutMs: number,
        includeTools = true
      ) =>
        runWithTimeout(
          ai.models.generateContent({
            model,
            contents: cleanedContents,
            config: {
              systemInstruction,
              ...(includeTools ? { tools: [{ functionDeclarations: itttcToolDeclarations }] } : {}),
              thinkingConfig: { thinkingLevel },
            },
          }),
          timeoutMs,
          `Gemini (${model})`
        );

      let response;
      let lastErr: unknown = null;
      const now = Date.now();
      const candidates: Array<{
        model: string;
        thinkingLevel: ThinkingLevel;
        retries: number;
        timeoutMs: number;
        includeTools: boolean;
      }> = [];
      if (now >= flashLiteCooldownUntil) {
        candidates.push({
          model: 'gemini-3.1-flash-lite',
          thinkingLevel: ThinkingLevel.MINIMAL,
          retries: 1,
          timeoutMs: 18000,
          includeTools: true,
        });
      }
      if (now >= hydrogenCooldownUntil) {
        candidates.push({
          model: 'gemini-4-hydrogen',
          thinkingLevel: ThinkingLevel.LOW,
          retries: 1,
          timeoutMs: 25000,
          includeTools: true,
        });
      }
      if (candidates.length === 0) {
        candidates.push({
          model: 'gemini-3.1-flash-lite',
          thinkingLevel: ThinkingLevel.MINIMAL,
          retries: 1,
          timeoutMs: 18000,
          includeTools: true,
        });
      }

      outer: for (const step of candidates) {
        for (let attempt = 1; attempt <= step.retries; attempt++) {
          try {
            const candidateResp = await attemptGenerate(
              step.model,
              step.thinkingLevel,
              step.timeoutMs,
              step.includeTools
            );
            const hasContent =
              Boolean(candidateResp.text && candidateResp.text.trim()) ||
              Boolean(candidateResp.functionCalls && candidateResp.functionCalls.length > 0);
            if (!hasContent) {
              throw new Error(`Empty response from ${step.model}`);
            }
            response = candidateResp;
            lastErr = null;
            break outer;
          } catch (err) {
            lastErr = err;
            const rawMsg = err instanceof Error ? err.message : String(err);
            if (isQuotaError(rawMsg)) {
              const cooldownMs = 15 * 60 * 1000;
              if (step.model === 'gemini-4-hydrogen') {
                hydrogenCooldownUntil = Date.now() + cooldownMs;
              } else {
                flashLiteCooldownUntil = Date.now() + cooldownMs;
              }
              break;
            }
            if (/timed out/i.test(rawMsg)) {
              break;
            }
            if (!isTransientOrDemandError(rawMsg) && !/Empty response/i.test(rawMsg)) {
              break outer;
            }
            if (attempt < step.retries) {
              await new Promise((r) => setTimeout(r, 300 * attempt));
            }
          }
        }
      }

      if (!response) {
        throw lastErr || new Error('Gemini service did not return a response.');
      }

      const normalizeServerHex = (val: unknown): string | undefined => {
        if (typeof val !== 'string') return undefined;
        const m6 = val.match(/#?([0-9a-fA-F]{6})/);
        if (m6) return `#${m6[1].toLowerCase()}`;
        const m3 = val.match(/#?([0-9a-fA-F]{3})\b/);
        if (m3) {
          const [r, g, b] = m3[1].toLowerCase().split('');
          return `#${r}${r}${g}${g}${b}${b}`;
        }
        return undefined;
      };

      const functionCalls = response.functionCalls || [];
      const clientActions = functionCalls.map((fc) => {
        const rawArgs = (fc.args && typeof fc.args === 'object' ? { ...fc.args } : {}) as Record<
          string,
          unknown
        >;
        if (fc.name === 'update_color_and_theme') {
          for (const key of ['bgColor', 'cardColor', 'accentColor', 'textColor']) {
            const clean = normalizeServerHex(rawArgs[key]);
            if (clean) rawArgs[key] = clean;
          }
        }
        return {
          name: String(fc.name || ''),
          args: rawArgs,
        };
      });

      let reply = (response.text || '').trim();
      if (!reply && clientActions.length > 0) {
        const msgs = clientActions
          .map((a) => String(a.args?.replyMessage || '').trim())
          .filter(Boolean);
        const uniqueMsgs = Array.from(new Set(msgs));
        reply =
          uniqueMsgs.join('\n') ||
          (lang === 'bn'
            ? 'আদেশ অনুযায়ী কাজটি সম্পন্ন করা হয়েছে।'
            : 'Done — executed your command.');
      }

      if (!reply) {
        res.status(502).json({
          ok: false,
          error: 'Empty response received from Gemini model.',
        });
        return;
      }
      res.json({ ok: true, reply, clientActions });
    } catch (err) {
      const { message, status } = extractReadableGeminiError(err);
      console.error('[itttc-chat] Request failed:', err instanceof Error ? err.message : err);
      res.status(status).json({
        ok: false,
        error: message,
      });
    }
  });

  app.use('/api', (req, res) => {
    res.status(404).json({ ok: false, error: `API endpoint not found (${req.method} ${req.path}).` });
  });

  app.use(
    (
      err: unknown,
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      if (req.path.startsWith('/api')) {
        const message = err instanceof Error ? err.message : 'Unexpected server API error.';
        const status =
          typeof (err as { status?: unknown })?.status === 'number'
            ? (err as { status: number }).status
            : 500;
        res.status(status).json({ ok: false, error: message });
        return;
      }
      next(err);
    }
  );

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const hmrEnabled = process.env.DISABLE_HMR !== 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: { server: httpServer },
        hmr: hmrEnabled,
        watch: hmrEnabled ? {} : null,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`ITTC Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
