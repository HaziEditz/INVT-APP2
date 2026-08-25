/** Keep in sync with DRIVER_PAYMENT_TYPES in types/index.ts (avoid importing types → @/aliases in unit tests). */
const DRIVER_PAYMENT_TYPES = [
  'Cash',
  'Card',
  'EFTPOS',
  'Account',
  'TM',
  'ACC',
] as const;

export type NormalizedDriverPaymentType = (typeof DRIVER_PAYMENT_TYPES)[number];

/** Normalize dispatch/Firebase payment strings to driver UI payment types. */
export function normalizeDriverPaymentType(
  raw: string | undefined | null,
): NormalizedDriverPaymentType | undefined {
  if (raw == null) return undefined;
  const s = String(raw).trim();
  if (!s) return undefined;
  const exact = DRIVER_PAYMENT_TYPES.find((p) => p.toLowerCase() === s.toLowerCase());
  if (exact) return exact;
  const t = s.toLowerCase();
  if (t.includes('account') || t.includes('corporate') || t.includes('invoice')) return 'Account';
  if (t.includes('stripe') || t.includes('card')) return 'Card';
  if (t.includes('eftpos')) return 'EFTPOS';
  if (t === 'tm' || t.includes('total mobility') || t.includes('totalmobility')) return 'TM';
  if (t === 'acc' || /(^|[^a-z])acc([^a-z]|$)/i.test(s)) return 'ACC';
  if (t.includes('cash')) return 'Cash';
  return undefined;
}

export function readAccountFieldsFromRecord(val: Record<string, unknown>): {
  accountId?: string;
  accountName?: string;
} {
  const accountId = String(
    val.jobAccountId ??
      val.Account_id ??
      val.AccountId ??
      val.accountId ??
      val.account_id ??
      val.accountNumber ??
      val.AccountNumber ??
      '',
  ).trim();
  const accountName = String(
    val.jobAccountName ??
      val.Account_Name ??
      val.AccountName ??
      val.accountName ??
      val.account_name ??
      '',
  ).trim();
  return {
    ...(accountId ? { accountId } : {}),
    ...(accountName ? { accountName } : {}),
  };
}
