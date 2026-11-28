import { useMemo, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  Award,
  CheckCircle2,
  CircleDollarSign,
  FileSpreadsheet,
  MessageCircle,
  Phone,
  Printer,
  Search,
  User,
  Wallet,
  X,
} from 'lucide-react';
import { downloadFile, formatTaka, toCsv, todayDDMMYYYY } from '../../lib/format';
import {
  computeStudentJobBalanceSummary,
  getStudentDueDateApproval,
  parseDueJobNote,
} from '../../lib/jobLimits';
import { KineticCounter } from '../../lib/motion';
import type { PrintableReportSpec } from '../../lib/print';
import type { SubCollectionKey } from '../../lib/store';
import type { AuditLog, CashEntry, JobEntry, JobReturn, Lang, Student } from '../../types';

interface DueViewProps {
  students: Student[];
  jobs: JobEntry[];
  returns?: JobReturn[];
  cash: CashEntry[];
  auditLogs?: AuditLog[];
  lang: Lang;
  onUpdate: (key: SubCollectionKey, id: string, patch: Record<string, unknown>) => Promise<void>;
  onAdd: (key: SubCollectionKey, raw: Record<string, unknown>) => Promise<string>;
  onLogAudit?: (action: string, module: string, detail: string) => Promise<void>;
  onOpenProfile: (studentCode: string) => void;
  onPrintReport?: (spec: PrintableReportSpec) => void;
}

type DueFilter = 'due' | 'all' | 'settled' | 'jobDue';
type DueSort = 'dueDesc' | 'dueAsc' | 'code' | 'name';

interface ComputedDueRow {
  student: Student;
  contract: number;
  deposit: number;
  courseDue: number;
  jobDue: number;
  totalJobsSpent: number;
  jobsCount: number;
  duePromiseDate: string;
  dueSupervisor: string;
  isGraceActive: boolean;
}

export function DueView({
  students,
  jobs,
  returns = [],
  cash,
  auditLogs = [],
  lang,
  onUpdate,
  onAdd,
  onLogAudit,
  onOpenProfile,
  onPrintReport,
}: DueViewProps) {
  const bn = lang === 'bn';

  const [search, setSearch] = useState('');
  const [khataInput, setKhataInput] = useState('');
  const [khataError, setKhataError] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<DueFilter>('due');
  const [sortBy, setSortBy] = useState<DueSort>('dueDesc');

  const [activeRow, setActiveRow] = useState<ComputedDueRow | null>(null);
  const [modalTab, setModalTab] = useState<'installment' | 'adjust'>('installment');
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('Cash');
  const [payPurpose, setPayPurpose] = useState('');
  const [recordCashbook, setRecordCashbook] = useState(true);
  const [editContract, setEditContract] = useState('');
  const [editDeposit, setEditDeposit] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const computedRows = useMemo<ComputedDueRow[]>(() => {
    const jobsByCode = new Map<string, JobEntry[]>();
    for (const j of jobs) {
      const k = (j.sid || '').trim().toLowerCase();
      if (!k) continue;
      const list = jobsByCode.get(k);
      if (list) list.push(j);
      else jobsByCode.set(k, [j]);
    }

    return students.map((student) => {
      const codeKey = (student.code || '').trim().toLowerCase();
      const stuJobs = jobsByCode.get(codeKey) || [];
      const balSummary = computeStudentJobBalanceSummary({
        studentCode: student.code,
        studentName: student.name,
        deposit: student.deposit,
        jobs: stuJobs,
        returns,
      });
      const totalJobsSpent = balSummary.netJobsCost;
      const jobDue = stuJobs.reduce((acc, j) => {
        const jNo = (j.no || '').trim().toLowerCase();
        if (jNo && balSummary.returnedJobNos.has(jNo)) return acc;
        const meta = parseDueJobNote(j.note, j.pay, j.paid);
        return acc + (meta.isDueEntry ? meta.dueAmount : 0);
      }, 0);
      const contract = Number(student.contract || 0);
      const deposit = Number(student.deposit || 0);
      const courseDue = Math.max(0, contract - deposit);
      const dueApproval = getStudentDueDateApproval(auditLogs, student.code);

      return {
        student,
        contract,
        deposit,
        courseDue,
        jobDue,
        totalJobsSpent,
        jobsCount: stuJobs.length,
        duePromiseDate: dueApproval.dueDate,
        dueSupervisor: dueApproval.approvedBySupervisor,
        isGraceActive: dueApproval.isGracePeriodActive,
      };
    });
  }, [students, jobs, returns, auditLogs]);

  const kpiSummary = useMemo(() => {
    let dueStudentCount = 0;
    let totalContract = 0;
    let totalDeposited = 0;
    let totalCourseDue = 0;
    let totalJobDue = 0;

    for (const r of computedRows) {
      totalContract += r.contract;
      totalDeposited += r.deposit;
      totalCourseDue += r.courseDue;
      totalJobDue += r.jobDue;
      if (r.courseDue > 0 || r.jobDue > 0) dueStudentCount += 1;
    }

    return {
      dueStudentCount,
      totalContract,
      totalDeposited,
      totalCourseDue,
      totalJobDue,
    };
  }, [computedRows]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = computedRows.filter((r) => {
      if (filterMode === 'due' && r.courseDue <= 0 && r.jobDue <= 0) return false;
      if (filterMode === 'settled' && (r.courseDue > 0 || r.jobDue > 0)) return false;
      if (filterMode === 'jobDue' && r.jobDue <= 0) return false;

      if (!q) return true;
      const s = r.student;
      return (
        s.code.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        (s.phone || '').toLowerCase().includes(q) ||
        (s.trade || '').toLowerCase().includes(q) ||
        (s.interviewPassedCompany || '').toLowerCase().includes(q) ||
        (s.companyName || '').toLowerCase().includes(q)
      );
    });

    list.sort((a, b) => {
      if (sortBy === 'dueDesc') {
        return b.courseDue + b.jobDue - (a.courseDue + a.jobDue);
      }
      if (sortBy === 'dueAsc') {
        return a.courseDue + a.jobDue - (b.courseDue + b.jobDue);
      }
      if (sortBy === 'code') {
        return a.student.code.localeCompare(b.student.code, undefined, { numeric: true });
      }
      return a.student.name.localeCompare(b.student.name);
    });

    return list;
  }, [computedRows, filterMode, search, sortBy]);

  const handleKhataLookup = (e: FormEvent) => {
    e.preventDefault();
    const q = khataInput.trim().toLowerCase();
    if (!q) return;
    setKhataError(null);

    const exact = students.find((s) => s.code.trim().toLowerCase() === q);
    if (exact) {
      setKhataInput('');
      onOpenProfile(exact.code);
      return;
    }

    const partial = students.filter(
      (s) => s.code.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
    );
    if (partial.length === 1) {
      setKhataInput('');
      onOpenProfile(partial[0].code);
      return;
    }
    if (partial.length > 1) {
      setSearch(khataInput.trim());
      setFilterMode('all');
      setKhataError(
        bn
          ? `"${khataInput.trim()}" দিয়ে ${partial.length} জন মিলেছে — নিচের তালিকা থেকে নির্বাচন করুন।`
          : `Found ${partial.length} matches for "${khataInput.trim()}" — select from the table below.`
      );
      return;
    }

    setKhataError(
      bn
        ? `খাতা নং "${khataInput.trim()}" দিয়ে কোনো ছাত্র পাওয়া যায়নি।`
        : `No student found for Book / Code "${khataInput.trim()}".`
    );
  };

  const openPaymentModal = (row: ComputedDueRow) => {
    setActiveRow(row);
    setModalTab('installment');
    setPayAmount(row.courseDue > 0 ? String(row.courseDue) : '');
    setPayMethod('Cash');
    setPayPurpose('Course Fee Installment');
    setRecordCashbook(true);
    setEditContract(String(row.contract));
    setEditDeposit(String(row.deposit));
  };

  const handleSubmitPayment = async (e: FormEvent) => {
    e.preventDefault();
    if (!activeRow || saving) return;
    const stu = activeRow.student;
    setSaving(true);
    setNotice(null);

    try {
      if (modalTab === 'installment') {
        const amt = Number(payAmount) || 0;
        if (amt <= 0) {
          setSaving(false);
          return;
        }
        const today = todayDDMMYYYY();
        const receiptNo = `RCP-${today.replace(/-/g, '')}-${String(cash.length + 1).padStart(3, '0')}`;
        const purposeText = payPurpose.trim() || 'Course Fee Installment';
        const nextDeposit = Number(stu.deposit || 0) + amt;

        await onUpdate('students', stu.id, { deposit: nextDeposit });
        if (recordCashbook) {
          await onAdd('cash', {
            date: today,
            type: 'in',
            category: 'Course Deposit',
            amt,
            note: `Course Fee: ${stu.name} (${stu.code}) | Ref: ${receiptNo} | Method: ${payMethod} | Purpose: ${purposeText}`,
          });
        }
        await onLogAudit?.(
          'COLLECT_COURSE_DEPOSIT',
          'Due List',
          `${receiptNo} · ${stu.name} (${stu.code}) · ${formatTaka(amt)} · New Due: ${formatTaka(
            Math.max(0, Number(stu.contract || 0) - nextDeposit)
          )}`
        );
        setNotice({
          type: 'success',
          text: bn
            ? `${stu.name} (${stu.code})-এর ${formatTaka(amt)} জমা সফলভাবে আপডেট হয়েছে।`
            : `Updated ${formatTaka(amt)} payment for ${stu.name} (${stu.code}).`,
        });
      } else {
        const nextContract = Math.max(0, Number(editContract) || 0);
        const nextDeposit = Math.max(0, Number(editDeposit) || 0);
        await onUpdate('students', stu.id, {
          contract: nextContract,
          deposit: nextDeposit,
        });
        await onLogAudit?.(
          'ADJUST_STUDENT_DUE',
          'Due List',
          `${stu.name} (${stu.code}) · Contract: ${formatTaka(nextContract)}, Deposit: ${formatTaka(
            nextDeposit
          )}, Due: ${formatTaka(Math.max(0, nextContract - nextDeposit))}`
        );
        setNotice({
          type: 'success',
          text: bn
            ? `${stu.name} (${stu.code})-এর চুক্তি ও জমার হিসাব আপডেট হয়েছে।`
            : `Adjusted contract & deposit figures for ${stu.name} (${stu.code}).`,
        });
      }
      setActiveRow(null);
    } catch (err) {
      setNotice({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : bn
              ? 'পেমেন্ট আপডেট করতে সমস্যা হয়েছে।'
              : 'Failed to update payment.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleExportCsv = () => {
    const csv = toCsv(
      [
        'Khata / Code',
        'Student Name',
        'Mobile',
        'Trade',
        'Interview Passed Company',
        'Contract Value',
        'Total Deposited',
        'Remaining Course Due',
        'Job Due',
        'Due Promise Date',
      ],
      filteredRows.map((r) => [
        r.student.code,
        r.student.name,
        r.student.phone || '',
        r.student.trade || '',
        r.student.interviewPassedCompany || '',
        r.contract,
        r.deposit,
        r.courseDue,
        r.jobDue,
        r.duePromiseDate || '',
      ])
    );
    downloadFile(`ittc-due-list-${todayDDMMYYYY()}.csv`, csv, 'text/csv;charset=utf-8');
  };

  const handlePrintDueList = () => {
    onPrintReport?.({
      title: bn ? 'ছাত্র বকেয়া / ডিউ তালিকা (Due List)' : 'Student Course & Job Due List',
      subtitle: `${bn ? 'তারিখ' : 'Date'}: ${todayDDMMYYYY()} · ${filteredRows.length} ${
        bn ? 'জন ছাত্র' : 'students'
      }`,
      filename: `ittc-due-list-${todayDDMMYYYY()}`,
      summary: [
        { label: bn ? 'মোট চুক্তি' : 'Total Contract', value: formatTaka(kpiSummary.totalContract) },
        { label: bn ? 'মোট জমা' : 'Total Paid', value: formatTaka(kpiSummary.totalDeposited) },
        { label: bn ? 'বাকি কোর্স ডিউ' : 'Course Due', value: formatTaka(kpiSummary.totalCourseDue) },
        { label: bn ? 'জব বকেয়া' : 'Job Due', value: formatTaka(kpiSummary.totalJobDue) },
      ],
      columns: ['Khata / Code', 'Trainee Name', 'Mobile', 'Contract', 'Deposited', 'Course Due', 'Job Due'],
      rows: filteredRows.map((r) => [
        r.student.code,
        r.student.name,
        r.student.phone || '—',
        formatTaka(r.contract),
        formatTaka(r.deposit),
        formatTaka(r.courseDue),
        formatTaka(r.jobDue),
      ]),
    });
  };

  return (
    <div className="space-y-4 lg:space-y-0 lg:flex-1 lg:min-h-0 lg:flex lg:flex-col lg:gap-4">
      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 shrink-0">
        <div className="mg-bento-in mg-spring-card mg-spotlight bg-amber-50/70 dark:bg-amber-950/25 rounded-xl p-4 border border-amber-200 dark:border-amber-900/60">
          <div className="text-[11px] font-bold text-amber-800 dark:text-amber-300 uppercase">
            {bn ? 'ডিউ থাকা ছাত্র' : 'DUE STUDENTS'}
          </div>
          <div className="font-mono-num text-2xl font-extrabold text-slate-900 dark:text-white mt-1">
            <KineticCounter target={kpiSummary.dueStudentCount} />
          </div>
          <div className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5">
            {bn ? `মোট ${students.length} জনের মধ্যে` : `Out of ${students.length} students`}
          </div>
        </div>

        <div className="mg-bento-in mg-spring-card mg-spotlight bg-white dark:bg-[#0c1320] rounded-xl p-4 border border-slate-200 dark:border-slate-400/20">
          <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase">
            {bn ? 'মোট চুক্তি ভ্যালু' : 'TOTAL CONTRACT'}
          </div>
          <div className="font-mono-num text-xl font-extrabold text-slate-900 dark:text-white mt-1">
            <KineticCounter target={kpiSummary.totalContract} prefix="৳" />
          </div>
        </div>

        <div className="mg-bento-in mg-spring-card mg-spotlight bg-emerald-50/60 dark:bg-emerald-950/25 rounded-xl p-4 border border-emerald-200 dark:border-emerald-900/60">
          <div className="text-[11px] font-bold text-emerald-800 dark:text-emerald-300 uppercase">
            {bn ? 'মোট জমা দেওয়া টাকা' : 'TOTAL DEPOSITED'}
          </div>
          <div className="font-mono-num text-xl font-extrabold text-emerald-700 dark:text-emerald-300 mt-1">
            <KineticCounter target={kpiSummary.totalDeposited} prefix="৳" />
          </div>
        </div>

        <div className="mg-bento-in mg-spring-card mg-spotlight bg-rose-50/70 dark:bg-rose-950/25 rounded-xl p-4 border border-rose-200 dark:border-rose-900/60">
          <div className="text-[11px] font-bold text-rose-800 dark:text-rose-300 uppercase">
            {bn ? 'বাকি কোর্স ডিউ' : 'REMAINING COURSE DUE'}
          </div>
          <div className="font-mono-num text-xl font-extrabold text-rose-700 dark:text-rose-300 mt-1">
            <KineticCounter target={kpiSummary.totalCourseDue} prefix="৳" />
          </div>
        </div>

        <div className="mg-bento-in mg-spring-card mg-spotlight bg-indigo-50/60 dark:bg-indigo-950/25 rounded-xl p-4 border border-indigo-200 dark:border-indigo-900/60 col-span-2 lg:col-span-1">
          <div className="text-[11px] font-bold text-indigo-800 dark:text-indigo-300 uppercase">
            {bn ? 'মোট জব বকেয়া' : 'JOB TOKEN DUE'}
          </div>
          <div className="font-mono-num text-xl font-extrabold text-indigo-700 dark:text-indigo-300 mt-1">
            <KineticCounter target={kpiSummary.totalJobDue} prefix="৳" />
          </div>
        </div>
      </div>

      {/* Stationary Toolbar & Khata Quick Lookup */}
      <div className="shrink-0 bg-white/95 dark:bg-[#0c1320]/95 backdrop-blur-md rounded-xl border border-slate-200 dark:border-slate-400/20 shadow-sm p-3.5 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-1 flex-wrap items-center gap-2 min-w-[260px]">
            <div className="relative flex-1 min-w-[210px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={
                  bn
                    ? 'খাতা নং/কোড, নাম, মোবাইল বা কোম্পানি দিয়ে খুঁজুন...'
                    : 'Search Book/Code, Name, Mobile, Company...'
                }
                className="w-full pl-9 pr-3 py-2 text-xs sm:text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>

            <form onSubmit={handleKhataLookup} className="flex items-center gap-1.5">
              <input
                list="due-khata-codes"
                value={khataInput}
                onChange={(e) => {
                  setKhataInput(e.target.value);
                  setKhataError(null);
                }}
                placeholder={bn ? 'খাতা নং দিয়ে প্রোফাইল...' : 'Open Khata / Code...'}
                className="w-40 sm:w-44 px-3 py-2 text-xs rounded-lg border border-teal-300 dark:border-teal-700 bg-teal-50/40 dark:bg-teal-950/30 font-mono-num text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
              <datalist id="due-khata-codes">
                {students.map((s) => (
                  <option key={s.id} value={s.code}>
                    {s.name}
                  </option>
                ))}
              </datalist>
              <button
                type="submit"
                className="px-3 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
              >
                {bn ? 'প্রোফাইল' : 'Open'}
              </button>
            </form>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as DueSort)}
              className="px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200"
            >
              <option value="dueDesc">{bn ? 'সর্বোচ্চ ডিউ আগে' : 'Highest Due First'}</option>
              <option value="dueAsc">{bn ? 'সর্বনিম্ন ডিউ আগে' : 'Lowest Due First'}</option>
              <option value="code">{bn ? 'খাতা / কোড অনুযায়ী' : 'Sort by Khata / Code'}</option>
              <option value="name">{bn ? 'নাম অনুযায়ী' : 'Sort by Name'}</option>
            </select>

            <button
              type="button"
              onClick={handlePrintDueList}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>{bn ? 'প্রিন্ট' : 'Print'}</span>
            </button>

            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>{bn ? 'এক্সেল (.csv)' : 'Excel (.csv)'}</span>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                ['due', bn ? 'ডিউ আছে (Due Only)' : 'Due Only'],
                ['all', bn ? 'সকল ছাত্র (All)' : 'All Students'],
                ['settled', bn ? 'পরিশোধিত (Settled)' : 'Settled'],
                ['jobDue', bn ? 'জব বকেয়া (Job Due)' : 'Has Job Due'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilterMode(key)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold border cursor-pointer transition-colors ${
                  filterMode === key
                    ? 'bg-teal-600 border-teal-600 text-white'
                    : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-teal-400'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="text-xs font-mono-num text-slate-500 dark:text-slate-400">
            {bn ? `প্রদর্শিত: ${filteredRows.length} জন` : `Showing ${filteredRows.length} students`}
          </div>
        </div>

        {khataError && (
          <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{khataError}</span>
          </div>
        )}

        {notice && (
          <div
            className={`rounded-lg border px-3 py-2 text-xs font-semibold flex items-center justify-between ${
              notice.type === 'success'
                ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                : 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300'
            }`}
          >
            <span>{notice.text}</span>
            <button type="button" onClick={() => setNotice(null)} className="cursor-pointer font-bold">
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Main Due Table */}
      <div className="bg-white dark:bg-[#0c1320] rounded-xl border border-slate-200 dark:border-slate-400/20 overflow-hidden lg:flex-1 lg:min-h-0 lg:flex lg:flex-col">
        {filteredRows.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500 dark:text-slate-400 flex flex-col items-center gap-2">
            <CircleDollarSign className="w-8 h-8 text-teal-600/60" />
            <span>
              {bn
                ? 'এই ফিল্টারে কোনো বকেয়া/ছাত্রের তথ্য পাওয়া যায়নি।'
                : 'No matching student due records found.'}
            </span>
          </div>
        ) : (
          <div className="overflow-auto lg:flex-1 lg:min-h-0">
            <table className="w-full text-left border-collapse text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-slate-200 dark:border-slate-700/80 bg-slate-50 dark:bg-[#111b2e] text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase">
                  <th className="py-2.5 px-3">{bn ? 'খাতা / কোড' : 'KHATA / CODE'}</th>
                  <th className="py-2.5 px-3">{bn ? 'ছাত্রের নাম ও তথ্য' : 'STUDENT NAME & TRADE'}</th>
                  <th className="py-2.5 px-3">{bn ? 'মোবাইল' : 'MOBILE'}</th>
                  <th className="py-2.5 px-3 text-right">{bn ? 'মোট চুক্তি' : 'CONTRACT'}</th>
                  <th className="py-2.5 px-3 text-right">{bn ? 'জমা দেওয়া' : 'DEPOSITED'}</th>
                  <th className="py-2.5 px-3 text-right">{bn ? 'বাকি ডিউ' : 'COURSE DUE'}</th>
                  <th className="py-2.5 px-3 text-right">{bn ? 'জব বকেয়া' : 'JOB DUE'}</th>
                  <th className="py-2.5 px-3 text-right">{bn ? 'অ্যাকশন' : 'ACTIONS'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {filteredRows.map((row) => {
                  const s = row.student;
                  const waDigits = (s.phone || '').replace(/[^0-9]/g, '');
                  return (
                    <tr key={s.id} className="mg-row-scan">
                      <td className="py-3 px-3 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onOpenProfile(s.code)}
                          className="font-mono-num text-xs font-bold text-teal-700 dark:text-teal-400 hover:underline cursor-pointer"
                        >
                          {s.code}
                        </button>
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white">
                          {s.name}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                          <span>{s.trade || 'Welder Trainee'}</span>
                          {s.interviewPassedCompany && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 text-[10px] font-semibold">
                              <Award className="w-2.5 h-2.5" />
                              <span>{s.interviewPassedCompany}</span>
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <div className="inline-flex items-center gap-1 font-mono-num text-xs text-slate-700 dark:text-slate-300">
                          <span>{s.phone || '—'}</span>
                          {s.phone && (
                            <>
                              <a
                                href={`tel:${s.phone}`}
                                aria-label="Call student"
                                className="p-1 rounded text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/50"
                              >
                                <Phone className="w-3 h-3" />
                              </a>
                              <a
                                href={`https://wa.me/${waDigits.startsWith('0') ? `88${waDigits}` : waDigits}`}
                                target="_blank"
                                rel="noreferrer"
                                aria-label="WhatsApp student"
                                className="p-1 rounded text-teal-600 hover:bg-teal-50 dark:hover:bg-teal-950/50"
                              >
                                <MessageCircle className="w-3 h-3" />
                              </a>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-3 font-mono-num text-xs text-right font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                        {formatTaka(row.contract)}
                      </td>
                      <td className="py-3 px-3 font-mono-num text-xs text-right font-bold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                        {formatTaka(row.deposit)}
                      </td>
                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        {row.courseDue > 0 ? (
                          <span className="inline-block px-2 py-0.5 rounded bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 font-mono-num text-xs font-extrabold text-rose-700 dark:text-rose-300">
                            {formatTaka(row.courseDue)}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 text-[11px] font-semibold">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>{bn ? 'পরিশোধিত' : 'Paid'}</span>
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        {row.jobDue > 0 ? (
                          <div className="inline-flex flex-col items-end">
                            <span className="px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 font-mono-num text-xs font-bold text-amber-700 dark:text-amber-300">
                              {formatTaka(row.jobDue)}
                            </span>
                            {row.duePromiseDate && (
                              <span className="text-[10px] font-mono-num text-slate-500 mt-0.5">
                                {row.duePromiseDate}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400 font-mono-num">৳0</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openPaymentModal(row)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold cursor-pointer"
                          >
                            <Wallet className="w-3 h-3" />
                            <span>{bn ? 'পেমেন্ট আপডেট' : 'Update Pay'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => onOpenProfile(s.code)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
                          >
                            <User className="w-3 h-3" />
                            <span>{bn ? 'প্রোফাইল' : 'Profile'}</span>
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

      {/* Payment Update / Contract-Deposit Adjust Modal */}
      {activeRow && (
        <div
          className="fixed inset-0 z-[60] bg-slate-950/60 backdrop-blur-[1px] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleSubmitPayment}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                  {bn ? 'ডিউ ও পেমেন্ট আপডেট' : 'Update Student Due & Payment'}
                </h3>
                <p className="text-xs text-slate-500">
                  {activeRow.student.name} ({activeRow.student.code})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveRow(null)}
                className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl">
              <div>
                <div className="text-[10px] text-slate-500">{bn ? 'চুক্তি' : 'Contract'}</div>
                <div className="font-mono-num font-bold text-slate-900 dark:text-white">
                  {formatTaka(activeRow.contract)}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500">{bn ? 'জমা' : 'Deposited'}</div>
                <div className="font-mono-num font-bold text-emerald-600 dark:text-emerald-400">
                  {formatTaka(activeRow.deposit)}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500">{bn ? 'বাকি ডিউ' : 'Course Due'}</div>
                <div className="font-mono-num font-bold text-rose-600 dark:text-rose-400">
                  {formatTaka(activeRow.courseDue)}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setModalTab('installment')}
                className={`py-2 px-3 rounded-lg border text-xs font-bold cursor-pointer ${
                  modalTab === 'installment'
                    ? 'bg-teal-600 border-teal-600 text-white'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                }`}
              >
                {bn ? '+ নতুন কিস্তি জমা' : '+ Collect Deposit'}
              </button>
              <button
                type="button"
                onClick={() => setModalTab('adjust')}
                className={`py-2 px-3 rounded-lg border text-xs font-bold cursor-pointer ${
                  modalTab === 'adjust'
                    ? 'bg-indigo-600 border-indigo-600 text-white'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                }`}
              >
                {bn ? 'চুক্তি / জমা সংশোধন' : 'Edit Contract / Paid'}
              </button>
            </div>

            {modalTab === 'installment' ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                      {bn ? 'জমার পরিমাণ ৳ *' : 'Amount ৳ *'}
                    </label>
                    <input
                      type="number"
                      required
                      min={1}
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono-num"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                      {bn ? 'মাধ্যম' : 'Method'}
                    </label>
                    <select
                      value={payMethod}
                      onChange={(e) => setPayMethod(e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                    >
                      <option value="Cash">Cash</option>
                      <option value="bKash">bKash</option>
                      <option value="Nagad">Nagad</option>
                      <option value="Bank">Bank</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    {bn ? 'উদ্দেশ্য / নোট' : 'Purpose / Note'}
                  </label>
                  <input
                    value={payPurpose}
                    onChange={(e) => setPayPurpose(e.target.value)}
                    placeholder="Course Fee Installment"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                  />
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={recordCashbook}
                    onChange={(e) => setRecordCashbook(e.target.checked)}
                    className="rounded border-slate-300 text-teal-600"
                  />
                  <span>
                    {bn ? 'ক্যাশবুকে স্বয়ংক্রিয়ভাবে যোগ করুন' : 'Also record in Accounts & Cashbook'}
                  </span>
                </label>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                      {bn ? 'মোট চুক্তি (Contract ৳)' : 'Contract Amount (৳)'}
                    </label>
                    <input
                      type="number"
                      min={0}
                      required
                      value={editContract}
                      onChange={(e) => setEditContract(e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono-num"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                      {bn ? 'মোট জমা (Deposit ৳)' : 'Total Deposited (৳)'}
                    </label>
                    <input
                      type="number"
                      min={0}
                      required
                      value={editDeposit}
                      onChange={(e) => setEditDeposit(e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono-num"
                    />
                  </div>
                </div>
                <div className="rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs flex justify-between font-semibold">
                  <span>{bn ? 'সংশোধিত ডিউ:' : 'Updated Remaining Due:'}</span>
                  <span className="font-mono-num text-rose-700 dark:text-rose-300">
                    {formatTaka(Math.max(0, (Number(editContract) || 0) - (Number(editDeposit) || 0)))}
                  </span>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setActiveRow(null)}
                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold cursor-pointer"
              >
                {bn ? 'বাতিল' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer"
              >
                {saving
                  ? bn
                    ? 'সংরক্ষণ হচ্ছে...'
                    : 'Saving...'
                  : bn
                    ? 'আপডেট নিশ্চিত করুন'
                    : 'Confirm Update'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
