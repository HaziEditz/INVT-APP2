import { get, ref } from 'firebase/database';
import { getDatabaseInstance } from '@/lib/firebase';
export {
  isDirectOfferStillLive,
  shouldSuppressReturnedPoolOffer,
} from '@/lib/offerReconciliationPolicy';
import { isDirectOfferStillLive } from '@/lib/offerReconciliationPolicy';

function normalizeId(value: unknown): string {
  return String(value ?? '').trim();
}

/**
 * Reconcile locally cached direct offers against dispatch's allbookings mirror.
 * Read failures are retained (not dropped) so a transient reconnect cannot erase
 * a genuinely live offer.
 */
export async function findStaleDirectOfferIds(
  companyId: string,
  driverId: string,
  offerIds: Iterable<string>,
): Promise<string[]> {
  const cid = normalizeId(companyId);
  const did = normalizeId(driverId);
  if (!cid || !did) return [];

  const ids = [...new Set([...offerIds].map(normalizeId).filter(Boolean))];
  const stale = await Promise.all(
    ids.map(async (offerId): Promise<string | null> => {
      try {
        const snap = await get(
          ref(getDatabaseInstance(), `allbookings/${cid}/${offerId}`),
        );
        const record = snap.exists()
          ? (snap.val() as Record<string, unknown>)
          : null;
        return isDirectOfferStillLive(record, did) ? null : offerId;
      } catch (err) {
        console.warn(`[Offer reconcile] could not verify #${offerId}:`, err);
        return null;
      }
    }),
  );

  return stale.filter((id): id is string => !!id);
}
