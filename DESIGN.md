# Design System

## Current system: Sunday edition

A personal Sunday magazine. Used by home, `/field-notes/` and posts,
`/projects/`, `/about/` and `/contact/` through
`src/layouts/EditionLayout.astro` and `src/styles/edition.css`.

- Palette (Albert, Oct 12): a neutral cool grey base with a light blue
  accent. No pink, no sand, no teal. Tokens in `src/styles/edition.css`:
  - `--bg` `#F3F5F6`: page background.
  - `--surface` `#E3E7E9`: secondary panels (the projects column, sideboxes,
    "More Field Notes", code, image placeholders, chip hover).
  - `--line` `#C5CDD0`: hairline rules only, never text or a control edge.
  - `--ink` `#1C2326`: text, heavy rules, control borders, and the solid
    plate behind the cover, the profile and the mobile name line. Also the
    `theme-color`, which the layout reads from this token.
  - `--ink-soft` `#4E595E`: secondary text on `--bg` and `--surface`.
  - `--on-ink-soft` `#A7B2B6`: secondary text and hairlines on the ink
    plate.
  - `--accent` `#7FC8F8`: the light blue, for fills only. The Next race
    roundel (with ink text and an ink ring), the selected filter chip (which
    also gets a doubled ink border and heavier type, so selected and hover
    differ in greyscale), text selection, the progress bar, the liked heart
    (inside a deep blue stroke), and on the ink plate the cover-line rules,
    link underlines, the profile drop cap and focus rings. Never text, a
    rule or a ring on the light pages: it is 1.67:1 on bg. The filled side
    box inside the profile is a light panel, so links and rings there use
    the deep blue.
  - `--accent-ink` `#1A6393`: the deep blue of the same hue (about 204
    degrees). Link underlines, the active nav underline, drop caps, quote
    marks, list markers, the blockquote rule, the pole wires, the liked
    state, the scrollbar thumb and focus rings on the light pages.
  - `--on-accent` `#1C2326`: text on a light blue fill (ink; white is only
    1.82:1 there).
  - `--photo-tint` `#6E8084`, `--shade` `#0B0F11`, `--error` `#B3261E`: cover
    duotone highlight, page-turn shading, error text.
  Ratios: ink on bg 14.57:1, ink-soft on bg 6.59:1, ink on surface
  12.80:1, ink-soft on surface 5.79:1, accent-ink on bg 5.91:1,
  accent-ink on surface 5.19:1, ink on accent 8.74:1, accent ring on ink
  8.74:1, accent-ink ring on bg 5.91:1, bg on ink 14.57:1, on-ink-soft on
  ink 7.35:1, error on bg 5.98:1. Cover text reads at 5.45:1 or better over
  the brightest duotone pixel (`#58666A`), and the light blue roundel and
  rules read at 3.27:1 against it. Tests assert the token values and these
  pairs.
- Grid (Albert, Oct 12: "text placements not in-line"): every edition section
  is the same container (`--max`, `--gutter`) holding twelve `--cols` with
  `--gap`. Section titles, letters, photos and the byline sit in `--aside`
  (columns 1 to 4; 1 to 5 at 1080px and below). Lists, the article dek and
  body, the contact list and the footer address start at `--content-start`
  (column 5; 6 at 1080px and below), so they share one edge on every page.
  Two-column lists (note dates, contact labels) use `--label-col`, two of
  their grid columns; `--content-cols` is derived from `--content-start`.
  The briefs and the footer links sit on `--rail` (the last four columns,
  five at 1080px and below), the profile side boxes on `--rail-narrow` (the
  last three). The article dek, body, reactions and sign-off run from the
  content edge and stop at `--measure` (37rem, about 68 characters a line),
  so they share both edges. Pull-quote steps are whole grid columns. The
  "Ac" marks are moved right by `--mark-bearing` (Gloock's "A" overhangs by
  .03125em) so their ink sits on the gutter. Right-set cover lines and the
  cover nav share the right gutter; above 1080px the footer links do too,
  and at 1080px and below they drop under the address on the content edge.
  At 1080px and below a post (head, body and the More list) is one column
  on the gutter, capped at `--measure`, so it reads at the same measure on
  tablets as on phones. At 760px and below the content grids are one
  column on the gutter. The cover always keeps its twelve columns (the
  roundel and the cover lines are placed on them); `npm run check:cover`
  checks that in Chrome. Check with the alignment audit before changing any
  of these.
- Type: Gloock for display (masthead, headlines, drop caps, pull quote),
  Schibsted Grotesk for text and UI. Both self-hosted from `public/fonts/`.
- Home: magazine cover with a giant "Ac" masthead over a duotone photo,
  real post titles as cover lines (newest first, from the content
  collection), and a "Next race" roundel from `src/data/races.json`. The
  name line gets a solid ink plate on phones so it stays legible.
- Signature motion: the cover turns like a page on scroll to reveal the
  Field Notes spread. Supporting motion: hero depth layers, pull quote
  lines printing in, the power pole drawing itself, rules drawing across.
  CSS scroll-driven animations first, `html.fx` fallback script second,
  both only under `prefers-reduced-motion: no-preference`. Reduced motion
  shows the final composed state. Transform, opacity, clip-path and
  stroke-dashoffset only. Content is fully readable with JS off.
- Field Notes list: Training / Building / Operating filter built from radio
  inputs and `:has()`; without `:has()` the filter hides and every note
  shows.
- Copy: sentence case for UI text and headings (published post titles stay
  as written). No em or en dashes, arrow glyphs, middle dots or emoji.

The sections below describe the legacy system that still styles
`/coaching/`, `/links/`, `/power/` and `/power/update/` through
`BaseLayout.astro` and `global.css`.

## Direction

Operator's field manual. The site should resemble well-made workshop documentation and a personal field record: structured, useful, specific, and visibly handled by a human. Photography, rules, annotations, and evidence carry the identity. Decorative software motifs remain secondary.

## Theme and Color

Light-only, designed for daytime reading on phones and laptops. Preserve the existing cool-paper and cobalt identity.

- Page: `#F5F7FB`
- Secondary surface: `#EDF1F7`
- Card surface: a subtly blue-tinted near-white, not pure white
- Primary ink: `#0D1526`
- Secondary ink: `#4C586C`
- Muted ink must meet WCAG AA at normal text sizes
- Accent: `#2563EB`
- Sky blue may be used decoratively, not as low-contrast text
- Rose remains reserved for the reaction control

Use cobalt as a solid signal for links, focus, selected states, and short emphasis. Do not use gradient text.

## Typography

Replace Space Mono as the display face. Use a human technical sans or grotesk with a distinct editorial voice for headlines. Retain IBM Plex Sans for body copy and JetBrains Mono for short metadata, dates, tags, and operational annotations. Monospace is texture, not the main personality.

Headings use strong scale and controlled wrapping. Body copy stays between 65 and 75 characters per line with generous line height. Metadata remains readable and must not rely on low contrast.

## Layout

Use the existing 1180px maximum width and responsive gutters. Favor asymmetrical editorial layouts, full-width ruled entries, and varied section rhythm over repeated card grids. The home hero leads with identity and action on every viewport. Photography supports the story without displacing the value proposition.

Projects are evidence-led records with clear status, stack, outcome, and verified public destination when available. Private work is explicitly labeled and remains unlinked. Field Notes prioritize scanning and reading. The links page stays compact and functional.

## Graphic System

Use one strong cobalt chapter band on the home page as the visual anchor. Oversized low-opacity folio numbers, thin registration marks, timeline rules, and short monospace annotations make the field-manual idea visible without turning the site into a terminal costume. A small pre-rasterized repeating texture adds restrained paper grain without runtime SVG filters or compositing effects.

Each major page gets one distinct device: documentary chapter band and field strip on Home, vertical operating timeline on Projects, featured current issue plus ruled archive on Field Notes. Links stays deliberately quieter. Graphic devices remain decorative to assistive technology and may never obscure content or create horizontal overflow.

## Components

- Header: quiet sticky navigation, visible focus, 44px mobile hit areas, skip link
- Buttons: solid cobalt primary and restrained text or bordered secondary
- Project record: ruled editorial row or feature, only linked when the whole surface is actionable
- Tags: use sparingly for status and category
- Field-note row: stable layout, no padding animation
- Reaction control: loading, success, failure, and announced count changes
- Footer: readable metadata and comfortable touch targets

## Motion

Motion is subtle and optional. Use opacity and transform only. Remove particles, animated gradient text, layout-property transitions, and permanent `will-change`. All content is visible without JavaScript. Respect reduced-motion preferences.

## Imagery

Use Ac's real photography. Serve responsive AVIF and WebP sources with explicit dimensions and sensible crops. Above-fold imagery receives fetch priority; below-fold imagery loads lazily. Documentary strips become a single readable column on narrow screens rather than shrinking into illegible thumbnails.

## Anti-patterns

No gradient text, sparkles, decorative terminal command pills, glass effects, nested cards, identical card galleries, glow-heavy hover states, or hover affordances on static content. Do not introduce new colors beyond the established palette without a semantic need.
