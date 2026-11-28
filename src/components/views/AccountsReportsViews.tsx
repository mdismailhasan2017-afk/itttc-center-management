import { useMemo, useState, type FormEvent } from 'react';
import {
  Award,
  DollarSign,
  Download,
  Eye,
  EyeOff,
  Lock,
  Plus,
  Printer,
  Search,
  Trash2,
  Unlock,
} from 'lucide-react';
import type { CenterDataState, SubCollectionKey } from '../../lib/store';
import { downloadFile, formatTaka, toCsv, todayDDMMYYYY } from '../../lib/format';
import { KineticCounter } from '../../lib/motion';
import type { PrintableReportSpec } from '../../lib/print';
import type { CashEntry, Lang } from '../../types';

// 1. Accounts & Daily Cashbook (with Accounts Security Lock)
export function CashbookView({
  cash,
  accountsPass,
  lang,
  onAdd,
  onDelete,
  onExit,
  onLogAudit,
  onPrintReport,
}: {
  cash: CashEntry[];
  accountsPass: string;
  lang: Lang;
  onAdd: (key: SubCollectionKey, raw: Record<string, unknown>) => Promise<string>;
  onDelete: (key: SubCollectionKey, id: string) => Promise<void>;
  onExit: () => void;
  onLogAudit?: (action: string, module: string, detail: string) => Promise<void>;
  onPrintReport?: (spec: PrintableReportSpec) => void;
}) {
  const bn = lang === 'bn';
  const [unlocked, setUnlocked] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [lockError, setLockError] = useState('');

  const [type, setType] = useState<'in' | 'out'>('in');
  const [category, setCategory] = useState('Job Fee');
  const [amt, setAmt] = useState('');
  const [note, setNote] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'in' | 'out'>('all');
  const [search, setSearch] = useState('');

  const expectedPass = accountsPass || 'admin';

  const handleUnlock = async (e: FormEvent) => {
    e.preventDefault();
    if (passwordInput === expectedPass) {
      setUnlocked(true);
      setLockError('');
      setPasswordInput('');
      await onLogAudit?.('UNLOCK_ACCOUNTS', 'Accounts & Cashbook', 'Cashbook database unlocked');
    } else {
      setLockError(bn ? 'ভুল পাসওয়ার্ড! আবার চেষ্টা করুন।' : 'Incorrect password. Please try again.');
    }
  };

  const totalIn = cash.filter((c) => c.type === 'in').reduce((a, b) => a + Number(b.amt || 0), 0);
  const totalOut = cash.filter((c) => c.type === 'out').reduce((a, b) => a + Number(b.amt || 0), 0);
  const balance = totalIn - totalOut;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!amt || !note.trim()) return;
    const numAmt = Number(amt) || 0;
    await onAdd('cash', {
      date: todayDDMMYYYY(),
      type,
      category: category.trim() || (type === 'in' ? 'Income' : 'Expense'),
      amt: numAmt,
      note: note.trim(),
    });
    await onLogAudit?.(
      type === 'in' ? 'CASH_IN' : 'CASH_OUT',
      'Accounts & Cashbook',
      `${type.toUpperCase()} ${formatTaka(numAmt)} — ${note.trim()}`
    );
    setAmt('');
    setNote('');
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...cash].reverse().filter((c) => {
      if (filterType !== 'all' && c.type !== filterType) return false;
      if (!q) return true;
      return (
        c.note.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q) ||
        c.date.toLowerCase().includes(q)
      );
    });
  }, [cash, filterType, search]);

  const handleExport = () => {
    const csv = toCsv(
      ['Date', 'Type', 'Category', 'Amount', 'Note'],
      filtered.map((c) => [c.date, c.type.toUpperCase(), c.category, c.amt, c.note])
    );
    downloadFile(`ittc-cashbook-${todayDDMMYYYY()}.csv`, csv, 'text/csv;charset=utf-8');
  };

  if (!unlocked) {
    return (
      <div className="min-h-[65vh] flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-7 shadow-lg text-center space-y-5">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-teal-600 text-white flex items-center justify-center shadow-xs">
            <Lock className="w-7 h-7" />
          </div>

          <div className="space-y-1.5">
            <span className="inline-block px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-[11px] font-semibold text-teal-700 dark:text-teal-300">
              {bn ? 'সুরক্ষিত ক্যাশবুক ডাটাবেস (Secured Cashbook)' : 'Secured Cashbook Database'}
            </span>
            <h2 className="font-display text-xl font-extrabold text-slate-900 dark:text-white pt-1">
              {bn ? 'একাউন্টস সিকিউরিটি লক' : 'Accounts Security Lock'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {bn
                ? 'আর্থিক লেনদেন ও ক্যাশবুকের হিসাবের সুরক্ষার জন্য অনুমোদিত পাসওয়ার্ড প্রদান করুন'
                : 'Enter the authorized Accounts password to view daily cashbook & expense records.'}
            </p>
          </div>

          <form onSubmit={handleUnlock} className="space-y-3 text-left">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                {bn ? 'পাসওয়ার্ড দিন (Enter Accounts Password)' : 'Enter Accounts Password'}
              </label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  required
                  value={passwordInput}
                  onChange={(e) => {
                    setPasswordInput(e.target.value);
                    setLockError('');
                  }}
                  placeholder="Enter password..."
                  className="w-full pl-3.5 pr-10 py-2.5 text-sm rounded-lg border-2 border-teal-500/80 dark:border-teal-600 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:border-teal-600"
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
              {lockError && (
                <p className="text-xs text-red-600 dark:text-red-400 mt-1.5">{lockError}</p>
              )}
            </div>

            <button
              type="submit"
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold cursor-pointer"
            >
              <Unlock className="w-4 h-4" />
              <span>
                {bn ? 'লগইন করুন (Unlock Cashbook)' : 'Unlock Cashbook'}
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
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Top Bar with Lock button */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
            {bn ? 'দৈনিক ক্যাশবুক ও আয়-ব্যয় লেজার' : 'Daily Cashbook & Accounts Ledger'}
          </h2>
          <p className="text-xs text-slate-500">
            {bn
              ? 'ক্যাশ জমা, খরচের ভাউচার এবং নিট ক্যাশ ব্যালেন্স ট্র্যাকিং'
              : 'Cash collection, expense vouchers, and net balance tracking'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setUnlocked(false)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 text-xs font-semibold cursor-pointer"
        >
          <Lock className="w-3.5 h-3.5 text-teal-600" />
          <span>{bn ? 'ক্যাশবুক লক করুন' : 'Lock Cashbook'}</span>
        </button>
      </div>

      {/* 3 KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <div
          style={{ animationDelay: '0.04s' }}
          className="mg-bento-in mg-spring-card mg-spotlight rounded-xl p-4 border border-emerald-200 dark:border-emerald-900/60"
        >
          <div className="relative z-10 text-xs text-slate-500 dark:text-slate-400">
            {bn ? 'মোট জমা (Income)' : 'Total Cash In'}
          </div>
          <div className="relative z-10 font-mono-num text-2xl font-extrabold text-emerald-600 dark:text-emerald-400 mt-1">
            <KineticCounter target={totalIn} prefix="৳" />
          </div>
        </div>
        <div
          style={{ animationDelay: '0.08s' }}
          className="mg-bento-in mg-spring-card mg-spotlight rounded-xl p-4 border border-red-200 dark:border-red-900/60"
        >
          <div className="relative z-10 text-xs text-slate-500 dark:text-slate-400">
            {bn ? 'মোট খরচ (Expense)' : 'Total Cash Out'}
          </div>
          <div className="relative z-10 font-mono-num text-2xl font-extrabold text-red-600 dark:text-red-400 mt-1">
            <KineticCounter target={totalOut} prefix="৳" />
          </div>
        </div>
        <div
          style={{ animationDelay: '0.12s' }}
          className="mg-bento-in mg-spring-card mg-spotlight rounded-xl p-4"
        >
          <div className="relative z-10 text-xs text-slate-500 dark:text-slate-400">
            {bn ? 'নিট ক্যাশ ব্যালান্স' : 'Net Cash Balance'}
          </div>
          <div className="relative z-10 font-mono-num text-2xl font-extrabold text-slate-900 dark:text-white mt-1">
            {balance < 0 ? '-' : ''}
            <KineticCounter target={Math.abs(balance)} prefix="৳" />
          </div>
        </div>
      </div>

      {/* Add Entry Form */}
      <form
        onSubmit={handleSubmit}
        className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end"
      >
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
            {bn ? 'ধরন' : 'Type'}
          </label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as 'in' | 'out')}
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
          >
            <option value="in">{bn ? 'জমা / Income' : 'Income (In)'}</option>
            <option value="out">{bn ? 'খরচ / Expense' : 'Expense (Out)'}</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
            {bn ? 'খাত' : 'Category'}
          </label>
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Job Fee / Utility / Store"
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
            {bn ? 'পরিমাণ ৳ *' : 'Amount ৳ *'}
          </label>
          <input
            type="number"
            required
            min={1}
            value={amt}
            onChange={(e) => setAmt(e.target.value)}
            placeholder="1000"
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono-num"
          />
        </div>
        <div className="lg:col-span-2">
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
            {bn ? 'বিবরণ *' : 'Description *'}
          </label>
          <input
            required
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={bn ? 'লেনদেনের বিবরণ লিখুন' : 'Transaction note'}
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
          />
        </div>
        <button
          type="submit"
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold h-[38px] cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>{bn ? 'এন্ট্রি যোগ' : 'Record'}</span>
        </button>
      </form>

      {/* Filter & Export Bar */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-1 flex-wrap items-center gap-2.5">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={bn ? 'বিবরণ বা খাত খুঁজুন...' : 'Search note or category...'}
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
            />
          </div>
          <div className="inline-flex p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            {(
              [
                ['all', bn ? 'সব' : 'All'],
                ['in', bn ? 'জমা' : 'In'],
                ['out', bn ? 'খরচ' : 'Out'],
              ] as const
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => setFilterType(val)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md cursor-pointer ${
                  filterType === val
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => {
              onPrintReport?.({
                title: bn ? 'অ্যাকাউন্টস ও ক্যাশবুক লেজার' : 'Accounts & Cashbook Ledger',
                subtitle: `${bn ? 'তারিখ' : 'Date'}: ${todayDDMMYYYY()} · ${filtered.length} ${bn ? 'টি লেনদেন' : 'entries'}`,
                filename: `ittc-cashbook-${todayDDMMYYYY()}`,
                summary: [
                  { label: bn ? 'মোট জমা (IN)' : 'Total IN', value: formatTaka(totalIn) },
                  { label: bn ? 'মোট খরচ (OUT)' : 'Total OUT', value: formatTaka(totalOut) },
                  { label: bn ? 'নিট ব্যালেন্স' : 'Net Balance', value: formatTaka(balance) },
                ],
                columns: ['Date', 'Type', 'Category', 'Description', 'Amount'],
                rows: filtered.map((c) => [
                  c.date,
                  c.type === 'in' ? 'IN' : 'OUT',
                  c.category || '—',
                  c.note,
                  `${c.type === 'in' ? '+' : '-'}${formatTaka(c.amt)}`,
                ]),
              });
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>{bn ? 'প্রিন্ট' : 'Print'}</span>
          </button>
          <button
            type="button"
            onClick={handleExport}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>CSV</span>
          </button>
        </div>
      </div>

      {/* Cashbook Table */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
            {bn ? 'কোনো ক্যাশবুক লেনদেন পাওয়া যায়নি।' : 'No cashbook entries found.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 px-4">{bn ? 'তারিখ' : 'DATE'}</th>
                  <th className="py-2.5 px-4">{bn ? 'ধরন' : 'TYPE'}</th>
                  <th className="py-2.5 px-4">{bn ? 'খাত' : 'CATEGORY'}</th>
                  <th className="py-2.5 px-4">{bn ? 'বিবরণ' : 'DESCRIPTION'}</th>
                  <th className="py-2.5 px-4 text-right">{bn ? 'পরিমাণ' : 'AMOUNT'}</th>
                  <th className="py-2.5 px-4 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {filtered.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-2.5 px-4 font-mono-num text-xs">{c.date}</td>
                    <td className="py-2.5 px-4 text-xs font-semibold">
                      <span
                        className={
                          c.type === 'in'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-red-600 dark:text-red-400'
                        }
                      >
                        {c.type === 'in' ? (bn ? 'জমা' : 'IN') : bn ? 'খরচ' : 'OUT'}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-xs text-slate-600 dark:text-slate-300">
                      {c.category || '—'}
                    </td>
                    <td className="py-2.5 px-4 text-xs text-slate-900 dark:text-white">{c.note}</td>
                    <td
                      className={`py-2.5 px-4 font-mono-num text-xs text-right font-bold ${
                        c.type === 'in'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-red-600 dark:text-red-400'
                      }`}
                    >
                      {c.type === 'in' ? '+' : '-'}
                      {formatTaka(c.amt)}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => onDelete('cash', c.id)}
                        aria-label="Delete cash entry"
                        className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-red-600 dark:text-red-400 hover:bg-red-50 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
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
  );
}

// 2. Analytics & Category Reports (matching Screenshot 140625)
export function ReportsView({
  data,
  lang,
  onPrintReport,
  onOpenMonthlyReport,
}: {
  data: CenterDataState;
  lang: Lang;
  onPrintReport?: (spec: PrintableReportSpec) => void;
  onOpenMonthlyReport?: () => void;
}) {
  const bn = lang === 'bn';

  const byCategory = useMemo(() => {
    const allCats = new Set<string>(data.prices.map((p) => p.cat));
    data.jobs.forEach((j) => j.cat && allCats.add(j.cat));
    data.outs.forEach((o) => o.cat && allCats.add(o.cat));
    return Array.from(allCats).map((cat) => {
      const count =
        data.jobs.filter((j) => j.cat === cat).length +
        data.outs.filter((o) => o.cat === cat).length;
      return { cat, count };
    });
  }, [data.prices, data.jobs, data.outs]);

  const grandTotalJobs = data.jobs.length + data.outs.length;

  const totalStudents = Math.max(1, data.students.length);
  const selectedStudents = data.students.filter((s) =>
    ['Selected', 'Visa Processing', 'Flight Ready'].includes(s.overseasStatus)
  ).length;
  const interviewedStudents = data.students.filter(
    (s) => s.overseasStatus === 'Interview Attended'
  ).length;
  const trainingStudents = data.students.filter(
    (s) => !s.overseasStatus || s.overseasStatus === 'Not Applied'
  ).length;

  const totalContract = data.students.reduce((a, b) => a + Number(b.contract || 0), 0);
  const totalDeposit = data.students.reduce((a, b) => a + Number(b.deposit || 0), 0);
  const totalDue = Math.max(0, totalContract - totalDeposit);

  const exportReport = () => {
    const csv = toCsv(
      ['Category', 'Total Jobs', 'Share %'],
      byCategory.map((b) => [
        b.cat,
        b.count,
        grandTotalJobs > 0 ? `${Math.round((b.count / grandTotalJobs) * 100)}%` : '0%',
      ])
    );
    downloadFile(`ittc-category-report-${todayDDMMYYYY()}.csv`, csv, 'text/csv;charset=utf-8');
  };

  return (
    <div className="space-y-6">
      {/* Top Section: Practical Welding Category Job Counts */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
              {bn
                ? 'প্র্যাকটিক্যাল ওয়েল্ডিং ক্যাটাগরি জব সংখ্যা'
                : 'Practical Welding Category Job Counts'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {bn
                ? 'প্রতিটি ওয়েল্ড পজিশনে সম্পন্ন মোট টেস্ট পিসের সংখ্যা'
                : 'Total volume of completed testing pieces per weld position'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {onOpenMonthlyReport && (
              <button
                type="button"
                onClick={onOpenMonthlyReport}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold cursor-pointer"
              >
                <span>{bn ? 'মাসিক জব ও আয় রিপোর্ট' : 'Monthly Job & Revenue Report'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                onPrintReport?.({
                  title: bn ? 'প্র্যাকটিক্যাল ওয়েল্ডিং ক্যাটাগরি ও আর্থিক রিপোর্ট' : 'Practical Welding Category & Financial Report',
                  subtitle: `${bn ? 'তারিখ' : 'Date'}: ${todayDDMMYYYY()} · ${bn ? 'মোট জব' : 'Total Jobs'}: ${grandTotalJobs}`,
                  filename: `ittc-analytics-report-${todayDDMMYYYY()}`,
                  summary: [
                    { label: bn ? 'মোট জব' : 'Total Jobs', value: String(grandTotalJobs) },
                    { label: bn ? 'চুক্তি মূল্য' : 'Contract Value', value: formatTaka(totalContract) },
                    { label: bn ? 'মোট জমা' : 'Total Deposit', value: formatTaka(totalDeposit) },
                    { label: bn ? 'মোট বকেয়া' : 'Total Due', value: formatTaka(totalDue) },
                  ],
                  columns: ['Category', 'Total Jobs', 'Share %'],
                  rows: byCategory.map((b) => [
                    b.cat,
                    b.count,
                    grandTotalJobs > 0 ? `${Math.round((b.count / grandTotalJobs) * 100)}%` : '0%',
                  ]),
                });
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 text-xs font-semibold cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>{bn ? 'প্রিন্ট / PDF' : 'Print / PDF'}</span>
            </button>
            <button
              type="button"
              onClick={exportReport}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 text-xs font-semibold cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{bn ? 'CSV এক্সপোর্ট' : 'Export CSV'}</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {byCategory.map((b) => {
            const pct = grandTotalJobs > 0 ? Math.round((b.count / grandTotalJobs) * 100) : 0;
            return (
              <div
                key={b.cat}
                className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 flex flex-col justify-between gap-3"
              >
                <div className="text-xs font-medium text-slate-600 dark:text-slate-300 truncate">
                  {b.cat}
                </div>
                <div className="flex items-end justify-between gap-2">
                  <span className="font-mono-num text-2xl font-extrabold text-slate-900 dark:text-white">
                    {b.count}
                  </span>
                  <span className="font-mono-num text-[11px] font-bold px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/60 text-teal-700 dark:text-teal-300 border border-emerald-200/70 dark:border-emerald-800/60">
                    {pct}%
                  </span>
                </div>
              </div>
            );
          })}

          {/* Dark Teal GRAND TOTAL JOBS card */}
          <div className="rounded-xl bg-gradient-to-br from-[#064e45] to-[#043631] text-white p-4 flex flex-col justify-between gap-3 border border-teal-800">
            <div className="text-[11px] font-bold uppercase tracking-wider text-teal-200">
              {bn ? 'সর্বমোট জব সংখ্যা' : 'GRAND TOTAL JOBS'}
            </div>
            <div className="flex items-end justify-between gap-2">
              <span className="font-mono-num text-2xl font-extrabold">{grandTotalJobs}</span>
              <span className="text-[11px] font-semibold text-teal-200">100% Complete</span>
            </div>
          </div>
        </div>
      </section>

      {/* Bottom 2-Column Split: Overseas Placement Status & Center Financial Summary */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: Overseas Placement Status */}
        <div className="lg:col-span-6 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 space-y-5">
          <div className="flex items-start gap-3">
            <span className="p-2 rounded-lg bg-teal-50 dark:bg-teal-950/60 text-teal-600 dark:text-teal-400">
              <Award className="w-4 h-4" />
            </span>
            <div>
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                {bn ? 'বিদেশগামী প্লেসমেন্ট স্ট্যাটাস' : 'Overseas Placement Status'}
              </h3>
              <p className="text-xs text-slate-500">
                {bn
                  ? 'নির্বাচিত বনাম সাক্ষাৎকার দেওয়া প্রার্থীদের পরিসংখ্যান'
                  : 'Selected vs Interviewed candidate statistics'}
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-semibold">
                <span className="text-teal-700 dark:text-teal-400">
                  {bn ? 'বিদেশি চাকরিতে নির্বাচিত' : 'Selected for Foreign Employment'}
                </span>
                <span className="font-mono-num text-slate-900 dark:text-white">
                  {selectedStudents} {bn ? 'জন' : 'Students'}
                </span>
              </div>
              <div className="h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-teal-600 rounded-full"
                  style={{ width: `${Math.round((selectedStudents / totalStudents) * 100)}%` }}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-semibold">
                <span className="text-amber-700 dark:text-amber-400">
                  {bn ? 'ইন্টারভিউ সম্পন্ন / প্রক্রিয়াধীন' : 'Interview Attended / Pending Selection'}
                </span>
                <span className="font-mono-num text-slate-900 dark:text-white">
                  {interviewedStudents} {bn ? 'জন' : 'Students'}
                </span>
              </div>
              <div className="h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-amber-500 rounded-full"
                  style={{ width: `${Math.round((interviewedStudents / totalStudents) * 100)}%` }}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-semibold">
                <span className="text-slate-700 dark:text-slate-300">
                  {bn ? 'প্রশিক্ষণ চলমান / আবেদন বাকি' : 'Training In-Progress / Not Applied'}
                </span>
                <span className="font-mono-num text-slate-900 dark:text-white">
                  {trainingStudents} {bn ? 'জন' : 'Students'}
                </span>
              </div>
              <div className="h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-slate-600 dark:bg-slate-400 rounded-full"
                  style={{ width: `${Math.round((trainingStudents / totalStudents) * 100)}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right: Center Financial Summary */}
        <div className="lg:col-span-6 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
          <div className="flex items-start gap-3">
            <span className="p-2 rounded-lg bg-teal-50 dark:bg-teal-950/60 text-teal-600 dark:text-teal-400">
              <DollarSign className="w-4 h-4" />
            </span>
            <div>
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                {bn ? 'সেন্টার আর্থিক সারসংক্ষেপ' : 'Center Financial Summary'}
              </h3>
              <p className="text-xs text-slate-500">
                {bn
                  ? 'মোট চুক্তির পরিমাণ, প্রাপ্ত জমা ও বকেয়া ব্যালেন্স'
                  : 'Contract volume, deposits, and due balances'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-xl p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
              <div className="text-[11px] font-semibold text-slate-500 uppercase">
                {bn ? 'মোট চুক্তির মূল্য' : 'TOTAL CONTRACT VALUE'}
              </div>
              <div className="font-mono-num text-xl font-extrabold text-slate-900 dark:text-white mt-1.5">
                {formatTaka(totalContract)}
              </div>
            </div>
            <div className="rounded-xl p-4 bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/70">
              <div className="text-[11px] font-semibold text-teal-700 dark:text-teal-400 uppercase">
                {bn ? 'মোট প্রাপ্ত জমা' : 'TOTAL RECEIVED DEPOSIT'}
              </div>
              <div className="font-mono-num text-xl font-extrabold text-teal-700 dark:text-teal-300 mt-1.5">
                {formatTaka(totalDeposit)}
              </div>
            </div>
          </div>

          <div className="rounded-xl p-4 bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/70 flex items-center justify-between">
            <div>
              <div className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 uppercase">
                {bn ? 'মোট কোর্স বকেয়া' : 'TOTAL COURSE DUE'}
              </div>
              <div className="font-mono-num text-xl font-extrabold text-amber-800 dark:text-amber-300 mt-1">
                {formatTaka(totalDue)}
              </div>
            </div>
            <span className="font-mono-num text-xs font-semibold px-2.5 py-1 rounded-lg bg-white/80 dark:bg-slate-900/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
              {totalContract > 0 ? `${Math.round((totalDeposit / totalContract) * 100)}% Collected` : '0%'}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
