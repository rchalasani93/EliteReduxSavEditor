(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ERStory = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // Replays one of the game's event scripts (converted by scripts/story.cjs) against a save
  // without running the game. Only effects that persist in the save are collected: flags,
  // story variables and items. Anything that needs a player choice or runs game code the
  // editor cannot reproduce stops the replay or is listed as not reproduced, rather than
  // guessed.
  //
  // state: { flag(id), getVar(id), hasItem(id), gender } read from the save.
  // Returns { flags: Map(id -> 0|1), vars: Map(id -> value), items: Set(id), gifts: [],
  // skipped: [] }
  // and throws if the script cannot be replayed safely.
  const MAX_STEPS = 20000;
  // assume: values for runtime-only variables that decide nothing saved, such as
  // VAR_FACING, which only picks the direction a character walks in.
  function replay(story, entry, state, { start = [], assume = {} } = {}) {
    const flags = new Map(),
      vars = new Map(),
      temps = new Map(Object.entries(assume)),
      items = new Set(),
      gifts = [],
      skipped = [];
    let compared = null,
      steps = 0;
    // Flags past the saved range (the game's "special" flags) exist only while it runs.
    const saved = id => id < story.flagsCount;
    const getFlag = id => (flags.has(id) ? flags.get(id) : saved(id) && state.flag(id) ? 1 : 0);
    const getVar = id => (vars.has(id) ? vars.get(id) : state.getVar(id));
    const varRef = ref => (ref && typeof ref === 'object' ? ref : { real: ref });
    const read = ref => {
      const r = varRef(ref);
      if (r.temp !== undefined) {
        if (!temps.has(r.temp))
          throw new Error(
            `This event depends on ${r.temp}, which only exists while the game runs.`,
          );
        const v = temps.get(r.temp);
        if (v === undefined) throw new Error('This event depends on a choice made in the game.');
        return v;
      }
      if (!Number.isInteger(r.real))
        throw new Error('This event uses a variable the editor does not know.');
      return getVar(r.real);
    };
    const value = v => {
      if (v && typeof v === 'object' && v.var !== undefined) return getVar(v.var);
      if (!Number.isInteger(v))
        throw new Error('This event uses a value the editor does not know.');
      return v;
    };
    const write = (ref, n) => {
      const r = varRef(ref);
      n &= 0xffff;
      if (r.temp !== undefined) temps.set(r.temp, n);
      else if (Number.isInteger(r.real)) {
        if (r.real >= 0x4000 && r.real <= 0x400f) return; // VAR_TEMP_*: reset on every map load
        vars.set(r.real, n);
      } else throw new Error('This event uses a variable the editor does not know.');
    };
    const setFlag = (id, on) => {
      if (!Number.isInteger(id))
        throw new Error('This event uses a flag the editor does not know.');
      if (saved(id)) flags.set(id, on ? 1 : 0);
    };
    const compare = (a, op, b) =>
      ({ '==': a === b, '!=': a !== b, '<': a < b, '>': a > b, '<=': a <= b, '>=': a >= b })[op];
    function test(c) {
      switch (c[0]) {
        case 'flag':
          if (!Number.isInteger(c[1]))
            throw new Error('This event checks a flag the editor does not know.');
          return !!getFlag(c[1]);
        case 'not':
          return !test(c[1]);
        case 'and':
          return test(c[1]) && test(c[2]);
        case 'or':
          return test(c[1]) || test(c[2]);
        case 'var':
          return compare(read(c[1]), c[2], value(c[3]));
        case 'cmp':
          if (!compared) throw new Error('This event compares a value it never set.');
          return compare(compared[0], c[1], compared[1]);
      }
      throw new Error('This event uses a condition the editor cannot check.');
    }
    // Frames: a script label (entered by goto or call) or an inline block of an if/switch.
    const frames = [];
    const enter = (name, called) => {
      const script = story.scripts[name];
      if (!script) throw new Error(`This event needs a script that is not bundled (${name}).`);
      frames.push({ ops: script.body, pc: 0, label: true, called, next: script.next });
    };
    const unwindLabel = () => {
      while (frames.length && !frames[frames.length - 1].label) frames.pop();
      return frames.pop();
    };
    for (const op of start) run(op);
    enter(entry, false);
    while (frames.length) {
      if (++steps > MAX_STEPS) throw new Error('This event did not finish.');
      const frame = frames[frames.length - 1];
      if (frame.pc >= frame.ops.length) {
        if (!frame.label) {
          frames.pop();
          continue;
        }
        if (frame.next) {
          // Assembly falls through into the next label.
          frames.pop();
          enter(frame.next, frame.called);
          continue;
        }
        break; // ran off the end of a script: the game would stop here too
      }
      const op = frame.ops[frame.pc++];
      const flow = run(op);
      if (flow === 'end') break;
    }
    function run(op) {
      switch (op[0]) {
        case 'setflag':
          setFlag(op[1], true);
          return;
        case 'clearflag':
          setFlag(op[1], false);
          return;
        case 'setvar':
          write(op[1], value(op[2]));
          return;
        case 'addvar':
          write(op[1], read(op[1]) + value(op[2]));
          return;
        case 'subvar':
          write(op[1], read(op[1]) - value(op[2]));
          return;
        case 'compare':
          compared = [read(op[1]), value(op[2])];
          return;
        case 'switchasm':
          temps.set('switch', read(op[1]));
          return;
        case 'case':
          if (temps.get('switch') === value(op[1])) {
            const left = unwindLabel();
            enter(op[2], left ? left.called : false);
          }
          return;
        case 'goto': {
          const left = unwindLabel();
          enter(op[1], left ? left.called : false);
          return;
        }
        case 'call':
          enter(op[1], true);
          return;
        case 'jumpif':
          if (!test(op[1])) return;
          if (op[3]) enter(op[2], true);
          else {
            const left = unwindLabel();
            enter(op[2], left ? left.called : false);
          }
          return;
        case 'return': {
          const left = unwindLabel();
          if (!left || !left.called) return 'end';
          return;
        }
        case 'end':
          return 'end';
        case 'if': {
          for (const [cond, body] of op[1])
            if (test(cond)) {
              frames.push({ ops: body, pc: 0, label: false });
              return;
            }
          if (op[2].length) frames.push({ ops: op[2], pc: 0, label: false });
          return;
        }
        case 'switch': {
          const v = read(op[1]);
          const hit = op[2].find(([x]) => value(x) === v);
          const body = hit ? hit[1] : op[3];
          if (body.length) frames.push({ ops: body, pc: 0, label: false });
          return;
        }
        case 'giveitem':
          if (!Number.isInteger(op[1]))
            throw new Error(`This event gives an unknown item (${op[2]}).`);
          if (op[1] > 0) items.add(op[1]);
          temps.set('VAR_RESULT', 1);
          return;
        case 'checkitem':
          temps.set(
            'VAR_RESULT',
            Number.isInteger(op[1]) && (items.has(op[1]) || state.hasItem(op[1])) ? 1 : 0,
          );
          return;
        case 'gift':
          if (!Number.isInteger(op[1].species))
            throw new Error(`This event gives a Pokémon the editor does not know (${op[1].name}).`);
          gifts.push(op[1]);
          temps.set('VAR_RESULT', 0); // MON_GIVEN_TO_PARTY
          return;
        case 'gender':
          temps.set('VAR_RESULT', state.gender);
          return;
        case 'unknown':
          temps.set('VAR_RESULT', undefined);
          return;
        case 'skip':
          skipped.push(op[1]);
          return;
        case 'unreadable':
          throw new Error(`Part of this event could not be read from the game data (${op[1]}).`);
      }
    }
    // Report only real changes.
    for (const [id, on] of flags) if ((state.flag(id) ? 1 : 0) === on) flags.delete(id);
    for (const [id, n] of vars) if (state.getVar(id) === n) vars.delete(id);
    for (const id of items) if (state.hasItem(id)) items.delete(id);
    return { flags, vars, items, gifts, skipped };
  }
  return { replay };
});
