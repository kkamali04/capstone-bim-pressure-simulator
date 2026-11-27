import {checkConfig,solveNetwork,q} from './bim-engine.js';
import {predictBoundary,REFERENCE} from './channels.js';
import {escapeHTML} from './recording-analysis.js';

export const HVAC_TEST_VERSION='hvac-tests-1.0.0';
export const TEST_PATTERNS={
  exhaustSupplyLag:'Exhaust loss with delayed supply shutdown',
  simultaneous:'Supply and exhaust loss together',
  twoExhaust:'Exhaust loss in two rooms',
  sustainedExhaust:'Sustained exhaust loss'
};
export function networkSignature(config){
  return JSON.stringify({nodes:config.nodes.map(({id,volume,supply,exhaust,leak})=>({id,volume,supply,exhaust,leak})),
    links:config.links.map(({a,b,k,enabled,door_id})=>({a,b,k,enabled,door_id}))});
}
export function captureBaseline(config,{designIntent,reviewer='',bands={}}={}){
  checkConfig(config);
  if(typeof designIntent!=='string'||!designIntent.trim()||designIntent.length>3000)throw Error('Describe the normal design intent before capturing a baseline.');
  const ids=new Set(config.nodes.map(n=>n.id));
  for(const [id,band] of Object.entries(bands)){
    if(!ids.has(id)||!Number.isFinite(band.min)||!Number.isFinite(band.max)||band.min>band.max)throw Error('Baseline bands need an existing room and finite ordered bounds.');
  }
  const pressure=solveNetwork(config);
  return {schema:'sure2-reviewed-baseline-1',source:'SYNTHETIC',captured_utc:new Date().toISOString(),
    design_intent:designIntent.trim(),reviewer:String(reviewer).slice(0,200),network_signature:networkSignature(config),
    config:structuredClone(config),pressure_pa:[...pressure],bands:structuredClone(bands),
    rooms:config.nodes.map((n,i)=>({id:n.id,name:n.name,pressure_pa:pressure[i],
      entered_band:bands[n.id]??null,band_result:!bands[n.id]?'not_specified':pressure[i]>=bands[n.id].min&&pressure[i]<=bands[n.id].max?'within_entered_band':'outside_entered_band'})),
    note:'This is a reviewed modeled baseline. Entered bands are design-review inputs, not verified acceptance criteria or sensor calibration.'};
}
export const baselineMatches=(baseline,config)=>Boolean(baseline&&baseline.network_signature===networkSignature(config));
export function makeTestPlan(config,{pattern='exhaustSupplyLag',target=0,secondTarget=1,start=10,restore=45,severity=.7,delay=3,restoreDelay=5,duration=180,tau=4}={}){
  checkConfig(config);
  if(!Object.hasOwn(TEST_PATTERNS,pattern))throw Error('Choose a supported HVAC test pattern.');
  if(!Number.isInteger(target)||!config.nodes[target])throw Error('Select the primary pressure zone.');
  for(const [key,value]of Object.entries({start,severity,delay,restoreDelay,duration,tau}))if(!Number.isFinite(value))throw Error('Invalid '+key+'.');
  if(start<0||duration<=0||duration>600||start>=duration||severity<0||severity>1||delay<0||restoreDelay<0||tau<0||tau>60)throw Error('Use an event inside a 0–600 s run, 0–100% loss, nonnegative delays and a 0–60 s ramp.');
  const end=pattern==='sustainedExhaust'?null:restore;
  if(end!==null&&(!Number.isFinite(end)||end<=start||end>duration))throw Error('Restoration must follow failure and fall inside the run.');
  const node=config.nodes[target].id;
  const events=[{id:'primary-exhaust',node,role:'exhaust',loss:severity,start,restore:end}];
  if(pattern==='twoExhaust'){
    if(!Number.isInteger(secondTarget)||!config.nodes[secondTarget]||secondTarget===target)throw Error('The second exhaust action needs a different room.');
    events.push({id:'secondary-exhaust',node:config.nodes[secondTarget].id,role:'exhaust',loss:severity,start,restore:end});
  }else if(pattern!=='sustainedExhaust'){
    const lag=pattern==='exhaustSupplyLag'?delay:0;
    const restorationLag=pattern==='exhaustSupplyLag'?restoreDelay:0;
    if(start+lag>=duration||end+restorationLag>duration)throw Error('Delayed supply events must fit inside the run; increase the duration or reduce delays.');
    events.push({id:'secondary-supply',node,role:'supply',loss:severity,start:start+lag,restore:end+restorationLag});
  }
  return {schema:'sure2-hvac-test-plan-1',source:'SYNTHETIC',pattern,title:TEST_PATTERNS[pattern],duration,tau,step:.5,events,
    basis:'Actions scale aggregate room supply/exhaust. They are illustrative command schedules, not identified individual fan curves or a recreation of a WBHT facility.'};
}
export function eventFraction(time,event,tau){
  if(time<event.start)return 0;
  if(tau===0)return event.restore===null||time<event.restore?1:0;
  if(event.restore===null||time<event.restore)return 1-Math.exp(-(time-event.start)/tau);
  return (1-Math.exp(-(event.restore-event.start)/tau))*Math.exp(-(time-event.restore)/tau);
}
export function runScheduledNetwork(config,plan){
  checkConfig(config);
  if(plan?.schema!=='sure2-hvac-test-plan-1'||!Number.isFinite(plan.duration)||plan.duration<=0||plan.duration>600||
     !Number.isFinite(plan.tau)||plan.tau<0||plan.tau>60||plan.step!==.5||!Array.isArray(plan.events)||!plan.events.length||plan.events.length>8)throw Error('Invalid HVAC test plan.');
  const ids=new Map(config.nodes.map((n,i)=>[n.id,i])),seen=new Set();
  for(const e of plan.events){
    const key=e.node+':'+e.role;
    if(!ids.has(e.node)||!['supply','exhaust'].includes(e.role)||!Number.isFinite(e.loss)||e.loss<0||e.loss>1||
       !Number.isFinite(e.start)||e.start<0||e.start>=plan.duration||(e.restore!==null&&(!Number.isFinite(e.restore)||e.restore<=e.start||e.restore>plan.duration))||seen.has(key))throw Error('Invalid or duplicate aggregate supply/exhaust action.');
    seen.add(key);
  }
  const count=Math.ceil(plan.duration/plan.step),frames=[];
  for(let k=0;k<=count;k++){
    const t=Math.min(plan.duration,k*plan.step),s=config.nodes.map(n=>n.supply),e=config.nodes.map(n=>n.exhaust);
    const commands=plan.events.map(event=>{
      const fraction=eventFraction(t,event,plan.tau),array=event.role==='supply'?s:e;
      array[ids.get(event.node)]*=1-event.loss*fraction;
      return {id:event.id,node:event.node,role:event.role,loss_fraction:event.loss*fraction};
    });
    const p=solveNetwork(config,s,e);
    const flows=config.links.map(l=>l.enabled?q(p[ids.get(l.a)]-p[ids.get(l.b)],l.k):0);
    const referenceFlows=config.nodes.map((n,i)=>q(p[i],n.leak));
    const residual=Math.max(...config.nodes.map((n,i)=>Math.abs(s[i]-e[i]-referenceFlows[i]-config.links.reduce((sum,l,j)=>sum+(!l.enabled?0:l.a===n.id?flows[j]:l.b===n.id?-flows[j]:0),0))));
    frames.push({t,p,sensor:[...p],flows,referenceFlows,supply:s,exhaust:e,residual,commands});
  }
  return frames;
}
function observedAbove(points,threshold){
  let total=0;
  for(let i=0;i<points.length-1;i++){
    const a=points[i],b=points[i+1],dt=b.t-a.t;
    if(a.value>threshold&&b.value>threshold)total+=dt;
    else if(a.value<=threshold&&b.value>threshold)total+=dt*(b.value-threshold)/(b.value-a.value);
    else if(a.value>threshold&&b.value<=threshold)total+=dt*(a.value-threshold)/(a.value-b.value);
  }
  return total;
}
export function reviewBoundary(frames,config,positive,negative=REFERENCE,threshold=2.5,baseline=null){
  if(!frames?.length||!Number.isFinite(threshold)||threshold<0)throw Error('Run a scenario and choose a nonnegative boundary threshold.');
  for(let i=0;i<frames.length;i++)if(!Number.isFinite(frames[i].t)||frames[i].t<0||i&&frames[i].t<=frames[i-1].t)throw Error('Boundary review needs increasing finite frame times.');
  if(baseline&&!baselineMatches(baseline,config))throw Error('Baseline inputs changed; capture a new baseline.');
  const points=frames.map(frame=>({t:frame.t,value:predictBoundary(frame,config,positive,negative)}));
  const normal=baseline?baseline.pressure_pa:solveNetwork(config);
  const baselinePa=predictBoundary({p:normal},config,positive,negative);
  const peak=points.reduce((a,b)=>b.value>a.value?b:a);
  const connection=negative===REFERENCE?'aggregate_reference_leak':config.links.some(l=>l.enabled&&(l.a===positive&&l.b===negative||l.b===positive&&l.a===negative))?'modeled_internal_link':'pressure_comparison_only';
  return {source:'SYNTHETIC',positive,negative,threshold_pa:threshold,baseline_pa:baselinePa,
    peak_pa:peak.value,peak_time_s:peak.t,minimum_pa:Math.min(...points.map(p=>p.value)),
    maximum_change_pa:Math.max(...points.map(p=>Math.abs(p.value-baselinePa))),
    above_threshold_s:observedAbove(points,threshold),above_zero_s:observedAbove(points,0),duration_s:frames.at(-1).t-frames[0].t,
    connection,points,method:'Duration uses linear crossing estimates between modeled samples. Peak is a sampled maximum. This is a boundary pressure comparison, not a measured airflow rate or automated risk rating.'};
}
export function boundaryCSV(review){
  const cell=v=>/[",\r\n]/.test(String(v))?'"'+String(v).replaceAll('"','""')+'"':String(v);
  return ['time_s,positive_space_id,negative_space_id,pressure_pa',...review.points.map(p=>[p.t,review.positive,review.negative,p.value].map(cell).join(','))].join('\n')+'\n';
}
export function scenarioReportHTML({baseline,plan,review,modelName,run,comparison}){
  const row=(a,b)=>'<tr><th>'+escapeHTML(a)+'</th><td>'+escapeHTML(b)+'</td></tr>';
  const f=n=>Number(n).toFixed(3),points=review.points,W=900,H=210,L=55,R=15,T=18,B=32;
  const low=Math.min(0,...points.map(p=>p.value))-1,high=Math.max(review.threshold_pa,...points.map(p=>p.value))+1,end=points.at(-1).t;
  const x=t=>L+t/(end||1)*(W-L-R),y=p=>T+(high-p)/(high-low)*(H-T-B);
  let svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+W+' '+H+'"><rect width="100%" height="100%" fill="white"/>';
  for(let i=0;i<=4;i++){const t=end*i/4,p=low+(high-low)*i/4;svg+='<path d="M'+L+' '+y(p)+'H'+(W-R)+'" stroke="#dbe4df"/><text x="'+(L-5)+'" y="'+(y(p)+4)+'" text-anchor="end" font-size="12">'+p.toFixed(1)+'</text><text x="'+x(t)+'" y="'+(H-6)+'" text-anchor="middle" font-size="12">'+t.toFixed(1)+'s</text>';}
  svg+='<path d="'+points.map((p,i)=>(i?'L':'M')+x(p.t)+' '+y(p.value)).join(' ')+'" fill="none" stroke="#087a83" stroke-width="2"/><path d="M'+L+' '+y(review.threshold_pa)+'H'+(W-R)+'" stroke="#b34e2f" stroke-dasharray="5 4"/></svg>';
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Sure2 simulated HVAC test</title><style>body{font:15px/1.5 system-ui;max-width:1000px;margin:30px auto;padding:0 22px;color:#183744}h1{font-size:27px}h2{font-size:19px}table{width:100%;border-collapse:collapse;margin:15px 0}th,td{border:1px solid #cddbdc;padding:8px;text-align:left;overflow-wrap:anywhere}th{background:#eef5f4}svg{width:100%}.source{font-weight:700;color:#a35621}@media print{tr,svg{break-inside:avoid}}</style></head><body><h1>Sure² / Simulated HVAC Test Summary</h1><p class="source">SYNTHETIC MODEL OUTPUT — physical validation pending</p><p>Model: '+escapeHTML(modelName)+'. Generated '+escapeHTML(new Date().toISOString())+'.</p>'
    +'<h2>Baseline operation / design intent</h2><p>'+escapeHTML(baseline?.design_intent??'No reviewed baseline captured for this legacy scenario.')+'</p><p>Reviewer: '+escapeHTML(baseline?.reviewer||'Not supplied')+'. Modeled values and entered design bands are not acceptance certification.</p>'
    +'<h2>Test and selected boundary</h2><table>'+row('Scenario',plan?.title??run.scenario)+row('Boundary',review.positive+' minus '+review.negative)+row('Normal modeled boundary ΔP',f(review.baseline_pa)+' Pa')+row('Sampled peak',f(review.peak_pa)+' Pa at '+f(review.peak_time_s)+' s')+row('Maximum departure',f(review.maximum_change_pa)+' Pa')+row('Analysis threshold',f(review.threshold_pa)+' Pa')+row('Modeled time above threshold',f(review.above_threshold_s)+' s')+row('Time above zero',f(review.above_zero_s)+' s')+row('Connection basis',review.connection)+row('Run duration',f(review.duration_s)+' s')+row('Input response constant',plan?plan.tau+' s (assumed command ramp)':(run.tau??4)+' s (assumed command ramp)')+'</table>'+svg
    +'<h2>Failure / restoration schedule</h2>'+(plan?'<p>'+escapeHTML(plan.basis)+'</p><table><tr><th>Action</th><th>Room ID</th><th>Flow loss</th><th>Start</th><th>Restore</th></tr>'+plan.events.map(e=>'<tr><td>'+escapeHTML(e.role)+'</td><td>'+escapeHTML(e.node)+'</td><td>'+f(e.loss*100)+'%</td><td>'+e.start+' s</td><td>'+(e.restore===null?'Not within run':e.restore+' s')+'</td></tr>').join('')+'</table>':'<p>'+escapeHTML(JSON.stringify(run))+'</p>')
    +'<h2>Recording comparison</h2><p>'+(comparison?.count?comparison.count+' matched, '+comparison.unmatched.length+' unmatched; MAE '+f(comparison.mae??0)+' Pa, RMSE '+f(comparison.rmse??0)+' Pa. Imported provenance still requires review.':'No aligned recording comparison is included; unmatched observations, if any, are recorded in the JSON evidence.')+'</p>'
    +'<h2>Interpretation and limits</h2><p>'+escapeHTML(review.method)+'</p><p>The solver evaluates a room-level equilibrium network at each time. Equipment response is prescribed, not fitted to WBHT data. Each room has one pressure; voxels do not resolve vent-scale airflow. No automatic biological-risk reduction or certification decision is computed. Refer to the exported JSON for inputs, assumptions and baseline snapshot.</p></body></html>';
}

