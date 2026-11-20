// Tests the agent loop + handler with a scripted fake Anthropic client (no network, no API key).
import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { config } from '../src/config.js';
import { handleIncomingMessage } from '../src/handler.js';
import { loadConversation, toPersisted, trimHistory } from '../src/memory.js';
import { clinic, makeCalendar, tempDir } from './helpers.js';

config.refusalFallback = false; // use the plain messages endpoint of the fake client
config.paths.conversations = path.join(tempDir(), 'conversations.json');

const tool = (name, input, id = `toolu_${name}`) => ({ type: 'tool_use', id, name, input });
const text = (t) => ({ type: 'text', text: t });
const reply = (stop_reason, ...content) => ({ stop_reason, content });

/** Fake client: returns the scripted responses in order and records every request. */
function fakeClient(script) {
  const requests = [];
  return {
    requests,
    messages: {
      create: async (params) => {
        requests.push(structuredClone(params));
        const next = script.shift();
        if (!next) throw new Error('script exhausted');
        if (next instanceof Error) throw next;
        return next;
      },
    },
  };
}

let phone = 0;
const newPhone = () => `4070000${String(++phone).padStart(4, '0')}`;

function setup(script) {
  const { calendar } = makeCalendar();
  const client = fakeClient(script);
  const sent = [];
  const send = async (_to, body) => void sent.push(body);
  return { calendar, client, sent, send, deps: { clinic, calendar, client } };
}

describe('agent tool loop', () => {
  it('checks availability, books with the real WhatsApp number, then answers', async () => {
    const p = newPhone();
    const { calendar, client, sent, send, deps } = setup([
      reply('tool_use', { type: 'thinking', thinking: '', signature: 'sig' }, tool('check_availability', { date: '2026-11-23', service: 'general_consultation' })),
      reply('tool_use', tool('book_appointment', { name: 'Jane Doe', phone: '999', service: 'general_consultation', datetime: '2026-11-23T10:00' })),
      reply('end_turn', text('Booked! Your ID is shown above.')),
    ]);

    const result = await handleIncomingMessage(p, 'I need a general consultation on Monday at 10', { send, deps });

    assert.equal(result.status, 'replied');
    assert.deepEqual(sent, ['Booked! Your ID is shown above.']);
    assert.equal(client.requests.length, 3);

    // Availability result was fed back to the model.
    const firstResult = JSON.parse(client.requests[1].messages.at(-1).content[0].content);
    assert.ok(firstResult.free_start_times.includes('10:00'));

    // The booking uses the verified sender number, not the one the model passed.
    const [appt] = await calendar.list();
    assert.equal(appt.phone, p);
    assert.equal(appt.start, '2026-11-23T10:00');

    // Tools are declared, with the service enum taken from the clinic config.
    const names = client.requests[0].tools.map((t) => t.name);
    assert.deepEqual(names, ['check_availability', 'book_appointment', 'cancel_appointment', 'handoff_to_human']);
    assert.deepEqual(client.requests[0].tools[0].input_schema.properties.service.enum, clinic.services.map((s) => s.id));
    assert.match(client.requests[0].system, /Test Clinic/);
    assert.equal(client.requests[0].tool_choice, undefined); // forced tool choice is rejected by current models

    // Memory: transcript kept (incl. tool calls), thinking blocks dropped.
    const saved = loadConversation(p).messages;
    assert.equal(saved[0].content, 'I need a general consultation on Monday at 10');
    assert.ok(!JSON.stringify(saved).includes('"thinking"'));
    assert.ok(saved.some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_use' && b.name === 'book_appointment')));
  });

  it('remembers the conversation on the next message', async () => {
    const p = newPhone();
    const first = setup([reply('end_turn', text('Hello! How can I help?'))]);
    await handleIncomingMessage(p, 'Hi', { send: first.send, deps: first.deps });
    const second = setup([reply('end_turn', text('Sure.'))]);
    await handleIncomingMessage(p, 'Opening hours?', { send: second.send, deps: second.deps });
    const sentMessages = second.client.requests[0].messages;
    assert.deepEqual(sentMessages.map((m) => m.role), ['user', 'assistant', 'user']);
    assert.equal(sentMessages[0].content, 'Hi');
  });

  it('handoff: sends the emergency text and the confirmation, flags the chat, then stays silent', async () => {
    const p = newPhone();
    const { client, sent, send, deps } = setup([
      reply('tool_use', text('Please call 112 right now.'), tool('handoff_to_human', { reason: 'EMERGENCY: chest pain' })),
      reply('end_turn', text('Take care.')), // suppressed: the tool already confirmed
    ]);
    await handleIncomingMessage(p, 'I have chest pain', { send, deps });

    assert.equal(sent.length, 2);
    assert.equal(sent[0], 'Please call 112 right now.');
    assert.match(sent[1], /passed your conversation to our team/);
    assert.equal(loadConversation(p).handoff.reason, 'EMERGENCY: chest pain');

    // Next message: the bot is paused and the model is not called.
    const again = setup([]);
    const result = await handleIncomingMessage(p, 'Hello?', { send: again.send, deps: again.deps });
    assert.equal(result.status, 'paused');
    assert.equal(again.client.requests.length, 0);
    assert.equal(again.sent.length, 0);
    assert.equal(client.requests.length, 2);
  });

  it('cancels only appointments that belong to the sender', async () => {
    const owner = newPhone();
    const stranger = newPhone();
    const { calendar, send, deps } = setup([]);
    const appt = await calendar.create({ name: 'Jane Doe', phone: owner, service: 'general_consultation', start: '2026-11-23T10:00' });

    // The stranger tries to cancel the owner's booking.
    const client = fakeClient([
      reply('tool_use', tool('cancel_appointment', { appointment_id: appt.id })),
      reply('end_turn', text('Sorry, I could not find it.')),
    ]);
    await handleIncomingMessage(stranger, `cancel ${appt.id}`, { send, deps: { ...deps, client } });
    assert.equal((await calendar.list()).length, 1); // still booked
    const toolResult = JSON.parse(client.requests[1].messages.at(-1).content[0].content);
    assert.equal(toolResult.ok, false);

    // The owner can cancel it.
    const client2 = fakeClient([
      reply('tool_use', tool('cancel_appointment', { appointment_id: appt.id.toLowerCase() })),
      reply('end_turn', text('Cancelled.')),
    ]);
    await handleIncomingMessage(owner, 'cancel please', { send, deps: { ...deps, client: client2 } });
    assert.equal((await calendar.list()).length, 0);
  });

  it('returns calendar errors to the model so it can offer alternatives', async () => {
    const p = newPhone();
    const { calendar, client, send, deps } = setup([
      reply('tool_use', tool('book_appointment', { name: 'Jane Doe', service: 'general_consultation', datetime: '2026-11-23T10:00' })),
      reply('end_turn', text('That time was just taken. 10:30 is free.')),
    ]);
    await calendar.create({ name: 'Other Patient', phone: '1', service: 'general_consultation', start: '2026-11-23T10:00' });
    await handleIncomingMessage(p, 'book me', { send, deps });
    const result = JSON.parse(client.requests[1].messages.at(-1).content[0].content);
    assert.equal(result.code, 'SLOT_TAKEN');
    assert.ok(result.alternatives.length > 0);
  });

  it('hands off when the model declines (refusal stop reason)', async () => {
    const p = newPhone();
    const { sent, send, deps } = setup([{ stop_reason: 'refusal', content: [], stop_details: { type: 'refusal', category: 'bio' } }]);
    await handleIncomingMessage(p, 'some question', { send, deps });
    assert.equal(sent.length, 1);
    assert.match(sent[0], /passed your conversation to our team/);
    assert.ok(loadConversation(p).handoff);
  });

  it('apologises on API errors and does not store the failed turn', async () => {
    const p = newPhone();
    const { sent, send, deps } = setup([new Error('boom')]);
    const result = await handleIncomingMessage(p, 'hello', { send, deps });
    assert.equal(result.status, 'error');
    assert.match(sent[0], /technical difficulties/);
    assert.deepEqual(loadConversation(p).messages, []);
  });

  it('processes messages of the same patient one after another', async () => {
    const p = newPhone();
    const { client, send, deps } = setup([reply('end_turn', text('one')), reply('end_turn', text('two'))]);
    await Promise.all([handleIncomingMessage(p, 'first', { send, deps }), handleIncomingMessage(p, 'second', { send, deps })]);
    // The 2nd request already contains the 1st exchange in its history.
    assert.deepEqual(client.requests[1].messages.map((m) => m.role), ['user', 'assistant', 'user']);
  });
});

describe('conversation memory', () => {
  it('trims whole turns only, keeping tool_use/tool_result pairs together', () => {
    const turn = (n) => [
      { role: 'user', content: `q${n}` },
      { role: 'assistant', content: [tool('check_availability', {}, `id${n}`)] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: `id${n}`, content: '{}' }] },
      { role: 'assistant', content: [text(`a${n}`)] },
    ];
    const history = [1, 2, 3, 4, 5, 6].flatMap(turn); // 24 messages
    const trimmed = trimHistory(history, 20);
    assert.ok(trimmed.length <= 20);
    assert.equal(trimmed[0].role, 'user');
    assert.equal(typeof trimmed[0].content, 'string');
    assert.equal(trimmed[0].content, 'q2');
  });

  it('drops thinking/fallback blocks when persisting', () => {
    const out = toPersisted([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'fallback' }, text('hello')] },
    ]);
    assert.deepEqual(out[1].content, [text('hello')]);
  });
});
