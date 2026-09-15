// Decision logic behind /power: which entries are visible, what a row's badge says, and
// what the verdict box answers. No DOM — the page owns the plumbing, this owns the
// answers, and tests/power-view.test.mjs owns the proof.

import { fold } from './franchise.mjs';
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

// One folded haystack per entry, built the first time that entry is searched and keyed by
// the entry object itself. A refresh replaces the array wholesale with freshly parsed
// objects (`entries = data.entries`), so a re-fetched advisory arrives as a new key with
// no cache slot: this map can never hand back text the feed has since changed, and the
// superseded objects take their strings with them when they are collected.
const hays = new WeakMap();

// `fold` turns a hyphen into a space, which is right for reading and wrong for matching:
// "to-ong" would still miss "Toong". Dropping the spaces on both sides is what makes
// to-ong/Toong, tolo-tolo/Tolotolo and calajo-an/Calajoan the same needle. It can also
// join two words into one hit ("Pepito Sr." contains "pitos"), which is over-inclusive
// rather than wrong, and cheaper than tokenising 400 rows a keystroke.
// Exported because the page's area clamp must decide "is the hit visible" on exactly the
// string this matched on; two normalisers would show a row with its reason clipped off.
export const squeeze = (text) => fold(text).replace(/ /g, '');
/**
 * Screen-reader announcements use durable published timing rather than a countdown changing
 * every minute. Omit each dynamic count segment and repair the punctuation it leaves behind.
 */
export function conciseAnnouncement(head, detail = []) {
  const stableText = (segments, trimCountdownLead = false) => {
    const text = segments
      .filter((segment) => typeof segment === 'string')
      .join(' ')
      .replace(/\s+/g, ' ')
      .replace(/\s+([,.;!?])/g, '$1')
      .replace(/,\s*([.!?])/g, '$1')
      .trim();
    return trimCountdownLead ? text.replace(/\s+in$/i, '') : text;
  };
  const headText = stableText(head, head.some((segment) => typeof segment !== 'string'));
  const detailText = stableText(detail);
  const headSentence = headText && !/[.!?]$/.test(headText) ? `${headText}.` : headText;
  const sentence = [headSentence, detailText].filter(Boolean).join(' ').trim();
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}


/**
 * The compact record preview keeps the official LGU context in view. A city at the tail
 * remains beside a comma list; a leading parenthesised LGU stays first. A query match
 * outside the first `keep` areas joins that same visible context instead of being hidden.
 */
export function previewArea(area, needle = '', keep = 5) {
  const text = `${area ?? ''}`.trim();
  const split = splitArea(text, keep);
  if (split.hidden === 0) return { text, hidden: 0, collapsed: false };

  const want = squeeze(needle);
  const matched = want &&
    squeeze(text).includes(want) &&
    !squeeze(`${split.shown} ${split.tail}`).includes(want)
    ? (text.match(/\(([^)]*)\)\s*$/)?.[1] ?? text)
      .split(',')
      .map((part) => part.trim().replace(/^\(/, '').replace(/\)$/, ''))
      .find((part) => squeeze(part).includes(want)) || ''
    : '';
  const leadingLgu = /^\s*[^()]+\(/.test(text);
  const parts = leadingLgu
    ? [split.tail, split.shown, matched]
    : [split.shown, matched, split.tail];
  return { text: parts.filter(Boolean).join(', '), hidden: split.hidden, collapsed: true };
}

// One keystroke calls matches() once per entry, ~400 times with the identical needle, so
// the needle is folded once and remembered until it changes.
let lastNeedle;
let lastSqueezed = '';

export function matches(entry, needle) {
  // Pure punctuation folds away to nothing, and ''.includes() is true for every row.
  if (!needle || !squeeze(needle)) return true;
  if (needle !== lastNeedle) {
    lastNeedle = needle;
    lastSqueezed = squeeze(needle);
  }
  let hay = hays.get(entry);
  if (hay === undefined) {
    hay = squeeze(`${entry.area} ${entry.streets} ${entry.areasRaw}`);
    hays.set(entry, hay);
  }
  return hay.includes(lastSqueezed);
}

/**
 * The feed has durable normalized kinds for rotational and emergency outages. Older advisory
 * rows did not preserve their category, so compatibility checks use only published metadata,
 * never prose, and otherwise leave them scheduled.
 */
export const INTERRUPTION_TYPES = Object.freeze(['scheduled', 'emergency', 'rotational']);

export function interruptionType(entry) {
  if (entry.kind === 'emergency') return 'emergency';
  if (entry.kind === 'rotational') return 'rotational';
  const published = `${entry.category ?? ''} ${entry.type ?? ''} ${entry.sourceStatus ?? ''}`;
  return /\bemergency\b/i.test(published) ? 'emergency' : 'scheduled';
}

const REDUNDANT_LIFECYCLE_STATUSES = new Set([
  'upcoming',
  'ongoing',
  'restored',
  'completed',
  'done',
  'live',
  'scheduled',
  'finished',
  'in-progress',
]);

/**
 * Calendar cells occasionally repeat their own lifecycle label while being normalized.
 * A row already names timing and live/upcoming state, so those labels add no information;
 * revisions and cancellations remain meaningful and are deliberately retained.
 */
export function sourceStatusForDisplay(value) {
  const text = `${value ?? ''}`.trim().replace(/\s+/g, ' ');
  if (!text) return '';
  const tokens = text.split(/(?:\s*[·|,;/]\s*|\s+)/).filter(Boolean);
  const repeatedToken = tokens.length > 1 && tokens.every((token) => token.toLowerCase() === tokens[0].toLowerCase())
    ? tokens[0]
    : '';
  const repeatedRun = text.match(/^(.+?)(?:\1)+$/i)?.[1] || '';
  const status = repeatedToken || repeatedRun || text;
  const lifecycleTokens = status
    .toLowerCase()
    .replace(/\bin\s+progress\b/g, 'in-progress')
    .split(/(?:\s*[·|,;/]\s*|\s+)/)
    .filter(Boolean);
  return lifecycleTokens.length && lifecycleTokens.every((token) => REDUNDANT_LIFECYCLE_STATUSES.has(token))
    ? ''
    : status;
}

/** One row's visibility under the current filters. */
export function isVisible(
  entry,
  { city = '', needle = '', types = INTERRUPTION_TYPES, hidePossible = false, hideDone = false, now = Date.now() } = {},
) {
  if (city && !citiesOf(entry).includes(city)) return false;
  if (!matches(entry, needle)) return false;
  if (!types.includes(interruptionType(entry))) return false;
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

const andList = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names.join(''));

/**
 * The whole verdict: tone, the two lines, and a stable identity for the aria-live region.
 *
 * Lines come back as segments — plain strings, plus `{ count }` for the relative
 * countdown. The countdown is the only part that moves every minute, so the page paints
 * it into a node that does not announce; everything else is rewritten (and announced)
 * only when `key` changes.
 *
 * `place` is the caller's `lookupPlace()` result: an object, or `null` for text that was
 * looked up and not recognised. `feed` lets the page distinguish a readable, quiet window
 * from an unreadable feed while preserving the legacy omitted state for existing callers.
 *
 * @param {{
 *   entries: any[],
 *   scope: any[],
 *   label: string,
 *   scoped: boolean,
 *   city?: string,
 *   stale?: boolean,
 *   now?: number,
 *   place?: { kind: string, place: string, lgus: readonly string[], utility?: string } | null,
 *   feed?: 'ready' | 'failed',
 */
export function verdictView({
  entries,
  scope,
  label,
  scoped,
  city = '',
  stale = false,
  now = Date.now(),
  place = undefined,
  feed = undefined,
}) {
  // The all-franchise summary is about what can still happen, not the published archive.
  // Keep this distinct from `scope`: a scoped answer deliberately retains finished rows so
  // it can explain why an otherwise covered area has nothing current to show.
  const current = entries.filter((e) => {
    const state = entryStatus(e, now).state;
    return state === 'live' || state === 'upcoming';
  });
  const liveAll = current.filter((e) => entryStatus(e, now).state === 'live' && !e.possible).length;
  const confirmed = current.filter((e) => !e.possible).length;
  const possible = current.length - confirmed;
  const summaryState = scoped ? '' : `|summary:${liveAll},${confirmed},${possible}`;
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
  // A suffix for place-aware answers. `summaryState` separately identifies unscoped
  // counts, while this stays empty for every legacy answer that did not pass `place`.
  let mark = '';

  if (place?.kind === 'outside') {
    // True whether or not the feed loaded: the reader's distributor is not the one this
    // page reads, so there is no schedule here to call quiet.
    tone = 'wait';
    mark = 'outside';
    head = [`Visayan Electric does not serve ${place.place}`];
    detail = [
      `${place.utility} distributes power there, not Visayan Electric, so no schedule for ${place.place} will ever appear on this page. Check with ${place.utility} for that area.`,
    ];
  } else if (feed === 'failed' || (!entries.length && feed === undefined)) {
    tone = 'wait';
    mark = 'failed';
    head = ['Schedule unavailable'];
    detail = ['Visayan Electric’s schedule could not be read just now. Try again in a few minutes.'];
  } else if (place?.kind === 'barangay' && place.lgus?.length > 1 && !city) {
    // A shared barangay cannot inherit an advisory from another LGU. Hold the verdict at
    // the city choice rather than making a confident claim and qualifying it afterwards.
    tone = 'wait';
    mark = 'shared';
    head = [`Choose the city for ${place.place}`];
    detail = [
      `${place.place} is a barangay in ${andList(place.lgus)}. Select the matching city before this page can confirm a published interruption.`,
    ];
  } else if (!scoped) {
    tone = 'idle';
    head = ['Tell me where you are'];
    const summary = [
      confirmed ? `${confirmed} confirmed interruption${confirmed === 1 ? '' : 's'}` : '',
      possible ? `${possible} possible brownout slot${possible === 1 ? '' : 's'}` : '',
    ].filter(Boolean).join(' and ');
    detail = [
      liveAll
        ? `${liveAll} ${liveAll === 1 ? 'interruption is' : 'interruptions are'} running across the franchise right now. Type your barangay for a straight answer.`
        : current.length
          ? `${summary} ${current.length === 1 ? 'is' : 'are'} currently listed across the franchise. Type your barangay to confirm your area.`
          : 'No current or upcoming interruptions are listed. Type your barangay to confirm your area.',
    ];
  } else if (liveSure.length) {
    tone = 'out';
    const soonest = liveSure[0];
    const left = entryStatus(soonest, now).minutes ?? 0;
    head = [`Yes, power is out now in ${label}`];
    detail = [
      `Power should return around ${clock.format(new Date(soonest.end))}, `,
      { count: `about ${gap(left)} from now` },
      `.${liveSure.length > 1 ? ` ${liveSure.length - 1} more area${liveSure.length > 2 ? 's' : ''} also out.` : ''}`,
    ];
  } else if (livePossible.length) {
    tone = 'wait';
    const slot = livePossible[0];
    head = [`Maybe, ${label} is in a rotational brownout window now`];
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
        ? `Next rotational window: ${when} to ${clock.format(new Date(next.end))} (${next.hours}h), possible, not confirmed.`
        : `Next outage: ${when} to ${clock.format(new Date(next.end))} (${next.hours}h).`,
    ];
  } else {
    tone = 'clear';
    head = [`No, nothing scheduled for ${label}`];
    detail = ['No interruption is published for that area in the next 14 days.'];
    // An empty scope has more than one reason, and only one of them is "nothing is
    // scheduled". The name can be a barangay this franchise covers on a quiet fortnight,
    // or a name it has never heard of. A scope holding only finished rows keeps the copy
    // above, because something really was published for it.
    if (!scope.length && (place?.kind === 'barangay' || place?.kind === 'city')) {
      mark = 'covered';
      const where = place.kind === 'barangay' && place.lgus?.length ? ` in ${andList(place.lgus)}` : '';
      head = [`No, nothing scheduled for ${label}`];
      detail = [`${label} is inside Visayan Electric’s franchise${where}, and no interruption is published for it in the next 14 days.`];
      // A city chip with nothing listed hands us `null` too, since nothing was typed to
      // look up. Only an exact franchise-LGU label is known; a barangay plus a conflicting
      // city must stay unconfirmed rather than inheriting the city's all-clear.
    } else if (!scope.length && place === null && !CITIES.some(([name]) => name.toLowerCase() === label.toLowerCase())) {
      mark = 'unknown';
      tone = 'wait';
      // `lookupPlace` knows barangays and cities, never streets, so an unrecognised name
      // is not evidence of anything. State the limit as a condition, not as a verdict on
      // the name: a Gorordo Avenue reader is inside the franchise and must not be sent
      // to another utility.
      head = [`Could not confirm ${label}`];
      detail = [
        `This page cannot confirm an interruption for that exact name. It covers only the 8 cities and towns Visayan Electric ` +
          'distributes to: Cebu City, Mandaue, Talisay, Naga, Liloan, Consolacion, ' +
          'Minglanilla and San Fernando. Try the barangay or city name used in the advisory.',
      ];
    }
  }

  // A city choice resolves the shared-barangay branch above. It deliberately carries no
  // residual caveat: the applied LGU is now part of every matching row and answer.

  // A green "nothing scheduled" is not honest while the Facebook feed is unread: the
  // rotational advisories live only there. A confirmed live outage stays 'out' — that is
  // true whatever the poller is doing.
  if (stale && tone === 'clear') tone = 'wait';

  // What the answer *is*, with no countdown in it: a minute later it remains stable until
  // a current entry crosses a boundary that changes the unscoped summary.
  const key = `${tone}|${label}|${live.map((e) => e.start).join(',')}|${next?.start ?? ''}` +
    (mark ? `|${mark}` : '') + summaryState;

  return {
    tone,
    key,
    head,
    detail,
    needsCity: mark === 'shared',
    cityChoices: mark === 'shared' ? [...place.lgus] : [],
  };
}
