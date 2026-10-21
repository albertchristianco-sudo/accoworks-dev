---
name: verify-accoworks
description: Verify accoworks.dev (Ac's Astro static site, deployed to Cloudflare Pages) the way a visitor uses it, against a LOCAL build only. Builds dist/, serves it with astro preview on a free 127.0.0.1 port, and drives it in headless Chrome with control-app (launch, doctor, routes, shot, drive, stop) to prove the home cover and next-race roundel, Field Notes and the like button, the coaching application form, nav/footer and the about/contact/projects pages. Use it to confirm a change works in the rendered site, to take desktop/mobile screenshots, or whenever a task says "verify", "screenshot" or "prove it" for this repo.
---

# Verify accoworks.dev

accoworks.dev is a static Astro 6 site (no React shipped). Visitors touch web pages only: the home "cover", `/field-notes/` and its posts, `/projects/`, `/about/`, `/contact/`, the unlisted `/coaching/` application form, and the legacy `/links/` and `/power/` tools. Two pieces of behavior live in Cloudflare Pages Functions (`functions/api/*`): the coaching form's `POST /api/coaching` (emails Ac through Resend) and the like button's `/api/reactions` (Workers KV). **`astro preview` does not run Pages Functions**, so locally every `/api/*` call 404s unless a drive stubs it in the browser.

`main` is production: a push deploys to https://accoworks.dev. This skill never builds for, pushes to, or requests production. Every browser context it opens aborts any request whose origin is not the local preview and reports it under `blocked`.

The lever is `scripts/control-app.mjs` (no extra dependencies: it uses the repo's `playwright-core` devDependency and the system Chrome). Every command prints one JSON object on stdout, errors included. Exit codes: `0` ok, `1` a check failed, `2` usage error (including any unknown option, so a typo such as `--dryrun` stops the run instead of being ignored).

```sh
C=.cursor/skills/verify-accoworks/scripts/control-app.mjs
node $C --help                    # full usage
npm run -s control-app -- doctor  # same tool via npm; -s keeps stdout pure JSON
```

## Requirements

- **Node >= 22.12** (package.json `engines`; Astro refuses older). Both the `node` running control-app and the `node` on `PATH` (used by `npm run build`) must qualify. `launch` and `doctor` check this and say what they found. If the default node is too old, put a newer one first on PATH for the whole session, e.g. `export PATH=/path/to/node22/bin:$PATH`.
- `npm ci` done (`node_modules/astro`, `node_modules/playwright-core`).
- Chrome at `/usr/bin/google-chrome`, or set `CHROME_PATH`.

## Launch

```sh
node $C launch            # npm run build, then astro preview on 127.0.0.1:<free port>
node $C launch --skip-build   # serve the existing dist/ as is
```

Ready means the command returned `"ok": true`: it only returns after `GET /` answered 200. The JSON gives `url`, `port`, `pid`, the git `revision` and the build log path. State lives in `node_modules/.cache/verify-accoworks/state.json` (build and preview logs sit next to it). `npm ci` deletes it, so run `stop` before `npm ci`. Running `launch` again while our instance is healthy reuses it (`"reused": true`). If our instance is alive but not answering, `launch` stops it before starting a new one. An unusable state file makes `launch` fail, so run `stop` first. To pick up source changes, `stop` and then `launch`, because preview serves `dist/` as built.

Isolation: one instance per checkout (one state file). Separate checkouts or worktrees get separate free ports and can run side by side. Preview is a read-only static server, so two agents in the same checkout can drive one instance, but `stop` ends it for both. Never drive a server this tool did not start (for example a `npm run dev` someone else left running).

## Doctor

```sh
node $C doctor
```

Read-only. Run it first, and again whenever anything looks off. It checks: the state file is present and valid (integer pid that is also the pgid, `http://127.0.0.1:<port>/` URL), the PID is alive, that PID's argv contains, in order, this checkout's `node_modules/astro/bin/astro.mjs preview --host 127.0.0.1 --port <port>` (from `/proc/<pid>/cmdline`; without `/proc`, the same sequence joined with spaces in `ps -ww -o command=`, so paths with spaces work), `GET /` returns 200 with Astro's generator tag and "Albert Christian Co", the URL is 127.0.0.1, Node version, Chrome, playwright-core. It **warns** without failing when git HEAD moved since launch or when `src/`/`public/` changed after the build: in that case stop and relaunch before you trust anything. `"ok": true` means the instance is worth driving.

## Drive

```sh
node $C routes                                   # every page in dist/ + Cloudflare-only redirects
node $C drive <feature> [--viewport desktop|mobile] [--out DIR] [--dry-run] [--stub ok|error]
node $C shot <route> [--viewport desktop|mobile] [--out DIR] [--full] [--motion] [--name NAME]
```

Features: `home-cover`, `coaching-form`, `field-notes`, `post-like`, `nav-footer`, `about-contact`. Each one is a scripted user path that uses accessible names and the repo's stable handles (`#intake-form`, `[data-done]`, `[data-status]`, `[data-like-btn]`, `.flash[data-until]`, `nav[aria-label=Main|Footer]`). It prints every step as `{id, ok, action, expect, detail}`. The feature map in [`references/features/README.md`](references/features/README.md) is the source of truth for what each feature covers, its entry points and its traps: read the matching file before driving.

Viewports: `desktop` = 1440x900 @1x; `mobile` = 390x844 @2x with touch. Reduced motion is on by default, so the home cover does not turn mid-capture; `--motion` turns it off for `shot`. `shot` captures the viewport only unless you pass `--full`.

Side effects: only `coaching-form` and `post-like` would have any, and only in production. Locally they stub their `/api/*` call inside the browser, record the exact request body under `captured`, and assert the UI's response. `--dry-run` goes further and never presses the submitting control (coaching-form never submits; post-like loads the count but never clicks the heart).

For anything the drives do not script, write a one-off playwright-core script that reads `url` from the state file. Copy the network guard in `openBrowser()` so it stays local-only.

## Evidence

- Default output is `.verify-proof/` (gitignored). Pass `--out DIR` to put it somewhere else, e.g. a task's proof folder.
- `drive <feature>` writes `<out>/drive-<feature>/result-<viewport>.json` (steps, captured API payloads, `apiRequests`, `blocked`, `httpErrors`, `consoleErrors`, git revision) plus a PNG for each key state (`*-<viewport>.png`).
- `shot` writes `<out>/<route-slug>-<viewport>.png` (or `<out>/<NAME>.png`; `--name` must be a plain file name) and a sibling `.json` (status, title, h1, blocked requests, console errors). A relative `--out` resolves against the directory you ran the command from, under `npm run` too.
- Proof standards:
  - Drive the real user path: click the visible label, fill by label, press the named button. Do not set state from the console.
  - Capture the action and the state it produced. A filled-form PNG is not proof of submission; the `submit-stubbed` step plus the "Received" PNG is.
  - Check side effects alongside what is on screen: the stubbed POST body has to match what was typed, and the like button's `localStorage` key has to be written.
  - Stubs only at the Pages Function boundary (`/api/coaching`, `/api/reactions`), which is where production talks to Resend and KV.
- `blocked` must be `[]`. A non-empty list means the page tried to leave localhost, and the drive or shot marks itself failed.
- Under `--dry-run`, check the JSON rather than trusting the flag (the `dry-run` step asserts it too). `coaching-form`: `captured` and `apiRequests` are both empty. `post-like`: exactly one stubbed `GET /api/reactions` in `captured` and `apiRequests`, and no POST, because the page loads the count on open.
- Expected noise: post pages (and home, after clicking through to a post) log one `404 /api/reactions?slug=...` in `httpErrors` and `consoleErrors`, because preview has no Functions. Any other 404 is a real finding.

## Cleanup

```sh
node $C stop
```

`stop` first checks that the recorded PID is still this checkout's `astro preview` on the recorded port, and checks again before each signal. It sends SIGTERM, then SIGKILL after 4s, to that PID's process group when the PID leads one (launch starts it that way) and to the PID alone otherwise. Then it deletes the state file and confirms the port is closed (exit 1 if something still answers). It never kills by process name and never deletes evidence: `.verify-proof/` or your `--out` directory survives. If the state file's PID is gone or reused, stop removes the file without killing anything. If the state file is unusable (bad JSON, pgid not equal to pid, a non-127.0.0.1 URL), stop removes it, lists this checkout's previews under `previews`, and kills none of them. Run `stop` after every failed iteration too. After stopping, `ps -eo pid,args | grep "[a]stro.mjs preview"` should print nothing for this checkout.

## Helpers

- `scripts/control-app.mjs`: the only helper. It is executable, `--help` documents it, and `npm run -s control-app -- <command>` also runs it.
- The repo's own checks complement this skill but do not replace it: `npm test` (source contracts), `npm run check:no-react` and `npm run check:cover` (cover layout at 9 viewports; it needs a build and Chrome).
- Keeping the map current: when a route, form field or nav item changes, update the matching `references/features/*.md` file and the drive in `control-app.mjs` in the same change.
