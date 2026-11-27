import {captureBaseline,baselineMatches,makeTestPlan,runScheduledNetwork,reviewBoundary,boundaryCSV,scenarioReportHTML} from './hvac-test.js';
import {buildWorkspaceNetwork} from './workspace-network.js';
import {checkConfig, parseCSV, reversal, runNetwork, SCENARIOS, summarize} from './bim-engine.js';
import {compareBoundaries, parseBoundaryCSV, predictBoundary, REFERENCE} from './channels.js';
import {fitLeakScale, evaluate} from './calibration.js';
import {faultCandidates} from './engineering.js';

export function workspaceSimulation({getModel, overlay, download}) {
  const $ = id => document.getElementById(id);
  const panel = $('simulationPanel');
  const roomPicker = $('simulationRoom');
  let config = null;
  let frames = [];
  let observations = [];
  let recording = '';
  let run = null;
  let timer = null;
  let loadGeneration = 0;
  let comparison = null;
  let calibrationEvidence = null;
  let reviewedBaseline=null,testPlan=null,designBands={};


  function invalidateBaseline(message='Inputs changed. Capture the normal modeled state again.') {
    reviewedBaseline=null;
    $('simBaselineReview').textContent=message;
  }
  function fillBoundaryChoices() {
    const previous=$('simBoundaryNegative').value, second=$('simSecondRoom').value;
    $('simBoundaryNegative').replaceChildren(new Option('Fixed reference (0 Pa)',REFERENCE),
      ...(config?.nodes??[]).filter(n=>n.id!==roomPicker.value).map(n=>new Option(n.name,n.id)));
    if([...$('simBoundaryNegative').options].some(o=>o.value===previous))$('simBoundaryNegative').value=previous;
    $('simSecondRoom').replaceChildren(...(config?.nodes??[]).map(n=>new Option(n.name,n.id)));
    $('simSecondRoom').value=(config?.nodes.find(n=>n.id===second&&n.id!==roomPicker.value)??config?.nodes.find(n=>n.id!==roomPicker.value))?.id??roomPicker.value;
    $('simBoundaryNegative').disabled=$('simCaptureBaseline').disabled=!config?.nodes.length;
  }
  function syncTestMode() {
    const sequenced=$('simScenario').value==='sequenced',pattern=$('simTestPattern').value;
    $('simSequenceControls').hidden=!sequenced;
    $('simSecondRoomLabel').hidden=pattern!=='twoExhaust';
    $('simDelayFields').hidden=pattern!=='exhaustSupplyLag';
    $('simEnd').disabled=sequenced&&pattern==='sustainedExhaust';
  }
  function renderBaselineReview() {
    if(!reviewedBaseline)return;
    const row=reviewedBaseline.rooms.find(n=>n.id===roomPicker.value);
    if(!row)return;
    const band=row.entered_band;
    $('simBaselineReview').textContent='Reviewed modeled normal: '+row.pressure_pa.toFixed(3)+' Pa. '+
      (band?'Entered band '+band.min+' to '+band.max+' Pa: '+row.band_result.replaceAll('_',' ')+'. ':'No numeric design band supplied. ')+
      'Snapshot '+reviewedBaseline.captured_utc+'. Not measured calibration.';
  }
  function selectedBoundary() {
    return frames.length&&config?reviewBoundary(frames,config,roomPicker.value,$('simBoundaryNegative').value,run.threshold,reviewedBaseline):null;
  }
  function renderEventSchedule(plan) {
    $('simEventSchedule').replaceChildren();
    for(const event of plan?.events??[]){
      const item=document.createElement('li'),node=config.nodes.find(n=>n.id===event.node);
      item.textContent=node.name+' '+event.role+': '+(event.loss*100).toFixed(0)+'% loss at '+event.start+' s; '+
        (event.restore===null?'not restored within run':'restoration begins '+event.restore+' s')+'.';
      $('simEventSchedule').append(item);
    }
  }

  function pause() {
    clearInterval(timer);
    timer = null;
    $('simPlay').textContent = 'Play';
  }

  function clearRun() {
    pause();
    frames = [];
    testPlan=null;
    run = null;
    comparison = null;
    calibrationEvidence = null;
    $('simTimeline').value = 0;
    $('simPlay').disabled = true;
    $('simTimeline').disabled = true;
    $('simExport').disabled = true;
    $('simValidationExport').disabled = true;
    $('simBoundaryExport').disabled=$('simReportExport').disabled=true;
    $('simEventSchedule').replaceChildren();
    $('simSummary').replaceChildren();
    $('simFlows').replaceChildren();
    $('simFitResult').textContent = '';
    render();
  }

  function loadModel({preserveRecording = false} = {}) {
    loadGeneration++;
    const previous = roomPicker.value;
    if (!preserveRecording) {
      observations = [];
      recording = '';
      $('simRecording').textContent = 'No recording loaded.';
      for (const id of ['simCSV', 'simFitCSV', 'simHoldoutCSV']) $(id).value = '';
    }
    config = getModel() ? buildWorkspaceNetwork(getModel()) : null;
    designBands={};invalidateBaseline('No reviewed baseline captured for this model.');
    roomPicker.replaceChildren(...(config?.nodes ?? []).map(room => new Option(room.name, room.id)));
    if (config?.nodes.some(room => room.id === previous)) roomPicker.value = previous;
    $('openSimulation').disabled = !config;
    $('simRun').disabled = !config?.nodes.length;
    $('simConfirm').checked = false;
    $('simStatus').textContent = config?.nodes.length
      ? `${config.nodes.length} rooms and ${config.links.length} internal connections ready for input review.`
      : 'Open an IFC with room spaces to run a pressure scenario.';
    $('simExample').disabled = getModel()?.source?.name !== 'Duplex_A_20110907.ifc';
    fillBoundaryChoices();syncTestMode();clearRun();
    fillInputs();
  }

  function fillInputs() {
    fillBoundaryChoices();
    const node = config?.nodes.find(room => room.id === roomPicker.value);
    for (const [id, key, scale] of [['simSupply','supply',3600],['simExhaust','exhaust',3600],['simLeak','leak',1]]) {
      $(id).value = node ? Number((node[key] * scale).toPrecision(9)) : '';
      $(id).disabled = !node;
    }
    $('simBasis').textContent = node
      ? `Supply: ${node.flowSource.supply}. Exhaust: ${node.flowSource.exhaust}. Reference and door leakage start with demo coefficients.${node.volumeEstimated ? ' Room volume uses its bounding-box estimate.' : ''}`
      : '';
    $('simReferenceDoors').textContent = config?.referenceDoors
      ? `${config.referenceDoors} reviewed doors have a reference endpoint. Use the aggregate room leakage input for reference flow.`
      : '';
    const band=designBands[roomPicker.value];
    $('simBandMin').value=band?.min??'';$('simBandMax').value=band?.max??'';
    renderBaselineReview();
  }

  function setRoom(id) {
    if (!config?.nodes.some(room => room.id === id) || roomPicker.value === id) return;
    roomPicker.value = id;
    fillInputs();
    render();
  }

  function applyVisibleInputs() {
    const node=config?.nodes.find(n=>n.id===roomPicker.value);
    if(!node)throw Error('Select a pressure room.');
    for(const [id,key,scale] of [['simSupply','supply',3600],['simExhaust','exhaust',3600],['simLeak','leak',1]]){
      if(!$(id).checkValidity())throw Error('Review the visible room flow and leakage inputs.');
      const value=Number($(id).value)/scale;
      if(Math.abs(node[key]-value)>Math.max(1e-12,Math.abs(node[key])*1e-8)){
        node[key]=value;
        if(key!=='leak')node.flowSource[key]='Scenario edit';
        invalidateBaseline();
      }
    }
  }

  function saveInput(key, id, scale) {
    const node = config?.nodes.find(room => room.id === roomPicker.value);
    if (!node) return;
    const raw = $(id).value;
    const value = Number(raw) / scale;
    if (!raw.trim() || !Number.isFinite(value) || value < 0 || (key === 'leak' && value <= 0)) {
      invalidateBaseline();clearRun();
      $('simStatus').textContent = 'Enter a valid nonnegative flow and positive leakage.';
      return;
    }
    node[key] = value;
    if (key !== 'leak') node.flowSource[key] = 'Scenario edit';
    invalidateBaseline();
    clearRun();
    fillInputs();
    $('simStatus').textContent = 'Input updated. Run again to refresh the results.';
  }

  function renderPlot(index,boundary) {
    const canvas=$('simChart'),context=canvas.getContext('2d'),width=canvas.width,height=canvas.height;
    context.clearRect(0,0,width,height);
    if(!frames.length||index<0||!boundary)return;
    const duration=frames.at(-1).t;
    const points=observations.filter(row=>row.positive===roomPicker.value&&row.negative===$('simBoundaryNegative').value&&row.t<=duration);
    const values=boundary.points.map(point=>point.value);
    if(run?.scenario==='sensor')values.push(...frames.map(frame=>predictBoundary({p:frame.sensor},config,boundary.positive,boundary.negative)));
    const low=Math.min(-1,boundary.baseline_pa,...values,...points.map(row=>row.value));
    const high=Math.max(1,boundary.threshold_pa,boundary.baseline_pa,...values,...points.map(row=>row.value));
    const x=time=>45+time/(duration||1)*(width-57),y=pressure=>12+(high-pressure)/(high-low)*(height-37);
    context.font='12px system-ui';context.fillStyle='#53625a';
    for(let i=0;i<=4;i++){
      const pressure=low+(high-low)*i/4;
      context.strokeStyle='#d8dfd8';context.beginPath();context.moveTo(x(0),y(pressure));context.lineTo(x(duration),y(pressure));context.stroke();
      context.fillText(pressure.toFixed(1),2,y(pressure)+4);
      const t=duration*i/4;context.fillText(t.toFixed(0)+'s',x(t)-9,height-7);
    }
    for(const [pressure,color] of [[boundary.baseline_pa,'#7b8a89'],[boundary.threshold_pa,'#b15236']]){
      context.setLineDash([4,3]);context.strokeStyle=color;context.beginPath();context.moveTo(x(0),y(pressure));context.lineTo(x(duration),y(pressure));context.stroke();context.setLineDash([]);
    }
    function trace(values,color){
      context.strokeStyle=color;context.lineWidth=2;context.beginPath();
      values.forEach((value,i)=>{if(i===0)context.moveTo(x(frames[i].t),y(value));else context.lineTo(x(frames[i].t),y(value));});context.stroke();
    }
    trace(boundary.points.map(p=>p.value),'#176655');
    if(run?.scenario==='sensor')trace(frames.map(frame=>predictBoundary({p:frame.sensor},config,boundary.positive,boundary.negative)),'#7553a1');
    context.fillStyle='#a65a10';
    for(const point of points){context.beginPath();context.arc(x(point.t),y(point.value),3,0,Math.PI*2);context.fill();}
    const markers=testPlan?.events.flatMap(e=>[e.start,e.restore].filter(t=>t!==null))??[run.start,run.end];
    context.strokeStyle='#bfafa1';context.setLineDash([2,4]);
    for(const time of markers){if(time<0||time>duration)continue;context.beginPath();context.moveTo(x(time),10);context.lineTo(x(time),height-24);context.stroke();}
    context.setLineDash([]);context.strokeStyle='#53625a';context.lineWidth=1;
    const time=frames[Number($('simTimeline').value)].t;
    context.beginPath();context.moveTo(x(time),10);context.lineTo(x(time),height-24);context.stroke();
  }

  function render() {
    const index = config?.nodes.findIndex(node => node.id === roomPicker.value) ?? -1;
    const frame = frames[Number($('simTimeline').value)];
    const visible = !panel.hidden && frame && index >= 0;
    const focusRoom = visible ? config.nodes[index] : null;
    for (const id of ['simVoxels', 'simContext', 'simFocus']) $(id).disabled = !visible;
    overlay(focusRoom ? {
      id: focusRoom.id,
      name: focusRoom.name,
      pressure: frame.p[index],
      flow: frame.referenceFlows[index],
      showCells: $('simVoxels').checked,
      showBuilding: $('simContext').checked
    } : null);
    const pressure = frame?.p[index];
    const baseline = frames[0]?.p[index];
    const format = value => Number.isFinite(value) ? value.toFixed(2) + ' Pa' : '—';
    $('simTime').textContent = frame ? frame.t.toFixed(1) + ' s' : '0.0 s';
    $('simPressure').textContent = format(pressure);
    $('simBaseline').textContent = format(baseline);
    $('simChange').textContent = format(pressure - baseline);
    const stats = frame && index >= 0 ? reversal(frames, index, run.threshold) : null;
    $('simPeak').textContent = format(stats?.peak);
    $('simDuration').textContent = stats ? stats.duration.toFixed(1) + ' s' : '—';
    $('simResidual').textContent = frame ? frame.residual.toExponential(2) + ' m³/s' : '—';
    const flows = $('simFlows');
    flows.replaceChildren();
    if (frame && index >= 0 && $('simFlowDetails').open) {
      for (const [i, link] of config.links.entries()) {
        if (link.a !== roomPicker.value && link.b !== roomPicker.value) continue;
        const value = frame.flows[i];
        const name = id => config.nodes.find(node => node.id === id).name;
        const item = document.createElement('li');
        item.textContent = `${name(value >= 0 ? link.a : link.b)} → ${name(value >= 0 ? link.b : link.a)} · ${(Math.abs(value) * 3600).toFixed(1)} m³/h`;
        flows.append(item);
      }
    }
    const hints = $('simEvidence');
    hints.replaceChildren();
    if ($('simEvidenceDetails').open) {
      const model = getModel();
      const room = model?.entities.find(entity => entity.id === roomPicker.value);
      if (room) {
        for (const candidate of faultCandidates(model, room)) {
          const item = document.createElement('li');
          item.textContent = candidate.name + ' · ' + candidate.evidence;
          hints.append(item);
        }
      }
    }
    $('simComparison').textContent = comparison
      ? comparison.count
        ? `MAE ${comparison.mae.toFixed(3)} Pa · RMSE ${comparison.rmse.toFixed(3)} Pa · ${comparison.count} matched · ${comparison.unmatched.length} unmatched.`
        : 'No readings align with the simulated time range.'
      : recording ? 'Run a scenario to compare the recording.' : 'Load a recording to compare simulated and observed pressure.';
    const boundary=selectedBoundary();
    $('simBoundaryNow').textContent=boundary&&frame?format(predictBoundary(frame,config,boundary.positive,boundary.negative)):'—';
    $('simBoundaryNormal').textContent=format(boundary?.baseline_pa);
    $('simBoundaryPeak').textContent=format(boundary?.peak_pa);
    $('simBoundaryTime').textContent=boundary?boundary.above_threshold_s.toFixed(2)+' s':'—';
    $('simBoundaryBasis').textContent=boundary?'Chart: '+(config.nodes.find(n=>n.id===boundary.positive)?.name??boundary.positive)+' minus '+(config.nodes.find(n=>n.id===boundary.negative)?.name??'fixed reference')+'. '+boundary.connection.replaceAll('_',' ')+'. Cells retain room-to-fixed-reference pressure.':'The chart follows this pressure pair. 3D cells retain room-to-fixed-reference pressure.';
    renderBaselineReview();renderPlot(index,boundary);
  }

  function compare() {
    comparison = frames.length && observations.length ? compareBoundaries(frames, config, observations) : null;
    render();
  }

  function setRecording(text, label) {
    const ids = config.nodes.map(node => node.id);
    const rows = text.trimStart().startsWith('time_s,positive_space_id,negative_space_id,pressure_pa')
      ? parseBoundaryCSV(text, ids)
      : parseCSV(text, ids).map(row => ({t: row.t, positive: row.id, negative: REFERENCE, value: row.value}));
    observations = rows;
    recording = label;
    $('simRecording').textContent = `${label} · ${rows.length} readings.`;
    compare();
  }

  function open(show) {
    panel.hidden = !show;
    $('engineeringPane').hidden = show;
    $('openSimulation').classList.toggle('primary', show);
    $('openSimulation').setAttribute('aria-pressed', String(show));
    $('simPlayback').hidden = !show;
    if (!show) pause();
    render();
  }

  $('openSimulation').onclick = () => open(panel.hidden);
  $('simInspect').onclick = () => open(false);
  roomPicker.onchange = () => { fillInputs(); render(); };
  for (const [id, key, scale] of [['simSupply','supply',3600],['simExhaust','exhaust',3600],['simLeak','leak',1]]) {
    $(id).onchange = () => saveInput(key,id,scale);
    $(id).oninput = () => {invalidateBaseline('Flow input edited. Capture normal modeled operation again.');clearRun();};
  }
  for (const id of ['simScenario','simSeverity','simStart','simEnd','simThreshold','simConfirm','simHorizon','simRamp','simTestPattern','simSecondRoom','simSupplyDelay','simRestoreDelay']) {
    const invalidateScenario = () => {
      if(id==='simScenario'&&$('simScenario').value==='sequenced'){if(Number($('simHorizon').value)===60)$('simHorizon').value=180;if(Number($('simThreshold').value)===.2)$('simThreshold').value=2.5;}
      syncTestMode();
      if (frames.length) {
        clearRun();
        $('simStatus').textContent = 'Scenario controls changed. Run again.';
      }
    };
    $(id).onchange=invalidateScenario;
    if($(id).tagName==='INPUT')$(id).oninput=invalidateScenario;
  }
  $('simCaptureBaseline').onclick=()=>{
    try{
      if(!$('simConfirm').checked)throw Error('Review the network inputs and check the review box before capturing a baseline.');
      applyVisibleInputs();
      const min=$('simBandMin').value.trim(),max=$('simBandMax').value.trim(),id=roomPicker.value;
      if(Boolean(min)!==Boolean(max))throw Error('Enter both design-band bounds, or leave both empty.');
      if(min)designBands[id]={min:Number(min),max:Number(max)};else delete designBands[id];
      reviewedBaseline=captureBaseline({...config,approved:true},{designIntent:$('simDesignIntent').value,reviewer:$('simReviewer').value,bands:designBands});
      renderBaselineReview();
      $('simStatus').textContent='Normal modeled operation captured. Select the failure sequence and run the test.';
    }catch(error){invalidateBaseline(error.message);}
  };
  $('simRun').onclick=()=>{
    try{
      if(!$('simConfirm').checked)throw Error('Review the network inputs and confirm they are suitable for this demo.');
      const ids=['simSupply','simExhaust','simLeak','simSeverity','simStart','simThreshold','simHorizon','simRamp'];
      if(!$('simEnd').disabled)ids.push('simEnd');
      if(ids.some(id=>!$(id).checkValidity()))throw Error('Check required inputs and their allowed ranges.');
      applyVisibleInputs();
      const scenario=$('simScenario').value,target=config.nodes.findIndex(n=>n.id===roomPicker.value),severity=Number($('simSeverity').value)/100;
      const options={start:Number($('simStart').value),end:Number($('simEnd').value),threshold:Number($('simThreshold').value),duration:Number($('simHorizon').value),tau:Number($('simRamp').value)};
      let nextPlan=null,nextFrames;
      if(scenario==='sequenced'){
        if(!baselineMatches(reviewedBaseline,config))throw Error('Capture a reviewed baseline for the current inputs before running a sequence.');
        nextPlan=makeTestPlan({...config,approved:true},{pattern:$('simTestPattern').value,target,
          secondTarget:config.nodes.findIndex(n=>n.id===$('simSecondRoom').value),start:options.start,restore:options.end,severity,
          delay:Number($('simSupplyDelay').value),restoreDelay:Number($('simRestoreDelay').value),duration:options.duration,tau:options.tau});
        nextFrames=runScheduledNetwork({...config,approved:true},nextPlan);
      }else nextFrames=runNetwork({...config,approved:true},scenario,target,severity,options);
      clearRun();frames=nextFrames;testPlan=nextPlan;run={scenario,target,severity,...options};
      $('simTimeline').max=frames.length-1;
      for(const id of ['simTimeline','simPlay','simExport','simValidationExport','simBoundaryExport','simReportExport'])$(id).disabled=false;
      $('simStatus').textContent=(nextPlan?.title??SCENARIOS[scenario])+' · target '+config.nodes[target].name+' · '+frames.at(-1).t+' s · SYNTHETIC model output.';
      for(const row of summarize(frames,config,run.threshold)){
        const item=document.createElement('li');
        item.textContent=row.name+' · max change '+row.maxChange.toFixed(2)+' Pa · above threshold '+row.duration.toFixed(1)+' s';
        $('simSummary').append(item);
      }
      renderEventSchedule(testPlan);compare();
    }catch(error){$('simStatus').textContent=error.message;}
  };

  $('simTimeline').oninput = render;
  $('simVoxels').onchange = render;
  $('simContext').onchange = render;
  $('simFlowDetails').ontoggle = render;
  $('simEvidenceDetails').ontoggle = render;
  $('simPlay').onclick = () => {
    if (timer) { pause(); return; }
    if (Number($('simTimeline').value) >= frames.length - 1) $('simTimeline').value = 0;
    $('simPlay').textContent = 'Pause';
    render();
    timer = setInterval(() => {
      const next = Number($('simTimeline').value) + 1;
      $('simTimeline').value = next;
      render();
      if (next >= frames.length - 1) pause();
    }, 500);
  };
  $('simCSV').onchange = async event => {
    const file = event.target.files[0];
    if (!file) return;
    const generation = ++loadGeneration;
    try {
      if (file.size > 500000) throw Error('Use a CSV under 500 KB.');
      const text = await file.text();
      if (generation !== loadGeneration) return;
      setRecording(text, 'Imported · ' + file.name);
    } catch (error) {
      if (generation === loadGeneration) $('simRecording').textContent = error.message;
    } finally { event.target.value = ''; }
  };
  $('simExample').onclick = async () => {
    const generation = ++loadGeneration;
    try {
      const response = await fetch('./models/example_sensor_SYNTHETIC.csv');
      if (!response.ok) throw Error('Example recording could not be loaded.');
      const text = await response.text();
      if (generation !== loadGeneration) return;
      setRecording(text, 'Synthetic example');
      setRoom(observations[0].positive);
    } catch (error) {
      if (generation === loadGeneration) $('simRecording').textContent = error.message;
    }
  };
  $('simExport').onclick = () => {
    const rows = ['time_s,space_id,pressure_pa,synthetic_sensor_pa,supply_m3s,exhaust_m3s'];
    const csvCell = value => /[",\r\n]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value;
    frames.forEach(frame => config.nodes.forEach((node,i) => {
      rows.push([frame.t,csvCell(node.id),frame.p[i],frame.sensor[i],frame.supply[i],frame.exhaust[i]].join(','));
    }));
    download('Sure2_Simulated_Run.csv', rows.join('\n'), 'text/csv');
  };
  $('simValidationExport').onclick = () => {
    download('Sure2_Run_Evidence.json', JSON.stringify({
      source:getModel().source, dataSource:'SYNTHETIC', modelOutputSource:'SYNTHETIC', recordingSource:recording==='Synthetic example'?'SYNTHETIC':recording?'IMPORTED_UNVERIFIED':null, reviewedBaseline, testPlan, boundaryReview:selectedBoundary(), run, config, recording, comparison, calibrationEvidence,
      roomSummary:summarize(frames,config,run.threshold)
    },null,2));
  };
  $('simFit').onclick = async () => {
    const generation = loadGeneration;
    const active = config;
    const inputSnapshot = JSON.stringify(active);
    try {
      const first = $('simFitCSV').files[0], second = $('simHoldoutCSV').files[0];
      if (!first || !second) throw Error('Select separate calibration and holdout recordings.');
      if (first.size > 500000 || second.size > 500000) throw Error('Use CSVs under 500 KB each.');
      const [fitText, holdoutText] = await Promise.all([first.text(),second.text()]);
      if (generation !== loadGeneration || config !== active || JSON.stringify(active) !== inputSnapshot) return;
      if (fitText.trim() === holdoutText.trim()) throw Error('Calibration and holdout must be distinct runs.');
      const approved = {...active,approved:true};
      checkConfig(approved);
      const ids = active.nodes.map(node => node.id);
      const fit = fitLeakScale(approved,parseCSV(fitText,ids));
      const holdout = evaluate(approved,parseCSV(holdoutText,ids),fit.scale);
      calibrationEvidence = {fit, holdout, fitFile:first.name, holdoutFile:second.name};
      $('simFitResult').textContent = `Reference leakage multiplier ${fit.scale.toFixed(3)} · holdout MAE ${holdout.mae.toFixed(3)} Pa. The scenario inputs are unchanged until you edit them.`;
    } catch (error) {
      if (generation === loadGeneration) $('simFitResult').textContent = error.message;
    }
  };

  $('simBoundaryNegative').onchange=render;
  for(const id of ['simDesignIntent','simReviewer','simBandMin','simBandMax'])$(id).oninput=()=>{
    invalidateBaseline();clearRun();
  };
  $('simBoundaryExport').onclick=()=>{
    const review=selectedBoundary();
    if(review)download('Sure2_Boundary_SYNTHETIC.csv',boundaryCSV(review),'text/csv');
  };
  $('simReportExport').onclick=()=>{
    const review=selectedBoundary();
    if(review)download('Sure2_Simulated_HVAC_Test.html',scenarioReportHTML({baseline:reviewedBaseline,plan:testPlan,review,modelName:getModel().source.name,run,comparison}),'text/html');
  };

  return {loadModel,setRoom};
}
