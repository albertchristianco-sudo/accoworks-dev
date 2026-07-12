import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const css = read('src/styles/global.css');
const layout = read('src/layouts/BaseLayout.astro');
const home = read('src/pages/index.astro');
const projects = read('src/pages/projects.astro');
const notes = read('src/pages/field-notes/index.astro');
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

test('self-hosts the approved type system without Space Mono or Google Fonts', () => {
  assert.match(layout, /@fontsource\/barlow-semi-condensed\/latin-600\.css/);
  assert.match(layout, /@fontsource\/ibm-plex-sans\/latin-400\.css/);
  assert.match(layout, /@fontsource\/jetbrains-mono\/latin-400\.css/);
  assert.doesNotMatch(layout + css, /Space Mono|fonts\.googleapis|fonts\.gstatic/);
  assert.match(css, /--font-display:\s*'Barlow Semi Condensed'/);
});

test('ships no React or particle runtime', () => {
  for (const dependency of ['@astrojs/react', '@tsparticles/engine', '@tsparticles/react', '@tsparticles/slim', 'react', 'react-dom']) {
    assert.equal(pkg.dependencies?.[dependency], undefined, `${dependency} must be removed`);
  }
  assert.doesNotMatch(astroConfig, /@astrojs\/react|react\(\)/);
  assert.doesNotMatch(home, /Sparkles|hero-sparkles/);
  assert.equal(existsSync(new URL('../src/components/Sparkles.tsx', import.meta.url)), false);
});

test('uses accessible solid text colors without gradient clipping', () => {
  const muted = css.match(/--ink-3:\s*#([A-Fa-f0-9]{6})/)?.[1];
  assert.ok(muted, 'muted ink token must exist');
  assert.ok(contrast(muted, 'F5F7FB') >= 4.5, `muted ink contrast is ${contrast(muted, 'F5F7FB').toFixed(2)}:1`);
  assert.doesNotMatch(css, /background-clip:\s*text|-webkit-text-fill-color:\s*transparent/);
});

test('provides a skip link and a stable main-content target', () => {
  assert.match(layout, /href="#main-content"[^>]*>\s*Skip to content/);
  assert.match(layout, /<main\s+id="main-content"/);
  assert.match(layout, /viewport-fit=cover/);
});

test('keeps content visible without scroll-reveal JavaScript', () => {
  assert.doesNotMatch(layout, /IntersectionObserver|querySelectorAll\('\.reveal/);
  assert.doesNotMatch(css, /\.reveal\s*\{[^}]*opacity:\s*0/s);
  assert.doesNotMatch(css, /will-change/);
});

test('uses responsive modern formats for the above-fold portrait', () => {
  assert.match(home, /<picture>/);
  assert.match(home, /type="image\/avif"/);
  assert.match(home, /type="image\/webp"/);
  assert.match(home, /fetchpriority="high"/);
  assert.match(home, /sizes="[^"]+"/);
});

test('removes decorative terminal pills, gradient headings, and static card grids', () => {
  assert.doesNotMatch(home + notes + links, /command-line|gradient-title|gword/);
  assert.doesNotMatch(home, /card-grid/);
  assert.doesNotMatch(projects, /card-grid|card--link/);
});

test('uses honest evidence-led projects and only verified public destinations', () => {
  assert.doesNotMatch(projects, /dark theme|Claude Statusbar|Agents · TypeScript|Discuss a project|Project%20Inquiry/);
  assert.match(projects, /status:/);
  assert.match(projects, /outcome:/);
  const githubLinks = [...projects.matchAll(/https:\/\/github\.com\/[^'"\s]+/g)].map((match) => match[0]);
  assert.deepEqual(githubLinks, ['https://github.com/albertchristianco-sudo/accoworks-dev']);
});

test('keeps the reaction control honest and announced with or without JavaScript', () => {
  const likeButton = read('src/components/LikeButton.astro');
  assert.match(likeButton, /<div class="like"[^>]*hidden/);
  assert.match(likeButton, /role="status" aria-live="polite"/);
  assert.match(likeButton, /data-like-status/);
  assert.match(likeButton, /aria-busy/);
});

test('keeps public service paths focused on coaching and uses semantic link-group headings', () => {
  assert.doesNotMatch(links, /AI solutions|Business systems|tools & automation for your business/i);
  assert.match(links, /Coaching/);
  assert.match(links, /<h2 class="group-label"/);
  assert.doesNotMatch(links, /<p class="group-label"/);
});

test('does not animate layout properties', () => {
  assert.doesNotMatch(css, /transition:[^;]*(padding|margin|width|height|top|left)/);
});

test('defines coarse-pointer touch targets at 44px or larger', () => {
  assert.match(css, /@media\s*\(pointer:\s*coarse\)/);
  assert.match(css, /min-height:\s*44px/);
});

test('gates production deployment on tests and Astro diagnostics', () => {
  const workflow = read('.github/workflows/deploy.yml');
  assert.match(workflow, /run: npm test/);
  assert.match(workflow, /run: npx astro check/);
  assert.ok(workflow.indexOf('run: npm test') < workflow.indexOf('wrangler pages deploy'));
  assert.ok(workflow.indexOf('run: npx astro check') < workflow.indexOf('wrangler pages deploy'));
});
