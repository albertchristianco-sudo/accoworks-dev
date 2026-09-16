// AboitizPower FYI is an undocumented Apps Script bootstrap. Keep its volatile source
// format outside the authoritative Visayan Electric parser and never execute its source.

export const FYI_SOURCE_URL = 'https://fyi.aboitizpower.com/';
export const FYI_MAX_INPUT_BYTES = 2 * 1024 * 1024;

const ONGOING_MAX_MS = 12 * 60 * 60 * 1000;
const MAX_MW = 1_000_000;
const MAX_FYI_PLANS = 64;
const MAX_FYI_ADVISORIES = 128;
const MAX_FYI_ENTRIES_PER_PLAN = 24;
const MAX_FYI_FEEDERS_PER_ENTRY = 128;
const MAX_FYI_FEEDER_REFERENCES = 8_192;
const MAX_FYI_OUTPUT_WINDOWS = 256;
const BOOT_ASSIGNMENT_RE = /\b(?:const|let|var)\s+BOOT\s*=\s*/g;
const INIT_RE = /\bgoog\.script\.init\s*\(/g;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIMESTAMP_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/;
const SOURCE_STAMP_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function boundedUtf8(input) {
  if (typeof input !== 'string') throw new Error('FYI response was not text');

  let bytes = 0;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && input.charCodeAt(index + 1) >= 0xdc00 && input.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;

    if (bytes > FYI_MAX_INPUT_BYTES) throw new Error('FYI response exceeded the size limit');
  }
  return input;
}

function skipSpace(text, index) {
  while (/\s/.test(text[index] || '')) index += 1;
  return index;
}

function hexCode(text, index, length, label) {
  const token = text.slice(index, index + length);
  if (!new RegExp(`^[0-9a-fA-F]{${length}}$`).test(token)) throw new Error(`FYI ${label} escape was malformed`);
  return String.fromCharCode(Number.parseInt(token, 16));
}

function decodeEscape(text, slash) {
  const marker = text[slash + 1];
  if (!marker) throw new Error('FYI string escape was unterminated');

  const controls = {
    b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', 0: '\0',
  };
  if (marker in controls) return { value: controls[marker], end: slash + 2 };
  if (marker === '\r') return { value: '', end: text[slash + 2] === '\n' ? slash + 3 : slash + 2 };
  if (marker === '\n') return { value: '', end: slash + 2 };
  if (marker === 'x') return { value: hexCode(text, slash + 2, 2, 'hex'), end: slash + 4 };
  if (marker === 'u') return { value: hexCode(text, slash + 2, 4, 'unicode'), end: slash + 6 };
  if (marker === '\\' || marker === '"' || marker === "'" || marker === '/') return { value: marker, end: slash + 2 };
  throw new Error('FYI string used an unsupported escape');
}

// Decodes exactly one JavaScript string literal. It intentionally supports only the
// escape forms seen in the Apps Script bootstrap; it never evaluates any source.
function decodeJsString(text, start) {
  const quote = text[start];
  if (quote !== '"' && quote !== "'") throw new Error('FYI init did not contain a string literal');

  let value = '';
  for (let index = start + 1; index < text.length;) {
    const char = text[index];
    if (char === quote) return { value, end: index + 1 };
    if (char === '\\') {
      const decoded = decodeEscape(text, index);
      value += decoded.value;
      index = decoded.end;
      continue;
    }
    if (char === '\n' || char === '\r' || char === '\u2028' || char === '\u2029') {
      throw new Error('FYI string literal was unterminated');
    }
    value += char;
    index += 1;
  }
  throw new Error('FYI string literal was unterminated');
}

// A captured Apps Script source can contain the BOOT object with every JavaScript
// escape still present. Decode that one outer representation only when it begins with
// an escaped opening brace; decoding ordinary JSON would corrupt its inner escapes.
function decodeEncodedBoot(text) {
  let value = '';
  let depth = 0;
  let quoted = false;
  let escaped = false;

  for (let index = 0; index < text.length;) {
    let char;
    if (text[index] === '\\') {
      const decoded = decodeEscape(text, index);
      char = decoded.value;
      index = decoded.end;
    } else {
      char = text[index];
      index += 1;
    }
    value += char;

    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return value;
    }
  }
  throw new Error('FYI encoded BOOT object was unterminated');
}

function balancedJsonObject(text, start) {
  if (text[start] !== '{') throw new Error('FYI BOOT did not start with an object');

  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
      if (depth < 0) break;
    }
  }
  throw new Error('FYI BOOT object was unterminated');
}

function safeSourceStamp(value) {
  return typeof value === 'string' && SOURCE_STAMP_RE.test(value) ? value : null;
}

function publicBoot(value) {
  if (!isObject(value) || value.view !== 'public' || !Array.isArray(value.plans) || !Array.isArray(value.outages)) {
    throw new Error('FYI response did not contain a public data set');
  }
  // Discard unrelated bootstrap state before it reaches the summarizer. The array values
  // stay local to this module and are immediately reduced to the public API shape.
  return { view: value.view, stamp: safeSourceStamp(value.stamp), plans: value.plans, outages: value.outages };
}

/** Parse a plain FYI userHtml document without executing any embedded script. */
export function parseFyiUserHtml(input) {
  const text = boundedUtf8(input);
  BOOT_ASSIGNMENT_RE.lastIndex = 0;
  const assignment = BOOT_ASSIGNMENT_RE.exec(text);
  if (!assignment) throw new Error('FYI response did not contain BOOT');

  let start = skipSpace(text, assignment.index + assignment[0].length);
  let source = text;
  if (text[start] === '\\' && (/^\\x7b/i.test(text.slice(start)) || /^\\u007b/i.test(text.slice(start)))) {
    source = decodeEncodedBoot(text.slice(start));
    start = skipSpace(source, 0);
  }

  let boot;
  try {
    boot = JSON.parse(balancedJsonObject(source, start));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('FYI BOOT JSON was malformed');
    throw error;
  }
  return publicBoot(boot);
}

function parseInitWrapper(input) {
  INIT_RE.lastIndex = 0;
  const init = INIT_RE.exec(input);
  if (!init) throw new Error('FYI response did not contain an init wrapper');

  const start = skipSpace(input, init.index + init[0].length);
  const decoded = decodeJsString(input, start);
  let initPayload;
  try {
    initPayload = JSON.parse(decoded.value);
  } catch {
    throw new Error('FYI init JSON was malformed');
  }
  if (!isObject(initPayload) || typeof initPayload.userHtml !== 'string') {
    throw new Error('FYI init did not contain userHtml');
  }
  return parseFyiUserHtml(initPayload.userHtml);
}

/**
 * Parse either FYI userHtml or Apps Script's outer goog.script.init(...) response.
 * This function does not execute source and rejects anything but a public BOOT payload.
 */
export function parseFyiResponse(input) {
  const text = boundedUtf8(input);
  INIT_RE.lastIndex = 0;
  const wrapped = INIT_RE.test(text);
  INIT_RE.lastIndex = 0;
  return wrapped ? parseInitWrapper(text) : parseFyiUserHtml(text);
}

function parseDate(value) {
  const match = DATE_RE.exec(String(value || ''));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1) return null;
  const monthLengths = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day > monthLengths[month - 1]) return null;
  return { value: `${match[1]}-${match[2]}-${match[3]}`, year, month, day };
}

function dateAtHour(date, hour) {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day, hour));
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  const clock = String(shifted.getUTCHours()).padStart(2, '0');
  return `${year}-${month}-${day}T${clock}:00:00+08:00`;
}

function parseTimestamp(value) {
  if (typeof value !== 'string') return null;
  const match = TIMESTAMP_RE.exec(value);
  if (!match) return null;
  if (!parseDate(match[1])) return null;
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = Number(match[4] || 0);
  if (hour > 23 || minute > 59 || second > 59) return null;
  if (match[6] !== 'Z') {
    const offsetHour = Number(match[6].slice(1, 3));
    const offsetMinute = Number(match[6].slice(4, 6));
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) return null;
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  return { milliseconds, value: new Date(milliseconds).toISOString() };
}

function safeId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(value) ? value : null;
}

function safeType(value) {
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9 _-]{0,47}$/.test(value) ? value : null;
}

function safeFeeder(value) {
  return typeof value === 'string' && value.length <= 128 && value.trim() === value && value.length > 0 ? value : null;
}

function assertFyiBudgets(publicData) {
  if (publicData.plans.length > MAX_FYI_PLANS) throw new Error('FYI plans exceeded the collection limit');
  if (publicData.outages.length > MAX_FYI_ADVISORIES) throw new Error('FYI advisories exceeded the collection limit');

  let feederReferences = 0;
  for (const plan of publicData.plans) {
    if (!isObject(plan) || !Array.isArray(plan.entries)) continue;
    if (plan.entries.length > MAX_FYI_ENTRIES_PER_PLAN) throw new Error('FYI plan entries exceeded the collection limit');

    for (const entry of plan.entries) {
      if (!isObject(entry) || !Array.isArray(entry.feeders)) continue;
      if (entry.feeders.length > MAX_FYI_FEEDERS_PER_ENTRY) throw new Error('FYI entry feeders exceeded the collection limit');
      feederReferences += entry.feeders.length;
      if (feederReferences > MAX_FYI_FEEDER_REFERENCES) throw new Error('FYI feeder references exceeded the collection limit');
    }
  }
}

function safeNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_MW) return null;
  return Math.round(value * 1000) / 1000;
}

function rawActual(value) {
  if (!isObject(value)) return null;
  const start = parseTimestamp(value.start);
  if (!start) return null;

  let end = null;
  if (value.end !== undefined && value.end !== null && value.end !== '') {
    end = parseTimestamp(value.end);
    if (!end || end.milliseconds < start.milliseconds) return null;
  }
  return { start, end, mw: value.mw === undefined || value.mw === null ? null : safeNumber(value.mw) };
}

function actualSummary(records, coverage, total, nowMs) {
  if (!records.length) return null;

  const starts = records.map((record) => record.start);
  const opens = records.filter((record) => !record.end);
  const freshOpen = opens.filter((record) => record.start.milliseconds <= nowMs && nowMs - record.start.milliseconds <= ONGOING_MAX_MS);
  const staleOpen = opens.filter((record) => record.start.milliseconds <= nowMs && nowMs - record.start.milliseconds > ONGOING_MAX_MS);
  const futureOpen = opens.filter((record) => record.start.milliseconds > nowMs);
  const first = starts.reduce((earliest, stamp) => stamp.milliseconds < earliest.milliseconds ? stamp : earliest);
  const last = records.reduce((latest, record) => !record.end || record.end.milliseconds <= latest.milliseconds ? latest : record.end, records[0].end || first);
  const mwValues = records.map((record) => record.mw).filter((value) => value !== null);
  const mw = mwValues.length
    ? Math.round((coverage === 'per-feeder' ? mwValues.reduce((sum, value) => sum + value, 0) : Math.max(...mwValues)) * 1000) / 1000
    : null;

  let state;
  let ongoing = false;
  let stale = false;
  if (freshOpen.length) {
    ongoing = true;
    stale = staleOpen.length > 0;
    state = coverage === 'aggregate' ? 'aggregate' : freshOpen.length === total ? 'all-off' : 'partial';
  } else if (staleOpen.length) {
    state = 'open-stale';
    stale = true;
  } else if (futureOpen.length) {
    state = 'unknown';
  } else {
    state = coverage === 'aggregate' ? 'aggregate' : 'restored';
  }

  return {
    coverage,
    state,
    startedAt: first.value,
    endedAt: opens.length ? null : last.value,
    ongoing,
    stale,
    recorded: coverage === 'per-feeder' ? records.length : null,
    total: coverage === 'per-feeder' ? total : null,
    mw,
  };
}

function windowActual(hourEntries, window, nowMs) {
  const perFeeder = [];
  for (const feeder of window.feeders) {
    let record = null;
    for (let hour = window.startHour; hour <= window.endHour; hour += 1) {
      const byFeeder = hourEntries.get(hour)?.byFeeder;
      if (!isObject(byFeeder) || !Object.hasOwn(byFeeder, feeder)) continue;
      record = rawActual(byFeeder[feeder]);
      if (record) break;
    }
    if (record) perFeeder.push(record);
  }
  if (perFeeder.length) return actualSummary(perFeeder, 'per-feeder', window.feeders.length, nowMs);

  const aggregate = [];
  for (let hour = window.startHour; hour <= window.endHour; hour += 1) {
    const record = rawActual(hourEntries.get(hour)?.actual);
    if (record) aggregate.push(record);
  }
  return actualSummary(aggregate, 'aggregate', null, nowMs);
}

function planWindows(date, entries, nowMs, outputBudget) {
  const runs = new Map();
  const feeders = new Set();
  for (const entry of entries.values()) for (const feeder of entry.feeders) feeders.add(feeder);

  for (const feeder of feeders) {
    let startHour = null;
    for (let hour = 0; hour <= 24; hour += 1) {
      const active = hour < 24 && entries.get(hour)?.feeders.has(feeder);
      if (active && startHour === null) startHour = hour;
      else if (!active && startHour !== null) {
        const endHour = hour - 1;
        const key = `${startHour}-${endHour}`;
        if (!runs.has(key)) {
          if (outputBudget.count >= MAX_FYI_OUTPUT_WINDOWS) throw new Error('FYI output windows exceeded the collection limit');
          outputBudget.count += 1;
          runs.set(key, { startHour, endHour, feeders: [] });
        }
        runs.get(key).feeders.push(feeder);
        startHour = null;
      }
    }
  }

  return [...runs.values()]
    .sort((left, right) => left.startHour - right.startHour || left.endHour - right.endHour)
    .map((window) => {
      window.feeders.sort();
      return {
        start: dateAtHour(date, window.startHour),
        end: dateAtHour(date, window.endHour + 1),
        hours: window.endHour - window.startHour + 1,
        feederCount: window.feeders.length,
        actual: windowActual(entries, window, nowMs),
      };
    });
}

function summarizePlan(plan, nowMs, outputBudget) {
  if (!isObject(plan) || plan.du !== 'VECO') return { value: null, malformed: false };
  const id = safeId(plan.id);
  const date = parseDate(plan.date);
  if (!id || !date || !Array.isArray(plan.entries)) return { value: null, malformed: true };

  const entries = new Map();
  for (const raw of plan.entries) {
    if (!isObject(raw) || !Number.isInteger(raw.hour) || raw.hour < 0 || raw.hour > 23 || !Array.isArray(raw.feeders)) continue;
    const feeders = new Set();
    for (const feeder of raw.feeders) {
      const safe = safeFeeder(feeder);
      if (safe) feeders.add(safe);
    }
    if (feeders.size) entries.set(raw.hour, { feeders, byFeeder: raw.byFeeder, actual: raw.actual });
  }
  const windows = planWindows(date, entries, nowMs, outputBudget);
  if (!windows.length) return { value: null, malformed: true };
  return { value: { id, date: date.value, windows }, malformed: false };
}

function summarizeAdvisory(advisory) {
  if (!isObject(advisory) || advisory.du !== 'VECO') return { value: null, malformed: false };
  const id = safeId(advisory.id);
  const type = safeType(advisory.type);
  const start = parseTimestamp(advisory.start);
  const end = parseTimestamp(advisory.end);
  if (!id || !type || !start || !end || end.milliseconds <= start.milliseconds) return { value: null, malformed: true };
  return {
    value: {
      id,
      type,
      start: start.value,
      end: end.value,
      status: advisory.cancelled === true || advisory.status === 'Cancelled' ? 'cancelled' : 'published',
    },
    malformed: false,
  };
}

function withinWindow(start, end, from, to) {
  const lower = Date.parse(`${from.value}T00:00:00+08:00`);
  const upperDate = new Date(Date.UTC(to.year, to.month - 1, to.day + 1));
  const upper = Date.parse(`${upperDate.getUTCFullYear()}-${String(upperDate.getUTCMonth() + 1).padStart(2, '0')}-${String(upperDate.getUTCDate()).padStart(2, '0')}T00:00:00+08:00`);
  return end > lower && start < upper;
}

function sourceMetadata(stamp) {
  return { sourceStamp: safeSourceStamp(stamp), freshness: 'unknown' };
}

/** Return the fixed, always-present API envelope for an unavailable FYI source. */
export function emptyFyi(checkedAt = null) {
  return {
    available: false,
    checkedAt,
    sourceStamp: null,
    freshness: 'unknown',
    sourceUrl: FYI_SOURCE_URL,
    plans: [],
    advisories: [],
    warnings: [],
  };
}

/**
 * Reduce a validated public BOOT object to the supplemental FYI API fields only.
 * `from` and `to` are inclusive Cebu dates matching /api/outages' existing window.
 */
export function summarizeFyiBoot(boot, { from, to, nowMs = Date.now() } = {}) {
  const publicData = publicBoot(boot);
  const startDate = parseDate(from);
  const endDate = parseDate(to);
  if (!startDate || !endDate || startDate.value > endDate.value || !Number.isFinite(nowMs)) {
    throw new Error('FYI summary requires a valid date window');
  }

  assertFyiBudgets(publicData);

  const outputBudget = { count: 0 };
  const warnings = [];
  const plans = [];
  let malformedPlans = 0;
  for (const plan of publicData.plans) {
    const summarized = summarizePlan(plan, nowMs, outputBudget);
    if (summarized.malformed) {
      malformedPlans += 1;
      continue;
    }
    if (summarized.value && summarized.value.date >= startDate.value && summarized.value.date <= endDate.value) plans.push(summarized.value);
  }
  if (malformedPlans) warnings.push(`Skipped ${malformedPlans} malformed FYI ${malformedPlans === 1 ? 'plan' : 'plans'}`);

  const advisories = [];
  let malformedAdvisories = 0;
  for (const advisory of publicData.outages) {
    const summarized = summarizeAdvisory(advisory);
    if (summarized.malformed) {
      malformedAdvisories += 1;
      continue;
    }
    if (summarized.value && withinWindow(
      Date.parse(summarized.value.start),
      Date.parse(summarized.value.end),
      startDate,
      endDate,
    )) advisories.push(summarized.value);
  }
  if (malformedAdvisories) warnings.push(`Skipped ${malformedAdvisories} malformed FYI ${malformedAdvisories === 1 ? 'advisory' : 'advisories'}`);

  const source = sourceMetadata(publicData.stamp);
  return {
    sourceStamp: source.sourceStamp,
    freshness: source.freshness,
    plans: plans.sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id)),
    advisories: advisories.sort((left, right) => left.start.localeCompare(right.start) || left.id.localeCompare(right.id)),
    warnings,
  };
}
