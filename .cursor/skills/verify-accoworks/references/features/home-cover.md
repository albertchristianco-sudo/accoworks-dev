# Home cover and next race

The home page opens on a magazine cover: a huge "Ac" masthead over a duotone race photo, the name line as the page h1, the three newest Field Notes as cover lines, and a rotated "Next race" roundel taken from `src/data/races.json`. On scroll the cover turns like a page (CSS scroll-driven, reduced-motion safe) and reveals the contents, a pull quote, projects, profile and contact.

## Sub-features

- `cover-mast` shows the "Ac" masthead and the h1 "Albert Christian Co, coach, builder and operator in Cebu City."
- `cover-nav` puts the Main nav (Writing, Projects, About, Contact) in the cover strip.
- `cover-lines` lists the three newest notes under "In this edition", the first with a dek.
- `next-race` shows "Next race: <name>, <Mon D>" for the earliest race on or after the build day (Asia/Manila), and hides it client-side after `data-until`.
- `cover-click` opens a cover line's post.
- `cover-turn` turns the cover on scroll when motion is allowed.
- `pull-quote` shows a three-line quote below the contents, credited "From The IT Guy Was There First". The quote text is hard-coded in `src/pages/index.astro`; only the source note (looked up by slug) is read from content.

## How to get to it (user POV)

- Visit `/`.
- Click the `Ac, home` mark on any other edition page.

## Driving it with control-app

Preconditions:

- Baseline preconditions from the README hold.
- To expect a roundel, a race in `src/data/races.json` must fall on or after the day `dist/` was built.

- **Open home.** Run `control-app drive home-cover`. Step `open-home` reports `mast: "Ac"`, the h1 and four nav links. `home-cover-desktop.png` shows the cover.
- **Cover lines.** Step `cover-lines` lists three `{text, href}` items, each `/field-notes/<slug>/`.
- **Next race.** Step `next-race` compares the `.flash` roundel with the race the build should have picked. It prints `buildDay`, `today` (Manila, when the drive runs), the text (e.g. `Next race: HYROX Singapore, Nov 28`) and `data-until`. If the build picked no race, or today is after that race's date (the inline script has removed it), the step passes only if `.flash` is absent. Otherwise it needs exactly one visible `.flash` with that name and `data-until`. The decision is `expectedFlash()` in `scripts/race-flash.mjs`, tested by `tests/verify-race-flash.test.mjs`.
- **Click through.** Step `open-lead` clicks the lead cover line and checks the post's h1 equals the link text. `home-cover-lead-post-desktop.png` is the landing page.
- **Pull quote.** No drive step checks it. Fetch `/` and `/field-notes/the-it-guy-was-there-first/` from the preview and confirm each `.pull__line` text appears in the post body. If it is missing, the quote misquotes its source.
- **Mobile.** Run `control-app drive home-cover --viewport mobile`. The same steps run at 390x844.
- **Appearance.** Run `control-app shot / --viewport desktop` and `control-app shot / --viewport mobile`. Add `--motion` to capture with motion allowed.
- **Layout regression.** Run `npm run check:cover` after a build for the 9-viewport grid, masthead and roundel overlap checks. It is outside control-app and needs no running instance.

## Gotchas

- The roundel is chosen at build time. Change `races.json` or the date and you must `stop` + `launch` to rebuild; `--skip-build` keeps the old pick.
- After race day, a stale build still has the roundel in HTML; the inline script removes it only when JS runs and the Manila date is past `data-until`.
- Editing "The IT Guy Was There First" does not update the home pull quote. Known bug since b4c75b0 (2026-11-18): the post no longer contains "It was never a shift. It was a return. The IT guy was there first." but home still shows it under that credit. No test covers it.
- Clicking a post logs one expected `404 /api/reactions` (no Functions under preview).
- Full-page shots of home (`--full`) flatten the turning stage oddly. Use viewport shots for the cover.
- Do not port the concept's TechText / React Bits name treatment; a "fix" that adds React fails `npm run check:no-react`.
