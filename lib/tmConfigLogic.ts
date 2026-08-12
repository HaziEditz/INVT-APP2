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
  /** Subsidy on meterFare only (percent, then cap when cap > 0). */
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
  /** True when cap was missing/≤0 so meter subsidy used uncapped %. */
  meterSubsidyUncapped: boolean;
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

/**
 * True when company TM economics can be used to confirm a payment.
 * Null/undefined = still loading or missing at write time.
 * Percent ≤ 0 = DEFAULT / not configured (do not treat as a real 0% policy silently).
 */
export function isTmConfigReadyForConfirm(config: TmConfig | null | undefined): boolean {
  return tmConfigConfirmBlockReason(config) === null;
}

/**
 * Human-readable block reason for TM confirm. Null means OK to proceed.
 * Pass `loading: true` while `loadTmConfig` has not settled (config may still be null).
 */
export function tmConfigConfirmBlockReason(
  config: TmConfig | null | undefined,
  opts?: { loading?: boolean },
): string | null {
  if (opts?.loading || config == null) {
    return 'TM subsidy settings are still loading. Wait a moment, then try again.';
  }
  const pct = Number(config.councilSubsidyPercent);
  if (!Number.isFinite(pct) || pct <= 0) {
    return 'TM subsidy percent is not configured for this company. Ask the office to set council TM rates before completing a TM payment.';
  }
  return null;
}

/**
 * Meter-only subsidy split (legacy helper). Prefer calcTmPaymentBreakdown for payments.
 *
 * Cap ≤ 0 / missing = no valid cap configured → uncapped percentage only.
 * Never `Math.min(pctAmount, 0)` — that silently zeros a valid %.
 */
export function calcTmSplit(
  meterFare: number,
  config: TmConfig,
): { councilPays: number; passengerPays: number; uncapped: boolean } {
  const fare = Math.max(0, Number(meterFare) || 0);
  const pct = Math.max(0, Number(config.councilSubsidyPercent) || 0);
  const capRaw = Number(config.councilCapAmount);
  const cap = Number.isFinite(capRaw) && capRaw > 0 ? capRaw : 0;
  const pctAmount = (fare * pct) / 100;
  const uncapped = cap <= 0;
  const councilPays = uncapped ? pctAmount : Math.min(pctAmount, cap);
  const passengerPays = Math.max(0, fare - councilPays);
  return {
    councilPays: +councilPays.toFixed(2),
    passengerPays: +passengerPays.toFixed(2),
    uncapped,
  };
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
    meterSubsidyUncapped: meterSplit.uncapped,
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
