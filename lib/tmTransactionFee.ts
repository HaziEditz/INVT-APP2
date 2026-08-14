/**
 * Optional passenger transaction fee on TM remainder payment.
 * Must never enter meterFare / calcTmPaymentBreakdown / council subsidy / claim totals.
 */

export function parseTransactionFeeAmount(raw: string | number | null | undefined): number {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= 0) return 0;
    return +raw.toFixed(2);
  }
  const n = parseFloat(String(raw ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) return 0;
  return +n.toFixed(2);
}

/** Cosmetic label — same field for every remainder method. */
export function tmTransactionFeeLabel(remainderMethod: string | null | undefined): string {
  const m = String(remainderMethod || '').trim();
  if (m === 'EFTPOS') return 'EFTPOS fee';
  if (m === 'Card') return 'Card fee';
  if (m === 'Cash') return 'Cash fee';
  if (m === 'Account') return 'Account fee';
  if (m === 'ACC') return 'ACC fee';
  return 'Transaction fee';
}

/** What the driver actually collects from the passenger (share + optional fee). */
export function passengerCollectedTotal(
  passengerPays: number,
  transactionFee: number | null | undefined,
): number {
  const share = Math.max(0, Number(passengerPays) || 0);
  const fee = parseTransactionFeeAmount(transactionFee);
  return +(share + fee).toFixed(2);
}

/**
 * Claim / DOS / Usage must ignore transactionFee. Mirrors owner `_tmMeterClaim`
 * so tests can prove fee never contaminates subsidy.
 */
export function claimMeterSubsidyFromRecord(t: Record<string, unknown> | null | undefined): number {
  if (!t || typeof t !== 'object') return 0;
  if (t.tmSubsidyFare != null && t.tmSubsidyFare !== '') {
    return parseFloat(String(t.tmSubsidyFare)) || 0;
  }
  return (
    parseFloat(
      String(
        t.tmCouncilPays != null
          ? t.tmCouncilPays
          : t.tmSubsidy != null
            ? t.tmSubsidy
            : t.tmAmount != null
              ? t.tmAmount
              : t.totalMobilityAmount != null
                ? t.totalMobilityAmount
                : 0,
      ),
    ) || 0
  );
}

export function claimPassengerShareFromRecord(
  t: Record<string, unknown> | null | undefined,
): number {
  if (!t || typeof t !== 'object') return 0;
  return (
    parseFloat(
      String(
        t.tmPassengerPays != null
          ? t.tmPassengerPays
          : t.passengerPays != null
            ? t.passengerPays
            : t.patientPays != null
              ? t.patientPays
              : 0,
      ),
    ) || 0
  );
}
