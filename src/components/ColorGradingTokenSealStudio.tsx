import { useRef, useState, type ChangeEvent } from 'react';
import {
  Check,
  ImagePlus,
  Palette,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  Type,
} from 'lucide-react';
import {
  BUILTIN_COLOR_GRADING_PRESETS,
  compressImageToDataUrl,
  DEFAULT_UI_SETTINGS,
  FONT_FAMILY_OPTIONS,
  type AccentTheme,
  type ColorGradingPreset,
  type UiAppearanceSettings,
} from '../lib/appearance';
import type { Lang, ThemeMode } from '../types';
import { SyncedRoundLogo } from './SyncedRoundLogo';

interface ColorGradingTokenSealStudioProps {
  lang: Lang;
  theme: ThemeMode;
  onSetTheme: (t: ThemeMode) => void;
  settings: UiAppearanceSettings;
  onChange: (next: UiAppearanceSettings) => void;
  onSave: (next: UiAppearanceSettings) => boolean;
  onResetAll?: () => void;
  onNotify?: (msg: string) => void;
}

export function ColorGradingTokenSealStudio({
  lang,
  theme,
  onSetTheme,
  settings,
  onChange,
  onSave,
  onResetAll,
  onNotify,
}: ColorGradingTokenSealStudioProps) {
  const bn = lang === 'bn';
  const [presetNameInput, setPresetNameInput] = useState('');
  const [logoError, setLogoError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);
  const logoInputRef = useRef<HTMLInputElement | null>(null);

  const allPresets: ColorGradingPreset[] = [
    ...BUILTIN_COLOR_GRADING_PRESETS,
    ...settings.customColorPresets,
  ];

  const notify = (msg: string) => {
    if (onNotify) onNotify(msg);
  };

  const handleApplyPreset = (preset: ColorGradingPreset) => {
    const isDefaultAuto = preset.id === 'default';
    const next: UiAppearanceSettings = {
      ...settings,
      colorGradingEnabled: !isDefaultAuto,
      activePresetId: preset.id,
      bgColor: preset.bgColor,
      cardColor: preset.cardColor,
      accentColor: preset.accentColor,
      textColor: preset.textColor,
    };
    onChange(next);
    onSave(next);
    notify(
      bn
        ? `${preset.name} কালার গ্রেডিং প্রয়োগ হয়েছে`
        : `Applied "${preset.name}" color grading`
    );
  };

  const handleColorPick = (
    key: 'bgColor' | 'cardColor' | 'accentColor' | 'textColor',
    value: string
  ) => {
    const next: UiAppearanceSettings = {
      ...settings,
      colorGradingEnabled: true,
      activePresetId: 'custom-live',
      [key]: value,
    };
    onChange(next);
  };

  const handleSaveCustomPreset = () => {
    const cleanName = presetNameInput.trim();
    if (!cleanName) {
      notify(bn ? 'প্রিসেটের নাম লিখুন!' : 'Enter a custom preset name first.');
      return;
    }
    const newPreset: ColorGradingPreset = {
      id: `custom_${Date.now()}`,
      name: cleanName,
      bgColor: settings.bgColor,
      cardColor: settings.cardColor,
      accentColor: settings.accentColor,
      textColor: settings.textColor,
      builtin: false,
    };
    const next: UiAppearanceSettings = {
      ...settings,
      colorGradingEnabled: true,
      activePresetId: newPreset.id,
      customColorPresets: [...settings.customColorPresets, newPreset],
    };
    onChange(next);
    onSave(next);
    setPresetNameInput('');
    notify(
      bn
        ? `কাস্টম প্রিসেট "${cleanName}" সংরক্ষিত হয়েছে!`
        : `Custom preset "${cleanName}" saved!`
    );
  };

  const handleDeleteCustomPreset = (presetId: string) => {
    const filtered = settings.customColorPresets.filter((p) => p.id !== presetId);
    const isDeletedActive = settings.activePresetId === presetId;
    const next: UiAppearanceSettings = {
      ...settings,
      customColorPresets: filtered,
      ...(isDeletedActive
        ? {
            colorGradingEnabled: false,
            activePresetId: 'default',
          }
        : {}),
    };
    onChange(next);
    onSave(next);
  };

  const handleUploadLogo = async (e: ChangeEvent<HTMLInputElement>) => {
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
    setLogoError(null);
    try {
      const dataUrl = await compressImageToDataUrl(file, 280, 0.9);
      const next: UiAppearanceSettings = {
        ...settings,
        logoDataUrl: dataUrl,
      };
      onChange(next);
      const ok = onSave(next);
      if (!ok) {
        setLogoError(
          bn
            ? 'ইমেজটি ব্রাউজারের স্টোরেজ সীমার চেয়ে বড় — ছোট ইমেজ দিন।'
            : 'Image exceeds browser storage limit — try a smaller file.'
        );
      } else {
        notify(bn ? 'লোগো আপডেট ও সেভ হয়েছে!' : 'Center logo updated & saved!');
      }
    } catch {
      setLogoError(bn ? 'ইমেজ পড়া যায়নি।' : 'Could not load logo image.');
    } finally {
      e.target.value = '';
    }
  };

  const handleResetDefaults = () => {
    setLogoError(null);
    if (onResetAll) {
      onResetAll();
    } else {
      const next: UiAppearanceSettings = {
        ...DEFAULT_UI_SETTINGS,
        customColorPresets: settings.customColorPresets,
      };
      onChange(next);
      onSave(next);
    }
    notify(
      bn
        ? 'কালার, অ্যানিমেশন ও গ্রাফিক্স ডিফল্ট অবস্থায় রিসেট হয়েছে!'
        : 'Colors, animations & graphics reset to default!'
    );
  };

  const handleSaveAll = () => {
    onSave(settings);
    setSavedNotice(true);
    window.setTimeout(() => setSavedNotice(false), 2000);
    notify(
      bn
        ? 'কালার, অ্যানিমেশন ও গ্রাফিক্স সেটিংস সংরক্ষিত হয়েছে!'
        : 'Color, animation & graphics settings saved!'
    );
  };

  const motionItems = [
    {
      key: 'fxAuroraSweep' as const,
      title: bn ? '১. অরোরা মেশ ও লাইট সুইপ' : '1. Aurora Mesh & Light Sweep',
      desc: bn
        ? 'হিরো ব্যানার গ্লো ও বাটন শিমার বিম'
        : 'Hero ambient drift & CTA sweep beam',
    },
    {
      key: 'fxBentoSpring' as const,
      title: bn ? '২. স্ট্যাগার্ড বেন্টো ও স্প্রিং লিফট' : '2. Bento Reveal & Spring Lift',
      desc: bn
        ? 'কার্ড ধাপে ধাপে ওঠা ও হোভার লিফট'
        : 'Staggered card entrance & spring hover',
    },
    {
      key: 'fxKineticCounter' as const,
      title: bn ? '৩. কাইনেটিক কাউন্টার (সংখ্যা)' : '3. Kinetic Counter',
      desc: bn
        ? 'ড্যাশবোর্ড ও হিসাবের সংখ্যা গণনা'
        : 'Animated cubic count-up on metrics',
    },
    {
      key: 'fxSpotlight' as const,
      title: bn ? '৪. ম্যাগনেটিক স্পটলাইট' : '4. Magnetic Spotlight',
      desc: bn
        ? 'মাউস ঘোরালে কার্ডে আলোর গ্লো'
        : 'Cursor-tracking radial spotlight glow',
    },
    {
      key: 'fxRowScan' as const,
      title: bn ? '৫. রো হাইলাইট স্ক্যান' : '5. Row Highlight Scan',
      desc: bn
        ? 'টেবিল সারিতে মসৃণ হোভার হাইলাইট'
        : 'Smooth hover highlight scan on tables',
    },
  ];

  return (
    <div className="space-y-4">
      {/* 1. Color Grading & Display Theme Panel */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <span className="p-2.5 rounded-xl bg-[var(--accent-soft)] text-[var(--accent)] shrink-0">
              <Palette className="w-5 h-5" />
            </span>
            <div>
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                {bn ? 'কালার গ্রেডিং ও থিম' : 'Color Grading & Theme'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {bn
                  ? 'সফটওয়্যারের রঙ, ডার্ক/লাইট মোড এবং কাস্টম কালার প্রিসেট পরিচালনা করুন'
                  : 'Configure color grading presets, live palette pickers, and light/dark mode'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={theme}
              onChange={(e) => onSetTheme(e.target.value as ThemeMode)}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 cursor-pointer"
            >
              <option value="light">{bn ? 'লাইট থিম' : 'Light Mode'}</option>
              <option value="dark">{bn ? 'ডার্ক থিম' : 'Dark Mode'}</option>
            </select>
            <span
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border ${
                settings.colorGradingEnabled
                  ? 'bg-[var(--accent-soft)] border-[var(--accent)]/40 text-[var(--accent)]'
                  : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
              }`}
            >
              {settings.colorGradingEnabled
                ? bn
                  ? 'কাস্টম গ্রেডিং সক্রিয়'
                  : 'Custom Grading Active'
                : bn
                  ? 'স্ট্যান্ডার্ড থিম'
                  : 'Standard Mode'}
            </span>
          </div>
        </div>

        {/* Presets */}
        <div className="space-y-2">
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
            {bn ? 'কালার গ্রেডিং প্রিসেট (Presets)' : 'Color Grading Presets'}
          </label>
          <div className="flex flex-wrap gap-2">
            {allPresets.map((preset) => {
              const isActive =
                preset.id === 'default'
                  ? !settings.colorGradingEnabled
                  : settings.colorGradingEnabled && settings.activePresetId === preset.id;
              return (
                <div key={preset.id} className="inline-flex items-center">
                  <button
                    type="button"
                    onClick={() => handleApplyPreset(preset)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                      isActive
                        ? 'bg-[var(--accent)] border-[var(--accent)] text-[#042019]'
                        : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-[var(--accent)]'
                    } ${!preset.builtin ? 'rounded-r-none border-r-0' : ''}`}
                  >
                    <span
                      className="w-3 h-3 rounded-full border border-black/20 shrink-0"
                      style={{ backgroundColor: preset.accentColor }}
                    />
                    <span>{preset.name}</span>
                  </button>
                  {!preset.builtin && (
                    <button
                      type="button"
                      onClick={() => handleDeleteCustomPreset(preset.id)}
                      title={bn ? 'প্রিসেট মুছুন' : 'Delete preset'}
                      className="px-2 py-1.5 rounded-r-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-red-500 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Base Accent Selector when Standard Mode is Active */}
        {!settings.colorGradingEnabled && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              {bn ? 'বেস অ্যাক্সেন্ট থিম (Standard Accent)' : 'Base Accent Theme'}
            </label>
            <select
              value={settings.accentTheme}
              onChange={(e) =>
                onChange({
                  ...settings,
                  accentTheme: e.target.value as AccentTheme,
                })
              }
              className="px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
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
          </div>
        )}

        {/* 4 Live Color Pickers */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            {
              key: 'bgColor' as const,
              label: bn ? 'ব্যাকগ্রাউন্ড কালার' : 'Background Color',
              val: settings.bgColor,
            },
            {
              key: 'cardColor' as const,
              label: bn ? 'কার্ড / প্যানেল কালার' : 'Card / Panel Color',
              val: settings.cardColor,
            },
            {
              key: 'accentColor' as const,
              label: bn ? 'অ্যাক্সেন্ট কালার' : 'Accent Color',
              val: settings.accentColor,
            },
            {
              key: 'textColor' as const,
              label: bn ? 'টেক্সট কালার' : 'Text Color',
              val: settings.textColor,
            },
          ].map((item) => (
            <div
              key={item.key}
              className="flex items-center justify-between gap-2.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/50"
            >
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">
                  {item.label}
                </div>
                <div className="text-[11px] font-mono-num text-slate-500 dark:text-slate-400 uppercase">
                  {item.val}
                </div>
              </div>
              <input
                type="color"
                value={item.val}
                onChange={(e) => handleColorPick(item.key, e.target.value)}
                className="w-9 h-7 rounded cursor-pointer border-0 bg-transparent shrink-0"
              />
            </div>
          ))}
        </div>

        {/* Save Custom Preset */}
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={presetNameInput}
            onChange={(e) => setPresetNameInput(e.target.value)}
            placeholder={
              bn
                ? 'নতুন কালার প্রিসেটের নাম লিখুন (যেমন: Royal Blue)'
                : 'Custom preset name (e.g. Royal Blue)'
            }
            className="flex-1 min-w-[220px] px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
          />
          <button
            type="button"
            onClick={handleSaveCustomPreset}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-dark)] text-[#042019] text-xs font-bold cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{bn ? 'প্রিসেট সেভ করুন' : 'Save Preset'}</span>
          </button>
        </div>
      </div>

      {/* 2. Animation & Motion Graphics + Typography & Logo Graphics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Animation & Motion Graphics */}
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 space-y-3.5">
          <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-2.5">
              <span className="p-2 rounded-xl bg-[var(--accent-soft)] text-[var(--accent)] shrink-0">
                <Sparkles className="w-4 h-4" />
              </span>
              <div>
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                  {bn ? 'অ্যানিমেশন ও মোশন গ্রাফিক্স' : 'Animation & Motion Graphics'}
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {bn
                    ? '৫টি ভিজ্যুয়াল ও মোশন এফেক্ট নিয়ন্ত্রণ করুন'
                    : 'Toggle master & individual UI motion effects'}
                </p>
              </div>
            </div>
            <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer">
              <span>{settings.animationsEnabled ? (bn ? 'চালু' : 'On') : bn ? 'বন্ধ' : 'Off'}</span>
              <input
                type="checkbox"
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
                className="w-4 h-4 accent-[var(--accent)] cursor-pointer"
              />
            </label>
          </div>

          <div className="space-y-2">
            {motionItems.map((fx) => (
              <label
                key={fx.key}
                className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700/80 bg-slate-50/70 dark:bg-slate-800/40 cursor-pointer hover:border-[var(--accent)]/50 transition-colors"
              >
                <div className="min-w-0">
                  <div className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                    {fx.title}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {fx.desc}
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.animationsEnabled && settings[fx.key]}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    onChange({
                      ...settings,
                      [fx.key]: checked,
                      animationsEnabled: checked ? true : settings.animationsEnabled,
                    });
                  }}
                  className="w-4 h-4 accent-[var(--accent)] cursor-pointer shrink-0"
                />
              </label>
            ))}
          </div>
        </div>

        {/* Graphics: Brand Logo, Hero Title & Fonts */}
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
          <div className="flex items-center gap-2.5 pb-2.5 border-b border-slate-200 dark:border-slate-800">
            <span className="p-2 rounded-xl bg-[var(--accent-soft)] text-[var(--accent)] shrink-0">
              <Type className="w-4 h-4" />
            </span>
            <div>
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                {bn ? 'গ্রাফিক্স, লোগো ও টাইপোগ্রাফি' : 'Graphics, Logo & Typography'}
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {bn
                  ? 'লোগো, ফন্ট ফ্যামিলি এবং গ্লোবাল ফন্ট স্কেল কাস্টমাইজ করুন'
                  : 'Customize center logo, font family, and global scale'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3.5">
            <SyncedRoundLogo size={54} logoDataUrl={settings.logoDataUrl} alt="Center Logo" />
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={logoInputRef}
                type="file"
                accept="image/*"
                onChange={handleUploadLogo}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => logoInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-dark)] text-[#042019] text-xs font-bold cursor-pointer"
              >
                <ImagePlus className="w-3.5 h-3.5" />
                <span>{bn ? 'লোগো আপলোড' : 'Upload Logo'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setLogoError(null);
                  const next = { ...settings, logoDataUrl: '' };
                  onChange(next);
                  onSave(next);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold cursor-pointer"
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                {bn ? 'ড্যাশবোর্ড শিরোনাম' : 'Dashboard Title'}
              </label>
              <input
                type="text"
                value={settings.instituteTitle}
                onChange={(e) => onChange({ ...settings, instituteTitle: e.target.value })}
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                {bn ? 'সাবটাইটেল' : 'Subtitle'}
              </label>
              <input
                type="text"
                value={settings.instituteSub}
                onChange={(e) => onChange({ ...settings, instituteSub: e.target.value })}
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
              {bn ? 'ফন্ট ফ্যামিলি' : 'Font Family'}
            </label>
            <select
              value={settings.fontFamily}
              onChange={(e) => onChange({ ...settings, fontFamily: e.target.value })}
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
            >
              {FONT_FAMILY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
              <span>{bn ? 'ফন্ট সাইজ স্কেল' : 'Global Font Scale'}</span>
              <span className="font-mono-num text-[var(--accent)] font-bold">
                {settings.fontScale}%
              </span>
            </div>
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
              className="w-full accent-[var(--accent)] cursor-pointer"
            />
          </div>
        </div>
      </div>

      {/* Footer Save / Reset Bar */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={handleResetDefaults}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>{bn ? 'সব ডিফল্ট রিসেট' : 'Reset Defaults'}</span>
        </button>

        <button
          type="button"
          onClick={handleSaveAll}
          className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-dark)] text-[#042019] text-xs font-extrabold cursor-pointer"
        >
          {savedNotice ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          <span>
            {savedNotice
              ? bn
                ? 'সংরক্ষিত হয়েছে'
                : 'Saved!'
              : bn
                ? 'কালার ও গ্রাফিক্স সেভ করুন'
                : 'Save Color & Graphics'}
          </span>
        </button>
      </div>
    </div>
  );
}
