import { convertBijoyToUnicode } from './bijoyToUnicode';
import type { GeneralAccountRow } from '../types';

export type EntryMode = 'income' | 'expense' | 'bank';
export type AccountKind = 'Cash' | 'Bank' | 'Bkash';
export type OfficialKey = 'md' | 'dir' | 'gm';

export interface ParsedTxRow {
  raw: GeneralAccountRow;
  date: string;
  dateKey: string;
  voucher: string;
  khataNo: string;
  account: AccountKind;
  incSrc: string;
  incCash: number;
  incBank: number;
  expSrc: string;
  expAmt: number;
}

export interface OpeningInfo {
  rowId?: string;
  prevDate: string;
  cash: number;
  bank: number;
  bkash: number;
  isManual: boolean;
}

export interface DaySummary {
  opening: OpeningInfo;
  dayRows: ParsedTxRow[];
  newCashIn: number;
  newBankBkashIn: number;
  totalCash: number;
  totalBank: number;
  totalExp: number;
  cashBalance: number;
  grandTotal: number;
}

export interface OfficialProfileMeta {
  key: OfficialKey;
  role: string;
  roleBn: string;
  nameEn: string;
  nameBn: string;
  accentHex: string;
  textClass: string;
  badgeClass: string;
  borderActiveClass: string;
}

export const OFFICIAL_PROFILES: Record<OfficialKey, OfficialProfileMeta> = {
  md: {
    key: 'md',
    role: 'MANAGING DIRECTOR',
    roleBn: 'ব্যবস্থাপনা পরিচালক',
    nameEn: 'SABUJ KAZI',
    nameBn: 'সবুজ কাজী',
    accentHex: '#f97316',
    textClass: 'text-[#f97316]',
    badgeClass: 'text-[#f97316] bg-[#f97316]/15 border-[#f97316]/50',
    borderActiveClass: 'border-[#f97316] ring-1 ring-[#f97316]/50',
  },
  dir: {
    key: 'dir',
    role: 'DIRECTOR',
    roleBn: 'পরিচালক',
    nameEn: 'SOHEL KAZI',
    nameBn: 'সোহেল কাজী',
    accentHex: '#60a5fa',
    textClass: 'text-[#60a5fa]',
    badgeClass: 'text-[#60a5fa] bg-[#60a5fa]/15 border-[#60a5fa]/50',
    borderActiveClass: 'border-[#60a5fa] ring-1 ring-[#60a5fa]/50',
  },
  gm: {
    key: 'gm',
    role: 'GENERAL MANAGER',
    roleBn: 'জেনারেল ম্যানেজার',
    nameEn: 'SALIM MAHMMUD',
    nameBn: 'সেলিম মাহমুদ',
    accentHex: '#a78bfa',
    textClass: 'text-[#a78bfa]',
    badgeClass: 'text-[#a78bfa] bg-[#a78bfa]/15 border-[#a78bfa]/50',
    borderActiveClass: 'border-[#a78bfa] ring-1 ring-[#a78bfa]/50',
  },
};

export const OFFICIAL_KEYS_ORDER: OfficialKey[] = ['md', 'dir', 'gm'];

export const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
export const BN_DAYS = [
  'রবিবার',
  'সোমবার',
  'মঙ্গলবার',
  'বুধবার',
  'বৃহস্পতিবার',
  'শুক্রবার',
  'শনিবার',
];
export const BN_MONTHS = [
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
export const BN_WEEKDAYS_SHORT = ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহঃ', 'শুক্র', 'শনি'];

export const PURPOSE_OPTIONS = ['Welding Job Fee', 'Fitter Fee', 'Visa Fee', 'P.P.E'];
export const PURPOSE_DISPLAY_MAP: Record<string, string> = {
  'Welding Job Fee': 'Welding Fee',
  'Fitter Fee': 'Fitter Fee',
  'Visa Fee': 'Visa Fee',
  'P.P.E': 'P.P.E',
};

export const DAY_LOCK_MARKER = '__DAY_LOCKED__';

export function bnToEn(str: unknown): string {
  return String(str ?? '')
    .replace(/[−–—]/g, '-')
    .replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)))
    .replace(/[^\d.-]/g, '');
}

export function enToBn(num: number | string | null | undefined): string {
  if (num === '' || num === null || num === undefined) return '';
  const n = typeof num === 'number' ? num : Number(bnToEn(num));
  if (!Number.isFinite(n)) return '';
  return String(Math.round(n)).replace(/\d/g, (d) => BN_DIGITS[Number(d)] ?? d);
}

export function toBnDigitsString(str: string): string {
  return String(str ?? '').replace(/\d/g, (d) => BN_DIGITS[Number(d)] ?? d);
}

export function normalizeDigitsOnly(str: string): string {
  return String(str ?? '').replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
}

export function parseAccountNum(val: unknown): number {
  const n = parseFloat(bnToEn(val));
  return Number.isFinite(n) ? n : 0;
}

export function parseRowDateParts(raw: string): { day: number; month: number; year: number } | null {
  const cleaned = normalizeDigitsOnly(String(raw ?? '').trim());
  if (!cleaned) return null;
  const parts = cleaned.split(/[.\-/]/).filter(Boolean);
  if (parts.length !== 3) return null;
  let day = 0;
  let month = 0;
  let year = 0;
  if (parts[0].length === 4) {
    year = Number(parts[0]);
    month = Number(parts[1]);
    day = Number(parts[2]);
  } else {
    day = Number(parts[0]);
    month = Number(parts[1]);
    year = Number(parts[2]);
    if (year > 0 && year < 100) year += 2000;
  }
  if (
    !Number.isInteger(day) ||
    !Number.isInteger(month) ||
    !Number.isInteger(year) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    year < 1900 ||
    year > 2200
  ) {
    return null;
  }
  return { day, month, year };
}

export function parseDotDate(dotStr: string): Date | null {
  const p = parseRowDateParts(dotStr);
  if (!p) return null;
  const dt = new Date(p.year, p.month - 1, p.day);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export function formatEnDotDate(dt: Date): string {
  const d = String(dt.getDate()).padStart(2, '0');
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const y = dt.getFullYear();
  return `${d}.${m}.${y}`;
}

export function normalizeToDotDate(raw: string, fallbackDotDate: string): string {
  const p = parseRowDateParts(raw);
  if (!p) return fallbackDotDate;
  return `${String(p.day).padStart(2, '0')}.${String(p.month).padStart(2, '0')}.${p.year}`;
}

export function formatBnDotDate(day: number, month: number, year: number): string {
  const dd = String(day).padStart(2, '0');
  const mm = String(month).padStart(2, '0');
  return toBnDigitsString(`${dd}.${mm}.${year}`);
}

export function canonicalDateKey(raw: string): string {
  const p = parseRowDateParts(raw);
  if (!p) return normalizeDigitsOnly(String(raw ?? '').trim());
  const mm = String(p.month).padStart(2, '0');
  const dd = String(p.day).padStart(2, '0');
  return `${p.year}-${mm}-${dd}`;
}

export function getDayNameFromDot(dotStr: string): string {
  const dt = parseDotDate(dotStr);
  return dt ? BN_DAYS[dt.getDay()] : 'রবিবার';
}

export function getPrevDotDate(dotStr: string): string {
  const dt = parseDotDate(dotStr);
  if (!dt) return '21.11.2026';
  dt.setDate(dt.getDate() - 1);
  return formatEnDotDate(dt);
}

export function getNextDotDate(dotStr: string): string {
  const dt = parseDotDate(dotStr);
  if (!dt) return '23.11.2026';
  dt.setDate(dt.getDate() + 1);
  return formatEnDotDate(dt);
}

export function cleanDisplayPurpose(src: string): string {
  return (src || '')
    .replace(/^For The Purpose Of\s+/i, '')
    .replace(/\bWelding Job Fee\b/gi, 'Welding Fee')
    .trim();
}

export interface OfficialExpenseMatch {
  key: OfficialKey;
  role: string;
  nameEn: string;
  nameBn: string;
  note: string;
}

export function classifyOfficialExpense(rawExpSrc: string): OfficialExpenseMatch | null {
  const expText = (rawExpSrc || '').normalize('NFC').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  if (!expText) return null;
  if (/(?:sabuj|sobuj|সবুজ)/i.test(expText)) {
    const note =
      expText
        .replace(/(?:sabuj\s*kazi|sabuj\s*bhai|সবুজ\s*কাজী|সবুজ\s*ভাই|সবুজ)/gi, '')
        .replace(/^[\s\-–:]+/, '')
        .trim() || 'খরচ';
    return {
      key: 'md',
      role: 'MANAGING DIRECTOR',
      nameEn: 'SABUJ KAZI',
      nameBn: 'সবুজ কাজী',
      note,
    };
  }
  if (/(?:sohel|suhel|সোহেল|সহেল)/i.test(expText)) {
    const note =
      expText
        .replace(/(?:sohel\s*kazi|sohel\s*bhai|সোহেল\s*কাজী|সোহেল\s*ভাই|সহেল\s*ভাই|সোহেল)/gi, '')
        .replace(/^[\s\-–:]+/, '')
        .trim() || 'খরচ';
    return {
      key: 'dir',
      role: 'DIRECTOR',
      nameEn: 'SOHEL KAZI',
      nameBn: 'সোহেল কাজী',
      note,
    };
  }
  if (/(?:salim|selim|সেলিম|সেলীম|সালিম|সালীম|সলিম)/i.test(expText)) {
    const note =
      expText
        .replace(
          /(?:salim\s*mahmmud|salim\s*mahmud|selim\s*mahmmud|selim\s*mahmud|salim\s*bhai|selim\s*bhai|সেলিম\s*মাহমুদ|সেলিম\s*ভাই|সালিম\s*ভাই|সেলিম|সালিম|সলিম)/gi,
          ''
        )
        .replace(/^[\s\-–:]+/, '')
        .trim() || 'খরচ';
    return {
      key: 'gm',
      role: 'GENERAL MANAGER',
      nameEn: 'SALIM MAHMMUD',
      nameBn: 'সেলিম মাহমুদ',
      note,
    };
  }
  return null;
}

export function serializeInDesc(
  voucher: string,
  incSrc: string,
  account: AccountKind,
  khataNo = ''
): string {
  const s = cleanDisplayPurpose(incSrc);
  const k = khataNo.trim();
  const v = voucher.trim();
  const kPart = k ? `${s ? ' - ' : ''}${k}` : '';
  const vPart = v ? `${s || k ? ' ' : ''}(${v})` : '';
  const base = `${s}${kPart}${vPart}`.trim();
  if (!base && account === 'Cash') return '';
  if (account === 'Bkash') {
    return `${base}${base ? ' ' : ''}(Bkash)`.slice(0, 195);
  }
  return base.slice(0, 195);
}

export function formatIncDisplay(row: ParsedTxRow): string {
  let sPart = cleanDisplayPurpose(row.incSrc);
  if (row.khataNo) {
    const legacyOrder = sPart.match(
      /^((?:Welding|Fitter|Visa|P\.P\.E|অপারেশন|যাতায়াত)[^-]*?)\s+-\s+(.+)$/i
    );
    if (legacyOrder) {
      sPart = `${legacyOrder[2].trim()}-${legacyOrder[1].trim()}`;
    }
  }
  const kPart = row.khataNo ? `${sPart ? ' - ' : ''}${row.khataNo}` : '';
  const vPart = row.voucher ? `${sPart || row.khataNo ? ' ' : ''}(${row.voucher})` : '';
  return `${sPart}${kPart}${vPart}`.trim();
}

export function parseTxRow(r: GeneralAccountRow): ParsedTxRow {
  let text = convertBijoyToUnicode((r.inDesc || '').trim(), false);
  const expText = convertBijoyToUnicode((r.outDesc || '').trim(), false);
  let voucher = '';
  let khataNo = '';
  let account: AccountKind = 'Cash';

  const accMatch = text.match(/^(.*?)\s*\((Cash|Bank|Bkash)\)\s*$/i);
  if (accMatch) {
    text = accMatch[1].trim();
    const rawAcc = accMatch[2].toLowerCase();
    account = rawAcc === 'bank' ? 'Bank' : rawAcc === 'bkash' ? 'Bkash' : 'Cash';
  } else {
    const outUp = (r.outDesc || '').toUpperCase();
    if (outUp.includes('[BKASH]') || outUp.startsWith('BKASH')) account = 'Bkash';
    else if (outUp.includes('[BANK]') || parseAccountNum(r.inBank) !== 0) account = 'Bank';
  }

  const vMatch = text.match(/^\[([^\]]+)\]\s*(.*)$/);
  if (vMatch) {
    const firstTag = vMatch[1].trim();
    const khataFirstMatch = firstTag.match(/^(?:খাতা|Khata)\s*:\s*(.+)$/i);
    if (khataFirstMatch) {
      khataNo = khataFirstMatch[1].trim();
    } else {
      voucher = firstTag;
    }
    text = vMatch[2].trim();
  }

  const kMatch =
    text.match(/^\[(?:খাতা|Khata)\s*:\s*([^\]]+)\]\s*(.*)$/i) ||
    text.match(/^\{(?:খাতা|Khata)\s*:\s*([^}]+)\}\s*(.*)$/i);
  if (kMatch) {
    khataNo = kMatch[1].trim();
    text = kMatch[2].trim();
  }

  if (!khataNo) {
    const legacyKhataLead = text.match(/^\((\d+(?:[\/-]\d+)*)\)\s+(.+)$/);
    if (legacyKhataLead) {
      khataNo = legacyKhataLead[1].trim();
      text = legacyKhataLead[2].trim();
    }
  }

  if (!voucher && khataNo) {
    const legacyVoucherLead = text.match(
      /^((?:ME\.NO-|V-)\d+[A-Za-z0-9.\-/]*|\d{3,8})\s+(.*)$/i
    );
    if (legacyVoucherLead) {
      voucher = legacyVoucherLead[1].trim();
      text = legacyVoucherLead[2].trim();
    }
  }

  if (!voucher) {
    const endVoucherMatch = text.match(
      /^(.*?)\s*\(((?:ME\.NO-|V-)?\d+[A-Za-z0-9.\-/]*)\)\s*$/i
    );
    if (endVoucherMatch) {
      text = endVoucherMatch[1].trim();
      voucher = endVoucherMatch[2].trim();
    } else {
      const soloEndVoucher = text.match(/^\(((?:ME\.NO-|V-)?\d+[A-Za-z0-9.\-/]*)\)$/i);
      if (soloEndVoucher) {
        voucher = soloEndVoucher[1].trim();
        text = '';
      }
    }
  }

  if (!khataNo) {
    const endKhataMatch = text.match(/^(.+?)\s+-\s+(\d+(?:[\/-]\d+)*)\s*$/);
    if (endKhataMatch) {
      text = endKhataMatch[1].trim();
      khataNo = endKhataMatch[2].trim();
    } else {
      const soloKhata = text.match(/^(\d+(?:[\/-]\d+)*)$/);
      if (soloKhata) {
        khataNo = soloKhata[1].trim();
        text = '';
      }
    }
  }

  const normalizedDate = (() => {
    const p = parseRowDateParts(r.date);
    if (!p) return (r.date || '').trim();
    return `${String(p.day).padStart(2, '0')}.${String(p.month).padStart(2, '0')}.${p.year}`;
  })();

  const rawIncBank = parseAccountNum(r.inBank);
  const rawExpAmt = parseAccountNum(r.outCash);
  const isBankExpenseNegative =
    rawExpAmt < 0 &&
    (account === 'Bank' ||
      account === 'Bkash' ||
      /(?:\[?(?:bank|bkash)\]?|ব্যাংক|বিকাশ)/i.test(expText));

  const cleanExpText = expText.replace(/^\[(?:Cash|Bank|Bkash)\]\s*/gi, '').trim();

  return {
    raw: r,
    date: normalizedDate,
    dateKey: canonicalDateKey(r.date || ''),
    voucher,
    khataNo,
    account,
    incSrc: text,
    incCash: parseAccountNum(r.inCash),
    incBank: isBankExpenseNegative ? rawIncBank + rawExpAmt : rawIncBank,
    expSrc: cleanExpText,
    expAmt: isBankExpenseNegative ? 0 : rawExpAmt,
  };
}

export function isDemoAccountRow(r: GeneralAccountRow): boolean {
  return typeof r.id === 'string' && r.id.startsWith('ga_sample_');
}

function isPureOpeningLabelText(raw: string): boolean {
  const cleaned = convertBijoyToUnicode((raw || '').trim(), false)
    .normalize('NFC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .toLowerCase();
  if (!cleaned) return false;
  return /^(?:পূর্বের\s*(?:ব্যালেন্স|ব্যালেত্র|ব্যালেঞ্চ|জের)|opening\s*balance|previous\s*balance)\s*[:=\-–]*$/i.test(
    cleaned
  );
}

export function isMisimportedOpeningTxRow(r: GeneralAccountRow): boolean {
  if (r.isOpening || r.inDesc === DAY_LOCK_MARKER) return false;
  const inText = convertBijoyToUnicode((r.inDesc || '').trim(), false).trim();
  const outText = convertBijoyToUnicode((r.outDesc || '').trim(), false).trim();
  const inIsOpen = isPureOpeningLabelText(inText);
  const outIsOpen = isPureOpeningLabelText(outText);
  if (inIsOpen && (!outText || outIsOpen)) return true;
  if (!inText && outIsOpen) return true;
  return false;
}

export function buildGeneralAccountsLedger(
  rows: GeneralAccountRow[],
  fallbackDotDate: string
) {
  const txRows: ParsedTxRow[] = [];
  const openingRows: GeneralAccountRow[] = [];
  const lockedDateKeys = new Map<string, GeneralAccountRow>();

  rows.forEach((r) => {
    if (r.inDesc === DAY_LOCK_MARKER) {
      lockedDateKeys.set(canonicalDateKey(r.date || ''), r);
    } else if (r.isOpening) {
      openingRows.push(r);
    } else if (!isMisimportedOpeningTxRow(r)) {
      txRows.push(parseTxRow(r));
    }
  });

  // Detect latest date
  let latestDate = fallbackDotDate;
  const nonBlankTx = txRows.filter((t) => t.date);
  if (nonBlankTx.length > 0) {
    const sortedDates = [...new Set(nonBlankTx.map((t) => t.date))].sort((a, b) =>
      canonicalDateKey(a).localeCompare(canonicalDateKey(b))
    );
    if (sortedDates.length > 0) {
      latestDate = sortedDates[sortedDates.length - 1];
    }
  } else if (openingRows.length > 0) {
    const firstOpen = openingRows[0];
    latestDate = parseRowDateParts(firstOpen.outDesc || '')
      ? (firstOpen.outDesc || '').trim()
      : getNextDotDate(firstOpen.date || fallbackDotDate);
  }

  // Unique dates sorted chronologically
  const dateSet = new Set<string>();
  const dateMap = new Map<string, string>();
  const addDate = (d: string) => {
    const key = canonicalDateKey(d);
    if (key && !dateSet.has(key)) {
      dateSet.add(key);
      const p = parseRowDateParts(d);
      dateMap.set(
        key,
        p
          ? `${String(p.day).padStart(2, '0')}.${String(p.month).padStart(2, '0')}.${p.year}`
          : d
      );
    }
  };
  txRows.forEach((r) => {
    if (r.date) addDate(r.date);
  });
  const uniqueDates = [...dateSet].sort().map((k) => dateMap.get(k) || k);

  // Sort openingRows deterministically (rowOrder, createdAt, id) so manual overrides never depend on snapshot arrival order
  const sortedOpeningRows = [...openingRows].sort((a, b) => {
    const oa = typeof a.rowOrder === 'number' ? a.rowOrder : 0;
    const ob = typeof b.rowOrder === 'number' ? b.rowOrder : 0;
    if (oa !== ob) return oa - ob;
    const ca = String((a as { createdAt?: unknown }).createdAt ?? '');
    const cb = String((b as { createdAt?: unknown }).createdAt ?? '');
    if (ca !== cb) return ca.localeCompare(cb);
    return String(a.id || '').localeCompare(String(b.id || ''));
  });

  // Manual opening map
  const manualOpeningMap = new Map<string, OpeningInfo>();
  sortedOpeningRows.forEach((r) => {
    const rawTarget = (r.outDesc || '').trim();
    const targetStr = parseRowDateParts(rawTarget)
      ? normalizeToDotDate(rawTarget, fallbackDotDate)
      : getNextDotDate(r.date || fallbackDotDate);
    const targetKey = canonicalDateKey(targetStr);
    if (!targetKey) return;
    const prevParts = parseRowDateParts(r.date || '');
    const prevDate = prevParts
      ? `${String(prevParts.day).padStart(2, '0')}.${String(prevParts.month).padStart(2, '0')}.${prevParts.year}`
      : r.date || getPrevDotDate(targetStr);
    manualOpeningMap.set(targetKey, {
      rowId: r.id,
      prevDate,
      cash: parseAccountNum(r.inCash),
      bank: parseAccountNum(r.inBank),
      bkash: parseAccountNum(r.outCash),
      isManual: true,
    });
  });

  const txByDate = new Map<string, ParsedTxRow[]>();
  txRows.forEach((r) => {
    if (!r.dateKey) return;
    const list = txByDate.get(r.dateKey) || [];
    list.push(r);
    txByDate.set(r.dateKey, list);
  });

  const dotFromKey = (k: string): string => {
    const m = k.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}.${m[2]}.${m[1]}` : k;
  };

  const buildDayFromOpening = (opening: OpeningInfo, dayRows: ParsedTxRow[]): DaySummary => {
    let newCashIn = 0;
    let newBankBkashIn = 0;
    let totalExp = 0;

    dayRows.forEach((r) => {
      newCashIn += r.incCash;
      newBankBkashIn += r.incBank;
      totalExp += r.expAmt;
    });

    const totalCash = opening.cash + newCashIn;
    const totalBank = opening.bank + opening.bkash + newBankBkashIn;
    const cashBalance = totalCash - totalExp;
    const grandTotal = cashBalance + totalBank;

    return {
      opening,
      dayRows,
      newCashIn,
      newBankBkashIn,
      totalCash,
      totalBank,
      totalExp,
      cashBalance,
      grandTotal,
    };
  };

  // Chronological carry-forward across all active dates (no depth cap, gap-day safe):
  // Any day's closing নগদ ব্যালেন্স (cashBalance) & ব্যাংক ব্যালেন্স (totalBank) carry forward
  // as the next day's পূর্বের ব্যালেন্স (opening).
  const allActiveKeys = [
    ...new Set<string>([...txByDate.keys(), ...manualOpeningMap.keys()]),
  ]
    .filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k))
    .sort();

  const computedByKey = new Map<string, DaySummary>();
  for (let i = 0; i < allActiveKeys.length; i++) {
    const k = allActiveKeys[i];
    const manual = manualOpeningMap.get(k);
    let opening: OpeningInfo;
    if (manual) {
      opening = manual;
    } else if (i > 0) {
      const prevKey = allActiveKeys[i - 1];
      const prevSum = computedByKey.get(prevKey)!;
      opening = {
        prevDate: dotFromKey(prevKey),
        cash: prevSum.cashBalance,
        bank: prevSum.totalBank,
        bkash: 0,
        isManual: false,
      };
    } else {
      opening = {
        prevDate: getPrevDotDate(dotFromKey(k)),
        cash: 0,
        bank: 0,
        bkash: 0,
        isManual: false,
      };
    }
    computedByKey.set(k, buildDayFromOpening(opening, txByDate.get(k) || []));
  }

  const getDaySummary = (dotDate: string): DaySummary => {
    const normalizedDot = normalizeToDotDate(dotDate, fallbackDotDate);
    const key = canonicalDateKey(normalizedDot);
    const cached = computedByKey.get(key);
    if (cached) return cached;

    let priorKey = '';
    for (let i = allActiveKeys.length - 1; i >= 0; i--) {
      if (allActiveKeys[i] < key) {
        priorKey = allActiveKeys[i];
        break;
      }
    }

    const opening: OpeningInfo = priorKey
      ? {
          prevDate: dotFromKey(priorKey),
          cash: computedByKey.get(priorKey)!.cashBalance,
          bank: computedByKey.get(priorKey)!.totalBank,
          bkash: 0,
          isManual: false,
        }
      : {
          prevDate: getPrevDotDate(normalizedDot),
          cash: 0,
          bank: 0,
          bkash: 0,
          isManual: false,
        };

    return buildDayFromOpening(opening, txByDate.get(key) || []);
  };

  const hasPriorDataForDate = (dotDate: string): boolean => {
    const key = canonicalDateKey(normalizeToDotDate(dotDate, fallbackDotDate));
    return allActiveKeys.some((k) => k < key);
  };

  let maxVoucherNum = 4598;
  txRows.forEach((r) => {
    const m = (r.voucher || '').match(/(\d+)$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxVoucherNum) maxVoucherNum = n;
    }
  });
  const suggestedVoucher = `ME.NO-${maxVoucherNum + 1}`;

  const getOfficialSummary = (key: OfficialKey) => {
    let total = 0;
    let count = 0;
    const dayKeys = new Set<string>();
    const entries: Array<{ id: string; date: string; note: string; amount: number; account: AccountKind }> = [];
    txRows.forEach((r) => {
      const expText = r.expSrc.normalize('NFC').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
      const expVal = r.expAmt > 0 ? r.expAmt : r.incBank < 0 && expText ? Math.abs(r.incBank) : 0;
      if (expVal <= 0 || !expText) return;
      const official = classifyOfficialExpense(expText);
      if (!official || official.key !== key) return;
      total += expVal;
      count += 1;
      if (r.dateKey) dayKeys.add(r.dateKey);
      entries.push({
        id: r.raw.id,
        date: r.date,
        note: official.note,
        amount: expVal,
        account: r.account,
      });
    });
    return { total, count, uniqueDaysCount: dayKeys.size, entries };
  };

  const getMonthlySummary = (year: number, month: number, dayFrom = 1, dayTo = 31) => {
    const minDay = Math.min(dayFrom, dayTo);
    const maxDay = Math.max(dayFrom, dayTo);
    let mdTotal = 0;
    let dirTotal = 0;
    let gmTotal = 0;
    let mdCount = 0;
    let dirCount = 0;
    let gmCount = 0;
    let otherExpTotal = 0;
    let allExpTotal = 0;
    let totalCashIn = 0;
    let totalBankIn = 0;

    txRows.forEach((r) => {
      const p = parseRowDateParts(r.date);
      if (!p || p.year !== year || p.month !== month || p.day < minDay || p.day > maxDay) return;
      totalCashIn += r.incCash;
      totalBankIn += r.incBank > 0 ? r.incBank : 0;
      const expText = r.expSrc.normalize('NFC').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
      const expVal = r.expAmt > 0 ? r.expAmt : r.incBank < 0 && expText ? Math.abs(r.incBank) : 0;
      if (expVal <= 0) return;
      allExpTotal += expVal;
      const official = classifyOfficialExpense(expText);
      if (official?.key === 'md') {
        mdTotal += expVal;
        mdCount += 1;
      } else if (official?.key === 'dir') {
        dirTotal += expVal;
        dirCount += 1;
      } else if (official?.key === 'gm') {
        gmTotal += expVal;
        gmCount += 1;
      } else {
        otherExpTotal += expVal;
      }
    });

    return {
      year,
      month,
      minDay,
      maxDay,
      mdTotal,
      dirTotal,
      gmTotal,
      mdCount,
      dirCount,
      gmCount,
      officialsTotal: mdTotal + dirTotal + gmTotal,
      otherExpTotal,
      allExpTotal,
      totalCashIn,
      totalBankIn,
    };
  };

  return {
    txRows,
    openingRows,
    manualOpeningMap,
    lockedDateKeys,
    uniqueDates,
    latestDate,
    suggestedVoucher,
    getDaySummary,
    hasPriorDataForDate,
    getOfficialSummary,
    getMonthlySummary,
  };
}

export type PurposeCategoryKey = 'welding' | 'fitter' | 'visa' | 'ppe';

export interface PurposeCategoryMeta {
  key: PurposeCategoryKey;
  titleBn: string;
  subtitle: string;
  textClass: string;
  borderClass: string;
  badgeClass: string;
}

export const PURPOSE_CATEGORY_CARDS: PurposeCategoryMeta[] = [
  {
    key: 'welding',
    titleBn: '১. Welding Job Fee জমা',
    subtitle: 'For The Purpose Of Welding Job Fee',
    textClass: 'text-[#60a5fa]',
    borderClass: 'border-[#3b82f6]',
    badgeClass: 'bg-[#3b82f6]/15 text-[#93c5fd] border-[#3b82f6]/40',
  },
  {
    key: 'fitter',
    titleBn: '২. Fitter Fee জমা',
    subtitle: 'For The Purpose Of Fitter Fee',
    textClass: 'text-[#a78bfa]',
    borderClass: 'border-[#8b5cf6]',
    badgeClass: 'bg-[#8b5cf6]/15 text-[#c4b5fd] border-[#8b5cf6]/40',
  },
  {
    key: 'visa',
    titleBn: '৩. Visa Fee জমা',
    subtitle: 'For The Purpose Of Visa Fee',
    textClass: 'text-[#fb923c]',
    borderClass: 'border-[#f97316]',
    badgeClass: 'bg-[#f97316]/15 text-[#fdba74] border-[#f97316]/40',
  },
  {
    key: 'ppe',
    titleBn: '৪. P.P.E জমা',
    subtitle: 'For The Purpose Of P.P.E',
    textClass: 'text-[#34d399]',
    borderClass: 'border-[#10b981]',
    badgeClass: 'bg-[#10b981]/15 text-[#6ee7b7] border-[#10b981]/40',
  },
];

export function matchPurposeCategory(incSrc: string, key: PurposeCategoryKey): boolean {
  const t = (incSrc || '').toLowerCase();
  if (!t) return false;
  if (key === 'welding') {
    return (
      t.includes('welding') ||
      t.includes('জব ফি') ||
      t.includes('ওয়েল্ডিং') ||
      t.includes('ওয়েল্ডিং')
    );
  }
  if (key === 'fitter') {
    return t.includes('fitter') || t.includes('pipe') || t.includes('ফিটার');
  }
  if (key === 'visa') {
    return t.includes('visa') || t.includes('ভিসা');
  }
  return (
    t.includes('p.p.e') ||
    t.includes('ppe') ||
    t.includes('pp ') ||
    t.includes('পিপিই')
  );
}

