// Pages Function: Cebu power outage feed for /power.
//
//   GET /api/outages -> { updated, window, entries[], posts[], sources[] }
//
// Reads Visayan Electric's own weekly advisory posts (their Wix blog renders the
// schedule as real HTML tables), normalizes them, and merges the hand-logged
// rotational brownouts from src/data/rotational.mjs. No API key, no storage: the upstream
// VECO fetches are edge-cached (EDGE_TTL below), so a page load costs VECO nothing most of
// the time. This response itself is not edge-cached — see the headers at the bottom.

import {
  parsePost,
  slugRange,
  manilaDate,
  addDays,
  fromManual,
  sortEntries,
} from '../../src/scripts/outages.mjs';
import { readLog } from './rotational.js';
import { readHealth } from './rotational-health.js';

const SITEMAP = 'https://www.visayanelectric.com/blog-posts-sitemap.xml';
const POST_PREFIX = 'https://www.visayanelectric.com/post/';
const UA = 'Mozilla/5.0 (compatible; accoworks.dev outage tracker; +https://accoworks.dev/power)';
const EDGE_TTL = 900; // 15 minutes: advisories change a few times a day at most.
const MAX_POSTS = 3;
const PAST_DAYS = 1;
const FUTURE_DAYS = 14;

const SOURCES = [
  { label: 'Visayan Electric advisories', url: 'https://www.visayanelectric.com/newsroom-blog' },
  { label: 'Visayan Electric on Facebook', url: 'https://www.facebook.com/visayanelectriccompany' },
];

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'text/html,application/xml' },
    cf: { cacheTtl: EDGE_TTL, cacheEverything: true },
  });
  if (!response.ok) throw new Error(`${url} responded ${response.status}`);
  return response.text();
}

function advisorySlugs(sitemapXml) {
  const slugs = [];
  for (const match of sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const url = match[1].trim();
    if (!url.startsWith(POST_PREFIX)) continue;
    const slug = url.slice(POST_PREFIX.length).replace(/\/$/, '');
    const range = slugRange(slug);
    if (range) slugs.push({ slug, url, ...range });
  }
  return slugs;
}

// Advisories that still overlap the window we care about, soonest first.
function relevantPosts(slugs, today) {
  const from = addDays(today, -PAST_DAYS);
  const to = addDays(today, FUTURE_DAYS);
  return slugs
    .filter((post) => post.end >= from && post.start <= to)
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, MAX_POSTS);
}

function titleOf(html, fallback) {
  const match = /<title>([^<]*)<\/title>/i.exec(html);
  return match ? match[1].replace(/\s*\|\s*Visayan Electric\s*$/i, '').trim() : fallback;
}

export async function onRequestGet({ env }) {
  const today = manilaDate();
  const payload = {
    updated: new Date().toISOString(),
    window: { from: addDays(today, -PAST_DAYS), to: addDays(today, FUTURE_DAYS), today },
    sources: SOURCES,
    posts: [],
    entries: [],
    warnings: [],
  };

  try {
    const posts = relevantPosts(advisorySlugs(await fetchText(SITEMAP)), today);
    const fetched = await Promise.allSettled(posts.map((post) => fetchText(post.url)));

    fetched.forEach((result, index) => {
      const post = posts[index];
      if (result.status !== 'fulfilled') {
        payload.warnings.push(`Could not read ${post.slug}`);
        return;
      }
      const title = titleOf(result.value, post.slug);
      const entries = parsePost(result.value, { url: post.url, title });
      payload.posts.push({ title, url: post.url, start: post.start, end: post.end, count: entries.length });
      payload.entries.push(...entries);
    });
  } catch (error) {
    payload.warnings.push(`Advisory source unavailable: ${error.message}`);
  }

  // Rotational brownouts come from Facebook — the uther-mini poller or a paste on
  // /power/update — and land in KV; they change by the hour, so freshness here matters
  // more than caching. ingest says when Facebook was last read, so the page can admit it
  // may be missing an update instead of implying all-clear.
  const log = await readLog(env || {});
  payload.rotationalUpdated = log.updated;
  payload.ingest = await readHealth(env || {});
  for (const item of log.items) {
    const entry = fromManual(item);
    if (entry) payload.entries.push(entry);
    else payload.warnings.push(`Skipped malformed rotational entry for ${item.date || 'unknown date'}`);
  }

  payload.entries = sortEntries(payload.entries).filter(
    (entry) => entry.end >= `${payload.window.from}T00:00:00+08:00`,
  );

  // max-age=60 is browser-only and load-bearing: /power refetches this feed on tab focus
  // and on repeat navigations, so a minute of freshness keeps those off the wire. No
  // s-maxage — Pages Functions are not edge-cached without an explicit cache rule (every
  // live response comes back cf-cache-status: DYNAMIC with no age), so advertising a shared
  // TTL would describe a cache that does not exist. Only the upstream fetches are cached.
  return new Response(JSON.stringify(payload), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=60',
      'access-control-allow-origin': '*',
    },
  });
}
