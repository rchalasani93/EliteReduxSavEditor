const { test } = require('node:test'),
  assert = require('node:assert/strict');
const rng = require('../src/rng.js'),
  catalog = require('../src/catalog.json');
const species = {
  id: 20,
  key: 'SPECIES_TEST',
  gender: 127,
  abilities: [3, 4, 5],
  innates: [6, 7, 8],
  types: [0, 11],
};
const config = { modulus: 9, banned: [0], mysteryType: 9, typeModulus: 19 };
const fixed = { abilityRng: 0, innateRng: 0, typeRng: 0 };
const input = { species, options: fixed, config, lockedSlot: 0, pid: 1, limit: 12 };
function containsAll(actual, wanted) {
  const remaining = actual.slice();
  for (const target of wanted.filter(t => t !== null)) {
    const i = remaining.indexOf(target);
    if (i < 0) return false;
    remaining.splice(i, 1);
  }
  return true;
}
function independentRoll(source, species, pid, enabled, config) {
  if (!enabled || config.banned.includes(source)) return source;
  const step = n => Number((1103515245n * BigInt(n >>> 0) + 24691n) & 0xffffffffn);
  let seed = (source ^ step(species) ^ pid) >>> 0;
  do {
    seed = step(seed);
    const result = ((seed >>> 16) % config.modulus) + 1;
    if (!config.banned.includes(result)) return result;
  } while (true);
}
test('all four requested abilities can appear in a different order', async () => {
  const targets = [8, 6, 3, 7],
    any = await rng.search({ ...input, targets, matchMode: 'any' });
  assert.equal(any.answers.length, 1);
  assert.deepEqual([any.answers[0].ability, ...any.answers[0].innates], [3, 6, 7, 8]);
  const exact = await rng.search({ ...input, targets, matchMode: 'slots' });
  assert.equal(exact.answers.length, 0);
  assert.equal(exact.checked, 0);
});
test('duplicate requests require separate slots and blanks remain unrestricted', async () => {
  assert.equal(
    (await rng.search({ ...input, targets: [6, 6, null, null], matchMode: 'any' })).answers.length,
    0,
  );
  const duplicated = { ...species, innates: [6, 6, 8] };
  const result = await rng.search({
    ...input,
    species: duplicated,
    targets: [6, 6, null, null],
    matchMode: 'any',
  });
  assert.equal(result.answers.length, 1);
  assert.ok(
    containsAll([result.answers[0].ability, ...result.answers[0].innates], [6, 6, null, null]),
  );
});
test('fixed banned abilities may satisfy any-order targets without making them rollable', async () => {
  const bannedConfig = { ...config, modulus: 30, banned: [0, 25] },
    s = { ...species, innates: [6, 25, 8] };
  const options = { abilityRng: 1, innateRng: 1, typeRng: 0 };
  const allowed = await rng.search({
    ...input,
    species: s,
    options,
    config: bannedConfig,
    targets: [25, null, null, null],
    matchMode: 'any',
  });
  assert.equal(allowed.answers.length, 12);
  assert.equal(allowed.complete, false);
  for (const r of allowed.answers) assert.equal(r.innates[1], 25);
  const rejected = await rng.search({
    ...input,
    options,
    config: bannedConfig,
    targets: [25, null, null, null],
    matchMode: 'any',
  });
  assert.equal(rejected.answers.length, 0);
  assert.equal(rejected.checked, 0);
});
test('any-order matches respect independently enabled randomizers and ability-slot selection', async () => {
  for (const abilityRng of [0, 1])
    for (const innateRng of [0, 1]) {
      const options = { abilityRng, innateRng, typeRng: 0 },
        pid = 12345,
        expected = rng.evaluate(species, pid, 2, options, config);
      const targets = [
        expected.innates[2],
        expected.innates[0],
        expected.ability,
        expected.innates[1],
      ];
      const result = await rng.search({
        ...input,
        options,
        pid,
        lockedSlot: 2,
        limit: 1,
        targets,
        matchMode: 'any',
      });
      assert.equal(result.answers.length, 1);
      assert.equal(result.answers[0].slot, 2);
      assert.ok(containsAll([result.answers[0].ability, ...result.answers[0].innates], targets));
    }
});
test('any-order inverse search verifies requested abilities, gender, and unique results', async () => {
  const s = catalog.species[150],
    options = { abilityRng: 1, innateRng: 1, typeRng: 1 },
    targets = [37, 3, null, null];
  const result = await rng.search({
    species: s,
    options,
    config: catalog.config,
    targets,
    matchMode: 'any',
    lockedSlot: 0,
    pid: 0,
    keepGender: true,
    limit: 6,
  });
  assert.equal(result.answers.length, 6);
  assert.ok(result.checked > 0);
  const seen = new Set();
  for (const r of result.answers) {
    const actual = [s.abilities[r.slot], ...s.innates].map((n, i) =>
      independentRoll(
        n,
        s.id,
        r.pid,
        i === 0 ? options.abilityRng : options.innateRng,
        catalog.config,
      ),
    );
    assert.ok(containsAll(actual, targets));
    assert.deepEqual([r.ability, ...r.innates], actual);
    assert.equal(r.slot, 0);
    assert.equal(rng.gender(s, r.pid), rng.gender(s, 0));
    const key = `${r.pid}:${r.slot}`;
    assert.ok(!seen.has(key));
    seen.add(key);
  }
});
test('randomized equal source fields can supply multiple requested copies', async () => {
  const s = { ...species, abilities: [1, 1, 1], innates: [1, 2, 3] },
    c = { ...config, modulus: 7 };
  const result = await rng.search({
    ...input,
    species: s,
    config: c,
    options: { abilityRng: 1, innateRng: 1 },
    targets: [4, 4, null, null],
    matchMode: 'any',
    limit: 12,
  });
  assert.equal(result.answers.length, 12);
  for (const r of result.answers) assert.ok(containsAll([r.ability, ...r.innates], [4, 4]));
});
test('any-order scans can be cancelled and report bounded progress', async () => {
  const progress = [];
  const result = await rng.search(
    {
      species: catalog.species[150],
      options: { abilityRng: 1, innateRng: 1 },
      config: catalog.config,
      targets: [3, 37, 22, 27],
      matchMode: 'any',
      lockedSlot: null,
      pid: 0,
      limit: 100,
    },
    p => progress.push(p),
    () => true,
  );
  assert.equal(result.cancelled, true);
  assert.ok(result.checked > 0);
  assert.ok(progress.length > 0);
  assert.ok(progress.every(p => p.percent >= 0 && p.percent <= 100));
});

test('continuation returns later verified matches without duplicates or restarting candidates', async () => {
  const request = {
    species: catalog.species[150],
    options: { abilityRng: 1, innateRng: 1, typeRng: 1 },
    config: catalog.config,
    targets: [37, 3, null, null],
    matchMode: 'any',
    lockedSlot: null,
    pid: 0,
    keepGender: true,
    limit: 12,
  };
  const pages = rng.searchPages(request),
    answers = [];
  let checked = 0;
  try {
    for (let i = 0; i < 3; i++) {
      const { value: page } = await pages.next();
      assert.equal(page.answers.length, 12);
      assert.equal(page.complete, false);
      assert.ok(page.checked >= checked);
      checked = page.checked;
      answers.push(...page.answers);
    }
  } finally {
    await pages.return();
  }
  assert.equal(new Set(answers.map(r => `${r.pid}:${r.slot}`)).size, 36);
  for (const r of answers) {
    const actual = [request.species.abilities[r.slot], ...request.species.innates].map(source =>
      independentRoll(source, request.species.id, r.pid, 1, request.config),
    );
    assert.deepEqual([r.ability, ...r.innates], actual);
    assert.ok(containsAll(actual, request.targets));
    assert.equal(rng.gender(request.species, r.pid), rng.gender(request.species, request.pid));
  }
  const uninterrupted = await rng.search({ ...request, limit: 36 });
  assert.deepEqual(answers, uninterrupted.answers);
  assert.equal(checked, uninterrupted.checked);
});

test('page boundaries keep every remaining ability slot for the same PID', async () => {
  const pages = rng.searchPages({
      ...input,
      lockedSlot: null,
      limit: 1,
      targets: [6, null, null, null],
      matchMode: 'any',
    }),
    answers = [];
  for (let i = 0; i < 3; i++) {
    const { value: page } = await pages.next();
    assert.equal(page.complete, false);
    answers.push(...page.answers);
  }
  assert.deepEqual(
    answers.map(r => [r.pid, r.slot]),
    [
      [1, 0],
      [1, 1],
      [1, 2],
    ],
  );
  const { value: last } = await pages.next();
  assert.equal(last.complete, true);
  assert.deepEqual(last.answers, []);
  assert.equal((await pages.next()).done, true);
});

test('exhaustive paginated scan finds all anchored PIDs and ends with a partial page', async () => {
  const c = { ...config, modulus: 65536 },
    request = {
      ...input,
      config: c,
      options: { ...fixed, abilityRng: 1 },
      targets: [1, null, null, null],
      matchMode: 'slots',
      limit: 100,
    };
  const pids = new Set();
  let count = 0,
    last;
  for await (const page of rng.searchPages(request)) {
    assert.ok(page.answers.length <= 100);
    last = page;
    for (const r of page.answers) {
      assert.equal(independentRoll(3, species.id, r.pid, 1, c), 1);
      assert.ok(!pids.has(r.pid));
      pids.add(r.pid);
      count++;
    }
  }
  assert.equal(count, 65536);
  assert.equal(last.complete, true);
  assert.equal(last.percent, 100);
  assert.equal(last.answers.length, 36);
  assert.equal(last.checked, 65536);
});

test('targets satisfied by fixed fields can continue over unconstrained randomized fields', async () => {
  const s = { ...species, innates: [6, 25, 8] },
    c = { ...config, modulus: 30, banned: [0, 25] },
    pages = rng.searchPages({
      ...input,
      species: s,
      config: c,
      options: { abilityRng: 1, innateRng: 1 },
      targets: [25, null, null, null],
      matchMode: 'any',
      limit: 3,
    });
  const first = (await pages.next()).value,
    second = (await pages.next()).value;
  await pages.return();
  assert.equal(first.complete, false);
  assert.equal(second.complete, false);
  assert.deepEqual(
    [...first.answers, ...second.answers].map(r => r.pid),
    [1, 2, 3, 4, 5, 6],
  );
  for (const r of [...first.answers, ...second.answers]) assert.equal(r.innates[1], 25);
});

test('an unconstrained fixed ability slot is fully scanned even when other slots have anchors', async () => {
  const request = {
      ...input,
      options: { ...fixed, innateRng: 1 },
      lockedSlot: null,
      targets: [3, null, null, null],
      matchMode: 'any',
      limit: 12,
    },
    expected = [];
  for (let pid = 1; expected.length < 12; pid++)
    for (let slot = 0; slot < 3 && expected.length < 12; slot++) {
      const actual = rng.evaluate(species, pid, slot, request.options, config);
      if (containsAll([actual.ability, ...actual.innates], request.targets))
        expected.push({ pid, slot, ...actual });
    }
  assert.deepEqual((await rng.search(request)).answers, expected);
});
