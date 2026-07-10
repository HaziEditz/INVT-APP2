import { get, ref, remove } from 'firebase/database';
import { getDatabaseInstance } from '@/lib/firebase';
import { parseIncomingSosAlert, parseIncomingSosResolved } from '@/lib/sosAlert';

/** True when Emergency/{companyId}/{sosDriverId} exists and is not terminal. */
export async function isSosEmergencyActive(
  companyId: string,
  sosDriverId: string,
): Promise<boolean> {
  const cid = String(companyId || '').trim();
  const did = String(sosDriverId || '').trim();
  if (!cid || !did) return false;
  try {
    const snap = await get(ref(getDatabaseInstance(), `Emergency/${cid}/${did}`));
    const val = snap.val() as Record<string, unknown> | null;
    if (!val || typeof val !== 'object') return false;
    const status = String(val.status ?? 'active').toLowerCase();
    return status !== 'resolved' && status !== 'false_alarm';
  } catch (err) {
    console.warn('[SOS] isSosEmergencyActive check failed:', err);
    return false;
  }
}

/** Responder state on Emergency/{companyId}/{sosDriverId}, if present. */
export async function getDriverSosResponseState(
  companyId: string,
  sosDriverId: string,
  driverId: string,
): Promise<string | null> {
  const cid = String(companyId || '').trim();
  const sosId = String(sosDriverId || '').trim();
  const did = String(driverId || '').trim();
  if (!cid || !sosId || !did) return null;
  try {
    const snap = await get(ref(getDatabaseInstance(), `Emergency/${cid}/${sosId}`));
    const val = snap.val() as Record<string, unknown> | null;
    if (!val || typeof val !== 'object') return null;
    const responders = val.responders as Record<string, { state?: string }> | undefined;
    const entry = responders?.[did];
    return entry?.state ? String(entry.state) : null;
  } catch (err) {
    console.warn('[SOS] getDriverSosResponseState failed:', err);
    return null;
  }
}

/** Remove notification payloads for incidents that are no longer active. */
export async function purgeStaleSosNotifications(
  companyId: string,
  driverId: string,
): Promise<void> {
  const cid = String(companyId || '').trim();
  const did = String(driverId || '').trim();
  if (!cid || !did) return;
  const db = getDatabaseInstance();
  const paths = [`notificationSos/${did}`, `notification/${did}`];
  for (const path of paths) {
    try {
      const snap = await get(ref(db, path));
      const val = snap.val() as Record<string, unknown> | null;
      if (!val || typeof val !== 'object') continue;
      if (parseIncomingSosResolved(val)) {
        await remove(ref(db, path));
        continue;
      }
      const alert = parseIncomingSosAlert(val);
      if (!alert) continue;
      const active = await isSosEmergencyActive(cid, alert.sosDriverId);
      if (!active) {
        console.log('[SOS] purging stale notification at', path, alert.incidentId);
        await remove(ref(db, path));
      }
    } catch (err) {
      console.warn('[SOS] purgeStaleSosNotifications failed:', path, err);
    }
  }
}
