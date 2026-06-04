import { get, ref } from 'firebase/database';
import { getDatabaseInstance } from '@/lib/firebase';
import { DEFAULT_TARIFFS } from '@/lib/tariffs';
import { Tariff } from '@/types';

function parseTariffNode(id: string, val: unknown): Tariff | null {
  if (!val || typeof val !== 'object') return null;
  const t = val as Record<string, unknown>;
  const name = String(t.name ?? t.label ?? id);
  const flagFall = Number(t.flagFall ?? t.flagfall ?? t.base ?? 4.5);
  const ratePerKm = Number(t.ratePerKm ?? t.perKm ?? t.kmRate ?? 3.2);
  const waitingPerMin = Number(t.waitingPerMin ?? t.waitPerMin ?? t.waiting ?? 0.8);
  if (Number.isNaN(flagFall) || Number.isNaN(ratePerKm)) return null;
  return {
    id,
    name,
    flagFall,
    ratePerKm,
    waitingPerMin: Number.isNaN(waitingPerMin) ? 0.8 : waitingPerMin,
  };
}

/** Load tariffs from Firebase `tariffs/{companyId}` with local fallback. */
export async function loadCompanyTariffs(companyId: string): Promise<Tariff[]> {
  if (!companyId) return DEFAULT_TARIFFS;
  try {
    const database = getDatabaseInstance();
    const snap = await get(ref(database, `tariffs/${companyId}`));
    if (!snap.exists()) return DEFAULT_TARIFFS;

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

    return out.length > 0 ? out : DEFAULT_TARIFFS;
  } catch (err) {
    console.warn('[Tariffs] loadCompanyTariffs failed:', err);
    return DEFAULT_TARIFFS;
  }
}
