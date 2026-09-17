import assert from 'node:assert/strict';
import test from 'node:test';

import { onRequestGet } from '../functions/api/osm-tiles/[[path]].js';

const CACHE_KEY = 'https://accoworks.dev/__edge-cache/osm-tiles-v1/12/3458/1930.png';
const ROUTE = 'https://accoworks.dev/api/osm-tiles/12/3458/1930.png';
const TILE_URL = 'https://tile.openstreetmap.org/12/3458/1930.png';
const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);

function cache(t) {
  const entries = new Map();
  const calls = { match: [], put: [] };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    value: {
      default: {
        async match(request) {
          calls.match.push(request.url);
          return entries.get(request.url)?.clone();
        },
        async put(request, response) {
          calls.put.push(request.url);
          entries.set(request.url, response.clone());
        },
      },
    },
  });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'caches', descriptor);
    else delete globalThis.caches;
  });
  return calls;
}

function request(path = '12/3458/1930.png') {
  const routePath = Array.isArray(path) ? path.join('/') : path;
  return {
    params: { path },
    request: new Request(`https://accoworks.dev/api/osm-tiles/${routePath}`),
  };
}

test('serves and edge-caches an accepted Cebu PNG through the fixed OSM request', async (t) => {
  const calls = cache(t);
  let upstreamRequests = 0;
  const waiting = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    upstreamRequests += 1;
    assert.equal(String(url), TILE_URL);
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.accept, 'image/png');
    assert.equal(options.headers.referer, 'https://accoworks.dev/power/');
    assert.match(options.headers['user-agent'], /^accoworks\.dev .*ac@accoworks\.dev\)$/);
    return new Response(PNG, {
      status: 200,
      headers: {
        'cache-control': 'public, max-age=3600',
        'content-type': 'image/png',
        expires: 'Wed, 21 Oct 2026 07:28:00 GMT',
      },
    });
  });

  const first = await onRequestGet({ ...request(), waitUntil: (promise) => waiting.push(promise) });
  const second = await onRequestGet(request(['12', '3458', '1930.png']));

  assert.equal(first.status, 200);
  assert.equal(first.headers.get('content-type'), 'image/png');
  assert.equal(first.headers.get('cache-control'), 'public, max-age=3600');
  assert.equal(first.headers.get('expires'), 'Wed, 21 Oct 2026 07:28:00 GMT');
  assert.equal(first.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(new Uint8Array(await first.arrayBuffer()), PNG);
  assert.equal(second.status, 200);
  assert.equal(upstreamRequests, 1);
  assert.deepEqual(calls.match, [CACHE_KEY, CACHE_KEY]);
  assert.deepEqual(calls.put, [CACHE_KEY]);
  await Promise.all(waiting);
});

test('rejects query, malformed, and out-of-bounds paths without reaching upstream', async (t) => {
  let upstreamRequests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    upstreamRequests += 1;
    throw new Error('must not fetch invalid routes');
  });

  const query = await onRequestGet({
    ...request(),
    request: new Request(`${ROUTE}?url=https://example.test/elsewhere.png`),
  });
  const malformed = await onRequestGet({
    params: { path: '12/3458/not-a-tile.png' },
    request: new Request('https://accoworks.dev/api/osm-tiles/12/3458/not-a-tile.png'),
  });
  const outOfBounds = await onRequestGet({
    params: { path: '12/0/0.png' },
    request: new Request('https://accoworks.dev/api/osm-tiles/12/0/0.png'),
  });
  const queryOnly = await onRequestGet({
    params: { path: '' },
    request: new Request('https://accoworks.dev/api/osm-tiles/?z=12&x=3458&y=1930'),
  });

  for (const response of [query, malformed, outOfBounds, queryOnly]) {
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  }
  assert.equal(upstreamRequests, 0);
});

test('rejects non-PNG and actual oversized upstream bodies without caching them', async (t) => {
  const calls = cache(t);
  const oversized = new Uint8Array((512 * 1024) + 1);
  oversized.set(PNG);
  let upstreamRequests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    upstreamRequests += 1;
    if (upstreamRequests === 1) {
      return new Response('not an image', { status: 200, headers: { 'content-type': 'text/plain' } });
    }
    return new Response(oversized, { status: 200, headers: { 'content-type': 'image/png' } });
  });

  const nonPng = await onRequestGet(request());
  const tooLarge = await onRequestGet(request());

  assert.equal(nonPng.status, 502);
  assert.equal(tooLarge.status, 502);
  assert.equal(await nonPng.text(), 'Tile unavailable');
  assert.deepEqual(calls.put, []);
  assert.equal(upstreamRequests, 2);
});

test('rejects a declared oversized upstream response before reading its body', async (t) => {
  let read = false;
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    redirected: false,
    status: 200,
    headers: new Headers({ 'content-length': String((512 * 1024) + 1), 'content-type': 'image/png' }),
    async arrayBuffer() {
      read = true;
      return PNG.buffer;
    },
  }));

  const response = await onRequestGet(request());

  assert.equal(response.status, 502);
  assert.equal(read, false);
});
