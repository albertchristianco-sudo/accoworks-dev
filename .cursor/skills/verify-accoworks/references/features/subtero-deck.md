# Subtero at QOMPLEX deck

`/subtero-banilad/` is an unlisted (`noindex, nofollow`), standalone slide deck: a letter of intent from CrossFit Subtero to NAMCO Ventures Inc. for a hybrid training club at QOMPLEX, Banilad. It is plain static files in `public/subtero-banilad/` (`index.html`, `deck.css`, `deck.js`, `img/`), copied to `dist/` as is. It does not use either site layout and nothing on the site links to it. It has 13 full-screen slides, one shown at a time, with its own header, a progress bar, a `NN / 13` counter and Previous/Next arrows.

## Sub-features

- `deck-cover` shows slide 1: h1 "Subtero at QOMPLEX" (CSS uppercases it), "Prepared for" and "From", and a cue button (`#cue`, "Next slide") that reads "Press → or click to continue" on desktop and "Swipe to continue" on touch screens.
- `deck-step` moves one slide with the cue, the arrows (`#prev`/`#next`, "Previous slide"/"Next slide"), ArrowRight/PageDown/Space and ArrowLeft/PageUp, a horizontal swipe, a tap on the right or left third of the screen, or the wheel when the slide cannot scroll. Home/End jump to the first/last slide. Steps are ignored for 650ms after each one.
- `deck-progress` has one "Go to slide N: <title>" button per slide; the current one has `aria-current="step"`.
- `deck-hash` keeps the URL hash at `#<n>` and `document.title` at "<slide title> | Subtero at QOMPLEX". Opening `#<n>` starts on that slide.
- `deck-hint` hides the cue and the edge light once the visitor has navigated (`body.has-navigated`, remembered in `sessionStorage["subteroDeckNavigated"]`).
- `deck-plan` draws the layout plan SVG (`#plan`) on slide 8 from `deck.js`, rotated to portrait at 820px and below.
- `deck-close` ends on slide 13 "Let's talk" with a mailto and a crossfitsubtero.com link.

## How to get to it (user POV)

- Open the URL directly (it is shared by hand). There is no link from the site.

## Driving it with control-app

Preconditions:

- Baseline preconditions from the README hold.
- `control-app routes` lists `/subtero-banilad/` with `noindex: true`.

- **Open the deck.** Run `control-app drive subtero-deck`. Step `open-deck` checks robots `noindex, nofollow`, the h1, 13 slides, 13 progress buttons, slide 1 active, counter `01` and Previous disabled. `subtero-deck-cover-desktop.png` shows the cover.
- **Cue.** Step `cue` clicks `#cue`. Expects slide 2 "Who we are", hash `#2`, `has-navigated` on body and the `sessionStorage` flag `1`.
- **Keys.** Step `keys` presses ArrowRight (slide 3), End (slide 13, Next disabled, `is-last`) and Home (slide 1).
- **Progress.** Step `progress` clicks "Go to slide 8: Layout concept". Expects slide 8, `aria-current="step"` on that button and at least 5 `#plan g.pz` groups. `subtero-deck-plan-desktop.png` shows the plan.
- **Arrows.** Step `arrows` clicks Next (slide 9) then Previous (slide 8).
- **Tap (mobile).** Run `control-app drive subtero-deck --viewport mobile`. The extra step `tap` taps the right third of the screen and expects slide 9. The cover PNG shows "Swipe to continue".
- **Deep link.** Step `deep-link` opens `/subtero-banilad/#13` and expects "Let's talk", `is-last` and a mailto link (never clicked). `subtero-deck-close-<viewport>.png` shows it.

## Gotchas

- The deck loads Google Fonts (Anton, Inter) from `fonts.googleapis.com`. The network guard aborts it, so local proof renders with fallback fonts. The drive lists it under `blocked` but does not fail for it (`EXPECTED_BLOCKED` in `control-app.mjs`); anything else under `unexpectedBlocked` fails the drive. `control-app shot /subtero-banilad/` has no such allowance and reports `ok: false`; use the drive's PNGs instead.
- On first load `document.title` reads "Subtero at QOMPLEX | Subtero at QOMPLEX" (slide 1's title plus the suffix). That is current behavior, not a drive failure.
- Inactive slides are `inert` and `aria-hidden`, so role queries only find the active slide's content.
- `sessionStorage` carries the "navigated" hint across reloads in one tab. Each drive opens a fresh context, so the cue shows on open.
