/** @module pipeline */

import { normalizeOptions } from './options.js';
import { resolveProfile } from './profile.js';
import { createLayoutGraphFromNormalized } from './model/layout-graph.js';
import { resolvePolicy } from './standards/profile-policy.js';
import { createEmptyPipelineResult } from './model/empty-result.js';
import { layoutSupportedComponents } from './placement/component-layout.js';
import { buildCleanupStageGraph } from './cleanup/stage-pipeline.js';
import { runStageGraph } from './cleanup/stage-runner.js';
import {
  buildCleanupTelemetry,
  buildStageTelemetryFromCleanupTelemetry,
  createEmptyCleanupTelemetry,
  createEmptyStageTelemetry
} from './cleanup/telemetry.js';
import { auditLayout } from './audit/audit.js';
import { auditCleanupStage } from './audit/stage-metrics.js';
import { createQualityReport } from './model/quality-report.js';
import { inspectEZStereo } from './stereo/ez.js';
import { pickWedgeAssignments } from './stereo/wedge-selection.js';
import { inspectRingDependency } from './topology/ring-dependency.js';
import { exceedsLargeComponentThreshold, exceedsLargeMoleculeThreshold } from './topology/large-blocks.js';
import { findMacrocycleRings } from './topology/macrocycles.js';
import { buildScaffoldPlan } from './model/scaffold-plan.js';
import { packComponentPlacements } from './placement/fragment-packing.js';
import { ensureLandscapeOrientation, levelCoords, normalizeOrientation } from './orientation.js';
import { cloneCoords } from './geometry/transforms.js';

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

function selectPrimaryPlacement(componentPlacements = []) {
  return (
    componentPlacements.find(detail => detail.role === 'principal' && detail.placed && !detail.preserved) ??
    componentPlacements.find(detail => detail.placed && !detail.preserved) ??
    componentPlacements.find(detail => detail.placed) ??
    componentPlacements[0] ??
    null
  );
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

function createEmptyStereoSummary() {
  return {
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
}

function getRingDependencySummary(molecule, layoutGraph) {
  return layoutGraph.rings.length > 0
    ? (layoutGraph._ringDependency ??= inspectRingDependency(molecule))
    : {
        ok: true,
        requiresDedicatedRingEngine: false,
        suspiciousSystemCount: 0,
        systems: [],
        rings: [],
        connections: []
      };
}

function hasStereoTargets(molecule) {
  if (!molecule || typeof molecule !== 'object') {
    return false;
  }
  if (typeof molecule.getChiralCenters === 'function' && molecule.getChiralCenters().length > 0) {
    return true;
  }
  if (!(molecule.bonds instanceof Map) || typeof molecule.getEZStereo !== 'function') {
    return false;
  }
  for (const bond of molecule.bonds.values()) {
    if ((bond?.properties?.order ?? 1) !== 2) {
      continue;
    }
    if (molecule.getEZStereo(bond.id) != null) {
      return true;
    }
  }
  return false;
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

function repackFinalDisconnectedComponents(layoutGraph, coords, placement, policy, bondLength) {
  if ((layoutGraph.components?.length ?? 0) <= 1) {
    return coords;
  }

  const placementDetailsById = new Map((placement.componentPlacements ?? []).map(detail => [detail.componentId, detail]));
  const componentPlacements = [];
  for (const component of layoutGraph.components ?? []) {
    const atomIds = component.atomIds.filter(atomId => coords.has(atomId));
    if (atomIds.length === 0) {
      continue;
    }
    const detail = placementDetailsById.get(component.id) ?? null;
    componentPlacements.push({
      componentId: component.id,
      atomIds,
      coords: new Map(atomIds.map(atomId => [atomId, { ...coords.get(atomId) }])),
      anchored: detail?.anchored === true,
      role: component.role,
      heavyAtomCount: component.heavyAtomCount ?? detail?.heavyAtomCount ?? 0,
      netCharge: component.netCharge ?? 0,
      containsMetal: detail?.containsMetal === true
    });
  }

  if (componentPlacements.length <= 1) {
    return coords;
  }

  return packComponentPlacements(componentPlacements, bondLength, {
    ...policy,
    fragmentPackingMode: 'principal-right'
  });
}

function isRingJunctionStereoAssignment(layoutGraph, assignment) {
  const molecule = layoutGraph?.sourceMolecule ?? null;
  const bond = layoutGraph?.bonds.get(assignment?.bondId) ?? null;
  const centerId = assignment?.centerId ?? null;
  if (!molecule || !bond || !centerId) {
    return false;
  }

  const otherAtomId = bond.a === centerId ? bond.b : bond.b === centerId ? bond.a : null;
  if (!otherAtomId || layoutGraph.atoms.get(otherAtomId)?.element === 'H') {
    return false;
  }

  const centerAtom = molecule.atoms.get(centerId);
  if (!centerAtom) {
    return false;
  }

  const ringNeighborCount = centerAtom
    .getNeighbors(molecule)
    .filter(neighborAtom => neighborAtom && neighborAtom.name !== 'H' && (layoutGraph.atomToRings.get(neighborAtom.id)?.length ?? 0) > 0).length;
  return ringNeighborCount >= 3;
}

/**
 * Returns whether the pipeline should auto-orient the final generated pose.
 * Existing or fixed coordinates preserve the user's frame, so only fresh
 * stereochemical ring-junction layouts get the whole-molecule orientation
 * pass. This avoids rotating ordinary side-chain stereocenters away from the
 * canonical heterocycle and zigzag orientations they already had before the
 * ring-junction display pass was added.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {object} normalizedOptions - Normalized pipeline options.
 * @returns {{shouldOrient: boolean, wedges: object|null}} Orientation result.
 */
function shouldAutoOrientFinalCoords(layoutGraph, coords, normalizedOptions) {
  if (normalizedOptions.fixedCoords.size > 0 || normalizedOptions.existingCoords.size > 0) {
    return { shouldOrient: false, wedges: null };
  }
  const molecule = layoutGraph?.sourceMolecule ?? null;
  if (!(typeof molecule?.getChiralCenters === 'function' && molecule.getChiralCenters().length > 0)) {
    return { shouldOrient: false, wedges: null };
  }
  const wedges = pickWedgeAssignments(layoutGraph, coords);
  return {
    shouldOrient: wedges.assignments.some(assignment => isRingJunctionStereoAssignment(layoutGraph, assignment)),
    wedges
  };
}

function shouldEnsureLandscapeFinalCoords(normalizedOptions, policy) {
  if (!normalizedOptions.finalLandscapeOrientation) {
    return false;
  }
  if (normalizedOptions.fixedCoords.size > 0 || normalizedOptions.existingCoords.size > 0) {
    return false;
  }
  return policy?.orientationBias === 'horizontal';
}

/**
 * Applies the final display-orientation pass to generated coordinates.
 * This is a whole-molecule rotation only, so it preserves local geometry while
 * improving page orientation for visible stereobonds.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Coordinate map.
 * @param {object} molecule - Molecule-like graph.
 * @returns {Map<string, {x: number, y: number}>} Oriented coordinate map.
 */
function orientFinalCoords(inputCoords, molecule) {
  const coords = cloneCoords(inputCoords);
  normalizeOrientation(coords, molecule);
  levelCoords(coords, molecule);
  return coords;
}

function snapTinyCoordinateNoise(coords, epsilon = 1e-12) {
  for (const [atomId, position] of coords) {
    coords.set(atomId, {
      x: Math.abs(position.x) <= epsilon ? 0 : position.x,
      y: Math.abs(position.y) <= epsilon ? 0 : position.y
    });
  }
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
 * Runs the cleanup-oriented pipeline stages after initial component placement.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} placement - Placement result.
 * @param {{primaryFamily: string, mixedMode: boolean}} familySummary - Family classification.
 * @param {object} policy - Resolved policy bundle.
 * @param {object} normalizedOptions - Normalized pipeline options.
 * @param {{enabled: boolean, startTime: number, placementMs: number, cleanupMs: number, labelClearanceMs: number, stereoMs: number, auditMs: number}|null} [timingState] - Optional timing accumulator.
 * @param {((label: string, description: string, coords: Map<string, {x: number, y: number}>, metrics?: object) => void)|null} [onStep] - Optional debug callback for intermediate cleanup stages.
 * @param {((stageName: string, accepted: boolean, stageAudit: object|null, incumbentAudit: object|null) => void)|null} [onStageAcceptance] - Optional callback fired after each scored cleanup stage acceptance decision.
 * @returns {{coords: Map<string, {x: number, y: number}>, passes: number, improvement: number, overlapMoves: number, labelNudges: number, symmetrySnaps: number, junctionSnaps: number, stereoReflections: number, postHookNudges: number, placementAudit?: object|null, stageTelemetry?: object|null, cleanupTelemetry?: object|null}} Cleanup summary.
 */
function runCleanupPhase(layoutGraph, placement, familySummary, policy, normalizedOptions, timingState = null, onStep = null, onStageAcceptance = null) {
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
            stageTelemetry: createEmptyStageTelemetry(),
            cleanupTelemetry: createEmptyCleanupTelemetry()
          }
        : {})
    };
  }

  const cleanupStart = timingState ? nowMs() : 0;
  const protectBondIntegrity = shouldProtectCleanupBondIntegrity(familySummary, placement);
  const cleanupMaxPasses = normalizedOptions.maxCleanupPasses;
  const placementStage = {
    name: 'placement',
    coords: placement.coords,
    audit: auditCleanupStage(layoutGraph, placement.coords, placement, normalizedOptions.bondLength)
  };
  const cleanupContext = {
    layoutGraph,
    placement,
    familySummary,
    policy,
    normalizedOptions,
    cleanupMaxPasses,
    protectBondIntegrity,
    hasStereoTargets: layoutGraph._hasStereoTargets === true,
    emptyStereoSummary: layoutGraph._emptyStereoSummary,
    runStereoPhase,
    timingState,
    nowMs,
    onStep,
    onStageAcceptance,
    copyCoords: cloneCoords
  };
  const cleanupStagePlan = buildCleanupStageGraph(cleanupContext);
  const geometryRunnerState = runStageGraph(cleanupStagePlan.geometryStages, placementStage, cleanupContext);
  const selectedGeometryCheckpointStage = cleanupStagePlan.materializeSelectedGeometryCheckpoint(geometryRunnerState);
  const {
    bestStage,
    geometryCheckpointStage,
    allStageResults,
    accumulatedSidecars,
    accumulatedStabilizationRequest,
    stageExecutions,
    stageEntries
  } = runStageGraph(
    cleanupStagePlan.stereoStages,
    selectedGeometryCheckpointStage,
    cleanupContext,
    geometryRunnerState
  );
  const stereoRunnerState = {
    bestStage,
    geometryCheckpointStage,
    allStageResults,
    accumulatedSidecars,
    accumulatedStabilizationRequest,
    stageExecutions,
    stageEntries
  };
  cleanupStagePlan.runStereoRescueCleanup(stereoRunnerState);
  const finalRunnerState = runStageGraph(
    cleanupStagePlan.finalStages,
    selectedGeometryCheckpointStage,
    cleanupContext,
    stereoRunnerState
  );
  const stabilizationRunnerState = runStageGraph(
    cleanupStagePlan.stabilizationStages,
    selectedGeometryCheckpointStage,
    {
      ...cleanupContext,
      stabilizationRequest: finalRunnerState.accumulatedStabilizationRequest
    },
    finalRunnerState
  );
  const finalBestStage = stabilizationRunnerState.bestStage;
  const finalGeometryCheckpointStage = stabilizationRunnerState.geometryCheckpointStage;
  const finalAccumulatedSidecars = stabilizationRunnerState.accumulatedSidecars;
  const finalAccumulatedStabilizationRequest = stabilizationRunnerState.accumulatedStabilizationRequest;
  const finalStageExecutions = stabilizationRunnerState.stageExecutions;
  const finalStageResults = stabilizationRunnerState.allStageResults;
  const coreGeometryCleanupStage = finalStageResults.get('coreGeometryCleanup') ?? { passes: 0, improvement: 0, overlapMoves: 0 };
  const presentationCleanupStage = finalStageResults.get('presentationCleanup') ?? {
    labelNudges: 0,
    symmetrySnaps: 0,
    junctionSnaps: 0,
    reflections: 0,
    hookNudges: 0
  };
  const stabilizeAfterCleanupStage = finalStageResults.get('stabilizeAfterCleanup') ?? { passes: 0, improvement: 0, overlapMoves: 0 };
  const stereoProtectedTouchupStage = finalStageResults.get('stereoProtectedTouchup') ?? { passes: 0, improvement: 0, overlapMoves: 0 };
  const stereoTouchupStage = finalStageResults.get('stereoTouchup') ?? { passes: 0, improvement: 0, overlapMoves: 0 };
  const stereoRescueCleanupStage = finalStageResults.get('stereoRescueCleanup') ?? { reflections: 0 };
  const postTouchupStereoStage = finalStageResults.get('postTouchupStereo') ?? { reflections: 0 };
  if (timingState) {
    timingState.cleanupMs = nowMs() - cleanupStart;
  }
  const cleanupTelemetry = includeStageTelemetry
    ? buildCleanupTelemetry(
        finalStageExecutions,
        finalStageResults,
        finalGeometryCheckpointStage.name,
        finalBestStage.name,
        finalAccumulatedStabilizationRequest
      )
    : null;

  return {
    coords: finalBestStage.coords,
    passes: coreGeometryCleanupStage.passes + stabilizeAfterCleanupStage.passes + stereoProtectedTouchupStage.passes + stereoTouchupStage.passes,
    improvement: coreGeometryCleanupStage.improvement + stabilizeAfterCleanupStage.improvement + stereoProtectedTouchupStage.improvement + stereoTouchupStage.improvement,
    overlapMoves: coreGeometryCleanupStage.overlapMoves + stabilizeAfterCleanupStage.overlapMoves + stereoProtectedTouchupStage.overlapMoves + stereoTouchupStage.overlapMoves,
    labelNudges: presentationCleanupStage.labelNudges ?? 0,
    symmetrySnaps: presentationCleanupStage.symmetrySnaps ?? 0,
    junctionSnaps: presentationCleanupStage.junctionSnaps ?? 0,
    stereoReflections: (presentationCleanupStage.reflections ?? 0) + (stereoRescueCleanupStage.reflections ?? 0) + (postTouchupStereoStage.reflections ?? 0),
    postHookNudges: (presentationCleanupStage.hookNudges ?? 0) + Object.values(finalAccumulatedSidecars).reduce((total, count) => total + (count ?? 0), 0),
    finalStageStereo: finalBestStage.stereo ?? null,
    finalStageAudit: finalBestStage.audit ?? null,
    ...(includeStageTelemetry
      ? {
          placementAudit: placementStage.audit,
          stageTelemetry: buildStageTelemetryFromCleanupTelemetry(cleanupTelemetry),
          cleanupTelemetry
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
 * @param {object|null} [cachedWedges] - Optional precomputed wedge-selection result to reuse.
 * @returns {{ringDependency: object, stereo: object}} Stereo and ring-dependency metadata.
 */
function runStereoPhase(molecule, layoutGraph, coords, timingState = null, cachedWedges = null) {
  const stereoStart = timingState ? nowMs() : 0;
  const ringDependency = getRingDependencySummary(molecule, layoutGraph);
  if (layoutGraph._hasStereoTargets !== true) {
    if (timingState) {
      timingState.stereoMs = nowMs() - stereoStart;
    }
    return {
      ringDependency,
      stereo: layoutGraph._emptyStereoSummary
    };
  }
  const ez = inspectEZStereo(layoutGraph, coords);
  const wedges = cachedWedges ?? pickWedgeAssignments(layoutGraph, coords);
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
 * @param {object|null} [cachedAudit] - Optional already-computed final audit to reuse when the final coordinates match a cleanup-scored stage.
 * @returns {object} Final pipeline result.
 */
function buildPipelineResult(molecule, coords, layoutGraph, normalizedOptions, profile, familySummary, policy, placement, cleanup, ringDependency, stereo, timingState = null, cachedAudit = null) {
  const auditStart = timingState && cachedAudit == null ? nowMs() : 0;
  const audit = cachedAudit ?? auditLayout(layoutGraph, coords, {
    bondLength: normalizedOptions.bondLength,
    bondValidationClasses: placement.bondValidationClasses,
    stereo
  });
  if (timingState) {
    timingState.auditMs = cachedAudit == null ? nowMs() - auditStart : 0;
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
            stageTelemetry: cleanup.stageTelemetry ?? createEmptyStageTelemetry(),
            cleanupTelemetry: cleanup.cleanupTelemetry ?? createEmptyCleanupTelemetry()
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
  const ringAtomIds = layoutGraph.ringAtomIds ?? new Set((layoutGraph.rings ?? []).flatMap(ring => ring.atomIds));
  const hasNonRingHeavyAtoms = [...layoutGraph.atoms.values()].some(atom => atom.element !== 'H' && !ringAtomIds.has(atom.id));
  const exceedsLargeThreshold =
    exceedsLargeMoleculeThreshold(layoutGraph.traits, threshold, layoutGraph.components.length) ||
    layoutGraph.components.some(component => exceedsLargeComponentThreshold(layoutGraph, component));
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
  const onStep = typeof options.debug?.onStep === 'function' ? options.debug.onStep : null;
  const onStageAcceptance = typeof options.debug?.onStageAcceptance === 'function' ? options.debug.onStageAcceptance : null;
  const normalizedOptions = normalizeOptions(options);
  const timingState = createTimingState(normalizedOptions.timing);
  const profile = resolveProfile(normalizedOptions.profile);
  if (isEmptyLayoutInput(molecule)) {
    const atomCount = moleculeAtomCount(molecule);
    return createEmptyPipelineResult(molecule, normalizedOptions, profile, atomCount === 0 ? 'empty-molecule' : 'invalid-molecule');
  }
  const workingMolecule = typeof molecule?.clone === 'function' ? molecule.clone() : molecule;
  const layoutGraph = createLayoutGraphFromNormalized(workingMolecule, normalizedOptions);
  layoutGraph._hasStereoTargets = hasStereoTargets(workingMolecule);
  layoutGraph._emptyStereoSummary = createEmptyStereoSummary();
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
  onStep?.('Initial Placement', `Raw skeleton from the ${familySummary.primaryFamily} layout family, before any cleanup.`, cloneCoords(placement.coords), {
    primaryFamily: familySummary.primaryFamily,
    componentCount: layoutGraph.components.length,
    ringCount: layoutGraph.rings.length,
    ringSystemCount: layoutGraph.ringSystems.length
  });
  const cleanup = runCleanupPhase(layoutGraph, placement, familySummary, policy, normalizedOptions, timingState, onStep, onStageAcceptance);
  for (const [atomId, position] of cleanup.coords) {
    coords.set(atomId, position);
  }
  const repackedCoords = repackFinalDisconnectedComponents(layoutGraph, coords, placement, policy, normalizedOptions.bondLength);
  if (onStep && layoutGraph.components.length > 1) {
    onStep('Fragment Packing', 'Multiple disconnected fragments arranged into a unified 2D layout.', cloneCoords(repackedCoords), { componentCount: layoutGraph.components.length });
  }
  const { shouldOrient: orientationApplied, wedges: preOrientWedges } = shouldAutoOrientFinalCoords(layoutGraph, repackedCoords, normalizedOptions);
  let finalCoords = orientationApplied ? orientFinalCoords(repackedCoords, workingMolecule) : repackedCoords;
  let finalCoordsModified = orientationApplied;
  if (shouldEnsureLandscapeFinalCoords(normalizedOptions, policy)) {
    const landscapeCoords = cloneCoords(finalCoords);
    const landscapeApplied = ensureLandscapeOrientation(landscapeCoords, workingMolecule);
    if (landscapeApplied) {
      finalCoords = landscapeCoords;
      finalCoordsModified = true;
    }
    if (onStep && landscapeApplied && !orientationApplied) {
      onStep('Final Orientation', 'Whole-molecule landscape leveling to keep the final layout broad and exactly aligned to its preferred horizontal frame.', cloneCoords(finalCoords), {});
    }
  }
  if (onStep && orientationApplied) {
    onStep('Final Orientation', 'Whole-molecule rotation for optimal page orientation of ring-junction stereocenters.', cloneCoords(finalCoords), {});
  }
  if (finalCoordsModified) {
    finalCoords = repackFinalDisconnectedComponents(layoutGraph, finalCoords, placement, policy, normalizedOptions.bondLength);
  }
  snapTinyCoordinateNoise(finalCoords);
  onStep?.('Final Result', 'Complete 2D layout with all pipeline optimizations applied.', cloneCoords(finalCoords), { stage: 'complete' });
  const canReuseFinalStageStereo =
    layoutGraph.components.length <= 1
    && finalCoordsModified === false
    && cleanup.finalStageAudit != null
    && cleanup.finalStageStereo != null;
  const { ringDependency, stereo } = canReuseFinalStageStereo
    ? {
        ringDependency: getRingDependencySummary(workingMolecule, layoutGraph),
        stereo: cleanup.finalStageStereo
      }
    : runStereoPhase(workingMolecule, layoutGraph, finalCoords, timingState, finalCoordsModified ? null : preOrientWedges);
  return buildPipelineResult(
    molecule,
    finalCoords,
    layoutGraph,
    normalizedOptions,
    profile,
    familySummary,
    policy,
    placement,
    cleanup,
    ringDependency,
    stereo,
    timingState,
    canReuseFinalStageStereo ? cleanup.finalStageAudit : null
  );
}
