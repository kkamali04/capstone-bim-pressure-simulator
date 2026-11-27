import test from 'node:test';
import assert from 'node:assert/strict';
import {buildChamber,chamberSettings,chamberNetworkValues} from '../chamber.js';
import {buildWorkspaceNetwork} from '../workspace-network.js';
import {validateModel,checkConfig,solveNetwork,runNetwork} from '../bim-engine.js';
import {projectPackage,validateEngineering} from '../engineering.js';
import {SerialCapture,SerialConnection,SERIAL_HEADER} from '../serial-capture.js';
import {parseRecording,prepareChannel} from '../recording-analysis.js';
const params={units:'ft',width:2,depth:2,height:4,supply:2,exhaust:4,leak:.0003};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,a+' vs '+b);
const row=(ms,a='-2',flag='1')=>[ms,a,'','25','40','','',flag,'0','1','0'].join(',');
const make=source=>new SerialCapture({runId:'RUN_01',source});
const fixture=SERIAL_HEADER+'\n'+row(10000)+'\n'+row(11000,'','0')+'\n'+row(12000,'0')+'\n';

test('chamber converts feet to SI and produces valid reusable geometry',()=>{
 const m=buildChamber(params);assert.equal(validateModel(m),true);validateEngineering(m);
 near(m.entities[0].volume_m3,.6096*.6096*1.2192);
 assert.equal(m.entities[0].id,'CHAMBER');assert.equal(m.entities.length,7);
 assert.equal(m.chamberSetup.dimension_basis,'PROPOSED');
 assert.ok(m.entities.every(e=>e.vertices.length===24&&e.faces.length===36));
 const reopened=JSON.parse(JSON.stringify(projectPackage(m))).model;
 assert.deepEqual(reopened.chamberSetup,m.chamberSetup);assert.equal(validateModel(reopened),true);
});
test('chamber network uses entered assumptions instead of residential defaults',()=>{
 const c=buildWorkspaceNetwork(buildChamber(params));checkConfig({...c,approved:true});
 near(c.nodes[0].supply,2/3600);near(c.nodes[0].exhaust,4/3600);near(c.nodes[0].leak,.0003);
 assert.equal(c.nodes[0].flowSource.supply,'Entered chamber assumption');
 near(solveNetwork(c)[0],-(((2/3600)/.0003)**2));
 const frames=runNetwork({...c,approved:true},'exhaust',0,.7,{start:10,end:45});
 assert.ok(frames[60].p[0]>0);
});
test('dimension evidence never changes flow assumptions into measurements',()=>{
 const m=buildChamber({...params,dimensionBasis:'USER_MEASURED'}),c=buildWorkspaceNetwork(m);
 assert.equal(m.chamberSetup.flow_basis,'USER_ENTERED_ASSUMPTIONS');
 assert.match(c.nodes[0].flowSource.exhaust,/assumption/);
 assert.match(m.source.note,/not independently verified/);
});
test('chamber rejects invalid dimensions, evidence and corrupted saved settings',()=>{
 for(const bad of [{width:0},{height:Infinity},{units:'in'},{supply:-1},{supply:''},{exhaust:null},{leak:0},{dimensionBasis:'VERIFIED'}])assert.throws(()=>buildChamber({...params,...bad}));
 const m=buildChamber(params);m.chamberSetup.exhaust_m3h=-1;assert.throws(()=>buildWorkspaceNetwork(m));
 const s=chamberSettings(params);s.schema='other';assert.throws(()=>chamberNetworkValues(s));
});
test('changing geometry does not imply a physically identified pressure time constant',()=>{
 const a=buildWorkspaceNetwork(buildChamber(params)),b=buildWorkspaceNetwork(buildChamber({...params,height:3}));
 assert.notEqual(a.nodes[0].volume,b.nodes[0].volume);near(solveNetwork(a)[0],solveNetwork(b)[0]);
});
test('serial assembler handles every chunk split and CRLF without losing rows',()=>{
 const text='# Startup\r\n'+fixture.replaceAll('\n','\r\n');
 for(let split=1;split<text.length;split++){
  const c=make();c.push(text.slice(0,split));c.push(text.slice(split));c.finish();
  assert.equal(c.rows.length,3);assert.equal(c.raw,text);assert.equal(c.error,null);assert.equal(c.preview[0].t,0);assert.equal(c.preview[2].t,2);
 }
});
test('serial CSV keeps true zero, failed flags and separate pressure devices',()=>{
 const c=make();c.push(fixture);c.finish();
 assert.equal(c.preview[1].a,null);assert.equal(c.preview[2].a,0);assert.equal(c.preview[2].b,null);
 const parsed=parseRecording(c.csv()),a=prepareChannel(parsed.channels[0]);
 assert.equal(a.samples[1].valid,false);assert.equal(a.samples[2].value,0);
 assert.equal(parsed.channels[1].validCount,0);
});
test('serial does not invent a CSV header or rows from readable output',()=>{
 const c=make();c.push('1.0 s | DP A: -2 Pa\n'+row(1000)+'\n');c.finish();
 assert.equal(c.rows.length,0);assert.equal(c.headerSeen,false);assert.ok(c.warnings.some(x=>/header/.test(x)));
});
test('device reset and duplicate abort analysis and preserve original text',()=>{
 for(const ms of [10000,500]){
  const c=make(),text=SERIAL_HEADER+'\n'+row(10000)+'\n'+row(ms)+'\n';
  assert.throws(()=>c.push(text),/reset or duplicate/);assert.equal(c.raw,text);assert.equal(c.rows.length,1);assert.ok(c.error);
  assert.match(c.csv(),/INCOMPLETE/);assert.throws(()=>c.mark('failure'),/receiving/);
 }
});
test('malformed Arduino columns, flags and time are not silently discarded',()=>{
 for(const bad of ['1000,-2',row(1000,'-2','2'),row('1000.5')]){
  const c=make();assert.throws(()=>c.push(SERIAL_HEADER+'\n'+bad+'\n'),/Malformed/);assert.ok(c.raw.includes(bad));
 }
});
test('repeated matching headers retain monotonic samples',()=>{
 const c=make();c.push(SERIAL_HEADER+'\n'+row(0)+'\n'+SERIAL_HEADER+'\n'+row(1000)+'\n');
 assert.equal(c.repeatedHeaders,1);assert.equal(c.rows.length,2);
});
test('unterminated tail is retained in raw evidence and excluded from CSV',()=>{
 const c=make();c.push(SERIAL_HEADER+'\n'+row(0)+'\n'+row(1000));c.finish();
 assert.equal(c.rows.length,1);assert.ok(c.warnings.some(x=>/unterminated/.test(x)));assert.ok(c.raw.endsWith(row(1000)));
 assert.throws(()=>c.push('\n'),/stopped/);
});
test('event markers keep separate host time and latest device sample anchors',()=>{
 const c=make();assert.throws(()=>c.mark('failure'),/receiving/);
 c.push(fixture,'2026-11-27T12:00:00.000Z');
 const mark=c.mark('failure','Open flap','2026-11-27T12:00:00.200Z');
 assert.equal(mark.elapsed_s,2);assert.equal(mark.last_device_time_ms,12000);
 assert.equal(mark.host_marked_utc,'2026-11-27T12:00:00.200Z');assert.match(mark.basis,/Not synchronized/);
 c.finish();const b=c.bundle();assert.equal(b.sample_receipts.length,3);assert.deepEqual(b.events,[mark]);assert.equal(b.source,'DEVICE_CAPTURE_UNVERIFIED');
 b.events[0].note='Changed';assert.equal(c.events[0].note,'Open flap');
});
test('synthetic stream cannot be relabeled as measured by the recording importer',()=>{
 const c=make('SYNTHETIC');c.push(fixture);c.finish();
 assert.equal(parseRecording(c.csv()).declaredSynthetic,true);
 assert.throws(()=>new SerialCapture({runId:'test',source:'MEASURED'}));
});
test('serial memory limit stops before accepting excess bytes',()=>{
 const c=new SerialCapture({runId:'limit',maxBytes:20});assert.throws(()=>c.push('x'.repeat(21)),/limit/);assert.equal(c.raw,'');assert.equal(c.bytes,0);assert.ok(c.error);
});
test('preview is bounded while the full recording remains intact',()=>{
 const c=make();c.push(SERIAL_HEADER+'\n'+Array.from({length:250},(_,i)=>row(i*1000)).join('\n')+'\n');
 assert.equal(c.rows.length,250);assert.equal(c.receipts.length,250);assert.equal(c.preview.length,200);assert.equal(c.preview[0].t,50);
});
function fakeSerial(){
 let controller,closed=0,readCanceled=0,openOptions;const writes=[];
 const port={readable:new ReadableStream({start(c){controller=c;},cancel(){readCanceled++;}}),writable:new WritableStream({write(b){writes.push(new TextDecoder().decode(b));}}),async open(o){openOptions=o;},async close(){assert.equal(port.readable.locked,false);assert.equal(port.writable.locked,false);closed++;}};
 return {api:{requestPort:async()=>port},port,writes,enqueue:s=>controller.enqueue(new TextEncoder().encode(s)),end:()=>controller.close(),fail:e=>controller.error(e),state:()=>({closed,readCanceled,openOptions})};
}
test('USB adapter requests 115200, sends tc, releases stream locks and closes on stop',async()=>{
 const f=fakeSerial(),chunks=[],errors=[];let ended=0;
 const c=new SerialConnection({onChunk:x=>chunks.push(x),onError:e=>errors.push(e),onEnd:()=>ended++});
 await c.connect(f.api);await c.csvMode();f.enqueue(fixture);await new Promise(r=>setTimeout(r,0));await c.disconnect();
 assert.equal(f.state().openOptions.baudRate,115200);assert.deepEqual(f.writes,['tc']);assert.equal(chunks.join(''),fixture);
 assert.equal(f.state().closed,1);assert.equal(f.state().readCanceled,1);assert.equal(ended,1);assert.equal(errors.length,0);assert.equal(c.port,null);
});
test('USB adapter preserves a failed capture and closes after a device read error',async()=>{
 const f=fakeSerial(),capture=make(),errors=[];
 const c=new SerialConnection({onChunk:s=>capture.push(s),onError:e=>{capture.error=e.message;errors.push(e.message);},onEnd:()=>capture.finish()});
 await c.connect(f.api);f.enqueue(fixture);await new Promise(r=>setTimeout(r,0));f.fail(Error('Device unplugged'));await c.task;
 assert.equal(capture.rows.length,3);assert.ok(capture.stoppedUTC);assert.deepEqual(errors,['Device unplugged']);assert.equal(f.state().closed,1);
});
test('port chooser cancellation does not leave a connected adapter',async()=>{
 const c=new SerialConnection();await assert.rejects(c.connect({requestPort:async()=>{throw Error('Canceled');}}),/Canceled/);assert.equal(c.port,null);
});
