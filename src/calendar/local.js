// Default calendar: appointments live in data/appointments.json and every change
// regenerates data/calendar.ics (importable into Google Calendar).
//
// Booking model: every service has its own resource (doctor/room). Two appointments of the
// SAME service may not overlap more than `capacity` (default 1) at a time. Different services
// can run in parallel. Slots sit on a grid (booking.slotIntervalMinutes) anchored at opening time.
import crypto from 'node:crypto';
import { CalendarError } from './errors.js';
import { buildIcs } from './ics.js';
import { readJson, writeJson, writeFileAtomic } from '../store.js';
import {
  dayKey,
  fromAbsMinutes,
  hmToMinutes,
  isValidDate,
  localNow,
  minutesToHm,
  parseDateTime,
  toAbsMinutes,
} from './time.js';

const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid typos

function newId() {
  const bytes = crypto.randomBytes(6);
  return `A-${Array.from(bytes, (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join('')}`;
}

const digitsOnly = (phone) => String(phone ?? '').replace(/\D/g, '');

export class LocalCalendar {
  /**
   * @param {object} opts
   * @param {object} opts.clinic       parsed config/clinic.json
   * @param {string} opts.dataFile     path of appointments.json
   * @param {string} opts.icsFile      path of calendar.ics
   * @param {() => {date: string, time: string}} [opts.now]  clinic-local "now" (injectable for tests)
   */
  constructor({ clinic, dataFile, icsFile, now }) {
    this.clinic = clinic;
    this.dataFile = dataFile;
    this.icsFile = icsFile;
    this.now = now ?? (() => localNow(clinic.timezone));
    this.step = clinic.booking?.slotIntervalMinutes ?? 30;
    this.minLead = clinic.booking?.minLeadMinutes ?? 0;
    this.maxDaysAhead = clinic.booking?.maxDaysAhead ?? 90;
  }

  // ---------------------------------------------------------------- public interface

  /**
   * Free start times for a service on a date.
   * @returns {Promise<Array<{start: string, end: string}>>}  "YYYY-MM-DDTHH:MM" (clinic local time)
   */
  async listFree({ date, service }) {
    const svc = this.#service(service);
    if (!isValidDate(date)) {
      throw new CalendarError('INVALID_DATE', 'The date must be in YYYY-MM-DD format.');
    }
    return this.#freeSlots(date, svc, this.#load());
  }

  /**
   * Books an appointment. Throws CalendarError if it is not possible.
   * @returns {Promise<object>} the stored appointment
   */
  async create({ name, phone, service, start, notes }) {
    const svc = this.#service(service);
    const cleanName = String(name ?? '').trim().replace(/\s+/g, ' ');
    if (cleanName.length < 2) {
      throw new CalendarError('INVALID_INPUT', "The patient's full name is required.");
    }
    const parsed = parseDateTime(start);
    if (!parsed) {
      throw new CalendarError('INVALID_DATE', 'The date and time must be in YYYY-MM-DDTHH:MM format.');
    }

    const all = this.#load();
    this.#assertBookable(parsed, svc, all);

    const startAbs = toAbsMinutes(parsed.date, parsed.time);
    const appointment = {
      id: this.#uniqueId(all),
      name: cleanName,
      phone: String(phone ?? '').trim(),
      service: svc.id,
      serviceName: svc.name,
      start: fromAbsMinutes(startAbs),
      end: fromAbsMinutes(startAbs + svc.durationMinutes),
      notes: String(notes ?? '').trim().slice(0, 500),
      status: 'booked',
      createdAt: new Date().toISOString(),
    };
    all.push(appointment);
    this.#save(all);
    return appointment;
  }

  /** Cancels an appointment by ID (the slot becomes free again). */
  async cancel(appointmentId) {
    const id = String(appointmentId ?? '').trim().toUpperCase();
    const all = this.#load();
    const appointment = all.find((a) => a.id === id);
    if (!appointment) {
      throw new CalendarError('NOT_FOUND', 'No appointment with that ID was found.');
    }
    if (appointment.status === 'cancelled') {
      throw new CalendarError('ALREADY_CANCELLED', 'This appointment was already cancelled.');
    }
    appointment.status = 'cancelled';
    appointment.cancelledAt = new Date().toISOString();
    this.#save(all);
    return appointment;
  }

  /**
   * Lists appointments, sorted by start time.
   * @param {{from?: string, to?: string, phone?: string, status?: string}} [filter]
   *   from/to: "YYYY-MM-DD" (inclusive); status: "booked" (default) | "cancelled" | "all"
   */
  async list({ from, to, phone, status = 'booked' } = {}) {
    return this.#load()
      .filter((a) => status === 'all' || a.status === status)
      .filter((a) => !from || a.start.slice(0, 10) >= from)
      .filter((a) => !to || a.start.slice(0, 10) <= to)
      .filter((a) => !phone || digitsOnly(a.phone) === digitsOnly(phone))
      .sort((a, b) => a.start.localeCompare(b.start));
  }

  // ---------------------------------------------------------------- internals

  #service(id) {
    const svc = this.clinic.services.find((s) => s.id === id);
    if (!svc) {
      const known = this.clinic.services.map((s) => s.id).join(', ');
      throw new CalendarError('UNKNOWN_SERVICE', `Unknown service "${id}". Valid services: ${known}.`);
    }
    return svc;
  }

  #hoursFor(date) {
    if (this.clinic.closedDates?.includes(date)) return null;
    const h = this.clinic.openingHours?.[dayKey(date)];
    return h ? { open: hmToMinutes(h.open), close: hmToMinutes(h.close) } : null;
  }

  #load() {
    return readJson(this.dataFile, []);
  }

  #save(all) {
    writeJson(this.dataFile, all);
    writeFileAtomic(this.icsFile, buildIcs(all, this.clinic)); // regenerate calendar.ics
  }

  #uniqueId(all) {
    let id;
    do id = newId();
    while (all.some((a) => a.id === id));
    return id;
  }

  /** Earliest allowed start, in absolute floating minutes. */
  #earliestStart() {
    const now = this.now();
    return toAbsMinutes(now.date, now.time) + this.minLead;
  }

  /** Last date ("YYYY-MM-DD") that may still be booked (booking.maxDaysAhead from today). */
  #lastBookableDay() {
    return fromAbsMinutes(toAbsMinutes(this.now().date, '00:00') + this.maxDaysAhead * 1440).slice(0, 10);
  }

  #overlapCount(all, svc, startAbs, endAbs) {
    return all.filter((a) => {
      if (a.status !== 'booked' || a.service !== svc.id) return false;
      const aStart = toAbsMinutes(a.start.slice(0, 10), a.start.slice(11, 16));
      const aEnd = toAbsMinutes(a.end.slice(0, 10), a.end.slice(11, 16));
      return aStart < endAbs && startAbs < aEnd;
    }).length;
  }

  #freeSlots(date, svc, all) {
    const hours = this.#hoursFor(date);
    if (!hours) return [];
    if (date > this.#lastBookableDay()) return [];

    const capacity = svc.capacity ?? 1;
    const earliest = this.#earliestStart();
    const slots = [];
    for (let t = hours.open; t + svc.durationMinutes <= hours.close; t += this.step) {
      const startAbs = toAbsMinutes(date, minutesToHm(t));
      const endAbs = startAbs + svc.durationMinutes;
      if (startAbs < earliest) continue;
      if (this.#overlapCount(all, svc, startAbs, endAbs) >= capacity) continue;
      slots.push({ start: fromAbsMinutes(startAbs), end: fromAbsMinutes(endAbs) });
    }
    return slots;
  }

  #assertBookable({ date, time }, svc, all) {
    const hours = this.#hoursFor(date);
    if (!hours) {
      throw new CalendarError('CLOSED', 'The clinic is closed on that day.');
    }
    const startMin = hmToMinutes(time);
    if (startMin < hours.open || startMin + svc.durationMinutes > hours.close) {
      throw new CalendarError(
        'OUTSIDE_HOURS',
        `That time is outside opening hours (${minutesToHm(hours.open)}-${minutesToHm(hours.close)}), ` +
          `and this service takes ${svc.durationMinutes} minutes.`,
      );
    }
    if ((startMin - hours.open) % this.step !== 0) {
      throw new CalendarError(
        'NOT_ON_SLOT',
        `Appointments start every ${this.step} minutes from ${minutesToHm(hours.open)} (e.g. ${minutesToHm(hours.open)}, ${minutesToHm(hours.open + this.step)}).`,
      );
    }

    const startAbs = toAbsMinutes(date, time);
    if (startAbs < this.#earliestStart()) {
      throw new CalendarError('IN_PAST', 'That time has already passed or is too soon to book.');
    }
    if (date > this.#lastBookableDay()) {
      throw new CalendarError('TOO_FAR', `Appointments can only be booked up to ${this.maxDaysAhead} days ahead.`);
    }

    const endAbs = startAbs + svc.durationMinutes;
    if (this.#overlapCount(all, svc, startAbs, endAbs) >= (svc.capacity ?? 1)) {
      throw new CalendarError('SLOT_TAKEN', 'That time is no longer available.', {
        alternatives: this.#freeSlots(date, svc, all)
          .slice(0, 5)
          .map((s) => s.start),
      });
    }
  }
}
