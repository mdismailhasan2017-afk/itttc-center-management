import * as XLSX from 'xlsx';
import type {
  AuditLog,
  CashEntry,
  JobEntry,
  JobPrice,
  JobVerificationMethod,
  Student,
  WorkspaceBackup,
} from '../types';
import type { MegaRecoveryJobCandidate, MegaRecoverySourceInfo } from './localBackupSync';
import type { LocalSnapshotRecord } from './store';

export interface RecoverableJobItem {
  key: string;
  date: string;
  no: string;
  sid: string;
  sname: string;
  cat: string;
  pay: number;
  discount: number;
  paid: number;
  verificationMethod: JobVerificationMethod;
  note: string;
  sourceLabel: string;
  sourceKind:
    | 'snapshot'
    | 'mega-history'
    | 'mega-trash'
    | 'mega-excel'
    | 'uploaded-file'
    | 'cashbook'
    | 'audit-log';
  priority: number;
}

export interface RecoverySourceSummary {
  label: string;
  kind: string;
  foundCount: number;
  missingCount: number;
  detail?: string;
}

function normalizeJobKey(no: string): string {
  return String(no || '').trim().toUpperCase();
}

function deriveDateFromJobNo(jobNo: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})-\d+$/.exec(String(jobNo || '').trim());
  if (!m) return '';
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function normalizeDateStr(raw: string, jobNo = ''): string {
  const s = String(raw || '').trim();
  if (/^\d{2}-\d{2}-\d{4}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-');
    return `${d}-${m}-${y}`;
  }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    return s.replace(/\//g, '-');
  }
  return deriveDateFromJobNo(jobNo) || s;
}

function parseIssueJobAuditDetail(
  detail: string
): {
  no: string;
  sname: string;
  sid: string;
  cat: string;
  verificationMethod: JobVerificationMethod;
  note: string;
} | null {
  const trimmed = String(detail || '').trim();
  // Format: "Issued 20261126-001 for RAHIM MIA (001) · 6G TIG · supervisor · [DUE ...]"
  const m = /^Issued\s+([^\s]+)\s+for\s+(.+?)\s+\(([^)]+)\)\s*·\s*([^·]+)(?:·\s*(.*))?$/i.exec(
    trimmed
  );
  if (!m) return null;
  const no = m[1].trim();
  const sname = m[2].trim();
  const sid = m[3].trim();
  const cat = m[4].trim();
  const rest = (m[5] || '').trim();
  let verificationMethod: JobVerificationMethod = 'supervisor';
  if (/\bbiometric\b/i.test(rest)) verificationMethod = 'biometric';

  return {
    no,
    sname,
    sid,
    cat,
    verificationMethod,
    note: '',
  };
}

function parseCashJobNote(
  note: string
): {
  no: string;
  sname: string;
  cat: string;
} | null {
  const trimmed = String(note || '').trim();
  // Format: "Job 20261126-001 · RAHIM MIA (6G TIG)"
  const m = /^Job\s+([^\s·]+)\s*·\s*(.+?)\s+\(([^)]+)\)$/i.exec(trimmed);
  if (!m) return null;
  return {
    no: m[1].trim(),
    sname: m[2].trim(),
    cat: m[3].trim(),
  };
}

export function extractJobsFromUploadedBytes(
  fileName: string,
  bytes: Uint8Array
): {
  sourceLabel: string;
  jobs: MegaRecoveryJobCandidate[];
} {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.json')) {
    const text = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(text) as Partial<WorkspaceBackup> & { jobs?: unknown[] };
    const arr = Array.isArray(parsed.jobs) ? parsed.jobs : [];
    const label = `Uploaded JSON: ${fileName}`;
    return {
      sourceLabel: label,
      jobs: arr.map((raw) => {
        const j = (raw || {}) as Record<string, unknown>;
        return {
          date: String(j.date || ''),
          no: String(j.no || ''),
          sname: String(j.sname || 'Student'),
          sid: String(j.sid || '001'),
          cat: String(j.cat || '6G TIG'),
          pay: Math.max(0, Number(j.pay || 0) || 0),
          discount: Math.max(0, Number(j.discount || 0) || 0),
          paid: Math.max(0, Number(j.paid ?? j.pay ?? 0) || 0),
          note: String(j.note || ''),
          sourceLabel: label,
        };
      }),
    };
  }

  // Excel (.xlsx / .xls / .csv)
  const wb = XLSX.read(bytes, { type: 'array' });
  const firstSheet = wb.SheetNames[0];
  const ws = firstSheet ? wb.Sheets[firstSheet] : undefined;
  const label = `Uploaded Excel: ${fileName}`;
  if (!ws) return { sourceLabel: label, jobs: [] };

  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as Array<
    Array<string | number>
  >;
  const out: MegaRecoveryJobCandidate[] = [];
  for (let i = 1; i < aoa.length; i += 1) {
    const row = aoa[i];
    if (!row || row.every((c) => String(c ?? '').trim() === '')) continue;
    const jobNo = String(row[2] ?? '').trim();
    if (!jobNo || jobNo.toUpperCase() === 'TOTAL') continue;
    const dateVal = String(row[1] ?? '').trim();
    const sname = String(row[3] ?? '').trim();
    const sid = String(row[4] ?? '').trim();
    const cat = String(row[5] ?? '').trim();
    const disc = Math.max(0, Number(row[7] ?? 0) || 0);
    const pay = Math.max(0, Number(row[8] ?? 0) || 0);
    const note = String(row[9] ?? '').trim();
    if (!sname && !sid && !cat) continue;
    out.push({
      date: normalizeDateStr(dateVal, jobNo),
      no: jobNo,
      sname: sname || 'Student',
      sid: sid || '001',
      cat: cat || '6G TIG',
      pay,
      discount: disc,
      paid: pay,
      note,
      sourceLabel: label,
    });
  }
  return { sourceLabel: label, jobs: out };
}

export function buildRecoverableJobsReport(params: {
  existingJobs: JobEntry[];
  students: Student[];
  prices: JobPrice[];
  cash: CashEntry[];
  auditLogs: AuditLog[];
  localSnapshots: LocalSnapshotRecord[];
  megaSources?: MegaRecoverySourceInfo[];
  megaCandidates?: MegaRecoveryJobCandidate[];
  uploadedCandidates?: MegaRecoveryJobCandidate[];
}): {
  missingJobs: RecoverableJobItem[];
  sources: RecoverySourceSummary[];
  auditJobCount: number;
  cashJobCount: number;
} {
  const {
    existingJobs,
    students,
    prices,
    cash,
    auditLogs,
    localSnapshots,
    megaSources = [],
    megaCandidates = [],
    uploadedCandidates = [],
  } = params;

  const existingKeys = new Set<string>();
  for (const j of existingJobs) {
    const noKey = normalizeJobKey(j.no);
    if (noKey) existingKeys.add(noKey);
  }

  const priceByCat = new Map<string, number>();
  for (const p of prices) {
    const key = String(p.cat || '').trim().toLowerCase();
    if (key) priceByCat.set(key, Math.max(0, Number(p.price) || 0));
  }

  const studentByName = new Map<string, Student>();
  for (const s of students) {
    const key = String(s.name || '').trim().toLowerCase();
    if (key && !studentByName.has(key)) studentByName.set(key, s);
  }

  const cashByJobNo = new Map<string, CashEntry>();
  const cashCandidates: RecoverableJobItem[] = [];
  for (const c of cash) {
    if (c.type !== 'in') continue;
    const parsed = parseCashJobNote(c.note);
    if (!parsed) continue;
    const noKey = normalizeJobKey(parsed.no);
    if (!noKey) continue;
    cashByJobNo.set(noKey, c);
    const matchedStu = studentByName.get(parsed.sname.toLowerCase());
    cashCandidates.push({
      key: noKey,
      date: normalizeDateStr(c.date, parsed.no),
      no: parsed.no,
      sid: matchedStu?.code || '001',
      sname: parsed.sname,
      cat: parsed.cat,
      pay: Math.max(0, Number(c.amt) || 0),
      discount: 0,
      paid: Math.max(0, Number(c.amt) || 0),
      verificationMethod: 'supervisor',
      note: 'Recovered from Cashbook',
      sourceLabel: 'Cashbook (Job Fee)',
      sourceKind: 'cashbook',
      priority: 20,
    });
  }

  const auditCandidates: RecoverableJobItem[] = [];
  for (const log of auditLogs) {
    if (log.action !== 'ISSUE_JOB') continue;
    const parsed = parseIssueJobAuditDetail(log.detail);
    if (!parsed) continue;
    const noKey = normalizeJobKey(parsed.no);
    if (!noKey) continue;
    const matchedCash = cashByJobNo.get(noKey);
    const stdPrice = priceByCat.get(parsed.cat.toLowerCase()) ?? 0;
    const fee = matchedCash ? Math.max(0, Number(matchedCash.amt) || 0) : stdPrice;
    auditCandidates.push({
      key: noKey,
      date: normalizeDateStr(log.date, parsed.no),
      no: parsed.no,
      sid: parsed.sid,
      sname: parsed.sname,
      cat: parsed.cat,
      pay: fee,
      discount: 0,
      paid: fee,
      verificationMethod: parsed.verificationMethod,
      note: 'Recovered from Audit Log',
      sourceLabel: 'System Audit Log (ISSUE_JOB)',
      sourceKind: 'audit-log',
      priority: 10,
    });
  }

  const bestByKey = new Map<string, RecoverableJobItem>();
  const registerCandidate = (item: RecoverableJobItem) => {
    const key = normalizeJobKey(item.no);
    if (!key || existingKeys.has(key)) return;
    const prev = bestByKey.get(key);
    if (!prev || item.priority > prev.priority || (item.priority === prev.priority && item.pay > prev.pay)) {
      bestByKey.set(key, {
        ...item,
        key,
        date: normalizeDateStr(item.date, item.no) || prev?.date || '',
        sid: item.sid || prev?.sid || '001',
        pay: item.pay > 0 ? item.pay : prev?.pay || 0,
        paid: item.paid > 0 ? item.paid : prev?.paid || item.pay || 0,
      });
    }
  };

  const sources: RecoverySourceSummary[] = [];

  // 1. Audit Logs
  const missingFromAudit = auditCandidates.filter((c) => !existingKeys.has(c.key)).length;
  sources.push({
    label: 'System Audit Log (ISSUE_JOB)',
    kind: 'audit-log',
    foundCount: auditCandidates.length,
    missingCount: missingFromAudit,
  });
  auditCandidates.forEach(registerCandidate);

  // 2. Cashbook
  const missingFromCash = cashCandidates.filter((c) => !existingKeys.has(c.key)).length;
  sources.push({
    label: 'Cashbook Register (Job Fee)',
    kind: 'cashbook',
    foundCount: cashCandidates.length,
    missingCount: missingFromCash,
  });
  cashCandidates.forEach(registerCandidate);

  // 3. Local IndexedDB Snapshots
  for (const snap of localSnapshots) {
    const snapJobs = Array.isArray(snap.data?.jobs) ? snap.data.jobs : [];
    const label = `Local Snapshot (${new Date(snap.savedAt).toLocaleString()} · ${snapJobs.length} jobs)`;
    let missingCount = 0;
    for (const j of snapJobs) {
      const noKey = normalizeJobKey(j.no);
      if (!noKey) continue;
      if (!existingKeys.has(noKey)) missingCount += 1;
      registerCandidate({
        key: noKey,
        date: normalizeDateStr(j.date, j.no),
        no: String(j.no || '').trim(),
        sid: String(j.sid || '001').trim(),
        sname: String(j.sname || 'Student').trim(),
        cat: String(j.cat || '6G TIG').trim(),
        pay: Math.max(0, Number(j.pay) || 0),
        discount: Math.max(0, Number(j.discount) || 0),
        paid: Math.max(0, Number(j.paid ?? j.pay ?? 0) || 0),
        verificationMethod: j.verificationMethod || 'supervisor',
        note: String(j.note || ''),
        sourceLabel: label,
        sourceKind: 'snapshot',
        priority: 90,
      });
    }
    sources.push({
      label,
      kind: 'snapshot',
      foundCount: snapJobs.length,
      missingCount,
    });
  }

  // 4. MEGA Cloud & Trash
  const megaMissingByLabel = new Map<string, number>();
  for (const c of megaCandidates) {
    const noKey = normalizeJobKey(c.no);
    if (!noKey) continue;
    const isMissing = !existingKeys.has(noKey);
    if (isMissing) {
      megaMissingByLabel.set(c.sourceLabel, (megaMissingByLabel.get(c.sourceLabel) || 0) + 1);
    }
    const lowerLabel = c.sourceLabel.toLowerCase();
    const isJson = lowerLabel.includes('history') || lowerLabel.includes('json');
    const isTrash = lowerLabel.includes('trash');
    registerCandidate({
      key: noKey,
      date: normalizeDateStr(c.date, c.no),
      no: String(c.no || '').trim(),
      sid: String(c.sid || '001').trim(),
      sname: String(c.sname || 'Student').trim(),
      cat: String(c.cat || '6G TIG').trim(),
      pay: Math.max(0, Number(c.pay) || 0),
      discount: Math.max(0, Number(c.discount) || 0),
      paid: Math.max(0, Number(c.paid ?? c.pay ?? 0) || 0),
      verificationMethod: 'supervisor',
      note: String(c.note || ''),
      sourceLabel: c.sourceLabel,
      sourceKind: isTrash ? 'mega-trash' : isJson ? 'mega-history' : 'mega-excel',
      priority: isJson ? 85 : isTrash ? 75 : 65,
    });
  }
  for (const ms of megaSources) {
    sources.push({
      label: ms.label,
      kind: ms.kind,
      foundCount: ms.jobsCount,
      missingCount: megaMissingByLabel.get(ms.label) || 0,
      detail: ms.modifiedAt ? new Date(ms.modifiedAt).toLocaleString() : undefined,
    });
  }

  // 5. Uploaded PC Files
  const uploadCounts = new Map<string, { found: number; missing: number }>();
  for (const u of uploadedCandidates) {
    const noKey = normalizeJobKey(u.no);
    if (!noKey) continue;
    const prev = uploadCounts.get(u.sourceLabel) || { found: 0, missing: 0 };
    prev.found += 1;
    if (!existingKeys.has(noKey)) prev.missing += 1;
    uploadCounts.set(u.sourceLabel, prev);
    registerCandidate({
      key: noKey,
      date: normalizeDateStr(u.date, u.no),
      no: String(u.no || '').trim(),
      sid: String(u.sid || '001').trim(),
      sname: String(u.sname || 'Student').trim(),
      cat: String(u.cat || '6G TIG').trim(),
      pay: Math.max(0, Number(u.pay) || 0),
      discount: Math.max(0, Number(u.discount) || 0),
      paid: Math.max(0, Number(u.paid ?? u.pay ?? 0) || 0),
      verificationMethod: 'supervisor',
      note: String(u.note || ''),
      sourceLabel: u.sourceLabel,
      sourceKind: 'uploaded-file',
      priority: 100,
    });
  }
  for (const [label, counts] of uploadCounts.entries()) {
    sources.push({
      label,
      kind: 'uploaded-file',
      foundCount: counts.found,
      missingCount: counts.missing,
    });
  }

  const missingJobs = Array.from(bestByKey.values()).sort((a, b) => b.no.localeCompare(a.no));

  return {
    missingJobs,
    sources,
    auditJobCount: auditCandidates.length,
    cashJobCount: cashCandidates.length,
  };
}
