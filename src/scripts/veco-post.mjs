// Parse a Visayan Electric rotational-brownout Facebook post into outage entries.
//
// Facebook has no readable public feed (mbasic and m.facebook both answer with a login
// wall), so these advisories arrive as pasted text. They are consistently structured:
//
//   ONGOING ROTATIONAL BROWNOUT
//   11:00AM-12:00PM | SEPTEMBER 3, 2026
//   Portion of Cebu City: Calamba, Capitol Site, Guadalupe
//   View the map here: https://tinyurl.com/4t5zrpan
//
// VECO types the headings in Unicode math-bold, so everything is folded to ASCII first.

import { monthNumber } from './outages.mjs';

// Unicode math alphanumeric blocks VECO uses for "bold" text, folded back to ASCII.
const FOLD_RANGES = [
  [0x1d400, 26, 'A'], // bold caps
  [0x1d41a, 26, 'a'], // bold lower
  [0x1d434, 26, 'A'], // italic caps
  [0x1d44e, 26, 'a'], // italic lower
  [0x1d5a0, 26, 'A'], // sans caps
  [0x1d5ba, 26, 'a'], // sans lower
  [0x1d5d4, 26, 'A'], // sans bold caps
  [0x1d5ee, 26, 'a'], // sans bold lower
  [0x1d670, 26, 'A'], // mono caps
  [0x1d68a, 26, 'a'], // mono lower
  [0x1d7ce, 10, '0'], // bold digits
  [0x1d7e2, 10, '0'], // sans digits
  [0x1d7ec, 10, '0'], // sans bold digits
  [0x1d7f6, 10, '0'], // mono digits
];

export function foldBold(input) {
  let out = '';
  for (const char of String(input)) {
    const code = char.codePointAt(0);
    const range = FOLD_RANGES.find(([base, size]) => code >= base && code < base + size);
    out += range ? String.fromCharCode(range[2].charCodeAt(0) + (code - range[0])) : char;
  }
  return out;
}

// Emoji and pictographs are decoration in these posts; drop them before matching. The
// clock face VECO prefixes every time slot with lives in Miscellaneous Technical, not in
// the emoji blocks.
const DECORATION_RE =
  /[\u{1F000}-\u{1FAFF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu;

const clean = (line) =>
  foldBold(line).replace(DECORATION_RE, ' ').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

// "11:00AM-12:00PM | SEPTEMBER 3, 2026"  ·  "10:00 PM - 4:00 AM | SEPT 3-4, 2026"  ·
// "10:00AM-12:30PM" (the weekly schedule dates its slots once, in the header)
const SLOT_RE =
  /^\s*(\d{1,2}(?::\d{2})?\s*[AP]\.?M\.?)\s*(?:-|–|to)\s*(\d{1,2}(?::\d{2})?\s*[AP]\.?M\.?)\s*(?:\|\s*(.+?))?\s*$/i;

// "Portion of Cebu City: Calamba, Guadalupe"  ·  "Portions of Mandaue City & Consolacion: …"
const AREA_RE = /^portions?\s+of\s+(.+?)\s*:\s*(.+)$/i;
const MAP_RE = /view the map here\s*:?\s*(https?:\/\/\S+)/i;
const STATUS_RE = /\b(ongoing|upcoming|next|completed|restored|cancelled|canceled)\b/i;


const MAX_DAYS = 14;

// "DAILY | SEPTEMBER 3-6, 2026"  ·  "AUGUST 30 - SEPTEMBER 2, 2026"  ·  "SEPTEMBER 3, 2026"
const RANGE_RE =
  /([A-Za-z]+)\s*(\d{1,2})(?:\s*(?:-|–|to)\s*(?:([A-Za-z]+)\s*)?(\d{1,2}))?,?\s*(\d{4})/;

/** Every date an advisory header covers, as YYYY-MM-DD. */
export function parseDateRange(text) {
  const hit = RANGE_RE.exec(foldBold(text));
  if (!hit) return [];
  const [, fromMonthName, fromDayText, toMonthName, toDayText, yearText] = hit;
  const fromMonth = monthNumber(fromMonthName);
  const year = Number(yearText);
  if (!fromMonth || !year) return [];

  const start = new Date(Date.UTC(year, fromMonth - 1, Number(fromDayText)));
  const toMonth = toMonthName ? monthNumber(toMonthName) : fromMonth;
  if (!toMonth) return [];
  // A range that walks backwards crossed New Year.
  const endYear = toMonth < fromMonth ? year + 1 : year;
  const end = toDayText ? new Date(Date.UTC(endYear, toMonth - 1, Number(toDayText))) : start;
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [];

  const dates = [];
  for (const cursor = new Date(start); cursor <= end && dates.length < MAX_DAYS; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    dates.push(cursor.toISOString().slice(0, 10));
  }
  return dates;
}

/**
 * Parse pasted advisory text into rotational entry drafts.
 *
 * Two post shapes both work: the hourly "ONGOING" update, where each slot carries its own
 * date, and the weekly "POSSIBLE ... DAILY | SEPTEMBER 3-6" schedule, where dateless slots
 * repeat across every day in the header range. Consecutive city lines share the map link
 * that follows them.
 *
 * @param {string} text the post body, pasted as-is
 * @param {{ source?: string }} [meta] permalink of the post
 * @returns {{ items: object[], warnings: string[] }}
 */
export function parseAdvisoryText(text, meta = {}) {
  const lines = String(text).split(/\r?\n/).map(clean).filter(Boolean);
  const items = [];
  const warnings = [];

  let dates = [];
  let slot = null;
  let status = '';
  let possible = false;
  let awaitingMap = [];

  for (const line of lines) {
    // Headline wording decides whether these are happening or merely planned.
    if (/\bpossible\b/i.test(line)) possible = true;
    if (/\bongoing\b/i.test(line)) possible = false;

    const statusHit = STATUS_RE.exec(line);
    if (statusHit && !SLOT_RE.test(line) && !AREA_RE.test(line) && line.length < 80) {
      status = statusHit[1].toLowerCase();
    }

    const slotHit = SLOT_RE.exec(line);
    if (slotHit) {
      const [, start, end, dateText] = slotHit;
      const slotDates = dateText ? parseDateRange(dateText) : dates;
      if (!slotDates.length) {
        warnings.push(`No date known for the slot: ${line}`);
        slot = null;
        awaitingMap = [];
        continue;
      }
      // A slot line that also names dates re-anchors the ones that follow it.
      if (dateText) dates = slotDates;
      slot = { dates: slotDates, start: start.toUpperCase().replace(/\./g, ''), end: end.toUpperCase().replace(/\./g, '') };
      awaitingMap = [];
      continue;
    }

    // A header that only carries dates ("DAILY | SEPTEMBER 3-6, 2026").
    if (!AREA_RE.test(line) && !MAP_RE.test(line)) {
      const headerDates = parseDateRange(line);
      if (headerDates.length) {
        dates = headerDates;
        continue;
      }
    }

    const areaHit = AREA_RE.exec(line);
    if (areaHit) {
      if (!slot) {
        warnings.push(`Area listed before any time slot: ${line}`);
        continue;
      }
      const city = areaHit[1].replace(/^city of\s+/i, '').trim();
      const barangays = areaHit[2]
        .replace(/\s*&\s*/g, ', ')
        .replace(/,(\s*,)+/g, ',')
        .replace(/[.;,]\s*$/, '')
        .trim();
      for (const date of slot.dates) {
        const item = {
          date,
          start: slot.start,
          end: slot.end,
          area: `${barangays}, ${city}`,
          possible,
          note: possible
            ? 'Possible rotational brownout — implemented only if NGCP calls for load reduction.'
            : `Rotational brownout${status ? ` (${status})` : ''} — NGCP supply shortfall.`,
          source: meta.source || '',
          map: '',
        };
        items.push(item);
        awaitingMap.push(item);
      }
      continue;
    }

    const mapHit = MAP_RE.exec(line);
    if (mapHit) {
      // One map covers every city line listed since the last map link.
      const url = mapHit[1].replace(/[).,]+$/, '');
      const targets = awaitingMap.length ? awaitingMap : items.slice(-1);
      for (const item of targets) item.map = url;
      awaitingMap = [];
    }
  }

  if (!items.length) warnings.push('No time slot plus area pair found in that text.');
  return { items, warnings };
}
