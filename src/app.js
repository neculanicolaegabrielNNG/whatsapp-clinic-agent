// Express app with the WhatsApp Cloud API webhook.
import express from 'express';
import { config } from './config.js';
import { ProcessedIds } from './dedupe.js';
import { handleIncomingMessage } from './handler.js';
import { describeError, log, maskPhone } from './logger.js';
import { isValidSignature, safeEqual } from './security.js';
import { markAsRead, sendText } from './whatsapp.js';

const UNSUPPORTED_TYPE_REPLY =
  'Sorry, I can only read text messages at the moment. Could you please type your request?';

/**
 * @param {object} [overrides]  for tests: { handle, send, markRead, processed }
 */
export function createApp(overrides = {}) {
  const handle = overrides.handle ?? handleIncomingMessage;
  const send = overrides.send ?? sendText;
  const markRead = overrides.markRead ?? markAsRead;
  const processed = overrides.processed ?? new ProcessedIds();

  const app = express();
  app.disable('x-powered-by');

  app.get('/', (_req, res) => res.send('WhatsApp clinic agent is running.'));
  app.get('/health', (_req, res) => res.json({ ok: true }));

  // 1) Webhook verification (Meta calls this once when you save the webhook).
  app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && safeEqual(token, config.verifyToken)) {
      log.info('Webhook verified');
      return res.status(200).type('text/plain').send(String(challenge ?? ''));
    }
    log.warn('Webhook verification failed (wrong VERIFY_TOKEN?)');
    return res.sendStatus(403);
  });

  // 2) Incoming events. The signature needs the exact raw bytes, so keep them.
  app.post(
    '/webhook',
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
    (req, res) => {
      if (!isValidSignature(req.rawBody, req.get('X-Hub-Signature-256'), config.appSecret)) {
        log.warn('Rejected webhook call with an invalid signature');
        return res.sendStatus(401);
      }

      res.sendStatus(200); // answer immediately; Meta retries if we are slow

      processPayload(req.body).catch((err) =>
        log.error('Unexpected error while processing webhook', { error: describeError(err) }),
      );
    },
  );

  async function processPayload(body) {
    if (body?.object !== 'whatsapp_business_account') return;
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const message of change.value?.messages ?? []) {
          // Not awaited: different patients are served in parallel (same patient: in order, see handler.js).
          processMessage(message).catch((err) =>
            log.error('Message processing failed', { error: describeError(err) }),
          );
        }
        // change.value.statuses (delivered/read receipts) are ignored on purpose.
      }
    }
  }

  async function processMessage(message) {
    if (!processed.claim(message.id)) {
      log.info('Duplicate message ignored');
      return;
    }
    const from = message.from;
    log.info('Message received', { from: maskPhone(from), type: message.type }); // never the content

    markRead(message.id);

    if (message.type !== 'text' || !message.text?.body) {
      await send(from, UNSUPPORTED_TYPE_REPLY);
      return;
    }
    await handle(from, message.text.body, { send });
  }

  return app;
}
