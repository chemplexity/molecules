/** @module audit/fallback */

/**
 * Recommends the next fallback depiction strategy from the current audit result.
 * @param {object} audit - Audit summary.
 * @returns {{mode: string|null, reasons: string[]}} Fallback recommendation.
 */
export function recommendFallback(audit) {
  const reasons = [];
  let mode = null;

  if (audit.severeOverlapCount > 0) {
    reasons.push('severe-overlaps');
    mode = mode ?? 'generic-scaffold';
  }
  if (audit.collapsedMacrocycleCount > 0) {
    reasons.push('collapsed-macrocycle');
    mode = mode ?? 'macrocycle-circle';
  }
  if (audit.stereoContradiction) {
    reasons.push('stereo-contradiction');
    mode = mode ?? 'pre-cleanup';
  }
  if (audit.bridgedReadabilityFailure) {
    reasons.push('bridged-readability');
    mode = mode ?? 'bridged-template-or-generic';
  }

  return { mode, reasons };
}
