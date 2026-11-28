import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Menu, Moon, Plus, Search, Sun, UserPlus } from 'lucide-react';
import { NAV_ITEMS } from '../constants';
import { formatLiveClock, formatTaka, todayDDMMYYYY } from '../lib/format';
import type { Lang, NavKey, Student, ThemeMode } from '../types';

interface TopBarProps {
  activePage: NavKey;
  lang: Lang;
  theme: ThemeMode;
  students?: Student[];
  onSetLang: (lang: Lang) => void;
  onToggleTheme: () => void;
  onOpenMobileMenu: () => void;
  onQuickAddStudent: () => void;
  onQuickNewJob: () => void;
  onQuickOpenProfile?: (code: string) => void;
}

export function TopBar({
  activePage,
  lang,
  theme,
  students = [],
  onSetLang,
  onToggleTheme,
  onOpenMobileMenu,
  onQuickAddStudent,
  onQuickNewJob,
  onQuickOpenProfile,
}: TopBarProps) {
  const bn = lang === 'bn';
  const [now, setNow] = useState(() => new Date());
  const [khataQuery, setKhataQuery] = useState('');
  const [khataFocused, setKhataFocused] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const khataMatches = useMemo(() => {
    const q = khataQuery.trim().toLowerCase();
    if (!q) return [];
    return students
      .filter(
        (s) =>
          s.code.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q) ||
          (s.phone || '').toLowerCase().includes(q)
      )
      .slice(0, 6);
  }, [students, khataQuery]);

  const handleKhataSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!onQuickOpenProfile) return;
    const q = khataQuery.trim().toLowerCase();
    if (!q) return;
    const exact = students.find((s) => s.code.trim().toLowerCase() === q);
    const target = exact || (khataMatches.length === 1 ? khataMatches[0] : khataMatches[0]);
    if (target) {
      onQuickOpenProfile(target.code);
      setKhataQuery('');
      setKhataFocused(false);
    }
  };

  const navMeta = NAV_ITEMS.find((n) => n.key === activePage) || NAV_ITEMS[0];
  const title =
    activePage === 'dash'
      ? bn
        ? 'ড্যাশবোর্ড ওভারভিউ'
        : 'Dashboard Overview'
      : bn
        ? navMeta.bn
        : navMeta.en;
  const subtitle = bn ? navMeta.subtitleBn : navMeta.subtitleEn;

  return (
    <header className="sticky top-0 z-30 shrink-0 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 py-3 print:hidden">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onOpenMobileMenu}
            aria-label="Open menu"
            className="lg:hidden p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <Menu className="w-4 h-4" />
          </button>
          <div className="min-w-0">
            <h1 className="font-display text-lg sm:text-xl font-bold text-slate-900 dark:text-white truncate">
              {title}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate hidden sm:block">
              {subtitle}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {onQuickOpenProfile && students.length > 0 && (
            <form onSubmit={handleKhataSubmit} className="relative hidden md:block">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={khataQuery}
                onFocus={() => setKhataFocused(true)}
                onBlur={() => setTimeout(() => setKhataFocused(false), 160)}
                onChange={(e) => {
                  setKhataQuery(e.target.value);
                  setKhataFocused(true);
                }}
                placeholder={bn ? 'খাতা নং / কোড সার্চ...' : 'Khata / Code lookup...'}
                className="w-44 lg:w-52 pl-8 pr-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-mono-num focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
              {khataFocused && khataQuery.trim().length > 0 && (
                <div className="absolute right-0 mt-1.5 w-72 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl z-50 overflow-hidden">
                  {khataMatches.length === 0 ? (
                    <div className="px-3 py-2.5 text-xs text-slate-500">
                      {bn ? 'কোনো ছাত্র পাওয়া যায়নি' : 'No matching Khata / student'}
                    </div>
                  ) : (
                    khataMatches.map((s) => {
                      const due = Math.max(0, Number(s.contract || 0) - Number(s.deposit || 0));
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            onQuickOpenProfile(s.code);
                            setKhataQuery('');
                            setKhataFocused(false);
                          }}
                          className="w-full px-3 py-2 text-left hover:bg-teal-50 dark:hover:bg-teal-950/40 border-b last:border-b-0 border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 cursor-pointer"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                              <span className="font-mono-num text-teal-700 dark:text-teal-400 mr-1.5">
                                {s.code}
                              </span>
                              {s.name}
                            </div>
                            <div className="text-[10px] text-slate-500 truncate">
                              {s.phone || '—'} · {s.interviewPassedCompany || s.trade || 'Trainee'}
                            </div>
                          </div>
                          <span
                            className={`font-mono-num text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
                              due > 0
                                ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300'
                                : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                            }`}
                          >
                            {due > 0 ? `Due ${formatTaka(due)}` : 'Paid'}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </form>
          )}

          {/* Language Segmented Control */}
          <div
            className="inline-flex items-center p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
            role="group"
            aria-label="Language switch"
          >
            <button
              type="button"
              onClick={() => onSetLang('bn')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                bn
                  ? 'bg-teal-600 text-white'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              BN
            </button>
            <button
              type="button"
              onClick={() => onSetLang('en')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                !bn
                  ? 'bg-teal-600 text-white'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              EN
            </button>
          </div>

          {/* Live Date & Clock */}
          <div className="hidden md:flex flex-col items-end leading-tight pr-1">
            <span className="font-mono-num text-xs font-semibold text-slate-800 dark:text-slate-200">
              {todayDDMMYYYY(now)}
            </span>
            <span className="font-mono-num text-[11px] text-slate-500 dark:text-slate-400">
              {formatLiveClock(now)}
            </span>
          </div>

          {/* Theme toggle */}
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label="Toggle Light/Dark theme"
            className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors cursor-pointer"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {/* Add Student shortcut */}
          <button
            type="button"
            onClick={onQuickAddStudent}
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>{bn ? '+ স্টুডেন্ট' : '+ Add Student'}</span>
          </button>

          {/* New Job Entry primary CTA */}
          <button
            type="button"
            onClick={onQuickNewJob}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{bn ? '+ নতুন জব এন্ট্রি' : '+ New Job Entry'}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
