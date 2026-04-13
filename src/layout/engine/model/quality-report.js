/** @module model/quality-report */

/**
 * Creates a stable quality report from cleanup, stereo, and audit phases.
 * @param {object} input - Quality-report inputs.
 * @param {object} input.audit - Audit summary.
 * @param {object} input.cleanup - Cleanup summary.
 * @param {object} input.stereo - Stereo summary.
 * @param {object} input.ringDependency - Ring-dependency summary.
 * @param {object} input.policy - Standards-policy bundle.
 * @returns {object} Quality report.
 */
export function createQualityReport(input) {
  return {
    ok: input.audit.ok,
    audit: input.audit,
    cleanup: {
      passes: input.cleanup.passes ?? 0,
      improvement: input.cleanup.improvement ?? 0,
      overlapMoves: input.cleanup.overlapMoves ?? 0,
      labelNudges: input.cleanup.labelNudges ?? 0,
      symmetrySnaps: input.cleanup.symmetrySnaps ?? 0,
      junctionSnaps: input.cleanup.junctionSnaps ?? 0
    },
    stereo: input.stereo,
    ringDependency: input.ringDependency,
    policy: input.policy
  };
}
