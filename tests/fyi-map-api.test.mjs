import assert from 'node:assert/strict';
import test from 'node:test';

import { onRequestGet } from '../functions/api/fyi-map.js';

const FYI_URL = 'https://script.google.com/macros/s/AKfycbwryIwtUJgnOrCWYlXhEeDnxOm2lg-C_Ji9CREsjKjUvLsrQCroX-QvgBeLR_qtgQbggw/exec';
const NOW = Date.parse('2026-09-03T12:00:00.000Z');
const ATTRIBUTION = {
  label: '© OpenStreetMap contributors',
  url: 'https://www.openstreetmap.org/copyright',
};
const UNAVAILABLE_WARNING = 'AboitizPower FYI map is unavailable';

function fyiBody(value = {
  view: 'public',
  stamp: '42.23961.115z31j',
  plans: [],
  outages: [],
}) {
  return `<script>const BOOT = ${JSON.stringify(value)};</script>`;
}

function mapBoot(overrides = {}) {
  return {
    view: 'public',
    stamp: '42.23961.115z31j',
    plans: [{
      id: 'PLAN-1',
      du: 'VECO',
      date: '2026-09-03',
      entries: [{ hour: 8, feeders: ['F-ONE'] }],
    }],
    outages: [],
    feeders: { f: { 'F-ONE': { c: [10, 123], p: [0, 0] } } },
    ...overrides,
  };
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

function mockFyiFetch(t, upstream, cache = undefined) {
  installCache(t, cache);
  t.mock.method(Date, 'now', () => NOW);
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(String(url), FYI_URL);
    return upstream(options);
  });
}

function assertUnavailable(body) {
  assert.deepEqual({
    version: body.version,
    available: body.available,
    sourceStamp: body.sourceStamp,
    freshness: body.freshness,
    sourceUrl: body.sourceUrl,
    attribution: body.attribution,
    bounds: body.bounds,
    clouds: body.clouds,
    windows: body.windows,
    warnings: body.warnings,
  }, {
    version: 1,
    available: false,
    sourceStamp: null,
    freshness: 'unknown',
    sourceUrl: 'https://fyi.aboitizpower.com/',
    attribution: ATTRIBUTION,
    bounds: null,
    clouds: [],
    windows: [],
    warnings: [UNAVAILABLE_WARNING],
  });
  assert.ok(Number.isFinite(Date.parse(body.checkedAt)));
}

async function unavailableFor(t, upstream) {
  mockFyiFetch(t, upstream);
  const response = await onRequestGet();
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'public, max-age=60');
  assertUnavailable(body);
  return body;
}

test('returns the bounded FYI map envelope and cache header without user input', async (t) => {
  let receivedOptions;
  mockFyiFetch(t, (options) => {
    receivedOptions = options;
    return new Response(fyiBody(mapBoot()));
  });

  const response = await onRequestGet({
    request: new Request('https://accoworks.dev/api/fyi-map?lat=10.3&lon=123.9'),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'public, max-age=60');
  assert.equal(receivedOptions.cf.cacheTtl, 60);
  assert.deepEqual(body, {
    version: 1,
    available: true,
    checkedAt: new Date(NOW).toISOString(),
    sourceStamp: '42.23961.115z31j',
    freshness: 'unknown',
    sourceUrl: 'https://fyi.aboitizpower.com/',
    attribution: ATTRIBUTION,
    bounds: { south: 10, west: 123, north: 10, east: 123 },
    clouds: [{ c: [10, 123], p: [0, 0] }],
    windows: [{
      start: '2026-09-03T08:00:00+08:00',
      end: '2026-09-03T09:00:00+08:00',
      feederCount: 1,
      cloudIndexes: [0],
      confirmedCloudIndexes: [],
      confirmedUntil: null,
      operatorState: 'none',
    }],
    warnings: [],
  });
});

test('edge-caches a renderable normalized map envelope under a fixed route key', async (t) => {
  const cache = edgeCache();
  let requests = 0;
  mockFyiFetch(t, () => {
    requests += 1;
    return new Response(fyiBody(mapBoot()));
  }, cache);

  const first = await onRequestGet({ waitUntil() {} });
  const second = await onRequestGet({ waitUntil() {} });

  assert.equal(requests, 1);
  assert.deepEqual(cache.calls.put, ['https://accoworks.dev/__edge-cache/fyi-map-v1']);
  assert.deepEqual(await first.json(), await second.json());
});

test('fails closed when parsed FYI data has no renderable map geometry', async (t) => {
  await unavailableFor(t, () => new Response(fyiBody()));
});

test('coalesces concurrent map normalizations when the Cache API is absent', async (t) => {
  let requests = 0;
  let release;
  mockFyiFetch(t, () => {
    requests += 1;
    return new Promise((resolve) => {
      release = resolve;
    });
  });

  const first = onRequestGet();
  const second = onRequestGet();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests, 1);
  release(new Response(fyiBody(mapBoot())));

  const [firstResponse, secondResponse] = await Promise.all([first, second]);
  assert.deepEqual(await firstResponse.json(), await secondResponse.json());
});

test('fails closed and edge-caches malformed map envelopes without leaking details', async (t) => {
  const cache = edgeCache();
  let requests = 0;
  mockFyiFetch(t, () => {
    requests += 1;
    return new Response('<script>const BOOT = malformed;</script>');
  }, cache);

  const first = await onRequestGet({});
  const second = await onRequestGet({});
  const firstBody = await first.json();
  const secondBody = await second.json();

  assert.equal(requests, 1);
  assertUnavailable(firstBody);
  assert.deepEqual(firstBody, secondBody);
  assert.equal(JSON.stringify(firstBody).includes('malformed'), false);
});

test('fails closed for an oversized streamed FYI response', async (t) => {
  const oversized = await unavailableFor(t, () => new Response('x'.repeat((2 * 1024 * 1024) + 1)));
  assert.equal(JSON.stringify(oversized).includes('exceeded'), false);
});

test('fails closed when the FYI map summary rejects a global geometry cap breach', async (t) => {
  const names = Array.from({ length: 65 }, (_, index) => `F-${index}`);
  const body = await unavailableFor(t, () => new Response(fyiBody(mapBoot({
    plans: [{
      id: 'PLAN-1',
      du: 'VECO',
      date: '2026-09-03',
      entries: [{ hour: 8, feeders: names }],
    }],
    feeders: {
      f: Object.fromEntries(names.map((name) => [name, { c: [10, 123], p: [0, 0] }])),
    },
  }))));
  assert.equal(JSON.stringify(body).includes('F-0'), false);
});

test('keeps the FYI timeout armed while the map response body stalls after headers', async (t) => {
  let fyiTimer;
  const clearedTimers = new Set();
  let fyiSignal;
  let bodyReadStarted = false;
  let releaseBodyRead;
  let bodyAborted = false;
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => {
    const timer = { callback, delay };
    if (delay === 8_000) fyiTimer = timer;
    return timer;
  });
  t.mock.method(globalThis, 'clearTimeout', (timer) => {
    clearedTimers.add(timer);
  });
  mockFyiFetch(t, ({ signal }) => {
    fyiSignal = signal;
    return new Response(new ReadableStream({
      start(controller) {
        signal.addEventListener('abort', () => {
          bodyAborted = true;
          controller.error(new Error('upstream body aborted'));
        }, { once: true });
      },
      pull() {
        bodyReadStarted = true;
        return new Promise((resolve) => {
          releaseBodyRead = resolve;
        });
      },
    }));
  });

  const request = onRequestGet();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(fyiTimer);
  assert.ok(fyiSignal);
  assert.equal(bodyReadStarted, true);
  const timeoutWasArmedDuringBodyRead = !clearedTimers.has(fyiTimer);

  fyiTimer.callback();
  releaseBodyRead();
  const response = await request;
  const body = await response.json();

  assert.equal(timeoutWasArmedDuringBodyRead, true);
  assert.equal(fyiSignal.aborted, true);
  assert.equal(bodyAborted, true);
  assert.equal(clearedTimers.has(fyiTimer), true);
  assert.equal(response.status, 200);
  assertUnavailable(body);
  assert.equal(JSON.stringify(body).includes('upstream body aborted'), false);
});
