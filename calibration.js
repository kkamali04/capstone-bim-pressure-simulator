import {checkConfig,solveNetwork} from './bim-engine.js';

// One identifiable scalar only: all reference leakage coefficients share a multiplier.
// Operating flows must already be known; this does not estimate fan dynamics or sensor offsets.
function prepare(config,runs){
 checkConfig(config);
 if(!Array.isArray(runs)||!runs.length)throw Error('Provide at least one named measurement run.');
 const ids=new Map(config.nodes.map((n,i)=>[n.id,i])),seenRuns=new Set,rows=[];let source;
 for(const run of runs){
  if(typeof run.run_id!=='string'||!run.run_id.trim()||seenRuns.has(run.run_id))throw Error('Runs need unique nonempty run_id values.');
  seenRuns.add(run.run_id);
  if(!['MEASURED','SIMULATED','IMPORTED_UNVERIFIED'].includes(run.source))throw Error('Run source must be explicit.');
  if(source&&source!==run.source)throw Error('Do not mix measured and simulated runs.');source=run.source;
  if(!Array.isArray(run.records)||!run.records.length)throw Error('Each run needs pressure records.');
  const keys=new Set;
  for(const r of run.records){
   const a=r.a??r.space_id,b=r.b??null,value=r.value??r.pressure_pa;
   if(!ids.has(a)||(b!==null&&!ids.has(b))||a===b||!Number.isFinite(value))throw Error('Invalid pressure endpoints or value.');
   if(r.source&&r.source!==run.source)throw Error('Record source disagrees with run provenance.');
   if(r.uncertainty_pa!==undefined&&(!Number.isFinite(r.uncertainty_pa)||r.uncertainty_pa<=0))throw Error('Pressure uncertainty must be positive.');
   const supply=r.supply??config.nodes.map(n=>n.supply),exhaust=r.exhaust??config.nodes.map(n=>n.exhaust);
   for(const flow of [supply,exhaust])if(!Array.isArray(flow)||flow.length!==config.nodes.length||flow.some(v=>!Number.isFinite(v)||v<0))throw Error('Operating flow arrays must match the network and contain nonnegative numbers.');
   if(r.time_s!==undefined&&(!Number.isFinite(r.time_s)||r.time_s<0))throw Error('Record time must be nonnegative.');
   if(r.time_s!==undefined){const key=[r.time_s,a,b].join(':');if(keys.has(key))throw Error('Duplicate pressure channel/time within run.');keys.add(key);}
   rows.push({run_id:run.run_id,a:ids.get(a),b:b===null?null:ids.get(b),value,weight:r.uncertainty_pa===undefined?1:1/r.uncertainty_pa**2,supply:[...supply],exhaust:[...exhaust]});
  }
 }
 return{rows,source,run_ids:[...seenRuns]};
}

function predict(config,rows,multiplier){
 if(!Number.isFinite(multiplier)||multiplier<=0)throw Error('Leak multiplier must be positive.');
 const local={...config,nodes:config.nodes.map(n=>({...n,leak:n.leak*multiplier}))},cache=new Map;
 return rows.map(r=>{const key=JSON.stringify([r.supply,r.exhaust]);if(!cache.has(key))cache.set(key,solveNetwork(local,r.supply,r.exhaust));const p=cache.get(key);return p[r.a]-(r.b===null?0:p[r.b]);});
}

function metrics(rows,predictions){
 const residuals=rows.map((r,i)=>r.value-predictions[i]),n=rows.length;
 return{n,bias_pa:residuals.reduce((s,r)=>s+r,0)/n,mae_pa:residuals.reduce((s,r)=>s+Math.abs(r),0)/n,rmse_pa:Math.sqrt(residuals.reduce((s,r)=>s+r*r,0)/n),max_abs_error_pa:Math.max(...residuals.map(Math.abs)),residual_convention:'observed minus predicted',residuals_pa:residuals};
}

export function evaluateReferenceLeak(config,runs,multiplier=1){
 const data=prepare(config,runs),predictions=predict(config,data.rows,multiplier);
 return{...metrics(data.rows,predictions),predictions_pa:predictions,run_ids:data.run_ids,source:data.source};
}

export function fitReferenceLeak(config,calibrationRuns,options={}){
 const data=prepare(config,calibrationRuns),min=options.min??.25,max=options.max??4;
 if(!Number.isFinite(min)||!Number.isFinite(max)||min<=0||max<=min)throw Error('Choose finite positive increasing fit bounds.');
 if(data.rows.length<2)throw Error('Calibration needs at least two pressure records.');
 const left=predict(config,data.rows,min),right=predict(config,data.rows,max);
 if(Math.max(...left.map((v,i)=>Math.abs(v-right[i])))<1e-5)throw Error('Reference leakage is not identifiable from these pressure channels and operating conditions.');
 let evaluations=0;
 const objective=m=>{evaluations++;const p=predict(config,data.rows,m);return data.rows.reduce((s,r,i)=>s+r.weight*(r.value-p[i])**2,0)/data.rows.reduce((s,r)=>s+r.weight,0);};
 // Coarse log grid avoids assuming a globally unimodal multi-zone residual surface.
 const grid=Array.from({length:33},(_,i)=>min*(max/min)**(i/32)),scores=grid.map(objective);
 const best=scores.indexOf(Math.min(...scores));let lo=grid[Math.max(0,best-1)],hi=grid[Math.min(32,best+1)];
 const ratio=(Math.sqrt(5)-1)/2;let a=hi-ratio*(hi-lo),b=lo+ratio*(hi-lo),fa=objective(a),fb=objective(b);
 for(let i=0;i<36;i++){if(fa<fb){hi=b;b=a;fb=fa;a=hi-ratio*(hi-lo);fa=objective(a);}else{lo=a;a=b;fa=fb;b=lo+ratio*(hi-lo);fb=objective(b);}}
 const candidates=[min,max,grid[best],(lo+hi)/2],costs=candidates.map(objective),multiplier=candidates[costs.indexOf(Math.min(...costs))];
 const atBoundary=Math.abs(multiplier-min)<1e-6||Math.abs(multiplier-max)<1e-6;
 return{parameter:'global_reference_leak_multiplier',multiplier,bounds:[min,max],at_boundary:atBoundary,evaluations,calibration:evaluateReferenceLeak(config,calibrationRuns,multiplier),baseline:evaluateReferenceLeak(config,calibrationRuns,1),limitations:['Fits one global leakage multiplier only; known operating flows, fixed internal connection coefficients and a common pressure reference are assumed.','No sensor calibration, lag fit, parameter covariance or confidence interval is inferred.','Successful synthetic recovery is software verification, not facility validation.',...(atBoundary?['Optimum reached a fit boundary; inspect assumptions before applying.']:[])]};
}

export function calibrateAndValidate(config,calibrationRuns,holdoutRuns,options={}){
 const train=prepare(config,calibrationRuns),test=prepare(config,holdoutRuns);
 if(train.source!==test.source)throw Error('Calibration and holdout must have the same explicit provenance.');
 if(test.run_ids.some(id=>train.run_ids.includes(id)))throw Error('Whole holdout runs must be separate from calibration runs.');
 const fit=fitReferenceLeak(config,calibrationRuns,options);
 return{...fit,holdout:evaluateReferenceLeak(config,holdoutRuns,fit.multiplier),holdout_baseline:evaluateReferenceLeak(config,holdoutRuns,1),validation_status:train.source==='SIMULATED'?'SYNTHETIC SOFTWARE CHECK':'HELD-OUT COMPARISON; acceptance criteria and reference traceability still require review'};
}

function baselineRun(records){
 if(!Array.isArray(records))throw Error('Provide baseline pressure records.');
 return[{run_id:'user-supplied-baseline',source:'IMPORTED_UNVERIFIED',records:records.map(r=>({space_id:r.id,pressure_pa:r.value,time_s:r.t}))}];
}
export function evaluate(config,records,scale=1){
 const result=evaluateReferenceLeak(config,baselineRun(records),scale);
 return{mae:result.mae_pa,rmse:result.rmse_pa,bias:result.bias_pa,n:result.n,predictions:result.predictions_pa,residuals:result.residuals_pa,source:result.source};
}
export function fitLeakScale(config,records,options={}){
 const fit=fitReferenceLeak(config,baselineRun(records),options);
 return{scale:fit.multiplier,...evaluate(config,records,fit.multiplier),atBoundary:fit.at_boundary,bounds:fit.bounds,limitations:[...fit.limitations,'Baseline steady-state readings only. Run timing, sensor offsets and transient dynamics are not fitted. Separate files do not establish independent experiments.']};
}
