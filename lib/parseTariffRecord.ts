import { Tariff } from '@/types';

/**
 * Parse a single Firebase tariff node into the driver Tariff shape.
 * Keep field aliases in sync with INVT `src/lib/fareEstimate.ts` → parseTariffRecord
 * and TARIFF_PARSER.md in both repos.
 */
export function parseTariffRecord(key: string, rec: Record<string, unknown>): Tariff | null {
  const name = String(
    rec.TariffName ?? rec.tariffName ?? rec.name ?? rec.zoneName ?? rec.label ?? '',
  ).trim();
  if (!name) return null;

  const id = String(rec.Id ?? rec.id ?? key);
  const flagFall = parseFloat(
    String(
      rec.StartPrice ??
        rec.baseFare ??
        rec.startPrice ??
        rec.flagFall ??
        rec.flagfall ??
        rec.base ??
        NaN,
    ),
  );
  const ratePerKm = parseFloat(
    String(
      rec.DistanceRate ??
        rec.pricePerKm ??
        rec.perKm ??
        rec.ratePerKm ??
        rec.kmRate ??
        NaN,
    ),
  );
  const waitingRaw = parseFloat(
    String(
      rec.WaitingRate ??
        rec.waitingRate ??
        rec.waitRate ??
        rec.waitingRatePerMinute ??
        rec.waitingPerMin ??
        rec.waitPerMin ??
        rec.waiting ??
        rec.waitingCostPerMin ??
        rec.waitingPerMinute ??
        0,
    ),
  );

  if (Number.isNaN(flagFall) || Number.isNaN(ratePerKm)) return null;

  const waitingPerMin = Number.isNaN(waitingRaw) ? 0 : waitingRaw;
  const out: Tariff = {
    id,
    name,
    flagFall,
    ratePerKm,
    waitingPerMin,
  };

  if (rec.nightEnabled) {
    out.nightEnabled = true;
    out.nightStart = String(rec.nightStart ?? '22:00');
    out.nightEnd = String(rec.nightEnd ?? '06:00');
    out.nightFlagFall = Number(rec.nightFlagFall ?? rec.nightBaseFare ?? flagFall);
    out.nightRatePerKm = Number(rec.nightRatePerKm ?? rec.nightPricePerKm ?? ratePerKm);
    out.nightWaitingPerMin = Number(
      rec.nightWaitingPerMin ?? rec.nightWaitingRate ?? waitingPerMin,
    );
  }
  if (rec.weekendEnabled) {
    out.weekendEnabled = true;
    out.weekendMultiplier = Number(rec.weekendMultiplier ?? 1.2);
  }
  if (rec.holidayEnabled) {
    out.holidayEnabled = true;
    out.holidayMultiplier = Number(rec.holidayMultiplier ?? 1.5);
  }

  return out;
}

/** Ingest a Firebase snapshot value (array or object map) into a tariff map. */
export function ingestTariffSnapshot(
  val: unknown,
  into: Map<string, Tariff>,
): void {
  into.clear();
  if (!val || typeof val !== 'object') return;

  if (Array.isArray(val)) {
    val.forEach((rec, i) => {
      if (rec && typeof rec === 'object') {
        const t = parseTariffRecord(String(i), rec as Record<string, unknown>);
        if (t) into.set(t.id, t);
      }
    });
    return;
  }

  for (const [key, rec] of Object.entries(val as Record<string, unknown>)) {
    if (key.startsWith('zone_grid_')) continue;
    if (!rec || typeof rec !== 'object') continue;
    const t = parseTariffRecord(key, rec as Record<string, unknown>);
    if (t) into.set(t.id, t);
  }
}

/** Merge tariff maps; later maps override earlier entries with the same id. */
export function mergeTariffMaps(maps: Map<string, Tariff>[]): Tariff[] {
  const out = new Map<string, Tariff>();
  for (const m of maps) {
    for (const [k, v] of m) out.set(k, v);
  }
  return Array.from(out.values());
}
