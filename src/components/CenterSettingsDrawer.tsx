import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  Check,
  ImagePlus,
  Palette,
  RotateCcw,
  Save,
  Settings,
  Trash2,
  Type,
  X,
} from 'lucide-react';
import {
  BUILTIN_COLOR_GRADING_PRESETS,
  DEFAULT_UI_SETTINGS,
  FONT_FAMILY_OPTIONS,
  type AccentTheme,
  type ColorGradingPreset,
  type UiAppearanceSettings,
} from '../lib/appearance';
import type { Lang } from '../types';
import { SyncedRoundLogo } from './SyncedRoundLogo';

type DrawerTabKey = 'branding' | 'typography' | 'appearance';

interface CenterSettingsDrawerProps {
  open: boolean;
  lang: Lang;
  settings: UiAppearanceSettings;
  onChange: (next: UiAppearanceSettings) => void;
  onSave: (next: UiAppearanceSettings) => boolean;
  onResetAll: () => void;
  onClose: () => void;
}

export function CenterSettingsDrawer({
  open,
  lang,
  settings,
  onChange,
  onSave,
  onResetAll,
  onClose,
}: CenterSettingsDrawerProps) {
  const bn = lang === 'bn';
  const [activeTab, setActiveTab] = useState<DrawerTabKey>('appearance');
  const [logoError, setLogoError] = useState<string | null>(null);
  const [presetNameInput, setPresetNameInput] = useState('');
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => {
      setToastMsg((prev) => (prev === msg ? null : prev));
    }, 2400);
  };

  const handleUploadLogo = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setLogoError(
        bn
          ? 'দয়া করে বৈধ ইমেজ ফাইল (PNG, JPG, WEBP) নির্বাচন করুন।'
          : 'Please choose a valid image file (PNG, JPG, WEBP).'
      );
      e.target.value = '';
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setLogoError(
        bn
          ? '২ মেগাবাইটের কম ইমেজ দিলে নিরাপদে সেভ হবে।'
          : 'Keep logo file under 2MB for safe storage.'
      );
    } else {
      setLogoError(null);
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') return;
      const next: UiAppearanceSettings = {
        ...settings,
        logoDataUrl: reader.result,
      };
      onChange(next);
      const savedOk = onSave(next);
      if (!savedOk) {
        setLogoError(
          bn
            ? 'ইমেজটি ব্রাউজারের স্টোরেজ সীমার চেয়ে বড় — ছোট ইমেজ চেষ্টা করুন।'
            : 'Image exceeds browser storage limit — try a smaller file.'
        );
      } else {
        showToast(bn ? 'লোগো সিঙ্ক ও সেভ হয়েছে!' : 'Logo synced across Sidebar, Hero & Token!');
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleResetLogo = () => {
    setLogoError(null);
    const next: UiAppearanceSettings = {
      ...settings,
      logoDataUrl: '',
    };
    onChange(next);
    onSave(next);
    showToast(bn ? 'ডিফল্ট IT লোগো রিস্টোর হয়েছে!' : 'Restored default IT logo!');
  };

  const handleSaveClick = () => {
    onSave(settings);
    showToast(bn ? 'সেটিংস সংরক্ষিত ও প্রয়োগ হয়েছে!' : 'Settings saved & applied!');
  };

  const handleResetAllClick = () => {
    setLogoError(null);
    onResetAll();
    showToast(bn ? 'সব সেটিংস রিসেট হয়েছে!' : 'All appearance settings reset!');
  };

  const tabs: Array<{ key: DrawerTabKey; en: string; bn: string }> = [
    { key: 'appearance', en: 'Color & Motion', bn: 'কালার ও মোশন' },
    { key: 'typography', en: 'Fonts & Size', bn: 'ফন্ট ও সাইজ' },
    { key: 'branding', en: 'Logo & Graphics', bn: 'লোগো ও গ্রাফিক্স' },
  ];

  return (
    <>
      {/* Mobile-only transparent tap-to-close backdrop (no blur or dimming on desktop so live changes stay sharp & interactive) */}
      <div
        aria-hidden={!open}
        onClick={onClose}
        className={`fixed inset-0 z-[900] bg-slate-950/20 lg:hidden transition-opacity duration-200 print:hidden ${
          open ? 'opacity-100 visible' : 'opacity-0 invisible pointer-events-none'
        }`}
      />

      {/* Slide-over Drawer */}
      <aside
        aria-label="Center Settings"
        className={`fixed top-0 right-0 z-[1000] h-screen w-[min(420px,95vw)] bg-white dark:bg-[#0b1220] border-l border-slate-200 dark:border-slate-400/25 shadow-[-12px_0_32px_rgba(0,0,0,0.22)] dark:shadow-[-14px_0_38px_rgba(0,0,0,0.65)] flex flex-col transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] print:hidden ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-400/15 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-8 h-8 rounded-lg bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center shrink-0">
              <Settings className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <h3 className="font-display text-[15px] font-extrabold text-slate-900 dark:text-white truncate">
                {bn ? 'সেন্টার সেটিংস (Live)' : 'Center Settings'}
              </h3>
              <p className="text-[11.5px] text-slate-500 dark:text-slate-400 truncate">
                {bn
                  ? 'পরিবর্তনগুলো ড্যাশবোর্ড ও টোকেন প্রিন্টে সরাসরি কাজ করে'
                  : 'Changes apply live across the dashboard & token print'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Center Settings"
            className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-white/[0.06] border border-slate-200 dark:border-slate-400/15 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-white/[0.12] flex items-center justify-center cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-slate-200 dark:border-slate-400/15 bg-slate-50 dark:bg-[#060a12]/60 overflow-x-auto">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`px-3 py-1.5 rounded-lg text-[11.5px] font-bold border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  isActive
                    ? 'bg-[var(--accent-soft)] border-[var(--accent)]/45 text-[var(--accent-dark)] dark:text-[var(--accent)]'
                    : 'bg-transparent border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {bn ? tab.bn : tab.en}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {activeTab === 'branding' && (
            <>
              <div className="rounded-xl bg-slate-50/80 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-400/15 p-4 space-y-3">
                <div>
                  <label className="block text-xs font-bold text-slate-800 dark:text-slate-100 mb-1">
                    {bn
                      ? 'সিঙ্ক করা গোল লোগো (সাইডবার, ব্যানার ও টোকেন)'
                      : 'Synced Round Logo (Sidebar & Banner)'}
                  </label>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                    {bn
                      ? 'লোগো আপলোড করলে সাইডবার, ড্যাশবোর্ড ব্যানার ও টোকেন প্রিন্ট—সব জায়গায় একসাথে আপডেট হবে।'
                      : 'Uploading a logo updates both round logos together and applies to your token print.'}
                  </p>
                </div>

                <div className="flex items-center gap-3.5">
                  <SyncedRoundLogo size={56} logoDataUrl={settings.logoDataUrl} alt="Logo Preview" />
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleUploadLogo}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-dark)] text-[#042019] text-xs font-bold cursor-pointer transition-colors"
                    >
                      <ImagePlus className="w-3.5 h-3.5" />
                      <span>{bn ? 'লোগো আপলোড' : 'Upload Logo'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleResetLogo}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white dark:bg-white/[0.05] border border-slate-200 dark:border-slate-400/20 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.1] text-xs font-bold cursor-pointer transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>{bn ? 'রিসেট' : 'Reset'}</span>
                    </button>
                  </div>
                </div>

                {logoError && (
                  <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                    {logoError}
                  </p>
                )}
              </div>

              <div className="rounded-xl bg-slate-50/80 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-400/15 p-4 space-y-3">
                <div>
                  <label
                    htmlFor="drawerInstituteTitle"
                    className="block text-xs font-bold text-slate-800 dark:text-slate-100 mb-1.5"
                  >
                    {bn ? 'ড্যাশবোর্ড শিরোনাম (Institute Title)' : 'Institute Title'}
                  </label>
                  <input
                    id="drawerInstituteTitle"
                    type="text"
                    value={settings.instituteTitle}
                    onChange={(e) =>
                      onChange({
                        ...settings,
                        instituteTitle: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg bg-white dark:bg-[#080d17] border border-slate-200 dark:border-slate-400/25 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="drawerInstituteSub"
                    className="block text-xs font-bold text-slate-800 dark:text-slate-100 mb-1.5"
                  >
                    {bn ? 'প্রতিষ্ঠানের উপ-শিরোনাম (Subtitle)' : 'Institute Subtitle'}
                  </label>
                  <input
                    id="drawerInstituteSub"
                    type="text"
                    value={settings.instituteSub}
                    onChange={(e) =>
                      onChange({
                        ...settings,
                        instituteSub: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg bg-white dark:bg-[#080d17] border border-slate-200 dark:border-slate-400/25 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>
              </div>
            </>
          )}

          {activeTab === 'typography' && (
            <>
              <div className="rounded-xl bg-slate-50/80 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-400/15 p-4 space-y-2.5">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-100">
                  <Type className="w-3.5 h-3.5 text-[var(--accent)]" />
                  <label htmlFor="drawerFontFamily">
                    {bn ? 'ফন্ট ফ্যামিলি (ইংরেজি ও বাংলা)' : 'Font Family (English & Bangla)'}
                  </label>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {bn
                    ? 'হেডিং এবং ড্যাশবোর্ডের লেখার জন্য পছন্দের ফন্ট নির্বাচন করুন।'
                    : 'Select your preferred font for headings and dashboard text.'}
                </p>
                <select
                  id="drawerFontFamily"
                  value={settings.fontFamily}
                  onChange={(e) =>
                    onChange({
                      ...settings,
                      fontFamily: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 rounded-lg bg-white dark:bg-[#080d17] border border-slate-200 dark:border-slate-400/25 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-[var(--accent)]"
                >
                  {FONT_FAMILY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="rounded-xl bg-slate-50/80 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-400/15 p-4 space-y-2.5">
                <label className="block text-xs font-bold text-slate-800 dark:text-slate-100">
                  {bn ? 'গ্লোবাল ফন্ট সাইজ স্কেল' : 'Global Font Size Scale'}
                </label>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {bn
                    ? 'পুরো সফটওয়্যারের লেখার আকার ছোট বা বড় করুন।'
                    : 'Adjust overall text size smoothly across the software.'}
                </p>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={85}
                    max={120}
                    step={5}
                    value={settings.fontScale}
                    onChange={(e) =>
                      onChange({
                        ...settings,
                        fontScale: Number(e.target.value),
                      })
                    }
                    className="flex-1 accent-[var(--accent)] cursor-pointer"
                  />
                  <span className="font-mono-num text-xs font-bold text-[var(--accent-dark)] dark:text-[var(--accent)] min-w-[44px] text-right">
                    {settings.fontScale}%
                  </span>
                </div>
              </div>
            </>
          )}

          {activeTab === 'appearance' && (
            <>
              {/* Quick Accent Theme */}
              <div className="rounded-xl bg-slate-50/80 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-400/15 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-100">
                    <Palette className="w-3.5 h-3.5 text-[var(--accent)]" />
                    <label htmlFor="drawerAccentPreset">
                      {bn
                        ? 'কালার গ্রেডিং ও থিম (Color Grading)'
                        : 'Color Grading & Theme'}
                    </label>
                  </div>
                  <div className="flex items-center gap-1.5" aria-hidden="true">
                    <span
                      className="w-3.5 h-3.5 rounded-full border border-white/30"
                      style={{ backgroundColor: 'var(--cg-primary)' }}
                      title="Primary"
                    />
                    <span
                      className="w-3.5 h-3.5 rounded-full border border-white/30"
                      style={{ backgroundColor: 'var(--cg-highlight)' }}
                      title="Highlight"
                    />
                    <span
                      className="w-3.5 h-3.5 rounded-full border border-white/30"
                      style={{ backgroundColor: 'var(--cg-warning)' }}
                      title="Warning"
                    />
                  </div>
                </div>

                {/* Preset Pills */}
                <div className="flex flex-wrap gap-1.5">
                  {[...BUILTIN_COLOR_GRADING_PRESETS, ...settings.customColorPresets].map(
                    (preset) => {
                      const isActive =
                        preset.id === 'default'
                          ? !settings.colorGradingEnabled
                          : settings.colorGradingEnabled && settings.activePresetId === preset.id;
                      return (
                        <div key={preset.id} className="inline-flex items-center">
                          <button
                            type="button"
                            onClick={() => {
                              const next: UiAppearanceSettings = {
                                ...settings,
                                colorGradingEnabled: preset.id !== 'default',
                                activePresetId: preset.id,
                                bgColor: preset.bgColor,
                                cardColor: preset.cardColor,
                                accentColor: preset.accentColor,
                                textColor: preset.textColor,
                              };
                              onChange(next);
                              onSave(next);
                              showToast(
                                bn
                                  ? `${preset.name} প্রয়োগ হয়েছে!`
                                  : `Applied ${preset.name}!`
                              );
                            }}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors cursor-pointer ${
                              isActive
                                ? 'bg-[var(--accent)] border-[var(--accent)] text-[#042019]'
                                : 'bg-white dark:bg-[#080d17] border-slate-200 dark:border-slate-400/25 text-slate-700 dark:text-slate-200 hover:border-[var(--accent)]'
                            } ${!preset.builtin ? 'rounded-r-none border-r-0' : ''}`}
                          >
                            <span
                              className="w-2.5 h-2.5 rounded-full border border-black/20"
                              style={{ backgroundColor: preset.accentColor }}
                            />
                            <span>{preset.name}</span>
                          </button>
                          {!preset.builtin && (
                            <button
                              type="button"
                              onClick={() => {
                                const filtered = settings.customColorPresets.filter(
                                  (p) => p.id !== preset.id
                                );
                                const next: UiAppearanceSettings = {
                                  ...settings,
                                  customColorPresets: filtered,
                                  ...(settings.activePresetId === preset.id
                                    ? { colorGradingEnabled: false, activePresetId: 'default' }
                                    : {}),
                                };
                                onChange(next);
                                onSave(next);
                              }}
                              aria-label="Delete preset"
                              className="px-1.5 py-1 rounded-r-lg border border-slate-200 dark:border-slate-400/25 bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-red-500 cursor-pointer"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      );
                    }
                  )}
                </div>

                {/* 4 Live Pickers */}
                <div className="grid grid-cols-2 gap-2 pt-1">
                  {[
                    {
                      key: 'bgColor' as const,
                      label: bn ? 'ব্যাকগ্রাউন্ড' : 'Background',
                      val: settings.bgColor,
                    },
                    {
                      key: 'cardColor' as const,
                      label: bn ? 'কার্ড / প্যানেল' : 'Card Color',
                      val: settings.cardColor,
                    },
                    {
                      key: 'accentColor' as const,
                      label: bn ? 'অ্যাক্সেন্ট রঙ' : 'Accent Color',
                      val: settings.accentColor,
                    },
                    {
                      key: 'textColor' as const,
                      label: bn ? 'টেক্সট রঙ' : 'Text Color',
                      val: settings.textColor,
                    },
                  ].map((cp) => (
                    <label
                      key={cp.key}
                      className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#080d17] border border-slate-200 dark:border-slate-400/20 cursor-pointer"
                    >
                      <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-200 truncate">
                        {cp.label}
                      </span>
                      <input
                        type="color"
                        value={cp.val}
                        onChange={(e) =>
                          onChange({
                            ...settings,
                            colorGradingEnabled: true,
                            activePresetId: 'custom-live',
                            [cp.key]: e.target.value,
                          })
                        }
                        className="w-7 h-5 border-0 bg-transparent cursor-pointer shrink-0"
                      />
                    </label>
                  ))}
                </div>

                {/* Save Custom Preset */}
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={presetNameInput}
                    onChange={(e) => setPresetNameInput(e.target.value)}
                    placeholder={bn ? 'কাস্টম প্রিসেটের নাম...' : 'Preset name...'}
                    className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#080d17] border border-slate-200 dark:border-slate-400/25 text-[11px] text-slate-900 dark:text-white focus:outline-none focus:border-[var(--accent)]"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const clean = presetNameInput.trim();
                      if (!clean) return;
                      const created: ColorGradingPreset = {
                        id: `custom_${Date.now()}`,
                        name: clean,
                        bgColor: settings.bgColor,
                        cardColor: settings.cardColor,
                        accentColor: settings.accentColor,
                        textColor: settings.textColor,
                        builtin: false,
                      };
                      const next: UiAppearanceSettings = {
                        ...settings,
                        colorGradingEnabled: true,
                        activePresetId: created.id,
                        customColorPresets: [...settings.customColorPresets, created],
                      };
                      onChange(next);
                      onSave(next);
                      setPresetNameInput('');
                      showToast(
                        bn ? `প্রিসেট "${clean}" সেভ হয়েছে!` : `Saved preset "${clean}"!`
                      );
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-dark)] text-[#042019] text-[11px] font-bold cursor-pointer whitespace-nowrap"
                  >
                    {bn ? 'সেভ প্রিসেট' : 'Save Preset'}
                  </button>
                </div>

                {/* Fallback Base Accent Select when Custom Grading is Off */}
                {!settings.colorGradingEnabled && (
                  <select
                    id="drawerAccentPreset"
                    value={settings.accentTheme}
                    onChange={(e) =>
                      onChange({
                        ...settings,
                        accentTheme: e.target.value as AccentTheme,
                      })
                    }
                    className="w-full px-3 py-1.5 rounded-lg bg-white dark:bg-[#080d17] border border-slate-200 dark:border-slate-400/25 text-[11.5px] text-slate-900 dark:text-white focus:outline-none focus:border-[var(--accent)]"
                  >
                    <option value="emerald">
                      {bn ? 'এমারেল্ড ও ডিপ নেভি (ডিফল্ট)' : 'Emerald & Deep Navy (Default)'}
                    </option>
                    <option value="navy">
                      {bn ? 'গোল্ডেন ইয়েলো ও ডার্ক' : 'Golden Yellow & Dark'}
                    </option>
                    <option value="flame">
                      {bn ? 'ফ্লেম অরেঞ্জ ও ডার্ক' : 'Flame Orange & Dark'}
                    </option>
                  </select>
                )}
              </div>

              <div className="rounded-xl bg-slate-50/80 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-400/15 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-bold text-slate-800 dark:text-slate-100">
                      {bn
                        ? '৫টি অ্যানিমেশন ও মোশন গ্রাফিক্স'
                        : '5 Motion & Graphics Effects'}
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {bn
                        ? 'প্রতিটি এফেক্ট আলাদাভাবে চালু বা বন্ধ করুন'
                        : 'Toggle each visual & motion effect live'}
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    aria-label="Toggle all animations"
                    checked={settings.animationsEnabled}
                    onChange={(e) => {
                      const enabled = e.target.checked;
                      onChange({
                        ...settings,
                        animationsEnabled: enabled,
                        fxAuroraSweep: enabled,
                        fxBentoSpring: enabled,
                        fxKineticCounter: enabled,
                        fxSpotlight: enabled,
                        fxRowScan: enabled,
                      });
                    }}
                    className="w-4 h-4 accent-[var(--accent)] cursor-pointer shrink-0"
                  />
                </div>

                <div className="space-y-2 pt-2 border-t border-slate-200/80 dark:border-slate-400/15">
                  {[
                    {
                      key: 'fxAuroraSweep' as const,
                      title: bn
                        ? '১. অরোরা মেশ ও লাইট সুইপ'
                        : '1. Aurora Mesh & Light Sweep',
                      desc: bn
                        ? 'হিরো ব্যানার গ্লো ও বাটন শিমার বিম'
                        : 'Hero ambient drift & CTA sweep beam',
                    },
                    {
                      key: 'fxBentoSpring' as const,
                      title: bn
                        ? '২. স্ট্যাগার্ড বেন্টো ও স্প্রিং লিফট'
                        : '2. Bento Reveal & Spring Lift',
                      desc: bn
                        ? 'কার্ড ধাপে ধাপে ওঠা ও হোভার লিফট'
                        : 'Staggered card entrance & spring hover',
                    },
                    {
                      key: 'fxKineticCounter' as const,
                      title: bn
                        ? '৩. কাইনেটিক কাউন্টার (সংখ্যা)'
                        : '3. Kinetic Counter',
                      desc: bn
                        ? 'ড্যাশবোর্ড ও হিসাবের সংখ্যা গণনা'
                        : 'Animated cubic count-up on metrics',
                    },
                    {
                      key: 'fxSpotlight' as const,
                      title: bn
                        ? '৪. ম্যাগনেটিক স্পটলাইট'
                        : '4. Magnetic Spotlight',
                      desc: bn
                        ? 'মাউস ঘোরালে কার্ডে আলোর গ্লো'
                        : 'Cursor-tracking radial spotlight glow',
                    },
                    {
                      key: 'fxRowScan' as const,
                      title: bn
                        ? '৫. রো হাইলাইট স্ক্যান'
                        : '5. Row Highlight Scan',
                      desc: bn
                        ? 'টেবিল সারিতে মসৃণ হোভার হাইলাইট'
                        : 'Smooth emerald hover scan on tables',
                    },
                  ].map((fx) => (
                    <label
                      key={fx.key}
                      className="flex items-center justify-between gap-3 px-2.5 py-2 rounded-lg bg-white/80 dark:bg-[#080d17]/75 border border-slate-200/80 dark:border-slate-400/15 cursor-pointer hover:border-[var(--accent)]/40 transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="text-[11.5px] font-bold text-slate-800 dark:text-slate-100 truncate">
                          {fx.title}
                        </div>
                        <div className="text-[10.5px] text-slate-500 dark:text-slate-400 truncate">
                          {fx.desc}
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={settings.animationsEnabled && settings[fx.key]}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          const next: UiAppearanceSettings = {
                            ...settings,
                            [fx.key]: checked,
                            animationsEnabled: checked ? true : settings.animationsEnabled,
                          };
                          onChange(next);
                        }}
                        className="w-4 h-4 accent-[var(--accent)] cursor-pointer shrink-0"
                      />
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-400/15 bg-slate-50 dark:bg-[#080d17] flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleResetAllClick}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white dark:bg-white/[0.05] border border-slate-200 dark:border-slate-400/20 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.1] cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{bn ? 'সব রিসেট' : 'Reset All'}</span>
          </button>

          <button
            type="button"
            onClick={handleSaveClick}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-dark)] text-[#042019] text-xs font-extrabold shadow-[0_8px_20px_-8px_var(--accent-glow)] cursor-pointer transition-colors"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{bn ? 'সেটিংস সেভ করুন' : 'Save Settings'}</span>
          </button>
        </div>
      </aside>

      {/* Live Toast */}
      {toastMsg && (
        <div
          role="status"
          className="fixed bottom-5 right-5 z-[1200] inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-950/95 border border-[var(--accent)] text-emerald-50 text-xs font-bold shadow-lg print:hidden"
        >
          <Check className="w-4 h-4 text-[var(--accent)] shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}
    </>
  );
}

export { DEFAULT_UI_SETTINGS };
