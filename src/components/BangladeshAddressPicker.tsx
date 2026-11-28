import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, MapPin, Plus, Search, Sparkles, X } from 'lucide-react';
import bdDataRaw from '../data/bdLocations.json';
import type { Lang, Student } from '../types';

interface DistrictItem {
  i: string;
  n: string;
  b: string;
}

interface UpazilaItem {
  i: string;
  d: string;
  n: string;
  b: string;
}

interface UnionItem {
  i: string;
  u: string;
  n: string;
  b: string;
}

const bdData = bdDataRaw as {
  districts: DistrictItem[];
  upazilas: UpazilaItem[];
  unions: UnionItem[];
};

const LEARNED_VILLAGES_STORAGE_KEY = 'ittc.bd.learnedVillages.v1';

function loadLearnedVillagesMap(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(LEARNED_VILLAGES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Record<string, string[]>;
  } catch {
    return {};
  }
}

function saveLearnedVillagesMap(map: Record<string, string[]>) {
  try {
    localStorage.setItem(LEARNED_VILLAGES_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage quota errors
  }
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function findDistrictMatch(text: string): DistrictItem | undefined {
  const target = norm(text);
  if (!target) return undefined;
  return bdData.districts.find(
    (d) => norm(d.n) === target || norm(d.b) === target
  );
}

function findUpazilaMatch(text: string, districtId: string): UpazilaItem | undefined {
  const target = norm(text);
  if (!target) return undefined;
  return bdData.upazilas.find(
    (u) => u.d === districtId && (norm(u.n) === target || norm(u.b) === target)
  );
}

function parseAddressString(rawValue: string): {
  districtId: string;
  upazilaId: string;
  village: string;
  unparsedCustom: string;
} {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return { districtId: '', upazilaId: '', village: '', unparsedCustom: '' };
  }
  const parts = trimmed
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return { districtId: '', upazilaId: '', village: '', unparsedCustom: '' };
  }

  const lastPart = parts[parts.length - 1];
  const dist = findDistrictMatch(lastPart);
  if (!dist) {
    // Maybe district is anywhere in parts
    for (let idx = parts.length - 1; idx >= 0; idx--) {
      const maybeDist = findDistrictMatch(parts[idx]);
      if (maybeDist) {
        const prev = idx > 0 ? findUpazilaMatch(parts[idx - 1], maybeDist.i) : undefined;
        const villageParts = prev
          ? parts.slice(0, idx - 1)
          : parts.slice(0, idx);
        return {
          districtId: maybeDist.i,
          upazilaId: prev ? prev.i : '',
          village: villageParts.join(', '),
          unparsedCustom: '',
        };
      }
    }
    return { districtId: '', upazilaId: '', village: '', unparsedCustom: trimmed };
  }

  if (parts.length === 1) {
    return { districtId: dist.i, upazilaId: '', village: '', unparsedCustom: '' };
  }

  const secondLast = parts[parts.length - 2];
  const upa = findUpazilaMatch(secondLast, dist.i);
  if (upa) {
    return {
      districtId: dist.i,
      upazilaId: upa.i,
      village: parts.slice(0, parts.length - 2).join(', '),
      unparsedCustom: '',
    };
  }

  return {
    districtId: dist.i,
    upazilaId: '',
    village: parts.slice(0, parts.length - 1).join(', '),
    unparsedCustom: '',
  };
}

interface OptionEntry {
  value: string;
  label: string;
  subLabel?: string;
  searchText: string;
  isCustomSaved?: boolean;
}

interface SearchableSelectProps {
  id: string;
  label: string;
  placeholder: string;
  searchPlaceholder: string;
  value: string;
  options: OptionEntry[];
  disabled?: boolean;
  disabledHint?: string;
  allowCustomCreate?: boolean;
  customCreateLabel?: (query: string) => string;
  emptyText: string;
  onSelect: (value: string) => void;
  onCreateCustom?: (rawName: string) => void;
  onRemoveCustom?: (rawName: string) => void;
}

function SearchableSelect({
  id,
  label,
  placeholder,
  searchPlaceholder,
  value,
  options,
  disabled = false,
  disabledHint,
  allowCustomCreate = false,
  customCreateLabel,
  emptyText,
  onSelect,
  onCreateCustom,
  onRemoveCustom,
}: SearchableSelectProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightIdx, setHighlightIdx] = useState(0);

  const selectedOption = useMemo(
    () => options.find((o) => norm(o.value) === norm(value)),
    [options, value]
  );

  const filtered = useMemo(() => {
    const q = norm(query);
    if (!q) return options;
    return options.filter((o) => o.searchText.includes(q));
  }, [options, query]);

  const trimmedQuery = query.trim();
  const hasExactMatch = useMemo(() => {
    const q = norm(trimmedQuery);
    if (!q) return true;
    return options.some(
      (o) => norm(o.value) === q || norm(o.label) === q || (o.subLabel && norm(o.subLabel) === q)
    );
  }, [options, trimmedQuery]);

  const canCreate = allowCustomCreate && Boolean(trimmedQuery) && !hasExactMatch && !disabled;

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  useEffect(() => {
    if (open) {
      setHighlightIdx(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    } else {
      setQuery('');
    }
  }, [open]);

  const displayLabel = selectedOption
    ? selectedOption.subLabel
      ? `${selectedOption.label} (${selectedOption.subLabel})`
      : selectedOption.label
    : value || '';

  return (
    <div ref={containerRef} className="relative">
      <label
        htmlFor={id}
        className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1"
      >
        {label}
      </label>

      <div className="relative flex items-center">
        <button
          id={id}
          type="button"
          disabled={disabled}
          onClick={() => {
            if (!disabled) setOpen((prev) => !prev);
          }}
          className={`w-full px-3 py-2.5 pr-14 text-left text-xs sm:text-sm rounded-xl border transition-colors flex items-center justify-between gap-2 ${
            disabled
              ? 'border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/50 text-slate-400 cursor-not-allowed'
              : open
                ? 'border-teal-500 ring-2 ring-teal-500/20 bg-white dark:bg-slate-800 text-slate-900 dark:text-white cursor-pointer'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white hover:border-teal-400 cursor-pointer'
          }`}
        >
          <span
            className={`truncate ${
              displayLabel ? 'font-medium text-slate-900 dark:text-white' : 'text-slate-400'
            }`}
          >
            {displayLabel || (disabled && disabledHint ? disabledHint : placeholder)}
          </span>
        </button>

        <div className="absolute right-2 flex items-center gap-1 pointer-events-none">
          {value && !disabled && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSelect('');
              }}
              aria-label="Clear selection"
              className="pointer-events-auto p-1 rounded-md text-slate-400 hover:text-red-500 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <ChevronDown
            className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </div>
      </div>

      {open && !disabled && (
        <div className="absolute z-50 mt-1.5 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl overflow-hidden">
          {/* Search Bar */}
          <div className="p-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/60">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setHighlightIdx(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setHighlightIdx((i) => Math.min(filtered.length - 1, i + 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setHighlightIdx((i) => Math.max(0, i - 1));
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    if (filtered[highlightIdx]) {
                      onSelect(filtered[highlightIdx].value);
                      setOpen(false);
                    } else if (canCreate && onCreateCustom) {
                      onCreateCustom(trimmedQuery);
                      setOpen(false);
                    }
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setOpen(false);
                  }
                }}
                placeholder={searchPlaceholder}
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          </div>

          {/* Options List */}
          <div className="max-h-56 overflow-y-auto py-1 divide-y divide-slate-50 dark:divide-slate-800/50">
            {canCreate && onCreateCustom && (
              <button
                type="button"
                onClick={() => {
                  onCreateCustom(trimmedQuery);
                  setOpen(false);
                }}
                className="w-full px-3 py-2 text-left text-xs font-semibold bg-emerald-50/80 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 flex items-center gap-2 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">
                  {customCreateLabel
                    ? customCreateLabel(trimmedQuery)
                    : `Save & Select "${trimmedQuery}"`}
                </span>
              </button>
            )}

            {filtered.length === 0 && !canCreate ? (
              <div className="px-3 py-4 text-center text-xs text-slate-400">{emptyText}</div>
            ) : (
              filtered.map((opt, idx) => {
                const isSelected = norm(opt.value) === norm(value);
                const isHighlighted = idx === highlightIdx;
                return (
                  <div
                    key={`${opt.value}-${idx}`}
                    className={`flex items-center justify-between gap-2 px-3 py-2 text-xs transition-colors ${
                      isSelected
                        ? 'bg-teal-50 dark:bg-teal-950/60 text-teal-800 dark:text-teal-200 font-semibold'
                        : isHighlighted
                          ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white'
                          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/70'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(opt.value);
                        setOpen(false);
                      }}
                      className="flex-1 text-left flex items-center justify-between gap-2 min-w-0 cursor-pointer"
                    >
                      <span className="truncate">
                        {opt.label}
                        {opt.subLabel ? (
                          <span className="ml-1.5 text-[11px] text-slate-500 dark:text-slate-400 font-normal">
                            ({opt.subLabel})
                          </span>
                        ) : null}
                      </span>
                      <span className="flex items-center gap-1 shrink-0">
                        {opt.isCustomSaved && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-[9px] font-bold text-amber-700 dark:text-amber-300">
                            SAVED
                          </span>
                        )}
                        {isSelected && <Check className="w-3.5 h-3.5 text-teal-600" />}
                      </span>
                    </button>

                    {opt.isCustomSaved && onRemoveCustom && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveCustom(opt.value);
                        }}
                        title="Remove saved village"
                        className="p-0.5 rounded text-slate-400 hover:text-red-600 cursor-pointer shrink-0"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface BangladeshAddressPickerProps {
  value: string;
  onChange: (formattedAddress: string) => void;
  students: Student[];
  lang: Lang;
}

export function BangladeshAddressPicker({
  value,
  onChange,
  students,
  lang,
}: BangladeshAddressPickerProps) {
  const bn = lang === 'bn';

  const [learnedMap, setLearnedMap] = useState<Record<string, string[]>>(() =>
    loadLearnedVillagesMap()
  );
  const [selectedDistrictId, setSelectedDistrictId] = useState('');
  const [selectedUpazilaId, setSelectedUpazilaId] = useState('');
  const [selectedVillage, setSelectedVillage] = useState('');
  const [manualMode, setManualMode] = useState(false);

  // Hydrate dropdown state whenever incoming `value` changes externally (e.g. opening Edit or Reset)
  useEffect(() => {
    const parsed = parseAddressString(value);
    if (parsed.unparsedCustom) {
      setSelectedDistrictId('');
      setSelectedUpazilaId('');
      setSelectedVillage('');
      setManualMode(true);
    } else {
      setSelectedDistrictId(parsed.districtId);
      setSelectedUpazilaId(parsed.upazilaId);
      setSelectedVillage(parsed.village);
      if (!value) setManualMode(false);
    }
  }, [value]);

  // Also auto-learn custom village names already stored across synced student records
  const studentLearnedByUpazila = useMemo(() => {
    const map = new Map<string, Set<string>>();
    students.forEach((stu) => {
      if (!stu.district) return;
      const parsed = parseAddressString(stu.district);
      if (!parsed.upazilaId || !parsed.village) return;
      const isOfficialUnion = bdData.unions.some(
        (u) =>
          u.u === parsed.upazilaId &&
          (norm(u.n) === norm(parsed.village) || norm(u.b) === norm(parsed.village))
      );
      if (isOfficialUnion) return;
      const set = map.get(parsed.upazilaId) || new Set<string>();
      set.add(parsed.village.trim());
      map.set(parsed.upazilaId, set);
    });
    return map;
  }, [students]);

  const districtOptions = useMemo<OptionEntry[]>(
    () =>
      bdData.districts.map((d) => ({
        value: d.i,
        label: d.n,
        subLabel: d.b,
        searchText: `${d.n} ${d.b}`.toLowerCase(),
      })),
    []
  );

  const filteredUpazilas = useMemo(
    () =>
      selectedDistrictId
        ? bdData.upazilas.filter((u) => u.d === selectedDistrictId)
        : [],
    [selectedDistrictId]
  );

  const upazilaOptions = useMemo<OptionEntry[]>(
    () =>
      filteredUpazilas.map((u) => ({
        value: u.i,
        label: u.n,
        subLabel: u.b,
        searchText: `${u.n} ${u.b}`.toLowerCase(),
      })),
    [filteredUpazilas]
  );

  const unionAndVillageOptions = useMemo<OptionEntry[]>(() => {
    if (!selectedUpazilaId) return [];
    const official = bdData.unions.filter((u) => u.u === selectedUpazilaId);
    const localSaved = learnedMap[selectedUpazilaId] || [];
    const syncedSaved = Array.from(studentLearnedByUpazila.get(selectedUpazilaId) || []);

    const seen = new Set<string>();
    const list: OptionEntry[] = [];

    // Show auto-learned local/center villages right at the top for quick repeat picks
    [...localSaved, ...syncedSaved].forEach((vName) => {
      const clean = vName.trim();
      const key = norm(clean);
      if (!clean || seen.has(key)) return;
      seen.add(key);
      list.push({
        value: clean,
        label: clean,
        searchText: clean.toLowerCase(),
        isCustomSaved: true,
      });
    });

    official.forEach((un) => {
      const key = norm(un.n);
      if (seen.has(key)) return;
      seen.add(key);
      list.push({
        value: un.n,
        label: un.n,
        subLabel: un.b,
        searchText: `${un.n} ${un.b}`.toLowerCase(),
      });
    });

    return list;
  }, [selectedUpazilaId, learnedMap, studentLearnedByUpazila]);

  const emitAddress = (distId: string, upaId: string, villageName: string) => {
    const dist = bdData.districts.find((d) => d.i === distId);
    const upa = bdData.upazilas.find((u) => u.i === upaId);
    const formatted = [villageName.trim(), upa?.n || '', dist?.n || '']
      .filter(Boolean)
      .join(', ')
      .slice(0, 160);
    onChange(formatted);
  };

  const handleDistrictChange = (nextDistId: string) => {
    setSelectedDistrictId(nextDistId);
    setSelectedUpazilaId('');
    setSelectedVillage('');
    emitAddress(nextDistId, '', '');
  };

  const handleUpazilaChange = (nextUpaId: string) => {
    setSelectedUpazilaId(nextUpaId);
    setSelectedVillage('');
    emitAddress(selectedDistrictId, nextUpaId, '');
  };

  const handleVillageChange = (nextVillage: string) => {
    setSelectedVillage(nextVillage);
    emitAddress(selectedDistrictId, selectedUpazilaId, nextVillage);
  };

  const handleCreateCustomVillage = (rawVillage: string) => {
    const clean = rawVillage.trim();
    if (!clean || !selectedUpazilaId) return;
    setLearnedMap((prev) => {
      const existing = prev[selectedUpazilaId] || [];
      if (existing.some((x) => norm(x) === norm(clean))) return prev;
      const next = {
        ...prev,
        [selectedUpazilaId]: [clean, ...existing],
      };
      saveLearnedVillagesMap(next);
      return next;
    });
    handleVillageChange(clean);
  };

  const handleRemoveCustomVillage = (targetName: string) => {
    if (!selectedUpazilaId) return;
    setLearnedMap((prev) => {
      const existing = prev[selectedUpazilaId] || [];
      const filtered = existing.filter((x) => norm(x) !== norm(targetName));
      const next = { ...prev, [selectedUpazilaId]: filtered };
      saveLearnedVillagesMap(next);
      return next;
    });
    if (norm(selectedVillage) === norm(targetName)) {
      handleVillageChange('');
    }
  };

  const selectedDistObj = bdData.districts.find((d) => d.i === selectedDistrictId);
  const selectedUpaObj = bdData.upazilas.find((u) => u.i === selectedUpazilaId);

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-200">
          <MapPin className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0" />
          <span>Address / Location (স্থায়ী ঠিকানা — ৬৪ জেলা, ৪৯৫ উপজেলা ও ইউনিয়ন/গ্রাম)</span>
        </div>

        <button
          type="button"
          onClick={() => setManualMode((v) => !v)}
          className="text-[11px] font-semibold text-teal-700 dark:text-teal-400 hover:underline cursor-pointer"
        >
          {manualMode
            ? bn
              ? 'ড্রপডাউন মোডে ফিরুন'
              : 'Use District/Thana Dropdowns'
            : bn
              ? 'হাতে ঠিকানা লিখুন'
              : 'Type Full Address Manually'}
        </button>
      </div>

      {manualMode ? (
        <div className="space-y-1.5">
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Village / Union, Thana / Upazila, District"
            className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            ফরম্যাট পরামর্শ: গ্রাম/ইউনিয়ন, থানা, জেলা (যেমন: Chinispur, Narsingdi Sadar, Narsingdi)
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <SearchableSelect
            id="addr-district"
            label="District (জেলা) • ৬৪ জেলা"
            placeholder="জেলা সিলেক্ট করুন..."
            searchPlaceholder="জেলার নাম লিখুন (যেমন: Narsingdi / নরসিংদী)..."
            value={selectedDistrictId}
            options={districtOptions}
            emptyText="কোনো জেলা পাওয়া যায়নি"
            onSelect={handleDistrictChange}
          />

          <SearchableSelect
            id="addr-upazila"
            label={`Upazila / Thana (থানা / উপজেলা)${
              selectedDistObj ? ` • ${filteredUpazilas.length} টি` : ''
            }`}
            placeholder="থানা / উপজেলা সিলেক্ট করুন..."
            disabled={!selectedDistrictId}
            disabledHint="আগে জেলা সিলেক্ট করুন"
            searchPlaceholder="থানার নাম লিখুন (যেমন: Shibpur / শিবপুর)..."
            value={selectedUpazilaId}
            options={upazilaOptions}
            emptyText="এই জেলায় কোনো থানা পাওয়া যায়নি"
            onSelect={handleUpazilaChange}
          />

          <SearchableSelect
            id="addr-village"
            label="Union / Village (ইউনিয়ন বা গ্রাম)"
            placeholder="ইউনিয়ন বা গ্রাম সিলেক্ট / টাইপ করুন..."
            disabled={!selectedUpazilaId}
            disabledHint="আগে থানা সিলেক্ট করুন"
            searchPlaceholder="ইউনিয়ন/গ্রামের নাম লিখুন বা নতুন নাম লিখে সেভ করুন..."
            value={selectedVillage}
            options={unionAndVillageOptions}
            allowCustomCreate
            customCreateLabel={(q) => `+ "${q}" নতুন গ্রাম হিসেবে অটো-সেভ ও সিলেক্ট করুন`}
            emptyText="কোনো ইউনিয়ন পাওয়া যায়নি — নাম লিখে Enter চাপুন"
            onSelect={handleVillageChange}
            onCreateCustom={handleCreateCustomVillage}
            onRemoveCustom={handleRemoveCustomVillage}
          />
        </div>
      )}

      {/* Formatted Address Preview & Auto-save Info */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px]">
        <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
          <span className="font-semibold">সংরক্ষিত ঠিকানা:</span>
          <span
            className={`px-2 py-0.5 rounded-md border font-medium ${
              value
                ? 'bg-white dark:bg-slate-900 border-teal-200 dark:border-teal-800 text-teal-800 dark:text-teal-300'
                : 'bg-white/60 dark:bg-slate-900/50 border-slate-200 dark:border-slate-700 text-slate-400'
            }`}
          >
            {value || 'এখনো ঠিকানা নির্বাচিত হয়নি'}
          </span>
          {selectedDistObj && selectedUpaObj && (
            <span className="hidden sm:inline text-slate-400">
              ({selectedUpaObj.b}, {selectedDistObj.b})
            </span>
          )}
        </div>

        <div className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
          <Sparkles className="w-3 h-3" />
          <span>নতুন গ্রামের নাম টাইপ করলে পরবর্তীতে ড্রপডাউনে স্থায়ীভাবে সেভ থাকবে (Auto-Learn)</span>
        </div>
      </div>
    </div>
  );
}
