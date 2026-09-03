#!/usr/bin/env python3
"""Poll Visayan Electric's Facebook page into accoworks.dev/power.

    veco-poll.py [--dry-run] [--force] [--selftest]

VECO publishes rotational-brownout schedules only on Facebook, and Facebook answers
datacenter IPs (Cloudflare included) with a login redirect, so nothing on the site
itself can read them. From a residential Cebu IP an anonymous GET of the desktop page
still returns the newest post prefetched as JSON, which is what this script harvests
and hands to the existing POST /api/rotational parser unchanged.

Every cycle also writes PUT /api/rotational-health so /power can admit when the feed
has not been read, and pings healthchecks.io so a dead box is noticed by someone other
than the box. Stdlib only: this runs on uther-mini with no virtualenv to rot.

Environment: ROTATIONAL_TOKEN (required unless --dry-run), HEALTHCHECKS_URL (optional),
ROTATIONAL_ORIGIN (default https://accoworks.dev), VECO_STATE_DIR.
"""

import argparse
import gzip
import json
import os
import random
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

PAGE_URL = 'https://www.facebook.com/visayanelectriccompany/'
MARKER = 'timeline_list_feed_units'
FETCH_TIMEOUT = 30
PING_TIMEOUT = 10
PHT = timezone(timedelta(hours=8))

# Variant 1 of the three header sets in the plan: an honest identifying UA (same string
# as functions/api/outages.js) plus the Accept pair a browser sends. Facebook's observed
# rules: a Chrome UA *without* matching sec-ch-ua/Sec-Fetch-* client hints gets HTTP 400,
# and omitting Accept gets HTTP 200 with a post-free shell. So if this set ever stops
# yielding MARKER, swap this dict wholesale — variant 2 is curl's default UA with the
# same two Accept headers, variant 3 is RSS-Bridge's full Chromium set (Chrome 131 UA +
# sec-ch-ua, sec-ch-ua-mobile, sec-ch-ua-platform, Sec-Fetch-Dest/Mode/Site/User,
# Upgrade-Insecure-Requests). Never mix half of one with half of another.
UA = 'Mozilla/5.0 (compatible; accoworks.dev outage tracker; +https://accoworks.dev/power)'
HEADERS = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip',
}

SCRIPT_JSON = re.compile(r'<script type="application/json"[^>]*>(.*?)</script>', re.S)
ADVISORY = re.compile(r'rotational|brownout', re.I)

ORIGIN = os.environ.get('ROTATIONAL_ORIGIN', 'https://accoworks.dev').rstrip('/')
TOKEN = os.environ.get('ROTATIONAL_TOKEN', '')
HEALTHCHECKS_URL = os.environ.get('HEALTHCHECKS_URL', '')
STATE_DIR = Path(os.environ.get('VECO_STATE_DIR') or Path.home() / '.local/state/veco-poll')
STATE_FILE = STATE_DIR / 'state.json'
JITTER_SEC = float(os.environ.get('POLL_JITTER_SEC') or 0)


# --- Facebook ---------------------------------------------------------------------

def fetch_page(url=PAGE_URL):
    """The page HTML. Raises on anything that is not a 200 body we can decode."""
    request = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(request, timeout=FETCH_TIMEOUT) as response:
        if response.status != 200:
            raise RuntimeError(f'HTTP {response.status}')
        raw = response.read()
        if response.headers.get('Content-Encoding') == 'gzip':
            raw = gzip.decompress(raw)
    return raw.decode('utf-8', 'replace')


def find_first(root, key):
    """First value for `key` in depth-first document order, or None (RSS-Bridge's findFirst)."""
    stack = [root]
    while stack:
        current = stack.pop()
        if isinstance(current, dict):
            if key in current:
                return current[key]
            stack.extend(reversed(list(current.values())))
        elif isinstance(current, list):
            stack.extend(reversed(current))
    return None


def extract_latest(html):
    """The prefetched newest post as {post_id, creation_time, url, text, pinned}, or None.

    Deliberately the same shape as RSS-Bridge's FacebookBridge so that when Meta shifts
    the markup, their fix is readable as ours.
    """
    # ponytail: json.loads of the ~400 KB block is well under 100 ms, so no need for the
    # regex-on-substring shortcut; reach for that only if uther-mini ever complains.
    blocks = [body for body in SCRIPT_JSON.findall(html) if MARKER in body]
    if not blocks:
        return None
    try:
        block = json.loads(max(blocks, key=len))
    except ValueError:
        return None

    units = find_first(block, MARKER)
    edges = units.get('edges') if isinstance(units, dict) else None
    if not edges or not isinstance(edges[0], dict):
        return None
    node = edges[0].get('node')
    if not isinstance(node, dict):
        return None

    text = None
    stack = [node]
    while stack:
        current = stack.pop()
        if isinstance(current, dict):
            message = current.get('message')
            if isinstance(message, dict) and isinstance(message.get('text'), str):
                text = message['text']
                break
            stack.extend(reversed(list(current.values())))
        elif isinstance(current, list):
            stack.extend(reversed(current))

    post_id = node.get('post_id')
    creation_time = node.get('creation_time')
    if not post_id or not creation_time or not text:
        return None

    return {
        'post_id': str(post_id),
        'creation_time': int(creation_time),
        'url': find_first(node, 'wwwURL') or f'{PAGE_URL}posts/{post_id}',
        'text': text,
        'pinned': find_first(block, 'profile_pinned_post') is not None,
    }


def is_advisory(text):
    # NFKC folds VECO's math-bold headings (𝐑𝐎𝐓𝐀𝐓𝐈𝐎𝐍𝐀𝐋) down to ASCII, so no fold table.
    return bool(ADVISORY.search(unicodedata.normalize('NFKC', text)))


def posted_at(creation_time):
    return datetime.fromtimestamp(creation_time, PHT).isoformat()


# --- accoworks.dev ----------------------------------------------------------------

def call(method, path, body):
    """(status, body_dict). Never raises: a dead network is an outcome, not a crash."""
    request = urllib.request.Request(
        f'{ORIGIN}{path}',
        method=method,
        data=json.dumps(body).encode('utf-8'),
        # Cloudflare answers the default Python-urllib signature with error 1010 ("banned
        # browser"), so the poller names itself instead of shipping urllib's UA.
        headers={
            'authorization': f'Bearer {TOKEN}',
            'content-type': 'application/json',
            'user-agent': UA,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=FETCH_TIMEOUT) as response:
            return response.status, json.loads(response.read().decode('utf-8', 'replace'))
    except urllib.error.HTTPError as error:
        try:
            return error.code, json.loads(error.read().decode('utf-8', 'replace'))
        except ValueError:
            return error.code, {}
    except Exception as error:  # noqa: BLE001 - timeouts, DNS, TLS, malformed JSON
        return 0, {'error': str(error)}


def post_advisory(text, source, at):
    return call('POST', '/api/rotational', {
        'text': text,
        'source': source,
        'postedAt': at,
        'via': 'auto',
    })


def put_health(result, **fields):
    body = {'result': result}
    body.update({key: value for key, value in fields.items() if value is not None})
    return call('PUT', '/api/rotational-health', body)


def ping(suffix='', body=''):
    """Best effort by design: monitoring must never be the reason the job fails."""
    if not HEALTHCHECKS_URL:
        return
    try:
        data = body.encode('utf-8')[:10000] if body else None
        request = urllib.request.Request(HEALTHCHECKS_URL + suffix, data=data, headers={'user-agent': UA})
        urllib.request.urlopen(request, timeout=PING_TIMEOUT).close()
    except Exception:  # noqa: BLE001
        pass


# --- state ------------------------------------------------------------------------

def load_state():
    try:
        state = json.loads(STATE_FILE.read_text('utf-8'))
    except (OSError, ValueError):
        return {}
    return state if isinstance(state, dict) else {}


def save_state(post):
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps({
        'post_id': post['post_id'],
        'creation_time': post['creation_time'],
        'pinned': post['pinned'],
    }), 'utf-8')


def log(result, post=None, detail=''):
    print(
        f"{datetime.now(PHT).isoformat(timespec='seconds')} result={result} "
        f"post_id={post['post_id'] if post else '-'} "
        f"creation_time={posted_at(post['creation_time']) if post else '-'} "
        f'detail={detail}',
        flush=True,
    )


# --- cycles -----------------------------------------------------------------------

def cycle(force=False):
    try:
        html = fetch_page()
    except Exception as error:  # noqa: BLE001 - every fetch failure is the same outcome
        detail = f'fetch failed: {error}'
        put_health('error', detail=detail[:300])
        ping('/fail', detail)
        log('error', detail=detail)
        return 1

    post = extract_latest(html)
    if post is None:
        # HTTP 200 is not success: Facebook serves a post-free shell when it wants to.
        detail = 'no timeline node'
        put_health('error', detail=detail)
        ping('/fail', detail)
        log('error', detail=detail)
        return 1

    at = posted_at(post['creation_time'])
    health = {'latestPostId': post['post_id'], 'latestPostAt': at, 'pinned': post['pinned']}

    # A heartbeat that never reached Cloudflare is not a check. Reporting success on it
    # would let the site go stale with the dead-man's switch still showing green, so the
    # outcome of put_health decides the outcome of the cycle.
    if post['post_id'] == load_state().get('post_id') and not force:
        status, body = put_health('unchanged', **health)
        if status != 200:
            return fail_cycle(post, status, body)
        ping()
        log('unchanged', post)
        return 0

    if not is_advisory(post['text']):
        status, body = put_health('skipped', detail='not an advisory', **health)
        if status != 200:
            return fail_cycle(post, status, body)
        save_state(post)
        ping()
        log('skipped', post, 'not an advisory')
        return 0

    status, body = post_advisory(post['text'], post['url'], at)

    if status == 200:
        detail = f"{body.get('added')} slots, {body.get('stored')} live"
        put_health('stored', detail=detail, **health)
        save_state(post)
        ping()
        log('stored', post, detail)
        return 0

    if status == 422:
        # The parser saw the post and could not use it. Saving state stops us re-alerting
        # every 15 minutes; the permalink is on /power/update for a hand paste.
        detail = '; '.join(body.get('warnings') or [body.get('error', 'nothing parsed')])[:300]
        put_health('rejected', detail=detail, **health)
        save_state(post)
        ping('/fail', detail)
        log('rejected', post, detail)
        return 0

    detail = f'rotational {status}' if status else f"rotational unreachable: {body.get('error')}"
    put_health('error', detail=detail[:300])
    ping('/fail', detail)
    log('error', post, detail)
    return 1


def fail_cycle(post, status, body):
    """A cycle that could not reach accoworks.dev: alert, and leave state for a retry."""
    detail = f'health {status}' if status else f"health unreachable: {body.get('error')}"
    ping('/fail', detail)
    log('error', post, detail)
    return 1


def dry_run():
    post = extract_latest(fetch_page())
    if post is None:
        print('no timeline node: Facebook served a page without the prefetched post')
        return 1
    print(f"post_id: {post['post_id']}")
    print(f"creation_time: {post['creation_time']} ({posted_at(post['creation_time'])})")
    print(f"url: {post['url']}")
    print(f"pinned: {post['pinned']}")
    print(f"text length: {len(post['text'])}")
    print(f"is_advisory: {is_advisory(post['text'])}")
    print(f"text[:200]: {post['text'][:200]}")
    return 0


# --- selftest ---------------------------------------------------------------------

def selftest():
    """The one runnable check: extraction against a payload shaped like the real one."""
    bold = '\U0001d411\U0001d40e\U0001d413\U0001d400\U0001d413\U0001d408\U0001d40e\U0001d40d\U0001d400\U0001d40b'  # ROTATIONAL
    node = {
        'post_id': '1535618865260397',
        'creation_time': 1788413370,
        'profile_pinned_post': None,
        'comet_sections': {'content': {'story': {
            'wwwURL': 'https://www.facebook.com/visayanelectriccompany/posts/pfbid02NyKz',
            'comet_sections': {'message': {'story': {
                'message': {'text': f'\U0001f504 {bold} BROWNOUT: 1:00PM-3:30PM, Cebu City' + ' filler.' * 60},
            }}},
        }}},
    }
    decoy = {'require': [['ScheduledServerJS', 'handle', None, [{'no': 'posts here'}]]]}
    stale = {'timeline_list_feed_units': {'edges': [{'node': {
        'post_id': '1', 'creation_time': 1, 'message': {'text': 'older, smaller block'},
    }}]}}
    html = (
        f'<html><head><script type="application/json" data-sjs>{json.dumps(decoy)}</script>'
        f'<script type="application/json" data-sjs>{json.dumps(stale)}</script>'
        '<script type="application/json" data-content-len="1" data-sjs>'
        + json.dumps({'require': [['RelayPrefetchedStreamCache', 'next', [], [
            {'__bbox': {'result': {'data': {'node': {
                'timeline_list_feed_units': {'edges': [{'node': node}]},
            }}}}},
        ]]]})
        + '</script></head><body>ignored</body></html>'
    )

    post = extract_latest(html)
    assert post is not None, 'extract_latest found no post in the synthetic payload'
    assert post['post_id'] == '1535618865260397', post['post_id']
    assert post['creation_time'] == 1788413370, post['creation_time']
    assert post['url'].endswith('pfbid02NyKz'), post['url']
    assert post['text'].endswith('filler.'), post['text'][-40:]
    assert post['pinned'] is False, post['pinned']
    assert posted_at(post['creation_time']).startswith('2026-09-03T13:29'), posted_at(post['creation_time'])

    assert extract_latest('<html>no script blocks</html>') is None
    assert extract_latest(f'<script type="application/json">{{"{MARKER}":{{}}}}</script>') is None

    assert is_advisory(f'{bold} BROWNOUT STATUS'), 'NFKC fold of math-bold ROTATIONAL failed'
    assert is_advisory('Possible rotational interruptions')
    assert not is_advisory('Pay your bill online')

    print('ok')
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--dry-run', action='store_true',
                        help='fetch and print the newest post; no calls to accoworks.dev')
    parser.add_argument('--force', action='store_true', help='ignore the stored post_id once')
    parser.add_argument('--selftest', action='store_true', help='check the extractor and exit')
    args = parser.parse_args()

    if args.selftest:
        return selftest()
    if args.dry_run:
        return dry_run()
    if not TOKEN:
        print('ROTATIONAL_TOKEN is not set', file=sys.stderr)
        return 1
    # systemd has RandomizedDelaySec; launchd's StartInterval does not, so the jitter that
    # keeps every cycle off the exact quarter hour lives here when POLL_JITTER_SEC is set.
    if JITTER_SEC > 0:
        time.sleep(random.uniform(0, JITTER_SEC))
    return cycle(force=args.force)


if __name__ == '__main__':
    sys.exit(main())
