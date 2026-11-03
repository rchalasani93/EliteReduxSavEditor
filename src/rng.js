(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ERRng = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const A = 1103515245,
    C = 24691,
    INV = 4005161829;
  const step = x => (Math.imul(A, x) + C) >>> 0;
  const inverse = x => Math.imul((x - C) >>> 0, INV) >>> 0;
  function randomize(source, species, pid, enabled, config) {
    if (!enabled || config.banned.includes(source)) return source;
    let seed = (source ^ step(species) ^ pid) >>> 0;
    for (let i = 0; i < 256; i++) {
      seed = step(seed);
      const out = ((seed >>> 16) % config.modulus) + 1;
      if (!config.banned.includes(out)) return out;
    }
    throw new Error('Randomizer did not terminate.');
  }
  function type(source, species, pid, first, enabled, config) {
    if (!enabled || source === config.mysteryType) return source;
    let seed = (source ^ step(species) ^ pid ^ (first ? 1 : 0)) >>> 0;
    for (let i = 0; i < 256; i++) {
      seed = step(seed);
      const result = (seed >>> 16) % config.typeModulus;
      if (result !== source && result !== config.mysteryType) return result;
    }
    throw new Error('Invalid type randomizer configuration.');
  }
  function evaluate(species, pid, slot, options, config) {
    return {
      ability: randomize(
        species.abilities[slot] || species.abilities[0] || 0,
        species.id,
        pid,
        options.abilityRng,
        config,
      ),
      innates: species.innates.map(n => randomize(n, species.id, pid, options.innateRng, config)),
      types: species.types.map((n, i) =>
        type(n, species.id, pid, i === 0, options.typeRng, config),
      ),
    };
  }
  function gender(species, pid) {
    const ratio = species.gender;
    if (ratio === 255) return 'Genderless';
    if (ratio === 254) return 'Female';
    if (ratio === 0) return 'Male';
    return ((pid + (species.key.startsWith('SPECIES_SYLVEON') ? 1 : 0)) & 255) < ratio
      ? 'Female'
      : 'Male';
  }
  // Invert terminal states for an anchor target (~4 million states per source).
  // In any-order mode that target may be in any variable field: scan each
  // possible source, sharing streams across ability slots. Fixed fields first
  // consume requested occurrences, including duplicate requests.
  // Walk preceding banned outputs backwards to retain all reroll chains.
  async function* searchPages(request, progress = () => {}, cancelled = () => false) {
    const {
      species,
      options,
      config,
      targets,
      lockedSlot = null,
      limit = 12,
      keepGender,
      pid: oldPid = 0,
      matchMode = 'slots',
    } = request;
    if (!['slots', 'any'].includes(matchMode)) throw new Error('Unknown ability matching mode.');
    if (
      !Array.isArray(targets) ||
      targets.length !== 4 ||
      targets.some(t => t !== null && (!Number.isInteger(t) || t < 0 || t > config.modulus))
    )
      throw new Error('Provide four valid ability targets or blank slots.');
    if (lockedSlot !== null && (!Number.isInteger(lockedSlot) || lockedSlot < 0 || lockedSlot > 2))
      throw new Error('Invalid ability slot.');
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error('Result limit must be from 1 to 100.');
    const anyOrder = matchMode === 'any',
      bans = new Set(config.banned),
      slots = lockedSlot === null ? [0, 1, 2] : [lockedSlot],
      answers = [],
      seen = new Set(),
      plans = new Map(),
      eligible = [];
    let checked = 0,
      percent = 0,
      stopped = false;
    const banned = new Uint8Array(config.modulus + 1);
    for (const id of bans) banned[id] = 1;
    const speciesConstant = step(species.id),
      wanted = new Map();
    for (const target of targets)
      if (target !== null) wanted.set(target, (wanted.get(target) || 0) + 1);
    const wantedGender = keepGender ? gender(species, oldPid) : null;
    function roll(source, enabled) {
      if (!enabled || banned[source]) return source;
      let seed = (source ^ speciesConstant ^ currentPid) >>> 0;
      for (let i = 0; i < 256; i++) {
        seed = step(seed);
        const value = ((seed >>> 16) % config.modulus) + 1;
        if (!banned[value]) return value;
      }
      throw new Error('Randomizer did not terminate.');
    }
    let currentPid = 0;
    function matches(values) {
      if (!anyOrder) return targets.every((t, i) => t === null || t === values[i]);
      for (const [target, count] of wanted)
        if (values.filter(v => v === target).length < count) return false;
      return true;
    }
    function* test(pid, slot) {
      if (wantedGender && gender(species, pid) !== wantedGender) return;
      currentPid = pid;
      const innates = species.innates.map(n => roll(n, options.innateRng));
      let missingTarget = null,
        missingCount = 0;
      if (anyOrder) {
        for (const [target, count] of wanted) {
          const missing = Math.max(0, count - innates.filter(v => v === target).length);
          missingCount += missing;
          if (missing) missingTarget = target;
        }
        if (missingCount > 1) return; // The active ability can supply only one occurrence.
      } else if (!targets.slice(1).every((t, i) => t === null || t === innates[i])) return;
      for (const info of eligible) {
        if (slot !== undefined && info.slot !== slot) continue;
        const resultKey = `${pid}:${info.slot}`;
        if (seen.has(resultKey)) continue;
        const ability = roll(info.sources[0], options.abilityRng);
        if (
          anyOrder
            ? missingCount === 1 && ability !== missingTarget
            : targets[0] !== null && ability !== targets[0]
        )
          continue;
        // Verify with the same forward evaluator used by the displayed preview.
        const r = evaluate(species, pid, info.slot, options, config);
        if (!matches([r.ability, ...r.innates])) continue;
        seen.add(resultKey);
        yield { pid, slot: info.slot, ...r };
      }
    }
    // Three or more targets use the block search (see blockKeys) over these anchors.
    const blockPlans = new Map();
    let needed = 4;
    for (const slot of slots) {
      const sources = [species.abilities[slot] || species.abilities[0] || 0, ...species.innates];
      const variable = sources.map(
        (source, i) => !!(i === 0 ? options.abilityRng : options.innateRng) && !bans.has(source),
      );
      let anchors = [];
      if (anyOrder) {
        const remaining = targets.filter(t => t !== null);
        for (let i = 0; i < 4; i++)
          if (!variable[i]) {
            const at = remaining.indexOf(sources[i]);
            if (at >= 0) remaining.splice(at, 1);
          }
        if (remaining.some(t => bans.has(t)) || remaining.length > variable.filter(Boolean).length)
          continue;
        if (remaining.length)
          anchors = sources.flatMap((source, i) =>
            variable[i] ? [{ source, target: remaining[0] }] : [],
          );
        needed = Math.min(needed, remaining.length);
        for (const target of new Set(remaining))
          sources.forEach(
            (source, i) => variable[i] && blockPlans.set(`${source}:${target}`, { source, target }),
          );
      } else {
        let impossible = false;
        for (let i = 0; i < 4; i++)
          if (targets[i] !== null) {
            if (!variable[i]) {
              if (targets[i] !== sources[i]) impossible = true;
            } else if (bans.has(targets[i])) impossible = true;
            else if (!anchors.length) anchors.push({ source: sources[i], target: targets[i] });
          }
        if (impossible) continue;
        needed = Math.min(needed, targets.filter((t, i) => t !== null && variable[i]).length);
        targets.forEach(
          (target, i) =>
            target !== null &&
            variable[i] &&
            blockPlans.set(`${sources[i]}:${target}`, { source: sources[i], target }),
        );
      }
      eligible.push({ slot, sources, unconstrained: !anchors.length && variable.some(Boolean) });
      for (const anchor of anchors) plans.set(`${anchor.source}:${anchor.target}`, anchor);
    }
    const streams = [...plans.values()].map(({ source, target }) => {
      const highs = [];
      for (let h = target - 1; h < 65536; h += config.modulus) highs.push(h);
      return { key: (source ^ speciesConstant) >>> 0, highs };
    });
    const totalChunks = streams.reduce((sum, p) => sum + p.highs.length, 0),
      useBlocks = wanted.size && targets.filter(t => t !== null).length >= 3;
    let chunks = 0;
    function* candidates() {
      yield oldPid >>> 0;
      // If fixed fields already satisfy every target, every PID is eligible.
      // Walk those PIDs directly rather than calling that first match exhaustive.
      if (eligible.some(info => info.unconstrained)) {
        for (let offset = 1; offset < 0x100000000; offset++) {
          checked++;
          yield (oldPid + offset) >>> 0;
          if (offset % 65536 === 0) {
            percent = (offset / 0x100000000) * 100;
            yield { checked, percent, answers: seen.size };
          }
        }
        return;
      }
      if (useBlocks) {
        const kinds = [...wanted.keys()],
          blockTable = kindTable(config, kinds, banned),
          variableAbility = info => !!options.abilityRng && !bans.has(info.sources[0]);
        const block = { high: 0, r: 0, anchor: 0, covered: 0 };
        const blocks = blockKeys({
          block,
          table: blockTable,
          modulus: config.modulus,
          pairs: [...blockPlans.values()],
          innates: species.innates.filter(n => !!options.innateRng && !bans.has(n)),
          abilities: [...new Set(eligible.filter(variableAbility).map(info => info.sources[0]))],
          abilityAlways: eligible.some(info => !variableAbility(info)),
          needed,
        });
        for (const next of blocks) {
          checked = block.covered;
          if (typeof next === 'number') {
            percent = next * 100;
            yield { checked, percent, answers: seen.size };
            continue;
          }
          for (let t = 0; t < 32; t++) yield (blockKey(block, t) ^ speciesConstant) >>> 0;
        }
        return;
      }
      for (const { key, highs } of streams) {
        for (const high of highs) {
          for (let low = 0; low < 65536; low++) {
            percent = ((chunks + low / 65536) / totalChunks) * 100;
            let predecessor = inverse(((high << 16) | low) >>> 0);
            checked++;
            yield (predecessor ^ key) >>> 0;
            for (
              let chain = 0;
              chain < 256 && bans.has(((predecessor >>> 16) % config.modulus) + 1);
              chain++
            ) {
              predecessor = inverse(predecessor);
              checked++;
              yield (predecessor ^ key) >>> 0;
            }
          }
          percent = (++chunks / totalChunks) * 100;
          yield { checked, percent, answers: seen.size };
        }
      }
    }
    // Both iterators retain their position while a page is displayed, including
    // remaining ability slots and banned-output rerolls for the current PID.
    for (const candidate of candidates()) {
      if (typeof candidate === 'object') {
        progress(candidate);
        await new Promise(r => setTimeout(r, 0));
        if (cancelled()) {
          stopped = true;
          break;
        }
      } else
        for (const result of test(candidate)) {
          answers.push(result);
          if (answers.length >= limit)
            yield { answers: answers.splice(0), checked, percent, complete: false };
        }
    }
    yield {
      answers,
      checked,
      percent: stopped ? percent : 100,
      complete: !stopped,
      ...(stopped ? { cancelled: true } : {}),
    };
  }
  // Species finder. Every species whose ability sources match (same three
  // abilities and innates) rolls identically under key = step(species) ^ PID,
  // so each distinct layout is searched once and the key translated per species.
  function layoutKey(species) {
    return `${species.abilities.join(',')}|${species.innates.join(',')}`;
  }
  function groupLayouts(speciesList) {
    const groups = new Map();
    for (const sp of speciesList) {
      const key = layoutKey(sp);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(sp);
    }
    return [...groups.values()];
  }
  // First-roll lookup for the finder: the stepped seed's high half-word decides the first
  // output, so one table maps it to a target kind (1-based), 0 for any other ability, or
  // 255 when that output is banned and the roll continues (rare; taken on a slow path).
  function kindTable(config, kinds, banned) {
    const table = new Uint8Array(65536);
    for (let h = 0; h < 65536; h++) {
      const out = (h % config.modulus) + 1;
      table[h] = banned[out] ? 255 : kinds.indexOf(out) + 1;
    }
    return table;
  }
  // Block search for three or four targets, where matches are rare and a full scan per layout
  // is millions of candidates. Ability IDs fit in 11 bits, so two sources' seeds for the same
  // key differ only in their low 11 bits: seed ^ d = seed + delta, with delta fixed by those
  // bits. One step later the second seed's state is the anchor's state plus A * delta, so for
  // a fixed high half-word and fixed low 11 bits of the anchor's state, every other source's
  // first output is one of two values (the carry out of the low half-word decides which).
  // A block of 32 candidates is skipped when too many positions surely miss; the rest go
  // through the exact test. Each target is anchored at every source it can come from, on its
  // first roll, so a match is passed over only if every target in it came from a reroll after
  // a banned output (under 0.04^3 of matches).
  // o: { table, modulus, pairs: [{ target, source }], innates, abilities, abilityAlways, needed }.
  // Yields each block that can still hold a match as one reused { high, r, anchor, covered }
  // object (its 32 keys come from blockKey; covered counts keys passed or skipped so far), and
  // every 64 block rows the fraction done (0 to 1).
  const blockKey = (block, t) =>
    (inverse(((block.high << 16) | (block.r + t * 2048)) >>> 0) ^ block.anchor) >>> 0;
  function* blockKeys(o) {
    const { table, modulus, pairs, innates, abilities, abilityAlways, needed } = o,
      innCount = innates.length,
      sources = [...innates, ...abilities],
      count = sources.length,
      kh = new Int32Array(count),
      rows = pairs.length * 2048,
      // Innates that may miss while the rest (and the ability) still cover every target.
      maxMisses = innCount + 1 - needed,
      block = o.block || { high: 0, r: 0, anchor: 0, covered: 0 };
    let row = 0;
    for (const { target, source: anchor } of pairs) {
      for (let r = 0; r < 2048; r++, row++) {
        // Low 11 bits of the anchor's seed follow from the low 11 bits of its state.
        const seedLow = Math.imul((r - C) | 0, INV) & 2047;
        for (let j = 0; j < count; j++)
          kh[j] = Math.imul(A, (seedLow ^ (anchor ^ sources[j])) - seedLow) >>> 16;
        for (let high = target - 1; high < 65536; high += modulus) {
          block.covered += 32;
          // A position can supply a target only if one of its two possible first outputs
          // is a target or banned (rerolled).
          let hits = 0,
            misses = 0;
          for (let j = 0; j < innCount; j++)
            if (table[(high + kh[j]) & 0xffff] || table[(high + kh[j] + 1) & 0xffff]) hits++;
            else if (++misses > maxMisses) break;
          if (misses > maxMisses) continue;
          if (hits < needed) {
            if (hits + 1 < needed) continue;
            let possible = abilityAlways;
            for (let j = innCount; j < count && !possible; j++)
              possible = !!(table[(high + kh[j]) & 0xffff] || table[(high + kh[j] + 1) & 0xffff]);
            if (!possible) continue;
          }
          block.high = high;
          block.r = r;
          block.anchor = anchor;
          yield block;
        }
        if ((row & 63) === 63) yield row / rows;
      }
    }
  }
  // Returns the first { key, slot } for which a layout yields every target
  // (any order across the active ability and innates), or null when none exists.
  // lockedSlot (0-2) limits the active ability to that slot.
  function findLayoutKey(
    species,
    options,
    config,
    targets,
    banned,
    budget,
    lockedSlot = null,
    table,
  ) {
    const modulus = config.modulus,
      wanted = new Map();
    for (const t of targets) wanted.set(t, (wanted.get(t) || 0) + 1);
    const kinds = [...wanted.keys()],
      wantC = [0, ...wanted.values()];
    table = table || kindTable(config, kinds, banned);
    const kindOf = value => kinds.indexOf(value) + 1;
    const innSources = species.innates.slice(0, 3);
    const innVariable = innSources.map(s => !!options.innateRng && !banned[s]);
    const slotSources = [0, 1, 2].map(k => species.abilities[k] || species.abilities[0] || 0);
    const slots = lockedSlot === null ? [0, 1, 2] : [lockedSlot];
    const eligible = [];
    for (const slot of slots) {
      const src = slotSources[slot];
      if (eligible.some(e => e.source === src)) continue; // identical rolls to an earlier slot
      const abVariable = !!options.abilityRng && !banned[src];
      const remaining = targets.slice();
      const fixed = [
        abVariable ? null : src,
        ...innSources.map((s, i) => (innVariable[i] ? null : s)),
      ];
      for (const s of fixed) {
        if (s === null) continue;
        const at = remaining.indexOf(s);
        if (at >= 0) remaining.splice(at, 1);
      }
      const variableCount = (abVariable ? 1 : 0) + innVariable.filter(Boolean).length;
      if (remaining.some(t => banned[t]) || remaining.length > variableCount) continue;
      if (!remaining.length) return { key: 0, slot, unconstrained: true };
      eligible.push({
        slot,
        source: src,
        variable: abVariable,
        fixedKind: kindOf(src),
        anchor: remaining[0],
      });
    }
    if (!eligible.length) return null;
    // Each eligible slot still needs its first remaining target from some variable
    // source, so scanning every (target, variable source) pair finds every match.
    const anchorTargets = new Set(eligible.map(e => e.anchor));
    const abRng = !!options.abilityRng;
    // Full roll for a banned first output, as a target kind.
    const slowKind = (src, q) => {
      let seed = (src ^ q) >>> 0;
      for (let i = 0; i < 256; i++) {
        seed = (Math.imul(A, seed) + C) >>> 0;
        const v = ((seed >>> 16) % modulus) + 1;
        if (!banned[v]) return kindOf(v);
      }
      return 0;
    };
    // Innates fixed by the options count once, up front; extra copies don't matter.
    const needBase = wantC.slice();
    let missingBase = targets.length;
    const variableInnates = [];
    innSources.forEach((s, i) => {
      if (innVariable[i]) return variableInnates.push(s);
      const k = kindOf(s);
      if (k && needBase[k]) {
        needBase[k]--;
        missingBase--;
      }
    });
    const slackBase = variableInnates.length + 1 - missingBase;
    if (slackBase < 0) return null;
    const [b1 = 0, b2 = 0, b3 = 0, b4 = 0] = needBase.slice(1),
      vCount = variableInnates.length,
      [v0 = 0, v1 = 0, v2 = 0] = variableInnates,
      kindAt = (src, q) => {
        const k = table[(Math.imul(A, (src ^ q) >>> 0) + C) >>> 16];
        return k === 255 ? slowKind(src, q) : k;
      };
    // Rolls only as far as needed: once more innates miss than the ability could make up
    // for, the candidate is rejected without rolling the rest. Counts per target kind are
    // kept in locals (at most four kinds) so the hot loop allocates nothing.
    const test = q => {
      let n1 = b1,
        n2 = b2,
        n3 = b3,
        n4 = b4,
        slack = slackBase;
      for (let i = 0; i < vCount; i++) {
        const k = kindAt(i === 0 ? v0 : i === 1 ? v1 : v2, q);
        if (k === 1 && n1) n1--;
        else if (k === 2 && n2) n2--;
        else if (k === 3 && n3) n3--;
        else if (k === 4 && n4) n4--;
        else if (--slack < 0) return -1;
      }
      const missing = n1 + n2 + n3 + n4;
      if (missing === 0) return eligible[0].slot;
      if (missing > 1) return -1;
      const missingKind = n1 ? 1 : n2 ? 2 : n3 ? 3 : 4;
      for (let n = 0; n < eligible.length; n++) {
        const e = eligible[n];
        if ((e.variable ? kindAt(e.source, q) : e.fixedKind) === missingKind) return e.slot;
      }
      return -1;
    };
    // Anchor positions: every variable source (innates and eligible abilities).
    const anchorSources = new Set();
    innSources.forEach((s, i) => innVariable[i] && anchorSources.add(s));
    eligible.forEach(e => e.variable && anchorSources.add(e.source));
    if (targets.length >= 3) {
      const keys = blockKeys({
        table,
        modulus,
        pairs: kinds.flatMap(target => [...anchorSources].map(source => ({ target, source }))),
        innates: variableInnates,
        abilities: eligible.filter(e => e.variable).map(e => e.source),
        abilityAlways: eligible.some(e => !e.variable && e.fixedKind),
        needed: missingBase,
      });
      for (const block of keys) {
        if (typeof block === 'number') continue;
        for (let t = 0; t < 32; t++) {
          const key = blockKey(block, t),
            slot = test(key);
          if (slot >= 0) return { key, slot };
        }
      }
      budget.chunks++;
      return null;
    }
    for (const target of anchorTargets) {
      for (const source of anchorSources) {
        for (let high = target - 1; high < 65536; high += modulus) {
          for (let low = 0; low < 65536; low++) {
            let pred = inverse(((high << 16) | low) >>> 0);
            for (let chain = 0; chain < 256; chain++) {
              const slot = test((pred ^ source) >>> 0);
              if (slot >= 0) return { key: (pred ^ source) >>> 0, slot };
              if (table[pred >>> 16] !== 255) break;
              pred = inverse(pred);
            }
          }
          budget.chunks++;
        }
      }
    }
    return null;
  }
  // Yields { done, total, found: [{ species, pid, slot, ability, innates }] } per layout.
  async function* findSpecies(request, cancelled = () => false) {
    const { speciesList, options, config, targets, lockedSlot = null } = request;
    if (lockedSlot !== null && ![0, 1, 2].includes(lockedSlot))
      throw new Error('Invalid ability slot.');
    if (!Array.isArray(targets) || !targets.length || targets.length > 4)
      throw new Error('Choose one to four abilities.');
    if (targets.some(t => !Number.isInteger(t) || t < 1 || t > config.modulus))
      throw new Error('Unknown ability.');
    const banned = new Uint8Array(config.modulus + 2);
    for (const id of config.banned) banned[id] = 1;
    const groups = request.groups || groupLayouts(speciesList);
    const budget = { chunks: 0 },
      table = kindTable(config, [...new Set(targets)], banned);
    let done = 0;
    for (const group of groups) {
      if (cancelled()) return;
      const hit = findLayoutKey(
        group[0],
        options,
        config,
        targets,
        banned,
        budget,
        lockedSlot,
        table,
      );
      const found = [];
      if (hit)
        for (const sp of group) {
          const pid = hit.unconstrained ? (request.pid ?? 0) >>> 0 : (hit.key ^ step(sp.id)) >>> 0;
          const r = evaluate(sp, pid, hit.slot, options, config);
          const values = [r.ability, ...r.innates];
          const ok = targets.every(
            t => values.filter(v => v === t).length >= targets.filter(x => x === t).length,
          );
          if (ok) found.push({ species: sp.id, pid, slot: hit.slot, ...r });
        }
      done++;
      yield { done, total: groups.length, found };
    }
  }
  async function search(request, progress = () => {}, cancelled = () => false) {
    const pages = searchPages(request, progress, cancelled);
    try {
      return (await pages.next()).value;
    } finally {
      await pages.return();
    }
  }
  return {
    step,
    inverse,
    randomize,
    type,
    evaluate,
    gender,
    search,
    searchPages,
    layoutKey,
    groupLayouts,
    findSpecies,
  };
});
