import { get, ref } from 'firebase/database';
import { getDatabaseInstance } from '@/lib/firebase';
import { Tariff } from '@/types';

function parseTariffNode(id: string, val: unknown): Tariff | null {
  if (!val || typeof val !== 'object') return null;
  const t = val as Record<string, unknown>;
  const name = String(t.name ?? t.label ?? t.TariffName ?? id);
  const flagFall = Number(
    t.flagFall ?? t.flagfall ?? t.base ?? t.baseFare ?? NaN,
  );
  const ratePerKm = Number(
    t.ratePerKm ?? t.perKm ?? t.kmRate ?? t.pricePerKm ?? NaN,
  );
  const waitingPerMin = Number(
    t.waitingPerMin ??
      t.waitPerMin ??
      t.waiting ??
      t.waitingRate ??
      t.waitingCostPerMin ??
      t.waitingPerMinute ??
      NaN,
  );
  if (Number.isNaN(flagFall) || Number.isNaN(ratePerKm)) return null;
  const out: Tariff = {
    id,
    name,
    flagFall,
    ratePerKm,
    waitingPerMin: Number.isNaN(waitingPerMin) ? 0 : waitingPerMin,
  };
  if (t.nightEnabled) {
    out.nightEnabled = true;
    out.nightStart = String(t.nightStart ?? '22:00');
    out.nightEnd = String(t.nightEnd ?? '06:00');
    out.nightFlagFall = Number(t.nightFlagFall ?? t.nightBaseFare ?? flagFall);
    out.nightRatePerKm = Number(t.nightRatePerKm ?? t.nightPricePerKm ?? ratePerKm);
    out.nightWaitingPerMin = Number(
      t.nightWaitingPerMin ?? t.nightWaitingRate ?? out.waitingPerMin,
    );
  }
  if (t.weekendEnabled) {
    out.weekendEnabled = true;
    out.weekendMultiplier = Number(t.weekendMultiplier ?? 1.2);
  }
  if (t.holidayEnabled) {
    out.holidayEnabled = true;
    out.holidayMultiplier = Number(t.holidayMultiplier ?? 1.5);
  }
  return out;
}

/** Load tariffs from Firebase `tariffs/{companyId}` only. */
export async function loadCompanyTariffs(companyId: string): Promise<Tariff[]> {
  if (!companyId) return [];
  try {
    const database = getDatabaseInstance();
    const snap = await get(ref(database, `tariffs/${companyId}`));
    if (!snap.exists()) return [];

    const val = snap.val();
    const out: Tariff[] = [];

    if (Array.isArray(val)) {
      val.forEach((item, i) => {
        const t = parseTariffNode(String(i), item);
        if (t) out.push(t);
      });
    } else if (val && typeof val === 'object') {
      Object.entries(val as Record<string, unknown>).forEach(([key, item]) => {
        const t = parseTariffNode(key, item);
        if (t) out.push(t);
      });
    }

    return out;
  } catch (err) {
    console.warn('[Tariffs] loadCompanyTariffs failed:', err);
    return [];
  }
}
