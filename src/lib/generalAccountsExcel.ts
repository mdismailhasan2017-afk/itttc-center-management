import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import { convertBijoyToUnicode, isSutonnyFontName } from './bijoyToUnicode';

export interface ParsedExcelTxRow {
  date: string;
  dateKey: string;
  inDesc: string;
  inCash: string;
  inBank: string;
  outDesc: string;
  outCash: string;
}

export interface ParsedExcelOpening {
  prevDate: string;
  targetDate: string;
  cash: number;
  bank: number;
}

export interface ParsedExcelFileResult {
  fileName: string;
  fileDateDot: string;
  fileDateKey: string;
  opening: ParsedExcelOpening | null;
  txRows: ParsedExcelTxRow[];
  skippedFooterCount: number;
  warning?: string;
}

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

export function normalizeDigitsEn(str: unknown): string {
  return String(str ?? '')
    .replace(/[−–—]/g, '-')
    .replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function buildDatePartsKey(day: number, month: number, year: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function formatDotDateFromParts(day: number, month: number, year: number): string {
  return `${pad2(day)}.${pad2(month)}.${year}`;
}

function isValidCalendarParts(day: number, month: number, year: number): boolean {
  return (
    Number.isInteger(day) &&
    Number.isInteger(month) &&
    Number.isInteger(year) &&
    year >= 1990 &&
    year <= 2150 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= 31
  );
}

export function parseDateStringParts(
  raw: string
): { day: number; month: number; year: number } | null {
  const cleaned = normalizeDigitsEn(raw).trim();
  if (!cleaned) return null;

  // Try YYYY-MM-DD or YYYY.MM.DD or YYYY/MM/DD
  const ymd = cleaned.match(/(?:^|[^\d])(\d{4})[.\-_/](\d{1,2})[.\-_/](\d{1,2})(?=[^\d]|$)/);
  if (ymd) {
    const year = Number(ymd[1]);
    const month = Number(ymd[2]);
    const day = Number(ymd[3]);
    if (isValidCalendarParts(day, month, year)) return { day, month, year };
  }

  // Try DD.MM.YYYY or DD-MM-YYYY or DD/MM/YYYY or DD.MM.YY
  const dmy = cleaned.match(/(?:^|[^\d])(\d{1,2})[.\-_/](\d{1,2})[.\-_/](\d{2,4})(?=[^\d]|$)/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    let year = Number(dmy[3]);
    if (year > 0 && year < 100) year += 2000;
    if (isValidCalendarParts(day, month, year)) return { day, month, year };
  }

  return null;
}

export function extractDateFromFilename(
  fileName: string
): { dotDate: string; dateKey: string } | null {
  const withoutExt = fileName.replace(/\.[^/.]+$/, '');
  const parts = parseDateStringParts(withoutExt);
  if (!parts) return null;
  return {
    dotDate: formatDotDateFromParts(parts.day, parts.month, parts.year),
    dateKey: buildDatePartsKey(parts.day, parts.month, parts.year),
  };
}

export function parseExcelCellDate(raw: unknown): { dotDate: string; dateKey: string } | null {
  if (raw === null || raw === undefined || raw === '') return null;

  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    const day = raw.getDate();
    const month = raw.getMonth() + 1;
    const year = raw.getFullYear();
    if (isValidCalendarParts(day, month, year)) {
      return {
        dotDate: formatDotDateFromParts(day, month, year),
        dateKey: buildDatePartsKey(day, month, year),
      };
    }
  }

  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 25000 && raw < 90000) {
    try {
      const parsed = XLSX.SSF.parse_date_code(raw);
      if (parsed && isValidCalendarParts(parsed.d, parsed.m, parsed.y)) {
        return {
          dotDate: formatDotDateFromParts(parsed.d, parsed.m, parsed.y),
          dateKey: buildDatePartsKey(parsed.d, parsed.m, parsed.y),
        };
      }
    } catch {
      // fall through
    }
  }

  const str = String(raw).trim();
  if (!str) return null;
  const parts = parseDateStringParts(str);
  if (!parts) return null;
  return {
    dotDate: formatDotDateFromParts(parts.day, parts.month, parts.year),
    dateKey: buildDatePartsKey(parts.day, parts.month, parts.year),
  };
}

// Safely evaluate simple pure arithmetic formulas like "=5000+400" or "=10000-500"
function evalSimpleArithmeticFormula(formulaRaw: string): number | null {
  const expr = normalizeDigitsEn(formulaRaw)
    .replace(/^=/, '')
    .replace(/,/g, '')
    .replace(/\s+/g, '');
  if (!expr) return null;

  // Support simple SUM(num1, num2, ...) of literal numbers
  const sumLiteral = expr.match(/^SUM\(([\d.+\-*/,]+)\)$/i);
  if (sumLiteral) {
    const total = sumLiteral[1]
      .split(',')
      .map((p) => parseFloat(p))
      .filter((n) => Number.isFinite(n))
      .reduce((a, b) => a + b, 0);
    return Number.isFinite(total) ? Math.round(total * 100) / 100 : null;
  }

  // Only allow digits, decimal points, +, -, *, /, parentheses
  if (!/^[0-9.+\-*/()]+$/.test(expr)) return null;
  try {
    const tokens = expr.match(/\d+(?:\.\d+)?|[+\-*/()]/g);
    if (!tokens || tokens.join('') !== expr) return null;

    let pos = 0;
    const parseExpr = (): number => {
      let left = parseTerm();
      while (tokens[pos] === '+' || tokens[pos] === '-') {
        const op = tokens[pos++];
        const right = parseTerm();
        left = op === '+' ? left + right : left - right;
      }
      return left;
    };
    const parseTerm = (): number => {
      let left = parseFactor();
      while (tokens[pos] === '*' || tokens[pos] === '/') {
        const op = tokens[pos++];
        const right = parseFactor();
        left = op === '*' ? left * right : right === 0 ? 0 : left / right;
      }
      return left;
    };
    const parseFactor = (): number => {
      if (tokens[pos] === '+') {
        pos++;
        return parseFactor();
      }
      if (tokens[pos] === '-') {
        pos++;
        return -parseFactor();
      }
      if (tokens[pos] === '(') {
        pos++;
        const val = parseExpr();
        if (tokens[pos] === ')') pos++;
        return val;
      }
      const num = parseFloat(tokens[pos++] || '0');
      return Number.isFinite(num) ? num : 0;
    };
    const result = parseExpr();
    if (!Number.isFinite(result) || pos !== tokens.length) return null;
    return Math.round(result * 100) / 100;
  } catch {
    return null;
  }
}

export function parseExcelNum(raw: unknown): number {
  if (raw === null || raw === undefined || raw === '') return 0;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return 0;
    return Math.round(raw * 100) / 100;
  }
  const str = normalizeDigitsEn(String(raw)).trim();
  if (!str) return 0;
  if (str.startsWith('=')) {
    const computed = evalSimpleArithmeticFormula(str);
    return computed ?? 0;
  }
  const cleaned = str
    .replace(/[,৳\s]/g, '')
    .replace(/(?:BDT|TK|টাকা|\/=|\/-)/gi, '')
    .replace(/[^\d.-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return 0;
  const n = parseFloat(cleaned);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function cleanCellText(raw: unknown): string {
  return String(raw ?? '')
    .normalize('NFC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getPrevDotDateSimple(dotStr: string): string {
  const p = parseDateStringParts(dotStr);
  if (!p) return '';
  const dt = new Date(p.year, p.month - 1, p.day);
  dt.setDate(dt.getDate() - 1);
  return formatDotDateFromParts(dt.getDate(), dt.getMonth() + 1, dt.getFullYear());
}

function getNextDotDateSimple(dotStr: string): string {
  const p = parseDateStringParts(dotStr);
  if (!p) return '';
  const dt = new Date(p.year, p.month - 1, p.day);
  dt.setDate(dt.getDate() + 1);
  return formatDotDateFromParts(dt.getDate(), dt.getMonth() + 1, dt.getFullYear());
}

interface ExtractedGrid {
  matrix: unknown[][];
  sumFormulaRows: Set<number>;
}

function isRangeSumFormula(formulaStr?: string): boolean {
  if (!formulaStr) return false;
  return /\b(?:SUM|SUBTOTAL)\s*\([^)]*:/i.test(formulaStr);
}

function resolveFormulaCell(
  valObj: { formula?: string; sharedFormula?: string; result?: unknown },
  sheetJsFallback: unknown,
  cellIsSutonny: boolean
): { value: unknown; isRangeSum: boolean } {
  const formulaStr = valObj.formula || '';
  const isRangeSum = isRangeSumFormula(formulaStr);
  const res = valObj.result;

  if (res !== undefined && res !== null) {
    if (res instanceof Date || typeof res === 'number') {
      return { value: res, isRangeSum };
    }
    if (typeof res === 'string') {
      return { value: convertBijoyToUnicode(res, cellIsSutonny), isRangeSum };
    }
    // Excel error object like { error: '#VALUE!' } -> check SheetJS fallback
  }

  // Fallback to SheetJS cached value
  if (sheetJsFallback !== undefined && sheetJsFallback !== null && sheetJsFallback !== '') {
    if (typeof sheetJsFallback === 'string') {
      return {
        value: convertBijoyToUnicode(sheetJsFallback, cellIsSutonny),
        isRangeSum,
      };
    }
    return { value: sheetJsFallback, isRangeSum };
  }

  // Evaluate pure arithmetic literal formula if uncached (e.g. "=5000+400")
  if (formulaStr) {
    const computed = evalSimpleArithmeticFormula(`=${formulaStr}`);
    if (computed !== null) {
      return { value: computed, isRangeSum };
    }
  }

  return { value: '', isRangeSum };
}

function extractExcelJsCellValue(
  cell: ExcelJS.Cell,
  sheetJsFallback: unknown
): { value: unknown; isRangeSum: boolean } {
  const val = cell.value;
  if (val === null || val === undefined || val === '') {
    if (sheetJsFallback !== undefined && sheetJsFallback !== null && sheetJsFallback !== '') {
      const cellIsSutonny = isSutonnyFontName(cell.font?.name);
      return {
        value:
          typeof sheetJsFallback === 'string'
            ? convertBijoyToUnicode(sheetJsFallback, cellIsSutonny)
            : sheetJsFallback,
        isRangeSum: false,
      };
    }
    return { value: '', isRangeSum: false };
  }

  const cellIsSutonny = isSutonnyFontName(cell.font?.name);

  if (val instanceof Date || typeof val === 'number') {
    return { value: val, isRangeSum: false };
  }

  if (typeof val === 'string') {
    return { value: convertBijoyToUnicode(val, cellIsSutonny), isRangeSum: false };
  }

  if (typeof val === 'object') {
    if ('formula' in val || 'sharedFormula' in val || 'result' in val) {
      return resolveFormulaCell(
        val as { formula?: string; sharedFormula?: string; result?: unknown },
        sheetJsFallback,
        cellIsSutonny
      );
    }
    if ('richText' in val && Array.isArray((val as { richText?: unknown[] }).richText)) {
      const runs = (
        val as { richText: Array<{ text?: string; font?: { name?: string } }> }
      ).richText;
      const text = runs
        .map((seg) => {
          const txt = seg.text || '';
          const runIsSutonny = seg.font?.name
            ? isSutonnyFontName(seg.font.name)
            : cellIsSutonny;
          return convertBijoyToUnicode(txt, runIsSutonny);
        })
        .join('');
      return { value: text, isRangeSum: false };
    }
    if ('text' in val && typeof (val as { text?: unknown }).text === 'string') {
      return {
        value: convertBijoyToUnicode((val as { text: string }).text, cellIsSutonny),
        isRangeSum: false,
      };
    }
  }

  const fallbackText = cell.text || '';
  return {
    value: convertBijoyToUnicode(fallbackText, cellIsSutonny),
    isRangeSum: false,
  };
}

interface NamedExtractedGrid extends ExtractedGrid {
  sheetName: string;
}

function readAllSheetJSGrids(buffer: ArrayBuffer): NamedExtractedGrid[] {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false });
  if (!wb.SheetNames.length) return [];

  const results: NamedExtractedGrid[] = [];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      defval: '',
      raw: true,
    });
    if (rows.length > 0) {
      const sumFormulaRows = new Set<number>();
      const range = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : null;
      if (range) {
        for (let r = range.s.r; r <= range.e.r; r++) {
          for (let c = 0; c <= 8; c++) {
            const addr = XLSX.utils.encode_cell({ r, c });
            const cellObj = ws[addr] as XLSX.CellObject | undefined;
            if (cellObj?.f && isRangeSumFormula(cellObj.f)) {
              sumFormulaRows.add(r);
            }
          }
        }
      }
      results.push({
        sheetName,
        matrix: rows.map((row) =>
          Array.isArray(row)
            ? row.map((cell) =>
                typeof cell === 'string' ? convertBijoyToUnicode(cell, false) : cell
              )
            : []
        ),
        sumFormulaRows,
      });
    }
  }
  return results;
}

async function readAllGridsWithExcelJS(
  buffer: ArrayBuffer,
  sheetJsGrids: NamedExtractedGrid[]
): Promise<NamedExtractedGrid[] | null> {
  try {
    const mod = ExcelJS as unknown as {
      Workbook?: typeof ExcelJS.Workbook;
      default?: { Workbook?: typeof ExcelJS.Workbook };
    };
    const WorkbookCtor = mod.Workbook ?? mod.default?.Workbook ?? ExcelJS.Workbook;
    const wb = new WorkbookCtor();
    await wb.xlsx.load(buffer);

    if (!wb.worksheets || wb.worksheets.length === 0) return null;

    const sheetJsByName = new Map<string, NamedExtractedGrid>();
    sheetJsGrids.forEach((g) => sheetJsByName.set(g.sheetName, g));

    const results: NamedExtractedGrid[] = [];
    wb.worksheets.forEach((ws, idx) => {
      if (!ws || ws.rowCount === 0) return;
      const matchingSheetJs = sheetJsByName.get(ws.name) || sheetJsGrids[idx];
      const matrix: unknown[][] = [];
      const sumFormulaRows = new Set<number>(matchingSheetJs?.sumFormulaRows);
      const maxRow = ws.rowCount;
      for (let r = 1; r <= maxRow; r++) {
        const row = ws.getRow(r);
        const sheetJsRow = matchingSheetJs?.matrix[r - 1] || [];
        const colLimit = Math.max(row.cellCount || 0, sheetJsRow.length, 12);
        const rowArr: unknown[] = [];
        for (let c = 1; c <= colLimit; c++) {
          const cell = row.getCell(c);
          const { value, isRangeSum } = extractExcelJsCellValue(cell, sheetJsRow[c - 1]);
          if (isRangeSum && c <= 8) {
            sumFormulaRows.add(r - 1);
          }
          rowArr.push(value);
        }
        matrix.push(rowArr);
      }
      if (matrix.length > 0) {
        results.push({ sheetName: ws.name || `Sheet${idx + 1}`, matrix, sumFormulaRows });
      }
    });
    return results.length > 0 ? results : null;
  } catch {
    return null;
  }
}

interface ColumnMap {
  date: number;
  incDesc: number;
  incCash: number;
  incBank: number;
  expDesc: number;
  expAmt: number;
}

const DEFAULT_COLUMNS: ColumnMap = {
  date: 0,
  incDesc: 1,
  incCash: 2,
  incBank: 3,
  expDesc: 4,
  expAmt: 5,
};

function detectColumnMap(matrix: unknown[][]): ColumnMap {
  const colMap: ColumnMap = { ...DEFAULT_COLUMNS };
  const limit = Math.min(matrix.length, 25);

  for (let r = 0; r < limit; r++) {
    const row = Array.isArray(matrix[r]) ? matrix[r] : [];
    const texts = row.map((c) => cleanCellText(c).toLowerCase());

    const hasLedgerHeader = texts.some(
      (t) =>
        t.includes('আয়ের মাধ্যম') ||
        t.includes('আয়ের মাধ্যম') ||
        t.includes('ব্যয়ের মাধ্যম') ||
        t.includes('ব্যয়ের মাধ্যম') ||
        t.includes('income source') ||
        t.includes('expense source') ||
        t === 'আয়' ||
        t === 'আয়' ||
        t === 'income' ||
        t === 'বিবরণ' ||
        t === 'particulars' ||
        t === 'details'
    );

    if (!hasLedgerHeader) continue;

    let dateIdx = -1;
    let incDescIdx = -1;
    let incCashIdx = -1;
    let incBankIdx = -1;
    let expDescIdx = -1;
    let expAmtIdx = -1;

    const maxCols = Math.min(texts.length, 16);
    const nextRow = r + 1 < matrix.length && Array.isArray(matrix[r + 1]) ? matrix[r + 1] : [];
    const nextTexts = nextRow.map((c) => cleanCellText(c).toLowerCase());
    const combinedTexts = Array.from(
      { length: Math.max(maxCols, Math.min(nextTexts.length, 16)) },
      (_, c) => `${texts[c] || ''} ${nextTexts[c] || ''}`.trim()
    );

    for (let c = 0; c < combinedTexts.length; c++) {
      const t = combinedTexts[c];
      if (!t) continue;
      if (dateIdx === -1 && (t === 'তারিখ' || t === 'date' || t.includes('তারিখ'))) {
        dateIdx = c;
      }
      if (
        incDescIdx === -1 &&
        (t.includes('আয়ের মাধ্যম') ||
          t.includes('আয়ের মাধ্যম') ||
          t.includes('ভাউচার') ||
          t.includes('income source') ||
          t.includes('income desc'))
      ) {
        incDescIdx = c;
      }
      if (
        expDescIdx === -1 &&
        (t.includes('ব্যয়ের মাধ্যম') ||
          t.includes('ব্যয়ের মাধ্যম') ||
          t.includes('expense source') ||
          t.includes('expense desc'))
      ) {
        expDescIdx = c;
      }
    }

    const expBoundary = expDescIdx !== -1 ? expDescIdx : 4;
    for (let c = 0; c < combinedTexts.length; c++) {
      const t = combinedTexts[c];
      if (!t) continue;
      if (incCashIdx === -1 && c < expBoundary && (t.includes('নগদ') || t.includes('cash'))) {
        incCashIdx = c;
      } else if (
        incBankIdx === -1 &&
        c < expBoundary &&
        (t.includes('ব্যাংক') || t.includes('বিকাশ') || t.includes('bank') || t.includes('bkash'))
      ) {
        incBankIdx = c;
      } else if (
        expAmtIdx === -1 &&
        c > expBoundary &&
        (t.includes('ব্যয়ের টাকা') ||
          t.includes('ব্যয়ের টাকা') ||
          t.includes('টাকা') ||
          t.includes('expense') ||
          t.includes('amount'))
      ) {
        expAmtIdx = c;
      }
    }

    if (dateIdx !== -1) colMap.date = dateIdx;
    if (incDescIdx !== -1) colMap.incDesc = incDescIdx;
    if (incCashIdx !== -1) colMap.incCash = incCashIdx;
    if (incBankIdx !== -1) colMap.incBank = incBankIdx;
    if (expDescIdx !== -1) colMap.expDesc = expDescIdx;
    if (expAmtIdx !== -1) colMap.expAmt = expAmtIdx;
    break;
  }

  return colMap;
}

export function isOpeningText(text: string): boolean {
  const lower = text.normalize('NFC').toLowerCase().trim();
  if (!lower) return false;
  return (
    lower.includes('পূর্বের ব্যালেন্স') ||
    lower.includes('পূর্বের ব্যালেত্র') ||
    lower.includes('পূর্বের ব্যালেঞ্চ') ||
    lower.includes('পূর্বের জের') ||
    /পূর্বের\s*ব্যালে/.test(lower) ||
    /c~‡e©i\s*e¨v‡j/i.test(text) ||
    lower.includes('opening balance') ||
    lower.includes('previous balance')
  );
}

export function isLedgerBannerOrHeaderRow(cells: string[]): boolean {
  const normCells = cells.map((c) => c.normalize('NFC').toLowerCase().trim());
  const joined = normCells.slice(0, 7).join(' ');
  if (!joined) return false;

  if (
    joined.includes('আইডিয়াল টেকনিক্যাল') ||
    joined.includes('আইডিয়াল টেকনিক্যাল') ||
    joined.includes('দৈনিক আয় ব্যয়ের হিসাব') ||
    joined.includes('দৈনিক আয় ব্যয়ের হিসাব') ||
    joined.includes('ideal technical')
  ) {
    return true;
  }

  const c0 = normCells[0] || '';
  const c1 = normCells[1] || '';
  const c4 = normCells[4] || '';

  if (
    c0 === 'তারিখ' ||
    c0 === 'date' ||
    c1.includes('আয়ের মাধ্যম') ||
    c1.includes('আয়ের মাধ্যম') ||
    c4.includes('ব্যয়ের মাধ্যম') ||
    c4.includes('ব্যয়ের মাধ্যম') ||
    ((c1 === 'আয়' || c1 === 'আয়') && (!c4 || c4 === 'ব্যয়' || c4 === 'ব্যয়')) ||
    (c1 === 'income' && (!c4 || c4 === 'expense'))
  ) {
    return true;
  }

  return false;
}

export function isLedgerSummaryOrFooterRow(cells: string[]): boolean {
  const leftTexts = cells.slice(0, 7).map((c) => c.normalize('NFC').toLowerCase().trim());
  const joined = leftTexts.join(' ');
  if (!joined) return false;

  if (
    /ব্যাংক[ে]?\s*(?:\/\s*বিকাশে?)?\s*জমা\s*আছে/.test(joined) ||
    /বিকাশে?\s*জমা\s*আছে/.test(joined) ||
    /ক্যাশে?\s*জমা\s*আছে/.test(joined) ||
    /হাতে\s*নগদ\s*(?:আছে)?\s*=/.test(joined) ||
    /সর্বমোট/.test(joined) ||
    /গ্র্যান্ড\s*টোটাল/.test(joined) ||
    /grand\s*total/.test(joined) ||
    /closing\s*balance/.test(joined) ||
    /total\s*balance/.test(joined) ||
    /নগদ\s*ব্যালেন্স\s*=/.test(joined) ||
    /নগদ\s*\+\s*ব্যাংক\s*=/.test(joined)
  ) {
    return true;
  }

  const descTexts = [cells[1] || '', cells[4] || ''].map((s) =>
    s.normalize('NFC').toLowerCase().trim()
  );
  if (
    descTexts.some((t) =>
      /^(?:মোট|সর্বমোট|total|sub\s*total|মোট\s*আয়|মোট\s*ব্যয়|মোট\s*আয়|মোট\s*ব্যয়)\s*[=:]?\s*$/.test(
        t
      )
    )
  ) {
    return true;
  }

  return false;
}

function parseSingleSheetGrid(
  grid: NamedExtractedGrid,
  filenameDate: { dotDate: string; dateKey: string } | null
): {
  fileDateDot: string;
  fileDateKey: string;
  opening: ParsedExcelOpening | null;
  txRows: ParsedExcelTxRow[];
  skippedFooterCount: number;
} {
  const { matrix, sumFormulaRows, sheetName } = grid;
  const colMap = detectColumnMap(matrix);
  const sheetDate = extractDateFromFilename(sheetName);

  let bannerDate: { dotDate: string; dateKey: string } | null = null;
  for (let r = 0; r < Math.min(matrix.length, 5); r++) {
    const row = Array.isArray(matrix[r]) ? matrix[r] : [];
    for (let c = 0; c < Math.min(row.length, 8); c++) {
      const text = cleanCellText(row[c]);
      if (text && (text.includes('হিসাব') || text.includes('/') || text.includes('.') || text.includes('-'))) {
        const parsed = parseExcelCellDate(text);
        if (parsed) {
          bannerDate = parsed;
          break;
        }
      }
    }
    if (bannerDate) break;
  }

  const fallbackDateDot = bannerDate?.dotDate || sheetDate?.dotDate || filenameDate?.dotDate || '';
  const fallbackDateKey = bannerDate?.dateKey || sheetDate?.dateKey || filenameDate?.dateKey || '';

  let opening: ParsedExcelOpening | null = null;
  let openingRawDateKey = '';
  const txRows: ParsedExcelTxRow[] = [];
  let skippedFooterCount = 0;
  let sawFooterSummary = false;
  let lastValidDate: { dotDate: string; dateKey: string } | null = null;
  let firstTxDate: { dotDate: string; dateKey: string } | null = null;

  for (let r = 0; r < matrix.length; r++) {
    const rawRow = Array.isArray(matrix[r]) ? matrix[r] : [];
    if (rawRow.length === 0) continue;

    const textCells = Array.from({ length: Math.max(rawRow.length, 11) }, (_, idx) =>
      cleanCellText(rawRow[idx])
    );

    if (isLedgerBannerOrHeaderRow(textCells)) continue;

    const rawIncDesc = textCells[colMap.incDesc] || '';
    const rawExpDesc = textCells[colMap.expDesc] || '';
    const rawDateCell = rawRow[colMap.date];

    if (isOpeningText(rawIncDesc) || isOpeningText(rawExpDesc)) {
      if (!opening && txRows.length === 0) {
        const cashVal = parseExcelNum(rawRow[colMap.incCash]) || parseExcelNum(rawRow[6]) || 0;
        const bankVal = parseExcelNum(rawRow[colMap.incBank]) || parseExcelNum(rawRow[8]) || 0;
        const openDateParsed = parseExcelCellDate(rawDateCell);

        const targetDate =
          fallbackDateDot || (openDateParsed ? getNextDotDateSimple(openDateParsed.dotDate) : '');
        const prevDate =
          openDateParsed?.dotDate || (targetDate ? getPrevDotDateSimple(targetDate) : '');

        openingRawDateKey = openDateParsed?.dateKey || '';
        opening = {
          prevDate,
          targetDate,
          cash: cashVal,
          bank: bankVal,
        };
      } else {
        skippedFooterCount += 1;
      }
      continue;
    }

    if (isLedgerSummaryOrFooterRow(textCells)) {
      sawFooterSummary = true;
      skippedFooterCount += 1;
      continue;
    }

    let incCashNum = parseExcelNum(rawRow[colMap.incCash]);
    let incBankNum = parseExcelNum(rawRow[colMap.incBank]);
    let expAmtNum = parseExcelNum(rawRow[colMap.expAmt]);

    // Fallback to mirror columns (G=6 Cash, H=7 Exp, I=8 Bank) if description exists and main col is 0
    if (rawIncDesc && incCashNum === 0 && incBankNum === 0) {
      const mirrorCash = parseExcelNum(rawRow[6]);
      const mirrorBank = parseExcelNum(rawRow[8]);
      if (mirrorCash !== 0) incCashNum = mirrorCash;
      if (mirrorBank !== 0) incBankNum = mirrorBank;
    }
    if (rawExpDesc && expAmtNum === 0) {
      const mirrorExp = parseExcelNum(rawRow[7]);
      if (mirrorExp !== 0) expAmtNum = mirrorExp;
    }

    // If paid via Bank/Bkash and amount starts with (-) in expense column, deduct from Bank balance
    if (
      expAmtNum < 0 &&
      (/(?:\[?(?:bank|bkash)\]?|ব্যাংক|বিকাশ)/i.test(rawExpDesc) ||
        /(?:\[?(?:bank|bkash)\]?|ব্যাংক|বিকাশ)/i.test(rawIncDesc))
    ) {
      incBankNum += expAmtNum;
      expAmtNum = 0;
    }

    const hasContent =
      Boolean(rawIncDesc) ||
      Boolean(rawExpDesc) ||
      incCashNum !== 0 ||
      incBankNum !== 0 ||
      expAmtNum !== 0;
    if (!hasContent) continue;

    // Skip numeric-only bottom total row ONLY if it uses a SUM formula or appears at/after footer summary
    const hasNoDesc = !rawIncDesc && !rawExpDesc;
    const isBottomTotalRow =
      hasNoDesc &&
      txRows.length > 0 &&
      (sumFormulaRows.has(r) || sawFooterSummary || r >= matrix.length - 2);
    if (isBottomTotalRow) {
      skippedFooterCount += 1;
      continue;
    }

    const parsedDate = parseExcelCellDate(rawDateCell);
    if (parsedDate) {
      lastValidDate = parsedDate;
      if (!firstTxDate) firstTxDate = parsedDate;
    }

    const resolvedDate =
      parsedDate ||
      (fallbackDateDot && fallbackDateKey
        ? { dotDate: fallbackDateDot, dateKey: fallbackDateKey }
        : lastValidDate);

    const finalDotDate = resolvedDate?.dotDate || '';
    const finalDateKey = resolvedDate?.dateKey || '';

    txRows.push({
      date: finalDotDate.slice(0, 20),
      dateKey: finalDateKey,
      inDesc: rawIncDesc.slice(0, 195),
      inCash: incCashNum !== 0 ? String(incCashNum).slice(0, 40) : '',
      inBank: incBankNum !== 0 ? String(incBankNum).slice(0, 40) : '',
      outDesc: rawExpDesc.slice(0, 195),
      outCash: expAmtNum !== 0 ? String(expAmtNum).slice(0, 40) : '',
    });
  }

  const resolvedFileDateDot =
    bannerDate?.dotDate ||
    sheetDate?.dotDate ||
    filenameDate?.dotDate ||
    firstTxDate?.dotDate ||
    opening?.targetDate ||
    '';
  const resolvedFileDateKey =
    bannerDate?.dateKey ||
    sheetDate?.dateKey ||
    filenameDate?.dateKey ||
    firstTxDate?.dateKey ||
    (opening?.targetDate
      ? parseExcelCellDate(opening.targetDate)?.dateKey || ''
      : '');

  if (opening && !fallbackDateDot && firstTxDate) {
    if (!openingRawDateKey || openingRawDateKey <= firstTxDate.dateKey) {
      opening.targetDate = firstTxDate.dotDate;
      if (!opening.prevDate || opening.prevDate === opening.targetDate) {
        opening.prevDate = getPrevDotDateSimple(opening.targetDate);
      }
    }
  }

  if (opening && !opening.targetDate && resolvedFileDateDot) {
    opening.targetDate = resolvedFileDateDot;
    if (!opening.prevDate) opening.prevDate = getPrevDotDateSimple(resolvedFileDateDot);
  }

  if (resolvedFileDateDot) {
    txRows.forEach((row) => {
      if (!row.date) {
        row.date = resolvedFileDateDot;
        row.dateKey = resolvedFileDateKey;
      }
    });
  }

  return {
    fileDateDot: resolvedFileDateDot,
    fileDateKey: resolvedFileDateKey,
    opening,
    txRows,
    skippedFooterCount,
  };
}

export async function parseGeneralAccountsExcelFile(
  file: File
): Promise<ParsedExcelFileResult> {
  const buffer = await file.arrayBuffer();
  const sheetJsGrids = readAllSheetJSGrids(buffer);
  const isXlsxLike = /\.xls[xm]?$/i.test(file.name) && !/\.xls$/i.test(file.name);

  let grids: NamedExtractedGrid[] = sheetJsGrids;
  if (isXlsxLike) {
    const excelJsGrids = await readAllGridsWithExcelJS(buffer, sheetJsGrids);
    if (excelJsGrids && excelJsGrids.length > 0) {
      grids = excelJsGrids;
    }
  }

  if (grids.length === 0) {
    return {
      fileName: file.name,
      fileDateDot: '',
      fileDateKey: '',
      opening: null,
      txRows: [],
      skippedFooterCount: 0,
      warning: 'ফাইলে কোনো শীট বা ডেটা পাওয়া যায়নি।',
    };
  }

  const filenameDate = extractDateFromFilename(file.name);
  const sheetResults = grids
    .map((g) => parseSingleSheetGrid(g, filenameDate))
    .filter((res) => res.txRows.length > 0 || res.opening !== null);

  if (sheetResults.length === 0) {
    return {
      fileName: file.name,
      fileDateDot: filenameDate?.dotDate || '',
      fileDateKey: filenameDate?.dateKey || '',
      opening: null,
      txRows: [],
      skippedFooterCount: 0,
      warning: 'ফাইলের কোনো শীটে লেনদেন বা পূর্বের ব্যালেন্স পাওয়া যায়নি।',
    };
  }

  // Sort multi-sheet results chronologically so opening comes from the earliest sheet and txRows stay ordered
  sheetResults.sort((a, b) => {
    const ka = a.fileDateKey || '9999-99-99';
    const kb = b.fileDateKey || '9999-99-99';
    return ka.localeCompare(kb);
  });

  const combinedTxRows: ParsedExcelTxRow[] = [];
  let combinedOpening: ParsedExcelOpening | null = null;
  let totalSkippedFooter = 0;
  let latestDateDot = '';
  let latestDateKey = '';

  let earliestTxDateKey = '';

  for (const res of sheetResults) {
    if (!combinedOpening && res.opening) {
      const openTargetKey = res.opening.targetDate
        ? parseExcelCellDate(res.opening.targetDate)?.dateKey || ''
        : '';
      if (!earliestTxDateKey || !openTargetKey || earliestTxDateKey >= openTargetKey) {
        combinedOpening = res.opening;
      }
    }
    res.txRows.forEach((tx) => {
      if (tx.dateKey && (!earliestTxDateKey || tx.dateKey < earliestTxDateKey)) {
        earliestTxDateKey = tx.dateKey;
      }
    });
    combinedTxRows.push(...res.txRows);
    totalSkippedFooter += res.skippedFooterCount;
    if (res.fileDateKey && (!latestDateKey || res.fileDateKey >= latestDateKey)) {
      latestDateKey = res.fileDateKey;
      latestDateDot = res.fileDateDot;
    }
  }

  const openingTargetDate = combinedOpening?.targetDate || '';
  const resolvedFileDateDot = latestDateDot || filenameDate?.dotDate || openingTargetDate || '';
  const resolvedFileDateKey =
    latestDateKey ||
    filenameDate?.dateKey ||
    (openingTargetDate ? parseExcelCellDate(openingTargetDate)?.dateKey || '' : '');

  return {
    fileName: file.name,
    fileDateDot: resolvedFileDateDot,
    fileDateKey: resolvedFileDateKey,
    opening: combinedOpening,
    txRows: combinedTxRows,
    skippedFooterCount: totalSkippedFooter,
  };
}
