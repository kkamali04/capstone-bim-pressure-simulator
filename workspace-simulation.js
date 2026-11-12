import {buildWorkspaceNetwork} from './workspace-network.js';
import {checkConfig, parseCSV, reversal, runNetwork, SCENARIOS, summarize} from './bim-engine.js';
import {compareBoundaries, parseBoundaryCSV, REFERENCE} from './channels.js';
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

  function pause() {
    clearInterval(timer);
    timer = null;
    $('simPlay').textContent = 'Play';
  }

  function clearRun() {
    pause();
    frames = [];
    run = null;
    comparison = null;
    calibrationEvidence = null;
    $('simTimeline').value = 0;
    $('simPlay').disabled = true;
    $('simTimeline').disabled = true;
    $('simExport').disabled = true;
    $('simValidationExport').disabled = true;
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
    roomPicker.replaceChildren(...(config?.nodes ?? []).map(room => new Option(room.name, room.id)));
    if (config?.nodes.some(room => room.id === previous)) roomPicker.value = previous;
    $('openSimulation').disabled = !config;
    $('simRun').disabled = !config?.nodes.length;
    $('simConfirm').checked = false;
    $('simStatus').textContent = config?.nodes.length
      ? `${config.nodes.length} rooms and ${config.links.length} internal connections ready for input review.`
      : 'Open an IFC with room spaces to run a pressure scenario.';
    $('simExample').disabled = getModel()?.source?.name !== 'Duplex_A_20110907.ifc';
    clearRun();
    fillInputs();
  }

  function fillInputs() {
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
  }

  function setRoom(id) {
    if (!config?.nodes.some(room => room.id === id) || roomPicker.value === id) return;
    roomPicker.value = id;
    fillInputs();
    render();
  }

  function saveInput(key, id, scale) {
    const node = config?.nodes.find(room => room.id === roomPicker.value);
    if (!node) return;
    const raw = $(id).value;
    const value = Number(raw) / scale;
    if (!raw.trim() || !Number.isFinite(value) || value < 0 || (key === 'leak' && value <= 0)) {
      $('simStatus').textContent = 'Enter a valid nonnegative flow and positive leakage.';
      return;
    }
    node[key] = value;
    if (key !== 'leak') node.flowSource[key] = 'Scenario edit';
    clearRun();
    fillInputs();
    $('simStatus').textContent = 'Input updated. Run again to refresh the results.';
  }

  function renderPlot(index) {
    const canvas = $('simChart');
    const context = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    context.clearRect(0,0,width,height);
    if (!frames.length || index < 0) return;
    const points = observations.filter(row => row.positive === roomPicker.value && row.negative === REFERENCE && row.t <= 60);
    const values = frames.map(frame => frame.p[index]);
    if (run?.scenario === 'sensor') values.push(...frames.map(frame => frame.sensor[index]));
    const low = Math.min(-1, ...values, ...points.map(row => row.value));
    const high = Math.max(1, ...values, ...points.map(row => row.value));
    const x = time => 45 + time / 60 * (width - 57);
    const y = pressure => 12 + (high - pressure) / (high - low) * (height - 37);
    context.font = '12px system-ui';
    context.fillStyle = '#53625a';
    for (let i = 0; i <= 4; i++) {
      const pressure = low + (high - low) * i / 4;
      context.strokeStyle = '#d8dfd8';
      context.beginPath();
      context.moveTo(x(0), y(pressure));
      context.lineTo(x(60), y(pressure));
      context.stroke();
      context.fillText(pressure.toFixed(1), 2, y(pressure) + 4);
    }
    for (let t = 0; t <= 60; t += 15) context.fillText(t + 's', x(t) - 9, height - 7);
    function trace(key, color) {
      context.strokeStyle = color;
      context.lineWidth = 2;
      context.beginPath();
      frames.forEach((frame, i) => {
        if (i === 0) context.moveTo(x(frame.t), y(frame[key][index]));
        else context.lineTo(x(frame.t), y(frame[key][index]));
      });
      context.stroke();
    }
    trace('p', '#176655');
    if (run?.scenario === 'sensor') trace('sensor', '#7553a1');
    context.fillStyle = '#a65a10';
    for (const point of points) {
      context.beginPath();
      context.arc(x(point.t), y(point.value), 3, 0, Math.PI * 2);
      context.fill();
    }
    context.strokeStyle = '#53625a';
    context.lineWidth = 1;
    const time = frames[Number($('simTimeline').value)].t;
    context.beginPath();
    context.moveTo(x(time), 10);
    context.lineTo(x(time), height - 24);
    context.stroke();
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
    renderPlot(index);
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
  }
  for (const id of ['simScenario','simSeverity','simStart','simEnd','simThreshold','simConfirm']) {
    $(id).onchange = () => {
      if (frames.length) {
        clearRun();
        $('simStatus').textContent = 'Scenario controls changed. Run again.';
      }
    };
  }
  $('simRun').onclick = () => {
    try {
      if (!$('simConfirm').checked) throw Error('Review the network inputs and confirm they are suitable for this demo.');
      if (['simSupply','simExhaust','simLeak','simSeverity','simStart','simEnd','simThreshold'].some(id => !$(id).checkValidity())) {
        throw Error('Check the required inputs and their allowed ranges.');
      }
      const scenario = $('simScenario').value;
      const target = config.nodes.findIndex(node => node.id === roomPicker.value);
      const severity = Number($('simSeverity').value) / 100;
      const options = {start:Number($('simStart').value),end:Number($('simEnd').value),threshold:Number($('simThreshold').value)};
      const nextFrames = runNetwork({...config, approved:true}, scenario, target, severity, options);
      clearRun();
      frames = nextFrames;
      run = {scenario,target,severity,...options};
      $('simTimeline').max = frames.length - 1;
      for (const id of ['simTimeline','simPlay','simExport','simValidationExport']) $(id).disabled = false;
      $('simStatus').textContent = `${SCENARIOS[scenario]} · target ${config.nodes[target].name} · ${frames.length} simulated samples.`;
      for (const row of summarize(frames,config,run.threshold)) {
        const item = document.createElement('li');
        item.textContent = `${row.name} · max change ${row.maxChange.toFixed(2)} Pa · above threshold ${row.duration.toFixed(1)} s`;
        $('simSummary').append(item);
      }
      compare();
    } catch (error) { $('simStatus').textContent = error.message; }
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
      source:getModel().source, run, config, recording, comparison, calibrationEvidence,
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
  return {loadModel,setRoom};
}
