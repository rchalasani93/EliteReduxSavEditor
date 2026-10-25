const { test } = require('node:test'),
  assert = require('node:assert/strict');
const core = require('../src/core.js'),
  rng = require('../src/rng.js'),
  catalog = require('../src/catalog.json'),
  patches = require('../src/catalog-patches.json'),
  { fixture } = require('./fixture.cjs');
const latest = core.applyCatalogPatch(catalog, patches['2.65.4.11b']);
const ability = name => Object.values(latest.abilities).find(a => a.name === name).id;
const collect = async request => {
  const found = [];
  for await (const page of rng.findSpecies(request)) found.push(...page.found);
  return found;
};
const hasAll = (r, targets) => {
  const values = [r.ability, ...r.innates];
  return targets.every(
    t => values.filter(v => v === t).length >= targets.filter(x => x === t).length,
  );
};

test('species sharing ability sources roll identically once the PID is translated', () => {
  const groups = rng.groupLayouts(Object.values(latest.species)).filter(g => g.length > 1);
  assert.ok(groups.length > 50);
  const options = { abilityRng: 1, innateRng: 1, typeRng: 0 };
  for (const [a, b] of groups.slice(0, 40)) {
    const key = 0x5eed1234,
      pa = (key ^ rng.step(a.id)) >>> 0,
      pb = (key ^ rng.step(b.id)) >>> 0;
    for (const slot of [0, 1, 2]) {
      const ra = rng.evaluate(a, pa, slot, options, latest.config),
        rb = rng.evaluate(b, pb, slot, options, latest.config);
      assert.equal(ra.ability, rb.ability);
      assert.deepEqual(ra.innates, rb.innates);
    }
  }
});

test('species finder agrees with the exhaustive single-species search', async () => {
  const groups = rng.groupLayouts(Object.values(latest.species)).slice(0, 40);
  const cases = [
    [{ abilityRng: 1, innateRng: 1, typeRng: 0 }, ['Intimidate', 'Regenerator']],
    [{ abilityRng: 1, innateRng: 0, typeRng: 0 }, ['Levitate']],
    [{ abilityRng: 0, innateRng: 1, typeRng: 0 }, ['Swift Swim', 'Swift Swim']],
  ];
  for (const [options, names] of cases) {
    const targets = names.map(ability);
    for (const group of groups) {
      const found = await collect({ groups: [group], options, config: latest.config, targets });
      for (const r of found) {
        const sp = latest.species[r.species];
        assert.ok(hasAll(rng.evaluate(sp, r.pid, r.slot, options, latest.config), targets));
      }
      const exhaustive = await rng.search({
        species: group[0],
        options,
        config: latest.config,
        targets: [...targets, null, null, null].slice(0, 4),
        matchMode: 'any',
        lockedSlot: null,
        keepGender: false,
        pid: 0,
        limit: 1,
      });
      assert.equal(found.length > 0, exhaustive.answers.length > 0, `${group[0].name} ${names}`);
      if (found.length) assert.equal(found.length, group.length, 'every species in a layout');
    }
  }
});

test('with randomizers off the finder lists natural owners only', async () => {
  const target = ability('Intimidate'),
    options = { abilityRng: 0, innateRng: 0, typeRng: 0 };
  const species = Object.values(latest.species);
  const found = await collect({
    groups: rng.groupLayouts(species),
    options,
    config: latest.config,
    targets: [target],
    pid: 77,
  });
  const natural = species.filter(
    sp =>
      [0, 1, 2].some(k => (sp.abilities[k] || sp.abilities[0]) === target) ||
      sp.innates.includes(target),
  );
  assert.deepEqual(
    found.map(r => r.species).sort((a, b) => a - b),
    natural.map(sp => sp.id).sort((a, b) => a - b),
  );
  assert.ok(found.every(r => r.pid === 77));
});

test('finder rejects empty or unknown targets', async () => {
  const request = targets => collect({ groups: [], options: {}, config: latest.config, targets });
  await assert.rejects(request([]), /one to four/);
  await assert.rejects(request([latest.config.modulus + 1]), /Unknown ability/);
});

test('game version is detected from moves, then the file name', () => {
  const versions = { '2.65.4.11b': latest, '2.65.4': catalog },
    aliases = { '2.65.4.1b': '2.65.4' };
  const plain = new core.Save(fixture(), latest);
  assert.equal(core.detectVersion(plain, versions, 'pokemon.sav', aliases), null);
  assert.deepEqual(core.detectVersion(plain, versions, 'Elite_Redux_2.65.4.11b.sav', aliases), {
    version: '2.65.4.11b',
    reason: 'filename',
  });
  assert.deepEqual(core.detectVersion(plain, versions, 'ER 2-65-4-1b.srm', aliases), {
    version: '2.65.4',
    reason: 'filename',
  });
  const newMove = Object.keys(latest.moves)
    .map(Number)
    .find(id => !catalog.moves[id]);
  assert.ok(newMove, 'the 2.65.4.11b data adds moves');
  plain.createMon({ kind: 'box', box: 3 }, { species: 25, level: 10, moves: [newMove] });
  // Move evidence wins over a file name that names the older build.
  assert.deepEqual(core.detectVersion(plain, versions, 'redux 2.65.4.sav', aliases), {
    version: '2.65.4.11b',
    reason: 'moves',
  });
});

test('catalog carries move details and bag pockets', () => {
  const byName = (kind, name) => Object.values(catalog[kind]).find(x => x.name === name);
  const quickAttack = byName('moves', 'Quick Attack');
  assert.equal(quickAttack.priority, 2); // Elite Redux gives it +2
  assert.equal(quickAttack.accuracy, 100);
  assert.ok(quickAttack.target);
  assert.equal(byName('items', 'Master Ball').pocket, 'ball');
  assert.equal(byName('items', 'Potion').pocket, 'medicine');
  assert.ok(byName('items', 'Potion').desc);
});
