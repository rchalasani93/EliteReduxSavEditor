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
    permMega: [0xc8c, 11, 1, 1], autoEvolution: [0xc8c, 12, 1, 1]
  };
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
    m.evs=DISPLAY_TO_STORE.map(i=>bytes[24+i]);m.metLocation=bytes[30];m.ball=bytes[50]&31;m.speedDown=(bytes[50]>>>5)&1;m.disabled=(bytes[50]>>>7)&1;
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
      const count=this.read(2*DATA+0x234,1)[0];if(count<1||count>6)throw new Error('Party count does not match the supported save layout.');this.partyCount=count;
      for(const m of this.party()) this.assertMon(m);
      const o=this.options(); if(o.difficulty>3||o.levelCaps>3)throw new Error('Game options do not match the supported save layout.');
      const currentBox=this.read(8*DATA,1)[0];if(currentBox>25)throw new Error('PC storage does not match the supported layout.');
    }
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
        const statsChanged=['species','level','nature','speedDown'].some(k=>k in patch&&patch[k]!==existing[k])||('evs' in patch&&patch.evs.some((n,i)=>n!==existing.evs[i]));
        for(const [key,value]of Object.entries(patch)) {
          if(key==='nickname') {if(value!==existing.nickname)a.set(encode(value,12),38);continue;}
          if(key==='level') {integer(value,1,100,'Level');if(value!==existing.level)maskBits(v,8,11,21,expForLevel(value));continue;}
          if(key==='evs') {if(!Array.isArray(value)||value.length!==6||value.reduce((s,n)=>s+n,0)>510)throw new Error('EVs must have six values totalling no more than 510.');value.forEach((n,i)=>{a[24+DISPLAY_TO_STORE[i]]=integer(n,0,252,'EV');});continue;}
          if(key==='pp') {if(ref.kind!=='party'||!Array.isArray(value)||value.length!==4)throw new Error('PP is only stored for party Pokémon.');value.forEach((n,i)=>a[52+i]=integer(n,0,255,'PP'));continue;}
          if(['ball','speedDown','disabled'].includes(key)) {const [s,w]=key==='ball'?[0,5]:key==='speedDown'?[5,1]:[7,1];integer(value,0,key==='ball'?27:(1<<w)-1,key);a[50]=(a[50]&~(((1<<w)-1)<<s))|(value<<s);continue;}
          const spec=FIELDS[key];if(!spec)throw new Error(`Unknown field ${key}`);
          let max=2**spec[2]-1;if(key==='nature')max=24;if(key==='abilitySlot')max=2;if(key==='metLevel')max=100;if(key==='hpType')max=20;
          integer(value,0,max,key);if(key==='species'&&!this.catalog.species[value])throw new Error('Unknown species ID.');
          if(key.startsWith('move')&&!this.catalog.moves[value])throw new Error('Unknown move ID.');
          if(key==='heldItem'&&!this.catalog.items[value])throw new Error('Unknown item ID.');maskBits(v,...spec,value);
        }
        const m=readMon(a,ref);if(m.evs.reduce((s,n)=>s+n,0)>510)throw new Error('EV total exceeds 510.');
        if(ref.kind==='party')for(let i=0;i<4;i++)if(m.pp[i]>maxPP(this.catalog.moves[m.moves[i]]))throw new Error(`Move ${i+1} PP exceeds its maximum PP.`);
        this.write(addr,a);
        if(ref.kind==='party'&&statsChanged)this.refreshParty(ref);
        this.assertMon(this.mon(ref));
      });
    }
    heal(ref) {if(ref.kind!=='party')return;this.transact('Heal Pokémon',()=>{this.refreshParty(ref);const a=this.read(this.address(ref),76),v=new DataView(a.buffer),m=readMon(a,ref);v.setUint32(56,0,true);v.setUint16(62,m.stats[0],true);m.moves.forEach((id,i)=>a[52+i]=maxPP(this.catalog.moves[id]));this.write(this.address(ref),a);});}
    editOptions(patch) {this.transact('Update game settings',()=>{const before=this.options();for(const [k,n]of Object.entries(patch)){const f=OPTIONS[k];if(!f)throw new Error('Unknown setting');const[off,s,w,max]=f;integer(n,0,max,k);const a=this.read(off,2),v=new DataView(a.buffer);const mask=((1<<w)-1)<<s;v.setUint16(0,(v.getUint16(0,true)&~mask)|(n<<s),true);this.write(off,a);}if(['enableEvs','difficulty'].some(k=>k in patch&&patch[k]!==before[k]))for(const m of this.party())this.refreshParty(m.ref);});}
    changedBytes() {let n=0;for(let i=0;i<this.bytes.length;i++)if(this.bytes[i]!==this.original[i])n++;return n;}
    report() {return [...this.sections.values()].sort((a,b)=>a.id-b.id).map(s=>{const v=new DataView(this.bytes.buffer),stored=v.getUint16(s.offset+DATA+2,true),computed=checksum(this.bytes.subarray(s.offset,s.offset+DATA));return {id:s.id,slot:s.slot,stored,computed,valid:stored===computed};});}
    export() {if(this.damaged.length)throw new Error('Cannot export edits from a damaged save.');this.rechecksum();const copy=this.bytes.slice();new Save(copy,this.catalog);return copy;}
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
  return {Save,demo,readMon,checksum,decode,encode,calcStats,expForLevel,levelForExp,maxPP,NATURES,SECTION,DATA,SIGNATURE,PARTY_START,PC_START,OPTIONS};
});
