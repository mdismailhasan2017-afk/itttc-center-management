import { useMemo, useState } from 'react';
import {
  Briefcase,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Download,
  Layers,
  Printer,
  Tag,
  TrendingUp,
  Users,
} from 'lucide-react';
import {
  computeMonthlyJobReport,
  exportMonthlyReportToXlsx,
  getAvailableJobYears,
  MONTH_OPTIONS_BN,
  MONTH_OPTIONS_EN,
} from '../../lib/analytics';
import { formatTaka } from '../../lib/format';
import type { PrintableReportSpec } from '../../lib/print';
import type { JobEntry, JobPrice, Lang, OutStudentJob } from '../../types';

interface MonthlyReportViewProps {
  jobs: JobEntry[];
  outs: OutStudentJob[];
  prices: JobPrice[];
  centerName: string;
  lang: Lang;
  onPrintReport?: (spec: PrintableReportSpec) => void;
}

export function MonthlyReportView({
  jobs,
  outs,
  prices,
  centerName,
  lang,
  onPrintReport,
}: MonthlyReportViewProps) {
  const bn = lang === 'bn';
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState<number>(() => now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(() => now.getMonth() + 1);
  const [showZeroCategories, setShowZeroCategories] = useState(false);
  const [activeTab, setActiveTab] = useState<'categories' | 'register'>('categories');

  const availableYears = useMemo(
    () => getAvailableJobYears(jobs, outs, now),
    [jobs, outs]
  );

  const report = useMemo(
    () => computeMonthlyJobReport(jobs, outs, prices, selectedYear, selectedMonth),
    [jobs, outs, prices, selectedYear, selectedMonth]
  );

  const visibleCategoryRows = useMemo(
    () =>
      showZeroCategories
        ? report.categoryRows
        : report.categoryRows.filter((r) => r.totalJobCount > 0),
    [report.categoryRows, showZeroCategories]
  );

  const stepMonth = (delta: number) => {
    const idx = selectedYear * 12 + (selectedMonth - 1) + delta;
    const nextYear = Math.floor(idx / 12);
    const nextMonth = ((idx % 12) + 12) % 12 + 1;
    setSelectedYear(nextYear);
    setSelectedMonth(nextMonth);
  };

  const resetToCurrentMonth = () => {
    const cur = new Date();
    setSelectedYear(cur.getFullYear());
    setSelectedMonth(cur.getMonth() + 1);
  };

  const monthNames = bn ? MONTH_OPTIONS_BN : MONTH_OPTIONS_EN;
  const activeMonthTitle = bn ? report.monthLabelBn : report.monthLabelEn;

  const handlePrint = () => {
    onPrintReport?.({
      title: bn
        ? `মাসিক জব ও আয় রিপোর্ট — ${report.monthLabelBn}`
        : `Monthly Job & Revenue Report — ${report.monthLabelEn}`,
      subtitle: `${bn ? 'মোট জব' : 'Total Jobs'}: ${report.totalJobsCount} (${report.studentJobsCount} Student + ${report.outJobsCount} External) · ${bn ? 'মোট আয়' : 'Total Revenue'}: ${formatTaka(report.totalRevenue)}`,
      filename: `ittc-monthly-report-${report.year}-${String(report.month).padStart(2, '0')}`,
      summary: [
        { label: bn ? 'নির্বাচিত মাস' : 'Period', value: activeMonthTitle },
        { label: bn ? 'মোট জবের টাকা' : 'Total Revenue', value: formatTaka(report.totalRevenue) },
        { label: bn ? 'মোট জব সংখ্যা' : 'Total Jobs', value: String(report.totalJobsCount) },
        { label: bn ? 'মোট ডিসকাউন্ট' : 'Total Discount', value: formatTaka(report.totalDiscount) },
      ],
      columns: [
        'SL',
        bn ? 'ক্যাটাগরি' : 'Category',
        bn ? 'স্টুডেন্ট জব' : 'Student Jobs',
        bn ? 'বাইরের জব' : 'Out Jobs',
        bn ? 'মোট জব' : 'Total Jobs',
        bn ? 'মূল ফি' : 'Standard Fee',
        bn ? 'ডিসকাউন্ট' : 'Discount',
        bn ? 'মোট আয় (৳)' : 'Net Total (BDT)',
        bn ? 'অংশ %' : 'Share %',
      ],
      rows: [
        ...visibleCategoryRows.map((r, idx) => [
          idx + 1,
          r.cat,
          r.studentJobCount,
          r.outJobCount,
          r.totalJobCount,
          formatTaka(r.standardFeeTotal),
          formatTaka(r.discountTotal),
          formatTaka(r.netRevenue),
          `${r.sharePercent}%`,
        ]),
        [
          '',
          bn ? 'সর্বমোট (GRAND TOTAL)' : 'GRAND TOTAL',
          report.studentJobsCount,
          report.outJobsCount,
          report.totalJobsCount,
          formatTaka(report.totalStandardAmount),
          formatTaka(report.totalDiscount),
          formatTaka(report.totalRevenue),
          '100%',
        ],
      ],
    });
  };

  return (
    <div className="space-y-4 lg:space-y-0 lg:flex-1 lg:min-h-0 lg:flex lg:flex-col lg:gap-3.5">
      {/* Top Header + Month/Year Selector */}
      <div className="shrink-0 bg-white dark:bg-[#0c1320] rounded-xl border border-slate-200 dark:border-slate-800 p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="p-2.5 rounded-xl bg-teal-50 dark:bg-teal-950/60 text-teal-600 dark:text-teal-400 shrink-0">
            <CalendarRange className="w-5 h-5" />
          </span>
          <div>
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
              {bn ? 'মাসিক জব ও আয় রিপোর্ট' : 'Monthly Job & Revenue Report'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {bn
                ? 'যেকোনো মাস ও বছর নির্বাচন করে মোট জবের টাকা, জব সংখ্যা ও ক্যাটাগরি অনুযায়ী পূর্ণাঙ্গ হিসাব দেখুন'
                : 'Select any month & year to view total job revenue, total job count, and category breakdown'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div className="inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-0.5">
            <button
              type="button"
              onClick={() => stepMonth(-1)}
              aria-label="Previous month"
              className="p-1.5 rounded-md hover:bg-white dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
              aria-label="Select Month"
              className="bg-transparent px-2 py-1 text-xs font-bold text-slate-900 dark:text-white focus:outline-none cursor-pointer"
            >
              {monthNames.map((mName, idx) => (
                <option key={mName} value={idx + 1} className="bg-white dark:bg-slate-900">
                  {mName}
                </option>
              ))}
            </select>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              aria-label="Select Year"
              className="bg-transparent px-2 py-1 text-xs font-mono-num font-bold text-slate-900 dark:text-white focus:outline-none cursor-pointer"
            >
              {availableYears.map((yr) => (
                <option key={yr} value={yr} className="bg-white dark:bg-slate-900">
                  {yr}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => stepMonth(1)}
              aria-label="Next month"
              className="p-1.5 rounded-md hover:bg-white dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={resetToCurrentMonth}
            className="px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold whitespace-nowrap cursor-pointer"
          >
            {bn ? 'চলতি মাস' : 'This Month'}
          </button>

          {onPrintReport && (
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold whitespace-nowrap cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>{bn ? 'প্রিন্ট / PDF' : 'Print / PDF'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() =>
              exportMonthlyReportToXlsx(report, centerName, showZeroCategories)
            }
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold whitespace-nowrap cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{bn ? 'Excel (.xlsx)' : 'Export Excel'}</span>
          </button>
        </div>
      </div>

      {/* 4 Monthly KPI Cards */}
      <div className="shrink-0 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border border-teal-200 dark:border-teal-800/70 bg-emerald-50/60 dark:bg-emerald-950/20 p-4">
          <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-teal-800 dark:text-teal-300">
            <span>
              {bn ? `${activeMonthTitle} — মোট জবের টাকা` : `${activeMonthTitle} — Total Job Revenue`}
            </span>
            <TrendingUp className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0" />
          </div>
          <div className="font-mono-num text-2xl font-extrabold text-teal-700 dark:text-teal-300 mt-1.5">
            {formatTaka(report.totalRevenue)}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-mono-num">
            {bn ? 'স্টুডেন্ট:' : 'Student:'} {formatTaka(report.studentRevenue)} ·{' '}
            {bn ? 'বাইরে:' : 'Out:'} {formatTaka(report.outRevenue)}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0c1320] p-4">
          <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            <span>{bn ? 'মোট সম্পন্ন জব সংখ্যা' : 'Total Completed Jobs'}</span>
            <Briefcase className="w-4 h-4 text-blue-500 shrink-0" />
          </div>
          <div className="font-mono-num text-2xl font-extrabold text-slate-900 dark:text-white mt-1.5">
            {report.totalJobsCount}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-mono-num">
            {bn ? 'স্টুডেন্ট:' : 'Student:'} {report.studentJobsCount} ·{' '}
            {bn ? 'বাইরের:' : 'External:'} {report.outJobsCount}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0c1320] p-4">
          <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            <span>{bn ? 'মোট ডিসকাউন্ট ছাড়' : 'Total Discounts Given'}</span>
            <Tag className="w-4 h-4 text-amber-500 shrink-0" />
          </div>
          <div className="font-mono-num text-2xl font-extrabold text-amber-600 dark:text-amber-400 mt-1.5">
            {formatTaka(report.totalDiscount)}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-mono-num">
            {bn ? 'মূল মূল্য:' : 'Standard:'} {formatTaka(report.totalStandardAmount)}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0c1320] p-4">
          <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            <span>{bn ? 'উক্ত মাসে সক্রিয় ছাত্র' : 'Active Students in Month'}</span>
            <Users className="w-4 h-4 text-violet-500 shrink-0" />
          </div>
          <div className="font-mono-num text-2xl font-extrabold text-slate-900 dark:text-white mt-1.5">
            {report.uniqueStudentsCount}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-mono-num">
            {bn
              ? `ক্যাটাগরি ব্যবহৃত: ${report.categoryRows.filter((r) => r.totalJobCount > 0).length}টি`
              : `Active Categories: ${report.categoryRows.filter((r) => r.totalJobCount > 0).length}`}
          </div>
        </div>
      </div>

      {/* Category Breakdown / Job Entries Switcher + Scrollable Table */}
      <div className="bg-white dark:bg-[#0c1320] rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden lg:flex-1 lg:min-h-0 lg:flex lg:flex-col">
        <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 p-0.5 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setActiveTab('categories')}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md transition-colors cursor-pointer ${
                activeTab === 'categories'
                  ? 'bg-teal-600 text-white'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>
                {bn ? 'ক্যাটাগরি ভিত্তিক হিসাব' : 'Category Breakdown'} (
                {visibleCategoryRows.length})
              </span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('register')}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md transition-colors cursor-pointer ${
                activeTab === 'register'
                  ? 'bg-teal-600 text-white'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
              }`}
            >
              <Briefcase className="w-3.5 h-3.5" />
              <span>
                {bn ? 'সকল জব তালিকা' : 'All Jobs in Month'} ({report.totalJobsCount})
              </span>
            </button>
          </div>

          {activeTab === 'categories' && (
            <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showZeroCategories}
                onChange={(e) => setShowZeroCategories(e.target.checked)}
                className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
              />
              <span>
                {bn ? 'জবশূন্য ক্যাটাগরিও দেখাও' : 'Show 0-job categories'}
              </span>
            </label>
          )}
        </div>

        {activeTab === 'categories' ? (
          visibleCategoryRows.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <CalendarRange className="w-8 h-8 text-slate-400 mx-auto" />
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                {bn
                  ? `${activeMonthTitle} মাসে কোনো জব এন্ট্রি পাওয়া যায়নি।`
                  : `No jobs recorded in ${activeMonthTitle}.`}
              </p>
              <p className="text-xs text-slate-500">
                {bn
                  ? 'উপরের ড্রপডাউন থেকে অন্য মাস বা বছর নির্বাচন করুন।'
                  : 'Select another month or year above, or enable "Show 0-job categories".'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto lg:flex-1 lg:min-h-0 lg:overflow-y-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-[#111b2e]">
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    <th className="py-3 px-3.5 w-12">SL</th>
                    <th className="py-3 px-3.5">{bn ? 'জব ক্যাটাগরি' : 'JOB CATEGORY'}</th>
                    <th className="py-3 px-3.5 text-center">
                      {bn ? 'স্টুডেন্ট জব' : 'STUDENT JOBS'}
                    </th>
                    <th className="py-3 px-3.5 text-center">
                      {bn ? 'বাইরের জব' : 'OUT JOBS'}
                    </th>
                    <th className="py-3 px-3.5 text-center">{bn ? 'মোট জব' : 'TOTAL JOBS'}</th>
                    <th className="py-3 px-3.5 text-right">{bn ? 'মূল মূল্য' : 'STANDARD FEE'}</th>
                    <th className="py-3 px-3.5 text-right">{bn ? 'ডিসকাউন্ট' : 'DISCOUNT'}</th>
                    <th className="py-3 px-3.5 text-right">{bn ? 'মোট আয় (৳)' : 'NET REVENUE'}</th>
                    <th className="py-3 px-3.5 text-right w-28">{bn ? 'অংশ %' : 'SHARE %'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {visibleCategoryRows.map((row, idx) => (
                    <tr
                      key={row.cat}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-2.5 px-3.5 font-mono-num text-slate-400">
                        {String(idx + 1).padStart(2, '0')}
                      </td>
                      <td className="py-2.5 px-3.5 font-bold text-slate-900 dark:text-white">
                        {row.cat}
                      </td>
                      <td className="py-2.5 px-3.5 text-center font-mono-num text-slate-700 dark:text-slate-300">
                        {row.studentJobCount}
                      </td>
                      <td className="py-2.5 px-3.5 text-center font-mono-num text-slate-700 dark:text-slate-300">
                        {row.outJobCount}
                      </td>
                      <td className="py-2.5 px-3.5 text-center font-mono-num font-bold text-slate-900 dark:text-white">
                        {row.totalJobCount}
                      </td>
                      <td className="py-2.5 px-3.5 text-right font-mono-num text-slate-600 dark:text-slate-300">
                        {formatTaka(row.standardFeeTotal)}
                      </td>
                      <td className="py-2.5 px-3.5 text-right font-mono-num text-amber-600 dark:text-amber-400">
                        {row.discountTotal > 0 ? formatTaka(row.discountTotal) : '৳0'}
                      </td>
                      <td className="py-2.5 px-3.5 text-right font-mono-num font-bold text-teal-700 dark:text-teal-300">
                        {formatTaka(row.netRevenue)}
                      </td>
                      <td className="py-2.5 px-3.5 text-right">
                        <div className="inline-flex items-center gap-2 justify-end">
                          <div className="w-12 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                            <div
                              className="h-full bg-teal-600 rounded-full"
                              style={{ width: `${Math.min(100, row.sharePercent)}%` }}
                            />
                          </div>
                          <span className="font-mono-num text-[11px] font-bold text-slate-600 dark:text-slate-300 w-9 text-right">
                            {row.sharePercent}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200 dark:border-slate-700 bg-slate-50/90 dark:bg-slate-900/90 font-bold text-slate-900 dark:text-white">
                    <td className="py-3 px-3.5" colSpan={2}>
                      {bn ? `সর্বমোট (${activeMonthTitle})` : `GRAND TOTAL (${activeMonthTitle})`}
                    </td>
                    <td className="py-3 px-3.5 text-center font-mono-num">
                      {report.studentJobsCount}
                    </td>
                    <td className="py-3 px-3.5 text-center font-mono-num">
                      {report.outJobsCount}
                    </td>
                    <td className="py-3 px-3.5 text-center font-mono-num">
                      {report.totalJobsCount}
                    </td>
                    <td className="py-3 px-3.5 text-right font-mono-num">
                      {formatTaka(report.totalStandardAmount)}
                    </td>
                    <td className="py-3 px-3.5 text-right font-mono-num text-amber-600 dark:text-amber-400">
                      {formatTaka(report.totalDiscount)}
                    </td>
                    <td className="py-3 px-3.5 text-right font-mono-num text-teal-700 dark:text-teal-300">
                      {formatTaka(report.totalRevenue)}
                    </td>
                    <td className="py-3 px-3.5 text-right font-mono-num">100%</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )
        ) : report.totalJobsCount === 0 ? (
          <div className="p-10 text-center text-xs text-slate-500">
            {bn
              ? `${activeMonthTitle} মাসে কোনো জব এন্ট্রি নেই।`
              : `No job entries found for ${activeMonthTitle}.`}
          </div>
        ) : (
          <div className="overflow-x-auto lg:flex-1 lg:min-h-0 lg:overflow-y-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-[#111b2e]">
                <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-3.5 w-12">SL</th>
                  <th className="py-3 px-3.5">{bn ? 'ধরন' : 'TYPE'}</th>
                  <th className="py-3 px-3.5">{bn ? 'তারিখ' : 'DATE'}</th>
                  <th className="py-3 px-3.5">{bn ? 'জব নং' : 'JOB NO'}</th>
                  <th className="py-3 px-3.5">{bn ? 'কোড / এজেন্ট' : 'CODE / AGENT'}</th>
                  <th className="py-3 px-3.5">{bn ? 'নাম' : 'NAME'}</th>
                  <th className="py-3 px-3.5">{bn ? 'ক্যাটাগরি' : 'CATEGORY'}</th>
                  <th className="py-3 px-3.5 text-right">{bn ? 'টাকা (৳)' : 'AMOUNT'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {[
                  ...report.monthJobs.map((j) => ({
                    id: `j-${j.id}`,
                    type: bn ? 'স্টুডেন্ট' : 'Student',
                    isOut: false,
                    date: j.date,
                    no: j.no,
                    code: j.sid,
                    name: j.sname,
                    cat: j.cat,
                    amount: Number(j.pay || 0),
                  })),
                  ...report.monthOuts.map((o) => ({
                    id: `o-${o.id}`,
                    type: bn ? 'বাইরের' : 'External',
                    isOut: true,
                    date: o.date,
                    no: o.no,
                    code: o.agent || '—',
                    name: o.name,
                    cat: o.cat,
                    amount: Number(o.price || o.paid || 0),
                  })),
                ].map((entry, idx) => (
                  <tr key={entry.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-2 px-3.5 font-mono-num text-slate-400">
                      {String(idx + 1).padStart(2, '0')}
                    </td>
                    <td className="py-2 px-3.5">
                      <span
                        className={`px-2 py-0.5 rounded text-[10.5px] font-bold ${
                          entry.isOut
                            ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300'
                            : 'bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300'
                        }`}
                      >
                        {entry.type}
                      </span>
                    </td>
                    <td className="py-2 px-3.5 font-mono-num whitespace-nowrap">{entry.date}</td>
                    <td className="py-2 px-3.5 font-mono-num font-bold whitespace-nowrap">
                      {entry.no}
                    </td>
                    <td className="py-2 px-3.5 font-mono-num text-teal-600 dark:text-teal-400 font-semibold whitespace-nowrap">
                      {entry.code}
                    </td>
                    <td className="py-2 px-3.5 font-bold text-slate-900 dark:text-white">
                      {entry.name}
                    </td>
                    <td className="py-2 px-3.5 whitespace-nowrap">{entry.cat}</td>
                    <td className="py-2 px-3.5 text-right font-mono-num font-bold text-slate-900 dark:text-white whitespace-nowrap">
                      {formatTaka(entry.amount)}
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
