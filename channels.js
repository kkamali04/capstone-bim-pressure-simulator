// Differential pressures are signed: pressure at the positive port minus pressure
// at the negative port. REFERENCE denotes the solver's fixed 0 Pa reference.
export const REFERENCE = 'REFERENCE';

function spaceIndex(ids) {
  if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string' || !id || id === REFERENCE) || new Set(ids).size !== ids.length)
    throw Error('Pressure channel mapping needs unique, nonempty space IDs.');
  return new Map(ids.map((id, i) => [id, i]));
}

function validateRow(row, index) {
  if (!row || !Number.isFinite(row.t) || row.t < 0 || !Number.isFinite(row.value)) throw Error('Invalid channel time or pressure.');
  if (!index.has(row.positive) || (row.negative !== REFERENCE && !index.has(row.negative)) || row.positive === row.negative)
    throw Error('Invalid positive/negative pressure channel space IDs.');
}

export function parseBoundaryCSV(text, ids) {
  const index = spaceIndex(ids);
  if (typeof text !== 'string') throw Error('Expected boundary CSV text.');
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  if (lines.length < 2 || lines[0].trim() !== 'time_s,positive_space_id,negative_space_id,pressure_pa')
    throw Error('CSV header must be time_s,positive_space_id,negative_space_id,pressure_pa');
  const seen = new Set();
  return lines.slice(1).map((line, i) => {
    const cells = line.split(',').map(v => v.trim());
    if (cells.length !== 4 || cells.some(v => !v)) throw Error('Invalid boundary CSV row ' + (i + 2));
    const row = {t: Number(cells[0]), positive: cells[1], negative: cells[2], value: Number(cells[3])};
    validateRow(row, index);
    const key = JSON.stringify([row.t, row.positive, row.negative]);
    if (seen.has(key)) throw Error('Duplicate channel timestamp at row ' + (i + 2));
    seen.add(key);
    return row;
  }).sort((a, b) => a.t - b.t);
}

export function predictBoundary(frame, config, positive, negative) {
  const index = spaceIndex(config?.nodes?.map(n => n.id));
  validateRow({t: 0, value: 0, positive, negative}, index);
  if (!Array.isArray(frame?.p) || frame.p.length !== index.size || frame.p.some(p => !Number.isFinite(p))) throw Error('Invalid modeled frame pressures.');
  return frame.p[index.get(positive)] - (negative === REFERENCE ? 0 : frame.p[index.get(negative)]);
}

function metrics(pairs) {
  const n = pairs.length;
  return {count: n, bias: n ? pairs.reduce((s, p) => s + p.residual, 0) / n : null,
    mae: n ? pairs.reduce((s, p) => s + Math.abs(p.residual), 0) / n : null,
    rmse: n ? Math.sqrt(pairs.reduce((s, p) => s + p.residual ** 2, 0) / n) : null,
    maxAbs: n ? Math.max(...pairs.map(p => Math.abs(p.residual))) : null};
}

// Nearest modeled timestamp, within tolerance. Out-of-range samples stay unmatched;
// this does not silently interpolate, extrapolate, or treat missing data as zero.
export function compareBoundaries(frames, config, rows, options = {}) {
  const index = spaceIndex(config?.nodes?.map(n => n.id));
  const tolerance = options.tolerance ?? 0.25;
  if (!Number.isFinite(tolerance) || tolerance < 0) throw Error('Invalid time matching tolerance.');
  if (!Array.isArray(frames) || !frames.length || !Array.isArray(rows)) throw Error('Expected modeled frames and boundary readings.');
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    if (!Number.isFinite(frame.t) || frame.t < 0 || (i && frame.t <= frames[i - 1].t) || !Array.isArray(frame.p) || frame.p.length !== index.size || frame.p.some(p => !Number.isFinite(p)))
      throw Error('Modeled frames need strictly increasing finite times and finite pressures.');
  }
  const pairs = [], unmatched = [], seen = new Set();
  for (const row of rows) {
    validateRow(row, index);
    const key = JSON.stringify([row.t, row.positive, row.negative]);
    if (seen.has(key)) throw Error('Duplicate channel timestamp.');
    seen.add(key);
    if (row.t < frames[0].t || row.t > frames.at(-1).t) { unmatched.push({...row, reason: 'Outside modeled time range'}); continue; }
    let lo = 0, hi = frames.length - 1;
    while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (frames[mid].t < row.t) lo = mid + 1; else hi = mid; }
    const frame = lo > 0 && row.t - frames[lo - 1].t <= frames[lo].t - row.t ? frames[lo - 1] : frames[lo];
    if (Math.abs(frame.t - row.t) > tolerance) { unmatched.push({...row, reason: 'No modeled timestamp within tolerance'}); continue; }
    const predicted = frame.p[index.get(row.positive)] - (row.negative === REFERENCE ? 0 : frame.p[index.get(row.negative)]);
    pairs.push({...row, predicted, residual: row.value - predicted, frameTime: frame.t});
  }
  const groups = new Map();
  for (const pair of pairs) { const key = JSON.stringify([pair.positive, pair.negative]); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(pair); }
  const channels = [...groups.values()].map(group => ({positive: group[0].positive, negative: group[0].negative, ...metrics(group)}));
  return {...metrics(pairs), unmatched, pairs, channels, tolerance, residualBasis: 'Imported pressure minus predicted positive-port minus negative-port pressure, in Pa.'};
}
