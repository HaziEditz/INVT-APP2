export type IncomingSosAlert = {
  sosDriverId: string;
  incidentId: string;
  driverName: string;
  vehiclenumber: string;
  lat: number;
  lng: number;
  locationAddress: string;
  content: string;
  timestamp: number;
};

export function parseIncomingSosAlert(val: Record<string, unknown>): IncomingSosAlert | null {
  const eventType = String(val.eventType ?? val.type ?? '').toLowerCase();
  if (eventType !== 'driver_sos') return null;
  const sosDriverId = String(val.sosDriverId ?? '').trim();
  if (!sosDriverId) return null;
  return {
    sosDriverId,
    incidentId: String(val.incidentId ?? `sos-${sosDriverId}`).trim(),
    driverName: String(val.driverName ?? 'Driver').trim(),
    vehiclenumber: String(val.vehiclenumber ?? '').trim(),
    lat: Number(val.lat ?? 0) || 0,
    lng: Number(val.lng ?? 0) || 0,
    locationAddress: String(val.locationAddress ?? '').trim(),
    content: String(val.content ?? 'Nearby driver SOS alert').trim(),
    timestamp: Number(val.timestamp ?? Date.now()) || Date.now(),
  };
}

export function parseIncomingSosResolved(val: Record<string, unknown>): {
  sosDriverId: string;
  incidentId: string;
  resolution: 'resolved' | 'false_alarm';
  message: string;
} | null {
  const eventType = String(val.eventType ?? val.type ?? '').toLowerCase();
  if (eventType !== 'sos_resolved') return null;
  const sosDriverId = String(val.sosDriverId ?? '').trim();
  if (!sosDriverId) return null;
  const resolutionRaw = String(val.resolution ?? 'resolved').toLowerCase();
  const resolution = resolutionRaw === 'false_alarm' ? 'false_alarm' : 'resolved';
  return {
    sosDriverId,
    incidentId: String(val.incidentId ?? `sos-${sosDriverId}`).trim(),
    resolution,
    message: String(
      val.content ??
        (resolution === 'false_alarm'
          ? 'Dispatch marked this SOS as a false alarm.'
          : 'Dispatch has resolved this emergency.'),
    ).trim(),
  };
}

export function incomingSosAlertToNotificationData(alert: IncomingSosAlert): Record<string, string> {
  return {
    type: 'driver_sos',
    eventType: 'driver_sos',
    sosDriverId: alert.sosDriverId,
    incidentId: alert.incidentId,
    driverName: alert.driverName,
    vehiclenumber: alert.vehiclenumber,
    lat: String(alert.lat),
    lng: String(alert.lng),
    locationAddress: alert.locationAddress,
    content: alert.content,
    timestamp: String(alert.timestamp),
  };
}
