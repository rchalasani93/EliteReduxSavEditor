(() => {
  'use strict';
  const $=id=>document.getElementById(id),html=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const builtin=JSON.parse($('catalog').textContent);let catalog=builtin,save=null,filename='save.sav',roster='party',box=0,ref=null,tab='pokemon',dirty=false,worker=null,searchResults=[],searchSession=null,matchMode='any',toastTimer;
  const pokemonIcons=JSON.parse($('pokemon-icons').textContent).images,searchDrafts=new Map();
  const typeColors=['#77796a','#ac634c','#7587a9','#986cba','#997759','#968454','#809147','#7968a4','#738997','#757575','#bc6755','#508fae','#629478','#aa934b','#b16990','#60a2b2','#766fa8','#626478','#ad80a0','#947361'];
  const statLabels=['HP','Attack','Defense','Sp. Atk','Sp. Def','Speed'];
  const ballNames=()=>Array.from({length:28},(_,id)=>id===0?'None':catalog.items[id]?.name||`Ball #${id}`);
  let indexes={};
  function notify(message,error=false){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').className=error?'error':'';$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,error?8500:4000);}
  function guard(){if(dirty){notify('Apply or discard your pending changes before switching views or exporting.',true);return false;}return true;}
  function fail(error){notify(error.message||String(error),true);}
  function display(entry){return entry?`${entry.name} · #${entry.id}`:'';}
  function resolve(kind,value,allowNone=false){
    const t=value.trim();if(allowNone&&!t)return 0;
    const number=/^(?:#)?(\d+)$/.exec(t)||/· #(\d+)$/.exec(t);let id=number?+number[1]:indexes[kind].get(t.toLocaleLowerCase());
    if(id===undefined||!catalog[kind][id])throw new Error(`Choose a valid ${kind==='species'?'species':kind.slice(0,-1)} from the list, or enter its numeric ID.`);return id;
  }
  function buildLists(){
    document.querySelectorAll('datalist').forEach(e=>e.remove());indexes={};
    for(const kind of ['species','moves','abilities','items']){
      indexes[kind]=new Map();const list=document.createElement('datalist');list.id=`list-${kind}`;
      const entries=Object.values(catalog[kind]).sort((a,b)=>a.name.localeCompare(b.name));
      list.innerHTML=entries.map(e=>{indexes[kind].set(e.name.toLocaleLowerCase(),e.id);indexes[kind].set(display(e).toLocaleLowerCase(),e.id);return `<option value="${html(display(e))}"></option>`;}).join('');document.body.append(list);
    }
  }
  buildLists();
  const numberField=(label,name,value,min,max)=>`<label class="field"><span>${label}</span><input name="${name}" type="number" value="${value}" min="${min}" max="${max}" required></label>`;
  const catalogField=(label,name,kind,id)=>`<label class="field"><span>${label}</span><input name="${name}" list="list-${kind}" value="${html(display(catalog[kind][id])||`#${id}`)}" autocomplete="off" required></label>`;
  const selectField=(label,name,value,entries)=>`<label class="field"><span>${label}</span><select name="${name}">${entries.map((e,i)=>`<option value="${i}"${i===value?' selected':''}>${html(e)}</option>`).join('')}</select></label>`;
  const typeTags=types=>[...new Set(types)].map(i=>`<span class="type" style="--type:${typeColors[i]||'#777'}">${html(catalog.types[i]||'None')}</span>`).join('');
  function pokemonIcon(species){
    const image=pokemonIcons[species?.key];
    return `<span class="mon-emblem" aria-hidden="true">${image?`<img src="${image}" alt="" width="64" height="64" decoding="async">`:'<span class="unknown-mon-icon"></span>'}</span>`;
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
    document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});$('close-ability-picker').onclick=()=>dialog.close();
    dialog.querySelectorAll('[data-equip-choice]').forEach(button=>button.onclick=()=>{
      const slot=+button.dataset.equipChoice;dialog.close();
      apply(()=>save.editMon(ref,{abilitySlot:slot},`Equip ability ${slot+1} on ${m.nickname}`),'Equipped ability updated. Your search fields are preserved.');
    });
    if(variable){
      const available=Object.values(catalog.abilities).filter(a=>a.id>0&&a.id<=catalog.config.modulus&&!catalog.config.banned.includes(a.id)).sort((a,b)=>a.name.localeCompare(b.name));
      const draw=()=>{
        const query=$('ability-picker-filter').value.trim().toLocaleLowerCase(),matches=available.filter(a=>`${a.name} ${a.desc||''} ${a.id}`.toLocaleLowerCase().includes(query));
        $('ability-picker-count').textContent=`${matches.length.toLocaleString()} searchable ${matches.length===1?'ability':'abilities'}`;
        $('ability-picker-options').innerHTML=matches.length?matches.map(a=>`<button type="button" class="picker-option" data-target-ability="${a.id}"><span><b>${html(a.name)}</b><small>${html(a.desc||'No description available.')}</small></span><span class="picker-select">Select for search</span></button>`).join(''):'<p class="picker-help">No abilities match your search.</p>';
        $('ability-picker-options').querySelectorAll('[data-target-ability]').forEach(button=>button.onclick=()=>{
          const ability=catalog.abilities[+button.dataset.targetAbility],draft=searchDraft(),preferred=kind==='ability'?0:index+1;
          const empty=draft.targets.findIndex(target=>!target.trim()),field=draft.matchMode==='any'&&draft.targets[preferred].trim()&&empty>=0?empty:preferred;
          draft.targets[field]=display(ability);dialog.close();resetSearch();tab='randomizer';render();
          $('target-'+field).focus();$('search-button').scrollIntoView({block:'center'});notify(`${ability.name} selected. Find combinations to apply it.`);
        });
      };
      $('ability-picker-filter').oninput=draw;draw();
    }
    dialog.showModal();if(variable)$('ability-picker-filter').focus();
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
    $('health-banner').innerHTML=save.damaged.length?`<span>⚠ ${save.damaged.length} section checksum(s) failed. Editing is disabled; restore a backup.</span>`:`<span>✓ All 20 section checksums pass</span><span class="secondary-text">Save counter ${save.counter} · Level cap ${save.cap()} · ${catalog.version} catalog</span>`;
  }
  function drawRoster(){
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
    if(tab==='settings'){renderSettings();return;}if(tab==='review'){renderReview();return;}
    const m=mon();if(!m||!m.species){$('editor-panel').innerHTML='<div class="panel empty-box">Select a Pokémon from your roster.</div>';return;}
    try{save.assertMon(m);}catch(e){$('editor-panel').innerHTML=`<div class="notice warning">${html(e.message)} Choose another Pokémon.</div>`;return;}
    if(tab==='randomizer')renderRandomizer(m);else renderPokemon(m);
  }
  function renderPokemon(m){
    const s=catalog.species[m.species],stats=ERCore.calcStats(m,s,options(),options().difficulty===3&&save.flag(2893));
    $('editor-panel').innerHTML=`${heading(m)}<div class="ability-overview" id="pokemon-abilities">${abilityCards(m)}</div><form id="pokemon-form"><fieldset ${save.damaged.length?'disabled':''} style="border:0;padding:0;margin:0">
    <section class="panel"><div class="panel-heading"><h2>IDENTITY & DETAILS</h2><span>PID ${m.pid.toString(16).toUpperCase().padStart(8,'0')}</span></div><div class="field-grid">
    ${catalogField('Species','species','species',m.species)}<label class="field"><span>Nickname · up to 12 characters</span><input name="nickname" value="${html(m.nickname)}" maxlength="12" required></label>${numberField(`Level · current cap ${save.cap()}`,'level',m.level,1,100)}
    ${selectField('Nature','nature',m.nature,catalog.natures)}${catalogField('Held item','heldItem','items',m.heldItem)}${selectField('Equipped ability','abilitySlot',m.abilitySlot,abilityChoices(s,m.pid).map((id,i)=>`Slot ${i+1} — ${catalog.abilities[id]?.name||`#${id}`}`))}
    ${numberField('Friendship','friendship',m.friendship,0,255)}${selectField('Poké Ball','ball',m.ball,ballNames())}${selectField('Shininess','shiny',m.shiny,['Normal','Star shiny','Square shiny','Special palette'])}
    ${selectField('Hidden Power type','hpType',m.hpType,[...catalog.types,'None'])}${numberField('Met level','metLevel',m.metLevel,0,100)}<label class="field"><span>Original trainer</span><input value="${html(m.otName)} · ${m.otid>>>0}" readonly></label>
    </div><div class="checkrow"><label><input name="egg" type="checkbox" ${m.egg?'checked':''}> Egg</label><label><input name="speedDown" type="checkbox" ${m.speedDown?'checked':''}> Zero Speed IV</label></div><p class="field-help">Species or PID changes can alter randomized abilities. Level changes write experience and refresh party stats.</p></section>
    <div class="two-columns"><section class="panel"><div class="panel-heading"><h2>STATS & EVS</h2><span>IVs are fixed at 31 in Redux</span></div><table class="stat-table"><thead><tr><th>STAT</th><th>BASE</th><th></th><th>IV</th><th>EV</th><th>FINAL</th></tr></thead><tbody>${statLabels.map((label,i)=>`<tr><td>${label}</td><td>${s.base[i]}</td><td><div class="stat-bar"><i style="width:${Math.min(100,s.base[i]/2.55)}%"></i></div></td><td>${(options().difficulty===3&&save.flag(2893))||(i===5&&m.speedDown)?0:31}</td><td><input type="number" name="ev${i}" aria-label="${label} EV" value="${m.evs[i]}" min="0" max="252" required></td><td>${stats[i]}</td></tr>`).join('')}</tbody></table><div class="form-footer"><span id="ev-total" class="ev-total">${m.evs.reduce((a,b)=>a+b,0)} / 510 EVs</span><div class="actions-inline"><button type="button" data-ev="physical">Physical</button><button type="button" data-ev="special">Special</button><button type="button" data-ev="reset">Clear</button></div></div><p class="field-help">EVs ${options().enableEvs?'enabled':'disabled in this save'}. Final stats are calculated for the current build. ${ref.kind==='party'?`HP ${m.hp}/${m.stats[0]}.`:'Box Pokémon recalculate their stats when withdrawn.'}</p></section>
    <section class="panel"><div class="panel-heading"><h2>MOVESET</h2><span>${ref.kind==='party'?'MOVE / CURRENT PP':'MOVE'}</span></div><div class="moves-list">${m.moves.map((id,i)=>{const move=catalog.moves[id];return `<div class="move-row"><span class="ordinal">0${i+1}</span><input name="move${i+1}" list="list-moves" value="${html(display(move))}" autocomplete="off" aria-label="Move ${i+1}" required>${ref.kind==='party'?`<input name="pp${i}" type="number" value="${m.pp[i]}" min="0" max="${ERCore.maxPP(move)}" aria-label="Move ${i+1} PP" required>`:'<span></span>'}<div class="move-meta" id="move-meta-${i}">${typeTags(move.types)}<span>${move.power?`${move.power} power · `:''}${ERCore.maxPP(move)} max PP</span></div></div>`;}).join('')}</div><div class="form-footer"><p>All ${Object.keys(catalog.moves).length} moves, including IDs above 999.</p>${ref.kind==='party'?'<button type="button" id="max-pp">Restore PP</button>':''}</div></section></div>
    <div class="panel form-footer"><p id="pending-note">Apply commits the whole Pokémon form. Ctrl+Z undoes it.</p><div class="actions-inline">${ref.kind==='party'?'<button type="button" id="heal-button">Heal Pokémon</button>':''}<button type="button" data-discard>Discard draft</button><button type="submit" class="primary">Apply Pokémon changes</button></div></div>
    </fieldset></form>`;
    const form=$('pokemon-form');bindDirty(form);
    const evUpdate=()=>{$('ev-total').textContent=`${statLabels.reduce((sum,_,i)=>sum+(+form.elements[`ev${i}`].value||0),0)} / 510 EVs`;};
    form.querySelectorAll('[name^=ev]').forEach(e=>e.addEventListener('input',evUpdate));
    form.querySelectorAll('[data-ev]').forEach(e=>e.onclick=()=>{const spread=e.dataset.ev==='physical'?[4,252,0,0,0,252]:e.dataset.ev==='special'?[4,0,0,252,0,252]:[0,0,0,0,0,0];spread.forEach((n,i)=>form.elements[`ev${i}`].value=n);dirty=true;evUpdate();sync();});
    for(let i=0;i<4;i++)form.elements[`move${i+1}`].addEventListener('change',()=>{try{const id=resolve('moves',form.elements[`move${i+1}`].value),move=catalog.moves[id];$('move-meta-'+i).innerHTML=typeTags(move.types)+`<span>${move.power?`${move.power} power · `:''}${ERCore.maxPP(move)} max PP</span>`;if(ref.kind==='party'){form.elements[`pp${i}`].max=ERCore.maxPP(move);form.elements[`pp${i}`].value=ERCore.maxPP(move);}}catch(e){fail(e);}});
    $('max-pp')?.addEventListener('click',()=>{try{for(let i=0;i<4;i++)form.elements[`pp${i}`].value=ERCore.maxPP(catalog.moves[resolve('moves',form.elements[`move${i+1}`].value)]);dirty=true;sync();}catch(e){fail(e);}});
    $('heal-button')?.addEventListener('click',()=>{if(guard())apply(()=>save.heal(ref),'Pokémon healed.');});
    form.onsubmit=e=>{e.preventDefault();try{const get=name=>form.elements[name].value,patch={nickname:get('nickname'),species:resolve('species',get('species')),level:+get('level'),nature:+get('nature'),heldItem:resolve('items',get('heldItem')),abilitySlot:+get('abilitySlot'),friendship:+get('friendship'),ball:+get('ball'),shiny:+get('shiny'),hpType:+get('hpType'),metLevel:+get('metLevel'),egg:+form.elements.egg.checked,speedDown:+form.elements.speedDown.checked,evs:statLabels.map((_,i)=>+get(`ev${i}`))};if(patch.shiny!==m.shiny)patch.maxShiny=Math.max(m.maxShiny,patch.shiny);for(let i=0;i<4;i++)patch[`move${i+1}`]=resolve('moves',get(`move${i+1}`));if(ref.kind==='party')patch.pp=m.moves.map((_,i)=>+get(`pp${i}`));apply(()=>save.editMon(ref,patch,`Edit ${m.nickname||s.name} (${ref.kind==='party'?'party':`box ${ref.box+1}`}, slot ${ref.slot+1})`),'Pokémon changes applied.');}catch(error){fail(error);}};
  }
  function renderRandomizer(m){
    const s=catalog.species[m.species],on=options().abilityRng||options().innateRng,draft=searchDraft();matchMode=draft.matchMode;
    $('editor-panel').innerHTML=`${heading(m)}<div class="ability-overview" id="lab-abilities">${abilityCards(m)}</div><p class="notice">Each Pokémon has three ability choices, with one equipped alongside its innates. Choose up to four abilities you want together. Any-order matching can place each one in the equipped ability or any innate slot. Blank inputs leave the remaining abilities unrestricted. Every result is verified against the ${catalog.config.modulus}-outcome randomizer.</p>${!on?'<p class="notice warning">Ability and innate randomizers are off. Enable the ones you want to change in Game settings before searching.</p>':''}
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
  function cancelSearch(){if(worker){worker.terminate();worker=null;}searchSession=null;if($('cancel-search'))$('cancel-search').hidden=true;if($('more-search'))$('more-search').hidden=true;if($('search-button'))$('search-button').disabled=!(options().abilityRng||options().innateRng)||!!save.damaged.length;}
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
      const url=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));worker=new Worker(url);URL.revokeObjectURL(url);searchResults=[];searchSession={request,complete:false,busy:true,checked:0,percent:0,elapsed:0,started:performance.now()};drawResults();$('search-button').disabled=true;$('cancel-search').hidden=false;$('search-meter').hidden=false;searchStatus();
      const searchWorker=worker;
      worker.onmessage=e=>{
        const data=e.data;if(worker!==searchWorker||!searchSession)return;
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
    const o=options(),labels={abilityRng:'Ability randomizer',innateRng:'Innate randomizer',encounterRng:'Encounter randomizer',encLegendRng:'Legendary encounters',moveRng:'Move randomizer',typeRng:'Type randomizer',permMega:'Permanent Mega mode',enableEvs:'Enable EVs',autoEVGain:'Automatic EV gain',autoExpGain:'Automatic EXP gain',autoEvolution:'Automatic evolution',autoRun:'Auto run',permanentRepel:'Permanent repel'};
    $('editor-panel').innerHTML=`<div class="page-heading"><h1>Your game, configured.</h1><p>Read directly from your save. Only the selected option bits are changed.</p></div><p class="notice">Turning an ability, innate, or type randomizer on or off immediately changes derived results for every Pokémon. Encounter settings affect future encounters. Existing stored moves stay as saved; the move randomizer affects generated movesets.</p><form id="settings-form"><fieldset ${save.damaged.length?'disabled':''} style="padding:0;border:0;margin:0"><section class="panel"><div class="panel-heading"><h2>RUN RULES</h2><span>${save.badge()===9?'Champion clear':`${save.badge()} badge stage`} · Level cap ${save.cap()}</span></div><div class="field-grid">${selectField('Difficulty','difficulty',o.difficulty,['Easy','Ace','Elite','Hell'])}${selectField('Level caps','levelCaps',o.levelCaps,['Easy caps','More caps','Elite caps','Caps off'])}${selectField('Shiny rate','shinyRate',o.shinyRate,['1 / 1,024','1 / 128','1 / 5','Reserved mode (default odds)'])}</div><h3 class="settings-section">RANDOMIZERS</h3><div class="settings-grid">${Object.entries(labels).slice(0,6).map(([k,l])=>`<label class="switch-field">${l}<input name="${k}" type="checkbox" ${o[k]?'checked':''}></label>`).join('')}</div><h3 class="settings-section">PLAY OPTIONS</h3><div class="settings-grid">${Object.entries(labels).slice(6).map(([k,l])=>`<label class="switch-field">${l}<input name="${k}" type="checkbox" ${o[k]?'checked':''}></label>`).join('')}</div><div class="form-footer"><p>Stat-affecting settings also refresh party stat caches.</p><div class="actions-inline"><button type="button" data-discard>Discard draft</button><button type="submit" class="primary">Apply game settings</button></div></div></section></fieldset></form>
    <section class="panel"><div class="panel-heading"><h2>GAME DATA PROFILE</h2><span>${html(catalog.version)}</span></div><p class="field-help" style="margin-top:0">${Object.keys(catalog.species).length.toLocaleString()} species · ${Object.keys(catalog.moves).length} moves · ${Object.keys(catalog.abilities).length} abilities · ${catalog.config.banned.length} randomizer exclusions. Save files do not identify the exact ROM revision. The bundled catalog is the published 2.65.4 snapshot; custom or newer ROMs need matching data.</p><p class="field-help">For another build, import a generated catalog with explicit randomizer configuration. Nextdex JSON is accepted for builds using the same 38 blocked abilities. Verify the profile against your ROM before using ability searches.</p><div class="form-footer"><div class="actions-inline"><button id="import-catalog">Import game data JSON</button><button id="reset-catalog">Use bundled 2.65.4 data</button></div><span class="ev-total">All data stays local</span></div><input id="catalog-file" type="file" accept=".json" hidden></section>`;
    const form=$('settings-form');bindDirty(form);form.onsubmit=e=>{e.preventDefault();const patch={};for(const k of Object.keys(labels))patch[k]=+form.elements[k].checked;for(const k of ['difficulty','levelCaps','shinyRate'])patch[k]=+form.elements[k].value;apply(()=>save.editOptions(patch),'Game settings applied.');};
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
    $('review-backup').onclick=backup;$('review-export').onclick=()=>exportSave($('extension').value);$('reset-all').onclick=()=>{save.reset();resetSearch();dirty=false;sync();drawRoster();render();notify('Restored the original save.');};
  }
  function download(bytes,name,type='application/octet-stream'){const url=URL.createObjectURL(new Blob([bytes],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);}
  function backup(){download(save.original,filename.replace(/\.(sav|srm)$/i,'')+'.original.'+(filename.toLowerCase().endsWith('.srm')?'srm':'sav'));notify('Original backup downloaded.');}
  function exportSave(ext){if(!guard())return;try{const bytes=save.export();const suffix=ext|| (filename.toLowerCase().endsWith('.srm')?'srm':'sav');download(bytes,filename.replace(/\.(sav|srm)$/i,'')+'.edited.'+suffix);notify('Export verified: 20 valid sections, 128 KB.');sync();}catch(e){fail(e);}}
  async function load(file){
    if(!file)return;if(!guard())return;
    try{const next=new ERCore.Save(await file.arrayBuffer(),catalog);cancelSearch();save=next;searchDrafts.clear();filename=file.name;roster='party';ref={kind:'party',slot:0};tab='pokemon';box=0;dirty=false;searchResults=[];$('welcome').hidden=true;$('workspace').hidden=false;$('filename').textContent=filename;$('roster-filter').value='';$('box-select').innerHTML=Array.from({length:26},(_,i)=>`<option value="${i}">${html(save.boxName(i))} · ${save.box(i).filter(m=>m.species).length}/30</option>`).join('');sync();drawRoster();render();notify(save.damaged.length?'This save has checksum errors; editing is disabled.':'Save loaded and checked.',!!save.damaged.length);}catch(e){fail(e);}finally{$('save-file').value='';}
  }
  $('save-file').onchange=e=>load(e.target.files[0]);$('open-button').onclick=()=>{if(guard())$('save-file').click();};$('backup-button').onclick=backup;$('export-button').onclick=()=>exportSave();
  $('demo-button').onclick=()=>load(new File([ERCore.demo(catalog)],'Demo.sav',{type:'application/octet-stream'}));
  $('undo-button').onclick=()=>{if(guard()){resetSearch();save.undo();sync();drawRoster();render();}};$('redo-button').onclick=()=>{if(guard()){resetSearch();save.redo();sync();drawRoster();render();}};
  document.querySelectorAll('[data-roster]').forEach(e=>e.onclick=()=>{if(!guard())return;resetSearch();roster=e.dataset.roster;const mons=roster==='party'?save.party():save.box(box).filter(m=>m.species);ref=mons[0]?.ref||null;drawRoster();render();});
  $('box-select').onchange=e=>{if(!guard()){e.target.value=box;return;}resetSearch();box=+e.target.value;ref=save.box(box).find(m=>m.species)?.ref||null;drawRoster();render();};
  $('roster-filter').oninput=()=>drawRoster();document.querySelectorAll('[data-tab]').forEach(e=>e.onclick=()=>{if(!guard())return;resetSearch();tab=e.dataset.tab;render();});
  document.addEventListener('keydown',e=>{if(!save||!(e.ctrlKey||e.metaKey)||e.key.toLowerCase()!=='z'||['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName))return;e.preventDefault();if(guard()){resetSearch();if(e.shiftKey)save.redo();else save.undo();sync();drawRoster();render();}});
  $('help-button').onclick=()=>$('help-dialog').showModal();$('close-help').onclick=()=>$('help-dialog').close();
  $('editor-panel').addEventListener('click',e=>{const button=e.target.closest('[data-pick-ability]');if(button)openAbilityPicker(button.dataset.pickAbility,+button.dataset.pickIndex);});
  const dz=$('dropzone');dz.ondragover=e=>{e.preventDefault();dz.classList.add('drag');};dz.ondragleave=()=>dz.classList.remove('drag');dz.ondrop=e=>{e.preventDefault();dz.classList.remove('drag');load(e.dataTransfer.files[0]);};
  $('offline-button').onclick=()=>{const parsed=new DOMParser().parseFromString(document.documentElement.outerHTML,'text/html');parsed.getElementById('welcome').removeAttribute('hidden');parsed.getElementById('workspace').setAttribute('hidden','');parsed.getElementById('editor-panel').innerHTML='';parsed.getElementById('roster-list').innerHTML='';parsed.getElementById('filename').textContent='';parsed.getElementById('save-meta').textContent='';parsed.getElementById('health-banner').innerHTML='';parsed.getElementById('box-select').innerHTML='';parsed.getElementById('toast').setAttribute('hidden','');parsed.querySelectorAll('datalist').forEach(e=>e.remove());download('<!doctype html>\n'+parsed.documentElement.outerHTML,'Redux Save Studio.html','text/html');};
  window.addEventListener('beforeunload',e=>{if(dirty||save?.changedBytes()){e.preventDefault();e.returnValue='';}});
})();
