// Pages Function: bounded OpenStreetMap Standard tile proxy for the supplemental Cebu map.

const CACHE_PREFIX = 'https://accoworks.dev/__edge-cache/osm-tiles-v1/';
const DEFAULT_CACHE_CONTROL = 'public, max-age=604800';
const MAX_TILE_BYTES = 512 * 1024;
const OSM_ORIGIN = 'https://tile.openstreetmap.org';
const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const ROUTE_PREFIX = '/api/osm-tiles/';
const TILE_TIMEOUT_MS = 5_000;
const USER_AGENT = 'accoworks.dev OSM tile proxy (+https://accoworks.dev/power/; ac@accoworks.dev)';

// Covers Cebu Island and its immediately adjacent urban area, with enough margin for normal pans.
const CEBU_TILE_BOUNDS = Object.freeze({ south: 9.2, west: 122.8, north: 11.5, east: 124.3 });

function edgeCache() {
  try {
    return globalThis.caches?.default || null;
  } catch {
    return null;
  }
}

function failed(status) {
  return new Response(status === 404 ? 'Not found' : 'Tile unavailable', {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'text/plain; charset=utf-8',
      'x-content-type-options': 'nosniff',
    },
  });
}

function normalizePath(value) {
  if (Array.isArray(value)) {
    if (value.length !== 3 || value.some((segment) => typeof segment !== 'string' || segment.includes('/'))) return null;
    value = value.join('/');
  }
  if (typeof value !== 'string') return null;

  const match = /^(8|9|10|11|12)\/(0|[1-9]\d*)\/(0|[1-9]\d*)\.png$/.exec(value);
  if (!match) return null;

  return {
    path: value,
    x: Number(match[2]),
    y: Number(match[3]),
    z: Number(match[1]),
  };
}

function tileX(longitude, zoom) {
  return Math.floor(((longitude + 180) / 360) * (2 ** zoom));
}

function tileY(latitude, zoom) {
  const radians = latitude * Math.PI / 180;
  return Math.floor(((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * (2 ** zoom));
}

function intersectsCebu({ x, y, z }) {
  const maxCoordinate = (2 ** z) - 1;
  if (x > maxCoordinate || y > maxCoordinate) return false;

  const minX = tileX(CEBU_TILE_BOUNDS.west, z);
  const maxX = tileX(CEBU_TILE_BOUNDS.east, z);
  const minY = tileY(CEBU_TILE_BOUNDS.north, z);
  const maxY = tileY(CEBU_TILE_BOUNDS.south, z);
  return x >= minX && x <= maxX && y >= minY && y <= maxY;
}

function requestedTile({ request, params } = {}) {
  const tile = normalizePath(params?.path);
  if (!tile || !intersectsCebu(tile)) return null;
  if (!request || typeof request.url !== 'string') return null;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return null;
  }
  if (url.search || url.pathname !== `${ROUTE_PREFIX}${tile.path}`) return null;
  return tile;
}

function upstreamUrl({ path }) {
  return `${OSM_ORIGIN}/${path}`;
}

function cacheRequest({ path }) {
  return new Request(`${CACHE_PREFIX}${path}`);
}

function cacheHeaders(upstreamHeaders) {
  const headers = new Headers({
    'content-type': 'image/png',
    'x-content-type-options': 'nosniff',
  });
  const cacheControl = upstreamHeaders.get('cache-control');
  const expires = upstreamHeaders.get('expires');
  if (cacheControl) headers.set('cache-control', cacheControl);
  else if (expires) headers.set('expires', expires);
  else headers.set('cache-control', DEFAULT_CACHE_CONTROL);
  if (expires && cacheControl) headers.set('expires', expires);
  return headers;
}

function shouldStore(headers) {
  return !/(?:^|,)\s*(?:no-store|private)\s*(?:,|$)/i.test(headers.get('cache-control') || '');
}

function declaredLengthWithin(headers) {
  const value = headers.get('content-length');
  if (value === null) return true;
  return /^\d+$/.test(value) && Number(value) <= MAX_TILE_BYTES;
}

function hasPngSignature(buffer) {
  if (buffer.byteLength < PNG_SIGNATURE.byteLength) return false;
  const bytes = new Uint8Array(buffer, 0, PNG_SIGNATURE.byteLength);
  return PNG_SIGNATURE.every((value, index) => bytes[index] === value);
}

async function fetchTile(tile) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TILE_TIMEOUT_MS);
  try {
    const upstream = await fetch(upstreamUrl(tile), {
      headers: {
        accept: 'image/png',
        referer: 'https://accoworks.dev/power/',
        'user-agent': USER_AGENT,
      },
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
    });
    if (!upstream.ok || upstream.status !== 200 || upstream.redirected || !declaredLengthWithin(upstream.headers)) throw new Error('unusable tile response');
    if ((upstream.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase() !== 'image/png') throw new Error('unusable tile response');

    const body = await upstream.arrayBuffer();
    if (body.byteLength > MAX_TILE_BYTES || !hasPngSignature(body)) throw new Error('unusable tile response');
    return new Response(body, { headers: cacheHeaders(upstream.headers), status: 200 });
  } finally {
    clearTimeout(timeout);
  }
}

async function cacheTile(cache, key, response, waitUntil) {
  if (!cache || !shouldStore(response.headers)) return;
  try {
    const write = Promise.resolve(cache.put(key, response.clone())).catch(() => undefined);
    if (typeof waitUntil === 'function') waitUntil(write);
    await write;
  } catch {
    // The valid tile remains deliverable when the optional edge cache fails.
  }
}

export async function onRequestGet(context = {}) {
  const tile = requestedTile(context);
  if (!tile) return failed(404);

  const cache = edgeCache();
  const key = cacheRequest(tile);
  if (cache) {
    try {
      const cached = await cache.match(key);
      if (cached) return cached;
    } catch {
      // Cache API failures must not prevent a bounded live tile fetch.
    }
  }

  try {
    const response = await fetchTile(tile);
    await cacheTile(cache, key, response, context.waitUntil);
    return response;
  } catch {
    return failed(502);
  }
}
