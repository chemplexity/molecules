/** @module audit/audit */

import { recommendFallback } from './fallback.js';
import { detectCollapsedMacrocycles, findSevereOverlaps, measureBondLengthDeviation } from './invariants.js';

/**
 * Audits a laid-out coordinate set against the current layout safety checks.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {object} [options] - Audit options.
 * @param {number} [options.bondLength] - Target bond length.
 * @param {Map<string, 'planar'|'bridged'>} [options.bondValidationClasses] - Per-bond validation classes.
 * @param {object} [options.stereo] - Stereo summary produced by the stereo phase.
 * @returns {{ok: boolean, severeOverlapCount: number, maxBondLengthDeviation: number, meanBondLengthDeviation: number, bondLengthFailureCount: number, collapsedMacrocycleCount: number, stereoContradiction: boolean, bridgedReadabilityFailure: boolean}} Audit summary.
 */
export function auditLayout(layoutGraph, coords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const overlaps = findSevereOverlaps(layoutGraph, coords, bondLength);
  const bondDeviation = measureBondLengthDeviation(layoutGraph, coords, bondLength, {
    bondValidationClasses: options.bondValidationClasses
  });
  const collapsedMacrocycles = detectCollapsedMacrocycles(layoutGraph, coords, bondLength);
  const stereo = options.stereo ?? null;
  const stereoContradiction =
    (stereo?.ezViolationCount ?? 0) > 0 ||
    ((stereo?.chiralCenterCount ?? 0) > 0 && (stereo?.unassignedCenterCount ?? 0) > 0);
  const bridgedReadabilityFailure = false;
  const ok = overlaps.length === 0
    && bondDeviation.maxDeviation <= bondLength * 0.5
    && collapsedMacrocycles.length === 0
    && !stereoContradiction
    && !bridgedReadabilityFailure;
  const fallback = recommendFallback({
    severeOverlapCount: overlaps.length,
    collapsedMacrocycleCount: collapsedMacrocycles.length,
    stereoContradiction,
    bridgedReadabilityFailure
  });

  return {
    ok,
    severeOverlapCount: overlaps.length,
    maxBondLengthDeviation: bondDeviation.maxDeviation,
    meanBondLengthDeviation: bondDeviation.meanDeviation,
    bondLengthFailureCount: bondDeviation.failingBondCount,
    collapsedMacrocycleCount: collapsedMacrocycles.length,
    stereoContradiction,
    bridgedReadabilityFailure,
    fallback
  };
}
