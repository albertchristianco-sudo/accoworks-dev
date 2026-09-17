// Pages Function: optional supplemental FYI feeder point-cloud map for /power.
//
// GET /api/fyi-map -> bounded FYI map envelope. This route accepts no user input.

import { FYI_SOURCE_URL, parseFyiResponse, summarizeFyiMap } from '../../src/scripts/fyi.mjs';
import {
  cacheFyiEnvelope,
  fetchFyiText,
  FYI_ENVELOPE_CACHE_KEYS,
  FYI_ROUTE_TTL,
} from './fyi-source.js';

const ATTRIBUTION = {
  label: '© OpenStreetMap contributors',
  url: 'https://www.openstreetmap.org/copyright',
};
const UNAVAILABLE_WARNING = 'AboitizPower FYI map is unavailable';
const MAX_FYI_MAP_RESPONSE_BYTES = 256 * 1024;

function unavailableFyiMap(checkedAt) {
  return {
    version: 1,
    available: false,
    checkedAt,
    sourceStamp: null,
    freshness: 'unknown',
    sourceUrl: FYI_SOURCE_URL,
    attribution: ATTRIBUTION,
    bounds: null,
    clouds: [],
    windows: [],
    warnings: [UNAVAILABLE_WARNING],
  };
}

function jsonText(body) {
  return new Response(body, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${FYI_ROUTE_TTL}`,
    },
  });
}

function json(data) {
  return jsonText(JSON.stringify(data));
}

function utf8ByteLength(text) {
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

function renderableSummary(summary) {
  const { bounds, clouds, windows } = summary;
  return Boolean(
    bounds
    && ['south', 'west', 'north', 'east'].every((key) => Number.isFinite(bounds[key]))
    && Array.isArray(clouds)
    && clouds.length
    && Array.isArray(windows)
    && windows.some(({ cloudIndexes }) => (
      Array.isArray(cloudIndexes)
      && cloudIndexes.some((index) => Number.isInteger(index) && index >= 0 && index < clouds.length)
    )),
  );
}

async function createFyiMapEnvelope() {
  const checkedAt = new Date(Date.now()).toISOString();
  try {
    const text = await fetchFyiText();
    const nowMs = Date.now();
    const summary = summarizeFyiMap(parseFyiResponse(text), { nowMs });
    if (!renderableSummary(summary)) return json(unavailableFyiMap(checkedAt));
    const envelope = {
      version: 1,
      available: true,
      checkedAt: new Date(nowMs).toISOString(),
      sourceStamp: summary.sourceStamp,
      freshness: summary.freshness,
      sourceUrl: FYI_SOURCE_URL,
      attribution: ATTRIBUTION,
      bounds: summary.bounds,
      clouds: summary.clouds,
      windows: summary.windows,
      warnings: summary.warnings,
    };
    const body = JSON.stringify(envelope);
    return utf8ByteLength(body) <= MAX_FYI_MAP_RESPONSE_BYTES
      ? jsonText(body)
      : json(unavailableFyiMap(checkedAt));
  } catch {
    return json(unavailableFyiMap(checkedAt));
  }
}

export async function onRequestGet({ waitUntil } = {}) {
  return cacheFyiEnvelope(FYI_ENVELOPE_CACHE_KEYS.map, createFyiMapEnvelope, { waitUntil });
}
