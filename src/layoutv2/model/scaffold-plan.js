/** @module model/scaffold-plan */

import { compareFallbackScaffolds } from '../scaffold/fallback-scaffold.js';
import { findTemplateMatch, findTemplateMatchIgnoringFamily } from '../scaffold/template-match.js';

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

  return {
    componentId: component.id,
    candidates,
    rootScaffold,
    nonRingAtomIds,
    mixedMode: rootScaffold.type !== 'acyclic' && (candidates.length > 1 || nonRingAtomIds.length > 0),
    placementSequence
  };
}
