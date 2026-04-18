/** @module placement/atom-slice */

import { auditLayout } from '../audit/audit.js';
import { chooseScaffoldPlan } from '../scaffold/choose-scaffold.js';
import { buildCanonicalComponentSignature } from '../topology/canonical-order.js';
import { assignBondValidationClass, resolvePlacementValidationClass } from './bond-validation.js';
import { layoutMixedFamily } from '../families/mixed.js';
import { layoutAcyclicFamily } from '../families/acyclic.js';
import { layoutBridgedFamily } from '../families/bridged.js';
import {
  isBetterBridgedRescueForFusedSystem,
  layoutFusedCageKamadaKawai,
  layoutFusedFamily,
  shouldShortCircuitToFusedCageKk,
  shouldTryBridgedRescueForFusedSystem
} from '../families/fused.js';
import { layoutIsolatedRingFamily } from '../families/isolated-ring.js';
import { layoutMacrocycleFamily } from '../families/macrocycle.js';
import { layoutSpiroFamily } from '../families/spiro.js';
import { placeRemainingBranches } from './branch-placement.js';

/**
 * Returns whether an atom should participate in visible layout placement.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} atomId - Atom ID.
 * @returns {boolean} True when the atom participates in placement.
 */
export function isParticipantAtom(layoutGraph, atomId) {
  const atom = layoutGraph.atoms.get(atomId);
  if (!atom) {
    return false;
  }
  if (layoutGraph.options.suppressH && atom.element === 'H' && !atom.visible) {
    return false;
  }
  return true;
}

/**
 * Builds a canonical component-like descriptor for an atom slice.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string[]} atomIds - Atom IDs in the slice.
 * @param {string} id - Synthetic component ID.
 * @returns {{id: string, atomIds: string[], canonicalSignature: string}} Slice descriptor.
 */
export function createAtomSlice(layoutGraph, atomIds, id) {
  const uniqueAtomIds = [...new Set(atomIds)];
  return {
    id,
    atomIds: uniqueAtomIds,
    canonicalSignature: buildCanonicalComponentSignature(uniqueAtomIds, layoutGraph.canonicalAtomRank, layoutGraph.sourceMolecule)
  };
}

/**
 * Builds adjacency for an atom slice with optional bond filtering.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Iterable<string>} atomIds - Atom IDs to include.
 * @param {object} [options] - Adjacency options.
 * @param {(bond: object) => boolean} [options.includeBond] - Bond inclusion predicate.
 * @returns {Map<string, string[]>} Slice adjacency map.
 */
export function buildSliceAdjacency(layoutGraph, atomIds, options = {}) {
  const atomIdSet = new Set(atomIds);
  const includeBond = options.includeBond ?? (() => true);
  const adjacency = new Map([...atomIdSet].map(atomId => [atomId, []]));

  for (const bond of layoutGraph.bonds.values()) {
    if (!atomIdSet.has(bond.a) || !atomIdSet.has(bond.b) || !includeBond(bond)) {
      continue;
    }
    adjacency.get(bond.a)?.push(bond.b);
    adjacency.get(bond.b)?.push(bond.a);
  }

  for (const neighbors of adjacency.values()) {
    neighbors.sort((firstAtomId, secondAtomId) => {
      const firstRank = layoutGraph.canonicalAtomRank.get(firstAtomId) ?? Number.MAX_SAFE_INTEGER;
      const secondRank = layoutGraph.canonicalAtomRank.get(secondAtomId) ?? Number.MAX_SAFE_INTEGER;
      return firstRank - secondRank || String(firstAtomId).localeCompare(String(secondAtomId), 'en', { numeric: true });
    });
  }

  return adjacency;
}

/**
 * Returns ring descriptors fully contained within an atom slice.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Iterable<string>} atomIds - Slice atom IDs.
 * @returns {object[]} Ring descriptors.
 */
export function ringsForAtomSlice(layoutGraph, atomIds) {
  const atomIdSet = new Set(atomIds);
  return layoutGraph.rings.filter(ring => ring.atomIds.every(atomId => atomIdSet.has(atomId)));
}

/**
 * Returns ring-connection descriptors fully contained within a ring slice.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Iterable<number>} ringIds - Ring IDs in the slice.
 * @returns {object[]} Ring-connection descriptors.
 */
export function ringConnectionsForSlice(layoutGraph, ringIds) {
  const ringIdSet = new Set(ringIds);
  return layoutGraph.ringConnections.filter(connection => ringIdSet.has(connection.firstRingId) && ringIdSet.has(connection.secondRingId));
}

/**
 * Classifies the primary layout family for a slice.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string[]} atomIds - Slice atom IDs.
 * @param {object[]} sliceRings - Ring descriptors in the slice.
 * @param {object[]} sliceConnections - Ring-connection descriptors in the slice.
 * @param {{ignoreMetals?: boolean}} [options] - Classification options.
 * @returns {string} Slice family.
 */
export function classifyAtomSliceFamily(layoutGraph, atomIds, sliceRings, sliceConnections, options = {}) {
  const hasMetal = !options.ignoreMetals && atomIds.some(atomId => {
    const atom = layoutGraph.sourceMolecule.atoms.get(atomId);
    if (!atom || atom.name === 'H') {
      return false;
    }
    const group = atom.properties.group ?? 0;
    return group >= 3 && group <= 12;
  });
  if (hasMetal) {
    return 'organometallic';
  }
  if (sliceRings.some(ring => ring.size >= 12)) {
    return 'macrocycle';
  }
  if (sliceConnections.some(connection => connection.kind === 'bridged')) {
    return 'bridged';
  }
  if (sliceConnections.some(connection => connection.kind === 'spiro')) {
    return 'spiro';
  }
  if (sliceRings.length > 1) {
    return 'fused';
  }
  if (sliceRings.length === 1) {
    return 'isolated-ring';
  }
  return 'acyclic';
}

function auditSlicePlacement(layoutGraph, atomIds, family, placement, bondLength, templateId = null) {
  if (!placement || placement.coords.size === 0) {
    return null;
  }
  const validationClass = resolvePlacementValidationClass(family, placement.placementMode ?? 'constructed', templateId);
  const bondValidationClasses = assignBondValidationClass(layoutGraph, atomIds, validationClass);
  return auditLayout(layoutGraph, placement.coords, {
    bondLength,
    bondValidationClasses
  });
}

/**
 * Lays out a supported atom slice using the current family placers.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {{id: string, atomIds: string[], canonicalSignature?: string}} component - Slice descriptor.
 * @param {number} bondLength - Target bond length.
 * @param {object} [options] - Slice layout options.
 * @param {Map<string, string[]>} [options.adjacency] - Optional prebuilt adjacency.
 * @returns {{family: string, supported: boolean, atomIds: string[], coords: Map<string, {x: number, y: number}>, placementMode?: string|null, templateId?: string|null, bondValidationClasses: Map<string, 'planar'|'bridged'>}} Slice placement result.
 */
export function layoutAtomSlice(layoutGraph, component, bondLength, options = {}) {
  const participantAtomIds = new Set(component.atomIds.filter(atomId => isParticipantAtom(layoutGraph, atomId)));
  const atomIds = [...participantAtomIds];
  const adjacency = options.adjacency ?? buildSliceAdjacency(layoutGraph, participantAtomIds);
  const sliceRings = ringsForAtomSlice(layoutGraph, participantAtomIds);
  const sliceConnections = ringConnectionsForSlice(
    layoutGraph,
    sliceRings.map(ring => ring.id)
  );
  const heuristicFamily = classifyAtomSliceFamily(layoutGraph, atomIds, sliceRings, sliceConnections, {
    ignoreMetals: options.ignoreMetalsForFamily ?? false
  });
  const sliceComponent = {
    id: component.id,
    atomIds,
    canonicalSignature: component.canonicalSignature ?? buildCanonicalComponentSignature(atomIds, layoutGraph.canonicalAtomRank, layoutGraph.sourceMolecule)
  };
  const scaffoldPlan = chooseScaffoldPlan(layoutGraph, sliceComponent);
  const family = options.forceFamily ?? (heuristicFamily === 'organometallic' ? heuristicFamily : scaffoldPlan.rootScaffold.family);

  if (scaffoldPlan.mixedMode && !options.forceFamily) {
    return layoutMixedFamily(layoutGraph, sliceComponent, adjacency, scaffoldPlan, bondLength);
  }

  let result = null;
  if (family === 'acyclic') {
    result = { coords: layoutAcyclicFamily(adjacency, participantAtomIds, layoutGraph.canonicalAtomRank, bondLength, { layoutGraph }), ringCenters: new Map() };
  } else if (family === 'isolated-ring') {
    result = layoutIsolatedRingFamily(sliceRings[0], bondLength, { layoutGraph, templateId: scaffoldPlan.rootScaffold.templateId ?? null });
  } else if (family === 'macrocycle') {
    result = layoutMacrocycleFamily(sliceRings, bondLength, { layoutGraph, templateId: scaffoldPlan.rootScaffold.templateId ?? null });
  } else if (family === 'bridged') {
    result = layoutBridgedFamily(sliceRings, bondLength, { layoutGraph, templateId: scaffoldPlan.rootScaffold.templateId ?? null });
  } else if (family === 'fused') {
    const ringAdj = new Map(sliceRings.map(ring => [ring.id, []]));
    const ringConnectionByPair = new Map();
    for (const connection of sliceConnections) {
      if (connection.kind !== 'fused') {
        continue;
      }
      ringAdj.get(connection.firstRingId)?.push(connection.secondRingId);
      ringAdj.get(connection.secondRingId)?.push(connection.firstRingId);
      const key =
        connection.firstRingId < connection.secondRingId ? `${connection.firstRingId}:${connection.secondRingId}` : `${connection.secondRingId}:${connection.firstRingId}`;
      ringConnectionByPair.set(key, connection);
    }
    const templateId = scaffoldPlan.rootScaffold.templateId ?? null;
    if (shouldShortCircuitToFusedCageKk(atomIds.length, sliceRings.length, templateId)) {
      result = layoutFusedCageKamadaKawai(sliceRings, bondLength, { layoutGraph, templateId })
        ?? layoutFusedFamily(sliceRings, ringAdj, ringConnectionByPair, bondLength, { layoutGraph, templateId });
    } else {
      result = layoutFusedFamily(sliceRings, ringAdj, ringConnectionByPair, bondLength, { layoutGraph, templateId });
      let bestResult = result;
      let bestAudit = auditSlicePlacement(layoutGraph, atomIds, family, result, bondLength, templateId);
      if (shouldTryBridgedRescueForFusedSystem(atomIds.length, sliceRings.length, templateId, bestAudit)) {
      const bridgedResult = layoutBridgedFamily(sliceRings, bondLength, { layoutGraph, templateId });
      const bridgedAudit = auditSlicePlacement(layoutGraph, atomIds, family, bridgedResult, bondLength, templateId);
      if (isBetterBridgedRescueForFusedSystem(bridgedAudit, bestAudit)) {
        bestResult = bridgedResult;
        bestAudit = bridgedAudit;
      }

        const cageKkResult = layoutFusedCageKamadaKawai(sliceRings, bondLength, { layoutGraph, templateId });
      const cageKkAudit = auditSlicePlacement(layoutGraph, atomIds, family, cageKkResult, bondLength, templateId);
      if (isBetterBridgedRescueForFusedSystem(cageKkAudit, bestAudit)) {
        bestResult = cageKkResult;
        bestAudit = cageKkAudit;
      }
      }
      result = bestResult;
    }
  } else if (family === 'spiro') {
    const ringAdj = new Map(sliceRings.map(ring => [ring.id, []]));
    const ringConnectionByPair = new Map();
    for (const connection of sliceConnections) {
      if (connection.kind !== 'spiro') {
        continue;
      }
      ringAdj.get(connection.firstRingId)?.push(connection.secondRingId);
      ringAdj.get(connection.secondRingId)?.push(connection.firstRingId);
      const key =
        connection.firstRingId < connection.secondRingId ? `${connection.firstRingId}:${connection.secondRingId}` : `${connection.secondRingId}:${connection.firstRingId}`;
      ringConnectionByPair.set(key, connection);
    }
    result = layoutSpiroFamily(sliceRings, ringAdj, ringConnectionByPair, bondLength, { layoutGraph, templateId: scaffoldPlan.rootScaffold.templateId ?? null });
  }

  if (!result) {
    return {
      family,
      supported: false,
      atomIds,
      coords: new Map(),
      placementMode: null,
      templateId: scaffoldPlan.rootScaffold.templateId ?? null,
      bondValidationClasses: new Map()
    };
  }

  placeRemainingBranches(adjacency, layoutGraph.canonicalAtomRank, result.coords, participantAtomIds, [...result.coords.keys()], bondLength, layoutGraph);
  const placementMode = result.placementMode ?? 'constructed';
  const templateId = scaffoldPlan.rootScaffold.templateId ?? null;
  const bondValidationClasses = result.bondValidationClasses ?? assignBondValidationClass(layoutGraph, atomIds, resolvePlacementValidationClass(family, placementMode, templateId));
  return {
    family,
    supported: true,
    atomIds,
    coords: result.coords,
    placementMode,
    templateId,
    bondValidationClasses
  };
}
