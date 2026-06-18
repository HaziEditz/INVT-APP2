import { onValue, ref } from 'firebase/database';
import { getDatabaseInstance } from '@/lib/firebase';
import { ingestTariffSnapshot, mergeTariffMaps } from '@/lib/parseTariffRecord';
import { Tariff } from '@/types';

/**
 * Live subscription to company tariffs — merges `tariffs/{companyId}` and
 * `tariffZones/{companyId}` the same way dispatch `useTariffs` does.
 * On conflict, tariffZones wins.
 */
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
    onChange([]);
    return () => undefined;
  }

  const maps = [new Map<string, Tariff>(), new Map<string, Tariff>()];

  const sync = () => {
    onChange(mergeTariffMaps(maps));
  };

  const ingest = (idx: number, val: unknown) => {
    ingestTariffSnapshot(val, maps[idx]);
    sync();
  };

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
