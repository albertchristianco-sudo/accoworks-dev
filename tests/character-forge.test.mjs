import assert from 'node:assert/strict';
import test from 'node:test';

import { loadForge, loadFixtures, readBaseline, digest, clone } from './support/load-forge.mjs';

const { D, APP } = loadForge();
const FIXTURES = loadFixtures();
const BASELINE = readBaseline().characters;
const STEP_IDS = APP.STEPS.map((s) => s.id);

function issues(st) {
  const out = {};
  for (const id of STEP_IDS) {
    if (!APP.stepApplies(st, id)) continue;
    const list = APP.stepIssues(st, id);
    if (list.length) out[id] = [...list];
  }
  return out;
}

// A fixture as the page reads it back from storage.
const hydrated = (fx) => APP.hydrate(clone(fx.sheet));

// The page's boot path: hydrate the stored object, then normalize it.
function boot(sheet) {
  APP.setState(APP.hydrate(clone(sheet)));
  APP.normalize();
  return APP.getState();
}

function setLevel(st, n) {
  APP.setState(st);
  APP.setLevel(n);
  return APP.getState();
}

const SKILLED = { 'kaelen-nightshade': ['Acrobatics', 'Sleight of Hand', 'Arcana'], 'mortimer-vale': ['History', 'Religion', 'Perception'] };

// Step issues a fix deliberately raises on a fixture as recorded: both
// Paladins wear and wield gear they never paid for.
const GEAR_FLAGGED = { 'baldwin-eisenstrom': ['Breastplate', 'Greatsword'], 'erwin-eisenstrom': ['Breastplate', 'Maul'] };
function expectedIssue(slug, step, text) {
  return step === 'equipment' && (GEAR_FLAGGED[slug] || []).some((item) => text.includes(item + ' but do not own it'));
}
function unexpectedIssues(slug, st) {
  const out = {};
  for (const [step, list] of Object.entries(issues(st))) {
    const rest = list.filter((t) => !expectedIssue(slug, step, t));
    if (rest.length) out[step] = rest;
  }
  return out;
}

test('there are five level 3 fixtures', () => {
  assert.deepEqual(FIXTURES.map((f) => f.slug), [
    'baldwin-eisenstrom', 'eldrad', 'erwin-eisenstrom', 'kaelen-nightshade', 'mortimer-vale',
  ]);
  for (const fx of FIXTURES) assert.equal(fx.sheet.level, 3, fx.slug);
});

for (const fx of FIXTURES) {
  test(`${fx.slug}: the engine reproduces the printed sheet`, () => {
    const d = digest(APP.compute(hydrated(fx)));
    const p = fx.printed;
    assert.equal(d.ac, p.ac, 'AC');
    assert.equal(d.hp, p.hp, 'HP');
    assert.equal(d.hitDice, p.hitDice);
    assert.equal(d.initiative, p.initiative);
    assert.equal(d.speed, p.speed);
    assert.equal(d.pb, p.pb);
    assert.equal(d.passivePerception, p.passivePerception);
    assert.deepEqual(d.scores, p.scores);
    assert.deepEqual(d.saves, p.saves);
    assert.deepEqual(d.skills, p.skills);
    assert.deepEqual(d.expertise, p.expertise.slice().sort());
    assert.deepEqual(d.attacks.map((a) => a[0]), p.attacks.map((a) => a[0]));
    for (const [name, atk, line] of p.attacks) {
      const got = d.attacks.find((a) => a[0] === name);
      assert.equal(got[1], atk, name);
      assert.equal(got[2].replace(/\s+/g, ' '), line, name);
    }
    assert.equal(d.coin, p.coin);
    assert.equal(d.armorWorn, p.armorWorn);
  });

  test(`${fx.slug}: derived numbers match the 2bcbcbb baseline`, () => {
    assert.deepEqual(digest(APP.compute(hydrated(fx))), BASELINE[fx.slug]);
  });

  test(`${fx.slug}: passes every step check as recorded, apart from deliberate flags`, () => {
    assert.deepEqual(unexpectedIssues(fx.slug, hydrated(fx)), {});
  });
}

/* ---------- Fix 1: Skilled picks survive load and level changes ---------- */

test('legacy index keys for Skilled picks move to the slot that grants the feat', () => {
  for (const [slug, picks] of Object.entries(SKILLED)) {
    const st = hydrated(FIXTURES.find((f) => f.slug === slug));
    assert.equal(st.skillPicks.skilled0, undefined, slug);
    assert.deepEqual([...st.skillPicks['skilled:background']], picks, slug);
  }
});

for (const fx of FIXTURES) {
  test(`${fx.slug}: the boot path keeps every choice and every number`, () => {
    const st = boot(fx.sheet);
    if (SKILLED[fx.slug]) assert.deepEqual([...st.skillPicks['skilled:background']], SKILLED[fx.slug]);
    assert.deepEqual(unexpectedIssues(fx.slug, st), {});
    assert.deepEqual(digest(APP.compute(st)), BASELINE[fx.slug]);
    const again = clone(st);
    APP.setState(again);
    APP.normalize();
    assert.deepEqual(clone(APP.getState()), clone(st), 'normalize is idempotent');
  });

  test(`${fx.slug}: a level change 3 to 4 and back keeps Skilled picks and skill numbers`, () => {
    const st = boot(fx.sheet);
    const before = clone(st);
    const up = setLevel(st, 4);
    if (SKILLED[fx.slug]) assert.deepEqual([...up.skillPicks['skilled:background']], SKILLED[fx.slug]);
    assert.equal(issues(up).skills, undefined, 'no skill step issues at level 4');
    const at4 = digest(APP.compute(up));
    assert.deepEqual(at4.skills, BASELINE[fx.slug].skills, 'PB is still +2 at level 4');
    assert.equal(at4.passivePerception, BASELINE[fx.slug].passivePerception);
    const down = setLevel(up, 3);
    assert.deepEqual(clone(down), before, 'the round trip changes nothing');
    assert.deepEqual(digest(APP.compute(down)), BASELINE[fx.slug]);
  });

  test(`${fx.slug}: a level change 3 to 5 keeps Skilled picks and adds +1 proficiency`, () => {
    const up = setLevel(boot(fx.sheet), 5);
    if (SKILLED[fx.slug]) assert.deepEqual([...up.skillPicks['skilled:background']], SKILLED[fx.slug]);
    const R = APP.compute(up);
    for (const s of R.skills) {
      const base = BASELINE[fx.slug].skills[s.name];
      assert.equal(s.value, base + (s.exp ? 2 : s.prof ? 1 : 0), s.name);
    }
  });
}

test('changing the source of a Skilled feat clears only that source', () => {
  const kaelen = FIXTURES.find((f) => f.slug === 'kaelen-nightshade');
  APP.setState(boot(kaelen.sheet));
  APP.setGroup('humanFeat', 'Crafter');
  APP.setGroup('humanFeat', 'Skilled');
  let st = APP.getState();
  assert.deepEqual([...st.skillPicks['skilled:background']], SKILLED['kaelen-nightshade'], 'background Skilled picks untouched');
  assert.equal((st.skillPicks['skilled:human'] || []).length, 0, 'the new Versatile Skilled starts empty');
  APP.setGroup('skill:skilled:human', 'Stealth');
  APP.setGroup('humanFeat', 'Skilled');
  st = APP.getState();
  assert.equal(st.skillPicks['skilled:human'], undefined, 'dropping the feat drops its picks');
  assert.deepEqual([...st.skillPicks['skilled:background']], SKILLED['kaelen-nightshade']);

  APP.setState(boot(FIXTURES.find((f) => f.slug === 'mortimer-vale').sheet));
  APP.setGroup('background', 'Noble');
  st = APP.getState();
  assert.equal((st.skillPicks['skilled:background'] || []).length, 0, 'a new background, even another Skilled one, starts fresh');
});

test('rolled hit points survive a level up; only the new level is rolled', () => {
  const st = boot(FIXTURES.find((f) => f.slug === 'erwin-eisenstrom').sheet);
  st.hpMode = 'roll';
  st.hpRolls = [7, 4];
  const up = setLevel(st, 4);
  assert.deepEqual([...up.hpRolls], [7, 4]);
  assert.ok(APP.stepIssues(up, 'equipment').some((t) => /Roll your hit points/.test(t)));
});

/* ---------- Fix 2: General feats at the level 4 improvement ---------- */

const fixture = (slug) => FIXTURES.find((f) => f.slug === slug);

function takeFeat(slug, feat, opts, level = 4) {
  const st = setLevel(boot(fixture(slug).sheet), level);
  st.asiMode = 'feat';
  st.asiFeat = feat;
  st.asiFeatOpts = opts;
  APP.setState(st);
  APP.normalize();
  return APP.getState();
}

const asiIssues = (st) => [...APP.stepIssues(st, 'asi')];

test('the level 4 improvement offers every 2024 General feat', () => {
  assert.deepEqual(Object.keys(D.GENERAL_FEATS), [
    'Actor', 'Athlete', 'Charger', 'Chef', 'Crossbow Expert', 'Crusher', 'Defensive Duelist', 'Dual Wielder',
    'Durable', 'Elemental Adept', 'Fey Touched', 'Grappler', 'Great Weapon Master', 'Heavily Armored',
    'Heavy Armor Master', 'Inspiring Leader', 'Keen Mind', 'Lightly Armored', 'Mage Slayer',
    'Martial Weapon Training', 'Medium Armor Master', 'Moderately Armored', 'Mounted Combatant', 'Observant',
    'Piercer', 'Poisoner', 'Polearm Master', 'Resilient', 'Ritual Caster', 'Sentinel', 'Shadow Touched',
    'Sharpshooter', 'Shield Master', 'Skill Expert', 'Skulker', 'Slasher', 'Speedy', 'Spell Sniper',
    'Telekinetic', 'Telepathic', 'War Caster', 'Weapon Master',
  ]);
  for (const [name, f] of Object.entries(D.GENERAL_FEATS)) {
    assert.ok(f.text && f.text.length > 40, name);
    assert.ok(f.asi === 'unprofSave' || (f.asi.length && f.asi.every((k) => ['str', 'dex', 'con', 'int', 'wis', 'cha'].includes(k))), name);
  }
});

test('Eldrad takes Resilient (Constitution): +1 Con raises HP and adds the save', () => {
  const st = takeFeat('eldrad', 'Resilient', { ability: 'con' });
  assert.deepEqual(asiIssues(st), []);
  const R = APP.compute(st);
  assert.equal(R.scores.con, 16);
  assert.equal(R.hp.max, 30, '6 + 3, then three levels of 4 + 3');
  assert.equal(R.saves.con.prof, true);
  assert.equal(R.saves.con.value, 5);
  assert.match(R.feats.find((f) => f.name === 'Resilient').choices, /\+1 Constitution, and proficiency in Constitution saving throws/);
  assert.equal(APP.compute(setLevel(boot(fixture('eldrad').sheet), 4)).hp.max, 26, 'without the feat');
});

test('Resilient cannot pick a save the class already has', () => {
  const st = takeFeat('eldrad', 'Resilient', { ability: 'int' });
  assert.ok(asiIssues(st).some((t) => /Intelligence is not an option/.test(t)));
  assert.equal(APP.compute(st).scores.int, 17, 'an illegal choice adds nothing');
});

test('Baldwin takes Great Weapon Master: +1 Str and PB damage on Heavy weapons', () => {
  const st = takeFeat('baldwin-eisenstrom', 'Great Weapon Master', { ability: 'str' });
  assert.deepEqual(asiIssues(st), []);
  const R = APP.compute(st);
  assert.equal(R.scores.str, 17);
  const gs = R.attacks.find((a) => a.name === 'Greatsword');
  assert.deepEqual([...gs.notes], ['+2 damage on a hit as part of the Attack action (Great Weapon Master)']);
  assert.equal(R.attacks.find((a) => a.name === 'Longsword').notes.length, 0, 'not Heavy');
  assert.match(APP.sheetHTML(), /Great Weapon Master/);
});

test('Kaelen takes Observant (Wisdom, Perception): proficiency becomes Expertise', () => {
  const st = takeFeat('kaelen-nightshade', 'Observant', { ability: 'wis', skill: 'Perception' });
  assert.deepEqual(asiIssues(st), []);
  const R = APP.compute(st);
  assert.equal(R.scores.wis, 15);
  const per = R.skills.find((s) => s.name === 'Perception');
  assert.equal(per.exp, true);
  assert.equal(per.value, 6);
  assert.equal(R.passivePerception, 16);
  assert.deepEqual([...st.skillPicks['skilled:background']], SKILLED['kaelen-nightshade'], 'Skilled picks untouched');
});

test('Mortimer takes Speedy (Dexterity): Dex 18 moves AC, initiative, skills, and Speed', () => {
  const st = takeFeat('mortimer-vale', 'Speedy', { ability: 'dex' });
  assert.deepEqual(asiIssues(st), []);
  const R = APP.compute(st);
  assert.equal(R.scores.dex, 18);
  assert.equal(R.ac.value, 15);
  assert.equal(R.initiative, 4);
  assert.equal(R.speed.value, 40);
  assert.equal(R.skills.find((s) => s.name === 'Stealth').value, 8);
  assert.equal(R.attacks.find((a) => a.name === 'Shortsword').attack, 6);
});

test('Erwin takes Heavy Armor Master (Strength): Str 18 raises his attacks', () => {
  const st = takeFeat('erwin-eisenstrom', 'Heavy Armor Master', { ability: 'str' });
  assert.deepEqual(asiIssues(st), []);
  const R = APP.compute(st);
  assert.equal(R.scores.str, 18);
  assert.equal(R.attacks.find((a) => a.name === 'Longsword').attack, 6);
  assert.equal(R.attacks.find((a) => a.name === 'Longsword').line, '1d8 +4 Slashing');
  assert.match(R.feats.find((f) => f.name === 'Heavy Armor Master').text, /reduced by your Proficiency Bonus \(2\)/);
});

test('feats with unmet prerequisites are rejected by the step checks', () => {
  const cases = [
    ['mortimer-vale', 'Great Weapon Master', /needs Strength 13 or higher/],
    ['mortimer-vale', 'Heavy Armor Master', /needs Heavy armor training/],
    ['mortimer-vale', 'Elemental Adept', /needs the Spellcasting or Pact Magic feature/],
    ['eldrad', 'Actor', /needs Charisma 13 or higher/],
    ['eldrad', 'Great Weapon Master', /needs Strength 13 or higher/],
    ['eldrad', 'Moderately Armored', /needs Light armor training/],
    ['kaelen-nightshade', 'Heavily Armored', /needs Medium armor training/],
    ['baldwin-eisenstrom', 'Keen Mind', /needs Intelligence 13 or higher/],
    ['baldwin-eisenstrom', 'Crossbow Expert', /needs Dexterity 13 or higher/],
    ['erwin-eisenstrom', 'Observant', /needs Intelligence or Wisdom 13 or higher/],
  ];
  for (const [slug, feat, why] of cases) {
    const st = takeFeat(slug, feat, { ability: D.GENERAL_FEATS[feat].asi[0] });
    assert.ok(asiIssues(st).some((t) => why.test(t) && t.includes('cannot take it')), `${slug} ${feat}`);
  }
});

test('a prerequisite is judged before the improvement that grants the feat', () => {
  // Eldrad has Dexterity 13, so Speedy is legal; the +1 it grants is not what qualifies him.
  const ok = takeFeat('eldrad', 'Speedy', { ability: 'dex' });
  assert.deepEqual(asiIssues(ok), []);
  // A Fighter with Strength 12 cannot take Great Weapon Master at 4, but can at 6 after +1 Str at 4.
  const f = APP.hydrate(APP.BLANK());
  Object.assign(f, {
    level: 6, species: 'Human', humanFeat: 'Alert', background: 'Soldier', bgAssign: { two: 'con', one: 'dex' },
    cls: 'Fighter', fightingStyle: 'Defense', abilityMethod: 'array',
    assign: { str: 3, dex: 0, con: 1, int: 4, wis: 2, cha: 5 },
    asiMode: 'feat', asiFeat: 'Great Weapon Master', asiFeatOpts: { ability: 'str' },
  });
  assert.equal(APP.scoresBefore(f, 'asi').str, 12);
  assert.ok(asiIssues(f).some((t) => /Level 4 improvement: Great Weapon Master needs Strength 13/.test(t)));
  Object.assign(f, { asiMode: 'plus1plus1', asiBumpA: 'str', asiBumpB: 'con', asiFeat: '', asiFeatOpts: {} });
  Object.assign(f, { asi2Mode: 'feat', asi2Feat: 'Great Weapon Master', asi2FeatOpts: { ability: 'str' } });
  assert.equal(APP.scoresBefore(f, 'asi2').str, 13);
  assert.ok(!asiIssues(f).some((t) => /Great Weapon Master needs/.test(t)));
  assert.equal(APP.compute(f).scores.str, 14);
});

test('armor training feats chain: Moderately Armored at 4 qualifies Heavily Armored at 6', () => {
  const f = APP.hydrate(APP.BLANK());
  Object.assign(f, {
    level: 6, species: 'Human', humanFeat: 'Alert', background: 'Soldier', bgAssign: { two: 'con', one: 'dex' },
    cls: 'Fighter', fightingStyle: 'Defense', abilityMethod: 'array', assign: { str: 0, dex: 1, con: 2, int: 3, wis: 4, cha: 5 },
  });
  assert.equal(APP.featPrereq(f, 'asi', 'Heavy Armor Master'), '', 'a Fighter already has Heavy armor training');
  const k = setLevel(boot(fixture('kaelen-nightshade').sheet), 4);
  k.asiMode = 'feat'; k.asiFeat = 'Moderately Armored'; k.asiFeatOpts = { ability: 'dex' };
  assert.deepEqual(asiIssues(k), []);
  const R = APP.compute(k);
  assert.equal(R.armorFlags.medium, true);
  assert.equal(R.armorFlags.shield, true);
  assert.match(R.proficiencies.armor, /Medium armor and Shield \(Moderately Armored\)/);
});

test('Keen Mind, Skill Expert, and the other computed feat effects', () => {
  // Keen Mind on an unproficient skill gives proficiency; Kaelen has Int 13.
  let st = takeFeat('kaelen-nightshade', 'Keen Mind', { ability: 'int', skill: 'Nature' });
  assert.deepEqual(asiIssues(st), []);
  let R = APP.compute(st);
  assert.equal(R.scores.int, 14);
  assert.equal(R.skills.find((s) => s.name === 'Nature').value, 4, '+2 Int, +2 proficiency');

  // Skill Expert: one new proficiency plus Expertise in a proficient skill.
  st = takeFeat('erwin-eisenstrom', 'Skill Expert', { ability: 'con', skill: 'Stealth', expertise: 'Athletics' });
  assert.deepEqual(asiIssues(st), []);
  R = APP.compute(st);
  assert.equal(R.skills.find((s) => s.name === 'Stealth').value, 1 + 2);
  assert.equal(R.skills.find((s) => s.name === 'Athletics').value, 3 + 4);
  st = takeFeat('erwin-eisenstrom', 'Skill Expert', { ability: 'con', skill: 'Athletics', expertise: 'Arcana' });
  assert.ok(asiIssues(st).some((t) => /already proficient in Athletics/.test(t)));
  assert.ok(asiIssues(st).some((t) => /not proficient in Arcana/.test(t)));

  // Martial Weapon Training makes a Wizard proficient with a Longsword.
  st = takeFeat('eldrad', 'Martial Weapon Training', { ability: 'dex' });
  st.extraWeapons = ['Longsword'];
  R = APP.compute(st);
  assert.equal(R.attacks.find((a) => a.name === 'Longsword').prof, true);

  // Medium Armor Master: Dexterity 16 adds 3 in Medium armor.
  st = takeFeat('mortimer-vale', 'Medium Armor Master', { ability: 'dex' });
  assert.ok(asiIssues(st).some((t) => /needs Medium armor training/.test(t)), 'a Rogue lacks Medium armor');
  const fighter = APP.hydrate(APP.BLANK());
  Object.assign(fighter, {
    level: 4, species: 'Human', humanFeat: 'Alert', background: 'Soldier', bgAssign: { two: 'str', one: 'dex' },
    cls: 'Fighter', fightingStyle: 'Archery', abilityMethod: 'array', assign: { str: 1, dex: 0, con: 2, int: 3, wis: 4, cha: 5 },
    armor: 'Breastplate', asiMode: 'feat', asiFeat: 'Medium Armor Master', asiFeatOpts: { ability: 'str' },
  });
  assert.equal(APP.compute(fighter).scores.dex, 16);
  assert.equal(APP.compute(fighter).ac.value, 17, 'Breastplate 14 + Dex 3');
  fighter.asiFeatOpts.ability = 'dex';
  assert.equal(APP.compute(fighter).ac.value, 17, 'Dex 17 still caps at 3');
  fighter.asiFeat = 'Durable'; fighter.asiFeatOpts = { ability: 'con' };
  assert.equal(APP.compute(fighter).ac.value, 16, 'without the feat the cap is 2');

  // Chef and Poisoner add tools.
  st = takeFeat('erwin-eisenstrom', 'Chef', { ability: 'wis' });
  assert.match(APP.compute(st).proficiencies.tools, /Cook's Utensils/);
});

test('spell-granting feats add always-prepared spells with their own save DC', () => {
  const st = takeFeat('kaelen-nightshade', 'Shadow Touched', { ability: 'cha', spell: 'Disguise Self' });
  assert.deepEqual(asiIssues(st), []);
  const R = APP.compute(st);
  assert.equal(R.scores.cha, 18);
  assert.equal(R.caster.dc, 14);
  const block = R.innate.find((b) => b.label === 'Shadow Touched');
  assert.deepEqual([...block.spells], ['Invisibility', 'Disguise Self']);
  assert.equal(block.dc, 14);
  assert.ok(R.sheetSpells.some((x) => x.name === 'Invisibility' && x.source === 'Shadow Touched'));
  const bad = takeFeat('kaelen-nightshade', 'Fey Touched', { ability: 'cha', spell: 'Disguise Self' });
  assert.ok(asiIssues(bad).some((t) => /Disguise Self is not a level 1 Divination or Enchantment spell/.test(t)));

  // Telekinetic does not teach Mage Hand twice to a Wizard who knows it.
  const tk = takeFeat('eldrad', 'Telekinetic', { ability: 'int' });
  assert.deepEqual([...tk.cantrips], fixture('eldrad').sheet.cantrips);
  assert.equal(APP.compute(tk).innate.find((b) => b.label === 'Telekinetic'), undefined);
  assert.deepEqual([...APP.stepIssues(tk, 'spells')].filter((t) => /Mage Hand/.test(t)), []);

  // Ritual Caster holds as many rituals as the Proficiency Bonus.
  const rc = takeFeat('baldwin-eisenstrom', 'Ritual Caster', { ability: 'cha', spells: ['Alarm', 'Detect Magic'] });
  assert.deepEqual(asiIssues(rc), []);
  const at5 = setLevel(rc, 5);
  assert.ok(asiIssues(at5).some((t) => /choose 3 level 1 Ritual spells \(you have 2\)/.test(t)));
});

test('an improvement feat cannot repeat another feat the character holds', () => {
  const st = takeFeat('baldwin-eisenstrom', 'Alert', {});
  assert.ok(asiIssues(st).some((t) => /Alert feat twice/.test(t)));
  const ok = takeFeat('kaelen-nightshade', 'Skilled', {});
  assert.deepEqual(asiIssues(ok), [], 'Skilled is repeatable');
  assert.ok(APP.skillGroups(ok).some((g) => g.id === 'skilled:asi'));
});

test('dropping below level 4 releases the feat and its choices', () => {
  const st = takeFeat('mortimer-vale', 'Speedy', { ability: 'dex' });
  const down = setLevel(st, 3);
  assert.equal(down.asiFeat, '');
  assert.deepEqual({ ...down.asiFeatOpts }, {});
  assert.deepEqual(digest(APP.compute(down)), BASELINE['mortimer-vale']);
});

/* ---------- Fix 3: characters must own what they wear and wield ---------- */

const gearIssues = (st) => [...APP.stepIssues(st, 'equipment')].filter((t) => /do not own it|purchases cost/.test(t));

test('every weapon carries its SRD 5.2.1 cost', () => {
  const expected = {
    Club: 0.1, Dagger: 2, Greatclub: 0.2, Handaxe: 5, Javelin: 0.5, 'Light Hammer': 2, Mace: 5, Quarterstaff: 0.2, Sickle: 1, Spear: 1,
    Dart: 0.05, 'Light Crossbow': 25, Shortbow: 25, Sling: 0.1,
    Battleaxe: 10, Flail: 10, Glaive: 20, Greataxe: 30, Greatsword: 50, Halberd: 20, Lance: 10, Longsword: 15, Maul: 10,
    Morningstar: 15, Pike: 5, Rapier: 25, Scimitar: 25, Shortsword: 10, Trident: 5, Warhammer: 15, 'War Pick': 5, Whip: 2,
    Blowgun: 10, 'Hand Crossbow': 75, 'Heavy Crossbow': 50, Longbow: 50,
  };
  assert.deepEqual(Object.fromEntries(Object.entries(D.WEAPONS).map(([k, w]) => [k, w.cost])), expected);
  assert.equal(D.ARMOR.Breastplate.cost, 400);
  assert.equal(D.ARMOR['Chain Mail'].cost, 75);
  assert.equal(D.SHIELD_COST, 10);
});

for (const [slug, [armor, weapon]] of Object.entries(GEAR_FLAGGED)) {
  test(`${slug}: unowned ${armor} and ${weapon} are flagged`, () => {
    const st = boot(fixture(slug).sheet);
    const list = gearIssues(st);
    assert.equal(list.length, 2);
    assert.match(list[0], new RegExp(`wear ${armor} but do not own it.*costs 400 GP and you have \\d+ GP, so you cannot buy it\\. Wear your package Chain Mail instead`));
    assert.match(list[1], new RegExp(`carry the ${weapon} but do not own it.*Buy it for \\d+ GP`));
    assert.deepEqual([...APP.compute(st).equipment.unowned], [armor, weapon]);
  });
}

test('Baldwin: reverting to package gear gives AC 16, 18 with the Shield; the Greatsword is bought', () => {
  APP.setState(boot(fixture('baldwin-eisenstrom').sheet));
  APP.setGroup('gearBuy', 'Breastplate');
  assert.equal(APP.getState().bought.length, 0, '400 GP is out of reach with 59 GP');
  APP.setGroup('gearDrop', 'Breastplate');
  let R = APP.compute(APP.getState());
  assert.equal(R.ac.armor, 'Chain Mail');
  assert.equal(R.ac.value, 16);
  APP.setGroup('shield', 'yes');
  R = APP.compute(APP.getState());
  assert.equal(R.ac.value, 18);
  assert.equal(R.equipment.gp, 59, 'package gear costs nothing');
  APP.setGroup('gearBuy', 'Greatsword');
  const st = APP.getState();
  R = APP.compute(st);
  assert.equal(R.equipment.gp, 9);
  assert.equal(R.equipment.coin, '9 GP');
  assert.deepEqual(clone(R.equipment.bought.map((b) => [b.name, b.gp])), [['Greatsword', 50]]);
  assert.deepEqual(gearIssues(st), []);
  assert.equal(R.attacks.find((a) => a.name === 'Greatsword').line, '2d6 +3 Slashing');
  assert.match(APP.asText(), /Bought: Greatsword \(50 GP\)/);
  assert.match(APP.asText(), /Coin: 9 GP/);
});

test('Erwin: the Maul is bought for 10 GP, leaving 11 GP; re-choosing the package restores its gear', () => {
  APP.setState(boot(fixture('erwin-eisenstrom').sheet));
  APP.setGroup('gearBuy', 'Maul');
  APP.setGroup('equipChoice', 'A');
  const st = APP.getState();
  const R = APP.compute(st);
  assert.equal(R.ac.value, 18, 'Chain Mail and Shield');
  assert.equal(R.equipment.gp, 11);
  assert.deepEqual(gearIssues(st), []);
});

test('buying on selection: affordable gear is paid for, unaffordable gear is refused, removal refunds', () => {
  APP.setState(boot(fixture('erwin-eisenstrom').sheet));
  APP.setGroup('equipChoice', 'A');
  APP.setGroup('extraWeapons', 'Maul');
  assert.equal(APP.compute(APP.getState()).equipment.gp, 21, 'the Maul was already carried, so unticking it drops it');
  APP.setGroup('extraWeapons', 'Maul');
  assert.equal(APP.compute(APP.getState()).equipment.gp, 11);
  APP.setGroup('extraWeapons', 'Greatsword');
  assert.ok(!APP.getState().extraWeapons.includes('Greatsword'), '50 GP with 11 GP left is refused');
  APP.setGroup('extraWeapons', 'Spear');
  assert.equal(APP.compute(APP.getState()).equipment.gp, 11, 'the Guard kit already holds a Spear');
  APP.setGroup('armor', 'Breastplate');
  assert.equal(APP.getState().armor, 'Chain Mail', 'cannot afford a Breastplate');
  APP.setGroup('armor', 'Leather Armor');
  let R = APP.compute(APP.getState());
  assert.equal(R.ac.armor, 'Leather Armor');
  assert.equal(R.equipment.gp, 1);
  APP.setGroup('armor', 'Chain Mail');
  R = APP.compute(APP.getState());
  assert.equal(R.equipment.gp, 11, 'back in package armor, the Leather Armor is refunded');
  APP.setGroup('extraWeapons', 'Maul');
  assert.equal(APP.compute(APP.getState()).equipment.gp, 21);
  assert.deepEqual([...APP.getState().bought], []);
});

test('Crafter takes 20 percent off, and coin is exact to the copper', () => {
  APP.setState(boot(fixture('kaelen-nightshade').sheet));
  APP.setGroup('extraWeapons', 'Light Crossbow');
  APP.setGroup('extraWeapons', 'Dart');
  const R = APP.compute(APP.getState());
  assert.equal(R.equipment.coin, '23 GP 9 SP 6 CP', '44 GP less 20 GP and 4 CP');
  assert.deepEqual(clone(R.equipment.bought.map((b) => b.price)), ['20 GP', '4 CP']);
});

test('switching to smaller background coin after buying flags the overspend', () => {
  APP.setState(boot(fixture('baldwin-eisenstrom').sheet));
  APP.setGroup('equipChoice', 'A');
  APP.setGroup('gearBuy', 'Greatsword');
  APP.setGroup('bgEquip', 'A');
  const st = APP.getState();
  assert.equal(APP.compute(st).equipment.gp, -29);
  assert.ok(gearIssues(st).some((t) => /purchases cost 50 GP but you only have 21 GP/.test(t)));
});

test('background kits count as owned weapons', () => {
  const st = boot(fixture('erwin-eisenstrom').sheet);
  assert.deepEqual([...APP.kitWeapons(st)], ['Spear', 'Light Crossbow']);
  assert.deepEqual([...APP.kitWeapons(boot(fixture('baldwin-eisenstrom').sheet))], [], 'Baldwin took 50 GP instead');
});
