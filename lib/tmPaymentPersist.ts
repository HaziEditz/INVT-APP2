/**
 * TM payment persistence helpers — closed jobs, claim filters, expiry UX.
 */
import type { TmPaymentDetails } from '@/types';

/** Auto-format MMYY / MM/YY typing into MM/YY (max 5 chars). */
export function formatTmCardExpiryInput(raw: string): string {
  const digits = String(raw || '')
    .replace(/\D/g, '')
    .slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

/** Require first + last (2+ whitespace-separated tokens) for TM cardholder names. */
export function isCompleteCardholderName(raw: string | null | undefined): boolean {
  const parts = String(raw || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return parts.length >= 2;
}

export function isTmCompletedJobRecord(job: Record<string, unknown> | null | undefined): boolean {
  if (!job || typeof job !== 'object') return false;
  if (job.isTotalMobility === true || job.tmUsed === true) return true;
  const pt = String(job.paymentType || job.PaymentType || job.paymentMethod || '')
    .toLowerCase()
    .replace(/[_\s-]/g, '');
  if (pt === 'tm' || pt === 'totalmobility') return true;
  if (job.tmCouncilPays != null || job.councilPays != null) return true;
  if (job.tmSubsidyFare != null || job.tmSubsidy != null) return true;
  if (job.tmCardNumber || job.tmVoucherNo) return true;
  if (Array.isArray(job.tmHoists) && job.tmHoists.length > 0) return true;
  return false;
}

/** Fields written onto closed/completed job records for billing + Closed Job UI. */
export function buildTmPersistFields(
  tmDetails: TmPaymentDetails,
  opts?: { councilId?: string; remainderPaymentType?: string },
): Record<string, unknown> {
  assertTmPaymentDetailsWritable(tmDetails);
  const hoist =
    Number(tmDetails.tmSubsidyHoist != null ? tmDetails.tmSubsidyHoist : tmDetails.hoistTotal) || 0;
  // Claim fields are meter %/cap only — never fold flat hoist into tmSubsidy/tmCouncilPays.
  const meterClaim =
    tmDetails.tmSubsidyFare != null
      ? Number(tmDetails.tmSubsidyFare) || 0
      : Math.max(0, (Number(tmDetails.councilPays) || 0) - hoist);
  const passengerPays = Number(tmDetails.passengerPays) || 0;
  const card = String(tmDetails.tmCardNumber || '').trim();
  const councilId = String(opts?.councilId || tmDetails.councilId || '').trim();
  return {
    isTotalMobility: true,
    tmUsed: true,
    // Remainder method stays in paymentType; these mark the trip as TM for claims.
    tmPaymentType: 'total_mobility',
    paymentCategory: 'total_mobility',
    tmCouncilPays: meterClaim,
    tmPassengerPays: passengerPays,
    // Legacy aliases used by owner/SA claim UIs (meter claim only)
    tmSubsidy: meterClaim,
    councilPays: meterClaim,
    passengerPays,
    tmMeterFare: tmDetails.meterFare,
    tmSubsidyFare: meterClaim,
    tmSubsidyHoist: tmDetails.tmSubsidyHoist ?? tmDetails.hoistTotal,
    hoistTotal: tmDetails.hoistTotal,
    hoistCount: tmDetails.hoistCount,
    tmHoistCount: tmDetails.hoistCount,
    tmHoists: tmDetails.tmHoists?.length ? tmDetails.tmHoists : undefined,
    tmCardNumber: card || undefined,
    tmCardName: tmDetails.tmCardName || undefined,
    tmCardExpiry: tmDetails.tmCardExpiry || undefined,
    tmVoucherNo: card || undefined,
    tmTotalFare: tmDetails.totalFare,
    tmRemainderPaymentType: opts?.remainderPaymentType || undefined,
    ...(councilId ? { councilId, tmCouncilId: councilId } : {}),
  };
}

/**
 * Second-line write guard: never persist a TM trip that looks like the silent
 * missing-config zero-subsidy footgun (positive meter, $0 meter subsidy).
 */
export function assertTmPaymentDetailsWritable(tmDetails: TmPaymentDetails): void {
  const meter = Number(tmDetails.meterFare) || 0;
  const hoist =
    Number(tmDetails.tmSubsidyHoist != null ? tmDetails.tmSubsidyHoist : tmDetails.hoistTotal) || 0;
  const meterSub =
    tmDetails.tmSubsidyFare != null
      ? Number(tmDetails.tmSubsidyFare) || 0
      : Math.max(0, (Number(tmDetails.councilPays) || 0) - hoist);
  if (meter > 0.009 && meterSub <= 0) {
    throw new Error(
      'TM payment refused: subsidy is $0 with a positive meter fare. Wait for TM settings to load, or ask the office to configure council TM rates.',
    );
  }
}

export type TmTripStatusSeed = {
  status: 'pending';
  councilId: string;
  companyId: string;
  submittedAt: number;
  source: 'driver_complete';
  isTotalMobility: true;
  tmCardNumber?: string;
  tmCouncilPays?: number;
  tmPassengerPays?: number;
};

export function buildTmTripStatusSeed(
  companyId: string,
  councilId: string,
  tmDetails: TmPaymentDetails,
): TmTripStatusSeed {
  const hoist =
    Number(tmDetails.tmSubsidyHoist != null ? tmDetails.tmSubsidyHoist : tmDetails.hoistTotal) || 0;
  const meterClaim =
    tmDetails.tmSubsidyFare != null
      ? Number(tmDetails.tmSubsidyFare) || 0
      : Math.max(0, (Number(tmDetails.councilPays) || 0) - hoist);
  return {
    status: 'pending',
    councilId: String(councilId).trim(),
    companyId: String(companyId).trim(),
    submittedAt: Date.now(),
    source: 'driver_complete',
    isTotalMobility: true,
    tmCardNumber: tmDetails.tmCardNumber,
    tmCouncilPays: meterClaim,
    tmPassengerPays: tmDetails.passengerPays,
  };
}

const TM_FORWARD_KEYS = [
  'isTotalMobility',
  'tmUsed',
  'tmPaymentType',
  'paymentCategory',
  'tmCouncilPays',
  'tmPassengerPays',
  'tmSubsidy',
  'councilPays',
  'passengerPays',
  'tmMeterFare',
  'tmSubsidyFare',
  'tmSubsidyHoist',
  'hoistTotal',
  'hoistCount',
  'tmHoistCount',
  'tmHoists',
  'tmCardNumber',
  'tmCardName',
  'tmCardExpiry',
  'tmVoucherNo',
  'tmTotalFare',
  'tmRemainderPaymentType',
  'councilId',
  'tmCouncilId',
] as const;

/**
 * Pull TM persist fields from a journal/offline/complete payload for re-forwarding.
 * Accepts either `buildTmPersistFields` output or raw `TmPaymentDetails` shape.
 */
export function pickTmFieldsFromPayload(
  payload: Record<string, unknown> | null | undefined,
  opts?: { remainderPaymentType?: string },
): Record<string, unknown> | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  if (payload.isTotalMobility === true || payload.tmUsed === true || payload.tmCouncilPays != null) {
    const out: Record<string, unknown> = {};
    for (const k of TM_FORWARD_KEYS) {
      if (payload[k] !== undefined && payload[k] !== null) out[k] = payload[k];
    }
    return Object.keys(out).length ? out : undefined;
  }
  // Raw TmPaymentDetails-ish journal event (councilPays / tmCardNumber).
  if (
    payload.councilPays == null &&
    !payload.tmCardNumber &&
    !payload.tmVoucherNo &&
    !(Array.isArray(payload.tmHoists) && payload.tmHoists.length)
  ) {
    return undefined;
  }
  return buildTmPersistFields(
    {
      councilPays: Number(payload.councilPays) || 0,
      passengerPays: Number(payload.passengerPays) || 0,
      meterFare: payload.meterFare != null ? Number(payload.meterFare) : undefined,
      tmSubsidyFare: payload.tmSubsidyFare != null ? Number(payload.tmSubsidyFare) : undefined,
      hoistTotal: payload.hoistTotal != null ? Number(payload.hoistTotal) : undefined,
      tmSubsidyHoist:
        payload.tmSubsidyHoist != null ? Number(payload.tmSubsidyHoist) : undefined,
      hoistCount: payload.hoistCount != null ? Number(payload.hoistCount) : undefined,
      tmHoists: Array.isArray(payload.tmHoists)
        ? (payload.tmHoists as TmPaymentDetails['tmHoists'])
        : undefined,
      tmCardNumber: payload.tmCardNumber != null ? String(payload.tmCardNumber) : undefined,
      tmCardName: payload.tmCardName != null ? String(payload.tmCardName) : undefined,
      tmCardExpiry: payload.tmCardExpiry != null ? String(payload.tmCardExpiry) : undefined,
      totalFare: Number(payload.totalFare ?? payload.fare ?? 0) || 0,
      councilId: payload.councilId != null ? String(payload.councilId) : undefined,
    },
    {
      councilId: payload.councilId != null ? String(payload.councilId) : undefined,
      remainderPaymentType:
        opts?.remainderPaymentType ||
        (payload.tmRemainderPaymentType != null
          ? String(payload.tmRemainderPaymentType)
          : payload.paymentType != null
            ? String(payload.paymentType)
            : undefined),
    },
  );
}
