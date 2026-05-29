/** @module topology/isolated-ring-chain */

const DEFAULT_MIN_RING_SYSTEM_COUNT = 4;
const DEFAULT_HETERO_PER_RING_FLOOR = 1.5;
const DEFAULT_ATOM_COUNT_CEILING = 1000;
const MAX_RING_LINKER_ATOM_COUNT = 2;

function componentAtomIdSet(componentOrAtomIds) {
  return new Set(Array.isArray(componentOrAtomIds?.atomIds) ? componentOrAtomIds.atomIds : componentOrAtomIds);
}

function componentRingSystems(layoutGraph, componentOrAtomIds) {
  const atomIds = componentAtomIdSet(componentOrAtomIds);
  return (layoutGraph.ringSystems ?? []).filter(ringSystem => ringSystem.atomIds.every(atomId => atomIds.has(atomId)));
}

function componentHeteroAtomCount(layoutGraph, componentOrAtomIds) {
  let heteroAtomCount = 0;
  for (const atomId of componentAtomIdSet(componentOrAtomIds)) {
    const atom = layoutGraph.atoms.get(atomId);
    if (atom && atom.element !== 'C' && atom.element !== 'H') {
      heteroAtomCount++;
    }
  }
  return heteroAtomCount;
}

function ringSystemHasConnections(layoutGraph, ringSystem) {
  const ringIds = new Set(ringSystem.ringIds ?? []);
  return (layoutGraph.ringConnections ?? []).some(connection => ringIds.has(connection.firstRingId) || ringIds.has(connection.secondRingId));
}

function isSimpleIsolatedRingSystem(layoutGraph, ringSystem) {
  return (ringSystem.ringIds?.length ?? 0) === 1 && !ringSystemHasConnections(layoutGraph, ringSystem);
}

function otherBondAtomId(bond, atomId) {
  return bond.a === atomId ? bond.b : bond.a;
}

function isAcceptedSingleAtomRingLinker(layoutGraph, linkerAtomId) {
  const linkerAtom = layoutGraph.atoms.get(linkerAtomId);
  return Boolean(linkerAtom && linkerAtom.element !== 'C' && linkerAtom.heavyDegree === 2);
}

function isAcceptedTwoAtomRingLinker(layoutGraph, linkerAtomIds) {
  if (linkerAtomIds.length !== 2) {
    return false;
  }
  const linkerAtoms = linkerAtomIds.map(linkerAtomId => layoutGraph.atoms.get(linkerAtomId));
  if (linkerAtoms.some(atom => !atom || atom.heavyDegree !== 2)) {
    return false;
  }
  const heteroCount = linkerAtoms.filter(atom => atom.element !== 'C').length;
  const carbonCount = linkerAtoms.filter(atom => atom.element === 'C').length;
  return heteroCount === 1 && carbonCount === 1;
}

function isAcceptedRingLinkerPath(layoutGraph, linkerAtomIds) {
  if (linkerAtomIds.length === 1) {
    return isAcceptedSingleAtomRingLinker(layoutGraph, linkerAtomIds[0]);
  }
  return isAcceptedTwoAtomRingLinker(layoutGraph, linkerAtomIds);
}

function collectRingLinkEdgesFromAtom(layoutGraph, ringSystem, ringAtomId, ringSystemByAtomId, componentAtomIds) {
  const edges = [];
  const queue = [
    {
      atomId: ringAtomId,
      linkerAtomIds: []
    }
  ];
  const seen = new Set([`${ringAtomId}:`]);

  for (let queueIndex = 0; queueIndex < queue.length; queueIndex++) {
    const current = queue[queueIndex];
    for (const bond of layoutGraph.bondsByAtomId.get(current.atomId) ?? []) {
      if (bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = otherBondAtomId(bond, current.atomId);
      if (!componentAtomIds.has(neighborAtomId)) {
        continue;
      }
      const neighborRingSystemId = ringSystemByAtomId.get(neighborAtomId);
      if (neighborRingSystemId != null) {
        if (neighborRingSystemId !== ringSystem.id && isAcceptedRingLinkerPath(layoutGraph, current.linkerAtomIds)) {
          edges.push({
            firstRingSystemId: ringSystem.id,
            secondRingSystemId: neighborRingSystemId,
            firstAttachmentAtomId: ringAtomId,
            secondAttachmentAtomId: neighborAtomId,
            linkerAtomIds: current.linkerAtomIds
          });
        }
        continue;
      }

      if (current.linkerAtomIds.length >= MAX_RING_LINKER_ATOM_COUNT || current.linkerAtomIds.includes(neighborAtomId)) {
        continue;
      }
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      if (!neighborAtom || neighborAtom.element === 'H' || neighborAtom.heavyDegree !== 2) {
        continue;
      }
      const nextLinkerAtomIds = [...current.linkerAtomIds, neighborAtomId];
      const seenKey = `${neighborAtomId}:${nextLinkerAtomIds.join(',')}`;
      if (seen.has(seenKey)) {
        continue;
      }
      seen.add(seenKey);
      queue.push({
        atomId: neighborAtomId,
        linkerAtomIds: nextLinkerAtomIds
      });
    }
  }

  return edges;
}

function ringLinkEdges(layoutGraph, ringSystems, componentAtomIds) {
  const ringSystemByAtomId = new Map();
  for (const ringSystem of ringSystems) {
    for (const atomId of ringSystem.atomIds) {
      ringSystemByAtomId.set(atomId, ringSystem.id);
    }
  }

  const edges = [];
  const seenEdgeKeys = new Set();
  for (const ringSystem of ringSystems) {
    for (const ringAtomId of ringSystem.atomIds) {
      for (const edge of collectRingLinkEdgesFromAtom(layoutGraph, ringSystem, ringAtomId, ringSystemByAtomId, componentAtomIds)) {
        const otherRingSystemId = edge.secondRingSystemId;
        const edgeKey = ringSystem.id < otherRingSystemId ? `${ringSystem.id}:${otherRingSystemId}` : `${otherRingSystemId}:${ringSystem.id}`;
        if (seenEdgeKeys.has(edgeKey)) {
          continue;
        }
        seenEdgeKeys.add(edgeKey);
        edges.push(edge);
      }
    }
  }
  return edges;
}

function buildRingSystemAdjacency(ringSystems, edges) {
  const adjacency = new Map(ringSystems.map(ringSystem => [ringSystem.id, []]));
  for (const edge of edges) {
    adjacency.get(edge.firstRingSystemId)?.push(edge.secondRingSystemId);
    adjacency.get(edge.secondRingSystemId)?.push(edge.firstRingSystemId);
  }
  for (const neighbors of adjacency.values()) {
    neighbors.sort((firstId, secondId) => firstId - secondId);
  }
  return adjacency;
}

function isConnectedRingPath(ringSystems, adjacency, edges) {
  if (ringSystems.length === 0 || edges.length !== ringSystems.length - 1) {
    return false;
  }
  let terminalCount = 0;
  for (const ringSystem of ringSystems) {
    const degree = adjacency.get(ringSystem.id)?.length ?? 0;
    if (degree > 2 || degree === 0) {
      return false;
    }
    if (degree === 1) {
      terminalCount++;
    }
  }
  if (ringSystems.length > 1 && terminalCount !== 2) {
    return false;
  }

  const visited = new Set();
  const stack = [ringSystems[0].id];
  while (stack.length > 0) {
    const ringSystemId = stack.pop();
    if (visited.has(ringSystemId)) {
      continue;
    }
    visited.add(ringSystemId);
    for (const neighborId of adjacency.get(ringSystemId) ?? []) {
      if (!visited.has(neighborId)) {
        stack.push(neighborId);
      }
    }
  }
  return visited.size === ringSystems.length;
}

function orderedRingSystemIdsForPath(ringSystems, adjacency) {
  const terminals = ringSystems
    .filter(ringSystem => (adjacency.get(ringSystem.id)?.length ?? 0) === 1)
    .map(ringSystem => ringSystem.id)
    .sort((firstId, secondId) => firstId - secondId);
  const startRingSystemId = terminals[0] ?? ringSystems[0]?.id ?? null;
  if (startRingSystemId == null) {
    return [];
  }

  const order = [];
  let previousRingSystemId = null;
  let currentRingSystemId = startRingSystemId;
  while (currentRingSystemId != null) {
    order.push(currentRingSystemId);
    const nextRingSystemId = (adjacency.get(currentRingSystemId) ?? []).find(neighborId => neighborId !== previousRingSystemId) ?? null;
    previousRingSystemId = currentRingSystemId;
    currentRingSystemId = nextRingSystemId;
  }
  return order;
}

/**
 * Detects large components that are mostly a path of simple isolated rings
 * connected by short hetero-containing linkers, such as sulfated and acetal
 * glycoside chains.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object|string[]} componentOrAtomIds - Component descriptor or atom IDs.
 * @param {object} [options] - Detection thresholds.
 * @returns {{ringSystems: object[], edges: object[], adjacency: Map<number, number[]>, terminalRingSystemIds: number[], orderedRingSystemIds: number[]}|null} Ring-chain descriptor.
 */
export function describePathLikeIsolatedRingChain(layoutGraph, componentOrAtomIds, options = {}) {
  const componentAtomIds = componentAtomIdSet(componentOrAtomIds);
  if (componentAtomIds.size > (options.atomCountCeiling ?? DEFAULT_ATOM_COUNT_CEILING)) {
    return null;
  }

  const ringSystems = componentRingSystems(layoutGraph, componentOrAtomIds);
  if (ringSystems.length < (options.minRingSystemCount ?? DEFAULT_MIN_RING_SYSTEM_COUNT)) {
    return null;
  }
  if (!ringSystems.every(ringSystem => isSimpleIsolatedRingSystem(layoutGraph, ringSystem))) {
    return null;
  }
  const heteroAtomCount = componentHeteroAtomCount(layoutGraph, componentOrAtomIds);
  if (heteroAtomCount < ringSystems.length * (options.heteroPerRingFloor ?? DEFAULT_HETERO_PER_RING_FLOOR)) {
    return null;
  }

  const edges = ringLinkEdges(layoutGraph, ringSystems, componentAtomIds);
  const adjacency = buildRingSystemAdjacency(ringSystems, edges);
  if (!isConnectedRingPath(ringSystems, adjacency, edges)) {
    return null;
  }
  return {
    ringSystems,
    edges,
    adjacency,
    orderedRingSystemIds: orderedRingSystemIdsForPath(ringSystems, adjacency),
    terminalRingSystemIds: ringSystems.filter(ringSystem => (adjacency.get(ringSystem.id)?.length ?? 0) === 1).map(ringSystem => ringSystem.id)
  };
}
