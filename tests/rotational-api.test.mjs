import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequestPost } from '../functions/api/rotational.js';
import { onRequestGet, onRequestPut } from '../functions/api/rotational-health.js';

// Trimmed to two slots; tests/veco-post.test.mjs owns the parsing edge cases.
const ADVISORY = [
  'ONGOING ROTATIONAL BROWNOUT',
  '11:00AM-12:00PM | SEPTEMBER 3, 2026',
  'Portion of Cebu City: Guadalupe, Labangon, & Sambag 1',
  'View the map here: https://tinyurl.com/4t5zrpan',
  '1:00PM-3:30PM | SEPTEMBER 3, 2026',
  'Portion of Mandaue City: Bakilid, Centro, & Ibabao',
].join('\n');

function environment(store = {}) {
  const writes = [];
  return {
    writes,
    env: {
      ROTATIONAL_TOKEN: 't',
      REACTIONS: {
        async get(key) { return store[key] ?? null; },
        async put(key, value) { writes.push({ key, value }); store[key] = value; },
        async delete(key) { delete store[key]; },
      },
    },
  };
}

const post = (body, token = 't') => new Request('https://accoworks.dev/api/rotational', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify(body),
});

const put = (body, token = 't') => new Request('https://accoworks.dev/api/rotational-health', {
  method: 'PUT',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify(body),
});

test('stamps poller provenance onto every stored slot', async () => {
  const { env } = environment();
  const response = await onRequestPost({
    request: post({ text: ADVISORY, via: 'auto', postedAt: '2026-09-03T13:29:30+08:00' }),
    env,
  });

  assert.equal(response.status, 200);
  const { items } = await response.json();
  assert.ok(items.length > 0);
  for (const item of items) {
    assert.equal(item.via, 'auto');
    assert.equal(item.postedAt, '2026-09-03T13:29:30+08:00');
  }
});

test('defaults an unstamped submission to a hand paste', async () => {
  const { env } = environment();
  const response = await onRequestPost({ request: post({ text: ADVISORY }), env });

  assert.equal(response.status, 200);
  const { items } = await response.json();
  assert.ok(items.length > 0);
  for (const item of items) {
    assert.equal(item.via, 'paste');
    assert.equal(item.postedAt, null);
  }
});

test('rejects an unknown via or an unparseable postedAt without touching KV', async () => {
  for (const [body, error] of [
    [{ text: ADVISORY, via: 'bot' }, 'via must be auto or paste'],
    [{ text: ADVISORY, postedAt: 'yesterday' }, 'postedAt must be an ISO date'],
  ]) {
    const { env, writes } = environment();
    const response = await onRequestPost({ request: post(body), env });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error });
    assert.deepEqual(writes, []);
  }
});

test('refuses a health heartbeat with a bad token', async () => {
  const { env, writes } = environment();
  const response = await onRequestPut({ request: put({ result: 'stored' }, 'nope'), env });

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'bad token' });
  assert.deepEqual(writes, []);
});

test('records a successful check with a fresh timestamp', async () => {
  const { env, writes } = environment();
  const before = Date.now();
  const response = await onRequestPut({
    request: put({
      result: 'stored',
      latestPostId: '1535618865260397',
      latestPostAt: '2026-09-03T13:29:30+08:00',
      detail: '7 slots stored',
      pinned: true,
    }),
    env,
  });

  assert.equal(response.status, 200);
  const { ok, health } = await response.json();
  assert.equal(ok, true);
  assert.deepEqual(writes.map((write) => write.key), ['rotational:health']);
  assert.deepEqual(JSON.parse(writes[0].value), health);
  assert.ok(Date.parse(health.checkedAt) >= before);
  assert.equal(health.latestPostId, '1535618865260397');
  assert.equal(health.latestPostAt, '2026-09-03T13:29:30+08:00');
  assert.equal(health.result, 'stored');
  assert.equal(health.detail, '7 slots stored');
  assert.equal(health.pinned, true);
  assert.equal(health.lastErrorAt, null);
});

test('an error never advances the last successful check', async () => {
  const previous = {
    checkedAt: '2026-09-03T05:29:30.000Z',
    latestPostId: '1535618865260397',
    latestPostAt: '2026-09-03T05:29:30.000Z',
    result: 'stored',
    detail: '7 slots stored',
    pinned: false,
    lastErrorAt: null,
  };
  const { env } = environment({ 'rotational:health': JSON.stringify(previous) });
  const response = await onRequestPut({
    request: put({ result: 'error', detail: 'no timeline_list_feed_units in 512 KB' }),
    env,
  });

  assert.equal(response.status, 200);
  const { health } = await response.json();
  assert.equal(health.checkedAt, previous.checkedAt);
  assert.equal(health.latestPostId, previous.latestPostId);
  assert.equal(health.latestPostAt, previous.latestPostAt);
  assert.equal(health.result, 'stored');
  assert.equal(health.detail, 'no timeline_list_feed_units in 512 KB');
  assert.ok(Date.parse(health.lastErrorAt) > Date.parse(previous.checkedAt));
});

test('reports a never-checked feed when KV is empty', async () => {
  const { env } = environment();
  const response = await onRequestGet({ env });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), {
    checkedAt: null,
    latestPostId: null,
    latestPostAt: null,
    result: null,
    detail: '',
    pinned: false,
    lastErrorAt: null,
  });
});
