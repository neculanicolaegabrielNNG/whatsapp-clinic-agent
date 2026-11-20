// Shared test fixtures.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LocalCalendar } from '../src/calendar/local.js';

export const clinic = {
  name: 'Test Clinic',
  address: '1 Test Street',
  phone: '+40 21 000 0000',
  emergencyPhone: '112',
  timezone: 'Europe/Bucharest',
  openingHours: {
    monday: { open: '09:00', close: '18:00' },
    tuesday: { open: '09:00', close: '18:00' },
    wednesday: { open: '09:00', close: '18:00' },
    thursday: { open: '09:00', close: '18:00' },
    friday: { open: '09:00', close: '18:00' },
    saturday: { open: '09:00', close: '13:00' },
    sunday: null,
  },
  closedDates: ['2026-12-25'],
  booking: { slotIntervalMinutes: 30, minLeadMinutes: 60, maxDaysAhead: 90 },
  services: [
    { id: 'general_consultation', name: 'General consultation', durationMinutes: 30, price: 60, currency: 'EUR', capacity: 1 },
    { id: 'cardiology', name: 'Cardiology consultation', durationMinutes: 45, price: 90, currency: 'EUR', capacity: 1 },
    { id: 'lab_tests', name: 'Lab tests', durationMinutes: 15, price: 25, currency: 'EUR', capacity: 2 },
  ],
  cancellationPolicy: 'Free cancellation up to 24 hours before.',
};

// 2026-11-19 is a Thursday. Mon 23, Sat 21, Sun 22 are used in the tests.
export const NOW = { date: '2026-11-19', time: '10:00' };

export function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'clinic-test-'));
}

export function makeCalendar(now = NOW) {
  const dir = tempDir();
  const calendar = new LocalCalendar({
    clinic,
    dataFile: path.join(dir, 'appointments.json'),
    icsFile: path.join(dir, 'calendar.ics'),
    now: () => now,
  });
  return { calendar, dir, icsFile: path.join(dir, 'calendar.ics') };
}
