(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ERCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const SECTION = 4096, DATA = 4084, SIGNATURE = 0x08012025;
  // Elite Redux 2.65: SB2=sections 0–1, SB1=2–7, storage=8–19.
  // This game has one save slot across 20 rotating sectors, not vanilla Emerald's two banks.
  const PARTY_START = 2 * DATA + 0x238, PC_START = 8 * DATA + 4;
  const OPTIONS = {
    difficulty: [0xc88, 12, 4, 3], levelCaps: [0xc8a, 0, 3, 3],
    innateRng: [0xc8a, 3, 1, 1], encounterRng: [0xc8a, 4, 1, 1],
    abilityRng: [0xc8a, 5, 1, 1], moveRng: [0xc8a, 6, 1, 1],
    typeRng: [0xc8a, 7, 1, 1], encLegendRng: [0xc8a, 8, 1, 1],
    autoRun: [0xc8a, 11, 1, 1], permanentRepel: [0xc8a, 12, 1, 1],
    shinyRate: [0xc8c, 0, 2, 3], enableEvs: [0xc8c, 2, 1, 1],
    autoEVGain: [0xc8c, 9, 1, 1], autoExpGain: [0xc8c, 10, 1, 1],
    permMega: [0xc8c, 11, 1, 1], autoEvolution: [0xc8c, 12, 1, 1],
    // Remaining SaveBlock2 option bits (Elite Redux include/global.h), verified against a 2.65.4 save.
    textSpeed: [0xc88, 0, 3, 3], frameType: [0xc88, 3, 5, 19], sound: [0xc88, 8, 1, 1],
    battleStyle: [0xc88, 9, 1, 1], battleSceneOff: [0xc88, 10, 1, 1],
    hpBarSpeed: [0xc8a, 9, 2, 3], damageDone: [0xc8a, 13, 1, 1], askForNickname: [0xc8a, 14, 1, 1],
    playerAI: [0xc8c, 3, 1, 1], individualColors: [0xc8c, 4, 1, 1], doubleBattles: [0xc8c, 5, 1, 1],
    buttonMode: [0xc8c, 6, 3, 2], battleTheme: [0xc8c, 13, 3, 3]
  };
  // SaveBlock1 starts at logical offset 2*DATA. Elite Redux keeps the bag as one "owned" bit per item ID.
  const SB1 = 2 * DATA, PARTY_COUNT = SB1 + 0x234, MONEY = SB1 + 0x400, COINS = SB1 + 0x404, ITEM_FLAGS = SB1 + 0x40a, ITEM_SLOTS = 2048;
  // SaveBlock2.frontier.battlePoints: the Battle Frontier block ends right where the option bits at 0xC88 begin.
  const BATTLE_POINTS = 0xc14, MAX_BATTLE_POINTS = 9999;
  const BOX_NAMES = PC_START + 780 * 52, MAX_MONEY = 999999, MAX_COINS = 9999;
  const STATUS = {none: 0, sleep: 0x7, poison: 1 << 3, burn: 1 << 4, freeze: 1 << 5, paralysis: 1 << 6, toxic: 1 << 7, frostbite: 1 << 12, bleed: 1 << 13};
  const LANGUAGES = {1: 'Japanese', 2: 'English', 3: 'French', 4: 'Italian', 5: 'German', 7: 'Spanish'};
  const FIELDS = {
    pid: [0, 0, 32], otid: [4, 0, 32], move1: [8, 0, 11], experience: [8, 11, 21],
    move2: [12, 0, 11], move3: [12, 11, 11], friendship: [12, 22, 8],
    eventMon: [12, 30, 1], alpha: [12, 31, 1], species: [16, 0, 16],
    move4: [16, 16, 11], hpType: [16, 27, 5], heldItem: [20, 0, 10],
    nature: [20, 10, 5], egg: [20, 15, 1], language: [20, 16, 3],
    metLevel: [20, 19, 7], shiny: [20, 26, 2], maxShiny: [20, 28, 2], abilitySlot: [20, 30, 2]
  };
  const DISPLAY_TO_STORE = [0, 1, 2, 4, 5, 3];
  const NATURES = ['Hardy','Lonely','Brave','Adamant','Naughty','Bold','Docile','Relaxed','Impish','Lax','Timid','Hasty','Serious','Jolly','Naive','Modest','Mild','Quiet','Bashful','Rash','Calm','Gentle','Sassy','Careful','Quirky'];
  const STAT_ORDER = [1, 2, 5, 3, 4];
  const charMap = new Map();
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach((c, i) => charMap.set(0xbb + i, c));
  'abcdefghijklmnopqrstuvwxyz'.split('').forEach((c, i) => charMap.set(0xd5 + i, c));
  '0123456789'.split('').forEach((c, i) => charMap.set(0xa1 + i, c));
  const punctuation = {0:' ',1:'À',2:'Á',3:'Â',4:'Ç',5:'È',6:'É',7:'Ê',8:'Ë',9:'Ì',11:'Î',12:'Ï',13:'Ò',14:'Ó',15:'Ô',16:'Œ',17:'Ù',18:'Ú',19:'Û',20:'Ñ',21:'ß',22:'à',23:'á',25:'ç',26:'è',27:'é',28:'ê',29:'ë',30:'ì',32:'î',33:'ï',34:'ò',35:'ó',36:'ô',37:'œ',38:'ù',39:'ú',40:'û',41:'ñ',42:'º',43:'ª',45:'&',46:'+',53:'=',54:';',81:'¿',82:'¡',90:'Í',91:'%',92:'(',93:')',104:'â',111:'í',133:'<',134:'>',171:'!',172:'?',173:'.',174:'-',175:'·',176:'…',177:'“',178:'”',179:'‘',180:"'",181:'♂',182:'♀',183:'¥',184:',',185:'×',186:'/'};
  Object.entries(punctuation).forEach(([b,c])=>charMap.set(+b,c));
  const encodeMap = new Map([...charMap].map(([b,c])=>[c,b]));
  function decode(bytes) { let s=''; for (const b of bytes) { if (b===255) break; s+=charMap.get(b) ?? '�'; } return s; }
  function encode(text, length) {
    const chars=[...text]; if (chars.length>length) throw new Error(`Name must be ${length} characters or fewer.`);
    const out=new Uint8Array(length).fill(255);
    chars.forEach((c,i)=>{if(!encodeMap.has(c)) throw new Error(`The game cannot encode “${c}”.`); out[i]=encodeMap.get(c);}); return out;
  }
  function checksum(bytes) {
    const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength); let sum=0;
    for(let i=0;i+4<=bytes.length;i+=4) sum=(sum+v.getUint32(i,true))>>>0;
    return ((sum>>>16)+(sum&65535))&65535;
  }
  function integer(value,min,max,label) { if(!Number.isInteger(value)||value<min||value>max) throw new Error(`${label} must be an integer from ${min} to ${max}.`); return value; }
  const expForLevel=l=>l<=1?1:Math.floor(5*l*l*l/4);
  const maxPP=move=>move.pp+Math.floor(move.pp*60/100);
  function levelForExp(exp) {let l=1;while(l<100&&expForLevel(l+1)<=exp)l++;return l;}
  function maskBits(view,off,shift,width,value) {
    if(width===32) {view.setUint32(off,value>>>0,true);return;}
    const mask=(((2**width)-1)<<shift)>>>0, current=view.getUint32(off,true);
    view.setUint32(off,((current&~mask)|(value<<shift))>>>0,true);
  }
  function readMon(bytes,ref) {
    const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength); const m={ref};
    for(const [name,[off,shift,width]] of Object.entries(FIELDS)) m[name]=width===32?v.getUint32(off,true):(v.getUint32(off,true)>>>shift)&((2**width)-1);
    m.nickname=decode(bytes.subarray(38,50));m.otName=decode(bytes.subarray(31,38));
    m.evs=DISPLAY_TO_STORE.map(i=>bytes[24+i]);m.metLocation=bytes[30];m.ball=bytes[50]&31;m.speedDown=(bytes[50]>>>5)&1;m.otGender=(bytes[50]>>>6)&1;m.disabled=(bytes[50]>>>7)&1;
    m.markings=bytes[51]&15;m.moves=[m.move1,m.move2,m.move3,m.move4];m.level=levelForExp(m.experience);
    if(ref.kind==='party') {m.pp=[...bytes.subarray(52,56)];m.status=v.getUint32(56,true);m.cachedLevel=bytes[60];m.hp=v.getUint16(62,true);m.stats=[64,66,68,72,74,70].map(o=>v.getUint16(o,true));}
    return m;
  }
  function calcStats(mon,species,options,zeroIV=false) {
    const evs=options.enableEvs?mon.evs:[0,0,0,0,0,0];const level=mon.level;const base=species.base;
    const iv=zeroIV?0:31;const up=STAT_ORDER[Math.floor(mon.nature/5)],down=STAT_ORDER[mon.nature%5];
    return base.map((b,i)=>{
      const thisIV=i===5&&mon.speedDown?0:iv;
      if(i===0) return /SHEDINJA/.test(species.key)?1:Math.floor((2*b+thisIV+Math.floor(evs[i]/4))*level/100)+level+10;
      let n=Math.floor((2*b+thisIV+Math.floor(evs[i]/4))*level/100)+5;
      if(up!==down) {if(i===up)n=Math.floor(n*110/100);if(i===down)n=Math.floor(n*90/100);}return n;
    });
  }
  function randomU32() {const c=globalThis.crypto;if(c?.getRandomValues)return c.getRandomValues(new Uint32Array(1))[0];return Math.floor(Math.random()*2**32)>>>0;}
  // Unbiased integer in [0, n) by rejection sampling on the smallest covering bit mask (no modulo bias).
  function randomInt(n) {if(!Number.isInteger(n)||n<1||n>2**31)throw new Error('Invalid random range.');let mask=1;while(mask<n)mask*=2;mask-=1;let x;do{x=randomU32()&mask;}while(x>=n);return x;}
  function sanitizeName(text,length) {let out='';for(const ch of text){if(!encodeMap.has(ch))continue;if([...out].length>=length)break;out+=ch;}return out;}
  // In-game nicknames use the base species name (Absol, not "Absol Mega"); find it via the species key prefix.
  const keyIndexes=new WeakMap();
  function baseSpeciesName(catalog,species) {
    let index=keyIndexes.get(catalog);
    if(!index){index=new Map();for(const s of Object.values(catalog.species))if(!index.has(s.key))index.set(s.key,s);keyIndexes.set(catalog,index);}
    const parts=species.key.split('_');
    for(let n=parts.length-1;n>=2;n--){const base=index.get(parts.slice(0,n).join('_'));if(base)return base.name;}
    return species.name;
  }
  class Save {
    constructor(input,catalog) {
      this.original=new Uint8Array(input instanceof ArrayBuffer?input:input.buffer.slice(input.byteOffset,input.byteOffset+input.byteLength)).slice();
      if(this.original.length!==131072) throw new Error('Expected a 128 KB Elite Redux battery save (.sav or .srm). Emulator savestates and other sizes are unsupported.');
      this.catalog=catalog;this.bytes=this.original.slice();this.undoStack=[];this.redoStack=[];this.history=[];this.sections=new Map();
      const v=new DataView(this.bytes.buffer); const counters=new Set();
      for(let slot=0;slot<28;slot++) {
        const offset=slot*SECTION,sid=v.getUint16(offset+DATA,true),signature=v.getUint32(offset+DATA+4,true);
        if(signature!==SIGNATURE) continue;
        if(sid>19) throw new Error(`Unsupported section ${sid}; this editor supports the modern 20-section Elite Redux format.`);
        if(this.sections.has(sid)) throw new Error(`Duplicate section ${sid}. Refusing to combine inconsistent save generations.`);
        const counter=v.getUint32(offset+DATA+8,true);counters.add(counter);
        this.sections.set(sid,{id:sid,offset,slot,counter,stored:v.getUint16(offset+DATA+2,true),computed:checksum(this.bytes.subarray(offset,offset+DATA))});
      }
      if(this.sections.size!==20) throw new Error(`Found ${this.sections.size}/20 sections. This may be an older format, an incomplete save, or a savestate.`);
      if(counters.size!==1) throw new Error('Save sections have different counters. This save is incomplete; restore a backup.');
      this.counter=[...counters][0];this.damaged=[...this.sections.values()].filter(s=>s.stored!==s.computed);
      const count=this.partyCount;if(count<1||count>6)throw new Error('Party count does not match the supported save layout.');
      // A single unrecognised Pokémon no longer blocks the whole save: it is reported and locked instead.
      const o=this.options(); if(o.difficulty>3||o.levelCaps>3)throw new Error('Game options do not match the supported save layout.');
      const currentBox=this.read(8*DATA,1)[0];if(currentBox>25)throw new Error('PC storage does not match the supported layout.');
    }
    get partyCount() {return this.read(PARTY_COUNT,1)[0];}
    assertMon(m) {
      if(!this.catalog.species[m.species]||m.experience>1250000||m.nature>24||m.abilitySlot>2||m.hpType>20||m.ball>27)throw new Error(`Unsupported Pokémon record at ${m.ref.kind} slot ${m.ref.slot+1}.`);
      if(m.moves.some(id=>!this.catalog.moves[id])||m.evs.some(n=>n>252))throw new Error(`Invalid move or EV data at ${m.ref.kind} slot ${m.ref.slot+1}.`);
      if(m.ref.kind==='party'&&(m.cachedLevel!==m.level||m.hp>m.stats[0]))throw new Error(`Invalid party cache at slot ${m.ref.slot+1}.`);
    }
    address(ref) {return ref.kind==='party'?PARTY_START+integer(ref.slot,0,this.partyCount-1,'Party slot')*76:PC_START+(integer(ref.box,0,25,'Box')*30+integer(ref.slot,0,29,'Box slot'))*52;}
    physical(logical) {const sid=Math.floor(logical/DATA); const section=this.sections.get(sid);if(!section)throw new Error('Missing save section');return section.offset+logical%DATA;}
    read(logical,length) {const out=new Uint8Array(length);for(let i=0;i<length;i++)out[i]=this.bytes[this.physical(logical+i)];return out;}
    write(logical,bytes) {for(let i=0;i<bytes.length;i++)this.bytes[this.physical(logical+i)]=bytes[i];}
    mon(ref) {return readMon(this.read(this.address(ref),ref.kind==='party'?76:52),ref);}
    party() {return Array.from({length:this.partyCount},(_,slot)=>this.mon({kind:'party',slot}));}
    box(box) {return Array.from({length:30},(_,slot)=>this.mon({kind:'box',box,slot}));}
    boxName(box) {return decode(this.read(PC_START+780*52+box*9,9))||`Box ${box+1}`;}
    trainer() {const a=this.read(0,20),v=new DataView(a.buffer);return {name:decode(a.subarray(0,8)),id:v.getUint32(10,true),hours:v.getUint16(14,true),minutes:a[16]};}
    options() {const a=this.read(0xc88,6),v=new DataView(a.buffer),o={};for(const [k,[off,s,w]]of Object.entries(OPTIONS))o[k]=(v.getUint16(off-0xc88,true)>>>s)&((1<<w)-1);return o;}
    flag(id) {const x=3*DATA+0x984+(id>>>3);return (this.read(x,1)[0]>>>(id&7))&1;}
    badge() {if(this.flag(2885))return 9;for(let i=8;i>=1;i--)if(this.flag(2888+i))return i;return 0;}
    cap() {const opts=this.options();if(opts.levelCaps===3)return 100;return [[20,28,44,55,65,80,90,100,100,100],[18,25,40,50,55,70,85,92,95,100],[16,23,36,45,50,55,60,70,80,100]][opts.levelCaps][this.badge()];}
    transact(label,fn) {
      if(this.damaged.length)throw new Error('Editing is disabled because this save has a failed checksum. Restore an undamaged backup.');
      const before=this.bytes.slice();try{fn();this.rechecksum();}catch(error){this.bytes=before;throw error;}
      if(!this.bytes.some((b,i)=>b!==before[i]))return;
      this.undoStack.push({bytes:before,label});if(this.undoStack.length>100)this.undoStack.shift();this.redoStack=[];this.history.push(label);
    }
    rechecksum() {const v=new DataView(this.bytes.buffer);for(const s of this.sections.values())v.setUint16(s.offset+DATA+2,checksum(this.bytes.subarray(s.offset,s.offset+DATA)),true);}
    undo() {const e=this.undoStack.pop();if(!e)return;this.redoStack.push({bytes:this.bytes.slice(),label:e.label});this.bytes=e.bytes;this.history.pop();}
    redo() {const e=this.redoStack.pop();if(!e)return;this.undoStack.push({bytes:this.bytes.slice(),label:e.label});this.bytes=e.bytes;this.history.push(e.label);}
    reset() {this.bytes=this.original.slice();this.undoStack=[];this.redoStack=[];this.history=[];}
    refreshParty(ref) {
      const a=this.read(this.address(ref),76),v=new DataView(a.buffer),m=readMon(a,ref),opts=this.options();
      const stats=calcStats(m,this.catalog.species[m.species],opts,opts.difficulty===3&&this.flag(2893));
      a[60]=m.level;[64,66,68,72,74,70].forEach((off,i)=>v.setUint16(off,stats[i],true));
      const hp=m.hp===0?0:Math.min(stats[0],Math.max(1,m.hp+stats[0]-m.stats[0]));v.setUint16(62,hp,true);this.write(this.address(ref),a);
    }
    editMon(ref,patch,label='Edit Pokémon') {
      this.transact(label,()=>{
        const addr=this.address(ref),a=this.read(addr,ref.kind==='party'?76:52),v=new DataView(a.buffer);
        const existing=this.mon(ref);if(!existing.species)throw new Error('Choose an occupied Pokémon slot.');
        let pendingHp=null;
        const statsChanged=['species','level','nature','speedDown'].some(k=>k in patch&&patch[k]!==existing[k])||('evs' in patch&&patch.evs.some((n,i)=>n!==existing.evs[i]));
        for(const [key,value]of Object.entries(patch)) {
          if(key==='nickname') {if(value!==existing.nickname)a.set(encode(value,12),38);continue;}
          if(key==='otName') {if(value!==existing.otName){if(!value.trim())throw new Error('Original trainer name cannot be empty.');a.set(encode(value,7),31);}continue;}
          if(key==='metLocation') {a[30]=integer(value,0,255,'Met location');continue;}
          if(key==='markings') {a[51]=(a[51]&0xf0)|integer(value,0,15,'Markings');continue;}
          if(key==='otGender') {a[50]=(a[50]&~0x40)|(integer(value,0,1,'OT gender')<<6);continue;}
          if(key==='status') {if(ref.kind!=='party')throw new Error('Status is only stored for party Pokémon.');if(!Number.isInteger(value)||value<0||value>0x3fff)throw new Error('Unsupported status value.');v.setUint32(56,value>>>0,true);continue;}
          if(key==='hp') {if(ref.kind!=='party')throw new Error('HP is only stored for party Pokémon.');pendingHp=integer(value,0,65535,'HP');continue;}
          if(key==='level') {integer(value,1,100,'Level');if(value!==existing.level)maskBits(v,8,11,21,expForLevel(value));continue;}
          if(key==='evs') {if(!Array.isArray(value)||value.length!==6||value.reduce((s,n)=>s+n,0)>510)throw new Error('EVs must have six values totalling no more than 510.');value.forEach((n,i)=>{a[24+DISPLAY_TO_STORE[i]]=integer(n,0,252,'EV');});continue;}
          if(key==='pp') {if(ref.kind!=='party'||!Array.isArray(value)||value.length!==4)throw new Error('PP is only stored for party Pokémon.');value.forEach((n,i)=>a[52+i]=integer(n,0,255,'PP'));continue;}
          if(['ball','speedDown','disabled'].includes(key)) {const [s,w]=key==='ball'?[0,5]:key==='speedDown'?[5,1]:[7,1];integer(value,0,key==='ball'?27:(1<<w)-1,key);a[50]=(a[50]&~(((1<<w)-1)<<s))|(value<<s);continue;}
          const spec=FIELDS[key];if(!spec)throw new Error(`Unknown field ${key}`);
          let max=2**spec[2]-1;if(key==='nature')max=24;if(key==='abilitySlot')max=2;if(key==='metLevel')max=100;if(key==='hpType')max=20;if(key==='language'&&!LANGUAGES[value])throw new Error('Unsupported language.');
          integer(value,0,max,key);if(key==='species'&&!this.catalog.species[value])throw new Error('Unknown species ID.');
          if(key.startsWith('move')&&!this.catalog.moves[value])throw new Error('Unknown move ID.');
          if(key==='heldItem'&&!this.catalog.items[value])throw new Error('Unknown item ID.');maskBits(v,...spec,value);
        }
        const m=readMon(a,ref);if(m.evs.reduce((s,n)=>s+n,0)>510)throw new Error('EV total exceeds 510.');
        if(ref.kind==='party')for(let i=0;i<4;i++)if(m.pp[i]>maxPP(this.catalog.moves[m.moves[i]]))throw new Error(`Move ${i+1} PP exceeds its maximum PP.`);
        this.write(addr,a);
        if(ref.kind==='party'&&statsChanged)this.refreshParty(ref);
        if(pendingHp!==null){const b=this.read(addr,76),bv=new DataView(b.buffer),max=bv.getUint16(64,true);if(pendingHp>max)throw new Error(`HP cannot exceed the maximum of ${max}.`);bv.setUint16(62,pendingHp,true);this.write(addr,b);}
        this.assertMon(this.mon(ref));
      });
    }
    heal(ref) {if(ref.kind!=='party')return;this.transact('Heal Pokémon',()=>{this.refreshParty(ref);const a=this.read(this.address(ref),76),v=new DataView(a.buffer),m=readMon(a,ref);v.setUint32(56,0,true);v.setUint16(62,m.stats[0],true);m.moves.forEach((id,i)=>a[52+i]=maxPP(this.catalog.moves[id]));this.write(this.address(ref),a);});}
    editOptions(patch) {this.transact('Update game settings',()=>{const before=this.options();for(const [k,n]of Object.entries(patch)){const f=OPTIONS[k];if(!f)throw new Error('Unknown setting');const[off,s,w,max]=f;integer(n,0,max,k);const a=this.read(off,2),v=new DataView(a.buffer);const mask=((1<<w)-1)<<s;v.setUint16(0,(v.getUint16(0,true)&~mask)|(n<<s),true);this.write(off,a);}if(['enableEvs','difficulty'].some(k=>k in patch&&patch[k]!==before[k]))for(const m of this.party())if(this.isValid(m))this.refreshParty(m.ref);});}
    // ---- Validity helpers -------------------------------------------------------------------
    isValid(m) {try{this.assertMon(m);return true;}catch{return false;}}
    invalidSlots() {const out=[];for(const m of this.party())if(!this.isValid(m))out.push(m.ref);for(let b=0;b<26;b++)for(const m of this.box(b))if(m.species&&!this.isValid(m))out.push(m.ref);return out;}
    // ---- Trainer, money, box names ------------------------------------------------------------
    trainerCard() {const a=this.read(0,20),v=new DataView(a.buffer),id=v.getUint32(10,true);return {name:decode(a.subarray(0,8)),gender:a[8]&1,id,tid:id&0xffff,sid:id>>>16,hours:v.getUint16(14,true),minutes:a[16],seconds:a[17]};}
    // Elite Redux resets the money/coin XOR key to 0 every time a save is loaded (src/load_save.c), so values are stored as-is.
    encryptionKey() {return 0;}
    money() {const key=this.encryptionKey(),m=(new DataView(this.read(MONEY,4).buffer).getUint32(0,true)^key)>>>0,c=(new DataView(this.read(COINS,2).buffer).getUint16(0,true)^(key&0xffff))&0xffff;return {money:m,coins:c,supported:m<=MAX_MONEY&&c<=MAX_COINS};}
    editTrainer(patch,{updateOwned=true}={}) {
      this.transact('Edit trainer card',()=>{
        const before=this.trainerCard(),a=this.read(0,20),v=new DataView(a.buffer);
        if('name' in patch){if(!patch.name.trim())throw new Error('Trainer name cannot be empty.');a.set(encode(patch.name,7),0);a[7]=255;}
        if('gender' in patch)a[8]=(a[8]&~1)|integer(patch.gender,0,1,'Gender');
        if('tid' in patch||'sid' in patch){const tid=integer(patch.tid??before.tid,0,65535,'Trainer ID'),sid=integer(patch.sid??before.sid,0,65535,'Secret ID');v.setUint32(10,((sid<<16)|tid)>>>0,true);}
        if('hours' in patch)v.setUint16(14,integer(patch.hours,0,999,'Hours'),true);
        if('minutes' in patch)a[16]=integer(patch.minutes,0,59,'Minutes');
        if('seconds' in patch)a[17]=integer(patch.seconds,0,59,'Seconds');
        this.write(0,a);
        const after=this.trainerCard();
        if(updateOwned&&(after.id!==before.id||after.name!==before.name||after.gender!==before.gender))
          for(const m of this.allMons())if(m.otid===before.id&&m.otName===before.name){const addr=this.address(m.ref),r=this.read(addr,52),rv=new DataView(r.buffer);rv.setUint32(4,after.id,true);r.set(encode(after.name,7),31);r[50]=(r[50]&~0x40)|(after.gender<<6);this.write(addr,r);}
      });
    }
    battlePoints() {const v=new DataView(this.read(BATTLE_POINTS,4).buffer),bp=v.getUint16(0,true),card=v.getUint16(2,true);return {battlePoints:bp,cardBattlePoints:card,supported:bp<=MAX_BATTLE_POINTS&&card<=MAX_BATTLE_POINTS};}
    editBattlePoints(value) {
      if(!this.battlePoints().supported)throw new Error('Battle Points could not be read safely from this save.');
      this.transact('Edit Battle Points',()=>{const a=new Uint8Array(2);new DataView(a.buffer).setUint16(0,integer(value,0,MAX_BATTLE_POINTS,'Battle Points'),true);this.write(BATTLE_POINTS,a);});
    }
    editMoney(patch) {
      const cur=this.money();if(!cur.supported)throw new Error('Money could not be read safely from this save.');
      this.transact('Edit money and coins',()=>{const key=this.encryptionKey();
        if('money' in patch){const a=new Uint8Array(4);new DataView(a.buffer).setUint32(0,(integer(patch.money,0,MAX_MONEY,'Money')^key)>>>0,true);this.write(MONEY,a);}
        if('coins' in patch){const a=new Uint8Array(2);new DataView(a.buffer).setUint16(0,(integer(patch.coins,0,MAX_COINS,'Coins')^key)&0xffff,true);this.write(COINS,a);}});
    }
    editBoxNames(names) {this.transact('Rename PC boxes',()=>{names.forEach((name,box)=>{if(name===undefined||name===this.boxName(box))return;if([...name].length>8)throw new Error(`Box ${box+1}: names must be 8 characters or fewer.`);this.write(BOX_NAMES+box*9,encode(name,9));});});}
    editBoxName(box,name) {integer(box,0,25,'Box');if([...name].length>8)throw new Error('Box names must be 8 characters or fewer.');this.transact(`Rename box ${box+1}`,()=>this.write(BOX_NAMES+box*9,encode(name,9)));}
    // ---- Bag (owned-item bit flags) ---------------------------------------------------------
    hasItem(id) {integer(id,0,ITEM_SLOTS-1,'Item');return (this.read(ITEM_FLAGS+(id>>>3),1)[0]>>>(id&7))&1;}
    ownedItems() {const a=this.read(ITEM_FLAGS,ITEM_SLOTS/8),out=[];for(let id=1;id<ITEM_SLOTS;id++)if((a[id>>>3]>>>(id&7))&1)out.push(id);return out;}
    editItems(changes) {
      this.transact('Edit bag items',()=>{const a=this.read(ITEM_FLAGS,ITEM_SLOTS/8);
        for(const [key,owned]of Object.entries(changes)){const id=integer(+key,1,ITEM_SLOTS-1,'Item');if(owned&&!this.catalog.items[id])throw new Error(`Unknown item ID ${id}.`);if(owned)a[id>>>3]|=1<<(id&7);else a[id>>>3]&=~(1<<(id&7));}
        this.write(ITEM_FLAGS,a);});
    }
    // ---- Adding, removing and moving Pokémon -----------------------------------------------------
    allMons() {const out=this.party();for(let b=0;b<26;b++)out.push(...this.box(b).filter(m=>m.species));return out;}
    rawRecord(ref) {return this.read(this.address(ref),ref.kind==='party'?76:52);}
    firstEmptyBox(start=0) {for(let i=0;i<26;i++){const b=(start+i)%26;for(let slot=0;slot<30;slot++)if(!this.mon({kind:'box',box:b,slot}).species)return {kind:'box',box:b,slot};}return null;}
    // Builds a 52-byte box record the same way the game's CreateBoxMon does, with the player as OT.
    newRecord(o) {
      const species=this.catalog.species[o.species];if(!species)throw new Error('Unknown species ID.');
      const t=this.trainerCard(),level=integer(o.level??5,1,100,'Level'),a=new Uint8Array(52),v=new DataView(a.buffer);
      const moves=(o.moves||[]).slice(0,4);while(moves.length<4)moves.push(0);
      moves.forEach(id=>{if(!this.catalog.moves[id])throw new Error('Unknown move ID.');});
      if(!moves.some(Boolean))throw new Error('Choose at least one move.');
      v.setUint32(0,(o.pid??randomU32())>>>0,true);v.setUint32(4,o.otid??t.id,true);
      a.set(encode(o.otName??t.name,7),31);
      let nick=o.nickname;if(nick===undefined)nick=sanitizeName(baseSpeciesName(this.catalog,species),12);a.set(encode(nick,12),38);
      a[50]=4|((o.speedDown?1:0)<<5)|((o.otGender??t.gender)<<6);a[30]=o.metLocation??0xff;
      const hpType=o.hpType??[0,1,2,3,4,5,6,7,8,10,11,12,13,14,15,16,17,18][randomInt(18)];
      const f=(key,val)=>maskBits(v,...FIELDS[key],val);
      f('move1',moves[0]);f('experience',expForLevel(level));f('move2',moves[1]);f('move3',moves[2]);f('friendship',integer(o.friendship??70,0,255,'Friendship'));
      f('species',o.species);f('move4',moves[3]);f('hpType',hpType);
      f('heldItem',o.heldItem??0);if(o.heldItem&&!this.catalog.items[o.heldItem])throw new Error('Unknown item ID.');
      f('nature',integer(o.nature??randomInt(25),0,24,'Nature'));f('language',2);f('metLevel',level);
      f('shiny',integer(o.shiny??0,0,3,'Shininess'));f('maxShiny',o.shiny??0);f('abilitySlot',integer(o.abilitySlot??0,0,2,'Ability slot'));
      const evs=o.evs||[0,0,0,0,0,0];if(evs.length!==6||evs.reduce((s,n)=>s+n,0)>510)throw new Error('EVs must have six values totalling no more than 510.');evs.forEach((n,i)=>a[24+DISPLAY_TO_STORE[i]]=integer(n,0,252,'EV'));
      return a;
    }
    // Expands a 52-byte record to the 76-byte party form: full PP and HP, no status, calculated stats.
    partyForm(box) {
      const a=new Uint8Array(76);a.set(box.subarray(0,52));const m=readMon(a,{kind:'box'}),v=new DataView(a.buffer),opts=this.options();
      m.moves.forEach((id,i)=>a[52+i]=id?maxPP(this.catalog.moves[id]):0);a[60]=m.level;a[61]=255;
      const stats=calcStats(m,this.catalog.species[m.species],opts,opts.difficulty===3&&this.flag(2893));
      [64,66,68,72,74,70].forEach((off,i)=>v.setUint16(off,stats[i],true));v.setUint16(62,stats[0],true);return a;
    }
    setPartyCount(n) {this.write(PARTY_COUNT,[n]);}
    placeRecord(ref,record) {
      if(ref.kind==='party'){
        if(ref.slot===this.partyCount){if(this.partyCount>=6)throw new Error('Your party is full.');this.setPartyCount(this.partyCount+1);}
        this.write(this.address(ref),record.length===76?record:this.partyForm(record));
      } else this.write(this.address(ref),record.subarray(0,52));
    }
    removeRecord(ref) {
      if(ref.kind==='box'){this.write(this.address(ref),new Uint8Array(52));return;}
      const n=this.partyCount;if(n<=1)throw new Error('Your party must keep at least one Pokémon.');
      for(let i=ref.slot;i<n-1;i++)this.write(this.address({kind:'party',slot:i}),this.rawRecord({kind:'party',slot:i+1}));
      this.write(this.address({kind:'party',slot:n-1}),new Uint8Array(76));this.setPartyCount(n-1);
    }
    assertPartyUsable() {if(!this.party().some(m=>!m.egg))throw new Error('Your party must keep at least one Pokémon that is not an Egg.');}
    resolveTarget(target) {
      if(!target)throw new Error('Choose where to put the Pokémon.');
      if(target.kind==='party'){if(target.slot===undefined&&this.partyCount>=6)throw new Error('Your party is full. Choose a PC box instead.');const slot=target.slot??this.partyCount;integer(slot,0,5,'Party slot');if(slot>this.partyCount)throw new Error('Party slots fill in order.');return {kind:'party',slot};}
      if(target.slot===undefined){const r=this.firstEmptyBox(target.box??0);if(!r)throw new Error('All PC boxes are full.');return r;}
      return {kind:'box',box:integer(target.box,0,25,'Box'),slot:integer(target.slot,0,29,'Box slot')};
    }
    occupied(ref) {return ref.kind==='party'?ref.slot<this.partyCount:!!this.mon(ref).species;}
    createMon(target,options,label) {
      let placed;
      this.transact(label||'Add Pokémon',()=>{
        const ref=this.resolveTarget(target);if(this.occupied(ref))throw new Error('That slot is already occupied.');
        this.placeRecord(ref,this.newRecord(options));placed=ref;this.assertMon(this.mon(ref));
      });
      return placed;
    }
    deleteMon(ref) {this.transact(`Release ${this.mon(ref).nickname||'Pokémon'}`,()=>{if(!this.occupied(ref))throw new Error('That slot is empty.');this.removeRecord(ref);if(ref.kind==='party')this.assertPartyUsable();});}
    duplicateMon(ref,target) {
      let placed;this.transact(`Duplicate ${this.mon(ref).nickname||'Pokémon'}`,()=>{if(!this.occupied(ref))throw new Error('That slot is empty.');const dest=this.resolveTarget(target);if(this.occupied(dest))throw new Error('That slot is already occupied.');this.placeRecord(dest,this.rawRecord(ref).slice(0,52));placed=dest;});return placed;
    }
    // Moves a Pokémon; if the destination is occupied the two swap. Box→party heals like a withdrawal.
    moveMon(from,to) {
      let placed;
      this.transact(`Move ${this.mon(from).nickname||'Pokémon'}`,()=>{
        if(!this.occupied(from))throw new Error('That slot is empty.');
        let dest=this.resolveTarget(to);
        if(dest.kind===from.kind&&dest.slot===from.slot&&(dest.kind==='party'||dest.box===from.box))throw new Error('Choose a different slot.');
        const a=this.rawRecord(from).slice();
        if(from.kind==='party'&&dest.kind==='party'){
          if(dest.slot===this.partyCount)dest={kind:'party',slot:this.partyCount-1};
          const b=this.rawRecord(dest).slice();this.write(this.address(dest),a);this.write(this.address(from),b);
        } else if(this.occupied(dest)){
          const b=this.rawRecord(dest).slice();
          this.write(this.address(from),from.kind==='party'?this.partyForm(b):b.subarray(0,52));
          this.write(this.address(dest),dest.kind==='party'?this.partyForm(a):a.subarray(0,52));
        } else if(from.kind==='party'){
          this.placeRecord(dest,a.slice(0,52));this.removeRecord(from);
        } else {
          this.placeRecord(dest,a);this.removeRecord(from);
        }
        placed=dest;this.assertPartyUsable();
      });
      return placed;
    }
    healParty() {this.transact('Heal party',()=>{for(const m of this.party()){if(!this.isValid(m))continue;this.refreshParty(m.ref);const a=this.read(this.address(m.ref),76),v=new DataView(a.buffer),cur=readMon(a,m.ref);v.setUint32(56,0,true);v.setUint16(62,cur.stats[0],true);cur.moves.forEach((id,i)=>a[52+i]=id?maxPP(this.catalog.moves[id]):0);this.write(this.address(m.ref),a);}});}
    maxFriendshipParty() {this.transact('Max party friendship',()=>{for(const m of this.party()){if(!this.isValid(m))continue;const addr=this.address(m.ref),a=this.read(addr,76);maskBits(new DataView(a.buffer),...FIELDS.friendship,255);this.write(addr,a);}});}
    changedBytes() {let n=0;for(let i=0;i<this.bytes.length;i++)if(this.bytes[i]!==this.original[i])n++;return n;}
    report() {return [...this.sections.values()].sort((a,b)=>a.id-b.id).map(s=>{const v=new DataView(this.bytes.buffer),stored=v.getUint16(s.offset+DATA+2,true),computed=checksum(this.bytes.subarray(s.offset,s.offset+DATA));return {id:s.id,slot:s.slot,stored,computed,valid:stored===computed};});}
    export() {if(this.damaged.length)throw new Error('Cannot export edits from a damaged save.');this.rechecksum();const copy=this.bytes.slice();new Save(copy,this.catalog);return copy;}
  }
  // ---- Showdown / Smogon text sets ---------------------------------------------------------------
  const SHOWDOWN_STATS=['HP','Atk','Def','SpA','SpD','Spe'];
  const normalize=t=>String(t).normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const nameIndexes=new WeakMap();
  function nameIndex(catalog,kind) {
    let all=nameIndexes.get(catalog);if(!all){all={};nameIndexes.set(catalog,all);}
    if(!all[kind]){const m=new Map();for(const e of Object.values(catalog[kind])){const k=normalize(e.name);if(k&&!m.has(k))m.set(k,e.id);}all[kind]=m;}
    return all[kind];
  }
  function lookup(catalog,kind,name) {
    const index=nameIndex(catalog,kind),key=normalize(name);if(index.has(key))return index.get(key);
    if(kind==='species'){ // Showdown writes forms as "Charizard-Mega-X"; Nextdex as "Charizard Mega X" or "Mega Charizard X".
      const parts=String(name).split('-');if(parts.length>1){const alt=normalize(parts.slice(1).join(' ')+' '+parts[0]);if(index.has(alt))return index.get(alt);}
    }
    return undefined;
  }
  function toShowdown(m,catalog,abilityName) {
    const species=catalog.species[m.species],lines=[];
    const base=baseSpeciesName(catalog,species),nick=m.nickname&&m.nickname!==base&&m.nickname!==species.name?`${m.nickname} (${species.name})`:species.name;
    lines.push(nick+(m.heldItem?` @ ${catalog.items[m.heldItem]?.name||m.heldItem}`:''));
    if(abilityName)lines.push(`Ability: ${abilityName}`);
    lines.push(`Level: ${m.level}`);if(m.shiny)lines.push('Shiny: Yes');if(m.friendship!==255)lines.push(`Happiness: ${m.friendship}`);
    const evs=m.evs.map((n,i)=>n?`${n} ${SHOWDOWN_STATS[i]}`:'').filter(Boolean);if(evs.length)lines.push(`EVs: ${evs.join(' / ')}`);
    lines.push(`${catalog.natures[m.nature]} Nature`);if(m.speedDown)lines.push('IVs: 0 Spe');
    for(const id of m.moves)if(id)lines.push(`- ${catalog.moves[id]?.name||id}`);
    return lines.join('\n');
  }
  function parseShowdown(text,catalog) {
    const lines=String(text).split(/\r?\n/).map(l=>l.trim()).filter(Boolean);if(!lines.length)throw new Error('Paste a Showdown set first.');
    const set={moves:[],evs:[0,0,0,0,0,0],warnings:[]};
    let head=lines[0],item;const at=head.lastIndexOf(' @ ');if(at>=0){item=head.slice(at+3).trim();head=head.slice(0,at).trim();}
    head=head.replace(/\s*\((M|F)\)\s*$/,'');
    const paren=/^(.*)\(([^()]+)\)\s*$/.exec(head);let speciesName=head;
    if(paren){speciesName=paren[2].trim();set.nickname=paren[1].trim();}
    set.species=lookup(catalog,'species',speciesName);if(!set.species)throw new Error(`Unknown species “${speciesName}”.`);
    if(item){set.heldItem=lookup(catalog,'items',item);if(!set.heldItem){set.warnings.push(`Item “${item}” is not in this game's data and was skipped.`);delete set.heldItem;}}
    for(const line of lines.slice(1)){
      let r;
      if(line.startsWith('-')){const name=line.replace(/^-\s*/,'').split('/')[0].trim();const id=lookup(catalog,'moves',name.replace(/^Hidden Power \[?\w+\]?$/i,'Hidden Power'));if(id&&set.moves.length<4)set.moves.push(id);else if(!id)set.warnings.push(`Move “${name}” is not in this game's data and was skipped.`);}
      else if((r=/^Ability:\s*(.+)$/i.exec(line))){set.ability=lookup(catalog,'abilities',r[1]);set.abilityName=r[1].trim();if(!set.ability)set.warnings.push(`Ability “${r[1].trim()}” is not in this game's data.`);}
      else if((r=/^Level:\s*(\d+)/i.exec(line)))set.level=Math.min(100,Math.max(1,+r[1]));
      else if((r=/^Shiny:\s*(yes|no)/i.exec(line)))set.shiny=r[1].toLowerCase()==='yes'?1:0;
      else if((r=/^Happiness:\s*(\d+)/i.exec(line)))set.friendship=Math.min(255,+r[1]);
      else if((r=/^EVs:\s*(.+)$/i.exec(line)))for(const part of r[1].split('/')){const p=/(\d+)\s*(\w+)/.exec(part.trim());const i=p?SHOWDOWN_STATS.findIndex(s=>s.toLowerCase()===p[2].toLowerCase()):-1;if(i>=0)set.evs[i]=Math.min(252,+p[1]);}
      else if((r=/^(\w+)\s+Nature$/i.exec(line))){const i=catalog.natures.findIndex(n=>n.toLowerCase()===r[1].toLowerCase());if(i>=0)set.nature=i;else set.warnings.push(`Unknown nature “${r[1]}”.`);}
      else if((r=/^IVs:\s*(.+)$/i.exec(line))){if(/(^|\/)\s*0\s*Spe/i.test(r[1]))set.speedDown=1;}
    }
    if(set.evs.reduce((a,b)=>a+b,0)>510){set.warnings.push('EVs totalled over 510 and were cleared.');set.evs=[0,0,0,0,0,0];}
    if(!set.moves.length)throw new Error('The set needs at least one move from this game.');
    if(set.nickname!==undefined){const clean=sanitizeName(set.nickname,12);if(clean!==set.nickname)set.warnings.push('The nickname was shortened or had unsupported characters removed.');set.nickname=clean||undefined;}
    return set;
  }
  function demo(catalog) {
    const bytes=new Uint8Array(131072).fill(255),v=new DataView(bytes.buffer),locations=new Map();
    for(let slot=0;slot<20;slot++){const sid=(slot+16)%20,off=slot*SECTION;bytes.fill(0,off,off+DATA);v.setUint16(off+DATA,sid,true);v.setUint32(off+DATA+4,SIGNATURE,true);v.setUint32(off+DATA+8,4,true);locations.set(sid,off);}
    const put=(logical,data)=>data.forEach((n,i)=>bytes[locations.get(Math.floor((logical+i)/DATA))+(logical+i)%DATA]=n);
    put(0,encode('Demo',8));put(0xc88,[3,7,0x28,0x2e,4,6]);put(2*DATA+0x234,[2]);
    function record(id,pid,name,moves){const a=new Uint8Array(76),dv=new DataView(a.buffer);dv.setUint32(0,pid,true);dv.setUint32(4,12345678,true);dv.setUint32(8,(expForLevel(50)<<11)|moves[0],true);dv.setUint32(12,moves[1]|(moves[2]<<11)|(200<<22),true);dv.setUint32(16,id|(moves[3]<<16)|(14<<27),true);dv.setUint32(20,(15<<10)|(2<<16)|(50<<19),true);a.set(encode('Demo',7),31);a.set(encode(name,12),38);a[50]=4;a[60]=50;a[61]=255;moves.forEach((id,i)=>a[52+i]=maxPP(catalog.moves[id]));const m=readMon(a,{kind:'party',slot:0});const stats=calcStats(m,catalog.species[id],{enableEvs:1});[64,66,68,72,74,70].forEach((off,i)=>dv.setUint16(off,stats[i],true));dv.setUint16(62,stats[0],true);return a;}
    put(PARTY_START,record(150,0x38f74699,'Mewtwo',[85,326,53,396]));put(PARTY_START+76,record(359,0x1155e9b4,'Absol',[801,583,404,421]));
    put(PC_START,record(286,0x57698d71,'Breloom',[331,183,409,182]).subarray(0,52));put(PC_START+78*52,record(484,0x7173cce9,'Palkia',[57,414,58,408]).subarray(0,52));
    for(let box=0;box<26;box++)put(PC_START+780*52+box*9,encode('Box '+(box+1),9));
    for(const off of locations.values())v.setUint16(off+DATA+2,checksum(bytes.subarray(off,off+DATA)),true);return bytes;
  }
  return {Save,demo,randomInt,toShowdown,parseShowdown,baseSpeciesName,sanitizeName,STATUS,LANGUAGES,readMon,checksum,decode,encode,calcStats,expForLevel,levelForExp,maxPP,NATURES,SECTION,DATA,SIGNATURE,PARTY_START,PC_START,OPTIONS};
});
