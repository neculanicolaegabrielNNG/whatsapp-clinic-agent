import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';
import { CalendarError } from '../src/calendar/errors.js';
import { makeCalendar } from './helpers.js';

const GC = 'general_consultation';
const booking = (overrides = {}) => ({
  name: 'Jane Doe',
  phone: '40700000001',
  service: GC,
  start: '2026-11-23T10:00',
  notes: '',
  ...overrides,
});

const rejectsWith = (promise, code) =>
  assert.rejects(promise, (err) => err instanceof CalendarError && err.code === code, `expected ${code}`);

describe('opening hours', () => {
  it('offers slots only inside Mon-Fri 09:00-18:00', async () => {
    const { calendar } = makeCalendar();
    const slots = (await calendar.listFree({ date: '2026-11-23', service: GC })).map((s) => s.start.slice(11));
    assert.equal(slots[0], '09:00');
    assert.equal(slots.at(-1), '17:30'); // a 30-min visit must end by 18:00
    assert.equal(slots.length, 18);
  });

  it('closes Saturday at 13:00 (the last slot depends on the service duration)', async () => {
    const { calendar } = makeCalendar();
    const gc = (await calendar.listFree({ date: '2026-11-21', service: GC })).map((s) => s.start.slice(11));
    assert.equal(gc.at(-1), '12:30');
    const cardio = (await calendar.listFree({ date: '2026-11-21', service: 'cardiology' })).map((s) => s.start.slice(11));
    assert.equal(cardio.at(-1), '12:00'); // 12:00 + 45 min = 12:45 <= 13:00; 12:30 would end at 13:15
  });

  it('has no slots on Sunday or on a closed date', async () => {
    const { calendar } = makeCalendar();
    assert.deepEqual(await calendar.listFree({ date: '2026-11-22', service: GC }), []);
    assert.deepEqual(await calendar.listFree({ date: '2026-12-25', service: GC }), []);
  });

  it('refuses bookings outside opening hours', async () => {
    const { calendar } = makeCalendar();
    await rejectsWith(calendar.create(booking({ start: '2026-11-23T08:30' })), 'OUTSIDE_HOURS');
    await rejectsWith(calendar.create(booking({ start: '2026-11-23T18:00' })), 'OUTSIDE_HOURS');
    await rejectsWith(calendar.create(booking({ start: '2026-11-21T12:45' })), 'OUTSIDE_HOURS'); // would end 13:15
    await rejectsWith(calendar.create(booking({ start: '2026-11-22T10:00' })), 'CLOSED');
  });

  it('refuses times that are not on the slot grid, bad input and unknown services', async () => {
    const { calendar } = makeCalendar();
    await rejectsWith(calendar.create(booking({ start: '2026-11-23T10:10' })), 'NOT_ON_SLOT');
    await rejectsWith(calendar.create(booking({ start: 'tomorrow at 10' })), 'INVALID_DATE');
    await rejectsWith(calendar.create(booking({ name: ' ' })), 'INVALID_INPUT');
    await rejectsWith(calendar.create(booking({ service: 'plastic_surgery' })), 'UNKNOWN_SERVICE');
    await rejectsWith(calendar.listFree({ date: '2026-02-30', service: GC }), 'INVALID_DATE');
  });

  it('refuses the past, times too soon, and dates beyond the booking window', async () => {
    const { calendar } = makeCalendar(); // now = Thu 2026-11-19 10:00, minLead = 60 min
    await rejectsWith(calendar.create(booking({ start: '2026-11-18T10:00' })), 'IN_PAST');
    await rejectsWith(calendar.create(booking({ start: '2026-11-19T10:30' })), 'IN_PAST'); // < 60 min ahead
    await calendar.create(booking({ start: '2026-11-19T11:00' })); // exactly 60 min ahead is fine
    await rejectsWith(calendar.create(booking({ start: '2027-06-01T10:00' })), 'TOO_FAR');
    const today = (await calendar.listFree({ date: '2026-11-19', service: GC })).map((s) => s.start.slice(11));
    assert.equal(today[0], '11:30'); // 11:00 is now taken, nothing earlier is allowed
  });
});

describe('overlaps / double booking', () => {
  it('rejects the exact same slot for the same service and offers alternatives', async () => {
    const { calendar } = makeCalendar();
    await calendar.create(booking());
    await assert.rejects(calendar.create(booking({ name: 'John Roe' })), (err) => {
      assert.equal(err.code, 'SLOT_TAKEN');
      assert.ok(err.details.alternatives.length > 0);
      assert.ok(!err.details.alternatives.includes('2026-11-23T10:00'));
      return true;
    });
  });

  it('rejects partially overlapping slots (45-minute visit blocks the next 30-minute step)', async () => {
    const { calendar } = makeCalendar();
    await calendar.create(booking({ service: 'cardiology', start: '2026-11-23T10:00' })); // 10:00-10:45
    await rejectsWith(calendar.create(booking({ service: 'cardiology', start: '2026-11-23T10:30' })), 'SLOT_TAKEN');
    await rejectsWith(calendar.create(booking({ service: 'cardiology', start: '2026-11-23T09:30' })), 'SLOT_TAKEN'); // ends 10:15
    await calendar.create(booking({ service: 'cardiology', start: '2026-11-23T11:00' })); // adjacent is fine
    const times = (await calendar.listFree({ date: '2026-11-23', service: 'cardiology' })).map((s) => s.start.slice(11));
    assert.ok(!times.includes('10:00') && !times.includes('10:30') && !times.includes('09:30'));
    assert.ok(times.includes('09:00')); // 09:00-09:45 does not touch 10:00
  });

  it('allows different services at the same time', async () => {
    const { calendar } = makeCalendar();
    await calendar.create(booking());
    await calendar.create(booking({ service: 'cardiology' }));
    assert.equal((await calendar.list()).length, 2);
  });

  it('respects service capacity (lab tests allow 2 at once)', async () => {
    const { calendar } = makeCalendar();
    const lab = (n) => booking({ service: 'lab_tests', name: `Patient ${n}` });
    await calendar.create(lab(1));
    await calendar.create(lab(2));
    await rejectsWith(calendar.create(lab(3)), 'SLOT_TAKEN');
  });

  it('lets only one of two simultaneous bookings win', async () => {
    const { calendar } = makeCalendar();
    const results = await Promise.allSettled([
      calendar.create(booking({ name: 'First Patient' })),
      calendar.create(booking({ name: 'Second Patient' })),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal((await calendar.list()).length, 1);
  });
});

describe('cancellation', () => {
  it('frees the slot again', async () => {
    const { calendar } = makeCalendar();
    const a = await calendar.create(booking());
    const before = await calendar.listFree({ date: '2026-11-23', service: GC });
    assert.ok(!before.some((s) => s.start === '2026-11-23T10:00'));

    const cancelled = await calendar.cancel(a.id);
    assert.equal(cancelled.status, 'cancelled');
    const after = await calendar.listFree({ date: '2026-11-23', service: GC });
    assert.ok(after.some((s) => s.start === '2026-11-23T10:00'));
    await calendar.create(booking({ name: 'Another Patient' })); // can be booked again
  });

  it('accepts lower-case IDs, rejects unknown IDs and double cancellation', async () => {
    const { calendar } = makeCalendar();
    const a = await calendar.create(booking());
    await rejectsWith(calendar.cancel('A-NOPE00'), 'NOT_FOUND');
    await calendar.cancel(a.id.toLowerCase());
    await rejectsWith(calendar.cancel(a.id), 'ALREADY_CANCELLED');
  });

  it('list() hides cancelled appointments by default and filters by phone', async () => {
    const { calendar } = makeCalendar();
    const a = await calendar.create(booking({ phone: '+40 700 000 001' }));
    await calendar.create(booking({ phone: '40700000002', start: '2026-11-23T11:00' }));
    await calendar.cancel(a.id);
    assert.equal((await calendar.list()).length, 1);
    assert.equal((await calendar.list({ status: 'all' })).length, 2);
    assert.equal((await calendar.list({ phone: '40700000001', status: 'all' })).length, 1); // digits-only match
  });
});

describe('calendar.ics', () => {
  it('is regenerated on every booking and cancellation', async () => {
    const { calendar, icsFile } = makeCalendar();
    const a = await calendar.create(booking());
    let ics = fs.readFileSync(icsFile, 'utf8');
    assert.match(ics, /BEGIN:VCALENDAR/);
    assert.match(ics, new RegExp(`UID:${a.id}@clinic-agent`));
    assert.match(ics, /DTSTART;TZID=Europe\/Bucharest:20261123T100000/);
    assert.match(ics, /DTEND;TZID=Europe\/Bucharest:20261123T103000/);
    assert.match(ics, /\r\n/);

    await calendar.cancel(a.id);
    ics = fs.readFileSync(icsFile, 'utf8');
    assert.doesNotMatch(ics, /BEGIN:VEVENT/);
  });

  it('persists appointments between instances', async () => {
    const { calendar, dir } = makeCalendar();
    await calendar.create(booking());
    const { LocalCalendar } = await import('../src/calendar/local.js');
    const { clinic, NOW } = await import('./helpers.js');
    const again = new LocalCalendar({ clinic, dataFile: `${dir}/appointments.json`, icsFile: `${dir}/calendar.ics`, now: () => NOW });
    assert.equal((await again.list()).length, 1);
    await rejectsWith(again.create(booking()), 'SLOT_TAKEN');
  });
});
