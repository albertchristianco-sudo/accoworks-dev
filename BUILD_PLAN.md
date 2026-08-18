# Character Forge — Rebrand & Level-Selector Build Plan

_Last updated: 2026-08-18_

## What this is
Rework `public/ravenloft-forge/index.html` (currently the level-4 "Ravenloft Character
Forge" one-shot builder) into a **generic D&D 2024 character builder**, retitled
**Character Forge**, with a **level selector (1–6)** and **accoworks house branding**.
Keeps the `/ravenloft-forge/` URL path (no route change).

## Locked decisions (do not revisit)
- **Pure generic.** Strip ALL campaign content: the `CAMPAIGN` object, "The Bell That
  Calls the Dead", Falkovnia, Ravenloft, Mists hooks, Dark Quirks, Barovia references.
- **Retitle, keep path.** New name "Character Forge"; URL stays `accoworks.dev/ravenloft-forge/`.
- **Level selector 1–6.** Not full 1–20.
- **No homebrew.** All five party classes are covered by 2024 PHB options already present
  (Goliath Barbarian, Ranger, Rogue Arcane Trickster, Wizard Evoker, Fighter Champion).
- **accoworks branding.** Light-first, cobalt `#2563EB`, blueprint grid, Space Mono /
  IBM Plex Sans / JetBrains Mono. Premium command-center feel. Do not add Tailwind.
- **2024 Player's Handbook only.** No content from other books.

## Current structure (verified by inspection)
- `LEVEL = 4` at line 1702, `PB = 2` at 1703: global constants used by `compute()`.
- `STATE` at 1471 has `level: 4`; personality fields `trait/ideal/bond/flaw/mistsHook/darkQuirk` at 1772.
- `CAMPAIGN` 1467–1473, `MISTS_HOOKS` 1476, `DARK_QUIRKS` 1485; exported at 1678–1680.
- `STEPS` array at 2681: species, background, class, subclass, ..., `{ id:'level4' }` at 2688.
- Class/subclass `features` arrays are **already level-tagged** as `[level, name, text]`
  (e.g. `[3, 'Frenzy', ...]`). `compute()` pushes ALL features (lines 2477, 2484) then sorts
  (2488) but does **not filter by level** — the sheet currently shows everything.
- ASI: single `level4` step, `asiMode` = plus2 | plus1plus1 | feat (lines 2545–2549, 3378–3404,
  handler 3775–3776).
- HP math uses `LEVEL` directly (lines 2300, 2302) — must become level-dependent.
- Feature texts bake in level 4 values (e.g. "Rage Damage bonus (2 at level 4)",
  "your Cleric level (4)"). These must become level-correct.
- Meta/title/sub copy are Ravenloft-specific (title, meta description, intro `<p class="sub">`,
  "The one-shot" block at ~2752).

## Scope of work

### 1. Rebrand (strip Ravenloft, generic personality)
- Title → `Character Forge`; meta description → generic D&D 2024 builder.
- Sub copy → "Build a D&D 2024 character. All rules and text come from the 2024 Player's
  Handbook. The builder does the arithmetic; you make the choices."
- Remove `CAMPAIGN` object, `MISTS_HOOKS`, `DARK_QUIRKS`, the one-shot intro block,
  "travelling toward <destination>" line, and every Ravenloft/Falkovnia/Mists/Dark Quirk
  reference in copy and markup.
- Personality fields become standard **Trait / Ideal / Bond / Flaw** (drop `mistsHook`/
  `darkQuirk` state, renderers, exporters, and handlers).
- Update the exported `D` object (drop CAMPAIGN/MISTS/DARK_QUIRKS).

### 2. Level selector 1–6
- Add `state.level` (default 4); replace global `LEVEL` with a per-state level.
- Add a level picker in the header/controls (1–6).
- **Derive from level**, with the CURRENT L1–4 values preserved exactly (so the 5 existing
  characters rebuild identically):
  - **PB**: +2 for levels 1–4, +3 for 5–6.
  - **Spell slots** (2024 PHB):
    - Full casters (Bard, Cleric, Druid, Sorcerer, Warlock, Wizard):
      L1 `[2]`, L2 `[3]`, L3 `[4,2]`, L4 `[4,3]`, L5 `[4,3,2]`, L6 `[4,3,3]`.
    - Half casters (Paladin, Ranger): L1 `[2]`, L2 `[2]`, L3 `[3]`, L4 `[3]`, L5 `[4,2]`, L6 `[4,2]` (2024: they cast from level 1).
    - Third casters (Eldritch Knight, Arcane Trickster): L3 `[2]`, L4 `[3]`, L5 `[3]`, L6 `[3]`.
  - **Cantrips**: no NEW cantrip at 5–6 (next is L10) — keep the verified L1–4 counts.
    Cantrip damage scales at L5 (2nd damage die) — note/implement where the spells data allows.
  - **Prepared/known**: keep the builder's established model. Cleric/Druid/Paladin/Ranger
    prepare `level + casting mod`; Wizard prepares from a growing spellbook; Bard/Sorcerer/
    Warlock use known-count tables. Extend the L5–6 rows with source-verified counts.
  - **HP**: `hitDie + con` per level up to the selected level (replace `* LEVEL` at 2300/2302
    with the selected level).
  - **Features**: filter class/subclass features to `f[0] <= level` (sheet currently shows all).
    Add the missing L5–6 features per class/subclass with 2024-accurate text.
  - **ASI/feat**: level ≥ 4 gates the `level4` step. **Fighter gets an extra ASI at level 6**
    (2024 PHB) — handle the Fighter level-6 ASI so a level-6 Fighter has two improvements.
- Verify all L1–6 arithmetic with the runtime harness (see Verify).

### 3. accoworks branding
- Restyle from the current dark navy/gold to the house design language: **light-first,
  cobalt `#2563EB` accent, blueprint grid, Space Mono + IBM Plex Sans + JetBrains Mono**.
- Keep it a premium command-center look appropriate for a character builder.

## Verified L1–4 values to preserve (do not regress)
- PB +2, cleric slots 4/3, cleric cantrips 4, bard 3, druid 3, warlock 3, sorcerer 5, wizard 4.
- Wizard spellbook 12 @ L4; monk Focus 4 @ L4.
- Alignment field renders and exports.

## Verify gates (must all pass before merge)
1. `npx astro check` → 0 errors.
2. `npm run build` → clean (18 pages).
3. Runtime math harness over levels 1–6: PB, slots, cantrips, prepared/known counts,
   spellbook, HP, ASI availability, feature filtering, alignment render. **L1–4 values
   byte-identical to current; L5–6 match the 2024 PHB.**
4. Render check via headless Chrome (screenshot) — visual sanity, accoworks look.
5. `Codex` review of the diff.

## Non-negotiable rules
- No em/en dashes in copy. Zero after rebuild (verify).
- No campaign content (Ravenloft OR Theros) in the builder. It is a generic tool.
- No Tailwind; keep the single-file HTML + embedded CSS.
- Deploy = push to `main` (Cloudflare Pages). Get Ac's OK before merging.
- Multi-host repo: `git fetch origin` + confirm not behind before work; commit clean each session.

## Operational reference
- Builder: `public/ravenloft-forge/index.html` (single-file, ~4,500 lines).
- Runtime harness: `/tmp/forge-math-harness.js` (197 checks, all green levels 1-6).
- Astro check: `npx astro check` (repo root). Build: `npm run build` (repo root).
- Render: headless Chrome screenshot of the built file.
- Deploy: push to `main` → GitHub Actions → Cloudflare Pages → accoworks.dev/ravenloft-forge/.

## Shipped (2026-08-18) + known follow-up
SHIPPED: generic "Character Forge" rebrand (Ravenloft stripped), level selector 1-6
(level 4 default), accoworks branding (light, cobalt #2563EB, blueprint grid),
generic Trait/Ideal/Bond/Flaw, three Codex review rounds applied. Deployed to
accoworks.dev/ravenloft-forge/ (HTTP 200 verified). Merge commit 537e9da.

KNOWN FOLLOW-UP (does not affect the current level-4 Theros party; all level-5/6
or out-of-roster subclasses). Fix if/when the builder is touched next:
1. Level-3 spell-list errors in the ~52 recalled entries: Aura of Vitality wrongly on
   Cleric; Summon Fey offered to all Wizards (Illusionist-only here); Summon Undead
   wrongly on Wizard; Wall of Water not in 2024 class lists (Ranger should have
   Conjure Barrage instead).
2. Savant bug: at Wizard 5 the picker allows all three Savant spells at level 3; the
   original two must stay level 2 or lower.
3. Invocation data: Eldritch Smite knocks Huge-or-smaller prone (not Large); Gaze of
   Two Minds is a Bonus Action with 60-ft range and BA renewal; only 4 of 8 PHB
   level-5 invocations present (missing Ascendant Step, Investment of the Chain
   Master, Master of Myriad Forms, One with Shadows).
4. Phantasmal Creatures text: one shared Long-Rest slot-free cast (either spell),
   not one free cast of each.
5. Spell-data additions (52 level-3 entries) came from recall; spot-check names,
   class lists, and schools (school matters for Wizard Savant) against the 2024 PHB.
