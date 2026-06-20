import { onValue, ref } from 'firebase/database';
import { DISPATCH_API_URL } from '@/constants/theme';
import { getDatabaseInstance } from '@/lib/firebase';
import { ingestTariffSnapshot, mergeTariffMaps } from '@/lib/parseTariffRecord';
import { Tariff } from '@/types';

/**
 * Live subscription to company tariffs — merges `tariffs/{companyId}` and
 * `tariffZones/{companyId}` the same way dispatch `useTariffs` does.
 * On conflict, tariffZones wins. Also seeds from server API (bypasses RTDB rule gaps).
 */
export async function fetchCompanyTariffsFromApi(companyId: string): Promise<Tariff[]> {
  if (!companyId) return [];
  try {
    const res = await fetch(
      `${DISPATCH_API_URL}/api/company-tariffs?companyId=${encodeURIComponent(companyId)}`,
    );
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      tariffs?: Record<string, Record<string, unknown>>;
    };
    if (!res.ok || !data.ok || !data.tariffs) return [];
    const map = new Map<string, Tariff>();
    ingestTariffSnapshot(data.tariffs, map);
    return mergeTariffMaps([map]);
  } catch (err) {
    console.warn('[Tariffs] API fetch failed:', err);
    return [];
  }
}

export function subscribeCompanyTariffs(
  companyId: string,
  onChange: (tariffs: Tariff[]) => void,
): () => void {
  if (!companyId) {
    onChange([]);
    return () => undefined;
  }

  let database;
  try {
    database = getDatabaseInstance();
  } catch (err) {
    console.warn('[Tariffs] subscribeCompanyTariffs: Firebase not ready', err);
    void fetchCompanyTariffsFromApi(companyId).then(onChange);
    return () => undefined;
  }

  const maps = [new Map<string, Tariff>(), new Map<string, Tariff>(), new Map<string, Tariff>()];

  const sync = () => {
    onChange(mergeTariffMaps(maps));
  };

  const ingest = (idx: number, val: unknown) => {
    ingestTariffSnapshot(val, maps[idx]);
    sync();
  };

  void fetchCompanyTariffsFromApi(companyId).then((apiTariffs) => {
    if (apiTariffs.length) {
      maps[2] = new Map(apiTariffs.map((t) => [t.id, t]));
      sync();
    }
  });

  const tariffsRef = ref(database, `tariffs/${companyId}`);
  const zonesRef = ref(database, `tariffZones/${companyId}`);

  const unsubTariffs = onValue(
    tariffsRef,
    (snap) => ingest(0, snap.val()),
    (err) => console.warn('[Tariffs] tariffs listener failed:', err),
  );
  const unsubZones = onValue(
    zonesRef,
    (snap) => ingest(1, snap.val()),
    (err) => console.warn('[Tariffs] tariffZones listener failed:', err),
  );

  return () => {
    unsubTariffs();
    unsubZones();
  };
}
