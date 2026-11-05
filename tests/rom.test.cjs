const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const rom = require('../scripts/rom.cjs'),
  core = require('../src/core.js'),
  catalog = require('../src/catalog.json'),
  patches = require('../src/catalog-patches.json');

const bytes = text => [...rom.encodeText(text)];

test('game text decodes line breaks, hyphens at breaks, colons and the PKMN glyph', () => {
  const buf = Buffer.from([
    ...bytes('If hit by a contact move'),
    0xf0,
    0xfe, // line break
    ...bytes('-1 Defense. Fire-'),
    0xfe,
    ...bytes('type moves. Poké-'),
    0xfe,
    ...bytes('mon hold '),
    0x53,
    0x54,
    0xff,
    ...bytes('ignored'),
  ]);
  assert.equal(
    rom.decodeText(buf, 0),
    'If hit by a contact move: -1 Defense. Fire-type moves. Pokémon hold Pokémon',
  );
  assert.deepEqual([...rom.encodeText('Pound')], [0xca, 0xe3, 0xe9, 0xe2, 0xd8]);
  assert.throws(() => rom.encodeText('漢'), /Cannot encode/);
});

test('only Emerald-based GBA ROMs of a sensible size are read', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rom-test-'));
  try {
    const small = path.join(dir, 'small.gba');
    fs.writeFileSync(small, Buffer.alloc(1024));
    assert.throws(() => rom.readRom(small), /between 1 MB and 32 MB/);
    const other = path.join(dir, 'other.gba');
    const b = Buffer.alloc(2 * 1024 * 1024);
    b.write('AXVE', 0xac, 'latin1'); // Ruby
    fs.writeFileSync(other, b);
    assert.throws(() => rom.readRom(other), /Emerald/);
    b.write('BPEE', 0xac, 'latin1');
    fs.writeFileSync(other, b);
    assert.equal(rom.readRom(other).length, b.length);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a patch holds only changed entries and applies back to the full catalog', () => {
  const next = structuredClone(catalog);
  next.version = 'test';
  next.species[6].gender = 31;
  next.moves[1].power = 41;
  delete next.items[5];
  const patch = rom.diffCatalog(catalog, next);
  assert.deepEqual(Object.keys(patch.species), ['6']);
  assert.deepEqual(Object.keys(patch.moves), ['1']);
  assert.deepEqual(patch.items, { 5: null });
  assert.deepEqual(Object.keys(patch.abilities), []);
  const back = core.applyCatalogPatch(catalog, patch);
  assert.equal(back.species[6].gender, 31);
  assert.equal(back.moves[1].power, 41);
  assert.equal(back.items[5], undefined);
  const diff = rom.compare(catalog, next);
  assert.deepEqual(diff.species.differing, { gender: 1 });
  assert.deepEqual(diff.items.differing, { 'only in first': 1 });
});

test('gender ratios match the game formula (75% female is 191, 87.5% is 223) in every version', () => {
  const allowed = new Set([0, 31, 63, 127, 191, 223, 254, 255]);
  for (const version of [null, ...Object.keys(patches)]) {
    const data = version ? core.applyCatalogPatch(catalog, patches[version]) : catalog;
    const odd = Object.values(data.species).filter(s => !allowed.has(s.gender));
    assert.deepEqual(odd, [], `${version || catalog.version}: unexpected gender ratios`);
    assert.equal(data.species[35].gender, 191, 'Clefairy is 75% female');
  }
});

test('2.65.5.2b learnsets come from the ROM: tutor moves and the Toxic Terrain fix', () => {
  const data = core.applyCatalogPatch(catalog, patches['2.65.5.2b']);
  const name = id => data.moves[id].name;
  const venonat = data.species[48].learnset.map(name);
  assert.ok(venonat.includes('Toxic Terrain'));
  assert.ok(!venonat.includes('Sky Quake'));
  assert.ok(data.species[1].learnset.map(name).includes('Snore'));
});

// With ER_ROM set to an Elite Redux 2.65.5.2b ROM, extract everything and compare with the
// bundled data. Skipped otherwise: ROMs are never part of the repository.
test(
  'extracting the 2.65.5.2b ROM reproduces the bundled data',
  { skip: !process.env.ER_ROM },
  () => {
    const prev = core.applyCatalogPatch(catalog, patches['2.65.5.2b']);
    const { catalog: out, tables } = rom.extract(
      rom.readRom(process.env.ER_ROM),
      prev,
      '2.65.5.2b',
    );
    assert.equal(tables.species, '0xc0fedc');
    assert.equal(tables.abilities, '0xfeb49c');
    const diff = rom.compare(prev, out);
    for (const table of ['species', 'moves', 'abilities', 'items'])
      assert.deepEqual(diff[table].differing, {}, `${table} differs`);
    assert.deepEqual(out.config, prev.config);
  },
);
