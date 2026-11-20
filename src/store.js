// Tiny JSON-file helpers with atomic writes (write to a temp file, then rename).
import fs from 'node:fs';
import path from 'node:path';

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw new Error(`Could not read ${path.basename(file)}: ${err.message}`);
  }
}

export function writeFileAtomic(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, contents, 'utf8');
  fs.renameSync(tmp, file);
}

export function writeJson(file, data) {
  writeFileAtomic(file, JSON.stringify(data, null, 2));
}
