/**
 * resumeJob.ts — Check the BookaWaka server for an unfinished job on startup.
 *
 * Called every time the driver app starts (or reconnects) so the driver can
 * carry on from where they left off even if the app crashed mid-trip.
 *
 * Endpoint: GET /api/driver/myjob?cid={companyId}&vehicleId={vehicleId}
 */

import { getServerUrl } from './remoteConfig';

export interface ResumedJobData {
  found: true;
  jobId:         string;
  passengerName: string;
  pickAddress:   string;
  dropAddress:   string;
  status:        string;
  fare?:         number;
  paymentType?:  string;
  bookingId?:    string;
}

/**
 * Ask the server if this vehicle has an unfinished job.
 * Returns the job data if found, or null if nothing is pending.
 * Silently swallows network errors — this is a best-effort check.
 */
export async function checkForResumedJob(
  driverId:  string,
  companyId: string,
  vehicleId: string,
): Promise<ResumedJobData | null> {
  if (!driverId || !companyId || !vehicleId) return null;

  try {
    const url = `${getServerUrl()}/api/driver/myjob` +
      `?cid=${encodeURIComponent(companyId)}` +
      `&vehicleId=${encodeURIComponent(vehicleId)}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);

    let res: Response;
    try {
      res = await fetch(url, {
        method:  'GET',
        headers: { 'Content-Type': 'application/json' },
        signal:  controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      console.warn('[ResumeJob] Server returned HTTP', res.status);
      return null;
    }

    const data = await res.json();
    if (data?.found === true && data?.jobId) {
      console.log('[ResumeJob] Unfinished job found:', data.jobId);
      return data as ResumedJobData;
    }

    console.log('[ResumeJob] No pending job on server.');
    return null;
  } catch (err: any) {
    console.warn('[ResumeJob] Check failed (non-fatal):', err?.message);
    return null;
  }
}
