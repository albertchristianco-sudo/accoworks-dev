// Pages Function: remote coaching intake. Emails each submission to ac@accoworks.dev
// via the Resend API.
//
//   POST /api/coaching  body { name, email, experience, training, goal, why, company }
//     -> { ok } | { error }
//
// Secrets: RESEND_API_KEY (Resend secret) and RESEND_FROM (verified sender) come from
// the Pages project environment via the `env` binding. Nothing is stored server-side;
// the submission only travels in the email.

const MAX_BODY_BYTES = 32 * 1024;
const MAX_FIELD = 2200;
const EXPERIENCE_LEVELS = ['Beginner', 'Intermediate', 'Advanced', 'Competitive athlete'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const IP_LIMIT = 5;
const IP_WINDOW_SECONDS = 3600;

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

// Per-IP cap on the shared KV namespace. Best effort: KV trouble must never
// block a legitimate applicant, so failures fall through to "allowed".
async function overIpLimit(env, ip) {
  if (!env.REACTIONS || !ip) return false;
  const key = `coaching:ip:${ip}`;
  try {
    const count = Number.parseInt((await env.REACTIONS.get(key)) ?? '0', 10) || 0;
    if (count >= IP_LIMIT) return true;
    await env.REACTIONS.put(key, String(count + 1), { expirationTtl: IP_WINDOW_SECONDS });
  } catch (err) {
    console.error('coaching intake: ip guard unavailable', err);
  }
  return false;
}

export async function onRequest(context) {
  if (context.request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  return handlePost(context);
}

async function handlePost({ request, env }) {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: 'Request too large.' }, 413);

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'Bad request body.' }, 400);
  }

  // Honeypot: bots fill the hidden "company" field. Pretend success, send nothing.
  if (clean(body?.company)) return json({ ok: true });

  const name = clean(body?.name);
  const email = clean(body?.email);
  const experience = EXPERIENCE_LEVELS.includes(body?.experience) ? body.experience : 'Not specified';
  const training = clean(body?.training);
  const goal = clean(body?.goal);
  const why = clean(body?.why);

  if (!name) return json({ error: 'Name is required.' }, 400);
  if (!email) return json({ error: 'Email is required.' }, 400);
  if (!EMAIL_RE.test(email)) return json({ error: 'That email address does not look valid.' }, 400);
  if (!training && !goal) {
    return json({ error: 'Tell me about your current training or your goal, ideally both.' }, 400);
  }

  const ip = request.headers.get('cf-connecting-ip') || '';
  if (await overIpLimit(env, ip)) {
    return json({ error: 'Too many submissions from this connection. Try again later.' }, 429);
  }

  if (!env.RESEND_API_KEY || !env.RESEND_FROM) {
    console.error('coaching intake: RESEND_API_KEY or RESEND_FROM is not configured');
    return json({ error: 'The intake inbox is not available right now. Email ac@accoworks.dev instead.' }, 500);
  }

  const text = [
    `Name: ${name}`,
    `Email: ${email}`,
    `Experience level: ${experience}`,
    '',
    'Current training:',
    training || '(not provided)',
    '',
    'Goal:',
    goal || '(not provided)',
    '',
    'Why me:',
    why || '(not provided)',
    '',
    `Country: ${request.headers.get('cf-ipcountry') || 'unknown'}`,
  ].join('\n');

  let response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: env.RESEND_FROM,
        to: ['ac@accoworks.dev'],
        reply_to: email,
        subject: `Coaching intake: ${name}`,
        text,
      }),
    });
  } catch (err) {
    console.error('coaching intake: Resend request failed', err);
    return json({ error: 'Could not deliver your application. Please try again.' }, 502);
  }

  if (!response.ok) {
    console.error(`coaching intake: Resend responded ${response.status}`);
    return json({ error: 'Could not deliver your application. Please try again.' }, 502);
  }

  return json({ ok: true });
}
