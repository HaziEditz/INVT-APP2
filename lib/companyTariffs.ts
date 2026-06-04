import { get, ref } from 'firebase/database';
import { getDatabaseInstance } from '@/lib/firebase';
import { Tariff } from '@/types';

function parseTariffNode(id: string, val: unknown): Tariff | null {
  if (!val || typeof val !== 'object') return null;
  const t = val as Record<string, unknown>;
  const name = String(t.name ?? t.label ?? id);
  const flagFall = Number(t.flagFall ?? t.flagfall ?? t.base ?? NaN);
  const ratePerKm = Number(t.ratePerKm ?? t.perKm ?? t.kmRate ?? NaN);
  const waitingPerMin = Number(t.waitingPerMin ?? t.waitPerMin ?? t.waiting ?? NaN);
  if (Number.isNaN(flagFall) || Number.isNaN(ratePerKm)) return null;
  return {
    id,
    name,
    flagFall,
    ratePerKm,
    waitingPerMin: Number.isNaN(waitingPerMin) ? 0 : waitingPerMin,
  };
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
