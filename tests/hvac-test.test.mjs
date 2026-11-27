import test from 'node:test';
import assert from 'node:assert/strict';
import {captureBaseline,baselineMatches,makeTestPlan,runScheduledNetwork,eventFraction,reviewBoundary,boundaryCSV,scenarioReportHTML} from '../hvac-test.js';
import {runNetwork} from '../bim-engine.js';
import {parseBoundaryCSV} from '../channels.js';
const near=(a,b,tol=1e-8)=>assert.ok(Math.abs(a-b)<tol,a+' versus '+b);
const single=()=>({approved:true,nodes:[{id:'A',name:'A',volume:1,supply:.02,exhaust:.03,leak:.01}],links:[]});
const two=()=>({approved:true,nodes:[...single().nodes,{id:'B',name:'B',volume:1,supply:.01,exhaust:.02,leak:.01}],links:[]});
const options={designIntent:'Illustrative negative room-to-reference pressure',reviewer:'Test',bands:{A:{min:-2,max:0}}};
test('reviewed baseline preserves model inputs and entered design bands without certifying',()=>{
 const c=single(),baseline=captureBaseline(c,options);
 near(baseline.pressure_pa[0],-1);
 assert.equal(baseline.rooms[0].band_result,'within_entered_band');
 assert.equal(baseline.source,'SYNTHETIC');
 c.nodes[0].supply=.03;
 near(baseline.config.nodes[0].supply,.02);
 assert.equal(baselineMatches(baseline,c),false);
});
test('missing intent, unreviewed config and invalid bands are blocked',()=>{
 assert.throws(()=>captureBaseline(single(),{designIntent:''}),/Describe/);
 assert.throws(()=>captureBaseline({...single(),approved:false},options),/Review/);
 assert.throws(()=>captureBaseline(single(),{...options,bands:{A:{min:1,max:-1}}}),/ordered bounds/);
 assert.throws(()=>captureBaseline(single(),{...options,bands:{unknown:{min:0,max:1}}}),/existing room/);
 const b=captureBaseline(single(),{designIntent:'Test only'});
 assert.equal(b.rooms[0].band_result,'not_specified');
});
test('instant delayed shutdown exposes expected sign changes and restoration order',()=>{
 const c=single(),plan=makeTestPlan(c,{target:0,start:10,restore:40,severity:1,delay:3,restoreDelay:5,duration:60,tau:0});
 const frames=runScheduledNetwork(c,plan);
 const at=t=>frames.find(f=>f.t===t);
 near(at(9).p[0],-1);near(at(10).p[0],4);near(at(13).p[0],0);
 near(at(40).p[0],-9);near(at(45).p[0],-1);
 assert.equal(plan.events[1].start,13);assert.equal(plan.events[1].restore,45);
});
test('simultaneous loss differs from delayed shutdown',()=>{
 const c=single(),plan=makeTestPlan(c,{pattern:'simultaneous',start:10,restore:40,severity:1,duration:60,tau:0});
 const f=runScheduledNetwork(c,plan);
 near(f.find(f=>f.t===10).p[0],0);
 near(f.find(f=>f.t===40).p[0],-1);
 assert.equal(plan.events[1].start,10);assert.equal(plan.events[1].restore,40);
});
test('two-room exhaust failure affects each aggregate flow independently',()=>{
 const c=two(),plan=makeTestPlan(c,{pattern:'twoExhaust',target:0,secondTarget:1,start:10,restore:40,severity:1,duration:60,tau:0});
 const frame=runScheduledNetwork(c,plan).find(f=>f.t===20);
 near(frame.p[0],4);near(frame.p[1],1);
 near(frame.supply[0],.02);near(frame.supply[1],.01);
 assert.throws(()=>makeTestPlan(c,{pattern:'twoExhaust',target:0,secondTarget:0}),/different room/);
});
test('sustained failure has no implicit restoration at run end',()=>{
 const c=single(),plan=makeTestPlan(c,{pattern:'sustainedExhaust',start:10,severity:1,duration:180,tau:0});
 assert.equal(plan.events.length,1);assert.equal(plan.events[0].restore,null);
 const frames=runScheduledNetwork(c,plan);
 assert.equal(frames.length,361);near(frames.at(-1).p[0],4);
});
test('declared exponential command ramp is continuous at restoration',()=>{
 const event={start:10,restore:20};
 near(eventFraction(9,event,4),0);near(eventFraction(10,event,4),0);
 near(eventFraction(14,event,4),1-Math.exp(-1));
 near(eventFraction(20,event,4),1-Math.exp(-2.5));
 near(eventFraction(24,event,4),(1-Math.exp(-2.5))*Math.exp(-1));
});
test('schedule validates delayed timing, ranges, duplicated roles and unknown rooms',()=>{
 const c=single();
 assert.throws(()=>makeTestPlan(c,{start:10,restore:58,restoreDelay:5,duration:60}),/Delayed supply/);
 assert.throws(()=>makeTestPlan(c,{duration:601}),/0–600/);
 assert.throws(()=>makeTestPlan(c,{severity:1.01}),/0–100/);
 const p=makeTestPlan(c,{duration:60}),duplicate=structuredClone(p);duplicate.events.push({...p.events[0]});
 assert.throws(()=>runScheduledNetwork(c,duplicate),/duplicate/);
 const unknown=structuredClone(p);unknown.events[0].node='UNKNOWN';
 assert.throws(()=>runScheduledNetwork(c,unknown),/Invalid/);
});
test('schedule preserves input configuration and mass-balance residuals',()=>{
 const c=two(),before=JSON.stringify(c);
 const frames=runScheduledNetwork(c,makeTestPlan(c,{pattern:'twoExhaust',target:0,secondTarget:1,duration:180}));
 assert.equal(JSON.stringify(c),before);
 assert.ok(frames.every(f=>f.residual<1e-6));
});
test('legacy scenarios accept longer horizons while retaining default behavior',()=>{
 const c=single(),old=runNetwork(c,'exhaust',0,.7,{start:10,end:45});
 assert.equal(old.length,121);assert.equal(old.at(-1).t,60);
 const longer=runNetwork(c,'exhaust',0,.7,{start:10,end:45,duration:180});
 assert.equal(longer.length,361);assert.equal(longer.at(-1).t,180);
 near(longer[60].p[0],old[60].p[0]);
 assert.throws(()=>runNetwork(c,'exhaust',0,.7,{start:10,end:45,duration:30}),/run duration/);
});
test('fractional run duration includes the exact final frame',()=>{
 const c=single(),p=makeTestPlan(c,{pattern:'simultaneous',start:1,restore:2,duration:3.2,tau:0});
 const f=runScheduledNetwork(c,p);
 assert.equal(f.at(-1).t,3.2);assert.ok(f.every((x,i)=>!i||x.t>f[i-1].t));
});
test('boundary review uses pressure at A minus B, not room A alone',()=>{
 const c=two(),baseline=captureBaseline(c,{designIntent:'Boundary test'});
 const frames=[{t:0,p:[-1,-1]},{t:1,p:[4,1]},{t:2,p:[4,1]},{t:3,p:[-1,-1]}];
 const r=reviewBoundary(frames,c,'A','B',2,baseline);
 near(r.baseline_pa,0);near(r.peak_pa,3);near(r.above_threshold_s,5/3);
 assert.equal(r.connection,'pressure_comparison_only');
 assert.deepEqual(parseBoundaryCSV(boundaryCSV(r),['A','B']).map(x=>x.value),[0,3,3,0]);
});
test('changed baseline, same endpoints and invalid threshold are rejected',()=>{
 const c=two(),baseline=captureBaseline(c,{designIntent:'Test'}),f=[{t:0,p:[-1,-1]},{t:1,p:[0,0]}];
 assert.throws(()=>reviewBoundary(f,c,'A','A',2,baseline),/Invalid/);
 assert.throws(()=>reviewBoundary(f,c,'A','B',-1,baseline),/nonnegative/);
 c.nodes[0].leak=.02;
 assert.throws(()=>reviewBoundary(f,c,'A','B',2,baseline),/capture a new baseline/);
});
test('summary escapes text, retains synthetic basis and includes event schedule',()=>{
 const c=single(),baseline=captureBaseline(c,{designIntent:'<script>bad</script>'}),plan=makeTestPlan(c,{duration:60});
 const f=runScheduledNetwork(c,plan),review=reviewBoundary(f,c,'A','REFERENCE',2.5,baseline);
 const html=scenarioReportHTML({baseline,plan,review,modelName:'<img src=x>',run:{scenario:'sequenced'}});
 assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img src=x>'));
 assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('SYNTHETIC MODEL OUTPUT'));
 assert.ok(html.includes('secondary')===false);assert.ok(html.includes('restoration schedule'));
 assert.ok(html.includes('not a measured airflow'));
});

