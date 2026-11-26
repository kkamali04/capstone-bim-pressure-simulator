import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
const args=process.argv.slice(2);
const option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const host=option('--host','127.0.0.1'),port=Number(option('--port',process.env.PORT??3000)),root=process.cwd();
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.csv':'text/csv; charset=utf-8','.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png','.pdf':'application/pdf','.ifc':'application/octet-stream'};
const server=http.createServer(async(req,res)=>{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
  try{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    let path=resolve(root,'.'+pathname);
    if(path!==root&&!path.startsWith(root+sep)){res.writeHead(403);res.end();return;}
    if((await stat(path)).isDirectory())path=resolve(path,'index.html');
    const bytes=await readFile(path);
    res.writeHead(200,{'Content-Type':types[extname(path)]??'application/octet-stream','Cache-Control':'no-store'});
    res.end(req.method==='HEAD'?undefined:bytes);
  }catch{res.writeHead(404);res.end('Not found');}
});
server.listen(port,host,()=>process.stdout.write('Sure2 preview: http://'+host+':'+port+'\n'));

