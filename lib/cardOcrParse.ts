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

const EXPIRY_RE = /\b(0[1-9]|1[0-2])\s*[\/\-.]\s*(\d{2}|\d{4})\b/;
const TM_ID_RE = /\b(\d{4,8})\s*[-–—]\s*(\d{1,4})\b/;
/** Digit runs on a single line only (avoid swallowing MM/YY on the next line). */
const LONG_DIGITS_LINE_RE = /\b(\d(?:[\d -]{10,22})\d)\b/;

function normalizeWhitespace(s: string): string {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Digits-only (and optional hyphen for TM-style IDs). */
export function normalizeCardNumberCandidate(raw: string): string {
  const s = normalizeWhitespace(raw);
  const tm = s.match(TM_ID_RE);
  if (tm) return `${tm[1]}-${tm[2]}`;
  const digits = s.replace(/[^\d]/g, '');
  if (digits.length >= 12 && digits.length <= 19) return digits;
  if (digits.length >= 6 && digits.length <= 11) return digits; // short TM-ish
  return s.replace(/[^\d-]/g, '');
}

export function normalizeExpiryCandidate(raw: string): string | undefined {
  const m = String(raw || '').match(EXPIRY_RE);
  if (!m) return undefined;
  const mm = m[1];
  let yy = m[2];
  if (yy.length === 4) yy = yy.slice(-2);
  return `${mm}/${yy}`;
}

const NAME_BLOCKLIST =
  /^(visa|mastercard|master card|amex|debit|credit|valid|thru|expiry|expires|month|year|member|since|total mobility|totalmobility|eftpos|contactless)$/i;

function looksLikeNameLine(line: string): boolean {
  const s = normalizeWhitespace(line);
  if (s.length < 3 || s.length > 48) return false;
  if (/\d/.test(s)) return false;
  if (EXPIRY_RE.test(s)) return false;
  if (NAME_BLOCKLIST.test(s)) return false;
  const tokens = s.split(' ').filter(Boolean);
  if (tokens.length < 2) return false; // prefer first+last
  return tokens.every((t) => /^[A-Za-z][A-Za-z'.-]*$/.test(t));
}

/**
 * Parse OCR lines / blob into optional card fields.
 * Prefers TM-style `######-##` when present; else longest digit run (bank PAN).
 */
export function parseCardOcrText(input: string | string[]): CardScanFields {
  const lines = (Array.isArray(input) ? input : String(input || '').split(/\r?\n/))
    .map(normalizeWhitespace)
    .filter(Boolean);

  const blob = lines.join('\n');
  const out: CardScanFields = {};

  // Number: TM id first, then longest digit run on a single line
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
      const d = cand.replace(/[^\d]/g, '');
      if (d.length >= 12 && d.length <= 19 && d.length > bestDigits.length) {
        bestDigits = cand;
      }
    }
    if (bestDigits) number = bestDigits;
  }
  if (!number) {
    for (const line of lines) {
      const digits = line.replace(/[^\d]/g, '');
      if (digits.length >= 6 && digits.length <= 19) {
        number = normalizeCardNumberCandidate(line);
        break;
      }
    }
  }
  if (number) out.cardNumber = number;

  const expiry = normalizeExpiryCandidate(blob);
  if (expiry) out.cardExpiry = expiry;

  // Name: longest alphabetic multi-token line (skip brand/program labels)
  let bestName = '';
  for (const line of lines) {
    if (!looksLikeNameLine(line)) continue;
    if (line.length > bestName.length) bestName = line;
  }
  if (bestName) out.cardName = bestName.toUpperCase();

  return out;
}
