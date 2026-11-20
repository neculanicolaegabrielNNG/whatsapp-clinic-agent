// Remembers processed WhatsApp message IDs so Meta's webhook retries are ignored.
// Kept in memory and mirrored to data/processed-messages.json (survives restarts).
import { config } from './config.js';
import { readJson, writeJson } from './store.js';

export class ProcessedIds {
  constructor({ file = config.paths.processedIds, limit = 2000 } = {}) {
    this.file = file;
    this.limit = limit;
    this.ids = new Set(readJson(file, []));
  }

  /** Returns true if the ID is new (and records it); false if it was already seen. */
  claim(id) {
    if (!id || this.ids.has(id)) return false;
    this.ids.add(id);
    while (this.ids.size > this.limit) {
      this.ids.delete(this.ids.values().next().value); // drop the oldest
    }
    writeJson(this.file, [...this.ids]);
    return true;
  }
}
