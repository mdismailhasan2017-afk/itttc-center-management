import { useState, type FormEvent } from 'react';
import { Cloud, Eye, EyeOff, Globe, HardDrive, Moon, ShieldCheck, Sun, UploadCloud } from 'lucide-react';
import type { Lang, ThemeMode } from '../types';
import { EmblemLogo } from './EmblemLogo';

interface AuthGateProps {
  lang: Lang;
  theme: ThemeMode;
  authError: string | null;
  megaConnectedEmail?: string | null;
  megaBusy?: boolean;
  onToggleLang: () => void;
  onToggleTheme: () => void;
  onGoogleSignIn: () => void;
  onLocalMode: () => void;
  onMegaSignIn?: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  onContinueConnectedMega?: () => void;
}

export function AuthGate({
  lang,
  theme,
  authError,
  megaConnectedEmail,
  megaBusy,
  onToggleLang,
  onToggleTheme,
  onGoogleSignIn,
  onLocalMode,
  onMegaSignIn,
  onContinueConnectedMega,
}: AuthGateProps) {
  const bn = lang === 'bn';
  const [megaEmail, setMegaEmail] = useState('');
  const [megaPass, setMegaPass] = useState('');
  const [showMegaPass, setShowMegaPass] = useState(false);
  const [megaError, setMegaError] = useState<string | null>(null);
  const [submittingMega, setSubmittingMega] = useState(false);

  const handleMegaSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!onMegaSignIn) return;
    setMegaError(null);
    setSubmittingMega(true);
    try {
      const res = await onMegaSignIn(megaEmail.trim(), megaPass);
      if (!res.ok) {
        setMegaError(
          res.error ||
            (bn
              ? 'MEGA লগইন ব্যর্থ হয়েছে। ইমেইল ও পাসওয়ার্ড যাচাই করুন।'
              : 'MEGA login failed. Please check your email and password.')
        );
      }
    } finally {
      setSubmittingMega(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 flex flex-col justify-between p-6">
      <div className="max-w-5xl w-full mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <EmblemLogo size={38} />
          <span className="font-display font-bold text-lg text-slate-900 dark:text-white whitespace-nowrap">
            ITTC Center
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleLang}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap cursor-pointer"
          >
            <Globe className="w-3.5 h-3.5" />
            {bn ? 'EN' : 'বাংলা'}
          </button>
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label="Toggle theme"
            className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <main className="max-w-4xl w-full mx-auto my-8 grid md:grid-cols-12 gap-6 items-stretch">
        <div className="md:col-span-6 bg-slate-900 text-white rounded-xl p-8 border border-slate-800 flex flex-col justify-between">
          <div>
            <p className="text-xs font-medium text-teal-300 tracking-wide mb-3">
              {bn ? 'আদর্শ টেকনিক্যাল ট্রেনিং ও টেস্টিং সেন্টার' : 'IDEAL TECHNICAL TRAINING & TESTING CENTER'}
            </p>
            <h1 className="font-display text-3xl sm:text-4xl font-extrabold leading-tight text-balance">
              {bn
                ? 'প্র্যাকটিক্যাল টেস্ট, স্টুডেন্ট ও অ্যাকাউন্টস ম্যানেজমেন্ট সিস্টেম'
                : 'Practical Test, Trainee Ledger & Operations Management'}
            </h1>
            <p className="mt-4 text-sm text-slate-300 leading-relaxed">
              {bn
                ? 'দৈনিক জব রেজিস্টার, তাৎক্ষণিক থার্মাল টোকেন প্রিন্ট, স্টুডেন্ট চুক্তি ও বকেয়া হিসাব, স্টাফ বেতন, স্টোর ইনভেন্টরি এবং ক্যাশবুক—সবকিছু এক জায়গায়।'
                : 'Unified workspace for daily practical welding test jobs, instant thermal token slips, trainee contract ledgers, payroll, store inventory, overseas partners, and cashbook accounting.'}
            </p>
          </div>

          <div className="mt-8 pt-6 border-t border-slate-800 grid grid-cols-3 gap-4 text-xs">
            <div>
              <div className="font-display font-bold text-lg text-teal-400">14</div>
              <div className="text-slate-400">{bn ? 'মডিউল' : 'Core Modules'}</div>
            </div>
            <div>
              <div className="font-display font-bold text-lg text-teal-400">MEGA</div>
              <div className="text-slate-400">{bn ? 'রিয়েল-টাইম সিঙ্ক' : 'Real-Time Sync'}</div>
            </div>
            <div>
              <div className="font-display font-bold text-lg text-teal-400">BN / EN</div>
              <div className="text-slate-400">{bn ? 'দ্বিভাষিক' : 'Bilingual UI'}</div>
            </div>
          </div>
        </div>

        <div className="md:col-span-6 bg-white dark:bg-slate-900 rounded-xl p-7 border border-slate-200 dark:border-slate-800 flex flex-col justify-center space-y-4">
          <div>
            <div className="flex items-center gap-2 text-teal-700 dark:text-teal-400 text-xs font-semibold mb-1.5">
              <ShieldCheck className="w-4 h-4" />
              <span>{bn ? 'সুরক্ষিত ওয়ার্কস্পেস প্রবেশ' : 'Secure Center Access'}</span>
            </div>
            <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
              {bn ? 'সেন্টার ড্যাশবোর্ডে প্রবেশ করুন' : 'Sign in to ITTC Center'}
            </h2>
          </div>

          {(authError || megaError) && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
              {megaError || authError}
            </div>
          )}

          {/* Direct MEGA Cloud Login (Cross-Browser + Real-Time Auto-Sync) */}
          {onMegaSignIn && (
            <div className="rounded-xl border border-indigo-200 dark:border-indigo-900/70 bg-indigo-50/60 dark:bg-indigo-950/30 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-bold text-indigo-700 dark:text-indigo-300">
                  <UploadCloud className="w-4 h-4" />
                  <span>
                    {bn
                      ? 'MEGA ক্লাউড লগইন (রিয়েল-টাইম অটো সিঙ্ক)'
                      : 'Sign in with MEGA Cloud (Auto-Sync)'}
                  </span>
                </div>
              </div>

              {megaConnectedEmail && onContinueConnectedMega ? (
                <div className="space-y-2">
                  <p className="text-[11px] text-slate-600 dark:text-slate-300">
                    {bn
                      ? `সংযুক্ত অ্যাকাউন্ট: ${megaConnectedEmail}`
                      : `Connected account: ${megaConnectedEmail}`}
                  </p>
                  <button
                    type="button"
                    onClick={onContinueConnectedMega}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition-colors cursor-pointer"
                  >
                    <UploadCloud className="w-4 h-4" />
                    <span>
                      {bn
                        ? 'MEGA ডেটা সিঙ্ক করে ড্যাশবোর্ডে ঢুকুন'
                        : 'Enter Workspace & Sync MEGA Data'}
                    </span>
                  </button>
                </div>
              ) : (
                <form onSubmit={handleMegaSubmit} className="space-y-2">
                  <p className="text-[11px] text-slate-600 dark:text-slate-400">
                    {bn
                      ? 'আপনার MEGA অ্যাকাউন্ট দিয়ে লগইন করলে আগের সব তথ্য অটো লোড হবে এবং ১টি শব্দ লিখলেও অটো সেভ হবে।'
                      : 'Login with MEGA to pull your latest saved data across browsers & auto-save every edit in real time.'}
                  </p>
                  <input
                    type="email"
                    required
                    value={megaEmail}
                    onChange={(e) => {
                      setMegaEmail(e.target.value);
                      setMegaError(null);
                    }}
                    placeholder="your-mega-email@gmail.com"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                  <div className="relative">
                    <input
                      type={showMegaPass ? 'text' : 'password'}
                      required
                      value={megaPass}
                      onChange={(e) => {
                        setMegaPass(e.target.value);
                        setMegaError(null);
                      }}
                      placeholder={bn ? 'MEGA পাসওয়ার্ড' : 'MEGA password'}
                      className="w-full pl-3 pr-9 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                    <button
                      type="button"
                      onClick={() => setShowMegaPass((v) => !v)}
                      aria-label={showMegaPass ? 'Hide password' : 'Show password'}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      {showMegaPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <button
                    type="submit"
                    disabled={submittingMega || megaBusy}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-xs font-bold transition-colors cursor-pointer"
                  >
                    <UploadCloud className="w-4 h-4" />
                    <span>
                      {submittingMega || megaBusy
                        ? bn
                          ? 'MEGA সংযোগ হচ্ছে...'
                          : 'Connecting MEGA...'
                        : bn
                          ? 'MEGA লগইন ও প্রবেশ করুন'
                          : 'Login with MEGA & Enter'}
                    </span>
                  </button>
                </form>
              )}
            </div>
          )}

          <div className="space-y-2.5 pt-1">
            <button
              type="button"
              onClick={onGoogleSignIn}
              className="w-full flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold transition-colors cursor-pointer"
            >
              <Cloud className="w-4 h-4" />
              <span>{bn ? 'Google দিয়ে সাইন ইন (Firestore)' : 'Sign in with Google (Cloud Sync)'}</span>
            </button>

            <button
              type="button"
              onClick={onLocalMode}
              className="w-full flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-xs font-medium transition-colors cursor-pointer"
            >
              <HardDrive className="w-4 h-4" />
              <span>{bn ? 'লোকাল অফলাইন মোডে চালু করুন' : 'Continue in Local Offline Mode'}</span>
            </button>
          </div>
        </div>
      </main>

      <footer className="max-w-5xl w-full mx-auto text-center text-xs text-slate-500 dark:text-slate-500">
        Ideal Technical Training &amp; Testing Center
      </footer>
    </div>
  );
}

