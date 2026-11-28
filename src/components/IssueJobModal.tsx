import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Fingerprint,
  Maximize2,
  Minimize2,
  Phone,
  Printer,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { SubCollectionKey } from '../lib/store';
import { formatTaka, todayDDMMYYYY } from '../lib/format';
import {
  buildDueDateAuditDetail,
  buildRentLimitAuditDetail,
  canEnterJob,
  checkBalanceAndApproval,
  computeStudentJobBalanceSummary,
  defaultPromiseDateYYYYMMDD,
  encodeDueJobNote,
  getNextDailyJobSeq,
  getStudentCategoryRentedLimit,
  getStudentDueDateApproval,
  RENT_LIMIT_ACTION,
  rentSupervisorLimit,
  SET_DUE_DATE_ACTION,
  setSupervisorDueDate,
} from '../lib/jobLimits';
import { openTokenPrintTab } from '../lib/print';
import type {
  AuditLog,
  CenterSettings,
  JobEntry,
  JobPrice,
  JobReturn,
  JobVerificationMethod,
  Lang,
  SlipData,
  StaffMember,
  Student,
} from '../types';

interface IssueJobModalProps {
  open: boolean;
  initialCategory?: string;
  initialStudentCode?: string;
  students: Student[];
  jobs: JobEntry[];
  returns?: JobReturn[];
  prices: JobPrice[];
  auditLogs?: AuditLog[];
  staff?: StaffMember[];
  settings: CenterSettings;
  lang: Lang;
  onClose: () => void;
  onAdd: (key: SubCollectionKey, raw: Record<string, unknown>) => Promise<string>;
  onLogAudit?: (action: string, module: string, detail: string) => Promise<void>;
  onPrintSlip: (slip: SlipData) => void;
  onAutoPrintSlip?: (slip: SlipData) => boolean;
  resetNonce?: number;
}

function toInputDate(ddmmyyyy: string): string {
  const parts = ddmmyyyy.split('-');
  if (parts.length !== 3) return '';
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

function fromInputDate(yyyymmdd: string): string {
  if (!yyyymmdd) return todayDDMMYYYY();
  const parts = yyyymmdd.split('-');
  if (parts.length !== 3) return todayDDMMYYYY();
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

function toCompactDate(ddmmyyyy: string): string {
  const parts = ddmmyyyy.split('-');
  if (parts.length !== 3) {
    const now = new Date();
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
      now.getDate()
    ).padStart(2, '0')}`;
  }
  return `${parts[2]}${parts[1]}${parts[0]}`;
}

export function IssueJobModal({
  open,
  initialCategory,
  initialStudentCode,
  students,
  jobs,
  returns = [],
  prices,
  auditLogs = [],
  staff = [],
  settings,
  lang,
  onClose,
  onAdd,
  onLogAudit,
  onPrintSlip,
  onAutoPrintSlip,
  resetNonce = 0,
}: IssueJobModalProps) {
  const bn = lang === 'bn';
  const activePrices = useMemo(() => {
    const list = prices.filter((p) => p.active !== false);
    return list.length > 0 ? list : prices;
  }, [prices]);

  const studentCodeInputRef = useRef<HTMLInputElement>(null);

  const [fullScreen, setFullScreen] = useState(false);
  const [studentCode, setStudentCode] = useState('');
  const [cat, setCat] = useState(initialCategory || activePrices[0]?.cat || '1G FLAT');
  const [testDateInput, setTestDateInput] = useState(() => toInputDate(todayDDMMYYYY()));
  const [verificationMethod, setVerificationMethod] =
    useState<JobVerificationMethod>('supervisor');
  const [discount, setDiscount] = useState('');
  const [note, setNote] = useState('');
  const [recordCash, setRecordCash] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastIssuedSlip, setLastIssuedSlip] = useState<SlipData | null>(null);
  const [tokenTabUrl, setTokenTabUrl] = useState<string>('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [duplicateOverrideConfirmed, setDuplicateOverrideConfirmed] = useState(false);
  const [showRentPanel, setShowRentPanel] = useState(false);
  const [rentAmountInput, setRentAmountInput] = useState('5');
  const [rentSupervisorInput, setRentSupervisorInput] = useState('Supervisor');
  const [rentSaving, setRentSaving] = useState(false);
  const [rentStatusNotice, setRentStatusNotice] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [dueDateSaving, setDueDateSaving] = useState(false);
  const [dueDateNotice, setDueDateNotice] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [showChangeDueDate, setShowChangeDueDate] = useState(false);
  const [paymentPromiseDateInput, setPaymentPromiseDateInput] = useState(() =>
    defaultPromiseDateYYYYMMDD(7)
  );
  const [dueSupervisorName, setDueSupervisorName] = useState('সুপারভাইজার');

  useEffect(() => {
    if (!tokenTabUrl) return;
    const urlToRevoke = tokenTabUrl;
    return () => {
      setTimeout(() => URL.revokeObjectURL(urlToRevoke), 30000);
    };
  }, [tokenTabUrl]);

  const resetToDefault = () => {
    setStudentCode('');
    setTestDateInput(toInputDate(todayDDMMYYYY()));
    setDiscount('');
    setNote('');
    setVerificationMethod('supervisor');
    setDueDateNotice(null);
    setShowChangeDueDate(false);
    setPaymentPromiseDateInput(defaultPromiseDateYYYYMMDD(7));
    setDueSupervisorName('সুপারভাইজার');
    setDuplicateOverrideConfirmed(false);
    if (initialCategory) {
      setCat(initialCategory);
    } else if (activePrices[0]?.cat) {
      setCat(activePrices[0].cat);
    }
    requestAnimationFrame(() => {
      studentCodeInputRef.current?.focus();
    });
  };

  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;

    setLastIssuedSlip(null);
    setTokenTabUrl('');
    setSubmitError(null);
    setShowRentPanel(false);
    setRentStatusNotice(null);
    setDueDateNotice(null);
    setShowChangeDueDate(false);
    setPaymentPromiseDateInput(defaultPromiseDateYYYYMMDD(7));
    setDueSupervisorName('সুপারভাইজার');
    setDuplicateOverrideConfirmed(false);
    setStudentCode(initialStudentCode || '');
    setTestDateInput(toInputDate(todayDDMMYYYY()));
    setDiscount('');
    setNote('');
    setVerificationMethod('supervisor');
    if (initialCategory) {
      setCat(initialCategory);
    } else if (activePrices[0]?.cat) {
      setCat(activePrices[0].cat);
    }
    requestAnimationFrame(() => {
      studentCodeInputRef.current?.focus();
    });
  }, [open, initialCategory, initialStudentCode, activePrices]);

  useEffect(() => {
    if (!open || resetNonce === 0) return;
    setTokenTabUrl('');
    setSubmitError(null);
    setShowRentPanel(false);
    setRentStatusNotice(null);
    setDueDateNotice(null);
    setShowChangeDueDate(false);
    setPaymentPromiseDateInput(defaultPromiseDateYYYYMMDD(7));
    setDueSupervisorName('সুপারভাইজার');
    setDuplicateOverrideConfirmed(false);
    setStudentCode('');
    setTestDateInput(toInputDate(todayDDMMYYYY()));
    setDiscount('');
    setNote('');
    setVerificationMethod('supervisor');
    if (activePrices[0]?.cat) {
      setCat(activePrices[0].cat);
    }
    requestAnimationFrame(() => {
      studentCodeInputRef.current?.focus();
    });
  }, [resetNonce, open, activePrices]);

  const trimmedCode = studentCode.trim().toLowerCase();

  const matchedStudent = useMemo(() => {
    if (!trimmedCode) return null;
    return (
      students.find((s) => s.code.trim().toLowerCase() === trimmedCode) || null
    );
  }, [students, trimmedCode]);

  const partialSuggestions = useMemo(() => {
    if (!trimmedCode || matchedStudent) return [];
    return students
      .filter(
        (s) =>
          s.code.toLowerCase().includes(trimmedCode) ||
          s.name.toLowerCase().includes(trimmedCode)
      )
      .slice(0, 4);
  }, [students, trimmedCode, matchedStudent]);

  const selectedPrice = prices.find((p) => p.cat === cat);
  const standardFee = selectedPrice?.price ?? 800;
  const categoryQuota = selectedPrice?.limit ?? 20;

  const discountNum = Math.min(standardFee, Math.max(0, Number(discount) || 0));
  const payable = Math.max(0, standardFee - discountNum);

  const studentStats = useMemo(() => {
    if (!matchedStudent) return { totalSpent: 0, jobBalance: 0, catUsed: 0 };
    const normCode = matchedStudent.code.trim().toLowerCase();
    const stuJobs = jobs.filter((j) => j.sid.trim().toLowerCase() === normCode);
    const balSummary = computeStudentJobBalanceSummary({
      studentCode: matchedStudent.code,
      studentName: matchedStudent.name,
      deposit: matchedStudent.deposit,
      jobs: stuJobs,
      returns,
    });
    const catUsed = stuJobs.filter((j) => j.cat === cat).length;
    return {
      totalSpent: balSummary.netJobsCost,
      jobBalance: balSummary.jobBalance,
      catUsed,
    };
  }, [matchedStudent, jobs, returns, cat]);

  const rentInfo = useMemo(() => {
    if (!matchedStudent) return { rentedLimit: 0, rentedBySupervisor: '', rentals: [] };
    return getStudentCategoryRentedLimit(auditLogs, matchedStudent.code, cat);
  }, [auditLogs, matchedStudent, cat]);

  const quotaCheck = useMemo(
    () =>
      canEnterJob({
        baseLimit: categoryQuota,
        rentedLimit: rentInfo.rentedLimit,
        currentEntries: studentStats.catUsed,
      }),
    [categoryQuota, rentInfo.rentedLimit, studentStats.catUsed]
  );

  const dueDateApproval = useMemo(() => {
    if (!matchedStudent) {
      return {
        dueDate: '',
        approvedBySupervisor: '',
        dateStatus: 1 as const,
        isGracePeriodActive: false,
      };
    }
    return getStudentDueDateApproval(auditLogs, matchedStudent.code);
  }, [auditLogs, matchedStudent]);

  const balanceCheck = useMemo(
    () =>
      checkBalanceAndApproval({
        currentBalance: studentStats.jobBalance,
        jobCost: payable,
        activeDueDate: dueDateApproval.dueDate,
        approvedBySupervisor: dueDateApproval.approvedBySupervisor,
      }),
    [
      studentStats.jobBalance,
      payable,
      dueDateApproval.dueDate,
      dueDateApproval.approvedBySupervisor,
    ]
  );

  const targetFormattedDate = useMemo(() => fromInputDate(testDateInput), [testDateInput]);

  const sameDayExistingJobs = useMemo(() => {
    if (!matchedStudent) return [];
    const codeKey = matchedStudent.code.trim().toLowerCase();
    return jobs.filter(
      (j) => (j.sid || '').trim().toLowerCase() === codeKey && j.date === targetFormattedDate
    );
  }, [jobs, matchedStudent, targetFormattedDate]);

  if (!open) return null;

  const triggerNewTabPrint = (slip: SlipData) => {
    const url = openTokenPrintTab(slip, settings);
    setTokenTabUrl(url);
  };

  const handleReprintLastSlip = () => {
    if (!lastIssuedSlip) return;
    if (onAutoPrintSlip) {
      onAutoPrintSlip(lastIssuedSlip);
    } else {
      triggerNewTabPrint(lastIssuedSlip);
    }
    requestAnimationFrame(() => {
      studentCodeInputRef.current?.focus();
    });
  };

  const handleRentSupervisorLimit = async () => {
    if (!matchedStudent || rentSaving) return;
    const result = rentSupervisorLimit(
      rentAmountInput,
      rentSupervisorInput,
      quotaCheck.totalAllowedLimit
    );
    if (!result.success || !result.amount || !result.supervisorName) {
      setRentStatusNotice({ type: 'error', text: result.message });
      return;
    }
    setRentSaving(true);
    setRentStatusNotice(null);
    try {
      if (onLogAudit) {
        await onLogAudit(
          RENT_LIMIT_ACTION,
          'Supervisor Limit',
          buildRentLimitAuditDetail(matchedStudent.code, cat, result.amount, result.supervisorName)
        );
      } else {
        await onAdd('auditLogs', {
          action: RENT_LIMIT_ACTION,
          module: 'Supervisor Limit',
          detail: buildRentLimitAuditDetail(
            matchedStudent.code,
            cat,
            result.amount,
            result.supervisorName
          ),
        });
      }
      setRentStatusNotice({ type: 'success', text: result.message });
      setSubmitError(null);
      setShowRentPanel(false);
    } catch (err) {
      setRentStatusNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'সুপারভাইজার লিমিট সেভ করা যায়নি।',
      });
    } finally {
      setRentSaving(false);
    }
  };

  const handleSaveSupervisorDueDate = async () => {
    if (!matchedStudent || dueDateSaving) return;
    const res = setSupervisorDueDate(paymentPromiseDateInput, dueSupervisorName);
    if (!res.success || !res.dueDate || !res.supervisorName) {
      setDueDateNotice({ type: 'error', text: res.message });
      return;
    }
    setDueDateSaving(true);
    setDueDateNotice(null);
    try {
      const detail = buildDueDateAuditDetail(
        matchedStudent.code,
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
      setVerificationMethod('supervisor');
      setDueDateNotice({ type: 'success', text: res.message });
      setSubmitError(null);
      setShowChangeDueDate(false);
    } catch (err) {
      setDueDateNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'বকেয়ার তারিখ সংরক্ষণ করা যায়নি।',
      });
    } finally {
      setDueDateSaving(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!matchedStudent || saving) return;

    if (!quotaCheck.allowed) {
      setSubmitError(
        `লিমিট পূর্ণ হয়ে গেছে (${quotaCheck.currentEntries}/${quotaCheck.totalAllowedLimit})। নতুন জব এন্ট্রি করতে সুপারভাইজার লিমিট ভাড়া নিন বা Job Price & Limits বাড়ান।`
      );
      setShowRentPanel(true);
      return;
    }

    if (!balanceCheck.allowed) {
      setSubmitError(balanceCheck.uiAlertNote);
      return;
    }

    if (sameDayExistingJobs.length > 0 && !duplicateOverrideConfirmed) {
      setSubmitError(
        `সতর্কবার্তা: এই ছাত্র (${matchedStudent.name}) ${targetFormattedDate} তারিখে ইতিমধ্যে ${sameDayExistingJobs.length}টি জব নিয়েছে! অতিরিক্ত জব এন্ট্রি করতে নিচের অনুমোদন চেকবক্সে টিক দিন।`
      );
      return;
    }

    setSaving(true);
    setSubmitError(null);

    const formattedDate = fromInputDate(testDateInput);
    const compact = toCompactDate(formattedDate);
    const seq = getNextDailyJobSeq(jobs, formattedDate, compact);
    const jobNo = `${compact}-${String(seq).padStart(3, '0')}`;

    const actualPaidNow = balanceCheck.isDueEntry
      ? Math.max(0, Math.min(studentStats.jobBalance, payable))
      : payable;
    const effectiveVerification: JobVerificationMethod = 'supervisor';
    const cleanUserNote = note.trim();
    const effectiveDueDate = balanceCheck.dueDate;
    const effectiveSupervisor = balanceCheck.approvedBySupervisor || dueSupervisorName;
    const storedNote = encodeDueJobNote(cleanUserNote, {
      isDueEntry: balanceCheck.isDueEntry,
      dueAmount: balanceCheck.dueAmount,
      paymentPromiseDate: effectiveDueDate,
      supervisorName: effectiveSupervisor,
    });

    const issuedSlip: SlipData = {
      kind: 'job',
      date: formattedDate,
      no: jobNo,
      name: matchedStudent.name,
      code: matchedStudent.code,
      cat,
      amount: standardFee,
      discount: discountNum,
      paid: actualPaidNow,
      verificationMethod: effectiveVerification,
      note: cleanUserNote,
      isDueEntry: balanceCheck.isDueEntry,
      dueAmount: balanceCheck.dueAmount,
      paymentPromiseDate: effectiveDueDate,
      supervisorName: effectiveSupervisor,
      tokenPaymentNote: balanceCheck.tokenPaymentNote,
    };

    const writeOps: Promise<unknown>[] = [
      onAdd('jobs', {
        date: formattedDate,
        no: jobNo,
        sid: matchedStudent.code,
        sname: matchedStudent.name,
        cat,
        pay: payable,
        discount: discountNum,
        paid: actualPaidNow,
        verificationMethod: effectiveVerification,
        note: storedNote,
      }),
    ];

    if (recordCash && !balanceCheck.isDueEntry && payable > 0) {
      writeOps.push(
        onAdd('cash', {
          date: formattedDate,
          type: 'in',
          category: 'Job Fee',
          amt: payable,
          note: `Job ${jobNo} · ${matchedStudent.name} (${cat})`,
        })
      );
    }

    if (onLogAudit) {
      writeOps.push(
        onLogAudit(
          'ISSUE_JOB',
          'Daily Job Register',
          `Issued ${jobNo} for ${matchedStudent.name} (${matchedStudent.code}) · ${cat} · ${effectiveVerification}${
            balanceCheck.isDueEntry
              ? ` · DUE ${balanceCheck.dueAmount}৳ (${effectiveSupervisor}, due ${effectiveDueDate})`
              : ''
          }${sameDayExistingJobs.length > 0 ? ' · [SAME-DAY OVERRIDE APPROVED]' : ''}`
        )
      );
    }

    const savePromise = Promise.all(writeOps);

    setLastIssuedSlip(issuedSlip);
    resetToDefault();
    if (onAutoPrintSlip) {
      onAutoPrintSlip(issuedSlip);
    } else {
      // Open standalone auto-printing token in a new browser tab inside the user submit gesture
      triggerNewTabPrint(issuedSlip);
    }

    try {
      await savePromise;
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : 'জব সেভ করতে সমস্যা হয়েছে। আবার চেষ্টা করুন।'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[1px] flex items-center justify-center p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-label="Issue New Practical Job"
    >
      <form
        onSubmit={handleSubmit}
        className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col overflow-hidden transition-all ${
          fullScreen
            ? 'w-full h-full max-w-none rounded-none'
            : 'w-full max-w-3xl max-h-[92vh] rounded-2xl'
        }`}
      >
        {/* Modal Header */}
        <div className="px-5 sm:px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
          <h2 className="font-display text-base sm:text-lg font-extrabold text-slate-900 dark:text-white">
            Issue New Practical Job (জব ইস্যু ও টোকেন প্রিন্ট)
          </h2>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setFullScreen((v) => !v)}
              aria-label={fullScreen ? 'Exit full screen' : 'Expand modal'}
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              {fullScreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Form Body */}
        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 space-y-4">
          {/* Auto-Print & Continuous Entry Success Banner */}
          {lastIssuedSlip && (
            <div className="rounded-2xl border border-emerald-400/80 dark:border-emerald-700 bg-emerald-50/95 dark:bg-emerald-950/40 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-emerald-700 text-white flex items-center justify-center shrink-0 shadow-sm">
                    <CheckCircle2 className="w-5 h-5 stroke-[2.2]" />
                  </div>
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs sm:text-sm font-bold text-slate-900 dark:text-emerald-100">
                        টোকেন সফলভাবে ইস্যু হয়েছে ও স্বয়ংক্রিয় প্রিন্ট হচ্ছে!
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-emerald-200/90 dark:bg-emerald-900/80 text-emerald-900 dark:text-emerald-200 font-mono-num text-xs font-bold">
                        {lastIssuedSlip.no}
                      </span>
                    </div>
                    <div className="text-xs text-slate-700 dark:text-emerald-300 tabular-nums">
                      শিক্ষার্থী: <strong className="font-bold">{lastIssuedSlip.name}</strong> (
                      {lastIssuedSlip.code}) · ফি: {formatTaka(lastIssuedSlip.paid)} | পরবর্তী
                      স্টুডেন্টের কোড দিন:
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleReprintLastSlip}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-bold whitespace-nowrap shrink-0 shadow-sm transition-colors cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>পুনরায় প্রিন্ট (Re-print)</span>
                </button>
              </div>
            </div>
          )}

          {submitError && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-800 dark:text-red-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{submitError}</span>
            </div>
          )}

          {students.length === 0 && (
            <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>
                {bn
                  ? 'আগে স্টুডেন্ট ম্যানেজমেন্ট থেকে অন্তত একজন স্টুডেন্ট নিবন্ধন করুন।'
                  : 'Register at least one student in Student Management before issuing practical jobs.'}
              </span>
            </div>
          )}

          {/* Student Code */}
          <div>
            <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1.5">
              Student Code (স্টুডেন্ট কোড) <span className="text-red-500">*</span>
            </label>
            <input
              ref={studentCodeInputRef}
              list="issue-job-student-codes"
              value={studentCode}
              onChange={(e) => {
                setStudentCode(e.target.value);
                setDueDateNotice(null);
                setShowChangeDueDate(false);
                setDuplicateOverrideConfirmed(false);
              }}
              placeholder="Enter Student Code (e.g. 01/001)"
              autoFocus
              className="w-full px-3.5 py-2.5 text-sm rounded-xl border-2 border-blue-500/80 dark:border-teal-500/80 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono-num focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
            <datalist id="issue-job-student-codes">
              {students.map((s) => (
                <option key={s.id} value={s.code}>
                  {s.name} — {s.trade || 'Trainee'}
                </option>
              ))}
            </datalist>

            {/* Matched Student Preview Strip */}
            {matchedStudent ? (
              <div className="mt-2.5 p-3 rounded-xl bg-teal-50/70 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800/70 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  {matchedStudent.photoData ? (
                    <img
                      src={matchedStudent.photoData}
                      alt={matchedStudent.name}
                      className="w-10 h-10 rounded-lg object-cover border border-teal-300 dark:border-teal-700 shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-teal-600 text-white font-display font-bold text-xs flex items-center justify-center shrink-0">
                      {matchedStudent.name.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-sm text-slate-900 dark:text-white truncate">
                        {matchedStudent.name}
                      </span>
                      <span className="font-mono-num text-xs font-semibold text-teal-700 dark:text-teal-300">
                        ({matchedStudent.code})
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold ${
                          matchedStudent.bioEnrolled
                            ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300'
                            : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        <Fingerprint className="w-3 h-3" />
                        <span>{matchedStudent.bioEnrolled ? 'Bio Enrolled' : 'No Bio'}</span>
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-600 dark:text-slate-400">
                      <span className="truncate">
                        {matchedStudent.trade || (bn ? 'ট্রেড নির্ধারিত নেই' : 'Trade not specified')}
                      </span>
                      {matchedStudent.phone && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-1 font-mono-num">
                            <Phone className="w-3 h-3 text-teal-600 dark:text-teal-400" />
                            <span>{matchedStudent.phone}</span>
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4 text-xs shrink-0">
                  <div>
                    <div className="text-[10px] uppercase text-slate-500">Job Balance</div>
                    <div className="font-mono-num font-bold text-indigo-700 dark:text-indigo-300">
                      {formatTaka(studentStats.jobBalance)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-slate-500">Quota Used</div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`font-mono-num font-bold ${
                          !quotaCheck.allowed
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-teal-700 dark:text-teal-300'
                        }`}
                      >
                        {quotaCheck.currentEntries} / {quotaCheck.totalAllowedLimit}
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowRentPanel((v) => !v)}
                        className="px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/50 hover:bg-indigo-200 dark:hover:bg-indigo-800/70 text-[10px] font-bold text-indigo-800 dark:text-indigo-200 cursor-pointer"
                      >
                        + লিমিট ভাড়া
                      </button>
                    </div>
                    <div className="text-[10px] text-slate-500 font-mono-num">
                      Base: {quotaCheck.baseLimit}
                      {quotaCheck.rentedLimit > 0
                        ? ` + Rented: ${quotaCheck.rentedLimit}${
                            rentInfo.rentedBySupervisor ? ` (${rentInfo.rentedBySupervisor})` : ''
                          }`
                        : ''}{' '}
                      · Left: {quotaCheck.remainingLimit}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              trimmedCode.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  <div className="text-xs text-amber-700 dark:text-amber-400">
                    {bn
                      ? `"${studentCode}" কোডে কোনো স্টুডেন্ট পাওয়া যায়নি।`
                      : `No exact student match for "${studentCode}".`}
                  </div>
                  {partialSuggestions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {partialSuggestions.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => {
                            setStudentCode(s.code);
                            setDueDateNotice(null);
                            setShowChangeDueDate(false);
                            setDuplicateOverrideConfirmed(false);
                          }}
                          className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:border-teal-500 text-xs font-medium cursor-pointer"
                        >
                          <span className="font-mono-num font-bold text-teal-700 dark:text-teal-400">
                            {s.code}
                          </span>{' '}
                          · {s.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            )}

            {matchedStudent && (!quotaCheck.allowed || showRentPanel || rentStatusNotice) && (
              <div
                className={`mt-2.5 p-3.5 rounded-xl border space-y-2.5 ${
                  !quotaCheck.allowed
                    ? 'bg-rose-50 dark:bg-rose-950/35 border-rose-300 dark:border-rose-800'
                    : 'bg-indigo-50/70 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-800'
                }`}
              >
                {!quotaCheck.allowed && (
                  <div className="flex items-start gap-2 text-xs text-rose-800 dark:text-rose-200 font-semibold">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
                    <span>
                      লিমিট পূর্ণ হয়ে গেছে ({quotaCheck.currentEntries}/{quotaCheck.totalAllowedLimit})। নতুন জব এন্ট্রি করতে সুপারভাইজার লিমিট ভাড়া নিন বা Job Price &amp; Limits বাড়ান।
                    </span>
                  </div>
                )}

                {rentStatusNotice && (
                  <div
                    className={`text-xs font-semibold px-3 py-1.5 rounded-lg ${
                      rentStatusNotice.type === 'success'
                        ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-200'
                        : 'bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-200'
                    }`}
                  >
                    {rentStatusNotice.text}
                  </div>
                )}

                {(!quotaCheck.allowed || showRentPanel) && (
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                    <div className="sm:col-span-3">
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-200 mb-1">
                        অতিরিক্ত লিমিট *
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={rentAmountInput}
                        onChange={(e) => setRentAmountInput(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono-num"
                      />
                    </div>
                    <div className="sm:col-span-5">
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-200 mb-1">
                        সুপারভাইজারের নাম
                      </label>
                      <input
                        list="issue-job-supervisors"
                        value={rentSupervisorInput}
                        onChange={(e) => setRentSupervisorInput(e.target.value)}
                        placeholder="Supervisor"
                        className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                      />
                      <datalist id="issue-job-supervisors">
                        <option value="Supervisor" />
                        {staff.map((st) => (
                          <option key={st.id} value={st.name}>
                            {st.role}
                          </option>
                        ))}
                      </datalist>
                    </div>
                    <div className="sm:col-span-4">
                      <button
                        type="button"
                        disabled={rentSaving}
                        onClick={handleRentSupervisorLimit}
                        className="w-full px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
                      >
                        {rentSaving ? 'যুক্ত হচ্ছে...' : 'সুপারভাইজার লিমিট ভাড়া নিন'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Job Category & Job Testing Date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1.5">
                Job Category <span className="text-red-500">*</span>
              </label>
              <select
                value={cat}
                onChange={(e) => setCat(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                {activePrices.map((p) => (
                  <option key={p.id} value={p.cat}>
                    {p.cat}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1.5">
                Job Testing Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                required
                value={testDateInput}
                onChange={(e) => {
                  setTestDateInput(e.target.value);
                  setDuplicateOverrideConfirmed(false);
                }}
                className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono-num focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          </div>

          {/* Duplicate Same-Day Job Warning */}
          {matchedStudent && sameDayExistingJobs.length > 0 && (
            <div className="rounded-xl border-2 border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/40 p-4 space-y-2.5">
              <div className="flex items-start gap-2.5 text-xs font-extrabold text-amber-900 dark:text-amber-200">
                <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <div>
                    সতর্কবার্তা: এই ছাত্র আজ/এই তারিখে ({targetFormattedDate}) ইতিমধ্যে{' '}
                    {sameDayExistingJobs.length}টি জব নিয়েছে!
                  </div>
                  <div className="mt-1 font-normal text-[11px] text-amber-800 dark:text-amber-300 space-y-0.5">
                    {sameDayExistingJobs.map((ej) => (
                      <div key={ej.id} className="font-mono-num">
                        • টোকেন: <strong>{ej.no}</strong> · {ej.cat} · {formatTaka(ej.pay)}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <label className="flex items-start gap-2 pt-2 border-t border-amber-200 dark:border-amber-800 text-xs font-semibold text-amber-950 dark:text-amber-100 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={duplicateOverrideConfirmed}
                  onChange={(e) => {
                    setDuplicateOverrideConfirmed(e.target.checked);
                    if (e.target.checked) setSubmitError(null);
                  }}
                  className="mt-0.5 rounded border-amber-400 text-amber-600"
                />
                <span>
                  সুপারভাইজার / অপারেটর অনুমোদন: একই দিনে অতিরিক্ত জব এন্ট্রি করার অনুমতি দিচ্ছি (Override Confirm)
                </span>
              </label>
            </div>
          )}

          {/* Verification Method Container */}
          <div className="rounded-[10px] border border-slate-200 dark:border-[#263846] bg-slate-50/70 dark:bg-[#17222b] p-4 mb-[18px]">
            <label className="block text-[14px] font-semibold text-slate-800 dark:text-[#e6edf3] mb-3">
              ভেরিফিকেশন মেথড (Verification for Token Print){' '}
              <span className="text-[#ff5c5c]">*</span>
            </label>

            <div className="flex w-full">
              <button
                type="button"
                id="supervisorVerifyBtn"
                data-value="supervisor_verified"
                aria-pressed="true"
                onClick={() => setVerificationMethod('supervisor')}
                className={`w-full flex items-center justify-center gap-2.5 px-[18px] py-[14px] rounded-[8px] border text-[15px] font-semibold transition-colors cursor-pointer ${
                  verificationMethod === 'supervisor'
                    ? 'border-[#6c5ce7] bg-[#5b4cf5] hover:bg-[#5243e8] text-white'
                    : 'border-[#6c5ce7] bg-[#5b4cf5] text-white'
                }`}
              >
                <ShieldCheck className="w-5 h-5 shrink-0" />
                <span>সুপারভাইজার ভেরিফিকেশন</span>
              </button>
            </div>

            <p className="mt-[10px] mb-0 text-[12.5px] text-slate-500 dark:text-[#8b9bb0]">
              টোকেন প্রিন্টে &apos;সুপারভাইজার ভেরিফিকেশন&apos; নোট সংবলিত থাকবে।
            </p>
          </div>

          {/* 3-Column Pricing Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div>
              <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1.5">
                Price (৳)
              </label>
              <div className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 font-mono-num font-bold text-slate-900 dark:text-white">
                {formatTaka(standardFee)}
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1.5">
                Discount (৳)
              </label>
              <input
                type="number"
                min={0}
                max={standardFee}
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                placeholder="0"
                className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono-num focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1.5">
                Payable (৳)
              </label>
              <div className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 font-mono-num font-bold text-emerald-700 dark:text-emerald-300">
                {formatTaka(payable)}
              </div>
            </div>
          </div>

          {/* Balance Check & Persistent Supervisor Due-Date Grace Period Box */}
          {matchedStudent && balanceCheck.isDueEntry && (
            <div
              className={`rounded-xl border p-4 space-y-3 ${
                balanceCheck.isGracePeriodActive
                  ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/30'
                  : 'border-rose-300 dark:border-rose-800 bg-rose-50/80 dark:bg-rose-950/35'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2 text-xs font-semibold">
                <div className="flex items-start gap-2 min-w-0 flex-1">
                  <AlertCircle
                    className={`w-4 h-4 shrink-0 mt-0.5 ${
                      balanceCheck.isGracePeriodActive
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-rose-600 dark:text-rose-400'
                    }`}
                  />
                  <span
                    className={
                      balanceCheck.isGracePeriodActive
                        ? 'text-emerald-900 dark:text-emerald-200'
                        : 'text-rose-900 dark:text-rose-200'
                    }
                  >
                    {balanceCheck.uiAlertNote}
                  </span>
                </div>
                {balanceCheck.isGracePeriodActive && (
                  <button
                    type="button"
                    onClick={() => setShowChangeDueDate((v) => !v)}
                    className="px-2.5 py-1 rounded-lg bg-white/90 dark:bg-slate-900 border border-emerald-300 dark:border-emerald-700 text-[11px] font-bold text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 cursor-pointer shrink-0"
                  >
                    {showChangeDueDate ? 'বন্ধ করুন' : 'তারিখ পরিবর্তন'}
                  </button>
                )}
              </div>

              {dueDateNotice && (
                <div
                  className={`text-xs font-semibold px-3 py-2 rounded-lg ${
                    dueDateNotice.type === 'success'
                      ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-200'
                      : 'bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-200'
                  }`}
                >
                  {dueDateNotice.text}
                </div>
              )}

              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="rounded-lg bg-white/80 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700 px-3 py-2">
                  <div className="text-[10px] text-slate-500">অবশিষ্ট ব্যালেন্স</div>
                  <div className="font-mono-num font-bold text-slate-900 dark:text-white">
                    {formatTaka(studentStats.jobBalance)}
                  </div>
                </div>
                <div className="rounded-lg bg-white/80 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700 px-3 py-2">
                  <div className="text-[10px] text-slate-500">জব খরচ</div>
                  <div className="font-mono-num font-bold text-slate-900 dark:text-white">
                    {formatTaka(payable)}
                  </div>
                </div>
                <div className="rounded-lg bg-white/80 dark:bg-slate-900/70 border border-rose-200 dark:border-rose-800 px-3 py-2">
                  <div className="text-[10px] text-rose-600 dark:text-rose-400">বকেয়া (Due Amount)</div>
                  <div className="font-mono-num font-bold text-rose-700 dark:text-rose-300">
                    {formatTaka(balanceCheck.dueAmount)}
                  </div>
                </div>
              </div>

              {(balanceCheck.needSupervisorDueDate || showChangeDueDate) && (
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end pt-1">
                  <div className="sm:col-span-4">
                    <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-200 mb-1">
                      কবে টাকা জমা দিবে (তারিখ) *
                    </label>
                    <input
                      type="date"
                      min={toInputDate(todayDDMMYYYY())}
                      value={paymentPromiseDateInput}
                      onChange={(e) => setPaymentPromiseDateInput(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono-num"
                    />
                  </div>
                  <div className="sm:col-span-4">
                    <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-200 mb-1">
                      সুপারভাইজারের নাম
                    </label>
                    <input
                      list="issue-job-due-supervisors"
                      value={dueSupervisorName}
                      onChange={(e) => setDueSupervisorName(e.target.value)}
                      placeholder="সুপারভাইজার"
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                    <datalist id="issue-job-due-supervisors">
                      <option value="সুপারভাইজার" />
                      {staff.map((st) => (
                        <option key={st.id} value={st.name}>
                          {st.role}
                        </option>
                      ))}
                    </datalist>
                  </div>
                  <div className="sm:col-span-4">
                    <button
                      type="button"
                      disabled={dueDateSaving}
                      onClick={handleSaveSupervisorDueDate}
                      className="w-full px-3 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
                    >
                      {dueDateSaving
                        ? 'সংরক্ষণ হচ্ছে...'
                        : 'বকেয়ার তারিখ সংরক্ষণ ও অনুমোদন দিন'}
                    </button>
                  </div>
                </div>
              )}

              {balanceCheck.isGracePeriodActive && balanceCheck.tokenPaymentNote && (
                <div className="p-2.5 rounded-lg border-2 border-dashed border-[#c5221f] bg-[#fff6f6] text-[#a50e0e] text-[11px] font-bold leading-relaxed">
                  {balanceCheck.tokenPaymentNote}
                </div>
              )}
            </div>
          )}

          {/* Optional Plate Note & Cashbook Option */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                bn
                  ? 'মন্তব্য / প্লেট নোট (ঐচ্ছিক)'
                  : 'Plate or test remarks (optional)'
              }
              className="flex-1 px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
            />
            <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={recordCash && !balanceCheck.isDueEntry}
                disabled={balanceCheck.isDueEntry}
                onChange={(e) => setRecordCash(e.target.checked)}
                className="rounded border-slate-300 text-teal-600 disabled:opacity-50"
              />
              <span>
                {balanceCheck.isDueEntry
                  ? 'বাকিতে এন্ট্রি (ক্যাশবুকে যোগ হবে না)'
                  : bn
                    ? 'ক্যাশবুকে যোগ করুন'
                    : 'Auto-add to Cashbook'}
              </span>
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 sm:px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2.5 shrink-0 bg-white dark:bg-slate-900">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={
              saving ||
              !matchedStudent ||
              !quotaCheck.allowed ||
              !balanceCheck.allowed ||
              (sameDayExistingJobs.length > 0 && !duplicateOverrideConfirmed)
            }
            className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-400 dark:disabled:text-slate-500 text-white text-xs sm:text-sm font-semibold transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            <Printer className="w-4 h-4" />
            <span>
              {saving
                ? 'Issuing...'
                : !quotaCheck.allowed && matchedStudent
                  ? 'লিমিট পূর্ণ (Rent Limit Required)'
                  : !balanceCheck.allowed && matchedStudent
                    ? 'ব্যালেন্স শেষ (সুপারভাইজার অনুমোদন দিন)'
                    : sameDayExistingJobs.length > 0 && !duplicateOverrideConfirmed
                      ? 'ডুপ্লিকেট জব কনফার্ম করুন'
                      : 'Issue Job & Auto-Print Token'}
            </span>
          </button>
        </div>
      </form>
    </div>
  );
}
