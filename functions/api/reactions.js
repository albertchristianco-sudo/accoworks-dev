// Pages Function: like counter for field notes, backed by Workers KV.
// GET  /api/reactions?slug=<slug>            -> { likes }
// POST /api/reactions  body { slug, action } -> { likes }   action: "like" | "unlike"

const SLUG_RE = /^[a-z0-9-]{1,80}$/;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function keyFor(slug) {
  return `likes:${slug}`;
}

async function readCount(env, slug) {
  const raw = await env.REACTIONS.get(keyFor(slug));
  const n = Number.parseInt(raw ?? '0', 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const slug = url.searchParams.get('slug') || '';
  if (!SLUG_RE.test(slug)) return json({ error: 'bad slug' }, 400);
  return json({ likes: await readCount(env, slug) });
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad body' }, 400);
  }

  const slug = typeof body?.slug === 'string' ? body.slug : '';
  const action = body?.action;
  if (!SLUG_RE.test(slug)) return json({ error: 'bad slug' }, 400);
  if (action !== 'like' && action !== 'unlike') return json({ error: 'bad action' }, 400);

  const current = await readCount(env, slug);
  const next = action === 'unlike' ? Math.max(0, current - 1) : current + 1;
  await env.REACTIONS.put(keyFor(slug), String(next));
  return json({ likes: next });
}
