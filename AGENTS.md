# AGENTS.md for accoworks.dev

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

- **Astro 6** (static output). `@astrojs/react` is registered in
  `astro.config.mjs` so React islands can be added later, but **no island is
  used today and no page may ship React**. `npm run check:no-react` is an npm
  script to run after `npm run build`; it scans `dist/` and fails if any page
  loads the React runtime. It is not yet wired into CI or `deploy.yml`: that
  is a pending workflow change (see the Sunday edition PR), so run it
  yourself before merging. If you add an island, add that page to
  `ALLOWED_PAGES` in `scripts/check-no-react.mjs` on purpose.
- **Cover layout check**: `npm run check:cover` (after `npm run build`) runs
  `scripts/check-cover-layout.mjs`. It serves `dist/` on a free local port,
  opens home in headless Chrome at 360x640, 390x844, 760x900, 768, 1024, 1366
  and 1440, with and without motion, and fails unless the cover has 12 grid
  tracks, the "Ac" masthead is wider than 100px, the name line is 4 lines or
  fewer, the cover nav is one row, and the race roundel overlaps neither the
  masthead nor the lead cover line. It needs Chrome (`CHROME_PATH`, default
  `/usr/bin/google-chrome`) and the `playwright-core` dev dependency, so it is
  not part of `npm test` or CI: run it yourself before merging any change to
  the cover, the grid tokens or the breakpoints. It stops its server itself.
- **MDX field notes** in `src/content/field-notes/`. Schema in
  `src/content.config.ts` (labels: Training | Building | Operating).
  `/field-notes/<slug>/` is the canonical post URL; `/writing/...` redirects
  there via `public/_redirects`.
- **Two layouts, two stylesheets (do not mix them):**
  - `src/layouts/EditionLayout.astro` + `src/styles/edition.css`: the
    "Sunday edition" design for home, `/field-notes/`, posts, `/projects/`,
    `/about/`, `/contact/`. Components live in `src/components/edition/`.
  - `src/layouts/BaseLayout.astro` + `src/styles/global.css`: legacy layout,
    still used by `/coaching/`, `/links/`, `/power/`, `/power/update/`.
- **Fonts**: Gloock (display) and Schibsted Grotesk (text), self-hosted from
  `public/fonts/`. No Google Fonts or CDNs.
- **Next race roundel** on the home cover reads `src/data/races.json`. The
  race is picked at **build time** (earliest race on or after the build date,
  Asia/Manila), so the deployed page does not update itself: after race day
  the site needs a rebuild (any push to `main`) to drop or advance the
  roundel. Until then a tiny inline script removes it once the Manila date is
  past its `data-until`; with JS off it stays visible. No scheduled deploy
  exists yet (pending workflow change). Edit the data, not the markup.
- **Like button**: `src/components/LikeButton.astro` + Cloudflare Pages
  Function `functions/api/reactions.js`, backed by Workers KV
  (binding `REACTIONS`, see `wrangler.toml`).
- Do not port the concept's TechText / React Bits name treatment: its
  MIT + Commons Clause license does not fit this public repo.

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

- Build: `npm run build`. Type/template check: `npx astro check`. After a
  build: `npm run check:no-react` and `npm run check:cover`. Tests: `npm test`.
- Keep one signature motion moment per page (home = the cover turning like a
  page on scroll). Motion is CSS scroll-driven first, with a tiny fallback
  script; everything sits inside `prefers-reduced-motion: no-preference` and
  the site reads fully with JS off. No scroll hijacking or preloaders.
- 21st.dev / Aceternity components are React + Tailwind; this project is
  plain CSS. Adapt them to plain CSS + small islands, do not add Tailwind.
- Removed on purpose (do not reintroduce): `GooeyTextMorph`, `TypewriterText`.
