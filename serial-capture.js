export const SERIAL_HEADER='time_ms,dp_a_pa,dp_b_pa,sht_temp_c,sht_rh_pct,bmp_abs_pa,bmp_temp_c,dp_a_ok,dp_b_ok,sht_ok,bmp_ok';
const utc=()=>new Date().toISOString();
const finite=v=>v.trim()!==''&&Number.isFinite(Number(v));
export class SerialCapture {
 constructor({runId,source='DEVICE_CAPTURE_UNVERIFIED',notes='',startedUTC=utc(),maxBytes=5_000_000}={}){
  if(typeof runId!=='string'||!runId.trim()||runId.length>120)throw Error('Enter a run ID (1–120 characters).');
  if(!['SYNTHETIC','DEVICE_CAPTURE_UNVERIFIED'].includes(source))throw Error('Capture source must remain explicit.');
  this.runId=runId.trim();this.source=source;this.notes=String(notes).slice(0,2000);this.startedUTC=startedUTC;this.maxBytes=maxBytes;
  this.raw='';this.pending='';this.bytes=0;this.rows=[];this.receipts=[];this.events=[];this.preview=[];this.headerSeen=false;this.repeatedHeaders=0;this.error=null;this.warnings=[];this.stoppedUTC=null;
 }
 push(text,receivedUTC=utc()){
  if(this.stoppedUTC||this.error)throw Error('This capture is stopped. Start a new run.');
  try{
   const bytes=new TextEncoder().encode(text).length;
   if(this.bytes+bytes>this.maxBytes)throw Error('Capture reached the 5 MB limit. Save this run and start another.');
   this.bytes+=bytes;this.raw+=text;this.pending+=text;
   let end;while((end=this.pending.indexOf('\n'))>=0){const line=this.pending.slice(0,end).replace(/\r$/,'');this.pending=this.pending.slice(end+1);this.line(line,receivedUTC);}
   if(this.pending.length>20000)throw Error('Serial line exceeds 20,000 characters; check the sketch and baud rate.');
  }catch(error){this.error=error.message;throw error;}
 }
 line(line,receivedUTC){
  const value=line.trim();
  if(value===SERIAL_HEADER){if(this.headerSeen)this.repeatedHeaders++;this.headerSeen=true;return;}
  if(!value||value.startsWith('#'))return;
  if(!this.headerSeen)return;
  if(!/^\d/.test(value))throw Error('Unexpected text after the CSV header. Stop and check the sketch output. Raw text is retained.');
  const a=value.split(',');
  if(a.length!==11||!/^\d+$/.test(a[0])||!Number.isSafeInteger(Number(a[0]))||a.slice(7).some(v=>!['0','1'].includes(v)))throw Error('Malformed Arduino row. Raw text is retained; analysis is blocked for this capture.');
  const ms=Number(a[0]);
  if(this.receipts.length&&ms<=this.receipts.at(-1).device_time_ms)throw Error('Device time reset or duplicate detected. Save this run; start a new run after the reset.');
  if(this.rows.length>=99990)throw Error('Capture reached its row limit. Save this run and start another.');
  this.rows.push(value);this.receipts.push({device_time_ms:ms,host_received_utc:receivedUTC});
  this.preview.push({t:(ms-this.receipts[0].device_time_ms)/1000,a:a[7]==='1'&&finite(a[1])?Number(a[1]):null,b:a[8]==='1'&&finite(a[2])?Number(a[2]):null});
  if(this.preview.length>200)this.preview.shift();
 }
 mark(kind,note='',hostUTC=utc()){
  if(this.stoppedUTC||this.error||!this.receipts.length)throw Error('Mark events while a run is receiving timestamped rows.');
  if(!['baseline','failure','restore','note'].includes(kind))throw Error('Choose a supported event marker.');
  if(this.events.length>=1000)throw Error('Event log reached 1000 markers.');
  const last=this.receipts.at(-1),event={kind,note:String(note).slice(0,1000),host_marked_utc:hostUTC,last_device_time_ms:last.device_time_ms,elapsed_s:(last.device_time_ms-this.receipts[0].device_time_ms)/1000,last_sample_received_utc:last.host_received_utc,basis:'Latest received sample anchor; host button time is separate. Not synchronized physical event timing.'};
  this.events.push(event);return event;
 }
 finish(stoppedUTC=utc()){
  if(this.stoppedUTC)return;
  this.stoppedUTC=stoppedUTC;
  if(this.pending)this.warnings.push('Trailing unterminated serial text is retained in raw capture and excluded from CSV.');
  if(!this.headerSeen)this.warnings.push('Expected Arduino CSV header was not observed.');
  if(!this.rows.length)this.warnings.push('No complete timestamped Arduino rows were captured.');
 }
 csv(){
  return (this.source==='SYNTHETIC'?'# SYNTHETIC SOFTWARE TEST ONLY - replayed stream; no hardware validation.':'# DEVICE_CAPTURE_UNVERIFIED')+'\n# Run ID: '+this.runId.replace(/[\r\n]/g,' ')+'\n# Capture status: '+(this.error?'INCOMPLETE / ERROR':'STOPPED')+'\n'+SERIAL_HEADER+'\n'+this.rows.join('\n')+'\n';
 }
 bundle(){
  return {schema:'sure2-serial-capture-1',run_id:this.runId,source:this.source,notes:this.notes,baud_rate:115200,started_utc:this.startedUTC,stopped_utc:this.stoppedUTC,
   captured_bytes:this.bytes,row_count:this.rows.length,repeated_headers:this.repeatedHeaders,error:this.error,warnings:[...this.warnings],events:structuredClone(this.events),sample_receipts:structuredClone(this.receipts),
   time_basis:'Device time_ms is loop-start uptime, rebased to the first row for elapsed time. UTC is host receipt/button time, not a synchronized acquisition timestamp.',
   raw_serial_text:this.raw,normalized_csv:this.csv()};
 }
}
export class SerialConnection {
 constructor({onChunk=()=>{},onError=()=>{},onEnd=()=>{}}={}){this.onChunk=onChunk;this.onError=onError;this.onEnd=onEnd;this.port=null;this.reader=null;this.task=null;this.stopping=false;}
 async connect(serial){
  if(this.port)throw Error('A serial port is already connected.');
  const port=await serial.requestPort();
  await port.open({baudRate:115200,dataBits:8,stopBits:1,parity:'none',flowControl:'none'});
  if(!port.readable){await port.close();throw Error('This port does not expose a readable stream.');}
  this.port=port;this.stopping=false;this.reader=port.readable.getReader();this.task=this.read();
 }
 async read(){
  const decoder=new TextDecoder();
  try{
   while(!this.stopping){const {value,done}=await this.reader.read();if(done)break;if(value)this.onChunk(decoder.decode(value,{stream:true}));}
   const tail=decoder.decode();if(tail)this.onChunk(tail);
  }catch(error){if(!this.stopping)this.onError(error);}
  finally{
   this.reader.releaseLock();this.reader=null;
   try{await this.port.close();}catch(error){this.onError(error);}
   this.port=null;this.onEnd();
  }
 }
 async csvMode(){
  if(!this.port?.writable)throw Error('Connect a writable serial port first.');
  const writer=this.port.writable.getWriter();
  try{await writer.write(new TextEncoder().encode('tc'));}finally{writer.releaseLock();}
 }
 async disconnect(){this.stopping=true;if(this.reader)await this.reader.cancel();if(this.task)await this.task;}
}
