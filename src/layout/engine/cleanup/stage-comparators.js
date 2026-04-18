/** @module cleanup/stage-comparators */

import { PROTECTED_CLEANUP_STAGE_LIMITS } from '../constants.js';

/**
 * Compares two stereo-aware cleanup stages using the existing final-stage ordering.
 * @param {object} candidate - Candidate stage result.
 * @param {object|null} incumbent - Current incumbent stage result.
 * @param {{allowPresentationTieBreak?: boolean}} [options] - Comparator options.
 * @returns {boolean} True when the candidate should replace the incumbent.
 */
export function isPreferredFinalStereoStage(candidate, incumbent, options = {}) {
  const allowPresentationTieBreak = options.allowPresentationTieBreak === true;
  if (!incumbent) {
    return true;
  }
  if (incumbent.audit.bondLengthFailureCount === 0 && candidate.audit.bondLengthFailureCount > 0) {
    return false;
  }
  if (candidate.audit.ok !== incumbent.audit.ok) {
    return candidate.audit.ok;
  }
  if (candidate.audit.stereoContradiction !== incumbent.audit.stereoContradiction) {
    return incumbent.audit.stereoContradiction;
  }
  if (candidate.audit.bondLengthFailureCount !== incumbent.audit.bondLengthFailureCount) {
    return candidate.audit.bondLengthFailureCount < incumbent.audit.bondLengthFailureCount;
  }
  if (Math.abs(candidate.audit.maxBondLengthDeviation - incumbent.audit.maxBondLengthDeviation) > 1e-9) {
    return candidate.audit.maxBondLengthDeviation < incumbent.audit.maxBondLengthDeviation;
  }
  if (candidate.audit.ringSubstituentReadabilityFailureCount !== incumbent.audit.ringSubstituentReadabilityFailureCount) {
    return candidate.audit.ringSubstituentReadabilityFailureCount < incumbent.audit.ringSubstituentReadabilityFailureCount;
  }
  if (candidate.audit.inwardRingSubstituentCount !== incumbent.audit.inwardRingSubstituentCount) {
    return candidate.audit.inwardRingSubstituentCount < incumbent.audit.inwardRingSubstituentCount;
  }
  if (candidate.audit.severeOverlapCount !== incumbent.audit.severeOverlapCount) {
    return candidate.audit.severeOverlapCount < incumbent.audit.severeOverlapCount;
  }
  if (candidate.audit.labelOverlapCount !== incumbent.audit.labelOverlapCount) {
    return candidate.audit.labelOverlapCount < incumbent.audit.labelOverlapCount;
  }
  if (allowPresentationTieBreak && Math.abs((candidate.presentationPenalty ?? 0) - (incumbent.presentationPenalty ?? 0)) > 1e-9) {
    return (candidate.presentationPenalty ?? 0) < (incumbent.presentationPenalty ?? 0);
  }
  return false;
}

/**
 * Allows a fused mixed cleanup stage to win on overlap resolution within protected limits.
 * @param {{primaryFamily: string, mixedMode: boolean}} familySummary - Family classification.
 * @param {object} candidate - Candidate stage result.
 * @param {object} incumbent - Current incumbent stage result.
 * @returns {boolean} True when the specialized fused-mixed overlap win should apply.
 */
export function shouldPreferFusedMixedOverlapCleanupStage(familySummary, candidate, incumbent) {
  if (familySummary.primaryFamily !== 'fused' || familySummary.mixedMode === false) {
    return false;
  }
  if (incumbent.audit.severeOverlapCount === 0 || candidate.audit.severeOverlapCount !== 0) {
    return false;
  }
  if (candidate.audit.ok !== true || candidate.audit.bondLengthFailureCount !== incumbent.audit.bondLengthFailureCount) {
    return false;
  }
  if (candidate.audit.labelOverlapCount > incumbent.audit.labelOverlapCount) {
    return false;
  }
  return (
    candidate.audit.maxBondLengthDeviation <= PROTECTED_CLEANUP_STAGE_LIMITS.maxFusedMixedBondDeviationForOverlapWin
    && candidate.audit.meanBondLengthDeviation <= PROTECTED_CLEANUP_STAGE_LIMITS.maxFusedMixedMeanDeviationForOverlapWin
  );
}

/**
 * Allows a stage with fewer severe overlaps to tolerate a small inward-readability regression.
 * @param {object} candidate - Candidate stage result.
 * @param {object|null} incumbent - Current incumbent stage result.
 * @returns {boolean} True when the overlap win should override readability tie-breaks.
 */
export function shouldPreferOverlapWinOverAddedInwardReadability(candidate, incumbent) {
  if (!incumbent || candidate.audit.severeOverlapCount >= incumbent.audit.severeOverlapCount) {
    return false;
  }
  if (candidate.audit.bondLengthFailureCount !== incumbent.audit.bondLengthFailureCount) {
    return false;
  }
  if (candidate.audit.maxBondLengthDeviation > incumbent.audit.maxBondLengthDeviation + 1e-9) {
    return false;
  }
  if (candidate.audit.outwardAxisRingSubstituentFailureCount !== incumbent.audit.outwardAxisRingSubstituentFailureCount) {
    return false;
  }
  if (candidate.audit.labelOverlapCount > incumbent.audit.labelOverlapCount) {
    return false;
  }
  return candidate.audit.inwardRingSubstituentCount <= incumbent.audit.inwardRingSubstituentCount + 1;
}

/**
 * Compares geometry stages for protected families that guard bond integrity more aggressively.
 * @param {{primaryFamily: string, mixedMode: boolean}} familySummary - Family classification.
 * @param {object} placement - Placement result.
 * @param {object} candidate - Candidate stage result.
 * @param {object|null} incumbent - Current incumbent stage result.
 * @returns {boolean} True when the candidate should replace the incumbent.
 */
export function isPreferredProtectedCleanupStage(familySummary, placement, candidate, incumbent) {
  if (!incumbent) {
    return true;
  }
  if (candidate.audit.collapsedMacrocycleCount !== incumbent.audit.collapsedMacrocycleCount) {
    return candidate.audit.collapsedMacrocycleCount < incumbent.audit.collapsedMacrocycleCount;
  }
  if (incumbent.audit.bondLengthFailureCount === 0 && candidate.audit.bondLengthFailureCount > 0) {
    return false;
  }
  const bondDeviationIncrease = candidate.audit.maxBondLengthDeviation - incumbent.audit.maxBondLengthDeviation;
  const overlapReduction = incumbent.audit.severeOverlapCount - candidate.audit.severeOverlapCount;
  const bondFailureIncrease = candidate.audit.bondLengthFailureCount - incumbent.audit.bondLengthFailureCount;
  if (
    familySummary.primaryFamily === 'bridged'
    && familySummary.mixedMode === false
    && placement.placedFamilies.every(family => family === 'bridged')
    && overlapReduction > 0
    && bondFailureIncrease > 0
    && bondFailureIncrease <= PROTECTED_CLEANUP_STAGE_LIMITS.maxBondFailureIncreaseForOverlapWin
    && bondDeviationIncrease <= PROTECTED_CLEANUP_STAGE_LIMITS.maxBondDeviationIncrease
  ) {
    return true;
  }
  if (shouldPreferFusedMixedOverlapCleanupStage(familySummary, candidate, incumbent)) {
    return true;
  }
  if (shouldPreferOverlapWinOverAddedInwardReadability(candidate, incumbent)) {
    return true;
  }
  if (candidate.audit.bondLengthFailureCount !== incumbent.audit.bondLengthFailureCount) {
    return candidate.audit.bondLengthFailureCount < incumbent.audit.bondLengthFailureCount;
  }
  if (Math.abs(bondDeviationIncrease) > 1e-9) {
    return candidate.audit.maxBondLengthDeviation < incumbent.audit.maxBondLengthDeviation;
  }
  if (candidate.audit.ringSubstituentReadabilityFailureCount !== incumbent.audit.ringSubstituentReadabilityFailureCount) {
    return candidate.audit.ringSubstituentReadabilityFailureCount < incumbent.audit.ringSubstituentReadabilityFailureCount;
  }
  if (candidate.audit.inwardRingSubstituentCount !== incumbent.audit.inwardRingSubstituentCount) {
    return candidate.audit.inwardRingSubstituentCount < incumbent.audit.inwardRingSubstituentCount;
  }
  if (candidate.audit.severeOverlapCount !== incumbent.audit.severeOverlapCount) {
    return candidate.audit.severeOverlapCount < incumbent.audit.severeOverlapCount;
  }
  return false;
}

/**
 * Compares non-stereo cleanup geometry stages using the existing baseline ordering.
 * @param {object} candidate - Candidate stage result.
 * @param {object|null} incumbent - Current incumbent stage result.
 * @returns {boolean} True when the candidate should replace the incumbent.
 */
export function isPreferredCleanupGeometryStage(candidate, incumbent) {
  if (!incumbent) {
    return true;
  }
  if (candidate.audit.ok !== incumbent.audit.ok) {
    return candidate.audit.ok;
  }
  if (candidate.audit.collapsedMacrocycleCount !== incumbent.audit.collapsedMacrocycleCount) {
    return candidate.audit.collapsedMacrocycleCount < incumbent.audit.collapsedMacrocycleCount;
  }
  if (candidate.audit.bondLengthFailureCount !== incumbent.audit.bondLengthFailureCount) {
    return candidate.audit.bondLengthFailureCount < incumbent.audit.bondLengthFailureCount;
  }
  if (Math.abs(candidate.audit.maxBondLengthDeviation - incumbent.audit.maxBondLengthDeviation) > 1e-9) {
    return candidate.audit.maxBondLengthDeviation < incumbent.audit.maxBondLengthDeviation;
  }
  if (shouldPreferOverlapWinOverAddedInwardReadability(candidate, incumbent)) {
    return true;
  }
  if (candidate.audit.ringSubstituentReadabilityFailureCount !== incumbent.audit.ringSubstituentReadabilityFailureCount) {
    return candidate.audit.ringSubstituentReadabilityFailureCount < incumbent.audit.ringSubstituentReadabilityFailureCount;
  }
  if (candidate.audit.inwardRingSubstituentCount !== incumbent.audit.inwardRingSubstituentCount) {
    return candidate.audit.inwardRingSubstituentCount < incumbent.audit.inwardRingSubstituentCount;
  }
  if (candidate.audit.severeOverlapCount !== incumbent.audit.severeOverlapCount) {
    return candidate.audit.severeOverlapCount < incumbent.audit.severeOverlapCount;
  }
  if (candidate.audit.labelOverlapCount !== incumbent.audit.labelOverlapCount) {
    return candidate.audit.labelOverlapCount < incumbent.audit.labelOverlapCount;
  }
  return false;
}
