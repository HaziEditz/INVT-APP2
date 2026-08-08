export type TmConfig = {
  councilSubsidyPercent: number;
  councilCapAmount: number;
  hoistCostPerUnit: number;
  /** Set by Phase 1 council→company sync. */
  sourceCouncilId?: string;
};

export const DEFAULT_TM_CONFIG: TmConfig = {
  councilSubsidyPercent: 0,
  councilCapAmount: 0,
  hoistCostPerUnit: 0,
};

/** NZ TM: hoist is always 100% council-paid and never enters the meter %/cap split. */
export type TmPaymentBreakdown = {
  /** Meter + extras only (no hoist). */
  meterFare: number;
  hoistCount: number;
  hoistCostPerUnit: number;
  /** Always hoistCount × rate; 100% council. */
  hoistTotal: number;
  /** Subsidy on meterFare only (percent, then cap). */
  councilPaysMeter: number;
  passengerPaysMeter: number;
  /** === hoistTotal */
  councilPaysHoist: number;
  /** Always 0 */
  passengerPaysHoist: number;
  /** councilPaysMeter + councilPaysHoist */
  councilPays: number;
  /** passengerPaysMeter only (what driver collects) */
  passengerPays: number;
  /** meterFare + hoistTotal */
  totalFare: number;
};

export function parseTmConfigRecord(d: Record<string, unknown> | null | undefined): TmConfig {
  if (!d || typeof d !== 'object') return { ...DEFAULT_TM_CONFIG };
  const sourceCouncilId = String(d.sourceCouncilId || d.councilId || '').trim();
  return {
    councilSubsidyPercent:
      Number(d.councilSubsidyPercent ?? d.councilPercent ?? d.subsidyPercent ?? 0) || 0,
    councilCapAmount:
      Number(d.councilCapAmount ?? d.capAmount ?? d.subsidyCap ?? 0) || 0,
    hoistCostPerUnit:
      Number(d.hoistCostPerUnit ?? d.hoistUnitCost ?? d.hoistCost ?? d.hoistRatePerUse ?? 0) || 0,
    ...(sourceCouncilId ? { sourceCouncilId } : {}),
  };
}

/**
 * Map council `tmConfig/{councilId}` fields → company driver-split shape.
 * Kept in sync with SA `companyTmConfigFromCouncil` in tm-helpers.js.
 */
export function mapCouncilRecordToCompanyTmConfig(
  councilId: string,
  council: Record<string, unknown> | null | undefined,
): TmConfig & {
  councilPercent: number;
  passengerPercent: number;
  sourceCouncilId: string;
} {
  const parsed = parseTmConfigRecord(council);
  return {
    ...parsed,
    councilPercent: parsed.councilSubsidyPercent,
    passengerPercent: Math.max(0, 100 - parsed.councilSubsidyPercent),
    sourceCouncilId: String(councilId || '').trim(),
  };
}

/** Meter-only subsidy split (legacy helper). Prefer calcTmPaymentBreakdown for payments. */
export function calcTmSplit(
  meterFare: number,
  config: TmConfig,
): { councilPays: number; passengerPays: number } {
  const fare = Math.max(0, Number(meterFare) || 0);
  const pct = Math.max(0, Number(config.councilSubsidyPercent) || 0);
  const cap = Math.max(0, Number(config.councilCapAmount) || 0);
  const councilPays = Math.min((fare * pct) / 100, cap);
  const passengerPays = Math.max(0, fare - councilPays);
  return { councilPays: +councilPays.toFixed(2), passengerPays: +passengerPays.toFixed(2) };
}

/**
 * Phase 2A.1 — meter fare uses % + cap; hoist is separate, 100% council, never in the split.
 */
export function calcTmPaymentBreakdown(
  meterFare: number,
  hoistCount: number,
  config: TmConfig,
): TmPaymentBreakdown {
  const meter = Math.max(0, Number(meterFare) || 0);
  const units = Math.max(0, Math.floor(Number(hoistCount) || 0));
  const rate = Math.max(0, Number(config.hoistCostPerUnit) || 0);
  const hoistTotal = +(units * rate).toFixed(2);
  const meterSplit = calcTmSplit(meter, config);
  return {
    meterFare: +meter.toFixed(2),
    hoistCount: units,
    hoistCostPerUnit: +rate.toFixed(2),
    hoistTotal,
    councilPaysMeter: meterSplit.councilPays,
    passengerPaysMeter: meterSplit.passengerPays,
    councilPaysHoist: hoistTotal,
    passengerPaysHoist: 0,
    councilPays: +(meterSplit.councilPays + hoistTotal).toFixed(2),
    passengerPays: meterSplit.passengerPays,
    totalFare: +(meter + hoistTotal).toFixed(2),
  };
}

/** One hoist use = 1× council rate, tied to one TM card (Phase 2A.2 / NZ TM). */
export type TmHoistEntry = {
  cardNumber: string;
  cardExpiry?: string;
  cardName?: string;
  /** Always 1 × rate; stored for audit clarity. */
  amount: number;
};

export function buildTmHoistEntries(
  rows: readonly { cardNumber?: string; cardExpiry?: string; cardName?: string }[],
  hoistCostPerUnit: number,
): TmHoistEntry[] {
  const rate = Math.max(0, Number(hoistCostPerUnit) || 0);
  return (rows || [])
    .map((r) => ({
      cardNumber: String(r?.cardNumber || '').trim(),
      cardExpiry: String(r?.cardExpiry || '').trim() || undefined,
      cardName: String(r?.cardName || '').trim() || undefined,
      amount: +rate.toFixed(2),
    }))
    .filter((r) => r.cardNumber.length > 0);
}

/**
 * Primary TM card for the trip record.
 * If the main field is empty and hoist rows exist, first hoist card is used (UI convenience only —
 * does not combine or reduce hoist fees).
 */
export function resolvePrimaryTmCard(
  primaryCard: string | undefined,
  primaryExpiry: string | undefined,
  hoists: readonly TmHoistEntry[],
  primaryName?: string | undefined,
): { tmCardNumber?: string; tmCardExpiry?: string; tmCardName?: string } {
  const card = String(primaryCard || '').trim();
  const expiry = String(primaryExpiry || '').trim() || undefined;
  const name = String(primaryName || '').trim() || undefined;
  if (card) return { tmCardNumber: card, tmCardExpiry: expiry, tmCardName: name };
  const first = hoists[0];
  if (!first?.cardNumber) return {};
  return {
    tmCardNumber: first.cardNumber,
    tmCardExpiry: first.cardExpiry || expiry,
    tmCardName: first.cardName || name,
  };
}
