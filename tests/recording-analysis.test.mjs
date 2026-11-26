import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseRecording,analyzeChannel,prepareChannel,csvRows,buildEvidence,exportBoundaryCSV,reportHTML,chartSVG} from '../recording-analysis.js';
import {parseBoundaryCSV} from '../channels.js';
import {runNetwork,setup,parseCSV} from '../bim-engine.js';
const near=(a,b,tol=1e-8)=>assert.ok(Math.abs(a-b)<tol,String(a)+' versus '+b);
const make=rows=>parseRecording('time_s,pressure_pa\n'+rows.map(r=>r.join(',')).join('\n')).channels[0];
const settings={baselineStartS:0,baselineEndS:1,thresholdPa:2,recoveryTolerancePa:.1,recoveryHoldS:2};
const fixture=async name=>parseRecording(await readFile(new URL('../recording-examples/'+name+'_SYNTHETIC.csv',import.meta.url),'utf8'));
test('working Arduino header: Pa, milliseconds, CRC flag, startup map, missing B',async()=>{
 const parsed=await fixture('gaps');
 assert.equal(parsed.format,'sure2-arduino');assert.equal(parsed.inputUnit,'Pa');
 assert.equal(parsed.channels[0].samples[1].t,1);
 assert.equal(parsed.channels[1].validCount,0);
 const missing=parsed.channels[0].samples.find(s=>s.t===38);
 assert.equal(missing.valid,false);assert.equal(missing.value,null);
 assert.ok(parsed.startupNotes.some(s=>s.includes('mux channel 0')));
 assert.equal(parsed.channels[0].samples[0].environment.sht_temp_c,25);
});
test('exact linear threshold duration and sample baseline SD',()=>{
 const c=make([[0,-2],[1,-2],[2,4],[3,4],[4,-2],[5,-2]]);
 const a=analyzeChannel(c,settings);
 near(a.baseline.mean_pa,-2);near(a.baseline.sd_pa,0);
 near(a.threshold.observed_duration_s,5/3);
 near(a.threshold.episodes[0].start_s,5/3);near(a.threshold.episodes[0].end_s,10/3);
 assert.equal(a.pressure.peak_pa,4);assert.equal(a.pressure.peak_time_s,2);
});
test('sample standard deviation is not population SD',()=>{
 const a=analyzeChannel(make([[0,-3],[1,-1],[2,-2]]),settings);
 near(a.baseline.mean_pa,-2);near(a.baseline.sd_pa,Math.sqrt(2));
});
test('sustained event is counted to recording end; recovery is not fabricated',async()=>{
 const p=await fixture('sustained'),a=analyzeChannel(p.channels[0],{...settings,baselineEndS:20,thresholdPa:2.5,failureS:30,restoreS:100,recoveryHoldS:5});
 assert.equal(a.recovery.status,'not_observed');
 near(a.threshold.observed_duration_s,206.25);
 assert.equal(a.recording.duration_s,240);
});
test('recovery is in-band entry held continuously, with confirmation time',()=>{
 const c=make([[0,-2],[1,-2],[2,4],[3,4],[4,-2],[5,-2],[6,-2],[7,-2]]);
 const a=analyzeChannel(c,{...settings,restoreS:3});
 near(a.recovery.onset_s,3+5.9/6);
 near(a.recovery.elapsed_from_restore_s,5.9/6);
 near(a.recovery.confirmed_s,3+5.9/6+2);
});
test('invalid samples break duration and recovery, even when neighbors match',()=>{
 const p=parseRecording('time_s,pressure_pa,valid\n0,-2,1\n1,-2,1\n2,4,1\n3,,0\n4,4,1\n5,-2,1\n6,-2,1\n7,,0\n8,-2,1\n9,-2,1');
 const a=analyzeChannel(p.channels[0],{...settings,restoreS:5,recoveryHoldS:3});
 assert.equal(a.threshold.episodes.length,2);
 near(a.threshold.observed_duration_s,2/3);
 assert.equal(a.recording.invalid_samples,2);
 near(a.recording.unobserved_duration_s,4);
 assert.equal(a.recovery.status,'not_observed');
});
test('long timestamp gaps do not count as observed threshold exposure',()=>{
 const c=make([[0,-2],[1,-2],[2,4],[100,4],[101,4]]);
 const a=analyzeChannel(c,settings);
 near(a.recording.nominal_interval_s,1);
 near(a.recording.unobserved_duration_s,98);
 near(a.threshold.observed_duration_s,4/3);
});
test('unknown generic units are blocked; explicit inH2O conversion is recorded',()=>{
 assert.throws(()=>parseRecording('time_s,pressure\n0,0.045\n1,0.05'),/Select its verified input unit/);
 const p=parseRecording('time_s,pressure\n0,0.045\n1,0.05',{unit:'inH2O'});
 near(p.channels[0].samples[0].value,11.2090005);
 near(p.unitFactor,249.0889);
 assert.throws(()=>parseRecording('time_s,pressure_pa\n0,0.045\n1,0.05',{unit:'inH2O'}),/header declares pascals/);
});
test('duplicate, reset and malformed time rows are rejected',()=>{
 for(const rows of ['0,1\n0,2','2,1\n1,2','0,1\n,2','0,1\n-1,2'])
  assert.throws(()=>parseRecording('time_s,pressure_pa\n'+rows));
 assert.throws(()=>parseRecording('time_s,pressure_pa\n0,1\n1,2,3'),/columns/);
});
test('real zero is valid; blank, NaN and invalid flags remain missing',()=>{
 const p=parseRecording('time_s,pressure_pa,valid\n0,0,1\n1,,1\n2,NaN,1\n3,9,0');
 assert.equal(p.channels[0].validCount,1);assert.equal(p.channels[0].samples[0].value,0);
 assert.ok(p.channels[0].samples.slice(1).every(s=>s.value===null));
 assert.throws(()=>analyzeChannel(p.channels[0],settings),/at least two/);
});
test('polarity correction changes analysis and preserves original numeric samples',()=>{
 const raw=make([[0,-2],[1,-2],[2,4]]);
 const flipped=prepareChannel(raw,{sign:-1});
 assert.equal(raw.samples[0].value,-2);assert.equal(flipped.samples[0].value,2);
 assert.throws(()=>prepareChannel(raw,{sign:0}));
});
test('multiple explicit boundaries are kept separate',()=>{
 const p=parseRecording('time_s,positive_space_id,negative_space_id,pressure_pa\n0,A,B,3\n0,B,REFERENCE,-2\n1,A,B,4\n1,B,REFERENCE,-3');
 assert.equal(p.channels.length,2);assert.equal(p.channels[0].negative,'B');
 assert.equal(p.channels[0].samples[1].value,4);
 assert.throws(()=>parseRecording('time_s,positive_space_id,negative_space_id,pressure_pa\n0,A,A,3'));
});
test('BOM, CRLF, quoted room identifiers and repeated headers are supported',()=>{
 const p=parseRecording('\uFEFFtime_s,space_id,pressure_pa\r\n0,"A, room",-2\r\ntime_s,space_id,pressure_pa\r\n1,"A, room",-1\r\n');
 assert.equal(p.channels[0].positive,'A, room');assert.equal(p.repeatedHeaders,1);
 assert.deepEqual(csvRows('a,b\n"line\nbreak","quote""x"'),[['a','b'],['line\nbreak','quote"x']]);
 assert.throws(()=>csvRows('a,b\n"unfinished'),/Unclosed/);
});
test('baseline/event validation rejects empty or contaminated intervals',()=>{
 const c=make([[0,-2],[1,-2],[2,4],[3,4]]);
 assert.throws(()=>analyzeChannel(c,{...settings,baselineEndS:0}),/baseline interval/);
 assert.throws(()=>analyzeChannel(c,{...settings,baselineEndS:4}),/baseline interval/);
 assert.throws(()=>analyzeChannel(c,{...settings,failureS:.5}),/baseline must end/);
 assert.throws(()=>analyzeChannel(c,{...settings,failureS:2,restoreS:1.5}),/Restoration must follow/);
 assert.throws(()=>analyzeChannel(c,{...settings,maxGapS:0}),/Maximum gap/);
});
test('declared BIM window is rebased, bounded and accepted by current parser',()=>{
 const c=make(Array.from({length:181},(_,t)=>[t,t<100?-2:3]));
 const csv=exportBoundaryCSV(c,{positive:'CHAMBER',negative:'REFERENCE',startS:100,endS:160,rebase:true});
 const imported=parseBoundaryCSV(csv,['CHAMBER']);
 assert.equal(imported.length,61);assert.equal(imported[0].t,0);assert.equal(imported.at(-1).t,60);
 assert.equal(imported[0].value,3);
});
test('full normalized CSV excludes invalid data without inserting zeros',()=>{
 const p=parseRecording('time_s,pressure_pa,valid\n0,0,1\n1,,0\n2,3,1');
 const csv=exportBoundaryCSV(p.channels[0],{positive:'A'});
 const rows=parseBoundaryCSV(csv,['A']);
 assert.equal(rows.length,2);assert.equal(rows[0].value,0);assert.equal(rows[1].t,2);
});
test('evidence preserves provenance, SHA, sign, mapping and manual review',async()=>{
 const p=await fixture('brief'),c=prepareChannel(p.channels[0]),a=analyzeChannel(c,{...settings,baselineEndS:20,restoreS:100});
 const e=buildEvidence({parsed:p,channel:c,result:a,filename:'test.csv',sha256:'abc',source:'SYNTHETIC',runId:'test',positive:'A',negative:'REFERENCE',review:{initialRisk:'High',residualRisk:'Low',notes:'Reviewer explanation'},bimWindow:{start_s:90,end_s:150}});
 assert.equal(e.source,'SYNTHETIC');assert.equal(e.input.sha256,'abc');assert.equal(e.bim_export.elapsed_time_origin_s,90);
 assert.equal(e.review.initialRisk,'High');assert.equal(e.samples.length,181);
 assert.throws(()=>buildEvidence({parsed:p,channel:c,result:a,filename:'test',source:'SYNTHETIC',runId:'x',positive:'A',negative:'A'}));
 assert.throws(()=>buildEvidence({parsed:p,channel:c,result:a,filename:'test',source:'SYNTHETIC',runId:'x',positive:'A',negative:'B',review:{residualRisk:'Low'}}),/Explain/);
 assert.throws(()=>buildEvidence({parsed:p,channel:c,result:a,filename:'test',source:'SYNTHETIC',runId:'x',positive:'A',negative:'B',bimWindow:{start_s:0,end_s:100}}),/at most 60/);
});
test('readable report escapes untrusted text and chart spans beyond 60 seconds',async()=>{
 const p=await fixture('brief'),c=p.channels[0],a=analyzeChannel(c,{...settings,baselineEndS:20});
 const e=buildEvidence({parsed:p,channel:c,result:a,filename:'<img onerror=x>',source:'SYNTHETIC',runId:'<script>alert(1)</script>',positive:'A',negative:'B',review:{notes:'<svg onload=x>'}});
 const html=reportHTML(e),chart=chartSVG(c,a,150);
 assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img onerror'));
 assert.ok(html.includes('&lt;svg onload=x&gt;'));assert.ok(html.includes('SYNTHETIC'));
 assert.ok(chart.includes('180.0s'));assert.ok(html.includes('not a certification'));
});
test('existing solver and CSV entry points retain prior behavior',async()=>{
 const model=JSON.parse(await readFile(new URL('../models/duplex.json',import.meta.url)));
 const config=setup(model);config.approved=true;
 const target=config.nodes.findIndex(n=>n.name==='A101');
 assert.ok(target>=0);
 const frames=runNetwork(config,'exhaust',target,.7,{start:10,end:45});
 assert.equal(frames.length,121);
 near(frames[0].p[target],-1.78,.01);near(frames[60].p[target],2.61,.01);near(frames[120].p[target],-1.65,.01);
 assert.equal(parseCSV('time_s,space_id,pressure_pa\n0,'+config.nodes[target].id+',-2',[config.nodes[target].id]).length,1);
});
test('large Arduino input is bounded without spread-argument overflow',()=>{
 const header='time_ms,dp_a_pa,dp_b_pa,dp_a_ok,dp_b_ok';
 const text=header+'\n'+Array.from({length:70000},(_,i)=>i*1000+',-2,,1,0').join('\n');
 const p=parseRecording(text);assert.equal(p.channels[0].validCount,70000);
});


test('explicit boundary and room headers do not silently fill missing endpoints',()=>{
 assert.throws(()=>parseRecording('time_s,positive_space_id,negative_space_id,pressure_pa\n0,A,,2'),/both nonempty/);
 assert.throws(()=>parseRecording('time_s,positive_space_id,pressure_pa\n0,A,2'),/both nonempty/);
 assert.throws(()=>parseRecording('time_s,space_id,pressure_pa\n0,,2'),/nonempty space_id/);
});
test('marked synthetic recordings cannot be relabeled as measurements',async()=>{
 const p=await fixture('brief'),c=p.channels[0],a=analyzeChannel(c,settings);
 assert.equal(p.declaredSynthetic,true);
 assert.throws(()=>buildEvidence({parsed:p,channel:c,result:a,filename:'test',source:'MEASURED',runId:'x',positive:'A',negative:'B'}),/explicitly labeled synthetic/);
});
