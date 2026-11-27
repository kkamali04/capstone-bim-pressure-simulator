import {setupSerialCapture} from './serial-ui.js';
import {VERSION,parseRecording,prepareChannel,analyzeChannel,buildEvidence,chartSVG,exportBoundaryCSV,reportHTML,escapeHTML} from './recording-analysis.js';
const $=id=>document.getElementById(id);
let parsed=null,channel=null,result=null,evidence=null,inputText='',filename='',fingerprint=null,captureContext=null,loadGeneration=0,timer=null;
const exports=['exportReport','printReport','exportJSON','exportCSV'];
function status(id,text,error=false){$(id).textContent=text;$(id).classList.toggle('error',error);}
function pause(){if(timer)clearInterval(timer);timer=null;$('play').textContent='Play';}
function invalidate(message='Settings changed. Analyze again to update results and exports.'){
  pause();result=null;evidence=null;exports.forEach(id=>$(id).disabled=true);
  $('play').disabled=$('timeline').disabled=true;
  $('metrics').replaceChildren();$('chart').innerHTML='<div class="empty"><strong>Ready for analysis.</strong><p>'+escapeHTML(message)+'</p></div>';
  $('quality').replaceChildren();$('episodes').replaceChildren();$('currentPressure').textContent='Current sample: —';
  status('analysisStatus',message);
}
async function sha256(text){
  if(!crypto.subtle)return null;
  const bytes=await crypto.subtle.digest('SHA-256',typeof text==='string'?new TextEncoder().encode(text):text);
  return [...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('');
}
function selected(){return parsed.channels.find(c=>c.id===$('channel').value);}
function configureChannel(){
  const c=selected();
  $('positive').value=c.positive??'CHAMBER';
  $('negative').value=c.negative??'REFERENCE';
  const first=c.samples[0].t,last=c.samples.at(-1).t;
  $('baselineStart').value=first;
  $('baselineEnd').value=Math.min(last,first+Math.min(10,(last-first)/4));
  $('bimStart').value=first;$('bimEnd').value=Math.min(last,first+60);
  $('failure').value='';$('restore').value='';$('sign').value='1';
}
async function install(text,name,synthetic=false,originalHash=null,captureBundle=null){
  const generation=++loadGeneration;
  inputText=text;filename=name;fingerprint=originalHash;captureContext=captureBundle;
  invalidate('Importing recording…');parsed=null;$('analysisFields').disabled=true;$('channel').replaceChildren();
  $('provenance').textContent='NO ANALYSIS';$('provenance').className='badge';
  $('boundaryLabel').textContent='No recording analyzed.';
  try{
    const next=parseRecording(text,{unit:$('inputUnit').value});
    const hash=originalHash??await sha256(text);
    if(generation!==loadGeneration)return;
    parsed=next;inputText=text;filename=name;fingerprint=hash;
    $('source').value=(synthetic||parsed.declaredSynthetic)?'SYNTHETIC':'IMPORTED_UNVERIFIED';
    $('source').disabled=synthetic||parsed.declaredSynthetic;
    $('runId').value=captureBundle?.run_id??(synthetic?'SYNTHETIC_'+name.replace(/[^a-z0-9_-]/gi,'_').replace(/_csv$/,''):name.replace(/\.[^.]+$/,'').slice(0,120));
    for(const c of parsed.channels){
      const option=new Option(c.label+' · '+c.validCount+' valid / '+c.samples.length+' rows',c.id);
      $('channel').add(option);
    }
    const firstValid=parsed.channels.find(c=>c.validCount>=2);
    if(firstValid)$('channel').value=firstValid.id;
    configureChannel();
    if(captureBundle){
      for(const [kind,id] of [['failure','failure'],['restore','restore']]){
        const marked=captureBundle.events.filter(e=>e.kind===kind);
        if(marked.length===1)$(id).value=marked[0].elapsed_s;
      }
    }
    $('analysisFields').disabled=false;
    status('importStatus',name+' · '+parsed.format+' · '+parsed.inputUnit+' → Pa · '+parsed.channels.length+' channel(s). Original values are retained in the input file.');
    invalidate('Recording loaded. Review the mapping, baseline and event settings, then analyze.');
    if(synthetic){
      $('baselineEnd').value=20;$('failure').value=30;$('restore').value=100;$('threshold').value=2.5;
      $('recoveryBand').value=.5;$('recoveryHold').value=5;$('maxGap').value='';
      $('reviewer').value='';$('context').value='Synthetic chamber-to-reference software check; not WBHT facility data.';
      $('initialRisk').value='';$('residualRisk').value='';$('reviewNotes').value='';
      runAnalysis();
    }
  }catch(error){
    if(generation===loadGeneration){status('importStatus',error.message,true);status('analysisStatus','Import failed. No analysis or export is available.',true);}
  }
}
$('recordingFile').onchange=async event=>{
  const file=event.target.files[0];if(!file)return;
  $('example').value='';
  if(file.size>5_000_000){
    ++loadGeneration;parsed=null;$('analysisFields').disabled=true;invalidate('File exceeds the 5 MB limit.');
    status('importStatus','Use a recording under 5 MB.',true);event.target.value='';return;
  }
  const generation=++loadGeneration;invalidate('Reading input file…');$('analysisFields').disabled=true;
  const bytes=await file.arrayBuffer();
  const text=new TextDecoder().decode(bytes);
  const hash=await sha256(bytes);
  if(generation!==loadGeneration)return;
  await install(text,file.name,false,hash);event.target.value='';
};
$('inputUnit').onchange=()=>{
  if(inputText)install(inputText,filename,false,fingerprint,captureContext);
};
$('example').onchange=async event=>{
  const name=event.target.value;if(!name)return;
  const generation=++loadGeneration;
  try{
    const response=await fetch('./recording-examples/'+name+'_SYNTHETIC.csv');
    if(!response.ok)throw Error('Synthetic recording could not be loaded.');
    const text=await response.text();
    if(generation!==loadGeneration)return;
    $('inputUnit').value='';
    await install(text,name+'_SYNTHETIC.csv',true);
  }catch(error){if(generation===loadGeneration){invalidate('Example failed to load.');status('importStatus',error.message,true);}}
};
$('channel').onchange=()=>{configureChannel();invalidate();};
$('analysisForm').addEventListener('input',event=>{if(event.target.id!=='channel')invalidate();});
$('analysisForm').addEventListener('change',event=>{if(event.target.id!=='channel')invalidate();});
const number=id=>Number($(id).value);
const optional=id=>$(id).value.trim()===''?null:number(id);
function runAnalysis(){
  if(!parsed)return;
  pause();
  try{
    if(!$('analysisForm').reportValidity())return;
    channel=prepareChannel(selected(),{sign:number('sign')});
    const settings={baselineStartS:number('baselineStart'),baselineEndS:number('baselineEnd'),failureS:optional('failure'),restoreS:optional('restore'),
      thresholdPa:number('threshold'),recoveryTolerancePa:number('recoveryBand'),recoveryHoldS:number('recoveryHold'),maxGapS:optional('maxGap')};
    const next=analyzeChannel(channel,settings);
    const nextEvidence=buildEvidence({parsed,channel,result:next,filename,sha256:fingerprint,source:$('source').value,runId:$('runId').value.trim(),
      positive:$('positive').value.trim(),negative:$('negative').value.trim(),sign:number('sign'),
      bimWindow:{start_s:number('bimStart'),end_s:number('bimEnd')},
      review:{reviewer:$('reviewer').value.trim(),context:$('context').value.trim(),initialRisk:$('initialRisk').value,residualRisk:$('residualRisk').value,notes:$('reviewNotes').value.trim()}});
    if(captureContext){
      const {raw_serial_text,normalized_csv,...metadata}=captureContext;
      nextEvidence.capture_session=metadata;
    }
    result=next;evidence=nextEvidence;
    renderResults();
    exports.forEach(id=>$(id).disabled=false);
    $('play').disabled=$('timeline').disabled=false;
    $('timeline').min=result.recording.start_s;$('timeline').max=result.recording.end_s;$('timeline').value=result.recording.start_s;
    renderPlayback();
    status('analysisStatus','Analysis ready · '+VERSION+'. Duration metrics exclude gaps. Source: '+evidence.source+'.');
  }catch(error){invalidate('Analysis needs attention.');status('analysisStatus',error.message,true);}
}
$('analysisForm').onsubmit=event=>{event.preventDefault();runAnalysis();};
const fmt=(value,unit='',decimals=3)=>Number.isFinite(value)?value.toFixed(decimals)+unit:'—';
function metric(label,value,note){
  return '<article class="metric"><span>'+escapeHTML(label)+'</span><strong>'+escapeHTML(value)+'</strong><small>'+escapeHTML(note)+'</small></article>';
}
function renderResults(){
  $('boundaryLabel').textContent=evidence.input.positive_space_id+' minus '+evidence.input.negative_space_id+' · '+filename;
  $('provenance').textContent=evidence.source;$('provenance').className='badge'+(evidence.source==='SYNTHETIC'?' synthetic':'');
  const recovery=result.recovery.status==='observed'?fmt(result.recovery.elapsed_from_restore_s,' s',2):result.recovery.status==='not_requested'?'Not marked':'Not observed';
  $('metrics').innerHTML=metric('Baseline mean',fmt(result.baseline.mean_pa,' Pa'),'Sample SD '+fmt(result.baseline.sd_pa,' Pa'))
    +metric('Sampled peak',fmt(result.pressure.peak_pa,' Pa'),'At '+fmt(result.pressure.peak_time_s,' s',1))
    +metric('Above analysis threshold',fmt(result.threshold.observed_duration_s,' s',2),'Threshold '+fmt(result.threshold.value_pa,' Pa'))
    +metric('Maximum departure',fmt(result.pressure.maximum_change_from_baseline_pa,' Pa'),'From selected baseline mean')
    +metric('Recovery after restoration',recovery,result.recovery.status==='observed'?'Confirmed after '+result.settings.recoveryHoldS+' s hold':'Requires an uninterrupted in-band hold')
    +metric('Valid / invalid samples',result.recording.valid_samples+' / '+result.recording.invalid_samples,fmt(result.recording.duration_s,' s',1)+' full recording');
  const q=result.recording;
  $('quality').innerHTML='<table><tbody><tr><th>Observed duration</th><td>'+fmt(q.supported_duration_s,' s')+'</td></tr><tr><th>Unobserved duration</th><td>'+fmt(q.unobserved_duration_s,' s')+'</td></tr><tr><th>Median sample interval</th><td>'+fmt(q.nominal_interval_s,' s')+'</td></tr><tr><th>Maximum connected gap</th><td>'+fmt(result.settings.maxGapS,' s')+'</td></tr><tr><th>Longest above-threshold episode</th><td>'+fmt(result.threshold.longest_episode_s,' s')+'</td></tr></tbody></table><ul class="warning">'+[...parsed.warnings,...result.warnings].map(s=>'<li>'+escapeHTML(s)+'</li>').join('')+'</ul>';
  $('episodes').innerHTML=result.threshold.episodes.length?'<details><summary>Above-threshold intervals ('+result.threshold.episodes.length+')</summary><table><thead><tr><th>Start (s)</th><th>End (s)</th><th>Observed duration (s)</th></tr></thead><tbody>'+result.threshold.episodes.map(e=>'<tr><td>'+fmt(e.start_s)+'</td><td>'+fmt(e.end_s)+'</td><td>'+fmt(e.duration_s)+'</td></tr>').join('')+'</tbody></table></details>':'<p class="help">No above-threshold interval was established between connected samples. Gaps and sampling still limit interpretation.</p>';
  $('method').textContent=result.method;
}
function renderPlayback(){
  if(!result)return;
  const time=number('timeline');$('currentTime').textContent=time.toFixed(1)+' s';
  $('chart').innerHTML=chartSVG(channel,result,time);
  const nearest=channel.samples.reduce((best,s)=>Math.abs(s.t-time)<Math.abs(best.t-time)?s:best,channel.samples[0]);
  const close=Math.abs(nearest.t-time)<=result.settings.maxGapS/2;
  $('currentPressure').textContent='Current sample: '+(close&&nearest.valid?fmt(nearest.value,' Pa')+' at '+fmt(nearest.t,' s',1):'No valid sample near this time');
}
$('timeline').oninput=()=>{pause();renderPlayback();};
$('play').onclick=()=>{
  if(timer){pause();return;}
  if(number('timeline')>=result.recording.end_s)$('timeline').value=result.recording.start_s;
  $('play').textContent='Pause';
  let last=performance.now();
  timer=setInterval(()=>{
    const now=performance.now(),next=Math.min(result.recording.end_s,number('timeline')+(now-last)/1000*number('speed'));last=now;
    $('timeline').value=next;renderPlayback();
    if(next>=result.recording.end_s)pause();
  },150);
};
function download(name,text,type){
  const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');
  a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
const safeName=()=>evidence.run_id.replace(/[^a-z0-9_.-]/gi,'_')||'Sure2_Run';
$('exportJSON').onclick=()=>download(safeName()+'_evidence.json',JSON.stringify(evidence,null,2),'application/json');
$('exportCSV').onclick=()=>download(safeName()+'_BIM.csv',exportBoundaryCSV(channel,{positive:evidence.input.positive_space_id,negative:evidence.input.negative_space_id,startS:evidence.bim_export.start_s,endS:evidence.bim_export.end_s,rebase:true}),'text/csv');
$('exportReport').onclick=()=>download(safeName()+'_report.html',reportHTML(evidence),'text/html');
$('printReport').onclick=()=>{
  const popup=window.open('','_blank');
  if(!popup){status('analysisStatus','Allow this report window, or download the readable report and print it.',true);return;}
  popup.opener=null;popup.document.open();popup.document.write(reportHTML(evidence));popup.document.close();
  setTimeout(()=>popup.print(),200);
};
window.addEventListener('pagehide',pause);


setupSerialCapture({install,download,sha256});
