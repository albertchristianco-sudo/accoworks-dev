import { FYI_MAX_INPUT_BYTES } from '../../src/scripts/fyi.mjs';

const FYI_BOOTSTRAP = 'https://script.google.com/macros/s/AKfycbwryIwtUJgnOrCWYlXhEeDnxOm2lg-C_Ji9CREsjKjUvLsrQCroX-QvgBeLR_qtgQbggw/exec';
const FYI_EDGE_TTL = 60;
const FYI_TIMEOUT_MS = 8_000;
export const FYI_ROUTE_TTL = 60;
export const FYI_USER_AGENT = 'Mozilla/5.0 (compatible; accoworks.dev outage tracker; +https://accoworks.dev/power)';

export const FYI_ENVELOPE_CACHE_KEYS = Object.freeze({
  summary: 'fyi-summary-v1',
  map: 'fyi-map-v1',
});

const envelopeFlights = new Map();

function edgeCache() {
  try {
    return globalThis.caches?.default || null;
  } catch {
    return null;
  }
}

function cacheRequest(key) {
  return new Request(`https://accoworks.dev/__edge-cache/${key}`);
}

/**
 * Cache a normalized, input-free FYI endpoint envelope. Cache API failures are optional:
 * the producer still supplies a safe response, and concurrent requests share one producer.
 */
export async function cacheFyiEnvelope(key, producer, { waitUntil } = {}) {
  if (key !== FYI_ENVELOPE_CACHE_KEYS.summary && key !== FYI_ENVELOPE_CACHE_KEYS.map) {
    throw new Error('Unknown FYI envelope cache key');
  }

  const inFlight = envelopeFlights.get(key);
  if (inFlight) return (await inFlight).clone();

  const responsePromise = (async () => {
    const cache = edgeCache();
    const request = cacheRequest(key);
    if (cache) {
      try {
        const cached = await cache.match(request);
        if (cached) return cached;
      } catch {
        // Cache API is opportunistic; live normalization remains available.
      }
    }

    const response = await producer();
    if (!(response instanceof Response)) throw new Error('FYI envelope producer must return a response');

    if (cache) {
      try {
        const write = Promise.resolve(cache.put(request, response.clone())).catch(() => undefined);
        if (typeof waitUntil === 'function') waitUntil(write);
        await write;
      } catch {
        // Cache API is opportunistic; the normalized response is still valid.
      }
    }
    return response;
  })();
  envelopeFlights.set(key, responsePromise);

  try {
    return (await responsePromise).clone();
  } finally {
    if (envelopeFlights.get(key) === responsePromise) envelopeFlights.delete(key);
  }
}

async function responseTextWithin(response, maxBytes) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('FYI response exceeded the size limit');
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error('FYI response exceeded the size limit');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function fetchFyiText() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FYI_TIMEOUT_MS);
  try {
    const response = await fetch(FYI_BOOTSTRAP, {
      headers: { 'user-agent': FYI_USER_AGENT, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1' },
      signal: controller.signal,
      cf: { cacheTtl: FYI_EDGE_TTL, cacheEverything: true },
    });
    if (!response.ok) throw new Error(`FYI responded ${response.status}`);
    return await responseTextWithin(response, FYI_MAX_INPUT_BYTES);
  } catch (error) {
    if (controller.signal.aborted) throw new Error('FYI request timed out');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
