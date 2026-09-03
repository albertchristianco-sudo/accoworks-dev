import assert from 'node:assert/strict';
import test from 'node:test';

import { readFileSync } from 'node:fs';

import { foldBold, parseAdvisoryText, parseDateRange } from '../src/scripts/veco-post.mjs';
import { fromManual } from '../src/scripts/outages.mjs';

const WEEKLY = readFileSync(new URL('./fixtures/veco-rotational-weekly.txt', import.meta.url), 'utf8');

// Verbatim shape of a Visayan Electric rotational advisory post, math-bold and all.
const POST = `This is an hourly update to our previously posted Possible Rotational Brownout Advisory for September 3- 6, 2026.
🔗 View the complete advisory and schedule here: https://www.facebook.com/photo/?fbid=1535534125268871
🔴 𝐎𝐍𝐆𝐎𝐈𝐍𝐆 𝐑𝐎𝐓𝐀𝐓𝐈𝐎𝐍𝐀𝐋 𝐁𝐑𝐎𝐖𝐍𝐎𝐔𝐓
⏰𝟏𝟏:𝟎𝟎𝐀𝐌-𝟏𝟐:𝟎𝟎𝐏𝐌 | 𝐒𝐄𝐏𝐓𝐄𝐌𝐁𝐄𝐑 𝟑, 𝟐𝟎𝟐𝟔
Portion of Cebu City: Calamba, Capitol Site, Guadalupe, Labangon, Sambag 1, & Sambag 2
𝐕𝐢𝐞𝐰 𝐭𝐡𝐞 𝐦𝐚𝐩 𝐡𝐞𝐫𝐞: https://tinyurl.com/4t5zrpan
Portion of Cebu City: Carreta, Cebu Business Park, Hipodromo, Mabolo, San Antonio, & San Roque
𝐕𝐢𝐞𝐰 𝐭𝐡𝐞 𝐦𝐚𝐩 𝐡𝐞𝐫𝐞: https://tinyurl.com/457wkkt6
𝐀𝐟𝐟𝐞𝐜𝐭𝐞𝐝 𝐚𝐫𝐞𝐚𝐬 𝐚𝐧𝐝 𝐭𝐢𝐦𝐢𝐧𝐠 𝐦𝐚𝐲 𝐜𝐡𝐚𝐧𝐠𝐞.`;

test('folds Unicode math-bold headings back to ASCII', () => {
  assert.equal(foldBold('𝐎𝐍𝐆𝐎𝐈𝐍𝐆 𝟏𝟏:𝟎𝟎𝐀𝐌'), 'ONGOING 11:00AM');
  assert.equal(foldBold('plain text 12'), 'plain text 12');
});

test('reads every time slot and area pair out of a pasted advisory', () => {
  const { items, warnings } = parseAdvisoryText(POST, { source: 'https://facebook.com/post/1' });
  assert.deepEqual(warnings, []);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    date: '2026-09-03',
    start: '11:00AM',
    end: '12:00PM',
    area: 'Calamba, Capitol Site, Guadalupe, Labangon, Sambag 1, Sambag 2, Cebu City',
    possible: false,
    note: 'Rotational brownout (ongoing) — NGCP supply shortfall.',
    source: 'https://facebook.com/post/1',
    map: 'https://tinyurl.com/4t5zrpan',
  });
  assert.equal(items[1].map, 'https://tinyurl.com/457wkkt6');
});

test('the parsed slots normalize into feed entries', () => {
  const { items } = parseAdvisoryText(POST);
  const entry = fromManual(items[0]);
  assert.equal(entry.kind, 'rotational');
  assert.equal(entry.start, '2026-09-03T11:00:00+08:00');
  assert.equal(entry.end, '2026-09-03T12:00:00+08:00');
  assert.equal(entry.hours, 1);
  assert.equal(entry.map, 'https://tinyurl.com/4t5zrpan');
});

test('expands the header date range over dateless slots in a weekly advisory', () => {
  const { items, warnings } = parseAdvisoryText(WEEKLY, { source: 'https://facebook.com/post/2' });
  assert.deepEqual(warnings, []);

  const dates = [...new Set(items.map((item) => item.date))];
  assert.deepEqual(dates, ['2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06']);

  const slots = [...new Set(items.map((item) => `${item.start}-${item.end}`))];
  assert.deepEqual(slots, ['10:00AM-12:30PM', '11:00AM-01:30PM', '8:30PM-11:00PM']);

  // 8 city lines across 3 slots, repeated over 4 days.
  assert.equal(items.length, 32);
  assert.equal(items.filter((item) => !item.map).length, 0);
});

test('marks a POSSIBLE schedule as unconfirmed', () => {
  const { items } = parseAdvisoryText(WEEKLY);
  assert.ok(items.every((item) => item.possible === true));
  assert.match(items[0].note, /only if NGCP calls for load reduction/);
  assert.equal(fromManual(items[0]).possible, true);
  assert.equal(fromManual(items[0]).hours, 2.5);
});

test('one map link covers every city line listed under it', () => {
  const { items } = parseAdvisoryText(WEEKLY);
  const slot = items.filter((item) => item.date === '2026-09-03' && item.start === '10:00AM');
  const shared = slot.filter((item) => item.map === 'https://tinyurl.com/2jkrafp6');
  assert.equal(shared.length, 2);
  assert.ok(shared.some((item) => item.area.endsWith('Cebu City')));
  assert.ok(shared.some((item) => item.area.endsWith('Mandaue City')));
});

test('reads advisory date ranges, including across a month boundary', () => {
  assert.deepEqual(parseDateRange('SEPTEMBER 3, 2026'), ['2026-09-03']);
  assert.deepEqual(parseDateRange('DAILY | SEPTEMBER 3-6, 2026'), [
    '2026-09-03',
    '2026-09-04',
    '2026-09-05',
    '2026-09-06',
  ]);
  assert.deepEqual(parseDateRange('AUGUST 30 - SEPTEMBER 1, 2026'), [
    '2026-08-30',
    '2026-08-31',
    '2026-09-01',
  ]);
  assert.deepEqual(parseDateRange('no dates here'), []);
});

test('handles an overnight slot and a two-city line', () => {
  const { items } = parseAdvisoryText(
    `UPCOMING ROTATIONAL BROWNOUT
10:00 PM - 4:00 AM | SEPT 5, 2026
Portions of Mandaue City & Consolacion: Tipolo, Centro & Tayud`,
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].area, 'Tipolo, Centro, Tayud, Mandaue City & Consolacion');
  const entry = fromManual(items[0]);
  assert.equal(entry.start, '2026-09-05T22:00:00+08:00');
  assert.equal(entry.end, '2026-09-06T04:00:00+08:00');
  assert.equal(entry.hours, 6);
  assert.match(entry.purpose, /upcoming/);
});

test('warns instead of inventing data when the text has no schedule', () => {
  const { items, warnings } = parseAdvisoryText('Further updates will be provided.');
  assert.equal(items.length, 0);
  assert.equal(warnings.length, 1);
});

test('ignores an area listed before any time slot', () => {
  const { items, warnings } = parseAdvisoryText('Portion of Cebu City: Mabolo');
  assert.equal(items.length, 0);
  assert.match(warnings[0], /before any time slot/);
});
