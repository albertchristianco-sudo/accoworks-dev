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
const MAX_FYI_MAP_CLOUDS = 64;
const MAX_FYI_MAP_POINT_PAIRS = 24_000;
const MAX_FYI_MAP_POINT_PAIRS_PER_CLOUD = 4_096;
const MAX_FYI_MAP_OUTPUT_BYTES = 256 * 1024;
const CEBU_LATITUDE_MIN = 9;
const CEBU_LATITUDE_MAX = 12;
const CEBU_LONGITUDE_MIN = 122;
const CEBU_LONGITUDE_MAX = 125;
const CEBU_OFFSET_MS = 8 * 60 * 60 * 1000;
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
  const feeders = isObject(value.feeders) && isObject(value.feeders.f) ? { f: value.feeders.f } : null;
  return {
    view: value.view,
    stamp: safeSourceStamp(value.stamp),
    plans: value.plans,
    outages: value.outages,
    ...(feeders ? { feeders } : {}),
  };
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

function perFeederActuals(hourEntries, window) {
  const records = [];
  for (const feeder of window.feeders) {
    let record = null;
    for (let hour = window.startHour; hour <= window.endHour; hour += 1) {
      const byFeeder = hourEntries.get(hour)?.byFeeder;
      if (!isObject(byFeeder) || !Object.hasOwn(byFeeder, feeder)) continue;
      record = rawActual(byFeeder[feeder]);
      if (record) break;
    }
    if (record) records.push({ feeder, record });
  }
  return records;
}

function aggregateActuals(hourEntries, window) {
  const records = [];
  for (let hour = window.startHour; hour <= window.endHour; hour += 1) {
    const record = rawActual(hourEntries.get(hour)?.actual);
    if (record) records.push(record);
  }
  return records;
}

function windowActualDetails(hourEntries, window, nowMs) {
  const perFeeder = perFeederActuals(hourEntries, window);
  if (perFeeder.length) {
    return {
      actual: actualSummary(perFeeder.map(({ record }) => record), 'per-feeder', window.feeders.length, nowMs),
      perFeeder,
    };
  }
  return {
    actual: actualSummary(aggregateActuals(hourEntries, window), 'aggregate', null, nowMs),
    perFeeder: [],
  };
}


function planWindows(date, entries, nowMs, outputBudget, retainMapContext = false) {
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
          if (outputBudget) {
            if (outputBudget.count >= MAX_FYI_OUTPUT_WINDOWS) throw new Error('FYI output windows exceeded the collection limit');
            outputBudget.count += 1;
          }
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
      const actualDetails = windowActualDetails(entries, window, nowMs);
      return {
        start: dateAtHour(date, window.startHour),
        end: dateAtHour(date, window.endHour + 1),
        hours: window.endHour - window.startHour + 1,
        feederCount: window.feeders.length,
        actual: actualDetails.actual,
        ...(retainMapContext ? { mapContext: { feeders: window.feeders, actualDetails } } : {}),
      };
    });
}

function normalizedPlan(plan) {
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
  return entries.size ? { value: { id, date, entries }, malformed: false } : { value: null, malformed: true };
}

function summarizePlan(plan, nowMs, outputBudget) {
  const normalized = normalizedPlan(plan);
  if (!normalized.value) return normalized;
  const { id, date, entries } = normalized.value;
  const windows = planWindows(date, entries, nowMs, outputBudget);
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

function cebuDate(nowMs, daysAhead = 0) {
  const local = new Date(nowMs + CEBU_OFFSET_MS + daysAhead * 24 * 60 * 60 * 1000);
  return parseDate([
    local.getUTCFullYear(),
    String(local.getUTCMonth() + 1).padStart(2, '0'),
    String(local.getUTCDate()).padStart(2, '0'),
  ].join('-'));
}

function normalizedCloud(value) {
  if (!isObject(value) || !Array.isArray(value.c) || value.c.length !== 2 || !Array.isArray(value.p)) return null;
  const [latitude, longitude] = value.c;
  const { p } = value;
  if (
    !Number.isFinite(latitude)
    || !Number.isFinite(longitude)
    || latitude < CEBU_LATITUDE_MIN
    || latitude > CEBU_LATITUDE_MAX
    || longitude < CEBU_LONGITUDE_MIN
    || longitude > CEBU_LONGITUDE_MAX
    || !p.length
    || p.length % 2
    || p.length / 2 > MAX_FYI_MAP_POINT_PAIRS_PER_CLOUD
  ) return null;

  const bounds = { south: Infinity, west: Infinity, north: -Infinity, east: -Infinity };
  for (let index = 0; index < p.length; index += 2) {
    const latitudeDelta = p[index];
    const longitudeDelta = p[index + 1];
    if (!Number.isSafeInteger(latitudeDelta) || !Number.isSafeInteger(longitudeDelta)) return null;
    const pointLatitude = latitude + latitudeDelta / 100_000;
    const pointLongitude = longitude + longitudeDelta / 100_000;
    if (
      pointLatitude < CEBU_LATITUDE_MIN
      || pointLatitude > CEBU_LATITUDE_MAX
      || pointLongitude < CEBU_LONGITUDE_MIN
      || pointLongitude > CEBU_LONGITUDE_MAX
    ) return null;
    bounds.south = Math.min(bounds.south, pointLatitude);
    bounds.west = Math.min(bounds.west, pointLongitude);
    bounds.north = Math.max(bounds.north, pointLatitude);
    bounds.east = Math.max(bounds.east, pointLongitude);
  }
  return { cloud: { c: [latitude, longitude], p: [...p] }, pointPairs: p.length / 2, bounds };
}

function mapClouds(feederKeys, rawClouds) {
  const clouds = [];
  const byFeeder = new Map();
  const bounds = { south: Infinity, west: Infinity, north: -Infinity, east: -Infinity };
  let pointPairs = 0;
  let malformed = 0;

  for (const feeder of feederKeys) {
    if (!isObject(rawClouds) || !Object.hasOwn(rawClouds, feeder)) continue;
    const cloud = normalizedCloud(rawClouds[feeder]);
    if (!cloud) {
      malformed += 1;
      continue;
    }
    if (clouds.length >= MAX_FYI_MAP_CLOUDS) throw new Error('FYI map clouds exceeded the collection limit');
    if (pointPairs + cloud.pointPairs > MAX_FYI_MAP_POINT_PAIRS) {
      throw new Error('FYI map point pairs exceeded the collection limit');
    }
    pointPairs += cloud.pointPairs;
    byFeeder.set(feeder, clouds.length);
    clouds.push(cloud.cloud);
    bounds.south = Math.min(bounds.south, cloud.bounds.south);
    bounds.west = Math.min(bounds.west, cloud.bounds.west);
    bounds.north = Math.max(bounds.north, cloud.bounds.north);
    bounds.east = Math.max(bounds.east, cloud.bounds.east);
  }
  return { clouds, byFeeder, bounds: clouds.length ? bounds : null, malformed };
}

function isFreshOpen(record, nowMs) {
  return !record.end && record.start.milliseconds <= nowMs && nowMs - record.start.milliseconds <= ONGOING_MAX_MS;
}

const MAP_OPERATOR_STATE_PRIORITY = {
  none: 0,
  restored: 1,
  stale: 2,
  aggregate: 3,
  'per-feeder': 4,
};

function mapOperatorState(actual) {
  if (!actual) return 'none';
  if (actual.ongoing) return actual.coverage === 'per-feeder' ? 'per-feeder' : 'aggregate';
  if (actual.stale) return 'stale';
  return actual.state === 'restored' ? 'restored' : 'none';
}

function mergeMapWindows(mapWindows, nowMs) {
  const merged = new Map();
  for (const { window } of mapWindows) {
    const key = `${window.start}\0${window.end}`;
    let current = merged.get(key);
    if (!current) {
      current = {
        start: window.start,
        end: window.end,
        feeders: new Set(),
        confirmedFeeders: new Map(),
        operatorState: 'none',
      };
      merged.set(key, current);
    }

    const { feeders, actualDetails } = window.mapContext;
    for (const feeder of feeders) current.feeders.add(feeder);
    const operatorState = mapOperatorState(actualDetails.actual);
    if (MAP_OPERATOR_STATE_PRIORITY[operatorState] > MAP_OPERATOR_STATE_PRIORITY[current.operatorState]) {
      current.operatorState = operatorState;
    }

    if (actualDetails.actual?.coverage !== 'per-feeder') continue;
    for (const { feeder, record } of actualDetails.perFeeder) {
      if (!isFreshOpen(record, nowMs)) continue;
      const confirmedUntil = record.start.milliseconds + ONGOING_MAX_MS;
      const previous = current.confirmedFeeders.get(feeder);
      if (previous === undefined || confirmedUntil < previous) current.confirmedFeeders.set(feeder, confirmedUntil);
    }
  }

  return [...merged.values()].map((window) => ({
    start: window.start,
    end: window.end,
    feeders: [...window.feeders].sort(),
    confirmedFeeders: [...window.confirmedFeeders].sort(([left], [right]) => left.localeCompare(right)),
    operatorState: window.operatorState,
  }));
}

function summarizeMapWindow(window, byFeeder) {
  const cloudIndexes = window.feeders.map((feeder) => byFeeder.get(feeder)).filter((index) => index !== undefined);
  const confirmedCloudIndexes = [];
  let confirmedUntil = null;
  for (const [feeder, expiresAt] of window.confirmedFeeders) {
    const index = byFeeder.get(feeder);
    if (index === undefined) continue;
    confirmedCloudIndexes.push(index);
    if (confirmedUntil === null || expiresAt < confirmedUntil) confirmedUntil = expiresAt;
  }
  return {
    start: window.start,
    end: window.end,
    feederCount: window.feeders.length,
    cloudIndexes,
    confirmedCloudIndexes,
    confirmedUntil: confirmedUntil === null ? null : new Date(confirmedUntil).toISOString(),
    operatorState: window.operatorState,
  };
}

function serializedByteLength(value) {
  const text = JSON.stringify(value);
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * Reduce FYI's optional feeder point clouds to non-identifying supplemental map data.
 * Only the current and following Cebu calendar day are represented.
 */
export function summarizeFyiMap(boot, { nowMs = Date.now() } = {}) {
  const publicData = publicBoot(boot);
  if (!Number.isFinite(nowMs)) throw new Error('FYI map summary requires a valid current time');
  const today = cebuDate(nowMs);
  const tomorrow = cebuDate(nowMs, 1);
  if (!today || !tomorrow) throw new Error('FYI map summary requires a valid current time');
  assertFyiBudgets(publicData);

  const mapWindows = [];
  let malformedPlans = 0;
  for (const plan of publicData.plans) {
    const normalized = normalizedPlan(plan);
    if (normalized.malformed) {
      malformedPlans += 1;
      continue;
    }
    if (!normalized.value || (normalized.value.date.value !== today.value && normalized.value.date.value !== tomorrow.value)) continue;
    const windows = planWindows(normalized.value.date, normalized.value.entries, nowMs, null, true);
    for (const window of windows) mapWindows.push({ id: normalized.value.id, window });
  }

  mapWindows.sort((left, right) => (
    left.window.start.localeCompare(right.window.start)
    || left.window.end.localeCompare(right.window.end)
    || left.id.localeCompare(right.id)
  ));
  const normalizedWindows = mergeMapWindows(mapWindows, nowMs);
  if (normalizedWindows.length > MAX_FYI_OUTPUT_WINDOWS) throw new Error('FYI output windows exceeded the collection limit');

  const feederKeys = [...new Set(normalizedWindows.flatMap((window) => window.feeders))].sort();
  const geometry = mapClouds(feederKeys, publicData.feeders?.f);
  const warnings = [];
  if (malformedPlans) warnings.push(`Skipped ${malformedPlans} malformed FYI ${malformedPlans === 1 ? 'plan' : 'plans'}`);
  if (geometry.malformed) warnings.push(`Skipped ${geometry.malformed} malformed FYI map ${geometry.malformed === 1 ? 'cloud' : 'clouds'}`);

  const source = sourceMetadata(publicData.stamp);
  const result = {
    sourceStamp: source.sourceStamp,
    freshness: source.freshness,
    bounds: geometry.bounds,
    clouds: geometry.clouds,
    windows: normalizedWindows
      .map((window) => summarizeMapWindow(window, geometry.byFeeder))
      .filter((window) => window.cloudIndexes.length),
    warnings,
  };
  if (serializedByteLength(result) > MAX_FYI_MAP_OUTPUT_BYTES) throw new Error('FYI map output exceeded the size limit');
  return result;
}
