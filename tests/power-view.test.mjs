import assert from 'node:assert/strict';
import test from 'node:test';

import {
  badgeFor,
  citiesOf,
  dayOffset,
  gap,
  isVisible,
  verdictView,
} from '../src/scripts/power-view.mjs';

const at = (iso) => Date.parse(`2026-09-03T${iso}:00+08:00`);
const now = at('10:00');

const entry = (over = {}) => ({
  kind: 'scheduled',
  start: `2026-09-03T09:00:00+08:00`,
  end: `2026-09-03T15:00:00+08:00`,
  hours: 6,
  flag: null,
  area: 'Talamban, Cebu City',
  streets: 'portions of Highway 77',
  areasRaw: 'Portion of Talamban, Cebu City, along portions of Highway 77',
  purpose: 'Pole replacement',
  source: 'https://example.test/advisory',
  ...over,
});

test('reads every franchise LGU an advisory spans', () => {
  assert.deepEqual(
    citiesOf(entry({ area: 'City of Naga & Minglanilla (Alpaco, Cogon)', areasRaw: 'City of Naga & Minglanilla (Alpaco, Cogon)' })),
    ['Minglanilla', 'Naga'],
  );
  assert.deepEqual(citiesOf(entry({ area: 'Lapu-lapu City', areasRaw: 'Lapu-lapu City' })), ['Lapu-Lapu']);
  assert.deepEqual(citiesOf(entry({ area: 'Barili', areasRaw: 'Barili' })), ['Other']);
});

test('a possible slot never claims power is out', () => {
  const slot = entry({ possible: true });
  assert.equal(badgeFor(slot, now), 'possible now');
  assert.equal(badgeFor(slot, at('08:00')), 'possible in 1h');
  assert.equal(badgeFor(slot, at('16:00')), 'done');
  // The confirmed counterpart is the one allowed to count down.
  assert.equal(badgeFor(entry(), now), '5h left');
  assert.equal(badgeFor(entry(), at('08:00')), 'in 1h');
  assert.equal(badgeFor(entry({ flag: 'cancelled' }), now), 'cancelled');
});

test('gap reads as minutes, hours then days', () => {
  assert.equal(gap(45), '45 min');
  assert.equal(gap(60), '1h');
  assert.equal(gap(125), '2h 5m');
  assert.equal(gap(1440), '1 day');
  assert.equal(gap(4320), '3 days');
});

test('filters compose: city, needle, possible and finished', () => {
  const it = entry();
  assert.equal(isVisible(it, { now }), true);
  assert.equal(isVisible(it, { city: 'Cebu City', now }), true);
  assert.equal(isVisible(it, { city: 'Mandaue', now }), false);
  assert.equal(isVisible(it, { needle: 'highway 77', now }), true);
  assert.equal(isVisible(it, { needle: 'talisay', now }), false);
  assert.equal(isVisible(entry({ possible: true }), { hidePossible: true, now }), false);
  assert.equal(isVisible(it, { hideDone: true, now: at('16:00') }), false);
  // Hiding finished rows must not hide a running one.
  assert.equal(isVisible(it, { hideDone: true, now }), true);
});

test('clamps rail offsets to the day being drawn', () => {
  assert.equal(dayOffset('2026-09-03T09:30:00+08:00', '2026-09-03'), 570);
  assert.equal(dayOffset('2026-09-02T22:00:00+08:00', '2026-09-03'), 0);
  assert.equal(dayOffset('2026-09-04T06:00:00+08:00', '2026-09-03'), 1440);
});

test('a confirmed outage beats a possible window in the same hour', () => {
  const sure = entry();
  const slot = entry({ possible: true, area: 'Guadalupe, Cebu City', end: '2026-09-03T11:00:00+08:00' });
  const scope = [slot, sure];
  const view = verdictView({ entries: scope, scope, label: 'Cebu City', scoped: true, now });
  assert.equal(view.tone, 'out');
  assert.deepEqual(view.head, ['Yes — power is out now in Cebu City']);

  const possibleOnly = verdictView({ entries: [slot], scope: [slot], label: 'Cebu City', scoped: true, now });
  assert.equal(possibleOnly.tone, 'wait');
  assert.match(possibleOnly.head[0], /^Maybe —/);
});

test('the live-region key holds still through a minute tick', () => {
  const soon = entry({ start: '2026-09-03T12:00:00+08:00', end: '2026-09-03T14:00:00+08:00' });
  const args = { entries: [soon], scope: [soon], label: 'Talamban', scoped: true };

  const first = verdictView({ ...args, now });
  const later = verdictView({ ...args, now: now + 60000 });
  assert.equal(first.key, later.key);
  assert.equal(first.tone, 'wait');
  // Only the countdown segment moves, and it is the segment the page keeps out of the
  // announcement.
  assert.deepEqual(first.head, ['Power goes out in ', { count: '2h' }]);
  assert.deepEqual(later.head, ['Power goes out in ', { count: '1h 59m' }]);
  assert.equal(first.detail[0], later.detail[0]);

  // Four hours out is a different answer, not a different clock.
  const far = verdictView({ ...args, now: at('07:00') });
  assert.notEqual(far.key, first.key);
  assert.equal(far.tone, 'clear');
  assert.deepEqual(far.head, ['No outage right now in Talamban']);

  // So is going from "soon" to "out now".
  const out = verdictView({ ...args, now: at('12:30') });
  assert.notEqual(out.key, first.key);
  assert.equal(out.tone, 'out');
});

test('the countdown is a segment, never baked into the announced string', () => {
  const running = entry();
  const view = verdictView({ entries: [running], scope: [running], label: 'Talamban', scoped: true, now });
  const volatile = view.detail.filter((seg) => typeof seg !== 'string');
  assert.deepEqual(volatile, [{ count: 'about 5h from now' }]);
  assert.ok(view.detail.every((seg) => typeof seg === 'string' ? !/from now/.test(seg) : true));
});

test('an unread Facebook feed downgrades an all-clear to a warning', () => {
  const done = entry({ start: '2026-09-02T09:00:00+08:00', end: '2026-09-02T15:00:00+08:00' });
  const args = { entries: [done], scope: [done], label: 'Talamban', scoped: true, now };
  assert.equal(verdictView(args).tone, 'clear');
  assert.equal(verdictView({ ...args, stale: true }).tone, 'wait');
  // A confirmed live outage is true whatever the poller is doing.
  const live = entry();
  assert.equal(
    verdictView({ entries: [live], scope: [live], label: 'Talamban', scoped: true, stale: true, now }).tone,
    'out',
  );
});

test('with no area given the verdict asks for one instead of answering', () => {
  const scope = [entry(), entry({ possible: true, area: 'Guadalupe, Cebu City' })];
  const view = verdictView({ entries: scope, scope, label: '', scoped: false, now });
  assert.equal(view.tone, 'idle');
  assert.deepEqual(view.head, ['Tell me where you are']);
  assert.match(view.detail[0], /^1 interruption is running/);

  const empty = verdictView({ entries: [], scope: [], label: '', scoped: false, now });
  assert.equal(empty.tone, 'wait');
  assert.deepEqual(empty.head, ['No advisories available']);
});
