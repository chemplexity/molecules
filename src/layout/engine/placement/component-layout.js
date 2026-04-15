/** @module placement/component-layout */

import { auditLayout } from '../audit/audit.js';
import { alignCoordsToFixed } from '../geometry/transforms.js';
import { layoutLargeMoleculeFamily } from '../families/large-molecule.js';
import { layoutOrganometallicFamily } from '../families/organometallic.js';
import { assignBondValidationClass, mergeBondValidationClasses } from './bond-validation.js';
import { exceedsLargeComponentThreshold } from '../topology/large-blocks.js';
import { findMacrocycleRings } from '../topology/macrocycles.js';
import { layoutAtomSlice } from './atom-slice.js';
import { packComponentPlacements } from './fragment-packing.js';
import { buildComponentFixedCoords, buildRefinementContext, canPreserveComponentPlacement, preserveComponentPlacement } from './refinement.js';

function isLargeComponent(layoutGraph, component) {
  return exceedsLargeComponentThreshold(layoutGraph, component);
}

function componentContainsMacrocycle(layoutGraph, component) {
  const componentAtomIds = new Set(component.atomIds);
  return findMacrocycleRings(layoutGraph.rings).some(ring => ring.atomIds.every(atomId => componentAtomIds.has(atomId)));
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
    target.set(atomId, Array.isArray(descriptors) ? [...descriptors] : [descriptors]);
  }
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

/**
 * Lays out one connected component through the best available family path.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} component - Connected-component descriptor.
 * @returns {{family: string, supported: boolean, atomIds: string[], coords: Map<string, {x: number, y: number}>, placementMode?: string|null, bondValidationClasses: Map<string, 'planar'|'bridged'>, displayAssignments?: Array<{bondId: string, type: 'wedge'|'dash', centerId: string}>, cleanupRigidSubtreesByAtomId?: Map<string, Array<{anchorAtomId: string, rootAtomId: string, subtreeAtomIds: string[]}>>}} Component placement result.
 */
function layoutComponent(layoutGraph, component) {
  if (isLargeComponent(layoutGraph, component)) {
    const slicePlacement = componentContainsMacrocycle(layoutGraph, component)
      ? layoutAtomSlice(layoutGraph, component, layoutGraph.options.bondLength)
      : null;
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

  const familyPlacement = layoutAtomSlice(layoutGraph, component, layoutGraph.options.bondLength);
  if (familyPlacement.supported) {
    return familyPlacement;
  }

  const metalAtoms = component.atomIds.filter(atomId => {
    const atom = layoutGraph.sourceMolecule.atoms.get(atomId);
    if (!atom || atom.name === 'H') {
      return false;
    }
    const group = atom.properties.group ?? 0;
    return group >= 3 && group <= 12;
  });
  if (metalAtoms.length === 0) {
    return familyPlacement;
  }

  const organometallic = layoutOrganometallicFamily(layoutGraph, component, layoutGraph.options.bondLength);
  if (!organometallic) {
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

  return {
    family: 'organometallic',
    supported: true,
    atomIds: familyPlacement.atomIds,
    coords: organometallic.coords,
    placementMode: organometallic.placementMode,
    bondValidationClasses: assignBondValidationClass(layoutGraph, familyPlacement.atomIds, 'planar'),
    displayAssignments: organometallic.displayAssignments
  };
}

/**
 * Lays out all currently supported components and packs them into a single
 * coordinate frame.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} [policy] - Standards-policy bundle.
 * @returns {{coords: Map<string, {x: number, y: number}>, placedComponentCount: number, unplacedComponentCount: number, preservedComponentCount: number, placedFamilies: string[], bondValidationClasses: Map<string, 'planar'|'bridged'>, displayAssignments: Array<{bondId: string, type: 'wedge'|'dash', centerId: string}>, cleanupRigidSubtreesByAtomId: Map<string, Array<{anchorAtomId: string, rootAtomId: string, subtreeAtomIds: string[]}>>}} Placement summary.
 */
export function layoutSupportedComponents(layoutGraph, policy = {}) {
  const componentPlacements = [];
  const bondValidationClasses = new Map();
  const displayAssignments = [];
  const cleanupRigidSubtreesByAtomId = new Map();
  const placedFamilies = [];
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
      assignBondValidationClass(layoutGraph, component.atomIds, 'planar', bondValidationClasses, { overwrite: false });
      continue;
    }

    const componentGraph = refinementContext.enabled
      ? {
          ...layoutGraph,
          fixedCoords: buildComponentFixedCoords(layoutGraph, component, refinementContext)
        }
      : layoutGraph;
    const placement = layoutComponent(componentGraph, component);
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
        mergeBondValidationClasses(bondValidationClasses, placement.bondValidationClasses, { overwrite: false });
        displayAssignments.push(...(placement.displayAssignments ?? []));
        mergeCleanupRigidSubtreesByAtomId(cleanupRigidSubtreesByAtomId, placement.cleanupRigidSubtreesByAtomId);
        continue;
      }
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
    cleanupRigidSubtreesByAtomId
  };
}
