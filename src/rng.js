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
      }
      eligible.push({ slot, sources, unconstrained: !anchors.length && variable.some(Boolean) });
      for (const anchor of anchors) plans.set(`${anchor.source}:${anchor.target}`, anchor);
    }
    const streams = [...plans.values()].map(({ source, target }) => {
      const highs = [];
      for (let h = target - 1; h < 65536; h += config.modulus) highs.push(h);
      return { key: (source ^ speciesConstant) >>> 0, highs };
    });
    const totalChunks = streams.reduce((sum, p) => sum + p.highs.length, 0);
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
  async function search(request, progress = () => {}, cancelled = () => false) {
    const pages = searchPages(request, progress, cancelled);
    try {
      return (await pages.next()).value;
    } finally {
      await pages.return();
    }
  }
  return { step, inverse, randomize, type, evaluate, gender, search, searchPages };
});
