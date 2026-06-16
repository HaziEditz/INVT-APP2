/** Blocks stray GPS/heartbeat writes after end-shift sign-out for a vehicle session. */
const endedSessions = new Set<string>();

function sessionKey(companyId: string, vehicleId: string): string {
  return `${String(companyId).trim()}/${String(vehicleId).trim().toUpperCase()}`;
}

export function markPresenceSessionEnded(companyId: string, vehicleId: string): void {
  if (!companyId || !vehicleId) return;
  endedSessions.add(sessionKey(companyId, vehicleId));
}

export function clearPresenceSessionEnded(companyId: string, vehicleId: string): void {
  if (!companyId || !vehicleId) return;
  endedSessions.delete(sessionKey(companyId, vehicleId));
}

export function isPresenceSessionEnded(companyId: string, vehicleId: string): boolean {
  if (!companyId || !vehicleId) return false;
  return endedSessions.has(sessionKey(companyId, vehicleId));
}
