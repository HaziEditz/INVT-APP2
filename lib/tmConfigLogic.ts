export type TmConfig = {
  councilSubsidyPercent: number;
  councilCapAmount: number;
  hoistCostPerUnit: number;
};

export const DEFAULT_TM_CONFIG: TmConfig = {
  councilSubsidyPercent: 0,
  councilCapAmount: 0,
  hoistCostPerUnit: 0,
};

export function parseTmConfigRecord(d: Record<string, unknown> | null | undefined): TmConfig {
  if (!d || typeof d !== 'object') return { ...DEFAULT_TM_CONFIG };
  return {
    councilSubsidyPercent:
      Number(d.councilSubsidyPercent ?? d.councilPercent ?? d.subsidyPercent ?? 0) || 0,
    councilCapAmount:
      Number(d.councilCapAmount ?? d.capAmount ?? d.subsidyCap ?? 0) || 0,
    hoistCostPerUnit:
      Number(d.hoistCostPerUnit ?? d.hoistUnitCost ?? d.hoistCost ?? d.hoistRatePerUse ?? 0) || 0,
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

export function calcTmSplit(
  totalFare: number,
  config: TmConfig,
): { councilPays: number; passengerPays: number } {
  const councilPays = Math.min(
    (totalFare * config.councilSubsidyPercent) / 100,
    config.councilCapAmount,
  );
  const passengerPays = Math.max(0, totalFare - councilPays);
  return { councilPays: +councilPays.toFixed(2), passengerPays: +passengerPays.toFixed(2) };
}
