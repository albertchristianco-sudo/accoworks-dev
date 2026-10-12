#!/usr/bin/env node
// Fails the build when any built page loads the React runtime.
//
// @astrojs/react is registered so islands can be added later, but a page that
// does not use an island must ship zero React. This script:
//   1. scans dist/_astro/*.js for React runtime signatures,
//   2. scans every dist/**/*.html for script tags (and astro-island renderers),
//      follows local module imports transitively,
//   3. exits 1 if any page reaches a React chunk.
//
// Usage: node scripts/check-no-react.mjs [distDir]
// Pages that are allowed to hydrate a React island go in ALLOWED_PAGES
// (paths relative to dist, e.g. 'some-page/index.html').

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const ALLOWED_PAGES = new Set([]);

const REACT_SIGNATURES = [
  'react.transitional.element',
  'Symbol.for("react.element")',
  "Symbol.for('react.element')",
  '__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE',
  '__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED',
  '__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE',
  'hydrateRoot',
  'react-dom',
];

export function findReactSignature(source) {
  return REACT_SIGNATURES.find((signature) => source.includes(signature));
}

function walk(dir, predicate, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, predicate, out);
    else if (predicate(full)) out.push(full);
  }
  return out;
}

function localTarget(distDir, fromFile, specifier) {
  if (/^(?:[a-z]+:)?\/\//i.test(specifier) || specifier.startsWith('data:')) return null;
  const clean = specifier.split(/[?#]/)[0];
  if (!clean.endsWith('.js') && !clean.endsWith('.mjs')) return null;
  const target = clean.startsWith('/')
    ? join(distDir, clean)
    : resolve(dirname(fromFile), clean);
  return target.startsWith(distDir + sep) && existsSync(target) ? target : null;
}

const IMPORT_PATTERN = /(?:import|export)\s*(?:[^'"`;]*?from\s*)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

function scriptGraphHasReact(distDir, entry, seen = new Map()) {
  if (seen.has(entry)) return seen.get(entry);
  seen.set(entry, null);
  const source = readFileSync(entry, 'utf8');
  let hit = findReactSignature(source) ? relative(distDir, entry) : null;
  if (!hit) {
    for (const match of source.matchAll(IMPORT_PATTERN)) {
      const target = localTarget(distDir, entry, match[1] ?? match[2]);
      if (!target) continue;
      const nested = scriptGraphHasReact(distDir, target, seen);
      if (nested) { hit = nested; break; }
    }
  }
  seen.set(entry, hit);
  return hit;
}

export function checkDist(distDir) {
  const root = resolve(distDir);
  if (!existsSync(root)) throw new Error(`No build output at ${root}. Run npm run build first.`);

  const astroDir = join(root, '_astro');
  const reactChunks = existsSync(astroDir)
    ? readdirSync(astroDir)
        .filter((name) => name.endsWith('.js'))
        .filter((name) => findReactSignature(readFileSync(join(astroDir, name), 'utf8')))
    : [];

  const problems = [];
  const pages = walk(root, (file) => file.endsWith('.html'));
  for (const page of pages) {
    const pagePath = relative(root, page).split(sep).join('/');
    if (ALLOWED_PAGES.has(pagePath)) continue;
    const html = readFileSync(page, 'utf8');

    if (/<astro-island\b[^>]*renderer-url="[^"]*react/i.test(html)) {
      problems.push(`${pagePath}: hydrates a React island`);
      continue;
    }

    for (const tag of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      const [, attrs, body] = tag;
      const src = attrs.match(/\bsrc=["']([^"']+)["']/i)?.[1];
      if (src) {
        const target = localTarget(root, page, src);
        const hit = target && scriptGraphHasReact(root, target);
        if (hit) problems.push(`${pagePath}: loads ${src} which reaches React (${hit})`);
      } else if (body.trim()) {
        if (findReactSignature(body)) {
          problems.push(`${pagePath}: inline script contains React runtime code`);
          continue;
        }
        for (const match of body.matchAll(IMPORT_PATTERN)) {
          const target = localTarget(root, page, match[1] ?? match[2]);
          const hit = target && scriptGraphHasReact(root, target);
          if (hit) problems.push(`${pagePath}: inline script imports React (${hit})`);
        }
      }
    }

    for (const link of html.matchAll(/<link\b[^>]*rel=["']modulepreload["'][^>]*>/gi)) {
      const href = link[0].match(/\bhref=["']([^"']+)["']/i)?.[1];
      const target = href && localTarget(root, page, href);
      const hit = target && scriptGraphHasReact(root, target);
      if (hit) problems.push(`${pagePath}: preloads ${href} which reaches React (${hit})`);
    }
  }

  return { pages: pages.length, reactChunks, problems };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const distDir = process.argv[2] ?? 'dist';
  try {
    const { pages, reactChunks, problems } = checkDist(distDir);
    if (reactChunks.length) {
      console.log(`React runtime chunks present in _astro (not loaded unless listed below): ${reactChunks.join(', ')}`);
    }
    if (problems.length) {
      console.error(`check:no-react failed. ${problems.length} page(s) load React:`);
      for (const problem of problems) console.error(`  ${problem}`);
      process.exit(1);
    }
    console.log(`check:no-react passed: ${pages} HTML pages scanned, none load React.`);
  } catch (error) {
    console.error(`check:no-react failed: ${error.message}`);
    process.exit(1);
  }
}
