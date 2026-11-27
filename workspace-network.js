import {chamberNetworkValues,CHAMBER_ID} from './chamber.js';
import {setup} from './bim-engine.js';
import {roomId, specFor} from './engineering.js';

export function buildWorkspaceNetwork(model) {
  const estimatedVolumes = new Set();
  const entities = model.entities.map(entity => {
    if (entity.class !== 'IfcSpace' || Number.isFinite(entity.volume_m3) && entity.volume_m3 > 0) return entity;
    const volume = entity.bbox?.[1]?.reduce((product, high, axis) => product * (high - entity.bbox[0][axis]), 1);
    if (Number.isFinite(volume) && volume > 0) {
      estimatedVolumes.add(entity.id);
      return {...entity, volume_m3: volume};
    }
    return entity;
  });
  const config = setup({...model, entities, candidate_links: Array.isArray(model.candidate_links) ? model.candidate_links : []});
  const ids = new Set(config.nodes.map(room => room.id));
  const reviewed = model.engineering?.connections ?? {};
  config.links = config.links.filter(link => !Object.hasOwn(reviewed, link.door_id));
  let referenceDoors = 0;
  for (const [door, connection] of Object.entries(reviewed)) {
    if (!ids.has(connection.from)) continue;
    if (connection.to === 'REFERENCE') {
      referenceDoors++;
      continue;
    }
    if (ids.has(connection.to)) {
      config.links.push({door_id: door, a: connection.from, b: connection.to, k: .006, enabled: true, reviewed: true});
    }
  }
  const groups = new Map();
  for (const entity of model.entities) {
    const room = roomId(model, entity);
    if (!ids.has(room)) continue;
    const spec = specFor(model, entity);
    if (!['supply', 'exhaust'].includes(spec.role)) continue;
    const key = JSON.stringify([room, spec.role]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(spec.operatingFlowM3h);
  }
  for (const room of config.nodes) {
    room.flowSource = {supply: 'Assumed', exhaust: 'Assumed'};
    room.volumeEstimated = estimatedVolumes.has(room.id);
    for (const role of ['supply', 'exhaust']) {
      const flows = groups.get(JSON.stringify([room.id, role]));
      if (flows?.length && flows.every(value => Number.isFinite(value) && value >= 0)) {
        room[role] = flows.reduce((sum, value) => sum + value, 0) / 3600;
        room.flowSource[role] = 'Entered equipment flow';
      }
    }
  }
  if(model.chamberSetup){
    if(config.nodes.length!==1||config.nodes[0].id!==CHAMBER_ID)throw Error('Chamber setup must contain exactly the CHAMBER pressure zone.');
    Object.assign(config.nodes[0],chamberNetworkValues(model.chamberSetup));
    config.nodes[0].flowSource={supply:'Entered chamber assumption',exhaust:'Entered chamber assumption'};
    config.basis='Schematic chamber; geometry evidence and assumed flows are stored in the project.';
  }
  config.referenceDoors = referenceDoors;
  if(!model.chamberSetup)config.basis = 'Room volumes and door endpoints from the project. Flow entries and demo assumptions are shown separately.';
  return config;
}
