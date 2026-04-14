/** @module placement/component-layout */

import { alignCoordsToFixed } from '../geometry/transforms.js';
import { layoutLargeMoleculeFamily } from '../families/large-molecule.js';
import { layoutOrganometallicFamily } from '../families/organometallic.js';
import { assignBondValidationClass, mergeBondValidationClasses } from './bond-validation.js';
import { layoutAtomSlice } from './atom-slice.js';
import { packComponentPlacements } from './fragment-packing.js';
import { buildComponentFixedCoords, buildRefinementContext, canPreserveComponentPlacement, preserveComponentPlacement } from './refinement.js';

function isLargeComponent(layoutGraph, component) {
  const threshold = layoutGraph.options.largeMoleculeThreshold;
  const heavyAtomCount = component.atomIds.filter(atomId => layoutGraph.sourceMolecule.atoms.get(atomId)?.name !== 'H').length;
  const ringSystemCount = layoutGraph.ringSystems.filter(ringSystem => ringSystem.atomIds.every(atomId => component.atomIds.includes(atomId))).length;
  return heavyAtomCount > threshold.heavyAtomCount || ringSystemCount > threshold.ringSystemCount;
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

/**
 * Lays out one connected component through the best available family path.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} component - Connected-component descriptor.
 * @returns {{family: string, supported: boolean, atomIds: string[], coords: Map<string, {x: number, y: number}>, placementMode?: string|null, bondValidationClasses: Map<string, 'planar'|'bridged'>, displayAssignments?: Array<{bondId: string, type: 'wedge'|'dash', centerId: string}>}} Component placement result.
 */
function layoutComponent(layoutGraph, component) {
  if (isLargeComponent(layoutGraph, component)) {
    const largeMolecule = layoutLargeMoleculeFamily(layoutGraph, component, layoutGraph.options.bondLength);
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
        displayAssignments: []
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
 * @returns {{coords: Map<string, {x: number, y: number}>, placedComponentCount: number, unplacedComponentCount: number, preservedComponentCount: number, placedFamilies: string[], bondValidationClasses: Map<string, 'planar'|'bridged'>, displayAssignments: Array<{bondId: string, type: 'wedge'|'dash', centerId: string}>}} Placement summary.
 */
export function layoutSupportedComponents(layoutGraph, policy = {}) {
  const componentPlacements = [];
  const bondValidationClasses = new Map();
  const displayAssignments = [];
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
  }

  return {
    coords: packComponentPlacements(componentPlacements, layoutGraph.options.bondLength, policy),
    placedComponentCount,
    unplacedComponentCount,
    preservedComponentCount,
    placedFamilies,
    bondValidationClasses,
    displayAssignments
  };
}
