export function validateModel(m){if(m?.schema!=='pci-bim-1'||!Array.isArray(m.entities)||m.entities.length>2000)throw Error('Expected a pci-bim-1 package from convert_ifc.py (max 2,000 objects).');let triangles=0;const ids=new Set;for(const e of m.entities){if(typeof e.class!=='string'||typeof e.name!=='string')throw Error('IFC objects need class and name metadata.');if(typeof e.id!=='string'||ids.has(e.id))throw Error('Missing or duplicate IFC identity.');ids.add(e.id);if(!Array.isArray(e.vertices)||!Array.isArray(e.faces)||e.vertices.length%3||e.faces.length%3||e.vertices.some(v=>!Number.isFinite(v))||e.faces.some(i=>!Number.isInteger(i)||i<0||i>=e.vertices.length/3))throw Error('Invalid mesh data.');triangles+=e.faces.length/3;if(triangles>600000)throw Error('Model exceeds 600,000 triangles; export a smaller subset.');if(e.class==='IfcSpace'&&!(Number.isFinite(e.volume_m3)&&e.volume_m3>0))throw Error('Space volume must be positive.');}if(!m.entities.length||m.entities.some(e=>!Array.isArray(e.bbox)||e.bbox.length!==2||e.bbox.some(b=>!Array.isArray(b)||b.length!==3||b.some(v=>!Number.isFinite(v)))))throw Error('Model needs finite room/object bounds.');if(!m.source?.name||!Array.isArray(m.candidate_links)||!Array.isArray(m.import_report?.geometry_missing))throw Error('Model metadata is incomplete.');if(m.source?.geometry_units!=='m')throw Error('Geometry must be normalized to meters.');return true;}
export const q=(dp,k)=>k*Math.sign(dp)*Math.sqrt(Math.abs(dp));
export function setup(m){const nodes=m.entities.filter(e=>e.class==='IfcSpace'&&e.storey!=='Roof').map(e=>({id:e.id,name:e.name,volume:e.volume_m3,supply:e.volume_m3/1000,exhaust:e.volume_m3/1000+.012,leak:.009}));const ids=new Set(nodes.map(n=>n.id));return{schema:'pci-network-1',basis:'SYNTHETIC assumptions; not extracted operating values',approved:false,nodes,links:(m.candidate_links??[]).filter(l=>ids.has(l.a)&&ids.has(l.b)).map(l=>({...l,k:.006,enabled:true}))};}
export function checkConfig(c){if(!c?.approved)throw Error('Review and approve the synthetic network assumptions first.');if(!Array.isArray(c.links))throw Error('Network connections must be an array.');if(!Array.isArray(c.nodes)||!c.nodes.length||c.nodes.length>100)throw Error('Select 1–100 pressure zones.');const ids=new Set;for(const n of c.nodes){if(ids.has(n.id))throw Error('Duplicate room identity.');ids.add(n.id);for(const k of ['volume','supply','exhaust','leak'])if(!Number.isFinite(n[k])||n[k]<(k==='volume'?1e-6:0))throw Error('Invalid room flow, volume or leakage.');if(n.leak<=0)throw Error('Each node needs positive reference leakage in this prototype.');}for(const l of c.links)if(!ids.has(l.a)||!ids.has(l.b)||l.a===l.b||!Number.isFinite(l.k)||l.k<=0)throw Error('Invalid room connection.');return true;}
export function balances(c,p,s=c.nodes.map(n=>n.supply),e=c.nodes.map(n=>n.exhaust)){const ids=new Map(c.nodes.map((n,i)=>[n.id,i]));return c.nodes.map((n,i)=>s[i]-e[i]-q(p[i],n.leak)-c.links.reduce((sum,l)=>sum+(!l.enabled?0:l.a===n.id?q(p[i]-p[ids.get(l.b)],l.k):l.b===n.id?q(p[i]-p[ids.get(l.a)],l.k):0),0));}
export function solveNetwork(c,s=c.nodes.map(n=>n.supply),e=c.nodes.map(n=>n.exhaust)){
 const n=c.nodes.length,ids=new Map(c.nodes.map((v,i)=>[v.id,i]));let p=c.nodes.map((v,i)=>Math.sign(s[i]-e[i])*((s[i]-e[i])/v.leak)**2);
 const norm=r=>Math.max(...r.map(Math.abs));
 for(let it=0;it<160;it++){
  const r=balances(c,p,s,e);if(norm(r)<1e-9)return p;
  const A=Array.from({length:n},()=>Array(n).fill(0));
  for(let i=0;i<n;i++)A[i][i]=.5*c.nodes[i].leak/Math.sqrt(Math.max(1e-10,Math.abs(p[i])));
  for(const l of c.links)if(l.enabled){const a=ids.get(l.a),b=ids.get(l.b),g=.5*l.k/Math.sqrt(Math.max(1e-10,Math.abs(p[a]-p[b])));A[a][a]+=g;A[b][b]+=g;A[a][b]-=g;A[b][a]-=g;}
  const aug=A.map((row,i)=>[...row,r[i]]);
  for(let k=0;k<n;k++){let pivot=k;for(let j=k+1;j<n;j++)if(Math.abs(aug[j][k])>Math.abs(aug[pivot][k]))pivot=j;[aug[k],aug[pivot]]=[aug[pivot],aug[k]];if(Math.abs(aug[k][k])<1e-15)throw Error('Singular pressure network.');const d=aug[k][k];for(let j=k;j<=n;j++)aug[k][j]/=d;for(let i=0;i<n;i++)if(i!==k){const f=aug[i][k];for(let j=k;j<=n;j++)aug[i][j]-=f*aug[k][j];}}
  const step=aug.map(row=>row[n]);let accepted=false;
  for(let alpha=1;alpha>1e-7;alpha*=.5){const trial=p.map((v,i)=>v+alpha*step[i]);if(norm(balances(c,trial,s,e))<norm(r)){p=trial;accepted=true;break;}}
  if(!accepted)break;
 }
 // The square-root law has an unbounded slope at equal endpoint pressures.
 // Newton can stall there even on valid networks. Solve each strictly monotone
 // nodal balance by bracketed bisection as a fallback, retaining the exact law.
 if(norm(balances(c,p,s,e))>1e-9){
  const adjacent=Array.from({length:n},()=>[]);
  for(const l of c.links)if(l.enabled){const a=ids.get(l.a),b=ids.get(l.b);adjacent[a].push([b,l.k]);adjacent[b].push([a,l.k]);}
  for(let sweep=0;sweep<5000;sweep++){
   for(let i=0;i<n;i++){
    const net=s[i]-e[i],isolated=Math.sign(net)*(net/c.nodes[i].leak)**2;
    let lo=Math.min(0,isolated,...adjacent[i].map(([j])=>p[j])),hi=Math.max(0,isolated,...adjacent[i].map(([j])=>p[j]));
    for(let step=0;step<60;step++){
     const mid=(lo+hi)/2,r=net-q(mid,c.nodes[i].leak)-adjacent[i].reduce((sum,[j,k])=>sum+q(mid-p[j],k),0);
     if(r>0)lo=mid;else hi=mid;
    }
    p[i]=(lo+hi)/2;
   }
   if(norm(balances(c,p,s,e))<1e-9)return p;
  }
 }
 const error=norm(balances(c,p,s,e));if(error>1e-6)throw Error('Network did not converge; residual '+error);return p;
}
export const SCENARIOS={normal:'Normal operation',exhaust:'Exhaust degradation',supply:'Excess supply',supplyLoss:'Supply loss',leak:'Increased reference leakage',door:'Door connection opens',sensor:'Sensor bias'};
export function runNetwork(c,scenario='normal',target=0,severity=.7,options={}){
 checkConfig(c);if(!Object.hasOwn(SCENARIOS,scenario))throw Error('Unknown scenario.');
 if(!Number.isInteger(target)||target<0||target>=c.nodes.length||!Number.isFinite(severity)||severity<0||severity>1)throw Error('Invalid target or severity.');
 const start=options.start??10,end=options.end??60;
 if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||start>=end||end>60)throw Error('Event times must satisfy 0 ≤ start < recovery ≤ 60 seconds.');
 const door=c.links.findIndex(l=>l.enabled&&(l.a===c.nodes[target].id||l.b===c.nodes[target].id));
 if(scenario==='door'&&door<0)throw Error('This room has no enabled door connection. Review/add a connection or select another room.');
 const frames=[];for(let t=0;t<=60;t+=.5){
  const factor=t<start?0:t<end?1-Math.exp(-(t-start)/4):(1-Math.exp(-(end-start)/4))*Math.exp(-(t-end)/4);
  const local={...c,nodes:c.nodes.map(n=>({...n})),links:c.links.map(l=>({...l}))},s=c.nodes.map(n=>n.supply),e=c.nodes.map(n=>n.exhaust);
  if(scenario==='exhaust')e[target]*=1-factor*severity;
  if(scenario==='supply')s[target]*=1+factor*severity;
  if(scenario==='supplyLoss')s[target]*=1-factor*severity;
  if(scenario==='leak')local.nodes[target].leak*=1+9*factor*severity;
  if(scenario==='door')local.links[door].k*=1+20*factor*severity;
  const p=solveNetwork(local,s,e),sensor=p.map((v,i)=>v+(scenario==='sensor'&&i===target?10*factor*severity:0));
  const indices=new Map(c.nodes.map((n,i)=>[n.id,i]));
  const flows=local.links.map(l=>l.enabled?q(p[indices.get(l.a)]-p[indices.get(l.b)],l.k):0);
  const referenceFlows=local.nodes.map((node,i)=>q(p[i],node.leak));
  frames.push({t,p,sensor,flows,referenceFlows,supply:s,exhaust:e,residual:Math.max(...balances(local,p,s,e).map(Math.abs))});
 }return frames;
}
export function summarize(frames,c,threshold=.2){
 return c.nodes.map((n,i)=>{const baseline=frames[0].p[i],last=frames.at(-1),ev=reversal(frames,i,threshold),maxChange=Math.max(...frames.map(f=>Math.abs(f.p[i]-baseline))),sensorError=Math.max(...frames.map(f=>Math.abs(f.sensor[i]-f.p[i])));
 return{id:n.id,name:n.name,baseline,last:last.p[i],maxChange,sensorError,...ev};}).sort((a,b)=>b.maxChange-a.maxChange);
}
export function reversal(frames,i,threshold=.2){let duration=0,peak=-Infinity,impulse=0;for(let k=0;k<frames.length;k++){const r=frames[k];peak=Math.max(peak,r.p[i]);if(k<frames.length-1&&r.p[i]>threshold){const dt=frames[k+1].t-r.t;duration+=dt;impulse+=Math.max(0,r.p[i])*dt;}}return{duration,peak,impulse,basis:'Left-endpoint sample integration; +0.2 Pa is a demo threshold, not WBHT acceptance criteria.'};}
export function parseCSV(text,ids){const lines=text.trim().split(/\r?\n/);if(lines.length<2||lines[0].trim()!=='time_s,space_id,pressure_pa')throw Error('CSV header must be time_s,space_id,pressure_pa');const seen=new Set;return lines.slice(1).map((line,k)=>{const a=line.split(',');if(a.length!==3||!a[0].trim()||!a[2].trim()||!ids.includes(a[1]))throw Error('Invalid room or CSV row '+(k+2));const t=Number(a[0]),v=Number(a[2]),key=t+':'+a[1];if(!Number.isFinite(t)||!Number.isFinite(v)||t<0||seen.has(key))throw Error('Invalid time/value or duplicate row '+(k+2));seen.add(key);return{t,id:a[1],value:v};}).sort((a,b)=>a.t-b.t);}
