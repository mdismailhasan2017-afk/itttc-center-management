import { useEffect, useMemo, useState } from 'react';
import {
  Briefcase,
  CalendarX2,
  Clock,
  Download,
  ExternalLink,
  Plus,
  Printer,
  Search,
  UserCheck,
  UserX,
} from 'lucide-react';
import {
  computeStudentJobActivity,
  exportInactiveStudentsToXlsx,
  type StudentJobActivityRow,
} from '../../lib/analytics';
import { formatTaka, todayDDMMYYYY } from '../../lib/format';
import type { PrintableReportSpec } from '../../lib/print';
import type { JobEntry, Lang, Student } from '../../types';

export type InactiveFilterPreset =
  | 'absent_all'
  | '3plus'
  | '7plus'
  | '15plus'
  | '30plus'
  | 'never'
  | 'active'
  | 'all';

type SortMode = 'absent_desc' | 'code_asc' | 'due_desc' | 'jobs_asc';

interface InactiveStudentsViewProps {
  students: Student[];
  jobs: JobEntry[];
  centerName: string;
  lang: Lang;
  initialFilter?: InactiveFilterPreset;
  onConsumeInitialFilter?: () => void;
  onOpenProfile: (code: string) => void;
  onOpenIssueJob: (studentCode: string) => void;
  onPrintReport?: (spec: PrintableReportSpec) => void;
}

export function InactiveStudentsView({
  students,
  jobs,
  centerName,
  lang,
  initialFilter,
  onConsumeInitialFilter,
  onOpenProfile,
  onOpenIssueJob,
  onPrintReport,
}: InactiveStudentsViewProps) {
  const bn = lang === 'bn';
  const [filterPreset, setFilterPreset] = useState<InactiveFilterPreset>(
    initialFilter || 'absent_all'
  );
  const [search, setSearch] = useState('');
  const [tradeFilter, setTradeFilter] = useState('ALL');
  const [sortMode, setSortMode] = useState<SortMode>('absent_desc');

  useEffect(() => {
    if (initialFilter) {
      setFilterPreset(initialFilter);
      onConsumeInitialFilter?.();
    }
  }, [initialFilter, onConsumeInitialFilter]);

  const activity = useMemo(() => computeStudentJobActivity(students, jobs), [students, jobs]);

  const tradeOptions = useMemo(() => {
    const set = new Set<string>();
    students.forEach((s) => {
      const t = String(s.trade || '').trim();
      if (t) set.add(t);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [students]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = activity.rows.filter((r) => {
      if (filterPreset === 'absent_all') {
        if (r.status === 'active') return false;
      } else if (filterPreset === '3plus') {
        if (r.daysSinceLastJob === null || r.daysSinceLastJob < 3) return false;
      } else if (filterPreset === '7plus') {
        if (r.daysSinceLastJob === null || r.daysSinceLastJob < 7) return false;
      } else if (filterPreset === '15plus') {
        if (r.daysSinceLastJob === null || r.daysSinceLastJob < 15) return false;
      } else if (filterPreset === '30plus') {
        if (r.daysSinceLastJob === null || r.daysSinceLastJob < 30) return false;
      } else if (filterPreset === 'never') {
        if (r.status !== 'never') return false;
      } else if (filterPreset === 'active') {
        if (r.status !== 'active') return false;
      }

      if (tradeFilter !== 'ALL' && String(r.student.trade || '').trim() !== tradeFilter) {
        return false;
      }

      if (q) {
        const hay = `${r.student.code} ${r.student.name} ${r.student.phone} ${r.student.trade} ${r.lastJobCat}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });

    const sorted = [...list];
    if (sortMode === 'code_asc') {
      sorted.sort((a, b) => String(a.student.code).localeCompare(String(b.student.code)));
    } else if (sortMode === 'due_desc') {
      sorted.sort((a, b) => b.due - a.due);
    } else if (sortMode === 'jobs_asc') {
      sorted.sort((a, b) => a.totalJobs - b.totalJobs);
    }
    return sorted;
  }, [activity.rows, filterPreset, tradeFilter, search, sortMode]);

  const filterTabs: Array<{ id: InactiveFilterPreset; label: string; count: number }> = [
    {
      id: 'absent_all',
      label: bn ? 'সব অনিয়মিত (৩+ দিন ও জবশূন্য)' : 'All Inactive (3+d & Never)',
      count: activity.inactiveTotalCount,
    },
    { id: '3plus', label: bn ? '৩+ দিন জব নেই' : '3+ Days', count: activity.inactive3PlusCount },
    { id: '7plus', label: bn ? '৭+ দিন জব নেই' : '7+ Days', count: activity.inactive7PlusCount },
    { id: '15plus', label: bn ? '১৫+ দিন জব নেই' : '15+ Days', count: activity.inactive15PlusCount },
    { id: '30plus', label: bn ? '৩০+ দিন জব নেই' : '30+ Days', count: activity.inactive30PlusCount },
    { id: 'never', label: bn ? 'কোনো জব নেয়নি' : 'Never Took Job', count: activity.neverTookJobCount },
    { id: 'active', label: bn ? 'নিয়মিত (০–২ দিন)' : 'Regular (0–2d)', count: activity.activeRegularCount },
    { id: 'all', label: bn ? 'সকল ছাত্র' : 'All Students', count: activity.totalStudents },
  ];

  const activeFilterLabel = filterTabs.find((t) => t.id === filterPreset)?.label || 'Inactive';

  const formatAbsentLabel = (row: StudentJobActivityRow) => {
    if (row.daysSinceLastJob === null) {
      return bn ? 'এখনো কোনো জব নেয়নি' : 'No job taken yet';
    }
    if (row.daysSinceLastJob === 0) {
      return bn ? 'আজই জব করেছে (০ দিন)' : 'Active today (0 days)';
    }
    if (row.daysSinceLastJob <= 2) {
      return bn
        ? `${row.daysSinceLastJob} দিন আগে (নিয়মিত)`
        : `${row.daysSinceLastJob}d ago (Regular)`;
    }
    return bn
      ? `${row.daysSinceLastJob} দিন ধরে জব নেই`
      : `${row.daysSinceLastJob} days absent`;
  };

  const badgeToneForRow = (row: StudentJobActivityRow) => {
    if (row.daysSinceLastJob === null) {
      return 'bg-violet-50 dark:bg-violet-950/60 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800';
    }
    if (row.daysSinceLastJob >= 15) {
      return 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800';
    }
    if (row.daysSinceLastJob >= 7) {
      return 'bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800';
    }
    if (row.daysSinceLastJob >= 3) {
      return 'bg-orange-50 dark:bg-orange-950/60 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800';
    }
    return 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
  };

  const handlePrint = () => {
    onPrintReport?.({
      title: bn
        ? 'ইনঅ্যাক্টিভ / অনিয়মিত ছাত্র তালিকা রিপোর্ট'
        : 'Inactive / Absent Students Tracking Report',
      subtitle: `${bn ? 'ফিল্টার' : 'Filter'}: ${activeFilterLabel} · ${bn ? 'তারিখ' : 'Date'}: ${todayDDMMYYYY()}`,
      filename: `ittc-inactive-students-${todayDDMMYYYY()}`,
      summary: [
        { label: bn ? 'মোট তালিকাভুক্ত' : 'Listed Students', value: String(filteredRows.length) },
        { label: bn ? '৩+ দিন জব নেই' : '3+ Days Absent', value: String(activity.inactive3PlusCount) },
        { label: bn ? '৭+ দিন জব নেই' : '7+ Days Absent', value: String(activity.inactive7PlusCount) },
        { label: bn ? 'কোনো জব নেয়নি' : 'Never Took Job', value: String(activity.neverTookJobCount) },
      ],
      columns: [
        'SL',
        bn ? 'খাতা কোড' : 'Code',
        bn ? 'ছাত্রের নাম' : 'Student Name',
        bn ? 'ফোন' : 'Phone',
        bn ? 'সর্বশেষ জবের তারিখ' : 'Last Job Date',
        bn ? 'ক্যাটাগরি' : 'Last Category',
        bn ? 'মোট জব' : 'Total Jobs',
        bn ? 'ইনঅ্যাক্টিভ দিন' : 'Inactive Status',
        bn ? 'বকেয়া' : 'Due',
      ],
      rows: filteredRows.map((r, idx) => [
        idx + 1,
        r.student.code,
        r.student.name,
        r.student.phone || '—',
        r.lastJobDate || (bn ? 'নেই' : 'Never'),
        r.lastJobCat || '—',
        r.totalJobs,
        formatAbsentLabel(r),
        formatTaka(r.due),
      ]),
    });
  };

  return (
    <div className="space-y-4 lg:space-y-0 lg:flex-1 lg:min-h-0 lg:flex lg:flex-col lg:gap-3.5">
      {/* Header + Actions */}
      <div className="shrink-0 bg-white dark:bg-[#0c1320] rounded-xl border border-slate-200 dark:border-slate-800 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
            {bn
              ? 'ইনঅ্যাক্টিভ / অনিয়মিত ছাত্র ট্র্যাকিং'
              : 'Inactive & Absent Students Tracker'}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {bn
              ? 'প্রতিটি ছাত্রের সর্বশেষ জব এন্ট্রির তারিখ থেকে আজকের তারিখ পর্যন্ত দিন সংখ্যা স্বয়ংক্রিয়ভাবে হিসাব করা হয়'
              : 'Automatically computes days elapsed from each student’s last practical job entry to today'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {onPrintReport && (
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold whitespace-nowrap cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>{bn ? 'প্রিন্ট রিপোর্ট' : 'Print Report'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() =>
              exportInactiveStudentsToXlsx(filteredRows, activeFilterLabel, centerName)
            }
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold whitespace-nowrap cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{bn ? 'Excel (.xlsx)' : 'Export Excel'}</span>
          </button>
        </div>
      </div>

      {/* 5 KPI Summary Strip */}
      <div className="shrink-0 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <button
          type="button"
          onClick={() => setFilterPreset('absent_all')}
          className={`text-left rounded-xl border p-3.5 transition-colors cursor-pointer ${
            filterPreset === 'absent_all'
              ? 'bg-rose-50/70 dark:bg-rose-950/30 border-rose-300 dark:border-rose-700'
              : 'bg-white dark:bg-[#0c1320] border-slate-200 dark:border-slate-800 hover:border-rose-300'
          }`}
        >
          <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            <span>{bn ? 'মোট অনিয়মিত / অনুপস্থিত' : 'Total Inactive'}</span>
            <UserX className="w-4 h-4 text-rose-500 shrink-0" />
          </div>
          <div className="font-mono-num text-xl font-extrabold text-slate-900 dark:text-white mt-1.5">
            {activity.inactiveTotalCount}
          </div>
        </button>

        <button
          type="button"
          onClick={() => setFilterPreset('3plus')}
          className={`text-left rounded-xl border p-3.5 transition-colors cursor-pointer ${
            filterPreset === '3plus'
              ? 'bg-orange-50/70 dark:bg-orange-950/30 border-orange-300 dark:border-orange-700'
              : 'bg-white dark:bg-[#0c1320] border-slate-200 dark:border-slate-800 hover:border-orange-300'
          }`}
        >
          <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            <span>{bn ? '৩+ দিন জব নেই' : '3+ Days No Job'}</span>
            <Clock className="w-4 h-4 text-orange-500 shrink-0" />
          </div>
          <div className="font-mono-num text-xl font-extrabold text-orange-600 dark:text-orange-400 mt-1.5">
            {activity.inactive3PlusCount}
          </div>
        </button>

        <button
          type="button"
          onClick={() => setFilterPreset('7plus')}
          className={`text-left rounded-xl border p-3.5 transition-colors cursor-pointer ${
            filterPreset === '7plus'
              ? 'bg-amber-50/70 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700'
              : 'bg-white dark:bg-[#0c1320] border-slate-200 dark:border-slate-800 hover:border-amber-300'
          }`}
        >
          <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            <span>{bn ? '৭+ দিন জব নেই' : '7+ Days No Job'}</span>
            <CalendarX2 className="w-4 h-4 text-amber-500 shrink-0" />
          </div>
          <div className="font-mono-num text-xl font-extrabold text-amber-600 dark:text-amber-400 mt-1.5">
            {activity.inactive7PlusCount}
          </div>
        </button>

        <button
          type="button"
          onClick={() => setFilterPreset('never')}
          className={`text-left rounded-xl border p-3.5 transition-colors cursor-pointer ${
            filterPreset === 'never'
              ? 'bg-violet-50/70 dark:bg-violet-950/30 border-violet-300 dark:border-violet-700'
              : 'bg-white dark:bg-[#0c1320] border-slate-200 dark:border-slate-800 hover:border-violet-300'
          }`}
        >
          <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            <span>{bn ? 'কোনো জবই নেয়নি' : 'Never Took Job'}</span>
            <Briefcase className="w-4 h-4 text-violet-500 shrink-0" />
          </div>
          <div className="font-mono-num text-xl font-extrabold text-violet-600 dark:text-violet-400 mt-1.5">
            {activity.neverTookJobCount}
          </div>
        </button>

        <button
          type="button"
          onClick={() => setFilterPreset('active')}
          className={`text-left rounded-xl border p-3.5 transition-colors cursor-pointer ${
            filterPreset === 'active'
              ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-700'
              : 'bg-white dark:bg-[#0c1320] border-slate-200 dark:border-slate-800 hover:border-emerald-300'
          }`}
        >
          <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            <span>{bn ? 'নিয়মিত জব (০–২ দিন)' : 'Regular (0–2 Days)'}</span>
            <UserCheck className="w-4 h-4 text-emerald-500 shrink-0" />
          </div>
          <div className="font-mono-num text-xl font-extrabold text-emerald-600 dark:text-emerald-400 mt-1.5">
            {activity.activeRegularCount}
          </div>
        </button>
      </div>

      {/* Filter Bar */}
      <div className="shrink-0 bg-white dark:bg-[#0c1320] rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-2.5">
        <div className="flex flex-wrap gap-1.5">
          {filterTabs.map((tab) => {
            const active = filterPreset === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterPreset(tab.id)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap cursor-pointer ${
                  active
                    ? 'bg-teal-600 border-teal-600 text-white'
                    : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-teal-400'
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`font-mono-num text-[10.5px] px-1.5 py-0.5 rounded ${
                    active
                      ? 'bg-white/20 text-white'
                      : 'bg-slate-200/80 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
          <div className="relative sm:col-span-6">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={
                bn
                  ? 'ছাত্রের নাম, খাতা কোড বা ফোন দিয়ে খুঁজুন...'
                  : 'Search student name, Khata code, or phone...'
              }
              className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
            />
          </div>
          <select
            value={tradeFilter}
            onChange={(e) => setTradeFilter(e.target.value)}
            className="sm:col-span-3 px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
          >
            <option value="ALL">{bn ? 'সব ট্রেড' : 'All Trades'}</option>
            {tradeOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            className="sm:col-span-3 px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
          >
            <option value="absent_desc">
              {bn ? 'বেশি দিন অনুপস্থিত আগে' : 'Sort: Longest Absent'}
            </option>
            <option value="code_asc">{bn ? 'খাতা কোড অনুযায়ী' : 'Sort: Khata Code'}</option>
            <option value="due_desc">{bn ? 'বেশি বকেয়া আগে' : 'Sort: Highest Due'}</option>
            <option value="jobs_asc">{bn ? 'কম জব নেওয়া আগে' : 'Sort: Fewest Jobs'}</option>
          </select>
        </div>
      </div>

      {/* Scrollable Student Activity Table */}
      <div className="bg-white dark:bg-[#0c1320] rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden lg:flex-1 lg:min-h-0 lg:flex lg:flex-col">
        <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs shrink-0">
          <span className="font-bold text-slate-800 dark:text-slate-100">
            {activeFilterLabel} ({filteredRows.length})
          </span>
          <span className="text-[11px] text-slate-500">
            {bn ? `হিসাবের তারিখ: ${todayDDMMYYYY()}` : `Calculated as of ${todayDDMMYYYY()}`}
          </span>
        </div>

        {filteredRows.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <UserCheck className="w-8 h-8 text-emerald-500 mx-auto" />
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              {bn
                ? 'এই তালিকায় কোনো ছাত্র পাওয়া যায়নি।'
                : 'No students match this inactivity filter.'}
            </p>
            <p className="text-xs text-slate-500">
              {bn
                ? 'অন্য ফিল্টার বা সার্চ দিয়ে দেখুন।'
                : 'Try selecting another day threshold or clearing your search.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto lg:flex-1 lg:min-h-0 lg:overflow-y-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-[#111b2e]">
                <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-3.5 w-12">SL</th>
                  <th className="py-3 px-3.5">{bn ? 'খাতা কোড' : 'CODE'}</th>
                  <th className="py-3 px-3.5">{bn ? 'ছাত্রের নাম ও ট্রেড' : 'STUDENT & TRADE'}</th>
                  <th className="py-3 px-3.5">{bn ? 'মোবাইল' : 'PHONE'}</th>
                  <th className="py-3 px-3.5">{bn ? 'সর্বশেষ জবের তারিখ' : 'LAST JOB DATE'}</th>
                  <th className="py-3 px-3.5 text-center">{bn ? 'মোট জব' : 'TOTAL JOBS'}</th>
                  <th className="py-3 px-3.5">{bn ? 'অনুপস্থিত / ইনঅ্যাক্টিভ' : 'ABSENT / INACTIVE'}</th>
                  <th className="py-3 px-3.5 text-right">{bn ? 'বকেয়া' : 'DUE'}</th>
                  <th className="py-3 px-3.5 text-right">{bn ? 'অ্যাকশন' : 'ACTIONS'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {filteredRows.map((row, idx) => (
                  <tr
                    key={row.student.id}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="py-2.5 px-3.5 font-mono-num text-slate-400">
                      {String(idx + 1).padStart(2, '0')}
                    </td>
                    <td className="py-2.5 px-3.5 font-mono-num font-bold text-teal-600 dark:text-teal-400 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => onOpenProfile(row.student.code)}
                        className="hover:underline cursor-pointer"
                      >
                        {row.student.code}
                      </button>
                    </td>
                    <td className="py-2.5 px-3.5">
                      <div className="font-bold text-slate-900 dark:text-white">
                        {row.student.name}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate max-w-[200px]">
                        {row.student.trade || (bn ? 'ট্রেড উল্লেখ নেই' : 'No trade')}
                      </div>
                    </td>
                    <td className="py-2.5 px-3.5 font-mono-num text-slate-600 dark:text-slate-300 whitespace-nowrap">
                      {row.student.phone || '—'}
                    </td>
                    <td className="py-2.5 px-3.5 whitespace-nowrap">
                      {row.lastJobDate ? (
                        <div>
                          <div className="font-mono-num font-semibold text-slate-800 dark:text-slate-200">
                            {row.lastJobDate}
                          </div>
                          <div className="text-[10.5px] text-slate-500">{row.lastJobCat}</div>
                        </div>
                      ) : (
                        <span className="text-slate-400 italic">
                          {bn ? 'কোনো জব নেই' : 'No jobs yet'}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3.5 text-center font-mono-num font-bold text-slate-800 dark:text-slate-200">
                      {row.totalJobs}
                    </td>
                    <td className="py-2.5 px-3.5 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-2.5 py-1 rounded-md border text-[11px] font-bold font-mono-num ${badgeToneForRow(
                          row
                        )}`}
                      >
                        {formatAbsentLabel(row)}
                      </span>
                    </td>
                    <td className="py-2.5 px-3.5 text-right font-mono-num font-bold whitespace-nowrap">
                      <span
                        className={
                          row.due > 0
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-emerald-600 dark:text-emerald-400'
                        }
                      >
                        {formatTaka(row.due)}
                      </span>
                    </td>
                    <td className="py-2.5 px-3.5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onOpenIssueJob(row.student.code)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-teal-600 hover:bg-teal-700 text-white text-[11px] font-semibold cursor-pointer"
                        >
                          <Plus className="w-3 h-3" />
                          <span>{bn ? 'জব' : 'Job'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onOpenProfile(row.student.code)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-[11px] font-semibold cursor-pointer"
                        >
                          <ExternalLink className="w-3 h-3" />
                          <span>{bn ? 'ফাইল' : 'Profile'}</span>
                        </button>
                      </div>
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
