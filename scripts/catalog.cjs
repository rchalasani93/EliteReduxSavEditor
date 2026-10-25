// Builds a Redux Save Studio catalog from an ER Nextdex gameData JSON file.
//
//   node scripts/catalog.cjs <nextdex-gameData.json> <version-label> <output.json> [--patch]
//
// With --patch, the output holds only the entries that differ from the bundled
// src/catalog.json (the base 2.65.4 data). The editor applies such a patch on
// top of the base catalog, which keeps each extra game version small.
//
// The randomizer modulus is the highest ability ID (ABILITIES_COUNT - 1), so a
// build that adds abilities gets a different modulus and therefore different
// PID results. The banned-ability list is read from the bundled 2.65.4
// catalog; it has been the same 38 IDs for every 2.65.x build so far.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const [input, version, output, mode] = process.argv.slice(2);
if (!input || !version || !output) {
  console.error('Usage: node scripts/catalog.cjs <gameData.json> <version-label> <output.json>');
  process.exit(1);
}
const base = require(path.join(__dirname, '../src/catalog.json'));
const data = JSON.parse(fs.readFileSync(input, 'utf8'));

const typeIndex = name => base.types.indexOf(name);
// Types the editor does not know (Nextdex's "None" placeholder) become 255, as in the bundled data.
const mapTypes = ids =>
  ids.map(id => {
    const index = typeIndex(data.typeT[id]);
    return index < 0 ? 255 : index;
  });
const three = list => Array.from({ length: 3 }, (_, i) => list[i] || 0);
const unique = list => [...new Set(list)];

const catalog = {
  version,
  creationDate: data.creationDate,
  config: {
    ...base.config,
    modulus: Math.max(...data.abilities.map(a => a.id)),
  },
  types: base.types,
  natures: data.natureT || base.natures,
  species: {},
  moves: {},
  abilities: {},
  items: {},
};

for (const s of data.species) {
  if (!(s.id > 0)) continue;
  catalog.species[s.id] = {
    id: s.id,
    name: s.name,
    key: s.NAME,
    base: s.stats.base,
    types: mapTypes(s.stats.types),
    abilities: three(s.stats.abis),
    innates: three(s.stats.inns),
    gender: s.stats.gender === 255 ? 255 : Math.floor(s.stats.gender / 100),
    learnset: unique([...s.levelUpMoves.map(m => m.id), ...s.TMHMMoves, ...s.tutor, ...s.eggMoves]),
    // Mega and primal forms. Nextdex stores evolution targets as positions in its species array.
    forms: s.evolutions
      .filter(e => /MEGA|PRIMAL/.test(data.evoKindT[e.kd]))
      .map(e => data.species[e.in]?.id)
      .filter(Boolean),
  };
}
for (const m of data.moves) {
  catalog.moves[m.id] = {
    id: m.id,
    name: m.name,
    pp: m.pp,
    power: m.pwr,
    types: mapTypes(m.types),
    description: m.desc,
    split: m.split,
    banned: data.effT[m.eff] === 'Placeholder' || m.NAME === 'MOVE_DARK_VOID',
  };
}
for (const a of data.abilities) catalog.abilities[a.id] = { name: a.name, desc: a.desc, id: a.id };
for (const i of data.items) catalog.items[i.id] = { id: i.id, name: i.name };
catalog.items[0] = { id: 0, name: 'None' };

if (mode === '--patch') {
  const patch = { version, creationDate: catalog.creationDate, config: catalog.config };
  if (JSON.stringify(catalog.natures) !== JSON.stringify(base.natures))
    patch.natures = catalog.natures;
  for (const table of ['species', 'moves', 'abilities', 'items']) {
    const changes = {};
    for (const id of new Set([...Object.keys(base[table]), ...Object.keys(catalog[table])])) {
      const before = JSON.stringify(base[table][id]);
      const after = JSON.stringify(catalog[table][id]);
      if (before !== after) changes[id] = catalog[table][id] ?? null;
    }
    patch[table] = changes;
  }
  fs.writeFileSync(output, JSON.stringify(patch));
  const counts = ['species', 'moves', 'abilities', 'items'].map(
    t => `${Object.keys(patch[t]).length} ${t}`,
  );
  console.log(`Patch for ${version}: ${counts.join(', ')} changed`);
} else {
  fs.writeFileSync(output, JSON.stringify(catalog));
}
console.log(
  `${version}: ${Object.keys(catalog.species).length} species, ${Object.keys(catalog.moves).length} moves, ` +
    `${Object.keys(catalog.abilities).length} abilities, modulus ${catalog.config.modulus}`,
);
