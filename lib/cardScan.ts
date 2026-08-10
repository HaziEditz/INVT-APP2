/**
 * On-device card scan: capture → OCR → parse → discard image.
 * Works offline after native OCR models are present. Requires a dev/EAS build
 * (expo-ocr-kit is not available in Expo Go).
 */
import { File } from 'expo-file-system';
import {
  assessCardScanQuality,
  parseCardOcrText,
  type CardScanFields,
} from '@/lib/cardOcrParse';

export type { CardScanFields };

export type CardScanResult = CardScanFields & {
  rawText: string;
};

export class CardScanQualityError extends Error {
  fields: CardScanFields;
  constructor(message: string, fields: CardScanFields = {}) {
    super(message);
    this.name = 'CardScanQualityError';
    this.fields = fields;
  }
}

async function discardImage(uri: string | null | undefined): Promise<void> {
  if (!uri) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    /* best-effort — never keep scan photos on purpose */
  }
}

/**
 * Run OCR on a local image URI, parse fields, then delete the file.
 * Throws a clear error if the native OCR module is missing (Expo Go / stale build).
 * Throws CardScanQualityError when the read is too weak — UI should prompt Scan again.
 */
export async function scanCardFromImageUri(uri: string): Promise<CardScanResult> {
  let recognizeText: (imageUri: string) => Promise<{ text?: string; blocks?: { text?: string }[] }>;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-ocr-kit') as {
      recognizeText: (imageUri: string) => Promise<{ text?: string; blocks?: { text?: string }[] }>;
    };
    recognizeText = mod.recognizeText;
  } catch {
    throw new Error(
      'Camera card scan needs a rebuilt app (expo-ocr-kit). Use a development or EAS build, not Expo Go.',
    );
  }

  let ocrText = '';
  try {
    const result = await recognizeText(uri);
    if (result?.text && String(result.text).trim()) {
      ocrText = String(result.text);
    } else if (Array.isArray(result?.blocks)) {
      ocrText = result.blocks.map((b) => b?.text || '').filter(Boolean).join('\n');
    }
  } finally {
    await discardImage(uri);
  }

  const parsed = parseCardOcrText(ocrText);
  const quality = assessCardScanQuality(parsed, ocrText);
  if (!quality.ok) {
    throw new CardScanQualityError(
      quality.reason || 'Could not read the card. Please scan again.',
      quality.fields,
    );
  }
  return { ...quality.fields, rawText: ocrText };
}

export function isCardScanNativeAvailable(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('expo-ocr-kit');
    return true;
  } catch {
    return false;
  }
}
