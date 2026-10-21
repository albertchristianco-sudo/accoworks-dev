import assert from 'node:assert/strict';
import test from 'node:test';

import { expectedFlash } from '../.cursor/skills/verify-accoworks/scripts/race-flash.mjs';

// verify-accoworks home-cover: when the `.flash` roundel must be present, with fake dates.
const races = [
  { name: 'Later Race', date: '2026-12-12' },
  { name: 'Test Race', date: '2026-11-28' },
];

test('no race on or after the build day: roundel absent', () => {
  assert.equal(expectedFlash([], '2026-11-01', '2026-11-01').present, false);
  assert.equal(expectedFlash(races, '2026-12-13', '2026-12-13').present, false);
});

test('before race day: earliest upcoming race is present', () => {
  assert.deepEqual(expectedFlash(races, '2026-10-21', '2026-11-27'), { present: true, race: races[1] });
});

test('on race day: still present (removed only once today is past data-until)', () => {
  assert.deepEqual(expectedFlash(races, '2026-10-21', '2026-11-28'), { present: true, race: races[1] });
});

test('after race day on a stale build: absent, though the build picked the race', () => {
  const after = expectedFlash(races, '2026-10-21', '2026-11-29');
  assert.equal(after.present, false);
  assert.equal(after.race, races[1]);
});
