#!/usr/bin/env node
// Builds src/story.json from the Elite Redux source and an ER Nextdex gameData file:
//   node scripts/story.cjs <eliteredux-source dir> <nextdex gameData.json>
//
// The output holds the names of the game's story flags and variables, and the game's
// own event scripts for a few milestones (each gym leader's first victory and becoming
// Champion), converted to a small instruction list the editor can replay against a
// save. Only scripts reachable from those milestones are kept.
'use strict';
const fs = require('node:fs'),
  path = require('node:path');

const [sourceDir, gameDataFile] = process.argv.slice(2);
if (!sourceDir || !gameDataFile) {
  console.error('Usage: node scripts/story.cjs <eliteredux-source dir> <gameData.json>');
  process.exit(1);
}
const read = file => fs.readFileSync(path.join(sourceDir, file), 'utf8');

// ---- Constants ------------------------------------------------------------------------------
// #define NAME value, where value is a number or an expression of earlier names.
function readDefines(file, into = new Map(), comments = new Map()) {
  for (const line of read(file).split('\n')) {
    const m = /^#define\s+(\w+)\s+([^/]*?)\s*(?:\/\/\s*(.*))?$/.exec(line);
    if (!m || !m[2]) continue;
    into.set(m[1], m[2]);
    if (m[3]) comments.set(m[1], m[3].trim());
  }
  return { raw: into, comments };
}
function evaluator(raw) {
  const cache = new Map();
  const value = (name, depth = 0) => {
    if (cache.has(name)) return cache.get(name);
    if (!raw.has(name) || depth > 40) return undefined;
    const expr = raw.get(name).replace(/\b[A-Za-z_]\w*\b/g, id => {
      const v = value(id, depth + 1);
      return v === undefined ? 'NaN' : String(v);
    });
    if (!/^[\d\s+\-*()xXa-fA-F<>|&]+$/.test(expr.replace(/NaN/g, ''))) return undefined;
    let n;
    try {
      n = Function(`"use strict";return (${expr});`)();
    } catch {
      return undefined;
    }
    n = Number.isInteger(n) ? n : undefined;
    cache.set(name, n);
    return n;
  };
  return value;
}
const flagDefs = readDefines('include/constants/flags.h');
const varDefs = readDefines('include/constants/vars.h');
// Expressions may use constants from any header (MAX_OLD_TRAINERS_COUNT, for example).
const allDefs = new Map();
for (const f of fs.readdirSync(path.join(sourceDir, 'include/constants')))
  if (f.endsWith('.h')) readDefines(`include/constants/${f}`, allDefs);
for (const [k, v] of [...flagDefs.raw, ...varDefs.raw]) allDefs.set(k, v);
const constant = evaluator(allDefs);
const flagValue = constant,
  varValue = constant,
  trainerValue = constant;
const FLAGS_COUNT = flagValue('FLAGS_COUNT'),
  TRAINER_FLAGS_START = flagValue('TRAINER_FLAGS_START'),
  SYSTEM_FLAGS = flagValue('SYSTEM_FLAGS'),
  VARS_START = varValue('VARS_START'),
  VARS_END = varValue('VARS_END');
if (![FLAGS_COUNT, TRAINER_FLAGS_START, SYSTEM_FLAGS, VARS_START, VARS_END].every(Number.isInteger))
  throw new Error('Could not read flag and variable ranges from the source.');

const flags = {},
  vars = {};
for (const name of flagDefs.raw.keys()) {
  if (!/^FLAG_/.test(name) || /^FLAG_(TEMP|UNUSED)/.test(name)) continue;
  const id = flagValue(name);
  if (Number.isInteger(id) && id >= 0 && id < FLAGS_COUNT) flags[name] = id;
}
for (const name of varDefs.raw.keys()) {
  if (!/^VAR_/.test(name)) continue;
  const id = varValue(name);
  if (Number.isInteger(id) && id >= VARS_START && id <= VARS_END) vars[name] = id;
}
const varNotes = Object.fromEntries(
  [...varDefs.comments].filter(([name]) => name in vars).map(([n, c]) => [n, c]),
);
const gameData = JSON.parse(fs.readFileSync(gameDataFile, 'utf8'));
const items = new Map(),
  speciesIds = new Map(),
  moveIds = new Map();
for (const item of gameData.items) if (item.NAME) items.set(item.NAME, item.id);
for (const sp of gameData.species) if (sp.NAME) speciesIds.set(sp.NAME, sp.id);
for (const mv of gameData.moves) if (mv.NAME) moveIds.set(mv.NAME, mv.id);
function itemId(name) {
  if (items.has(name)) return items.get(name);
  // Scripts use ITEM_TM39 where the item list says ITEM_TM39_ROCK_TOMB.
  const prefixed = [...items.keys()].filter(k => k.startsWith(name + '_'));
  return prefixed.length === 1 ? items.get(prefixed[0]) : undefined;
}

// ---- Script parsing ---------------------------------------------------------------------------
// Instruction forms (JSON arrays), shared by both script syntaxes:
//   [op, ...args] for setflag, clearflag, setvar, addvar, subvar, copyvar, compare, goto, call,
//   return, end, giveitem, checkitem, gender, removeobject, unknown (sets VAR_RESULT to unknown),
//   skip (an effect the editor does not reproduce),
//   ['jumpif', cond, label, isCall], ['if', [[cond, body]...], elseBody],
//   ['switch', var, [[value, body]...], defaultBody, isAsm]
// Conditions: ['flag', name], ['not', c], ['and', a, b], ['or', a, b],
//   ['var', name, op, value], ['cmp', op] (asm compare), ['defeated', trainer].
const labels = new Map(); // name -> { body, next, map }
const OPS = { eq: '==', ne: '!=', lt: '<', gt: '>', le: '<=', ge: '>=' };
const IGNORED = new Set(
  (
    'msgbox message waitmessage closemessage delay playse waitse playbgm fadedefaultbgm savebgm ' +
    'fadeinbgm fadeoutbgm playfanfare waitfanfare applymovement waitmovement lock lockall release ' +
    'releaseall faceplayer turnobject textcolor waitbuttonpress fadescreen fadescreenspeed ' +
    'special_ waitstate setmetatile drawwholemapview pokenavcall bufferitemname bufferspeciesname ' +
    'buffernumberstring bufferstring buffermovename playmoncry waitmoncry showobjectat hideobjectat ' +
    'addobject trainerbattle_no_intro trainerbattle_single trainerbattle_double ' +
    'trainerbattle_double_no_intro setobjectmovementtype opendoor closedoor waitdooranim ' +
    'dofieldeffect waitfieldeffect setfieldeffectargument incrementgamestat nop nop1 ' +
    'callnative_ checkmoneyrepeat showmoneybox hidemoneybox updatemoneybox clearflag_ ' +
    'goto_if_questlog random_ setstepcallback copyobjectxytoperm erasemonpic ' +
    'showmonpic hidemonpic speakername'
  ).split(/\s+/),
);
const SKIPPED = new Set([
  'special',
  'specialvar',
  'warp',
  'warpsilent',
  'warpteleport',
  'setrespawn',
  'setobjectxyperm',
  'givemon',
  'setwarp',
  'setdynamicwarp',
  'callnative',
  'setescapewarp',
]);
const RESULT_SETTERS = new Set([
  'yesnobox',
  'multichoice',
  'multichoicedefault',
  'checkpartymove',
  'getpartysize',
  'random',
  'checkmoney',
  'checkcoins',
  'getplayerxy',
  'specialvar',
  'checkpcitem',
  'checkitemspace',
  'checkitemtype',
  'checkmonmodernfatefulencounter',
]);

function splitArgs(text) {
  const out = [];
  let depth = 0,
    cur = '';
  for (const ch of text) {
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
// One command (either syntax) to an instruction, or null when it has no effect worth keeping.
function command(name, args, ctx) {
  const a = args.map(x => x.trim());
  switch (name) {
    case 'setflag':
    case 'clearflag':
      return [name, a[0]];
    case 'setvar':
    case 'addvar':
    case 'subvar':
    case 'copyvar':
    case 'compare':
      return [name, a[0], a[1]];
    case 'compare_var_to_value':
      return ['compare', a[0], a[1]];
    case 'goto':
    case 'call':
      return [name, a[0]];
    case 'return':
    case 'end':
      return [name];
    case 'giveitem':
    case 'giveitem_std':
    case 'additem':
    case 'finditem':
      return ['giveitem', a[0]];
    case 'checkitem':
      return ['checkitem', a[0]];
    case 'checkplayergender':
      return ['gender'];
    case 'givecustommon':
      return ['gift', a];
    case 'removeobject': {
      const flag = ctx.objectFlag(a[0]);
      return ['removeobject', flag];
    }
    case 'switch':
      return ['switchasm', a[0]];
    case 'case':
      return ['case', a[0], a[1]];
  }
  let m = /^(goto|call)_if_(eq|ne|lt|gt|le|ge)$/.exec(name);
  if (m) {
    // Both "goto_if_eq VAR, value, label" and the older "compare VAR, value / goto_if_eq label".
    if (a.length >= 3) return ['jumpif', ['var', a[0], OPS[m[2]], a[1]], a[2], m[1] === 'call'];
    return ['jumpif', ['cmp', OPS[m[2]]], a[0], m[1] === 'call'];
  }
  m = /^(goto|call)_if_(set|unset)$/.exec(name);
  if (m) {
    const c = ['flag', a[0]];
    return ['jumpif', m[2] === 'set' ? c : ['not', c], a[1], m[1] === 'call'];
  }
  m = /^(goto|call)_if_(defeated|undefeated)$/.exec(name);
  if (m) {
    const c = ['defeated', a[0]];
    return ['jumpif', m[2] === 'defeated' ? c : ['not', c], a[1], m[1] === 'call'];
  }
  if (name === 'msgbox' && /MSGBOX_YESNO/.test(a[1] || '')) return ['unknown', 'msgbox yes/no'];
  if (RESULT_SETTERS.has(name)) return ['unknown', name];
  if (SKIPPED.has(name)) return ['skip', `${name} ${a.join(', ')}`.trim()];
  if (IGNORED.has(name) || name.startsWith('trainerbattle') || name.startsWith('buffer'))
    return null;
  return ['skip', `${name} ${a.join(', ')}`.trim()];
}

// Assembly: labels end with ":" or "::"; instructions follow, one per line.
function parseAsm(text, ctx) {
  let current = null;
  const order = [];
  for (let line of text.split('\n')) {
    line = line
      .replace(/@.*$/, '')
      .replace(/\/\/.*$/, '')
      .trim();
    if (!line || line.startsWith('.')) continue;
    const label = /^(\w+)::?(.*)$/.exec(line);
    if (label) {
      current = { body: [], next: null, map: ctx.map };
      if (order.length) labels.get(order[order.length - 1]).next ??= label[1];
      labels.set(label[1], current);
      order.push(label[1]);
      line = label[2].trim();
      if (!line) continue;
    }
    if (!current) continue;
    const m = /^(\w+)\s*(.*)$/.exec(line);
    if (!m) continue;
    const op = command(m[1], m[2] ? splitArgs(m[2]) : [], ctx);
    if (op) current.body.push(op);
    // Data directives and movement scripts end the instruction stream of a label.
  }
}

// Poryscript: script Name { statements } with if/elif/else, switch and calls.
function tokenize(text) {
  const tokens = [];
  const re =
    /\s+|\/\/[^\n]*|format\s*\("(?:[^"\\]|\\.)*"(?:\s*"(?:[^"\\]|\\.)*")*\s*(?:,\s*[^)]*)?\)|"(?:[^"\\]|\\.)*"|==|!=|<=|>=|&&|\|\||[A-Za-z_]\w*|0x[0-9A-Fa-f]+|\d+|[(){}\[\],:;!<>=+\-*\/.]/gy;
  let m;
  while ((m = re.exec(text))) {
    if (/^\s|^\/\//.test(m[0])) continue;
    tokens.push(/^format\s*\(|^"/.test(m[0]) ? '"str"' : m[0]);
  }
  return tokens;
}
function parsePory(name, body, ctx) {
  const t = tokenize(body);
  let i = 0;
  const peek = () => t[i],
    next = () => t[i++],
    expect = s => {
      if (t[i] !== s) throw new Error(`${name}: expected ${s}, got ${t[i]}`);
      i++;
    };
  function value() {
    // A value is an identifier or number, possibly a simple sum like VAR + 1.
    let v = next();
    while (peek() === '+' || peek() === '-') v += next() + next();
    return v;
  }
  function condPrimary() {
    if (peek() === '!') {
      next();
      return ['not', condPrimary()];
    }
    if (peek() === '(') {
      next();
      const c = cond();
      expect(')');
      return c;
    }
    const fn = next();
    expect('(');
    const arg = value();
    expect(')');
    if (fn === 'flag') return ['flag', arg];
    if (fn === 'defeated') return ['defeated', arg];
    if (fn === 'var') {
      if (['==', '!=', '<', '>', '<=', '>='].includes(peek())) {
        const op = next();
        return ['var', arg, op, value()];
      }
      return ['var', arg, '!=', '0'];
    }
    throw new Error(`${name}: unsupported condition ${fn}`);
  }
  function cond() {
    let c = condPrimary();
    while (peek() === '&&' || peek() === '||') {
      const op = next() === '&&' ? 'and' : 'or';
      c = [op, c, condPrimary()];
    }
    return c;
  }
  function block() {
    if (peek() !== '{') return [statement()].filter(Boolean);
    expect('{');
    const out = [];
    while (peek() !== '}') {
      if (peek() === undefined) throw new Error(`${name}: unterminated block`);
      const s = statement();
      if (s) out.push(s);
    }
    expect('}');
    return out;
  }
  function statement() {
    const word = next();
    if (word === ';') return null;
    if (word === 'if') {
      const branches = [];
      expect('(');
      let c = cond();
      expect(')');
      branches.push([c, block()]);
      let otherwise = [];
      while (peek() === 'elif' || peek() === 'else') {
        if (next() === 'elif') {
          expect('(');
          c = cond();
          expect(')');
          branches.push([c, block()]);
        } else {
          otherwise = block();
          break;
        }
      }
      return ['if', branches, otherwise];
    }
    if (word === 'switch') {
      expect('(');
      expect('var');
      expect('(');
      const v = value();
      expect(')');
      expect(')');
      expect('{');
      const cases = [];
      let fallback = [];
      while (peek() !== '}') {
        const kind = next();
        let val = null;
        if (kind === 'case') val = value();
        else if (kind !== 'default') throw new Error(`${name}: bad switch`);
        expect(':');
        const bodyOps = [];
        while (!['case', 'default', '}'].includes(peek())) {
          const s = statement();
          if (s) bodyOps.push(s);
        }
        if (kind === 'case') cases.push([val, bodyOps]);
        else fallback = bodyOps;
      }
      expect('}');
      return ['switch', v, cases, fallback, false];
    }
    if (word === 'while' || word === 'do' || word === 'for')
      throw new Error(`${name}: loops are not supported`);
    let args = [];
    if (peek() === '(') {
      next();
      let depth = 1,
        cur = [];
      while (depth) {
        const tok = next();
        if (tok === undefined) throw new Error(`${name}: unterminated call`);
        if (tok === '(') depth++;
        if (tok === ')' && --depth === 0) break;
        cur.push(tok);
      }
      args = splitArgs(cur.join(' ').replace(/\s*([(),])\s*/g, '$1'));
    }
    return command(word, args, ctx);
  }
  const ops = [];
  while (i < t.length) {
    const s = statement();
    if (s) ops.push(s);
  }
  // Like the Poryscript compiler, end a script that does not end itself.
  const last = ops[ops.length - 1];
  if (!last || !['end', 'return', 'goto'].includes(last[0])) ops.push(['end']);
  labels.set(name, { body: ops, next: null, map: ctx.map, pory: true });
}

// Each map: LOCALID constants and object hide flags (local id N is object N in map.json).
function mapContext(mapDir, text) {
  const ctx = { map: mapDir ? path.basename(mapDir) : null, locals: new Map(), objects: [] };
  for (const m of text.matchAll(/\.set\s+(LOCALID_\w+),\s*(\d+)/g)) ctx.locals.set(m[1], +m[2]);
  for (const m of text.matchAll(/const\s+(LOCALID_\w+)\s*=\s*(\d+)/g)) ctx.locals.set(m[1], +m[2]);
  if (mapDir && fs.existsSync(path.join(mapDir, 'map.json')))
    ctx.objects =
      JSON.parse(fs.readFileSync(path.join(mapDir, 'map.json'), 'utf8')).object_events || [];
  ctx.objectFlag = id => {
    const n = ctx.locals.has(id) ? ctx.locals.get(id) : /^\d+$/.test(id) ? +id : null;
    const flag = n && ctx.objects[n - 1]?.flag;
    return flag && flag !== '0' ? flag : null;
  };
  return ctx;
}
function parseFile(file, mapDir) {
  const text = fs.readFileSync(file, 'utf8');
  const ctx = mapContext(mapDir, text);
  if (!file.endsWith('.pory')) return parseAsm(text, ctx);
  // raw `...` sections are assembly; script Name { ... } blocks are Poryscript.
  for (const m of text.matchAll(/raw\s*`([\s\S]*?)`/g)) parseAsm(m[1], ctx);
  const outside = text.replace(/raw\s*`[\s\S]*?`/g, '');
  const re = /\bscript\s+(\w+)\s*\{/g;
  let m;
  while ((m = re.exec(outside))) {
    let depth = 1,
      j = re.lastIndex;
    for (; j < outside.length && depth; j++) {
      if (outside[j] === '{') depth++;
      else if (outside[j] === '}') depth--;
      else if (outside[j] === '"')
        while (outside[++j] !== '"' && j < outside.length) if (outside[j] === '\\') j++;
    }
    try {
      parsePory(m[1], outside.slice(re.lastIndex, j - 1), ctx);
    } catch (error) {
      // Kept as unreadable: replaying it stops instead of guessing.
      labels.set(m[1], { body: [['unreadable', error.message]], next: null, map: ctx.map });
    }
    re.lastIndex = j;
  }
}
const mapsDir = path.join(sourceDir, 'data/maps');
for (const dir of fs.readdirSync(mapsDir)) {
  const full = path.join(mapsDir, dir);
  for (const f of ['scripts.pory', 'scripts.inc'])
    if (fs.existsSync(path.join(full, f))) parseFile(path.join(full, f), full);
}
for (const f of fs.readdirSync(path.join(sourceDir, 'data/scripts')))
  if (/\.(inc|pory)$/.test(f)) parseFile(path.join(sourceDir, 'data/scripts', f), null);
parseFile(path.join(sourceDir, 'data/event_scripts.s'), null);

// ---- Milestones -------------------------------------------------------------------------------
const GYMS = [
  [
    'Stone Badge',
    'Roxanne',
    'Rustboro City',
    'RustboroCity_Gym_EventScript_RoxanneDefeatedFirstTime',
  ],
  [
    'Knuckle Badge',
    'Brawly',
    'Dewford Town',
    'DewfordTown_Gym_EventScript_BrawlyDefeatedFirstTime',
  ],
  [
    'Dynamo Badge',
    'Wattson',
    'Mauville City',
    'MauvilleCity_Gym_EventScript_WattsonDefeatedFirstTime',
  ],
  [
    'Heat Badge',
    'Flannery',
    'Lavaridge Town',
    'LavaridgeTown_Gym_1F_EventScript_FlanneryDefeatedFirstTime',
  ],
  [
    'Balance Badge',
    'Norman',
    'Petalburg City',
    'PetalburgCity_Gym_EventScript_NormanAfterBattleFirstTime',
  ],
  [
    'Feather Badge',
    'Winona',
    'Fortree City',
    'FortreeCity_Gym_EventScript_WinonaDefeatedFirstTime',
  ],
  [
    'Mind Badge',
    'Tate & Liza',
    'Mossdeep City',
    'MossdeepCity_Gym_EventScript_TateAndLizaDefeatedFirstTime',
  ],
  ['Rain Badge', 'Juan', 'Sootopolis City', 'SootopolisCity_Gym_1F_EventScript_Juan_Defeated'],
];
const CHAMPION_ENTRY = 'EverGrandeCity_HallOfFame_EventScript_SetGameClearFlags';
const entries = [...GYMS.map(g => g[3]), CHAMPION_ENTRY];

// Keep only labels reachable from the milestones, and resolve every name they use.
const keep = new Map(),
  queue = [...entries],
  problems = [];
const visit = ops => {
  for (const op of ops) {
    if (['goto', 'call'].includes(op[0])) queue.push(op[1]);
    if (
      ['goto', 'call', 'jumpif', 'case'].includes(op[0]) &&
      op[op[0] === 'goto' || op[0] === 'call' ? 1 : 2] === undefined
    )
      problems.push(`no target in ${JSON.stringify(op)}`);
    if (op[0] === 'jumpif') queue.push(op[2]);
    if (op[0] === 'case') queue.push(op[2]);
    if (op[0] === 'if') {
      op[1].forEach(([, b]) => visit(b));
      visit(op[2]);
    }
    if (op[0] === 'switch') {
      op[2].forEach(([, b]) => visit(b));
      visit(op[3]);
    }
  }
};
while (queue.length) {
  const name = queue.shift();
  if (keep.has(name)) continue;
  const entry = labels.get(name);
  if (!entry) {
    problems.push(`missing script ${name}`);
    keep.set(name, { body: [['unreadable', `missing script ${name}`]], next: null });
    continue;
  }
  keep.set(name, entry);
  visit(entry.body);
  // Assembly falls through to the next label unless the label ends with end/return/goto.
  const last = entry.body[entry.body.length - 1];
  entry.fallsThrough = !entry.pory && !(last && ['end', 'return', 'goto'].includes(last[0]));
  if (entry.next && entry.fallsThrough) queue.push(entry.next);
}
// Resolve names to numbers so the editor needs no tables for replay.
const usedFlags = new Set(),
  usedVars = new Set();
function resolveValue(v) {
  if (v === undefined) return v;
  if (/^0x[0-9a-f]+$/i.test(v)) return parseInt(v, 16);
  if (/^-?\d+$/.test(v)) return +v;
  const consts = { TRUE: 1, FALSE: 0, MALE: 0, FEMALE: 1, YES: 1, NO: 0, ITEM_NONE: 0 };
  if (v in consts) return consts[v];
  if (v in vars) {
    usedVars.add(v);
    return { var: vars[v] };
  }
  const n = varValue(v) ?? flagValue(v) ?? trainerValue(v);
  if (n === undefined) problems.push(`unknown value ${v}`);
  return n ?? null;
}
const resolveVar = v => {
  if (/^VAR_0x8\w+$/.test(v) || /^VAR_(RESULT|SPECIAL|TEMP)/.test(v) || varValue(v) >= 0x8000)
    return { temp: v };
  if (!(v in vars)) problems.push(`unknown variable ${v}`);
  usedVars.add(v);
  return vars[v] ?? null;
};
const resolveFlag = f => {
  if (/^FLAG_TEMP_/.test(f)) return null;
  const id = flags[f] ?? flagValue(f);
  if (!Number.isInteger(id)) problems.push(`unknown flag ${f}`);
  usedFlags.add(f);
  return id ?? null;
};
function resolveCond(c) {
  switch (c[0]) {
    case 'flag':
      return ['flag', resolveFlag(c[1])];
    case 'not':
      return ['not', resolveCond(c[1])];
    case 'and':
    case 'or':
      return [c[0], resolveCond(c[1]), resolveCond(c[2])];
    case 'var':
      return ['var', resolveVar(c[1]), c[2], resolveValue(c[3])];
    case 'cmp':
      return c;
    case 'defeated': {
      const id = trainerValue(c[1]);
      if (!Number.isInteger(id)) problems.push(`unknown trainer ${c[1]}`);
      return ['flag', TRAINER_FLAGS_START + (id ?? 0)];
    }
  }
  throw new Error(`Unknown condition ${c[0]}`);
}
function resolveOps(ops) {
  return ops
    .map(op => {
      switch (op[0]) {
        case 'setflag':
        case 'clearflag':
          return [op[0], resolveFlag(op[1])];
        case 'removeobject':
          return op[1] ? ['setflag', resolveFlag(op[1])] : null;
        case 'setvar':
        case 'addvar':
        case 'subvar':
        case 'compare':
          return [op[0], resolveVar(op[1]), resolveValue(op[2])];
        case 'copyvar':
          return ['setvar', resolveVar(op[1]), resolveValue(op[2])];
        case 'giveitem':
        case 'checkitem': {
          const id = itemId(op[1]);
          if (id === undefined) problems.push(`unknown item ${op[1]}`);
          return [op[0], id ?? null, op[1]];
        }
        case 'jumpif':
          return ['jumpif', resolveCond(op[1]), op[2], op[3]];
        case 'gift': {
          // givecustommon species, level, item, ball, nature, abilityNum, 6 EVs, 6 IVs, 4 moves,
          // isShiny (the IVs are ignored: Elite Redux keeps every IV at 31).
          const a = op[1];
          const num = (v, blank) => (v === undefined || v === '' ? blank : resolveValue(v));
          const species = speciesIds.get(a[0]);
          if (species === undefined) problems.push(`unknown species ${a[0]}`);
          const move = name => (!name || name === 'MOVE_NONE' ? 0 : moveIds.get(name));
          const gift = {
            species: species ?? null,
            name: a[0],
            level: num(a[1], 0),
            item: a[2] && a[2] !== 'ITEM_NONE' ? (itemId(a[2]) ?? 0) : 0,
            ball: a[3] ? (itemId(a[3]) ?? 0) : 0,
            nature: a[4] ? num(a[4], 25) : 25,
            abilityNum: a[5] ? num(a[5], 3) : 3,
            evs: [6, 7, 8, 9, 10, 11].map(i => (a[i] ? num(a[i], 255) : 255)),
            moves: [18, 19, 20, 21].map(i => move(a[i]) ?? 0),
            shiny: a[22] === 'TRUE' ? 1 : 0,
          };
          for (const [i, name] of [18, 19, 20, 21].map(i => [i, a[i]]))
            if (name && name !== 'MOVE_NONE' && moveIds.get(name) === undefined)
              problems.push(`unknown move ${name} (argument ${i})`);
          return ['gift', gift];
        }
        case 'switchasm':
          return ['switchasm', resolveVar(op[1])];
        case 'case':
          return ['case', resolveValue(op[1]), op[2]];
        case 'if':
          return ['if', op[1].map(([c, b]) => [resolveCond(c), resolveOps(b)]), resolveOps(op[2])];
        case 'switch':
          return [
            'switch',
            resolveVar(op[1]),
            op[2].map(([v, b]) => [resolveValue(v), resolveOps(b)]),
            resolveOps(op[3]),
          ];
        default:
          return op;
      }
    })
    .filter(Boolean);
}
// Brawly's script runs "call_if_eq Common_EventScript_ReadyPetalburgGymForBattle" with no
// compare before it, so in the game the outcome depends on whatever was compared last. That
// script only re-reads your badges to set up Norman's gym, so the editor always runs it, as
// every other gym does.
const ALWAYS_CALL = {
  DewfordTown_Gym_EventScript_BrawlyDefeatedFirstTime:
    'Common_EventScript_ReadyPetalburgGymForBattle',
};
for (const [label, target] of Object.entries(ALWAYS_CALL)) {
  const entry = keep.get(label);
  if (!entry) continue;
  entry.body = entry.body.map(op =>
    op[0] === 'jumpif' && op[1][0] === 'cmp' && op[2] === target && op[3] ? ['call', target] : op,
  );
}
const scripts = {};
for (const [name, entry] of keep)
  scripts[name] = { body: resolveOps(entry.body), next: entry.fallsThrough ? entry.next : null };

let commit = '';
try {
  commit = fs.readFileSync(path.join(sourceDir, '.git/HEAD'), 'utf8').trim();
  if (commit.startsWith('ref:'))
    commit = fs.readFileSync(path.join(sourceDir, '.git', commit.slice(5)), 'utf8').trim();
} catch {}
const out = {
  source: commit.slice(0, 12),
  flagsCount: FLAGS_COUNT,
  trainerFlags: [TRAINER_FLAGS_START, SYSTEM_FLAGS - 1],
  varsStart: VARS_START,
  flags,
  vars,
  varNotes,
  gyms: GYMS.map(([badge, leader, city, entry], i) => ({
    badge,
    leader,
    city,
    entry,
    badgeFlag: flags[`FLAG_BADGE0${i + 1}_GET`],
    gymFlag:
      flags[
        `FLAG_DEFEATED_${['RUSTBORO', 'DEWFORD', 'MAUVILLE', 'LAVARIDGE', 'PETALBURG', 'FORTREE', 'MOSSDEEP', 'SOOTOPOLIS'][i]}_GYM`
      ],
  })),
  champion: {
    entry: CHAMPION_ENTRY,
    gameClear: flags.FLAG_SYS_GAME_CLEAR,
    isChampion: flags.FLAG_IS_CHAMPION,
    // Set by the Champion's room just before the Hall of Fame.
    before: [['setflag', flags.FLAG_HIDE_PETALBURG_GYM_GREETER]],
  },
  scripts,
};
const file = path.join(__dirname, '../src/story.json');
fs.writeFileSync(file, JSON.stringify(out));
console.log(
  `Story data: ${Object.keys(flags).length} flags, ${Object.keys(vars).length} variables, ${keep.size} scripts (${Math.round(fs.statSync(file).size / 1024)} KB).`,
);
if (problems.length) {
  console.log(`${problems.length} unresolved references (replay stops if it reaches them):`);
  for (const p of [...new Set(problems)].slice(0, 40)) console.log('  ' + p);
}
