// Tools exposed to Claude (tool schemas + the code that runs them).
import { CalendarError } from './calendar/errors.js';

/** Tool schemas, built from the clinic config so the "service" enum always matches it. */
export function getToolDefinitions(clinic) {
  const serviceIds = clinic.services.map((s) => s.id);
  return [
    {
      name: 'check_availability',
      description:
        'List the free appointment start times for one service on one date. Always call this before ' +
        'offering or booking a time. Returns an empty list if the clinic is closed or fully booked that day.',
      input_schema: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Date in YYYY-MM-DD format (clinic local time).' },
          service: { type: 'string', enum: serviceIds, description: 'Service id.' },
        },
        required: ['date', 'service'],
      },
    },
    {
      name: 'book_appointment',
      description:
        'Book an appointment. Only call after the patient has clearly confirmed the details. ' +
        'Returns the appointment ID, which you must tell the patient.',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: "Patient's full name." },
          phone: {
            type: 'string',
            description:
              "Patient's phone number. It is filled in automatically from the WhatsApp chat; you can omit it.",
          },
          service: { type: 'string', enum: serviceIds, description: 'Service id.' },
          datetime: {
            type: 'string',
            description: 'Start time in YYYY-MM-DDTHH:MM format (clinic local time), taken from check_availability.',
          },
          notes: { type: 'string', description: 'Optional short note from the patient (no medical details needed).' },
        },
        required: ['name', 'service', 'datetime'],
      },
    },
    {
      name: 'cancel_appointment',
      description: "Cancel one of the current patient's appointments by its ID (for example A-7K2QXD).",
      input_schema: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string', description: 'Appointment ID given at booking time.' },
        },
        required: ['appointment_id'],
      },
    },
    {
      name: 'handoff_to_human',
      description:
        'Flag this conversation for a human team member. Use it for emergencies, requests for a human, ' +
        'questions you cannot answer from the clinic information, or anything out of scope. ' +
        'This tool also sends the patient a confirmation message, so do not write another one.',
      input_schema: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description: 'Short reason for the team. Start with "EMERGENCY:" for emergencies.',
          },
        },
        required: ['reason'],
      },
    },
  ];
}

const hm = (datetime) => datetime.slice(11, 16);

function describeAppointment(a) {
  return {
    appointment_id: a.id,
    name: a.name,
    service: a.serviceName ?? a.service,
    date: a.start.slice(0, 10),
    start: hm(a.start),
    end: hm(a.end),
    status: a.status,
  };
}

/**
 * Runs one tool call. Always resolves to a JSON-serialisable object; expected failures are
 * returned as { ok: false, error } so the model can explain them to the patient.
 *
 * @param {string} name
 * @param {object} input  tool input produced by the model (untrusted)
 * @param {object} ctx    { phone, clinic, calendar, onHandoff(reason) }
 */
export async function executeTool(name, input, ctx) {
  const args = input && typeof input === 'object' ? input : {};
  try {
    switch (name) {
      case 'check_availability': {
        const slots = await ctx.calendar.listFree({ date: args.date, service: args.service });
        const times = slots.map((s) => hm(s.start));
        return {
          ok: true,
          date: args.date,
          service: args.service,
          free_start_times: times,
          note: times.length === 0 ? 'No free times that day (closed, fully booked, or outside the booking window).' : undefined,
        };
      }

      case 'book_appointment': {
        // The phone number comes from the verified WhatsApp sender, never from the model.
        const appointment = await ctx.calendar.create({
          name: args.name,
          phone: ctx.phone ?? args.phone,
          service: args.service,
          start: args.datetime,
          notes: args.notes,
        });
        return { ok: true, booked: describeAppointment(appointment) };
      }

      case 'cancel_appointment': {
        // Patients may only cancel their own appointments.
        const mine = await ctx.calendar.list({ phone: ctx.phone, status: 'booked' });
        const id = String(args.appointment_id ?? '').trim().toUpperCase();
        if (!mine.some((a) => a.id === id)) {
          return { ok: false, code: 'NOT_FOUND', error: 'No active appointment with that ID was found for this patient.' };
        }
        const cancelled = await ctx.calendar.cancel(id);
        return { ok: true, cancelled: describeAppointment(cancelled) };
      }

      case 'handoff_to_human': {
        await ctx.onHandoff(String(args.reason ?? 'unspecified').slice(0, 300));
        return { ok: true, note: 'The patient was notified. Do not send another message.' };
      }

      default:
        return { ok: false, error: `Unknown tool "${name}".` };
    }
  } catch (err) {
    if (err instanceof CalendarError) {
      return { ok: false, code: err.code, error: err.message, ...err.details };
    }
    throw err; // unexpected: the agent loop reports it to the model as a tool error
  }
}
