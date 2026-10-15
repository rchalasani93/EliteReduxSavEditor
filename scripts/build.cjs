const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');let html=fs.readFileSync(path.join(root,'src/index.html'),'utf8');
for(const [marker,file]of [['STYLES','style.css'],['CATALOG','catalog.json'],['ICONS','icons.json'],['CORE','core.js'],['RNG','rng.js'],['APP','app.js']])html=html.replace(`/* ${marker} */`,()=>fs.readFileSync(path.join(root,'src',file),'utf8').replace(/<\/script/gi,'<\\/script'));
fs.mkdirSync(path.join(root,'dist'),{recursive:true});fs.writeFileSync(path.join(root,'dist/index.html'),html);fs.writeFileSync(path.join(root,'Redux Save Studio.html'),html);console.log(`Built standalone editor (${Math.round(Buffer.byteLength(html)/1024)} KB).`);
