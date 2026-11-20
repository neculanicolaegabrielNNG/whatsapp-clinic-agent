// Calendar interface + provider selection.
//
// The rest of the app (tools.js) only ever calls getCalendar() and the four methods below.
// To use another backend (e.g. Google Calendar), implement the same interface in a new file,
// register it in createCalendar() and set CALENDAR_PROVIDER in .env. Nothing else changes.
// See src/calendar/google.js for a ready-made stub.
import { config } from '../config.js';
import { LocalCalendar } from './local.js';
import { GoogleCalendar } from './google.js';

/**
 * @typedef {Object} Appointment
 * @property {string} id            e.g. "A-7K2QXD"
 * @property {string} name          patient full name
 * @property {string} phone         patient phone number
 * @property {string} service       service id from config/clinic.json
 * @property {string} serviceName
 * @property {string} start         "YYYY-MM-DDTHH:MM" clinic local time
 * @property {string} end           "YYYY-MM-DDTHH:MM" clinic local time
 * @property {string} notes
 * @property {"booked"|"cancelled"} status
 *
 * @typedef {Object} CalendarProvider
 * @property {(q: {date: string, service: string}) => Promise<Array<{start: string, end: string}>>} listFree
 *   Free start times for a service on a date ("YYYY-MM-DD").
 * @property {(a: {name: string, phone: string, service: string, start: string, notes?: string}) => Promise<Appointment>} create
 *   Books a slot. MUST reject double-bookings by throwing CalendarError("SLOT_TAKEN").
 * @property {(appointmentId: string) => Promise<Appointment>} cancel
 *   Cancels by ID. Throws CalendarError("NOT_FOUND") / ("ALREADY_CANCELLED").
 * @property {(f?: {from?: string, to?: string, phone?: string, status?: string}) => Promise<Appointment[]>} list
 *   Appointments sorted by start time (default: only "booked").
 *
 * All implementations throw CalendarError (./errors.js) for expected failures.
 */

/**
 * @param {object} clinic  parsed config/clinic.json
 * @returns {CalendarProvider}
 */
export function createCalendar(clinic) {
  switch (config.calendarProvider) {
    case 'google':
      return new GoogleCalendar({ clinic });
    case 'local':
      return new LocalCalendar({
        clinic,
        dataFile: config.paths.appointments,
        icsFile: config.paths.calendarIcs,
      });
    default:
      throw new Error(`Unknown CALENDAR_PROVIDER "${config.calendarProvider}" (use "local" or "google").`);
  }
}

let instance;

/** Shared calendar instance used by the whole app. */
export function getCalendar(clinic) {
  instance ??= createCalendar(clinic);
  return instance;
}

export { CalendarError } from './errors.js';
