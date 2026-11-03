const { test } = require('node:test'),
  assert = require('node:assert/strict');
const core = require('../src/core.js'),
  ERStory = require('../src/story.js'),
  story = require('../src/story.json'),
  catalog = require('../src/catalog.json'),
  patches = require('../src/catalog-patches.json'),
  { fixture } = require('./fixture.cjs');
const latest = core.applyCatalogPatch(catalog, patches['2.65.4.11b']);
const stateOf = save => ({
  flag: id => save.flag(id),
  getVar: id => save.getVar(id - story.varsStart),
  hasItem: id => save.hasItem(id),
  gender: save.trainerCard().gender,
});
const replay = (save, entry, options = {}) =>
  ERStory.replay(story, entry, stateOf(save), { assume: { VAR_FACING: 2 }, ...options });
const planOf = r => ({
  flags: [...r.flags],
  vars: [...r.vars],
  items: [...r.items],
  gifts: r.gifts,
});

test('story data uses the flag numbers the editor already reads', () => {
  assert.deepEqual(
    story.gyms.map(g => g.badgeFlag),
    [2889, 2890, 2891, 2892, 2893, 2894, 2895, 2896],
  );
  assert.equal(story.champion.gameClear, 2885);
  assert.equal(story.flagsCount, 6135);
  assert.equal(story.vars.VAR_PETALBURG_GYM_STATE, 0x4085);
  // The battle and overworld speed settings are story variables 0x40E1 and 0x40E3.
  assert.equal(story.vars.VAR_BATTLE_SPEED, 0x40e1);
});

test('every gym leader and the Champion replay without guessing', () => {
  const save = new core.Save(fixture(), latest);
  for (const g of story.gyms) {
    const r = replay(save, g.entry);
    assert.equal(r.flags.get(g.badgeFlag), 1, `${g.leader} gives the badge`);
    assert.equal(r.flags.get(g.gymFlag), 1, `${g.leader} marks the gym defeated`);
    assert.equal(r.gifts.length, 1, `${g.leader} gives one gift Pokémon`);
  }
  const champion = replay(save, story.champion.entry, { start: story.champion.before });
  assert.equal(champion.flags.get(story.champion.isChampion), 1);
  assert.equal(champion.vars.get(story.vars.VAR_ELITE_4_STATE) ?? 0, 0);
});

test("Norman's scene saves the same changes whichever way the player faces", () => {
  const save = new core.Save(fixture(), latest);
  const norman = story.gyms[4];
  const plans = [2, 3, 4].map(facing =>
    JSON.stringify(planOf(replay(save, norman.entry, { assume: { VAR_FACING: facing } }))),
  );
  assert.equal(new Set(plans).size, 1);
});

test('replay stops instead of guessing at choices or runtime state', () => {
  const tiny = {
    flagsCount: 10,
    scripts: {
      choice: {
        body: [
          ['unknown', 'msgbox yes/no'],
          ['jumpif', ['var', { temp: 'VAR_RESULT' }, '==', 1], 'yes', false],
        ],
      },
      facing: { body: [['switch', { temp: 'VAR_FACING' }, [[2, [['setflag', 1]]]], []]] },
      yes: { body: [['setflag', 2], ['end']] },
    },
  };
  const state = { flag: () => 0, getVar: () => 0, hasItem: () => 0, gender: 0 };
  assert.throws(() => ERStory.replay(tiny, 'choice', state), /choice made in the game/);
  assert.throws(() => ERStory.replay(tiny, 'facing', state), /only exists while the game runs/);
  assert.equal(
    ERStory.replay(tiny, 'facing', state, { assume: { VAR_FACING: 2 } }).flags.get(1),
    1,
  );
});

test('beating every gym and becoming Champion keeps the save valid, and undo restores it', () => {
  const save = new core.Save(fixture(), latest),
    original = save.bytes.slice();
  for (const g of story.gyms) save.applyStory(planOf(replay(save, g.entry)), `Beat ${g.leader}`);
  assert.equal(save.badge(), 8);
  assert.equal(save.partyCount, 6);
  const champion = replay(save, story.champion.entry, { start: story.champion.before });
  const plan = planOf(champion);
  plan.flags.push([story.champion.gameClear, 1], [story.champion.isChampion, 1]);
  plan.champion = true;
  save.applyStory(plan, 'Become Champion');
  assert.equal(save.badge(), 9);
  assert.equal(save.cap(), save.options().levelCaps === 3 ? 100 : save.cap());
  const reopened = new core.Save(save.export(), latest);
  assert.equal(reopened.damaged.length, 0);
  assert.equal(reopened.flag(story.champion.gameClear), 1);
  for (const m of reopened.allMons()) reopened.assertMon(m);
  // Gift Pokémon past a full party go to the PC, and the Pokédex records them.
  const giftSpecies = story.gyms.map(
    g => replay(new core.Save(fixture(), latest), g.entry).gifts[0].species,
  );
  const inPc = reopened
    .allMons()
    .filter(m => m.ref.kind === 'box')
    .map(m => m.species);
  assert.ok(giftSpecies.filter(id => inPc.includes(id)).length >= 2);
  assert.ok(giftSpecies.every(id => reopened.pokedex().caught(id)));
  assert.equal(save.history.length, 9, 'each milestone is one undo step');
  while (save.undoStack.length) save.undo();
  assert.ok(save.bytes.every((b, i) => b === original[i]));
});

test('story edits only touch flags and variables inside their blocks', () => {
  const save = new core.Save(fixture(), latest);
  assert.throws(() => save.applyStory({ flags: [[767 * 8, 1]] }), /Flag/);
  assert.throws(() => save.applyStory({ vars: [[0x4100, 1]] }), /Variable/);
  assert.throws(() => save.applyStory({ vars: [[0x4050, 70000]] }), /Variable value/);
  save.applyStory({ flags: [[story.flags.FLAG_BADGE03_GET, 1]], vars: [[0x4050, 5]] });
  assert.equal(save.flag(story.flags.FLAG_BADGE03_GET), 1);
  assert.equal(save.getVar(0x50), 5);
  assert.equal(save.badge(), 3);
});
