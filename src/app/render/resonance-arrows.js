/** @module app/render/resonance-arrows */

export const RESONANCE_ELECTRON_FLOW_PROPERTY = 'resonanceElectronFlow';
const RESONANCE_ARROW_COLOR = '#111111';
const BOND_ENDPOINT_OFFSET = 8;
const ATOM_LABEL_CLEARANCE = 16;

function stateBondOrder(bond, state) {
  return bond?.properties?.resonance?.states?.[state]?.order ?? bond?.properties?.resonance?.states?.[1]?.order ?? bond?.properties?.localizedOrder ?? bond?.properties?.order ?? 1;
}

function stateAtomCharge(atom, state) {
  return atom?.properties?.resonance?.states?.[state]?.charge ?? atom?.properties?.resonance?.states?.[1]?.charge ?? atom?.properties?.charge ?? 0;
}

function endpointAtomIds(item) {
  if (item.kind === 'atom') {
    return [item.atomId];
  }
  return item.atomIds ?? [];
}

function sharedEndpointCount(source, sink) {
  const sourceIds = new Set(endpointAtomIds(source));
  return endpointAtomIds(sink).filter(atomId => sourceIds.has(atomId)).length;
}

function atomDistanceScore(source, sink, molecule) {
  const sourceIds = endpointAtomIds(source);
  const sinkIds = endpointAtomIds(sink);
  let best = Number.POSITIVE_INFINITY;
  for (const sourceId of sourceIds) {
    const sourceAtom = molecule.atoms.get(sourceId);
    if (!sourceAtom) {
      continue;
    }
    for (const sinkId of sinkIds) {
      const sinkAtom = molecule.atoms.get(sinkId);
      if (!sinkAtom) {
        continue;
      }
      if (sourceId === sinkId) {
        best = Math.min(best, 0);
        continue;
      }
      if (molecule.getBond?.(sourceId, sinkId)) {
        best = Math.min(best, 1);
        continue;
      }
      if (sourceAtom.x != null && sourceAtom.y != null && sinkAtom.x != null && sinkAtom.y != null) {
        best = Math.min(best, 2 + Math.hypot(sourceAtom.x - sinkAtom.x, sourceAtom.y - sinkAtom.y));
      }
    }
  }
  return Number.isFinite(best) ? best : 999;
}

function pairScore(source, sink, molecule) {
  if (source.kind === 'atom' && sink.kind === 'atom') {
    return Number.POSITIVE_INFINITY;
  }
  const shared = sharedEndpointCount(source, sink);
  if (shared === 0) {
    return Number.POSITIVE_INFINITY;
  }
  let kindBias = source.kind === 'bond' && sink.kind === 'bond' ? 0 : 0.25;
  if (source.kind === 'atom' && sink.kind === 'bond' && sink.atomIds?.includes(source.atomId)) {
    kindBias = -6;
  } else if (source.kind === 'bond' && sink.kind === 'atom' && source.atomIds?.includes(sink.atomId)) {
    kindBias = -6;
  }
  return kindBias + atomDistanceScore(source, sink, molecule);
}

function endpointForSourceOrSink(item) {
  if (item.kind === 'atom') {
    return { kind: 'atom', atomId: item.atomId };
  }
  return { kind: 'bond', bondId: item.bondId };
}

function descriptorPoint(endpoint, molecule) {
  if (endpoint.kind === 'atom') {
    const atom = molecule.atoms.get(endpoint.atomId);
    return atom && atom.x != null && atom.y != null ? { x: atom.x, y: -atom.y } : null;
  }
  const bond = molecule.bonds.get(endpoint.bondId);
  if (!bond) {
    return null;
  }
  const [a1, a2] = bond.getAtomObjects(molecule);
  if (!a1 || !a2 || a1.x == null || a1.y == null || a2.x == null || a2.y == null) {
    return null;
  }
  return { x: (a1.x + a2.x) / 2, y: -(a1.y + a2.y) / 2 };
}

function descriptorAtomLabelClearance(point, molecule) {
  let minClearance = Number.POSITIVE_INFINITY;
  for (const atom of molecule?.atoms?.values?.() ?? []) {
    if (atom.visible === false || atom.x == null || atom.y == null) {
      continue;
    }
    const atomPoint = { x: atom.x, y: -atom.y };
    const labelRadius = atom.name?.length > 1 ? 15 : 12;
    minClearance = Math.min(minClearance, Math.hypot(point.x - atomPoint.x, point.y - atomPoint.y) - labelRadius);
  }
  return minClearance;
}

function stableBondEndpointSideSign(endpoint, counterpart, molecule) {
  if (endpoint.kind !== 'bond') {
    return null;
  }
  const bond = molecule.bonds.get(endpoint.bondId);
  if (!bond) {
    return null;
  }
  const [a1, a2] = bond.getAtomObjects(molecule);
  if (!a1 || !a2 || a1.x == null || a1.y == null || a2.x == null || a2.y == null) {
    return null;
  }
  const p1 = { x: a1.x, y: -a1.y };
  const p2 = { x: a2.x, y: -a2.y };
  const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  if (!Number.isFinite(len) || len < 1e-6) {
    return null;
  }
  const nx = -dy / len;
  const ny = dx / len;
  const towardPoint = descriptorPoint(counterpart, molecule);
  const towardDot = towardPoint ? (towardPoint.x - mid.x) * nx + (towardPoint.y - mid.y) * ny : 0;
  if (Math.abs(towardDot) > 0.02) {
    return towardDot >= 0 ? 1 : -1;
  }
  const positive = { x: mid.x + nx * BOND_ENDPOINT_OFFSET, y: mid.y + ny * BOND_ENDPOINT_OFFSET };
  const negative = { x: mid.x - nx * BOND_ENDPOINT_OFFSET, y: mid.y - ny * BOND_ENDPOINT_OFFSET };
  const positiveClearance = descriptorAtomLabelClearance(positive, molecule);
  const negativeClearance = descriptorAtomLabelClearance(negative, molecule);
  if (Math.abs(positiveClearance - negativeClearance) > 0.02) {
    return positiveClearance > negativeClearance ? 1 : -1;
  }
  return positive.y >= negative.y ? 1 : -1;
}

function withStableBondSideSigns(from, to, molecule) {
  const stableFrom = { ...from };
  const stableTo = { ...to };
  const fromSideSign = stableBondEndpointSideSign(stableFrom, stableTo, molecule);
  if (fromSideSign) {
    stableFrom.sideSign = fromSideSign;
  }
  const toSideSign = stableBondEndpointSideSign(stableTo, stableFrom, molecule);
  if (toSideSign) {
    stableTo.sideSign = toSideSign;
  }
  return { from: stableFrom, to: stableTo };
}

function expandFlowUnits(items) {
  const units = [];
  for (const item of items) {
    const amount = Math.max(1, Math.round(item.amount ?? 1));
    for (let index = 0; index < amount; index++) {
      units.push({ item, index });
    }
  }
  return units;
}

function addFlowEdge(graph, from, to, cap, cost, meta = null) {
  const forward = { to, rev: graph[to].length, cap, cost, meta };
  const reverse = { to: from, rev: graph[from].length, cap: 0, cost: -cost, meta: null };
  graph[from].push(forward);
  graph[to].push(reverse);
  return forward;
}

function shortestAugmentingPath(graph, source, target) {
  const dist = Array(graph.length).fill(Number.POSITIVE_INFINITY);
  const inQueue = Array(graph.length).fill(false);
  const prev = Array(graph.length).fill(null);
  const queue = [source];
  dist[source] = 0;
  inQueue[source] = true;

  while (queue.length > 0) {
    const node = queue.shift();
    inQueue[node] = false;
    for (let edgeIndex = 0; edgeIndex < graph[node].length; edgeIndex++) {
      const edge = graph[node][edgeIndex];
      if (edge.cap <= 0) {
        continue;
      }
      const nextCost = dist[node] + edge.cost;
      if (nextCost + 1e-9 >= dist[edge.to]) {
        continue;
      }
      dist[edge.to] = nextCost;
      prev[edge.to] = { node, edgeIndex };
      if (!inQueue[edge.to]) {
        queue.push(edge.to);
        inQueue[edge.to] = true;
      }
    }
  }

  if (!Number.isFinite(dist[target])) {
    return null;
  }
  return prev;
}

function bestFlowPairs(sources, sinks, molecule) {
  const sourceUnits = expandFlowUnits(sources);
  const sinkUnits = expandFlowUnits(sinks).sort((a, b) => (a.item.kind === 'bond' ? 0 : 1) - (b.item.kind === 'bond' ? 0 : 1));
  if (sourceUnits.length === 0 || sinkUnits.length === 0) {
    return [];
  }

  const sourceNode = 0;
  const sinkOffset = 1;
  const sourceOffset = sinkOffset + sinkUnits.length;
  const targetNode = sourceOffset + sourceUnits.length;
  const graph = Array.from({ length: targetNode + 1 }, () => []);
  const candidateEdges = [];

  for (let sinkIndex = 0; sinkIndex < sinkUnits.length; sinkIndex++) {
    addFlowEdge(graph, sourceNode, sinkOffset + sinkIndex, 1, 0);
  }
  for (let sourceIndex = 0; sourceIndex < sourceUnits.length; sourceIndex++) {
    addFlowEdge(graph, sourceOffset + sourceIndex, targetNode, 1, 0);
  }
  for (let sinkIndex = 0; sinkIndex < sinkUnits.length; sinkIndex++) {
    const sinkUnit = sinkUnits[sinkIndex];
    for (let sourceIndex = 0; sourceIndex < sourceUnits.length; sourceIndex++) {
      const sourceUnit = sourceUnits[sourceIndex];
      const score = pairScore(sourceUnit.item, sinkUnit.item, molecule);
      if (!Number.isFinite(score)) {
        continue;
      }
      const edge = addFlowEdge(graph, sinkOffset + sinkIndex, sourceOffset + sourceIndex, 1, score, {
        source: sourceUnit.item,
        sink: sinkUnit.item,
        score,
        sinkIndex
      });
      candidateEdges.push(edge);
    }
  }

  while (true) {
    const prev = shortestAugmentingPath(graph, sourceNode, targetNode);
    if (!prev) {
      break;
    }
    let node = targetNode;
    while (node !== sourceNode) {
      const step = prev[node];
      const edge = graph[step.node][step.edgeIndex];
      edge.cap -= 1;
      graph[edge.to][edge.rev].cap += 1;
      node = step.node;
    }
  }

  return candidateEdges
    .filter(edge => edge.cap === 0)
    .map(edge => edge.meta)
    .sort((a, b) => a.sinkIndex - b.sinkIndex);
}

/**
 * Infers curved electron-flow arrows between two resonance contributors.
 * @param {import('../../core/Molecule.js').Molecule} molecule - Molecule with resonance state tables.
 * @param {number} targetState - 1-based target resonance state.
 * @param {object} [options] - Inference options.
 * @param {number} [options.fromState] - Source contributor for electron movement.
 * @param {number} [options.toState] - Target contributor for electron movement.
 * @returns {{state: number, referenceState: number, arrows: Array<object>}} Electron-flow descriptor.
 */
export function buildResonanceElectronFlow(molecule, targetState, options = {}) {
  const count = molecule?.properties?.resonance?.count ?? 1;
  const state = Math.max(1, Math.min(targetState ?? 1, count));
  const fromState = Math.max(1, Math.min(options.fromState ?? 1, count));
  const toState = Math.max(1, Math.min(options.toState ?? state, count));
  if (!molecule || fromState === toState || count <= 1) {
    return { state: 1, referenceState: 1, arrows: [] };
  }

  const sources = [];
  const sinks = [];
  for (const bond of molecule.bonds.values()) {
    const from = stateBondOrder(bond, fromState);
    const to = stateBondOrder(bond, toState);
    const delta = to - from;
    if (Math.abs(delta) < 1e-6) {
      continue;
    }
    const entry = {
      kind: 'bond',
      bondId: bond.id,
      atomIds: [...bond.atoms],
      amount: Math.max(1, Math.round(Math.abs(delta)))
    };
    if (delta < 0) {
      sources.push(entry);
    } else {
      sinks.push(entry);
    }
  }

  for (const atom of molecule.atoms.values()) {
    const from = stateAtomCharge(atom, fromState);
    const to = stateAtomCharge(atom, toState);
    const delta = to - from;
    if (Math.abs(delta) < 1e-6) {
      continue;
    }
    const entry = {
      kind: 'atom',
      atomId: atom.id,
      amount: Math.max(1, Math.round(Math.abs(delta)))
    };
    if (delta > 0) {
      sources.push(entry);
    } else {
      sinks.push(entry);
    }
  }

  const arrows = [];
  for (const pair of bestFlowPairs(sources, sinks, molecule)) {
    const endpoints = withStableBondSideSigns(endpointForSourceOrSink(pair.source), endpointForSourceOrSink(pair.sink), molecule);
    arrows.push({
      from: endpoints.from,
      to: endpoints.to,
      sourceKind: pair.source.kind,
      sinkKind: pair.sink.kind,
      score: pair.score
    });
  }

  return { state, referenceState: fromState, targetState: toState, arrows };
}

export function setMoleculeResonanceElectronFlow(molecule, targetState, options = {}) {
  if (!molecule?.properties?.resonance) {
    clearMoleculeResonanceElectronFlow(molecule);
    return null;
  }
  const count = molecule.properties.resonance.count ?? 1;
  const fromState = Math.max(1, Math.min(options.fromState ?? 1, count));
  const toState = Math.max(1, Math.min(options.toState ?? targetState ?? 1, count));
  if (fromState === toState) {
    clearMoleculeResonanceElectronFlow(molecule);
    return null;
  }
  const flow = buildResonanceElectronFlow(molecule, toState, { ...options, fromState, toState });
  if (flow.arrows.length === 0) {
    clearMoleculeResonanceElectronFlow(molecule);
    return null;
  }
  molecule.properties[RESONANCE_ELECTRON_FLOW_PROPERTY] = flow;
  return flow;
}

export function clearMoleculeResonanceElectronFlow(molecule) {
  if (molecule?.properties) {
    delete molecule.properties[RESONANCE_ELECTRON_FLOW_PROPERTY];
  }
}

function activeResonanceElectronFlow(molecule) {
  let flow = molecule?.properties?.[RESONANCE_ELECTRON_FLOW_PROPERTY] ?? null;
  let arrows = flow?.arrows ?? [];
  const activeState = molecule?.properties?.resonance?.currentState ?? 1;
  if (arrows.length === 0 && activeState > 1) {
    flow = buildResonanceElectronFlow(molecule, activeState);
    if (flow.arrows.length > 0) {
      if (molecule.properties) {
        molecule.properties[RESONANCE_ELECTRON_FLOW_PROPERTY] = flow;
      }
      arrows = flow.arrows;
    }
  }
  return arrows;
}

function visibleAtomLabelClearance(point, molecule, pointForAtom) {
  let minClearance = Number.POSITIVE_INFINITY;
  for (const atom of molecule?.atoms?.values?.() ?? []) {
    if (atom.visible === false || atom.x == null || atom.y == null) {
      continue;
    }
    const atomPoint = pointForAtom(atom);
    const labelRadius = atom.name?.length > 1 ? 15 : 12;
    minClearance = Math.min(minClearance, Math.hypot(point.x - atomPoint.x, point.y - atomPoint.y) - labelRadius);
  }
  return minClearance;
}

function chooseBondEndpointOffsetSign(mid, nx, ny, towardPoint, molecule, pointForAtom) {
  const towardDot = towardPoint ? (towardPoint.x - mid.x) * nx + (towardPoint.y - mid.y) * ny : 0;
  if (Math.abs(towardDot) > 0.75) {
    return towardDot >= 0 ? 1 : -1;
  }
  const positive = { x: mid.x + nx * BOND_ENDPOINT_OFFSET, y: mid.y + ny * BOND_ENDPOINT_OFFSET };
  const negative = { x: mid.x - nx * BOND_ENDPOINT_OFFSET, y: mid.y - ny * BOND_ENDPOINT_OFFSET };
  const positiveClearance = visibleAtomLabelClearance(positive, molecule, pointForAtom);
  const negativeClearance = visibleAtomLabelClearance(negative, molecule, pointForAtom);
  if (Math.abs(positiveClearance - negativeClearance) > 0.5) {
    return positiveClearance > negativeClearance ? 1 : -1;
  }
  return positive.y >= negative.y ? 1 : -1;
}

function endpointPoint(endpoint, molecule, pointForAtom, towardPoint = null) {
  if (endpoint.kind === 'atom') {
    const atom = molecule.atoms.get(endpoint.atomId);
    return atom ? pointForAtom(atom) : null;
  }
  const bond = molecule.bonds.get(endpoint.bondId);
  if (!bond) {
    return null;
  }
  const [a1, a2] = bond.getAtomObjects(molecule);
  if (!a1 || !a2) {
    return null;
  }
  const p1 = pointForAtom(a1);
  const p2 = pointForAtom(a2);
  const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  if (!towardPoint || !Number.isFinite(len) || len < 1e-6) {
    return mid;
  }
  const nx = -dy / len;
  const ny = dx / len;
  const sign = Number.isFinite(endpoint.sideSign) && endpoint.sideSign !== 0 ? Math.sign(endpoint.sideSign) : chooseBondEndpointOffsetSign(mid, nx, ny, towardPoint, molecule, pointForAtom);
  return { x: mid.x + nx * BOND_ENDPOINT_OFFSET * sign, y: mid.y + ny * BOND_ENDPOINT_OFFSET * sign };
}

function bondEndpointPointWithSign(endpoint, molecule, pointForAtom, sign) {
  if (endpoint.kind !== 'bond' || !Number.isFinite(sign) || sign === 0) {
    return null;
  }
  const bond = molecule.bonds.get(endpoint.bondId);
  if (!bond) {
    return null;
  }
  const [a1, a2] = bond.getAtomObjects(molecule);
  if (!a1 || !a2) {
    return null;
  }
  const p1 = pointForAtom(a1);
  const p2 = pointForAtom(a2);
  const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  if (!Number.isFinite(len) || len < 1e-6) {
    return mid;
  }
  const nx = -dy / len;
  const ny = dx / len;
  const offsetSign = Math.sign(sign);
  return { x: mid.x + nx * BOND_ENDPOINT_OFFSET * offsetSign, y: mid.y + ny * BOND_ENDPOINT_OFFSET * offsetSign };
}

function bondEndpointGeometry(endpoint, molecule, pointForAtom) {
  if (endpoint.kind !== 'bond') {
    return null;
  }
  const bond = molecule.bonds.get(endpoint.bondId);
  if (!bond) {
    return null;
  }
  const [a1, a2] = bond.getAtomObjects(molecule);
  if (!a1 || !a2) {
    return null;
  }
  const p1 = pointForAtom(a1);
  const p2 = pointForAtom(a2);
  const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  if (!Number.isFinite(len) || len < 1e-6) {
    return null;
  }
  return {
    bond,
    atoms: [a1, a2],
    mid,
    nx: -dy / len,
    ny: dx / len
  };
}

function resolveArrowOffset(option, fallback, context) {
  const value = option ?? fallback;
  const resolved = typeof value === 'function' ? value(context) : value;
  return Number.isFinite(resolved) ? Math.max(0, resolved) : 0;
}

function atomToBondCurvePoints(arrow, molecule, pointForAtom, options) {
  if (arrow.from.kind !== 'atom' || arrow.to.kind !== 'bond') {
    return null;
  }
  const sourceAtom = molecule.atoms.get(arrow.from.atomId);
  const bondGeometry = bondEndpointGeometry(arrow.to, molecule, pointForAtom);
  if (!sourceAtom || !bondGeometry) {
    return null;
  }
  const sourceCenter = pointForAtom(sourceAtom);
  const { bond, atoms, mid, nx, ny } = bondGeometry;
  const [a1, a2] = atoms;
  const avoidSign = typeof options.bondTargetOffsetSign === 'function' ? options.bondTargetOffsetSign(arrow.to, bond, a1, a2, arrow) : null;
  const sourceSideDot = (sourceCenter.x - mid.x) * nx + (sourceCenter.y - mid.y) * ny;
  const stableSideSign = Number.isFinite(arrow.to.sideSign) && arrow.to.sideSign !== 0 ? Math.sign(arrow.to.sideSign) : 0;
  const sign = Math.abs(sourceSideDot) > 0.1 ? Math.sign(sourceSideDot) : stableSideSign || 1;
  const sourceOffset = resolveArrowOffset(options.atomToBondSourceOffset, options.atomToBondEndpointOffset ?? 6, {
    arrow,
    atom: sourceAtom,
    molecule,
    pointForAtom
  });
  let targetOffset = resolveArrowOffset(options.atomToBondTargetOffset, options.atomToBondEndpointOffset ?? 6, {
    arrow,
    bond,
    atoms,
    molecule,
    pointForAtom
  });
  if (Number.isFinite(avoidSign) && Math.sign(avoidSign) !== sign) {
    targetOffset = Math.max(
      targetOffset,
      resolveArrowOffset(options.atomToBondMultipleBondOffset, 13, {
        arrow,
        bond,
        atoms,
        molecule,
        pointForAtom
      })
    );
  }
  const start = { x: sourceCenter.x + nx * sign * sourceOffset, y: sourceCenter.y + ny * sign * sourceOffset };
  const end = { x: mid.x + nx * sign * targetOffset, y: mid.y + ny * sign * targetOffset };
  return { start, end, sideSign: sign, nx, ny };
}

function shortenedEndpoints(start, end, startPad, endPad) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy);
  if (!Number.isFinite(len) || len < 1e-6) {
    return null;
  }
  const ux = dx / len;
  const uy = dy / len;
  const maxPad = Math.max(0, len / 2 - 1);
  const sp = Math.min(startPad, maxPad);
  const ep = Math.min(endPad, maxPad);
  return {
    start: { x: start.x + ux * sp, y: start.y + uy * sp },
    end: { x: end.x - ux * ep, y: end.y - uy * ep },
    ux,
    uy,
    len
  };
}

function endpointPad(endpoint, molecule, atomFallback, bondFallback = 0) {
  const fallback = endpoint.kind === 'atom' ? atomFallback : bondFallback;
  if (typeof fallback === 'function') {
    const atom = endpoint.kind === 'atom' ? (molecule?.atoms?.get?.(endpoint.atomId) ?? null) : null;
    const resolved = fallback(endpoint, atom, molecule);
    return Number.isFinite(resolved) ? Math.max(0, resolved) : 0;
  }
  return Number.isFinite(fallback) ? Math.max(0, fallback) : 0;
}

function curveSignForArrow(arrow, index, shortened, startBase, startRaw, endBase, endRaw) {
  const px = -shortened.uy;
  const py = shortened.ux;
  const startOffsetDot = (startRaw.x - startBase.x) * px + (startRaw.y - startBase.y) * py;
  if (arrow.from.kind === 'bond' && Math.abs(startOffsetDot) > 0.1) {
    return Math.sign(startOffsetDot);
  }
  const endOffsetDot = (endRaw.x - endBase.x) * px + (endRaw.y - endBase.y) * py;
  if (arrow.to.kind === 'bond' && Math.abs(endOffsetDot) > 0.1) {
    return Math.sign(endOffsetDot);
  }
  return index % 2 === 0 ? 1 : -1;
}

function outsideAtomTargetPoint(atomCenter, startPoint, curveSign, distance) {
  const dx = atomCenter.x - startPoint.x;
  const dy = atomCenter.y - startPoint.y;
  const len = Math.hypot(dx, dy);
  if (!Number.isFinite(len) || len < 1e-6) {
    return atomCenter;
  }
  const px = -dy / len;
  const py = dx / len;
  return {
    x: atomCenter.x + px * curveSign * distance,
    y: atomCenter.y + py * curveSign * distance
  };
}

function offsetAtomTargetPoint(atomCenter, startPoint, curveSign, radius, radialRatio, sideRatio) {
  const dx = atomCenter.x - startPoint.x;
  const dy = atomCenter.y - startPoint.y;
  const len = Math.hypot(dx, dy);
  if (!Number.isFinite(len) || len < 1e-6 || !Number.isFinite(radius) || radius <= 0) {
    return atomCenter;
  }
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  const radial = radius * Math.max(0, radialRatio);
  const side = radius * Math.max(0, sideRatio) * (curveSign || 1);
  return {
    x: atomCenter.x - ux * radial + px * side,
    y: atomCenter.y - uy * radial + py * side
  };
}

function angledAtomTargetPoint(atomCenter, startPoint, curveSign, radius, angle, clearance = 0) {
  const dx = atomCenter.x - startPoint.x;
  const dy = atomCenter.y - startPoint.y;
  const len = Math.hypot(dx, dy);
  if (!Number.isFinite(len) || len < 1e-6 || !Number.isFinite(radius) || radius <= 0) {
    return atomCenter;
  }
  const clampedAngle = Number.isFinite(angle) ? Math.max(0, Math.min(Math.PI / 2, angle)) : Math.PI / 4;
  const distance = radius + Math.max(0, Number.isFinite(clearance) ? clearance : 0);
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  const radial = Math.cos(clampedAngle) * distance;
  const side = Math.sin(clampedAngle) * distance * (curveSign || 1);
  return {
    x: atomCenter.x - ux * radial + px * side,
    y: atomCenter.y - uy * radial + py * side
  };
}

function resolveAtomTargetRadius(endpoint, molecule, option) {
  if (endpoint.kind !== 'atom') {
    return 0;
  }
  const atom = molecule?.atoms?.get?.(endpoint.atomId) ?? null;
  const resolved = typeof option === 'function' ? option(endpoint, atom, molecule) : option;
  return Number.isFinite(resolved) ? Math.max(0, resolved) : 0;
}

function controlPointForAtomTargetCenter(shortened, atomCenter, fallbackControl, fallbackCurveMagnitude, minBend = 0) {
  const dx = atomCenter.x - shortened.end.x;
  const dy = atomCenter.y - shortened.end.y;
  const len = Math.hypot(dx, dy);
  if (!Number.isFinite(len) || len < 1e-6) {
    return null;
  }
  const ux = dx / len;
  const uy = dy / len;
  const projectedDistance = (shortened.end.x - fallbackControl.x) * ux + (shortened.end.y - fallbackControl.y) * uy;
  const minDistance = Math.max(12, Math.min(22, shortened.len * 0.22));
  const normalDot = Math.abs(ux * -shortened.uy + uy * shortened.ux);
  const requiredBendDistance = Number.isFinite(minBend) && minBend > 0 && normalDot > 1e-3 ? minBend / normalDot : 0;
  const maxDistance = Math.max(minDistance, requiredBendDistance, Math.min(shortened.len * 1.15, fallbackCurveMagnitude * 3.4));
  const distance = Math.max(minDistance, requiredBendDistance, Math.min(maxDistance, projectedDistance));
  return {
    x: shortened.end.x - ux * distance,
    y: shortened.end.y - uy * distance
  };
}

function resonanceArrowDefaults(options = {}) {
  return {
    atomStartPad: options.atomStartPad ?? ATOM_LABEL_CLEARANCE,
    atomEndPad: options.atomEndPad ?? ATOM_LABEL_CLEARANCE,
    bondStartPad: options.bondStartPad ?? 0,
    bondEndPad: options.bondEndPad ?? 0,
    curveScale: options.curveScale ?? 0.3,
    minCurve: options.minCurve ?? 18,
    maxCurve: options.maxCurve ?? 38,
    ...options
  };
}

function quadraticPathData(start, control, end) {
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} Q ${control.x.toFixed(2)} ${control.y.toFixed(2)} ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

function angleFromAtomCenter(center, point) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return null;
  }
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  if (Math.hypot(dx, dy) < 1e-6) {
    return null;
  }
  return Math.atan2(dy, dx);
}

function quadraticPoint(start, control, end, t) {
  const u = 1 - t;
  return {
    x: u * u * start.x + 2 * u * t * control.x + t * t * end.x,
    y: u * u * start.y + 2 * u * t * control.y + t * t * end.y
  };
}

/**
 * Returns occupied charge-badge directions caused by active resonance arrows near an atom.
 * @param {import('../../core/Molecule.js').Molecule} molecule - Rendered molecule.
 * @param {object} atom - Atom whose charge badge is being placed.
 * @param {(atom: object) => {x: number, y: number}} pointForAtom - Atom-to-SVG point function.
 * @param {object} [options] - Same rendering options passed to `computeResonanceArrowPath`.
 * @returns {Array<{angle: number, spread: number}>} Blocked angular sectors.
 */
export function resonanceArrowOccupiedAnglesForAtom(molecule, atom, pointForAtom, options = {}) {
  if (!molecule || !atom || typeof pointForAtom !== 'function') {
    return [];
  }
  const center = pointForAtom(atom);
  if (!center || !Number.isFinite(center.x) || !Number.isFinite(center.y)) {
    return [];
  }
  const spread = Number.isFinite(options.chargeAvoidanceSpread) ? Math.max(0, options.chargeAvoidanceSpread) : 0.58;
  const influenceRadius = Number.isFinite(options.chargeAvoidanceRadius) ? Math.max(0, options.chargeAvoidanceRadius) : 42;
  const sectors = [];
  const pushSector = point => {
    if (!point || Math.hypot(point.x - center.x, point.y - center.y) > influenceRadius) {
      return;
    }
    const angle = angleFromAtomCenter(center, point);
    if (Number.isFinite(angle)) {
      sectors.push({ angle, spread });
    }
  };

  const arrows = activeResonanceElectronFlow(molecule);
  arrows.forEach((arrow, index) => {
    const fromAtomIds = endpointAtomIds(arrow.from);
    const toAtomIds = endpointAtomIds(arrow.to);
    const touchesSource = fromAtomIds.includes(atom.id);
    const touchesTarget = toAtomIds.includes(atom.id);
    if (!touchesSource && !touchesTarget) {
      return;
    }
    const path = computeResonanceArrowPath(arrow, index, molecule, pointForAtom, options);
    if (!path) {
      return;
    }
    if (touchesSource) {
      pushSector(path.start);
      pushSector(quadraticPoint(path.start, path.control, path.end, 0.22));
    }
    if (touchesTarget) {
      pushSector(path.end);
      pushSector(quadraticPoint(path.start, path.control, path.end, 0.78));
    }
  });
  return sectors;
}

/**
 * Computes one resonance arrow as a single quadratic curve.
 * @param {object} arrow - Electron-flow arrow descriptor.
 * @param {number} index - Arrow index in the active resonance flow.
 * @param {import('../../core/Molecule.js').Molecule} molecule - Rendered molecule.
 * @param {(atom: object) => {x: number, y: number}} pointForAtom - Atom-to-SVG point function.
 * @param {object} [options] - Rendering options.
 * @returns {{d: string, start: object, control: object, end: object, atomToBond: boolean}|null} Path data or null.
 */
export function computeResonanceArrowPath(arrow, index, molecule, pointForAtom, options = {}) {
  const resolvedOptions = resonanceArrowDefaults(options);
  const minArrowLength = resolvedOptions.minArrowLength ?? 14;
  const startBase = endpointPoint(arrow.from, molecule, pointForAtom);
  const endBase = endpointPoint(arrow.to, molecule, pointForAtom);
  if (!startBase || !endBase) {
    return null;
  }
  let startRaw = endpointPoint(arrow.from, molecule, pointForAtom, endBase);
  let endRaw = endpointPoint(arrow.to, molecule, pointForAtom, startBase);
  const atomToBondPoints = atomToBondCurvePoints(arrow, molecule, pointForAtom, resolvedOptions);
  if (atomToBondPoints) {
    startRaw = atomToBondPoints.start;
    endRaw = atomToBondPoints.end;
  } else if (arrow.from.kind === 'atom' && arrow.to.kind === 'bond' && typeof resolvedOptions.bondTargetOffsetSign === 'function') {
    const bond = molecule.bonds.get(arrow.to.bondId);
    const [a1, a2] = bond?.getAtomObjects?.(molecule) ?? [];
    const overrideSign = bond && a1 && a2 ? resolvedOptions.bondTargetOffsetSign(arrow.to, bond, a1, a2, arrow) : null;
    endRaw = bondEndpointPointWithSign(arrow.to, molecule, pointForAtom, overrideSign) ?? endRaw;
  }
  if (!startRaw || !endRaw) {
    return null;
  }
  const startPad = atomToBondPoints ? 0 : endpointPad(arrow.from, molecule, resolvedOptions.atomStartPad, resolvedOptions.bondStartPad);
  let endPad = atomToBondPoints ? 0 : endpointPad(arrow.to, molecule, resolvedOptions.atomEndPad, resolvedOptions.bondEndPad);
  const signProbe = shortenedEndpoints(startRaw, endRaw, startPad, endPad);
  if (!signProbe || signProbe.len < minArrowLength) {
    return null;
  }
  const curveSign = atomToBondPoints?.sideSign ?? curveSignForArrow(arrow, index, signProbe, startBase, startRaw, endBase, endRaw);
  const atomTargetRadius = arrow.to.kind === 'atom' ? resolveAtomTargetRadius(arrow.to, molecule, resolvedOptions.atomTargetCircleRadius ?? resolvedOptions.atomTargetInteriorRadius) : 0;
  if (!atomToBondPoints && atomTargetRadius > 0 && arrow.to.kind === 'atom') {
    endRaw = Number.isFinite(resolvedOptions.atomTargetCircleAngle)
      ? angledAtomTargetPoint(endBase, startRaw, curveSign, atomTargetRadius, resolvedOptions.atomTargetCircleAngle, resolvedOptions.atomTargetCircleClearance)
      : offsetAtomTargetPoint(
          endBase,
          startRaw,
          curveSign,
          atomTargetRadius,
          resolvedOptions.atomTargetCircleRadialRatio ?? resolvedOptions.atomTargetInteriorRadialRatio ?? 0.5,
          resolvedOptions.atomTargetCircleSideRatio ?? resolvedOptions.atomTargetInteriorSideRatio ?? 0.45
        );
    endPad = 0;
  }
  if (resolvedOptions.atomTargetOutside && arrow.to.kind === 'atom') {
    endRaw = outsideAtomTargetPoint(endBase, startRaw, curveSign, endPad);
    endPad = 0;
  }
  const shortened = shortenedEndpoints(startRaw, endRaw, startPad, endPad);
  if (!shortened || shortened.len < minArrowLength) {
    return null;
  }
  const curveMagnitude = Math.max(resolvedOptions.minCurve, Math.min(resolvedOptions.maxCurve, shortened.len * resolvedOptions.curveScale));
  const curve = curveMagnitude * curveSign;
  const defaultControl = atomToBondPoints
    ? { x: (shortened.start.x + shortened.end.x) / 2 + atomToBondPoints.nx * atomToBondPoints.sideSign * curveMagnitude, y: (shortened.start.y + shortened.end.y) / 2 + atomToBondPoints.ny * atomToBondPoints.sideSign * curveMagnitude }
    : { x: (shortened.start.x + shortened.end.x) / 2 - shortened.uy * curve, y: (shortened.start.y + shortened.end.y) / 2 + shortened.ux * curve };
  const atomTargetControl = resolvedOptions.atomTargetCenterTangent && arrow.to.kind === 'atom' ? controlPointForAtomTargetCenter(shortened, endBase, defaultControl, curveMagnitude, resolvedOptions.atomTargetMinBend) : null;
  const control = atomTargetControl
    ? atomTargetControl
    : defaultControl;
  return {
    d: quadraticPathData(shortened.start, control, shortened.end),
    start: shortened.start,
    control,
    end: shortened.end,
    atomToBond: !!atomToBondPoints
  };
}

function ensureArrowMarker(root) {
  let defs = root.select('defs.resonance-electron-flow-defs');
  if (defs.empty()) {
    defs = root.append('defs').attr('class', 'resonance-electron-flow-defs');
  }
  let marker = defs.select('#resonance-electron-flow-arrowhead');
  if (marker.empty()) {
    marker = defs
      .append('marker')
      .attr('id', 'resonance-electron-flow-arrowhead')
      .attr('viewBox', '0 0 10 10')
      .attr('refX', 8.2)
      .attr('refY', 5)
      .attr('markerWidth', 5.5)
      .attr('markerHeight', 5.5)
      .attr('orient', 'auto-start-reverse');
    marker.append('path').attr('d', 'M 0 0 L 10 5 L 0 10 z');
  }
  marker.select('path').attr('fill', RESONANCE_ARROW_COLOR);
}

/**
 * Draws resonance electron-flow arrows into the 2D molecule layer.
 * @param {object} root - d3 selection for the molecule root group.
 * @param {import('../../core/Molecule.js').Molecule} molecule - Rendered molecule.
 * @param {(atom: object) => {x: number, y: number}} pointForAtom - Atom-to-SVG point function.
 * @param {object} [options] - Rendering options.
 * @param {number|Function} [options.atomStartPad] - Atom-source shortening distance.
 * @param {number|Function} [options.atomEndPad] - Atom-target shortening distance.
 * @param {number|Function} [options.bondStartPad] - Bond-source shortening distance.
 * @param {number|Function} [options.bondEndPad] - Bond-target shortening distance.
 * @param {Function} [options.bondTargetOffsetSign] - Optional override for atom-to-bond target offset side.
 * @param {number|Function} [options.atomToBondEndpointOffset] - Atom-to-bond source/target offset distance.
 * @param {number|Function} [options.atomToBondSourceOffset] - Atom-to-bond source atom offset distance.
 * @param {number|Function} [options.atomToBondTargetOffset] - Atom-to-bond target bond offset distance.
 * @param {number|Function} [options.atomToBondMultipleBondOffset] - Atom-to-bond target offset when avoiding a multiple-bond stroke.
 * @param {boolean} [options.atomTargetOutside] - Place atom-target arrowheads outside the atom label instead of on the source-to-center line.
 * @param {boolean} [options.atomTargetCenterTangent] - Point atom-target arrowhead tangents toward atom centers.
 * @param {number|Function} [options.atomTargetCircleRadius] - Atom-circle radius used to place atom-target arrowheads around force atoms.
 * @param {number} [options.atomTargetCircleAngle] - Atom-target angle around the atom circle from near edge toward the curve side.
 * @param {number} [options.atomTargetCircleClearance] - Extra distance outside the atom circle for atom-target arrowheads.
 * @param {number} [options.atomTargetCircleRadialRatio] - Fraction of target radius between the arrowhead and atom center along the source radial.
 * @param {number} [options.atomTargetCircleSideRatio] - Fraction of target radius to offset atom-target arrowheads toward the curve side.
 * @param {number} [options.atomTargetMinBend] - Minimum chord-to-control bend for atom-target arrows.
 * @param {string} [options.layerBeforeSelector] - Optional selector to insert the arrow layer before.
 * @param {number} [options.strokeWidth] - Arrow stroke width in pixels.
 * @param {number} [options.minArrowLength] - Minimum shortened arrow length needed for rendering.
 * @param {number} [options.curveScale] - Curve depth as a fraction of arrow length.
 * @param {number} [options.minCurve] - Minimum curve depth.
 * @param {number} [options.maxCurve] - Maximum curve depth.
 */
export function drawResonanceElectronFlow2d(root, molecule, pointForAtom, options = {}) {
  if (!root || typeof root.select !== 'function' || typeof root.append !== 'function') {
    return;
  }
  root.select('g.resonance-electron-flow-layer').remove();
  const arrows = activeResonanceElectronFlow(molecule);
  if (arrows.length === 0) {
    return;
  }
  ensureArrowMarker(root);
  const layer = options.layerBeforeSelector ? root.insert('g', options.layerBeforeSelector) : root.append('g');
  layer.attr('class', 'resonance-electron-flow-layer').style('pointer-events', 'none');
  arrows.forEach((arrow, index) => {
    const path = computeResonanceArrowPath(arrow, index, molecule, pointForAtom, options);
    if (!path) {
      return;
    }
    layer
      .append('path')
      .attr('class', 'resonance-electron-flow-arrow')
      .attr('data-resonance-arrow-index', String(index))
      .attr('d', path.d)
      .attr('fill', 'none')
      .attr('stroke', RESONANCE_ARROW_COLOR)
      .attr('stroke-width', options.strokeWidth ?? 1.7)
      .attr('stroke-linecap', 'round')
      .attr('stroke-linejoin', 'round')
      .attr('opacity', 0.9)
      .attr('marker-end', 'url(#resonance-electron-flow-arrowhead)');
  });
}
