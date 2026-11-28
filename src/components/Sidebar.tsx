import { useState, type ComponentType } from 'react';
import {
  BarChart3,
  Briefcase,
  Building2,
  CalendarRange,
  CircleDollarSign,
  Cloud,
  DollarSign,
  FileSpreadsheet,
  FileText,
  GripVertical,
  HardDrive,
  LayoutDashboard,
  LogOut,
  Package,
  RotateCcw,
  Settings,
  Shield,
  UserCheck,
  UserPlus,
  UserX,
  Users,
  Wallet,
} from 'lucide-react';
import { DEFAULT_NAV_ORDER, NAV_ITEMS } from '../constants';
import type { Lang, NavKey } from '../types';
import { SyncedRoundLogo } from './SyncedRoundLogo';

const ICON_MAP: Record<NavKey, ComponentType<{ className?: string }>> = {
  dash: LayoutDashboard,
  students: Users,
  due: CircleDollarSign,
  inactive: UserX,
  jobs: Briefcase,
  outs: UserPlus,
  staff: UserCheck,
  companies: Building2,
  store: Package,
  prices: DollarSign,
  returns: RotateCcw,
  cash: Wallet,
  generalAccounts: FileSpreadsheet,
  reports: BarChart3,
  monthly: CalendarRange,
  admin: Shield,
  settings: Settings,
  docs: FileText,
};

interface SidebarProps {
  activePage: NavKey;
  navOrder: NavKey[];
  lang: Lang;
  studentCount: number;
  dueCount?: number;
  inactiveCount?: number;
  logoDataUrl?: string;
  mode: 'cloud' | 'local';
  cloudConnected: boolean;
  userEmail?: string | null;
  onSelectPage: (page: NavKey) => void;
  onOpenSettingsDrawer: () => void;
  onReorderNav: (nextOrder: NavKey[]) => void;
  onLogout: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function Sidebar({
  activePage,
  navOrder,
  lang,
  studentCount,
  dueCount = 0,
  inactiveCount = 0,
  logoDataUrl,
  mode,
  cloudConnected,
  userEmail,
  onSelectPage,
  onOpenSettingsDrawer,
  onReorderNav,
  onLogout,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const bn = lang === 'bn';
  const [draggedKey, setDraggedKey] = useState<NavKey | null>(null);

  const effectiveOrder = navOrder.length > 0 ? navOrder : DEFAULT_NAV_ORDER;
  const normalizedKeys: NavKey[] = [
    'dash',
    'students',
    ...effectiveOrder.filter((k) => k !== 'dash' && k !== 'students'),
  ];
  const orderedItems = normalizedKeys
    .map((key) => NAV_ITEMS.find((item) => item.key === key))
    .filter((item): item is (typeof NAV_ITEMS)[number] => Boolean(item));

  // Append any missing keys safely
  NAV_ITEMS.forEach((item) => {
    if (!orderedItems.some((x) => x.key === item.key)) {
      orderedItems.push(item);
    }
  });

  const handleDrop = (targetKey: NavKey) => {
    if (
      !draggedKey ||
      draggedKey === targetKey ||
      draggedKey === 'dash' ||
      draggedKey === 'students' ||
      targetKey === 'dash' ||
      targetKey === 'students'
    ) {
      setDraggedKey(null);
      return;
    }
    const keys = orderedItems.map((i) => i.key);
    const fromIdx = keys.indexOf(draggedKey);
    const toIdx = keys.indexOf(targetKey);
    if (fromIdx === -1 || toIdx === -1) return;
    keys.splice(fromIdx, 1);
    keys.splice(toIdx, 0, draggedKey);
    onReorderNav(keys);
    setDraggedKey(null);
  };

  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/60 lg:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-[#090e18] text-slate-300 flex flex-col border-r border-slate-400/20 transition-transform duration-200 lg:static lg:h-screen lg:shrink-0 lg:translate-x-0 print:hidden ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="px-4 py-4 border-b border-slate-400/15 flex items-center gap-3 shrink-0">
          <SyncedRoundLogo size={38} logoDataUrl={logoDataUrl} alt="ITTC Center Logo" />
          <div className="min-w-0">
            <div className="font-display font-extrabold text-[15px] text-white tracking-tight truncate">
              ITTC Center
            </div>
            <div className="text-[11px] text-slate-400 truncate">
              Technical Training &amp; Testing
            </div>
          </div>
        </div>

        <div className="px-4 pt-3 pb-1.5 text-[11px] font-medium text-slate-500">
          {bn ? 'নেভিগেশন মেনু (টেনে সাজান)' : 'Navigation Menu (Drag & Drop)'}
        </div>

        <nav className="flex-1 overflow-y-auto no-scrollbar px-2.5 pb-3 space-y-0.5">
          {orderedItems.map((item) => {
            const Icon = ICON_MAP[item.key];
            const isSettingsItem = item.key === 'settings';
            const isActive = activePage === item.key;
            const label = bn ? item.bn : item.en;
            const tag = isSettingsItem ? 'Live' : bn ? item.tagBn : item.tagEn;

            return (
              <button
                key={item.key}
                type="button"
                draggable
                onDragStart={() => setDraggedKey(item.key)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(item.key)}
                onClick={() => {
                  if (isSettingsItem) {
                    onOpenSettingsDrawer();
                  } else {
                    onSelectPage(item.key);
                  }
                  onCloseMobile();
                }}
                className={`group w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-[13px] transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-[var(--accent)] text-[#042019] font-bold'
                    : isSettingsItem
                      ? 'border border-slate-400/20 bg-[var(--accent-soft)] text-slate-100 hover:border-[var(--accent)] hover:text-white'
                      : 'text-slate-300 hover:bg-white/[0.05] hover:text-white'
                }`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <GripVertical
                    className={`w-3.5 h-3.5 shrink-0 opacity-40 group-hover:opacity-80 ${
                      isActive ? 'text-[#042019]/70' : 'text-slate-500'
                    }`}
                  />
                  <Icon
                    className={`w-4 h-4 shrink-0 ${
                      isActive
                        ? 'text-[#042019]'
                        : isSettingsItem
                          ? 'text-[var(--accent)]'
                          : 'text-slate-400 group-hover:text-[var(--accent)]'
                    }`}
                  />
                  <span className="truncate">{label}</span>
                </span>

                {item.key === 'students' && (
                  <span
                    className={`font-mono-num text-[11px] px-1.5 py-0.5 rounded shrink-0 ${
                      isActive ? 'bg-[#042019]/15 text-[#042019]' : 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    {studentCount}
                  </span>
                )}
                {item.key === 'due' && dueCount > 0 && (
                  <span
                    className={`font-mono-num text-[11px] px-1.5 py-0.5 rounded shrink-0 ${
                      isActive
                        ? 'bg-[#042019]/15 text-[#042019]'
                        : 'bg-amber-950/90 text-amber-300 border border-amber-700/60'
                    }`}
                  >
                    {dueCount}
                  </span>
                )}
                {item.key === 'inactive' && inactiveCount > 0 && (
                  <span
                    className={`font-mono-num text-[11px] px-1.5 py-0.5 rounded shrink-0 ${
                      isActive
                        ? 'bg-[#042019]/15 text-[#042019]'
                        : 'bg-rose-950/90 text-rose-300 border border-rose-700/60'
                    }`}
                  >
                    {inactiveCount}
                  </span>
                )}
                {item.key !== 'students' &&
                  !(item.key === 'due' && dueCount > 0) &&
                  !(item.key === 'inactive' && inactiveCount > 0) &&
                  tag && (
                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
                      isActive
                        ? 'bg-[#042019]/15 text-[#042019]'
                        : isSettingsItem
                          ? 'bg-slate-800/90 text-[var(--accent)]'
                          : 'bg-slate-800/90 text-slate-400'
                    }`}
                  >
                    {tag}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-slate-400/15 space-y-2 shrink-0 bg-[#070b14]">
          <div className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-slate-900/80 border border-slate-800">
            <div className="min-w-0">
              <div className="text-[11px] text-slate-400 truncate">
                {mode === 'cloud' ? userEmail || 'Cloud Workspace' : 'Browser Local Storage'}
              </div>
              <div className="flex items-center gap-1.5 text-[11px] font-medium mt-0.5">
                {mode === 'cloud' ? (
                  <>
                    <Cloud className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span className={cloudConnected ? 'text-emerald-400' : 'text-amber-400'}>
                      {cloudConnected
                        ? bn
                          ? 'ক্লাউড সিঙ্ক সক্রিয়'
                          : 'Cloud Synced'
                        : bn
                          ? 'সংযোগ যাচাই হচ্ছে'
                          : 'Connecting'}
                    </span>
                  </>
                ) : (
                  <>
                    <HardDrive className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span className="text-amber-300">
                      {bn ? 'অফলাইন লোকাল মোড' : 'Local Offline Mode'}
                    </span>
                  </>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                onOpenSettingsDrawer();
                onCloseMobile();
              }}
              aria-label="Center Settings"
              className="p-1.5 rounded-md text-slate-400 hover:text-[var(--accent)] hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-slate-700/80 bg-slate-900/50 hover:bg-slate-800 text-slate-200 text-xs font-medium transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>{bn ? 'লগ আউট / সুইচ' : 'Log Out'}</span>
          </button>
        </div>
      </aside>
    </>
  );
}
