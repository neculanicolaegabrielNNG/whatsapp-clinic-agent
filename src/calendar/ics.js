// Generates an iCalendar (.ics) file that can be imported into Google Calendar
// (Settings > Import & export > Import). Only booked appointments are exported.

function escapeText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** RFC 5545 line folding: max 75 octets per line, continuation lines start with a space. */
function fold(line) {
  const out = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch);
    const limit = out.length === 0 ? 75 : 74; // continuation lines lose 1 octet to the leading space
    if (bytes + size > limit) {
      out.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.map((l, i) => (i === 0 ? l : ` ${l}`)).join('\r\n');
}

/** "2026-11-23T09:30" -> "20261123T093000" */
const icsLocal = (datetime) => `${datetime.replace(/[-:]/g, '')}00`;

function icsUtcStamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/**
 * @param {Array} appointments  appointment objects ({id,name,phone,service,serviceName,start,end,notes,status})
 * @param {{name: string, address?: string, timezone: string}} clinic
 */
export function buildIcs(appointments, clinic) {
  const stamp = icsUtcStamp();
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//WhatsApp Clinic Agent//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(clinic.name)} appointments`,
    `X-WR-TIMEZONE:${clinic.timezone}`,
  ];

  for (const a of appointments.filter((x) => x.status === 'booked')) {
    const description = [`Appointment ID: ${a.id}`, `Phone: ${a.phone}`];
    if (a.notes) description.push(`Notes: ${a.notes}`);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${a.id}@clinic-agent`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=${clinic.timezone}:${icsLocal(a.start)}`,
      `DTEND;TZID=${clinic.timezone}:${icsLocal(a.end)}`,
      `SUMMARY:${escapeText(`${a.serviceName ?? a.service} - ${a.name}`)}`,
      `DESCRIPTION:${escapeText(description.join('\n'))}`,
    );
    if (clinic.address) lines.push(`LOCATION:${escapeText(clinic.address)}`);
    lines.push('STATUS:CONFIRMED', 'END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
