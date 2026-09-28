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

  test(`${fx.slug}: passes every step check as recorded`, () => {
    assert.deepEqual(issues(hydrated(fx)), {});
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
    assert.deepEqual(issues(st), {});
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
