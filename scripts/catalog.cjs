// Builds a Redux Save Studio catalog from an ER Nextdex gameData JSON file.
//
//   node scripts/catalog.cjs <nextdex-gameData.json> <version-label> <output.json> [--patch]
//                            [--items <er-config/items directory>]
//
// --items reads item pockets and descriptions from Elite Redux's er-config
// repository (items/*.textproto), matched by item constant (ITEM_LEFTOVERS).
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

const args = process.argv.slice(2);
const option = name => {
  const i = args.indexOf(name);
  if (i < 0) return null;
  const value = args[i + 1];
  args.splice(i, 2);
  return value;
};
const itemsDir = option('--items');
const mode = args.includes('--patch') ? '--patch' : null;
const [input, version, output] = args.filter(a => a !== '--patch');
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
const MOVE_TARGETS = {
  SELECTED: 'One target',
  BOTH: 'Both foes',
  USER: 'User',
  RANDOM: 'Random foe',
  FOES_AND_ALLY: 'All other Pokémon',
  DEPENDS: 'Depends on the move',
  ALL_BATTLERS: 'All Pokémon',
  OPPONENTS_FIELD: "Foes' side",
  ALL: 'All Pokémon',
  ALLY: 'Ally',
  USER_OR_ALLY: 'User or ally',
};
const POCKETS = {
  POCKET_ITEMS: 'items',
  POCKET_MEDICINE: 'medicine',
  POCKET_BATTLE: 'battle',
  POCKET_TM_HM: 'tm',
  POCKET_BERRIES: 'berry',
  POCKET_POKE_BALLS: 'ball',
  POCKET_KEY_ITEMS: 'key',
  POCKET_MEGA_STONES: 'mega',
};
// Text-format string escapes: octal and hex bytes are UTF-8 (\303\251 is é).
// In-game line breaks become spaces; a hyphen at a break joins the word again.
function unescapeText(text) {
  const bytes = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c !== '\\') {
      bytes.push(...Buffer.from(c, 'utf8'));
      continue;
    }
    const next = text[++i];
    if (/[0-7]/.test(next)) {
      const octal = /^[0-7]{1,3}/.exec(text.slice(i))[0];
      bytes.push(parseInt(octal, 8));
      i += octal.length - 1;
    } else if (next === 'x') {
      const hex = /^[0-9a-fA-F]{1,2}/.exec(text.slice(i + 1))[0];
      bytes.push(parseInt(hex, 16));
      i += hex.length;
    } else bytes.push(...Buffer.from({ n: '\n', t: '\t', r: '' }[next] ?? next, 'utf8'));
  }
  return Buffer.from(bytes)
    .toString('utf8')
    .replace(/-\n/g, '')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/Poké- mon/g, 'Pokémon') // a few descriptions keep an old line-break hyphen
    .trim();
}
// er-config textproto: item { id: ITEM_X  name: "..."  description: "..."  grouping: POCKET_Y ... }
function readItemConfig(dir) {
  const byConstant = new Map();
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.textproto'))) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const block of text.split(/^item \{/m).slice(1)) {
      const field = name => {
        const m = new RegExp(`^\\s*${name}:\\s*(?:"((?:[^"\\\\]|\\\\.)*)"|(\\S+))`, 'm').exec(
          block,
        );
        return m ? (m[1] !== undefined ? unescapeText(m[1]) : m[2]) : null;
      };
      const id = field('id');
      if (id)
        byConstant.set(id, {
          pocket: POCKETS[field('grouping')] || null,
          desc: field('description'),
        });
    }
  }
  return byConstant;
}
const itemConfig = itemsDir ? readItemConfig(itemsDir) : null;
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
    accuracy: m.acc,
    priority: m.prio,
    target: MOVE_TARGETS[data.targetT[m.target]] || data.targetT[m.target] || '',
    chance: m.chance,
    effect: data.effT[m.eff] || '',
    flags: (m.flags || []).map(f => data.flagsT[f]).filter(Boolean),
    longDescription: m.lDesc && m.lDesc !== m.desc ? m.lDesc : '',
    banned: data.effT[m.eff] === 'Placeholder' || m.NAME === 'MOVE_DARK_VOID',
  };
}
for (const a of data.abilities) catalog.abilities[a.id] = { name: a.name, desc: a.desc, id: a.id };
for (const i of data.items) {
  const extra = itemConfig?.get(i.NAME);
  catalog.items[i.id] = extra
    ? { id: i.id, name: i.name, pocket: extra.pocket, desc: extra.desc || '' }
    : { id: i.id, name: i.name };
}
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
