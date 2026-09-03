// Pages Function: the rotational-brownout log that /power merges with the scraped
// advisories.
//
//   GET  /api/rotational                 -> { updated, source, items[] }
//   POST /api/rotational  { text, source, replace?, postedAt?, via? }
//        Authorization: Bearer <ROTATIONAL_TOKEN>
//                                        -> { stored, items[], warnings[] }
//   DELETE /api/rotational (same auth)   -> clears the log
//
// Rotational advisories only exist as Facebook posts, so the text arrives either from the
// poller on uther-mini (scripts/veco-poll.py) or from a paste on /power/update, and is
// parsed server-side either way. The poller cannot live here: Facebook answers datacenter
// egress — Cloudflare included — with a 302 to its login wall, and only serves the post
// JSON to a residential IP. Stored in KV so an update is live in seconds with no deploy.
//
// Bindings: REACTIONS (existing KV namespace), ROTATIONAL_TOKEN (secret).

import { parseAdvisoryText } from '../../src/scripts/veco-post.mjs';

export const KEY = 'rotational:current';
const MAX_TEXT = 24 * 1024;
const KEEP_DAYS = 3;

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export const authorized = (request, env) => {
  const token = env.ROTATIONAL_TOKEN;
  if (!token) return null; // not configured
  const header = request.headers.get('authorization') || '';
  return header === `Bearer ${token}`;
};

export async function readLog(env) {
  if (!env.REACTIONS) return { updated: null, source: '', items: [] };
  const raw = await env.REACTIONS.get(KEY);
  if (!raw) return { updated: null, source: '', items: [] };
  try {
    const log = JSON.parse(raw);
    return { updated: log.updated || null, source: log.source || '', items: log.items || [] };
  } catch {
    return { updated: null, source: '', items: [] };
  }
}

export async function onRequestGet({ env }) {
  return json(await readLog(env));
}

export async function onRequestPost({ request, env }) {
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

  const text = String(body.text || '');
  if (!text.trim()) return json({ error: 'paste the advisory text' }, 400);
  if (text.length > MAX_TEXT) return json({ error: 'that text is too long' }, 413);

  const source = String(body.source || '').trim().slice(0, 500);

  // Provenance travels with the text: 'auto' is the uther-mini poller, 'paste' is a human
  // on /power/update, and postedAt is when VECO posted it (not when we ingested it).
  const postedAt = body.postedAt ? String(body.postedAt) : '';
  if (postedAt && !Number.isFinite(Date.parse(postedAt))) {
    return json({ error: 'postedAt must be an ISO date' }, 400);
  }
  const via = body.via === undefined ? 'paste' : String(body.via);
  if (via !== 'auto' && via !== 'paste') return json({ error: 'via must be auto or paste' }, 400);

  const { items, warnings } = parseAdvisoryText(text, { source });
  if (!items.length) return json({ error: 'nothing parsed', warnings }, 422);

  // Each update repeats the same advisory hour by hour: keep older slots, replace any
  // slot that repeats, and drop what is more than a few days old.
  const stamped = items.map((item) => ({ ...item, via, postedAt: postedAt || null }));
  const previous = body.replace ? [] : (await readLog(env)).items;
  const merged = new Map();
  for (const item of [...previous, ...stamped]) {
    merged.set(`${item.date}|${item.start}|${item.end}|${item.area}`, item);
  }
  const floor = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
  const kept = [...merged.values()].filter((item) => item.date >= floor).sort(
    (a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`),
  );

  const log = { updated: new Date().toISOString(), source, items: kept };
  await env.REACTIONS.put(KEY, JSON.stringify(log));
  return json({ stored: kept.length, added: items.length, items: kept, warnings });
}

export async function onRequestDelete({ request, env }) {
  const allowed = authorized(request, env);
  if (allowed === null) return json({ error: 'ROTATIONAL_TOKEN is not set on this project' }, 503);
  if (!allowed) return json({ error: 'bad token' }, 401);
  if (env.REACTIONS) await env.REACTIONS.delete(KEY);
  return json({ stored: 0, items: [] });
}
