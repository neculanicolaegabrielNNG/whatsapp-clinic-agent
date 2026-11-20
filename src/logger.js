// Minimal logger. Privacy rules:
//  - never log message content;
//  - never log full phone numbers (always mask them).

/** "40712345678" -> "*******5678" */
export function maskPhone(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.length <= 4) return '****';
  return '*'.repeat(digits.length - 4) + digits.slice(-4);
}

/** Masks anything that looks like a phone number (7+ digits, optional +) inside free text. */
export function scrub(text) {
  return String(text).replace(/\+?\d[\d\s().-]{5,}\d/g, (m) => maskPhone(m));
}

function format(level, message, fields) {
  const parts = [new Date().toISOString(), level.toUpperCase().padEnd(5), scrub(message)];
  for (const [key, value] of Object.entries(fields ?? {})) {
    if (value === undefined || value === null) continue;
    parts.push(`${key}=${scrub(value)}`);
  }
  return parts.join(' ');
}

export const log = {
  info: (message, fields) => console.log(format('info', message, fields)),
  warn: (message, fields) => console.warn(format('warn', message, fields)),
  error: (message, fields) => console.error(format('error', message, fields)),
};

/** Safe summary of an unknown error for logs (no request/response bodies). */
export function describeError(err) {
  if (!err) return 'unknown error';
  const bits = [err.name];
  if (err.status) bits.push(`status ${err.status}`);
  if (err.code) bits.push(`code ${err.code}`);
  if (err.message) bits.push(String(err.message).slice(0, 200));
  return bits.join(' | ');
}
