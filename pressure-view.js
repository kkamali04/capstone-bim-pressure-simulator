import * as T from 'three';

const SQUARE_FEET_PER_SQUARE_METER = 1 / .09290304;
const TARGET_EDGE = Math.sqrt(2 / SQUARE_FEET_PER_SQUARE_METER);
const MAX_CELLS = 900;
const MAX_ROOM_TRIANGLES = 15000;
const PRESSURE_LIMIT = 5;
const ZERO_FLOW = 1e-7;
const NEUTRAL = new T.Color(0x829096);
const NEGATIVE = new T.Color(0x175bb3);
const POSITIVE = new T.Color(0xc24917);

export function pressureColor(value) {
  return NEUTRAL.clone().lerp(value < 0 ? NEGATIVE : POSITIVE, Math.min(Math.abs(value) / PRESSURE_LIMIT, 1));
}

function cellPositions(mesh, bounds, size, center) {
  let edge = TARGET_EDGE;
  const divisions = () => [size.x, size.y, size.z].map(length => Math.max(1, Math.ceil(length / edge)));
  let counts = divisions();
  while (counts[0] * counts[1] * counts[2] > MAX_CELLS) {
    edge *= 1.25;
    counts = divisions();
  }
  const [nx, ny, nz] = counts;
  const dx = size.x / nx, dy = size.y / ny, dz = size.z / nz;
  const positions = [];
  if (Math.min(dx, dy, dz) <= 1e-5 || mesh.userData.faces.length / 3 > MAX_ROOM_TRIANGLES) {
    return {positions, dx, dy, dz};
  }

  // Test against the full IFC room mesh. A cell's center and eight inset
  // corners must be inside. The inset keeps samples off shared mesh edges.
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(mesh.userData.raw, 3));
  geometry.setIndex(mesh.userData.faces);
  const probe = new T.Mesh(geometry, mesh.material);
  const ray = new T.Raycaster();
  ray.ray.direction.set(1, 0, 0);
  const epsilon = Math.max(1e-6, size.x * 1e-7);
  function crossings(y, z) {
    ray.ray.origin.set(bounds.min.x - Math.max(1, size.x), y, z);
    const hits = ray.intersectObject(probe);
    return hits.map(hit => hit.point.x).filter((x, i, all) => i === 0 || x - all[i - 1] > epsilon);
  }
  const inside = (x, hits) => hits.filter(hit => hit > x + epsilon).length % 2 === 1;
  for (let y = 0; y < ny; y++) {
    const cy = bounds.min.y + (y + .5) * dy;
    for (let z = 0; z < nz; z++) {
      const cz = bounds.min.z + (z + .5) * dz;
      const mid = crossings(cy, cz);
      const corners = [-.43, .43].flatMap(j => [-.43, .43].map(k => crossings(cy + j * dy, cz + k * dz)));
      for (let x = 0; x < nx; x++) {
        const cx = bounds.min.x + (x + .5) * dx;
        if (inside(cx, mid) && corners.every(hits => inside(cx - .43 * dx, hits) && inside(cx + .43 * dx, hits))) {
          positions.push(new T.Vector3(cx, cy, cz).sub(center));
        }
      }
    }
  }
  geometry.dispose();
  return {positions, dx, dy, dz};
}

function repeatGeometry(geometry, offsets) {
  const position = geometry.getAttribute('position');
  const vertices = new Float32Array(offsets.length * position.count * 3);
  let i = 0;
  for (const offset of offsets) {
    for (let v = 0; v < position.count; v++) {
      vertices[i++] = position.getX(v) + offset.x;
      vertices[i++] = position.getY(v) + offset.y;
      vertices[i++] = position.getZ(v) + offset.z;
    }
  }
  return new T.BufferGeometry().setAttribute('position', new T.BufferAttribute(vertices, 3));
}

export function pressureRoomView(room) {
  const {entity} = room.userData;
  const [min, max] = entity.bbox;
  const bounds = new T.Box3(new T.Vector3(min[0], min[2], -max[1]), new T.Vector3(max[0], max[2], -min[1]));
  const center = bounds.getCenter(new T.Vector3());
  const size = bounds.getSize(new T.Vector3());
  const {positions, dx, dy, dz} = cellPositions(room, bounds, size, center);
  const group = new T.Group();
  group.position.copy(center);
  const material = new T.MeshBasicMaterial({transparent:true, opacity:.19, depthWrite:false});
  const lineMaterial = new T.LineBasicMaterial({transparent:true, opacity:.43, depthWrite:false});
  const unit = new T.BoxGeometry(dx * .86, dy * .86, dz * .86);
  const faces = unit.toNonIndexed();
  const edges = new T.EdgesGeometry(unit);
  const byHeight = new Map();
  for (const position of positions) {
    if (!byHeight.has(position.y)) byHeight.set(position.y, []);
    byHeight.get(position.y).push(position);
  }
  const layers = Array.from(byHeight, ([height, offsets]) => {
    const layer = new T.Group();
    const cells = new T.Mesh(repeatGeometry(faces, offsets), material);
    const outlines = new T.LineSegments(repeatGeometry(edges, offsets), lineMaterial);
    cells.renderOrder = 1;
    outlines.renderOrder = 2;
    layer.add(cells, outlines);
    group.add(layer);
    return {layer, top:center.y + height + dy * .43, count:offsets.length};
  });
  faces.dispose();
  edges.dispose();
  unit.dispose();

  // The reference link is a lumped model term and has no geometric endpoint.
  // Place a symbolic arrow beside the selected room, above the floor grid.
  const length = Math.max(.55, Math.min(1.5, size.x * .32));
  const near = new T.Vector3(size.x / 2 + length * .12, 0, 0);
  const far = near.clone().add(new T.Vector3(length, 0, 0));
  const arrow = new T.Group();
  const headLength = length * .36;
  const shaftLength = length - headLength;
  const arrowMaterial = new T.MeshBasicMaterial({color:0x172d3d, depthTest:false, depthWrite:false});
  const shaft = new T.Mesh(new T.CylinderGeometry(length * .044, length * .044, shaftLength, 8), arrowMaterial);
  const head = new T.Mesh(new T.ConeGeometry(length * .13, headLength, 12), arrowMaterial);
  shaft.position.y = shaftLength / 2;
  head.position.y = shaftLength + headLength / 2;
  shaft.renderOrder = head.renderOrder = 3;
  arrow.add(shaft, head);
  const up = new T.Vector3(0, 1, 0);
  const outwardRotation = new T.Quaternion().setFromUnitVectors(up, new T.Vector3(1, 0, 0));
  const inwardRotation = new T.Quaternion().setFromUnitVectors(up, new T.Vector3(-1, 0, 0));
  group.add(arrow);

  return {
    group,
    bounds,
    cellCount:positions.length,
    visibleCells:positions.length,
    footprint:dx * dz * SQUARE_FEET_PER_SQUARE_METER,
    update(pressure, flow) {
      const color = pressureColor(pressure);
      material.color.copy(color);
      lineMaterial.color.copy(color).multiplyScalar(.72);
      arrow.userData.hasFlow = Math.abs(flow) > ZERO_FLOW;
      if (arrow.userData.hasFlow) {
        const outward = flow > 0;
        arrow.position.copy(outward ? near : far);
        arrow.quaternion.copy(outward ? outwardRotation : inwardRotation);
      }
      return arrow.userData.hasFlow ? flow > 0 ? 'outward' : 'inward' : 'near zero';
    },
    cut(limit, showCells) {
      this.visibleCells = 0;
      for (const {layer, top, count} of layers) {
        layer.visible = showCells && top <= limit + 1e-6;
        if (layer.visible) this.visibleCells += count;
      }
      arrow.visible = arrow.userData.hasFlow && center.y <= limit;
    },
    dispose() {
      for (const {layer} of layers) {
        for (const object of layer.children) object.geometry.dispose();
      }
      material.dispose();
      lineMaterial.dispose();
      shaft.geometry.dispose();
      head.geometry.dispose();
      arrowMaterial.dispose();
    }
  };
}
