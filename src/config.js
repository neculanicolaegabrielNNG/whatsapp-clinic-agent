// Loads environment variables (.env) and exposes typed settings.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Load ".env" from the project root, regardless of the current working directory.
dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

const env = process.env;
const model = env.CLAUDE_MODEL?.trim() || 'claude-sonnet-5-5';

const effortRaw = (env.CLAUDE_EFFORT ?? 'low').trim().toLowerCase();

export const config = {
  port: Number(env.PORT) || 3000,

  anthropicApiKey: env.ANTHROPIC_API_KEY,
  model,
  // "none" / empty = do not send output_config.effort (needed for models that do not support it).
  effort: effortRaw === 'none' || effortRaw === '' ? null : effortRaw,
  // Server-side refusal fallback (beta). Not available for Haiku models.
  refusalFallback:
    (env.CLAUDE_REFUSAL_FALLBACK ?? 'true').toLowerCase() !== 'false' && !/haiku/i.test(model),

  whatsappToken: env.WHATSAPP_TOKEN,
  phoneNumberId: env.PHONE_NUMBER_ID,
  verifyToken: env.VERIFY_TOKEN,
  appSecret: env.APP_SECRET,
  graphApiVersion: env.GRAPH_API_VERSION?.trim() || 'v23.0',

  calendarProvider: (env.CALENDAR_PROVIDER || 'local').toLowerCase(),
  handoffPauseMinutes: Number(env.HANDOFF_PAUSE_MINUTES ?? 120),

  maxHistoryMessages: 20,

  paths: {
    clinic: path.join(ROOT, 'config', 'clinic.json'),
    systemPrompt: path.join(ROOT, 'prompts', 'system.md'),
    dataDir: path.join(ROOT, 'data'),
    conversations: path.join(ROOT, 'data', 'conversations.json'),
    appointments: path.join(ROOT, 'data', 'appointments.json'),
    calendarIcs: path.join(ROOT, 'data', 'calendar.ics'),
    processedIds: path.join(ROOT, 'data', 'processed-messages.json'),
  },
};

/**
 * Throws a readable error listing the missing variables.
 * @param {string[]} names keys of `config` (camelCase) to require
 */
export function requireConfig(names) {
  const envNames = {
    anthropicApiKey: 'ANTHROPIC_API_KEY',
    whatsappToken: 'WHATSAPP_TOKEN',
    phoneNumberId: 'PHONE_NUMBER_ID',
    verifyToken: 'VERIFY_TOKEN',
    appSecret: 'APP_SECRET',
  };
  const missing = names.filter((n) => !config[n]).map((n) => envNames[n] ?? n);
  if (missing.length > 0) {
    throw new Error(
      `Missing environment variables: ${missing.join(', ')}. Copy .env.example to .env and fill them in.`,
    );
  }
}
