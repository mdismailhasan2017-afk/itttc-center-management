import type { AuditLog, JobEntry, JobPrice, JobReturn, SlipData } from '../types';

export const RENT_LIMIT_ACTION = 'RENT_JOB_LIMIT';

export interface CanEnterJobParams {
  baseLimit: number;
  rentedLimit?: number;
  currentEntries?: number;
}

export interface JobQuotaCheck {
  allowed: boolean;
  baseLimit: number;
  rentedLimit: number;
  totalAllowedLimit: number;
  currentEntries: number;
  remainingLimit: number;
}

/**
 * জব এন্ট্রি করার অনুমতি আছে কি না তা যাচাই করার ফাংশন
 */
export function canEnterJob({
  baseLimit,
  rentedLimit = 0,
  currentEntries = 0,
}: CanEnterJobParams): JobQuotaCheck {
  const safeBaseLimit = Math.max(0, Number(baseLimit) || 0);
  const safeRentedLimit = Math.max(0, Number(rentedLimit) || 0);
  const safeCurrentEntries = Math.max(0, Number(currentEntries) || 0);

  const totalAllowedLimit = safeBaseLimit + safeRentedLimit;
  const remainingLimit = Math.max(0, totalAllowedLimit - safeCurrentEntries);

  return {
    allowed: safeCurrentEntries < totalAllowedLimit,
    baseLimit: safeBaseLimit,
    rentedLimit: safeRentedLimit,
    totalAllowedLimit,
    currentEntries: safeCurrentEntries,
    remainingLimit,
  };
}

export interface RentSupervisorLimitResult {
  success: boolean;
  message: string;
  amount?: number;
  supervisorName?: string;
}

export function rentSupervisorLimit(
  extraLimit: number | string,
  supervisorName = 'Supervisor',
  currentTotalBeforeRent = 0
): RentSupervisorLimitResult {
  const amount = Math.floor(Number(extraLimit));
  if (!Number.isFinite(amount) || amount <= 0) {
    return { success: false, message: 'সঠিক লিমিট সংখ্যা দিন।' };
  }

  const cleanSupervisor = (supervisorName || '').trim().slice(0, 48) || 'Supervisor';
  const nextTotal = Math.max(0, Number(currentTotalBeforeRent) || 0) + amount;

  return {
    success: true,
    amount,
    supervisorName: cleanSupervisor,
    message: `${cleanSupervisor} থেকে ${amount}টি লিমিট ভাড়া যুক্ত হয়েছে। মোট লিমিট এখন ${nextTotal}টি।`,
  };
}

export interface SupervisorLimitRental {
  id: string;
  date: string;
  time: string;
  studentCode: string;
  category: string;
  extraLimit: number;
  supervisorName: string;
}

export function buildRentLimitAuditDetail(
  studentCode: string,
  category: string,
  extraLimit: number,
  supervisorName: string
): string {
  const payload = {
    sid: studentCode.trim().slice(0, 40),
    cat: category.trim().slice(0, 80),
    qty: Math.max(1, Math.floor(extraLimit)),
    by: (supervisorName || 'Supervisor').trim().slice(0, 48) || 'Supervisor',
  };
  const json = JSON.stringify(payload);
  return json.length <= 250 ? json : json.slice(0, 250);
}

export function parseSupervisorLimitRentals(auditLogs: AuditLog[] = []): SupervisorLimitRental[] {
  const results: SupervisorLimitRental[] = [];
  for (const log of auditLogs) {
    if (log.action !== RENT_LIMIT_ACTION) continue;
    try {
      const parsed = JSON.parse(log.detail) as {
        sid?: unknown;
        cat?: unknown;
        qty?: unknown;
        by?: unknown;
      };
      const studentCode = String(parsed.sid ?? '').trim();
      const category = String(parsed.cat ?? '').trim();
      const extraLimit = Math.max(0, Number(parsed.qty) || 0);
      const supervisorName = String(parsed.by ?? 'Supervisor').trim() || 'Supervisor';
      if (studentCode && category && extraLimit > 0) {
        results.push({
          id: log.id,
          date: log.date,
          time: log.time,
          studentCode,
          category,
          extraLimit,
          supervisorName,
        });
      }
    } catch {
      // Ignore non-JSON audit entries
    }
  }
  return results;
}

export function getStudentCategoryRentedLimit(
  auditLogs: AuditLog[] = [],
  studentCode: string,
  category: string
): {
  rentedLimit: number;
  rentedBySupervisor: string;
  rentals: SupervisorLimitRental[];
} {
  const normSid = studentCode.trim().toLowerCase();
  const normCat = category.trim().toLowerCase();
  if (!normSid || !normCat) {
    return { rentedLimit: 0, rentedBySupervisor: '', rentals: [] };
  }

  const all = parseSupervisorLimitRentals(auditLogs).filter(
    (r) =>
      r.studentCode.trim().toLowerCase() === normSid &&
      r.category.trim().toLowerCase() === normCat
  );

  const rentedLimit = all.reduce((sum, r) => sum + r.extraLimit, 0);
  const uniqueSupervisors = Array.from(new Set(all.map((r) => r.supervisorName))).filter(Boolean);

  return {
    rentedLimit,
    rentedBySupervisor: uniqueSupervisors.join(', '),
    rentals: all,
  };
}

export const SET_DUE_DATE_ACTION = 'SET_DUE_DATE';

/**
 * তারিখ তুলনা করার সহায়ক ফাংশন (YYYY-MM-DD ফরম্যাটে)
 * রিটার্ন করে:
 *  -1 => আজকের তারিখ নির্ধারিত তারিখের আগে (এখনো সময় আছে)
 *   0 => আজই নির্ধারিত তারিখ
 *   1 => নির্ধারিত তারিখ পার হয়ে গেছে
 */
export function normalizeToYYYYMMDD(dateStr?: string): string {
  const raw = (dateStr || '').trim();
  if (!raw) return '';
  const parts = raw.split('-');
  if (parts.length !== 3) return '';
  // Support both YYYY-MM-DD and DD-MM-YYYY
  if (parts[0].length === 4) {
    return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
  }
  if (parts[2].length === 4) {
    return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
  }
  return '';
}

export function compareDateWithToday(targetDateStr?: string): -1 | 0 | 1 {
  const normalized = normalizeToYYYYMMDD(targetDateStr);
  if (!normalized) return 1;

  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const parts = normalized.split('-');
  if (parts.length !== 3) return 1;

  const y = Number(parts[0]);
  const m = Number(parts[1]) - 1;
  const d = Number(parts[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return 1;

  const targetMidnight = new Date(y, m, d);
  if (Number.isNaN(targetMidnight.getTime())) return 1;

  if (todayMidnight < targetMidnight) return -1;
  if (todayMidnight.getTime() === targetMidnight.getTime()) return 0;
  return 1;
}

export function defaultPromiseDateYYYYMMDD(daysAhead = 7): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${yyyy}-${mm}-${dd}`;
}

export function defaultPromiseDateDDMMYYYY(daysAhead = 7): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

export interface SetSupervisorDueDateResult {
  success: boolean;
  message: string;
  dueDate?: string;
  supervisorName?: string;
}

/**
 * সুপারভাইজার একবার বকেয়ার তারিখ সেট করলে ওই তারিখ শেষ না হওয়া পর্যন্ত
 * আর নতুন অনুমোদন চাইবে না।
 */
export function setSupervisorDueDate(
  newDueDate: string,
  supervisorName = 'সুপারভাইজার'
): SetSupervisorDueDateResult {
  const normalized = normalizeToYYYYMMDD(newDueDate);
  const status = compareDateWithToday(normalized);
  if (!normalized || status === 1) {
    return {
      success: false,
      message: 'অতীতের তারিখ দেওয়া যাবে না। আজকের বা ভবিষ্যতের তারিখ দিন।',
    };
  }

  const cleanSupervisor = (supervisorName || '').trim().slice(0, 48) || 'সুপারভাইজার';
  return {
    success: true,
    dueDate: normalized,
    supervisorName: cleanSupervisor,
    message: `${normalized} তারিখ পর্যন্ত বকেয়ায় জব এন্ট্রির অনুমোদন দেওয়া হয়েছে (${cleanSupervisor})। এই তারিখ পার না হওয়া পর্যন্ত আর অনুমোদন চাইবে না।`,
  };
}

export function buildDueDateAuditDetail(
  studentCode: string,
  dueDate: string,
  supervisorName: string
): string {
  const payload = {
    sid: studentCode.trim().slice(0, 40),
    dueDate: normalizeToYYYYMMDD(dueDate),
    by: (supervisorName || 'সুপারভাইজার').trim().slice(0, 48) || 'সুপারভাইজার',
    ts: Date.now(),
  };
  const json = JSON.stringify(payload);
  return json.length <= 250 ? json : json.slice(0, 250);
}

export interface StudentDueDateApproval {
  dueDate: string;
  approvedBySupervisor: string;
  dateStatus: -1 | 0 | 1;
  isGracePeriodActive: boolean;
}

export function getStudentDueDateApproval(
  auditLogs: AuditLog[] = [],
  studentCode: string
): StudentDueDateApproval {
  const normSid = studentCode.trim().toLowerCase();
  if (!normSid) {
    return {
      dueDate: '',
      approvedBySupervisor: '',
      dateStatus: 1,
      isGracePeriodActive: false,
    };
  }

  let latestTs = -1;
  let latestEntry: { dueDate: string; by: string } | null = null;

  auditLogs.forEach((log, idx) => {
    if (log.action !== SET_DUE_DATE_ACTION) return;
    try {
      const parsed = JSON.parse(log.detail) as {
        sid?: unknown;
        dueDate?: unknown;
        by?: unknown;
        ts?: unknown;
      };
      const sidVal = String(parsed.sid ?? '').trim().toLowerCase();
      const dueDate = normalizeToYYYYMMDD(String(parsed.dueDate ?? ''));
      const by = String(parsed.by ?? 'সুপারভাইজার').trim() || 'সুপারভাইজার';
      const ts = Number(parsed.ts) || idx;
      if (sidVal === normSid && dueDate && ts >= latestTs) {
        latestTs = ts;
        latestEntry = { dueDate, by };
      }
    } catch {
      // Ignore malformed audit entry
    }
  });

  if (!latestEntry) {
    return {
      dueDate: '',
      approvedBySupervisor: '',
      dateStatus: 1,
      isGracePeriodActive: false,
    };
  }

  const chosen = latestEntry as { dueDate: string; by: string };
  const dateStatus = compareDateWithToday(chosen.dueDate);
  return {
    dueDate: chosen.dueDate,
    approvedBySupervisor: chosen.by,
    dateStatus,
    isGracePeriodActive: Boolean(chosen.dueDate && dateStatus <= 0),
  };
}

export interface BalanceApprovalParams {
  currentBalance?: number;
  jobCost?: number;
  activeDueDate?: string;
  approvedBySupervisor?: string;
  supervisorApproved?: boolean;
  paymentPromiseDate?: string;
  supervisorName?: string;
}

export interface BalanceApprovalResult {
  allowed: boolean;
  isDueEntry: boolean;
  isGracePeriodActive: boolean;
  needSupervisorDueDate: boolean;
  remainingBalance: number;
  dueAmount: number;
  dueDate: string;
  approvedBySupervisor: string;
  uiAlertNote: string;
  tokenPaymentNote: string;
}

/**
 * ব্যালেন্স চেক এবং সুপারভাইজার অনুমোদনের (বকেয়া মেয়াদসহ) লজিক
 */
export function checkBalanceAndApproval({
  currentBalance = 0,
  jobCost = 0,
  activeDueDate = '',
  approvedBySupervisor = '',
  supervisorApproved = false,
  paymentPromiseDate = '',
  supervisorName = 'সুপারভাইজার',
}: BalanceApprovalParams): BalanceApprovalResult {
  const balance = Math.max(0, Number(currentBalance) || 0);
  const cost = Math.max(0, Number(jobCost) || 0);
  const hasEnoughBalance = balance >= cost;

  // ১. ব্যালেন্সে পর্যাপ্ত টাকা থাকলে স্বাভাবিক এন্ট্রি
  if (hasEnoughBalance) {
    return {
      allowed: true,
      isDueEntry: false,
      isGracePeriodActive: false,
      needSupervisorDueDate: false,
      remainingBalance: balance - cost,
      dueAmount: 0,
      dueDate: '',
      approvedBySupervisor: '',
      uiAlertNote: '',
      tokenPaymentNote: `পরিশোধিত (Paid: ${cost} ৳)`,
    };
  }

  // ২. ব্যালেন্সে টাকা না থাকলে বকেয়ার তারিখ চেক করুন
  const shortfall = cost - balance;
  const normalizedActiveDueDate = normalizeToYYYYMMDD(activeDueDate);
  const dateStatus = compareDateWithToday(normalizedActiveDueDate);
  const graceActive = Boolean(normalizedActiveDueDate && dateStatus <= 0);

  if (graceActive || supervisorApproved) {
    const effectiveDueDate = graceActive
      ? normalizedActiveDueDate
      : normalizeToYYYYMMDD(paymentPromiseDate) || (paymentPromiseDate || '').trim() || 'নির্ধারিত';
    const effectiveSup = graceActive
      ? (approvedBySupervisor || '').trim() || 'সুপারভাইজার'
      : (supervisorName || '').trim() || 'সুপারভাইজার';

    return {
      allowed: true,
      isDueEntry: true,
      isGracePeriodActive: true,
      needSupervisorDueDate: false,
      remainingBalance: 0,
      dueAmount: shortfall,
      dueDate: effectiveDueDate,
      approvedBySupervisor: effectiveSup,
      uiAlertNote: `✅ বকেয়া মেয়াদ (${effectiveDueDate} · অনুমোদন: ${effectiveSup}) সক্রিয় থাকায় জব এন্ট্রি করা যাবে। আর নতুন অনুমোদন লাগবে না।`,
      tokenPaymentNote: `জরুরি নোট: এই জবটি বকেয়ায় এন্ট্রি করা হয়েছে (বকেয়া: ${shortfall} ৳)। আগামী ${effectiveDueDate} তারিখের মধ্যে টাকা জমা দিতে হবে। (অনুমোদন: ${effectiveSup})`,
    };
  }

  return {
    allowed: false,
    isDueEntry: true,
    isGracePeriodActive: false,
    needSupervisorDueDate: true,
    remainingBalance: balance,
    dueAmount: shortfall,
    dueDate: normalizedActiveDueDate,
    approvedBySupervisor: (approvedBySupervisor || '').trim(),
    uiAlertNote: normalizedActiveDueDate
      ? `⚠️ নির্ধারিত বকেয়ার তারিখ (${normalizedActiveDueDate}) পার হয়ে গেছে এবং ব্যালেন্স নেই (অবশিষ্ট: ${balance} ৳, প্রয়োজন: ${cost} ৳)। নতুন জব এন্ট্রির জন্য সুপারভাইজারকে নতুন তারিখ দিতে হবে।`
      : `⚠️ ব্যালেন্স শেষ হয়ে গেছে (অবশিষ্ট: ${balance} ৳, প্রয়োজন: ${cost} ৳)। জব এন্ট্রি করতে সুপারভাইজার কবে টাকা জমা দিবে সেই তারিখ নির্ধারণ করুন।`,
    tokenPaymentNote: '',
  };
}

const DUE_NOTE_REGEX = /^\[DUE:(\d+(?:\.\d+)?)\|DATE:([^|\]]*)\|SUP:([^\]]*)\]\s*(.*)$/;

export function encodeDueJobNote(
  userNote: string,
  info: {
    isDueEntry: boolean;
    dueAmount: number;
    paymentPromiseDate?: string;
    supervisorName?: string;
  }
): string {
  const cleanUser = (userNote || '').trim();
  if (!info.isDueEntry || info.dueAmount <= 0) {
    return cleanUser.slice(0, 250);
  }
  const safeDate = (info.paymentPromiseDate || '').replace(/[|\]]/g, '').trim() || 'নির্ধারিত';
  const safeSup =
    (info.supervisorName || 'সুপারভাইজার').replace(/[|\]]/g, '').trim().slice(0, 40) ||
    'সুপারভাইজার';
  const prefix = `[DUE:${Math.round(info.dueAmount)}|DATE:${safeDate}|SUP:${safeSup}]`;
  const combined = cleanUser ? `${prefix} ${cleanUser}` : prefix;
  return combined.slice(0, 250);
}

export interface ParsedDueJobNote {
  isDueEntry: boolean;
  dueAmount: number;
  paymentPromiseDate: string;
  supervisorName: string;
  cleanNote: string;
  tokenPaymentNote: string;
}

export function parseDueJobNote(rawNote = '', fallbackPay = 0, fallbackPaid = 0): ParsedDueJobNote {
  const text = (rawNote || '').trim();
  const match = text.match(DUE_NOTE_REGEX);
  if (match) {
    const dueAmount = Math.max(0, Number(match[1]) || 0);
    const paymentPromiseDate = (match[2] || '').trim() || 'নির্ধারিত';
    const supervisorName = (match[3] || '').trim() || 'সুপারভাইজার';
    const cleanNote = (match[4] || '').trim();
    return {
      isDueEntry: true,
      dueAmount,
      paymentPromiseDate,
      supervisorName,
      cleanNote,
      tokenPaymentNote: `জরুরি নোট: এই জবটি বকেয়ায় এন্ট্রি করা হয়েছে (বকেয়া: ${dueAmount} ৳)। আগামী ${paymentPromiseDate} তারিখের মধ্যে টাকা জমা দিতে হবে। (অনুমোদন: ${supervisorName})`,
    };
  }

  const paid = Number(fallbackPaid || 0);
  const pay = Number(fallbackPay || 0);
  return {
    isDueEntry: false,
    dueAmount: 0,
    paymentPromiseDate: '',
    supervisorName: '',
    cleanNote: text,
    tokenPaymentNote: pay > 0 ? `পরিশোধিত (Paid: ${paid > 0 ? paid : pay} ৳)` : '',
  };
}

export function buildJobSlipFromEntry(job: JobEntry): SlipData {
  const parsed = parseDueJobNote(job.note, job.pay, job.paid);
  const std = Number(job.pay || 0) + Number(job.discount || 0);
  return {
    kind: 'job',
    date: job.date,
    no: job.no,
    name: job.sname,
    code: job.sid,
    cat: job.cat,
    amount: std > 0 ? std : Number(job.pay || 0),
    discount: job.discount,
    paid: job.paid,
    verificationMethod: job.verificationMethod,
    note: parsed.cleanNote,
    isDueEntry: parsed.isDueEntry,
    dueAmount: parsed.dueAmount,
    paymentPromiseDate: parsed.paymentPromiseDate,
    supervisorName: parsed.supervisorName,
    tokenPaymentNote: parsed.tokenPaymentNote,
  };
}

export const PROTECTED_DEFAULT_PRICE_COUNT = 19;

const CATEGORY_SPELLING_ALIASES: Record<string, string[]> = {
  '3g vartical': ['3g vertical'],
  '4g overhaed (arc)': ['4g overhead (arc)'],
  '4g overhaed tig': ['4g overhead tig'],
  'mig with chcramice': ['mig with ceramic'],
};

export function ensureDefaultJobPrices(
  existing: JobPrice[],
  defaults: Array<{ cat: string; price: number; limit: number }>,
  ownerId = 'local'
): JobPrice[] {
  const result = existing.map((item) => ({ ...item }));
  const idSet = new Set(result.map((p) => String(p.id || '').trim()));
  const exactCatSet = new Set(result.map((p) => String(p.cat || '').trim()));

  defaults.forEach((def, idx) => {
    const defaultId = `price_${idx + 1}`;
    const trimmedCat = def.cat.trim();
    const lowerCat = trimmedCat.toLowerCase();
    const aliases = CATEGORY_SPELLING_ALIASES[lowerCat] || [];

    const hasById = idSet.has(defaultId);
    const hasExactCat = exactCatSet.has(trimmedCat);
    const hasAlias =
      aliases.length > 0 &&
      result.some((p) => aliases.includes(String(p.cat || '').trim().toLowerCase()));

    if (!hasById && !hasExactCat && !hasAlias) {
      idSet.add(defaultId);
      exactCatSet.add(trimmedCat);
      result.push({
        id: defaultId,
        ownerId,
        cat: trimmedCat,
        price: def.price,
        limit: def.limit,
        active: true,
      });
    }
  });

  return sortJobPrices(result);
}

function getPriceSortTuple(p: JobPrice, originalIndex: number): [number, number, number] {
  const id = String(p.id || '');
  const defaultMatch = /^price_(\d+)$/.exec(id);
  if (defaultMatch) {
    return [0, Number(defaultMatch[1]), originalIndex];
  }
  const tsMatch = /^pri_([0-9a-zA-Z]+)_/.exec(id);
  if (tsMatch) {
    const ts = parseInt(tsMatch[1], 36);
    if (Number.isFinite(ts) && ts > 0) {
      return [1, ts, originalIndex];
    }
  }
  return [1, Number.MAX_SAFE_INTEGER, originalIndex];
}

export function sortJobPrices(prices: JobPrice[]): JobPrice[] {
  return prices
    .map((item, idx) => ({ item, idx, tuple: getPriceSortTuple(item, idx) }))
    .sort((a, b) => {
      if (a.tuple[0] !== b.tuple[0]) return a.tuple[0] - b.tuple[0];
      if (a.tuple[1] !== b.tuple[1]) return a.tuple[1] - b.tuple[1];
      return a.tuple[2] - b.tuple[2];
    })
    .map((entry) => entry.item);
}

export function isProtectedDefaultPrice(price: JobPrice, sortedIndex: number): boolean {
  if (sortedIndex >= 0 && sortedIndex < PROTECTED_DEFAULT_PRICE_COUNT) {
    return true;
  }
  const match = /^price_(\d+)$/.exec(String(price.id || ''));
  if (match) {
    const num = Number(match[1]);
    if (num >= 1 && num <= PROTECTED_DEFAULT_PRICE_COUNT) {
      return true;
    }
  }
  return false;
}

export interface StudentJobBalanceSummary {
  totalJobsCost: number;
  returnedRefund: number;
  netJobsCost: number;
  jobBalance: number;
  returnedJobNos: Set<string>;
  refundByJobNo: Map<string, number>;
}

/**
 * ছাত্রের মোট জব খরচ, রিটার্ন হওয়া জবের ফেরত টাকা এবং বর্তমান জব ব্যালান্স হিসাব করে।
 * জব রিটার্ন হলে সেই জবের টাকা সাথে সাথে ছাত্রের প্রোফাইল ব্যালান্সে যোগ হয়।
 */
export function computeStudentJobBalanceSummary({
  studentCode,
  studentName = '',
  deposit = 0,
  jobs = [],
  returns = [],
}: {
  studentCode: string;
  studentName?: string;
  deposit?: number | string;
  jobs?: JobEntry[];
  returns?: JobReturn[];
}): StudentJobBalanceSummary {
  const normCode = (studentCode || '').trim().toLowerCase();
  const normName = (studentName || '').trim().toLowerCase();

  const stuJobs = jobs.filter((j) => (j.sid || '').trim().toLowerCase() === normCode);
  const stuJobNos = new Set(
    stuJobs.map((j) => (j.no || '').trim().toLowerCase()).filter(Boolean)
  );

  const returnByJobNo = new Map<string, JobReturn>();
  for (const r of returns) {
    const rNo = (r.no || '').trim().toLowerCase();
    if (!rNo) continue;
    const rCode = (r.code || '').trim().toLowerCase();
    const rName = (r.sname || '').trim().toLowerCase();
    const belongsToStudent =
      (normCode && rCode === normCode) ||
      (normName && rName === normName) ||
      stuJobNos.has(rNo);
    if (!belongsToStudent) continue;
    returnByJobNo.set(rNo, r);
  }

  let totalJobsCost = 0;
  let returnedRefund = 0;
  const returnedJobNos = new Set<string>();
  const refundByJobNo = new Map<string, number>();

  for (const j of stuJobs) {
    const pay = Math.max(0, Number(j.pay || 0));
    totalJobsCost += pay;
    const jNo = (j.no || '').trim().toLowerCase();
    if (!jNo) continue;
    const ret = returnByJobNo.get(jNo);
    if (ret && !returnedJobNos.has(jNo)) {
      const fee = Math.max(0, Number(ret.fee || 0));
      const refund = Math.max(0, pay - fee);
      returnedJobNos.add(jNo);
      refundByJobNo.set(jNo, refund);
      returnedRefund += refund;
    }
  }

  const netJobsCost = Math.max(0, totalJobsCost - returnedRefund);
  const jobBalance = Math.max(0, (Number(deposit) || 0) - netJobsCost);

  return {
    totalJobsCost,
    returnedRefund,
    netJobsCost,
    jobBalance,
    returnedJobNos,
    refundByJobNo,
  };
}

export function getNextDailyJobSeq(
  jobs: Array<{ date?: string; no?: string }>,
  formattedDate: string,
  compactPrefix = ''
): number {
  let countForDate = 0;
  let maxSeq = 0;
  for (const j of jobs) {
    const jDate = String(j?.date || '').trim();
    const jNo = String(j?.no || '').trim();
    const matchesDate = Boolean(formattedDate && jDate === formattedDate);
    const matchesPrefix = Boolean(compactPrefix && jNo.startsWith(`${compactPrefix}-`));
    if (matchesDate) countForDate += 1;
    if (matchesDate || matchesPrefix) {
      const m = /-(\d+)$/.exec(jNo);
      if (m) {
        const n = Number(m[1]);
        if (Number.isFinite(n) && n > maxSeq) maxSeq = n;
      }
    }
  }
  return Math.max(countForDate, maxSeq) + 1;
}


