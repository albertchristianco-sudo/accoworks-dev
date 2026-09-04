import assert from 'node:assert/strict';
import test from 'node:test';

import { lookupPlace } from '../src/scripts/franchise.mjs';
import {
  badgeFor,
  CITIES,
  citiesOf,
  CITY_ORDER,
  cityRows,
  dayOffset,
  gap,
  isVisible,
  matches,
  splitArea,
  verdictView,
  windowDays,
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
  assert.deepEqual(view.head, ['Yes, power is out now in Cebu City']);

  const possibleOnly = verdictView({ entries: [slot], scope: [slot], label: 'Cebu City', scoped: true, now });
  assert.equal(possibleOnly.tone, 'wait');
  assert.match(possibleOnly.head[0], /^Maybe,/);
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

// Two real Visayan Electric area strings: the rotational list that puts the city last,
// and the parenthesised form that puts it first.
const ROTATIONAL = 'Agsungot, Apas, Babag, Binaliw, Bonbon, Buot, Busay, Camputhaw, Guba, Lahug, Malubog, Pulangbato, Pung-ol Sibugay, San Roque, Sirao, Tabunan, Tagba-o, Taptap, Cebu City';
const PARENTHESISED = 'City of Naga & Minglanilla (Alpaco, Balirong, Cantao-an, Cogon, Jaguimit, Lanas, Lutac, Mayana, Pangdan, South Poblacion, Tagjaguimit, Uling & Camp 8)';

test('clamping a barangay list keeps the city a CSS clamp would have eaten', () => {
  const long = splitArea(ROTATIONAL);
  assert.equal(long.shown, 'Agsungot, Apas, Babag, Binaliw, Bonbon');
  assert.equal(long.hidden, 13);
  // The whole point: "Cebu City" survives as the tail, so the expander can name it.
  assert.equal(long.tail, 'Cebu City');
  assert.ok(!long.shown.includes('Cebu City'));
  assert.ok(!long.shown.endsWith(','));

  // A different budget moves the cut, never the city.
  const tight = splitArea(ROTATIONAL, 2);
  assert.equal(tight.shown, 'Agsungot, Apas');
  assert.equal(tight.hidden, 16);
  assert.equal(tight.tail, 'Cebu City');
});

test('a parenthesised area collapses inside the parens', () => {
  const split = splitArea(PARENTHESISED);
  assert.equal(split.shown, 'Alpaco, Balirong, Cantao-an, Cogon, Jaguimit');
  // Eleven comma segments, and the last one is two barangays joined with "&".
  assert.equal(split.hidden, 8);
  assert.equal(split.tail, 'City of Naga & Minglanilla');

  // The city phrase is never counted as a barangay, however few are listed.
  const short = splitArea('City of Naga & Minglanilla (Alpaco, Cogon)');
  assert.equal(short.shown, 'Alpaco, Cogon');
  assert.equal(short.hidden, 0);
  assert.equal(short.tail, 'City of Naga & Minglanilla');
});

test('a short area hides nothing, so the page prints it whole', () => {
  assert.deepEqual(splitArea('Talamban, Cebu City'), { shown: 'Talamban', hidden: 0, tail: 'Cebu City' });
  assert.deepEqual(splitArea('Guadalupe'), { shown: 'Guadalupe', hidden: 0, tail: '' });
  assert.equal(splitArea(ROTATIONAL, 18).hidden, 0);
});

// The tail rule cuts both ways: the trailing segment is the city only when it is one.
test('a trailing barangay stays a barangay, and only an LGU becomes the tail', () => {
  const brgys = 'Agsungot, Apas, Babag, Binaliw, Bonbon, Buot, Busay, Guba, Lahug, Malubog, Sirao, Tabunan, Tagba-o, Taptap';
  const pure = splitArea(brgys);
  assert.equal(pure.tail, '');
  // Taptap is a barangay, so it stays in the list and still counts towards the hidden.
  assert.equal(pure.hidden, 9);
  assert.equal(splitArea(brgys, 14).shown, brgys);
  assert.equal(splitArea(brgys, 14).hidden, 0);

  // A franchise LGU still wins the city slot, with or without its "City" suffix.
  assert.equal(splitArea(ROTATIONAL).tail, 'Cebu City');
  assert.deepEqual(splitArea('Talamban, Cebu City'), { shown: 'Talamban', hidden: 0, tail: 'Cebu City' });
  assert.deepEqual(splitArea('Maguikay, Mandaue City'), { shown: 'Maguikay', hidden: 0, tail: 'Mandaue City' });
  // The parenthesised form never read the trailing segment, so its city phrase is untouched.
  assert.equal(splitArea(PARENTHESISED).tail, 'City of Naga & Minglanilla');

  // The doc comment's own example: "Portions of ..." is no LGU either, so it stays put.
  const portions = splitArea('Talisay City, Portions of Corona del Mar');
  assert.equal(portions.tail, '');
  assert.equal(portions.shown, 'Talisay City, Portions of Corona del Mar');
});

test('every city in the strip order is a franchise LGU, ordered north to south', () => {
  const known = CITIES.map(([name]) => name);
  for (const name of CITY_ORDER) assert.ok(known.includes(name), `${name} is not a CITIES entry`);
  assert.equal(CITY_ORDER.length, known.length);
  assert.ok(Object.isFrozen(CITY_ORDER));
  // Geographic, not alphabetical: Danao is the far north, San Fernando the far south.
  assert.equal(CITY_ORDER[0], 'Danao');
  assert.equal(CITY_ORDER.at(-1), 'San Fernando');
  assert.ok(CITY_ORDER.indexOf('Mandaue') < CITY_ORDER.indexOf('Cebu City'));
});

test('the city strip counts one advisory in both LGUs it spans', () => {
  const both = 'City of Naga & Minglanilla (Alpaco, Cogon)';
  const rows = cityRows([entry({ area: both, areasRaw: both })]);
  const counts = new Map(rows.map((row) => [row.name, row.count]));
  assert.equal(counts.get('Naga'), 1);
  assert.equal(counts.get('Minglanilla'), 1);
  // The seven the page always shows stay, at zero; the outer LGUs stay out.
  assert.deepEqual(rows.map((row) => row.name), [
    'Liloan', 'Consolacion', 'Mandaue', 'Cebu City', 'Talisay', 'Minglanilla', 'Naga',
  ]);
  assert.equal(counts.get('Cebu City'), 0);
  assert.equal(counts.has('Other'), false);
});

test('an outer LGU earns a row by having something, and Other comes last', () => {
  const rows = cityRows([
    entry({ area: 'Danao City', areasRaw: 'Danao City' }),
    entry({ area: 'Barili', areasRaw: 'Barili' }),
    entry({ area: 'Barili', areasRaw: 'Barili' }),
  ]);
  assert.deepEqual(rows.map((row) => row.name), [
    'Danao', 'Liloan', 'Consolacion', 'Mandaue', 'Cebu City', 'Talisay', 'Minglanilla', 'Naga', 'Other',
  ]);
  assert.deepEqual(rows.at(-1), { name: 'Other', count: 2 });
  assert.equal(rows[0].count, 1);
  assert.deepEqual(cityRows([]).map((row) => row.count), [0, 0, 0, 0, 0, 0, 0]);
});

test('the day window is inclusive and survives month and year ends', () => {
  assert.deepEqual(windowDays('2026-09-03', '2026-09-05'), ['2026-09-03', '2026-09-04', '2026-09-05']);
  assert.deepEqual(windowDays('2026-09-03', '2026-09-03'), ['2026-09-03']);
  // The page publishes 14 days, today included.
  assert.equal(windowDays('2026-09-03', '2026-09-16').length, 14);
  assert.deepEqual(windowDays('2026-08-30', '2026-09-02'), ['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02']);
  assert.deepEqual(windowDays('2026-12-30', '2027-01-02'), ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  assert.deepEqual(windowDays('2028-02-28', '2028-03-01'), ['2028-02-28', '2028-02-29', '2028-03-01']);
  // A backwards range is empty, never a loop that never ends.
  assert.deepEqual(windowDays('2026-09-05', '2026-09-03'), []);
});

// Visayan Electric and its readers spell the same barangay differently, and the difference
// is always punctuation: To-ong or Toong, Tolo-tolo or Tolotolo, Sto. Niño or Sto. Nino.
// A search that answers "no rows" because of a hyphen is the worst kind of wrong.
test('a hyphen, a period or an enye never hides a row', () => {
  const of = (name) => entry({ area: `${name}, Cebu City`, streets: `portions of ${name}`, areasRaw: `Portion of ${name}, Cebu City` });

  // Both directions: the feed's spelling against the reader's, and back.
  assert.equal(isVisible(of('Toong Pardo'), { needle: 'to-ong', now }), true);
  assert.equal(isVisible(of('To-ong Pardo'), { needle: 'toong', now }), true);
  assert.equal(matches(of('Tolotolo'), 'tolo-tolo'), true);
  assert.equal(matches(of('Tolo-tolo'), 'tolotolo'), true);
  assert.equal(matches(of('Calajoan'), 'calajo-an'), true);
  assert.equal(matches(of('Kinasang-an'), 'kinasangan'), true);
  assert.equal(matches(of('Sto. Niño'), 'sto nino'), true);
  // An enye typed against the plain spelling the feed actually uses, and the reverse.
  assert.equal(matches(of('Sto. Nino'), 'niño'), true);
  assert.equal(matches(of('Sto. Niño'), 'nino'), true);

  // Folding is not licence to match anything: the old answers still hold.
  assert.equal(matches(entry(), 'highway 77'), true);
  assert.equal(matches(entry(), 'talisay'), false);
  assert.equal(matches(entry(), ''), true);
  assert.equal(isVisible(entry(), { needle: 'talamban', now }), true);
  assert.equal(isVisible(entry(), { needle: 'guadalupe', now }), false);
});

// A place outside the franchise is the one question this page used to answer with a
// confident, green, completely wrong "nothing scheduled".
test('a place Visayan Electric does not serve is told so, not told it is quiet', () => {
  const row = entry();
  const place = lookupPlace('Lapu-Lapu');
  assert.equal(place?.kind, 'outside');
  const view = verdictView({ entries: [row], scope: [], label: 'Lapu-Lapu', scoped: true, now, place });

  assert.equal(view.tone, 'wait');
  assert.deepEqual(view.head, ['Visayan Electric does not serve Lapu-Lapu City']);
  const said = `${view.head.join('')} ${view.detail.join('')}`;
  // The utility that does serve them, by name, twice over: what it is and who to ask.
  assert.equal(said.split('Mactan Electric Company (MECO)').length - 1, 2);
  assert.doesNotMatch(said, /nothing scheduled|no interruption is published/i);
  assert.ok(view.detail.every((seg) => typeof seg === 'string'));

  // Even with the feed unread, the answer is the same: it was never in this feed.
  const blind = verdictView({ entries: [], scope: [], label: 'Lapu-Lapu', scoped: true, stale: true, now, place });
  assert.deepEqual(blind.head, view.head);
  assert.equal(blind.tone, 'wait');

  // Its own tone deserves its own key, or the live region announces the wrong change.
  const unknown = verdictView({ entries: [row], scope: [], label: 'Lapu-Lapu', scoped: true, now, place: null });
  assert.notEqual(view.key, unknown.key);
  assert.ok(!/\d/.test(view.key.replace(/T\d\d:\d\d:\d\d\+\d\d:\d\d|\d{4}-\d\d-\d\d/g, '')));
});

test('a franchise barangay with nothing published reads as covered, not unknown', () => {
  const elsewhere = entry({ area: 'Guadalupe, Cebu City' });
  const args = { entries: [elsewhere], scope: [], label: 'Kalunasan', scoped: true, now };

  const covered = verdictView({ ...args, place: { kind: 'barangay', place: 'Kalunasan', lgus: ['Cebu City'] } });
  assert.equal(covered.tone, 'clear');
  assert.deepEqual(covered.head, ['No, nothing scheduled for Kalunasan']);
  assert.deepEqual(covered.detail, [
    'Kalunasan is inside Visayan Electric’s franchise in Cebu City, and no interruption is published for it in the next 14 days.',
  ]);

  // The same empty scope, a name nobody recognises: a different answer and a different key.
  const unknown = verdictView({ ...args, place: null });
  assert.equal(unknown.tone, 'clear');
  assert.deepEqual(unknown.head, ['No, nothing scheduled for Kalunasan']);
  assert.match(unknown.detail[0], /^No interruption is published for that area in the next 14 days\. /);
  // The limit is stated as a condition, never as a claim that the name is not covered:
  // `lookupPlace` knows barangays and cities, so every street arrives here as `null` too.
  assert.match(unknown.detail[0], /covers only the 8 cities and towns/);
  assert.match(unknown.detail[0], /If you are outside those/);
  assert.doesNotMatch(unknown.detail[0], /not one Visayan Electric lists/);
  assert.notEqual(covered.key, unknown.key);

  // An LGU the strip always shows arrives as `null` as well, because nothing was typed to
  // look up, and it is not an unknown name.
  const chip = verdictView({ ...args, label: 'Liloan', place: null });
  assert.deepEqual(chip.detail, ['No interruption is published for that area in the next 14 days.']);

  // A scope holding only a finished row published something, so it keeps the old copy.
  const done = entry({ start: '2026-09-02T09:00:00+08:00', end: '2026-09-02T15:00:00+08:00' });
  const quiet = verdictView({ ...args, scope: [done], place: { kind: 'barangay', place: 'Talamban', lgus: ['Cebu City'] } });
  assert.deepEqual(quiet.detail, ['No interruption is published for that area in the next 14 days.']);
});

// Twelve barangay names occur in two franchise LGUs, and Casili is the sharpest: a Mandaue
// reader searching it gets nine Consolacion rows and none of their own.
test('a barangay name two LGUs share adds exactly one sentence, and only over rows', () => {
  const row = entry({ area: 'Casili, Consolacion', areasRaw: 'Casili, Consolacion' });
  const args = { entries: [row], scope: [row], label: 'Casili', scoped: true, now };
  const place = { kind: 'barangay', place: 'Casili', lgus: ['Mandaue', 'Consolacion'] };

  const base = verdictView(args);
  const shared = verdictView({ ...args, place });
  assert.equal(shared.tone, base.tone);
  assert.deepEqual(shared.head, base.head);
  assert.deepEqual(shared.detail.slice(0, base.detail.length), base.detail);
  assert.equal(shared.detail.length, base.detail.length + 1);
  const added = shared.detail.at(-1);
  assert.equal(added, ' Casili names a barangay in Mandaue and Consolacion, so check the city on each row.');
  // Exactly one sentence, so the answer gains a caveat and not a paragraph.
  assert.equal(added.match(/\./g).length, 1);
  assert.notEqual(shared.key, base.key);

  // Three-way names read as a list, not as a run of "and".
  const three = verdictView({
    ...args,
    label: 'San Roque',
    place: { kind: 'barangay', place: 'San Roque', lgus: ['Cebu City', 'Talisay', 'Liloan'] },
  });
  assert.match(three.detail.at(-1), / in Cebu City, Talisay and Liloan, /);

  // With no rows below, there is no city to check on anything.
  const empty = verdictView({ ...args, scope: [], place });
  assert.ok(empty.detail.every((seg) => !/check the city/.test(String(seg))));
});

// The whole `place` argument is additive: a caller that never passes it must get the same
// four values it got before the argument existed, key included.
test('omitting place answers exactly what the page answered before', () => {
  const done = entry({ start: '2026-09-02T09:00:00+08:00', end: '2026-09-02T15:00:00+08:00' });
  const args = { entries: [done], label: 'Talamban', scoped: true, now };

  for (const scope of [[done], []]) {
    const view = verdictView({ ...args, scope });
    assert.equal(view.tone, 'clear');
    assert.deepEqual(view.head, ['No, nothing scheduled for Talamban']);
    assert.deepEqual(view.detail, ['No interruption is published for that area in the next 14 days.']);
    assert.equal(view.key, 'clear|Talamban||');
  }

  const live = entry();
  const out = verdictView({ entries: [live], scope: [live], label: 'Talamban', scoped: true, now });
  assert.equal(out.tone, 'out');
  assert.deepEqual(out.head, ['Yes, power is out now in Talamban']);
  assert.equal(out.key, 'out|Talamban|2026-09-03T09:00:00+08:00|');
  assert.equal(out.detail.length, 3);

  const asking = verdictView({ entries: [live], scope: [live], label: '', scoped: false, now });
  assert.deepEqual(asking.head, ['Tell me where you are']);
  assert.equal(asking.key, 'idle||2026-09-03T09:00:00+08:00|');
});
