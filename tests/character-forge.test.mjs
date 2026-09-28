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

test('there are five level 3 fixtures', () => {
  assert.deepEqual(FIXTURES.map((f) => f.slug), [
    'baldwin-eisenstrom', 'eldrad', 'erwin-eisenstrom', 'kaelen-nightshade', 'mortimer-vale',
  ]);
  for (const fx of FIXTURES) assert.equal(fx.sheet.level, 3, fx.slug);
});

for (const fx of FIXTURES) {
  test(`${fx.slug}: the engine reproduces the printed sheet`, () => {
    const d = digest(APP.compute(clone(fx.sheet)));
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
    assert.deepEqual(digest(APP.compute(clone(fx.sheet))), BASELINE[fx.slug]);
  });

  test(`${fx.slug}: passes every step check as recorded`, () => {
    assert.deepEqual(issues(clone(fx.sheet)), {});
  });
}
