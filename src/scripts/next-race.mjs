// Pure race helpers, shared by the build (src/lib/races.ts) and the tests.

/** Today as a YYYY-MM-DD calendar day in Cebu. */
export function cebuToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * The earliest race on or after `today` (YYYY-MM-DD), or undefined when none.
 * A race stays "next" through its own date.
 */
export function nextRace(races, today = cebuToday()) {
  return [...races].filter((race) => race.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
}

/** Short roundel date, e.g. "Nov 28". */
export function raceDay(race) {
  return new Date(`${race.date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
