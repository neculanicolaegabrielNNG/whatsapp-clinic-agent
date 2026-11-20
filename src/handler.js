// The single entry point for an incoming patient message.
// Used by the WhatsApp webhook (src/app.js) AND by the terminal simulator (scripts/chat.js),
// so both behave exactly the same.
import { createAnthropicClient, runAgent } from './agent.js';
import { getCalendar } from './calendar/index.js';
import { buildSystemPrompt, handoffMessage, loadClinic } from './clinic.js';
import { describeError, log, maskPhone } from './logger.js';
import { isHandoffActive, loadConversation, saveConversation, toPersisted, trimHistory } from './memory.js';
import { getToolDefinitions } from './tools.js';
import { sendText } from './whatsapp.js';

const MAX_INPUT_CHARS = 2000;

let shared;
function getSharedDeps() {
  if (!shared) {
    const clinic = loadClinic();
    shared = { clinic, calendar: getCalendar(clinic), client: createAnthropicClient() };
  }
  return shared;
}

// Messages from the same phone number are processed one at a time, in order.
const queues = new Map();
function enqueue(key, task) {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.then(task, task);
  queues.set(key, next);
  const cleanup = () => {
    if (queues.get(key) === next) queues.delete(key);
  };
  next.then(cleanup, cleanup);
  return next;
}

/**
 * Handles one incoming text message and sends the replies.
 *
 * @param {string} phone  patient phone number (digits, international format)
 * @param {string} text   message text
 * @param {object} [options]
 * @param {(to: string, body: string) => Promise<void>} [options.send]  delivery function (default: WhatsApp)
 * @param {{clinic: object, calendar: object, client: object}} [options.deps]  overrides (used by tests)
 * @returns {Promise<{status: 'replied'|'paused'|'error'}>}
 */
export function handleIncomingMessage(phone, text, { send = sendText, deps } = {}) {
  return enqueue(phone, async () => {
    const { clinic, calendar, client } = deps ?? getSharedDeps();
    const convo = loadConversation(phone);

    if (isHandoffActive(convo)) {
      log.info('Chat is with a human, bot stays silent', { from: maskPhone(phone) });
      return { status: 'paused' };
    }

    const say = (body) => send(phone, body);
    const toolCtx = {
      phone,
      clinic,
      calendar,
      onHandoff: async (reason) => {
        convo.handoff = { reason, at: new Date().toISOString() };
        saveConversation(phone, convo);
        log.warn('Conversation flagged for a human', { from: maskPhone(phone) });
        const confirmation = handoffMessage(clinic);
        await say(confirmation);
        return confirmation;
      },
    };

    try {
      const result = await runAgent({
        client,
        systemPrompt: buildSystemPrompt(clinic),
        history: convo.messages,
        userText: String(text).slice(0, MAX_INPUT_CHARS),
        tools: getToolDefinitions(clinic),
        toolCtx,
        send: say,
      });
      convo.messages = trimHistory(toPersisted(result.messages));
      saveConversation(phone, convo);
      return { status: 'replied' };
    } catch (err) {
      // The failed turn is not stored, so the history stays valid for the next message.
      log.error('Could not process message', { from: maskPhone(phone), error: describeError(err) });
      const contact = clinic.phone ? ` or call us at ${clinic.phone}` : '';
      await say(`Sorry, I'm having technical difficulties right now. Please try again in a few minutes${contact}.`).catch(
        (sendErr) => log.error('Could not send the error notice', { error: describeError(sendErr) }),
      );
      return { status: 'error' };
    }
  });
}
