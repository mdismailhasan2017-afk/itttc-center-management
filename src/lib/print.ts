import { jsPDF } from 'jspdf';
import { loadUiSettings, type UiAppearanceSettings } from './appearance';
import { downloadFile, formatTaka } from './format';
import type { CenterSettings, GeneralAccountRow, SlipData } from '../types';

export interface PrintableReportSpec {
  title: string;
  subtitle?: string;
  filename: string;
  summary?: Array<{ label: string; value: string }>;
  columns: string[];
  rows: Array<Array<string | number>>;
  footerSummary?: string;
  variant?: 'modern' | 'register';
}

export function tryNativePrint(): boolean {
  let beforePrintFired = false;
  const onBeforePrint = () => {
    beforePrintFired = true;
  };
  window.addEventListener('beforeprint', onBeforePrint, { once: true });
  try {
    window.print();
  } catch {
    beforePrintFired = false;
  } finally {
    window.removeEventListener('beforeprint', onBeforePrint);
  }
  return beforePrintFired;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let current = words[0];
  for (let i = 1; i < words.length; i += 1) {
    const test = `${current} ${words[i]}`;
    if (ctx.measureText(test).width <= maxWidth) {
      current = test;
    } else {
      lines.push(current);
      current = words[i];
    }
  }
  lines.push(current);
  return lines;
}

function formatPrintedTimestamp(): string {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${min}:${ss}`;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function loadImageAsync(dataUrl: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!dataUrl) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

export function drawThermalSlipCanvas(
  slip: SlipData,
  settings: CenterSettings,
  appearance?: UiAppearanceSettings,
  logoImg?: HTMLImageElement | null
): HTMLCanvasElement {
  const effectiveAppearance = appearance || loadUiSettings();
  const showRoundSeal = effectiveAppearance.tokenShowLogo !== false;
  // Base 3in x 3.5in at 220 DPI -> 660px x 770px (expands only if due notice is present)
  const width = 660;
  const padX = 20;
  const contentW = width - padX * 2;
  const centerX = width / 2;

  const hasDueNotice = Boolean(slip.isDueEntry && slip.tokenPaymentNote);

  const detailRows: Array<[string, string, boolean?]> = [
    ['Student Name:', slip.name, false],
    ...(slip.code ? ([['Student Code:', slip.code, true]] as Array<[string, string, boolean]>) : []),
    ['Testing Date:', slip.date, true],
    ...(slip.isDueEntry
      ? ([
          [
            'Payment / Due:',
            `Paid ${formatTaka(slip.paid)} · Due ${formatTaka(slip.dueAmount || 0)}`,
            true,
          ],
        ] as Array<[string, string, boolean]>)
      : []),
    ...(slip.kind === 'out'
      ? ([['Paid Amount:', formatTaka(slip.paid), true]] as Array<[string, string, boolean]>)
      : []),
    ...(slip.note ? ([['Remarks:', slip.note, false]] as Array<[string, string, boolean]>) : []),
  ];

  const mCanvas = document.createElement('canvas');
  mCanvas.width = width;
  mCanvas.height = 100;
  const mctx = mCanvas.getContext('2d')!;
  mctx.font = '800 21px "Montserrat", "Archivo", sans-serif';
  const titleLines = wrapTextLines(
    mctx,
    (settings.name || 'IDEAL TECHNICAL TRAINING & TESTING CENTER').toUpperCase(),
    contentW
  ).slice(0, 2);

  mctx.font = '700 18px "Hind Siliguri", sans-serif';
  const dueNoticeLines = hasDueNotice
    ? wrapTextLines(mctx, slip.tokenPaymentNote || '', contentW - 24)
    : [];
  const dueBoxH = hasDueNotice ? Math.max(48, dueNoticeLines.length * 24 + 18) : 0;

  const baseHeight = 770;
  const extraRows = Math.max(0, detailRows.length - 3) * 34;
  const height = baseHeight + extraRows + (hasDueNotice ? dueBoxH + 14 : 0);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // Outer 2.2px border (scaled ~5px at 220dpi)
  drawRoundedRect(ctx, 4, 4, width - 8, height - 8, 22);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 4.5;
  ctx.strokeStyle = '#000000';
  ctx.stroke();

  let y = 30;

  // Institute Name
  ctx.textAlign = 'center';
  ctx.fillStyle = '#000000';
  ctx.font = '800 21px "Montserrat", "Archivo", sans-serif';
  titleLines.forEach((line) => {
    ctx.fillText(line, centerX, y, contentW);
    y += 24;
  });

  // Black Badge: DAILY JOB TOKEN
  y += 2;
  const badgeText = slip.kind === 'out' ? 'OUT STUDENT TOKEN' : 'DAILY JOB TOKEN';
  ctx.font = '700 19px "Montserrat", "Archivo", sans-serif';
  const badgeW = ctx.measureText(badgeText).width + 58;
  const badgeH = 34;
  drawRoundedRect(ctx, (width - badgeW) / 2, y, badgeW, badgeH, 10);
  ctx.fillStyle = '#000000';
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(badgeText, centerX, y + 24);
  y += badgeH + 12;

  // Solid divider
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(padX, y);
  ctx.lineTo(width - padX, y);
  ctx.stroke();
  y += 12;

  // Job Number | Job Category grid
  const gridH = 78;
  const halfW = contentW / 2;
  drawRoundedRect(ctx, padX, y, contentW, gridH, 12);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 3.6;
  ctx.strokeStyle = '#000000';
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(padX + halfW, y);
  ctx.lineTo(padX + halfW, y + gridH);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.fillStyle = '#000000';
  ctx.font = '700 15px "Montserrat", "Archivo", sans-serif';
  ctx.fillText('JOB NUMBER', padX + halfW / 2, y + 26);
  ctx.fillText('JOB CATEGORY', padX + halfW + halfW / 2, y + 26);

  ctx.font = '700 24px "JetBrains Mono", monospace';
  ctx.fillText(slip.no, padX + halfW / 2, y + 58, halfW - 18);
  ctx.fillText(slip.cat, padX + halfW + halfW / 2, y + 58, halfW - 18);
  y += gridH + 10;

  // Info rows
  detailRows.forEach(([label, val, mono], idx) => {
    const rowMidY = y + 22;
    const isDueRow = label === 'Payment / Due:';
    ctx.font = '600 21px "Hind Siliguri", sans-serif';
    ctx.fillStyle = isDueRow ? '#b31412' : '#000000';
    ctx.textAlign = 'left';
    ctx.fillText(label, padX, rowMidY);

    ctx.font = mono
      ? '700 21px "JetBrains Mono", "Montserrat", sans-serif'
      : '700 21px "Montserrat", "Hind Siliguri", sans-serif';
    ctx.fillStyle = isDueRow ? '#a50e0e' : '#000000';
    ctx.textAlign = 'right';
    ctx.fillText(val, width - padX, rowMidY, contentW * 0.62);

    if (idx < detailRows.length - 1) {
      ctx.save();
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2;
      ctx.setLineDash([2, 5]);
      ctx.beginPath();
      ctx.moveTo(padX, y + 32);
      ctx.lineTo(width - padX, y + 32);
      ctx.stroke();
      ctx.restore();
    }
    y += 34;
  });

  // Bottom reserved block (Due Box if any + Barcode + Printed time)
  const footerH = 88 + (hasDueNotice ? dueBoxH + 14 : 0);
  const sealAvailTop = y + 6;
  const sealAvailBottom = height - footerH - 6;
  const sealCy = Math.round((sealAvailTop + sealAvailBottom) / 2);

  const roundCenterX = centerX;
  const sealScale = 1;
  const sealR = Math.min(132, Math.floor((sealAvailBottom - sealAvailTop) / 2));

  // B&W Double-Ring Round Seal
  if (showRoundSeal) {
    ctx.beginPath();
    ctx.arc(roundCenterX, sealCy, sealR, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 6.5 * sealScale;
    ctx.strokeStyle = '#000000';
    ctx.stroke();

    // Inner concentric solid ring
    ctx.beginPath();
    ctx.arc(roundCenterX, sealCy, sealR - 11 * sealScale, 0, Math.PI * 2);
    ctx.lineWidth = 3.5 * sealScale;
    ctx.strokeStyle = '#000000';
    ctx.stroke();

    // Inner dashed ring
    ctx.save();
    ctx.beginPath();
    ctx.arc(roundCenterX, sealCy, sealR - 6 * sealScale, 0, Math.PI * 2);
    ctx.lineWidth = 1.8 * sealScale;
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = '#000000';
    ctx.stroke();
    ctx.restore();

    // Custom uploaded circular logo OR Cap circle inside seal
    const capY = sealCy - Math.round(72 * sealScale);
    const capR = Math.round(27 * sealScale);
    if (logoImg) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(roundCenterX, capY, capR, 0, Math.PI * 2);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.clip();
      ctx.drawImage(logoImg, roundCenterX - capR, capY - capR, capR * 2, capR * 2);
      ctx.restore();

      ctx.beginPath();
      ctx.arc(roundCenterX, capY, capR, 0, Math.PI * 2);
      ctx.lineWidth = 3.2 * sealScale;
      ctx.strokeStyle = '#000000';
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(roundCenterX, capY, capR, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 3.5 * sealScale;
      ctx.strokeStyle = '#000000';
      ctx.stroke();

      // Cap emblem
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.moveTo(roundCenterX, capY - 11 * sealScale);
      ctx.lineTo(roundCenterX + 15 * sealScale, capY - 3 * sealScale);
      ctx.lineTo(roundCenterX, capY + 5 * sealScale);
      ctx.lineTo(roundCenterX - 15 * sealScale, capY - 3 * sealScale);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(roundCenterX - 9 * sealScale, capY + 3 * sealScale);
      ctx.lineTo(roundCenterX, capY + 8 * sealScale);
      ctx.lineTo(roundCenterX + 9 * sealScale, capY + 3 * sealScale);
      ctx.lineTo(roundCenterX + 9 * sealScale, capY + 11 * sealScale);
      ctx.lineTo(roundCenterX, capY + 15 * sealScale);
      ctx.lineTo(roundCenterX - 9 * sealScale, capY + 11 * sealScale);
      ctx.closePath();
      ctx.fill();
    }

    // Seal Title
    ctx.textAlign = 'center';
    ctx.fillStyle = '#000000';
    ctx.font = `800 ${Math.round(11.5 * sealScale)}px "Montserrat", sans-serif`;
    ctx.fillText('IDEAL TECHNICAL', roundCenterX, sealCy - 28 * sealScale);
    ctx.fillText('TRAINING & TESTING CENTER', roundCenterX, sealCy - 14 * sealScale);

    // Shield checkmark inside seal
    const msw = Math.round(44 * sealScale);
    const msh = Math.round(46 * sealScale);
    const msx = roundCenterX - msw / 2;
    const msy = sealCy - Math.round(4 * sealScale);
    ctx.beginPath();
    ctx.moveTo(msx + 4 * sealScale, msy);
    ctx.lineTo(msx + msw - 4 * sealScale, msy);
    ctx.lineTo(msx + msw, msy + msh * 0.45);
    ctx.quadraticCurveTo(msx + msw, msy + msh * 0.85, roundCenterX, msy + msh);
    ctx.quadraticCurveTo(msx, msy + msh * 0.85, msx, msy + msh * 0.45);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 3.2 * sealScale;
    ctx.strokeStyle = '#000000';
    ctx.stroke();

    ctx.fillStyle = '#000000';
    ctx.font = `900 ${Math.round(26 * sealScale)}px sans-serif`;
    ctx.fillText('✓', roundCenterX, msy + Math.round(31 * sealScale));

    // Seal Token ID & Student Code pill
    ctx.font = `700 ${Math.round(12 * sealScale)}px "Hind Siliguri", sans-serif`;
    ctx.fillText(`টোকেন আইডি: ${slip.no}`, roundCenterX, sealCy + 60 * sealScale, 210 * sealScale);

    const sealCodeLabel = slip.code ? `স্টুডেন্ট কোড: ${slip.code}` : slip.name;
    ctx.font = `700 ${Math.round(12.5 * sealScale)}px "Hind Siliguri", sans-serif`;
    const pillW = Math.min(200 * sealScale, ctx.measureText(sealCodeLabel).width + 30 * sealScale);
    drawRoundedRect(
      ctx,
      roundCenterX - pillW / 2,
      sealCy + 68 * sealScale,
      pillW,
      24 * sealScale,
      12 * sealScale
    );
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 2.2 * sealScale;
    ctx.strokeStyle = '#000000';
    ctx.stroke();
    ctx.fillStyle = '#000000';
    ctx.fillText(sealCodeLabel, roundCenterX, sealCy + 84 * sealScale, pillW - 14 * sealScale);
  }

  if (!showRoundSeal) {
    const sigY = sealAvailBottom - 16;
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(width - padX - 180, sigY - 20);
    ctx.lineTo(width - padX - 8, sigY - 20);
    ctx.stroke();
    ctx.fillStyle = '#334155';
    ctx.font = '700 15px "Montserrat", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Authorized Signature', width - padX - 94, sigY);
  }

  // Footer start
  let fy = height - footerH;
  if (hasDueNotice) {
    ctx.save();
    drawRoundedRect(ctx, padX, fy, contentW, dueBoxH, 8);
    ctx.fillStyle = '#fff6f6';
    ctx.fill();
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = '#c5221f';
    ctx.setLineDash([8, 5]);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = '#a50e0e';
    ctx.font = '700 18px "Hind Siliguri", sans-serif';
    ctx.textAlign = 'center';
    let py = fy + 24;
    dueNoticeLines.forEach((line) => {
      ctx.fillText(line, centerX, py, contentW - 24);
      py += 24;
    });
    fy += dueBoxH + 14;
  }

  // Dotted divider
  ctx.save();
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 3;
  ctx.setLineDash([3, 6]);
  ctx.beginPath();
  ctx.moveTo(padX, fy + 4);
  ctx.lineTo(width - padX, fy + 4);
  ctx.stroke();
  ctx.restore();

  // Barcode simulation bars (82% width, ~44px height at 220dpi)
  const barY = fy + 16;
  const barW = contentW * 0.82;
  const barX = (width - barW) / 2;
  const barPattern = [4, 4, 2, 6, 6, 4, 3, 5, 6, 3, 2, 6];
  let bx = barX;
  let patIdx = 0;
  ctx.fillStyle = '#000000';
  while (bx < barX + barW) {
    const segW = barPattern[patIdx % barPattern.length];
    if (patIdx % 2 === 0) {
      ctx.fillRect(bx, barY, Math.min(segW, barX + barW - bx), 40);
    }
    bx += segW;
    patIdx += 1;
  }

  // Printed timestamp
  ctx.font = '700 18px "JetBrains Mono", monospace';
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.fillText(`Printed: ${formatPrintedTimestamp()}`, centerX, fy + 76);

  return canvas;
}

export async function downloadThermalSlipPdf(
  slip: SlipData,
  settings: CenterSettings,
  appearance?: UiAppearanceSettings
): Promise<void> {
  const effectiveAppearance = appearance || loadUiSettings();
  const logoImg =
    effectiveAppearance.tokenShowLogo !== false && effectiveAppearance.logoDataUrl
      ? await loadImageAsync(effectiveAppearance.logoDataUrl)
      : null;
  const canvas = drawThermalSlipCanvas(slip, settings, effectiveAppearance, logoImg);
  const imgData = canvas.toDataURL('image/png');

  // Top-Center on A4 Portrait (210mm x 297mm): Width 3in (76.2mm), 0.3in (7.62mm) from top
  const slipWidthMm = 76.2;
  const slipHeightMm = (slipWidthMm * canvas.height) / canvas.width;
  const a4WidthMm = 210;
  const xOffsetMm = (a4WidthMm - slipWidthMm) / 2;
  const yOffsetMm = 7.62;

  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });
  pdf.addImage(imgData, 'PNG', xOffsetMm, yOffsetMm, slipWidthMm, slipHeightMm, undefined, 'FAST');
  pdf.save(`ITTC-Token-${slip.no}.pdf`);
}

export function buildThermalSlipHtml(
  slip: SlipData,
  settings: CenterSettings,
  appearance?: UiAppearanceSettings
): string {
  const printedAt = formatPrintedTimestamp();
  const hasDueNotice = Boolean(slip.isDueEntry && slip.tokenPaymentNote);
  const effectiveAppearance = appearance || loadUiSettings();
  const showRoundSeal = effectiveAppearance.tokenShowLogo !== false;

  const instituteName = (settings.name || 'IDEAL TECHNICAL TRAINING & TESTING CENTER').toUpperCase();
  const isDefaultName =
    instituteName === 'IDEAL TECHNICAL TRAINING & TESTING CENTER' ||
    instituteName.startsWith('IDEAL TECHNICAL');
  const sealCodePill = slip.code ? `স্টুডেন্ট কোড: ${slip.code}` : slip.name;

  return `<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Daily Job Token Print (3in x 3.5in) - ${escapeHtml(slip.no)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@500;600;700&family=Montserrat:wght@600;700;800&family=JetBrains+Mono:wght@600;700&display=swap" rel="stylesheet">
  <style>
    @page {
      size: A4 portrait;
      margin: 0;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    html, body {
      width: 100%;
      background: #ffffff;
      font-family: 'Hind Siliguri', 'Montserrat', sans-serif;
      color: #000000;
    }

    .a4-print-wrapper {
      width: 100%;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      padding-top: 0.3in;
    }

    .token-card {
      width: 3in;
      min-height: 3.5in;
      height: ${hasDueNotice || slip.note || slip.kind === 'out' ? 'auto' : '3.5in'};
      background: #ffffff;
      border: 2.2px solid #000000;
      border-radius: 10px;
      padding: 7px 9px;
      text-align: center;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      overflow: ${hasDueNotice ? 'visible' : 'hidden'};
      color: #000000;
    }

    .institute-name {
      font-family: 'Montserrat', sans-serif;
      font-size: 9.8px;
      font-weight: 800;
      letter-spacing: 0.15px;
      color: #000000;
      line-height: 1.15;
    }

    .token-badge-title {
      display: inline-block;
      background: #000000;
      color: #ffffff;
      font-family: 'Montserrat', sans-serif;
      font-size: 9px;
      font-weight: 700;
      padding: 2.5px 14px;
      border-radius: 5px;
      margin: 3px auto 4px;
      letter-spacing: 0.7px;
    }

    .divider-solid {
      border: none;
      border-top: 1.8px solid #000000;
      margin-bottom: 4px;
    }

    .job-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      border: 1.8px solid #000000;
      border-radius: 6px;
      overflow: hidden;
      margin-bottom: 4px;
    }

    .job-cell {
      padding: 4px 4px;
    }

    .job-cell:first-child {
      border-right: 1.8px solid #000000;
    }

    .job-cell-label {
      font-family: 'Montserrat', sans-serif;
      font-size: 7.4px;
      font-weight: 700;
      color: #000000;
      margin-bottom: 1px;
      text-transform: uppercase;
    }

    .job-cell-value {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11.5px;
      font-weight: 700;
      color: #000000;
      line-height: 1.12;
    }

    .info-rows {
      text-align: left;
    }

    .info-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 2.5px 0;
      border-bottom: 1px dotted #000000;
      font-size: 10.2px;
      line-height: 1.18;
      color: #000000;
    }

    .info-row:last-child {
      border-bottom: none;
    }

    .info-label {
      font-weight: 600;
      color: #000000;
    }

    .info-value {
      font-family: 'Montserrat', 'JetBrains Mono', 'Hind Siliguri', sans-serif;
      font-weight: 700;
      color: #000000;
      max-width: 1.65in;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .mini-seal-wrap {
      display: flex;
      justify-content: center;
      align-items: center;
      margin: 2px 0;
    }

    .auth-sig-line {
      font-size: 7.5px;
      color: #334155;
      border-top: 1px solid #475569;
      padding-top: 2px;
      font-weight: 700;
      white-space: nowrap;
    }

    .mini-round-seal {
      width: 124px;
      height: 124px;
      border-radius: 50%;
      background: #ffffff;
      border: 3px solid #000000;
      box-shadow: inset 0 0 0 2px #ffffff, inset 0 0 0 3.6px #000000;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: #000000;
      padding: 6px;
      position: relative;
    }

    .mini-round-seal::after {
      content: '';
      position: absolute;
      inset: 2.5px;
      border-radius: 50%;
      border: 0.9px dashed #000000;
      pointer-events: none;
    }

    .seal-cap-circle {
      width: 26px;
      height: 26px;
      border-radius: 50%;
      background: #ffffff;
      border: 1.8px solid #000000;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 2.5px;
    }

    .seal-cap-circle svg {
      width: 15px;
      height: 15px;
      fill: #000000;
    }

    .seal-custom-logo {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      object-fit: cover;
      border: 1.5px solid #000000;
      background: #ffffff;
      margin-bottom: 2px;
    }

    .seal-inst-title {
      font-family: 'Montserrat', sans-serif;
      font-size: 5.5px;
      font-weight: 800;
      letter-spacing: 0.12px;
      line-height: 1.15;
      color: #000000;
      text-transform: uppercase;
      max-width: 96px;
    }

    .seal-shield {
      width: 21px;
      height: 22px;
      margin: 2.5px 0;
      border: 1.6px solid #000000;
      border-radius: 2.5px 2.5px 50% 50% / 2.5px 2.5px 75% 75%;
      background: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      font-weight: 900;
      color: #000000;
      line-height: 1;
    }

    .seal-meta {
      font-size: 5.8px;
      font-weight: 700;
      color: #000000;
      line-height: 1.15;
    }

    .seal-code-pill {
      margin-top: 2px;
      font-size: 6px;
      font-weight: 700;
      background: #ffffff;
      border: 1.1px solid #000000;
      border-radius: 6px;
      padding: 1px 8px;
      color: #000000;
      line-height: 1.15;
      max-width: 104px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .due-notice-box {
      margin: 3px 0 4px;
      padding: 5px 6px;
      border: 1.8px dashed #c5221f;
      background: #fff6f6;
      color: #a50e0e;
      font-size: 9px;
      font-weight: 700;
      line-height: 1.3;
      border-radius: 4px;
    }

    .divider-dotted {
      border: none;
      border-top: 1.5px dotted #000000;
      margin-bottom: 4px;
    }

    .barcode-bars {
      height: 22px;
      width: 82%;
      margin: 0 auto 2px;
      background: repeating-linear-gradient(
        90deg,
        #000000 0px, #000000 1.8px,
        #ffffff 1.8px, #ffffff 3.5px,
        #000000 3.5px, #000000 5px,
        #ffffff 5px, #ffffff 8px,
        #000000 8px, #000000 11px,
        #ffffff 11px, #ffffff 13px
      );
    }

    .printed-time {
      font-family: 'JetBrains Mono', monospace;
      font-size: 8.6px;
      font-weight: 700;
      color: #000000;
      line-height: 1.15;
    }

    .no-print, .print-actions {
      margin-top: 18px;
      display: flex;
      gap: 10px;
      justify-content: center;
    }
    .print-btn {
      background: #0f766e;
      color: #fff;
      border: none;
      padding: 9px 18px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    .close-btn {
      background: #e2e8f0;
      color: #0f172a;
      border: 1px solid #cbd5e1;
      padding: 9px 18px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }

    @media print {
      html, body {
        width: 100% !important;
        height: auto !important;
        min-height: 0 !important;
        background: #ffffff !important;
        margin: 0 !important;
        padding: 0 !important;
        color: #000000 !important;
        overflow: hidden !important;
      }

      .a4-print-wrapper {
        width: 100% !important;
        padding-top: 0.3in !important;
        margin: 0 !important;
        display: flex !important;
        justify-content: center !important;
        align-items: flex-start !important;
      }

      .token-card {
        width: 3in !important;
        ${hasDueNotice || slip.note || slip.kind === 'out' ? 'min-height: 3.5in !important; height: auto !important;' : 'height: 3.5in !important;'}
        page-break-inside: avoid;
        break-inside: avoid;
        color: #000000 !important;
      }

      .no-print, .print-actions {
        display: none !important;
      }

      a[href]::after {
        content: none !important;
      }

      * {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
    }
  </style>
</head>
<body>

  <div class="a4-print-wrapper">
    <div class="token-card">
      <div>
        <div class="institute-name">${escapeHtml(instituteName)}</div>
        <div class="token-badge-title">${slip.kind === 'out' ? 'OUT STUDENT TOKEN' : 'DAILY JOB TOKEN'}</div>
        <hr class="divider-solid">

        <div class="job-grid">
          <div class="job-cell">
            <div class="job-cell-label">JOB NUMBER</div>
            <div class="job-cell-value">${escapeHtml(slip.no)}</div>
          </div>
          <div class="job-cell">
            <div class="job-cell-label">JOB CATEGORY</div>
            <div class="job-cell-value">${escapeHtml(slip.cat)}</div>
          </div>
        </div>

        <div class="info-rows">
          <div class="info-row">
            <span class="info-label">Student Name:</span>
            <span class="info-value">${escapeHtml(slip.name)}</span>
          </div>
          ${slip.code ? `<div class="info-row"><span class="info-label">Student Code:</span><span class="info-value">${escapeHtml(slip.code)}</span></div>` : ''}
          <div class="info-row">
            <span class="info-label">Testing Date:</span>
            <span class="info-value">${escapeHtml(slip.date)}</span>
          </div>
          ${slip.isDueEntry ? `<div class="info-row"><span class="info-label" style="color:#b31412;">Payment / Due:</span><span class="info-value" style="color:#a50e0e;">Paid ${escapeHtml(formatTaka(slip.paid))} · Due ${escapeHtml(formatTaka(slip.dueAmount || 0))}</span></div>` : ''}
          ${slip.kind === 'out' ? `<div class="info-row"><span class="info-label">Paid Amount:</span><span class="info-value">${escapeHtml(formatTaka(slip.paid))}</span></div>` : ''}
          ${slip.note ? `<div class="info-row"><span class="info-label">Remarks:</span><span class="info-value">${escapeHtml(slip.note)}</span></div>` : ''}
        </div>
      </div>

      <!-- গোল লোগো সিল -->
      ${
        showRoundSeal
          ? `<div class="mini-seal-wrap"><div class="mini-round-seal">
          ${
            effectiveAppearance.logoDataUrl
              ? `<img src="${escapeHtml(effectiveAppearance.logoDataUrl)}" alt="Center Logo" class="seal-custom-logo" />`
              : `<div class="seal-cap-circle">
            <svg viewBox="0 0 24 24">
              <path d="M12 3L1 9l11 6 9-4.91V17h2V9L12 3zM5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82z"/>
            </svg>
          </div>`
          }
          <div class="seal-inst-title">${isDefaultName ? 'IDEAL TECHNICAL<br>TRAINING &amp; TESTING CENTER' : escapeHtml(instituteName)}</div>
          <div class="seal-shield">✓</div>
          <div class="seal-meta">টোকেন আইডি: ${escapeHtml(slip.no)}</div>
          <div class="seal-code-pill">${escapeHtml(sealCodePill)}</div>
        </div></div>`
          : `<div style="display:flex;justify-content:flex-end;padding:16px 8px 4px;">
          <span class="auth-sig-line">Authorized Signature</span>
        </div>`
      }

      ${hasDueNotice ? `<div class="due-notice-box">${escapeHtml(slip.tokenPaymentNote || '')}</div>` : ''}

      <div>
        <hr class="divider-dotted">
        <div class="barcode-bars"></div>
        <div class="printed-time">Printed: ${escapeHtml(printedAt)}</div>
      </div>
    </div>
  </div>

  <div class="no-print print-actions">
    <button type="button" class="print-btn" onclick="window.print()">আবার প্রিন্ট করুন</button>
    <button type="button" class="close-btn" onclick="window.close()">ট্যাব বন্ধ করুন</button>
  </div>

  <script>
    (function () {
      function notifyAndClose() {
        try {
          if (typeof BroadcastChannel !== 'undefined') {
            var ch = new BroadcastChannel('ittc_token_print');
            ch.postMessage({ type: 'TOKEN_PRINT_DONE', ts: Date.now() });
            ch.close();
          }
        } catch (e) {}
        try {
          localStorage.setItem('ittc.tokenPrintDone', String(Date.now()));
        } catch (e) {}
        try {
          window.close();
        } catch (e) {}
      }

      window.addEventListener('afterprint', notifyAndClose, { once: true });
      window.addEventListener('DOMContentLoaded', function () {
        if (window.__ittcTokenPrinted) return;
        window.__ittcTokenPrinted = true;
        setTimeout(function () {
          window.print();
        }, 300);
      }, { once: true });
    })();
  </script>
</body>
</html>`;
}

export function createTokenBlobUrl(
  slip: SlipData,
  settings: CenterSettings,
  appearance?: UiAppearanceSettings
): string {
  const html = buildThermalSlipHtml(slip, settings, appearance);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  return URL.createObjectURL(blob);
}

export function openTokenPrintTab(
  slip: SlipData,
  settings: CenterSettings,
  appearance?: UiAppearanceSettings
): string {
  const url = createTokenBlobUrl(slip, settings, appearance);
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return url;
}

export function downloadThermalSlipHtml(
  slip: SlipData,
  settings: CenterSettings,
  appearance?: UiAppearanceSettings
): void {
  const html = buildThermalSlipHtml(slip, settings, appearance);
  downloadFile(`ITTC-Token-${slip.no}.html`, html, 'text/html;charset=utf-8');
}

export function downloadReportPdf(
  spec: PrintableReportSpec,
  settings: CenterSettings
): void {
  const isRegister = spec.variant === 'register';
  const isWide = !isRegister && spec.columns.length > 6;
  const pageW = isWide ? 1680 : 1240;
  const pageH = isWide ? 1188 : 1754;
  const pad = isRegister ? 56 : 64;
  const usableW = pageW - pad * 2;
  const rowsPerPage = isRegister ? 38 : isWide ? 24 : 36;

  const totalPages = Math.max(1, Math.ceil(spec.rows.length / rowsPerPage));
  const pdf = new jsPDF({
    orientation: isWide ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
  });
  const pdfW = pdf.internal.pageSize.getWidth();
  const pdfH = pdf.internal.pageSize.getHeight();

  // Compute proportional column widths for register variant
  const colWidths = (() => {
    if (!isRegister || spec.columns.length !== 8) {
      return spec.columns.map(() => usableW / Math.max(1, spec.columns.length));
    }
    const weights = [0.055, 0.13, 0.22, 0.11, 0.195, 0.095, 0.095, 0.1];
    return weights.map((w) => usableW * w);
  })();

  for (let p = 0; p < totalPages; p += 1) {
    const canvas = document.createElement('canvas');
    canvas.width = pageW;
    canvas.height = pageH;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, pageW, pageH);

    let y = 66;

    if (isRegister) {
      // Centered Institute Name + Subtitle matching Screenshots 1-3
      ctx.textAlign = 'center';
      ctx.fillStyle = '#0f766e';
      ctx.font = '800 28px "Archivo", "Hind Siliguri", sans-serif';
      ctx.fillText(
        (settings.name || 'IDEAL TECHNICAL TRAINING & TESTING CENTER').toUpperCase(),
        pageW / 2,
        y
      );
      y += 32;
      ctx.fillStyle = '#0f172a';
      ctx.font = '700 22px "Archivo", "Hind Siliguri", sans-serif';
      ctx.fillText(spec.title, pageW / 2, y);
      y += 26;
    } else {
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 30px "Archivo", "Hind Siliguri", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(settings.name || 'ITTC Center', pad, y);

      ctx.font = '18px "Hind Siliguri", sans-serif';
      ctx.fillStyle = '#475569';
      ctx.textAlign = 'right';
      ctx.fillText(`Page ${p + 1} of ${totalPages}`, pageW - pad, y);

      y += 34;
      ctx.textAlign = 'left';
      ctx.fillStyle = '#0f766e';
      ctx.font = 'bold 24px "Archivo", "Hind Siliguri", sans-serif';
      ctx.fillText(spec.title, pad, y);

      if (spec.subtitle) {
        y += 26;
        ctx.fillStyle = '#64748b';
        ctx.font = '17px "Hind Siliguri", sans-serif';
        ctx.fillText(spec.subtitle, pad, y);
      }

      y += 18;
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(pageW - pad, y);
      ctx.stroke();
      y += 28;
    }

    // Summary strip on first page for non-register reports
    if (!isRegister && p === 0 && spec.summary && spec.summary.length > 0) {
      const cardCount = spec.summary.length;
      const gap = 16;
      const cardW = (usableW - gap * (cardCount - 1)) / cardCount;
      spec.summary.forEach((s, idx) => {
        const cx = pad + idx * (cardW + gap);
        ctx.fillStyle = '#f8fafc';
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 1.5;
        ctx.fillRect(cx, y, cardW, 74);
        ctx.strokeRect(cx, y, cardW, 74);

        ctx.fillStyle = '#64748b';
        ctx.font = 'bold 14px "Hind Siliguri", sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(s.label, cx + 16, y + 26, cardW - 32);

        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 22px "JetBrains Mono", "Hind Siliguri", monospace';
        ctx.fillText(s.value, cx + 16, y + 56, cardW - 32);
      });
      y += 96;
    }

    const rowH = isRegister ? 36 : 38;
    const tableTopY = y;

    // Table header
    if (isRegister) {
      ctx.fillStyle = '#f1f5f9';
      ctx.fillRect(pad, y, usableW, rowH);
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1.4;
      ctx.strokeRect(pad, y, usableW, rowH);

      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 15px "Archivo", "Hind Siliguri", sans-serif';
      ctx.textAlign = 'left';
      let cx = pad;
      spec.columns.forEach((col, i) => {
        const cw = colWidths[i];
        if (i > 0) {
          ctx.beginPath();
          ctx.moveTo(cx, y);
          ctx.lineTo(cx, y + rowH);
          ctx.stroke();
        }
        ctx.fillText(col, cx + 10, y + 24, cw - 18);
        cx += cw;
      });
    } else {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(pad, y, usableW, rowH);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 15px "Hind Siliguri", sans-serif';
      ctx.textAlign = 'left';
      let cx = pad;
      spec.columns.forEach((col, i) => {
        const cw = colWidths[i];
        ctx.fillText(col, cx + 10, y + 25, cw - 20);
        cx += cw;
      });
    }
    y += rowH;

    // Rows
    const slice = spec.rows.slice(p * rowsPerPage, (p + 1) * rowsPerPage);
    if (slice.length === 0) {
      ctx.fillStyle = '#64748b';
      ctx.font = '18px "Hind Siliguri", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('No records available for this report.', pad + 12, y + 36);
    } else {
      slice.forEach((row, rIdx) => {
        if (isRegister) {
          ctx.strokeStyle = '#334155';
          ctx.lineWidth = 1.1;
          ctx.strokeRect(pad, y, usableW, rowH);

          let cx = pad;
          ctx.fillStyle = '#0f172a';
          ctx.font = '14px "Archivo", "Hind Siliguri", sans-serif';
          ctx.textAlign = 'left';
          row.forEach((cell, cIdx) => {
            const cw = colWidths[cIdx] || usableW / spec.columns.length;
            if (cIdx > 0) {
              ctx.beginPath();
              ctx.moveTo(cx, y);
              ctx.lineTo(cx, y + rowH);
              ctx.stroke();
            }
            ctx.fillText(String(cell ?? ''), cx + 10, y + 23, cw - 18);
            cx += cw;
          });
        } else {
          if (rIdx % 2 === 1) {
            ctx.fillStyle = '#f8fafc';
            ctx.fillRect(pad, y, usableW, rowH);
          }
          ctx.strokeStyle = '#e2e8f0';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(pad, y + rowH);
          ctx.lineTo(pageW - pad, y + rowH);
          ctx.stroke();

          ctx.fillStyle = '#0f172a';
          ctx.font = '15px "Hind Siliguri", "JetBrains Mono", sans-serif';
          ctx.textAlign = 'left';
          let cx = pad;
          row.forEach((cell, cIdx) => {
            const cw = colWidths[cIdx] || usableW / spec.columns.length;
            ctx.fillText(String(cell ?? ''), cx + 10, y + 25, cw - 20);
            cx += cw;
          });
        }
        y += rowH;
      });
    }

    if (isRegister && p === totalPages - 1 && spec.footerSummary) {
      y += 28;
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 17px "Archivo", "Hind Siliguri", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(spec.footerSummary, pad, y);
    }

    // Page footer
    if (isRegister) {
      ctx.fillStyle = '#475569';
      ctx.font = '13px "Archivo", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`${p + 1} of ${totalPages}`, pad, pageH - 28);
      ctx.textAlign = 'right';
      ctx.fillText(formatPrintedTimestamp(), pageW - pad, pageH - 28);
      void tableTopY;
    } else {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '14px "Hind Siliguri", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(settings.address || 'ITTC Management System', pad, pageH - 34);
      ctx.textAlign = 'right';
      ctx.fillText(new Date().toLocaleString(), pageW - pad, pageH - 34);
    }

    if (p > 0) pdf.addPage();
    pdf.addImage(
      canvas.toDataURL('image/png'),
      'PNG',
      0,
      0,
      pdfW,
      pdfH,
      undefined,
      'FAST'
    );
  }

  pdf.save(`${spec.filename}.pdf`);
}

export function buildReportHtml(
  spec: PrintableReportSpec,
  settings: CenterSettings,
  autoPrint = true
): string {
  const isRegister = spec.variant === 'register';
  const summaryHtml =
    !isRegister && spec.summary && spec.summary.length > 0
      ? `<div class="summary">${spec.summary
          .map(
            (s) =>
              `<div class="card"><div class="lbl">${escapeHtml(s.label)}</div><div class="val">${escapeHtml(s.value)}</div></div>`
          )
          .join('')}</div>`
      : '';

  const headHtml = spec.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
  const bodyHtml = spec.rows
    .map(
      (r) =>
        `<tr>${r.map((cell) => `<td>${escapeHtml(String(cell ?? ''))}</td>`).join('')}</tr>`
    )
    .join('');

  const centerTitle = (settings.name || 'IDEAL TECHNICAL TRAINING & TESTING CENTER').toUpperCase();

  if (isRegister) {
    return `<!doctype html>
<html lang="bn">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(spec.title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800&family=Hind+Siliguri:wght@500;600;700&display=swap" rel="stylesheet">
  <style>
    @page { size: A4 portrait; margin: 10mm 9mm; }
    * { box-sizing: border-box; }
    body {
      font-family: "Archivo", "Hind Siliguri", system-ui, sans-serif;
      color: #0f172a;
      margin: 0;
      padding: 12px 16px 24px;
      background: #fff;
    }
    .header { text-align: center; margin-bottom: 10px; }
    .institute {
      font-size: 18px;
      font-weight: 800;
      color: #0f766e;
      letter-spacing: 0.4px;
      margin: 0;
      text-transform: uppercase;
    }
    .report-title {
      font-size: 13.5px;
      font-weight: 700;
      color: #0f172a;
      margin: 3px 0 0;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 10.5px;
      border: 1px solid #334155;
    }
    thead { display: table-header-group; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    th, td {
      border: 1px solid #334155;
      padding: 5px 7px;
      text-align: left;
      vertical-align: middle;
    }
    th {
      background: #f8fafc;
      font-weight: 700;
      color: #0f172a;
    }
    .footer-summary {
      margin-top: 10px;
      font-size: 12px;
      font-weight: 800;
      color: #0f172a;
    }
    .no-print, .print-bar {
      margin-bottom: 14px;
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    .print-btn {
      background: #0f766e;
      color: #fff;
      border: none;
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }
    .close-btn {
      background: #e2e8f0;
      color: #0f172a;
      border: 1px solid #cbd5e1;
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }
    @media print {
      body { padding: 0; }
      .no-print, .print-bar { display: none !important; }
      th { background: #f8fafc !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="no-print print-bar">
    <button class="print-btn" onclick="window.print()">আবার প্রিন্ট করুন</button>
    <button class="close-btn" onclick="window.close()">ট্যাব বন্ধ করুন</button>
  </div>
  <div class="header">
    <div class="institute">${escapeHtml(centerTitle)}</div>
    <div class="report-title">${escapeHtml(spec.title)}</div>
  </div>
  <table>
    <thead><tr>${headHtml}</tr></thead>
    <tbody>${bodyHtml}</tbody>
  </table>
  ${spec.footerSummary ? `<div class="footer-summary">${escapeHtml(spec.footerSummary)}</div>` : ''}
  ${autoPrint ? '<script>window.addEventListener("DOMContentLoaded",function(){setTimeout(function(){window.print();},300);});</script>' : ''}
</body>
</html>`;
  }

  return `<!doctype html>
<html lang="bn">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(spec.title)}</title>
  <style>
    @page { size: A4; margin: 12mm; }
    body { font-family: "Hind Siliguri", system-ui, sans-serif; color: #0f172a; margin: 0; padding: 20px; }
    h1 { margin: 0 0 4px; font-size: 20px; }
    .sub { color: #475569; font-size: 13px; margin-bottom: 14px; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 16px; }
    .card { border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px; background: #f8fafc; }
    .lbl { font-size: 11px; color: #64748b; font-weight: 700; }
    .val { font-size: 16px; font-weight: 700; margin-top: 3px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    th { background: #0f172a; color: #fff; text-align: left; padding: 8px; }
    td { border-bottom: 1px solid #e2e8f0; padding: 7px 8px; }
    tr:nth-child(even) td { background: #f8fafc; }
    .footer-summary { margin-top: 12px; font-size: 13px; font-weight: 700; color: #0f172a; }
    .no-print { margin-bottom: 16px; display: flex; justify-content: flex-end; gap: 8px; }
    .print-btn { background: #0f766e; color: #fff; border: none; padding: 8px 16px; border-radius: 6px; font-size: 12px; font-weight: 700; cursor: pointer; }
    .close-btn { background: #e2e8f0; color: #0f172a; border: 1px solid #cbd5e1; padding: 8px 16px; border-radius: 6px; font-size: 12px; font-weight: 700; cursor: pointer; }
    @media print {
      body { padding: 0; }
      .no-print { display: none !important; }
      th { background: #0f172a !important; color: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="no-print">
    <button class="print-btn" onclick="window.print()">আবার প্রিন্ট করুন</button>
    <button class="close-btn" onclick="window.close()">ট্যাব বন্ধ করুন</button>
  </div>
  <div style="font-size:12px;color:#475569;margin-bottom:4px">${escapeHtml(settings.name)} ${settings.address ? '· ' + escapeHtml(settings.address) : ''}</div>
  <h1>${escapeHtml(spec.title)}</h1>
  ${spec.subtitle ? `<div class="sub">${escapeHtml(spec.subtitle)}</div>` : ''}
  ${summaryHtml}
  <table>
    <thead><tr>${headHtml}</tr></thead>
    <tbody>${bodyHtml}</tbody>
  </table>
  ${spec.footerSummary ? `<div class="footer-summary">${escapeHtml(spec.footerSummary)}</div>` : ''}
  ${autoPrint ? '<script>window.addEventListener("DOMContentLoaded",function(){setTimeout(function(){window.print();},300);});</script>' : ''}
</body>
</html>`;
}

export function openReportPrintTab(
  spec: PrintableReportSpec,
  settings: CenterSettings
): string {
  const html = buildReportHtml(spec, settings, true);
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
  return url;
}

export function downloadReportHtml(
  spec: PrintableReportSpec,
  settings: CenterSettings
): void {
  const html = buildReportHtml(spec, settings, true);
  downloadFile(`${spec.filename}.html`, html, 'text/html;charset=utf-8');
}

export function buildGeneralAccountsPrintHtml(params: {
  rows: GeneralAccountRow[];
  centerName: string;
  totals: {
    bnInCash: string;
    bnInBank: string;
    bnOutCash: string;
    bnNetCash: string;
    bnNetTotal: string;
  };
  parseNum: (val: unknown) => number;
}): string {
  const { rows, centerName, totals, parseNum } = params;
  const headerTitle = `${(centerName || 'IDEAL TECHNICAL TRAINING & TESTING CENTER').toUpperCase()} — GENERAL ACCOUNTS`;

  const bodyHtml = rows
    .map((row) => {
      const inCashCls = row.isOpening ? 'bg-green' : '';
      const inBankCls = row.isOpening
        ? 'bg-yellow'
        : parseNum(row.inBank) > 0
          ? 'bg-green'
          : '';
      return `<tr>
        <td class="text-center">${escapeHtml(row.date || '')}</td>
        <td>${escapeHtml(row.inDesc || '')}</td>
        <td class="text-center ${inCashCls}">${escapeHtml(row.inCash || '')}</td>
        <td class="text-center ${inBankCls}">${escapeHtml(row.inBank || '')}</td>
        <td>${escapeHtml(row.outDesc || '')}</td>
        <td class="text-center">${escapeHtml(row.outCash || '')}</td>
        <td class="text-center ${inCashCls}">${escapeHtml(row.inCash || '')}</td>
        <td class="text-center">${escapeHtml(row.outCash || '')}</td>
        <td class="text-center ${inBankCls}">${escapeHtml(row.inBank || '')}</td>
        <td></td>
        <td></td>
      </tr>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>GENERAL ACCOUNTS - ${escapeHtml(centerName || 'ITTC')}</title>
  <style>
    @page { size: A4 landscape; margin: 6mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: "SolaimanLipi", "Nikosh", "Hind Siliguri", "Segoe UI", Tahoma, sans-serif; }
    body { background: #ffffff; color: #000000; padding: 10px; }
    .no-print { margin-bottom: 10px; display: flex; justify-content: flex-end; gap: 8px; }
    .print-btn { background: #0f766e; color: #fff; border: none; padding: 7px 14px; border-radius: 6px; font-size: 12px; font-weight: 700; cursor: pointer; }
    .close-btn { background: #e2e8f0; color: #0f172a; border: 1px solid #cbd5e1; padding: 7px 14px; border-radius: 6px; font-size: 12px; font-weight: 700; cursor: pointer; }
    .excel-container { border: 1.5px solid #000000; padding: 4px; background: #ffffff; }
    .excel-sheet-header { text-align: center; font-size: 13px; font-weight: 700; margin-bottom: 6px; color: #000000; }
    table.excel-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 9.5px; color: #000000; }
    table.excel-table th, table.excel-table td { border: 1px solid #000000; padding: 2px 4px; height: 18px; vertical-align: middle; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .hdr-peach { background-color: #f4b084 !important; font-weight: 700; text-align: center; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .bg-green { background-color: #00b050 !important; color: #000000; font-weight: 700; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .bg-yellow { background-color: #ffff00 !important; color: #000000; font-weight: 700; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
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
    <button type="button" class="print-btn" onclick="window.print()">আবার প্রিন্ট করুন</button>
    <button type="button" class="close-btn" onclick="window.close()">ট্যাব বন্ধ করুন</button>
  </div>
  <div class="excel-container">
    <div class="excel-sheet-header">${escapeHtml(headerTitle)}</div>
    <table class="excel-table">
      <colgroup>
        <col style="width: 68px;" />
        <col style="width: 185px;" />
        <col style="width: 62px;" />
        <col style="width: 62px;" />
        <col style="width: 205px;" />
        <col style="width: 62px;" />
        <col style="width: 62px;" />
        <col style="width: 62px;" />
        <col style="width: 62px;" />
        <col style="width: 66px;" />
        <col style="width: 68px;" />
      </colgroup>
      <thead>
        <tr>
          <th class="hdr-peach" rowspan="2">তারিখ</th>
          <th class="hdr-peach" colspan="3">আয়</th>
          <th class="hdr-peach" colspan="2">ব্যয়</th>
          <th class="hdr-peach" rowspan="2">নগদ টাকা</th>
          <th class="hdr-peach" rowspan="2">ব্যয়ের টাকা</th>
          <th class="hdr-peach" rowspan="2">ব্যাংকে জমা</th>
          <th class="hdr-peach" rowspan="2">নগদ ব্যালেন্স</th>
          <th class="hdr-peach" rowspan="2">নগদ +<br />ব্যাংক</th>
        </tr>
        <tr>
          <th class="hdr-peach">আয়ের মাধ্যম</th>
          <th class="hdr-peach">নগদ টাকা</th>
          <th class="hdr-peach">ব্যাংকে জমা</th>
          <th class="hdr-peach">ব্যয়ের মাধ্যম</th>
          <th class="hdr-peach">ব্যয়ের টাকা</th>
        </tr>
      </thead>
      <tbody>${bodyHtml}</tbody>
      <tfoot>
        <tr>
          <td></td>
          <td class="bold">ব্যাংকে জমা আছে=</td>
          <td></td>
          <td></td>
          <td class="text-right bold">ব্যাংক জমা আছে</td>
          <td></td>
          <td></td>
          <td></td>
          <td></td>
          <td></td>
          <td></td>
        </tr>
        <tr>
          <td></td>
          <td></td>
          <td class="text-center bg-green">${escapeHtml(totals.bnInCash)}</td>
          <td class="text-center bg-green">${escapeHtml(totals.bnInBank)}</td>
          <td class="text-right bold">ক্যাশে জমা আছে=</td>
          <td class="text-center bg-yellow">${escapeHtml(totals.bnOutCash)}</td>
          <td class="text-center bg-green">${escapeHtml(totals.bnInCash)}</td>
          <td class="text-center bg-yellow">${escapeHtml(totals.bnOutCash)}</td>
          <td class="text-center bg-green">${escapeHtml(totals.bnInBank)}</td>
          <td class="text-center bg-green">${escapeHtml(totals.bnNetCash)}</td>
          <td class="text-center bg-green">${escapeHtml(totals.bnNetTotal)}</td>
        </tr>
      </tfoot>
    </table>
  </div>
  <script>
    window.addEventListener('DOMContentLoaded', function () {
      setTimeout(function () { window.print(); }, 250);
    });
  </script>
</body>
</html>`;
}

export function openGeneralAccountsPrintTab(params: {
  rows: GeneralAccountRow[];
  centerName: string;
  totals: {
    bnInCash: string;
    bnInBank: string;
    bnOutCash: string;
    bnNetCash: string;
    bnNetTotal: string;
  };
  parseNum: (val: unknown) => number;
}): string {
  const html = buildGeneralAccountsPrintHtml(params);
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
  return url;
}
