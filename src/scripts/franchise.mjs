/**
 * Visayan Electric's franchise, as data. DOM-free, side-effect-free, no network: safe to
 * import from Astro frontmatter at build time and from the browser bundle.
 *
 * The franchise is exactly 8 LGUs (RA 9339, and Visayan Electric's own About page). Anything
 * else in Cebu belongs to another distribution utility, which is why this page can answer
 * "we never cover that" instead of "nothing scheduled" for a Lapu-Lapu or Toledo reader.
 *
 * Barangay rosters are PSA PSGC names, in PSGC order, fetched once while authoring from the
 * open mirror https://psgc.gitlab.io/api/cities-municipalities/{code}/barangays/ and baked in
 * here as literals. Counts verified against PSGC: Cebu City 80, Mandaue 27, Talisay 22,
 * Naga 28, Minglanilla 19, San Fernando 21, Consolacion 21, Liloan 14, so 232 in total.
 * The trailing "(Pob.)" PSGC decorates poblacion barangays with is dropped: readers type
 * "Lahug", and the bare name is what has to match advisory text.
 */

/** @type {[string, string, string[]][]} */
const PSGC = [
  ['Cebu City', '072217000', [
    'Adlaon', 'Agsungot', 'Apas', 'Babag', 'Basak Pardo', 'Bacayan', 'Banilad',
    'Basak San Nicolas', 'Binaliw', 'Bonbon', 'Budla-an', 'Buhisan', 'Bulacao', 'Buot-Taup Pardo',
    'Busay', 'Calamba', 'Cambinocot', 'Capitol Site', 'Carreta', 'Central', 'Cogon Ramos',
    'Cogon Pardo', 'Day-as', 'Duljo', 'Ermita', 'Guadalupe', 'Guba', 'Hippodromo', 'Inayawan',
    'Kalubihan', 'Kalunasan', 'Kamagayan', 'Camputhaw', 'Kasambagan', 'Kinasang-an Pardo',
    'Labangon', 'Lahug', 'Lorega', 'Lusaran', 'Luz', 'Mabini', 'Mabolo', 'Malubog', 'Mambaling',
    'Pahina Central', 'Pahina San Nicolas', 'Pamutan', 'Pardo', 'Pari-an', 'Paril', 'Pasil',
    'Pit-os', 'Pulangbato', 'Pung-ol-Sibugay', 'Punta Princesa', 'Quiot Pardo', 'Sambag I',
    'Sambag II', 'San Antonio', 'San Jose', 'San Nicolas Central', 'San Roque', 'Santa Cruz',
    'Sawang Calero', 'Sinsin', 'Sirao', 'Suba', 'Sudlon I', 'Sapangdaku', 'T. Padilla', 'Tabunan',
    'Tagbao', 'Talamban', 'Taptap', 'Tejero', 'Tinago', 'Tisa', 'To-ong Pardo', 'Zapatera',
    'Sudlon II',
  ]],
  ['Mandaue', '072230000', [
    'Alang-alang', 'Bakilid', 'Banilad', 'Basak', 'Cabancalan', 'Cambaro', 'Canduman', 'Casili',
    'Casuntingan', 'Centro', 'Cubacub', 'Guizo', 'Ibabao-Estancia', 'Jagobiao', 'Labogon', 'Looc',
    'Maguikay', 'Mantuyong', 'Opao', 'Pakna-an', 'Pagsabungan', 'Subangdaku', 'Tabok', 'Tawason',
    'Tingub', 'Tipolo', 'Umapad',
  ]],
  ['Talisay', '072250000', [
    'Bulacao', 'Cadulawan', 'Cansojong', 'Dumlog', 'Jaclupan', 'Lagtang', 'Lawaan I', 'Linao',
    'Maghaway', 'Manipis', 'Mohon', 'Poblacion', 'Pooc', 'San Isidro', 'San Roque', 'Tabunoc',
    'Tangke', 'Tapul', 'Biasong', 'Camp IV', 'Lawaan II', 'Lawaan III',
  ]],
  ['Naga', '072234000', [
    'Alfaco', 'Bairan', 'Balirong', 'Cabungahan', 'Cantao-an', 'Central Poblacion', 'Cogon',
    'Colon', 'East Poblacion', 'Inoburan', 'Inayagan', 'Jaguimit', 'Lanas', 'Langtad', 'Lutac',
    'Mainit', 'Mayana', 'Naalad', 'North Poblacion', 'Pangdan', 'Patag', 'South Poblacion',
    'Tagjaguimit', 'Tangke', 'Tinaan', 'Tuyan', 'Uling', 'West Poblacion',
  ]],
  ['Minglanilla', '072232000', [
    'Cadulawan', 'Calajo-an', 'Camp 7', 'Camp 8', 'Cuanos', 'Guindaruhan', 'Linao', 'Manduang',
    'Pakigne', 'Poblacion Ward I', 'Poblacion Ward II', 'Poblacion Ward III', 'Poblacion Ward IV',
    'Tubod', 'Tulay', 'Tunghaan', 'Tungkop', 'Vito', 'Tungkil',
  ]],
  ['San Fernando', '072241000', [
    'Balud', 'Balungag', 'Basak', 'Bugho', 'Cabatbatan', 'Greenhills', 'Lantawan', 'Liburon',
    'Magsico', 'Poblacion North', 'Panadtaran', 'Pitalo', 'San Isidro', 'Sangat',
    'Poblacion South', 'Tabionan', 'Tananas', 'Tinubdan', 'Tonggo', 'Tubod', 'Ilaya',
  ]],
  ['Consolacion', '072219000', [
    'Cabangahan', 'Cansaga', 'Casili', 'Danglag', 'Garing', 'Jugan', 'Lamac', 'Lanipga', 'Nangka',
    'Panas', 'Panoypoy', 'Pitogo', 'Poblacion Occidental', 'Poblacion Oriental', 'Polog',
    'Pulpogan', 'Sacsac', 'Tayud', 'Tilhaong', 'Tolotolo', 'Tugbongan',
  ]],
  ['Liloan', '072227000', [
    'Cabadiangan', 'Calero', 'Catarman', 'Cotcot', 'Jubay', 'Lataban', 'Mulao', 'Poblacion',
    'San Roque', 'San Vicente', 'Santa Cruz', 'Tabla', 'Tayud', 'Yati',
  ]],
];

/**
 * Names PSGC does not carry but a reader will type, because VECO prints them in the advisories
 * or because that is simply how the place is written locally. Every one below was checked
 * against the live feed, which is where the bare forms come from: VECO schedules "Toong",
 * "Quiot" and "Ward 1" without the Pardo or Poblacion that PSGC attaches. Each becomes its own
 * entry, so the datalist offers it and lookupPlace resolves it.
 *
 * Hyphen-versus-run-together variants are NOT listed here: the index is space-insensitive, so
 * "Tolotolo" and "Tolo-tolo", "Calajoan" and "Calajo-an", "Kinasangan" and "Kinasang-an"
 * already resolve to the same entry without a second string.
 * @type {Record<string, string[]>}
 */
const ALIASES = {
  'Cebu City': [
    'Hipodromo', // one p; the spelling VECO and everyone local uses for PSGC 'Hippodromo'
    'Kamputhaw', // everyday spelling of PSGC 'Camputhaw'
    'Duljo Fatima', // VECO names it Duljo Fatima; PSGC has plain 'Duljo'
    'Toong Pardo', // VECO drops the hyphen from 'To-ong Pardo'
    'Toong', // VECO schedules it bare, without the Pardo that PSGC attaches
    'Quiot', // bare; PSGC has 'Quiot Pardo'
    'Buot', // bare; PSGC has 'Buot-Taup Pardo'
    'Kinasang-an', // bare; PSGC has 'Kinasang-an Pardo'
    'Poblacion Pardo', // how VECO names PSGC's plain 'Pardo'
    'San Nicolas', // VECO's own name for the district PSGC splits into three San Nicolas barangays
    'San Nicolas Proper', // as VECO prints it, 13 times in the live feed
    'Lorega-San Miguel', // the full local name of PSGC's 'Lorega'
    'Sto. Niño', // VECO schedules Sto. Niño with the Cebu City poblacion; no PSGC barangay by that name
    'Santo Niño', // the unabbreviated spelling; fold() keeps 'sto' and 'santo' apart on purpose
    'North Reclamation Area', // a Cebu City district VECO names directly, not a PSGC barangay
    'South Reclamation Area', // as above
    'Cebu Business Park', // as above
    'Sambag 1', // readers type arabic numerals, and fold() keeps 'i' and '1' apart
    'Sambag 2', // as above
    'Sudlon 1', // as above
    'Sudlon 2', // as above
    'Sta. Cruz', // the abbreviation readers type; fold() deliberately keeps 'sta' and 'santa' apart
  ],
  'Mandaue': [
    'Subangdako', // local spelling of PSGC 'Subangdaku'
    'Ibabao', // readers name it alone; PSGC pairs it as 'Ibabao-Estancia'
  ],
  'Talisay': [
    'Tabunok', // VECO spelling; PSGC has 'Tabunoc'
    'Candulawan', // VECO spelling of PSGC 'Cadulawan'
    'Lawaan 1', // arabic numeral for 'Lawaan I'
    'Lawaan 2', // arabic numeral for 'Lawaan II'
    'Lawaan 3', // arabic numeral for 'Lawaan III'
    'Camp 4', // arabic numeral for 'Camp IV'
    'Kimba', // a Talisay place VECO has scheduled by name; not a PSGC barangay
  ],
  'Naga': [
    'Alpaco', // how VECO writes PSGC 'Alfaco', including in live advisories
  ],
  'Minglanilla': [
    'Candulawan', // VECO spelling of PSGC 'Cadulawan'
    'Poblacion Ward 1', // arabic numeral for 'Poblacion Ward I'
    'Poblacion Ward 2', // arabic numeral for 'Poblacion Ward II'
    'Poblacion Ward 3', // arabic numeral for 'Poblacion Ward III'
    'Poblacion Ward 4', // arabic numeral for 'Poblacion Ward IV'
    'Ward I', 'Ward II', 'Ward III', 'Ward IV', // VECO schedules the wards without 'Poblacion'
    'Ward 1', 'Ward 2', 'Ward 3', 'Ward 4', // and readers type arabic numerals for them
    'Lipata', // a Minglanilla place VECO names directly; not a PSGC barangay
  ],
  'San Fernando': [],
  'Consolacion': [
    'Tugbungan', // VECO spelling of PSGC 'Tugbongan'
  ],
  'Liloan': [
    'Sta. Cruz', // the abbreviation readers type for 'Santa Cruz'
    'Pepito', // a Liloan place VECO names directly; not a PSGC barangay
  ],
};

export const FRANCHISE = Object.freeze(
  PSGC.map(([name, psgc, barangays]) =>
    Object.freeze({ name, psgc, barangays: Object.freeze([...barangays, ...ALIASES[name]]) })),
);

/** Names for the 8 LGUs beyond FRANCHISE[i].name, so "Mandaue City" resolves like "Mandaue". */
const CITY_ALIASES = {
  'Cebu City': ['Cebu City'],
  Mandaue: ['Mandaue City'],
  Talisay: ['Talisay City'],
  Naga: ['Naga City', 'City of Naga'],
  Minglanilla: [],
  'San Fernando': ['San Fernando Cebu'],
  Consolacion: [],
  Liloan: [],
};

/**
 * The one normaliser. Lowercase, strip accents (so an enye folds to n), turn hyphens, periods
 * and both apostrophes into single spaces, collapse runs, trim. Idempotent.
 *
 * Deliberately dumb: it does not map "sto" to "santo" or "i" to "1", because those are
 * different words and guessing between them is how a search answers confidently wrong. Those
 * variants are carried as entries in ALIASES instead.
 */
export function fold(text) {
  return `${text ?? ''}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[-.'\u2019\u02bc]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const MECO = 'Mactan Electric Company (MECO)';
const CEBECO1 = 'Cebu I Electric Cooperative (CEBECO I)';
const CEBECO2 = 'Cebu II Electric Cooperative (CEBECO II)';
const CEBECO3 = 'Cebu III Electric Cooperative (CEBECO III)';

/**
 * Places this page can never cover, each with the utility that does serve it. Every `match`
 * tests against fold() output, which is why the patterns are spaced rather than hyphenated,
 * and every one is word-bounded so a franchise barangay can never be swallowed by it.
 *
 * The barangay names listed under Lapu-Lapu are only the ones that exist nowhere in the
 * franchise. Lapu-Lapu's Babag, Basak, Looc and Poblacion are left out on purpose: those names
 * are also real barangays of Cebu City, Mandaue, San Fernando, Talisay and Liloan, and an
 * "outside" verdict wins over everything, so a careless pattern there would tell a Mandaue
 * reader to call the wrong utility.
 * @type {{ place: string, utility: string, match: RegExp }[]}
 */
export const OUTSIDE = Object.freeze([
  // RA 10890 gives Lapu-Lapu, Olango and Cordova to MECO. Mactan Economic Zone II is Mactan
  // Enerzone, also not VECO, and a reader typing "Mactan" is served by neither of ours.
  { place: 'Lapu-Lapu City', utility: MECO, match: /\b(lapu ?lapu|marigondon|pusok|maribago|pajac|pajo|punta ?engano|gun ?ob|buaya|canjulao|calawisan|suba ?basbas|talima|bankal|agus|tungasan|caw ?oy)\b/ },
  { place: 'Olango Island', utility: MECO, match: /\bolango\b/ },
  { place: 'Mactan', utility: MECO, match: /\bmactan\b/ },
  { place: 'Cordova', utility: MECO, match: /\b(cordova|gilutongan|buagsong|pilipog)\b/ },
  { place: 'Danao City', utility: CEBECO2, match: /\bdanao\b/ },
  { place: 'Compostela', utility: CEBECO2, match: /\bcompostela\b/ },
  { place: 'Carmen', utility: CEBECO2, match: /\bcarmen\b/ },
  // "bogo" alone is a substring of Mandaue's Labogon, which the row matcher does find, so
  // the verdict would contradict the rows underneath it. Readers write the city anyway.
  { place: 'Bogo City', utility: CEBECO2, match: /\bbogo city\b/ },
  { place: 'Carcar City', utility: CEBECO1, match: /\bcarcar\b/ },
  { place: 'Barili', utility: CEBECO1, match: /\bbarili\b/ },
  { place: 'Dumanjug', utility: CEBECO1, match: /\bdumanjug\b/ },
  { place: 'Argao', utility: CEBECO1, match: /\bargao\b/ },
  { place: 'Oslob', utility: CEBECO1, match: /\boslob\b/ },
  { place: 'Toledo City', utility: CEBECO3, match: /\btoledo\b/ },
  { place: 'Balamban', utility: CEBECO3, match: /\bbalamban\b/ },
  { place: 'Asturias', utility: CEBECO3, match: /\basturias\b/ },
  { place: 'Pinamungajan', utility: CEBECO3, match: /\bpinamungajan\b/ },
  { place: 'Aloguinsan', utility: CEBECO3, match: /\baloguinsan\b/ },
]);

/**
 * Folded name to the place it names, built once. lookupPlace runs on every keystroke, so this
 * is a Map read, never a scan. A name held by more than one LGU keeps all of them, which is
 * the whole point: a Mandaue reader searching "Casili" has to be told Consolacion has one too.
 * @type {Map<string, { kind: 'city' | 'barangay', place: string, lgus: string[] }>}
 */
const INDEX = new Map();

const squash = (folded) => folded.replace(/ /g, '');

function register(key, kind, place, lgu) {
  const hit = INDEX.get(key);
  if (!hit) {
    INDEX.set(key, { kind, place, lgus: [lgu] });
    return;
  }
  if (!hit.lgus.includes(lgu)) hit.lgus.push(lgu);
}

for (const { name, barangays } of FRANCHISE) {
  register(fold(name), 'city', name, name);
  for (const alias of CITY_ALIASES[name]) register(fold(alias), 'city', name, name);
  for (const barangay of barangays) register(fold(barangay), 'barangay', barangay, name);
}

// A second pass so a hyphen is optional rather than significant: "Tolotolo" finds "Tolo-tolo"
// and "alang alang" finds "Alang-alang". Written only where it does not shadow a real name.
for (const [key, hit] of [...INDEX]) {
  const bare = squash(key);
  if (bare !== key && !INDEX.has(bare)) INDEX.set(bare, hit);
}

/**
 * What place is the reader naming? Whole names only, so "san" stays null rather than guessing
 * San Roque. `kind: 'outside'` wins over everything, because being told the wrong utility is
 * worse than being told nothing.
 *
 * @param {string} text
 * @returns {null | { kind: 'city' | 'barangay' | 'outside', place: string, lgus: string[], utility?: string }}
 */
export function lookupPlace(text) {
  const key = fold(text);
  if (!key) return null;
  for (const { place, utility, match } of OUTSIDE) {
    if (match.test(key)) return { kind: 'outside', place, lgus: [], utility };
  }
  const hit = INDEX.get(key) ?? INDEX.get(squash(key));
  // Copy the LGU list: the index is shared by every caller and must stay immutable.
  return hit ? { kind: hit.kind, place: hit.place, lgus: [...hit.lgus] } : null;
}
