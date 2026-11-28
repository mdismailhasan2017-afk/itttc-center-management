import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ExternalLink,
  FileDown,
  FileText,
  Printer,
  X,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { loadUiSettings, type UiAppearanceSettings } from '../lib/appearance';
import { formatTaka } from '../lib/format';
import {
  createTokenBlobUrl,
  downloadThermalSlipHtml,
  downloadThermalSlipPdf,
  openTokenPrintTab,
} from '../lib/print';
import type { CenterSettings, Lang, SlipData } from '../types';

interface ThermalSlipContentProps {
  slip: SlipData;
  settings: CenterSettings;
  appearance?: UiAppearanceSettings;
}

function formatPrintedDateTime(): string {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${min}:${ss}`;
}

export function MiniRoundSeal({
  slip,
  instituteName,
  logoDataUrl,
  compact = false,
}: {
  slip: SlipData;
  instituteName?: string;
  logoDataUrl?: string;
  compact?: boolean;
}) {
  const sealCodeText = slip.code ? `স্টুডেন্ট কোড: ${slip.code}` : slip.name;
  const titleText = (instituteName || 'IDEAL TECHNICAL TRAINING & TESTING CENTER').toUpperCase();
  const isDefaultName =
    titleText === 'IDEAL TECHNICAL TRAINING & TESTING CENTER' ||
    titleText.startsWith('IDEAL TECHNICAL');

  const sizePx = compact ? 96 : 124;

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        margin: '2px 0',
      }}
    >
      <div
        style={{
          width: `${sizePx}px`,
          height: `${sizePx}px`,
          borderRadius: '50%',
          background: '#ffffff',
          border: `${compact ? 2.4 : 3}px solid #000000`,
          boxShadow: 'inset 0 0 0 2px #ffffff, inset 0 0 0 3.6px #000000',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#000000',
          padding: compact ? '4px' : '6px',
          position: 'relative',
          textAlign: 'center',
          userSelect: 'none',
        }}
      >
        {/* Inner dashed ring */}
        <div
          style={{
            position: 'absolute',
            inset: '2.5px',
            borderRadius: '50%',
            border: '0.9px dashed #000000',
            pointerEvents: 'none',
          }}
        />

        {/* Custom Uploaded Round Logo OR Default Cap emblem circle */}
        {logoDataUrl ? (
          <img
            src={logoDataUrl}
            alt="Center Logo"
            style={{
              width: compact ? '21px' : '28px',
              height: compact ? '21px' : '28px',
              borderRadius: '50%',
              objectFit: 'cover',
              border: '1.5px solid #000000',
              background: '#ffffff',
              marginBottom: compact ? '1.5px' : '2px',
            }}
          />
        ) : (
          <div
            style={{
              width: compact ? '20px' : '26px',
              height: compact ? '20px' : '26px',
              borderRadius: '50%',
              background: '#ffffff',
              border: '1.6px solid #000000',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: compact ? '1.5px' : '2.5px',
            }}
          >
            <svg
              style={{ width: compact ? '12px' : '15px', height: compact ? '12px' : '15px', fill: '#000000' }}
              viewBox="0 0 24 24"
            >
              <path d="M12 3L1 9l11 6 9-4.91V17h2V9L12 3zM5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82z" />
            </svg>
          </div>
        )}

        {/* Institute title */}
        <div
          style={{
            fontFamily: '"Montserrat", sans-serif',
            fontSize: compact ? '4.5px' : '5.5px',
            fontWeight: 800,
            letterSpacing: '0.1px',
            lineHeight: 1.12,
            color: '#000000',
            textTransform: 'uppercase',
            maxWidth: compact ? '76px' : '96px',
          }}
        >
          {isDefaultName ? (
            <>
              IDEAL TECHNICAL
              <br />
              TRAINING &amp; TESTING CENTER
            </>
          ) : (
            titleText
          )}
        </div>

        {/* Shield checkmark */}
        <div
          style={{
            width: compact ? '16px' : '21px',
            height: compact ? '17px' : '22px',
            margin: compact ? '1.5px 0' : '2.5px 0',
            border: '1.5px solid #000000',
            borderRadius: '2.5px 2.5px 50% 50% / 2.5px 2.5px 75% 75%',
            background: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: compact ? '10px' : '13px',
            fontWeight: 900,
            color: '#000000',
            lineHeight: 1,
          }}
        >
          ✓
        </div>

        {/* Token ID & Student Code */}
        <div
          style={{
            fontSize: compact ? '4.8px' : '5.8px',
            fontWeight: 700,
            color: '#000000',
            lineHeight: 1.12,
          }}
        >
          টোকেন আইডি: {slip.no}
        </div>
        <div
          style={{
            marginTop: compact ? '1.5px' : '2px',
            fontSize: compact ? '5px' : '6px',
            fontWeight: 700,
            background: '#ffffff',
            border: '1px solid #000000',
            borderRadius: '6px',
            padding: compact ? '0.5px 5px' : '1px 8px',
            color: '#000000',
            lineHeight: 1.12,
            maxWidth: compact ? '82px' : '104px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {sealCodeText}
        </div>
      </div>
    </div>
  );
}

export function ThermalSlipContent({ slip, settings, appearance }: ThermalSlipContentProps) {
  const printedAt = formatPrintedDateTime();
  const hasDueNotice = Boolean(slip.isDueEntry && slip.tokenPaymentNote);
  const effectiveAppearance = appearance || loadUiSettings();

  return (
    <div
      className="token-slip-surface bg-white text-black mx-auto box-border text-center flex flex-col justify-between"
      style={{
        width: '3in',
        minHeight: '3.5in',
        height: hasDueNotice || slip.note || slip.kind === 'out' ? 'auto' : '3.5in',
        background: '#ffffff',
        border: '2.2px solid #000000',
        borderRadius: '10px',
        padding: '7px 9px',
        overflow: hasDueNotice ? 'visible' : 'hidden',
        color: '#000000',
        fontFamily: '"Hind Siliguri", "Montserrat", sans-serif',
      }}
    >
      {/* Top Header + Grid + Info */}
      <div>
        <div
          style={{
            fontFamily: '"Montserrat", sans-serif',
            fontSize: '9.8px',
            fontWeight: 800,
            letterSpacing: '0.15px',
            color: '#000000',
            lineHeight: 1.15,
          }}
        >
          {(settings.name || 'IDEAL TECHNICAL TRAINING & TESTING CENTER').toUpperCase()}
        </div>

        <div
          style={{
            display: 'inline-block',
            background: '#000000',
            color: '#ffffff',
            fontFamily: '"Montserrat", sans-serif',
            fontSize: '9px',
            fontWeight: 700,
            padding: '2.5px 14px',
            borderRadius: '5px',
            margin: '3px auto 4px',
            letterSpacing: '0.7px',
          }}
        >
          {slip.kind === 'out' ? 'OUT STUDENT TOKEN' : 'DAILY JOB TOKEN'}
        </div>

        <hr style={{ border: 'none', borderTop: '1.8px solid #000000', marginBottom: '4px' }} />

        {/* Job Number & Category Box */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            border: '1.8px solid #000000',
            borderRadius: '6px',
            overflow: 'hidden',
            marginBottom: '4px',
          }}
        >
          <div style={{ padding: '4px 4px', borderRight: '1.8px solid #000000' }}>
            <div
              style={{
                fontFamily: '"Montserrat", sans-serif',
                fontSize: '7.4px',
                fontWeight: 700,
                color: '#000000',
                marginBottom: '1px',
                textTransform: 'uppercase',
              }}
            >
              JOB NUMBER
            </div>
            <div
              style={{
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: '11.5px',
                fontWeight: 700,
                color: '#000000',
                lineHeight: 1.12,
              }}
            >
              {slip.no}
            </div>
          </div>
          <div style={{ padding: '4px 4px' }}>
            <div
              style={{
                fontFamily: '"Montserrat", sans-serif',
                fontSize: '7.4px',
                fontWeight: 700,
                color: '#000000',
                marginBottom: '1px',
                textTransform: 'uppercase',
              }}
            >
              JOB CATEGORY
            </div>
            <div
              style={{
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: '11.5px',
                fontWeight: 700,
                color: '#000000',
                lineHeight: 1.12,
              }}
            >
              {slip.cat}
            </div>
          </div>
        </div>

        {/* Student Info Rows */}
        <div style={{ textAlign: 'left' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '2.5px 0',
              borderBottom: '1px dotted #000000',
              fontSize: '10.2px',
              lineHeight: 1.18,
              color: '#000000',
            }}
          >
            <span style={{ fontWeight: 600, color: '#000000' }}>Student Name:</span>
            <span
              style={{
                fontFamily: '"Montserrat", "Hind Siliguri", sans-serif',
                fontWeight: 700,
                color: '#000000',
                maxWidth: '1.65in',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {slip.name}
            </span>
          </div>

          {slip.code && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '2.5px 0',
                borderBottom: '1px dotted #000000',
                fontSize: '10.2px',
                lineHeight: 1.18,
                color: '#000000',
              }}
            >
              <span style={{ fontWeight: 600, color: '#000000' }}>Student Code:</span>
              <span
                style={{
                  fontFamily: '"JetBrains Mono", "Montserrat", sans-serif',
                  fontWeight: 700,
                  color: '#000000',
                  maxWidth: '1.65in',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {slip.code}
              </span>
            </div>
          )}

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '2.5px 0',
              borderBottom:
                slip.isDueEntry || slip.kind === 'out' || slip.note
                  ? '1px dotted #000000'
                  : 'none',
              fontSize: '10.2px',
              lineHeight: 1.18,
              color: '#000000',
            }}
          >
            <span style={{ fontWeight: 600, color: '#000000' }}>Testing Date:</span>
            <span
              style={{
                fontFamily: '"JetBrains Mono", "Montserrat", sans-serif',
                fontWeight: 700,
                color: '#000000',
                maxWidth: '1.65in',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {slip.date}
            </span>
          </div>

          {slip.isDueEntry && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '2.5px 0',
                borderBottom: slip.note ? '1px dotted #000000' : 'none',
                fontSize: '10px',
                lineHeight: 1.18,
              }}
            >
              <span style={{ fontWeight: 600, color: '#b31412' }}>Payment / Due:</span>
              <span
                style={{
                  fontFamily: '"JetBrains Mono", sans-serif',
                  fontWeight: 700,
                  color: '#a50e0e',
                }}
              >
                Paid {formatTaka(slip.paid)} · Due {formatTaka(slip.dueAmount || 0)}
              </span>
            </div>
          )}

          {slip.kind === 'out' && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '2.5px 0',
                borderBottom: slip.note ? '1px dotted #000000' : 'none',
                fontSize: '10.2px',
                lineHeight: 1.18,
                color: '#000000',
              }}
            >
              <span style={{ fontWeight: 600, color: '#000000' }}>Paid Amount:</span>
              <span
                style={{
                  fontFamily: '"JetBrains Mono", sans-serif',
                  fontWeight: 700,
                  color: '#000000',
                }}
              >
                {formatTaka(slip.paid)}
              </span>
            </div>
          )}

          {slip.note && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '2.5px 0',
                fontSize: '9.8px',
                lineHeight: 1.18,
                color: '#000000',
              }}
            >
              <span style={{ fontWeight: 600, color: '#000000' }}>Remarks:</span>
              <span
                style={{
                  fontWeight: 700,
                  color: '#000000',
                  maxWidth: '1.65in',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {slip.note}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Centered Round Center Seal */}
      {effectiveAppearance.tokenShowLogo !== false ? (
        <MiniRoundSeal
          slip={slip}
          instituteName={settings.name}
          logoDataUrl={effectiveAppearance.logoDataUrl}
        />
      ) : (
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '16px 8px 4px' }}>
          <span
            style={{
              fontSize: '8.5px',
              color: '#334155',
              borderTop: '1px solid #475569',
              paddingTop: '3px',
              fontWeight: 700,
            }}
          >
            Authorized Signature
          </span>
        </div>
      )}

      {/* Urgent Due Notice Box (only for due entries) */}
      {hasDueNotice && (
        <div
          style={{
            margin: '3px 0 4px',
            padding: '5px 6px',
            border: '1.8px dashed #c5221f',
            background: '#fff6f6',
            color: '#a50e0e',
            fontSize: '9px',
            fontWeight: 700,
            lineHeight: 1.3,
            borderRadius: '4px',
          }}
        >
          {slip.tokenPaymentNote}
        </div>
      )}

      {/* Barcode & Printed Time */}
      <div>
        <hr style={{ border: 'none', borderTop: '1.5px dotted #000000', marginBottom: '4px' }} />
        <div
          style={{
            height: '22px',
            width: '82%',
            margin: '0 auto 2px',
            background:
              'repeating-linear-gradient(90deg, #000000 0px, #000000 1.8px, #ffffff 1.8px, #ffffff 3.5px, #000000 3.5px, #000000 5px, #ffffff 5px, #ffffff 8px, #000000 8px, #000000 11px, #ffffff 11px, #ffffff 13px)',
          }}
        />
        <div
          style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: '8.6px',
            fontWeight: 700,
            color: '#000000',
            lineHeight: 1.15,
          }}
        >
          Printed: {printedAt}
        </div>
      </div>
    </div>
  );
}

interface ThermalSlipModalProps {
  slip: SlipData | null;
  settings: CenterSettings;
  appearance?: UiAppearanceSettings;
  lang: Lang;
  onClose: () => void;
  onPrintToken?: (slip: SlipData) => void;
}

export function ThermalSlipModal({
  slip,
  settings,
  appearance,
  lang,
  onClose,
  onPrintToken,
}: ThermalSlipModalProps) {
  const [printBlocked, setPrintBlocked] = useState(false);
  const effectiveAppearance = appearance || loadUiSettings();

  const tokenTabUrl = useMemo(() => {
    if (!slip) return '';
    return createTokenBlobUrl(slip, settings, effectiveAppearance);
  }, [slip, settings, effectiveAppearance]);

  useEffect(() => {
    if (!tokenTabUrl) return;
    const urlToRevoke = tokenTabUrl;
    return () => {
      setTimeout(() => URL.revokeObjectURL(urlToRevoke), 30000);
    };
  }, [tokenTabUrl]);

  if (!slip) return null;
  const bn = lang === 'bn';

  const handlePrint = () => {
    if (onPrintToken) {
      onPrintToken(slip);
      setPrintBlocked(false);
      return;
    }
    openTokenPrintTab(slip, settings, effectiveAppearance);
    setPrintBlocked(false);
  };

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4 print:hidden"
        role="dialog"
        aria-modal="true"
      >
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-md w-full overflow-hidden shadow-xl">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
            <h3 className="font-display font-bold text-sm text-slate-900 dark:text-white">
              {bn ? 'টপ-সেন্টার A4 টোকেন প্রিভিউ' : 'Top-Center A4 Token Preview'}
            </h3>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="p-1 rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-5 bg-slate-200 dark:bg-slate-950 flex flex-col items-center gap-3 max-h-[68vh] overflow-y-auto">
            <div className="shadow-md rounded-[14px]">
              <ThermalSlipContent slip={slip} settings={settings} appearance={effectiveAppearance} />
            </div>
            {printBlocked && (
              <div className="w-full rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-[11px] text-amber-900 dark:text-amber-200 flex items-start justify-between gap-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                  <span>
                    সরাসরি ফ্রেমে প্রিন্ট সীমিত — <strong>নতুন ট্যাবে প্রিন্ট</strong>,{' '}
                    <strong>A4 PDF</strong> বা <strong>HTML</strong> ব্যবহার করুন।
                  </span>
                </div>
                <a
                  href={tokenTabUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-700 font-semibold whitespace-nowrap shrink-0"
                >
                  <ExternalLink className="w-3 h-3" />
                  <span>নতুন ট্যাব</span>
                </a>
              </div>
            )}
          </div>

          <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              {bn ? 'বন্ধ করুন' : 'Close'}
            </button>
            <button
              type="button"
              onClick={() => downloadThermalSlipHtml(slip, settings, effectiveAppearance)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>HTML</span>
            </button>
            <button
              type="button"
              onClick={() => void downloadThermalSlipPdf(slip, settings, effectiveAppearance)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold cursor-pointer"
            >
              <FileDown className="w-3.5 h-3.5" />
              <span>A4 PDF</span>
            </button>
            <a
              href={tokenTabUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>নতুন ট্যাবে প্রিন্ট</span>
            </a>
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>{bn ? 'A4 প্রিন্ট করুন' : 'Print A4 Token'}</span>
            </button>
          </div>
        </div>
      </div>

      {createPortal(
        <div id="thermal-slip-print">
          <ThermalSlipContent slip={slip} settings={settings} appearance={effectiveAppearance} />
        </div>,
        document.body
      )}
    </>
  );
}
