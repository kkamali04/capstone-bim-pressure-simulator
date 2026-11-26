// Sure2 recorded-test analysis. Pure functions shared by the UI and tests.
// These calculate pressure observations; they do not certify containment.
export const VERSION = 'recorded-tests-1.0.0';
export const UNIT_FACTORS = Object.freeze({Pa:1, kPa:1000, inH2O:249.0889});
export const SOURCES = ['MEASURED','SYNTHETIC','IMPORTED_UNVERIFIED'];
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite = value => value !== '' && Number.isFinite(Number(value));
const median = values => {
  const sorted = [...values].sort((a,b)=>a-b), n=sorted.length;
  return n ? (sorted[Math.floor((n-1)/2)]+sorted[Math.floor(n/2)])/2 : null;
};

// Bounded RFC-style CSV parser, including quoted commas/newlines and BOM.
export function csvRows(text) {
  if (typeof text !== 'string' || text.length > 5_000_000) throw Error('Use a text recording under 5 MB.');
  text = text.replace(/^\uFEFF/,'');
  const rows=[]; let row=[], field='', quoted=false, closed=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){
      if(c==='"' && text[i+1]==='"'){field+='"';i++;}
      else if(c==='"'){quoted=false;closed=true;}
      else field+=c;
    } else if(c==='"'){
      if(field.trim() || closed) throw Error('Unexpected quote in CSV.');
      field='';quoted=true;
    } else if(c===',' || c==='\r' || c==='\n'){
      row.push(field.trim());field='';closed=false;
      if(c!==','){
        if(c==='\r' && text[i+1]==='\n')i++;
        if(row.some(v=>v!==''))rows.push(row);
        row=[];
        if(rows.length>100_000)throw Error('Recording exceeds 100,000 rows.');
      }
    } else {
      if(closed && c.trim())throw Error('Unexpected text after quoted CSV field.');
      if(!closed)field+=c;
    }
  }
  if(quoted)throw Error('Unclosed quoted CSV field.');
  row.push(field.trim());
  if(row.some(v=>v!==''))rows.push(row);
  return rows;
}

export function parseRecording(text, {unit=''}={}) {
  const rows=csvRows(text), notes=[], channels=new Map();
  const headerAt=rows.findIndex(row=>row.includes('time_ms') || row.includes('time_s'));
  if(headerAt<0)throw Error('No supported CSV header found. Send c in the Arduino sketch, then save the CSV output.');
  const header=rows[headerAt];
  if(new Set(header).size!==header.length)throw Error('CSV has duplicate column names.');
  const arduino=header.includes('dp_a_pa');
  const timeKey=header.includes('time_ms')?'time_ms':'time_s', timeFactor=timeKey==='time_ms'?.001:1;
  const declaredPa=arduino || header.includes('pressure_pa');
  const pressureKey=arduino?null:declaredPa?'pressure_pa':'pressure';
  if(!arduino && !header.includes(pressureKey))throw Error('Use pressure_pa or pressure, with time_s or time_ms.');
  if(unit && !Object.hasOwn(UNIT_FACTORS,unit))throw Error('Choose Pa, kPa or inH2O.');
  if(declaredPa && unit && unit!=='Pa')throw Error('The CSV header declares pascals. Resolve the source unit discrepancy before importing; do not silently override it.');
  if(!declaredPa && !unit)throw Error('This CSV does not declare pressure units. Select its verified input unit first.');
  const inputUnit=declaredPa?'Pa':unit, factor=UNIT_FACTORS[inputUnit];
  const get=(row,key)=>row[header.indexOf(key)] ?? '';
  const startup=rows.slice(0,headerAt).map(row=>row.join(','));
  const declaredSynthetic=startup.some(line=>line.startsWith('# SYNTHETIC SOFTWARE TEST ONLY'));
  let skipped=0,repeatedHeaders=0;
  function append(id,label,t,value,reason,rawValue,environment={}) {
    if(!channels.has(id))channels.set(id,{id,label,samples:[]});
    const list=channels.get(id).samples;
    if(list.length && t<=list.at(-1).deviceTimeS)throw Error('Duplicate or backward timestamps in '+label+'. A device reset needs a separate recording.');
    list.push({deviceTimeS:t,value,valid:reason===null,reason,rawValue,environment});
  }
  for(let i=headerAt+1;i<rows.length;i++){
    const row=rows[i];
    if(row.length===header.length && row.every((v,j)=>v===header[j])){repeatedHeaders++;continue;}
    if(row[0].startsWith('#')){notes.push(row.join(','));continue;}
    if(row.length!==header.length)throw Error('CSV row '+(i+1)+' has '+row.length+' columns; expected '+header.length+'. Keep truncated rows out of analysis and retain the original capture.');
    const time=get(row,timeKey);
    if(!finite(time) || Number(time)<0)throw Error('Invalid acquisition time at CSV row '+(i+1)+'.');
    const t=Number(time)*timeFactor;
    if(arduino){
      const environment={};
      if(get(row,'sht_ok')==='1'){
        for(const key of ['sht_temp_c','sht_rh_pct'])if(finite(get(row,key)))environment[key]=Number(get(row,key));
      }
      for(const name of ['a','b']){
        const column='dp_'+name+'_pa', flag='dp_'+name+'_ok';
        if(!header.includes(column))continue;
        if(!header.includes(flag))throw Error('Arduino pressure columns require their corresponding validity flags.');
        const raw=get(row,column), status=get(row,flag);
        if(!['0','1'].includes(status))throw Error('Invalid '+flag+' at CSV row '+(i+1)+'.');
        const reason=status==='0'?'device_flag_invalid':!finite(raw)?'missing_or_nonfinite_pressure':null;
        append('DP-'+name.toUpperCase(),'Pressure '+name.toUpperCase(),t,reason?null:Number(raw),reason,raw,environment);
      }
    } else {
      const raw=get(row,pressureKey), ok=header.includes('valid')?get(row,'valid'):'1';
      if(!['0','1'].includes(ok))throw Error('The optional valid column must contain 0 or 1.');
      const explicitBoundary=header.includes('positive_space_id') || header.includes('negative_space_id');
      if(explicitBoundary && (!header.includes('positive_space_id')||!header.includes('negative_space_id')||!get(row,'positive_space_id')||!get(row,'negative_space_id')))throw Error('Explicit boundary rows need both nonempty pressure endpoints.');
      if(header.includes('space_id') && !get(row,'space_id'))throw Error('Room pressure rows need a nonempty space_id.');
      const positive=explicitBoundary?get(row,'positive_space_id'):header.includes('space_id')?get(row,'space_id'):'CHAMBER';
      const negative=explicitBoundary?get(row,'negative_space_id'):'REFERENCE';
      if(positive===negative)throw Error('Pressure endpoints must differ.');
      const id=JSON.stringify([positive,negative]);
      const reason=ok==='0'?'device_flag_invalid':!finite(raw)?'missing_or_nonfinite_pressure':null;
      append(id,positive+' / '+negative,t,reason?null:Number(raw)*factor,reason,raw);
      channels.get(id).positive=positive;channels.get(id).negative=negative;
    }
  }
  if(!channels.size)throw Error('No data rows found.');
  const all=[...channels.values()].flatMap(c=>c.samples);
  const originS=all.reduce((v,s)=>Math.min(v,s.deviceTimeS),Infinity);
  for(const channel of channels.values()){
    channel.samples=channel.samples.map(sample=>({...sample,t:sample.deviceTimeS-originS}));
    channel.validCount=channel.samples.filter(s=>s.valid).length;
  }
  return {declaredSynthetic,format:arduino?'sure2-arduino':'pressure-csv',inputUnit,unitFactor:factor,originDeviceTimeS:originS,
    header,startupNotes:[...startup,...notes],channels:[...channels.values()],skipped,repeatedHeaders,
    warnings:repeatedHeaders?['Repeated CSV headers were ignored; timestamps were still checked.']:[]};
}

export function prepareChannel(channel, {sign=1}={}) {
  if(![1,-1].includes(sign))throw Error('Pressure sign must be +1 or -1.');
  return {...channel,samples:channel.samples.map(s=>({...s,value:s.valid?s.value*sign:null}))};
}

export function acquisitionSegments(channel,maxGapS) {
  const segments=[]; let group=[];
  for(const sample of channel.samples){
    if(!sample.valid){if(group.length)segments.push(group);group=[];continue;}
    if(group.length && sample.t-group.at(-1).t>maxGapS){segments.push(group);group=[];}
    group.push(sample);
  }
  if(group.length)segments.push(group);
  return segments;
}

function aboveIntervals(segments,threshold) {
  const intervals=[];
  for(const segment of segments){
    let active=null;
    for(let i=0;i<segment.length-1;i++){
      const a=segment[i],b=segment[i+1],dt=b.t-a.t;
      let left=null,right=null;
      if(a.value>threshold && b.value>threshold){left=a.t;right=b.t;}
      else if(a.value<=threshold && b.value>threshold){left=a.t+dt*(threshold-a.value)/(b.value-a.value);right=b.t;}
      else if(a.value>threshold && b.value<=threshold){left=a.t;right=a.t+dt*(threshold-a.value)/(b.value-a.value);}
      if(left!==null && right>left){
        if(active && Math.abs(active.end_s-left)<1e-8)active.end_s=right;
        else {active={start_s:left,end_s:right};intervals.push(active);}
      } else active=null;
    }
  }
  return intervals.map(x=>({...x,duration_s:x.end_s-x.start_s}));
}

function bandIntervals(segments,low,high,after) {
  const intervals=[];
  for(const segment of segments){
    let active=null;
    for(let i=0;i<segment.length-1;i++){
      const a=segment[i],b=segment[i+1],delta=b.value-a.value;
      let u=0,v=1;
      if(delta===0){if(a.value<low || a.value>high)continue;}
      else {const p=(low-a.value)/delta,q=(high-a.value)/delta;u=Math.max(0,Math.min(p,q));v=Math.min(1,Math.max(p,q));}
      const left=Math.max(after,a.t+u*(b.t-a.t)),right=a.t+v*(b.t-a.t);
      if(v>=u && right>left){
        if(active && Math.abs(active.end_s-left)<1e-8)active.end_s=right;
        else {active={start_s:left,end_s:right};intervals.push(active);}
      } else active=null;
    }
  }
  return intervals;
}

export function analyzeChannel(channel, settings={}) {
  const {baselineStartS=0,baselineEndS=10,thresholdPa=2.5,failureS=null,restoreS=null,
    recoveryTolerancePa=.5,recoveryHoldS=5,maxGapS=null}=settings;
  for(const [key,value] of Object.entries({baselineStartS,baselineEndS,thresholdPa,recoveryTolerancePa,recoveryHoldS}))
    if(!Number.isFinite(value))throw Error('Enter a finite '+key+'.');
  const samples=channel.samples, valid=samples.filter(s=>s.valid), first=samples[0]?.t,last=samples.at(-1)?.t;
  if(valid.length<2)throw Error('This channel needs at least two valid pressure samples.');
  if(baselineStartS<first || baselineEndS>last || baselineStartS>=baselineEndS)throw Error('Choose a baseline interval inside the recording with start before end.');
  if(thresholdPa<0 || recoveryTolerancePa<0 || recoveryHoldS<=0)throw Error('Threshold/tolerance must be nonnegative and recovery hold must be positive.');
  for(const t of [failureS,restoreS])if(t!==null && (!Number.isFinite(t)||t<first||t>last))throw Error('Event times must fall inside the recording.');
  if(failureS!==null && failureS<baselineEndS)throw Error('The baseline must end at or before the failure event.');
  if(failureS!==null && restoreS!==null && restoreS<=failureS)throw Error('Restoration must follow the failure event.');
  if(restoreS!==null && restoreS<baselineEndS)throw Error('Restoration must follow the baseline interval.');
  const baseline=valid.filter(s=>s.t>=baselineStartS && s.t<=baselineEndS);
  if(baseline.length<2)throw Error('The baseline interval needs at least two valid samples.');
  const mean=baseline.reduce((n,s)=>n+s.value,0)/baseline.length;
  const sd=Math.sqrt(baseline.reduce((n,s)=>n+(s.value-mean)**2,0)/(baseline.length-1));
  const intervals=samples.slice(1).map((s,i)=>s.t-samples[i].t), nominal=median(intervals);
  const gap=maxGapS===null?nominal*1.5:maxGapS;
  if(!Number.isFinite(gap)||gap<=0)throw Error('Maximum gap must be positive.');
  const segments=acquisitionSegments(channel,gap);
  const connected=segments.flatMap(segment=>segment.slice(1).map((s,i)=>({a:segment[i],b:s})));
  const supported=connected.reduce((n,p)=>n+p.b.t-p.a.t,0);
  const events=aboveIntervals(segments,thresholdPa);
  const zeroEvents=aboveIntervals(segments,0);
  const baselineSupported=connected.reduce((n,p)=>n+Math.max(0,Math.min(baselineEndS,p.b.t)-Math.max(baselineStartS,p.a.t)),0);
  const peak=valid.reduce((a,b)=>b.value>a.value?b:a);
  const minimum=valid.reduce((a,b)=>b.value<a.value?b:a);
  let recovery={status:'not_requested',onset_s:null,confirmed_s:null,elapsed_from_restore_s:null};
  if(restoreS!==null){
    const found=bandIntervals(segments,mean-recoveryTolerancePa,mean+recoveryTolerancePa,restoreS)
      .find(p=>p.end_s-p.start_s>=recoveryHoldS-1e-9);
    recovery=found?{status:'observed',onset_s:found.start_s,confirmed_s:found.start_s+recoveryHoldS,elapsed_from_restore_s:found.start_s-restoreS}
      :{status:'not_observed',onset_s:null,confirmed_s:null,elapsed_from_restore_s:null,
        reason:'No uninterrupted in-band interval of the requested hold was observed before the recording ended. Missing data or insufficient follow-up may also prevent confirmation.'};
  }
  const invalid=samples.filter(s=>!s.valid), reasons={};
  invalid.forEach(s=>reasons[s.reason]=(reasons[s.reason]??0)+1);
  const warnings=[];
  if(invalid.length)warnings.push(invalid.length+' invalid samples excluded; they remain gaps, not zero pressure.');
  if(supported<last-first-1e-8)warnings.push('Gaps break event/recovery continuity. Durations exclude unobserved intervals.');
  if(baselineSupported<baselineEndS-baselineStartS-1e-8)warnings.push('The selected baseline has incomplete time coverage.');
  if(recovery.status==='not_observed')warnings.push(recovery.reason);
  if(failureS===null)warnings.push('No failure marker supplied; threshold metrics cover the entire recording.');
  return {version:VERSION,settings:{baselineStartS,baselineEndS,thresholdPa,failureS,restoreS,recoveryTolerancePa,recoveryHoldS,maxGapS:gap},
    baseline:{mean_pa:mean,sd_pa:sd,count:baseline.length,supported_duration_s:baselineSupported},
    recording:{start_s:first,end_s:last,duration_s:last-first,total_samples:samples.length,valid_samples:valid.length,
      invalid_samples:invalid.length,invalid_reasons:reasons,nominal_interval_s:nominal,supported_duration_s:supported,unobserved_duration_s:last-first-supported},
    pressure:{peak_pa:peak.value,peak_time_s:peak.t,minimum_pa:minimum.value,maximum_change_from_baseline_pa:Math.max(...valid.map(s=>Math.abs(s.value-mean)))},
    threshold:{value_pa:thresholdPa,observed_duration_s:events.reduce((n,e)=>n+e.duration_s,0),
      longest_episode_s:events.length?Math.max(...events.map(e=>e.duration_s)):0,episodes:events},
    positivePressure:{observed_duration_s:zeroEvents.reduce((n,e)=>n+e.duration_s,0)},
    recovery,warnings,
    method:'Baseline is a sample mean and sample SD. Threshold crossings and recovery-band entry are linearly estimated only between adjacent valid samples within the declared maximum gap. Peaks are sampled peaks. Event metrics cover the full recording; missing intervals are excluded. Recovery requires the configured uninterrupted hold after restoration.',
    limitations:['Pressure observations do not by themselves establish airflow rate or containment certification.',
      'A positive differential is not automatically a hazardous reversal; boundary orientation, normal design intent and consequence require review.',
      'Risk ratings are reviewer-entered. No WBHT classification or residual-risk reduction is computed.',
      'Sampling can miss short peaks; no interpolation is performed through invalid samples or long gaps.']};
}

export function exportBoundaryCSV(channel,{positive,negative='REFERENCE',startS=null,endS=null,rebase=false}={}) {
  validateMapping(positive,negative);
  if(startS!==null && (!Number.isFinite(startS)||startS<channel.samples[0].t))throw Error('Invalid export window start.');
  if(endS!==null && (!Number.isFinite(endS)||endS>channel.samples.at(-1).t))throw Error('Invalid export window end.');
  if(startS!==null && endS!==null && startS>=endS)throw Error('Export window must have start before end.');
  const cell=value=>/[",\r\n]/.test(String(value))?'"'+String(value).replaceAll('"','""')+'"':String(value);
  return ['time_s,positive_space_id,negative_space_id,pressure_pa',...channel.samples.filter(s=>s.valid && (startS===null||s.t>=startS) && (endS===null||s.t<=endS))
    .map(s=>[s.t-(rebase?(startS??channel.samples[0].t):0),positive,negative,s.value].map(cell).join(','))].join('\n')+'\n';
}
export function validateMapping(positive,negative) {
  if([positive,negative].some(x=>typeof x!=='string'||!x.trim()||x.length>120||/[\u0000-\u001f]/.test(x)))throw Error('Give both pressure endpoints a short, nonempty ID without control characters.');
  if(positive===negative)throw Error('Positive and negative endpoints must differ.');
}

export function chartSVG(channel,result,playhead=null) {
  const valid=channel.samples.filter(s=>s.valid),{start_s:start,end_s:end}=result.recording;
  const W=1000,H=330,L=75,R=22,T=35,B=46;
  let low=Math.min(...valid.map(s=>s.value),result.baseline.mean_pa-result.settings.recoveryTolerancePa,0);
  let high=Math.max(...valid.map(s=>s.value),result.settings.thresholdPa,result.baseline.mean_pa+result.settings.recoveryTolerancePa);
  const pad=Math.max(.25,(high-low)*.12);low-=pad;high+=pad;
  const x=t=>L+(t-start)/(end-start||1)*(W-L-R), y=p=>T+(high-p)/(high-low)*(H-T-B);
  let svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Recorded differential pressure, pascals versus elapsed seconds"><rect width="100%" height="100%" fill="#fff"/>';
  const bandTop=y(result.baseline.mean_pa+result.settings.recoveryTolerancePa),bandBottom=y(result.baseline.mean_pa-result.settings.recoveryTolerancePa);
  svg+='<rect x="'+x(start)+'" y="'+bandTop+'" width="'+(x(end)-x(start))+'" height="'+(bandBottom-bandTop)+'" fill="#e5f2ed"/>';
  for(let i=0;i<=4;i++){
    const t=start+(end-start)*i/4,p=low+(high-low)*i/4;
    svg+='<path d="M'+L+' '+y(p)+'H'+(W-R)+'" stroke="#dbe4ea"/><text x="'+(L-9)+'" y="'+(y(p)+5)+'" text-anchor="end" fill="#42566a" font-size="14">'+p.toFixed(2)+'</text>';
    svg+='<text x="'+x(t)+'" y="'+(H-18)+'" text-anchor="middle" fill="#42566a" font-size="14">'+t.toFixed(1)+'s</text>';
  }
  svg+='<text x="12" y="20" fill="#42566a" font-size="14">ΔP (Pa)</text>';
  svg+='<path d="M'+L+' '+y(result.settings.thresholdPa)+'H'+(W-R)+'" stroke="#b44c35" stroke-dasharray="6 5"/>';
  svg+='<path d="M'+L+' '+y(result.baseline.mean_pa)+'H'+(W-R)+'" stroke="#437964" stroke-dasharray="3 4"/>';
  for(const [time,name,color] of [[result.settings.failureS,'Failure','#a65a10'],[result.settings.restoreS,'Restore','#5c62a2']]){
    if(time!==null)svg+='<path d="M'+x(time)+' '+T+'V'+(H-B)+'" stroke="'+color+'" stroke-dasharray="3 3"/><text x="'+x(time)+'" y="22" text-anchor="'+(time>(start+end)/2?'end':'start')+'" fill="'+color+'" font-size="14">'+name+' '+time+'s</text>';
  }
  for(const segment of acquisitionSegments(channel,result.settings.maxGapS)){
    if(segment.length>1)svg+='<path d="'+segment.map((s,i)=>(i?'L':'M')+x(s.t).toFixed(2)+' '+y(s.value).toFixed(2)).join(' ')+'" fill="none" stroke="#145e78" stroke-width="2.5"/>';
    else if(segment.length)svg+='<circle cx="'+x(segment[0].t)+'" cy="'+y(segment[0].value)+'" r="3" fill="#145e78"/>';
  }
  for(const s of channel.samples.filter(s=>!s.valid))svg+='<path d="M'+(x(s.t)-3)+' '+(H-B-3)+'l6 6m-6 0l6-6" stroke="#b44c35"/>';
  if(playhead!==null)svg+='<path d="M'+x(playhead)+' '+T+'V'+(H-B)+'" stroke="#152d44" stroke-width="1.5"/>';
  return svg+'</svg>';
}

export function buildEvidence({parsed,channel,result,filename,sha256=null,source='IMPORTED_UNVERIFIED',runId,positive,negative,sign=1,review={},bimWindow=null}) {
  if(parsed.declaredSynthetic && source!=='SYNTHETIC')throw Error('This input is explicitly labeled synthetic and cannot be exported as measured or unverified.');
  if(!SOURCES.includes(source))throw Error('Choose a data provenance.');
  if(typeof runId!=='string'||!runId.trim()||runId.length>120)throw Error('Give this run a short ID.');
  validateMapping(positive,negative);
  if(review.residualRisk && !review.notes?.trim())throw Error('Explain the reviewer-entered residual risk in the review notes.');
  if(bimWindow && (!Number.isFinite(bimWindow.start_s)||!Number.isFinite(bimWindow.end_s)||bimWindow.start_s<result.recording.start_s||bimWindow.end_s>result.recording.end_s||bimWindow.end_s<=bimWindow.start_s||bimWindow.end_s-bimWindow.start_s>60))throw Error('Choose a BIM comparison window inside this recording, at most 60 seconds long.');
  return {schema:'sure2-recorded-test-1',software_version:VERSION,generated_utc:new Date().toISOString(),
    run_id:runId,source,source_is_user_declared:true,input:{filename,sha256,format:parsed.format,input_unit:parsed.inputUnit,unit_factor_to_pa:parsed.unitFactor,
      origin_device_time_s:parsed.originDeviceTimeS,timestamp_basis:'Elapsed relative to first acquisition in this file; Arduino timestamp is sequential loop-start device runtime, not UTC.',
      channel:channel.id,pressure_sign_multiplier:sign,positive_space_id:positive,negative_space_id:negative,startup_notes:parsed.startupNotes,repeated_headers:parsed.repeatedHeaders},
    analysis:result,review:{...review,classification_basis:'Manual reviewer entry; not an automated certification or WBHT risk rating.'},
    bim_export:bimWindow?{...bimWindow,rebased_to_zero:true,elapsed_time_origin_s:bimWindow.start_s,existing_simulator_horizon_s:60}:null,
    samples:channel.samples,import_warnings:parsed.warnings};
}

export function reportHTML(evidence) {
  const a=evidence.analysis, fmt=(v,unit='')=>v===null?'Not available':Number(v).toFixed(3)+unit;
  const row=(name,value)=>'<tr><th>'+escapeHTML(name)+'</th><td>'+escapeHTML(value)+'</td></tr>';
  const table='<table>'+row('Data source',evidence.source+' (user declared)')+row('Boundary',evidence.input.positive_space_id+' minus '+evidence.input.negative_space_id)
    +row('Input file / channel',evidence.input.filename+' / '+evidence.input.channel)+row('Input unit / sign',evidence.input.input_unit+' / '+evidence.input.pressure_sign_multiplier)
    +row('Device origin',fmt(evidence.input.origin_device_time_s,' s'))+row('Duration',fmt(a.recording.duration_s,' s'))
    +row('Valid / invalid samples',a.recording.valid_samples+' / '+a.recording.invalid_samples)+row('Observed time / unobserved',fmt(a.recording.supported_duration_s,' s')+' / '+fmt(a.recording.unobserved_duration_s,' s'))
    +row('Baseline interval',a.settings.baselineStartS+' to '+a.settings.baselineEndS+' s')+row('Baseline mean / sample SD',fmt(a.baseline.mean_pa,' Pa')+' / '+fmt(a.baseline.sd_pa,' Pa'))
    +row('Sampled peak',fmt(a.pressure.peak_pa,' Pa')+' at '+fmt(a.pressure.peak_time_s,' s'))+row('Maximum departure from baseline',fmt(a.pressure.maximum_change_from_baseline_pa,' Pa'))
    +row('Analysis threshold',fmt(a.threshold.value_pa,' Pa'))+row('Observed time above threshold',fmt(a.threshold.observed_duration_s,' s'))
    +row('Longest observed episode',fmt(a.threshold.longest_episode_s,' s'))+row('Time above zero',fmt(a.positivePressure.observed_duration_s,' s'))
    +row('Failure / restoration',fmt(a.settings.failureS,' s')+' / '+fmt(a.settings.restoreS,' s'))
    +row('Recovery criterion','Baseline ± '+a.settings.recoveryTolerancePa+' Pa held for '+a.settings.recoveryHoldS+' s')
    +row('Recovery',a.recovery.status==='observed'?fmt(a.recovery.elapsed_from_restore_s,' s after restoration')+'; confirmed at '+fmt(a.recovery.confirmed_s,' s'):a.recovery.status)
    +row('Maximum connected gap',fmt(a.settings.maxGapS,' s'))+row('BIM comparison export window',evidence.bim_export?evidence.bim_export.start_s+' to '+evidence.bim_export.end_s+' s; window start becomes zero in the exported CSV':'Full normalized recording')+row('Input SHA-256',evidence.input.sha256??'Unavailable in this browser')+'</table>';
  const review='<h2>Reviewer assessment</h2><table>'+row('Reviewer',evidence.review.reviewer||'Not supplied')+row('Boundary / design context',evidence.review.context||'Not supplied')
    +row('Initial risk (manual)',evidence.review.initialRisk||'Not assessed')+row('Residual risk (manual)',evidence.review.residualRisk||'Not assessed')+row('Explanation',evidence.review.notes||'Not supplied')+'</table>';
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>'+escapeHTML(evidence.run_id)+' — Sure2 recorded test</title><style>body{font:16px system-ui,sans-serif;color:#183046;max-width:1050px;margin:32px auto;padding:0 22px;line-height:1.5}h1{font-size:28px}h2{font-size:20px}table{border-collapse:collapse;width:100%;margin:20px 0;font-size:14px}th,td{border:1px solid #cbd6df;padding:8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{width:38%;background:#f0f5f7}svg{width:100%;height:auto}li{margin:6px 0}.badge{font-weight:700;color:#8a4222}@media print{body{margin:0;max-width:none}tr{break-inside:avoid}svg{break-inside:avoid}button{display:none}}</style></head><body><h1>Sure² / Recorded Test Summary</h1><p>'+escapeHTML(evidence.run_id)+' · '+escapeHTML(evidence.generated_utc)+'</p><p class="badge">'+escapeHTML(evidence.source)+' — '+(evidence.source==='SYNTHETIC'?'software test data':'provenance is user declared')+'</p>'
    +'<p>Analysis of a recorded pressure boundary. This summary is not a certification or a validated predictive result.</p>'
    +chartSVG({samples:evidence.samples},a)+ '<p>Blue: valid pressure. Green band: recovery band. Dashed red: analysis threshold. Crosses/gaps: invalid or unobserved data.</p>'
    +table+review+'<h2>Method and limitations</h2><p>'+escapeHTML(a.method)+'</p><ul>'+[...a.warnings,...a.limitations,...evidence.import_warnings].map(s=>'<li>'+escapeHTML(s)+'</li>').join('')+'</ul>'
    +'<p>Software '+escapeHTML(evidence.software_version)+'. Original input is not embedded in this report. Keep the raw recording and JSON evidence together.</p></body></html>';
}

