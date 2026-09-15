// Pages Function: Cebu power outage feed for /power.
//
//   GET /api/outages -> { updated, window, entries[], posts[], sources[] }
//
// Reads Visayan Electric's official Service Interruption Calendar first. Their weekly
// advisory posts remain a fallback when that calendar is unavailable, while hand-logged
// rotational brownouts from src/data/rotational.mjs still supplement either source. No API
// key, no storage: upstream VECO fetches are edge-cached (EDGE_TTL below), so a page load
// costs VECO nothing most of the time. This response itself is not edge-cached — see the
// headers at the bottom.

import {
  parsePost,
  slugRange,
  manilaDate,
  addDays,
  fromManual,
  mergeOutageEntries,
  parseCalendarGviz,
  sortEntries,
  VECO_CALENDAR_SOURCE,
  VECO_CALENDAR_TITLE,
} from '../../src/scripts/outages.mjs';
import { readLog } from './rotational.js';
import { readHealth } from './rotational-health.js';

const SITEMAP = 'https://www.visayanelectric.com/blog-posts-sitemap.xml';
const POST_PREFIX = 'https://www.visayanelectric.com/post/';
const CALENDAR_FEED = 'https://docs.google.com/spreadsheets/d/1rRq3A_2gFf0n68THzBVf6IYkHiSrhl1ZA6yOe50bp8o/gviz/tq?tqx=out:json';
const UA = 'Mozilla/5.0 (compatible; accoworks.dev outage tracker; +https://accoworks.dev/power)';
const EDGE_TTL = 900; // 15 minutes: advisories change a few times a day at most.
const MAX_POSTS = 3;
const PAST_DAYS = 1;
const FUTURE_DAYS = 14;

const SOURCES = [
  { label: VECO_CALENDAR_TITLE, url: VECO_CALENDAR_SOURCE },
  { label: 'Visayan Electric advisories', url: 'https://www.visayanelectric.com/newsroom-blog' },
  { label: 'Visayan Electric on Facebook', url: 'https://www.facebook.com/visayanelectriccompany' },
];

async function fetchText(url, accept = 'text/html,application/xml') {
  const response = await fetch(url, {
    headers: { 'user-agent': UA, accept },
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
    calendar: { available: false, checkedAt: null, count: 0, skipped: 0 },
  };
  let primaryEntries = [];

  try {
    const parsed = parseCalendarGviz(await fetchText(CALENDAR_FEED, 'application/json,text/javascript;q=0.9,*/*;q=0.1'));
    const checkedAt = new Date().toISOString();
    payload.calendar = {
      available: true,
      checkedAt,
      count: parsed.entries.length,
      skipped: parsed.skipped,
    };
    payload.posts.push({
      title: VECO_CALENDAR_TITLE,
      url: VECO_CALENDAR_SOURCE,
      start: payload.window.from,
      end: payload.window.to,
      count: parsed.entries.length,
    });
    primaryEntries = parsed.entries;
    if (parsed.skipped) payload.warnings.push(`Skipped ${parsed.skipped} malformed calendar ${parsed.skipped === 1 ? 'row' : 'rows'}`);
  } catch (error) {
    payload.warnings.push(`Calendar source unavailable: ${error.message}`);
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
        primaryEntries.push(...entries);
      });
    } catch (fallbackError) {
      payload.warnings.push(`Advisory source unavailable: ${fallbackError.message}`);
    }
  }

  // Rotational brownouts can be received before either published source updates, so KV
  // remains a supplement. Calendar entries are passed first to make them win duplicates.
  const log = await readLog(env || {});
  payload.rotationalUpdated = log.updated;
  payload.ingest = await readHealth(env || {});
  const manualEntries = [];
  for (const item of log.items) {
    const entry = fromManual(item);
    if (entry) manualEntries.push(entry);
    else payload.warnings.push(`Skipped malformed rotational entry for ${item.date || 'unknown date'}`);
  }

  const lower = `${payload.window.from}T00:00:00+08:00`;
  const upper = `${addDays(payload.window.to, 1)}T00:00:00+08:00`;
  payload.entries = sortEntries(
    mergeOutageEntries(primaryEntries, manualEntries).filter(
      (entry) => entry.end >= lower && entry.start < upper,
    ),
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
