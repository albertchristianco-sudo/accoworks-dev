import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FYI_MAX_INPUT_BYTES,
  emptyFyi,
  parseFyiResponse,
  summarizeFyiBoot,
  summarizeFyiMap,
} from '../src/scripts/fyi.mjs';

const NOW = Date.parse('2026-09-03T12:00:00.000Z');
const WINDOW = { from: '2026-09-03', to: '2026-09-05', nowMs: NOW };

function boot(overrides = {}) {
  return {
    view: 'public',
    stamp: '42.23961.115z31j',
    plans: [],
    outages: [],
    ...overrides,
  };
}

function userHtml(value) {
  return `<script>const BOOT = ${JSON.stringify(value)};</script>`;
}

function encodedBoot(value) {
  return JSON.stringify(value).replace(/[{}"]+/g, (token) => [...token].map((char) => {
    if (char === '{') return '\\x7b';
    if (char === '}') return '\\x7d';
    return '\\x22';
  }).join(''));
}

function initWrapper(html) {
  const literal = JSON.stringify(JSON.stringify({ userHtml: html }))
    .replace('<', '\\x3c')
    .replace('public', '\\u0070ublic');
  const split = 12;
  return `goog.script.init(${literal.slice(0, split)}${String.fromCharCode(92, 10)}${literal.slice(split)});`;
}

function plan(id, entries) {
  return { id, du: 'VECO', date: '2026-09-03', radius: 300, notes: 'private plan note', entries };
}

function entry(hour, feeders, extras = {}) {
  return { hour, feeders, mw: 4, ...extras };
}

function advisory(id) {
  return {
    id, du: 'VECO', type: 'MLD',
    start: '2026-09-03T08:00:00.000Z', end: '2026-09-03T09:00:00.000Z',
  };
}

function feeders(count, prefix) {
  return Array.from({ length: count }, (_, index) => `${prefix}-${index}`);
}

function collectionPlan(id, entryCount, feedersPerEntry = 1) {
  return plan(id, Array.from(
    { length: entryCount },
    (_, hour) => entry(hour, feeders(feedersPerEntry, `${id}-H${hour}`)),
  ));
}

function collectionPlans(count, entryCount, feedersPerEntry = 1) {
  return Array.from(
    { length: count },
    (_, index) => collectionPlan(`PLAN-${index}`, entryCount, feedersPerEntry),
  );
}

function cloud(pointPairs = 1, latitudeDelta = 0, longitudeDelta = 0) {
  return {
    c: [10, 123],
    p: Array.from({ length: pointPairs }, () => [latitudeDelta, longitudeDelta]).flat(),
  };
}

function mapGeometry(ids, pointPairs = 1, latitudeDelta = 0, longitudeDelta = 0) {
  return Object.fromEntries(ids.map((id) => [id, cloud(pointPairs, latitudeDelta, longitudeDelta)]));
}

test('reads plain userHtml and an escaped Apps Script init wrapper without executing source', () => {
  const value = boot({
    plans: [plan('PLAN-1', [entry(8, ['F-ONE'])])],
    outages: [{
      id: 'ADV-1', du: 'VECO', type: 'MLD', start: '2026-09-03T08:00:00.000Z', end: '2026-09-03T09:00:00.000Z',
    }],
  });

  assert.deepEqual(parseFyiResponse(userHtml(value)), {
    view: 'public', stamp: value.stamp, plans: value.plans, outages: value.outages,
  });
  assert.deepEqual(parseFyiResponse(initWrapper(`<script>const BOOT = ${encodedBoot(value)};</script>`)), {
    view: 'public', stamp: value.stamp, plans: value.plans, outages: value.outages,
  });
});

test('rejects malformed, private, incomplete, and oversized FYI bootstrap sources', () => {
  const privateBoot = boot({ view: 'ops' });
  const incomplete = '<script>const BOOT = {"view":"public","plans":[]};</script>';
  const unterminated = '<script>const BOOT = {"view":"public","plans":[],"outages":[];</script>';

  for (const input of ['', userHtml(privateBoot), incomplete, unterminated, 'x'.repeat(FYI_MAX_INPUT_BYTES + 1)]) {
    assert.throws(() => parseFyiResponse(input));
  }
});

test('filters to windowed VECO plans and keeps noncontiguous planned hours distinct', () => {
  const result = summarizeFyiBoot(boot({
    plans: [
      plan('PLAN-GAPS', [entry(8, ['F-ONE']), entry(9, ['F-ONE']), entry(11, ['F-ONE'])]),
      { ...plan('PLAN-OTHER-DU', [entry(8, ['F-TWO'])]), du: 'DLEC' },
      { ...plan('PLAN-OUTSIDE', [entry(8, ['F-THREE'])]), date: '2026-09-06' },
    ],
  }), WINDOW);

  assert.deepEqual({ sourceStamp: result.sourceStamp, freshness: result.freshness }, {
    sourceStamp: '42.23961.115z31j',
    freshness: 'unknown',
  });

  assert.deepEqual(result.plans, [{
    id: 'PLAN-GAPS',
    date: '2026-09-03',
    windows: [
      { start: '2026-09-03T08:00:00+08:00', end: '2026-09-03T10:00:00+08:00', hours: 2, feederCount: 1, actual: null },
      { start: '2026-09-03T11:00:00+08:00', end: '2026-09-03T12:00:00+08:00', hours: 1, feederCount: 1, actual: null },
    ],
  }]);
});

test('preserves only bounded opaque FYI change tokens without inferring freshness', () => {
  assert.deepEqual(
    summarizeFyiBoot(boot({ stamp: '42.23961.115z31j' }), WINDOW),
    {
      sourceStamp: '42.23961.115z31j', freshness: 'unknown', plans: [], advisories: [], warnings: [],
    },
  );

  for (const stamp of ['2026-09-03T11:59:00.000Z', '.42.23961', 'contains a space', 'x'.repeat(97)]) {
    const result = summarizeFyiBoot(boot({ stamp }), WINDOW);
    assert.deepEqual({ sourceStamp: result.sourceStamp, freshness: result.freshness }, {
      sourceStamp: null, freshness: 'unknown',
    });
    assert.equal(parseFyiResponse(userHtml(boot({ stamp }))).stamp, null);
  }
});

test('fails closed on FYI collection budgets and bounds malformed warnings', () => {
  const summarize = (overrides) => summarizeFyiBoot(boot(overrides), WINDOW);
  const rejectsBudget = (overrides) => assert.throws(() => summarize(overrides), /collection limit/);

  assert.doesNotThrow(() => summarize({ plans: collectionPlans(64, 1) }));
  rejectsBudget({ plans: collectionPlans(65, 1) });

  assert.doesNotThrow(() => summarize({ outages: Array.from({ length: 128 }, (_, index) => advisory(`ADV-${index}`)) }));
  rejectsBudget({ outages: Array.from({ length: 129 }, (_, index) => advisory(`ADV-${index}`)) });

  assert.doesNotThrow(() => summarize({ plans: [collectionPlan('ENTRIES-AT-LIMIT', 24)] }));
  rejectsBudget({ plans: [collectionPlan('ENTRIES-OVER-LIMIT', 25)] });
  rejectsBudget({ plans: [{ ...collectionPlan('OTHER-DU-OVER-LIMIT', 25), du: 'DLEC' }] });

  assert.doesNotThrow(() => summarize({ plans: [collectionPlan('FEEDERS-AT-LIMIT', 1, 128)] }));
  rejectsBudget({ plans: [collectionPlan('FEEDERS-OVER-LIMIT', 1, 129)] });

  const liveScalePlans = collectionPlans(15, 10, 10);
  liveScalePlans[14].entries[0].feeders.push(...feeders(95, 'LIVE-SCALE-EXTRA'));
  assert.doesNotThrow(() => summarize({ plans: liveScalePlans }));

  const referencesAtLimit = [
    ...collectionPlans(2, 24, 128),
    collectionPlan('REFERENCES-AT-LIMIT', 16, 128),
  ];
  assert.doesNotThrow(() => summarize({ plans: referencesAtLimit }));

  const referencesOverLimit = collectionPlan('REFERENCES-OVER-LIMIT', 17, 128);
  referencesOverLimit.entries.at(-1).feeders = feeders(1, 'ONE-MORE-REFERENCE');
  rejectsBudget({ plans: [...collectionPlans(2, 24, 128), referencesOverLimit] });

  assert.doesNotThrow(() => summarize({
    plans: [...collectionPlans(10, 24), collectionPlan('WINDOWS-AT-LIMIT', 16)],
  }));
  rejectsBudget({ plans: collectionPlans(11, 24) });

  const result = summarize({
    plans: [
      { ...plan('BAD-PLAN-1', []), id: null },
      { ...plan('BAD-PLAN-2', []), id: null },
      { ...plan('BAD-PLAN-3', []), id: null },
    ],
    outages: [
      { ...advisory('BAD-ADVISORY-1'), id: null },
      { ...advisory('BAD-ADVISORY-2'), id: null },
    ],
  });
  assert.deepEqual(result.warnings, [
    'Skipped 3 malformed FYI plans',
    'Skipped 2 malformed FYI advisories',
  ]);
});

test('summarizes only validated per-feeder, aggregate, and stale actual records', () => {
  const started = '2026-09-03T11:00:00.000Z';
  const restoredAt = '2026-09-03T11:30:00.000Z';
  const staleStart = '2026-09-02T23:00:00.000Z';
  const result = summarizeFyiBoot(boot({
    plans: [
      plan('PARTIAL', [entry(8, ['F-ONE', 'F-TWO'], { byFeeder: { 'F-ONE': { start: started, mw: 1.5 } } })]),
      plan('ALL-OFF', [entry(9, ['F-THREE', 'F-FOUR'], { byFeeder: {
        'F-THREE': { start: started, mw: 1 }, 'F-FOUR': { start: started, mw: 2 },
      } })]),
      plan('RESTORED', [entry(10, ['F-FIVE'], { byFeeder: { 'F-FIVE': { start: started, end: restoredAt, mw: 2 } } })]),
      plan('STALE', [entry(11, ['F-SIX'], { byFeeder: { 'F-SIX': { start: staleStart, mw: 3 } } })]),
      plan('AGGREGATE', [entry(12, ['F-SEVEN', 'F-EIGHT'], { actual: { start: started, mw: 5 } })]),
      plan('INVALID-ACTUAL', [entry(13, ['F-NINE'], { byFeeder: { 'F-NINE': { start: 'not-a-time', mw: '5' } } })]),
    ],
  }), WINDOW);
  const actual = Object.fromEntries(result.plans.map((item) => [item.id, item.windows[0].actual]));

  assert.deepEqual(actual.PARTIAL, {
    coverage: 'per-feeder', state: 'partial', startedAt: started, endedAt: null,
    ongoing: true, stale: false, recorded: 1, total: 2, mw: 1.5,
  });
  assert.deepEqual(actual['ALL-OFF'], {
    coverage: 'per-feeder', state: 'all-off', startedAt: started, endedAt: null,
    ongoing: true, stale: false, recorded: 2, total: 2, mw: 3,
  });
  assert.deepEqual(actual.RESTORED, {
    coverage: 'per-feeder', state: 'restored', startedAt: started, endedAt: restoredAt,
    ongoing: false, stale: false, recorded: 1, total: 1, mw: 2,
  });
  assert.deepEqual(actual.STALE, {
    coverage: 'per-feeder', state: 'open-stale', startedAt: staleStart, endedAt: null,
    ongoing: false, stale: true, recorded: 1, total: 1, mw: 3,
  });
  assert.deepEqual(actual.AGGREGATE, {
    coverage: 'aggregate', state: 'aggregate', startedAt: started, endedAt: null,
    ongoing: true, stale: false, recorded: null, total: null, mw: 5,
  });
  assert.equal(actual['INVALID-ACTUAL'], null);
});

test('retains only minimal VECO advisories and cannot serialize private FYI fields', () => {
  const result = summarizeFyiBoot(boot({
    plans: [plan('NO-LEAK', [entry(8, ['F-SECRET'], {
      byFeeder: { 'F-SECRET': { start: '2026-09-03T11:00:00.000Z', mw: 1 } },
      centroid: [10.3, 123.9], polygon: [[1, 2]], radius: 300, notes: 'do not disclose',
    })])],
    outages: [
      {
        id: 'CANCELLED-1', du: 'VECO', type: 'MLD', cancelled: true,
        start: '2026-09-03T06:00:00.000Z', end: '2026-09-03T07:00:00.000Z',
        feeders: ['F-SECRET'], radius: 300, reason: 'private reason', notes: 'private notes', land: 'private land',
      },
      {
        id: 'OTHER-DU', du: 'DLEC', type: 'MLD',
        start: '2026-09-03T06:00:00.000Z', end: '2026-09-03T07:00:00.000Z',
      },
      {
        id: 'OUTSIDE', du: 'VECO', type: 'MLD',
        start: '2026-09-06T06:00:00.000Z', end: '2026-09-06T07:00:00.000Z',
      },
    ],
  }), WINDOW);

  assert.deepEqual(result.advisories, [{
    id: 'CANCELLED-1', type: 'MLD', start: '2026-09-03T06:00:00.000Z', end: '2026-09-03T07:00:00.000Z', status: 'cancelled',
  }]);
  assert.deepEqual(emptyFyi(), {
    available: false,
    checkedAt: null,
    sourceStamp: null,
    freshness: 'unknown',
    sourceUrl: 'https://fyi.aboitizpower.com/',
    plans: [],
    advisories: [],
    warnings: [],
  });

  const serialized = JSON.stringify({ ...emptyFyi('2026-09-03T12:00:00.000Z'), available: true, ...result });
  for (const privateValue of ['F-SECRET', 'radius', 'reason', 'notes', 'centroid', 'polygon', 'private']) {
    assert.equal(serialized.includes(privateValue), false);
  }
});

test('retains only the feeder geometry allowlist branch when parsing FYI BOOT', () => {
  const value = boot({
    feeders: {
      f: { 'F-ONE': { c: [10, 123], p: [0, 0] } },
      staffOnly: { location: 'do not retain' },
    },
  });

  assert.deepEqual(parseFyiResponse(userHtml(value)).feeders, {
    f: { 'F-ONE': { c: [10, 123], p: [0, 0] } },
  });
});

test('summarizes sorted, bounded FYI point clouds for current and next Cebu day only', () => {
  const freshStart = '2026-09-03T11:00:00.000Z';
  const staleStart = '2026-09-02T23:00:00.000Z';
  const result = summarizeFyiMap(boot({
    plans: [
      plan('TODAY', [entry(8, ['Z-F', 'A-F'], { byFeeder: {
        'A-F': { start: freshStart, mw: 987654.321 },
        'Z-F': { start: staleStart, mw: 2 },
      } })]),
      { ...plan('TOMORROW', [entry(9, ['T-F'])]), date: '2026-09-04' },
      { ...plan('OUTSIDE', [entry(10, ['OUTSIDE-F'])]), date: '2026-09-05' },
    ],
    feeders: {
      f: {
        'Z-F': { c: [10.5, 123.5], p: [0, 0, 100_000, -100_000], area: 'private area' },
        'A-F': { c: [10, 123], p: [0, 0], notes: 'private geometry note' },
        'T-F': { c: [11, 124], p: [0, 0] },
        'OUTSIDE-F': { c: [10, 123], p: [0, 0] },
      },
      areas: { secret: 'private area registry' },
    },
  }), { nowMs: NOW });

  assert.deepEqual(result, {
    sourceStamp: '42.23961.115z31j',
    freshness: 'unknown',
    bounds: { south: 10, west: 122.5, north: 11.5, east: 124 },
    clouds: [
      { c: [10, 123], p: [0, 0] },
      { c: [11, 124], p: [0, 0] },
      { c: [10.5, 123.5], p: [0, 0, 100_000, -100_000] },
    ],
    windows: [
      {
        start: '2026-09-03T08:00:00+08:00',
        end: '2026-09-03T09:00:00+08:00',
        feederCount: 2,
        cloudIndexes: [0, 2],
        confirmedCloudIndexes: [0],
        confirmedUntil: '2026-09-03T23:00:00.000Z',
        operatorState: 'per-feeder',
      },
      {
        start: '2026-09-04T09:00:00+08:00',
        end: '2026-09-04T10:00:00+08:00',
        feederCount: 1,
        cloudIndexes: [1],
        confirmedCloudIndexes: [],
        confirmedUntil: null,
        operatorState: 'none',
      },
    ],
    warnings: [],
  });

  const serialized = JSON.stringify(result);
  for (const privateValue of ['A-F', 'Z-F', 'T-F', 'OUTSIDE-F', 'private area', 'private geometry note', freshStart, staleStart, '987654.321']) {
    assert.equal(serialized.includes(privateValue), false);
  }
});

test('skips malformed point clouds while retaining useful plan references', () => {
  const result = summarizeFyiMap(boot({
    plans: [plan('MAP-WARN', [entry(8, ['GOOD', 'BROKEN'])])],
    feeders: { f: {
      GOOD: { c: [10, 123], p: [0, 0] },
      BROKEN: { c: [10, 123], p: [0] },
    } },
  }), { nowMs: NOW });

  assert.deepEqual(result, {
    sourceStamp: '42.23961.115z31j',
    freshness: 'unknown',
    bounds: { south: 10, west: 123, north: 10, east: 123 },
    clouds: [{ c: [10, 123], p: [0, 0] }],
    windows: [{
      start: '2026-09-03T08:00:00+08:00',
      end: '2026-09-03T09:00:00+08:00',
      feederCount: 2,
      cloudIndexes: [0],
      confirmedCloudIndexes: [],
      confirmedUntil: null,
      operatorState: 'none',
    }],
    warnings: ['Skipped 1 malformed FYI map cloud'],
  });
});

test('uses conservative aggregate, stale, and restored FYI map operator states', () => {
  const freshStart = '2026-09-03T11:00:00.000Z';
  const staleStart = '2026-09-02T23:00:00.000Z';
  const restoredAt = '2026-09-03T11:30:00.000Z';
  const result = summarizeFyiMap(boot({
    plans: [
      plan('AGGREGATE', [entry(8, ['AGGREGATE'], { actual: { start: freshStart, mw: 5 } })]),
      plan('STALE', [entry(9, ['STALE'], { byFeeder: { STALE: { start: staleStart, mw: 3 } } })]),
      plan('RESTORED', [entry(10, ['RESTORED'], { byFeeder: {
        RESTORED: { start: freshStart, end: restoredAt, mw: 2 },
      } })]),
    ],
    feeders: { f: mapGeometry(['AGGREGATE', 'STALE', 'RESTORED']) },
  }), { nowMs: NOW });

  assert.deepEqual(result.windows, [
    {
      start: '2026-09-03T08:00:00+08:00',
      end: '2026-09-03T09:00:00+08:00',
      feederCount: 1,
      cloudIndexes: [0],
      confirmedCloudIndexes: [],
      confirmedUntil: null,
      operatorState: 'aggregate',
    },
    {
      start: '2026-09-03T09:00:00+08:00',
      end: '2026-09-03T10:00:00+08:00',
      feederCount: 1,
      cloudIndexes: [2],
      confirmedCloudIndexes: [],
      confirmedUntil: null,
      operatorState: 'stale',
    },
    {
      start: '2026-09-03T10:00:00+08:00',
      end: '2026-09-03T11:00:00+08:00',
      feederCount: 1,
      cloudIndexes: [1],
      confirmedCloudIndexes: [],
      confirmedUntil: null,
      operatorState: 'restored',
    },
  ]);
});

test('merges coincident map windows with conservative state and earliest confirmation expiry', () => {
  const result = summarizeFyiMap(boot({
    plans: [
      plan('PER-FEEDER', [entry(8, ['F-ALPHA', 'F-GOLF'], { byFeeder: {
        'F-ALPHA': { start: '2026-09-03T01:00:00.000Z', mw: 1 },
        'F-GOLF': { start: '2026-09-03T03:00:00.000Z', mw: 1 },
      } })]),
      plan('AGGREGATE', [entry(8, ['F-BRAVO'], { actual: { start: '2026-09-03T11:00:00.000Z', mw: 1 } })]),
      plan('STALE', [entry(8, ['F-CHARLIE'], { byFeeder: {
        'F-CHARLIE': { start: '2026-09-02T23:00:00.000Z', mw: 1 },
      } })]),
      plan('RESTORED', [entry(8, ['F-DELTA'], { byFeeder: {
        'F-DELTA': { start: '2026-09-03T01:00:00.000Z', end: '2026-09-03T11:30:00.000Z', mw: 1 },
      } })]),
      plan('NONE', [entry(8, ['F-ECHO'])]),
    ],
    feeders: { f: mapGeometry(['F-ALPHA', 'F-BRAVO', 'F-CHARLIE', 'F-DELTA', 'F-ECHO', 'F-GOLF']) },
  }), { nowMs: NOW });

  assert.deepEqual(result.windows, [{
    start: '2026-09-03T08:00:00+08:00',
    end: '2026-09-03T09:00:00+08:00',
    feederCount: 6,
    cloudIndexes: [0, 1, 2, 3, 4, 5],
    confirmedCloudIndexes: [0, 5],
    confirmedUntil: '2026-09-03T13:00:00.000Z',
    operatorState: 'per-feeder',
  }]);
  assert.equal(JSON.stringify(result).includes('PER-FEEDER'), false);
  assert.equal(JSON.stringify(result).includes('F-ALPHA'), false);
});

test('omits map windows without renderable feeder geometry', () => {
  const result = summarizeFyiMap(boot({
    plans: [plan('NO-GEOMETRY', [entry(8, ['BROKEN'])])],
    feeders: { f: { BROKEN: { c: [10, 123], p: [0] } } },
  }), { nowMs: NOW });

  assert.deepEqual(result, {
    sourceStamp: '42.23961.115z31j',
    freshness: 'unknown',
    bounds: null,
    clouds: [],
    windows: [],
    warnings: ['Skipped 1 malformed FYI map cloud'],
  });
});

test('calculates exact map bounds from normalized point clouds', () => {
  const result = summarizeFyiMap(boot({
    plans: [plan('BOUNDS', [entry(8, ['BOUNDS-FEEDER'])])],
    feeders: { f: {
      'BOUNDS-FEEDER': { c: [10, 123], p: [-50_000, 20_000, 100_000, -100_000] },
    } },
  }), { nowMs: NOW });

  assert.deepEqual(result.bounds, { south: 9.5, west: 122, north: 11, east: 123.2 });
});

test('fails closed at global FYI map cloud, point, and normalized-output caps', () => {
  const atCloudLimit = feeders(64, 'CLOUD');
  assert.doesNotThrow(() => summarizeFyiMap(boot({
    plans: [plan('CLOUD-LIMIT', [entry(8, atCloudLimit)])],
    feeders: { f: mapGeometry(atCloudLimit) },
  }), { nowMs: NOW }));
  const overCloudLimit = feeders(65, 'CLOUD');
  assert.throws(() => summarizeFyiMap(boot({
    plans: [plan('CLOUD-OVER', [entry(8, overCloudLimit)])],
    feeders: { f: mapGeometry(overCloudLimit) },
  }), { nowMs: NOW }), /map clouds exceeded/);

  const atPointLimit = feeders(6, 'POINT');
  assert.doesNotThrow(() => summarizeFyiMap(boot({
    plans: [plan('POINT-LIMIT', [entry(8, atPointLimit)])],
    feeders: { f: mapGeometry(atPointLimit, 4_000) },
  }), { nowMs: NOW }));
  const overPointLimit = [...atPointLimit, 'POINT-OVER'];
  assert.throws(() => summarizeFyiMap(boot({
    plans: [plan('POINT-OVER', [entry(8, overPointLimit)])],
    feeders: { f: { ...mapGeometry(atPointLimit, 4_000), 'POINT-OVER': cloud() } },
  }), { nowMs: NOW }), /point pairs exceeded/);

  const outputClouds = feeders(5, 'OUTPUT');
  assert.throws(() => summarizeFyiMap(boot({
    plans: [plan('OUTPUT-OVER', [entry(8, outputClouds)])],
    feeders: { f: mapGeometry(outputClouds, 4_096, 200_000, 200_000) },
  }), { nowMs: NOW }), /map output exceeded/);
});
