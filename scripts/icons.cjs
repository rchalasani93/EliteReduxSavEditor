const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),catalog=require('../src/catalog.json');
const revision='0a254c8edca412eec353f71597e70a2b47262128';
const cache=path.join(root,'research','sprites');fs.mkdirSync(cache,{recursive:true});
const queue=Object.values(catalog.species),images={};let done=0;
async function download(){
  for(;;){
    const species=queue.pop();if(!species)return;
    const name=species.key.replace(/^SPECIES_/,''),file=path.join(cache,name+'.png');
    if(!/^[A-Z0-9_]+$/.test(name))throw new Error('Invalid sprite name.');
    let bytes;
    if(fs.existsSync(file))bytes=fs.readFileSync(file);
    else{
      const url=`https://raw.githubusercontent.com/ForwardFeed/ER-nextdex/${revision}/static/sprites/${name}.png`;
      for(let attempt=0;attempt<3;attempt++){
        const response=await fetch(url);
        if(response.ok){bytes=Buffer.from(await response.arrayBuffer());break;}
        if(attempt===2)throw new Error(`Sprite ${name}: HTTP ${response.status}`);
        await new Promise(r=>setTimeout(r,500));
      }
      fs.writeFileSync(file,bytes);
    }
    if(bytes.toString('hex',0,8)!=='89504e470d0a1a0a')throw new Error('Invalid PNG: '+name);
    images[species.key]='data:image/png;base64,'+bytes.toString('base64');done++;
  }
}
Promise.all(Array.from({length:12},download)).then(()=>{
  const sorted=Object.fromEntries(Object.entries(images).sort(([a],[b])=>a.localeCompare(b)));
  fs.writeFileSync(path.join(root,'src','icons.json'),JSON.stringify({source:`https://github.com/ForwardFeed/ER-nextdex/tree/${revision}/static/sprites`,images:sorted}));
  console.log(`Bundled ${done} Pokémon sprites for offline use.`);
}).catch(error=>{console.error(error.message);process.exitCode=1;});
