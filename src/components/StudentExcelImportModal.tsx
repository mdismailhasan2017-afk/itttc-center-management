import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  Download,
  Loader2,
  Maximize2,
  Minimize2,
  Upload,
  X,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import type { SubCollectionKey } from '../lib/store';
import { todayDDMMYYYY } from '../lib/format';
import type { Lang, OverseasStatus, Student } from '../types';

const OVERSEAS_STATUSES: OverseasStatus[] = [
  'Not Applied',
  'Interview Attended',
  'Selected',
  'Visa Processing',
  'Flight Ready',
];

interface StudentExcelImportModalProps {
  open: boolean;
  students: Student[];
  lang: Lang;
  onAdd: (key: SubCollectionKey, raw: Record<string, unknown>) => Promise<string>;
  onLogAudit?: (action: string, module: string, detail: string) => Promise<void>;
  onClose: () => void;
}

interface ImportSummary {
  fileName: string;
  totalRows: number;
  importedCount: number;
  duplicateCount: number;
  invalidCount: number;
  duplicateSamples: string[];
}

function normalizeHeader(h: unknown): string {
  return String(h ?? '')
    .trim()
    .toLowerCase()
    .replace(/['"`]/g, '')
    .replace(/[^a-z0-9\u0980-\u09ff]+/g, ' ')
    .trim();
}

function formatExcelCellDate(val: unknown): string {
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    const d = String(val.getDate()).padStart(2, '0');
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const y = val.getFullYear();
    return `${d}-${m}-${y}`;
  }
  if (typeof val === 'number' && Number.isFinite(val) && val > 20000 && val < 90000) {
    const parsed = XLSX.SSF.parse_date_code(val);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      return `${String(parsed.d).padStart(2, '0')}-${String(parsed.m).padStart(2, '0')}-${parsed.y}`;
    }
  }
  const s = String(val ?? '').trim();
  if (!s) return todayDDMMYYYY();
  const isoMatch = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (isoMatch) {
    return `${isoMatch[3].padStart(2, '0')}-${isoMatch[2].padStart(2, '0')}-${isoMatch[1]}`;
  }
  const dmyMatch = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmyMatch) {
    return `${dmyMatch[1].padStart(2, '0')}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[3]}`;
  }
  return s.slice(0, 20);
}

function normalizePhone(val: unknown): string {
  const raw = String(val ?? '').trim();
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('1')) {
    return `0${digits}`;
  }
  return raw;
}

function cleanNumber(val: unknown, fallback = 0): number {
  if (typeof val === 'number') {
    return Number.isFinite(val) && val >= 0 ? val : fallback;
  }
  const cleaned = String(val ?? '').replace(/[^0-9.]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 && cleaned !== '' ? n : fallback;
}

type FieldKey =
  | 'code'
  | 'name'
  | 'fatherName'
  | 'motherName'
  | 'phone'
  | 'guardianPhone'
  | 'district'
  | 'nid'
  | 'trade'
  | 'passportNo'
  | 'date'
  | 'contract'
  | 'deposit'
  | 'overseasStatus'
  | 'destination'
  | 'companyName'
  | 'note';

const HEADER_ALIASES: Record<FieldKey, string[]> = {
  code: [
    'code',
    'student code',
    'khata',
    'khata no',
    'khata number',
    'roll',
    'roll no',
    'student id',
    'id',
    'স্টুডেন্ট কোড',
    'খাতা নাম্বার',
    'খাতা',
    'কোড',
  ],
  name: [
    'name',
    'trainee name',
    'student name',
    'full name',
    'trainee full name',
    'শিক্ষার্থীর নাম',
    'প্রশিক্ষণার্থীর নাম',
    'নাম',
  ],
  fatherName: ['father', 'father name', 'fathers name', 'পিতা', 'পিতার নাম'],
  motherName: ['mother', 'mother name', 'mothers name', 'মাতা', 'মাতার নাম'],
  phone: ['mobile', 'phone', 'student mobile', 'mobile no', 'contact', 'মোবাইল', 'মোবাইল নম্বর'],
  guardianPhone: [
    'guardian phone',
    'guardian mobile',
    'guardian',
    'অভিভাবক',
    'অভিভাবকের মোবাইল',
  ],
  district: ['district', 'address', 'location', 'address location', 'জেলা', 'ঠিকানা', 'স্থায়ী ঠিকানা'],
  nid: ['nid', 'nid number', 'nid no', 'national id', 'জাতীয় পরিচয়পত্র'],
  trade: ['trade', 'course', 'course trade', 'ট্রেড', 'কোর্স', 'কোর্স ট্রেড'],
  passportNo: ['passport', 'passport no', 'passport number', 'পাসপোর্ট', 'পাসপোর্ট নাম্বার'],
  date: ['date', 'admission', 'admission date', 'ভর্তি', 'ভর্তির তারিখ', 'তারিখ'],
  contract: ['contract', 'contract amount', 'course fee', 'fee', 'চুক্তি', 'কোর্স ফি'],
  deposit: ['deposit', 'initial deposit', 'course deposit', 'paid', 'জমা', 'কোর্স জমা', 'প্রাথমিক জমা'],
  overseasStatus: ['overseas status', 'status', 'ওভারসিজ', 'ওভারসিজ স্ট্যাটাস', 'স্ট্যাটাস'],
  destination: ['destination', 'country', 'destination country', 'গন্তব্য', 'দেশ'],
  companyName: ['company', 'company name', 'partner company', 'কোম্পানি'],
  note: ['note', 'remarks', 'মন্তব্য'],
};

function mapHeaderColumns(headers: unknown[]): Map<FieldKey, number> {
  const map = new Map<FieldKey, number>();
  headers.forEach((rawHeader, idx) => {
    const norm = normalizeHeader(rawHeader);
    if (!norm) return;
    for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [FieldKey, string[]][]) {
      if (map.has(field)) continue;
      if (aliases.some((alias) => norm === alias || norm.includes(alias))) {
        map.set(field, idx);
        break;
      }
    }
  });
  return map;
}

export function StudentExcelImportModal({
  open,
  students,
  lang,
  onAdd,
  onLogAudit,
  onClose,
}: StudentExcelImportModalProps) {
  const bn = lang === 'bn';
  const fileInputRef = useRef<HTMLInputElement>(null);
  const busyLockRef = useRef(false);

  const [fullScreen, setFullScreen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  if (!open) return null;

  const handleDownloadTemplate = () => {
    const headers = [
      'Student Code',
      'Trainee Name',
      'Father Name',
      'Mother Name',
      'Mobile',
      'Guardian Phone',
      'District / Address',
      'Trade / Course',
      'Admission Date',
      'Contract Amount',
      'Deposit',
      'Passport No',
      'NID Number',
      'Overseas Status',
      'Destination',
      'Company',
      'Note',
    ];
    const sampleRow = [
      '14/101',
      'MD. RAHIM UDDIN',
      'MD. KARIM UDDIN',
      'MRS. AMENA BEGUM',
      '01711000000',
      '01811000000',
      'Cumilla',
      '6G TIG & SMAW High Pressure Pipe Welding',
      todayDDMMYYYY(),
      90000,
      20000,
      'A04829104',
      '19981234567890123',
      'Not Applied',
      'Saudi Arabia',
      '',
      '',
    ];
    const ws = XLSX.utils.aoa_to_sheet([headers, sampleRow]);
    ws['!cols'] = headers.map((h) => ({ wch: Math.max(16, h.length + 4) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Students');
    XLSX.writeFile(wb, 'ittc-student-import-template.xlsx');
  };

  const processExcelFile = async (file: File) => {
    if (busyLockRef.current) return;
    busyLockRef.current = true;
    setImporting(true);
    setErrorMsg(null);
    setSummary(null);
    setProgress(null);

    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      if (!['xlsx', 'xls', 'csv'].includes(ext)) {
        throw new Error(
          bn
            ? 'অনুগ্রহ করে সঠিক .xlsx, .xls অথবা .csv ফাইল নির্বাচন করুন।'
            : 'Please select a valid .xlsx, .xls, or .csv file.'
        );
      }

      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
      const firstSheetName = workbook.SheetNames.find((name) => {
        const sheet = workbook.Sheets[name];
        return sheet && sheet['!ref'];
      });
      if (!firstSheetName) {
        throw new Error(
          bn ? 'এক্সেল ফাইলে কোনো ডাটা পাওয়া যায়নি।' : 'No readable sheet data found in the file.'
        );
      }

      const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[firstSheetName], {
        header: 1,
        defval: '',
        blankrows: false,
      });

      if (rows.length < 2) {
        throw new Error(
          bn
            ? 'এক্সেল শিটে হেডারসহ অন্তত একটি স্টুডেন্ট সারি থাকতে হবে।'
            : 'The Excel sheet must contain a header row and at least one student row.'
        );
      }

      const headerMap = mapHeaderColumns(rows[0]);
      const hasKnownHeaders = headerMap.has('name') || headerMap.has('code');

      // Build strict duplicate lookup sets from ALL existing students + rows processed in this file
      const seenCodes = new Set<string>();
      const seenPassports = new Set<string>();
      const seenNids = new Set<string>();
      const seenNamePhones = new Set<string>();
      const seenNameFathers = new Set<string>();

      for (const s of students) {
        const normCode = (s.code || '').trim().toLowerCase();
        if (normCode) seenCodes.add(normCode);
        const normPass = (s.passportNo || '').trim().toUpperCase();
        if (normPass) seenPassports.add(normPass);
        const normNid = (s.nid || '').trim().toLowerCase();
        if (normNid) seenNids.add(normNid);
        const normName = (s.name || '').trim().toUpperCase();
        const normPhone = normalizePhone(s.phone).replace(/\D/g, '');
        if (normName && normPhone) seenNamePhones.add(`${normName}|${normPhone}`);
        const normFather = (s.fatherName || '').trim().toUpperCase();
        if (normName && normFather) seenNameFathers.add(`${normName}|${normFather}`);
      }

      const getVal = (row: unknown[], key: FieldKey, fallbackIdx?: number): unknown => {
        const mappedIdx = headerMap.get(key);
        if (mappedIdx !== undefined) return row[mappedIdx];
        if (!hasKnownHeaders && fallbackIdx !== undefined) return row[fallbackIdx];
        return '';
      };

      const toImport: Array<Record<string, unknown>> = [];
      let duplicateCount = 0;
      let invalidCount = 0;
      const duplicateSamples: string[] = [];

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!Array.isArray(row) || row.every((cell) => String(cell ?? '').trim() === '')) {
          continue;
        }

        const rawCode = String(getVal(row, 'code', 0) ?? '').trim();
        const rawName = String(getVal(row, 'name', 1) ?? '').trim().toUpperCase();
        const rawFather = String(getVal(row, 'fatherName', 2) ?? '').trim().toUpperCase();
        const rawMother = String(getVal(row, 'motherName', 3) ?? '').trim().toUpperCase();
        const rawPhone = normalizePhone(getVal(row, 'phone', 4));
        const rawGuardian = normalizePhone(getVal(row, 'guardianPhone', 5));
        const rawDistrict = String(getVal(row, 'district', 6) ?? '').trim();
        const rawTrade = String(getVal(row, 'trade') ?? '').trim() || '6G TIG & SMAW High Pressure Pipe Welding';
        const rawDate = formatExcelCellDate(getVal(row, 'date', 7));
        const rawContract = cleanNumber(getVal(row, 'contract', 8), 90000);
        const rawDeposit = cleanNumber(getVal(row, 'deposit', 9), 0);
        const rawPassport = String(getVal(row, 'passportNo') ?? '').trim().toUpperCase();
        const rawNid = String(getVal(row, 'nid') ?? '').trim();
        const rawStatusStr = String(getVal(row, 'overseasStatus', 12) ?? '').trim();
        const rawDestination = String(getVal(row, 'destination', 13) ?? '').trim();
        const rawCompany = String(getVal(row, 'companyName', 14) ?? '').trim();
        const rawNote = String(getVal(row, 'note') ?? '').trim();

        const studentName = rawName || rawCode.toUpperCase();
        if (!studentName) {
          invalidCount++;
          continue;
        }

        const normCode = rawCode.toLowerCase();
        const normPass = rawPassport.toUpperCase();
        const normNid = rawNid.toLowerCase();
        const normPhoneDigits = rawPhone.replace(/\D/g, '');
        const namePhoneKey = studentName && normPhoneDigits ? `${studentName}|${normPhoneDigits}` : '';
        const nameFatherKey = !normCode && studentName && rawFather ? `${studentName}|${rawFather}` : '';

        const isDup =
          (normCode !== '' && seenCodes.has(normCode)) ||
          (normPass !== '' && seenPassports.has(normPass)) ||
          (normNid !== '' && seenNids.has(normNid)) ||
          (namePhoneKey !== '' && seenNamePhones.has(namePhoneKey)) ||
          (nameFatherKey !== '' && seenNameFathers.has(nameFatherKey));

        if (isDup) {
          duplicateCount++;
          if (duplicateSamples.length < 5) {
            duplicateSamples.push(rawCode ? `${studentName} (${rawCode})` : studentName);
          }
          continue;
        }

        const finalCode =
          rawCode || `${new Date().getMonth() + 1}/${100 + students.length + toImport.length + 1}`;

        seenCodes.add(finalCode.toLowerCase());
        if (normPass) seenPassports.add(normPass);
        if (normNid) seenNids.add(normNid);
        if (namePhoneKey) seenNamePhones.add(namePhoneKey);
        if (rawFather) seenNameFathers.add(`${studentName}|${rawFather}`);

        const matchedStatus = OVERSEAS_STATUSES.find(
          (st) => st.toLowerCase() === rawStatusStr.toLowerCase()
        );

        toImport.push({
          date: rawDate,
          code: finalCode,
          name: studentName,
          fatherName: rawFather,
          motherName: rawMother,
          phone: rawPhone,
          guardianPhone: rawGuardian,
          district: rawDistrict,
          nid: rawNid,
          trade: rawTrade,
          passportSubmitted: Boolean(rawPassport),
          passportNo: rawPassport,
          photoData: '',
          bioEnrolled: false,
          companyName: rawCompany,
          overseasStatus: matchedStatus || 'Not Applied',
          destination: rawDestination,
          contract: rawContract,
          deposit: rawDeposit,
          note: rawNote,
        });
      }

      if (toImport.length > 0) {
        setProgress({ current: 0, total: toImport.length });
        for (let idx = 0; idx < toImport.length; idx++) {
          await onAdd('students', toImport[idx]);
          setProgress({ current: idx + 1, total: toImport.length });
        }
        await onLogAudit?.(
          'IMPORT_STUDENTS_EXCEL',
          'Student Management',
          `Auto-imported ${toImport.length} students from ${file.name} (${duplicateCount} duplicates skipped)`
        );
      }

      setSummary({
        fileName: file.name,
        totalRows: Math.max(0, rows.length - 1),
        importedCount: toImport.length,
        duplicateCount,
        invalidCount,
        duplicateSamples,
      });
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : bn
            ? 'এক্সেল ফাইলটি পড়া যায়নি।'
            : 'Failed to parse Excel file.'
      );
    } finally {
      busyLockRef.current = false;
      setImporting(false);
    }
  };

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) {
      void processExcelFile(file);
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!importing) setDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    if (importing) return;
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void processExcelFile(file);
    }
  };

  return (
    <div
      className={`fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[1px] flex items-center justify-center ${
        fullScreen ? 'p-0' : 'p-4'
      }`}
      role="dialog"
      aria-modal="true"
      aria-label="Import Students from Excel File"
    >
      <div
        className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col overflow-hidden ${
          fullScreen ? 'w-full h-full max-w-none rounded-none' : 'w-full max-w-4xl rounded-2xl'
        }`}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <h2 className="font-display text-base sm:text-lg font-extrabold text-slate-900 dark:text-white">
            Import Students from Excel File
          </h2>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setFullScreen((v) => !v)}
              aria-label={fullScreen ? 'Exit full screen' : 'Full screen'}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              {fullScreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button
              type="button"
              disabled={importing}
              onClick={onClose}
              aria-label="Close modal"
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer disabled:opacity-50"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 flex-1 overflow-y-auto">
          {/* Smart Importer Banner */}
          <div className="rounded-xl border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/70 dark:bg-emerald-950/30 p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-10 h-10 rounded-full bg-teal-600 text-white flex items-center justify-center shrink-0">
                <Cloud className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="text-xs sm:text-sm font-extrabold tracking-wide text-slate-900 dark:text-white uppercase">
                  SMART EXCEL STUDENT IMPORTER
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                  Automatic column mapping, validation, duplicate checks, and multi-device sync
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleDownloadTemplate}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-teal-500/40 bg-white dark:bg-slate-900 hover:bg-teal-50 dark:hover:bg-slate-800 text-teal-700 dark:text-teal-300 text-xs font-semibold cursor-pointer shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download Template</span>
            </button>
          </div>

          {/* Drag & Drop Zone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`rounded-xl border-2 border-dashed p-8 sm:p-10 text-center transition-colors ${
              dragging
                ? 'border-teal-500 bg-teal-50/60 dark:bg-teal-950/30'
                : 'border-slate-300 dark:border-slate-700 bg-slate-50/30 dark:bg-slate-800/20'
            }`}
          >
            <div className="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-teal-600 dark:text-teal-400 mx-auto flex items-center justify-center mb-3">
              {importing ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Upload className="w-5 h-5" />
              )}
            </div>

            <div className="text-sm font-bold text-slate-900 dark:text-white">
              {importing
                ? bn
                  ? 'এক্সেল তথ্য অটো-আপলোড হচ্ছে...'
                  : 'Auto-uploading student records...'
                : 'Drop your .xlsx or .xls file here, or browse from computer'}
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              সাপোর্ট করে: Microsoft Excel 97-2024 (.xlsx, .xls), CSV
            </p>

            {progress && importing && (
              <div className="mt-3 text-xs font-mono-num font-semibold text-teal-700 dark:text-teal-300">
                {progress.current} / {progress.total}
              </div>
            )}

            <div className="mt-5">
              <button
                type="button"
                disabled={importing}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center justify-center px-5 py-2.5 rounded-lg bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white text-xs sm:text-sm font-semibold cursor-pointer shadow-xs"
              >
                {importing
                  ? bn
                    ? 'আপলোড হচ্ছে...'
                    : 'Uploading...'
                  : 'Select Excel File'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                onChange={handleFileInputChange}
                className="hidden"
              />
            </div>
          </div>

          {/* Error Banner */}
          {errorMsg && (
            <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-3.5 flex items-start gap-2.5 text-xs text-red-700 dark:text-red-300">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Auto-Import & Duplicate Check Result */}
          {summary && (
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/30 p-4 space-y-2">
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                <div className="text-xs text-slate-800 dark:text-slate-200 space-y-1">
                  <div className="font-bold">
                    {bn
                      ? `${summary.fileName} — ${summary.importedCount} জন নতুন স্টুডেন্ট অটো-আপলোড হয়েছে!`
                      : `${summary.fileName} — ${summary.importedCount} new students auto-imported!`}
                  </div>
                  <div className="text-slate-600 dark:text-slate-400">
                    {bn
                      ? `মোট সারি: ${summary.totalRows} · নতুন যুক্ত: ${summary.importedCount} · ডুপ্লিকেট বাদ (আগে থেকেই আছে): ${summary.duplicateCount}`
                      : `Total rows: ${summary.totalRows} · Added: ${summary.importedCount} · Duplicates skipped: ${summary.duplicateCount}`}
                    {summary.invalidCount > 0
                      ? bn
                        ? ` · খালি/অবৈধ: ${summary.invalidCount}`
                        : ` · Invalid: ${summary.invalidCount}`
                      : ''}
                  </div>
                  {summary.duplicateSamples.length > 0 && (
                    <div className="text-[11px] text-amber-700 dark:text-amber-300">
                      {bn ? 'বাদ দেওয়া ডুপ্লিকেট: ' : 'Skipped duplicates: '}
                      {summary.duplicateSamples.join(', ')}
                      {summary.duplicateCount > summary.duplicateSamples.length ? ' ...' : ''}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2 bg-white dark:bg-slate-900">
          <button
            type="button"
            disabled={importing}
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer disabled:opacity-50"
          >
            {summary ? (bn ? 'সম্পন্ন (Close)' : 'Done') : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}
