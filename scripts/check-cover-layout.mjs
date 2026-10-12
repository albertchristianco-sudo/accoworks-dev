#!/usr/bin/env node
// Browser check of the home cover layout on phones, tablets and desktops.
//
// The source contract in tests/ui-contract.test.mjs says the cover keeps its own
// twelve columns; this script proves the rendered result in headless Chrome, so
// a collapse like the round 4 one (the cover inherited the one-column phone grid,
// "Ac" squeezed to zero width, the nav and name stacked one word per line, the
// roundel on top of the masthead) fails here. It needs a real Chrome, which CI
// does not have, so it is not part of npm test: run it after npm run build.
//
// It serves dist/ itself on a free local port and closes the server when done.
// For every viewport, with reduced motion and with motion at the top of the page:
//   1. the cover has 12 computed grid tracks, each wider than 0px,
//   2. the "Ac" masthead glyphs are wider than 100px,
//   3. the name line wraps to 4 lines or fewer,
//   4. the cover nav items sit on one row,
//   5. the race roundel (if shown) overlaps neither the masthead glyphs nor the
//      lead cover line and its dek.
//
// Usage: node scripts/check-cover-layout.mjs [distDir]
// Chrome: CHROME_PATH, else /usr/bin/google-chrome (run with --no-sandbox).

import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { chromium } from 'playwright-core';

const VIEWPORTS = [[360, 640], [390, 844], [760, 900], [768, 1024], [1024, 768], [1366, 768], [1440, 900]];
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.xml': 'application/xml', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json',
};

function serve(root) {
  const server = createServer((req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = resolve(join(root, path));
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server)));
}

// Runs in the page.
function measureCover() {
  const textRects = (el) => {
    if (!el) return [];
    const range = document.createRange();
    range.selectNodeContents(el);
    return [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
  };
  const union = (rects) => rects.length && {
    left: Math.min(...rects.map((r) => r.left)), right: Math.max(...rects.map((r) => r.right)),
    top: Math.min(...rects.map((r) => r.top)), bottom: Math.max(...rects.map((r) => r.bottom)),
  };
  const cover = document.querySelector('.cover');
  const tracks = getComputedStyle(cover).gridTemplateColumns.split(' ').map(parseFloat);
  const mast = union(textRects(document.querySelector('.masthead')));
  const nameSpan = document.querySelector('.cover__name span');
  // An inline span returns one client rect per line box.
  const nameLines = new Set([...nameSpan.getClientRects()].map((r) => Math.round(r.top))).size;
  const navTops = [...document.querySelectorAll('.cover .nav li')].map((li) => Math.round(li.getBoundingClientRect().top));
  const flash = document.querySelector('.flash');
  let roundel = null;
  if (flash && getComputedStyle(flash).display !== 'none') {
    // The roundel is a rotated circle: its centre and radius, plus the 3px ink ring.
    const box = flash.getBoundingClientRect();
    roundel = { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2, r: flash.offsetWidth / 2 + 3 };
  }
  const lead = [...textRects(document.querySelector('.coverline--lead a')), ...textRects(document.querySelector('.coverline--lead .coverline__dek'))];
  return { tracks, mastWidth: mast ? mast.right - mast.left : 0, mast, nameLines, navTops, roundel, lead };
}

function circleHitsRect(c, r) {
  const x = Math.max(r.left, Math.min(c.x, r.right));
  const y = Math.max(r.top, Math.min(c.y, r.bottom));
  return (c.x - x) ** 2 + (c.y - y) ** 2 < c.r ** 2;
}

function coverProblems(m) {
  const problems = [];
  if (m.tracks.length !== 12) problems.push(`cover has ${m.tracks.length} grid tracks, expected 12`);
  if (m.tracks.some((t) => !(t > 0))) problems.push(`a cover track is 0px wide (${m.tracks.map((t) => t.toFixed(0)).join(' ')})`);
  if (!(m.mastWidth > 100)) problems.push(`masthead glyphs are ${m.mastWidth.toFixed(1)}px wide, expected > 100px`);
  if (m.nameLines > 4) problems.push(`name line wraps to ${m.nameLines} lines, expected <= 4`);
  if (new Set(m.navTops).size > 1) problems.push(`cover nav wraps to ${new Set(m.navTops).size} rows`);
  if (m.roundel) {
    if (m.mast && circleHitsRect(m.roundel, m.mast)) problems.push('roundel overlaps the masthead');
    if (m.lead.some((r) => circleHitsRect(m.roundel, r))) problems.push('roundel overlaps the lead cover line');
  }
  return problems;
}

async function main() {
  const root = resolve(process.argv[2] ?? 'dist');
  if (!existsSync(join(root, 'index.html'))) throw new Error(`No build at ${root}. Run npm run build first.`);
  const server = await serve(root);
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  let failures = 0;
  try {
    for (const [width, height] of VIEWPORTS) {
      for (const reducedMotion of ['reduce', 'no-preference']) {
        const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion });
        const page = await context.newPage();
        await page.goto(base, { waitUntil: 'load' });
        await page.evaluate(() => document.fonts.ready);
        const m = await page.evaluate(measureCover);
        await context.close();
        const problems = coverProblems(m);
        failures += problems.length;
        const summary = `tracks ${m.tracks.length}, masthead ${m.mastWidth.toFixed(0)}px, name ${m.nameLines} lines, nav rows ${new Set(m.navTops).size}, roundel ${m.roundel ? 'shown' : 'none'}`;
        console.log(`${problems.length ? 'FAIL' : 'ok  '} ${width}x${height} motion=${reducedMotion}: ${summary}`);
        for (const problem of problems) console.log(`       ${problem}`);
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures) {
    console.error(`check:cover failed with ${failures} problem(s).`);
    process.exit(1);
  }
  console.log(`check:cover passed: ${VIEWPORTS.length} viewports, with and without motion.`);
}

main().catch((error) => {
  console.error(`check:cover failed: ${error.message}`);
  process.exit(1);
});
