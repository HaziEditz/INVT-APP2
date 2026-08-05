import { isForbiddenPlaceholderTariffName } from '@/lib/tariffGuard';
import { calcMeterBreakdown, parseFiniteFare } from '@/lib/tariffs';
import { MeterState, Tariff } from '@/types';

export function readBookingTariffHints(
  raw: Record<string, unknown> | null | undefined,
): { id?: string; name?: string } {
  if (!raw || typeof raw !== 'object') return {};
  const id = String(raw.TarriffId ?? raw.TariffId ?? raw.tariffId ?? '').trim();
  const nameRaw = String(
    raw.TarriffType ?? raw.TariffType ?? raw.tarriffType ?? raw.TariffName ?? raw.tariffName ?? '',
  ).trim();
  const name = nameRaw && !isForbiddenPlaceholderTariffName(nameRaw) ? nameRaw : undefined;
  return { id: id || undefined, name };
}

/** True when booking is fixed-price (tariff id -1 / name Fixed). */
export function isFixedPriceBooking(
  raw: Record<string, unknown> | null | undefined,
): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const id = String(raw.TarriffId ?? raw.TariffId ?? raw.tariffId ?? '').trim();
  if (id === '-1') return true;
  const type = String(
    raw.TarriffType ?? raw.TariffType ?? raw.tarriffType ?? '',
  )
    .trim()
    .toLowerCase();
  const name = String(raw.TarriffName ?? raw.TariffName ?? raw.tariffName ?? '').trim().toLowerCase();
  return type === 'fixed' || name === 'fixed';
}

/** Whether the GPS meter should run (false for fixed-price jobs). */
export function shouldStartMeterForBooking(
  raw: Record<string, unknown> | null | undefined,
  job?: { isFixedPrice?: boolean } | null,
): boolean {
  if (job?.isFixedPrice) return false;
  return !isFixedPriceBooking(raw);
}

/** Fixed fare amount from booking record, if present. */
export function readFixedFareFromBooking(
  raw: Record<string, unknown> | null | undefined,
): number | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  return parseFiniteFare(
    raw.CustomeRate ??
      raw.customRate ??
      raw.CustomRate ??
      raw.RideCost ??
      raw.EstimatedFare ??
      raw.estimatedFare ??
      raw.jobFare ??
      raw.fixedFare ??
      raw.Fare,
  );
}

/** Best-effort fixed fare from booking record and/or active job snapshot. */
export function readFixedFareAmount(
  raw: Record<string, unknown> | null | undefined,
  job?: { fixedFare?: number; estimatedFare?: number; fare?: number } | null,
): number | undefined {
  const fromRaw = readFixedFareFromBooking(raw);
  if (fromRaw != null) return fromRaw;
  return (
    parseFiniteFare(job?.fixedFare) ??
    parseFiniteFare(job?.estimatedFare) ??
    parseFiniteFare(job?.fare)
  );
}

/**
 * Dispatch "Auto" / unset tariff — driver keeps their own selected tariff.
 * Specific tariff id/name → driver should adopt it on accept (can change manually after).
 */
export function isDispatchAutoTariff(
  hints?: { id?: string; name?: string } | null,
): boolean {
  if (!hints) return true;
  const id = hints.id?.trim() ?? '';
  const name = (hints.name?.trim() ?? '').toLowerCase();
  if (!id && !name) return true;
  if (id === '0') return true;
  if (!id && (name === 'automatic' || name === 'auto')) return true;
  return false;
}

/** Resolve a company tariff from booking hints — never returns a forbidden placeholder name. */
export function resolveTariffFromList(
  tariffs: Tariff[],
  hints?: { id?: string; name?: string } | null,
): Tariff | null {
  if (!tariffs.length || !hints) return null;
  if (isDispatchAutoTariff(hints)) return null;
  const id = hints.id?.trim();
  const name = hints.name?.trim();
  // Skip Fixed (-1) and Auto (0) — neither is a company meter tariff.
  if (id && id !== '-1' && id !== '0') {
    const byId = tariffs.find((t) => t.id === id || String(t.id) === id);
    if (byId) return byId;
  }
  if (
    name &&
    !isForbiddenPlaceholderTariffName(name) &&
    name.toLowerCase() !== 'fixed' &&
    name.toLowerCase() !== 'automatic' &&
    name.toLowerCase() !== 'auto'
  ) {
    const lower = name.toLowerCase();
    const byName = tariffs.find((t) => t.name.trim().toLowerCase() === lower);
    if (byName) return byName;
  }
  return null;
}

export function sanitizeSelectedTariff(tariffs: Tariff[], current: Tariff): Tariff {
  if (!tariffs.length) return current;
  if (!isForbiddenPlaceholderTariffName(current.name)) {
    const refreshed = resolveTariffFromList(tariffs, { id: current.id, name: current.name });
    return refreshed ?? current;
  }
  return resolveTariffFromList(tariffs, { id: current.id }) ?? tariffs[0];
}

/** Replace stale/forbidden meter labels with the live company tariff list. */
export function sanitizeMeterTariff(meter: MeterState, tariffs: Tariff[]): MeterState {
  const resolved =
    resolveTariffFromList(tariffs, { id: meter.tariffId, name: meter.tariffName }) ??
    (isForbiddenPlaceholderTariffName(meter.tariffName)
      ? resolveTariffFromList(tariffs, { id: meter.tariffId })
      : null);
  if (!resolved || resolved.name === meter.tariffName) return meter;
  const waitMin = meter.waitingMs / 60000;
  const breakdown = calcMeterBreakdown(resolved, meter.distanceKm, waitMin);
  return {
    ...meter,
    tariffId: resolved.id,
    tariffName: resolved.name,
    breakdown,
    fare: breakdown.total,
  };
}
