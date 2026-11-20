// The Claude agent: one patient message in -> replies out, running tools in a loop
// until Claude gives its final answer.
import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';
import { describeError, log } from './logger.js';
import { executeTool } from './tools.js';

const MAX_TOOL_ROUNDS = 8; // safety net against endless tool loops
const MAX_TOKENS = 4096;
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export function createAnthropicClient() {
  // Reads ANTHROPIC_API_KEY from the environment. The SDK retries 429/5xx twice by default.
  return new Anthropic({ apiKey: config.anthropicApiKey, timeout: 60_000 });
}

/** One model call. `fallbacks: "default"` re-runs a request on another model if Claude's safety classifier declines it. */
function callClaude(client, { system, messages, tools }, opts) {
  const params = { model: opts.model, max_tokens: MAX_TOKENS, system, tools, messages };
  // No temperature/top_p/top_k and no forced tool_choice: current models reject them.
  if (opts.effort) params.output_config = { effort: opts.effort };
  if (opts.refusalFallback) {
    return client.beta.messages.create({ ...params, betas: [FALLBACK_BETA], fallbacks: 'default' });
  }
  return client.messages.create(params);
}

const textOf = (content) =>
  content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

/**
 * When a refusal fallback happened mid-output, blocks produced before the last `fallback` block
 * by the declining model must not be echoed back (API rule); the `fallback` block itself stays.
 */
function prepareAssistantContent(content) {
  const boundary = content.map((b) => b.type).lastIndexOf('fallback');
  if (boundary <= 0) return content;
  const dropped = new Set(['thinking', 'redacted_thinking', 'tool_use']);
  return content.filter((b, i) => i >= boundary || !dropped.has(b.type));
}

/**
 * @param {object} args
 * @param {Anthropic} args.client
 * @param {string} args.systemPrompt
 * @param {Array} args.history      previous messages (Messages API format)
 * @param {string} args.userText    the new patient message
 * @param {Array} args.tools        tool definitions
 * @param {object} args.toolCtx     { phone, clinic, calendar, onHandoff(reason) => Promise<string> }
 * @param {(text: string) => Promise<void>} args.send  delivers a message to the patient
 * @param {object} [args.options]   overrides for { model, effort, refusalFallback }
 * @returns {Promise<{messages: Array, handedOff: boolean}>}  full updated history
 */
export async function runAgent({ client, systemPrompt, history, userText, tools, toolCtx, send, options = {} }) {
  const opts = {
    model: config.model,
    effort: config.effort,
    refusalFallback: config.refusalFallback,
    ...options,
  };

  const messages = [...history, { role: 'user', content: userText }];
  let handedOff = false;

  const ctx = {
    ...toolCtx,
    onHandoff: async (reason) => {
      handedOff = true;
      return toolCtx.onHandoff(reason);
    },
  };

  // Used when the model cannot continue (refusal, loop limit): hand the chat to a human.
  const escalate = async (reason) => {
    const confirmation = handedOff ? '' : await ctx.onHandoff(reason);
    if (confirmation) messages.push({ role: 'assistant', content: confirmation });
    return { messages, handedOff: true };
  };

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await callClaude(client, { system: systemPrompt, messages, tools }, opts);

    if (response.stop_reason === 'refusal') {
      log.warn('Model declined the request', { category: response.stop_details?.category ?? 'unknown' });
      return escalate('Automated safety filter declined to answer this conversation.');
    }

    const content = prepareAssistantContent(response.content);
    messages.push({ role: 'assistant', content });
    const text = textOf(response.content);

    if (response.stop_reason !== 'tool_use') {
      // Final answer. After a handoff the confirmation was already sent by the tool.
      if (text && !handedOff) await send(text);
      return { messages, handedOff };
    }

    // Text written together with tool calls (e.g. the emergency instruction) goes out first.
    if (text) await send(text);

    const results = [];
    for (const block of response.content.filter((b) => b.type === 'tool_use')) {
      log.info('Tool call', { tool: block.name });
      try {
        const result = await executeTool(block.name, block.input, ctx);
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
          ...(result.ok === false ? { is_error: true } : {}),
        });
      } catch (err) {
        log.error('Tool failed', { tool: block.name, error: describeError(err) });
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: 'Internal error while running this tool. Apologise briefly and offer a human follow-up.',
          is_error: true,
        });
      }
    }
    messages.push({ role: 'user', content: results });
  }

  log.warn('Tool loop limit reached');
  return escalate('The assistant could not finish this request automatically.');
}
