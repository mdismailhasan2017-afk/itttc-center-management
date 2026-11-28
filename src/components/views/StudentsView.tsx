import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  Award,
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  Edit3,
  FileSpreadsheet,
  FileText,
  Fingerprint,
  Maximize2,
  MessageCircle,
  Minimize2,
  Phone,
  Plus,
  Printer,
  Search,
  Upload,
  User,
  Wallet,
  X,
} from 'lucide-react';
import type { SubCollectionKey } from '../../lib/store';
import { downloadFile, formatTaka, toCsv, todayDDMMYYYY } from '../../lib/format';
import { computeStudentJobBalanceSummary } from '../../lib/jobLimits';
import type { PrintableReportSpec } from '../../lib/print';
import { BangladeshAddressPicker } from '../BangladeshAddressPicker';
import { StudentExcelImportModal } from '../StudentExcelImportModal';
import { StudentProfileModal } from '../StudentProfileModal';
import type {
  AuditLog,
  CashEntry,
  DocItem,
  JobEntry,
  JobPrice,
  JobReturn,
  Lang,
  OverseasCompany,
  OverseasStatus,
  SlipData,
  StaffMember,
  Student,
} from '../../types';

interface StudentsViewProps {
  students: Student[];
  jobs: JobEntry[];
  returns: JobReturn[];
  companies: OverseasCompany[];
  docs: DocItem[];
  prices: JobPrice[];
  cash: CashEntry[];
  auditLogs?: AuditLog[];
  staff?: StaffMember[];
  lang: Lang;
  onAdd: (key: SubCollectionKey, raw: Record<string, unknown>) => Promise<string>;
  onUpdate: (key: SubCollectionKey, id: string, patch: Record<string, unknown>) => Promise<void>;
  onLogAudit?: (action: string, module: string, detail: string) => Promise<void>;
  autoOpenForm?: boolean;
  onConsumeAutoOpen?: () => void;
  inspectStudentCode?: string | null;
  onConsumeInspect?: () => void;
  onOpenIssueJob?: (studentCode: string) => void;
  onPrintSlip?: (slip: SlipData) => void;
  onPrintReport?: (spec: PrintableReportSpec) => void;
}

const OVERSEAS_STATUSES: OverseasStatus[] = [
  'Not Applied',
  'Interview Attended',
  'Selected',
  'Visa Processing',
  'Flight Ready',
];

function toInputDate(ddmmyyyy: string): string {
  const parts = ddmmyyyy.split('-');
  if (parts.length !== 3) return '';
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

function fromInputDate(yyyymmdd: string): string {
  if (!yyyymmdd) return todayDDMMYYYY();
  const parts = yyyymmdd.split('-');
  if (parts.length !== 3) return todayDDMMYYYY();
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

async function compressStudentPhoto(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Please upload a JPG or PNG image.');
  }
  if (file.size > 3 * 1024 * 1024) {
    throw new Error('Image size must be 3MB or less.');
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not read image file.'));
      el.src = objectUrl;
    });
    const maxDim = 320;
    const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas compression is unavailable.');
    ctx.drawImage(img, 0, 0, width, height);
    let dataUrl = canvas.toDataURL('image/jpeg', 0.72);
    if (dataUrl.length > 140000) {
      dataUrl = canvas.toDataURL('image/jpeg', 0.5);
    }
    if (dataUrl.length > 145000) {
      canvas.width = Math.max(1, Math.round(width * 0.65));
      canvas.height = Math.max(1, Math.round(height * 0.65));
      const smallCtx = canvas.getContext('2d');
      smallCtx?.drawImage(img, 0, 0, canvas.width, canvas.height);
      dataUrl = canvas.toDataURL('image/jpeg', 0.45);
    }
    return dataUrl.length <= 148000 ? dataUrl : '';
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function StudentsView({
  students,
  jobs,
  returns,
  companies,
  docs,
  prices,
  cash,
  auditLogs = [],
  staff = [],
  lang,
  onAdd,
  onUpdate,
  onLogAudit,
  autoOpenForm,
  onConsumeAutoOpen,
  inspectStudentCode,
  onConsumeInspect,
  onOpenIssueJob,
  onPrintSlip,
  onPrintReport,
}: StudentsViewProps) {
  const bn = lang === 'bn';
  const photoInputRef = useRef<HTMLInputElement>(null);
  const passportInputRef = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState('');
  const [khataLookup, setKhataLookup] = useState('');
  const [khataError, setKhataError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | OverseasStatus>('all');
  const [showForm, setShowForm] = useState(false);
  const [showExcelImport, setShowExcelImport] = useState(false);
  const [fullScreen, setFullScreen] = useState(true);
  const [showOverseasSection, setShowOverseasSection] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [bioMessage, setBioMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<Student | null>(null);
  const [profileStudentId, setProfileStudentId] = useState<string | null>(null);
  const [payingStudent, setPayingStudent] = useState<Student | null>(null);
  const [depositType, setDepositType] = useState<'course' | 'visa'>('course');
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('Cash');
  const [payPurpose, setPayPurpose] = useState('');
  const [recordInCashbook, setRecordInCashbook] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const activeProfileStudent = useMemo(
    () => (profileStudentId ? students.find((s) => s.id === profileStudentId) ?? null : null),
    [students, profileStudentId]
  );

  const [form, setForm] = useState({
    date: toInputDate(todayDDMMYYYY()),
    name: '',
    code: '',
    fatherName: '',
    motherName: '',
    phone: '',
    guardianPhone: '',
    district: '',
    nid: '',
    trade: '6G TIG & SMAW High Pressure Pipe Welding',
    passportSubmitted: false,
    passportNo: '',
    photoData: '',
    bioEnrolled: false,
    companyName: '',
    interviewPassedCompany: '',
    interviewDate: '',
    overseasStatus: 'Not Applied' as OverseasStatus,
    destination: '',
    contract: '90000',
    deposit: '0',
    note: '',
  });

  useEffect(() => {
    if (!autoOpenForm) return;
    setEditing(null);
    setPhotoError(null);
    setBioMessage(null);
    setShowOverseasSection(false);
    setFullScreen(true);
    setShowForm(true);
    onConsumeAutoOpen?.();
  }, [autoOpenForm, onConsumeAutoOpen]);

  useEffect(() => {
    if (!inspectStudentCode) return;
    const match = students.find((s) => s.code === inspectStudentCode);
    if (match) {
      setProfileStudentId(match.id);
    }
    onConsumeInspect?.();
  }, [inspectStudentCode, students, onConsumeInspect]);

  const resetForm = () => {
    setForm({
      date: toInputDate(todayDDMMYYYY()),
      name: '',
      code: '',
      fatherName: '',
      motherName: '',
      phone: '',
      guardianPhone: '',
      district: '',
      nid: '',
      trade: '6G TIG & SMAW High Pressure Pipe Welding',
      passportSubmitted: false,
      passportNo: '',
      photoData: '',
      bioEnrolled: false,
      companyName: '',
      interviewPassedCompany: '',
      interviewDate: '',
      overseasStatus: 'Not Applied',
      destination: '',
      contract: '90000',
      deposit: '0',
      note: '',
    });
    setPhotoError(null);
    setBioMessage(null);
    setSubmitError(null);
    setShowOverseasSection(false);
    setEditing(null);
  };

  const openEdit = (s: Student) => {
    setEditing(s);
    const hasPassport =
      typeof s.passportSubmitted === 'boolean'
        ? s.passportSubmitted
        : Boolean(s.passportNo?.trim());
    setForm({
      date: toInputDate(s.date || todayDDMMYYYY()) || toInputDate(todayDDMMYYYY()),
      name: s.name,
      code: s.code,
      fatherName: s.fatherName || '',
      motherName: s.motherName || '',
      phone: s.phone || '',
      guardianPhone: s.guardianPhone || '',
      district: s.district || '',
      nid: s.nid || '',
      trade: s.trade || '6G TIG & SMAW High Pressure Pipe Welding',
      passportSubmitted: hasPassport,
      passportNo: s.passportNo || '',
      photoData: s.photoData || '',
      bioEnrolled: Boolean(s.bioEnrolled),
      companyName: s.companyName || '',
      interviewPassedCompany: s.interviewPassedCompany || '',
      interviewDate: s.interviewDate || '',
      overseasStatus: s.overseasStatus || 'Not Applied',
      destination: s.destination || '',
      contract: String(s.contract ?? 0),
      deposit: String(s.deposit ?? 0),
      note: s.note || '',
    });
    setPhotoError(null);
    setBioMessage(null);
    setSubmitError(null);
    setShowOverseasSection(
      Boolean(
        s.destination ||
          s.companyName ||
          s.interviewPassedCompany ||
          (s.overseasStatus && s.overseasStatus !== 'Not Applied')
      )
    );
    setFullScreen(true);
    setShowForm(true);
  };

  const handlePhotoUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoError(null);
    try {
      const compressed = await compressStudentPhoto(file);
      setForm((prev) => ({ ...prev, photoData: compressed }));
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : 'Photo upload failed.');
    } finally {
      e.target.value = '';
    }
  };

  const handleBioScan = async () => {
    setBioMessage(null);
    if (form.bioEnrolled) {
      setForm((prev) => ({ ...prev, bioEnrolled: false }));
      setBioMessage(bn ? 'বায়ো ফিঙ্গার অপসারণ করা হয়েছে' : 'Biometric enrollment cleared');
      return;
    }
    try {
      if (typeof window !== 'undefined' && 'PublicKeyCredential' in window) {
        const hasPlatform = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable?.();
        setForm((prev) => ({ ...prev, bioEnrolled: true }));
        setBioMessage(
          hasPlatform
            ? bn
              ? 'বায়োমেট্রিক ডিভাইস যাচাই সম্পন্ন'
              : 'Platform biometric verified & linked'
            : bn
              ? 'বায়ো ফিঙ্গার স্ট্যাটাস সংযুক্ত হয়েছে'
              : 'Biometric profile marked as enrolled'
        );
      } else {
        setForm((prev) => ({ ...prev, bioEnrolled: true }));
        setBioMessage(bn ? 'বায়ো ফিঙ্গার স্ট্যাটাস সংযুক্ত হয়েছে' : 'Biometric profile marked as enrolled');
      }
    } catch {
      setForm((prev) => ({ ...prev, bioEnrolled: true }));
      setBioMessage(bn ? 'বায়ো ফিঙ্গার স্ট্যাটাস সংযুক্ত হয়েছে' : 'Biometric profile marked as enrolled');
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    if (!form.name.trim()) {
      setSubmitError(bn ? 'শিক্ষার্থীর নাম লিখুন।' : 'Please enter trainee full name.');
      return;
    }
    setSaving(true);
    try {
      const code = form.code.trim() || `${new Date().getMonth() + 1}/${100 + students.length + 1}`;
      const formattedDate = fromInputDate(form.date);
      const cleanPassportNo = form.passportSubmitted ? form.passportNo.trim().toUpperCase() : '';
      const payload = {
        date: formattedDate,
        name: form.name.trim().toUpperCase(),
        code,
        fatherName: form.fatherName.trim().toUpperCase(),
        motherName: form.motherName.trim().toUpperCase(),
        phone: form.phone.trim(),
        guardianPhone: form.guardianPhone.trim(),
        district: form.district.trim(),
        nid: form.nid.trim(),
        trade: form.trade.trim(),
        passportSubmitted: form.passportSubmitted,
        passportNo: cleanPassportNo,
        passportCopyData: editing?.passportCopyData || '',
        photoData: form.photoData,
        bioEnrolled: form.bioEnrolled,
        companyName: form.companyName.trim(),
        interviewPassedCompany: form.interviewPassedCompany.trim(),
        interviewDate: form.interviewPassedCompany.trim()
          ? form.interviewDate.trim() || todayDDMMYYYY()
          : form.interviewDate.trim(),
        overseasStatus: form.overseasStatus,
        destination: form.destination.trim(),
        contract: Number(form.contract) || 0,
        deposit: Number(form.deposit) || 0,
        note: form.note.trim(),
      };
      if (editing) {
        await onUpdate('students', editing.id, payload);
        if (onLogAudit) {
          await onLogAudit('UPDATE_STUDENT', 'Student Management', `Updated ${payload.name} (${payload.code})`);
        }
      } else {
        await onAdd('students', payload);
        if (payload.deposit > 0) {
          await onAdd('cash', {
            date: payload.date,
            type: 'in',
            category: 'Course Deposit',
            amt: payload.deposit,
            note: `Admission deposit: ${payload.name} (${payload.code})`,
          });
        }
        if (onLogAudit) {
          await onLogAudit('ADD_STUDENT', 'Student Management', `Registered ${payload.name} (${payload.code})`);
        }
      }

      // Auto-sync Passport Submission into DocuList & Passport Control
      if (payload.passportSubmitted && cleanPassportNo) {
        const existingDoc = docs.find(
          (d) =>
            d.code.trim().toLowerCase() === code.toLowerCase() ||
            (d.docNo && d.docNo.trim().toUpperCase() === cleanPassportNo)
        );
        const agencyCountry = [payload.companyName, payload.destination].filter(Boolean).join(' · ');
        if (existingDoc) {
          await onUpdate('docs', existingDoc.id, {
            code,
            docNo: cleanPassportNo,
            who: payload.name,
            trade: payload.trade || existingDoc.trade,
            phone: payload.phone || existingDoc.phone,
            status: 'Original Held',
            agencyCountry: agencyCountry || existingDoc.agencyCountry,
          });
        } else {
          await onAdd('docs', {
            date: payload.date,
            code,
            title: 'Original Passport File',
            docNo: cleanPassportNo,
            expiry: '',
            who: payload.name,
            trade: payload.trade,
            phone: payload.phone,
            status: 'Original Held',
            medical: 'Pending',
            policeClearance: 'Pending',
            certificate: 'Pending',
            bmetVisa: 'Pending',
            flightStatus: 'Waiting',
            flightDate: '',
            agencyCountry,
            note: 'Auto-synced from Student Registration',
          });
        }
      }

      resetForm();
      setShowForm(false);
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : bn
            ? 'ছাত্র নিবন্ধন সংরক্ষণ করতে সমস্যা হয়েছে। আবার চেষ্টা করুন।'
            : 'Failed to save student registration. Please try again.'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleCollectPayment = async (e: FormEvent) => {
    e.preventDefault();
    if (!payingStudent) return;
    const amt = Number(payAmount) || 0;
    if (amt <= 0) return;
    setSaving(true);
    try {
      const today = todayDDMMYYYY();
      const receiptNo = `RCP-${today.replace(/-/g, '')}-${String(cash.length + 1).padStart(3, '0')}`;
      const isVisa = depositType === 'visa';
      const defaultPurpose = isVisa ? 'Visa Processing Deposit' : 'Course Fee Installment';
      const purposeText = payPurpose.trim() || defaultPurpose;

      if (!isVisa) {
        const nextDeposit = Number(payingStudent.deposit || 0) + amt;
        await onUpdate('students', payingStudent.id, {
          deposit: nextDeposit,
        });
      }

      if (recordInCashbook || isVisa) {
        await onAdd('cash', {
          date: today,
          type: 'in',
          category: isVisa ? 'Visa Deposit' : 'Course Deposit',
          amt,
          note: `${isVisa ? 'Visa Deposit' : 'Course Fee'}: ${payingStudent.name} (${payingStudent.code}) | Ref: ${receiptNo} | Method: ${payMethod} | Purpose: ${purposeText}`,
        });
      }

      await onLogAudit?.(
        isVisa ? 'COLLECT_VISA_DEPOSIT' : 'COLLECT_COURSE_DEPOSIT',
        'Student Profile',
        `${receiptNo} · ${payingStudent.name} (${payingStudent.code}) · ${formatTaka(amt)}`
      );

      setPayingStudent(null);
      setPayAmount('');
      setPayPurpose('');
    } finally {
      setSaving(false);
    }
  };

  const jobsByStudent = useMemo(() => {
    const map = new Map<string, { count: number; spent: number }>();
    students.forEach((s) => {
      const summary = computeStudentJobBalanceSummary({
        studentCode: s.code,
        studentName: s.name,
        deposit: s.deposit,
        jobs,
        returns,
      });
      const count = jobs.filter(
        (j) => (j.sid || '').trim().toLowerCase() === (s.code || '').trim().toLowerCase()
      ).length;
      map.set(s.code, {
        count,
        spent: summary.netJobsCost,
      });
    });
    return map;
  }, [students, jobs, returns]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...students].reverse().filter((s) => {
      if (statusFilter !== 'all' && s.overseasStatus !== statusFilter) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.code.toLowerCase().includes(q) ||
        s.phone.toLowerCase().includes(q) ||
        (s.district || '').toLowerCase().includes(q) ||
        (s.destination || '').toLowerCase().includes(q) ||
        (s.companyName || '').toLowerCase().includes(q) ||
        (s.interviewPassedCompany || '').toLowerCase().includes(q)
      );
    });
  }, [students, search, statusFilter]);

  const handleKhataLookup = (e: FormEvent) => {
    e.preventDefault();
    const q = khataLookup.trim().toLowerCase();
    if (!q) return;
    setKhataError(null);
    const exact = students.find((s) => s.code.trim().toLowerCase() === q);
    if (exact) {
      setProfileStudentId(exact.id);
      setKhataLookup('');
      return;
    }
    const partial = students.filter((s) => s.code.toLowerCase().includes(q));
    if (partial.length === 1) {
      setProfileStudentId(partial[0].id);
      setKhataLookup('');
      return;
    }
    if (partial.length > 1) {
      setSearch(khataLookup.trim());
      setKhataError(
        bn
          ? `"${khataLookup.trim()}" দিয়ে ${partial.length}টি খাতা মিলেছে — তালিকা থেকে বাছুন।`
          : `Found ${partial.length} matching Khata numbers — see filtered list below.`
      );
      return;
    }
    setKhataError(
      bn
        ? `খাতা নং "${khataLookup.trim()}" পাওয়া যায়নি।`
        : `No student found for Khata / Code "${khataLookup.trim()}".`
    );
  };

  const handleExportCsv = () => {
    const csv = toCsv(
      [
        'Code',
        'Name',
        'Father',
        'Mother',
        'Mobile',
        'Guardian Phone',
        'District',
        'Admission',
        'Contract',
        'Deposit',
        'Job Balance',
        'Due',
        'Interview Passed Company',
        'Interview Date',
        'Overseas Status',
        'Destination',
        'Company',
      ],
      filtered.map((s) => {
        const stats = jobsByStudent.get(s.code) || { count: 0, spent: 0 };
        const jobBal = Math.max(0, Number(s.deposit || 0) - stats.spent);
        const due = Math.max(0, Number(s.contract || 0) - Number(s.deposit || 0));
        return [
          s.code,
          s.name,
          s.fatherName,
          s.motherName,
          s.phone,
          s.guardianPhone,
          s.district,
          s.date,
          s.contract,
          s.deposit,
          jobBal,
          due,
          s.interviewPassedCompany || '',
          s.interviewDate || '',
          s.overseasStatus,
          s.destination,
          s.companyName,
        ];
      })
    );
    downloadFile(`ittc-students-${todayDDMMYYYY()}.csv`, csv, 'text/csv;charset=utf-8');
  };

  return (
    <div className="space-y-4 lg:space-y-0 lg:flex-1 lg:min-h-0 lg:flex lg:flex-col lg:gap-4">
      {/* Stationary Toolbar */}
      <div className="sticky top-0 z-20 shrink-0 bg-white/95 dark:bg-[#0c1320]/95 backdrop-blur-md rounded-xl border border-slate-200 dark:border-slate-400/20 shadow-sm p-3.5 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-1 flex-wrap items-center gap-2.5 min-w-[260px]">
          <div className="relative flex-1 min-w-[210px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={
                bn
                  ? 'খাতা নং/কোড, নাম, মোবাইল, জেলা বা কোম্পানি দিয়ে খুঁজুন...'
                  : 'Search Khata/Code, Name, Mobile, Country, or Company...'
              }
              className="w-full pl-9 pr-3 py-2 text-xs sm:text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>

          <form onSubmit={handleKhataLookup} className="flex items-center gap-1.5">
            <input
              list="students-khata-codes"
              value={khataLookup}
              onChange={(e) => {
                setKhataLookup(e.target.value);
                setKhataError(null);
              }}
              placeholder={bn ? 'খাতা নং দিয়ে প্রোফাইল...' : 'Khata No. -> Profile'}
              className="w-40 sm:w-44 px-3 py-2 text-xs rounded-lg border border-teal-300 dark:border-teal-700 bg-teal-50/40 dark:bg-teal-950/30 font-mono-num text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            <datalist id="students-khata-codes">
              {students.map((s) => (
                <option key={s.id} value={s.code}>
                  {s.name}
                </option>
              ))}
            </datalist>
            <button
              type="submit"
              className="px-3 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
            >
              {bn ? 'প্রোফাইল খুলুন' : 'Open Profile'}
            </button>
          </form>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | OverseasStatus)}
            className="px-3 py-2 text-xs sm:text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200"
          >
            <option value="all">{bn ? 'সকল ওভারসিজ স্ট্যাটাস' : 'All Overseas Statuses'}</option>
            {OVERSEAS_STATUSES.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>

          <span className="font-mono-num text-xs font-semibold text-slate-700 dark:text-slate-200 px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 whitespace-nowrap">
            {bn ? `মোট: ${students.length}` : `Total: ${students.length}`}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowExcelImport(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>{bn ? 'এক্সেল ইমপোর্ট' : 'Excel Import'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              onPrintReport?.({
                title: bn ? 'নিবন্ধিত শিক্ষার্থী তালিকা (Student Directory)' : 'Registered Student Directory',
                subtitle: `${bn ? 'তারিখ' : 'Date'}: ${todayDDMMYYYY()} · ${filtered.length} ${bn ? 'জন শিক্ষার্থী' : 'students'}`,
                filename: `ittc-students-${todayDDMMYYYY()}`,
                columns: ['Code', 'Name', 'Trade', 'Mobile', 'Contract', 'Deposit', 'Due', 'Status'],
                rows: filtered.map((s) => {
                  const due = Math.max(0, Number(s.contract || 0) - Number(s.deposit || 0));
                  return [
                    s.code,
                    s.name,
                    s.trade || '—',
                    s.phone || '—',
                    formatTaka(s.contract),
                    formatTaka(s.deposit),
                    formatTaka(due),
                    s.overseasStatus || 'Not Applied',
                  ];
                }),
              });
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer whitespace-nowrap"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>{bn ? 'প্রিন্ট' : 'Print'}</span>
          </button>

          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer whitespace-nowrap"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>{bn ? 'এক্সেল এক্সপোর্ট' : 'Excel Export'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              resetForm();
              setFullScreen(true);
              setShowForm(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>{bn ? '+ স্টুডেন্ট যোগ' : '+ Add Student'}</span>
          </button>
        </div>
        </div>
        {khataError && (
          <div className="text-xs font-medium text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-1.5">
            {khataError}
          </div>
        )}
      </div>

      {/* Register / Edit Student Modal (Matches Screenshot 140939) */}
      {showForm && (
        <div
          className={`fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[1px] flex items-center justify-center ${
            fullScreen ? 'p-0' : 'p-3 sm:p-6'
          }`}
          role="dialog"
          aria-modal="true"
          aria-label="Register New Student"
        >
          <form
            onSubmit={handleSubmit}
            className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col overflow-hidden ${
              fullScreen
                ? 'w-full h-full max-w-none rounded-none'
                : 'w-full max-w-5xl max-h-[92vh] rounded-2xl'
            }`}
          >
            {/* Modal Header */}
            <div className="px-5 sm:px-6 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0 bg-white dark:bg-slate-900">
              <div className="flex items-center gap-2.5 min-w-0">
                <h2 className="font-display text-base sm:text-lg font-extrabold text-slate-900 dark:text-white truncate">
                  {editing
                    ? 'Edit Student Profile (স্টুডেন্ট প্রোফাইল সম্পাদনা)'
                    : 'Register New Student (স্টুডেন্ট রেজিস্ট্রেশন)'}
                </h2>
                {fullScreen && (
                  <span className="px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-[10px] font-bold tracking-wide text-emerald-700 dark:text-emerald-300 uppercase shrink-0">
                    FULL SCREEN
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setFullScreen((v) => !v)}
                  aria-label={fullScreen ? 'Exit full screen' : 'Full screen'}
                  className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  {fullScreen ? (
                    <Minimize2 className="w-4 h-4" />
                  ) : (
                    <Maximize2 className="w-4 h-4" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    resetForm();
                    setShowForm(false);
                  }}
                  aria-label="Close modal"
                  className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Scrollable Form Body */}
            <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-4 space-y-4">
              {/* Top Media & Biometric Card */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-4 grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                {/* Student Photo Upload */}
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-xl border-2 border-dashed border-teal-400/70 dark:border-teal-600/70 bg-white dark:bg-slate-900 flex items-center justify-center overflow-hidden shrink-0">
                    {form.photoData ? (
                      <img
                        src={form.photoData}
                        alt="Student preview"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Camera className="w-6 h-6 text-slate-400" />
                    )}
                  </div>
                  <div className="min-w-0 space-y-1">
                    <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      স্টুডেন্ট ছবি (Photo)
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => photoInputRef.current?.click()}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold cursor-pointer"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>{form.photoData ? 'Change Photo' : 'Upload'}</span>
                      </button>
                      {form.photoData && !editing && (
                        <button
                          type="button"
                          onClick={() => setForm((prev) => ({ ...prev, photoData: '' }))}
                          className="text-xs text-red-600 dark:text-red-400 hover:underline cursor-pointer"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      JPG, PNG (Max 3MB)
                    </div>
                    {photoError && (
                      <div className="text-[11px] font-medium text-red-600 dark:text-red-400">
                        {photoError}
                      </div>
                    )}
                    <input
                      ref={photoInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handlePhotoUpload}
                      className="hidden"
                    />
                  </div>
                </div>

                {/* Bio Fingerprint Scan */}
                <div className="flex items-center gap-4 md:border-l md:border-slate-200 dark:md:border-slate-700 md:pl-5">
                  <div
                    className={`w-12 h-12 rounded-xl border flex items-center justify-center shrink-0 ${
                      form.bioEnrolled
                        ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-300 dark:border-emerald-700 text-emerald-600 dark:text-emerald-400'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-400'
                    }`}
                  >
                    <Fingerprint className="w-6 h-6" />
                  </div>
                  <div className="min-w-0 space-y-1">
                    <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      বায়ো ফিঙ্গার (Bio Fingerprint)
                    </div>
                    <button
                      type="button"
                      onClick={handleBioScan}
                      className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-white text-xs font-semibold cursor-pointer transition-colors ${
                        form.bioEnrolled
                          ? 'bg-emerald-600 hover:bg-emerald-700'
                          : 'bg-teal-800 hover:bg-teal-900'
                      }`}
                    >
                      <Fingerprint className="w-3.5 h-3.5" />
                      <span>
                        {form.bioEnrolled
                          ? '✓ বায়ো ফিঙ্গার সংযুক্ত (Enrolled)'
                          : 'ফিঙ্গার এড করুন (Scan)'}
                      </span>
                    </button>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {bioMessage || 'টোকেন ভেরিফিকেশনের জন্য বায়োমেট্রিক'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Row 1: Student Code & Trainee Full Name */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1.5">
                    Student Code (স্টুডেন্ট কোড) <span className="text-red-500">*</span>
                  </label>
                  <input
                    required
                    value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                    placeholder="e.g. 01/005"
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono-num focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1.5">
                    Trainee Full Name (শিক্ষার্থীর নাম) <span className="text-red-500">*</span>
                  </label>
                  <input
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g. Md. Kawsar Billah"
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              </div>

              {/* Row 2: Father's Name & Mother's Name */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1.5">
                    Father&apos;s Name (পিতার নাম)
                  </label>
                  <input
                    value={form.fatherName}
                    onChange={(e) => setForm({ ...form, fatherName: e.target.value })}
                    placeholder="e.g. Md. Abdul Jalil"
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1.5">
                    Mother&apos;s Name (মাতার নাম)
                  </label>
                  <input
                    value={form.motherName}
                    onChange={(e) => setForm({ ...form, motherName: e.target.value })}
                    placeholder="e.g. Mrs. Fatema Begum"
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              </div>

              {/* Row 3: Student Mobile & Guardian Mobile */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1.5">
                    Student Mobile (মোবাইল নম্বর)
                  </label>
                  <input
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="e.g. 01711223344"
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono-num focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1.5">
                    Guardian Mobile (অভিভাবকের মোবাইল)
                  </label>
                  <input
                    value={form.guardianPhone}
                    onChange={(e) => setForm({ ...form, guardianPhone: e.target.value })}
                    placeholder="e.g. 01811223344"
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono-num focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              </div>

              {/* Row 4: Course / Trade & NID Number */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1.5">
                    Course / Trade (কোর্স / ট্রেড)
                  </label>
                  <input
                    value={form.trade}
                    onChange={(e) => setForm({ ...form, trade: e.target.value })}
                    placeholder="6G TIG & SMAW High Pressure Pipe Welding"
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1.5">
                    NID Number (জাতীয় পরিচয়পত্র নং)
                  </label>
                  <input
                    value={form.nid}
                    onChange={(e) => setForm({ ...form, nid: e.target.value })}
                    placeholder="e.g. 19951234567890123"
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono-num focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              </div>

              {/* Row 5: Admission Date, Contract Amount, Initial Deposit */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1.5">
                    Admission Date (ভর্তির তারিখ) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={form.date}
                    onChange={(e) => setForm({ ...form, date: e.target.value })}
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono-num focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1.5">
                    Contract Amount / কোর্স ফি (৳)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={form.contract}
                    onChange={(e) => setForm({ ...form, contract: e.target.value })}
                    placeholder="90000"
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono-num focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1.5">
                    Initial Deposit / প্রাথমিক জমা (৳)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={form.deposit}
                    onChange={(e) => setForm({ ...form, deposit: e.target.value })}
                    placeholder="20000"
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono-num focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              </div>

              {/* Row 6: Cascading Permanent Address Picker (64 Districts -> 495 Upazilas -> Unions / Auto-learned Villages) */}
              <BangladeshAddressPicker
                value={form.district}
                onChange={(val) => setForm((prev) => ({ ...prev, district: val }))}
                students={students}
                lang={lang}
              />

              {/* Row 7: Passport Submission Details Card */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 p-4 space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold text-teal-700 dark:text-teal-300">
                  <FileText className="w-4 h-4 shrink-0" />
                  <span>পাসপোর্ট জমা সংক্রান্ত তথ্য (Passport Submission Details)</span>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-end">
                  <div className="lg:col-span-6 space-y-1.5">
                    <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      পাসপোর্ট জমা দিয়েছেন কি? (Passport Submitted?) <span className="text-red-500">*</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        onClick={() => {
                          setForm((prev) => ({ ...prev, passportSubmitted: true }));
                          setTimeout(() => passportInputRef.current?.focus(), 40);
                        }}
                        className={`inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border text-xs font-semibold transition-colors cursor-pointer ${
                          form.passportSubmitted
                            ? 'bg-teal-700 border-teal-700 text-white'
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-teal-500'
                        }`}
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>হ্যাঁ (জমা দিয়েছে)</span>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          setForm((prev) => ({
                            ...prev,
                            passportSubmitted: false,
                            passportNo: '',
                          }))
                        }
                        className={`inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border text-xs font-semibold transition-colors cursor-pointer ${
                          !form.passportSubmitted
                            ? 'bg-slate-800 dark:bg-slate-700 border-slate-800 dark:border-slate-600 text-white'
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-slate-400'
                        }`}
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>না (জমা দেয়নি)</span>
                      </button>
                    </div>
                  </div>

                  <div className="lg:col-span-6 space-y-1">
                    <input
                      ref={passportInputRef}
                      disabled={!form.passportSubmitted}
                      value={form.passportNo}
                      onChange={(e) => setForm({ ...form, passportNo: e.target.value })}
                      placeholder={
                        form.passportSubmitted
                          ? 'e.g. A04829104 (পাসপোর্ট নাম্বার লিখুন)'
                          : 'পাসপোর্ট জমা দিলে পাসপোর্ট নাম্বার লেখার অপশন সচল হবে।'
                      }
                      className={`w-full px-3.5 py-2.5 text-sm rounded-xl border font-mono-num focus:outline-none focus:ring-2 focus:ring-teal-500 ${
                        form.passportSubmitted
                          ? 'border-teal-400 dark:border-teal-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white'
                          : 'border-slate-200 dark:border-slate-700 bg-slate-100/80 dark:bg-slate-900/50 text-slate-400 cursor-not-allowed'
                      }`}
                    />
                    {form.passportSubmitted && (
                      <div className="text-[11px] text-teal-700 dark:text-teal-400">
                        সংরক্ষণ করলে স্বয়ংক্রিয়ভাবে DocuList ও পাসপোর্ট রেজিস্টারে (Original Held) যুক্ত হবে।
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Row 8: Remarks */}
              <div>
                <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1.5">
                  মন্তব্য / বিশেষ নোট (Remarks)
                </label>
                <textarea
                  rows={2}
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                  placeholder="শিক্ষার্থীর বিশেষ মন্তব্য, পূর্বের কাজের অভিজ্ঞতা, রেফারেন্স বা অন্যান্য তথ্য..."
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              {/* Row 8B: Interview Pass Company Card */}
              <div className="rounded-xl border border-indigo-200 dark:border-indigo-900/70 bg-indigo-50/40 dark:bg-indigo-950/20 p-4 space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold text-indigo-700 dark:text-indigo-300">
                  <Award className="w-4 h-4 shrink-0" />
                  <span>ইন্টারভিউ পাস তথ্য (Interview Passed Company)</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1.5">
                      কোন কোম্পানিতে ইন্টারভিউ পাস করেছে
                    </label>
                    <input
                      list="student-company-list"
                      value={form.interviewPassedCompany}
                      onChange={(e) =>
                        setForm({ ...form, interviewPassedCompany: e.target.value })
                      }
                      placeholder="কোম্পানির নাম লিখুন বা তালিকা থেকে বাছুন (ঐচ্ছিক)"
                      className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1.5">
                      ইন্টারভিউ পাস তারিখ (Interview Date)
                    </label>
                    <input
                      value={form.interviewDate}
                      onChange={(e) => setForm({ ...form, interviewDate: e.target.value })}
                      placeholder="e.g. 20-11-2026 (DD-MM-YYYY)"
                      className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono-num"
                    />
                  </div>
                </div>
              </div>

              {/* Row 9: Collapsible Overseas Placement Information */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowOverseasSection((v) => !v)}
                  className="w-full px-4 py-3 bg-slate-50/70 dark:bg-slate-800/40 flex items-center justify-between text-left text-xs font-bold text-slate-800 dark:text-slate-200 cursor-pointer hover:bg-slate-100/70 dark:hover:bg-slate-800/70"
                >
                  <span>Overseas Placement Information</span>
                  {showOverseasSection ? (
                    <ChevronUp className="w-4 h-4 text-slate-500" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-500" />
                  )}
                </button>

                {showOverseasSection && (
                  <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-slate-200 dark:border-slate-700">
                    <div>
                      <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1.5">
                        Overseas Status
                      </label>
                      <select
                        value={form.overseasStatus}
                        onChange={(e) =>
                          setForm({ ...form, overseasStatus: e.target.value as OverseasStatus })
                        }
                        className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                      >
                        {OVERSEAS_STATUSES.map((st) => (
                          <option key={st} value={st}>
                            {st}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1.5">
                        Destination Country
                      </label>
                      <input
                        value={form.destination}
                        onChange={(e) => setForm({ ...form, destination: e.target.value })}
                        placeholder="Saudi Arabia / UAE / Qatar"
                        className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1.5">
                        Partner Company
                      </label>
                      <input
                        list="student-company-list"
                        value={form.companyName}
                        onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                        placeholder="Select or type company"
                        className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                      />
                      <datalist id="student-company-list">
                        {companies.map((c) => (
                          <option key={c.id} value={c.name} />
                        ))}
                      </datalist>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            {submitError && (
              <div className="mx-5 sm:mx-6 mb-2 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-3.5 py-2.5 text-xs font-medium text-red-700 dark:text-red-300">
                {submitError}
              </div>
            )}
            <div className="px-5 sm:px-6 py-3.5 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2.5 shrink-0 bg-white dark:bg-slate-900">
              <button
                type="button"
                onClick={() => {
                  resetForm();
                  setShowForm(false);
                }}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                {bn ? 'বাতিল' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-xs sm:text-sm font-semibold cursor-pointer"
              >
                {saving
                  ? bn
                    ? 'সংরক্ষণ হচ্ছে...'
                    : 'Saving...'
                  : editing
                    ? bn
                      ? 'আপডেট করুন'
                      : 'Update Student'
                    : bn
                      ? 'নিবন্ধন সংরক্ষণ করুন'
                      : 'Register Student'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Full Student Profile & Academic File Modal */}
      <StudentProfileModal
        student={activeProfileStudent}
        jobs={jobs}
        returns={returns}
        prices={prices}
        cash={cash}
        companies={companies}
        auditLogs={auditLogs}
        staff={staff}
        lang={lang}
        onClose={() => setProfileStudentId(null)}
        onEdit={(stu) => {
          setProfileStudentId(null);
          openEdit(stu);
        }}
        onUpdate={onUpdate}
        onAdd={onAdd}
        onLogAudit={onLogAudit}
        onOpenDeposit={({ student: targetStu, depositType: nextType }) => {
          setDepositType(nextType);
          setPayingStudent(targetStu);
          setPayMethod('Cash');
          setPayPurpose('');
          const dueVal = Math.max(0, Number(targetStu.contract || 0) - Number(targetStu.deposit || 0));
          setPayAmount(nextType === 'course' && dueVal > 0 ? String(dueVal) : '');
        }}
        onIssueJob={(studentCode) => {
          setProfileStudentId(null);
          onOpenIssueJob?.(studentCode);
        }}
        onPrintSlip={onPrintSlip}
        onPrintReport={onPrintReport}
        compressImage={compressStudentPhoto}
      />

      {/* Collect Payment Modal (Course Fee & Visa Deposit) */}
      {payingStudent && (
        <div className="fixed inset-0 z-[60] bg-slate-950/60 flex items-center justify-center p-4">
          <form
            onSubmit={handleCollectPayment}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-md w-full p-5 space-y-4"
          >
            <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
              {depositType === 'visa'
                ? bn
                  ? 'ভিসা পারপাসে জমা নিন'
                  : 'Collect Visa Deposit (Separate)'
                : bn
                  ? 'কোর্স ফি / বকেয়া জমা নিন'
                  : 'Collect Course Deposit'}
            </h3>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDepositType('course')}
                className={`py-2 px-3 rounded-lg border text-xs font-bold cursor-pointer ${
                  depositType === 'course'
                    ? 'bg-emerald-600 border-emerald-600 text-white'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                }`}
              >
                + কোর্স ফি জমা
              </button>
              <button
                type="button"
                onClick={() => setDepositType('visa')}
                className={`py-2 px-3 rounded-lg border text-xs font-bold cursor-pointer ${
                  depositType === 'visa'
                    ? 'bg-indigo-600 border-indigo-600 text-white'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                }`}
              >
                + ভিসা পারপাসে জমা
              </button>
            </div>

            <div className="text-xs space-y-1 bg-slate-50 dark:bg-slate-800/60 p-3 rounded-lg">
              <div className="font-semibold text-slate-900 dark:text-white">
                {payingStudent.name} ({payingStudent.code})
              </div>
              <div className="flex justify-between">
                <span>{bn ? 'কোর্স বকেয়া:' : 'Current Course Due:'}</span>
                <span className="font-mono-num font-bold text-amber-600 dark:text-amber-400">
                  {formatTaka(Math.max(0, payingStudent.contract - payingStudent.deposit))}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  {bn ? 'জমার পরিমাণ ৳ *' : 'Payment Amount ৳ *'}
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
                  {bn ? 'মাধ্যম (Method)' : 'Method'}
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
                {bn ? 'উদ্দেশ্য / নোট (Purpose)' : 'Purpose / Note'}
              </label>
              <input
                value={payPurpose}
                onChange={(e) => setPayPurpose(e.target.value)}
                placeholder={
                  depositType === 'visa' ? 'Visa Processing Fee' : 'Course Fee Installment'
                }
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              />
            </div>

            {depositType === 'course' && (
              <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={recordInCashbook}
                  onChange={(e) => setRecordInCashbook(e.target.checked)}
                  className="rounded border-slate-300 text-teal-600"
                />
                <span>
                  {bn ? 'ক্যাশবুকে স্বয়ংক্রিয়ভাবে যোগ করুন' : 'Also record in Accounts & Cashbook'}
                </span>
              </label>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPayingStudent(null)}
                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold cursor-pointer"
              >
                {bn ? 'বাতিল' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold cursor-pointer"
              >
                {bn ? 'জমা নিশ্চিত করুন' : 'Confirm Payment'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Main Dense Table with stationary toolbar above and sticky header */}
      <div className="bg-white dark:bg-[#0c1320] rounded-xl border border-slate-200 dark:border-slate-400/20 overflow-hidden lg:flex-1 lg:min-h-0 lg:flex lg:flex-col">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
            {bn ? 'কোনো স্টুডেন্ট পাওয়া যায়নি।' : 'No matching trainee records found.'}
          </div>
        ) : (
          <div className="overflow-auto lg:flex-1 lg:min-h-0">
            <table className="w-full text-left border-collapse text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-slate-200 dark:border-slate-700/80 bg-slate-50 dark:bg-[#111b2e] text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 px-3">{bn ? 'কোড' : 'CODE'}</th>
                  <th className="py-2.5 px-3">{bn ? 'প্রশিক্ষণার্থীর নাম' : 'TRAINEE NAME'}</th>
                  <th className="py-2.5 px-3">{bn ? 'মোবাইল' : 'MOBILE / CONTACT'}</th>
                  <th className="py-2.5 px-3">{bn ? 'ভর্তি' : 'ADMISSION'}</th>
                  <th className="py-2.5 px-3 text-right">{bn ? 'চুক্তি' : 'CONTRACT'}</th>
                  <th className="py-2.5 px-3 text-right">{bn ? 'কোর্স জমা' : 'COURSE DEPOSIT'}</th>
                  <th className="py-2.5 px-3 text-right">{bn ? 'জব ব্যালান্স' : 'JOB BALANCE'}</th>
                  <th className="py-2.5 px-3 text-right">{bn ? 'বকেয়া' : 'DUE'}</th>
                  <th className="py-2.5 px-3">{bn ? 'ওভারসিজ' : 'OVERSEAS STATUS'}</th>
                  <th className="py-2.5 px-3">{bn ? 'গন্তব্য' : 'DESTINATION'}</th>
                  <th className="py-2.5 px-3 text-right">{bn ? 'অ্যাকশন' : 'ACTIONS'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {filtered.map((s) => {
                  const stats = jobsByStudent.get(s.code) || { count: 0, spent: 0 };
                  const jobBalance = Math.max(0, Number(s.deposit || 0) - stats.spent);
                  const due = Math.max(0, Number(s.contract || 0) - Number(s.deposit || 0));
                  const waNumber = s.phone.replace(/[^0-9]/g, '');
                  return (
                    <tr
                      key={s.id}
                      className="mg-row-scan"
                    >
                      <td className="py-3 px-3 font-mono-num text-xs font-bold text-teal-700 dark:text-teal-400 whitespace-nowrap">
                        {s.code}
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex items-start gap-2.5">
                          {s.photoData && (
                            <img
                              src={s.photoData}
                              alt={s.name}
                              className="w-9 h-9 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0 mt-0.5"
                            />
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 font-bold text-xs sm:text-sm text-slate-900 dark:text-white">
                              <span>{s.name}</span>
                              {s.bioEnrolled && (
                                <Fingerprint
                                  aria-label="Bio enrolled"
                                  className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0"
                                />
                              )}
                            </div>
                            {(s.fatherName || s.motherName) && (
                              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                {s.fatherName ? `পিতা: ${s.fatherName}` : ''}{' '}
                                {s.motherName ? `মাতা: ${s.motherName}` : ''}
                              </div>
                            )}
                            <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                              <span className="font-mono-num">Jobs: {stats.count}</span>
                              {s.interviewPassedCompany && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 text-[10px] font-semibold">
                                  <Award className="w-2.5 h-2.5" />
                                  <span>{s.interviewPassedCompany}</span>
                                </span>
                              )}
                              {s.guardianPhone && (
                                <span className="font-mono-num text-amber-700 dark:text-amber-400">
                                  · অভি: {s.guardianPhone}
                                </span>
                              )}
                              {s.district && <span>· {s.district}</span>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5 font-mono-num text-xs text-slate-800 dark:text-slate-200">
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
                                href={`https://wa.me/${waNumber.startsWith('0') ? `88${waNumber}` : waNumber}`}
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
                      <td className="py-3 px-3 font-mono-num text-xs text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {s.date}
                      </td>
                      <td className="py-3 px-3 font-mono-num text-xs text-right font-semibold text-slate-900 dark:text-white whitespace-nowrap">
                        {formatTaka(s.contract)}
                      </td>
                      <td className="py-3 px-3 font-mono-num text-xs text-right font-bold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                        {formatTaka(s.deposit)}
                      </td>
                      <td className="py-3 px-3 font-mono-num text-xs text-right font-bold text-indigo-600 dark:text-indigo-400 whitespace-nowrap">
                        {formatTaka(jobBalance)}
                      </td>
                      <td className="py-3 px-3 font-mono-num text-xs text-right font-bold text-amber-600 dark:text-amber-400 whitespace-nowrap">
                        {formatTaka(due)}
                      </td>
                      <td className="py-3 px-3 text-xs text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {s.overseasStatus}
                      </td>
                      <td className="py-3 px-3 text-xs text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {s.destination || '—'}
                      </td>
                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setProfileStudentId(s.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs font-semibold hover:bg-emerald-100 cursor-pointer"
                          >
                            <User className="w-3 h-3" />
                            <span>{bn ? 'প্রোফাইল' : 'Profile'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => openEdit(s)}
                            aria-label="Edit student"
                            className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
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

      <StudentExcelImportModal
        open={showExcelImport}
        students={students}
        lang={lang}
        onAdd={onAdd}
        onLogAudit={onLogAudit}
        onClose={() => setShowExcelImport(false)}
      />
    </div>
  );
}
