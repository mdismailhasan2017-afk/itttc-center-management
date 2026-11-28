import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  AlertTriangle,
  Award,
  Briefcase,
  Camera,
  Check,
  Edit3,
  Eye,
  FileSpreadsheet,
  FileText,
  Fingerprint,
  Globe,
  Maximize2,
  MessageCircle,
  Minimize2,
  Phone,
  Plus,
  Printer,
  RotateCcw,
  Upload,
  User,
  Wallet,
  X,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import type { SubCollectionKey } from '../lib/store';
import { formatTaka, todayDDMMYYYY } from '../lib/format';
import {
  buildDueDateAuditDetail,
  buildJobSlipFromEntry,
  buildRentLimitAuditDetail,
  canEnterJob,
  computeStudentJobBalanceSummary,
  defaultPromiseDateYYYYMMDD,
  getStudentCategoryRentedLimit,
  getStudentDueDateApproval,
  parseDueJobNote,
  RENT_LIMIT_ACTION,
  rentSupervisorLimit,
  SET_DUE_DATE_ACTION,
  setSupervisorDueDate,
} from '../lib/jobLimits';
import type { PrintableReportSpec } from '../lib/print';
import type {
  AuditLog,
  CashEntry,
  JobEntry,
  JobPrice,
  JobReturn,
  Lang,
  OverseasCompany,
  OverseasStatus,
  ReturnTypeOption,
  SlipData,
  StaffMember,
  Student,
} from '../types';

export interface DepositLaunchTarget {
  student: Student;
  depositType: 'course' | 'visa';
}

interface StudentProfileModalProps {
  student: Student | null;
  jobs: JobEntry[];
  returns: JobReturn[];
  prices: JobPrice[];
  cash: CashEntry[];
  companies?: OverseasCompany[];
  auditLogs?: AuditLog[];
  staff?: StaffMember[];
  lang: Lang;
  onClose: () => void;
  onEdit: (student: Student) => void;
  onUpdate: (key: SubCollectionKey, id: string, patch: Record<string, unknown>) => Promise<void>;
  onAdd: (key: SubCollectionKey, raw: Record<string, unknown>) => Promise<string>;
  onLogAudit?: (action: string, module: string, detail: string) => Promise<void>;
  onOpenDeposit: (target: DepositLaunchTarget) => void;
  onIssueJob?: (studentCode: string) => void;
  onPrintSlip?: (slip: SlipData) => void;
  onPrintReport?: (spec: PrintableReportSpec) => void;
  compressImage: (file: File) => Promise<string>;
}

interface ParsedReceipt {
  id: string;
  date: string;
  receiptNo: string;
  typeLabel: string;
  isVisa: boolean;
  purpose: string;
  method: string;
  amount: number;
}

function parseReceiptRow(entry: CashEntry, idx: number): ParsedReceipt {
  const note = entry.note || '';
  const isVisa =
    entry.category === 'Visa Deposit' ||
    (entry.category !== 'Course Deposit' && /visa/i.test(note));
  const receiptMatch = note.match(/(?:Ref|Receipt)\s*:\s*([^|]+)/i);
  const methodMatch = note.match(/Method\s*:\s*([^|]+)/i);
  const purposeMatch = note.match(/Purpose\s*:\s*([^|]+)/i);

  const fallbackReceipt = `RCP-${entry.date.replace(/-/g, '')}-${String(idx + 1).padStart(3, '0')}`;
  return {
    id: entry.id,
    date: entry.date,
    receiptNo: receiptMatch?.[1]?.trim() || fallbackReceipt,
    typeLabel: isVisa ? 'Visa Deposit' : 'Course Fee',
    isVisa,
    purpose:
      purposeMatch?.[1]?.trim() ||
      (isVisa ? 'Visa Processing Deposit' : 'Course Fee Installment'),
    method: methodMatch?.[1]?.trim() || 'Cash',
    amount: Number(entry.amt || 0),
  };
}

export function StudentProfileModal({
  student,
  jobs,
  returns,
  prices,
  cash,
  companies = [],
  auditLogs = [],
  staff = [],
  lang,
  onClose,
  onEdit,
  onUpdate,
  onAdd,
  onLogAudit,
  onOpenDeposit,
  onIssueJob,
  onPrintSlip,
  onPrintReport,
  compressImage,
}: StudentProfileModalProps) {
  const bn = lang === 'bn';
  const photoUploadRef = useRef<HTMLInputElement>(null);
  const passportUploadRef = useRef<HTMLInputElement>(null);

  const [fullScreen, setFullScreen] = useState(true);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [passportPreviewOpen, setPassportPreviewOpen] = useState(false);
  const [retrainingJob, setRetrainingJob] = useState<JobEntry | null>(null);
  const [retrainAct, setRetrainAct] = useState<ReturnTypeOption>('Plate Return');
  const [retrainFee, setRetrainFee] = useState('0');
  const [retrainReason, setRetrainReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingInterview, setEditingInterview] = useState(false);
  const [ivCompany, setIvCompany] = useState('');
  const [ivDate, setIvDate] = useState('');
  const [ivStatus, setIvStatus] = useState<OverseasStatus>('Selected');
  const [ivDest, setIvDest] = useState('');
  const [ivNotice, setIvNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [rentCatTarget, setRentCatTarget] = useState<string | null>(null);
  const [rentExtraInput, setRentExtraInput] = useState('5');
  const [rentSupervisorName, setRentSupervisorName] = useState('Supervisor');
  const [rentNotice, setRentNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );
  const [showDueDateEditor, setShowDueDateEditor] = useState(false);
  const [profileDueDateInput, setProfileDueDateInput] = useState(() =>
    defaultPromiseDateYYYYMMDD(7)
  );
  const [profileDueSupervisor, setProfileDueSupervisor] = useState('সুপারভাইজার');
  const [dueDateMsg, setDueDateMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  const stuJobs = useMemo(() => {
    if (!student) return [];
    const normCode = student.code.trim().toLowerCase();
    return jobs.filter((j) => j.sid.trim().toLowerCase() === normCode);
  }, [jobs, student]);

  const stuReturns = useMemo(() => {
    if (!student) return [];
    const normCode = student.code.trim().toLowerCase();
    const normName = student.name.trim().toLowerCase();
    return returns.filter(
      (r) =>
        r.code.trim().toLowerCase() === normCode ||
        r.sname.trim().toLowerCase() === normName
    );
  }, [returns, student]);

  const stuReceipts = useMemo(() => {
    if (!student) return [];
    const code = student.code.trim().toLowerCase();
    const name = student.name.trim().toLowerCase();
    const matched = cash.filter((c) => {
      if (c.type !== 'in') return false;
      if (c.category !== 'Course Deposit' && c.category !== 'Visa Deposit') return false;
      const n = (c.note || '').toLowerCase();
      return (
        (code && (n.includes(`(${code})`) || n.includes(`code: ${code}`))) ||
        (name && n.includes(name))
      );
    });
    return matched.map(parseReceiptRow);
  }, [cash, student]);

  const quotaCategories = useMemo(() => {
    const map = new Map<string, { cat: string; limit: number; price: number }>();
    prices.forEach((p) => {
      map.set(p.cat, { cat: p.cat, limit: Number(p.limit || 0), price: Number(p.price || 0) });
    });
    stuJobs.forEach((j) => {
      if (!map.has(j.cat)) {
        map.set(j.cat, { cat: j.cat, limit: 0, price: Number(j.pay || 0) });
      }
    });
    return Array.from(map.values());
  }, [prices, stuJobs]);

  if (!student) return null;

  const jobBalanceSummary = computeStudentJobBalanceSummary({
    studentCode: student.code,
    studentName: student.name,
    deposit: student.deposit,
    jobs: stuJobs,
    returns: stuReturns,
  });
  const totalJobsCost = jobBalanceSummary.totalJobsCost;
  const returnedJobsRefund = jobBalanceSummary.returnedRefund;
  const netJobsCost = jobBalanceSummary.netJobsCost;
  const contractAmt = Number(student.contract || 0);
  const depositAmt = Number(student.deposit || 0);
  const courseDue = Math.max(0, contractAmt - depositAmt);
  const jobBalance = jobBalanceSummary.jobBalance;
  const totalAccumulatedDue = stuJobs.reduce((acc, j) => {
    const normJobNo = (j.no || '').trim().toLowerCase();
    if (normJobNo && jobBalanceSummary.returnedJobNos.has(normJobNo)) return acc;
    const meta = parseDueJobNote(j.note, j.pay, j.paid);
    return acc + (meta.isDueEntry ? meta.dueAmount : 0);
  }, 0);
  const dueDateApproval = getStudentDueDateApproval(auditLogs, student.code);
  const visaDepositTotal = stuReceipts
    .filter((r) => r.isVisa)
    .reduce((acc, r) => acc + r.amount, 0);
  const courseReceiptTotal = stuReceipts
    .filter((r) => !r.isVisa)
    .reduce((acc, r) => acc + r.amount, 0);
  const untrackedInitialDeposit = Math.max(0, depositAmt - courseReceiptTotal);
  const grandTotalDeposited = depositAmt + visaDepositTotal;

  const waDigits = (student.phone || '').replace(/[^0-9]/g, '');
  const waHref = waDigits
    ? `https://wa.me/${waDigits.startsWith('0') ? `88${waDigits}` : waDigits}`
    : '';

  const handlePhotoUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadError(null);
    setBusy(true);
    try {
      const compressed = await compressImage(file);
      await onUpdate('students', student.id, { photoData: compressed });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to upload photo.');
    } finally {
      setBusy(false);
    }
  };

  const handlePassportCopyUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadError(null);
    setBusy(true);
    try {
      const compressed = await compressImage(file);
      await onUpdate('students', student.id, {
        passportCopyData: compressed,
        passportSubmitted: true,
      });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to upload passport copy.');
    } finally {
      setBusy(false);
    }
  };

  const handlePrintProfile = () => {
    onPrintReport?.({
      title: `Student Profile: ${student.name} (${student.code})`,
      subtitle: [
        `Father: ${student.fatherName || '—'}`,
        `Mobile: ${student.phone || '—'}`,
        `Admission: ${student.date}`,
        `Contract: ${formatTaka(contractAmt)}`,
        `Paid: ${formatTaka(depositAmt)}`,
        `Due: ${formatTaka(courseDue)}`,
        `Job Balance: ${formatTaka(jobBalance)}`,
        `Visa Deposit: ${formatTaka(visaDepositTotal)}`,
        `Interview Passed: ${student.interviewPassedCompany || 'Pending'}`,
      ].join(' · '),
      filename: `student-profile-${student.code.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
      columns: ['Date', 'Job No', 'Category', 'Price', 'Payable', 'Method'],
      rows:
        stuJobs.length > 0
          ? stuJobs.map((j) => [
              j.date,
              j.no,
              j.cat,
              formatTaka(j.pay),
              formatTaka(j.paid),
              j.verificationMethod === 'supervisor' ? 'Supervisor' : 'Biometric',
            ])
          : [['—', 'No completed jobs', '—', formatTaka(0), formatTaka(0), '—']],
    });
  };

  const handleExcelExport = () => {
    const profileSheet = XLSX.utils.json_to_sheet([
      {
        Code: student.code,
        Name: student.name,
        Father: student.fatherName,
        Mother: student.motherName,
        Mobile: student.phone,
        GuardianMobile: student.guardianPhone,
        Address: student.district,
        NID: student.nid || '',
        Trade: student.trade,
        AdmissionDate: student.date,
        PassportNo: student.passportNo || '',
        OverseasStatus: student.overseasStatus,
        TargetCountry: student.destination,
        ForeignCompany: student.companyName,
        InterviewPassedCompany: student.interviewPassedCompany || '',
        InterviewDate: student.interviewDate || '',
        Contract: contractAmt,
        CoursePaid: depositAmt,
        CourseDue: courseDue,
        JobBalance: jobBalance,
        UsedJobs: stuJobs.length,
        UsedJobsCost: totalJobsCost,
        JobReturns: stuReturns.length,
        VisaDeposit: visaDepositTotal,
        GrandTotalDeposited: grandTotalDeposited,
        Remarks: student.note || '',
      },
    ]);
    const quotaSheet = XLSX.utils.json_to_sheet(
      quotaCategories.map((q) => {
        const used = stuJobs.filter((j) => j.cat === q.cat).length;
        const rent = getStudentCategoryRentedLimit(auditLogs, student.code, q.cat);
        const check = canEnterJob({
          baseLimit: q.limit,
          rentedLimit: rent.rentedLimit,
          currentEntries: used,
        });
        return {
          Category: q.cat,
          BaseLimit: check.baseLimit,
          SupervisorRented: check.rentedLimit,
          SupervisorName: rent.rentedBySupervisor || '',
          TotalAllowedLimit: check.totalAllowedLimit,
          UsedJobs: check.currentEntries,
          Remaining: check.remainingLimit,
          StandardPrice: q.price,
        };
      })
    );
    const jobsSheet = XLSX.utils.json_to_sheet(
      stuJobs.map((j) => ({
        Date: j.date,
        JobNo: j.no,
        Category: j.cat,
        Price: j.pay,
        Payable: j.paid,
        Note: j.note || '',
      }))
    );
    const receiptsSheet = XLSX.utils.json_to_sheet(
      stuReceipts.map((r) => ({
        Date: r.date,
        ReceiptNo: r.receiptNo,
        Type: r.typeLabel,
        Purpose: r.purpose,
        Method: r.method,
        Amount: r.amount,
      }))
    );

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, profileSheet, 'Profile');
    XLSX.utils.book_append_sheet(wb, quotaSheet, 'JobQuota');
    XLSX.utils.book_append_sheet(wb, jobsSheet, 'Jobs');
    XLSX.utils.book_append_sheet(wb, receiptsSheet, 'Payments');
    const safeCode = student.code.replace(/[^a-zA-Z0-9_-]/g, '_');
    XLSX.writeFile(wb, `profile-${safeCode}.xlsx`);
  };

  const handleConfirmRetrain = async () => {
    if (!retrainingJob) return;
    const normNo = retrainingJob.no.trim().toLowerCase();
    if (jobBalanceSummary.returnedJobNos.has(normNo)) {
      setRetrainingJob(null);
      return;
    }
    const feeNum = Math.max(0, Number(retrainFee) || 0);
    const refundAmt = Math.max(0, Number(retrainingJob.pay || 0) - feeNum);
    setBusy(true);
    try {
      await onAdd('returns', {
        date: todayDDMMYYYY(),
        no: retrainingJob.no,
        code: student.code,
        sname: student.name,
        cat: retrainingJob.cat,
        reason: retrainReason.trim() || 'Plate return / Retrain from Student Profile',
        act: retrainAct,
        fee: feeNum,
      });
      await onLogAudit?.(
        'LOG_RETRAIN',
        'Student Profile',
        `Logged ${retrainAct} for ${student.name} (${student.code}) on job ${retrainingJob.no}${
          refundAmt > 0 ? ` · Refund +${refundAmt}৳ to Profile` : ''
        }`
      );
      setRetrainingJob(null);
      setRetrainReason('');
      setRetrainFee('0');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[1px] flex items-center justify-center ${
        fullScreen ? 'p-0' : 'p-3 sm:p-6'
      }`}
      role="dialog"
      aria-modal="true"
      aria-label={`Student Profile: ${student.name}`}
    >
      <div
        className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col overflow-hidden ${
          fullScreen
            ? 'w-full h-full max-w-none rounded-none'
            : 'w-full max-w-6xl max-h-[94vh] rounded-2xl'
        }`}
      >
        {/* Top Modal Header */}
        <div className="px-5 sm:px-6 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0 bg-white dark:bg-slate-900">
          <div className="flex items-center gap-2.5 min-w-0">
            <h2 className="font-display text-sm sm:text-base font-extrabold text-slate-900 dark:text-white truncate">
              Student Profile &amp; Academic File: {student.code} · {student.name}
            </h2>
            {fullScreen && (
              <span className="px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-[10px] font-bold tracking-wide text-emerald-700 dark:text-emerald-300 uppercase shrink-0">
                FULL SCREEN
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setFullScreen((v) => !v)}
              aria-label={fullScreen ? 'Exit full screen' : 'Full screen'}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              {fullScreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close profile"
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5 bg-slate-50/40 dark:bg-slate-950/40">
          {uploadError && (
            <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-2.5 text-xs font-medium text-red-700 dark:text-red-300 flex items-center justify-between">
              <span>{uploadError}</span>
              <button
                type="button"
                onClick={() => setUploadError(null)}
                className="font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>
          )}

          {/* 1. Hero Student Header Card */}
          <div className="rounded-xl border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/35 dark:bg-emerald-950/20 p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="flex items-start gap-4 min-w-0">
              <div className="flex flex-col items-center gap-1.5 shrink-0">
                <div className="w-16 h-16 rounded-xl border-2 border-teal-500 bg-white dark:bg-slate-900 flex items-center justify-center overflow-hidden">
                  {student.photoData ? (
                    <img
                      src={student.photoData}
                      alt={student.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <User className="w-8 h-8 text-teal-600 dark:text-teal-400" />
                  )}
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => photoUploadRef.current?.click()}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-teal-600 hover:bg-teal-700 text-white text-[10px] font-semibold cursor-pointer whitespace-nowrap"
                >
                  <Upload className="w-2.5 h-2.5" />
                  <span>ছবি আপলোড</span>
                </button>
                <input
                  ref={photoUploadRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handlePhotoUpload}
                  className="hidden"
                />
              </div>

              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded bg-teal-900 dark:bg-teal-800 text-white font-mono-num text-[11px] font-bold">
                    CODE: {student.code}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[11px] font-semibold border ${
                      student.bioEnrolled
                        ? 'bg-emerald-100 dark:bg-emerald-950/70 border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300'
                        : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    <Fingerprint className="w-3 h-3" />
                    <span>{student.bioEnrolled ? 'Bio Enrolled' : 'Bio Not Enrolled'}</span>
                  </span>
                </div>

                <h3 className="font-display text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                  {student.name}
                </h3>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
                  <span>
                    Father: <strong className="text-slate-800 dark:text-slate-100">{student.fatherName || '—'}</strong>
                  </span>
                  <span>
                    Mother: <strong className="text-slate-800 dark:text-slate-100">{student.motherName || '—'}</strong>
                  </span>
                  <span>
                    Admission: <strong className="font-mono-num text-slate-800 dark:text-slate-100">{student.date}</strong>
                  </span>
                  <span>
                    Address: <strong className="text-slate-800 dark:text-slate-100">{student.district || '-'}</strong>
                  </span>
                  <span>
                    Mobile: <strong className="font-mono-num text-slate-800 dark:text-slate-100">{student.phone || '—'}</strong>
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  <span className="px-2.5 py-0.5 rounded border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 text-[11px] font-semibold">
                    Guardian Mobile: <span className="font-mono-num">{student.guardianPhone || 'No number'}</span>
                  </span>
                  <span className="px-2.5 py-0.5 rounded border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-800 dark:text-indigo-300 text-[11px] font-semibold">
                    NID No: <span className="font-mono-num">{student.nid || 'No data'}</span>
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {student.phone ? (
                    <>
                      <a
                        href={`tel:${student.phone}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold"
                      >
                        <Phone className="w-3.5 h-3.5" />
                        <span>Call Student</span>
                      </a>
                      <a
                        href={waHref}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
                      >
                        <MessageCircle className="w-3.5 h-3.5" />
                        <span>WhatsApp</span>
                      </a>
                    </>
                  ) : (
                    <span className="text-[11px] text-slate-400">No student mobile number recorded</span>
                  )}
                </div>
              </div>
            </div>

            {/* Right Action Stack */}
            <div className="grid grid-cols-2 lg:grid-cols-1 gap-2 shrink-0 lg:w-44">
              {onIssueJob && (
                <button
                  type="button"
                  onClick={() => onIssueJob(student.code)}
                  className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ Issue Job</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => onOpenDeposit({ student, depositType: 'course' })}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer"
              >
                <Wallet className="w-3.5 h-3.5" />
                <span>+ Deposit Payment</span>
              </button>
              <button
                type="button"
                onClick={handlePrintProfile}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print Profile</span>
              </button>
              <button
                type="button"
                onClick={handleExcelExport}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg border border-emerald-300 dark:border-emerald-800 bg-white dark:bg-slate-900 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 text-xs font-semibold cursor-pointer"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Excel Export</span>
              </button>
            </div>
          </div>

          {/* 2. 7 KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5">
              <div className="text-[10px] font-bold uppercase text-slate-500">কোর্স চুক্তি (CONTRACT)</div>
              <div className="font-mono-num text-lg font-extrabold text-slate-900 dark:text-white mt-1">
                {formatTaka(contractAmt)}
              </div>
            </div>

            <div className="rounded-xl border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/40 dark:bg-emerald-950/20 p-3.5">
              <div className="text-[10px] font-bold uppercase text-teal-700 dark:text-teal-400">COURSE PAID</div>
              <div className="font-mono-num text-lg font-extrabold text-teal-700 dark:text-teal-300 mt-1">
                {formatTaka(depositAmt)}
              </div>
            </div>

            <div className="rounded-xl border border-amber-200 dark:border-amber-800/70 bg-amber-50/40 dark:bg-amber-950/20 p-3.5">
              <div className="text-[10px] font-bold uppercase text-amber-700 dark:text-amber-400">COURSE DUE</div>
              <div className="font-mono-num text-lg font-extrabold text-amber-700 dark:text-amber-300 mt-1">
                {formatTaka(courseDue)}
              </div>
            </div>

            <div className="rounded-xl border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/50 dark:bg-emerald-950/25 p-3.5">
              <div className="text-[10px] font-bold uppercase text-emerald-700 dark:text-emerald-400">
                DEPOSIT BALANCE (JOB BAL)
              </div>
              <div className="font-mono-num text-lg font-extrabold text-emerald-700 dark:text-emerald-300 mt-1">
                {formatTaka(jobBalance)}
              </div>
              <div className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-0.5">
                {returnedJobsRefund > 0
                  ? bn
                    ? `রিটার্ন ফেরত যোগ: +${formatTaka(returnedJobsRefund)}`
                    : `Includes +${formatTaka(returnedJobsRefund)} return refund`
                  : 'Remaining balance for jobs'}
              </div>
            </div>

            <div className="rounded-xl border border-blue-200 dark:border-blue-800/70 bg-blue-50/40 dark:bg-blue-950/20 p-3.5">
              <div className="text-[10px] font-bold uppercase text-blue-700 dark:text-blue-400">USED JOBS</div>
              <div className="font-mono-num text-lg font-extrabold text-blue-700 dark:text-blue-300 mt-1">
                {stuJobs.length} Jobs
              </div>
              <div className="text-[10px] text-blue-600 dark:text-blue-400 font-mono-num mt-0.5">
                {returnedJobsRefund > 0
                  ? `Net: ${formatTaka(netJobsCost)} (Gross ${formatTaka(totalJobsCost)})`
                  : `Cost: ${formatTaka(totalJobsCost)}`}
              </div>
            </div>

            <div className="rounded-xl border border-rose-200 dark:border-rose-800/70 bg-rose-50/40 dark:bg-rose-950/20 p-3.5">
              <div className="text-[10px] font-bold uppercase text-rose-700 dark:text-rose-400">JOB RETURNS</div>
              <div className="font-mono-num text-lg font-extrabold text-rose-700 dark:text-rose-300 mt-1">
                {stuReturns.length}
              </div>
              <div className="text-[10px] text-rose-600 dark:text-rose-400 font-mono-num mt-0.5">
                {stuReturns.length === 0
                  ? 'No returns'
                  : returnedJobsRefund > 0
                    ? bn
                      ? `প্রোফাইলে যোগ: +${formatTaka(returnedJobsRefund)}`
                      : `Credited: +${formatTaka(returnedJobsRefund)}`
                    : `${stuReturns.length} returns`}
              </div>
            </div>

            <div className="rounded-xl border border-indigo-200 dark:border-indigo-800/70 bg-indigo-50/40 dark:bg-indigo-950/20 p-3.5">
              <div className="text-[10px] font-bold uppercase text-indigo-700 dark:text-indigo-400">
                VISA DEPOSIT (SEPARATE)
              </div>
              <div className="font-mono-num text-lg font-extrabold text-indigo-700 dark:text-indigo-300 mt-1">
                {formatTaka(visaDepositTotal)}
              </div>
              <div className="text-[10px] text-indigo-600 dark:text-indigo-400 mt-0.5">
                Visa Purpose Fee
              </div>
            </div>
          </div>

          {/* Supervisor Due-Date Grace Period Strip */}
          {(dueDateApproval.dueDate || totalAccumulatedDue > 0 || jobBalance === 0) && (
            <div
              className={`rounded-xl border p-3.5 space-y-2.5 ${
                dueDateApproval.isGracePeriodActive
                  ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/25'
                  : 'border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/25'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-extrabold text-slate-900 dark:text-white">
                    বকেয়া জব অনুমোদনের মেয়াদ:
                  </span>
                  {dueDateApproval.isGracePeriodActive ? (
                    <span className="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200 font-bold font-mono-num">
                      সক্রিয় ({dueDateApproval.dueDate} পর্যন্ত · {dueDateApproval.approvedBySupervisor})
                    </span>
                  ) : dueDateApproval.dueDate ? (
                    <span className="px-2 py-0.5 rounded bg-rose-100 dark:bg-rose-900/60 text-rose-800 dark:text-rose-200 font-bold font-mono-num">
                      মেয়াদ শেষ ({dueDateApproval.dueDate})
                    </span>
                  ) : (
                    <span className="text-slate-600 dark:text-slate-300 font-medium">
                      এখনো নির্ধারিত হয়নি
                    </span>
                  )}
                  {totalAccumulatedDue > 0 && (
                    <span className="px-2 py-0.5 rounded bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 font-mono-num font-bold">
                      জমে থাকা জব বকেয়া: {formatTaka(totalAccumulatedDue)}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowDueDateEditor((v) => !v);
                    setDueDateMsg(null);
                  }}
                  className="px-3 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs font-bold cursor-pointer hover:bg-slate-50"
                >
                  {showDueDateEditor ? 'বন্ধ করুন' : 'বকেয়ার তারিখ দিন / পরিবর্তন'}
                </button>
              </div>

              {dueDateMsg && (
                <div
                  className={`text-xs font-semibold px-3 py-1.5 rounded-lg ${
                    dueDateMsg.type === 'success'
                      ? 'bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200'
                      : 'bg-red-100 dark:bg-red-900/60 text-red-800 dark:text-red-200'
                  }`}
                >
                  {dueDateMsg.text}
                </div>
              )}

              {showDueDateEditor && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 items-end pt-1">
                  <div>
                    <label className="block text-[11px] font-bold mb-1">কবে টাকা জমা দিবে *</label>
                    <input
                      type="date"
                      value={profileDueDateInput}
                      onChange={(e) => setProfileDueDateInput(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono-num"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold mb-1">সুপারভাইজারের নাম</label>
                    <input
                      list="profile-rent-supervisors"
                      value={profileDueSupervisor}
                      onChange={(e) => setProfileDueSupervisor(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      const res = setSupervisorDueDate(profileDueDateInput, profileDueSupervisor);
                      if (!res.success || !res.dueDate || !res.supervisorName) {
                        setDueDateMsg({ type: 'error', text: res.message });
                        return;
                      }
                      setBusy(true);
                      try {
                        const detail = buildDueDateAuditDetail(
                          student.code,
                          res.dueDate,
                          res.supervisorName
                        );
                        if (onLogAudit) {
                          await onLogAudit(SET_DUE_DATE_ACTION, 'Supervisor Due Date', detail);
                        } else {
                          await onAdd('auditLogs', {
                            action: SET_DUE_DATE_ACTION,
                            module: 'Supervisor Due Date',
                            detail,
                          });
                        }
                        setDueDateMsg({ type: 'success', text: res.message });
                        setShowDueDateEditor(false);
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold cursor-pointer"
                  >
                    {busy ? 'সংরক্ষণ হচ্ছে...' : 'তারিখ সংরক্ষণ করুন'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 3. Passport & Verification + Remarks */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
              <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wide text-slate-800 dark:text-slate-100">
                <FileText className="w-4 h-4 text-teal-600" />
                <span>PASSPORT &amp; VERIFICATION STATUS</span>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">Passport Submitted:</span>
                  <span
                    className={`px-2 py-0.5 rounded font-semibold ${
                      student.passportSubmitted || student.passportNo
                        ? 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {student.passportSubmitted || student.passportNo
                      ? `Yes (${student.passportNo || 'Submitted'})`
                      : 'No (Not submitted)'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">National ID (NID No):</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200 font-mono-num">
                    {student.nid || 'Not provided'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">Permanent Address:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {student.district || '-'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">Biometric Fingerprint:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {student.bioEnrolled ? 'Enrolled' : 'Not Enrolled'}
                  </span>
                </div>
              </div>

              <div className="pt-1 space-y-2">
                {student.passportCopyData && (
                  <div className="flex items-center justify-between gap-3 p-2 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20">
                    <div className="flex items-center gap-2.5">
                      <img
                        src={student.passportCopyData}
                        alt="Passport copy"
                        className="w-12 h-9 rounded object-cover border border-slate-200 dark:border-slate-700"
                      />
                      <span className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">
                        পাসপোর্ট কপি সংযুক্ত আছে
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPassportPreviewOpen(true)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-teal-600 hover:bg-teal-700 text-white text-[11px] font-semibold cursor-pointer"
                    >
                      <Eye className="w-3 h-3" />
                      <span>ভিউ (View)</span>
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => passportUploadRef.current?.click()}
                  className="w-full py-2.5 px-4 rounded-xl border-2 border-dashed border-teal-400/70 dark:border-teal-700 bg-emerald-50/20 dark:bg-emerald-950/10 hover:bg-emerald-50/60 dark:hover:bg-emerald-950/30 text-teal-700 dark:text-teal-300 text-xs font-bold inline-flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Upload className="w-4 h-4" />
                  <span>
                    {student.passportCopyData
                      ? 'পাসপোর্ট কপি পরিবর্তন করুন (Replace Passport)'
                      : 'পাসপোর্ট কপি আপলোড করুন (Upload Passport)'}
                  </span>
                </button>
                <p className="text-[11px] text-center text-slate-400">
                  * পাসপোর্টের ছবি বা স্ক্যান কপি আপলোড করুন। পরে &apos;ভিউ&apos; তে বড় করে দেখতে পারবেন।
                </p>
                <input
                  ref={passportUploadRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handlePassportCopyUpload}
                  className="hidden"
                />
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-col space-y-3">
              <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wide text-slate-800 dark:text-slate-100">
                <FileText className="w-4 h-4 text-indigo-600" />
                <span>মন্তব্য ও নোট (REMARKS)</span>
              </div>
              <div className="flex-1 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3.5 text-xs text-slate-600 dark:text-slate-300 italic">
                {student.note || 'No special remarks or notes.'}
              </div>
            </div>
          </div>

          {/* 4. Interview Pass Company & Overseas Placement Details */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wide text-slate-800 dark:text-slate-100">
                <Globe className="w-4 h-4 text-teal-600" />
                <span>
                  {bn
                    ? 'ইন্টারভিউ পাস কোম্পানি ও বিদেশগামী তথ্য (INTERVIEW & PLACEMENT)'
                    : 'INTERVIEW PASS & OVERSEAS PLACEMENT DETAILS'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIvNotice(null);
                  setIvCompany(student.interviewPassedCompany || student.companyName || '');
                  setIvDate(student.interviewDate || todayDDMMYYYY());
                  setIvStatus(student.overseasStatus || 'Selected');
                  setIvDest(student.destination || '');
                  setEditingInterview((v) => !v);
                }}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/50 hover:bg-indigo-100 text-indigo-700 dark:text-indigo-300 text-[11px] font-bold cursor-pointer"
              >
                <Award className="w-3.5 h-3.5" />
                <span>
                  {editingInterview
                    ? bn
                      ? 'বন্ধ করুন'
                      : 'Close'
                    : bn
                      ? 'ইন্টারভিউ পাস আপডেট'
                      : 'Update Interview Pass'}
                </span>
              </button>
            </div>

            {ivNotice && (
              <div
                className={`text-xs font-semibold px-3 py-2 rounded-lg ${
                  ivNotice.type === 'success'
                    ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                    : 'bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
                }`}
              >
                {ivNotice.text}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
              <div className="sm:col-span-2 rounded-lg border border-indigo-200 dark:border-indigo-800/80 bg-indigo-50/50 dark:bg-indigo-950/25 p-2.5">
                <div className="text-[11px] font-semibold text-indigo-700 dark:text-indigo-300">
                  {bn ? 'ইন্টারভিউ পাস কোম্পানি:' : 'Interview Passed Company:'}
                </div>
                <div className="font-extrabold text-sm text-indigo-950 dark:text-indigo-100 mt-0.5 flex items-center gap-1.5">
                  <Award className="w-4 h-4 text-indigo-600 shrink-0" />
                  <span>
                    {student.interviewPassedCompany ||
                      (bn ? 'এখনো ইন্টারভিউ পাস যুক্ত হয়নি' : 'Not Passed / Pending')}
                  </span>
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 p-2.5">
                <div className="text-[11px] text-slate-500">
                  {bn ? 'ইন্টারভিউ তারিখ:' : 'Interview Date:'}
                </div>
                <div className="font-mono-num font-bold text-slate-900 dark:text-white mt-0.5">
                  {student.interviewDate || '—'}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 p-2.5">
                <div className="text-[11px] text-slate-500">Selection Status:</div>
                <div className="font-bold text-slate-900 dark:text-white mt-0.5">
                  {student.overseasStatus || 'Not Applied'}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 p-2.5">
                <div className="text-[11px] text-slate-500">Target Country:</div>
                <div className="font-bold text-slate-900 dark:text-white mt-0.5">
                  {student.destination || 'Not Specified'}
                </div>
              </div>
            </div>

            {editingInterview && (
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 items-end">
                <div className="lg:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                    {bn ? 'ইন্টারভিউ পাস কোম্পানি *' : 'Interview Passed Company *'}
                  </label>
                  <input
                    list="profile-interview-companies"
                    value={ivCompany}
                    onChange={(e) => setIvCompany(e.target.value)}
                    placeholder={bn ? 'কোম্পানির নাম লিখুন বা বাছুন' : 'Select or type company name'}
                    className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                  <datalist id="profile-interview-companies">
                    {companies.map((c) => (
                      <option key={c.id} value={c.name} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                    {bn ? 'ইন্টারভিউ তারিখ' : 'Interview Date'}
                  </label>
                  <input
                    value={ivDate}
                    onChange={(e) => setIvDate(e.target.value)}
                    placeholder="DD-MM-YYYY"
                    className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono-num"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                    {bn ? 'গন্তব্য ও স্ট্যাটাস' : 'Country / Status'}
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      value={ivDest}
                      onChange={(e) => setIvDest(e.target.value)}
                      placeholder="Country"
                      className="w-1/2 px-2 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                    />
                    <select
                      value={ivStatus}
                      onChange={(e) => setIvStatus(e.target.value as OverseasStatus)}
                      className="w-1/2 px-1.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                    >
                      <option value="Not Applied">Not Applied</option>
                      <option value="Interview Attended">Interview Attended</option>
                      <option value="Selected">Selected</option>
                      <option value="Visa Processing">Visa Processing</option>
                      <option value="Flight Ready">Flight Ready</option>
                    </select>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    const comp = ivCompany.trim();
                    setBusy(true);
                    setIvNotice(null);
                    try {
                      await onUpdate('students', student.id, {
                        interviewPassedCompany: comp,
                        interviewDate: comp ? ivDate.trim() || todayDDMMYYYY() : '',
                        companyName: comp || student.companyName,
                        overseasStatus: ivStatus,
                        destination: ivDest.trim(),
                      });
                      await onLogAudit?.(
                        'UPDATE_INTERVIEW_PASS',
                        'Student Profile',
                        `${student.name} (${student.code}) · Interview Company: ${comp || 'Cleared'} · Date: ${
                          ivDate.trim() || '—'
                        }`
                      );
                      setIvNotice({
                        type: 'success',
                        text: bn
                          ? 'ইন্টারভিউ পাস কোম্পানির তথ্য সংরক্ষিত হয়েছে!'
                          : 'Saved interview pass company details!',
                      });
                      setEditingInterview(false);
                    } catch (err) {
                      setIvNotice({
                        type: 'error',
                        text: err instanceof Error ? err.message : 'Failed to update interview pass.',
                      });
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{busy ? '...' : bn ? 'সংরক্ষণ' : 'Save'}</span>
                </button>
              </div>
            )}
          </div>

          {/* 5. Student Job Quota & Practical Progress */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <div className="px-4 py-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="w-8 h-8 rounded-lg bg-teal-600 text-white flex items-center justify-center shrink-0">
                  <Briefcase className="w-4 h-4" />
                </span>
                <div>
                  <h4 className="text-xs font-extrabold uppercase tracking-wide text-slate-900 dark:text-white">
                    STUDENT JOB QUOTA &amp; PRACTICAL PROGRESS
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    (Used Jobs can only be edited from Super Admin panel · Supervisor can rent extra limit per category)
                  </p>
                </div>
              </div>
              {rentNotice && (
                <div
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold ${
                    rentNotice.type === 'success'
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                      : 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
                  }`}
                >
                  {rentNotice.text}
                </div>
              )}
            </div>

            {rentCatTarget && (
              <div className="px-4 py-3 bg-indigo-50/80 dark:bg-indigo-950/35 border-b border-indigo-200 dark:border-indigo-800 flex flex-wrap items-end gap-3">
                <div className="text-xs font-bold text-indigo-900 dark:text-indigo-200 mr-auto">
                  সুপারভাইজার লিমিট ভাড়া: <span className="underline">{rentCatTarget}</span>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                    অতিরিক্ত লিমিট *
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={rentExtraInput}
                    onChange={(e) => setRentExtraInput(e.target.value)}
                    className="w-24 px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono-num"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                    সুপারভাইজারের নাম
                  </label>
                  <input
                    list="profile-rent-supervisors"
                    value={rentSupervisorName}
                    onChange={(e) => setRentSupervisorName(e.target.value)}
                    placeholder="Supervisor"
                    className="w-44 px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                  <datalist id="profile-rent-supervisors">
                    <option value="Supervisor" />
                    {staff.map((st) => (
                      <option key={st.id} value={st.name}>
                        {st.role}
                      </option>
                    ))}
                  </datalist>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      const targetQuota = quotaCategories.find((x) => x.cat === rentCatTarget);
                      const rentInfo = getStudentCategoryRentedLimit(
                        auditLogs,
                        student.code,
                        rentCatTarget
                      );
                      const currentTotal = (targetQuota?.limit ?? 0) + rentInfo.rentedLimit;
                      const res = rentSupervisorLimit(
                        rentExtraInput,
                        rentSupervisorName,
                        currentTotal
                      );
                      if (!res.success || !res.amount || !res.supervisorName) {
                        setRentNotice({ type: 'error', text: res.message });
                        return;
                      }
                      setBusy(true);
                      try {
                        if (onLogAudit) {
                          await onLogAudit(
                            RENT_LIMIT_ACTION,
                            'Supervisor Limit',
                            buildRentLimitAuditDetail(
                              student.code,
                              rentCatTarget,
                              res.amount,
                              res.supervisorName
                            )
                          );
                        } else {
                          await onAdd('auditLogs', {
                            action: RENT_LIMIT_ACTION,
                            module: 'Supervisor Limit',
                            detail: buildRentLimitAuditDetail(
                              student.code,
                              rentCatTarget,
                              res.amount,
                              res.supervisorName
                            ),
                          });
                        }
                        setRentNotice({ type: 'success', text: res.message });
                        setRentCatTarget(null);
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer"
                  >
                    {busy ? 'যুক্ত হচ্ছে...' : 'যুক্ত করুন'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRentCatTarget(null)}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold cursor-pointer"
                  >
                    বাতিল
                  </button>
                </div>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-slate-500 font-semibold">
                    <th className="py-2.5 px-4">Category</th>
                    <th className="py-2.5 px-3 text-center">Base Limit</th>
                    <th className="py-2.5 px-3 text-center">Rented (Sup.)</th>
                    <th className="py-2.5 px-3 text-center">Total Limit</th>
                    <th className="py-2.5 px-3 text-center">Used Jobs</th>
                    <th className="py-2.5 px-3 text-center">Remaining</th>
                    <th className="py-2.5 px-4 text-right">Standard Price</th>
                    <th className="py-2.5 px-4 text-right">Supervisor Rent</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {quotaCategories.map((q) => {
                    const used = stuJobs.filter((j) => j.cat === q.cat).length;
                    const rentInfo = getStudentCategoryRentedLimit(auditLogs, student.code, q.cat);
                    const check = canEnterJob({
                      baseLimit: q.limit,
                      rentedLimit: rentInfo.rentedLimit,
                      currentEntries: used,
                    });
                    return (
                      <tr key={q.cat} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="py-2.5 px-4 font-bold text-slate-900 dark:text-white">
                          {q.cat}
                        </td>
                        <td className="py-2.5 px-3 text-center font-mono-num text-slate-600 dark:text-slate-300">
                          {check.baseLimit}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          {check.rentedLimit > 0 ? (
                            <span
                              title={rentInfo.rentedBySupervisor}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 font-mono-num font-bold text-indigo-700 dark:text-indigo-300"
                            >
                              +{check.rentedLimit}
                              {rentInfo.rentedBySupervisor && (
                                <span className="font-sans font-medium text-[10px]">
                                  ({rentInfo.rentedBySupervisor})
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="text-slate-400 font-mono-num">0</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-center font-mono-num font-bold text-slate-900 dark:text-white">
                          {check.totalAllowedLimit}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span className="inline-block min-w-6 px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono-num font-bold text-slate-700 dark:text-slate-200">
                            {check.currentEntries}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span
                            className={`inline-block min-w-6 px-2 py-0.5 rounded font-mono-num font-bold ${
                              !check.allowed
                                ? 'bg-rose-100 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300'
                                : 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300'
                            }`}
                          >
                            {check.remainingLimit}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono-num text-slate-700 dark:text-slate-200">
                          {formatTaka(q.price)}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              setRentCatTarget(q.cat);
                              setRentExtraInput('5');
                              setRentNotice(null);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-indigo-200 dark:border-indigo-800 bg-indigo-50/80 dark:bg-indigo-950/40 hover:bg-indigo-100 text-[11px] font-semibold text-indigo-700 dark:text-indigo-300 cursor-pointer"
                          >
                            <Plus className="w-3 h-3" />
                            <span>লিমিট ভাড়া</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* 6. Completed Job Register History */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-xs font-extrabold uppercase tracking-wide text-slate-900 dark:text-white">
                COMPLETED JOB REGISTER HISTORY ({stuJobs.length})
              </h4>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-600 dark:text-slate-300">
                  মোট সম্পন্ন: <strong>{stuJobs.length} টি</strong>
                </span>
                <span className="px-2.5 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 font-mono-num font-bold">
                  মোট জব মেরেছে: {formatTaka(totalJobsCost)}
                </span>
              </div>
            </div>

            {stuJobs.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                এখনো কোনো সম্পন্ন জব রেকর্ড নেই।
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-slate-500 font-semibold">
                      <th className="py-2.5 px-4">Date</th>
                      <th className="py-2.5 px-4">Job No</th>
                      <th className="py-2.5 px-4">Category</th>
                      <th className="py-2.5 px-4 text-right">Price</th>
                      <th className="py-2.5 px-4 text-right">Payable</th>
                      <th className="py-2.5 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {stuJobs.map((j) => {
                      const dueMeta = parseDueJobNote(j.note, j.pay, j.paid);
                      const normJobNo = (j.no || '').trim().toLowerCase();
                      const isReturned = normJobNo ? jobBalanceSummary.returnedJobNos.has(normJobNo) : false;
                      const refundedAmt = normJobNo ? jobBalanceSummary.refundByJobNo.get(normJobNo) || 0 : 0;
                      return (
                      <tr key={j.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="py-2.5 px-4 font-mono-num">{j.date}</td>
                        <td className="py-2.5 px-4 font-mono-num font-bold text-slate-900 dark:text-white">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span>{j.no}</span>
                            {isReturned && (
                              <span className="px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800 text-[9px] font-bold text-emerald-700 dark:text-emerald-300">
                                RETURNED{refundedAmt > 0 ? ` (+${formatTaka(refundedAmt)})` : ''}
                              </span>
                            )}
                            {dueMeta.isDueEntry && !isReturned && (
                              <span className="px-1.5 py-0.5 rounded bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800 text-[9px] font-bold text-rose-700 dark:text-rose-300">
                                বকেয়া {formatTaka(dueMeta.dueAmount)}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 px-4 font-semibold">{j.cat}</td>
                        <td className="py-2.5 px-4 text-right font-mono-num text-slate-500">
                          {formatTaka(j.pay)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono-num font-bold text-slate-900 dark:text-white">
                          {formatTaka(j.paid)}
                        </td>
                        <td className="py-2.5 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => onPrintSlip?.(buildJobSlipFromEntry(j))}
                              className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 text-[11px] font-semibold cursor-pointer"
                            >
                              Print Token
                            </button>
                            {!isReturned && (
                              <button
                                type="button"
                                onClick={() => {
                                  setRetrainingJob(j);
                                  setRetrainAct('Plate Return');
                                  setRetrainFee('0');
                                  setRetrainReason('');
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 text-amber-800 dark:text-amber-300 text-[11px] font-semibold cursor-pointer"
                              >
                                <RotateCcw className="w-3 h-3" />
                                <span>{bn ? 'রিটার্ন' : 'Return / Retrain'}</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );})}
                    <tr className="bg-slate-50/70 dark:bg-slate-800/40 font-bold">
                      <td colSpan={4} className="py-2.5 px-4 text-right text-slate-700 dark:text-slate-200">
                        মোট সম্পন্ন জবের হিসাব ({stuJobs.length} টি জব{returnedJobsRefund > 0 ? ` · রিটার্ন ফেরত -${formatTaka(returnedJobsRefund)}` : ''}):
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono-num text-blue-700 dark:text-blue-300">
                        {formatTaka(netJobsCost)}
                      </td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 7. Job Return & Retrain History */}
          <div className="rounded-xl border border-rose-200 dark:border-rose-900/70 bg-white dark:bg-slate-900 overflow-hidden">
            <div className="px-4 py-3 border-b border-rose-200 dark:border-rose-900/70 bg-rose-50/70 dark:bg-rose-950/30 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wide text-rose-800 dark:text-rose-300">
                <RotateCcw className="w-4 h-4" />
                <span>JOB RETURN &amp; RETRAIN HISTORY (মোট জব রিটার্ন: {stuReturns.length} টি)</span>
              </div>
              <span className="px-2.5 py-0.5 rounded bg-rose-100 dark:bg-rose-900/60 text-rose-800 dark:text-rose-200 text-xs font-bold">
                মোট রিটার্ন: {stuReturns.length} টি
              </span>
            </div>

            {stuReturns.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500 italic">
                এই স্টুডেন্ট কোনো জব রিটার্ন করেনি (০ টি)।
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-rose-100 dark:border-rose-900/50 bg-rose-50/30 dark:bg-rose-950/15 text-slate-600 dark:text-slate-300 font-semibold">
                      <th className="py-2.5 px-4">রিটার্ন তারিখ</th>
                      <th className="py-2.5 px-4">মূল জব নম্বর</th>
                      <th className="py-2.5 px-4">ক্যাটাগরি</th>
                      <th className="py-2.5 px-4">রিটার্নের ধরন</th>
                      <th className="py-2.5 px-4">ত্রুটির কারণ / পরিদর্শকের মন্তব্য</th>
                      <th className="py-2.5 px-4 text-right">টোকেন স্ট্যাটাস</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {stuReturns.map((r) => {
                      const normNo = (r.no || '').trim().toLowerCase();
                      const refundAmt = normNo ? jobBalanceSummary.refundByJobNo.get(normNo) || 0 : 0;
                      return (
                      <tr key={r.id}>
                        <td className="py-2.5 px-4 font-mono-num">{r.date}</td>
                        <td className="py-2.5 px-4 font-mono-num font-semibold">{r.no}</td>
                        <td className="py-2.5 px-4">{r.cat}</td>
                        <td className="py-2.5 px-4">
                          <span className="px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-semibold">
                            {r.act}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300">{r.reason}</td>
                        <td className="py-2.5 px-4 text-right font-semibold">
                          {refundAmt > 0 ? (
                            <span className="font-mono-num text-emerald-700 dark:text-emerald-300">
                              +{formatTaka(refundAmt)} {bn ? 'প্রোফাইলে যোগ' : 'Credited'}
                            </span>
                          ) : (
                            <span className="text-rose-700 dark:text-rose-300">Returned</span>
                          )}
                        </td>
                      </tr>
                    );})}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 8. Deposit Summary & Payment Receipts */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-xs font-extrabold uppercase tracking-wide text-slate-900 dark:text-white">
                {bn
                  ? `মোট জমার হিসাব ও পেমেন্ট রসিদ (${stuReceipts.length + (untrackedInitialDeposit > 0 ? 1 : 0)})`
                  : `DEPOSIT SUMMARY & PAYMENT RECEIPTS (${stuReceipts.length + (untrackedInitialDeposit > 0 ? 1 : 0)})`}
              </h4>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onOpenDeposit({ student, depositType: 'course' })}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-100 text-emerald-700 dark:text-emerald-300 text-xs font-bold cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  <span>কোর্স ফি জমা</span>
                </button>
                <button
                  type="button"
                  onClick={() => onOpenDeposit({ student, depositType: 'visa' })}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/50 hover:bg-indigo-100 text-indigo-700 dark:text-indigo-300 text-xs font-bold cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  <span>ভিসা পারপাসে জমা</span>
                </button>
              </div>
            </div>

            {/* Total Deposit Summary Bar */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 p-3.5 bg-slate-50/80 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-800 text-xs">
              <div className="rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-3 py-2">
                <div className="text-[10px] text-slate-500">{bn ? 'মোট চুক্তি' : 'Contract Value'}</div>
                <div className="font-mono-num font-bold text-slate-900 dark:text-white">
                  {formatTaka(contractAmt)}
                </div>
              </div>
              <div className="rounded-lg bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800 px-3 py-2">
                <div className="text-[10px] text-emerald-700 dark:text-emerald-400">
                  {bn ? 'মোট কোর্স জমা' : 'Course Deposited'}
                </div>
                <div className="font-mono-num font-bold text-emerald-700 dark:text-emerald-300">
                  {formatTaka(depositAmt)}
                </div>
              </div>
              <div className="rounded-lg bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-800 px-3 py-2">
                <div className="text-[10px] text-amber-700 dark:text-amber-400">
                  {bn ? 'বাকি কোর্স ডিউ' : 'Course Due'}
                </div>
                <div className="font-mono-num font-bold text-amber-700 dark:text-amber-300">
                  {formatTaka(courseDue)}
                </div>
              </div>
              <div className="rounded-lg bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-800 px-3 py-2">
                <div className="text-[10px] text-indigo-700 dark:text-indigo-400">
                  {bn ? 'ভিসা পারপাসে জমা' : 'Visa Deposited'}
                </div>
                <div className="font-mono-num font-bold text-indigo-700 dark:text-indigo-300">
                  {formatTaka(visaDepositTotal)}
                </div>
              </div>
              <div className="col-span-2 sm:col-span-1 rounded-lg bg-teal-600 text-white px-3 py-2">
                <div className="text-[10px] text-teal-100">
                  {bn ? 'সর্বমোট জমা (Total)' : 'Grand Total Paid'}
                </div>
                <div className="font-mono-num font-extrabold">
                  {formatTaka(grandTotalDeposited)}
                </div>
              </div>
            </div>

            {stuReceipts.length === 0 && untrackedInitialDeposit === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                {bn ? 'এখনো কোনো টাকা জমার রেকর্ড নেই।' : 'No payments logged.'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-slate-500 font-semibold">
                      <th className="py-2.5 px-4">Date</th>
                      <th className="py-2.5 px-4">Receipt No</th>
                      <th className="py-2.5 px-4">খাত (Type)</th>
                      <th className="py-2.5 px-4">Purpose</th>
                      <th className="py-2.5 px-4">Method</th>
                      <th className="py-2.5 px-4 text-right">Amount</th>
                      <th className="py-2.5 px-4 text-right">Receipt</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {untrackedInitialDeposit > 0 && (
                      <tr className="bg-emerald-50/30 dark:bg-emerald-950/15">
                        <td className="py-2.5 px-4 font-mono-num">{student.date || '—'}</td>
                        <td className="py-2.5 px-4 font-mono-num font-semibold">ADM-OPENING</td>
                        <td className="py-2.5 px-4">
                          <span className="px-2 py-0.5 rounded font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300">
                            Course Fee
                          </span>
                        </td>
                        <td className="py-2.5 px-4">
                          {bn
                            ? 'ভর্তি / পূর্বের সমন্বয়কৃত জমা'
                            : 'Initial Admission / Opening Deposit'}
                        </td>
                        <td className="py-2.5 px-4">Ledger</td>
                        <td className="py-2.5 px-4 text-right font-mono-num font-bold">
                          {formatTaka(untrackedInitialDeposit)}
                        </td>
                        <td className="py-2.5 px-4 text-right text-[11px] text-slate-400">
                          Synced
                        </td>
                      </tr>
                    )}
                    {stuReceipts.map((r) => (
                      <tr key={r.id}>
                        <td className="py-2.5 px-4 font-mono-num">{r.date}</td>
                        <td className="py-2.5 px-4 font-mono-num font-semibold">{r.receiptNo}</td>
                        <td className="py-2.5 px-4">
                          <span
                            className={`px-2 py-0.5 rounded font-semibold ${
                              r.isVisa
                                ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300'
                                : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                            }`}
                          >
                            {r.typeLabel}
                          </span>
                        </td>
                        <td className="py-2.5 px-4">{r.purpose}</td>
                        <td className="py-2.5 px-4">{r.method}</td>
                        <td className="py-2.5 px-4 text-right font-mono-num font-bold">
                          {formatTaka(r.amount)}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <button
                            type="button"
                            onClick={() =>
                              onPrintReport?.({
                                title: `Payment Receipt — ${r.receiptNo}`,
                                subtitle: `Student: ${student.name} (${student.code}) · Date: ${r.date} · Type: ${r.typeLabel}`,
                                filename: `receipt-${r.receiptNo}`,
                                columns: ['Receipt No', 'Date', 'Type', 'Purpose', 'Method', 'Amount'],
                                rows: [
                                  [r.receiptNo, r.date, r.typeLabel, r.purpose, r.method, formatTaka(r.amount)],
                                ],
                              })
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-50 text-[11px] font-semibold cursor-pointer"
                          >
                            <Printer className="w-3 h-3" />
                            <span>Print</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Bottom Footer */}
        <div className="px-5 sm:px-6 py-3.5 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 shrink-0 bg-white dark:bg-slate-900">
          <div className="inline-flex items-center gap-1.5 text-xs text-slate-500">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            <span>
              {bn
                ? 'ছাত্রের তথ্য ডিলিট শুধুমাত্র Super Admin প্যানেল থেকে অনুমতি সাপেক্ষে করা যাবে'
                : 'Student deletion is locked — only permitted inside Super Admin Control Center'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onEdit(student)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>Edit Profile</span>
            </button>
          </div>
        </div>
      </div>

      {/* Passport Lightbox Preview */}
      {passportPreviewOpen && student.passportCopyData && (
        <div className="fixed inset-0 z-[60] bg-slate-950/80 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-2xl w-full p-4 space-y-3 border border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                Passport Copy — {student.name} ({student.code})
              </h4>
              <button
                type="button"
                onClick={() => setPassportPreviewOpen(false)}
                className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <img
              src={student.passportCopyData}
              alt="Passport copy preview"
              className="w-full max-h-[70vh] object-contain rounded-lg border border-slate-200 dark:border-slate-800"
            />
          </div>
        </div>
      )}

      {/* Retrain / Return Mini-Modal */}
      {retrainingJob && (
        <div className="fixed inset-0 z-[60] bg-slate-950/70 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 max-w-md w-full p-5 space-y-4">
            <h4 className="font-display text-sm font-bold text-slate-900 dark:text-white">
              {bn ? 'জব রিটার্ন / রিট্রেইন লগ করুন' : 'Log Job Return / Retrain'}
            </h4>
            <div className="rounded-lg bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 text-xs space-y-1">
              <div className="text-slate-700 dark:text-slate-200">
                Job No: <strong className="font-mono-num">{retrainingJob.no}</strong> ·{' '}
                <strong>{retrainingJob.cat}</strong> ·{' '}
                <strong className="font-mono-num">{formatTaka(retrainingJob.pay)}</strong>
              </div>
              <div className="text-emerald-700 dark:text-emerald-300 font-semibold">
                {bn
                  ? `রিটার্ন সেভ হলে ${formatTaka(Math.max(0, Number(retrainingJob.pay || 0) - (Number(retrainFee) || 0)))} সাথে সাথে প্রোফাইল ব্যালেন্সে যোগ হবে!`
                  : `${formatTaka(Math.max(0, Number(retrainingJob.pay || 0) - (Number(retrainFee) || 0)))} will be immediately added to profile balance!`}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  {bn ? 'রিটার্নের ধরন' : 'Return Type'}
                </label>
                <select
                  value={retrainAct}
                  onChange={(e) => setRetrainAct(e.target.value as ReturnTypeOption)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                >
                  <option value="Plate Return">Plate Return</option>
                  <option value="Retrain">Retrain</option>
                  <option value="Failed / Rework">Failed / Rework</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  {bn ? 'অতিরিক্ত ফি (৳)' : 'Fee Deduction (৳)'}
                </label>
                <input
                  type="number"
                  min={0}
                  value={retrainFee}
                  onChange={(e) => setRetrainFee(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono-num"
                />
              </div>
            </div>
            <input
              value={retrainReason}
              onChange={(e) => setRetrainReason(e.target.value)}
              placeholder={bn ? 'কারণ / পরিদর্শকের মন্তব্য লিখুন...' : 'Reason / inspector remarks...'}
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRetrainingJob(null)}
                className="px-3.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold cursor-pointer"
              >
                {bn ? 'বাতিল' : 'Cancel'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleConfirmRetrain()}
                className="px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold cursor-pointer"
              >
                {bn ? 'রিটার্ন নিশ্চিত করুন' : 'Confirm Return'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
