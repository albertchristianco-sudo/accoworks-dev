# Design System

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
