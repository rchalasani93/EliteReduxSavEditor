// Builds a Redux Save Studio catalog (or a catalog patch) straight from an Elite Redux ROM.
//
//   node scripts/rom.cjs <rom.gba> <version-label> <output.json> [--patch] [--from <version>]
//                        [--report <report.json>]
//
// Every table is located by content, not by a fixed address, so a new build whose tables
// have moved still works. The previous version's data (--from, default the newest bundled
// version) is used to recognise tables: a candidate layout is accepted only when most of the
// known entries read back the same, and the counts are printed so a bad match is obvious.
//
// Read from the ROM: species names, base stats, types, abilities, innates, gender ratio,
// Pokédex numbers, level-up and TM/tutor learnsets, evolutions and Mega/Primal forms; move
// names, power, type(s), accuracy, PP, effect chance, priority, category, effect, target,
// short descriptions and the flags the game stores as bits; ability names, descriptions and
// the randomizer ban bit; item names, descriptions and pockets; nature names.
//
// Not in the ROM, so carried over from the previous version for IDs it already had: species
// constant names (SPECIES_*) and form suffixes ("Charizard Mega X" is stored as "Charizard"),
// long move descriptions, and move flags the game checks in code (sound, kick, dance, …).
// Effect and target labels are matched by the game's own effect and target numbers.
//
// The ROM is only read. Nothing from it is written except the extracted data, and ROM files
// are ignored by git (*.gba), so a ROM never ends up in the repository or on the site.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const core = require('../src/core.js');

const ROM_MAX = 32 * 1024 * 1024;
const GBA = 0x08000000;

// ---- Text --------------------------------------------------------------------------------------
// The editor's character map plus the few extra symbols used in descriptions.
// 0x53 0x54 are the two halves of the "PKMN" glyph.
const EXTRA_CHARS = { 0xf0: ':', 0x53: '\u0001PK', 0x54: 'MN' };
function decodeText(rom, offset, max = 600) {
  let s = '';
  for (let i = offset; i < Math.min(rom.length, offset + max); i++) {
    const b = rom[i];
    if (b === 0xff) break;
    // 0xFE is a line break, 0xFA/0xFB scroll or wait for a button: all become spaces.
    if (b === 0xfe || b === 0xfa || b === 0xfb) s += ' ';
    else s += EXTRA_CHARS[b] ?? core.decode([b]);
  }
  return (
    s
      // A hyphen at a line break stays and joins the words ("Fire-type"); the one word the game
      // splits mid-syllable is "Poké-mon".
      .replace(/(\S)-\s+/g, '$1-')
      .replace(/Poké-mon/g, 'Pokémon')
      .replace(/\u0001PKMN/g, 'Pokémon')
      .replace(/\u0001PK/g, 'PK')
      .replace(/\s+/g, ' ')
      .trim()
  );
}
function encodeText(text) {
  const inverse = new Map();
  for (let b = 0; b < 255; b++) {
    const c = EXTRA_CHARS[b] ?? core.decode([b]);
    if (c && c !== '�' && !inverse.has(c)) inverse.set(c, b);
  }
  return Buffer.from(
    [...text].map(c => {
      if (!inverse.has(c)) throw new Error(`Cannot encode “${c}” as game text.`);
      return inverse.get(c);
    }),
  );
}

// ---- ROM access ----------------------------------------------------------------------------------
function readRom(file) {
  const rom = fs.readFileSync(file);
  if (rom.length < 1024 * 1024 || rom.length > ROM_MAX)
    throw new Error('Expected a GBA ROM between 1 MB and 32 MB.');
  if (rom.subarray(0xac, 0xb0).toString('latin1') !== 'BPEE')
    throw new Error(
      'This is not an Emerald-based ROM (game code BPEE); Elite Redux is built on Emerald.',
    );
  return rom;
}
function reader(rom) {
  const inRom = (o, n = 1) => Number.isInteger(o) && o >= 0 && o + n <= rom.length;
  const u8 = o => (inRom(o) ? rom[o] : null);
  const u16 = o => (inRom(o, 2) ? rom.readUInt16LE(o) : null);
  // A pointer into the ROM, as a file offset; null for anything else.
  const ptr = o => {
    if (!inRom(o, 4)) return null;
    const v = rom.readUInt32LE(o);
    return v >= GBA && v < GBA + rom.length ? v - GBA : null;
  };
  const text = (o, max) => (inRom(o) ? decodeText(rom, o, max) : '');
  const findAll = (needle, limit = 200, from = 0) => {
    const out = [];
    for (
      let i = rom.indexOf(needle, from);
      i >= 0 && out.length < limit;
      i = rom.indexOf(needle, i + 1)
    )
      out.push(i);
    return out;
  };
  // Every ROM offset that holds a pointer to `target` (4-byte aligned, as the compiler emits).
  let pointerIndex = null;
  const pointersTo = target => {
    if (!pointerIndex) {
      pointerIndex = new Map();
      for (let o = 0; o + 4 <= rom.length; o += 4) {
        const t = ptr(o);
        if (t === null) continue;
        const list = pointerIndex.get(t);
        if (list) list.push(o);
        else pointerIndex.set(t, [o]);
      }
    }
    return pointerIndex.get(target) || [];
  };
  return { rom, u8, u16, ptr, text, findAll, pointersTo };
}

// Pick the candidate whose check scores best; refuse when even the best is a poor match.
function best(name, candidates, score, needed) {
  let top = null;
  for (const c of candidates) {
    const s = score(c);
    if (!top || s > top.score) top = { value: c, score: s };
  }
  if (!top || top.score < needed)
    throw new Error(
      `Could not find the ${name} table (best match ${top ? top.score : 0}, need ${needed}).`,
    );
  return top;
}

// ---- Locating tables ---------------------------------------------------------------------------
// Layouts below were worked out on Elite Redux 2.65.5.2b and checked against every entry of the
// data the editor already had; `locate` only has to find where each table starts.
const SPECIES_SIZE = 44,
  MOVE_SIZE = 24,
  ABILITY_SIZE = 196,
  ITEM_SIZE = 40,
  MOVE_NAME_SIZE = 19,
  EVO_SIZE = 8,
  TEACHABLE_BYTES = 32;
// Base stats are stored HP, Atk, Def, Spe, SpA, SpD; the editor uses HP, Atk, Def, SpA, SpD, Spe.
const STAT_ORDER = [0, 1, 2, 4, 5, 3];

function locate(r, prev) {
  const { rom, u8, u16, ptr, text, findAll, pointersTo } = r;
  const species = Object.values(prev.species).filter(s => s.id > 0);
  const moves = Object.values(prev.moves).filter(m => m.id > 0);
  const sample = (list, n) =>
    list.filter((_, i) => i % Math.max(1, Math.floor(list.length / n)) === 0);
  const nameAt = (table, id) => {
    const p = ptr(table + id * 4);
    return p === null ? null : text(p, 40);
  };
  const t = {};

  // Species names: a pointer per species ID to a packed name. Found from the first species' name.
  {
    const first = species[0];
    const hits = findAll(Buffer.concat([encodeText(first.name), Buffer.from([0xff])]));
    const tables = hits.flatMap(h => pointersTo(h).map(p => p - first.id * 4));
    const check = sample(species, 200);
    t.speciesNames = best(
      'species name',
      tables,
      table =>
        check.filter(sp => {
          const n = nameAt(table, sp.id);
          return !!n && sp.name.startsWith(n);
        }).length,
      check.length * 0.8,
    ).value;
  }

  // Species records: found from the first species' base stats and types.
  {
    const s = species[0];
    const stats = STAT_ORDER.map((_, i) => s.base[STAT_ORDER.indexOf(i)]);
    const hits = findAll(Buffer.from([...stats, ...s.types.slice(0, 2)]));
    const check = sample(species, 300);
    const score = table =>
      check.filter(sp =>
        STAT_ORDER.every(
          (romIndex, i) => u8(table + sp.id * SPECIES_SIZE + romIndex) === sp.base[i],
        ),
      ).length;
    t.species = best(
      'species',
      hits.map(h => h - s.id * SPECIES_SIZE),
      score,
      check.length * 0.8,
    ).value;
  }

  // Pokédex numbers: one u16 per species, starting at species 1.
  {
    // Anchor on two neighbouring species whose numbers differ from their IDs, if any.
    const anchor =
      species.find(s => s.dex && s.dex !== s.id && prev.species[s.id + 1]?.dex) ||
      species.find(s => s.dex && prev.species[s.id + 1]?.dex);
    const b = Buffer.alloc(4);
    b.writeUInt16LE(anchor.dex);
    b.writeUInt16LE(prev.species[anchor.id + 1].dex, 2);
    const check = sample(
      species.filter(s => s.dex),
      300,
    );
    const candidates = findAll(b, 100000).map(h => h - (anchor.id - 1) * 2);
    t.dex = best(
      'Pokédex number',
      candidates,
      table => check.filter(sp => u16(table + (sp.id - 1) * 2) === sp.dex).length,
      check.length * 0.9,
    ).value;
  }

  // Moves: 24-byte records located by their power values.
  {
    const first = moves.slice(0, 12);
    const candidates = [];
    for (let x = 0; x + MOVE_SIZE * 12 < rom.length; x++) {
      if (rom[x] !== first[0].power) continue;
      if (first.every((m, k) => rom[x + (m.id - first[0].id) * MOVE_SIZE] === m.power))
        candidates.push(x - MOVE_POWER - first[0].id * MOVE_SIZE);
    }
    const check = sample(moves, 300);
    t.moves = best(
      'move',
      candidates,
      table =>
        check.filter(
          m =>
            u8(table + m.id * MOVE_SIZE + MOVE_POWER) === m.power &&
            u8(table + m.id * MOVE_SIZE + MOVE_POWER + 4) === m.pp,
        ).length,
      check.length * 0.8,
    ).value;
  }

  // Move names: fixed 19-byte entries (the full names; a 13-byte table holds shortened ones).
  {
    const m = moves[0],
      next = moves[1];
    const hits = findAll(Buffer.concat([encodeText(m.name), Buffer.from([0xff])]));
    const check = sample(moves, 200);
    t.moveNames = best(
      'move name',
      hits
        .map(h => h - m.id * MOVE_NAME_SIZE)
        .filter(tb => text(tb + next.id * MOVE_NAME_SIZE, MOVE_NAME_SIZE) === next.name),
      table =>
        check.filter(mv => text(table + mv.id * MOVE_NAME_SIZE, MOVE_NAME_SIZE) === mv.name).length,
      check.length * 0.8,
    ).value;
  }

  // Short move descriptions: a pointer per move, starting at move 1.
  {
    const m = moves.find(mv => mv.description);
    const hits = findAll(encodeText(m.description.slice(0, 20)));
    const check = sample(
      moves.filter(mv => mv.description),
      200,
    );
    const tables = hits.flatMap(h => pointersTo(h).map(p => p - (m.id - 1) * 4));
    t.moveDescriptions = best(
      'move description',
      tables,
      table =>
        check.filter(mv => {
          const p = ptr(table + (mv.id - 1) * 4);
          return p !== null && decodeText(rom, p) === mv.description;
        }).length,
      check.length * 0.8,
    ).value;
  }

  // Abilities: 196-byte records, each starting with a pointer to its name.
  {
    const list = Object.values(prev.abilities).filter(a => a.id > 0);
    const a = list[0];
    const hits = findAll(Buffer.concat([encodeText(a.name), Buffer.from([0xff])]));
    const check = sample(list, 200);
    const tables = hits.flatMap(h => pointersTo(h).map(p => p - a.id * ABILITY_SIZE));
    t.abilities = best(
      'ability',
      tables,
      table =>
        check.filter(ab => {
          const p = ptr(table + ab.id * ABILITY_SIZE);
          return p !== null && text(p, 40) === ab.name;
        }).length,
      check.length * 0.8,
    ).value;
  }

  // Items: 40-byte records with a name pointer and the item's own ID.
  {
    const list = Object.values(prev.items).filter(i => i.id > 0);
    const it = list[0];
    const hits = findAll(Buffer.concat([encodeText(it.name), Buffer.from([0xff])]));
    const check = sample(list, 200);
    const tables = hits.flatMap(h => pointersTo(h).map(p => p - it.id * ITEM_SIZE));
    t.items = best(
      'item',
      tables,
      table =>
        check.filter(i => {
          const p = ptr(table + i.id * ITEM_SIZE);
          return p !== null && u16(table + i.id * ITEM_SIZE + 4) === i.id && text(p, 40) === i.name;
        }).length,
      check.length * 0.8,
    ).value;
  }

  // Natures: a pointer per nature, found from the first nature's name.
  {
    const hits = findAll(Buffer.concat([encodeText(prev.natures[0]), Buffer.from([0xff])]));
    const tables = hits.flatMap(h => pointersTo(h));
    t.natures = best(
      'nature name',
      tables,
      table =>
        prev.natures.filter((n, i) => {
          const p = ptr(table + i * 4);
          return p !== null && text(p, 20) === n;
        }).length,
      prev.natures.length * 0.8,
    ).value;
  }

  // Level-up learnsets: a pointer per species to (move, level) pairs ending in move 0.
  // The editor's learnsets list level-up moves first, in game order.
  {
    const s = species.find(sp => sp.learnset.length >= 4);
    const b = Buffer.alloc(16);
    s.learnset.slice(0, 4).forEach((m, k) => b.writeUInt16LE(m, k * 4));
    const mask = [0, 1, 4, 5, 8, 9, 12, 13];
    const hits = [];
    for (let x = rom.indexOf(b.subarray(0, 2)); x >= 0; x = rom.indexOf(b.subarray(0, 2), x + 1))
      if (mask.every(i => rom[x + i] === b[i])) hits.push(x);
    const check = sample(species, 200);
    const tables = hits.flatMap(h => pointersTo(h).map(p => p - s.id * 4));
    t.levelUp = best(
      'level-up learnset',
      tables,
      table =>
        check.filter(sp => {
          const moves = readLevelUp(r, table, sp.id);
          const known = new Set(sp.learnset);
          return moves && moves.length && moves.every(m => known.has(m));
        }).length,
      check.length * 0.8,
    ).value;
  }

  // TM/tutor moves: one list of move IDs (sorted by name) and, per species, a pointer to a
  // bit field over that list.
  {
    const known = new Set(moves.map(m => m.id));
    let list = null;
    for (let x = 0; x + 400 < rom.length && !list; x += 2) {
      let n = 0;
      const seen = new Set();
      for (;;) {
        const v = u16(x + n * 2);
        if (!known.has(v) || seen.has(v)) break;
        seen.add(v);
        n++;
      }
      if (n >= 100 && u16(x + n * 2) === 0) {
        const names = Array.from({ length: n }, (_, k) => prev.moves[u16(x + k * 2)].name);
        // Sorted by name, give or take punctuation ("Power-Up Punch", "U-turn").
        const ordered = names.filter((nm, k) => !k || names[k - 1].localeCompare(nm) <= 0).length;
        if (ordered >= n * 0.95) list = { at: x, length: n };
      }
      if (n > 1) x += (n - 1) * 2;
    }
    if (!list) throw new Error('Could not find the TM/tutor move list.');
    t.teachableList = list;
    const order = Array.from({ length: list.length }, (_, k) => u16(list.at + k * 2));
    // Find the first species' bit field: the bits it sets must be (almost) all moves it learns.
    const s = species.find(sp => sp.learnset.length >= 10);
    const wanted = Buffer.alloc(TEACHABLE_BYTES);
    const learns = new Set(s.learnset);
    order.forEach((m, k) => learns.has(m) && (wanted[k >> 3] |= 1 << (k & 7)));
    const bits = x => {
      let n = 0;
      while (x) {
        n += x & 1;
        x >>= 1;
      }
      return n;
    };
    const total = [...wanted].reduce((n, b) => n + bits(b), 0);
    const fields = [];
    for (let x = 0; x + TEACHABLE_BYTES <= rom.length; x += 4) {
      let extra = 0,
        good = 0;
      for (let i = 0; i < TEACHABLE_BYTES && extra <= 4; i++) {
        extra += bits(rom[x + i] & ~wanted[i]);
        good += bits(rom[x + i] & wanted[i]);
      }
      if (extra <= 4 && good >= total * 0.8) fields.push(x);
    }
    const check = sample(species, 150);
    const tables = fields.flatMap(f => pointersTo(f).map(p => p - s.id * 4));
    t.teachable = best(
      'TM/tutor learnset',
      tables,
      table =>
        check.filter(sp => {
          const moves = readTeachable(r, table, order, sp.id);
          const knownMoves = new Set(sp.learnset);
          return moves && moves.filter(m => !knownMoves.has(m)).length <= 4;
        }).length,
      check.length * 0.8,
    ).value;
  }

  // Evolutions and form changes: two pointer tables to 8-byte (method, parameter, target)
  // entries ending in method 0. Located from a species with a known evolution or Mega form.
  for (const [key, field] of [
    ['evolutions', 'evolves'],
    ['forms', 'forms'],
  ]) {
    const s = species.find(sp => sp[field] && sp[field].length);
    const target = s[field][0];
    const hits = [];
    for (let x = 0; x + EVO_SIZE <= rom.length; x += 2)
      if (
        rom.readUInt16LE(x + 4) === target &&
        rom.readUInt16LE(x + 6) === 0 &&
        rom.readUInt16LE(x) &&
        pointersTo(x).length
      )
        hits.push(x);
    const check = sample(
      species.filter(sp => sp[field] && sp[field].length),
      150,
    );
    const tables = hits.flatMap(h => pointersTo(h).map(p => p - s.id * 4));
    t[key] = best(
      key === 'evolutions' ? 'evolution' : 'form change',
      tables,
      table =>
        check.filter(sp => {
          const list = readEvolutions(r, table, sp.id);
          return list && sp[field].every(id => list.some(e => e.target === id));
        }).length,
      check.length * 0.8,
    ).value;
  }
  return t;
}
const MOVE_POWER = 6;

// ---- Reading entries -----------------------------------------------------------------------------
function readLevelUp(r, table, id) {
  const p = r.ptr(table + id * 4);
  if (p === null) return null;
  const out = [];
  for (let k = 0; k < 256; k++) {
    const move = r.u16(p + k * 4);
    if (!move || move === 0xffff) return out;
    out.push(move);
  }
  return out;
}
function readTeachable(r, table, order, id) {
  const p = r.ptr(table + id * 4);
  if (p === null) return null;
  return order.filter((_, k) => (r.u8(p + (k >> 3)) >> (k & 7)) & 1);
}
function readEvolutions(r, table, id) {
  const p = r.ptr(table + id * 4);
  if (p === null) return null;
  const out = [];
  for (let k = 0; k < 64; k++) {
    const method = r.u16(p + k * EVO_SIZE);
    if (!method) return out;
    out.push({ method, param: r.u16(p + k * EVO_SIZE + 2), target: r.u16(p + k * EVO_SIZE + 4) });
  }
  return out;
}

// Evolution methods (Elite Redux numbering, checked against every species of 2.65.5.2b).
const LEVEL_EVOLUTIONS = new Set([4, 16, 17]); // level, level (male), level (female)
const MEGA_FORMS = new Set([102, 103, 104]); // Mega Evolution, Ultra Burst, Primal Reversion
// Move flags the game stores as bits in the move record: [byte offset, bit, label].
const MOVE_FLAG_BITS = [
  [16, 2, 'Makes Contact'],
  [14, 2, 'Arrow Based'],
  [14, 3, 'Horn Based'],
  [14, 4, 'Air/Wing Based'],
  [14, 5, 'Always Crits'],
  [14, 6, 'Hammer Based'],
  [14, 7, 'Throw Based'],
  [15, 5, 'Lunar Move'],
  [16, 3, 'Drill Based'],
  [16, 4, 'Light Based'],
];
// Categories beyond physical/special/status, also stored as bits: [byte, bit, category].
const MOVE_CATEGORY_BITS = [
  [15, 1, 3], // uses the higher attacking stat
  [15, 3, 4], // hits Defense
  [15, 2, 6], // hits Special Defense
];

// ---- Building the catalog ------------------------------------------------------------------------
// Same members in any order: keeps the previous order so unchanged entries stay out of patches.
const sameSet = (a, b) =>
  !!a && a.length === b.length && JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
function extract(rom, prev, version) {
  const r = reader(rom);
  const t = locate(r, prev);
  const { u8, u16, ptr, text } = r;
  const order = Array.from({ length: t.teachableList.length }, (_, k) =>
    u16(t.teachableList.at + k * 2),
  );

  // Abilities: every record up to the first one without a name pointer.
  // The table ends where entries start repeating earlier names (2.65.5.2b mirrors its last
  // entries after ability 1083), or at the first entry without a readable name.
  const abilities = {},
    banned = [0],
    namePointers = new Set();
  for (let id = 0; id < 4096; id++) {
    const o = t.abilities + id * ABILITY_SIZE,
      p = ptr(o);
    if (p === null || namePointers.has(p) || (id && !/^[\x20-\x7e -ɏ]+$/.test(text(p, 40)))) break;
    namePointers.add(p);
    const desc = ptr(o + 4);
    abilities[id] = {
      name: id ? text(p, 40) : prev.abilities[0]?.name || '-------',
      desc: desc === null ? '' : text(desc),
      id,
    };
    if (id && (u8(o + 189) >> 6) & 1) banned.push(id);
  }
  const modulus = Object.keys(abilities).length - 1;

  // Species: every ID with a name pointer and a species record.
  const species = {},
    nameCounts = new Map(),
    romNames = new Map();
  for (let id = 1; id < 8192; id++) {
    const p = ptr(t.speciesNames + id * 4);
    if (p === null) continue;
    const n = text(p, 40);
    romNames.set(n, (romNames.get(n) || 0) + 1);
  }
  // A plausible species record: known types, and abilities and innates that exist.
  const plausible = o =>
    [6, 7].every(k => u8(o + k) < prev.types.length) &&
    [24, 26, 28, 34, 36, 38].every(k => u16(o + k) <= modulus) &&
    [0, 1, 2, 3, 4, 5].some(k => u8(o + k));
  for (let id = 1, misses = 0; id < 8192 && misses < 512; id++) {
    const p = ptr(t.speciesNames + id * 4);
    if (
      p === null ||
      t.species + id * SPECIES_SIZE + SPECIES_SIZE > rom.length ||
      !plausible(t.species + id * SPECIES_SIZE)
    ) {
      misses++;
      continue;
    }
    misses = 0;
    const romName = text(p, 40);
    if (!romName || /[^\x20-\x7e -ɏ‘-”♂♀…]/.test(romName)) continue;
    const o = t.species + id * SPECIES_SIZE;
    const known = prev.species[id];
    // Forms keep their name from the previous data ("Charizard Mega X", "Dusk Mane"): the ROM
    // stores only the base name, so a ROM name shared by several species is not a real name.
    const name =
      known && (known.name.startsWith(romName) || romNames.get(romName) > 1) ? known.name : romName;
    nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
    const levelUp = readLevelUp(r, t.levelUp, id) || [];
    const teach = readTeachable(r, t.teachable, order, id) || [];
    const evolutions = readEvolutions(r, t.evolutions, id) || [];
    const forms = readEvolutions(r, t.forms, id) || [];
    species[id] = {
      id,
      name,
      key:
        known?.key ||
        `SPECIES_${name
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, '_')
          .replace(/^_|_$/g, '')}`,
      base: STAT_ORDER.map(i => u8(o + i)),
      types: [u8(o + 6), u8(o + 7)],
      abilities: [24, 26, 28].map(k => u16(o + k)),
      innates: [34, 36, 38].map(k => u16(o + k)),
      gender: u8(o + 18),
      dex: u16(t.dex + (id - 1) * 2) || 0,
      learnset: [...new Set([...levelUp, ...teach])],
      forms: forms.filter(e => MEGA_FORMS.has(e.method)).map(e => e.target),
      evolves: [
        ...new Set(evolutions.filter(e => LEVEL_EVOLUTIONS.has(e.method)).map(e => e.target)),
      ],
    };
    if (!species[id].evolves.length) delete species[id].evolves;
  }
  // Keep only real species: a valid record whose name is not a placeholder.
  for (const [id, s] of Object.entries(species))
    if (!s.base.some(Boolean) || /^\?+$/.test(s.name)) delete species[id];
  // New forms that share a base name get their ID appended so pickers can tell them apart.
  for (const s of Object.values(species))
    if (nameCounts.get(s.name) > 1 && !prev.species[s.id]) s.name = `${s.name} (${s.id})`;

  // Moves: every record that has a name.
  const effectNames = new Map(),
    targetNames = new Map();
  for (const m of Object.values(prev.moves)) {
    if (!m.id) continue;
    const o = t.moves + m.id * MOVE_SIZE;
    if (o + MOVE_SIZE > rom.length) continue;
    effectNames.set(u16(o), m.effect);
    targetNames.set(u16(o + 2), m.target);
  }
  const moves = {};
  for (let id = 0; id < 4096; id++) {
    const nameOffset = t.moveNames + id * MOVE_NAME_SIZE,
      o = t.moves + id * MOVE_SIZE;
    if (o + MOVE_SIZE > rom.length || nameOffset + MOVE_NAME_SIZE > rom.length) break;
    const name = text(nameOffset, MOVE_NAME_SIZE);
    if (!name || !/^[A-Za-z0-9\-' .,!é()]+$/.test(name)) break;
    const known = prev.moves[id];
    const type2 = u8(o + MOVE_POWER + 2);
    const bitFlags = MOVE_FLAG_BITS.filter(([b, bit]) => (u8(o + b) >> bit) & 1).map(f => f[2]);
    const romFlagNames = new Set(MOVE_FLAG_BITS.map(f => f[2]));
    // Flags the game checks in code keep their labels from the previous data.
    const carried = (known?.flags || []).filter(f => !romFlagNames.has(f));
    let split = u8(o + MOVE_POWER + 7);
    for (const [b, bit, value] of MOVE_CATEGORY_BITS) if ((u8(o + b) >> bit) & 1) split = value;
    // Category 5 ("uses the stronger of physical or special") has no bit of its own here.
    if (known && known.split === 5) split = 5;
    const descPtr = id ? ptr(t.moveDescriptions + (id - 1) * 4) : null;
    const effect = effectNames.get(u16(o)) ?? `Effect ${u16(o)}`;
    moves[id] = {
      id,
      name,
      pp: u8(o + MOVE_POWER + 4),
      power: u8(o + MOVE_POWER),
      types:
        type2 && type2 !== u8(o + MOVE_POWER + 1)
          ? [u8(o + MOVE_POWER + 1), type2]
          : [u8(o + MOVE_POWER + 1)],
      description: descPtr === null ? '' : decodeText(rom, descPtr),
      split,
      accuracy: u8(o + MOVE_POWER + 3),
      priority: (u8(o + MOVE_POWER + 6) << 24) >> 24,
      target: targetNames.get(u16(o + 2)) ?? '',
      chance: u8(o + MOVE_POWER + 5),
      effect,
      flags: sameSet(known?.flags, [...bitFlags, ...carried])
        ? known.flags
        : [...bitFlags, ...carried],
      longDescription: known?.longDescription || '',
      banned: effect === 'Placeholder' || name === 'Dark Void',
    };
  }

  // Items: every record whose stored ID matches its position (unused IDs are blank).
  const POCKETS = [null, 'items', 'medicine', 'battle', 'tm', 'berry', 'ball', 'key', 'mega'];
  const items = { 0: { id: 0, name: 'None' } };
  for (let id = 1; id < 4096; id++) {
    const o = t.items + id * ITEM_SIZE;
    if (o + ITEM_SIZE > rom.length) break;
    const p = ptr(o);
    if (p === null || u16(o + 4) !== id) continue;
    const desc = ptr(o + 16);
    const item = { id, name: text(p, 40) };
    const pocket = POCKETS[u8(o + 22)];
    if (pocket) item.pocket = pocket;
    item.desc = desc === null ? '' : text(desc);
    items[id] = item;
  }

  const natures = prev.natures.map((_, i) => text(ptr(t.natures + i * 4), 20));
  // Characters the decoder does not know show as U+FFFD; list where, so the map can be extended.
  const unknown = [];
  for (const [table, list] of Object.entries({ species, moves, abilities, items }))
    for (const entry of Object.values(list))
      for (const key of ['name', 'desc', 'description'])
        if (typeof entry[key] === 'string' && entry[key].includes('\ufffd'))
          unknown.push(`${table} ${entry.id} ${key}`);
  if (unknown.length)
    console.warn(
      `Undecoded characters in ${unknown.length} strings: ${unknown.slice(0, 10).join(', ')}`,
    );
  return {
    tables: Object.fromEntries(
      Object.entries(t).map(([k, v]) => [
        k,
        typeof v === 'number'
          ? `0x${v.toString(16)}`
          : { at: `0x${v.at.toString(16)}`, length: v.length },
      ]),
    ),
    catalog: {
      version,
      creationDate: Date.now(),
      config: { ...prev.config, modulus, banned },
      types: prev.types,
      natures,
      species,
      moves,
      abilities,
      items,
    },
  };
}

// Entries that differ from `base`, in the format src/catalog-patches.json uses.
function diffCatalog(base, catalog) {
  const patch = {
    version: catalog.version,
    creationDate: catalog.creationDate,
    config: catalog.config,
  };
  if (JSON.stringify(catalog.natures) !== JSON.stringify(base.natures))
    patch.natures = catalog.natures;
  for (const table of ['species', 'moves', 'abilities', 'items']) {
    const changes = {};
    for (const id of new Set([...Object.keys(base[table]), ...Object.keys(catalog[table])])) {
      if (JSON.stringify(base[table][id]) !== JSON.stringify(catalog[table][id]))
        changes[id] = catalog[table][id] ?? null;
    }
    patch[table] = changes;
  }
  return patch;
}

// Field-by-field comparison with another catalog, for checking an extraction.
function compare(a, b) {
  const out = {};
  for (const table of ['species', 'moves', 'abilities', 'items']) {
    const fields = {};
    const ids = new Set([...Object.keys(a[table]), ...Object.keys(b[table])]);
    for (const id of ids) {
      const x = a[table][id],
        y = b[table][id];
      if (!x || !y) {
        fields[x ? 'only in first' : 'only in second'] =
          (fields[x ? 'only in first' : 'only in second'] || 0) + 1;
        continue;
      }
      for (const key of new Set([...Object.keys(x), ...Object.keys(y)])) {
        const same =
          key === 'learnset' || key === 'flags'
            ? JSON.stringify([...(x[key] || [])].sort()) ===
              JSON.stringify([...(y[key] || [])].sort())
            : JSON.stringify(x[key]) === JSON.stringify(y[key]);
        if (!same) fields[key] = (fields[key] || 0) + 1;
      }
    }
    out[table] = { entries: ids.size, differing: fields };
  }
  return out;
}

module.exports = { decodeText, encodeText, extract, diffCatalog, compare, readRom };

if (require.main === module) {
  const args = process.argv.slice(2);
  const option = name => {
    const i = args.indexOf(name);
    if (i < 0) return null;
    const value = args[i + 1];
    args.splice(i, 2);
    return value;
  };
  const from = option('--from'),
    reportFile = option('--report');
  const patchMode = args.includes('--patch');
  const [romFile, version, output] = args.filter(a => a !== '--patch');
  if (!romFile || !version || !output) {
    console.error(
      'Usage: node scripts/rom.cjs <rom.gba> <version-label> <output.json> [--patch] [--from <version>] [--report <file>]',
    );
    process.exit(1);
  }
  const base = require(path.join(__dirname, '../src/catalog.json'));
  const patches = require(path.join(__dirname, '../src/catalog-patches.json'));
  const fromVersion = from || Object.keys(patches)[0];
  const prev =
    fromVersion === base.version ? base : core.applyCatalogPatch(base, patches[fromVersion]);
  if (!prev) throw new Error(`Unknown version ${fromVersion}.`);
  const { catalog, tables } = extract(readRom(romFile), prev, version);
  fs.writeFileSync(output, JSON.stringify(patchMode ? diffCatalog(base, catalog) : catalog));
  const report = { tables, comparedWith: fromVersion, differences: compare(prev, catalog) };
  if (reportFile) fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(
    `${version}: ${Object.keys(catalog.species).length} species, ${Object.keys(catalog.moves).length} moves, ` +
      `${Object.keys(catalog.abilities).length} abilities, ${Object.keys(catalog.items).length - 1} items, ` +
      `modulus ${catalog.config.modulus}, ${catalog.config.banned.length - 1} banned abilities`,
  );
  console.log(`Tables: ${JSON.stringify(tables)}`);
  console.log(`Differences from ${fromVersion}: ${JSON.stringify(report.differences, null, 1)}`);
}
