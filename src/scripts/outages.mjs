// Visayan Electric advisory parsing + outage status helpers.
//
// Shared by functions/api/outages.js (Cloudflare Pages Function) and the /power page
// script. Plain string parsing, no DOM: the same module runs in Workers, Node (tests)
// and the browser.
//
// Source of truth: https://www.visayanelectric.com/post/service-interruption-<range>
// Each post is a Wix/Ricos page: a bold <p> day heading followed by one <table> per
// interruption with rows Time / Purpose / Areas Affected / Map.

export const PH_OFFSET = '+08:00';

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

// "sept" and "oct" both show up in slugs; match on 3-letter prefix.
export function monthNumber(name) {
  const key = String(name || '').toLowerCase();
  const index = MONTHS.findIndex((m) => m === key || (key.length >= 3 && m.startsWith(key.slice(0, 3))));
  return index === -1 ? null : index + 1;
}

const pad = (n) => String(n).padStart(2, '0');

export function isoAt(year, month, day, hour, minute) {
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00${PH_OFFSET}`;
}

// Calendar-safe day shift without leaning on local timezone.
export function shiftDay({ year, month, day }, days) {
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '-', mdash: '-', rsquo: '\u2019', lsquo: '\u2018', hellip: '...',
};

export function decodeEntities(input) {
  return String(input).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    const named = ENTITIES[body.toLowerCase()];
    return named === undefined ? match : named;
  });
}

// Tag soup in, one clean line out. Block-ish tags become spaces so words never fuse.
export function plainText(html) {
  return decodeEntities(
    String(html)
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<(br|\/p|\/div|\/li|\/tr|\/td)\b[^>]*>/gi, ' ')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const DAY_HEADING_RE = /^([a-z]+)\s+(\d{1,2})(?:\s*[-–]\s*(?:([a-z]+)\s+)?(\d{1,2}))?,?\s*(\d{4})\b/i;

// "September 3, 2026 (Thursday)" / "September 3-4, 2026 (Thursday-Friday)" -> first date.
export function parseDayHeading(text) {
  const match = DAY_HEADING_RE.exec(String(text).trim());
  if (!match) return null;
  const month = monthNumber(match[1]);
  const day = Number(match[2]);
  const year = Number(match[5]);
  if (!month || !day || day > 31 || !year) return null;
  return { year, month, day };
}

const CLOCK_RE = /(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|nn|mn|noon|midnight)?/i;

// VECO writes 12 noon as "12:00 NN" and midnight as "12:00 MN".
export function parseClock(text) {
  const match = CLOCK_RE.exec(String(text));
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const marker = (match[3] || '').toLowerCase().replace(/\./g, '');
  if (hour > 23 || minute > 59) return null;
  if (marker === 'pm' && hour < 12) hour += 12;
  if (marker === 'am' && hour === 12) hour = 0;
  if (marker === 'nn' || marker === 'noon') hour = 12;
  if (marker === 'mn' || marker === 'midnight') hour = 0;
  return { hour, minute, marker };
}

const OF_DATE_RE = /of\s+([a-z]+)\s+(\d{1,2})/i;

function sideDate(text, base) {
  const match = OF_DATE_RE.exec(text);
  if (!match) return base;
  const month = monthNumber(match[1]);
  const day = Number(match[2]);
  if (!month || !day) return base;
  // A December post spilling into January keeps the heading's year for the start side.
  const year = month < base.month ? base.year + 1 : base.year;
  return { year, month, day };
}

const FLAG_RE = /\b(cancelled|canceled|additional|rescheduled|extended|moved)\b/i;

// "8:00 AM to 3:00 PM (7hrs)" | "10:00 PM of August 13 to 6:00 AM of August 14 (8hrs)"
// | "9:00 AM to 5:00 PM (8hrs)- ADDITIONAL"
export function parseTimeRange(timeText, base) {
  if (!base) return null;
  const text = plainText(timeText).replace(/^time\s*:?\s*/i, '');
  const flagMatch = FLAG_RE.exec(text);
  const flag = flagMatch ? flagMatch[1].toLowerCase().replace('canceled', 'cancelled') : null;

  const split = text.split(/\s+to\s+|\s+until\s+/i);
  if (split.length < 2) return null;
  const [rawStart, rawEnd] = split;

  const startClock = parseClock(rawStart);
  const endClock = parseClock(rawEnd);
  if (!startClock || !endClock) return null;

  const startDate = sideDate(rawStart, base);
  let endDate = sideDate(rawEnd, base);

  const sameDate = endDate.year === startDate.year
    && endDate.month === startDate.month
    && endDate.day === startDate.day;
  const endsEarlier = endClock.hour * 60 + endClock.minute <= startClock.hour * 60 + startClock.minute;
  if (sameDate && endsEarlier) endDate = shiftDay(startDate, 1);

  const start = isoAt(startDate.year, startDate.month, startDate.day, startClock.hour, startClock.minute);
  const end = isoAt(endDate.year, endDate.month, endDate.day, endClock.hour, endClock.minute);
  const hours = Math.round(((Date.parse(end) - Date.parse(start)) / 3600000) * 100) / 100;
  if (!Number.isFinite(hours) || hours <= 0) return null;
  return { start, end, hours, flag };
}

const STREET_SPLIT_RE = /,?\s*(?:along|including|at\s+portions?\s+of)\s+/i;

// "Portion of Talamban, Cebu City, along portions of Highway 77." ->
//   { area: 'Talamban, Cebu City', streets: 'portions of Highway 77' }
export function parseAreas(rawText) {
  const raw = plainText(rawText).replace(/^areas?\s*affected\s*:?\s*/i, '');
  const cut = raw.search(STREET_SPLIT_RE);
  const head = (cut === -1 ? raw : raw.slice(0, cut)).trim();
  const tail = cut === -1 ? '' : raw.slice(cut).replace(STREET_SPLIT_RE, '').trim();
  const area = head
    .replace(/^portions?\s+of\s+/i, '')
    .replace(/^brgy\.?\s*/i, '')
    .replace(/[,;.]\s*$/, '')
    .trim();
  return {
    area: area || head || raw,
    streets: tail.replace(/[.;]\s*$/, ''),
    raw,
  };
}

// Ricos writes data-visual-col before data-visual-row; read the attributes by name so
// either order parses.
const CELL_RE = /<td\b([^>]*)>([\s\S]*?)<\/td>/gi;
const ROW_ATTR_RE = /data-visual-row="(\d+)"/i;
const COL_ATTR_RE = /data-visual-col="(\d+)"/i;

function tableRows(tableHtml) {
  const rows = [];
  for (const match of tableHtml.matchAll(CELL_RE)) {
    const row = Number(ROW_ATTR_RE.exec(match[1])?.[1]);
    const col = Number(COL_ATTR_RE.exec(match[1])?.[1]);
    if (!Number.isInteger(row) || !Number.isInteger(col)) continue;
    rows[row] = rows[row] || [];
    rows[row][col] = plainText(match[2]);
  }
  return rows;
}

const LABELS = [
  [/time/i, 'time'],
  [/purpose|reason/i, 'purpose'],
  [/area/i, 'areas'],
  [/map/i, 'map'],
];
// Some tables ship an empty label cell; fall back to row order.
const POSITIONAL = ['time', 'purpose', 'areas', 'map'];

function tableFields(rows) {
  const fields = {};
  rows.forEach((cells, index) => {
    if (!cells) return;
    const label = (cells[0] || '').trim();
    const value = (cells[1] || '').trim();
    const matched = LABELS.find(([re]) => re.test(label));
    const key = matched ? matched[1] : POSITIONAL[index];
    if (key && fields[key] === undefined) fields[key] = value || label;
  });
  return fields;
}

const BLOCK_RE = /<p\b[^>]*>([\s\S]*?)<\/p>|<table\b[^>]*data-hook="table-component"[\s\S]*?<\/table>/gi;

/**
 * Parse one advisory post into normalized outage entries.
 * @param {string} html raw post HTML
 * @param {{ url?: string, title?: string }} [meta]
 */
export function parsePost(html, meta = {}) {
  const bodyStart = html.indexOf('data-id="content-viewer"');
  const body = bodyStart === -1 ? html : html.slice(bodyStart);
  const entries = [];
  let day = null;

  for (const match of body.matchAll(BLOCK_RE)) {
    const [block, paragraph] = match;
    if (paragraph !== undefined) {
      const heading = parseDayHeading(plainText(paragraph));
      if (heading) day = heading;
      continue;
    }
    if (!day) continue;

    const fields = tableFields(tableRows(block));
    const range = parseTimeRange(fields.time || '', day);
    if (!range) continue;

    const areas = parseAreas(fields.areas || '');
    entries.push({
      kind: 'scheduled',
      start: range.start,
      end: range.end,
      hours: range.hours,
      flag: range.flag,
      area: areas.area,
      streets: areas.streets,
      areasRaw: areas.raw,
      purpose: plainText(fields.purpose || '').replace(/^purpose\s*:?\s*/i, ''),
      source: meta.url || '',
      sourceTitle: meta.title || '',
    });
  }

  return entries;
}

const SLUG_RE = /^service-interruption-(.+)$/;

/**
 * Date span covered by an advisory slug, e.g.
 * "service-interruption-august-30-september-5-2026" -> 2026-08-30 .. 2026-09-05
 */
export function slugRange(slug) {
  const match = SLUG_RE.exec(String(slug).trim().toLowerCase());
  if (!match) return null;
  const parts = match[1].split('-').filter(Boolean);
  const year = Number(parts[parts.length - 1]);
  if (!/^\d{4}$/.test(String(parts[parts.length - 1] || ''))) return null;

  const tokens = parts.slice(0, -1);
  const dates = [];
  let month = null;
  for (const token of tokens) {
    if (/^\d{1,2}$/.test(token)) {
      if (!month) return null;
      dates.push({ month, day: Number(token) });
    } else {
      const parsed = monthNumber(token);
      if (!parsed) return null;
      month = parsed;
    }
  }
  if (!dates.length) return null;

  const first = dates[0];
  const last = dates[dates.length - 1];
  // A range that walks backwards crossed New Year: the start belongs to the prior year.
  const startYear = last.month < first.month ? year - 1 : year;
  return {
    start: `${startYear}-${pad(first.month)}-${pad(first.day)}`,
    end: `${year}-${pad(last.month)}-${pad(last.day)}`,
  };
}

const MANILA_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today's date in Cebu as YYYY-MM-DD, regardless of where the code runs. */
export function manilaDate(nowMs = Date.now()) {
  return MANILA_DATE.format(new Date(nowMs));
}

export function addDays(dateString, days) {
  const [y, m, d] = dateString.split('-').map(Number);
  const shifted = shiftDay({ year: y, month: m, day: d }, days);
  return `${shifted.year}-${pad(shifted.month)}-${pad(shifted.day)}`;
}

/** live | upcoming | done, plus minutes until start (or until power returns). */
export function entryStatus(entry, nowMs = Date.now()) {
  if (entry.flag === 'cancelled') return { state: 'cancelled', minutes: null };
  const start = Date.parse(entry.start);
  const end = Date.parse(entry.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { state: 'unknown', minutes: null };
  if (nowMs >= end) return { state: 'done', minutes: null };
  if (nowMs >= start) return { state: 'live', minutes: Math.ceil((end - nowMs) / 60000) };
  return { state: 'upcoming', minutes: Math.ceil((start - nowMs) / 60000) };
}

/** Manually logged rotational brownouts -> the same entry shape as parsed ones. */
export function fromManual(item) {
  const [y, m, d] = String(item.date || '').split('-').map(Number);
  if (!y || !m || !d) return null;
  const range = parseTimeRange(`${item.start} to ${item.end}`, { year: y, month: m, day: d });
  if (!range) return null;
  const areas = parseAreas(item.area || '');
  return {
    kind: 'rotational',
    start: range.start,
    end: range.end,
    hours: range.hours,
    flag: item.flag || null,
    area: areas.area,
    streets: item.streets || areas.streets,
    areasRaw: item.area || '',
    purpose: item.note || 'Rotational brownout (grid supply shortfall).',
    source: item.source || '',
    sourceTitle: item.sourceTitle || 'Visayan Electric advisory',
    map: item.map || '',
    // A weekly "POSSIBLE ROTATIONAL BROWNOUT" slot is a plan, not an outage in progress.
    possible: Boolean(item.possible),
  };
}

export function sortEntries(entries) {
  return entries.slice().sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.area.localeCompare(b.area));
}
