# Claude Code Build Brief — Character Forge

Read `/Users/uther/ac-fun-projects/accoworks-dev/BUILD_PLAN.md` FIRST. It is the
authoritative spec. Implement ALL of it in ONE file only:
`/Users/uther/ac-fun-projects/accoworks-dev/public/ravenloft-forge/index.html`.
Do not modify any other file. Work in the `accoworks-dev` repo root.

## Non-negotiable scope (from the plan)
1. Rebrand to generic "Character Forge". Strip all Ravenloft content: `CAMPAIGN`
   object, "The Bell That Calls the Dead", Falkovnia, Mists hooks, Dark Quirks,
   Barovia. Replace personality fields with Trait / Ideal / Bond / Flaw.
2. Level selector 1-6. Replace the global `LEVEL = 4` / `PB = 2` constants with
   per-state level derivation. The CURRENT L1-4 values must remain byte-identical
   so the 5 existing characters rebuild exactly the same at level 4.
3. Derive from level: PB (+2 for 1-4, +3 for 5-6), spell slots, cantrip counts,
   prepared/known counts, spellbook, HP, ASI availability.
4. Feature filtering: sheet must show only features with `f[0] <= level`.
5. ASI: gate the level-4 improvement on level >= 4. FIGHTER gets an extra ASI at
   level 6 (2024 PHB) - a level-6 Fighter has TWO improvements (4 and 6).
6. accoworks branding: light-first, cobalt #2563EB accent, blueprint grid,
   Space Mono + IBM Plex Sans + JetBrains Mono. No Tailwind.

## Verified 2024 slot tables (use exactly these)
- Full casters (Bard, Cleric, Druid, Sorcerer, Warlock, Wizard):
  L1 [2], L2 [3], L3 [4,2], L4 [4,3], L5 [4,3,2], L6 [4,3,3]
- Half casters (Paladin, Ranger - cast from LEVEL 1 in 2024):
  L1 [2], L2 [2], L3 [3], L4 [3], L5 [4,2], L6 [4,2]
- Third casters (Eldritch Knight, Arcane Trickster):
  L3 [2], L4 [3], L5 [3], L6 [3]
- Cantrips: no NEW cantrip at 5-6 (next at L10). Keep verified L1-4 counts.

## Level 5-6 class features
Add the missing 2024-accurate level 5 and 6 features for EVERY class and subclass
the builder covers. Accuracy matters: use the real 2024 PHB feature names, levels,
and mechanics. Do NOT invent or import 2014-edition numbers. Key ones (verify each):
- Extra Attack at level 5: Barbarian, Fighter, Paladin, Ranger
- Barbarian Fast Movement at 5; Rage Damage increases (3 at level 9, but confirm the
  exact value at 5-6 in 2024 - do not guess, source it)
- Fighter level 6 ASI; Tactical Shift at 5
- Each subclass's 6th-level feature where one exists (e.g. Berserker Mindless Rage
  at 6, Evoker/Arcane Trickster 6th-level features, etc.). Source each.

## Preference on dynamic text
Where a feature text bakes in a number (e.g. "Rage Damage (2 at level 4)",
"your Cleric level (4)", Channel Divinity uses), make it level-correct or
level-dynamic where reasonable. Do not regress existing correct L4 values.

## Verify before you stop (report results)
- `cd /Users/uther/ac-fun-projects/accoworks-dev && npx astro check` (0 errors)
- `npm run build` (clean)
- Grep the file for `Ravenloft|Mists|Dark quirk|The Bell That Calls the Dead|Falkovnia|Barovia` - must be 0 hits
- Grep for em/en dashes (— or –) in the file - must be 0 hits
- Confirm a level-4 character rebuilds identically to before the change

Report: what you changed, the verification results, and any place where you were
uncertain about a level 5-6 value so it can be checked. Do not commit.
