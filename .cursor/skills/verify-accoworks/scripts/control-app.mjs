#!/usr/bin/env node
// control-app: drive a LOCAL build of accoworks.dev the way a visitor does.
//
// Builds dist/, serves it with `astro preview` on a free 127.0.0.1 port, and drives
// it in headless Chrome through playwright-core (already a devDependency). Every
// browser context blocks requests that leave the local preview origin, so a run
// can never reach https://accoworks.dev, Cloudflare, Resend or any third party.
// Pages Functions (/api/*) do not exist under astro preview; drives that need
// them stub them at the browser boundary and record what would have been sent.
//
// Run `control-app.mjs --help` for usage. Output is one JSON object on stdout.

import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(SCRIPT_DIR, '../../../..');
const STATE_DIR = join(REPO, 'node_modules/.cache/verify-accoworks');
const STATE_FILE = join(STATE_DIR, 'state.json');
const DEFAULT_OUT = join(REPO, '.verify-proof');
const DIST = join(REPO, 'dist');
const ASTRO_BIN = join(REPO, 'node_modules/astro/bin/astro.mjs');
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const PROD_HOSTS = ['accoworks.dev', 'www.accoworks.dev', 'albertchristianco-sudo.github.io'];
const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

const HELP = `control-app: launch, inspect and drive a LOCAL accoworks.dev build (verify-accoworks skill).

Usage: node .cursor/skills/verify-accoworks/scripts/control-app.mjs <command> [options]
   or: npm run -s control-app -- <command> [options]     (-s keeps stdout pure JSON)

Commands
  launch [--skip-build] [--port N]
      npm run build (log: ${rel(STATE_DIR)}/build.log), then astro preview on 127.0.0.1 and
      a free port (or --port). Waits until GET / answers 200, writes the state file
      ${rel(STATE_FILE)} and prints {url, pid, port, ...}. Reuses a healthy instance
      this checkout already started. --skip-build serves the existing dist/.
  doctor
      Read-only. Is the instance we started alive, ours, answering, serving the current
      build? Also checks Chrome and playwright-core. Exit 0 = worth driving.
  routes
      Lists every page in dist/ (no server needed) plus the Cloudflare-only redirects in
      public/_redirects, which astro preview does NOT apply.
  shot <route> [--viewport desktop|mobile] [--out DIR] [--full] [--motion] [--name NAME]
      Screenshot one route (e.g. /, /coaching/, /field-notes/the-one-tool-coach/).
      desktop = 1440x900 @1x, mobile = 390x844 @2x touch. Viewport-only unless --full.
      Reduced motion unless --motion (the home cover turns on scroll). Writes
      <NAME>.png and <NAME>.json (title, h1, status, blocked requests, console errors).
  drive <feature> [--viewport desktop|mobile] [--out DIR] [--dry-run] [--stub ok|error]
      Runs the scripted user path for a mapped feature and prints each step with
      ok/detail plus artifact paths. Features:
        home-cover     cover masthead, cover lines, next-race roundel vs src/data/races.json,
                       click the lead cover line through to its post
        coaching-form  /coaching/ application: empty-submit validation, fill every field,
                       submit with POST /api/coaching STUBBED in the browser (--stub ok shows
                       "Received", --stub error shows the server error). --dry-run fills
                       only and never presses submit. Nothing is ever emailed.
        field-notes    archive filter (Everything/Training/Building/Operating), open a post
        post-like      like button on a post with /api/reactions STUBBED (GET 7, POST 8).
                       --dry-run loads the count only and never clicks.
        nav-footer     every Main nav link + aria-current, the "Ac, home" mark, footer links
        about-contact  /about/ -> "Read about remote coaching", /contact/ mailto, /projects/
  stop
      Stops only the pid recorded in the state file, after checking it is this
      checkout's astro preview on the recorded --port (its process group too when it
      leads one). Deletes the state file; an unusable one is removed without killing
      anything. Never touches proof directories. Exit 1 if the port still answers.

Options
  --out DIR        Evidence directory (default ${rel(DEFAULT_OUT)}, gitignored). Survives stop.
  --viewport V     desktop (default) or mobile.
  CHROME_PATH      Chrome binary (default /usr/bin/google-chrome).

Safety
  Local only. Browser contexts abort any request whose origin is not the preview URL
  and list them under "blocked"; the preview URL must be http://127.0.0.1:<port>/.
  Unknown options are rejected. Exit codes: 0 ok, 1 check failed, 2 usage error.`;

function rel(path) { return relative(REPO, path) || '.'; }

function out(obj, code = 0) {
  process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
  process.exit(code);
}

function fail(error, hint, extra = {}, code = 1) {
  out({ ok: false, error, hint, ...extra }, code);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '-h' || a === '--help') args.help = true;
    else if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (['skip-build', 'full', 'motion', 'dry-run'].includes(key)) args[key] = true;
      else if (!['port', 'out', 'viewport', 'stub', 'name'].includes(key)) fail(`Unknown option --${key}.`, 'Run with --help for usage.', {}, 2);
      else if (next === undefined || next.startsWith('--')) fail(`Option --${key} needs a value.`, 'Run with --help for usage.', {}, 2);
      else { args[key] = next; i += 1; }
    } else args._.push(a);
  }
  return args;
}

// ---------- state and process helpers ----------

// Returns { state } for a usable state file, { state: null } when there is none, and
// { state: null, problem } when it exists but cannot be trusted. Everything that kills
// or browses relies on this: pid/pgid must be one real process that leads its own group,
// and url must be our 127.0.0.1 port.
function loadState() {
  if (!existsSync(STATE_FILE)) return { state: null };
  let s;
  try { s = JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch (e) { return { state: null, problem: `unparseable JSON (${e.message})` }; }
  if (!Number.isInteger(s?.pid) || s.pid <= 1) return { state: null, problem: `bad pid ${JSON.stringify(s?.pid)}` };
  if (s.pgid !== s.pid) return { state: null, problem: `pgid ${JSON.stringify(s.pgid)} is not pid ${s.pid}` };
  if (!Number.isInteger(s.port) || s.port < 1 || s.port > 65535) return { state: null, problem: `bad port ${JSON.stringify(s.port)}` };
  if (s.url !== `http://127.0.0.1:${s.port}/`) return { state: null, problem: `url ${JSON.stringify(s.url)} is not http://127.0.0.1:${s.port}/` };
  return { state: s };
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// Exact argv from /proc on Linux; null where there is no /proc (cmdline() falls back to ps).
function procArgv(pid) {
  try { return readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean); } catch { return null; }
}

// One unsplit string: ps cannot tell an argv boundary from a space inside a path.
function cmdline(pid) {
  const a = procArgv(pid);
  if (a) return a.join(' ');
  const ps = spawnSync('ps', ['-ww', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8' });
  return ps.status === 0 ? ps.stdout.trim() : '';
}

function processGroup(pid) {
  try { return Number(readFileSync(`/proc/${pid}/stat`, 'utf8').replace(/^.*\)\s+/, '').split(' ')[2]); } catch { /* not linux */ }
  const ps = spawnSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' });
  return ps.status === 0 ? Number(ps.stdout.trim()) : null;
}

// Exactly what launch spawns after the node binary.
function previewArgv(port) { return [ASTRO_BIN, 'preview', '--host', '127.0.0.1', '--port', String(port)]; }

// The recorded PID only counts as ours when it is still this checkout's astro preview
// on exactly our port: its argv contains previewArgv(port) as a contiguous run. Without
// /proc, the unsplit ps command line must contain that run joined with spaces, followed
// by a space or the end (so --port 433 does not match 43305); paths with spaces still work.
function isOurPreview(state) {
  if (!state?.pid || !pidAlive(state.pid)) return false;
  const want = previewArgv(state.port);
  const a = procArgv(state.pid);
  if (a) return a.some((_, i) => want.every((w, j) => a[i + j] === w));
  return `${cmdline(state.pid)} `.includes(`${want.join(' ')} `);
}

function ourPreviews() {
  const ps = spawnSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' });
  return (ps.stdout || '').split('\n').filter((l) => l.includes(`${ASTRO_BIN} preview`)).map((l) => l.trim());
}

// SIGTERM, then SIGKILL after 4s, to the recorded preview. The whole group is signalled
// only when the pid still leads its own group (launch spawns it detached); otherwise just
// the pid. Re-checks ownership before each signal so a recycled pid is never hit.
async function terminate(state) {
  const signal = (sig) => {
    if (!isOurPreview(state)) return;
    const target = processGroup(state.pid) === state.pid ? -state.pid : state.pid;
    try { process.kill(target, sig); } catch { /* already gone */ }
  };
  signal('SIGTERM');
  for (let i = 0; i < 40 && isOurPreview(state); i += 1) await sleep(100);
  if (isOurPreview(state)) { signal('SIGKILL'); await sleep(200); }
  return !isOurPreview(state);
}

function freePort() {
  return new Promise((done, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => done(port)); });
  });
}

async function httpGet(url, timeoutMs = 3000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' });
    return { status: res.status, body: await res.text() };
  } catch (e) {
    return { status: 0, error: e.cause?.code || e.message };
  }
}

function git(...args) {
  const r = spawnSync('git', args, { cwd: REPO, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

function revision() {
  return { head: git('rev-parse', '--short', 'HEAD'), branch: git('rev-parse', '--abbrev-ref', 'HEAD'), dirty: Boolean(git('status', '--porcelain')) };
}

function newestMtime(paths) {
  let newest = 0;
  const walk = (p) => {
    if (!existsSync(p)) return;
    const st = statSync(p);
    if (st.isDirectory()) for (const e of readdirSync(p)) walk(join(p, e));
    else newest = Math.max(newest, st.mtimeMs);
  };
  paths.forEach(walk);
  return newest;
}

// Astro 6 refuses to run below package.json engines (>=22.12.0). The build runs
// `node` from PATH; the preview runs this script's own node.
function nodeVersions() {
  const want = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).engines?.node ?? '>=22.12.0';
  const [wMaj, wMin] = want.replace(/[^\d.]/g, '').split('.').map(Number);
  const okv = (v) => { const [maj, min] = (v || '').replace(/^v/, '').split('.').map(Number); return maj > wMaj || (maj === wMaj && min >= wMin); };
  const onPath = spawnSync('node', ['--version'], { encoding: 'utf8' }).stdout?.trim() || null;
  return { want, self: process.version, onPath, ok: okv(process.version) && okv(onPath) };
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ---------- launch / doctor / stop ----------

async function launch(args) {
  let port = args.port ? Number(args.port) : null;
  if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) fail(`Bad --port ${args.port}.`, 'Pass a port number 1-65535, or omit --port to pick a free one.', {}, 2);
  const { state: existing, problem } = loadState();
  if (problem) fail(`State file ${rel(STATE_FILE)} is unusable: ${problem}.`, 'Run stop: it lists this checkout\'s previews and clears the file without killing anything.', { previews: ourPreviews() });
  if (existing && isOurPreview(existing)) {
    const probe = await httpGet(existing.url);
    if (probe.status === 200) out({ ok: true, reused: true, ...existing, hint: 'Already running from this checkout. Run stop first to rebuild.' });
    if (!(await terminate(existing))) fail(`Our preview pid ${existing.pid} is not answering and survived SIGKILL.`, 'Inspect it manually; the state file was kept.');
  }
  if (existing) rmSync(STATE_FILE, { force: true });
  mkdirSync(STATE_DIR, { recursive: true });
  const nv = nodeVersions();
  if (!nv.ok) fail(`Node ${nv.want} required (package.json engines); this script runs ${nv.self}, PATH node is ${nv.onPath}.`, 'Put a Node >=22.12 first on PATH and run this script with it, e.g. PATH=/path/to/node22/bin:$PATH node control-app.mjs launch.', { node: nv });
  if (!existsSync(ASTRO_BIN)) fail(`Astro CLI not found at ${rel(ASTRO_BIN)}.`, 'Run npm ci in the repo root first.');

  const buildLog = join(STATE_DIR, 'build.log');
  let build = { skipped: true };
  if (!args['skip-build']) {
    const started = Date.now();
    const fd = openSync(buildLog, 'w');
    const r = spawnSync('npm', ['run', 'build'], { cwd: REPO, stdio: ['ignore', fd, fd], env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' } });
    closeSync(fd);
    build = { skipped: false, exitCode: r.status, seconds: Math.round((Date.now() - started) / 100) / 10, log: rel(buildLog) };
    if (r.status !== 0) {
      const tail = readFileSync(buildLog, 'utf8').trim().split('\n').slice(-20);
      fail('npm run build failed.', `Read ${rel(buildLog)}; fix the build before verifying.`, { build, logTail: tail });
    }
  }
  if (!existsSync(join(DIST, 'index.html'))) fail('dist/index.html is missing.', 'Run launch without --skip-build.');

  if (port === null) port = await freePort();
  const url = `http://127.0.0.1:${port}/`;
  const before = await httpGet(url, 500);
  if (before.status) fail(`Port ${port} is already answering.`, 'Something else owns it. Omit --port to pick a free one.');

  const previewLog = join(STATE_DIR, 'preview.log');
  const fd = openSync(previewLog, 'w');
  const child = spawn(process.execPath, previewArgv(port), {
    cwd: REPO, detached: true, stdio: ['ignore', fd, fd], env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' },
  });
  closeSync(fd);
  child.unref();

  const deadline = Date.now() + 30000;
  let probe = { status: 0 };
  while (Date.now() < deadline) {
    if (!pidAlive(child.pid)) break;
    probe = await httpGet(url, 1000);
    if (probe.status === 200) break;
    await sleep(250);
  }
  if (probe.status !== 200) {
    await terminate({ pid: child.pid, port });
    const tail = existsSync(previewLog) ? readFileSync(previewLog, 'utf8').trim().split('\n').slice(-20) : [];
    fail(`astro preview did not answer 200 on ${url} within 30s (last status ${probe.status || probe.error}).`, `Read ${rel(previewLog)}.`, { logTail: tail });
  }

  const state = {
    url, port, pid: child.pid, pgid: child.pid,
    startedAt: new Date().toISOString(),
    distBuiltAt: new Date(statSync(join(DIST, 'index.html')).mtimeMs).toISOString(),
    revision: revision(), build, previewLog: rel(previewLog), stateFile: rel(STATE_FILE),
  };
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
  out({ ok: true, reused: false, ...state, next: 'Run doctor, then drive <feature> or shot <route>. Run stop when done.' });
}

async function doctor() {
  const checks = [];
  const add = (id, ok, detail, level = 'error') => checks.push({ id, ok, level: ok ? 'ok' : level, detail });
  const { state, problem } = loadState();
  add('state-file', Boolean(state), state ? rel(STATE_FILE) : problem ? `unusable ${rel(STATE_FILE)}: ${problem}; run stop` : `missing ${rel(STATE_FILE)}: run launch`);
  if (state) {
    const alive = pidAlive(state.pid);
    add('process-alive', alive, `pid ${state.pid}`);
    const cmd = alive ? cmdline(state.pid) : '';
    add('process-is-ours', isOurPreview(state), cmd || 'no command line (process gone)');
    const home = await httpGet(state.url);
    add('port-answers', home.status === 200, `GET ${state.url} -> ${home.status || home.error}`);
    const generator = home.body?.match(/<meta name="generator" content="([^"]+)"/)?.[1];
    add('serves-this-site', Boolean(generator && home.body.includes('Albert Christian Co')), generator ? `${generator}, home mentions Albert Christian Co` : 'home page is not the accoworks build');
    add('local-only', !PROD_HOSTS.includes(new URL(state.url).hostname), state.url);
    const rev = revision();
    add('revision', rev.head === state.revision?.head, `launched at ${state.revision?.head}, checkout now ${rev.head}${rev.dirty ? ' (dirty)' : ''}`, 'warn');
    const srcNewest = newestMtime(['src', 'public', 'astro.config.mjs'].map((p) => join(REPO, p)));
    const distAt = existsSync(join(DIST, 'index.html')) ? statSync(join(DIST, 'index.html')).mtimeMs : 0;
    add('build-fresh', distAt >= srcNewest, distAt >= srcNewest ? `dist built ${new Date(distAt).toISOString()}` : `src/public changed after the build (${new Date(srcNewest).toISOString()}): stop, then launch to rebuild`, 'warn');
  }
  const nv = nodeVersions();
  add('node-version', nv.ok, `need ${nv.want}; script ${nv.self}, PATH ${nv.onPath}`);
  add('chrome', existsSync(CHROME), CHROME);
  let pw = null;
  try { pw = JSON.parse(readFileSync(join(REPO, 'node_modules/playwright-core/package.json'), 'utf8')).version; } catch { /* missing */ }
  add('playwright-core', Boolean(pw), pw ? `playwright-core ${pw}` : 'missing: run npm ci');
  const ok = checks.every((c) => c.ok || c.level === 'warn');
  out({ ok, url: state?.url ?? null, checks, hint: ok ? 'Instance is worth driving.' : 'Fix the failed checks (usually: stop, then launch).' }, ok ? 0 : 1);
}

async function stop() {
  const { state, problem } = loadState();
  if (problem) {
    rmSync(STATE_FILE, { force: true });
    fail(`State file was unusable (${problem}); removed it without killing anything.`, 'If a preview from this checkout is listed under previews, check it and kill it by pid yourself.', { previews: ourPreviews() });
  }
  if (!state) out({ ok: true, stopped: false, detail: `No state file at ${rel(STATE_FILE)}; nothing this tool started is recorded.` });
  const ours = isOurPreview(state);
  if (ours && !(await terminate(state))) fail(`pid ${state.pid} survived SIGKILL.`, 'Inspect it manually; the state file was kept.');
  rmSync(STATE_FILE, { force: true });
  const port = await httpGet(state.url, 800);
  out({
    ok: port.status === 0, stopped: ours, pid: state.pid, url: state.url,
    portClosed: port.status === 0, stateFileRemoved: !existsSync(STATE_FILE),
    detail: ours ? 'Stopped the recorded astro preview.' : 'Recorded pid was no longer our astro preview; removed the stale state file only.',
    hint: port.status === 0 ? undefined : `Something still answers on ${state.url}; it is not the recorded pid, so stop left it alone.`,
    evidenceKept: 'Proof directories are never touched by stop.',
  }, port.status === 0 ? 0 : 1);
}

// ---------- routes ----------

function routes() {
  if (!existsSync(join(DIST, 'index.html'))) fail('No build in dist/.', 'Run launch (or npm run build) first.');
  const pages = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.html')) {
        const r = `/${relative(DIST, p).split(sep).join('/')}`.replace(/index\.html$/, '');
        const html = readFileSync(p, 'utf8');
        pages.push({ route: r, title: html.match(/<title>([^<]*)<\/title>/)?.[1] ?? null, noindex: /name="robots" content="noindex/.test(html) });
      }
    }
  };
  walk(DIST);
  pages.sort((a, b) => a.route.localeCompare(b.route));
  const redirects = existsSync(join(REPO, 'public/_redirects'))
    ? readFileSync(join(REPO, 'public/_redirects'), 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => { const [from, to, status] = l.trim().split(/\s+/); return { from, to, status: Number(status) }; })
    : [];
  out({ ok: true, count: pages.length, pages, cloudflareOnlyRedirects: redirects, note: 'astro preview does not apply _redirects; verify those only against a Pages preview deploy.' });
}

// ---------- browser ----------

function requireRunning() {
  const { state, problem } = loadState();
  if (problem) fail(`State file ${rel(STATE_FILE)} is unusable: ${problem}.`, 'Run stop, then launch.');
  if (!state) fail(`No running instance (missing ${rel(STATE_FILE)}).`, 'Run launch first.');
  if (!isOurPreview(state)) fail(`Recorded pid ${state.pid} is not our astro preview any more.`, 'Run stop to clear the stale state, then launch.');
  return state;
}

async function openBrowser(state, args) {
  const vpName = args.viewport ?? 'desktop';
  const vp = VIEWPORTS[vpName];
  if (!vp) fail(`Unknown --viewport ${vpName}.`, 'Use desktop or mobile.', {}, 2);
  if (!existsSync(CHROME)) fail(`Chrome not found at ${CHROME}.`, 'Set CHROME_PATH to a Chrome/Chromium binary.');
  const { chromium } = await import(pathToFileURL(join(REPO, 'node_modules/playwright-core/index.mjs')).href);
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-background-networking', '--disable-component-update', '--no-first-run'] });
  const context = await browser.newContext({ ...vp, reducedMotion: args.motion ? 'no-preference' : 'reduce', serviceWorkers: 'block' });
  const origin = new URL(state.url).origin;
  const blocked = [];
  const api = [];
  await context.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith('data:') || u.startsWith('blob:') || new URL(u).origin === origin) return route.continue();
    blocked.push({ method: route.request().method(), url: u });
    return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  const httpErrors = [];
  page.on('response', (r) => { if (r.status() >= 400) httpErrors.push({ status: r.status(), url: r.url() }); });
  page.on('request', (r) => { if (new URL(r.url()).pathname.startsWith('/api/')) api.push({ method: r.method(), url: r.url(), body: r.postData() }); });
  const go = async (route) => {
    const res = await page.goto(new URL(route, state.url).href, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    return res;
  };
  return { browser, context, page, go, blocked, api, consoleErrors, httpErrors, viewport: vpName, origin };
}

// npm run changes cwd to the repo root; INIT_CWD is where the caller ran it.
function outDir(args) {
  const dir = resolve(process.env.INIT_CWD ?? process.cwd(), args.out ?? DEFAULT_OUT);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function slugify(route) { return route.replace(/^\/|\/$/g, '').replace(/[^a-z0-9]+/gi, '-') || 'home'; }

async function shot(args) {
  const route = args._[1];
  if (!route || !route.startsWith('/')) fail('shot needs a route starting with /.', 'Example: shot /coaching/ --viewport mobile. List routes with: routes', {}, 2);
  if (args.name !== undefined && !/^[\w-][\w.-]*$/.test(args.name)) fail(`Bad --name ${args.name}.`, 'Use letters, digits, ".", "_" and "-" only; it becomes a file name inside --out.', {}, 2);
  if (args.viewport !== undefined && !VIEWPORTS[args.viewport]) fail(`Unknown --viewport ${args.viewport}.`, 'Use desktop or mobile.', {}, 2);
  const state = requireRunning();
  if (new URL(route, state.url).origin !== new URL(state.url).origin) fail(`Route ${route} leaves the local preview.`, 'Pass a path on this site, e.g. /coaching/.', {}, 2);
  const dir = outDir(args);
  const b = await openBrowser(state, args);
  try {
    const res = await b.go(route);
    const name = args.name ?? `${slugify(route)}-${b.viewport}`;
    const png = join(dir, `${name}.png`);
    await b.page.screenshot({ path: png, fullPage: Boolean(args.full) });
    const info = await b.page.evaluate(() => ({ title: document.title, h1: document.querySelector('h1')?.textContent.trim() ?? null, path: location.pathname }));
    const result = {
      ok: res?.status() === 200 && b.blocked.length === 0, route, url: b.page.url(), status: res?.status() ?? null, viewport: b.viewport,
      ...info, screenshot: png, fullPage: Boolean(args.full), reducedMotion: !args.motion,
      apiRequests: b.api, blocked: b.blocked, httpErrors: b.httpErrors, consoleErrors: b.consoleErrors, revision: state.revision, takenAt: new Date().toISOString(),
    };
    writeFileSync(join(dir, `${name}.json`), `${JSON.stringify(result, null, 2)}\n`);
    await b.browser.close();
    out({ ...result, json: join(dir, `${name}.json`) }, result.ok ? 0 : 1);
  } catch (e) {
    await b.browser.close();
    fail(`shot ${route} failed: ${e.message}`, 'Run doctor; check the route exists with routes.');
  }
}

// ---------- drives ----------

function stepper() {
  const steps = [];
  const step = async (id, action, expect, fn) => {
    try {
      const detail = await fn();
      const ok = detail?.ok !== false;
      steps.push({ id, ok, action, expect, detail: detail?.detail ?? detail ?? null });
      return ok;
    } catch (e) {
      steps.push({ id, ok: false, action, expect, detail: e.message.split('\n')[0] });
      return false;
    }
  };
  return { steps, step };
}

const assert = (cond, detail) => ({ ok: Boolean(cond), detail });

const DRIVES = {
  async 'home-cover'({ b, step, snap }) {
    const { page, go } = b;
    const races = JSON.parse(readFileSync(join(REPO, 'src/data/races.json'), 'utf8'));
    const { cebuToday } = await import(pathToFileURL(join(REPO, 'src/scripts/next-race.mjs')).href);
    const { expectedFlash } = await import(pathToFileURL(join(SCRIPT_DIR, 'race-flash.mjs')).href);
    const buildDay = cebuToday(new Date(statSync(join(DIST, 'index.html')).mtimeMs));
    const today = cebuToday();
    const expected = expectedFlash(races, buildDay, today);
    await step('open-home', 'Open /', 'Masthead "Ac", name h1, Main nav with 4 links', async () => {
      await go('/');
      const mast = (await page.locator('.cover .masthead').textContent())?.trim();
      const h1 = (await page.getByRole('heading', { level: 1 }).textContent())?.trim();
      const nav = await page.getByRole('navigation', { name: 'Main' }).first().getByRole('link').allTextContents();
      return assert(mast === 'Ac' && h1.startsWith('Albert Christian Co') && nav.length === 4, { mast, h1, nav });
    });
    await snap('home-cover');
    await step('cover-lines', 'Read the "In this edition" list', '3 cover lines, each linking to /field-notes/<slug>/', async () => {
      const links = page.getByRole('list', { name: 'In this edition' }).getByRole('link');
      const items = await links.evaluateAll((as) => as.map((a) => ({ text: a.textContent.trim(), href: a.getAttribute('href') })));
      return assert(items.length === 3 && items.every((i) => /^\/field-notes\/[^/]+\/$/.test(i.href)), items);
    });
    await step('next-race', 'Read the next-race roundel', expected.present ? `"Next race: ${expected.race.name}" with data-until=${expected.race.date}, visible` : `No .flash roundel (${expected.reason})`, async () => {
      const flash = page.locator('.flash');
      const count = await flash.count();
      if (!expected.present) return assert(count === 0, { buildDay, today, reason: expected.reason, flashCount: count });
      const text = (await flash.textContent())?.replace(/\s+/g, ' ').trim();
      const until = await flash.getAttribute('data-until');
      const visible = await flash.isVisible();
      return assert(count === 1 && text.includes(expected.race.name) && until === expected.race.date && visible, { buildDay, today, text, until, visible });
    });
    await step('open-lead', 'Click the lead cover line', 'Lands on that post with a matching h1', async () => {
      const lead = page.locator('.coverline--lead a');
      const [title, href] = [(await lead.textContent()).trim(), await lead.getAttribute('href')];
      await lead.click();
      await page.waitForURL((u) => u.pathname === href);
      const h1 = (await page.getByRole('heading', { level: 1 }).textContent()).trim();
      return assert(h1 === title, { href, title, h1 });
    });
    await snap('home-cover-lead-post');
  },

  async 'coaching-form'({ b, step, snap, args }) {
    const { page, go, api } = b;
    const dry = Boolean(args['dry-run']);
    const stub = args.stub ?? 'ok';
    const values = { Name: 'Verify Bot', Email: 'verify-bot@example.invalid', 'Current training': 'Verification run: 4 sessions a week, no injuries.', Goal: 'Verification run: finish HYROX under 1:30.', 'Why me': 'Verification run, please ignore.' };
    const captured = [];
    await page.route('**/api/coaching', async (route) => {
      captured.push({ method: route.request().method(), body: route.request().postDataJSON() });
      await route.fulfill(stub === 'ok'
        ? { status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }
        : { status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'That email address does not look valid.' }) });
    });
    const form = page.locator('#intake-form');
    const submit = page.getByRole('button', { name: 'Send my application' });
    await step('open-coaching', 'Open /coaching/', 'h1 "Remote coaching", noindex, form and "Send my application" visible', async () => {
      await go('/coaching/');
      const h1 = (await page.getByRole('heading', { level: 1 }).textContent()).trim();
      const robots = await page.locator('meta[name="robots"]').getAttribute('content');
      return assert(h1 === 'Remote coaching' && /noindex/.test(robots) && await form.isVisible() && await submit.isVisible(), { h1, robots });
    });
    if (!dry) {
      await step('empty-submit', 'Press "Send my application" with every field empty', 'Browser validation blocks it: no /api request at all, Name is :invalid, "Received" stays hidden', async () => {
        await submit.click();
        await page.waitForTimeout(300);
        const nameInvalid = await page.getByLabel('Name', { exact: true }).evaluate((el) => el.matches(':invalid'));
        return assert(captured.length === 0 && api.length === 0 && nameInvalid && await page.locator('[data-done]').isHidden(), { captured: captured.length, apiRequests: api.length, nameInvalid });
      });
    }
    await step('fill', 'Fill Name, Email, Experience level=Advanced, Current training, Goal, Why me', 'Each field reads back the typed value; honeypot "Company" stays empty', async () => {
      for (const [label, value] of Object.entries(values)) await page.getByLabel(label, { exact: label !== 'Why me' }).fill(value);
      await page.getByLabel('Experience level').selectOption('Advanced');
      const read = {};
      for (const label of Object.keys(values)) read[label] = await page.getByLabel(label, { exact: label !== 'Why me' }).inputValue();
      read['Experience level'] = await page.getByLabel('Experience level').inputValue();
      const company = await page.locator('#in-company').inputValue();
      return assert(Object.entries(values).every(([k, v]) => read[k] === v) && read['Experience level'] === 'Advanced' && company === '', read);
    });
    await snap('coaching-filled', { fullPage: true });
    if (dry) {
      await step('dry-run', 'Stop before submit (--dry-run)', 'Submit never pressed, zero /api requests', async () => assert(captured.length === 0 && api.length === 0, { captured: captured.length, apiRequests: api.length }));
      return { submitted: false, stub: null, captured };
    }
    await step('submit-stubbed', `Press "Send my application" (POST /api/coaching stubbed: ${stub})`, stub === 'ok' ? 'One POST with the typed payload; form hides; "Received" region shows and takes focus' : 'One POST; status shows the server error; button re-enabled; form still visible', async () => {
      await submit.click();
      if (stub === 'ok') await page.locator('[data-done]').waitFor({ state: 'visible' });
      else await page.locator('[data-status][data-tone="error"]').waitFor();
      const body = captured[0]?.body ?? {};
      const payloadOk = captured.length === 1 && body.name === values.Name && body.email === values.Email && body.experience === 'Advanced'
        && body.training === values['Current training'] && body.goal === values.Goal && body.why === values['Why me'] && body.company === '';
      if (stub === 'ok') {
        const doneText = (await page.locator('[data-done]').textContent()).replace(/\s+/g, ' ').trim();
        const focused = await page.evaluate(() => document.activeElement?.hasAttribute('data-done'));
        return assert(payloadOk && await form.isHidden() && doneText.startsWith('Received') && focused, { payload: body, doneText, focused });
      }
      const status = (await page.locator('[data-status]').textContent()).trim();
      return assert(payloadOk && status === 'That email address does not look valid.' && await submit.isEnabled() && await form.isVisible(), { payload: body, status });
    });
    await snap(`coaching-submitted-${stub}`);
    return { submitted: true, stub, captured, note: 'POST /api/coaching was fulfilled inside the browser; nothing reached a server or Resend.' };
  },

  async 'field-notes'({ b, step, snap }) {
    const { page, go } = b;
    const items = page.locator('.archive__list > li');
    const visibleLabels = () => items.evaluateAll((lis) => lis.filter((li) => li.offsetParent !== null).map((li) => li.dataset.label));
    const notes = readdirSync(join(REPO, 'src/content/field-notes')).filter((f) => /\.mdx?$/.test(f) && !/^draft:\s*true/m.test(readFileSync(join(REPO, 'src/content/field-notes', f), 'utf8')));
    let total = 0;
    await step('open-archive', 'Open /field-notes/', `h1 "Field Notes", ${notes.length} notes listed (non-draft files in src/content/field-notes)`, async () => {
      await go('/field-notes/');
      total = (await visibleLabels()).length;
      return assert((await page.getByRole('heading', { level: 1 }).textContent()).trim() === 'Field Notes' && total === notes.length, { total, expected: notes.length });
    });
    let sum = 0;
    for (const label of ['Training', 'Building', 'Operating']) {
      await step(`filter-${label.toLowerCase()}`, `Choose the "${label}" filter`, `Only ${label} notes are visible`, async () => {
        await page.locator('.filter label').getByText(label, { exact: true }).click();
        const checked = await page.getByRole('radio', { name: label }).isChecked();
        const shown = await visibleLabels();
        sum += shown.length;
        return assert(checked && shown.length > 0 && shown.every((l) => l === label), { checked, shown: shown.length });
      });
    }
    await snap('field-notes-filter-operating');
    await step('filter-everything', 'Choose "Everything"', 'All notes visible again and the three filters partition them', async () => {
      await page.locator('.filter label').getByText('Everything', { exact: true }).click();
      const shown = (await visibleLabels()).length;
      return assert(shown === total && sum === total, { shown, sumOfFilters: sum });
    });
    await step('open-post', 'Click the first note', 'Post page: h1 matches, body has paragraphs, "Back to all Field Notes" link', async () => {
      const first = items.first().locator('a');
      const title = (await first.locator('.toc__title').textContent()).trim();
      await first.click();
      await page.waitForURL(/\/field-notes\/[^/]+\/$/);
      const h1 = (await page.getByRole('heading', { level: 1 }).textContent()).trim();
      const paras = await page.locator('.article__body p').count();
      const back = await page.getByRole('link', { name: 'Back to all Field Notes' }).count();
      return assert(h1 === title && paras > 0 && back === 1, { url: page.url(), h1, paras });
    });
    await snap('field-notes-post');
  },

  async 'post-like'({ b, step, snap, args }) {
    const { page, go, api } = b;
    const dry = Boolean(args['dry-run']);
    const captured = [];
    await page.route('**/api/reactions**', async (route) => {
      const r = route.request();
      captured.push({ method: r.method(), url: r.url(), body: r.postData() });
      const likes = r.method() === 'POST' ? 8 : 7;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ likes }) });
    });
    const slug = 'the-one-tool-coach';
    const btn = page.locator('[data-like-btn]');
    await step('open-post', `Open /field-notes/${slug}/ (GET /api/reactions stubbed: 7)`, 'Like widget unhidden, count 7, aria-pressed=false', async () => {
      await go(`/field-notes/${slug}/`);
      await page.locator('[data-like][aria-busy="false"]').waitFor();
      const count = (await page.locator('[data-like-count]').textContent()).trim();
      return assert(await btn.isVisible() && count === '7' && await btn.getAttribute('aria-pressed') === 'false', { count, label: await btn.getAttribute('aria-label') });
    });
    if (dry) {
      await step('dry-run', 'Stop before the heart (--dry-run)', 'Exactly one stubbed GET /api/reactions and no POST', async () => {
        const methods = captured.map((c) => c.method);
        return assert(methods.length === 1 && methods[0] === 'GET' && api.length === 1 && api[0].method === 'GET', { captured: methods, apiRequests: api.map((r) => r.method) });
      });
      return { clicked: false, captured };
    }
    await step('like', 'Click the heart (POST /api/reactions stubbed: 8)', 'POST {slug, action:"like"}; aria-pressed=true; count 8; localStorage liked:<slug>', async () => {
      await btn.click();
      await page.locator('[data-like-btn][aria-pressed="true"][aria-busy="false"]').waitFor();
      const count = (await page.locator('[data-like-count]').textContent()).trim();
      const post = captured.find((c) => c.method === 'POST');
      const stored = await page.evaluate((s) => localStorage.getItem(`liked:${s}`), slug);
      return assert(post && JSON.parse(post.body).action === 'like' && JSON.parse(post.body).slug === slug && count === '8' && stored, { count, post: post?.body, stored });
    });
    await snap('post-like-liked');
    return { clicked: true, captured, note: '/api/reactions was fulfilled inside the browser; no KV was touched.' };
  },

  async 'nav-footer'({ b, step, snap }) {
    const { page, go } = b;
    await go('/about/');
    const nav = page.getByRole('navigation', { name: 'Main' });
    for (const [name, path] of [['Writing', '/field-notes/'], ['Projects', '/projects/'], ['About', '/about/'], ['Contact', '/contact/']]) {
      await step(`nav-${name.toLowerCase()}`, `Click "${name}" in the Main nav`, `URL ${path}, that link has aria-current="page"`, async () => {
        await nav.getByRole('link', { name, exact: true }).click();
        await page.waitForURL((u) => u.pathname === path);
        const current = await nav.getByRole('link', { name, exact: true }).getAttribute('aria-current');
        return assert(current === 'page', { url: page.url(), current });
      });
    }
    await step('home-mark', 'Click the "Ac, home" mark', 'Lands on / with the cover', async () => {
      await page.getByRole('link', { name: 'Ac, home' }).click();
      await page.waitForURL((u) => u.pathname === '/');
      return assert(await page.locator('.cover').isVisible(), page.url());
    });
    await step('footer', 'Read the Footer nav', 'Writing, Projects, Power tool, GitHub with expected hrefs', async () => {
      const links = await page.getByRole('navigation', { name: 'Footer' }).getByRole('link').evaluateAll((as) => as.map((a) => [a.textContent.trim(), a.getAttribute('href')]));
      const want = [['Writing', '/field-notes/'], ['Projects', '/projects/'], ['Power tool', '/power/'], ['GitHub', 'https://github.com/albertchristianco-sudo']];
      return assert(JSON.stringify(links) === JSON.stringify(want), links);
    });
    await page.getByRole('navigation', { name: 'Footer' }).scrollIntoViewIfNeeded();
    await snap('nav-footer');
  },

  async 'about-contact'({ b, step, snap }) {
    const { page, go } = b;
    await step('about', 'Open /about/ and click "Read about remote coaching"', 'h1 present, lands on /coaching/', async () => {
      await go('/about/');
      const h1 = (await page.getByRole('heading', { level: 1 }).textContent()).trim();
      await snap('about');
      await page.getByRole('link', { name: 'Read about remote coaching' }).click();
      await page.waitForURL((u) => u.pathname === '/coaching/');
      return assert(h1.length > 0, { h1, url: page.url() });
    });
    await step('contact', 'Open /contact/', 'h1 present; Email link is mailto:ac@accoworks.dev (not clicked)', async () => {
      await go('/contact/');
      const h1 = (await page.getByRole('heading', { level: 1 }).textContent()).trim();
      const mail = await page.getByRole('link', { name: 'ac@accoworks.dev' }).getAttribute('href');
      return assert(h1.length > 0 && mail === 'mailto:ac@accoworks.dev', { h1, mail });
    });
    await snap('contact');
    await step('projects', 'Open /projects/', 'h1 present, at least one project link', async () => {
      await go('/projects/');
      const h1 = (await page.getByRole('heading', { level: 1 }).textContent()).trim();
      const links = await page.locator('main a').count();
      return assert(h1.length > 0 && links > 0, { h1, links });
    });
    await snap('projects');
  },
};

async function drive(args) {
  const feature = args._[1];
  if (!feature || !DRIVES[feature]) fail(`Unknown feature "${feature ?? ''}".`, `Use one of: ${Object.keys(DRIVES).join(', ')}.`, {}, 2);
  if (args.stub !== undefined && (feature !== 'coaching-form' || !['ok', 'error'].includes(args.stub))) fail(`Bad --stub ${args.stub} for ${feature}.`, '--stub ok|error applies to coaching-form only.', {}, 2);
  if (args.viewport !== undefined && !VIEWPORTS[args.viewport]) fail(`Unknown --viewport ${args.viewport}.`, 'Use desktop or mobile.', {}, 2);
  const state = requireRunning();
  const dir = join(outDir(args), `drive-${feature}`);
  mkdirSync(dir, { recursive: true });
  const b = await openBrowser(state, args);
  const { steps, step } = stepper();
  const artifacts = [];
  const snap = async (name, opts = {}) => {
    const path = join(dir, `${name}-${b.viewport}.png`);
    await b.page.screenshot({ path, fullPage: Boolean(opts.fullPage) });
    artifacts.push(path);
  };
  let extra = {};
  try {
    extra = (await DRIVES[feature]({ b, step, snap, args })) ?? {};
  } catch (e) {
    steps.push({ id: 'crash', ok: false, action: 'drive', expect: 'no exception', detail: e.message.split('\n')[0] });
  }
  await b.browser.close();
  const ok = steps.length > 0 && steps.every((s) => s.ok) && b.blocked.length === 0;
  const result = {
    ok, feature, viewport: b.viewport, dryRun: Boolean(args['dry-run']), url: state.url, revision: state.revision,
    steps, ...extra, apiRequests: b.api, blocked: b.blocked, httpErrors: b.httpErrors, consoleErrors: b.consoleErrors, artifacts, ranAt: new Date().toISOString(),
  };
  const json = join(dir, `result-${b.viewport}.json`);
  writeFileSync(json, `${JSON.stringify(result, null, 2)}\n`);
  out({ ...result, json }, ok ? 0 : 1);
}

// ---------- main ----------

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
if (args.help || !cmd) { process.stdout.write(`${HELP}\n`); process.exit(cmd || args.help ? 0 : 2); }
const COMMANDS = { launch, doctor, stop, routes, shot, drive };
if (!COMMANDS[cmd]) fail(`Unknown command "${cmd}".`, `Use one of: ${Object.keys(COMMANDS).join(', ')}. Run --help for details.`, {}, 2);
try {
  await COMMANDS[cmd](args);
} catch (e) {
  fail(`${cmd} crashed: ${e.message.split('\n')[0]}`, 'Run doctor; this is a control-app bug if doctor is ok.');
}
