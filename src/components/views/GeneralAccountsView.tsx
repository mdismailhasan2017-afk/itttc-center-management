import ExcelJS from 'exceljs';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  FileSpreadsheet,
  LayoutDashboard,
  Lock,
  Plus,
  Printer,
  Search,
  Trash2,
  Unlock,
  Upload,
  User,
  X,
} from 'lucide-react';
import { downloadFile, todayDDMMYYYY } from '../../lib/format';
import { convertBijoyToUnicode, looksLikeBijoyText } from '../../lib/bijoyToUnicode';
import {
  parseGeneralAccountsExcelFile,
  type ParsedExcelFileResult,
} from '../../lib/generalAccountsExcel';
import {
  BN_DAYS,
  BN_MONTHS,
  BN_WEEKDAYS_SHORT,
  DAY_LOCK_MARKER,
  OFFICIAL_KEYS_ORDER,
  OFFICIAL_PROFILES,
  PURPOSE_CATEGORY_CARDS,
  PURPOSE_DISPLAY_MAP,
  PURPOSE_OPTIONS,
  bnToEn,
  buildGeneralAccountsLedger,
  canonicalDateKey,
  classifyOfficialExpense,
  cleanDisplayPurpose,
  enToBn,
  formatBnDotDate,
  formatEnDotDate,
  formatIncDisplay,
  getDayNameFromDot,
  getNextDotDate,
  getPrevDotDate,
  isDemoAccountRow,
  isMisimportedOpeningTxRow,
  matchPurposeCategory,
  normalizeDigitsOnly,
  normalizeToDotDate,
  parseAccountNum,
  parseDotDate,
  parseRowDateParts,
  parseTxRow,
  serializeInDesc,
  toBnDigitsString,
  type AccountKind,
  type DaySummary,
  type EntryMode,
  type OfficialKey,
  type OfficialProfileMeta,
  type OpeningInfo,
  type ParsedTxRow,
  type PurposeCategoryKey,
} from '../../lib/generalAccountsEngine';
import type { SubCollectionKey } from '../../lib/store';
import type { GeneralAccountRow, Lang, Student } from '../../types';

export { bnToEn, enToBn, parseAccountNum };

interface GeneralAccountsViewProps {
  rows: GeneralAccountRow[];
  students?: Student[];
  centerName: string;
  generalAccountsPass?: string;
  lang: Lang;
  unlocked?: boolean;
  onUnlockChange?: (next: boolean) => void;
  onAdd: <K extends SubCollectionKey>(
    key: K,
    raw: Record<string, unknown>,
    customId?: string
  ) => Promise<string>;
  onUpdate: <K extends SubCollectionKey>(
    key: K,
    id: string,
    patch: Record<string, unknown>
  ) => Promise<void>;
  onDelete: <K extends SubCollectionKey>(key: K, id: string) => Promise<void>;
  onReplaceRows: (rows: Array<Record<string, unknown>>) => Promise<void>;
  onLogAudit: (action: string, module: string, detail: string) => Promise<void>;
}

type ActivePane =
  | 'dashboardPane'
  | 'sheetPane'
  | 'monthlyPane'
  | 'officialProfilePane'
  | 'toolsPane';
type FilterMode = 'all' | 'income' | 'expense';
type MonthlyFilterKey = 'all_officials' | OfficialKey | 'all_expenses';

interface OfficialGraphBar {
  label: string;
  val: number;
}

const ACCOUNTS_PASSCODE = '1234';

function fmtCell(n: number): string {
  return n && Number(n) !== 0 ? Number(n).toLocaleString('en-US') : '';
}

function escapeHtml(text: string): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function GeneralAccountsView({
  rows,
  students = [],
  centerName,
  generalAccountsPass,
  lang,
  unlocked: controlledUnlocked,
  onUnlockChange,
  onAdd,
  onUpdate,
  onDelete,
  onReplaceRows,
  onLogAudit,
}: GeneralAccountsViewProps) {
  const bn = lang === 'bn';
  const expectedPasscode = (generalAccountsPass || ACCOUNTS_PASSCODE).trim() || ACCOUNTS_PASSCODE;

  // Password Lock Screen State
  const [localUnlocked, setLocalUnlocked] = useState(false);
  const unlocked = controlledUnlocked ?? localUnlocked;
  const setUnlocked = (next: boolean) => {
    setLocalUnlocked(next);
    onUnlockChange?.(next);
  };
  const [passwordInput, setPasswordInput] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [lockError, setLockError] = useState('');

  // Navigation & Active Working Date
  const initialTodayDot = todayDDMMYYYY().replace(/-/g, '.');
  const [activePane, setActivePane] = useState<ActivePane>('dashboardPane');
  const [activeDate, setActiveDate] = useState<string>(initialTodayDot);
  const [userPickedDate, setUserPickedDate] = useState(false);

  // Entry Box State
  const [entryMode, setEntryMode] = useState<EntryMode>('expense');
  const [txAccount, setTxAccount] = useState<AccountKind>('Cash');
  const [txVoucher, setTxVoucher] = useState('');
  const [txKhataNo, setTxKhataNo] = useState('');
  const [khataDropdownOpen, setKhataDropdownOpen] = useState(false);
  const [txPurpose, setTxPurpose] = useState('');
  const [txDesc, setTxDesc] = useState('');
  const [txAmount, setTxAmount] = useState('');
  const lastAutoStudentNameRef = useRef('');

  // Opening Bar Local Inputs (synced whenever activeDate or opening changes)
  const [openingDateDraft, setOpeningDateDraft] = useState(() => getPrevDotDate(initialTodayDot));
  const [openingCashDraft, setOpeningCashDraft] = useState('0');
  const [openingBankDraft, setOpeningBankDraft] = useState('0');
  const [openingBkashDraft, setOpeningBkashDraft] = useState('0');

  // Sheet Controls & Inline Cell Edits
  const [searchText, setSearchText] = useState('');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [busy, setBusy] = useState(false);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [excelPreviewFiles, setExcelPreviewFiles] = useState<ParsedExcelFileResult[] | null>(null);
  const [excelImportLoading, setExcelImportLoading] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [receiptRow, setReceiptRow] = useState<ParsedTxRow | null>(null);

  // Monthly Report (1st - 31st) Filter State
  const [reportMonth, setReportMonth] = useState<number>(() => new Date().getMonth() + 1);
  const [reportYear, setReportYear] = useState<number>(() => new Date().getFullYear());
  const [reportDayFrom, setReportDayFrom] = useState<number>(1);
  const [reportDayTo, setReportDayTo] = useState<number>(31);
  const [monthlyFilter, setMonthlyFilter] = useState<MonthlyFilterKey>('all_officials');
  const [userPickedReportPeriod, setUserPickedReportPeriod] = useState(false);

  // Single Official Account Profile & Calendar Filter State
  const [selectedOfficialKey, setSelectedOfficialKey] = useState<OfficialKey>('md');
  const [officialScope, setOfficialScope] = useState<'all_officials' | 'selected'>('all_officials');
  const [officialPeriodMode, setOfficialPeriodMode] = useState<'all' | 'range' | 'month'>('all');
  const [officialRangeFromKey, setOfficialRangeFromKey] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [officialRangeToKey, setOfficialRangeToKey] = useState<string>(() =>
    canonicalDateKey(initialTodayDot)
  );
  const [officialMonth, setOfficialMonth] = useState<number>(() => new Date().getMonth() + 1);
  const [officialYear, setOfficialYear] = useState<number>(() => new Date().getFullYear());
  const [officialDayFrom, setOfficialDayFrom] = useState<number>(1);
  const [officialDayTo, setOfficialDayTo] = useState<number>(31);
  const [officialSearch, setOfficialSearch] = useState('');

  // 4 Purpose Categories (Welding, Fitter, Visa, P.P.E) Details & PDF Modal State
  const [purposeModalCat, setPurposeModalCat] = useState<PurposeCategoryKey | null>(null);
  const [purposeModalScope, setPurposeModalScope] = useState<'active_date' | 'range' | 'all'>(
    'active_date'
  );
  const [purposeDateFromKey, setPurposeDateFromKey] = useState<string>(() =>
    canonicalDateKey(initialTodayDot)
  );
  const [purposeDateToKey, setPurposeDateToKey] = useState<string>(() =>
    canonicalDateKey(initialTodayDot)
  );
  const [purposeSearch, setPurposeSearch] = useState('');

  // Dashboard 3-Official Calendar Date Range Filter
  const [dashOffFilterEnabled, setDashOffFilterEnabled] = useState(false);
  const [dashOffFromKey, setDashOffFromKey] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [dashOffToKey, setDashOffToKey] = useState<string>(() =>
    canonicalDateKey(initialTodayDot)
  );
  const [dashOffPerson, setDashOffPerson] = useState<'all' | OfficialKey>('all');

  // Calendar Popover State
  const [openCalendarTarget, setOpenCalendarTarget] = useState<
    null | 'dashboard' | 'opening' | 'entry'
  >(null);
  const [calendarCursor, setCalendarCursor] = useState<{ year: number; month: number }>(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  });
  const dashboardCalRef = useRef<HTMLDivElement | null>(null);
  const openingCalRef = useRef<HTMLDivElement | null>(null);
  const entryCalRef = useRef<HTMLDivElement | null>(null);
  const khataBoxRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const excelImportInputRef = useRef<HTMLInputElement | null>(null);
  const amountInputRef = useRef<HTMLInputElement | null>(null);
  const demoPurgedRef = useRef(false);
  const misimportedOpeningPurgedRef = useRef(false);
  const bijoyRepairedRef = useRef(false);

  // Match Student by Khata / Code Number
  const findStudentByKhata = useMemo(() => {
    const normalizeCode = (v: string) =>
      normalizeDigitsOnly(String(v || ''))
        .trim()
        .toLowerCase();
    return (rawKhata: string): Student | null => {
      const q = normalizeCode(rawKhata);
      if (!q) return null;
      const exact = students.find((s) => normalizeCode(s.code) === q);
      if (exact) return exact;
      const qStripZero = q.replace(/^0+(?=\d)/, '');
      const strippedExact = students.find(
        (s) => normalizeCode(s.code).replace(/^0+(?=\d)/, '') === qStripZero
      );
      return strippedExact || null;
    };
  }, [students]);

  const matchedStudent = useMemo(
    () => findStudentByKhata(txKhataNo),
    [findStudentByKhata, txKhataNo]
  );

  const khataSuggestions = useMemo(() => {
    const q = normalizeDigitsOnly(txKhataNo).trim().toLowerCase();
    if (!q) return [];
    return students
      .filter((s) => {
        const codeNorm = normalizeDigitsOnly(s.code).trim().toLowerCase();
        const nameNorm = (s.name || '').toLowerCase();
        return codeNorm.includes(q) || nameNorm.includes(q);
      })
      .slice(0, 6);
  }, [students, txKhataNo]);

  useEffect(() => {
    const nextName = matchedStudent?.name?.trim() || '';
    const prevName = lastAutoStudentNameRef.current;
    if (nextName === prevName) return;
    lastAutoStudentNameRef.current = nextName;
    setTxDesc((prev) => {
      let cleaned = prev.trim();
      if (prevName) {
        const prefix = `${prevName}-`;
        const suffix = ` - ${prevName}`;
        if (cleaned === prevName) cleaned = '';
        else if (cleaned.startsWith(prefix)) cleaned = cleaned.slice(prefix.length).trim();
        else if (cleaned.endsWith(suffix)) cleaned = cleaned.slice(0, -suffix.length).trim();
      }
      if (!nextName) return cleaned;
      if (!cleaned) return nextName;
      if (cleaned.toLowerCase().includes(nextName.toLowerCase())) return cleaned;
      return `${nextName}-${cleaned}`;
    });
  }, [matchedStudent]);

  useEffect(() => {
    if (!khataDropdownOpen) return;
    const handleOutsideKhata = (event: MouseEvent) => {
      if (khataBoxRef.current && !khataBoxRef.current.contains(event.target as Node)) {
        setKhataDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideKhata);
    return () => document.removeEventListener('mousedown', handleOutsideKhata);
  }, [khataDropdownOpen]);

  useEffect(() => {
    if (!openCalendarTarget) return;
    const handleOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      const activeRef =
        openCalendarTarget === 'dashboard'
          ? dashboardCalRef
          : openCalendarTarget === 'opening'
            ? openingCalRef
            : entryCalRef;
      if (activeRef.current && !activeRef.current.contains(target)) {
        setOpenCalendarTarget(null);
      }
    };
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenCalendarTarget(null);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [openCalendarTarget]);

  // Auto-remove legacy demo sample rows (ga_sample_* or pure demo dataset)
  useEffect(() => {
    if (demoPurgedRef.current || rows.length === 0) return;
    const hasGaSampleId = rows.some((r) => r.id.startsWith('ga_sample_'));
    const allArePureDemo = rows.every((r) => isDemoAccountRow(r));
    if (!hasGaSampleId && !allArePureDemo) return;
    demoPurgedRef.current = true;
    const cleaned = rows.filter((r) => !isDemoAccountRow(r));
    void onReplaceRows(
      cleaned.map((r, idx) => ({
        id: r.id,
        rowOrder: typeof r.rowOrder === 'number' ? r.rowOrder : idx + 1,
        isOpening: Boolean(r.isOpening),
        date: r.date || '',
        inDesc: r.inDesc || '',
        inCash: r.inCash || '',
        inBank: r.inBank || '',
        outDesc: r.outDesc || '',
        outCash: r.outCash || '',
      }))
    ).catch((err) => {
      console.error('Demo cleanup sync failed:', err);
    });
  }, [rows, onReplaceRows]);

  // Auto-remove mis-imported non-opening "পূর্বের ব্যালেন্স / পূর্বের ব্যালেত্র" inline rows so accounts tally cleanly
  useEffect(() => {
    if (
      misimportedOpeningPurgedRef.current ||
      rows.length === 0 ||
      busy ||
      excelImportLoading ||
      (excelPreviewFiles && excelPreviewFiles.length > 0)
    ) {
      return;
    }
    const hasGaSample = rows.some((r) => isDemoAccountRow(r));
    if (hasGaSample) return;
    const hasBogusOpeningRow = rows.some((r) => isMisimportedOpeningTxRow(r));
    if (!hasBogusOpeningRow) return;
    misimportedOpeningPurgedRef.current = true;
    const cleaned = rows.filter((r) => !isMisimportedOpeningTxRow(r));
    void onReplaceRows(
      cleaned.map((r, idx) => ({
        id: r.id,
        rowOrder: typeof r.rowOrder === 'number' ? r.rowOrder : idx + 1,
        isOpening: Boolean(r.isOpening),
        date: r.date || '',
        inDesc: (r.inDesc || '').slice(0, 195),
        inCash: (r.inCash || '').slice(0, 40),
        inBank: (r.inBank || '').slice(0, 40),
        outDesc: (r.outDesc || '').slice(0, 195),
        outCash: (r.outCash || '').slice(0, 40),
      }))
    ).catch((err) => {
      console.error('Mis-imported opening row cleanup failed:', err);
    });
  }, [rows, onReplaceRows, busy, excelImportLoading, excelPreviewFiles]);

  // Auto-convert previously imported Bijoy/SutonnyMJ rows to Unicode Bengali in-place (never delete rows)
  useEffect(() => {
    if (
      bijoyRepairedRef.current ||
      rows.length === 0 ||
      busy ||
      excelImportLoading ||
      (excelPreviewFiles && excelPreviewFiles.length > 0)
    ) {
      return;
    }
    const hasGaSample = rows.some((r) => isDemoAccountRow(r));
    const hasBogusOpening = rows.some((r) => isMisimportedOpeningTxRow(r));
    if (hasGaSample || hasBogusOpening) return;
    let changed = false;
    const upgraded: Array<Record<string, unknown>> = [];

    rows.forEach((r, idx) => {
      if (r.inDesc === DAY_LOCK_MARKER || r.isOpening) {
        upgraded.push({
          id: r.id,
          rowOrder: typeof r.rowOrder === 'number' ? r.rowOrder : idx + 1,
          isOpening: Boolean(r.isOpening),
          date: r.date || '',
          inDesc: (r.inDesc || '').slice(0, 195),
          inCash: (r.inCash || '').slice(0, 40),
          inBank: (r.inBank || '').slice(0, 40),
          outDesc: (r.outDesc || '').slice(0, 195),
          outCash: (r.outCash || '').slice(0, 40),
        });
        return;
      }

      const rawIn = r.inDesc || '';
      const rawOut = r.outDesc || '';
      const inHasBijoy = looksLikeBijoyText(rawIn);
      const outHasBijoy = looksLikeBijoyText(rawOut);
      const convIn = (inHasBijoy ? convertBijoyToUnicode(rawIn, true) : rawIn).slice(0, 195);
      const convOut = (outHasBijoy ? convertBijoyToUnicode(rawOut, true) : rawOut).slice(0, 195);
      if (convIn !== rawIn || convOut !== rawOut) changed = true;

      upgraded.push({
        id: r.id,
        rowOrder: typeof r.rowOrder === 'number' ? r.rowOrder : idx + 1,
        isOpening: false,
        date: r.date || '',
        inDesc: convIn,
        inCash: (r.inCash || '').slice(0, 40),
        inBank: (r.inBank || '').slice(0, 40),
        outDesc: convOut,
        outCash: (r.outCash || '').slice(0, 40),
      });
    });

    if (!changed) return;
    bijoyRepairedRef.current = true;
    void onReplaceRows(upgraded).catch((err) => {
      console.error('Bijoy auto-repair sync failed:', err);
      setNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'পুরনো বাংলা লেখা আপডেট করতে সমস্যা হয়েছে।',
      });
    });
  }, [rows, onReplaceRows, busy, excelImportLoading, excelPreviewFiles]);

  // Shared Balance & Carry-forward Engine (chronological, gap-day safe, no depth cap)
  const ledger = useMemo(
    () => buildGeneralAccountsLedger(rows, initialTodayDot),
    [rows, initialTodayDot]
  );
  const { txRows, openingRows, lockedDateKeys, manualOpeningMap, getDaySummary } = ledger;

  // Auto-select latest transaction date on initial load if data exists
  useEffect(() => {
    if (userPickedDate) return;
    const nonBlankTx = txRows.filter((t) => t.date);
    if (nonBlankTx.length > 0) {
      const sortedKeys = [...new Set(nonBlankTx.map((t) => t.date))].sort((a, b) =>
        canonicalDateKey(a).localeCompare(canonicalDateKey(b))
      );
      const latest = sortedKeys[sortedKeys.length - 1];
      if (latest) setActiveDate(latest);
    } else if (openingRows.length > 0) {
      const firstOpen = openingRows[0];
      const target = parseRowDateParts(firstOpen.outDesc || '')
        ? (firstOpen.outDesc || '').trim()
        : getNextDotDate(firstOpen.date || initialTodayDot);
      if (target) setActiveDate(target);
    }
  }, [txRows, openingRows, userPickedDate, initialTodayDot]);

  useEffect(() => {
    if (userPickedReportPeriod) return;
    const p = parseRowDateParts(activeDate);
    if (p) {
      setReportMonth(p.month);
      setReportYear(p.year);
      setOfficialMonth(p.month);
      setOfficialYear(p.year);
    }
  }, [activeDate, userPickedReportPeriod]);

  // Unique transaction dates sorted chronologically (plus activeDate)
  const uniqueDates = useMemo(() => {
    const set = new Set<string>();
    const map = new Map<string, string>();
    const addDate = (d: string) => {
      const key = canonicalDateKey(d);
      if (key && !set.has(key)) {
        set.add(key);
        const p = parseRowDateParts(d);
        map.set(
          key,
          p
            ? `${String(p.day).padStart(2, '0')}.${String(p.month).padStart(2, '0')}.${p.year}`
            : d
        );
      }
    };
    addDate(activeDate);
    txRows.forEach((r) => {
      if (r.date) addDate(r.date);
    });
    return [...set]
      .sort()
      .map((k) => map.get(k) || k);
  }, [activeDate, txRows]);

  const datesWithEntriesSet = useMemo(() => {
    const set = new Set<string>();
    txRows.forEach((r) => {
      if (r.dateKey) set.add(r.dateKey);
    });
    return set;
  }, [txRows]);

  const activeSummary = useMemo(() => getDaySummary(activeDate), [getDaySummary, activeDate]);
  const hasPriorDay = useMemo(
    () => ledger.hasPriorDataForDate(activeDate),
    [ledger, activeDate]
  );
  const activeDateKey = canonicalDateKey(normalizeToDotDate(activeDate, initialTodayDot));
  const isDayLocked = lockedDateKeys.has(activeDateKey);
  const dayName = getDayNameFromDot(activeDate);

  // Sync Opening Bar Draft Inputs when activeDate or resolved opening changes
  useEffect(() => {
    setOpeningDateDraft(activeSummary.opening.prevDate);
    setOpeningCashDraft(String(activeSummary.opening.cash || 0));
    setOpeningBankDraft(String(activeSummary.opening.bank || 0));
    setOpeningBkashDraft(String(activeSummary.opening.bkash || 0));
  }, [
    activeDate,
    activeSummary.opening.prevDate,
    activeSummary.opening.cash,
    activeSummary.opening.bank,
    activeSummary.opening.bkash,
  ]);

  // Dashboard Analytics for activeDate + Daily Purpose Summary across all uniqueDates
  const analytics = useMemo(() => {
    let weldingTotal = 0;
    let fitterTotal = 0;
    let visaTotal = 0;
    let ppeTotal = 0;
    let weldingCount = 0;
    let fitterCount = 0;
    let visaCount = 0;
    let ppeCount = 0;
    let mdTotal = 0;
    let dirTotal = 0;
    let gmTotal = 0;
    const mdItems: OfficialGraphBar[] = [];
    const dirItems: OfficialGraphBar[] = [];
    const gmItems: OfficialGraphBar[] = [];
    const catMap: Record<string, number> = {};

    activeSummary.dayRows.forEach((r) => {
      const incVal = r.incCash + r.incBank;
      if (matchPurposeCategory(r.incSrc, 'welding')) {
        weldingTotal += incVal;
        weldingCount += 1;
      }
      if (matchPurposeCategory(r.incSrc, 'fitter')) {
        fitterTotal += incVal;
        fitterCount += 1;
      }
      if (matchPurposeCategory(r.incSrc, 'visa')) {
        visaTotal += incVal;
        visaCount += 1;
      }
      if (matchPurposeCategory(r.incSrc, 'ppe')) {
        ppeTotal += incVal;
        ppeCount += 1;
      }

      const expText = r.expSrc.normalize('NFC').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
      const expVal =
        r.expAmt > 0 ? r.expAmt : r.incBank < 0 && expText ? Math.abs(r.incBank) : 0;
      if (expVal > 0 && expText) {
        catMap[expText] = (catMap[expText] || 0) + expVal;
        const official = classifyOfficialExpense(expText);
        if (official?.key === 'md') {
          mdTotal += expVal;
          mdItems.push({ label: official.note, val: expVal });
        } else if (official?.key === 'dir') {
          dirTotal += expVal;
          dirItems.push({ label: official.note, val: expVal });
        } else if (official?.key === 'gm') {
          gmTotal += expVal;
          gmItems.push({ label: official.note, val: expVal });
        }
      }
    });

    const topExpenseCategories = Object.entries(catMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);

    const dailyPurposeSummary = uniqueDates.map((dt) => {
      const k = canonicalDateKey(dt);
      const dayList = txRows.filter((r) => r.dateKey === k);
      let w = 0;
      let f = 0;
      let vFee = 0;
      let ppe = 0;
      dayList.forEach((r) => {
        const v = r.incCash + r.incBank;
        if (matchPurposeCategory(r.incSrc, 'welding')) w += v;
        if (matchPurposeCategory(r.incSrc, 'fitter')) f += v;
        if (matchPurposeCategory(r.incSrc, 'visa')) vFee += v;
        if (matchPurposeCategory(r.incSrc, 'ppe')) ppe += v;
      });
      return { date: dt, welding: w, fitter: f, visa: vFee, ppe };
    });

    return {
      weldingTotal,
      fitterTotal,
      visaTotal,
      ppeTotal,
      weldingCount,
      fitterCount,
      visaCount,
      ppeCount,
      mdTotal,
      dirTotal,
      gmTotal,
      mdItems,
      dirItems,
      gmItems,
      topExpenseCategories,
      dailyPurposeSummary,
    };
  }, [activeSummary.dayRows, uniqueDates, txRows]);

  // Monthly 1st-31st Report & Official Payout Aggregation
  const availableReportYears = useMemo(() => {
    const yearSet = new Set<number>([new Date().getFullYear(), reportYear]);
    txRows.forEach((r) => {
      const p = parseRowDateParts(r.date);
      if (p) yearSet.add(p.year);
    });
    return [...yearSet].sort((a, b) => b - a);
  }, [txRows, reportYear]);

  const monthlyReport = useMemo(() => {
    const minDay = Math.min(reportDayFrom, reportDayTo);
    const maxDay = Math.max(reportDayFrom, reportDayTo);

    type MonthlyExpenseEntry = {
      id: string;
      date: string;
      day: number;
      dateKey: string;
      categoryKey: OfficialKey | 'other';
      role: string;
      nameEn: string;
      nameBn: string;
      expSrc: string;
      note: string;
      amount: number;
    };

    type MonthlyDayBreakdown = {
      day: number;
      date: string;
      md: number;
      dir: number;
      gm: number;
      other: number;
      totalExp: number;
      income: number;
    };

    const matched: Array<{ row: ParsedTxRow; day: number }> = [];
    txRows.forEach((r) => {
      const p = parseRowDateParts(r.date);
      if (!p) return;
      if (p.year === reportYear && p.month === reportMonth && p.day >= minDay && p.day <= maxDay) {
        matched.push({ row: r, day: p.day });
      }
    });

    matched.sort((a, b) => {
      const cmp = a.row.dateKey.localeCompare(b.row.dateKey);
      if (cmp !== 0) return cmp;
      return (Number(a.row.raw.rowOrder) || 0) - (Number(b.row.raw.rowOrder) || 0);
    });

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

    const officialEntries: MonthlyExpenseEntry[] = [];
    const allExpenseEntries: MonthlyExpenseEntry[] = [];
    const dayMap = new Map<number, MonthlyDayBreakdown>();

    matched.forEach(({ row, day }) => {
      totalCashIn += row.incCash;
      totalBankIn += row.incBank > 0 ? row.incBank : 0;

      let dayBucket = dayMap.get(day);
      if (!dayBucket) {
        dayBucket = {
          day,
          date: row.date,
          md: 0,
          dir: 0,
          gm: 0,
          other: 0,
          totalExp: 0,
          income: 0,
        };
        dayMap.set(day, dayBucket);
      }
      dayBucket.income += row.incCash + (row.incBank > 0 ? row.incBank : 0);

      const expText = row.expSrc.normalize('NFC').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
      const expVal =
        row.expAmt > 0 ? row.expAmt : row.incBank < 0 && expText ? Math.abs(row.incBank) : 0;
      if (expVal <= 0) return;

      allExpTotal += expVal;
      dayBucket.totalExp += expVal;

      const official = classifyOfficialExpense(expText);
      if (official) {
        if (official.key === 'md') {
          mdTotal += expVal;
          mdCount += 1;
          dayBucket.md += expVal;
        } else if (official.key === 'dir') {
          dirTotal += expVal;
          dirCount += 1;
          dayBucket.dir += expVal;
        } else if (official.key === 'gm') {
          gmTotal += expVal;
          gmCount += 1;
          dayBucket.gm += expVal;
        }
        const entry: MonthlyExpenseEntry = {
          id: row.raw.id,
          date: row.date,
          day,
          dateKey: row.dateKey,
          categoryKey: official.key,
          role: official.role,
          nameEn: official.nameEn,
          nameBn: official.nameBn,
          expSrc: expText || official.nameBn,
          note: official.note,
          amount: expVal,
        };
        officialEntries.push(entry);
        allExpenseEntries.push(entry);
      } else {
        otherExpTotal += expVal;
        dayBucket.other += expVal;
        allExpenseEntries.push({
          id: row.raw.id,
          date: row.date,
          day,
          dateKey: row.dateKey,
          categoryKey: 'other',
          role: 'অন্যান্য ব্যয়',
          nameEn: 'OTHER EXPENSE',
          nameBn: 'অন্যান্য খাত',
          expSrc: expText || 'খরচ',
          note: expText || 'খরচ',
          amount: expVal,
        });
      }
    });

    const dailyBreakdown = [...dayMap.values()].sort((a, b) => a.day - b.day);

    return {
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
      officialEntries,
      allExpenseEntries,
      dailyBreakdown,
    };
  }, [txRows, reportYear, reportMonth, reportDayFrom, reportDayTo]);

  const filteredMonthlyEntries = useMemo(() => {
    if (monthlyFilter === 'all_expenses') return monthlyReport.allExpenseEntries;
    if (monthlyFilter === 'all_officials') return monthlyReport.officialEntries;
    return monthlyReport.officialEntries.filter((e) => e.categoryKey === monthlyFilter);
  }, [monthlyFilter, monthlyReport]);

  const filteredMonthlyTotal = useMemo(
    () => filteredMonthlyEntries.reduce((acc, item) => acc + item.amount, 0),
    [filteredMonthlyEntries]
  );

  const stepReportMonth = (delta: number) => {
    setUserPickedReportPeriod(true);
    let nextM = reportMonth + delta;
    let nextY = reportYear;
    if (nextM < 1) {
      nextM = 12;
      nextY -= 1;
    } else if (nextM > 12) {
      nextM = 1;
      nextY += 1;
    }
    setReportMonth(nextM);
    setReportYear(nextY);
  };

  // Single Official Account Profiles Aggregation (MD / DIR / GM)
  const officialProfilesData = useMemo(() => {
    type OfficialLedgerEntry = {
      id: string;
      row: ParsedTxRow;
      date: string;
      dateKey: string;
      day: number;
      month: number;
      year: number;
      account: AccountKind;
      expSrc: string;
      note: string;
      amount: number;
    };

    type OfficialMonthlyBucket = {
      ymKey: string;
      year: number;
      month: number;
      labelBn: string;
      count: number;
      total: number;
    };

    type OfficialSummaryData = {
      meta: OfficialProfileMeta;
      entries: OfficialLedgerEntry[];
      lifetimeTotal: number;
      entryCount: number;
      uniqueDaysCount: number;
      activeDateTotal: number;
      firstDate: string;
      lastDate: string;
      monthlyBreakdown: OfficialMonthlyBucket[];
    };

    const activeKeyNow = canonicalDateKey(activeDate);
    const makeEmpty = (k: OfficialKey): OfficialSummaryData => ({
      meta: OFFICIAL_PROFILES[k],
      entries: [],
      lifetimeTotal: 0,
      entryCount: 0,
      uniqueDaysCount: 0,
      activeDateTotal: 0,
      firstDate: '',
      lastDate: '',
      monthlyBreakdown: [],
    });

    const buckets: Record<OfficialKey, OfficialSummaryData> = {
      md: makeEmpty('md'),
      dir: makeEmpty('dir'),
      gm: makeEmpty('gm'),
    };

    const sortedTx = [...txRows].sort((a, b) => {
      const cmp = a.dateKey.localeCompare(b.dateKey);
      if (cmp !== 0) return cmp;
      return (Number(a.raw.rowOrder) || 0) - (Number(b.raw.rowOrder) || 0);
    });

    const daySets: Record<OfficialKey, Set<string>> = {
      md: new Set(),
      dir: new Set(),
      gm: new Set(),
    };
    const monthMaps: Record<OfficialKey, Map<string, OfficialMonthlyBucket>> = {
      md: new Map(),
      dir: new Map(),
      gm: new Map(),
    };

    sortedTx.forEach((row) => {
      const expText = row.expSrc.normalize('NFC').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
      const paidAmt =
        row.expAmt > 0 ? row.expAmt : row.incBank < 0 && expText ? Math.abs(row.incBank) : 0;
      if (paidAmt <= 0) return;
      const official = classifyOfficialExpense(expText);
      if (!official) return;

      const parsedDate = parseRowDateParts(row.date);
      const day = parsedDate?.day || 0;
      const month = parsedDate?.month || 0;
      const year = parsedDate?.year || 0;
      const target = buckets[official.key];

      const entry: OfficialLedgerEntry = {
        id: row.raw.id,
        row,
        date: row.date,
        dateKey: row.dateKey,
        day,
        month,
        year,
        account: row.account,
        expSrc: expText || official.nameBn,
        note: official.note,
        amount: paidAmt,
      };

      target.entries.push(entry);
      target.lifetimeTotal += paidAmt;
      target.entryCount += 1;
      if (row.dateKey) {
        daySets[official.key].add(row.dateKey);
        if (!target.firstDate) target.firstDate = row.date;
        target.lastDate = row.date;
      }
      if (row.dateKey === activeKeyNow) {
        target.activeDateTotal += paidAmt;
      }

      if (year > 0 && month > 0) {
        const ymKey = `${year}-${String(month).padStart(2, '0')}`;
        const existingMonth = monthMaps[official.key].get(ymKey);
        if (existingMonth) {
          existingMonth.count += 1;
          existingMonth.total += paidAmt;
        } else {
          monthMaps[official.key].set(ymKey, {
            ymKey,
            year,
            month,
            labelBn: `${BN_MONTHS[month - 1] || month} ${enToBn(year)}`,
            count: 1,
            total: paidAmt,
          });
        }
      }
    });

    OFFICIAL_KEYS_ORDER.forEach((k) => {
      buckets[k].uniqueDaysCount = daySets[k].size;
      buckets[k].monthlyBreakdown = [...monthMaps[k].values()].sort((a, b) =>
        b.ymKey.localeCompare(a.ymKey)
      );
    });

    return buckets;
  }, [txRows, activeDate]);

  const activeOfficialProfile = officialProfilesData[selectedOfficialKey];

  const formatIsoToBnDot = (isoKey: string): string => {
    const parts = isoKey.split('-');
    if (parts.length !== 3) return toBnDigitsString(isoKey);
    return toBnDigitsString(`${parts[2]}.${parts[1]}.${parts[0]}`);
  };

  // Period-filtered totals for ALL 3 officials (updates all 3 cards + combined breakdown below)
  const officialPeriodSummaries = useMemo(() => {
    const minDay = Math.min(officialDayFrom, officialDayTo);
    const maxDay = Math.max(officialDayFrom, officialDayTo);
    const rawFrom = officialRangeFromKey || '';
    const rawTo = officialRangeToKey || '';
    const minKey = rawFrom && rawTo ? (rawFrom <= rawTo ? rawFrom : rawTo) : rawFrom || '';
    const maxKey = rawFrom && rawTo ? (rawFrom <= rawTo ? rawTo : rawFrom) : rawTo || '';

    const matchesPeriod = (entry: { dateKey: string; year: number; month: number; day: number }) => {
      if (officialPeriodMode === 'month') {
        return (
          entry.year === officialYear &&
          entry.month === officialMonth &&
          entry.day >= minDay &&
          entry.day <= maxDay
        );
      }
      if (officialPeriodMode === 'range') {
        if (!entry.dateKey) return false;
        if (minKey && entry.dateKey < minKey) return false;
        if (maxKey && entry.dateKey > maxKey) return false;
        return true;
      }
      return true;
    };

    const byKey = {
      md: { total: 0, entries: [] as typeof officialProfilesData.md.entries, uniqueDays: 0 },
      dir: { total: 0, entries: [] as typeof officialProfilesData.dir.entries, uniqueDays: 0 },
      gm: { total: 0, entries: [] as typeof officialProfilesData.gm.entries, uniqueDays: 0 },
    };

    OFFICIAL_KEYS_ORDER.forEach((k) => {
      const list = officialProfilesData[k].entries.filter(matchesPeriod);
      const daySet = new Set<string>();
      let tot = 0;
      list.forEach((e) => {
        tot += e.amount;
        if (e.dateKey) daySet.add(e.dateKey);
      });
      byKey[k] = { total: tot, entries: list, uniqueDays: daySet.size };
    });

    const q = officialSearch.trim().toLowerCase();
    const combinedEntries = OFFICIAL_KEYS_ORDER.flatMap((k) =>
      byKey[k].entries.map((e) => ({ ...e, officialKey: k, meta: OFFICIAL_PROFILES[k] }))
    )
      .filter((entry) => {
        if (officialScope === 'selected' && entry.officialKey !== selectedOfficialKey) {
          return false;
        }
        if (!q) return true;
        return (
          entry.date.toLowerCase().includes(q) ||
          entry.expSrc.toLowerCase().includes(q) ||
          entry.note.toLowerCase().includes(q) ||
          entry.account.toLowerCase().includes(q) ||
          entry.meta.nameBn.toLowerCase().includes(q) ||
          entry.meta.nameEn.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const cmp = a.dateKey.localeCompare(b.dateKey);
        if (cmp !== 0) return cmp;
        return (Number(a.row.raw.rowOrder) || 0) - (Number(b.row.raw.rowOrder) || 0);
      });

    const combinedFilteredTotal = combinedEntries.reduce((s, e) => s + e.amount, 0);
    const combinedFilteredDays = new Set(combinedEntries.map((e) => e.dateKey).filter(Boolean)).size;
    const allThreePeriodTotal = byKey.md.total + byKey.dir.total + byKey.gm.total;

    const monthNameBn = BN_MONTHS[officialMonth - 1] || String(officialMonth);
    const periodLabel =
      officialPeriodMode === 'month'
        ? `${enToBn(minDay)}–${enToBn(maxDay)} ${monthNameBn} ${enToBn(officialYear)}`
        : officialPeriodMode === 'range'
          ? `${minKey ? formatIsoToBnDot(minKey) : 'শুরু'} থেকে ${maxKey ? formatIsoToBnDot(maxKey) : 'শেষ'}`
          : 'সর্বকালীন (All Time)';

    return {
      byKey,
      combinedEntries,
      combinedFilteredTotal,
      combinedFilteredDays,
      allThreePeriodTotal,
      periodLabel,
    };
  }, [
    officialProfilesData,
    officialPeriodMode,
    officialRangeFromKey,
    officialRangeToKey,
    officialYear,
    officialMonth,
    officialDayFrom,
    officialDayTo,
    officialSearch,
    officialScope,
    selectedOfficialKey,
  ]);

  const filteredOfficialEntries = useMemo(() => {
    const q = officialSearch.trim().toLowerCase();
    const list = officialPeriodSummaries.byKey[selectedOfficialKey].entries;
    if (!q) return list;
    return list.filter(
      (entry) =>
        entry.date.toLowerCase().includes(q) ||
        entry.expSrc.toLowerCase().includes(q) ||
        entry.note.toLowerCase().includes(q) ||
        entry.account.toLowerCase().includes(q)
    );
  }, [officialPeriodSummaries, selectedOfficialKey, officialSearch]);

  const filteredOfficialTotal = useMemo(
    () => filteredOfficialEntries.reduce((sum, item) => sum + item.amount, 0),
    [filteredOfficialEntries]
  );

  const filteredOfficialUniqueDays = useMemo(() => {
    const set = new Set<string>();
    filteredOfficialEntries.forEach((item) => {
      if (item.dateKey) set.add(item.dateKey);
    });
    return set.size;
  }, [filteredOfficialEntries]);

  // Dashboard inline Calendar-filtered official breakdown
  const dashOfficialFiltered = useMemo(() => {
    const fromK = dashOffFromKey && dashOffToKey && dashOffFromKey > dashOffToKey ? dashOffToKey : dashOffFromKey;
    const toK = dashOffFromKey && dashOffToKey && dashOffFromKey > dashOffToKey ? dashOffFromKey : dashOffToKey;
    const allList = OFFICIAL_KEYS_ORDER.flatMap((k) =>
      officialProfilesData[k].entries.map((e) => ({ ...e, officialKey: k, meta: OFFICIAL_PROFILES[k] }))
    ).filter((e) => {
      if (!e.dateKey) return false;
      if (fromK && e.dateKey < fromK) return false;
      if (toK && e.dateKey > toK) return false;
      return true;
    });
    const totals = { md: 0, dir: 0, gm: 0 };
    allList.forEach((e) => {
      totals[e.officialKey] += e.amount;
    });
    const filteredList = allList
      .filter((e) => dashOffPerson === 'all' || e.officialKey === dashOffPerson)
      .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
    return {
      totals,
      grandTotal: totals.md + totals.dir + totals.gm,
      entries: filteredList,
      fromK,
      toK,
    };
  }, [officialProfilesData, dashOffFromKey, dashOffToKey, dashOffPerson]);

  // 4 Purpose Categories (Welding, Fitter, Visa, P.P.E) Details & PDF Computation
  const purposeModalData = useMemo(() => {
    if (!purposeModalCat) return null;
    const meta = PURPOSE_CATEGORY_CARDS.find((c) => c.key === purposeModalCat) || PURPOSE_CATEGORY_CARDS[0];
    const minK =
      purposeDateFromKey && purposeDateToKey && purposeDateFromKey > purposeDateToKey
        ? purposeDateToKey
        : purposeDateFromKey;
    const maxK =
      purposeDateFromKey && purposeDateToKey && purposeDateFromKey > purposeDateToKey
        ? purposeDateFromKey
        : purposeDateToKey;
    const q = purposeSearch.trim().toLowerCase();

    const matched = txRows
      .filter((r) => {
        if (!matchPurposeCategory(r.incSrc, purposeModalCat)) return false;
        if (purposeModalScope === 'active_date') {
          if (r.dateKey !== activeDateKey) return false;
        } else if (purposeModalScope === 'range') {
          if (!r.dateKey) return false;
          if (minK && r.dateKey < minK) return false;
          if (maxK && r.dateKey > maxK) return false;
        }
        if (!q) return true;
        const st = r.khataNo ? findStudentByKhata(r.khataNo) : null;
        return (
          r.date.toLowerCase().includes(q) ||
          r.voucher.toLowerCase().includes(q) ||
          r.khataNo.toLowerCase().includes(q) ||
          r.incSrc.toLowerCase().includes(q) ||
          (st?.name || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const cmp = a.dateKey.localeCompare(b.dateKey);
        if (cmp !== 0) return cmp;
        return (Number(a.raw.rowOrder) || 0) - (Number(b.raw.rowOrder) || 0);
      })
      .map((r) => {
        const student = r.khataNo ? findStudentByKhata(r.khataNo) : null;
        const totalAmt = r.incCash + r.incBank;
        return {
          row: r,
          studentName: student?.name || '',
          totalAmt,
        };
      });

    const cashTotal = matched.reduce((s, x) => s + x.row.incCash, 0);
    const bankTotal = matched.reduce((s, x) => s + x.row.incBank, 0);
    const grandTotal = cashTotal + bankTotal;
    const periodLabel =
      purposeModalScope === 'active_date'
        ? `তারিখ: ${toBnDigitsString(activeDate)}`
        : purposeModalScope === 'range'
          ? `${minK ? formatIsoToBnDot(minK) : 'শুরু'} থেকে ${maxK ? formatIsoToBnDot(maxK) : 'শেষ'}`
          : 'সর্বকালীন (সকল তারিখ)';

    return {
      meta,
      items: matched,
      cashTotal,
      bankTotal,
      grandTotal,
      periodLabel,
    };
  }, [
    purposeModalCat,
    purposeModalScope,
    purposeDateFromKey,
    purposeDateToKey,
    purposeSearch,
    txRows,
    activeDateKey,
    activeDate,
    findStudentByKhata,
  ]);

  const openPurposeModal = (
    catKey: PurposeCategoryKey,
    scope: 'active_date' | 'range' | 'all' = 'active_date'
  ) => {
    setPurposeModalCat(catKey);
    setPurposeModalScope(scope);
    setPurposeDateFromKey(activeDateKey || canonicalDateKey(initialTodayDot));
    setPurposeDateToKey(activeDateKey || canonicalDateKey(initialTodayDot));
    setPurposeSearch('');
  };

  const stepOfficialMonth = (delta: number) => {
    setUserPickedReportPeriod(true);
    let nextM = officialMonth + delta;
    let nextY = officialYear;
    if (nextM < 1) {
      nextM = 12;
      nextY -= 1;
    } else if (nextM > 12) {
      nextM = 1;
      nextY += 1;
    }
    setOfficialMonth(nextM);
    setOfficialYear(nextY);
  };

  const openOfficialProfile = (
    key: OfficialKey,
    syncFromMonthly = false
  ) => {
    setSelectedOfficialKey(key);
    if (syncFromMonthly) {
      setOfficialPeriodMode('month');
      setOfficialMonth(reportMonth);
      setOfficialYear(reportYear);
      setOfficialDayFrom(reportDayFrom);
      setOfficialDayTo(reportDayTo);
    }
    setActivePane('officialProfilePane');
  };

  const getOfficialExportEntries = (
    key: OfficialKey,
    scopeOverride: 'current_profile' | 'monthly' | 'all' = 'current_profile'
  ) => {
    const profileData = officialProfilesData[key];
    if (scopeOverride === 'all') {
      return {
        entries: profileData.entries,
        periodLabel: 'সর্বকালীন (All Time)',
      };
    }
    if (scopeOverride === 'monthly') {
      const minD = Math.min(reportDayFrom, reportDayTo);
      const maxD = Math.max(reportDayFrom, reportDayTo);
      const monthNameBn = BN_MONTHS[reportMonth - 1] || String(reportMonth);
      return {
        entries: profileData.entries.filter(
          (entry) =>
            entry.year === reportYear &&
            entry.month === reportMonth &&
            entry.day >= minD &&
            entry.day <= maxD
        ),
        periodLabel: `${enToBn(minD)}–${enToBn(maxD)} ${monthNameBn} ${enToBn(reportYear)}`,
      };
    }

    // current_profile
    if (key === selectedOfficialKey) {
      return {
        entries: filteredOfficialEntries,
        periodLabel: officialSearch.trim()
          ? `${officialPeriodSummaries.periodLabel} • সার্চ: "${officialSearch.trim()}"`
          : officialPeriodSummaries.periodLabel,
      };
    }

    return {
      entries: officialPeriodSummaries.byKey[key].entries,
      periodLabel: officialPeriodSummaries.periodLabel,
    };
  };

  const handlePrintPurposePdf = (
    catKey: PurposeCategoryKey,
    scopeOverride?: 'active_date' | 'range' | 'all'
  ) => {
    const meta = PURPOSE_CATEGORY_CARDS.find((c) => c.key === catKey) || PURPOSE_CATEGORY_CARDS[0];
    const effectiveScope = scopeOverride ?? purposeModalScope;
    const minK =
      purposeDateFromKey && purposeDateToKey && purposeDateFromKey > purposeDateToKey
        ? purposeDateToKey
        : purposeDateFromKey;
    const maxK =
      purposeDateFromKey && purposeDateToKey && purposeDateFromKey > purposeDateToKey
        ? purposeDateFromKey
        : purposeDateToKey;

    const list = txRows
      .filter((r) => {
        if (!matchPurposeCategory(r.incSrc, catKey)) return false;
        if (effectiveScope === 'active_date') return r.dateKey === activeDateKey;
        if (effectiveScope === 'range') {
          if (!r.dateKey) return false;
          if (minK && r.dateKey < minK) return false;
          if (maxK && r.dateKey > maxK) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const cmp = a.dateKey.localeCompare(b.dateKey);
        if (cmp !== 0) return cmp;
        return (Number(a.raw.rowOrder) || 0) - (Number(b.raw.rowOrder) || 0);
      });

    const cashTot = list.reduce((s, r) => s + r.incCash, 0);
    const bankTot = list.reduce((s, r) => s + r.incBank, 0);
    const grandTot = cashTot + bankTot;
    const periodText =
      effectiveScope === 'active_date'
        ? `তারিখ: ${toBnDigitsString(activeDate)}`
        : effectiveScope === 'range'
          ? `${minK ? formatIsoToBnDot(minK) : 'শুরু'} থেকে ${maxK ? formatIsoToBnDot(maxK) : 'শেষ'}`
          : 'সর্বকালীন (সকল তারিখ)';
    const printDateBn = toBnDigitsString(todayDDMMYYYY().replace(/-/g, '.'));

    const rowsHtml = list
      .map((r, idx) => {
        const st = r.khataNo ? findStudentByKhata(r.khataNo) : null;
        const tot = r.incCash + r.incBank;
        return `<tr>
          <td class="text-center">${enToBn(idx + 1)}</td>
          <td class="text-center bold">${escapeHtml(toBnDigitsString(r.date))}</td>
          <td class="text-center">${escapeHtml(r.voucher || '—')}</td>
          <td class="text-center">${escapeHtml(r.khataNo ? `${r.khataNo}${st ? ` (${st.name})` : ''}` : '—')}</td>
          <td class="text-center">${escapeHtml(r.account || 'Cash')}</td>
          <td>${escapeHtml(cleanDisplayPurpose(r.incSrc) || '—')}</td>
          <td class="text-right">${r.incCash ? `৳${r.incCash.toLocaleString('en-US')}` : '—'}</td>
          <td class="text-right">${r.incBank ? `৳${r.incBank.toLocaleString('en-US')}` : '—'}</td>
          <td class="text-right bold">৳${tot.toLocaleString('en-US')}</td>
        </tr>`;
      })
      .join('');

    const html = `<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(meta.titleBn)} - বিবরণী</title>
  <style>
    @page { size: A4 portrait; margin: 10mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: "SolaimanLipi", "Nikosh", "Segoe UI", Tahoma, sans-serif; }
    body { background: #fff; color: #0f172a; padding: 10px; font-size: 11px; }
    .no-print { display: flex; justify-content: flex-end; gap: 8px; margin-bottom: 10px; }
    .btn { padding: 7px 14px; border-radius: 6px; border: none; font-size: 12px; font-weight: 700; cursor: pointer; }
    .btn-print { background: #10b981; color: #04100c; }
    .btn-close { background: #e2e8f0; color: #0f172a; }
    .banner { background: #00b050 !important; color: #000; text-align: center; font-weight: 700; font-size: 15px; padding: 7px 10px; border: 1.5px solid #000; }
    .sub { background: #ffff00 !important; color: #000; text-align: center; font-weight: 700; font-size: 12px; padding: 5px 8px; border: 1.5px solid #000; border-top: none; }
    .meta-bar { border: 1.5px solid #000; border-top: none; padding: 8px 12px; display: flex; justify-content: space-between; font-size: 11px; background: #f8fafc !important; }
    .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 8px 0; }
    .card { border: 1px solid #000; padding: 6px 8px; text-align: center; }
    .card .lbl { font-size: 9.5px; color: #475569; font-weight: 700; }
    .card .val { font-size: 13.5px; font-weight: 800; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 10.5px; }
    th, td { border: 1px solid #000; padding: 4px 5px; vertical-align: middle; }
    th { background: #f4b084 !important; font-weight: 700; text-align: center; }
    tfoot td { background: #dcfce7 !important; font-weight: 800; font-size: 11.5px; }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .bold { font-weight: 700; }
    .sigs { margin-top: 40px; display: flex; justify-content: space-between; padding: 0 12px; font-size: 11px; font-weight: 700; }
    .sig-line { border-top: 1px solid #000; padding-top: 4px; min-width: 145px; text-align: center; }
    @media print {
      body { padding: 0; }
      .no-print { display: none !important; }
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    }
  </style>
</head>
<body>
  <div class="no-print">
    <button class="btn btn-print" onclick="window.print()">প্রিন্ট / PDF ডাউনলোড করুন</button>
    <button class="btn btn-close" onclick="window.close()">বন্ধ করুন</button>
  </div>
  <div class="banner">আইডিয়াল টেকনিক্যাল ট্রেনিং এন্ড টেস্টিং সেন্টার</div>
  <div class="sub">${escapeHtml(meta.titleBn)} — বিস্তারিত জমার বিবরণী (${escapeHtml(meta.subtitle)})</div>
  <div class="meta-bar">
    <div><strong>সময়কাল:</strong> ${escapeHtml(periodText)}</div>
    <div><strong>মোট এন্ট্রি:</strong> ${enToBn(list.length) || '০'} টি</div>
    <div><strong>প্রিন্ট তারিখ:</strong> ${escapeHtml(printDateBn)}</div>
  </div>
  <div class="cards">
    <div class="card"><div class="lbl">মোট এন্ট্রি</div><div class="val">${enToBn(list.length) || '০'} টি</div></div>
    <div class="card"><div class="lbl">নগদ জমা</div><div class="val">৳${cashTot.toLocaleString('en-US')}</div></div>
    <div class="card"><div class="lbl">ব্যাংক/বিকাশ জমা</div><div class="val">৳${bankTot.toLocaleString('en-US')}</div></div>
    <div class="card"><div class="lbl">সর্বমোট জমা</div><div class="val">৳${grandTot.toLocaleString('en-US')}</div></div>
  </div>
  <table>
    <thead>
      <tr>
        <th style="width:36px;">নং</th>
        <th style="width:78px;">তারিখ</th>
        <th style="width:68px;">ভাউচার</th>
        <th style="width:110px;">খাতা / ছাত্র</th>
        <th style="width:58px;">মাধ্যম</th>
        <th>বিবরণ</th>
        <th style="width:74px;">নগদ (৳)</th>
        <th style="width:78px;">ব্যাংক (৳)</th>
        <th style="width:82px;">মোট (৳)</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml || '<tr><td colspan="9" class="text-center">এই সময়কালে কোনো জমা পাওয়া যায়নি।</td></tr>'}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="6" class="text-right">সর্বমোট (${enToBn(list.length) || '০'} টি) =</td>
        <td class="text-right">৳${cashTot.toLocaleString('en-US')}</td>
        <td class="text-right">৳${bankTot.toLocaleString('en-US')}</td>
        <td class="text-right">৳${grandTot.toLocaleString('en-US')}</td>
      </tr>
    </tfoot>
  </table>
  <div class="sigs">
    <div class="sig-line">হিসাব রক্ষক</div>
    <div class="sig-line">কর্তৃপক্ষের স্বাক্ষর</div>
  </div>
  <script>window.addEventListener('DOMContentLoaded', () => setTimeout(() => window.print(), 250));</script>
</body>
</html>`;
    openHtmlPrintTab(html);
  };

  const handleDownloadPurposeExcel = async (catKey: PurposeCategoryKey) => {
    if (!purposeModalData) return;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(`${catKey.toUpperCase()}_Details`);
    ws.columns = [
      { key: 'sl', width: 8 },
      { key: 'date', width: 14 },
      { key: 'voucher', width: 14 },
      { key: 'khata', width: 22 },
      { key: 'account', width: 12 },
      { key: 'desc', width: 38 },
      { key: 'cash', width: 15 },
      { key: 'bank', width: 15 },
      { key: 'total', width: 16 },
    ];
    ws.mergeCells('A1:I1');
    ws.getCell('A1').value = `${purposeModalData.meta.titleBn} — ${purposeModalData.periodLabel}`;
    ws.getCell('A1').font = { bold: true, size: 13 };
    ws.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00B050' } };
    ws.getRow(1).height = 24;

    const hdr = ws.addRow(['নং', 'তারিখ', 'ভাউচার', 'খাতা / ছাত্র', 'মাধ্যম', 'বিবরণ', 'নগদ (৳)', 'ব্যাংক (৳)', 'মোট (৳)']);
    hdr.font = { bold: true };
    purposeModalData.items.forEach((item, idx) => {
      const r = ws.addRow([
        idx + 1,
        item.row.date,
        item.row.voucher || '',
        item.row.khataNo ? `${item.row.khataNo}${item.studentName ? ` (${item.studentName})` : ''}` : '',
        item.row.account,
        cleanDisplayPurpose(item.row.incSrc),
        item.row.incCash || 0,
        item.row.incBank || 0,
        item.totalAmt,
      ]);
      r.getCell(7).numFmt = '#,##0';
      r.getCell(8).numFmt = '#,##0';
      r.getCell(9).numFmt = '#,##0';
    });
    const tot = ws.addRow([
      '',
      '',
      '',
      '',
      '',
      'সর্বমোট =',
      purposeModalData.cashTotal,
      purposeModalData.bankTotal,
      purposeModalData.grandTotal,
    ]);
    tot.font = { bold: true };
    tot.getCell(7).numFmt = '#,##0';
    tot.getCell(8).numFmt = '#,##0';
    tot.getCell(9).numFmt = '#,##0';

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ITTC_${catKey}_Details.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    setNotice({ type: 'success', text: `${purposeModalData.meta.titleBn} Excel ডাউনলোড হয়েছে!` });
  };

  const handlePrintCombinedOfficialsPdf = () => {
    const entries = officialPeriodSummaries.combinedEntries;
    const printDateBn = toBnDigitsString(todayDDMMYYYY().replace(/-/g, '.'));
    const rowsHtml = entries
      .map(
        (entry, idx) => `<tr>
          <td class="text-center">${enToBn(idx + 1)}</td>
          <td class="text-center bold">${escapeHtml(toBnDigitsString(entry.date))}</td>
          <td class="bold">${escapeHtml(entry.meta.nameBn)} (${escapeHtml(entry.meta.roleBn)})</td>
          <td class="text-center">${escapeHtml(entry.account)}</td>
          <td>${escapeHtml(entry.expSrc)}</td>
          <td class="text-right bold">৳${entry.amount.toLocaleString('en-US')}</td>
        </tr>`
      )
      .join('');

    const html = `<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8" />
  <title>কর্মকর্তা ভিত্তিক হিসাব বিবরণী</title>
  <style>
    @page { size: A4 portrait; margin: 10mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: "SolaimanLipi", "Nikosh", "Segoe UI", Tahoma, sans-serif; }
    body { background: #fff; color: #0f172a; padding: 10px; font-size: 11px; }
    .no-print { display: flex; justify-content: flex-end; gap: 8px; margin-bottom: 10px; }
    .btn { padding: 7px 14px; border-radius: 6px; border: none; font-size: 12px; font-weight: 700; cursor: pointer; }
    .btn-print { background: #10b981; color: #04100c; }
    .btn-close { background: #e2e8f0; color: #0f172a; }
    .banner { background: #00b050 !important; color: #000; text-align: center; font-weight: 700; font-size: 15px; padding: 7px 10px; border: 1.5px solid #000; }
    .sub { background: #ffff00 !important; color: #000; text-align: center; font-weight: 700; font-size: 12px; padding: 5px 8px; border: 1.5px solid #000; border-top: none; }
    .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 8px 0; }
    .card { border: 1px solid #000; padding: 7px 8px; text-align: center; }
    .card .lbl { font-size: 9.5px; color: #475569; font-weight: 700; }
    .card .val { font-size: 13.5px; font-weight: 800; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 10.5px; }
    th, td { border: 1px solid #000; padding: 4px 5px; vertical-align: middle; }
    th { background: #f4b084 !important; font-weight: 700; text-align: center; }
    tfoot td { background: #dcfce7 !important; font-weight: 800; font-size: 11.5px; }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .bold { font-weight: 700; }
    @media print { body { padding: 0; } .no-print { display: none !important; } * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } }
  </style>
</head>
<body>
  <div class="no-print">
    <button class="btn btn-print" onclick="window.print()">প্রিন্ট / PDF ডাউনলোড করুন</button>
    <button class="btn btn-close" onclick="window.close()">বন্ধ করুন</button>
  </div>
  <div class="banner">আইডিয়াল টেকনিক্যাল ট্রেনিং এন্ড টেস্টিং সেন্টার</div>
  <div class="sub">কর্মকর্তাদের প্রদত্ত টাকার বিবরণী • ${escapeHtml(officialPeriodSummaries.periodLabel)} (প্রিন্ট: ${escapeHtml(printDateBn)})</div>
  <div class="cards">
    <div class="card"><div class="lbl">সবুজ কাজী (MD)</div><div class="val">৳${officialPeriodSummaries.byKey.md.total.toLocaleString('en-US')}</div></div>
    <div class="card"><div class="lbl">সোহেল কাজী (DIR)</div><div class="val">৳${officialPeriodSummaries.byKey.dir.total.toLocaleString('en-US')}</div></div>
    <div class="card"><div class="lbl">সেলিম মাহমুদ (GM)</div><div class="val">৳${officialPeriodSummaries.byKey.gm.total.toLocaleString('en-US')}</div></div>
    <div class="card"><div class="lbl">৩ জনের সর্বমোট</div><div class="val">৳${officialPeriodSummaries.allThreePeriodTotal.toLocaleString('en-US')}</div></div>
  </div>
  <table>
    <thead>
      <tr>
        <th style="width:36px;">নং</th>
        <th style="width:78px;">তারিখ</th>
        <th style="width:155px;">কর্মকর্তা</th>
        <th style="width:62px;">মাধ্যম</th>
        <th>হিসাবের বিবরণ</th>
        <th style="width:92px;">টাকা (৳)</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml || '<tr><td colspan="6" class="text-center">এই সময়কালে কোনো লেনদেন পাওয়া যায়নি।</td></tr>'}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="5" class="text-right">সর্বমোট (${enToBn(entries.length) || '০'} টি এন্ট্রি) =</td>
        <td class="text-right">৳${officialPeriodSummaries.combinedFilteredTotal.toLocaleString('en-US')}</td>
      </tr>
    </tfoot>
  </table>
  <script>window.addEventListener('DOMContentLoaded', () => setTimeout(() => window.print(), 250));</script>
</body>
</html>`;
    openHtmlPrintTab(html);
  };

  const handleDownloadOfficialExcel = async (
    key: OfficialKey,
    scopeOverride: 'current_profile' | 'monthly' | 'all' = 'current_profile'
  ) => {
    const profile = OFFICIAL_PROFILES[key];
    const { entries, periodLabel } = getOfficialExportEntries(key, scopeOverride);
    const totalAmt = entries.reduce((s, e) => s + e.amount, 0);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(`${profile.nameEn}_Profile`);

    ws.columns = [
      { key: 'sl', width: 9 },
      { key: 'date', width: 15 },
      { key: 'account', width: 14 },
      { key: 'desc', width: 48 },
      { key: 'amt', width: 18 },
    ];

    ws.mergeCells('A1:E1');
    const c1 = ws.getCell('A1');
    c1.value = 'আইডিয়াল টেকনিক্যাল ট্রেনিং এন্ড টেস্টিং সেন্টার';
    c1.font = { bold: true, size: 14 };
    c1.alignment = { horizontal: 'center', vertical: 'middle' };
    c1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00B050' } };
    ws.getRow(1).height = 24;

    ws.mergeCells('A2:E2');
    const c2 = ws.getCell('A2');
    c2.value = `একক হিসাব প্রোফাইল: ${profile.nameBn} (${profile.nameEn} - ${profile.role}) • ${periodLabel}`;
    c2.font = { bold: true, size: 11 };
    c2.alignment = { horizontal: 'center', vertical: 'middle' };
    c2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
    ws.getRow(2).height = 20;

    ws.addRow([]);
    const hdr = ws.addRow(['ক্রমিক', 'তারিখ', 'মাধ্যম', 'হিসাবের বিবরণ / নোট', 'টাকা (৳)']);
    hdr.font = { bold: true };
    hdr.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4B084' } };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };
    });

    entries.forEach((entry, idx) => {
      const r = ws.addRow([idx + 1, entry.date, entry.account, entry.expSrc, entry.amount]);
      r.getCell(5).numFmt = '#,##0';
    });

    const totRow = ws.addRow(['', '', '', `সর্বমোট (${entries.length} টি এন্ট্রি) =`, totalAmt]);
    totRow.font = { bold: true };
    totRow.getCell(5).numFmt = '#,##0';

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const fname = `ITTC_${profile.nameEn.replace(/\s+/g, '_')}_Profile.xlsx`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fname;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    setNotice({ type: 'success', text: `${profile.nameBn}-এর হিসাব Excel ডাউনলোড হয়েছে!` });
  };

  const handlePrintOfficialProfile = (
    key: OfficialKey,
    scopeOverride: 'current_profile' | 'monthly' | 'all' = 'current_profile'
  ) => {
    const profile = OFFICIAL_PROFILES[key];
    const profileSummary = officialProfilesData[key];
    const { entries, periodLabel } = getOfficialExportEntries(key, scopeOverride);
    const totalAmt = entries.reduce((s, e) => s + e.amount, 0);
    const uniqueDayCount = new Set(entries.map((e) => e.dateKey).filter(Boolean)).size;
    const avgAmt = entries.length > 0 ? Math.round(totalAmt / entries.length) : 0;
    const printDateBn = toBnDigitsString(todayDDMMYYYY().replace(/-/g, '.'));

    const rowsHtml = entries
      .map(
        (entry, idx) => `<tr>
          <td class="text-center">${enToBn(idx + 1)}</td>
          <td class="text-center bold">${escapeHtml(toBnDigitsString(entry.date))}</td>
          <td class="text-center">${escapeHtml(entry.account)}</td>
          <td>${escapeHtml(entry.expSrc)}</td>
          <td class="text-right bold">৳${entry.amount.toLocaleString('en-US')}</td>
        </tr>`
      )
      .join('');

    const html = `<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(profile.nameEn)} - Single Account Profile</title>
  <style>
    @page { size: A4 portrait; margin: 11mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: "SolaimanLipi", "Nikosh", "Segoe UI", Tahoma, sans-serif; }
    body { background: #fff; color: #0f172a; padding: 10px; font-size: 11px; }
    .no-print { display: flex; justify-content: flex-end; gap: 8px; margin-bottom: 10px; }
    .btn { padding: 7px 14px; border-radius: 6px; border: none; font-size: 12px; font-weight: 700; cursor: pointer; }
    .btn-print { background: #10b981; color: #04100c; }
    .btn-close { background: #e2e8f0; color: #0f172a; }
    .banner { background: #00b050 !important; color: #000; text-align: center; font-weight: 700; font-size: 15px; padding: 7px 10px; border: 1.5px solid #000; }
    .sub { background: #ffff00 !important; color: #000; text-align: center; font-weight: 700; font-size: 12px; padding: 5px 8px; border: 1.5px solid #000; border-top: none; }
    .profile-box { border: 1.5px solid #000; border-top: none; padding: 10px 12px; display: flex; justify-content: space-between; align-items: center; gap: 12px; background: #f8fafc !important; }
    .profile-title { font-size: 16px; font-weight: 800; color: #0f172a; }
    .profile-role { font-size: 11px; font-weight: 700; color: #334155; margin-top: 2px; }
    .profile-meta { text-align: right; font-size: 11px; line-height: 1.5; }
    .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 10px 0; }
    .card { border: 1px solid #000; padding: 7px 8px; text-align: center; background: #fff; }
    .card .lbl { font-size: 9.5px; color: #475569; font-weight: 700; }
    .card .val { font-size: 14px; font-weight: 800; margin-top: 2px; color: #0f172a; }
    table { width: 100%; border-collapse: collapse; margin-top: 6px; }
    th, td { border: 1px solid #000; padding: 4px 6px; vertical-align: middle; }
    th { background: #f4b084 !important; font-weight: 700; text-align: center; font-size: 10.5px; }
    tfoot td { background: #dcfce7 !important; font-weight: 800; font-size: 12px; }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .bold { font-weight: 700; }
    .sigs { margin-top: 44px; display: flex; justify-content: space-between; padding: 0 12px; font-size: 11px; font-weight: 700; }
    .sig-line { border-top: 1px solid #000; padding-top: 4px; min-width: 145px; text-align: center; }
    @media print {
      body { padding: 0; }
      .no-print { display: none !important; }
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    }
  </style>
</head>
<body>
  <div class="no-print">
    <button class="btn btn-print" onclick="window.print()">প্রিন্ট / PDF সেভ করুন</button>
    <button class="btn btn-close" onclick="window.close()">বন্ধ করুন</button>
  </div>
  <div class="banner">আইডিয়াল টেকনিক্যাল ট্রেনিং এন্ড টেস্টিং সেন্টার</div>
  <div class="sub">একক কর্মকর্তা হিসাব প্রোফাইল ও সম্পূর্ণ লেনদেন বিবরণী (Single Account Statement)</div>
  <div class="profile-box">
    <div>
      <div class="profile-title">${escapeHtml(profile.nameBn)} (${escapeHtml(profile.nameEn)})</div>
      <div class="profile-role">পদবি: ${escapeHtml(profile.roleBn)} (${escapeHtml(profile.role)})</div>
    </div>
    <div class="profile-meta">
      <div><strong>সময়কাল:</strong> ${escapeHtml(periodLabel)}</div>
      <div><strong>প্রিন্ট তারিখ:</strong> ${escapeHtml(printDateBn)}</div>
      <div><strong>সর্বকালীন মোট:</strong> ৳${profileSummary.lifetimeTotal.toLocaleString('en-US')}</div>
    </div>
  </div>
  <div class="cards">
    <div class="card">
      <div class="lbl">নির্বাচিত সময়ে মোট টাকা</div>
      <div class="val">৳${totalAmt.toLocaleString('en-US')}</div>
    </div>
    <div class="card">
      <div class="lbl">মোট এন্ট্রি সংখ্যা</div>
      <div class="val">${enToBn(entries.length) || '০'} টি</div>
    </div>
    <div class="card">
      <div class="lbl">মোট কার্যদিবস</div>
      <div class="val">${enToBn(uniqueDayCount) || '০'} দিন</div>
    </div>
    <div class="card">
      <div class="lbl">গড় প্রতি এন্ট্রি</div>
      <div class="val">৳${avgAmt.toLocaleString('en-US')}</div>
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th style="width: 42px;">ক্রমিক</th>
        <th style="width: 88px;">তারিখ</th>
        <th style="width: 68px;">মাধ্যম</th>
        <th>হিসাবের বিবরণ / নোট</th>
        <th style="width: 105px;">টাকা (৳)</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml || '<tr><td colspan="5" class="text-center">এই সময়কালে কোনো লেনদেন পাওয়া যায়নি।</td></tr>'}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="4" class="text-right">সর্বমোট (${enToBn(entries.length) || '০'} টি এন্ট্রি) =</td>
        <td class="text-right">৳${totalAmt.toLocaleString('en-US')}</td>
      </tr>
    </tfoot>
  </table>
  <div class="sigs">
    <div class="sig-line">প্রস্তুতকারীর স্বাক্ষর</div>
    <div class="sig-line">${escapeHtml(profile.nameBn)} (${escapeHtml(profile.roleBn)})</div>
    <div class="sig-line">কর্তৃপক্ষের স্বাক্ষর</div>
  </div>
  <script>window.addEventListener('DOMContentLoaded', () => setTimeout(() => window.print(), 250));</script>
</body>
</html>`;
    openHtmlPrintTab(html);
  };

  const handleDownloadMonthlyExcel = async () => {
    const monthNameBn = BN_MONTHS[reportMonth - 1] || String(reportMonth);
    const rangeLabel = `${enToBn(monthlyReport.minDay)}–${enToBn(monthlyReport.maxDay)} ${monthNameBn} ${enToBn(reportYear)}`;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Monthly_1_to_31');

    ws.columns = [
      { key: 'sl', width: 8 },
      { key: 'date', width: 15 },
      { key: 'official', width: 28 },
      { key: 'desc', width: 44 },
      { key: 'amt', width: 18 },
    ];

    ws.mergeCells('A1:E1');
    const titleCell = ws.getCell('A1');
    titleCell.value = `আইডিয়াল টেকনিক্যাল ট্রেনিং এন্ড টেস্টিং সেন্টার — মাসিক প্রদত্ত টাকার হিসাব (${rangeLabel})`;
    titleCell.font = { bold: true, size: 13 };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00B050' } };
    ws.getRow(1).height = 24;

    ws.addRow([]);
    ws.addRow(['সারসংক্ষেপ', 'কর্মকর্তা / খাত', '', 'এন্ট্রি সংখ্যা', 'মোট প্রদত্ত (৳)']);
    ws.getRow(3).font = { bold: true };
    ws.addRow(['১', 'MANAGING DIRECTOR — SABUJ KAZI', 'সবুজ কাজী', monthlyReport.mdCount, monthlyReport.mdTotal]);
    ws.addRow(['২', 'DIRECTOR — SOHEL KAZI', 'সোহেল কাজী', monthlyReport.dirCount, monthlyReport.dirTotal]);
    ws.addRow(['৩', 'GENERAL MANAGER — SALIM MAHMMUD', 'সেলিম মাহমুদ', monthlyReport.gmCount, monthlyReport.gmTotal]);
    const totOffRow = ws.addRow(['', '৩ কর্মকর্তার সর্বমোট', '', monthlyReport.officialEntries.length, monthlyReport.officialsTotal]);
    totOffRow.font = { bold: true };
    ws.addRow(['', 'অন্যান্য মাসিক ব্যয়', '', monthlyReport.allExpenseEntries.length - monthlyReport.officialEntries.length, monthlyReport.otherExpTotal]);
    const allExpRow = ws.addRow(['', 'সকল মাসিক ব্যয়ের সর্বমোট', '', monthlyReport.allExpenseEntries.length, monthlyReport.allExpTotal]);
    allExpRow.font = { bold: true };

    ws.addRow([]);
    const hdrRow = ws.addRow(['ক্রমিক', 'তারিখ', 'কর্মকর্তা / খাত', 'ব্যয়ের মাধ্যম / বিবরণ', 'পরিমাণ (৳)']);
    hdrRow.font = { bold: true };
    hdrRow.eachCell((c) => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4B084' } };
      c.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };
    });

    filteredMonthlyEntries.forEach((entry, idx) => {
      const r = ws.addRow([
        idx + 1,
        entry.date,
        `${entry.nameEn} (${entry.nameBn})`,
        entry.expSrc,
        entry.amount,
      ]);
      r.getCell(5).numFmt = '#,##0';
    });

    const footer = ws.addRow(['', '', '', 'সর্বমোট প্রদত্ত টাকা =', filteredMonthlyTotal]);
    footer.font = { bold: true };
    footer.getCell(5).numFmt = '#,##0';

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const fname = `ITTC_Monthly_${String(reportMonth).padStart(2, '0')}_${reportYear}_${monthlyReport.minDay}-${monthlyReport.maxDay}.xlsx`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fname;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    setNotice({ type: 'success', text: `${fname} ডাউনলোড হয়েছে!` });
  };

  const handlePrintMonthlyPdf = () => {
    const monthNameBn = BN_MONTHS[reportMonth - 1] || String(reportMonth);
    const rangeLabel = `${enToBn(monthlyReport.minDay)} থেকে ${enToBn(monthlyReport.maxDay)} ${monthNameBn} ${enToBn(reportYear)}`;
    const filterTitle =
      monthlyFilter === 'all_officials'
        ? '৩ কর্মকর্তা (সবাই)'
        : monthlyFilter === 'md'
          ? 'SABUJ KAZI (সবুজ কাজী)'
          : monthlyFilter === 'dir'
            ? 'SOHEL KAZI (সোহেল কাজী)'
            : monthlyFilter === 'gm'
              ? 'SALIM MAHMMUD (সেলিম মাহমুদ)'
              : 'সকল মাসিক ব্যয়';

    const rowsHtml = filteredMonthlyEntries
      .map(
        (entry, idx) => `<tr>
          <td class="text-center">${idx + 1}</td>
          <td class="text-center">${escapeHtml(entry.date)}</td>
          <td><strong>${escapeHtml(entry.nameEn)}</strong> (${escapeHtml(entry.nameBn)})</td>
          <td>${escapeHtml(entry.expSrc)}</td>
          <td class="text-right bold">${entry.amount.toLocaleString('en-US')}</td>
        </tr>`
      )
      .join('');

    const html = `<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8" />
  <title>Monthly Report - ${escapeHtml(rangeLabel)}</title>
  <style>
    @page { size: A4 portrait; margin: 10mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: "SolaimanLipi", "Nikosh", "Segoe UI", Tahoma, sans-serif; }
    body { background: #fff; color: #000; padding: 12px; font-size: 11px; }
    .no-print { display: flex; justify-content: flex-end; gap: 8px; margin-bottom: 10px; }
    .btn { padding: 7px 14px; border-radius: 6px; border: none; font-size: 12px; font-weight: 700; cursor: pointer; }
    .btn-print { background: #10b981; color: #04100c; }
    .btn-close { background: #e2e8f0; color: #0f172a; }
    .banner { background: #00b050 !important; color: #000; text-align: center; font-weight: 700; font-size: 14px; padding: 6px; border: 1.5px solid #000; }
    .sub { background: #ffff00 !important; color: #000; text-align: center; font-weight: 700; font-size: 12px; padding: 4px; border: 1.5px solid #000; border-top: none; margin-bottom: 8px; }
    .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 10px; }
    .card { border: 1px solid #000; padding: 6px 8px; text-align: center; }
    .card .role { font-size: 9px; color: #475569; font-weight: 700; }
    .card .name { font-size: 11px; font-weight: 700; margin: 2px 0; }
    .card .amt { font-size: 13px; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #000; padding: 4px 6px; vertical-align: middle; }
    th { background: #f4b084 !important; font-weight: 700; text-align: center; }
    tfoot td { background: #dcfce7 !important; font-weight: 700; font-size: 12px; }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .bold { font-weight: 700; }
    @media print {
      body { padding: 0; }
      .no-print { display: none !important; }
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    }
  </style>
</head>
<body>
  <div class="no-print">
    <button class="btn btn-print" onclick="window.print()">প্রিন্ট / PDF সেভ করুন</button>
    <button class="btn btn-close" onclick="window.close()">বন্ধ করুন</button>
  </div>
  <div class="banner">আইডিয়াল টেকনিক্যাল ট্রেনিং এন্ড টেস্টিং সেন্টার</div>
  <div class="sub">মাসিক প্রদত্ত টাকার হিসাব (${escapeHtml(rangeLabel)}) • ফিল্টার: ${escapeHtml(filterTitle)}</div>
  <div class="cards">
    <div class="card">
      <div class="role">MANAGING DIRECTOR</div>
      <div class="name">SABUJ KAZI</div>
      <div class="amt">৳${enToBn(monthlyReport.mdTotal) || '০'}</div>
    </div>
    <div class="card">
      <div class="role">DIRECTOR</div>
      <div class="name">SOHEL KAZI</div>
      <div class="amt">৳${enToBn(monthlyReport.dirTotal) || '০'}</div>
    </div>
    <div class="card">
      <div class="role">GENERAL MANAGER</div>
      <div class="name">SALIM MAHMMUD</div>
      <div class="amt">৳${enToBn(monthlyReport.gmTotal) || '০'}</div>
    </div>
    <div class="card">
      <div class="role">৩ কর্মকর্তার সর্বমোট</div>
      <div class="name">সকল মাসিক ব্যয়: ৳${enToBn(monthlyReport.allExpTotal) || '০'}</div>
      <div class="amt">৳${enToBn(monthlyReport.officialsTotal) || '০'}</div>
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th style="width: 36px;">নং</th>
        <th style="width: 82px;">তারিখ</th>
        <th style="width: 175px;">কর্মকর্তা / খাত</th>
        <th>ব্যয়ের মাধ্যম / বিবরণ</th>
        <th style="width: 95px;">পরিমাণ (৳)</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml || '<tr><td colspan="5" class="text-center">এই সময়ের মধ্যে কোনো এন্ট্রি পাওয়া যায়নি।</td></tr>'}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="4" class="text-right">সর্বমোট (${filteredMonthlyEntries.length} টি এন্ট্রি) =</td>
        <td class="text-right">৳${filteredMonthlyTotal.toLocaleString('en-US')}</td>
      </tr>
    </tfoot>
  </table>
  <script>window.addEventListener('DOMContentLoaded', () => setTimeout(() => window.print(), 250));</script>
</body>
</html>`;
    openHtmlPrintTab(html);
  };

  // Filtered Sheet Rows for activeDate
  const filteredDayRows = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return activeSummary.dayRows.filter((r) => {
      if (filterMode === 'income' && !(r.incCash > 0 || r.incBank > 0 || r.incSrc)) {
        return false;
      }
      if (filterMode === 'expense' && !(r.expAmt > 0 || r.incBank < 0 || r.expSrc)) {
        return false;
      }
      if (!q) return true;
      return (
        r.incSrc.toLowerCase().includes(q) ||
        r.expSrc.toLowerCase().includes(q) ||
        r.voucher.toLowerCase().includes(q) ||
        r.khataNo.toLowerCase().includes(q)
      );
    });
  }, [activeSummary.dayRows, searchText, filterMode]);

  // Handlers
  const handleUnlock = async (e: FormEvent) => {
    e.preventDefault();
    if (passwordInput.trim() === expectedPasscode) {
      setLockError('');
      setPasswordInput('');
      setUnlocked(true);
      await onLogAudit('UNLOCK_GENERAL_ACCOUNTS', 'GENERAL ACCOUNTS', 'General Accounts unlocked');
    } else {
      setLockError(
        expectedPasscode === '1234'
          ? 'ভুল পাসওয়ার্ড! ডিফল্ট পাসওয়ার্ড: 1234'
          : 'ভুল পাসওয়ার্ড! Super Admin সেটিংস অনুযায়ী সঠিক পাসওয়ার্ড দিন।'
      );
    }
  };

  const handleLock = () => {
    setUnlocked(false);
    setPasswordInput('');
    setLockError('');
  };

  const changeActiveDate = (nextDotDate: string) => {
    const p = parseRowDateParts(nextDotDate);
    const normalized = p
      ? `${String(p.day).padStart(2, '0')}.${String(p.month).padStart(2, '0')}.${p.year}`
      : nextDotDate;
    setUserPickedDate(true);
    setActiveDate(normalized);
  };

  const stepActiveDate = (delta: number) => {
    const dt = parseDotDate(activeDate);
    if (!dt) return;
    dt.setDate(dt.getDate() + delta);
    changeActiveDate(formatEnDotDate(dt));
  };

  const handleSaveOpening = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const normalizedActiveDate = normalizeToDotDate(activeDate, initialTodayDot);
      const normalizedActiveKey = canonicalDateKey(normalizedActiveDate);
      const cashNum = parseAccountNum(openingCashDraft);
      const bankNum = parseAccountNum(openingBankDraft);
      const bkashNum = parseAccountNum(openingBkashDraft);
      const prevDateVal = normalizeToDotDate(
        openingDateDraft.trim(),
        getPrevDotDate(normalizedActiveDate)
      );
      const existingOpening = activeSummary.opening.isManual
        ? openingRows.find((r) => r.id === activeSummary.opening.rowId)
        : undefined;

      if (existingOpening) {
        await onUpdate('generalAccounts', existingOpening.id, {
          date: prevDateVal,
          inDesc: 'পূর্বের ব্যালেন্স',
          inCash: String(cashNum),
          inBank: String(bankNum),
          outDesc: normalizedActiveDate,
          outCash: String(bkashNum),
        });
      } else {
        await onAdd(
          'generalAccounts',
          {
            rowOrder: 0,
            isOpening: true,
            date: prevDateVal,
            inDesc: 'পূর্বের ব্যালেন্স',
            inCash: String(cashNum),
            inBank: String(bankNum),
            outDesc: normalizedActiveDate,
            outCash: String(bkashNum),
          },
          `ga_open_${normalizedActiveKey}`
        );
      }

      await onLogAudit(
        'SAVE_OPENING_BALANCE',
        'GENERAL ACCOUNTS',
        `${normalizedActiveDate} opening saved (Cash: ${cashNum}, Bank: ${bankNum}, Bkash: ${bkashNum})`
      );
      setNotice({
        type: 'success',
        text: 'পূর্বের ব্যালেন্স সংরক্ষিত হয়েছে।',
      });
    } catch (err) {
      setNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to save opening balance.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleResetOpeningToAuto = async () => {
    if (!activeSummary.opening.isManual || !activeSummary.opening.rowId) return;
    setBusy(true);
    setNotice(null);
    try {
      await onDelete('generalAccounts', activeSummary.opening.rowId);
      await onLogAudit(
        'RESET_OPENING_TO_AUTO',
        'GENERAL ACCOUNTS',
        `${activeDate} opening reverted to automatic carry-forward from previous day`
      );
      setNotice({
        type: 'success',
        text: 'পূর্বের ব্যালেন্স এখন অটোমেটিক আগের দিনের নগদ ব্যালেন্স থেকে হিসাব হচ্ছে।',
      });
    } catch (err) {
      setNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'অটো ব্যালেন্সে ফিরিয়ে নিতে সমস্যা হয়েছে।',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleToggleDayLock = async () => {
    setBusy(true);
    try {
      const normalizedActiveDate = normalizeToDotDate(activeDate, initialTodayDot);
      const normalizedActiveKey = canonicalDateKey(normalizedActiveDate);
      const existingLock = lockedDateKeys.get(normalizedActiveKey);
      if (existingLock) {
        await onDelete('generalAccounts', existingLock.id);
        setNotice({
          type: 'success',
          text: `${toBnDigitsString(normalizedActiveDate)} তারিখ আনলক করা হয়েছে।`,
        });
      } else {
        await onAdd(
          'generalAccounts',
          {
            rowOrder: 0,
            isOpening: false,
            date: normalizedActiveDate,
            inDesc: DAY_LOCK_MARKER,
            inCash: '',
            inBank: '',
            outDesc: 'LOCKED',
            outCash: '',
          },
          `ga_lock_${normalizedActiveKey}`
        );
        setNotice({
          type: 'success',
          text: `${toBnDigitsString(normalizedActiveDate)} তারিখ লক করা হয়েছে।`,
        });
      }
    } catch (err) {
      setNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'দিন লক/আনলক করতে সমস্যা হয়েছে।',
      });
    } finally {
      setBusy(false);
    }
  };

  const applyPurposeChip = (text: string, mode: EntryMode) => {
    const studentPrefix = matchedStudent?.name?.trim() ? `${matchedStudent.name.trim()}-` : '';
    const displayLabel = PURPOSE_DISPLAY_MAP[text] || text;
    if (PURPOSE_OPTIONS.includes(text)) {
      setTxPurpose(text);
    }
    setTxDesc(`${studentPrefix}${displayLabel}`);
    setEntryMode(mode);
    amountInputRef.current?.focus();
  };

  const handlePurposeSelectChange = (val: string) => {
    setTxPurpose(val);
    if (val && val !== 'অন্যান্য') {
      const studentPrefix = matchedStudent?.name?.trim() ? `${matchedStudent.name.trim()}-` : '';
      const displayLabel = PURPOSE_DISPLAY_MAP[val] || val;
      setTxDesc(`${studentPrefix}${displayLabel}`);
      setEntryMode('income');
    }
  };

  const handleQuickTxSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (isDayLocked) {
      setNotice({
        type: 'error',
        text: 'এই দিনটি লক করা আছে। আনলক করে এন্ট্রি দিন।',
      });
      return;
    }

    const studentName = matchedStudent?.name?.trim() || '';
    let desc = cleanDisplayPurpose(txDesc);
    if (!desc && studentName) {
      desc = studentName;
    }
    if (txPurpose && txPurpose !== 'অন্যান্য') {
      const displayPurpose = PURPOSE_DISPLAY_MAP[txPurpose] || txPurpose;
      const lower = desc.toLowerCase();
      if (
        !lower.includes(txPurpose.toLowerCase()) &&
        !lower.includes(displayPurpose.toLowerCase())
      ) {
        if (desc === studentName && studentName) {
          desc = `${studentName}-${displayPurpose}`;
        } else {
          desc = desc ? `${displayPurpose} - ${desc}` : displayPurpose;
        }
      }
    }
    if (studentName && !desc.toLowerCase().includes(studentName.toLowerCase())) {
      desc = desc ? `${studentName}-${desc}` : studentName;
    }
    const rawAmt = parseAccountNum(txAmount);
    const absAmt = Math.abs(rawAmt);
    const isBankAccount = txAccount === 'Bank' || txAccount === 'Bkash';
    const isNegativeBankDeduction = isBankAccount && rawAmt < 0;

    if (!desc || absAmt <= 0) {
      setNotice({
        type: 'error',
        text: 'সঠিক বিবরণ এবং টাকার পরিমাণ (> ০) লিখুন।',
      });
      return;
    }
    if (!isBankAccount && rawAmt < 0) {
      setNotice({
        type: 'error',
        text: '(-) চিহ্ন দিয়ে বিয়োগ শুধুমাত্র Bank বা Bkash অ্যাকাউন্টের জন্য প্রযোজ্য।',
      });
      return;
    }

    const voucher = txVoucher.trim();
    const khataNo = (matchedStudent?.code || txKhataNo).trim();
    let incSrc = '';
    let incCash = 0;
    let incBank = 0;
    let expSrc = '';
    let expAmt = 0;

    if (entryMode === 'income') {
      if (isNegativeBankDeduction) {
        incBank = rawAmt; // negative value deducts directly from Bank balance
        expSrc = desc;
      } else {
        incSrc = desc;
        if (txAccount === 'Cash') incCash = absAmt;
        else incBank = absAmt;
      }
    } else if (entryMode === 'expense') {
      expSrc = desc;
      if (isNegativeBankDeduction) {
        // Paid via Bank with leading (-) sign -> deduct from Bank balance, not Cash
        incBank = rawAmt;
        expAmt = 0;
      } else {
        expAmt = absAmt;
      }
    } else {
      if (isBankAccount) {
        if (isNegativeBankDeduction) {
          incBank = rawAmt;
          expSrc = desc;
          expAmt = 0;
        } else {
          incSrc = `${txAccount} ডিপোজিট: ${desc}`;
          incBank = absAmt;
          expSrc = `${txAccount} ডিপোজিট`;
          expAmt = absAmt;
        }
      } else {
        incSrc = `উত্তোলন: ${desc}`;
        incCash = absAmt;
      }
    }

    setBusy(true);
    setNotice(null);
    try {
      const normalizedActiveDate = normalizeToDotDate(activeDate, initialTodayDot);
      const maxOrder = rows.reduce((m, r) => Math.max(m, r.rowOrder || 0), 0);
      await onAdd('generalAccounts', {
        rowOrder: maxOrder + 1,
        isOpening: false,
        date: normalizedActiveDate,
        inDesc: serializeInDesc(voucher, incSrc, txAccount, khataNo),
        inCash: incCash !== 0 ? String(incCash) : '',
        inBank: incBank !== 0 ? String(incBank) : '',
        outDesc: expSrc.slice(0, 195),
        outCash: expAmt !== 0 ? String(expAmt) : '',
      });

      let syncedCoursePaid = false;
      if (entryMode === 'income' && !isNegativeBankDeduction && matchedStudent && absAmt > 0) {
        const nextDeposit = Number(matchedStudent.deposit || 0) + absAmt;
        const parsedActive = parseRowDateParts(normalizedActiveDate);
        const cashDate = parsedActive
          ? `${String(parsedActive.day).padStart(2, '0')}-${String(parsedActive.month).padStart(2, '0')}-${parsedActive.year}`
          : normalizedActiveDate.replace(/\./g, '-');
        const purposeClean = cleanDisplayPurpose(desc) || 'Course Fee Installment';

        await onUpdate('students', matchedStudent.id, {
          deposit: nextDeposit,
        });
        await onAdd('cash', {
          date: cashDate,
          type: 'in',
          category: 'Course Deposit',
          amt: absAmt,
          note: `Course Fee: ${matchedStudent.name} (${matchedStudent.code})${voucher ? ` | Ref: ${voucher}` : ''} | Method: ${txAccount} | Purpose: ${purposeClean}`.slice(
            0,
            245
          ),
        });
        await onLogAudit(
          'COLLECT_COURSE_DEPOSIT',
          'GENERAL ACCOUNTS',
          `${voucher ? `${voucher} · ` : ''}${matchedStudent.name} (${matchedStudent.code}) · ৳${absAmt.toLocaleString('en-US')} (Course Paid: ৳${nextDeposit.toLocaleString('en-US')})`
        );
        syncedCoursePaid = true;
      }

      await onLogAudit(
        'ADD_GENERAL_ACCOUNT',
        'GENERAL ACCOUNTS',
        `${normalizedActiveDate}${voucher ? ` [${voucher}]` : ''}${khataNo ? ` (${khataNo})` : ''} ${entryMode}: ${desc} (৳${isNegativeBankDeduction ? rawAmt : absAmt})`
      );
      lastAutoStudentNameRef.current = '';
      setTxDesc('');
      setTxAmount('');
      setTxPurpose('');
      setTxKhataNo('');
      setTxVoucher('');
      setKhataDropdownOpen(false);
      setNotice({
        type: 'success',
        text: isNegativeBankDeduction
          ? `${txAccount} ব্যালেন্স থেকে ৳${absAmt.toLocaleString('en-US')} বিয়োগ করে হিসাব যুক্ত হয়েছে!`
          : syncedCoursePaid
            ? `ছাত্র "${studentName}"-এর হিসাব ও প্রোফাইলে Course Paid (৳${absAmt.toLocaleString('en-US')}) সফলভাবে যুক্ত হয়েছে!`
            : studentName
              ? `ছাত্র "${studentName}"-এর হিসাব লেনদেন সফলভাবে যুক্ত হয়েছে!`
              : 'নতুন হিসাব লেনদেন সফলভাবে যুক্ত হয়েছে!',
      });
    } catch (err) {
      setNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to save transaction.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleAddBlankRow = async () => {
    if (isDayLocked) {
      setNotice({ type: 'error', text: 'দিনটি লক করা আছে।' });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const normalizedActiveDate = normalizeToDotDate(activeDate, initialTodayDot);
      const maxOrder = rows.reduce((m, r) => Math.max(m, r.rowOrder || 0), 0);
      await onAdd('generalAccounts', {
        rowOrder: maxOrder + 1,
        isOpening: false,
        date: normalizedActiveDate,
        inDesc: '',
        inCash: '',
        inBank: '',
        outDesc: '',
        outCash: '',
      });
    } catch (err) {
      setNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'নতুন সারি যোগ করতে সমস্যা হয়েছে।',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleClearAllRows = async () => {
    setConfirmClearAll(false);
    setBusy(true);
    setNotice(null);
    try {
      await onReplaceRows([]);
      const todayDot = todayDDMMYYYY().replace(/-/g, '.');
      setUserPickedDate(false);
      setActiveDate(todayDot);
      setTxVoucher('');
      await onLogAudit(
        'CLEAR_GENERAL_ACCOUNTS',
        'GENERAL ACCOUNTS',
        'Cleared all General Accounts ledger rows'
      );
      setNotice({
        type: 'success',
        text: 'সকল হিসাব সারি সফলভাবে মুছে ফেলা হয়েছে।',
      });
    } catch (err) {
      setNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'হিসাব মুছতে সমস্যা হয়েছে।',
      });
    } finally {
      setBusy(false);
    }
  };

  // Multi-File Excel (.xlsx / .xls / .csv) Importer
  const handleExcelImportSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    const fileList = Array.from(e.target.files || []);
    e.target.value = '';
    if (fileList.length === 0) return;

    setExcelImportLoading(true);
    setNotice(null);
    try {
      const parsedList = await Promise.all(
        fileList.map((f) => parseGeneralAccountsExcelFile(f))
      );

      // Sort chronologically by detected dateKey (files without date go last, sorted by name)
      parsedList.sort((a, b) => {
        const ka = a.fileDateKey || '9999-99-99';
        const kb = b.fileDateKey || '9999-99-99';
        if (ka !== kb) return ka.localeCompare(kb);
        return a.fileName.localeCompare(b.fileName);
      });

      const totalTx = parsedList.reduce((sum, p) => sum + p.txRows.length, 0);
      const hasAnyOpening = parsedList.some((p) => p.opening !== null);
      if (totalTx === 0 && !hasAnyOpening) {
        setNotice({
          type: 'error',
          text: 'নির্বাচিত Excel ফাইলে কোনো লেনদেন বা পূর্বের ব্যালেন্স পাওয়া যায়নি।',
        });
        return;
      }

      setExcelPreviewFiles(parsedList);
    } catch (err) {
      setNotice({
        type: 'error',
        text:
          err instanceof Error
            ? `Excel ফাইল পড়তে সমস্যা হয়েছে: ${err.message}`
            : 'Excel ফাইল পড়তে সমস্যা হয়েছে। সঠিক .xlsx ফাইল নির্বাচন করুন।',
      });
    } finally {
      setExcelImportLoading(false);
    }
  };

  const handleConfirmExcelImport = async (mode: 'append' | 'replace') => {
    if (!excelPreviewFiles || excelPreviewFiles.length === 0) return;
    const filesToImport = excelPreviewFiles;
    setBusy(true);
    setNotice(null);
    try {
      const ts = Date.now();
      const existingClean = rows
        .filter((r) => !isDemoAccountRow(r))
        .map((r, idx) => ({
          id: r.id,
          rowOrder: typeof r.rowOrder === 'number' ? r.rowOrder : idx + 1,
          isOpening: Boolean(r.isOpening),
          date: r.date || '',
          inDesc: (r.inDesc || '').slice(0, 195),
          inCash: (r.inCash || '').slice(0, 40),
          inBank: (r.inBank || '').slice(0, 40),
          outDesc: (r.outDesc || '').slice(0, 195),
          outCash: (r.outCash || '').slice(0, 40),
        }));

      const existingDatesSorted =
        mode === 'append'
          ? existingClean
              .filter((r) => r.inDesc !== DAY_LOCK_MARKER)
              .map((r) =>
                r.isOpening
                  ? canonicalDateKey(
                      parseRowDateParts(r.outDesc || '')
                        ? r.outDesc
                        : getNextDotDate(r.date || initialTodayDot)
                    )
                  : canonicalDateKey(r.date || '')
              )
              .filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k))
              .sort()
          : [];
      const earliestExistingKey = existingDatesSorted[0] || '';

      const maxExistingOrder =
        mode === 'append'
          ? existingClean.reduce(
              (m, r) => Math.max(m, typeof r.rowOrder === 'number' ? r.rowOrder : 0),
              0
            )
          : 0;

      const importedPayload: Array<Record<string, unknown>> = [];
      let orderCounter = maxExistingOrder + 1;
      let includedOpening = false;
      let latestImportedDot = '';
      let latestImportedKey = '';
      let importedTxCount = 0;

      filesToImport.forEach((fileRes, fIdx) => {
        const fallbackDot = normalizeToDotDate(
          fileRes.fileDateDot || activeDate || todayDDMMYYYY().replace(/-/g, '.'),
          initialTodayDot
        );

        // Opening Balance Carry-Forward Handling:
        // - Skip opening row if existing app ledger already has an earlier date (< targetKey),
        //   so the prior day's নগদ ব্যালেন্স carries forward naturally without doubling.
        // - Keep only the first chronological opening row when starting fresh or replacing or importing an earlier start date.
        if (fileRes.opening && !includedOpening) {
          const op = fileRes.opening;
          const targetDot = normalizeToDotDate(op.targetDate || fallbackDot, fallbackDot);
          const prevDot = normalizeToDotDate(
            op.prevDate || getPrevDotDate(targetDot),
            getPrevDotDate(targetDot)
          );
          const targetKey = canonicalDateKey(targetDot);
          const hasEarlierExistingDay = Boolean(
            earliestExistingKey && targetKey && earliestExistingKey < targetKey
          );
          if (!hasEarlierExistingDay) {
            importedPayload.push({
              id: `ga_open_${targetKey || `${ts}_${fIdx}`}_${ts}`,
              rowOrder: 0,
              isOpening: true,
              date: prevDot.slice(0, 20),
              inDesc: 'পূর্বের ব্যালেন্স',
              inCash: String(op.cash || 0).slice(0, 40),
              inBank: String(op.bank || 0).slice(0, 40),
              outDesc: targetDot.slice(0, 195),
              outCash: '0',
            });
            includedOpening = true;
          }
        }

        fileRes.txRows.forEach((tx, tIdx) => {
          const txDateDot = normalizeToDotDate(tx.date || fallbackDot, fallbackDot);
          const txDateKey = tx.dateKey || canonicalDateKey(txDateDot);
          if (txDateKey && (!latestImportedKey || txDateKey >= latestImportedKey)) {
            latestImportedKey = txDateKey;
            latestImportedDot = txDateDot;
          }
          importedPayload.push({
            id: `ga_xl_${ts}_${fIdx}_${tIdx}`,
            rowOrder: orderCounter++,
            isOpening: false,
            date: txDateDot.slice(0, 20),
            inDesc: tx.inDesc.slice(0, 195),
            inCash: tx.inCash.slice(0, 40),
            inBank: tx.inBank.slice(0, 40),
            outDesc: tx.outDesc.slice(0, 195),
            outCash: tx.outCash.slice(0, 40),
          });
          importedTxCount += 1;
        });

        if (!latestImportedDot) {
          latestImportedDot = normalizeToDotDate(fileRes.fileDateDot || fallbackDot, fallbackDot);
          latestImportedKey = canonicalDateKey(latestImportedDot);
        }
      });

      const finalRows =
        mode === 'append' ? [...existingClean, ...importedPayload] : importedPayload;

      await onReplaceRows(finalRows);

      if (latestImportedDot) {
        setUserPickedDate(true);
        setActiveDate(latestImportedDot);
      }
      setSearchText('');
      setFilterMode('all');
      setTxVoucher('');
      setExcelPreviewFiles(null);
      setActivePane('sheetPane');

      await onLogAudit(
        'IMPORT_EXCEL_GENERAL_ACCOUNTS',
        'GENERAL ACCOUNTS',
        `${mode.toUpperCase()}: Imported ${importedTxCount} transactions from ${filesToImport.length} Excel file(s)`
      );
      setNotice({
        type: 'success',
        text: `${filesToImport.length}টি Excel ফাইল থেকে ${importedTxCount}টি লেনদেন সফলভাবে ${
          mode === 'append' ? 'আগের ডেটার সাথে যুক্ত' : 'নতুন করে লোড'
        } হয়েছে!`,
      });
    } catch (err) {
      setNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Excel ইমপোর্ট সংরক্ষণে সমস্যা হয়েছে।',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteRow = async (rowId: string) => {
    if (isDayLocked) {
      setNotice({ type: 'error', text: 'দিনটি লক করা আছে।' });
      return;
    }
    try {
      await onDelete('generalAccounts', rowId);
    } catch (err) {
      setNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'সারি মুছতে সমস্যা হয়েছে।',
      });
    }
  };

  const handleInlineCellBlur = async (
    parsed: ParsedTxRow,
    field: 'incSrc' | 'incCash' | 'incBank' | 'expSrc' | 'expAmt',
    rawVal: string
  ) => {
    if (isDayLocked) return;
    const trimmed = rawVal.trim();
    try {
      if (field === 'incCash') {
        const num = parseAccountNum(trimmed);
        if (num === parsed.incCash) return;
        await onUpdate('generalAccounts', parsed.raw.id, { inCash: num > 0 ? String(num) : '' });
      } else if (field === 'incBank') {
        const num = parseAccountNum(trimmed);
        if (num === parsed.incBank) return;
        await onUpdate('generalAccounts', parsed.raw.id, { inBank: num !== 0 ? String(num) : '' });
      } else if (field === 'expAmt') {
        const num = parseAccountNum(trimmed);
        if (num === parsed.expAmt) return;
        const isBankRow =
          parsed.account === 'Bank' ||
          parsed.account === 'Bkash' ||
          /(?:\[?(?:bank|bkash)\]?|ব্যাংক|বিকাশ)/i.test(parsed.expSrc || '');
        if (num < 0 && isBankRow) {
          await onUpdate('generalAccounts', parsed.raw.id, {
            inBank: String(num),
            outCash: '',
          });
          return;
        }
        await onUpdate('generalAccounts', parsed.raw.id, { outCash: num > 0 ? String(num) : '' });
      } else if (field === 'expSrc') {
        if (trimmed === parsed.expSrc) return;
        await onUpdate('generalAccounts', parsed.raw.id, { outDesc: trimmed.slice(0, 195) });
      } else if (field === 'incSrc') {
        if (trimmed === parsed.raw.inDesc || trimmed === formatIncDisplay(parsed)) return;
        await onUpdate('generalAccounts', parsed.raw.id, { inDesc: trimmed.slice(0, 195) });
      }
    } catch (err) {
      setNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'হিসাব আপডেট করতে সমস্যা হয়েছে।',
      });
    }
  };

  // Backup JSON Export (new structured format compatible with Restore)
  const handleExportJson = () => {
    const cleanRows = txRows.map((r) => ({
      id: r.raw.id,
      date: r.date,
      voucher: r.voucher,
      khataNo: r.khataNo,
      account: r.account,
      incSrc: r.incSrc,
      incCash: r.incCash,
      incBank: r.incBank,
      expSrc: r.expSrc,
      expAmt: r.expAmt,
    }));
    const manualOpeningsObj: Record<
      string,
      { prevDate: string; cash: number; bank: number; bkash: number }
    > = {};
    manualOpeningMap.forEach((v, k) => {
      const [yy, mm, dd] = k.split('-');
      const dotKey = yy && mm && dd ? `${dd}.${mm}.${yy}` : k;
      manualOpeningsObj[dotKey] = {
        prevDate: v.prevDate,
        cash: v.cash,
        bank: v.bank,
        bkash: v.bkash,
      };
    });
    const payload = {
      activeDate,
      manualOpenings: manualOpeningsObj,
      rows: cleanRows,
    };
    downloadFile(
      `ITTC_Accounts_Backup_${activeDate}.json`,
      JSON.stringify(payload, null, 2),
      'application/json;charset=utf-8'
    );
    setNotice({ type: 'success', text: 'ব্যাকআপ JSON ফাইল ডাউনলোড হয়েছে!' });
  };

  // Restore JSON Import (supports both new object format and legacy array format)
  const handleImportJsonFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(String(reader.result || ''));
        const importedRows: Array<Record<string, unknown>> = [];
        let order = 1;

        if (parsed && !Array.isArray(parsed) && Array.isArray(parsed.rows)) {
          if (parsed.manualOpenings && typeof parsed.manualOpenings === 'object') {
            Object.entries(
              parsed.manualOpenings as Record<
                string,
                { prevDate?: string; cash?: number; bank?: number; bkash?: number }
              >
            ).forEach(([targetDate, op]) => {
              importedRows.push({
                id: `ga_open_${canonicalDateKey(targetDate)}`,
                rowOrder: 0,
                isOpening: true,
                date: String(op.prevDate || getPrevDotDate(targetDate)),
                inDesc: 'পূর্বের ব্যালেন্স',
                inCash: String(op.cash || 0),
                inBank: String(op.bank || 0),
                outDesc: targetDate,
                outCash: String(op.bkash || 0),
              });
            });
          }

          (parsed.rows as Array<Record<string, unknown>>).forEach((item, idx) => {
            const voucher = String(item.voucher ?? '');
            const khataNo = String(item.khataNo ?? '');
            const accRaw = String(item.account ?? 'Cash');
            const account: AccountKind =
              accRaw === 'Bank' ? 'Bank' : accRaw === 'Bkash' ? 'Bkash' : 'Cash';
            const incSrc = String(item.incSrc ?? '');
            importedRows.push({
              id:
                typeof item.id === 'string' && item.id.trim()
                  ? item.id
                  : `ga_imp_${Date.now()}_${idx}`,
              rowOrder: order++,
              isOpening: false,
              date: String(item.date ?? ''),
              inDesc: serializeInDesc(voucher, incSrc, account, khataNo),
              inCash: item.incCash ? String(item.incCash) : '',
              inBank: item.incBank ? String(item.incBank) : '',
              outDesc: String(item.expSrc ?? ''),
              outCash: item.expAmt ? String(item.expAmt) : '',
            });
          });
        } else {
          const list = Array.isArray(parsed)
            ? parsed
            : Array.isArray(parsed?.generalAccounts)
              ? parsed.generalAccounts
              : null;
          if (!list) {
            setNotice({ type: 'error', text: 'সঠিক ব্যাকআপ ফাইল নির্বাচন করুন।' });
            return;
          }
          (list as Array<Record<string, unknown>>).forEach((item, idx) => {
            importedRows.push({
              id:
                typeof item.id === 'string' && item.id.trim()
                  ? item.id
                  : `ga_imp_${Date.now()}_${idx}`,
              rowOrder: typeof item.rowOrder === 'number' ? item.rowOrder : idx + 1,
              isOpening: Boolean(item.isOpening),
              date: String(item.date ?? ''),
              inDesc: String(item.inDesc ?? ''),
              inCash: String(item.inCash ?? ''),
              inBank: String(item.inBank ?? ''),
              outDesc: String(item.outDesc ?? ''),
              outCash: String(item.outCash ?? ''),
            });
          });
        }

        setBusy(true);
        await onReplaceRows(importedRows);
        if (parsed?.activeDate && typeof parsed.activeDate === 'string') {
          setUserPickedDate(true);
          setActiveDate(parsed.activeDate);
        }
        await onLogAudit(
          'RESTORE_JSON',
          'GENERAL ACCOUNTS',
          `Restored ${importedRows.length} rows from JSON`
        );
        setNotice({ type: 'success', text: 'ব্যাকআপ সফলভাবে রিস্টোর ও সিঙ্ক হয়েছে!' });
      } catch {
        setNotice({ type: 'error', text: 'সঠিক ব্যাকআপ ফাইল নির্বাচন করুন।' });
      } finally {
        setBusy(false);
      }
    };
    reader.readAsText(file);
  };

  // Styled Excel (.xlsx) Export via ExcelJS
  const handleExportStyledExcel = async () => {
    const sum = activeSummary;
    const slashDate = toBnDigitsString(activeDate.replace(/\./g, '/'));
    const openBankCombined = (Number(sum.opening.bank) || 0) + (Number(sum.opening.bkash) || 0);

    const mod = ExcelJS as unknown as {
      Workbook?: typeof ExcelJS.Workbook;
      default?: { Workbook?: typeof ExcelJS.Workbook };
    };
    const WorkbookCtor = mod.Workbook ?? mod.default?.Workbook ?? ExcelJS.Workbook;
    const wb = new WorkbookCtor();
    const ws = wb.addWorksheet('দৈনিক হিসাব', {
      pageSetup: {
        paperSize: 9,
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 1,
      },
    });

    const maxIncLen = sum.dayRows.reduce(
      (max, r) => Math.max(max, formatIncDisplay(r).length),
      26
    );
    const maxExpLen = sum.dayRows.reduce(
      (max, r) => Math.max(max, (r.expSrc || '').length),
      24
    );

    ws.columns = [
      { width: 13 },
      { width: Math.min(72, Math.max(36, maxIncLen + 5)) },
      { width: 13 },
      { width: 14 },
      { width: Math.min(64, Math.max(34, maxExpLen + 5)) },
      { width: 13 },
      { width: 13 },
      { width: 13 },
      { width: 14 },
      { width: 14 },
      { width: 15 },
    ];

    const border: Partial<ExcelJS.Borders> = {
      top: { style: 'thin', color: { argb: 'FF000000' } },
      left: { style: 'thin', color: { argb: 'FF000000' } },
      bottom: { style: 'thin', color: { argb: 'FF000000' } },
      right: { style: 'thin', color: { argb: 'FF000000' } },
    };

    const greenFill: ExcelJS.Fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF00B050' },
    };
    const yellowFill: ExcelJS.Fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFFF00' },
    };
    const peachFill: ExcelJS.Fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF4B084' },
    };

    ws.mergeCells('A1:K1');
    ws.getCell('A1').value = 'আইডিয়াল টেকনিক্যাল ট্রেনিং এন্ড টেস্টিং সেন্টার';
    ws.getCell('A1').fill = greenFill;
    ws.getCell('A1').font = { size: 16, bold: true, color: { argb: 'FF000000' } };
    ws.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 28;

    ws.mergeCells('A2:K2');
    ws.getCell('A2').value = `দৈনিক আয় ব্যয়ের হিসাব ${slashDate} (${dayName})`;
    ws.getCell('A2').fill = yellowFill;
    ws.getCell('A2').font = { size: 13, bold: true, color: { argb: 'FF000000' } };
    ws.getCell('A2').alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(2).height = 22;

    ws.mergeCells('A3:A4');
    ws.getCell('A3').value = 'তারিখ';
    ws.mergeCells('B3:D3');
    ws.getCell('B3').value = 'আয়';
    ws.mergeCells('E3:F3');
    ws.getCell('E3').value = 'ব্যয়';
    ws.mergeCells('G3:G4');
    ws.getCell('G3').value = 'নগদ টাকা';
    ws.mergeCells('H3:H4');
    ws.getCell('H3').value = 'ব্যয়ের টাকা';
    ws.mergeCells('I3:I4');
    ws.getCell('I3').value = 'ব্যাংক/বিকাশ';
    ws.mergeCells('J3:J4');
    ws.getCell('J3').value = 'নগদ ব্যালেন্স';
    ws.mergeCells('K3:K4');
    ws.getCell('K3').value = 'নগদ + ব্যাংক';

    ws.getCell('B4').value = 'আয়ের মাধ্যম / ভাউচার';
    ws.getCell('C4').value = 'নগদ টাকা';
    ws.getCell('D4').value = 'ব্যাংক/বিকাশ';
    ws.getCell('E4').value = 'ব্যয়ের মাধ্যম';
    ws.getCell('F4').value = 'ব্যয়ের টাকা';

    [3, 4].forEach((rIdx) => {
      ws.getRow(rIdx).height = 20;
      for (let c = 1; c <= 11; c++) {
        const cell = ws.getRow(rIdx).getCell(c);
        cell.fill = peachFill;
        cell.font = { size: 11, bold: true };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = border;
      }
    });

    const r5 = ws.getRow(5);
    r5.height = 20;
    r5.values = [
      sum.opening.prevDate,
      'পূর্বের ব্যালেন্স',
      sum.opening.cash || null,
      openBankCombined || null,
      'পূর্বের ব্যালেন্স',
      null,
      sum.opening.cash || null,
      null,
      openBankCombined || null,
      null,
      null,
    ];
    for (let c = 1; c <= 11; c++) {
      const cell = r5.getCell(c);
      cell.font = { size: 11, bold: true };
      cell.border = border;
      if (c === 1) cell.alignment = { horizontal: 'center', vertical: 'middle' };
      else if ([3, 4, 7, 9].includes(c)) {
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
        cell.numFmt = '#,##0';
      }
    }
    r5.getCell(3).fill = greenFill;
    r5.getCell(4).fill = yellowFill;
    r5.getCell(7).fill = greenFill;
    r5.getCell(9).fill = yellowFill;

    let idx = 6;
    sum.dayRows.forEach((r) => {
      const incDisplay = formatIncDisplay(r);
      const row = ws.getRow(idx);
      row.height = 19;
      row.values = [
        r.date,
        incDisplay,
        r.incCash || null,
        r.incBank || null,
        r.expSrc || '',
        r.expAmt || null,
        r.incCash || null,
        r.expAmt || null,
        r.incBank || null,
        null,
        null,
      ];
      for (let c = 1; c <= 11; c++) {
        const cell = row.getCell(c);
        cell.font = { size: 10.5 };
        cell.border = border;
        if (c === 1) cell.alignment = { horizontal: 'center', vertical: 'middle' };
        else if ([3, 4, 6, 7, 8, 9].includes(c)) {
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
          cell.numFmt = '#,##0';
        }
      }
      if (r.incBank > 0) {
        row.getCell(4).fill = greenFill;
        row.getCell(9).fill = greenFill;
      } else if (r.incBank < 0) {
        const redFill: ExcelJS.Fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFC7CE' },
        };
        row.getCell(4).fill = redFill;
        row.getCell(9).fill = redFill;
        row.getCell(4).font = { size: 10.5, bold: true, color: { argb: 'FF9C0006' } };
        row.getCell(9).font = { size: 10.5, bold: true, color: { argb: 'FF9C0006' } };
      }
      idx++;
    });

    const lastPad = Math.max(idx + 4, 30);
    while (idx <= lastPad) {
      const row = ws.getRow(idx);
      row.height = 18;
      for (let c = 1; c <= 11; c++) row.getCell(c).border = border;
      idx++;
    }

    const bankRowIdx = idx;
    const rB = ws.getRow(bankRowIdx);
    rB.height = 20;
    rB.getCell(2).value = 'ব্যাংকে/বিকাশে জমা আছে=';
    rB.getCell(5).value = 'ব্যাংকে/বিকাশে জমা আছে=';
    rB.getCell(5).alignment = { horizontal: 'right', vertical: 'middle' };
    for (let c = 1; c <= 11; c++) {
      rB.getCell(c).font = { size: 11, bold: true };
      rB.getCell(c).border = border;
    }

    const totIdx = bankRowIdx + 1;
    const lastData = bankRowIdx - 1;
    const rT = ws.getRow(totIdx);
    rT.height = 22;

    rT.getCell(3).value = { formula: `SUM(C5:C${lastData})` };
    rT.getCell(4).value = { formula: `SUM(D5:D${lastData})` };
    rT.getCell(5).value = 'ক্যাশে জমা আছে=';
    rT.getCell(5).alignment = { horizontal: 'right', vertical: 'middle' };
    rT.getCell(6).value = { formula: `SUM(F6:F${lastData})` };
    rT.getCell(7).value = { formula: `SUM(G5:G${lastData})` };
    rT.getCell(8).value = { formula: `SUM(H6:H${lastData})` };
    rT.getCell(9).value = { formula: `SUM(I5:I${lastData})` };
    rT.getCell(10).value = { formula: `G${totIdx}-H${totIdx}` };
    rT.getCell(11).value = { formula: `J${totIdx}+I${totIdx}` };

    for (let c = 1; c <= 11; c++) {
      const cell = rT.getCell(c);
      cell.font = { size: 11, bold: true };
      cell.border = border;
      if ([3, 4, 6, 7, 8, 9, 10, 11].includes(c)) {
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
        cell.numFmt = '#,##0';
      }
    }
    [3, 4, 7, 9, 10, 11].forEach((c) => {
      rT.getCell(c).fill = greenFill;
    });
    [6, 8].forEach((c) => {
      rT.getCell(c).fill = yellowFill;
    });

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ITTC_Accounts_${activeDate}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    setNotice({ type: 'success', text: `ITTC_Accounts_${activeDate}.xlsx ডাউনলোড হয়েছে!` });
  };

  // Open Blob HTML tab for A4 Landscape Print / PDF (avoids window.open)
  const openHtmlPrintTab = (html: string) => {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  const handlePrintSheetPdf = () => {
    const sum = activeSummary;
    const slashDate = toBnDigitsString(activeDate.replace(/\./g, '/'));
    const openBankCombined = (Number(sum.opening.bank) || 0) + (Number(sum.opening.bkash) || 0);
    const blanks = Math.max(0, 16 - sum.dayRows.length);

    const rowsHtml = sum.dayRows
      .map((r) => {
        const incDisplay = formatIncDisplay(r);
        const bankCls = r.incBank > 0 ? 'bg-green' : r.incBank < 0 ? 'bg-red' : '';
        return `<tr>
          <td class="text-center">${escapeHtml(r.date)}</td>
          <td>${escapeHtml(incDisplay)}</td>
          <td class="text-right">${escapeHtml(fmtCell(r.incCash))}</td>
          <td class="text-right ${bankCls}">${escapeHtml(fmtCell(r.incBank))}</td>
          <td>${escapeHtml(r.expSrc)}</td>
          <td class="text-right">${escapeHtml(fmtCell(r.expAmt))}</td>
          <td class="text-right">${escapeHtml(fmtCell(r.incCash))}</td>
          <td class="text-right">${escapeHtml(fmtCell(r.expAmt))}</td>
          <td class="text-right ${bankCls}">${escapeHtml(fmtCell(r.incBank))}</td>
          <td></td>
          <td></td>
        </tr>`;
      })
      .join('');

    const blanksHtml = Array.from({ length: blanks }, (_, i) => {
      return `<tr>
        <td class="text-center">${i < 4 ? escapeHtml(activeDate) : ''}</td>
        <td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td>
      </tr>`;
    }).join('');

    const html = `<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8" />
  <title>GENERAL ACCOUNTS - ${escapeHtml(activeDate)}</title>
  <style>
    @page { size: A4 landscape; margin: 6mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: "SolaimanLipi", "Nikosh", "Segoe UI", Tahoma, sans-serif; }
    body { background: #fff; color: #000; padding: 10px; }
    .no-print { display: flex; justify-content: flex-end; gap: 8px; margin-bottom: 10px; }
    .btn { padding: 7px 14px; border-radius: 6px; border: none; font-size: 12px; font-weight: 700; cursor: pointer; }
    .btn-print { background: #10b981; color: #04100c; }
    .btn-close { background: #e2e8f0; color: #0f172a; }
    .excel-container { border: 1.5px solid #000; padding: 4px; }
    .banner-green { background: #00b050 !important; color: #000; text-align: center; font-size: 14px; font-weight: 700; padding: 5px 8px; border: 1px solid #000; }
    .banner-yellow { background: #ffff00 !important; color: #000; text-align: center; font-size: 12px; font-weight: 700; padding: 4px 8px; border: 1px solid #000; border-top: none; }
    table { width: 100%; border-collapse: collapse; table-layout: auto; font-size: 9.5px; }
    th, td { border: 1px solid #000; padding: 2px 5px; height: 18px; vertical-align: middle; white-space: nowrap; }
    .col-desc { min-width: 210px; white-space: normal; word-break: break-word; }
    .hdr-peach { background: #f4b084 !important; font-weight: 700; text-align: center; }
    .bg-green { background: #00b050 !important; font-weight: 700; }
    .bg-red { background: #fee2e2 !important; color: #b91c1c; font-weight: 700; }
    .bg-yellow { background: #ffff00 !important; font-weight: 700; }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .bold { font-weight: 700; }
    @media print {
      body { padding: 0 !important; }
      .no-print { display: none !important; }
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    }
  </style>
</head>
<body>
  <div class="no-print">
    <button class="btn btn-print" onclick="window.print()">প্রিন্ট / PDF সেভ করুন</button>
    <button class="btn btn-close" onclick="window.close()">বন্ধ করুন</button>
  </div>
  <div class="excel-container">
    <div class="banner-green">আইডিয়াল টেকনিক্যাল ট্রেনিং এন্ড টেস্টিং সেন্টার</div>
    <div class="banner-yellow">দৈনিক আয় ব্যয়ের হিসাব ${escapeHtml(slashDate)} (${escapeHtml(dayName)})</div>
    <table>
      <colgroup>
        <col style="min-width: 72px;" />
        <col class="col-desc" />
        <col style="min-width: 68px;" />
        <col style="min-width: 72px;" />
        <col style="min-width: 170px;" />
        <col style="min-width: 68px;" />
        <col style="min-width: 68px;" />
        <col style="min-width: 68px;" />
        <col style="min-width: 72px;" />
        <col style="min-width: 74px;" />
        <col style="min-width: 82px;" />
      </colgroup>
      <thead>
        <tr>
          <th rowspan="2" class="hdr-peach">তারিখ</th>
          <th colspan="3" class="hdr-peach">আয়</th>
          <th colspan="2" class="hdr-peach">ব্যয়</th>
          <th rowspan="2" class="hdr-peach">নগদ টাকা</th>
          <th rowspan="2" class="hdr-peach">ব্যয়ের টাকা</th>
          <th rowspan="2" class="hdr-peach">ব্যাংক/বিকাশ</th>
          <th rowspan="2" class="hdr-peach">নগদ ব্যালেন্স</th>
          <th rowspan="2" class="hdr-peach">নগদ + ব্যাংক</th>
        </tr>
        <tr>
          <th class="hdr-peach">আয়ের মাধ্যম / ভাউচার</th>
          <th class="hdr-peach">নগদ টাকা</th>
          <th class="hdr-peach">ব্যাংক/বিকাশ</th>
          <th class="hdr-peach">ব্যয়ের মাধ্যম</th>
          <th class="hdr-peach">ব্যয়ের টাকা</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="text-center bold">${escapeHtml(sum.opening.prevDate)}</td>
          <td class="bold">পূর্বের ব্যালেন্স</td>
          <td class="text-right bg-green">${escapeHtml(fmtCell(sum.opening.cash))}</td>
          <td class="text-right bg-yellow">${escapeHtml(fmtCell(openBankCombined))}</td>
          <td class="bold">পূর্বের ব্যালেন্স</td>
          <td></td>
          <td class="text-right bg-green">${escapeHtml(fmtCell(sum.opening.cash))}</td>
          <td></td>
          <td class="text-right bg-yellow">${escapeHtml(fmtCell(openBankCombined))}</td>
          <td></td>
          <td></td>
        </tr>
        ${rowsHtml}
        ${blanksHtml}
      </tbody>
      <tfoot>
        <tr>
          <td></td>
          <td class="bold">ব্যাংকে/বিকাশে জমা আছে=</td>
          <td></td><td></td>
          <td class="text-right bold">ব্যাংকে/বিকাশে জমা আছে=</td>
          <td></td><td></td><td></td><td></td><td></td><td></td>
        </tr>
        <tr>
          <td></td><td></td>
          <td class="text-right bg-green">${escapeHtml(sum.totalCash.toLocaleString('en-US'))}</td>
          <td class="text-right bg-green">${escapeHtml(sum.totalBank.toLocaleString('en-US'))}</td>
          <td class="text-right bold">ক্যাশে জমা আছে=</td>
          <td class="text-right bg-yellow">${escapeHtml(sum.totalExp.toLocaleString('en-US'))}</td>
          <td class="text-right bg-green">${escapeHtml(sum.totalCash.toLocaleString('en-US'))}</td>
          <td class="text-right bg-yellow">${escapeHtml(sum.totalExp.toLocaleString('en-US'))}</td>
          <td class="text-right bg-green">${escapeHtml(sum.totalBank.toLocaleString('en-US'))}</td>
          <td class="text-right bg-green">${escapeHtml(sum.cashBalance.toLocaleString('en-US'))}</td>
          <td class="text-right bg-green">${escapeHtml(sum.grandTotal.toLocaleString('en-US'))}</td>
        </tr>
      </tfoot>
    </table>
  </div>
  <script>window.addEventListener('DOMContentLoaded', () => setTimeout(() => window.print(), 250));</script>
</body>
</html>`;
    openHtmlPrintTab(html);
  };

  const handlePrintReceipt = (r: ParsedTxRow) => {
    const rawAmt = r.incCash || r.incBank || r.expAmt || 0;
    const amt = Math.abs(rawAmt);
    const title = r.incSrc || r.expSrc || 'সাধারণ হিসাব';
    const receiptStudent = r.khataNo ? findStudentByKhata(r.khataNo) : null;
    const html = `<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8" />
  <title>Money Receipt - ${escapeHtml(r.voucher || 'ITTC')}</title>
  <style>
    body { font-family: "SolaimanLipi", "Nikosh", sans-serif; padding: 24px; color: #000; background: #fff; }
    .card { max-width: 480px; margin: 0 auto; border: 2px solid #000; padding: 18px; border-radius: 6px; }
    h3 { text-align: center; margin-bottom: 6px; font-size: 16px; }
    .sub { text-align: center; font-size: 12px; margin-bottom: 14px; }
    .row { display: flex; justify-content: space-between; margin: 8px 0; border-bottom: 1px dashed #999; padding-bottom: 4px; font-size: 13px; }
    .sigs { margin-top: 38px; display: flex; justify-content: space-between; font-size: 12px; }
    @media print { .no-print { display: none !important; } }
  </style>
</head>
<body>
  <div class="card">
    <h3>আইডিয়াল টেকনিক্যাল ট্রেনিং এন্ড টেস্টিং সেন্টার</h3>
    <div class="sub">মানি রিসিট / ক্যাশ ভাউচার</div>
    <div class="row"><span>ভাউচার নং:</span><strong>${escapeHtml(r.voucher || 'N/A')}</strong></div>
    ${r.khataNo ? `<div class="row"><span>খাতা নাম্বার:</span><strong>${escapeHtml(r.khataNo)}</strong></div>` : ''}
    ${receiptStudent ? `<div class="row"><span>ছাত্রের নাম:</span><strong>${escapeHtml(receiptStudent.name)}</strong></div>` : ''}
    <div class="row"><span>তারিখ:</span><strong>${escapeHtml(r.date)}</strong></div>
    <div class="row"><span>অ্যাকাউন্ট:</span><strong>${escapeHtml(r.account || 'Cash')}${r.incBank < 0 ? ' (ব্যাংক থেকে প্রদান)' : ''}</strong></div>
    <div class="row"><span>বিবরণ:</span><strong>${escapeHtml(title)}</strong></div>
    <div class="row"><span>পরিমাণ:</span><strong>৳ ${escapeHtml(amt.toLocaleString('en-US'))}</strong></div>
    <div class="sigs"><span>গ্রহীতার স্বাক্ষর</span><span>কর্তৃপক্ষের স্বাক্ষর</span></div>
  </div>
  <script>window.addEventListener('DOMContentLoaded', () => setTimeout(() => window.print(), 250));</script>
</body>
</html>`;
    openHtmlPrintTab(html);
  };

  // Calendar Helpers
  const openCalendarFor = (
    target: 'dashboard' | 'opening' | 'entry',
    seedDateStr?: string
  ) => {
    if (openCalendarTarget === target) {
      setOpenCalendarTarget(null);
      return;
    }
    const parsedSeed =
      (seedDateStr ? parseRowDateParts(seedDateStr) : null) ||
      parseRowDateParts(activeDate);
    if (parsedSeed) {
      setCalendarCursor({ year: parsedSeed.year, month: parsedSeed.month });
    } else {
      const now = new Date();
      setCalendarCursor({ year: now.getFullYear(), month: now.getMonth() + 1 });
    }
    setOpenCalendarTarget(target);
  };

  const renderCalendarPopover = (
    selectedRaw: string,
    onSelectEnDotDate: (enDotDate: string) => void,
    align: 'left' | 'right' = 'right'
  ) => {
    const { year, month } = calendarCursor;
    const firstWeekday = new Date(year, month - 1, 1).getDay();
    const daysInMonth = new Date(year, month, 0).getDate();
    const cells: Array<number | null> = [
      ...Array.from({ length: firstWeekday }, () => null),
      ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
    ];
    while (cells.length % 7 !== 0) cells.push(null);

    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(
      2,
      '0'
    )}-${String(today.getDate()).padStart(2, '0')}`;
    const selectedKey = selectedRaw ? canonicalDateKey(selectedRaw) : '';
    const alignClass =
      align === 'left'
        ? 'left-0'
        : 'left-1/2 -translate-x-1/2 xl:left-auto xl:right-0 xl:translate-x-0';

    const shiftMonth = (delta: number) => {
      const d = new Date(year, month - 1 + delta, 1);
      setCalendarCursor({ year: d.getFullYear(), month: d.getMonth() + 1 });
    };

    const makeEnDot = (d: number, m: number, y: number) =>
      `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`;

    return (
      <div
        className={`absolute top-full mt-2 z-50 w-[268px] rounded-xl border-[1.5px] border-[#17493d] bg-[#071412] p-3 shadow-2xl text-[#f1f5f9] ${alignClass}`}
      >
        <div className="flex items-center justify-between gap-1 mb-2.5">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            aria-label="আগের মাস"
            className="w-7 h-7 rounded-md border border-[#17493d] bg-[#091b18] hover:border-[#10b981] text-[#8ea8a1] hover:text-white flex items-center justify-center cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="text-[12.5px] font-bold text-[#10b981]">
            {BN_MONTHS[month - 1]} {enToBn(year)}
          </div>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            aria-label="পরের মাস"
            className="w-7 h-7 rounded-md border border-[#17493d] bg-[#091b18] hover:border-[#10b981] text-[#8ea8a1] hover:text-white flex items-center justify-center cursor-pointer"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold text-[#8ea8a1] mb-1">
          {BN_WEEKDAYS_SHORT.map((wd) => (
            <div key={wd} className="py-1">
              {wd}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {cells.map((day, idx) => {
            if (!day) return <div key={`empty-${idx}`} className="h-8" />;
            const cellKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const isSelected = selectedKey === cellKey;
            const isToday = todayKey === cellKey;
            const hasEntry = datesWithEntriesSet.has(cellKey);
            return (
              <button
                key={cellKey}
                type="button"
                onClick={() => {
                  onSelectEnDotDate(makeEnDot(day, month, year));
                  setOpenCalendarTarget(null);
                }}
                className={`relative h-8 rounded-md text-[11.5px] font-bold transition-colors flex items-center justify-center cursor-pointer ${
                  isSelected
                    ? 'bg-[#10b981] text-[#04100c]'
                    : isToday
                      ? 'bg-[#091b18] text-[#f1f5f9] ring-1 ring-[#10b981]/60 hover:bg-[#0e2924]'
                      : 'bg-[#091b18] text-[#f1f5f9] hover:bg-[#0e2924] hover:border-[#10b981]'
                }`}
              >
                <span>{enToBn(day)}</span>
                {hasEntry && (
                  <span
                    className={`absolute bottom-0.5 w-1.5 h-1.5 rounded-full ${
                      isSelected ? 'bg-[#04100c]' : 'bg-[#10b981]'
                    }`}
                  />
                )}
              </button>
            );
          })}
        </div>

        <div className="mt-2.5 pt-2 border-t border-[#17493d]/80 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              const t = new Date();
              onSelectEnDotDate(makeEnDot(t.getDate(), t.getMonth() + 1, t.getFullYear()));
              setOpenCalendarTarget(null);
            }}
            className="text-[11px] font-bold text-[#10b981] hover:underline cursor-pointer"
          >
            আজকের তারিখ
          </button>
          <span className="text-[10px] text-[#8ea8a1]">{formatBnDotDate(1, month, year).slice(3)}</span>
        </div>
      </div>
    );
  };

  const renderOfficialGraph = (items: OfficialGraphBar[], barColorHex: string) => {
    if (items.length === 0) {
      return (
        <div className="h-[165px] rounded-lg border border-[#17493d]/80 bg-[#091b18] px-2.5 pt-3 pb-2 flex items-center justify-center text-[11px] text-[#8ea8a1]">
          কোনো এন্ট্রি নেই
        </div>
      );
    }
    const maxVal = Math.max(...items.map((i) => i.val), 1);
    return (
      <div className="h-[165px] rounded-lg border border-[#17493d]/80 bg-[#091b18] px-2.5 pt-3 pb-2 flex items-end gap-2">
        {items.map((item, idx) => {
          const pxHeight = Math.max(12, Math.round((item.val / maxVal) * 110));
          return (
            <div
              key={`${item.label}-${idx}`}
              className="flex-1 h-full flex flex-col justify-end items-center gap-1 min-w-0"
            >
              <span className="text-[10px] font-bold text-[#f1f5f9] font-mono-num truncate">
                ৳{enToBn(item.val)}
              </span>
              <div
                className="w-full max-w-[34px] rounded-t min-h-[4px] transition-all duration-300"
                style={{ height: `${pxHeight}px`, backgroundColor: barColorHex }}
              />
              <span
                title={item.label}
                className="text-[9.5px] text-[#8ea8a1] truncate max-w-full"
              >
                {item.label}
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  const officialCards: Array<{
    key: OfficialKey;
    role: string;
    name: string;
    total: number;
    items: OfficialGraphBar[];
    nameClass: string;
    barHex: string;
  }> = [
    {
      key: 'md',
      role: 'MANAGING DIRECTOR',
      name: 'SABUJ KAZI',
      total: analytics.mdTotal,
      items: analytics.mdItems,
      nameClass: 'text-[#f97316]',
      barHex: '#f97316',
    },
    {
      key: 'dir',
      role: 'DIRECTOR',
      name: 'SOHEL KAZI',
      total: analytics.dirTotal,
      items: analytics.dirItems,
      nameClass: 'text-[#60a5fa]',
      barHex: '#60a5fa',
    },
    {
      key: 'gm',
      role: 'GENERAL MANAGER',
      name: 'SALIM MAHMMUD',
      total: analytics.gmTotal,
      items: analytics.gmItems,
      nameClass: 'text-[#c084fc]',
      barHex: '#c084fc',
    },
  ];

  const maxExpenseBar =
    analytics.topExpenseCategories.length > 0 ? analytics.topExpenseCategories[0][1] : 1;

  // ১. পাসওয়ার্ড লক স্ক্রিন
  if (!unlocked) {
    return (
      <div className="preserve-surface min-h-[calc(100vh-8rem)] rounded-2xl border-[1.5px] border-[#17493d] bg-[radial-gradient(circle_at_top,#0d2e28_0%,#040d0c_70%)] flex items-center justify-center p-5 text-[#f1f5f9]">
        <form
          onSubmit={handleUnlock}
          className="w-full max-w-[390px] bg-[#0a1f1c] border-[1.5px] border-[#17493d] rounded-xl p-6 flex flex-col gap-3.5"
        >
          <span className="inline-block w-fit bg-[rgba(16,185,129,0.16)] text-[#10b981] border border-[rgba(16,185,129,0.4)] px-2.5 py-0.5 rounded-full text-[11px] font-bold">
            PROTECTED MODULE
          </span>

          <div>
            <h1 className="text-[18px] font-extrabold text-[#f1f5f9]">GENERAL ACCOUNTS</h1>
            <p className="text-[12px] text-[#8ea8a1] mt-1 leading-relaxed">
              {(centerName || 'IDEAL TECHNICAL TRAINING & TESTING CENTER').toUpperCase()} — হিসাব
              বিভাগে প্রবেশ করতে পাসওয়ার্ড দিন{' '}
              {expectedPasscode === '1234' ? (
                <>
                  (ডিফল্ট পাসওয়ার্ড: <strong className="text-[#10b981]">1234</strong>)
                </>
              ) : (
                <>(Super Admin-এ নির্ধারিত পাসওয়ার্ড ব্যবহার করুন)</>
              )}
            </p>
          </div>

          <div className="relative">
            <input
              type={showPass ? 'text' : 'password'}
              value={passwordInput}
              onChange={(e) => {
                setPasswordInput(e.target.value);
                if (lockError) setLockError('');
              }}
              placeholder="পাসওয়ার্ড লিখুন..."
              required
              autoFocus
              className="w-full bg-[#091b18] border border-[#17493d] focus:border-[#10b981] text-[#f1f5f9] rounded-lg px-3 py-2.5 pr-10 text-sm outline-none"
            />
            <button
              type="button"
              onClick={() => setShowPass((v) => !v)}
              aria-label="Toggle password visibility"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8ea8a1] hover:text-white cursor-pointer"
            >
              {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          {lockError ? (
            <div className="text-xs font-semibold text-[#f87171] min-h-[16px]">{lockError}</div>
          ) : (
            <div className="min-h-[16px]" />
          )}

          <button
            type="submit"
            className="w-full inline-flex items-center justify-center gap-2 bg-[#10b981] hover:bg-emerald-400 text-[#04100c] font-bold text-xs py-2.5 rounded-md transition-colors cursor-pointer"
          >
            <Unlock className="w-4 h-4" />
            <span>🔓 লগইন করে প্রবেশ করুন</span>
          </button>
        </form>
      </div>
    );
  }

  const openSumAll =
    activeSummary.opening.cash + activeSummary.opening.bank + activeSummary.opening.bkash;
  const openBankCombined = activeSummary.opening.bank + activeSummary.opening.bkash;
  const slashDateBn = toBnDigitsString(activeDate.replace(/\./g, '/'));
  const blankPadCount = Math.max(0, 16 - filteredDayRows.length);

  // ২. লগইন করার পর GENERAL ACCOUNTS
  return (
    <div className="preserve-surface bg-[#040d0c] text-[#f1f5f9] min-h-screen w-full">
      <div className="grid grid-cols-1 lg:grid-cols-[225px_1fr] min-h-screen">
        {/* Accounts-Only Sidebar */}
        <aside className="bg-[#071412] border-b-[1.5px] lg:border-b-0 lg:border-r-[1.5px] border-[#17493d] px-2.5 py-3.5 flex flex-col justify-between gap-3.5">
          <div>
            <div className="flex items-center gap-2.5 px-2 pb-3 border-b border-[#17493d]">
              <div className="w-[34px] h-[34px] rounded-lg bg-[rgba(16,185,129,0.16)] border border-[#10b981] text-[#10b981] flex items-center justify-center font-bold text-xs shrink-0">
                GA
              </div>
              <div className="min-w-0">
                <div className="text-[13px] font-bold text-[#f1f5f9] truncate">
                  GENERAL ACCOUNTS
                </div>
                <div className="text-[10.5px] text-[#8ea8a1] truncate">
                  ITTC Center • Accounts Only
                </div>
              </div>
            </div>

            <div className="flex flex-row lg:flex-col gap-1.5 mt-2.5">
              <button
                type="button"
                onClick={() => setActivePane('dashboardPane')}
                className={`flex-1 lg:w-full text-left rounded-lg px-3 py-2.5 text-[12.5px] flex items-center gap-2 transition-colors cursor-pointer ${
                  activePane === 'dashboardPane'
                    ? 'bg-[#10b981] text-[#04100c] font-bold'
                    : 'bg-transparent text-[#8ea8a1] hover:bg-[#091b18] hover:text-[#f1f5f9] font-semibold'
                }`}
              >
                <LayoutDashboard className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">📊 হিসাব সামারি (Dashboard)</span>
              </button>

              <button
                type="button"
                onClick={() => setActivePane('sheetPane')}
                className={`flex-1 lg:w-full text-left rounded-lg px-3 py-2.5 text-[12.5px] flex items-center gap-2 transition-colors cursor-pointer ${
                  activePane === 'sheetPane'
                    ? 'bg-[#10b981] text-[#04100c] font-bold'
                    : 'bg-transparent text-[#8ea8a1] hover:bg-[#091b18] hover:text-[#f1f5f9] font-semibold'
                }`}
              >
                <FileSpreadsheet className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">📑 নতুন হিসাব লেনদেন</span>
              </button>

              <button
                type="button"
                onClick={() => setActivePane('monthlyPane')}
                className={`flex-1 lg:w-full text-left rounded-lg px-3 py-2.5 text-[12.5px] flex items-center gap-2 transition-colors cursor-pointer ${
                  activePane === 'monthlyPane'
                    ? 'bg-[#10b981] text-[#04100c] font-bold'
                    : 'bg-transparent text-[#8ea8a1] hover:bg-[#091b18] hover:text-[#f1f5f9] font-semibold'
                }`}
              >
                <Calendar className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">📅 মাসিক হিসাব (১–৩১)</span>
              </button>

              <button
                type="button"
                onClick={() => setActivePane('officialProfilePane')}
                className={`flex-1 lg:w-full text-left rounded-lg px-3 py-2.5 text-[12.5px] flex items-center gap-2 transition-colors cursor-pointer ${
                  activePane === 'officialProfilePane'
                    ? 'bg-[#10b981] text-[#04100c] font-bold'
                    : 'bg-transparent text-[#8ea8a1] hover:bg-[#091b18] hover:text-[#f1f5f9] font-semibold'
                }`}
              >
                <User className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">👤 কর্মকর্তা প্রোফাইল</span>
              </button>

              <button
                type="button"
                onClick={() => setActivePane('toolsPane')}
                className={`flex-1 lg:w-full text-left rounded-lg px-3 py-2.5 text-[12.5px] flex items-center gap-2 transition-colors cursor-pointer ${
                  activePane === 'toolsPane'
                    ? 'bg-[#10b981] text-[#04100c] font-bold'
                    : 'bg-transparent text-[#8ea8a1] hover:bg-[#091b18] hover:text-[#f1f5f9] font-semibold'
                }`}
              >
                <Download className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">📂 ব্যাকআপ ও এক্সপোর্ট</span>
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={handleLock}
            className="w-full inline-flex items-center justify-center gap-1.5 bg-[#091b18] hover:bg-[#0e2924] text-[#f1f5f9] border border-[#17493d] rounded-md px-3 py-2 text-xs font-bold transition-colors cursor-pointer"
          >
            <Lock className="w-3.5 h-3.5" />
            <span>🔒 Lock Accounts</span>
          </button>
        </aside>

        {/* Main Content */}
        <div className="flex flex-col min-w-0">
          {/* Hidden File Inputs for Restore JSON & Import Excel */}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            onChange={handleImportJsonFile}
            className="hidden"
          />
          <input
            ref={excelImportInputRef}
            type="file"
            accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
            multiple
            onChange={handleExcelImportSelect}
            className="hidden"
          />

          {/* Topbar */}
          <header className="bg-[#071412] border-b-[1.5px] border-[#17493d] px-[18px] py-2.5 flex flex-wrap items-center justify-between gap-2.5">
            <div>
              <h2 className="text-[15px] font-bold text-[#f1f5f9]">
                {(centerName || 'IDEAL TECHNICAL TRAINING & TESTING CENTER').toUpperCase()}
              </h2>
              <span className="text-[11px] text-[#8ea8a1]">
                GENERAL ACCOUNTS • হিসাব লেনদেন ও সামারি
              </span>
            </div>
          </header>

          <div className="px-[18px] pt-3.5 pb-6 space-y-3">
            {notice && (
              <div
                className={`px-3.5 py-2.5 rounded-lg border text-xs font-semibold flex items-center justify-between gap-2 ${
                  notice.type === 'success'
                    ? 'bg-emerald-950/60 border-emerald-700 text-emerald-300'
                    : 'bg-rose-950/60 border-rose-700 text-rose-300'
                }`}
              >
                <span>{notice.text}</span>
                <button
                  type="button"
                  onClick={() => setNotice(null)}
                  className="underline opacity-80 hover:opacity-100 cursor-pointer"
                >
                  {bn ? 'বন্ধ করুন' : 'Dismiss'}
                </button>
              </div>
            )}

            {confirmClearAll && (
              <div className="px-4 py-3 rounded-lg border border-rose-500/60 bg-rose-950/40 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs font-semibold text-rose-200">
                  সব হিসাব লেনদেন ও পূর্বের ব্যালেন্স মুছে ফেলতে চান? (এই কাজটি ফিরিয়ে আনা যাবে না)
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleClearAllRows()}
                    disabled={busy}
                    className="px-3 py-1.5 rounded-md bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                  >
                    হ্যাঁ, সব মুছে ফেলুন
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClearAll(false)}
                    className="px-3 py-1.5 rounded-md border border-[#17493d] bg-[#091b18] text-xs font-semibold text-slate-200 cursor-pointer"
                  >
                    বাতিল
                  </button>
                </div>
              </div>
            )}

            {activePane === 'toolsPane' && txRows.length === 0 && openingRows.length === 0 && (
              <div className="px-4 py-3 rounded-lg border border-dashed border-[#10b981]/50 bg-[#0a1f1c] flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs font-medium text-slate-200">
                  GENERAL ACCOUNTS শীটটি বর্তমানে খালি। আগের দিনের Excel ফাইল যোগ করতে নিচের{' '}
                  <strong>📥 Import Excel (.xlsx)</strong> ব্যবহার করুন অথবা{' '}
                  <strong>নতুন হিসাব লেনদেন</strong> থেকে লেনদেন যুক্ত করুন।
                </div>
              </div>
            )}

            {/* ট্যাব ১: হিসাব সামারি ড্যাশবোর্ড */}
            {activePane === 'dashboardPane' && (
              <div className="space-y-3">
                {/* Top Strip + Calendar Date Selector */}
                <div className="bg-[#0a1f1c] border-[1.5px] border-[#17493d] rounded-[10px] px-4 py-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-[1fr_1fr_1fr_1fr_230px] gap-3.5 items-center">
                  <div className="flex flex-col items-center text-center gap-0.5 xl:border-r xl:border-[#17493d]/70 xl:pr-2">
                    <span className="text-[11px] font-semibold text-[#8ea8a1]">মোট নগদ টাকা</span>
                    <span className="text-[17px] font-bold text-[#34d399] font-mono-num">
                      ৳{enToBn(activeSummary.totalCash) || '০'}
                    </span>
                    <span className="text-[10.5px] text-[#8ea8a1]">
                      পূর্বের: ৳{enToBn(activeSummary.opening.cash) || '০'} + নতুন: ৳
                      {enToBn(activeSummary.newCashIn) || '০'}
                    </span>
                  </div>

                  <div className="flex flex-col items-center text-center gap-0.5 xl:border-r xl:border-[#17493d]/70 xl:pr-2">
                    <span className="text-[11px] font-semibold text-[#8ea8a1]">মোট ব্যয়ের টাকা</span>
                    <span className="text-[17px] font-bold text-[#f472b6] font-mono-num">
                      ৳{enToBn(activeSummary.totalExp) || '০'}
                    </span>
                    <span className="text-[10.5px] text-[#8ea8a1]">ব্যাংক জমা ও সকল খরচসহ</span>
                  </div>

                  <div className="flex flex-col items-center text-center gap-0.5 xl:border-r xl:border-[#17493d]/70 xl:pr-2">
                    <span className="text-[11px] font-semibold text-[#8ea8a1]">
                      ব্যাংক ও Bkash জমা
                    </span>
                    <span className="text-[17px] font-bold text-[#60a5fa] font-mono-num">
                      ৳{enToBn(activeSummary.totalBank) || '০'}
                    </span>
                    <span className="text-[10.5px] text-[#8ea8a1]">Bank ও Bkash ব্যালেন্স</span>
                  </div>

                  <div className="flex flex-col items-center text-center gap-0.5">
                    <span className="text-[11px] font-semibold text-[#8ea8a1]">
                      নগদ ব্যালেন্স / (নগদ + ব্যাংক)
                    </span>
                    <span className="text-[17px] font-bold text-[#f1f5f9] font-mono-num">
                      ৳{enToBn(activeSummary.cashBalance) || '০'} / ৳
                      {enToBn(activeSummary.grandTotal) || '০'}
                    </span>
                    <span className="text-[10.5px] text-[#8ea8a1]">হাতে নগদ ও সর্বমোট ব্যালেন্স</span>
                  </div>

                  <div
                    ref={dashboardCalRef}
                    className="relative sm:col-span-2 lg:col-span-4 xl:col-span-1 flex flex-col items-center gap-1.5"
                  >
                    <span className="text-[11.5px] font-bold text-[#f1f5f9]">
                      তারিখ সিলেক্ট করুন
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => stepActiveDate(-1)}
                        aria-label="আগের দিন"
                        className="bg-[#091b18] hover:border-[#10b981] text-[#f1f5f9] border border-[#17493d] rounded-[5px] px-2 py-1 text-xs font-bold cursor-pointer"
                      >
                        ‹
                      </button>
                      <button
                        type="button"
                        onClick={() => openCalendarFor('dashboard', activeDate)}
                        className="inline-flex items-center gap-1.5 bg-[#10b981] hover:bg-emerald-400 text-[#04100c] rounded-[5px] px-3 py-1 text-[11.5px] font-bold transition-colors cursor-pointer"
                      >
                        <Calendar className="w-3.5 h-3.5 shrink-0" />
                        <span>{toBnDigitsString(activeDate)}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => stepActiveDate(1)}
                        aria-label="পরের দিন"
                        className="bg-[#091b18] hover:border-[#10b981] text-[#f1f5f9] border border-[#17493d] rounded-[5px] px-2 py-1 text-xs font-bold cursor-pointer"
                      >
                        ›
                      </button>
                    </div>
                    <span className="text-[10px] text-[#8ea8a1]">{dayName}</span>

                    {openCalendarTarget === 'dashboard' &&
                      renderCalendarPopover(activeDate, (picked) => changeActiveDate(picked), 'right')}
                  </div>
                </div>

                {/* পূর্বের ব্যালেন্স সেট ও এডিট বার */}
                <div className="bg-[#0a1f1c] border-[1.5px] border-[#17493d] rounded-[10px] px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12.5px] font-bold text-[#10b981]">
                      📌 পূর্বের ব্যালেন্স (Opening Balance)
                    </span>
                    {!activeSummary.opening.isManual && hasPriorDay ? (
                      <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/40 text-emerald-300">
                        অটো: {toBnDigitsString(activeSummary.opening.prevDate)}-এর নগদ ব্যালেন্স থেকে
                      </span>
                    ) : activeSummary.opening.isManual ? (
                      <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/40 text-amber-300">
                        ম্যানুয়াল সেট করা
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2.5">
                    <div
                      ref={openingCalRef}
                      className="relative flex items-center gap-1.5 text-xs text-[#8ea8a1]"
                    >
                      <span>তারিখ:</span>
                      <div className="flex items-center bg-[#091b18] border border-[#17493d] focus-within:border-[#10b981] rounded-md overflow-hidden">
                        <input
                          type="text"
                          value={openingDateDraft}
                          onChange={(e) => setOpeningDateDraft(e.target.value)}
                          className="w-[88px] bg-transparent text-[#f1f5f9] px-2 py-1 text-xs font-bold outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => openCalendarFor('opening', openingDateDraft)}
                          aria-label="পূর্বের ব্যালেন্স ক্যালেন্ডার"
                          className="px-1.5 py-1 text-[#10b981] hover:bg-[#0e2924] cursor-pointer"
                        >
                          <Calendar className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {openCalendarTarget === 'opening' &&
                        renderCalendarPopover(
                          openingDateDraft,
                          (picked) => setOpeningDateDraft(picked),
                          'left'
                        )}
                    </div>

                    <label className="flex items-center gap-1.5 text-xs text-[#8ea8a1]">
                      <span>Cash:</span>
                      <input
                        type="number"
                        value={openingCashDraft}
                        onChange={(e) => setOpeningCashDraft(e.target.value)}
                        className="w-[105px] bg-[#091b18] border border-[#17493d] focus:border-[#10b981] text-[#f1f5f9] rounded-md px-2 py-1 text-xs font-bold outline-none"
                      />
                    </label>

                    <label className="flex items-center gap-1.5 text-xs text-[#8ea8a1]">
                      <span>Bank:</span>
                      <input
                        type="number"
                        value={openingBankDraft}
                        onChange={(e) => setOpeningBankDraft(e.target.value)}
                        className="w-[105px] bg-[#091b18] border border-[#17493d] focus:border-[#10b981] text-[#f1f5f9] rounded-md px-2 py-1 text-xs font-bold outline-none"
                      />
                    </label>

                    <label className="flex items-center gap-1.5 text-xs text-[#8ea8a1]">
                      <span>Bkash:</span>
                      <input
                        type="number"
                        value={openingBkashDraft}
                        onChange={(e) => setOpeningBkashDraft(e.target.value)}
                        className="w-[95px] bg-[#091b18] border border-[#17493d] focus:border-[#10b981] text-[#f1f5f9] rounded-md px-2 py-1 text-xs font-bold outline-none"
                      />
                    </label>

                    <button
                      type="button"
                      onClick={() => void handleSaveOpening()}
                      disabled={busy}
                      className="bg-[#10b981] hover:bg-emerald-400 text-[#04100c] font-bold text-xs px-3 py-1.5 rounded-md transition-colors cursor-pointer"
                    >
                      সংরক্ষণ
                    </button>

                    {activeSummary.opening.isManual && hasPriorDay && (
                      <button
                        type="button"
                        onClick={() => void handleResetOpeningToAuto()}
                        disabled={busy}
                        title="ম্যানুয়াল ব্যালেন্স সরিয়ে আগের দিনের নগদ ব্যালেন্স থেকে অটো হিসাব করুন"
                        className="bg-[#091b18] hover:bg-[#0e2924] text-[#34d399] border border-[#10b981]/50 font-bold text-xs px-2.5 py-1.5 rounded-md transition-colors cursor-pointer disabled:opacity-50"
                      >
                        🔄 আগের দিনের ব্যালেন্স নিন
                      </button>
                    )}
                  </div>
                </div>

                {/* ৪টি দৈনিক Purpose জমা কার্ড (বিস্তারিত বিবরণ ও PDF ডাউনলোডসহ) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                  {PURPOSE_CATEGORY_CARDS.map((cat) => {
                    const totalVal =
                      cat.key === 'welding'
                        ? analytics.weldingTotal
                        : cat.key === 'fitter'
                          ? analytics.fitterTotal
                          : cat.key === 'visa'
                            ? analytics.visaTotal
                            : analytics.ppeTotal;
                    const countVal =
                      cat.key === 'welding'
                        ? analytics.weldingCount
                        : cat.key === 'fitter'
                          ? analytics.fitterCount
                          : cat.key === 'visa'
                            ? analytics.visaCount
                            : analytics.ppeCount;
                    return (
                      <div
                        key={cat.key}
                        className="bg-[#0a1f1c] border-[1.5px] border-[#17493d] hover:border-[#10b981]/60 rounded-[10px] px-4 py-3.5 flex flex-col justify-between gap-2 transition-colors"
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="text-[11px] font-bold text-[#8ea8a1]">{cat.titleBn}</span>
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#091b18] border border-[#17493d] text-[#cbd5e1]">
                              {enToBn(countVal) || '০'} টি
                            </span>
                          </div>
                          <div className={`text-[19px] font-bold font-mono-num ${cat.textClass}`}>
                            ৳{enToBn(totalVal) || '০'}
                          </div>
                          <div className="text-[10.5px] text-[#8ea8a1] mt-0.5">{cat.subtitle}</div>
                        </div>

                        <div className="pt-2 border-t border-[#17493d]/70 flex items-center justify-between gap-1.5">
                          <button
                            type="button"
                            onClick={() => openPurposeModal(cat.key, 'active_date')}
                            className="flex-1 inline-flex items-center justify-center gap-1 px-2.5 py-1 rounded-md bg-[#091b18] hover:bg-[#0e2924] border border-[#17493d] hover:border-[#10b981] text-[11px] font-bold text-[#34d399] cursor-pointer transition-colors"
                          >
                            <Eye className="w-3 h-3" />
                            <span>বিবরণ দেখুন</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handlePrintPurposePdf(cat.key, 'active_date')}
                            className="inline-flex items-center justify-center gap-1 px-2.5 py-1 rounded-md bg-[#ec4899]/15 hover:bg-[#ec4899]/30 border border-[#ec4899]/50 text-[11px] font-bold text-[#f9a8d4] cursor-pointer transition-colors"
                          >
                            <Printer className="w-3 h-3" />
                            <span>PDF</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* ৩ জন কর্মকর্তার হিসাব, ক্যালেন্ডার ফিল্টার ও গ্রাফ */}
                <div className="bg-[#0a1f1c] border-[1.5px] border-[#17493d] rounded-[10px] p-3.5 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2.5 pb-2.5 border-b border-[#17493d]/80">
                    <div>
                      <div className="text-[13px] font-bold text-[#f1f5f9]">
                        👤 ৩ জন কর্মকর্তার হিসাব ও ক্যালেন্ডার ফিল্টার
                      </div>
                      <div className="text-[11px] text-[#8ea8a1]">
                        কোন তারিখে কে কত টাকা নিয়েছে তা তারিখ থেকে তারিখ অনুযায়ী ফিল্টার করুন
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setDashOffFilterEnabled((v) => !v)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold border cursor-pointer transition-colors ${
                          dashOffFilterEnabled
                            ? 'bg-[#10b981] text-[#04100c] border-[#10b981]'
                            : 'bg-[#091b18] text-[#34d399] border-[#17493d] hover:border-[#10b981]'
                        }`}
                      >
                        <Calendar className="w-3.5 h-3.5" />
                        <span>
                          {dashOffFilterEnabled ? 'নির্বাচিত দিন দেখান' : 'তারিখ রেঞ্জ ক্যালেন্ডার ফিল্টার'}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setOfficialPeriodMode('range');
                          setOfficialRangeFromKey(dashOffFromKey);
                          setOfficialRangeToKey(dashOffToKey);
                          setOfficialScope('all_officials');
                          setActivePane('officialProfilePane');
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#2563eb]/20 hover:bg-[#2563eb]/35 border border-[#2563eb]/50 text-xs font-bold text-[#93c5fd] cursor-pointer"
                      >
                        <span>পূর্ণ বিবরণ ও PDF</span>
                      </button>
                    </div>
                  </div>

                  {dashOffFilterEnabled && (
                    <div className="bg-[#091b18] border border-[#17493d] rounded-lg p-3 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2.5">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <label className="flex items-center gap-1.5">
                            <span className="text-[#8ea8a1] font-semibold">শুরুর তারিখ:</span>
                            <input
                              type="date"
                              value={dashOffFromKey}
                              onChange={(e) => setDashOffFromKey(e.target.value)}
                              className="bg-[#071412] border border-[#17493d] focus:border-[#10b981] text-[#f1f5f9] rounded px-2 py-1 text-xs font-bold outline-none"
                            />
                          </label>
                          <label className="flex items-center gap-1.5">
                            <span className="text-[#8ea8a1] font-semibold">শেষ তারিখ:</span>
                            <input
                              type="date"
                              value={dashOffToKey}
                              onChange={(e) => setDashOffToKey(e.target.value)}
                              className="bg-[#071412] border border-[#17493d] focus:border-[#10b981] text-[#f1f5f9] rounded px-2 py-1 text-xs font-bold outline-none"
                            />
                          </label>
                          <select
                            value={dashOffPerson}
                            onChange={(e) => setDashOffPerson(e.target.value as 'all' | OfficialKey)}
                            className="bg-[#071412] border border-[#17493d] text-[#f1f5f9] rounded px-2.5 py-1 text-xs font-bold outline-none"
                          >
                            <option value="all">সকল ৩ জন কর্মকর্তা</option>
                            <option value="md">সবুজ কাজী (MD)</option>
                            <option value="dir">সোহেল কাজী (Director)</option>
                            <option value="gm">সেলিম মাহমুদ (GM)</option>
                          </select>
                        </div>

                        <div className="text-xs font-bold text-[#34d399] font-mono-num">
                          মোট ({formatIsoToBnDot(dashOfficialFiltered.fromK)} –{' '}
                          {formatIsoToBnDot(dashOfficialFiltered.toK)}): ৳
                          {dashOfficialFiltered.grandTotal.toLocaleString('en-US')}
                        </div>
                      </div>

                      <div className="overflow-x-auto max-h-64 overflow-y-auto border border-[#17493d] rounded-md">
                        <table className="w-full text-xs border-collapse">
                          <thead>
                            <tr className="bg-[#071412] text-[#8ea8a1] border-b border-[#17493d]">
                              <th className="py-2 px-2.5 text-center w-10">নং</th>
                              <th className="py-2 px-2.5 text-center w-24">তারিখ</th>
                              <th className="py-2 px-2.5 text-left">কর্মকর্তা</th>
                              <th className="py-2 px-2.5 text-left">বিবরণ</th>
                              <th className="py-2 px-2.5 text-right w-28">টাকা (৳)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {dashOfficialFiltered.entries.length === 0 ? (
                              <tr>
                                <td colSpan={5} className="py-5 text-center text-[#8ea8a1]">
                                  নির্বাচিত তারিখে কোনো তথ্য পাওয়া যায়নি।
                                </td>
                              </tr>
                            ) : (
                              dashOfficialFiltered.entries.map((entry, idx) => (
                                <tr
                                  key={`${entry.id}-${idx}`}
                                  className="border-b border-[#17493d]/50 hover:bg-[#0a1f1c]"
                                >
                                  <td className="py-1.5 px-2.5 text-center text-[#8ea8a1] font-mono-num">
                                    {enToBn(idx + 1)}
                                  </td>
                                  <td className="py-1.5 px-2.5 text-center font-bold text-[#f1f5f9] font-mono-num whitespace-nowrap">
                                    {toBnDigitsString(entry.date)}
                                  </td>
                                  <td className={`py-1.5 px-2.5 font-bold ${entry.meta.textClass}`}>
                                    {entry.meta.nameBn}
                                  </td>
                                  <td className="py-1.5 px-2.5 text-[#f1f5f9]">{entry.expSrc}</td>
                                  <td className="py-1.5 px-2.5 text-right font-bold text-[#f472b6] font-mono-num whitespace-nowrap">
                                    ৳{entry.amount.toLocaleString('en-US')}
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                    {officialCards.map((card) => {
                      const meta = OFFICIAL_PROFILES[card.key];
                      const life = officialProfilesData[card.key];
                      const displayAmt = dashOffFilterEnabled
                        ? dashOfficialFiltered.totals[card.key]
                        : card.total;
                      return (
                        <div
                          key={card.key}
                          className="bg-[#091b18] border-[1.5px] border-[#17493d] rounded-[10px] px-4 py-3.5 flex flex-col gap-2"
                        >
                          <div className="text-[10.5px] font-bold text-[#8ea8a1] text-center">
                            {card.role}
                          </div>
                          <div className={`text-[14.5px] font-bold text-center ${card.nameClass}`}>
                            {card.name} ({meta.nameBn})
                          </div>
                          <div className="text-[21px] font-bold text-[#f472b6] text-center font-mono-num">
                            ৳{enToBn(displayAmt) || '০'}
                          </div>
                          {renderOfficialGraph(card.items, card.barHex)}
                          <div className="pt-1.5 mt-0.5 border-t border-[#17493d]/70 flex items-center justify-between gap-2">
                            <span className="text-[10.5px] text-[#8ea8a1]">
                              সর্বমোট:{' '}
                              <strong className="text-[#f1f5f9] font-mono-num">
                                ৳{enToBn(life.lifetimeTotal) || '০'}
                              </strong>
                            </span>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => openOfficialProfile(card.key)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#071412] hover:bg-[#0e2924] border border-[#17493d] hover:border-[#10b981] text-[11px] font-bold text-[#34d399] cursor-pointer transition-colors"
                              >
                                <User className="w-3 h-3" />
                                <span>প্রোফাইল ও বিবরণ</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handlePrintOfficialProfile(card.key, 'all')}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#2563eb]/20 hover:bg-[#2563eb]/35 border border-[#2563eb]/50 text-[11px] font-bold text-[#93c5fd] cursor-pointer transition-colors"
                              >
                                <Printer className="w-3 h-3" />
                                <span>PDF</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Bottom 2-Column Section */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <div className="bg-[#0a1f1c] border-[1.5px] border-[#17493d] rounded-[10px] px-4 py-3.5">
                    <div className="text-center text-[13px] font-bold text-[#f1f5f9] mb-2.5">
                      খাত অনুযায়ী ব্যয়ের ব্রেকডাউন (Expenses by Category)
                    </div>
                    <div className="space-y-2">
                      {analytics.topExpenseCategories.length === 0 ? (
                        <div className="text-xs text-[#8ea8a1] text-center py-4">
                          এই তারিখে কোনো ব্যয় নেই।
                        </div>
                      ) : (
                        analytics.topExpenseCategories.map(([label, val]) => {
                          const pct = Math.max(6, Math.round((val / maxExpenseBar) * 100));
                          return (
                            <div
                              key={label}
                              className="grid grid-cols-[145px_1fr_auto] gap-2 items-center text-[11.5px]"
                            >
                              <span className="text-[#8ea8a1] truncate" title={label}>
                                {label}
                              </span>
                              <div className="h-[14px] bg-[#091b18] rounded-[3px] overflow-hidden">
                                <div
                                  className="h-full bg-[#ec4899] transition-all"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <strong className="text-[#f1f5f9] font-mono-num">
                                ৳{enToBn(val)}
                              </strong>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  <div className="bg-[#0a1f1c] border-[1.5px] border-[#17493d] rounded-[10px] px-4 py-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                      <div className="text-[13px] font-bold text-[#f1f5f9]">
                        দৈনিক Purpose সামারি
                      </div>
                      <button
                        type="button"
                        onClick={() => setActivePane('sheetPane')}
                        className="inline-flex items-center gap-1.5 bg-[#10b981] hover:bg-emerald-400 text-[#04100c] rounded-md px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer"
                      >
                        <span>📑 নতুন হিসাব লেনদেনে যান →</span>
                      </button>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs text-left border-collapse">
                        <thead>
                          <tr className="border-b border-[#17493d]/70 text-[#8ea8a1] text-[11px]">
                            <th className="py-2 px-2">তারিখ</th>
                            <th className="py-2 px-2">Welding Job</th>
                            <th className="py-2 px-2">Fitter Fee</th>
                            <th className="py-2 px-2">Visa Fee</th>
                            <th className="py-2 px-2">P.P.E</th>
                          </tr>
                        </thead>
                        <tbody>
                          {analytics.dailyPurposeSummary.map((row) => (
                            <tr key={row.date} className="border-b border-[#17493d]/60">
                              <td className="py-2 px-2 font-bold text-[#f1f5f9]">
                                {toBnDigitsString(row.date)}
                              </td>
                              <td className="py-2 px-2 font-mono-num text-[#60a5fa] font-bold">
                                ৳{enToBn(row.welding) || '০'}
                              </td>
                              <td className="py-2 px-2 font-mono-num text-[#a78bfa] font-bold">
                                ৳{enToBn(row.fitter) || '০'}
                              </td>
                              <td className="py-2 px-2 font-mono-num text-[#fb923c] font-bold">
                                ৳{enToBn(row.visa) || '০'}
                              </td>
                              <td className="py-2 px-2 font-mono-num text-[#34d399] font-bold">
                                ৳{enToBn(row.ppe) || '০'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ট্যাব ২: নতুন হিসাব লেনদেন ও দৈনিক শীট */}
            {activePane === 'sheetPane' && (
              <div className="space-y-3">
                {/* ৪টি টপ সামারি কার্ড */}
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                  <div className="bg-[#0a1f1c] border-[1.5px] border-[#17493d] rounded-[10px] px-4 py-3 flex flex-col gap-0.5">
                    <span className="text-[11px] font-semibold text-[#8ea8a1]">
                      Opening (Cash + Bank + Bkash)
                    </span>
                    <span className="text-[19px] font-bold text-[#f1f5f9] font-mono-num">
                      ৳ {openSumAll.toLocaleString('en-US')}
                    </span>
                    <span className="text-[10.5px] text-[#8ea8a1]">
                      Cash ৳{activeSummary.opening.cash.toLocaleString('en-US')} • Bank ৳
                      {activeSummary.opening.bank.toLocaleString('en-US')} • Bkash ৳
                      {activeSummary.opening.bkash.toLocaleString('en-US')}
                    </span>
                  </div>

                  <div className="bg-[#0a1f1c] border-[1.5px] border-[#17493d] rounded-[10px] px-4 py-3 flex flex-col gap-0.5">
                    <span className="text-[11px] font-semibold text-[#8ea8a1]">
                      Today&apos;s Cash In
                    </span>
                    <span className="text-[19px] font-bold text-[#34d399] font-mono-num">
                      +৳ {activeSummary.newCashIn.toLocaleString('en-US')}
                    </span>
                    <span className="text-[10.5px] text-[#8ea8a1]">
                      {activeSummary.dayRows.length} entries today
                    </span>
                  </div>

                  <div className="bg-[#0a1f1c] border-[1.5px] border-[#17493d] rounded-[10px] px-4 py-3 flex flex-col gap-0.5">
                    <span className="text-[11px] font-semibold text-[#8ea8a1]">
                      Today&apos;s Expense
                    </span>
                    <span className="text-[19px] font-bold text-[#f472b6] font-mono-num">
                      -৳ {activeSummary.totalExp.toLocaleString('en-US')}
                    </span>
                    <span className="text-[10.5px] text-[#8ea8a1]">
                      Bank/Bkash নিট{' '}
                      {activeSummary.newBankBkashIn >= 0
                        ? `+৳${activeSummary.newBankBkashIn.toLocaleString('en-US')}`
                        : `-৳${Math.abs(activeSummary.newBankBkashIn).toLocaleString('en-US')}`}
                    </span>
                  </div>

                  <div className="bg-[#0a1f1c] border-[1.5px] border-[#17493d] rounded-[10px] px-4 py-3 flex flex-col gap-0.5">
                    <span className="text-[11px] font-semibold text-[#8ea8a1]">
                      Closing Balance
                    </span>
                    <span className="text-[19px] font-bold text-[#60a5fa] font-mono-num">
                      ৳ {activeSummary.grandTotal.toLocaleString('en-US')}
                    </span>
                    <span className="text-[10.5px] text-[#8ea8a1]">
                      হাতে নগদ ৳{activeSummary.cashBalance.toLocaleString('en-US')}
                    </span>
                  </div>
                </div>

                {/* নতুন হিসাব লেনদেন এন্ট্রি বক্স */}
                <div className="bg-[#0a1f1c] border-[1.5px] border-[#17493d] rounded-[10px] px-4 py-3.5 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2.5 pb-2 border-b border-[#17493d]/70">
                    <div ref={entryCalRef} className="relative flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => stepActiveDate(-1)}
                        className="bg-[#091b18] text-[#f1f5f9] border border-[#17493d] hover:border-[#10b981] rounded-md px-2.5 py-1 text-xs font-bold cursor-pointer"
                      >
                        ‹
                      </button>
                      <div className="flex items-center bg-[#091b18] border border-[#17493d] focus-within:border-[#10b981] rounded-md overflow-hidden">
                        <input
                          type="text"
                          value={activeDate}
                          onChange={(e) => {
                            const val = e.target.value;
                            setUserPickedDate(true);
                            setActiveDate(val);
                          }}
                          className="w-[95px] bg-transparent text-[#f1f5f9] px-2.5 py-1 text-xs font-bold outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => openCalendarFor('entry', activeDate)}
                          aria-label="তারিখ ক্যালেন্ডার"
                          className="px-2 py-1 text-[#10b981] hover:bg-[#0e2924] cursor-pointer"
                        >
                          <Calendar className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => stepActiveDate(1)}
                        className="bg-[#091b18] text-[#f1f5f9] border border-[#17493d] hover:border-[#10b981] rounded-md px-2.5 py-1 text-xs font-bold cursor-pointer"
                      >
                        ›
                      </button>
                      <span className="text-xs text-[#8ea8a1] ml-1.5">
                        {dayName} • Auto carry-forward
                      </span>

                      {openCalendarTarget === 'entry' &&
                        renderCalendarPopover(
                          activeDate,
                          (picked) => changeActiveDate(picked),
                          'left'
                        )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleToggleDayLock()}
                        disabled={busy}
                        className={`rounded-md px-3 py-1.5 text-xs font-bold border transition-colors cursor-pointer ${
                          isDayLocked
                            ? 'bg-[#dc2626] text-white border-[#dc2626]'
                            : 'bg-[#091b18] text-[#f1f5f9] border-[#17493d] hover:border-[#10b981]'
                        }`}
                      >
                        {isDayLocked ? '🔒 Day Locked' : '🔓 Day Unlocked'}
                      </button>

                      <button
                        type="button"
                        onClick={() => excelImportInputRef.current?.click()}
                        disabled={busy || excelImportLoading}
                        className="inline-flex items-center gap-1 bg-[#0f2e28] hover:bg-[#143d35] text-[#34d399] border border-[#10b981]/60 rounded-md px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer disabled:opacity-60"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>
                          {excelImportLoading ? 'লোড হচ্ছে...' : '📥 Import Excel (.xlsx)'}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => void handleExportStyledExcel()}
                        className="bg-[#10b981] hover:bg-emerald-400 text-[#04100c] rounded-md px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer"
                      >
                        📊 Export Excel (.xlsx)
                      </button>

                      <button
                        type="button"
                        onClick={handlePrintSheetPdf}
                        className="bg-[#2563eb] hover:bg-blue-700 text-white rounded-md px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer"
                      >
                        🖨 Print / PDF
                      </button>
                    </div>
                  </div>

                  {/* Mode Switch Row */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setEntryMode('income')}
                        className={`rounded-[7px] px-3 py-1.5 text-xs font-bold border transition-colors cursor-pointer ${
                          entryMode === 'income'
                            ? 'bg-[#16a34a] text-white border-[#16a34a]'
                            : 'bg-[#091b18] text-[#f1f5f9] border-[#17493d]'
                        }`}
                      >
                        ⊕ Income (+)
                      </button>
                      <button
                        type="button"
                        onClick={() => setEntryMode('expense')}
                        className={`rounded-[7px] px-3 py-1.5 text-xs font-bold border transition-colors cursor-pointer ${
                          entryMode === 'expense'
                            ? 'bg-[#dc2626] text-white border-[#dc2626]'
                            : 'bg-[#091b18] text-[#f1f5f9] border-[#17493d]'
                        }`}
                      >
                        ⊖ Expense (-)
                      </button>
                      <button
                        type="button"
                        onClick={() => setEntryMode('bank')}
                        className={`rounded-[7px] px-3 py-1.5 text-xs font-bold border transition-colors cursor-pointer ${
                          entryMode === 'bank'
                            ? 'bg-[#2563eb] text-white border-[#2563eb]'
                            : 'bg-[#091b18] text-[#f1f5f9] border-[#17493d]'
                        }`}
                      >
                        ⇄ Bank / Bkash Transfer
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#8ea8a1]">
                      <span>
                        Account: Bank, Bkash, Cash
                        {txVoucher.trim() ? ` • Voucher: ${txVoucher.trim()}` : ''}
                        {txKhataNo.trim() ? ` • খাতা: ${txKhataNo.trim()}` : ''}
                      </span>
                      {(txAccount === 'Bank' || txAccount === 'Bkash') &&
                        parseAccountNum(txAmount) < 0 && (
                          <span className="inline-flex items-center gap-1 bg-rose-500/15 border border-rose-400/50 text-rose-300 font-bold px-2 py-0.5 rounded-md">
                            🏦 {txAccount} ব্যালেন্স থেকে ৳
                            {Math.abs(parseAccountNum(txAmount)).toLocaleString('en-US')} বিয়োগ হবে
                          </span>
                        )}
                      {matchedStudent && (
                        <span className="inline-flex items-center gap-1.5 bg-emerald-500/15 border border-emerald-400/50 text-emerald-300 font-bold px-2 py-0.5 rounded-md">
                          <span>
                            ছাত্র: {matchedStudent.name} ({matchedStudent.code})
                            {matchedStudent.trade ? ` • ${matchedStudent.trade}` : ''}
                          </span>
                          {entryMode === 'income' ? (
                            <span className="text-[10px] bg-emerald-500 text-[#04100c] px-1.5 py-0.2 rounded font-extrabold">
                              + Course Paid যুক্ত হবে
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setEntryMode('income')}
                              className="text-[10px] bg-amber-400/20 hover:bg-amber-400/30 border border-amber-400/50 text-amber-200 px-1.5 py-0.2 rounded font-bold cursor-pointer"
                            >
                              Course Paid-এ জমা করতে Income (+) নিন
                            </button>
                          )}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Quick Purpose Chips */}
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#8ea8a1]">
                    <strong className="text-[#f1f5f9]">For The Purpose Of:</strong>
                    {[
                      { label: 'Welding Job Fee', val: 'Welding Job Fee', mode: 'income' as const },
                      { label: 'Fitter Fee', val: 'Fitter Fee', mode: 'income' as const },
                      { label: 'Visa Fee', val: 'Visa Fee', mode: 'income' as const },
                      { label: 'P.P.E', val: 'P.P.E', mode: 'income' as const },
                      { label: 'অপারেশন খরচ', val: 'অপারেশন খরচ', mode: 'expense' as const },
                      { label: 'যাতায়াত ভাড়া', val: 'যাতায়াত ভাড়া', mode: 'expense' as const },
                      { label: 'SABUJ KAZI', val: 'SABUJ KAZI বাবদ খরচ', mode: 'expense' as const },
                      { label: 'SOHEL KAZI', val: 'SOHEL KAZI বাবদ খরচ', mode: 'expense' as const },
                      {
                        label: 'SALIM MAHMMUD',
                        val: 'SALIM MAHMMUD বাবদ খরচ',
                        mode: 'expense' as const,
                      },
                    ].map((chip) => (
                      <button
                        key={chip.label}
                        type="button"
                        onClick={() => applyPurposeChip(chip.val, chip.mode)}
                        className="bg-[#091b18] text-[#f1f5f9] border border-[#17493d] hover:border-[#10b981] hover:text-[#10b981] rounded-[5px] px-2.5 py-1 text-[11px] cursor-pointer"
                      >
                        {chip.label}
                      </button>
                    ))}
                  </div>

                  {/* Entry Form */}
                  <form
                    onSubmit={handleQuickTxSubmit}
                    className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[140px_110px_135px_175px_1fr_115px_auto] gap-2.5 items-end"
                  >
                    <div ref={khataBoxRef} className="relative flex flex-col gap-1">
                      <label className="text-[11px] font-semibold text-[#8ea8a1] flex items-center justify-between gap-1">
                        <span>খাতা নাম্বার</span>
                        {matchedStudent && (
                          <span className="text-[10px] font-bold text-[#34d399] truncate max-w-[82px]">
                            ✓ {matchedStudent.name}
                          </span>
                        )}
                      </label>
                      <input
                        type="text"
                        value={txKhataNo}
                        onFocus={() => setKhataDropdownOpen(true)}
                        onChange={(e) => {
                          setTxKhataNo(e.target.value);
                          setKhataDropdownOpen(true);
                        }}
                        placeholder="যেমন: 14/143"
                        className="bg-[#091b18] border border-[#17493d] focus:border-[#10b981] text-[#f1f5f9] rounded-[7px] px-2.5 py-2 text-[12.5px] outline-none"
                      />
                      {khataDropdownOpen &&
                        txKhataNo.trim() &&
                        !matchedStudent &&
                        khataSuggestions.length > 0 && (
                          <div className="absolute left-0 top-full mt-1 z-40 w-[260px] bg-[#071917] border border-[#17493d] rounded-lg shadow-2xl py-1 max-h-[210px] overflow-y-auto">
                            {khataSuggestions.map((stu) => (
                              <button
                                key={stu.id}
                                type="button"
                                onClick={() => {
                                  setTxKhataNo(stu.code);
                                  setKhataDropdownOpen(false);
                                }}
                                className="w-full text-left px-3 py-1.5 hover:bg-[#0d2a25] text-xs flex items-center justify-between gap-2 cursor-pointer"
                              >
                                <span className="font-bold text-[#f1f5f9] truncate">
                                  {stu.name}
                                </span>
                                <span className="text-[11px] font-mono text-[#34d399] shrink-0">
                                  {stu.code}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] font-semibold text-[#8ea8a1]">Account</label>
                      <select
                        value={txAccount}
                        onChange={(e) => setTxAccount(e.target.value as AccountKind)}
                        className="bg-[#091b18] border border-[#17493d] focus:border-[#10b981] text-[#f1f5f9] rounded-[7px] px-2.5 py-2 text-[12.5px] outline-none"
                      >
                        <option value="Bank">Bank</option>
                        <option value="Bkash">Bkash</option>
                        <option value="Cash">Cash</option>
                      </select>
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] font-semibold text-[#8ea8a1]">Voucher No</label>
                      <input
                        type="text"
                        value={txVoucher}
                        onChange={(e) => setTxVoucher(e.target.value)}
                        className="bg-[#091b18] border border-[#17493d] focus:border-[#10b981] text-[#f1f5f9] rounded-[7px] px-2.5 py-2 text-[12.5px] outline-none"
                      />
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] font-semibold text-[#8ea8a1]">
                        For The Purpose Of
                      </label>
                      <select
                        value={txPurpose}
                        onChange={(e) => handlePurposeSelectChange(e.target.value)}
                        className="bg-[#091b18] border border-[#17493d] focus:border-[#10b981] text-[#f1f5f9] rounded-[7px] px-2.5 py-2 text-[12.5px] outline-none"
                      >
                        <option value="">-- খাত নির্বাচন করুন --</option>
                        <option value="Welding Job Fee">Welding Job Fee</option>
                        <option value="Fitter Fee">Fitter Fee</option>
                        <option value="Visa Fee">Visa Fee</option>
                        <option value="P.P.E">P.P.E</option>
                        <option value="অন্যান্য">অন্যান্য (নিচে লিখুন)</option>
                      </select>
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] font-semibold text-[#8ea8a1]">
                        {entryMode === 'income'
                          ? 'Income Description'
                          : entryMode === 'expense'
                            ? 'Expense Description'
                            : 'Bank / Bkash Transfer Note'}
                      </label>
                      <input
                        type="text"
                        value={txDesc}
                        onChange={(e) => setTxDesc(e.target.value)}
                        placeholder="যেমন: MD ISMAIL-Welding Fee"
                        required
                        className="bg-[#091b18] border border-[#17493d] focus:border-[#10b981] text-[#f1f5f9] rounded-[7px] px-2.5 py-2 text-[12.5px] outline-none"
                      />
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] font-semibold text-[#8ea8a1]">
                        Amount (৳)
                      </label>
                      <input
                        ref={amountInputRef}
                        type="text"
                        inputMode="decimal"
                        value={txAmount}
                        onChange={(e) => setTxAmount(e.target.value)}
                        placeholder="0"
                        required
                        className="bg-[#091b18] border border-[#17493d] focus:border-[#10b981] text-[#f1f5f9] rounded-[7px] px-2.5 py-2 text-[12.5px] outline-none"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={busy}
                      className={`px-4 h-[36px] rounded-md text-xs font-bold transition-colors cursor-pointer disabled:opacity-60 ${
                        entryMode === 'income'
                          ? 'bg-[#10b981] hover:bg-emerald-400 text-[#04100c]'
                          : entryMode === 'expense'
                            ? 'bg-[#dc2626] hover:bg-red-700 text-white'
                            : 'bg-[#2563eb] hover:bg-blue-700 text-white'
                      }`}
                    >
                      + Add
                    </button>
                  </form>
                  {(txAccount === 'Bank' || txAccount === 'Bkash') && (
                    <div className="text-[11px] text-[#8ea8a1]">
                      💡 <strong className="text-[#93c5fd]">{txAccount}</strong>-এর মাধ্যমে প্রদান করা
                      হলে টাকার অংকের আগে <strong className="text-rose-300">(-)</strong> চিহ্ন দিন
                      (যেমন: <code className="text-[#f1f5f9]">-5000</code>), তাহলে ব্যাংকের
                      ব্যালেন্স থেকে বিয়োগ হবে।
                    </div>
                  )}
                </div>

                {/* দৈনিক আয় ব্যয়ের হিসাব শীট */}
                <div className="bg-[#0a1f1c] border-[1.5px] border-[#17493d] rounded-[10px] p-3.5 min-w-0">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        value={searchText}
                        onChange={(e) => setSearchText(e.target.value)}
                        placeholder="ভাউচার, খাতা নাম্বার বা বিবরণ খুঁজুন..."
                        className="bg-[#091b18] text-[#f1f5f9] border border-[#17493d] focus:border-[#10b981] px-2.5 py-1.5 rounded-md text-xs outline-none"
                      />
                      <select
                        value={filterMode}
                        onChange={(e) => setFilterMode(e.target.value as FilterMode)}
                        className="bg-[#091b18] text-[#f1f5f9] border border-[#17493d] focus:border-[#10b981] px-2.5 py-1.5 rounded-md text-xs outline-none"
                      >
                        <option value="all">সব সারি দেখুন</option>
                        <option value="income">শুধু আয়ের সারি</option>
                        <option value="expense">শুধু ব্যয়ের সারি</option>
                      </select>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleAddBlankRow()}
                        disabled={busy || isDayLocked}
                        className="inline-flex items-center gap-1 bg-[#10b981] hover:bg-emerald-400 text-[#04100c] px-3 py-1.5 rounded-md text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>খালি সারি</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmClearAll(true)}
                        disabled={busy || rows.length === 0}
                        className="inline-flex items-center gap-1 bg-[#091b18] hover:bg-rose-950/60 text-rose-300 border border-rose-500/40 px-3 py-1.5 rounded-md text-xs font-bold transition-colors cursor-pointer disabled:opacity-40"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>সব হিসাব মুছুন</span>
                      </button>
                    </div>
                  </div>

                  {/* White Excel Sheet Container */}
                  <div className="preserve-surface bg-white text-black border-2 border-[#1d4ed8] p-1.5 overflow-x-auto rounded">
                    <div className="bg-[#00b050] text-black text-center text-[14px] font-bold py-1 px-2 border border-black">
                      আইডিয়াল টেকনিক্যাল ট্রেনিং এন্ড টেস্টিং সেন্টার
                    </div>
                    <div className="bg-[#ffff00] text-black text-center text-[12px] font-bold py-1 px-2 border border-black border-t-0">
                      দৈনিক আয় ব্যয়ের হিসাব {slashDateBn} ({dayName})
                    </div>

                    <table className="w-full min-w-[1160px] border-collapse table-auto text-[11px] text-black">
                      <thead>
                        <tr>
                          <th
                            rowSpan={2}
                            className="border border-black bg-[#f4b084] font-bold text-center px-1.5 py-0.5 h-[21px] min-w-[76px] whitespace-nowrap"
                          >
                            তারিখ
                          </th>
                          <th
                            colSpan={3}
                            className="border border-black bg-[#f4b084] font-bold text-center px-1.5 py-0.5 h-[21px] whitespace-nowrap"
                          >
                            আয়
                          </th>
                          <th
                            colSpan={2}
                            className="border border-black bg-[#f4b084] font-bold text-center px-1.5 py-0.5 h-[21px] whitespace-nowrap"
                          >
                            ব্যয়
                          </th>
                          <th
                            rowSpan={2}
                            className="border border-black bg-[#f4b084] font-bold text-center px-1.5 py-0.5 h-[21px] min-w-[74px] whitespace-nowrap"
                          >
                            নগদ টাকা
                          </th>
                          <th
                            rowSpan={2}
                            className="border border-black bg-[#f4b084] font-bold text-center px-1.5 py-0.5 h-[21px] min-w-[74px] whitespace-nowrap"
                          >
                            ব্যয়ের টাকা
                          </th>
                          <th
                            rowSpan={2}
                            className="border border-black bg-[#f4b084] font-bold text-center px-1.5 py-0.5 h-[21px] min-w-[78px] whitespace-nowrap"
                          >
                            ব্যাংক/বিকাশ
                          </th>
                          <th
                            rowSpan={2}
                            className="border border-black bg-[#f4b084] font-bold text-center px-1.5 py-0.5 h-[21px] min-w-[80px] whitespace-nowrap"
                          >
                            নগদ ব্যালেন্স
                          </th>
                          <th
                            rowSpan={2}
                            className="border border-black bg-[#f4b084] font-bold text-center px-1.5 py-0.5 h-[21px] min-w-[88px] whitespace-nowrap"
                          >
                            নগদ + ব্যাংক
                          </th>
                          <th
                            rowSpan={2}
                            className="border border-black bg-[#f4b084] font-bold text-center px-1.5 py-0.5 h-[21px] min-w-[74px] whitespace-nowrap"
                          >
                            অ্যাকশন
                          </th>
                        </tr>
                        <tr>
                          <th className="border border-black bg-[#f4b084] font-bold text-center px-2 py-0.5 h-[21px] min-w-[230px] whitespace-nowrap">
                            আয়ের মাধ্যম / ভাউচার
                          </th>
                          <th className="border border-black bg-[#f4b084] font-bold text-center px-1.5 py-0.5 h-[21px] min-w-[74px] whitespace-nowrap">
                            নগদ টাকা
                          </th>
                          <th className="border border-black bg-[#f4b084] font-bold text-center px-1.5 py-0.5 h-[21px] min-w-[78px] whitespace-nowrap">
                            ব্যাংক/বিকাশ
                          </th>
                          <th className="border border-black bg-[#f4b084] font-bold text-center px-2 py-0.5 h-[21px] min-w-[195px] whitespace-nowrap">
                            ব্যয়ের মাধ্যম
                          </th>
                          <th className="border border-black bg-[#f4b084] font-bold text-center px-1.5 py-0.5 h-[21px] min-w-[74px] whitespace-nowrap">
                            ব্যয়ের টাকা
                          </th>
                        </tr>
                      </thead>

                      <tbody>
                        {/* Opening Row */}
                        <tr className="h-[21px]">
                          <td className="border border-black px-1 text-center font-bold">
                            {activeSummary.opening.prevDate}
                          </td>
                          <td className="border border-black px-1 font-bold">পূর্বের ব্যালেন্স</td>
                          <td className="border border-black px-1 text-right bg-[#00b050] font-bold">
                            {fmtCell(activeSummary.opening.cash)}
                          </td>
                          <td className="border border-black px-1 text-right bg-[#ffff00] font-bold">
                            {fmtCell(openBankCombined)}
                          </td>
                          <td className="border border-black px-1 font-bold">পূর্বের ব্যালেন্স</td>
                          <td className="border border-black px-1" />
                          <td className="border border-black px-1 text-right bg-[#00b050] font-bold">
                            {fmtCell(activeSummary.opening.cash)}
                          </td>
                          <td className="border border-black px-1" />
                          <td className="border border-black px-1 text-right bg-[#ffff00] font-bold">
                            {fmtCell(openBankCombined)}
                          </td>
                          <td className="border border-black px-1" />
                          <td className="border border-black px-1" />
                          <td className="border border-black px-1 text-center font-bold text-[10px]">
                            Opening
                          </td>
                        </tr>

                        {/* Filtered Day Transaction Rows */}
                        {filteredDayRows.map((row) => {
                          const incDisplay = formatIncDisplay(row);
                          const bankCls =
                            row.incBank > 0
                              ? 'bg-[#00b050] font-bold'
                              : row.incBank < 0
                                ? 'bg-[#fee2e2] text-[#b91c1c] font-bold'
                                : '';

                          return (
                            <tr key={row.raw.id} className="h-[21px]">
                              <td className="border border-black px-1 text-center truncate">
                                {row.date}
                              </td>
                                <td
                                  contentEditable={!isDayLocked}
                                  suppressContentEditableWarning
                                  onBlur={(e) =>
                                    void handleInlineCellBlur(
                                      row,
                                      'incSrc',
                                      e.currentTarget.textContent || ''
                                    )
                                  }
                                  title={incDisplay}
                                  className="border border-black px-2 text-left whitespace-nowrap focus:outline-2 focus:outline-[#16a34a] focus:bg-[#f0fdf4]"
                                >
                                  {incDisplay}
                                </td>
                                <td
                                  contentEditable={!isDayLocked}
                                  suppressContentEditableWarning
                                  onBlur={(e) =>
                                    void handleInlineCellBlur(
                                      row,
                                      'incCash',
                                      e.currentTarget.textContent || ''
                                    )
                                  }
                                  className="border border-black px-1.5 text-right whitespace-nowrap focus:outline-2 focus:outline-[#16a34a] focus:bg-[#f0fdf4]"
                                >
                                  {fmtCell(row.incCash)}
                                </td>
                                <td
                                  contentEditable={!isDayLocked}
                                  suppressContentEditableWarning
                                  onBlur={(e) =>
                                    void handleInlineCellBlur(
                                      row,
                                      'incBank',
                                      e.currentTarget.textContent || ''
                                    )
                                  }
                                  className={`border border-black px-1.5 text-right whitespace-nowrap ${bankCls} focus:outline-2 focus:outline-[#16a34a] focus:bg-[#f0fdf4]`}
                                >
                                  {fmtCell(row.incBank)}
                                </td>
                                <td
                                  contentEditable={!isDayLocked}
                                  suppressContentEditableWarning
                                  onBlur={(e) =>
                                    void handleInlineCellBlur(
                                      row,
                                      'expSrc',
                                      e.currentTarget.textContent || ''
                                    )
                                  }
                                  title={row.expSrc}
                                  className="border border-black px-2 text-left whitespace-nowrap focus:outline-2 focus:outline-[#16a34a] focus:bg-[#f0fdf4]"
                                >
                                  {row.expSrc}
                                </td>
                              <td
                                contentEditable={!isDayLocked}
                                suppressContentEditableWarning
                                onBlur={(e) =>
                                  void handleInlineCellBlur(
                                    row,
                                    'expAmt',
                                    e.currentTarget.textContent || ''
                                  )
                                }
                                className="border border-black px-1 text-right truncate focus:outline-2 focus:outline-[#16a34a] focus:bg-[#f0fdf4]"
                              >
                                {fmtCell(row.expAmt)}
                              </td>
                              <td className="border border-black px-1 text-right truncate">
                                {fmtCell(row.incCash)}
                              </td>
                              <td className="border border-black px-1 text-right truncate">
                                {fmtCell(row.expAmt)}
                              </td>
                              <td
                                className={`border border-black px-1 text-right truncate ${bankCls}`}
                              >
                                {fmtCell(row.incBank)}
                              </td>
                              <td className="border border-black px-1" />
                              <td className="border border-black px-1" />
                              <td className="border border-black px-0.5 text-center">
                                <div className="flex items-center justify-center gap-1.5 text-[10px] font-bold">
                                  <button
                                    type="button"
                                    onClick={() => setReceiptRow(row)}
                                    className="text-[#059669] hover:underline cursor-pointer"
                                  >
                                    রিসিট
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleDeleteRow(row.raw.id)}
                                    className="text-[#dc2626] hover:underline cursor-pointer"
                                  >
                                    মুছুন
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}

                        {/* Padding Blank Rows (up to 16) */}
                        {Array.from({ length: blankPadCount }, (_, idx) => (
                          <tr key={`pad-${idx}`} className="h-[21px]">
                            <td className="border border-black px-1 text-center">
                              {idx < 4 ? activeDate : ''}
                            </td>
                            <td className="border border-black px-1" />
                            <td className="border border-black px-1" />
                            <td className="border border-black px-1" />
                            <td className="border border-black px-1" />
                            <td className="border border-black px-1" />
                            <td className="border border-black px-1" />
                            <td className="border border-black px-1" />
                            <td className="border border-black px-1" />
                            <td className="border border-black px-1" />
                            <td className="border border-black px-1" />
                            <td className="border border-black px-1" />
                          </tr>
                        ))}
                      </tbody>

                      <tfoot>
                        <tr className="h-[21px]">
                          <td className="border border-black px-1" />
                          <td className="border border-black px-1 font-bold">
                            ব্যাংকে/বিকাশে জমা আছে=
                          </td>
                          <td className="border border-black px-1" />
                          <td className="border border-black px-1" />
                          <td className="border border-black px-1 text-right font-bold">
                            ব্যাংকে/বিকাশে জমা আছে=
                          </td>
                          <td className="border border-black px-1" />
                          <td className="border border-black px-1" />
                          <td className="border border-black px-1" />
                          <td className="border border-black px-1" />
                          <td className="border border-black px-1" />
                          <td className="border border-black px-1" />
                          <td className="border border-black px-1" />
                        </tr>
                        <tr className="h-[21px]">
                          <td className="border border-black px-1" />
                          <td className="border border-black px-1" />
                          <td className="border border-black px-1 text-right bg-[#00b050] font-bold">
                            {activeSummary.totalCash.toLocaleString('en-US')}
                          </td>
                          <td className="border border-black px-1 text-right bg-[#00b050] font-bold">
                            {activeSummary.totalBank.toLocaleString('en-US')}
                          </td>
                          <td className="border border-black px-1 text-right font-bold">
                            ক্যাশে জমা আছে=
                          </td>
                          <td className="border border-black px-1 text-right bg-[#ffff00] font-bold">
                            {activeSummary.totalExp.toLocaleString('en-US')}
                          </td>
                          <td className="border border-black px-1 text-right bg-[#00b050] font-bold">
                            {activeSummary.totalCash.toLocaleString('en-US')}
                          </td>
                          <td className="border border-black px-1 text-right bg-[#ffff00] font-bold">
                            {activeSummary.totalExp.toLocaleString('en-US')}
                          </td>
                          <td className="border border-black px-1 text-right bg-[#00b050] font-bold">
                            {activeSummary.totalBank.toLocaleString('en-US')}
                          </td>
                          <td className="border border-black px-1 text-right bg-[#00b050] font-bold">
                            {activeSummary.cashBalance.toLocaleString('en-US')}
                          </td>
                          <td className="border border-black px-1 text-right bg-[#00b050] font-bold">
                            {activeSummary.grandTotal.toLocaleString('en-US')}
                          </td>
                          <td className="border border-black px-1" />
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 mt-2 text-[11px] text-[#8ea8a1]">
                    <span>* টেবিলের যেকোনো সেলে সরাসরি ক্লিক করে এডিট করা যাবে।</span>
                    <span>Accounts: Bank, Bkash, Cash • Cloud &amp; Local Auto-saved</span>
                  </div>
                </div>
              </div>
            )}

            {/* ট্যাব ৩: মাসিক হিসাব (১ তারিখ থেকে ৩১ তারিখ পর্যন্ত মোট কত টাকা দেওয়া হলো) */}
            {activePane === 'monthlyPane' && (
              <div className="space-y-3">
                {/* মাস, বছর ও তারিখ (১–৩১) নির্বাচন বার */}
                <div className="bg-[#0a1f1c] border-[1.5px] border-[#17493d] rounded-[10px] p-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-[#f1f5f9]">
                      📅 মাসিক প্রদত্ত টাকার হিসাব (১ তারিখ থেকে ৩১ তারিখ)
                    </h3>
                    <p className="text-[11.5px] text-[#8ea8a1] mt-0.5">
                      {enToBn(monthlyReport.minDay)} তারিখ থেকে {enToBn(monthlyReport.maxDay)} তারিখ •{' '}
                      <strong className="text-[#34d399]">
                        {BN_MONTHS[reportMonth - 1]} {enToBn(reportYear)}
                      </strong>{' '}
                      পর্যন্ত মোট কত টাকা দেওয়া হলো তার সম্পূর্ণ হিসাব
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-1 bg-[#091b18] border border-[#17493d] rounded-md px-1.5 py-1">
                      <button
                        type="button"
                        onClick={() => stepReportMonth(-1)}
                        aria-label="আগের মাস"
                        className="p-1 rounded hover:bg-[#17493d] text-[#f1f5f9] cursor-pointer"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </button>
                      <select
                        value={reportMonth}
                        onChange={(e) => {
                          setUserPickedReportPeriod(true);
                          setReportMonth(Number(e.target.value));
                        }}
                        className="bg-transparent text-xs font-bold text-[#f1f5f9] outline-none cursor-pointer px-1"
                      >
                        {BN_MONTHS.map((mName, idx) => (
                          <option key={mName} value={idx + 1} className="bg-[#071412] text-[#f1f5f9]">
                            {mName}
                          </option>
                        ))}
                      </select>
                      <select
                        value={reportYear}
                        onChange={(e) => {
                          setUserPickedReportPeriod(true);
                          setReportYear(Number(e.target.value));
                        }}
                        className="bg-transparent text-xs font-bold text-[#34d399] outline-none cursor-pointer px-1"
                      >
                        {availableReportYears.map((yr) => (
                          <option key={yr} value={yr} className="bg-[#071412] text-[#f1f5f9]">
                            {enToBn(yr)}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => stepReportMonth(1)}
                        aria-label="পরের মাস"
                        className="p-1 rounded hover:bg-[#17493d] text-[#f1f5f9] cursor-pointer"
                      >
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="flex items-center gap-1.5 bg-[#091b18] border border-[#17493d] rounded-md px-2.5 py-1 text-xs">
                      <span className="text-[#8ea8a1]">তারিখ:</span>
                      <select
                        value={reportDayFrom}
                        onChange={(e) => setReportDayFrom(Number(e.target.value))}
                        aria-label="শুরুর তারিখ"
                        className="bg-transparent font-bold text-[#f1f5f9] outline-none cursor-pointer"
                      >
                        {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                          <option key={d} value={d} className="bg-[#071412] text-[#f1f5f9]">
                            {enToBn(d)}
                          </option>
                        ))}
                      </select>
                      <span className="text-[#8ea8a1]">–</span>
                      <select
                        value={reportDayTo}
                        onChange={(e) => setReportDayTo(Number(e.target.value))}
                        aria-label="শেষ তারিখ"
                        className="bg-transparent font-bold text-[#f1f5f9] outline-none cursor-pointer"
                      >
                        {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                          <option key={d} value={d} className="bg-[#071412] text-[#f1f5f9]">
                            {enToBn(d)}
                          </option>
                        ))}
                      </select>
                    </div>

                    <button
                      type="button"
                      onClick={() => void handleDownloadMonthlyExcel()}
                      className="inline-flex items-center gap-1.5 bg-[#10b981] hover:bg-emerald-400 text-[#04100c] rounded-md px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5" />
                      <span>Excel (.xlsx)</span>
                    </button>

                    <button
                      type="button"
                      onClick={handlePrintMonthlyPdf}
                      className="inline-flex items-center gap-1.5 bg-[#ec4899] hover:bg-pink-600 text-white rounded-md px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      <span>Print / PDF</span>
                    </button>
                  </div>
                </div>

                {/* ৪টি মাসিক প্রদত্ত টাকার কার্ড */}
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                  <div
                    className={`bg-[#0a1f1c] border-[1.5px] rounded-[10px] px-4 py-3.5 flex flex-col justify-between gap-2 transition-colors ${
                      monthlyFilter === 'md'
                        ? 'border-[#f97316] ring-1 ring-[#f97316]/50'
                        : 'border-[#17493d] hover:border-[#f97316]/70'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setMonthlyFilter(monthlyFilter === 'md' ? 'all_officials' : 'md')}
                      className="flex flex-col items-center gap-1 cursor-pointer w-full"
                    >
                      <span className="text-[10.5px] font-bold text-[#8ea8a1]">MANAGING DIRECTOR</span>
                      <span className="text-[14px] font-bold text-[#f97316]">SABUJ KAZI</span>
                      <span className="text-[22px] font-bold text-[#f472b6] font-mono-num">
                        ৳{enToBn(monthlyReport.mdTotal) || '০'}
                      </span>
                      <span className="text-[10.5px] text-[#8ea8a1]">
                        সবুজ কাজী • {enToBn(monthlyReport.mdCount) || '০'} টি এন্ট্রি
                      </span>
                    </button>
                    <div className="pt-2 border-t border-[#17493d]/70 flex items-center justify-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => openOfficialProfile('md', true)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#091b18] hover:bg-[#0e2924] border border-[#17493d] text-[10.5px] font-bold text-[#f97316] cursor-pointer"
                      >
                        <User className="w-3 h-3" />
                        <span>সিঙ্গেল প্রোফাইল</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handlePrintOfficialProfile('md', 'monthly')}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#2563eb]/20 hover:bg-[#2563eb]/35 border border-[#2563eb]/50 text-[10.5px] font-bold text-[#93c5fd] cursor-pointer"
                      >
                        <Printer className="w-3 h-3" />
                        <span>প্রিন্ট</span>
                      </button>
                    </div>
                  </div>

                  <div
                    className={`bg-[#0a1f1c] border-[1.5px] rounded-[10px] px-4 py-3.5 flex flex-col justify-between gap-2 transition-colors ${
                      monthlyFilter === 'dir'
                        ? 'border-[#60a5fa] ring-1 ring-[#60a5fa]/50'
                        : 'border-[#17493d] hover:border-[#60a5fa]/70'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setMonthlyFilter(monthlyFilter === 'dir' ? 'all_officials' : 'dir')}
                      className="flex flex-col items-center gap-1 cursor-pointer w-full"
                    >
                      <span className="text-[10.5px] font-bold text-[#8ea8a1]">DIRECTOR</span>
                      <span className="text-[14px] font-bold text-[#60a5fa]">SOHEL KAZI</span>
                      <span className="text-[22px] font-bold text-[#f472b6] font-mono-num">
                        ৳{enToBn(monthlyReport.dirTotal) || '০'}
                      </span>
                      <span className="text-[10.5px] text-[#8ea8a1]">
                        সোহেল কাজী • {enToBn(monthlyReport.dirCount) || '০'} টি এন্ট্রি
                      </span>
                    </button>
                    <div className="pt-2 border-t border-[#17493d]/70 flex items-center justify-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => openOfficialProfile('dir', true)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#091b18] hover:bg-[#0e2924] border border-[#17493d] text-[10.5px] font-bold text-[#60a5fa] cursor-pointer"
                      >
                        <User className="w-3 h-3" />
                        <span>সিঙ্গেল প্রোফাইল</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handlePrintOfficialProfile('dir', 'monthly')}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#2563eb]/20 hover:bg-[#2563eb]/35 border border-[#2563eb]/50 text-[10.5px] font-bold text-[#93c5fd] cursor-pointer"
                      >
                        <Printer className="w-3 h-3" />
                        <span>প্রিন্ট</span>
                      </button>
                    </div>
                  </div>

                  <div
                    className={`bg-[#0a1f1c] border-[1.5px] rounded-[10px] px-4 py-3.5 flex flex-col justify-between gap-2 transition-colors ${
                      monthlyFilter === 'gm'
                        ? 'border-[#a78bfa] ring-1 ring-[#a78bfa]/50'
                        : 'border-[#17493d] hover:border-[#a78bfa]/70'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setMonthlyFilter(monthlyFilter === 'gm' ? 'all_officials' : 'gm')}
                      className="flex flex-col items-center gap-1 cursor-pointer w-full"
                    >
                      <span className="text-[10.5px] font-bold text-[#8ea8a1]">GENERAL MANAGER</span>
                      <span className="text-[14px] font-bold text-[#a78bfa]">SALIM MAHMMUD</span>
                      <span className="text-[22px] font-bold text-[#f472b6] font-mono-num">
                        ৳{enToBn(monthlyReport.gmTotal) || '০'}
                      </span>
                      <span className="text-[10.5px] text-[#8ea8a1]">
                        সেলিম মাহমুদ • {enToBn(monthlyReport.gmCount) || '০'} টি এন্ট্রি
                      </span>
                    </button>
                    <div className="pt-2 border-t border-[#17493d]/70 flex items-center justify-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => openOfficialProfile('gm', true)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#091b18] hover:bg-[#0e2924] border border-[#17493d] text-[10.5px] font-bold text-[#a78bfa] cursor-pointer"
                      >
                        <User className="w-3 h-3" />
                        <span>সিঙ্গেল প্রোফাইল</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handlePrintOfficialProfile('gm', 'monthly')}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#2563eb]/20 hover:bg-[#2563eb]/35 border border-[#2563eb]/50 text-[10.5px] font-bold text-[#93c5fd] cursor-pointer"
                      >
                        <Printer className="w-3 h-3" />
                        <span>প্রিন্ট</span>
                      </button>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setMonthlyFilter('all_officials')}
                    className={`text-left bg-[#0a1f1c] border-[1.5px] rounded-[10px] px-4 py-3.5 flex flex-col items-center gap-1 transition-colors cursor-pointer ${
                      monthlyFilter === 'all_officials'
                        ? 'border-[#10b981] ring-1 ring-[#10b981]/50'
                        : 'border-[#17493d] hover:border-[#10b981]/70'
                    }`}
                  >
                    <span className="text-[10.5px] font-bold text-[#8ea8a1]">
                      ১–{enToBn(monthlyReport.maxDay)} তারিখ মোট (৩ কর্মকর্তা)
                    </span>
                    <span className="text-[14px] font-bold text-[#34d399]">সর্বমোট দেওয়া হয়েছে</span>
                    <span className="text-[22px] font-bold text-[#34d399] font-mono-num">
                      ৳{enToBn(monthlyReport.officialsTotal) || '০'}
                    </span>
                    <span className="text-[10.5px] text-[#8ea8a1]">
                      সকল মাসিক ব্যয়: ৳{enToBn(monthlyReport.allExpTotal) || '০'}
                    </span>
                  </button>
                </div>

                {/* ফিল্টার ট্যাব + বিস্তারিত লেনদেন তালিকা */}
                <div className="bg-[#0a1f1c] border-[1.5px] border-[#17493d] rounded-[10px] p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {(
                        [
                          { id: 'all_officials', label: '৩ কর্মকর্তা (সবাই)' },
                          { id: 'md', label: 'সবুজ কাজী (MD)' },
                          { id: 'dir', label: 'সোহেল কাজী (DIR)' },
                          { id: 'gm', label: 'সেলিম মাহমুদ (GM)' },
                          { id: 'all_expenses', label: 'সকল মাসিক ব্যয় (১–৩১)' },
                        ] as const
                      ).map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setMonthlyFilter(tab.id)}
                          className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors cursor-pointer ${
                            monthlyFilter === tab.id
                              ? 'bg-[#10b981] text-[#04100c]'
                              : 'bg-[#091b18] text-[#8ea8a1] border border-[#17493d] hover:text-[#f1f5f9]'
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>

                    <div className="text-xs font-bold text-[#f1f5f9] bg-[#091b18] border border-[#17493d] rounded-md px-3 py-1.5 font-mono-num">
                      তালিকার মোট ({enToBn(filteredMonthlyEntries.length) || '০'} টি):{' '}
                      <span className="text-[#f472b6]">৳{enToBn(filteredMonthlyTotal) || '০'}</span>
                    </div>
                  </div>

                  <div className="overflow-x-auto border border-[#17493d] rounded-lg">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-[#071412] text-[#8ea8a1] border-b border-[#17493d]">
                          <th className="py-2.5 px-3 text-center w-12">নং</th>
                          <th className="py-2.5 px-3 text-center w-28">তারিখ</th>
                          <th className="py-2.5 px-3 text-left w-52">কর্মকর্তা / খাত</th>
                          <th className="py-2.5 px-3 text-left">ব্যয়ের মাধ্যম / বিবরণ</th>
                          <th className="py-2.5 px-3 text-right w-36">টাকা দেওয়া হলো (৳)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredMonthlyEntries.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="py-8 text-center text-[#8ea8a1]">
                              {BN_MONTHS[reportMonth - 1]} {enToBn(reportYear)} ({enToBn(monthlyReport.minDay)}–
                              {enToBn(monthlyReport.maxDay)} তারিখ) এর মধ্যে কোনো হিসাব পাওয়া যায়নি।
                            </td>
                          </tr>
                        ) : (
                          filteredMonthlyEntries.map((entry, idx) => {
                            const badgeColor =
                              entry.categoryKey === 'md'
                                ? 'text-[#f97316] bg-[#f97316]/10 border-[#f97316]/40'
                                : entry.categoryKey === 'dir'
                                  ? 'text-[#60a5fa] bg-[#60a5fa]/10 border-[#60a5fa]/40'
                                  : entry.categoryKey === 'gm'
                                    ? 'text-[#a78bfa] bg-[#a78bfa]/10 border-[#a78bfa]/40'
                                    : 'text-[#8ea8a1] bg-[#091b18] border-[#17493d]';
                            return (
                              <tr
                                key={`${entry.id}-${idx}`}
                                className="border-b border-[#17493d]/60 hover:bg-[#091b18]/80"
                              >
                                <td className="py-2 px-3 text-center text-[#8ea8a1] font-mono-num">
                                  {enToBn(idx + 1)}
                                </td>
                                <td className="py-2 px-3 text-center font-bold text-[#f1f5f9] font-mono-num whitespace-nowrap">
                                  {toBnDigitsString(entry.date)}
                                </td>
                                <td className="py-2 px-3 whitespace-nowrap">
                                  <span
                                    className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-bold ${badgeColor}`}
                                  >
                                    {entry.nameEn} • {entry.nameBn}
                                  </span>
                                </td>
                                <td className="py-2 px-3 text-[#f1f5f9]">{entry.expSrc}</td>
                                <td className="py-2 px-3 text-right font-bold text-[#f472b6] font-mono-num whitespace-nowrap">
                                  ৳{entry.amount.toLocaleString('en-US')}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                      {filteredMonthlyEntries.length > 0 && (
                        <tfoot>
                          <tr className="bg-[#071412] border-t-2 border-[#10b981]/60 font-bold">
                            <td colSpan={4} className="py-2.5 px-3 text-right text-[#f1f5f9]">
                              সর্বমোট প্রদত্ত টাকা ({enToBn(monthlyReport.minDay)}–{enToBn(monthlyReport.maxDay)}{' '}
                              {BN_MONTHS[reportMonth - 1]}):
                            </td>
                            <td className="py-2.5 px-3 text-right text-[14px] text-[#34d399] font-mono-num whitespace-nowrap">
                              ৳{filteredMonthlyTotal.toLocaleString('en-US')}
                            </td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                </div>

                {/* তারিখভিত্তিক (১–৩১) দৈনিক সারসংক্ষেপ */}
                {monthlyReport.dailyBreakdown.length > 0 && (
                  <div className="bg-[#0a1f1c] border-[1.5px] border-[#17493d] rounded-[10px] p-4 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h4 className="text-[13px] font-bold text-[#f1f5f9]">
                        📊 তারিখ অনুযায়ী সারসংক্ষেপ ({enToBn(monthlyReport.minDay)}–{enToBn(monthlyReport.maxDay)}{' '}
                        {BN_MONTHS[reportMonth - 1]} {enToBn(reportYear)})
                      </h4>
                      <span className="text-[11px] text-[#8ea8a1]">
                        নগদ আয়: ৳{enToBn(monthlyReport.totalCashIn) || '০'} • ব্যাংক/বিকাশ আয়: ৳
                        {enToBn(monthlyReport.totalBankIn) || '০'}
                      </span>
                    </div>
                    <div className="overflow-x-auto border border-[#17493d] rounded-lg">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="bg-[#071412] text-[#8ea8a1] border-b border-[#17493d]">
                            <th className="py-2 px-3 text-left">তারিখ</th>
                            <th className="py-2 px-3 text-right text-[#f97316]">সবুজ কাজী (MD)</th>
                            <th className="py-2 px-3 text-right text-[#60a5fa]">সোহেল কাজী (DIR)</th>
                            <th className="py-2 px-3 text-right text-[#a78bfa]">সেলিম মাহমুদ (GM)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {monthlyReport.dailyBreakdown.map((dRow) => (
                            <tr key={dRow.day} className="border-b border-[#17493d]/60 hover:bg-[#091b18]/70">
                              <td className="py-2 px-3 font-bold text-[#f1f5f9] font-mono-num">
                                {toBnDigitsString(dRow.date)}
                              </td>
                              <td className="py-2 px-3 text-right font-mono-num text-[#f97316] font-semibold">
                                {dRow.md > 0 ? `৳${dRow.md.toLocaleString('en-US')}` : '—'}
                              </td>
                              <td className="py-2 px-3 text-right font-mono-num text-[#60a5fa] font-semibold">
                                {dRow.dir > 0 ? `৳${dRow.dir.toLocaleString('en-US')}` : '—'}
                              </td>
                              <td className="py-2 px-3 text-right font-mono-num text-[#a78bfa] font-semibold">
                                {dRow.gm > 0 ? `৳${dRow.gm.toLocaleString('en-US')}` : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="bg-[#071412] border-t-2 border-[#10b981]/60 font-bold">
                            <td className="py-2.5 px-3 text-[#34d399]">১–৩১ সর্বমোট</td>
                            <td className="py-2.5 px-3 text-right font-mono-num text-[#f97316]">
                              ৳{monthlyReport.mdTotal.toLocaleString('en-US')}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono-num text-[#60a5fa]">
                              ৳{monthlyReport.dirTotal.toLocaleString('en-US')}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono-num text-[#a78bfa]">
                              ৳{monthlyReport.gmTotal.toLocaleString('en-US')}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ট্যাব ৩.৫: কর্মকর্তা একক হিসাব প্রোফাইল, ক্যালেন্ডার ফিল্টার ও প্রিন্ট */}
            {activePane === 'officialProfilePane' && (
              <div className="space-y-3">
                {/* ৩ জন কর্মকর্তার মোট টাকার কার্ড (নির্বাচিত তারিখ রেঞ্জ অনুযায়ী আপডেট হয়) */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {OFFICIAL_KEYS_ORDER.map((k) => {
                    const prof = officialProfilesData[k];
                    const periodStat = officialPeriodSummaries.byKey[k];
                    const isSelected = selectedOfficialKey === k;
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => {
                          setSelectedOfficialKey(k);
                        }}
                        className={`text-left bg-[#0a1f1c] border-[1.5px] rounded-[10px] px-4 py-3.5 transition-all cursor-pointer ${
                          isSelected
                            ? prof.meta.borderActiveClass
                            : 'border-[#17493d] hover:border-[#10b981]/60'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="text-[10px] font-bold text-[#8ea8a1]">
                              {prof.meta.role} • {prof.meta.roleBn}
                            </div>
                            <div className={`text-[15px] font-extrabold mt-0.5 ${prof.meta.textClass}`}>
                              {prof.meta.nameBn} ({prof.meta.nameEn})
                            </div>
                          </div>
                          {isSelected && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#10b981] text-[#04100c]">
                              সক্রিয়
                            </span>
                          )}
                        </div>
                        <div className="mt-2.5 flex items-baseline justify-between gap-2">
                          <span className="text-[20px] font-bold text-[#f472b6] font-mono-num">
                            ৳{enToBn(periodStat.total) || '০'}
                          </span>
                          <span className="text-[11px] text-[#8ea8a1]">
                            {enToBn(periodStat.entries.length) || '০'} এন্ট্রি •{' '}
                            {enToBn(periodStat.uniqueDays) || '০'} দিন
                          </span>
                        </div>
                        {officialPeriodMode !== 'all' && (
                          <div className="mt-1 text-[10px] text-[#8ea8a1]">
                            সর্বকালীন মোট: ৳{enToBn(prof.lifetimeTotal) || '০'}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* ক্যালেন্ডার তারিখ ফিল্টার (কত তারিখ থেকে কে কত টাকা নিয়েছে) ও প্রিন্ট কন্ট্রোল */}
                <div className="bg-[#0a1f1c] border-[1.5px] border-[#17493d] rounded-[10px] p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-11 h-11 rounded-xl border flex items-center justify-center font-extrabold text-sm shrink-0 ${activeOfficialProfile.meta.badgeClass}`}
                      >
                        {officialScope === 'all_officials'
                          ? 'ALL'
                          : activeOfficialProfile.meta.key.toUpperCase()}
                      </div>
                      <div>
                        <h3 className="text-base font-extrabold text-[#f1f5f9] flex flex-wrap items-center gap-2">
                          <span>
                            {officialScope === 'all_officials'
                              ? 'সকল ৩ জন কর্মকর্তার মোট হিসাব ও তারিখভিত্তিক বিবরণ'
                              : `${activeOfficialProfile.meta.nameBn} (${activeOfficialProfile.meta.nameEn})`}
                          </span>
                          <span className="text-[11px] px-2 py-0.5 rounded border font-bold bg-[#10b981]/15 border-[#10b981]/40 text-[#34d399]">
                            {officialPeriodSummaries.periodLabel}
                          </span>
                        </h3>
                        <p className="text-[11.5px] text-[#8ea8a1] mt-0.5">
                          ৩ জনের সম্মিলিত মোট:{' '}
                          <strong className="text-[#f472b6] font-mono-num">
                            ৳{officialPeriodSummaries.allThreePeriodTotal.toLocaleString('en-US')}
                          </strong>{' '}
                          • কোন তারিখে কে কত টাকা নিয়েছে তার সম্পূর্ণ বিবরণ
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleDownloadOfficialExcel(selectedOfficialKey)}
                        className="inline-flex items-center gap-1.5 bg-[#10b981] hover:bg-emerald-400 text-[#04100c] rounded-md px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer"
                      >
                        <FileSpreadsheet className="w-3.5 h-3.5" />
                        <span>Excel (.xlsx)</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          officialScope === 'all_officials'
                            ? handlePrintCombinedOfficialsPdf()
                            : handlePrintOfficialProfile(selectedOfficialKey)
                        }
                        className="inline-flex items-center gap-1.5 bg-[#2563eb] hover:bg-blue-700 text-white rounded-md px-3.5 py-1.5 text-xs font-bold transition-colors cursor-pointer"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>প্রিন্ট / PDF ডাউনলোড</span>
                      </button>
                    </div>
                  </div>

                  {/* ক্যালেন্ডার রেঞ্জ ও ভিউ মোড ফিল্টার */}
                  <div className="pt-2.5 border-t border-[#17493d]/80 flex flex-wrap items-center justify-between gap-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      {/* ভিউ মোড: ৩ জন একসাথে নাকি নির্বাচিত ১ জন */}
                      <div className="flex items-center rounded-md border border-[#17493d] bg-[#091b18] p-0.5">
                        <button
                          type="button"
                          onClick={() => setOfficialScope('all_officials')}
                          className={`px-2.5 py-1 rounded text-xs font-bold cursor-pointer transition-colors ${
                            officialScope === 'all_officials'
                              ? 'bg-[#f97316] text-[#04100c]'
                              : 'text-[#8ea8a1] hover:text-[#f1f5f9]'
                          }`}
                        >
                          সকল ৩ জন একসাথে
                        </button>
                        <button
                          type="button"
                          onClick={() => setOfficialScope('selected')}
                          className={`px-2.5 py-1 rounded text-xs font-bold cursor-pointer transition-colors ${
                            officialScope === 'selected'
                              ? 'bg-[#f97316] text-[#04100c]'
                              : 'text-[#8ea8a1] hover:text-[#f1f5f9]'
                          }`}
                        >
                          শুধু {activeOfficialProfile.meta.nameBn}
                        </button>
                      </div>

                      {/* পিরিয়ড মোড */}
                      <div className="flex items-center rounded-md border border-[#17493d] bg-[#091b18] p-0.5">
                        <button
                          type="button"
                          onClick={() => setOfficialPeriodMode('all')}
                          className={`px-2.5 py-1 rounded text-xs font-bold cursor-pointer transition-colors ${
                            officialPeriodMode === 'all'
                              ? 'bg-[#10b981] text-[#04100c]'
                              : 'text-[#8ea8a1] hover:text-[#f1f5f9]'
                          }`}
                        >
                          সর্বকালীন
                        </button>
                        <button
                          type="button"
                          onClick={() => setOfficialPeriodMode('range')}
                          className={`px-2.5 py-1 rounded text-xs font-bold cursor-pointer transition-colors ${
                            officialPeriodMode === 'range'
                              ? 'bg-[#10b981] text-[#04100c]'
                              : 'text-[#8ea8a1] hover:text-[#f1f5f9]'
                          }`}
                        >
                          📅 ক্যালেন্ডার (তারিখ রেঞ্জ)
                        </button>
                        <button
                          type="button"
                          onClick={() => setOfficialPeriodMode('month')}
                          className={`px-2.5 py-1 rounded text-xs font-bold cursor-pointer transition-colors ${
                            officialPeriodMode === 'month'
                              ? 'bg-[#10b981] text-[#04100c]'
                              : 'text-[#8ea8a1] hover:text-[#f1f5f9]'
                          }`}
                        >
                          মাস (১–৩১)
                        </button>
                      </div>

                      {officialPeriodMode === 'range' && (
                        <div className="flex flex-wrap items-center gap-2 bg-[#091b18] border border-[#10b981]/50 rounded-md px-2.5 py-1 text-xs">
                          <label className="flex items-center gap-1.5">
                            <span className="text-[#8ea8a1]">শুরুর তারিখ:</span>
                            <input
                              type="date"
                              value={officialRangeFromKey}
                              onChange={(e) => setOfficialRangeFromKey(e.target.value)}
                              className="bg-[#071412] border border-[#17493d] focus:border-[#10b981] text-[#f1f5f9] rounded px-2 py-0.5 text-xs font-bold outline-none"
                            />
                          </label>
                          <span className="text-[#8ea8a1]">থেকে</span>
                          <label className="flex items-center gap-1.5">
                            <span className="text-[#8ea8a1]">শেষ তারিখ:</span>
                            <input
                              type="date"
                              value={officialRangeToKey}
                              onChange={(e) => setOfficialRangeToKey(e.target.value)}
                              className="bg-[#071412] border border-[#17493d] focus:border-[#10b981] text-[#f1f5f9] rounded px-2 py-0.5 text-xs font-bold outline-none"
                            />
                          </label>
                          <button
                            type="button"
                            onClick={() => {
                              setOfficialRangeFromKey(activeDateKey);
                              setOfficialRangeToKey(activeDateKey);
                            }}
                            className="px-2 py-0.5 rounded bg-[#071412] border border-[#17493d] hover:border-[#10b981] text-[11px] font-bold text-[#34d399] cursor-pointer"
                          >
                            আজকের তারিখ
                          </button>
                        </div>
                      )}

                      {officialPeriodMode === 'month' && (
                        <>
                          <div className="flex items-center gap-1 bg-[#091b18] border border-[#17493d] rounded-md px-1.5 py-1">
                            <button
                              type="button"
                              onClick={() => stepOfficialMonth(-1)}
                              aria-label="আগের মাস"
                              className="p-1 rounded hover:bg-[#17493d] text-[#f1f5f9] cursor-pointer"
                            >
                              <ChevronLeft className="w-3.5 h-3.5" />
                            </button>
                            <select
                              value={officialMonth}
                              onChange={(e) => {
                                setUserPickedReportPeriod(true);
                                setOfficialMonth(Number(e.target.value));
                              }}
                              className="bg-transparent text-xs font-bold text-[#f1f5f9] outline-none cursor-pointer px-1"
                            >
                              {BN_MONTHS.map((mName, idx) => (
                                <option key={mName} value={idx + 1} className="bg-[#071412] text-[#f1f5f9]">
                                  {mName}
                                </option>
                              ))}
                            </select>
                            <select
                              value={officialYear}
                              onChange={(e) => {
                                setUserPickedReportPeriod(true);
                                setOfficialYear(Number(e.target.value));
                              }}
                              className="bg-transparent text-xs font-bold text-[#34d399] outline-none cursor-pointer px-1"
                            >
                              {availableReportYears.map((yr) => (
                                <option key={yr} value={yr} className="bg-[#071412] text-[#f1f5f9]">
                                  {enToBn(yr)}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => stepOfficialMonth(1)}
                              aria-label="পরের মাস"
                              className="p-1 rounded hover:bg-[#17493d] text-[#f1f5f9] cursor-pointer"
                            >
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <div className="flex items-center gap-1.5 bg-[#091b18] border border-[#17493d] rounded-md px-2.5 py-1 text-xs">
                            <span className="text-[#8ea8a1]">তারিখ:</span>
                            <select
                              value={officialDayFrom}
                              onChange={(e) => setOfficialDayFrom(Number(e.target.value))}
                              aria-label="শুরুর তারিখ"
                              className="bg-transparent font-bold text-[#f1f5f9] outline-none cursor-pointer"
                            >
                              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                                <option key={d} value={d} className="bg-[#071412] text-[#f1f5f9]">
                                  {enToBn(d)}
                                </option>
                              ))}
                            </select>
                            <span className="text-[#8ea8a1]">–</span>
                            <select
                              value={officialDayTo}
                              onChange={(e) => setOfficialDayTo(Number(e.target.value))}
                              aria-label="শেষ তারিখ"
                              className="bg-transparent font-bold text-[#f1f5f9] outline-none cursor-pointer"
                            >
                              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                                <option key={d} value={d} className="bg-[#071412] text-[#f1f5f9]">
                                  {enToBn(d)}
                                </option>
                              ))}
                            </select>
                          </div>
                        </>
                      )}
                    </div>

                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-[#8ea8a1] absolute left-2.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={officialSearch}
                        onChange={(e) => setOfficialSearch(e.target.value)}
                        placeholder="নাম, বিবরণ বা তারিখ খুঁজুন..."
                        className="bg-[#091b18] border border-[#17493d] focus:border-[#10b981] text-[#f1f5f9] rounded-md pl-8 pr-3 py-1.5 text-xs outline-none w-[210px]"
                      />
                    </div>
                  </div>
                </div>

                {/* ৪টি KPI কার্ড */}
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                  <div className="bg-[#0a1f1c] border-[1.5px] border-[#17493d] rounded-[10px] px-4 py-3">
                    <div className="text-[11px] font-semibold text-[#8ea8a1]">
                      নির্বাচিত সময়ে মোট প্রদত্ত
                    </div>
                    <div className="text-[20px] font-bold text-[#f472b6] font-mono-num mt-0.5">
                      ৳{enToBn(officialPeriodSummaries.combinedFilteredTotal) || '০'}
                    </div>
                    <div className="text-[10.5px] text-[#8ea8a1]">
                      {officialPeriodSummaries.periodLabel}
                    </div>
                  </div>

                  <div className="bg-[#0a1f1c] border-[1.5px] border-[#17493d] rounded-[10px] px-4 py-3">
                    <div className="text-[11px] font-semibold text-[#8ea8a1]">এন্ট্রি ও কার্যদিবস</div>
                    <div className="text-[20px] font-bold text-[#34d399] font-mono-num mt-0.5">
                      {enToBn(officialPeriodSummaries.combinedEntries.length) || '০'} টি /{' '}
                      {enToBn(officialPeriodSummaries.combinedFilteredDays) || '০'} দিন
                    </div>
                    <div className="text-[10.5px] text-[#8ea8a1]">
                      গড় প্রতি এন্ট্রি: ৳
                      {enToBn(
                        officialPeriodSummaries.combinedEntries.length > 0
                          ? Math.round(
                              officialPeriodSummaries.combinedFilteredTotal /
                                officialPeriodSummaries.combinedEntries.length
                            )
                          : 0
                      ) || '০'}
                    </div>
                  </div>

                  <div className="bg-[#0a1f1c] border-[1.5px] border-[#17493d] rounded-[10px] px-4 py-3">
                    <div className="text-[11px] font-semibold text-[#8ea8a1]">
                      নির্বাচিত দিন ({toBnDigitsString(activeDate)})
                    </div>
                    <div className="text-[20px] font-bold text-[#60a5fa] font-mono-num mt-0.5">
                      ৳
                      {enToBn(
                        officialScope === 'all_officials'
                          ? officialProfilesData.md.activeDateTotal +
                              officialProfilesData.dir.activeDateTotal +
                              officialProfilesData.gm.activeDateTotal
                          : activeOfficialProfile.activeDateTotal
                      ) || '০'}
                    </div>
                    <div className="text-[10.5px] text-[#8ea8a1]">দৈনিক শীটের সক্রিয় তারিখ</div>
                  </div>

                  <div className="bg-[#0a1f1c] border-[1.5px] border-[#17493d] rounded-[10px] px-4 py-3">
                    <div className="text-[11px] font-semibold text-[#8ea8a1]">সর্বকালীন মোট প্রদত্ত</div>
                    <div className={`text-[20px] font-bold font-mono-num mt-0.5 ${activeOfficialProfile.meta.textClass}`}>
                      ৳
                      {enToBn(
                        officialScope === 'all_officials'
                          ? officialProfilesData.md.lifetimeTotal +
                              officialProfilesData.dir.lifetimeTotal +
                              officialProfilesData.gm.lifetimeTotal
                          : activeOfficialProfile.lifetimeTotal
                      ) || '০'}
                    </div>
                    <div className="text-[10.5px] text-[#8ea8a1]">
                      মোট{' '}
                      {enToBn(
                        officialScope === 'all_officials'
                          ? officialProfilesData.md.entryCount +
                              officialProfilesData.dir.entryCount +
                              officialProfilesData.gm.entryCount
                          : activeOfficialProfile.entryCount
                      ) || '০'}{' '}
                      টি লেনদেন
                    </div>
                  </div>
                </div>

                {/* মাসভিত্তিক সারসংক্ষেপ (দ্রুত ফিল্টার চিপস) */}
                {activeOfficialProfile.monthlyBreakdown.length > 0 && (
                  <div className="bg-[#0a1f1c] border-[1.5px] border-[#17493d] rounded-[10px] p-3.5 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-bold text-[#f1f5f9]">
                        📆 মাসভিত্তিক হিসাব ({activeOfficialProfile.meta.nameBn})
                      </span>
                      <span className="text-[11px] text-[#8ea8a1]">
                        যেকোনো মাসে ক্লিক করলে সেই মাসের হিসাব আলাদা হবে
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {activeOfficialProfile.monthlyBreakdown.map((mb) => {
                        const isActiveMonth =
                          officialPeriodMode === 'month' &&
                          officialYear === mb.year &&
                          officialMonth === mb.month;
                        return (
                          <button
                            key={mb.ymKey}
                            type="button"
                            onClick={() => {
                              setUserPickedReportPeriod(true);
                              setOfficialPeriodMode('month');
                              setOfficialYear(mb.year);
                              setOfficialMonth(mb.month);
                              setOfficialDayFrom(1);
                              setOfficialDayTo(31);
                            }}
                            className={`px-3 py-1.5 rounded-lg border text-left transition-colors cursor-pointer ${
                              isActiveMonth
                                ? 'bg-[#10b981]/20 border-[#10b981] text-[#f1f5f9]'
                                : 'bg-[#091b18] border-[#17493d] hover:border-[#10b981]/60 text-[#cbd5e1]'
                            }`}
                          >
                            <div className="text-[11px] font-bold">{mb.labelBn}</div>
                            <div className="text-[12px] font-bold text-[#f472b6] font-mono-num">
                              ৳{mb.total.toLocaleString('en-US')}{' '}
                              <span className="text-[10px] text-[#8ea8a1] font-normal">
                                ({enToBn(mb.count)} টি)
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* কোন তারিখে কে কত টাকা নিয়েছে — বিস্তারিত বিবরণ তালিকা */}
                <div className="bg-[#0a1f1c] border-[1.5px] border-[#17493d] rounded-[10px] p-4 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="text-[13px] font-bold text-[#f1f5f9]">
                      📑 কোন তারিখে কে কত টাকা নিয়েছে — বিস্তারিত বিবরণ তালিকা
                    </h4>
                    <span className="text-xs font-bold text-[#34d399] font-mono-num">
                      মোট ({enToBn(officialPeriodSummaries.combinedEntries.length) || '০'} টি): ৳
                      {officialPeriodSummaries.combinedFilteredTotal.toLocaleString('en-US')}
                    </span>
                  </div>

                  <div className="overflow-x-auto border border-[#17493d] rounded-lg">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-[#071412] text-[#8ea8a1] border-b border-[#17493d]">
                          <th className="py-2.5 px-3 text-center w-12">নং</th>
                          <th className="py-2.5 px-3 text-center w-28">তারিখ</th>
                          <th className="py-2.5 px-3 text-left w-44">কর্মকর্তা (কে নিয়েছে)</th>
                          <th className="py-2.5 px-3 text-center w-24">মাধ্যম</th>
                          <th className="py-2.5 px-3 text-left">ব্যয়ের বিবরণ / নোট</th>
                          <th className="py-2.5 px-3 text-right w-36">টাকা দেওয়া হলো (৳)</th>
                          <th className="py-2.5 px-3 text-center w-24">রিসিট</th>
                        </tr>
                      </thead>
                      <tbody>
                        {officialPeriodSummaries.combinedEntries.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="py-8 text-center text-[#8ea8a1]">
                              নির্বাচিত তারিখে কোনো কর্মকর্তার হিসাব পাওয়া যায়নি।
                            </td>
                          </tr>
                        ) : (
                          officialPeriodSummaries.combinedEntries.map((entry, idx) => (
                            <tr
                              key={`${entry.id}-${idx}`}
                              className="border-b border-[#17493d]/60 hover:bg-[#091b18]/80"
                            >
                              <td className="py-2 px-3 text-center text-[#8ea8a1] font-mono-num">
                                {enToBn(idx + 1)}
                              </td>
                              <td className="py-2 px-3 text-center font-bold text-[#f1f5f9] font-mono-num whitespace-nowrap">
                                {toBnDigitsString(entry.date)}
                              </td>
                              <td className="py-2 px-3 whitespace-nowrap">
                                <span className={`font-bold ${entry.meta.textClass}`}>
                                  {entry.meta.nameBn}
                                </span>
                                <span className="text-[10px] text-[#8ea8a1] ml-1">
                                  ({entry.meta.roleBn})
                                </span>
                              </td>
                              <td className="py-2 px-3 text-center">
                                <span className="inline-block px-2 py-0.5 rounded bg-[#091b18] border border-[#17493d] text-[10.5px] font-bold text-[#cbd5e1]">
                                  {entry.account}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-[#f1f5f9]">{entry.expSrc}</td>
                              <td className="py-2 px-3 text-right font-bold text-[#f472b6] font-mono-num whitespace-nowrap">
                                ৳{entry.amount.toLocaleString('en-US')}
                              </td>
                              <td className="py-2 px-3 text-center">
                                <button
                                  type="button"
                                  onClick={() => setReceiptRow(entry.row)}
                                  className="text-[11px] font-bold text-[#34d399] hover:underline cursor-pointer"
                                >
                                  রিসিট
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                      {officialPeriodSummaries.combinedEntries.length > 0 && (
                        <tfoot>
                          <tr className="bg-[#071412] border-t-2 border-[#10b981]/60 font-bold">
                            <td colSpan={5} className="py-2.5 px-3 text-right text-[#f1f5f9]">
                              সর্বমোট ({enToBn(officialPeriodSummaries.combinedEntries.length) || '০'} টি এন্ট্রি):
                            </td>
                            <td className="py-2.5 px-3 text-right text-[14px] text-[#34d399] font-mono-num whitespace-nowrap">
                              ৳{officialPeriodSummaries.combinedFilteredTotal.toLocaleString('en-US')}
                            </td>
                            <td className="py-2.5 px-3" />
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ট্যাব ৪: ব্যাকআপ, রিস্টোর, Excel ইমপোর্ট ও ডাউনলোড */}
            {activePane === 'toolsPane' && (
              <div className="space-y-3">
                <div className="bg-[#0a1f1c] border-[1.5px] border-[#17493d] rounded-[10px] p-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-[#f1f5f9]">
                      📂 ফাইল ব্যাকআপ, Excel ইমপোর্ট ও ডাউনলোড সেন্টার
                    </h3>
                    <p className="text-[11.5px] text-[#8ea8a1] mt-0.5">
                      JSON ব্যাকআপ/রিস্টোর, আগের দিনের একাধিক Excel (.xlsx) ইমপোর্ট এবং দৈনিক শীট এক্সপোর্ট করুন
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 bg-[#091b18] border border-[#17493d] rounded-lg px-2.5 py-1.5">
                    <span className="text-[11px] text-[#8ea8a1]">এক্সপোর্ট তারিখ:</span>
                    <button
                      type="button"
                      onClick={() => stepActiveDate(-1)}
                      aria-label="আগের দিন"
                      className="px-1.5 py-0.5 rounded bg-[#071412] border border-[#17493d] hover:border-[#10b981] text-xs font-bold cursor-pointer"
                    >
                      ‹
                    </button>
                    <span className="text-xs font-bold text-[#34d399] px-1">
                      {toBnDigitsString(activeDate)} ({dayName})
                    </span>
                    <button
                      type="button"
                      onClick={() => stepActiveDate(1)}
                      aria-label="পরের দিন"
                      className="px-1.5 py-0.5 rounded bg-[#071412] border border-[#17493d] hover:border-[#10b981] text-xs font-bold cursor-pointer"
                    >
                      ›
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="bg-[#0a1f1c] border-[1.5px] border-[#17493d] rounded-[10px] p-4 space-y-3">
                    <div>
                      <h4 className="text-[13px] font-bold text-[#60a5fa]">
                        ব্যাকআপ ও রিস্টোর (JSON)
                      </h4>
                      <p className="text-[11px] text-[#8ea8a1] mt-0.5">
                        সম্পূর্ণ General Accounts ডেটা সংরক্ষণ করুন বা আগের ব্যাকআপ ফাইল থেকে ফিরিয়ে আনুন
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2.5">
                      <button
                        type="button"
                        onClick={handleExportJson}
                        className="inline-flex items-center gap-1.5 bg-[#2563eb] hover:bg-blue-700 text-white rounded-md px-3.5 py-2 text-xs font-bold transition-colors cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>💾 Backup</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={busy}
                        className="inline-flex items-center gap-1.5 bg-[#091b18] hover:bg-[#0e2924] text-[#f1f5f9] border border-[#17493d] rounded-md px-3.5 py-2 text-xs font-bold transition-colors cursor-pointer disabled:opacity-60"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>📂 Restore</span>
                      </button>
                    </div>
                  </div>

                  <div className="bg-[#0a1f1c] border-[1.5px] border-[#17493d] rounded-[10px] p-4 space-y-3">
                    <div>
                      <h4 className="text-[13px] font-bold text-[#34d399]">
                        Excel (.xlsx) ও PDF রিপোর্ট
                      </h4>
                      <p className="text-[11px] text-[#8ea8a1] mt-0.5">
                        এক বা একাধিক Excel ফাইল ইমপোর্ট করুন অথবা নির্বাচিত তারিখের Excel / PDF ডাউনলোড করুন
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => excelImportInputRef.current?.click()}
                        disabled={busy || excelImportLoading}
                        className="inline-flex items-center gap-1.5 bg-[#0f2e28] hover:bg-[#143d35] text-[#34d399] border border-[#10b981]/60 rounded-md px-3.5 py-2 text-xs font-bold transition-colors cursor-pointer disabled:opacity-60"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>
                          {excelImportLoading ? 'লোড হচ্ছে...' : '📥 Import Excel (.xlsx)'}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => void handleExportStyledExcel()}
                        className="inline-flex items-center gap-1.5 bg-[#10b981] hover:bg-emerald-400 text-[#04100c] rounded-md px-3.5 py-2 text-xs font-bold transition-colors cursor-pointer"
                      >
                        <FileSpreadsheet className="w-3.5 h-3.5" />
                        <span>📊 Download XL (.xlsx)</span>
                      </button>

                      <button
                        type="button"
                        onClick={handlePrintSheetPdf}
                        className="inline-flex items-center gap-1.5 bg-[#ec4899] hover:bg-pink-600 text-white rounded-md px-3.5 py-2 text-xs font-bold transition-colors cursor-pointer"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>📄 Download PDF</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Money Receipt Modal */}
      {receiptRow && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-white text-black rounded-xl max-w-[480px] w-full p-5 shadow-2xl border-2 border-black">
            <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-300">
              <span className="text-xs font-bold text-emerald-700">MONEY RECEIPT PREVIEW</span>
              <button
                type="button"
                onClick={() => setReceiptRow(null)}
                className="text-slate-600 hover:text-black cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="border-2 border-black p-4 rounded-md space-y-2 text-sm">
              <h3 className="text-center font-bold text-base">
                আইডিয়াল টেকনিক্যাল ট্রেনিং এন্ড টেস্টিং সেন্টার
              </h3>
              <div className="text-center text-xs mb-3">মানি রিসিট / ক্যাশ ভাউচার</div>
              <div className="flex justify-between border-b border-dashed border-slate-400 pb-1">
                <span>ভাউচার নং:</span>
                <strong>{receiptRow.voucher || 'N/A'}</strong>
              </div>
              {receiptRow.khataNo && (
                <div className="flex justify-between border-b border-dashed border-slate-400 pb-1">
                  <span>খাতা নাম্বার:</span>
                  <strong>{receiptRow.khataNo}</strong>
                </div>
              )}
              {receiptRow.khataNo && findStudentByKhata(receiptRow.khataNo) && (
                <div className="flex justify-between border-b border-dashed border-slate-400 pb-1">
                  <span>ছাত্রের নাম:</span>
                  <strong>{findStudentByKhata(receiptRow.khataNo)?.name}</strong>
                </div>
              )}
              <div className="flex justify-between border-b border-dashed border-slate-400 pb-1">
                <span>তারিখ:</span>
                <strong>{receiptRow.date}</strong>
              </div>
              <div className="flex justify-between border-b border-dashed border-slate-400 pb-1">
                <span>অ্যাকাউন্ট:</span>
                <strong>
                  {receiptRow.account || 'Cash'}
                  {receiptRow.incBank < 0 ? ' (ব্যাংক থেকে প্রদান)' : ''}
                </strong>
              </div>
              <div className="flex justify-between border-b border-dashed border-slate-400 pb-1 gap-4">
                <span className="shrink-0">বিবরণ:</span>
                <strong className="text-right">
                  {receiptRow.incSrc || receiptRow.expSrc || 'সাধারণ হিসাব'}
                </strong>
              </div>
              <div className="flex justify-between border-b border-dashed border-slate-400 pb-1">
                <span>পরিমাণ:</span>
                <strong>
                  ৳{' '}
                  {Math.abs(
                    receiptRow.incCash ||
                      receiptRow.incBank ||
                      receiptRow.expAmt ||
                      0
                  ).toLocaleString('en-US')}
                </strong>
              </div>
              <div className="pt-8 flex justify-between text-xs">
                <span>গ্রহীতার স্বাক্ষর</span>
                <span>কর্তৃপক্ষের স্বাক্ষর</span>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setReceiptRow(null)}
                className="px-3.5 py-1.5 rounded-md border border-slate-300 text-xs font-bold text-slate-700 cursor-pointer"
              >
                বন্ধ করুন
              </button>
              <button
                type="button"
                onClick={() => handlePrintReceipt(receiptRow)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-[#10b981] hover:bg-emerald-500 text-[#04100c] text-xs font-bold cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>প্রিন্ট রিসিট</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Multi-File Excel (.xlsx) Import Preview & Mode Modal */}
      {excelPreviewFiles && excelPreviewFiles.length > 0 && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-[#071412] text-[#f1f5f9] rounded-xl max-w-[660px] w-full p-5 shadow-2xl border-[1.5px] border-[#10b981]/60 space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-start justify-between gap-3 pb-2.5 border-b border-[#17493d]">
              <div>
                <h3 className="text-sm font-bold text-[#34d399] flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>Excel ফাইল ইমপোর্ট প্রিভিউ ({excelPreviewFiles.length}টি ফাইল)</span>
                </h3>
                <p className="text-[11px] text-[#8ea8a1] mt-0.5">
                  তারিখ অনুযায়ী ক্রমানুসারে সাজানো হয়েছে • বাংলা/ইংরেজি সংখ্যা ও কমা অটো কনভার্ট হবে
                </p>
              </div>
              <button
                type="button"
                onClick={() => setExcelPreviewFiles(null)}
                disabled={busy}
                className="text-[#8ea8a1] hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto space-y-2 pr-1 max-h-[260px]">
              {excelPreviewFiles.map((fileItem, idx) => (
                <div
                  key={`${fileItem.fileName}_${idx}`}
                  className="bg-[#0a1f1c] border border-[#17493d] rounded-lg px-3 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="font-bold text-[#f1f5f9] truncate flex items-center gap-2">
                      <span className="px-1.5 py-0.5 rounded bg-[#10b981]/20 text-[#34d399] text-[10px] font-mono">
                        #{idx + 1} • {fileItem.fileDateDot || 'তারিখ অজানা'}
                      </span>
                      <span className="truncate">{fileItem.fileName}</span>
                    </div>
                    <div className="text-[11px] text-[#8ea8a1] mt-1 flex flex-wrap gap-3">
                      <span>
                        আসল লেনদেন:{' '}
                        <strong className="text-white">{fileItem.txRows.length}টি</strong>
                      </span>
                      {fileItem.opening && (
                        <span>
                          পূর্বের ব্যালেন্স: Cash ৳{fileItem.opening.cash.toLocaleString('en-US')} |
                          Bank ৳{fileItem.opening.bank.toLocaleString('en-US')}
                          {idx > 0 && ' (অটো ক্যারি-ফরওয়ার্ড হবে)'}
                        </span>
                      )}
                      {fileItem.skippedFooterCount > 0 && (
                        <span className="text-amber-300">
                          বাদ দেওয়া ফুটার/টোটাল সারি: {fileItem.skippedFooterCount}টি
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="bg-[#091b18] border border-[#17493d] rounded-lg p-3 text-[11.5px] text-[#cbd5e1] space-y-1">
              <div className="font-bold text-[#34d399]">পূর্বের ব্যালেন্স চেইন (Carry-Forward):</div>
              <div>
                • <strong>অপশন A (আগের ডেটার সাথে যোগ / Append):</strong> বর্তমান অ্যাপের ডেটা
                ঠিক থাকবে, নতুন লেনদেন যুক্ত হবে এবং ডাবল হওয়া এড়াতে নতুন ফাইলের{' '}
                <em>পূর্বের ব্যালেন্স</em> সারি স্বয়ংক্রিয়ভাবে বাদ যাবে।
              </div>
              <div>
                • <strong>অপশন B (নতুন করে লোড / Replace):</strong> বর্তমান ডেটা মুছে শুধু প্রথম
                ফাইলের <em>পূর্বের ব্যালেন্স</em> রাখা হবে এবং পরের ফাইলগুলোর মূল লেনদেন যুক্ত হয়ে
                অটো ব্যালেন্স হিসাব হবে।
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setExcelPreviewFiles(null)}
                disabled={busy}
                className="px-3.5 py-2 rounded-md border border-[#17493d] bg-[#091b18] text-xs font-bold text-[#cbd5e1] hover:text-white cursor-pointer disabled:opacity-50"
              >
                বাতিল
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmExcelImport('append')}
                disabled={busy}
                className="px-3.5 py-2 rounded-md bg-[#2563eb] hover:bg-blue-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                ➕ আগের ডেটার সাথে যোগ করুন (Append)
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmExcelImport('replace')}
                disabled={busy}
                className="px-3.5 py-2 rounded-md bg-[#10b981] hover:bg-emerald-400 text-[#04100c] text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                🔄 বর্তমান ডেটা মুছে নতুন লোড করুন (Replace)
              </button>
            </div>
          </div>
        </div>
      )}
      {/* 4 Purpose Categories (Welding, Fitter, Visa, P.P.E) Details & PDF Modal */}
      {purposeModalCat && purposeModalData && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-3 sm:p-5">
          <div className="bg-[#071412] text-[#f1f5f9] rounded-xl max-w-[920px] w-full p-4 sm:p-5 shadow-2xl border-[1.5px] border-[#10b981]/60 flex flex-col gap-3.5 max-h-[92vh]">
            <div className="flex flex-wrap items-start justify-between gap-3 pb-2.5 border-b border-[#17493d]">
              <div>
                <h3 className={`text-base font-extrabold ${purposeModalData.meta.textClass}`}>
                  {purposeModalData.meta.titleBn} — বিস্তারিত বিবরণ
                </h3>
                <p className="text-[11.5px] text-[#8ea8a1] mt-0.5">
                  {purposeModalData.meta.subtitle} • {purposeModalData.periodLabel}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleDownloadPurposeExcel(purposeModalCat)}
                  className="inline-flex items-center gap-1.5 bg-[#10b981] hover:bg-emerald-400 text-[#04100c] rounded-md px-3 py-1.5 text-xs font-bold cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>Excel (.xlsx)</span>
                </button>
                <button
                  type="button"
                  onClick={() => handlePrintPurposePdf(purposeModalCat)}
                  className="inline-flex items-center gap-1.5 bg-[#ec4899] hover:bg-pink-600 text-white rounded-md px-3.5 py-1.5 text-xs font-bold cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>📄 Download PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPurposeModalCat(null)}
                  className="p-1.5 rounded-md border border-[#17493d] bg-[#091b18] text-[#8ea8a1] hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Category Tabs + Scope + Calendar Filter */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {PURPOSE_CATEGORY_CARDS.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setPurposeModalCat(c.key)}
                    className={`px-2.5 py-1.5 rounded-md text-xs font-bold border cursor-pointer transition-colors ${
                      purposeModalCat === c.key
                        ? `bg-[#091b18] ${c.borderClass} ${c.textClass}`
                        : 'bg-[#091b18]/50 border-[#17493d] text-[#8ea8a1] hover:text-white'
                    }`}
                  >
                    {c.titleBn}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setPurposeModalScope('active_date')}
                  className={`px-2.5 py-1 rounded text-[11px] font-bold border cursor-pointer ${
                    purposeModalScope === 'active_date'
                      ? 'bg-[#10b981] text-[#04100c] border-[#10b981]'
                      : 'bg-[#091b18] text-[#8ea8a1] border-[#17493d]'
                  }`}
                >
                  আজ ({toBnDigitsString(activeDate)})
                </button>
                <button
                  type="button"
                  onClick={() => setPurposeModalScope('range')}
                  className={`px-2.5 py-1 rounded text-[11px] font-bold border cursor-pointer ${
                    purposeModalScope === 'range'
                      ? 'bg-[#10b981] text-[#04100c] border-[#10b981]'
                      : 'bg-[#091b18] text-[#8ea8a1] border-[#17493d]'
                  }`}
                >
                  📅 তারিখ রেঞ্জ
                </button>
                <button
                  type="button"
                  onClick={() => setPurposeModalScope('all')}
                  className={`px-2.5 py-1 rounded text-[11px] font-bold border cursor-pointer ${
                    purposeModalScope === 'all'
                      ? 'bg-[#10b981] text-[#04100c] border-[#10b981]'
                      : 'bg-[#091b18] text-[#8ea8a1] border-[#17493d]'
                  }`}
                >
                  সর্বকালীন
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 bg-[#0a1f1c] border border-[#17493d] rounded-lg px-3 py-2">
              {purposeModalScope === 'range' ? (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <label className="flex items-center gap-1.5">
                    <span className="text-[#8ea8a1]">শুরু:</span>
                    <input
                      type="date"
                      value={purposeDateFromKey}
                      onChange={(e) => setPurposeDateFromKey(e.target.value)}
                      className="bg-[#071412] border border-[#17493d] text-[#f1f5f9] rounded px-2 py-1 text-xs font-bold outline-none"
                    />
                  </label>
                  <label className="flex items-center gap-1.5">
                    <span className="text-[#8ea8a1]">শেষ:</span>
                    <input
                      type="date"
                      value={purposeDateToKey}
                      onChange={(e) => setPurposeDateToKey(e.target.value)}
                      className="bg-[#071412] border border-[#17493d] text-[#f1f5f9] rounded px-2 py-1 text-xs font-bold outline-none"
                    />
                  </label>
                </div>
              ) : (
                <div className="text-xs text-[#cbd5e1] flex flex-wrap items-center gap-3 font-mono-num">
                  <span>
                    এন্ট্রি: <strong className="text-white">{enToBn(purposeModalData.items.length) || '০'} টি</strong>
                  </span>
                  <span>
                    নগদ: <strong className="text-[#34d399]">৳{purposeModalData.cashTotal.toLocaleString('en-US')}</strong>
                  </span>
                  <span>
                    ব্যাংক: <strong className="text-[#60a5fa]">৳{purposeModalData.bankTotal.toLocaleString('en-US')}</strong>
                  </span>
                  <span>
                    মোট: <strong className="text-[#f472b6]">৳{purposeModalData.grandTotal.toLocaleString('en-US')}</strong>
                  </span>
                </div>
              )}

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-[#8ea8a1] absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={purposeSearch}
                  onChange={(e) => setPurposeSearch(e.target.value)}
                  placeholder="খাতা, নাম বা ভাউচার খুঁজুন..."
                  className="bg-[#071412] border border-[#17493d] focus:border-[#10b981] text-[#f1f5f9] rounded-md pl-8 pr-3 py-1 text-xs outline-none w-[210px]"
                />
              </div>
            </div>

            {/* Itemized Breakdown Table */}
            <div className="overflow-auto border border-[#17493d] rounded-lg flex-1 min-h-[200px]">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-[#0a1f1c] text-[#8ea8a1] border-b border-[#17493d] sticky top-0">
                    <th className="py-2 px-2.5 text-center w-10">নং</th>
                    <th className="py-2 px-2.5 text-center w-24">তারিখ</th>
                    <th className="py-2 px-2.5 text-center w-24">ভাউচার</th>
                    <th className="py-2 px-2.5 text-left w-40">খাতা / ছাত্র</th>
                    <th className="py-2 px-2.5 text-center w-20">মাধ্যম</th>
                    <th className="py-2 px-2.5 text-left">বিবরণ</th>
                    <th className="py-2 px-2.5 text-right w-24">নগদ (৳)</th>
                    <th className="py-2 px-2.5 text-right w-24">ব্যাংক (৳)</th>
                    <th className="py-2 px-2.5 text-right w-24">মোট (৳)</th>
                  </tr>
                </thead>
                <tbody>
                  {purposeModalData.items.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-10 text-center text-[#8ea8a1]">
                        নির্বাচিত সময়ে এই খাতে কোনো জমা পাওয়া যায়নি।
                      </td>
                    </tr>
                  ) : (
                    purposeModalData.items.map((item, idx) => (
                      <tr
                        key={`${item.row.raw.id}-${idx}`}
                        className="border-b border-[#17493d]/60 hover:bg-[#091b18]"
                      >
                        <td className="py-2 px-2.5 text-center text-[#8ea8a1] font-mono-num">
                          {enToBn(idx + 1)}
                        </td>
                        <td className="py-2 px-2.5 text-center font-bold text-[#f1f5f9] font-mono-num whitespace-nowrap">
                          {toBnDigitsString(item.row.date)}
                        </td>
                        <td className="py-2 px-2.5 text-center font-mono-num text-[#cbd5e1]">
                          {item.row.voucher || '—'}
                        </td>
                        <td className="py-2 px-2.5 text-[#f1f5f9]">
                          {item.row.khataNo ? (
                            <span>
                              <strong className="text-[#34d399] font-mono-num">
                                {item.row.khataNo}
                              </strong>
                              {item.studentName ? ` (${item.studentName})` : ''}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-2 px-2.5 text-center">
                          <span className="px-1.5 py-0.5 rounded bg-[#091b18] border border-[#17493d] text-[10px] font-bold">
                            {item.row.account}
                          </span>
                        </td>
                        <td className="py-2 px-2.5 text-[#f1f5f9]">
                          {cleanDisplayPurpose(item.row.incSrc) || '—'}
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono-num text-[#34d399]">
                          {item.row.incCash ? `৳${item.row.incCash.toLocaleString('en-US')}` : '—'}
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono-num text-[#60a5fa]">
                          {item.row.incBank ? `৳${item.row.incBank.toLocaleString('en-US')}` : '—'}
                        </td>
                        <td className="py-2 px-2.5 text-right font-bold font-mono-num text-[#f472b6]">
                          ৳{item.totalAmt.toLocaleString('en-US')}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {purposeModalData.items.length > 0 && (
                  <tfoot>
                    <tr className="bg-[#0a1f1c] border-t-2 border-[#10b981]/60 font-bold">
                      <td colSpan={6} className="py-2.5 px-2.5 text-right text-[#f1f5f9]">
                        সর্বমোট ({enToBn(purposeModalData.items.length) || '০'} টি):
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono-num text-[#34d399]">
                        ৳{purposeModalData.cashTotal.toLocaleString('en-US')}
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono-num text-[#60a5fa]">
                        ৳{purposeModalData.bankTotal.toLocaleString('en-US')}
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono-num text-[#f472b6]">
                        ৳{purposeModalData.grandTotal.toLocaleString('en-US')}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
