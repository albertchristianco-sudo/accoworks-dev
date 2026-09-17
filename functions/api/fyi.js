// Pages Function: optional compact AboitizPower FYI supplement for /power.
//
// GET /api/fyi -> bounded FYI summary envelope. This route accepts no user input.

import { addDays, manilaDate } from '../../src/scripts/outages.mjs';
import { emptyFyi, parseFyiResponse, summarizeFyiBoot } from '../../src/scripts/fyi.mjs';
import {
  cacheFyiEnvelope,
  fetchFyiText,
  FYI_ENVELOPE_CACHE_KEYS,
  FYI_ROUTE_TTL,
} from './fyi-source.js';

const PAST_DAYS = 1;
const FUTURE_DAYS = 14;
const UNAVAILABLE_WARNING = 'AboitizPower FYI is unavailable';

function json(data) {
  return new Response(JSON.stringify(data), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${FYI_ROUTE_TTL}`,
    },
  });
}

function unavailableFyi(checkedAt) {
  return {
    ...emptyFyi(checkedAt),
    warnings: [UNAVAILABLE_WARNING],
  };
}

async function summarizeCurrentFyi() {
  const today = manilaDate();
  const window = {
    from: addDays(today, -PAST_DAYS),
    to: addDays(today, FUTURE_DAYS),
  };

  try {
    const text = await fetchFyiText();
    const nowMs = Date.now();
    const summary = summarizeFyiBoot(parseFyiResponse(text), { ...window, nowMs });
    return json({
      ...emptyFyi(new Date(nowMs).toISOString()),
      available: true,
      ...summary,
    });
  } catch {
    return json(unavailableFyi(new Date(Date.now()).toISOString()));
  }
}

export async function onRequestGet({ waitUntil } = {}) {
  return cacheFyiEnvelope(FYI_ENVELOPE_CACHE_KEYS.summary, summarizeCurrentFyi, { waitUntil });
}
