import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FYI_MAX_INPUT_BYTES,
  emptyFyi,
  parseFyiResponse,
  summarizeFyiBoot,
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
