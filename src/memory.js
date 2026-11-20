// Per-phone conversation memory, stored in data/conversations.json:
//   { "<phone>": { messages: [...], handoff: { reason, at } | null, updatedAt } }
// `messages` is in Anthropic Messages API format (user/assistant turns incl. tool_use/tool_result).
import { config } from './config.js';
import { readJson, writeJson } from './store.js';

const keyOf = (phone) => String(phone).replace(/\D/g, '') || String(phone);

export function loadConversation(phone, file = config.paths.conversations) {
  const all = readJson(file, {});
  const convo = all[keyOf(phone)];
  return { messages: [], handoff: null, ...convo };
}

export function saveConversation(phone, convo, file = config.paths.conversations) {
  const all = readJson(file, {});
  all[keyOf(phone)] = { ...convo, updatedAt: new Date().toISOString() };
  writeJson(file, all);
}

export function clearConversation(phone, file = config.paths.conversations) {
  const all = readJson(file, {});
  delete all[keyOf(phone)];
  writeJson(file, all);
}

/**
 * Keeps roughly the last `max` messages. History is only cut at the start of a user turn
 * (a user message whose content is plain text), so tool_use / tool_result pairs are never split
 * and the first message is always a user message.
 */
export function trimHistory(messages, max = config.maxHistoryMessages) {
  let out = messages;
  while (out.length > max) {
    const next = out.findIndex((m, i) => i > 0 && m.role === 'user' && typeof m.content === 'string');
    if (next === -1) break;
    out = out.slice(next);
  }
  return out;
}

// Blocks that only make sense inside the turn that produced them. They are dropped when the
// finished turn is saved, so stored history is a plain transcript (text + tool calls/results).
const TURN_ONLY_BLOCKS = new Set(['thinking', 'redacted_thinking', 'fallback']);

export function toPersisted(messages) {
  return messages
    .map((m) =>
      m.role === 'assistant' && Array.isArray(m.content)
        ? { ...m, content: m.content.filter((b) => !TURN_ONLY_BLOCKS.has(b.type)) }
        : m,
    )
    .filter((m) => typeof m.content === 'string' || m.content.length > 0);
}

/** True while a human has the chat (the bot stays silent). Expired flags are cleared. */
export function isHandoffActive(convo, pauseMinutes = config.handoffPauseMinutes, now = Date.now()) {
  if (!convo.handoff) return false;
  const ageMinutes = (now - new Date(convo.handoff.at).getTime()) / 60000;
  if (ageMinutes >= pauseMinutes) {
    convo.handoff = null;
    return false;
  }
  return true;
}
