/** @module audit/stage-metrics */

import { auditLayout } from './audit.js';
import { measureDirectAttachedRingJunctionContinuationDistortion, measureThreeHeavyContinuationDistortion } from './invariants.js';
import { measureSmallRingExteriorGapSpreadPenalty } from '../placement/branch-placement.js';
import { measureOrthogonalHypervalentDeviation } from '../cleanup/hypervalent-angle-tidy.js';
import { measureRingSubstituentPresentationPenalty } from '../cleanup/presentation/ring-substituent.js';

function getSmallRingExteriorPenaltyAtomIds(layoutGraph) {
  if (!layoutGraph) {
    return [];
  }
  if (Array.isArray(layoutGraph._smallRingExteriorPenaltyAtomIds)) {
    return layoutGraph._smallRingExteriorPenaltyAtomIds;
  }

  const atomIds = [];
  for (const [atomId, atom] of layoutGraph.atoms ?? []) {
    if (!atom || atom.element === 'H' || atom.aromatic || atom.heavyDegree !== 4) {
      continue;
    }
    const anchorRings = layoutGraph.atomToRings.get(atomId) ?? [];
    if (anchorRings.length !== 1) {
      continue;
    }
    const ringSize = anchorRings[0]?.atomIds?.length ?? 0;
    if (ringSize < 3 || ringSize > 6) {
      continue;
    }
    atomIds.push(atomId);
  }
  layoutGraph._smallRingExteriorPenaltyAtomIds = atomIds;
  return atomIds;
}

/**
 * Audits one cleanup-stage coordinate snapshot with placement-specific bond validation.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinates.
 * @param {object} placement - Placement result containing validation classes.
 * @param {number} bondLength - Target bond length.
 * @returns {object} Full audit result for the stage.
 */
export function auditCleanupStage(layoutGraph, coords, placement, bondLength) {
  return auditLayout(layoutGraph, coords, {
    bondLength,
    bondValidationClasses: placement.bondValidationClasses
  });
}

/**
 * Sums the small-ring exterior-gap presentation penalty across eligible anchors.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map to score.
 * @param {Set<string>|null} [focusAtomIds] - Optional focus set for partial scoring.
 * @returns {number} Total exterior-gap penalty.
 */
export function measureTotalSmallRingExteriorGapPenalty(layoutGraph, coords, focusAtomIds = null) {
  const focusSet = focusAtomIds instanceof Set && focusAtomIds.size > 0 ? focusAtomIds : null;
  let penalty = 0;
  for (const atomId of getSmallRingExteriorPenaltyAtomIds(layoutGraph)) {
    if (!coords.has(atomId) || (focusSet && !focusSet.has(atomId))) {
      continue;
    }
    penalty += measureSmallRingExteriorGapSpreadPenalty(layoutGraph, coords, atomId);
  }
  return penalty;
}

/**
 * Measures the presentation-only penalty used for cleanup-stage tie-breaking.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map to score.
 * @param {{focusAtomIds?: Set<string>|null, includeSmallRingExteriorPenalty?: boolean}} [options] - Optional focused-scoring controls.
 * @returns {number} Combined presentation penalty.
 */
export function measureCleanupStagePresentationPenalty(layoutGraph, coords, options = {}) {
  const focusAtomIds = options.focusAtomIds instanceof Set && options.focusAtomIds.size > 0 ? options.focusAtomIds : null;
  const includeSmallRingExteriorPenalty = options.includeSmallRingExteriorPenalty !== false;
  return (
    measureRingSubstituentPresentationPenalty(layoutGraph, coords, {
      focusAtomIds,
      includeLinkedRingBridgePenalty: true
    })
    + measureOrthogonalHypervalentDeviation(layoutGraph, coords, { focusAtomIds })
    + measureThreeHeavyContinuationDistortion(layoutGraph, coords, { focusAtomIds }).totalDeviation
    + measureDirectAttachedRingJunctionContinuationDistortion(layoutGraph, coords, { focusAtomIds }).totalDeviation
    + (includeSmallRingExteriorPenalty ? measureTotalSmallRingExteriorGapPenalty(layoutGraph, coords, focusAtomIds) : 0)
  );
}

/**
 * Audits a stereo-aware cleanup stage by re-running stereo inspection on the candidate coords.
 * @param {object} molecule - Source molecule graph.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinates.
 * @param {object} placement - Placement result containing validation classes.
 * @param {number} bondLength - Target bond length.
 * @param {(molecule: object, layoutGraph: object, coords: Map<string, {x: number, y: number}>) => {stereo: object}} runStereoPhase - Stereo phase callback.
 * @returns {{coords: Map<string, {x: number, y: number}>, stereo: object, audit: object, presentationPenalty: number}} Stereo-scored stage result.
 */
export function auditFinalStereoStage(molecule, layoutGraph, coords, placement, bondLength, runStereoPhase) {
  const { stereo } = runStereoPhase(molecule, layoutGraph, coords);
  const audit = auditLayout(layoutGraph, coords, {
    bondLength,
    bondValidationClasses: placement.bondValidationClasses,
    stereo
  });
  return {
    coords,
    stereo,
    audit,
    presentationPenalty: measureCleanupStagePresentationPenalty(layoutGraph, coords)
  };
}
