import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { checkDist } from '../scripts/check-no-react.mjs';
import { nextRace, raceDay } from '../src/scripts/next-race.mjs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const exists = (path) => existsSync(new URL(path, root));

// Sunday edition (home, Field Notes, projects, about, contact)
const css = read('src/styles/edition.css');
const layout = read('src/layouts/EditionLayout.astro');
const home = read('src/pages/index.astro');
const cover = read('src/components/edition/Cover.astro');
const nextRaceComponent = read('src/components/edition/NextRace.astro');
const projectsPage = read('src/pages/projects.astro');
const projectsFeature = read('src/components/edition/ProjectsFeature.astro');
const projectsData = read('src/data/projects.ts');
const notes = read('src/pages/field-notes/index.astro');
const post = read('src/pages/field-notes/[slug].astro');
const noteList = read('src/components/edition/NoteList.astro');

// Legacy utility pages (coaching, links, power) stay on BaseLayout + global.css
const legacyCss = read('src/styles/global.css');
const legacyLayout = read('src/layouts/BaseLayout.astro');
const links = read('src/pages/links.astro');

const pkg = JSON.parse(read('package.json'));
const astroConfig = read('astro.config.mjs');

function luminance(hex) {
  const channels = hex.match(/[a-f\d]{2}/gi).map((value) => Number.parseInt(value, 16) / 255);
  const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

const token = (name) => css.match(new RegExp(`--${name}:\\s*#([A-Fa-f0-9]{6})`))?.[1];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

test('self-hosts Gloock and Schibsted Grotesk without Google Fonts', () => {
  assert.match(css, /font-family:\s*'Gloock'[\s\S]*?src:\s*url\('\/fonts\/gloock-latin-400\.woff2'\)/);
  assert.match(css, /font-family:\s*'Schibsted Grotesk'[\s\S]*?src:\s*url\('\/fonts\/schibsted-grotesk-latin-wght\.woff2'\)/);
  assert.match(css, /--display:\s*'Gloock'/);
  assert.match(css, /--text:\s*'Schibsted Grotesk'/);
  assert.ok(exists('public/fonts/gloock-latin-400.woff2'));
  assert.ok(exists('public/fonts/schibsted-grotesk-latin-wght.woff2'));
  assert.match(layout, /rel="preload" href="\/fonts\/gloock-latin-400\.woff2" as="font" type="font\/woff2" crossorigin/);
  for (const source of [css, layout, legacyCss, legacyLayout]) {
    assert.doesNotMatch(source, /Space Mono|fonts\.googleapis|fonts\.gstatic/);
  }
});

test('does not include TechText or React Bits code', () => {
  const files = [...walk(new URL('src', root).pathname), ...walk(new URL('public', root).pathname)];
  assert.deepEqual(files.filter((file) => /techtext|react-?bits/i.test(file)), []);
  for (const file of files.filter((name) => /\.(astro|css|mjs|js|ts|html)$/.test(name))) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /techtext|react-?bits/i, file);
  }
  assert.doesNotMatch(JSON.stringify(pkg), /techtext|react-?bits/i);
});

test('registers @astrojs/react for future islands while pages ship no React', () => {
  assert.ok(pkg.dependencies['@astrojs/react'], '@astrojs/react must be a dependency');
  assert.ok(pkg.dependencies.react && pkg.dependencies['react-dom']);
  assert.match(astroConfig, /import react from '@astrojs\/react'/);
  assert.match(astroConfig, /integrations:\s*\[[^\]]*react\(\)/);
  assert.equal(pkg.scripts['check:no-react'], 'node scripts/check-no-react.mjs dist');
  // No island is used yet, so no page may hydrate a component.
  for (const source of [home, cover, notes, post, projectsPage, layout]) {
    assert.doesNotMatch(source, /client:(load|idle|visible|media|only)/);
  }
  for (const dependency of ['@tsparticles/engine', '@tsparticles/react', '@tsparticles/slim']) {
    assert.equal(pkg.dependencies?.[dependency], undefined, `${dependency} must stay removed`);
  }
  assert.doesNotMatch(home, /Sparkles|hero-sparkles/);
  assert.equal(exists('src/components/Sparkles.tsx'), false);
});

test('check:no-react fails a page that loads React and passes a clean build', () => {
  const dist = mkdtempSync(join(tmpdir(), 'no-react-'));
  try {
    mkdirSync(join(dist, '_astro'));
    mkdirSync(join(dist, 'clean'));
    writeFileSync(join(dist, '_astro', 'client.js'), 'const e=Symbol.for("react.transitional.element");export{e};');
    writeFileSync(join(dist, '_astro', 'page.js'), 'console.log("hi")');
    writeFileSync(join(dist, '_astro', 'island.js'), 'import"./client.js";');
    writeFileSync(join(dist, 'clean', 'index.html'), '<script type="module" src="/_astro/page.js"></script>');
    assert.deepEqual(checkDist(dist).problems, []);

    writeFileSync(join(dist, 'index.html'), '<script type="module" src="/_astro/island.js"></script>');
    const { problems, reactChunks } = checkDist(dist);
    assert.deepEqual(reactChunks, ['client.js']);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /^index\.html: loads \/_astro\/island\.js which reaches React/);
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});

// Island markup exactly as Astro 6 emits it for <Hi client:load n={1} /> with
// @astrojs/react: the renderer URL is a hashed chunk with no "react" in it, and
// the runtime is loaded later through import(this.getAttribute(...)).
const ASTRO_ISLAND_PAGE = '<html><head><style>astro-island,astro-slot,astro-static-slot{display:contents}</style>'
  + '<script>(()=>{var e=async t=>{await(await t())()};(self.Astro||(self.Astro={})).load=e;window.dispatchEvent(new Event("astro:load"));})();</script>'
  + '</head><body><astro-island uid="2uJanX" prefix="r1" component-url="/_astro/Hi.tqv9BQlb.js" component-export="default" '
  + 'renderer-url="/_astro/client.CP0hKK24.js" props="{&quot;n&quot;:[0,1]}" ssr client="load" '
  + 'opts="{&quot;name&quot;:&quot;Hi&quot;,&quot;value&quot;:true}" await-children><b>hi <!-- -->1</b></astro-island></body></html>';

test('check:no-react fails real Astro island markup and passes the clean case', () => {
  const dist = mkdtempSync(join(tmpdir(), 'no-react-island-'));
  try {
    mkdirSync(join(dist, '_astro'));
    writeFileSync(join(dist, '_astro', 'client.CP0hKK24.js'), 'import{h as r}from"./index.Bx1.js";export default r;');
    writeFileSync(join(dist, '_astro', 'index.Bx1.js'), 'const h=()=>{};export{h};var s=Symbol.for("react.transitional.element");');
    writeFileSync(join(dist, '_astro', 'Hi.tqv9BQlb.js'), 'import{j as e}from"./jsx.Cq2.js";export default function(){return e("b",{})}');
    writeFileSync(join(dist, '_astro', 'jsx.Cq2.js'), 'export const j=()=>Symbol.for("react.transitional.element");');
    writeFileSync(join(dist, 'index.html'), '<html><body><main><h1>Clean</h1></main></body></html>');
    const clean = checkDist(dist);
    assert.equal(clean.pages, 1);
    assert.deepEqual(clean.problems, []);

    mkdirSync(join(dist, 'island'));
    writeFileSync(join(dist, 'island', 'index.html'), ASTRO_ISLAND_PAGE);
    const { problems } = checkDist(dist);
    assert.ok(problems.some((p) => /^island\/index\.html: island renderer-url \/_astro\/client\.CP0hKK24\.js reaches React \(_astro\/index\.Bx1\.js\)$/.test(p)), problems.join('\n'));
    assert.ok(problems.some((p) => /^island\/index\.html: island component-url \/_astro\/Hi\.tqv9BQlb\.js reaches React/.test(p)), problems.join('\n'));
    assert.ok(problems.some((p) => /^island\/index\.html: has 1 astro-island\(s\) but is not in ALLOWED_PAGES$/.test(p)), problems.join('\n'));

    // Any island fails outside ALLOWED_PAGES, even one whose chunks are not React.
    writeFileSync(join(dist, '_astro', 'client.CP0hKK24.js'), 'export default ()=>{};');
    writeFileSync(join(dist, '_astro', 'Hi.tqv9BQlb.js'), 'export default ()=>{};');
    assert.deepEqual(checkDist(dist).problems, ['island/index.html: has 1 astro-island(s) but is not in ALLOWED_PAGES']);
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});

test('check:no-react runs from a path with a space and fails on an empty dist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'no react '));
  try {
    const script = join(dir, 'check-no-react.mjs');
    writeFileSync(script, read('scripts/check-no-react.mjs'));
    mkdirSync(join(dir, 'empty dist'));
    const empty = spawnSync(process.execPath, [script, join(dir, 'empty dist')], { encoding: 'utf8' });
    assert.equal(empty.status, 1, empty.stdout + empty.stderr);
    assert.match(empty.stderr, /no HTML pages found/);

    mkdirSync(join(dir, 'dist'));
    writeFileSync(join(dir, 'dist', 'index.html'), '<h1>Clean</h1>');
    const clean = spawnSync(process.execPath, [script, join(dir, 'dist')], { encoding: 'utf8' });
    assert.equal(clean.status, 0, clean.stdout + clean.stderr);
    assert.match(clean.stdout, /check:no-react passed: 1 HTML pages scanned/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uses accessible solid text colors without gradient clipping', () => {
  const muted = legacyCss.match(/--ink-3:\s*#([A-Fa-f0-9]{6})/)?.[1];
  assert.ok(muted, 'legacy muted ink token must exist');
  assert.ok(contrast(muted, 'F5F7FB') >= 4.5, `legacy muted ink contrast is ${contrast(muted, 'F5F7FB').toFixed(2)}:1`);

  const pairs = [
    ['sea', 'paper'],
    ['ink-soft', 'paper'],
    ['ink-sand', 'sand'],
    ['paper', 'hibiscus-deep'],
    ['shallow', 'sea'],
  ];
  for (const [fg, bg] of pairs) {
    const ratio = contrast(token(fg), token(bg));
    assert.ok(ratio >= 4.5, `--${fg} on --${bg} is ${ratio.toFixed(2)}:1`);
  }
  assert.match(css, /\.flash\s*\{[^}]*background:\s*var\(--hibiscus-deep\)/);
  for (const source of [css, legacyCss]) {
    assert.doesNotMatch(source, /background-clip:\s*text|-webkit-text-fill-color:\s*transparent/);
  }
});

test('provides a skip link and a stable main-content target', () => {
  for (const source of [layout, legacyLayout]) {
    assert.match(source, /href="#main-content"[^>]*>\s*Skip to content/);
    assert.match(source, /<main\s+id="main-content"/);
    assert.match(source, /viewport-fit=cover/);
  }
});

test('keeps head essentials and drops the concept preview robots tag', () => {
  for (const tag of [/<link rel="canonical"/, /property="og:image"/, /name="twitter:card"/, /rel="icon"/, /rel="apple-touch-icon"/, /name="theme-color"/, /<meta name="description"/]) {
    assert.match(layout, tag);
  }
  // robots noindex only when a page opts in; no edition page does.
  assert.match(layout, /\{noindex && <meta name="robots"/);
  assert.match(layout, /noindex = false/);
  for (const source of [home, notes, post, projectsPage, read('src/pages/about.astro'), read('src/pages/contact.astro')]) {
    assert.doesNotMatch(source, /noindex|name="robots"/);
  }
});

test('keeps content visible without JavaScript and honours reduced motion', () => {
  assert.doesNotMatch(legacyLayout + layout, /IntersectionObserver|querySelectorAll\('\.reveal/);
  assert.doesNotMatch(legacyCss, /\.reveal\s*\{[^}]*opacity:\s*0/s);
  for (const source of [css, legacyCss]) assert.doesNotMatch(source, /will-change/);

  // Every animation and every hidden reveal state lives inside the motion block.
  const motionStart = css.indexOf('@media (prefers-reduced-motion: no-preference) {\n\n');
  assert.ok(motionStart > 0, 'motion block must exist');
  const base = css.slice(0, motionStart).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(base, /animation(-name|-timeline)?:/);
  assert.doesNotMatch(base, /html\.fx|\.rv\b/);
  const motion = css.slice(motionStart);
  assert.match(motion, /@supports \(animation-timeline: view\(\)\)/);
  assert.match(motion, /html\.fx \.rv/);

  const script = read('src/scripts/edition-motion.js');
  assert.match(script, /prefers-reduced-motion: reduce/);
  assert.match(script, /CSS\.supports\('animation-timeline: view\(\)'\)/);
  assert.match(script, /classList\.add\('fx'\)/);
  assert.doesNotMatch(script + css, /preventDefault|scroll-snap|wheel|lenis|locomotive/i);
});

test('uses responsive modern formats for the above-fold cover photo', () => {
  assert.match(cover, /<picture>/);
  assert.match(cover, /type="image\/avif"/);
  assert.match(cover, /type="image\/webp"/);
  for (const format of ['avif', 'webp']) {
    const srcset = cover.match(new RegExp(`type="image/${format}"\\s+srcset="([^"]+)"`))?.[1] ?? '';
    for (const width of [1280, 1920, 2560]) {
      assert.match(srcset, new RegExp(`/cover-${width}\\.${format} ${width}w`));
    }
  }
  assert.match(cover, /fetchpriority="high"/);
  assert.match(cover, /sizes="[^"]+"/);
  assert.match(cover, /src="\/cover-1280\.webp"/);
  assert.match(cover, /width="2560"\s+height="3396"/);
  assert.doesNotMatch(cover, /placeholder|photo-\d+/);
});

test('gives every edition image alt text and explicit dimensions', () => {
  const sources = [cover, home, post, read('src/components/edition/Profile.astro')];
  for (const source of sources) {
    for (const img of source.matchAll(/<img\b[^>]*>/g)) {
      assert.match(img[0], /\balt="[^"]+"/, img[0]);
      assert.match(img[0], /\bwidth="\d+"/, img[0]);
      assert.match(img[0], /\bheight="\d+"/, img[0]);
    }
  }
});

test('keeps the mobile name line legible over the photo with a solid plate', () => {
  assert.match(cover, /<h1 class="cover__name"><span>/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.cover__name span \{[^}]*background:\s*var\(--sea\)/);
  assert.match(css, /\.cover :focus-visible \{ outline-color: var\(--paper\); \}/);
});

test('builds the cover from real data: newest notes as cover lines and the race roundel', () => {
  assert.match(home, /<Cover slot="cover" notes=\{notes\.slice\(0, 3\)\}/);
  assert.match(home, /const notes = await getNotes\(\)/);
  assert.match(cover, /noteHref\(lead\)/);
  assert.match(cover, /<NextRace \/>/);
  assert.match(nextRaceComponent, /const race = nextRace\(\)/);
  assert.match(nextRaceComponent, /\{race && \(/);
  assert.doesNotMatch(cover + nextRaceComponent, /HYROX Singapore|Singapore EXPO|Nov 28|2026-11-28/);

  const races = JSON.parse(read('src/data/races.json'));
  assert.deepEqual(races, [{ name: 'HYROX Singapore', date: '2026-11-28', venue: 'Singapore EXPO' }]);
  assert.equal(nextRace(races, '2026-10-12')?.name, 'HYROX Singapore');
  assert.equal(nextRace(races, '2026-11-28')?.name, 'HYROX Singapore');
  assert.equal(nextRace(races, '2026-11-29'), undefined);
  assert.equal(raceDay(races[0]), 'Nov 28');
});

test('filters Field Notes by label without JavaScript', () => {
  assert.doesNotMatch(notes, /<script/);
  for (const id of ['f-all', 'f-training', 'f-building', 'f-operating']) assert.match(notes, new RegExp(`id: '${id}'`));
  assert.match(notes, /type="radio" name="label"/);
  assert.match(notes, /<NoteList notes=\{notes\} labelled/);
  assert.match(noteList, /data-label=\{labelled \? note\.data\.label : undefined\}/);
  for (const label of ['Training', 'Building', 'Operating']) {
    assert.match(css, new RegExp(`\\.archive:has\\(#f-${label.toLowerCase()}:checked\\) \\.toc__item:not\\(\\[data-label='${label}'\\]\\)`));
  }
  // Without :has() support the filter is hidden and every note stays listed.
  assert.match(css, /\.filter \{ display: none;/);
  assert.match(css, /@supports selector\(:has\(\*\)\) \{\s*\.filter \{ display: block; \}/);
});

test('keeps Field Notes canonical and redirects the concept /writing/ paths', () => {
  assert.ok(exists('src/pages/field-notes/[slug].astro'));
  assert.match(post, /<LikeButton slug=\{slug\} \/>/);
  assert.match(post, /More Field Notes/);
  assert.match(post, /Back to all Field Notes/);
  assert.match(css, /\.field-note-image/);
  const redirects = read('public/_redirects');
  assert.match(redirects, /^\/writing\/ \/field-notes\/ 301$/m);
  assert.match(redirects, /^\/writing\/:slug\/ \/field-notes\/:slug\/ 301$/m);
});

test('removes decorative terminal pills, gradient headings, and static card grids', () => {
  assert.doesNotMatch(home + notes + links, /command-line|gradient-title|gword/);
  assert.doesNotMatch(home, /card-grid/);
  assert.doesNotMatch(projectsPage + projectsFeature, /card-grid|card--link/);
});

test('uses honest evidence-led projects and only verified public destinations', () => {
  const projectSources = projectsPage + projectsFeature + projectsData;
  assert.doesNotMatch(projectSources, /dark theme|Claude Statusbar|Agents \u{B7} TypeScript|Discuss a project|Project%20Inquiry|pricing|book a call/iu);
  assert.match(projectsData, /status:/);
  assert.match(projectsData, /summary:/);
  const githubLinks = [...projectSources.matchAll(/https:\/\/github\.com\/[^'"\s]+/g)].map((match) => match[0]);
  assert.deepEqual(githubLinks, ['https://github.com/albertchristianco-sudo/accoworks-dev']);
  // Private, internal and local work stays unlinked.
  for (const name of ['Cortex Orchestrator', 'Life Dashboard', 'Flame & Finish systems', 'Gym programming automation']) {
    const entry = projectsData.slice(projectsData.indexOf(`name: '${name}'`)).split('},')[0];
    assert.doesNotMatch(entry, /link:/, `${name} must not be linked`);
  }
});

test('keeps the reaction control honest and announced with or without JavaScript', () => {
  const likeButton = read('src/components/LikeButton.astro');
  assert.match(likeButton, /<div class="like"[^>]*hidden/);
  assert.match(likeButton, /role="status" aria-live="polite"/);
  assert.match(likeButton, /data-like-status/);
  assert.match(likeButton, /aria-busy/);
  assert.match(css, /\.like\[hidden\] \{ display: none; \}/);
});

test('keeps public service paths focused on coaching and uses semantic link-group headings', () => {
  assert.doesNotMatch(links, /AI solutions|Business systems|tools & automation for your business/i);
  assert.match(links, /Coaching/);
  assert.match(links, /<h2 class="group-label"/);
  assert.doesNotMatch(links, /<p class="group-label"/);
});

test('keeps legacy utility pages on the legacy layout and styles', () => {
  for (const page of ['src/pages/coaching.astro', 'src/pages/links.astro', 'src/pages/power.astro', 'src/pages/power/update.astro']) {
    const source = read(page);
    assert.match(source, /import BaseLayout from/);
    assert.doesNotMatch(source, /EditionLayout|edition\.css/);
  }
  assert.match(legacyLayout, /import '\.\.\/styles\/global\.css'/);
  assert.doesNotMatch(legacyLayout, /edition\.css/);
  assert.doesNotMatch(layout, /import '[^']*global\.css'/);
  assert.match(legacyCss, /\/paper-grain\.png/);
  assert.doesNotMatch(legacyCss, /feTurbulence|mix-blend-mode/);
  assert.doesNotMatch(links, /chapter-band|folio-number|field-strip|masthead|coverline/);
});

test('does not animate layout properties', () => {
  for (const source of [css, legacyCss]) {
    assert.doesNotMatch(source, /transition:[^;]*(padding|margin|width|height|top|left)/);
  }
});

test('defines coarse-pointer touch targets at 44px or larger', () => {
  for (const source of [css, legacyCss]) {
    assert.match(source, /@media\s*\(pointer:\s*coarse\)/);
    assert.match(source, /min-height:\s*44px/);
  }
});

test('adds no em dashes, en dashes, arrows, or middle dots to edition files', () => {
  // Legacy pages (coaching, links, power, BaseLayout, global.css) predate this rule.
  const legacy = /(coaching|links|power)\.astro$|power\/update\.astro$|BaseLayout\.astro$|global\.css$/;
  const files = ['src/pages', 'src/components', 'src/layouts', 'src/styles', 'src/data', 'src/lib']
    .flatMap((dir) => walk(new URL(dir, root).pathname))
    .concat([new URL('src/scripts/edition-motion.js', root).pathname, new URL('src/scripts/next-race.mjs', root).pathname])
    .filter((file) => !legacy.test(file));
  assert.ok(files.length > 10);
  for (const file of files) {
    // en dash, em dash, arrows block, right guillemet, middle dot
    assert.doesNotMatch(readFileSync(file, 'utf8'), /[\u{2013}\u{2014}\u{2190}-\u{21FF}\u{BB}\u{B7}]/u, file);
  }
});

test('gates production deployment on tests and Astro diagnostics', () => {
  const workflow = read('.github/workflows/deploy.yml');
  assert.match(workflow, /run: npm test/);
  assert.match(workflow, /run: npx astro check/);
  assert.ok(workflow.indexOf('run: npm test') < workflow.indexOf('wrangler pages deploy'));
  assert.ok(workflow.indexOf('run: npx astro check') < workflow.indexOf('wrangler pages deploy'));
});
