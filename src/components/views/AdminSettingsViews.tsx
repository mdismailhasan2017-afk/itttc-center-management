import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  AlertTriangle,
  Check,
  Cloud,
  Database,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FolderOpen,
  HardDrive,
  History,
  KeyRound,
  Lock,
  Palette,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  Trash2,
  Unlock,
  Upload,
  UploadCloud,
  UserMinus,
  Users,
  X,
} from 'lucide-react';
import { loadUiSettings, type UiAppearanceSettings } from '../../lib/appearance';
import type { GoogleDriveFileInfo } from '../../lib/googleDriveSync';
import type { CenterDataState, SubCollectionKey } from '../../lib/store';
import { downloadFile, formatTaka, todayYYYYMMDD } from '../../lib/format';
import type { CenterSettings, Lang, Student, ThemeMode, WorkspaceBackup } from '../../types';
import { ColorGradingTokenSealStudio } from '../ColorGradingTokenSealStudio';
import { JobRecoveryModal } from '../JobRecoveryModal';

// 1. Super Admin Control Center (with Username + Custom Password Security Gate)
export function AdminView({
  data,
  mode,
  userEmail,
  lang,
  onSaveSettings,
  onDeleteStudent,
  onAdd,
  onImportBackup,
  onLoadDemo,
  onResetWorkspace,
  onExit,
  onLogAudit,
  localSync,
  megaSync,
  googleDriveSync,
}: {
  data: CenterDataState;
  mode: 'cloud' | 'local';
  userEmail?: string | null;
  lang: Lang;
  onSaveSettings: (patch: Partial<CenterSettings>) => Promise<void>;
  onDeleteStudent?: (studentId: string) => Promise<void>;
  onAdd?: (key: SubCollectionKey, raw: Record<string, unknown>, customId?: string) => Promise<string>;
  onImportBackup: (backup: WorkspaceBackup) => Promise<void>;
  onLoadDemo: () => Promise<void>;
  onResetWorkspace: () => Promise<void>;
  onExit: () => void;
  onLogAudit?: (action: string, module: string, detail: string) => Promise<void>;
  localSync?: {
    targetName: string | null;
    isFallbackFolder?: boolean;
    serverLocalSupported: boolean;
    permissionNeeded: boolean;
    autoSync: boolean;
    lastSaveAt: string | null;
    fsSupported: boolean;
    isEmbeddedFrame?: boolean;
    onToggleAutoSync: (enabled: boolean) => void;
    onPickFolder: () => Promise<boolean>;
    onSelectFallbackFolderFiles?: (files: FileList) => Promise<void>;
    onPickFile: () => Promise<void>;
    onRegrantPermission: () => Promise<void>;
    onDisconnect: () => Promise<void>;
    onSaveNow: () => Promise<void>;
  };
  megaSync?: {
    configured: boolean;
    email: string | null;
    source: 'env' | 'account' | null;
    autoUpload: boolean;
    liveStatus?: 'idle' | 'pending' | 'syncing' | 'synced' | 'error';
    lastUploadAt: string | null;
    busy: boolean;
    notice: { type: 'success' | 'error'; text: string } | null;
    onToggleAutoUpload: (enabled: boolean) => void;
    onConnect: (email: string, password: string) => Promise<boolean>;
    onDisconnect: () => Promise<void>;
    onUploadNow: () => Promise<void>;
    onPullNow: () => Promise<void>;
  };
  googleDriveSync?: {
    connected: boolean;
    email: string | null;
    files: GoogleDriveFileInfo[];
    autoUpload: boolean;
    lastUploadAt: string | null;
    busy: boolean;
    notice: { type: 'success' | 'error'; text: string } | null;
    onToggleAutoUpload: (enabled: boolean) => void;
    onConnect: () => Promise<boolean>;
    onDisconnect: () => void;
    onRefreshFiles: () => Promise<void>;
    onUpload: (modeType: 'primary' | 'dailySnapshot') => Promise<void>;
    onPreviewRestore: (fileId: string) => Promise<WorkspaceBackup | null>;
    onConfirmRestore: (backup: WorkspaceBackup, fileName: string) => Promise<void>;
  };
}) {
  const bn = lang === 'bn';
  const expectedUser = (data.settings.adminUser || 'superadmin').trim() || 'superadmin';
  const expectedPass = data.settings.adminPass || 'admin';
  const expectedAccountsPass = data.settings.accountsPass || 'admin';
  const expectedGeneralAccountsPass = data.settings.generalAccountsPass || '1234';
  const isDefaultPassword = expectedPass === 'admin' && expectedUser === 'superadmin';

  const [unlocked, setUnlocked] = useState(false);
  const [gateMode, setGateMode] = useState<'login' | 'setup'>('login');
  const [usernameInput, setUsernameInput] = useState(expectedUser);
  const [passwordInput, setPasswordInput] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [authError, setAuthError] = useState('');

  // Custom password setup fields right on Security Gate
  const [setupUser, setSetupUser] = useState(expectedUser);
  const [setupPass, setSetupPass] = useState('');
  const [setupConfirmPass, setSetupConfirmPass] = useState('');
  const [setupAccountsPass, setSetupAccountsPass] = useState(expectedAccountsPass);
  const [setupGeneralAccountsPass, setSetupGeneralAccountsPass] = useState(
    expectedGeneralAccountsPass
  );
  const [showSetupPass, setShowSetupPass] = useState(false);
  const [setupSaving, setSetupSaving] = useState(false);

  // Inside unlocked Control Center
  const [accountsPass, setAccountsPass] = useState(expectedAccountsPass);
  const [generalAccountsPass, setGeneralAccountsPass] = useState(expectedGeneralAccountsPass);
  const [adminUser, setAdminUser] = useState(expectedUser);
  const [adminPass, setAdminPass] = useState(expectedPass);
  const [showAdminPass, setShowAdminPass] = useState(false);
  const [showAccountsPass, setShowAccountsPass] = useState(false);
  const [showGeneralAccountsPass, setShowGeneralAccountsPass] = useState(false);
  const [savingCreds, setSavingCreds] = useState(false);
  const [statusNotice, setStatusNotice] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);

  // Student Profile Deletion (inside Super Admin with Permission + Password Gate)
  const [studentSearch, setStudentSearch] = useState('');
  const [deleteTargetStudent, setDeleteTargetStudent] = useState<Student | null>(null);
  const [deletePermissionChecked, setDeletePermissionChecked] = useState(false);
  const [deletePassInput, setDeletePassInput] = useState('');
  const [showDeletePass, setShowDeletePass] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [deletingStudent, setDeletingStudent] = useState(false);

  // MEGA login inside Super Admin Control Center
  const [adminMegaEmail, setAdminMegaEmail] = useState('');
  const [adminMegaPass, setAdminMegaPass] = useState('');
  const [showAdminMegaPass, setShowAdminMegaPass] = useState(false);
  const [showAllAuditLogs, setShowAllAuditLogs] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);

  // Google Drive confirmation state inside Super Admin Control Center
  const [drivePendingUploadMode, setDrivePendingUploadMode] = useState<'primary' | 'dailySnapshot' | null>(
    null
  );
  const [drivePendingRestore, setDrivePendingRestore] = useState<{
    file: GoogleDriveFileInfo;
    backup: WorkspaceBackup;
  } | null>(null);
  const pcFolderInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const input = pcFolderInputRef.current;
    if (!input) return;
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
  }, [unlocked]);

  // Keep local form values synchronized when Firestore/store settings arrive or update
  useEffect(() => {
    setUsernameInput(expectedUser);
    setSetupUser(expectedUser);
    setSetupAccountsPass(expectedAccountsPass);
    setSetupGeneralAccountsPass(expectedGeneralAccountsPass);
    setAdminUser(expectedUser);
    setAdminPass(expectedPass);
    setAccountsPass(expectedAccountsPass);
    setGeneralAccountsPass(expectedGeneralAccountsPass);
  }, [expectedUser, expectedPass, expectedAccountsPass, expectedGeneralAccountsPass]);

  const safeAuditLog = async (action: string, module: string, detail: string) => {
    try {
      await onLogAudit?.(action, module, detail);
    } catch {
      // Do not block Control Center workflow if audit write fails
    }
  };

  const handleUnlock = async (e: FormEvent) => {
    e.preventDefault();
    if (
      usernameInput.trim().toLowerCase() === expectedUser.toLowerCase() &&
      passwordInput === expectedPass
    ) {
      setUnlocked(true);
      setAuthError('');
      setPasswordInput('');
      await safeAuditLog('UNLOCK_SUPERADMIN', 'Super Admin', 'Super Admin Control Center unlocked');
    } else {
      setAuthError(
        bn
          ? 'ভুল ইউজারনেম বা পাসওয়ার্ড! আবার চেষ্টা করুন অথবা নিচের বাটন থেকে নিজের পাসওয়ার্ড সেট করুন।'
          : 'Invalid Super Admin username or password. Try again or set a custom password below.'
      );
    }
  };

  const handleGateSetPassword = async (e: FormEvent) => {
    e.preventDefault();
    setAuthError('');
    const nextUser = setupUser.trim() || 'superadmin';
    const nextPass = setupPass.trim();
    const nextAccountsPass = setupAccountsPass.trim() || expectedAccountsPass || 'admin';
    const nextGeneralAccountsPass =
      setupGeneralAccountsPass.trim() || expectedGeneralAccountsPass || '1234';

    if (!nextPass) {
      setAuthError(
        bn ? 'দয়া করে আপনার পছন্দের নতুন পাসওয়ার্ড লিখুন।' : 'Please enter your new custom password.'
      );
      return;
    }
    if (nextPass.length > 60) {
      setAuthError(
        bn ? 'পাসওয়ার্ড সর্বোচ্চ ৬০ অক্ষরের মধ্যে হতে হবে।' : 'Password must be at most 60 characters.'
      );
      return;
    }
    if (setupConfirmPass && nextPass !== setupConfirmPass.trim()) {
      setAuthError(
        bn ? 'দুই ঘরের পাসওয়ার্ড মিলছে না! ঠিক করে লিখুন।' : 'Passwords do not match. Please re-enter.'
      );
      return;
    }

    setSetupSaving(true);
    try {
      await onSaveSettings({
        adminUser: nextUser,
        adminPass: nextPass,
        accountsPass: nextAccountsPass,
        generalAccountsPass: nextGeneralAccountsPass,
      });
      await safeAuditLog(
        'SET_CUSTOM_PASSWORD',
        'Super Admin',
        `Updated custom Super Admin credentials (${nextUser})`
      );
      setSetupPass('');
      setSetupConfirmPass('');
      setGateMode('login');
      setUnlocked(true);
      setStatusNotice({
        type: 'success',
        text: bn
          ? `নতুন সুপার অ্যাডমিন ইউজারনেম (${nextUser}) ও পাসওয়ার্ড সফলভাবে সেট হয়েছে এবং কন্ট্রোল সেন্টার আনলক হয়েছে!`
          : `Custom Super Admin username (${nextUser}) & password saved and Control Center unlocked!`,
      });
    } catch (err) {
      setAuthError(
        err instanceof Error
          ? err.message
          : bn
            ? 'পাসওয়ার্ড সেভ করা যায়নি। দয়া করে আবার চেষ্টা করুন।'
            : 'Could not save custom password. Please try again.'
      );
    } finally {
      setSetupSaving(false);
    }
  };

  const handleSaveCredentials = async (e: FormEvent) => {
    e.preventDefault();
    const cleanUser = adminUser.trim();
    const cleanPass = adminPass.trim();
    const cleanAccountsPass = accountsPass.trim();
    const cleanGeneralAccountsPass = generalAccountsPass.trim();

    if (!cleanUser || !cleanPass || !cleanAccountsPass || !cleanGeneralAccountsPass) {
      setStatusNotice({
        type: 'error',
        text: bn
          ? 'ইউজারনেম এবং সব পাসওয়ার্ড খালি রাখা যাবে না।'
          : 'Username and passwords cannot be empty.',
      });
      return;
    }

    setSavingCreds(true);
    setStatusNotice(null);
    try {
      await onSaveSettings({
        accountsPass: cleanAccountsPass,
        generalAccountsPass: cleanGeneralAccountsPass,
        adminUser: cleanUser,
        adminPass: cleanPass,
      });
      await safeAuditLog(
        'UPDATE_PASSWORDS',
        'Super Admin',
        'Updated Super Admin, Cashbook, and GENERAL ACCOUNTS passwords'
      );
      setStatusNotice({
        type: 'success',
        text: bn
          ? 'সুপার অ্যাডমিন, ক্যাশবুক এবং GENERAL ACCOUNTS পাসওয়ার্ড সফলভাবে আপডেট হয়েছে!'
          : 'Super Admin, Cashbook & GENERAL ACCOUNTS credentials updated successfully!',
      });
    } catch (err) {
      setStatusNotice({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : bn
              ? 'পাসওয়ার্ড সংরক্ষণ করতে সমস্যা হয়েছে।'
              : 'Failed to save security credentials.',
      });
    } finally {
      setSavingCreds(false);
    }
  };

  const handleResetDefaultCreds = async () => {
    setSavingCreds(true);
    setStatusNotice(null);
    try {
      await onSaveSettings({
        adminUser: 'superadmin',
        adminPass: 'admin',
        accountsPass: 'admin',
        generalAccountsPass: '1234',
      });
      await safeAuditLog(
        'RESET_PASSWORDS',
        'Super Admin',
        'Reset Admin, Cashbook & GENERAL ACCOUNTS credentials to default'
      );
      setStatusNotice({
        type: 'success',
        text: bn
          ? 'ডিফল্ট ইউজারনেম (superadmin), অ্যাডমিন পাসওয়ার্ড (admin) ও GENERAL ACCOUNTS (1234) রিস্টোর হয়েছে।'
          : 'Restored default credentials (superadmin / admin, General Accounts: 1234).',
      });
    } catch (err) {
      setStatusNotice({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : bn
              ? 'রিসেট করা যায়নি।'
              : 'Failed to reset credentials.',
      });
    } finally {
      setSavingCreds(false);
    }
  };

  const filteredStudentsForDelete = data.students.filter((st) => {
    const q = studentSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      (st.name || '').toLowerCase().includes(q) ||
      (st.code || '').toLowerCase().includes(q) ||
      (st.phone || '').toLowerCase().includes(q) ||
      (st.passportNo || '').toLowerCase().includes(q) ||
      (st.trade || '').toLowerCase().includes(q)
    );
  });

  const openStudentDeleteModal = (student: Student) => {
    setDeleteTargetStudent(student);
    setDeletePermissionChecked(false);
    setDeletePassInput('');
    setShowDeletePass(false);
    setDeleteError('');
  };

  const handleConfirmDeleteStudent = async (e: FormEvent) => {
    e.preventDefault();
    if (!deleteTargetStudent || !onDeleteStudent) return;
    if (!deletePermissionChecked) {
      setDeleteError(
        bn
          ? 'প্রথমে ডিলিট করার অনুমতি (চেকবক্স) নিশ্চিত করুন।'
          : 'Please confirm permission checkbox first.'
      );
      return;
    }
    if (deletePassInput !== expectedPass) {
      setDeleteError(
        bn
          ? 'ভুল সুপার অ্যাডমিন পাসওয়ার্ড! ডিলিট করতে সঠিক পাসওয়ার্ড দিন।'
          : 'Incorrect Super Admin password! Enter the valid password to grant delete permission.'
      );
      return;
    }

    setDeletingStudent(true);
    setDeleteError('');
    try {
      const target = deleteTargetStudent;
      await onDeleteStudent(target.id);
      await safeAuditLog(
        'DELETE_STUDENT',
        'Super Admin',
        `Deleted student profile: ${target.name} (Code: ${target.code}, Phone: ${target.phone || 'N/A'})`
      );
      setDeleteTargetStudent(null);
      setDeletePassInput('');
      setDeletePermissionChecked(false);
      setStatusNotice({
        type: 'success',
        text: bn
          ? `ছাত্র "${target.name}" (${target.code})-এর প্রোফাইল স্থায়ীভাবে ডিলিট করা হয়েছে।`
          : `Student profile "${target.name}" (${target.code}) permanently deleted.`,
      });
    } catch (err) {
      setDeleteError(
        err instanceof Error
          ? err.message
          : bn
            ? 'ছাত্রের প্রোফাইল ডিলিট করতে সমস্যা হয়েছে।'
            : 'Failed to delete student profile.'
      );
    } finally {
      setDeletingStudent(false);
    }
  };

  const handleExportBackup = async () => {
    try {
      const payload: WorkspaceBackup = {
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
      downloadFile(`ittc-backup-${todayYYYYMMDD()}.json`, JSON.stringify(payload, null, 2));
      await safeAuditLog('EXPORT_BACKUP', 'Super Admin', 'Exported full workspace JSON backup');
      setStatusNotice({
        type: 'success',
        text: bn ? 'ব্যাকআপ ফাইল ডাউনলোড হয়েছে।' : 'Full JSON backup exported.',
      });
    } catch (err) {
      setStatusNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to export backup.',
      });
    }
  };

  const handleFileImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as WorkspaceBackup;
      await onImportBackup(parsed);
      await safeAuditLog('RESTORE_BACKUP', 'Super Admin', `Restored backup from ${file.name}`);
      setStatusNotice({
        type: 'success',
        text: bn
          ? 'ব্যাকআপ সফলভাবে রিস্টোর হয়েছে!'
          : 'Backup restored and synced to your workspace!',
      });
    } catch {
      setStatusNotice({
        type: 'error',
        text: bn ? 'ফাইলটি সঠিক JSON ব্যাকআপ নয়।' : 'Invalid JSON backup file.',
      });
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  };

  if (!unlocked) {
    return (
      <div className="min-h-[65vh] flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-7 shadow-lg text-center space-y-5">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-amber-500 text-white flex items-center justify-center shadow-xs">
            <ShieldAlert className="w-7 h-7" />
          </div>

          <div className="space-y-1">
            <h2 className="font-display text-xl font-extrabold text-slate-900 dark:text-white">
              Super Admin Control Center
            </h2>
            <p className="text-xs font-bold text-amber-600 dark:text-amber-400">
              {gateMode === 'setup'
                ? bn
                  ? 'নিজের ইচ্ছামতো পাসওয়ার্ড সেট করুন'
                  : 'Set Your Custom Super Admin Password'
                : bn
                  ? 'সুপার এডমিন সিকিউরিটি গেট'
                  : 'Super Admin Security Gate'}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 pt-1">
              {gateMode === 'setup'
                ? bn
                  ? 'সেন্টারের মালিক হিসেবে আপনার নিজের পছন্দের ইউজারনেম ও পাসওয়ার্ড সেট করে কন্ট্রোল সেন্টারে প্রবেশ করুন।'
                  : 'As the workspace owner, choose your preferred Super Admin username and custom password.'
                : bn
                  ? 'কন্ট্রোল সেন্টারে প্রবেশের জন্য পাসওয়ার্ড দিন, অথবা নিচের বাটন থেকে নিজের ইচ্ছামতো নতুন পাসওয়ার্ড সেট করুন।'
                  : 'Enter your Super Admin password to unlock, or set your own custom password below.'}
            </p>
          </div>

          {/* Mode Switcher */}
          <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={() => {
                setGateMode('login');
                setAuthError('');
              }}
              className={`py-2 px-3 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                gateMode === 'login'
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {bn ? 'লগইন / আনলক' : 'Unlock Login'}
            </button>
            <button
              type="button"
              onClick={() => {
                setGateMode('setup');
                setAuthError('');
              }}
              className={`py-2 px-3 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                gateMode === 'setup'
                  ? 'bg-teal-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {bn ? 'নতুন পাসওয়ার্ড সেট' : 'Set Own Password'}
            </button>
          </div>

          {gateMode === 'login' ? (
            <form onSubmit={handleUnlock} className="space-y-3.5 text-left">
              {isDefaultPassword && (
                <div className="px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/70 text-[11px] text-amber-900 dark:text-amber-200 flex items-center justify-between gap-2">
                  <span>
                    {bn
                      ? 'ডিফল্ট ইউজারনেম: superadmin · পাসওয়ার্ড: admin'
                      : 'Default Username: superadmin · Password: admin'}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setUsernameInput('superadmin');
                      setPasswordInput('admin');
                      setAuthError('');
                    }}
                    className="px-2 py-0.5 rounded bg-amber-600 hover:bg-amber-700 text-white font-bold shrink-0 cursor-pointer"
                  >
                    {bn ? 'ফিল করুন' : 'Fill'}
                  </button>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {bn ? 'সুপার এডমিন ইউজারনেম (Username)' : 'Super Admin Username'}
                </label>
                <input
                  required
                  value={usernameInput}
                  onChange={(e) => {
                    setUsernameInput(e.target.value);
                    setAuthError('');
                  }}
                  placeholder={expectedUser}
                  className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-amber-50/40 dark:bg-slate-800 font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {bn ? 'সুপার এডমিন পাসওয়ার্ড (Password)' : 'Super Admin Password'}
                </label>
                <div className="relative">
                  <input
                    type={showPass ? 'text' : 'password'}
                    required
                    value={passwordInput}
                    onChange={(e) => {
                      setPasswordInput(e.target.value);
                      setAuthError('');
                    }}
                    placeholder="••••"
                    className="w-full pl-3.5 pr-10 py-2.5 text-sm rounded-lg border-2 border-blue-500/80 dark:border-blue-500 bg-amber-50/40 dark:bg-slate-800 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass((v) => !v)}
                    aria-label={showPass ? 'Hide password' : 'Show password'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                  >
                    {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {authError && (
                  <p className="text-xs text-red-600 dark:text-red-400 mt-1.5">{authError}</p>
                )}
              </div>

              <button
                type="submit"
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold cursor-pointer"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>
                  {bn ? 'লগইন করুন (Unlock Control Center)' : 'Unlock Control Center'}
                </span>
              </button>

              <button
                type="button"
                onClick={onExit}
                className="w-full py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer"
              >
                {bn ? 'ড্যাশবোর্ডে ফিরে যান' : 'Return to Dashboard'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleGateSetPassword} className="space-y-3 text-left">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {bn ? 'সুপার অ্যাডমিন ইউজারনেম' : 'Super Admin Username'}
                </label>
                <input
                  required
                  value={setupUser}
                  onChange={(e) => {
                    setSetupUser(e.target.value);
                    setAuthError('');
                  }}
                  placeholder="superadmin"
                  className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {bn ? 'আপনার নতুন পাসওয়ার্ড লিখুন *' : 'New Custom Password *'}
                </label>
                <div className="relative">
                  <input
                    type={showSetupPass ? 'text' : 'password'}
                    required
                    value={setupPass}
                    onChange={(e) => {
                      setSetupPass(e.target.value);
                      setAuthError('');
                    }}
                    placeholder={bn ? 'নিজের পছন্দের পাসওয়ার্ড লিখুন' : 'Enter your custom password'}
                    className="w-full pl-3.5 pr-10 py-2 text-sm rounded-lg border-2 border-teal-500/80 bg-slate-50 dark:bg-slate-800 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSetupPass((v) => !v)}
                    aria-label={showSetupPass ? 'Hide password' : 'Show password'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                  >
                    {showSetupPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {bn ? 'পাসওয়ার্ড নিশ্চিত করুন (Confirm)' : 'Confirm New Password'}
                </label>
                <input
                  type={showSetupPass ? 'text' : 'password'}
                  value={setupConfirmPass}
                  onChange={(e) => {
                    setSetupConfirmPass(e.target.value);
                    setAuthError('');
                  }}
                  placeholder={bn ? 'পুনরায় একই পাসওয়ার্ড লিখুন' : 'Re-enter new password'}
                  className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    {bn ? 'ক্যাশবুক পাসওয়ার্ড' : 'Cashbook Password'}
                  </label>
                  <input
                    type={showSetupPass ? 'text' : 'password'}
                    value={setupAccountsPass}
                    onChange={(e) => setSetupAccountsPass(e.target.value)}
                    placeholder="admin"
                    className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono-num"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    {bn ? 'GENERAL ACCOUNTS পাসওয়ার্ড' : 'GENERAL ACCOUNTS Password'}
                  </label>
                  <input
                    type={showSetupPass ? 'text' : 'password'}
                    value={setupGeneralAccountsPass}
                    onChange={(e) => setSetupGeneralAccountsPass(e.target.value)}
                    placeholder="1234"
                    className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono-num"
                  />
                </div>
              </div>

              {authError && (
                <p className="text-xs text-red-600 dark:text-red-400">{authError}</p>
              )}

              <button
                type="submit"
                disabled={setupSaving}
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-lg bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white text-xs font-bold cursor-pointer"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>
                  {setupSaving
                    ? bn
                      ? 'সেভ হচ্ছে...'
                      : 'Saving...'
                    : bn
                      ? 'পাসওয়ার্ড সেভ করে আনলক করুন'
                      : 'Save Password & Unlock'}
                </span>
              </button>

              <button
                type="button"
                onClick={onExit}
                className="w-full py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer"
              >
                {bn ? 'ড্যাশবোর্ডে ফিরে যান' : 'Return to Dashboard'}
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header Bar */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
            {bn ? 'সুপার অ্যাডমিন কন্ট্রোল সেন্টার' : 'Super Admin Control Center'}
          </h2>
          <p className="text-xs text-slate-500">
            {bn
              ? 'নিজের পাসওয়ার্ড সেট ও পরিবর্তন, পূর্ণাঙ্গ ব্যাকআপ ও সিস্টেম অডিট লগ'
              : 'Custom security credentials, JSON workspace backup/restore, and system audit logs'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setUnlocked(false)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-semibold cursor-pointer"
        >
          <Unlock className="w-3.5 h-3.5 text-amber-600" />
          <span>{bn ? 'কন্ট্রোল সেন্টার লক করুন' : 'Lock Control Center'}</span>
        </button>
      </div>

      {statusNotice && (
        <div
          className={`p-3.5 rounded-xl border text-xs font-medium flex items-center justify-between gap-3 ${
            statusNotice.type === 'success'
              ? 'bg-teal-50 dark:bg-teal-950/50 border-teal-200 dark:border-teal-800 text-teal-800 dark:text-teal-200'
              : 'bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
          }`}
        >
          <span>{statusNotice.text}</span>
          <button
            type="button"
            onClick={() => setStatusNotice(null)}
            className="font-bold cursor-pointer shrink-0"
          >
            ✕
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Password Management */}
        <form
          onSubmit={handleSaveCredentials}
          className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 space-y-4"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 text-xs font-semibold">
              <KeyRound className="w-4 h-4" />
              <span>
                {bn
                  ? 'নিজের ইচ্ছামতো পাসওয়ার্ড সেট / পরিবর্তন করুন'
                  : 'Security Passwords (Super Admin & Accounts)'}
              </span>
            </div>
            <button
              type="button"
              disabled={savingCreds}
              onClick={() => void handleResetDefaultCreds()}
              className="text-[11px] font-semibold text-slate-500 hover:text-amber-600 dark:text-slate-400 dark:hover:text-amber-400 cursor-pointer"
            >
              {bn ? 'ডিফল্ট রিসেট' : 'Reset Default'}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">
                {bn ? 'সুপার অ্যাডমিন ইউজারনেম' : 'Super Admin Username'}
              </label>
              <input
                required
                value={adminUser}
                onChange={(e) => setAdminUser(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">
                {bn ? 'সুপার অ্যাডমিন পাসওয়ার্ড' : 'Super Admin Password'}
              </label>
              <div className="relative">
                <input
                  required
                  type={showAdminPass ? 'text' : 'password'}
                  value={adminPass}
                  onChange={(e) => setAdminPass(e.target.value)}
                  className="w-full pl-3 pr-9 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono-num"
                />
                <button
                  type="button"
                  onClick={() => setShowAdminPass((v) => !v)}
                  aria-label={showAdminPass ? 'Hide password' : 'Show password'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                >
                  {showAdminPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">
                {bn
                  ? 'ক্যাশবুক লক পাসওয়ার্ড (Cashbook)'
                  : 'Cashbook Lock Password'}
              </label>
              <div className="relative">
                <input
                  required
                  type={showAccountsPass ? 'text' : 'password'}
                  value={accountsPass}
                  onChange={(e) => setAccountsPass(e.target.value)}
                  className="w-full pl-3 pr-9 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono-num"
                />
                <button
                  type="button"
                  onClick={() => setShowAccountsPass((v) => !v)}
                  aria-label={showAccountsPass ? 'Hide password' : 'Show password'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                >
                  {showAccountsPass ? (
                    <EyeOff className="w-3.5 h-3.5" />
                  ) : (
                    <Eye className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1 text-emerald-700 dark:text-emerald-400">
                {bn
                  ? 'GENERAL ACCOUNTS পাসওয়ার্ড (হিসাব বিভাগ)'
                  : 'GENERAL ACCOUNTS Password'}
              </label>
              <div className="relative">
                <input
                  required
                  type={showGeneralAccountsPass ? 'text' : 'password'}
                  value={generalAccountsPass}
                  onChange={(e) => setGeneralAccountsPass(e.target.value)}
                  placeholder="1234"
                  className="w-full pl-3 pr-9 py-2 text-xs rounded-lg border border-emerald-300 dark:border-emerald-700 bg-emerald-50/40 dark:bg-slate-800 font-mono-num"
                />
                <button
                  type="button"
                  onClick={() => setShowGeneralAccountsPass((v) => !v)}
                  aria-label={showGeneralAccountsPass ? 'Hide password' : 'Show password'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                >
                  {showGeneralAccountsPass ? (
                    <EyeOff className="w-3.5 h-3.5" />
                  ) : (
                    <Eye className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={savingCreds}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer"
          >
            <Check className="w-3.5 h-3.5" />
            <span>
              {savingCreds
                ? bn
                  ? 'আপডেট হচ্ছে...'
                  : 'Saving...'
                : bn
                  ? 'পাসওয়ার্ড আপডেট করুন'
                  : 'Save Security Credentials'}
            </span>
          </button>
        </form>

        {/* Backup, Restore & Workspace Tools */}
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
          <div className="flex items-center gap-2 text-teal-700 dark:text-teal-400 text-xs font-semibold">
            <Database className="w-4 h-4" />
            <span>{bn ? 'ডেটা ব্যাকআপ, রিস্টোর ও ওয়ার্কস্পেস' : 'Backup, Restore & Workspace'}</span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            {bn
              ? `ওয়ার্কস্পেস JSON ("Ideal Technical Training & Testing Center.json") ও দৈনিক Excel সরাসরি MEGA ক্লাউডে সেভ হয়—এর জন্য ব্রাউজারের কোনো ফোল্ডার পারমিশনের প্রয়োজন নেই। পাশাপাশি ব্রাউজার থেকেই ম্যানুয়ালি JSON ডাউনলোড বা রিস্টোর করতে পারবেন${mode === 'cloud' ? ` (Firestore: ${userEmail || 'Google'})` : ''}।`
              : `Workspace JSON ("Ideal Technical Training & Testing Center.json") and daily Excel backups save directly to MEGA Cloud without needing browser folder permissions. You can also manually download or restore JSON anytime${mode === 'cloud' ? ` (Firestore: ${userEmail || 'Google'})` : ''}.`}
          </p>

          <div className="flex flex-wrap items-center gap-2.5">
            {megaSync?.configured ? (
              <>
                <button
                  type="button"
                  disabled={megaSync.busy}
                  onClick={() => void megaSync.onUploadNow()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer"
                >
                  <UploadCloud className="w-3.5 h-3.5" />
                  <span>{bn ? 'সরাসরি MEGA-তে JSON সেভ করুন' : 'Save JSON Directly to MEGA'}</span>
                </button>
                <button
                  type="button"
                  disabled={megaSync.busy}
                  onClick={() => void megaSync.onPullNow()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${megaSync.busy ? 'animate-spin' : ''}`} />
                  <span>{bn ? 'MEGA থেকে JSON রিস্টোর' : 'Restore JSON from MEGA'}</span>
                </button>
              </>
            ) : megaSync ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 text-[11px] font-semibold">
                <Cloud className="w-3.5 h-3.5" />
                {bn
                  ? 'নিচের MEGA কার্ডে লগইন করলে JSON সরাসরি MEGA-তে সেভ হবে'
                  : 'Log in to MEGA below to save Workspace JSON directly to MEGA Cloud'}
              </span>
            ) : null}

            <button
              type="button"
              onClick={() => void handleExportBackup()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-semibold cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{bn ? 'পিসিতে ডাউনলোড (JSON)' : 'Download JSON Copy'}</span>
            </button>

            <label className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-semibold cursor-pointer">
              <Upload className="w-3.5 h-3.5" />
              <span>
                {busy
                  ? bn
                    ? 'রিস্টোর হচ্ছে...'
                    : 'Restoring...'
                  : bn
                    ? 'ফাইল থেকে রিস্টোর (JSON)'
                    : 'Restore from JSON File'}
              </span>
              <input
                type="file"
                accept=".json,application/json"
                onChange={handleFileImport}
                disabled={busy}
                className="hidden"
              />
            </label>

            {onAdd && (
              <button
                type="button"
                onClick={() => setRecoveryOpen(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-900/50 text-amber-800 dark:text-amber-200 text-xs font-semibold cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{bn ? 'হারানো জব পুনরুদ্ধার (Recovery Scanner)' : 'Recover Missing Jobs'}</span>
              </button>
            )}
          </div>

          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={async () => {
                setBusy(true);
                setStatusNotice(null);
                try {
                  await onLoadDemo();
                  await safeAuditLog('LOAD_DEMO', 'Super Admin', 'Loaded sample center records');
                  setStatusNotice({
                    type: 'success',
                    text: bn ? 'নমুনা ডেটা লোড হয়েছে।' : 'Sample training data loaded.',
                  });
                } catch (err) {
                  setStatusNotice({
                    type: 'error',
                    text:
                      err instanceof Error
                        ? err.message
                        : bn
                          ? 'নমুনা ডেটা লোড করতে সমস্যা হয়েছে।'
                          : 'Failed to load sample data.',
                  });
                } finally {
                  setBusy(false);
                }
              }}
              disabled={busy}
              className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              {bn ? 'নমুনা ডেটা লোড' : 'Load Sample Data'}
            </button>

            {!confirmReset ? (
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 text-xs font-semibold cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{bn ? 'সব তথ্য মুছে ফেলুন' : 'Reset All Data'}</span>
              </button>
            ) : (
              <div className="inline-flex items-center gap-2 p-2 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-xs">
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                <span className="font-semibold text-red-700 dark:text-red-300">
                  {bn ? 'নিশ্চিত? সব মুছবে!' : 'Confirm erase all?'}
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    setBusy(true);
                    setStatusNotice(null);
                    try {
                      await onResetWorkspace();
                      setConfirmReset(false);
                      setStatusNotice({
                        type: 'success',
                        text: bn ? 'সব তথ্য রিসেট করা হয়েছে।' : 'Workspace reset completed.',
                      });
                    } catch (err) {
                      setStatusNotice({
                        type: 'error',
                        text:
                          err instanceof Error
                            ? err.message
                            : bn
                              ? 'রিসেট করতে সমস্যা হয়েছে।'
                              : 'Failed to reset workspace.',
                      });
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="px-2.5 py-1 rounded bg-red-600 text-white font-semibold cursor-pointer"
                >
                  {bn ? 'হ্যাঁ, মুছুন' : 'Erase'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 cursor-pointer"
                >
                  {bn ? 'না' : 'Cancel'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Computer Local Folder / File Auto-Save inside Super Admin */}
      {localSync && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400">
                <HardDrive className="w-4 h-4" />
              </span>
              <div>
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                  {bn
                    ? 'কম্পিউটার অটো-সেভ (পিসি ফোল্ডার ও ডাবল ব্যাকআপ)'
                    : 'Computer Auto-Save (PC Folder & Dual Backup)'}
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {bn
                    ? 'আপনার কম্পিউটারের একটি ফোল্ডার বা ফাইল যুক্ত করলে প্রতি পরিবর্তনে পিসিতে ও MEGA ক্লাউডে একসাথে অটো-সেভ হবে।'
                    : 'Link a folder or JSON file on your PC so every change auto-saves to your computer and MEGA simultaneously.'}
                </p>
              </div>
            </div>

            <span
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold ${
                localSync.targetName || localSync.serverLocalSupported
                  ? localSync.permissionNeeded
                    ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300'
                    : 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              {localSync.targetName
                ? localSync.permissionNeeded
                  ? bn
                    ? `অনুমতি প্রয়োজন (${localSync.targetName})`
                    : `Permission Needed (${localSync.targetName})`
                  : bn
                    ? `সংযুক্ত: ${localSync.targetName}`
                    : `Linked: ${localSync.targetName}`
                : localSync.serverLocalSupported
                  ? 'D:\\JobTokenDatabase\\database.json'
                  : bn
                    ? 'পিসি ফোল্ডার যুক্ত নেই'
                    : 'No PC Folder Linked'}
            </span>
          </div>

          <input
            ref={pcFolderInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = e.target.files;
              if (files && files.length > 0) {
                void localSync.onSelectFallbackFolderFiles?.(files);
              }
              e.target.value = '';
            }}
          />

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                if (localSync.fsSupported) {
                  void (async () => {
                    const handled = await localSync.onPickFolder();
                    if (!handled) {
                      pcFolderInputRef.current?.click();
                    }
                  })();
                } else {
                  pcFolderInputRef.current?.click();
                }
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>{bn ? 'পিসির ফোল্ডার সিলেক্ট করুন' : 'Select PC Folder'}</span>
            </button>

            <button
              type="button"
              onClick={() => void localSync.onPickFile()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-semibold cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{bn ? 'পিসির JSON ফাইল সিলেক্ট / ডাউনলোড' : 'Select / Save PC JSON File'}</span>
            </button>

            {localSync.permissionNeeded && localSync.targetName && (
              <button
                type="button"
                onClick={() => void localSync.onRegrantPermission()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>{bn ? 'ফোল্ডার অনুমতি চালু করুন' : 'Re-grant Permission'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => void localSync.onSaveNow()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold cursor-pointer"
            >
              <Database className="w-3.5 h-3.5" />
              <span>{bn ? 'এখনই পিসিতে সেভ করুন' : 'Save to PC Now'}</span>
            </button>

            {localSync.isEmbeddedFrame && typeof window !== 'undefined' && (
              <a
                href={window.location.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 text-xs font-semibold"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>{bn ? 'নতুন ট্যাবে খুলুন (অটো ওভাররাইট)' : 'Open Standalone Tab (Direct Write)'}</span>
              </a>
            )}

            {localSync.targetName && (
              <button
                type="button"
                onClick={() => void localSync.onDisconnect()}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 text-xs font-semibold cursor-pointer ml-auto"
              >
                <span>{bn ? 'ফোল্ডার বিচ্ছিন্ন করুন' : 'Unlink PC Folder'}</span>
              </button>
            )}
          </div>

          {localSync.isFallbackFolder && localSync.targetName && (
            <div className="text-[11px] rounded-lg px-3 py-2 bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/60 text-emerald-800 dark:text-emerald-300">
              {bn
                ? `ফোল্ডার "${localSync.targetName}" যুক্ত আছে এবং প্রতিটি পরিবর্তন কম্পিউটারের অফলাইন ভল্টে অটো-সেভ হচ্ছে। সরাসরি ফোল্ডারের ভিতরে অটো-ওভাররাইট করতে চাইলে Chrome/Edge-এ উপরের "নতুন ট্যাবে খুলুন" বাটন থেকে ব্যবহার করুন।`
                : `Folder "${localSync.targetName}" is linked and changes auto-save to your computer's offline vault. For silent direct disk overwriting inside that folder, use Chrome/Edge in a standalone tab.`}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
            <label className="inline-flex items-center gap-2 text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={localSync.autoSync}
                onChange={(e) => localSync.onToggleAutoSync(e.target.checked)}
                className="rounded border-slate-300 text-emerald-600"
              />
              <span>
                {bn
                  ? 'প্রতিটি হিসাব ও জব পরিবর্তনে কম্পিউটারে অটো-সেভ চালু রাখুন'
                  : 'Auto-save to computer on every change'}
              </span>
            </label>
            {localSync.lastSaveAt && (
              <span className="text-[11px] font-mono-num text-emerald-600 dark:text-emerald-400">
                {bn ? 'পিসিতে শেষ সেভ:' : 'Last PC save:'} {localSync.lastSaveAt}
              </span>
            )}
          </div>

          {megaSync?.notice &&
            /(pc|folder|database\.json|পিসি|ফোল্ডার|কম্পিউটার|ডাউনলোড)/i.test(
              megaSync.notice.text
            ) && (
              <div
                className={`text-xs font-medium rounded-lg px-3 py-2 border ${
                  megaSync.notice.type === 'error'
                    ? 'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800'
                    : 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800'
                }`}
              >
                {megaSync.notice.text}
              </div>
            )}
        </div>
      )}

      {/* MEGA Cloud Login & Real-Time Sync inside Super Admin Control Center */}
      {megaSync && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
                <Cloud className="w-4 h-4" />
              </span>
              <div>
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                  {bn ? 'MEGA ক্লাউড লগইন ও রিয়েল-টাইম সিঙ্ক' : 'MEGA Cloud Login & Real-Time Sync'}
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {bn
                    ? 'সুপার অ্যাডমিন প্যানেল থেকেই আপনার MEGA অ্যাকাউন্ট লগইন, অটো-আপলোড ও ক্রস-ব্রাউজার ডেটা সিঙ্ক নিয়ন্ত্রণ করুন।'
                    : 'Sign in with your MEGA account directly from Super Admin to manage real-time backup and cross-browser sync.'}
                </p>
              </div>
            </div>

            <span
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold ${
                megaSync.configured
                  ? 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300'
                  : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              {megaSync.configured
                ? bn
                  ? `সংযুক্ত (${megaSync.email || 'MEGA'})`
                  : `Connected (${megaSync.email || 'MEGA'})`
                : bn
                  ? 'লগইন করা নেই'
                  : 'Not Logged In'}
            </span>
          </div>

          {megaSync.configured ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  disabled={megaSync.busy}
                  onClick={() => void megaSync.onUploadNow()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
                >
                  <UploadCloud className="w-3.5 h-3.5" />
                  <span>{bn ? 'এখনই MEGA-তে আপলোড দিন' : 'Upload All to MEGA Now'}</span>
                </button>

                <button
                  type="button"
                  disabled={megaSync.busy}
                  onClick={() => void megaSync.onPullNow()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${megaSync.busy ? 'animate-spin' : ''}`} />
                  <span>{bn ? 'MEGA থেকে সর্বশেষ ডেটা আনুন' : 'Pull Latest from MEGA'}</span>
                </button>

                {megaSync.source !== 'env' && (
                  <button
                    type="button"
                    disabled={megaSync.busy}
                    onClick={() => void megaSync.onDisconnect()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 text-xs font-semibold cursor-pointer ml-auto"
                  >
                    <span>{bn ? 'MEGA লগআউট' : 'Disconnect MEGA'}</span>
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
                <label className="inline-flex items-center gap-2 text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={megaSync.autoUpload}
                    onChange={(e) => megaSync.onToggleAutoUpload(e.target.checked)}
                    className="rounded border-slate-300 text-indigo-600"
                  />
                  <span>
                    {bn
                      ? 'প্রতিটি পরিবর্তনে রিয়েল-টাইম অটো MEGA আপলোড (JSON + দৈনিক Excel)'
                      : 'Real-time auto MEGA upload on every change (JSON + daily Excel)'}
                  </span>
                </label>

                <div className="flex items-center gap-2 text-[11px] font-mono-num text-slate-500">
                  {megaSync.liveStatus && megaSync.liveStatus !== 'idle' && (
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-semibold ${
                        megaSync.liveStatus === 'syncing' || megaSync.liveStatus === 'pending'
                          ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300'
                          : megaSync.liveStatus === 'error'
                            ? 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300'
                            : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                      }`}
                    >
                      {megaSync.liveStatus === 'syncing'
                        ? bn
                          ? 'আপলোড হচ্ছে...'
                          : 'Syncing...'
                        : megaSync.liveStatus === 'pending'
                          ? bn
                            ? 'কিউ করা হয়েছে...'
                            : 'Queued...'
                          : megaSync.liveStatus === 'error'
                            ? bn
                              ? 'সিঙ্ক ত্রুটি'
                              : 'Sync Error'
                            : bn
                              ? 'রিয়েল-টাইম সিঙ্কড'
                              : 'Live Synced'}
                    </span>
                  )}
                  {megaSync.lastUploadAt && (
                    <span>
                      {bn ? 'শেষ সিঙ্ক:' : 'Last sync:'} {megaSync.lastUploadAt}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const ok = await megaSync.onConnect(adminMegaEmail.trim(), adminMegaPass);
                if (ok) {
                  setAdminMegaPass('');
                  await safeAuditLog(
                    'CONNECT_MEGA',
                    'Super Admin',
                    `Connected MEGA account (${adminMegaEmail.trim()})`
                  );
                }
              }}
              className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end"
            >
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  {bn ? 'MEGA ইমেইল *' : 'MEGA Email *'}
                </label>
                <input
                  type="email"
                  required
                  value={adminMegaEmail}
                  onChange={(e) => setAdminMegaEmail(e.target.value)}
                  placeholder="your-mega-email@gmail.com"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  {bn ? 'MEGA পাসওয়ার্ড *' : 'MEGA Password *'}
                </label>
                <div className="relative">
                  <input
                    type={showAdminMegaPass ? 'text' : 'password'}
                    required
                    value={adminMegaPass}
                    onChange={(e) => setAdminMegaPass(e.target.value)}
                    placeholder={bn ? 'MEGA পাসওয়ার্ড লিখুন' : 'Enter MEGA password'}
                    className="w-full pl-3 pr-9 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                  />
                  <button
                    type="button"
                    onClick={() => setShowAdminMegaPass((v) => !v)}
                    aria-label={showAdminMegaPass ? 'Hide password' : 'Show password'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    {showAdminMegaPass ? (
                      <EyeOff className="w-3.5 h-3.5" />
                    ) : (
                      <Eye className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>

              <div>
                <button
                  type="submit"
                  disabled={megaSync.busy}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer"
                >
                  <UploadCloud className="w-3.5 h-3.5" />
                  <span>
                    {megaSync.busy
                      ? bn
                        ? 'লগইন হচ্ছে...'
                        : 'Connecting...'
                      : bn
                        ? 'MEGA লগইন ও সিঙ্ক'
                        : 'Login to MEGA & Sync'}
                  </span>
                </button>
              </div>
            </form>
          )}

          {megaSync.notice && (
            <div
              className={`text-xs font-medium rounded-lg px-3 py-2 border ${
                megaSync.notice.type === 'error'
                  ? 'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800'
                  : 'text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/40 border-teal-200 dark:border-teal-800'
              }`}
            >
              {megaSync.notice.text}
            </div>
          )}
        </div>
      )}

      {/* GOOGLE DRIVE Backup & Restore inside Super Admin (directly below MEGA Cloud) */}
      {googleDriveSync && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="p-2 rounded-lg bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400">
                <Cloud className="w-4 h-4" />
              </span>
              <div>
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                  {bn ? 'GOOGLE DRIVE ক্লাউড ব্যাকআপ ও সিঙ্ক' : 'GOOGLE DRIVE Cloud Backup & Sync'}
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {bn
                    ? 'আপনার অনুমতিক্রমে সেন্টারের পূর্ণাঙ্গ ব্যাকআপ JSON সরাসরি Google Drive (ITTC_Backup_Database ফোল্ডার)-এ সেভ ও রিস্টোর করুন।'
                    : 'With your permission, save and restore full center backups directly in your Google Drive (ITTC_Backup_Database folder).'}
                </p>
              </div>
            </div>

            <span
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold ${
                googleDriveSync.connected
                  ? 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300'
                  : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              {googleDriveSync.connected
                ? bn
                  ? `সংযুক্ত (${googleDriveSync.email || 'Google Drive'})`
                  : `Connected (${googleDriveSync.email || 'Google Drive'})`
                : bn
                  ? 'সংযুক্ত নেই'
                  : 'Not Connected'}
            </span>
          </div>

          {!googleDriveSync.connected ? (
            <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-sky-50/70 dark:bg-sky-950/25 border border-sky-200 dark:border-sky-900/60">
              <p className="text-xs text-slate-700 dark:text-slate-300 max-w-2xl">
                {bn
                  ? 'কম্পিউটার এবং MEGA ক্লাউডের পাশাপাশি Google Drive-এও নিরাপদ ব্যাকআপ রাখতে "Google Drive যুক্ত করুন" বাটনে ক্লিক করে অনুমতি দিন।'
                  : 'Connect your Google account to back up and restore your workspace JSON files inside your own Google Drive alongside PC and MEGA.'}
              </p>
              <button
                type="button"
                disabled={googleDriveSync.busy}
                onClick={async () => {
                  const ok = await googleDriveSync.onConnect();
                  if (ok) {
                    await safeAuditLog('CONNECT_GOOGLE_DRIVE', 'Super Admin', 'Connected Google Drive backup');
                  }
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer shrink-0"
              >
                <UploadCloud className="w-3.5 h-3.5" />
                <span>
                  {googleDriveSync.busy
                    ? bn
                      ? 'সংযোগ হচ্ছে...'
                      : 'Connecting...'
                    : bn
                      ? 'Google Drive যুক্ত করুন'
                      : 'Connect Google Drive'}
                </span>
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  disabled={googleDriveSync.busy}
                  onClick={() => {
                    setDrivePendingRestore(null);
                    setDrivePendingUploadMode('primary');
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
                >
                  <UploadCloud className="w-3.5 h-3.5" />
                  <span>
                    {bn ? 'এখনই Google Drive-এ সেভ করুন' : 'Save Backup to Google Drive'}
                  </span>
                </button>

                <button
                  type="button"
                  disabled={googleDriveSync.busy}
                  onClick={() => {
                    setDrivePendingRestore(null);
                    setDrivePendingUploadMode('dailySnapshot');
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
                >
                  <Database className="w-3.5 h-3.5" />
                  <span>
                    {bn
                      ? `আজকের তারিখ ব্যাকআপ (${todayYYYYMMDD()})`
                      : `Save Daily Snapshot (${todayYYYYMMDD()})`}
                  </span>
                </button>

                <button
                  type="button"
                  disabled={googleDriveSync.busy}
                  onClick={() => void googleDriveSync.onRefreshFiles()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-semibold cursor-pointer disabled:opacity-60"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${googleDriveSync.busy ? 'animate-spin' : ''}`} />
                  <span>{bn ? 'তালিকা রিফ্রেশ' : 'Refresh Files'}</span>
                </button>

                <button
                  type="button"
                  disabled={googleDriveSync.busy}
                  onClick={() => {
                    setDrivePendingUploadMode(null);
                    setDrivePendingRestore(null);
                    googleDriveSync.onDisconnect();
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 text-xs font-semibold cursor-pointer ml-auto"
                >
                  <span>{bn ? 'Google Drive বিচ্ছিন্ন' : 'Disconnect Drive'}</span>
                </button>
              </div>

              {/* Explicit Confirmation Box Before Uploading / Updating Drive File */}
              {drivePendingUploadMode && (
                <div className="p-3.5 rounded-xl bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="space-y-0.5">
                    <div className="font-bold text-sky-900 dark:text-sky-100">
                      {bn
                        ? 'Google Drive-এ ব্যাকআপ আপলোড নিশ্চিত করুন'
                        : 'Confirm Upload to Google Drive'}
                    </div>
                    <div className="text-[11px] text-sky-800 dark:text-sky-300">
                      {drivePendingUploadMode === 'dailySnapshot'
                        ? bn
                          ? `ফাইল: ITTC_Backup_${todayYYYYMMDD()}.json (${data.jobs.length} জব, ${data.students.length} ছাত্র, ${data.generalAccounts.length} সাধারণ হিসাব)`
                          : `File: ITTC_Backup_${todayYYYYMMDD()}.json (${data.jobs.length} jobs, ${data.students.length} students, ${data.generalAccounts.length} general ledger rows)`
                        : bn
                          ? `ফাইল: Ideal Technical Training & Testing Center.json (বিদ্যমান ফাইল থাকলে আপডেট হবে)`
                          : `File: Ideal Technical Training & Testing Center.json (updates existing Drive file if present)`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={googleDriveSync.busy}
                      onClick={async () => {
                        const m = drivePendingUploadMode;
                        setDrivePendingUploadMode(null);
                        await googleDriveSync.onUpload(m);
                        await safeAuditLog(
                          'UPLOAD_GOOGLE_DRIVE',
                          'Super Admin',
                          `Saved ${m} workspace backup to Google Drive`
                        );
                      }}
                      className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-semibold cursor-pointer"
                    >
                      {bn ? 'হ্যাঁ, Drive-এ সেভ করুন' : 'Confirm Save'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDrivePendingUploadMode(null)}
                      className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-semibold cursor-pointer"
                    >
                      {bn ? 'বাতিল' : 'Cancel'}
                    </button>
                  </div>
                </div>
              )}

              {/* Explicit Confirmation Box Before Restoring from Drive File */}
              {drivePendingRestore && (
                <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="space-y-0.5">
                    <div className="font-bold text-amber-900 dark:text-amber-100">
                      {bn
                        ? `Google Drive থেকে রিস্টোর নিশ্চিত করুন: ${drivePendingRestore.file.name}`
                        : `Confirm Restore from Google Drive: ${drivePendingRestore.file.name}`}
                    </div>
                    <div className="text-[11px] text-amber-800 dark:text-amber-300 font-mono-num">
                      {bn
                        ? `ব্যাকআপে পাওয়া গেছে — ছাত্র: ${drivePendingRestore.backup.students?.length || 0}, জব: ${drivePendingRestore.backup.jobs?.length || 0}, সাধারণ হিসাব: ${drivePendingRestore.backup.generalAccounts?.length || 0}`
                        : `Found in backup — Students: ${drivePendingRestore.backup.students?.length || 0}, Jobs: ${drivePendingRestore.backup.jobs?.length || 0}, General Accounts: ${drivePendingRestore.backup.generalAccounts?.length || 0}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={googleDriveSync.busy}
                      onClick={async () => {
                        const pending = drivePendingRestore;
                        setDrivePendingRestore(null);
                        await googleDriveSync.onConfirmRestore(pending.backup, pending.file.name);
                        await safeAuditLog(
                          'RESTORE_GOOGLE_DRIVE',
                          'Super Admin',
                          `Restored workspace from Google Drive (${pending.file.name})`
                        );
                      }}
                      className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold cursor-pointer"
                    >
                      {bn ? 'হ্যাঁ, রিস্টোর করুন' : 'Confirm Restore'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDrivePendingRestore(null)}
                      className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-semibold cursor-pointer"
                    >
                      {bn ? 'বাতিল' : 'Cancel'}
                    </button>
                  </div>
                </div>
              )}

              {/* Saved Drive Files List */}
              {googleDriveSync.files.length > 0 && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                  <div className="px-3.5 py-2 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                    {bn
                      ? `Google Drive ফোল্ডার: ITTC_Backup_Database (${googleDriveSync.files.length}টি ফাইল)`
                      : `Google Drive Folder: ITTC_Backup_Database (${googleDriveSync.files.length} files)`}
                  </div>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-44 overflow-y-auto">
                    {googleDriveSync.files.map((file) => (
                      <div
                        key={file.id}
                        className="px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 text-xs hover:bg-slate-50 dark:hover:bg-slate-800/40"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-800 dark:text-slate-100 truncate">
                            {file.name}
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono-num">
                            {file.modifiedTime
                              ? new Date(file.modifiedTime).toLocaleString()
                              : 'Saved in Drive'}
                            {file.size ? ` · ${Math.max(1, Math.round(Number(file.size) / 1024))} KB` : ''}
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={googleDriveSync.busy}
                          onClick={async () => {
                            setDrivePendingUploadMode(null);
                            const preview = await googleDriveSync.onPreviewRestore(file.id);
                            if (preview) {
                              setDrivePendingRestore({ file, backup: preview });
                            }
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 hover:bg-teal-600 hover:text-white text-[11px] font-semibold cursor-pointer"
                        >
                          <Download className="w-3 h-3" />
                          <span>{bn ? 'রিস্টোর করুন' : 'Restore'}</span>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
                <label className="inline-flex items-center gap-2 text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={googleDriveSync.autoUpload}
                    onChange={(e) => googleDriveSync.onToggleAutoUpload(e.target.checked)}
                    className="rounded border-slate-300 text-sky-600"
                  />
                  <span>
                    {bn
                      ? 'প্রতিটি পরিবর্তনে Google Drive-এ অটো-ব্যাকআপ চালু রাখুন'
                      : 'Auto-backup to Google Drive on workspace changes'}
                  </span>
                </label>

                {googleDriveSync.lastUploadAt && (
                  <span className="text-[11px] font-mono-num text-sky-600 dark:text-sky-400">
                    {bn ? 'Drive-এ শেষ সেভ:' : 'Last Drive save:'} {googleDriveSync.lastUploadAt}
                  </span>
                )}
              </div>
            </div>
          )}

          {googleDriveSync.notice && (
            <div
              className={`text-xs font-medium rounded-lg px-3 py-2 border ${
                googleDriveSync.notice.type === 'error'
                  ? 'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800'
                  : 'text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/40 border-sky-200 dark:border-sky-800'
              }`}
            >
              {googleDriveSync.notice.text}
            </div>
          )}
        </div>
      )}

      {/* Student Profile Deletion Manager (Super Admin Password & Permission Required) */}
      {onDeleteStudent && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="p-2 rounded-lg bg-red-50 dark:bg-red-950/60 text-red-600 dark:text-red-400">
                <UserMinus className="w-4 h-4" />
              </span>
              <div>
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <span>
                    {bn
                      ? 'ছাত্র প্রোফাইল ডিলিট ম্যানেজার (Student Profile Delete)'
                      : 'Student Profile Deletion Manager'}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[11px] font-mono-num text-slate-600 dark:text-slate-300">
                    {data.students.length}
                  </span>
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {bn
                    ? 'ছাত্রের প্রোফাইল ডিলিট করতে ক্লিক করলে অনুমতি ও সুপার অ্যাডমিন পাসওয়ার্ড যাচাই চাইবে'
                    : 'Deleting a student profile requires explicit permission confirmation and Super Admin password'}
                </p>
              </div>
            </div>

            <div className="relative w-full sm:w-72">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={studentSearch}
                onChange={(e) => setStudentSearch(e.target.value)}
                placeholder={
                  bn ? 'নাম, খাতা কোড বা ফোন খুঁজুন...' : 'Search by name, code, phone...'
                }
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              />
            </div>
          </div>

          {data.students.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 flex flex-col items-center gap-2">
              <Users className="w-5 h-5 text-slate-400" />
              <span>{bn ? 'কোনো ছাত্র নিবন্ধিত নেই।' : 'No student profiles registered yet.'}</span>
            </div>
          ) : filteredStudentsForDelete.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">
              {bn ? 'খোঁজার সাথে কোনো ছাত্র মেলেনি।' : 'No matching students found.'}
            </div>
          ) : (
            <div className="overflow-x-auto max-h-80 overflow-y-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-[11px] font-semibold text-slate-500">
                    <th className="py-2.5 px-4">{bn ? 'কোড' : 'CODE'}</th>
                    <th className="py-2.5 px-4">{bn ? 'ছাত্রের নাম' : 'STUDENT NAME'}</th>
                    <th className="py-2.5 px-4">{bn ? 'ট্রেড / ফোন' : 'TRADE / PHONE'}</th>
                    <th className="py-2.5 px-4 text-right">{bn ? 'কন্ট্রাক্ট / জমা' : 'CONTRACT / PAID'}</th>
                    <th className="py-2.5 px-4 text-right">{bn ? 'অ্যাকশন' : 'ACTION'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {filteredStudentsForDelete.map((student) => {
                    const dueAmt = Math.max(
                      0,
                      Number(student.contract || 0) - Number(student.deposit || 0)
                    );
                    return (
                      <tr key={student.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="py-2.5 px-4 font-mono-num font-bold text-teal-700 dark:text-teal-400 whitespace-nowrap">
                          {student.code}
                        </td>
                        <td className="py-2.5 px-4">
                          <div className="font-semibold text-slate-900 dark:text-white">
                            {student.name}
                          </div>
                          {student.passportNo && (
                            <div className="text-[11px] text-slate-500 font-mono-num">
                              PP: {student.passportNo}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300">
                          <div>{student.trade || '—'}</div>
                          <div className="text-[11px] text-slate-500 font-mono-num">
                            {student.phone || '—'}
                          </div>
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono-num whitespace-nowrap">
                          <div className="font-semibold text-slate-900 dark:text-white">
                            {formatTaka(student.deposit || 0)} / {formatTaka(student.contract || 0)}
                          </div>
                          {dueAmt > 0 && (
                            <div className="text-[11px] text-amber-600 dark:text-amber-400">
                              {bn ? 'বাকি' : 'Due'}: {formatTaka(dueAmt)}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => openStudentDeleteModal(student)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-900/80 bg-red-50 dark:bg-red-950/40 hover:bg-red-600 hover:text-white text-red-600 dark:text-red-400 text-xs font-semibold transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>{bn ? 'ডিলিট' : 'Delete'}</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Audit Logs Table */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-teal-600" />
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
              {bn ? 'সিস্টেম অডিট লগ' : 'System Security & Audit Logs'} ({data.auditLogs.length})
            </h3>
          </div>
          {data.auditLogs.length > 100 && (
            <button
              type="button"
              onClick={() => setShowAllAuditLogs((v) => !v)}
              className="px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-teal-700 dark:text-teal-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              {showAllAuditLogs
                ? bn
                  ? 'সংক্ষিপ্ত (১০০টি) দেখান'
                  : 'Show Latest 100'
                : bn
                  ? `সব ${data.auditLogs.length}টি লগ দেখুন`
                  : `Show All (${data.auditLogs.length})`}
            </button>
          )}
        </div>
        {data.auditLogs.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            {bn ? 'এখনো কোনো অডিট লগ তৈরি হয়নি।' : 'No audit log entries recorded yet.'}
          </div>
        ) : (
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-[11px] font-semibold text-slate-500">
                  <th className="py-2.5 px-4">{bn ? 'তারিখ' : 'DATE'}</th>
                  <th className="py-2.5 px-4">{bn ? 'সময়' : 'TIME'}</th>
                  <th className="py-2.5 px-4">{bn ? 'অ্যাকশন' : 'ACTION'}</th>
                  <th className="py-2.5 px-4">{bn ? 'মডিউল' : 'MODULE'}</th>
                  <th className="py-2.5 px-4">{bn ? 'বিস্তারিত' : 'DETAILS'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {(showAllAuditLogs
                  ? [...data.auditLogs].reverse()
                  : [...data.auditLogs].reverse().slice(0, 100)
                ).map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-2 px-4 font-mono-num">{log.date}</td>
                    <td className="py-2 px-4 font-mono-num text-slate-500">{log.time}</td>
                    <td className="py-2 px-4">
                      <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono-num font-semibold">
                        {log.action}
                      </span>
                    </td>
                    <td className="py-2 px-4 font-medium text-teal-700 dark:text-teal-400">
                      {log.module}
                    </td>
                    <td className="py-2 px-4 text-slate-700 dark:text-slate-300">{log.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Password & Permission Confirmation Modal for Student Deletion */}
      {deleteTargetStudent && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 flex items-center justify-center p-4">
          <form
            onSubmit={handleConfirmDeleteStudent}
            className="bg-white dark:bg-slate-900 rounded-2xl border border-red-200 dark:border-red-900 max-w-md w-full p-5 shadow-2xl space-y-4"
          >
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <span className="p-2 rounded-xl bg-red-100 dark:bg-red-950 text-red-600 dark:text-red-400">
                  <ShieldAlert className="w-5 h-5" />
                </span>
                <div>
                  <h4 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                    {bn
                      ? 'ছাত্র প্রোফাইল ডিলিট অনুমতি যাচাই'
                      : 'Authorize Student Profile Deletion'}
                  </h4>
                  <p className="text-[11px] text-red-600 dark:text-red-400 font-semibold">
                    {bn
                      ? 'ডিলিট করলে এই প্রোফাইল স্থায়ীভাবে মুছে যাবে!'
                      : 'Permanent action — requires permission & password'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={deletingStudent}
                onClick={() => setDeleteTargetStudent(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 p-3.5 text-xs space-y-1">
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">{bn ? 'ছাত্রের নাম:' : 'Name:'}</span>
                <strong className="text-slate-900 dark:text-white">{deleteTargetStudent.name}</strong>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">{bn ? 'খাতা কোড:' : 'Code:'}</span>
                <strong className="font-mono-num text-teal-700 dark:text-teal-400">
                  {deleteTargetStudent.code}
                </strong>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">{bn ? 'ট্রেড / মোবাইল:' : 'Trade / Phone:'}</span>
                <span>
                  {deleteTargetStudent.trade || '—'} · {deleteTargetStudent.phone || '—'}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">{bn ? 'জমা / কন্ট্রাক্ট:' : 'Deposit / Contract:'}</span>
                <strong className="font-mono-num">
                  {formatTaka(deleteTargetStudent.deposit || 0)} /{' '}
                  {formatTaka(deleteTargetStudent.contract || 0)}
                </strong>
              </div>
            </div>

            <label className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={deletePermissionChecked}
                onChange={(e) => {
                  setDeletePermissionChecked(e.target.checked);
                  setDeleteError('');
                }}
                className="mt-0.5 rounded border-amber-400 text-red-600"
              />
              <span className="text-slate-700 dark:text-slate-200 font-medium leading-relaxed">
                {bn
                  ? `আমি নিশ্চিত ও অনুমতি দিচ্ছি যে "${deleteTargetStudent.name}" (${deleteTargetStudent.code})-এর প্রোফাইল স্থায়ীভাবে ডিলিট করা হোক।`
                  : `I confirm and grant permission to permanently delete student profile "${deleteTargetStudent.name}" (${deleteTargetStudent.code}).`}
              </span>
            </label>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {bn
                  ? 'পারমিশন পাসওয়ার্ড দিন (Super Admin Password) *'
                  : 'Super Admin Permission Password *'}
              </label>
              <div className="relative">
                <input
                  type={showDeletePass ? 'text' : 'password'}
                  required
                  autoFocus
                  value={deletePassInput}
                  onChange={(e) => {
                    setDeletePassInput(e.target.value);
                    setDeleteError('');
                  }}
                  placeholder={bn ? 'সুপার অ্যাডমিন পাসওয়ার্ড লিখুন' : 'Enter Super Admin password'}
                  className="w-full pl-3.5 pr-10 py-2 text-xs rounded-lg border-2 border-red-300 dark:border-red-800 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:border-red-500"
                />
                <button
                  type="button"
                  onClick={() => setShowDeletePass((v) => !v)}
                  aria-label={showDeletePass ? 'Hide password' : 'Show password'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                >
                  {showDeletePass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {deleteError && (
                <p className="text-xs font-semibold text-red-600 dark:text-red-400 mt-1.5">
                  {deleteError}
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={deletingStudent}
                onClick={() => setDeleteTargetStudent(null)}
                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                {bn ? 'বাতিল' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={deletingStudent}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-xs font-bold cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>
                  {deletingStudent
                    ? bn
                      ? 'ডিলিট হচ্ছে...'
                      : 'Deleting...'
                    : bn
                      ? 'অনুমতিসহ ডিলিট করুন'
                      : 'Confirm & Delete Profile'}
                </span>
              </button>
            </div>
          </form>
        </div>
      )}

      {onAdd && (
        <JobRecoveryModal
          open={recoveryOpen}
          lang={lang}
          jobs={data.jobs}
          students={data.students}
          prices={data.prices}
          cash={data.cash}
          auditLogs={data.auditLogs}
          megaConfigured={Boolean(megaSync?.configured)}
          onClose={() => setRecoveryOpen(false)}
          onAdd={onAdd}
          onLogAudit={onLogAudit}
        />
      )}
    </div>
  );
}

// 2. Center Settings (Strictly Color, Animation & Graphics)
export function SettingsView({
  lang,
  theme,
  appearance,
  onChangeAppearance,
  onSaveAppearance,
  onResetAppearance,
  onSetTheme,
}: {
  lang: Lang;
  theme: ThemeMode;
  appearance?: UiAppearanceSettings;
  onChangeAppearance?: (next: UiAppearanceSettings) => void;
  onSaveAppearance?: (next: UiAppearanceSettings) => boolean;
  onResetAppearance?: () => void;
  onSetTheme: (t: ThemeMode) => void;
}) {
  const bn = lang === 'bn';
  const [notice, setNotice] = useState('');
  const resolvedAppearance = appearance || loadUiSettings();

  const handleNotify = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => {
      setNotice((prev) => (prev === msg ? '' : prev));
    }, 2600);
  };

  return (
    <div className="space-y-4 max-w-5xl">
      {/* Header Card */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="p-2.5 rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
            <Palette className="w-5 h-5" />
          </span>
          <div>
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
              {bn
                ? 'সেন্টার সেটিংস — কালার, অ্যানিমেশন ও গ্রাফিক্স'
                : 'Center Settings — Color, Animation & Graphics'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {bn
                ? 'কালার গ্রেডিং, থিম, অ্যানিমেশন এফেক্ট, লোগো ও ফন্ট গ্রাফিক্স পরিচালনা করুন'
                : 'Customize color grading presets, theme mode, motion animations, and graphics'}
            </p>
          </div>
        </div>

        {notice && (
          <span className="px-3 py-1 rounded-lg bg-[var(--accent-soft)] border border-[var(--accent)]/40 text-xs font-semibold text-[var(--accent)]">
            {notice}
          </span>
        )}
      </div>

      {onChangeAppearance && onSaveAppearance && (
        <ColorGradingTokenSealStudio
          lang={lang}
          theme={theme}
          onSetTheme={onSetTheme}
          settings={resolvedAppearance}
          onChange={onChangeAppearance}
          onSave={onSaveAppearance}
          onResetAll={onResetAppearance}
          onNotify={handleNotify}
        />
      )}
    </div>
  );
}
