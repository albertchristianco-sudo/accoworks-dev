// Pages Function: Techisland Phase 1 brief intake form, backed by Workers KV (REACTIONS binding).
//
//   POST /api/techisland-intake   body { name, geofence, contactsMode, contacts,
//                                         devicesHave, devicesMix, incentives, notes, company }
//     -> { ok, id }
//
// Append-only. Each submission is stored under techisland:intake:<ISO>-<rand>.
// No public read endpoint: submissions can contain staff contact details, so they are
// read only from an authenticated machine via `wrangler kv key get`. Same-origin only.

const MAX_FIELD = 8000;
const MAX_TOTAL_BYTES = 64 * 1024;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function clean(v) {
  if (typeof v !== 'string') return '';
  return v.slice(0, MAX_FIELD).trim();
}

function pick(v, allowed, fallback) {
  return allowed.includes(v) ? v : fallback;
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad body' }, 400);
  }

  // Honeypot: bots fill hidden "company" field. Pretend success, store nothing.
  if (clean(body?.company)) return json({ ok: true, id: null });

  const record = {
    id: `${new Date().toISOString()}-${Math.random().toString(36).slice(2, 8)}`,
    submittedAt: new Date().toISOString(),
    name: clean(body?.name) || 'Unnamed',
    geofence: clean(body?.geofence),
    contactsMode: pick(body?.contactsMode, ['spreadsheet', 'typed'], 'spreadsheet'),
    contacts: clean(body?.contacts),
    devicesHave: pick(body?.devicesHave, ['yes', 'most', 'no'], ''),
    devicesMix: pick(body?.devicesMix, ['android', 'iphone', 'mixed'], ''),
    incentives: clean(body?.incentives),
    notes: clean(body?.notes),
    meta: {
      ua: (request.headers.get('user-agent') || '').slice(0, 400),
      country: request.headers.get('cf-ipcountry') || '',
    },
  };

  const payload = JSON.stringify(record);
  if (payload.length > MAX_TOTAL_BYTES) return json({ error: 'too large' }, 413);

  await env.REACTIONS.put(`techisland:intake:${record.id}`, payload);
  return json({ ok: true, id: record.id });
}

// Explicitly refuse reads over HTTP. Retrieval is via authenticated wrangler only.
export async function onRequestGet() {
  return json({ error: 'not available' }, 405);
}
