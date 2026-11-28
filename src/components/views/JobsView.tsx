import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';
import * as XLSX from 'xlsx';
import {
  AlertCircle,
  Calendar,
  Cloud,
  FileSpreadsheet,
  Layers,
  Plus,
  Printer,
  RotateCcw,
  Search,
  UserPlus,
  X,
} from 'lucide-react';
import type { SubCollectionKey } from '../../lib/store';
import {
  downloadFile,
  formatTaka,
  toCsv,
  todayDDMMYYYY,
  todayYYYYMMDD,
} from '../../lib/format';
import {
  buildDueDateAuditDetail,
  buildJobSlipFromEntry,
  buildRentLimitAuditDetail,
  canEnterJob,
  checkBalanceAndApproval,
  computeStudentJobBalanceSummary,
  defaultPromiseDateYYYYMMDD,
  encodeDueJobNote,
  getNextDailyJobSeq,
  getStudentCategoryRentedLimit,
  getStudentDueDateApproval,
  parseDueJobNote,
  RENT_LIMIT_ACTION,
  rentSupervisorLimit,
  SET_DUE_DATE_ACTION,
  setSupervisorDueDate,
} from '../../lib/jobLimits';
import type { PrintableReportSpec } from '../../lib/print';
import { KineticCounter } from '../../lib/motion';
import { JobRecoveryModal } from '../JobRecoveryModal';
import {
  MegaExcelArchiveModal,
  type MegaSyncBridge,
} from '../MegaExcelArchiveModal';
import type {
  AuditLog,
  CashEntry,
  JobEntry,
  JobPrice,
  JobReturn,
  Lang,
  OutStudentJob,
  SlipData,
  StaffMember,
  Student,
} from '../../types';

interface JobsViewProps {
  mode: 'jobs' | 'outs';
  students: Student[];
  jobs: JobEntry[];
  outs: OutStudentJob[];
  returns?: JobReturn[];
  prices: JobPrice[];
  cash?: CashEntry[];
  auditLogs?: AuditLog[];
  staff?: StaffMember[];
  lang: Lang;
  initialCategory?: string;
  onAdd: (key: SubCollectionKey, raw: Record<string, unknown>, customId?: string) => Promise<string>;
  onPrintSlip: (slip: SlipData) => void;
  onPrintReport?: (spec: PrintableReportSpec) => void;
  onOpenNewJob?: () => void;
  onLogAudit?: (action: string, module: string, detail: string) => Promise<void>;
  onInspectStudent?: (studentCode: string) => void;
  megaSync?: MegaSyncBridge;
}

interface RetrainTarget {
  no: string;
  sid: string;
  sname: string;
  cat: string;
  pay: number;
  isStudentJob?: boolean;
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

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function getMonthKeyAndLabel(ddmmyyyy: string): { key: string; label: string } {
  const parts = ddmmyyyy.split('-');
  if (parts.length !== 3) {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    return { key: `${mm}-${yyyy}`, label: `${MONTH_NAMES[now.getMonth()]} ${yyyy}` };
  }
  const mmNum = Math.max(1, Math.min(12, Number(parts[1]) || 1));
  const yyyy = parts[2];
  return {
    key: `${String(mmNum).padStart(2, '0')}-${yyyy}`,
    label: `${MONTH_NAMES[mmNum - 1]} ${yyyy}`,
  };
}

export function JobsView({
  mode,
  students,
  jobs,
  outs,
  returns = [],
  prices,
  cash = [],
  auditLogs = [],
  staff = [],
  lang,
  initialCategory,
  onAdd,
  onPrintSlip,
  onPrintReport,
  onOpenNewJob,
  onLogAudit,
  onInspectStudent,
  megaSync,
}: JobsViewProps) {
  const bn = lang === 'bn';
  const today = todayDDMMYYYY();
  const activePrices = prices.filter((p) => p.active !== false);
  const defaultCat = initialCategory || activePrices[0]?.cat || prices[0]?.cat || '6G TIG';

  const [showForm, setShowForm] = useState(false);
  const [sid, setSid] = useState(students[0]?.code || '');
  const [cat, setCat] = useState(defaultCat);
  const [discount, setDiscount] = useState('0');
  const [note, setNote] = useState('');

  // Out-of-student form fields
  const [outName, setOutName] = useState('');
  const [outPhone, setOutPhone] = useState('');
  const [outAgent, setOutAgent] = useState('');
  const [outPaid, setOutPaid] = useState('');
  const [outPaidTo, setOutPaidTo] = useState('Cashier Desk');
  const [outPayRef, setOutPayRef] = useState('');

  const [recordCash, setRecordCash] = useState(true);
  const [printAfterSave, setPrintAfterSave] = useState(true);
  const [saving, setSaving] = useState(false);

  // Filters matching screenshots
  const [selectedDate, setSelectedDate] = useState(today);
  const [showAllDates, setShowAllDates] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [showCategoryBreakdown, setShowCategoryBreakdown] = useState(true);
  const [retrainJob, setRetrainJob] = useState<RetrainTarget | null>(null);
  const [retrainAct, setRetrainAct] = useState<'Retrain' | 'Plate Return' | 'Failed / Rework'>('Plate Return');
  const [retrainReason, setRetrainReason] = useState('Plate defect / Retest needed');
  const [retrainFee, setRetrainFee] = useState('0');
  const [retrainSaving, setRetrainSaving] = useState(false);
  const [megaExcelModalOpen, setMegaExcelModalOpen] = useState(false);
  const [recoveryModalOpen, setRecoveryModalOpen] = useState(false);
  const [registerNotice, setRegisterNotice] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [showInlineRent, setShowInlineRent] = useState(false);
  const [inlineRentExtra, setInlineRentExtra] = useState('5');
  const [inlineRentSupervisor, setInlineRentSupervisor] = useState('Supervisor');
  const [inlineRentBusy, setInlineRentBusy] = useState(false);
  const [inlineDueDateBusy, setInlineDueDateBusy] = useState(false);
  const [inlineShowChangeDueDate, setInlineShowChangeDueDate] = useState(false);
  const [inlinePromiseDateInput, setInlinePromiseDateInput] = useState(() =>
    defaultPromiseDateYYYYMMDD(7)
  );
  const [inlineDueSupervisor, setInlineDueSupervisor] = useState('সুপারভাইজার');
  const [inlineDuplicateConfirmed, setInlineDuplicateConfirmed] = useState(false);

  useEffect(() => {
    if (initialCategory) {
      setCat(initialCategory);
    }
  }, [initialCategory]);

  useEffect(() => {
    if (!sid && students.length > 0) {
      setSid(students[0].code);
    }
  }, [students, sid]);

  const selectedPrice = prices.find((p) => p.cat === cat);
  const standardFee = selectedPrice?.price ?? 2000;
  const studentQuota = selectedPrice?.limit ?? 20;

  const studentCatCount = useMemo(() => {
    if (!sid) return 0;
    return jobs.filter((j) => j.sid === sid && j.cat === cat).length;
  }, [jobs, sid, cat]);

  const inlineRentInfo = useMemo(() => {
    if (!sid) return { rentedLimit: 0, rentedBySupervisor: '', rentals: [] };
    return getStudentCategoryRentedLimit(auditLogs, sid, cat);
  }, [auditLogs, sid, cat]);

  const inlineQuotaCheck = useMemo(
    () =>
      canEnterJob({
        baseLimit: studentQuota,
        rentedLimit: inlineRentInfo.rentedLimit,
        currentEntries: studentCatCount,
      }),
    [studentQuota, inlineRentInfo.rentedLimit, studentCatCount]
  );

  const inlineDiscNum = Math.min(standardFee, Math.max(0, Number(discount) || 0));
  const inlinePayable = Math.max(0, standardFee - inlineDiscNum);
  const inlineStudentBalance = useMemo(() => {
    const stu = students.find((s) => s.code === sid);
    if (!stu) return 0;
    return computeStudentJobBalanceSummary({
      studentCode: stu.code,
      studentName: stu.name,
      deposit: stu.deposit,
      jobs,
      returns,
    }).jobBalance;
  }, [students, jobs, returns, sid]);
  const inlineDueApproval = useMemo(() => {
    if (!sid) {
      return {
        dueDate: '',
        approvedBySupervisor: '',
        dateStatus: 1 as const,
        isGracePeriodActive: false,
      };
    }
    return getStudentDueDateApproval(auditLogs, sid);
  }, [auditLogs, sid]);
  const inlineBalanceCheck = useMemo(
    () =>
      checkBalanceAndApproval({
        currentBalance: inlineStudentBalance,
        jobCost: inlinePayable,
        activeDueDate: inlineDueApproval.dueDate,
        approvedBySupervisor: inlineDueApproval.approvedBySupervisor,
      }),
    [
      inlineStudentBalance,
      inlinePayable,
      inlineDueApproval.dueDate,
      inlineDueApproval.approvedBySupervisor,
    ]
  );

  const inlineSameDayJobs = useMemo(() => {
    const codeKey = sid.trim().toLowerCase();
    if (!codeKey) return [];
    return jobs.filter((j) => (j.sid || '').trim().toLowerCase() === codeKey && j.date === today);
  }, [jobs, sid, today]);

  const handleInlineRentLimit = async () => {
    if (!sid || inlineRentBusy) return;
    const res = rentSupervisorLimit(
      inlineRentExtra,
      inlineRentSupervisor,
      inlineQuotaCheck.totalAllowedLimit
    );
    if (!res.success || !res.amount || !res.supervisorName) {
      setRegisterNotice({ type: 'error', text: res.message });
      return;
    }
    setInlineRentBusy(true);
    try {
      if (onLogAudit) {
        await onLogAudit(
          RENT_LIMIT_ACTION,
          'Supervisor Limit',
          buildRentLimitAuditDetail(sid, cat, res.amount, res.supervisorName)
        );
      } else {
        await onAdd('auditLogs', {
          action: RENT_LIMIT_ACTION,
          module: 'Supervisor Limit',
          detail: buildRentLimitAuditDetail(sid, cat, res.amount, res.supervisorName),
        });
      }
      setRegisterNotice({ type: 'success', text: res.message });
      setShowInlineRent(false);
    } finally {
      setInlineRentBusy(false);
    }
  };

  const handleInlineSetDueDate = async () => {
    if (!sid || inlineDueDateBusy) return;
    const res = setSupervisorDueDate(inlinePromiseDateInput, inlineDueSupervisor);
    if (!res.success || !res.dueDate || !res.supervisorName) {
      setRegisterNotice({ type: 'error', text: res.message });
      return;
    }
    setInlineDueDateBusy(true);
    try {
      const detail = buildDueDateAuditDetail(sid, res.dueDate, res.supervisorName);
      if (onLogAudit) {
        await onLogAudit(SET_DUE_DATE_ACTION, 'Supervisor Due Date', detail);
      } else {
        await onAdd('auditLogs', {
          action: SET_DUE_DATE_ACTION,
          module: 'Supervisor Due Date',
          detail,
        });
      }
      setRegisterNotice({ type: 'success', text: res.message });
      setInlineShowChangeDueDate(false);
    } finally {
      setInlineDueDateBusy(false);
    }
  };

  const handleSubmitJob = async (e: FormEvent) => {
    e.preventDefault();
    const student = students.find((s) => s.code === sid);
    if (!student) return;
    if (!inlineQuotaCheck.allowed) {
      setRegisterNotice({
        type: 'error',
        text: `লিমিট পূর্ণ হয়ে গেছে (${inlineQuotaCheck.currentEntries}/${inlineQuotaCheck.totalAllowedLimit})। নতুন জব এন্ট্রি করতে সুপারভাইজার লিমিট ভাড়া নিন বা Job Price & Limits বাড়ান।`,
      });
      setShowInlineRent(true);
      return;
    }
    if (!inlineBalanceCheck.allowed) {
      setRegisterNotice({
        type: 'error',
        text: inlineBalanceCheck.uiAlertNote,
      });
      return;
    }
    if (inlineSameDayJobs.length > 0 && !inlineDuplicateConfirmed) {
      setRegisterNotice({
        type: 'error',
        text: `সতর্কবার্তা: এই ছাত্র (${student.name}) আজকের তারিখে (${today}) ইতিমধ্যে ${inlineSameDayJobs.length}টি জব নিয়েছে! অতিরিক্ত জব এন্ট্রি করতে কনফার্মেশন চেকবক্সে টিক দিন।`,
      });
      return;
    }
    setSaving(true);
    try {
      const t = todayDDMMYYYY();
      const iso = todayYYYYMMDD();
      const seq = getNextDailyJobSeq(jobs, t, iso);
      const jobNo = `${iso}-${String(seq).padStart(3, '0')}`;
      const disc = Math.min(standardFee, Math.max(0, Number(discount) || 0));
      const payable = Math.max(0, standardFee - disc);
      const actualPaidNow = inlineBalanceCheck.isDueEntry
        ? Math.max(0, Math.min(inlineStudentBalance, payable))
        : payable;
      const cleanUserNote = note.trim();
      const effectiveDueDate = inlineBalanceCheck.dueDate;
      const effectiveSupervisor = inlineBalanceCheck.approvedBySupervisor || inlineDueSupervisor;
      const storedNote = encodeDueJobNote(cleanUserNote, {
        isDueEntry: inlineBalanceCheck.isDueEntry,
        dueAmount: inlineBalanceCheck.dueAmount,
        paymentPromiseDate: effectiveDueDate,
        supervisorName: effectiveSupervisor,
      });

      await onAdd('jobs', {
        date: t,
        no: jobNo,
        sid: student.code,
        sname: student.name,
        cat,
        pay: payable,
        discount: disc,
        paid: actualPaidNow,
        verificationMethod: 'supervisor',
        note: storedNote,
      });

      if (recordCash && !inlineBalanceCheck.isDueEntry && payable > 0) {
        await onAdd('cash', {
          date: t,
          type: 'in',
          category: 'Job Fee',
          amt: payable,
          note: `Job ${jobNo} · ${student.name} (${cat})`,
        });
      }

      if (printAfterSave) {
        onPrintSlip({
          kind: 'job',
          date: t,
          no: jobNo,
          name: student.name,
          code: student.code,
          cat,
          amount: standardFee,
          discount: disc,
          paid: actualPaidNow,
          verificationMethod: 'supervisor',
          note: cleanUserNote,
          isDueEntry: inlineBalanceCheck.isDueEntry,
          dueAmount: inlineBalanceCheck.dueAmount,
          paymentPromiseDate: effectiveDueDate,
          supervisorName: effectiveSupervisor,
          tokenPaymentNote: inlineBalanceCheck.tokenPaymentNote,
        });
      }

      await onLogAudit?.(
        'ISSUE_JOB',
        'Daily Job Register',
        `Issued ${jobNo} for ${student.name} (${student.code}) · ${cat} · supervisor${
          inlineSameDayJobs.length > 0 ? ' · [SAME-DAY OVERRIDE APPROVED]' : ''
        }`
      );

      setDiscount('0');
      setNote('');
      setInlineShowChangeDueDate(false);
      setInlineDuplicateConfirmed(false);
      setShowForm(false);
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitOut = async (e: FormEvent) => {
    e.preventDefault();
    if (!outName.trim()) return;
    setSaving(true);
    try {
      const t = todayDDMMYYYY();
      const iso = todayYYYYMMDD();
      const seq = outs.filter((o) => o.date === t).length + 1;
      const tokenNo = `O-${iso}-${String(seq).padStart(3, '0')}`;
      const paidVal = outPaid !== '' ? Number(outPaid) || 0 : standardFee;

      await onAdd('outs', {
        date: t,
        no: tokenNo,
        name: outName.trim().toUpperCase(),
        phone: outPhone.trim(),
        agent: outAgent.trim(),
        cat,
        price: standardFee,
        paid: paidVal,
        paidTo: outPaidTo.trim() || 'Cashier Desk',
        payRef: outPayRef.trim() || tokenNo,
        note: note.trim(),
      });

      if (recordCash && paidVal > 0) {
        await onAdd('cash', {
          date: t,
          type: 'in',
          category: 'Out of Student',
          amt: paidVal,
          note: `Out Job ${tokenNo} · ${outName.trim()} (${cat})`,
        });
      }

      if (printAfterSave) {
        onPrintSlip({
          kind: 'out',
          date: t,
          no: tokenNo,
          name: outName.trim().toUpperCase(),
          cat,
          amount: standardFee,
          paid: paidVal,
          note: note.trim(),
        });
      }

      setOutName('');
      setOutPhone('');
      setOutAgent('');
      setOutPaid('');
      setOutPayRef('');
      setNote('');
      setShowForm(false);
    } finally {
      setSaving(false);
    }
  };

  // Filtered Daily Job rows
  const filteredJobs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...jobs].reverse().filter((j) => {
      if (!showAllDates && selectedDate && j.date !== selectedDate) return false;
      if (categoryFilter !== 'all' && j.cat !== categoryFilter) return false;
      if (!q) return true;
      return (
        j.no.toLowerCase().includes(q) ||
        j.sname.toLowerCase().includes(q) ||
        j.sid.toLowerCase().includes(q) ||
        j.cat.toLowerCase().includes(q)
      );
    });
  }, [jobs, showAllDates, selectedDate, categoryFilter, search]);

  // Filtered Out-of-Student rows
  const filteredOuts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...outs].reverse().filter((o) => {
      if (selectedDate && !showAllDates && o.date !== selectedDate) return false;
      if (categoryFilter !== 'all' && o.cat !== categoryFilter) return false;
      if (!q) return true;
      return (
        o.no.toLowerCase().includes(q) ||
        o.name.toLowerCase().includes(q) ||
        o.phone.toLowerCase().includes(q) ||
        (o.agent || '').toLowerCase().includes(q) ||
        o.cat.toLowerCase().includes(q)
      );
    });
  }, [outs, selectedDate, showAllDates, categoryFilter, search]);

  const returnBadgeByJobNo = useMemo(() => {
    const map = new Map<string, string>();
    returns.forEach((r) => {
      const no = String(r.no || '').trim();
      if (!no) return;
      if (r.act === 'Plate Return') map.set(no, 'RETURNED');
      else if (r.act === 'Failed / Rework') map.set(no, 'REWORK');
      else map.set(no, 'RETRAINED');
    });
    return map;
  }, [returns]);

  const handleSubmitRetrain = async (e: FormEvent) => {
    e.preventDefault();
    if (!retrainJob) return;
    const normNo = retrainJob.no.trim().toLowerCase();
    const alreadyReturned = returns.some(
      (r) => (r.no || '').trim().toLowerCase() === normNo
    );
    if (alreadyReturned) {
      setRegisterNotice({
        type: 'error',
        text: bn
          ? `জব ${retrainJob.no} ইতিমধ্যে রিটার্ন করা হয়েছে — একই জবে পুনরায় রিটার্ন যোগ করা যাবে না।`
          : `Job ${retrainJob.no} has already been returned.`,
      });
      setRetrainJob(null);
      return;
    }

    const feeNum = Math.max(0, Number(retrainFee) || 0);
    const refundAmt = Math.max(0, Number(retrainJob.pay || 0) - feeNum);
    const matchedStudent = retrainJob.isStudentJob
      ? students.find(
          (s) => s.code.trim().toLowerCase() === retrainJob.sid.trim().toLowerCase()
        )
      : undefined;

    setRetrainSaving(true);
    try {
      await onAdd('returns', {
        date: todayDDMMYYYY(),
        no: retrainJob.no,
        code: retrainJob.sid,
        sname: retrainJob.sname,
        cat: retrainJob.cat,
        reason: retrainReason.trim() || 'Retest requested',
        act: retrainAct,
        fee: feeNum,
      });
      await onLogAudit?.(
        'LOG_JOB_RETRAIN',
        mode === 'outs' ? 'Out Student Jobs' : 'Daily Job Register',
        `${retrainJob.no} · ${retrainJob.sname} (${retrainJob.sid}) · ${retrainAct}${
          matchedStudent && refundAmt > 0 ? ` · Refund +${refundAmt}৳ to Profile` : ''
        }`
      );
      setRegisterNotice({
        type: 'success',
        text: matchedStudent && refundAmt > 0
          ? bn
            ? `জব ${retrainJob.no} রিটার্ন হয়েছে এবং ${formatTaka(refundAmt)} সাথে সাথে ${retrainJob.sname}-এর প্রোফাইল ব্যালেন্সে যোগ হয়েছে!`
            : `Job ${retrainJob.no} returned & ${formatTaka(refundAmt)} immediately credited back to ${retrainJob.sname}'s profile balance!`
          : bn
            ? `জব ${retrainJob.no} রিটার্ন / রিট্রেইন তালিকায় যুক্ত হয়েছে।`
            : `Job ${retrainJob.no} logged to Job Return & Retrain History.`,
      });
      setRetrainJob(null);
      setRetrainReason('Plate defect / Retest needed');
      setRetrainFee('0');
    } finally {
      setRetrainSaving(false);
    }
  };

  const retrainModal = retrainJob ? (
    <div
      className="fixed inset-0 z-[60] bg-slate-950/60 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Log Retrain or Job Return"
    >
      <form
        onSubmit={handleSubmitRetrain}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-md w-full p-5 space-y-4 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
            {bn ? 'জব রিটার্ন / রিট্রেইন এন্ট্রি' : 'Log Job Return / Retrain'}
          </h3>
          <button
            type="button"
            onClick={() => setRetrainJob(null)}
            className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="rounded-lg bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 text-xs space-y-1">
          <div className="font-bold text-slate-900 dark:text-white">
            {retrainJob.sname} ({retrainJob.sid})
          </div>
          <div className="text-slate-600 dark:text-slate-300 font-mono-num">
            Job No: {retrainJob.no} · {retrainJob.cat} · {formatTaka(retrainJob.pay)}
          </div>
          {retrainJob.isStudentJob && (
            <div className="text-emerald-700 dark:text-emerald-300 font-semibold pt-0.5">
              {bn
                ? `রিটার্ন সেভ করলে ${formatTaka(Math.max(0, Number(retrainJob.pay || 0) - (Number(retrainFee) || 0)))} সাথে সাথে প্রোফাইল ব্যালেন্সে যোগ হবে`
                : `${formatTaka(Math.max(0, Number(retrainJob.pay || 0) - (Number(retrainFee) || 0)))} will be immediately credited to student's profile balance`}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              {bn ? 'রিটার্নের ধরন' : 'Action Type'}
            </label>
            <select
              value={retrainAct}
              onChange={(e) =>
                setRetrainAct(e.target.value as 'Retrain' | 'Plate Return' | 'Failed / Rework')
              }
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
            >
              <option value="Plate Return">Plate Return</option>
              <option value="Retrain">Retrain</option>
              <option value="Failed / Rework">Failed / Rework</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              {bn ? 'অতিরিক্ত ফি (৳)' : 'Retest Fee (৳)'}
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

        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
            {bn ? 'ত্রুটির কারণ / মন্তব্য' : 'Reason / Inspector Remarks'}
          </label>
          <textarea
            rows={2}
            required
            value={retrainReason}
            onChange={(e) => setRetrainReason(e.target.value)}
            className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
          />
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setRetrainJob(null)}
            className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold cursor-pointer"
          >
            {bn ? 'বাতিল' : 'Cancel'}
          </button>
          <button
            type="submit"
            disabled={retrainSaving}
            className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold cursor-pointer"
          >
            {retrainSaving
              ? bn
                ? 'সংরক্ষণ হচ্ছে...'
                : 'Saving...'
              : bn
                ? 'রিটার্ন / রিট্রেইন সেভ করুন'
                : 'Save Return / Retrain'}
          </button>
        </div>
      </form>
    </div>
  ) : null;

  const categoryBreakdown = useMemo(() => {
    const baseJobs = [...jobs].filter((j) => {
      if (!showAllDates && selectedDate && j.date !== selectedDate) return false;
      return true;
    });
    const map = new Map<string, { count: number; total: number }>();
    baseJobs.forEach((j) => {
      const prev = map.get(j.cat) || { count: 0, total: 0 };
      map.set(j.cat, {
        count: prev.count + 1,
        total: prev.total + Number(j.pay || 0),
      });
    });
    return Array.from(map.entries())
      .map(([catName, info]) => ({ cat: catName, ...info }))
      .sort((a, b) => b.count - a.count);
  }, [jobs, showAllDates, selectedDate]);

  if (mode === 'outs') {
    const todayOutsCount = outs.filter((o) => o.date === today).length;
    const totalFeeCollected = outs.reduce((a, b) => a + Number(b.paid || 0), 0);

    return (
      <div className="space-y-4 lg:space-y-0 lg:flex-1 lg:min-h-0 lg:flex lg:flex-col lg:gap-3">
        {/* Sticky / Non-Scrolling Top Controls */}
        <div className="shrink-0 space-y-2.5">
          {/* Out of Student Header Card */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="p-2.5 rounded-xl bg-teal-50 dark:bg-teal-950/60 border border-teal-200 dark:border-teal-800 text-teal-700 dark:text-teal-300">
                <UserPlus className="w-5 h-5" />
              </span>
              <div>
                <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                  {bn ? 'বাইরের স্টুডেন্ট প্র্যাকটিক্যাল রেজিস্টার' : 'Out of Student Practical Register'}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {bn
                    ? 'বাইরের পরীক্ষার্থী নিবন্ধন, টোকেন প্রিন্ট ও পেমেন্ট স্লিপ'
                    : 'External test candidates registration, token print, and payment entries'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (onPrintReport) {
                    onPrintReport({
                      title: bn ? 'বাইরের স্টুডেন্ট প্র্যাকটিক্যাল রেজিস্টার' : 'Out of Student Practical Register',
                      subtitle: `${bn ? 'তারিখ' : 'Date'}: ${todayDDMMYYYY()} · ${filteredOuts.length} ${bn ? 'টি এন্ট্রি' : 'entries'}`,
                      filename: `ittc-out-students-${todayDDMMYYYY()}`,
                      summary: [
                        { label: bn ? 'মোট বাইরের জব' : 'Total Out Jobs', value: String(outs.length) },
                        { label: bn ? 'আজকের জব' : 'Today', value: String(todayOutsCount) },
                        { label: bn ? 'মোট সংগ্রহ' : 'Fee Collected', value: formatTaka(totalFeeCollected) },
                      ],
                      columns: ['Date', 'Token No', 'Candidate', 'Mobile', 'Agent', 'Category', 'Paid'],
                      rows: filteredOuts.map((o) => [
                        o.date,
                        o.no,
                        o.name,
                        o.phone || '—',
                        o.agent || '—',
                        o.cat,
                        formatTaka(o.paid),
                      ]),
                    });
                  } else {
                    window.print();
                  }
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>{bn ? 'প্রিন্ট রেজিস্টার' : 'Print Register'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const csv = toCsv(
                    ['Date', 'Token No', 'Candidate Name', 'Mobile', 'Agent', 'Category', 'Price', 'Paid', 'Paid To', 'Ref'],
                    filteredOuts.map((o) => [
                      o.date,
                      o.no,
                      o.name,
                      o.phone,
                      o.agent,
                      o.cat,
                      o.price,
                      o.paid,
                      o.paidTo,
                      o.payRef,
                    ])
                  );
                  downloadFile(`ittc-out-students-${todayDDMMYYYY()}.csv`, csv, 'text/csv;charset=utf-8');
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>{bn ? 'এক্সেল (.csv)' : 'Export Excel (.csv)'}</span>
              </button>
              <button
                type="button"
                onClick={() => setShowForm((v) => !v)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>{bn ? '+ নতুন আউট জব' : '+ New Out Job'}</span>
              </button>
            </div>
          </div>

          {/* 3 KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div className="mg-bento-in mg-spring-card mg-spotlight bg-amber-50/50 dark:bg-amber-950/20 rounded-xl p-4 border border-amber-200 dark:border-amber-900/60" style={{ animationDelay: '0.04s' }}>
              <div className="relative z-10 text-[11px] font-semibold text-amber-800 dark:text-amber-300 uppercase">
                {bn ? 'মোট বাইরের স্টুডেন্ট জব' : 'TOTAL OUT STUDENT JOBS'}
              </div>
              <div className="relative z-10 font-mono-num text-2xl font-extrabold text-slate-900 dark:text-white mt-1.5">
                <KineticCounter target={outs.length} />
              </div>
            </div>
            <div className="mg-bento-in mg-spring-card mg-spotlight bg-teal-50/50 dark:bg-teal-950/20 rounded-xl p-4 border border-teal-200 dark:border-teal-900/60" style={{ animationDelay: '0.08s' }}>
              <div className="relative z-10 text-[11px] font-semibold text-teal-800 dark:text-teal-300 uppercase">
                {bn ? 'আজকের বাইরের জব' : "TODAY'S EXTERNAL JOBS"}
              </div>
              <div className="relative z-10 font-mono-num text-2xl font-extrabold text-slate-900 dark:text-white mt-1.5">
                <KineticCounter target={todayOutsCount} />
              </div>
            </div>
            <div className="mg-bento-in mg-spring-card mg-spotlight bg-emerald-50/50 dark:bg-emerald-950/20 rounded-xl p-4 border border-emerald-200 dark:border-emerald-900/60" style={{ animationDelay: '0.12s' }}>
              <div className="relative z-10 text-[11px] font-semibold text-emerald-800 dark:text-emerald-300 uppercase">
                {bn ? 'মোট আদায়কৃত ফি' : 'TOTAL FEE COLLECTED'}
              </div>
              <div className="relative z-10 font-mono-num text-2xl font-extrabold text-slate-900 dark:text-white mt-1.5">
                <KineticCounter target={totalFeeCollected} prefix="৳" />
              </div>
            </div>
          </div>

          {/* Filter Bar */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={bn ? 'নাম, টোকেন নং, মোবাইল বা এজেন্ট...' : 'Candidate Name, Token No, Mobile, Agent...'}
                className="w-full pl-9 pr-3 py-2 text-xs sm:text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              />
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-500">{bn ? 'তারিখ:' : 'Date:'}</span>
              <input
                type="date"
                value={showAllDates ? '' : toInputDate(selectedDate)}
                onChange={(e) => {
                  if (e.target.value) {
                    setSelectedDate(fromInputDate(e.target.value));
                    setShowAllDates(false);
                  } else {
                    setShowAllDates(true);
                  }
                }}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono-num"
              />
              <button
                type="button"
                onClick={() => setShowAllDates((v) => !v)}
                className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer ${
                  showAllDates
                    ? 'bg-teal-600 border-teal-600 text-white'
                    : 'border-slate-200 dark:border-slate-700'
                }`}
              >
                {bn ? 'সব তারিখ' : 'All'}
              </button>
            </div>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
            >
              <option value="all">{bn ? 'সকল ক্যাটাগরি' : 'All Categories'}</option>
              {prices.map((p) => (
                <option key={p.id} value={p.cat}>
                  {p.cat}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Scrollable Lower Area */}
        <div
          className={
            showForm
              ? 'lg:flex-1 lg:min-h-0 lg:overflow-y-auto space-y-4'
              : 'lg:flex-1 lg:min-h-0 lg:flex lg:flex-col'
          }
        >
        {/* New Out Job Form */}
        {showForm && (
          <form
            onSubmit={handleSubmitOut}
            className="bg-white dark:bg-slate-900 rounded-xl border border-teal-200 dark:border-teal-800 p-5 space-y-4"
          >
            <h3 className="font-display text-base font-bold">
              {bn ? 'বাইরের পরীক্ষার্থী জব এন্ট্রি' : 'Register External Test Candidate'}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  {bn ? 'পরীক্ষার্থীর নাম *' : 'Candidate Name *'}
                </label>
                <input
                  required
                  value={outName}
                  onChange={(e) => setOutName(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  {bn ? 'মোবাইল' : 'Mobile'}
                </label>
                <input
                  value={outPhone}
                  onChange={(e) => setOutPhone(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  {bn ? 'এজেন্ট / রেফারেন্স' : 'Agent / Reference'}
                </label>
                <input
                  value={outAgent}
                  onChange={(e) => setOutAgent(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  {bn ? 'জব ক্যাটাগরি' : 'Job Category'}
                </label>
                <select
                  value={cat}
                  onChange={(e) => setCat(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                >
                  {(activePrices.length > 0 ? activePrices : prices).map((p) => (
                    <option key={p.id} value={p.cat}>
                      {p.cat} — {formatTaka(p.price)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  {bn ? `জমা ৳ (মূল্য ${formatTaka(standardFee)})` : `Paid ৳ (Price ${formatTaka(standardFee)})`}
                </label>
                <input
                  type="number"
                  min={0}
                  value={outPaid}
                  onChange={(e) => setOutPaid(e.target.value)}
                  placeholder={String(standardFee)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  {bn ? 'গ্রহণকারী (Paid To)' : 'Paid To'}
                </label>
                <input
                  value={outPaidTo}
                  onChange={(e) => setOutPaidTo(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  {bn ? 'পেমেন্ট রেফারেন্স' : 'Payment Ref'}
                </label>
                <input
                  value={outPayRef}
                  onChange={(e) => setOutPayRef(e.target.value)}
                  placeholder="Cash / bKash / Receipt"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  {bn ? 'নোট' : 'Remarks'}
                </label>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-4 text-xs">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={printAfterSave}
                    onChange={(e) => setPrintAfterSave(e.target.checked)}
                    className="rounded border-slate-300 text-teal-600"
                  />
                  <span>{bn ? 'টোকেন প্রিন্ট খুলুন' : 'Open token print'}</span>
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={recordCash}
                    onChange={(e) => setRecordCash(e.target.checked)}
                    className="rounded border-slate-300 text-teal-600"
                  />
                  <span>{bn ? 'ক্যাশবুকে যোগ করুন' : 'Auto-add to Cashbook'}</span>
                </label>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold cursor-pointer"
                >
                  {bn ? 'বাতিল' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold cursor-pointer"
                >
                  {bn ? 'সংরক্ষণ ও টোকেন' : 'Save & Issue Token'}
                </button>
              </div>
            </div>
          </form>
        )}

        {/* Out of Student Table */}
        <div
          className={`bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden ${
            showForm ? '' : 'lg:flex-1 lg:min-h-0 lg:flex lg:flex-col'
          }`}
        >
          {filteredOuts.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
              {bn ? 'কোনো বাইরের স্টুডেন্ট রেকর্ড পাওয়া যায়নি।' : 'No external student records found.'}
            </div>
          ) : (
            <div className={`overflow-x-auto ${showForm ? '' : 'lg:flex-1 lg:min-h-0 lg:overflow-y-auto'}`}>
              <table className="w-full text-left border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-[#111b2e]">
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#111b2e] text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    <th className="py-2.5 px-3">DATE</th>
                    <th className="py-2.5 px-3">TOKEN NO</th>
                    <th className="py-2.5 px-3">CANDIDATE NAME</th>
                    <th className="py-2.5 px-3">MOBILE</th>
                    <th className="py-2.5 px-3">AGENT / REFERENCE</th>
                    <th className="py-2.5 px-3">JOB CATEGORY</th>
                    <th className="py-2.5 px-3 text-right">PRICE</th>
                    <th className="py-2.5 px-3 text-right">PAID</th>
                    <th className="py-2.5 px-3">PAID TO</th>
                    <th className="py-2.5 px-3">PAYMENT REF</th>
                    <th className="py-2.5 px-3 text-right">ACTIONS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {filteredOuts.map((o) => {
                    const returnBadge = returnBadgeByJobNo.get(o.no.trim());
                    return (
                    <tr key={o.id} className="mg-row-scan">
                      <td className="py-2.5 px-3 font-mono-num text-xs whitespace-nowrap">{o.date}</td>
                      <td className="py-2.5 px-3 font-mono-num text-xs font-bold whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span>{o.no}</span>
                          {returnBadge && (
                            <span className="px-1.5 py-0.5 rounded bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-[9px] font-bold text-rose-700 dark:text-rose-300">
                              {returnBadge}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-xs sm:text-sm text-slate-900 dark:text-white">
                        {o.name}
                      </td>
                      <td className="py-2.5 px-3 font-mono-num text-xs">{o.phone || '—'}</td>
                      <td className="py-2.5 px-3 text-xs">{o.agent || '—'}</td>
                      <td className="py-2.5 px-3 text-xs font-medium">{o.cat}</td>
                      <td className="py-2.5 px-3 font-mono-num text-xs text-right">{formatTaka(o.price)}</td>
                      <td className="py-2.5 px-3 font-mono-num text-xs text-right font-bold text-emerald-600 dark:text-emerald-400">
                        {formatTaka(o.paid)}
                      </td>
                      <td className="py-2.5 px-3 text-xs">{o.paidTo || '—'}</td>
                      <td className="py-2.5 px-3 font-mono-num text-xs">{o.payRef || '—'}</td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              onPrintSlip({
                                kind: 'out',
                                date: o.date,
                                no: o.no,
                                name: o.name,
                                cat: o.cat,
                                amount: o.price || o.paid,
                                paid: o.paid,
                                note: o.note,
                              })
                            }
                            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 text-xs font-semibold cursor-pointer"
                          >
                            <Printer className="w-3 h-3" />
                            <span>Token</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRetrainJob({
                                no: o.no,
                                sid: o.phone || 'OUT',
                                sname: o.name,
                                cat: o.cat,
                                pay: Number(o.paid || o.price || 0),
                                isStudentJob: false,
                              });
                              setRetrainAct('Plate Return');
                              setRetrainReason('Plate defect / Retest needed');
                              setRetrainFee('0');
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-900/60 text-[11px] font-semibold text-amber-800 dark:text-amber-300 cursor-pointer"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>{bn ? 'রিটার্ন / রিট্রেইন' : 'Return / Retrain'}</span>
                          </button>
                        </div>
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
        {retrainModal}
      </div>
    );
  }

  // Daily Job Register mode (matching user screenshots + modern controls)
  const dateCollection = filteredJobs.reduce((a, b) => a + Number(b.pay || 0), 0);
  const totalStandardPrice = filteredJobs.reduce(
    (a, b) => a + Number(b.pay || 0) + Number(b.discount || 0),
    0
  );
  const totalDiscountAmt = filteredJobs.reduce((a, b) => a + Number(b.discount || 0), 0);
  const topFourCats = prices.slice(0, 4);

  const handleExportExcelXlsx = () => {
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
    const rowsData = filteredJobs.map((j, i) => {
      const disc = Number(j.discount || 0);
      const std = Number(j.pay || 0) + disc;
      return [
        i + 1,
        j.date,
        j.no,
        j.sname,
        j.sid,
        j.cat,
        std,
        disc,
        Number(j.pay || 0),
        j.note || '',
      ];
    });
    const totalRow = [
      '',
      '',
      'TOTAL',
      `${filteredJobs.length} Jobs`,
      '',
      '',
      totalStandardPrice,
      totalDiscountAmt,
      dateCollection,
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
    const fileLabel = showAllDates ? `all-jobs-${todayDDMMYYYY()}` : selectedDate;
    XLSX.writeFile(wb, `ittc-job-register-${fileLabel}.xlsx`);
  };

  const handleDailyPrint = () => {
    flushSync(() => setShowAllDates(false));
    const q = search.trim().toLowerCase();
    const dailyRows = [...jobs]
      .reverse()
      .filter((j) => {
        if (selectedDate && j.date !== selectedDate) return false;
        if (categoryFilter !== 'all' && j.cat !== categoryFilter) return false;
        if (!q) return true;
        return (
          j.no.toLowerCase().includes(q) ||
          j.sname.toLowerCase().includes(q) ||
          j.sid.toLowerCase().includes(q) ||
          j.cat.toLowerCase().includes(q)
        );
      });
    const dailySum = dailyRows.reduce((a, b) => a + Number(b.pay || 0), 0);
    if (onPrintReport) {
      onPrintReport({
        variant: 'register',
        title: `Daily Job Register — ${selectedDate}`,
        subtitle: `${dailyRows.length} jobs · Total Collection: ${formatTaka(dailySum)}`,
        filename: `ittc-daily-jobs-${selectedDate}`,
        footerSummary: `Total Daily Jobs: ${dailyRows.length} | Total Collection: ${formatTaka(dailySum)}`,
        columns: ['SL', 'Job No', 'Student Name', 'Student Code', 'Category', 'Price', 'Discount', 'Payable'],
        rows: dailyRows.map((j, idx) => [
          idx + 1,
          j.no,
          j.sname,
          j.sid,
          j.cat,
          formatTaka(Number(j.pay) + Number(j.discount || 0)),
          formatTaka(j.discount || 0),
          formatTaka(j.pay),
        ]),
      });
    } else {
      window.print();
    }
  };

  const handleMonthlyPrint = () => {
    const { key: monthKey, label: monthLabel } = getMonthKeyAndLabel(selectedDate || today);
    const monthRows = [...jobs]
      .reverse()
      .filter((j) => {
        const matchesMonth = j.date.endsWith(monthKey);
        if (!matchesMonth) return false;
        if (categoryFilter !== 'all' && j.cat !== categoryFilter) return false;
        return true;
      });
    const rowsToPrint =
      monthRows.length > 0
        ? monthRows
        : [...jobs].reverse().filter((j) => categoryFilter === 'all' || j.cat === categoryFilter);
    const titleLabel =
      monthRows.length > 0
        ? `Monthly Job Register — ${monthLabel}`
        : `Complete Job Register — ${todayDDMMYYYY()}`;
    const totalSum = rowsToPrint.reduce((a, b) => a + Number(b.pay || 0), 0);

    if (onPrintReport) {
      onPrintReport({
        variant: 'register',
        title: titleLabel,
        subtitle: `${rowsToPrint.length} jobs · Total Collection: ${formatTaka(totalSum)}`,
        filename: `ittc-monthly-jobs-${monthKey}`,
        footerSummary: `Total Monthly Jobs: ${rowsToPrint.length} | Total Collection: ${formatTaka(totalSum)}`,
        columns: ['SL', 'Job No', 'Student Name', 'Student Code', 'Category', 'Price', 'Discount', 'Payable'],
        rows: rowsToPrint.map((j, idx) => [
          idx + 1,
          j.no,
          j.sname,
          j.sid,
          j.cat,
          formatTaka(Number(j.pay) + Number(j.discount || 0)),
          formatTaka(j.discount || 0),
          formatTaka(j.pay),
        ]),
      });
    } else {
      window.print();
    }
  };

  return (
    <div className="space-y-4 lg:space-y-0 lg:flex-1 lg:min-h-0 lg:flex lg:flex-col lg:gap-3">
      {/* Sticky / Non-Scrolling Top Controls */}
      <div className="shrink-0 space-y-2.5">
      {/* Top Toolbar matching Screenshot 4 */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
            <Calendar className="w-4 h-4 text-teal-600 shrink-0" />
            <span>{bn ? 'তারিখ:' : 'Select Date:'}</span>
            <input
              type="date"
              value={showAllDates ? '' : toInputDate(selectedDate)}
              onChange={(e) => {
                if (e.target.value) {
                  setSelectedDate(fromInputDate(e.target.value));
                  setShowAllDates(false);
                }
              }}
              className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono-num"
            />
          </div>

          <button
            type="button"
            onClick={() => setShowAllDates((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer transition-colors ${
              showAllDates
                ? 'bg-teal-600 border-teal-600 text-white'
                : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>{bn ? `সব জব (${jobs.length})` : `All Job (${jobs.length})`}</span>
          </button>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200"
          >
            <option value="all">
              {bn ? `সকল ক্যাটাগরি (${jobs.length})` : `All Categories (${jobs.length})`}
            </option>
            {prices.map((p) => (
              <option key={p.id} value={p.cat}>
                {p.cat}
              </option>
            ))}
          </select>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={bn ? 'নাম, কোড বা জব নং...' : 'Search job, name, code...'}
              className="pl-8 pr-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 w-40 sm:w-48 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleDailyPrint}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>{bn ? 'দৈনিক প্রিন্ট' : 'Daily Print'}</span>
          </button>

          <button
            type="button"
            onClick={handleMonthlyPrint}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>{bn ? 'মাসিক প্রিন্ট' : 'Monthly Print'}</span>
          </button>

          <button
            type="button"
            onClick={handleExportExcelXlsx}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>{bn ? 'এক্সেল (.xlsx)' : 'Export Excel (.xlsx)'}</span>
          </button>

          {megaSync && (
            <>
              <button
                type="button"
                onClick={() => setMegaExcelModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold cursor-pointer"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>{bn ? 'MEGA Excel (দেখুন/ডাউনলোড)' : 'MEGA Excel (View/Download)'}</span>
              </button>

              <button
                type="button"
                disabled={megaSync.busy}
                onClick={async () => {
                  setRegisterNotice(null);
                  if (!megaSync.configured) {
                    setMegaExcelModalOpen(true);
                    return;
                  }
                  try {
                    await megaSync.onUploadNow();
                    setRegisterNotice({
                      type: 'success',
                      text: bn
                        ? 'Mega ক্লাউডে ডেটাবেজ JSON ও দৈনিক Excel (.xlsx) সফলভাবে আপলোড হয়েছে!'
                        : 'Uploaded workspace JSON & daily Excel (.xlsx) to Mega Cloud!',
                    });
                  } catch (err) {
                    setRegisterNotice({
                      type: 'error',
                      text: err instanceof Error ? err.message : 'Mega upload failed.',
                    });
                  }
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer"
              >
                <Cloud className="w-3.5 h-3.5" />
                <span>
                  {megaSync.busy || megaSync.liveStatus === 'syncing'
                    ? bn
                      ? 'সিঙ্ক হচ্ছে...'
                      : 'Syncing...'
                    : 'Cloud Upload (MEGA)'}
                </span>
                <span
                  className={`w-2.5 h-2.5 rounded-full border border-white/80 ${
                    megaSync.liveStatus === 'syncing' || megaSync.liveStatus === 'pending'
                      ? 'bg-sky-300 animate-pulse'
                      : megaSync.configured
                        ? 'bg-emerald-400'
                        : 'bg-amber-300'
                  }`}
                />
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => setRecoveryModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-900/50 text-amber-800 dark:text-amber-200 text-xs font-semibold cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{bn ? 'হারানো জব পুনরুদ্ধার' : 'Recover Jobs'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (onOpenNewJob) {
                onOpenNewJob();
              } else {
                setShowForm((v) => !v);
              }
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 dark:bg-teal-700 hover:bg-slate-800 text-white text-xs font-semibold cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>
              {showForm && !onOpenNewJob
                ? bn
                  ? 'বন্ধ করুন'
                  : 'Close Form'
                : bn
                  ? '+ নতুন জব এন্ট্রি'
                  : '+ New Job Entry'}
            </span>
          </button>
        </div>
      </div>

      {registerNotice && (
        <div
          className={`px-4 py-2.5 rounded-xl border text-xs font-medium flex items-center justify-between gap-2 ${
            registerNotice.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
              : 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200'
          }`}
        >
          <span>{registerNotice.text}</span>
          <button
            type="button"
            onClick={() => setRegisterNotice(null)}
            className="p-0.5 rounded hover:bg-black/5 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 4 Category Quick-Filter KPI Strip (TOTAL DATE JOBS & TOTAL COLLECTION moved to Quick Actions & Summary) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {topFourCats.map((p, idx) => {
          const count = jobs.filter(
            (j) => (showAllDates || !selectedDate || j.date === selectedDate) && j.cat === p.cat
          ).length;
          const isActive = categoryFilter === p.cat;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setCategoryFilter((prev) => (prev === p.cat ? 'all' : p.cat))}
              style={{ animationDelay: `${0.04 + idx * 0.04}s` }}
              className={`mg-bento-in mg-spring-card mg-spotlight text-left rounded-xl p-4 border transition-colors cursor-pointer ${
                isActive
                  ? 'bg-teal-50/70 dark:bg-teal-950/40 border-teal-400 dark:border-teal-600'
                  : 'hover:border-teal-300'
              }`}
            >
              <div className="relative z-10 text-[11px] font-semibold text-slate-500 uppercase truncate">
                {p.cat}
              </div>
              <div className="relative z-10 font-mono-num text-2xl font-extrabold text-slate-900 dark:text-white mt-1.5">
                <KineticCounter target={count} />
              </div>
            </button>
          );
        })}
      </div>

      {/* Modern Live Category Breakdown Strip */}
      {categoryBreakdown.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowCategoryBreakdown((v) => !v)}
              className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mr-1 cursor-pointer hover:text-teal-700"
            >
              {bn ? 'ক্যাটাগরি সামারি:' : 'CATEGORY BREAKDOWN:'}
            </button>
            {showCategoryBreakdown &&
              categoryBreakdown.map((item) => {
                const active = categoryFilter === item.cat;
                return (
                  <button
                    key={item.cat}
                    type="button"
                    onClick={() => setCategoryFilter((prev) => (prev === item.cat ? 'all' : item.cat))}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold cursor-pointer transition-colors ${
                      active
                        ? 'bg-teal-600 border-teal-600 text-white'
                        : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-teal-400'
                    }`}
                  >
                    <span>{item.cat}</span>
                    <span
                      className={`font-mono-num px-1.5 py-0.2 rounded-full text-[10px] ${
                        active
                          ? 'bg-white/20 text-white'
                          : 'bg-teal-100/80 dark:bg-teal-900/60 text-teal-800 dark:text-teal-300'
                      }`}
                    >
                      {item.count}
                    </span>
                  </button>
                );
              })}
          </div>
          {categoryFilter !== 'all' && (
            <button
              type="button"
              onClick={() => setCategoryFilter('all')}
              className="text-[11px] font-semibold text-teal-700 dark:text-teal-400 hover:underline cursor-pointer"
            >
              {bn ? 'ফিল্টার রিসেট' : 'Clear Filter'}
            </button>
          )}
        </div>
      )}

      </div>

      {/* Scrollable Lower Content Area */}
      <div
        className={
          showForm
            ? 'lg:flex-1 lg:min-h-0 lg:overflow-y-auto space-y-4'
            : 'lg:flex-1 lg:min-h-0 lg:flex lg:flex-col'
        }
      >
      {/* Collapsible New Job Entry Form (fallback when inline form toggled) */}
      {showForm && (
        <form
          onSubmit={handleSubmitJob}
          className="bg-white dark:bg-slate-900 rounded-xl border border-teal-200 dark:border-teal-800 p-5 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
              {bn ? 'নতুন স্টুডেন্ট প্র্যাকটিক্যাল জব এন্ট্রি' : 'New Practical Test Job Entry'}
            </h3>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-mono-num">
              <span>
                {bn ? 'স্টুডেন্টের কোটা ব্যবহার:' : 'Student Quota Used:'}{' '}
                <b className={!inlineQuotaCheck.allowed ? 'text-red-600' : 'text-teal-600'}>
                  {inlineQuotaCheck.currentEntries} / {inlineQuotaCheck.totalAllowedLimit}
                </b>
                {inlineQuotaCheck.rentedLimit > 0 && (
                  <span className="text-[11px] text-indigo-600 dark:text-indigo-400 ml-1">
                    (Base {inlineQuotaCheck.baseLimit} + Rented {inlineQuotaCheck.rentedLimit})
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={() => setShowInlineRent((v) => !v)}
                className="px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-200 font-sans font-bold text-[11px] cursor-pointer"
              >
                + সুপারভাইজার লিমিট ভাড়া
              </button>
            </div>
          </div>

          {(!inlineQuotaCheck.allowed || showInlineRent) && students.length > 0 && (
            <div
              className={`p-3 rounded-lg border space-y-2 ${
                !inlineQuotaCheck.allowed
                  ? 'bg-rose-50 dark:bg-rose-950/35 border-rose-300 dark:border-rose-800'
                  : 'bg-indigo-50/70 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-800'
              }`}
            >
              {!inlineQuotaCheck.allowed && (
                <div className="text-xs font-semibold text-rose-800 dark:text-rose-200">
                  লিমিট পূর্ণ হয়ে গেছে ({inlineQuotaCheck.currentEntries}/{inlineQuotaCheck.totalAllowedLimit})। নতুন জব এন্ট্রি করতে সুপারভাইজার লিমিট ভাড়া নিন বা Job Price &amp; Limits বাড়ান।
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
                <div>
                  <label className="block text-[11px] font-bold mb-1">অতিরিক্ত লিমিট *</label>
                  <input
                    type="number"
                    min={1}
                    value={inlineRentExtra}
                    onChange={(e) => setInlineRentExtra(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono-num"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold mb-1">সুপারভাইজারের নাম</label>
                  <input
                    list="jobs-inline-supervisors"
                    value={inlineRentSupervisor}
                    onChange={(e) => setInlineRentSupervisor(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                  <datalist id="jobs-inline-supervisors">
                    <option value="Supervisor" />
                    {staff.map((st) => (
                      <option key={st.id} value={st.name}>
                        {st.role}
                      </option>
                    ))}
                  </datalist>
                </div>
                <button
                  type="button"
                  disabled={inlineRentBusy}
                  onClick={handleInlineRentLimit}
                  className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer"
                >
                  {inlineRentBusy ? 'যুক্ত হচ্ছে...' : 'লিমিট ভাড়া যুক্ত করুন'}
                </button>
              </div>
            </div>
          )}

          {students.length === 0 ? (
            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>
                {bn
                  ? 'আগে স্টুডেন্ট ম্যানেজমেন্ট থেকে অন্তত একজন স্টুডেন্ট যোগ করুন।'
                  : 'Register at least one student in Student Management first.'}
              </span>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
              <div className="lg:col-span-2">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  {bn ? 'স্টুডেন্ট *' : 'Student *'}
                </label>
                <select
                  value={sid}
                  onChange={(e) => {
                    setSid(e.target.value);
                    setInlineShowChangeDueDate(false);
                    setInlineDuplicateConfirmed(false);
                  }}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                >
                  {students.map((s) => (
                    <option key={s.id} value={s.code}>
                      {s.name} ({s.code})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  {bn ? 'জব ক্যাটাগরি *' : 'Category *'}
                </label>
                <select
                  value={cat}
                  onChange={(e) => setCat(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                >
                  {(activePrices.length > 0 ? activePrices : prices).map((p) => (
                    <option key={p.id} value={p.cat}>
                      {p.cat} — {formatTaka(p.price)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  {bn ? 'ছাড় / ডিসকাউন্ট ৳' : 'Discount ৳'}
                </label>
                <input
                  type="number"
                  min={0}
                  max={standardFee}
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  {bn ? 'প্রদেয় ফি' : 'Payable'}
                </label>
                <div className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 font-mono-num font-bold">
                  {formatTaka(inlinePayable)}
                </div>
              </div>
              <div className="sm:col-span-2 lg:col-span-5">
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={bn ? 'মন্তব্য / প্লেট নোট (ঐচ্ছিক)' : 'Plate / remarks (optional)'}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
            </div>
          )}

          {students.length > 0 && inlineSameDayJobs.length > 0 && (
            <div className="rounded-xl border-2 border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/40 p-3.5 space-y-2">
              <div className="flex items-start gap-2 text-xs font-bold text-amber-900 dark:text-amber-200">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <div>
                    সতর্কবার্তা: এই ছাত্র আজ/এই তারিখে ({today}) ইতিমধ্যে{' '}
                    {inlineSameDayJobs.length}টি জব নিয়েছে!
                  </div>
                  <div className="mt-1 font-normal text-[11px] font-mono-num text-amber-800 dark:text-amber-300">
                    {inlineSameDayJobs.map((ej) => `${ej.no} (${ej.cat})`).join(', ')}
                  </div>
                </div>
              </div>
              <label className="flex items-start gap-2 pt-2 border-t border-amber-200 dark:border-amber-800 text-xs font-semibold text-amber-950 dark:text-amber-100 cursor-pointer">
                <input
                  type="checkbox"
                  checked={inlineDuplicateConfirmed}
                  onChange={(e) => setInlineDuplicateConfirmed(e.target.checked)}
                  className="mt-0.5 rounded border-amber-400 text-amber-600"
                />
                <span>
                  সুপারভাইজার / অপারেটর অনুমোদন: একই দিনে অতিরিক্ত জব এন্ট্রি করার অনুমতি দিচ্ছি
                </span>
              </label>
            </div>
          )}

          {students.length > 0 && inlineBalanceCheck.isDueEntry && (
            <div
              className={`rounded-lg border p-3.5 space-y-2.5 ${
                inlineBalanceCheck.isGracePeriodActive
                  ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/30'
                  : 'border-rose-300 dark:border-rose-800 bg-rose-50/80 dark:bg-rose-950/35'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-semibold text-slate-900 dark:text-white">
                  {inlineBalanceCheck.uiAlertNote}
                </div>
                {inlineBalanceCheck.isGracePeriodActive && (
                  <button
                    type="button"
                    onClick={() => setInlineShowChangeDueDate((v) => !v)}
                    className="px-2.5 py-1 rounded bg-white dark:bg-slate-900 border border-emerald-300 dark:border-emerald-700 text-[11px] font-bold cursor-pointer"
                  >
                    {inlineShowChangeDueDate ? 'বন্ধ করুন' : 'তারিখ পরিবর্তন'}
                  </button>
                )}
              </div>
              {(inlineBalanceCheck.needSupervisorDueDate || inlineShowChangeDueDate) && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 items-end">
                  <div>
                    <label className="block text-[11px] font-bold mb-1">কবে টাকা জমা দিবে *</label>
                    <input
                      type="date"
                      min={toInputDate(todayDDMMYYYY())}
                      value={inlinePromiseDateInput}
                      onChange={(e) => setInlinePromiseDateInput(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono-num"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold mb-1">সুপারভাইজারের নাম</label>
                    <input
                      list="jobs-inline-supervisors"
                      value={inlineDueSupervisor}
                      onChange={(e) => setInlineDueSupervisor(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={inlineDueDateBusy}
                    onClick={handleInlineSetDueDate}
                    className="px-3 py-1.5 rounded bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold cursor-pointer"
                  >
                    {inlineDueDateBusy
                      ? 'সংরক্ষণ হচ্ছে...'
                      : `বকেয়ার তারিখ সংরক্ষণ (${formatTaka(inlineBalanceCheck.dueAmount)})`}
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={printAfterSave}
                  onChange={(e) => setPrintAfterSave(e.target.checked)}
                  className="rounded border-slate-300 text-teal-600"
                />
                <span>{bn ? 'এন্ট্রির পর টোকেন প্রিন্ট খুলুন' : 'Open thermal token after save'}</span>
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={recordCash && !inlineBalanceCheck.isDueEntry}
                  disabled={inlineBalanceCheck.isDueEntry}
                  onChange={(e) => setRecordCash(e.target.checked)}
                  className="rounded border-slate-300 text-teal-600 disabled:opacity-50"
                />
                <span>
                  {inlineBalanceCheck.isDueEntry
                    ? 'বাকিতে এন্ট্রি'
                    : bn
                      ? 'ক্যাশবুকে যোগ করুন'
                      : 'Auto-add to Cashbook'}
                </span>
              </label>
            </div>
            <button
              type="submit"
              disabled={
                saving ||
                students.length === 0 ||
                !inlineQuotaCheck.allowed ||
                !inlineBalanceCheck.allowed ||
                (inlineSameDayJobs.length > 0 && !inlineDuplicateConfirmed)
              }
              className="px-5 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer disabled:cursor-not-allowed"
            >
              {!inlineQuotaCheck.allowed
                ? bn
                  ? 'লিমিট পূর্ণ'
                  : 'Limit Reached'
                : !inlineBalanceCheck.allowed
                  ? 'ব্যালেন্স শেষ (অনুমোদন দিন)'
                  : inlineSameDayJobs.length > 0 && !inlineDuplicateConfirmed
                    ? 'ডুপ্লিকেট জব কনফার্ম করুন'
                    : bn
                      ? 'জব নিবন্ধন ও টোকেন'
                      : 'Register Job & Issue Token'}
            </button>
          </div>
        </form>
      )}

      {/* Register Table Card matching Screenshot 4 */}
      <div
        className={`bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden ${
          showForm ? '' : 'lg:flex-1 lg:min-h-0 lg:flex lg:flex-col'
        }`}
      >
        <div className="shrink-0 px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
            {showAllDates
              ? bn
                ? `সকল জব রেজিস্টার (${filteredJobs.length})`
                : `All Job Register (${filteredJobs.length})`
              : bn
                ? `${selectedDate} তারিখের জব রেজিস্টার (${filteredJobs.length})`
                : `Job Register for ${selectedDate} (${filteredJobs.length})`}
          </h3>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {bn ? 'স্বয়ংক্রিয় দৈনিক ক্রমিক নম্বর ট্র্যাকিং' : 'Auto sequential daily number tracking'}
          </span>
        </div>

        {filteredJobs.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500 dark:text-slate-400">
            {bn ? 'এই তারিখে কোনো জব রেকর্ড করা হয়নি।' : 'No jobs recorded on this date.'}
          </div>
        ) : (
          <div className={`overflow-x-auto ${showForm ? '' : 'lg:flex-1 lg:min-h-0 lg:overflow-y-auto'}`}>
            <table className="w-full text-left border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-[#111b2e]">
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#111b2e] text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase">
                  <th className="py-2.5 px-4">SL</th>
                  <th className="py-2.5 px-4">JOB NUMBER</th>
                  <th className="py-2.5 px-4">TRAINEE NAME</th>
                  <th className="py-2.5 px-4">STUDENT CODE</th>
                  <th className="py-2.5 px-4">JOB CATEGORY</th>
                  <th className="py-2.5 px-4 text-right">STANDARD PRICE</th>
                  <th className="py-2.5 px-4 text-right">DISCOUNT</th>
                  <th className="py-2.5 px-4 text-right">PAYABLE</th>
                  <th className="py-2.5 px-4 text-right">ACTIONS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {filteredJobs.map((j, idx) => {
                  const disc = Number(j.discount || 0);
                  const std = Number(j.pay || 0) + disc;
                  const returnBadge = returnBadgeByJobNo.get(j.no.trim());
                  const dueMeta = parseDueJobNote(j.note, j.pay, j.paid);
                  return (
                    <tr key={j.id} className="mg-row-scan">
                      <td className="py-2.5 px-4 font-mono-num text-xs text-slate-500">
                        {idx + 1}
                      </td>
                      <td className="py-2.5 px-4 font-mono-num text-xs font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span>{j.no}</span>
                          {showAllDates && (
                            <span className="text-[10px] text-slate-400 font-normal">
                              ({j.date})
                            </span>
                          )}
                          {returnBadge && (
                            <span className="px-1.5 py-0.5 rounded bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-[9px] font-bold text-rose-700 dark:text-rose-300">
                              {returnBadge}
                            </span>
                          )}
                          {dueMeta.isDueEntry && (
                            <span
                              title={dueMeta.tokenPaymentNote}
                              className="px-1.5 py-0.5 rounded bg-red-50 dark:bg-red-950/60 border border-red-300 dark:border-red-800 text-[9px] font-bold text-red-700 dark:text-red-300"
                            >
                              বকেয়া {formatTaka(dueMeta.dueAmount)}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 font-bold text-xs text-slate-900 dark:text-white">
                        {onInspectStudent ? (
                          <button
                            type="button"
                            onClick={() => onInspectStudent(j.sid)}
                            className="text-left hover:text-teal-700 dark:hover:text-teal-400 hover:underline cursor-pointer"
                          >
                            {j.sname}
                          </button>
                        ) : (
                          j.sname
                        )}
                      </td>
                      <td className="py-2.5 px-4 font-mono-num text-xs font-bold text-teal-700 dark:text-teal-400">
                        {onInspectStudent ? (
                          <button
                            type="button"
                            onClick={() => onInspectStudent(j.sid)}
                            className="hover:underline cursor-pointer"
                          >
                            {j.sid}
                          </button>
                        ) : (
                          j.sid
                        )}
                      </td>
                      <td className="py-2.5 px-4">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-teal-50 dark:bg-teal-950/60 border border-teal-200 dark:border-teal-800 text-teal-700 dark:text-teal-300 text-[11px] font-semibold whitespace-nowrap">
                          {j.cat}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 font-mono-num text-xs text-right text-slate-500 dark:text-slate-400">
                        {formatTaka(std)}
                      </td>
                      <td className="py-2.5 px-4 font-mono-num text-xs text-right text-slate-500 dark:text-slate-400">
                        {formatTaka(disc)}
                      </td>
                      <td className="py-2.5 px-4 font-mono-num text-xs text-right font-bold text-slate-900 dark:text-white">
                        {formatTaka(j.pay)}
                      </td>
                      <td className="py-2.5 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onPrintSlip(buildJobSlipFromEntry(j))}
                            className="px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
                          >
                            Print Token
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRetrainJob({
                                no: j.no,
                                sid: j.sid,
                                sname: j.sname,
                                cat: j.cat,
                                pay: Number(j.pay || 0),
                                isStudentJob: true,
                              });
                              setRetrainAct('Plate Return');
                              setRetrainReason('Plate defect / Retest needed');
                              setRetrainFee('0');
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-900/60 text-[11px] font-semibold text-amber-800 dark:text-amber-300 cursor-pointer"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>{bn ? 'রিটার্ন / রিট্রেইন' : 'Return / Retrain'}</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="sticky bottom-0 z-10 bg-slate-50 dark:bg-[#111b2e]">
                <tr className="border-t-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#111b2e] text-xs font-bold text-slate-900 dark:text-white">
                  <td colSpan={5} className="py-3 px-4">
                    {bn
                      ? `মোট জব: ${filteredJobs.length} টি | মোট সংগ্রহ: ${formatTaka(dateCollection)}`
                      : `Total Jobs: ${filteredJobs.length} | Total Collection: ${formatTaka(dateCollection)}`}
                  </td>
                  <td className="py-3 px-4 text-right font-mono-num">
                    {formatTaka(totalStandardPrice)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono-num text-amber-700 dark:text-amber-400">
                    {formatTaka(totalDiscountAmt)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono-num text-teal-700 dark:text-teal-300">
                    {formatTaka(dateCollection)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
      </div>

      {/* Retrain / Return Modal */}
      {retrainModal}

      <MegaExcelArchiveModal
        open={megaExcelModalOpen}
        lang={lang}
        defaultDate={selectedDate || today}
        megaSync={megaSync}
        onClose={() => setMegaExcelModalOpen(false)}
      />

      <JobRecoveryModal
        open={recoveryModalOpen}
        lang={lang}
        jobs={jobs}
        students={students}
        prices={prices}
        cash={cash}
        auditLogs={auditLogs}
        megaConfigured={Boolean(megaSync?.configured)}
        onClose={() => setRecoveryModalOpen(false)}
        onAdd={onAdd}
        onLogAudit={onLogAudit}
      />
    </div>
  );
}
