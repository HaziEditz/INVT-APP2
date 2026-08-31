import { JobNoteLine, JobOffer } from '@/types';

const NOTE_FIELDS: { label: string; keys: string[] }[] = [
  { label: 'Dispatcher', keys: ['dispatcherNotes', 'DispatcherNotes', 'dispatchNotes', 'DispatchNotes'] },
  { label: 'Passenger', keys: ['passengerNotes', 'PassengerNotes', 'passengerNote', 'PassengerNote'] },
  {
    label: 'Booking / website',
    keys: ['bookingNotes', 'BookingNotes', 'websiteNotes', 'WebsiteNotes', 'webNotes', 'WebNotes'],
  },
  {
    label: 'Instructions',
    keys: [
      'instructions',
      'Instructions',
      'specialInstructions',
      'SpecialInstructions',
      'driverInstructions',
      'DriverInstructions',
    ],
  },
  {
    label: 'Notes',
    keys: [
      'notes',
      'Notes',
      'Info',
      'info',
      'jobinfo',
      'EntitiesDetails',
      'entitiesDetails',
      'remarks',
      'Remarks',
      'comment',
      'Comment',
      'comments',
      'driverNotes',
      'DriverNotes',
    ],
  },
];

function pickText(val: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const raw = val[key];
    if (raw == null) continue;
    let text = String(raw).trim();
    if (!text) continue;
    // EntitiesDetails / jobinfo often mixes payment extras with pickup notes.
    if (key === 'EntitiesDetails' || key === 'entitiesDetails' || key === 'jobinfo') {
      text = text
        .split('|')
        .map((s) => s.trim())
        .filter(
          (s) =>
            s &&
            !/^Payment:/i.test(s) &&
            !/^Ref:/i.test(s) &&
            !/^TM Card:/i.test(s) &&
            !/^TM Expiry:/i.test(s) &&
            !/^Council %:/i.test(s) &&
            !/^Passenger %:/i.test(s) &&
            !/^EFTPOS surcharge/i.test(s) &&
            !/^Account:/i.test(s),
        )
        .join(' | ')
        .trim();
      if (!text) continue;
    }
    return text;
  }
  return '';
}

/** Collect labelled notes from Firebase / offer payloads without duplicating identical text. */
export function collectJobNotes(val: Record<string, unknown>): JobNoteLine[] {
  const seen = new Set<string>();
  const lines: JobNoteLine[] = [];

  for (const field of NOTE_FIELDS) {
    const text = pickText(val, field.keys);
    if (!text) continue;
    const norm = text.toLowerCase();
    if (seen.has(norm)) continue;
    seen.add(norm);
    lines.push({ label: field.label, text });
  }

  return lines;
}

export function notesFromOffer(offer: Pick<JobOffer, 'allNotes' | 'notes'>): JobNoteLine[] {
  if (offer.allNotes?.length) return offer.allNotes;
  if (offer.notes?.trim()) return [{ label: 'Notes', text: offer.notes.trim() }];
  return [];
}

export function hasJobNotes(offer: Pick<JobOffer, 'allNotes' | 'notes'>): boolean {
  return notesFromOffer(offer).length > 0;
}
