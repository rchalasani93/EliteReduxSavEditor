const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../dist');
http.createServer((req,res)=>{let name;try{name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400);res.end();return;}
  const file=path.resolve(root,'.'+(name==='/'?'/index.html':name));if(file!==root&&!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);res.end('Not found');return;}res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':'application/octet-stream');res.setHeader('Cache-Control','no-store');res.end(data);});
}).listen(4173,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:4173'));
