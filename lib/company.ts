import { get, ref } from 'firebase/database';
import { database } from '@/lib/firebase';

export interface CompanyInfo {
  id: string;
  name: string;
}

export async function loadCompanyInfo(companyId: string): Promise<CompanyInfo> {
  if (!companyId) return { id: '', name: '' };
  try {
    const snap = await get(ref(database, `companies/${companyId}`));
    if (snap.exists()) {
      const d = snap.val() as Record<string, unknown>;
      const name = String(d.name ?? d.companyName ?? d.CompanyName ?? d.tradingName ?? '').trim();
      return { id: companyId, name: name || `Company ${companyId}` };
    }
  } catch (err) {
    console.warn('[Company] load failed:', err);
  }
  return { id: companyId, name: `Company ${companyId}` };
}
