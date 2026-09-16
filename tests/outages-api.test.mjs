import assert from 'node:assert/strict';
import test from 'node:test';

import { onRequestGet } from '../functions/api/outages.js';

const CALENDAR_URL = 'https://docs.google.com/spreadsheets/d/';
const FYI_URL = 'https://script.google.com/macros/s/AKfycbwryIwtUJgnOrCWYlXhEeDnxOm2lg-C_Ji9CREsjKjUvLsrQCroX-QvgBeLR_qtgQbggw/exec';
const NOW = Date.parse('2026-09-03T12:00:00.000Z');

function calendarBody() {
  return JSON.stringify({
    status: 'ok',
    table: {
      cols: [{ label: 'Exact Date' }, { label: 'Time Info' }, { label: 'Locations' }],
      rows: [{ c: [
        { v: 'Date(2026,8,3)' }, { v: '8:00 AM - 9:00 AM' }, { v: 'Portion of Apas, Cebu City' },
      ] }],
    },
  });
}

function fyiBody(value = {
  view: 'public',
  stamp: '42.23961.115z31j',
  plans: [{ id: 'PLAN-1', du: 'VECO', date: '2026-09-03', entries: [{ hour: 8, feeders: ['F-ONE'] }] }],
  outages: [],
}) {
  return `<script>const BOOT = ${JSON.stringify(value)};</script>`;
}

function mockFetch(t, fyi) {
  t.mock.method(Date, 'now', () => NOW);
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url).startsWith(CALENDAR_URL)) return new Response(calendarBody());
    if (String(url) === FYI_URL) return fyi(options);
    throw new Error(`unexpected request: ${url}`);
  });
}

test('keeps a parsed FYI supplement separate from the authoritative calendar entries', async (t) => {
  mockFetch(t, () => new Response(fyiBody()));

  const response = await onRequestGet({ env: {} });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.calendar.available, true);
  assert.equal(body.entries.length, 1);
  assert.equal(body.entries[0].area, 'Apas, Cebu City');
  assert.equal(body.fyi.available, true);
  assert.deepEqual(body.fyi.plans, [{
    id: 'PLAN-1', date: '2026-09-03',
    windows: [{ start: '2026-09-03T08:00:00+08:00', end: '2026-09-03T09:00:00+08:00', hours: 1, feederCount: 1, actual: null }],
  }]);
  assert.equal(body.fyi.sourceStamp, '42.23961.115z31j');
  assert.equal(body.fyi.freshness, 'unknown');
  assert.equal(body.fyi.checkedAt, new Date(NOW).toISOString());
  assert.deepEqual(body.warnings, []);
  assert.equal(JSON.stringify(body.entries).includes('PLAN-1'), false);
});

test('contains an FYI failure without changing primary calendar data or warnings', async (t) => {
  mockFetch(t, () => Promise.reject(new Error('FYI unavailable')));

  const response = await onRequestGet({ env: {} });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.calendar.available, true);
  assert.deepEqual(body.entries.map(({ start, end, area }) => ({ start, end, area })), [{
    start: '2026-09-03T08:00:00+08:00', end: '2026-09-03T09:00:00+08:00', area: 'Apas, Cebu City',
  }]);
  assert.deepEqual(body.warnings, []);
  assert.deepEqual(body.fyi, {
    available: false,
    checkedAt: body.fyi.checkedAt,
    sourceStamp: null,
    freshness: 'unknown',
    sourceUrl: 'https://fyi.aboitizpower.com/',
    plans: [],
    advisories: [],
    warnings: ['AboitizPower FYI is unavailable'],
  });
  assert.ok(Number.isFinite(Date.parse(body.fyi.checkedAt)));
});

test('contains an over-budget FYI supplement without exposing its raw data', async (t) => {
  mockFetch(t, () => new Response(fyiBody({
    view: 'public',
    stamp: '42.23961.115z31j',
    plans: Array.from({ length: 65 }, (_, index) => ({
      id: `HOSTILE-${index}`, du: 'VECO', date: '2026-09-03',
      entries: [{ hour: 8, feeders: ['F-ONE'] }],
    })),
    outages: [],
  })));

  const response = await onRequestGet({ env: {} });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.calendar.available, true);
  assert.equal(body.fyi.available, false);
  assert.deepEqual(body.fyi.plans, []);
  assert.deepEqual(body.fyi.advisories, []);
  assert.equal(body.fyi.checkedAt, new Date(NOW).toISOString());
  assert.deepEqual(body.fyi.warnings, ['AboitizPower FYI is unavailable']);
  assert.equal(JSON.stringify(body).includes('HOSTILE-0'), false);
});

test('keeps the FYI timeout armed while a response body stalls after headers', async (t) => {
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
  mockFetch(t, ({ signal }) => {
    fyiSignal = signal;
    return new Response(new ReadableStream({
      start(controller) {
        signal.addEventListener('abort', () => {
          bodyAborted = true;
          controller.error(new Error('FYI body aborted'));
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

  const request = onRequestGet({ env: {} });
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
  assert.equal(body.calendar.available, true);
  assert.equal(body.fyi.available, false);
  assert.deepEqual(body.fyi.plans, []);
  assert.deepEqual(body.warnings, []);
  assert.deepEqual(body.fyi.warnings, ['AboitizPower FYI is unavailable']);
});
