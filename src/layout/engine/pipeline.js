/** @module pipeline */

import { normalizeOptions } from './options.js';
import { resolveProfile } from './profile.js';
import { createLayoutGraphFromNormalized } from './model/layout-graph.js';
import { resolvePolicy } from './standards/profile-policy.js';
import { layoutSupportedComponents } from './placement/component-layout.js';
import { applyLabelClearance } from './cleanup/label-clearance.js';
import { runBridgedBondTidy } from './cleanup/bridged-bond-tidy.js';
import { runHypervalentAngleTidy } from './cleanup/hypervalent-angle-tidy.js';
import { runLigandAngleTidy } from './cleanup/ligand-angle-tidy.js';
import { runRingPerimeterCorrection } from './cleanup/ring-perimeter-correction.js';
import { measureRingSubstituentPresentationPenalty, runRingSubstituentTidy } from './cleanup/ring-substituent-tidy.js';
import { runRingTerminalHeteroTidy } from './cleanup/ring-terminal-hetero-tidy.js';
import { tidySymmetry } from './cleanup/symmetry-tidy.js';
import { runUnifiedCleanup } from './cleanup/unified-cleanup.js';
import { auditLayout } from './audit/audit.js';
import { createQualityReport } from './model/quality-report.js';
import { collectProtectedEZAtomIds, inspectEZStereo } from './stereo/ez.js';
import { enforceAcyclicEZStereo } from './stereo/enforcement.js';
import { pickWedgeAssignments } from './stereo/wedge-selection.js';
import { inspectRingDependency } from './topology/ring-dependency.js';
import { exceedsLargeComponentThreshold, exceedsLargeMoleculeThreshold } from './topology/large-blocks.js';
import { findMacrocycleRings } from './topology/macrocycles.js';
import { buildScaffoldPlan } from './model/scaffold-plan.js';
import { PROTECTED_CLEANUP_STAGE_LIMITS } from './constants.js';

/**
 * Returns the current high-resolution time when available, with a Date fallback
 * for runtimes that do not expose the Performance API.
 * @returns {number} Current time in milliseconds.
 */
function nowMs() {
  return typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : Date.now();
}

/**
 * Returns the atom count for a molecule-like input when it can be determined.
 * @param {object|null|undefined} molecule - Molecule-like value.
 * @returns {number|null} Atom count, or null when the value is not molecule-like.
 */
function moleculeAtomCount(molecule) {
  if (!molecule || typeof molecule !== 'object') {
    return null;
  }
  if (Number.isInteger(molecule.atomCount)) {
    return molecule.atomCount;
  }
  if (molecule.atoms instanceof Map) {
    return molecule.atoms.size;
  }
  return null;
}

/**
 * Returns whether the input is missing or has no atoms to lay out.
 * @param {object|null|undefined} molecule - Molecule-like value.
 * @returns {boolean} True when the pipeline should short-circuit.
 */
function isEmptyLayoutInput(molecule) {
  const atomCount = moleculeAtomCount(molecule);
  return atomCount == null || atomCount === 0;
}

/**
 * Builds the stable empty/invalid pipeline result used for guarded API entry.
 * @param {object|null|undefined} molecule - Original molecule input.
 * @param {object} normalizedOptions - Normalized layout options.
 * @param {string} profile - Resolved profile name.
 * @param {'empty-molecule'|'invalid-molecule'} reason - Guard reason.
 * @returns {object} Empty pipeline result.
 */
function createEmptyPipelineResult(molecule, normalizedOptions, profile, reason) {
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

function selectPrimaryPlacement(componentPlacements = []) {
  return componentPlacements.find(detail => detail.role === 'principal' && detail.placed && !detail.preserved)
    ?? componentPlacements.find(detail => detail.placed && !detail.preserved)
    ?? componentPlacements.find(detail => detail.placed)
    ?? componentPlacements[0]
    ?? null;
}

function buildPlacementTelemetry(placement) {
  const componentPlacements = placement.componentPlacements ?? [];
  const primaryPlacement = selectPrimaryPlacement(componentPlacements);
  return {
    placementFamily: primaryPlacement?.family ?? null,
    placementMode: primaryPlacement?.placementMode ?? null,
    placementModes: [...new Set(componentPlacements.map(detail => detail.placementMode).filter(Boolean))],
    componentPlacements
  };
}

function buildStageTelemetry(stageEntries, selectedGeometryStage, selectedStage) {
  const stageAudits = Object.fromEntries(stageEntries.map(entry => [entry.name, entry.audit]));
  const firstDirtyStage = stageEntries.find(entry => entry.audit?.ok === false)?.name ?? null;
  return {
    selectedGeometryStage,
    selectedStage,
    firstDirtyStage,
    finalDirtyStage: stageAudits[selectedStage]?.ok === false ? selectedStage : null,
    stageAudits
  };
}

function buildInitialCoordsMap(options) {
  const coords = new Map();
  for (const [atomId, position] of options.existingCoords) {
    coords.set(atomId, { ...position });
  }
  for (const [atomId, position] of options.fixedCoords) {
    coords.set(atomId, { ...position });
  }
  return coords;
}

/**
 * Returns a timing accumulator when enabled.
 * @param {boolean} enabled - Whether timing should be recorded.
 * @returns {{enabled: boolean, startTime: number, placementMs: number, cleanupMs: number, labelClearanceMs: number, stereoMs: number, auditMs: number}|null} Timing accumulator.
 */
function createTimingState(enabled) {
  if (!enabled) {
    return null;
  }
  return {
    enabled: true,
    startTime: nowMs(),
    placementMs: 0,
    cleanupMs: 0,
    labelClearanceMs: 0,
    stereoMs: 0,
    auditMs: 0
  };
}

/**
 * Applies the configured post-cleanup hook list to the current coordinates.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Coordinate map.
 * @param {object} policy - Resolved policy bundle.
 * @param {object} options - Hook options.
 * @param {number} options.bondLength - Target bond length.
 * @returns {{coords: Map<string, {x: number, y: number}>, hookNudges: number}} Hook-adjusted coordinates and total hook nudges.
 */
function runPostCleanupHooks(layoutGraph, inputCoords, policy, options) {
  const hookRunners = new Map([
    [
      'ring-perimeter-correction',
      coords =>
        runRingPerimeterCorrection(layoutGraph, coords, {
          bondLength: options.bondLength
        })
    ],
    [
      'bridged-bond-tidy',
      coords =>
        runBridgedBondTidy(layoutGraph, coords, {
          bondLength: options.bondLength
        })
    ],
    [
      'hypervalent-angle-tidy',
      coords =>
        runHypervalentAngleTidy(layoutGraph, coords, {
          bondLength: options.bondLength
        })
    ],
    [
      'ligand-angle-tidy',
      coords =>
        runLigandAngleTidy(layoutGraph, coords, {
          bondLength: options.bondLength
        })
    ],
    [
      'ring-substituent-tidy',
      coords =>
        runRingSubstituentTidy(layoutGraph, coords, {
          bondLength: options.bondLength,
          frozenAtomIds: options.frozenAtomIds
        })
    ],
    [
      'ring-terminal-hetero-tidy',
      coords =>
        runRingTerminalHeteroTidy(layoutGraph, coords, {
          bondLength: options.bondLength
        })
    ]
  ]);
  let coords = inputCoords;
  let hookNudges = 0;

  for (const hookName of policy.postCleanupHooks ?? []) {
    const runHook = hookRunners.get(hookName);
    if (!runHook) {
      continue;
    }
    const result = runHook(coords);
    coords = result.coords;
    hookNudges += result.nudges ?? 0;
  }

  return { coords, hookNudges };
}

const CLEANUP_BOND_PROTECTED_PRIMARY_FAMILIES = new Set(['large-molecule', 'macrocycle', 'bridged', 'fused', 'organometallic']);

/**
 * Returns whether cleanup should preserve bond integrity more aggressively for
 * the current layout family.
 * @param {{primaryFamily: string, mixedMode: boolean}} familySummary - Family classification.
 * @param {object} placement - Placement result.
 * @returns {boolean} True when cleanup should prefer pre-cleanup geometry over new bond failures.
 */
function shouldProtectCleanupBondIntegrity(familySummary, placement) {
  return placement.placedFamilies.includes('large-molecule') || CLEANUP_BOND_PROTECTED_PRIMARY_FAMILIES.has(familySummary.primaryFamily);
}

/**
 * Audits one cleanup-stage coordinate snapshot against geometry-only checks.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinates.
 * @param {object} placement - Placement result.
 * @param {number} bondLength - Target bond length.
 * @returns {object} Geometry audit summary.
 */
function auditCleanupStage(layoutGraph, coords, placement, bondLength) {
  return auditLayout(layoutGraph, coords, {
    bondLength,
    bondValidationClasses: placement.bondValidationClasses
  });
}

/**
 * Measures a presentation-only tie-breaker for cleanup stages whose audit
 * outcomes are otherwise identical.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinates.
 * @returns {number} Ring-substituent presentation penalty.
 */
function measureCleanupStagePresentationPenalty(layoutGraph, coords) {
  return measureRingSubstituentPresentationPenalty(layoutGraph, coords);
}

/**
 * Audits a late cleanup/stereo candidate against full geometry + stereo checks.
 * @param {object} molecule - Molecule-like graph.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinates.
 * @param {object} placement - Placement result.
 * @param {number} bondLength - Target bond length.
 * @returns {{coords: Map<string, {x: number, y: number}>, stereo: object, audit: object}} Full stage audit payload.
 */
function auditFinalStereoStage(molecule, layoutGraph, coords, placement, bondLength) {
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

/**
 * Returns whether one final stereo/touchup candidate should replace another.
 * @param {{coords: Map<string, {x: number, y: number}>, stereo: object, audit: object}} candidate - Candidate stage.
 * @param {{coords: Map<string, {x: number, y: number}>, stereo: object, audit: object}|null} incumbent - Current best stage.
 * @param {{allowPresentationTieBreak?: boolean}} [options] - Optional comparison toggles.
 * @returns {boolean} True when the candidate is safer overall.
 */
function isPreferredFinalStereoStage(candidate, incumbent, options = {}) {
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
 * Merges the base frozen-atom set with an optional extra set used for a
 * narrower cleanup probe. Returns null when no freezing is needed.
 * @param {Set<string>|null|undefined} baseFrozenAtomIds - Existing frozen atoms.
 * @param {Set<string>|null|undefined} extraFrozenAtomIds - Additional frozen atoms.
 * @returns {Set<string>|null} Merged frozen atom ids, or null when empty.
 */
function mergeFrozenAtomIds(baseFrozenAtomIds, extraFrozenAtomIds) {
  const merged = new Set(baseFrozenAtomIds ?? []);
  for (const atomId of extraFrozenAtomIds ?? []) {
    merged.add(atomId);
  }
  return merged.size > 0 ? merged : null;
}

/**
 * Returns whether one cleanup-stage candidate should replace the current
 * protected-family incumbent. Bond integrity and macrocycle stability outrank
 * overlap reduction in this comparison.
 * @param {{primaryFamily: string, mixedMode: boolean}} familySummary - Family classification.
 * @param {object} placement - Placement result.
 * @param {{coords: Map<string, {x: number, y: number}>, audit: object}} candidate - Candidate stage.
 * @param {{coords: Map<string, {x: number, y: number}>, audit: object}|null} incumbent - Current best stage.
 * @returns {boolean} True when the candidate is safer and should be selected.
 */
function isPreferredProtectedCleanupStage(familySummary, placement, candidate, incumbent) {
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
 * Returns whether one generic cleanup-stage candidate should replace another.
 * This keeps the safest geometry-oriented stage instead of blindly trusting the
 * latest cleanup pass when later hooks or one-pass touchups make the result
 * worse.
 * @param {{coords: Map<string, {x: number, y: number}>, audit: object}} candidate - Candidate stage.
 * @param {{coords: Map<string, {x: number, y: number}>, audit: object}|null} incumbent - Current best stage.
 * @returns {boolean} True when the candidate is safer overall.
 */
function isPreferredCleanupGeometryStage(candidate, incumbent) {
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

/**
 * Runs the cleanup-oriented pipeline stages after initial component placement.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} placement - Placement result.
 * @param {{primaryFamily: string, mixedMode: boolean}} familySummary - Family classification.
 * @param {object} policy - Resolved policy bundle.
 * @param {object} normalizedOptions - Normalized pipeline options.
 * @param {{enabled: boolean, startTime: number, placementMs: number, cleanupMs: number, labelClearanceMs: number, stereoMs: number, auditMs: number}|null} [timingState] - Optional timing accumulator.
 * @returns {{coords: Map<string, {x: number, y: number}>, passes: number, improvement: number, overlapMoves: number, labelNudges: number, symmetrySnaps: number, junctionSnaps: number, stereoReflections: number, postHookNudges: number, placementAudit?: object|null, stageTelemetry?: object|null}} Cleanup summary.
 */
function runCleanupPhase(layoutGraph, placement, familySummary, policy, normalizedOptions, timingState = null) {
  const includeStageTelemetry = normalizedOptions.auditTelemetry === true;
  if (placement.placedComponentCount === 0) {
    return {
      coords: placement.coords,
      passes: 0,
      improvement: 0,
      overlapMoves: 0,
      labelNudges: 0,
      symmetrySnaps: 0,
      junctionSnaps: 0,
      stereoReflections: 0,
      postHookNudges: 0,
      ...(includeStageTelemetry
        ? {
            placementAudit: null,
            stageTelemetry: buildStageTelemetry([], null, null)
          }
        : {})
    };
  }

  const cleanupStart = timingState ? nowMs() : 0;
  const protectBondIntegrity = shouldProtectCleanupBondIntegrity(familySummary, placement);
  const shouldAuditStages = true;
  const cleanupMaxPasses =
    placement.placedFamilies.every(family => family === 'large-molecule')
      ? Math.min(normalizedOptions.maxCleanupPasses, 3)
      : normalizedOptions.maxCleanupPasses;
  const cleanupPass = runUnifiedCleanup(layoutGraph, placement.coords, {
    maxPasses: cleanupMaxPasses,
    epsilon: normalizedOptions.bondLength * 0.001,
    bondLength: normalizedOptions.bondLength,
    protectLargeMoleculeBackbone: placement.placedFamilies.includes('large-molecule'),
    protectBondIntegrity,
    cleanupRigidSubtreesByAtomId: placement.cleanupRigidSubtreesByAtomId,
    frozenAtomIds: placement.frozenAtomIds
  });
  const labelClearanceStart = timingState ? nowMs() : 0;
  const labelClearance = applyLabelClearance(layoutGraph, cleanupPass.coords, {
    bondLength: normalizedOptions.bondLength,
    labelMetrics: normalizedOptions.labelMetrics
  });
  if (timingState) {
    timingState.labelClearanceMs = nowMs() - labelClearanceStart;
  }
  const symmetryTidy = tidySymmetry(labelClearance.coords, {
    epsilon: normalizedOptions.bondLength * 0.01,
    layoutGraph
  });
  const stereoCleanup = enforceAcyclicEZStereo(layoutGraph, symmetryTidy.coords, {
    bondLength: normalizedOptions.bondLength
  });
  const postCleanup = runPostCleanupHooks(layoutGraph, stereoCleanup.coords, policy, {
    bondLength: normalizedOptions.bondLength,
    frozenAtomIds: placement.frozenAtomIds
  });
  const postHookCleanup =
    postCleanup.hookNudges > 0
      ? runUnifiedCleanup(layoutGraph, postCleanup.coords, {
          maxPasses: 1,
          epsilon: normalizedOptions.bondLength * 0.001,
          bondLength: normalizedOptions.bondLength,
          protectLargeMoleculeBackbone: placement.placedFamilies.includes('large-molecule'),
          protectBondIntegrity,
          cleanupRigidSubtreesByAtomId: placement.cleanupRigidSubtreesByAtomId,
          frozenAtomIds: placement.frozenAtomIds
        })
        : {
          coords: postCleanup.coords,
          passes: 0,
          improvement: 0,
          overlapMoves: 0
        };

  const stageEntries = [];
  const placementStage = {
    name: 'placement',
    coords: placement.coords,
    audit: shouldAuditStages ? auditCleanupStage(layoutGraph, placement.coords, placement, normalizedOptions.bondLength) : null
  };
  const cleanupStage = {
    name: 'cleanup',
    coords: cleanupPass.coords,
    audit: shouldAuditStages ? auditCleanupStage(layoutGraph, cleanupPass.coords, placement, normalizedOptions.bondLength) : null
  };
  const postHookCleanupStage = {
    name: 'postHookCleanup',
    coords: postHookCleanup.coords,
    audit: shouldAuditStages ? auditCleanupStage(layoutGraph, postHookCleanup.coords, placement, normalizedOptions.bondLength) : null
  };
  const postCleanupStage = {
    name: 'postCleanup',
    coords: postCleanup.coords,
    audit: shouldAuditStages ? auditCleanupStage(layoutGraph, postCleanup.coords, placement, normalizedOptions.bondLength) : null
  };
  if (placementStage.audit) {
    stageEntries.push({ name: placementStage.name, audit: placementStage.audit });
  }
  if (cleanupStage.audit) {
    stageEntries.push({ name: cleanupStage.name, audit: cleanupStage.audit });
  }
  if (postCleanupStage.audit) {
    stageEntries.push({ name: postCleanupStage.name, audit: postCleanupStage.audit });
  }
  if (postHookCleanupStage.audit) {
    stageEntries.push({ name: postHookCleanupStage.name, audit: postHookCleanupStage.audit });
  }

  let coords = postHookCleanup.coords;
  let selectedGeometryStage = postHookCleanupStage.name;
  let preferredStage = placementStage;
  const stageComparator = protectBondIntegrity
    ? (candidate, incumbent) => isPreferredProtectedCleanupStage(familySummary, placement, candidate, incumbent)
    : isPreferredCleanupGeometryStage;
  for (const candidateStage of [cleanupStage, postCleanupStage, postHookCleanupStage]) {
    if (stageComparator(candidateStage, preferredStage)) {
      preferredStage = candidateStage;
    }
  }
  coords = preferredStage.coords;
  selectedGeometryStage = preferredStage.name;
  const selectedGeometryStereoStage = {
    name: 'selectedGeometryStereo',
    ...auditFinalStereoStage(layoutGraph.sourceMolecule, layoutGraph, coords, placement, normalizedOptions.bondLength)
  };
  stageEntries.push({ name: selectedGeometryStereoStage.name, audit: selectedGeometryStereoStage.audit });
  const finalStereoCleanup = enforceAcyclicEZStereo(layoutGraph, coords, {
    bondLength: normalizedOptions.bondLength
  });
  const stereoCleanupStage = {
    name: 'stereoCleanup',
    ...auditFinalStereoStage(layoutGraph.sourceMolecule, layoutGraph, finalStereoCleanup.coords, placement, normalizedOptions.bondLength)
  };
  stageEntries.push({ name: stereoCleanupStage.name, audit: stereoCleanupStage.audit });
  let finalStereoStage = selectedGeometryStereoStage;
  if (isPreferredFinalStereoStage(stereoCleanupStage, finalStereoStage)) {
    finalStereoStage = stereoCleanupStage;
  }
  const totalStereoRescueCount = stereoCleanup.reflections + finalStereoCleanup.reflections;
  const stereoProtectedTouchupFrozenAtomIds = mergeFrozenAtomIds(
    placement.frozenAtomIds,
    collectProtectedEZAtomIds(layoutGraph)
  );
  let stereoProtectedTouchupCleanup = {
    coords: finalStereoCleanup.coords,
    passes: 0,
    improvement: 0,
    overlapMoves: 0
  };
  let stereoTouchupCleanup = {
    coords: finalStereoCleanup.coords,
    passes: 0,
    improvement: 0,
    overlapMoves: 0
  };
  let postTouchupStereoCleanup = {
    coords: finalStereoCleanup.coords,
    reflections: 0
  };
  if (
    totalStereoRescueCount > 0
    && finalStereoStage.audit.stereoContradiction === false
    && finalStereoStage.audit.bondLengthFailureCount === 0
    && finalStereoStage.audit.severeOverlapCount > 0
  ) {
    if (stereoProtectedTouchupFrozenAtomIds) {
      stereoProtectedTouchupCleanup = runUnifiedCleanup(layoutGraph, finalStereoCleanup.coords, {
        maxPasses: 1,
        epsilon: normalizedOptions.bondLength * 0.001,
        bondLength: normalizedOptions.bondLength,
        protectLargeMoleculeBackbone: placement.placedFamilies.includes('large-molecule'),
        protectBondIntegrity: true,
        cleanupRigidSubtreesByAtomId: placement.cleanupRigidSubtreesByAtomId,
        frozenAtomIds: stereoProtectedTouchupFrozenAtomIds
      });
      const protectedTouchupStage = {
        name: 'stereoProtectedTouchup',
        ...auditFinalStereoStage(
          layoutGraph.sourceMolecule,
          layoutGraph,
          stereoProtectedTouchupCleanup.coords,
          placement,
          normalizedOptions.bondLength
        )
      };
      stageEntries.push({ name: protectedTouchupStage.name, audit: protectedTouchupStage.audit });
      if (isPreferredFinalStereoStage(protectedTouchupStage, finalStereoStage)) {
        finalStereoStage = protectedTouchupStage;
      }
    }
    stereoTouchupCleanup = runUnifiedCleanup(layoutGraph, finalStereoCleanup.coords, {
      maxPasses: 1,
      epsilon: normalizedOptions.bondLength * 0.001,
      bondLength: normalizedOptions.bondLength,
      protectLargeMoleculeBackbone: placement.placedFamilies.includes('large-molecule'),
      protectBondIntegrity: true,
      cleanupRigidSubtreesByAtomId: placement.cleanupRigidSubtreesByAtomId,
      frozenAtomIds: placement.frozenAtomIds
    });
    const touchupStage = {
      name: 'stereoTouchup',
      ...auditFinalStereoStage(
        layoutGraph.sourceMolecule,
        layoutGraph,
        stereoTouchupCleanup.coords,
        placement,
        normalizedOptions.bondLength
      )
    };
    stageEntries.push({ name: touchupStage.name, audit: touchupStage.audit });
    if (isPreferredFinalStereoStage(touchupStage, finalStereoStage)) {
      finalStereoStage = touchupStage;
    }
    postTouchupStereoCleanup = enforceAcyclicEZStereo(layoutGraph, stereoTouchupCleanup.coords, {
      bondLength: normalizedOptions.bondLength
    });
    const postTouchupStereoStage = {
      name: 'postTouchupStereo',
      ...auditFinalStereoStage(
        layoutGraph.sourceMolecule,
        layoutGraph,
        postTouchupStereoCleanup.coords,
        placement,
        normalizedOptions.bondLength
      )
    };
    stageEntries.push({ name: postTouchupStereoStage.name, audit: postTouchupStereoStage.audit });
    if (isPreferredFinalStereoStage(postTouchupStereoStage, finalStereoStage)) {
      finalStereoStage = postTouchupStereoStage;
    }
  }
  let acceptedFinalHypervalentTouchup = {
    coords: finalStereoStage.coords,
    nudges: 0
  };
  if (policy.postCleanupHooks?.includes('hypervalent-angle-tidy')) {
    const finalHypervalentTouchup = runHypervalentAngleTidy(layoutGraph, finalStereoStage.coords);
    if (finalHypervalentTouchup.nudges > 0) {
      const finalHypervalentStage = {
        name: 'finalHypervalentTouchup',
        ...auditFinalStereoStage(
          layoutGraph.sourceMolecule,
          layoutGraph,
          finalHypervalentTouchup.coords,
          placement,
          normalizedOptions.bondLength
        )
      };
      stageEntries.push({ name: finalHypervalentStage.name, audit: finalHypervalentStage.audit });
      if (isPreferredFinalStereoStage(finalHypervalentStage, finalStereoStage)) {
        finalStereoStage = finalHypervalentStage;
        acceptedFinalHypervalentTouchup = finalHypervalentTouchup;
      }
    }
  }
  let acceptedFinalRingSubstituentTouchup = {
    coords: finalStereoStage.coords,
    nudges: 0
  };
  if (policy.postCleanupHooks?.includes('ring-substituent-tidy')) {
    const finalRingSubstituentTouchup = runRingSubstituentTidy(layoutGraph, finalStereoStage.coords, {
      bondLength: normalizedOptions.bondLength,
      frozenAtomIds: placement.frozenAtomIds
    });
    if (finalRingSubstituentTouchup.nudges > 0) {
      const finalRingSubstituentStage = {
        name: 'finalRingSubstituentTouchup',
        ...auditFinalStereoStage(
          layoutGraph.sourceMolecule,
          layoutGraph,
          finalRingSubstituentTouchup.coords,
          placement,
          normalizedOptions.bondLength
        )
      };
      stageEntries.push({ name: finalRingSubstituentStage.name, audit: finalRingSubstituentStage.audit });
      if (isPreferredFinalStereoStage(finalRingSubstituentStage, finalStereoStage, { allowPresentationTieBreak: true })) {
        finalStereoStage = finalRingSubstituentStage;
        acceptedFinalRingSubstituentTouchup = finalRingSubstituentTouchup;
      }
    }
  }
  coords = finalStereoStage.coords;
  if (timingState) {
    timingState.cleanupMs = nowMs() - cleanupStart;
  }

  return {
    coords,
    passes: cleanupPass.passes + postHookCleanup.passes + stereoProtectedTouchupCleanup.passes + stereoTouchupCleanup.passes,
    improvement: cleanupPass.improvement + postHookCleanup.improvement + stereoProtectedTouchupCleanup.improvement + stereoTouchupCleanup.improvement,
    overlapMoves: cleanupPass.overlapMoves + postHookCleanup.overlapMoves + stereoProtectedTouchupCleanup.overlapMoves + stereoTouchupCleanup.overlapMoves,
    labelNudges: labelClearance.nudges,
    symmetrySnaps: symmetryTidy.snappedCount,
    junctionSnaps: symmetryTidy.junctionSnapCount,
    stereoReflections: stereoCleanup.reflections + finalStereoCleanup.reflections + postTouchupStereoCleanup.reflections,
    postHookNudges:
      postCleanup.hookNudges
      + (acceptedFinalHypervalentTouchup.nudges ?? 0)
      + (acceptedFinalRingSubstituentTouchup.nudges ?? 0),
    ...(includeStageTelemetry
      ? {
          placementAudit: placementStage.audit,
          stageTelemetry: buildStageTelemetry(stageEntries, selectedGeometryStage, finalStereoStage.name)
        }
      : {})
  };
}

/**
 * Builds stereo metadata after cleanup-adjusted coordinates are finalized.
 * @param {object} molecule - Molecule-like graph.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Finalized coordinates.
 * @param {{enabled: boolean, startTime: number, placementMs: number, cleanupMs: number, labelClearanceMs: number, stereoMs: number, auditMs: number}|null} [timingState] - Optional timing accumulator.
 * @returns {{ringDependency: object, stereo: object}} Stereo and ring-dependency metadata.
 */
function runStereoPhase(molecule, layoutGraph, coords, timingState = null) {
  const stereoStart = timingState ? nowMs() : 0;
  const ez = inspectEZStereo(layoutGraph, coords);
  const wedges = pickWedgeAssignments(layoutGraph, coords);
  const ringDependency =
    layoutGraph.rings.length > 0
      ? inspectRingDependency(molecule)
      : {
          ok: true,
          requiresDedicatedRingEngine: false,
          suspiciousSystemCount: 0,
          systems: [],
          rings: [],
          connections: []
        };
  const stereo = {
    ezCheckedBondCount: ez.checkedBondCount,
    ezSupportedBondCount: ez.supportedCheckCount,
    ezUnsupportedBondCount: ez.unsupportedCheckCount,
    ezResolvedBondCount: ez.resolvedBondCount,
    ezViolationCount: ez.violationCount,
    ezChecks: ez.checks,
    annotatedCenterCount: wedges.annotatedCenterCount,
    chiralCenterCount: wedges.chiralCenterCount,
    assignedCenterCount: wedges.assignedCenterCount,
    unassignedCenterCount: wedges.unassignedCenterCount,
    assignments: wedges.assignments,
    missingCenterIds: wedges.missingCenterIds,
    unsupportedCenterCount: wedges.unsupportedCenterCount,
    unsupportedCenterIds: wedges.unsupportedCenterIds
  };
  if (timingState) {
    timingState.stereoMs = nowMs() - stereoStart;
  }

  return { ringDependency, stereo };
}

/**
 * Builds the final pipeline return object and metadata envelope.
 * @param {object} molecule - Molecule-like graph.
 * @param {Map<string, {x: number, y: number}>} coords - Finalized coordinates.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} normalizedOptions - Normalized pipeline options.
 * @param {string} profile - Resolved profile name.
 * @param {{primaryFamily: string, mixedMode: boolean}} familySummary - Family classification.
 * @param {object} policy - Resolved policy bundle.
 * @param {object} placement - Placement result.
 * @param {object} cleanup - Cleanup summary.
 * @param {object} ringDependency - Ring dependency metadata.
 * @param {object} stereo - Stereo metadata.
 * @param {{enabled: boolean, startTime: number, placementMs: number, cleanupMs: number, labelClearanceMs: number, stereoMs: number, auditMs: number}|null} [timingState] - Optional timing accumulator.
 * @returns {object} Final pipeline result.
 */
function buildPipelineResult(molecule, coords, layoutGraph, normalizedOptions, profile, familySummary, policy, placement, cleanup, ringDependency, stereo, timingState = null) {
  const auditStart = timingState ? nowMs() : 0;
  const audit = auditLayout(layoutGraph, coords, {
    bondLength: normalizedOptions.bondLength,
    bondValidationClasses: placement.bondValidationClasses,
    stereo
  });
  if (timingState) {
    timingState.auditMs = nowMs() - auditStart;
  }
  const qualityReport = createQualityReport({
    audit,
    cleanup,
    stereo,
    ringDependency,
    policy
  });
  const stage = placement.placedComponentCount === 0 ? 'topology-ready' : placement.unplacedComponentCount === 0 ? 'coordinates-ready' : 'partial-coordinates';
  const placementTelemetry = normalizedOptions.auditTelemetry ? buildPlacementTelemetry(placement) : null;

  return {
    molecule,
    coords,
    layoutGraph,
    metadata: {
      stage,
      profile,
      primaryFamily: familySummary.primaryFamily,
      mixedMode: familySummary.mixedMode,
      componentCount: layoutGraph.components.length,
      ringCount: layoutGraph.rings.length,
      ringSystemCount: layoutGraph.ringSystems.length,
      fixedAtomCount: normalizedOptions.fixedCoords.size,
      existingCoordCount: normalizedOptions.existingCoords.size,
      placedComponentCount: placement.placedComponentCount,
      unplacedComponentCount: placement.unplacedComponentCount,
      preservedComponentCount: placement.preservedComponentCount,
      placedFamilies: placement.placedFamilies,
      bondValidationClassCount: placement.bondValidationClasses.size,
      displayAssignmentCount: placement.displayAssignments.length,
      displayAssignments: placement.displayAssignments,
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
      ...(placementTelemetry
        ? {
            placementFamily: placementTelemetry.placementFamily,
            placementMode: placementTelemetry.placementMode,
            placementModes: placementTelemetry.placementModes,
            componentPlacements: placementTelemetry.componentPlacements,
            placementAudit: cleanup.placementAudit ?? null,
            stageTelemetry: cleanup.stageTelemetry ?? buildStageTelemetry([], null, null)
          }
        : {}),
      qualityReport,
      ...(timingState
        ? {
            timing: {
              totalMs: nowMs() - timingState.startTime,
              placementMs: timingState.placementMs,
              cleanupMs: timingState.cleanupMs,
              labelClearanceMs: timingState.labelClearanceMs,
              stereoMs: timingState.stereoMs,
              auditMs: timingState.auditMs
            }
          }
        : {})
    }
  };
}

/**
 * Classifies the current layout graph into a primary family and mixed-mode flag.
 * @param {object} layoutGraph - Layout graph shell.
 * @returns {{primaryFamily: string, mixedMode: boolean}} Family summary.
 */
export function classifyFamily(layoutGraph) {
  const threshold = layoutGraph.options.largeMoleculeThreshold;
  const ringAtomIds =
    layoutGraph.ringAtomIds
    ?? new Set((layoutGraph.rings ?? []).flatMap(ring => ring.atomIds));
  const hasNonRingHeavyAtoms = [...layoutGraph.atoms.values()].some(atom => atom.element !== 'H' && !ringAtomIds.has(atom.id));
  const exceedsLargeThreshold =
    exceedsLargeMoleculeThreshold(layoutGraph.traits, threshold, layoutGraph.components.length)
    || layoutGraph.components.some(component => exceedsLargeComponentThreshold(layoutGraph, component));
  const hasMacrocycle = findMacrocycleRings(layoutGraph.rings).length > 0;

  let primaryFamily = 'acyclic';
  if (layoutGraph.traits.containsMetal) {
    primaryFamily = 'organometallic';
  } else if (hasMacrocycle) {
    primaryFamily = 'macrocycle';
  } else if (exceedsLargeThreshold) {
    primaryFamily = 'large-molecule';
  } else if (layoutGraph.rings.length > 0) {
    const principalComponent = layoutGraph.components[0] ?? null;
    if (principalComponent) {
      primaryFamily = buildScaffoldPlan(layoutGraph, principalComponent).rootScaffold.family;
    } else if (layoutGraph.ringConnections.some(connection => connection.kind === 'bridged')) {
      primaryFamily = 'bridged';
    } else if (layoutGraph.ringConnections.some(connection => connection.kind === 'spiro')) {
      primaryFamily = 'spiro';
    } else if (layoutGraph.ringSystems.some(system => system.ringIds.length > 1)) {
      primaryFamily = 'fused';
    } else {
      primaryFamily = 'isolated-ring';
    }
  }

  return {
    primaryFamily,
    mixedMode: primaryFamily !== 'acyclic' && (hasNonRingHeavyAtoms || layoutGraph.ringSystems.length > 1)
  };
}

/**
 * Runs the current layout shell: options, topology analysis, standards
 * policy, and deterministic coordinate placement for the currently supported
 * core families (acyclic, isolated-ring, fused, and spiro).
 * @param {object} molecule - Molecule-like graph.
 * @param {object} [options] - Layout options.
 * @returns {object} Pipeline result.
 */
export function runPipeline(molecule, options = {}) {
  const normalizedOptions = normalizeOptions(options);
  const timingState = createTimingState(normalizedOptions.timing);
  const profile = resolveProfile(normalizedOptions.profile);
  if (isEmptyLayoutInput(molecule)) {
    const atomCount = moleculeAtomCount(molecule);
    return createEmptyPipelineResult(molecule, normalizedOptions, profile, atomCount === 0 ? 'empty-molecule' : 'invalid-molecule');
  }
  const workingMolecule = typeof molecule?.clone === 'function' ? molecule.clone() : molecule;
  const layoutGraph = createLayoutGraphFromNormalized(workingMolecule, normalizedOptions);
  const familySummary = classifyFamily(layoutGraph);
  const policy = resolvePolicy(profile, {
    ...layoutGraph.traits,
    ...familySummary
  });
  const coords = buildInitialCoordsMap(normalizedOptions);
  const placementStart = timingState ? nowMs() : 0;
  const placement = layoutSupportedComponents(layoutGraph, policy);
  if (timingState) {
    timingState.placementMs = nowMs() - placementStart;
  }
  const cleanup = runCleanupPhase(layoutGraph, placement, familySummary, policy, normalizedOptions, timingState);
  for (const [atomId, position] of cleanup.coords) {
    coords.set(atomId, position);
  }
  const { ringDependency, stereo } = runStereoPhase(workingMolecule, layoutGraph, coords, timingState);
  return buildPipelineResult(molecule, coords, layoutGraph, normalizedOptions, profile, familySummary, policy, placement, cleanup, ringDependency, stereo, timingState);
}
