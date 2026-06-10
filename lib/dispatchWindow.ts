/** True when a pending job is within its dispatch window (safe to show drivers). */
export function isDispatchWindowOpen(val: Record<string, unknown>): boolean {
  const status = String(val.Status ?? val.status ?? 'Pending').toLowerCase();
  if (status === 'scheduled') return false;

  const now = Date.now();
  const notifyAt = val.NotifyDispatchAt ?? val.notifyDispatchAt;
  if (notifyAt) {
    const ms = Date.parse(String(notifyAt));
    if (!Number.isNaN(ms) && now < ms) return false;
  }

  const dispatchBefore =
    parseInt(String(val.DispatchTimebefore ?? val.dispatchTimebefore ?? val.NotifyDispatchBeforeMinutes ?? 0), 10) || 0;
  if (dispatchBefore <= 0) return true;

  const scheduledFor = parseInt(String(val.ScheduledFor ?? val.scheduledFor ?? 0), 10) || 0;
  const pickupStr = String(val.Pickingtime ?? val.BookingDateTime ?? val.bookingDateTime ?? '');
  let pickupMs = scheduledFor;
  if (!pickupMs && pickupStr) {
    pickupMs = Date.parse(pickupStr);
  }
  if (!pickupMs || Number.isNaN(pickupMs)) return true;

  return now >= pickupMs - dispatchBefore * 60_000;
}
