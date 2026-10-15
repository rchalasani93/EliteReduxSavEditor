const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs');
const core = require('../src/core.js'),
  catalog = require('../src/catalog.json'),
  { fixture } = require('./fixture.cjs');
const party = slot => ({ kind: 'party', slot });
const changedOnly = (before, after, allowed) => {
  for (let i = 0; i < after.length; i++)
    if (after[i] !== before[i]) assert.ok(allowed(i), `Unexpected modified byte ${i}`);
};

test('new option bits round trip without touching neighbouring options', () => {
  const s = new core.Save(fixture(), catalog),
    before = s.options();
  s.editOptions({
    textSpeed: 3,
    hpBarSpeed: 2,
    battleSceneOff: 1,
    buttonMode: 2,
    frameType: 19,
    battleTheme: 3,
    doubleBattles: 1,
    playerAI: 1,
    damageDone: 1,
    askForNickname: 1,
    individualColors: 1,
    sound: 1,
    battleStyle: 1,
  });
  const after = s.options();
  for (const k of [
    'difficulty',
    'levelCaps',
    'abilityRng',
    'innateRng',
    'shinyRate',
    'enableEvs',
    'autoRun',
    'permanentRepel',
    'permMega',
  ])
    assert.equal(after[k], before[k], k);
  assert.deepEqual(
    [
      after.textSpeed,
      after.hpBarSpeed,
      after.battleSceneOff,
      after.buttonMode,
      after.frameType,
      after.battleTheme,
      after.doubleBattles,
    ],
    [3, 2, 1, 2, 19, 3, 1],
  );
  assert.throws(() => s.editOptions({ buttonMode: 3 }), /buttonMode/);
});
test('origin, markings, language, HP and status edits preserve the rest of the record', () => {
  const s = new core.Save(fixture(), catalog),
    before = s.mon(party(0));
  s.editMon(party(0), {
    otName: 'Red',
    otid: 0x00010002,
    otGender: 1,
    metLocation: 42,
    language: 5,
    markings: 0b1010,
    alpha: 1,
    eventMon: 1,
    hp: 10,
    status: core.STATUS.burn,
  });
  const m = s.mon(party(0));
  assert.deepEqual(
    [
      m.otName,
      m.otid,
      m.otGender,
      m.metLocation,
      m.language,
      m.markings,
      m.alpha,
      m.eventMon,
      m.hp,
      m.status,
    ],
    ['Red', 0x10002, 1, 42, 5, 10, 1, 1, 10, 16],
  );
  for (const k of [
    'species',
    'pid',
    'experience',
    'nature',
    'moves',
    'evs',
    'ball',
    'speedDown',
    'nickname',
    'stats',
  ])
    assert.deepEqual(m[k], before[k], k);
  assert.throws(() => s.editMon(party(0), { hp: m.stats[0] + 1 }), /maximum/);
  assert.throws(() => s.editMon(party(0), { language: 6 }), /language/i);
  assert.throws(() => s.editMon({ kind: 'box', box: 2, slot: 18 }, { status: 16 }), /party/);
});
test('trainer card edits can carry owned Pokémon along', () => {
  const s = new core.Save(fixture(), catalog);
  s.editTrainer({ name: 'Ash', tid: 1, sid: 2, gender: 1, hours: 5, minutes: 6, seconds: 7 });
  const t = s.trainerCard();
  assert.deepEqual(
    [t.name, t.tid, t.sid, t.gender, t.hours, t.minutes, t.seconds],
    ['Ash', 1, 2, 1, 5, 6, 7],
  );
  // The fixture's Pokémon were not caught by "Tester"/12345678 trainer card, so check with a matching OT.
  const s2 = new core.Save(fixture(), catalog),
    t2 = s2.trainerCard();
  s2.editMon(party(0), { otName: t2.name, otid: t2.id });
  s2.editTrainer({ name: 'Misty', tid: 7 });
  const m = s2.mon(party(0));
  assert.equal(m.otName, 'Misty');
  assert.equal(m.otid & 0xffff, 7);
  const s3 = new core.Save(fixture(), catalog),
    t3 = s3.trainerCard();
  s3.editMon(party(0), { otName: t3.name, otid: t3.id });
  s3.editTrainer({ name: 'Brock' }, { updateOwned: false });
  assert.equal(s3.mon(party(0)).otName, t3.name);
  assert.throws(() => s.editTrainer({ name: 'TooLongName' }), /7 characters/);
});
test('money and coins are stored as plain values and bag flags flip single bits', () => {
  const s = new core.Save(fixture(), catalog);
  assert.deepEqual(s.money(), { money: 0, coins: 0, supported: true });
  s.editMoney({ money: 123456, coins: 77 });
  assert.deepEqual(s.money(), { money: 123456, coins: 77, supported: true });
  assert.equal(new DataView(s.read(2 * core.DATA + 0x400, 4).buffer).getUint32(0, true), 123456);
  assert.throws(() => s.editMoney({ money: 1000000 }), /Money/);
  const before = s.bytes.slice();
  s.editItems({ 1: true, 644: true });
  assert.deepEqual(s.ownedItems(), [1, 644]);
  changedOnly(
    before,
    s.bytes,
    i =>
      [s.physical(2 * core.DATA + 0x40a), s.physical(2 * core.DATA + 0x40a + 80)].includes(i) ||
      i % 4096 >= 4084,
  );
  s.editItems({ 1: false });
  assert.deepEqual(s.ownedItems(), [644]);
  s.editBoxNames(['Team', '', undefined]);
  assert.equal(s.boxName(0), 'Team');
  assert.throws(() => s.editBoxName(1, 'NineChars'), /8 characters/);
});
test('Battle Points edit only their own two bytes and respect the 9,999 cap', () => {
  const s = new core.Save(fixture(), catalog),
    before = s.bytes.slice();
  assert.deepEqual(s.battlePoints(), { battlePoints: 0, cardBattlePoints: 0, supported: true });
  s.editBattlePoints(1234);
  assert.equal(s.battlePoints().battlePoints, 1234);
  assert.equal(s.battlePoints().cardBattlePoints, 0);
  changedOnly(
    before,
    s.bytes,
    i => i === s.physical(0xc14) || i === s.physical(0xc15) || i % 4096 >= 4084,
  );
  assert.equal(s.options().textSpeed, new core.Save(fixture(), catalog).options().textSpeed);
  assert.throws(() => s.editBattlePoints(10000), /Battle Points/);
});
test('Pokédex, speed vars, stats, card BP, PC and nuzlocke edits touch only their own bytes', () => {
  const s = new core.Save(fixture(), catalog),
    before = s.bytes.slice(),
    SB1 = 2 * core.DATA;
  s.editPokedex({ 150: 'caught', 25: 'seen' });
  const d = s.pokedex();
  assert.equal(d.caught(150), 1);
  assert.equal(d.seen(150), 1);
  assert.equal(d.seen(25), 1);
  assert.equal(d.caught(25), 0);
  s.editPokedex({ 150: 'seen' });
  assert.equal(s.pokedex().caught(150), 0);
  assert.equal(s.pokedex().seen(150), 1);
  assert.throws(() => s.editPokedex({ 0: 'seen' }), /Pokédex/);
  assert.throws(() => s.editPokedex({ 1: 'owned' }), /state/);
  s.editOptions({ battleSpeed: 3, overworldSpeed: 2 });
  assert.equal(s.options().battleSpeed, 3);
  assert.equal(s.options().overworldSpeed, 2);
  assert.equal(s.getVar(0xe1), 3);
  s.editGameStats({ 5: 123456 });
  assert.equal(s.gameStats()[5], 123456);
  assert.throws(() => s.editGameStats({ 10: 1 }), /cannot/);
  s.editCardBattlePoints(77);
  assert.equal(s.battlePoints().cardBattlePoints, 77);
  s.editStorage({ currentBox: 4, wallpapers: Array.from({ length: 26 }, (_, i) => i % 16) });
  assert.equal(s.storage().currentBox, 4);
  assert.equal(s.storage().wallpapers[15], 15);
  assert.throws(() => s.editStorage({ wallpapers: Array(26).fill(16) }), /wallpaper/);
  s.editNuzlocke({ captureRule: 1 });
  assert.equal(s.nuzlocke().captureRule, 1);
  const allowed = new Set();
  const add = (o, n) => {
    for (let i = 0; i < n; i++) allowed.add(s.physical(o + i));
  };
  add(SB1 + 0x2e54, 188);
  add(SB1 + 0x2f10, 188);
  add(SB1 + 0x1c78 + 0xe1 * 2, 2);
  add(SB1 + 0x1c78 + 0xe3 * 2, 2);
  add(SB1 + 0x1e78 + 5 * 4, 4);
  add(0xc16, 2);
  add(core.PC_START - 4, 1);
  add(core.PC_START - 4 + 0x9f5e, 26);
  add(0xc9c, 1);
  changedOnly(before, s.bytes, i => allowed.has(i) || i % 4096 >= 4084);
});
test('clock shifts move the stored offset the opposite way and stay normalised', () => {
  const s = new core.Save(fixture(), catalog);
  s.write(0x24, [0x10, 0, 5, 30, 0, 0]);
  s.rechecksum();
  s.shiftClock(90);
  assert.deepEqual(s.clockOffset(), { days: 16, hours: 4, minutes: 0, seconds: 0 });
  s.shiftClock(-24 * 60 * 2);
  assert.deepEqual(s.clockOffset(), { days: 18, hours: 4, minutes: 0, seconds: 0 });
  s.shiftClock(5 * 60);
  assert.deepEqual(s.clockOffset(), { days: 17, hours: 23, minutes: 0, seconds: 0 });
});
test('create, duplicate, move, swap and release Pokémon keep the save valid', () => {
  const s = new core.Save(fixture(), catalog);
  const a = s.createMon(
    { kind: 'party' },
    { species: 359, level: 30, moves: [400], nature: 3, pid: 0x1234 },
  );
  assert.deepEqual(a, { kind: 'party', slot: 1 });
  assert.equal(s.partyCount, 2);
  const m = s.mon(a);
  assert.equal(m.nickname, 'Absol');
  assert.equal(m.level, 30);
  assert.equal(m.otName, 'Tester');
  assert.equal(m.hp, m.stats[0]);
  assert.equal(m.pp[0], core.maxPP(catalog.moves[400]));
  const mega = Object.values(catalog.species).find(x => x.key === 'SPECIES_ABSOL_MEGA');
  if (mega) assert.equal(core.baseSpeciesName(catalog, mega), 'Absol');
  const d = s.duplicateMon(a, { kind: 'box', box: 0 });
  assert.equal(s.mon(d).pid, 0x1234);
  const moved = s.moveMon(a, { kind: 'box', box: 5, slot: 3 });
  assert.equal(s.partyCount, 1);
  assert.equal(s.mon(moved).species, 359);
  s.moveMon(moved, { kind: 'party' });
  assert.equal(s.partyCount, 2);
  assert.equal(s.mon(party(1)).species, 359);
  s.moveMon(party(0), { kind: 'box', box: 2, slot: 18 });
  assert.equal(s.mon(party(0)).species, 150);
  assert.equal(s.mon({ kind: 'box', box: 2, slot: 18 }).species, 150);
  s.deleteMon(party(1));
  assert.equal(s.partyCount, 1);
  assert.throws(() => s.deleteMon(party(0)), /at least one/);
  assert.throws(
    () => s.createMon({ kind: 'box', box: 0, slot: d.slot }, { species: 1, moves: [1] }),
    /occupied/,
  );
  const again = new core.Save(s.export(), catalog);
  assert.equal(again.partyCount, 1);
  assert.equal(
    again.report().every(r => r.valid),
    true,
  );
  while (s.undoStack.length) s.undo();
  assert.deepEqual(s.bytes, fixture());
});
test('a failed structural edit rolls back the party count too', () => {
  const s = new core.Save(fixture(), catalog),
    before = s.bytes.slice();
  assert.throws(() => s.createMon({ kind: 'party' }, { species: 150, moves: [99999] }), /move/);
  assert.equal(s.partyCount, 1);
  assert.deepEqual(s.bytes, before);
});
test('Showdown sets export and import, including forms and nicknames', () => {
  const s = new core.Save(fixture(), catalog),
    m = s.mon(party(0));
  const text = core.toShowdown(m, catalog, 'Pressure');
  assert.match(text, /^Mewtwo/);
  assert.match(text, /- /);
  const back = core.parseShowdown(text, catalog);
  assert.equal(back.species, 150);
  assert.deepEqual(back.moves, m.moves.filter(Boolean));
  const set = core.parseShowdown(
    'Chompy (Garchomp-Mega) (F) @ Life Orb\nAbility: Sand Force\nLevel: 77\nShiny: Yes\nEVs: 252 Atk / 4 SpD / 252 Spe\nJolly Nature\nIVs: 0 Spe\n- Earthquake\n- Not A Real Move\n- Swords Dance',
    catalog,
  );
  assert.equal(catalog.species[set.species].name, 'Garchomp Mega');
  assert.equal(set.nickname, 'Chompy');
  assert.equal(set.level, 77);
  assert.equal(set.shiny, 1);
  assert.deepEqual(set.evs, [0, 252, 0, 0, 4, 252]);
  assert.equal(catalog.natures[set.nature], 'Jolly');
  assert.equal(set.speedDown, 1);
  assert.equal(set.moves.length, 2);
  assert.equal(set.warnings.length, 1);
  assert.throws(() => core.parseShowdown('Notamon\n- Tackle', catalog), /Unknown species/);
});
test('an unrecognised party Pokémon no longer blocks opening the save', () => {
  const b = fixture(),
    s0 = new core.Save(b, catalog),
    addr = s0.physical(core.PARTY_START + 16);
  b[addr] = 0xff;
  b[addr + 1] = 0xff;
  for (const sec of s0.sections.values())
    new DataView(b.buffer).setUint16(
      sec.offset + 4086,
      core.checksum(b.subarray(sec.offset, sec.offset + 4084)),
      true,
    );
  const s = new core.Save(b, catalog);
  assert.equal(s.invalidSlots().length, 1);
  s.editOptions({ enableEvs: 0 });
});
if (process.env.ER_SAMPLE_FILE)
  test('provided real save: new features export cleanly and match stored stats', () => {
    const input = fs.readFileSync(process.env.ER_SAMPLE_FILE),
      s = new core.Save(input, catalog);
    assert.equal(s.invalidSlots().length, 0);
    assert.ok(s.ownedItems().includes(1), 'Master Ball flag expected');
    assert.ok(s.battlePoints().supported);
    const dex = s.pokedex();
    for (let n = 1; n <= dex.max; n++)
      if (dex.caught(n)) assert.equal(dex.seen(n), 1, `caught #${n} must be seen`);
    assert.ok(dex.counts().caught > 0);
    assert.equal(s.gameStats()[0], s.counter, 'times-saved stat matches the save counter');
    assert.ok(s.options().battleSpeed <= 3 && s.options().overworldSpeed <= 3);
    assert.ok(s.storage().wallpapers.every(w => w < 17));
    for (const m of s.party()) {
      const f = s.partyForm(s.rawRecord(m.ref).slice(0, 52)),
        v = new DataView(f.buffer);
      assert.deepEqual(
        [64, 66, 68, 72, 74, 70].map(o => v.getUint16(o, true)),
        m.stats,
      );
    }
    const placed = s.createMon({ kind: 'box' }, { species: 445, level: 50, moves: [89] });
    s.moveMon(placed, { kind: 'party', slot: 0 });
    s.editItems({ 1: false });
    s.editTrainer({ name: 'Test' });
    s.editBoxNames(['Alpha']);
    const out = new core.Save(s.export(), catalog);
    assert.equal(
      out.report().every(r => r.valid),
      true,
    );
    assert.equal(out.mon(party(0)).species, 445);
    assert.equal(out.trainerCard().name, 'Test');
    while (s.undoStack.length) s.undo();
    assert.deepEqual(Buffer.from(s.bytes), input);
  });
test('random natures and Hidden Power types stay in range and cover every value', () => {
  const seen = new Set();
  for (let i = 0; i < 5000; i++) {
    const n = core.randomInt(25);
    assert.ok(Number.isInteger(n) && n >= 0 && n < 25);
    seen.add(n);
  }
  assert.equal(seen.size, 25);
  const s = new core.Save(fixture(), catalog);
  for (let i = 0; i < 50; i++) {
    const r = core.readMon(s.newRecord({ species: 150, moves: [1] }), { kind: 'box' });
    assert.ok(r.nature < 25);
    assert.ok(r.hpType < 19 && r.hpType !== 9);
  }
});
