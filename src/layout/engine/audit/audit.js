/** @module audit/audit */

import { recommendFallback } from './fallback.js';
import {
  detectCollapsedMacrocycles,
  findSevereOverlaps,
  findVisibleHeavyBondCrossings,
  measureBondLengthDeviation,
  measureLabelOverlap,
  measureRingSubstituentReadability
} from './invariants.js';
import { SEVERE_OVERLAP_FACTOR } from '../constants.js';

function isHeavyAtomOverlap(layoutGraph, overlap) {
  return (
    layoutGraph.atoms.get(overlap.firstAtomId)?.element !== 'H'
    && layoutGraph.atoms.get(overlap.secondAtomId)?.element !== 'H'
  );
}

/**
 * Audits a laid-out coordinate set against the current layout safety checks.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {object} [options] - Audit options.
 * @param {number} [options.bondLength] - Target bond length.
 * @param {Map<string, 'planar'|'bridged'>} [options.bondValidationClasses] - Per-bond validation classes.
 * @param {object} [options.stereo] - Stereo summary produced by the stereo phase.
 * @returns {{ok: boolean, severeOverlapCount: number, visibleHeavyBondCrossingCount: number, labelOverlapCount: number, maxBondLengthDeviation: number, meanBondLengthDeviation: number, bondLengthFailureCount: number, collapsedMacrocycleCount: number, stereoContradiction: boolean, bridgedReadabilityFailure: boolean, ringSubstituentReadabilityFailureCount: number}} Audit summary.
 */
export function auditLayout(layoutGraph, coords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const overlaps = findSevereOverlaps(layoutGraph, coords, bondLength);
  const severeOverlapThreshold = bondLength * SEVERE_OVERLAP_FACTOR;
  const heavyAtomOverlapCount = overlaps.filter(overlap => isHeavyAtomOverlap(layoutGraph, overlap)).length;
  const labelOverlap = measureLabelOverlap(layoutGraph, coords, bondLength, {
    labelMetrics: layoutGraph.options.labelMetrics
  });
  const bondDeviation = measureBondLengthDeviation(layoutGraph, coords, bondLength, {
    bondValidationClasses: options.bondValidationClasses
  });
  const visibleHeavyBondCrossingCount = findVisibleHeavyBondCrossings(layoutGraph, coords).length;
  const collapsedMacrocycles = detectCollapsedMacrocycles(layoutGraph, coords, bondLength);
  const ringSubstituentReadability = measureRingSubstituentReadability(layoutGraph, coords);
  const stereo = options.stereo ?? null;
  const stereoContradiction = (stereo?.ezViolationCount ?? 0) > 0 || ((stereo?.chiralCenterCount ?? 0) > 0 && (stereo?.unassignedCenterCount ?? 0) > 0);
  const bridgedReadabilityFailure = false;
  const ringSubstituentReadabilityFailure = ringSubstituentReadability.failingSubstituentCount > 0;
  const ok =
    overlaps.length === 0
    && bondDeviation.failingBondCount === 0
    && collapsedMacrocycles.length === 0
    && !stereoContradiction
    && !bridgedReadabilityFailure
    && !ringSubstituentReadabilityFailure;
  const fallback = recommendFallback({
    bondLengthFailureCount: bondDeviation.failingBondCount,
    severeOverlapCount: heavyAtomOverlapCount,
    collapsedMacrocycleCount: collapsedMacrocycles.length,
    stereoContradiction,
    bridgedReadabilityFailure,
    ringSubstituentReadabilityFailureCount: ringSubstituentReadability.failingSubstituentCount
  });
  const minSevereOverlapDistance =
    overlaps.length > 0
      ? overlaps.reduce(
          (minimumDistance, overlap) => Math.min(minimumDistance, overlap.distance),
          Number.POSITIVE_INFINITY
        )
      : null;
  const worstOverlapDeficit =
    minSevereOverlapDistance == null
      ? 0
      : Math.max(0, severeOverlapThreshold - minSevereOverlapDistance);
  const severeOverlapPenalty = overlaps.reduce((penalty, overlap) => {
    const deficit = Math.max(0, severeOverlapThreshold - overlap.distance);
    return penalty + deficit * deficit;
  }, 0);

  return {
    ok,
    severeOverlapCount: overlaps.length,
    minSevereOverlapDistance,
    worstOverlapDeficit,
    severeOverlapPenalty,
    visibleHeavyBondCrossingCount,
    labelOverlapCount: labelOverlap.pairCount,
    maxBondLengthDeviation: bondDeviation.maxDeviation,
    meanBondLengthDeviation: bondDeviation.meanDeviation,
    bondLengthFailureCount: bondDeviation.failingBondCount,
    mildBondLengthFailureCount: bondDeviation.mildFailingBondCount,
    severeBondLengthFailureCount: bondDeviation.severeFailingBondCount,
    bondLengthSampleCount: bondDeviation.sampleCount,
    collapsedMacrocycleCount: collapsedMacrocycles.length,
    stereoContradiction,
    bridgedReadabilityFailure,
    ringSubstituentReadabilityFailureCount: ringSubstituentReadability.failingSubstituentCount,
    inwardRingSubstituentCount: ringSubstituentReadability.inwardSubstituentCount,
    outwardAxisRingSubstituentFailureCount: ringSubstituentReadability.outwardAxisFailureCount,
    fallback
  };
}
