import {mkdir,writeFile} from 'node:fs/promises';
const root=new URL('../recording-examples/',import.meta.url);
await mkdir(root,{recursive:true});
const header='time_ms,dp_a_pa,dp_b_pa,sht_temp_c,sht_rh_pct,bmp_abs_pa,bmp_temp_c,dp_a_ok,dp_b_ok,sht_ok,bmp_ok';
function brief(t){
  if(t<30)return -2;
  if(t<35)return -2+(t-30)*1.2;
  if(t<45)return 4;
  if(t<50)return 4-(t-45)*.9;
  if(t<100)return -.5;
  if(t<105)return -.5-(t-100)*.3;
  return -2;
}
for(const name of ['brief','sustained','gaps']){
  const rows=['# SYNTHETIC SOFTWARE TEST ONLY - not WBHT data or chamber measurements.','# DP A mux channel 0','# DP B absent',header];
  for(let t=0;t<=(name==='sustained'?240:180);t++){
    if(name==='gaps' && t>=65 && t<=72)continue;
    const invalid=name==='gaps' && (t>=38&&t<=42 || t>=105&&t<=110);
    const value=name==='sustained'?(t<30?-2:t<35?-2+(t-30)*1.2:4):brief(t);
    rows.push([t*1000,invalid?'':value.toFixed(3),'','25.000','40.000','','',invalid?0:1,0,1,0].join(','));
  }
  await writeFile(new URL(name+'_SYNTHETIC.csv',root),rows.join('\n')+'\n');
}

