// Pages Function: the rotational-brownout log that /power merges with the scraped
// advisories.
//
//   GET  /api/rotational                 -> { updated, source, items[] }
//   POST /api/rotational  { text, source, replace? }
//        Authorization: Bearer <ROTATIONAL_TOKEN>
//                                        -> { stored, items[], warnings[] }
//   DELETE /api/rotational (same auth)   -> clears the log
//
// Facebook has no readable public feed for VECO's page — mbasic and m.facebook both
// answer an anonymous fetch with a login wall — so these advisories are pasted in from
// /power/update and parsed server-side. Stored in KV so a paste is live in seconds with
// no rebuild or deploy.
//
// Bindings: REACTIONS (existing KV namespace), ROTATIONAL_TOKEN (secret).

import { parseAdvisoryText } from '../../src/scripts/veco-post.mjs';

export const KEY = 'rotational:current';
const MAX_TEXT = 24 * 1024;
const KEEP_DAYS = 3;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

const authorized = (request, env) => {
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
  const { items, warnings } = parseAdvisoryText(text, { source });
  if (!items.length) return json({ error: 'nothing parsed', warnings }, 422);

  // Each paste is an hourly update of the same advisory: keep older slots, replace any
  // slot that repeats, and drop what is more than a few days old.
  const previous = body.replace ? [] : (await readLog(env)).items;
  const merged = new Map();
  for (const item of [...previous, ...items]) {
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
