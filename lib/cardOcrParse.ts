/**
 * Heuristic parsers for OCR text from TM / bank cards.
 * Pure JS — no camera/OCR native deps. Used by driver app (and later passenger clients).
 * Always treat results as prefill candidates; never auto-submit without driver confirm.
 */

export type CardScanFields = {
  cardNumber?: string;
  cardName?: string;
  cardExpiry?: string;
};

export type CardScanQuality = {
  ok: boolean;
  /** Driver-facing message when ok is false — prompt Scan again. */
  reason?: string;
  fields: CardScanFields;
};

const EXPIRY_RE = /\b(0[1-9]|1[0-2])\s*[\/\-.]\s*(\d{2}|\d{4})\b/;
const TM_ID_RE = /\b(\d{4,8})\s*[-–—]\s*(\d{1,4})\b/;
/** Digit runs on a single line only (avoid swallowing MM/YY on the next line). */
const LONG_DIGITS_LINE_RE = /\b(\d(?:[\d -]{10,24})\d)\b/;

/** Brand / chrome labels — never cardholder names. */
const NAME_BLOCKLIST_EXACT =
  /^(visa|mastercard|master card|amex|american express|debit|credit|valid|thru|expiry|expires|month|year|member|since|total mobility|totalmobility|eftpos|contactless|debit card|credit card)$/i;

/** Signature strip / boilerplate substrings (issue: "Authorized Signature"). */
const NAME_BLOCKLIST_PARTIAL =
  /\b(authorized|authorised|signature|cardholder|please sign|not valid|magnetic|stripe|cvv|cvc|chip|contactless|bank of|credit union)\b/i;

function normalizeWhitespace(s: string): string {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function digitCount(s: string): number {
  return String(s || '').replace(/[^\d]/g, '').length;
}

/** Bank PAN length (ISO/IEC 7812); TM hyphen ids are handled separately. */
export function isPlausibleBankPan(digitsOrFormatted: string): boolean {
  const d = digitCount(digitsOrFormatted);
  return d >= 13 && d <= 19;
}

/** Optional Luhn — rejects many garbled OCR PANs; TM hyphen ids skip this. */
export function passesLuhn(digitsOrFormatted: string): boolean {
  const digits = String(digitsOrFormatted || '').replace(/[^\d]/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/** Digits-only (and optional hyphen for TM-style IDs). */
export function normalizeCardNumberCandidate(raw: string): string {
  const s = normalizeWhitespace(raw);
  const tm = s.match(TM_ID_RE);
  if (tm) return `${tm[1]}-${tm[2]}`;
  const digits = s.replace(/[^\d]/g, '');
  if (digits.length >= 13 && digits.length <= 19) return digits;
  // Short digit-only runs are not accepted as bank PANs (blurry OCR truncations).
  return '';
}

export function normalizeExpiryCandidate(raw: string): string | undefined {
  const m = String(raw || '').match(EXPIRY_RE);
  if (!m) return undefined;
  const mm = m[1];
  let yy = m[2];
  if (yy.length === 4) yy = yy.slice(-2);
  return `${mm}/${yy}`;
}

function looksLikeNameLine(line: string): boolean {
  const s = normalizeWhitespace(line);
  if (s.length < 5 || s.length > 48) return false;
  if (/\d/.test(s)) return false;
  if (EXPIRY_RE.test(s)) return false;
  if (NAME_BLOCKLIST_EXACT.test(s)) return false;
  if (NAME_BLOCKLIST_PARTIAL.test(s)) return false;
  const tokens = s.split(' ').filter(Boolean);
  if (tokens.length < 2 || tokens.length > 5) return false;
  // Prefer real given/family names: at most one single-letter initial, rest ≥2 chars.
  let singles = 0;
  let longish = 0;
  for (const t of tokens) {
    if (!/^[A-Za-z][A-Za-z'.-]*$/.test(t)) return false;
    if (t.length === 1) singles += 1;
    else if (t.length >= 2) {
      /* ok */
    } else return false;
    if (t.length >= 3) longish += 1;
  }
  if (singles > 1) return false;
  if (longish < 1) return false;
  // Reject OCR fragment soup like "AME BG H AT" (many short ALL-CAPS crumbs).
  const shortish = tokens.filter((t) => t.length <= 3).length;
  if (tokens.length >= 3 && shortish === tokens.length) return false;
  return true;
}

function scoreNameLine(line: string): number {
  // Prefer longer, more word-like names over short OCR crumbs.
  const tokens = normalizeWhitespace(line).split(' ').filter(Boolean);
  let score = line.length;
  for (const t of tokens) {
    if (t.length >= 4) score += 4;
    else if (t.length >= 3) score += 2;
    else score -= 2;
  }
  return score;
}

/**
 * Parse OCR lines / blob into optional card fields.
 * Prefers TM-style `######-##` when present; else longest plausible bank PAN (13–19 digits).
 */
export function parseCardOcrText(input: string | string[]): CardScanFields {
  const lines = (Array.isArray(input) ? input : String(input || '').split(/\r?\n/))
    .map(normalizeWhitespace)
    .filter(Boolean);

  const blob = lines.join('\n');
  const out: CardScanFields = {};
  const tmContext = /total\s*mobility|totalmobility/i.test(blob);

  // Number: TM id first, then longest bank PAN on a single line (no short truncations).
  let number: string | undefined;
  for (const line of lines) {
    if (TM_ID_RE.test(line)) {
      number = normalizeCardNumberCandidate(line);
      break;
    }
  }
  if (!number) {
    let bestDigits = '';
    for (const line of lines) {
      const m = line.match(LONG_DIGITS_LINE_RE);
      if (!m) continue;
      const cand = normalizeCardNumberCandidate(m[1]);
      if (!cand || !isPlausibleBankPan(cand)) continue;
      const d = digitCount(cand);
      if (d > digitCount(bestDigits)) bestDigits = cand;
    }
    if (bestDigits) {
      // Prefer Luhn-valid PANs when any candidate passes; otherwise keep longest.
      const luhnOk = passesLuhn(bestDigits);
      if (luhnOk) {
        number = bestDigits;
      } else {
        // Try other PAN-length runs for a Luhn match before accepting non-Luhn.
        let luhnBest = '';
        for (const line of lines) {
          const m = line.match(LONG_DIGITS_LINE_RE);
          if (!m) continue;
          const cand = normalizeCardNumberCandidate(m[1]);
          if (cand && passesLuhn(cand) && digitCount(cand) > digitCount(luhnBest)) {
            luhnBest = cand;
          }
        }
        number = luhnBest || bestDigits;
      }
    }
  }
  // TM context only: allow compact numeric ids without hyphen (6–11), never for bank scans.
  if (!number && tmContext) {
    for (const line of lines) {
      if (TM_ID_RE.test(line)) {
        number = normalizeCardNumberCandidate(line);
        break;
      }
      const digits = line.replace(/[^\d]/g, '');
      if (digits.length >= 6 && digits.length <= 11 && !EXPIRY_RE.test(line)) {
        number = digits;
        break;
      }
    }
  }
  if (number) out.cardNumber = number;

  const expiry = normalizeExpiryCandidate(blob);
  if (expiry) out.cardExpiry = expiry;

  // Name: best alphabetic multi-token line (skip brand / signature-strip labels)
  let bestName = '';
  let bestScore = -Infinity;
  for (const line of lines) {
    if (!looksLikeNameLine(line)) continue;
    const sc = scoreNameLine(line);
    if (sc > bestScore) {
      bestScore = sc;
      bestName = line;
    }
  }
  if (bestName) out.cardName = bestName.toUpperCase();

  return out;
}

/**
 * Gate OCR prefills: reject blurry/truncated/garbled reads so the UI prompts Scan again
 * instead of showing confident-looking wrong data.
 */
export function assessCardScanQuality(
  fields: CardScanFields,
  rawText = '',
): CardScanQuality {
  const cleaned: CardScanFields = { ...fields };
  const raw = String(rawText || '');
  const alnumLines = raw
    .split(/\r?\n/)
    .map(normalizeWhitespace)
    .filter((l) => /[A-Za-z0-9]/.test(l));

  // Near-empty OCR ≈ too blurry / dark / angled.
  if (alnumLines.length < 2 && digitCount(raw) < 8) {
    return {
      ok: false,
      reason: 'Photo too unclear. Hold steady in good light and scan again.',
      fields: {},
    };
  }

  if (cleaned.cardName && !looksLikeNameLine(cleaned.cardName)) {
    delete cleaned.cardName;
  }

  const tmContext = /total\s*mobility|totalmobility/i.test(raw);
  const num = String(cleaned.cardNumber || '').trim();
  const tmId = TM_ID_RE.test(num);
  const panDigitsOk = isPlausibleBankPan(num);
  const panLuhnOk = panDigitsOk && passesLuhn(num);
  const tmShortOk =
    tmContext && !tmId && digitCount(num) >= 6 && digitCount(num) <= 11;

  const hasGoodNumber = tmId || panLuhnOk || (panDigitsOk && tmContext) || tmShortOk;

  if (num && !hasGoodNumber) {
    delete cleaned.cardNumber;
  }

  if (!cleaned.cardNumber) {
    return {
      ok: false,
      reason:
        'Could not read a full card number. Hold the card flat and scan again.',
      fields:
        cleaned.cardExpiry || cleaned.cardName
          ? {
              ...(cleaned.cardName ? { cardName: cleaned.cardName } : {}),
              ...(cleaned.cardExpiry ? { cardExpiry: cleaned.cardExpiry } : {}),
            }
          : {},
    };
  }

  return { ok: true, fields: cleaned };
}
