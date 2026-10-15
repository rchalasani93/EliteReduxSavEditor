(() => {
  'use strict';
  const $=id=>document.getElementById(id),html=ERHtml.escape;
  const builtin=JSON.parse($('catalog').textContent);let catalog=builtin,save=null,filename='save.sav',roster='party',box=0,ref=null,tab='pokemon',dirty=false,worker=null,workerUrl=null,searchResults=[],searchSession=null,matchMode='any',toastTimer;
  const pokemonIcons=JSON.parse($('pokemon-icons').textContent).images,searchDrafts=new Map();
  const typeColors=['#77796a','#ac634c','#7587a9','#986cba','#997759','#968454','#809147','#7968a4','#738997','#757575','#bc6755','#508fae','#629478','#aa934b','#b16990','#60a2b2','#766fa8','#626478','#ad80a0','#947361'];
  const statLabels=['HP','Attack','Defense','Sp. Atk','Sp. Def','Speed'];
  const ballNames=()=>Array.from({length:28},(_,id)=>id===0?'None':catalog.items[id]?.name||`Ball #${id}`);
  let indexes={},pickerEntries=[],catalogEntries={},catalogControlId=0;
  const touchLayout=()=>window.matchMedia('(max-width: 760px), (any-pointer: coarse)').matches;
  const catalogLabel=kind=>({species:'species',moves:'move',abilities:'ability',items:'item'}[kind]||kind);
  function updateViewport(){
    const viewport=window.visualViewport;
    document.documentElement.style.setProperty('--viewport-height',`${viewport?.height||window.innerHeight}px`);
    document.documentElement.style.setProperty('--viewport-top',`${viewport?.offsetTop||0}px`);
  }
  updateViewport();window.addEventListener('resize',updateViewport);
  window.visualViewport?.addEventListener('resize',updateViewport);
  window.visualViewport?.addEventListener('scroll',updateViewport);
  function closeDialog(dialog){
    if(typeof dialog.close==='function')dialog.close();
    else{dialog.removeAttribute('open');dialog.dispatchEvent(new Event('close'));}
  }
  function showDialog(dialog){
    if(dialog.hasAttribute('open'))return;
    const previous=document.activeElement;
    let backdrop;
    const trap=e=>{
      if(e.key==='Escape'){e.preventDefault();closeDialog(dialog);return;}
      if(e.key!=='Tab')return;
      const controls=[...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]')].filter(control=>control.getClientRects().length);
      const first=controls[0],last=controls[controls.length-1];
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
    };
    dialog.addEventListener('close',()=>{
      backdrop?.remove();dialog.removeEventListener('keydown',trap);
      if(!document.querySelector('dialog[open]'))document.body.classList.remove('dialog-open');
      if(previous?.isConnected)previous.focus({preventScroll:true});
    },{once:true});
    document.body.classList.add('dialog-open');updateViewport();
    if(typeof dialog.showModal==='function')dialog.showModal();
    else{
      backdrop=document.createElement('div');backdrop.className='dialog-backdrop';
      backdrop.onclick=()=>closeDialog(dialog);document.body.append(backdrop);
      dialog.setAttribute('open','');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');
      dialog.addEventListener('keydown',trap);dialog.querySelector('button')?.focus();
    }
  }
  function bindCatalogPickers(root=$('editor-panel')){
    root.querySelectorAll('input[list]').forEach(input=>{
      if(input.closest('.catalog-field'))return;
      if(!input.id)input.id=`catalog-control-${++catalogControlId}`;
      const kind=input.getAttribute('list').replace('list-','');
      if(!catalogEntries[kind])return;
      const button=document.createElement('button');button.type='button';button.className='catalog-browse';
      button.textContent='⌕';button.title=`Choose ${catalogLabel(kind)}`;
      button.setAttribute('aria-label',button.title);button.dataset.catalogInput=input.id;button.disabled=input.disabled;
      const wrapper=document.createElement('div');wrapper.className='catalog-field';
      const label=input.closest('label.field'),anchor=label||input;
      anchor.before(wrapper);wrapper.append(anchor,button);
    });
  }
  function openCatalogPicker(input){
    if(!input||input.disabled)return;
    const kind=input.getAttribute('list').replace('list-',''),entries=catalogEntries[kind];
    if(!entries)return;
    const dialog=document.createElement('dialog');dialog.id='catalog-picker';dialog.setAttribute('aria-labelledby','catalog-picker-title');
    dialog.innerHTML='<div class="dialog-head"><h2 id="catalog-picker-title"></h2><button type="button" class="icon-button" id="close-catalog-picker" aria-label="Close chooser">×</button></div><label class="field"><span>Search by name or ID</span><input id="catalog-picker-filter" type="search" autocomplete="off" autocapitalize="none" spellcheck="false" enterkeyhint="search"></label><p id="catalog-picker-count" class="field-help" aria-live="polite"></p><div class="picker-body"><div id="catalog-picker-options"></div></div><button type="button" class="picker-more" id="catalog-picker-more">Show more options</button>';
    dialog.querySelector('h2').textContent=`Choose ${catalogLabel(kind)}`;
    document.body.append(dialog);
    const filter=dialog.querySelector('#catalog-picker-filter'),list=dialog.querySelector('#catalog-picker-options'),count=dialog.querySelector('#catalog-picker-count'),more=dialog.querySelector('#catalog-picker-more');
    let matches=entries,shown=0,frame;
    const append=()=>{
      const fragment=document.createDocumentFragment(),next=matches.slice(shown,shown+40);shown+=next.length;
      for(const entry of next){
        const button=document.createElement('button');button.type='button';button.className='picker-option';
        const text=document.createElement('span'),name=document.createElement('b'),detail=document.createElement('small');
        name.textContent=entry.value.name;detail.textContent=`#${entry.value.id}${entry.value.desc?' · '+entry.value.desc:''}`;
        text.append(name,detail);button.append(text);
        button.onclick=()=>{
          closeDialog(dialog);if(!input.isConnected)return;
          input.value=display(entry.value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
          if(!touchLayout())input.focus({preventScroll:true});
        };
        fragment.append(button);
      }
      list.append(fragment);count.textContent=`Showing ${shown} of ${matches.length.toLocaleString()} options`;
      more.hidden=shown>=matches.length;
    };
    const draw=()=>{
      const query=filter.value.trim().toLocaleLowerCase();matches=query?entries.filter(entry=>entry.search.includes(query)):entries;
      shown=0;list.replaceChildren();dialog.querySelector('.picker-body').scrollTop=0;append();
      if(!matches.length){const empty=document.createElement('p');empty.className='picker-help';empty.textContent='No options match your search.';list.append(empty);}
    };
    filter.oninput=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(draw);};more.onclick=append;
    dialog.querySelector('#close-catalog-picker').onclick=()=>closeDialog(dialog);
    dialog.addEventListener('close',()=>{cancelAnimationFrame(frame);dialog.remove();},{once:true});
    showDialog(dialog);draw();if(!touchLayout())filter.focus();
  }
  function notify(message,error=false){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').className=error?'error':'';$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,error?8500:4000);}
  function guard(){if(dirty){notify('Apply or discard your pending changes before switching views or exporting.',true);return false;}return true;}
  function fail(error){notify(error.message||String(error),true);}
  function display(entry){return entry?`${entry.name} · #${entry.id}`:'';}
  function resolve(kind,value,allowNone=false){
    const t=value.trim();if(allowNone&&!t)return 0;
    const number=/^(?:#)?(\d+)$/.exec(t)||/· #(\d+)$/.exec(t);let id=number?+number[1]:indexes[kind].get(t.toLocaleLowerCase());
    if(id===undefined||!catalog[kind][id])throw new Error(`Choose a valid ${catalogLabel(kind)} from the list, or enter its numeric ID.`);return id;
  }
  function buildLists(){
    document.querySelectorAll('datalist').forEach(e=>e.remove());indexes={};
    for(const kind of ['species','moves','abilities','items']){
      indexes[kind]=new Map();const list=document.createElement('datalist');list.id=`list-${kind}`;
      const entries=Object.values(catalog[kind]).sort((a,b)=>a.name.localeCompare(b.name));
      catalogEntries[kind]=entries.map(value=>({value,search:`${value.name} ${value.id}`.toLocaleLowerCase()}));
      if(kind==='abilities'){
        const banned=new Set(catalog.config.banned);
        pickerEntries=entries.filter(a=>a.id>0&&a.id<=catalog.config.modulus&&!banned.has(a.id)).map(a=>({id:a.id,search:`${a.name} ${a.desc||''} ${a.id}`.toLocaleLowerCase(),markup:`<button type="button" class="picker-option" data-target-ability="${html(a.id)}"><span><b>${html(a.name)}</b><small>${html(a.desc||'No description available.')}</small></span><span class="picker-select">Select for search</span></button>`}));
      }
      list.innerHTML=entries.map(e=>{indexes[kind].set(e.name.toLocaleLowerCase(),e.id);indexes[kind].set(display(e).toLocaleLowerCase(),e.id);return `<option value="${html(display(e))}"></option>`;}).join('');document.body.append(list);
    }
  }
  buildLists();
  const numberField=(label,name,value,min,max)=>`<label class="field"><span>${html(label)}</span><input name="${html(name)}" type="number" value="${html(value)}" min="${html(min)}" max="${html(max)}" required></label>`;
  const catalogField=(label,name,kind,id)=>`<label class="field"><span>${label}</span><input name="${name}" list="list-${kind}" value="${html(display(catalog[kind][id])||`#${id}`)}" autocomplete="off" required></label>`;
  const selectField=(label,name,value,entries)=>`<label class="field"><span>${label}</span><select name="${name}">${entries.map((e,i)=>`<option value="${i}"${i===value?' selected':''}>${html(e)}</option>`).join('')}</select></label>`;
  const typeTags=types=>[...new Set(types)].map(i=>`<span class="type" style="--type:${typeColors[i]||'#777'}">${html(catalog.types[i]||'None')}</span>`).join('');
  function pokemonIcon(species){
    const image=ERHtml.pngSource(pokemonIcons[species?.key]);
    return `<span class="mon-emblem" aria-hidden="true">${image?`<img src="${html(image)}" alt="" width="64" height="64" decoding="async">`:'<span class="unknown-mon-icon"></span>'}</span>`;
  }
  function searchDraft(){
    const key=`${ref?.kind}:${ref?.box??''}:${ref?.slot}`;
    if(!searchDrafts.has(key))searchDrafts.set(key,{targets:['','','',''],matchMode:'any',lockSlot:false,keepGender:true});
    return searchDrafts.get(key);
  }
  function rememberSearchDraft(){
    if(!$('target-0'))return;
    Object.assign(searchDraft(),{targets:[0,1,2,3].map(i=>$('target-'+i).value),matchMode:$('match-any-order').checked?'any':'slots',lockSlot:$('lock-slot').checked,keepGender:$('keep-gender').checked});
  }
  function options(){return save.options();}
  function mon(){return ref?save.mon(ref):null;}
  function abilityChoices(species,pid,opts=options(),config=catalog.config){
    return [0,1,2].map(slot=>ERRng.evaluate(species,pid,slot,opts,config).ability);
  }
  function abilityCards(m,species=catalog.species[m.species],preview=false){
    const opts=options(),r=ERRng.evaluate(species,m.pid,m.abilitySlot,opts,catalog.config),choices=abilityChoices(species,m.pid,opts);
    const card=(id,label,randomized,slot,innateIndex)=>{
      const equipped=slot===m.abilitySlot,choice=slot!==undefined;
      const picker=preview?'':`<button type="button" class="ability-reload" data-pick-ability="${choice?'ability':'innate'}" data-pick-index="${choice?slot:innateIndex}" aria-label="Choose ${choice?'ability':'innate'} ${(choice?slot:innateIndex)+1}" title="Choose an available ability">↻</button>`;
      return `<div class="ability-card${choice&&equipped?' is-equipped':''}"${choice?` data-ability-choice="${slot}" data-equipped="${equipped}"`:''}><div class="slot-name"><span>${label}${picker}${preview&&randomized?' ↻':''}</span>${choice&&equipped?`<span class="equipped-badge">${preview?'Preview selection':'Equipped'}</span>`:''}</div><b>${html(catalog.abilities[id]?.name||`#${id}`)}</b><small>${html(catalog.abilities[id]?.desc||'No description available.')}</small></div>`;
    };
    return `<section class="ability-group" aria-label="Ability choices"><div class="ability-group-heading"><h2>ABILITY CHOICES</h2><span>${preview?'Preview only':'One equipped at a time'}</span></div><div class="abilities-list">${choices.map((id,i)=>card(id,`ABILITY ${i+1}`,opts.abilityRng,i)).join('')}</div></section><section class="ability-group" aria-label="Innate abilities"><div class="ability-group-heading"><h2>INNATES</h2></div><div class="abilities-list">${r.innates.map((id,i)=>card(id,`INNATE ${i+1}`,opts.innateRng,undefined,i)).join('')}</div></section>`;
  }
  function openAbilityPicker(kind,index){
    if(!guard())return;rememberSearchDraft();
    const m=mon(),species=catalog.species[m.species],choices=abilityChoices(species,m.pid),opts=options();
    const source=kind==='ability'?(species.abilities[index]||species.abilities[0]||0):species.innates[index];
    const variable=!!(kind==='ability'?opts.abilityRng:opts.innateRng)&&!catalog.config.banned.includes(source);
    const dialog=document.createElement('dialog');dialog.id='ability-picker';dialog.setAttribute('aria-labelledby','ability-picker-title');
    dialog.innerHTML=`<div class="dialog-head"><div><h2 id="ability-picker-title">Choose ${kind==='ability'?'an ability':'an innate'}</h2><p>${html(species.name)} · ${kind==='ability'?`Ability ${index+1}`:`Innate ${index+1}`}</p></div><button type="button" class="icon-button" id="close-ability-picker" aria-label="Close ability picker">×</button></div><div class="picker-body">${kind==='ability'?`<h3>AVAILABLE NOW</h3><p class="picker-help">Equip one of this Pokémon’s three current choices.</p><div class="picker-current-grid">${choices.map((id,slot)=>`<button type="button" data-equip-choice="${slot}" ${slot===m.abilitySlot?'disabled':''}><span>Slot ${slot+1}${slot===m.abilitySlot?' · Equipped':''}</span><b>${html(catalog.abilities[id]?.name||id)}</b><small>${html(catalog.abilities[id]?.desc||'')}</small></button>`).join('')}</div>`:''}${variable?`<h3>FIND A NEW COMBINATION</h3><p class="picker-help">Choose an ability to add to your combination search. Find a matching PID to apply it together with your other targets.</p><label class="field"><span>Search abilities</span><input id="ability-picker-filter" type="search" placeholder="Search by name, description, or ID" autocomplete="off"></label><p id="ability-picker-count" class="field-help" aria-live="polite"></p><div id="ability-picker-options" aria-label="Searchable abilities"></div>`:`<p class="notice">${catalog.config.banned.includes(source)?'This slot is excluded from ability randomization.':`The ${kind==='ability'?'ability':'innate'} randomizer is off in this save.`} ${kind==='ability'?'You can equip any of the current choices above.':'This innate stays fixed.'}</p>`}</div>`;
    let drawFrame;
    document.body.append(dialog);dialog.addEventListener('close',()=>{cancelAnimationFrame(drawFrame);dialog.remove();},{once:true});$('close-ability-picker').onclick=()=>closeDialog(dialog);
    dialog.querySelectorAll('[data-equip-choice]').forEach(button=>button.onclick=()=>{
      const slot=+button.dataset.equipChoice;closeDialog(dialog);
      apply(()=>save.editMon(ref,{abilitySlot:slot},`Equip ability ${slot+1} on ${m.nickname}`),'Equipped ability updated. Your search fields are preserved.');
    });
    if(variable){
      const filter=dialog.querySelector('#ability-picker-filter'),list=dialog.querySelector('#ability-picker-options'),count=dialog.querySelector('#ability-picker-count');
      const more=document.createElement('button');more.type='button';more.id='ability-picker-more';more.className='picker-more';more.textContent='Show more abilities';more.hidden=true;list.after(more);
      let matches=[],shown=0;
      const append=()=>{
        if(!dialog.hasAttribute('open'))return;
        const next=matches.slice(shown,shown+40);shown+=next.length;
        list.insertAdjacentHTML('beforeend',next.map(a=>a.markup).join(''));
        count.textContent=shown<matches.length?`Showing ${shown} of ${matches.length.toLocaleString()} abilities · Search covers the full list`:`${matches.length.toLocaleString()} searchable ${matches.length===1?'ability':'abilities'}`;
        more.hidden=shown>=matches.length;
      };
      const draw=()=>{
        if(!dialog.hasAttribute('open'))return;
        const query=filter.value.trim().toLocaleLowerCase();matches=query?pickerEntries.filter(a=>a.search.includes(query)):pickerEntries;shown=0;
        list.replaceChildren();list.scrollTop=0;append();
        if(!matches.length)list.innerHTML='<p class="picker-help">No abilities match your search.</p>';
      };
      list.onclick=e=>{
        const button=e.target.closest('[data-target-ability]');if(button){
          const ability=catalog.abilities[+button.dataset.targetAbility],draft=searchDraft(),preferred=kind==='ability'?0:index+1;
          const empty=draft.targets.findIndex(target=>!target.trim()),field=draft.matchMode==='any'&&draft.targets[preferred].trim()&&empty>=0?empty:preferred;
          draft.targets[field]=display(ability);closeDialog(dialog);resetSearch();tab='randomizer';render();
          if(!touchLayout())$('target-'+field).focus();$('search-button').scrollIntoView({block:'center'});notify(`${ability.name} selected. Find combinations to apply it.`);
        }
      };
      filter.oninput=()=>{cancelAnimationFrame(drawFrame);drawFrame=requestAnimationFrame(draw);};
      list.onscroll=()=>{if(shown<matches.length&&list.scrollHeight-list.scrollTop-list.clientHeight<100)append();};more.onclick=append;
      // Let the modal open before creating its first small batch of options.
      drawFrame=requestAnimationFrame(draw);
    }
    showDialog(dialog);if(variable&&!touchLayout())$('ability-picker-filter').focus();
  }
  function heading(m,species=catalog.species[m.species]){
    const r=ERRng.evaluate(species,m.pid,m.abilitySlot,options(),catalog.config);
    return `<div class="mon-heading"><div class="mon-identity">${pokemonIcon(species)}<div><h1>${html(m.nickname||species.name)} ${m.shiny?'✦':''}</h1><p>${html(species.name)} · Lv. ${m.level} · ${ERRng.gender(catalog.species[m.species],m.pid)} · ${ref.kind==='party'?`Party slot ${ref.slot+1}`:`${html(save.boxName(ref.box))}, slot ${ref.slot+1}`}</p><div class="types">${typeTags(r.types)}</div></div></div><span class="pill">${html(catalog.natures[m.nature])} nature</span></div>`;
  }
  function sync(){
    $('undo-button').disabled=!save.undoStack.length||dirty;$('redo-button').disabled=!save.redoStack.length||dirty;$('export-button').disabled=!!save.damaged.length||dirty;
    $('export-button').innerHTML=`Export .${filename.toLowerCase().endsWith('.srm')?'srm':'sav'} <span>↗</span>`;
    const n=save.changedBytes();$('change-count').textContent=save.history.length;
    const t=save.trainer();$('save-meta').textContent=`Trainer ${t.name} · ${t.hours}h ${String(t.minutes).padStart(2,'0')}m · 128 KB · ${dirty?'Pending changes':n?`${n} bytes changed`:'Original loaded'}`;
    $('health-banner').className=`health-banner${save.damaged.length?' bad':''}`;
    $('health-banner').innerHTML=save.damaged.length?`<span>⚠ ${save.damaged.length} section checksum(s) failed. Editing is disabled; restore a backup.</span>`:`<span>✓ All 20 section checksums pass${save.invalidSlots().length?` · ⚠ ${save.invalidSlots().length} unrecognised Pokémon locked`:''}</span><span class="secondary-text">Save counter ${save.counter} · Level cap ${save.cap()} · ${html(catalog.version)} catalog</span>`;
  }
  function drawRoster(){drawRosterActions();
    document.querySelectorAll('[data-roster]').forEach(e=>e.classList.toggle('active',e.dataset.roster===roster));$('box-controls').hidden=roster!=='box';
    const all=roster==='party'?save.party():save.box(box).filter(m=>m.species);
    const filter=$('roster-filter').value.toLocaleLowerCase();const mons=all.filter(m=>(m.nickname+' '+(catalog.species[m.species]?.name||'')).toLocaleLowerCase().includes(filter));
    $('roster-count').textContent=`${all.length} Pokémon`;
    $('roster-list').innerHTML=mons.length?mons.map(m=>{const s=catalog.species[m.species];const active=ref&&ref.kind===m.ref.kind&&ref.slot===m.ref.slot&&(m.ref.kind==='party'||ref.box===m.ref.box);return `<button class="roster-item${active?' active':''}" data-slot="${m.ref.slot}" aria-pressed="${active}">${pokemonIcon(s)}<span class="roster-name"><b>${html(m.nickname||s?.name||'Unknown')} ${m.shiny?'✦':''}</b><small>${html(s?.name||`Species #${m.species}`)}</small></span><span class="level">${m.level}</span></button>`;}).join(''):`<div class="empty-box">${all.length?'No matching Pokémon.':'This box is empty.'}</div>`;
    $('roster-list').querySelectorAll('[data-slot]').forEach(e=>e.onclick=()=>{if(!guard())return;resetSearch();ref=roster==='party'?{kind:'party',slot:+e.dataset.slot}:{kind:'box',box,slot:+e.dataset.slot};searchResults=[];drawRoster();render();});
  }
  function bindDirty(form){form.addEventListener('input',()=>{dirty=true;sync();});form.addEventListener('change',()=>{dirty=true;sync();});form.querySelector('[data-discard]')?.addEventListener('click',()=>{dirty=false;render();sync();});}
  function apply(fn,message,{keepSearch=false}={}){try{rememberSearchDraft();fn();if(!keepSearch)resetSearch();dirty=false;sync();drawRoster();render();notify(message);}catch(e){fail(e);}}
  function render(){
    document.querySelectorAll('[data-tab]').forEach(e=>e.classList.toggle('active',e.dataset.tab===tab));
    if(tab==='settings'){renderSettings();bindCatalogPickers();return;}if(tab==='review'){renderReview();return;}if(tab==='trainer'){renderTrainer();return;}
    const m=mon();if(!m||!m.species){$('editor-panel').innerHTML='<div class="panel empty-box">Select a Pokémon from your roster.</div>';return;}
    try{save.assertMon(m);}catch(e){$('editor-panel').innerHTML=`<div class="notice warning">${html(e.message)} Choose another Pokémon.</div>`;return;}
    if(tab==='randomizer')renderRandomizer(m);else renderPokemon(m);bindCatalogPickers();
  }
  function renderPokemon(m){
    const s=catalog.species[m.species],stats=ERCore.calcStats(m,s,options(),options().difficulty===3&&save.flag(2893));
    $('editor-panel').innerHTML=`${heading(m)}${monActions()}<div class="ability-overview" id="pokemon-abilities">${abilityCards(m)}</div><form id="pokemon-form"><fieldset ${save.damaged.length?'disabled':''} style="border:0;padding:0;margin:0">
    <section class="panel"><div class="panel-heading"><h2>IDENTITY & DETAILS</h2><span>PID ${m.pid.toString(16).toUpperCase().padStart(8,'0')}</span></div><div class="field-grid">
    ${catalogField('Species','species','species',m.species)}<label class="field"><span>Nickname · up to 12 characters</span><input name="nickname" value="${html(m.nickname)}" maxlength="12" required></label>${numberField(`Level · current cap ${save.cap()}`,'level',m.level,1,100)}
    ${selectField('Nature','nature',m.nature,catalog.natures)}${catalogField('Held item','heldItem','items',m.heldItem)}${selectField('Equipped ability','abilitySlot',m.abilitySlot,abilityChoices(s,m.pid).map((id,i)=>`Slot ${i+1} — ${catalog.abilities[id]?.name||`#${id}`}`))}
    ${numberField('Friendship','friendship',m.friendship,0,255)}${selectField('Poké Ball','ball',m.ball,ballNames())}${selectField('Shininess','shiny',m.shiny,['Normal','Star shiny','Square shiny','Special palette'])}
    ${selectField('Hidden Power type','hpType',m.hpType,[...catalog.types,'None'])}${numberField('Met level','metLevel',m.metLevel,0,100)}
    </div><div class="checkrow"><label><input name="egg" type="checkbox" ${m.egg?'checked':''}> Egg</label><label><input name="speedDown" type="checkbox" ${m.speedDown?'checked':''}> Zero Speed IV</label></div><p class="field-help">Species or PID changes can alter randomized abilities. Level changes write experience and refresh party stats.</p></section>
    ${originPanel(m)}${ref.kind==='party'?conditionPanel(m):''}
    <div class="two-columns"><section class="panel"><div class="panel-heading"><h2>STATS & EVS</h2><span>IVs are fixed at 31 in Redux</span></div><table class="stat-table"><thead><tr><th>STAT</th><th>BASE</th><th></th><th>IV</th><th>EV</th><th>FINAL</th></tr></thead><tbody>${statLabels.map((label,i)=>`<tr><td>${label}</td><td>${html(s.base[i])}</td><td><div class="stat-bar"><i style="width:${Math.min(100,s.base[i]/2.55)}%"></i></div></td><td>${(options().difficulty===3&&save.flag(2893))||(i===5&&m.speedDown)?0:31}</td><td><input type="number" name="ev${i}" aria-label="${label} EV" value="${m.evs[i]}" min="0" max="252" required></td><td>${stats[i]}</td></tr>`).join('')}</tbody></table><div class="form-footer"><span id="ev-total" class="ev-total">${m.evs.reduce((a,b)=>a+b,0)} / 510 EVs</span><div class="actions-inline"><button type="button" data-ev="physical">Physical</button><button type="button" data-ev="special">Special</button><button type="button" data-ev="reset">Clear</button></div></div><p class="field-help">EVs ${options().enableEvs?'enabled':'disabled in this save'}. Final stats are calculated for the current build. ${ref.kind==='party'?`HP ${m.hp}/${m.stats[0]}.`:'Box Pokémon recalculate their stats when withdrawn.'}</p></section>
    <section class="panel"><div class="panel-heading"><h2>MOVESET</h2><span>${ref.kind==='party'?'MOVE / CURRENT PP':'MOVE'}</span></div><div class="moves-list">${m.moves.map((id,i)=>{const move=catalog.moves[id];return `<div class="move-row"><span class="ordinal">0${i+1}</span><input name="move${i+1}" list="list-moves" value="${html(display(move))}" autocomplete="off" aria-label="Move ${i+1}" required>${ref.kind==='party'?`<input name="pp${i}" type="number" value="${m.pp[i]}" min="0" max="${html(ERCore.maxPP(move))}" aria-label="Move ${i+1} PP" required>`:'<span></span>'}<div class="move-meta" id="move-meta-${i}">${typeTags(move.types)}<span>${move.power?`${html(move.power)} power · `:''}${html(ERCore.maxPP(move))} max PP</span></div></div>`;}).join('')}</div><div class="form-footer"><p>All ${Object.keys(catalog.moves).length} moves, including IDs above 999.</p>${ref.kind==='party'?'<button type="button" id="max-pp">Restore PP</button>':''}</div></section></div>
    <div class="panel form-footer"><p id="pending-note">Apply commits the whole Pokémon form. Ctrl+Z undoes it.</p><div class="actions-inline">${ref.kind==='party'?'<button type="button" id="heal-button">Heal Pokémon</button>':''}<button type="button" data-discard>Discard draft</button><button type="submit" class="primary">Apply Pokémon changes</button></div></div>
    </fieldset></form>`;
    bindMonActions(m);const form=$('pokemon-form');bindDirty(form);
    const evUpdate=()=>{$('ev-total').textContent=`${statLabels.reduce((sum,_,i)=>sum+(+form.elements[`ev${i}`].value||0),0)} / 510 EVs`;};
    form.querySelectorAll('[name^=ev]').forEach(e=>e.addEventListener('input',evUpdate));
    form.querySelectorAll('[data-ev]').forEach(e=>e.onclick=()=>{const spread=e.dataset.ev==='physical'?[4,252,0,0,0,252]:e.dataset.ev==='special'?[4,0,0,252,0,252]:[0,0,0,0,0,0];spread.forEach((n,i)=>form.elements[`ev${i}`].value=n);dirty=true;evUpdate();sync();});
    for(let i=0;i<4;i++)form.elements[`move${i+1}`].addEventListener('change',()=>{try{const id=resolve('moves',form.elements[`move${i+1}`].value),move=catalog.moves[id];$('move-meta-'+i).innerHTML=typeTags(move.types)+`<span>${move.power?`${html(move.power)} power · `:''}${html(ERCore.maxPP(move))} max PP</span>`;if(ref.kind==='party'){form.elements[`pp${i}`].max=ERCore.maxPP(move);form.elements[`pp${i}`].value=ERCore.maxPP(move);}}catch(e){fail(e);}});
    $('max-pp')?.addEventListener('click',()=>{try{for(let i=0;i<4;i++)form.elements[`pp${i}`].value=ERCore.maxPP(catalog.moves[resolve('moves',form.elements[`move${i+1}`].value)]);dirty=true;sync();}catch(e){fail(e);}});
    $('heal-button')?.addEventListener('click',()=>{if(guard())apply(()=>save.heal(ref),'Pokémon healed.');});
    form.onsubmit=e=>{e.preventDefault();try{const get=name=>form.elements[name].value,patch={nickname:get('nickname'),species:resolve('species',get('species')),level:+get('level'),nature:+get('nature'),heldItem:resolve('items',get('heldItem')),abilitySlot:+get('abilitySlot'),friendship:+get('friendship'),ball:+get('ball'),shiny:+get('shiny'),hpType:+get('hpType'),metLevel:+get('metLevel'),egg:+form.elements.egg.checked,speedDown:+form.elements.speedDown.checked,evs:statLabels.map((_,i)=>+get(`ev${i}`))};if(patch.shiny!==m.shiny)patch.maxShiny=Math.max(m.maxShiny,patch.shiny);Object.assign(patch,originPatch(form,m));if(ref.kind==='party')Object.assign(patch,conditionPatch(form,m));for(let i=0;i<4;i++)patch[`move${i+1}`]=resolve('moves',get(`move${i+1}`));if(ref.kind==='party')patch.pp=m.moves.map((_,i)=>+get(`pp${i}`));apply(()=>save.editMon(ref,patch,`Edit ${m.nickname||s.name} (${ref.kind==='party'?'party':`box ${ref.box+1}`}, slot ${ref.slot+1})`),'Pokémon changes applied.');}catch(error){fail(error);}};
  }
  // ---- Trainer & origin fields --------------------------------------------------------------
  const MARKINGS=['●','■','▲','♥'];
  const STATUS_CHOICES=[['none','Healthy'],['sleep','Asleep'],['poison','Poisoned'],['toxic','Badly poisoned'],['burn','Burned'],['freeze','Frozen'],['paralysis','Paralyzed'],['frostbite','Frostbite'],['bleed','Bleeding']];
  function statusKey(value){if(!value)return 'none';if(value&7)return 'sleep';const flag=value&~0xf00;for(const [k]of STATUS_CHOICES)if(ERCore.STATUS[k]===flag)return k;return 'keep';}
  function statusValue(key,current){if(key==='keep')return current;if(key==='sleep')return current&7?current&7:3;return ERCore.STATUS[key];}
  function languageField(value){return `<label class="field"><span>Language</span><select name="language">${Object.entries(ERCore.LANGUAGES).map(([id,name])=>`<option value="${id}"${+id===value?' selected':''}>${html(name)}</option>`).join('')}${ERCore.LANGUAGES[value]?'':`<option value="${value}" selected>Unknown (${value})</option>`}</select></label>`;}
  function originPanel(m){
    return `<section class="panel"><div class="panel-heading"><h2>TRAINER & ORIGIN</h2><span>Changing OT name or ID makes the game treat it as traded</span></div><div class="field-grid">
    <label class="field"><span>OT name · up to 7 characters</span><input name="otName" value="${html(m.otName)}" maxlength="7" required></label>${numberField('OT trainer ID','otTid',m.otid&0xffff,0,65535)}${numberField('OT secret ID','otSid',m.otid>>>16,0,65535)}
    ${selectField('OT gender','otGender',m.otGender,['Male','Female'])}${numberField('Met location ID','metLocation',m.metLocation,0,255)}${languageField(m.language)}
    </div><div class="checkrow"><span class="check-label">Markings</span>${MARKINGS.map((mk,i)=>`<label><input name="mark${i}" type="checkbox" ${m.markings>>i&1?'checked':''}> ${mk}</label>`).join('')}<label><input name="alpha" type="checkbox" ${m.alpha?'checked':''}> Alpha</label><label><input name="eventMon" type="checkbox" ${m.eventMon?'checked':''}> Fateful encounter</label></div><p class="field-help">Your trainer: ${html(save.trainerCard().name)} · ID ${save.trainerCard().tid} / ${save.trainerCard().sid}. Pokémon with a different OT may disobey at high levels.</p></section>`;
  }
  function conditionPanel(m){
    const key=statusKey(m.status);
    return `<section class="panel"><div class="panel-heading"><h2>CONDITION</h2><span>Party only</span></div><div class="field-grid">${numberField(`Current HP · max ${m.stats[0]}`,'hp',m.hp,0,m.stats[0])}<label class="field"><span>Status condition</span><select name="status">${key==='keep'?`<option value="keep" selected>Other (0x${m.status.toString(16)})</option>`:''}${STATUS_CHOICES.map(([k,l])=>`<option value="${k}"${k===key?' selected':''}>${l}</option>`).join('')}</select></label></div><p class="field-help">A Pokémon at 0 HP is fainted. Level, species, nature or EV changes rescale HP automatically.</p></section>`;
  }
  function wholeNumber(value,label,min,max){const n=Number(value);if(!Number.isInteger(n)||n<min||n>max)throw new Error(`${label} must be a whole number from ${min} to ${max}.`);return n;}
  function originPatch(form,m){
    const get=n=>form.elements[n].value,tid=wholeNumber(get('otTid'),'OT trainer ID',0,65535),sid=wholeNumber(get('otSid'),'OT secret ID',0,65535);
    return {otName:get('otName'),otid:((sid<<16)|tid)>>>0,otGender:+get('otGender'),metLocation:wholeNumber(get('metLocation'),'Met location',0,255),language:+get('language'),
      markings:MARKINGS.reduce((sum,_,i)=>sum|(form.elements[`mark${i}`].checked?1<<i:0),0),alpha:+form.elements.alpha.checked,eventMon:+form.elements.eventMon.checked};
  }
  function conditionPatch(form,m){
    const patch={},hp=wholeNumber(form.elements.hp.value,'Current HP',0,65535),status=statusValue(form.elements.status.value,m.status);
    if(hp!==m.hp)patch.hp=hp;if(status!==m.status)patch.status=status;return patch;
  }
  // ---- Generic dialog ----------------------------------------------------------------------
  function openDialog(title,subtitle,body){
    const dialog=document.createElement('dialog');dialog.className='tool-dialog';dialog.setAttribute('aria-labelledby','tool-dialog-title');
    dialog.innerHTML=`<div class="dialog-head"><div><h2 id="tool-dialog-title"></h2>${subtitle?'<p class="dialog-sub"></p>':''}</div><button type="button" class="icon-button" data-close aria-label="Close">×</button></div><div class="dialog-body">${body}</div>`;
    dialog.querySelector('h2').textContent=title;if(subtitle)dialog.querySelector('.dialog-sub').textContent=subtitle;
    document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});
    dialog.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>closeDialog(dialog));bindCatalogPickers(dialog);dialog.addEventListener('click',e=>{const chooser=e.target.closest('[data-catalog-input]');if(chooser)openCatalogPicker(dialog.querySelector('#'+CSS.escape(chooser.dataset.catalogInput)));});
    showDialog(dialog);return dialog;
  }
  // ---- Destination picker (party / box + slot) ---------------------------------------------
  function slotLabel(target){const m=save.mon(target);return m.species?`${m.nickname||catalog.species[m.species]?.name||'Pokémon'} (${catalog.species[m.species]?.name||'#'+m.species})`:'empty';}
  function destinationFields(defaultTarget,{allowOccupied=false,exclude=null}={}){
    return `<div class="field-grid two-up"><label class="field"><span>Destination</span><select data-dest-where><option value="party">Party</option>${Array.from({length:26},(_,b)=>`<option value="${b}">${html(save.boxName(b))} · ${save.box(b).filter(m=>m.species).length}/30</option>`).join('')}</select></label><label class="field"><span>Slot</span><select data-dest-slot></select></label></div>`;
  }
  function bindDestination(dialog,defaultTarget,{allowOccupied=false,exclude=null}={}){
    const where=dialog.querySelector('[data-dest-where]'),slot=dialog.querySelector('[data-dest-slot]');
    const same=(a,b)=>a&&b&&a.kind===b.kind&&a.slot===b.slot&&(a.kind==='party'||a.box===b.box);
    const fill=(preferred)=>{
      const party=where.value==='party',count=party?Math.min(6,save.partyCount+1):30;let firstFree=-1;
      slot.innerHTML=Array.from({length:count},(_,i)=>{
        const target=party?{kind:'party',slot:i}:{kind:'box',box:+where.value,slot:i},occupied=party?i<save.partyCount:!!save.mon(target).species;
        const disabled=same(target,exclude)||(occupied&&!allowOccupied);if(!occupied&&firstFree<0&&!disabled)firstFree=i;
        return `<option value="${i}"${disabled?' disabled':''}>Slot ${i+1} · ${occupied?html(slotLabel(target))+(allowOccupied&&!same(target,exclude)?' — swap':''):'empty'}</option>`;
      }).join('');
      const pick=preferred!==undefined&&!slot.options[preferred]?.disabled?preferred:firstFree>=0?firstFree:[...slot.options].findIndex(o=>!o.disabled);
      slot.value=String(Math.max(0,pick));
    };
    where.value=defaultTarget.kind==='party'?'party':String(defaultTarget.box);fill(defaultTarget.slot);
    where.onchange=()=>fill();
    return ()=>{if(slot.selectedOptions[0]?.disabled||!slot.options.length)throw new Error('Choose an available slot.');return where.value==='party'?{kind:'party',slot:+slot.value}:{kind:'box',box:+where.value,slot:+slot.value};};
  }
  function defaultDestination(){if(save.partyCount<6&&roster==='party')return {kind:'party',slot:save.partyCount};return save.firstEmptyBox(roster==='box'?box:0)||{kind:'box',box:roster==='box'?box:0,slot:0};}
  function selectTarget(target){ref=target;roster=target.kind;if(target.kind==='box'){box=target.box;$('box-select').value=String(box);}}
  function refreshBoxSelect(){$('box-select').innerHTML=Array.from({length:26},(_,i)=>`<option value="${i}">${html(save.boxName(i))} · ${save.box(i).filter(m=>m.species).length}/30</option>`).join('');$('box-select').value=String(box);}
  function applyStructural(fn,message){try{rememberSearchDraft();const target=fn();resetSearch();if(target)selectTarget(target);else if(ref&&!save.occupied(ref))ref=null;if(!ref){const mons=roster==='party'?save.party():save.box(box).filter(m=>m.species);ref=mons[0]?.ref||null;}refreshBoxSelect();dirty=false;sync();drawRoster();render();notify(message);}catch(e){fail(e);}}
  // ---- Pokémon actions ----------------------------------------------------------------------
  function monActions(){return `<div class="mon-actions" role="toolbar" aria-label="Pokémon actions"><button type="button" id="move-mon">Move or swap…</button><button type="button" id="duplicate-mon">Duplicate</button><button type="button" id="export-mon">Copy Showdown set</button><button type="button" id="release-mon" class="danger">Release…</button></div>`;}
  function bindMonActions(m){
    const disabled=!!save.damaged.length;document.querySelectorAll('.mon-actions button').forEach(b=>b.disabled=disabled);
    $('move-mon').onclick=()=>{if(guard())openMoveDialog(m);};
    $('duplicate-mon').onclick=()=>{if(guard())applyStructural(()=>save.duplicateMon(ref,{kind:'box',box:roster==='box'?box:0}),`${m.nickname} duplicated into the first free PC slot.`);};
    $('export-mon').onclick=()=>openExportDialog(m);
    $('release-mon').onclick=()=>{if(guard())openReleaseDialog(m);};
  }
  function openMoveDialog(m){
    const from={...ref},dialog=openDialog('Move or swap',`${m.nickname} · ${from.kind==='party'?`Party slot ${from.slot+1}`:`${save.boxName(from.box)}, slot ${from.slot+1}`}`,`${destinationFields()}<p class="field-help">Choosing an occupied slot swaps the two Pokémon. Pokémon moved into the party are fully healed, as when withdrawn in-game.</p><div class="form-footer"><span></span><div class="actions-inline"><button type="button" data-close>Cancel</button><button type="button" class="primary" data-confirm>Move</button></div></div>`);
    const read=bindDestination(dialog,from.kind==='party'?(save.firstEmptyBox(0)||{kind:'box',box:0}):(save.partyCount<6?{kind:'party',slot:save.partyCount}:{kind:'party',slot:0}),{allowOccupied:true,exclude:from});
    dialog.querySelector('[data-confirm]').onclick=()=>{try{const to=read();closeDialog(dialog);applyStructural(()=>save.moveMon(from,to),`${m.nickname} moved.`);}catch(e){fail(e);}};
  }
  function openReleaseDialog(m){
    const dialog=openDialog(`Release ${m.nickname}?`,'This removes the Pokémon from your save. Undo can bring it back until you close the editor.',`<div class="form-footer"><span></span><div class="actions-inline"><button type="button" data-close>Keep it</button><button type="button" class="primary danger-fill" data-confirm>Release</button></div></div>`);
    dialog.querySelector('[data-confirm]').onclick=()=>{closeDialog(dialog);applyStructural(()=>{save.deleteMon(ref);return null;},`${m.nickname} released.`);};
  }
  function currentAbilityName(m){const s=catalog.species[m.species],id=abilityChoices(s,m.pid)[m.abilitySlot];return catalog.abilities[id]?.name;}
  function openExportDialog(m){
    const text=ERCore.toShowdown(m,catalog,currentAbilityName(m));
    const dialog=openDialog('Showdown set','Paste into Pokémon Showdown, a team builder, or another save.',`<textarea class="set-text" readonly rows="10" aria-label="Showdown set"></textarea><div class="form-footer"><p>IVs are fixed at 31 in Elite Redux.</p><div class="actions-inline"><button type="button" data-close>Close</button><button type="button" class="primary" data-copy>Copy</button></div></div>`);
    const area=dialog.querySelector('textarea');area.value=text;
    dialog.querySelector('[data-copy]').onclick=async()=>{try{await navigator.clipboard.writeText(text);notify('Showdown set copied.');}catch{area.select();document.execCommand?.('copy');notify('Set selected. Press Ctrl+C to copy it.');}};
  }
  // ---- Adding Pokémon -----------------------------------------------------------------------
  function suggestedMoves(species){
    const moves=(species.learnset||[]).map(id=>catalog.moves[id]).filter(mv=>mv&&mv.id&&!mv.banned&&(mv.power||0)<200);
    const types=new Set(species.types),score=mv=>(mv.power||0)*(mv.types.some(t=>types.has(t))?1.5:1);
    const picked=[...moves].sort((a,b)=>score(b)-score(a)).slice(0,4).map(mv=>mv.id);
    return picked.length?picked:[1];
  }
  function openAddDialog(){
    if(!guard())return;
    const cap=save.cap(),start=catalog.species[150]?150:+Object.keys(catalog.species)[0];
    const dialog=openDialog('Add a Pokémon','Creates a new Pokémon with you as its original trainer.',`<div class="tab-switch" role="tablist"><button type="button" role="tab" class="active" data-mode="new">Build</button><button type="button" role="tab" data-mode="import">Paste Showdown set</button></div>
    <form data-pane="new" class="add-form"><div class="field-grid two-up"><label class="field"><span>Species</span><input name="species" list="list-species" value="${html(display(catalog.species[start]))}" autocomplete="off" required></label>${numberField(`Level · cap ${cap}`,'level',Math.min(cap,50),1,100)}
    <label class="field"><span>Nature</span><select name="nature"><option value="random">Random</option>${catalog.natures.map((n,i)=>`<option value="${i}">${html(n)}</option>`).join('')}</select></label>${selectField('Shininess','shiny',0,['Normal','Star shiny','Square shiny','Special palette'])}</div>
    <p class="section-label">Moves · suggested from its learnset</p><div class="field-grid two-up">${[0,1,2,3].map(i=>`<label class="field"><span>Move ${i+1}</span><input name="move${i}" list="list-moves" autocomplete="off" placeholder="Empty"></label>`).join('')}</div></form>
    <div data-pane="import" hidden><textarea class="set-text" rows="9" placeholder="Garchomp @ Life Orb&#10;Ability: Sand Force&#10;Level: 100&#10;EVs: 252 Atk / 4 SpD / 252 Spe&#10;Jolly Nature&#10;- Earthquake&#10;- Dragon Claw" aria-label="Showdown set"></textarea><p class="field-help" data-import-help>Species, item, level, EVs, nature, shininess, happiness and moves are imported. Abilities come from the PID: if the requested ability is not one of the new Pokémon’s choices, the Ability lab opens with it filled in.</p></div>
    <p class="section-label">Where should it go?</p>${destinationFields()}<div class="form-footer"><span></span><div class="actions-inline"><button type="button" data-close>Cancel</button><button type="button" class="primary" data-confirm>Add Pokémon</button></div></div>`);
    const form=dialog.querySelector('form'),read=bindDestination(dialog,defaultDestination());let mode='new',movesEdited=false;
    const fillMoves=()=>{if(movesEdited)return;try{const sp=catalog.species[resolve('species',form.elements.species.value)];suggestedMoves(sp).concat([0,0,0,0]).slice(0,4).forEach((id,i)=>form.elements[`move${i}`].value=id?display(catalog.moves[id]):'');}catch{}};
    fillMoves();form.elements.species.addEventListener('change',fillMoves);
    for(let i=0;i<4;i++)form.elements[`move${i}`].addEventListener('input',()=>movesEdited=true);
    dialog.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{mode=b.dataset.mode;dialog.querySelectorAll('[data-mode]').forEach(x=>x.classList.toggle('active',x===b));dialog.querySelectorAll('[data-pane]').forEach(p=>p.hidden=p.dataset.pane!==mode);});
    dialog.querySelector('[data-confirm]').onclick=()=>{
      try{
        const target=read();
        if(mode==='new'){
          const level=wholeNumber(form.elements.level.value,'Level',1,100),natureValue=form.elements.nature.value;
          const moves=[0,1,2,3].map(i=>form.elements[`move${i}`].value.trim()?resolve('moves',form.elements[`move${i}`].value):0).filter(Boolean);
          const options={species:resolve('species',form.elements.species.value),level,moves,shiny:+form.elements.shiny.value};
          if(natureValue!=='random')options.nature=+natureValue;
          closeDialog(dialog);applyStructural(()=>save.createMon(target,options,`Add ${catalog.species[options.species].name}`),`${catalog.species[options.species].name} added.`);
        } else importSet(dialog,target);
      }catch(e){fail(e);}
    };
  }
  function importSet(dialog,target){
    const set=ERCore.parseShowdown(dialog.querySelector('[data-pane="import"] textarea').value,catalog),species=catalog.species[set.species];
    const pid=crypto.getRandomValues(new Uint32Array(1))[0];let abilitySlot=0,abilityNote='';
    if(set.ability){const choices=abilityChoices(species,pid);const slot=choices.indexOf(set.ability);if(slot>=0)abilitySlot=slot;else abilityNote=set.ability;}
    const options={species:set.species,level:set.level??50,moves:set.moves,pid,abilitySlot,evs:set.evs,heldItem:set.heldItem,shiny:set.shiny,friendship:set.friendship,nature:set.nature,nickname:set.nickname};
    closeDialog(dialog);
    let placed;
    applyStructural(()=>{placed=save.createMon(target,{...options,speedDown:set.speedDown},`Import ${species.name}`);return placed;},`${species.name} imported.${set.warnings.length?' '+set.warnings.join(' '):''}`);
    if(placed&&abilityNote){const draft=searchDraft();draft.targets=[display(catalog.abilities[abilityNote]),'','',''];draft.matchMode='any';tab='randomizer';render();notify(`${species.name} imported. ${catalog.abilities[abilityNote].name} is not one of its current choices, so the Ability lab is ready to search for it.`);}
  }
  // ---- Roster actions -----------------------------------------------------------------------
  function drawRosterActions(){
    const off=!!save.damaged.length;
    $('roster-actions').innerHTML=`<button type="button" id="add-mon" ${off?'disabled':''}>＋ Add Pokémon</button>${roster==='party'?`<button type="button" id="heal-party" ${off?'disabled':''}>Heal party</button><button type="button" id="friendship-party" ${off?'disabled':''}>Max friendship</button>`:''}`;
    $('add-mon').onclick=openAddDialog;
    $('heal-party')?.addEventListener('click',()=>{if(guard())apply(()=>save.healParty(),'Party healed: full HP, PP and no status.');});
    $('friendship-party')?.addEventListener('click',()=>{if(guard())apply(()=>save.maxFriendshipParty(),'Party friendship set to 255.');});
  }
  // ---- Trainer & bag tab --------------------------------------------------------------------
  let bagDraft=new Map(),bagFilter={text:'',owned:'all',group:'all'};
  function itemGroup(item){const n=item.name;if(/^(TM|HM)\d/.test(n))return 'tm';if(/ Ball$/.test(n))return 'ball';if(/ Berry$/.test(n))return 'berry';if(/ite( [XYZ])?$/.test(n)&&!/^(Meteorite|Odd Keystone)$/.test(n))return 'mega';return 'other';}
  const ITEM_GROUPS={all:'All items',ball:'Poké Balls',berry:'Berries',tm:'TMs & HMs',mega:'Mega Stones & Z',other:'Everything else'};
  function bagItems(){return Object.values(catalog.items).filter(i=>i.id>0&&i.id<2048&&i.name&&!/^\?+$/.test(i.name)&&i.name!=='None').sort((a,b)=>a.name.localeCompare(b.name));}
  function renderTrainer(){
    const t=save.trainerCard(),money=save.money(),bp=save.battlePoints(),off=save.damaged.length?'disabled':'';
    $('editor-panel').innerHTML=`<div class="page-heading"><h1>Trainer, money and bag.</h1><p>Your trainer card, PC box names and every item in your bag.</p></div>
    <form id="trainer-form"><fieldset ${off} class="plain"><section class="panel"><div class="panel-heading"><h2>TRAINER CARD</h2><span>Shown on the trainer card and as OT on Pokémon you catch</span></div><div class="field-grid">
    <label class="field"><span>Name · up to 7 characters</span><input name="name" value="${html(t.name)}" maxlength="7" required></label>${selectField('Gender','gender',t.gender,['Male','Female'])}<span></span>
    ${numberField('Trainer ID','tid',t.tid,0,65535)}${numberField('Secret ID','sid',t.sid,0,65535)}<span></span>
    ${numberField('Play time · hours','hours',t.hours,0,999)}${numberField('Minutes','minutes',t.minutes,0,59)}${numberField('Seconds','seconds',t.seconds,0,59)}
    </div><div class="checkrow"><label><input name="updateOwned" type="checkbox" checked> Also update the OT on Pokémon I caught, so they stay mine and keep obeying</label></div>
    <div class="form-footer"><p>If you change your name or IDs without updating your Pokémon, high-level ones may stop obeying you.</p><div class="actions-inline"><button type="button" data-discard>Discard</button><button type="submit" class="primary">Apply trainer card</button></div></div></section></fieldset></form>
    ${money.supported?`<form id="money-form"><fieldset ${off} class="plain"><section class="panel"><div class="panel-heading"><h2>MONEY & POINTS</h2><span>Max ¥999,999 · 9,999 coins · 9,999 BP</span></div><div class="field-grid">${numberField('Money (¥)','money',money.money,0,999999)}${numberField('Game Corner coins','coins',money.coins,0,9999)}${bp.supported?numberField('Battle Points (BP)','battlePoints',bp.battlePoints,0,9999):''}</div><div class="form-footer"><p>Elite Redux stores money, coins and Battle Points as plain values.</p><div class="actions-inline"><button type="button" data-discard>Discard</button><button type="submit" class="primary">Apply money & points</button></div></div></section></fieldset></form>`:'<p class="notice warning">Money could not be read safely from this save, so money editing is turned off.</p>'}
    <form id="boxes-form"><fieldset ${off} class="plain"><section class="panel"><div class="panel-heading"><h2>PC BOX NAMES</h2><span>Up to 8 characters</span></div><div class="box-name-grid">${Array.from({length:26},(_,b)=>`<label class="field"><span>Box ${b+1} · ${save.box(b).filter(m=>m.species).length}/30</span><input name="box${b}" value="${html(save.boxName(b))}" maxlength="8"></label>`).join('')}</div><div class="form-footer"><p>Names use the game's character set.</p><div class="actions-inline"><button type="button" data-discard>Discard</button><button type="submit" class="primary">Apply box names</button></div></div></section></fieldset></form>
    <section class="panel" id="bag-panel"><div class="panel-heading"><h2>BAG</h2><span id="bag-count"></span></div><p class="notice">Elite Redux bags hold each item once with unlimited uses, so an item is simply owned or not. Key items and HMs can unlock story areas early; add them with care.</p>
    <div class="bag-tools"><label class="field"><span>Search items</span><input id="bag-search" type="search" value="${html(bagFilter.text)}" placeholder="Name or ID" autocomplete="off"></label><label class="field"><span>Category</span><select id="bag-group">${Object.entries(ITEM_GROUPS).map(([k,l])=>`<option value="${k}"${k===bagFilter.group?' selected':''}>${l}</option>`).join('')}</select></label><label class="field"><span>Show</span><select id="bag-owned"><option value="all">Owned and not owned</option><option value="owned">Owned only</option><option value="missing">Not owned</option></select></label></div>
    <div class="actions-inline bag-bulk"><button type="button" id="bag-all" ${off}>Own all shown</button><button type="button" id="bag-none" ${off}>Remove all shown</button></div>
    <div id="bag-list" class="bag-grid"></div><div class="form-footer"><p id="bag-pending">No pending bag changes.</p><div class="actions-inline"><button type="button" id="bag-discard">Discard</button><button type="button" class="primary" id="bag-apply" ${off}>Apply bag changes</button></div></div></section>`;
    const tf=$('trainer-form');bindDirty(tf);
    tf.onsubmit=e=>{e.preventDefault();try{const g=n=>tf.elements[n].value;const patch={name:g('name'),gender:+g('gender'),tid:wholeNumber(g('tid'),'Trainer ID',0,65535),sid:wholeNumber(g('sid'),'Secret ID',0,65535),hours:wholeNumber(g('hours'),'Hours',0,999),minutes:wholeNumber(g('minutes'),'Minutes',0,59),seconds:wholeNumber(g('seconds'),'Seconds',0,59)};apply(()=>save.editTrainer(patch,{updateOwned:tf.elements.updateOwned.checked}),'Trainer card updated.');}catch(err){fail(err);}};
    const mf=$('money-form');if(mf){bindDirty(mf);mf.onsubmit=e=>{e.preventDefault();try{const patch={money:wholeNumber(mf.elements.money.value,'Money',0,999999),coins:wholeNumber(mf.elements.coins.value,'Coins',0,9999)},points=mf.elements.battlePoints?wholeNumber(mf.elements.battlePoints.value,'Battle Points',0,9999):null;apply(()=>{save.editMoney(patch);if(points!==null&&points!==save.battlePoints().battlePoints)save.editBattlePoints(points);},'Money and points updated.');}catch(err){fail(err);}};}
    const bf=$('boxes-form');bindDirty(bf);
    bf.onsubmit=e=>{e.preventDefault();apply(()=>{save.editBoxNames(Array.from({length:26},(_,b)=>bf.elements[`box${b}`].value));refreshBoxSelect();},'Box names updated.');};
    $('bag-owned').value=bagFilter.owned;
    const items=bagItems(),owned=new Set(save.ownedItems());
    const isOwned=id=>bagDraft.has(id)?bagDraft.get(id):owned.has(id);
    const shown=()=>{const q=bagFilter.text.trim().toLocaleLowerCase();return items.filter(i=>(bagFilter.group==='all'||itemGroup(i)===bagFilter.group)&&(!q||`${i.name} ${i.id}`.toLocaleLowerCase().includes(q))&&(bagFilter.owned==='all'||(bagFilter.owned==='owned')===!!isOwned(i.id)));};
    const pending=()=>{dirty=bagDraft.size>0;sync();$('bag-pending').textContent=bagDraft.size?`${bagDraft.size} pending item change${bagDraft.size===1?'':'s'} · apply to save them`:'No pending bag changes.';$('bag-count').textContent=`${items.filter(i=>isOwned(i.id)).length} of ${items.length} items owned`;};
    const drawBag=()=>{const list=shown();$('bag-list').innerHTML=list.length?list.map(i=>`<label class="bag-item${bagDraft.has(i.id)?' changed':''}"><input type="checkbox" data-item="${i.id}" ${isOwned(i.id)?'checked':''} ${off}><span>${html(i.name)}</span><small>#${i.id}</small></label>`).join(''):'<p class="field-help">No items match.</p>';pending();};
    const setItem=(id,value)=>{if(!!owned.has(id)===value)bagDraft.delete(id);else bagDraft.set(id,value);};
    $('bag-list').onchange=e=>{const box=e.target.closest('[data-item]');if(!box)return;setItem(+box.dataset.item,box.checked);box.parentElement.classList.toggle('changed',bagDraft.has(+box.dataset.item));pending();};
    $('bag-search').oninput=e=>{bagFilter.text=e.target.value;drawBag();};
    $('bag-group').onchange=e=>{bagFilter.group=e.target.value;drawBag();};
    $('bag-owned').onchange=e=>{bagFilter.owned=e.target.value;drawBag();};
    $('bag-all').onclick=()=>{shown().forEach(i=>setItem(i.id,true));drawBag();};
    $('bag-none').onclick=()=>{shown().forEach(i=>setItem(i.id,false));drawBag();};
    $('bag-discard').onclick=()=>{bagDraft.clear();dirty=false;drawBag();};
    $('bag-apply').onclick=()=>{if(!bagDraft.size){notify('No bag changes to apply.');return;}const changes=Object.fromEntries(bagDraft);const n=bagDraft.size;apply(()=>{save.editItems(changes);bagDraft.clear();},`${n} bag item${n===1?'':'s'} updated.`);};
    drawBag();
  }
  function renderRandomizer(m){
    const s=catalog.species[m.species],on=options().abilityRng||options().innateRng,draft=searchDraft();matchMode=draft.matchMode;
    $('editor-panel').innerHTML=`${heading(m)}<div class="ability-overview" id="lab-abilities">${abilityCards(m)}</div><p class="notice">Each Pokémon has three ability choices, with one equipped alongside its innates. Choose up to four abilities you want together. Any-order matching can place each one in the equipped ability or any innate slot. Blank inputs leave the remaining abilities unrestricted. Every result is verified against the ${html(catalog.config.modulus)}-outcome randomizer.</p>${!on?'<p class="notice warning">Ability and innate randomizers are off. Enable the ones you want to change in Game settings before searching.</p>':''}
    <section class="panel"><div class="panel-heading"><h2>FIND YOUR COMBINATION</h2><span>Runs in a background worker</span></div><div class="checkrow" style="margin-top:0;margin-bottom:16px"><label><input id="match-any-order" type="checkbox" ${matchMode==='any'?'checked':''}> Match abilities in any order</label></div><div class="target-grid">${[0,1,2,3].map(i=>`<label class="field"><span id="target-label-${i}"></span><input id="target-${i}" list="list-abilities" placeholder="Leave blank for any ability" autocomplete="off" ${on?'':'disabled'}></label>`).join('')}</div><p class="field-help" id="match-help"></p><div class="search-control"><button id="search-button" class="primary" ${!on||save.damaged.length?'disabled':''}>Find combinations ↗</button><button id="cancel-search" hidden>Stop search</button><label><input id="lock-slot" type="checkbox"> Keep ability slot ${m.abilitySlot+1}</label><label><input id="keep-gender" type="checkbox" checked> Keep gender</label></div><div class="search-progress" id="search-progress" aria-live="polite"></div><progress id="search-meter" max="100" value="0" hidden></progress></section>
    <div id="search-results"></div><section class="panel"><div class="panel-heading"><h2>PID & FORM PREVIEW</h2><span>Changing PID can change gender and randomized types</span></div><div class="field-grid"><label class="field"><span>PID · hexadecimal</span><input id="pid-input" value="${m.pid.toString(16).toUpperCase().padStart(8,'0')}" maxlength="8" pattern="[0-9A-Fa-f]{1,8}"></label><label class="field"><span>Preview species / Mega form</span><input id="preview-species" list="list-species" value="${html(display(s))}" autocomplete="off"></label><label class="field"><span>Preview ability slot</span><select id="preview-slot">${[0,1,2].map(i=>`<option value="${i}" ${i===m.abilitySlot?'selected':''}>Slot ${i+1}</option>`).join('')}</select></label></div><div class="form-footer"><p>Preview does not change species or PID until you apply a PID.</p><div class="actions-inline"><button id="preview-button">Preview</button><button id="reroll-button" ${save.damaged.length?'disabled':''}>Reroll PID</button><button id="apply-pid" class="primary" ${save.damaged.length?'disabled':''}>Apply PID</button></div></div><div id="pid-preview" style="margin-top:16px"></div></section>`;
    const updateMatchLabels=()=>{
      for(let i=0;i<4;i++)$('target-label-'+i).textContent=matchMode==='any'?`Desired ability ${i+1}`:['Active ability','Innate 1','Innate 2','Innate 3'][i]+(!(i===0?options().abilityRng:options().innateRng)?' · fixed in this save':'');
      $('match-help').textContent=matchMode==='any'?'Every entered ability must appear somewhere across the four slots. Entering an ability twice requires two copies.':'Each requested ability must match its named slot exactly.';
    };
    for(let i=0;i<4;i++)$('target-'+i).value=draft.targets[i];
    $('lock-slot').checked=draft.lockSlot;$('keep-gender').checked=draft.keepGender;
    updateMatchLabels();$('match-any-order').onchange=e=>{matchMode=e.target.checked?'any':'slots';rememberSearchDraft();resetSearch();updateMatchLabels();};
    const changed=()=>{rememberSearchDraft();resetSearch();};
    for(let i=0;i<4;i++)$('target-'+i).oninput=changed;
    $('lock-slot').onchange=changed;$('keep-gender').onchange=changed;
    drawResults();$('search-button').onclick=()=>startSearch(m);$('cancel-search').onclick=()=>{cancelSearch();drawResults();$('search-progress').textContent=`Search stopped. ${searchResults.length} verified matches kept. Start a new search to continue.`;};
    if(searchSession){$('search-meter').hidden=false;$('search-button').disabled=searchSession.busy;$('cancel-search').hidden=!searchSession.busy;searchStatus();}
    $('preview-button').onclick=()=>{try{const pid=parsePID(),sp=catalog.species[resolve('species',$('preview-species').value)],slot=+$('preview-slot').value,r=ERRng.evaluate(sp,pid,slot,options(),catalog.config);$('pid-preview').innerHTML=`<p class="field-help">${html(sp.name)} · ${ERRng.gender(sp,pid)} · ${typeTags(r.types)}</p><div class="ability-overview" style="margin-top:12px">${abilityCards({...m,pid,abilitySlot:slot},sp,true)}</div>`;}catch(e){fail(e);}};
    $('apply-pid').onclick=()=>{try{const pid=parsePID();apply(()=>save.editMon(ref,{pid},`Apply PID to ${m.nickname}`),'PID applied.');}catch(e){fail(e);}};
    $('reroll-button').onclick=()=>{const value=crypto.getRandomValues(new Uint32Array(1))[0];apply(()=>save.editMon(ref,{pid:value},`Reroll ${m.nickname}`),'New PID applied.');};
  }
  function parsePID(){const s=$('pid-input').value.trim();if(!/^[a-f\d]{1,8}$/i.test(s))throw new Error('PID must contain 1–8 hexadecimal digits.');return parseInt(s,16)>>>0;}
  function cancelSearch(){if(worker){worker.terminate();worker=null;}if(workerUrl){URL.revokeObjectURL(workerUrl);workerUrl=null;}searchSession=null;if($('cancel-search'))$('cancel-search').hidden=true;if($('more-search'))$('more-search').hidden=true;if($('search-button'))$('search-button').disabled=!(options().abilityRng||options().innateRng)||!!save.damaged.length;}
  function resetSearch(){cancelSearch();searchResults=[];drawResults();if($('search-progress'))$('search-progress').textContent='';if($('search-meter'))$('search-meter').hidden=true;}
  function searchStatus(){
    if(!searchSession||!$('search-progress'))return;
    const s=searchSession,elapsed=s.elapsed+(s.busy?performance.now()-s.started:0);
    $('search-progress').textContent=`${searchResults.length} verified matches loaded · ${s.request.matchMode==='any'?'Any order':'Exact slots'} · ${s.checked.toLocaleString()} candidates · ${(elapsed/1000).toFixed(2)}s · ${s.busy?'Searching for more…':s.complete?'Search complete — all matches loaded':'More matches can be searched below'}`;
    $('search-meter').value=s.percent;
  }
  function loadMoreSearch(){
    if(!worker||!searchSession||searchSession.busy||searchSession.complete)return;
    searchSession.busy=true;searchSession.started=performance.now();$('search-button').disabled=true;$('cancel-search').hidden=false;
    if($('more-search')){$('more-search').disabled=true;$('more-search').textContent='Searching for more…';}
    searchStatus();worker.postMessage({kind:'next'});
  }
  function startSearch(m){
    try{
      rememberSearchDraft();
      cancelSearch();const targets=[0,1,2,3].map(i=>$('target-'+i).value.trim()?resolve('abilities',$('target-'+i).value):null);
      if(targets.every(t=>t===null))throw new Error('Choose at least one desired ability or innate.');
      const species=catalog.species[m.species];const request={species,options:options(),config:catalog.config,targets,matchMode,lockedSlot:$('lock-slot').checked?m.abilitySlot:null,keepGender:$('keep-gender').checked,pid:m.pid,limit:12};
      const code=$('rng-code').textContent+`\nlet pages;self.onmessage=async e=>{try{if(e.data.kind!=='next')pages=ERRng.searchPages(e.data,p=>self.postMessage({kind:'progress',value:p}));const page=await pages.next();self.postMessage({kind:'done',value:page.value});}catch(error){self.postMessage({kind:'error',message:error.message});}};`;
      const url=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));try{worker=new Worker(url);workerUrl=url;}catch(error){URL.revokeObjectURL(url);throw error;}searchResults=[];searchSession={request,complete:false,busy:true,checked:0,percent:0,elapsed:0,started:performance.now()};drawResults();$('search-button').disabled=true;$('cancel-search').hidden=false;$('search-meter').hidden=false;searchStatus();
      const searchWorker=worker;
      worker.onmessage=e=>{
        const data=e.data;if(worker!==searchWorker||!searchSession)return;
        if(workerUrl){URL.revokeObjectURL(workerUrl);workerUrl=null;}
        if(data.kind==='progress'){searchSession.checked=data.value.checked;searchSession.percent=data.value.percent;searchStatus();}
        else if(data.kind==='done'){
          const s=searchSession;s.elapsed+=performance.now()-s.started;s.busy=false;s.checked=data.value.checked;s.percent=data.value.percent;s.complete=data.value.complete;
          searchResults.push(...data.value.answers.map(r=>({...r,abilityChoices:abilityChoices(request.species,r.pid,request.options,request.config)})));
          if(s.complete){worker.terminate();worker=null;}
          $('search-button').disabled=false;$('cancel-search').hidden=true;drawResults();searchStatus();
          if(s.complete&&!searchResults.length)$('search-progress').textContent=`Search complete. No matching PID exists for these targets ${request.matchMode==='any'?'in any order':'in the exact slots'} with the current slot/gender constraints.`;
        }else{cancelSearch();drawResults();fail(new Error(data.message));}
      };
      worker.onerror=e=>{if(worker!==searchWorker)return;cancelSearch();drawResults();fail(new Error(e.message||'Search worker failed.'));};worker.postMessage(request);
    }catch(e){fail(e);}
  }
  function drawResults(){
    if(!$('search-results'))return;
    const current=mon();
    $('search-results').innerHTML=(searchResults.length?`<div class="result-heading"><h2>SEARCH MATCHES</h2><span>${searchResults.length.toLocaleString()} loaded · Click a row to apply</span></div>`:'')+searchResults.map((r,i)=>{
      const selected=current?.pid===r.pid&&current.abilitySlot===r.slot,pid=r.pid.toString(16).toUpperCase().padStart(8,'0');
      return `<button type="button" class="result-row${selected?' is-selected':''}" data-result="${i}" aria-label="Apply match ${i+1}, PID ${pid}" aria-pressed="${selected}"><code><small>MATCH ${i+1}</small><br>${pid}<br><small>SLOT ${r.slot+1}</small></code><span class="result-abilities"><b>Ability choices</b><span class="result-ability-options">${r.abilityChoices.map((id,slot)=>`<span class="result-ability-option${slot===r.slot?' is-equipped':''}" title="${slot===r.slot?'Equipped by this result':'Alternative ability choice'}">${slot+1}. ${html(catalog.abilities[id]?.name||id)}${slot===r.slot?' ✓':''}</span>`).join('')}</span><small>Innates: ${r.innates.map(id=>html(catalog.abilities[id]?.name||id)).join(' · ')}</small></span><span class="result-use">${selected?'Applied ✓':'Use this PID'}</span></button>`;
    }).join('')+(searchSession&&!searchSession.complete?`<div class="result-pagination"><span>${searchResults.length.toLocaleString()} matches loaded. Continue searching for the next batch.</span><button id="more-search" ${searchSession.busy?'disabled':''}>${searchSession.busy?'Searching for more…':'Load more matches'}</button></div>`:searchResults.length&&searchSession?.complete?'<p class="field-help">All matching results have been loaded.</p>':'');
    $('more-search')?.addEventListener('click',loadMoreSearch);
    $('search-results').querySelectorAll('[data-result]').forEach(e=>e.onclick=()=>{
      if(!guard())return;const r=searchResults[+e.dataset.result];
      if(mon().pid===r.pid&&mon().abilitySlot===r.slot){notify('This PID is already applied.');return;}
      apply(()=>save.editMon(ref,{pid:r.pid,abilitySlot:r.slot},`Apply ability combination to ${mon().nickname}`),'Verified combination applied. Your search is preserved.',{keepSearch:true});
    });
  }
  function renderSettings(){
    const extraSwitches={damageDone:'Display damage numbers',askForNickname:'Ask for nickname on catch',playerAI:'Player AI (auto-battle)',individualColors:'Individual Pokémon colors',doubleBattles:'Double battles'};
    const o=options(),labels={abilityRng:'Ability randomizer',innateRng:'Innate randomizer',encounterRng:'Encounter randomizer',encLegendRng:'Legendary encounters',moveRng:'Move randomizer',typeRng:'Type randomizer',permMega:'Permanent Mega mode',enableEvs:'Enable EVs',autoEVGain:'Automatic EV gain',autoExpGain:'Automatic EXP gain',autoEvolution:'Automatic evolution',autoRun:'Auto run',permanentRepel:'Permanent repel'};
    $('editor-panel').innerHTML=`<div class="page-heading"><h1>Your game, configured.</h1><p>Read directly from your save. Only the selected option bits are changed.</p></div><p class="notice">Turning an ability, innate, or type randomizer on or off immediately changes derived results for every Pokémon. Encounter settings affect future encounters. Existing stored moves stay as saved; the move randomizer affects generated movesets.</p><form id="settings-form"><fieldset ${save.damaged.length?'disabled':''} style="padding:0;border:0;margin:0"><section class="panel"><div class="panel-heading"><h2>RUN RULES</h2><span>${save.badge()===9?'Champion clear':`${save.badge()} badge stage`} · Level cap ${save.cap()}</span></div><div class="field-grid">${selectField('Difficulty','difficulty',o.difficulty,['Easy','Ace','Elite','Hell'])}${selectField('Level caps','levelCaps',o.levelCaps,['Easy caps','More caps','Elite caps','Caps off'])}${selectField('Shiny rate','shinyRate',o.shinyRate,['1 / 1,024','1 / 128','1 / 5','Reserved mode (default odds)'])}</div><h3 class="settings-section">RANDOMIZERS</h3><div class="settings-grid">${Object.entries(labels).slice(0,6).map(([k,l])=>`<label class="switch-field">${l}<input name="${k}" type="checkbox" ${o[k]?'checked':''}></label>`).join('')}</div><h3 class="settings-section">PLAY OPTIONS</h3><div class="settings-grid">${Object.entries(labels).slice(6).map(([k,l])=>`<label class="switch-field">${l}<input name="${k}" type="checkbox" ${o[k]?'checked':''}></label>`).join('')}</div><h3 class="settings-section">INTERFACE & BATTLE</h3><div class="field-grid">${selectField('Text speed','textSpeed',o.textSpeed,['Slow','Mid','Fast','Instant'])}${selectField('HP bar speed','hpBarSpeed',o.hpBarSpeed,['Slow','Mid','Fast','Instant'])}${selectField('Battle animations','battleSceneOff',o.battleSceneOff,['On','Off'])}${selectField('Battle style','battleStyle',o.battleStyle,['Shift','Set'])}${selectField('Sound','sound',o.sound,['Mono','Stereo'])}${selectField('Button mode','buttonMode',o.buttonMode,['Normal','LR','L = A'])}${selectField('Window frame','frameType',o.frameType,Array.from({length:20},(_,i)=>`Frame ${i+1}`))}${selectField('Battle UI skin','battleTheme',o.battleTheme,['Elite Redux Dark','Elite Redux Clear','Diamond & Pearl','Classic'])}</div><div class="settings-grid" style="margin-top:16px">${Object.entries(extraSwitches).map(([k,l])=>`<label class="switch-field">${l}<input name="${k}" type="checkbox" ${o[k]?'checked':''}></label>`).join('')}</div><div class="form-footer"><p>Stat-affecting settings also refresh party stat caches.</p><div class="actions-inline"><button type="button" data-discard>Discard draft</button><button type="submit" class="primary">Apply game settings</button></div></div></section></fieldset></form>
    <section class="panel"><div class="panel-heading"><h2>GAME DATA PROFILE</h2><span>${html(catalog.version)}</span></div><p class="field-help" style="margin-top:0">${Object.keys(catalog.species).length.toLocaleString()} species · ${Object.keys(catalog.moves).length} moves · ${Object.keys(catalog.abilities).length} abilities · ${catalog.config.banned.length} randomizer exclusions. Save files do not identify the exact ROM revision. The bundled catalog is the published 2.65.4 snapshot; custom or newer ROMs need matching data.</p><p class="field-help">For another build, import a generated catalog with explicit randomizer configuration. Nextdex JSON is accepted for builds using the same 38 blocked abilities. Verify the profile against your ROM before using ability searches.</p><div class="form-footer"><div class="actions-inline"><button id="import-catalog">Import game data JSON</button><button id="reset-catalog">Use bundled 2.65.4 data</button></div><span class="ev-total">All data stays local</span></div><input id="catalog-file" type="file" accept=".json,application/json" hidden></section>`;
    const form=$('settings-form');bindDirty(form);form.onsubmit=e=>{e.preventDefault();const patch={};for(const k of Object.keys(labels))patch[k]=+form.elements[k].checked;for(const k of ['difficulty','levelCaps','shinyRate','textSpeed','hpBarSpeed','battleSceneOff','battleStyle','sound','buttonMode','frameType','battleTheme'])patch[k]=+form.elements[k].value;for(const k of Object.keys(extraSwitches))patch[k]=+form.elements[k].checked;apply(()=>save.editOptions(patch),'Game settings applied.');};
    $('import-catalog').onclick=()=>{if(guard())$('catalog-file').click();};$('catalog-file').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>30_000_000)throw new Error('Game data JSON is too large.');setCatalog(convertCatalog(JSON.parse(await file.text()),file.name));}catch(e){fail(e);}};
    $('reset-catalog').onclick=()=>{if(guard())setCatalog(builtin);};
  }
  function convertCatalog(data,name){
    if(!Array.isArray(data.species))return data;
    if(!Array.isArray(data.abilities)||!Array.isArray(data.moves)||!Array.isArray(data.typeT))throw new Error('Expected Nextdex gameData JSON or a generated studio catalog.');
    const types=builtin.types,map=ids=>ids.map(id=>{const i=types.indexOf(data.typeT[id]);return i<0?255:i;});
    const out={version:name,types,natures:data.natureT||builtin.natures,config:{...builtin.config,modulus:Math.max(...data.abilities.map(a=>a.id))},species:{},moves:{},abilities:{},items:{0:{id:0,name:'None'}}};
    for(const s of data.species)if(s.id>0)out.species[s.id]={id:s.id,name:s.name,key:s.NAME,base:s.stats.base,types:map(s.stats.types),abilities:s.stats.abis,innates:s.stats.inns,gender:s.stats.gender===255?255:Math.floor(s.stats.gender/100),learnset:[],forms:[]};
    for(const a of data.abilities)out.abilities[a.id]=a;for(const m of data.moves)out.moves[m.id]={id:m.id,name:m.name,pp:m.pp,power:m.pwr,types:map(m.types),description:m.desc,split:m.split,banned:data.effT[m.eff]==='Placeholder'||m.NAME==='MOVE_DARK_VOID'};for(const i of data.items)out.items[i.id]={id:i.id,name:i.name};out.items[0]={id:0,name:'None'};for(const s of Object.values(out.species)){s.abilities=Array.from({length:3},(_,i)=>s.abilities[i]||0);s.innates=Array.from({length:3},(_,i)=>s.innates[i]||0);}return out;
  }
  function setCatalog(next){
    try{
      if(!next.config||!Number.isInteger(next.config.modulus)||next.config.modulus<1||next.config.modulus>4095||!Array.isArray(next.config.banned)||!next.species||!next.moves||!next.abilities||!next.items||next.natures?.length!==25||!Array.isArray(next.types))throw new Error('Invalid game data profile.');
      for(let id=0;id<=next.config.modulus;id++)if(!next.abilities[id])throw new Error(`Missing ability #${id} in game data.`);
      for(const s of Object.values(next.species))if(!s.name||!s.key||s.base?.length!==6||s.types?.length!==2||s.abilities?.length!==3||s.innates?.length!==3||[...s.abilities,...s.innates].some(id=>!next.abilities[id]))throw new Error(`Invalid species data for #${s.id}.`);
      const old=save.catalog;save.catalog=next;try{for(const m of save.party())save.assertMon(m);for(let i=0;i<26;i++)for(const m of save.box(i))if(m.species)save.assertMon(m);}catch(e){save.catalog=old;throw e;}
      resetSearch();catalog=next;buildLists();sync();drawRoster();render();notify('Game data profile loaded. Verify it matches your ROM.');
    }catch(e){fail(e);}
  }
  function renderReview(){
    const count=save.changedBytes(),checks=save.report();
    $('editor-panel').innerHTML=`<div class="page-heading"><h1>Ready for your next run.</h1><p>Check your changes, download a backup, and export a verified battery save.</p></div><div class="review-stats"><div class="metric"><b>${save.history.length}</b><span>APPLIED OPERATIONS</span></div><div class="metric"><b>${count.toLocaleString()}</b><span>BYTES CHANGED</span></div><div class="metric"><b>${checks.filter(c=>c.valid).length}/20</b><span>VALID SAVE SECTIONS</span></div></div><section class="panel"><div class="panel-heading"><h2>CHANGES THIS SESSION</h2><span>Undo is available in the toolbar</span></div>${save.history.length?save.history.map((s,i)=>`<div class="history-item">${String(i+1).padStart(2,'0')} &nbsp; ${html(s)}</div>`).join(''):'<p class="field-help">No changes yet. An unchanged export is byte-for-byte identical to the original.</p>'}<div class="form-footer"><p>Original: ${html(filename)} · Output: 131,072 bytes</p><button id="reset-all" ${!count?'disabled':''}>Revert all edits</button></div></section><section class="panel"><div class="panel-heading"><h2>EXPORT</h2><span>Full file preserved</span></div><p class="notice">Close your emulator before replacing its save. Rename the downloaded file to match your ROM, then boot normally and choose Continue. An old savestate can overwrite the edited battery save.</p><div class="field-grid"><label class="field"><span>Save extension</span><select id="extension"><option value="sav" ${filename.toLowerCase().endsWith('.sav')?'selected':''}>.sav</option><option value="srm" ${filename.toLowerCase().endsWith('.srm')?'selected':''}>.srm</option></select></label><div class="full-width actions-inline"><button id="review-backup">Download original backup</button><button id="review-export" class="primary" ${save.damaged.length?'disabled':''}>Download verified edited save ↗</button></div></div></section><section class="panel"><div class="panel-heading"><h2>SECTION INTEGRITY</h2><span>Read again from exported bytes</span></div><table class="check-table"><thead><tr><th>SECTION</th><th>PHYSICAL SECTOR</th><th>STORED CHECKSUM</th><th>RESULT</th></tr></thead><tbody>${checks.map(c=>`<tr><td>${c.id}</td><td>${c.slot}</td><td><code>${c.stored.toString(16).toUpperCase().padStart(4,'0')}</code></td><td class="${c.valid?'ok':'bad-text'}">${c.valid?'✓ Valid':'Failed'}</td></tr>`).join('')}</tbody></table></section>`;
    $('review-backup').onclick=backup;$('review-export').onclick=()=>exportSave($('extension').value);$('reset-all').onclick=()=>{save.reset();refreshBoxSelect();resetSearch();dirty=false;sync();drawRoster();render();notify('Restored the original save.');};
  }
  function download(bytes,name,type='application/octet-stream'){const url=URL.createObjectURL(new Blob([bytes],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.dataset.transientDownload='';document.body.append(a);a.click();setTimeout(()=>a.remove(),0);setTimeout(()=>URL.revokeObjectURL(url),60_000);}
  function backup(){download(save.original,filename.replace(/\.(sav|srm)$/i,'')+'.original.'+(filename.toLowerCase().endsWith('.srm')?'srm':'sav'));notify('Original backup downloaded.');}
  function exportSave(ext){if(!guard())return;try{const bytes=save.export();const suffix=ext|| (filename.toLowerCase().endsWith('.srm')?'srm':'sav');download(bytes,filename.replace(/\.(sav|srm)$/i,'')+'.edited.'+suffix);notify('Export verified: 20 valid sections, 128 KB.');sync();}catch(e){fail(e);}}
  async function load(file){
    if(!file)return;if(!guard()){$('save-file').value='';return;}
    if(file.size!==131072){$('save-file').value='';fail(new Error('Choose a 128 KB battery save (.sav or .srm). ROMs and savestates are not supported.'));return;}
    try{const next=new ERCore.Save(await file.arrayBuffer(),catalog);cancelSearch();save=next;searchDrafts.clear();bagDraft.clear();filename=file.name;roster='party';ref={kind:'party',slot:0};tab='pokemon';box=0;dirty=false;searchResults=[];$('welcome').hidden=true;$('workspace').hidden=false;$('filename').textContent=filename;$('roster-filter').value='';$('box-select').innerHTML=Array.from({length:26},(_,i)=>`<option value="${i}">${html(save.boxName(i))} · ${save.box(i).filter(m=>m.species).length}/30</option>`).join('');sync();drawRoster();render();notify(save.damaged.length?'This save has checksum errors; editing is disabled.':'Save loaded and checked.',!!save.damaged.length);}catch(e){fail(e);}finally{$('save-file').value='';}
  }
  $('save-file').onchange=e=>load(e.target.files[0]);$('open-button').onclick=()=>{if(guard())$('save-file').click();};$('backup-button').onclick=backup;$('export-button').onclick=()=>exportSave();
  $('demo-button').onclick=()=>load(new File([ERCore.demo(catalog)],'Demo.sav',{type:'application/octet-stream'}));
  $('undo-button').onclick=()=>{if(guard()){resetSearch();save.undo();refreshBoxSelect();sync();drawRoster();render();}};$('redo-button').onclick=()=>{if(guard()){resetSearch();save.redo();refreshBoxSelect();sync();drawRoster();render();}};
  document.querySelectorAll('[data-roster]').forEach(e=>e.onclick=()=>{if(!guard())return;resetSearch();roster=e.dataset.roster;const mons=roster==='party'?save.party():save.box(box).filter(m=>m.species);ref=mons[0]?.ref||null;drawRoster();render();});
  $('box-select').onchange=e=>{if(!guard()){e.target.value=box;return;}resetSearch();box=+e.target.value;ref=save.box(box).find(m=>m.species)?.ref||null;drawRoster();render();};
  $('roster-filter').oninput=()=>drawRoster();document.querySelectorAll('[data-tab]').forEach(e=>e.onclick=()=>{if(!guard())return;resetSearch();tab=e.dataset.tab;render();});
  document.addEventListener('keydown',e=>{if(!save||!(e.ctrlKey||e.metaKey)||e.key.toLowerCase()!=='z'||['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName))return;e.preventDefault();if(guard()){resetSearch();if(e.shiftKey)save.redo();else save.undo();refreshBoxSelect();sync();drawRoster();render();}});
  $('help-button').onclick=()=>showDialog($('help-dialog'));$('close-help').onclick=()=>closeDialog($('help-dialog'));
  $('editor-panel').addEventListener('click',e=>{const chooser=e.target.closest('[data-catalog-input]');if(chooser){openCatalogPicker($(chooser.dataset.catalogInput));return;}const button=e.target.closest('[data-pick-ability]');if(button)openAbilityPicker(button.dataset.pickAbility,+button.dataset.pickIndex);});
  const dz=$('dropzone');dz.ondragover=e=>{e.preventDefault();dz.classList.add('drag');};dz.ondragleave=()=>dz.classList.remove('drag');dz.ondrop=e=>{e.preventDefault();dz.classList.remove('drag');load(e.dataTransfer.files[0]);};
  $('offline-button').onclick=()=>{const parsed=new DOMParser().parseFromString(document.documentElement.outerHTML,'text/html');parsed.getElementById('welcome').removeAttribute('hidden');parsed.getElementById('workspace').setAttribute('hidden','');parsed.getElementById('editor-panel').innerHTML='';parsed.getElementById('roster-list').innerHTML='';parsed.getElementById('filename').textContent='';parsed.getElementById('save-meta').textContent='';parsed.getElementById('health-banner').innerHTML='';parsed.getElementById('box-select').innerHTML='';parsed.getElementById('toast').setAttribute('hidden','');parsed.querySelectorAll('datalist,dialog:not(#help-dialog),.dialog-backdrop,[data-transient-download]').forEach(e=>e.remove());parsed.body.classList.remove('dialog-open');download('<!doctype html>\n'+parsed.documentElement.outerHTML,'Redux Save Studio.html','text/html');};
  window.addEventListener('beforeunload',e=>{if(dirty||save?.changedBytes()){e.preventDefault();e.returnValue='';}});
})();
