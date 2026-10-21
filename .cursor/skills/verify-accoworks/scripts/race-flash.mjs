// Pure decision behind the home-cover `next-race` step, kept out of control-app.mjs
// so tests can import it with fake dates (tests/verify-race-flash.test.mjs).

import { nextRace } from '../../../../src/scripts/next-race.mjs';

// What a visitor should see for the `.flash` roundel. The build picks the earliest race
// on or after buildDay (YYYY-MM-DD, Asia/Manila); the inline script then removes it
// once today (Manila) is past that race's date. Returns { present: false, reason } or
// { present: true, race }.
export function expectedFlash(races, buildDay, today) {
  const race = nextRace(races, buildDay);
  if (!race) return { present: false, reason: `no race on or after build day ${buildDay}` };
  if (today > race.date) return { present: false, race, reason: `today ${today} is after ${race.name} (${race.date})` };
  return { present: true, race };
}
