/** @module cleanup/stage-comparators */

import { PRESENTATION_METRIC_EPSILON, PROTECTED_CLEANUP_STAGE_LIMITS } from '../constants.js';

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
 * Compares two integer audit counts.
 * @param {number} a - Candidate count.
 * @param {number} b - Incumbent count.
 * @returns {boolean|null} True when a < b, false when a > b, null when equal.
 */
function compareCount(a, b) {
  if (a === b) {
    return null;
  }
  return a < b;
}

/**
 * Compares two floating-point audit deviation values using PRESENTATION_METRIC_EPSILON.
 * @param {number} a - Candidate deviation.
 * @param {number} b - Incumbent deviation.
 * @returns {boolean|null} True when a < b by more than epsilon, false when a > b by more than epsilon, null within epsilon.
 */
function compareDeviation(a, b) {
  if (Math.abs(a - b) <= PRESENTATION_METRIC_EPSILON) {
    return null;
  }
  return a < b;
}

/**
 * Compares a presentation penalty field between candidate and incumbent, applying
 * `?? 0` defaults and PRESENTATION_METRIC_EPSILON tolerance.
 * @param {object} candidate - Candidate stage result.
 * @param {object} incumbent - Incumbent stage result.
 * @param {string} key - Penalty field name.
 * @returns {boolean|null} True when candidate is better, false when worse, null when indistinguishable.
 */
function comparePenalty(candidate, incumbent, key) {
  const a = candidate[key] ?? 0;
  const b = incumbent[key] ?? 0;
  if (Math.abs(a - b) <= PRESENTATION_METRIC_EPSILON) {
    return null;
  }
  return a < b;
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
  let r;
  if ((r = compareCount(candidate.audit.bondLengthFailureCount, incumbent.audit.bondLengthFailureCount)) !== null) {
    return r;
  }
  if ((r = compareDeviation(candidate.audit.maxBondLengthDeviation, incumbent.audit.maxBondLengthDeviation)) !== null) {
    return r;
  }
  if ((r = compareCount(candidate.audit.ringSubstituentReadabilityFailureCount, incumbent.audit.ringSubstituentReadabilityFailureCount)) !== null) {
    return r;
  }
  if ((r = compareCount(candidate.audit.inwardRingSubstituentCount, incumbent.audit.inwardRingSubstituentCount)) !== null) {
    return r;
  }
  if ((r = compareCount(candidate.audit.severeOverlapCount, incumbent.audit.severeOverlapCount)) !== null) {
    return r;
  }
  if ((r = compareCount(candidate.audit.visibleHeavyBondCrossingCount ?? 0, incumbent.audit.visibleHeavyBondCrossingCount ?? 0)) !== null) {
    return r;
  }
  if ((r = compareCount(candidate.audit.labelOverlapCount, incumbent.audit.labelOverlapCount)) !== null) {
    return r;
  }
  const divalentContinuationIncrease = (candidate.divalentContinuationPenalty ?? 0) - (incumbent.divalentContinuationPenalty ?? 0);
  const omittedHydrogenTrigonalImprovement = (incumbent.omittedHydrogenTrigonalPenalty ?? 0) - (candidate.omittedHydrogenTrigonalPenalty ?? 0);
  const phosphateArylTailImprovement = (incumbent.phosphateArylTailPenalty ?? 0) - (candidate.phosphateArylTailPenalty ?? 0);
  const allowsDivalentPresentationTradeoff =
    allowPresentationTieBreak &&
    (omittedHydrogenTrigonalImprovement > divalentContinuationIncrease + PRESENTATION_METRIC_EPSILON ||
      phosphateArylTailImprovement > divalentContinuationIncrease + PRESENTATION_METRIC_EPSILON);
  if (divalentContinuationIncrease > PRESENTATION_METRIC_EPSILON && !allowsDivalentPresentationTradeoff) {
    return false;
  }
  if (!allowPresentationTieBreak) {
    return false;
  }
  if (Math.abs(divalentContinuationIncrease) > PRESENTATION_METRIC_EPSILON && !allowsDivalentPresentationTradeoff) {
    return (candidate.divalentContinuationPenalty ?? 0) < (incumbent.divalentContinuationPenalty ?? 0);
  }
  if (hasComparableFiniteMetric(candidate, incumbent, 'hypervalentDeviation') && (r = compareDeviation(candidate.hypervalentDeviation, incumbent.hypervalentDeviation)) !== null) {
    return r;
  }
  if ((r = comparePenalty(candidate, incumbent, 'phosphateArylTailPenalty')) !== null) {
    return r;
  }
  if ((r = comparePenalty(candidate, incumbent, 'terminalCationRingProximityPenalty')) !== null) {
    return r;
  }
  if ((r = comparePenalty(candidate, incumbent, 'omittedHydrogenTrigonalPenalty')) !== null) {
    return r;
  }
  if ((r = comparePenalty(candidate, incumbent, 'terminalHeteroOutwardMaxPenalty')) !== null) {
    return r;
  }
  if ((r = comparePenalty(candidate, incumbent, 'terminalHeteroOutwardPenalty')) !== null) {
    return r;
  }
  if ((r = comparePenalty(candidate, incumbent, 'terminalMultipleBondLeafFanMaxPenalty')) !== null) {
    return r;
  }
  if ((r = comparePenalty(candidate, incumbent, 'terminalMultipleBondLeafFanPenalty')) !== null) {
    return r;
  }
  if ((r = comparePenalty(candidate, incumbent, 'smallRingExteriorFanExactMaxPenalty')) !== null) {
    return r;
  }
  if ((r = comparePenalty(candidate, incumbent, 'smallRingExteriorFanExactPenalty')) !== null) {
    return r;
  }
  if ((r = comparePenalty(candidate, incumbent, 'attachedRingPeripheralPenalty')) !== null) {
    return r;
  }
  if ((r = comparePenalty(candidate, incumbent, 'attachedRingRootOutwardPenalty')) !== null) {
    return r;
  }
  if ((r = comparePenalty(candidate, incumbent, 'presentationPenalty')) !== null) {
    return r;
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
    candidate.audit.maxBondLengthDeviation <= PROTECTED_CLEANUP_STAGE_LIMITS.maxFusedMixedBondDeviationForOverlapWin &&
    candidate.audit.meanBondLengthDeviation <= PROTECTED_CLEANUP_STAGE_LIMITS.maxFusedMixedMeanDeviationForOverlapWin
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
  if (candidate.audit.maxBondLengthDeviation > incumbent.audit.maxBondLengthDeviation + PRESENTATION_METRIC_EPSILON) {
    return false;
  }
  if (candidate.audit.labelOverlapCount > incumbent.audit.labelOverlapCount) {
    return false;
  }
  return (
    candidate.audit.ringSubstituentReadabilityFailureCount <= incumbent.audit.ringSubstituentReadabilityFailureCount + 1 &&
    candidate.audit.inwardRingSubstituentCount <= incumbent.audit.inwardRingSubstituentCount + 1 &&
    candidate.audit.outwardAxisRingSubstituentFailureCount <= incumbent.audit.outwardAxisRingSubstituentFailureCount + 1
  );
}

/**
 * Allows a cleanup stage that removes visible heavy-bond crossings to tolerate
 * the same small readability tradeoff permitted for atom-overlap wins.
 * @param {object} candidate - Candidate stage result.
 * @param {object|null} incumbent - Current incumbent stage result.
 * @returns {boolean} True when the crossing win should override readability tie-breaks.
 */
export function shouldPreferCrossingWinOverMinorReadabilityRegression(candidate, incumbent) {
  if (!incumbent || (candidate.audit.visibleHeavyBondCrossingCount ?? 0) >= (incumbent.audit.visibleHeavyBondCrossingCount ?? 0)) {
    return false;
  }
  if ((candidate.audit.visibleHeavyBondCrossingCount ?? 0) !== 0) {
    return false;
  }
  if (candidate.audit.severeOverlapCount !== incumbent.audit.severeOverlapCount) {
    return false;
  }
  if (candidate.audit.bondLengthFailureCount !== incumbent.audit.bondLengthFailureCount) {
    return false;
  }
  if (candidate.audit.maxBondLengthDeviation > incumbent.audit.maxBondLengthDeviation + PRESENTATION_METRIC_EPSILON) {
    return false;
  }
  if (candidate.audit.labelOverlapCount > incumbent.audit.labelOverlapCount) {
    return false;
  }
  return (
    candidate.audit.ringSubstituentReadabilityFailureCount <= incumbent.audit.ringSubstituentReadabilityFailureCount + 1 &&
    candidate.audit.inwardRingSubstituentCount <= incumbent.audit.inwardRingSubstituentCount + 1 &&
    candidate.audit.outwardAxisRingSubstituentFailureCount <= incumbent.audit.outwardAxisRingSubstituentFailureCount + 1
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
  if (shouldPreferCrossingWinOverMinorReadabilityRegression(candidate, incumbent)) {
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
    familySummary.primaryFamily === 'bridged' &&
    familySummary.mixedMode === false &&
    placement.placedFamilies.every(family => family === 'bridged') &&
    overlapReduction > 0 &&
    bondFailureIncrease > 0 &&
    bondFailureIncrease <= PROTECTED_CLEANUP_STAGE_LIMITS.maxBondFailureIncreaseForOverlapWin &&
    bondDeviationIncrease <= PROTECTED_CLEANUP_STAGE_LIMITS.maxBondDeviationIncrease
  ) {
    return true;
  }
  if (shouldPreferFusedMixedOverlapCleanupStage(familySummary, candidate, incumbent)) {
    return true;
  }
  if (shouldPreferOverlapWinOverMinorReadabilityRegression(candidate, incumbent)) {
    return true;
  }
  let r;
  if ((r = compareCount(candidate.audit.bondLengthFailureCount, incumbent.audit.bondLengthFailureCount)) !== null) {
    return r;
  }
  if ((r = compareDeviation(candidate.audit.maxBondLengthDeviation, incumbent.audit.maxBondLengthDeviation)) !== null) {
    return r;
  }
  if ((r = compareCount(candidate.audit.ringSubstituentReadabilityFailureCount, incumbent.audit.ringSubstituentReadabilityFailureCount)) !== null) {
    return r;
  }
  if ((r = compareCount(candidate.audit.inwardRingSubstituentCount, incumbent.audit.inwardRingSubstituentCount)) !== null) {
    return r;
  }
  if ((r = compareCount(candidate.audit.severeOverlapCount, incumbent.audit.severeOverlapCount)) !== null) {
    return r;
  }
  if ((r = compareCount(candidate.audit.visibleHeavyBondCrossingCount ?? 0, incumbent.audit.visibleHeavyBondCrossingCount ?? 0)) !== null) {
    return r;
  }
  if ((r = comparePenalty(candidate, incumbent, 'presentationPenalty')) !== null) {
    return r;
  }
  if ((r = comparePenalty(candidate, incumbent, 'terminalCationRingProximityPenalty')) !== null) {
    return r;
  }
  if ((r = comparePenalty(candidate, incumbent, 'terminalHeteroOutwardMaxPenalty')) !== null) {
    return r;
  }
  if ((r = comparePenalty(candidate, incumbent, 'terminalHeteroOutwardPenalty')) !== null) {
    return r;
  }
  if ((r = comparePenalty(candidate, incumbent, 'terminalMultipleBondLeafFanMaxPenalty')) !== null) {
    return r;
  }
  if ((r = comparePenalty(candidate, incumbent, 'terminalMultipleBondLeafFanPenalty')) !== null) {
    return r;
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
  let r;
  if ((r = comparePenalty(candidate, incumbent, 'presentationPenalty')) !== null) {
    return r;
  }
  if ((r = comparePenalty(candidate, incumbent, 'terminalCationRingProximityPenalty')) !== null) {
    return r;
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
  if (shouldPreferCrossingWinOverMinorReadabilityRegression(candidate, incumbent)) {
    return true;
  }
  if (candidate.audit.ok !== incumbent.audit.ok) {
    return candidate.audit.ok;
  }
  let r;
  if ((r = compareCount(candidate.audit.collapsedMacrocycleCount, incumbent.audit.collapsedMacrocycleCount)) !== null) {
    return r;
  }
  if ((r = compareCount(candidate.audit.bondLengthFailureCount, incumbent.audit.bondLengthFailureCount)) !== null) {
    return r;
  }
  if ((r = compareDeviation(candidate.audit.maxBondLengthDeviation, incumbent.audit.maxBondLengthDeviation)) !== null) {
    return r;
  }
  if (shouldPreferOverlapWinOverMinorReadabilityRegression(candidate, incumbent)) {
    return true;
  }
  if ((r = compareCount(candidate.audit.ringSubstituentReadabilityFailureCount, incumbent.audit.ringSubstituentReadabilityFailureCount)) !== null) {
    return r;
  }
  if ((r = compareCount(candidate.audit.inwardRingSubstituentCount, incumbent.audit.inwardRingSubstituentCount)) !== null) {
    return r;
  }
  if ((r = compareCount(candidate.audit.severeOverlapCount, incumbent.audit.severeOverlapCount)) !== null) {
    return r;
  }
  if ((r = compareCount(candidate.audit.visibleHeavyBondCrossingCount ?? 0, incumbent.audit.visibleHeavyBondCrossingCount ?? 0)) !== null) {
    return r;
  }
  if ((r = compareCount(candidate.audit.labelOverlapCount, incumbent.audit.labelOverlapCount)) !== null) {
    return r;
  }
  if ((r = comparePenalty(candidate, incumbent, 'presentationPenalty')) !== null) {
    return r;
  }
  if ((r = comparePenalty(candidate, incumbent, 'terminalCationRingProximityPenalty')) !== null) {
    return r;
  }
  return false;
}
