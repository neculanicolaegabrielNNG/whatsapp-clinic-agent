// Error type shared by every calendar implementation, so the rest of the code
// (tools.js) can turn failures into short, model-friendly messages.

export class CalendarError extends Error {
  /**
   * @param {string} code  one of: INVALID_INPUT, UNKNOWN_SERVICE, INVALID_DATE, CLOSED, OUTSIDE_HOURS,
   *                       NOT_ON_SLOT, IN_PAST, TOO_FAR, SLOT_TAKEN, NOT_FOUND, ALREADY_CANCELLED
   * @param {string} message  human-readable explanation (English)
   * @param {object} [details]  extra data, e.g. { alternatives: [...] }
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CalendarError';
    this.code = code;
    this.details = details;
  }
}
