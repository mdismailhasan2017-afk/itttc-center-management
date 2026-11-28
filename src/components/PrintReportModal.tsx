import { useEffect, useState } from 'react';
import { ExternalLink, FileDown, FileText, Printer, X } from 'lucide-react';
import {
  downloadReportHtml,
  downloadReportPdf,
  openReportPrintTab,
  type PrintableReportSpec,
} from '../lib/print';
import type { CenterSettings, Lang } from '../types';

interface PrintReportModalProps {
  report: PrintableReportSpec | null;
  settings: CenterSettings;
  lang: Lang;
  onClose: () => void;
  onBrowserPrint?: (spec: PrintableReportSpec) => void;
}

export function ReportPrintContent({
  report,
  settings,
}: {
  report: PrintableReportSpec;
  settings: CenterSettings;
}) {
  const isRegister = report.variant === 'register';
  const centerTitle = (settings.name || 'IDEAL TECHNICAL TRAINING & TESTING CENTER').toUpperCase();

  if (isRegister) {
    return (
      <div className="bg-white text-slate-900 p-4 sm:p-6 print:p-0">
        <div className="text-center mb-3">
          <div className="text-base sm:text-lg font-extrabold text-teal-700 tracking-wide uppercase">
            {centerTitle}
          </div>
          <div className="text-xs sm:text-sm font-bold text-slate-900 mt-0.5">
            {report.title}
          </div>
        </div>

        <table className="w-full border-collapse border border-slate-700 text-[11px] text-left">
          <thead className="bg-slate-50 table-header-group">
            <tr>
              {report.columns.map((col, idx) => (
                <th
                  key={idx}
                  className="border border-slate-700 px-2 py-1.5 font-bold text-slate-900 whitespace-nowrap"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row, rIdx) => (
              <tr key={rIdx} className="break-inside-avoid">
                {row.map((cell, cIdx) => (
                  <td
                    key={cIdx}
                    className="border border-slate-700 px-2 py-1.5 text-slate-900 tabular-nums"
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        {report.footerSummary && (
          <div className="mt-3 text-xs font-extrabold text-slate-900">
            {report.footerSummary}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white text-slate-900 p-5 print:p-0 space-y-4">
      <div>
        <div className="text-xs text-slate-500">
          {settings.name} {settings.address ? `· ${settings.address}` : ''}
        </div>
        <h2 className="text-lg font-bold text-slate-900">{report.title}</h2>
        {report.subtitle && <div className="text-xs text-slate-500">{report.subtitle}</div>}
      </div>
      {report.summary && report.summary.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {report.summary.map((s, idx) => (
            <div key={idx} className="border border-slate-300 rounded-lg p-2.5 bg-slate-50">
              <div className="text-[11px] font-bold text-slate-500">{s.label}</div>
              <div className="text-sm font-bold text-slate-900 mt-0.5 tabular-nums">{s.value}</div>
            </div>
          ))}
        </div>
      )}
      <table className="w-full border-collapse text-xs text-left">
        <thead className="bg-slate-900 text-white table-header-group">
          <tr>
            {report.columns.map((col, idx) => (
              <th key={idx} className="px-2.5 py-2 font-semibold whitespace-nowrap">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {report.rows.map((row, rIdx) => (
            <tr key={rIdx} className={rIdx % 2 === 1 ? 'bg-slate-50' : 'bg-white'}>
              {row.map((cell, cIdx) => (
                <td key={cIdx} className="border-b border-slate-200 px-2.5 py-1.5 tabular-nums">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {report.footerSummary && (
        <div className="text-xs font-bold text-slate-900">{report.footerSummary}</div>
      )}
    </div>
  );
}

export function PrintReportModal({
  report,
  settings,
  lang,
  onClose,
  onBrowserPrint,
}: PrintReportModalProps) {
  const [printTabUrl, setPrintTabUrl] = useState<string | null>(null);
  const [showAllPreviewRows, setShowAllPreviewRows] = useState(false);

  useEffect(() => {
    setShowAllPreviewRows(false);
    return () => {
      if (printTabUrl) URL.revokeObjectURL(printTabUrl);
    };
  }, [printTabUrl, report]);

  if (!report) return null;
  const bn = lang === 'bn';
  const isRegister = report.variant === 'register';
  const previewCap = showAllPreviewRows ? report.rows.length : 1000;
  const visibleRows = report.rows.slice(0, previewCap);
  const isCapped = report.rows.length > previewCap;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[1px] flex items-center justify-center p-3 sm:p-5 print:hidden"
      role="dialog"
      aria-modal="true"
      aria-label={report.title}
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-5xl w-full max-h-[92vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h3 className="font-display font-bold text-base text-slate-900 dark:text-white truncate">
              {report.title}
            </h3>
            {report.subtitle && (
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {report.subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-2.5 bg-teal-50/70 dark:bg-teal-950/30 border-b border-teal-200 dark:border-teal-900/70 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-teal-900 dark:text-teal-200 font-medium">
            {bn
              ? 'সরাসরি প্রিন্টের জন্য "নতুন ট্যাবে প্রিন্ট" অথবা "A4 PDF ডাউনলোড" ব্যবহার করুন (সব সারি A4 পেজে সুন্দরভাবে প্রিন্ট হবে)।'
              : 'Use "Open Print Tab" or "Download A4 PDF" for crisp multi-page A4 printing without preview frame clipping.'}
          </span>
          <button
            type="button"
            onClick={() => {
              if (printTabUrl) URL.revokeObjectURL(printTabUrl);
              const nextUrl = openReportPrintTab(report, settings);
              setPrintTabUrl(nextUrl);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white font-semibold cursor-pointer whitespace-nowrap"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>{bn ? 'নতুন ট্যাবে প্রিন্ট (A4)' : 'Open Print Tab (A4)'}</span>
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4 sm:p-6 bg-slate-100 dark:bg-slate-950 space-y-4">
          {isRegister ? (
            <div className="max-w-4xl mx-auto bg-white border border-slate-300 shadow-sm rounded-lg overflow-hidden">
              <ReportPrintContent
                report={{ ...report, rows: visibleRows }}
                settings={settings}
              />
              {isCapped && (
                <div className="px-5 py-2.5 text-[11px] text-slate-600 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {bn
                      ? `প্রিভিউতে প্রথম ${previewCap}টি সারি দেখানো হচ্ছে (মোট ${report.rows.length}টি সারি)।`
                      : `Showing first ${previewCap} of ${report.rows.length} rows in preview.`}
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowAllPreviewRows(true)}
                    className="px-2.5 py-1 rounded-md bg-teal-600 text-white font-semibold cursor-pointer"
                  >
                    {bn ? `সব ${report.rows.length}টি সারি দেখুন` : `Show All ${report.rows.length} Rows`}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              {report.summary && report.summary.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {report.summary.map((s, idx) => (
                    <div
                      key={idx}
                      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3"
                    >
                      <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                        {s.label}
                      </div>
                      <div className="font-mono-num font-bold text-sm text-slate-900 dark:text-white mt-0.5">
                        {s.value}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200">
                      <tr>
                        {report.columns.map((col, idx) => (
                          <th key={idx} className="px-3 py-2.5 font-semibold whitespace-nowrap">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {report.rows.length === 0 ? (
                        <tr>
                          <td
                            colSpan={Math.max(1, report.columns.length)}
                            className="px-4 py-8 text-center text-slate-500"
                          >
                            {bn ? 'কোনো রেকর্ড পাওয়া যায়নি।' : 'No records found.'}
                          </td>
                        </tr>
                      ) : (
                        visibleRows.map((row, rIdx) => (
                          <tr key={rIdx} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                            {row.map((cell, cIdx) => (
                              <td
                                key={cIdx}
                                className="px-3 py-2 text-slate-800 dark:text-slate-200 tabular-nums whitespace-nowrap"
                              >
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                {isCapped && (
                  <div className="px-4 py-2 text-[11px] text-slate-600 dark:text-slate-300 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {bn
                        ? `প্রিভিউতে প্রথম ${previewCap}টি সারি দেখানো হচ্ছে (মোট ${report.rows.length}টি সারি)।`
                        : `Showing first ${previewCap} of ${report.rows.length} rows in preview.`}
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowAllPreviewRows(true)}
                      className="px-2.5 py-1 rounded-md bg-teal-600 text-white font-semibold cursor-pointer"
                    >
                      {bn ? `সব ${report.rows.length}টি সারি দেখুন` : `Show All ${report.rows.length} Rows`}
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-end gap-2 shrink-0 bg-white dark:bg-slate-900">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            {bn ? 'বন্ধ করুন' : 'Close'}
          </button>
          <button
            type="button"
            onClick={() => downloadReportHtml(report, settings)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>{bn ? 'প্রিন্টেবল HTML' : 'Printable HTML'}</span>
          </button>
          <button
            type="button"
            onClick={() => downloadReportPdf(report, settings)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold cursor-pointer"
          >
            <FileDown className="w-3.5 h-3.5" />
            <span>{bn ? 'A4 PDF ডাউনলোড' : 'Download A4 PDF'}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (onBrowserPrint) {
                onBrowserPrint(report);
              } else {
                const nextUrl = openReportPrintTab(report, settings);
                setPrintTabUrl(nextUrl);
              }
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>{bn ? 'ব্রাউজার প্রিন্ট' : 'Browser Print'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
