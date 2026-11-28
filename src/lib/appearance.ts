export type AccentTheme = 'emerald' | 'navy' | 'flame';
export type TokenSealShape = 'rect' | 'circle';

export interface ColorGradingPreset {
  id: string;
  name: string;
  bgColor: string;
  cardColor: string;
  accentColor: string;
  textColor: string;
  builtin?: boolean;
}

export interface UiAppearanceSettings {
  logoDataUrl: string;
  instituteTitle: string;
  instituteSub: string;
  fontFamily: string;
  fontScale: number;
  accentTheme: AccentTheme;
  animationsEnabled: boolean;
  fxAuroraSweep: boolean;
  fxBentoSpring: boolean;
  fxKineticCounter: boolean;
  fxSpotlight: boolean;
  fxRowScan: boolean;
  tokenShowLogo: boolean;

  // Color Grading & Custom Presets
  colorGradingEnabled: boolean;
  activePresetId: string;
  bgColor: string;
  cardColor: string;
  accentColor: string;
  textColor: string;
  customColorPresets: ColorGradingPreset[];

  // Custom Token Print Seal
  tokenSealVisible: boolean;
  tokenSealMainText: string;
  tokenSealSubText: string;
  tokenSealColor: string;
  tokenSealShape: TokenSealShape;
  tokenSealImageDataUrl: string;
}

export const UI_SETTINGS_STORAGE_KEY = 'ittc_center_settings_v1';
const LEGACY_LOGO_STORAGE_KEY = 'ideal_tech_dashboard_logo_v1';

export const BUILTIN_COLOR_GRADING_PRESETS: ColorGradingPreset[] = [
  {
    id: 'default',
    name: 'Emerald Default (Auto)',
    bgColor: '#060a12',
    cardColor: '#0c1320',
    accentColor: '#10b981',
    textColor: '#f8fafc',
    builtin: true,
  },
  {
    id: 'midnight',
    name: 'Midnight Dark',
    bgColor: '#090d16',
    cardColor: '#111a2e',
    accentColor: '#f97316',
    textColor: '#f8fafc',
    builtin: true,
  },
  {
    id: 'navy',
    name: 'Deep Navy',
    bgColor: '#071326',
    cardColor: '#0e2240',
    accentColor: '#38bdf8',
    textColor: '#f1f5f9',
    builtin: true,
  },
  {
    id: 'amber',
    name: 'Warm Charcoal',
    bgColor: '#14110f',
    cardColor: '#221c18',
    accentColor: '#eab308',
    textColor: '#fafaf9',
    builtin: true,
  },
];

export const FONT_FAMILY_OPTIONS: Array<{ value: string; label: string }> = [
  {
    value: "'Plus Jakarta Sans', 'Hind Siliguri', sans-serif",
    label: 'Plus Jakarta Sans + Hind Siliguri',
  },
  {
    value: "'Hind Siliguri', 'Plus Jakarta Sans', sans-serif",
    label: 'Hind Siliguri (Bangla Focus)',
  },
  {
    value: "'Noto Sans Bengali', 'Inter', sans-serif",
    label: 'Noto Sans Bengali + Inter',
  },
  {
    value: "'Inter', 'Hind Siliguri', sans-serif",
    label: 'Inter + Hind Siliguri',
  },
  {
    value: "'JetBrains Mono', monospace",
    label: 'JetBrains Mono',
  },
];

export const DEFAULT_UI_SETTINGS: UiAppearanceSettings = {
  logoDataUrl: '',
  instituteTitle: 'WELCOME TO IDEAL TECHNICAL TRAINING & TESTING CENTER',
  instituteSub: 'Practical Test & Management System',
  fontFamily: "'Plus Jakarta Sans', 'Hind Siliguri', sans-serif",
  fontScale: 100,
  accentTheme: 'emerald',
  animationsEnabled: true,
  fxAuroraSweep: true,
  fxBentoSpring: true,
  fxKineticCounter: true,
  fxSpotlight: true,
  fxRowScan: true,
  tokenShowLogo: true,

  colorGradingEnabled: false,
  activePresetId: 'default',
  bgColor: '#090d16',
  cardColor: '#111a2e',
  accentColor: '#f97316',
  textColor: '#f8fafc',
  customColorPresets: [],

  tokenSealVisible: true,
  tokenSealMainText: 'APPROVED',
  tokenSealSubText: 'ITTC TESTING CENTER',
  tokenSealColor: '#dc2626',
  tokenSealShape: 'rect',
  tokenSealImageDataUrl: '',
};

function isValidHexColor(val: unknown): val is string {
  return typeof val === 'string' && /^#[0-9a-fA-F]{6}$/.test(val.trim());
}

function normalizeCustomPresets(raw: unknown): ColorGradingPreset[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is ColorGradingPreset => {
      if (!item || typeof item !== 'object') return false;
      const p = item as Partial<ColorGradingPreset>;
      return (
        typeof p.id === 'string' &&
        typeof p.name === 'string' &&
        p.name.trim().length > 0 &&
        isValidHexColor(p.bgColor) &&
        isValidHexColor(p.cardColor) &&
        isValidHexColor(p.accentColor) &&
        isValidHexColor(p.textColor)
      );
    })
    .map((p) => ({
      id: p.id,
      name: p.name.trim(),
      bgColor: p.bgColor.trim(),
      cardColor: p.cardColor.trim(),
      accentColor: p.accentColor.trim(),
      textColor: p.textColor.trim(),
      builtin: false,
    }));
}

export function loadUiSettings(): UiAppearanceSettings {
  try {
    const raw = localStorage.getItem(UI_SETTINGS_STORAGE_KEY);
    let legacyLogo = '';
    try {
      legacyLogo = localStorage.getItem(LEGACY_LOGO_STORAGE_KEY) || '';
    } catch {
      legacyLogo = '';
    }
    if (!raw) {
      return {
        ...DEFAULT_UI_SETTINGS,
        logoDataUrl: legacyLogo,
      };
    }
    const parsed = JSON.parse(raw) as Partial<UiAppearanceSettings>;
    return {
      ...DEFAULT_UI_SETTINGS,
      ...parsed,
      logoDataUrl: typeof parsed.logoDataUrl === 'string' ? parsed.logoDataUrl : legacyLogo,
      instituteTitle:
        typeof parsed.instituteTitle === 'string' && parsed.instituteTitle.trim()
          ? parsed.instituteTitle
          : DEFAULT_UI_SETTINGS.instituteTitle,
      instituteSub:
        typeof parsed.instituteSub === 'string'
          ? parsed.instituteSub
          : DEFAULT_UI_SETTINGS.instituteSub,
      fontFamily:
        typeof parsed.fontFamily === 'string' && parsed.fontFamily.trim()
          ? parsed.fontFamily
          : DEFAULT_UI_SETTINGS.fontFamily,
      fontScale:
        typeof parsed.fontScale === 'number' &&
        parsed.fontScale >= 85 &&
        parsed.fontScale <= 120
          ? parsed.fontScale
          : DEFAULT_UI_SETTINGS.fontScale,
      accentTheme:
        parsed.accentTheme === 'navy' ||
        parsed.accentTheme === 'flame' ||
        parsed.accentTheme === 'emerald'
          ? parsed.accentTheme
          : 'emerald',
      animationsEnabled:
        typeof parsed.animationsEnabled === 'boolean' ? parsed.animationsEnabled : true,
      fxAuroraSweep: typeof parsed.fxAuroraSweep === 'boolean' ? parsed.fxAuroraSweep : true,
      fxBentoSpring: typeof parsed.fxBentoSpring === 'boolean' ? parsed.fxBentoSpring : true,
      fxKineticCounter:
        typeof parsed.fxKineticCounter === 'boolean' ? parsed.fxKineticCounter : true,
      fxSpotlight: typeof parsed.fxSpotlight === 'boolean' ? parsed.fxSpotlight : true,
      fxRowScan: typeof parsed.fxRowScan === 'boolean' ? parsed.fxRowScan : true,
      tokenShowLogo: typeof parsed.tokenShowLogo === 'boolean' ? parsed.tokenShowLogo : true,

      colorGradingEnabled:
        typeof parsed.colorGradingEnabled === 'boolean' ? parsed.colorGradingEnabled : false,
      activePresetId:
        typeof parsed.activePresetId === 'string' && parsed.activePresetId.trim()
          ? parsed.activePresetId
          : 'default',
      bgColor: isValidHexColor(parsed.bgColor) ? parsed.bgColor : DEFAULT_UI_SETTINGS.bgColor,
      cardColor: isValidHexColor(parsed.cardColor)
        ? parsed.cardColor
        : DEFAULT_UI_SETTINGS.cardColor,
      accentColor: isValidHexColor(parsed.accentColor)
        ? parsed.accentColor
        : DEFAULT_UI_SETTINGS.accentColor,
      textColor: isValidHexColor(parsed.textColor)
        ? parsed.textColor
        : DEFAULT_UI_SETTINGS.textColor,
      customColorPresets: normalizeCustomPresets(parsed.customColorPresets),

      tokenSealVisible:
        typeof parsed.tokenSealVisible === 'boolean' ? parsed.tokenSealVisible : true,
      tokenSealMainText:
        typeof parsed.tokenSealMainText === 'string'
          ? parsed.tokenSealMainText
          : DEFAULT_UI_SETTINGS.tokenSealMainText,
      tokenSealSubText:
        typeof parsed.tokenSealSubText === 'string'
          ? parsed.tokenSealSubText
          : DEFAULT_UI_SETTINGS.tokenSealSubText,
      tokenSealColor: isValidHexColor(parsed.tokenSealColor)
        ? parsed.tokenSealColor
        : DEFAULT_UI_SETTINGS.tokenSealColor,
      tokenSealShape:
        parsed.tokenSealShape === 'circle' || parsed.tokenSealShape === 'rect'
          ? parsed.tokenSealShape
          : 'rect',
      tokenSealImageDataUrl:
        typeof parsed.tokenSealImageDataUrl === 'string' ? parsed.tokenSealImageDataUrl : '',
    };
  } catch {
    return { ...DEFAULT_UI_SETTINGS };
  }
}

export function saveUiSettings(settings: UiAppearanceSettings): boolean {
  try {
    localStorage.setItem(UI_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    if (settings.logoDataUrl) {
      localStorage.setItem(LEGACY_LOGO_STORAGE_KEY, settings.logoDataUrl);
    } else {
      localStorage.removeItem(LEGACY_LOGO_STORAGE_KEY);
    }
    return true;
  } catch {
    return false;
  }
}

function parseHexRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return [16, 185, 129];
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  return [r, g, b];
}

function hexToRgba(hex: string, alpha: number): string {
  const [r, g, b] = parseHexRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function shiftHexLuminance(hex: string, delta: number): string {
  const [r, g, b] = parseHexRgb(hex);
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const nr = clamp(r + delta);
  const ng = clamp(g + delta);
  const nb = clamp(b + delta);
  return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
}

function isLightColor(hex: string): boolean {
  const [r, g, b] = parseHexRgb(hex);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55;
}

const CUSTOM_CSS_VAR_KEYS = [
  '--cg-bg-deep',
  '--cg-bg-card',
  '--cg-bg-elevated',
  '--cg-border',
  '--cg-primary',
  '--cg-primary-soft',
  '--cg-custom-text',
  '--cg-custom-muted',
  '--cg-accent-contrast',
  '--cg-highlight',
  '--accent',
  '--accent-dark',
  '--accent-soft',
  '--accent-glow',
];

export function applyUiSettingsToDocument(settings: UiAppearanceSettings): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.setProperty('--font-body', settings.fontFamily);
  root.style.setProperty('--font-display', settings.fontFamily);
  root.style.setProperty('--font-scale', (settings.fontScale / 100).toFixed(2));

  document.body.classList.remove(
    'theme-navy',
    'theme-flame',
    'custom-color-grade',
    'custom-color-light',
    'custom-color-dark'
  );
  if (settings.accentTheme === 'navy') document.body.classList.add('theme-navy');
  if (settings.accentTheme === 'flame') document.body.classList.add('theme-flame');
  document.body.classList.toggle('no-animations', !settings.animationsEnabled);
  document.body.classList.toggle('fx-off-aurora', !settings.fxAuroraSweep);
  document.body.classList.toggle('fx-off-bento', !settings.fxBentoSpring);
  document.body.classList.toggle('fx-off-counter', !settings.fxKineticCounter);
  document.body.classList.toggle('fx-off-spotlight', !settings.fxSpotlight);
  document.body.classList.toggle('fx-off-rowscan', !settings.fxRowScan);

  if (settings.colorGradingEnabled) {
    const lightBg = isLightColor(settings.bgColor);
    const lightAccent = isLightColor(settings.accentColor);
    document.body.classList.add(
      'custom-color-grade',
      lightBg ? 'custom-color-light' : 'custom-color-dark'
    );
    root.style.setProperty('--cg-bg-deep', settings.bgColor);
    root.style.setProperty('--cg-bg-card', settings.cardColor);
    root.style.setProperty(
      '--cg-bg-elevated',
      shiftHexLuminance(settings.cardColor, lightBg ? -10 : 12)
    );
    root.style.setProperty(
      '--cg-border',
      lightBg ? 'rgba(15, 23, 42, 0.14)' : 'rgba(148, 163, 184, 0.22)'
    );
    root.style.setProperty('--cg-custom-text', settings.textColor);
    root.style.setProperty(
      '--cg-custom-muted',
      hexToRgba(settings.textColor, lightBg ? 0.65 : 0.7)
    );
    root.style.setProperty('--accent', settings.accentColor);
    root.style.setProperty('--accent-dark', shiftHexLuminance(settings.accentColor, -22));
    root.style.setProperty('--accent-soft', hexToRgba(settings.accentColor, 0.16));
    root.style.setProperty('--accent-glow', hexToRgba(settings.accentColor, 0.3));
    root.style.setProperty('--cg-primary', settings.accentColor);
    root.style.setProperty('--cg-primary-soft', hexToRgba(settings.accentColor, 0.16));
    root.style.setProperty('--cg-accent-contrast', lightAccent ? '#090d16' : '#ffffff');
    root.style.setProperty(
      '--cg-highlight',
      shiftHexLuminance(settings.accentColor, lightBg ? -16 : 36)
    );
  } else {
    CUSTOM_CSS_VAR_KEYS.forEach((key) => root.style.removeProperty(key));
  }
}

export async function compressImageToDataUrl(
  file: File,
  maxDim = 260,
  quality = 0.88
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Invalid image file.'));
        return;
      }
      const img = new Image();
      img.onerror = () => reject(new Error('Could not decode image.'));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(reader.result as string);
          return;
        }
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const preferPng = file.type === 'image/png' || file.type === 'image/svg+xml';
        resolve(
          preferPng
            ? canvas.toDataURL('image/png')
            : canvas.toDataURL('image/webp', quality)
        );
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
