/** @module cleanup/stage-comparators */

import { PROTECTED_CLEANUP_STAGE_LIMITS } from '../constants.js';

const PRESENTATION_METRIC_EPSILON = 1e-9;

/**
 * Returns whether two stages carry comparable finite metric values.
 * @param {object} candidate - Candidate stage result.
 * @param {object} incumbent - Current incumbent stage result.
 * @param {string} key - Metric key to compare.
 * @returns {boolean} True when both stages expose a finite numeric metric.
 */
function hasComparableFiniteMetric(candidate, incumbent, key) {
  return Number.isFinite(candidate?.[key]) && Number.isFinite(incumbent?.[key]);
}

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
  const divalentContinuationIncrease = (candidate.divalentContinuationPenalty ?? 0) - (incumbent.divalentContinuationPenalty ?? 0);
  const omittedHydrogenTrigonalImprovement = (incumbent.omittedHydrogenTrigonalPenalty ?? 0) - (candidate.omittedHydrogenTrigonalPenalty ?? 0);
  const allowsDivalentPresentationTradeoff = allowPresentationTieBreak && (
    omittedHydrogenTrigonalImprovement > divalentContinuationIncrease + 1e-9
  );
  if (divalentContinuationIncrease > 1e-9 && !allowsDivalentPresentationTradeoff) {
    return false;
  }
  if (
    allowPresentationTieBreak
    && Math.abs(divalentContinuationIncrease) > 1e-9
    && !allowsDivalentPresentationTradeoff
  ) {
    return (candidate.divalentContinuationPenalty ?? 0) < (incumbent.divalentContinuationPenalty ?? 0);
  }
  if (
    allowPresentationTieBreak
    && hasComparableFiniteMetric(candidate, incumbent, 'hypervalentDeviation')
    && Math.abs(candidate.hypervalentDeviation - incumbent.hypervalentDeviation) > PRESENTATION_METRIC_EPSILON
  ) {
    return candidate.hypervalentDeviation < incumbent.hypervalentDeviation;
  }
  if (allowPresentationTieBreak && Math.abs((candidate.phosphateArylTailPenalty ?? 0) - (incumbent.phosphateArylTailPenalty ?? 0)) > 1e-9) {
    return (candidate.phosphateArylTailPenalty ?? 0) < (incumbent.phosphateArylTailPenalty ?? 0);
  }
  if (allowPresentationTieBreak && Math.abs((candidate.terminalCationRingProximityPenalty ?? 0) - (incumbent.terminalCationRingProximityPenalty ?? 0)) > 1e-9) {
    return (candidate.terminalCationRingProximityPenalty ?? 0) < (incumbent.terminalCationRingProximityPenalty ?? 0);
  }
  if (allowPresentationTieBreak && Math.abs((candidate.omittedHydrogenTrigonalPenalty ?? 0) - (incumbent.omittedHydrogenTrigonalPenalty ?? 0)) > 1e-9) {
    return (candidate.omittedHydrogenTrigonalPenalty ?? 0) < (incumbent.omittedHydrogenTrigonalPenalty ?? 0);
  }
  if (allowPresentationTieBreak && Math.abs((candidate.terminalHeteroOutwardMaxPenalty ?? 0) - (incumbent.terminalHeteroOutwardMaxPenalty ?? 0)) > 1e-9) {
    return (candidate.terminalHeteroOutwardMaxPenalty ?? 0) < (incumbent.terminalHeteroOutwardMaxPenalty ?? 0);
  }
  if (allowPresentationTieBreak && Math.abs((candidate.terminalHeteroOutwardPenalty ?? 0) - (incumbent.terminalHeteroOutwardPenalty ?? 0)) > 1e-9) {
    return (candidate.terminalHeteroOutwardPenalty ?? 0) < (incumbent.terminalHeteroOutwardPenalty ?? 0);
  }
  if (allowPresentationTieBreak && Math.abs((candidate.terminalMultipleBondLeafFanMaxPenalty ?? 0) - (incumbent.terminalMultipleBondLeafFanMaxPenalty ?? 0)) > 1e-9) {
    return (candidate.terminalMultipleBondLeafFanMaxPenalty ?? 0) < (incumbent.terminalMultipleBondLeafFanMaxPenalty ?? 0);
  }
  if (allowPresentationTieBreak && Math.abs((candidate.terminalMultipleBondLeafFanPenalty ?? 0) - (incumbent.terminalMultipleBondLeafFanPenalty ?? 0)) > 1e-9) {
    return (candidate.terminalMultipleBondLeafFanPenalty ?? 0) < (incumbent.terminalMultipleBondLeafFanPenalty ?? 0);
  }
  if (allowPresentationTieBreak && Math.abs((candidate.attachedRingPeripheralPenalty ?? 0) - (incumbent.attachedRingPeripheralPenalty ?? 0)) > 1e-9) {
    return (candidate.attachedRingPeripheralPenalty ?? 0) < (incumbent.attachedRingPeripheralPenalty ?? 0);
  }
  if (allowPresentationTieBreak && Math.abs((candidate.attachedRingRootOutwardPenalty ?? 0) - (incumbent.attachedRingRootOutwardPenalty ?? 0)) > 1e-9) {
    return (candidate.attachedRingRootOutwardPenalty ?? 0) < (incumbent.attachedRingRootOutwardPenalty ?? 0);
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
 * Allows a stage with fewer severe overlaps to tolerate a small ring-substituent
 * readability regression. A real atom-on-atom clash is visually worse than a
 * single outward-axis presentation miss, and later presentation cleanup still
 * gets a chance to polish the accepted non-overlapping geometry.
 * @param {object} candidate - Candidate stage result.
 * @param {object|null} incumbent - Current incumbent stage result.
 * @returns {boolean} True when the overlap win should override readability tie-breaks.
 */
export function shouldPreferOverlapWinOverMinorReadabilityRegression(candidate, incumbent) {
  if (!incumbent || candidate.audit.severeOverlapCount >= incumbent.audit.severeOverlapCount) {
    return false;
  }
  if (candidate.audit.severeOverlapCount !== 0) {
    return false;
  }
  if (candidate.audit.bondLengthFailureCount !== incumbent.audit.bondLengthFailureCount) {
    return false;
  }
  if (candidate.audit.maxBondLengthDeviation > incumbent.audit.maxBondLengthDeviation + 1e-9) {
    return false;
  }
  if (candidate.audit.labelOverlapCount > incumbent.audit.labelOverlapCount) {
    return false;
  }
  return (
    candidate.audit.ringSubstituentReadabilityFailureCount <= incumbent.audit.ringSubstituentReadabilityFailureCount + 1
    && candidate.audit.inwardRingSubstituentCount <= incumbent.audit.inwardRingSubstituentCount + 1
    && candidate.audit.outwardAxisRingSubstituentFailureCount <= incumbent.audit.outwardAxisRingSubstituentFailureCount + 1
  );
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
  if (shouldPreferOverlapWinOverMinorReadabilityRegression(candidate, incumbent)) {
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
  if (Math.abs((candidate.presentationPenalty ?? 0) - (incumbent.presentationPenalty ?? 0)) > 1e-9) {
    return (candidate.presentationPenalty ?? 0) < (incumbent.presentationPenalty ?? 0);
  }
  if (Math.abs((candidate.terminalCationRingProximityPenalty ?? 0) - (incumbent.terminalCationRingProximityPenalty ?? 0)) > 1e-9) {
    return (candidate.terminalCationRingProximityPenalty ?? 0) < (incumbent.terminalCationRingProximityPenalty ?? 0);
  }
  if (Math.abs((candidate.terminalHeteroOutwardMaxPenalty ?? 0) - (incumbent.terminalHeteroOutwardMaxPenalty ?? 0)) > 1e-9) {
    return (candidate.terminalHeteroOutwardMaxPenalty ?? 0) < (incumbent.terminalHeteroOutwardMaxPenalty ?? 0);
  }
  if (Math.abs((candidate.terminalHeteroOutwardPenalty ?? 0) - (incumbent.terminalHeteroOutwardPenalty ?? 0)) > 1e-9) {
    return (candidate.terminalHeteroOutwardPenalty ?? 0) < (incumbent.terminalHeteroOutwardPenalty ?? 0);
  }
  if (Math.abs((candidate.terminalMultipleBondLeafFanMaxPenalty ?? 0) - (incumbent.terminalMultipleBondLeafFanMaxPenalty ?? 0)) > 1e-9) {
    return (candidate.terminalMultipleBondLeafFanMaxPenalty ?? 0) < (incumbent.terminalMultipleBondLeafFanMaxPenalty ?? 0);
  }
  if (Math.abs((candidate.terminalMultipleBondLeafFanPenalty ?? 0) - (incumbent.terminalMultipleBondLeafFanPenalty ?? 0)) > 1e-9) {
    return (candidate.terminalMultipleBondLeafFanPenalty ?? 0) < (incumbent.terminalMultipleBondLeafFanPenalty ?? 0);
  }
  return false;
}

/**
 * Comparator for label-clearance/symmetry-tidy stages: accepts when label overlaps decrease
 * or presentation penalty improves, and never penalises the bond-deviation side-effect of
 * nudging atoms to clear element labels.
 * @param {object} candidate - Candidate stage result.
 * @param {object|null} incumbent - Current incumbent stage result.
 * @returns {boolean} True when the candidate should replace the incumbent.
 */
export function isPreferredLabelClearanceStage(candidate, incumbent) {
  if (!incumbent) {
    return true;
  }
  if (candidate.audit.bondLengthFailureCount > incumbent.audit.bondLengthFailureCount) {
    return false;
  }
  if (candidate.audit.labelOverlapCount < incumbent.audit.labelOverlapCount) {
    return true;
  }
  if (Math.abs((candidate.presentationPenalty ?? 0) - (incumbent.presentationPenalty ?? 0)) > 1e-9) {
    return (candidate.presentationPenalty ?? 0) < (incumbent.presentationPenalty ?? 0);
  }
  if (Math.abs((candidate.terminalCationRingProximityPenalty ?? 0) - (incumbent.terminalCationRingProximityPenalty ?? 0)) > 1e-9) {
    return (candidate.terminalCationRingProximityPenalty ?? 0) < (incumbent.terminalCationRingProximityPenalty ?? 0);
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
  if (shouldPreferOverlapWinOverMinorReadabilityRegression(candidate, incumbent)) {
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
  if (Math.abs((candidate.presentationPenalty ?? 0) - (incumbent.presentationPenalty ?? 0)) > 1e-9) {
    return (candidate.presentationPenalty ?? 0) < (incumbent.presentationPenalty ?? 0);
  }
  if (Math.abs((candidate.terminalCationRingProximityPenalty ?? 0) - (incumbent.terminalCationRingProximityPenalty ?? 0)) > 1e-9) {
    return (candidate.terminalCationRingProximityPenalty ?? 0) < (incumbent.terminalCationRingProximityPenalty ?? 0);
  }
  return false;
}
