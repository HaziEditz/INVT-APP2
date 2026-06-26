import { isForbiddenPlaceholderTariffName } from '@/lib/tariffGuard';
import { calcMeterBreakdown } from '@/lib/tariffs';
import { MeterState, Tariff } from '@/types';

export function readBookingTariffHints(
  raw: Record<string, unknown> | null | undefined,
): { id?: string; name?: string } {
  if (!raw || typeof raw !== 'object') return {};
  const id = String(raw.TarriffId ?? raw.TariffId ?? raw.tariffId ?? '').trim();
  const nameRaw = String(raw.TarriffType ?? raw.TariffName ?? raw.tariffName ?? '').trim();
  const name = nameRaw && !isForbiddenPlaceholderTariffName(nameRaw) ? nameRaw : undefined;
  return { id: id || undefined, name };
}

/** Resolve a company tariff from booking hints — never returns a forbidden placeholder name. */
export function resolveTariffFromList(
  tariffs: Tariff[],
  hints?: { id?: string; name?: string } | null,
): Tariff | null {
  if (!tariffs.length || !hints) return null;
  const id = hints.id?.trim();
  const name = hints.name?.trim();
  if (id) {
    const byId = tariffs.find((t) => t.id === id || String(t.id) === id);
    if (byId) return byId;
  }
  if (name && !isForbiddenPlaceholderTariffName(name)) {
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
