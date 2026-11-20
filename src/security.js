// Webhook security helpers.
import crypto from 'node:crypto';

/** Constant-time string comparison. */
export function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * Validates Meta's X-Hub-Signature-256 header ("sha256=<hex hmac of the RAW body>").
 * @param {Buffer|undefined} rawBody  exact bytes received
 * @param {string|undefined} header   value of X-Hub-Signature-256
 * @param {string} appSecret
 */
export function isValidSignature(rawBody, header, appSecret) {
  if (!rawBody || !header || !appSecret) return false;
  const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  return safeEqual(header, expected);
}
