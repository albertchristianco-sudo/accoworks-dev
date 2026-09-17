import assert from 'node:assert/strict';
import test from 'node:test';

import { onRequestGet } from '../functions/api/outages.js';

const CALENDAR_URL = 'https://docs.google.com/spreadsheets/d/';
const NOW = Date.parse('2026-09-03T12:00:00.000Z');

const FYI_URL = 'https://script.google.com/macros/s/AKfycbwryIwtUJgnOrCWYlXhEeDnxOm2lg-C_Ji9CREsjKjUvLsrQCroX-QvgBeLR_qtgQbggw/exec';

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


test('/api/outages returns the authoritative calendar without touching FYI', async (t) => {
  t.mock.method(Date, 'now', () => NOW);
  let fyiCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url).startsWith(CALENDAR_URL)) return new Response(calendarBody());
    if (String(url) === FYI_URL) {
      fyiCalls += 1;
      return new Promise(() => {});
    }
    throw new Error(`unexpected request: ${url}`);
  });

  const response = await onRequestGet({ env: {} });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.calendar.available, true);
  assert.deepEqual(body.entries.map(({ start, end, area }) => ({ start, end, area })), [{
    start: '2026-09-03T08:00:00+08:00', end: '2026-09-03T09:00:00+08:00', area: 'Apas, Cebu City',
  }]);
  assert.equal(fyiCalls, 0);
  assert.deepEqual(body.fyi, {
    available: false,
    checkedAt: null,
    sourceStamp: null,
    freshness: 'unknown',
    sourceUrl: 'https://fyi.aboitizpower.com/',
    plans: [],
    advisories: [],
    warnings: [],
  });
  assert.equal(JSON.stringify(body).includes('feeders'), false);
  assert.equal(JSON.stringify(body).includes('polygon'), false);
});


test('/api/outages keeps a fixed, geometry-free FYI compatibility field when the calendar is unavailable', async (t) => {
  t.mock.method(Date, 'now', () => NOW);
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url).startsWith(CALENDAR_URL)) throw new Error('calendar unavailable');
    if (String(url).includes('sitemap.xml')) return new Response('<urlset/>');
    throw new Error(`unexpected request: ${url}`);
  });

  const response = await onRequestGet({ env: {} });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.calendar.available, false);
  assert.deepEqual(body.fyi, {
    available: false,
    checkedAt: null,
    sourceStamp: null,
    freshness: 'unknown',
    sourceUrl: 'https://fyi.aboitizpower.com/',
    plans: [],
    advisories: [],
    warnings: [],
  });
  assert.equal(JSON.stringify(body).includes('clouds'), false);
  assert.equal(JSON.stringify(body).includes('windows'), false);
});
