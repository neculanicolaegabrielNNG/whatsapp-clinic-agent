// Webhook tests: verification, signature check, immediate 200, dedupe, privacy of logs.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { ProcessedIds } from '../src/dedupe.js';
import { maskPhone, scrub } from '../src/logger.js';
import { isValidSignature } from '../src/security.js';
import { tempDir } from './helpers.js';

config.verifyToken = 'verify-me';
config.appSecret = 'app-secret';

const sign = (body) => `sha256=${crypto.createHmac('sha256', config.appSecret).update(body).digest('hex')}`;

const payload = (message) =>
  JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ value: { messages: [message] } }] }],
  });

describe('webhook', () => {
  let server;
  let base;
  const handled = [];
  const sent = [];

  before(async () => {
    const app = createApp({
      handle: async (from, body) => void handled.push({ from, body }),
      send: async (to, body) => void sent.push({ to, body }),
      markRead: () => {},
      processed: new ProcessedIds({ file: path.join(tempDir(), 'processed.json') }),
    });
    await new Promise((resolve) => {
      server = app.listen(0, resolve);
    });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());

  const post = (body, signature = sign(body)) =>
    fetch(`${base}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature },
      body,
    });
  const settle = () => new Promise((r) => setTimeout(r, 50));

  it('answers the Meta verification challenge', async () => {
    const ok = await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345`);
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), '12345');
    const bad = await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1`);
    assert.equal(bad.status, 403);
  });

  it('rejects missing or wrong signatures', async () => {
    const body = payload({ id: 'wamid.1', from: '40700000001', type: 'text', text: { body: 'hi' } });
    assert.equal((await post(body, 'sha256=deadbeef')).status, 401);
    assert.equal((await fetch(`${base}/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).status, 401);
    await settle();
    assert.equal(handled.length, 0);
  });

  it('returns 200 and hands a signed text message to the handler', async () => {
    const body = payload({ id: 'wamid.2', from: '40700000001', type: 'text', text: { body: 'hello' } });
    assert.equal((await post(body)).status, 200);
    await settle();
    assert.deepEqual(handled, [{ from: '40700000001', body: 'hello' }]);
  });

  it('ignores duplicate message IDs', async () => {
    const body = payload({ id: 'wamid.2', from: '40700000001', type: 'text', text: { body: 'hello' } });
    assert.equal((await post(body)).status, 200);
    await settle();
    assert.equal(handled.length, 1);
  });

  it('politely refuses non-text messages and ignores status callbacks', async () => {
    const body = payload({ id: 'wamid.3', from: '40700000002', type: 'image', image: { id: 'x' } });
    assert.equal((await post(body)).status, 200);
    const statusOnly = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { statuses: [{ id: 's' }] } }] }] });
    assert.equal((await post(statusOnly)).status, 200);
    await settle();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, '40700000002');
    assert.equal(handled.length, 1);
  });
});

describe('security helpers', () => {
  it('validates X-Hub-Signature-256 against the raw body', () => {
    const raw = Buffer.from('{"a":1}');
    const good = `sha256=${crypto.createHmac('sha256', 's3').update(raw).digest('hex')}`;
    assert.equal(isValidSignature(raw, good, 's3'), true);
    assert.equal(isValidSignature(Buffer.from('{"a":2}'), good, 's3'), false);
    assert.equal(isValidSignature(raw, good, 'other'), false);
    assert.equal(isValidSignature(raw, undefined, 's3'), false);
    assert.equal(isValidSignature(raw, 'sha256=short', 's3'), false);
  });

  it('masks phone numbers for logs', () => {
    assert.equal(maskPhone('40712345678'), '*******5678');
    assert.equal(maskPhone('+40 712 345 678'), '*******5678');
    assert.ok(!scrub('failed for +40 712 345 678 today').includes('712'));
  });
});
