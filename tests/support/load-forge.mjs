// Loads the Character Forge engine straight out of its single static page, the
// same code a browser runs, so the tests exercise exactly what ships.
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';

const PAGE = new URL('../../public/ravenloft-forge/index.html', import.meta.url);
const FIXTURES = new URL('../fixtures/character-forge/', import.meta.url);

export function loadForge(html = readFileSync(PAGE, 'utf8')) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const context = vm.createContext({});
  vm.runInContext(scripts.join('\n;\n') + '\n;globalThis.RF_DATA = RF_DATA; globalThis.RF_APP = RF_APP;', context);
  return { D: context.RF_DATA, APP: context.RF_APP };
}

export function loadFixtures() {
  return readdirSync(FIXTURES)
    .filter((f) => f.endsWith('.json') && !f.startsWith('baseline'))
    .sort()
    .map((f) => JSON.parse(readFileSync(new URL(f, FIXTURES), 'utf8')));
}

export function readBaseline() {
  return JSON.parse(readFileSync(new URL('baseline-2bcbcbb.json', FIXTURES), 'utf8'));
}

export const clone = (o) => JSON.parse(JSON.stringify(o));

// Every derived number and list the printed sheet shows, in a stable shape.
export function digest(R) {
  const byName = (list) => list.map((x) => x.name).sort();
  return clone({
    level: R.level,
    ac: R.ac.value,
    armorWorn: R.ac.armor,
    shield: R.ac.shield,
    hp: R.hp.max,
    hitDice: R.hp.hitDice,
    initiative: R.initiative,
    speed: R.speed.value,
    pb: R.pb,
    passivePerception: R.passivePerception,
    scores: R.scores,
    saves: Object.fromEntries(Object.entries(R.saves).map(([k, v]) => [k, v.value])),
    skills: Object.fromEntries(R.skills.map((s) => [s.name, s.value])),
    expertise: R.skills.filter((s) => s.exp).map((s) => s.name).sort(),
    attacks: R.attacks.map((a) => [a.name, a.attack, a.line]),
    caster: R.caster && { ability: R.caster.ability, dc: R.caster.dc, attack: R.caster.attack, slots: R.caster.slots },
    innate: R.innate.map((b) => [b.label, b.dc, b.attack, b.spells.slice().sort()]),
    cantrips: byName(R.cantrips),
    spells: byName(R.sheetSpells),
    spellbook: R.spellbook.slice(),
    features: byName(R.features),
    feats: R.feats.map((f) => f.name),
    coin: R.equipment.gp,
  });
}
