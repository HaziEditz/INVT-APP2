import { get, ref } from 'firebase/database';
import { database } from '@/lib/firebase';

export interface CompanyInfo {
  id: string;
  name: string;
}

export async function loadCompanyInfo(companyId: string, driverUid?: string): Promise<CompanyInfo> {
  if (!companyId) return { id: '', name: '' };

  let name = '';

  try {
    const snap = await get(ref(database, `companies/${companyId}`));
    if (snap.exists()) {
      const d = snap.val() as Record<string, unknown>;
      name = String(d.name ?? d.companyName ?? d.CompanyName ?? d.tradingName ?? '').trim();
    }
  } catch (err) {
    console.warn('[Company] companies/ read failed:', err);
  }

  if (!name && driverUid) {
    try {
      const snap = await get(ref(database, `drivers/${companyId}/${driverUid}`));
      if (snap.exists()) {
        const d = snap.val() as Record<string, unknown>;
        name = String(d.companyName ?? d.CompanyName ?? d.fleetName ?? '').trim();
      }
    } catch {
      // non-fatal
    }
  }

  return { id: companyId, name: name || `Company ${companyId}` };
}
