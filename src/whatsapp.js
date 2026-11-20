// WhatsApp Cloud API (Graph API) sender.
import { config } from './config.js';
import { log, maskPhone } from './logger.js';

const MAX_TEXT_LENGTH = 4000; // WhatsApp text bodies are limited to 4096 characters

async function graphPost(payload) {
  const url = `https://graph.facebook.com/${config.graphApiVersion}/${config.phoneNumberId}/messages`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.whatsappToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const e = body.error ?? {};
    const err = new Error(`Graph API ${response.status}: ${e.message ?? 'request failed'}`);
    err.status = response.status;
    err.code = e.code; // e.g. 190 = token expired, 131047 = outside the 24h window
    throw err;
  }
  return response.json();
}

/** Sends a plain text message. */
export async function sendText(to, body) {
  const text = String(body).slice(0, MAX_TEXT_LENGTH);
  await graphPost({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { preview_url: false, body: text },
  });
  log.info('Reply sent', { to: maskPhone(to) });
}

/** Marks an incoming message as read (blue ticks). Best effort: failures are only logged. */
export async function markAsRead(messageId) {
  try {
    await graphPost({ messaging_product: 'whatsapp', status: 'read', message_id: messageId });
  } catch (err) {
    log.warn('Could not mark message as read', { status: err.status, code: err.code });
  }
}
