/** @module placement/refinement */

import { isParticipantAtom } from './atom-slice.js';

function componentParticipantAtomIds(layoutGraph, component) {
  return component.atomIds.filter(atomId => isParticipantAtom(layoutGraph, atomId));
}

/**
 * Builds the touched-atom set implied by the current refinement hints.
 * Touched bonds contribute both endpoint atoms.
 * @param {object} layoutGraph - Layout graph shell.
 * @returns {Set<string>} Touched atom ids.
 */
export function deriveTouchedAtomIds(layoutGraph) {
  const touchedAtomIds = new Set(layoutGraph.options.touchedAtoms ?? []);
  for (const bondId of layoutGraph.options.touchedBonds ?? []) {
    const bond = layoutGraph.sourceMolecule.bonds.get(bondId) ?? null;
    if (!bond) {
      continue;
    }
    touchedAtomIds.add(bond.atoms[0]);
    touchedAtomIds.add(bond.atoms[1]);
  }
  return touchedAtomIds;
}

/**
 * Builds the refinement context for component placement.
 * @param {object} layoutGraph - Layout graph shell.
 * @returns {{enabled: boolean, hasTouchedHints: boolean, touchedAtomIds: Set<string>}} Refinement context.
 */
export function buildRefinementContext(layoutGraph) {
  const touchedAtomIds = deriveTouchedAtomIds(layoutGraph);
  const hasTouchedHints = touchedAtomIds.size > 0;
  return {
    enabled: layoutGraph.options.existingCoords.size > 0,
    hasTouchedHints,
    touchedAtomIds
  };
}

/**
 * Returns whether a component should keep its existing coordinates unchanged.
 * This applies both to untouched components during partial relayout and to
 * cleanup-only refinement runs where every participant atom already has an
 * existing coordinate.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {{atomIds: string[]}} component - Component descriptor.
 * @param {{enabled: boolean, hasTouchedHints: boolean, touchedAtomIds: Set<string>}} refinementContext - Refinement context.
 * @returns {boolean} True when the component can be preserved verbatim.
 */
export function canPreserveComponentPlacement(layoutGraph, component, refinementContext) {
  if (!refinementContext.enabled) {
    return false;
  }
  const participantAtomIds = componentParticipantAtomIds(layoutGraph, component);
  if (participantAtomIds.length === 0) {
    return false;
  }
  if (!participantAtomIds.every(atomId => layoutGraph.options.existingCoords.has(atomId))) {
    return false;
  }
  if (!refinementContext.hasTouchedHints) {
    return true;
  }
  if (participantAtomIds.some(atomId => refinementContext.touchedAtomIds.has(atomId))) {
    return false;
  }
  return true;
}

/**
 * Returns the preserved coordinate map for an untouched component.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {{atomIds: string[]}} component - Component descriptor.
 * @returns {{atomIds: string[], coords: Map<string, {x: number, y: number}>}} Preserved participant atoms and coords.
 */
export function preserveComponentPlacement(layoutGraph, component) {
  const atomIds = componentParticipantAtomIds(layoutGraph, component);
  const coords = new Map();
  for (const atomId of atomIds) {
    const position = layoutGraph.options.existingCoords.get(atomId);
    if (position) {
      coords.set(atomId, { ...position });
    }
  }
  return { atomIds, coords };
}

/**
 * Builds the fixed-coordinate map that should anchor a component relayout.
 * During refinement, untouched atoms with existing coordinates become local
 * anchors for the relaid component. Without touched hints, all existing
 * participant coordinates act as a stronger preservation bias.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {{atomIds: string[]}} component - Component descriptor.
 * @param {{enabled: boolean, hasTouchedHints: boolean, touchedAtomIds: Set<string>}} refinementContext - Refinement context.
 * @returns {Map<string, {x: number, y: number}>} Fixed-coordinate map for this component.
 */
export function buildComponentFixedCoords(layoutGraph, component, refinementContext) {
  const fixedCoords = new Map(layoutGraph.fixedCoords);
  if (!refinementContext.enabled) {
    return fixedCoords;
  }

  for (const atomId of componentParticipantAtomIds(layoutGraph, component)) {
    if (!layoutGraph.options.existingCoords.has(atomId)) {
      continue;
    }
    if (refinementContext.hasTouchedHints && refinementContext.touchedAtomIds.has(atomId)) {
      continue;
    }
    const position = layoutGraph.options.existingCoords.get(atomId);
    fixedCoords.set(atomId, { ...position });
  }
  return fixedCoords;
}
