// Deterministic Bijoy (SutonnyMJ ANSI) -> Unicode Bengali converter
// Keeps ASCII digits, Khata/Voucher punctuation (/, -, (, ), =) intact for ledger compatibility.

const BIJOY_CHAR_MAP: Record<string, string> = {
  // Independent Vowels
  A: 'অ',
  B: 'ই',
  C: 'ঈ',
  D: 'উ',
  E: 'ঊ',
  F: 'ঋ',
  G: 'এ',
  H: 'ঐ',
  I: 'ও',
  J: 'ঔ',

  // Consonants
  K: 'ক',
  L: 'খ',
  M: 'গ',
  N: 'ঘ',
  O: 'ঙ',
  P: 'চ',
  Q: 'ছ',
  R: 'জ',
  S: 'ঝ',
  T: 'ঞ',
  U: 'ট',
  V: 'ঠ',
  W: 'ড',
  X: 'ঢ',
  Y: 'ণ',
  Z: 'ত',
  _: 'থ',
  '`': 'দ',
  a: 'ধ',
  b: 'ন',
  c: 'প',
  d: 'ফ',
  e: 'ব',
  f: 'ভ',
  g: 'ম',
  h: 'য',
  i: 'র',
  j: 'ল',
  k: 'শ',
  l: 'ষ',
  m: 'স',
  n: 'হ',
  o: 'ড়',
  p: 'ঢ়',
  q: 'য়',
  r: 'ৎ',
  s: 'ং',
  t: 'ঃ',
  u: 'ঁ',

  // Post-base Vowel signs & Modifiers
  v: 'া',
  x: 'ী',
  y: 'ু',
  z: 'ু',
  '~': 'ূ',
  '‚': 'ু',
  '„': 'ৃ',
  '&': '্',
  'Š': 'ৗ',
  '¨': '্য',
  'ª': '্র',
  '«': '্র',
  Ö: '্র',
  'ƒ': '্র',
  '¡': '্ব',
  '¢': '্ফ',
  '£': '্ল',
  '¥': '্ম',

  // Half-forms & Special symbols
  '¤': 'ম্',
  '¦': 'দ্',
  '§': 'হ্ব',
  '¬': 'ঙ্গ',
  '­': '্র',
  '®': 'ক্স',
  '¯': 'স্',
  'Œ': 'চ্',
  'Ž': 'ত্',
  'š': 'ণ্',
  '›': 'ন্',
  'œ': 'প্',
  'ž': 'ল্',
  'Ÿ': 'ষ্',
  '•': 'ন্',
  '–': 'ভ্',
  '—': 'ল্ল',
  '˜': 'হ্ম',
  '™': '্ল',
  '’': 'থ',
  '‘': 'ধ',
  '“': '্ত',
  '”': '্ত',

  // Standard ANSI Conjuncts (0xB0 - 0xFF)
  '°': 'ক্ক',
  '±': 'ক্ট',
  '²': 'ক্ত',
  '³': 'ক্ব',
  '´': 'ক্ম',
  µ: 'ক্র',
  '¶': 'ক্ষ',
  '·': 'ক্স',
  '¸': 'গু',
  '¹': 'গ্ধ',
  'º': 'গ্ন',
  '»': 'গ্ম',
  '¼': 'গ্ল',
  '½': 'ঘ্ন',
  '¾': 'ঙ্ক',
  '¿': 'ঙ্খ',
  À: 'ঙ্খ',
  Á: 'ঙ্গ',
  Â: 'ঙ্ম',
  Ã: 'চ্চ',
  Ä: 'চ্ছ',
  Å: 'চ্ছ্ব',
  Æ: 'জ্ব',
  Ç: 'জ্জ',
  È: 'জ্জ্ব',
  É: 'জ্ঞ',
  Ê: 'জ্র',
  Ë: 'ঞ্চ',
  Ì: 'ঞ্ছ',
  Í: 'ঞ্জ',
  Î: 'ঞ্ঝ',
  Ï: 'ট্ট',
  Ð: 'ট্ব',
  Ñ: 'ট্ম',
  Ò: 'ড্ড',
  Ó: 'ণ্ট',
  Ô: 'ণ্ঠ',
  Õ: 'ণ্ড',
  '×': 'ত্ত',
  Ø: 'ত্ত্ব',
  Ù: 'ত্থ',
  Ú: 'ত্ন',
  Û: 'ত্ব',
  Ü: 'ত্ম',
  Ý: 'ত্র',
  Þ: 'দ্দ',
  ß: 'দ্ধ',
  à: 'দ্ব',
  á: 'দ্ম',
  â: 'ধ্ব',
  ã: 'ধ্ম',
  ä: 'ন্ট',
  å: 'ন্ঠ',
  æ: 'ন্ড',
  ç: 'ন্ত',
  è: 'ন্ত্ব',
  é: 'ন্ত্র',
  ê: 'ন্দ',
  ë: 'ন্দ্ব',
  ì: 'ন্ধ',
  í: 'ন্ন',
  î: 'ন্ব',
  ï: 'ন্ম',
  ð: 'ন্স',
  ñ: 'প্ট',
  ò: 'প্ত',
  ó: 'প্ন',
  ô: 'প্প',
  õ: 'প্স',
  ö: 'ফ্ল',
  '÷': 'ব্জ',
  ø: 'ব্দ',
  ù: 'ব্ধ',
  ú: 'ব্ব',
  û: 'ব্ল',
  ü: 'ভ্র',
  ý: 'ম্ন',
  þ: 'ম্প',
  ÿ: 'ম্ফ',
};

const PRE_VOWEL_MAP: Record<string, string> = {
  w: 'ি',
  '†': 'ে',
  '‡': 'ে',
  ˆ: 'ৈ',
  '‰': 'ৈ',
};

const MODIFIER_CHARS = new Set(['&', '¨', 'ª', '«', 'Ö', 'ƒ', '¡', '¢', '£', '¥', '^', '©']);

const SPECIAL_BIJOY_MARKERS_RE =
  /[†‡ˆ‰Š‹ŒŽ˜™š›œžŸ¡¢£¤¥¦§¨©ª«¬­®¯°±²³´µ¶·¸¹º»¼½¾¿ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþÿ]/;

const BIJOY_BIGRAM_WORD_RE =
  /(?:^|[\s(/\-])(?:Avq|e¨q|Re|wd|Rgv|fwZ©|bZzb|gv-|fvB|fvov|mvBdzi|Bmjvg|nvmvb|ivnvb|iyInv|wjgB|wijb|gvmy`|ivby|bvRvi|AMÖxg|cÖ`vb|bvwn`|†diZ|wcwcB|e¨vsK|e¨vs‡K|K¨v‡k)(?=$|[\s)/\-=,])/i;

export function isSutonnyFontName(fontName?: string | null): boolean {
  if (!fontName) return false;
  const f = fontName.trim().toLowerCase();
  // SutonnyOMJ / Nikosh / SolaimanLipi are Unicode; SutonnyMJ / Bijoy are ANSI
  if (f.includes('sutonnyomj') || f.includes('unicode')) return false;
  return f.includes('sutonny') || f.includes('bijoy') || f.includes('tonny');
}

const KNOWN_ENGLISH_WORDS_RE =
  /^(?:welding|fitter|visa|fee|job|ppe|p\.?p\.?e\.?|cash|bank|bkash|for|the|purpose|of|opening|closing|balance|total|date|income|expense|account|accounts|voucher|khata|general|center|sabuj|sohel|salim|ismail|kazi|mahmmud|md|hasan|n\/a|me\.?no\.?)$/i;

export function looksLikeBijoyText(raw: string): boolean {
  const str = String(raw || '').trim();
  if (!str) return false;
  if (SPECIAL_BIJOY_MARKERS_RE.test(str)) return true;
  if (/[A-Za-z]`|`[A-Za-z]/.test(str)) return true;
  if (BIJOY_BIGRAM_WORD_RE.test(str)) return true;
  return false;
}

function convertBijoySegment(segment: string): string {
  if (!segment) return '';
  // Skip already-Unicode Bengali segments
  if (/[\u0980-\u09FF]/.test(segment)) return segment;

  let out = '';
  let pendingPreVowel = '';
  let joinViramaChain = false;

  const flushPendingVowel = (nextChar?: string) => {
    if (!pendingPreVowel) return;
    if (pendingPreVowel === 'ে' && nextChar === 'v') {
      out += 'ো';
      pendingPreVowel = '';
      return;
    }
    if (pendingPreVowel === 'ৈ' && nextChar === 'v') {
      out += 'ৌ';
      pendingPreVowel = '';
      return;
    }
    if (pendingPreVowel === 'ে' && nextChar === 'Š') {
      out += 'ৌ';
      pendingPreVowel = '';
      return;
    }
    out += pendingPreVowel;
    pendingPreVowel = '';
  };

  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];

    // Pre-base vowel sign (ি, ে, ৈ)
    if (PRE_VOWEL_MAP[ch]) {
      flushPendingVowel();
      pendingPreVowel = PRE_VOWEL_MAP[ch];
      joinViramaChain = false;
      continue;
    }

    // Reph (©): insert 'র্' BEFORE the most recent consonant/conjunct block
    if (ch === '©') {
      // Find start of current consonant/conjunct (walk backward over Virama pairs)
      let pos = out.length;
      if (pos > 0) {
        pos -= 1;
        while (pos >= 2 && out[pos - 1] === '্') {
          pos -= 2;
        }
        out = `${out.slice(0, pos)}র্${out.slice(pos)}`;
      } else {
        out += 'র্';
      }
      joinViramaChain = false;
      const nextAfterReph = segment[i + 1];
      if (pendingPreVowel && nextAfterReph !== 'v' && nextAfterReph !== 'Š') {
        flushPendingVowel();
      }
      continue;
    }

    // '^' after half-form 'ম্' -> 'ব', otherwise '্ব'
    if (ch === '^') {
      if (out.endsWith('্')) {
        out += 'ব';
      } else {
        out += '্ব';
      }
      joinViramaChain = false;
      const nextAfterCaret = segment[i + 1];
      if (
        pendingPreVowel &&
        nextAfterCaret !== 'v' &&
        nextAfterCaret !== 'Š' &&
        (!nextAfterCaret || !MODIFIER_CHARS.has(nextAfterCaret))
      ) {
        flushPendingVowel();
      }
      continue;
    }

    // Check modifiers that extend the current consonant cluster before flushing pre-vowel
    if (MODIFIER_CHARS.has(ch)) {
      const mapped = BIJOY_CHAR_MAP[ch] || '';
      if (ch === '&') {
        out += '্';
        joinViramaChain = true;
      } else {
        out += mapped;
        joinViramaChain = false;
        const nextAfterMod = segment[i + 1];
        if (
          pendingPreVowel &&
          nextAfterMod !== 'v' &&
          nextAfterMod !== 'Š' &&
          (!nextAfterMod || !MODIFIER_CHARS.has(nextAfterMod))
        ) {
          flushPendingVowel();
        }
      }
      continue;
    }

    // Post-base 'v' (া) and 'Š' (ৗ) interact with pendingPreVowel or 'অ'
    if (ch === 'v') {
      if (pendingPreVowel === 'ে' || pendingPreVowel === 'ৈ') {
        flushPendingVowel('v');
        joinViramaChain = false;
        continue;
      }
      flushPendingVowel();
      if (out.endsWith('অ')) {
        out = `${out.slice(0, -1)}আ`;
      } else {
        out += 'া';
      }
      joinViramaChain = false;
      continue;
    }

    if (ch === 'Š') {
      if (pendingPreVowel === 'ে') {
        flushPendingVowel('Š');
        joinViramaChain = false;
        continue;
      }
      flushPendingVowel();
      out += 'ৗ';
      joinViramaChain = false;
      continue;
    }

    // Independent / mapped consonant or vowel
    const mapped = BIJOY_CHAR_MAP[ch];
    if (mapped) {
      const isPostVowelSign =
        mapped === 'ী' || mapped === 'ু' || mapped === 'ূ' || mapped === 'ৃ';

      if (isPostVowelSign) {
        flushPendingVowel();
        out += mapped;
        joinViramaChain = false;
        continue;
      }

      if (joinViramaChain || out.endsWith('্')) {
        out += mapped;
        joinViramaChain = mapped.endsWith('্');
        const nextAfterJoin = segment[i + 1];
        if (
          pendingPreVowel &&
          !joinViramaChain &&
          (!nextAfterJoin ||
            (!MODIFIER_CHARS.has(nextAfterJoin) &&
              nextAfterJoin !== 'v' &&
              nextAfterJoin !== 'Š'))
        ) {
          flushPendingVowel();
        }
        continue;
      }

      if (pendingPreVowel) {
        // First consonant after pendingPreVowel: wait to see if modifier follows
        const nextCh = segment[i + 1];
        out += mapped;
        if (mapped.endsWith('্')) {
          joinViramaChain = true;
        } else if (nextCh && (MODIFIER_CHARS.has(nextCh) || nextCh === 'v' || nextCh === 'Š')) {
          // Keep pendingPreVowel until after modifier / post-kar
        } else {
          flushPendingVowel();
        }
        continue;
      }

      out += mapped;
      joinViramaChain = mapped.endsWith('্');
      continue;
    }

    // Unmapped character (digits, spaces, '/', '-', '(', ')', '=', etc.)
    flushPendingVowel();
    out += ch;
    joinViramaChain = false;
  }

  flushPendingVowel();
  return out;
}

export function convertBijoyToUnicode(raw: string, forceSutonnyFont = false): string {
  const input = String(raw ?? '');
  if (!input.trim()) return input;
  // Already contains Unicode Bengali
  if (/[\u0980-\u09FF]/.test(input)) return input;

  const shouldConvertWhole = forceSutonnyFont || looksLikeBijoyText(input);
  if (!shouldConvertWhole) return input;

  // Preserve clear standalone English tokens/numbers even inside mixed strings
  // while converting Bijoy tokens cleanly.
  const parts = input.split(/(\s+)/);
  return parts
    .map((part) => {
      if (!part || /^\s+$/.test(part)) return part;
      // Pure numbers / punctuation / voucher codes like 13/221, (4582), =, -
      if (/^[0-9.,/()[\]\-:=+৳]+$/.test(part)) return part;
      // Known pure English accounting word without Bijoy markers
      const stripped = part.replace(/^[([{"']+|[)\]}"'.,:;!?=]+$/g, '');
      if (stripped && KNOWN_ENGLISH_WORDS_RE.test(stripped) && !SPECIAL_BIJOY_MARKERS_RE.test(part)) {
        return part;
      }
      return convertBijoySegment(part);
    })
    .join('')
    .replace(/ব্যালেত্র/g, 'ব্যালেন্স');
}
