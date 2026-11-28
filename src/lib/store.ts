import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  buildDemoSeed,
  DEFAULT_CENTER_NAME,
  DEFAULT_CENTER_SUBTITLE,
  DEFAULT_NAV_ORDER,
  DEFAULT_PRICE_CATEGORIES,
} from '../constants';
import {
  auth,
  db,
  handleFirestoreError,
  OperationType,
  signInWithGoogle,
  signOutUser,
  testFirestoreConnection,
} from './firebase';
import { createDocId, formatLiveClock, sanitizeId, todayDDMMYYYY, todayYYYYMMDD } from './format';
import { ensureDefaultJobPrices, isProtectedDefaultPrice, sortJobPrices } from './jobLimits';
import type {
  AgencyContract,
  AuditLog,
  CashEntry,
  CenterSettings,
  DocItem,
  GeneralAccountRow,
  JobEntry,
  JobPrice,
  JobReturn,
  NavKey,
  OutStudentJob,
  OverseasCompany,
  StaffMember,
  StaffPayment,
  StoreItem,
  StoreLog,
  Student,
  WorkspaceBackup,
} from '../types';

export type SubCollectionKey =
  | 'students'
  | 'jobs'
  | 'outs'
  | 'staff'
  | 'staffPayments'
  | 'companies'
  | 'agencyContracts'
  | 'store'
  | 'storeLogs'
  | 'prices'
  | 'returns'
  | 'cash'
  | 'generalAccounts'
  | 'docs'
  | 'auditLogs';

export interface CenterDataState {
  settings: CenterSettings;
  students: Student[];
  jobs: JobEntry[];
  outs: OutStudentJob[];
  staff: StaffMember[];
  staffPayments: StaffPayment[];
  companies: OverseasCompany[];
  agencyContracts: AgencyContract[];
  store: StoreItem[];
  storeLogs: StoreLog[];
  prices: JobPrice[];
  returns: JobReturn[];
  cash: CashEntry[];
  generalAccounts: GeneralAccountRow[];
  docs: DocItem[];
  auditLogs: AuditLog[];
}

const LOCAL_STORAGE_KEY = 'ittc.v2';
const LOCAL_MODE_FLAG = 'ittc.localMode';
const LAST_LOCAL_MUTATION_KEY = 'ittc.lastLocalMutationAt';
const IDB_STATE_DB = 'ittc.workspace.v2';
const IDB_STATE_DB_VERSION = 2;
const IDB_STATE_STORE = 'state';
const IDB_SNAPSHOTS_STORE = 'snapshots';
const IDB_STATE_KEY = 'centerData';

export interface LocalSnapshotRecord {
  id: string;
  savedAt: number;
  reason: string;
  jobsCount: number;
  studentsCount: number;
  cashCount: number;
  gaCount: number;
  totalCount: number;
  data: CenterDataState;
}

interface PersistedCenterState extends CenterDataState {
  _savedAt?: number;
  _userMutatedAt?: number;
  _blobsInIdb?: boolean;
  _overflowToIdb?: boolean;
}

function getStoredLocalMutationTs(): number {
  try {
    const num = Number(localStorage.getItem(LAST_LOCAL_MUTATION_KEY) || 0);
    return Number.isFinite(num) && num > 0 ? num : 0;
  } catch {
    return 0;
  }
}

function recordLocalMutationTimestamp(ts = Date.now()): number {
  try {
    if (ts > 0) {
      localStorage.setItem(LAST_LOCAL_MUTATION_KEY, String(ts));
    } else {
      localStorage.removeItem(LAST_LOCAL_MUTATION_KEY);
    }
  } catch {
    // ignore storage errors
  }
  return ts;
}

function mergeNavOrderWithDefaults(savedOrder?: unknown): NavKey[] {
  const validSet = new Set<NavKey>(DEFAULT_NAV_ORDER);
  const incoming = Array.isArray(savedOrder)
    ? (savedOrder as NavKey[]).filter((k) => validSet.has(k))
    : [];
  if (incoming.length === 0) return [...DEFAULT_NAV_ORDER];

  const merged = [...incoming];
  DEFAULT_NAV_ORDER.forEach((defKey, idx) => {
    if (merged.includes(defKey)) return;
    // Insert right after the previous default key if present so 'inactive' stays near 'due' and 'monthly' near 'reports'
    const prevKey = idx > 0 ? DEFAULT_NAV_ORDER[idx - 1] : null;
    const prevIdx = prevKey ? merged.indexOf(prevKey) : -1;
    if (prevIdx !== -1) {
      merged.splice(prevIdx + 1, 0, defKey);
    } else {
      merged.push(defKey);
    }
  });
  return merged.slice(0, 30);
}

function openWorkspaceIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_STATE_DB, IDB_STATE_DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STATE_STORE)) {
        req.result.createObjectStore(IDB_STATE_STORE);
      }
      if (!req.result.objectStoreNames.contains(IDB_SNAPSHOTS_STORE)) {
        req.result.createObjectStore(IDB_SNAPSHOTS_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let idbWriteQueue: Promise<void> = Promise.resolve();

function writeStateToIdb(payload: PersistedCenterState): Promise<void> {
  if (typeof indexedDB === 'undefined') return Promise.resolve();
  idbWriteQueue = idbWriteQueue
    .catch(() => undefined)
    .then(async () => {
      try {
        const idb = await openWorkspaceIdb();
        await new Promise<void>((resolve, reject) => {
          const tx = idb.transaction(IDB_STATE_STORE, 'readwrite');
          tx.objectStore(IDB_STATE_STORE).put(payload, IDB_STATE_KEY);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        idb.close();
      } catch {
        // ignore IndexedDB errors
      }
    });
  return idbWriteQueue;
}

async function readStateFromIdb(): Promise<PersistedCenterState | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const idb = await openWorkspaceIdb();
    const res = await new Promise<PersistedCenterState | null>((resolve, reject) => {
      const tx = idb.transaction(IDB_STATE_STORE, 'readonly');
      const req = tx.objectStore(IDB_STATE_STORE).get(IDB_STATE_KEY);
      req.onsuccess = () => resolve((req.result as PersistedCenterState) || null);
      req.onerror = () => reject(req.error);
    });
    idb.close();
    return res;
  } catch {
    return null;
  }
}

export async function readLocalSnapshotsFromIdb(): Promise<LocalSnapshotRecord[]> {
  if (typeof indexedDB === 'undefined') return [];
  try {
    const idb = await openWorkspaceIdb();
    if (!idb.objectStoreNames.contains(IDB_SNAPSHOTS_STORE)) {
      idb.close();
      return [];
    }
    const res = await new Promise<LocalSnapshotRecord[]>((resolve, reject) => {
      const tx = idb.transaction(IDB_SNAPSHOTS_STORE, 'readonly');
      const req = tx.objectStore(IDB_SNAPSHOTS_STORE).getAll();
      req.onsuccess = () => {
        const list = Array.isArray(req.result) ? (req.result as LocalSnapshotRecord[]) : [];
        resolve(list.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0)));
      };
      req.onerror = () => reject(req.error);
    });
    idb.close();
    return res;
  } catch {
    return [];
  }
}

async function saveRollingSnapshotToIdb(
  state: CenterDataState,
  reason: string
): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const totalCount = countStateRecords(state);
  if (totalCount === 0) return;
  try {
    const idb = await openWorkspaceIdb();
    if (!idb.objectStoreNames.contains(IDB_SNAPSHOTS_STORE)) {
      idb.close();
      return;
    }
    const existing = await new Promise<LocalSnapshotRecord[]>((resolve, reject) => {
      const tx = idb.transaction(IDB_SNAPSHOTS_STORE, 'readonly');
      const req = tx.objectStore(IDB_SNAPSHOTS_STORE).getAll();
      req.onsuccess = () =>
        resolve(
          (Array.isArray(req.result) ? (req.result as LocalSnapshotRecord[]) : []).sort(
            (a, b) => (b.savedAt || 0) - (a.savedAt || 0)
          )
        );
      req.onerror = () => reject(req.error);
    });
    const newest = existing[0];
    const isCritical = reason.startsWith('pre-');
    if (
      !isCritical &&
      newest &&
      Date.now() - newest.savedAt < 30000 &&
      newest.jobsCount === state.jobs.length &&
      newest.totalCount === totalCount
    ) {
      idb.close();
      return;
    }

    const record: LocalSnapshotRecord = {
      id: `snap_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      savedAt: Date.now(),
      reason,
      jobsCount: state.jobs.length,
      studentsCount: state.students.length,
      cashCount: state.cash.length,
      gaCount: state.generalAccounts.length,
      totalCount,
      data: state,
    };

    const toDelete = existing.slice(19).map((s) => s.id);
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(IDB_SNAPSHOTS_STORE, 'readwrite');
      const store = tx.objectStore(IDB_SNAPSHOTS_STORE);
      store.put(record);
      for (const oldId of toDelete) {
        store.delete(oldId);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    idb.close();
  } catch {
    // ignore snapshot write errors
  }
}

const utf8Encoder = new TextEncoder();

function clampStr(v: unknown, maxBytes: number, fallback = ''): string {
  const s = String(v ?? fallback).trim();
  if (utf8Encoder.encode(s).length <= maxBytes) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (utf8Encoder.encode(s.slice(0, mid)).length <= maxBytes) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  let cut = lo;
  if (cut > 0) {
    const code = s.charCodeAt(cut - 1);
    if (code >= 0xd800 && code <= 0xdbff) {
      cut -= 1;
    }
  }
  return s.slice(0, cut).trim();
}

function nonNeg(v: unknown, fallback = 0): number {
  const n = Number(v ?? fallback);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, 1000000000);
}

function makeDefaultSettings(ownerId: string): CenterSettings {
  return {
    id: ownerId === 'local' ? 'center_local' : `center_${sanitizeId(ownerId)}`,
    ownerId,
    name: DEFAULT_CENTER_NAME,
    subtitle: DEFAULT_CENTER_SUBTITLE,
    address: 'Dhaka, Bangladesh',
    phone: '+880 1700-000000',
    slipFooter: 'Thank you for testing with ITTC Center',
    accountsPass: 'admin',
    generalAccountsPass: '1234',
    adminUser: 'superadmin',
    adminPass: 'admin',
    navOrder: [...DEFAULT_NAV_ORDER],
  };
}

function makeInitialLocalState(): CenterDataState {
  return {
    settings: makeDefaultSettings('local'),
    students: [],
    jobs: [],
    outs: [],
    staff: [],
    staffPayments: [],
    companies: [],
    agencyContracts: [],
    store: [],
    storeLogs: [],
    prices: DEFAULT_PRICE_CATEGORIES.map((p, idx) => ({
      id: `price_${idx + 1}`,
      ownerId: 'local',
      cat: p.cat,
      price: p.price,
      limit: p.limit,
      active: true,
    })),
    returns: [],
    cash: [],
    generalAccounts: [],
    docs: [],
    auditLogs: [],
  };
}

function hydrateCenterState(parsed: Partial<PersistedCenterState>): CenterDataState {
  const base = makeInitialLocalState();
  const parsedPrices =
    Array.isArray(parsed.prices) && parsed.prices.length > 0 ? parsed.prices : base.prices;
  const ownerId = parsed.settings?.ownerId || 'local';
  return {
    settings: {
      ...base.settings,
      ...(parsed.settings || {}),
      navOrder: mergeNavOrderWithDefaults(parsed.settings?.navOrder),
    },
    students: Array.isArray(parsed.students) ? parsed.students : [],
    jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
    outs: Array.isArray(parsed.outs) ? parsed.outs : [],
    staff: Array.isArray(parsed.staff) ? parsed.staff : [],
    staffPayments: Array.isArray(parsed.staffPayments) ? parsed.staffPayments : [],
    companies: Array.isArray(parsed.companies) ? parsed.companies : [],
    agencyContracts: Array.isArray(parsed.agencyContracts) ? parsed.agencyContracts : [],
    store: Array.isArray(parsed.store) ? parsed.store : [],
    storeLogs: Array.isArray(parsed.storeLogs) ? parsed.storeLogs : [],
    prices: ensureDefaultJobPrices(parsedPrices, DEFAULT_PRICE_CATEGORIES, ownerId),
    returns: Array.isArray(parsed.returns) ? parsed.returns : [],
    cash: Array.isArray(parsed.cash) ? parsed.cash : [],
    generalAccounts: Array.isArray(parsed.generalAccounts) ? parsed.generalAccounts : [],
    docs: Array.isArray(parsed.docs) ? parsed.docs : [],
    auditLogs: Array.isArray(parsed.auditLogs) ? parsed.auditLogs : [],
  };
}

function readLocalSnapshotMeta(): {
  state: CenterDataState;
  savedAt: number;
  userMutatedAt: number;
  blobsInIdb: boolean;
  overflowToIdb: boolean;
} {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) {
      return {
        state: makeInitialLocalState(),
        savedAt: 0,
        userMutatedAt: 0,
        blobsInIdb: false,
        overflowToIdb: false,
      };
    }
    const parsed = JSON.parse(raw) as Partial<PersistedCenterState>;
    return {
      state: hydrateCenterState(parsed),
      savedAt: typeof parsed._savedAt === 'number' ? parsed._savedAt : 0,
      userMutatedAt: typeof parsed._userMutatedAt === 'number' ? parsed._userMutatedAt : 0,
      blobsInIdb: Boolean(parsed._blobsInIdb),
      overflowToIdb: Boolean(parsed._overflowToIdb),
    };
  } catch {
    return {
      state: makeInitialLocalState(),
      savedAt: 0,
      userMutatedAt: 0,
      blobsInIdb: false,
      overflowToIdb: false,
    };
  }
}

function loadLocalState(): CenterDataState {
  return readLocalSnapshotMeta().state;
}

function countStateRecords(s: Partial<CenterDataState>): number {
  return (
    (Array.isArray(s.students) ? s.students.length : 0) +
    (Array.isArray(s.jobs) ? s.jobs.length : 0) +
    (Array.isArray(s.outs) ? s.outs.length : 0) +
    (Array.isArray(s.staff) ? s.staff.length : 0) +
    (Array.isArray(s.staffPayments) ? s.staffPayments.length : 0) +
    (Array.isArray(s.companies) ? s.companies.length : 0) +
    (Array.isArray(s.agencyContracts) ? s.agencyContracts.length : 0) +
    (Array.isArray(s.store) ? s.store.length : 0) +
    (Array.isArray(s.storeLogs) ? s.storeLogs.length : 0) +
    (Array.isArray(s.returns) ? s.returns.length : 0) +
    (Array.isArray(s.cash) ? s.cash.length : 0) +
    (Array.isArray(s.generalAccounts) ? s.generalAccounts.length : 0) +
    (Array.isArray(s.docs) ? s.docs.length : 0) +
    (Array.isArray(s.auditLogs) ? s.auditLogs.length : 0)
  );
}

function saveLocalState(state: CenterDataState, userMutatedAt = 0) {
  const savedAt = Date.now();
  const fullPayload: PersistedCenterState = {
    ...state,
    _savedAt: savedAt,
    _userMutatedAt: userMutatedAt,
  };
  void writeStateToIdb(fullPayload);
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(fullPayload));
  } catch {
    // If photos/passport scans push past localStorage's ~5MB cap, keep a compact fast-boot mirror in localStorage
    // while IndexedDB holds 100% of all records & blobs.
    try {
      const compactPayload: PersistedCenterState = {
        ...state,
        students: state.students.map((s) => ({
          ...s,
          photoData: '',
          passportCopyData: '',
        })),
        _savedAt: savedAt,
        _userMutatedAt: userMutatedAt,
        _blobsInIdb: true,
      };
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(compactPayload));
    } catch {
      // Even when tens of thousands of text records exceed localStorage's 5MB cap,
      // save a tiny overflow pointer so IndexedDB (unlimited capacity) always wins on next boot.
      try {
        localStorage.setItem(
          LOCAL_STORAGE_KEY,
          JSON.stringify({
            settings: state.settings,
            _savedAt: savedAt,
            _userMutatedAt: userMutatedAt,
            _blobsInIdb: true,
            _overflowToIdb: true,
          })
        );
      } catch {
        // IndexedDB still persists full lossless state even if localStorage is completely full.
      }
    }
  }
}

function normalizeRecordPayload<K extends SubCollectionKey>(
  key: K,
  raw: Record<string, unknown>,
  ownerId: string
): Record<string, unknown> {
  const today = todayDDMMYYYY();
  switch (key) {
    case 'students':
      return {
        ownerId,
        date: clampStr(raw.date, 60, today) || today,
        name: clampStr(raw.name, 420, 'Trainee') || 'Trainee',
        code: clampStr(raw.code, 80, '001') || '001',
        fatherName: clampStr(raw.fatherName, 360, ''),
        motherName: clampStr(raw.motherName, 360, ''),
        phone: clampStr(raw.phone, 60, ''),
        guardianPhone: clampStr(raw.guardianPhone, 60, ''),
        district: clampStr(raw.district, 480, ''),
        nid: clampStr(raw.nid, 60, ''),
        trade: clampStr(raw.trade, 200, ''),
        passportSubmitted:
          typeof raw.passportSubmitted === 'boolean'
            ? raw.passportSubmitted
            : Boolean(clampStr(raw.passportNo, 60, '')),
        passportNo: clampStr(raw.passportNo, 60, ''),
        passportCopyData:
          typeof raw.passportCopyData === 'string' &&
          utf8Encoder.encode(raw.passportCopyData).length <= 150000
            ? raw.passportCopyData
            : '',
        photoData:
          typeof raw.photoData === 'string' && utf8Encoder.encode(raw.photoData).length <= 150000
            ? raw.photoData
            : '',
        bioEnrolled: typeof raw.bioEnrolled === 'boolean' ? raw.bioEnrolled : false,
        companyName: clampStr(raw.companyName, 360, ''),
        interviewPassedCompany: clampStr(raw.interviewPassedCompany, 420, ''),
        interviewDate: clampStr(raw.interviewDate, 60, ''),
        overseasStatus: [
          'Not Applied',
          'Interview Attended',
          'Selected',
          'Visa Processing',
          'Flight Ready',
        ].includes(String(raw.overseasStatus))
          ? String(raw.overseasStatus)
          : 'Not Applied',
        destination: clampStr(raw.destination, 200, ''),
        contract: nonNeg(raw.contract),
        deposit: nonNeg(raw.deposit),
        note: clampStr(raw.note, 900, ''),
      };
    case 'jobs':
      return {
        ownerId,
        date: clampStr(raw.date, 60, today) || today,
        no: clampStr(raw.no, 80, `${todayYYYYMMDD()}-001`) || `${todayYYYYMMDD()}-001`,
        sid: clampStr(raw.sid, 80, '001') || '001',
        sname: clampStr(raw.sname, 420, 'Student') || 'Student',
        cat: clampStr(raw.cat, 200, '6G TIG') || '6G TIG',
        pay: nonNeg(raw.pay),
        discount: nonNeg(raw.discount),
        paid: nonNeg(raw.paid),
        verificationMethod: raw.verificationMethod === 'supervisor' ? 'supervisor' : 'biometric',
        note: clampStr(raw.note, 750, ''),
      };
    case 'outs':
      return {
        ownerId,
        date: clampStr(raw.date, 60, today) || today,
        no: clampStr(raw.no, 80, `O-${todayYYYYMMDD()}-001`) || `O-${todayYYYYMMDD()}-001`,
        name: clampStr(raw.name, 420, 'Candidate') || 'Candidate',
        phone: clampStr(raw.phone, 60, ''),
        agent: clampStr(raw.agent, 360, ''),
        cat: clampStr(raw.cat, 200, '6G ARC') || '6G ARC',
        price: nonNeg(raw.price ?? raw.paid),
        paid: nonNeg(raw.paid),
        paidTo: clampStr(raw.paidTo, 200, 'Cashier'),
        payRef: clampStr(raw.payRef, 200, ''),
        note: clampStr(raw.note, 750, ''),
      };
    case 'staff':
      return {
        ownerId,
        date: clampStr(raw.date, 20, today) || today,
        name: clampStr(raw.name, 140, 'Staff') || 'Staff',
        role: clampStr(raw.role, 80, 'Instructor') || 'Instructor',
        phone: clampStr(raw.phone, 40, ''),
        email: clampStr(raw.email, 140, ''),
        nid: clampStr(raw.nid, 40, ''),
        address: clampStr(raw.address, 200, ''),
        joinDate: clampStr(raw.joinDate, 20, today),
        bio: clampStr(raw.bio, 250, ''),
        salary: nonNeg(raw.salary),
        paid: nonNeg(raw.paid),
        month: clampStr(raw.month, 30, 'November 2026'),
      };
    case 'staffPayments':
      return {
        ownerId,
        date: clampStr(raw.date, 20, today) || today,
        staffId: clampStr(raw.staffId, 128, 'staff_1') || 'staff_1',
        staffName: clampStr(raw.staffName, 140, 'Staff') || 'Staff',
        month: clampStr(raw.month, 30, 'November 2026') || 'November 2026',
        amount: nonNeg(raw.amount),
        method: clampStr(raw.method, 40, 'Cash'),
        note: clampStr(raw.note, 200, ''),
      };
    case 'companies':
      return {
        ownerId,
        date: clampStr(raw.date, 20, today) || today,
        name: clampStr(raw.name, 140, 'Company') || 'Company',
        country: clampStr(raw.country, 80, 'Overseas') || 'Overseas',
        contact: clampStr(raw.contact, 120, ''),
        phone: clampStr(raw.phone, 40, ''),
        address: clampStr(raw.address, 200, ''),
        demand: clampStr(raw.demand, 160, ''),
        contractsCount: nonNeg(raw.contractsCount),
        workersCount: nonNeg(raw.workersCount),
        note: clampStr(raw.note, 300, ''),
      };
    case 'agencyContracts':
      return {
        ownerId,
        date: clampStr(raw.date, 20, today) || today,
        companyName: clampStr(raw.companyName, 140, 'Company') || 'Company',
        country: clampStr(raw.country, 80, 'Saudi Arabia') || 'Saudi Arabia',
        trade: clampStr(raw.trade, 120, 'Welder') || 'Welder',
        workersCount: nonNeg(raw.workersCount),
        status: ['Active', 'Completed', 'Pending'].includes(String(raw.status))
          ? String(raw.status)
          : 'Active',
        note: clampStr(raw.note, 250, ''),
      };
    case 'store':
      return {
        ownerId,
        date: clampStr(raw.date, 20, today) || today,
        code: clampStr(raw.code, 40, ''),
        item: clampStr(raw.item, 140, 'Item') || 'Item',
        category: clampStr(raw.category, 80, ''),
        shop: clampStr(raw.shop, 120, ''),
        memo: clampStr(raw.memo, 80, ''),
        qty: nonNeg(raw.qty),
        unit: clampStr(raw.unit, 30, 'pcs') || 'pcs',
        min: nonNeg(raw.min),
      };
    case 'storeLogs':
      return {
        ownerId,
        date: clampStr(raw.date, 20, today) || today,
        itemId: clampStr(raw.itemId, 128, 'item_1') || 'item_1',
        code: clampStr(raw.code, 40, ''),
        itemName: clampStr(raw.itemName, 140, 'Item') || 'Item',
        movement: raw.movement === 'OUT' ? 'OUT' : 'IN',
        qty: nonNeg(raw.qty),
        shop: clampStr(raw.shop, 120, ''),
        memo: clampStr(raw.memo, 80, ''),
        amount: nonNeg(raw.amount),
        remarks: clampStr(raw.remarks, 250, ''),
      };
    case 'prices':
      return {
        ownerId,
        cat: clampStr(raw.cat, 80, 'Category') || 'Category',
        price: nonNeg(raw.price),
        limit: nonNeg(raw.limit, 20),
        active: typeof raw.active === 'boolean' ? raw.active : true,
      };
    case 'returns':
      return {
        ownerId,
        date: clampStr(raw.date, 60, today) || today,
        no: clampStr(raw.no, 80, 'JOB-001') || 'JOB-001',
        code: clampStr(raw.code, 80, ''),
        sname: clampStr(raw.sname, 420, ''),
        cat: clampStr(raw.cat, 200, ''),
        reason: clampStr(raw.reason, 750, 'Retest requested') || 'Retest requested',
        act: ['Retrain', 'Plate Return', 'Failed / Rework'].includes(String(raw.act))
          ? String(raw.act)
          : raw.act === 'Return'
            ? 'Plate Return'
            : 'Retrain',
        fee: nonNeg(raw.fee),
      };
    case 'cash':
      return {
        ownerId,
        date: clampStr(raw.date, 60, today) || today,
        type: raw.type === 'out' ? 'out' : 'in',
        category: clampStr(raw.category, 200, ''),
        amt: nonNeg(raw.amt),
        note: clampStr(raw.note, 750, 'Entry') || 'Entry',
      };
    case 'generalAccounts':
      return {
        ownerId,
        rowOrder: nonNeg(raw.rowOrder),
        isOpening: typeof raw.isOpening === 'boolean' ? raw.isOpening : false,
        date: clampStr(raw.date, 60, ''),
        inDesc: clampStr(raw.inDesc, 600, ''),
        inCash: clampStr(raw.inCash, 120, ''),
        inBank: clampStr(raw.inBank, 120, ''),
        outDesc: clampStr(raw.outDesc, 600, ''),
        outCash: clampStr(raw.outCash, 120, ''),
      };
    case 'docs':
      return {
        ownerId,
        date: clampStr(raw.date, 60, today) || today,
        code: clampStr(raw.code, 80, ''),
        title: clampStr(raw.title, 420, 'Passport & Document File') || 'Passport & Document File',
        docNo: clampStr(raw.docNo, 120, ''),
        expiry: clampStr(raw.expiry, 60, ''),
        who: clampStr(raw.who, 420, 'Candidate') || 'Candidate',
        trade: clampStr(raw.trade, 200, ''),
        phone: clampStr(raw.phone, 60, ''),
        status: ['Original Held', 'Copy Submitted', 'Pending'].includes(String(raw.status))
          ? String(raw.status)
          : raw.status === 'Verified' || raw.status === 'Received'
            ? 'Original Held'
            : 'Pending',
        medical: ['Fit', 'Pending', 'Unfit'].includes(String(raw.medical))
          ? String(raw.medical)
          : 'Pending',
        policeClearance: ['Received', 'Applied', 'Pending'].includes(String(raw.policeClearance))
          ? String(raw.policeClearance)
          : 'Pending',
        certificate: ['Issued', 'In Progress', 'Pending'].includes(String(raw.certificate))
          ? String(raw.certificate)
          : 'Pending',
        bmetVisa: ['Stamped', 'Processing', 'Pending'].includes(String(raw.bmetVisa))
          ? String(raw.bmetVisa)
          : 'Pending',
        flightStatus: ['Scheduled', 'Waiting', 'Departed'].includes(String(raw.flightStatus))
          ? String(raw.flightStatus)
          : 'Waiting',
        flightDate: clampStr(raw.flightDate, 60, ''),
        agencyCountry: clampStr(raw.agencyCountry, 420, ''),
        note: clampStr(raw.note, 750, ''),
      };
    case 'auditLogs':
      return {
        ownerId,
        date: clampStr(raw.date, 60, today) || today,
        time: clampStr(raw.time, 60, formatLiveClock()) || formatLiveClock(),
        action: clampStr(raw.action, 120, 'UPDATE') || 'UPDATE',
        module: clampStr(raw.module, 120, 'System') || 'System',
        detail: clampStr(raw.detail, 750, 'Action performed') || 'Action performed',
      };
  }
}

export function useCenterStore() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [idbReady, setIdbReady] = useState(false);
  const [useLocalOffline, setUseLocalOffline] = useState<boolean>(() => {
    try {
      return localStorage.getItem(LOCAL_MODE_FLAG) === 'true';
    } catch {
      return false;
    }
  });
  const [cloudConnected, setCloudConnected] = useState(false);
  const [cloudSnapshotsReady, setCloudSnapshotsReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [data, setData] = useState<CenterDataState>(() => loadLocalState());
  const dataRef = useRef<CenterDataState>(data);
  dataRef.current = data;
  const [localSavedAt, setLocalSavedAt] = useState<number>(() => {
    const meta = readLocalSnapshotMeta();
    return meta.userMutatedAt || getStoredLocalMutationTs();
  });
  const [mutationVersion, setMutationVersion] = useState(0);
  const gaMutationDepthRef = useRef(0);

  useEffect(() => {
    let active = true;
    try {
      void navigator.storage?.persist?.().catch(() => undefined);
    } catch {
      // ignore storage persist check errors
    }
    void (async () => {
      const lsMeta = readLocalSnapshotMeta();
      const idbState = await readStateFromIdb();
      if (!active) return;
      if (idbState) {
        const idbSavedAt = typeof idbState._savedAt === 'number' ? idbState._savedAt : 0;
        const idbUserMutatedAt =
          typeof idbState._userMutatedAt === 'number' ? idbState._userMutatedAt : 0;
        const idbCount = countStateRecords(idbState);
        const lsCount = countStateRecords(lsMeta.state);
        const shouldUseIdb =
          lsMeta.blobsInIdb ||
          lsMeta.overflowToIdb ||
          idbSavedAt >= lsMeta.savedAt ||
          idbCount > lsCount;
        if (shouldUseIdb) {
          const hydrated = hydrateCenterState(idbState);
          dataRef.current = hydrated;
          setData(hydrated);
          if (idbUserMutatedAt > 0) {
            setLocalSavedAt(idbUserMutatedAt);
            if (idbUserMutatedAt > getStoredLocalMutationTs()) {
              recordLocalMutationTimestamp(idbUserMutatedAt);
            }
          }
        }
      }
      setIdbReady(true);
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    testFirestoreConnection().then((ok) => setCloudConnected(ok));
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (authReady && idbReady && !user) {
      setCloudSnapshotsReady(false);
      setLoading(false);
    }
  }, [authReady, idbReady, user]);

  const mode: 'cloud' | 'local' | 'unauthenticated' = useMemo(() => {
    if (user) return 'cloud';
    if (useLocalOffline) return 'local';
    return 'unauthenticated';
  }, [user, useLocalOffline]);

  const centerId = useMemo(() => {
    if (!user) return 'center_local';
    return `center_${sanitizeId(user.uid)}`;
  }, [user]);

  const ensureCenterProvisioned = useCallback(async (activeUser: User) => {
    const ownerId = sanitizeId(activeUser.uid);
    const cId = `center_${ownerId}`;

    const userRef = doc(db, 'users', ownerId);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      await setDoc(userRef, {
        uid: ownerId,
        displayName: clampStr(activeUser.displayName || activeUser.email || 'Center Admin', 120),
        role: 'owner',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    const privateRef = doc(db, 'users', ownerId, 'private', 'info');
    const privateSnap = await getDoc(privateRef);
    if (!privateSnap.exists()) {
      await setDoc(privateRef, {
        uid: ownerId,
        email: clampStr(activeUser.email || 'operator@ittc.local', 200),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    const centerRef = doc(db, 'centers', cId);
    const centerSnap = await getDoc(centerRef);
    if (!centerSnap.exists()) {
      const def = makeDefaultSettings(ownerId);
      await setDoc(centerRef, {
        ownerId,
        name: def.name,
        subtitle: def.subtitle,
        address: def.address,
        phone: def.phone,
        slipFooter: def.slipFooter,
        accountsPass: def.accountsPass,
        generalAccountsPass: def.generalAccountsPass || '1234',
        adminUser: def.adminUser,
        adminPass: def.adminPass,
        navOrder: def.navOrder,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      const batch = writeBatch(db);
      DEFAULT_PRICE_CATEGORIES.forEach((p, idx) => {
        batch.set(doc(db, 'centers', cId, 'prices', `price_${idx + 1}`), {
          ownerId,
          cat: p.cat,
          price: p.price,
          limit: p.limit,
          active: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();
    } else {
      const existingData = centerSnap.data();
      const mergedNav = mergeNavOrderWithDefaults(existingData.navOrder);
      const navNeedsUpdate =
        !Array.isArray(existingData.navOrder) ||
        existingData.navOrder.length !== mergedNav.length ||
        mergedNav.some((k, idx) => existingData.navOrder[idx] !== k);
      if (
        existingData.accountsPass === undefined ||
        existingData.generalAccountsPass === undefined ||
        existingData.adminUser === undefined ||
        existingData.adminPass === undefined ||
        navNeedsUpdate
      ) {
        try {
          await updateDoc(centerRef, {
            name: clampStr(existingData.name, 300, DEFAULT_CENTER_NAME) || DEFAULT_CENTER_NAME,
            subtitle: clampStr(existingData.subtitle, 400, DEFAULT_CENTER_SUBTITLE),
            address: clampStr(existingData.address, 500, ''),
            phone: clampStr(existingData.phone, 60, ''),
            slipFooter: clampStr(existingData.slipFooter, 400, ''),
            accountsPass: clampStr(existingData.accountsPass, 60, 'admin'),
            generalAccountsPass: clampStr(existingData.generalAccountsPass, 60, '1234') || '1234',
            adminUser: clampStr(existingData.adminUser, 60, 'superadmin'),
            adminPass: clampStr(existingData.adminPass, 60, 'admin'),
            navOrder: mergedNav,
            updatedAt: serverTimestamp(),
          });
        } catch (migErr) {
          console.warn('Non-fatal center settings migration skipped:', migErr);
        }
      }
      // Ensure any newly introduced default categories (e.g. 14–19) exist without overwriting user-edited prices/limits
      try {
        const existingPricesSnap = await getDocs(
          query(collection(db, 'centers', cId, 'prices'), where('ownerId', '==', ownerId))
        );
        const existingPricesList: JobPrice[] = existingPricesSnap.docs.map((d) => {
          const raw = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            ownerId: String(raw.ownerId || ownerId),
            cat: String(raw.cat || ''),
            price: nonNeg(raw.price),
            limit: nonNeg(raw.limit, 1),
            active: typeof raw.active === 'boolean' ? raw.active : true,
          };
        });
        const ensured = ensureDefaultJobPrices(existingPricesList, DEFAULT_PRICE_CATEGORIES, ownerId);
        const existingIds = new Set(existingPricesList.map((p) => p.id));
        const missing = ensured.filter((p) => !existingIds.has(p.id));
        if (missing.length > 0) {
          const batch = writeBatch(db);
          missing.forEach((p) => {
            batch.set(doc(db, 'centers', cId, 'prices', p.id), {
              ownerId,
              cat: p.cat,
              price: p.price,
              limit: p.limit,
              active: true,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          });
          await batch.commit();
        }
      } catch {
        // non-fatal if offline; client sortedData also fills missing defaults safely
      }
    }

    return { ownerId, cId, centerRef };
  }, []);

  useEffect(() => {
    if (!authReady || !user) return;

    let cancelled = false;
    const ownerId = sanitizeId(user.uid);
    const cId = `center_${ownerId}`;
    const unsubscribers: Array<() => void> = [];

    async function bootstrapAndListen() {
      setLoading(true);
      setCloudSnapshotsReady(false);
      setAuthError(null);
      let initialResolved = false;
      let snapshotsAllSettled = false;
      const pendingPaths = new Set<string>([`centers/${cId}`]);
      const subKeys: SubCollectionKey[] = [
        'students',
        'jobs',
        'outs',
        'staff',
        'staffPayments',
        'companies',
        'agencyContracts',
        'store',
        'storeLogs',
        'prices',
        'returns',
        'cash',
        'generalAccounts',
        'docs',
        'auditLogs',
      ];
      subKeys.forEach((k) => pendingPaths.add(`centers/${cId}/${k}`));

      const markSettled = (key: string) => {
        if (snapshotsAllSettled) return;
        pendingPaths.delete(key);
        if (pendingPaths.size === 0 && !cancelled) {
          snapshotsAllSettled = true;
          initialResolved = true;
          setCloudSnapshotsReady(true);
          setLoading(false);
          saveLocalState(dataRef.current, getStoredLocalMutationTs());
        }
      };

      const safetyTimer = window.setTimeout(() => {
        if (!initialResolved && !cancelled) {
          initialResolved = true;
          setLoading(false);
        }
      }, 4500);
      unsubscribers.push(() => window.clearTimeout(safetyTimer));

      try {
        const { centerRef } = await ensureCenterProvisioned(user!);

        if (cancelled) return;

        unsubscribers.push(
          onSnapshot(
            centerRef,
            (snap) => {
              if (snap.exists()) {
                const d = snap.data();
                const nextSettings: CenterSettings = {
                  id: snap.id,
                  ownerId: String(d.ownerId || ownerId),
                  name: String(d.name || DEFAULT_CENTER_NAME),
                  subtitle: String(d.subtitle || DEFAULT_CENTER_SUBTITLE),
                  address: String(d.address || ''),
                  phone: String(d.phone || ''),
                  slipFooter: String(d.slipFooter || ''),
                  accountsPass: String(d.accountsPass ?? 'admin'),
                  generalAccountsPass: String(d.generalAccountsPass ?? '1234'),
                  adminUser: String(d.adminUser ?? 'superadmin'),
                  adminPass: String(d.adminPass ?? 'admin'),
                  navOrder: mergeNavOrderWithDefaults(d.navOrder),
                };
                const nextImmediate = { ...dataRef.current, settings: nextSettings };
                dataRef.current = nextImmediate;
                setData((prev) => {
                  const next = { ...prev, settings: nextSettings };
                  dataRef.current = next;
                  return next;
                });
                if (snapshotsAllSettled) {
                  saveLocalState(nextImmediate, getStoredLocalMutationTs());
                }
              }
              markSettled(`centers/${cId}`);
            },
            (err) => {
              markSettled(`centers/${cId}`);
              handleFirestoreError(err, OperationType.GET, `centers/${cId}`);
            }
          )
        );

        subKeys.forEach((subKey) => {
          const path = `centers/${cId}/${subKey}`;
          const q = query(collection(db, 'centers', cId, subKey), where('ownerId', '==', ownerId));
          const u = onSnapshot(
            q,
            (snap) => {
              if (subKey === 'generalAccounts' && gaMutationDepthRef.current > 0) {
                markSettled(path);
                return;
              }
              const items = snap.docs.map((docSnap) => ({
                ...(docSnap.data() as Record<string, unknown>),
                id: docSnap.id,
              }));
              const nextImmediate = {
                ...dataRef.current,
                [subKey]: items,
              } as CenterDataState;
              dataRef.current = nextImmediate;
              setData((prev) => {
                const next = {
                  ...prev,
                  [subKey]: items,
                };
                dataRef.current = next;
                return next;
              });
              if (snapshotsAllSettled) {
                saveLocalState(nextImmediate, getStoredLocalMutationTs());
              }
              markSettled(path);
            },
            (err) => {
              markSettled(path);
              handleFirestoreError(err, OperationType.LIST, path);
            }
          );
          unsubscribers.push(u);
        });

        setCloudConnected(true);
      } catch (err) {
        console.error('Bootstrap error:', err);
        if (!cancelled) {
          initialResolved = true;
          setLoading(false);
          setAuthError(err instanceof Error ? err.message : 'Workspace initialization failed.');
        }
      }
    }

    bootstrapAndListen();

    return () => {
      cancelled = true;
      unsubscribers.forEach((fn) => fn());
    };
  }, [authReady, user, ensureCenterProvisioned]);

  useEffect(() => {
    if (mode === 'local' && idbReady) {
      saveLocalState(data, localSavedAt);
    }
  }, [data, mode, idbReady, localSavedAt]);

  const startGoogleSignIn = useCallback(async () => {
    setAuthError(null);
    try {
      await signInWithGoogle();
      try {
        localStorage.removeItem(LOCAL_MODE_FLAG);
      } catch {
        // ignore
      }
      setUseLocalOffline(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign in failed';
      setAuthError(message);
    }
  }, []);

  const enterLocalOfflineMode = useCallback(() => {
    setAuthError(null);
    try {
      localStorage.setItem(LOCAL_MODE_FLAG, 'true');
    } catch {
      // ignore
    }
    if (idbReady) {
      // Keep already-hydrated state if it came from IndexedDB and has records; otherwise reload from local snapshot
      const current = dataRef.current;
      const hasCurrentRecords =
        countStateRecords(current) > 0 ||
        current.prices.length > DEFAULT_PRICE_CATEGORIES.length;
      if (!hasCurrentRecords) {
        const loaded = loadLocalState();
        dataRef.current = loaded;
        setData(loaded);
      }
    } else {
      const loaded = loadLocalState();
      dataRef.current = loaded;
      setData(loaded);
    }
    setUseLocalOffline(true);
    setLoading(false);
  }, [idbReady]);

  const logout = useCallback(async () => {
    if (user) {
      await signOutUser();
    }
    try {
      localStorage.removeItem(LOCAL_MODE_FLAG);
    } catch {
      // ignore
    }
    setUseLocalOffline(false);
  }, [user]);

  const markUserMutated = useCallback(() => {
    const ts = recordLocalMutationTimestamp();
    setLocalSavedAt(ts);
    setMutationVersion((v) => v + 1);
    return ts;
  }, []);

  const addRecord = useCallback(
    async <K extends SubCollectionKey>(key: K, raw: Record<string, unknown>, customId?: string) => {
      const ownerId = user ? sanitizeId(user.uid) : 'local';
      const id = customId ? sanitizeId(customId) : createDocId(key.slice(0, 3));
      const clean = normalizeRecordPayload(key, raw, ownerId);

      const applyOptimisticAdd = (ts: number) => {
        const currentList = dataRef.current[key] as unknown as Array<Record<string, unknown>>;
        const existsInList = currentList.some((item) => item.id === id);
        const nextList = existsInList
          ? currentList.map((item) => (item.id === id ? { ...clean, id } : item))
          : [...currentList, { ...clean, id }];
        const nextState = {
          ...dataRef.current,
          [key]: nextList,
        } as CenterDataState;
        dataRef.current = nextState;
        saveLocalState(nextState, ts);
        setData((prev) => {
          const prevList = prev[key] as unknown as Array<Record<string, unknown>>;
          const hasItem = prevList.some((item) => item.id === id);
          const updatedList = hasItem
            ? prevList.map((item) => (item.id === id ? { ...clean, id } : item))
            : [...prevList, { ...clean, id }];
          const next = { ...prev, [key]: updatedList } as CenterDataState;
          dataRef.current = next;
          return next;
        });
        if (key === 'jobs' && (nextList.length === 1 || nextList.length % 5 === 0)) {
          void saveRollingSnapshotToIdb(nextState, `auto-jobs-${nextList.length}`);
        }
      };

      const prevState = dataRef.current;
      const prevMutationTs = getStoredLocalMutationTs();
      const ts = markUserMutated();
      applyOptimisticAdd(ts);

      if (mode === 'cloud' && user) {
        const path = `centers/${centerId}/${key}/${id}`;
        const docRef = doc(db, 'centers', centerId, key, id);
        const writePayload = {
          ...clean,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        const rollbackAdd = () => {
          recordLocalMutationTimestamp(prevMutationTs);
          setLocalSavedAt(prevMutationTs);
          dataRef.current = prevState;
          saveLocalState(prevState, prevMutationTs);
          setData(prevState);
        };
        try {
          const alreadyExists =
            Boolean(customId) &&
            (prevState[key] as Array<{ id: string }>).some((item) => item.id === id);
          if (alreadyExists && key !== 'auditLogs') {
            await updateDoc(docRef, {
              ...clean,
              updatedAt: serverTimestamp(),
            });
          } else if (!alreadyExists) {
            await setDoc(docRef, writePayload);
          }
        } catch (err) {
          const code = (err as { code?: string })?.code;
          if (code === 'permission-denied') {
            try {
              await ensureCenterProvisioned(user);
              if (customId && key !== 'auditLogs') {
                const snap = await getDoc(docRef);
                if (snap.exists()) {
                  await updateDoc(docRef, {
                    ...clean,
                    updatedAt: serverTimestamp(),
                  });
                  return id;
                }
              }
              await setDoc(docRef, writePayload);
              return id;
            } catch (retryErr) {
              rollbackAdd();
              handleFirestoreError(retryErr, OperationType.CREATE, path);
            }
          }
          rollbackAdd();
          handleFirestoreError(err, OperationType.CREATE, path);
        }
      }
      return id;
    },
    [mode, user, centerId, ensureCenterProvisioned, markUserMutated]
  );

  const updateRecord = useCallback(
    async <K extends SubCollectionKey>(
      key: K,
      id: string,
      patch: Record<string, unknown>
    ) => {
      const ownerId = user ? sanitizeId(user.uid) : 'local';
      const safeId = sanitizeId(id);

      const applyOptimisticUpdate = (ts: number) => {
        const nextList = (dataRef.current[key] as unknown as Array<Record<string, unknown>>).map(
          (item) => {
            if (item.id !== id && item.id !== safeId) return item;
            const merged = normalizeRecordPayload(key, { ...item, ...patch }, ownerId);
            return { ...merged, id: item.id };
          }
        );
        const nextImmediate = { ...dataRef.current, [key]: nextList } as CenterDataState;
        dataRef.current = nextImmediate;
        saveLocalState(nextImmediate, ts);
        setData((prev) => {
          const updated = (prev[key] as unknown as Array<Record<string, unknown>>).map((item) => {
            if (item.id !== id && item.id !== safeId) return item;
            const merged = normalizeRecordPayload(key, { ...item, ...patch }, ownerId);
            return { ...merged, id: item.id };
          });
          const next = { ...prev, [key]: updated } as CenterDataState;
          dataRef.current = next;
          return next;
        });
      };

      const prevState = dataRef.current;
      const prevMutationTs = getStoredLocalMutationTs();
      const ts = markUserMutated();
      applyOptimisticUpdate(ts);

      if (mode === 'cloud' && user) {
        const docRef = doc(db, 'centers', centerId, key, safeId);
        let existing = (prevState[key] as unknown as Array<Record<string, unknown>>).find(
          (r) => r.id === id || r.id === safeId
        );
        if (!existing) {
          try {
            const snap = await getDoc(docRef);
            if (snap.exists()) {
              existing = { ...(snap.data() as Record<string, unknown>), id: snap.id };
            }
          } catch {
            // fallback to patch-only update below if getDoc fails
          }
        }
        const path = `centers/${centerId}/${key}/${safeId}`;
        try {
          if (existing) {
            const merged = normalizeRecordPayload(key, { ...existing, ...patch }, ownerId);
            await updateDoc(docRef, {
              ...merged,
              updatedAt: serverTimestamp(),
            });
          } else {
            // Safe partial update: only normalize & write keys present in patch so untouched fields cannot be wiped
            const fullNormalized = normalizeRecordPayload(key, patch, ownerId);
            const partialPayload: Record<string, unknown> = { updatedAt: serverTimestamp() };
            for (const k of Object.keys(patch)) {
              if (k in fullNormalized) {
                partialPayload[k] = fullNormalized[k];
              }
            }
            await updateDoc(docRef, partialPayload);
          }
        } catch (err) {
          recordLocalMutationTimestamp(prevMutationTs);
          setLocalSavedAt(prevMutationTs);
          dataRef.current = prevState;
          saveLocalState(prevState, prevMutationTs);
          setData(prevState);
          handleFirestoreError(err, OperationType.UPDATE, path);
        }
      }
    },
    [mode, user, centerId, markUserMutated]
  );

  const deleteRecord = useCallback(
    async <K extends SubCollectionKey>(key: K, id: string) => {
      if (key === 'prices') {
        const orderedPrices = sortJobPrices(dataRef.current.prices);
        const targetIdx = orderedPrices.findIndex((p) => p.id === id);
        const target = targetIdx >= 0 ? orderedPrices[targetIdx] : undefined;
        if (target && isProtectedDefaultPrice(target, targetIdx)) {
          return;
        }
      }
      const safeId = sanitizeId(id);
      const applyOptimisticDelete = (ts: number) => {
        const filtered = (dataRef.current[key] as Array<{ id: string }>).filter(
          (item) => item.id !== id && item.id !== safeId
        );
        const nextImmediate = { ...dataRef.current, [key]: filtered } as CenterDataState;
        dataRef.current = nextImmediate;
        saveLocalState(nextImmediate, ts);
        setData((prev) => {
          const next = {
            ...prev,
            [key]: (prev[key] as Array<{ id: string }>).filter(
              (item) => item.id !== id && item.id !== safeId
            ),
          } as CenterDataState;
          dataRef.current = next;
          return next;
        });
      };

      const prevState = dataRef.current;
      const prevMutationTs = getStoredLocalMutationTs();
      const ts = markUserMutated();
      applyOptimisticDelete(ts);

      if (mode === 'cloud' && user) {
        const path = `centers/${centerId}/${key}/${safeId}`;
        try {
          await deleteDoc(doc(db, 'centers', centerId, key, safeId));
        } catch (err) {
          recordLocalMutationTimestamp(prevMutationTs);
          setLocalSavedAt(prevMutationTs);
          dataRef.current = prevState;
          saveLocalState(prevState, prevMutationTs);
          setData(prevState);
          handleFirestoreError(err, OperationType.DELETE, path);
        }
      }
    },
    [mode, user, centerId, markUserMutated]
  );

  const logAudit = useCallback(
    async (action: string, module: string, detail: string) => {
      try {
        await addRecord('auditLogs', {
          date: todayDDMMYYYY(),
          time: formatLiveClock(),
          action,
          module,
          detail,
        });
      } catch (err) {
        console.warn('Non-fatal audit log failed:', err);
      }
    },
    [addRecord]
  );

  const updateCenterSettings = useCallback(
    async (patch: Partial<CenterSettings>) => {
      const currentSettings = dataRef.current.settings;
      const next: CenterSettings = {
        ...currentSettings,
        ...patch,
        name: clampStr(patch.name ?? currentSettings.name, 300, DEFAULT_CENTER_NAME) || DEFAULT_CENTER_NAME,
        subtitle: clampStr(patch.subtitle ?? currentSettings.subtitle, 400, DEFAULT_CENTER_SUBTITLE),
        address: clampStr(patch.address ?? currentSettings.address, 500, ''),
        phone: clampStr(patch.phone ?? currentSettings.phone, 60, ''),
        slipFooter: clampStr(patch.slipFooter ?? currentSettings.slipFooter, 400, ''),
        accountsPass: clampStr(patch.accountsPass ?? currentSettings.accountsPass, 60, 'admin'),
        generalAccountsPass:
          clampStr(patch.generalAccountsPass ?? currentSettings.generalAccountsPass, 60, '1234') ||
          '1234',
        adminUser: clampStr(patch.adminUser ?? currentSettings.adminUser, 60, 'superadmin'),
        adminPass: clampStr(patch.adminPass ?? currentSettings.adminPass, 60, 'admin'),
        navOrder: (patch.navOrder ?? currentSettings.navOrder).slice(0, 30),
      };

      const applySettingsState = (ts: number) => {
        const nextImmediate = { ...dataRef.current, settings: next };
        dataRef.current = nextImmediate;
        saveLocalState(nextImmediate, ts);
        setData((prev) => {
          const nextState = { ...prev, settings: next };
          dataRef.current = nextState;
          return nextState;
        });
      };

      if (mode === 'cloud' && user) {
        const ownerId = sanitizeId(user.uid);
        const path = `centers/${centerId}`;
        const centerRef = doc(db, 'centers', centerId);
        try {
          await updateDoc(centerRef, {
            name: next.name,
            subtitle: next.subtitle,
            address: next.address,
            phone: next.phone,
            slipFooter: next.slipFooter,
            accountsPass: next.accountsPass,
            generalAccountsPass: next.generalAccountsPass || '1234',
            adminUser: next.adminUser,
            adminPass: next.adminPass,
            navOrder: next.navOrder,
            updatedAt: serverTimestamp(),
          });
          const ts = markUserMutated();
          applySettingsState(ts);
        } catch (err) {
          const code = (err as { code?: string })?.code;
          if (code === 'not-found' || code === 'permission-denied') {
            try {
              const snap = await getDoc(centerRef);
              if (!snap.exists()) {
                await setDoc(centerRef, {
                  ownerId,
                  name: next.name,
                  subtitle: next.subtitle,
                  address: next.address,
                  phone: next.phone,
                  slipFooter: next.slipFooter,
                  accountsPass: next.accountsPass,
                  generalAccountsPass: next.generalAccountsPass || '1234',
                  adminUser: next.adminUser,
                  adminPass: next.adminPass,
                  navOrder: next.navOrder,
                  createdAt: serverTimestamp(),
                  updatedAt: serverTimestamp(),
                });
                const ts = markUserMutated();
                applySettingsState(ts);
                return;
              }
            } catch (createErr) {
              handleFirestoreError(createErr, OperationType.CREATE, path);
            }
          }
          handleFirestoreError(err, OperationType.UPDATE, path);
        }
      } else {
        const ts = markUserMutated();
        applySettingsState(ts);
      }
    },
    [mode, user, centerId, markUserMutated]
  );

  const loadDemoData = useCallback(async () => {
    const ownerId = user ? sanitizeId(user.uid) : 'local';
    const seed = buildDemoSeed(ownerId, todayDDMMYYYY(), todayYYYYMMDD());
    const keys: Array<keyof typeof seed> = [
      'prices',
      'students',
      'jobs',
      'outs',
      'staff',
      'staffPayments',
      'companies',
      'agencyContracts',
      'store',
      'storeLogs',
      'returns',
      'cash',
      'docs',
      'auditLogs',
    ];
    const ts = markUserMutated();

    if (mode === 'cloud' && user) {
      try {
        await ensureCenterProvisioned(user);
        const existingPriceSnap = await getDocs(
          query(collection(db, 'centers', centerId, 'prices'), where('ownerId', '==', ownerId))
        );
        const existingPriceIds = new Set(existingPriceSnap.docs.map((d) => d.id));
        const demoOps: Array<{ k: SubCollectionKey; id: string; clean: Record<string, unknown> }> = [];
        keys.forEach((k) => {
          const list = seed[k] as Array<Record<string, unknown>>;
          list.forEach((item, idx) => {
            const docId = k === 'prices' ? `price_${idx + 1}` : createDocId(k.slice(0, 3));
            const clean = normalizeRecordPayload(k, item, ownerId);
            demoOps.push({ k, id: docId, clean });
          });
        });
        for (let i = 0; i < demoOps.length; i += 200) {
          const batch = writeBatch(db);
          demoOps.slice(i, i + 200).forEach(({ k, id, clean }) => {
            const ref = doc(db, 'centers', centerId, k, id);
            if (k === 'prices' && existingPriceIds.has(id)) {
              batch.update(ref, {
                ...clean,
                updatedAt: serverTimestamp(),
              });
            } else {
              batch.set(ref, {
                ...clean,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              });
            }
          });
          await batch.commit();
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `centers/${centerId}`);
      }
    } else {
      setData((prev) => {
        const next = { ...prev };
        keys.forEach((k) => {
          const list = seed[k] as Array<Record<string, unknown>>;
          (next[k] as unknown[]) = list.map((item, idx) => ({
            ...normalizeRecordPayload(k, item, ownerId),
            id: k === 'prices' ? `price_${idx + 1}` : createDocId(k.slice(0, 3)),
          }));
        });
        dataRef.current = next;
        saveLocalState(next, ts);
        return next;
      });
    }
  }, [mode, user, centerId, ensureCenterProvisioned, markUserMutated]);

  const resetWorkspaceData = useCallback(async () => {
    const ownerId = user ? sanitizeId(user.uid) : 'local';
    await saveRollingSnapshotToIdb(dataRef.current, 'pre-reset');
    const keys: SubCollectionKey[] = [
      'students',
      'jobs',
      'outs',
      'staff',
      'staffPayments',
      'companies',
      'agencyContracts',
      'store',
      'storeLogs',
      'prices',
      'returns',
      'cash',
      'generalAccounts',
      'docs',
      'auditLogs',
    ];

    if (mode === 'cloud' && user) {
      try {
        await ensureCenterProvisioned(user);
        const deleteRefs: Array<ReturnType<typeof doc>> = [];
        for (const k of keys) {
          const snap = await getDocs(
            query(collection(db, 'centers', centerId, k), where('ownerId', '==', ownerId))
          );
          snap.forEach((d) => deleteRefs.push(d.ref));
        }
        for (let i = 0; i < deleteRefs.length; i += 400) {
          const clearBatch = writeBatch(db);
          deleteRefs.slice(i, i + 400).forEach((ref) => clearBatch.delete(ref));
          await clearBatch.commit();
        }
        const batch = writeBatch(db);
        DEFAULT_PRICE_CATEGORIES.forEach((p, idx) => {
          batch.set(doc(db, 'centers', centerId, 'prices', `price_${idx + 1}`), {
            ownerId,
            cat: p.cat,
            price: p.price,
            limit: p.limit,
            active: true,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        });
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `centers/${centerId}`);
      }
    } else {
      const fresh = makeInitialLocalState();
      const ts = markUserMutated();
      dataRef.current = fresh;
      setData(fresh);
      saveLocalState(fresh, ts);
    }
  }, [mode, user, centerId, markUserMutated]);

  const importBackupData = useCallback(
    async (
      backup: WorkspaceBackup,
      options?: { preservePrices?: boolean; fromRemoteSync?: boolean }
    ) => {
      const ownerId = user ? sanitizeId(user.uid) : 'local';
      const preservePrices = Boolean(options?.preservePrices);
      const fromRemoteSync = Boolean(options?.fromRemoteSync);
      const currentSnapshot = dataRef.current;
      await saveRollingSnapshotToIdb(
        currentSnapshot,
        fromRemoteSync ? 'pre-remote-sync' : 'pre-restore'
      );
      const keys: SubCollectionKey[] = [
        'students',
        'jobs',
        'outs',
        'staff',
        'staffPayments',
        'companies',
        'agencyContracts',
        'store',
        'storeLogs',
        'prices',
        'returns',
        'cash',
        'generalAccounts',
        'docs',
        'auditLogs',
      ];

      const preserveGeneralAccountsOnEmptyRemote =
        fromRemoteSync &&
        (!Array.isArray(backup.generalAccounts) || backup.generalAccounts.length === 0) &&
        currentSnapshot.generalAccounts.length > 0;

      // Safety net: during automatic remote sync, NEVER delete existing jobs/students/outs/cash/auditLogs
      // if incoming remote backup has fewer items than local/Firestore.
      const nonDestructiveKeysOnRemoteSync = new Set<SubCollectionKey>();
      if (fromRemoteSync) {
        const guardedKeys: SubCollectionKey[] = [
          'jobs',
          'students',
          'outs',
          'cash',
          'generalAccounts',
          'auditLogs',
        ];
        for (const gk of guardedKeys) {
          const localLen = Array.isArray(currentSnapshot[gk]) ? currentSnapshot[gk].length : 0;
          const remoteLen = Array.isArray(backup[gk]) ? (backup[gk] as unknown[]).length : 0;
          if (localLen > remoteLen && (localLen - remoteLen > 2 || remoteLen === 0)) {
            nonDestructiveKeysOnRemoteSync.add(gk);
          }
        }
      }

      if (mode === 'cloud' && user) {
        try {
          await ensureCenterProvisioned(user);
          if (backup.set) {
            await updateCenterSettings({
              name: backup.set.name || currentSnapshot.settings.name,
              subtitle: backup.set.subtitle ?? currentSnapshot.settings.subtitle,
              address: backup.set.address ?? currentSnapshot.settings.address,
              phone: backup.set.phone ?? currentSnapshot.settings.phone,
              slipFooter: backup.set.slipFooter ?? currentSnapshot.settings.slipFooter,
              accountsPass: backup.set.accountsPass ?? currentSnapshot.settings.accountsPass,
              generalAccountsPass:
                backup.set.generalAccountsPass ??
                currentSnapshot.settings.generalAccountsPass ??
                '1234',
              adminUser: backup.set.adminUser ?? currentSnapshot.settings.adminUser,
              adminPass: backup.set.adminPass ?? currentSnapshot.settings.adminPass,
              navOrder:
                Array.isArray(backup.set.navOrder) && backup.set.navOrder.length > 0
                  ? backup.set.navOrder
                  : currentSnapshot.settings.navOrder,
            });
          }

          const existingIdsByCol = new Map<SubCollectionKey, Set<string>>();
          for (const k of keys) {
            const snap = await getDocs(
              query(collection(db, 'centers', centerId, k), where('ownerId', '==', ownerId))
            );
            const ids = new Set<string>();
            snap.forEach((d) => ids.add(d.id));
            existingIdsByCol.set(k, ids);
          }

          const ops: Array<{
            k: SubCollectionKey;
            id: string;
            payload: Record<string, unknown>;
            estBytes: number;
          }> = [];
          const newIdsByCol = new Map<SubCollectionKey, Set<string>>();
          keys.forEach((k) => {
            const arr = Array.isArray(backup[k]) ? (backup[k] as Array<Record<string, unknown>>) : [];
            const seen = new Set<string>();
            newIdsByCol.set(k, seen);
            arr.forEach((item, idx) => {
              let rawId =
                typeof item.id === 'string' && item.id.trim()
                  ? sanitizeId(item.id)
                  : createDocId(`${k.slice(0, 3)}_${idx}`);
              if (seen.has(rawId)) {
                rawId = createDocId(`${k.slice(0, 3)}_${idx}`);
              }
              seen.add(rawId);
              // auditLogs are immutable (allow update: if false in firestore.rules); only create missing ones
              if (k === 'auditLogs' && existingIdsByCol.get('auditLogs')?.has(rawId)) {
                return;
              }
              const normalized = normalizeRecordPayload(k, item, ownerId);
              ops.push({
                k,
                id: rawId,
                payload: normalized,
                estBytes: JSON.stringify(normalized).length + 256,
              });
            });
            // During auto-sync, preserve all existing local categories (exact match) and ensure all 19 defaults exist
            if (k === 'prices') {
              const seenExactCats = new Set(
                arr.map((p) => String(p.cat || '').trim()).filter(Boolean)
              );
              const extraPricesToAdd: JobPrice[] = [];
              if (preservePrices) {
                currentSnapshot.prices.forEach((localP) => {
                  const exactCat = localP.cat.trim();
                  if (!seen.has(localP.id) && (!exactCat || !seenExactCats.has(exactCat))) {
                    if (exactCat) seenExactCats.add(exactCat);
                    extraPricesToAdd.push(localP);
                  }
                });
              }
              const ensured = ensureDefaultJobPrices(
                [
                  ...arr.map((item, idx) => ({
                    ...(normalizeRecordPayload('prices', item, ownerId) as unknown as JobPrice),
                    id:
                      typeof item.id === 'string' && item.id.trim()
                        ? sanitizeId(item.id)
                        : `price_${idx + 1}`,
                  })),
                  ...extraPricesToAdd,
                ],
                DEFAULT_PRICE_CATEGORIES,
                ownerId
              );
              ensured.forEach((p) => {
                if (!seen.has(p.id) && (!p.cat.trim() || !seenExactCats.has(p.cat.trim()))) {
                  seen.add(p.id);
                  if (p.cat.trim()) seenExactCats.add(p.cat.trim());
                  const normalized = normalizeRecordPayload(
                    'prices',
                    p as unknown as Record<string, unknown>,
                    ownerId
                  );
                  ops.push({
                    k: 'prices',
                    id: p.id,
                    payload: normalized,
                    estBytes: JSON.stringify(normalized).length + 256,
                  });
                }
              });
            }
          });

          // Write in byte-safe & count-safe batches (stay well below Firestore's 10MB batch cap)
          let writeBatchOps: typeof ops = [];
          let writeBatchBytes = 0;
          const flushWriteBatch = async () => {
            if (writeBatchOps.length === 0) return;
            const writeB = writeBatch(db);
            writeBatchOps.forEach(({ k, id, payload }) => {
              const docRef = doc(db, 'centers', centerId, k, id);
              if (existingIdsByCol.get(k)?.has(id)) {
                writeB.update(docRef, {
                  ...payload,
                  updatedAt: serverTimestamp(),
                });
              } else {
                writeB.set(docRef, {
                  ...payload,
                  createdAt: serverTimestamp(),
                  updatedAt: serverTimestamp(),
                });
              }
            });
            await writeB.commit();
            writeBatchOps = [];
            writeBatchBytes = 0;
          };

          for (const op of ops) {
            if (
              writeBatchOps.length >= 100 ||
              (writeBatchOps.length > 0 && writeBatchBytes + op.estBytes > 2500000)
            ) {
              await flushWriteBatch();
            }
            writeBatchOps.push(op);
            writeBatchBytes += op.estBytes;
          }
          await flushWriteBatch();

          // Remove only stale docs not present in the imported backup (never wipe guarded collections when remote is smaller during auto-sync)
          const staleRefs: Array<ReturnType<typeof doc>> = [];
          for (const k of keys) {
            if (k === 'generalAccounts' && preserveGeneralAccountsOnEmptyRemote) {
              continue;
            }
            if (nonDestructiveKeysOnRemoteSync.has(k)) {
              continue;
            }
            const existingIds = existingIdsByCol.get(k);
            const nextIds = newIdsByCol.get(k);
            if (!existingIds || !nextIds) continue;
            existingIds.forEach((oldId) => {
              if (!nextIds.has(oldId)) {
                staleRefs.push(doc(db, 'centers', centerId, k, oldId));
              }
            });
          }
          for (let i = 0; i < staleRefs.length; i += 350) {
            const clearBatch = writeBatch(db);
            staleRefs.slice(i, i + 350).forEach((ref) => clearBatch.delete(ref));
            await clearBatch.commit();
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `centers/${centerId}`);
        }
      } else {
        const mergedSettings: CenterSettings = {
          ...currentSnapshot.settings,
          ...(backup.set || {}),
          navOrder: mergeNavOrderWithDefaults(
            Array.isArray(backup.set?.navOrder) && backup.set.navOrder.length > 0
              ? backup.set.navOrder
              : currentSnapshot.settings.navOrder
          ),
        };
        const next: CenterDataState = {
          ...currentSnapshot,
          settings: mergedSettings,
          students: [],
          jobs: [],
          outs: [],
          staff: [],
          staffPayments: [],
          companies: [],
          agencyContracts: [],
          store: [],
          storeLogs: [],
          prices: [],
          returns: [],
          cash: [],
          generalAccounts: preserveGeneralAccountsOnEmptyRemote
            ? currentSnapshot.generalAccounts
            : [],
          docs: [],
          auditLogs: [],
        };
        keys.forEach((k) => {
          if (k === 'generalAccounts' && preserveGeneralAccountsOnEmptyRemote) return;
          const arr = Array.isArray(backup[k]) ? (backup[k] as Array<Record<string, unknown>>) : [];
          const normalizedArr = arr.map((item, idx) => ({
            ...normalizeRecordPayload(k, item, ownerId),
            id:
              typeof item.id === 'string'
                ? sanitizeId(item.id)
                : createDocId(`${k.slice(0, 3)}_${idx}`),
          }));
          if (nonDestructiveKeysOnRemoteSync.has(k)) {
            const incomingIds = new Set(normalizedArr.map((r) => r.id));
            const existingArr = Array.isArray(currentSnapshot[k])
              ? (currentSnapshot[k] as unknown as Array<Record<string, unknown> & { id: string }>)
              : [];
            const preservedMissing = existingArr.filter((r) => !incomingIds.has(r.id));
            (next[k] as unknown[]) = [...normalizedArr, ...preservedMissing];
          } else {
            (next[k] as unknown[]) = normalizedArr;
          }
        });
        if (preservePrices) {
          const seenIds = new Set(next.prices.map((p) => p.id));
          const seenExactCats = new Set(next.prices.map((p) => p.cat.trim()));
          currentSnapshot.prices.forEach((localP) => {
            if (!seenIds.has(localP.id) && !seenExactCats.has(localP.cat.trim())) {
              seenIds.add(localP.id);
              seenExactCats.add(localP.cat.trim());
              next.prices.push(localP);
            }
          });
        }
        next.prices = ensureDefaultJobPrices(next.prices, DEFAULT_PRICE_CATEGORIES, ownerId);

        const preservedExtra = nonDestructiveKeysOnRemoteSync.size > 0;
        const nextUserMutatedAt =
          fromRemoteSync && !preservedExtra ? 0 : recordLocalMutationTimestamp(Date.now());
        if (fromRemoteSync && !preservedExtra) {
          recordLocalMutationTimestamp(0);
        } else {
          setMutationVersion((v) => v + 1);
        }
        dataRef.current = next;
        setLocalSavedAt(nextUserMutatedAt);
        saveLocalState(next, nextUserMutatedAt);
        setData(next);
      }
    },
    [mode, user, centerId, updateCenterSettings, ensureCenterProvisioned]
  );

  const enterLocalModeWithBackup = useCallback((backup: WorkspaceBackup) => {
    setAuthError(null);
    const prevSnapshot = dataRef.current;
    void saveRollingSnapshotToIdb(prevSnapshot, 'pre-mega-signin');
    try {
      localStorage.setItem(LOCAL_MODE_FLAG, 'true');
    } catch {
      // ignore
    }
    const base = makeInitialLocalState();
    const mergedSettings: CenterSettings = {
      ...base.settings,
      ...(backup.set || {}),
      navOrder: mergeNavOrderWithDefaults(backup.set?.navOrder),
    };
    const keys: SubCollectionKey[] = [
      'students',
      'jobs',
      'outs',
      'staff',
      'staffPayments',
      'companies',
      'agencyContracts',
      'store',
      'storeLogs',
      'prices',
      'returns',
      'cash',
      'generalAccounts',
      'docs',
      'auditLogs',
    ];
    const next: CenterDataState = {
      ...base,
      settings: mergedSettings,
    };
    const guarded = new Set<SubCollectionKey>([
      'jobs',
      'students',
      'outs',
      'cash',
      'generalAccounts',
      'auditLogs',
    ]);
    let preservedAny = false;
    keys.forEach((k) => {
      const arr = Array.isArray(backup[k]) ? (backup[k] as Array<Record<string, unknown>>) : [];
      const normalizedArr = arr.map((item, idx) => ({
        ...normalizeRecordPayload(k, item, 'local'),
        id:
          typeof item.id === 'string' && item.id.trim()
            ? sanitizeId(item.id)
            : createDocId(`${k.slice(0, 3)}_${idx}`),
      }));
      const prevArr = Array.isArray(prevSnapshot[k])
        ? (prevSnapshot[k] as unknown as Array<Record<string, unknown> & { id: string }>)
        : [];
      if (guarded.has(k) && prevArr.length > normalizedArr.length) {
        const incomingIds = new Set(normalizedArr.map((r) => r.id));
        const extra = prevArr.filter((r) => !incomingIds.has(r.id));
        if (extra.length > 0) {
          preservedAny = true;
          (next[k] as unknown[]) = [...normalizedArr, ...extra];
          return;
        }
      }
      (next[k] as unknown[]) = normalizedArr;
    });
    next.prices = ensureDefaultJobPrices(next.prices, DEFAULT_PRICE_CATEGORIES, 'local');

    const ts = preservedAny ? recordLocalMutationTimestamp(Date.now()) : 0;
    if (!preservedAny) {
      recordLocalMutationTimestamp(0);
    }
    dataRef.current = next;
    setLocalSavedAt(ts);
    saveLocalState(next, ts);
    setData(next);
    setUseLocalOffline(true);
    setLoading(false);
  }, []);

  const replaceGeneralAccounts = useCallback(
    async (rows: Array<Record<string, unknown>>) => {
      const ownerId = user ? sanitizeId(user.uid) : 'local';
      const seenIds = new Set<string>();
      const prepared = rows.map((raw, idx) => {
        const clean = normalizeRecordPayload(
          'generalAccounts',
          {
            ...raw,
            rowOrder: typeof raw.rowOrder === 'number' ? raw.rowOrder : idx + 1,
          },
          ownerId
        );
        let id =
          typeof raw.id === 'string' && raw.id.trim()
            ? sanitizeId(raw.id)
            : createDocId(`ga_${idx}`);
        if (seenIds.has(id)) {
          id = createDocId(`ga_${idx}`);
        }
        seenIds.add(id);
        return { id, clean };
      });

      const nextRowsList = prepared.map(
        ({ id, clean }) => ({ ...clean, id }) as unknown as GeneralAccountRow
      );

      if (mode === 'cloud' && user) {
        const colPath = `centers/${centerId}/generalAccounts`;
        const prevState = dataRef.current;
        const prevMutationTs = getStoredLocalMutationTs();
        gaMutationDepthRef.current += 1;
        try {
          await ensureCenterProvisioned(user);

          // Apply optimistic state & mark user mutation BEFORE batch commits so intermediate
          // Firestore onSnapshot events never downgrade timestamps or cause App auto-sync to skip
          const ts = markUserMutated();
          const nextImmediate: CenterDataState = {
            ...dataRef.current,
            generalAccounts: nextRowsList,
          };
          dataRef.current = nextImmediate;
          saveLocalState(nextImmediate, ts);
          setData((prev) => {
            const next: CenterDataState = {
              ...prev,
              generalAccounts: nextRowsList,
            };
            dataRef.current = next;
            return next;
          });

          const existingSnap = await getDocs(
            query(
              collection(db, 'centers', centerId, 'generalAccounts'),
              where('ownerId', '==', ownerId)
            )
          );
          const existingIdsWithCreatedAt = new Set(
            existingSnap.docs
              .filter((d) => d.data()?.createdAt != null)
              .map((d) => d.id)
          );
          const legacyIdsMissingCreatedAt = new Set(
            existingSnap.docs
              .filter((d) => d.data()?.createdAt == null)
              .map((d) => d.id)
          );
          const keepIds = new Set(prepared.map((p) => p.id));
          const deleteRefs = existingSnap.docs
            .filter((d) => !keepIds.has(d.id) || legacyIdsMissingCreatedAt.has(d.id))
            .map((d) => d.ref);

          // Delete legacy/stale rows that lack createdAt first if they are being replaced with same ID
          const recreateDeleteRefs = existingSnap.docs
            .filter((d) => keepIds.has(d.id) && legacyIdsMissingCreatedAt.has(d.id))
            .map((d) => d.ref);
          for (let i = 0; i < recreateDeleteRefs.length; i += 350) {
            const preDelBatch = writeBatch(db);
            recreateDeleteRefs.slice(i, i + 350).forEach((ref) => preDelBatch.delete(ref));
            await preDelBatch.commit();
          }

          // Write/upsert all new & kept rows FIRST so onSnapshot never flashes empty mid-import
          for (let i = 0; i < prepared.length; i += 200) {
            const batch = writeBatch(db);
            prepared.slice(i, i + 200).forEach(({ id, clean }) => {
              const docRef = doc(db, 'centers', centerId, 'generalAccounts', id);
              if (existingIdsWithCreatedAt.has(id)) {
                batch.update(docRef, {
                  ...clean,
                  updatedAt: serverTimestamp(),
                });
              } else {
                batch.set(docRef, {
                  ...clean,
                  createdAt: serverTimestamp(),
                  updatedAt: serverTimestamp(),
                });
              }
            });
            await batch.commit();
          }

          // Delete stale rows only after new rows are safely committed
          const staleOnlyRefs = deleteRefs.filter(
            (ref) => !legacyIdsMissingCreatedAt.has(ref.id)
          );
          for (let i = 0; i < staleOnlyRefs.length; i += 350) {
            const delBatch = writeBatch(db);
            staleOnlyRefs.slice(i, i + 350).forEach((ref) => delBatch.delete(ref));
            await delBatch.commit();
          }

          // Re-confirm committed list in local cache & state with latest timestamp
          const finalTs = markUserMutated();
          const finalImmediate: CenterDataState = {
            ...dataRef.current,
            generalAccounts: nextRowsList,
          };
          dataRef.current = finalImmediate;
          saveLocalState(finalImmediate, finalTs);
          setData((prev) => {
            const next: CenterDataState = {
              ...prev,
              generalAccounts: nextRowsList,
            };
            dataRef.current = next;
            return next;
          });
        } catch (err) {
          recordLocalMutationTimestamp(prevMutationTs);
          setLocalSavedAt(prevMutationTs);
          dataRef.current = prevState;
          saveLocalState(prevState, prevMutationTs);
          setData(prevState);
          handleFirestoreError(err, OperationType.WRITE, colPath);
        } finally {
          gaMutationDepthRef.current = Math.max(0, gaMutationDepthRef.current - 1);
        }
      } else {
        const ts = markUserMutated();
        const nextImmediate: CenterDataState = {
          ...dataRef.current,
          generalAccounts: nextRowsList,
        };
        dataRef.current = nextImmediate;
        saveLocalState(nextImmediate, ts);
        setData((prev) => {
          const next: CenterDataState = {
            ...prev,
            generalAccounts: nextRowsList,
          };
          dataRef.current = next;
          return next;
        });
      }
    },
    [mode, user, centerId, ensureCenterProvisioned, markUserMutated]
  );

  const verifyCloudSync = useCallback(async () => {
    const ok = await testFirestoreConnection();
    setCloudConnected(ok);
    return ok;
  }, []);

  const sortedData = useMemo<CenterDataState>(
    () => ({
      ...data,
      prices: ensureDefaultJobPrices(
        data.prices,
        DEFAULT_PRICE_CATEGORIES,
        user ? sanitizeId(user.uid) : 'local'
      ),
      generalAccounts: [...data.generalAccounts].sort(
        (a, b) => (a.rowOrder ?? 0) - (b.rowOrder ?? 0) || a.id.localeCompare(b.id)
      ),
    }),
    [data, user]
  );

  return {
    user,
    authReady,
    idbReady,
    mode,
    cloudConnected,
    cloudSnapshotsReady,
    loading,
    authError,
    data: sortedData,
    localSavedAt,
    mutationVersion,
    startGoogleSignIn,
    enterLocalOfflineMode,
    enterLocalModeWithBackup,
    logout,
    addRecord,
    updateRecord,
    deleteRecord,
    logAudit,
    updateCenterSettings,
    loadDemoData,
    resetWorkspaceData,
    importBackupData,
    replaceGeneralAccounts,
    verifyCloudSync,
  };
}
