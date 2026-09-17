import assert from 'node:assert/strict';
import test from 'node:test';

import { onRequestGet } from '../functions/api/fyi.js';

const FYI_URL = 'https://script.google.com/macros/s/AKfycbwryIwtUJgnOrCWYlXhEeDnxOm2lg-C_Ji9CREsjKjUvLsrQCroX-QvgBeLR_qtgQbggw/exec';
const NOW = Date.parse('2026-09-03T12:00:00.000Z');

function fyiBody(value = {
  view: 'public',
  stamp: '42.23961.115z31j',
  plans: [{ id: 'PLAN-1', du: 'VECO', date: '2026-09-03', entries: [{ hour: 8, feeders: ['F-ONE'] }] }],
  outages: [],
}) {
  return `<script>const BOOT = ${JSON.stringify(value)};</script>`;
}

function installCache(t, cache) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  Object.defineProperty(globalThis, 'caches', { configurable: true, value: cache });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'caches', descriptor);
    else delete globalThis.caches;
  });
}

function edgeCache() {
  const entries = new Map();
  const calls = { match: [], put: [] };
  return {
    calls,
    default: {
      async match(request) {
        calls.match.push(request.url);
        return entries.get(request.url)?.clone() || undefined;
      },
      async put(request, response) {
        calls.put.push(request.url);
        entries.set(request.url, response.clone());
      },
    },
  };
}

test('returns the compact FYI envelope for the shared Cebu date window without accepting request input', async (t) => {
  installCache(t, undefined);
  t.mock.method(Date, 'now', () => NOW);
  let receivedOptions;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(String(url), FYI_URL);
    receivedOptions = options;
    return new Response(fyiBody());
  });

  const response = await onRequestGet({ request: new Request('https://accoworks.dev/api/fyi?from=1900-01-01') });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'public, max-age=60');
  assert.equal(receivedOptions.cf.cacheTtl, 60);
  assert.deepEqual(body, {
    available: true,
    checkedAt: new Date(NOW).toISOString(),
    sourceStamp: '42.23961.115z31j',
    freshness: 'unknown',
    sourceUrl: 'https://fyi.aboitizpower.com/',
    plans: [{
      id: 'PLAN-1',
      date: '2026-09-03',
      windows: [{ start: '2026-09-03T08:00:00+08:00', end: '2026-09-03T09:00:00+08:00', hours: 1, feederCount: 1, actual: null }],
    }],
    advisories: [],
    warnings: [],
  });
  assert.equal(JSON.stringify(body).includes('F-ONE'), false);
});

test('edge-caches a normalized FYI summary under a fixed route key', async (t) => {
  const cache = edgeCache();
  installCache(t, cache);
  t.mock.method(Date, 'now', () => NOW);
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests += 1;
    return new Response(fyiBody());
  });

  const first = await onRequestGet({ waitUntil() {} });
  const second = await onRequestGet({ waitUntil() {} });

  assert.equal(requests, 1);
  assert.equal(cache.calls.put.length, 1);
  assert.deepEqual(cache.calls.put, ['https://accoworks.dev/__edge-cache/fyi-summary-v1']);
  assert.deepEqual(await first.json(), await second.json());
});

test('caches a fail-closed FYI summary without exposing the upstream parse error', async (t) => {
  const cache = edgeCache();
  installCache(t, cache);
  t.mock.method(Date, 'now', () => NOW);
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests += 1;
    return new Response('<script>const BOOT = malformed;</script>');
  });

  const first = await onRequestGet({});
  const second = await onRequestGet({});
  const firstBody = await first.json();
  const secondBody = await second.json();

  assert.equal(requests, 1);
  assert.deepEqual(firstBody, secondBody);
  assert.deepEqual(firstBody, {
    available: false,
    checkedAt: new Date(NOW).toISOString(),
    sourceStamp: null,
    freshness: 'unknown',
    sourceUrl: 'https://fyi.aboitizpower.com/',
    plans: [],
    advisories: [],
    warnings: ['AboitizPower FYI is unavailable'],
  });
  assert.equal(JSON.stringify(firstBody).includes('malformed'), false);
});
