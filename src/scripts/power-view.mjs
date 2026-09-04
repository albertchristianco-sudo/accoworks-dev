// Decision logic behind /power: which entries are visible, what a row's badge says, and
// what the verdict box answers. No DOM — the page owns the plumbing, this owns the
// answers, and tests/power-view.test.mjs owns the proof.

import { addDays, entryStatus, manilaDate } from './outages.mjs';

// Areas read like "Talisay City, Portions of Corona del Mar" or "City of Naga &
// Minglanilla (Alpaco, Cogon)", so the trailing comma segment is not the city. Match the
// franchise's actual LGUs instead; one advisory can span two.
/** @type {[string, RegExp][]} */
export const CITIES = [
  ['Cebu City', /\bcebu city\b/],
  ['Mandaue', /\bmandaue\b/],
  ['Lapu-Lapu', /\blapu[- ]?lapu\b/],
  ['Talisay', /\btalisay\b/],
  ['Minglanilla', /\bminglanilla\b/],
  ['Naga', /\bnaga\b/],
  ['San Fernando', /\bsan fernando\b/],
  ['Consolacion', /\bconsolacion\b/],
  ['Liloan', /\bliloan\b/],
  ['Compostela', /\bcompostela\b/],
  ['Cordova', /\bcordova\b/],
  ['Danao', /\bdanao\b/],
];

// The city strip reads north to south down the franchise, the way the coast road runs, so
// a Consolacion reader stops scanning once they pass their own name. Every entry here is
// a CITIES name; tests/power-view.test.mjs holds that invariant.
export const CITY_ORDER = Object.freeze([
  'Danao',
  'Compostela',
  'Liloan',
  'Consolacion',
  'Mandaue',
  'Lapu-Lapu',
  'Cordova',
  'Cebu City',
  'Talisay',
  'Minglanilla',
  'Naga',
  'San Fernando',
]);

// The strip always offers these seven, even on a day none of them has an advisory: a
// missing row reads as "not loaded", a zero row reads as "nothing listed". The outer LGUs
// appear only when they have something, so the strip stays short.
const CORE_CITIES = new Set(['Consolacion', 'Liloan', 'Mandaue', 'Cebu City', 'Talisay', 'Minglanilla', 'Naga']);

// The page's time vocabulary, pinned to Cebu wherever the code runs.
export const clock = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' });
export const dayFull = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', weekday: 'long', month: 'short', day: 'numeric' });
export const dayShort = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', weekday: 'long' });

export const dayKey = (iso) => iso.slice(0, 10);

/** Every day key from `from` to `to` inclusive, so the rail can draw empty days too. */
export function windowDays(from, to) {
  const keys = [];
  for (let key = from; key <= to; key = addDays(key, 1)) keys.push(key);
  return keys;
}

export function gap(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest ? `${hours}h ${rest}m` : `${hours}h`;
  const days = Math.round(hours / 24);
  return days === 1 ? '1 day' : `${days} days`;
}

export function citiesOf(entry) {
  const hay = `${entry.area} ${entry.areasRaw}`.toLowerCase();
  const hits = CITIES.filter(([, re]) => re.test(hay)).map(([name]) => name);
  return hits.length ? hits : ['Other'];
}

/** One row per city in the strip: geographic order, then `Other` last if it has any. */
export function cityRows(entries) {
  const counts = new Map();
  for (const entry of entries) {
    // An advisory spanning two LGUs is one interruption in each; both readers are right.
    for (const city of citiesOf(entry)) counts.set(city, (counts.get(city) ?? 0) + 1);
  }
  const rows = CITY_ORDER
    .filter((name) => CORE_CITIES.has(name) || counts.get(name))
    .map((name) => ({ name, count: counts.get(name) ?? 0 }));
  const other = counts.get('Other') ?? 0;
  if (other) rows.push({ name: 'Other', count: other });
  return rows;
}

const commaNames = (text) => text.split(',').map((part) => part.trim()).filter(Boolean);

/**
 * Clamp a long barangay list without losing the city.
 *
 * Visayan Electric writes the city LAST ("Agsungot, Apas, ..., Taptap, Cebu City") or in
 * front of a parenthesised list ("City of Naga & Minglanilla (Alpaco, ...)"), so a CSS
 * line clamp cuts off the one word that tells a reader whether the row is theirs. Split
 * the string instead: `shown` is the first `keep` barangays, `hidden` is how many were
 * dropped, `tail` is the city the expander can name. In the comma form the trailing
 * segment becomes `tail` only when it matches a franchise LGU in `CITIES`: a pure
 * barangay list keeps that segment among the names and leaves `tail` as `''`, so the
 * expander never names a barangay as if it were a city. `hidden === 0` means nothing was
 * dropped and the caller should print the area verbatim, with no expander.
 */
export function splitArea(area, keep = 5) {
  const text = `${area ?? ''}`.trim();
  const paren = text.match(/^(.*?)\s*\(([^)]*)\)$/);
  let names;
  let tail;
  if (paren) {
    // The list sits inside the parens and the city leads, so collapse the inside only.
    tail = paren[1].trim();
    names = commaNames(paren[2]);
    // Its final comma segment joins the last two barangays with "&": "Uling & Camp 8".
    const last = names.pop();
    if (last) names.push(...last.split(/\s*&\s*/).filter(Boolean));
  } else {
    names = commaNames(text);
    // Only a real franchise LGU earns the city slot; a barangay stays in the name list.
    const last = names.length > 1 ? names[names.length - 1] : '';
    tail = CITIES.some(([, re]) => re.test(last.toLowerCase())) ? (names.pop() ?? '') : '';
  }
  // slice() rather than a join-and-cut, so `shown` can never end on a dangling comma.
  return { shown: names.slice(0, keep).join(', '), hidden: Math.max(0, names.length - keep), tail };
}

export function matches(entry, needle) {
  return !needle || `${entry.area} ${entry.streets} ${entry.areasRaw}`.toLowerCase().includes(needle);
}

/** One row's visibility under the current filters. */
export function isVisible(entry, { city = '', needle = '', hidePossible = false, hideDone = false, now = Date.now() } = {}) {
  if (city && !citiesOf(entry).includes(city)) return false;
  if (!matches(entry, needle)) return false;
  if (hidePossible && entry.possible) return false;
  if (hideDone && entryStatus(entry, now).state === 'done') return false;
  return true;
}

/** A possible slot never claims to be happening; it reports its window instead. */
export function badgeFor(entry, now) {
  const status = entryStatus(entry, now);
  const state = status.state;
  if (entry.possible) {
    return state === 'live' ? 'possible now' : state === 'upcoming' ? `possible in ${gap(status.minutes ?? 0)}` : state;
  }
  return state === 'live'
    ? `${gap(status.minutes ?? 0)} left`
    : state === 'upcoming'
      ? `in ${gap(status.minutes ?? 0)}`
      : state;
}

/** Minutes from midnight of `key`, clamped to that day, for the hour rail. */
export function dayOffset(iso, key) {
  const base = Date.parse(`${key}T00:00:00+08:00`);
  return Math.max(0, Math.min(1440, Math.round((Date.parse(iso) - base) / 60000)));
}

/**
 * The whole verdict: tone, the two lines, and a stable identity for the aria-live region.
 *
 * Lines come back as segments — plain strings, plus `{ count }` for the relative
 * countdown. The countdown is the only part that moves every minute, so the page paints
 * it into a node that does not announce; everything else is rewritten (and announced)
 * only when `key` changes.
 */
export function verdictView({ entries, scope, label, scoped, stale = false, now = Date.now() }) {
  // Confirmed interruptions answer the question; "possible" rotational slots only ever
  // warn, because VECO implements them solely when NGCP calls for load reduction.
  const live = scope
    .filter((e) => entryStatus(e, now).state === 'live')
    .sort((a, b) => Date.parse(a.end) - Date.parse(b.end));
  const liveSure = live.filter((e) => !e.possible);
  const livePossible = live.filter((e) => e.possible);
  const next = scope
    .filter((e) => entryStatus(e, now).state === 'upcoming')
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0];

  let tone = 'idle';
  let head = [];
  let detail = [];

  if (!entries.length) {
    tone = 'wait';
    head = ['No advisories available'];
    detail = ['Visayan Electric’s schedule could not be read just now. Try again in a few minutes.'];
  } else if (!scoped) {
    tone = 'idle';
    head = ['Tell me where you are'];
    const liveAll = entries.filter((e) => entryStatus(e, now).state === 'live' && !e.possible).length;
    detail = [
      liveAll
        ? `${liveAll} ${liveAll === 1 ? 'interruption is' : 'interruptions are'} running across the franchise right now. Type your barangay for a straight answer.`
        : `${entries.length} interruptions and possible brownout slots are published for the next 14 days. Type your barangay for a straight answer.`,
    ];
  } else if (liveSure.length) {
    tone = 'out';
    const soonest = liveSure[0];
    const left = entryStatus(soonest, now).minutes ?? 0;
    head = [`Yes — power is out now in ${label}`];
    detail = [
      `${soonest.area}: back around ${clock.format(new Date(soonest.end))}, `,
      { count: `about ${gap(left)} from now` },
      `.${liveSure.length > 1 ? ` ${liveSure.length - 1} more area${liveSure.length > 2 ? 's' : ''} also out.` : ''}`,
    ];
  } else if (livePossible.length) {
    tone = 'wait';
    const slot = livePossible[0];
    head = [`Maybe — ${label} is in a rotational brownout window now`];
    detail = [
      `Window ${clock.format(new Date(slot.start))} to ${clock.format(new Date(slot.end))}. Visayan Electric only cuts power if NGCP calls for load reduction, so it may not happen.`,
    ];
  } else if (next) {
    const away = entryStatus(next, now).minutes ?? 0;
    tone = away <= 180 ? 'wait' : 'clear';
    const when = dayKey(next.start) === manilaDate(now)
      ? `today ${clock.format(new Date(next.start))}`
      : `${dayFull.format(new Date(next.start))}, ${clock.format(new Date(next.start))}`;
    head = next.possible || away > 180
      ? [`No outage right now in ${label}`]
      : ['Power goes out in ', { count: gap(away) }];
    detail = [
      next.possible
        ? `Next rotational window: ${when} to ${clock.format(new Date(next.end))} (${next.hours}h) — possible, not confirmed.`
        : `Next: ${next.area} — ${when} to ${clock.format(new Date(next.end))} (${next.hours}h).`,
    ];
  } else {
    tone = 'clear';
    head = [`No — nothing scheduled for ${label}`];
    detail = ['No interruption is published for that area in the next 14 days.'];
  }

  // A green "nothing scheduled" is not honest while the Facebook feed is unread: the
  // rotational advisories live only there. A confirmed live outage stays 'out' — that is
  // true whatever the poller is doing.
  if (stale && tone === 'clear') tone = 'wait';

  // What the answer *is*, with no clock in it: the same answer one minute later produces
  // the same key, so the live region stays quiet while the countdown keeps moving.
  const key = `${tone}|${label}|${live.map((e) => e.start).join(',')}|${next?.start ?? ''}`;

  return { tone, key, head, detail };
}
