/** @module model/scaffold-plan */

import { compareFallbackScaffolds } from '../scaffold/fallback-scaffold.js';
import { findTemplateMatch, findTemplateMatchIgnoringFamily } from '../templates/match.js';

const TERMINAL_MIXED_ROOT_MIN_RING_SYSTEMS = 3;
const TERMINAL_MIXED_ROOT_MAX_RING_SYSTEMS = 12;

function ringSystemConnections(layoutGraph, ringSystem) {
  const ringIdSet = new Set(ringSystem.ringIds);
  return layoutGraph.ringConnections.filter(connection => ringIdSet.has(connection.firstRingId) && ringIdSet.has(connection.secondRingId));
}

function countInternalBonds(layoutGraph, atomIds) {
  const atomIdSet = new Set(atomIds);
  let count = 0;
  for (const bond of layoutGraph.bonds.values()) {
    if (atomIdSet.has(bond.a) && atomIdSet.has(bond.b)) {
      count++;
    }
  }
  return count;
}

/**
 * Resolves the final family and template match for a ring-system candidate.
 * When the heuristic family label misses a known exact template, the template
 * family wins so later placement can use the correct dedicated family path.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} candidate - Ring-system candidate.
 * @returns {{family: string, templateMatch: object|null, templateId: string|null}} Resolved family data.
 */
function resolveCandidateFamily(layoutGraph, candidate) {
  const strictMatch = findTemplateMatch(layoutGraph, candidate);
  if (strictMatch) {
    return {
      family: candidate.family,
      templateMatch: strictMatch,
      templateId: strictMatch.id
    };
  }

  const fallbackMatch = findTemplateMatchIgnoringFamily(layoutGraph, candidate);
  if (fallbackMatch) {
    return {
      family: fallbackMatch.family,
      templateMatch: fallbackMatch,
      templateId: fallbackMatch.id
    };
  }

  return {
    family: candidate.family,
    templateMatch: null,
    templateId: null
  };
}

/**
 * Classifies a ring system into a scaffold family.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} ringSystem - Ring-system descriptor.
 * @returns {'bridged'|'macrocycle'|'fused'|'spiro'|'isolated-ring'} Ring-system family.
 */
export function classifyRingSystemFamily(layoutGraph, ringSystem) {
  const connections = ringSystemConnections(layoutGraph, ringSystem);
  if (layoutGraph.rings.some(ring => ringSystem.ringIds.includes(ring.id) && ring.size >= 12)) {
    return 'macrocycle';
  }
  const connectionKinds = new Set(connections.map(connection => connection.kind).filter(Boolean));
  if (connectionKinds.has('bridged')) {
    return 'bridged';
  }
  // Hybrid ring systems such as fused-plus-spiro scaffolds do not fit the
  // dedicated planar fused/spiro placers, so route them through the more
  // general bridged/KK fallback family instead of returning a partial layout.
  if (connectionKinds.size > 1) {
    return 'bridged';
  }
  if (connectionKinds.has('fused')) {
    return 'fused';
  }
  if (connectionKinds.has('spiro')) {
    return 'spiro';
  }
  return 'isolated-ring';
}

function buildRingSystemCandidates(layoutGraph, component) {
  const componentAtomIdSet = new Set(component.atomIds);
  return layoutGraph.ringSystems
    .filter(ringSystem => ringSystem.atomIds.every(atomId => componentAtomIdSet.has(atomId)))
    .map(ringSystem => {
      const classifiedFamily = classifyRingSystemFamily(layoutGraph, ringSystem);
      const aromaticRingCount = ringSystem.ringIds.filter(ringId => layoutGraph.rings.find(ring => ring.id === ringId)?.aromatic).length;
      const candidate = {
        id: `ring-system:${ringSystem.id}`,
        type: 'ring-system',
        family: classifiedFamily,
        atomIds: [...ringSystem.atomIds],
        ringIds: [...ringSystem.ringIds],
        atomCount: ringSystem.atomIds.length,
        bondCount: countInternalBonds(layoutGraph, ringSystem.atomIds),
        ringCount: ringSystem.ringIds.length,
        aromaticRingCount,
        signature: ringSystem.signature
      };
      const resolved = resolveCandidateFamily(layoutGraph, candidate);
      return {
        ...candidate,
        family: resolved.family,
        templateMatch: resolved.templateMatch,
        templateId: resolved.templateId
      };
    })
    .sort(compareFallbackScaffolds);
}

function componentHeavyNonRingAtomIds(layoutGraph, component, candidateAtomIdSet) {
  return component.atomIds.filter(atomId => {
    if (candidateAtomIdSet.has(atomId)) {
      return false;
    }
    const atom = layoutGraph.atoms.get(atomId);
    return atom && atom.element !== 'H';
  });
}

function buildRingCandidateLinkGraph(layoutGraph, component, candidates) {
  const candidateIds = new Set(candidates.map(candidate => candidate.id));
  const adjacency = new Map(candidates.map(candidate => [candidate.id, new Set()]));
  const atomToCandidateId = new Map();
  const candidateAtomIdSet = new Set();

  for (const candidate of candidates) {
    for (const atomId of candidate.atomIds) {
      atomToCandidateId.set(atomId, candidate.id);
      candidateAtomIdSet.add(atomId);
    }
  }

  for (const bond of layoutGraph.bonds.values()) {
    const firstCandidateId = atomToCandidateId.get(bond.a);
    const secondCandidateId = atomToCandidateId.get(bond.b);
    if (firstCandidateId && secondCandidateId && firstCandidateId !== secondCandidateId) {
      adjacency.get(firstCandidateId)?.add(secondCandidateId);
      adjacency.get(secondCandidateId)?.add(firstCandidateId);
    }
  }

  const componentAtomIdSet = new Set(component.atomIds);
  const visitedAtomIds = new Set();
  for (const seedAtomId of componentHeavyNonRingAtomIds(layoutGraph, component, candidateAtomIdSet)) {
    if (visitedAtomIds.has(seedAtomId)) {
      continue;
    }

    const touchedCandidateIds = new Set();
    const queue = [seedAtomId];
    visitedAtomIds.add(seedAtomId);
    for (let queueIndex = 0; queueIndex < queue.length; queueIndex++) {
      const atomId = queue[queueIndex];
      for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
        const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
        if (!componentAtomIdSet.has(neighborAtomId)) {
          continue;
        }
        const neighborCandidateId = atomToCandidateId.get(neighborAtomId);
        if (neighborCandidateId) {
          touchedCandidateIds.add(neighborCandidateId);
          continue;
        }
        const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
        if (!neighborAtom || neighborAtom.element === 'H' || visitedAtomIds.has(neighborAtomId)) {
          continue;
        }
        visitedAtomIds.add(neighborAtomId);
        queue.push(neighborAtomId);
      }
    }

    const touchedIds = [...touchedCandidateIds].filter(candidateId => candidateIds.has(candidateId));
    for (let firstIndex = 0; firstIndex < touchedIds.length; firstIndex++) {
      for (let secondIndex = firstIndex + 1; secondIndex < touchedIds.length; secondIndex++) {
        adjacency.get(touchedIds[firstIndex])?.add(touchedIds[secondIndex]);
        adjacency.get(touchedIds[secondIndex])?.add(touchedIds[firstIndex]);
      }
    }
  }

  return adjacency;
}

function graphDistances(adjacency, sourceId) {
  const distances = new Map([[sourceId, 0]]);
  const queue = [sourceId];
  for (let queueIndex = 0; queueIndex < queue.length; queueIndex++) {
    const id = queue[queueIndex];
    const nextDistance = distances.get(id) + 1;
    for (const neighborId of adjacency.get(id) ?? []) {
      if (distances.has(neighborId)) {
        continue;
      }
      distances.set(neighborId, nextDistance);
      queue.push(neighborId);
    }
  }
  return distances;
}

function isConnectedRingCandidateGraph(adjacency) {
  const firstId = adjacency.keys().next().value;
  if (!firstId) {
    return false;
  }
  return graphDistances(adjacency, firstId).size === adjacency.size;
}

function hasConfiguredChiralAtoms(layoutGraph) {
  for (const atom of layoutGraph.atoms.values()) {
    if (atom?.chirality) {
      return true;
    }
  }
  return false;
}

function preferredTerminalMixedRootCandidate(layoutGraph, component, candidates) {
  if (candidates.length < TERMINAL_MIXED_ROOT_MIN_RING_SYSTEMS || candidates.length > TERMINAL_MIXED_ROOT_MAX_RING_SYSTEMS) {
    return null;
  }
  if (candidates.some(candidate => candidate.type !== 'ring-system')) {
    return null;
  }

  const isolatedCandidates = candidates.filter(candidate => candidate.family === 'isolated-ring' && candidate.ringCount === 1);
  const nonIsolatedCandidates = candidates.filter(candidate => candidate.family !== 'isolated-ring');
  const supportedTopology = isolatedCandidates.length === candidates.length || (nonIsolatedCandidates.length === 1 && isolatedCandidates.length >= 2);
  if (!supportedTopology) {
    return null;
  }
  if (nonIsolatedCandidates.length > 0 && candidates.some(candidate => candidate.aromaticRingCount > 0)) {
    return null;
  }
  const hasAromaticCandidate = candidates.some(candidate => candidate.aromaticRingCount > 0);
  const heavyAtomCount = layoutGraph.traits?.heavyAtomCount ?? layoutGraph.atoms.size;
  if (hasAromaticCandidate && (heavyAtomCount < 44 || hasConfiguredChiralAtoms(layoutGraph))) {
    return null;
  }

  const adjacency = buildRingCandidateLinkGraph(layoutGraph, component, candidates);
  if (!isConnectedRingCandidateGraph(adjacency)) {
    return null;
  }

  const edgeCount = [...adjacency.values()].reduce((sum, neighborIds) => sum + neighborIds.size, 0) / 2;
  if (edgeCount > candidates.length + 3) {
    return null;
  }

  const orderByCandidateId = new Map(candidates.map((candidate, index) => [candidate.id, index]));
  const terminalCandidates = isolatedCandidates.filter(candidate => (adjacency.get(candidate.id)?.size ?? 0) === 1);
  if (terminalCandidates.length === 0) {
    return null;
  }

  let preferred = null;
  if (nonIsolatedCandidates.length === 1) {
    const distances = graphDistances(adjacency, nonIsolatedCandidates[0].id);
    preferred = [...terminalCandidates].sort((firstCandidate, secondCandidate) => {
      const firstDistance = distances.get(firstCandidate.id) ?? Number.MAX_SAFE_INTEGER;
      const secondDistance = distances.get(secondCandidate.id) ?? Number.MAX_SAFE_INTEGER;
      return firstDistance - secondDistance || (orderByCandidateId.get(firstCandidate.id) ?? 0) - (orderByCandidateId.get(secondCandidate.id) ?? 0);
    })[0];
  } else {
    const distances = graphDistances(adjacency, candidates[0].id);
    const branchHubTerminalCandidates = terminalCandidates.filter(candidate => {
      if (candidate.id === candidates[0].id) {
        return false;
      }
      const [neighborId] = [...(adjacency.get(candidate.id) ?? [])];
      return (adjacency.get(neighborId)?.size ?? 0) >= 3;
    });
    const terminalPool = branchHubTerminalCandidates.length > 0 ? branchHubTerminalCandidates : terminalCandidates;
    preferred = [...terminalPool].sort((firstCandidate, secondCandidate) => {
      const firstNeighborId = [...(adjacency.get(firstCandidate.id) ?? [])][0];
      const secondNeighborId = [...(adjacency.get(secondCandidate.id) ?? [])][0];
      const firstNeighborDegree = adjacency.get(firstNeighborId)?.size ?? 0;
      const secondNeighborDegree = adjacency.get(secondNeighborId)?.size ?? 0;
      if (branchHubTerminalCandidates.length > 0 && firstNeighborDegree !== secondNeighborDegree) {
        return secondNeighborDegree - firstNeighborDegree;
      }
      const firstDistance = distances.get(firstCandidate.id) ?? -1;
      const secondDistance = distances.get(secondCandidate.id) ?? -1;
      return secondDistance - firstDistance || (orderByCandidateId.get(secondCandidate.id) ?? 0) - (orderByCandidateId.get(firstCandidate.id) ?? 0);
    })[0];
  }

  if (!preferred || preferred.id === candidates[0].id) {
    return null;
  }

  return {
    ...preferred,
    fastMixedRootSelection: 'terminal-ring-chain'
  };
}

function prioritizeTerminalMixedRoot(layoutGraph, component, candidates) {
  const preferred = preferredTerminalMixedRootCandidate(layoutGraph, component, candidates);
  if (!preferred) {
    return candidates;
  }
  return [preferred, ...candidates.filter(candidate => candidate.id !== preferred.id)];
}

function buildAcyclicCandidate(component) {
  return {
    id: 'acyclic-backbone',
    type: 'acyclic',
    family: 'acyclic',
    atomIds: [...component.atomIds],
    ringIds: [],
    atomCount: component.atomIds.length,
    bondCount: component.atomIds.length > 0 ? component.atomIds.length - 1 : 0,
    ringCount: 0,
    aromaticRingCount: 0,
    signature: `acyclic|${component.canonicalSignature}`,
    templateMatch: null,
    templateId: null
  };
}

function scaffoldPlanCacheKey(component) {
  const atomIds = Array.isArray(component?.atomIds) ? [...component.atomIds].sort() : [];
  const signature = component?.canonicalSignature ? `|${component.canonicalSignature}` : '';
  return `${component?.id ?? 'component'}|${atomIds.join(',')}${signature}`;
}

/**
 * Builds a deterministic scaffold plan for a connected component.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} component - Connected-component descriptor.
 * @returns {object} Scaffold plan.
 */
export function buildScaffoldPlan(layoutGraph, component) {
  const scaffoldPlanCache = layoutGraph?.scaffoldPlanCache ?? (layoutGraph ? (layoutGraph.scaffoldPlanCache = new Map()) : null);
  const cacheKey = scaffoldPlanCache ? scaffoldPlanCacheKey(component) : null;
  if (scaffoldPlanCache?.has(cacheKey)) {
    return scaffoldPlanCache.get(cacheKey);
  }

  const ringSystemCandidates = prioritizeTerminalMixedRoot(layoutGraph, component, buildRingSystemCandidates(layoutGraph, component));
  const candidates = ringSystemCandidates.length > 0 ? ringSystemCandidates : [buildAcyclicCandidate(component)];
  const rootScaffold = candidates[0];
  const nonRingAtomIds = component.atomIds.filter(atomId => {
    const atom = layoutGraph.sourceMolecule.atoms.get(atomId);
    if (!atom || atom.name === 'H') {
      return false;
    }
    return !layoutGraph.ringSystems.some(ringSystem => ringSystem.atomIds.includes(atomId));
  });
  const placementSequence = [
    {
      kind: 'root-scaffold',
      candidateId: rootScaffold.id,
      family: rootScaffold.family,
      templateId: rootScaffold.templateId ?? null,
      atomIds: [...rootScaffold.atomIds],
      ringIds: [...rootScaffold.ringIds]
    },
    ...candidates.slice(1).map(candidate => ({
      kind: candidate.type === 'ring-system' ? 'ring-system' : 'acyclic',
      candidateId: candidate.id,
      family: candidate.family,
      templateId: candidate.templateId ?? null,
      atomIds: [...candidate.atomIds],
      ringIds: [...candidate.ringIds]
    }))
  ];

  if (rootScaffold.type !== 'acyclic' && nonRingAtomIds.length > 0) {
    placementSequence.push({
      kind: 'chains',
      candidateId: 'chains',
      family: 'acyclic',
      templateId: null,
      atomIds: [...nonRingAtomIds],
      ringIds: []
    });
  }

  const scaffoldPlan = {
    componentId: component.id,
    candidates,
    rootScaffold,
    rootSelectionMode: rootScaffold.fastMixedRootSelection ?? null,
    nonRingAtomIds,
    mixedMode: rootScaffold.type !== 'acyclic' && (candidates.length > 1 || nonRingAtomIds.length > 0),
    placementSequence
  };
  if (scaffoldPlanCache) {
    scaffoldPlanCache.set(cacheKey, scaffoldPlan);
  }
  return scaffoldPlan;
}
