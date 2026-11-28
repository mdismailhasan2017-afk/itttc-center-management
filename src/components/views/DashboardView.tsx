import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Briefcase,
  CalendarRange,
  CheckCircle2,
  CreditCard,
  Eye,
  EyeOff,
  FileText,
  History,
  MessageSquare,
  Plus,
  Printer,
  RefreshCw,
  Sparkles,
  Trash2,
  TrendingUp,
  UserCheck,
  UserPlus,
  UserX,
  Users,
  X,
  Zap,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { computeQuickActionsSummary, computeStudentJobActivity } from '../../lib/analytics';
import {
  applyUiSettingsToDocument,
  BUILTIN_COLOR_GRADING_PRESETS,
  DEFAULT_UI_SETTINGS,
  saveUiSettings,
  type AccentTheme,
  type ColorGradingPreset,
  type UiAppearanceSettings,
} from '../../lib/appearance';
import { formatTaka, todayDDMMYYYY } from '../../lib/format';
import {
  BN_MONTHS,
  DAY_LOCK_MARKER,
  OFFICIAL_KEYS_ORDER,
  OFFICIAL_PROFILES,
  buildGeneralAccountsLedger,
  canonicalDateKey,
  cleanDisplayPurpose,
  getPrevDotDate,
  normalizeToDotDate,
  parseAccountNum,
  parseRowDateParts,
  serializeInDesc,
  type AccountKind,
  type EntryMode,
} from '../../lib/generalAccountsEngine';
import { buildJobSlipFromEntry, isProtectedDefaultPrice, sortJobPrices } from '../../lib/jobLimits';
import { KineticCounter } from '../../lib/motion';
import type { CenterDataState, SubCollectionKey } from '../../lib/store';
import type { CenterSettings, Lang, NavKey, SlipData, Student, ThemeMode } from '../../types';
import { SyncedRoundLogo } from '../SyncedRoundLogo';
import type { InactiveFilterPreset } from './InactiveStudentsView';

interface DashboardViewProps {
  data: CenterDataState;
  lang: Lang;
  theme?: ThemeMode;
  appearance: UiAppearanceSettings;
  megaConfigured?: boolean;
  onNavigate: (page: NavKey, categoryFilter?: string) => void;
  onOpenInactiveStudents?: (preset: InactiveFilterPreset) => void;
  onOpenNewJob: (preselectedCat?: string) => void;
  onOpenOutJob: () => void;
  onOpenAddStudent: () => void;
  onOpenStudentProfile?: (code: string) => void;
  onOpenIssueJobForStudent?: (code: string) => void;
  onPrintSlip: (slip: SlipData) => void;
  onLoadDemo: () => void;
  onSetTheme?: (theme: ThemeMode) => void;
  onSetLang?: (lang: Lang) => void;
  onChangeAppearance?: (next: UiAppearanceSettings) => void;
  onSaveAppearance?: (next: UiAppearanceSettings) => boolean;
  onResetAppearance?: () => void;
  onOpenSettingsDrawer?: () => void;
  onAddRecord?: <K extends SubCollectionKey>(
    key: K,
    raw: Record<string, unknown>,
    customId?: string
  ) => Promise<string>;
  onUpdateRecord?: <K extends SubCollectionKey>(
    key: K,
    id: string,
    patch: Record<string, unknown>
  ) => Promise<void>;
  onDeleteRecord?: <K extends SubCollectionKey>(key: K, id: string) => Promise<void>;
  onUnlockGeneralAccounts?: (unlocked: boolean) => void;
  onUpdateCenterSettings?: (patch: Partial<CenterSettings>) => Promise<void>;
  onLogAudit?: (action: string, module: string, detail: string) => Promise<void>;
  onSyncMegaNow?: () => Promise<void>;
  onPullMegaNow?: () => Promise<void>;
  onVerifyCloudSync?: () => Promise<boolean>;
}

interface CommandAction {
  label: string;
  tone?: 'primary' | 'secondary';
  onClick: () => void;
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'ai';
  title?: string;
  text: string;
  tone?: 'info' | 'warn' | 'success';
  actions?: CommandAction[];
}

interface SavedChatMessage {
  id: string;
  sender: 'user' | 'ai';
  title?: string;
  text: string;
  tone?: 'info' | 'warn' | 'success';
}

interface ChatSession {
  id: string;
  title: string;
  updatedAt: number;
  messages: SavedChatMessage[];
}

const CHAT_HISTORY_STORAGE_KEY = 'ittc_chat_history_v1';

function loadSavedChatHistory(): ChatSession[] {
  try {
    const raw = window.localStorage.getItem(CHAT_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (s): s is ChatSession =>
          Boolean(s && typeof s.id === 'string' && Array.isArray(s.messages) && s.messages.length > 0)
      )
      .slice(0, 100);
  } catch {
    return [];
  }
}

function persistChatHistory(sessions: ChatSession[]): void {
  try {
    window.localStorage.setItem(CHAT_HISTORY_STORAGE_KEY, JSON.stringify(sessions.slice(0, 100)));
  } catch {
    // Ignore storage quota errors
  }
}

function normalizeBengaliDigits(input: string): string {
  return input.replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d)));
}

type RevenueRange = '6m' | '12m' | 'all';

interface MonthlyRevenuePoint {
  key: string; // YYYY-MM
  shortLabel: string;
  fullLabel: string;
  courseDeposit: number;
  visaDeposit: number;
  revenue: number;
  entriesCount: number;
  isPeak: boolean;
}

const EN_MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const BN_MONTH_SHORT = [
  'জানু',
  'ফেব্রু',
  'মার্চ',
  'এপ্রিল',
  'মে',
  'জুন',
  'জুলাই',
  'আগস্ট',
  'সেপ্টে',
  'অক্টো',
  'নভে',
  'ডিসে',
];

function parseMonthKey(dateStr?: string): { year: number; month: number; key: string } | null {
  const raw = String(dateStr || '').trim();
  if (!raw) return null;

  // DD-MM-YYYY or DD/MM/YYYY
  const dmy = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmy) {
    const month = Number(dmy[2]);
    const year = Number(dmy[3]);
    if (month >= 1 && month <= 12 && year >= 2000 && year <= 2100) {
      return {
        year,
        month,
        key: `${year}-${String(month).padStart(2, '0')}`,
      };
    }
  }

  // YYYY-MM-DD or YYYY/MM/DD
  const ymd = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (ymd) {
    const year = Number(ymd[1]);
    const month = Number(ymd[2]);
    if (month >= 1 && month <= 12 && year >= 2000 && year <= 2100) {
      return {
        year,
        month,
        key: `${year}-${String(month).padStart(2, '0')}`,
      };
    }
  }

  return null;
}

function monthKeyFromDate(d: Date): { year: number; month: number; key: string } {
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  return {
    year,
    month,
    key: `${year}-${String(month).padStart(2, '0')}`,
  };
}

function shiftMonth(year: number, month: number, deltaMonths: number): { year: number; month: number; key: string } {
  const idx = year * 12 + (month - 1) + deltaMonths;
  const nextYear = Math.floor(idx / 12);
  const nextMonth = (idx % 12 + 12) % 12 + 1;
  return {
    year: nextYear,
    month: nextMonth,
    key: `${nextYear}-${String(nextMonth).padStart(2, '0')}`,
  };
}

function formatMonthLabel(year: number, month: number, bn: boolean, includeYear: boolean): string {
  const names = bn ? BN_MONTH_SHORT : EN_MONTH_SHORT;
  const mName = names[month - 1] || String(month);
  if (!includeYear) return mName;
  const yrShort = String(year).slice(-2);
  return `${mName} '${yrShort}`;
}

function formatCompactTakaTick(value: number): string {
  if (value <= 0) return '৳0';
  if (value >= 100000) {
    const lakhs = value / 100000;
    return `৳${Number.isInteger(lakhs) ? lakhs : lakhs.toFixed(1)}L`;
  }
  if (value >= 1000) {
    const k = value / 1000;
    return `৳${Number.isInteger(k) ? k : k.toFixed(1)}k`;
  }
  return `৳${value}`;
}

export function DashboardView({
  data,
  lang,
  theme = 'dark',
  appearance,
  megaConfigured = false,
  onNavigate,
  onOpenInactiveStudents,
  onOpenNewJob,
  onOpenOutJob,
  onOpenAddStudent,
  onOpenStudentProfile,
  onOpenIssueJobForStudent,
  onPrintSlip,
  onLoadDemo,
  onSetTheme,
  onSetLang,
  onChangeAppearance,
  onSaveAppearance,
  onResetAppearance,
  onOpenSettingsDrawer,
  onAddRecord,
  onUpdateRecord,
  onDeleteRecord,
  onUnlockGeneralAccounts,
  onUpdateCenterSettings,
  onLogAudit,
  onSyncMegaNow,
  onPullMegaNow,
  onVerifyCloudSync,
}: DashboardViewProps) {
  const bn = lang === 'bn';
  const today = todayDDMMYYYY();
  const appearanceRef = useRef(appearance);
  appearanceRef.current = appearance;

  const commitAppearancePatch = (
    updater: (prev: UiAppearanceSettings) => UiAppearanceSettings
  ): UiAppearanceSettings => {
    const next = updater(appearanceRef.current);
    appearanceRef.current = next;
    applyUiSettingsToDocument(next);
    onChangeAppearance?.(next);
    if (onSaveAppearance) {
      onSaveAppearance(next);
    } else {
      saveUiSettings(next);
    }
    return next;
  };
  const [revenueRange, setRevenueRange] = useState<RevenueRange>('6m');
  const [includeOpeningDeposits, setIncludeOpeningDeposits] = useState(false);

  const quickActionsSummary = useMemo(
    () => computeQuickActionsSummary(data.students, data.jobs, data.outs),
    [data.students, data.jobs, data.outs]
  );

  const [summaryDateInput, setSummaryDateInput] = useState(() => {
    const parts = today.split('-');
    return parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : '';
  });

  const summaryTargetDateDDMMYYYY = useMemo(() => {
    if (!summaryDateInput) return today;
    const parts = summaryDateInput.split('-');
    return parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : today;
  }, [summaryDateInput, today]);

  const summaryDateJobs = useMemo(
    () => data.jobs.filter((j) => j.date === summaryTargetDateDDMMYYYY),
    [data.jobs, summaryTargetDateDDMMYYYY]
  );

  const summaryDateCollection = useMemo(
    () => summaryDateJobs.reduce((sum, j) => sum + Number(j.pay || 0), 0),
    [summaryDateJobs]
  );

  const [showGaQuickSummary, setShowGaQuickSummary] = useState(false);

  const gaQuickSummary = useMemo(() => {
    const todayDot = today.replace(/-/g, '.');
    const selectedDot = summaryTargetDateDDMMYYYY.replace(/-/g, '.');
    const ledger = buildGeneralAccountsLedger(data.generalAccounts || [], todayDot);
    const selectedDay = ledger.getDaySummary(selectedDot);
    const targetDate = selectedDay.dayRows.length > 0 ? selectedDot : ledger.latestDate;
    const summary = selectedDay.dayRows.length > 0 ? selectedDay : ledger.getDaySummary(targetDate);
    return {
      date: targetDate,
      totalIncome: summary.totalCash,
      newCashIn: summary.newCashIn,
      totalExpense: summary.totalExp,
      totalBank: summary.totalBank,
      cashBalance: summary.cashBalance,
      grandTotal: summary.grandTotal,
    };
  }, [data.generalAccounts, summaryTargetDateDDMMYYYY, today]);

  const [cmdInput, setCmdInput] = useState('');
  const [cmdOpen, setCmdOpen] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatSession[]>(() => loadSavedChatHistory());
  const [showChatHistory, setShowChatHistory] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const chatTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const upsertCurrentSessionToHistory = (msgs: ChatMessage[], currentId: string | null): string | null => {
    const hasUserMessage = msgs.some((m) => m.sender === 'user');
    if (!hasUserMessage) return currentId;

    const firstUser = msgs.find((m) => m.sender === 'user');
    const rawTitle = (firstUser?.text || 'Chat').trim().replace(/\s+/g, ' ');
    const title = rawTitle.length > 48 ? `${rawTitle.slice(0, 48)}...` : rawTitle;
    const sessionId = currentId || `chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const serialized: SavedChatMessage[] = msgs.map((m) => ({
      id: m.id,
      sender: m.sender,
      ...(m.title ? { title: m.title } : {}),
      text: m.text,
      ...(m.tone ? { tone: m.tone } : {}),
    }));

    const nextSession: ChatSession = {
      id: sessionId,
      title,
      updatedAt: Date.now(),
      messages: serialized,
    };

    setChatHistory((prev) => {
      const next = [nextSession, ...prev.filter((s) => s.id !== sessionId)].slice(0, 100);
      persistChatHistory(next);
      return next;
    });
    return sessionId;
  };

  const resetActiveChatBox = () => {
    setChatMessages([]);
    setActiveSessionId(null);
    setCmdInput('');
    setShowChatHistory(false);
    if (chatTextareaRef.current) {
      chatTextareaRef.current.style.height = 'auto';
    }
  };

  const closeChatDrawer = () => {
    upsertCurrentSessionToHistory(chatMessages, activeSessionId);
    resetActiveChatBox();
    setCmdOpen(false);
  };

  const openFreshChatDrawer = () => {
    resetActiveChatBox();
    setCmdOpen(true);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && cmdOpen) {
        upsertCurrentSessionToHistory(chatMessages, activeSessionId);
        resetActiveChatBox();
        setCmdOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [cmdOpen, chatMessages, activeSessionId]);

  useEffect(() => {
    if (chatMessages.some((m) => m.sender === 'user')) {
      const savedId = upsertCurrentSessionToHistory(chatMessages, activeSessionId);
      if (savedId && savedId !== activeSessionId) {
        setActiveSessionId(savedId);
      }
    }
  }, [chatMessages]);

  useEffect(() => {
    if (cmdOpen && !showChatHistory && chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages, cmdOpen, chatBusy, showChatHistory]);

  const todayJobs = data.jobs.filter((j) => j.date === today);
  const todayOuts = data.outs.filter((o) => o.date === today);
  const totalContract = data.students.reduce((sum, s) => sum + Number(s.contract || 0), 0);
  const totalDeposit = data.students.reduce((sum, s) => sum + Number(s.deposit || 0), 0);
  const totalDue = Math.max(0, totalContract - totalDeposit);
  const allCompletedJobs = data.jobs.length + data.outs.length;

  const recentJobs = [...data.jobs].slice(-8).reverse();

  const categoryCounts = data.prices.map((p) => {
    const count =
      todayJobs.filter((j) => j.cat === p.cat).length +
      todayOuts.filter((o) => o.cat === p.cat).length;
    return { ...p, count };
  });

  // Aggregate monthly deposit revenue from student-linked deposit transactions + opening/student deposits
  const revenueAnalytics = useMemo(() => {
    const fallbackMonth = monthKeyFromDate(new Date());
    const buckets = new Map<
      string,
      { year: number; month: number; courseDeposit: number; visaDeposit: number; entriesCount: number }
    >();

    const addBucket = (
      mk: { year: number; month: number; key: string },
      courseAmt: number,
      visaAmt: number,
      countDelta = 1
    ) => {
      const existing = buckets.get(mk.key) || {
        year: mk.year,
        month: mk.month,
        courseDeposit: 0,
        visaDeposit: 0,
        entriesCount: 0,
      };
      existing.courseDeposit += courseAmt;
      existing.visaDeposit += visaAmt;
      existing.entriesCount += countDelta;
      buckets.set(mk.key, existing);
    };

    const studentByCode = new Map<string, Student>();
    for (const s of data.students) {
      const code = s.code.trim();
      if (code) studentByCode.set(code, s);
    }

    const linkedCourseEntriesByCode = new Map<
      string,
      Array<{ mk: { year: number; month: number; key: string }; amt: number }>
    >();
    const linkedVisaEntriesByCode = new Map<
      string,
      Array<{ mk: { year: number; month: number; key: string }; amt: number }>
    >();

    for (const c of data.cash) {
      if (c.type !== 'in') continue;
      const amt = Math.max(0, Number(c.amt || 0));
      if (amt <= 0) continue;
      if (c.category !== 'Course Deposit' && c.category !== 'Visa Deposit') continue;

      const noteText = String(c.note || '');
      let matchedCode: string | null = null;
      for (const code of studentByCode.keys()) {
        if (noteText.includes(`(${code})`)) {
          matchedCode = code;
          break;
        }
      }
      if (!matchedCode) continue; // Ignore orphaned entries for deleted/non-existent students

      const mk = parseMonthKey(c.date) || fallbackMonth;
      if (c.category === 'Course Deposit') {
        const arr = linkedCourseEntriesByCode.get(matchedCode) || [];
        arr.push({ mk, amt });
        linkedCourseEntriesByCode.set(matchedCode, arr);
      } else {
        const arr = linkedVisaEntriesByCode.get(matchedCode) || [];
        arr.push({ mk, amt });
        linkedVisaEntriesByCode.set(matchedCode, arr);
      }
    }

    // Attribute recorded Course Deposits (capped by current student.deposit) and Visa Deposits to active students.
    // Opening/directly-edited student deposits without cash receipts are only shown when includeOpeningDeposits is enabled.
    let untrackedOpeningTotal = 0;
    for (const s of data.students) {
      const code = s.code.trim();
      const stuDeposit = Math.max(0, Number(s.deposit || 0));
      const courseEntries = code ? linkedCourseEntriesByCode.get(code) || [] : [];
      const visaEntries = code ? linkedVisaEntriesByCode.get(code) || [] : [];

      let remainingAllowedCourse = stuDeposit;
      let trackedCourseSum = 0;
      for (const entry of courseEntries) {
        if (remainingAllowedCourse <= 0) break;
        const used = Math.min(entry.amt, remainingAllowedCourse);
        if (used > 0) {
          addBucket(entry.mk, used, 0, 1);
          trackedCourseSum += used;
          remainingAllowedCourse -= used;
        }
      }

      for (const vEntry of visaEntries) {
        addBucket(vEntry.mk, 0, vEntry.amt, 1);
      }

      const openingOrDirect = Math.max(0, stuDeposit - trackedCourseSum);
      if (openingOrDirect > 0) {
        untrackedOpeningTotal += openingOrDirect;
        if (includeOpeningDeposits) {
          const mk = parseMonthKey(s.date) || fallbackMonth;
          addBucket(mk, openingOrDirect, 0, 1);
        }
      }
    }

    const sortedKeys = [...buckets.keys()].sort();
    const latestFromData = sortedKeys.length > 0 ? buckets.get(sortedKeys[sortedKeys.length - 1]) : null;
    const anchor =
      latestFromData &&
      latestFromData.year * 12 + latestFromData.month > fallbackMonth.year * 12 + fallbackMonth.month
        ? { year: latestFromData.year, month: latestFromData.month, key: sortedKeys[sortedKeys.length - 1] }
        : fallbackMonth;

    let startInfo: { year: number; month: number; key: string };
    let endInfo = anchor;

    if (revenueRange === '6m') {
      startInfo = shiftMonth(endInfo.year, endInfo.month, -5);
    } else if (revenueRange === '12m') {
      startInfo = shiftMonth(endInfo.year, endInfo.month, -11);
    } else {
      if (sortedKeys.length > 0) {
        const earliest = buckets.get(sortedKeys[0])!;
        const minSpanStart = shiftMonth(endInfo.year, endInfo.month, -5);
        const earliestVal = earliest.year * 12 + earliest.month;
        const minSpanVal = minSpanStart.year * 12 + minSpanStart.month;
        startInfo =
          earliestVal < minSpanVal
            ? { year: earliest.year, month: earliest.month, key: sortedKeys[0] }
            : minSpanStart;
      } else {
        startInfo = shiftMonth(endInfo.year, endInfo.month, -5);
      }
    }

    const monthCount =
      (endInfo.year - startInfo.year) * 12 + (endInfo.month - startInfo.month) + 1;
    const rawPoints: Omit<MonthlyRevenuePoint, 'isPeak'>[] = [];

    for (let i = 0; i < monthCount; i++) {
      const cur = shiftMonth(startInfo.year, startInfo.month, i);
      const b = buckets.get(cur.key);
      const courseDeposit = b ? b.courseDeposit : 0;
      const visaDeposit = b ? b.visaDeposit : 0;
      const revenue = courseDeposit + visaDeposit;
      rawPoints.push({
        key: cur.key,
        shortLabel: formatMonthLabel(cur.year, cur.month, bn, monthCount > 6),
        fullLabel: `${formatMonthLabel(cur.year, cur.month, bn, false)} ${cur.year}`,
        courseDeposit,
        visaDeposit,
        revenue,
        entriesCount: b ? b.entriesCount : 0,
      });
    }

    const maxRevenue = rawPoints.reduce((m, p) => Math.max(m, p.revenue), 0);
    const points: MonthlyRevenuePoint[] = rawPoints.map((p) => ({
      ...p,
      isPeak: maxRevenue > 0 && p.revenue === maxRevenue,
    }));

    const rangeTotal = points.reduce((s, p) => s + p.revenue, 0);
    const rangeCourseTotal = points.reduce((s, p) => s + p.courseDeposit, 0);
    const rangeVisaTotal = points.reduce((s, p) => s + p.visaDeposit, 0);
    const peakPoint = points.find((p) => p.isPeak) || null;
    const allTimeTotal = [...buckets.values()].reduce(
      (s, b) => s + b.courseDeposit + b.visaDeposit,
      0
    );

    return {
      points,
      rangeTotal,
      rangeCourseTotal,
      rangeVisaTotal,
      peakPoint,
      allTimeTotal,
      untrackedOpeningTotal,
      hasData: allTimeTotal > 0,
    };
  }, [data.cash, data.students, revenueRange, includeOpeningDeposits, bn]);

  const heroTitleText = bn
    ? `স্বাগতম — ${data.settings.name}`
    : appearance.instituteTitle || `WELCOME TO ${data.settings.name}`;
  const heroSubtitleText =
    appearance.instituteSub ||
    data.settings.subtitle ||
    (bn ? 'প্র্যাকটিক্যাল টেস্ট ও ম্যানেজমেন্ট সিস্টেম' : 'Practical Test & Management System');

  const stats = [
    {
      label: bn ? 'মোট রেজিস্টার্ড স্টুডেন্ট' : 'Total Registered Students',
      target: data.students.length,
      prefix: '',
      icon: Users,
      iconTone: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
      cardTone: 'hover:border-blue-400/50 dark:hover:border-blue-400/40',
    },
    {
      label: bn ? 'আজকের সক্রিয় জব' : "Today's Active Jobs",
      target: todayJobs.length + todayOuts.length,
      prefix: '',
      icon: Briefcase,
      iconTone:
        'bg-[var(--cg-primary-soft)] text-[var(--accent-dark)] dark:text-[var(--cg-primary)]',
      cardTone: 'border-[var(--cg-primary)]/35 hover:border-[var(--cg-primary)]',
    },
    {
      label: bn ? 'মোট চুক্তির মূল্য' : 'Total Contract Value',
      target: totalContract,
      prefix: '৳',
      icon: FileText,
      iconTone:
        'bg-[var(--cg-primary-soft)] text-[var(--accent-dark)] dark:text-[var(--cg-primary)]',
      cardTone: 'border-[var(--cg-primary)]/35 hover:border-[var(--cg-primary)]',
    },
    {
      label: bn ? 'মোট প্রাপ্ত জমা' : 'Total Received Deposit',
      target: totalDeposit,
      prefix: '৳',
      icon: CreditCard,
      iconTone: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
      cardTone: 'hover:border-violet-400/50 dark:hover:border-violet-400/40',
    },
    {
      label: bn ? 'মোট কোর্স বকেয়া' : 'Total Course Due',
      target: totalDue,
      prefix: '৳',
      icon: AlertTriangle,
      iconTone: 'bg-[var(--cg-warning-soft)] text-amber-600 dark:text-[var(--cg-warning)]',
      cardTone:
        'bg-gradient-to-b from-amber-50/70 to-white dark:from-amber-500/[0.06] dark:to-[#0c1320] border-[var(--cg-warning)]/40 hover:border-[var(--cg-warning)]',
    },
    {
      label: bn ? 'সর্বমোট সম্পন্ন জব' : 'All-Time Completed Jobs',
      target: allCompletedJobs,
      prefix: '',
      icon: CheckCircle2,
      iconTone: 'bg-slate-200/80 dark:bg-slate-400/15 text-slate-700 dark:text-slate-300',
      cardTone: 'hover:border-slate-400/50',
    },
  ];

  const sampleStudentCode = data.students[0]?.code || '17/1';

  const matchLocalCommand = (rawText: string): Omit<ChatMessage, 'id' | 'sender'> | null => {
    const trimmed = rawText.trim();
    const normalized = normalizeBengaliDigits(trimmed);
    const lower = normalized.toLowerCase();

    // Always route color, theme, animation, font, sync, and database write commands directly to full-access Gemini AI first
    const isAiPowerOrder =
      /(কালার|রং|রঙ|থিম|চেঞ্জ|বদলে|ব্যাকগ্রাউন্ড|গ্রাফিক্স|ডিজাইন|এনিমেশন|অ্যানিমেশন|মোশন|ফন্ট|সাইজ|লোগো|শিরোনাম|টাইটেল|সেভ করো|আপডেট|যোগ করো|জমা করো|পরিবর্তন|বদলাও|পাল্টাও|বাড়াও|কমাও|বন্ধ করো|চালু করো|রিসেট|ডার্ক|লাইট|সিঙ্ক|মেগা|লাল|নীল|সবুজ|বেগুনি|কমলা|হলুদ|সোনালি|গোলাপি|আকাশি|কালো|সাদা|color|colour|theme|background|red|blue|green|purple|violet|orange|yellow|gold|pink|rose|cyan|dark|light|animation|motion|font|scale|size|reset|preset|update|change|make it|set |add |save |deposit |sync|mega)/i.test(
        normalized
      );
    if (isAiPowerOrder) {
      return null;
    }

    const extractCodeToken = (): string | null => {
      const m = normalized.match(/\b(\d{1,4}\/\d{1,5}|\d{2,6})\b/);
      return m ? m[1] : null;
    };

    const findStudentByToken = (token: string) => {
      const tLow = token.trim().toLowerCase();
      return (
        data.students.find((s) => s.code.trim().toLowerCase() === tLow) ||
        data.students.find((s) => s.code.trim().toLowerCase().includes(tLow))
      );
    };

    const formatStudentSummary = (s: Student): Omit<ChatMessage, 'id' | 'sender'> => {
      const dueAmt = Math.max(0, Number(s.contract || 0) - Number(s.deposit || 0));
      const visaPaid = data.cash
        .filter(
          (c) =>
            c.type === 'in' &&
            c.category === 'Visa Deposit' &&
            String(c.note || '').includes(`(${s.code})`)
        )
        .reduce((sum, c) => sum + Number(c.amt || 0), 0);
      const stuTodayJobs = todayJobs.filter(
        (j) => j.sid.trim().toLowerCase() === s.code.trim().toLowerCase()
      );
      const companyLabel =
        s.interviewPassedCompany?.trim() ||
        s.companyName?.trim() ||
        (bn ? 'Pending Interview' : 'Pending Interview');

      const lines = [
        `${bn ? 'খাতা / কোড' : 'Khata No'}: ${s.code}  |  ${bn ? 'নাম' : 'Name'}: ${s.name}`,
        `${bn ? 'মোবাইল' : 'Phone'}: ${s.phone || '—'}  |  ${bn ? 'ট্রেড' : 'Trade'}: ${s.trade || '—'}`,
        `${bn ? 'ইন্টারভিউ পাস কোম্পানি' : 'Interview Passed Company'}: ${companyLabel}${s.interviewDate ? ` (${s.interviewDate})` : ''}`,
        `${bn ? 'কন্ট্রাক্ট' : 'Contract'}: ${formatTaka(s.contract)}  |  ${bn ? 'কোর্স জমা' : 'Course Deposit'}: ${formatTaka(s.deposit)}${visaPaid > 0 ? `  |  ${bn ? 'ভিসা জমা' : 'Visa'}: ${formatTaka(visaPaid)}` : ''}  |  ${bn ? 'বর্তমান ডিউ' : 'Current Due'}: ${formatTaka(dueAmt)}`,
        stuTodayJobs.length > 0
          ? `⚠️ ${bn ? `আজকের (${today}) জব:` : `Today's (${today}) Jobs:`} ${stuTodayJobs.length}টি (${stuTodayJobs.map((j) => `${j.no} · ${j.cat}`).join(', ')})`
          : `✅ ${bn ? `আজ (${today}) কোনো জব নেয়নি` : `No jobs taken today (${today})`}`,
      ];

      const actions: CommandAction[] = [];
      if (onOpenStudentProfile) {
        actions.push({
          label: bn ? 'প্রোফাইল খুলুন' : 'Open Profile',
          tone: 'primary',
          onClick: () => {
            setCmdOpen(false);
            onOpenStudentProfile(s.code);
          },
        });
      }
      if (onOpenIssueJobForStudent) {
        actions.push({
          label: bn ? 'নতুন জব দিন' : 'Issue Job',
          tone: 'secondary',
          onClick: () => {
            setCmdOpen(false);
            onOpenIssueJobForStudent(s.code);
          },
        });
      }

      return {
        title: `${s.name} (${s.code})`,
        text: lines.join('\n'),
        tone: stuTodayJobs.length > 0 ? 'warn' : 'success',
        actions,
      };
    };

    // 1. Same-day duplicate job check
    if (
      normalized.includes('জব নিয়েছে') ||
      normalized.includes('জব নিয়েছে') ||
      lower.includes('duplicate') ||
      lower.includes('same day') ||
      lower.includes('job check')
    ) {
      const codeToken = extractCodeToken();
      if (codeToken) {
        const stu = findStudentByToken(codeToken);
        const matches = todayJobs.filter(
          (j) => j.sid.trim().toLowerCase() === (stu ? stu.code : codeToken).trim().toLowerCase()
        );
        if (matches.length > 0) {
          const actions: CommandAction[] = [];
          if (stu && onOpenStudentProfile) {
            actions.push({
              label: bn ? 'প্রোফাইল দেখুন' : 'View Profile',
              tone: 'primary',
              onClick: () => {
                setCmdOpen(false);
                onOpenStudentProfile(stu.code);
              },
            });
          }
          return {
            title: bn ? 'একই দিনে জব সতর্কবার্তা' : 'Same-Day Job Alert',
            tone: 'warn',
            text:
              `⚠️ ${bn ? 'সতর্কবার্তা:' : 'Warning:'} ${bn ? 'খাতা' : 'Khata'} ${stu ? `${stu.code} (${stu.name})` : codeToken} ${bn ? `আজকের (${today}) তারিখে ইতিমধ্যে ${matches.length}টি জব নিয়েছে:` : `already took ${matches.length} job(s) today (${today}):`}\n` +
              matches.map((j) => `• ${j.no} — ${j.cat} (${formatTaka(j.pay)})`).join('\n') +
              `\n${bn ? 'নতুন জব এন্ট্রি দেওয়ার আগে অনুমোদন/কনফার্মেশন যাচাই করুন।' : 'Confirm supervisor override before issuing another token today.'}`,
            actions,
          };
        }
        return {
          title: bn ? 'আজকের জব চেক' : 'Today Job Check',
          tone: 'success',
          text: `✅ ${bn ? 'খাতা' : 'Khata'} ${stu ? `${stu.code} (${stu.name})` : codeToken} ${bn ? `আজ (${today}) এখনো কোনো জব নেয়নি। নতুন জব এন্ট্রি দেওয়া যাবে।` : `has not taken any job today (${today}). Safe to issue.`}`,
          actions:
            stu && onOpenIssueJobForStudent
              ? [
                  {
                    label: bn ? 'নতুন জব দিন' : 'Issue Job',
                    tone: 'primary',
                    onClick: () => {
                      setCmdOpen(false);
                      onOpenIssueJobForStudent(stu.code);
                    },
                  },
                ]
              : undefined,
        };
      }

      const countsBySid = new Map<string, { name: string; count: number; cats: string[] }>();
      for (const j of todayJobs) {
        const key = j.sid.trim() || j.sname;
        const prev = countsBySid.get(key) || { name: j.sname, count: 0, cats: [] };
        prev.count += 1;
        prev.cats.push(j.cat);
        countsBySid.set(key, prev);
      }
      const duplicates = [...countsBySid.entries()].filter(([, v]) => v.count > 1);
      return {
        title: bn ? `আজকের (${today}) ডুপ্লিকেট জব চেক` : `Same-Day Job Check (${today})`,
        tone: duplicates.length > 0 ? 'warn' : 'info',
        text:
          duplicates.length > 0
            ? `⚠️ ${bn ? 'আজ একই দিনে একাধিক জব নিয়েছে:' : 'Students with multiple jobs today:'}\n` +
              duplicates
                .map(([sid, info]) => `• ${sid} (${info.name}) — ${info.count}টি (${info.cats.join(', ')})`)
                .join('\n')
            : todayJobs.length > 0
              ? `✅ ${bn ? `আজ মোট ${todayJobs.length}টি জব এন্ট্রি হয়েছে; এখনো কোনো ডুপ্লিকেট জব নেই।` : `${todayJobs.length} jobs issued today; no duplicate same-day jobs yet.`}`
              : bn
                ? `আজ (${today}) এখনো কোনো স্টুডেন্ট জব নেয়নি।`
                : `No student jobs issued today (${today}).`,
        actions: [
          {
            label: bn ? 'দৈনিক রেজিস্টার দেখুন' : 'Open Daily Register',
            tone: 'primary',
            onClick: () => {
              setCmdOpen(false);
              onNavigate('jobs');
            },
          },
        ],
      };
    }

    // 2. Direct Khata / Book code lookup (only for explicit code queries, not general commands/sentences)
    const isActionOrder =
      /(খোলো|খুলুন|নতুন জব|জব দাও|জব এন্ট্রি|ভর্তি|নিবন্ধন|যাও|open|issue|create|add|go to)/i.test(normalized);
    if (!isActionOrder) {
      const exactCodeMatch = data.students.find((s) => s.code.trim().toLowerCase() === lower);
      if (exactCodeMatch) {
        return formatStudentSummary(exactCodeMatch);
      }
      const slashCodeMatch = normalized.match(/\b(\d{1,4}\/\d{1,5})\b/);
      if (slashCodeMatch && trimmed.length <= 40) {
        const exactStu = findStudentByToken(slashCodeMatch[1]);
        if (exactStu) {
          return formatStudentSummary(exactStu);
        }
        return {
          title: bn ? `খাতা নম্বর ${slashCodeMatch[1]} পাওয়া যায়নি` : `Khata ${slashCodeMatch[1]} Not Found`,
          tone: 'warn',
          text: bn
            ? `সিস্টেমে খাতা নম্বর "${slashCodeMatch[1]}" নামে কোনো নিবন্ধিত ছাত্র পাওয়া যায়নি। দয়া করে খাতা নম্বরটি যাচাই করুন (যেমন: 17/1)।`
            : `No registered student was found with Khata code "${slashCodeMatch[1]}". Please check the Khata number and try again.`,
          actions: [
            {
              label: bn ? 'ছাত্র তালিকা দেখুন' : 'View Students List',
              tone: 'primary',
              onClick: () => {
                setCmdOpen(false);
                onNavigate('students');
              },
            },
          ],
        };
      }
    }

    // 3. Quick Due List suggestion shortcut
    if (
      lower === 'due list' ||
      lower === 'show current due list' ||
      normalized === 'ডিউ লিস্ট' ||
      normalized === 'ডিউ লিস্ট দেখাও' ||
      normalized === 'বর্তমান ডিউ লিস্ট দেখাও'
    ) {
      const dueRows = data.students
        .map((s) => ({
          s,
          due: Math.max(0, Number(s.contract || 0) - Number(s.deposit || 0)),
        }))
        .filter((r) => r.due > 0)
        .sort((a, b) => b.due - a.due);

      const topList = dueRows
        .slice(0, 6)
        .map(
          ({ s, due }) =>
            `• ${bn ? 'খাতা' : 'Code'} ${s.code} (${s.name}) — ${bn ? 'ডিউ:' : 'Due:'} ${formatTaka(due)}`
        );

      return {
        title: bn ? 'বর্তমান ডিউ লিস্ট সামারি' : 'Live Due List Summary',
        tone: dueRows.length > 0 ? 'warn' : 'success',
        text:
          dueRows.length > 0
            ? `${bn ? 'মোট বকেয়া ছাত্র:' : 'Students with due:'} ${dueRows.length}  |  ${bn ? 'সর্বমোট ডিউ:' : 'Total Course Due:'} ${formatTaka(totalDue)}\n` +
              topList.join('\n') +
              (dueRows.length > 6
                ? `\n... ${bn ? `আরও ${dueRows.length - 6} জন ছাত্র` : `and ${dueRows.length - 6} more`}`
                : '')
            : bn
              ? '🎉 কোনো ছাত্রের কাছে কোর্স ডিউ বকেয়া নেই।'
              : 'No pending student course dues.',
        actions: [
          {
            label: bn ? 'সম্পূর্ণ ডিউ লিস্ট দেখুন →' : 'Open Due List →',
            tone: 'primary',
            onClick: () => {
              setCmdOpen(false);
              onNavigate('due');
            },
          },
        ],
      };
    }

    // 4. Quick Today's Collection suggestion shortcut
    if (
      lower === 'today collection' ||
      lower === "today's collection summary" ||
      normalized === 'আজকের কালেকশন' ||
      normalized === 'আজকের কালেকশন কত' ||
      normalized === 'আজকের কালেকশন কত?'
    ) {
      const todayJobFee = todayJobs.reduce((sum, j) => sum + Number(j.paid || j.pay || 0), 0);
      const todayOutFee = todayOuts.reduce((sum, o) => sum + Number(o.paid || o.price || 0), 0);
      const todayCashIn = data.cash
        .filter((c) => c.date === today && c.type === 'in')
        .reduce((sum, c) => sum + Number(c.amt || 0), 0);
      const todayCashOut = data.cash
        .filter((c) => c.date === today && c.type === 'out')
        .reduce((sum, c) => sum + Number(c.amt || 0), 0);

      const activeCats = categoryCounts
        .filter((c) => c.count > 0)
        .map((c) => `${c.cat}: ${c.count}`);

      return {
        title: bn ? `আজকের (${today}) কালেকশন হিসাব` : `Today's Collection (${today})`,
        tone: 'info',
        text:
          `${bn ? 'আজকের জব ফি (স্টুডেন্ট + বাইরের):' : "Today's Job Fees (Student + Out):"} ${formatTaka(todayJobFee + todayOutFee)}\n` +
          `${bn ? 'মোট জব:' : 'Total Jobs:'} ${todayJobs.length + todayOuts.length}টি${activeCats.length > 0 ? ` (${activeCats.join(', ')})` : ''}\n` +
          `${bn ? 'ক্যাশবুক জমা (Cash IN):' : 'Cashbook IN:'} ${formatTaka(todayCashIn)}  |  ${bn ? 'খরচ (OUT):' : 'OUT:'} ${formatTaka(todayCashOut)}`,
        actions: [
          {
            label: bn ? 'দৈনিক রেজিস্টার' : 'Daily Register',
            tone: 'primary',
            onClick: () => {
              setCmdOpen(false);
              onNavigate('jobs');
            },
          },
          {
            label: bn ? 'ক্যাশবুক' : 'Cashbook',
            tone: 'secondary',
            onClick: () => {
              setCmdOpen(false);
              onNavigate('cash');
            },
          },
        ],
      };
    }

    // 5. Quick Interview Passed shortcut
    if (
      lower === 'interview pass' ||
      lower === 'interview passed' ||
      normalized === 'ইন্টারভিউ পাস' ||
      normalized === 'ইন্টারভিউ পাস তালিকা'
    ) {
      const passed = data.students.filter((s) => Boolean(s.interviewPassedCompany?.trim()));
      return {
        title: bn ? 'ইন্টারভিউ পাস তালিকা' : 'Interview Passed Students',
        tone: passed.length > 0 ? 'success' : 'info',
        text:
          passed.length > 0
            ? `${bn ? 'মোট ইন্টারভিউ পাস:' : 'Total Passed:'} ${passed.length}\n` +
              passed
                .slice(0, 6)
                .map(
                  (s) =>
                    `• ${s.code} (${s.name}) — ${s.interviewPassedCompany}${s.interviewDate ? ` · ${s.interviewDate}` : ''}`
                )
                .join('\n')
            : bn
              ? 'এখনো কোনো ছাত্রের প্রোফাইলে ইন্টারভিউ পাস কোম্পানি যুক্ত করা হয়নি।'
              : 'No students have an Interview Passed Company recorded yet.',
        actions: [
          {
            label: bn ? 'ছাত্র তালিকা দেখুন' : 'View Students',
            tone: 'primary',
            onClick: () => {
              setCmdOpen(false);
              onNavigate('students');
            },
          },
        ],
      };
    }

    // 6. Open Register Student Modal
    if (
      /(নতুন ছাত্র|নতুন স্টুডেন্ট|ছাত্র ভর্তি|স্টুডেন্ট ভর্তি|ভর্তি ফর্ম|নিবন্ধন ফর্ম|ছাত্র নিবন্ধন|register student|add student|new student|student registration)/i.test(
        normalized
      )
    ) {
      setCmdOpen(false);
      onOpenAddStudent();
      return {
        title: bn ? 'ছাত্র নিবন্ধন ফর্ম খোলা হয়েছে' : 'Opened Register Student Form',
        tone: 'success',
        text: bn
          ? 'নতুন ছাত্র ভর্তি ও কন্ট্রাক্ট নিবন্ধন ফর্ম খোলা হয়েছে।'
          : 'The Register Student modal is now open.',
        actions: [
          {
            label: bn ? 'আবার নিবন্ধন ফর্ম খুলুন' : 'Reopen Register Form',
            tone: 'primary',
            onClick: () => {
              setCmdOpen(false);
              onOpenAddStudent();
            },
          },
        ],
      };
    }

    // 7. Open Issue Job / New Student Job Modal
    if (
      /(নতুন জব|জব দাও|জব এন্ট্রি|জব ফর্ম|জব ইস্যু|issue job|new job|create job|add job|job entry)/i.test(
        normalized
      )
    ) {
      const codeToken = extractCodeToken();
      if (codeToken && onOpenIssueJobForStudent) {
        const stu = findStudentByToken(codeToken);
        if (stu) {
          setCmdOpen(false);
          onOpenIssueJobForStudent(stu.code);
          return {
            title: bn ? `জব ফর্ম খোলা হয়েছে (${stu.code})` : `Opened Issue Job (${stu.code})`,
            tone: 'success',
            text: bn
              ? `খাতা ${stu.code} (${stu.name})-এর জন্য নতুন জব এন্ট্রি ফর্ম খোলা হয়েছে।`
              : `Opened the New Student Job modal pre-selected for Khata ${stu.code} (${stu.name}).`,
            actions: [
              {
                label: bn ? `জব ফর্ম (${stu.code})` : `Issue Job (${stu.code})`,
                tone: 'primary',
                onClick: () => {
                  setCmdOpen(false);
                  onOpenIssueJobForStudent(stu.code);
                },
              },
            ],
          };
        }
      }

      const matchedPrice = data.prices.find((p) =>
        lower.includes(p.cat.trim().toLowerCase())
      );
      setCmdOpen(false);
      onOpenNewJob(matchedPrice?.cat);
      return {
        title: bn ? 'নতুন জব ফর্ম খোলা হয়েছে' : 'Opened New Job Form',
        tone: 'success',
        text: matchedPrice
          ? bn
            ? `ক্যাটাগরি "${matchedPrice.cat}" সহ নতুন স্টুডেন্ট জব ফর্ম খোলা হয়েছে।`
            : `Opened New Student Job modal with "${matchedPrice.cat}" selected.`
          : bn
            ? 'নতুন স্টুডেন্ট জব এন্ট্রি ফর্ম খোলা হয়েছে।'
            : 'The New Student Job modal is now open.',
        actions: [
          {
            label: bn ? 'নতুন জব ফর্ম' : 'New Job Form',
            tone: 'primary',
            onClick: () => {
              setCmdOpen(false);
              onOpenNewJob(matchedPrice?.cat);
            },
          },
        ],
      };
    }

    // 8. Open Out-of-Student Job Modal
    if (
      /(আউট জব|বাইরের জব|বাইরের ছাত্রের জব|out job|out of student job|external job)/i.test(
        normalized
      )
    ) {
      setCmdOpen(false);
      onOpenOutJob();
      return {
        title: bn ? 'আউট অফ স্টুডেন্ট জব ফর্ম' : 'Opened Out-of-Student Job Form',
        tone: 'success',
        text: bn
          ? 'বাইরের / আউট অফ স্টুডেন্ট জব এন্ট্রি ফর্ম খোলা হয়েছে।'
          : 'The Out-of-Student Job modal is now open.',
        actions: [
          {
            label: bn ? 'আউট জব ফর্ম' : 'Out Job Form',
            tone: 'primary',
            onClick: () => {
              setCmdOpen(false);
              onOpenOutJob();
            },
          },
        ],
      };
    }

    // 9. Explicit Student Profile command with Khata code (e.g., "17/1 প্রোফাইল খোলো")
    const profileSlashCode = normalized.match(/\b(\d{1,4}\/\d{1,5})\b/);
    if (
      profileSlashCode &&
      /(প্রোফাইল|profile|খোলো|খুলুন|open|view|দেখাও)/i.test(normalized)
    ) {
      const stu = findStudentByToken(profileSlashCode[1]);
      if (stu && onOpenStudentProfile) {
        setCmdOpen(false);
        onOpenStudentProfile(stu.code);
        return {
          title: bn ? `প্রোফাইল খোলা হয়েছে (${stu.code})` : `Opened Profile (${stu.code})`,
          tone: 'success',
          text: bn
            ? `${stu.name} (খাতা ${stu.code})-এর প্রোফাইল খোলা হয়েছে।`
            : `Opened profile for ${stu.name} (Khata ${stu.code}).`,
          actions: [
            {
              label: bn ? 'প্রোফাইল খুলুন' : 'Open Profile',
              tone: 'primary',
              onClick: () => {
                setCmdOpen(false);
                onOpenStudentProfile(stu.code);
              },
            },
          ],
        };
      }
    }

    // 10. Deterministic Module Navigation Commands (explicit action/view orders only)
    const hasNavVerb = /(খোলো|খুলুন|দেখাও|যাও|চলো|open|show|go to|navigate|view)/i.test(
      normalized
    );
    const hasWriteOrDataModifier =
      /(\d+|যোগ|এড|এন্ট্রি|খরচ|আয়|আয়|জমা|বিয়োগ|ব্যালেন্স|রিপোর্ট|ডিলিট|মুছ|আপডেট|পরিবর্তন|সবুজ|সোহেল|সেলিম|add|entry|expense|income|balance|delete|edit|update|sabuj|sohel|salim)/i.test(
        normalized
      );
    if (hasNavVerb && !hasWriteOrDataModifier) {
      const navMatchers: Array<{ page: NavKey; labelBn: string; labelEn: string; re: RegExp }> = [
        { page: 'generalAccounts', labelBn: 'GENERAL ACCOUNTS', labelEn: 'GENERAL ACCOUNTS', re: /(general\s*accounts?|জেনারেল\s*(?:একাউন্টস|অ্যাকাউন্টস|একাউন্ট|অ্যাকাউন্ট)|মূল\s*হিসাব)/i },
        { page: 'due', labelBn: 'ডিউ লিস্ট', labelEn: 'Due List', re: /(ডিউ লিস্ট|বকেয়া|বকেয়া|due list|dues)/i },
        { page: 'inactive', labelBn: 'ইনঅ্যাক্টিভ ছাত্র ট্র্যাকিং', labelEn: 'Inactive Students', re: /(ইনঅ্যাক্টিভ|ইনএক্টিভ|অনিয়মিত|অনিয়মিত|জব নেই|inactive|absent)/i },
        { page: 'students', labelBn: 'ছাত্র তালিকা', labelEn: 'Student Management', re: /(ছাত্র তালিকা|স্টুডেন্ট লিস্ট|স্টুডেন্ট ম্যানেজমেন্ট|student management|students list|student list|students)/i },
        { page: 'jobs', labelBn: 'দৈনিক জব রেজিস্টার', labelEn: 'Daily Job Register', re: /(দৈনিক রেজিস্টার|দৈনিক জব|জব রেজিস্টার|daily register|daily job|job register)/i },
        { page: 'outs', labelBn: 'আউট অফ স্টুডেন্ট', labelEn: 'Out of Student', re: /(আউট অফ স্টুডেন্ট|আউট স্টুডেন্ট|out of student)/i },
        { page: 'cash', labelBn: 'একাউন্টস ও ক্যাশবুক', labelEn: 'Accounts & Cashbook', re: /(ক্যাশবুক|একাউন্টস|অ্যাকাউন্টস|cashbook|accounts)/i },
        { page: 'staff', labelBn: 'স্টাফ ও পেরোল', labelEn: 'Staff & Payroll', re: /(স্টাফ|পেরোল|বেতন|staff|payroll)/i },
        { page: 'companies', labelBn: 'ওভারসিজ কোম্পানি', labelEn: 'Overseas Companies', re: /(কোম্পানি|ওভারসিজ|companies|company|overseas)/i },
        { page: 'store', labelBn: 'স্টোর ম্যানেজমেন্ট', labelEn: 'Store Management', re: /(স্টোর|ইনভেন্টরি|মালামাল|store|inventory)/i },
        { page: 'prices', labelBn: 'জব প্রাইস ও লিমিট', labelEn: 'Job Price & Limits', re: /(জব প্রাইস|প্রাইস|লিমিট|job price|prices|limits)/i },
        { page: 'returns', labelBn: 'জব রিটার্ন / রি-ট্রেন', labelEn: 'Job Return / Retrain', re: /(রিটার্ন|রি-ট্রেন|রিট্রেন|return|retrain)/i },
        { page: 'monthly', labelBn: 'মাসিক জব ও আয় রিপোর্ট', labelEn: 'Monthly Job Report', re: /(মাসিক রিপোর্ট|মাসিক জব|মাসের হিসাব|monthly report|monthly job)/i },
        { page: 'reports', labelBn: 'অ্যানালিটিক্স ও রিপোর্ট', labelEn: 'Analytics & Reports', re: /(রিপোর্ট|অ্যানালিটিক্স|এনালিটিক্স|report|reports|analytics)/i },
        { page: 'docs', labelBn: 'ডকুলিস্ট ও পাসপোর্ট', labelEn: 'DocuList & Passport', re: /(ডকুলিস্ট|পাসপোর্ট|doculist|passport|docs)/i },
        { page: 'settings', labelBn: 'সেন্টার সেটিংস', labelEn: 'Center Settings', re: /(সেন্টার সেটিংস|সেটিংস|settings)/i },
        { page: 'admin', labelBn: 'সুপার অ্যাডমিন', labelEn: 'Super Admin', re: /(সুপার অ্যাডমিন|সুপার এডমিন|super admin|admin)/i },
      ];
      const navHit = navMatchers.find((m) => m.re.test(normalized));
      if (navHit) {
        if (navHit.page === 'generalAccounts' && /(আনলক|unlock)/i.test(normalized)) {
          onUnlockGeneralAccounts?.(true);
        }
        setCmdOpen(false);
        onNavigate(navHit.page);
        return {
          title: bn ? `${navHit.labelBn} খোলা হয়েছে` : `Opened ${navHit.labelEn}`,
          tone: 'success',
          text: bn
            ? `আপনাকে ${navHit.labelBn} পৃষ্ঠায় নেওয়া হয়েছে।`
            : `Navigated to ${navHit.labelEn}.`,
          actions: [
            {
              label: bn ? `${navHit.labelBn} খুলুন` : `Open ${navHit.labelEn}`,
              tone: 'primary',
              onClick: () => {
                setCmdOpen(false);
                onNavigate(navHit.page);
              },
            },
          ],
        };
      }
    }

    // 11. Additional Natural ITTC Data Queries (instant, zero latency)
    // 11a. Due / Balance questions
    if (/(বকেয়া|বকেয়া|ডিউ|due|dues|unpaid)/i.test(normalized)) {
      const dueRows = data.students
        .map((s) => ({
          s,
          due: Math.max(0, Number(s.contract || 0) - Number(s.deposit || 0)),
        }))
        .filter((r) => r.due > 0)
        .sort((a, b) => b.due - a.due);
      const topList = dueRows
        .slice(0, 6)
        .map(
          ({ s, due }) =>
            `• ${bn ? 'খাতা' : 'Code'} ${s.code} (${s.name}) — ${bn ? 'ডিউ:' : 'Due:'} ${formatTaka(due)}`
        );
      return {
        title: bn ? 'বর্তমান ডিউ লিস্ট সামারি' : 'Live Due List Summary',
        tone: dueRows.length > 0 ? 'warn' : 'success',
        text:
          dueRows.length > 0
            ? `${bn ? 'মোট বকেয়া ছাত্র:' : 'Students with due:'} ${dueRows.length}  |  ${bn ? 'সর্বমোট ডিউ:' : 'Total Course Due:'} ${formatTaka(totalDue)}\n` +
              topList.join('\n')
            : bn
              ? '🎉 কোনো ছাত্রের কাছে কোর্স ডিউ বকেয়া নেই।'
              : 'No pending student course dues.',
        actions: [
          {
            label: bn ? 'সম্পূর্ণ ডিউ লিস্ট দেখুন →' : 'Open Due List →',
            tone: 'primary',
            onClick: () => {
              setCmdOpen(false);
              onNavigate('due');
            },
          },
        ],
      };
    }

    const mentionsGeneralAccountsOrOfficials =
      /(general\s*accounts?|জেনারেল\s*(?:একাউন্টস|অ্যাকাউন্টস|একাউন্ট|অ্যাকাউন্ট)|মূল\s*হিসাব|পূর্বের\s*ব্যালেন্স|সবুজ\s*কাজী|সোহেল\s*কাজী|সেলিম\s*(?:মাহমুদ|ভাই)|sabuj|sohel|salim|selim)/i.test(
        normalized
      );
    const hasGaWriteIntent =
      /(\d+|যোগ|এড|এন্ট্রি|খরচ|আয়|আয়|জমা|বিয়োগ|ডিলিট|মুছ|আপডেট|পরিবর্তন|লক|আনলক|পাসওয়ার্ড|পাসওয়ার্ড|add|entry|expense|income|deposit|withdraw|delete|remove|edit|update|lock|unlock|password|passcode|-)/i.test(
        normalized
      );

    // 11a-ga. Instant read-only GENERAL ACCOUNTS balance summary (when no write/specific query)
    if (
      mentionsGeneralAccountsOrOfficials &&
      !hasGaWriteIntent &&
      /(ব্যালেন্স|সামারি|হিসাব|মোট|balance|summary|status|report|total)/i.test(normalized)
    ) {
      const gaLedger = buildGeneralAccountsLedger(
        data.generalAccounts || [],
        today.replace(/-/g, '.')
      );
      const actDate = gaLedger.latestDate || today.replace(/-/g, '.');
      const sum = gaLedger.getDaySummary(actDate);
      const md = gaLedger.getOfficialSummary('md');
      const dir = gaLedger.getOfficialSummary('dir');
      const gm = gaLedger.getOfficialSummary('gm');
      return {
        title: bn ? `GENERAL ACCOUNTS সামারি (${actDate})` : `GENERAL ACCOUNTS Summary (${actDate})`,
        tone: 'info',
        text:
          `${bn ? 'পূর্বের ক্যাশ:' : 'Opening Cash:'} ${formatTaka(sum.opening.cash)}  |  ${bn ? 'পূর্বের ব্যাংক:' : 'Opening Bank:'} ${formatTaka(sum.opening.bank + sum.opening.bkash)}\n` +
          `${bn ? 'নতুন নগদ আয়:' : 'New Cash In:'} ${formatTaka(sum.newCashIn)}  |  ${bn ? 'ব্যাংক/বিকাশ:' : 'Bank/Bkash:'} ${formatTaka(sum.newBankBkashIn)}\n` +
          `${bn ? 'মোট ব্যয়:' : 'Total Expense:'} ${formatTaka(sum.totalExp)}\n` +
          `${bn ? 'নগদ ব্যালেন্স:' : 'Cash Balance:'} ${formatTaka(sum.cashBalance)}  |  ${bn ? 'ব্যাংক ব্যালেন্স:' : 'Bank Balance:'} ${formatTaka(sum.totalBank)}\n` +
          `${bn ? 'সর্বমোট ব্যালেন্স:' : 'Grand Total:'} ${formatTaka(sum.grandTotal)}\n` +
          `MD (সবুজ কাজী): ${formatTaka(md.total)} | DIR (সোহেল কাজী): ${formatTaka(dir.total)} | GM (সেলিম মাহমুদ): ${formatTaka(gm.total)}`,
        actions: [
          {
            label: bn ? 'GENERAL ACCOUNTS খুলুন' : 'Open GENERAL ACCOUNTS',
            tone: 'primary',
            onClick: () => {
              onUnlockGeneralAccounts?.(true);
              setCmdOpen(false);
              onNavigate('generalAccounts');
            },
          },
        ],
      };
    }

    // 11b. Today's Collection / Income / Cashbook Balance
    if (
      !mentionsGeneralAccountsOrOfficials &&
      !hasGaWriteIntent &&
      /(কালেকশন|আয়|আয়|ক্যাশবুক|ক্যাশ ব্যালেন্স|জমা খরচ|collection|income|cash balance|cashbook|revenue)/i.test(
        normalized
      )
    ) {
      const todayJobFee = todayJobs.reduce((sum, j) => sum + Number(j.paid || j.pay || 0), 0);
      const todayOutFee = todayOuts.reduce((sum, o) => sum + Number(o.paid || o.price || 0), 0);
      const totalCashIn = data.cash
        .filter((c) => c.type === 'in')
        .reduce((sum, c) => sum + Number(c.amt || 0), 0);
      const totalCashOut = data.cash
        .filter((c) => c.type === 'out')
        .reduce((sum, c) => sum + Number(c.amt || 0), 0);
      const todayCashIn = data.cash
        .filter((c) => c.date === today && c.type === 'in')
        .reduce((sum, c) => sum + Number(c.amt || 0), 0);
      const todayCashOut = data.cash
        .filter((c) => c.date === today && c.type === 'out')
        .reduce((sum, c) => sum + Number(c.amt || 0), 0);
      return {
        title: bn ? `কালেকশন ও ক্যাশবুক সামারি (${today})` : `Collection & Cashbook Summary (${today})`,
        tone: 'info',
        text:
          `${bn ? 'আজকের জব ফি:' : "Today's Job Fees:"} ${formatTaka(todayJobFee + todayOutFee)} (${todayJobs.length + todayOuts.length}টি জব)\n` +
          `${bn ? 'আজকের ক্যাশ IN:' : 'Today Cash IN:'} ${formatTaka(todayCashIn)}  |  ${bn ? 'OUT:' : 'OUT:'} ${formatTaka(todayCashOut)}\n` +
          `${bn ? 'সর্বমোট ক্যাশ ব্যালেন্স:' : 'Net Cashbook Balance:'} ${formatTaka(totalCashIn - totalCashOut)}`,
        actions: [
          {
            label: bn ? 'ক্যাশবুক খুলুন' : 'Open Cashbook',
            tone: 'primary',
            onClick: () => {
              setCmdOpen(false);
              onNavigate('cash');
            },
          },
          {
            label: bn ? 'দৈনিক রেজিস্টার' : 'Daily Register',
            tone: 'secondary',
            onClick: () => {
              setCmdOpen(false);
              onNavigate('jobs');
            },
          },
        ],
      };
    }

    // 11c. Today's Jobs / Job Count
    if (/(আজকের জব|আজকে কয়টা জব|আজ কত জব|কয়টা জব|today job|today's job|today jobs|how many job)/i.test(normalized)) {
      const activeCats = categoryCounts
        .filter((c) => c.count > 0)
        .map((c) => `• ${c.cat}: ${c.count}টি`);
      return {
        title: bn ? `আজকের (${today}) জব সামারি` : `Today's Jobs Summary (${today})`,
        tone: 'info',
        text:
          `${bn ? 'স্টুডেন্ট জব:' : 'Student Jobs:'} ${todayJobs.length}  |  ${bn ? 'আউট জব:' : 'External Jobs:'} ${todayOuts.length}\n` +
          (activeCats.length > 0
            ? activeCats.join('\n')
            : bn
              ? 'আজ এখনো কোনো জব এন্ট্রি হয়নি।'
              : 'No jobs recorded yet today.'),
        actions: [
          {
            label: bn ? 'দৈনিক রেজিস্টার' : 'Daily Register',
            tone: 'primary',
            onClick: () => {
              setCmdOpen(false);
              onNavigate('jobs');
            },
          },
          {
            label: bn ? '+ নতুন জব' : '+ New Job',
            tone: 'secondary',
            onClick: () => {
              setCmdOpen(false);
              onOpenNewJob();
            },
          },
        ],
      };
    }

    // 11d. Total Students / Center Overview
    if (
      /(মোট ছাত্র|কতজন ছাত্র|ছাত্র সংখ্যা|স্টুডেন্ট সংখ্যা|total student|how many student|student count|center summary)/i.test(
        normalized
      )
    ) {
      const passedCount = data.students.filter((s) => Boolean(s.interviewPassedCompany?.trim())).length;
      return {
        title: bn ? 'সেন্টার ও ছাত্র সামারি' : 'Center & Student Overview',
        tone: 'info',
        text:
          `${bn ? 'মোট নিবন্ধিত ছাত্র:' : 'Total Registered Students:'} ${data.students.length}  |  ${bn ? 'ইন্টারভিউ পাস:' : 'Interview Passed:'} ${passedCount}\n` +
          `${bn ? 'মোট কন্ট্রাক্ট:' : 'Total Contract:'} ${formatTaka(totalContract)}  |  ${bn ? 'জমা:' : 'Deposit:'} ${formatTaka(totalDeposit)}  |  ${bn ? 'ডিউ:' : 'Due:'} ${formatTaka(totalDue)}\n` +
          `${bn ? 'মোট সম্পন্ন জব:' : 'All-Time Jobs:'} ${allCompletedJobs}`,
        actions: [
          {
            label: bn ? 'ছাত্র তালিকা' : 'Students List',
            tone: 'primary',
            onClick: () => {
              setCmdOpen(false);
              onNavigate('students');
            },
          },
        ],
      };
    }

    // 11e. Job Price / Rate List
    if (/(জব প্রাইস|জব রেট|দাম কত|রেট কত|price list|job rate|job price|rates)/i.test(normalized)) {
      return {
        title: bn ? 'জব প্রাইস ও রেট তালিকা' : 'Job Rates & Price List',
        tone: 'info',
        text: data.prices
          .slice(0, 12)
          .map((p) => `• ${p.cat} — ${formatTaka(p.price)}`)
          .join('\n'),
        actions: [
          {
            label: bn ? 'প্রাইস ও লিমিট খুলুন' : 'Open Job Prices',
            tone: 'primary',
            onClick: () => {
              setCmdOpen(false);
              onNavigate('prices');
            },
          },
        ],
      };
    }

    // 11f. Help / Available Commands
    if (/^(help|commands|সাহায্য|হেল্প|কমান্ড)$/i.test(normalized) || /(কি কি পারো|কী কী পারো|what can you do)/i.test(normalized)) {
      return {
        title: bn ? 'itttc chat দ্রুত কমান্ড গাইড' : 'itttc chat Quick Commands',
        tone: 'info',
        text: bn
          ? [
              '• খাতা সার্চ: যেমন 17/1, বা "17/1 প্রোফাইল খোলো"',
              '• GENERAL ACCOUNTS: "জেনারেল একাউন্টস ব্যালেন্স কত", "ব্যাংকে -5000 টাকা খরচ এড করো", "সবুজ কাজীর হিসাব দেখাও"',
              '• ডুপ্লিকেট জব চেক: "17/1 জব নিয়েছে?"',
              '• হিসাব: "ডিউ লিস্ট", "আজকের কালেকশন", "আজকের জব", "মোট ছাত্র কত", "জব রেট কত"',
              '• ফর্ম খোলা: "নতুন ছাত্র ভর্তি ফর্ম খোলো", "নতুন জব দাও", "আউট জব খোলো"',
              '• পেজ যাওয়া: "জেনারেল একাউন্টস খোলো", "ক্যাশবুক খোলো", "রিপোর্ট দেখাও"',
            ].join('\n')
          : [
              '• Khata lookup: e.g. 17/1, or "open 17/1 profile"',
              '• GENERAL ACCOUNTS: "General Accounts balance", "Add -5000 Bank expense", "Sabuj Kazi total"',
              '• Job check: "17/1 job check" / "same day job"',
              '• Reports: "due list", "today collection", "today jobs", "total students", "job rates"',
              '• Modals: "register student", "new job", "out job"',
              '• Navigation: "open general accounts", "open cashbook", "show reports"',
            ].join('\n'),
      };
    }

    // 11f-2. Instant Live Date, Weekday & Time (works both offline/static and full-stack)
    if (
      /(কি বার|কী বার|আজকের বার|কত তারিখ|আজকের তারিখ|কি তারিখ|কী তারিখ|কয়টা বাজে|কয়টা বাজে|সময় কত|সময় কত|what day|which day|day is today|today'?s date|today date|what'?s the date|current time|what time)/i.test(
        normalized
      )
    ) {
      const now = new Date();
      const prefersEn = !/[\u0980-\u09FF]/.test(trimmed) && (/[a-z]/i.test(trimmed) || !bn);
      const weekdayBn = new Intl.DateTimeFormat('bn-BD', {
        weekday: 'long',
        timeZone: 'Asia/Dhaka',
      }).format(now);
      const fullDateBn = new Intl.DateTimeFormat('bn-BD', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'Asia/Dhaka',
      }).format(now);
      const fullDateEn = new Intl.DateTimeFormat('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'Asia/Dhaka',
      }).format(now);
      const liveTimeBn = new Intl.DateTimeFormat('bn-BD', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone: 'Asia/Dhaka',
      }).format(now);
      const liveTimeEn = new Intl.DateTimeFormat('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone: 'Asia/Dhaka',
      }).format(now);

      return {
        title: prefersEn ? 'Today · Date & Time' : `আজ ${weekdayBn}`,
        tone: 'info',
        text: prefersEn
          ? `📅 ${fullDateEn}\n🕒 Time: ${liveTimeEn} (Bangladesh Standard Time)`
          : `📅 আজকের তারিখ: ${fullDateBn}\n🕒 সময়: ${liveTimeBn} (বাংলাদেশ সময়)`,
      };
    }

    // 11f-3. Warm Conversational Greetings & Small-Talk
    if (
      /^(hi+|hello+|hey+|hlo+|yo+|salam|assalamu\s*alaikum|as-?salamu\s*alaykum|good\s*(morning|afternoon|evening|night)|thanks?|thank\s*you|ok+|okay|হাই+|হ্যালো+|হেলো+|সালাম|আসসালামু\s*আলাইকুম|ওয়ালাইকুম\s*সালাম|কেমন\s*আছো?|কেমন\s*আছেন|ধন্যবাদ|শুভ\s*(সকাল|দুপুর|বিকাল|রাত্রি))[!?.।\s]*$/i.test(
        normalized
      )
    ) {
      const userWroteBn = /[\u0980-\u09FF]/.test(trimmed);
      const userWroteEn = /[a-z]/i.test(trimmed) && !userWroteBn;
      const replyInBn = userWroteBn || (!userWroteEn && bn);
      const isThanks = /(thanks?|thank\s*you|ধন্যবাদ)/i.test(normalized);
      const isHowAreYou = /(কেমন\s*আছ|কেমন\s*আছেন)/i.test(normalized);
      const isSalam = /(salam|alaikum|সালাম|আলাইকুম)/i.test(normalized);

      return {
        title: replyInBn ? 'itttc chat সহায়ক' : 'itttc chat Assistant',
        tone: 'info',
        text: replyInBn
          ? isThanks
            ? 'আপনাকেও অসংখ্য ধন্যবাদ! সেন্টারের যেকোনো হিসাব, খাতা সার্চ বা ফর্ম খুলতে আমাকে বলতে পারেন।'
            : isHowAreYou
              ? 'আলহামদুলিল্লাহ, আমি ভালো আছি এবং আপনাকে সাহায্য করতে প্রস্তুত! বলুন আজ সেন্টারের কোন তথ্য দেখতে চান?'
              : `${isSalam ? 'ওয়ালাইকুমুস সালাম! ' : 'হ্যালো! '}আমি itttc chat — আপনার সেন্টার সহকারী। খাতা নম্বর (যেমন ${sampleStudentCode}), ডিউ লিস্ট, আজকের কালেকশন, আজকের জব, বা ফর্ম খোলার নির্দেশ দিন।`
          : isThanks
            ? "You're welcome! Let me know whenever you need student lookups, due lists, collections, or quick navigation."
            : 'Hello! I am itttc chat, your center assistant. Ask about any Khata code (e.g. ' +
              sampleStudentCode +
              '), "due list", "today collection", "today jobs", or give an order like "open register student".',
      };
    }

    // 11g. Safe Student Name / Phone lookup (strictly >= 3 chars, name/phone ONLY, never General Accounts or write commands)
    if (
      lower.length >= 3 &&
      !mentionsGeneralAccountsOrOfficials &&
      !hasGaWriteIntent &&
      !/^(hi+|hey+|hello+|salam|good\s|how\s|what\s|who\s|why\s|can\s|ok+|thanks?)/i.test(lower)
    ) {
      const nameOrPhoneMatches = data.students.filter(
        (s) =>
          s.name.trim().toLowerCase().includes(lower) ||
          (s.phone && normalizeBengaliDigits(s.phone).replace(/\s+/g, '').includes(lower.replace(/\s+/g, '')))
      );
      if (nameOrPhoneMatches.length === 1) {
        return formatStudentSummary(nameOrPhoneMatches[0]);
      }
      if (nameOrPhoneMatches.length > 1) {
        return {
          title: bn ? `ছাত্র পাওয়া গেছে (${nameOrPhoneMatches.length} জন)` : `Matching Students (${nameOrPhoneMatches.length})`,
          tone: 'info',
          text: nameOrPhoneMatches
            .slice(0, 25)
            .map((s) => `• ${s.code} — ${s.name} (${s.phone || '—'})`)
            .join('\n'),
          actions: [
            {
              label: bn ? 'ছাত্র তালিকা দেখুন' : 'View Students',
              tone: 'primary',
              onClick: () => {
                setCmdOpen(false);
                onNavigate('students');
              },
            },
          ],
        };
      }
    }

    return null;
  };

  const buildCenterSnapshotForAi = (queryText = ''): string => {
    const todayJobFee = todayJobs.reduce((sum, j) => sum + Number(j.paid || j.pay || 0), 0);
    const todayOutFee = todayOuts.reduce((sum, o) => sum + Number(o.paid || o.price || 0), 0);
    const todayCashIn = data.cash
      .filter((c) => c.date === today && c.type === 'in')
      .reduce((sum, c) => sum + Number(c.amt || 0), 0);
    const todayCashOut = data.cash
      .filter((c) => c.date === today && c.type === 'out')
      .reduce((sum, c) => sum + Number(c.amt || 0), 0);
    const passedStudents = data.students.filter((s) => Boolean(s.interviewPassedCompany?.trim()));
    const todayCountBySid = new Map<string, number>();
    todayJobs.forEach((j) => {
      const k = j.sid.trim().toLowerCase();
      todayCountBySid.set(k, (todayCountBySid.get(k) || 0) + 1);
    });
    const activity = computeStudentJobActivity(data.students, data.jobs);
    const inactive3d = activity.inactive3PlusCount;
    const inactive7d = activity.inactive7PlusCount;
    const neverJobs = activity.neverTookJobCount;

    const qLower = queryText.trim().toLowerCase();
    const qNorm = normalizeBengaliDigits(qLower);
    const isAppearanceOrSimpleOrder =
      /(কালার|রং|রঙ|থিম|এনিমেশন|অ্যানিমেশন|মোশন|ফন্ট|সাইজ|রিসেট|ডার্ক|লাইট|মেগা|সিঙ্ক|color|theme|animation|motion|font|reset|preset|sync|mega)/i.test(
        qNorm
      ) && !/\b\d{1,4}\/\d{1,5}\b/.test(qNorm);

    const matchedStudents = qNorm
      ? data.students.filter(
          (s) =>
            qNorm.includes(s.code.trim().toLowerCase()) ||
            (s.phone && qNorm.includes(normalizeBengaliDigits(s.phone).replace(/\s+/g, ''))) ||
            s.name
              .toLowerCase()
              .split(/\s+/)
              .some((w) => w.length >= 3 && qLower.includes(w))
        )
      : [];

    const topDueStudents = [...data.students]
      .sort(
        (a, b) =>
          Math.max(0, Number(b.contract || 0) - Number(b.deposit || 0)) -
          Math.max(0, Number(a.contract || 0) - Number(a.deposit || 0))
      )
      .slice(0, isAppearanceOrSimpleOrder ? 3 : 15);

    const maxStudentsInPrompt = isAppearanceOrSimpleOrder ? 5 : 30;
    const prioritizedStudents = [
      ...matchedStudents,
      ...topDueStudents,
      ...data.students.slice(0, isAppearanceOrSimpleOrder ? 5 : 15),
    ]
      .filter((s, idx, arr) => arr.findIndex((x) => x.id === s.id) === idx)
      .slice(0, maxStudentsInPrompt);

    const studentLines = prioritizedStudents.map((s) => {
      const due = Math.max(0, Number(s.contract || 0) - Number(s.deposit || 0));
      const tJobs = todayCountBySid.get(s.code.trim().toLowerCase()) || 0;
      return `${s.code} | ${s.name} | Contract: ৳${s.contract} | Deposit: ৳${s.deposit} | Due: ৳${due} | Passed: ${s.interviewPassedCompany || 'Pending'} | TodayJobs: ${tJobs}`;
    });

    const dueStudentsCount = data.students.filter(
      (s) => Math.max(0, Number(s.contract || 0) - Number(s.deposit || 0)) > 0
    ).length;

    const recentCash = data.cash
      .slice(-5)
      .map((c) => `${c.date} [${c.type.toUpperCase()}] ${c.category || ''}: ৳${c.amt} (${c.note})`)
      .join(' ; ');

    const todayDot = today.replace(/-/g, '.');
    const gaLedger = buildGeneralAccountsLedger(data.generalAccounts || [], todayDot);
    const gaActiveDate = gaLedger.latestDate || todayDot;
    const gaActiveSummary = gaLedger.getDaySummary(gaActiveDate);
    const activeDateParts = parseRowDateParts(gaActiveDate);
    const gaReportYear = activeDateParts?.year || new Date().getFullYear();
    const gaReportMonth = activeDateParts?.month || new Date().getMonth() + 1;
    const gaMonthly = gaLedger.getMonthlySummary(gaReportYear, gaReportMonth, 1, 31);
    const gaOfficialLifetimeLines = OFFICIAL_KEYS_ORDER.map((k) => {
      const meta = OFFICIAL_PROFILES[k];
      const off = gaLedger.getOfficialSummary(k);
      return `${meta.nameBn} (${meta.nameEn}, ${meta.role}): Lifetime=৳${off.total} (${off.count} entries, ${off.uniqueDaysCount} days)`;
    }).join(' | ');

    const gaMatchedRows = gaLedger.txRows.filter((r) => {
      if (!qNorm) return false;
      const hay = `${r.date} ${r.voucher} ${r.khataNo} ${r.incSrc} ${r.expSrc}`.toLowerCase();
      return (
        qNorm.includes(r.date) ||
        (r.voucher && qLower.includes(r.voucher.toLowerCase())) ||
        (r.khataNo && qNorm.includes(r.khataNo.toLowerCase())) ||
        qLower.split(/\s+/).some((w) => w.length >= 3 && hay.includes(w))
      );
    });
    const gaPrioritizedRows = [
      ...gaMatchedRows,
      ...gaActiveSummary.dayRows,
      ...gaLedger.txRows.slice(-20),
    ]
      .filter((r, idx, arr) => arr.findIndex((x) => x.raw.id === r.raw.id) === idx)
      .slice(0, isAppearanceOrSimpleOrder ? 5 : 35);

    const gaRowLines = gaPrioritizedRows.map((r) => {
      const parts = [
        `id=${r.raw.id}`,
        `date=${r.date}`,
        r.voucher ? `voucher=${r.voucher}` : '',
        r.khataNo ? `khata=${r.khataNo}` : '',
        `acc=${r.account}`,
        r.incSrc ? `inDesc="${r.incSrc}"` : '',
        r.incCash !== 0 ? `inCash=${r.incCash}` : '',
        r.incBank !== 0 ? `inBank=${r.incBank}` : '',
        r.expSrc ? `outDesc="${r.expSrc}"` : '',
        r.expAmt !== 0 ? `outCash=${r.expAmt}` : '',
      ].filter(Boolean);
      return `  * ${parts.join(' | ')}`;
    });

    const gaLockedList = [...gaLedger.lockedDateKeys.keys()].join(', ') || 'None';
    const curApp = appearanceRef.current;
    return [
      `Institute: ${data.settings.name} | Subtitle: ${data.settings.subtitle || '—'}`,
      `Date: ${today} | Language: ${lang} | ThemeMode: ${theme} | MEGA Cloud Connected: ${megaConfigured ? 'Yes' : 'No'}`,
      `UI Appearance State: ColorGrading=${curApp.colorGradingEnabled}, Preset=${curApp.activePresetId}, bgColor=${curApp.bgColor}, cardColor=${curApp.cardColor}, accentColor=${curApp.accentColor}, textColor=${curApp.textColor}, accentTheme=${curApp.accentTheme}, CustomPresets=[${curApp.customColorPresets.map((p) => `${p.id}:${p.name}`).join(', ')}]`,
      `Animations State: Master=${curApp.animationsEnabled}, AuroraSweep=${curApp.fxAuroraSweep}, BentoSpring=${curApp.fxBentoSpring}, KineticCounter=${curApp.fxKineticCounter}, Spotlight=${curApp.fxSpotlight}, RowScan=${curApp.fxRowScan}`,
      `Typography & Branding: fontScale=${curApp.fontScale}%, fontFamily=${curApp.fontFamily}, heroTitle="${curApp.instituteTitle}", heroSub="${curApp.instituteSub}"`,
      `Job Categories (${data.prices.length}): ${data.prices.map((p) => `${p.cat} (৳${p.price}, Limit ${p.limit})`).join(', ')}`,
      `Total Students: ${data.students.length} | With Due: ${dueStudentsCount} | Inactive 3+d: ${inactive3d}, 7+d: ${inactive7d}, Never took job: ${neverJobs}`,
      `Today's Jobs: ${todayJobs.length} student jobs + ${todayOuts.length} external jobs (Fees today: ৳${todayJobFee + todayOutFee})`,
      `Today Cashbook IN: ৳${todayCashIn} | OUT: ৳${todayCashOut}${recentCash ? ` | Recent Cash: ${recentCash}` : ''}`,
      `GENERAL ACCOUNTS LIVE LEDGER (${gaLedger.txRows.length} tx rows across [${gaLedger.uniqueDates.join(', ') || 'no dates'}]):`,
      `  - Latest/Active Date: ${gaActiveDate} | Next Suggested Voucher: ${gaLedger.suggestedVoucher} | Locked Dates: ${gaLockedList} | Current Passcode: ${data.settings.generalAccountsPass || '1234'}`,
      `  - Active Day (${gaActiveDate}) Summary: Opening(prev=${gaActiveSummary.opening.prevDate}, Cash=৳${gaActiveSummary.opening.cash}, Bank=৳${gaActiveSummary.opening.bank}, Bkash=৳${gaActiveSummary.opening.bkash}, manual=${gaActiveSummary.opening.isManual}) | NewCashIn=৳${gaActiveSummary.newCashIn} | NewBank/BkashNet=৳${gaActiveSummary.newBankBkashIn} | TotalCash=৳${gaActiveSummary.totalCash} | TotalBank=৳${gaActiveSummary.totalBank} | TotalExp=৳${gaActiveSummary.totalExp} | CashBalance=৳${gaActiveSummary.cashBalance} | GrandTotal(Cash+Bank)=৳${gaActiveSummary.grandTotal}`,
      `  - Monthly Report (${BN_MONTHS[gaReportMonth - 1] || gaReportMonth} ${gaReportYear}, 1–31): CashIn=৳${gaMonthly.totalCashIn}, BankIn=৳${gaMonthly.totalBankIn}, Sabuj(MD)=৳${gaMonthly.mdTotal}(${gaMonthly.mdCount}), Sohel(DIR)=৳${gaMonthly.dirTotal}(${gaMonthly.dirCount}), Salim(GM)=৳${gaMonthly.gmTotal}(${gaMonthly.gmCount}), OtherExp=৳${gaMonthly.otherExpTotal}, TotalAllExp=৳${gaMonthly.allExpTotal}`,
      `  - Official Profiles All-Time: ${gaOfficialLifetimeLines}`,
      gaRowLines.length > 0
        ? `  - General Accounts Rows (${gaRowLines.length} shown):\n${gaRowLines.join('\n')}`
        : '  - General Accounts Rows: None yet.',
      `All-Time Jobs Completed: ${allCompletedJobs}`,
      `Total Contract Value: ৳${totalContract} | Total Course Deposit: ৳${totalDeposit} | Total Course Due: ৳${totalDue}`,
      `Interview Passed Count: ${passedStudents.length} | Staff: ${data.staff.length} | Companies: ${data.companies.length} | Store Items: ${data.store.length} | Docs: ${data.docs.length}`,
      studentLines.length > 0
        ? `Key / Matched Students (${studentLines.length} of ${data.students.length}):\n${studentLines.join('\n')}`
        : 'No students registered yet.',
    ].join('\n');
  };

  const parseCleanHex = (v: unknown): string | null => {
    if (typeof v !== 'string') return null;
    const raw = v.trim();
    const m6 = raw.match(/#?([0-9a-fA-F]{6})/);
    if (m6) return `#${m6[1].toLowerCase()}`;
    const m3 = raw.match(/^#?([0-9a-fA-F]{3})$/);
    if (m3) {
      const [r, g, b] = m3[1].toLowerCase().split('');
      return `#${r}${r}${g}${g}${b}${b}`;
    }
    const namedHex: Record<string, string> = {
      red: '#ef4444',
      crimson: '#dc2626',
      blue: '#3b82f6',
      navy: '#1e3a8a',
      green: '#10b981',
      emerald: '#10b981',
      purple: '#8b5cf6',
      violet: '#7c3aed',
      orange: '#f97316',
      yellow: '#eab308',
      gold: '#eab308',
      amber: '#f59e0b',
      pink: '#ec4899',
      rose: '#f43f5e',
      cyan: '#06b6d4',
      teal: '#14b8a6',
    };
    return namedHex[raw.toLowerCase()] || null;
  };

  const isHexLight = (hex: string): boolean => {
    const clean = hex.replace('#', '');
    if (clean.length !== 6) return false;
    const r = parseInt(clean.slice(0, 2), 16) || 0;
    const g = parseInt(clean.slice(2, 4), 16) || 0;
    const b = parseInt(clean.slice(4, 6), 16) || 0;
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55;
  };

  const tryLocalPowerCommandFallback = (
    rawText: string
  ): Omit<ChatMessage, 'id' | 'sender'> | null => {
    const normalized = normalizeBengaliDigits(rawText.trim());
    const lower = normalized.toLowerCase();

    // 1. Reset appearance
    if (/(রিসেট|ডিফল্ট কালার|reset color|reset theme|reset appearance|default theme)/i.test(normalized)) {
      onResetAppearance?.();
      return {
        title: bn ? 'কালার ও থিম রিসেট হয়েছে' : 'Colors & Theme Reset',
        tone: 'success',
        text: bn
          ? 'সব কালার, অ্যানিমেশন ও ফন্ট ডিফল্ট অবস্থায় ফিরিয়ে আনা হয়েছে।'
          : 'Reset all colors, animations, and typography to defaults.',
      };
    }

    // 2. Color palette commands (Red, Blue, Green, Purple, Orange, Yellow/Gold, Pink, Cyan, Midnight)
    const wantsLight = /(হালকা|লাইট|light|সাদা)/i.test(normalized);
    const wantsDark = /(গাঢ়|ডার্ক|dark|কালো)/i.test(normalized);
    const namedPalettes: Array<{
      re: RegExp;
      labelBn: string;
      labelEn: string;
      dark: { bg: string; card: string; accent: string; text: string };
      light: { bg: string; card: string; accent: string; text: string };
    }> = [
      {
        re: /(লাল|red|crimson|রক্ত)/i,
        labelBn: 'লাল (Crimson Red)',
        labelEn: 'Crimson Red',
        dark: { bg: '#1b070a', card: '#2d0b11', accent: '#ef4444', text: '#fff1f2' },
        light: { bg: '#fff1f2', card: '#ffffff', accent: '#dc2626', text: '#450a0a' },
      },
      {
        re: /(নীল|blue|ocean|navy)/i,
        labelBn: 'নীল (Deep Ocean Blue)',
        labelEn: 'Ocean Blue',
        dark: { bg: '#071326', card: '#0e2240', accent: '#3b82f6', text: '#eff6ff' },
        light: { bg: '#eff6ff', card: '#ffffff', accent: '#2563eb', text: '#0f172a' },
      },
      {
        re: /(সবুজ|green|emerald)/i,
        labelBn: 'সবুজ (Emerald Green)',
        labelEn: 'Emerald Green',
        dark: { bg: '#060a12', card: '#0c1320', accent: '#10b981', text: '#f8fafc' },
        light: { bg: '#ecfdf5', card: '#ffffff', accent: '#059669', text: '#064e3b' },
      },
      {
        re: /(বেগুনি|purple|violet)/i,
        labelBn: 'বেগুনি (Royal Purple)',
        labelEn: 'Royal Purple',
        dark: { bg: '#130924', card: '#1f103a', accent: '#a855f7', text: '#faf5ff' },
        light: { bg: '#faf5ff', card: '#ffffff', accent: '#7e22ce', text: '#3b0764' },
      },
      {
        re: /(কমলা|orange|flame)/i,
        labelBn: 'কমলা (Sunset Orange)',
        labelEn: 'Sunset Orange',
        dark: { bg: '#1a0c05', card: '#2c1509', accent: '#f97316', text: '#fff7ed' },
        light: { bg: '#fff7ed', card: '#ffffff', accent: '#ea580c', text: '#431407' },
      },
      {
        re: /(হলুদ|সোনালি|yellow|gold|amber)/i,
        labelBn: 'সোনালি / হলুদ (Amber Gold)',
        labelEn: 'Amber Gold',
        dark: { bg: '#14110f', card: '#221c18', accent: '#eab308', text: '#fefce8' },
        light: { bg: '#fefce8', card: '#ffffff', accent: '#ca8a04', text: '#422006' },
      },
      {
        re: /(গোলাপি|pink|rose)/i,
        labelBn: 'গোলাপি (Velvet Rose)',
        labelEn: 'Velvet Rose',
        dark: { bg: '#1c0713', card: '#2f0d20', accent: '#ec4899', text: '#fdf2f8' },
        light: { bg: '#fdf2f8', card: '#ffffff', accent: '#db2777', text: '#500724' },
      },
      {
        re: /(আকাশি|cyan|sky|teal)/i,
        labelBn: 'আকাশি (Cyan Sky)',
        labelEn: 'Cyan Sky',
        dark: { bg: '#04171d', card: '#092731', accent: '#06b6d4', text: '#ecfeff' },
        light: { bg: '#ecfeff', card: '#ffffff', accent: '#0891b2', text: '#083344' },
      },
    ];

    const matchedPalette = namedPalettes.find((p) => p.re.test(normalized));
    const isGenericColorOrder =
      !matchedPalette &&
      /(কালার|রং|রঙ|থিম|ব্যাকগ্রাউন্ড|color|colour|theme|palette)/i.test(normalized) &&
      /(পরিবর্তন|বদলাও|বদলে|চেঞ্জ|পাল্টাও|দাও|করো|change|switch|update|apply|make)/i.test(
        normalized
      );
    const chosenPalette =
      matchedPalette ||
      (isGenericColorOrder
        ? (() => {
            const curAccent = appearanceRef.current.accentColor.toLowerCase();
            const curIdx = namedPalettes.findIndex(
              (p) =>
                p.dark.accent.toLowerCase() === curAccent ||
                p.light.accent.toLowerCase() === curAccent
            );
            return namedPalettes[(curIdx + 1) % namedPalettes.length];
          })()
        : undefined);

    if (chosenPalette) {
      const useLight = wantsLight || (!wantsDark && theme === 'light');
      const pal = useLight ? chosenPalette.light : chosenPalette.dark;
      onSetTheme?.(useLight ? 'light' : 'dark');
      commitAppearancePatch((prev) => ({
        ...prev,
        colorGradingEnabled: true,
        activePresetId: 'custom',
        bgColor: pal.bg,
        cardColor: pal.card,
        accentColor: pal.accent,
        textColor: pal.text,
      }));
      return {
        title: bn ? `${chosenPalette.labelBn} কালার চালু হয়েছে` : `Applied ${chosenPalette.labelEn}`,
        tone: 'success',
        text: bn
          ? `সফটওয়্যারের সম্পূর্ণ কালার গ্রেডিং ${chosenPalette.labelBn} থিমে পরিবর্তন ও সেভ করা হয়েছে।`
          : `Updated and saved the UI color grading to ${chosenPalette.labelEn}.`,
      };
    }

    if (/(লাইট মোড|light mode|থিম লাইট|সাদা করো)/i.test(normalized)) {
      onSetTheme?.('light');
      commitAppearancePatch((prev) => ({ ...prev, colorGradingEnabled: false }));
      return {
        title: bn ? 'লাইট মোড চালু হয়েছে' : 'Switched to Light Mode',
        tone: 'success',
        text: bn ? 'সফটওয়্যারটি লাইট মোডে পরিবর্তন করা হয়েছে।' : 'Switched theme to Light Mode.',
      };
    }
    if (/(ডার্ক মোড|dark mode|থিম ডার্ক|কালো করো)/i.test(normalized)) {
      onSetTheme?.('dark');
      commitAppearancePatch((prev) => ({ ...prev, colorGradingEnabled: false }));
      return {
        title: bn ? 'ডার্ক মোড চালু হয়েছে' : 'Switched to Dark Mode',
        tone: 'success',
        text: bn ? 'সফটওয়্যারটি ডার্ক মোডে পরিবর্তন করা হয়েছে।' : 'Switched theme to Dark Mode.',
      };
    }

    // 3. Animations toggle
    if (/(এনিমেশন|অ্যানিমেশন|মোশন|animation|motion)/i.test(normalized)) {
      const turnOff = /(বন্ধ|অফ|থামাও|disable|off|stop|pause)/i.test(normalized);
      const turnOn = /(চালু|অন|শুরু|enable|on|start)/i.test(normalized);
      if (turnOff || turnOn) {
        const nextVal = turnOn ? true : false;
        commitAppearancePatch((prev) => ({
          ...prev,
          animationsEnabled: nextVal,
          fxAuroraSweep: nextVal,
          fxBentoSpring: nextVal,
          fxKineticCounter: nextVal,
          fxSpotlight: nextVal,
          fxRowScan: nextVal,
        }));
        return {
          title: bn
            ? nextVal
              ? 'সব এনিমেশন চালু করা হয়েছে'
              : 'সব এনিমেশন বন্ধ করা হয়েছে'
            : nextVal
              ? 'Animations Enabled'
              : 'Animations Disabled',
          tone: 'success',
          text: bn
            ? nextVal
              ? 'সকল মোশন গ্রাফিক্স ও এনিমেশন চালু করে সেভ করা হয়েছে।'
              : 'সকল মোশন গ্রাফিক্স ও এনিমেশন বন্ধ করা হয়েছে।'
            : nextVal
              ? 'Enabled all animations and motion graphics.'
              : 'Disabled all animations and motion graphics.',
        };
      }
    }

    // 4. Font scale
    if (/(ফন্ট|font|সাইজ|size|বড়|ছোট)/i.test(normalized)) {
      const pctMatch = normalized.match(/\b(8[5-9]|9\d|10\d|11\d|120)\s*%?/);
      const curScale = appearanceRef.current.fontScale;
      const nextScale = pctMatch
        ? Math.min(120, Math.max(85, Number(pctMatch[1])))
        : /(বড়|bigger|increase|large)/i.test(lower)
          ? Math.min(120, curScale + 10)
          : /(ছোট|smaller|decrease|small)/i.test(lower)
            ? Math.max(85, curScale - 10)
            : null;
      if (nextScale !== null) {
        commitAppearancePatch((prev) => ({ ...prev, fontScale: nextScale }));
        return {
          title: bn ? `ফন্ট স্কেল ${nextScale}% করা হয়েছে` : `Font Scale Set to ${nextScale}%`,
          tone: 'success',
          text: bn
            ? `গ্লোবাল ফন্ট সাইজ ${nextScale}% এ আপডেট ও সেভ করা হয়েছে।`
            : `Updated global font scale to ${nextScale}%.`,
        };
      }
    }

    // 5. Language toggle
    if (/(ইংরেজি করো|english mode|switch to english)/i.test(lower)) {
      onSetLang?.('en');
      return {
        title: 'Switched Language to English',
        tone: 'success',
        text: 'Application language is now English.',
      };
    }
    if (/(বাংলা করো|bangla mode|switch to bengali)/i.test(lower)) {
      onSetLang?.('bn');
      return {
        title: 'ভাষা বাংলায় পরিবর্তন হয়েছে',
        tone: 'success',
        text: 'সফটওয়্যারের ভাষা এখন বাংলা।',
      };
    }

    return null;
  };

  const executeAiClientActions = async (
    actionsList?: Array<{ name?: string; args?: Record<string, unknown> }>
  ): Promise<CommandAction[]> => {
    if (!Array.isArray(actionsList) || actionsList.length === 0) return [];
    const allowedPages = new Set<NavKey>([
      'dash',
      'students',
      'due',
      'inactive',
      'jobs',
      'outs',
      'returns',
      'cash',
      'generalAccounts',
      'staff',
      'companies',
      'store',
      'prices',
      'docs',
      'reports',
      'monthly',
      'settings',
      'admin',
    ]);
    const buttons: CommandAction[] = [];

    for (const act of actionsList) {
      const args = act.args || {};

      if (act.name === 'update_color_and_theme') {
        if (args.resetColors === true) {
          onResetAppearance?.();
          buttons.push({
            label: bn ? 'কালার সেটিংস' : 'Center Settings',
            tone: 'secondary',
            onClick: () => onNavigate('settings'),
          });
          continue;
        }
        const tMode = String(args.themeMode || '').trim().toLowerCase();
        if (tMode === 'light' || tMode === 'dark') {
          onSetTheme?.(tMode);
        }

        const deletePreset = String(args.deletePresetName || '').trim();
        if (deletePreset) {
          commitAppearancePatch((prev) => ({
            ...prev,
            customColorPresets: prev.customColorPresets.filter(
              (p) =>
                p.id !== deletePreset && p.name.toLowerCase() !== deletePreset.toLowerCase()
            ),
          }));
        }

        const requestedPreset = String(args.presetId || '').trim();
        const allPresets: ColorGradingPreset[] = [
          ...BUILTIN_COLOR_GRADING_PRESETS,
          ...appearanceRef.current.customColorPresets,
        ];
        const matchedPreset = requestedPreset
          ? allPresets.find(
              (p) =>
                p.id.toLowerCase() === requestedPreset.toLowerCase() ||
                p.name.toLowerCase() === requestedPreset.toLowerCase()
            )
          : undefined;

        const cleanBg = parseCleanHex(args.bgColor);
        const cleanCard = parseCleanHex(args.cardColor);
        const cleanAccent = parseCleanHex(args.accentColor);
        const cleanText = parseCleanHex(args.textColor);
        const hasAnyCustomColor = Boolean(cleanBg || cleanCard || cleanAccent || cleanText || matchedPreset);

        const nextState = commitAppearancePatch((prev) => {
          let next: UiAppearanceSettings = { ...prev };
          if (matchedPreset) {
            next = {
              ...next,
              colorGradingEnabled: true,
              activePresetId: matchedPreset.id,
              bgColor: matchedPreset.bgColor,
              cardColor: matchedPreset.cardColor,
              accentColor: matchedPreset.accentColor,
              textColor: matchedPreset.textColor,
            };
          }
          if (
            args.accentTheme === 'emerald' ||
            args.accentTheme === 'navy' ||
            args.accentTheme === 'flame'
          ) {
            next.accentTheme = args.accentTheme as AccentTheme;
          }
          if (typeof args.colorGradingEnabled === 'boolean') {
            next.colorGradingEnabled = args.colorGradingEnabled;
          }
          if (cleanBg) {
            next.bgColor = cleanBg;
            next.colorGradingEnabled = true;
            if (!matchedPreset) next.activePresetId = 'custom';
          }
          if (cleanCard) {
            next.cardColor = cleanCard;
            next.colorGradingEnabled = true;
          }
          if (cleanAccent) {
            next.accentColor = cleanAccent;
            next.colorGradingEnabled = true;
            if (!matchedPreset) next.activePresetId = 'custom';
          }
          if (cleanText) {
            next.textColor = cleanText;
            next.colorGradingEnabled = true;
          }
          if (hasAnyCustomColor && args.colorGradingEnabled !== false) {
            next.colorGradingEnabled = true;
          }
          const saveName = String(args.saveAsPresetName || '').trim();
          if (saveName) {
            const newId = `custom-${Date.now()}`;
            next.customColorPresets = [
              ...next.customColorPresets.filter(
                (p) => p.name.toLowerCase() !== saveName.toLowerCase()
              ),
              {
                id: newId,
                name: saveName,
                bgColor: next.bgColor,
                cardColor: next.cardColor,
                accentColor: next.accentColor,
                textColor: next.textColor,
                builtin: false,
              },
            ];
            next.activePresetId = newId;
            next.colorGradingEnabled = true;
          }
          return next;
        });

        if (nextState.colorGradingEnabled && !tMode) {
          onSetTheme?.(isHexLight(nextState.bgColor) ? 'light' : 'dark');
        }

        buttons.push({
          label: bn ? 'কালার সেটিংস দেখুন' : 'Color Settings',
          tone: 'secondary',
          onClick: () => onNavigate('settings'),
        });
      } else if (act.name === 'update_animations_and_motion') {
        commitAppearancePatch((prev) => ({
          ...prev,
          animationsEnabled:
            typeof args.animationsEnabled === 'boolean'
              ? args.animationsEnabled
              : prev.animationsEnabled,
          fxAuroraSweep:
            typeof args.fxAuroraSweep === 'boolean' ? args.fxAuroraSweep : prev.fxAuroraSweep,
          fxBentoSpring:
            typeof args.fxBentoSpring === 'boolean' ? args.fxBentoSpring : prev.fxBentoSpring,
          fxKineticCounter:
            typeof args.fxKineticCounter === 'boolean'
              ? args.fxKineticCounter
              : prev.fxKineticCounter,
          fxSpotlight:
            typeof args.fxSpotlight === 'boolean' ? args.fxSpotlight : prev.fxSpotlight,
          fxRowScan: typeof args.fxRowScan === 'boolean' ? args.fxRowScan : prev.fxRowScan,
        }));
        buttons.push({
          label: bn ? 'অ্যানিমেশন সেটিংস' : 'Animation Settings',
          tone: 'secondary',
          onClick: () => onNavigate('settings'),
        });
      } else if (act.name === 'update_graphics_and_typography') {
        if (args.resetAllAppearance === true) {
          if (onResetAppearance) {
            onResetAppearance();
          } else {
            commitAppearancePatch(() => ({ ...DEFAULT_UI_SETTINGS }));
          }
        } else {
          commitAppearancePatch((prev) => ({
            ...prev,
            ...(typeof args.instituteTitle === 'string' && args.instituteTitle.trim()
              ? { instituteTitle: args.instituteTitle.trim() }
              : {}),
            ...(typeof args.instituteSub === 'string'
              ? { instituteSub: args.instituteSub.trim() }
              : {}),
            ...(typeof args.fontFamily === 'string' && args.fontFamily.trim()
              ? { fontFamily: args.fontFamily.trim() }
              : {}),
            ...(typeof args.fontScale === 'number' && Number.isFinite(args.fontScale)
              ? { fontScale: Math.min(120, Math.max(85, Math.round(args.fontScale))) }
              : {}),
          }));
        }
        if (args.language === 'bn' || args.language === 'en') {
          onSetLang?.(args.language);
        }
        if (args.openSettingsDrawer === true) {
          onOpenSettingsDrawer?.();
        }
      } else if (act.name === 'register_student' && onAddRecord) {
        const stuName = String(args.name || '').trim();
        if (stuName) {
          const explicitCode = String(args.code || '').trim();
          const autoCode =
            explicitCode ||
            `17/${data.students.length + 1}`;
          await onAddRecord('students', {
            date: today,
            name: stuName,
            code: autoCode,
            phone: String(args.phone || '').trim(),
            trade: String(args.trade || '6G TIG').trim(),
            contract: Math.max(0, Number(args.contract || 0) || 0),
            deposit: Math.max(0, Number(args.deposit || 0) || 0),
            fatherName: String(args.fatherName || '').trim(),
            district: String(args.district || '').trim(),
            passportNo: String(args.passportNo || '').trim(),
            note: String(args.note || '').trim(),
          });
          await onLogAudit?.('AI Register Student', 'Students', `${stuName} (${autoCode})`);
          buttons.push({
            label: bn ? `ছাত্র প্রোফাইল (${autoCode})` : `Student (${autoCode})`,
            tone: 'primary',
            onClick: () => {
              if (onOpenStudentProfile) onOpenStudentProfile(autoCode);
              else onNavigate('students');
            },
          });
        }
      } else if (act.name === 'update_student_record' && onUpdateRecord) {
        const keyStr = String(args.studentCodeOrName || '').trim().toLowerCase();
        const stu =
          data.students.find((s) => s.code.trim().toLowerCase() === keyStr) ||
          data.students.find((s) => s.name.trim().toLowerCase() === keyStr) ||
          data.students.find((s) => s.name.trim().toLowerCase().includes(keyStr));
        if (stu) {
          const patch: Record<string, unknown> = {};
          const addDep = Math.max(0, Number(args.addDepositAmount || 0) || 0);
          if (addDep > 0) {
            patch.deposit = Number(stu.deposit || 0) + addDep;
          } else if (typeof args.deposit === 'number' && Number.isFinite(args.deposit)) {
            patch.deposit = Math.max(0, args.deposit);
          }
          if (typeof args.contract === 'number' && Number.isFinite(args.contract)) {
            patch.contract = Math.max(0, args.contract);
          }
          if (typeof args.phone === 'string' && args.phone.trim()) patch.phone = args.phone.trim();
          if (typeof args.trade === 'string' && args.trade.trim()) patch.trade = args.trade.trim();
          if (typeof args.companyName === 'string') patch.companyName = args.companyName.trim();
          if (typeof args.interviewPassedCompany === 'string') {
            patch.interviewPassedCompany = args.interviewPassedCompany.trim();
            if (args.interviewPassedCompany.trim()) patch.interviewDate = today;
          }
          if (typeof args.overseasStatus === 'string' && args.overseasStatus.trim()) {
            patch.overseasStatus = args.overseasStatus.trim();
          }
          if (typeof args.destination === 'string') patch.destination = args.destination.trim();
          if (typeof args.passportNo === 'string') {
            patch.passportNo = args.passportNo.trim().toUpperCase();
            if (args.passportNo.trim()) patch.passportSubmitted = true;
          }
          if (typeof args.bioEnrolled === 'boolean') patch.bioEnrolled = args.bioEnrolled;
          if (typeof args.note === 'string') patch.note = args.note.trim();

          await onUpdateRecord('students', stu.id, patch);
          if (addDep > 0 && args.logCashEntry !== false && onAddRecord) {
            await onAddRecord('cash', {
              date: today,
              type: 'in',
              category: 'Course Deposit',
              amt: addDep,
              note: `Course Deposit: ${stu.name} (${stu.code}) [AI]`,
            });
          }
          await onLogAudit?.('AI Update Student', 'Students', `${stu.code} (${stu.name})`);
          buttons.push({
            label: bn ? `প্রোফাইল (${stu.code})` : `Profile (${stu.code})`,
            tone: 'primary',
            onClick: () => {
              if (onOpenStudentProfile) onOpenStudentProfile(stu.code);
              else onNavigate('students');
            },
          });
        }
      } else if (act.name === 'issue_student_job' && onAddRecord) {
        const codeStr = String(args.studentCode || '').trim().toLowerCase();
        const catStr = String(args.category || '').trim().toLowerCase();
        const stu =
          data.students.find((s) => s.code.trim().toLowerCase() === codeStr) ||
          data.students.find((s) => s.name.trim().toLowerCase().includes(codeStr));
        const priceObj =
          data.prices.find((p) => p.cat.trim().toLowerCase() === catStr) ||
          data.prices.find((p) => p.cat.trim().toLowerCase().includes(catStr));
        if (stu && priceObj) {
          const discount = Math.max(0, Number(args.discount || 0) || 0);
          const pay = Math.max(0, Number(priceObj.price || 0) - discount);
          const paid =
            typeof args.paid === 'number' && Number.isFinite(args.paid)
              ? Math.max(0, args.paid)
              : pay;
          const nextNum = data.jobs.length + 1;
          const jobNo = `JB-${String(nextNum).padStart(4, '0')}`;
          const newJob = {
            date: today,
            no: jobNo,
            sid: stu.code,
            sname: stu.name,
            cat: priceObj.cat,
            pay,
            discount,
            paid,
            verificationMethod: 'supervisor' as const,
            note: String(args.note || 'Issued via itttc chat AI').trim(),
          };
          await onAddRecord('jobs', newJob);
          await onLogAudit?.('AI Issue Job', 'Jobs', `${jobNo} - ${stu.code} (${priceObj.cat})`);
          const slip = buildJobSlipFromEntry({ ...newJob, id: jobNo, ownerId: stu.ownerId || 'local' });
          if (args.printSlip === true) {
            onPrintSlip(slip);
          }
          buttons.push({
            label: bn ? `টোকেন স্লিপ (${jobNo})` : `Token Slip (${jobNo})`,
            tone: 'primary',
            onClick: () => onPrintSlip(slip),
          });
        }
      } else if (act.name === 'add_cashbook_entry' && onAddRecord) {
        const amt = Math.max(0, Number(args.amt || 0) || 0);
        const type = args.type === 'out' ? 'out' : 'in';
        const note = String(args.note || '').trim();
        if (amt > 0 && note) {
          await onAddRecord('cash', {
            date: String(args.date || '').trim() || today,
            type,
            category: String(args.category || (type === 'in' ? 'Income' : 'Expense')).trim(),
            amt,
            note,
          });
          await onLogAudit?.('AI Cashbook Entry', 'Cashbook', `${type.toUpperCase()} ৳${amt} - ${note}`);
          buttons.push({
            label: bn ? 'ক্যাশবুক দেখুন' : 'View Cashbook',
            tone: 'primary',
            onClick: () => onNavigate('cash'),
          });
        }
      } else if (act.name === 'manage_job_price_or_limit') {
        const catName = String(args.category || '').trim();
        if (catName) {
          const ordered = sortJobPrices(data.prices);
          const existing =
            ordered.find((p) => p.cat.trim().toLowerCase() === catName.toLowerCase()) ||
            ordered.find((p) => p.cat.trim().toLowerCase().includes(catName.toLowerCase()));
          if (existing && onUpdateRecord) {
            const idx = ordered.findIndex((p) => p.id === existing.id);
            const protectedCat = isProtectedDefaultPrice(existing, idx);
            await onUpdateRecord('prices', existing.id, {
              ...(typeof args.price === 'number' && Number.isFinite(args.price)
                ? { price: Math.max(0, args.price) }
                : {}),
              ...(typeof args.limit === 'number' && Number.isFinite(args.limit)
                ? { limit: Math.max(1, Math.round(args.limit)) }
                : {}),
              ...(typeof args.active === 'boolean' && !protectedCat
                ? { active: args.active }
                : {}),
            });
            await onLogAudit?.('AI Update Price/Limit', 'Prices', `${existing.cat}`);
          } else if (onAddRecord) {
            await onAddRecord('prices', {
              cat: catName,
              price: Math.max(0, Number(args.price || 500) || 500),
              limit: Math.max(1, Number(args.limit || 10) || 10),
              active: args.active !== false,
            });
            await onLogAudit?.('AI Add Category', 'Prices', catName);
          }
          buttons.push({
            label: bn ? 'প্রাইস ও লিমিট' : 'Job Prices',
            tone: 'primary',
            onClick: () => onNavigate('prices'),
          });
        }
      } else if (act.name === 'add_operational_record' && onAddRecord) {
        const col = String(args.collection || '').trim();
        const name = String(args.name || '').trim();
        if (name && ['staff', 'companies', 'store', 'returns', 'docs'].includes(col)) {
          if (col === 'staff') {
            await onAddRecord('staff', {
              date: today,
              name,
              role: String(args.role || 'Staff').trim(),
              phone: String(args.phone || '').trim(),
              salary: Math.max(0, Number(args.amount || 0) || 0),
              paid: 0,
            });
          } else if (col === 'companies') {
            await onAddRecord('companies', {
              date: today,
              name,
              country: String(args.country || 'Saudi Arabia').trim(),
              phone: String(args.phone || '').trim(),
              note: String(args.note || '').trim(),
            });
          } else if (col === 'store') {
            await onAddRecord('store', {
              date: today,
              item: name,
              category: String(args.cat || 'Consumable').trim(),
              qty: Math.max(0, Number(args.qty || 1) || 1),
              unit: String(args.unit || 'pcs').trim(),
              min: 5,
            });
          } else if (col === 'returns') {
            await onAddRecord('returns', {
              date: today,
              no: String(args.code || `RET-${data.returns.length + 1}`).trim(),
              code: String(args.code || '').trim(),
              sname: name,
              cat: String(args.cat || '').trim(),
              reason: String(args.reason || args.note || 'Retrain').trim(),
              act: 'Retrain',
              fee: Math.max(0, Number(args.amount || 0) || 0),
            });
          } else if (col === 'docs') {
            await onAddRecord('docs', {
              date: today,
              who: name,
              title: String(args.title || 'Passport & Docs').trim(),
              docNo: String(args.code || '').trim(),
              phone: String(args.phone || '').trim(),
              note: String(args.note || '').trim(),
            });
          }
          buttons.push({
            label: bn ? 'পৃষ্ঠা খুলুন' : `Open ${col}`,
            tone: 'primary',
            onClick: () => onNavigate(col as NavKey),
          });
        }
      } else if (act.name === 'update_center_profile' && onUpdateCenterSettings) {
        await onUpdateCenterSettings({
          ...(typeof args.name === 'string' && args.name.trim() ? { name: args.name.trim() } : {}),
          ...(typeof args.subtitle === 'string' ? { subtitle: args.subtitle.trim() } : {}),
          ...(typeof args.address === 'string' ? { address: args.address.trim() } : {}),
          ...(typeof args.phone === 'string' ? { phone: args.phone.trim() } : {}),
          ...(typeof args.slipFooter === 'string' ? { slipFooter: args.slipFooter.trim() } : {}),
        });
      } else if (act.name === 'sync_cloud_data') {
        const actionType = String(args.action || '').trim();
        if (actionType === 'mega_upload' && onSyncMegaNow) {
          await onSyncMegaNow();
        } else if (actionType === 'mega_pull' && onPullMegaNow) {
          await onPullMegaNow();
        } else if (actionType === 'verify_cloud' && onVerifyCloudSync) {
          await onVerifyCloudSync();
        }
      } else if (act.name === 'navigate_to_page') {
        const rawPage = String(args.page || '').trim() as NavKey;
        const cat = args.categoryFilter ? String(args.categoryFilter).trim() : undefined;
        const inactiveFilter = args.inactiveFilter
          ? (String(args.inactiveFilter).trim() as InactiveFilterPreset)
          : undefined;
        if (rawPage === 'generalAccounts' && args.unlockGeneralAccounts === true) {
          onUnlockGeneralAccounts?.(true);
        }
        if (rawPage === 'inactive' && inactiveFilter && onOpenInactiveStudents) {
          onOpenInactiveStudents(inactiveFilter);
          buttons.push({
            label: bn ? 'ইনঅ্যাক্টিভ ছাত্র তালিকা' : 'Inactive Students',
            tone: 'primary',
            onClick: () => onOpenInactiveStudents(inactiveFilter),
          });
        } else if (allowedPages.has(rawPage)) {
          onNavigate(rawPage, cat);
          buttons.push({
            label: bn
              ? rawPage === 'generalAccounts'
                ? 'GENERAL ACCOUNTS খুলুন'
                : `পৃষ্ঠা খুলুন (${rawPage})`
              : `Open ${rawPage}`,
            tone: 'primary',
            onClick: () => {
              if (rawPage === 'generalAccounts') onUnlockGeneralAccounts?.(true);
              onNavigate(rawPage, cat);
            },
          });
        }
      } else if (act.name === 'add_general_account_entry' && onAddRecord) {
        const gaRows = data.generalAccounts || [];
        const todayDot = today.replace(/-/g, '.');
        const ledger = buildGeneralAccountsLedger(gaRows, todayDot);
        const targetDate = normalizeToDotDate(
          String(args.date || '').trim(),
          ledger.latestDate || todayDot
        );
        const entryModeRaw = String(args.entryMode || 'expense').trim().toLowerCase();
        const modeVal: EntryMode =
          entryModeRaw === 'income' ? 'income' : entryModeRaw === 'bank' ? 'bank' : 'expense';
        const accRaw = String(args.account || 'Cash').trim().toLowerCase();
        const account: AccountKind =
          accRaw === 'bank' ? 'Bank' : accRaw === 'bkash' ? 'Bkash' : 'Cash';
        const rawAmt = parseAccountNum(args.amount);
        const absAmt = Math.abs(rawAmt);
        const isBankAccount = account === 'Bank' || account === 'Bkash';
        const isNegativeBankDeduction = isBankAccount && rawAmt < 0;
        const khataNo = String(args.khataNo || '').trim();
        const matchedStu = khataNo
          ? data.students.find((s) => s.code.trim().toLowerCase() === khataNo.toLowerCase())
          : undefined;
        let desc = cleanDisplayPurpose(String(args.description || '').trim());
        if (matchedStu && !desc.toLowerCase().includes(matchedStu.name.toLowerCase())) {
          desc = desc ? `${matchedStu.name}-${desc}` : matchedStu.name;
        }
        if (desc && absAmt > 0 && (isBankAccount || rawAmt > 0)) {
          const voucher = String(args.voucher || '').trim();
          let incSrc = '';
          let incCash = 0;
          let incBank = 0;
          let expSrc = '';
          let expAmt = 0;
          if (modeVal === 'income') {
            if (isNegativeBankDeduction) {
              incBank = rawAmt;
              expSrc = `[${account}] ${desc}`;
            } else {
              incSrc = desc;
              if (account === 'Cash') incCash = absAmt;
              else incBank = absAmt;
            }
          } else if (modeVal === 'expense') {
            expSrc = `[${account}] ${desc}`;
            if (isNegativeBankDeduction) {
              incBank = rawAmt;
              expAmt = 0;
            } else {
              expAmt = absAmt;
            }
          } else {
            if (isBankAccount) {
              if (isNegativeBankDeduction) {
                incBank = rawAmt;
                expSrc = `[${account}] ${desc}`;
                expAmt = 0;
              } else {
                incSrc = `${account} ডিপোজিট: ${desc}`;
                incBank = absAmt;
                expSrc = `${account} ডিপোজিট`;
                expAmt = absAmt;
              }
            } else {
              incSrc = `উত্তোলন: ${desc}`;
              incCash = absAmt;
            }
          }

          const maxOrder = gaRows.reduce((m, r) => Math.max(m, r.rowOrder || 0), 0);
          await onAddRecord('generalAccounts', {
            rowOrder: maxOrder + 1,
            isOpening: false,
            date: targetDate,
            inDesc: serializeInDesc(voucher, incSrc, account, matchedStu?.code || khataNo),
            inCash: incCash !== 0 ? String(incCash) : '',
            inBank: incBank !== 0 ? String(incBank) : '',
            outDesc: expSrc,
            outCash: expAmt !== 0 ? String(expAmt) : '',
          });

          if (modeVal === 'income' && !isNegativeBankDeduction && matchedStu && onUpdateRecord) {
            const nextDeposit = Number(matchedStu.deposit || 0) + absAmt;
            const parsedDt = parseRowDateParts(targetDate);
            const cashDate = parsedDt
              ? `${String(parsedDt.day).padStart(2, '0')}-${String(parsedDt.month).padStart(2, '0')}-${parsedDt.year}`
              : targetDate.replace(/\./g, '-');
            await onUpdateRecord('students', matchedStu.id, { deposit: nextDeposit });
            await onAddRecord('cash', {
              date: cashDate,
              type: 'in',
              category: 'Course Deposit',
              amt: absAmt,
              note: `Course Fee: ${matchedStu.name} (${matchedStu.code}) | Ref: ${voucher} | Method: ${account} | Purpose: ${desc}`.slice(
                0,
                245
              ),
            });
          }

          await onLogAudit?.(
            'AI_ADD_GENERAL_ACCOUNT',
            'GENERAL ACCOUNTS',
            `${targetDate} [${voucher}] ${modeVal}: ${desc} (৳${isNegativeBankDeduction ? rawAmt : absAmt})`
          );
          buttons.push({
            label: bn ? 'GENERAL ACCOUNTS খুলুন' : 'Open GENERAL ACCOUNTS',
            tone: 'primary',
            onClick: () => {
              onUnlockGeneralAccounts?.(true);
              onNavigate('generalAccounts');
            },
          });
        }
      } else if (act.name === 'update_general_account_entry' && onUpdateRecord) {
        const gaRows = data.generalAccounts || [];
        const todayDot = today.replace(/-/g, '.');
        const ledger = buildGeneralAccountsLedger(gaRows, todayDot);
        const rowId = String(args.rowId || '').trim();
        const vQuery = String(args.voucher || '').trim().toLowerCase();
        const dQuery = args.matchDate ? canonicalDateKey(String(args.matchDate)) : '';
        const tQuery = String(args.matchText || '').trim().toLowerCase();

        const targetParsed =
          (rowId && ledger.txRows.find((r) => r.raw.id === rowId)) ||
          (vQuery && ledger.txRows.find((r) => r.voucher.toLowerCase() === vQuery)) ||
          ledger.txRows.find((r) => {
            if (dQuery && r.dateKey !== dQuery) return false;
            if (!tQuery) return Boolean(dQuery);
            const hay = `${r.incSrc} ${r.expSrc} ${r.raw.inDesc} ${r.raw.outDesc}`.toLowerCase();
            return hay.includes(tQuery);
          });

        if (targetParsed) {
          const patch: Record<string, unknown> = {};
          if (typeof args.newDate === 'string' && args.newDate.trim()) {
            patch.date = normalizeToDotDate(args.newDate.trim(), targetParsed.date);
          }
          if (typeof args.inDesc === 'string') patch.inDesc = args.inDesc.trim().slice(0, 195);
          if (typeof args.inCash === 'string') {
            const n = parseAccountNum(args.inCash);
            patch.inCash = args.inCash.trim() && n !== 0 ? String(n) : '';
          }
          if (typeof args.outDesc === 'string') patch.outDesc = args.outDesc.trim().slice(0, 195);

          const nextOutDesc = String(patch.outDesc ?? targetParsed.raw.outDesc ?? '');
          const isBankLikeRow =
            targetParsed.account === 'Bank' ||
            targetParsed.account === 'Bkash' ||
            /(?:\[?(?:bank|bkash)\]?|ব্যাংক|বিকাশ)/i.test(nextOutDesc);

          if (typeof args.inBank === 'string') {
            const n = parseAccountNum(args.inBank);
            patch.inBank = args.inBank.trim() && n !== 0 ? String(n) : '';
          }
          if (typeof args.outCash === 'string') {
            const n = parseAccountNum(args.outCash);
            if (n < 0 && isBankLikeRow) {
              patch.inBank = String(n);
              patch.outCash = '';
            } else {
              patch.outCash = args.outCash.trim() && n !== 0 ? String(n) : '';
            }
          }

          await onUpdateRecord('generalAccounts', targetParsed.raw.id, patch);
          await onLogAudit?.(
            'AI_UPDATE_GENERAL_ACCOUNT',
            'GENERAL ACCOUNTS',
            `Updated row ${targetParsed.raw.id} (${targetParsed.date})`
          );
          buttons.push({
            label: bn ? 'GENERAL ACCOUNTS দেখুন' : 'View GENERAL ACCOUNTS',
            tone: 'primary',
            onClick: () => {
              onUnlockGeneralAccounts?.(true);
              onNavigate('generalAccounts');
            },
          });
        }
      } else if (act.name === 'delete_general_account_entry' && onDeleteRecord) {
        const gaRows = data.generalAccounts || [];
        const todayDot = today.replace(/-/g, '.');
        const ledger = buildGeneralAccountsLedger(gaRows, todayDot);
        const rowId = String(args.rowId || '').trim();
        const vQuery = String(args.voucher || '').trim().toLowerCase();
        const dQuery = args.matchDate ? canonicalDateKey(String(args.matchDate)) : '';
        const tQuery = String(args.matchText || '').trim().toLowerCase();

        const targetParsed =
          (rowId && ledger.txRows.find((r) => r.raw.id === rowId)) ||
          (vQuery && ledger.txRows.find((r) => r.voucher.toLowerCase() === vQuery)) ||
          ledger.txRows.find((r) => {
            if (dQuery && r.dateKey !== dQuery) return false;
            if (!tQuery) return false;
            const hay = `${r.incSrc} ${r.expSrc} ${r.raw.inDesc} ${r.raw.outDesc}`.toLowerCase();
            return hay.includes(tQuery);
          });

        if (targetParsed) {
          await onDeleteRecord('generalAccounts', targetParsed.raw.id);
          await onLogAudit?.(
            'AI_DELETE_GENERAL_ACCOUNT',
            'GENERAL ACCOUNTS',
            `Deleted row ${targetParsed.raw.id} (${targetParsed.date})`
          );
          buttons.push({
            label: bn ? 'GENERAL ACCOUNTS খুলুন' : 'Open GENERAL ACCOUNTS',
            tone: 'primary',
            onClick: () => {
              onUnlockGeneralAccounts?.(true);
              onNavigate('generalAccounts');
            },
          });
        }
      } else if (act.name === 'manage_general_accounts_opening_and_lock') {
        const actionType = String(args.action || '').trim();
        const gaRows = data.generalAccounts || [];
        const todayDot = today.replace(/-/g, '.');
        const ledger = buildGeneralAccountsLedger(gaRows, todayDot);
        const targetDate = normalizeToDotDate(
          String(args.targetDate || '').trim(),
          ledger.latestDate || todayDot
        );
        const targetKey = canonicalDateKey(targetDate);

        if (actionType === 'unlock_and_open') {
          onUnlockGeneralAccounts?.(true);
          onNavigate('generalAccounts');
          buttons.push({
            label: bn ? 'GENERAL ACCOUNTS খুলুন' : 'Open GENERAL ACCOUNTS',
            tone: 'primary',
            onClick: () => {
              onUnlockGeneralAccounts?.(true);
              onNavigate('generalAccounts');
            },
          });
        } else if (actionType === 'lock_panel') {
          onUnlockGeneralAccounts?.(false);
        } else if (actionType === 'set_opening') {
          const cashNum = parseAccountNum(args.openingCash);
          const bankNum = parseAccountNum(args.openingBank);
          const bkashNum = parseAccountNum(args.openingBkash);
          const prevDateVal =
            String(args.prevDate || '').trim() || getPrevDotDate(targetDate);
          const curOpening = ledger.getDaySummary(targetDate).opening;
          if (curOpening.isManual && curOpening.rowId && onUpdateRecord) {
            await onUpdateRecord('generalAccounts', curOpening.rowId, {
              date: prevDateVal,
              inDesc: 'পূর্বের ব্যালেন্স',
              inCash: String(cashNum),
              inBank: String(bankNum),
              outDesc: targetDate,
              outCash: String(bkashNum),
            });
          } else if (onAddRecord) {
            await onAddRecord(
              'generalAccounts',
              {
                rowOrder: 0,
                isOpening: true,
                date: prevDateVal,
                inDesc: 'পূর্বের ব্যালেন্স',
                inCash: String(cashNum),
                inBank: String(bankNum),
                outDesc: targetDate,
                outCash: String(bkashNum),
              },
              `ga_open_${targetKey}`
            );
          }
          await onLogAudit?.(
            'AI_SAVE_OPENING_BALANCE',
            'GENERAL ACCOUNTS',
            `${targetDate} opening (Cash: ${cashNum}, Bank: ${bankNum}, Bkash: ${bkashNum})`
          );
          buttons.push({
            label: bn ? 'GENERAL ACCOUNTS দেখুন' : 'View GENERAL ACCOUNTS',
            tone: 'primary',
            onClick: () => {
              onUnlockGeneralAccounts?.(true);
              onNavigate('generalAccounts');
            },
          });
        } else if (actionType === 'lock_date' && onAddRecord) {
          if (!ledger.lockedDateKeys.has(targetKey)) {
            await onAddRecord(
              'generalAccounts',
              {
                rowOrder: 0,
                isOpening: false,
                date: targetDate,
                inDesc: DAY_LOCK_MARKER,
                inCash: '',
                inBank: '',
                outDesc: 'LOCKED',
                outCash: '',
              },
              `ga_lock_${targetKey}`
            );
            await onLogAudit?.('AI_LOCK_GA_DATE', 'GENERAL ACCOUNTS', targetDate);
          }
        } else if (actionType === 'unlock_date' && onDeleteRecord) {
          const lockRow = ledger.lockedDateKeys.get(targetKey);
          if (lockRow) {
            await onDeleteRecord('generalAccounts', lockRow.id);
            await onLogAudit?.('AI_UNLOCK_GA_DATE', 'GENERAL ACCOUNTS', targetDate);
          }
        } else if (actionType === 'set_passcode' && onUpdateCenterSettings) {
          const nextPass = String(args.newPasscode || '').trim();
          if (nextPass) {
            await onUpdateCenterSettings({ generalAccountsPass: nextPass });
            await onLogAudit?.(
              'AI_CHANGE_GA_PASSCODE',
              'GENERAL ACCOUNTS',
              'Updated General Accounts passcode via itttc chat'
            );
          }
        }
      } else if (act.name === 'open_new_job_modal') {
        const code = String(args.studentCode || '').trim();
        const category = args.category ? String(args.category).trim() : undefined;
        if (code && onOpenIssueJobForStudent) {
          const matched = data.students.find(
            (s) => s.code.trim().toLowerCase() === code.toLowerCase()
          );
          if (matched) {
            onOpenIssueJobForStudent(matched.code);
            buttons.push({
              label: bn ? `জব ফর্ম (${matched.code})` : `Issue Job (${matched.code})`,
              tone: 'primary',
              onClick: () => onOpenIssueJobForStudent(matched.code),
            });
            continue;
          }
        }
        onOpenNewJob(category);
        buttons.push({
          label: bn ? 'নতুন জব ফর্ম' : 'New Job Form',
          tone: 'primary',
          onClick: () => onOpenNewJob(category),
        });
      } else if (act.name === 'open_register_student_modal') {
        onOpenAddStudent();
        buttons.push({
          label: bn ? 'স্টুডেন্ট নিবন্ধন ফর্ম' : 'Register Student Form',
          tone: 'primary',
          onClick: () => onOpenAddStudent(),
        });
      } else if (act.name === 'open_student_profile' && onOpenStudentProfile) {
        const code = String(args.studentCode || '').trim();
        const matched = data.students.find(
          (s) => s.code.trim().toLowerCase() === code.toLowerCase()
        );
        if (matched) {
          onOpenStudentProfile(matched.code);
          buttons.push({
            label: bn ? `প্রোফাইল (${matched.code})` : `Profile (${matched.code})`,
            tone: 'primary',
            onClick: () => onOpenStudentProfile(matched.code),
          });
        }
      }
    }

    return buttons;
  };

  const sendChat = async (rawText: string) => {
    const trimmed = rawText.trim();
    if (!trimmed || chatBusy) {
      setCmdOpen(true);
      return;
    }

    const stamp = Date.now();
    const userMsg: ChatMessage = {
      id: `u-${stamp}-${Math.random().toString(36).slice(2, 6)}`,
      sender: 'user',
      text: trimmed,
    };

    const nextHistory = [...chatMessages, userMsg];
    setChatMessages(nextHistory);
    setCmdInput('');
    if (chatTextareaRef.current) {
      chatTextareaRef.current.style.height = 'auto';
    }
    setShowChatHistory(false);
    setCmdOpen(true);

    const localMatch = matchLocalCommand(trimmed);
    if (localMatch) {
      const aiMsg: ChatMessage = {
        id: `a-${stamp}-${Math.random().toString(36).slice(2, 6)}`,
        sender: 'ai',
        ...localMatch,
      };
      setChatMessages((prev) => [...prev, aiMsg]);
      return;
    }

    setChatBusy(true);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 50000);
    try {
      const apiMessages = nextHistory
        .filter((m) => !m.id.startsWith('a-err-') && !m.id.startsWith('a-net-'))
        .map((m) => ({
          role: m.sender === 'user' ? ('user' as const) : ('model' as const),
          text: m.title ? `${m.title}\n${m.text}` : m.text,
        }));
      const res = await fetch('/api/itttc-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          messages: apiMessages,
          centerSummary: buildCenterSnapshotForAi(trimmed),
          lang,
        }),
      });
      const rawBody = await res.text();
      const trimmedBody = rawBody.trim();
      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      const returnedHtmlOrProxy =
        (res.redirected && res.url.includes('__cookie_check')) ||
        trimmedBody.startsWith('<') ||
        trimmedBody.toLowerCase().includes('<!doctype') ||
        trimmedBody.includes('__cookie_check');

      let payload: {
        ok?: boolean;
        reply?: string;
        error?: string;
        clientActions?: Array<{ name?: string; args?: Record<string, unknown> }>;
      } = {};
      if (!returnedHtmlOrProxy && trimmedBody) {
        try {
          payload = JSON.parse(trimmedBody) as typeof payload;
        } catch {
          payload = {};
        }
      }

      if (!res.ok || returnedHtmlOrProxy || !payload.ok || !payload.reply) {
        const powerFallback = tryLocalPowerCommandFallback(trimmed);
        if (powerFallback) {
          setChatMessages((prev) => [
            ...prev,
            {
              id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              sender: 'ai',
              ...powerFallback,
            },
          ]);
          return;
        }
        const isStaticUnavailable =
          res.status === 404 ||
          res.status === 405 ||
          returnedHtmlOrProxy ||
          (!contentType.includes('application/json') && (!trimmedBody || !payload.error));
        const errText = isStaticUnavailable
          ? bn
            ? 'এই শেয়ার প্রিভিউ লিংকে (ais-pre) ব্যাকএন্ড Gemini AI সার্ভার চালু নেই, তাই বিস্তারিত AI উত্তর শুধুমাত্র Dev লিংক বা Cloud Run Publish লিংকে কাজ করে। তবে কালার/থিম/এনিমেশন পরিবর্তন, খাতা নম্বর সার্চ (যেমন 17/1), ডিউ লিস্ট, আজকের কালেকশন ও ফর্ম খোলার কমান্ড এখানেই কাজ করবে:'
            : 'Open-ended Gemini AI chat requires the full-stack server (Dev link or Cloud Run Publish), which is not attached to this static Share preview. All instant ITTC lookups, color/animation changes, & commands work right here:'
          : payload.error ||
            (bn
              ? `AI সার্ভার থেকে উত্তর পাওয়া যায়নি (${res.status})। একটু পর আবার চেষ্টা করুন।`
              : `Unable to reach itttc chat AI service (${res.status}). Please try again.`);
        setChatMessages((prev) => [
          ...prev,
          {
            id: `a-err-${Date.now()}`,
            sender: 'ai',
            tone: 'warn',
            text: errText,
            actions: isStaticUnavailable
              ? [
                  {
                    label: bn ? 'আজকের কালেকশন' : 'Today Collection',
                    tone: 'primary',
                    onClick: () => void sendChat('today collection'),
                  },
                  {
                    label: bn ? 'ডিউ লিস্ট' : 'Due List',
                    tone: 'secondary',
                    onClick: () => void sendChat('due list'),
                  },
                  {
                    label: bn ? 'আজকের জব' : "Today's Jobs",
                    tone: 'secondary',
                    onClick: () => void sendChat('today jobs'),
                  },
                  {
                    label: bn ? 'নতুন জব ফর্ম' : 'New Job',
                    tone: 'secondary',
                    onClick: () => {
                      setCmdOpen(false);
                      onOpenNewJob();
                    },
                  },
                  {
                    label: bn ? 'ছাত্র ভর্তি' : 'Register Student',
                    tone: 'secondary',
                    onClick: () => {
                      setCmdOpen(false);
                      onOpenAddStudent();
                    },
                  },
                ]
              : undefined,
          },
        ]);
        return;
      }

      const actionButtons = await executeAiClientActions(payload.clientActions);

      setChatMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          sender: 'ai',
          tone: actionButtons.length > 0 ? 'success' : 'info',
          text: payload.reply!,
          actions: actionButtons.length > 0 ? actionButtons : undefined,
        },
      ]);
    } catch (err) {
      const powerFallback = tryLocalPowerCommandFallback(trimmed);
      if (powerFallback) {
        setChatMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            sender: 'ai',
            ...powerFallback,
          },
        ]);
        return;
      }
      const isAbort = err instanceof DOMException && err.name === 'AbortError';
      setChatMessages((prev) => [
        ...prev,
        {
          id: `a-net-${Date.now()}`,
          sender: 'ai',
          tone: 'warn',
          text: isAbort
            ? bn
              ? 'AI উত্তর দিতে বেশি সময় নিচ্ছে। অনুগ্রহ করে আবার পাঠান।'
              : 'itttc chat timed out while waiting for a reply. Please try again.'
            : bn
              ? 'নেটওয়ার্ক সংযোগে সমস্যা হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।'
              : 'Network error while contacting itttc chat. Please try again.',
        },
      ]);
    } finally {
      window.clearTimeout(timeoutId);
      setChatBusy(false);
    }
  };

  const startNewChat = () => {
    upsertCurrentSessionToHistory(chatMessages, activeSessionId);
    resetActiveChatBox();
    setCmdOpen(true);
  };

  const loadHistorySession = (session: ChatSession) => {
    upsertCurrentSessionToHistory(chatMessages, activeSessionId);
    setChatMessages(
      session.messages.map((m) => ({
        id: m.id,
        sender: m.sender,
        title: m.title,
        text: m.text,
        tone: m.tone,
      }))
    );
    setActiveSessionId(session.id);
    setShowChatHistory(false);
    setCmdInput('');
  };

  const deleteHistorySession = (sessionId: string) => {
    setChatHistory((prev) => {
      const next = prev.filter((s) => s.id !== sessionId);
      persistChatHistory(next);
      return next;
    });
    if (activeSessionId === sessionId) {
      setActiveSessionId(null);
    }
  };

  const clearAllHistory = () => {
    setChatHistory([]);
    persistChatHistory([]);
    setActiveSessionId(null);
  };

  const handleCommandSubmit = (e: FormEvent) => {
    e.preventDefault();
    void sendChat(cmdInput);
  };

  const handleChatTextareaKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendChat(cmdInput);
    }
  };

  return (
    <div className="space-y-4 lg:space-y-0 lg:flex-1 lg:min-h-0 lg:flex lg:flex-col lg:gap-3.5">
      {/* 1. FIXED / NON-SCROLLING HERO WELCOME BANNER */}
      <div className="relative z-20 shrink-0">
        <section
          className="mg-aurora-bg mg-bento-in rounded-[15px] border border-[var(--cg-primary)]/35 px-5 py-3.5 sm:px-[22px] sm:py-4 text-white shadow-[0_18px_40px_-15px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.08)]"
          style={{ animationDelay: '0.04s' }}
        >
          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-4 min-w-0">
              <div className="relative w-[54px] h-[54px] rounded-[14px] bg-[var(--cg-primary-soft)] border border-[var(--cg-primary)]/40 flex items-center justify-center shrink-0">
                <div
                  aria-hidden="true"
                  className="brand-ring-spin pointer-events-none absolute w-[46px] h-[46px] rounded-full border-[1.5px] border-dashed border-white/45"
                />
                <SyncedRoundLogo
                  size={38}
                  logoDataUrl={appearance.logoDataUrl}
                  alt="Institute Logo"
                />
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[11.5px] text-[var(--cg-highlight)] font-semibold mb-0.5">
                  <span>{bn ? 'ড্যাশবোর্ড ওভারভিউ' : 'Dashboard Overview'}</span>
                  <span aria-hidden="true">·</span>
                  <span>itttc chat</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono-num">{today}</span>
                  <button
                    type="button"
                    onClick={() => onNavigate('dash')}
                    aria-label="Refresh summary"
                    className="p-0.5 rounded-md hover:bg-white/10 text-slate-200 hover:text-white transition-colors cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" />
                  </button>
                </div>
                <h2 className="font-display text-base sm:text-[18px] font-extrabold text-white leading-tight uppercase text-balance">
                  {heroTitleText}
                </h2>
                <p className="text-[11.5px] text-slate-300/90 mt-0.5 truncate">{heroSubtitleText}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={() => {
                  if (cmdOpen) {
                    closeChatDrawer();
                  } else {
                    openFreshChatDrawer();
                  }
                }}
                className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-[9px] bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 text-white text-[12.5px] font-bold shadow-[0_8px_22px_-6px_rgba(99,102,241,0.65)] transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] whitespace-nowrap cursor-pointer ${
                  cmdOpen ? 'ring-2 ring-blue-300/80' : ''
                }`}
              >
                <Sparkles className="w-3.5 h-3.5 shrink-0" />
                <span>itttc chat</span>
              </button>
              <button
                type="button"
                onClick={() => onOpenNewJob()}
                className="mg-sweep-btn inline-flex items-center gap-1.5 px-4 py-2 rounded-[9px] bg-[var(--cg-primary)] hover:bg-[var(--accent-dark)] text-[#042019] text-[12.5px] font-bold shadow-[0_8px_20px_-8px_var(--accent-glow)] transition-transform duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] whitespace-nowrap cursor-pointer"
              >
                <Plus className="w-4 h-4 shrink-0 stroke-[2.5]" />
                <span>{bn ? 'নতুন স্টুডেন্ট জব' : 'New Student Job'}</span>
              </button>
              <button
                type="button"
                onClick={onOpenAddStudent}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[9px] bg-white/[0.06] hover:bg-white/[0.13] border border-white/20 hover:border-white/35 backdrop-blur-md text-slate-100 text-[12.5px] font-bold transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] whitespace-nowrap cursor-pointer"
              >
                <UserPlus className="w-3.5 h-3.5 shrink-0" />
                <span>{bn ? 'স্টুডেন্ট নিবন্ধন' : 'Register Student'}</span>
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* Scrollable Inner Content Frame (KPIs + Summary + Recent Jobs) */}
      <div className="lg:flex-1 lg:min-h-0 lg:overflow-y-auto no-scrollbar rounded-[12px] border border-slate-300/80 dark:border-slate-300/20 bg-white/50 dark:bg-[#0b1220]/60 p-3.5 sm:p-4 space-y-4">
      {/* 2. 6 KPI METRIC CARDS */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        {stats.map((st, idx) => {
          const Icon = st.icon;
          return (
            <div
              key={st.label}
              style={{ animationDelay: `${0.08 + idx * 0.04}s` }}
              className={`mg-bento-in mg-spring-card mg-spotlight group rounded-[13px] p-3.5 sm:px-[15px] sm:py-3.5 flex flex-col justify-between ${st.cardTone}`}
            >
              <div className="relative z-10 flex items-center justify-between gap-2 mb-2.5">
                <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 leading-snug">
                  {st.label}
                </span>
                <span
                  className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-3 ${st.iconTone}`}
                >
                  <Icon className="w-3.5 h-3.5" />
                </span>
              </div>
              <div className="relative z-10 font-mono-num text-[19px] font-bold tracking-[-0.4px] text-slate-900 dark:text-white truncate">
                <KineticCounter target={st.target} prefix={st.prefix} />
              </div>
            </div>
          );
        })}
      </section>

      {/* 3. MIDDLE SECTION: TODAY'S CATEGORY JOB SUMMARY + QUICK ACTIONS */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-stretch">
        <div
          className="mg-bento-in mg-spring-card lg:col-span-8 rounded-[14px] p-4 sm:px-[18px] sm:py-4 flex flex-col justify-between"
          style={{ animationDelay: '0.32s' }}
        >
          <div>
            <div className="flex items-start justify-between gap-3 mb-3.5">
              <div>
                <h3 className="font-display text-[14.5px] font-bold text-slate-900 dark:text-white">
                  {bn ? 'আজকের ক্যাটাগরি অনুযায়ী জব' : "Today's Category Job Summary"}
                </h3>
                <p className="text-[11.5px] text-slate-500 dark:text-slate-400 mt-0.5">
                  {bn
                    ? 'আজকের প্র্যাকটিক্যাল টেস্ট প্লেট বণ্টন — নতুন জব নিতে ক্যাটাগরিতে ক্লিক করুন'
                    : 'Distribution of today practical test plates — click any category to issue a job'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('jobs')}
                className="group inline-flex items-center gap-1 hover:gap-2 text-[11.5px] font-bold text-[var(--accent-dark)] dark:text-[var(--accent)] transition-all whitespace-nowrap shrink-0 cursor-pointer"
              >
                <span>{bn ? 'দৈনিক রেজিস্টার' : 'Daily Register'}</span>
                <ArrowRight className="w-3.5 h-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              {categoryCounts.map((c) => {
                const active = c.count > 0;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onOpenNewJob(c.cat)}
                    className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[11px] font-bold transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 whitespace-nowrap cursor-pointer ${
                      active
                        ? 'bg-[var(--accent-soft)] border-[var(--accent)]/50 text-[var(--accent-dark)] dark:text-[var(--accent)] shadow-[0_4px_14px_-4px_var(--accent-glow)]'
                        : 'bg-slate-100/80 dark:bg-slate-800/55 border-slate-200 dark:border-slate-400/15 text-slate-700 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800/95 hover:border-slate-300 dark:hover:border-slate-400/40 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <span>{c.cat}</span>
                    <span
                      className={`font-mono-num text-[10.5px] px-1.5 py-0.5 rounded-[5px] ${
                        active
                          ? 'bg-[var(--accent)] text-[#042019] font-extrabold'
                          : 'bg-slate-200/90 dark:bg-slate-900/80 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {c.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {todayJobs.length === 0 && todayOuts.length === 0 && (
            <p className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-center text-xs text-slate-500 dark:text-slate-400">
              {bn
                ? 'আজ এখনো কোনো জব এন্ট্রি হয়নি। ট্রেনিং প্লেট রেজিস্টার করতে “নতুন স্টুডেন্ট জব” ক্লিক করুন।'
                : 'No jobs entered yet today. Click "New Student Job" or any category button above to register a training plate.'}
            </p>
          )}
        </div>

        <div
          className="mg-bento-in mg-spring-card lg:col-span-4 rounded-[14px] p-4 sm:px-[18px] sm:py-4 flex flex-col justify-between gap-3.5"
          style={{ animationDelay: '0.36s' }}
        >
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
              <div>
                <h3 className="font-display text-[14.5px] font-bold text-slate-900 dark:text-white">
                  {bn ? 'দ্রুত কাজ ও সারসংক্ষেপ' : 'Quick Actions & Summary'}
                </h3>
                <p className="text-[11.5px] text-slate-500 dark:text-slate-400 mt-0.5">
                  {bn ? 'দৈনিক শর্টকাট ও এক নজরে মূল হিসাব' : 'Daily shortcuts & at-a-glance overview'}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={summaryDateInput}
                  onChange={(e) => setSummaryDateInput(e.target.value)}
                  aria-label={bn ? 'সারসংক্ষেপের তারিখ' : 'Summary Date'}
                  className="px-2 py-1 text-[10.5px] rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-200 font-mono-num"
                />
                <button
                  type="button"
                  onClick={() => onNavigate('monthly')}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 hover:border-teal-400 text-[11px] font-bold text-teal-700 dark:text-teal-300 whitespace-nowrap cursor-pointer"
                >
                  <CalendarRange className="w-3 h-3" />
                  <span>{bn ? 'মাসিক রিপোর্ট' : 'Monthly'}</span>
                </button>
              </div>
            </div>

            {/* Moved Daily Job Register Summary Cards: TOTAL DATE JOBS & TOTAL COLLECTION */}
            <div className="grid grid-cols-2 gap-2 mb-2">
              <button
                type="button"
                onClick={() => onNavigate('jobs')}
                className="text-left rounded-lg border border-fuchsia-300/60 dark:border-fuchsia-700/50 bg-slate-900/[0.03] dark:bg-[#0d1d35] hover:border-fuchsia-400 p-2.5 transition-colors cursor-pointer"
              >
                <div className="text-[10.5px] font-bold uppercase tracking-wide text-fuchsia-600 dark:text-fuchsia-400 truncate">
                  {bn ? 'তারিখের মোট জব' : 'TOTAL DATE JOBS'}
                </div>
                <div className="font-mono-num text-xl font-extrabold text-fuchsia-600 dark:text-fuchsia-400 mt-0.5">
                  <KineticCounter target={summaryDateJobs.length} />
                </div>
                <div className="text-[10px] font-mono-num text-slate-500 dark:text-slate-400 mt-0.5">
                  {summaryTargetDateDDMMYYYY}
                </div>
              </button>

              <button
                type="button"
                onClick={() => onNavigate('jobs')}
                className="text-left rounded-lg border border-teal-300/70 dark:border-teal-700/60 bg-teal-50/70 dark:bg-[#0d1d35] hover:border-teal-400 p-2.5 transition-colors cursor-pointer"
              >
                <div className="text-[10.5px] font-bold uppercase tracking-wide text-teal-700 dark:text-teal-400 truncate">
                  {bn ? 'মোট সংগ্রহ' : 'TOTAL COLLECTION'}
                </div>
                <div className="font-mono-num text-xl font-extrabold text-teal-700 dark:text-teal-300 mt-0.5">
                  <KineticCounter target={summaryDateCollection} prefix="৳" />
                </div>
                <div className="text-[10px] font-mono-num text-teal-700/80 dark:text-teal-400/80 mt-0.5">
                  {summaryTargetDateDDMMYYYY}
                </div>
              </button>
            </div>

            {/* Quick Actions Summary Overview Panel */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              <button
                type="button"
                onClick={() => onNavigate('monthly')}
                className="text-left rounded-lg border border-slate-200/90 dark:border-slate-700/70 bg-slate-50/80 dark:bg-slate-900/70 hover:border-teal-400 p-2.5 transition-colors cursor-pointer"
              >
                <div className="text-[10.5px] font-semibold text-slate-500 dark:text-slate-400 truncate">
                  {bn ? 'মোট জব গেছে (টাকা)' : 'Total Job Value'}
                </div>
                <div className="font-mono-num text-sm font-extrabold text-slate-900 dark:text-white mt-0.5">
                  {formatTaka(quickActionsSummary.totalJobAmount)}
                </div>
                <div className="text-[10px] font-mono-num text-teal-700 dark:text-teal-400 mt-0.5">
                  {quickActionsSummary.totalJobCount}{' '}
                  {bn ? 'টি জব সম্পন্ন' : 'total jobs'}
                </div>
              </button>

              <button
                type="button"
                onClick={() => onNavigate('due')}
                className="text-left rounded-lg border border-amber-200/90 dark:border-amber-800/60 bg-amber-50/60 dark:bg-amber-950/25 hover:border-amber-400 p-2.5 transition-colors cursor-pointer"
              >
                <div className="text-[10.5px] font-semibold text-amber-800 dark:text-amber-300 truncate">
                  {bn ? 'বকেয়া ছাত্র ও টাকা' : 'Due Students & Amt'}
                </div>
                <div className="font-mono-num text-sm font-extrabold text-amber-800 dark:text-amber-300 mt-0.5">
                  {formatTaka(quickActionsSummary.totalDueAmount)}
                </div>
                <div className="text-[10px] font-mono-num text-amber-700 dark:text-amber-400 mt-0.5">
                  {quickActionsSummary.dueStudentsCount}{' '}
                  {bn ? 'জন ছাত্রের ডিউ' : 'students due'}
                </div>
              </button>

              <button
                type="button"
                onClick={() =>
                  onOpenInactiveStudents
                    ? onOpenInactiveStudents('active')
                    : onNavigate('inactive')
                }
                className="text-left rounded-lg border border-emerald-200/90 dark:border-emerald-800/60 bg-emerald-50/60 dark:bg-emerald-950/20 hover:border-emerald-400 p-2.5 transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between gap-1 text-[10.5px] font-semibold text-emerald-800 dark:text-emerald-300">
                  <span className="truncate">
                    {bn ? 'রেগুলার জব ছাত্র' : 'Regular Students'}
                  </span>
                  <UserCheck className="w-3 h-3 shrink-0" />
                </div>
                <div className="font-mono-num text-sm font-extrabold text-emerald-700 dark:text-emerald-300 mt-0.5">
                  {quickActionsSummary.activeRegularStudentsCount}{' '}
                  <span className="text-[11px] font-bold">{bn ? 'জন' : 'active'}</span>
                </div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                  {bn ? 'গত ০–২ দিনে জব' : 'Job in last 0–2d'}
                </div>
              </button>

              <button
                type="button"
                onClick={() =>
                  onOpenInactiveStudents
                    ? onOpenInactiveStudents('absent_all')
                    : onNavigate('inactive')
                }
                className="text-left rounded-lg border border-rose-200/90 dark:border-rose-800/60 bg-rose-50/60 dark:bg-rose-950/20 hover:border-rose-400 p-2.5 transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between gap-1 text-[10.5px] font-semibold text-rose-800 dark:text-rose-300">
                  <span className="truncate">
                    {bn ? 'জব বন্ধ / ইনঅ্যাক্টিভ' : 'Inactive Students'}
                  </span>
                  <UserX className="w-3 h-3 shrink-0" />
                </div>
                <div className="font-mono-num text-sm font-extrabold text-rose-700 dark:text-rose-300 mt-0.5">
                  {quickActionsSummary.totalInactiveStudentsCount}{' '}
                  <span className="text-[11px] font-bold">{bn ? 'জন' : 'students'}</span>
                </div>
                <div className="text-[10px] font-mono-num text-rose-700/90 dark:text-rose-300/90 mt-0.5 truncate">
                  {bn
                    ? `৩+দি:${quickActionsSummary.inactive3to6Count} · ৭+:${quickActionsSummary.inactive7to14Count} · ১৫+:${quickActionsSummary.inactive15PlusCount} · শূন্য:${quickActionsSummary.neverTookJobCount}`
                    : `3d:${quickActionsSummary.inactive3to6Count} · 7d:${quickActionsSummary.inactive7to14Count} · 15+:${quickActionsSummary.inactive15PlusCount} · 0:${quickActionsSummary.neverTookJobCount}`}
                </div>
              </button>
            </div>

            {/* GENERAL ACCOUNTS Privacy-Blurred Summary */}
            <div className="mb-3 rounded-lg border border-emerald-500/30 dark:border-emerald-500/25 bg-emerald-50/50 dark:bg-[#091821] p-2.5">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[10.5px] font-extrabold tracking-wide uppercase text-emerald-800 dark:text-emerald-300 truncate">
                    GENERAL ACCOUNTS
                  </span>
                  <span className="text-[10px] font-mono-num px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 shrink-0">
                    {gaQuickSummary.date}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {showGaQuickSummary && (
                    <button
                      type="button"
                      onClick={() => onNavigate('generalAccounts')}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/80 hover:border-emerald-400 text-[10.5px] font-bold text-slate-700 dark:text-slate-200 cursor-pointer transition-colors"
                    >
                      <span>{bn ? 'খুলুন' : 'Open'}</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowGaQuickSummary((prev) => !prev)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold cursor-pointer transition-colors ${
                      showGaQuickSummary
                        ? 'bg-slate-200/90 dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-700'
                        : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm'
                    }`}
                  >
                    {showGaQuickSummary ? (
                      <>
                        <EyeOff className="w-3 h-3" />
                        <span>{bn ? 'লুকান' : 'Hide'}</span>
                      </>
                    ) : (
                      <>
                        <Eye className="w-3 h-3" />
                        <span>{bn ? 'ভিউ' : 'View'}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="relative">
                <div
                  className={`grid grid-cols-3 gap-1.5 transition-all duration-200 ${
                    showGaQuickSummary
                      ? 'blur-0 opacity-100'
                      : 'blur-[6px] select-none pointer-events-none opacity-80'
                  }`}
                  aria-hidden={!showGaQuickSummary}
                >
                  <div className="rounded-md border border-emerald-200/90 dark:border-emerald-700/40 bg-white/80 dark:bg-slate-900/70 px-2 py-1.5">
                    <div className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 truncate">
                      {bn ? 'টোটাল আয়' : 'Total Income'}
                    </div>
                    <div className="font-mono-num text-[13px] font-extrabold text-emerald-700 dark:text-emerald-300 mt-0.5 truncate">
                      {formatTaka(gaQuickSummary.totalIncome)}
                    </div>
                    <div className="text-[9.5px] font-mono-num text-slate-500 dark:text-slate-400 truncate">
                      {bn ? `নতুন: ${formatTaka(gaQuickSummary.newCashIn)}` : `New: ${formatTaka(gaQuickSummary.newCashIn)}`}
                    </div>
                  </div>

                  <div className="rounded-md border border-rose-200/90 dark:border-rose-700/40 bg-white/80 dark:bg-slate-900/70 px-2 py-1.5">
                    <div className="text-[10px] font-semibold text-rose-700 dark:text-rose-400 truncate">
                      {bn ? 'টোটাল ব্যয়' : 'Total Expense'}
                    </div>
                    <div className="font-mono-num text-[13px] font-extrabold text-rose-600 dark:text-rose-300 mt-0.5 truncate">
                      {formatTaka(gaQuickSummary.totalExpense)}
                    </div>
                    <div className="text-[9.5px] font-mono-num text-slate-500 dark:text-slate-400 truncate">
                      {bn ? `নগদ: ${formatTaka(gaQuickSummary.cashBalance)}` : `Cash: ${formatTaka(gaQuickSummary.cashBalance)}`}
                    </div>
                  </div>

                  <div className="rounded-md border border-sky-200/90 dark:border-sky-700/40 bg-white/80 dark:bg-slate-900/70 px-2 py-1.5">
                    <div className="text-[10px] font-semibold text-sky-700 dark:text-sky-400 truncate">
                      {bn ? 'ব্যাংক হিসাব' : 'Bank Balance'}
                    </div>
                    <div className="font-mono-num text-[13px] font-extrabold text-sky-700 dark:text-sky-300 mt-0.5 truncate">
                      {formatTaka(gaQuickSummary.totalBank)}
                    </div>
                    <div className="text-[9.5px] font-mono-num text-slate-500 dark:text-slate-400 truncate">
                      {bn ? `মোট: ${formatTaka(gaQuickSummary.grandTotal)}` : `Net: ${formatTaka(gaQuickSummary.grandTotal)}`}
                    </div>
                  </div>
                </div>

                {!showGaQuickSummary && (
                  <button
                    type="button"
                    onClick={() => setShowGaQuickSummary(true)}
                    className="absolute inset-0 flex items-center justify-center rounded-md bg-slate-900/5 dark:bg-slate-950/20 cursor-pointer group"
                    aria-label={bn ? 'GENERAL ACCOUNTS হিসাব দেখতে ভিউ-এ ক্লিক করুন' : 'Click View to reveal GENERAL ACCOUNTS summary'}
                  >
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/95 dark:bg-slate-900/95 border border-emerald-500/40 text-[11px] font-bold text-emerald-700 dark:text-emerald-300 shadow-sm group-hover:scale-105 transition-transform">
                      <Eye className="w-3.5 h-3.5" />
                      <span>{bn ? 'দেখতে ভিউ-এ ক্লিক করুন' : 'Click View to reveal'}</span>
                    </span>
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <button
              type="button"
              onClick={() => onOpenNewJob()}
              className="group w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-[10px] bg-[var(--accent-soft)] border border-[var(--accent)]/35 hover:border-[var(--accent)] text-left transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:translate-x-1 cursor-pointer"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-7 h-7 rounded-lg bg-[var(--accent)] text-[#042019] flex items-center justify-center shrink-0 font-extrabold">
                  <Plus className="w-4 h-4 stroke-[2.5]" />
                </span>
                <div className="min-w-0">
                  <div className="text-[12.5px] font-bold text-slate-900 dark:text-white truncate">
                    {bn ? 'নতুন স্টুডেন্ট জব' : 'New Student Job'}
                  </div>
                  <div className="text-[10.5px] text-slate-600 dark:text-slate-400 truncate">
                    {bn ? 'নিবন্ধিত স্টুডেন্টের টেস্ট টোকেন' : 'Issue test token for registered student'}
                  </div>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-[var(--accent-dark)] dark:text-[var(--accent)] shrink-0 transition-transform duration-200 group-hover:translate-x-1" />
            </button>

            <button
              type="button"
              onClick={onOpenOutJob}
              className="group w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-[10px] bg-amber-500/[0.08] border border-amber-500/35 hover:border-amber-500 text-left transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:translate-x-1 cursor-pointer"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-7 h-7 rounded-lg bg-amber-500 text-amber-950 flex items-center justify-center shrink-0 font-extrabold">
                  <Zap className="w-4 h-4" />
                </span>
                <div className="min-w-0">
                  <div className="text-[12.5px] font-bold text-slate-900 dark:text-white truncate">
                    {bn ? 'বাইরের স্টুডেন্ট জব' : 'Out of Student Job'}
                  </div>
                  <div className="text-[10.5px] text-slate-600 dark:text-slate-400 truncate">
                    {bn ? 'দ্রুত স্লিপ ও টেস্ট টোকেন এন্ট্রি' : 'Quick slip & test token entry'}
                  </div>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 transition-transform duration-200 group-hover:translate-x-1" />
            </button>

            <button
              type="button"
              onClick={onOpenAddStudent}
              className="group w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-[10px] bg-slate-50/90 dark:bg-slate-900/65 border border-slate-200 dark:border-slate-400/15 hover:bg-slate-100 dark:hover:bg-slate-800/70 hover:border-slate-300 dark:hover:border-slate-400/40 text-left transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:translate-x-1 cursor-pointer"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-7 h-7 rounded-lg bg-slate-200 dark:bg-slate-400/15 text-slate-800 dark:text-slate-200 flex items-center justify-center shrink-0">
                  <UserPlus className="w-4 h-4" />
                </span>
                <div className="min-w-0">
                  <div className="text-[12.5px] font-bold text-slate-900 dark:text-white truncate">
                    {bn ? 'নতুন স্টুডেন্ট যোগ করুন' : 'Add New Student'}
                  </div>
                  <div className="text-[10.5px] text-slate-600 dark:text-slate-400 truncate">
                    {bn ? 'নতুন প্রশিক্ষণার্থী ও চুক্তি নিবন্ধন' : 'Register new trainee & contract'}
                  </div>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0 transition-transform duration-200 group-hover:translate-x-1 group-hover:text-slate-900 dark:group-hover:text-white" />
            </button>
          </div>
        </div>
      </section>

      {/* 3.5 MONTHLY TOTAL REVENUE BAR CHART (STUDENT DEPOSITS) */}
      <section
        className="mg-bento-in bg-white dark:bg-[#0c1320] rounded-[14px] border border-slate-200/90 dark:border-slate-400/15 p-4 sm:px-[18px] sm:py-4 space-y-3.5"
        style={{ animationDelay: '0.39s' }}
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="w-9 h-9 rounded-xl bg-[var(--cg-primary-soft)] text-[var(--accent-dark)] dark:text-[var(--cg-primary)] flex items-center justify-center shrink-0">
              <BarChart3 className="w-4 h-4" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-display text-[14.5px] font-bold text-slate-900 dark:text-white">
                  {bn ? 'মাসিক মোট রাজস্ব (ছাত্র জমা ভিত্তিক)' : 'Monthly Total Revenue (Student Deposits)'}
                </h3>
                {revenueAnalytics.peakPoint && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--cg-primary-soft)] text-[var(--accent-dark)] dark:text-[var(--cg-primary)] text-[10.5px] font-bold">
                    <TrendingUp className="w-3 h-3" />
                    <span>
                      {bn ? 'সর্বোচ্চ:' : 'Peak:'} {revenueAnalytics.peakPoint.fullLabel} (
                      {formatTaka(revenueAnalytics.peakPoint.revenue)})
                    </span>
                  </span>
                )}
              </div>
              <p className="text-[11.5px] text-slate-500 dark:text-slate-400 mt-0.5">
                {bn
                  ? 'ছাত্রদের ভর্তি, কোর্স কিস্তি ও ডিপোজিট জমার ভিত্তিতে মাসওয়ারী মোট রাজস্ব চিত্র'
                  : 'Monthly revenue breakdown aggregated from student admission, course & deposit payments'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {revenueAnalytics.untrackedOpeningTotal > 0 && (
              <button
                type="button"
                onClick={() => setIncludeOpeningDeposits((v) => !v)}
                className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold transition-colors cursor-pointer ${
                  includeOpeningDeposits
                    ? 'bg-amber-500/15 border-amber-500/50 text-amber-700 dark:text-amber-300'
                    : 'bg-slate-50 dark:bg-slate-900/70 border-slate-200 dark:border-slate-700/70 text-slate-600 dark:text-slate-300 hover:border-slate-300'
                }`}
                title={
                  bn
                    ? 'ক্যাশবুক লেনদেন ছাড়া পূর্বের/ওপেনিং ছাত্র জমা অন্তর্ভুক্ত করুন'
                    : 'Include prior/opening student deposit balances without cashbook receipts'
                }
              >
                {includeOpeningDeposits
                  ? bn
                    ? `ওপেনিং সহ (${formatTaka(revenueAnalytics.untrackedOpeningTotal)})`
                    : `With Opening (${formatTaka(revenueAnalytics.untrackedOpeningTotal)})`
                  : bn
                    ? '+ ওপেনিং জমা'
                    : '+ Opening'}
              </button>
            )}

            <div className="px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-700/60">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {revenueRange === '6m'
                  ? bn
                    ? '৬ মাসের জমা'
                    : '6-Mo Revenue'
                  : revenueRange === '12m'
                    ? bn
                      ? '১২ মাসের জমা'
                      : '12-Mo Revenue'
                    : bn
                      ? 'সর্বমোট জমা'
                      : 'All-Time Revenue'}
              </div>
              <div className="font-mono-num text-sm font-bold text-slate-900 dark:text-white">
                {formatTaka(revenueAnalytics.rangeTotal)}
              </div>
            </div>

            <div className="inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-700/80 bg-slate-100/80 dark:bg-slate-900/80 p-0.5 text-[11px] font-bold">
              {(
                [
                  { id: '6m', label: bn ? '৬ মাস' : '6M' },
                  { id: '12m', label: bn ? '১২ মাস' : '12M' },
                  { id: 'all', label: bn ? 'সব' : 'All' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setRevenueRange(opt.id)}
                  className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                    revenueRange === opt.id
                      ? 'bg-[var(--cg-primary)] text-[#042019] shadow-xs'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => onNavigate('due')}
              className="group inline-flex items-center gap-1 text-[11.5px] font-bold text-[var(--accent-dark)] dark:text-[var(--accent)] whitespace-nowrap cursor-pointer"
            >
              <span>{bn ? 'ডিউ ও জমা' : 'Due & Deposits'}</span>
              <ArrowRight className="w-3.5 h-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
            </button>
          </div>
        </div>

        {!revenueAnalytics.hasData ? (
          <div className="h-[220px] rounded-xl border border-dashed border-slate-200 dark:border-slate-700/70 flex flex-col items-center justify-center text-center px-4">
            <BarChart3 className="w-7 h-7 text-slate-400 mb-2" />
            <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              {bn
                ? 'এখনো কোনো ছাত্রের মাসিক জমা এন্ট্রি হয়নি (৳0)।'
                : 'No monthly student deposit transactions recorded yet (৳0).'}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              {bn
                ? 'ছাত্র নিবন্ধনে প্রাথমিক জমা বা ডিউ/পেমেন্ট সংগ্রহ করলে এখানে মাসওয়ারী চার্ট দেখা যাবে।'
                : 'Collect a course/visa deposit or installment payment to visualize monthly revenue.'}
            </p>
          </div>
        ) : (
          <div className="w-full min-w-0 h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={revenueAnalytics.points}
                margin={{ top: 10, right: 12, left: 4, bottom: 2 }}
                barCategoryGap="24%"
              >
                <defs>
                  <linearGradient id="itcDepositBarGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--cg-primary)" stopOpacity={0.95} />
                    <stop offset="100%" stopColor="var(--accent-dark)" stopOpacity={0.65} />
                  </linearGradient>
                  <linearGradient id="itcDepositBarPeakGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#14b8a6" stopOpacity={1} />
                    <stop offset="100%" stopColor="var(--cg-primary)" stopOpacity={0.85} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="rgba(148, 163, 184, 0.22)"
                />
                <XAxis
                  dataKey="shortLabel"
                  tickLine={false}
                  axisLine={{ stroke: 'rgba(148, 163, 184, 0.25)' }}
                  tick={{ fill: '#64748b', fontSize: 11, fontWeight: 600 }}
                  dy={6}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={56}
                  tickFormatter={(v: number) => formatCompactTakaTick(v)}
                  tick={{ fill: '#64748b', fontSize: 11, fontWeight: 600 }}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(148, 163, 184, 0.10)', radius: 8 }}
                  content={({ active, payload }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    const pt = payload[0]?.payload as MonthlyRevenuePoint | undefined;
                    if (!pt) return null;
                    return (
                      <div className="rounded-xl border border-slate-200 dark:border-slate-700/80 bg-white/95 dark:bg-[#0c1320]/95 backdrop-blur-md shadow-xl px-3.5 py-2.5 text-xs space-y-1.5 min-w-[180px]">
                        <div className="flex items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-1">
                          <span className="font-bold text-slate-900 dark:text-white">
                            {pt.fullLabel}
                          </span>
                          {pt.isPeak && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[var(--cg-primary-soft)] text-[var(--accent-dark)] dark:text-[var(--cg-primary)]">
                              {bn ? 'সর্বোচ্চ' : 'Peak'}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-slate-500 dark:text-slate-400">
                            {bn ? 'মোট রাজস্ব' : 'Total Revenue'}
                          </span>
                          <span className="font-mono-num font-bold text-slate-900 dark:text-white">
                            {formatTaka(pt.revenue)}
                          </span>
                        </div>
                        {pt.visaDeposit > 0 && (
                          <>
                            <div className="flex items-center justify-between gap-4 text-[11px]">
                              <span className="text-slate-500 dark:text-slate-400">
                                {bn ? 'কোর্স জমা' : 'Course Deposits'}
                              </span>
                              <span className="font-mono-num font-semibold text-emerald-600 dark:text-emerald-400">
                                {formatTaka(pt.courseDeposit)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-4 text-[11px]">
                              <span className="text-slate-500 dark:text-slate-400">
                                {bn ? 'ভিসা জমা' : 'Visa Deposits'}
                              </span>
                              <span className="font-mono-num font-semibold text-violet-600 dark:text-violet-400">
                                {formatTaka(pt.visaDeposit)}
                              </span>
                            </div>
                          </>
                        )}
                        <div className="text-[10.5px] text-slate-400 pt-0.5">
                          {pt.entriesCount}{' '}
                          {bn ? 'টি জমা রেকর্ড' : pt.entriesCount === 1 ? 'deposit record' : 'deposit records'}
                        </div>
                      </div>
                    );
                  }}
                />
                <Bar
                  dataKey="revenue"
                  name={bn ? 'মোট রাজস্ব' : 'Total Revenue'}
                  radius={[7, 7, 0, 0]}
                  maxBarSize={48}
                >
                  {revenueAnalytics.points.map((entry) => (
                    <Cell
                      key={entry.key}
                      fill={
                        entry.isPeak
                          ? 'url(#itcDepositBarPeakGrad)'
                          : 'url(#itcDepositBarGrad)'
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* 4. RECENT JOB ENTRIES TABLE */}
      <section
        className="mg-bento-in bg-white dark:bg-[#0c1320] rounded-[14px] border border-slate-200/90 dark:border-slate-400/15 overflow-hidden"
        style={{ animationDelay: '0.42s' }}
      >
        <div className="px-4 sm:px-[18px] py-3.5 border-b border-slate-200/80 dark:border-slate-400/15 flex items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-[14.5px] font-bold text-slate-900 dark:text-white">
              {bn ? 'সাম্প্রতিক জব এন্ট্রি' : 'Recent Job Entries'}
            </h3>
            <p className="text-[11.5px] text-slate-500 dark:text-slate-400 mt-0.5">
              {bn
                ? 'সর্বশেষ নিবন্ধিত প্র্যাকটিক্যাল টেস্ট জব ও তাৎক্ষণিক টোকেন প্রিন্ট'
                : 'Last registered practical test jobs with instant token print'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('jobs')}
            className="text-[11.5px] font-bold text-[var(--accent-dark)] dark:text-[var(--accent)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {bn ? 'সব রেজিস্টার দেখুন' : 'View All Register'}
          </button>
        </div>

        {recentJobs.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {bn ? 'এখনো কোনো জব এন্ট্রি পাওয়া যায়নি।' : 'No job entries recorded yet.'}
            </p>
            <button
              type="button"
              onClick={() => onOpenNewJob()}
              className="mt-3 px-4 py-2 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-dark)] text-[#042019] text-xs font-bold cursor-pointer"
            >
              {bn ? '+ প্রথম জব এন্ট্রি করুন' : '+ Log First Job Entry'}
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200/80 dark:border-slate-400/15 bg-slate-50/70 dark:bg-slate-900/40 text-[10.5px] font-bold uppercase tracking-[0.5px] text-slate-500">
                  <th className="py-2.5 px-3.5">{bn ? 'তারিখ' : 'DATE'}</th>
                  <th className="py-2.5 px-3.5">{bn ? 'জব নং' : 'JOB NO'}</th>
                  <th className="py-2.5 px-3.5">{bn ? 'স্টুডেন্টের নাম' : 'STUDENT NAME'}</th>
                  <th className="py-2.5 px-3.5">{bn ? 'কোড' : 'STUDENT CODE'}</th>
                  <th className="py-2.5 px-3.5">{bn ? 'ক্যাটাগরি' : 'CATEGORY'}</th>
                  <th className="py-2.5 px-3.5 text-right">{bn ? 'ফি' : 'PAYABLE'}</th>
                  <th className="py-2.5 px-3.5 text-right">{bn ? 'অ্যাকশন' : 'ACTIONS'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-400/[0.07]">
                {recentJobs.map((job) => (
                  <tr
                    key={job.id}
                    className="mg-row-scan"
                  >
                    <td className="py-3 px-3.5 text-slate-700 dark:text-slate-200 whitespace-nowrap">
                      {job.date}
                    </td>
                    <td className="py-3 px-3.5 font-mono-num font-bold text-slate-900 dark:text-white whitespace-nowrap">
                      {job.no}
                    </td>
                    <td className="py-3 px-3.5 font-bold text-slate-900 dark:text-slate-100">
                      {job.sname}
                    </td>
                    <td className="py-3 px-3.5 font-mono-num font-bold text-teal-600 dark:text-[#2dd4bf] whitespace-nowrap">
                      {job.sid}
                    </td>
                    <td className="py-3 px-3.5 font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap">
                      {job.cat}
                    </td>
                    <td className="py-3 px-3.5 font-mono-num font-bold text-slate-900 dark:text-white text-right whitespace-nowrap">
                      {formatTaka(job.pay)}
                    </td>
                    <td className="py-3 px-3.5 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => onPrintSlip(buildJobSlipFromEntry(job))}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[7px] border border-slate-200 dark:border-slate-400/25 bg-white dark:bg-white/[0.05] hover:bg-[var(--accent)] hover:border-[var(--accent)] text-slate-700 dark:text-slate-100 hover:text-[#042019] text-[11px] font-semibold transition-all duration-200 cursor-pointer"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>{bn ? 'টোকেন' : 'Token'}</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      </div>

      {/* itttc chat Floating Drawer Window */}
      {cmdOpen && (
        <aside
          className="fixed right-4 sm:right-5 bottom-4 sm:bottom-5 z-[70] w-[410px] max-w-[calc(100vw-24px)] h-[540px] max-h-[calc(100vh-88px)] rounded-2xl bg-white dark:bg-[#0e1525] border border-slate-200 dark:border-slate-700/80 shadow-[0_20px_45px_rgba(0,0,0,0.55)] flex flex-col overflow-hidden"
          aria-label="itttc chat"
        >
          <div className="px-4 py-3 bg-gradient-to-r from-blue-600/15 via-violet-600/15 to-purple-600/15 border-b border-slate-200 dark:border-[#24324a] flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-[26px] h-[26px] rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 text-white flex items-center justify-center text-xs font-bold shadow-sm">
                ✦
              </div>
              <h3 className="text-sm font-extrabold bg-gradient-to-r from-blue-500 to-purple-500 dark:from-blue-400 dark:to-purple-400 bg-clip-text text-transparent">
                itttc chat
              </h3>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setShowChatHistory((prev) => !prev)}
                title={bn ? 'চ্যাট হিস্টরি দেখুন' : 'View chat history'}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md border text-[11px] font-semibold cursor-pointer transition-colors ${
                  showChatHistory
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : 'bg-slate-100 dark:bg-[#162033] border-slate-200 dark:border-[#2b3b55] hover:border-blue-400 text-slate-700 dark:text-slate-200'
                }`}
              >
                <History className="w-3 h-3" />
                <span>{bn ? 'হিস্টরি' : 'History'}</span>
                {chatHistory.length > 0 && (
                  <span
                    className={`px-1 rounded text-[10px] font-mono-num ${
                      showChatHistory
                        ? 'bg-white/20 text-white'
                        : 'bg-blue-500/15 text-blue-600 dark:text-blue-300'
                    }`}
                  >
                    {chatHistory.length}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={startNewChat}
                className="px-2.5 py-1 rounded-md bg-slate-100 dark:bg-[#162033] border border-slate-200 dark:border-[#2b3b55] hover:border-blue-400 text-[11px] font-semibold text-slate-700 dark:text-slate-200 cursor-pointer transition-colors"
              >
                {bn ? 'নতুন চ্যাট' : 'New Chat'}
              </button>
              <button
                type="button"
                onClick={closeChatDrawer}
                aria-label="Close itttc chat"
                className="px-2 py-1 rounded-md bg-slate-100 dark:bg-[#162033] border border-slate-200 dark:border-[#2b3b55] hover:border-slate-400 text-[11px] font-semibold text-slate-600 dark:text-slate-300 cursor-pointer transition-colors"
              >
                ✕
              </button>
            </div>
          </div>

          <div
            ref={chatScrollRef}
            className="flex-1 overflow-y-auto p-3.5 flex flex-col gap-3"
          >
            {showChatHistory ? (
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between gap-2 pb-1 border-b border-slate-200 dark:border-[#24324a]">
                  <button
                    type="button"
                    onClick={() => setShowChatHistory(false)}
                    className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 dark:text-blue-300 hover:underline cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>{bn ? 'চ্যাটে ফিরুন' : 'Back to Chat'}</span>
                  </button>
                  {chatHistory.length > 0 && (
                    <button
                      type="button"
                      onClick={clearAllHistory}
                      className="text-[11px] font-semibold text-rose-500 hover:text-rose-400 cursor-pointer"
                    >
                      {bn ? 'সব মুছুন' : 'Clear All'}
                    </button>
                  )}
                </div>

                {chatHistory.length === 0 ? (
                  <div className="rounded-xl bg-slate-50 dark:bg-[#131c2e] border border-slate-200 dark:border-[#24324a] p-6 text-center">
                    <History className="w-6 h-6 mx-auto mb-2 text-slate-400" />
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      {bn
                        ? 'এখনো কোনো পূর্বের চ্যাট হিস্টরি নেই।'
                        : 'No saved chat history yet.'}
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {chatHistory.map((session) => {
                      const timeLabel = new Date(session.updatedAt).toLocaleString(
                        bn ? 'bn-BD' : 'en-US',
                        {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        }
                      );
                      const isCurrent = session.id === activeSessionId;
                      return (
                        <div
                          key={session.id}
                          onClick={() => loadHistorySession(session)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              loadHistorySession(session);
                            }
                          }}
                          className={`group flex items-start justify-between gap-2 p-2.5 rounded-xl border cursor-pointer transition-colors ${
                            isCurrent
                              ? 'bg-blue-50/70 dark:bg-blue-950/35 border-blue-400/70'
                              : 'bg-slate-50 dark:bg-[#131c2e] border-slate-200 dark:border-[#24324a] hover:border-blue-400'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <MessageSquare className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                              <span className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                                {session.title}
                              </span>
                            </div>
                            <div className="mt-1 flex items-center gap-2 text-[10.5px] text-slate-500 dark:text-slate-400">
                              <span>{timeLabel}</span>
                              <span>·</span>
                              <span>
                                {session.messages.length} {bn ? 'মেসেজ' : 'msgs'}
                              </span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteHistorySession(session.id);
                            }}
                            aria-label="Delete history item"
                            className="p-1 rounded-md text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 cursor-pointer shrink-0 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <>
                {chatMessages.length === 0 && (
                  <div className="rounded-xl bg-slate-50 dark:bg-[#131c2e] border border-slate-200 dark:border-[#24324a] p-3">
                    <h4 className="text-[13.5px] font-bold text-blue-600 dark:text-blue-300 mb-1">
                      {bn ? 'স্বাগতম, itttc chat-এ (সর্বময় অ্যাক্সেস)' : 'Welcome to itttc chat (Full Access)'}
                    </h4>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed mb-2.5">
                      {bn
                        ? 'GENERAL ACCOUNTS-এর সকল হিসাব/ব্যালেন্স/লেনদেন, কালার/থিম, ছাত্র নিবন্ধন, জমা-খরচ, জব এন্ট্রি বা যেকোনো নির্দেশ দিন — আমি সরাসরি করে দেব।'
                        : 'Ask me to manage GENERAL ACCOUNTS, change colors/themes, add/update students, cashbook entries, jobs, or navigate anywhere.'}
                    </p>
                    <div className="flex flex-col gap-1.5">
                      {[
                        {
                          label: bn
                            ? `🔍 খাতা ${sampleStudentCode} এর তথ্য দেখাও`
                            : `🔍 Show student profile ${sampleStudentCode}`,
                          cmd: sampleStudentCode,
                        },
                        {
                          label: bn ? '🎨 লাল কালার করে দেও' : '🎨 Change theme to Crimson Red',
                          cmd: bn ? 'লাল কালার করে দেও' : 'Change color theme to crimson red',
                        },
                        {
                          label: bn ? '💰 বর্তমান ডিউ লিস্ট দেখাও' : '💰 Show current due list',
                          cmd: bn ? 'বর্তমান ডিউ লিস্ট দেখাও' : 'due list',
                        },
                        {
                          label: bn ? '📊 আজকের কালেকশন কত?' : "📊 Today's collection summary",
                          cmd: bn ? 'আজকের কালেকশন কত?' : 'today collection',
                        },
                      ].map((item) => (
                        <button
                          key={item.label}
                          type="button"
                          onClick={() => void sendChat(item.cmd)}
                          className="text-left px-2.5 py-2 rounded-lg bg-white dark:bg-[#162033] border border-slate-200 dark:border-[#26354d] hover:border-blue-400 dark:hover:border-blue-400 hover:bg-blue-50/40 dark:hover:bg-[#1b2840] text-xs font-medium text-slate-800 dark:text-slate-200 cursor-pointer transition-colors"
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

            {chatMessages.map((msg) =>
              msg.sender === 'user' ? (
                <div key={msg.id} className="flex justify-end items-start gap-2">
                  <div className="max-w-[82%] px-3 py-2 rounded-xl rounded-br-sm bg-blue-600 text-white text-[12.5px] leading-relaxed whitespace-pre-line shadow-sm">
                    {msg.text}
                  </div>
                </div>
              ) : (
                <div key={msg.id} className="flex items-start gap-2">
                  <div className="w-[26px] h-[26px] rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-white text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                    ✦
                  </div>
                  <div
                    className={`max-w-[84%] px-3 py-2.5 rounded-xl rounded-bl-sm text-[12.5px] leading-relaxed whitespace-pre-line border ${
                      msg.tone === 'warn'
                        ? 'bg-amber-50/90 dark:bg-amber-950/35 border-amber-300 dark:border-amber-700/70 text-amber-950 dark:text-amber-100'
                        : msg.tone === 'success'
                          ? 'bg-emerald-50/90 dark:bg-emerald-950/35 border-emerald-300 dark:border-emerald-700/70 text-emerald-950 dark:text-emerald-100'
                          : 'bg-slate-50 dark:bg-[#131c2e] border-slate-200 dark:border-[#24324a] text-slate-800 dark:text-slate-100'
                    }`}
                  >
                    {msg.title && (
                      <div className="font-bold text-[12px] mb-1 text-blue-600 dark:text-blue-300">
                        {msg.title}
                      </div>
                    )}
                    <div>{msg.text}</div>
                    {msg.actions && msg.actions.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 mt-2 pt-2 border-t border-slate-200/70 dark:border-white/10">
                        {msg.actions.map((act) => (
                          <button
                            key={act.label}
                            type="button"
                            onClick={act.onClick}
                            className={`px-2.5 py-1 rounded-md text-[11px] font-bold cursor-pointer transition-colors ${
                              act.tone === 'primary'
                                ? 'bg-[var(--cg-primary)] hover:bg-[var(--accent-dark)] text-[#042019]'
                                : 'border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700'
                            }`}
                          >
                            {act.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            )}

            {chatBusy && (
              <div className="text-xs font-medium text-blue-600 dark:text-blue-300 px-1 py-1">
                {bn ? '✦ itttc chat ভাবছে...' : '✦ itttc chat is thinking...'}
              </div>
            )}
              </>
            )}
          </div>

          <form
            onSubmit={handleCommandSubmit}
            className="p-2.5 border-t border-slate-200 dark:border-[#24324a] bg-slate-50 dark:bg-[#0b111e] shrink-0"
          >
            <div className="flex items-end gap-2 bg-white dark:bg-[#131c2e] border border-slate-300 dark:border-slate-700 focus-within:border-blue-500 rounded-xl px-2.5 py-2 transition-colors">
              <textarea
                ref={chatTextareaRef}
                rows={1}
                value={cmdInput}
                onKeyDown={handleChatTextareaKeyDown}
                onChange={(e) => {
                  setCmdInput(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 90)}px`;
                }}
                placeholder={
                  bn ? 'itttc chat-এ কিছু লিখুন...' : 'Ask itttc chat anything...'
                }
                className="flex-1 bg-transparent border-none text-slate-900 dark:text-white placeholder:text-slate-400 text-[13px] resize-none max-h-[90px] outline-none leading-snug"
              />
              <button
                type="submit"
                disabled={chatBusy}
                className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 disabled:opacity-60 text-white text-xs font-bold cursor-pointer transition-colors shrink-0"
              >
                Send
              </button>
            </div>
          </form>
        </aside>
      )}
    </div>
  );
}
