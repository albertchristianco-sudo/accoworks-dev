// Pages Function: how the rotational-brownout ingestion is doing.
//
//   GET /api/rotational-health          -> the record below (all-null when unset)
//   PUT /api/rotational-health
//       Authorization: Bearer <ROTATIONAL_TOKEN>
//       { result, latestPostId?, latestPostAt?, detail?, pinned? }
//                                       -> { ok: true, health }
//
// The poller on uther-mini writes here every cycle, whether or not the post held anything
// new, so /power can say when Facebook was last read instead of implying silence means
// "no brownouts". An 'error' result deliberately does not advance checkedAt: a failed
// fetch is not a check, and pretending otherwise would hide a dead poller.
//
// Bindings: REACTIONS (existing KV namespace), ROTATIONAL_TOKEN (secret).

import { authorized, json } from './rotational.js';

export const HEALTH_KEY = 'rotational:health';
const RESULTS = ['stored', 'unchanged', 'skipped', 'rejected', 'error'];
const MAX_DETAIL = 300;

const EMPTY = {
  checkedAt: null,
  latestPostId: null,
  latestPostAt: null,
  result: null,
  detail: '',
  pinned: false,
  lastErrorAt: null,
};

export async function readHealth(env) {
  if (!env.REACTIONS) return { ...EMPTY };
  const raw = await env.REACTIONS.get(HEALTH_KEY);
  if (!raw) return { ...EMPTY };
  try {
    const health = JSON.parse(raw);
    return {
      checkedAt: health.checkedAt || null,
      latestPostId: health.latestPostId || null,
      latestPostAt: health.latestPostAt || null,
      result: health.result || null,
      detail: health.detail || '',
      pinned: Boolean(health.pinned),
      lastErrorAt: health.lastErrorAt || null,
    };
  } catch {
    return { ...EMPTY };
  }
}

/**
 * Write one health record. `result: 'error'` keeps the previous check and post so
 * staleness stays honest; every other result is a real read of the page, so it advances
 * checkedAt and carries the previous error stamp forward for the admin view.
 */
export async function writeHealth(env, { result, latestPostId, latestPostAt, detail, pinned }) {
  if (!env.REACTIONS) return { ...EMPTY };
  const now = new Date().toISOString();
  const previous = await readHealth(env);
  const health = result === 'error'
    ? { ...previous, detail: detail || '', lastErrorAt: now }
    : {
      checkedAt: now,
      latestPostId: latestPostId || previous.latestPostId,
      latestPostAt: latestPostAt || previous.latestPostAt,
      result,
      detail: detail || '',
      pinned: Boolean(pinned),
      lastErrorAt: previous.lastErrorAt,
    };
  await env.REACTIONS.put(HEALTH_KEY, JSON.stringify(health));
  return health;
}

export async function onRequestGet({ env }) {
  return json(await readHealth(env || {}));
}

export async function onRequestPut({ request, env }) {
  const allowed = authorized(request, env);
  if (allowed === null) return json({ error: 'ROTATIONAL_TOKEN is not set on this project' }, 503);
  if (!allowed) return json({ error: 'bad token' }, 401);
  if (!env.REACTIONS) return json({ error: 'KV namespace is not bound' }, 503);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'expected a JSON body' }, 400);
  }

  const result = String(body.result || '');
  if (!RESULTS.includes(result)) return json({ error: `result must be one of ${RESULTS.join(', ')}` }, 400);

  const latestPostId = body.latestPostId ? String(body.latestPostId) : '';
  if (latestPostId && !/^\d{1,40}$/.test(latestPostId)) {
    return json({ error: 'latestPostId must be up to 40 digits' }, 400);
  }
  const latestPostAt = body.latestPostAt ? String(body.latestPostAt) : '';
  if (latestPostAt && !Number.isFinite(Date.parse(latestPostAt))) {
    return json({ error: 'latestPostAt must be an ISO date' }, 400);
  }
  const detail = String(body.detail || '').trim().slice(0, MAX_DETAIL);
  const health = await writeHealth(env, {
    result,
    latestPostId,
    latestPostAt,
    detail,
    pinned: body.pinned,
  });
  return json({ ok: true, health });
}
