/** @module placement/component-layout */

import { auditLayout } from '../audit/audit.js';
import { ORGANOMETALLIC_RESCUE_LIMITS, PROTECTED_FAMILY_RIGID_SUBTREE_LIMITS } from '../constants.js';
import { alignCoordsToFixed } from '../geometry/transforms.js';
import { layoutLargeMoleculeFamily } from '../families/large-molecule.js';
import { layoutOrganometallicFamily } from '../families/organometallic.js';
import { rigidDescriptorKey } from '../cleanup/rigid-rotation.js';
import { assignBondValidationClass, mergeBondValidationClasses } from './bond-validation.js';
import { exceedsLargeComponentThreshold } from '../topology/large-blocks.js';
import { findMacrocycleRings } from '../topology/macrocycles.js';
import { layoutAtomSlice } from './atom-slice.js';
import { packComponentPlacements } from './fragment-packing.js';
import { buildComponentFixedCoords, buildRefinementContext, canPreserveComponentPlacement, preserveComponentPlacement } from './refinement.js';

function isLargeComponent(layoutGraph, component) {
  return exceedsLargeComponentThreshold(layoutGraph, component);
}

function componentContainsMacrocycle(macrocycleRings, component) {
  const componentAtomIds = new Set(component.atomIds);
  return macrocycleRings.some(ring => ring.atomIds.every(atomId => componentAtomIds.has(atomId)));
}

/**
 * Returns whether a component contains a transition-metal atom.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} component - Connected-component descriptor.
 * @returns {boolean} `true` when the component contains a transition metal.
 */
function componentContainsMetal(layoutGraph, component) {
  return component.atomIds.some(atomId => {
    const atom = layoutGraph.sourceMolecule.atoms.get(atomId);
    const group = atom?.properties?.group ?? 0;
    return atom?.name !== 'H' && group >= 3 && group <= 12;
  });
}

function mergeCleanupRigidSubtreesByAtomId(target, source) {
  if (!(source instanceof Map) || source.size === 0) {
    return;
  }
  for (const [atomId, descriptors] of source) {
    const mergedDescriptors = target.get(atomId) ?? [];
    const nextDescriptors = Array.isArray(descriptors) ? descriptors : [descriptors];
    const seenDescriptorKeys = new Set(mergedDescriptors.map(rigidDescriptorKey));
    for (const descriptor of nextDescriptors) {
      const key = rigidDescriptorKey(descriptor);
      if (seenDescriptorKeys.has(key)) {
        continue;
      }
      mergedDescriptors.push(descriptor);
      seenDescriptorKeys.add(key);
    }
    mergedDescriptors.sort((firstDescriptor, secondDescriptor) => {
      if (firstDescriptor.subtreeAtomIds.length !== secondDescriptor.subtreeAtomIds.length) {
        return firstDescriptor.subtreeAtomIds.length - secondDescriptor.subtreeAtomIds.length;
      }
      if (firstDescriptor.rootAtomId !== secondDescriptor.rootAtomId) {
        return firstDescriptor.rootAtomId.localeCompare(secondDescriptor.rootAtomId, 'en', { numeric: true });
      }
      return firstDescriptor.anchorAtomId.localeCompare(secondDescriptor.anchorAtomId, 'en', { numeric: true });
    });
    target.set(atomId, mergedDescriptors);
  }
}

function componentMacrocycleAtomIds(macrocycleRings, component) {
  const componentAtomIds = new Set(component.atomIds);
  const macrocycleAtomIds = new Set();
  for (const ring of macrocycleRings) {
    if (!ring.atomIds.every(atomId => componentAtomIds.has(atomId))) {
      continue;
    }
    for (const atomId of ring.atomIds) {
      macrocycleAtomIds.add(atomId);
    }
  }
  return macrocycleAtomIds;
}

function componentMetalAtomIds(layoutGraph, component) {
  const metalAtomIds = new Set();
  for (const atomId of component.atomIds) {
    const atom = layoutGraph.sourceMolecule.atoms.get(atomId);
    const group = atom?.properties?.group ?? 0;
    if (atom?.name !== 'H' && group >= 3 && group <= 12) {
      metalAtomIds.add(atomId);
    }
  }
  return metalAtomIds;
}

function componentHasRingConnectionKind(layoutGraph, component, kind) {
  const componentAtomIds = new Set(component.atomIds);
  return (layoutGraph.ringConnections ?? []).some(connection => {
    return connection.kind === kind && connection.sharedAtomIds.every(atomId => componentAtomIds.has(atomId));
  });
}

function componentRingCount(layoutGraph, component) {
  const componentAtomIds = new Set(component.atomIds);
  return layoutGraph.rings.filter(ring => ring.atomIds.every(atomId => componentAtomIds.has(atomId))).length;
}

function collectParticipantSubtree(layoutGraph, startAtomId, blockedAtomId, participantAtomIds) {
  const subtreeAtomIds = new Set();
  if (!participantAtomIds.has(startAtomId) || startAtomId === blockedAtomId) {
    return subtreeAtomIds;
  }
  const stack = [startAtomId];
  subtreeAtomIds.add(startAtomId);

  while (stack.length > 0) {
    const atomId = stack.pop();
    for (const bond of layoutGraph.bondsByAtomId?.get(atomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
      if (neighborAtomId === blockedAtomId || !participantAtomIds.has(neighborAtomId) || subtreeAtomIds.has(neighborAtomId)) {
        continue;
      }
      subtreeAtomIds.add(neighborAtomId);
      stack.push(neighborAtomId);
    }
  }

  return subtreeAtomIds;
}

function appendRigidCleanupDescriptor(descriptorsByAtomId, descriptor) {
  for (const atomId of descriptor.subtreeAtomIds) {
    const descriptors = descriptorsByAtomId.get(atomId) ?? [];
    descriptors.push(descriptor);
    descriptorsByAtomId.set(atomId, descriptors);
  }
}

function isTerminalMultipleBondHeteroRoot(layoutGraph, bond, anchorAtomId, rootAtomId) {
  if (!bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) < 2) {
    return false;
  }
  const rootAtom = layoutGraph.atoms.get(rootAtomId);
  if (!rootAtom || rootAtom.element === 'H' || rootAtom.element === 'C') {
    return false;
  }
  if ((layoutGraph.atomToRings?.get(rootAtomId)?.length ?? 0) > 0) {
    return false;
  }
  let heavyNeighborCount = 0;
  for (const incidentBond of layoutGraph.bondsByAtomId?.get(rootAtomId) ?? []) {
    if (!incidentBond || incidentBond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = incidentBond.a === rootAtomId ? incidentBond.b : incidentBond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H') {
      continue;
    }
    if (neighborAtomId === anchorAtomId) {
      continue;
    }
    heavyNeighborCount++;
  }
  return heavyNeighborCount === 0;
}

function buildCoreAnchoredRigidSubtrees(layoutGraph, component, placementAtomIds, coreAtomIds, options = {}) {
  const descriptorsByAtomId = new Map();
  if (!(coreAtomIds instanceof Set) || coreAtomIds.size === 0 || placementAtomIds.length === 0) {
    return descriptorsByAtomId;
  }

  const participantAtomIds = new Set(placementAtomIds);
  const seenAnchorRootPairs = new Set();
  const componentAtomCount = placementAtomIds.length;

  for (const anchorAtomId of coreAtomIds) {
    if (!participantAtomIds.has(anchorAtomId)) {
      continue;
    }
    for (const bond of layoutGraph.bondsByAtomId?.get(anchorAtomId) ?? []) {
      if (!bond || (bond.kind !== 'covalent' && !(options.allowCoordinateRoots && bond.kind === 'coordinate'))) {
        continue;
      }

      const rootAtomId = bond.a === anchorAtomId ? bond.b : bond.a;
      const allowTerminalMultipleBondRoot =
        isTerminalMultipleBondHeteroRoot(layoutGraph, bond, anchorAtomId, rootAtomId);
      if (bond.kind === 'covalent' && (bond.inRing || ((bond.order ?? 1) !== 1 && !allowTerminalMultipleBondRoot))) {
        continue;
      }
      if (!participantAtomIds.has(rootAtomId) || coreAtomIds.has(rootAtomId)) {
        continue;
      }

      const pairKey = anchorAtomId < rootAtomId ? `${anchorAtomId}:${rootAtomId}` : `${rootAtomId}:${anchorAtomId}`;
      if (seenAnchorRootPairs.has(pairKey)) {
        continue;
      }

      const subtreeAtomIds = [...collectParticipantSubtree(layoutGraph, rootAtomId, anchorAtomId, participantAtomIds)];
      if (subtreeAtomIds.length === 0 || subtreeAtomIds.length >= componentAtomCount) {
        continue;
      }
      if (subtreeAtomIds.some(atomId => coreAtomIds.has(atomId))) {
        continue;
      }
      if (subtreeAtomIds.some(atomId => layoutGraph.fixedCoords.has(atomId))) {
        continue;
      }

      const heavyAtomCount = subtreeAtomIds.filter(atomId => layoutGraph.atoms.get(atomId)?.element !== 'H').length;
      if (
        heavyAtomCount === 0
        || heavyAtomCount > PROTECTED_FAMILY_RIGID_SUBTREE_LIMITS.maxHeavyAtomCount
        || subtreeAtomIds.length > PROTECTED_FAMILY_RIGID_SUBTREE_LIMITS.maxAtomCount
        || subtreeAtomIds.length >= componentAtomCount * PROTECTED_FAMILY_RIGID_SUBTREE_LIMITS.maxComponentFraction
      ) {
        continue;
      }

      seenAnchorRootPairs.add(pairKey);
      appendRigidCleanupDescriptor(descriptorsByAtomId, {
        anchorAtomId,
        rootAtomId,
        subtreeAtomIds
      });
    }
  }

  return descriptorsByAtomId;
}

function buildProtectedFamilyCleanupRigidSubtreesByAtomId(layoutGraph, component, placement, macrocycleRings = []) {
  if (!placement?.supported || placement.coords.size === 0 || placement.atomIds.length === 0) {
    return new Map();
  }

  const protectedDescriptors = new Map();
  const macrocycleAtomIds = componentMacrocycleAtomIds(macrocycleRings, component);
  if (macrocycleAtomIds.size > 0) {
    mergeCleanupRigidSubtreesByAtomId(
      protectedDescriptors,
      buildCoreAnchoredRigidSubtrees(layoutGraph, component, placement.atomIds, macrocycleAtomIds)
    );
  }

  const shouldUseRingCoreDescriptors =
    placement.family === 'bridged'
    || placement.family === 'fused'
    || (placement.family === 'mixed'
      && (componentHasRingConnectionKind(layoutGraph, component, 'bridged') || componentHasRingConnectionKind(layoutGraph, component, 'fused')));
  if (shouldUseRingCoreDescriptors) {
    const ringCoreAtomIds = new Set(component.atomIds.filter(atomId => layoutGraph.ringAtomIds?.has(atomId)));
    mergeCleanupRigidSubtreesByAtomId(
      protectedDescriptors,
      buildCoreAnchoredRigidSubtrees(layoutGraph, component, placement.atomIds, ringCoreAtomIds)
    );
  }

  const metalAtomIds = componentMetalAtomIds(layoutGraph, component);
  if (metalAtomIds.size > 0) {
    mergeCleanupRigidSubtreesByAtomId(
      protectedDescriptors,
      buildCoreAnchoredRigidSubtrees(layoutGraph, component, placement.atomIds, metalAtomIds, {
        allowCoordinateRoots: true
      })
    );
  }

  return protectedDescriptors;
}

function withProtectedCleanupRigidSubtrees(layoutGraph, component, placement, macrocycleRings = []) {
  if (!placement?.supported) {
    return placement;
  }
  const cleanupRigidSubtreesByAtomId = buildProtectedFamilyCleanupRigidSubtreesByAtomId(layoutGraph, component, placement, macrocycleRings);
  if (cleanupRigidSubtreesByAtomId.size === 0) {
    return placement;
  }
  return {
    ...placement,
    cleanupRigidSubtreesByAtomId: (() => {
      const merged = new Map();
      mergeCleanupRigidSubtreesByAtomId(merged, placement.cleanupRigidSubtreesByAtomId);
      mergeCleanupRigidSubtreesByAtomId(merged, cleanupRigidSubtreesByAtomId);
      return merged;
    })()
  };
}

function placementAuditScore(layoutGraph, placement) {
  if (!placement?.supported || placement.coords.size === 0) {
    return null;
  }
  const audit = auditLayout(layoutGraph, placement.coords, {
    bondLength: layoutGraph.options.bondLength,
    bondValidationClasses: placement.bondValidationClasses
  });
  return { placement, audit };
}

function isMacrocyclePreferredPlacement(candidateScore, incumbentScore) {
  if (!candidateScore) {
    return false;
  }
  if (!incumbentScore) {
    return true;
  }
  if (candidateScore.audit.collapsedMacrocycleCount !== incumbentScore.audit.collapsedMacrocycleCount) {
    return candidateScore.audit.collapsedMacrocycleCount < incumbentScore.audit.collapsedMacrocycleCount;
  }
  if (candidateScore.audit.bondLengthFailureCount !== incumbentScore.audit.bondLengthFailureCount) {
    return candidateScore.audit.bondLengthFailureCount < incumbentScore.audit.bondLengthFailureCount;
  }
  if (candidateScore.audit.severeOverlapCount !== incumbentScore.audit.severeOverlapCount) {
    return candidateScore.audit.severeOverlapCount < incumbentScore.audit.severeOverlapCount;
  }
  if (Math.abs(candidateScore.audit.maxBondLengthDeviation - incumbentScore.audit.maxBondLengthDeviation) > 1e-6) {
    return candidateScore.audit.maxBondLengthDeviation < incumbentScore.audit.maxBondLengthDeviation;
  }
  return candidateScore.placement.family !== 'large-molecule' && incumbentScore.placement.family === 'large-molecule';
}

function isOrganometallicPreferredPlacement(candidateScore, incumbentScore) {
  if (!candidateScore) {
    return false;
  }
  if (!incumbentScore) {
    return true;
  }
  if (candidateScore.audit.bondLengthFailureCount !== incumbentScore.audit.bondLengthFailureCount) {
    return candidateScore.audit.bondLengthFailureCount < incumbentScore.audit.bondLengthFailureCount;
  }
  if (Math.abs(candidateScore.audit.maxBondLengthDeviation - incumbentScore.audit.maxBondLengthDeviation) > 1e-6) {
    return candidateScore.audit.maxBondLengthDeviation < incumbentScore.audit.maxBondLengthDeviation;
  }
  if (candidateScore.audit.severeOverlapCount !== incumbentScore.audit.severeOverlapCount) {
    return candidateScore.audit.severeOverlapCount < incumbentScore.audit.severeOverlapCount;
  }
  return candidateScore.placement.family === 'organometallic' && incumbentScore.placement.family !== 'organometallic';
}

function isMetalMixedRingRescuePreferredPlacement(candidateScore, incumbentScore) {
  if (!candidateScore) {
    return false;
  }
  if (!incumbentScore) {
    return true;
  }
  if (candidateScore.audit.bondLengthFailureCount !== incumbentScore.audit.bondLengthFailureCount) {
    return candidateScore.audit.bondLengthFailureCount < incumbentScore.audit.bondLengthFailureCount;
  }
  if (Math.abs(candidateScore.audit.maxBondLengthDeviation - incumbentScore.audit.maxBondLengthDeviation) > 1e-6) {
    return candidateScore.audit.maxBondLengthDeviation < incumbentScore.audit.maxBondLengthDeviation;
  }
  if (candidateScore.audit.severeOverlapCount !== incumbentScore.audit.severeOverlapCount) {
    return candidateScore.audit.severeOverlapCount < incumbentScore.audit.severeOverlapCount;
  }
  return candidateScore.placement.family !== 'mixed' && incumbentScore.placement.family === 'mixed';
}

function shouldTryOrganometallicMixedRingRescue(layoutGraph, component, familyPlacement) {
  if (!familyPlacement?.supported || familyPlacement.family !== 'mixed') {
    return false;
  }
  const metalAtomIds = componentMetalAtomIds(layoutGraph, component);
  if (metalAtomIds.size !== 1) {
    return false;
  }
  if (component.atomIds.length < ORGANOMETALLIC_RESCUE_LIMITS.mixedRingSystemRescueMinAtomCount) {
    return false;
  }
  if (componentRingCount(layoutGraph, component) < ORGANOMETALLIC_RESCUE_LIMITS.mixedRingSystemRescueMinRingCount) {
    return false;
  }
  return componentHasRingConnectionKind(layoutGraph, component, 'fused')
    && (componentHasRingConnectionKind(layoutGraph, component, 'bridged') || componentHasRingConnectionKind(layoutGraph, component, 'spiro'));
}

function rescueMixedMetalRingPlacement(layoutGraph, component, familyPlacement, macrocycleRings = []) {
  if (!shouldTryOrganometallicMixedRingRescue(layoutGraph, component, familyPlacement)) {
    return familyPlacement;
  }

  let bestPlacement = familyPlacement;
  let bestScore = placementAuditScore(layoutGraph, familyPlacement);
  const candidateFamilies = [
    ...(componentHasRingConnectionKind(layoutGraph, component, 'bridged') || componentHasRingConnectionKind(layoutGraph, component, 'spiro')
      ? ['bridged']
      : []),
    ...(componentHasRingConnectionKind(layoutGraph, component, 'fused') ? ['fused'] : [])
  ];

  for (const forcedFamily of candidateFamilies) {
    const rescuePlacement = withProtectedCleanupRigidSubtrees(
      layoutGraph,
      component,
      layoutAtomSlice(layoutGraph, component, layoutGraph.options.bondLength, { forceFamily: forcedFamily }),
      macrocycleRings
    );
    const rescueScore = placementAuditScore(layoutGraph, rescuePlacement);
    if (isMetalMixedRingRescuePreferredPlacement(rescueScore, bestScore)) {
      bestPlacement = rescuePlacement;
      bestScore = rescueScore;
    }
  }

  return bestPlacement;
}

function rescueLargeComponentSlicePlacement(layoutGraph, component, familyPlacement, macrocycleRings = []) {
  if (!familyPlacement?.supported || familyPlacement.family !== 'large-molecule') {
    return familyPlacement;
  }
  if (!(componentContainsMacrocycle(macrocycleRings, component) || componentContainsMetal(layoutGraph, component))) {
    return familyPlacement;
  }

  let slicePlacement = withProtectedCleanupRigidSubtrees(
    layoutGraph,
    component,
    layoutAtomSlice(layoutGraph, component, layoutGraph.options.bondLength),
    macrocycleRings
  );
  if (componentContainsMetal(layoutGraph, component)) {
    slicePlacement = rescueMixedMetalRingPlacement(layoutGraph, component, slicePlacement, macrocycleRings);
  }

  return isMacrocyclePreferredPlacement(
    placementAuditScore(layoutGraph, slicePlacement),
    placementAuditScore(layoutGraph, familyPlacement)
  )
    ? slicePlacement
    : familyPlacement;
}

/**
 * Lays out one connected component through the best available family path.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} component - Connected-component descriptor.
 * @param {object[]} [macrocycleRings] - Cached macrocycle ring descriptors.
 * @returns {{family: string, supported: boolean, atomIds: string[], coords: Map<string, {x: number, y: number}>, placementMode?: string|null, bondValidationClasses: Map<string, 'planar'|'bridged'>, displayAssignments?: Array<{bondId: string, type: 'wedge'|'dash', centerId: string}>, cleanupRigidSubtreesByAtomId?: Map<string, Array<{anchorAtomId: string, rootAtomId: string, subtreeAtomIds: string[]}>>}} Component placement result.
 */
function layoutComponent(layoutGraph, component, macrocycleRings = []) {
  if (isLargeComponent(layoutGraph, component)) {
    let slicePlacement = (componentContainsMacrocycle(macrocycleRings, component) || componentContainsMetal(layoutGraph, component))
      ? withProtectedCleanupRigidSubtrees(
          layoutGraph,
          component,
          layoutAtomSlice(layoutGraph, component, layoutGraph.options.bondLength),
          macrocycleRings
        )
      : null;
    if (slicePlacement && componentContainsMetal(layoutGraph, component)) {
      slicePlacement = rescueMixedMetalRingPlacement(layoutGraph, component, slicePlacement, macrocycleRings);
    }
    const largeMolecule = layoutLargeMoleculeFamily(layoutGraph, component, layoutGraph.options.bondLength);
    const largePlacement =
      largeMolecule
        ? (() => {
            const participantAtomIds = component.atomIds.filter(atomId => {
              const atom = layoutGraph.atoms.get(atomId);
              return atom && !(layoutGraph.options.suppressH && atom.element === 'H' && !atom.visible);
            });
            return {
              family: 'large-molecule',
              supported: true,
              atomIds: participantAtomIds,
              coords: largeMolecule.coords,
              placementMode: largeMolecule.placementMode,
              bondValidationClasses: largeMolecule.bondValidationClasses,
              displayAssignments: [],
              cleanupRigidSubtreesByAtomId: largeMolecule.cleanupRigidSubtreesByAtomId
            };
          })()
        : null;
    const preferredPlacement = isMacrocyclePreferredPlacement(
      placementAuditScore(layoutGraph, slicePlacement),
      placementAuditScore(layoutGraph, largePlacement)
    )
      ? slicePlacement
      : largePlacement;
    if (preferredPlacement) {
      return preferredPlacement;
    }
    if (largeMolecule) {
      const participantAtomIds = component.atomIds.filter(atomId => {
        const atom = layoutGraph.atoms.get(atomId);
        return atom && !(layoutGraph.options.suppressH && atom.element === 'H' && !atom.visible);
      });
      return {
        family: 'large-molecule',
        supported: true,
        atomIds: participantAtomIds,
        coords: largeMolecule.coords,
        placementMode: largeMolecule.placementMode,
        bondValidationClasses: largeMolecule.bondValidationClasses,
        displayAssignments: [],
        cleanupRigidSubtreesByAtomId: largeMolecule.cleanupRigidSubtreesByAtomId
      };
    }
  }

  let familyPlacement = withProtectedCleanupRigidSubtrees(
    layoutGraph,
    component,
    layoutAtomSlice(layoutGraph, component, layoutGraph.options.bondLength),
    macrocycleRings
  );
  const metalAtoms = component.atomIds.filter(atomId => {
    const atom = layoutGraph.sourceMolecule.atoms.get(atomId);
    if (!atom || atom.name === 'H') {
      return false;
    }
    const group = atom.properties.group ?? 0;
    return group >= 3 && group <= 12;
  });
  if (metalAtoms.length === 0) {
    if (familyPlacement.supported) {
      return familyPlacement;
    }
    return familyPlacement;
  }

  familyPlacement = rescueMixedMetalRingPlacement(layoutGraph, component, familyPlacement, macrocycleRings);

  const organometallic = layoutOrganometallicFamily(layoutGraph, component, layoutGraph.options.bondLength);
  if (!organometallic) {
    if (familyPlacement.supported) {
      return familyPlacement;
    }
    return {
      family: 'organometallic',
      supported: false,
      atomIds: familyPlacement.atomIds,
      coords: new Map(),
      placementMode: null,
      bondValidationClasses: new Map(),
      displayAssignments: []
    };
  }

  const organometallicPlacement = withProtectedCleanupRigidSubtrees(layoutGraph, component, {
    family: 'organometallic',
    supported: true,
    atomIds: familyPlacement.atomIds,
    coords: organometallic.coords,
    placementMode: organometallic.placementMode,
    bondValidationClasses: organometallic.bondValidationClasses ?? assignBondValidationClass(layoutGraph, familyPlacement.atomIds, 'planar'),
    displayAssignments: organometallic.displayAssignments,
    cleanupRigidSubtreesByAtomId: organometallic.cleanupRigidSubtreesByAtomId
  }, macrocycleRings);

  if (!familyPlacement.supported) {
    return organometallicPlacement;
  }

  return isOrganometallicPreferredPlacement(
    placementAuditScore(layoutGraph, organometallicPlacement),
    placementAuditScore(layoutGraph, familyPlacement)
  )
    ? organometallicPlacement
    : familyPlacement;
}

/**
 * Lays out all currently supported components and packs them into a single
 * coordinate frame.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} [policy] - Standards-policy bundle.
 * @returns {{coords: Map<string, {x: number, y: number}>, placedComponentCount: number, unplacedComponentCount: number, preservedComponentCount: number, placedFamilies: string[], bondValidationClasses: Map<string, 'planar'|'bridged'>, displayAssignments: Array<{bondId: string, type: 'wedge'|'dash', centerId: string}>, cleanupRigidSubtreesByAtomId: Map<string, Array<{anchorAtomId: string, rootAtomId: string, subtreeAtomIds: string[]}>>, frozenAtomIds: Set<string>, componentPlacements: Array<{componentId: number, role: string, family: string, placementMode: string|null, supported: boolean, placed: boolean, preserved: boolean, anchored: boolean, atomCount: number, heavyAtomCount: number, containsMetal: boolean}>}} Placement summary.
 */
export function layoutSupportedComponents(layoutGraph, policy = {}) {
  const componentPlacements = [];
  const componentPlacementDetails = [];
  const bondValidationClasses = new Map();
  const displayAssignments = [];
  const cleanupRigidSubtreesByAtomId = new Map();
  const frozenAtomIds = new Set();
  const placedFamilies = [];
  const macrocycleRings = findMacrocycleRings(layoutGraph.rings);
  let placedComponentCount = 0;
  let unplacedComponentCount = 0;
  let preservedComponentCount = 0;
  const refinementContext = buildRefinementContext(layoutGraph);

  for (const component of layoutGraph.components) {
    if (canPreserveComponentPlacement(layoutGraph, component, refinementContext)) {
      const preserved = preserveComponentPlacement(layoutGraph, component);
      componentPlacements.push({
        componentId: component.id,
        atomIds: preserved.atomIds,
        coords: preserved.coords,
        anchored: true,
        role: component.role,
        heavyAtomCount: component.heavyAtomCount,
        netCharge: component.netCharge,
        containsMetal: componentContainsMetal(layoutGraph, component)
      });
      placedComponentCount++;
      preservedComponentCount++;
      placedFamilies.push('preserved');
      componentPlacementDetails.push({
        componentId: component.id,
        role: component.role,
        family: 'preserved',
        placementMode: 'preserved',
        supported: true,
        placed: true,
        preserved: true,
        anchored: true,
        atomCount: preserved.atomIds.length,
        heavyAtomCount: component.heavyAtomCount,
        containsMetal: componentContainsMetal(layoutGraph, component)
      });
      for (const atomId of preserved.atomIds) {
        frozenAtomIds.add(atomId);
      }
      assignBondValidationClass(layoutGraph, component.atomIds, 'planar', bondValidationClasses, { overwrite: false });
      continue;
    }

    const componentGraph = refinementContext.enabled
      ? {
          ...layoutGraph,
          fixedCoords: buildComponentFixedCoords(layoutGraph, component, refinementContext)
        }
      : layoutGraph;
    let placement = layoutComponent(componentGraph, component, macrocycleRings);
    placement = rescueLargeComponentSlicePlacement(componentGraph, component, placement, macrocycleRings);
    if (componentContainsMetal(componentGraph, component)) {
      placement = rescueMixedMetalRingPlacement(componentGraph, component, placement, macrocycleRings);
    }
    if (!placement.supported) {
      if (placement.coords.size > 0) {
        componentPlacements.push({
          componentId: component.id,
          atomIds: placement.atomIds,
          coords: placement.coords,
          anchored: false,
          role: component.role,
          heavyAtomCount: component.heavyAtomCount,
          netCharge: component.netCharge,
          containsMetal: componentContainsMetal(layoutGraph, component)
        });
        placedComponentCount++;
        unplacedComponentCount++;
        placedFamilies.push(placement.family);
        componentPlacementDetails.push({
          componentId: component.id,
          role: component.role,
          family: placement.family,
          placementMode: placement.placementMode ?? null,
          supported: false,
          placed: true,
          preserved: false,
          anchored: false,
          atomCount: placement.atomIds.length,
          heavyAtomCount: component.heavyAtomCount,
          containsMetal: componentContainsMetal(layoutGraph, component)
        });
        mergeBondValidationClasses(bondValidationClasses, placement.bondValidationClasses, { overwrite: false });
        displayAssignments.push(...(placement.displayAssignments ?? []));
        mergeCleanupRigidSubtreesByAtomId(cleanupRigidSubtreesByAtomId, placement.cleanupRigidSubtreesByAtomId);
        continue;
      }
      componentPlacementDetails.push({
        componentId: component.id,
        role: component.role,
        family: placement.family,
        placementMode: placement.placementMode ?? null,
        supported: false,
        placed: false,
        preserved: false,
        anchored: false,
        atomCount: placement.atomIds.length,
        heavyAtomCount: component.heavyAtomCount,
        containsMetal: componentContainsMetal(layoutGraph, component)
      });
      unplacedComponentCount++;
      continue;
    }

    const aligned =
      layoutGraph.options.preserveFixed === false
        ? { coords: placement.coords, anchored: false }
        : alignCoordsToFixed(placement.coords, placement.atomIds, componentGraph.fixedCoords);

    componentPlacements.push({
      componentId: component.id,
      atomIds: placement.atomIds,
      coords: aligned.coords,
      anchored: aligned.anchored,
      role: component.role,
      heavyAtomCount: component.heavyAtomCount,
      netCharge: component.netCharge,
      containsMetal: componentContainsMetal(layoutGraph, component)
    });
    placedComponentCount++;
    placedFamilies.push(placement.family);
    componentPlacementDetails.push({
      componentId: component.id,
      role: component.role,
      family: placement.family,
      placementMode: placement.placementMode ?? null,
      supported: true,
      placed: true,
      preserved: false,
      anchored: aligned.anchored,
      atomCount: placement.atomIds.length,
      heavyAtomCount: component.heavyAtomCount,
      containsMetal: componentContainsMetal(layoutGraph, component)
    });
    mergeBondValidationClasses(bondValidationClasses, placement.bondValidationClasses, { overwrite: false });
    displayAssignments.push(...(placement.displayAssignments ?? []));
    mergeCleanupRigidSubtreesByAtomId(cleanupRigidSubtreesByAtomId, placement.cleanupRigidSubtreesByAtomId);
  }

  return {
    coords: packComponentPlacements(componentPlacements, layoutGraph.options.bondLength, policy),
    placedComponentCount,
    unplacedComponentCount,
    preservedComponentCount,
    placedFamilies,
    bondValidationClasses,
    displayAssignments,
    cleanupRigidSubtreesByAtomId,
    frozenAtomIds,
    componentPlacements: componentPlacementDetails
  };
}
