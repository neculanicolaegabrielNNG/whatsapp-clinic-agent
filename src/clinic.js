// Loads config/clinic.json and builds the system prompt from prompts/system.md.
import fs from 'node:fs';
import { config } from './config.js';
import { capitalize, localNow } from './calendar/time.js';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

export function loadClinic(file = config.paths.clinic) {
  const clinic = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const key of ['name', 'timezone', 'openingHours', 'services']) {
    if (!clinic[key]) throw new Error(`config/clinic.json is missing "${key}"`);
  }
  return clinic;
}

function formatHours(clinic) {
  return DAYS.map((day) => {
    const h = clinic.openingHours[day];
    return `- ${capitalize(day)}: ${h ? `${h.open}-${h.close}` : 'closed'}`;
  }).join('\n');
}

function formatServices(clinic) {
  return clinic.services
    .map(
      (s) =>
        `- ${s.id}: ${s.name}, ${s.durationMinutes} min, ${s.price} ${s.currency ?? ''}`.trimEnd(),
    )
    .join('\n');
}

/**
 * Fills the {{PLACEHOLDERS}} of prompts/system.md with data from clinic.json.
 * The current clinic-local date/time is included so the model can resolve "tomorrow", etc.
 */
export function buildSystemPrompt(clinic, now = new Date(), templateFile = config.paths.systemPrompt) {
  const template = fs.readFileSync(templateFile, 'utf8');
  const local = localNow(clinic.timezone, now);
  const values = {
    CLINIC_NAME: clinic.name,
    ADDRESS: clinic.address ?? 'not provided',
    PHONE: clinic.phone ?? 'not provided',
    EMERGENCY_PHONE: clinic.emergencyPhone ?? '112',
    NOW: `${local.weekday}, ${local.date} ${local.time} (${clinic.timezone})`,
    OPENING_HOURS: formatHours(clinic),
    SERVICES: formatServices(clinic),
    CANCELLATION_POLICY: clinic.cancellationPolicy ?? 'not provided',
  };
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (match, key) => values[key] ?? match);
}

/** Message the tool sends to the patient when a chat is handed to a human. */
export function handoffMessage(clinic) {
  return (
    'Thank you. I have passed your conversation to our team and someone will contact you as soon as possible. ' +
    `If this is urgent or an emergency, please call ${clinic.emergencyPhone ?? '112'} right away.`
  );
}
