// Google Calendar provider - STUB (not implemented yet).
//
// HOW TO SWAP THE LOCAL CALENDAR FOR GOOGLE CALENDAR (no other code changes needed)
// ---------------------------------------------------------------------------------
// 1. Install the client library:            npm install googleapis
// 2. Create credentials in Google Cloud Console:
//      - enable "Google Calendar API";
//      - create a Service Account and download its JSON key;
//      - in Google Calendar, share the clinic calendar with the service account's e-mail
//        ("Make changes to events").
// 3. Add to .env:                           CALENDAR_PROVIDER=google
//                                           GOOGLE_CALENDAR_ID=<calendar id>
//                                           GOOGLE_APPLICATION_CREDENTIALS=<path to the JSON key>
// 4. Implement the four methods below. They must keep the SAME inputs and outputs as
//    LocalCalendar (see the typedefs in ./index.js), because tools.js depends only on them:
//
//    listFree({date, service})  -> freebusy.query for that day in clinic.timezone, then build the
//                                  slot grid exactly like LocalCalendar does (opening hours from
//                                  config/clinic.json, service duration) and drop busy intervals.
//    create({...})              -> re-check availability right before events.insert (to avoid
//                                  races), then events.insert with summary/description and
//                                  extendedProperties.private = { appointmentId, phone, service }.
//                                  Return an Appointment (id may be the Google event id).
//    cancel(id)                 -> events.delete (or events.patch with status "cancelled").
//    list({from,to,phone,status}) -> events.list with timeMin/timeMax, singleEvents: true and
//                                  privateExtendedProperty filters for the phone number.
//
//    Throw CalendarError (./errors.js) for expected failures (SLOT_TAKEN, NOT_FOUND, ...).
// 5. Restart the server. index.js already selects this class when CALENDAR_PROVIDER=google.
//
// Tip: you can keep the local implementation as a backup. LocalCalendar's pure helpers
// (time.js) are reusable here for the slot-grid maths.
import { CalendarError } from './errors.js';

export class GoogleCalendar {
  constructor({ clinic }) {
    this.clinic = clinic;
    // TODO: create the Google auth client + calendar API client here, e.g.
    //   const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/calendar'] });
    //   this.calendar = google.calendar({ version: 'v3', auth });
    //   this.calendarId = process.env.GOOGLE_CALENDAR_ID;
  }

  async listFree(_query) {
    throw this.#notImplemented('listFree');
  }

  async create(_appointment) {
    throw this.#notImplemented('create');
  }

  async cancel(_appointmentId) {
    throw this.#notImplemented('cancel');
  }

  async list(_filter) {
    throw this.#notImplemented('list');
  }

  #notImplemented(method) {
    return new CalendarError(
      'NOT_IMPLEMENTED',
      `GoogleCalendar.${method}() is not implemented yet. See the TODO in src/calendar/google.js ` +
        'or set CALENDAR_PROVIDER=local.',
    );
  }
}
