/** @module model/scaffold-plan */

import { compareFallbackScaffolds } from '../scaffold/fallback-scaffold.js';
import { findTemplateMatch } from '../scaffold/template-match.js';

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
 * Classifies a ring system into a scaffold family.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} ringSystem - Ring-system descriptor.
 * @returns {'bridged'|'macrocycle'|'fused'|'spiro'|'isolated-ring'} Ring-system family.
 */
export function classifyRingSystemFamily(layoutGraph, ringSystem) {
  const connections = ringSystemConnections(layoutGraph, ringSystem);
  if (connections.some(connection => connection.kind === 'bridged')) {
    return 'bridged';
  }
  if (layoutGraph.rings.some(ring => ringSystem.ringIds.includes(ring.id) && ring.size >= 12)) {
    return 'macrocycle';
  }
  if (connections.some(connection => connection.kind === 'fused')) {
    return 'fused';
  }
  if (connections.some(connection => connection.kind === 'spiro')) {
    return 'spiro';
  }
  return 'isolated-ring';
}

function buildRingSystemCandidates(layoutGraph, component) {
  const componentAtomIdSet = new Set(component.atomIds);
  return layoutGraph.ringSystems
    .filter(ringSystem => ringSystem.atomIds.every(atomId => componentAtomIdSet.has(atomId)))
    .map(ringSystem => {
      const family = classifyRingSystemFamily(layoutGraph, ringSystem);
      const aromaticRingCount = ringSystem.ringIds.filter(ringId => layoutGraph.rings.find(ring => ring.id === ringId)?.aromatic).length;
      const candidate = {
        id: `ring-system:${ringSystem.id}`,
        type: 'ring-system',
        family,
        atomIds: [...ringSystem.atomIds],
        ringIds: [...ringSystem.ringIds],
        atomCount: ringSystem.atomIds.length,
        bondCount: countInternalBonds(layoutGraph, ringSystem.atomIds),
        ringCount: ringSystem.ringIds.length,
        aromaticRingCount,
        signature: ringSystem.signature
      };
      const templateMatch = findTemplateMatch(layoutGraph, candidate);
      return {
        ...candidate,
        templateMatch,
        templateId: templateMatch?.id ?? null
      };
    })
    .sort(compareFallbackScaffolds);
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

/**
 * Builds a deterministic scaffold plan for a connected component.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} component - Connected-component descriptor.
 * @returns {object} Scaffold plan.
 */
export function buildScaffoldPlan(layoutGraph, component) {
  const ringSystemCandidates = buildRingSystemCandidates(layoutGraph, component);
  const candidates = ringSystemCandidates.length > 0 ? ringSystemCandidates : [buildAcyclicCandidate(component)];
  const rootScaffold = candidates[0];
  const rootAtomIdSet = new Set(rootScaffold.atomIds);
  const nonRingAtomIds = component.atomIds.filter(atomId => !layoutGraph.ringSystems.some(ringSystem => ringSystem.atomIds.includes(atomId)));
  const placementSequence = [
    {
      kind: 'root-scaffold',
      candidateId: rootScaffold.id,
      family: rootScaffold.family,
      templateId: rootScaffold.templateId ?? null,
      atomIds: [...rootScaffold.atomIds],
      ringIds: [...rootScaffold.ringIds]
    },
    ...candidates
      .slice(1)
      .map(candidate => ({
        kind: candidate.type === 'ring-system' ? 'ring-system' : 'acyclic',
        candidateId: candidate.id,
        family: candidate.family,
        templateId: candidate.templateId ?? null,
        atomIds: [...candidate.atomIds],
        ringIds: [...candidate.ringIds]
      }))
  ];

  if (nonRingAtomIds.length > 0) {
    placementSequence.push({
      kind: 'chains',
      candidateId: 'chains',
      family: 'acyclic',
      templateId: null,
      atomIds: [...nonRingAtomIds],
      ringIds: []
    });
  }

  return {
    componentId: component.id,
    candidates,
    rootScaffold,
    nonRingAtomIds,
    mixedMode: candidates.length > 1 || component.atomIds.some(atomId => !rootAtomIdSet.has(atomId)),
    placementSequence
  };
}
