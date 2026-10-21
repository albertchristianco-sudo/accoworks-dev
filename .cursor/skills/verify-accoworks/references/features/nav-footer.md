# Navigation and footer

Every edition page has the Main nav (Writing, Projects, About, Contact). On home it sits in the cover strip. On every other edition page it sits in the running head next to an `Ac, home` mark. Every page ends with a footer that has the "Ac" mark, the location, a Footer nav (Writing, Projects, Power tool, GitHub) and the copyright line. A "Skip to content" link targets `#main-content`.

## Sub-features

- `nav-links` takes each Main nav link to its section.
- `nav-current` puts `aria-current="page"` on the link for the section index and `"true"` inside a section (e.g. on a post under `/field-notes/`).
- `home-mark` links the running-head `Ac, home` mark to `/`.
- `footer-links` gives the Footer nav its hrefs: `/field-notes/`, `/projects/`, `/power/` and the GitHub profile.
- `skip-link` moves focus to the main content.

## How to get to it (user POV)

- Look at the top of any edition page, or at the cover strip on home.
- Scroll to the bottom of any page.
- Press Tab once on page load to reveal "Skip to content".

## Driving it with control-app

Preconditions:

- Baseline preconditions from the README hold.

- **Main nav.** Run `control-app drive nav-footer`. Starting on `/about/`, steps `nav-writing`, `nav-projects`, `nav-about` and `nav-contact` click each link by name. Each one checks the URL path and that the clicked link now has `aria-current="page"`.
- **Home mark.** Step `home-mark` clicks `Ac, home` and expects `/` with the cover visible.
- **Footer.** Step `footer` reads the Footer nav and checks the four `[text, href]` pairs exactly. The GitHub link is read, not clicked, because external origins are blocked. `nav-footer-desktop.png` shows the footer.
- **Mobile.** Run `control-app drive nav-footer --viewport mobile`. The nav must stay usable at 390px.

## Gotchas

- `Power tool` (`/power/`) uses the legacy BaseLayout and has its own `/api/*` calls (outages, fyi, where). Under preview they 404. Do not judge that page from a local shot.
- Home has no running head and no `Ac, home` mark; its Main nav lives in `.cover__strip`. Start the nav drive from a non-home page (it starts on `/about/`).
- `skip-link` is not scripted yet. To check it, press Tab on load in a one-off script and confirm focus lands on `#main-content`.
- External links (GitHub, Instagram, LinkedIn, Facebook) are verified by href only. Clicking them is blocked by the network guard and would fail the drive.
