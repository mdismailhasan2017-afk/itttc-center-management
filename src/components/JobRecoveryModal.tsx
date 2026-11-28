import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Database,
  FileSpreadsheet,
  HardDrive,
  History,
  RefreshCw,
  RotateCcw,
  Upload,
  X,
} from 'lucide-react';
import { formatTaka } from '../lib/format';
import {
  buildRecoverableJobsReport,
  extractJobsFromUploadedBytes,
  type RecoverableJobItem,
} from '../lib/jobRecovery';
import {
  scanMegaRecovery,
  type MegaRecoveryJobCandidate,
  type MegaRecoverySourceInfo,
} from '../lib/localBackupSync';
import { readLocalSnapshotsFromIdb, type LocalSnapshotRecord, type SubCollectionKey } from '../lib/store';
import type { AuditLog, CashEntry, JobEntry, JobPrice, Lang, Student } from '../types';

interface JobRecoveryModalProps {
  open: boolean;
  lang: Lang;
  jobs: JobEntry[];
  students: Student[];
  prices: JobPrice[];
  cash?: CashEntry[];
  auditLogs?: AuditLog[];
  megaConfigured?: boolean;
  onClose: () => void;
  onAdd: (key: SubCollectionKey, raw: Record<string, unknown>, customId?: string) => Promise<string>;
  onLogAudit?: (action: string, module: string, detail: string) => Promise<void>;
}

export function JobRecoveryModal({
  open,
  lang,
  jobs,
  students,
  prices,
  cash = [],
  auditLogs = [],
  megaConfigured = false,
  onClose,
  onAdd,
  onLogAudit,
}: JobRecoveryModalProps) {
  const bn = lang === 'bn';
  const [localSnapshots, setLocalSnapshots] = useState<LocalSnapshotRecord[]>([]);
  const [megaSources, setMegaSources] = useState<MegaRecoverySourceInfo[]>([]);
  const [megaCandidates, setMegaCandidates] = useState<MegaRecoveryJobCandidate[]>([]);
  const [uploadedCandidates, setUploadedCandidates] = useState<MegaRecoveryJobCandidate[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [megaScanning, setMegaScanning] = useState(false);
  const [megaScannedOnce, setMegaScannedOnce] = useState(false);
  const [megaError, setMegaError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const originHost =
    typeof window !== 'undefined' ? window.location.origin : '';
  const alternateLink = originHost.includes('ais-dev-')
    ? originHost.replace('ais-dev-', 'ais-pre-')
    : originHost.includes('ais-pre-')
      ? originHost.replace('ais-pre-', 'ais-dev-')
      : '';

  const report = useMemo(
    () =>
      buildRecoverableJobsReport({
        existingJobs: jobs,
        students,
        prices,
        cash,
        auditLogs,
        localSnapshots,
        megaSources,
        megaCandidates,
        uploadedCandidates,
      }),
    [jobs, students, prices, cash, auditLogs, localSnapshots, megaSources, megaCandidates, uploadedCandidates]
  );

  // Auto-select newly discovered missing jobs
  useEffect(() => {
    if (!open) return;
    setSelectedKeys(new Set(report.missingJobs.map((item) => item.key)));
  }, [open, report.missingJobs]);

  const handleScanMega = async () => {
    setMegaScanning(true);
    setMegaError(null);
    try {
      const res = await scanMegaRecovery();
      setMegaSources(res.sources);
      setMegaCandidates(res.jobs);
      setMegaScannedOnce(true);
    } catch (err) {
      setMegaError(
        err instanceof Error
          ? err.message
          : bn
            ? 'MEGA ক্লাউড স্ক্যান করা যায়নি।'
            : 'Failed to scan MEGA Cloud.'
      );
    } finally {
      setMegaScanning(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setNotice(null);
    setMegaError(null);
    let active = true;
    void readLocalSnapshotsFromIdb().then((snaps) => {
      if (active) setLocalSnapshots(snaps);
    });
    if (megaConfigured && !megaScannedOnce) {
      void handleScanMega();
    }
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, megaConfigured]);

  if (!open) return null;

  const handleFileScan = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setNotice(null);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const parsed = extractJobsFromUploadedBytes(file.name, buf);
      setUploadedCandidates((prev) => [...prev, ...parsed.jobs]);
      setNotice({
        type: 'success',
        text: bn
          ? `"${file.name}" থেকে ${parsed.jobs.length}টি জব পাওয়া গেছে। নিচের তালিকায় হারানো জবগুলো দেখুন।`
          : `Found ${parsed.jobs.length} jobs in "${file.name}".`,
      });
    } catch (err) {
      setNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to read uploaded file.',
      });
    }
  };

  const toggleKey = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectedItems: RecoverableJobItem[] = report.missingJobs.filter((item) =>
    selectedKeys.has(item.key)
  );

  const handleRestoreSelected = async () => {
    if (selectedItems.length === 0 || restoring) return;
    setRestoring(true);
    setNotice(null);
    let restoredCount = 0;
    try {
      for (const item of selectedItems) {
        await onAdd('jobs', {
          date: item.date,
          no: item.no,
          sid: item.sid,
          sname: item.sname,
          cat: item.cat,
          pay: item.pay,
          discount: item.discount,
          paid: item.paid,
          verificationMethod: item.verificationMethod,
          note: item.note,
        });
        restoredCount += 1;
      }
      await onLogAudit?.(
        'RESTORE_JOBS',
        'Job Recovery',
        `Restored ${restoredCount} missing jobs from ${Array.from(
          new Set(selectedItems.map((i) => i.sourceLabel))
        )
          .slice(0, 3)
          .join(', ')}`
      );
      setNotice({
        type: 'success',
        text: bn
          ? `সফলভাবে ${restoredCount}টি হারানো জব রেজিস্টারে ফিরিয়ে আনা হয়েছে!`
          : `Successfully restored ${restoredCount} missing jobs to the register!`,
      });
    } catch (err) {
      setNotice({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : bn
              ? 'জব রিস্টোর করতে সমস্যা হয়েছে।'
              : 'Failed to restore selected jobs.',
      });
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-slate-950/65 backdrop-blur-[1px] flex items-center justify-center p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-label="Recover Missing Jobs"
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-5xl w-full max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3">
            <span className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300">
              <RotateCcw className="w-5 h-5" />
            </span>
            <div>
              <h2 className="font-display text-base sm:text-lg font-extrabold text-slate-900 dark:text-white">
                {bn ? 'হারানো জব পুনরুদ্ধার (Job Data Recovery)' : 'Missing Job Recovery Scanner'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {bn
                  ? 'অডিট লগ, ক্যাশবুক, লোকাল স্ন্যাপশট, MEGA ক্লাউড (Excel/Trash/History) ও পিসির ফাইল থেকে হারানো জব খুঁজে ফিরিয়ে আনুন'
                  : 'Scan audit logs, cashbook, local snapshots, MEGA archive/trash, or backup files to restore missing jobs'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Diagnostic Checklist Banner */}
          <div className="rounded-xl border border-amber-200 dark:border-amber-800/80 bg-amber-50/75 dark:bg-amber-950/30 p-3.5 text-xs space-y-2">
            <div className="flex items-start gap-2 text-amber-900 dark:text-amber-200 font-bold">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>
                {bn
                  ? 'দ্রুত চেক: ডাটা কম দেখালে ৩টি জায়গা পরীক্ষা করুন'
                  : 'Quick Check: 3 places to look when jobs appear missing'}
              </span>
            </div>
            <ul className="list-disc pl-5 space-y-1 text-slate-700 dark:text-slate-300 leading-relaxed">
              <li>
                {bn
                  ? `বর্তমান জব সংখ্যা: ${jobs.length}টি | অডিট লগে পাওয়া জব: ${report.auditJobCount}টি | ক্যাশবুকে পাওয়া জব: ${report.cashJobCount}টি। যদি অডিট লগ বা ক্যাশবুকে বেশি জব থাকে, নিচেই ১ ক্লিকে ফিরিয়ে আনতে পারবেন।`
                  : `Current jobs: ${jobs.length} | Jobs logged in Audit Log: ${report.auditJobCount} | Cashbook job entries: ${report.cashJobCount}.`}
              </li>
              <li>
                {bn
                  ? 'রেজিস্টার পেজে উপরের "সব জব (All Job)" বাটনে ক্লিক করে দেখুন — অনেক সময় শুধু আজকের তারিখ ফিল্টার চালু থাকায় আগের বা ভিন্ন তারিখের জব লুকানো থাকে।'
                  : 'Click "All Job" in the register toolbar to verify entries are not hidden under a different date filter.'}
              </li>
              {alternateLink && (
                <li>
                  {bn ? 'সতর্কতা: আপনি বর্তমানে ' : 'Current link: '}
                  <span className="font-mono-num font-semibold">{originHost}</span>
                  {bn
                    ? ' ব্যবহার করছেন। যদি সকালে অন্য লিংকে ('
                    : '. If morning jobs were entered offline on '}
                  <span className="font-mono-num font-semibold">{alternateLink}</span>
                  {bn
                    ? ') কাজ করে থাকেন, ওই লিংকে গিয়ে "এক্সেল (.xlsx)" বা "পিসিতে ডাউনলোড (JSON)" করে এখানে আপলোড দিলেই সব জব চলে আসবে।'
                    : '), open that link, export JSON/Excel, and upload it below.'}
                </li>
              )}
            </ul>
          </div>

          {/* Scan Actions Row */}
          <div className="flex flex-wrap items-center gap-2.5">
            {megaConfigured ? (
              <button
                type="button"
                disabled={megaScanning}
                onClick={() => void handleScanMega()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${megaScanning ? 'animate-spin' : ''}`} />
                <span>
                  {megaScanning
                    ? bn
                      ? 'MEGA ক্লাউড ও Trash স্ক্যান হচ্ছে...'
                      : 'Scanning MEGA & Rubbish Bin...'
                    : bn
                      ? 'MEGA ক্লাউড, Excel ও Trash আবার স্ক্যান করুন'
                      : 'Re-Scan MEGA Cloud, Excel & Trash'}
                </span>
              </button>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300">
                <Cloud className="w-3.5 h-3.5" />
                {bn
                  ? 'MEGA সংযুক্ত নেই — Super Admin থেকে MEGA লগইন করলে MEGA Trash/Excel স্ক্যান হবে'
                  : 'Connect MEGA in Super Admin to scan MEGA Rubbish Bin & Daily Excel'}
              </span>
            )}

            <label className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-semibold cursor-pointer">
              <Upload className="w-3.5 h-3.5 text-teal-600" />
              <span>
                {bn
                  ? 'PC থেকে JSON / Excel ফাইল স্ক্যান'
                  : 'Scan PC JSON / Excel File'}
              </span>
              <input
                type="file"
                accept=".json,.xlsx,.xls,.csv"
                onChange={(e) => void handleFileScan(e)}
                className="hidden"
              />
            </label>
          </div>

          {megaError && (
            <div className="px-3.5 py-2.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
              {megaError}
            </div>
          )}

          {notice && (
            <div
              className={`px-3.5 py-2.5 rounded-lg border text-xs font-medium flex items-center gap-2 ${
                notice.type === 'success'
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                  : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
              }`}
            >
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{notice.text}</span>
            </div>
          )}

          {/* Scanned Sources Grid */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {bn ? 'পরীক্ষাকৃত ডাটা উৎস (Scanned Sources)' : 'Scanned Recovery Sources'}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {report.sources.map((src, idx) => (
                <div
                  key={`${src.label}-${idx}`}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 px-3 py-2.5 text-xs flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {src.kind === 'mega-excel' ? (
                      <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
                    ) : src.kind === 'snapshot' ? (
                      <HardDrive className="w-4 h-4 text-indigo-600 shrink-0" />
                    ) : src.kind.startsWith('mega') ? (
                      <Cloud className="w-4 h-4 text-sky-600 shrink-0" />
                    ) : src.kind === 'audit-log' ? (
                      <History className="w-4 h-4 text-amber-600 shrink-0" />
                    ) : (
                      <Database className="w-4 h-4 text-teal-600 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-800 dark:text-slate-200 truncate" title={src.label}>
                        {src.label}
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono-num">
                        {bn ? 'মোট:' : 'Total:'} {src.foundCount}
                        {src.detail ? ` · ${src.detail}` : ''}
                      </div>
                    </div>
                  </div>
                  <span
                    className={`shrink-0 px-2 py-0.5 rounded font-mono-num text-[11px] font-bold ${
                      src.missingCount > 0
                        ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                        : 'bg-slate-200/70 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {src.missingCount > 0
                      ? bn
                        ? `+${src.missingCount} হারানো`
                        : `+${src.missingCount} missing`
                      : bn
                        ? 'মিল আছে'
                        : 'Synced'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Missing Jobs Selection Table */}
          <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-bold text-slate-900 dark:text-white">
                {bn
                  ? `পুনরুদ্ধারযোগ্য হারানো জব: ${report.missingJobs.length}টি`
                  : `Recoverable Missing Jobs: ${report.missingJobs.length}`}
              </div>
              {report.missingJobs.length > 0 && (
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setSelectedKeys(new Set(report.missingJobs.map((j) => j.key)))}
                    className="text-teal-700 dark:text-teal-400 font-semibold hover:underline cursor-pointer"
                  >
                    {bn ? 'সব নির্বাচন করুন' : 'Select All'}
                  </button>
                  <span className="text-slate-300">|</span>
                  <button
                    type="button"
                    onClick={() => setSelectedKeys(new Set())}
                    className="text-slate-500 hover:underline cursor-pointer"
                  >
                    {bn ? 'বাতিল' : 'Clear'}
                  </button>
                </div>
              )}
            </div>

            {report.missingJobs.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400 space-y-1">
                <div>
                  {bn
                    ? 'উপরের উৎসগুলোতে এমন কোনো জব পাওয়া যায়নি যা বর্তমান রেজিস্টারে নেই।'
                    : 'No additional missing jobs were found across the scanned local & cloud sources.'}
                </div>
                <div className="text-[11px] text-slate-400">
                  {bn
                    ? 'আপনার পিসিতে বা অন্য লিংকে (ais-dev / ais-pre) কোনো ডাউনলোড করা JSON বা Excel থাকলে উপরের "PC থেকে JSON / Excel ফাইল স্ক্যান" বাটন দিয়ে পরীক্ষা করুন।'
                    : 'If you have a downloaded JSON or Excel file on your computer or the alternate link, upload it above to recover.'}
                </div>
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-[11px] text-slate-500 uppercase">
                    <tr>
                      <th className="py-2 px-3 w-8" />
                      <th className="py-2 px-3">Date</th>
                      <th className="py-2 px-3">Job No</th>
                      <th className="py-2 px-3">Student</th>
                      <th className="py-2 px-3">Category</th>
                      <th className="py-2 px-3 text-right">Fee</th>
                      <th className="py-2 px-3">Source</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {report.missingJobs.map((item) => {
                      const checked = selectedKeys.has(item.key);
                      return (
                        <tr
                          key={item.key}
                          onClick={() => toggleKey(item.key)}
                          className="hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer"
                        >
                          <td className="py-2 px-3">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleKey(item.key)}
                              onClick={(e) => e.stopPropagation()}
                              className="rounded border-slate-300 text-teal-600"
                            />
                          </td>
                          <td className="py-2 px-3 font-mono-num whitespace-nowrap">{item.date || '—'}</td>
                          <td className="py-2 px-3 font-mono-num font-bold text-slate-900 dark:text-white whitespace-nowrap">
                            {item.no}
                          </td>
                          <td className="py-2 px-3">
                            <div className="font-semibold text-slate-900 dark:text-white">{item.sname}</div>
                            <div className="text-[11px] font-mono-num text-teal-700 dark:text-teal-400">
                              {item.sid}
                            </div>
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap">{item.cat}</td>
                          <td className="py-2 px-3 text-right font-mono-num font-bold whitespace-nowrap">
                            {formatTaka(item.pay)}
                          </td>
                          <td className="py-2 px-3 text-[11px] text-slate-500 max-w-[200px] truncate" title={item.sourceLabel}>
                            {item.sourceLabel}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 shrink-0 bg-slate-50/70 dark:bg-slate-900">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {bn
              ? `নির্বাচিত: ${selectedItems.length}টি জব (ক্যাশবুকে ডাবল এন্ট্রি ছাড়াই শুধু জব রেজিস্টারে যোগ হবে)`
              : `Selected: ${selectedItems.length} jobs (restored to job register without duplicating cashbook)`}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold cursor-pointer"
            >
              {bn ? 'বন্ধ করুন' : 'Close'}
            </button>
            <button
              type="button"
              disabled={selectedItems.length === 0 || restoring}
              onClick={() => void handleRestoreSelected()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>
                {restoring
                  ? bn
                    ? 'ফিরিয়ে আনা হচ্ছে...'
                    : 'Restoring...'
                  : bn
                    ? `নির্বাচিত ${selectedItems.length}টি জব ফিরিয়ে আনুন`
                    : `Restore ${selectedItems.length} Missing Jobs`}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
