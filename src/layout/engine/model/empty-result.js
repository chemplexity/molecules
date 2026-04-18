/** @module model/empty-result */

import { resolvePolicy } from '../standards/profile-policy.js';
import { createQualityReport } from './quality-report.js';

/**
 * Builds the stable unsupported/empty pipeline result shape.
 * @param {object|null} molecule - Source molecule, when present.
 * @param {object} normalizedOptions - Normalized pipeline options.
 * @param {string} profile - Resolved profile name.
 * @param {string} reason - Unsupported-result reason string.
 * @returns {{molecule: object|null, coords: Map<string, {x: number, y: number}>, layoutGraph: null, metadata: object}} Empty pipeline result.
 */
export function createEmptyPipelineResult(molecule, normalizedOptions, profile, reason) {
  const policy = resolvePolicy(profile, {});
  const ringDependency = {
    ok: true,
    requiresDedicatedRingEngine: false,
    suspiciousSystemCount: 0,
    systems: [],
    rings: [],
    connections: []
  };
  const stereo = {
    ezCheckedBondCount: 0,
    ezSupportedBondCount: 0,
    ezUnsupportedBondCount: 0,
    ezResolvedBondCount: 0,
    ezViolationCount: 0,
    ezChecks: [],
    annotatedCenterCount: 0,
    chiralCenterCount: 0,
    assignedCenterCount: 0,
    unassignedCenterCount: 0,
    assignments: [],
    missingCenterIds: [],
    unsupportedCenterCount: 0,
    unsupportedCenterIds: []
  };
  const cleanup = {
    passes: 0,
    improvement: 0,
    overlapMoves: 0,
    labelNudges: 0,
    symmetrySnaps: 0,
    junctionSnaps: 0,
    stereoReflections: 0,
    postHookNudges: 0
  };
  const audit = {
    ok: false,
    severeOverlapCount: 0,
    minSevereOverlapDistance: null,
    worstOverlapDeficit: 0,
    severeOverlapPenalty: 0,
    labelOverlapCount: 0,
    maxBondLengthDeviation: 0,
    meanBondLengthDeviation: 0,
    bondLengthFailureCount: 0,
    mildBondLengthFailureCount: 0,
    severeBondLengthFailureCount: 0,
    bondLengthSampleCount: 0,
    collapsedMacrocycleCount: 0,
    stereoContradiction: false,
    bridgedReadabilityFailure: false,
    ringSubstituentReadabilityFailureCount: 0,
    inwardRingSubstituentCount: 0,
    outwardAxisRingSubstituentFailureCount: 0,
    fallback: {
      recommended: false,
      mode: null,
      reasons: []
    },
    reason
  };

  return {
    molecule: molecule ?? null,
    coords: new Map(),
    layoutGraph: null,
    metadata: {
      stage: 'unsupported',
      profile,
      primaryFamily: 'empty',
      mixedMode: false,
      componentCount: 0,
      ringCount: 0,
      ringSystemCount: 0,
      fixedAtomCount: normalizedOptions.fixedCoords.size,
      existingCoordCount: normalizedOptions.existingCoords.size,
      placedComponentCount: 0,
      unplacedComponentCount: 0,
      preservedComponentCount: 0,
      placedFamilies: [],
      bondValidationClassCount: 0,
      displayAssignmentCount: 0,
      displayAssignments: [],
      policy,
      ringDependency,
      stereo,
      cleanupPasses: cleanup.passes,
      cleanupImprovement: cleanup.improvement,
      cleanupOverlapMoves: cleanup.overlapMoves,
      cleanupLabelNudges: cleanup.labelNudges,
      cleanupSymmetrySnaps: cleanup.symmetrySnaps,
      cleanupJunctionSnaps: cleanup.junctionSnaps,
      cleanupStereoReflections: cleanup.stereoReflections,
      cleanupPostHookNudges: cleanup.postHookNudges,
      audit,
      ...(normalizedOptions.auditTelemetry
        ? {
            placementFamily: null,
            placementMode: null,
            placementModes: [],
            componentPlacements: [],
            placementAudit: null,
            stageTelemetry: {
              selectedGeometryStage: null,
              selectedStage: null,
              firstDirtyStage: null,
              finalDirtyStage: null,
              stageAudits: {}
            }
          }
        : {}),
      qualityReport: createQualityReport({
        audit,
        cleanup,
        stereo,
        ringDependency,
        policy
      })
    }
  };
}
