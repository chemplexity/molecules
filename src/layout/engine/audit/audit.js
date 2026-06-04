/** @module audit/audit */

import { recommendFallback } from './fallback.js';
import { detectCollapsedMacrocycles, findSevereOverlaps, countVisibleHeavyBondCrossings, measureBondLengthDeviation, measureLabelOverlap, measureRingSubstituentReadability } from './invariants.js';
import { SEVERE_OVERLAP_FACTOR } from '../constants.js';

function isHeavyAtomOverlap(layoutGraph, overlap) {
  return layoutGraph.atoms.get(overlap.firstAtomId)?.element !== 'H' && layoutGraph.atoms.get(overlap.secondAtomId)?.element !== 'H';
}

function summarizeSevereOverlaps(overlaps, severeOverlapThreshold) {
  const minSevereOverlapDistance = overlaps.length > 0 ? overlaps.reduce((minimumDistance, overlap) => Math.min(minimumDistance, overlap.distance), Number.POSITIVE_INFINITY) : null;
  const worstOverlapDeficit = minSevereOverlapDistance == null ? 0 : Math.max(0, severeOverlapThreshold - minSevereOverlapDistance);
  const severeOverlapPenalty = overlaps.reduce((penalty, overlap) => {
    const deficit = Math.max(0, severeOverlapThreshold - overlap.distance);
    return penalty + deficit * deficit;
  }, 0);

  return {
    minSevereOverlapDistance,
    worstOverlapDeficit,
    severeOverlapPenalty
  };
}

/**
 * Audits a laid-out coordinate set against the current layout safety checks.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {object} [options] - Audit options.
 * @param {number} [options.bondLength] - Target bond length.
 * @param {Array<{firstAtomId: string, secondAtomId: string, distance: number}>} [options.overlaps] - Optional precomputed severe-overlap list.
 * @param {import('../geometry/atom-grid.js').AtomGrid|null} [options.atomGrid] - Optional reused spatial grid for severe-overlap lookup.
 * @param {Iterable<string>} [options.visibleAtomIds] - Optional visible atom ids matching the spatial grid.
 * @param {Iterable<string>} [options.visibleHeavyAtomIds] - Optional precomputed visible heavy atom ids.
 * @param {boolean} [options.visibleAtomIdsMatchGrid] - Whether provided visible atom ids are already represented by the spatial grid.
 * @param {boolean} [options.includeVisibleHeavyBondCrossings] - Whether to compute visible heavy-bond crossings in the returned summary.
 * @param {Map<string, 'planar'|'bridged'|'haptic'>} [options.bondValidationClasses] - Per-bond validation classes.
 * @param {object} [options.stereo] - Stereo summary produced by the stereo phase.
 * @returns {{ok: boolean, severeOverlapCount: number, visibleHeavyBondCrossingCount: number, labelOverlapCount: number, maxBondLengthDeviation: number, meanBondLengthDeviation: number, bondLengthFailureCount: number, collapsedMacrocycleCount: number, stereoContradiction: boolean, bridgedReadabilityFailure: boolean, ringSubstituentReadabilityFailureCount: number}} Audit summary.
 */
export function auditLayout(layoutGraph, coords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const overlaps =
    options.overlaps ??
    findSevereOverlaps(layoutGraph, coords, bondLength, {
      atomGrid: options.atomGrid,
      visibleAtomIds: options.visibleAtomIds,
      visibleHeavyAtomIds: options.visibleHeavyAtomIds,
      visibleAtomIdsMatchGrid: options.visibleAtomIdsMatchGrid
    });
  const severeOverlapThreshold = bondLength * SEVERE_OVERLAP_FACTOR;
  const heavyAtomOverlapCount = overlaps.filter(overlap => isHeavyAtomOverlap(layoutGraph, overlap)).length;
  const labelOverlap = measureLabelOverlap(layoutGraph, coords, bondLength, {
    labelMetrics: layoutGraph.options.labelMetrics
  });
  const bondDeviation = measureBondLengthDeviation(layoutGraph, coords, bondLength, {
    bondValidationClasses: options.bondValidationClasses
  });
  const visibleHeavyBondCrossingCount = options.includeVisibleHeavyBondCrossings === false ? 0 : countVisibleHeavyBondCrossings(layoutGraph, coords);
  const collapsedMacrocycles = detectCollapsedMacrocycles(layoutGraph, coords, bondLength);
  const ringSubstituentReadability = measureRingSubstituentReadability(layoutGraph, coords);
  const stereo = options.stereo ?? null;
  const stereoContradiction = (stereo?.ezViolationCount ?? 0) > 0 || ((stereo?.chiralCenterCount ?? 0) > 0 && (stereo?.unassignedCenterCount ?? 0) > 0);
  const bridgedReadabilityFailure = false;
  const ringSubstituentReadabilityFailure = ringSubstituentReadability.failingSubstituentCount > 0;
  const ok =
    overlaps.length === 0 && bondDeviation.failingBondCount === 0 && collapsedMacrocycles.length === 0 && !stereoContradiction && !bridgedReadabilityFailure && !ringSubstituentReadabilityFailure;
  const fallback = recommendFallback({
    bondLengthFailureCount: bondDeviation.failingBondCount,
    severeOverlapCount: heavyAtomOverlapCount,
    collapsedMacrocycleCount: collapsedMacrocycles.length,
    stereoContradiction,
    bridgedReadabilityFailure,
    ringSubstituentReadabilityFailureCount: ringSubstituentReadability.failingSubstituentCount
  });
  const overlapSummary = summarizeSevereOverlaps(overlaps, severeOverlapThreshold);

  return {
    ok,
    severeOverlapCount: overlaps.length,
    minSevereOverlapDistance: overlapSummary.minSevereOverlapDistance,
    worstOverlapDeficit: overlapSummary.worstOverlapDeficit,
    severeOverlapPenalty: overlapSummary.severeOverlapPenalty,
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

/**
 * Audits only the checks that contribute to `auditLayout(...).ok`.
 *
 * This is intended for inner-loop candidate probes that only need pass/fail
 * safety and core regression counts. It deliberately skips metadata that does
 * not affect `ok`, such as label-overlap counts, visible crossing counts, and
 * fallback recommendation details.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {object} [options] - Audit options.
 * @param {number} [options.bondLength] - Target bond length.
 * @param {Array<{firstAtomId: string, secondAtomId: string, distance: number}>} [options.overlaps] - Optional precomputed severe-overlap list.
 * @param {import('../geometry/atom-grid.js').AtomGrid|null} [options.atomGrid] - Optional reused spatial grid for severe-overlap lookup.
 * @param {Iterable<string>} [options.visibleAtomIds] - Optional visible atom ids matching the spatial grid.
 * @param {Iterable<string>} [options.visibleHeavyAtomIds] - Optional precomputed visible heavy atom ids.
 * @param {boolean} [options.visibleAtomIdsMatchGrid] - Whether provided visible atom ids are already represented by the spatial grid.
 * @param {Map<string, 'planar'|'bridged'|'haptic'>} [options.bondValidationClasses] - Per-bond validation classes.
 * @param {object} [options.stereo] - Stereo summary produced by the stereo phase.
 * @param {boolean} [options.includeFallback] - Whether to include a fallback recommendation derived from safety counts.
 * @returns {{ok: boolean, severeOverlapCount: number, minSevereOverlapDistance: number|null, worstOverlapDeficit: number, severeOverlapPenalty: number, maxBondLengthDeviation: number, meanBondLengthDeviation: number, bondLengthFailureCount: number, mildBondLengthFailureCount: number, severeBondLengthFailureCount: number, bondLengthSampleCount: number, collapsedMacrocycleCount: number, stereoContradiction: boolean, bridgedReadabilityFailure: boolean, ringSubstituentReadabilityFailureCount: number, inwardRingSubstituentCount: number, outwardAxisRingSubstituentFailureCount: number, fallback?: object}} Candidate safety audit summary.
 */
export function auditCandidateSafety(layoutGraph, coords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const overlaps =
    options.overlaps ??
    findSevereOverlaps(layoutGraph, coords, bondLength, {
      atomGrid: options.atomGrid,
      visibleAtomIds: options.visibleAtomIds,
      visibleHeavyAtomIds: options.visibleHeavyAtomIds,
      visibleAtomIdsMatchGrid: options.visibleAtomIdsMatchGrid
    });
  const severeOverlapThreshold = bondLength * SEVERE_OVERLAP_FACTOR;
  const bondDeviation = measureBondLengthDeviation(layoutGraph, coords, bondLength, {
    bondValidationClasses: options.bondValidationClasses
  });
  const collapsedMacrocycles = detectCollapsedMacrocycles(layoutGraph, coords, bondLength);
  const ringSubstituentReadability = measureRingSubstituentReadability(layoutGraph, coords);
  const stereo = options.stereo ?? null;
  const stereoContradiction = (stereo?.ezViolationCount ?? 0) > 0 || ((stereo?.chiralCenterCount ?? 0) > 0 && (stereo?.unassignedCenterCount ?? 0) > 0);
  const bridgedReadabilityFailure = false;
  const ringSubstituentReadabilityFailure = ringSubstituentReadability.failingSubstituentCount > 0;
  const ok =
    overlaps.length === 0 && bondDeviation.failingBondCount === 0 && collapsedMacrocycles.length === 0 && !stereoContradiction && !bridgedReadabilityFailure && !ringSubstituentReadabilityFailure;
  const overlapSummary = summarizeSevereOverlaps(overlaps, severeOverlapThreshold);
  const fallback =
    options.includeFallback === true
      ? recommendFallback({
          bondLengthFailureCount: bondDeviation.failingBondCount,
          severeOverlapCount: overlaps.filter(overlap => isHeavyAtomOverlap(layoutGraph, overlap)).length,
          collapsedMacrocycleCount: collapsedMacrocycles.length,
          stereoContradiction,
          bridgedReadabilityFailure,
          ringSubstituentReadabilityFailureCount: ringSubstituentReadability.failingSubstituentCount
        })
      : undefined;

  const summary = {
    ok,
    severeOverlapCount: overlaps.length,
    minSevereOverlapDistance: overlapSummary.minSevereOverlapDistance,
    worstOverlapDeficit: overlapSummary.worstOverlapDeficit,
    severeOverlapPenalty: overlapSummary.severeOverlapPenalty,
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
    outwardAxisRingSubstituentFailureCount: ringSubstituentReadability.outwardAxisFailureCount
  };
  if (options.includeFallback === true) {
    summary.fallback = fallback;
  }
  return summary;
}
