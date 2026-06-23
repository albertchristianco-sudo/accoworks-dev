# AGENTS.md — accoworks.dev

Operational rules for any AI coding agent working in this repo. Read this
before touching anything.

## CRITICAL: this repo is pushed to from multiple hosts

`main` receives commits from **more than one machine**:
- This MacBook (`Acs-MacBook-Pro`)
- The **Mac mini** (`uther-mini`, git author `Uther <uther@uther-mini.local>`)
- Ac directly (`Ac <albertchristianco@gmail.com>`)

Your local clone WILL go stale. On 2026-06-13 an agent branched off a
13-day-old local `main`, did a full redesign, and nearly force-pushed over
a week of work done on the Mac mini. The push was rejected and it was
recovered, but do not repeat it.

**Always do this before branching or starting work:**

```sh
git fetch origin
git status -sb            # confirm you are not behind origin/main
git pull --rebase         # if behind (pull.rebase is configured true)
```

Then branch, build, verify, and merge. Never assume local `main` is current.

## Deploy = push to main (this is production)

Pushing to `main` triggers `.github/workflows/deploy.yml`, which runs
`npm ci && npm run build && npx wrangler pages deploy dist --project-name
landing-page --branch main`. So:

- Treat `main` as production. It auto-deploys to Cloudflare Pages
  (project `landing-page`, live at https://accoworks.dev).
- Do work on a branch, run `npm run build` and `npx astro check`, verify,
  then merge to `main` only when you intend to ship.
- Get Ac's OK before merging to `main` unless the change is small and verified.

## Stack

- **Astro 6** (static output), **React islands** via `@astrojs/react`
  (theme toggle, hero sparkles). Ship zero JS where it is not needed.
- **MDX field notes** in `src/content/field-notes/`. Schema in
  `src/content.config.ts` (labels: Training | Building | Operating).
- **Design system**: single file `src/styles/global.css`. Dark-first,
  light theme via `:root[data-theme="light"]`. Tokens drive everything.
- **Like button**: `src/components/LikeButton.astro` + Cloudflare Pages
  Function `functions/api/reactions.js`, backed by Workers KV
  (binding `REACTIONS`, see `wrangler.toml`).
- Logo (`/logo.svg`) is theme-tinted via CSS mask (`.brand-logo`), not an
  `<img>`. Do not revert it to `<img>` or it goes black on dark.

## Dependencies / npm audit

`npm install` reports ~10 audit findings (5 high from `esbuild`/`vite` via the
Astro/Vite build chain; 5 moderate from `yaml` via `@astrojs/check`). **All are
build/dev-time only** and do not ship. This is a static site with no Node
runtime in production, so none of these packages run for visitors.

- **Do NOT run `npm audit fix --force`.** The only fix it offers is a major
  downgrade (`astro` toward 2.x, `@astrojs/check` downgrade) that breaks the
  build. Uther correctly refused it on 2026-06-13.
- Leave them. They clear via a routine `npm update` once upstream ships
  patched ranges. Re-check with `npm audit` occasionally; don't chase the
  count.

## Debugging

When builds fail, deployments stall, or multi-host sync issues arise, load the
`systematic-debugging` skill. Reproduce, isolate, understand, then fix all
instances of the bug class at once. This project has a known failure mode
(multi-host `main` drift) that a single-symptom fix cannot resolve permanently.

## Conventions

- Build: `npm run build`. Type/template check: `npx astro check`.
- Keep one signature visual effect per page (home = sparkles, field notes
  = animated gradient title, projects = infinite-grid spotlight). Do not
  stack loud effects.
- 21st.dev / Aceternity components are React + Tailwind; this project is
  plain CSS. Adapt them to plain CSS + small islands, do not add Tailwind.
- Removed on purpose (do not reintroduce): `GooeyTextMorph`, `TypewriterText`.
