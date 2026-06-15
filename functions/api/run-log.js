// Pages Function: training-log sync for /running, backed by Workers KV (REACTIONS binding).
//
//   POST /api/run-log   body { code, data }   -> { ok, updated }     stores runlog:<code>
//   GET  /api/run-log?code=<code>             -> { updated, data } | { data: null }
//
// `code` is a long random per-device secret generated in the browser (never committed,
// never in the static page source). It is the only guard, so it must be unguessable.
// Same-origin only (the page lives on accoworks.dev), so no CORS headers are needed.

const CODE_RE = /^[A-Za-z0-9_-]{12,64}$/;
const MAX_BYTES = 256 * 1024;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function keyFor(code) {
  return `runlog:${code}`;
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code') || '';
  if (!CODE_RE.test(code)) return json({ error: 'bad code' }, 400);
  const raw = await env.REACTIONS.get(keyFor(code));
  if (!raw) return json({ data: null });
  try {
    return json(JSON.parse(raw));
  } catch {
    return json({ data: null });
  }
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad body' }, 400);
  }

  const code = typeof body?.code === 'string' ? body.code : '';
  if (!CODE_RE.test(code)) return json({ error: 'bad code' }, 400);

  const data = body?.data;
  if (data == null) return json({ error: 'no data' }, 400);

  const payload = JSON.stringify({ updated: new Date().toISOString(), data });
  if (payload.length > MAX_BYTES) return json({ error: 'too large' }, 413);

  await env.REACTIONS.put(keyFor(code), payload);
  return json({ ok: true, updated: JSON.parse(payload).updated });
}
