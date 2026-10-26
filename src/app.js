(() => {
  'use strict';
  const $ = id => document.getElementById(id),
    html = ERHtml.escape;
  const builtin = JSON.parse($('catalog').textContent);
  // Each bundled game version: the base data, plus newer builds applied as patches over it.
  const GAME_VERSIONS = { '2.65.4.11b': '2.65.4.11b (latest)', '2.65.4': '2.65.4 / 2.65.4.1b' };
  const bundled = { '2.65.4': builtin };
  for (const [version, patch] of Object.entries(JSON.parse($('catalog-patches').textContent)))
    bundled[version] = ERCore.applyCatalogPatch(builtin, patch);
  const LATEST_VERSION = '2.65.4.11b';
  function rememberedVersion() {
    try {
      return localStorage.getItem('er-game-version');
    } catch {
      return null;
    }
  }
  function rememberVersion(version) {
    try {
      localStorage.setItem('er-game-version', version);
    } catch {
      /* private mode: the choice just isn't remembered */
    }
  }
  let catalog = bundled[rememberedVersion()] || bundled[LATEST_VERSION],
    save = null,
    filename = 'save.sav',
    roster = 'party',
    box = 0,
    ref = null,
    tab = 'pokemon',
    dirty = false,
    worker = null,
    workerUrl = null,
    searchResults = [],
    searchSession = null,
    matchMode = 'any',
    toastTimer;
  const pokemonIcons = JSON.parse($('pokemon-icons').textContent).images,
    searchDrafts = new Map();
  const typeColors = [
    '#77796a',
    '#ac634c',
    '#7587a9',
    '#986cba',
    '#997759',
    '#968454',
    '#809147',
    '#7968a4',
    '#738997',
    '#757575',
    '#bc6755',
    '#508fae',
    '#629478',
    '#aa934b',
    '#b16990',
    '#60a2b2',
    '#766fa8',
    '#626478',
    '#ad80a0',
    '#947361',
  ];
  const statLabels = ['HP', 'Attack', 'Defense', 'Sp. Atk', 'Sp. Def', 'Speed'];
  const ballNames = () =>
    Array.from({ length: 28 }, (_, id) =>
      id === 0 ? 'None' : catalog.items[id]?.name || `Ball #${id}`,
    );
  let indexes = {},
    pickerEntries = [],
    catalogEntries = {},
    catalogControlId = 0;
  // Every word of the query must appear, in any order: "primal cascoon" finds Cascoon Primal.
  const matchesQuery = (text, query) => query.split(/\s+/).every(word => text.includes(word));
  const touchLayout = () => window.matchMedia('(max-width: 760px), (any-pointer: coarse)').matches;
  const catalogLabel = kind =>
    ({ species: 'species', moves: 'move', abilities: 'ability', items: 'item' })[kind] || kind;
  function updateViewport() {
    const viewport = window.visualViewport;
    document.documentElement.style.setProperty(
      '--viewport-height',
      `${viewport?.height || window.innerHeight}px`,
    );
    document.documentElement.style.setProperty('--viewport-top', `${viewport?.offsetTop || 0}px`);
  }
  updateViewport();
  window.addEventListener('resize', updateViewport);
  window.visualViewport?.addEventListener('resize', updateViewport);
  window.visualViewport?.addEventListener('scroll', updateViewport);
  function closeDialog(dialog) {
    if (typeof dialog.close === 'function') dialog.close();
    else {
      dialog.removeAttribute('open');
      dialog.dispatchEvent(new Event('close'));
    }
  }
  function showDialog(dialog) {
    if (dialog.hasAttribute('open')) return;
    const previous = document.activeElement;
    let backdrop;
    const trap = e => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeDialog(dialog);
        return;
      }
      if (e.key !== 'Tab') return;
      const controls = [
        ...dialog.querySelectorAll(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]',
        ),
      ].filter(control => control.getClientRects().length);
      const first = controls[0],
        last = controls[controls.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    dialog.addEventListener(
      'close',
      () => {
        backdrop?.remove();
        dialog.removeEventListener('keydown', trap);
        if (!document.querySelector('dialog[open]')) document.body.classList.remove('dialog-open');
        if (previous?.isConnected) previous.focus({ preventScroll: true });
      },
      { once: true },
    );
    document.body.classList.add('dialog-open');
    updateViewport();
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else {
      backdrop = document.createElement('div');
      backdrop.className = 'dialog-backdrop';
      backdrop.onclick = () => closeDialog(dialog);
      document.body.append(backdrop);
      dialog.setAttribute('open', '');
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.addEventListener('keydown', trap);
      dialog.querySelector('button')?.focus();
    }
  }
  function bindCatalogPickers(root = $('editor-panel')) {
    root.querySelectorAll('input[list]').forEach(input => {
      if (input.closest('.catalog-field')) return;
      if (!input.id) input.id = `catalog-control-${++catalogControlId}`;
      const kind = input.getAttribute('list').replace('list-', '');
      if (!catalogEntries[kind]) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'catalog-browse';
      button.textContent = 'Browse';
      button.title = `Choose ${catalogLabel(kind)}`;
      button.setAttribute('aria-label', button.title);
      button.dataset.catalogInput = input.id;
      button.disabled = input.disabled;
      const wrapper = document.createElement('div');
      wrapper.className = 'catalog-field';
      const label = input.closest('label.field'),
        anchor = label || input;
      anchor.before(wrapper);
      wrapper.append(anchor, button);
    });
  }
  function openCatalogPicker(input) {
    if (!input || input.disabled) return;
    const kind = input.getAttribute('list').replace('list-', ''),
      entries = catalogEntries[kind];
    if (!entries) return;
    const dialog = document.createElement('dialog');
    dialog.id = 'catalog-picker';
    dialog.setAttribute('aria-labelledby', 'catalog-picker-title');
    dialog.innerHTML =
      '<div class="dialog-head"><h2 id="catalog-picker-title"></h2><button type="button" class="icon-button" id="close-catalog-picker" aria-label="Close chooser">Close</button></div><label class="field"><span>Search by name or ID</span><input id="catalog-picker-filter" type="search" autocomplete="off" autocapitalize="none" spellcheck="false" enterkeyhint="search"></label><p id="catalog-picker-count" class="field-help" aria-live="polite"></p><div class="picker-body"><div id="catalog-picker-options"></div></div><button type="button" class="picker-more" id="catalog-picker-more">Show more options</button>';
    dialog.querySelector('h2').textContent = `Choose ${catalogLabel(kind)}`;
    document.body.append(dialog);
    const filter = dialog.querySelector('#catalog-picker-filter'),
      list = dialog.querySelector('#catalog-picker-options'),
      count = dialog.querySelector('#catalog-picker-count'),
      more = dialog.querySelector('#catalog-picker-more');
    let matches = entries,
      shown = 0,
      frame;
    const append = () => {
      const fragment = document.createDocumentFragment(),
        next = matches.slice(shown, shown + 40);
      shown += next.length;
      for (const entry of next) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'picker-option';
        const text = document.createElement('span'),
          name = document.createElement('b'),
          detail = document.createElement('small');
        name.textContent = entry.value.name;
        const no = entry.value.key && ERCore.dexNumber(catalog, entry.value.id);
        detail.textContent = `#${entry.value.id}${no && no !== entry.value.id ? ` · Pokédex #${no}` : ''}${entry.value.desc ? ' · ' + entry.value.desc : ''}`;
        text.append(name, detail);
        button.append(text);
        button.onclick = () => {
          closeDialog(dialog);
          if (!input.isConnected) return;
          input.value = display(entry.value);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          if (!touchLayout()) input.focus({ preventScroll: true });
        };
        fragment.append(button);
      }
      list.append(fragment);
      count.textContent = `Showing ${shown} of ${matches.length.toLocaleString()} options`;
      more.hidden = shown >= matches.length;
    };
    const draw = () => {
      const query = filter.value.trim().toLocaleLowerCase();
      matches = query ? entries.filter(entry => matchesQuery(entry.search, query)) : entries;
      shown = 0;
      list.replaceChildren();
      dialog.querySelector('.picker-body').scrollTop = 0;
      append();
      if (!matches.length) {
        const empty = document.createElement('p');
        empty.className = 'picker-help';
        empty.textContent = 'No options match your search.';
        list.append(empty);
      }
    };
    filter.oninput = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(draw);
    };
    more.onclick = append;
    dialog.querySelector('#close-catalog-picker').onclick = () => closeDialog(dialog);
    dialog.addEventListener(
      'close',
      () => {
        cancelAnimationFrame(frame);
        dialog.remove();
      },
      { once: true },
    );
    showDialog(dialog);
    draw();
    if (!touchLayout()) filter.focus();
  }
  function notify(message, error = false) {
    clearTimeout(toastTimer);
    $('toast').textContent = message;
    $('toast').className = error ? 'error' : '';
    $('toast').hidden = false;
    toastTimer = setTimeout(() => ($('toast').hidden = true), error ? 8500 : 4000);
  }
  // Unapplied edits block navigation. With a retry callback, ask whether to apply or
  // discard them and then carry on; without one, just say so.
  function guard(retry) {
    if (!dirty) return true;
    if (retry) askAboutPending(retry);
    else notify('Apply or discard your pending changes first.', true);
    return false;
  }
  function askAboutPending(retry) {
    if (document.querySelector('dialog.pending-dialog')) return;
    const dialog = openDialog(
      'You have unapplied changes',
      'Changes on this page only reach your save when you apply them.',
      `<div class="form-footer pending-choices"><span></span><div class="actions-inline"><button type="button" data-close>Keep editing</button><button type="button" data-pending="discard">Discard changes</button><button type="button" class="primary" data-pending="apply">Apply changes</button></div></div>`,
    );
    dialog.classList.add('pending-dialog');
    dialog.querySelector('[data-pending="discard"]').onclick = () => {
      closeDialog(dialog);
      discardPending();
      retry();
    };
    dialog.querySelector('[data-pending="apply"]').onclick = () => {
      closeDialog(dialog);
      const form = document.querySelector('#editor-panel form.is-dirty');
      if (form) form.requestSubmit();
      else document.querySelector('#editor-panel .is-dirty [data-dirty-apply]')?.click();
      // Invalid input keeps the changes pending; the error is already shown.
      if (!dirty) retry();
    };
  }
  function discardPending() {
    bagDraft.clear();
    dexDraft.clear();
    flagDraft.clear();
    varDraft.clear();
    dirty = false;
    render();
    sync();
  }
  function fail(error) {
    notify(error.message || String(error), true);
  }
  function display(entry) {
    return entry ? `${entry.name} · #${entry.id}` : '';
  }
  function resolve(kind, value, allowNone = false) {
    const t = value.trim();
    if (allowNone && !t) return 0;
    const number = /^(?:#)?(\d+)$/.exec(t) || /· #(\d+)$/.exec(t);
    let id = number ? +number[1] : indexes[kind].get(t.toLocaleLowerCase());
    if (id === undefined || !catalog[kind][id])
      throw new Error(
        `Choose a valid ${catalogLabel(kind)} from the list, or enter its numeric ID.`,
      );
    return id;
  }
  function buildLists() {
    document.querySelectorAll('datalist').forEach(e => e.remove());
    indexes = {};
    for (const kind of ['species', 'moves', 'abilities', 'items']) {
      indexes[kind] = new Map();
      const list = document.createElement('datalist');
      list.id = `list-${kind}`;
      const entries = Object.values(catalog[kind]).sort((a, b) => a.name.localeCompare(b.name));
      catalogEntries[kind] = entries.map(value => ({
        value,
        search: `${value.name} ${value.id}`.toLocaleLowerCase(),
      }));
      if (kind === 'abilities') {
        const banned = new Set(catalog.config.banned);
        pickerEntries = entries
          .filter(a => a.id > 0 && a.id <= catalog.config.modulus && !banned.has(a.id))
          .map(a => ({
            id: a.id,
            search: `${a.name} ${a.desc || ''} ${a.id}`.toLocaleLowerCase(),
            markup: `<button type="button" class="picker-option" data-target-ability="${html(a.id)}"><span><b>${html(a.name)}</b><small>${html(a.desc || 'No description available.')}</small></span><span class="picker-select">Select for search</span></button>`,
          }));
      }
      list.innerHTML = entries
        .map(e => {
          indexes[kind].set(e.name.toLocaleLowerCase(), e.id);
          indexes[kind].set(display(e).toLocaleLowerCase(), e.id);
          return `<option value="${html(display(e))}"></option>`;
        })
        .join('');
      document.body.append(list);
    }
  }
  buildLists();
  const numberField = (label, name, value, min, max) =>
    `<label class="field"><span>${html(label)}</span><input name="${html(name)}" type="number" value="${html(value)}" min="${html(min)}" max="${html(max)}" required></label>`;
  const catalogField = (label, name, kind, id) =>
    `<label class="field"><span>${label}</span><input name="${name}" list="list-${kind}" value="${html(display(catalog[kind][id]) || `#${id}`)}" autocomplete="off" required></label>`;
  const selectField = (label, name, value, entries) =>
    `<label class="field"><span>${label}</span><select name="${name}">${entries.map((e, i) => `<option value="${i}"${i === value ? ' selected' : ''}>${html(e)}</option>`).join('')}</select></label>`;
  const typeTags = types =>
    [...new Set(types)]
      .map(
        i =>
          `<span class="type" style="--type:${typeColors[i] || '#777'}">${html(catalog.types[i] || 'None')}</span>`,
      )
      .join('');
  function pokemonIcon(species) {
    const image = ERHtml.pngSource(pokemonIcons[species?.key]);
    return `<span class="mon-emblem" aria-hidden="true">${image ? `<img src="${html(image)}" alt="" width="64" height="64" decoding="async">` : '<span class="unknown-mon-icon"></span>'}</span>`;
  }
  function searchDraft() {
    const key = `${ref?.kind}:${ref?.box ?? ''}:${ref?.slot}`;
    if (!searchDrafts.has(key))
      searchDrafts.set(key, {
        targets: ['', '', '', ''],
        matchMode: 'any',
        lockSlot: false,
        keepGender: true,
      });
    return searchDrafts.get(key);
  }
  function rememberSearchDraft() {
    if (!$('target-0')) return;
    Object.assign(searchDraft(), {
      targets: [0, 1, 2, 3].map(i => $('target-' + i).value),
      matchMode: $('match-any-order').checked ? 'any' : 'slots',
      lockSlot: $('lock-slot').checked,
      keepGender: $('keep-gender').checked,
    });
  }
  function options() {
    return save.options();
  }
  function mon() {
    return ref ? save.mon(ref) : null;
  }
  // Elite Redux combines abilities, described as "Color Change + Protean + Fur Coat".
  // Each named part that is itself an ability can be expanded to its own effect.
  const abilityPartCache = new WeakMap();
  function abilityParts(id) {
    let cache = abilityPartCache.get(catalog);
    if (!cache) {
      const byName = new Map();
      for (const a of Object.values(catalog.abilities))
        if (a.id > 0 && !byName.has(a.name.toLowerCase())) byName.set(a.name.toLowerCase(), a);
      cache = { byName, parts: new Map() };
      abilityPartCache.set(catalog, cache);
    }
    if (cache.parts.has(id)) return cache.parts.get(id);
    const desc = catalog.abilities[id]?.desc || '',
      parts = [];
    if (desc.includes('+'))
      for (const segment of desc.split(/\s*\+\s*|[.;,]\s*/)) {
        const name = segment
            .replace(/^(also has|has|and)\s+/i, '')
            .trim()
            .toLowerCase(),
          part = cache.byName.get(name);
        if (part && part.id !== +id && !parts.includes(part)) parts.push(part);
      }
    cache.parts.set(id, parts);
    return parts;
  }
  function abilityPartsMarkup(id) {
    const parts = abilityParts(id);
    if (!parts.length) return '';
    return `<details class="ability-parts"><summary>${parts.length === 1 ? `What ${html(parts[0].name)} does` : `Show each effect (${parts.length})`}</summary><dl>${parts.map(p => `<dt>${html(p.name)}</dt><dd>${html(p.desc || 'No description available.')}</dd>`).join('')}</dl></details>`;
  }
  function abilityChoices(species, pid, opts = options(), config = catalog.config) {
    return [0, 1, 2].map(slot => ERRng.evaluate(species, pid, slot, opts, config).ability);
  }
  function abilityCards(m, species = catalog.species[m.species], preview = false) {
    const opts = options(),
      r = ERRng.evaluate(species, m.pid, m.abilitySlot, opts, catalog.config),
      choices = abilityChoices(species, m.pid, opts);
    const card = (id, label, randomized, slot, innateIndex) => {
      const equipped = slot === m.abilitySlot,
        choice = slot !== undefined;
      const picker = preview
        ? ''
        : `<button type="button" class="ability-reload" data-pick-ability="${choice ? 'ability' : 'innate'}" data-pick-index="${choice ? slot : innateIndex}" aria-label="Choose ${choice ? 'ability' : 'innate'} ${(choice ? slot : innateIndex) + 1}" title="Choose an available ability">Change</button>`;
      return `<div class="ability-card${choice && equipped ? ' is-equipped' : ''}"${choice ? ` data-ability-choice="${slot}" data-equipped="${equipped}"` : ''}><div class="slot-name"><span>${label}${picker}${preview && randomized ? ' (randomized)' : ''}</span>${choice && equipped ? `<span class="equipped-badge">${preview ? 'Preview selection' : 'Equipped'}</span>` : ''}</div><b>${html(catalog.abilities[id]?.name || `#${id}`)}</b><small>${html(catalog.abilities[id]?.desc || 'No description available.')}</small>${abilityPartsMarkup(id)}</div>`;
    };
    return `<section class="ability-group" aria-label="Ability choices"><div class="ability-group-heading"><h2>ABILITY CHOICES</h2><span>${preview ? 'Preview only' : 'One equipped at a time'}</span></div><div class="abilities-list">${choices.map((id, i) => card(id, `ABILITY ${i + 1}`, opts.abilityRng, i)).join('')}</div></section><section class="ability-group" aria-label="Innate abilities"><div class="ability-group-heading"><h2>INNATES</h2></div><div class="abilities-list">${r.innates.map((id, i) => card(id, `INNATE ${i + 1}`, opts.innateRng, undefined, i)).join('')}</div></section>`;
  }
  function openAbilityPicker(kind, index) {
    if (!guard()) return;
    rememberSearchDraft();
    const m = mon(),
      species = catalog.species[m.species],
      choices = abilityChoices(species, m.pid),
      opts = options();
    const source =
      kind === 'ability'
        ? species.abilities[index] || species.abilities[0] || 0
        : species.innates[index];
    const variable =
      !!(kind === 'ability' ? opts.abilityRng : opts.innateRng) &&
      !catalog.config.banned.includes(source);
    const dialog = document.createElement('dialog');
    dialog.id = 'ability-picker';
    dialog.setAttribute('aria-labelledby', 'ability-picker-title');
    dialog.innerHTML = `<div class="dialog-head"><div><h2 id="ability-picker-title">Choose ${kind === 'ability' ? 'an ability' : 'an innate'}</h2><p>${html(species.name)} · ${kind === 'ability' ? `Ability ${index + 1}` : `Innate ${index + 1}`}</p></div><button type="button" class="icon-button" id="close-ability-picker" aria-label="Close ability picker">×</button></div><div class="picker-body">${kind === 'ability' ? `<h3>AVAILABLE NOW</h3><p class="picker-help">Equip one of this Pokémon’s three current choices.</p><div class="picker-current-grid">${choices.map((id, slot) => `<button type="button" data-equip-choice="${slot}" ${slot === m.abilitySlot ? 'disabled' : ''}><span>Slot ${slot + 1}${slot === m.abilitySlot ? ' · Equipped' : ''}</span><b>${html(catalog.abilities[id]?.name || id)}</b><small>${html(catalog.abilities[id]?.desc || '')}</small></button>`).join('')}</div>` : ''}${variable ? `<h3>FIND A NEW COMBINATION</h3><p class="picker-help">Choose an ability to add to your combination search. Find a matching PID to apply it together with your other targets.</p><label class="field"><span>Search abilities</span><input id="ability-picker-filter" type="search" placeholder="Search by name, description, or ID" autocomplete="off"></label><p id="ability-picker-count" class="field-help" aria-live="polite"></p><div id="ability-picker-options" aria-label="Searchable abilities"></div>` : `<p class="notice">${catalog.config.banned.includes(source) ? 'This slot is excluded from ability randomization.' : `The ${kind === 'ability' ? 'ability' : 'innate'} randomizer is off in this save.`} ${kind === 'ability' ? 'You can equip any of the current choices above.' : 'This innate stays fixed.'}</p>`}</div>`;
    let drawFrame;
    document.body.append(dialog);
    dialog.addEventListener(
      'close',
      () => {
        cancelAnimationFrame(drawFrame);
        dialog.remove();
      },
      { once: true },
    );
    $('close-ability-picker').onclick = () => closeDialog(dialog);
    dialog.querySelectorAll('[data-equip-choice]').forEach(
      button =>
        (button.onclick = () => {
          const slot = +button.dataset.equipChoice;
          closeDialog(dialog);
          apply(
            () =>
              save.editMon(
                ref,
                { abilitySlot: slot },
                `Equip ability ${slot + 1} on ${m.nickname}`,
              ),
            'Equipped ability updated. Your search fields are preserved.',
          );
        }),
    );
    if (variable) {
      const filter = dialog.querySelector('#ability-picker-filter'),
        list = dialog.querySelector('#ability-picker-options'),
        count = dialog.querySelector('#ability-picker-count');
      const more = document.createElement('button');
      more.type = 'button';
      more.id = 'ability-picker-more';
      more.className = 'picker-more';
      more.textContent = 'Show more abilities';
      more.hidden = true;
      list.after(more);
      let matches = [],
        shown = 0;
      const append = () => {
        if (!dialog.hasAttribute('open')) return;
        const next = matches.slice(shown, shown + 40);
        shown += next.length;
        list.insertAdjacentHTML('beforeend', next.map(a => a.markup).join(''));
        count.textContent =
          shown < matches.length
            ? `Showing ${shown} of ${matches.length.toLocaleString()} abilities · Search covers the full list`
            : `${matches.length.toLocaleString()} searchable ${matches.length === 1 ? 'ability' : 'abilities'}`;
        more.hidden = shown >= matches.length;
      };
      const draw = () => {
        if (!dialog.hasAttribute('open')) return;
        const query = filter.value.trim().toLocaleLowerCase();
        matches = query ? pickerEntries.filter(a => matchesQuery(a.search, query)) : pickerEntries;
        shown = 0;
        list.replaceChildren();
        list.scrollTop = 0;
        append();
        if (!matches.length)
          list.innerHTML = '<p class="picker-help">No abilities match your search.</p>';
      };
      list.onclick = e => {
        const button = e.target.closest('[data-target-ability]');
        if (button) {
          const ability = catalog.abilities[+button.dataset.targetAbility],
            draft = searchDraft(),
            preferred = kind === 'ability' ? 0 : index + 1;
          const empty = draft.targets.findIndex(target => !target.trim()),
            field =
              draft.matchMode === 'any' && draft.targets[preferred].trim() && empty >= 0
                ? empty
                : preferred;
          draft.targets[field] = display(ability);
          closeDialog(dialog);
          resetSearch();
          tab = 'randomizer';
          render();
          if (!touchLayout()) $('target-' + field).focus();
          $('search-button').scrollIntoView({ block: 'center' });
          notify(`${ability.name} selected. Find combinations to apply it.`);
        }
      };
      filter.oninput = () => {
        cancelAnimationFrame(drawFrame);
        drawFrame = requestAnimationFrame(draw);
      };
      list.onscroll = () => {
        if (shown < matches.length && list.scrollHeight - list.scrollTop - list.clientHeight < 100)
          append();
      };
      more.onclick = append;
      // Let the modal open before creating its first small batch of options.
      drawFrame = requestAnimationFrame(draw);
    }
    showDialog(dialog);
    if (variable && !touchLayout()) $('ability-picker-filter').focus();
  }
  function heading(m, species = catalog.species[m.species]) {
    const r = ERRng.evaluate(species, m.pid, m.abilitySlot, options(), catalog.config);
    return `<div class="mon-heading"><div class="mon-identity">${pokemonIcon(species)}<div><h1>${html(m.nickname || species.name)} ${m.shiny ? '<span class="shiny-tag">Shiny</span>' : ''}</h1><p>${m.nickname && m.nickname !== species.name ? `${html(species.name)} · ` : ''}Lv. ${m.level} · ${ERRng.gender(catalog.species[m.species], m.pid)} · ${ref.kind === 'party' ? `Party slot ${ref.slot + 1}` : `${html(save.boxName(ref.box))}, slot ${ref.slot + 1}`}</p><div class="types">${typeTags(r.types)}</div></div></div><span class="pill">${html(catalog.natures[m.nature])} nature</span></div>`;
  }
  function sync() {
    $('undo-button').disabled = !save.undoStack.length || dirty;
    $('redo-button').disabled = !save.redoStack.length || dirty;
    $('export-button').disabled = !!save.damaged.length;
    const edits = save.history.length;
    $('export-button').textContent =
      `Export .${filename.toLowerCase().endsWith('.srm') ? 'srm' : 'sav'}${edits ? ` · ${edits} change${edits === 1 ? '' : 's'}` : ''}`;
    const n = save.changedBytes();
    $('change-count').textContent = edits;
    $('change-count').classList.toggle('has-changes', edits > 0);
    const t = save.trainer();
    $('save-meta').textContent =
      `Trainer ${t.name} · ${t.hours}h ${String(t.minutes).padStart(2, '0')}m · 128 KB · ${dirty ? 'Pending changes' : n ? `${n} bytes changed` : 'Original loaded'}`;
    $('health-banner').className = `health-banner${save.damaged.length ? ' bad' : ''}`;
    $('health-banner').innerHTML = save.damaged.length
      ? `<span>${save.damaged.length} section checksum(s) failed. Editing is disabled; restore a backup.</span>`
      : `<span>All 20 section checksums pass${save.invalidSlots().length ? `. ${save.invalidSlots().length} unrecognised Pokémon locked` : ''}</span><span class="secondary-text">Save counter ${save.counter} · Level cap ${save.cap()} · ${html(catalog.version)} catalog</span>`;
    const orphans = save.damaged.length ? [] : save.pokedex().orphans();
    if (orphans.length) {
      $('health-banner').classList.add('warn');
      $('health-banner').insertAdjacentHTML(
        'beforeend',
        `<span class="dex-orphans">Pokédex ${orphans.length === 1 ? 'number' : 'numbers'} ${orphans.slice(0, 5).join(', ')}${orphans.length > 5 ? '…' : ''} ${orphans.length === 1 ? 'is' : 'are'} marked but no Pokémon has ${orphans.length === 1 ? 'it' : 'them'}. The game shows ${orphans.length === 1 ? 'it' : 'them'} as a blank entry and counts ${orphans.length === 1 ? 'it' : 'them'} toward the 999 limit. <button type="button" id="fix-dex">Clear ${orphans.length === 1 ? 'it' : 'them'}</button></span>`,
      );
      $('fix-dex').onclick = () => {
        if (!guard()) return;
        apply(
          () => save.clearPokedexOrphans(),
          `Cleared ${orphans.length} Pokédex ${orphans.length === 1 ? 'number' : 'numbers'} the game can't show.`,
        );
      };
    }
    const seenTotal = save.damaged.length ? 0 : save.pokedex().counts().seen,
      limit = save.pokedex().limit;
    if (seenTotal > limit) {
      $('health-banner').classList.add('warn');
      $('health-banner').insertAdjacentHTML(
        'beforeend',
        `<span class="dex-orphans">${seenTotal.toLocaleString()} Pokémon are marked seen. The game's Pokédex crashes at 1,000 or more, because it can only draw three-digit totals. <button type="button" id="trim-dex">Unmark the highest ${seenTotal - limit} to keep ${limit}</button></span>`,
      );
      $('trim-dex').onclick = () => {
        if (!guard()) return;
        let removed = [];
        apply(() => (removed = save.trimPokedex()), `Pokédex trimmed to ${limit} seen.`);
        if (removed.length)
          notify(
            `Pokédex trimmed to ${limit} seen: unmarked #${removed[0]} to #${removed[removed.length - 1]}.`,
          );
      };
    }
  }
  // Text a roster entry can be found by: nickname, species name, base species (so "Absol" finds
  // "Absol Mega"), dex number and types.
  function rosterSearchText(m) {
    const s = catalog.species[m.species];
    if (!s) return `${m.nickname} #${m.species}`.toLocaleLowerCase();
    const types = [...new Set(s.types)].map(t => catalog.types[t]).join(' ');
    return `${m.nickname} ${s.name} ${ERCore.baseSpeciesName(catalog, s)} #${s.id} ${types}`.toLocaleLowerCase();
  }
  function locationLabel(r) {
    return r.kind === 'party'
      ? `Party slot ${r.slot + 1}`
      : `${save.boxName(r.box)}, slot ${r.slot + 1}`;
  }
  // On phones the roster folds into one button showing the selected Pokémon.
  let rosterOpen = false;
  function drawRosterToggle() {
    const m = mon(),
      sp = m?.species ? catalog.species[m.species] : null;
    $('roster-toggle').innerHTML =
      `<span>${sp ? `${html(m.nickname || sp.name)} <small>${html(locationLabel(ref))}</small>` : 'Choose a Pokémon'}</span><b>${rosterOpen ? 'Hide roster' : 'Change Pokémon'}</b>`;
    $('roster-toggle').setAttribute('aria-expanded', String(rosterOpen));
    document.querySelector('.roster').classList.toggle('is-open', rosterOpen);
  }
  function drawRoster() {
    drawRosterActions();
    drawRosterToggle();
    document
      .querySelectorAll('[data-roster]')
      .forEach(e => e.classList.toggle('active', e.dataset.roster === roster));
    $('box-controls').hidden = roster !== 'box';
    const query = $('roster-filter').value.trim().toLocaleLowerCase();
    const everywhere = !!query && $('roster-scope').checked;
    const all = everywhere
      ? save.allMons()
      : roster === 'party'
        ? save.party()
        : save.box(box).filter(m => m.species);
    const terms = query.split(/\s+/).filter(Boolean);
    const mons = all.filter(m => {
      const text = rosterSearchText(m);
      return terms.every(t =>
        /^#\d+$/.test(t) ? catalog.species[m.species]?.id === +t.slice(1) : text.includes(t),
      );
    });
    $('roster-count').textContent = everywhere
      ? `${mons.length} found`
      : query
        ? `${mons.length} of ${all.length}`
        : `${all.length} Pokémon`;
    $('roster-list').innerHTML = mons.length
      ? mons
          .map(m => {
            const s = catalog.species[m.species];
            const active =
              ref &&
              ref.kind === m.ref.kind &&
              ref.slot === m.ref.slot &&
              (m.ref.kind === 'party' || ref.box === m.ref.box);
            const detail = everywhere
              ? `${html(s?.name || `Species #${m.species}`)} · ${html(locationLabel(m.ref))}`
              : html(s?.name || `Species #${m.species}`);
            return `<button class="roster-item${active ? ' active' : ''}" data-kind="${m.ref.kind}" data-box="${m.ref.box ?? ''}" data-slot="${m.ref.slot}" aria-pressed="${active}">${pokemonIcon(s)}<span class="roster-name"><b>${html(m.nickname || s?.name || 'Unknown')} ${m.shiny ? '<span class="shiny-tag">Shiny</span>' : ''}</b><small>${detail}</small></span><span class="level">${m.level}</span></button>`;
          })
          .join('')
      : `<div class="empty-box">${
          query
            ? everywhere
              ? 'No Pokémon in your party or PC match that search.'
              : 'No matching Pokémon here. Tick “Search all boxes” to look everywhere.'
            : 'This box is empty.'
        }</div>`;
    $('roster-list')
      .querySelectorAll('[data-slot]')
      .forEach(
        e =>
          (e.onclick = () => {
            if (!guard(() => e.click())) return;
            resetSearch();
            ref =
              e.dataset.kind === 'party'
                ? { kind: 'party', slot: +e.dataset.slot }
                : { kind: 'box', box: +e.dataset.box, slot: +e.dataset.slot };
            if (!everywhere) {
              roster = ref.kind;
            } else if (ref.kind === 'box') {
              box = ref.box;
              $('box-select').value = String(box);
            }
            searchResults = [];
            rosterOpen = false;
            drawRoster();
            render();
          }),
      );
  }
  function bindDirty(form) {
    const mark = () => {
      dirty = true;
      form.classList.add('is-dirty');
      sync();
    };
    form.addEventListener('input', mark);
    form.addEventListener('change', mark);
    form.querySelectorAll('[data-discard]').forEach(b =>
      b.addEventListener('click', () => {
        dirty = false;
        render();
        sync();
      }),
    );
  }
  function apply(fn, message, { keepSearch = false } = {}) {
    try {
      rememberSearchDraft();
      fn();
      if (!keepSearch) resetSearch();
      dirty = false;
      sync();
      drawRoster();
      render();
      notify(message);
    } catch (e) {
      fail(e);
    }
  }
  function render() {
    document
      .querySelectorAll('[data-tab]')
      .forEach(e => e.classList.toggle('active', e.dataset.tab === tab));
    if (tab === 'settings') {
      renderSettings();
      bindCatalogPickers();
      return;
    }
    if (tab === 'review') {
      renderReview();
      return;
    }
    if (tab === 'trainer') {
      renderTrainer();
      return;
    }
    if (tab === 'progress') {
      renderProgress();
      return;
    }
    if (tab === 'finder') {
      renderFinder();
      return;
    }
    if (tab === 'story') {
      renderStory();
      return;
    }
    const m = mon();
    if (!m || !m.species) {
      $('editor-panel').innerHTML =
        '<div class="panel empty-box">Select a Pokémon from your roster.</div>';
      return;
    }
    try {
      save.assertMon(m);
    } catch (e) {
      $('editor-panel').innerHTML =
        `<div class="notice warning">${html(e.message)} Choose another Pokémon.</div>`;
      return;
    }
    if (tab === 'randomizer') renderRandomizer(m);
    else renderPokemon(m);
    bindCatalogPickers();
  }
  // ---- Species finder: every species that can roll a set of abilities ------------------------
  const finder = { targets: ['', '', '', ''], type: '', minTotal: 0, results: [], run: null };
  function finderSpecies() {
    const battleForms = new Set();
    for (const sp of Object.values(catalog.species))
      for (const f of sp.forms || []) battleForms.add(f);
    const type = finder.type === '' ? null : +finder.type;
    return Object.values(catalog.species).filter(
      sp =>
        sp.id > 0 &&
        !battleForms.has(sp.id) &&
        sp.abilities.some(Boolean) &&
        (type === null || sp.types.includes(type)) &&
        sp.base.reduce((s, n) => s + n, 0) >= finder.minTotal,
    );
  }
  function stopFinder() {
    const run = finder.run;
    if (!run) return;
    run.workers.forEach(w => w.terminate());
    URL.revokeObjectURL(run.url);
    run.busy = false;
    run.stopped = run.done < run.total;
  }
  function finderStatus() {
    const run = finder.run;
    if (!run || !$('finder-progress')) return;
    const seconds = ((run.busy ? performance.now() : run.ended) - run.started) / 1000;
    $('finder-progress').textContent =
      `${finder.results.length} species found · ${run.done} of ${run.total} ability layouts checked · ${seconds.toFixed(1)}s${run.busy ? ' · searching…' : run.stopped ? ' · stopped' : ' · complete'}`;
    $('finder-meter').hidden = !run.busy;
    $('finder-meter').value = run.total ? (run.done / run.total) * 100 : 100;
    $('finder-start').disabled = run.busy || !!save.damaged.length;
    $('finder-stop').hidden = !run.busy;
  }
  function drawFinderResults() {
    if (!$('finder-results')) return;
    const list = finder.results
      .slice()
      .sort((a, b) => a.species - b.species)
      .slice(0, 400);
    const name = id => html(catalog.abilities[id]?.name || `#${id}`);
    const wanted = new Set(finder.run?.targets || []);
    const mark = id => (wanted.has(id) ? `<b>${name(id)}</b>` : name(id));
    $('finder-results').innerHTML = list.length
      ? `<div class="result-heading"><h2>SPECIES THAT CAN HAVE THEM</h2><span>${finder.results.length.toLocaleString()} found${finder.results.length > 400 ? ' · showing the first 400' : ''}</span></div><div class="finder-list">${list
          .map(r => {
            const sp = catalog.species[r.species];
            return `<div class="finder-row">${pokemonIcon(sp)}<div class="finder-main"><b>${html(sp.name)}</b><small>#${html(sp.id)} · ${html(ERRng.gender(sp, r.pid))} · PID ${html(r.pid.toString(16).toUpperCase().padStart(8, '0'))}</small><div class="types">${typeTags(r.types)}</div></div><p class="finder-abilities">Ability ${html(r.slot + 1)}: ${mark(r.ability)}<br>Innates: ${r.innates.map(mark).join(', ')}</p><button type="button" data-finder-add="${html(r.species)}" ${save.damaged.length ? 'disabled' : ''}>Add…</button></div>`;
          })
          .join('')}</div>`
      : finder.run && !finder.run.busy && !finder.run.stopped
        ? '<p class="notice">No species can roll all of these together with the current randomizer settings.</p>'
        : '';
  }
  // Worker messages are not trusted for display: keep only the species, PID and slot
  // as checked numbers and recompute the abilities and types here.
  function trustedFinderResult(r) {
    const species = Number(r?.species),
      pid = Number(r?.pid),
      slot = Number(r?.slot);
    if (
      !Number.isInteger(species) ||
      !catalog.species[species] ||
      !Number.isInteger(pid) ||
      pid < 0 ||
      pid > 0xffffffff ||
      ![0, 1, 2].includes(slot)
    )
      return null;
    const result = ERRng.evaluate(
      catalog.species[species],
      pid,
      slot,
      finder.run.options,
      catalog.config,
    );
    const values = [result.ability, ...result.innates];
    const targets = finder.run.targets;
    if (targets.some(t => values.filter(v => v === t).length < targets.filter(x => x === t).length))
      return null;
    return { species, pid, slot, ...result };
  }
  let finderDrawTimer = 0;
  // Pages arrive once per layout; redraw at most a few times a second.
  function scheduleFinderDraw() {
    if (finderDrawTimer) return;
    finderDrawTimer = setTimeout(() => {
      finderDrawTimer = 0;
      drawFinderResults();
      finderStatus();
    }, 250);
  }
  function startFinder() {
    try {
      stopFinder();
      const opts = options();
      const targets = finder.targets.filter(t => t.trim()).map(t => resolve('abilities', t));
      if (!targets.length) throw new Error('Choose at least one ability or innate.');
      const groups = ERRng.groupLayouts(finderSpecies());
      if (!groups.length) throw new Error('No species match the type and stat filters.');
      const code =
        $('rng-code').textContent +
        `\nself.onmessage=async e=>{try{for await(const page of ERRng.findSpecies(e.data))self.postMessage({kind:'page',value:page});self.postMessage({kind:'end'});}catch(error){self.postMessage({kind:'error',message:error.message});}};`;
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      const count = Math.max(
        1,
        Math.min(8, (navigator.hardwareConcurrency || 4) - 1, groups.length),
      );
      const run = {
        targets,
        options: opts,
        url,
        workers: [],
        total: groups.length,
        done: 0,
        finished: 0,
        busy: true,
        stopped: false,
        started: performance.now(),
        ended: 0,
      };
      finder.run = run;
      finder.results = [];
      for (let i = 0; i < count; i++) {
        const worker = new Worker(url);
        worker.onmessage = e => {
          if (finder.run !== run) return;
          const data = e.data;
          if (data.kind === 'page') {
            run.done++;
            if (data.value.found.length) {
              finder.results.push(...data.value.found.map(trustedFinderResult).filter(Boolean));
              scheduleFinderDraw();
            }
          } else if (data.kind === 'end') {
            if (++run.finished === count) {
              run.busy = false;
              run.ended = performance.now();
              stopFinder();
            }
          } else {
            run.ended = performance.now();
            stopFinder();
            fail(new Error(data.message));
          }
          scheduleFinderDraw();
        };
        worker.onerror = e => {
          if (finder.run !== run) return;
          run.ended = performance.now();
          stopFinder();
          finderStatus();
          fail(new Error(e.message || 'Species search failed.'));
        };
        run.workers.push(worker);
        // Round-robin so every worker gets a similar mix of easy and hard layouts.
        worker.postMessage({
          groups: groups.filter((_, n) => n % count === i),
          options: opts,
          config: catalog.config,
          targets,
          pid: crypto.getRandomValues(new Uint32Array(1))[0],
        });
      }
      drawFinderResults();
      finderStatus();
    } catch (e) {
      fail(e);
    }
  }
  function renderFinder() {
    const opts = options(),
      on = opts.abilityRng || opts.innateRng;
    $('editor-panel').innerHTML =
      `<div class="page-heading"><h1>Species finder.</h1><p>Pick up to four abilities and innates and see every species that can have all of them at once, with a PID that does it.</p></div>${on ? `<p class="notice">Your save has the ${opts.abilityRng && opts.innateRng ? 'ability and innate randomizers' : opts.abilityRng ? 'ability randomizer' : 'innate randomizer'} on, so most species can roll most combinations. One or two abilities take seconds; three or four can take a few minutes, and results appear as they are found.</p>` : '<p class="notice">Ability and innate randomizers are off in this save, so this lists the species that have these abilities naturally.</p>'}
    <section class="panel"><div class="panel-heading"><h2>WHAT YOU WANT</h2><span>Any order · abilities and innates</span></div><div class="target-grid">${[0, 1, 2, 3].map(i => `<label class="field"><span>Ability ${i + 1}</span><input id="finder-target-${i}" list="list-abilities" placeholder="${i ? 'Optional' : 'Required'}" autocomplete="off"></label>`).join('')}</div>
    <div class="field-grid" style="margin-top:16px"><label class="field"><span>Type</span><select id="finder-type"><option value="">Any type</option>${catalog.types
      .map((t, i) =>
        t && !['None', '???', 'Mystery', 'Stellar'].includes(t)
          ? `<option value="${i}">${html(t)}</option>`
          : '',
      )
      .join(
        '',
      )}</select></label>${numberField('Minimum base stat total', 'finderMin', finder.minTotal, 0, 1000)}<span></span></div>
    <div class="search-control"><button id="finder-start" class="primary" ${save.damaged.length ? 'disabled' : ''}>Find species</button><button id="finder-stop" hidden>Stop</button></div><div class="search-progress" id="finder-progress" aria-live="polite"></div><progress id="finder-meter" max="100" value="0" hidden></progress></section><div id="finder-results"></div>`;
    finder.targets.forEach((t, i) => ($('finder-target-' + i).value = t));
    $('finder-type').value = finder.type;
    const minInput = document.querySelector('[name="finderMin"]');
    minInput.id = 'finder-min';
    for (let i = 0; i < 4; i++)
      $('finder-target-' + i).oninput = e => (finder.targets[i] = e.target.value);
    $('finder-type').onchange = e => (finder.type = e.target.value);
    minInput.oninput = e => (finder.minTotal = Math.max(0, Math.min(1000, +e.target.value || 0)));
    $('finder-start').onclick = startFinder;
    $('finder-stop').onclick = () => {
      if (finder.run) finder.run.ended = performance.now();
      stopFinder();
      finderStatus();
      drawFinderResults();
    };
    $('finder-results').onclick = e => {
      const button = e.target.closest('[data-finder-add]');
      if (!button) return;
      const r = finder.results.find(x => x.species === +button.dataset.finderAdd);
      if (r) openAddDialog({ species: r.species, pid: r.pid, abilitySlot: r.slot });
    };
    drawFinderResults();
    finderStatus();
  }
  // ---- Move details ----------------------------------------------------------------------------
  const openMoveDetails = new Set();
  const MOVE_CATEGORIES = [
    'Physical',
    'Special',
    'Status',
    'Uses the higher attacking stat',
    'Hits Defense',
    'Uses the stronger of Physical or Special',
    'Hits Special Defense',
  ];
  function moveDetails(move) {
    if (!move || !move.id) return '<p class="field-help">No move in this slot.</p>';
    const rows = [
      ['Type', typeTags(move.types)],
      ['Category', html(MOVE_CATEGORIES[move.split] || 'Unknown')],
      ['Power', move.power ? html(move.power) : 'None'],
      [
        'Accuracy',
        move.accuracy === undefined
          ? ''
          : move.accuracy
            ? `${html(move.accuracy)}%`
            : 'Never misses',
      ],
      ['PP', `${html(move.pp)} (up to ${html(ERCore.maxPP(move))} with PP Ups)`],
      [
        'Priority',
        move.priority === undefined
          ? ''
          : move.priority > 0
            ? `+${html(move.priority)}`
            : html(move.priority),
      ],
      ['Target', html(move.target || '')],
      ['Effect', move.effect && move.effect !== 'Hit' ? html(move.effect) : ''],
      [
        'Effect chance',
        move.chance && move.chance < 100
          ? `${html(move.chance)}%`
          : move.chance === 100 && move.effect && move.effect !== 'Hit'
            ? 'Always'
            : '',
      ],
    ].filter(([, value]) => value !== '');
    const flags = move.flags?.length
      ? `<p class="move-flags">${move.flags.map(f => `<span>${html(f)}</span>`).join('')}</p>`
      : '';
    const text = [move.longDescription, move.description].filter(Boolean);
    return `<dl class="move-facts">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>${flags}${text.map(t => `<p class="move-text">${html(t)}</p>`).join('')}${move.accuracy === undefined ? '<p class="field-help">Accuracy, priority and target are not in this game data profile.</p>' : ''}`;
  }
  function bindJumpLinks() {
    document.querySelectorAll('[data-jump]').forEach(
      b =>
        (b.onclick = () => {
          const target = $(b.dataset.jump);
          if (target.tagName === 'DETAILS') target.open = true;
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }),
    );
  }
  function heldItemText(id) {
    const item = catalog.items[id];
    if (!id || !item) return 'Not holding an item.';
    return `<b>${html(item.name)}</b>${item.desc ? `: ${html(item.desc)}` : ''}`;
  }
  function renderPokemon(m) {
    const s = catalog.species[m.species],
      stats = ERCore.calcStats(m, s, options(), options().difficulty === 3 && save.flag(2893));
    $('editor-panel').innerHTML =
      `${heading(m)}${monActions()}<nav class="jump-links" aria-label="Jump to a section"><button type="button" data-jump="pokemon-abilities">Abilities</button><button type="button" data-jump="identity-panel">Details</button><button type="button" data-jump="stats-panel">Stats & EVs</button><button type="button" data-jump="moves-panel">Moves</button><button type="button" data-jump="more-details">More details</button></nav><div class="ability-overview" id="pokemon-abilities">${abilityCards(m)}</div><form id="pokemon-form"><fieldset ${save.damaged.length ? 'disabled' : ''} style="border:0;padding:0;margin:0">
    <section class="panel" id="identity-panel"><div class="panel-heading"><h2>IDENTITY & DETAILS</h2><span>PID ${m.pid.toString(16).toUpperCase().padStart(8, '0')}</span></div><div class="field-grid">
    ${catalogField('Species', 'species', 'species', m.species)}<label class="field"><span>Nickname · up to 12 characters</span><input name="nickname" value="${html(m.nickname)}" maxlength="12" required></label>${numberField(`Level · current cap ${save.cap()}`, 'level', m.level, 1, 100)}
    ${selectField('Nature', 'nature', m.nature, catalog.natures)}${catalogField('Held item', 'heldItem', 'items', m.heldItem)}${selectField(
      'Equipped ability',
      'abilitySlot',
      m.abilitySlot,
      abilityChoices(s, m.pid).map(
        (id, i) => `Slot ${i + 1}: ${catalog.abilities[id]?.name || `#${id}`}`,
      ),
    )}
    ${numberField('Friendship', 'friendship', m.friendship, 0, 255)}${selectField('Poké Ball', 'ball', m.ball, ballNames())}${selectField('Shininess', 'shiny', m.shiny, ['Normal', 'Star shiny', 'Square shiny', 'Special palette'])}
    </div><p class="field-help" id="held-item-desc">${heldItemText(m.heldItem)}</p><p class="field-help">Species or PID changes can alter randomized abilities. Level changes write experience and refresh party stats.</p></section>
    ${ref.kind === 'party' ? conditionPanel(m) : ''}
    <div class="two-columns"><section class="panel" id="stats-panel"><div class="panel-heading"><h2>STATS & EVS</h2><span>IVs are fixed at 31 in Redux</span></div><table class="stat-table"><thead><tr><th>STAT</th><th>BASE</th><th></th><th>IV</th><th>EV</th><th>FINAL</th></tr></thead><tbody>${statLabels.map((label, i) => `<tr><td>${label}</td><td>${html(s.base[i])}</td><td><div class="stat-bar"><i style="width:${Math.min(100, s.base[i] / 2.55)}%"></i></div></td><td>${(options().difficulty === 3 && save.flag(2893)) || (i === 5 && m.speedDown) ? 0 : 31}</td><td><input type="number" name="ev${i}" aria-label="${label} EV" value="${m.evs[i]}" min="0" max="252" required></td><td>${stats[i]}</td></tr>`).join('')}</tbody></table><div class="form-footer"><span id="ev-total" class="ev-total">${m.evs.reduce((a, b) => a + b, 0)} / 510 EVs</span><div class="actions-inline"><button type="button" data-ev="physical">Physical</button><button type="button" data-ev="special">Special</button><button type="button" data-ev="reset">Clear</button></div></div><p class="field-help">EVs ${options().enableEvs ? 'enabled' : 'disabled in this save'}. Final stats are calculated for the current build. ${ref.kind === 'party' ? `HP ${m.hp}/${m.stats[0]}.` : 'Box Pokémon recalculate their stats when withdrawn.'}</p></section>
    <section class="panel" id="moves-panel"><div class="panel-heading"><h2>MOVESET</h2><span>${ref.kind === 'party' ? 'MOVE / CURRENT PP' : 'MOVE'}</span></div><div class="moves-list">${m.moves
      .map((id, i) => {
        const move = catalog.moves[id];
        return `<div class="move-row"><span class="ordinal">0${i + 1}</span><input name="move${i + 1}" list="list-moves" value="${html(display(move))}" autocomplete="off" aria-label="Move ${i + 1}" required>${ref.kind === 'party' ? `<input name="pp${i}" type="number" value="${m.pp[i]}" min="0" max="${html(ERCore.maxPP(move))}" aria-label="Move ${i + 1} PP" required>` : '<span></span>'}<div class="move-meta" id="move-meta-${i}">${typeTags(move.types)}<span>${move.power ? `${html(move.power)} power · ` : ''}${html(ERCore.maxPP(move))} max PP</span><button type="button" class="move-toggle" data-move-toggle="${i}" aria-expanded="${openMoveDetails.has(i)}" aria-controls="move-details-${i}">${openMoveDetails.has(i) ? 'Hide details' : 'Details'}</button></div></div><div class="move-details" id="move-details-${i}" ${openMoveDetails.has(i) ? '' : 'hidden'}>${moveDetails(move)}</div>`;
      })
      .join(
        '',
      )}</div><div class="form-footer"><p>All ${Object.keys(catalog.moves).length} moves, including IDs above 999.</p>${ref.kind === 'party' ? '<button type="button" id="max-pp">Restore PP</button>' : ''}</div></section></div>
    ${originPanel(m)}
    <div class="panel form-footer apply-bar"><p id="pending-note">Apply commits the whole Pokémon form. Ctrl+Z undoes it.</p><div class="actions-inline">${ref.kind === 'party' ? '<button type="button" id="heal-button">Heal Pokémon</button>' : ''}<button type="button" data-discard>Discard draft</button><button type="submit" class="primary">Apply Pokémon changes</button></div></div>
    </fieldset></form>`;
    bindMonActions(m);
    const form = $('pokemon-form');
    bindDirty(form);
    bindJumpLinks();
    $('more-details').addEventListener('toggle', e => (moreDetailsOpen = e.target.open));
    const evUpdate = () => {
      $('ev-total').textContent =
        `${statLabels.reduce((sum, _, i) => sum + (+form.elements[`ev${i}`].value || 0), 0)} / 510 EVs`;
    };
    form.querySelectorAll('[name^=ev]').forEach(e => e.addEventListener('input', evUpdate));
    form.querySelectorAll('[data-ev]').forEach(
      e =>
        (e.onclick = () => {
          const spread =
            e.dataset.ev === 'physical'
              ? [4, 252, 0, 0, 0, 252]
              : e.dataset.ev === 'special'
                ? [4, 0, 0, 252, 0, 252]
                : [0, 0, 0, 0, 0, 0];
          spread.forEach((n, i) => (form.elements[`ev${i}`].value = n));
          dirty = true;
          form.classList.add('is-dirty');
          evUpdate();
          sync();
        }),
    );
    for (let i = 0; i < 4; i++)
      form.elements[`move${i + 1}`].addEventListener('change', () => {
        try {
          const id = resolve('moves', form.elements[`move${i + 1}`].value),
            move = catalog.moves[id];
          const meta = $('move-meta-' + i),
            toggle = meta.querySelector('[data-move-toggle]');
          meta.innerHTML =
            typeTags(move.types) +
            `<span>${move.power ? `${html(move.power)} power · ` : ''}${html(ERCore.maxPP(move))} max PP</span>`;
          meta.append(toggle);
          $('move-details-' + i).innerHTML = moveDetails(move);
          if (ref.kind === 'party') {
            form.elements[`pp${i}`].max = ERCore.maxPP(move);
            form.elements[`pp${i}`].value = ERCore.maxPP(move);
          }
        } catch (e) {
          fail(e);
        }
      });
    form.elements.heldItem.addEventListener('change', () => {
      try {
        $('held-item-desc').innerHTML = heldItemText(
          resolve('items', form.elements.heldItem.value, true),
        );
      } catch {
        $('held-item-desc').textContent = '';
      }
    });
    form.querySelectorAll('[data-move-toggle]').forEach(button =>
      button.addEventListener('click', () => {
        const i = +button.dataset.moveToggle,
          panel = $('move-details-' + i),
          open = panel.hidden;
        panel.hidden = !open;
        button.textContent = open ? 'Hide details' : 'Details';
        button.setAttribute('aria-expanded', String(open));
        if (open) openMoveDetails.add(i);
        else openMoveDetails.delete(i);
      }),
    );
    $('max-pp')?.addEventListener('click', () => {
      try {
        for (let i = 0; i < 4; i++)
          form.elements[`pp${i}`].value = ERCore.maxPP(
            catalog.moves[resolve('moves', form.elements[`move${i + 1}`].value)],
          );
        dirty = true;
        sync();
      } catch (e) {
        fail(e);
      }
    });
    $('heal-button')?.addEventListener('click', () => {
      if (guard()) apply(() => save.heal(ref), 'Pokémon healed.');
    });
    form.onsubmit = e => {
      e.preventDefault();
      try {
        const get = name => form.elements[name].value,
          patch = {
            nickname: get('nickname'),
            species: resolve('species', get('species')),
            level: +get('level'),
            nature: +get('nature'),
            heldItem: resolve('items', get('heldItem')),
            abilitySlot: +get('abilitySlot'),
            friendship: +get('friendship'),
            ball: +get('ball'),
            shiny: +get('shiny'),
            hpType: +get('hpType'),
            metLevel: +get('metLevel'),
            egg: +form.elements.egg.checked,
            speedDown: +form.elements.speedDown.checked,
            evs: statLabels.map((_, i) => +get(`ev${i}`)),
          };
        if (patch.shiny !== m.shiny) patch.maxShiny = Math.max(m.maxShiny, patch.shiny);
        Object.assign(patch, originPatch(form, m));
        if (ref.kind === 'party') Object.assign(patch, conditionPatch(form, m));
        for (let i = 0; i < 4; i++) patch[`move${i + 1}`] = resolve('moves', get(`move${i + 1}`));
        if (ref.kind === 'party') patch.pp = m.moves.map((_, i) => +get(`pp${i}`));
        apply(
          () =>
            save.editMon(
              ref,
              patch,
              `Edit ${m.nickname || s.name} (${ref.kind === 'party' ? 'party' : `box ${ref.box + 1}`}, slot ${ref.slot + 1})`,
            ),
          'Pokémon changes applied.',
        );
      } catch (error) {
        fail(error);
      }
    };
  }
  // ---- Trainer & origin fields --------------------------------------------------------------
  const MARKINGS = ['●', '■', '▲', '♥'];
  const STATUS_CHOICES = [
    ['none', 'Healthy'],
    ['sleep', 'Asleep'],
    ['poison', 'Poisoned'],
    ['toxic', 'Badly poisoned'],
    ['burn', 'Burned'],
    ['freeze', 'Frozen'],
    ['paralysis', 'Paralyzed'],
    ['frostbite', 'Frostbite'],
    ['bleed', 'Bleeding'],
  ];
  function statusKey(value) {
    if (!value) return 'none';
    if (value & 7) return 'sleep';
    const flag = value & ~0xf00;
    for (const [k] of STATUS_CHOICES) if (ERCore.STATUS[k] === flag) return k;
    return 'keep';
  }
  function statusValue(key, current) {
    if (key === 'keep') return current;
    if (key === 'sleep') return current & 7 ? current & 7 : 3;
    return ERCore.STATUS[key];
  }
  function languageField(value) {
    return `<label class="field"><span>Language</span><select name="language">${Object.entries(
      ERCore.LANGUAGES,
    )
      .map(
        ([id, name]) =>
          `<option value="${id}"${+id === value ? ' selected' : ''}>${html(name)}</option>`,
      )
      .join(
        '',
      )}${ERCore.LANGUAGES[value] ? '' : `<option value="${value}" selected>Unknown (${value})</option>`}</select></label>`;
  }
  let moreDetailsOpen = false;
  function originPanel(m) {
    return `<details class="panel more-details" id="more-details" ${moreDetailsOpen ? 'open' : ''}><summary class="panel-heading"><h2>MORE DETAILS</h2><span>Original trainer, origin, Hidden Power, markings</span></summary><div class="field-grid">
    ${selectField('Hidden Power type', 'hpType', m.hpType, [...catalog.types, 'None'])}${numberField('Met level', 'metLevel', m.metLevel, 0, 100)}<span></span>
    <label class="field"><span>OT name · up to 7 characters</span><input name="otName" value="${html(m.otName)}" maxlength="7" required></label>${numberField('OT trainer ID', 'otTid', m.otid & 0xffff, 0, 65535)}${numberField('OT secret ID', 'otSid', m.otid >>> 16, 0, 65535)}
    ${selectField('OT gender', 'otGender', m.otGender, ['Male', 'Female'])}${numberField('Met location ID', 'metLocation', m.metLocation, 0, 255)}${languageField(m.language)}
    </div><div class="checkrow"><span class="check-label">Markings</span>${MARKINGS.map((mk, i) => `<label><input name="mark${i}" type="checkbox" ${(m.markings >> i) & 1 ? 'checked' : ''}> ${mk}</label>`).join('')}<label><input name="alpha" type="checkbox" ${m.alpha ? 'checked' : ''}> Alpha</label><label><input name="eventMon" type="checkbox" ${m.eventMon ? 'checked' : ''}> Fateful encounter</label><label><input name="egg" type="checkbox" ${m.egg ? 'checked' : ''}> Egg</label><label><input name="speedDown" type="checkbox" ${m.speedDown ? 'checked' : ''}> Zero Speed IV</label></div><p class="field-help">Your trainer: ${html(save.trainerCard().name)} · ID ${save.trainerCard().tid} / ${save.trainerCard().sid}. Changing the OT name or ID makes the game treat this Pokémon as traded, and one with a different OT may disobey at high levels.</p></details>`;
  }
  function conditionPanel(m) {
    const key = statusKey(m.status);
    return `<section class="panel"><div class="panel-heading"><h2>CONDITION</h2><span>Party only</span></div><div class="field-grid">${numberField(`Current HP · max ${m.stats[0]}`, 'hp', m.hp, 0, m.stats[0])}<label class="field"><span>Status condition</span><select name="status">${key === 'keep' ? `<option value="keep" selected>Other (0x${m.status.toString(16)})</option>` : ''}${STATUS_CHOICES.map(([k, l]) => `<option value="${k}"${k === key ? ' selected' : ''}>${l}</option>`).join('')}</select></label></div><p class="field-help">A Pokémon at 0 HP is fainted. Level, species, nature or EV changes rescale HP automatically.</p></section>`;
  }
  function wholeNumber(value, label, min, max) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max)
      throw new Error(`${label} must be a whole number from ${min} to ${max}.`);
    return n;
  }
  function originPatch(form, m) {
    const get = n => form.elements[n].value,
      tid = wholeNumber(get('otTid'), 'OT trainer ID', 0, 65535),
      sid = wholeNumber(get('otSid'), 'OT secret ID', 0, 65535);
    return {
      otName: get('otName'),
      otid: ((sid << 16) | tid) >>> 0,
      otGender: +get('otGender'),
      metLocation: wholeNumber(get('metLocation'), 'Met location', 0, 255),
      language: +get('language'),
      markings: MARKINGS.reduce(
        (sum, _, i) => sum | (form.elements[`mark${i}`].checked ? 1 << i : 0),
        0,
      ),
      alpha: +form.elements.alpha.checked,
      eventMon: +form.elements.eventMon.checked,
    };
  }
  function conditionPatch(form, m) {
    const patch = {},
      hp = wholeNumber(form.elements.hp.value, 'Current HP', 0, 65535),
      status = statusValue(form.elements.status.value, m.status);
    if (hp !== m.hp) patch.hp = hp;
    if (status !== m.status) patch.status = status;
    return patch;
  }
  // ---- Generic dialog ----------------------------------------------------------------------
  function openDialog(title, subtitle, body) {
    const dialog = document.createElement('dialog');
    dialog.className = 'tool-dialog';
    dialog.setAttribute('aria-labelledby', 'tool-dialog-title');
    dialog.innerHTML = `<div class="dialog-head"><div><h2 id="tool-dialog-title"></h2>${subtitle ? '<p class="dialog-sub"></p>' : ''}</div><button type="button" class="icon-button" data-close>Close</button></div><div class="dialog-body">${body}</div>`;
    dialog.querySelector('h2').textContent = title;
    if (subtitle) dialog.querySelector('.dialog-sub').textContent = subtitle;
    document.body.append(dialog);
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    dialog.querySelectorAll('[data-close]').forEach(b => (b.onclick = () => closeDialog(dialog)));
    bindCatalogPickers(dialog);
    dialog.addEventListener('click', e => {
      const chooser = e.target.closest('[data-catalog-input]');
      if (chooser)
        openCatalogPicker(dialog.querySelector('#' + CSS.escape(chooser.dataset.catalogInput)));
    });
    showDialog(dialog);
    return dialog;
  }
  // ---- Destination picker (party / box + slot) ---------------------------------------------
  function slotLabel(target) {
    const m = save.mon(target);
    return m.species
      ? `${m.nickname || catalog.species[m.species]?.name || 'Pokémon'} (${catalog.species[m.species]?.name || '#' + m.species})`
      : 'empty';
  }
  function destinationFields(defaultTarget, { allowOccupied = false, exclude = null } = {}) {
    return `<div class="field-grid two-up"><label class="field"><span>Destination</span><select data-dest-where><option value="party">Party</option>${Array.from({ length: 26 }, (_, b) => `<option value="${b}">${html(save.boxName(b))} · ${save.box(b).filter(m => m.species).length}/30</option>`).join('')}</select></label><label class="field"><span>Slot</span><select data-dest-slot></select></label></div>`;
  }
  function bindDestination(dialog, defaultTarget, { allowOccupied = false, exclude = null } = {}) {
    const where = dialog.querySelector('[data-dest-where]'),
      slot = dialog.querySelector('[data-dest-slot]');
    const same = (a, b) =>
      a && b && a.kind === b.kind && a.slot === b.slot && (a.kind === 'party' || a.box === b.box);
    const fill = preferred => {
      const party = where.value === 'party',
        count = party ? Math.min(6, save.partyCount + 1) : 30;
      let firstFree = -1;
      slot.innerHTML = Array.from({ length: count }, (_, i) => {
        const target = party
            ? { kind: 'party', slot: i }
            : { kind: 'box', box: +where.value, slot: i },
          occupied = party ? i < save.partyCount : !!save.mon(target).species;
        const disabled = same(target, exclude) || (occupied && !allowOccupied);
        if (!occupied && firstFree < 0 && !disabled) firstFree = i;
        return `<option value="${i}"${disabled ? ' disabled' : ''}>Slot ${i + 1} · ${occupied ? html(slotLabel(target)) + (allowOccupied && !same(target, exclude) ? ' (swap)' : '') : 'empty'}</option>`;
      }).join('');
      const pick =
        preferred !== undefined && !slot.options[preferred]?.disabled
          ? preferred
          : firstFree >= 0
            ? firstFree
            : [...slot.options].findIndex(o => !o.disabled);
      slot.value = String(Math.max(0, pick));
    };
    where.value = defaultTarget.kind === 'party' ? 'party' : String(defaultTarget.box);
    fill(defaultTarget.slot);
    where.onchange = () => fill();
    return () => {
      if (slot.selectedOptions[0]?.disabled || !slot.options.length)
        throw new Error('Choose an available slot.');
      return where.value === 'party'
        ? { kind: 'party', slot: +slot.value }
        : { kind: 'box', box: +where.value, slot: +slot.value };
    };
  }
  function defaultDestination() {
    if (save.partyCount < 6 && roster === 'party') return { kind: 'party', slot: save.partyCount };
    return (
      save.firstEmptyBox(roster === 'box' ? box : 0) || {
        kind: 'box',
        box: roster === 'box' ? box : 0,
        slot: 0,
      }
    );
  }
  function selectTarget(target) {
    ref = target;
    roster = target.kind;
    if (target.kind === 'box') {
      box = target.box;
      $('box-select').value = String(box);
    }
  }
  function refreshBoxSelect() {
    $('box-select').innerHTML = Array.from(
      { length: 26 },
      (_, i) =>
        `<option value="${i}">${html(save.boxName(i))} · ${save.box(i).filter(m => m.species).length}/30</option>`,
    ).join('');
    $('box-select').value = String(box);
  }
  function applyStructural(fn, message) {
    try {
      rememberSearchDraft();
      const target = fn();
      resetSearch();
      if (target) selectTarget(target);
      else if (ref && !save.occupied(ref)) ref = null;
      if (!ref) {
        const mons = roster === 'party' ? save.party() : save.box(box).filter(m => m.species);
        ref = mons[0]?.ref || null;
      }
      refreshBoxSelect();
      dirty = false;
      sync();
      drawRoster();
      render();
      notify(message);
    } catch (e) {
      fail(e);
    }
  }
  // ---- Pokémon actions ----------------------------------------------------------------------
  function monActions() {
    return `<div class="mon-actions" role="toolbar" aria-label="Pokémon actions"><button type="button" id="move-mon">Move or swap…</button><button type="button" id="duplicate-mon">Duplicate</button><button type="button" id="export-mon">Copy Showdown set</button><button type="button" id="release-mon" class="danger">Release…</button></div>`;
  }
  function bindMonActions(m) {
    const disabled = !!save.damaged.length;
    document.querySelectorAll('.mon-actions button').forEach(b => (b.disabled = disabled));
    $('move-mon').onclick = () => {
      if (guard()) openMoveDialog(m);
    };
    $('duplicate-mon').onclick = () => {
      if (guard())
        applyStructural(
          () => save.duplicateMon(ref, { kind: 'box', box: roster === 'box' ? box : 0 }),
          `${m.nickname} duplicated into the first free PC slot.`,
        );
    };
    $('export-mon').onclick = () => openExportDialog(m);
    $('release-mon').onclick = () => {
      if (guard()) openReleaseDialog(m);
    };
  }
  function openMoveDialog(m) {
    const from = { ...ref },
      dialog = openDialog(
        'Move or swap',
        `${m.nickname} · ${from.kind === 'party' ? `Party slot ${from.slot + 1}` : `${save.boxName(from.box)}, slot ${from.slot + 1}`}`,
        `${destinationFields()}<p class="field-help">Choosing an occupied slot swaps the two Pokémon. Pokémon moved into the party are fully healed, as when withdrawn in-game.</p><div class="form-footer"><span></span><div class="actions-inline"><button type="button" data-close>Cancel</button><button type="button" class="primary" data-confirm>Move</button></div></div>`,
      );
    const read = bindDestination(
      dialog,
      from.kind === 'party'
        ? save.firstEmptyBox(0) || { kind: 'box', box: 0 }
        : save.partyCount < 6
          ? { kind: 'party', slot: save.partyCount }
          : { kind: 'party', slot: 0 },
      { allowOccupied: true, exclude: from },
    );
    dialog.querySelector('[data-confirm]').onclick = () => {
      try {
        const to = read();
        closeDialog(dialog);
        applyStructural(() => save.moveMon(from, to), `${m.nickname} moved.`);
      } catch (e) {
        fail(e);
      }
    };
  }
  function openReleaseDialog(m) {
    const dialog = openDialog(
      `Release ${m.nickname}?`,
      'This removes the Pokémon from your save. Undo can bring it back until you close the editor.',
      `<div class="form-footer"><span></span><div class="actions-inline"><button type="button" data-close>Keep it</button><button type="button" class="primary danger-fill" data-confirm>Release</button></div></div>`,
    );
    dialog.querySelector('[data-confirm]').onclick = () => {
      closeDialog(dialog);
      applyStructural(() => {
        save.deleteMon(ref);
        return null;
      }, `${m.nickname} released.`);
    };
  }
  function currentAbilityName(m) {
    const s = catalog.species[m.species],
      id = abilityChoices(s, m.pid)[m.abilitySlot];
    return catalog.abilities[id]?.name;
  }
  function openExportDialog(m) {
    const text = ERCore.toShowdown(m, catalog, currentAbilityName(m));
    const dialog = openDialog(
      'Showdown set',
      'Paste into Pokémon Showdown, a team builder, or another save.',
      `<textarea class="set-text" readonly rows="10" aria-label="Showdown set"></textarea><div class="form-footer"><p>IVs are fixed at 31 in Elite Redux.</p><div class="actions-inline"><button type="button" data-close>Close</button><button type="button" class="primary" data-copy>Copy</button></div></div>`,
    );
    const area = dialog.querySelector('textarea');
    area.value = text;
    dialog.querySelector('[data-copy]').onclick = async () => {
      try {
        await navigator.clipboard.writeText(text);
        notify('Showdown set copied.');
      } catch {
        area.select();
        document.execCommand?.('copy');
        notify('Set selected. Press Ctrl+C to copy it.');
      }
    };
  }
  // ---- Adding Pokémon -----------------------------------------------------------------------
  function suggestedMoves(species) {
    const moves = (species.learnset || [])
      .map(id => catalog.moves[id])
      .filter(mv => mv && mv.id && !mv.banned && (mv.power || 0) < 200);
    const types = new Set(species.types),
      score = mv => (mv.power || 0) * (mv.types.some(t => types.has(t)) ? 1.5 : 1);
    const picked = [...moves]
      .sort((a, b) => score(b) - score(a))
      .slice(0, 4)
      .map(mv => mv.id);
    return picked.length ? picked : [1];
  }
  function openAddDialog(found = null) {
    if (!guard()) return;
    const cap = save.cap(),
      start = found ? found.species : catalog.species[150] ? 150 : +Object.keys(catalog.species)[0];
    const dialog = openDialog(
      'Add a Pokémon',
      'Creates a new Pokémon with you as its original trainer.',
      `<div class="tab-switch" role="tablist"><button type="button" role="tab" class="active" data-mode="new">Build</button><button type="button" role="tab" data-mode="import">Paste Showdown set</button></div>
    <form data-pane="new" class="add-form"><div class="field-grid two-up"><label class="field"><span>Species</span><input name="species" list="list-species" value="${html(display(catalog.species[start]))}" autocomplete="off" required></label>${numberField(`Level · cap ${cap}`, 'level', Math.min(cap, 50), 1, 100)}
    <label class="field"><span>Nature</span><select name="nature"><option value="random">Random</option>${catalog.natures.map((n, i) => `<option value="${i}">${html(n)}</option>`).join('')}</select></label>${selectField('Shininess', 'shiny', 0, ['Normal', 'Star shiny', 'Square shiny', 'Special palette'])}</div>
    ${found ? '<p class="field-help" data-found-note></p>' : ''}<p class="section-label">Moves · suggested from its learnset</p><div class="field-grid two-up">${[0, 1, 2, 3].map(i => `<label class="field"><span>Move ${i + 1}</span><input name="move${i}" list="list-moves" autocomplete="off" placeholder="Empty"></label>`).join('')}</div></form>
    <div data-pane="import" hidden><textarea class="set-text" rows="9" placeholder="Garchomp @ Life Orb&#10;Ability: Sand Force&#10;Level: 100&#10;EVs: 252 Atk / 4 SpD / 252 Spe&#10;Jolly Nature&#10;- Earthquake&#10;- Dragon Claw" aria-label="Showdown set"></textarea><p class="field-help" data-import-help>Species, item, level, EVs, nature, shininess, happiness and moves are imported. Abilities come from the PID: if the requested ability is not one of the new Pokémon’s choices, the Ability lab opens with it filled in.</p></div>
    <p class="section-label">Where should it go?</p>${destinationFields()}<div class="form-footer"><span></span><div class="actions-inline"><button type="button" data-close>Cancel</button><button type="button" class="primary" data-confirm>Add Pokémon</button></div></div>`,
    );
    const form = dialog.querySelector('form'),
      read = bindDestination(dialog, defaultDestination());
    let mode = 'new',
      movesEdited = false;
    const fillMoves = () => {
      if (movesEdited) return;
      try {
        const sp = catalog.species[resolve('species', form.elements.species.value)];
        suggestedMoves(sp)
          .concat([0, 0, 0, 0])
          .slice(0, 4)
          .forEach(
            (id, i) => (form.elements[`move${i}`].value = id ? display(catalog.moves[id]) : ''),
          );
      } catch {}
    };
    fillMoves();
    form.elements.species.addEventListener('change', fillMoves);
    const usesFound = () => {
      try {
        return !!found && resolve('species', form.elements.species.value) === found.species;
      } catch {
        return false;
      }
    };
    const foundNote = () => {
      const note = dialog.querySelector('[data-found-note]');
      if (!note) return;
      if (!usesFound()) {
        note.textContent = 'Species changed, so this Pokémon gets a random PID instead.';
        return;
      }
      const r = ERRng.evaluate(
        catalog.species[found.species],
        found.pid,
        found.abilitySlot,
        options(),
        catalog.config,
      );
      note.textContent = `Uses PID ${found.pid.toString(16).toUpperCase().padStart(8, '0')} from the species finder: ${catalog.abilities[r.ability]?.name} with ${r.innates.map(id => catalog.abilities[id]?.name).join(', ')}.`;
    };
    foundNote();
    form.elements.species.addEventListener('input', foundNote);
    for (let i = 0; i < 4; i++)
      form.elements[`move${i}`].addEventListener('input', () => (movesEdited = true));
    dialog.querySelectorAll('[data-mode]').forEach(
      b =>
        (b.onclick = () => {
          mode = b.dataset.mode;
          dialog
            .querySelectorAll('[data-mode]')
            .forEach(x => x.classList.toggle('active', x === b));
          dialog.querySelectorAll('[data-pane]').forEach(p => (p.hidden = p.dataset.pane !== mode));
        }),
    );
    dialog.querySelector('[data-confirm]').onclick = () => {
      try {
        const target = read();
        if (mode === 'new') {
          const level = wholeNumber(form.elements.level.value, 'Level', 1, 100),
            natureValue = form.elements.nature.value;
          const moves = [0, 1, 2, 3]
            .map(i =>
              form.elements[`move${i}`].value.trim()
                ? resolve('moves', form.elements[`move${i}`].value)
                : 0,
            )
            .filter(Boolean);
          const options = {
            species: resolve('species', form.elements.species.value),
            level,
            moves,
            shiny: +form.elements.shiny.value,
          };
          if (usesFound())
            Object.assign(options, { pid: found.pid, abilitySlot: found.abilitySlot });
          if (natureValue !== 'random') options.nature = +natureValue;
          closeDialog(dialog);
          applyStructural(
            () => save.createMon(target, options, `Add ${catalog.species[options.species].name}`),
            `${catalog.species[options.species].name} added.`,
          );
        } else importSet(dialog, target);
      } catch (e) {
        fail(e);
      }
    };
  }
  // Fills empty PC slots with one Pokémon of each chosen species, as one undoable edit.
  // Mega and Primal forms, picked one by one. They normally exist only in battle, so the
  // dialog says so; they share their base Pokémon's Pokédex entry.
  function openMegaDialog() {
    if (!guard(() => openMegaDialog())) return;
    const cap = save.cap(),
      kindOf = sp => (/_PRIMAL(_|$)/.test(sp.key) ? 'primal' : 'mega');
    const forms = Object.values(catalog.species)
      .filter(sp => sp.id > 0 && /_(MEGA|PRIMAL)(_|$)/.test(sp.key))
      .map(sp => ({
        ...sp,
        no: ERCore.dexNumber(catalog, sp.id),
        kind: kindOf(sp),
        base: ERCore.baseSpeciesName(catalog, sp),
      }))
      .sort((a, b) => a.no - b.no || a.id - b.id);
    const owned = new Set(save.allMons().map(m => m.species)),
      selected = new Set(),
      view = { text: '', kind: 'all', hideOwned: true };
    let free = 0;
    for (let b = 0; b < 26; b++) free += save.box(b).filter(m => !m.species).length;
    const dialog = openDialog(
      'Mega and Primal forms',
      'Tick the forms you want; each goes into an empty PC slot, with you as the original trainer.',
      `<form class="bulk-form mega-form"><p class="notice warning">Mega and Primal forms normally exist only during battle. Stored as themselves they stay in that form outside battle; test a few in the game before relying on them.</p>
      <label class="field"><span>Search</span><input name="q" type="search" placeholder="For example Charizard, Primal or Cascoon" autocomplete="off" autocapitalize="none" spellcheck="false"></label>
      <div class="pocket-chips" data-mega-kind role="group" aria-label="Form kind"></div>
      <div class="checkrow"><label><input type="checkbox" name="hideOwned" checked> Hide forms already in your party or PC</label></div>
      <div class="actions-inline bag-bulk"><button type="button" data-mega-all>Select shown</button><button type="button" data-mega-none>Clear selection</button></div>
      <div class="bag-grid mega-grid" data-mega-list></div>
      <div class="field-grid two-up">${numberField(`Level · cap ${cap}`, 'level', Math.min(cap, 50), 1, 100)}<label class="field"><span>Start in box</span><select name="box">${Array.from({ length: 26 }, (_, b) => `<option value="${b}">${html(save.boxName(b))} · ${save.box(b).filter(m => m.species).length}/30</option>`).join('')}</select></label><label class="field"><span>Nature</span><select name="nature"><option value="random">Random for each</option>${catalog.natures.map((n, i) => `<option value="${i}">${html(n)}</option>`).join('')}</select></label></div>
      <div class="checkrow"><label><input type="checkbox" name="recordDex" checked> Record their base Pokémon in the Pokédex (up to the 999 seen the game can show)</label></div>
      <p class="field-help" data-mega-preview aria-live="polite"></p></form>
      <div class="form-footer"><span></span><div class="actions-inline"><button type="button" data-close>Cancel</button><button type="button" class="primary" data-confirm>Add selected</button></div></div>`,
    );
    const form = dialog.querySelector('form');
    const shown = () => {
      const q = view.text.trim().toLocaleLowerCase();
      return forms.filter(
        sp =>
          (view.kind === 'all' || sp.kind === view.kind) &&
          !(view.hideOwned && owned.has(sp.id)) &&
          (!q || matchesQuery(`${sp.name} ${sp.base} ${sp.no} ${sp.kind}`.toLocaleLowerCase(), q)),
      );
    };
    const preview = () => {
      const n = selected.size;
      dialog.querySelector('[data-mega-preview]').textContent = n
        ? `${n} selected · ${free} empty PC slot${free === 1 ? '' : 's'}${n > free ? ` · only the first ${free} fit` : ''}.`
        : `Nothing selected yet · ${free} empty PC slot${free === 1 ? '' : 's'}.`;
      dialog.querySelector('[data-confirm]').disabled = !n || !free;
    };
    const draw = () => {
      const counts = {
        all: forms.length,
        mega: forms.filter(sp => sp.kind === 'mega').length,
        primal: forms.filter(sp => sp.kind === 'primal').length,
      };
      dialog.querySelector('[data-mega-kind]').innerHTML = [
        ['all', 'All'],
        ['mega', 'Mega'],
        ['primal', 'Primal'],
      ]
        .map(
          ([key, label]) =>
            `<button type="button" data-kind="${key}" aria-pressed="${key === view.kind}">${label} <small>${counts[key]}</small></button>`,
        )
        .join('');
      const list = shown();
      dialog.querySelector('[data-mega-list]').innerHTML = list.length
        ? list
            .map(
              sp =>
                `<label class="bag-item${selected.has(sp.id) ? ' changed' : ''}"><input type="checkbox" data-mega="${sp.id}" ${selected.has(sp.id) ? 'checked' : ''}><span>${html(sp.name)}${owned.has(sp.id) ? ' <span class="mode-tag">Owned</span>' : ''}</span><small>#${sp.no}</small></label>`,
            )
            .join('')
        : '<p class="field-help">No forms match.</p>';
      preview();
    };
    form.elements.q.oninput = e => {
      view.text = e.target.value;
      draw();
    };
    form.elements.hideOwned.onchange = e => {
      view.hideOwned = e.target.checked;
      draw();
    };
    dialog.querySelector('[data-mega-kind]').onclick = e => {
      const chip = e.target.closest('[data-kind]');
      if (!chip) return;
      view.kind = chip.dataset.kind;
      draw();
    };
    dialog.querySelector('[data-mega-list]').onchange = e => {
      const box = e.target.closest('[data-mega]');
      if (!box) return;
      if (box.checked) selected.add(+box.dataset.mega);
      else selected.delete(+box.dataset.mega);
      box.closest('.bag-item').classList.toggle('changed', box.checked);
      preview();
    };
    dialog.querySelector('[data-mega-all]').onclick = () => {
      shown().forEach(sp => selected.add(sp.id));
      draw();
    };
    dialog.querySelector('[data-mega-none]').onclick = () => {
      selected.clear();
      draw();
    };
    form.onsubmit = e => e.preventDefault();
    draw();
    dialog.querySelector('[data-confirm]').onclick = () => {
      try {
        const level = wholeNumber(form.elements.level.value, 'Level', 1, 100),
          nature = form.elements.nature.value,
          list = forms
            .filter(sp => selected.has(sp.id))
            .slice(0, free)
            .map(sp => ({
              species: sp.id,
              level,
              moves: suggestedMoves(sp),
              ...(nature === 'random' ? {} : { nature: +nature }),
            }));
        closeDialog(dialog);
        applyStructural(
          () => {
            save.createMany(
              list,
              { startBox: +form.elements.box.value, recordDex: form.elements.recordDex.checked },
              `Add ${list.length} Mega and Primal form${list.length === 1 ? '' : 's'}`,
            );
            return { kind: 'box', box: +form.elements.box.value, slot: 0 };
          },
          `${list.length} Mega and Primal form${list.length === 1 ? '' : 's'} added to your PC. Undo removes them all.`,
        );
      } catch (e) {
        fail(e);
      }
    };
  }
  function openBulkAddDialog(source = 'caught') {
    if (!guard(() => openBulkAddDialog(source))) return;
    const entries = dexEntries(),
      dex = save.pokedex(),
      cap = save.cap();
    const caughtCount = entries.filter(sp => dex.caught(sp.no)).length;
    // Final stages: species with no ordinary evolution left (Eevee gives all eight
    // Eeveelutions, Gloom both Vileplume and Bellossom). Imported profiles may lack the data.
    const hasEvolutions = entries.some(sp => sp.evolves);
    const isFinal = sp => !sp.evolves?.length;
    const finalCount = entries.filter(isFinal).length;
    const maxNo = entries.length ? entries[entries.length - 1].no : 1;
    // Forms have no Pokédex entry of their own (Primal Cascoon is Cascoon's #268), so they
    // are listed apart: Redux, regional and other variants, and battle forms.
    const shownIds = new Set(entries.map(sp => sp.id)),
      battleForm = sp => /_(MEGA|PRIMAL)(_|$)/.test(sp.key),
      forms = Object.values(catalog.species)
        .filter(sp => sp.id > 0 && !shownIds.has(sp.id))
        .map(sp => ({ ...sp, no: ERCore.dexNumber(catalog, sp.id), form: true }))
        .filter(sp => sp.no > 0)
        .sort((a, b) => a.no - b.no || a.id - b.id),
      variants = forms.filter(sp => !battleForm(sp)),
      battleForms = forms.filter(battleForm),
      everything = [...entries, ...forms].sort((a, b) => a.no - b.no || a.id - b.id);
    const dialog = openDialog(
      'Add many Pokémon',
      'Puts one of each species into the empty slots of your PC, with you as the original trainer.',
      `<form class="bulk-form"><div class="field-grid two-up"><label class="field"><span>Species</span><select name="source"><option value="caught">Marked caught in your Pokédex (${caughtCount})</option><option value="all">Every species (${entries.length})</option>${hasEvolutions ? `<option value="final">Every final evolution (${finalCount})</option>` : ''}${variants.length ? `<option value="variants">Redux, regional and other forms (${variants.length})</option>` : ''}${battleForms.length ? `<option value="battle">Mega and Primal forms (${battleForms.length})</option>` : ''}${forms.length ? `<option value="everything">Every species and form (${everything.length})</option>` : ''}</select></label>${numberField(`Level · cap ${cap}`, 'level', Math.min(cap, 50), 1, 100)}${numberField('From Pokédex number', 'from', 1, 1, maxNo)}${numberField('To Pokédex number', 'to', maxNo, 1, maxNo)}<label class="field"><span>Start in box</span><select name="box">${Array.from({ length: 26 }, (_, b) => `<option value="${b}">${html(save.boxName(b))} · ${save.box(b).filter(m => m.species).length}/30</option>`).join('')}</select></label><label class="field"><span>Nature</span><select name="nature"><option value="random">Random for each</option>${catalog.natures.map((n, i) => `<option value="${i}">${html(n)}</option>`).join('')}</select></label></div>
      <div class="checkrow"><label><input type="checkbox" name="skipOwned" checked> Skip species already in your party or PC</label><label><input type="checkbox" name="recordDex" checked> Record them in the Pokédex (up to the 999 seen the game can show)</label></div>
      <p class="field-help" data-bulk-preview></p><p class="field-help" data-bulk-battle hidden>Mega and Primal forms normally exist only during battle. Stored as themselves they stay in that form; the game may not expect it everywhere, so test before relying on them.</p><p class="field-help">Moves are picked from each species' learnset, as Add Pokémon suggests. Abilities come from each new PID, so use the Ability lab to change them afterwards. Undo removes them all in one step.</p></form>
      <div class="form-footer"><span></span><div class="actions-inline"><button type="button" data-close>Cancel</button><button type="button" class="primary" data-confirm>Add Pokémon</button></div></div>`,
    );
    const form = dialog.querySelector('form');
    form.elements.source.value = source === 'final' && !hasEvolutions ? 'all' : source;
    let free = 0;
    for (let b = 0; b < 26; b++) free += save.box(b).filter(m => !m.species).length;
    const owned = new Set(
      save
        .allMons()
        .map(m => ERCore.baseSpeciesName(catalog, catalog.species[m.species] || {}) || m.species),
    );
    const ownedIds = new Set(save.allMons().map(m => m.species));
    const pool = source =>
      ({ variants, battle: battleForms, everything })[source] ||
      entries.filter(sp =>
        source === 'all' ? true : source === 'final' ? isFinal(sp) : dex.caught(sp.no),
      );
    const chosen = () => {
      const from = +form.elements.from.value || 1,
        to = +form.elements.to.value || maxNo;
      return pool(form.elements.source.value).filter(
        sp =>
          sp.no >= Math.min(from, to) &&
          sp.no <= Math.max(from, to) &&
          !(
            form.elements.skipOwned.checked && (sp.form ? ownedIds.has(sp.id) : owned.has(sp.name))
          ),
      );
    };
    const seenNow = dex.counts().seen;
    const dexNote = adds => {
      if (!form.elements.recordDex.checked) return ' The Pokédex is left as it is.';
      const unseen = new Set(
        chosen()
          .slice(0, adds)
          .filter(sp => !dex.seen(sp.no))
          .map(sp => sp.no),
      ).size;
      const room = Math.max(0, dex.limit - seenNow);
      return unseen > room
        ? ` Only ${room} more fit in the Pokédex (${dex.limit} seen is the most the game can show), so ${unseen - room} won't be recorded there.`
        : unseen
          ? ` Pokédex: ${seenNow + unseen} seen afterwards.`
          : '';
    };
    const preview = () => {
      dialog.querySelector('[data-bulk-battle]').hidden = !['battle', 'everything'].includes(
        form.elements.source.value,
      );
      const n = chosen().length,
        adds = Math.min(n, free);
      dialog.querySelector('[data-bulk-preview]').textContent = n
        ? `${n} species selected · ${free} empty PC slot${free === 1 ? '' : 's'} · adds ${adds}${n > free ? ` (the first ${adds} by Pokédex number; the rest don't fit)` : ''}.${dexNote(adds)}`
        : 'No species match. Mark species caught in the Pokédex (Progress tab), choose Every species, or widen the number range.';
      dialog.querySelector('[data-confirm]').disabled = !adds;
    };
    form.addEventListener('input', preview);
    form.addEventListener('change', preview);
    preview();
    dialog.querySelector('[data-confirm]').onclick = () => {
      try {
        const level = wholeNumber(form.elements.level.value, 'Level', 1, 100),
          nature = form.elements.nature.value,
          list = chosen()
            .slice(0, free)
            .map(sp => ({
              species: sp.id,
              level,
              moves: suggestedMoves(sp),
              ...(nature === 'random' ? {} : { nature: +nature }),
            }));
        closeDialog(dialog);
        let added = 0;
        applyStructural(() => {
          added = save.createMany(
            list,
            { startBox: +form.elements.box.value, recordDex: form.elements.recordDex.checked },
            `Add ${list.length} Pokémon to the PC`,
          );
          return { kind: 'box', box: +form.elements.box.value, slot: 0 };
        }, `${list.length} Pokémon added to your PC. Undo removes them all.`);
        if (added && added < list.length) notify(`${added} added; the PC is full.`, true);
        else if (save.lastPokedexSkipped?.length)
          notify(
            `${added} added. ${save.lastPokedexSkipped.length} of them weren't recorded in the Pokédex: it already has ${save.pokedex().limit} seen, the most the game can show.`,
            true,
          );
      } catch (e) {
        fail(e);
      }
    };
  }
  function importSet(dialog, target) {
    const set = ERCore.parseShowdown(
        dialog.querySelector('[data-pane="import"] textarea').value,
        catalog,
      ),
      species = catalog.species[set.species];
    const pid = crypto.getRandomValues(new Uint32Array(1))[0];
    let abilitySlot = 0,
      abilityNote = '';
    if (set.ability) {
      const choices = abilityChoices(species, pid);
      const slot = choices.indexOf(set.ability);
      if (slot >= 0) abilitySlot = slot;
      else abilityNote = set.ability;
    }
    const options = {
      species: set.species,
      level: set.level ?? 50,
      moves: set.moves,
      pid,
      abilitySlot,
      evs: set.evs,
      heldItem: set.heldItem,
      shiny: set.shiny,
      friendship: set.friendship,
      nature: set.nature,
      nickname: set.nickname,
    };
    closeDialog(dialog);
    let placed;
    applyStructural(
      () => {
        placed = save.createMon(
          target,
          { ...options, speedDown: set.speedDown },
          `Import ${species.name}`,
        );
        return placed;
      },
      `${species.name} imported.${set.warnings.length ? ' ' + set.warnings.join(' ') : ''}`,
    );
    if (placed && abilityNote) {
      const draft = searchDraft();
      draft.targets = [display(catalog.abilities[abilityNote]), '', '', ''];
      draft.matchMode = 'any';
      tab = 'randomizer';
      render();
      notify(
        `${species.name} imported. ${catalog.abilities[abilityNote].name} is not one of its current choices, so the Ability lab is ready to search for it.`,
      );
    }
  }
  // ---- Roster actions -----------------------------------------------------------------------
  function drawRosterActions() {
    const off = !!save.damaged.length;
    $('roster-actions').innerHTML =
      `<button type="button" id="add-mon" ${off ? 'disabled' : ''}>＋ Add Pokémon</button><button type="button" id="add-many" ${off ? 'disabled' : ''}>Add many…</button><button type="button" id="add-megas" ${off ? 'disabled' : ''}>Megas & Primals…</button>${roster === 'party' ? `<button type="button" id="heal-party" ${off ? 'disabled' : ''}>Heal party</button><button type="button" id="friendship-party" ${off ? 'disabled' : ''}>Max friendship</button>` : ''}`;
    $('add-mon').onclick = () => openAddDialog();
    $('add-many').onclick = () => openBulkAddDialog();
    $('add-megas').onclick = () => openMegaDialog();
    $('heal-party')?.addEventListener('click', () => {
      if (guard()) apply(() => save.healParty(), 'Party healed: full HP, PP and no status.');
    });
    $('friendship-party')?.addEventListener('click', () => {
      if (guard()) apply(() => save.maxFriendshipParty(), 'Party friendship set to 255.');
    });
  }
  // ---- Trainer & bag tab --------------------------------------------------------------------
  let boxesOpen = false;
  let bagDraft = new Map(),
    bagFilter = { text: '', owned: 'all', group: 'all' };
  // Bag pockets come from the game's item data; imported profiles without it fall back
  // to guessing from the name.
  function itemGroup(item) {
    if (item.pocket) return item.pocket;
    const n = item.name;
    if (/^(TM|HM)\d/.test(n)) return 'tm';
    if (/ Ball$/.test(n)) return 'ball';
    if (/ Berry$/.test(n)) return 'berry';
    if (/ite( [XYZ])?$/.test(n) && !/^(Meteorite|Odd Keystone)$/.test(n)) return 'mega';
    return 'other';
  }
  const ITEM_POCKETS = {
    all: 'All pockets',
    items: 'Items',
    medicine: 'Medicine',
    ball: 'Poké Balls',
    battle: 'Battle items',
    berry: 'Berries',
    tm: 'TMs & HMs',
    mega: 'Mega Stones',
    key: 'Key items',
  };
  const ITEM_GROUPS_GUESSED = {
    all: 'All items',
    ball: 'Poké Balls',
    berry: 'Berries',
    tm: 'TMs & HMs',
    mega: 'Mega Stones & Z',
    other: 'Everything else',
  };
  const itemGroups = () =>
    Object.values(catalog.items).some(i => i.pocket) ? ITEM_POCKETS : ITEM_GROUPS_GUESSED;
  function bagItems() {
    return Object.values(catalog.items)
      .filter(i => i.id > 0 && i.id < 2048 && i.name && !/^\?+$/.test(i.name) && i.name !== 'None')
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  function renderTrainer() {
    if (!(bagFilter.group in itemGroups())) bagFilter.group = 'all';
    const t = save.trainerCard(),
      money = save.money(),
      bp = save.battlePoints(),
      storage = save.storage(),
      off = save.damaged.length ? 'disabled' : '';
    $('editor-panel').innerHTML =
      `<div class="page-heading"><h1>Trainer, money and bag.</h1><p>Your trainer card, PC box names and every item in your bag.</p></div>
    <form id="trainer-form"><fieldset ${off} class="plain"><section class="panel"><div class="panel-heading"><h2>TRAINER CARD</h2><span>Shown on the trainer card and as OT on Pokémon you catch</span></div><div class="field-grid">
    <label class="field"><span>Name · up to 7 characters</span><input name="name" value="${html(t.name)}" maxlength="7" required></label>${selectField('Gender', 'gender', t.gender, ['Male', 'Female'])}<span></span>
    ${numberField('Trainer ID', 'tid', t.tid, 0, 65535)}${numberField('Secret ID', 'sid', t.sid, 0, 65535)}<span></span>
    ${numberField('Play time · hours', 'hours', t.hours, 0, 999)}${numberField('Minutes', 'minutes', t.minutes, 0, 59)}${numberField('Seconds', 'seconds', t.seconds, 0, 59)}
    </div><div class="checkrow"><label><input name="updateOwned" type="checkbox" checked> Also update the OT on Pokémon I caught, so they stay mine and keep obeying</label></div>
    <div class="form-footer"><p>If you change your name or IDs without updating your Pokémon, high-level ones may stop obeying you.</p><div class="actions-inline"><button type="button" data-discard>Discard</button><button type="submit" class="primary">Apply trainer card</button></div></div></section></fieldset></form>
    ${money.supported ? `<form id="money-form"><fieldset ${off} class="plain"><section class="panel"><div class="panel-heading"><h2>MONEY & POINTS</h2><span>Max ¥999,999 · 9,999 coins · 9,999 BP</span></div><div class="field-grid">${numberField('Money (¥)', 'money', money.money, 0, 999999)}${numberField('Game Corner coins', 'coins', money.coins, 0, 9999)}${bp.supported ? numberField('Battle Points (BP)', 'battlePoints', bp.battlePoints, 0, 9999) + numberField('Trainer card BP (total earned)', 'cardBattlePoints', bp.cardBattlePoints, 0, 9999) : ''}</div><div class="form-footer"><p>Adding Battle Points also adds them to the trainer card total, unless you change that total yourself.</p><div class="actions-inline"><button type="button" data-discard>Discard</button><button type="submit" class="primary">Apply money & points</button></div></div></section></fieldset></form>` : '<p class="notice warning">Money could not be read safely from this save, so money editing is turned off.</p>'}
    <form id="boxes-form"><fieldset ${off} class="plain"><details class="panel" id="boxes-panel" ${boxesOpen ? 'open' : ''}><summary class="panel-heading"><h2>PC BOXES</h2><span>Box names, wallpapers and the box the PC opens on</span></summary><div class="field-grid" style="margin-bottom:16px">${selectField(
      'Box shown when the PC opens',
      'currentBox',
      storage.currentBox,
      Array.from({ length: 26 }, (_, b) => save.boxName(b)),
    )}</div><div class="box-name-grid">${Array.from({ length: 26 }, (_, b) => `<div class="box-name-cell"><label class="field"><span>Box ${b + 1} · ${save.box(b).filter(m => m.species).length}/30</span><input name="box${b}" value="${html(save.boxName(b))}" maxlength="8"></label><label class="field"><span>Wallpaper</span><select name="wall${b}">${storage.wallpapers[b] >= WALLPAPER_NAMES.length ? `<option value="${storage.wallpapers[b]}" selected>Special (${storage.wallpapers[b]})</option>` : ''}${WALLPAPER_NAMES.map((w, i) => `<option value="${i}"${i === storage.wallpapers[b] ? ' selected' : ''}>${w}</option>`).join('')}</select></label></div>`).join('')}</div><div class="form-footer"><p>Names use the game's character set.</p><div class="actions-inline"><button type="button" data-discard>Discard</button><button type="submit" class="primary">Apply PC boxes</button></div></div></details></fieldset></form>
    <section class="panel" id="bag-panel"><div class="panel-heading"><h2>BAG</h2><span id="bag-count"></span></div><p class="notice">Elite Redux bags hold each item once with unlimited uses, so an item is simply owned or not. Key items and HMs can unlock story areas early; add them with care.</p>
    <div class="bag-tools"><label class="field"><span>Search items</span><input id="bag-search" type="search" value="${html(bagFilter.text)}" placeholder="Name or ID" autocomplete="off"></label><label class="field"><span>Show</span><select id="bag-owned"><option value="all">Owned and not owned</option><option value="owned">Owned only</option><option value="missing">Not owned</option></select></label></div>
    <div class="pocket-chips" id="bag-pockets" role="group" aria-label="Bag pocket"></div>
    <div class="actions-inline bag-bulk"><button type="button" id="bag-all" ${off}>Own all shown</button><button type="button" id="bag-none" ${off}>Remove all shown</button></div>
    <div id="bag-list" class="bag-grid"></div><div class="form-footer"><p id="bag-pending">No pending bag changes.</p><div class="actions-inline"><button type="button" id="bag-discard">Discard</button><button type="button" class="primary" id="bag-apply" data-dirty-apply ${off}>Apply bag changes</button></div></div></section>`;
    const tf = $('trainer-form');
    bindDirty(tf);
    tf.onsubmit = e => {
      e.preventDefault();
      try {
        const g = n => tf.elements[n].value;
        const patch = {
          name: g('name'),
          gender: +g('gender'),
          tid: wholeNumber(g('tid'), 'Trainer ID', 0, 65535),
          sid: wholeNumber(g('sid'), 'Secret ID', 0, 65535),
          hours: wholeNumber(g('hours'), 'Hours', 0, 999),
          minutes: wholeNumber(g('minutes'), 'Minutes', 0, 59),
          seconds: wholeNumber(g('seconds'), 'Seconds', 0, 59),
        };
        apply(
          () => save.editTrainer(patch, { updateOwned: tf.elements.updateOwned.checked }),
          'Trainer card updated.',
        );
      } catch (err) {
        fail(err);
      }
    };
    const mf = $('money-form');
    if (mf) {
      bindDirty(mf);
      mf.onsubmit = e => {
        e.preventDefault();
        try {
          const patch = {
              money: wholeNumber(mf.elements.money.value, 'Money', 0, 999999),
              coins: wholeNumber(mf.elements.coins.value, 'Coins', 0, 9999),
            },
            points = mf.elements.battlePoints
              ? wholeNumber(mf.elements.battlePoints.value, 'Battle Points', 0, 9999)
              : null;
          let card = mf.elements.cardBattlePoints
            ? wholeNumber(mf.elements.cardBattlePoints.value, 'Trainer card BP', 0, 9999)
            : null;
          // BP added here counts as earned on the trainer card too, unless that was edited.
          const before = save.battlePoints();
          if (points !== null && card === before.cardBattlePoints && points > before.battlePoints)
            card = Math.min(9999, card + points - before.battlePoints);
          apply(() => {
            save.editMoney(patch);
            if (points !== null && points !== save.battlePoints().battlePoints)
              save.editBattlePoints(points);
            if (card !== null && card !== save.battlePoints().cardBattlePoints)
              save.editCardBattlePoints(card);
          }, 'Money and points updated.');
        } catch (err) {
          fail(err);
        }
      };
    }
    const bf = $('boxes-form');
    bindDirty(bf);
    $('boxes-panel').addEventListener('toggle', e => (boxesOpen = e.target.open));
    bf.onsubmit = e => {
      e.preventDefault();
      apply(() => {
        save.editBoxNames(Array.from({ length: 26 }, (_, b) => bf.elements[`box${b}`].value));
        const wallpapers = Array.from({ length: 26 }, (_, b) => +bf.elements[`wall${b}`].value),
          currentBox = +bf.elements.currentBox.value,
          cur = save.storage();
        if (currentBox !== cur.currentBox || wallpapers.some((w, i) => w !== cur.wallpapers[i]))
          save.editStorage({ currentBox, wallpapers });
        refreshBoxSelect();
      }, 'PC boxes updated.');
    };
    $('bag-owned').value = bagFilter.owned;
    const items = bagItems(),
      owned = new Set(save.ownedItems());
    const isOwned = id => (bagDraft.has(id) ? bagDraft.get(id) : owned.has(id));
    const shown = () => {
      const q = bagFilter.text.trim().toLocaleLowerCase();
      return items.filter(
        i =>
          (bagFilter.group === 'all' || itemGroup(i) === bagFilter.group) &&
          (!q || `${i.name} ${i.id}`.toLocaleLowerCase().includes(q)) &&
          (bagFilter.owned === 'all' || (bagFilter.owned === 'owned') === !!isOwned(i.id)),
      );
    };
    const pending = () => {
      dirty = bagDraft.size > 0;
      $('bag-panel').classList.toggle('is-dirty', dirty);
      sync();
      $('bag-pending').textContent = bagDraft.size
        ? `${bagDraft.size} pending item change${bagDraft.size === 1 ? '' : 's'} · apply to save them`
        : 'No pending bag changes.';
      $('bag-count').textContent =
        `${items.filter(i => isOwned(i.id)).length} of ${items.length} items owned`;
      drawPockets();
    };
    const drawPockets = () => {
      $('bag-pockets').innerHTML = Object.entries(itemGroups())
        .map(([key, label]) => {
          const inPocket = key === 'all' ? items : items.filter(i => itemGroup(i) === key);
          const have = inPocket.filter(i => isOwned(i.id)).length;
          return `<button type="button" data-pocket="${key}" aria-pressed="${key === bagFilter.group}">${html(label)} <small>${have}/${inPocket.length}</small></button>`;
        })
        .join('');
    };
    $('bag-pockets').onclick = e => {
      const chip = e.target.closest('[data-pocket]');
      if (!chip) return;
      bagFilter.group = chip.dataset.pocket;
      drawBag();
    };
    const drawBag = () => {
      const list = shown();
      $('bag-list').innerHTML = list.length
        ? list
            .map(
              i =>
                `<label class="bag-item${bagDraft.has(i.id) ? ' changed' : ''}"${i.desc ? ` title="${html(i.desc)}"` : ''}><input type="checkbox" data-item="${i.id}" ${isOwned(i.id) ? 'checked' : ''} ${off}><span>${html(i.name)}</span><small>#${i.id}</small></label>`,
            )
            .join('')
        : '<p class="field-help">No items match.</p>';
      pending();
    };
    const setItem = (id, value) => {
      if (!!owned.has(id) === value) bagDraft.delete(id);
      else bagDraft.set(id, value);
    };
    $('bag-list').onchange = e => {
      const box = e.target.closest('[data-item]');
      if (!box) return;
      setItem(+box.dataset.item, box.checked);
      box.parentElement.classList.toggle('changed', bagDraft.has(+box.dataset.item));
      pending();
    };
    $('bag-search').oninput = e => {
      bagFilter.text = e.target.value;
      drawBag();
    };
    $('bag-owned').onchange = e => {
      bagFilter.owned = e.target.value;
      drawBag();
    };
    $('bag-all').onclick = () => {
      shown().forEach(i => setItem(i.id, true));
      drawBag();
    };
    $('bag-none').onclick = () => {
      shown().forEach(i => setItem(i.id, false));
      drawBag();
    };
    $('bag-discard').onclick = () => {
      bagDraft.clear();
      dirty = false;
      drawBag();
    };
    $('bag-apply').onclick = () => {
      if (!bagDraft.size) {
        notify('No bag changes to apply.');
        return;
      }
      const changes = Object.fromEntries(bagDraft);
      const n = bagDraft.size;
      apply(
        () => {
          save.editItems(changes);
          bagDraft.clear();
        },
        `${n} bag item${n === 1 ? '' : 's'} updated.`,
      );
    };
    drawBag();
  }
  // ---- Story tab: badges, gym leaders, Champion, and story flags and variables ---------------
  // Milestones replay the game's own event scripts (bundled from the Elite Redux source by
  // scripts/story.cjs), so a save ends up as if the event had played.
  const story = JSON.parse($('story-data').textContent);
  const storyFlagName = new Map(Object.entries(story.flags).map(([n, id]) => [id, n]));
  const storyVarName = new Map(Object.entries(story.vars).map(([n, id]) => [id, n]));
  const flagDraft = new Map(),
    varDraft = new Map();
  let storyFilter = { text: '', kind: 'vars', show: 'all', group: 'all' };
  // Switches the game sets only for a moment or a mode (Safari Zone, Cycling Road, debug
  // menu, nuzlocke runs), plus Battle Frontier symbols, unused badge slots and daily resets.
  // Turned on together they change how the game plays and looks, so bulk "Set all" skips them.
  const MODE_FLAG =
    /^FLAG_(SYS_(NO_|PC_FROM_DEBUG|AUTOWIN|MGBA|DISABLE_|LOCKED_MODE|DETECTOR_MODE|WEATHER_CTRL|CYCLING_ROAD|SAFARI_MODE|CRUISE_MODE|INVERSE_BATTLE|CTRL_OBJ_DELETE|RESET_RTC_ENABLE|DEBUG|UPPED_DIFFICULTY|FRONTIER_PASS|(TOWER|DOME|PALACE|ARENA|FACTORY|PIKE|PYRAMID)_(SILVER|GOLD)|OPEN_MOVE_MENU|USE_FLASH|USE_STRENGTH|DEXNAV_SEARCH|MYSTERY_(GIFT|EVENT)_ENABLE)|BADGE(09|1[0-6])_GET|DEBUG_|NUZLOCKE_|LOST_NUZLOCKE|PREVENT_|AUTOMATIC_SEASON|PERMANENT_UNCHANGEABLE_WEATHER|LEVEL_UP_FROM_PARTY_SCREEN|TOTEM_BATTLE|SHINY_CREATION|ALPHA_CREATION|FORCE_|NEVER_SET|DAILY_)/;
  const isMode = n => MODE_FLAG.test(n);
  // Flag groups by the game's naming, so bulk changes can target one kind of flag.
  const FLAG_GROUPS = {
    all: ['All flags', () => true],
    visited: ['Places visited (Fly destinations)', n => /^FLAG_(VISITED|LANDMARK)_/.test(n)],
    received: ['Gifts received', n => /^FLAG_RECEIVED_/.test(n)],
    defeated: ['Defeated trainers and Pokémon', n => /^FLAG_DEFEATED_/.test(n)],
    items: ['Items picked up (visible and hidden)', n => /^FLAG_(ITEM|HIDDEN_ITEM)_/.test(n)],
    system: ['Game features and badges', n => /^FLAG_(SYS|BADGE)/.test(n) && !isMode(n)],
    hide: ['Characters and objects shown or hidden', n => /^FLAG_(HIDE|SHOW)_/.test(n)],
    modes: ['Game modes, debug, Battle Frontier and daily switches', isMode],
    other: [
      'Everything else',
      n =>
        !isMode(n) &&
        !/^FLAG_(VISITED_|LANDMARK_|RECEIVED_|DEFEATED_|ITEM_|HIDDEN_ITEM_|SYS|BADGE|HIDE_|SHOW_)/.test(
          n,
        ),
    ],
  };
  const prettyName = name =>
    name
      .replace(/^(FLAG|VAR)_/, '')
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  const SKIPPED_TEXT = {
    SetChampionSaveWarp: 'Where Continue starts: you keep playing from where you saved.',
    UpdateTrainerFanClubGameClear: 'The Trainer Fan Club’s post-game update.',
    ResetHealLocationFromDewford: 'Where you return after a whiteout.',
  };
  const SCREEN_ONLY =
    /^(special (DrawWholeMapView|PetalburgGymUnlockRoomDoors)|warp|givecustommon)\b/;
  function storyState() {
    return {
      flag: id => save.flag(id),
      getVar: id => save.getVar(id - story.varsStart),
      hasItem: id => save.hasItem(id),
      gender: save.trainerCard().gender,
    };
  }
  // VAR_FACING only decides which way a character walks in Norman's scene.
  const replayEvent = (entry, start = []) =>
    ERStory.replay(story, entry, storyState(), { start, assume: { VAR_FACING: 2 } });
  const planOf = (r, withGifts) => ({
    flags: [...r.flags],
    vars: [...r.vars],
    items: [...r.items],
    gifts: withGifts ? r.gifts : [],
  });
  function giftLabel(g) {
    const sp = catalog.species[g.species];
    return `${sp ? sp.name : g.name} (Lv. ${g.level || 'party max'}${g.shiny ? ', shiny' : ''})`;
  }
  function freeSlots() {
    let n = 6 - save.partyCount;
    for (let b = 0; b < 26; b++) n += save.box(b).filter(m => !m.species).length;
    return n;
  }
  function describeEvent(r, extraNotSaved = []) {
    const change = [
      ...[...r.flags].map(
        ([id, on]) =>
          `${on ? 'Set' : 'Clear'} ${prettyName(storyFlagName.get(id) || `flag ${id}`)}`,
      ),
      ...[...r.vars].map(
        ([id, n]) =>
          `${prettyName(storyVarName.get(id) || `variable ${id}`)}: ${save.getVar(id - story.varsStart)} → ${n}`,
      ),
    ];
    const notSaved = [
      ...new Set(
        r.skipped
          .filter(text => !SCREEN_ONLY.test(text))
          .map(text => {
            const name = /^special (\w+)/.exec(text)?.[1];
            return SKIPPED_TEXT[name] || `Game routine ${name || text} (not reproduced).`;
          }),
      ),
      ...extraNotSaved,
    ];
    return `<p class="field-help">${change.length} event flag and story variable change${change.length === 1 ? '' : 's'}${r.items.size ? ` · items: ${[...r.items].map(id => html(catalog.items[id]?.name || `#${id}`)).join(', ')}` : ''}.</p>${change.length ? `<details class="story-changes"><summary>Show every change</summary><ul>${change.map(c => `<li>${html(c)}</li>`).join('')}</ul></details>` : ''}${notSaved.length ? `<p class="field-help">Not changed by the editor: ${notSaved.map(html).join(' ')}</p>` : ''}`;
  }
  function confirmStoryEvent(
    title,
    intro,
    r,
    onApply,
    { extraNotSaved = [], extraGifts = [] } = {},
  ) {
    const gifts = [...extraGifts, ...r.gifts];
    const room = freeSlots();
    const dialog = openDialog(
      title,
      intro,
      `${describeEvent(r, extraNotSaved)}${gifts.length ? `<label class="checkrow story-gift"><input type="checkbox" data-gifts ${room >= gifts.length ? 'checked' : 'disabled'}> Also receive the gift Pokémon: ${gifts.map(giftLabel).map(html).join(', ')}${room < gifts.length ? ' (no room in your party or PC)' : ''}</label>` : ''}<div class="form-footer"><span></span><div class="actions-inline"><button type="button" data-close>Cancel</button><button type="button" class="primary" data-confirm>Apply</button></div></div>`,
    );
    dialog.querySelector('[data-confirm]').onclick = () => {
      const withGifts = !!dialog.querySelector('[data-gifts]')?.checked;
      closeDialog(dialog);
      onApply(withGifts);
    };
  }
  function beatLeader(g) {
    if (!guard(() => beatLeader(g))) return;
    let r;
    try {
      r = replayEvent(g.entry);
    } catch (e) {
      fail(e);
      return;
    }
    confirmStoryEvent(
      `Beat ${g.leader}`,
      `Applies what winning at the ${g.city} Gym does in the game: the ${g.badge}, the gym's defeated flag, its prizes and the story changes that follow.`,
      r,
      withGifts =>
        applyStructural(() => {
          save.applyStory(planOf(r, withGifts), `Beat ${g.leader} (${g.badge})`);
        }, `${g.leader} beaten. ${g.badge} earned.`),
    );
  }
  function becomeChampion() {
    if (!guard(becomeChampion)) return;
    const missing = story.gyms.filter(g => !save.flag(g.gymFlag));
    let r;
    try {
      r = replayEvent(story.champion.entry, story.champion.before);
    } catch (e) {
      fail(e);
      return;
    }
    const gymGifts = [];
    try {
      // Preview the gifts of the gyms that would be beaten first (each gym's own gift only).
      for (const g of missing) gymGifts.push(...replayEvent(g.entry).gifts);
    } catch {}
    confirmStoryEvent(
      'Become Champion',
      `Applies the Hall of Fame: Champion status, the game-clear flag the post-game checks, and the story changes the game makes when the credits roll.${missing.length ? ` First beats the ${missing.length} gym leader${missing.length === 1 ? '' : 's'} you haven't beaten (${missing.map(g => g.leader).join(', ')}), as Beat leader would.` : ''}`,
      r,
      withGifts =>
        applyStructural(() => {
          save.transact('Become Champion', () => {
            for (const g of missing)
              save.applyStory(planOf(replayEvent(g.entry), withGifts), `Beat ${g.leader}`);
            const champ = replayEvent(story.champion.entry, story.champion.before);
            const plan = planOf(champ, withGifts);
            plan.flags.push([story.champion.gameClear, 1], [story.champion.isChampion, 1]);
            plan.champion = true;
            save.applyStory(plan, 'Become Champion');
          });
        }, 'You are now the Champion. The post-game is unlocked.'),
      {
        extraGifts: gymGifts,
        extraNotSaved: [
          'Hall of Fame team records (the trainer card still shows a Hall of Fame entry).',
          'Champion Ribbons.',
        ],
      },
    );
  }
  function renderStory() {
    const off = save.damaged.length ? 'disabled' : '',
      cleared = save.flag(story.champion.gameClear),
      badges = story.gyms.filter(g => save.flag(g.badgeFlag)).length;
    $('editor-panel').innerHTML =
      `<div class="page-heading"><h1>Story and league.</h1><p>Badges, gym leaders and the Champion, replayed from the game's own event scripts, plus every story flag and variable.</p></div>
    <section class="panel" id="league-panel"><div class="panel-heading"><h2>BADGES & GYM LEADERS</h2><span>${badges} of 8 badges</span></div><p class="notice">A badge on its own only counts for level caps and field moves. <b>Beat leader</b> does everything winning that gym does in the game: the badge, the gym's defeated flag, its TM and gift, and the story that moves on afterwards. It is safest in gym order, because beating a gym early also moves that town's story along.</p>
    <div class="gym-list">${story.gyms
      .map((g, i) => {
        const badge = save.flag(g.badgeFlag),
          beaten = save.flag(g.gymFlag);
        return `<div class="gym-row"><label class="gym-badge"><input type="checkbox" data-badge="${i}" ${badge ? 'checked' : ''} ${off}> <span><b>${html(g.badge)}</b><small>${html(g.leader)} · ${html(g.city)}</small></span></label><span class="gym-status${beaten ? ' done' : ''}">${beaten ? 'Leader beaten' : badge ? 'Badge only' : 'Not earned'}</span><button type="button" data-beat="${i}" ${beaten || off ? 'disabled' : ''}>${beaten ? 'Beaten' : 'Beat leader…'}</button></div>`;
      })
      .join(
        '',
      )}</div><div class="actions-inline" style="margin-top:14px"><button type="button" id="all-badges" ${badges === 8 || off ? 'disabled' : ''}>Give all 8 badges</button></div></section>
    <section class="panel"><div class="panel-heading"><h2>ELITE FOUR & CHAMPION</h2><span>${cleared ? 'Champion · game cleared' : 'Not cleared yet'}</span></div><p class="field-help" style="margin-top:0">${cleared ? 'This save has entered the Hall of Fame, so the post-game is open.' : 'Becoming Champion sets what the game sets after the Hall of Fame: the game-clear flag the post-game checks for, Champion status, the post-game story (the S.S. Tidal, Steven’s house, Cynthia and more), the Hall of Fame count on your trainer card and a fully healed party. The Elite Four reset for rematches, as in the game.'}</p><div class="actions-inline"><button type="button" class="primary" id="become-champion" ${cleared || off ? 'disabled' : ''}>${cleared ? 'Already Champion' : 'Become Champion…'}</button></div></section>
    ${(() => {
      const on = Object.entries(story.flags).filter(
        ([n, id]) => isMode(n) && !/^FLAG_DAILY_/.test(n) && save.flag(id),
      );
      return on.length
        ? `<div class="notice warning story-mode-warning"><b>${on.length} game-mode or debug switch${on.length === 1 ? ' is' : 'es are'} on in this save:</b> ${on
            .slice(0, 12)
            .map(([n]) => html(prettyName(n)))
            .join(
              ', ',
            )}${on.length > 12 ? ` and ${on.length - 12} more` : ''}. The game sets some of these in normal play (Safari Zone, Cycling Road, a nuzlocke run), but if you didn't, turning them off restores normal play. <button type="button" id="review-modes">Review them</button></div>`
        : '';
    })()}
    <details class="panel" id="story-panel" ${storyOpen ? 'open' : ''}><summary class="panel-heading"><h2>STORY FLAGS & VARIABLES</h2><span>Advanced · every named event flag and story variable</span></summary><p class="notice warning">These are the game's raw story switches. Changing one without the others an event normally changes can leave characters missing or stuck, so change only what you understand, keep a backup, and prefer the buttons above.</p>
    <div class="bag-tools"><label class="field"><span>Search</span><input id="story-search" type="search" value="${html(storyFilter.text)}" placeholder="For example Rustboro, Steven or Badge" autocomplete="off"></label><label class="field"><span>Show</span><select id="story-kind"><option value="vars">Story variables</option><option value="flags">Event flags</option></select></label><label class="field"><span>Filter</span><select id="story-show"><option value="all">All</option><option value="set">Set or non-zero</option><option value="changed">Changed here</option></select></label></div>
    <div class="story-flag-tools" id="story-flag-tools"><label class="field"><span>Flag group</span><select id="story-group">${Object.entries(
      FLAG_GROUPS,
    )
      .map(([k, [label]]) => `<option value="${k}">${html(label)}</option>`)
      .join(
        '',
      )}</select></label><div class="actions-inline"><button type="button" id="story-set-all" ${off}>Set all shown</button><button type="button" id="story-clear-all" ${off}>Clear all shown</button></div></div>
    <div id="story-list" class="story-list"></div><div class="form-footer"><p id="story-pending">No pending story changes.</p><div class="actions-inline"><button type="button" id="story-discard">Discard</button><button type="button" class="primary" id="story-apply" data-dirty-apply ${off}>Apply story changes</button></div></div></details>
    <p class="field-help">Story data comes from the Elite Redux source (${html(story.source)}) and was checked against 2.65.4.11b saves.</p>`;
    document.querySelectorAll('[data-badge]').forEach(
      box =>
        (box.onchange = () => {
          const g = story.gyms[+box.dataset.badge];
          if (!guard()) {
            box.checked = !box.checked;
            return;
          }
          apply(
            () =>
              save.applyStory(
                { flags: [[g.badgeFlag, box.checked ? 1 : 0]] },
                `${box.checked ? 'Give' : 'Remove'} ${g.badge}`,
              ),
            `${g.badge} ${box.checked ? 'added' : 'removed'}.`,
          );
        }),
    );
    document
      .querySelectorAll('[data-beat]')
      .forEach(b => (b.onclick = () => beatLeader(story.gyms[+b.dataset.beat])));
    $('all-badges').onclick = () => {
      if (!guard()) return;
      apply(
        () =>
          save.applyStory({ flags: story.gyms.map(g => [g.badgeFlag, 1]) }, 'Give all 8 badges'),
        'All 8 badges added.',
      );
    };
    $('become-champion').onclick = becomeChampion;
    $('review-modes')?.addEventListener('click', () => {
      Object.assign(storyFilter, { kind: 'flags', group: 'modes', show: 'set', text: '' });
      storyOpen = true;
      render();
      $('story-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    $('story-panel').addEventListener('toggle', e => (storyOpen = e.target.open));
    // Advanced list
    $('story-kind').value = storyFilter.kind;
    $('story-show').value = storyFilter.show;
    const rows = () => {
      const q = storyFilter.text.trim().toLowerCase().replace(/\s+/g, '_');
      const source =
        storyFilter.kind === 'vars'
          ? Object.entries(story.vars).filter(([n]) => !/^VAR_(TEMP|OBJ_GFX_ID)_/.test(n))
          : Object.entries(story.flags);
      return source
        .filter(([n, id]) => {
          if (q && !n.toLowerCase().includes(q)) return false;
          if (storyFilter.kind === 'flags' && !FLAG_GROUPS[storyFilter.group][1](n)) return false;
          const draft = storyFilter.kind === 'vars' ? varDraft : flagDraft;
          if (storyFilter.show === 'changed') return draft.has(id);
          if (storyFilter.show === 'set')
            return storyFilter.kind === 'vars'
              ? (draft.get(id) ?? save.getVar(id - story.varsStart)) !== 0
              : !!(draft.get(id) ?? save.flag(id));
          return true;
        })
        .sort((a, b) => a[1] - b[1]);
    };
    const pending = () => {
      const n = flagDraft.size + varDraft.size;
      dirty = n > 0;
      $('story-panel').classList.toggle('is-dirty', dirty);
      $('story-pending').textContent = n
        ? `${n} pending story change${n === 1 ? '' : 's'} · apply to save them`
        : 'No pending story changes.';
      sync();
    };
    const draw = () => {
      $('story-flag-tools').hidden = storyFilter.kind !== 'flags';
      const list = rows();
      $('story-list').innerHTML = list.length
        ? list
            .slice(0, 300)
            .map(([name, id]) => {
              if (storyFilter.kind === 'vars') {
                const value = varDraft.get(id) ?? save.getVar(id - story.varsStart),
                  note = story.varNotes[name];
                return `<label class="story-row${varDraft.has(id) ? ' changed' : ''}"><span><b>${html(prettyName(name))}</b><small>${html(name)} · 0x${id.toString(16).toUpperCase()}${note ? ` · ${html(note)}` : ''}</small></span><input type="number" min="0" max="65535" value="${value}" data-story-var="${id}" aria-label="${html(prettyName(name))}" ${off}></label>`;
              }
              const on = flagDraft.get(id) ?? save.flag(id);
              return `<label class="story-row${flagDraft.has(id) ? ' changed' : ''}"><span><b>${html(prettyName(name))}${isMode(name) ? ' <em class="mode-tag">Game mode switch</em>' : ''}</b><small>${html(name)} · #${id}</small></span><input type="checkbox" data-story-flag="${id}" ${on ? 'checked' : ''} aria-label="${html(prettyName(name))}" ${off}></label>`;
            })
            .join('') +
          (list.length > 300
            ? `<p class="field-help">Showing 300 of ${list.length}. Search to narrow the list.</p>`
            : '')
        : '<p class="field-help">Nothing matches.</p>';
      pending();
    };
    $('story-list').oninput = e => {
      const v = e.target.closest('[data-story-var]'),
        f = e.target.closest('[data-story-flag]');
      if (v) {
        const id = +v.dataset.storyVar,
          n = Number(v.value);
        if (!Number.isInteger(n) || n < 0 || n > 65535) return;
        if (n === save.getVar(id - story.varsStart)) varDraft.delete(id);
        else varDraft.set(id, n);
        v.parentElement.classList.toggle('changed', varDraft.has(id));
      }
      if (f) {
        const id = +f.dataset.storyFlag,
          on = f.checked ? 1 : 0;
        if (on === save.flag(id)) flagDraft.delete(id);
        else flagDraft.set(id, on);
        f.parentElement.classList.toggle('changed', flagDraft.has(id));
      }
      pending();
    };
    $('story-search').oninput = e => {
      storyFilter.text = e.target.value;
      draw();
    };
    $('story-kind').onchange = e => {
      storyFilter.kind = e.target.value;
      draw();
    };
    $('story-group').value = storyFilter.group;
    $('story-group').onchange = e => {
      storyFilter.group = e.target.value;
      draw();
    };
    // Bulk changes cover every flag the search, group and filter match, not only the 300 shown.
    const setShown = on => {
      let skipped = 0;
      for (const [name, id] of rows()) {
        // Never switch modes, debug options or Frontier symbols on in bulk.
        if (on && isMode(name)) {
          if (!save.flag(id)) skipped++;
          continue;
        }
        if (on === save.flag(id)) flagDraft.delete(id);
        else flagDraft.set(id, on);
      }
      draw();
      if (skipped)
        notify(
          `Skipped ${skipped} game-mode, debug, Battle Frontier and daily switch${skipped === 1 ? '' : 'es'}. Tick them one at a time if you really want them.`,
        );
    };
    $('story-set-all').onclick = () => setShown(1);
    $('story-clear-all').onclick = () => setShown(0);
    $('story-show').onchange = e => {
      storyFilter.show = e.target.value;
      draw();
    };
    $('story-discard').onclick = () => {
      flagDraft.clear();
      varDraft.clear();
      draw();
    };
    $('story-apply').onclick = () => {
      const n = flagDraft.size + varDraft.size;
      if (!n) {
        notify('No story changes to apply.');
        return;
      }
      const plan = { flags: [...flagDraft], vars: [...varDraft] };
      const commit = () =>
        apply(
          () => {
            save.applyStory(plan, `Edit ${n} story value${n === 1 ? '' : 's'}`);
            flagDraft.clear();
            varDraft.clear();
          },
          `${n} story value${n === 1 ? '' : 's'} updated. Undo reverses all of them at once.`,
        );
      const name = id => storyFlagName.get(id) || '';
      const hide = plan.flags.filter(([id]) => FLAG_GROUPS.hide[1](name(id))).length,
        items = plan.flags.filter(([id, on]) => on && FLAG_GROUPS.items[1](name(id))).length,
        defeated = plan.flags.filter(([id, on]) => on && FLAG_GROUPS.defeated[1](name(id))).length,
        modes = plan.flags.filter(([id, on]) => on && isMode(name(id))).length;
      if (n <= 25 && !hide && !modes) {
        commit();
        return;
      }
      const risks = [
        modes &&
          `${modes} game-mode or debug switch${modes === 1 ? '' : 'es'} will turn on (for example no wild encounters, no catching, auto-win, Safari Zone mode or Frontier symbols). These change how the game plays and looks.`,
        hide &&
          `${hide} flag${hide === 1 ? ' changes' : 's change'} which characters and objects appear. Story characters can vanish or block paths, and some events may never trigger.`,
        items &&
          `${items} item${items === 1 ? '' : 's'} will count as already picked up, so those item balls and hidden items disappear without giving you anything.`,
        defeated &&
          `${defeated} trainer${defeated === 1 ? '' : 's'} or Pokémon will count as defeated, including legendaries you may not have caught yet.`,
      ].filter(Boolean);
      const dialog = openDialog(
        `Change ${n} story values?`,
        'Large flag changes can break a run. Keep the original backup before you play this save.',
        `${risks.length ? `<ul class="story-risks">${risks.map(r => `<li>${html(r)}</li>`).join('')}</ul>` : ''}<p class="field-help">Undo reverses the whole change in one step.</p><div class="form-footer"><span></span><div class="actions-inline"><button type="button" data-close>Cancel</button><button type="button" class="primary" data-confirm>Apply ${n} changes</button></div></div>`,
      );
      dialog.querySelector('[data-confirm]').onclick = () => {
        closeDialog(dialog);
        commit();
      };
    };
    draw();
  }
  let storyOpen = false;
  // ---- Progress tab: Pokédex, game stats, nuzlocke, roamer, clock -----------------------------
  let dexDraft = new Map(),
    dexFilter = { text: '', show: 'all' };
  const WALLPAPER_NAMES = [
    'Forest',
    'City',
    'Desert',
    'Savanna',
    'Crag',
    'Volcano',
    'Snow',
    'Cave',
    'Beach',
    'Seafloor',
    'River',
    'Sky',
    'Polka-dot',
    'Pokémon Center',
    'Machine',
    'Plain',
  ];
  const DEX_SHOW = {
    all: 'All species',
    caught: 'Caught',
    seen: 'Seen, not caught',
    none: 'Not seen',
  };
  // One entry per Pokédex number (sp.no), shown as its base species (sp.id).
  function dexEntries() {
    return ERCore.pokedexList(catalog).map(({ no, species }) => ({ ...species, no }));
  }
  function renderProgress() {
    const off = save.damaged.length ? 'disabled' : '',
      dex = save.pokedex(),
      stats = save.gameStats(),
      nuz = save.nuzlocke(),
      roamer = save.roamer(),
      clock = save.clockOffset();
    const roamerSpecies = catalog.species[roamer.species];
    $('editor-panel').innerHTML =
      `<div class="page-heading"><h1>Progress and records.</h1><p>Your Pokédex, game statistics, nuzlocke tracking and the in-game clock.</p></div>
    <section class="panel" id="dex-panel"><div class="panel-heading"><h2>POKÉDEX</h2><span id="dex-count"></span></div><p class="notice">Seen and caught are tracked per Pokédex number. Forms (Megas, Primals, regional forms) share their base Pokémon's entry, so Primal Cascoon counts as Cascoon. Marking a species caught also marks it seen; clearing seen clears caught. This changes Pokédex records only; it does not add Pokémon. Keep it to 999 seen at most: the game's Pokédex crashes at 1,000, because it can only draw three-digit totals.</p>
    <div class="bag-tools"><label class="field"><span>Search species</span><input id="dex-search" type="search" value="${html(dexFilter.text)}" placeholder="Name or number" autocomplete="off"></label></div><div class="pocket-chips" id="dex-show" role="group" aria-label="Show species"></div>
    <div class="actions-inline bag-bulk"><button type="button" data-dex-bulk="caught" ${off}>Mark shown as caught</button><button type="button" data-dex-bulk="seen" ${off}>Mark shown as seen</button><button type="button" data-dex-bulk="none" ${off}>Clear shown</button><button type="button" id="dex-add-pc" ${off}>Add caught species to PC…</button></div>
    <div id="dex-list" class="bag-grid dex-grid"></div><div class="form-footer"><p id="dex-pending">No pending Pokédex changes.</p><div class="actions-inline"><button type="button" id="dex-discard">Discard</button><button type="button" class="primary" id="dex-apply" data-dirty-apply ${off}>Apply Pokédex changes</button></div></div></section>
    <form id="stats-form"><fieldset ${off} class="plain"><section class="panel"><div class="panel-heading"><h2>GAME STATS</h2><span>Shown on the trainer card and in TV shows</span></div><div class="field-grid">${Object.entries(
      ERCore.GAME_STATS_EDITABLE,
    )
      .map(([id, label]) => numberField(label, `stat${id}`, stats[id], 0, 999999999))
      .join(
        '',
      )}</div><div class="form-footer"><p>Hall of Fame records and link-battle results are left untouched.</p><div class="actions-inline"><button type="button" data-discard>Discard</button><button type="submit" class="primary">Apply stats</button></div></div></section></fieldset></form>
    <form id="nuzlocke-form"><fieldset ${off} class="plain"><section class="panel"><div class="panel-heading"><h2>NUZLOCKE TRACKING</h2><span>${nuz.routes} route encounter${nuz.routes === 1 ? '' : 's'} recorded · ${nuz.locations} caught-location flag${nuz.locations === 1 ? '' : 's'}</span></div><div class="settings-grid"><label class="switch-field">First-encounter capture rule<input name="captureRule" type="checkbox" ${nuz.captureRule ? 'checked' : ''}></label></div><div class="checkrow"><label><input name="clearRoutes" type="checkbox"> Forget which routes already had an encounter</label><label><input name="clearLocations" type="checkbox"> Forget where Pokémon were caught</label></div><div class="form-footer"><p>Clearing makes every route count as fresh again. Nothing else in the run changes.</p><div class="actions-inline"><button type="button" data-discard>Discard</button><button type="submit" class="primary">Apply nuzlocke changes</button></div></div></section></fieldset></form>
    <form id="clock-form"><fieldset ${off} class="plain"><section class="panel"><div class="panel-heading"><h2>IN-GAME CLOCK</h2><span>Offset from your emulator clock: ${clock.days} days ${String(clock.hours).padStart(2, '0')}:${String(clock.minutes).padStart(2, '0')}</span></div><div class="field-grid">${numberField('Move clock by hours', 'shiftHours', 0, -8760, 8760)}${numberField('and minutes', 'shiftMinutes', 0, -59, 59)}<span></span></div><div class="form-footer"><p>Use positive values to move time forward (for example to reach night) and negative values to go back. Time-based events and berry growth follow the new time.</p><div class="actions-inline"><button type="button" data-discard>Discard</button><button type="submit" class="primary">Shift clock</button></div></div></section></fieldset></form>
    <section class="panel"><div class="panel-heading"><h2>ROAMING POKÉMON</h2><span>View only</span></div><p class="field-help" style="margin-top:0">${roamerSpecies ? `${html(roamerSpecies.name)} · ${roamer.active ? `roaming at level ${roamer.level} with ${roamer.hp} HP` : 'not roaming yet'}` : 'No roaming Pokémon recorded.'}</p><p class="field-help">Roamer editing is left out on purpose: its location is kept only while the game runs, so changing it from a save could make it unreachable.</p></section>`;
    // Pokédex list
    const entries = dexEntries(),
      stateOf = n =>
        dexDraft.has(n)
          ? dexDraft.get(n)
          : dex.caught(n)
            ? 'caught'
            : dex.seen(n)
              ? 'seen'
              : 'none';
    // Forms (Primal Cascoon, Rattata Redux…) have no entry of their own; searching shows them
    // next to their base, and each one sets that shared entry.
    const listed = new Set(entries.map(sp => sp.id)),
      baseOf = new Map(entries.map(sp => [sp.no, sp.name])),
      forms = Object.values(catalog.species)
        .filter(sp => sp.id > 0 && !listed.has(sp.id))
        .map(sp => ({ ...sp, no: ERCore.dexNumber(catalog, sp.id), form: true }))
        .filter(sp => baseOf.has(sp.no));
    const shown = () => {
      const q = dexFilter.text.trim().toLocaleLowerCase();
      return (
        q ? [...entries, ...forms].sort((a, b) => a.no - b.no || !!a.form - !!b.form) : entries
      ).filter(
        sp =>
          (!q ||
            matchesQuery(`${sp.name} ${sp.no}`.toLocaleLowerCase(), q) ||
            (sp.form && matchesQuery(`${baseOf.get(sp.no)} ${sp.no}`.toLocaleLowerCase(), q))) &&
          (dexFilter.show === 'all' || stateOf(sp.no) === dexFilter.show),
      );
    };
    // Unique entries among the shown rows, for bulk actions.
    const shownEntries = () => [...new Map(shown().map(sp => [sp.no, sp])).values()];
    const pending = () => {
      dirty = dexDraft.size > 0;
      $('dex-panel').classList.toggle('is-dirty', dirty);
      sync();
      let s = 0,
        c = 0;
      for (const sp of entries) {
        const st = stateOf(sp.no);
        if (st !== 'none') s++;
        if (st === 'caught') c++;
      }
      $('dex-count').textContent = `${c} caught · ${s} seen · ${entries.length} species`;
      // Buttons rather than a dropdown: one tap on phones, and each shows its count.
      const counts = { all: entries.length, caught: c, seen: s - c, none: entries.length - s };
      $('dex-show').innerHTML = Object.entries(DEX_SHOW)
        .map(
          ([key, label]) =>
            `<button type="button" data-dex-show="${key}" aria-pressed="${key === dexFilter.show}">${label} <small>${counts[key]}</small></button>`,
        )
        .join('');
      const tooMany = s > save.pokedex().limit && dexDraft.size;
      $('dex-pending').textContent = tooMany
        ? `${s.toLocaleString()} would be seen. The game's Pokédex crashes at 1,000 or more, so clear ${s - save.pokedex().limit} before applying.`
        : dexDraft.size
          ? `${dexDraft.size} pending Pokédex change${dexDraft.size === 1 ? '' : 's'} · apply to save them`
          : 'No pending Pokédex changes.';
      $('dex-pending').classList.toggle('warning-text', !!tooMany);
      $('dex-apply').disabled = !!tooMany || !!off;
    };
    const original = n => (dex.caught(n) ? 'caught' : dex.seen(n) ? 'seen' : 'none');
    const setState = (n, st) => {
      if (original(n) === st) dexDraft.delete(n);
      else dexDraft.set(n, st);
    };
    const draw = () => {
      const list = shown();
      $('dex-list').innerHTML = list.length
        ? list
            .slice(0, 600)
            .map(sp => {
              const st = stateOf(sp.no);
              return `<div class="bag-item dex-item${dexDraft.has(sp.no) ? ' changed' : ''}${sp.form ? ' dex-form' : ''}"><span>${html(sp.name)}${sp.form ? `<small class="dex-form-of">Form · shares ${html(baseOf.get(sp.no))}'s entry</small>` : ''}</span><small>#${sp.no}</small><select data-dex="${sp.no}" aria-label="${html(sp.name)} Pokédex state" ${off}><option value="none"${st === 'none' ? ' selected' : ''}>Not seen</option><option value="seen"${st === 'seen' ? ' selected' : ''}>Seen</option><option value="caught"${st === 'caught' ? ' selected' : ''}>Caught</option></select></div>`;
            })
            .join('') +
          (list.length > 600
            ? `<p class="field-help">Showing 600 of ${list.length}. Search to narrow the list; bulk buttons apply to all ${list.length}.</p>`
            : '')
        : '<p class="field-help">No species match.</p>';
      pending();
    };
    $('dex-list').onchange = e => {
      const el = e.target.closest('[data-dex]');
      if (!el) return;
      const no = +el.dataset.dex;
      setState(no, el.value);
      // A form and its base share one entry: keep every row for it in step.
      $('dex-list')
        .querySelectorAll(`[data-dex="${no}"]`)
        .forEach(other => {
          other.value = el.value;
          other.parentElement.classList.toggle('changed', dexDraft.has(no));
        });
      pending();
    };
    $('dex-search').oninput = e => {
      dexFilter.text = e.target.value;
      draw();
    };
    $('dex-show').onclick = e => {
      const chip = e.target.closest('[data-dex-show]');
      if (!chip) return;
      dexFilter.show = chip.dataset.dexShow;
      draw();
    };
    document.querySelectorAll('[data-dex-bulk]').forEach(
      b =>
        (b.onclick = () => {
          const st = b.dataset.dexBulk,
            limit = save.pokedex().limit;
          // Never go past the 999 seen the game can draw: mark in Pokédex order until full.
          let seen = entries.filter(sp => stateOf(sp.no) !== 'none').length,
            skipped = 0;
          for (const sp of shownEntries()) {
            if (st !== 'none' && stateOf(sp.no) === 'none') {
              if (seen >= limit) {
                skipped++;
                continue;
              }
              seen++;
            }
            setState(sp.no, st);
          }
          draw();
          if (skipped)
            notify(
              `${skipped} left unmarked: the game's Pokédex crashes at 1,000 seen, so it stops at ${limit}. Clear others to make room for them.`,
              true,
            );
        }),
    );
    $('dex-add-pc').onclick = () => openBulkAddDialog('caught');
    $('dex-discard').onclick = () => {
      dexDraft.clear();
      dirty = false;
      draw();
    };
    $('dex-apply').onclick = () => {
      if (!dexDraft.size) {
        notify('No Pokédex changes to apply.');
        return;
      }
      const changes = Object.fromEntries(dexDraft),
        n = dexDraft.size;
      apply(
        () => {
          save.editPokedex(changes);
          dexDraft.clear();
        },
        `${n} Pokédex entr${n === 1 ? 'y' : 'ies'} updated.`,
      );
    };
    draw();
    // Stats, nuzlocke, clock
    const sf = $('stats-form');
    bindDirty(sf);
    sf.onsubmit = e => {
      e.preventDefault();
      try {
        const patch = {};
        for (const [id, label] of Object.entries(ERCore.GAME_STATS_EDITABLE)) {
          const n = wholeNumber(sf.elements[`stat${id}`].value, label, 0, 999999999);
          if (n !== stats[id]) patch[id] = n;
        }
        if (!Object.keys(patch).length) {
          dirty = false;
          sync();
          notify('No stat changes to apply.');
          return;
        }
        apply(() => save.editGameStats(patch), 'Game stats updated.');
      } catch (err) {
        fail(err);
      }
    };
    const nf = $('nuzlocke-form');
    bindDirty(nf);
    nf.onsubmit = e => {
      e.preventDefault();
      apply(
        () =>
          save.editNuzlocke({
            captureRule: +nf.elements.captureRule.checked,
            clearRoutes: nf.elements.clearRoutes.checked,
            clearLocations: nf.elements.clearLocations.checked,
          }),
        'Nuzlocke tracking updated.',
      );
    };
    const cf = $('clock-form');
    bindDirty(cf);
    cf.onsubmit = e => {
      e.preventDefault();
      try {
        const minutes =
          wholeNumber(cf.elements.shiftHours.value, 'Hours', -8760, 8760) * 60 +
          wholeNumber(cf.elements.shiftMinutes.value, 'Minutes', -59, 59);
        if (!minutes) {
          dirty = false;
          sync();
          notify('Enter how far to move the clock.');
          return;
        }
        apply(
          () => save.shiftClock(minutes),
          `In-game clock moved ${minutes > 0 ? 'forward' : 'back'} ${Math.floor(Math.abs(minutes) / 60)}h ${Math.abs(minutes) % 60}m.`,
        );
      } catch (err) {
        fail(err);
      }
    };
  }
  function renderRandomizer(m) {
    const s = catalog.species[m.species],
      on = options().abilityRng || options().innateRng,
      draft = searchDraft();
    matchMode = draft.matchMode;
    $('editor-panel').innerHTML =
      `${heading(m)}<div class="ability-overview" id="lab-abilities">${abilityCards(m)}</div><p class="notice">Each Pokémon has three ability choices, with one equipped alongside its innates. Choose up to four abilities you want together. Any-order matching can place each one in the equipped ability or any innate slot. Blank inputs leave the remaining abilities unrestricted. Every result is verified against the ${html(catalog.config.modulus)}-outcome randomizer.</p>${!on ? '<p class="notice warning">Ability and innate randomizers are off. Enable the ones you want to change in Game settings before searching.</p>' : ''}
    <section class="panel"><div class="panel-heading"><h2>FIND YOUR COMBINATION</h2><span>Runs in a background worker</span></div><div class="checkrow" style="margin-top:0;margin-bottom:16px"><label><input id="match-any-order" type="checkbox" ${matchMode === 'any' ? 'checked' : ''}> Match abilities in any order</label></div><div class="target-grid">${[0, 1, 2, 3].map(i => `<label class="field"><span id="target-label-${i}"></span><input id="target-${i}" list="list-abilities" placeholder="Leave blank for any ability" autocomplete="off" ${on ? '' : 'disabled'}></label>`).join('')}</div><p class="field-help" id="match-help"></p><div class="actions-inline" style="margin-bottom:12px"><button type="button" id="fill-current" ${on ? '' : 'disabled'}>Fill blanks with current abilities</button></div><div class="search-control"><button id="search-button" class="primary" ${!on || save.damaged.length ? 'disabled' : ''}>Find combinations</button><button id="cancel-search" hidden>Stop search</button><label><input id="lock-slot" type="checkbox"> Keep ability slot ${m.abilitySlot + 1}</label><label><input id="keep-gender" type="checkbox" checked> Keep gender</label></div><div class="search-progress" id="search-progress" aria-live="polite"></div><progress id="search-meter" max="100" value="0" hidden></progress></section>
    <div id="search-results"></div><section class="panel"><div class="panel-heading"><h2>PID & FORM PREVIEW</h2><span>Changing PID can change gender and randomized types</span></div><div class="field-grid"><label class="field"><span>PID · hexadecimal</span><input id="pid-input" value="${m.pid.toString(16).toUpperCase().padStart(8, '0')}" maxlength="8" pattern="[0-9A-Fa-f]{1,8}"></label><label class="field"><span>Preview species / Mega form</span><input id="preview-species" list="list-species" value="${html(display(s))}" autocomplete="off"></label><label class="field"><span>Preview ability slot</span><select id="preview-slot">${[0, 1, 2].map(i => `<option value="${i}" ${i === m.abilitySlot ? 'selected' : ''}>Slot ${i + 1}</option>`).join('')}</select></label></div><div class="form-footer"><p>Preview does not change species or PID until you apply a PID.</p><div class="actions-inline"><button id="preview-button">Preview</button><button id="reroll-button" ${save.damaged.length ? 'disabled' : ''}>Reroll PID</button><button id="apply-pid" class="primary" ${save.damaged.length ? 'disabled' : ''}>Apply PID</button></div></div><div id="pid-preview" style="margin-top:16px"></div></section>`;
    const updateMatchLabels = () => {
      for (let i = 0; i < 4; i++)
        $('target-label-' + i).textContent =
          matchMode === 'any'
            ? `Desired ability ${i + 1}`
            : ['Active ability', 'Innate 1', 'Innate 2', 'Innate 3'][i] +
              (!(i === 0 ? options().abilityRng : options().innateRng)
                ? ' · fixed in this save'
                : '');
      $('match-help').textContent =
        matchMode === 'any'
          ? 'Every entered ability must appear somewhere across the four slots. Entering an ability twice requires two copies.'
          : 'Each requested ability must match its named slot exactly.';
    };
    for (let i = 0; i < 4; i++) $('target-' + i).value = draft.targets[i];
    $('lock-slot').checked = draft.lockSlot;
    $('keep-gender').checked = draft.keepGender;
    updateMatchLabels();
    $('match-any-order').onchange = e => {
      matchMode = e.target.checked ? 'any' : 'slots';
      rememberSearchDraft();
      resetSearch();
      updateMatchLabels();
    };
    const changed = () => {
      rememberSearchDraft();
      resetSearch();
    };
    for (let i = 0; i < 4; i++) $('target-' + i).oninput = changed;
    $('lock-slot').onchange = changed;
    $('keep-gender').onchange = changed;
    $('fill-current').onclick = () => {
      // Copies what this Pokémon has now into empty inputs. Every ability and innate
      // rolls from the same PID, so each one kept makes matches far rarer: clear the
      // ones you are willing to lose.
      const now = ERRng.evaluate(s, m.pid, m.abilitySlot, options(), catalog.config);
      const current = [now.ability, ...now.innates];
      if (matchMode === 'slots')
        current.forEach((id, i) => {
          if (!$('target-' + i).value.trim())
            $('target-' + i).value = display(catalog.abilities[id]);
        });
      else {
        const typed = [0, 1, 2, 3].map(i => $('target-' + i).value.trim()).filter(Boolean);
        const extra = current.filter(id => !typed.includes(display(catalog.abilities[id])));
        for (let i = 0; i < 4 && extra.length; i++)
          if (!$('target-' + i).value.trim())
            $('target-' + i).value = display(catalog.abilities[extra.shift()]);
      }
      changed();
      notify(
        'Filled in. Each ability you keep makes matching PIDs rarer, since all of them come from the same PID. Clear the ones you can live without.',
      );
    };
    drawResults();
    $('search-button').onclick = () => startSearch(m);
    $('cancel-search').onclick = () => {
      cancelSearch();
      drawResults();
      $('search-progress').textContent =
        `Search stopped. ${searchResults.length} verified matches kept. Start a new search to continue.`;
    };
    if (searchSession) {
      $('search-meter').hidden = false;
      $('search-button').disabled = searchSession.busy;
      $('cancel-search').hidden = !searchSession.busy;
      searchStatus();
    }
    $('preview-button').onclick = () => {
      try {
        const pid = parsePID(),
          sp = catalog.species[resolve('species', $('preview-species').value)],
          slot = +$('preview-slot').value,
          r = ERRng.evaluate(sp, pid, slot, options(), catalog.config);
        $('pid-preview').innerHTML =
          `<p class="field-help">${html(sp.name)} · ${ERRng.gender(sp, pid)} · ${typeTags(r.types)}</p><div class="ability-overview" style="margin-top:12px">${abilityCards({ ...m, pid, abilitySlot: slot }, sp, true)}</div>`;
      } catch (e) {
        fail(e);
      }
    };
    $('apply-pid').onclick = () => {
      try {
        const pid = parsePID();
        apply(() => save.editMon(ref, { pid }, `Apply PID to ${m.nickname}`), 'PID applied.');
      } catch (e) {
        fail(e);
      }
    };
    $('reroll-button').onclick = () => {
      const value = crypto.getRandomValues(new Uint32Array(1))[0];
      apply(() => save.editMon(ref, { pid: value }, `Reroll ${m.nickname}`), 'New PID applied.');
    };
  }
  function parsePID() {
    const s = $('pid-input').value.trim();
    if (!/^[a-f\d]{1,8}$/i.test(s)) throw new Error('PID must contain 1 to 8 hexadecimal digits.');
    return parseInt(s, 16) >>> 0;
  }
  function cancelSearch() {
    if (worker) {
      worker.terminate();
      worker = null;
    }
    if (workerUrl) {
      URL.revokeObjectURL(workerUrl);
      workerUrl = null;
    }
    searchSession = null;
    if ($('cancel-search')) $('cancel-search').hidden = true;
    if ($('more-search')) $('more-search').hidden = true;
    if ($('search-button'))
      $('search-button').disabled =
        !(options().abilityRng || options().innateRng) || !!save.damaged.length;
  }
  function resetSearch() {
    cancelSearch();
    searchResults = [];
    drawResults();
    if ($('search-progress')) $('search-progress').textContent = '';
    if ($('search-meter')) $('search-meter').hidden = true;
  }
  function searchStatus() {
    if (!searchSession || !$('search-progress')) return;
    const s = searchSession,
      elapsed = s.elapsed + (s.busy ? performance.now() - s.started : 0);
    $('search-progress').textContent =
      `${searchResults.length} verified matches loaded · ${s.request.matchMode === 'any' ? 'Any order' : 'Exact slots'} · ${s.checked.toLocaleString()} candidates · ${(elapsed / 1000).toFixed(2)}s · ${s.busy ? 'Searching for more…' : s.complete ? 'Search complete. All matches loaded.' : 'More matches can be searched below'}`;
    $('search-meter').value = s.percent;
  }
  function loadMoreSearch() {
    if (!worker || !searchSession || searchSession.busy || searchSession.complete) return;
    searchSession.busy = true;
    searchSession.started = performance.now();
    $('search-button').disabled = true;
    $('cancel-search').hidden = false;
    if ($('more-search')) {
      $('more-search').disabled = true;
      $('more-search').textContent = 'Searching for more…';
    }
    searchStatus();
    worker.postMessage({ kind: 'next' });
  }
  function startSearch(m) {
    try {
      rememberSearchDraft();
      cancelSearch();
      const targets = [0, 1, 2, 3].map(i =>
        $('target-' + i).value.trim() ? resolve('abilities', $('target-' + i).value) : null,
      );
      if (targets.every(t => t === null))
        throw new Error('Choose at least one desired ability or innate.');
      const species = catalog.species[m.species];
      const request = {
        species,
        options: options(),
        config: catalog.config,
        targets,
        matchMode,
        lockedSlot: $('lock-slot').checked ? m.abilitySlot : null,
        keepGender: $('keep-gender').checked,
        pid: m.pid,
        limit: 12,
      };
      const code =
        $('rng-code').textContent +
        `\nlet pages;self.onmessage=async e=>{try{if(e.data.kind!=='next')pages=ERRng.searchPages(e.data,p=>self.postMessage({kind:'progress',value:p}));const page=await pages.next();self.postMessage({kind:'done',value:page.value});}catch(error){self.postMessage({kind:'error',message:error.message});}};`;
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      try {
        worker = new Worker(url);
        workerUrl = url;
      } catch (error) {
        URL.revokeObjectURL(url);
        throw error;
      }
      searchResults = [];
      searchSession = {
        request,
        complete: false,
        busy: true,
        checked: 0,
        percent: 0,
        elapsed: 0,
        started: performance.now(),
      };
      drawResults();
      $('search-button').disabled = true;
      $('cancel-search').hidden = false;
      $('search-meter').hidden = false;
      searchStatus();
      const searchWorker = worker;
      worker.onmessage = e => {
        const data = e.data;
        if (worker !== searchWorker || !searchSession) return;
        if (workerUrl) {
          URL.revokeObjectURL(workerUrl);
          workerUrl = null;
        }
        if (data.kind === 'progress') {
          searchSession.checked = data.value.checked;
          searchSession.percent = data.value.percent;
          searchStatus();
        } else if (data.kind === 'done') {
          const s = searchSession;
          s.elapsed += performance.now() - s.started;
          s.busy = false;
          s.checked = data.value.checked;
          s.percent = data.value.percent;
          s.complete = data.value.complete;
          searchResults.push(
            ...data.value.answers.map(r => ({
              ...r,
              abilityChoices: abilityChoices(
                request.species,
                r.pid,
                request.options,
                request.config,
              ),
            })),
          );
          if (s.complete) {
            worker.terminate();
            worker = null;
          }
          $('search-button').disabled = false;
          $('cancel-search').hidden = true;
          drawResults();
          searchStatus();
          if (s.complete && !searchResults.length)
            $('search-progress').textContent =
              `Search complete. No matching PID exists for these targets ${request.matchMode === 'any' ? 'in any order' : 'in the exact slots'} with the current slot/gender constraints.`;
        } else {
          cancelSearch();
          drawResults();
          fail(new Error(data.message));
        }
      };
      worker.onerror = e => {
        if (worker !== searchWorker) return;
        cancelSearch();
        drawResults();
        fail(new Error(e.message || 'Search worker failed.'));
      };
      worker.postMessage(request);
    } catch (e) {
      fail(e);
    }
  }
  function drawResults() {
    if (!$('search-results')) return;
    const current = mon();
    $('search-results').innerHTML =
      (searchResults.length
        ? `<div class="result-heading"><h2>SEARCH MATCHES</h2><span>${searchResults.length.toLocaleString()} loaded · Click a row to apply</span></div>`
        : searchSession?.busy
          ? '<div aria-hidden="true">' +
            '<div class="skeleton-row"><span></span><span></span></div>'.repeat(3) +
            '</div>'
          : '') +
      searchResults
        .map((r, i) => {
          const selected = current?.pid === r.pid && current.abilitySlot === r.slot,
            pid = r.pid.toString(16).toUpperCase().padStart(8, '0');
          return `<button type="button" class="result-row${selected ? ' is-selected' : ''}" data-result="${i}" aria-label="Apply match ${i + 1}, PID ${pid}" aria-pressed="${selected}"><code><small>MATCH ${i + 1}</small><br>${pid}<br><small>SLOT ${r.slot + 1}</small></code><span class="result-abilities"><b>Ability choices</b><span class="result-ability-options">${r.abilityChoices.map((id, slot) => `<span class="result-ability-option${slot === r.slot ? ' is-equipped' : ''}" title="${slot === r.slot ? 'Equipped by this result' : 'Alternative ability choice'}">${slot + 1}. ${html(catalog.abilities[id]?.name || id)}${slot === r.slot ? ' (equipped)' : ''}</span>`).join('')}</span><small>Innates: ${r.innates.map(id => html(catalog.abilities[id]?.name || id)).join(' · ')}</small></span><span class="result-use">${selected ? 'Applied' : 'Use this PID'}</span></button>`;
        })
        .join('') +
      (searchSession && !searchSession.complete
        ? `<div class="result-pagination"><span>${searchResults.length.toLocaleString()} matches loaded. Continue searching for the next batch.</span><button id="more-search" ${searchSession.busy ? 'disabled' : ''}>${searchSession.busy ? 'Searching for more…' : 'Load more matches'}</button></div>`
        : searchResults.length && searchSession?.complete
          ? '<p class="field-help">All matching results have been loaded.</p>'
          : '');
    $('more-search')?.addEventListener('click', loadMoreSearch);
    $('search-results')
      .querySelectorAll('[data-result]')
      .forEach(
        e =>
          (e.onclick = () => {
            if (!guard()) return;
            const r = searchResults[+e.dataset.result];
            if (mon().pid === r.pid && mon().abilitySlot === r.slot) {
              notify('This PID is already applied.');
              return;
            }
            apply(
              () =>
                save.editMon(
                  ref,
                  { pid: r.pid, abilitySlot: r.slot },
                  `Apply ability combination to ${mon().nickname}`,
                ),
              'Verified combination applied. Your search is preserved.',
              { keepSearch: true },
            );
          }),
      );
  }
  function renderSettings() {
    const extraSwitches = {
      damageDone: 'Display damage numbers',
      askForNickname: 'Ask for nickname on catch',
      playerAI: 'Player AI (auto-battle)',
      individualColors: 'Individual Pokémon colors',
      doubleBattles: 'Double battles',
    };
    const hints = {
      abilityRng:
        'Rerolls every Pokémon’s three ability choices from its PID. Switching it changes them all at once.',
      innateRng:
        'Rerolls every Pokémon’s three innates from its PID. Switching it changes them all at once.',
      typeRng: 'Rerolls every Pokémon’s types from its PID.',
      encounterRng: 'Randomizes the wild Pokémon you meet from now on.',
      encLegendRng: 'Lets legendary Pokémon appear in randomized encounters.',
      moveRng: 'Randomizes movesets the game generates from now on. Moves already learned stay.',
      enableEvs: 'When off, EVs are ignored in stat calculations.',
      permanentRepel: 'Keeps weaker wild Pokémon away without using Repels.',
    };
    const toggle = ([k, l]) =>
      `<label class="switch-field"><span>${l}${hints[k] ? `<small>${hints[k]}</small>` : ''}</span><input name="${k}" type="checkbox" ${o[k] ? 'checked' : ''}></label>`;
    const o = options(),
      labels = {
        abilityRng: 'Ability randomizer',
        innateRng: 'Innate randomizer',
        encounterRng: 'Encounter randomizer',
        encLegendRng: 'Legendary encounters',
        moveRng: 'Move randomizer',
        typeRng: 'Type randomizer',
        permMega: 'Permanent Mega mode',
        enableEvs: 'Enable EVs',
        autoEVGain: 'Automatic EV gain',
        autoExpGain: 'Automatic EXP gain',
        autoEvolution: 'Automatic evolution',
        autoRun: 'Auto run',
        permanentRepel: 'Permanent repel',
      };
    $('editor-panel').innerHTML =
      `<div class="page-heading"><h1>Your game, configured.</h1><p>Read directly from your save. Only the selected option bits are changed.</p></div><p class="notice">Settings that change existing Pokémon say so below. Nothing changes until you apply.</p><form id="settings-form"><fieldset ${save.damaged.length ? 'disabled' : ''} style="padding:0;border:0;margin:0"><section class="panel"><div class="panel-heading"><h2>RUN RULES</h2><span>${save.badge() === 9 ? 'Champion clear' : `${save.badge()} badge stage`} · Level cap ${save.cap()}</span></div><div class="field-grid">${selectField('Difficulty', 'difficulty', o.difficulty, ['Easy', 'Ace', 'Elite', 'Hell'])}${selectField('Level caps', 'levelCaps', o.levelCaps, ['Easy caps', 'More caps', 'Elite caps', 'Caps off'])}${selectField('Shiny rate', 'shinyRate', o.shinyRate, ['1 / 1,024', '1 / 128', '1 / 5', 'Reserved mode (default odds)'])}</div><h3 class="settings-section">RANDOMIZERS</h3><div class="settings-grid">${Object.entries(
        labels,
      )
        .slice(0, 6)
        .map(toggle)
        .join(
          '',
        )}</div><h3 class="settings-section">PLAY OPTIONS</h3><div class="settings-grid">${Object.entries(
        labels,
      )
        .slice(6)
        .map(toggle)
        .join(
          '',
        )}</div><h3 class="settings-section">INTERFACE & BATTLE</h3><div class="field-grid">${selectField('Battle speed', 'battleSpeed', o.battleSpeed, ['1×', '2×', '3×', '4×'])}${selectField('Overworld speed', 'overworldSpeed', o.overworldSpeed, ['Normal', '2×', '4×', '8×'])}${selectField('Text speed', 'textSpeed', o.textSpeed, ['Slow', 'Mid', 'Fast', 'Instant'])}${selectField('HP bar speed', 'hpBarSpeed', o.hpBarSpeed, ['Slow', 'Mid', 'Fast', 'Instant'])}${selectField('Battle animations', 'battleSceneOff', o.battleSceneOff, ['On', 'Off'])}${selectField('Battle style', 'battleStyle', o.battleStyle, ['Shift', 'Set'])}${selectField('Sound', 'sound', o.sound, ['Mono', 'Stereo'])}${selectField('Button mode', 'buttonMode', o.buttonMode, ['Normal', 'LR', 'L = A'])}${selectField(
        'Window frame',
        'frameType',
        o.frameType,
        Array.from({ length: 20 }, (_, i) => `Frame ${i + 1}`),
      )}${selectField('Battle UI skin', 'battleTheme', o.battleTheme, ['Elite Redux Dark', 'Elite Redux Clear', 'Diamond & Pearl', 'Classic'])}</div><div class="settings-grid" style="margin-top:16px">${Object.entries(
        extraSwitches,
      )
        .map(toggle)
        .join(
          '',
        )}</div><div class="form-footer"><p>Stat-affecting settings also refresh party stat caches.</p><div class="actions-inline"><button type="button" data-discard>Discard draft</button><button type="submit" class="primary">Apply game settings</button></div></div></section></fieldset></form>
    <section class="panel"><div class="panel-heading"><h2>GAME DATA PROFILE</h2><span>${html(catalog.version)}</span></div><p class="field-help" style="margin-top:0">${Object.keys(catalog.species).length.toLocaleString()} species · ${Object.keys(catalog.moves).length} moves · ${Object.keys(catalog.abilities).length} abilities · ${catalog.config.banned.length} randomizer exclusions. Save files do not identify the exact ROM revision, so choose your game version next to the file name. 2.65.4 and 2.65.4.11b are bundled; other builds need matching data.</p><p class="field-help">For another build, import a generated catalog with explicit randomizer configuration. Nextdex JSON is accepted for builds using the same 38 blocked abilities. Verify the profile against your ROM before using ability searches.</p><div class="form-footer"><div class="actions-inline"><button id="import-catalog">Import game data JSON</button><button id="reset-catalog">Use bundled ${LATEST_VERSION} data</button></div><span class="ev-total">All data stays local</span></div><input id="catalog-file" type="file" accept=".json,application/json" hidden></section>`;
    const form = $('settings-form');
    bindDirty(form);
    form.onsubmit = e => {
      e.preventDefault();
      const patch = {};
      for (const k of Object.keys(labels)) patch[k] = +form.elements[k].checked;
      for (const k of [
        'difficulty',
        'levelCaps',
        'shinyRate',
        'textSpeed',
        'hpBarSpeed',
        'battleSceneOff',
        'battleStyle',
        'sound',
        'buttonMode',
        'frameType',
        'battleTheme',
        'battleSpeed',
        'overworldSpeed',
      ])
        patch[k] = +form.elements[k].value;
      for (const k of Object.keys(extraSwitches)) patch[k] = +form.elements[k].checked;
      apply(() => save.editOptions(patch), 'Game settings applied.');
    };
    $('import-catalog').onclick = () => {
      if (guard()) $('catalog-file').click();
    };
    $('catalog-file').onchange = async e => {
      try {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 30_000_000) throw new Error('Game data JSON is too large.');
        setCatalog(convertCatalog(JSON.parse(await file.text()), file.name));
      } catch (e) {
        fail(e);
      }
    };
    $('reset-catalog').onclick = () => {
      if (guard()) setCatalog(bundled[LATEST_VERSION]);
    };
  }
  function convertCatalog(data, name) {
    if (!Array.isArray(data.species)) return data;
    if (!Array.isArray(data.abilities) || !Array.isArray(data.moves) || !Array.isArray(data.typeT))
      throw new Error('Expected Nextdex gameData JSON or a generated studio catalog.');
    const types = builtin.types,
      map = ids =>
        ids.map(id => {
          const i = types.indexOf(data.typeT[id]);
          return i < 0 ? 255 : i;
        });
    const out = {
      version: name,
      types,
      natures: data.natureT || builtin.natures,
      config: { ...builtin.config, modulus: Math.max(...data.abilities.map(a => a.id)) },
      species: {},
      moves: {},
      abilities: {},
      items: { 0: { id: 0, name: 'None' } },
    };
    for (const s of data.species)
      if (s.id > 0)
        out.species[s.id] = {
          id: s.id,
          name: s.name,
          key: s.NAME,
          base: s.stats.base,
          types: map(s.stats.types),
          abilities: s.stats.abis,
          innates: s.stats.inns,
          gender: s.stats.gender === 255 ? 255 : Math.floor(s.stats.gender / 100),
          dex: s.dex?.id || 0,
          learnset: [],
          forms: [],
        };
    for (const a of data.abilities) out.abilities[a.id] = a;
    for (const m of data.moves)
      out.moves[m.id] = {
        id: m.id,
        name: m.name,
        pp: m.pp,
        power: m.pwr,
        types: map(m.types),
        description: m.desc,
        split: m.split,
        banned: data.effT[m.eff] === 'Placeholder' || m.NAME === 'MOVE_DARK_VOID',
      };
    for (const i of data.items) out.items[i.id] = { id: i.id, name: i.name };
    out.items[0] = { id: 0, name: 'None' };
    for (const s of Object.values(out.species)) {
      s.abilities = Array.from({ length: 3 }, (_, i) => s.abilities[i] || 0);
      s.innates = Array.from({ length: 3 }, (_, i) => s.innates[i] || 0);
    }
    return out;
  }
  // ---- Game version picker ---------------------------------------------------------------------
  function bundledVersionOf(data) {
    return Object.keys(bundled).find(v => bundled[v] === data) || null;
  }
  function drawVersionPickers() {
    const current = bundledVersionOf(catalog);
    for (const id of ['welcome-version', 'workspace-version']) {
      const select = $(id);
      select.innerHTML =
        Object.entries(GAME_VERSIONS)
          .map(([v, label]) => `<option value="${html(v)}">${html(label)}</option>`)
          .join('') +
        (current ? '' : `<option value="custom">Imported: ${html(catalog.version)}</option>`);
      select.value = current || 'custom';
    }
    $('brand-version').textContent = `ELITE REDUX · ${current || 'CUSTOM'} DATA`;
  }
  function chooseVersion(version, select) {
    const next = bundled[version];
    if (!next) return;
    if (!save) {
      catalog = next;
      buildLists();
      rememberVersion(version);
      drawVersionPickers();
      return;
    }
    if (!guard()) {
      select.value = bundledVersionOf(catalog) || 'custom';
      return;
    }
    rememberVersion(version);
    setCatalog(next);
  }
  function setCatalog(next) {
    try {
      if (
        !next.config ||
        !Number.isInteger(next.config.modulus) ||
        next.config.modulus < 1 ||
        next.config.modulus > 4095 ||
        !Array.isArray(next.config.banned) ||
        !next.species ||
        !next.moves ||
        !next.abilities ||
        !next.items ||
        next.natures?.length !== 25 ||
        !Array.isArray(next.types)
      )
        throw new Error('Invalid game data profile.');
      for (let id = 0; id <= next.config.modulus; id++)
        if (!next.abilities[id]) throw new Error(`Missing ability #${id} in game data.`);
      for (const s of Object.values(next.species))
        if (
          !s.name ||
          !s.key ||
          s.base?.length !== 6 ||
          s.types?.length !== 2 ||
          s.abilities?.length !== 3 ||
          s.innates?.length !== 3 ||
          [...s.abilities, ...s.innates].some(id => !next.abilities[id])
        )
          throw new Error(`Invalid species data for #${s.id}.`);
      const old = save.catalog;
      save.catalog = next;
      try {
        for (const m of save.party()) save.assertMon(m);
        for (let i = 0; i < 26; i++) for (const m of save.box(i)) if (m.species) save.assertMon(m);
      } catch (e) {
        save.catalog = old;
        throw e;
      }
      resetSearch();
      catalog = next;
      buildLists();
      sync();
      drawRoster();
      render();
      drawVersionPickers();
      notify(
        bundledVersionOf(next)
          ? `Using Elite Redux ${next.version} data. Abilities and innates now follow that build.`
          : 'Game data profile loaded. Verify it matches your ROM.',
      );
    } catch (e) {
      fail(e);
    }
  }
  function renderReview() {
    const count = save.changedBytes(),
      checks = save.report();
    $('editor-panel').innerHTML =
      `<div class="page-heading"><h1>Ready for your next run.</h1><p>Check your changes, download a backup, and export a verified battery save.</p></div><div class="review-stats"><div class="metric"><b>${save.history.length}</b><span>APPLIED OPERATIONS</span></div><div class="metric"><b>${count.toLocaleString()}</b><span>BYTES CHANGED</span></div><div class="metric"><b>${checks.filter(c => c.valid).length}/20</b><span>VALID SAVE SECTIONS</span></div></div><section class="panel"><div class="panel-heading"><h2>CHANGES THIS SESSION</h2><span>Undo is available in the toolbar</span></div>${save.history.length ? save.history.map((s, i) => `<div class="history-item">${String(i + 1).padStart(2, '0')} &nbsp; ${html(s)}</div>`).join('') : '<p class="field-help">No changes yet. An unchanged export is byte-for-byte identical to the original.</p>'}<div class="form-footer"><p>Original: ${html(filename)} · Output: 131,072 bytes</p><button id="reset-all" ${!count ? 'disabled' : ''}>Revert all edits</button></div></section><section class="panel"><div class="panel-heading"><h2>EXPORT</h2><span>Full file preserved</span></div><p class="notice">Close your emulator before replacing its save. Rename the downloaded file to match your ROM, then boot normally and choose Continue. An old savestate can overwrite the edited battery save.</p><div class="field-grid"><label class="field"><span>File name</span><input id="export-name" value="${html(exportName())}" maxlength="120" autocomplete="off" spellcheck="false"></label><label class="field"><span>Save extension</span><select id="extension"><option value="sav" ${filename.toLowerCase().endsWith('.sav') ? 'selected' : ''}>.sav</option><option value="srm" ${filename.toLowerCase().endsWith('.srm') ? 'selected' : ''}>.srm</option></select></label><div class="full-width actions-inline"><button id="review-backup">Download original backup</button><button id="review-export" class="primary" ${save.damaged.length ? 'disabled' : ''}>Download verified edited save</button></div></div></section><section class="panel"><div class="panel-heading"><h2>SECTION INTEGRITY</h2><span>Read again from exported bytes</span></div><table class="check-table"><thead><tr><th>SECTION</th><th>PHYSICAL SECTOR</th><th>STORED CHECKSUM</th><th>RESULT</th></tr></thead><tbody>${checks.map(c => `<tr><td>${c.id}</td><td>${c.slot}</td><td><code>${c.stored.toString(16).toUpperCase().padStart(4, '0')}</code></td><td class="${c.valid ? 'ok' : 'bad-text'}">${c.valid ? 'Valid' : 'Failed'}</td></tr>`).join('')}</tbody></table></section>`;
    $('review-backup').onclick = backup;
    $('export-name').oninput = e => (exportBase = e.target.value);
    $('review-export').onclick = () => exportSave($('extension').value);
    $('reset-all').onclick = () => {
      save.reset();
      refreshBoxSelect();
      resetSearch();
      dirty = false;
      sync();
      drawRoster();
      render();
      notify('Restored the original save.');
    };
  }
  function download(bytes, name, type = 'application/octet-stream') {
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.dataset.transientDownload = '';
    document.body.append(a);
    a.click();
    setTimeout(() => a.remove(), 0);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  function backup() {
    download(
      save.original,
      filename.replace(/\.(sav|srm)$/i, '') +
        '.original.' +
        (filename.toLowerCase().endsWith('.srm') ? 'srm' : 'sav'),
    );
    notify('Original backup downloaded.');
  }
  // Export name without extension. Characters that file systems reject are replaced.
  let exportBase = null;
  function exportName() {
    const fallback = filename.replace(/\.(sav|srm)$/i, '') + '.edited';
    const name = (exportBase ?? fallback)
      .replace(/\.(sav|srm)$/i, '')
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
      .trim();
    return name || fallback;
  }
  function exportSave(ext) {
    if (!guard(() => exportSave(ext))) return;
    try {
      const bytes = save.export();
      const suffix = ext || (filename.toLowerCase().endsWith('.srm') ? 'srm' : 'sav');
      download(bytes, `${exportName()}.${suffix}`);
      notify('Export verified: 20 valid sections, 128 KB.');
      sync();
    } catch (e) {
      fail(e);
    }
  }
  async function load(file) {
    if (!file) return;
    if (!guard()) {
      $('save-file').value = '';
      return;
    }
    if (file.size !== 131072) {
      $('save-file').value = '';
      fail(
        new Error(
          'Choose a 128 KB battery save (.sav or .srm). ROMs and savestates are not supported.',
        ),
      );
      return;
    }
    try {
      const next = new ERCore.Save(await file.arrayBuffer(), catalog);
      // Switch to the build this save most likely comes from (bundled data only).
      let switched = null;
      if (bundledVersionOf(catalog)) {
        const guess = ERCore.detectVersion(next, bundled, file.name, { '2.65.4.1b': '2.65.4' });
        if (guess && bundled[guess.version] !== catalog) {
          switched = guess;
          catalog = next.catalog = bundled[guess.version];
          buildLists();
          rememberVersion(guess.version);
        }
      }
      drawVersionPickers();
      cancelSearch();
      stopFinder();
      finder.results = [];
      finder.run = null;
      save = next;
      searchDrafts.clear();
      bagDraft.clear();
      dexDraft.clear();
      filename = file.name;
      exportBase = null;
      roster = 'party';
      ref = { kind: 'party', slot: 0 };
      tab = 'pokemon';
      box = 0;
      dirty = false;
      searchResults = [];
      $('welcome').hidden = true;
      $('workspace').hidden = false;
      $('filename').textContent = filename;
      $('roster-filter').value = '';
      $('box-select').innerHTML = Array.from(
        { length: 26 },
        (_, i) =>
          `<option value="${i}">${html(save.boxName(i))} · ${save.box(i).filter(m => m.species).length}/30</option>`,
      ).join('');
      sync();
      drawRoster();
      render();
      notify(
        save.damaged.length
          ? 'This save has checksum errors; editing is disabled.'
          : switched
            ? `Save loaded and checked. Switched to Elite Redux ${switched.version} data: ${
                switched.reason === 'moves'
                  ? 'your Pokémon know moves that only exist in that build'
                  : switched.reason === 'filename'
                    ? 'the file name says so'
                    : 'your party’s stats match that build'
              }. Change it next to the file name if that’s wrong.`
            : 'Save loaded and checked.',
        !!save.damaged.length,
      );
    } catch (e) {
      fail(e);
    } finally {
      $('save-file').value = '';
    }
  }
  $('save-file').onchange = e => load(e.target.files[0]);
  $('open-button').onclick = () => {
    if (guard(() => $('save-file').click())) $('save-file').click();
  };
  $('backup-button').onclick = backup;
  $('export-button').onclick = () => exportSave();
  $('demo-button').onclick = () =>
    load(new File([ERCore.demo(catalog)], 'Demo.sav', { type: 'application/octet-stream' }));
  $('undo-button').onclick = () => {
    if (guard()) {
      resetSearch();
      save.undo();
      refreshBoxSelect();
      sync();
      drawRoster();
      render();
    }
  };
  $('redo-button').onclick = () => {
    if (guard()) {
      resetSearch();
      save.redo();
      refreshBoxSelect();
      sync();
      drawRoster();
      render();
    }
  };
  document.querySelectorAll('[data-roster]').forEach(
    e =>
      (e.onclick = () => {
        if (!guard(() => e.click())) return;
        resetSearch();
        roster = e.dataset.roster;
        const mons = roster === 'party' ? save.party() : save.box(box).filter(m => m.species);
        ref = mons[0]?.ref || null;
        drawRoster();
        render();
      }),
  );
  $('box-select').onchange = e => {
    const wanted = e.target.value;
    if (
      !guard(() => {
        e.target.value = wanted;
        e.target.dispatchEvent(new Event('change'));
      })
    ) {
      e.target.value = box;
      return;
    }
    resetSearch();
    box = +e.target.value;
    ref = save.box(box).find(m => m.species)?.ref || null;
    drawRoster();
    render();
  };
  $('roster-toggle').onclick = () => {
    rosterOpen = !rosterOpen;
    drawRosterToggle();
  };
  $('roster-filter').oninput = () => drawRoster();
  $('roster-scope').onchange = () => drawRoster();
  for (const id of ['welcome-version', 'workspace-version'])
    $(id).onchange = e => chooseVersion(e.target.value, e.target);
  drawVersionPickers();
  document.querySelectorAll('[data-tab]').forEach(
    e =>
      (e.onclick = () => {
        if (!guard(() => e.click())) return;
        resetSearch();
        if (e.dataset.tab !== 'finder') stopFinder();
        tab = e.dataset.tab;
        render();
      }),
  );
  document.addEventListener('keydown', e => {
    if (
      !save ||
      !(e.ctrlKey || e.metaKey) ||
      e.key.toLowerCase() !== 'z' ||
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)
    )
      return;
    e.preventDefault();
    if (guard()) {
      resetSearch();
      if (e.shiftKey) save.redo();
      else save.undo();
      refreshBoxSelect();
      sync();
      drawRoster();
      render();
    }
  });
  for (const [button, dialog] of [
    ['privacy-button', 'privacy-dialog'],
    ['terms-button', 'terms-dialog'],
  ]) {
    $(button).onclick = () => showDialog($(dialog));
    $(dialog).querySelector('[data-close-legal]').onclick = () => closeDialog($(dialog));
  }
  $('help-button').onclick = () => showDialog($('help-dialog'));
  $('close-help').onclick = () => closeDialog($('help-dialog'));
  $('editor-panel').addEventListener('click', e => {
    const chooser = e.target.closest('[data-catalog-input]');
    if (chooser) {
      openCatalogPicker($(chooser.dataset.catalogInput));
      return;
    }
    const button = e.target.closest('[data-pick-ability]');
    if (button) openAbilityPicker(button.dataset.pickAbility, +button.dataset.pickIndex);
  });
  const dz = $('dropzone');
  dz.ondragover = e => {
    e.preventDefault();
    dz.classList.add('drag');
  };
  dz.ondragleave = () => dz.classList.remove('drag');
  dz.ondrop = e => {
    e.preventDefault();
    dz.classList.remove('drag');
    load(e.dataTransfer.files[0]);
  };
  $('offline-button').onclick = () => {
    const parsed = new DOMParser().parseFromString(document.documentElement.outerHTML, 'text/html');
    parsed.getElementById('welcome').removeAttribute('hidden');
    parsed.getElementById('workspace').setAttribute('hidden', '');
    parsed.getElementById('editor-panel').innerHTML = '';
    parsed.getElementById('roster-list').innerHTML = '';
    parsed.getElementById('filename').textContent = '';
    parsed.getElementById('save-meta').textContent = '';
    parsed.getElementById('health-banner').innerHTML = '';
    parsed.getElementById('box-select').innerHTML = '';
    parsed.getElementById('toast').setAttribute('hidden', '');
    parsed
      .querySelectorAll(
        'datalist,dialog:not(#help-dialog):not(#privacy-dialog):not(#terms-dialog),.dialog-backdrop,[data-transient-download]',
      )
      .forEach(e => e.remove());
    parsed.body.classList.remove('dialog-open');
    download(
      '<!doctype html>\n' + parsed.documentElement.outerHTML,
      'Redux Save Studio.html',
      'text/html',
    );
  };
  window.addEventListener('beforeunload', e => {
    if (dirty || save?.changedBytes()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
})();
