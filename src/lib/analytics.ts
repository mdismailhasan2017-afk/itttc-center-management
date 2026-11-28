import * as XLSX from 'xlsx';
import type { JobEntry, JobPrice, OutStudentJob, Student } from '../types';

export const MONTH_OPTIONS_EN = [
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

export const MONTH_OPTIONS_BN = [
  'জানুয়ারি',
  'ফেব্রুয়ারি',
  'মার্চ',
  'এপ্রিল',
  'মে',
  'জুন',
  'জুলাই',
  'আগস্ট',
  'সেপ্টেম্বর',
  'অক্টোবর',
  'নভেম্বর',
  'ডিসেম্বর',
];

export interface ParsedDateParts {
  year: number;
  month: number; // 1..12
  day: number; // 1..31
  ddmmyyyy: string;
  yyyymmdd: string;
  midnightMs: number;
}

export function parseFlexibleDate(dateStr?: string): ParsedDateParts | null {
  const raw = String(dateStr || '').trim();
  if (!raw) return null;

  let day = 0;
  let month = 0;
  let year = 0;

  const dmy = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(raw);
  if (dmy) {
    day = Number(dmy[1]);
    month = Number(dmy[2]);
    year = Number(dmy[3]);
  } else {
    const ymd = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(raw);
    if (ymd) {
      year = Number(ymd[1]);
      month = Number(ymd[2]);
      day = Number(ymd[3]);
    }
  }

  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const dt = new Date(year, month - 1, day);
  if (
    dt.getFullYear() !== year ||
    dt.getMonth() !== month - 1 ||
    dt.getDate() !== day
  ) {
    return null;
  }

  const dd = String(day).padStart(2, '0');
  const mm = String(month).padStart(2, '0');

  return {
    year,
    month,
    day,
    ddmmyyyy: `${dd}-${mm}-${year}`,
    yyyymmdd: `${year}-${mm}-${dd}`,
    midnightMs: dt.getTime(),
  };
}

export function getTodayMidnightMs(referenceNow = new Date()): number {
  return new Date(
    referenceNow.getFullYear(),
    referenceNow.getMonth(),
    referenceNow.getDate()
  ).getTime();
}

export type StudentActivityStatus = 'active' | 'inactive' | 'never';

export interface StudentJobActivityRow {
  student: Student;
  due: number;
  totalJobs: number;
  totalJobAmount: number;
  lastJobDate: string;
  lastJobCat: string;
  lastJobNo: string;
  lastJobMidnightMs: number;
  daysSinceLastJob: number | null; // null => never took any job
  status: StudentActivityStatus;
}

export interface StudentJobActivitySummary {
  rows: StudentJobActivityRow[];
  totalStudents: number;
  activeRegularCount: number; // 0..2 days ago
  inactiveTotalCount: number; // 3+ days + never
  inactiveWithJobsCount: number; // 3+ days (has at least 1 prior job)
  inactive3PlusCount: number; // >= 3 days
  inactive7PlusCount: number; // >= 7 days
  inactive15PlusCount: number; // >= 15 days
  inactive30PlusCount: number; // >= 30 days
  neverTookJobCount: number;
  days3to6Count: number;
  days7to14Count: number;
  days15PlusCount: number;
}

export function computeStudentJobActivity(
  students: Student[],
  jobs: JobEntry[],
  referenceNow = new Date()
): StudentJobActivitySummary {
  const todayMs = getTodayMidnightMs(referenceNow);

  const jobsByStudent = new Map<
    string,
    {
      totalJobs: number;
      totalJobAmount: number;
      lastJobDate: string;
      lastJobCat: string;
      lastJobNo: string;
      lastJobMidnightMs: number;
      lastIndex: number;
    }
  >();

  jobs.forEach((job, idx) => {
    const codeKey = String(job.sid || '').trim().toLowerCase();
    if (!codeKey) return;
    const parsed = parseFlexibleDate(job.date);
    const ms = parsed ? parsed.midnightMs : 0;
    const pay = Math.max(0, Number(job.pay || 0));

    const prev = jobsByStudent.get(codeKey);
    if (!prev) {
      jobsByStudent.set(codeKey, {
        totalJobs: 1,
        totalJobAmount: pay,
        lastJobDate: parsed ? parsed.ddmmyyyy : String(job.date || ''),
        lastJobCat: String(job.cat || ''),
        lastJobNo: String(job.no || ''),
        lastJobMidnightMs: ms,
        lastIndex: idx,
      });
    } else {
      prev.totalJobs += 1;
      prev.totalJobAmount += pay;
      if (ms > prev.lastJobMidnightMs || (ms === prev.lastJobMidnightMs && idx >= prev.lastIndex)) {
        prev.lastJobMidnightMs = ms;
        prev.lastJobDate = parsed ? parsed.ddmmyyyy : String(job.date || '');
        prev.lastJobCat = String(job.cat || '');
        prev.lastJobNo = String(job.no || '');
        prev.lastIndex = idx;
      }
    }
  });

  let activeRegularCount = 0;
  let inactive3PlusCount = 0;
  let inactive7PlusCount = 0;
  let inactive15PlusCount = 0;
  let inactive30PlusCount = 0;
  let neverTookJobCount = 0;
  let days3to6Count = 0;
  let days7to14Count = 0;
  let days15PlusCount = 0;

  const rows: StudentJobActivityRow[] = students.map((student) => {
    const codeKey = String(student.code || '').trim().toLowerCase();
    const due = Math.max(0, Number(student.contract || 0) - Number(student.deposit || 0));
    const agg = codeKey ? jobsByStudent.get(codeKey) : undefined;

    if (!agg || agg.totalJobs === 0) {
      neverTookJobCount += 1;
      return {
        student,
        due,
        totalJobs: 0,
        totalJobAmount: 0,
        lastJobDate: '',
        lastJobCat: '',
        lastJobNo: '',
        lastJobMidnightMs: 0,
        daysSinceLastJob: null,
        status: 'never',
      };
    }

    const daysSinceLastJob =
      agg.lastJobMidnightMs > 0
        ? Math.max(0, Math.round((todayMs - agg.lastJobMidnightMs) / 86400000))
        : 0;

    const status: StudentActivityStatus = daysSinceLastJob >= 3 ? 'inactive' : 'active';
    if (status === 'active') {
      activeRegularCount += 1;
    } else {
      inactive3PlusCount += 1;
      if (daysSinceLastJob >= 7) inactive7PlusCount += 1;
      if (daysSinceLastJob >= 15) inactive15PlusCount += 1;
      if (daysSinceLastJob >= 30) inactive30PlusCount += 1;

      if (daysSinceLastJob <= 6) days3to6Count += 1;
      else if (daysSinceLastJob <= 14) days7to14Count += 1;
      else days15PlusCount += 1;
    }

    return {
      student,
      due,
      totalJobs: agg.totalJobs,
      totalJobAmount: agg.totalJobAmount,
      lastJobDate: agg.lastJobDate,
      lastJobCat: agg.lastJobCat,
      lastJobNo: agg.lastJobNo,
      lastJobMidnightMs: agg.lastJobMidnightMs,
      daysSinceLastJob,
      status,
    };
  });

  // Sort longest-inactive first, then never-took-job, then active
  rows.sort((a, b) => {
    const scoreA = a.daysSinceLastJob === null ? 99999 : a.daysSinceLastJob;
    const scoreB = b.daysSinceLastJob === null ? 99999 : b.daysSinceLastJob;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return String(a.student.code || '').localeCompare(String(b.student.code || ''));
  });

  return {
    rows,
    totalStudents: students.length,
    activeRegularCount,
    inactiveTotalCount: inactive3PlusCount + neverTookJobCount,
    inactiveWithJobsCount: inactive3PlusCount,
    inactive3PlusCount,
    inactive7PlusCount,
    inactive15PlusCount,
    inactive30PlusCount,
    neverTookJobCount,
    days3to6Count,
    days7to14Count,
    days15PlusCount,
  };
}

export interface QuickActionsSummary {
  totalJobAmount: number;
  studentJobAmount: number;
  outJobAmount: number;
  totalJobCount: number;
  dueStudentsCount: number;
  totalDueAmount: number;
  activeRegularStudentsCount: number;
  inactive3to6Count: number;
  inactive7to14Count: number;
  inactive15PlusCount: number;
  neverTookJobCount: number;
  totalInactiveStudentsCount: number;
}

export function computeQuickActionsSummary(
  students: Student[],
  jobs: JobEntry[],
  outs: OutStudentJob[],
  referenceNow = new Date()
): QuickActionsSummary {
  const studentJobAmount = jobs.reduce((sum, j) => sum + Math.max(0, Number(j.pay || 0)), 0);
  const outJobAmount = outs.reduce(
    (sum, o) => sum + Math.max(0, Number(o.price || o.paid || 0)),
    0
  );

  let dueStudentsCount = 0;
  let totalDueAmount = 0;
  for (const s of students) {
    const due = Math.max(0, Number(s.contract || 0) - Number(s.deposit || 0));
    if (due > 0) {
      dueStudentsCount += 1;
      totalDueAmount += due;
    }
  }

  const activity = computeStudentJobActivity(students, jobs, referenceNow);

  return {
    totalJobAmount: studentJobAmount + outJobAmount,
    studentJobAmount,
    outJobAmount,
    totalJobCount: jobs.length + outs.length,
    dueStudentsCount,
    totalDueAmount,
    activeRegularStudentsCount: activity.activeRegularCount,
    inactive3to6Count: activity.days3to6Count,
    inactive7to14Count: activity.days7to14Count,
    inactive15PlusCount: activity.days15PlusCount,
    neverTookJobCount: activity.neverTookJobCount,
    totalInactiveStudentsCount: activity.inactiveTotalCount,
  };
}

export interface MonthlyCategoryBreakdownRow {
  cat: string;
  studentJobCount: number;
  outJobCount: number;
  totalJobCount: number;
  standardFeeTotal: number;
  discountTotal: number;
  studentRevenue: number;
  outRevenue: number;
  netRevenue: number;
  sharePercent: number;
}

export interface MonthlyJobReportSummary {
  year: number;
  month: number;
  monthLabelEn: string;
  monthLabelBn: string;
  monthJobs: JobEntry[];
  monthOuts: OutStudentJob[];
  totalJobsCount: number;
  studentJobsCount: number;
  outJobsCount: number;
  totalStandardAmount: number;
  totalDiscount: number;
  totalRevenue: number;
  studentRevenue: number;
  outRevenue: number;
  uniqueStudentsCount: number;
  categoryRows: MonthlyCategoryBreakdownRow[];
}

export function getAvailableJobYears(
  jobs: JobEntry[],
  outs: OutStudentJob[],
  referenceNow = new Date()
): number[] {
  const years = new Set<number>([referenceNow.getFullYear()]);
  for (const j of jobs) {
    const p = parseFlexibleDate(j.date);
    if (p) years.add(p.year);
  }
  for (const o of outs) {
    const p = parseFlexibleDate(o.date);
    if (p) years.add(p.year);
  }
  return Array.from(years).sort((a, b) => b - a);
}

export function computeMonthlyJobReport(
  jobs: JobEntry[],
  outs: OutStudentJob[],
  prices: JobPrice[],
  year: number,
  month: number
): MonthlyJobReportSummary {
  const monthJobs = jobs.filter((j) => {
    const p = parseFlexibleDate(j.date);
    return p ? p.year === year && p.month === month : false;
  });

  const monthOuts = outs.filter((o) => {
    const p = parseFlexibleDate(o.date);
    return p ? p.year === year && p.month === month : false;
  });

  const catOrder: string[] = [];
  const bucketMap = new Map<
    string,
    {
      cat: string;
      studentJobCount: number;
      outJobCount: number;
      standardFeeTotal: number;
      discountTotal: number;
      studentRevenue: number;
      outRevenue: number;
    }
  >();

  const ensureBucket = (rawCat: string) => {
    const clean = String(rawCat || '').trim() || 'Uncategorized';
    const key = clean;
    if (!bucketMap.has(key)) {
      catOrder.push(key);
      bucketMap.set(key, {
        cat: clean,
        studentJobCount: 0,
        outJobCount: 0,
        standardFeeTotal: 0,
        discountTotal: 0,
        studentRevenue: 0,
        outRevenue: 0,
      });
    }
    return bucketMap.get(key)!;
  };

  // Seed order from configured categories first
  prices.forEach((p) => {
    if (p.cat?.trim()) ensureBucket(p.cat);
  });

  const uniqueStudents = new Set<string>();
  let totalStandardAmount = 0;
  let totalDiscount = 0;
  let studentRevenue = 0;
  let outRevenue = 0;

  for (const j of monthJobs) {
    const b = ensureBucket(j.cat);
    const pay = Math.max(0, Number(j.pay || 0));
    const disc = Math.max(0, Number(j.discount || 0));
    const std = pay + disc;
    b.studentJobCount += 1;
    b.standardFeeTotal += std;
    b.discountTotal += disc;
    b.studentRevenue += pay;

    totalStandardAmount += std;
    totalDiscount += disc;
    studentRevenue += pay;
    const sid = String(j.sid || '').trim().toLowerCase();
    if (sid) uniqueStudents.add(sid);
  }

  for (const o of monthOuts) {
    const b = ensureBucket(o.cat);
    const rev = Math.max(0, Number(o.price || o.paid || 0));
    b.outJobCount += 1;
    b.standardFeeTotal += rev;
    b.outRevenue += rev;

    totalStandardAmount += rev;
    outRevenue += rev;
  }

  const totalRevenue = studentRevenue + outRevenue;
  const totalJobsCount = monthJobs.length + monthOuts.length;

  const categoryRows: MonthlyCategoryBreakdownRow[] = catOrder.map((key) => {
    const b = bucketMap.get(key)!;
    const totalJobCount = b.studentJobCount + b.outJobCount;
    const netRevenue = b.studentRevenue + b.outRevenue;
    const sharePercent =
      totalRevenue > 0
        ? Math.round((netRevenue / totalRevenue) * 100)
        : totalJobsCount > 0
          ? Math.round((totalJobCount / totalJobsCount) * 100)
          : 0;
    return {
      cat: b.cat,
      studentJobCount: b.studentJobCount,
      outJobCount: b.outJobCount,
      totalJobCount,
      standardFeeTotal: b.standardFeeTotal,
      discountTotal: b.discountTotal,
      studentRevenue: b.studentRevenue,
      outRevenue: b.outRevenue,
      netRevenue,
      sharePercent,
    };
  });

  return {
    year,
    month,
    monthLabelEn: `${MONTH_OPTIONS_EN[month - 1] || month} ${year}`,
    monthLabelBn: `${MONTH_OPTIONS_BN[month - 1] || month} ${year}`,
    monthJobs,
    monthOuts,
    totalJobsCount,
    studentJobsCount: monthJobs.length,
    outJobsCount: monthOuts.length,
    totalStandardAmount,
    totalDiscount,
    totalRevenue,
    studentRevenue,
    outRevenue,
    uniqueStudentsCount: uniqueStudents.size,
    categoryRows,
  };
}

export function exportInactiveStudentsToXlsx(
  rows: StudentJobActivityRow[],
  filterLabel: string,
  centerName: string
): void {
  const aoa: Array<Array<string | number>> = [
    [centerName || 'ITTC Center', '', '', '', '', '', '', '', ''],
    [`Inactive / Absent Students Report (${filterLabel})`, '', '', '', '', '', '', '', ''],
    [],
    [
      'SL',
      'Khata Code',
      'Student Name',
      'Trade',
      'Phone',
      'Last Job Date',
      'Last Category',
      'Total Jobs',
      'Absent / Inactive Days',
      'Due Balance (BDT)',
    ],
    ...rows.map((r, idx) => [
      idx + 1,
      r.student.code || '',
      r.student.name || '',
      r.student.trade || '',
      r.student.phone || '',
      r.lastJobDate || 'Never',
      r.lastJobCat || '—',
      r.totalJobs,
      r.daysSinceLastJob === null
        ? 'No Job Taken Yet'
        : r.daysSinceLastJob === 0
          ? 'Today (0 days)'
          : `${r.daysSinceLastJob} days`,
      r.due,
    ]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [
    { wch: 6 },
    { wch: 13 },
    { wch: 24 },
    { wch: 20 },
    { wch: 15 },
    { wch: 14 },
    { wch: 22 },
    { wch: 11 },
    { wch: 20 },
    { wch: 18 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Inactive Students');
  XLSX.writeFile(wb, `ITTC_Inactive_Students_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export function exportMonthlyReportToXlsx(
  report: MonthlyJobReportSummary,
  centerName: string,
  includeEmptyCategories = false
): void {
  const visibleRows = includeEmptyCategories
    ? report.categoryRows
    : report.categoryRows.filter((r) => r.totalJobCount > 0);

  const summaryAoa: Array<Array<string | number>> = [
    [centerName || 'ITTC Center'],
    [`Monthly Job & Revenue Report — ${report.monthLabelEn}`],
    [],
    ['Metric', 'Value'],
    ['Selected Month', report.monthLabelEn],
    ['Total Completed Jobs', report.totalJobsCount],
    ['Registered Student Jobs', report.studentJobsCount],
    ['External Out-Student Jobs', report.outJobsCount],
    ['Unique Active Students', report.uniqueStudentsCount],
    ['Total Standard Fee (BDT)', report.totalStandardAmount],
    ['Total Discount Given (BDT)', report.totalDiscount],
    ['Net Total Job Revenue (BDT)', report.totalRevenue],
    [],
    [
      'SL',
      'Category',
      'Student Jobs',
      'Out Jobs',
      'Total Jobs',
      'Standard Fee (BDT)',
      'Discount (BDT)',
      'Net Revenue (BDT)',
      'Revenue Share %',
    ],
    ...visibleRows.map((r, idx) => [
      idx + 1,
      r.cat,
      r.studentJobCount,
      r.outJobCount,
      r.totalJobCount,
      r.standardFeeTotal,
      r.discountTotal,
      r.netRevenue,
      `${r.sharePercent}%`,
    ]),
    [
      '',
      'GRAND TOTAL',
      report.studentJobsCount,
      report.outJobsCount,
      report.totalJobsCount,
      report.totalStandardAmount,
      report.totalDiscount,
      report.totalRevenue,
      '100%',
    ],
  ];

  const wsSummary = XLSX.utils.aoa_to_sheet(summaryAoa);
  wsSummary['!cols'] = [
    { wch: 6 },
    { wch: 28 },
    { wch: 13 },
    { wch: 12 },
    { wch: 12 },
    { wch: 18 },
    { wch: 15 },
    { wch: 18 },
    { wch: 15 },
  ];

  const registerRows: Array<Array<string | number>> = [
    [
      'SL',
      'Type',
      'Date',
      'Job / Slip No',
      'Code / Agent',
      'Name',
      'Category',
      'Standard Fee',
      'Discount',
      'Net Payable (BDT)',
      'Note',
    ],
    ...report.monthJobs.map((j, idx) => [
      idx + 1,
      'Student Job',
      j.date,
      j.no,
      j.sid,
      j.sname,
      j.cat,
      Number(j.pay || 0) + Number(j.discount || 0),
      Number(j.discount || 0),
      Number(j.pay || 0),
      j.note || '',
    ]),
    ...report.monthOuts.map((o, idx) => [
      report.monthJobs.length + idx + 1,
      'Out Student',
      o.date,
      o.no,
      o.agent || 'External',
      o.name,
      o.cat,
      Number(o.price || o.paid || 0),
      0,
      Number(o.price || o.paid || 0),
      o.note || '',
    ]),
  ];

  const wsRegister = XLSX.utils.aoa_to_sheet(registerRows);
  wsRegister['!cols'] = [
    { wch: 6 },
    { wch: 13 },
    { wch: 13 },
    { wch: 16 },
    { wch: 15 },
    { wch: 24 },
    { wch: 22 },
    { wch: 14 },
    { wch: 11 },
    { wch: 16 },
    { wch: 24 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Monthly Category Summary');
  XLSX.utils.book_append_sheet(wb, wsRegister, 'Monthly Job Register');
  const mm = String(report.month).padStart(2, '0');
  XLSX.writeFile(wb, `ITTC_Monthly_Report_${report.year}-${mm}.xlsx`);
}
