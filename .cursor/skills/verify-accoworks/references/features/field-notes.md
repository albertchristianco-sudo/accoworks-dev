# Field Notes and the like button

Field Notes is the writing section. `/field-notes/` lists every non-draft MDX note, newest first, with a label filter that uses only CSS (Everything, Training, Building, Operating). Each post at `/field-notes/<slug>/` has a label, a date, a dek, a byline, the body, a heart "like" button, and "More Field Notes".

## Sub-features

- `archive-list` lists all non-draft notes in `src/content/field-notes/`.
- `archive-filter` shows only the chosen label's notes (radio + `:has()`; the fieldset is hidden without `:has()` support).
- `post-page` renders h1, dek, body, the "Back to all Field Notes" link and three more notes.
- `post-like` loads a count from `GET /api/reactions?slug=`, toggles on click with `POST /api/reactions {slug, action}`, and remembers it in `localStorage["liked:<slug>"]`.
- `writing-redirect` sends `/writing/*` with a 301 to `/field-notes/*`. This is Cloudflare `_redirects` only.

## How to get to it (user POV)

- Click `Writing` in the Main nav, `Read the writing` or `All Field Notes` on home, or `Writing` in the footer.
- Click a cover line or a contents entry on home.
- Visit an old `/writing/<slug>` URL (production only).

## Driving it with control-app

Preconditions:

- Baseline preconditions from the README hold.
- `control-app routes` lists `/field-notes/` and the post slugs.

- **Archive.** Run `control-app drive field-notes`. Step `open-archive` checks h1 "Field Notes" and that the visible count equals the non-draft files in `src/content/field-notes/` (16 at time of writing).
- **Filter.** Steps `filter-training`, `filter-building` and `filter-operating` click each visible label. Each checks that its radio is checked and every visible item has that `data-label`. `filter-everything` restores the full list and checks the three filters add up to it. `field-notes-filter-operating-desktop.png` shows a filtered list.
- **Open a post.** Step `open-post` clicks the first note. The post h1 matches, the body has paragraphs and the back link exists. `field-notes-post-desktop.png` shows the post.
- **Like (stubbed).** Run `control-app drive post-like`. Step `open-post` loads `/field-notes/the-one-tool-coach/` with `GET /api/reactions` stubbed to `{likes: 7}`: the widget is unhidden, shows `7`, and `aria-pressed="false"`. Step `like` clicks the heart with `POST` stubbed to `{likes: 8}`. It expects `aria-pressed="true"`, the count `8`, a captured body `{"slug":"the-one-tool-coach","action":"like"}` and `localStorage["liked:the-one-tool-coach"]` set. `post-like-liked-desktop.png` shows the liked state.
- **Like, load only.** Run `control-app drive post-like --dry-run`. The `dry-run` step passes only if exactly one stubbed GET happened and no POST: `captured` and `apiRequests` each hold a single GET.
- **Appearance.** Run `control-app shot /field-notes/ --viewport mobile` and `control-app shot /field-notes/the-one-tool-coach/ --full`.

## Gotchas

- The filter radios are 1px and invisible. Click the visible `label`; `check()` on the radio does not take.
- Without stubs, preview returns 404 for `/api/reactions`. The widget then says "Reaction count unavailable. You can still react." That is the correct local state, not a bug.
- Real counts live in production KV. Never point a drive at production to "check the real number".
- `/writing/...` redirects cannot be verified under astro preview. Report them as not verified locally.
- Drafts (`draft: true`) are excluded from the archive and from the expected count.
