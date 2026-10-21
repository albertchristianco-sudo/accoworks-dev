# accoworks.dev verification map

This directory is the maintained source for verifying what a visitor can do on accoworks.dev. Read this index before driving the site. Then use the matching feature file as the recipe.

## Baseline preconditions

- Node >= 22.12 is first on `PATH`, and `npm ci` has run.
- `node .cursor/skills/verify-accoworks/scripts/control-app.mjs launch` returned `"ok": true` with a `http://127.0.0.1:<port>/` URL.
- `control-app doctor` returns `"ok": true`, with no `build-fresh` or `revision` warning. If either warning shows, run `stop` and `launch` to rebuild.
- `src/data/races.json` has a race on or after the build day, or you expect no roundel.
- Never drive https://accoworks.dev or any instance this run did not start.

## Driving conventions

- Every command below is `control-app <command>`, short for `node .cursor/skills/verify-accoworks/scripts/control-app.mjs <command>`.
- Each drive opens a fresh browser context: empty `localStorage` and reduced motion. Recipes start from the page they name.
- Prefer accessible names (`getByRole`, `getByLabel`) and the repo's `data-*` handles over CSS position.
- Run the mobile path with `--viewport mobile` whenever a feature changes layout. The cover, the nav and the coaching form all reflow at 760px.
- Treat `/api/*` as production-only. Locally it is either stubbed in the browser (coaching, reactions) or a 404.
- Cleanup with `control-app stop` keeps every artifact under `--out`.

## Proof and skip reporting

- Proof for a feature is its `drive-<feature>/result-<viewport>.json` with `"ok": true`, all steps ok, `blocked: []`, plus the PNGs it lists.
- For page appearance, add `control-app shot <route> --viewport desktop` and `--viewport mobile`.
- For stubbed submissions, quote the `captured` payload as the side-effect proof.
- Report the feature ID, viewport and any `--dry-run`/`--stub` flag with every artifact.
- Some paths cannot be verified locally: Cloudflare `_redirects` (`/writing/*`), real email delivery, and real KV counts. Report those as not verified locally. Do not count them as passed through a stub.

## Feature entry contract

Each feature file starts with an H1 and one paragraph on the visitor-facing behavior, then exactly four H2s in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with control-app` (starts with `Preconditions:`, then labeled bullets pairing an action, a command and an observable result), and `Gotchas`.

## Features

- [Home cover and next race](./home-cover.md) covers the masthead, cover lines, the next-race roundel and its build-time selection, and the click-through to the lead post.
- [Field Notes and the like button](./field-notes.md) covers the archive, its CSS-only label filter, post pages and the stubbed like button.
- [Remote coaching application](./coaching.md) covers `/coaching/`, form validation, fill, and stubbed submission in its success and error states.
- [Navigation and footer](./nav-footer.md) covers the Main nav and `aria-current`, the `Ac, home` mark and the footer links.
- [About, contact and projects](./about-contact.md) covers the three profile pages and their outbound links.
