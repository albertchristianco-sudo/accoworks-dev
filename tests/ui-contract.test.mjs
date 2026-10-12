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

// Final palette (Albert, Oct 12): cool grey base with one teal accent.
const PALETTE = {
  bg: 'F3F5F6',
  surface: 'E3E7E9',
  line: 'C5CDD0',
  ink: '1C2326',
  'ink-soft': '4E595E',
  'on-ink-soft': 'A7B2B6',
  'photo-tint': '6E8084',
  accent: '136A72',
  'accent-strong': '0E3B43',
  'on-accent': 'FFFFFF',
  shade: '0B0F11',
  error: 'B3261E',
};

test('defines the cool grey and teal palette as tokens', () => {
  for (const [name, hex] of Object.entries(PALETTE)) {
    assert.equal(token(name)?.toUpperCase(), hex, `--${name}`);
  }
  // Retired tokens stay gone, and edition.css holds no colour literal outside :root.
  assert.doesNotMatch(css, /--(paper|sea|hibiscus|hibiscus-deep|sand|shallow|ink-sand)\b/);
  const rootBlock = css.match(/:root \{[^}]*\}/)[0];
  const rest = css.replace(rootBlock, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(rest, /#[0-9A-Fa-f]{3,8}\b|\brgba?\(|\bhsla?\(/);
  // The browser chrome colour is read from --ink, not written out.
  assert.match(layout, /<meta name="theme-color" content=\{themeColor\} \/>/);
  assert.match(layout, /const themeColor = editionCss\.match\(\/--ink:/);
});

test('removes hibiscus and sand from every edition file', () => {
  const legacy = /(coaching|links|power)\.astro$|power\/update\.astro$|BaseLayout\.astro$|global\.css$/;
  const files = ['src/pages', 'src/components', 'src/layouts', 'src/styles', 'src/data', 'src/lib']
    .flatMap((dir) => walk(new URL(dir, root).pathname))
    .filter((file) => !legacy.test(file));
  for (const file of files) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /#(D6336C|C92A62|E6DFD0)\b|hibiscus|\bsand\b/i, file);
  }
});

test('uses accessible solid text colors without gradient clipping', () => {
  const muted = legacyCss.match(/--ink-3:\s*#([A-Fa-f0-9]{6})/)?.[1];
  assert.ok(muted, 'legacy muted ink token must exist');
  assert.ok(contrast(muted, 'F5F7FB') >= 4.5, `legacy muted ink contrast is ${contrast(muted, 'F5F7FB').toFixed(2)}:1`);

  // [foreground, background, minimum]: 4.5 for text, 3 for focus rings and control boundaries.
  const pairs = [
    ['ink', 'bg', 4.5],
    ['ink-soft', 'bg', 4.5],
    ['ink', 'surface', 4.5],
    ['ink-soft', 'surface', 4.5],
    ['accent', 'bg', 4.5],
    ['accent-strong', 'bg', 4.5],
    ['on-accent', 'accent', 4.5],
    ['on-accent', 'accent-strong', 4.5],
    ['bg', 'ink', 4.5],
    ['on-ink-soft', 'ink', 4.5],
    ['error', 'bg', 4.5],
    ['accent', 'bg', 3],
    ['bg', 'ink', 3],
    ['ink', 'surface', 3],
  ];
  for (const [fg, bg, min] of pairs) {
    const ratio = contrast(token(fg), token(bg));
    assert.ok(ratio >= min, `--${fg} on --${bg} is ${ratio.toFixed(2)}:1, needs ${min}:1`);
  }
  // The roundel is the cover's one teal spot and carries small on-accent text.
  assert.match(css, /\.flash\s*\{[^}]*background:\s*var\(--accent\);[^}]*color:\s*var\(--on-accent\);/);
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

// Splits a stylesheet into its top-level blocks ({ prelude, body }), comments removed.
function topLevelBlocks(source) {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = [];
  let depth = 0;
  let start = 0;
  let open = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (depth === 0) open = i;
      depth++;
    } else if (text[i] === '}') {
      depth--;
      if (depth === 0) {
        blocks.push({ prelude: text.slice(start, open).trim(), body: text.slice(open + 1, i) });
        start = i + 1;
      }
    }
  }
  assert.equal(depth, 0, 'stylesheet braces must balance');
  return blocks;
}

test('keeps content visible without JavaScript and honours reduced motion', () => {
  assert.doesNotMatch(legacyLayout + layout, /IntersectionObserver|querySelectorAll\('\.reveal/);
  assert.doesNotMatch(legacyCss, /\.reveal\s*\{[^}]*opacity:\s*0/s);
  for (const source of [css, legacyCss]) assert.doesNotMatch(source, /will-change/);

  // Every animation and every hidden reveal state lives inside a
  // prefers-reduced-motion: no-preference block, however the CSS is formatted.
  const isMotion = (prelude) => /^@media\s*\(\s*prefers-reduced-motion\s*:\s*no-preference\s*\)$/.test(prelude);
  const blocks = topLevelBlocks(css);
  const base = blocks.filter((block) => !isMotion(block.prelude)).map((block) => `${block.prelude}{${block.body}}`).join('\n');
  const motion = blocks.filter((block) => isMotion(block.prelude)).map((block) => block.body).join('\n');
  assert.ok(motion.length > 1000, 'motion block must exist');
  assert.doesNotMatch(base, /animation(-name|-timeline|-range)?\s*:/);
  assert.doesNotMatch(base, /html\.fx|\.rv\b|@keyframes/);
  assert.match(motion, /@supports\s*\(animation-timeline:\s*view\(\)\)/);
  assert.match(motion, /html\.fx \.rv/);

  // The reveal script hides nothing by itself: it only runs when motion is allowed and
  // scroll timelines are missing, sets html.fx first, and marks targets .rv only where
  // IntersectionObserver exists to reveal them again.
  const script = read('src/scripts/edition-motion.js');
  assert.match(script, /const reduce = [^;]*matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches;/);
  assert.match(script, /const native = [^;]*CSS\.supports\('animation-timeline: view\(\)'\);/);
  const guard = script.indexOf('if (!reduce && !native) {');
  const fx = script.indexOf("root.classList.add('fx')");
  const observer = script.indexOf("if ('IntersectionObserver' in window && targets.length) {");
  const markHidden = script.indexOf("target.classList.add('rv')");
  const reveal = script.indexOf("entry.target.classList.add('in')");
  assert.ok(guard > 0 && guard < fx && fx < observer && observer < reveal && reveal < markHidden, 'reveal order in edition-motion.js');
  assert.equal(script.match(/classList\.add\('rv'\)/g).length, 1);
  // No source markup starts hidden: .rv is only ever added by the script.
  for (const file of walk(new URL('src', root).pathname).filter((name) => name.endsWith('.astro'))) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /class(:list)?=["{][^"}]*\brv\b/, file);
  }
  assert.doesNotMatch(script + css, /preventDefault|scroll-snap|wheel|lenis|locomotive/i);
});

test('lifts the pinned cover only for keyboard focus, not mouse clicks in main', () => {
  assert.match(layout, /<main id="main-content" tabindex="-1">/);
  // main has tabindex="-1", so a click focuses it: :focus-within would hide the cover.
  assert.doesNotMatch(css, /:has\(main:focus-within\)/);
  const lifts = [...css.matchAll(/([^{}\n]*:has\(main:focus-visible, main :focus-visible\) \.cover) \{ visibility: hidden; \}/g)];
  assert.equal(lifts.length, 2, 'both motion engines lift the cover on keyboard focus');
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
  // The photo is object-fit: cover over a 100vw x 100svh box (66% of the height at
  // <=760px), so it renders at max(box width, box height x 2560/3396).
  const sizes = [...cover.matchAll(/sizes="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(sizes, Array(2).fill('(max-width: 760px) max(100vw, 49.75vh), max(100vw, 75.38vh)'));
  assert.equal((0.66 * 2560 / 3396 * 100).toFixed(2), '49.75');
  assert.equal((2560 / 3396 * 100).toFixed(2), '75.38');
  assert.match(cover, /src="\/cover-1280\.webp"/);
  assert.match(cover, /width="2560"\s+height="3396"/);
  assert.doesNotMatch(cover, /placeholder|photo-\d+/);
});

test('sizes the profile photo to its measured layout widths', () => {
  // Measured: about 92vw on phones, 37vw from 761 to 1080px, 29vw above that up to 467px.
  const profile = read('src/components/edition/Profile.astro');
  const sizes = [...profile.matchAll(/sizes="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(sizes, Array(2).fill('(max-width: 760px) 92vw, (max-width: 1080px) 38vw, min(30vw, 470px)'));
});

test('marks the nav item as the current page only on an exact match', () => {
  const nav = read('src/components/edition/SiteNav.astro');
  assert.match(nav, /if \(path === href \|\| path === href\.slice\(0, -1\)\) return 'page';/);
  assert.match(nav, /if \(path\.startsWith\(href\)\) return 'true';/);
  assert.doesNotMatch(nav, /startsWith\(href\) \? 'page'/);
});

test('uses one mobile breakpoint for the nav strip backing and the name plate', () => {
  assert.doesNotMatch(css, /max-width: 700px/);
  assert.match(css, /@media \(max-width: 760px\) \{[\s\S]*?\.cover__strip \{[^}]*background: var\(--ink\);[\s\S]*?\.cover__name span \{[^}]*background: var\(--ink\)/);
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

test('keeps cover text AA-legible over any part of the duotone photo', () => {
  // The filtered img paints in the z-index 0 layer, so the tint layers need z-index to blend over it.
  assert.match(css, /\.cover__photo::before \{ z-index: 1; background: var\(--photo-tint\); mix-blend-mode: multiply; \}/);
  assert.match(css, /\.cover__photo::after \{ z-index: 2; background: var\(--ink\); mix-blend-mode: lighten; \}/);
  const tint = token('photo-tint');
  const brightness = Number(css.match(/\.cover__photo img \{[^}]*filter: grayscale\(1\) contrast\([\d.]+\) brightness\(([\d.]+)\)/)[1]);
  // Brightest possible pixel: white after brightness, multiplied by the tint, lightened with ink.
  const ink = token('ink').match(/../g).map((h) => Number.parseInt(h, 16));
  const brightest = tint.match(/../g)
    .map((h, i) => Math.max(Math.round(255 * brightness * Number.parseInt(h, 16) / 255), ink[i]))
    .map((v) => v.toString(16).padStart(2, '0')).join('');
  assert.equal(brightest.toUpperCase(), '58666A');
  const ratio = contrast(token('bg'), brightest);
  assert.ok(ratio >= 4.5, `--bg on the brightest cover pixel #${brightest} is ${ratio.toFixed(2)}:1`);
});

test('fits the masthead, roundel and cover lines on short viewports', () => {
  assert.match(css, /\.masthead \{[^}]*font-size: clamp\(9rem, min\(31vw, 46svh\), 31rem\);/);
  assert.match(css, /\.coverlines \{[^}]*grid-column: 8 \/ -1;[^}]*grid-row: 2 \/ span 3;/);
  assert.match(css, /@media \(max-width: 760px\) \{[\s\S]*?\.masthead \{ font-size: min\(44vw, 26svh\);[\s\S]*?\.coverlines \{ grid-column: 2 \/ -1; grid-row: 3 \/ span 2; \}/);
});

test('keeps the mobile name line legible over the photo with a solid plate', () => {
  assert.match(cover, /<h1 class="cover__name"><span>/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.cover__name span \{[^}]*background:\s*var\(--ink\)/);
  assert.ok(contrast(token('bg'), token('ink')) >= 4.5, 'name line on its ink plate');
  assert.match(css, /\.cover \{[^}]*background: var\(--ink\);\s*color: var\(--bg\);/);
  assert.match(css, /\.cover :focus-visible \{ outline-color: var\(--bg\); \}/);
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

test('removes a stale race roundel in the browser once the Cebu date is past race day', () => {
  assert.match(nextRaceComponent, /<p class="flash" data-until=\{race\.date\}>/);
  const inline = nextRaceComponent.match(/<script is:inline>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(inline, 'roundel carries a tiny inline script');
  assert.match(inline, /timeZone:'Asia\/Manila'/);

  const run = (isoNow) => {
    let removed = false;
    const flash = { dataset: { until: '2026-11-28' }, remove: () => { removed = true; } };
    const RealDate = Date;
    const FakeDate = class extends RealDate { constructor(...args) { super(...(args.length ? args : [isoNow])); } };
    new Function('document', 'Date', inline)({ currentScript: { previousElementSibling: flash } }, FakeDate);
    return removed;
  };
  assert.equal(run('2026-10-12T04:00:00Z'), false);
  assert.equal(run('2026-11-28T15:59:00Z'), false, 'still race day in Cebu (23:59)');
  assert.equal(run('2026-11-28T16:00:00Z'), true, 'Nov 29 00:00 in Cebu');
});

test('filters Field Notes by label without JavaScript', () => {
  assert.doesNotMatch(notes, /<script/);
  for (const id of ['f-all', 'f-training', 'f-building', 'f-operating']) assert.match(notes, new RegExp(`id: '${id}'`));
  assert.match(notes, /type="radio" name="label"/);
  assert.match(notes, /<NoteList notes=\{notes\} labelled/);
  // A count would be wrong under a filter, and the filter has no JS to update it.
  assert.match(notes, /<p class="filter__note">Newest first\.<\/p>/);
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
