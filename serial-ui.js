import {SerialCapture,SerialConnection} from './serial-capture.js';
const $=id=>document.getElementById(id);
export function setupSerialCapture({install,download,sha256}){
 let capture=null,active=false,replay=null,connecting=false,liveTimer=null,lastPaint=0;
 const supported=Boolean(navigator.serial&&window.isSecureContext);
 const controls=['captureRunId','captureNotes'];
 const connection=new SerialConnection({
  onChunk:text=>{if(active){capture.push(text);paint();}},
  onError:error=>{if(capture&&active)capture.error=error.message;$('captureStatus').textContent='Serial error: '+error.message;},
  onEnd:()=>{finish();if(capture?.error)$('captureStatus').textContent=capture.error;else $('captureStatus').textContent=capture?'Stopped. Save your capture before leaving this tab.':'Port disconnected.';}
 });
 function buttons(){
  $('serialConnect').disabled=!supported||active||Boolean(connection.port)||connecting;
  $('serialStart').disabled=!connection.port||active||connecting;
  $('serialStop').disabled=!active&&!connection.port;
  $('serialReplay').disabled=active||Boolean(connection.port)||connecting;
  controls.forEach(id=>$(id).disabled=active||connecting);
  for(const id of ['captureBaseline','captureFailure','captureRestore','captureMark'])$(id).disabled=!active||!capture?.rows.length;
  const saved=capture?.stoppedUTC;
  $('captureRaw').disabled=$('captureBundle').disabled=!saved;
  $('captureCSV').disabled=!saved||!capture.rows.length;
  $('captureAnalyze').disabled=!saved||Boolean(capture.error)||capture.rows.length<2;
 }
 function paint(force=false){
  if(!capture){buttons();return;}
  const now=performance.now();
  if(!force&&now-lastPaint<150){if(!liveTimer)liveTimer=setTimeout(()=>{liveTimer=null;paint(true);},150);return;}lastPaint=now;
  const latest=capture.preview.at(-1),f=x=>Number.isFinite(x)?x.toFixed(3)+' Pa':'No valid reading';
  $('captureSource').textContent=capture.source;
  $('captureCount').textContent=capture.rows.length+' rows · '+(capture.bytes/1024).toFixed(1)+' KB'+(latest?' · '+latest.t.toFixed(1)+' s elapsed':'');
  $('captureReading').textContent='DP A: '+f(latest?.a)+' · DP B: '+f(latest?.b);
  const items=capture.preview,key=$('captureChannel').value,values=items.filter(p=>Number.isFinite(p[key]));
  if(values.length){
   const low=Math.min(...values.map(p=>p[key]))-.5,high=Math.max(...values.map(p=>p[key]))+.5,start=items[0].t,end=items.at(-1).t;
   const x=t=>40+(t-start)/(end-start||1)*710,y=p=>18+(high-p)/(high-low)*130;
   const intervals=items.slice(1).map((p,i)=>p.t-items[i].t).sort((a,b)=>a-b),gap=intervals[Math.floor(intervals.length/2)]*1.5;
   let path='',previous=null;
   for(const p of items){if(!Number.isFinite(p[key])){previous=null;continue;}path+=(previous&&p.t-previous.t<=gap?'L':'M')+x(p.t)+' '+y(p[key])+' ';previous=p;}
   $('captureTrace').innerHTML='<svg viewBox="0 0 770 180" role="img" aria-label="Recent serial pressure samples"><path d="'+path+'" fill="none" stroke="#087a83" stroke-width="2"/>'+values.map(p=>'<circle cx="'+x(p.t)+'" cy="'+y(p[key])+'" r="2" fill="#087a83"/>').join('')+'<text x="3" y="24" font-size="12">'+high.toFixed(1)+'</text><text x="3" y="150" font-size="12">'+low.toFixed(1)+'</text><text x="40" y="175" font-size="12">'+start.toFixed(1)+' s</text><text x="690" y="175" font-size="12">'+end.toFixed(1)+' s</text></svg>';
  }else $('captureTrace').textContent='No valid '+(key==='a'?'DP A':'DP B')+' pressure samples. Flags and missing values are retained.';
  $('captureEvents').replaceChildren(...capture.events.map(event=>{const li=document.createElement('li');li.textContent=event.kind+' · latest sample '+event.elapsed_s.toFixed(1)+' s'+(event.note?' · '+event.note:'');return li;}));
  buttons();
 }
 function make(source){capture=new SerialCapture({runId:$('captureRunId').value,notes:$('captureNotes').value,source});active=true;$('captureStatus').textContent=source==='SYNTHETIC'?'Replaying synthetic serial text; no hardware is connected.':'Capturing at 115200 baud. Wait for timestamped rows.';paint(true);}
 function finish(){
  if(replay){clearInterval(replay);replay=null;}active=false;
  if(capture)capture.finish();paint(true);buttons();
 }
 $('serialConnect').onclick=async()=>{
  connecting=true;buttons();
  try{await connection.connect(navigator.serial);$('captureStatus').textContent='Connected. Start a run to record. Close Arduino Serial Monitor if the port was busy.';}
  catch(error){$('captureStatus').textContent=error.name==='NotFoundError'?'Port selection canceled.':error.message;}
  finally{connecting=false;buttons();}
 };
 $('serialStart').onclick=async()=>{
  const previous=capture;
  try{make('DEVICE_CAPTURE_UNVERIFIED');await connection.csvMode();}
  catch(error){if(capture&&capture!==previous)capture.error=error.message;await connection.disconnect();finish();$('captureStatus').textContent=error.message;}
 };
 $('serialStop').onclick=async()=>{try{if(connection.port)await connection.disconnect();else finish();}catch(error){if(capture)capture.error=error.message;finish();}if(!capture?.error)$('captureStatus').textContent='Stopped. Save your capture before leaving this tab.';};
 $('serialReplay').onclick=async()=>{
  connecting=true;buttons();
  try{
   const response=await fetch('./recording-examples/brief_SYNTHETIC.csv');if(!response.ok)throw Error('Synthetic stream could not be loaded.');
   const text=await response.text(),chunks=[];for(let i=0;i<text.length;i+=157)chunks.push(text.slice(i,i+157));
   make('SYNTHETIC');let i=0;
   replay=setInterval(()=>{try{capture.push(chunks[i++]);paint();if(i===chunks.length){finish();$('captureStatus').textContent='Synthetic stream complete. Save or load it into analysis. No hardware connection was tested.';}}catch(error){finish();$('captureStatus').textContent=error.message;}},60);
  }catch(error){$('captureStatus').textContent=error.message;}
  finally{connecting=false;buttons();}
 };
 for(const [id,kind]of [['captureBaseline','baseline'],['captureFailure','failure'],['captureRestore','restore'],['captureMark','note']])$(id).onclick=()=>{
  try{capture.mark(kind,$('captureEventNote').value);$('captureEventNote').value='';paint(true);}catch(error){$('captureStatus').textContent=error.message;}
 };
 $('captureChannel').onchange=()=>paint(true);
 const name=()=>capture.runId.replace(/[^a-z0-9_.-]/gi,'_')+'_'+(capture.source==='SYNTHETIC'?'SYNTHETIC':'CAPTURE_UNVERIFIED');
 $('captureRaw').onclick=()=>download(name()+'_raw.txt',capture.raw,'text/plain');
 $('captureCSV').onclick=()=>download(name()+'.csv',capture.csv(),'text/csv');
 $('captureBundle').onclick=async()=>{const bundle=capture.bundle();bundle.raw_serial_sha256=await sha256(capture.raw);download(name()+'_capture.json',JSON.stringify(bundle,null,2),'application/json');};
 $('captureAnalyze').onclick=async()=>{
  const bundle=capture.bundle();bundle.raw_serial_sha256=await sha256(capture.raw);
  await install(capture.csv(),name()+'.csv',capture.source==='SYNTHETIC',null,bundle);
  $('captureStatus').textContent='Loaded into analysis. Review channel, physical endpoints, baseline and event timing before interpreting results.';
 };
 if(!supported)$('captureSupport').textContent='USB serial is unavailable in this browser/context. Use a desktop browser with Web Serial over HTTPS or localhost, or upload a saved CSV. The synthetic stream still works.';
 window.addEventListener('beforeunload',event=>{if(active){event.preventDefault();event.returnValue='';}});
 window.addEventListener('pagehide',()=>{if(replay)clearInterval(replay);if(liveTimer)clearTimeout(liveTimer);if(connection.port)connection.disconnect().catch(()=>{});});
 buttons();
}
