import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  Calendar,
  Cloud,
  Download,
  Eye,
  EyeOff,
  FileSpreadsheet,
  FolderOpen,
  RefreshCw,
  UploadCloud,
  X,
} from 'lucide-react';
import { formatTaka, todayDDMMYYYY } from '../lib/format';
import {
  downloadMegaDailyExcel,
  listMegaDailyExcelFiles,
  viewMegaDailyExcel,
  type MegaDailyExcelEntry,
  type MegaExcelViewResult,
} from '../lib/localBackupSync';
import type { Lang } from '../types';

export interface MegaSyncBridge {
  configured: boolean;
  email?: string | null;
  busy: boolean;
  liveStatus?: 'idle' | 'pending' | 'syncing' | 'synced' | 'error';
  lastUploadAt: string | null;
  onUploadNow: () => Promise<void>;
  onPullNow?: () => Promise<void>;
  onConnectMega?: (email: string, password: string) => Promise<boolean>;
  onOpenSettings?: () => void;
}

function toInputDate(ddmmyyyy: string): string {
  const parts = ddmmyyyy.split('-');
  if (parts.length !== 3) return '';
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

function fromInputDate(yyyymmdd: string): string {
  if (!yyyymmdd) return '';
  const parts = yyyymmdd.split('-');
  if (parts.length !== 3) return '';
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function MegaExcelArchiveModal({
  open,
  lang,
  defaultDate,
  megaSync,
  onClose,
}: {
  open: boolean;
  lang: Lang;
  defaultDate: string;
  megaSync?: MegaSyncBridge;
  onClose: () => void;
}) {
  const bn = lang === 'bn';
  const [selectedDate, setSelectedDate] = useState(defaultDate || todayDDMMYYYY());
  const [files, setFiles] = useState<MegaDailyExcelEntry[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingView, setLoadingView] = useState(false);
  const [downloadingName, setDownloadingName] = useState<string | null>(null);
  const [preview, setPreview] = useState<MegaExcelViewResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const [emailInput, setEmailInput] = useState('');
  const [passInput, setPassInput] = useState('');
  const [showPass, setShowPass] = useState(false);

  const loadFilesAndDate = useCallback(
    async (targetDate: string) => {
      if (!megaSync?.configured) return;
      setErrorMsg(null);
      setLoadingList(true);
      setLoadingView(true);
      try {
        const [listRes, viewRes] = await Promise.all([
          listMegaDailyExcelFiles(),
          viewMegaDailyExcel({ date: targetDate }),
        ]);
        setFiles(listRes);
        setPreview(viewRes);
      } catch (err) {
        setErrorMsg(
          err instanceof Error ? err.message : 'Failed to load Excel files from Mega.'
        );
      } finally {
        setLoadingList(false);
        setLoadingView(false);
      }
    },
    [megaSync?.configured]
  );

  useEffect(() => {
    if (!open) return;
    const initialDate = defaultDate || todayDDMMYYYY();
    setSelectedDate(initialDate);
    setErrorMsg(null);
    setStatusMsg(null);
    if (megaSync?.configured) {
      void loadFilesAndDate(initialDate);
    }
  }, [open, defaultDate, megaSync?.configured, loadFilesAndDate]);

  if (!open) return null;

  const handleViewDate = async (dateStr: string, fileName?: string) => {
    if (!dateStr && !fileName) return;
    if (dateStr) setSelectedDate(dateStr);
    setErrorMsg(null);
    setStatusMsg(null);
    setLoadingView(true);
    try {
      const res = await viewMegaDailyExcel({ date: dateStr, fileName });
      setPreview(res);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to read Excel file.');
    } finally {
      setLoadingView(false);
    }
  };

  const handleDownloadDate = async (dateStr: string, fileName?: string) => {
    const label = fileName || `Jobs_${dateStr}.xlsx`;
    setErrorMsg(null);
    setStatusMsg(null);
    setDownloadingName(label);
    try {
      const downloaded = await downloadMegaDailyExcel({ date: dateStr, fileName });
      setStatusMsg(
        bn ? `${downloaded} সফলভাবে ডাউনলোড হয়েছে!` : `Downloaded ${downloaded} successfully!`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to download Excel from Mega.');
    } finally {
      setDownloadingName(null);
    }
  };

  const handleInlineConnect = async (e: FormEvent) => {
    e.preventDefault();
    if (!megaSync?.onConnectMega) return;
    setErrorMsg(null);
    const ok = await megaSync.onConnectMega(emailInput.trim(), passInput);
    if (ok) {
      setPassInput('');
      setStatusMsg(
        bn
          ? 'Mega যুক্ত হয়েছে এবং সর্বশেষ ডেটা সিঙ্ক সম্পন্ন!'
          : 'Mega connected and latest data synced!'
      );
    }
  };

  const handleSyncAllAndRefresh = async () => {
    if (!megaSync) return;
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      await megaSync.onUploadNow();
      await loadFilesAndDate(selectedDate);
      setStatusMsg(
        bn
          ? 'সব তারিখের Excel ফাইল Mega-তে আপলোড ও রিফ্রেশ হয়েছে।'
          : 'Synced all daily Excel files to Mega and refreshed archive.'
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Mega upload failed.');
    }
  };

  const handlePullAndRefresh = async () => {
    if (!megaSync?.onPullNow) return;
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      await megaSync.onPullNow();
      await loadFilesAndDate(selectedDate);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to pull from Mega.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400">
              <FileSpreadsheet className="w-5 h-5" />
            </span>
            <div>
              <h3 className="font-display text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                {bn
                  ? 'MEGA দৈনিক জব Excel আর্কাইভ (দেখুন ও ডাউনলোড)'
                  : 'MEGA Daily Job Excel Archive (View & Download)'}
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {megaSync?.configured
                  ? bn
                    ? `সংযুক্ত: ${megaSync.email || 'Mega Account'} · ফোল্ডার: ITTC_Daily_Jobs/Jobs_DD-MM-YYYY.xlsx`
                    : `Connected: ${megaSync.email || 'Mega Account'} · Folder: ITTC_Daily_Jobs/Jobs_DD-MM-YYYY.xlsx`
                  : bn
                    ? 'আপনার Mega অ্যাকাউন্ট যুক্ত করে যেকোনো তারিখের Excel ফাইল দেখুন ও ডাউনলোড করুন'
                    : 'Connect your Mega account to view or download any date Excel (.xlsx) file'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {megaSync?.configured && (
              <>
                <button
                  type="button"
                  disabled={loadingList || megaSync.busy}
                  onClick={() => void loadFilesAndDate(selectedDate)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer disabled:opacity-60"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingList ? 'animate-spin' : ''}`} />
                  <span>{bn ? 'রিফ্রেশ' : 'Refresh'}</span>
                </button>
                <button
                  type="button"
                  disabled={megaSync.busy}
                  onClick={() => void handleSyncAllAndRefresh()}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
                >
                  <UploadCloud className="w-3.5 h-3.5" />
                  <span>{bn ? 'সব Excel সিঙ্ক' : 'Sync All Excel'}</span>
                </button>
                {megaSync.onPullNow && (
                  <button
                    type="button"
                    disabled={megaSync.busy}
                    onClick={() => void handlePullAndRefresh()}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
                  >
                    <Cloud className="w-3.5 h-3.5" />
                    <span>{bn ? 'সর্বশেষ ডেটা আনুন' : 'Pull Workspace'}</span>
                  </button>
                )}
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5 space-y-4">
          {!megaSync?.configured ? (
            <div className="max-w-md mx-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 p-5 space-y-3">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                <Cloud className="w-4 h-4 text-indigo-500" />
                <span>
                  {bn
                    ? 'ক্রস-ব্রাউজার Mega সিঙ্ক সংযুক্ত করুন'
                    : 'Connect Mega Account for Cross-Browser Sync'}
                </span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                {bn
                  ? 'যেকোনো ব্রাউজারে আপনার একই Mega অ্যাকাউন্ট লগইন করলেই সর্বশেষ তথ্য এবং প্রতিদিনের Excel (.xlsx) ফাইল স্বয়ংক্রিয়ভাবে চলে আসবে।'
                  : 'Sign in with the same Mega account in any browser to pull your latest center data and view/download daily Excel files.'}
              </p>

              {megaSync?.onConnectMega ? (
                <form onSubmit={handleInlineConnect} className="space-y-2.5">
                  <input
                    type="email"
                    required
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder="your-mega-email@gmail.com"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                  <div className="relative">
                    <input
                      type={showPass ? 'text' : 'password'}
                      required
                      value={passInput}
                      onChange={(e) => setPassInput(e.target.value)}
                      placeholder={bn ? 'Mega পাসওয়ার্ড' : 'Mega password'}
                      className="w-full pl-3 pr-9 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      {showPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="submit"
                      disabled={megaSync.busy}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
                    >
                      <Cloud className="w-3.5 h-3.5" />
                      <span>
                        {megaSync.busy
                          ? bn
                            ? 'সংযুক্ত হচ্ছে...'
                            : 'Connecting...'
                          : bn
                            ? 'Mega যুক্ত করুন ও লোড করুন'
                            : 'Connect Mega & Sync'}
                      </span>
                    </button>
                    {megaSync.onOpenSettings && (
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          megaSync.onOpenSettings?.();
                        }}
                        className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold cursor-pointer"
                      >
                        {bn ? 'Settings খুলুন' : 'Open Settings'}
                      </button>
                    )}
                  </div>
                </form>
              ) : null}
            </div>
          ) : (
            <>
              {/* Date Picker & Quick Action Row */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3.5 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
                    <Calendar className="w-4 h-4 text-teal-600" />
                    <span>{bn ? 'তারিখ নির্বাচন:' : 'Select Date:'}</span>
                    <input
                      type="date"
                      value={toInputDate(selectedDate)}
                      onChange={(e) => {
                        if (e.target.value) {
                          const next = fromInputDate(e.target.value);
                          setSelectedDate(next);
                          void handleViewDate(next);
                        }
                      }}
                      className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono-num"
                    />
                  </div>

                  <button
                    type="button"
                    disabled={loadingView}
                    onClick={() => void handleViewDate(selectedDate)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>{bn ? 'Excel দেখুন' : 'View Excel'}</span>
                  </button>

                  <button
                    type="button"
                    disabled={downloadingName !== null}
                    onClick={() => void handleDownloadDate(selectedDate)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>
                      {downloadingName
                        ? bn
                          ? 'ডাউনলোড হচ্ছে...'
                          : 'Downloading...'
                        : bn
                          ? 'ডাউনলোড (.xlsx)'
                          : 'Download (.xlsx)'}
                    </span>
                  </button>
                </div>

                <div className="text-[11px] font-mono-num text-slate-500">
                  {bn ? 'ফাইল:' : 'File:'} <span className="font-semibold text-slate-700 dark:text-slate-200">Jobs_{selectedDate}.xlsx</span>
                </div>
              </div>

              {errorMsg && (
                <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-3.5 py-2 text-xs font-medium text-red-700 dark:text-red-300">
                  {errorMsg}
                </div>
              )}

              {statusMsg && (
                <div className="rounded-lg border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/40 px-3.5 py-2 text-xs font-medium text-teal-700 dark:text-teal-300">
                  {statusMsg}
                </div>
              )}

              {/* Saved Daily Excel List in MEGA */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-200">
                  <span className="inline-flex items-center gap-1.5">
                    <FolderOpen className="w-3.5 h-3.5 text-amber-500" />
                    <span>
                      {bn
                        ? `MEGA-তে সংরক্ষিত দৈনিক Excel ফাইলসমূহ (${files.length})`
                        : `Saved Daily Excel Files in MEGA (${files.length})`}
                    </span>
                  </span>
                  {loadingList && (
                    <span className="text-[11px] text-slate-400">
                      {bn ? 'তালিকা লোড হচ্ছে...' : 'Loading list...'}
                    </span>
                  )}
                </div>

                {files.length === 0 && !loadingList ? (
                  <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-4 text-center text-xs text-slate-500">
                    {bn
                      ? 'MEGA-তে এখনো কোনো দৈনিক Excel ফাইল পাওয়া যায়নি। উপরের "সব Excel সিঙ্ক" বাটনে ক্লিক করে আপলোড করুন।'
                      : 'No daily Excel files stored in MEGA yet. Click "Sync All Excel" above to generate and upload them.'}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {files.map((f) => {
                      const isActive =
                        preview?.fileName?.toLowerCase() === f.fileName.toLowerCase() ||
                        (f.date && f.date === selectedDate);
                      return (
                        <div
                          key={f.fileName}
                          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                            isActive
                              ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/40 text-teal-800 dark:text-teal-200'
                              : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/70 text-slate-700 dark:text-slate-200'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => void handleViewDate(f.date, f.fileName)}
                            className="inline-flex items-center gap-1.5 font-mono-num font-semibold cursor-pointer hover:underline"
                          >
                            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                            <span>{f.date || f.fileName}</span>
                            <span className="text-[10px] text-slate-400">
                              ({formatBytes(f.size)})
                            </span>
                          </button>
                          <button
                            type="button"
                            title={bn ? 'ডাউনলোড করুন' : 'Download'}
                            onClick={() => void handleDownloadDate(f.date, f.fileName)}
                            className="p-1 rounded hover:bg-emerald-100 dark:hover:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400 cursor-pointer"
                          >
                            <Download className="w-3 h-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* In-App Excel Preview Table */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden bg-white dark:bg-slate-950/40">
                <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-bold text-slate-800 dark:text-slate-100">
                    {loadingView
                      ? bn
                        ? 'MEGA থেকে Excel লোড হচ্ছে...'
                        : 'Loading Excel preview from MEGA...'
                      : preview?.found
                        ? `${preview.fileName} (${preview.rows?.length || 0} ${bn ? 'টি জব' : 'jobs'})`
                        : `${selectedDate} — ${bn ? 'ফাইল পাওয়া যায়নি' : 'No Excel file for this date'}`}
                  </div>
                  {preview?.found && (
                    <div className="flex items-center gap-2 text-[11px] font-mono-num text-slate-500">
                      {preview.totalRow && (
                        <span className="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-semibold">
                          {bn ? 'মোট কালেকশন:' : 'Total Collection:'}{' '}
                          {formatTaka(preview.totalRow[8] ?? 0)}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleDownloadDate(preview.date, preview.fileName)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-semibold cursor-pointer"
                      >
                        <Download className="w-3 h-3" />
                        <span>{bn ? 'ডাউনলোড' : 'Download'}</span>
                      </button>
                    </div>
                  )}
                </div>

                {loadingView ? (
                  <div className="p-8 text-center text-xs text-slate-500">
                    {bn ? 'MEGA ক্লাউড থেকে শিট পড়া হচ্ছে...' : 'Reading spreadsheet from MEGA Cloud...'}
                  </div>
                ) : !preview?.found ? (
                  <div className="p-8 text-center space-y-2.5">
                    <p className="text-xs text-slate-500">
                      {bn
                        ? `${selectedDate} তারিখের জন্য MEGA-তে কোনো Excel (.xlsx) ফাইল সংরক্ষিত নেই।`
                        : `No Excel (.xlsx) file found in MEGA for ${selectedDate}.`}
                    </p>
                    <button
                      type="button"
                      disabled={megaSync.busy}
                      onClick={() => void handleSyncAllAndRefresh()}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
                    >
                      <UploadCloud className="w-3.5 h-3.5" />
                      <span>{bn ? 'এখনই MEGA-তে সিঙ্ক করুন' : 'Sync to MEGA Now'}</span>
                    </button>
                  </div>
                ) : (
                  <div className="overflow-x-auto max-h-80 overflow-y-auto">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-300 sticky top-0">
                        <tr>
                          {(preview.headers || []).map((h, i) => (
                            <th key={i} className="px-3 py-2 font-semibold whitespace-nowrap">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                        {(preview.rows || []).length === 0 ? (
                          <tr>
                            <td
                              colSpan={Math.max(1, preview.headers?.length || 1)}
                              className="px-4 py-6 text-center text-slate-500"
                            >
                              {bn ? 'এই তারিখে কোনো জব এন্ট্রি নেই।' : 'No job rows in this Excel file.'}
                            </td>
                          </tr>
                        ) : (
                          (preview.rows || []).map((row, rIdx) => (
                            <tr
                              key={rIdx}
                              className="hover:bg-slate-50 dark:hover:bg-slate-900/50"
                            >
                              {row.map((cell, cIdx) => {
                                const isMoneyCol = cIdx === 6 || cIdx === 7 || cIdx === 8;
                                return (
                                  <td
                                    key={cIdx}
                                    className={`px-3 py-2 whitespace-nowrap ${
                                      isMoneyCol ? 'font-mono-num font-semibold' : ''
                                    }`}
                                  >
                                    {isMoneyCol ? formatTaka(cell) : String(cell ?? '')}
                                  </td>
                                );
                              })}
                            </tr>
                          ))
                        )}
                      </tbody>
                      {preview.totalRow && (
                        <tfoot className="bg-slate-100 dark:bg-slate-900 font-bold text-slate-900 dark:text-white border-t border-slate-300 dark:border-slate-700">
                          <tr>
                            {preview.totalRow.map((cell, cIdx) => {
                              const isMoneyCol = cIdx === 6 || cIdx === 7 || cIdx === 8;
                              return (
                                <td key={cIdx} className="px-3 py-2 whitespace-nowrap font-mono-num">
                                  {isMoneyCol ? formatTaka(cell) : String(cell ?? '')}
                                </td>
                              );
                            })}
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
