import assert from 'node:assert/strict';
import test from 'node:test';

import { FRANCHISE, fold, lookupPlace, OUTSIDE } from '../src/scripts/franchise.mjs';
import { CITIES } from '../src/scripts/power-view.mjs';

test('fold is the single normaliser, and it is idempotent', () => {
  assert.equal(fold('  To-ong   Pardo '), 'to ong pardo');
  assert.equal(fold("Sto. Niño's"), 'sto nino s');
  assert.equal(fold('Lawaan\u2019s'), 'lawaan s');
  assert.equal(fold(''), '');
  assert.equal(fold(null), '');
  for (const raw of ['To-ong Pardo', 'Sto. Niño', 'Lawaan I', '  a--b  ', 'Punta Engaño']) {
    assert.equal(fold(fold(raw)), fold(raw), raw);
  }
});

test('an enye folds to n, so a reader never has to reach for the accent', () => {
  assert.equal(fold('Punta Engaño'), 'punta engano');
  assert.equal(fold('Niño'), fold('Nino'));
});

test('fold keeps different words apart instead of guessing between them', () => {
  // Sto./Santo and I/1 are different strings on purpose: guessing is how a search answers
  // confidently wrong. Both spellings are carried as entries instead. See franchise.mjs.
  assert.notEqual(fold('sto. nino'), fold('santo nino'));
  assert.notEqual(fold('Lawaan I'), fold('Lawaan 1'));
});

test('every franchise name is a CITIES label, so a scope filter can never miss', () => {
  const labels = CITIES.map(([name]) => name);
  for (const { name } of FRANCHISE) assert.ok(labels.includes(name), name);
  assert.deepEqual(
    FRANCHISE.map((f) => f.name),
    ['Cebu City', 'Mandaue', 'Talisay', 'Naga', 'Minglanilla', 'San Fernando', 'Consolacion', 'Liloan'],
  );
});

test('the franchise is the 8 LGUs and their full PSGC rosters', () => {
  // [LGU, PSGC barangays verified against the PSGC mirror, added spelling variants]
  const expected = [
    ['Cebu City', 80, 22],
    ['Mandaue', 27, 2],
    ['Talisay', 22, 7],
    ['Naga', 28, 1],
    ['Minglanilla', 19, 14],
    ['San Fernando', 21, 0],
    ['Consolacion', 21, 1],
    ['Liloan', 14, 2],
  ];
  assert.equal(FRANCHISE.length, 8);
  assert.equal(expected.reduce((sum, [, psgc]) => sum + psgc, 0), 232);
  for (const [index, [name, psgc, aliases]] of expected.entries()) {
    const lgu = FRANCHISE[index];
    assert.equal(lgu.name, name);
    assert.match(lgu.psgc, /^\d{9}$/);
    assert.equal(lgu.barangays.length, psgc + aliases, name);
  }
});

test('lookupPlace names an LGU when the reader names an LGU', () => {
  assert.deepEqual(lookupPlace('Mandaue'), { kind: 'city', place: 'Mandaue', lgus: ['Mandaue'] });
  assert.deepEqual(lookupPlace('cebu city'), { kind: 'city', place: 'Cebu City', lgus: ['Cebu City'] });
  assert.deepEqual(lookupPlace('Mandaue City'), { kind: 'city', place: 'Mandaue', lgus: ['Mandaue'] });
});

test('lookupPlace resolves a barangay to every LGU that has one by that name', () => {
  assert.deepEqual(lookupPlace('Guadalupe'), { kind: 'barangay', place: 'Guadalupe', lgus: ['Cebu City'] });
  // The collision case: a Mandaue reader searching Casili must not be handed Consolacion rows
  // and told that is their answer.
  assert.deepEqual(lookupPlace('casili'), { kind: 'barangay', place: 'Casili', lgus: ['Mandaue', 'Consolacion'] });
  assert.deepEqual(lookupPlace('Banilad'), { kind: 'barangay', place: 'Banilad', lgus: ['Cebu City', 'Mandaue'] });
  assert.deepEqual(lookupPlace('Tayud'), { kind: 'barangay', place: 'Tayud', lgus: ['Consolacion', 'Liloan'] });
  assert.deepEqual(lookupPlace('San Roque').lgus, ['Cebu City', 'Talisay', 'Liloan']);
});

test('every name shared by two LGUs reports both', () => {
  // The full collision set in the PSGC rosters of the 8 franchise LGUs.
  const shared = ['Banilad', 'Basak', 'Bulacao', 'Cadulawan', 'Casili', 'Linao', 'Poblacion', 'San Isidro', 'San Roque', 'Tangke', 'Tayud', 'Tubod'];
  for (const name of shared) {
    const hit = lookupPlace(name);
    assert.equal(hit?.kind, 'barangay', name);
    assert.ok(hit.lgus.length > 1, `${name} should be ambiguous, got ${hit.lgus.join()}`);
  }
});

test('a hyphen is optional, never significant', () => {
  assert.equal(lookupPlace('toong pardo').place, 'Toong Pardo');
  assert.equal(lookupPlace('To-ong Pardo').place, 'To-ong Pardo');
  assert.equal(lookupPlace('tolotolo').place, 'Tolotolo');
  assert.equal(lookupPlace('tolo-tolo').place, 'Tolotolo');
  assert.equal(lookupPlace('calajoan').place, 'Calajo-an');
  assert.equal(lookupPlace('calajo-an').place, 'Calajo-an');
  assert.equal(lookupPlace('kinasangan pardo').place, 'Kinasang-an Pardo');
  assert.deepEqual(lookupPlace('alang alang').lgus, ['Mandaue']);
  assert.deepEqual(lookupPlace('Alang-alang').lgus, ['Mandaue']);
});

test('the spellings VECO prints resolve alongside the PSGC ones', () => {
  assert.equal(lookupPlace('Tabunoc').lgus[0], 'Talisay');
  assert.equal(lookupPlace('Tabunok').lgus[0], 'Talisay');
  assert.deepEqual(lookupPlace('Candulawan').lgus, ['Talisay', 'Minglanilla']);
  assert.equal(lookupPlace('Lawaan 1').lgus[0], 'Talisay');
  assert.equal(lookupPlace('Lawaan I').lgus[0], 'Talisay');
  assert.equal(lookupPlace('Camp 4').lgus[0], 'Talisay');
  assert.equal(lookupPlace('Hipodromo').lgus[0], 'Cebu City');
  assert.equal(lookupPlace('Hippodromo').lgus[0], 'Cebu City');
  assert.equal(lookupPlace('Duljo Fatima').lgus[0], 'Cebu City');
  assert.equal(lookupPlace('Alpaco').lgus[0], 'Naga');
  assert.deepEqual(lookupPlace('Sta. Cruz').lgus, ['Cebu City', 'Liloan']);
  // A VECO name with no PSGC barangay behind it still has to answer.
  assert.equal(lookupPlace('Kimba').lgus[0], 'Talisay');
});

test('the bare names VECO schedules resolve, not just the PSGC long forms', () => {
  // VECO prints these without the Pardo or Poblacion that PSGC attaches, so a reader copying
  // the advisory gets the bare form. Every one of these appears in the live feed.
  assert.equal(lookupPlace('Toong').lgus[0], 'Cebu City');
  assert.equal(lookupPlace('To-ong').place, 'Toong');
  assert.equal(lookupPlace('Quiot').lgus[0], 'Cebu City');
  assert.equal(lookupPlace('Buot').lgus[0], 'Cebu City');
  assert.equal(lookupPlace('Kinasang-an').lgus[0], 'Cebu City');
  assert.equal(lookupPlace('kinasangan').lgus[0], 'Cebu City');
  assert.equal(lookupPlace('Poblacion Pardo').lgus[0], 'Cebu City');
  assert.equal(lookupPlace('San Nicolas Proper').lgus[0], 'Cebu City');
  assert.equal(lookupPlace('Ward 1').lgus[0], 'Minglanilla');
  assert.equal(lookupPlace('Ward IV').lgus[0], 'Minglanilla');
  assert.equal(lookupPlace('Tugbungan').lgus[0], 'Consolacion');
  assert.equal(lookupPlace('Tugbongan').lgus[0], 'Consolacion');
});

test('both spellings of Sto. Nino answer, since fold refuses to guess between them', () => {
  // VECO schedules "Sto. Niño" among the Cebu City poblacion barangays, and PSGC has no
  // barangay by that name at all. Carried as two entries because fold('sto nino') and
  // fold('santo nino') are different strings and must stay that way.
  assert.equal(lookupPlace('Sto. Niño').lgus[0], 'Cebu City');
  assert.equal(lookupPlace('sto. nino').place, 'Sto. Niño');
  assert.equal(lookupPlace('Sto Nino').place, 'Sto. Niño');
  assert.equal(lookupPlace('Santo Niño').place, 'Santo Niño');
  assert.equal(lookupPlace('santo nino').lgus[0], 'Cebu City');
});

test('the districts VECO names directly are not treated as unknown', () => {
  // Not PSGC barangays, but a reader in them is inside the franchise and must never be told
  // this page does not cover their area.
  assert.equal(lookupPlace('North Reclamation Area').lgus[0], 'Cebu City');
  assert.equal(lookupPlace('Cebu Business Park').lgus[0], 'Cebu City');
  assert.equal(lookupPlace('Lipata').lgus[0], 'Minglanilla');
  assert.equal(lookupPlace('Pepito').lgus[0], 'Liloan');
});

test('a place another utility serves is named as such, never as nothing scheduled', () => {
  const meco = 'Mactan Electric Company (MECO)';
  assert.deepEqual(lookupPlace('Lapu-Lapu'), { kind: 'outside', place: 'Lapu-Lapu City', lgus: [], utility: meco });
  assert.deepEqual(lookupPlace('lapu lapu city'), { kind: 'outside', place: 'Lapu-Lapu City', lgus: [], utility: meco });
  assert.deepEqual(lookupPlace('Basak Marigondon'), { kind: 'outside', place: 'Lapu-Lapu City', lgus: [], utility: meco });
  assert.deepEqual(lookupPlace('Olango'), { kind: 'outside', place: 'Olango Island', lgus: [], utility: meco });
  assert.deepEqual(lookupPlace('Cordova'), { kind: 'outside', place: 'Cordova', lgus: [], utility: meco });
  assert.equal(lookupPlace('Danao').utility, 'Cebu II Electric Cooperative (CEBECO II)');
  assert.equal(lookupPlace('Compostela').utility, 'Cebu II Electric Cooperative (CEBECO II)');
  assert.equal(lookupPlace('Carcar').utility, 'Cebu I Electric Cooperative (CEBECO I)');
  assert.equal(lookupPlace('Toledo').utility, 'Cebu III Electric Cooperative (CEBECO III)');
  assert.equal(lookupPlace('Balamban').utility, 'Cebu III Electric Cooperative (CEBECO III)');
});

test('no outside pattern can swallow a franchise place', () => {
  // Lapu-Lapu, Cordova and Cebu City share barangay names (Babag, Basak, Day-as, Poblacion).
  // An outside verdict wins over everything, so a loose pattern here sends a franchise reader
  // to the wrong utility. This is the invariant that keeps that from happening quietly.
  for (const lgu of FRANCHISE) {
    for (const place of [lgu.name, ...lgu.barangays]) {
      const hit = OUTSIDE.find((entry) => entry.match.test(fold(place)));
      assert.equal(hit, undefined, `${place} matched ${hit?.place}`);
    }
  }
});

test('outside patterns are stateless, so a repeated lookup answers the same', () => {
  for (const entry of OUTSIDE) assert.equal(entry.match.global, false, entry.place);
  assert.deepEqual(lookupPlace('Toledo'), lookupPlace('Toledo'));
});

test('lookupPlace matches whole names only, and knows when it does not know', () => {
  assert.equal(lookupPlace('san'), null, 'a partial must not resolve to San Roque');
  assert.equal(lookupPlace('tabun'), null);
  assert.equal(lookupPlace('Guadalupe Heights'), null);
  assert.equal(lookupPlace('Sto. Niño Village'), null);
  assert.equal(lookupPlace(''), null);
  assert.equal(lookupPlace('   '), null);
  assert.equal(lookupPlace(null), null);
});

test('a caller cannot corrupt the shared index', () => {
  lookupPlace('Casili').lgus.push('Nowhere');
  assert.deepEqual(lookupPlace('Casili').lgus, ['Mandaue', 'Consolacion']);
});
