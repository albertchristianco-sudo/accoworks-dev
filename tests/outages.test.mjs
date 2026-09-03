import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import {
  parseDayHeading,
  parseClock,
  parseTimeRange,
  parseAreas,
  parsePost,
  slugRange,
  entryStatus,
  fromManual,
  manilaDate,
  addDays,
} from '../src/scripts/outages.mjs';

const fixture = readFileSync(new URL('./fixtures/veco-advisory.html', import.meta.url), 'utf8');
const day = { year: 2026, month: 9, day: 3 };

test('reads a day heading, single day or spanning two', () => {
  assert.deepEqual(parseDayHeading('September 3, 2026 (Thursday)'), { year: 2026, month: 9, day: 3 });
  assert.deepEqual(parseDayHeading('September 3-4, 2026 (Thursday-Friday)'), { year: 2026, month: 9, day: 3 });
  assert.equal(parseDayHeading('Areas Affected:'), null);
});

test('reads Filipino clock markers', () => {
  assert.deepEqual(parseClock('8:45 AM'), { hour: 8, minute: 45, marker: 'am' });
  assert.deepEqual(parseClock('1:00 PM'), { hour: 13, minute: 0, marker: 'pm' });
  assert.deepEqual(parseClock('12:00 MN'), { hour: 0, minute: 0, marker: 'mn' });
  assert.deepEqual(parseClock('12:00 NN'), { hour: 12, minute: 0, marker: 'nn' });
});

test('turns an advisory time cell into a Cebu-time range', () => {
  assert.deepEqual(parseTimeRange('8:00 AM to 3:00 PM (7hrs)', day), {
    start: '2026-09-03T08:00:00+08:00',
    end: '2026-09-03T15:00:00+08:00',
    hours: 7,
    flag: null,
  });
});

test('keeps fractional durations and flags', () => {
  assert.deepEqual(parseTimeRange('8:45 AM to 4:00 PM (7.25hrs)- CANCELLED', day), {
    start: '2026-09-03T08:45:00+08:00',
    end: '2026-09-03T16:00:00+08:00',
    hours: 7.25,
    flag: 'cancelled',
  });
  assert.equal(parseTimeRange('9:00 AM to 5:00 PM (8hrs)- ADDITIONAL', day).flag, 'additional');
});

test('spans midnight using the dates written in the cell', () => {
  assert.deepEqual(
    parseTimeRange('10:00 PM of September 3 to 6:00 AM of September 4 (8hrs)', day),
    {
      start: '2026-09-03T22:00:00+08:00',
      end: '2026-09-04T06:00:00+08:00',
      hours: 8,
      flag: null,
    },
  );
});

test('rolls an end time that lands before its start into the next day', () => {
  const range = parseTimeRange('10:00 PM to 6:00 AM (8hrs)', day);
  assert.equal(range.end, '2026-09-04T06:00:00+08:00');
  assert.equal(range.hours, 8);
});

test('rejects a time cell it cannot read instead of guessing', () => {
  assert.equal(parseTimeRange('Whole day', day), null);
  assert.equal(parseTimeRange('8:00 AM to 3:00 PM', null), null);
});

test('splits affected areas from the street list', () => {
  assert.deepEqual(
    parseAreas('Portion of Talamban, Cebu City, along portions of Highway 77.'),
    { area: 'Talamban, Cebu City', streets: 'portions of Highway 77', raw: 'Portion of Talamban, Cebu City, along portions of Highway 77.' },
  );
  assert.equal(parseAreas('Portion of Apas & Banilad, Cebu City').area, 'Apas & Banilad, Cebu City');
});

test('parses real advisory HTML into dated entries', () => {
  const entries = parsePost(fixture, { url: 'https://example.test/post', title: 'Fixture' });
  assert.equal(entries.length, 3);
  assert.deepEqual(entries.map((e) => e.start), [
    '2026-08-09T08:00:00+08:00',
    '2026-08-09T08:00:00+08:00',
    '2026-08-10T09:00:00+08:00',
  ]);
  assert.deepEqual(entries.map((e) => e.hours), [7, 9, 3]);
  assert.equal(entries[2].area, 'Tipolo, Mandaue City');
  assert.match(entries[2].purpose, /^To improve the reliability/);
  assert.equal(entries[0].kind, 'scheduled');
  assert.equal(entries[0].source, 'https://example.test/post');
});

test('derives the covered week from an advisory slug', () => {
  assert.deepEqual(slugRange('service-interruption-august-30-september-5-2026'), {
    start: '2026-08-30',
    end: '2026-09-05',
  });
  assert.deepEqual(slugRange('service-interruption-oct-5-11-2025'), { start: '2025-10-05', end: '2025-10-11' });
  assert.deepEqual(slugRange('service-interruption-december-28-2025'), { start: '2025-12-28', end: '2025-12-28' });
  assert.deepEqual(slugRange('service-interruption-december-29-january-4-2026'), {
    start: '2025-12-29',
    end: '2026-01-04',
  });
  assert.equal(slugRange('veco-pest-control-services-requirement'), null);
});

test('classifies an outage against the clock', () => {
  const entry = { start: '2026-09-03T09:00:00+08:00', end: '2026-09-03T17:00:00+08:00', flag: null };
  assert.deepEqual(entryStatus(entry, Date.parse('2026-09-03T08:00:00+08:00')), { state: 'upcoming', minutes: 60 });
  assert.deepEqual(entryStatus(entry, Date.parse('2026-09-03T16:30:00+08:00')), { state: 'live', minutes: 30 });
  assert.equal(entryStatus(entry, Date.parse('2026-09-03T17:00:00+08:00')).state, 'done');
  assert.equal(entryStatus({ ...entry, flag: 'cancelled' }, Date.parse('2026-09-03T10:00:00+08:00')).state, 'cancelled');
});

test('normalizes a hand-logged rotational brownout', () => {
  const entry = fromManual({
    date: '2026-09-03',
    start: '9:00 AM',
    end: '10:00 AM',
    area: 'Portion of Talamban, Cebu City',
    note: 'Group 3',
  });
  assert.equal(entry.kind, 'rotational');
  assert.equal(entry.start, '2026-09-03T09:00:00+08:00');
  assert.equal(entry.hours, 1);
  assert.equal(entry.area, 'Talamban, Cebu City');
  assert.equal(entry.via, 'paste');
  assert.equal(entry.postedAt, null);
  assert.equal(fromManual({ start: '9:00 AM', end: '10:00 AM' }), null);
});

test('carries poller provenance through to the entry', () => {
  const entry = fromManual({
    date: '2026-09-03',
    start: '1:00 PM',
    end: '3:30 PM',
    area: 'Portion of Bakilid, Mandaue City',
    via: 'auto',
    postedAt: '2026-09-03T13:29:30+08:00',
  });
  assert.equal(entry.via, 'auto');
  assert.equal(entry.postedAt, '2026-09-03T13:29:30+08:00');
});

test('anchors dates to Cebu time, not the runtime timezone', () => {
  // 2026-09-03 15:30 UTC is already the 3rd in Manila; 2026-09-03 17:00 UTC is the 4th.
  assert.equal(manilaDate(Date.parse('2026-09-03T15:30:00Z')), '2026-09-03');
  assert.equal(manilaDate(Date.parse('2026-09-03T17:00:00Z')), '2026-09-04');
  assert.equal(addDays('2026-08-31', 1), '2026-09-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
});
