import { useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Check,
  Cloud,
  Download,
  Edit3,
  FileSpreadsheet,
  History,
  LayoutGrid,
  List,
  Lock,
  Mail,
  MapPin,
  Minus,
  Package,
  Phone,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  ScanLine,
  Search,
  Trash2,
  Upload,
  UserCheck,
  Wallet,
  X,
} from 'lucide-react';
import type { SubCollectionKey } from '../../lib/store';
import {
  downloadFile,
  formatTaka,
  toCsv,
  todayDDMMYYYY,
} from '../../lib/format';
import {
  isProtectedDefaultPrice,
  parseSupervisorLimitRentals,
  sortJobPrices,
} from '../../lib/jobLimits';
import type { PrintableReportSpec } from '../../lib/print';
import type {
  AgencyContract,
  AuditLog,
  CertStatus,
  DocItem,
  FlightStatus,
  JobEntry,
  JobPrice,
  JobReturn,
  Lang,
  MedicalStatus,
  OverseasCompany,
  PassportStatus,
  PoliceStatus,
  ReturnTypeOption,
  StaffMember,
  StaffPayment,
  StoreItem,
  StoreLog,
  Student,
  VisaStatus,
} from '../../types';

interface CrudCallbacks {
  lang: Lang;
  onAdd: (key: SubCollectionKey, raw: Record<string, unknown>) => Promise<string>;
  onUpdate: (key: SubCollectionKey, id: string, patch: Record<string, unknown>) => Promise<void>;
  onDelete: (key: SubCollectionKey, id: string) => Promise<void>;
  onLogAudit?: (action: string, module: string, detail: string) => Promise<void>;
  onPrintReport?: (spec: PrintableReportSpec) => void;
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

function parseCsvRows(text: string): string[][] {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  return lines.map((line) => {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        out.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  });
}

function getInitials(name: string): string {
  const parts = name
    .replace(/^(Engr\.|Md\.|Mr\.|Ms\.)\s*/i, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'ST';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

// 1. Staff & Payroll
export function StaffView({
  staff,
  staffPayments,
  lang,
  onAdd,
  onUpdate,
  onDelete,
  onLogAudit,
  onPrintReport,
}: CrudCallbacks & {
  staff: StaffMember[];
  staffPayments: StaffPayment[];
}) {
  const bn = lang === 'bn';
  const [subTab, setSubTab] = useState<'directory' | 'payroll' | 'history'>('directory');
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [search, setSearch] = useState('');
  const [payrollMonth, setPayrollMonth] = useState('November 2026');
  const [historyFilterStaff, setHistoryFilterStaff] = useState<string>('all');

  const [showStaffModal, setShowStaffModal] = useState(false);
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);
  const [staffForm, setStaffForm] = useState({
    name: '',
    role: 'Instructor',
    phone: '',
    email: '',
    nid: '',
    address: '',
    joinDate: todayDDMMYYYY(),
    bio: '',
    salary: '',
    month: 'November 2026',
  });

  const [payingStaff, setPayingStaff] = useState<StaffMember | null>(null);
  const [payForm, setPayForm] = useState({
    amount: '',
    month: 'November 2026',
    method: 'Cash',
    note: '',
    recordInCashbook: true,
  });

  const totalMonthlyBudget = staff.reduce((a, b) => a + Number(b.salary || 0), 0);

  const filteredStaff = useMemo(() => {
    const q = search.trim().toLowerCase();
    return staff.filter((s) => {
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.role.toLowerCase().includes(q) ||
        s.phone.toLowerCase().includes(q) ||
        (s.nid || '').toLowerCase().includes(q) ||
        (s.address || '').toLowerCase().includes(q)
      );
    });
  }, [staff, search]);

  const paidByStaffForMonth = useMemo(() => {
    const map = new Map<string, number>();
    staffPayments.forEach((p) => {
      if (p.month === payrollMonth) {
        map.set(p.staffId, (map.get(p.staffId) || 0) + Number(p.amount || 0));
      }
    });
    return map;
  }, [staffPayments, payrollMonth]);

  const filteredHistory = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...staffPayments].reverse().filter((p) => {
      if (historyFilterStaff !== 'all' && p.staffId !== historyFilterStaff) return false;
      if (!q) return true;
      return (
        p.staffName.toLowerCase().includes(q) ||
        p.month.toLowerCase().includes(q) ||
        p.method.toLowerCase().includes(q) ||
        p.note.toLowerCase().includes(q)
      );
    });
  }, [staffPayments, historyFilterStaff, search]);

  const openAddStaff = () => {
    setEditingStaff(null);
    setStaffForm({
      name: '',
      role: 'Instructor',
      phone: '',
      email: '',
      nid: '',
      address: '',
      joinDate: todayDDMMYYYY(),
      bio: '',
      salary: '',
      month: payrollMonth,
    });
    setShowStaffModal(true);
  };

  const openEditStaff = (s: StaffMember) => {
    setEditingStaff(s);
    setStaffForm({
      name: s.name,
      role: s.role,
      phone: s.phone,
      email: s.email || '',
      nid: s.nid || '',
      address: s.address || '',
      joinDate: s.joinDate || s.date,
      bio: s.bio || '',
      salary: String(s.salary),
      month: s.month || payrollMonth,
    });
    setShowStaffModal(true);
  };

  const handleSaveStaff = async (e: FormEvent) => {
    e.preventDefault();
    if (!staffForm.name.trim()) return;
    const payload = {
      date: editingStaff?.date || todayDDMMYYYY(),
      name: staffForm.name.trim(),
      role: staffForm.role.trim() || 'Instructor',
      phone: staffForm.phone.trim(),
      email: staffForm.email.trim(),
      nid: staffForm.nid.trim(),
      address: staffForm.address.trim(),
      joinDate: staffForm.joinDate.trim() || todayDDMMYYYY(),
      bio: staffForm.bio.trim(),
      salary: Number(staffForm.salary) || 0,
      paid: editingStaff?.paid || 0,
      month: staffForm.month.trim() || payrollMonth,
    };
    if (editingStaff) {
      await onUpdate('staff', editingStaff.id, payload);
      await onLogAudit?.('UPDATE_STAFF', 'Staff & Payroll', `Updated ${payload.name}`);
    } else {
      await onAdd('staff', payload);
      await onLogAudit?.('ADD_STAFF', 'Staff & Payroll', `Added ${payload.name} (${payload.role})`);
    }
    setShowStaffModal(false);
  };

  const openPayModal = (s: StaffMember) => {
    const paidAlready = paidByStaffForMonth.get(s.id) || 0;
    const remaining = Math.max(0, Number(s.salary || 0) - paidAlready);
    setPayingStaff(s);
    setPayForm({
      amount: String(remaining || s.salary || 0),
      month: payrollMonth,
      method: 'Cash',
      note: `Monthly salary — ${payrollMonth}`,
      recordInCashbook: true,
    });
  };

  const handleConfirmPay = async (e: FormEvent) => {
    e.preventDefault();
    if (!payingStaff) return;
    const amt = Number(payForm.amount) || 0;
    if (amt <= 0) return;
    const today = todayDDMMYYYY();

    await onAdd('staffPayments', {
      date: today,
      staffId: payingStaff.id,
      staffName: payingStaff.name,
      month: payForm.month.trim() || payrollMonth,
      amount: amt,
      method: payForm.method,
      note: payForm.note.trim(),
    });
    await onUpdate('staff', payingStaff.id, {
      paid: Number(payingStaff.paid || 0) + amt,
      month: payForm.month.trim() || payrollMonth,
    });
    if (payForm.recordInCashbook) {
      await onAdd('cash', {
        date: today,
        type: 'out',
        category: 'Staff Salary',
        amt,
        note: `Salary paid to ${payingStaff.name} (${payForm.month})`,
      });
    }
    await onLogAudit?.(
      'PAY_SALARY',
      'Staff & Payroll',
      `Paid ${formatTaka(amt)} to ${payingStaff.name} for ${payForm.month}`
    );
    setPayingStaff(null);
  };

  const handleExportCsv = () => {
    const csv = toCsv(
      ['Name', 'Role', 'Phone', 'Email', 'NID', 'Join Date', 'Monthly Salary', 'Address'],
      filteredStaff.map((s) => [
        s.name,
        s.role,
        s.phone,
        s.email || '',
        s.nid || '',
        s.joinDate || s.date,
        s.salary,
        s.address || '',
      ])
    );
    downloadFile(`ittc-staff-${todayDDMMYYYY()}.csv`, csv, 'text/csv;charset=utf-8');
  };

  return (
    <div className="space-y-4">
      {/* Header Card with 3 Sub-Tabs */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="p-2.5 rounded-xl bg-teal-50 dark:bg-teal-950/60 text-teal-600 dark:text-teal-400 border border-teal-200/70 dark:border-teal-800/60 shrink-0">
            <UserCheck className="w-5 h-5" />
          </span>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                {bn
                  ? 'সেন্টার স্টাফ, প্রশিক্ষক ও মাসিক বেতন'
                  : 'Centre Staff, Instructors & Monthly Payroll'}
              </h2>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-teal-50 dark:bg-teal-950/70 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800 font-mono-num">
                {staff.length} {bn ? 'জন' : 'Staff'}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {bn
                ? 'স্টাফ প্রোফাইল ডিরেক্টরি ও মাসিক বেতন পরিশোধ ডাটাবেস'
                : 'Staff profiles directory and monthly payroll database'}
            </p>
          </div>
        </div>

        <div className="inline-flex flex-wrap items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
          <button
            type="button"
            onClick={() => setSubTab('directory')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
              subTab === 'directory'
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            <UserCheck className="w-3.5 h-3.5" />
            <span>{bn ? 'স্টাফ ডিরেক্টরি' : 'Staff Directory'}</span>
            <span className="font-mono-num text-[11px] px-1.5 rounded bg-slate-200 dark:bg-slate-600">
              {staff.length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('payroll')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
              subTab === 'payroll'
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            <Wallet className="w-3.5 h-3.5" />
            <span>{bn ? 'মাসিক বেতন ডাটাবেস' : 'Monthly Payroll Database'}</span>
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-teal-600 text-white">
              Payroll
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              setHistoryFilterStaff('all');
              setSubTab('history');
            }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
              subTab === 'history'
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>{bn ? 'বেতন প্রদানের ইতিহাস' : 'Staff Payment History'}</span>
          </button>
        </div>
      </div>

      {/* Filter & Actions Bar */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              bn
                ? 'নাম, পদবী, মোবাইল, এনআইডি বা ঠিকানা দিয়ে খুঁজুন...'
                : 'Search staff by Name, Role, Mobile, NID or Address...'
            }
            className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {subTab === 'directory' && (
            <div className="inline-flex p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <button
                type="button"
                onClick={() => setViewMode('cards')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold cursor-pointer ${
                  viewMode === 'cards'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span>{bn ? 'প্রোফাইল কার্ড' : 'Profile Cards'}</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold cursor-pointer ${
                  viewMode === 'table'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                <List className="w-3.5 h-3.5" />
                <span>{bn ? 'টেবিল তালিকা' : 'Table List'}</span>
              </button>
            </div>
          )}

          {subTab === 'payroll' && (
            <input
              value={payrollMonth}
              onChange={(e) => setPayrollMonth(e.target.value)}
              placeholder="November 2026"
              className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-medium"
            />
          )}

          <button
            type="button"
            onClick={() => {
              if (onPrintReport) {
                onPrintReport({
                  title:
                    subTab === 'payroll'
                      ? `${bn ? 'মাসিক বেতন রিপোর্ট' : 'Monthly Payroll Report'} (${payrollMonth})`
                      : subTab === 'history'
                        ? bn
                          ? 'স্টাফ বেতন পরিশোধের ইতিহাস'
                          : 'Staff Salary Payment History'
                        : bn
                          ? 'স্টাফ ও ইনস্ট্রাক্টর ডিরেক্টরি'
                          : 'Staff & Instructor Directory',
                  subtitle: `${bn ? 'মোট স্টাফ' : 'Total Staff'}: ${staff.length} · ${bn ? 'মাসিক বাজেট' : 'Monthly Budget'}: ${formatTaka(totalMonthlyBudget)}`,
                  filename: `ittc-staff-${subTab}-${todayDDMMYYYY()}`,
                  columns:
                    subTab === 'history'
                      ? ['Date', 'Staff Name', 'Month', 'Method', 'Amount', 'Note']
                      : ['Name', 'Role', 'Phone', 'Salary', 'Paid (' + payrollMonth + ')', 'Join Date'],
                  rows:
                    subTab === 'history'
                      ? filteredHistory.map((p) => [
                          p.date,
                          p.staffName,
                          p.month,
                          p.method,
                          formatTaka(p.amount),
                          p.note || '—',
                        ])
                      : filteredStaff.map((s) => [
                          s.name,
                          s.role,
                          s.phone || '—',
                          formatTaka(s.salary),
                          formatTaka(paidByStaffForMonth.get(s.id) || 0),
                          s.joinDate || '—',
                        ]),
                });
              } else {
                window.print();
              }
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 text-xs font-semibold cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>{bn ? 'প্রিন্ট' : 'Print'}</span>
          </button>

          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 text-xs font-semibold cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>{bn ? 'এক্সেল' : 'Excel'}</span>
          </button>

          <button
            type="button"
            onClick={openAddStaff}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{bn ? '+ নতুন স্টাফ যোগ' : '+ Add New Staff'}</span>
          </button>
        </div>
      </div>

      {/* Total Monthly Budget Banner */}
      <div className="bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/70 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-600 text-white flex items-center justify-center font-bold text-base shrink-0">
            ৳
          </div>
          <div>
            <div className="font-display text-sm font-extrabold text-slate-900 dark:text-white">
              {bn ? 'মোট মাসিক বেতন বাজেট:' : 'Total Monthly Budget:'}{' '}
              <span className="font-mono-num">{formatTaka(totalMonthlyBudget)}</span>
            </div>
            <div className="text-xs text-teal-700 dark:text-teal-300">
              {staff.length}{' '}
              {bn
                ? 'জন সক্রিয় প্রশিক্ষক ও অফিস স্টাফের মাসিক মূল বেতন'
                : 'active instructors & center personnel monthly basic payroll'}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setSubTab('payroll')}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800 text-xs font-semibold text-teal-700 dark:text-teal-300 hover:bg-emerald-50 dark:hover:bg-slate-800 cursor-pointer self-start sm:self-auto"
        >
          <Wallet className="w-3.5 h-3.5" />
          <span>{bn ? 'চলতি মাসের পেরোল দেখুন >' : 'View Current Month Payroll >'}</span>
        </button>
      </div>

      {/* Sub-Tab 1: Staff Directory */}
      {subTab === 'directory' && (
        <>
          {filteredStaff.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-10 text-center text-sm text-slate-500">
              {bn ? 'কোনো স্টাফ পাওয়া যায়নি।' : 'No staff members found.'}
            </div>
          ) : viewMode === 'cards' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredStaff.map((s) => (
                <div
                  key={s.id}
                  className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 flex flex-col justify-between gap-4"
                >
                  <div className="space-y-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-12 h-12 rounded-xl bg-slate-900 dark:bg-slate-800 text-white flex items-center justify-center font-display font-bold text-base shrink-0 border border-slate-700">
                          {getInitials(s.name)}
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-display font-bold text-sm text-slate-900 dark:text-white truncate">
                            {s.name}
                          </h3>
                          <span className="inline-block mt-1 text-[11px] font-semibold px-2 py-0.5 rounded-md bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
                            {s.role}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => openEditStaff(s)}
                          aria-label="Edit staff"
                          className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await onDelete('staff', s.id);
                            await onLogAudit?.('DELETE_STAFF', 'Staff & Payroll', `Removed ${s.name}`);
                          }}
                          aria-label="Delete staff"
                          className="p-1.5 rounded-md text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="rounded-lg bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-900/50 px-3 py-2 flex items-center justify-between text-xs">
                      <span className="font-medium text-teal-800 dark:text-teal-300">
                        {bn ? 'মাসিক মূল বেতন:' : 'Monthly Basic Salary:'}
                      </span>
                      <span className="font-mono-num font-extrabold text-sm text-teal-700 dark:text-teal-300">
                        {formatTaka(s.salary)}
                      </span>
                    </div>

                    <div className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
                      <div className="flex items-center gap-2 font-mono-num">
                        <Phone className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                        <span>{s.phone || '—'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Mail className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                        <span className="truncate">{s.email || '—'}</span>
                      </div>
                      <div className="flex items-center gap-2 font-mono-num">
                        <UserCheck className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                        <span>
                          {bn ? 'যোগদান:' : 'Joined:'} {s.joinDate || s.date}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 font-mono-num">
                        <FileSpreadsheet className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                        <span>NID: {s.nid || '—'}</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <MapPin className="w-3.5 h-3.5 text-teal-600 shrink-0 mt-0.5" />
                        <span>{s.address || '—'}</span>
                      </div>
                      {s.bio && (
                        <p className="pt-1 text-[11px] italic text-slate-500 dark:text-slate-400">
                          {s.bio}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setHistoryFilterStaff(s.id);
                        setSubTab('history');
                      }}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:text-teal-600 cursor-pointer"
                    >
                      <History className="w-3.5 h-3.5" />
                      <span>{bn ? 'বেতন ইতিহাস' : 'Salary History'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => openPayModal(s)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold cursor-pointer"
                    >
                      <Wallet className="w-3.5 h-3.5" />
                      <span>{bn ? 'বেতন প্রদান' : 'Pay Salary Entry'}</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-[11px] font-semibold text-slate-500">
                      <th className="py-2.5 px-4">{bn ? 'নাম' : 'NAME'}</th>
                      <th className="py-2.5 px-4">{bn ? 'পদবী' : 'ROLE'}</th>
                      <th className="py-2.5 px-4">{bn ? 'মোবাইল ও ইমেইল' : 'MOBILE / EMAIL'}</th>
                      <th className="py-2.5 px-4">{bn ? 'যোগদান ও NID' : 'JOINED / NID'}</th>
                      <th className="py-2.5 px-4 text-right">{bn ? 'মাসিক বেতন' : 'BASIC SALARY'}</th>
                      <th className="py-2.5 px-4 text-right">{bn ? 'অ্যাকশন' : 'ACTIONS'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {filteredStaff.map((s) => (
                      <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="py-2.5 px-4 font-semibold text-slate-900 dark:text-white">
                          {s.name}
                        </td>
                        <td className="py-2.5 px-4 text-xs text-teal-700 dark:text-teal-300 font-semibold">
                          {s.role}
                        </td>
                        <td className="py-2.5 px-4 text-xs">
                          <div className="font-mono-num">{s.phone || '—'}</div>
                          <div className="text-slate-500">{s.email}</div>
                        </td>
                        <td className="py-2.5 px-4 text-xs font-mono-num">
                          <div>{s.joinDate || s.date}</div>
                          <div className="text-slate-500">{s.nid || '—'}</div>
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono-num font-bold">
                          {formatTaka(s.salary)}
                        </td>
                        <td className="py-2.5 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => openPayModal(s)}
                              className="px-2.5 py-1 rounded-md bg-teal-600 text-white text-xs font-semibold cursor-pointer"
                            >
                              {bn ? 'বেতন' : 'Pay'}
                            </button>
                            <button
                              type="button"
                              onClick={() => openEditStaff(s)}
                              className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 cursor-pointer"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onDelete('staff', s.id)}
                              className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-red-600 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Sub-Tab 2: Monthly Payroll Database */}
      {subTab === 'payroll' && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div>
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                {bn ? `মাসিক বেতন শিট — ${payrollMonth}` : `Monthly Payroll Sheet — ${payrollMonth}`}
              </h3>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-[11px] font-semibold text-slate-500">
                  <th className="py-2.5 px-4">{bn ? 'স্টাফের নাম' : 'STAFF NAME'}</th>
                  <th className="py-2.5 px-4">{bn ? 'পদবী' : 'ROLE'}</th>
                  <th className="py-2.5 px-4 text-right">{bn ? 'মূল বেতন' : 'BASIC SALARY'}</th>
                  <th className="py-2.5 px-4 text-right">{bn ? 'মাসে পরিশোধ' : 'PAID IN MONTH'}</th>
                  <th className="py-2.5 px-4 text-right">{bn ? 'বাকি' : 'BALANCE DUE'}</th>
                  <th className="py-2.5 px-4">{bn ? 'অবস্থা' : 'STATUS'}</th>
                  <th className="py-2.5 px-4 text-right">{bn ? 'অ্যাকশন' : 'ACTION'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {filteredStaff.map((s) => {
                  const paidAmt = paidByStaffForMonth.get(s.id) || 0;
                  const due = Math.max(0, Number(s.salary || 0) - paidAmt);
                  return (
                    <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-2.5 px-4 font-semibold text-slate-900 dark:text-white">
                        {s.name}
                      </td>
                      <td className="py-2.5 px-4 text-xs text-slate-600 dark:text-slate-300">
                        {s.role}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono-num font-bold">
                        {formatTaka(s.salary)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono-num font-bold text-emerald-600 dark:text-emerald-400">
                        {formatTaka(paidAmt)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono-num font-bold text-amber-600 dark:text-amber-400">
                        {formatTaka(due)}
                      </td>
                      <td className="py-2.5 px-4 text-xs">
                        <span
                          className={`px-2 py-0.5 rounded-full font-semibold ${
                            due === 0 && s.salary > 0
                              ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                              : paidAmt > 0
                                ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                          }`}
                        >
                          {due === 0 && s.salary > 0
                            ? bn
                              ? 'পরিশোধিত'
                              : 'Paid'
                            : paidAmt > 0
                              ? bn
                                ? 'আংশিক'
                                : 'Partial'
                              : bn
                                ? 'বকেয়া'
                                : 'Unpaid'}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => openPayModal(s)}
                          className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold cursor-pointer"
                        >
                          <Wallet className="w-3 h-3" />
                          <span>{bn ? 'বেতন দিন' : 'Pay Salary'}</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Sub-Tab 3: Staff Payment History */}
      {subTab === 'history' && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
              {bn ? 'বেতন প্রদানের ইতিহাস' : 'Staff Payment History'} ({filteredHistory.length})
            </h3>
            <select
              value={historyFilterStaff}
              onChange={(e) => setHistoryFilterStaff(e.target.value)}
              className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
            >
              <option value="all">{bn ? 'সকল স্টাফ' : 'All Staff Members'}</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          {filteredHistory.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              {bn ? 'কোনো বেতন প্রদানের রেকর্ড নেই।' : 'No salary payment records found.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-[11px] font-semibold text-slate-500">
                    <th className="py-2.5 px-4">{bn ? 'তারিখ' : 'DATE'}</th>
                    <th className="py-2.5 px-4">{bn ? 'স্টাফের নাম' : 'STAFF NAME'}</th>
                    <th className="py-2.5 px-4">{bn ? 'মাস' : 'MONTH'}</th>
                    <th className="py-2.5 px-4">{bn ? 'মাধ্যম' : 'METHOD'}</th>
                    <th className="py-2.5 px-4">{bn ? 'নোট' : 'NOTE'}</th>
                    <th className="py-2.5 px-4 text-right">{bn ? 'পরিমাণ' : 'AMOUNT'}</th>
                    <th className="py-2.5 px-4 text-right"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {filteredHistory.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-2.5 px-4 font-mono-num text-xs">{p.date}</td>
                      <td className="py-2.5 px-4 font-semibold text-slate-900 dark:text-white">
                        {p.staffName}
                      </td>
                      <td className="py-2.5 px-4 text-xs">{p.month}</td>
                      <td className="py-2.5 px-4 text-xs">{p.method}</td>
                      <td className="py-2.5 px-4 text-xs text-slate-500">{p.note || '—'}</td>
                      <td className="py-2.5 px-4 text-right font-mono-num font-bold text-teal-700 dark:text-teal-400">
                        {formatTaka(p.amount)}
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => onDelete('staffPayments', p.id)}
                          className="p-1.5 rounded-md text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
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
      )}

      {/* Add / Edit Staff Modal */}
      {showStaffModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveStaff}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-2xl w-full p-5 space-y-4 max-h-[90vh] overflow-y-auto shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="font-display text-base font-bold">
                {editingStaff
                  ? bn
                    ? 'স্টাফ প্রোফাইল সম্পাদনা'
                    : 'Edit Staff Profile'
                  : bn
                    ? 'নতুন স্টাফ যোগ করুন'
                    : 'Add New Staff Member'}
              </h3>
              <button
                type="button"
                onClick={() => setShowStaffModal(false)}
                className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">
                  {bn ? 'পূর্ণ নাম *' : 'Full Name *'}
                </label>
                <input
                  required
                  value={staffForm.name}
                  onChange={(e) => setStaffForm({ ...staffForm, name: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  {bn ? 'পদবী *' : 'Role / Designation *'}
                </label>
                <input
                  required
                  value={staffForm.role}
                  onChange={(e) => setStaffForm({ ...staffForm, role: e.target.value })}
                  placeholder="Senior Instructor / Accountant"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  {bn ? 'মোবাইল নম্বর' : 'Mobile'}
                </label>
                <input
                  value={staffForm.phone}
                  onChange={(e) => setStaffForm({ ...staffForm, phone: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{bn ? 'ইমেইল' : 'Email'}</label>
                <input
                  type="email"
                  value={staffForm.email}
                  onChange={(e) => setStaffForm({ ...staffForm, email: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">NID</label>
                <input
                  value={staffForm.nid}
                  onChange={(e) => setStaffForm({ ...staffForm, nid: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  {bn ? 'যোগদানের তারিখ' : 'Join Date'}
                </label>
                <input
                  value={staffForm.joinDate}
                  onChange={(e) => setStaffForm({ ...staffForm, joinDate: e.target.value })}
                  placeholder="DD-MM-YYYY"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  {bn ? 'মাসিক মূল বেতন (৳)' : 'Monthly Basic Salary (BDT)'}
                </label>
                <input
                  type="number"
                  min={0}
                  value={staffForm.salary}
                  onChange={(e) => setStaffForm({ ...staffForm, salary: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  {bn ? 'ঠিকানা' : 'Address'}
                </label>
                <input
                  value={staffForm.address}
                  onChange={(e) => setStaffForm({ ...staffForm, address: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium mb-1">
                  {bn ? 'সংক্ষিপ্ত পরিচিতি / অভিজ্ঞতা' : 'Bio / Certifications'}
                </label>
                <input
                  value={staffForm.bio}
                  onChange={(e) => setStaffForm({ ...staffForm, bio: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowStaffModal(false)}
                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold cursor-pointer"
              >
                {bn ? 'বাতিল' : 'Cancel'}
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold cursor-pointer"
              >
                {bn ? 'সংরক্ষণ করুন' : 'Save Staff'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Pay Salary Modal */}
      {payingStaff && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <form
            onSubmit={handleConfirmPay}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-md w-full p-5 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div>
                <h3 className="font-display text-base font-bold">
                  {bn ? 'বেতন প্রদান এন্ট্রি' : 'Pay Salary Entry'}
                </h3>
                <p className="text-xs text-slate-500">
                  {payingStaff.name} · {payingStaff.role}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPayingStaff(null)}
                className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium mb-1">
                  {bn ? 'বেতনের মাস' : 'Payroll Month'}
                </label>
                <input
                  required
                  value={payForm.month}
                  onChange={(e) => setPayForm({ ...payForm, month: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">
                    {bn ? 'পরিমাণ (৳) *' : 'Amount (BDT) *'}
                  </label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={payForm.amount}
                    onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono-num"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">
                    {bn ? 'পেমেন্ট মাধ্যম' : 'Method'}
                  </label>
                  <select
                    value={payForm.method}
                    onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                  >
                    <option value="Cash">Cash</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                    <option value="bKash / Nagad">bKash / Nagad</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{bn ? 'মন্তব্য' : 'Note'}</label>
                <input
                  value={payForm.note}
                  onChange={(e) => setPayForm({ ...payForm, note: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={payForm.recordInCashbook}
                  onChange={(e) => setPayForm({ ...payForm, recordInCashbook: e.target.checked })}
                />
                <span>
                  {bn ? 'স্বয়ংক্রিয়ভাবে ক্যাশবুকে খরচ হিসেবে লিখুন' : 'Also record as expense in Cashbook'}
                </span>
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPayingStaff(null)}
                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold cursor-pointer"
              >
                {bn ? 'বাতিল' : 'Cancel'}
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold cursor-pointer"
              >
                {bn ? 'বেতন কনফার্ম করুন' : 'Confirm Payment'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// 2. Overseas & Partner Companies
export function CompaniesView({
  companies,
  agencyContracts,
  lang,
  onAdd,
  onUpdate,
  onDelete,
  onLogAudit,
}: CrudCallbacks & {
  companies: OverseasCompany[];
  agencyContracts: AgencyContract[];
}) {
  const bn = lang === 'bn';
  const [subTab, setSubTab] = useState<'companies' | 'history'>('companies');
  const [search, setSearch] = useState('');

  const [showCompanyModal, setShowCompanyModal] = useState(false);
  const [editingCompany, setEditingCompany] = useState<OverseasCompany | null>(null);
  const [companyForm, setCompanyForm] = useState({
    name: '',
    country: 'Saudi Arabia',
    contact: '',
    phone: '',
    address: '',
    demand: '',
    contractsCount: '0',
    workersCount: '0',
    note: '',
  });

  const [showContractModal, setShowContractModal] = useState(false);
  const [contractForm, setContractForm] = useState({
    companyName: '',
    country: 'Saudi Arabia',
    trade: '6G Pipe Welder',
    workersCount: '10',
    status: 'Active' as 'Active' | 'Completed' | 'Pending',
    note: '',
  });

  const filteredCompanies = useMemo(() => {
    const q = search.trim().toLowerCase();
    return companies.filter((c) => {
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.country.toLowerCase().includes(q) ||
        c.contact.toLowerCase().includes(q) ||
        (c.phone || '').toLowerCase().includes(q)
      );
    });
  }, [companies, search]);

  const filteredContracts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...agencyContracts].reverse().filter((a) => {
      if (!q) return true;
      return (
        a.companyName.toLowerCase().includes(q) ||
        a.country.toLowerCase().includes(q) ||
        a.trade.toLowerCase().includes(q)
      );
    });
  }, [agencyContracts, search]);

  const openAddCompany = () => {
    setEditingCompany(null);
    setCompanyForm({
      name: '',
      country: 'Saudi Arabia',
      contact: '',
      phone: '',
      address: '',
      demand: '',
      contractsCount: '0',
      workersCount: '0',
      note: '',
    });
    setShowCompanyModal(true);
  };

  const openEditCompany = (c: OverseasCompany) => {
    setEditingCompany(c);
    setCompanyForm({
      name: c.name,
      country: c.country,
      contact: c.contact,
      phone: c.phone || '',
      address: c.address || '',
      demand: c.demand,
      contractsCount: String(c.contractsCount || 0),
      workersCount: String(c.workersCount || 0),
      note: c.note,
    });
    setShowCompanyModal(true);
  };

  const handleSaveCompany = async (e: FormEvent) => {
    e.preventDefault();
    if (!companyForm.name.trim()) return;
    const payload = {
      date: editingCompany?.date || todayDDMMYYYY(),
      name: companyForm.name.trim(),
      country: companyForm.country.trim() || 'Overseas',
      contact: companyForm.contact.trim(),
      phone: companyForm.phone.trim(),
      address: companyForm.address.trim(),
      demand: companyForm.demand.trim(),
      contractsCount: Number(companyForm.contractsCount) || 0,
      workersCount: Number(companyForm.workersCount) || 0,
      note: companyForm.note.trim(),
    };
    if (editingCompany) {
      await onUpdate('companies', editingCompany.id, payload);
      await onLogAudit?.('UPDATE_COMPANY', 'Overseas Companies', `Updated ${payload.name}`);
    } else {
      await onAdd('companies', payload);
      await onLogAudit?.('ADD_COMPANY', 'Overseas Companies', `Added ${payload.name}`);
    }
    setShowCompanyModal(false);
  };

  const handleAddContract = async (e: FormEvent) => {
    e.preventDefault();
    if (!contractForm.companyName.trim()) return;
    await onAdd('agencyContracts', {
      date: todayDDMMYYYY(),
      companyName: contractForm.companyName.trim(),
      country: contractForm.country.trim() || 'Saudi Arabia',
      trade: contractForm.trade.trim() || 'Welder',
      workersCount: Number(contractForm.workersCount) || 0,
      status: contractForm.status,
      note: contractForm.note.trim(),
    });
    await onLogAudit?.(
      'ADD_AGENCY_CONTRACT',
      'Overseas Companies',
      `${contractForm.companyName} (${contractForm.workersCount} workers)`
    );
    setShowContractModal(false);
  };

  return (
    <div className="space-y-4">
      {/* Header Banner Card */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="p-2.5 rounded-xl bg-teal-50 dark:bg-teal-950/60 text-teal-600 dark:text-teal-400 border border-teal-200/70 dark:border-teal-800/60 shrink-0">
            <Building2 className="w-5 h-5" />
          </span>
          <div>
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
              {bn
                ? 'ভার্সাস ও পার্টনার্স বিদেশি কোম্পানি'
                : 'Versus & Partners Overseas Companies'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {bn
                ? 'বিদেশি পার্টনার কোম্পানি ও রিক্রুটিং এজেন্সির কাজের ইতিহাস'
                : 'Overseas partner companies & recruiting agency working history'}
            </p>
          </div>
        </div>

        <div className="inline-flex p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setSubTab('companies')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
              subTab === 'companies'
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>
              {bn ? 'পার্টনার কোম্পানি' : 'Partner Companies'} ({companies.length})
            </span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('history')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
              subTab === 'history'
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>
              {bn ? 'এজেন্সি ইতিহাস' : 'Agency History'} ({agencyContracts.length})
            </span>
          </button>
        </div>
      </div>

      {/* Search + Add Bar */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              bn
                ? 'কোম্পানির নাম, দেশ, যোগাযোগকারী বা ফোন দিয়ে খুঁজুন...'
                : 'Search by company name, country, contact person or phone...'
            }
            className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
          />
        </div>
        <button
          type="button"
          onClick={() => (subTab === 'companies' ? openAddCompany() : setShowContractModal(true))}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>
            {subTab === 'companies'
              ? bn
                ? '+ নতুন কোম্পানি যোগ'
                : '+ Add New Company'
              : bn
                ? '+ নতুন চুক্তি যোগ'
                : '+ Add Agency Contract'}
          </span>
        </button>
      </div>

      {/* Tab 1: Partner Companies Card Grid */}
      {subTab === 'companies' && (
        <>
          {filteredCompanies.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-10 text-center text-sm text-slate-500">
              {bn ? 'কোনো কোম্পানি পাওয়া যায়নি।' : 'No overseas partner companies found.'}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredCompanies.map((c) => (
                <div
                  key={c.id}
                  className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 flex flex-col justify-between gap-4"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
                        {c.country}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEditCompany(c)}
                          aria-label="Edit company"
                          className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete('companies', c.id)}
                          aria-label="Delete company"
                          className="p-1.5 rounded-md text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white border-b border-slate-100 dark:border-slate-800 pb-2.5">
                      {c.name}
                    </h3>

                    <div className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
                      <div className="flex items-center gap-2">
                        <UserCheck className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="font-medium">{c.contact || '—'}</span>
                      </div>
                      <div className="flex items-center gap-2 font-mono-num text-teal-700 dark:text-teal-400">
                        <Phone className="w-3.5 h-3.5 shrink-0" />
                        <span>{c.phone || '—'}</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                        <span>{c.address || '—'}</span>
                      </div>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
                    <span className="text-slate-500 dark:text-slate-400">
                      {bn ? 'এজেন্সি চুক্তি:' : 'Agency Contracts:'}
                    </span>
                    <span className="px-2.5 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 font-semibold font-mono-num">
                      {c.contractsCount || 0} {bn ? 'চুক্তি' : 'Contracts'} ({c.workersCount || 0}{' '}
                      {bn ? 'কর্মী' : 'Workers'})
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Tab 2: Agency History */}
      {subTab === 'history' && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
          {filteredContracts.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              {bn ? 'কোনো এজেন্সি চুক্তি ইতিহাস পাওয়া যায়নি।' : 'No agency contract records found.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-[11px] font-semibold text-slate-500">
                    <th className="py-2.5 px-4">{bn ? 'তারিখ' : 'DATE'}</th>
                    <th className="py-2.5 px-4">{bn ? 'কোম্পানি / এজেন্সি' : 'COMPANY / AGENCY'}</th>
                    <th className="py-2.5 px-4">{bn ? 'দেশ' : 'COUNTRY'}</th>
                    <th className="py-2.5 px-4">{bn ? 'ট্রেড / চাহিদা' : 'TRADE'}</th>
                    <th className="py-2.5 px-4 text-right">{bn ? 'কর্মী সংখ্যা' : 'WORKERS'}</th>
                    <th className="py-2.5 px-4">{bn ? 'অবস্থা' : 'STATUS'}</th>
                    <th className="py-2.5 px-4">{bn ? 'নোট' : 'NOTE'}</th>
                    <th className="py-2.5 px-4 text-right"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {filteredContracts.map((a) => (
                    <tr key={a.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-2.5 px-4 font-mono-num text-xs">{a.date}</td>
                      <td className="py-2.5 px-4 font-semibold text-slate-900 dark:text-white">
                        {a.companyName}
                      </td>
                      <td className="py-2.5 px-4 text-xs">{a.country}</td>
                      <td className="py-2.5 px-4 text-xs">{a.trade}</td>
                      <td className="py-2.5 px-4 text-right font-mono-num font-bold">
                        {a.workersCount}
                      </td>
                      <td className="py-2.5 px-4 text-xs">
                        <span
                          className={`px-2 py-0.5 rounded-full font-semibold ${
                            a.status === 'Completed'
                              ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                              : a.status === 'Active'
                                ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300'
                                : 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300'
                          }`}
                        >
                          {a.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-xs text-slate-500">{a.note || '—'}</td>
                      <td className="py-2.5 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => onDelete('agencyContracts', a.id)}
                          className="p-1.5 rounded-md text-red-600 hover:bg-red-50 cursor-pointer"
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
      )}

      {/* Company Modal */}
      {showCompanyModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveCompany}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-lg w-full p-5 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="font-display text-base font-bold">
                {editingCompany
                  ? bn
                    ? 'কোম্পানি সম্পাদনা'
                    : 'Edit Overseas Company'
                  : bn
                    ? 'নতুন বিদেশি কোম্পানি যোগ'
                    : 'Add New Overseas Company'}
              </h3>
              <button
                type="button"
                onClick={() => setShowCompanyModal(false)}
                className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium mb-1">
                  {bn ? 'কোম্পানির নাম *' : 'Company Name *'}
                </label>
                <input
                  required
                  value={companyForm.name}
                  onChange={(e) => setCompanyForm({ ...companyForm, name: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{bn ? 'দেশ *' : 'Country *'}</label>
                <input
                  required
                  value={companyForm.country}
                  onChange={(e) => setCompanyForm({ ...companyForm, country: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  {bn ? 'যোগাযোগকারী' : 'Contact Person'}
                </label>
                <input
                  value={companyForm.contact}
                  onChange={(e) => setCompanyForm({ ...companyForm, contact: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{bn ? 'ফোন' : 'Phone'}</label>
                <input
                  value={companyForm.phone}
                  onChange={(e) => setCompanyForm({ ...companyForm, phone: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  {bn ? 'চাহিদা / ট্রেড' : 'Trade Demand'}
                </label>
                <input
                  value={companyForm.demand}
                  onChange={(e) => setCompanyForm({ ...companyForm, demand: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium mb-1">{bn ? 'ঠিকানা' : 'Address'}</label>
                <input
                  value={companyForm.address}
                  onChange={(e) => setCompanyForm({ ...companyForm, address: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  {bn ? 'চুক্তি সংখ্যা' : 'Contracts Count'}
                </label>
                <input
                  type="number"
                  min={0}
                  value={companyForm.contractsCount}
                  onChange={(e) => setCompanyForm({ ...companyForm, contractsCount: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  {bn ? 'মোট কর্মী' : 'Workers Count'}
                </label>
                <input
                  type="number"
                  min={0}
                  value={companyForm.workersCount}
                  onChange={(e) => setCompanyForm({ ...companyForm, workersCount: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono-num"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowCompanyModal(false)}
                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold cursor-pointer"
              >
                {bn ? 'বাতিল' : 'Cancel'}
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold cursor-pointer"
              >
                {bn ? 'সংরক্ষণ করুন' : 'Save Company'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Agency Contract Modal */}
      {showContractModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <form
            onSubmit={handleAddContract}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-md w-full p-5 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="font-display text-base font-bold">
                {bn ? 'নতুন এজেন্সি চুক্তি যোগ' : 'Add Agency Contract'}
              </h3>
              <button
                type="button"
                onClick={() => setShowContractModal(false)}
                className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium mb-1">
                  {bn ? 'কোম্পানি / এজেন্সি *' : 'Company / Agency *'}
                </label>
                <input
                  required
                  list="ittc-company-options"
                  value={contractForm.companyName}
                  onChange={(e) => setContractForm({ ...contractForm, companyName: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
                <datalist id="ittc-company-options">
                  {companies.map((c) => (
                    <option key={c.id} value={c.name} />
                  ))}
                </datalist>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">{bn ? 'দেশ' : 'Country'}</label>
                  <input
                    value={contractForm.country}
                    onChange={(e) => setContractForm({ ...contractForm, country: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">
                    {bn ? 'কর্মী সংখ্যা' : 'Workers'}
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={contractForm.workersCount}
                    onChange={(e) =>
                      setContractForm({ ...contractForm, workersCount: e.target.value })
                    }
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono-num"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">{bn ? 'ট্রেড' : 'Trade'}</label>
                  <input
                    value={contractForm.trade}
                    onChange={(e) => setContractForm({ ...contractForm, trade: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">
                    {bn ? 'অবস্থা' : 'Status'}
                  </label>
                  <select
                    value={contractForm.status}
                    onChange={(e) =>
                      setContractForm({
                        ...contractForm,
                        status: e.target.value as 'Active' | 'Completed' | 'Pending',
                      })
                    }
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                  >
                    <option value="Active">Active</option>
                    <option value="Pending">Pending</option>
                    <option value="Completed">Completed</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{bn ? 'নোট' : 'Note'}</label>
                <input
                  value={contractForm.note}
                  onChange={(e) => setContractForm({ ...contractForm, note: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowContractModal(false)}
                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold cursor-pointer"
              >
                {bn ? 'বাতিল' : 'Cancel'}
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold cursor-pointer"
              >
                {bn ? 'সংরক্ষণ করুন' : 'Save Contract'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// 3. Store & Inventory Management
export function StoreView({
  store,
  storeLogs,
  lang,
  onAdd,
  onUpdate,
  onDelete,
  onLogAudit,
  onPrintReport,
}: CrudCallbacks & {
  store: StoreItem[];
  storeLogs: StoreLog[];
}) {
  const bn = lang === 'bn';
  const [search, setSearch] = useState('');
  const [ledgerFilter, setLedgerFilter] = useState<'ALL' | 'IN' | 'OUT'>('ALL');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const [editingItem, setEditingItem] = useState<StoreItem | null>(null);
  const [editForm, setEditForm] = useState({
    code: '',
    item: '',
    shop: '',
    memo: '',
    unit: 'PCS',
    qty: '0',
    min: '5',
  });

  const [movementModal, setMovementModal] = useState<'IN' | 'OUT' | null>(null);
  const [movForm, setMovForm] = useState({
    itemId: '',
    code: '',
    itemName: '',
    unit: 'PCS',
    qty: '10',
    shop: '',
    memo: '',
    amount: '0',
    remarks: '',
  });

  const totalReceivedIn = storeLogs
    .filter((l) => l.movement === 'IN')
    .reduce((a, b) => a + Number(b.qty || 0), 0);
  const totalDispatchedOut = storeLogs
    .filter((l) => l.movement === 'OUT')
    .reduce((a, b) => a + Number(b.qty || 0), 0);
  const currentTotalUnits = store.reduce((a, b) => a + Number(b.qty || 0), 0);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return store.filter((s) => {
      if (!q) return true;
      return (
        s.item.toLowerCase().includes(q) ||
        (s.code || '').toLowerCase().includes(q) ||
        (s.shop || '').toLowerCase().includes(q) ||
        (s.memo || '').toLowerCase().includes(q)
      );
    });
  }, [store, search]);

  const filteredLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...storeLogs].reverse().filter((l) => {
      if (ledgerFilter !== 'ALL' && l.movement !== ledgerFilter) return false;
      const iso = toInputDate(l.date);
      if (fromDate && iso && iso < fromDate) return false;
      if (toDate && iso && iso > toDate) return false;
      if (!q) return true;
      return (
        l.itemName.toLowerCase().includes(q) ||
        l.code.toLowerCase().includes(q) ||
        l.shop.toLowerCase().includes(q) ||
        l.memo.toLowerCase().includes(q)
      );
    });
  }, [storeLogs, ledgerFilter, fromDate, toDate, search]);

  const openMovement = (kind: 'IN' | 'OUT', preselect?: StoreItem) => {
    const target = preselect || store[0];
    setMovementModal(kind);
    setMovForm({
      itemId: target ? target.id : '__new__',
      code: target ? target.code : '',
      itemName: target ? target.item : '',
      unit: target ? target.unit : 'PCS',
      qty: '10',
      shop: target ? target.shop : '',
      memo: '',
      amount: '0',
      remarks: '',
    });
  };

  const handleSaveMovement = async (e: FormEvent) => {
    e.preventDefault();
    if (!movementModal) return;
    const qtyNum = Math.max(0, Number(movForm.qty) || 0);
    if (qtyNum <= 0) return;
    const today = todayDDMMYYYY();

    let targetId = movForm.itemId;
    let targetCode = movForm.code.trim();
    let targetName = movForm.itemName.trim();

    if (movementModal === 'IN' && movForm.itemId === '__new__') {
      if (!targetName) return;
      targetId = await onAdd('store', {
        date: today,
        code: targetCode || `ITM-${store.length + 1}`,
        item: targetName,
        category: 'Welding Supply',
        shop: movForm.shop.trim(),
        memo: movForm.memo.trim(),
        qty: qtyNum,
        unit: movForm.unit.trim() || 'PCS',
        min: 5,
      });
    } else {
      const existing = store.find((s) => s.id === targetId);
      if (!existing) return;
      targetCode = existing.code;
      targetName = existing.item;
      const nextQty =
        movementModal === 'IN'
          ? Number(existing.qty || 0) + qtyNum
          : Math.max(0, Number(existing.qty || 0) - qtyNum);
      await onUpdate('store', existing.id, {
        qty: nextQty,
        ...(movForm.shop.trim() ? { shop: movForm.shop.trim() } : {}),
        ...(movForm.memo.trim() ? { memo: movForm.memo.trim() } : {}),
      });
    }

    await onAdd('storeLogs', {
      date: today,
      itemId: targetId,
      code: targetCode,
      itemName: targetName,
      movement: movementModal,
      qty: qtyNum,
      shop: movForm.shop.trim(),
      memo: movForm.memo.trim(),
      amount: Number(movForm.amount) || 0,
      remarks: movForm.remarks.trim(),
    });
    await onLogAudit?.(
      `STORE_${movementModal}`,
      'Store Management',
      `${movementModal} ${qtyNum} ${targetName}`
    );
    setMovementModal(null);
  };

  const openEdit = (s: StoreItem) => {
    setEditingItem(s);
    setEditForm({
      code: s.code || '',
      item: s.item,
      shop: s.shop || '',
      memo: s.memo || '',
      unit: s.unit || 'PCS',
      qty: String(s.qty),
      min: String(s.min || 5),
    });
  };

  const handleSaveEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingItem || !editForm.item.trim()) return;
    await onUpdate('store', editingItem.id, {
      code: editForm.code.trim(),
      item: editForm.item.trim(),
      shop: editForm.shop.trim(),
      memo: editForm.memo.trim(),
      unit: editForm.unit.trim() || 'PCS',
      qty: Number(editForm.qty) || 0,
      min: Number(editForm.min) || 0,
    });
    setEditingItem(null);
  };

  return (
    <div className="space-y-4">
      {/* Top Search & Action Bar */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              bn
                ? 'পণ্যের নাম, কোড, দোকান বা মেমো নম্বর দিয়ে খুঁজুন...'
                : 'Search products by Name, Code, Shop / Vendor, or Memo No...'
            }
            className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (onPrintReport) {
                onPrintReport({
                  title: bn ? 'স্টোর ও ইনভেন্টরি স্টক ডাটাবেস' : 'Store & Inventory Stock Database',
                  subtitle: `${bn ? 'তারিখ' : 'Date'}: ${todayDDMMYYYY()} · ${filteredItems.length} ${bn ? 'টি পণ্য' : 'items'}`,
                  filename: `ittc-store-stock-${todayDDMMYYYY()}`,
                  summary: [
                    { label: bn ? 'মোট গ্রহণ (IN)' : 'Total IN', value: String(totalReceivedIn) },
                    { label: bn ? 'মোট ইস্যু (OUT)' : 'Total OUT', value: String(totalDispatchedOut) },
                    { label: bn ? 'বর্তমান স্টক' : 'Current Stock', value: String(currentTotalUnits) },
                  ],
                  columns: ['Code', 'Product Name', 'Shop / Vendor', 'Memo', 'Qty', 'Unit', 'Min Stock'],
                  rows: filteredItems.map((s) => [
                    s.code || '—',
                    s.item,
                    s.shop || '—',
                    s.memo || '—',
                    s.qty,
                    s.unit,
                    s.min,
                  ]),
                });
              } else {
                window.print();
              }
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 text-xs font-semibold cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>{bn ? 'স্টক ডাটাবেস প্রিন্ট' : 'Print Stock DB'}</span>
          </button>
          <button
            type="button"
            onClick={() => openMovement('IN')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{bn ? 'পণ্য গ্রহণ (IN)' : 'Product IN (Receive)'}</span>
          </button>
          <button
            type="button"
            onClick={() => openMovement('OUT')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold cursor-pointer"
          >
            <Minus className="w-3.5 h-3.5" />
            <span>{bn ? 'পণ্য ইস্যু (OUT)' : 'Product OUT (Issue)'}</span>
          </button>
        </div>
      </div>

      {/* 4 KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="bg-white dark:bg-slate-900 rounded-xl p-4 border border-slate-200 dark:border-slate-800">
          <div className="text-[11px] font-semibold text-slate-500 uppercase">
            {bn ? 'মোট কাঁচামাল আইটেম' : 'TOTAL RAW ITEMS'}
          </div>
          <div className="font-mono-num text-2xl font-extrabold text-slate-900 dark:text-white mt-1.5">
            {store.length}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-xl p-4 border border-emerald-200 dark:border-emerald-900/60">
          <div className="text-[11px] font-semibold text-teal-700 dark:text-teal-400 uppercase">
            {bn ? 'মোট গ্রহণ (IN)' : 'TOTAL RECEIVED (IN)'}
          </div>
          <div className="font-mono-num text-2xl font-extrabold text-teal-700 dark:text-teal-300 mt-1.5">
            {totalReceivedIn} Units
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-xl p-4 border border-amber-200 dark:border-amber-900/60">
          <div className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 uppercase">
            {bn ? 'মোট বিতরণ (OUT)' : 'TOTAL DISPATCHED (OUT)'}
          </div>
          <div className="font-mono-num text-2xl font-extrabold text-amber-700 dark:text-amber-300 mt-1.5">
            {totalDispatchedOut} Units
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-xl p-4 border border-indigo-200 dark:border-indigo-900/60">
          <div className="text-[11px] font-semibold text-indigo-700 dark:text-indigo-400 uppercase">
            {bn ? 'বর্তমান স্টোর ইউনিট' : 'CURRENT STORE UNITS'}
          </div>
          <div className="font-mono-num text-2xl font-extrabold text-indigo-700 dark:text-indigo-300 mt-1.5">
            {currentTotalUnits} Units
          </div>
        </div>
      </div>

      {/* Current Store Inventory Table */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <Package className="w-4 h-4 text-teal-600" />
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                {bn ? 'বর্তমান স্টোর ইনভেন্টরি' : 'Current Store Inventory'}
              </h3>
            </div>
            <p className="text-xs text-slate-500">
              {bn
                ? 'স্টক সংখ্যা বা দোকানের তথ্য সংশোধন করতে "Edit" এ ক্লিক করুন।'
                : 'Click "Edit" on any item to correct stock count, shop source, or details.'}
            </p>
          </div>
          <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 font-mono-num">
            {filteredItems.length} {bn ? 'টি পণ্য' : 'items'}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-[11px] font-semibold text-slate-500">
                <th className="py-2.5 px-4">{bn ? 'কোড (CODE)' : 'CODE (কোড)'}</th>
                <th className="py-2.5 px-4">{bn ? 'পণ্যের নাম' : 'PRODUCT NAME (পণ্যের নাম)'}</th>
                <th className="py-2.5 px-4">{bn ? 'দোকান / ভেন্ডর' : 'SHOP / VENDOR (দোকান)'}</th>
                <th className="py-2.5 px-4">{bn ? 'মেমো / চালান' : 'MEMO / INVOICE (মেমো নং)'}</th>
                <th className="py-2.5 px-4">{bn ? 'একক' : 'UNIT (একক)'}</th>
                <th className="py-2.5 px-4">{bn ? 'বর্তমান স্টক' : 'AVAILABLE STOCK (স্টক)'}</th>
                <th className="py-2.5 px-4 text-right">{bn ? 'অ্যাকশন' : 'ACTIONS (অ্যাকশন)'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {filteredItems.map((s) => {
                const low = s.qty <= (s.min || 5);
                return (
                  <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-2.5 px-4 font-mono-num text-xs font-semibold text-teal-700 dark:text-teal-400">
                      {s.code || '—'}
                    </td>
                    <td className="py-2.5 px-4 font-semibold text-slate-900 dark:text-white">
                      {s.item}
                    </td>
                    <td className="py-2.5 px-4 text-xs text-slate-500">{s.shop || '-'}</td>
                    <td className="py-2.5 px-4 text-xs text-slate-500 font-mono-num">
                      {s.memo || '-'}
                    </td>
                    <td className="py-2.5 px-4 text-xs font-semibold uppercase text-slate-600 dark:text-slate-300">
                      {s.unit}
                    </td>
                    <td className="py-2.5 px-4">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold font-mono-num ${
                          low
                            ? 'bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-300'
                            : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                        }`}
                      >
                        {low && <AlertTriangle className="w-3 h-3" />}
                        {s.qty} {s.unit.toLowerCase()}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(s)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                        >
                          <Edit3 className="w-3 h-3" />
                          <span>Edit</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => openMovement('IN', s)}
                          aria-label="Receive stock"
                          className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-emerald-50 text-teal-600 cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete('store', s.id)}
                          aria-label="Delete item"
                          className="p-1.5 rounded-md text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Stock Transaction Ledger (IN / OUT) */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
              {bn ? 'স্টক লেনদেন লেজার (IN / OUT)' : 'Stock Transaction Ledger (IN / OUT)'}
            </h3>
            <p className="text-xs text-slate-500">
              {bn
                ? 'ক্রয়, সরবরাহকারী, মেমো নম্বর ও বিতরণের বিবরণ'
                : 'Purchase, supplier, memo number, and dispatch logs.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="inline-flex p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              {(['ALL', 'IN', 'OUT'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setLedgerFilter(k)}
                  className={`px-2.5 py-1 rounded-md font-semibold cursor-pointer ${
                    ledgerFilter === k
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {k === 'ALL' ? (bn ? 'সব' : 'All') : k}
                </button>
              ))}
            </div>
            <label className="inline-flex items-center gap-1.5">
              <span className="text-slate-500">From:</span>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono-num"
              />
            </label>
            <label className="inline-flex items-center gap-1.5">
              <span className="text-slate-500">To:</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono-num"
              />
            </label>
          </div>
        </div>

        {filteredLogs.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            {bn ? 'কোনো স্টক লেনদেন পাওয়া যায়নি।' : 'No stock transaction entries found.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-[11px] font-semibold text-slate-500">
                  <th className="py-2.5 px-4">{bn ? 'তারিখ' : 'DATE (তারিখ)'}</th>
                  <th className="py-2.5 px-4">{bn ? 'কোড' : 'CODE'}</th>
                  <th className="py-2.5 px-4">{bn ? 'পণ্য' : 'PRODUCT NAME (পণ্য)'}</th>
                  <th className="py-2.5 px-4">{bn ? 'ধরন' : 'MOVEMENT'}</th>
                  <th className="py-2.5 px-4 text-right">{bn ? 'পরিমাণ' : 'QTY (পরিমাণ)'}</th>
                  <th className="py-2.5 px-4">{bn ? 'দোকান' : 'SHOP / VENDOR (দোকান)'}</th>
                  <th className="py-2.5 px-4">{bn ? 'মেমো নং' : 'MEMO / REF (মেমো নং)'}</th>
                  <th className="py-2.5 px-4 text-right">{bn ? 'টাকা (৳)' : 'AMOUNT (৳)'}</th>
                  <th className="py-2.5 px-4">{bn ? 'মন্তব্য' : 'REMARKS'}</th>
                  <th className="py-2.5 px-4 text-right">{bn ? 'অ্যাকশন' : 'ACTIONS'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {filteredLogs.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-2.5 px-4 font-mono-num text-xs">{l.date}</td>
                    <td className="py-2.5 px-4 font-mono-num text-xs text-teal-700 dark:text-teal-400">
                      {l.code || '—'}
                    </td>
                    <td className="py-2.5 px-4 font-semibold">{l.itemName}</td>
                    <td className="py-2.5 px-4 text-xs">
                      <span
                        className={`px-2 py-0.5 rounded-full font-bold ${
                          l.movement === 'IN'
                            ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                            : 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300'
                        }`}
                      >
                        {l.movement}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono-num font-bold">{l.qty}</td>
                    <td className="py-2.5 px-4 text-xs text-slate-600">{l.shop || '—'}</td>
                    <td className="py-2.5 px-4 text-xs font-mono-num">{l.memo || '—'}</td>
                    <td className="py-2.5 px-4 text-right font-mono-num font-bold">
                      {formatTaka(l.amount)}
                    </td>
                    <td className="py-2.5 px-4 text-xs text-slate-500">{l.remarks || '—'}</td>
                    <td className="py-2.5 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => onDelete('storeLogs', l.id)}
                        className="p-1.5 rounded-md text-red-600 hover:bg-red-50 cursor-pointer"
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

      {/* Product IN / OUT Modal */}
      {movementModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveMovement}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-lg w-full p-5 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="font-display text-base font-bold">
                {movementModal === 'IN'
                  ? bn
                    ? 'স্টোরে পণ্য গ্রহণ (Product IN)'
                    : 'Receive Material into Store (IN)'
                  : bn
                    ? 'স্টোর থেকে পণ্য ইস্যু (Product OUT)'
                    : 'Issue Material from Store (OUT)'}
              </h3>
              <button
                type="button"
                onClick={() => setMovementModal(null)}
                className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium mb-1">
                  {bn ? 'পণ্য নির্বাচন করুন *' : 'Select Product *'}
                </label>
                <select
                  value={movForm.itemId}
                  onChange={(e) => {
                    const v = e.target.value;
                    const found = store.find((x) => x.id === v);
                    setMovForm({
                      ...movForm,
                      itemId: v,
                      code: found ? found.code : '',
                      itemName: found ? found.item : '',
                      unit: found ? found.unit : 'PCS',
                      shop: found ? found.shop : movForm.shop,
                    });
                  }}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                >
                  {store.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code ? `[${s.code}] ` : ''}
                      {s.item} ({s.qty} {s.unit})
                    </option>
                  ))}
                  {movementModal === 'IN' && (
                    <option value="__new__">
                      {bn ? '+ নতুন আইটেম তৈরি করুন' : '+ Register New Material Item'}
                    </option>
                  )}
                </select>
              </div>

              {movementModal === 'IN' && movForm.itemId === '__new__' && (
                <>
                  <div>
                    <label className="block text-xs font-medium mb-1">
                      {bn ? 'পণ্যের কোড' : 'Product Code'}
                    </label>
                    <input
                      value={movForm.code}
                      onChange={(e) => setMovForm({ ...movForm, code: e.target.value })}
                      placeholder="E7018-3.2"
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono-num"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">
                      {bn ? 'পণ্যের নাম *' : 'Product Name *'}
                    </label>
                    <input
                      required
                      value={movForm.itemName}
                      onChange={(e) => setMovForm({ ...movForm, itemName: e.target.value })}
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">{bn ? 'একক' : 'Unit'}</label>
                    <input
                      value={movForm.unit}
                      onChange={(e) => setMovForm({ ...movForm, unit: e.target.value })}
                      placeholder="KG / PCS / CYL"
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                    />
                  </div>
                </>
              )}

              <div>
                <label className="block text-xs font-medium mb-1">
                  {bn ? 'পরিমাণ *' : 'Quantity *'}
                </label>
                <input
                  type="number"
                  required
                  min={1}
                  value={movForm.qty}
                  onChange={(e) => setMovForm({ ...movForm, qty: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  {bn ? 'দোকান / ভেন্ডর বা বিভাগ' : 'Shop / Vendor or Workshop'}
                </label>
                <input
                  value={movForm.shop}
                  onChange={(e) => setMovForm({ ...movForm, shop: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  {bn ? 'মেমো / চালান নং' : 'Memo / Invoice Ref'}
                </label>
                <input
                  value={movForm.memo}
                  onChange={(e) => setMovForm({ ...movForm, memo: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  {bn ? 'মোট মূল্য (৳)' : 'Amount (BDT)'}
                </label>
                <input
                  type="number"
                  min={0}
                  value={movForm.amount}
                  onChange={(e) => setMovForm({ ...movForm, amount: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono-num"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium mb-1">
                  {bn ? 'মন্তব্য' : 'Remarks'}
                </label>
                <input
                  value={movForm.remarks}
                  onChange={(e) => setMovForm({ ...movForm, remarks: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setMovementModal(null)}
                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold cursor-pointer"
              >
                {bn ? 'বাতিল' : 'Cancel'}
              </button>
              <button
                type="submit"
                className={`px-4 py-2 rounded-lg text-white text-xs font-semibold cursor-pointer ${
                  movementModal === 'IN' ? 'bg-teal-600 hover:bg-teal-700' : 'bg-amber-600 hover:bg-amber-700'
                }`}
              >
                {movementModal === 'IN' ? (bn ? 'স্টক যোগ করুন' : 'Confirm Receive') : bn ? 'ইস্যু কনফার্ম' : 'Confirm Issue'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Edit Item Modal */}
      {editingItem && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveEdit}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-md w-full p-5 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="font-display text-base font-bold">
                {bn ? 'স্টক আইটেম সম্পাদনা' : 'Edit Store Item'}
              </h3>
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">Code</label>
                <input
                  value={editForm.code}
                  onChange={(e) => setEditForm({ ...editForm, code: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Unit</label>
                <input
                  value={editForm.unit}
                  onChange={(e) => setEditForm({ ...editForm, unit: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium mb-1">Product Name *</label>
                <input
                  required
                  value={editForm.item}
                  onChange={(e) => setEditForm({ ...editForm, item: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Shop / Vendor</label>
                <input
                  value={editForm.shop}
                  onChange={(e) => setEditForm({ ...editForm, shop: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Memo / Invoice</label>
                <input
                  value={editForm.memo}
                  onChange={(e) => setEditForm({ ...editForm, memo: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Available Stock</label>
                <input
                  type="number"
                  min={0}
                  value={editForm.qty}
                  onChange={(e) => setEditForm({ ...editForm, qty: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Alert Threshold</label>
                <input
                  type="number"
                  min={0}
                  value={editForm.min}
                  onChange={(e) => setEditForm({ ...editForm, min: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono-num"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold cursor-pointer"
              >
                {bn ? 'বাতিল' : 'Cancel'}
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold cursor-pointer"
              >
                {bn ? 'আপডেট' : 'Update'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// 4. Job Price & Limit Setup
export function PricesView({
  prices,
  auditLogs = [],
  lang,
  onAdd,
  onUpdate,
  onDelete,
  onLogAudit,
}: CrudCallbacks & { prices: JobPrice[]; auditLogs?: AuditLog[] }) {
  const bn = lang === 'bn';
  const limitRentals = useMemo(() => parseSupervisorLimitRentals(auditLogs), [auditLogs]);
  const [showAdd, setShowAdd] = useState(false);
  const [cat, setCat] = useState('');
  const [price, setPrice] = useState('1200');
  const [limit, setLimit] = useState('10');
  const [addingCat, setAddingCat] = useState(false);
  const [priceError, setPriceError] = useState('');
  const [savedRowId, setSavedRowId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { price: string; limit: string }>>({});

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = cat.trim();
    if (!trimmed || addingCat) return;
    setPriceError('');
    if (prices.some((p) => p.cat.trim() === trimmed)) {
      setPriceError(
        bn
          ? `"${trimmed}" ক্যাটাগরি আগেই তালিকায় আছে।`
          : `Category "${trimmed}" already exists.`
      );
      return;
    }
    setAddingCat(true);
    try {
      await onAdd('prices', {
        cat: trimmed,
        price: Number(price) || 0,
        limit: Math.max(1, Number(limit) || 1),
        active: true,
      });
      try {
        await onLogAudit?.('ADD_CATEGORY', 'Job Price & Limits', `Added ${trimmed} (৳${price})`);
      } catch {
        // ignore secondary audit failure
      }
      setCat('');
      setPrice('1200');
      setLimit('10');
    } catch (err) {
      setPriceError(
        err instanceof Error
          ? err.message
          : bn
            ? 'ক্যাটাগরি যোগ করতে সমস্যা হয়েছে।'
            : 'Failed to add job category.'
      );
    } finally {
      setAddingCat(false);
    }
  };

  const commitRow = async (p: JobPrice, nextPriceStr?: string, nextLimitStr?: string) => {
    const nextPrice = Math.max(0, Number(nextPriceStr ?? drafts[p.id]?.price ?? p.price) || 0);
    const nextLimit = Math.max(1, Number(nextLimitStr ?? drafts[p.id]?.limit ?? p.limit) || 1);
    if (nextPrice === p.price && nextLimit === p.limit) return;
    setPriceError('');
    try {
      await onUpdate('prices', p.id, { price: nextPrice, limit: nextLimit });
      setDrafts((prev) => {
        const copy = { ...prev };
        delete copy[p.id];
        return copy;
      });
      setSavedRowId(p.id);
      window.setTimeout(() => {
        setSavedRowId((cur) => (cur === p.id ? null : cur));
      }, 2200);
      try {
        await onLogAudit?.(
          'UPDATE_PRICE_LIMIT',
          'Job Price & Limits',
          `${p.cat}: Limit ${nextLimit}, Fee ৳${nextPrice}`
        );
      } catch {
        // ignore secondary audit failure
      }
    } catch (err) {
      setPriceError(
        err instanceof Error
          ? err.message
          : bn
            ? 'ক্যাটাগরি আপডেট করতে সমস্যা হয়েছে।'
            : 'Failed to update category.'
      );
    }
  };

  const hasSecondaryContent = showAdd || Boolean(priceError) || limitRentals.length > 0;

  return (
    <div className="space-y-4 lg:space-y-0 lg:flex-1 lg:min-h-0 lg:flex lg:flex-col lg:gap-3.5">
      {/* Fixed / Non-Scrolling Top Header */}
      <div className="shrink-0 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
            {bn
              ? 'জব ক্যাটাগরি মূল্য ও স্টুডেন্ট কোটা সেটআপ'
              : 'Job Category Pricing & Student Quota Setup'}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {bn
              ? 'প্র্যাকটিক্যাল ওয়েল্ডিং ফি (BDT), স্টুডেন্ট কোটা নির্ধারণ ও নতুন ক্যাটাগরি যোগ করুন (১–১৯ ডিফল্ট ক্যাটাগরি ডিলিট হবে না)'
              : 'Set practical welding fees (BDT), student quotas, and register new categories (01–19 are default and protected)'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setPriceError('');
            setShowAdd((v) => !v);
          }}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold cursor-pointer self-start sm:self-auto"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{bn ? '+ নতুন জব ক্যাটাগরি যোগ' : '+ Add New Job Category'}</span>
        </button>
      </div>

      {/* Scrollable Lower Content Area */}
      <div
        className={
          hasSecondaryContent
            ? 'lg:flex-1 lg:min-h-0 lg:overflow-y-auto space-y-4'
            : 'lg:flex-1 lg:min-h-0 lg:flex lg:flex-col'
        }
      >
      {priceError && (
        <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-2.5 text-xs font-medium text-red-700 dark:text-red-300">
          {priceError}
        </div>
      )}
      {showAdd && (
        <form
          onSubmit={handleAdd}
          className="bg-white dark:bg-slate-900 rounded-xl border border-teal-200 dark:border-teal-800 p-4 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end"
        >
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium mb-1">
              {bn ? 'ক্যাটাগরি / টেস্ট পজিশন *' : 'Welding / Test Position Category *'}
            </label>
            <input
              required
              value={cat}
              onChange={(e) => setCat(e.target.value)}
              placeholder="e.g. 6G Alloy Pipe"
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">
              {bn ? 'সর্বোচ্চ জব / স্টুডেন্ট' : 'Max Allowed Jobs'}
            </label>
            <input
              type="number"
              min={1}
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono-num"
            />
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="block text-xs font-medium mb-1">
                {bn ? 'স্ট্যান্ডার্ড ফি (৳)' : 'Fee (BDT)'}
              </label>
              <input
                type="number"
                min={0}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono-num"
              />
            </div>
            <button
              type="submit"
              disabled={addingCat}
              className="px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer h-[34px]"
            >
              {addingCat ? (bn ? 'যোগ হচ্ছে...' : 'Adding...') : bn ? 'যোগ' : 'Add'}
            </button>
          </div>
        </form>
      )}

      <div
        className={`bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden ${
          hasSecondaryContent ? '' : 'lg:flex-1 lg:min-h-0 lg:flex lg:flex-col'
        }`}
      >
        <div
          className={`overflow-x-auto ${
            hasSecondaryContent ? '' : 'lg:flex-1 lg:min-h-0 lg:overflow-y-auto'
          }`}
        >
          <table className="w-full text-left border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-[#111b2e]">
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#111b2e] text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                <th className="py-3 px-4 w-16">SL</th>
                <th className="py-3 px-4">
                  {bn ? 'ওয়েল্ডিং / টেস্ট পজিশন ক্যাটাগরি' : 'WELDING / TEST POSITION CATEGORY'}
                </th>
                <th className="py-3 px-4">
                  {bn ? 'সর্বোচ্চ অনুমোদিত জব / স্টুডেন্ট' : 'MAX ALLOWED JOBS / STUDENT'}
                </th>
                <th className="py-3 px-4">
                  {bn ? 'স্ট্যান্ডার্ড জব ফি (BDT)' : 'STANDARD JOB FEE (BDT)'}
                </th>
                <th className="py-3 px-4 text-right">{bn ? 'অ্যাকশন' : 'ACTION'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {sortJobPrices(prices).map((p, idx) => {
                const draft = drafts[p.id];
                const curLimit = draft?.limit ?? String(p.limit);
                const curPrice = draft?.price ?? String(p.price);
                const isDirty =
                  draft !== undefined &&
                  (Math.max(1, Number(curLimit) || 1) !== p.limit ||
                    Math.max(0, Number(curPrice) || 0) !== p.price);
                const isDefaultProtected = isProtectedDefaultPrice(p, idx);
                return (
                  <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-2.5 px-4 font-mono-num text-xs text-slate-400">
                      {String(idx + 1).padStart(2, '0')}
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-slate-900 dark:text-white text-xs sm:text-sm">
                          {p.cat}
                        </span>
                        {isDefaultProtected ? (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                            {bn ? 'ডিফল্ট' : 'Default'}
                          </span>
                        ) : (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
                            {bn ? 'কাস্টম জব' : 'Custom Job'}
                          </span>
                        )}
                        {savedRowId === p.id && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                            {bn ? 'সেভ হয়েছে ✓' : 'Saved ✓'}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="inline-flex items-center gap-2">
                        <input
                          type="number"
                          min={1}
                          value={curLimit}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [p.id]: { price: curPrice, limit: e.target.value },
                            }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void commitRow(p);
                            }
                          }}
                          onBlur={() => void commitRow(p)}
                          className="w-20 px-2.5 py-1.5 text-xs font-mono-num font-bold text-center rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                        />
                        <span className="text-xs text-slate-500">Jobs</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="inline-flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-400">৳</span>
                        <input
                          type="number"
                          min={0}
                          value={curPrice}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [p.id]: { limit: curLimit, price: e.target.value },
                            }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void commitRow(p);
                            }
                          }}
                          onBlur={() => void commitRow(p)}
                          className="w-28 px-2.5 py-1.5 text-xs font-mono-num font-bold text-right rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                        />
                      </div>
                    </td>
                    <td className="py-2.5 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5 justify-end">
                        {isDirty && (
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              void commitRow(p);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-teal-600 hover:bg-teal-700 text-white cursor-pointer"
                          >
                            <span>{bn ? 'সেভ' : 'Save'}</span>
                          </button>
                        )}
                        {isDefaultProtected ? (
                          <span
                            title={
                              bn
                                ? '১–১৯ নম্বর ডিফল্ট জব ক্যাটাগরি ডিলিট করা যাবে না (দাম ও লিমিট পরিবর্তন করা যাবে)'
                                : 'Default job categories 01–19 cannot be deleted (prices & limits can be raised/edited)'
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium text-slate-400 dark:text-slate-500 bg-slate-100/80 dark:bg-slate-800/70 border border-slate-200/70 dark:border-slate-700/60 select-none"
                          >
                            <Lock className="w-3 h-3" />
                            <span>{bn ? 'সুরক্ষিত' : 'Protected'}</span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onDelete('prices', p.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>{bn ? 'মুছুন' : 'Delete'}</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {limitRentals.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-indigo-200 dark:border-indigo-900/60 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 bg-indigo-50/50 dark:bg-indigo-950/20">
            <div>
              <h3 className="text-xs font-extrabold uppercase tracking-wide text-indigo-950 dark:text-indigo-200">
                {bn
                  ? `সুপারভাইজার ভাড়া নেওয়া অতিরিক্ত জব লিমিট (${limitRentals.length})`
                  : `Supervisor Rented Job Limits (${limitRentals.length})`}
              </h3>
              <p className="text-[11px] text-slate-500">
                {bn
                  ? 'স্টুডেন্ট কোটা পূর্ণ হলে সুপারভাইজারের অনুমোদিত অতিরিক্ত লিমিট এখানে যুক্ত থাকে'
                  : 'Extra practical job quotas granted per student & category by supervisors'}
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-[11px] font-semibold text-slate-500">
                  <th className="py-2.5 px-4">Date</th>
                  <th className="py-2.5 px-4">Student Code</th>
                  <th className="py-2.5 px-4">Category</th>
                  <th className="py-2.5 px-4 text-center">Extra Limit</th>
                  <th className="py-2.5 px-4">Supervisor Name</th>
                  <th className="py-2.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {[...limitRentals].reverse().map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-2.5 px-4 font-mono-num text-slate-500">
                      {r.date} {r.time ? `· ${r.time}` : ''}
                    </td>
                    <td className="py-2.5 px-4 font-mono-num font-bold text-teal-700 dark:text-teal-400">
                      {r.studentCode}
                    </td>
                    <td className="py-2.5 px-4 font-semibold text-slate-900 dark:text-white">
                      {r.category}
                    </td>
                    <td className="py-2.5 px-4 text-center">
                      <span className="inline-block px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 font-mono-num font-bold text-indigo-700 dark:text-indigo-300">
                        +{r.extraLimit}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-slate-700 dark:text-slate-200 font-medium">
                      {r.supervisorName}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => onDelete('auditLogs', r.id)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>{bn ? 'বাতিল' : 'Revoke'}</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

// 5. Job Return & Retrain Logs
export function ReturnsView({
  returns,
  jobs,
  students = [],
  prices,
  lang,
  onAdd,
  onDelete,
  onOpenStudentFile,
  onLogAudit,
  onPrintReport,
}: {
  returns: JobReturn[];
  jobs: JobEntry[];
  students?: Student[];
  prices: JobPrice[];
  lang: Lang;
  onAdd: (key: SubCollectionKey, raw: Record<string, unknown>) => Promise<string>;
  onDelete: (key: SubCollectionKey, id: string) => Promise<void>;
  onOpenStudentFile: (studentCode: string) => void;
  onLogAudit?: (action: string, module: string, detail: string) => Promise<void>;
  onPrintReport?: (spec: PrintableReportSpec) => void;
}) {
  const bn = lang === 'bn';
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState<'all' | ReturnTypeOption>('all');
  const [showModal, setShowModal] = useState(false);
  const [returnNotice, setReturnNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [form, setForm] = useState({
    no: '',
    code: '',
    sname: '',
    cat: prices[0]?.cat || '6G TIG',
    act: 'Plate Return' as ReturnTypeOption,
    reason: '',
    fee: '0',
  });

  const jobPayByNo = useMemo(() => {
    const map = new Map<string, JobEntry>();
    jobs.forEach((j) => {
      const k = (j.no || '').trim().toLowerCase();
      if (k) map.set(k, j);
    });
    return map;
  }, [jobs]);

  const retrainCount = returns.filter((r) => r.act === 'Retrain').length;
  const plateReturnCount = returns.filter((r) => r.act === 'Plate Return').length;
  const failedCount = returns.filter((r) => r.act === 'Failed / Rework').length;

  const categories = useMemo(() => {
    const set = new Set<string>(prices.map((p) => p.cat));
    returns.forEach((r) => r.cat && set.add(r.cat));
    return Array.from(set);
  }, [prices, returns]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const targetDate = fromInputDate(dateFilter);
    return [...returns].reverse().filter((r) => {
      if (targetDate && r.date !== targetDate) return false;
      if (catFilter !== 'all' && r.cat !== catFilter) return false;
      if (typeFilter !== 'all' && r.act !== typeFilter) return false;
      if (!q) return true;
      return (
        r.sname.toLowerCase().includes(q) ||
        r.code.toLowerCase().includes(q) ||
        r.no.toLowerCase().includes(q) ||
        r.reason.toLowerCase().includes(q) ||
        r.cat.toLowerCase().includes(q)
      );
    });
  }, [returns, search, dateFilter, catFilter, typeFilter]);

  const handleSelectJob = (jobNo: string) => {
    const found = jobs.find((j) => j.no.trim().toLowerCase() === jobNo.trim().toLowerCase());
    if (found) {
      setForm((prev) => ({
        ...prev,
        no: found.no,
        code: found.sid,
        sname: found.sname,
        cat: found.cat,
      }));
    } else {
      setForm((prev) => ({ ...prev, no: jobNo }));
    }
  };

  const selectedModalJob = form.no.trim() ? jobPayByNo.get(form.no.trim().toLowerCase()) : undefined;
  const estimatedRefund = selectedModalJob
    ? Math.max(0, Number(selectedModalJob.pay || 0) - Math.max(0, Number(form.fee) || 0))
    : 0;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.no.trim() || !form.sname.trim()) return;
    const normNo = form.no.trim().toLowerCase();
    const duplicate = returns.some((r) => (r.no || '').trim().toLowerCase() === normNo);
    if (duplicate) {
      setReturnNotice({
        type: 'error',
        text: bn
          ? `জব ${form.no.trim()} ইতিমধ্যে রিটার্ন তালিকায় রয়েছে।`
          : `Job ${form.no.trim()} is already in the return log.`,
      });
      setShowModal(false);
      return;
    }

    const matchedJob = jobPayByNo.get(normNo);
    const feeNum = Math.max(0, Number(form.fee) || 0);
    const refundAmt = matchedJob ? Math.max(0, Number(matchedJob.pay || 0) - feeNum) : 0;
    const normCode = form.code.trim().toLowerCase();
    const matchedStudent = students.find(
      (s) => (normCode && s.code.trim().toLowerCase() === normCode) || (matchedJob && s.code.trim().toLowerCase() === matchedJob.sid.trim().toLowerCase())
    );

    await onAdd('returns', {
      date: todayDDMMYYYY(),
      no: form.no.trim(),
      code: form.code.trim(),
      sname: form.sname.trim(),
      cat: form.cat,
      reason: form.reason.trim() || 'No remarks',
      act: form.act,
      fee: feeNum,
    });
    await onLogAudit?.(
      'ADD_RETURN',
      'Job Return / Retrain',
      `${form.act}: ${form.sname} (${form.no})${
        matchedStudent && refundAmt > 0 ? ` · Refund +${refundAmt}৳ to Profile` : ''
      }`
    );
    setReturnNotice({
      type: 'success',
      text:
        matchedStudent && refundAmt > 0
          ? bn
            ? `জব ${form.no.trim()} রিটার্ন হয়েছে এবং ${formatTaka(refundAmt)} সাথে সাথে ${form.sname.trim()}-এর প্রোফাইলে যোগ হয়েছে!`
            : `Job ${form.no.trim()} returned & ${formatTaka(refundAmt)} credited immediately to ${form.sname.trim()}'s profile!`
          : bn
            ? `জব ${form.no.trim()} রিটার্ন তালিকায় সংরক্ষিত হয়েছে।`
            : `Return entry saved for ${form.no.trim()}.`,
    });
    setShowModal(false);
    setForm({
      no: '',
      code: '',
      sname: '',
      cat: prices[0]?.cat || '6G TIG',
      act: 'Plate Return',
      reason: '',
      fee: '0',
    });
  };

  const handleExport = () => {
    const csv = toCsv(
      ['Return Date', 'Student Name', 'Code', 'Category', 'Original Job No', 'Return Type', 'Remarks', 'Fee'],
      filtered.map((r) => [r.date, r.sname, r.code, r.cat, r.no, r.act, r.reason, r.fee])
    );
    downloadFile(`ittc-returns-${todayDDMMYYYY()}.csv`, csv, 'text/csv;charset=utf-8');
  };

  return (
    <div className="space-y-4 lg:space-y-0 lg:flex-1 lg:min-h-0 lg:flex lg:flex-col lg:gap-3">
      {/* Sticky / Non-Scrolling Top Controls */}
      <div className="shrink-0 space-y-2.5">
      {/* Header Banner */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 border border-amber-200/70 dark:border-amber-800/60 shrink-0">
            <RotateCcw className="w-5 h-5" />
          </span>
          <div>
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
              {bn ? 'জব রিটার্ন ও রিট্রেইন লগ' : 'Job Return & Retrain Logs'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {bn
                ? 'রিটার্ন হওয়া জব, ত্রুটি বিশ্লেষণ ও রিট্রেইন ইতিহাস'
                : 'Dedicated log of returned jobs, defect reworking, and retrain history'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{bn ? '+ নতুন রিটার্ন এন্ট্রি' : '+ New Return Entry'}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (onPrintReport) {
                onPrintReport({
                  title: bn ? 'জব রিটার্ন ও রি-ট্রেইন রেজিস্টার' : 'Job Return & Retrain Register',
                  subtitle: `${bn ? 'তারিখ' : 'Date'}: ${todayDDMMYYYY()} · ${filtered.length} ${bn ? 'টি রেকর্ড' : 'records'}`,
                  filename: `ittc-returns-${todayDDMMYYYY()}`,
                  columns: ['Date', 'Student Name', 'Code', 'Category', 'Job No', 'Type', 'Remarks', 'Fee'],
                  rows: filtered.map((r) => [
                    r.date,
                    r.sname || '—',
                    r.code || '—',
                    r.cat || '—',
                    r.no,
                    r.act,
                    r.reason,
                    formatTaka(r.fee),
                  ]),
                });
              } else {
                window.print();
              }
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 text-xs font-semibold cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>{bn ? 'রেজিস্টার প্রিন্ট' : 'Print Register'}</span>
          </button>
          <button
            type="button"
            onClick={handleExport}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>{bn ? 'এক্সেল এক্সপোর্ট (.csv)' : 'Export Excel (.csv)'}</span>
          </button>
        </div>
      </div>

      {returnNotice && (
        <div
          className={`px-4 py-2.5 rounded-xl border text-xs font-medium flex items-center justify-between gap-2 ${
            returnNotice.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
              : 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200'
          }`}
        >
          <span>{returnNotice.text}</span>
          <button
            type="button"
            onClick={() => setReturnNotice(null)}
            className="p-0.5 rounded hover:bg-black/5 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 4 KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="bg-white dark:bg-slate-900 rounded-xl p-4 border border-slate-200 dark:border-slate-800 flex items-center gap-3">
          <span className="p-2.5 rounded-xl bg-teal-50 dark:bg-teal-950/60 text-teal-600">
            <Package className="w-4 h-4" />
          </span>
          <div>
            <div className="text-xs text-slate-500">{bn ? 'মোট রিটার্ন' : 'Total Returns'}</div>
            <div className="font-mono-num text-xl font-extrabold">{returns.length}</div>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-xl p-4 border border-slate-200 dark:border-slate-800 flex items-center gap-3">
          <span className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600">
            <RotateCcw className="w-4 h-4" />
          </span>
          <div>
            <div className="text-xs text-slate-500">
              {bn ? 'রিট্রেইন প্র্যাকটিস' : 'Retrain Practice'}
            </div>
            <div className="font-mono-num text-xl font-extrabold text-blue-600 dark:text-blue-400">
              {retrainCount}
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-xl p-4 border border-slate-200 dark:border-slate-800 flex items-center gap-3">
          <span className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-600">
            <AlertTriangle className="w-4 h-4" />
          </span>
          <div>
            <div className="text-xs text-slate-500">{bn ? 'প্লেট রিটার্ন' : 'Plate Return'}</div>
            <div className="font-mono-num text-xl font-extrabold text-amber-600 dark:text-amber-400">
              {plateReturnCount}
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-xl p-4 border border-slate-200 dark:border-slate-800 flex items-center gap-3">
          <span className="p-2.5 rounded-xl bg-red-50 dark:bg-red-950/60 text-red-600">
            <AlertTriangle className="w-4 h-4" />
          </span>
          <div>
            <div className="text-xs text-slate-500">
              {bn ? 'ব্যর্থ / রিওয়ার্ক' : 'Failed / Rework'}
            </div>
            <div className="font-mono-num text-xl font-extrabold text-red-600 dark:text-red-400">
              {failedCount}
            </div>
          </div>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              bn
                ? 'ছাত্রের নাম, কোড, জব নং বা মন্তব্য দিয়ে খুঁজুন...'
                : 'Search by student name, code, job no, remarks...'
            }
            className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
          />
        </div>
        <label className="inline-flex items-center gap-1.5 text-xs">
          <span className="text-slate-500">Date:</span>
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono-num"
          />
        </label>
        <select
          value={catFilter}
          onChange={(e) => setCatFilter(e.target.value)}
          className="px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
        >
          <option value="all">{bn ? 'সকল ক্যাটাগরি' : 'All Categories'}</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as 'all' | ReturnTypeOption)}
          className="px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
        >
          <option value="all">{bn ? 'সকল রিটার্ন ধরন' : 'All Return Types'}</option>
          <option value="Retrain">Retrain</option>
          <option value="Plate Return">Plate Return</option>
          <option value="Failed / Rework">Failed / Rework</option>
        </select>
      </div>
      </div>

      {/* Register Table */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden lg:flex-1 lg:min-h-0 lg:flex lg:flex-col">
        <div className="shrink-0 px-5 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
          <span className="font-display font-bold text-slate-900 dark:text-white uppercase">
            {bn
              ? `জব রিটার্ন ও রিট্রেইন রেজিস্টার (${filtered.length})`
              : `JOB RETURN & RETRAIN REGISTER (${filtered.length})`}
          </span>
          <span className="text-slate-500">
            Total {filtered.length} records found
          </span>
        </div>

        {filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            {bn ? 'কোনো রিটার্ন / রিট্রেইন রেকর্ড নেই।' : 'No return or retrain records found.'}
          </div>
        ) : (
          <div className="overflow-x-auto lg:flex-1 lg:min-h-0 lg:overflow-y-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-[#111b2e]">
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#111b2e] text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 px-4">SL</th>
                  <th className="py-2.5 px-4">{bn ? 'রিটার্ন তারিখ' : 'RETURN DATE'}</th>
                  <th className="py-2.5 px-4">{bn ? 'ছাত্রের নাম' : 'STUDENT NAME'}</th>
                  <th className="py-2.5 px-4">{bn ? 'কোড' : 'CODE'}</th>
                  <th className="py-2.5 px-4">{bn ? 'ক্যাটাগরি' : 'POSITION / CATEGORY'}</th>
                  <th className="py-2.5 px-4">{bn ? 'মূল জব নং' : 'ORIGINAL JOB NO'}</th>
                  <th className="py-2.5 px-4">{bn ? 'রিটার্ন ধরন' : 'RETURN TYPE'}</th>
                  <th className="py-2.5 px-4">{bn ? 'ত্রুটি বিশ্লেষণ ও মন্তব্য' : 'DEFECT ANALYSIS & REMARKS'}</th>
                  <th className="py-2.5 px-4 text-right">{bn ? 'প্রোফাইল' : 'PROFILE'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {filtered.map((r, idx) => {
                  const matchedJob = jobPayByNo.get((r.no || '').trim().toLowerCase());
                  const refunded = matchedJob
                    ? Math.max(0, Number(matchedJob.pay || 0) - Math.max(0, Number(r.fee || 0)))
                    : 0;
                  return (
                  <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-2.5 px-4 font-mono-num text-xs text-slate-400">{idx + 1}</td>
                    <td className="py-2.5 px-4 font-mono-num text-xs whitespace-nowrap">{r.date}</td>
                    <td className="py-2.5 px-4 font-bold text-slate-900 dark:text-white text-xs sm:text-sm">
                      {r.sname}
                    </td>
                    <td className="py-2.5 px-4 font-mono-num text-xs font-bold text-teal-700 dark:text-teal-400">
                      {r.code || '—'}
                    </td>
                    <td className="py-2.5 px-4 text-xs font-medium">{r.cat}</td>
                    <td className="py-2.5 px-4 font-mono-num text-xs font-semibold">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span>{r.no}</span>
                        {refunded > 0 && (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-[9px] font-bold text-emerald-700 dark:text-emerald-300">
                            +{formatTaka(refunded)} {bn ? 'প্রোফাইলে যোগ' : 'Credited'}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 text-xs">
                      <span
                        className={`px-2.5 py-0.5 rounded-md font-semibold ${
                          r.act === 'Retrain'
                            ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300'
                            : r.act === 'Plate Return'
                              ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300'
                              : 'bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-300'
                        }`}
                      >
                        {r.act}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-xs text-slate-600 dark:text-slate-300">
                      <span className={r.reason === 'No remarks' ? 'italic text-slate-400' : ''}>
                        {r.reason || 'No remarks'}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        {r.code && (
                          <button
                            type="button"
                            onClick={() => onOpenStudentFile(r.code)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-teal-700 dark:text-teal-300 text-xs font-semibold hover:bg-emerald-100 cursor-pointer"
                          >
                            <span>View File</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onDelete('returns', r.id)}
                          aria-label="Delete return log"
                          className="p-1.5 rounded-md text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );})}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Return Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <form
            onSubmit={handleSubmit}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-lg w-full p-5 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="font-display text-base font-bold">
                {bn ? 'নতুন জব রিটার্ন / রিট্রেইন এন্ট্রি' : 'New Return / Retrain Entry'}
              </h3>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">
                  {bn ? 'মূল জব নং *' : 'Original Job No *'}
                </label>
                <input
                  required
                  list="ittc-return-job-list"
                  value={form.no}
                  onChange={(e) => handleSelectJob(e.target.value)}
                  placeholder="20261115-034"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono-num"
                />
                <datalist id="ittc-return-job-list">
                  {jobs.map((j) => (
                    <option key={j.id} value={j.no}>
                      {j.sname} ({j.sid}) - {j.cat}
                    </option>
                  ))}
                </datalist>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  {bn ? 'স্টুডেন্ট কোড' : 'Student Code'}
                </label>
                <input
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  placeholder="14/23"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  {bn ? 'ছাত্রের নাম *' : 'Student Name *'}
                </label>
                <input
                  required
                  value={form.sname}
                  onChange={(e) => setForm({ ...form, sname: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  {bn ? 'পজিশন / ক্যাটাগরি' : 'Category'}
                </label>
                <select
                  value={form.cat}
                  onChange={(e) => setForm({ ...form, cat: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                >
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  {bn ? 'রিটার্ন ধরন' : 'Return Type'}
                </label>
                <select
                  value={form.act}
                  onChange={(e) => setForm({ ...form, act: e.target.value as ReturnTypeOption })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                >
                  <option value="Retrain">Retrain</option>
                  <option value="Plate Return">Plate Return</option>
                  <option value="Failed / Rework">Failed / Rework</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{bn ? 'ফি (৳)' : 'Fee (BDT)'}</label>
                <input
                  type="number"
                  min={0}
                  value={form.fee}
                  onChange={(e) => setForm({ ...form, fee: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono-num"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium mb-1">
                  {bn ? 'ত্রুটি বিশ্লেষণ ও মন্তব্য' : 'Defect Analysis & Remarks'}
                </label>
                <input
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  placeholder="Root porosity / 4G change for 6G"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
            </div>
            {selectedModalJob && estimatedRefund > 0 && (
              <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-3 py-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                {bn
                  ? `রিটার্ন সেভ হলে ${formatTaka(estimatedRefund)} সাথে সাথে ${selectedModalJob.sname}-এর প্রোফাইলে যোগ হয়ে যাবে।`
                  : `${formatTaka(estimatedRefund)} will be immediately credited to ${selectedModalJob.sname}'s profile.`}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold cursor-pointer"
              >
                {bn ? 'বাতিল' : 'Cancel'}
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold cursor-pointer"
              >
                {bn ? 'লগ সেভ করুন' : 'Save Return Entry'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// ICAO 9303 TD3 Passport MRZ Parser
interface ParsedMrz {
  valid: boolean;
  passportNo: string;
  surname: string;
  givenNames: string;
  fullName: string;
  nationality: string;
  dob: string;
  gender: string;
  expiryDate: string;
}

function formatMrzDate(yymmdd: string, isExpiry = false): string {
  if (!/^\d{6}$/.test(yymmdd)) return '';
  const yy = Number(yymmdd.slice(0, 2));
  const mm = yymmdd.slice(2, 4);
  const dd = yymmdd.slice(4, 6);
  const century = isExpiry ? 2000 : yy > 30 ? 1900 : 2000;
  return `${century + yy}-${mm}-${dd}`;
}

function parseTD3Mrz(rawText: string): ParsedMrz | null {
  const lines = rawText
    .toUpperCase()
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, '').trim())
    .filter(Boolean);
  if (lines.length < 2) return null;
  const line1 = lines[0].padEnd(44, '<').slice(0, 44);
  const line2 = lines[1].padEnd(44, '<').slice(0, 44);
  if (!line1.startsWith('P')) return null;

  const nameSection = line1.slice(5);
  const [rawSurname, rawGiven = ''] = nameSection.split('<<');
  const surname = rawSurname.replace(/</g, ' ').trim();
  const givenNames = rawGiven.replace(/</g, ' ').trim();
  const fullName = [givenNames, surname].filter(Boolean).join(' ') || 'CANDIDATE';

  const passportNo = line2.slice(0, 9).replace(/</g, '').trim();
  const nationality = line2.slice(10, 13).replace(/</g, '').trim();
  const dob = formatMrzDate(line2.slice(13, 19), false);
  const gender = line2.slice(20, 21).replace('<', 'X');
  const expiryDate = formatMrzDate(line2.slice(21, 27), true);

  return {
    valid: Boolean(passportNo),
    passportNo,
    surname,
    givenNames,
    fullName,
    nationality,
    dob,
    gender,
    expiryDate,
  };
}

// 6. DocuList & Passport System
export function DocsView({
  docs,
  lang,
  mode,
  userEmail,
  cloudConnected,
  onAdd,
  onUpdate,
  onDelete,
  onSync,
  onLogAudit,
}: CrudCallbacks & {
  docs: DocItem[];
  mode: 'cloud' | 'local';
  userEmail?: string | null;
  cloudConnected: boolean;
  onSync: () => Promise<boolean>;
}) {
  const bn = lang === 'bn';
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [subTab, setSubTab] = useState<'doculist' | 'extractor'>('doculist');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | PassportStatus>('all');
  const [tradeFilter, setTradeFilter] = useState('all');
  const [syncing, setSyncing] = useState(false);

  const [showModal, setShowModal] = useState(false);
  const [editingDoc, setEditingDoc] = useState<DocItem | null>(null);
  const [docForm, setDocForm] = useState({
    code: '',
    who: '',
    trade: '6G Pipe Welder (TIG+ARC)',
    phone: '',
    docNo: '',
    expiry: '',
    status: 'Original Held' as PassportStatus,
    medical: 'Fit' as MedicalStatus,
    policeClearance: 'Pending' as PoliceStatus,
    certificate: 'In Progress' as CertStatus,
    bmetVisa: 'Processing' as VisaStatus,
    flightStatus: 'Waiting' as FlightStatus,
    flightDate: '',
    agencyCountry: '',
    note: '',
  });

  // MRZ Extractor state
  const [mrzInput, setMrzInput] = useState('');
  const [mrzExtra, setMrzExtra] = useState({
    code: '',
    trade: '6G Pipe Welder (TIG+ARC)',
    phone: '',
    agencyCountry: 'Saudi Arabia',
    status: 'Original Held' as PassportStatus,
  });
  const [mrzSavedNotice, setMrzSavedNotice] = useState('');

  const parsedMrz = useMemo(() => parseTD3Mrz(mrzInput), [mrzInput]);

  const trades = useMemo(() => {
    const set = new Set<string>();
    docs.forEach((d) => d.trade && set.add(d.trade));
    return Array.from(set);
  }, [docs]);

  const originalPassportsCount = docs.filter((d) => d.status === 'Original Held').length;
  const medicalFitCount = docs.filter((d) => d.medical === 'Fit').length;
  const visaStampedCount = docs.filter((d) => d.bmetVisa === 'Stamped').length;
  const flightScheduledCount = docs.filter((d) => d.flightStatus === 'Scheduled').length;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return docs.filter((d) => {
      if (statusFilter !== 'all' && d.status !== statusFilter) return false;
      if (tradeFilter !== 'all' && d.trade !== tradeFilter) return false;
      if (!q) return true;
      return (
        d.who.toLowerCase().includes(q) ||
        (d.code || '').toLowerCase().includes(q) ||
        d.docNo.toLowerCase().includes(q) ||
        (d.phone || '').toLowerCase().includes(q) ||
        (d.trade || '').toLowerCase().includes(q) ||
        (d.agencyCountry || '').toLowerCase().includes(q)
      );
    });
  }, [docs, search, statusFilter, tradeFilter]);

  const openNewDoc = () => {
    setEditingDoc(null);
    setDocForm({
      code: '',
      who: '',
      trade: '6G Pipe Welder (TIG+ARC)',
      phone: '',
      docNo: '',
      expiry: '',
      status: 'Original Held',
      medical: 'Pending',
      policeClearance: 'Pending',
      certificate: 'Pending',
      bmetVisa: 'Pending',
      flightStatus: 'Waiting',
      flightDate: '',
      agencyCountry: '',
      note: '',
    });
    setShowModal(true);
  };

  const openEditDoc = (d: DocItem) => {
    setEditingDoc(d);
    setDocForm({
      code: d.code || '',
      who: d.who,
      trade: d.trade || '',
      phone: d.phone || '',
      docNo: d.docNo,
      expiry: d.expiry || '',
      status: d.status,
      medical: d.medical || 'Pending',
      policeClearance: d.policeClearance || 'Pending',
      certificate: d.certificate || 'Pending',
      bmetVisa: d.bmetVisa || 'Pending',
      flightStatus: d.flightStatus || 'Waiting',
      flightDate: d.flightDate || '',
      agencyCountry: d.agencyCountry || '',
      note: d.note || '',
    });
    setShowModal(true);
  };

  const handleSaveDoc = async (e: FormEvent) => {
    e.preventDefault();
    if (!docForm.who.trim()) return;
    const payload = {
      date: editingDoc?.date || todayDDMMYYYY(),
      code: docForm.code.trim(),
      title: 'Passport & Document File',
      docNo: docForm.docNo.trim().toUpperCase(),
      expiry: docForm.expiry.trim(),
      who: docForm.who.trim(),
      trade: docForm.trade.trim(),
      phone: docForm.phone.trim(),
      status: docForm.status,
      medical: docForm.medical,
      policeClearance: docForm.policeClearance,
      certificate: docForm.certificate,
      bmetVisa: docForm.bmetVisa,
      flightStatus: docForm.flightStatus,
      flightDate: docForm.flightDate.trim(),
      agencyCountry: docForm.agencyCountry.trim(),
      note: docForm.note.trim(),
    };
    if (editingDoc) {
      await onUpdate('docs', editingDoc.id, payload);
      await onLogAudit?.('UPDATE_DOC', 'DocuList & Passport', `Updated ${payload.who}`);
    } else {
      await onAdd('docs', payload);
      await onLogAudit?.('ADD_DOC', 'DocuList & Passport', `Added ${payload.who} (${payload.docNo})`);
    }
    setShowModal(false);
  };

  const handleExportMasterCsv = () => {
    const csv = toCsv(
      [
        'Code',
        'Candidate Name',
        'Trade',
        'Mobile',
        'Passport No',
        'Expiry Date',
        'Passport Status',
        'Medical',
        'Police Clearance',
        'Certificate',
        'BMET & Visa',
        'Flight Status',
        'Flight Date',
        'Agency / Country',
      ],
      filtered.map((d) => [
        d.code,
        d.who,
        d.trade,
        d.phone,
        d.docNo,
        d.expiry,
        d.status,
        d.medical,
        d.policeClearance,
        d.certificate,
        d.bmetVisa,
        d.flightStatus,
        d.flightDate,
        d.agencyCountry,
      ])
    );
    downloadFile(`ittc-doculist-master-${todayDDMMYYYY()}.csv`, csv, 'text/csv;charset=utf-8');
  };

  const handleImportCsv = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const rows = parseCsvRows(text);
      if (rows.length < 2) return;
      for (const cols of rows.slice(1)) {
        const [
          code = '',
          who = '',
          trade = '',
          phone = '',
          docNo = '',
          expiry = '',
          status = 'Original Held',
          medical = 'Pending',
          policeClearance = 'Pending',
          certificate = 'Pending',
          bmetVisa = 'Pending',
          flightStatus = 'Waiting',
          flightDate = '',
          agencyCountry = '',
        ] = cols;
        if (!who) continue;
        await onAdd('docs', {
          date: todayDDMMYYYY(),
          code,
          title: 'Passport & Document File',
          who,
          trade,
          phone,
          docNo,
          expiry,
          status,
          medical,
          policeClearance,
          certificate,
          bmetVisa,
          flightStatus,
          flightDate,
          agencyCountry,
          note: 'Imported CSV',
        });
      }
      await onLogAudit?.('IMPORT_DOCULIST', 'DocuList & Passport', `Imported ${rows.length - 1} rows`);
    } finally {
      e.target.value = '';
    }
  };

  const handleSaveExtractedMrz = async (e: FormEvent) => {
    e.preventDefault();
    if (!parsedMrz) return;
    await onAdd('docs', {
      date: todayDDMMYYYY(),
      code: mrzExtra.code.trim(),
      title: 'Passport MRZ Scan',
      docNo: parsedMrz.passportNo,
      expiry: parsedMrz.expiryDate,
      who: parsedMrz.fullName,
      trade: mrzExtra.trade.trim(),
      phone: mrzExtra.phone.trim(),
      status: mrzExtra.status,
      medical: 'Pending',
      policeClearance: 'Pending',
      certificate: 'Pending',
      bmetVisa: 'Pending',
      flightStatus: 'Waiting',
      flightDate: '',
      agencyCountry: mrzExtra.agencyCountry.trim(),
      note: `DOB: ${parsedMrz.dob || '—'} · Nat: ${parsedMrz.nationality || 'BGD'}`,
    });
    await onLogAudit?.(
      'MRZ_EXTRACT',
      'DocuList & Passport',
      `Extracted passport ${parsedMrz.passportNo} (${parsedMrz.fullName})`
    );
    setMrzSavedNotice(
      bn
        ? `${parsedMrz.fullName} (${parsedMrz.passportNo}) DocuList-এ যুক্ত হয়েছে!`
        : `Saved ${parsedMrz.fullName} (${parsedMrz.passportNo}) to DocuList!`
    );
    setMrzInput('');
    setTimeout(() => setMrzSavedNotice(''), 3000);
  };

  return (
    <div className="space-y-4">
      {/* Dark Hero Banner matching 140651 */}
      <section className="rounded-xl bg-gradient-to-r from-[#063a35] via-[#093238] to-[#0b1f2e] text-white p-5 border border-teal-900/60 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="p-2 rounded-xl bg-white/10 border border-white/15">
                <FileSpreadsheet className="w-5 h-5 text-teal-300" />
              </span>
              <h2 className="font-display text-lg sm:text-xl font-extrabold">
                {bn
                  ? 'DocuList ও পাসপোর্ট এক্সট্র্যাক্টর XL ডাটা সিস্টেম'
                  : 'DocuList & Passport Extractor XL Data System'}
              </h2>
              <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-teal-500/20 border border-teal-400/30 text-teal-200">
                Live Cloud Sync
              </span>
            </div>
            <p className="text-xs text-teal-100/80 max-w-2xl">
              {bn
                ? 'পাসপোর্ট MRZ এক্সট্র্যাকশন, ডকুমেন্ট লিস্ট ও মাস্টার CSV ইঞ্জিন। ক্লাউড সিঙ্কের মাধ্যমে সব ডিভাইসে রিয়েল-টাইম আপডেট থাকে।'
                : 'Passport MRZ extraction, document tracking matrix, and master spreadsheet import/export synced in real time.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleImportCsv}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => csvInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 border border-white/20 text-xs font-semibold cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>{bn ? 'CSV আপলোড (Load Data)' : 'CSV Upload (Load Data)'}</span>
            </button>
            <button
              type="button"
              onClick={handleExportMasterCsv}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{bn ? 'মাস্টার CSV ডাউনলোড' : 'Download Master CSV'}</span>
            </button>
            <button
              type="button"
              onClick={async () => {
                setSyncing(true);
                await onSync();
                setSyncing(false);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/30 text-emerald-100 text-xs font-semibold cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              <span>{bn ? 'ক্লাউড সিঙ্ক যাচাই' : 'Verify Cloud Sync'}</span>
            </button>
          </div>
        </div>

        <div className="pt-3 border-t border-white/10 flex flex-wrap items-center justify-between gap-2 text-xs text-teal-100/80">
          <div className="flex items-center gap-2 flex-wrap">
            <Cloud className="w-3.5 h-3.5 text-emerald-400" />
            <span>{bn ? 'সিঙ্ক স্ট্যাটাস:' : 'Sync Status:'}</span>
            <span className="px-2 py-0.5 rounded bg-white/10 font-mono-num text-white">
              {mode === 'cloud' ? userEmail || 'Cloud Firestore' : 'Browser Local Storage'}
            </span>
            <span className={cloudConnected || mode === 'cloud' ? 'text-emerald-300' : 'text-amber-300'}>
              {mode === 'cloud'
                ? bn
                  ? '✓ ক্লাউড অটো-সিঙ্ক সক্রিয়'
                  : '✓ Real-time Cloud Sync Active'
                : bn
                  ? 'লোকাল অফলাইন মোড'
                  : 'Local Offline Mode'}
            </span>
          </div>
          <div className="font-mono-num text-teal-200">
            {bn ? 'মোট পাসপোর্ট:' : 'Total Passports:'} <b>{docs.length}</b> | DocuList:{' '}
            <b>{docs.length}</b>
          </div>
        </div>
      </section>

      {/* 5 KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="bg-white dark:bg-slate-900 rounded-xl p-3.5 border border-slate-200 dark:border-slate-800">
          <div className="text-xs text-slate-500">{bn ? 'মোট ক্যান্ডিডেট' : 'Total Candidates'}</div>
          <div className="font-mono-num text-xl font-extrabold mt-1">{docs.length}</div>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-xl p-3.5 border border-emerald-200 dark:border-emerald-900/60">
          <div className="text-xs text-slate-500">{bn ? 'মূল পাসপোর্ট জমা' : 'Original Passports'}</div>
          <div className="font-mono-num text-xl font-extrabold text-teal-600 dark:text-teal-400 mt-1">
            {originalPassportsCount}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-xl p-3.5 border border-blue-200 dark:border-blue-900/60">
          <div className="text-xs text-slate-500">{bn ? 'মেডিকেল ফিট' : 'Medical Fit'}</div>
          <div className="font-mono-num text-xl font-extrabold text-blue-600 dark:text-blue-400 mt-1">
            {medicalFitCount}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-xl p-3.5 border border-amber-200 dark:border-amber-900/60">
          <div className="text-xs text-slate-500">{bn ? 'ভিসা স্ট্যাম্পড' : 'Visa Stamped'}</div>
          <div className="font-mono-num text-xl font-extrabold text-amber-600 dark:text-amber-400 mt-1">
            {visaStampedCount}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-xl p-3.5 border border-purple-200 dark:border-purple-900/60 col-span-2 sm:col-span-1">
          <div className="text-xs text-slate-500">{bn ? 'ফ্লাইট নির্ধারিত' : 'Flight Scheduled'}</div>
          <div className="font-mono-num text-xl font-extrabold text-purple-600 dark:text-purple-400 mt-1">
            {flightScheduledCount}
          </div>
        </div>
      </div>

      {/* Sub-Tabs + Add Candidate Button */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={() => setSubTab('doculist')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                subTab === 'doculist'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>
                {bn ? 'DocuList Excel (ডকুমেন্ট লিস্ট ও স্ট্যাটাস)' : 'DocuList Excel (Status Matrix)'}{' '}
                ({docs.length})
              </span>
            </button>
            <button
              type="button"
              onClick={() => setSubTab('extractor')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                subTab === 'extractor'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              <ScanLine className="w-3.5 h-3.5" />
              <span>
                {bn ? 'পাসপোর্ট এক্সট্র্যাক্টর (MRZ Scanner)' : 'Passport Extractor (MRZ)'} ({docs.length})
              </span>
            </button>
          </div>

          <button
            type="button"
            onClick={openNewDoc}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{bn ? '+ নতুন ক্যান্ডিডেট DocuList এন্ট্রি' : '+ New Candidate DocuList Entry'}</span>
          </button>
        </div>

        {subTab === 'doculist' && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={
                  bn
                    ? 'নাম, স্টুডেন্ট কোড, পাসপোর্ট নম্বর, মোবাইল বা ট্রেড দিয়ে খুঁজুন...'
                    : 'Search by Name, Student Code, Passport No, Mobile, or Trade...'
                }
                className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | PassportStatus)}
              className="px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
            >
              <option value="all">{bn ? 'সকল ডকুমেন্ট স্ট্যাটাস' : 'All Passport Statuses'}</option>
              <option value="Original Held">{bn ? 'মূল পাসপোর্ট জমা' : 'Original Held'}</option>
              <option value="Copy Submitted">{bn ? 'কপি জমা' : 'Copy Submitted'}</option>
              <option value="Pending">{bn ? 'পেন্ডিং' : 'Pending'}</option>
            </select>
            <select
              value={tradeFilter}
              onChange={(e) => setTradeFilter(e.target.value)}
              className="px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
            >
              <option value="all">{bn ? 'সকল ট্রেড / কোর্স' : 'All Trades / Courses'}</option>
              {trades.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Tab 1: DocuList Excel Table */}
      {subTab === 'doculist' && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              {bn ? 'কোনো ডকুমেন্ট ফাইল পাওয়া যায়নি।' : 'No DocuList candidate records found.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-[11px] font-semibold text-slate-500">
                    <th className="py-2.5 px-3">SL</th>
                    <th className="py-2.5 px-3">{bn ? 'কোড ও প্রার্থী' : 'CODE & CANDIDATE'}</th>
                    <th className="py-2.5 px-3">{bn ? 'ট্রেড ও মোবাইল' : 'TRADE & MOBILE'}</th>
                    <th className="py-2.5 px-3">{bn ? 'পাসপোর্ট নং ও মেয়াদ' : 'PASSPORT & EXPIRY'}</th>
                    <th className="py-2.5 px-3">{bn ? 'পাসপোর্ট স্থিতি' : 'PASSPORT STATUS'}</th>
                    <th className="py-2.5 px-3">{bn ? 'মেডিকেল' : 'MEDICAL'}</th>
                    <th className="py-2.5 px-3">{bn ? 'পুলিশ ক্লিয়ারেন্স' : 'POLICE CLEARANCE'}</th>
                    <th className="py-2.5 px-3">{bn ? 'সার্টিফিকেট' : 'CERTIFICATE'}</th>
                    <th className="py-2.5 px-3">{bn ? 'বিএমইটি ও ভিসা' : 'BMET & VISA'}</th>
                    <th className="py-2.5 px-3">{bn ? 'ফ্লাইট' : 'FLIGHT'}</th>
                    <th className="py-2.5 px-3">{bn ? 'এজেন্সি / দেশ' : 'AGENCY / COUNTRY'}</th>
                    <th className="py-2.5 px-3 text-right">{bn ? 'অ্যাকশন' : 'ACTION'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {filtered.map((d, idx) => (
                    <tr key={d.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-2.5 px-3 font-mono-num text-slate-400">{idx + 1}</td>
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-slate-900 dark:text-white">{d.who}</div>
                        <div className="font-mono-num text-[11px] font-bold text-teal-700 dark:text-teal-400">
                          {d.code || '—'}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-medium text-slate-800 dark:text-slate-200">
                          {d.trade || '—'}
                        </div>
                        <div className="font-mono-num text-[11px] text-slate-500">
                          {d.phone || '—'}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 font-mono-num">
                        <div className="font-bold text-slate-900 dark:text-white">
                          {d.docNo || '—'}
                        </div>
                        {d.expiry && (
                          <div className="text-[11px] text-slate-500">
                            {bn ? 'মেয়াদ:' : 'Exp:'} {d.expiry}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        <select
                          value={d.status}
                          onChange={(e) =>
                            onUpdate('docs', d.id, { status: e.target.value as PassportStatus })
                          }
                          className={`px-2 py-1 rounded-md border text-[11px] font-semibold cursor-pointer ${
                            d.status === 'Original Held'
                              ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                              : d.status === 'Copy Submitted'
                                ? 'bg-amber-50 dark:bg-amber-950/60 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300'
                                : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          <option value="Original Held">
                            {bn ? 'মূল পাসপোর্ট জমা' : 'Original Held'}
                          </option>
                          <option value="Copy Submitted">
                            {bn ? 'কপি জমা' : 'Copy Submitted'}
                          </option>
                          <option value="Pending">{bn ? 'পেন্ডিং' : 'Pending'}</option>
                        </select>
                      </td>
                      <td className="py-2.5 px-3">
                        <select
                          value={d.medical}
                          onChange={(e) =>
                            onUpdate('docs', d.id, { medical: e.target.value as MedicalStatus })
                          }
                          className={`px-2 py-1 rounded-md border text-[11px] font-semibold cursor-pointer ${
                            d.medical === 'Fit'
                              ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300'
                              : d.medical === 'Unfit'
                                ? 'bg-red-50 dark:bg-red-950/60 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
                                : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600'
                          }`}
                        >
                          <option value="Fit">{bn ? 'ফিট (Fit)' : 'Fit'}</option>
                          <option value="Pending">{bn ? 'পেন্ডিং' : 'Pending'}</option>
                          <option value="Unfit">{bn ? 'আনফিট' : 'Unfit'}</option>
                        </select>
                      </td>
                      <td className="py-2.5 px-3">
                        <select
                          value={d.policeClearance}
                          onChange={(e) =>
                            onUpdate('docs', d.id, {
                              policeClearance: e.target.value as PoliceStatus,
                            })
                          }
                          className={`px-2 py-1 rounded-md border text-[11px] font-semibold cursor-pointer ${
                            d.policeClearance === 'Received'
                              ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                              : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          <option value="Received">{bn ? 'প্রাপ্ত (Received)' : 'Received'}</option>
                          <option value="Applied">{bn ? 'আবেদনকৃত' : 'Applied'}</option>
                          <option value="Pending">{bn ? 'পেন্ডিং' : 'Pending'}</option>
                        </select>
                      </td>
                      <td className="py-2.5 px-3">
                        <select
                          value={d.certificate}
                          onChange={(e) =>
                            onUpdate('docs', d.id, { certificate: e.target.value as CertStatus })
                          }
                          className={`px-2 py-1 rounded-md border text-[11px] font-semibold cursor-pointer ${
                            d.certificate === 'Issued'
                              ? 'bg-teal-50 dark:bg-teal-950/60 border-teal-200 dark:border-teal-800 text-teal-700 dark:text-teal-300'
                              : d.certificate === 'In Progress'
                                ? 'bg-amber-50 dark:bg-amber-950/60 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300'
                                : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600'
                          }`}
                        >
                          <option value="Issued">{bn ? 'ইস্যুকৃত' : 'Issued'}</option>
                          <option value="In Progress">{bn ? 'চলমান' : 'In Progress'}</option>
                          <option value="Pending">{bn ? 'পেন্ডিং' : 'Pending'}</option>
                        </select>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-semibold">
                          <span
                            className={
                              d.bmetVisa === 'Stamped'
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-teal-700 dark:text-teal-400'
                            }
                          >
                            {bn ? 'ভিসা: ' : 'Visa: '}
                            {d.bmetVisa}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-500">
                          BMET:{' '}
                          {d.bmetVisa === 'Stamped'
                            ? bn
                              ? 'স্মার্ট কার্ড রেডি'
                              : 'Card Ready'
                            : bn
                              ? 'পেন্ডিং'
                              : 'Pending'}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div
                          className={`font-semibold ${
                            d.flightStatus === 'Scheduled'
                              ? 'text-purple-600 dark:text-purple-400'
                              : 'text-slate-500'
                          }`}
                        >
                          {d.flightStatus === 'Scheduled'
                            ? bn
                              ? 'তারিখ নির্ধারিত'
                              : 'Scheduled'
                            : d.flightStatus === 'Departed'
                              ? bn
                                ? 'ফ্লাইট সম্পন্ন'
                                : 'Departed'
                              : bn
                                ? 'অপেক্ষমান'
                                : 'Waiting'}
                        </div>
                        {d.flightDate && (
                          <div className="font-mono-num text-[10px] text-slate-500">
                            {d.flightDate}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-medium text-slate-800 dark:text-slate-200 max-w-[160px] truncate">
                          {d.agencyCountry?.split('|')[0]?.trim() || d.agencyCountry || '—'}
                        </div>
                        {d.agencyCountry?.includes('|') && (
                          <div className="text-[11px] font-semibold text-teal-700 dark:text-teal-400">
                            {d.agencyCountry.split('|')[1]?.trim()}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openEditDoc(d)}
                            aria-label="Edit DocuList row"
                            className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDelete('docs', d.id)}
                            aria-label="Delete DocuList row"
                            className="p-1.5 rounded-md text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
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
      )}

      {/* Tab 2: ICAO 9303 Passport MRZ Extractor */}
      {subTab === 'extractor' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-6 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                  {bn ? 'পাসপোর্ট MRZ ডাটা এক্সট্র্যাক্টর' : 'Passport MRZ Code Extractor (ICAO TD3)'}
                </h3>
                <p className="text-xs text-slate-500">
                  {bn
                    ? 'পাসপোর্টের নিচের ২ লাইনের MRZ কোড পেস্ট করলে স্বয়ংক্রিয়ভাবে নাম, পাসপোর্ট নং ও মেয়াদ আলাদা হবে।'
                    : 'Paste the 2-line machine-readable zone (MRZ) from the passport bottom strip to extract candidate details.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  setMrzInput(
                    'P<BGDRASHID<<MD<HARUN<UR<<<<<<<<<<<<<<<<<<<<\nA091245873BGD9403152M3408214<<<<<<<<<<<<<<08'
                  )
                }
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer shrink-0"
              >
                {bn ? 'নমুনা MRZ' : 'Sample MRZ'}
              </button>
            </div>

            <textarea
              rows={4}
              value={mrzInput}
              onChange={(e) => setMrzInput(e.target.value)}
              placeholder={`P<BGDSURNAME<<GIVEN<NAMES<<<<<<<<<<<<<<<<<<<\nA058923415BGD9504128M3404112<<<<<<<<<<<<<<04`}
              className="w-full px-3 py-2.5 text-xs font-mono-num rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 tracking-wider uppercase"
            />

            {mrzSavedNotice && (
              <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-xs font-semibold text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                <Check className="w-4 h-4" />
                <span>{mrzSavedNotice}</span>
              </div>
            )}

            {parsedMrz && (
              <div className="p-4 rounded-xl bg-teal-50/70 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800 space-y-2 text-xs">
                <div className="font-bold text-teal-800 dark:text-teal-300 uppercase">
                  {bn ? 'শনাক্তকৃত পাসপোর্ট তথ্য' : 'Extracted Passport Fields'}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-slate-500">Full Name:</span>{' '}
                    <b className="text-slate-900 dark:text-white">{parsedMrz.fullName}</b>
                  </div>
                  <div>
                    <span className="text-slate-500">Passport No:</span>{' '}
                    <b className="font-mono-num text-teal-700 dark:text-teal-300">
                      {parsedMrz.passportNo}
                    </b>
                  </div>
                  <div>
                    <span className="text-slate-500">Nationality:</span>{' '}
                    <b className="font-mono-num">{parsedMrz.nationality || 'BGD'}</b>
                  </div>
                  <div>
                    <span className="text-slate-500">DOB:</span>{' '}
                    <b className="font-mono-num">{parsedMrz.dob || '—'}</b>
                  </div>
                  <div>
                    <span className="text-slate-500">Expiry Date:</span>{' '}
                    <b className="font-mono-num">{parsedMrz.expiryDate || '—'}</b>
                  </div>
                  <div>
                    <span className="text-slate-500">Sex:</span>{' '}
                    <b className="font-mono-num">{parsedMrz.gender}</b>
                  </div>
                </div>
              </div>
            )}
          </div>

          <form
            onSubmit={handleSaveExtractedMrz}
            className="lg:col-span-6 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 space-y-4"
          >
            <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
              {bn ? 'DocuList-এ সংরক্ষণ করুন' : 'Complete & Save to DocuList'}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">
                  {bn ? 'স্টুডেন্ট কোড' : 'Student Code'}
                </label>
                <input
                  value={mrzExtra.code}
                  onChange={(e) => setMrzExtra({ ...mrzExtra, code: e.target.value })}
                  placeholder="01/003"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  {bn ? 'মোবাইল নম্বর' : 'Mobile Number'}
                </label>
                <input
                  value={mrzExtra.phone}
                  onChange={(e) => setMrzExtra({ ...mrzExtra, phone: e.target.value })}
                  placeholder="017..."
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  {bn ? 'ট্রেড / কোর্স' : 'Trade / Course'}
                </label>
                <input
                  value={mrzExtra.trade}
                  onChange={(e) => setMrzExtra({ ...mrzExtra, trade: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  {bn ? 'এজেন্সি ও দেশ' : 'Agency & Country'}
                </label>
                <input
                  value={mrzExtra.agencyCountry}
                  onChange={(e) => setMrzExtra({ ...mrzExtra, agencyCountry: e.target.value })}
                  placeholder="Eastern Agency | Saudi Arabia"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium mb-1">
                  {bn ? 'পাসপোর্ট স্থিতি' : 'Passport Custody Status'}
                </label>
                <select
                  value={mrzExtra.status}
                  onChange={(e) =>
                    setMrzExtra({ ...mrzExtra, status: e.target.value as PassportStatus })
                  }
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                >
                  <option value="Original Held">Original Held</option>
                  <option value="Copy Submitted">Copy Submitted</option>
                  <option value="Pending">Pending</option>
                </select>
              </div>
            </div>
            <button
              type="submit"
              disabled={!parsedMrz}
              className="w-full py-2.5 rounded-lg bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer"
            >
              {bn ? 'MRZ তথ্য DocuList-এ যুক্ত করুন' : 'Extract & Save Candidate to DocuList'}
            </button>
          </form>
        </div>
      )}

      {/* Add / Edit Candidate DocuList Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveDoc}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-2xl w-full p-5 space-y-4 max-h-[90vh] overflow-y-auto shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="font-display text-base font-bold">
                {editingDoc
                  ? bn
                    ? 'ক্যান্ডিডেট ডকুমেন্ট সম্পাদনা'
                    : 'Edit Candidate DocuList Entry'
                  : bn
                    ? 'নতুন ক্যান্ডিডেট DocuList এন্ট্রি'
                    : 'New Candidate DocuList Entry'}
              </h3>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">
                  {bn ? 'প্রার্থীর নাম *' : 'Candidate Name *'}
                </label>
                <input
                  required
                  value={docForm.who}
                  onChange={(e) => setDocForm({ ...docForm, who: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  {bn ? 'স্টুডেন্ট কোড' : 'Student Code'}
                </label>
                <input
                  value={docForm.code}
                  onChange={(e) => setDocForm({ ...docForm, code: e.target.value })}
                  placeholder="01/001"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  {bn ? 'পাসপোর্ট নম্বর' : 'Passport Number'}
                </label>
                <input
                  value={docForm.docNo}
                  onChange={(e) => setDocForm({ ...docForm, docNo: e.target.value })}
                  placeholder="A05892341"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono-num uppercase"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  {bn ? 'পাসপোর্ট মেয়াদ' : 'Passport Expiry'}
                </label>
                <input
                  value={docForm.expiry}
                  onChange={(e) => setDocForm({ ...docForm, expiry: e.target.value })}
                  placeholder="2034-04-11"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{bn ? 'ট্রেড' : 'Trade'}</label>
                <input
                  value={docForm.trade}
                  onChange={(e) => setDocForm({ ...docForm, trade: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{bn ? 'মোবাইল' : 'Mobile'}</label>
                <input
                  value={docForm.phone}
                  onChange={(e) => setDocForm({ ...docForm, phone: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  {bn ? 'পাসপোর্ট স্থিতি' : 'Passport Status'}
                </label>
                <select
                  value={docForm.status}
                  onChange={(e) =>
                    setDocForm({ ...docForm, status: e.target.value as PassportStatus })
                  }
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                >
                  <option value="Original Held">Original Held</option>
                  <option value="Copy Submitted">Copy Submitted</option>
                  <option value="Pending">Pending</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{bn ? 'মেডিকেল' : 'Medical'}</label>
                <select
                  value={docForm.medical}
                  onChange={(e) =>
                    setDocForm({ ...docForm, medical: e.target.value as MedicalStatus })
                  }
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                >
                  <option value="Fit">Fit</option>
                  <option value="Pending">Pending</option>
                  <option value="Unfit">Unfit</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  {bn ? 'পুলিশ ক্লিয়ারেন্স' : 'Police Clearance'}
                </label>
                <select
                  value={docForm.policeClearance}
                  onChange={(e) =>
                    setDocForm({ ...docForm, policeClearance: e.target.value as PoliceStatus })
                  }
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                >
                  <option value="Received">Received</option>
                  <option value="Applied">Applied</option>
                  <option value="Pending">Pending</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  {bn ? 'সার্টিফিকেট' : 'Certificate'}
                </label>
                <select
                  value={docForm.certificate}
                  onChange={(e) =>
                    setDocForm({ ...docForm, certificate: e.target.value as CertStatus })
                  }
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                >
                  <option value="Issued">Issued</option>
                  <option value="In Progress">In Progress</option>
                  <option value="Pending">Pending</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  {bn ? 'বিএমইটি ও ভিসা' : 'BMET & Visa'}
                </label>
                <select
                  value={docForm.bmetVisa}
                  onChange={(e) =>
                    setDocForm({ ...docForm, bmetVisa: e.target.value as VisaStatus })
                  }
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                >
                  <option value="Stamped">Stamped</option>
                  <option value="Processing">Processing</option>
                  <option value="Pending">Pending</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  {bn ? 'ফ্লাইট অবস্থা' : 'Flight Status'}
                </label>
                <select
                  value={docForm.flightStatus}
                  onChange={(e) =>
                    setDocForm({ ...docForm, flightStatus: e.target.value as FlightStatus })
                  }
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                >
                  <option value="Waiting">Waiting</option>
                  <option value="Scheduled">Scheduled</option>
                  <option value="Departed">Departed</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  {bn ? 'ফ্লাইট তারিখ' : 'Flight Date'}
                </label>
                <input
                  value={docForm.flightDate}
                  onChange={(e) => setDocForm({ ...docForm, flightDate: e.target.value })}
                  placeholder="2026-11-25"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  {bn ? 'এজেন্সি ও দেশ' : 'Agency | Country'}
                </label>
                <input
                  value={docForm.agencyCountry}
                  onChange={(e) => setDocForm({ ...docForm, agencyCountry: e.target.value })}
                  placeholder="Eastern Agency | Saudi Arabia"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold cursor-pointer"
              >
                {bn ? 'বাতিল' : 'Cancel'}
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold cursor-pointer"
              >
                {bn ? 'সংরক্ষণ করুন' : 'Save Entry'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
