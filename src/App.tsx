import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { AuthGate } from './components/AuthGate';
import { CenterSettingsDrawer } from './components/CenterSettingsDrawer';
import { IssueJobModal } from './components/IssueJobModal';
import { PrintReportModal, ReportPrintContent } from './components/PrintReportModal';
import { Sidebar } from './components/Sidebar';
import { ThermalSlipContent, ThermalSlipModal } from './components/ThermalSlipModal';
import { TopBar } from './components/TopBar';
import { CashbookView, ReportsView } from './components/views/AccountsReportsViews';
import { AdminView, SettingsView } from './components/views/AdminSettingsViews';
import { DashboardView } from './components/views/DashboardView';
import { DueView } from './components/views/DueView';
import { GeneralAccountsView } from './components/views/GeneralAccountsView';
import {
  InactiveStudentsView,
  type InactiveFilterPreset,
} from './components/views/InactiveStudentsView';
import { JobsView } from './components/views/JobsView';
import { MonthlyReportView } from './components/views/MonthlyReportView';
import {
  CompaniesView,
  DocsView,
  PricesView,
  ReturnsView,
  StaffView,
  StoreView,
} from './components/views/OperationsViews';
import { StudentsView } from './components/views/StudentsView';
import { DEFAULT_PRICE_CATEGORIES } from './constants';
import { computeStudentJobActivity } from './lib/analytics';
import {
  applyUiSettingsToDocument,
  DEFAULT_UI_SETTINGS,
  loadUiSettings,
  saveUiSettings,
  type UiAppearanceSettings,
} from './lib/appearance';
import {
  buildDatabaseJsonPayload,
  clearFallbackFolderName,
  clearSavedLocalTargetHandle,
  connectMegaAccount,
  disconnectMegaAccount,
  ensureTargetWritePermission,
  fetchMegaSyncStatus,
  fetchServerLocalStatus,
  getLocalTargetDisplayName,
  getSavedFallbackFolderName,
  getSavedLocalTargetHandle,
  isEmbeddedPreviewFrame,
  isFileSystemAccessSupported,
  isOpfsSupported,
  isSaveFilePickerSupported,
  parseSelectedDirectoryFiles,
  pickLocalSyncDirectory,
  pickLocalSyncFile,
  pullDatabaseJsonFromMega,
  saveFallbackFolderName,
  saveLocalTargetHandle,
  saveToServerLocalDrive,
  syncDatabaseAndDailyExcelToMega,
  writeBackupToOpfs,
  writeDatabaseJsonToTarget,
  type SyncTargetHandle,
} from './lib/localBackupSync';
import {
  clearGoogleDriveSession,
  connectGoogleDrive,
  downloadBackupJsonFromGoogleDrive,
  GOOGLE_DRIVE_PRIMARY_FILENAME,
  listGoogleDriveBackups,
  subscribeGoogleDriveSession,
  uploadBackupJsonToGoogleDrive,
  type GoogleDriveFileInfo,
  type GoogleDriveSessionInfo,
} from './lib/googleDriveSync';
import { downloadFile, todayYYYYMMDD } from './lib/format';
import {
  openReportPrintTab,
  openTokenPrintTab,
  tryNativePrint,
  type PrintableReportSpec,
} from './lib/print';
import { useSpotlightTracker } from './lib/motion';
import { useCenterStore, type CenterDataState } from './lib/store';
import type { JobEntry, Lang, NavKey, SlipData, ThemeMode, WorkspaceBackup } from './types';

const LAST_LOCAL_MUTATION_KEY = 'ittc.lastLocalMutationAt';
const LAST_MEGA_REMOTE_TS_KEY = 'ittc.lastMegaRemoteTs';
const LAST_MEGA_SIGNATURE_KEY = 'ittc.lastMegaSignature';

function getLastLocalMutationAt(): number {
  try {
    const raw = localStorage.getItem(LAST_LOCAL_MUTATION_KEY);
    const num = Number(raw || 0);
    return Number.isFinite(num) ? num : 0;
  } catch {
    return 0;
  }
}

function setLastLocalMutationAt(ts: number): void {
  try {
    localStorage.setItem(LAST_LOCAL_MUTATION_KEY, String(ts));
  } catch {
    // ignore storage errors
  }
}

function getLastMegaRemoteTs(): number {
  try {
    const raw = localStorage.getItem(LAST_MEGA_REMOTE_TS_KEY);
    const num = Number(raw || 0);
    return Number.isFinite(num) ? num : 0;
  } catch {
    return 0;
  }
}

function setLastMegaRemoteTs(ts: number): void {
  try {
    localStorage.setItem(LAST_MEGA_REMOTE_TS_KEY, String(ts));
  } catch {
    // ignore storage errors
  }
}

function getLastMegaSignature(): string {
  try {
    return localStorage.getItem(LAST_MEGA_SIGNATURE_KEY) || '';
  } catch {
    return '';
  }
}

function setLastMegaSignature(sig: string): void {
  try {
    if (!sig) {
      localStorage.removeItem(LAST_MEGA_SIGNATURE_KEY);
    } else {
      localStorage.setItem(LAST_MEGA_SIGNATURE_KEY, sig);
    }
  } catch {
    // ignore storage errors
  }
}

function buildCanonicalBackupSig(backup?: Partial<WorkspaceBackup> | null): string {
  if (!backup) return '';
  const canonical = JSON.stringify({
    set: backup.set ?? {},
    students: Array.isArray(backup.students) ? backup.students : [],
    jobs: Array.isArray(backup.jobs) ? backup.jobs : [],
    outs: Array.isArray(backup.outs) ? backup.outs : [],
    staff: Array.isArray(backup.staff) ? backup.staff : [],
    staffPayments: Array.isArray(backup.staffPayments) ? backup.staffPayments : [],
    companies: Array.isArray(backup.companies) ? backup.companies : [],
    agencyContracts: Array.isArray(backup.agencyContracts) ? backup.agencyContracts : [],
    store: Array.isArray(backup.store) ? backup.store : [],
    storeLogs: Array.isArray(backup.storeLogs) ? backup.storeLogs : [],
    prices: Array.isArray(backup.prices) ? backup.prices : [],
    returns: Array.isArray(backup.returns) ? backup.returns : [],
    cash: Array.isArray(backup.cash) ? backup.cash : [],
    docs: Array.isArray(backup.docs) ? backup.docs : [],
    generalAccounts: Array.isArray(backup.generalAccounts) ? backup.generalAccounts : [],
    auditLogs: Array.isArray(backup.auditLogs) ? backup.auditLogs : [],
  });
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < canonical.length; i += 1) {
    const c = canonical.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c + (i & 255);
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `${canonical.length}:${(h1 >>> 0).toString(36)}:${(h2 >>> 0).toString(36)}`;
}

function hasBusinessRecords(data: CenterDataState): boolean {
  return (
    data.students.length > 0 ||
    data.jobs.length > 0 ||
    data.outs.length > 0 ||
    data.cash.length > 0 ||
    data.staff.length > 0 ||
    data.staffPayments.length > 0 ||
    data.companies.length > 0 ||
    data.agencyContracts.length > 0 ||
    data.returns.length > 0 ||
    data.store.length > 0 ||
    data.storeLogs.length > 0 ||
    data.docs.length > 0 ||
    data.generalAccounts.length > 0 ||
    data.prices.length > DEFAULT_PRICE_CATEGORIES.length
  );
}

function countLocalBusinessRecords(data: CenterDataState): number {
  return (
    data.students.length +
    data.jobs.length +
    data.outs.length +
    data.cash.length +
    data.staff.length +
    data.staffPayments.length +
    data.companies.length +
    data.agencyContracts.length +
    data.returns.length +
    data.store.length +
    data.storeLogs.length +
    data.docs.length +
    data.generalAccounts.length +
    Math.max(0, data.prices.length - DEFAULT_PRICE_CATEGORIES.length)
  );
}

function countBackupRecords(backup?: {
  students?: unknown[];
  jobs?: unknown[];
  outs?: unknown[];
  cash?: unknown[];
  staff?: unknown[];
  staffPayments?: unknown[];
  companies?: unknown[];
  agencyContracts?: unknown[];
  returns?: unknown[];
  store?: unknown[];
  storeLogs?: unknown[];
  prices?: unknown[];
  docs?: unknown[];
  generalAccounts?: unknown[];
} | null): number {
  if (!backup) return 0;
  const pricesLen = Array.isArray(backup.prices) ? backup.prices.length : 0;
  return (
    (Array.isArray(backup.students) ? backup.students.length : 0) +
    (Array.isArray(backup.jobs) ? backup.jobs.length : 0) +
    (Array.isArray(backup.outs) ? backup.outs.length : 0) +
    (Array.isArray(backup.cash) ? backup.cash.length : 0) +
    (Array.isArray(backup.staff) ? backup.staff.length : 0) +
    (Array.isArray(backup.staffPayments) ? backup.staffPayments.length : 0) +
    (Array.isArray(backup.companies) ? backup.companies.length : 0) +
    (Array.isArray(backup.agencyContracts) ? backup.agencyContracts.length : 0) +
    (Array.isArray(backup.returns) ? backup.returns.length : 0) +
    (Array.isArray(backup.store) ? backup.store.length : 0) +
    (Array.isArray(backup.storeLogs) ? backup.storeLogs.length : 0) +
    (Array.isArray(backup.docs) ? backup.docs.length : 0) +
    (Array.isArray(backup.generalAccounts) ? backup.generalAccounts.length : 0) +
    Math.max(0, pricesLen - DEFAULT_PRICE_CATEGORIES.length)
  );
}

function buildDataSignature(data: CenterDataState): string {
  return JSON.stringify({
    students: data.students,
    jobs: data.jobs,
    outs: data.outs,
    cash: data.cash,
    staff: data.staff,
    staffPayments: data.staffPayments,
    companies: data.companies,
    agencyContracts: data.agencyContracts,
    returns: data.returns,
    store: data.store,
    storeLogs: data.storeLogs,
    prices: data.prices,
    docs: data.docs,
    generalAccounts: data.generalAccounts,
    auditLogs: data.auditLogs,
    settings: data.settings,
  });
}

function buildJobsByDateSignatureMap(jobs: JobEntry[]): Map<string, string> {
  const grouped = new Map<string, JobEntry[]>();
  for (const j of jobs) {
    const d = String(j.date || '').trim();
    if (!d) continue;
    const list = grouped.get(d);
    if (list) list.push(j);
    else grouped.set(d, [j]);
  }
  const out = new Map<string, string>();
  for (const [d, list] of grouped.entries()) {
    out.set(d, JSON.stringify(list));
  }
  return out;
}

type MegaSyncDecision = 'pull' | 'push' | 'none';

function decideMegaSyncDirection(params: {
  mode: 'cloud' | 'local';
  localData: CenterDataState;
  remoteBackup: WorkspaceBackup | null;
  remoteModifiedAt?: string | null;
  localUserMutationTs: number;
  lastRemoteTs: number;
  lastAppliedSig: string;
  allowPush: boolean;
}): {
  decision: MegaSyncDecision;
  remoteTs: number;
  remoteSig: string;
  localSig: string;
} {
  const {
    mode,
    localData,
    remoteBackup,
    remoteModifiedAt,
    localUserMutationTs,
    lastRemoteTs,
    lastAppliedSig,
    allowPush,
  } = params;

  const localPayload = buildDatabaseJsonPayload(localData);
  const localSig = buildCanonicalBackupSig(localPayload);
  const localHasData = hasBusinessRecords(localData);
  const localCount = countLocalBusinessRecords(localData);
  const localGaCount = localData.generalAccounts.length;
  const localJobsCount = localData.jobs.length;
  const localStudentsCount = localData.students.length;

  if (!remoteBackup) {
    return {
      decision: allowPush && localHasData ? 'push' : 'none',
      remoteTs: 0,
      remoteSig: '',
      localSig,
    };
  }

  const remoteCount = countBackupRecords(remoteBackup);
  const remoteGaCount = Array.isArray(remoteBackup.generalAccounts)
    ? remoteBackup.generalAccounts.length
    : 0;
  const remoteJobsCount = Array.isArray(remoteBackup.jobs) ? remoteBackup.jobs.length : 0;
  const remoteStudentsCount = Array.isArray(remoteBackup.students)
    ? remoteBackup.students.length
    : 0;
  const remotePricesCount = Array.isArray(remoteBackup.prices) ? remoteBackup.prices.length : 0;
  const remoteHasData = remoteCount > 0 || remotePricesCount > DEFAULT_PRICE_CATEGORIES.length;
  const remoteTs =
    Date.parse(String(remoteBackup.exportedAt || remoteModifiedAt || '')) || 0;
  const remoteSig = buildCanonicalBackupSig(remoteBackup);

  if (!remoteHasData) {
    return {
      decision: allowPush && localHasData ? 'push' : 'none',
      remoteTs,
      remoteSig,
      localSig,
    };
  }

  if (
    remoteSig === localSig ||
    (lastAppliedSig && remoteSig === lastAppliedSig && localUserMutationTs === 0)
  ) {
    return { decision: 'none', remoteTs, remoteSig, localSig };
  }

  if (!localHasData) {
    return { decision: 'pull', remoteTs, remoteSig, localSig };
  }

  // Never overwrite existing General Accounts ledger data with a remote backup that has 0 rows
  if (localGaCount > 0 && remoteGaCount === 0) {
    return {
      decision: allowPush ? 'push' : 'none',
      remoteTs,
      remoteSig,
      localSig,
    };
  }

  // CRITICAL DATA-LOSS GUARD: Never automatically replace a larger local/Firestore dataset
  // with an older or smaller MEGA snapshot (e.g., after switching domains ais-dev <-> ais-pre or failed upload)
  const remoteShrinksJobs =
    localJobsCount > 0 && (remoteJobsCount === 0 || remoteJobsCount + 1 < localJobsCount);
  const remoteShrinksStudents =
    localStudentsCount > 0 &&
    (remoteStudentsCount === 0 || remoteStudentsCount + 1 < localStudentsCount);
  const remoteShrinksTotal = localCount > remoteCount + 2;

  if (
    (remoteShrinksJobs || remoteShrinksStudents || remoteShrinksTotal) &&
    (lastRemoteTs === 0 || remoteTs <= lastRemoteTs + 2000 || localUserMutationTs > 0)
  ) {
    return {
      decision: allowPush ? 'push' : 'none',
      remoteTs,
      remoteSig,
      localSig,
    };
  }

  if (localUserMutationTs === 0) {
    // Protect local/Firestore General Accounts & Jobs when local has more rows than an older/same-age MEGA snapshot
    if (
      (localGaCount > remoteGaCount || localJobsCount > remoteJobsCount) &&
      !(lastRemoteTs > 0 && remoteTs > lastRemoteTs + 1200 && !remoteShrinksJobs)
    ) {
      return {
        decision: allowPush ? 'push' : 'none',
        remoteTs,
        remoteSig,
        localSig,
      };
    }
    if (mode === 'local') {
      if (!lastAppliedSig || remoteSig !== lastAppliedSig) {
        if (
          (lastRemoteTs > 0 && remoteTs > 0 && remoteTs + 2000 < lastRemoteTs) ||
          remoteShrinksJobs ||
          remoteShrinksStudents ||
          remoteShrinksTotal
        ) {
          return { decision: allowPush ? 'push' : 'none', remoteTs, remoteSig, localSig };
        }
        return { decision: 'pull', remoteTs, remoteSig, localSig };
      }
      return { decision: 'none', remoteTs, remoteSig, localSig };
    }
    if ((localGaCount > remoteGaCount || localJobsCount > remoteJobsCount) && lastRemoteTs === 0) {
      return {
        decision: allowPush ? 'push' : 'none',
        remoteTs,
        remoteSig,
        localSig,
      };
    }
    if (
      remoteTs > lastRemoteTs + 1000 &&
      (!lastAppliedSig || remoteSig !== lastAppliedSig) &&
      !remoteShrinksJobs &&
      !remoteShrinksStudents &&
      !(localCount > remoteCount + 2)
    ) {
      return { decision: 'pull', remoteTs, remoteSig, localSig };
    }
    return { decision: 'none', remoteTs, remoteSig, localSig };
  }

  const effectiveLocalWatermark = Math.max(localUserMutationTs, lastRemoteTs);
  if (
    remoteTs > effectiveLocalWatermark + 1200 &&
    (!lastAppliedSig || remoteSig !== lastAppliedSig) &&
    !remoteShrinksJobs &&
    !remoteShrinksStudents &&
    !(localGaCount > remoteGaCount && remoteTs <= localUserMutationTs + 5000)
  ) {
    return { decision: 'pull', remoteTs, remoteSig, localSig };
  }

  if (
    allowPush &&
    (remoteTs === 0 ||
      localUserMutationTs > remoteTs + 1200 ||
      localGaCount > remoteGaCount ||
      localJobsCount > remoteJobsCount ||
      localCount > remoteCount)
  ) {
    return { decision: 'push', remoteTs, remoteSig, localSig };
  }

  return { decision: 'none', remoteTs, remoteSig, localSig };
}

class WorkspaceErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-slate-100 dark:bg-slate-950 flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-white dark:bg-slate-900 border border-red-200 dark:border-red-900 rounded-xl p-6 space-y-3">
            <h2 className="font-display text-lg font-bold text-red-600 dark:text-red-400">
              Workspace Error
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300 font-mono-num break-all">
              {this.state.error.message}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-lg bg-teal-600 text-white text-xs font-semibold cursor-pointer"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function CenterWorkspace() {
  const store = useCenterStore();
  useSpotlightTracker();

  const [lang, setLang] = useState<Lang>(() => {
    try {
      const saved = localStorage.getItem('ittc.lang');
      return saved === 'bn' ? 'bn' : 'en';
    } catch {
      return 'en';
    }
  });

  const [theme, setTheme] = useState<ThemeMode>(() => {
    try {
      const saved = localStorage.getItem('ittc.theme');
      if (saved === 'dark' || saved === 'light') return saved;
      return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });

  const [activePage, setActivePage] = useState<NavKey>('dash');
  const [generalAccountsUnlocked, setGeneralAccountsUnlocked] = useState(false);
  const [preselectedCat, setPreselectedCat] = useState<string | undefined>(undefined);
  const [inactivePreset, setInactivePreset] = useState<InactiveFilterPreset | undefined>(undefined);
  const [autoOpenStudent, setAutoOpenStudent] = useState(false);
  const [inspectStudentCode, setInspectStudentCode] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [settingsDrawerOpen, setSettingsDrawerOpen] = useState(false);
  const [uiSettings, setUiSettings] = useState<UiAppearanceSettings>(() => loadUiSettings());
  const [activeSlip, setActiveSlip] = useState<SlipData | null>(null);
  const [activeReport, setActiveReport] = useState<PrintableReportSpec | null>(null);
  const [silentPrintState, setSilentPrintState] = useState<{
    slip: SlipData;
    nonce: number;
  } | null>(null);
  const [silentReportState, setSilentReportState] = useState<{
    spec: PrintableReportSpec;
    nonce: number;
  } | null>(null);
  const [issueJobModal, setIssueJobModal] = useState<{
    open: boolean;
    cat?: string;
    studentCode?: string;
  }>({
    open: false,
  });
  const [issueResetNonce, setIssueResetNonce] = useState(0);
  const printingTokenRef = useRef(false);

  // D:\ local folder/file (File System Access API) & Mega Cloud auto-sync state
  const [localTargetHandle, setLocalTargetHandle] = useState<SyncTargetHandle | null>(null);
  const [fallbackFolderName, setFallbackFolderName] = useState<string | null>(() =>
    getSavedFallbackFolderName()
  );
  const [dirPermissionNeeded, setDirPermissionNeeded] = useState(false);
  const [serverLocalSupported, setServerLocalSupported] = useState(false);
  const [lastLocalSaveAt, setLastLocalSaveAt] = useState<string | null>(null);
  const [localAutoSync, setLocalAutoSync] = useState<boolean>(() => {
    try {
      return localStorage.getItem('ittc.localFolderAutoSync') !== 'false';
    } catch {
      return true;
    }
  });
  const [megaConfigured, setMegaConfigured] = useState(false);
  const [megaEmail, setMegaEmail] = useState<string | null>(null);
  const [megaSource, setMegaSource] = useState<'env' | 'account' | null>(null);
  const [megaAutoUpload, setMegaAutoUpload] = useState<boolean>(() => {
    try {
      return localStorage.getItem('ittc.megaAutoUpload') !== 'false';
    } catch {
      return true;
    }
  });
  const [lastMegaUploadAt, setLastMegaUploadAt] = useState<string | null>(null);
  const [megaLiveStatus, setMegaLiveStatus] = useState<'idle' | 'pending' | 'syncing' | 'synced' | 'error'>('idle');
  const megaLiveStatusRef = useRef(megaLiveStatus);
  megaLiveStatusRef.current = megaLiveStatus;
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncNotice, setSyncNotice] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [driveSession, setDriveSession] = useState<GoogleDriveSessionInfo>({
    connected: false,
    email: null,
    expiresAt: null,
  });
  const [driveFiles, setDriveFiles] = useState<GoogleDriveFileInfo[]>([]);
  const [driveBusy, setDriveBusy] = useState(false);
  const [driveLastUploadAt, setDriveLastUploadAt] = useState<string | null>(null);
  const [driveNotice, setDriveNotice] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [driveAutoUpload, setDriveAutoUpload] = useState<boolean>(() => {
    try {
      return localStorage.getItem('ittc.driveAutoUpload') === 'true';
    } catch {
      return false;
    }
  });
  const pendingPreDriveLocalBackupRef = useRef<WorkspaceBackup | null>(null);
  const driveAutoTimerRef = useRef<number | null>(null);
  const initialDataSnapshotRef = useRef<string | null>(null);
  const prevJobsByDateRef = useRef<Map<string, string>>(new Map());
  const pendingMegaJobDatesRef = useRef<Set<string>>(new Set());
  const isImportingFromMegaRef = useRef(false);
  const suppressMegaSyncUntilRef = useRef(0);
  const startupMegaPullDoneRef = useRef(false);
  const startupMegaPullInFlightRef = useRef(false);
  const megaUploadQueueCountRef = useRef(0);
  const lastFocusMegaCheckRef = useRef(0);
  const lastObservedMutationVersionRef = useRef(0);
  const mutationVersionRef = useRef(0);
  mutationVersionRef.current = store.mutationVersion;
  const rightPaneRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem('ittc.lang', lang);
    } catch {
      // ignore
    }
    document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => {
    try {
      localStorage.setItem('ittc.theme', theme);
    } catch {
      // ignore
    }
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  useEffect(() => {
    applyUiSettingsToDocument(uiSettings);
  }, [uiSettings]);

  const openDefaultIssueJobModal = useCallback(() => {
    setActiveSlip(null);
    setPreselectedCat(undefined);
    setIssueJobModal({ open: true });
    setIssueResetNonce((n) => n + 1);
  }, []);

  const issueModalOpenRef = useRef(false);
  issueModalOpenRef.current = issueJobModal.open;

  useEffect(() => {
    const onAfterPrint = () => {
      setSilentPrintState(null);
      setSilentReportState(null);
      if (printingTokenRef.current) {
        printingTokenRef.current = false;
        if (!issueModalOpenRef.current) {
          openDefaultIssueJobModal();
        }
      }
    };
    window.addEventListener('afterprint', onAfterPrint);
    return () => window.removeEventListener('afterprint', onAfterPrint);
  }, [openDefaultIssueJobModal]);

  useEffect(() => {
    let channel: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        channel = new BroadcastChannel('ittc_token_print');
        channel.onmessage = (event) => {
          if (event?.data?.type === 'TOKEN_PRINT_DONE' && !issueModalOpenRef.current) {
            openDefaultIssueJobModal();
          }
        };
      }
    } catch {
      channel = null;
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'ittc.tokenPrintDone' && e.newValue && !issueModalOpenRef.current) {
        openDefaultIssueJobModal();
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('storage', onStorage);
      channel?.close();
    };
  }, [openDefaultIssueJobModal]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [savedHandle, megaStatus, serverLocal] = await Promise.all([
        getSavedLocalTargetHandle(),
        fetchMegaSyncStatus(),
        fetchServerLocalStatus(),
      ]);
      if (!active) return;
      setMegaConfigured(megaStatus.configured);
      setMegaEmail(megaStatus.email);
      setMegaSource(megaStatus.source);
      setServerLocalSupported(serverLocal.supported);
      if (savedHandle) {
        const ok = await ensureTargetWritePermission(savedHandle, false);
        if (!active) return;
        setLocalTargetHandle(savedHandle);
        setDirPermissionNeeded(!ok);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const unsub = subscribeGoogleDriveSession((info) => {
      setDriveSession(info);
      if (!info.connected) {
        setDriveFiles([]);
      }
    });
    return () => unsub();
  }, []);

  // Protect local/MEGA records if user connects Google Drive while previously in local mode
  useEffect(() => {
    const pending = pendingPreDriveLocalBackupRef.current;
    if (!pending || store.mode !== 'cloud' || !store.cloudSnapshotsReady || store.loading) return;
    pendingPreDriveLocalBackupRef.current = null;
    if (countBackupRecords(pending) === 0) return;
    void store.importBackupData(pending, { preservePrices: true, fromRemoteSync: true }).catch(() => {
      // ignore non-fatal merge warning
    });
  }, [store]);

  const applyPulledMegaBackup = useCallback(
    async (
      remoteBackup: NonNullable<Awaited<ReturnType<typeof pullDatabaseJsonFromMega>>['remoteBackup']>,
      remoteTs: number,
      remoteSig?: string
    ) => {
      const nextSig = remoteSig || buildCanonicalBackupSig(remoteBackup);
      isImportingFromMegaRef.current = true;
      suppressMegaSyncUntilRef.current = Date.now() + 4500;
      initialDataSnapshotRef.current = null;
      pendingMegaJobDatesRef.current.clear();
      lastObservedMutationVersionRef.current = mutationVersionRef.current;
      try {
        await store.importBackupData(remoteBackup, { preservePrices: true, fromRemoteSync: true });
      } finally {
        isImportingFromMegaRef.current = false;
      }
      setLastMegaRemoteTs(remoteTs > 0 ? remoteTs : Date.now());
      setLastLocalMutationAt(0);
      if (nextSig) {
        setLastMegaSignature(nextSig);
      }
      setLastMegaUploadAt(new Date().toLocaleTimeString());
      setMegaLiveStatus('synced');
    },
    [store]
  );

  // Cross-browser startup pull: automatically sync latest MEGA backup when opening or refreshing any browser
  useEffect(() => {
    if (!megaConfigured || store.loading || store.mode === 'unauthenticated') return;
    if (store.mode === 'cloud' && !store.cloudSnapshotsReady) return;
    if (startupMegaPullDoneRef.current || startupMegaPullInFlightRef.current) return;
    startupMegaPullInFlightRef.current = true;

    let active = true;
    void (async () => {
      try {
        const pulled = await pullDatabaseJsonFromMega();
        if (!active) return;
        startupMegaPullDoneRef.current = true;

        const { decision, remoteTs, remoteSig } = decideMegaSyncDirection({
          mode: store.mode as 'cloud' | 'local',
          localData: store.data,
          remoteBackup: pulled.found && pulled.remoteBackup ? pulled.remoteBackup : null,
          remoteModifiedAt: pulled.modifiedAt,
          localUserMutationTs: Math.max(getLastLocalMutationAt(), store.localSavedAt || 0),
          lastRemoteTs: getLastMegaRemoteTs(),
          lastAppliedSig: getLastMegaSignature(),
          allowPush: Boolean(megaAutoUpload),
        });

        if (decision === 'pull' && pulled.remoteBackup) {
          await applyPulledMegaBackup(pulled.remoteBackup, remoteTs || Date.now(), remoteSig);
          setSyncNotice({
            type: 'success',
            text:
              lang === 'bn'
                ? 'Mega ক্লাউড থেকে সর্বশেষ ডেটা স্বয়ংক্রিয়ভাবে ডাউনলোড ও সিঙ্ক হয়েছে!'
                : 'Synced latest saved workspace data from Mega Cloud!',
          });
        } else if (decision === 'push' && megaAutoUpload) {
          const payload = buildDatabaseJsonPayload(store.data);
          const payloadSig = buildCanonicalBackupSig(payload);
          const payloadTs = Date.parse(payload.exportedAt || '') || Date.now();
          megaUploadQueueCountRef.current += 1;
          setMegaLiveStatus('syncing');
          try {
            const upRes = await syncDatabaseAndDailyExcelToMega(payload, '__ALL__');
            setLastMegaRemoteTs(payloadTs);
            setLastMegaSignature(payloadSig);
            setLastMegaUploadAt(
              upRes.uploadedAt
                ? new Date(upRes.uploadedAt).toLocaleTimeString()
                : new Date().toLocaleTimeString()
            );
          } finally {
            megaUploadQueueCountRef.current = Math.max(0, megaUploadQueueCountRef.current - 1);
            if (megaUploadQueueCountRef.current === 0) {
              setMegaLiveStatus('synced');
            }
          }
        } else {
          if (remoteTs > 0) setLastMegaRemoteTs(remoteTs);
          if (remoteSig) setLastMegaSignature(remoteSig);
          setMegaLiveStatus('synced');
        }
      } catch {
        // silent background check error; retryable via polling / focus / online listeners
      } finally {
        startupMegaPullInFlightRef.current = false;
      }
    })();

    return () => {
      active = false;
      startupMegaPullInFlightRef.current = false;
    };
  }, [
    megaConfigured,
    megaAutoUpload,
    store.loading,
    store.mode,
    store.cloudSnapshotsReady,
    store.data,
    store.localSavedAt,
    applyPulledMegaBackup,
    lang,
  ]);

  // Two-way auto-sync listener: poll every 15s + focus + tab visible + online reconnect to pull any remote MEGA updates
  useEffect(() => {
    if (!megaConfigured || store.loading || store.mode === 'unauthenticated') return;
    if (store.mode === 'cloud' && !store.cloudSnapshotsReady) return;

    const checkRemoteForUpdates = (forceCheck = false) => {
      if (document.visibilityState === 'hidden') return;
      if (
        syncBusy ||
        isImportingFromMegaRef.current ||
        startupMegaPullInFlightRef.current ||
        megaUploadQueueCountRef.current > 0
      ) {
        return;
      }
      if (
        megaLiveStatusRef.current === 'syncing' ||
        megaLiveStatusRef.current === 'pending' ||
        megaLiveStatusRef.current === 'error'
      ) {
        return;
      }
      const now = Date.now();
      const recentMutationTs = Math.max(getLastLocalMutationAt(), store.localSavedAt || 0);
      if (recentMutationTs > 0 && now - recentMutationTs < 15000) {
        return;
      }
      if (!forceCheck && now - lastFocusMegaCheckRef.current < 8000) return;
      lastFocusMegaCheckRef.current = now;

      void (async () => {
        try {
          const pulled = await pullDatabaseJsonFromMega();
          if (!pulled.found || !pulled.remoteBackup) return;
          if (
            isImportingFromMegaRef.current ||
            startupMegaPullInFlightRef.current ||
            megaUploadQueueCountRef.current > 0 ||
            megaLiveStatusRef.current === 'syncing' ||
            megaLiveStatusRef.current === 'pending' ||
            megaLiveStatusRef.current === 'error'
          ) {
            return;
          }

          const { decision, remoteTs, remoteSig } = decideMegaSyncDirection({
            mode: store.mode as 'cloud' | 'local',
            localData: store.data,
            remoteBackup: pulled.remoteBackup,
            remoteModifiedAt: pulled.modifiedAt,
            localUserMutationTs: Math.max(getLastLocalMutationAt(), store.localSavedAt || 0),
            lastRemoteTs: getLastMegaRemoteTs(),
            lastAppliedSig: getLastMegaSignature(),
            allowPush: false,
          });

          if (decision === 'pull') {
            await applyPulledMegaBackup(pulled.remoteBackup, remoteTs || Date.now(), remoteSig);
            setSyncNotice({
              type: 'success',
              text:
                lang === 'bn'
                  ? 'অন্য ব্রাউজারে আপডেট হওয়া নতুন তথ্য MEGA থেকে অটো-ডাউনলোড ও সিঙ্ক হয়েছে!'
                  : 'Auto-synced newer workspace updates from MEGA!',
            });
          } else {
            if (remoteTs > 0 && remoteTs > getLastMegaRemoteTs()) {
              setLastMegaRemoteTs(remoteTs);
            }
            if (remoteSig && !getLastMegaSignature()) {
              setLastMegaSignature(remoteSig);
            }
          }
        } catch {
          // ignore transient refresh error
        }
      })();
    };

    const onFocusOrVisible = () => checkRemoteForUpdates(false);
    const onOnline = () => checkRemoteForUpdates(true);
    window.addEventListener('focus', onFocusOrVisible);
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onFocusOrVisible);
    const intervalId = window.setInterval(() => checkRemoteForUpdates(true), 15000);
    return () => {
      window.removeEventListener('focus', onFocusOrVisible);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onFocusOrVisible);
      window.clearInterval(intervalId);
    };
  }, [
    megaConfigured,
    store.loading,
    store.mode,
    store.cloudSnapshotsReady,
    store.data,
    store.localSavedAt,
    syncBusy,
    applyPulledMegaBackup,
    lang,
  ]);

  const syncDataToTargets = useCallback(
    async (opts: {
      includeLocal: boolean;
      includeMega: boolean;
      dailyDates?: string[] | '__ALL__';
      showStatus?: boolean;
    }) => {
      const payload = buildDatabaseJsonPayload(store.data);
      const targetName = getLocalTargetDisplayName(localTargetHandle);

      if (opts.includeLocal) {
        const opfsSaved = await writeBackupToOpfs(payload);
        if (opfsSaved && !localTargetHandle && !serverLocalSupported) {
          setLastLocalSaveAt(new Date().toLocaleTimeString());
        }
        if (localTargetHandle) {
          const granted = await ensureTargetWritePermission(localTargetHandle, false);
          if (granted) {
            await writeDatabaseJsonToTarget(localTargetHandle, payload);
            setDirPermissionNeeded(false);
            setLastLocalSaveAt(new Date().toLocaleTimeString());
            if (opts.showStatus) {
              setSyncNotice({
                type: 'success',
                text:
                  lang === 'bn'
                    ? `${targetName} ফাইল সরাসরি পিসিতে সেভ হয়েছে!`
                    : `Saved ${targetName} directly to PC!`,
              });
            }
          } else {
            setDirPermissionNeeded(true);
            if (opts.showStatus) {
              setSyncNotice({
                type: 'error',
                text:
                  lang === 'bn'
                    ? 'পিসি ফোল্ডার লেখার অনুমতি বন্ধ আছে — "ফোল্ডার অনুমতি চালু করুন" বাটনে ক্লিক করুন।'
                    : 'Local write permission expired — click Re-grant Permission.',
              });
            }
          }
        } else if (serverLocalSupported) {
          await saveToServerLocalDrive(payload);
          setLastLocalSaveAt(new Date().toLocaleTimeString());
          if (opts.showStatus) {
            setSyncNotice({
              type: 'success',
              text:
                lang === 'bn'
                  ? 'D:\\JobTokenDatabase\\database.json ফাইল সরাসরি পিসিতে সেভ হয়েছে!'
                  : 'Saved D:\\JobTokenDatabase\\database.json directly!',
            });
          }
        } else if (opts.showStatus && opfsSaved) {
          downloadFile('database.json', JSON.stringify(payload, null, 2));
          setLastLocalSaveAt(new Date().toLocaleTimeString());
          setSyncNotice({
            type: 'success',
            text:
              lang === 'bn'
                ? `${fallbackFolderName || 'পিসি'}-এর জন্য database.json সেভ হয়েছে!`
                : `Saved database.json backup for ${fallbackFolderName || 'your PC'}!`,
          });
        }
      }

      if (opts.includeMega && megaConfigured) {
        megaUploadQueueCountRef.current += 1;
        setMegaLiveStatus('syncing');
        const payloadSig = buildCanonicalBackupSig(payload);
        const payloadTs = Date.parse(payload.exportedAt || '') || Date.now();
        try {
          const res = await syncDatabaseAndDailyExcelToMega(
            payload,
            opts.dailyDates ?? '__ALL__'
          );
          setLastMegaRemoteTs(payloadTs);
          setLastMegaSignature(payloadSig);
          setLastMegaUploadAt(
            res.uploadedAt
              ? new Date(res.uploadedAt).toLocaleTimeString()
              : new Date().toLocaleTimeString()
          );
          megaUploadQueueCountRef.current = Math.max(0, megaUploadQueueCountRef.current - 1);
          if (megaUploadQueueCountRef.current === 0) {
            setMegaLiveStatus('synced');
          }
          if (opts.showStatus) {
            const excelCount = res.excelUploaded?.length || 0;
            setSyncNotice({
              type: 'success',
              text:
                lang === 'bn'
                  ? `Mega ক্লাউডে ডেটাবেজ JSON${excelCount > 0 ? ` ও ${excelCount}টি দৈনিক Excel (.xlsx)` : ''} আপলোড হয়েছে!`
                  : `Uploaded database JSON${excelCount > 0 ? ` & ${excelCount} daily Excel (.xlsx)` : ''} to Mega Cloud!`,
            });
          }
        } catch (err) {
          megaUploadQueueCountRef.current = Math.max(0, megaUploadQueueCountRef.current - 1);
          setMegaLiveStatus('error');
          throw err;
        }
      }
    },
    [store.data, localTargetHandle, serverLocalSupported, megaConfigured, lang]
  );

  // Real-time debounced auto-save (~800ms) on D:\ folder & Mega Cloud (JSON + affected daily .xlsx files)
  useEffect(() => {
    if (store.loading || store.mode === 'unauthenticated') return;
    const signature = buildDataSignature(store.data);
    const nextJobsByDate = buildJobsByDateSignatureMap(store.data.jobs);
    const userMutatedNow = store.mutationVersion !== lastObservedMutationVersionRef.current;
    lastObservedMutationVersionRef.current = store.mutationVersion;

    if (userMutatedNow) {
      setLastLocalMutationAt(Date.now());
    }

    if (initialDataSnapshotRef.current === null) {
      initialDataSnapshotRef.current = signature;
      prevJobsByDateRef.current = nextJobsByDate;
      if (!userMutatedNow) return;
    } else if (initialDataSnapshotRef.current === signature && !userMutatedNow) {
      return;
    }

    // Detect which job dates changed so only affected Jobs_DD-MM-YYYY.xlsx files regenerate & upload
    const prevJobsMap = prevJobsByDateRef.current;
    for (const [d, val] of nextJobsByDate.entries()) {
      if (prevJobsMap.get(d) !== val) {
        pendingMegaJobDatesRef.current.add(d);
      }
    }
    for (const [d] of prevJobsMap.entries()) {
      if (!nextJobsByDate.has(d)) {
        pendingMegaJobDatesRef.current.add(d);
      }
    }

    initialDataSnapshotRef.current = signature;
    prevJobsByDateRef.current = nextJobsByDate;

    // Do not immediately re-upload data that is actively hydrating from a MEGA pull or startup pull,
    // UNLESS the user explicitly performed a mutation right now (mutationVersion incremented).
    if (
      !userMutatedNow &&
      ((store.mode === 'cloud' && !store.cloudSnapshotsReady) ||
        isImportingFromMegaRef.current ||
        startupMegaPullInFlightRef.current ||
        Date.now() < suppressMegaSyncUntilRef.current)
    ) {
      pendingMegaJobDatesRef.current.clear();
      return;
    }

    const hasLocalTarget = Boolean(
      (localTargetHandle && !dirPermissionNeeded) ||
        serverLocalSupported ||
        fallbackFolderName ||
        isOpfsSupported()
    );
    const shouldLocal = Boolean(hasLocalTarget && localAutoSync);
    const shouldMega = Boolean(megaConfigured && megaAutoUpload);
    if (!shouldLocal && !shouldMega) return;

    if (shouldMega) {
      setMegaLiveStatus('pending');
    }

    let flushed = false;
    const flushSyncNow = () => {
      if (flushed) return;
      flushed = true;
      const changedDates = Array.from(pendingMegaJobDatesRef.current);
      pendingMegaJobDatesRef.current.clear();
      void syncDataToTargets({
        includeLocal: shouldLocal,
        includeMega: shouldMega,
        dailyDates: changedDates,
      }).catch((err) => {
        setSyncNotice({
          type: 'error',
          text:
            err instanceof Error
              ? `MEGA Sync Error: ${err.message}`
              : 'Background MEGA auto-sync failed.',
        });
      });
    };

    const timer = window.setTimeout(flushSyncNow, 250);
    const onPageHide = () => {
      window.clearTimeout(timer);
      flushSyncNow();
    };
    window.addEventListener('pagehide', onPageHide);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [
    store.loading,
    store.mode,
    store.data,
    store.mutationVersion,
    localTargetHandle,
    dirPermissionNeeded,
    serverLocalSupported,
    localAutoSync,
    megaConfigured,
    megaAutoUpload,
    syncDataToTargets,
  ]);

  // Optional user-enabled Google Drive auto-backup (debounced 2.5s after mutations)
  useEffect(() => {
    if (!driveSession.connected || !driveAutoUpload || store.loading || store.mode === 'unauthenticated') {
      return;
    }
    if (store.mutationVersion === 0) return;
    if (driveAutoTimerRef.current !== null) {
      window.clearTimeout(driveAutoTimerRef.current);
    }
    driveAutoTimerRef.current = window.setTimeout(() => {
      driveAutoTimerRef.current = null;
      const payload = buildDatabaseJsonPayload(store.data);
      const existingPrimary = driveFiles.find((f) => f.name === GOOGLE_DRIVE_PRIMARY_FILENAME);
      void uploadBackupJsonToGoogleDrive(payload, {
        fileName: GOOGLE_DRIVE_PRIMARY_FILENAME,
        existingFileId: existingPrimary?.id,
      })
        .then((savedFile) => {
          setDriveLastUploadAt(new Date().toLocaleTimeString());
          setDriveFiles((prev) => {
            const without = prev.filter((f) => f.id !== savedFile.id);
            return [savedFile, ...without];
          });
        })
        .catch(() => {
          // silent background retry on next edit or manual sync
        });
    }, 2500);

    return () => {
      if (driveAutoTimerRef.current !== null) {
        window.clearTimeout(driveAutoTimerRef.current);
        driveAutoTimerRef.current = null;
      }
    };
  }, [
    driveSession.connected,
    driveAutoUpload,
    store.loading,
    store.mode,
    store.mutationVersion,
    store.data,
    driveFiles,
  ]);

  const handleAutoPrintSlip = (slip: SlipData): boolean => {
    printingTokenRef.current = true;
    flushSync(() => {
      setActiveSlip(null);
      setSilentReportState(null);
      setSilentPrintState({ slip, nonce: Date.now() });
    });
    const started = tryNativePrint();
    if (!started) {
      printingTokenRef.current = false;
      setSilentPrintState(null);
      openTokenPrintTab(slip, store.data.settings, uiSettings);
    }
    return true;
  };

  const handleBrowserPrintReport = (spec: PrintableReportSpec): boolean => {
    setActiveSlip(null);
    setSilentPrintState(null);
    setSilentReportState(null);
    openReportPrintTab(spec, store.data.settings);
    return true;
  };

  const handlePrintReport = (spec: PrintableReportSpec) => {
    setActiveSlip(null);
    setSilentPrintState(null);
    setActiveReport(null);
    openReportPrintTab(spec, store.data.settings);
  };

  if (!store.authReady) {
    return (
      <div className="min-h-screen bg-slate-100 dark:bg-slate-950 flex items-center justify-center">
        <div className="text-sm font-medium text-slate-600 dark:text-slate-400">
          Loading ITTC Center...
        </div>
      </div>
    );
  }

  const handleAuthGateMegaSignIn = async (
    email: string,
    password: string
  ): Promise<{ ok: boolean; error?: string }> => {
    setSyncBusy(true);
    setSyncNotice(null);
    try {
      const status = await connectMegaAccount(email, password);
      setMegaConfigured(status.configured);
      setMegaEmail(status.email);
      setMegaSource(status.source);
      startupMegaPullDoneRef.current = true;

      let remoteFound = Boolean(status.remoteFound && status.remoteBackup);
      let remoteBackup = status.remoteBackup || null;
      let remoteModifiedAt = status.remoteModifiedAt || null;

      if (!remoteFound) {
        try {
          const pulled = await pullDatabaseJsonFromMega();
          if (pulled.found && pulled.remoteBackup) {
            remoteFound = true;
            remoteBackup = pulled.remoteBackup;
            remoteModifiedAt = pulled.modifiedAt;
          }
        } catch {
          // ignore fallback pull check error
        }
      }

      if (remoteFound && remoteBackup) {
        const localJobsBefore = store.data.jobs.length;
        const remoteJobsCount = Array.isArray(remoteBackup.jobs) ? remoteBackup.jobs.length : 0;
        const localCountBefore = countLocalBusinessRecords(store.data);
        const remoteCount = countBackupRecords(remoteBackup);
        const localHadMore = localJobsBefore > remoteJobsCount || localCountBefore > remoteCount;

        const remoteTs =
          Date.parse(remoteBackup.exportedAt || remoteModifiedAt || '') ||
          Date.now();
        const remoteSig = buildCanonicalBackupSig(remoteBackup);
        isImportingFromMegaRef.current = true;
        suppressMegaSyncUntilRef.current = Date.now() + 4500;
        initialDataSnapshotRef.current = null;
        lastObservedMutationVersionRef.current = mutationVersionRef.current;
        try {
          store.enterLocalModeWithBackup(remoteBackup);
        } finally {
          isImportingFromMegaRef.current = false;
        }
        setLastMegaRemoteTs(remoteTs);
        setLastMegaSignature(localHadMore ? '' : remoteSig);
        setLastLocalMutationAt(localHadMore ? Date.now() : 0);
        setLastMegaUploadAt(new Date().toLocaleTimeString());
        setMegaLiveStatus(localHadMore ? 'pending' : 'synced');
        setSyncNotice({
          type: 'success',
          text:
            lang === 'bn'
              ? localHadMore
                ? `Mega (${status.email}) ও এই ব্রাউজারে থাকা অতিরিক্ত তথ্য একসাথে সংরক্ষণ করা হয়েছে!`
                : `Mega (${status.email}) থেকে সব সংরক্ষিত তথ্য অটো লোড ও সিঙ্ক হয়েছে!`
              : localHadMore
                ? `Signed in with Mega (${status.email}) and merged local records with cloud data!`
                : `Signed in with Mega (${status.email}) and auto-loaded all saved data!`,
        });
      } else {
        store.enterLocalOfflineMode();
        const payload = buildDatabaseJsonPayload(store.data);
        const payloadSig = buildCanonicalBackupSig(payload);
        const payloadTs = Date.parse(payload.exportedAt || '') || Date.now();
        const uploadRes = await syncDatabaseAndDailyExcelToMega(payload, '__ALL__');
        setLastMegaRemoteTs(payloadTs);
        setLastMegaSignature(payloadSig);
        setLastMegaUploadAt(
          uploadRes.uploadedAt
            ? new Date(uploadRes.uploadedAt).toLocaleTimeString()
            : new Date().toLocaleTimeString()
        );
        setMegaLiveStatus('synced');
      }
      return { ok: true };
    } catch (err) {
      setMegaLiveStatus('error');
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to connect MEGA account.',
      };
    } finally {
      setSyncBusy(false);
    }
  };

  if (store.mode === 'unauthenticated') {
    return (
      <AuthGate
        lang={lang}
        theme={theme}
        authError={store.authError}
        megaConnectedEmail={megaConfigured ? megaEmail : null}
        megaBusy={syncBusy}
        onToggleLang={() => setLang((l) => (l === 'bn' ? 'en' : 'bn'))}
        onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        onGoogleSignIn={store.startGoogleSignIn}
        onLocalMode={store.enterLocalOfflineMode}
        onMegaSignIn={handleAuthGateMegaSignIn}
        onContinueConnectedMega={() => {
          startupMegaPullDoneRef.current = false;
          store.enterLocalOfflineMode();
        }}
      />
    );
  }

  const navigateTo = (page: NavKey, cat?: string) => {
    if (page !== 'generalAccounts') {
      setGeneralAccountsUnlocked(false);
    }
    setPreselectedCat(cat);
    setActivePage(page);
    rightPaneRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleConnectMega = async (email: string, password: string): Promise<boolean> => {
    setSyncBusy(true);
    setSyncNotice(null);
    try {
      const status = await connectMegaAccount(email, password);
      setMegaConfigured(status.configured);
      setMegaEmail(status.email);
      setMegaSource(status.source);
      startupMegaPullDoneRef.current = true;

      let remoteFound = Boolean(status.remoteFound && status.remoteBackup);
      let remoteBackup = status.remoteBackup || null;
      let remoteModifiedAt = status.remoteModifiedAt || null;

      if (!remoteFound) {
        try {
          const pulled = await pullDatabaseJsonFromMega();
          if (pulled.found && pulled.remoteBackup) {
            remoteFound = true;
            remoteBackup = pulled.remoteBackup;
            remoteModifiedAt = pulled.modifiedAt;
          }
        } catch {
          // ignore secondary pull probe error
        }
      }

      const { decision, remoteTs, remoteSig } = decideMegaSyncDirection({
        mode: store.mode as 'cloud' | 'local',
        localData: store.data,
        remoteBackup: remoteFound && remoteBackup ? remoteBackup : null,
        remoteModifiedAt,
        localUserMutationTs: Math.max(getLastLocalMutationAt(), store.localSavedAt || 0),
        lastRemoteTs: getLastMegaRemoteTs(),
        lastAppliedSig: getLastMegaSignature(),
        allowPush: true,
      });

      if (decision === 'pull' && remoteBackup) {
        await applyPulledMegaBackup(remoteBackup, remoteTs || Date.now(), remoteSig);
        setSyncNotice({
          type: 'success',
          text:
            lang === 'bn'
              ? `Mega (${status.email}) যুক্ত হয়েছে এবং ক্লাউড থেকে সর্বশেষ ডেটা অটো-ডাউনলোড ও সিঙ্ক হয়েছে!`
              : `Connected Mega (${status.email}) and synced latest saved data from cloud!`,
        });
        return true;
      }

      if (decision === 'none' && remoteBackup && remoteSig) {
        if (remoteTs > 0) setLastMegaRemoteTs(remoteTs);
        setLastMegaSignature(remoteSig);
        setMegaLiveStatus('synced');
        setSyncNotice({
          type: 'success',
          text:
            lang === 'bn'
              ? `Mega (${status.email}) যুক্ত ও সিঙ্ক আছে!`
              : `Connected Mega (${status.email}) — workspace is up to date!`,
        });
        return true;
      }

      const payload = buildDatabaseJsonPayload(store.data);
      const payloadSig = buildCanonicalBackupSig(payload);
      const payloadTs = Date.parse(payload.exportedAt || '') || Date.now();
      const uploadRes = await syncDatabaseAndDailyExcelToMega(payload, '__ALL__');
      setLastMegaRemoteTs(payloadTs);
      setLastMegaSignature(payloadSig);
      setLastMegaUploadAt(
        uploadRes.uploadedAt
          ? new Date(uploadRes.uploadedAt).toLocaleTimeString()
          : new Date().toLocaleTimeString()
      );
      setMegaLiveStatus('synced');
      setSyncNotice({
        type: 'success',
        text:
          lang === 'bn'
            ? `Mega (${status.email}) যুক্ত হয়েছে এবং সর্বশেষ JSON ও দৈনিক Excel (.xlsx) আপলোড সম্পন্ন!`
            : `Connected Mega (${status.email}) and uploaded workspace JSON & daily Excel (.xlsx)!`,
      });
      return true;
    } catch (err) {
      setMegaLiveStatus('error');
      setSyncNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Mega connection failed.',
      });
      return false;
    } finally {
      setSyncBusy(false);
    }
  };

  const handleDisconnectMega = async () => {
    setSyncBusy(true);
    setSyncNotice(null);
    try {
      const status = await disconnectMegaAccount();
      setMegaConfigured(status.configured);
      setMegaEmail(status.email);
      setMegaSource(status.source);
      setMegaLiveStatus('idle');
      setSyncNotice({
        type: 'success',
        text: lang === 'bn' ? 'Mega অ্যাকাউন্ট বিচ্ছিন্ন করা হয়েছে।' : 'Mega account disconnected.',
      });
    } finally {
      setSyncBusy(false);
    }
  };

  const handleUploadMegaNow = async () => {
    setSyncBusy(true);
    setSyncNotice(null);
    try {
      await syncDataToTargets({
        includeLocal: false,
        includeMega: true,
        dailyDates: '__ALL__',
        showStatus: true,
      });
    } catch (err) {
      setSyncNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Mega upload failed.',
      });
    } finally {
      setSyncBusy(false);
    }
  };

  const handlePullMegaNow = async () => {
    setSyncBusy(true);
    setSyncNotice(null);
    try {
      const pulled = await pullDatabaseJsonFromMega();
      if (!pulled.found || !pulled.remoteBackup) {
        setSyncNotice({
          type: 'error',
          text:
            lang === 'bn'
              ? 'Mega ক্লাউডে এখনো কোনো সংরক্ষিত ব্যাকআপ পাওয়া যায়নি।'
              : 'No saved workspace JSON found in Mega Cloud yet.',
        });
        return;
      }
      const remoteTs =
        Date.parse(pulled.remoteBackup.exportedAt || pulled.modifiedAt || '') || Date.now();
      await applyPulledMegaBackup(pulled.remoteBackup, remoteTs);
      setSyncNotice({
        type: 'success',
        text:
          lang === 'bn'
            ? 'Mega ক্লাউড থেকে সর্বশেষ ডেটা সফলভাবে লোড ও সিঙ্ক হয়েছে!'
            : 'Latest data fetched and synced from Mega Cloud!',
      });
    } catch (err) {
      setSyncNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to pull from Mega.',
      });
    } finally {
      setSyncBusy(false);
    }
  };

  const handlePickLocalFolder = async (): Promise<boolean> => {
    setSyncNotice(null);
    if (!isFileSystemAccessSupported() || isEmbeddedPreviewFrame()) {
      return false;
    }
    try {
      const handle = await pickLocalSyncDirectory();
      await saveLocalTargetHandle(handle);
      clearFallbackFolderName();
      setFallbackFolderName(null);
      setLocalTargetHandle(handle);
      setDirPermissionNeeded(false);
      const payload = buildDatabaseJsonPayload(store.data);
      await writeDatabaseJsonToTarget(handle, payload);
      await writeBackupToOpfs(payload);
      setLastLocalSaveAt(new Date().toLocaleTimeString());
      setSyncNotice({
        type: 'success',
        text:
          lang === 'bn'
            ? `পিসি ফোল্ডার "${handle.name}/database.json" যুক্ত হয়েছে এবং অটো-সেভ চালু হয়েছে!`
            : `PC folder "${handle.name}/database.json" linked & auto-save active!`,
      });
      return true;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return true;
      const msg = err instanceof Error ? err.message : '';
      if (isEmbeddedPreviewFrame() || /sub frame|cross origin|user activation|security/i.test(msg)) {
        return false;
      }
      setSyncNotice({
        type: 'error',
        text: msg || (lang === 'bn' ? 'পিসি ফোল্ডার যুক্ত করা যায়নি।' : 'Could not link PC folder.'),
      });
      return true;
    }
  };

  const handleFallbackFolderFiles = async (files: FileList) => {
    setSyncNotice(null);
    if (!files || files.length === 0) return;
    try {
      const parsed = await parseSelectedDirectoryFiles(files);
      saveFallbackFolderName(parsed.folderName);
      setFallbackFolderName(parsed.folderName);
      let mergedMessage = '';
      if (parsed.existingBackup && countBackupRecords(parsed.existingBackup) > 0) {
        await store.importBackupData(parsed.existingBackup, {
          preservePrices: true,
          fromRemoteSync: true,
        });
        mergedMessage =
          lang === 'bn'
            ? ` (${parsed.existingBackupFileName}-এর তথ্যও নিরাপদে মার্জ হয়েছে)`
            : ` (also safely merged data from ${parsed.existingBackupFileName})`;
      }
      const payload = buildDatabaseJsonPayload(store.data);
      await writeBackupToOpfs(payload);
      downloadFile('database.json', JSON.stringify(payload, null, 2));
      setLastLocalSaveAt(new Date().toLocaleTimeString());
      setSyncNotice({
        type: 'success',
        text:
          lang === 'bn'
            ? `কম্পিউটার ফোল্ডার "${parsed.folderName}" যুক্ত হয়েছে${mergedMessage}! বর্তমান database.json ডাউনলোড হয়েছে এবং ব্রাউজার কম্পিউটার স্টোরেজে অটো-সেভ চালু আছে।`
            : `Computer folder "${parsed.folderName}" linked${mergedMessage}! database.json saved to Downloads and PC auto-save vault is active.`,
      });
    } catch (err) {
      setSyncNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not inspect selected folder.',
      });
    }
  };

  const handlePickLocalFile = async () => {
    setSyncNotice(null);
    if (!isSaveFilePickerSupported() || isEmbeddedPreviewFrame()) {
      const payload = buildDatabaseJsonPayload(store.data);
      await writeBackupToOpfs(payload);
      downloadFile(
        'Ideal Technical Training & Testing Center.json',
        JSON.stringify(payload, null, 2)
      );
      setLastLocalSaveAt(new Date().toLocaleTimeString());
      setSyncNotice({
        type: 'success',
        text:
          lang === 'bn'
            ? 'পিসিতে পূর্ণাঙ্গ ব্যাকআপ JSON ফাইল ডাউনলোড হয়েছে!'
            : 'Saved backup JSON copy to your computer Downloads.',
      });
      return;
    }
    try {
      const handle = await pickLocalSyncFile();
      await saveLocalTargetHandle(handle);
      clearFallbackFolderName();
      setFallbackFolderName(null);
      setLocalTargetHandle(handle);
      setDirPermissionNeeded(false);
      const payload = buildDatabaseJsonPayload(store.data);
      await writeDatabaseJsonToTarget(handle, payload);
      await writeBackupToOpfs(payload);
      setLastLocalSaveAt(new Date().toLocaleTimeString());
      setSyncNotice({
        type: 'success',
        text:
          lang === 'bn'
            ? `পিসির "${handle.name}" ফাইল যুক্ত হয়েছে এবং প্রতি পরিবর্তনে অটো-সেভ হবে!`
            : `PC file "${handle.name}" linked & auto-saving on every change!`,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const payload = buildDatabaseJsonPayload(store.data);
      await writeBackupToOpfs(payload);
      downloadFile(
        'Ideal Technical Training & Testing Center.json',
        JSON.stringify(payload, null, 2)
      );
      setLastLocalSaveAt(new Date().toLocaleTimeString());
      setSyncNotice({
        type: 'success',
        text:
          lang === 'bn'
            ? 'ব্যাকআপ JSON ফাইল পিসিতে ডাউনলোড সম্পন্ন হয়েছে।'
            : 'Saved backup JSON copy to your computer Downloads.',
      });
    }
  };

  const handleRegrantLocalPermission = async () => {
    if (!localTargetHandle) return;
    const ok = await ensureTargetWritePermission(localTargetHandle, true);
    if (ok) {
      setDirPermissionNeeded(false);
      const payload = buildDatabaseJsonPayload(store.data);
      await writeDatabaseJsonToTarget(localTargetHandle, payload);
      setLastLocalSaveAt(new Date().toLocaleTimeString());
      setSyncNotice({
        type: 'success',
        text:
          lang === 'bn'
            ? 'পিসি ফোল্ডারে অটো-সেভ অনুমতি পুনরায় চালু হয়েছে!'
            : 'PC folder write permission restored!',
      });
    }
  };

  const handleDisconnectLocalTarget = async () => {
    await clearSavedLocalTargetHandle();
    clearFallbackFolderName();
    setLocalTargetHandle(null);
    setFallbackFolderName(null);
    setDirPermissionNeeded(false);
    setSyncNotice({
      type: 'success',
      text: lang === 'bn' ? 'পিসি ফোল্ডার লিংক বিচ্ছিন্ন করা হয়েছে।' : 'Disconnected PC folder.',
    });
  };

  const handleSaveLocalNow = async () => {
    setSyncNotice(null);
    if (localTargetHandle || serverLocalSupported) {
      await syncDataToTargets({
        includeLocal: true,
        includeMega: false,
        showStatus: true,
      });
    } else {
      const payload = buildDatabaseJsonPayload(store.data);
      await writeBackupToOpfs(payload);
      downloadFile(
        'Ideal Technical Training & Testing Center.json',
        JSON.stringify(payload, null, 2)
      );
      setLastLocalSaveAt(new Date().toLocaleTimeString());
      setSyncNotice({
        type: 'success',
        text:
          lang === 'bn'
            ? 'পিসিতে পূর্ণাঙ্গ ব্যাকআপ JSON ফাইল সেভ হয়েছে!'
            : 'Saved complete JSON backup file to computer!',
      });
    }
  };

  const handleConnectGoogleDrive = async (): Promise<boolean> => {
    setDriveBusy(true);
    setDriveNotice(null);
    if (store.mode === 'local' && countLocalBusinessRecords(store.data) > 0) {
      pendingPreDriveLocalBackupRef.current = buildDatabaseJsonPayload(store.data);
    }
    try {
      const info = await connectGoogleDrive();
      setDriveSession(info);
      const listed = await listGoogleDriveBackups();
      setDriveFiles(listed.files);
      setDriveNotice({
        type: 'success',
        text:
          lang === 'bn'
            ? `Google Drive (${info.email || 'Google'}) যুক্ত হয়েছে! ফোল্ডার: ITTC_Backup_Database (${listed.files.length}টি ফাইল)`
            : `Connected Google Drive (${info.email || 'Google'})! Folder: ITTC_Backup_Database (${listed.files.length} files)`,
      });
      return true;
    } catch (err) {
      pendingPreDriveLocalBackupRef.current = null;
      setDriveNotice({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : lang === 'bn'
              ? 'Google Drive সংযোগ করা যায়নি।'
              : 'Could not connect Google Drive.',
      });
      return false;
    } finally {
      setDriveBusy(false);
    }
  };

  const handleRefreshGoogleDrive = async () => {
    setDriveBusy(true);
    setDriveNotice(null);
    try {
      const listed = await listGoogleDriveBackups();
      setDriveFiles(listed.files);
    } catch (err) {
      setDriveNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to list Google Drive backups.',
      });
    } finally {
      setDriveBusy(false);
    }
  };

  const handleDisconnectGoogleDrive = () => {
    clearGoogleDriveSession();
    setDriveFiles([]);
    setDriveNotice({
      type: 'success',
      text:
        lang === 'bn'
          ? 'Google Drive সেশন বিচ্ছিন্ন করা হয়েছে।'
          : 'Google Drive session disconnected.',
    });
  };

  const handleUploadToGoogleDrive = async (modeType: 'primary' | 'dailySnapshot') => {
    setDriveBusy(true);
    setDriveNotice(null);
    try {
      const payload = buildDatabaseJsonPayload(store.data);
      const fileName =
        modeType === 'dailySnapshot'
          ? `ITTC_Backup_${todayYYYYMMDD()}.json`
          : GOOGLE_DRIVE_PRIMARY_FILENAME;
      const existing = driveFiles.find((f) => f.name === fileName);
      const savedFile = await uploadBackupJsonToGoogleDrive(payload, {
        fileName,
        existingFileId: existing?.id,
      });
      setDriveLastUploadAt(new Date().toLocaleTimeString());
      const listed = await listGoogleDriveBackups();
      setDriveFiles(listed.files);
      setDriveNotice({
        type: 'success',
        text:
          lang === 'bn'
            ? `Google Drive-এ "${savedFile.name}" সফলভাবে সেভ হয়েছে!`
            : `Saved "${savedFile.name}" to Google Drive!`,
      });
    } catch (err) {
      setDriveNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Google Drive upload failed.',
      });
    } finally {
      setDriveBusy(false);
    }
  };

  const handlePreviewGoogleDriveBackup = async (
    fileId: string
  ): Promise<WorkspaceBackup | null> => {
    setDriveBusy(true);
    setDriveNotice(null);
    try {
      return await downloadBackupJsonFromGoogleDrive(fileId);
    } catch (err) {
      setDriveNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not download backup from Google Drive.',
      });
      return null;
    } finally {
      setDriveBusy(false);
    }
  };

  const handleConfirmRestoreGoogleDrive = async (backup: WorkspaceBackup, fileName: string) => {
    setDriveBusy(true);
    setDriveNotice(null);
    try {
      await store.importBackupData(backup, { preservePrices: true, fromRemoteSync: true });
      setDriveNotice({
        type: 'success',
        text:
          lang === 'bn'
            ? `Google Drive ফাইল "${fileName}" থেকে সব ডেটা নিরাপদে রিস্টোর ও মার্জ হয়েছে!`
            : `Safely restored & merged workspace data from "${fileName}"!`,
      });
    } catch (err) {
      setDriveNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Restore from Google Drive failed.',
      });
    } finally {
      setDriveBusy(false);
    }
  };

  const isFixedShellPage =
    activePage === 'dash' ||
    activePage === 'students' ||
    activePage === 'due' ||
    activePage === 'inactive' ||
    activePage === 'jobs' ||
    activePage === 'outs' ||
    activePage === 'prices' ||
    activePage === 'returns' ||
    activePage === 'monthly';

  const dueCount = store.data.students.filter(
    (s) => Math.max(0, Number(s.contract || 0) - Number(s.deposit || 0)) > 0
  ).length;
  const inactiveCount = computeStudentJobActivity(
    store.data.students,
    store.data.jobs
  ).inactiveTotalCount;

  const isIsolatedGeneralAccounts =
    !store.loading && activePage === 'generalAccounts' && generalAccountsUnlocked;

  return (
    <div className="min-h-screen lg:h-screen lg:overflow-hidden flex app-canvas-bg text-slate-900 dark:text-slate-100 print:h-auto print:overflow-visible">
      {!isIsolatedGeneralAccounts && (
        <Sidebar
          activePage={activePage}
          navOrder={store.data.settings.navOrder}
          lang={lang}
          studentCount={store.data.students.length}
          dueCount={dueCount}
          inactiveCount={inactiveCount}
          logoDataUrl={uiSettings.logoDataUrl}
          mode={store.mode}
          cloudConnected={store.cloudConnected}
          userEmail={store.user?.email}
          onSelectPage={(p) => navigateTo(p)}
          onOpenSettingsDrawer={() => setSettingsDrawerOpen((v) => !v)}
          onReorderNav={(nextOrder) => store.updateCenterSettings({ navOrder: nextOrder })}
          onLogout={store.logout}
          mobileOpen={mobileMenuOpen}
          onCloseMobile={() => setMobileMenuOpen(false)}
        />
      )}

      <div className="flex-1 min-w-0 min-h-0 flex flex-col lg:h-screen lg:overflow-hidden print:h-auto print:overflow-visible">
        {!isIsolatedGeneralAccounts && (
          <TopBar
            activePage={activePage}
            lang={lang}
            theme={theme}
            students={store.data.students}
            onQuickOpenProfile={(code) => {
              setInspectStudentCode(code);
              navigateTo('students');
            }}
            onSetLang={setLang}
            onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            onOpenMobileMenu={() => setMobileMenuOpen(true)}
            onQuickAddStudent={() => {
              setAutoOpenStudent(true);
              navigateTo('students');
            }}
            onQuickNewJob={() => setIssueJobModal({ open: true })}
          />
        )}

        <div
          ref={rightPaneRef}
          className={`flex-1 min-w-0 min-h-0 overflow-y-auto print:h-auto print:overflow-visible ${
            activePage === 'dash' ? 'no-scrollbar ' : ''
          }${isFixedShellPage ? 'lg:overflow-hidden lg:flex lg:flex-col' : ''}`}
        >
          <main
            className={`${isIsolatedGeneralAccounts ? 'p-0 w-full min-h-full' : 'p-3 sm:p-4 w-full'} ${
              isFixedShellPage ? 'lg:flex-1 lg:min-h-0 lg:flex lg:flex-col' : ''
            }`}
          >
          {store.authError && store.mode === 'cloud' && (
            <div className="mb-4 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-xs text-red-700 dark:text-red-300 flex flex-wrap items-center justify-between gap-2">
              <span className="break-all">{store.authError}</span>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="px-3 py-1.5 rounded-lg bg-red-600 text-white font-semibold cursor-pointer"
              >
                {lang === 'bn' ? 'রিলোড দিন' : 'Reload'}
              </button>
            </div>
          )}
          {store.loading ? (
            <div className="space-y-4">
              <div className="h-28 rounded-xl bg-slate-200 dark:bg-slate-800 animate-pulse" />
              <div className="grid grid-cols-2 lg:grid-cols-6 gap-3.5">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-24 rounded-xl bg-slate-200 dark:bg-slate-800 animate-pulse"
                  />
                ))}
              </div>
              <div className="h-64 rounded-xl bg-slate-200 dark:bg-slate-800 animate-pulse" />
            </div>
          ) : (
            <>
              {activePage === 'dash' && (
                <DashboardView
                  data={store.data}
                  lang={lang}
                  theme={theme}
                  appearance={uiSettings}
                  megaConfigured={megaConfigured}
                  onNavigate={navigateTo}
                  onOpenInactiveStudents={(preset) => {
                    setInactivePreset(preset);
                    navigateTo('inactive');
                  }}
                  onOpenNewJob={(cat) => setIssueJobModal({ open: true, cat })}
                  onOpenOutJob={() => navigateTo('outs')}
                  onOpenAddStudent={() => {
                    setAutoOpenStudent(true);
                    navigateTo('students');
                  }}
                  onOpenStudentProfile={(code) => {
                    setInspectStudentCode(code);
                    navigateTo('students');
                  }}
                  onOpenIssueJobForStudent={(studentCode) =>
                    setIssueJobModal({ open: true, studentCode })
                  }
                  onPrintSlip={setActiveSlip}
                  onLoadDemo={store.loadDemoData}
                  onSetTheme={setTheme}
                  onSetLang={setLang}
                  onChangeAppearance={setUiSettings}
                  onSaveAppearance={(next) => saveUiSettings(next)}
                  onResetAppearance={() => {
                    setUiSettings(DEFAULT_UI_SETTINGS);
                    saveUiSettings(DEFAULT_UI_SETTINGS);
                  }}
                  onOpenSettingsDrawer={() => setSettingsDrawerOpen(true)}
                  onAddRecord={store.addRecord}
                  onUpdateRecord={store.updateRecord}
                  onDeleteRecord={store.deleteRecord}
                  onUnlockGeneralAccounts={setGeneralAccountsUnlocked}
                  onUpdateCenterSettings={store.updateCenterSettings}
                  onLogAudit={store.logAudit}
                  onSyncMegaNow={async () => {
                    await syncDataToTargets({
                      includeLocal: false,
                      includeMega: true,
                      dailyDates: '__ALL__',
                      showStatus: true,
                    });
                  }}
                  onPullMegaNow={handlePullMegaNow}
                  onVerifyCloudSync={store.verifyCloudSync}
                />
              )}

              {activePage === 'students' && (
                <StudentsView
                  students={store.data.students}
                  jobs={store.data.jobs}
                  returns={store.data.returns}
                  companies={store.data.companies}
                  docs={store.data.docs}
                  prices={store.data.prices}
                  cash={store.data.cash}
                  auditLogs={store.data.auditLogs}
                  staff={store.data.staff}
                  lang={lang}
                  onAdd={store.addRecord}
                  onUpdate={store.updateRecord}
                  onLogAudit={store.logAudit}
                  autoOpenForm={autoOpenStudent}
                  onConsumeAutoOpen={() => setAutoOpenStudent(false)}
                  inspectStudentCode={inspectStudentCode}
                  onConsumeInspect={() => setInspectStudentCode(null)}
                  onOpenIssueJob={(studentCode) =>
                    setIssueJobModal({ open: true, studentCode })
                  }
                  onPrintSlip={setActiveSlip}
                  onPrintReport={handlePrintReport}
                />
              )}

              {activePage === 'due' && (
                <DueView
                  students={store.data.students}
                  jobs={store.data.jobs}
                  returns={store.data.returns}
                  cash={store.data.cash}
                  auditLogs={store.data.auditLogs}
                  lang={lang}
                  onUpdate={store.updateRecord}
                  onAdd={store.addRecord}
                  onLogAudit={store.logAudit}
                  onOpenProfile={(code) => {
                    setInspectStudentCode(code);
                    navigateTo('students');
                  }}
                  onPrintReport={handlePrintReport}
                />
              )}

              {activePage === 'inactive' && (
                <InactiveStudentsView
                  students={store.data.students}
                  jobs={store.data.jobs}
                  centerName={store.data.settings.name}
                  lang={lang}
                  initialFilter={inactivePreset}
                  onConsumeInitialFilter={() => setInactivePreset(undefined)}
                  onOpenProfile={(code) => {
                    setInspectStudentCode(code);
                    navigateTo('students');
                  }}
                  onOpenIssueJob={(studentCode) =>
                    setIssueJobModal({ open: true, studentCode })
                  }
                  onPrintReport={handlePrintReport}
                />
              )}

              {(activePage === 'jobs' || activePage === 'outs') && (
                <JobsView
                  mode={activePage}
                  students={store.data.students}
                  jobs={store.data.jobs}
                  outs={store.data.outs}
                  returns={store.data.returns}
                  prices={store.data.prices}
                  cash={store.data.cash}
                  auditLogs={store.data.auditLogs}
                  staff={store.data.staff}
                  lang={lang}
                  initialCategory={preselectedCat}
                  onAdd={store.addRecord}
                  onPrintSlip={setActiveSlip}
                  onPrintReport={handlePrintReport}
                  onOpenNewJob={() => setIssueJobModal({ open: true, cat: preselectedCat })}
                  onLogAudit={store.logAudit}
                  onInspectStudent={(code) => {
                    setInspectStudentCode(code);
                    navigateTo('students');
                  }}
                  megaSync={{
                    configured: megaConfigured,
                    email: megaEmail,
                    busy: syncBusy,
                    liveStatus: megaLiveStatus,
                    lastUploadAt: lastMegaUploadAt,
                    onUploadNow: async () => {
                      await syncDataToTargets({
                        includeLocal: false,
                        includeMega: true,
                        dailyDates: '__ALL__',
                        showStatus: true,
                      });
                    },
                    onPullNow: handlePullMegaNow,
                    onConnectMega: handleConnectMega,
                    onOpenSettings: () => navigateTo('settings'),
                  }}
                />
              )}

              {activePage === 'staff' && (
                <StaffView
                  staff={store.data.staff}
                  staffPayments={store.data.staffPayments}
                  lang={lang}
                  onAdd={store.addRecord}
                  onUpdate={store.updateRecord}
                  onDelete={store.deleteRecord}
                  onLogAudit={store.logAudit}
                  onPrintReport={handlePrintReport}
                />
              )}

              {activePage === 'companies' && (
                <CompaniesView
                  companies={store.data.companies}
                  agencyContracts={store.data.agencyContracts}
                  lang={lang}
                  onAdd={store.addRecord}
                  onUpdate={store.updateRecord}
                  onDelete={store.deleteRecord}
                  onLogAudit={store.logAudit}
                />
              )}

              {activePage === 'store' && (
                <StoreView
                  store={store.data.store}
                  storeLogs={store.data.storeLogs}
                  lang={lang}
                  onAdd={store.addRecord}
                  onUpdate={store.updateRecord}
                  onDelete={store.deleteRecord}
                  onLogAudit={store.logAudit}
                  onPrintReport={handlePrintReport}
                />
              )}

              {activePage === 'prices' && (
                <PricesView
                  prices={store.data.prices}
                  auditLogs={store.data.auditLogs}
                  lang={lang}
                  onAdd={store.addRecord}
                  onUpdate={store.updateRecord}
                  onDelete={store.deleteRecord}
                  onLogAudit={store.logAudit}
                />
              )}

              {activePage === 'returns' && (
                <ReturnsView
                  returns={store.data.returns}
                  jobs={store.data.jobs}
                  students={store.data.students}
                  prices={store.data.prices}
                  lang={lang}
                  onAdd={store.addRecord}
                  onDelete={store.deleteRecord}
                  onOpenStudentFile={(code) => {
                    setInspectStudentCode(code);
                    navigateTo('students');
                  }}
                  onLogAudit={store.logAudit}
                  onPrintReport={handlePrintReport}
                />
              )}

              {activePage === 'cash' && (
                <CashbookView
                  cash={store.data.cash}
                  accountsPass={store.data.settings.accountsPass}
                  lang={lang}
                  onAdd={store.addRecord}
                  onDelete={store.deleteRecord}
                  onExit={() => navigateTo('dash')}
                  onLogAudit={store.logAudit}
                  onPrintReport={handlePrintReport}
                />
              )}

              {activePage === 'generalAccounts' && (
                <GeneralAccountsView
                  rows={store.data.generalAccounts}
                  students={store.data.students}
                  centerName={store.data.settings.name}
                  generalAccountsPass={store.data.settings.generalAccountsPass}
                  lang={lang}
                  unlocked={generalAccountsUnlocked}
                  onUnlockChange={setGeneralAccountsUnlocked}
                  onAdd={store.addRecord}
                  onUpdate={store.updateRecord}
                  onDelete={store.deleteRecord}
                  onReplaceRows={store.replaceGeneralAccounts}
                  onLogAudit={store.logAudit}
                />
              )}

              {activePage === 'reports' && (
                <ReportsView
                  data={store.data}
                  lang={lang}
                  onPrintReport={handlePrintReport}
                  onOpenMonthlyReport={() => navigateTo('monthly')}
                />
              )}

              {activePage === 'monthly' && (
                <MonthlyReportView
                  jobs={store.data.jobs}
                  outs={store.data.outs}
                  prices={store.data.prices}
                  centerName={store.data.settings.name}
                  lang={lang}
                  onPrintReport={handlePrintReport}
                />
              )}

              {activePage === 'admin' && (
                <AdminView
                  data={store.data}
                  mode={store.mode}
                  userEmail={store.user?.email}
                  lang={lang}
                  onSaveSettings={store.updateCenterSettings}
                  onDeleteStudent={(studentId) => store.deleteRecord('students', studentId)}
                  onAdd={store.addRecord}
                  onImportBackup={store.importBackupData}
                  onLoadDemo={store.loadDemoData}
                  onResetWorkspace={store.resetWorkspaceData}
                  onExit={() => navigateTo('dash')}
                  onLogAudit={store.logAudit}
                  localSync={{
                    targetName: getLocalTargetDisplayName(localTargetHandle) || fallbackFolderName,
                    isFallbackFolder: Boolean(!localTargetHandle && fallbackFolderName),
                    serverLocalSupported,
                    permissionNeeded: dirPermissionNeeded,
                    autoSync: localAutoSync,
                    lastSaveAt: lastLocalSaveAt,
                    fsSupported: isFileSystemAccessSupported() && !isEmbeddedPreviewFrame(),
                    isEmbeddedFrame: isEmbeddedPreviewFrame(),
                    onToggleAutoSync: (enabled) => {
                      setLocalAutoSync(enabled);
                      try {
                        localStorage.setItem('ittc.localFolderAutoSync', String(enabled));
                      } catch {
                        // ignore
                      }
                    },
                    onPickFolder: handlePickLocalFolder,
                    onSelectFallbackFolderFiles: handleFallbackFolderFiles,
                    onPickFile: handlePickLocalFile,
                    onRegrantPermission: handleRegrantLocalPermission,
                    onDisconnect: handleDisconnectLocalTarget,
                    onSaveNow: handleSaveLocalNow,
                  }}
                  megaSync={{
                    configured: megaConfigured,
                    email: megaEmail,
                    source: megaSource,
                    autoUpload: megaAutoUpload,
                    liveStatus: megaLiveStatus,
                    lastUploadAt: lastMegaUploadAt,
                    busy: syncBusy,
                    notice: syncNotice,
                    onToggleAutoUpload: (enabled) => {
                      setMegaAutoUpload(enabled);
                      try {
                        localStorage.setItem('ittc.megaAutoUpload', String(enabled));
                      } catch {
                        // ignore
                      }
                    },
                    onConnect: handleConnectMega,
                    onDisconnect: handleDisconnectMega,
                    onUploadNow: handleUploadMegaNow,
                    onPullNow: handlePullMegaNow,
                  }}
                  googleDriveSync={{
                    connected: driveSession.connected,
                    email: driveSession.email,
                    files: driveFiles,
                    autoUpload: driveAutoUpload,
                    lastUploadAt: driveLastUploadAt,
                    busy: driveBusy,
                    notice: driveNotice,
                    onToggleAutoUpload: (enabled) => {
                      setDriveAutoUpload(enabled);
                      try {
                        localStorage.setItem('ittc.driveAutoUpload', String(enabled));
                      } catch {
                        // ignore
                      }
                    },
                    onConnect: handleConnectGoogleDrive,
                    onDisconnect: handleDisconnectGoogleDrive,
                    onRefreshFiles: handleRefreshGoogleDrive,
                    onUpload: handleUploadToGoogleDrive,
                    onPreviewRestore: handlePreviewGoogleDriveBackup,
                    onConfirmRestore: handleConfirmRestoreGoogleDrive,
                  }}
                />
              )}

              {activePage === 'settings' && (
                <SettingsView
                  lang={lang}
                  theme={theme}
                  appearance={uiSettings}
                  onChangeAppearance={setUiSettings}
                  onSaveAppearance={(next) => saveUiSettings(next)}
                  onResetAppearance={() => {
                    setUiSettings(DEFAULT_UI_SETTINGS);
                    saveUiSettings(DEFAULT_UI_SETTINGS);
                  }}
                  onSetTheme={setTheme}
                />
              )}

              {activePage === 'docs' && (
                <DocsView
                  docs={store.data.docs}
                  lang={lang}
                  mode={store.mode}
                  userEmail={store.user?.email}
                  cloudConnected={store.cloudConnected}
                  onAdd={store.addRecord}
                  onUpdate={store.updateRecord}
                  onDelete={store.deleteRecord}
                  onSync={store.verifyCloudSync}
                  onLogAudit={store.logAudit}
                />
              )}
            </>
          )}
          </main>
        </div>
      </div>

      <IssueJobModal
        open={issueJobModal.open}
        initialCategory={issueJobModal.cat}
        initialStudentCode={issueJobModal.studentCode}
        students={store.data.students}
        jobs={store.data.jobs}
        returns={store.data.returns}
        prices={store.data.prices}
        auditLogs={store.data.auditLogs}
        staff={store.data.staff}
        settings={store.data.settings}
        lang={lang}
        onClose={() => {
          setSilentPrintState(null);
          setIssueJobModal({ open: false });
        }}
        onAdd={store.addRecord}
        onLogAudit={store.logAudit}
        onPrintSlip={setActiveSlip}
        onAutoPrintSlip={handleAutoPrintSlip}
        resetNonce={issueResetNonce}
      />

      <ThermalSlipModal
        slip={activeSlip}
        settings={store.data.settings}
        appearance={uiSettings}
        lang={lang}
        onClose={() => setActiveSlip(null)}
        onPrintToken={handleAutoPrintSlip}
      />

      <CenterSettingsDrawer
        open={settingsDrawerOpen}
        lang={lang}
        settings={uiSettings}
        onChange={setUiSettings}
        onSave={(next) => saveUiSettings(next)}
        onResetAll={() => {
          setUiSettings(DEFAULT_UI_SETTINGS);
          saveUiSettings(DEFAULT_UI_SETTINGS);
        }}
        onClose={() => setSettingsDrawerOpen(false)}
      />

      <PrintReportModal
        report={activeReport}
        settings={store.data.settings}
        lang={lang}
        onClose={() => {
          setSilentReportState(null);
          setActiveReport(null);
        }}
        onBrowserPrint={(spec) => handleBrowserPrintReport(spec)}
      />

      {!activeSlip &&
        silentPrintState &&
        createPortal(
          <div id="thermal-slip-print">
            <ThermalSlipContent
              slip={silentPrintState.slip}
              settings={store.data.settings}
              appearance={uiSettings}
            />
          </div>,
          document.body
        )}

      {!activeSlip &&
        !silentPrintState &&
        silentReportState &&
        createPortal(
          <div id="report-sheet-print">
            <ReportPrintContent
              report={silentReportState.spec}
              settings={store.data.settings}
            />
          </div>,
          document.body
        )}
    </div>
  );
}

export default function App() {
  return (
    <WorkspaceErrorBoundary>
      <CenterWorkspace />
    </WorkspaceErrorBoundary>
  );
}
