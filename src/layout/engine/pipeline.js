/** @module pipeline */

import { normalizeOptions } from './options.js';
import { resolveProfile } from './profile.js';
import { createLayoutGraphFromNormalized } from './model/layout-graph.js';
import { resolvePolicy } from './standards/profile-policy.js';
import { createEmptyPipelineResult } from './model/empty-result.js';
import { layoutSupportedComponents } from './placement/component-layout.js';
import { buildCleanupStageGraph } from './cleanup/stage-pipeline.js';
import { createStageExecutionEntry, runStageGraph } from './cleanup/stage-runner.js';
import { runUnifiedCleanup } from './cleanup/unified-cleanup.js';
import { applyLabelClearance } from './cleanup/label-clearance.js';
import { visibleHeavyCovalentBonds } from './cleanup/bond-utils.js';
import { collectCutSubtree } from './cleanup/subtree-utils.js';
import { resolveMixedAcylBranchSevereContacts, resolveRingSubstituentBoundedReadability, resolveRingSubstituentBranchCrossings } from './families/mixed.js';
import {
  measureRingAdjacentTerminalDivalentContinuationDistortion,
  runDivalentContinuationTidy,
  runLargeAcyclicEtherLinkerContinuationTidy,
  runLargePhosphateLinkerContinuationTidy
} from './cleanup/presentation/divalent-continuation.js';
import { runTerminalAcyclicChainRetouch } from './cleanup/presentation/terminal-chain-retouch.js';
import { runOrganometallicAromaticRingRetouch } from './cleanup/presentation/organometallic-aromatic-ring-retouch.js';
import { runRingChainLinearRetouch } from './cleanup/presentation/ring-chain-linear-retouch.js';
import { runRingChainHypervalentBranchRetouch } from './cleanup/presentation/ring-chain-hypervalent-retouch.js';
import { runRingChainSideBranchExitRetouch, runRingChainUnitProjectionRetouch } from './cleanup/presentation/ring-chain-unit-projection-retouch.js';
import { runLargeMoleculeResidualRetouch, runMacrocycleRingFanAngleRetouch } from './cleanup/presentation/large-molecule-residual-retouch.js';
import { runAttachedRingRotationTouchup } from './cleanup/presentation/attached-ring-fallback.js';
import {
  collectTerminalMultipleBondLeafFanRetouchCenters,
  hasRingTerminalHeteroTidyNeed,
  measureRingTerminalHeteroOutwardPenalty,
  measureTerminalMultipleBondLeafFanPenalty,
  runPairedTerminalHeteroLeafFanTidy,
  runTerminalMultipleBondLeafFanTidy
} from './cleanup/presentation/ring-terminal-hetero.js';
import { hasOutstandingRingPresentationNeed } from './cleanup/presentation/ring-presentation.js';
import {
  hasHypervalentAngleTidyNeed,
  measureOrthogonalHypervalentDeviation,
  measureRingAnchoredHypervalentBranchDeviation,
  runHypervalentConnectorSubtreeRotationTidy,
  runHypervalentAngleTidy
} from './cleanup/hypervalent-angle-tidy.js';
import { buildCleanupTelemetry, buildStageTelemetryFromCleanupTelemetry, createEmptyCleanupTelemetry, createEmptyStageTelemetry } from './cleanup/telemetry.js';
import { auditLayout } from './audit/audit.js';
import { findSevereOverlaps, findVisibleHeavyBondCrossings, measureThreeHeavyContinuationDistortion, measureTrigonalDistortion } from './audit/invariants.js';
import { collectLabelBoxes, findLabelOverlaps, labelBoxesOverlap } from './geometry/label-box.js';
import { auditCleanupStage, measureCleanupStagePresentationPenalty } from './audit/stage-metrics.js';
import { createQualityReport } from './model/quality-report.js';
import { inspectEZStereo } from './stereo/ez.js';
import { enforceAcyclicEZStereo } from './stereo/enforcement.js';
import { pickWedgeAssignments } from './stereo/wedge-selection.js';
import { inspectRingDependency } from './topology/ring-dependency.js';
import { describePathLikeIsolatedRingChain } from './topology/isolated-ring-chain.js';
import { exceedsLargeComponentThreshold, exceedsLargeMoleculeThreshold } from './topology/large-blocks.js';
import { findMacrocycleRings } from './topology/macrocycles.js';
import { buildScaffoldPlan } from './model/scaffold-plan.js';
import { packComponentPlacements } from './placement/fragment-packing.js';
import { ensureLandscapeOrientation, levelCoords, normalizeOrientation } from './orientation.js';
import { computeBounds } from './geometry/bounds.js';
import { cloneCoords, rotateAround } from './geometry/transforms.js';
import { add, angleOf, centroid, rotate, sub } from './geometry/vec2.js';
import { PRESENTATION_METRIC_EPSILON, atomPairKey } from './constants.js';

const FINAL_DIVALENT_CONTINUATION_RETOUCH_MIN_DEVIATION = 0.2;
const EXACT_TRIGONAL_CONTINUATION_ANGLE = (2 * Math.PI) / 3;
const MIN_PROJECTED_RING_CHAIN_ASPECT = 6;
const FINAL_TERMINAL_LEAF_CONTACT_ROTATIONS = Object.freeze(
  [...Array.from({ length: 12 }, (_value, index) => index + 1), ...Array.from({ length: 22 }, (_value, index) => 15 + index * 5)]
    .map(degrees => (degrees * Math.PI) / 180)
    .flatMap(offset => [offset, -offset])
);
const FINAL_TERMINAL_LEAF_CONTACT_DIRTY_LARGE_ROTATIONS = Object.freeze(
  [10, 20, 30, 45, 60, 90, 120]
    .map(degrees => (degrees * Math.PI) / 180)
    .flatMap(offset => [offset, -offset])
);
const FINAL_TERMINAL_LEAF_CONTACT_CLEARANCE_FACTOR = 0.6;
const FINAL_TERMINAL_LEAF_CONTACT_MAX_PASSES = 4;
const FINAL_TERMINAL_CONTACT_LEAF_ELEMENTS = new Set(['C', 'F', 'Cl', 'Br', 'I']);
const FINAL_SMALL_RING_SNAP_MAX_ANGLE_DEVIATION = (4 * Math.PI) / 180;
const FINAL_SMALL_RING_SNAP_MIN_ANGLE_IMPROVEMENT = (0.25 * Math.PI) / 180;
const FINAL_CONNECTOR_LABEL_ROTATIONS = Object.freeze(Array.from({ length: 12 }, (_value, index) => ((index + 1) * Math.PI) / 180).flatMap(rotation => [rotation, -rotation]));
const FINAL_CONNECTOR_LABEL_WIDE_ROTATIONS = Object.freeze(
  [15, -15, 20, -20, 25, -25, 30, -30, 45, -45, 60, -60, 75, -75, 90, -90, 120, -120, 150, -150, 180].map(degrees => (degrees * Math.PI) / 180)
);
const FINAL_TERMINAL_LABEL_LEAF_ROTATIONS = Object.freeze(
  [-180, -150, -120, -90, -75, -60, -45, -30, -20, -15, -10, -5, 5, 10, 15, 20, 30, 45, 60, 75, 90, 120, 150, 180].map(degrees => (degrees * Math.PI) / 180)
);
const FINAL_COMPRESSED_PAIRED_TERMINAL_HETERO_COMPRESSION_FACTORS = Object.freeze([1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5]);
const FINAL_CONNECTOR_LABEL_MAX_SUBTREE_ATOMS = 700;
const CLEANUP_STAGE_BUDGET_LIMITS = Object.freeze({
  baseMs: 550,
  minMs: 900,
  maxMs: 4500,
  perHeavyAtomMs: 18,
  perRingSystemMs: 90,
  mixedModeExtraMs: 350
});
const LARGE_DIRTY_FALLBACK_FAST_PATH_MIN_HEAVY_ATOMS = 500;
const LARGE_DIRTY_FALLBACK_FAST_PATH_MIN_RING_SYSTEMS = 20;
const LARGE_CLEAN_FINAL_RETOUCH_FAST_PATH_MIN_HEAVY_ATOMS = 500;
const LARGE_DIRTY_THREE_HEAVY_RETOUCH_SKIP_MIN_HEAVY_ATOMS = 280;
const CLEAN_LARGE_MACROCYCLE_RING_FAN_SKIP_MIN_HEAVY_ATOMS = 160;
const CLEAN_LARGE_MACROCYCLE_RING_FAN_SKIP_MIN_RINGS = 8;

/**
 * Returns the current high-resolution time when available, with a Date fallback
 * for runtimes that do not expose the Performance API.
 * @returns {number} Current time in milliseconds.
 */
function nowMs() {
  return typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : Date.now();
}

function cleanupStageBudgetLimitMs(layoutGraph, familySummary) {
  const heavyAtomCount = layoutGraph.traits?.heavyAtomCount ?? layoutGraph.atoms?.size ?? 0;
  const ringSystemCount = layoutGraph.ringSystems?.length ?? 0;
  const rawLimit =
    CLEANUP_STAGE_BUDGET_LIMITS.baseMs +
    heavyAtomCount * CLEANUP_STAGE_BUDGET_LIMITS.perHeavyAtomMs +
    ringSystemCount * CLEANUP_STAGE_BUDGET_LIMITS.perRingSystemMs +
    (familySummary.mixedMode ? CLEANUP_STAGE_BUDGET_LIMITS.mixedModeExtraMs : 0);
  return Math.max(CLEANUP_STAGE_BUDGET_LIMITS.minMs, Math.min(CLEANUP_STAGE_BUDGET_LIMITS.maxMs, rawLimit));
}

function createCleanupStageBudget(layoutGraph, familySummary, startMs) {
  return {
    enabled: true,
    startMs,
    limitMs: cleanupStageBudgetLimitMs(layoutGraph, familySummary),
    checkCount: 0,
    skippedStageCount: 0,
    skippedStages: [],
    skipReasons: {},
    maxElapsedMs: 0
  };
}

function finalizeCleanupStageBudgetTelemetry(budget, endMs) {
  if (!budget) {
    return null;
  }
  const elapsedMs = Math.max(0, endMs - budget.startMs);
  return {
    enabled: budget.enabled === true,
    limitMs: budget.limitMs,
    elapsedMs,
    checkCount: budget.checkCount ?? 0,
    skippedStageCount: budget.skippedStageCount ?? 0,
    skippedStages: [...(budget.skippedStages ?? [])],
    skipReasons: { ...(budget.skipReasons ?? {}) },
    maxElapsedMs: Math.max(budget.maxElapsedMs ?? 0, elapsedMs)
  };
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

  const ringNeighborCount = centerAtom.getNeighbors(molecule).filter(neighborAtom => neighborAtom && neighborAtom.name !== 'H' && layoutGraph.ringAtomIdSet.has(neighborAtom.id)).length;
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

function shouldAutoLandscapeLargeDirtyLabelLayout(layoutGraph, normalizedOptions, policy, cleanup) {
  if (normalizedOptions.finalLandscapeOrientation || normalizedOptions.fixedCoords.size > 0 || normalizedOptions.existingCoords.size > 0) {
    return false;
  }
  if (policy?.orientationBias !== 'horizontal') {
    return false;
  }
  const heavyAtomCount = layoutGraph.traits?.heavyAtomCount ?? layoutGraph.atoms?.size ?? 0;
  if (heavyAtomCount < 250) {
    return false;
  }
  const finalStageAudit = cleanup?.finalStageAudit ?? null;
  return (
    (finalStageAudit?.labelOverlapCount ?? 0) > 0 &&
    ((finalStageAudit?.severeOverlapCount ?? 0) > 0 || (finalStageAudit?.visibleHeavyBondCrossingCount ?? 0) > 0)
  );
}

function shouldReapplyLandscapeAfterFinalRetouches(layoutGraph, coords) {
  const heavyAtomIds = [...coords.keys()].filter(atomId => layoutGraph.atoms.has(atomId) && layoutGraph.atoms.get(atomId)?.element !== 'H');
  const bounds = computeBounds(coords, heavyAtomIds);
  return Boolean(bounds && bounds.height > bounds.width);
}

function ringSystemCenter(coords, ringSystem) {
  const positions = (ringSystem?.atomIds ?? []).map(atomId => coords.get(atomId)).filter(Boolean);
  return positions.length > 0 ? centroid(positions) : null;
}

function pathLikeRingChainAspect(layoutGraph, inputCoords) {
  const component = layoutGraph.components?.[0] ?? null;
  const ringChain = component ? describePathLikeIsolatedRingChain(layoutGraph, component) : null;
  const orderedRingSystemIds = ringChain?.orderedRingSystemIds ?? [];
  if (orderedRingSystemIds.length < 2) {
    return Number.POSITIVE_INFINITY;
  }
  const ringSystemById = new Map((ringChain.ringSystems ?? []).map(ringSystem => [ringSystem.id, ringSystem]));
  const centers = orderedRingSystemIds.map(ringSystemId => ringSystemCenter(inputCoords, ringSystemById.get(ringSystemId))).filter(Boolean);
  if (centers.length !== orderedRingSystemIds.length) {
    return Number.POSITIVE_INFINITY;
  }
  const xs = centers.map(center => center.x);
  const ys = centers.map(center => center.y);
  return (Math.max(...xs) - Math.min(...xs)) / Math.max(Math.max(...ys) - Math.min(...ys), 1e-6);
}

function orientPathLikeRingChainCoords(layoutGraph, inputCoords) {
  const component = layoutGraph.components?.[0] ?? null;
  const ringChain = component ? describePathLikeIsolatedRingChain(layoutGraph, component) : null;
  const orderedRingSystemIds = ringChain?.orderedRingSystemIds ?? [];
  if (orderedRingSystemIds.length < 2) {
    return { coords: inputCoords, changed: false };
  }
  const ringSystemById = new Map((ringChain.ringSystems ?? []).map(ringSystem => [ringSystem.id, ringSystem]));
  const firstCenter = ringSystemCenter(inputCoords, ringSystemById.get(orderedRingSystemIds[0]));
  const lastCenter = ringSystemCenter(inputCoords, ringSystemById.get(orderedRingSystemIds[orderedRingSystemIds.length - 1]));
  if (!firstCenter || !lastCenter) {
    return { coords: inputCoords, changed: false };
  }
  const axis = sub(lastCenter, firstCenter);
  if (Math.hypot(axis.x, axis.y) <= 1e-9) {
    return { coords: inputCoords, changed: false };
  }
  const rotation = -angleOf(axis);
  if (Math.abs(Math.sin(rotation)) <= 1e-9) {
    return { coords: inputCoords, changed: false };
  }
  const origin = centroid([...inputCoords.values()]);
  const coords = new Map();
  for (const [atomId, position] of inputCoords) {
    coords.set(atomId, add(origin, rotate(sub(position, origin), rotation)));
  }
  return { coords, changed: true };
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

function finalAuditCountsDoNotWorsen(candidateAudit, baseAudit) {
  if (!candidateAudit || !baseAudit || (baseAudit.ok === true && candidateAudit.ok !== true)) {
    return false;
  }
  for (const key of [
    'bondLengthFailureCount',
    'mildBondLengthFailureCount',
    'severeBondLengthFailureCount',
    'collapsedMacrocycleCount',
    'ringSubstituentReadabilityFailureCount',
    'inwardRingSubstituentCount',
    'outwardAxisRingSubstituentFailureCount',
    'severeOverlapCount',
    'visibleHeavyBondCrossingCount',
    'labelOverlapCount'
  ]) {
    if ((candidateAudit[key] ?? 0) > (baseAudit[key] ?? 0)) {
      return false;
    }
  }
  return !((candidateAudit.stereoContradiction ?? false) && !(baseAudit.stereoContradiction ?? false));
}

function finalDirtyLargeLabelClearanceTradeoffIsAcceptable(layoutGraph, candidateAudit, baseAudit) {
  const heavyAtomCount = layoutGraph.traits?.heavyAtomCount ?? layoutGraph.atoms?.size ?? 0;
  if (
    heavyAtomCount < 250 ||
    !candidateAudit ||
    !baseAudit ||
    (baseAudit.labelOverlapCount ?? 0) <= 0 ||
    (candidateAudit.labelOverlapCount ?? 0) >= (baseAudit.labelOverlapCount ?? 0)
  ) {
    return false;
  }
  if ((baseAudit.severeOverlapCount ?? 0) <= 0 && (baseAudit.visibleHeavyBondCrossingCount ?? 0) <= 0) {
    return false;
  }
  for (const key of ['bondLengthFailureCount', 'mildBondLengthFailureCount', 'severeBondLengthFailureCount', 'collapsedMacrocycleCount']) {
    if ((candidateAudit[key] ?? 0) > (baseAudit[key] ?? 0)) {
      return false;
    }
  }
  if ((candidateAudit.stereoContradiction ?? false) && !(baseAudit.stereoContradiction ?? false)) {
    return false;
  }
  if ((candidateAudit.severeOverlapCount ?? 0) >= (baseAudit.severeOverlapCount ?? 0)) {
    return false;
  }
  return (
    (candidateAudit.visibleHeavyBondCrossingCount ?? 0) <= (baseAudit.visibleHeavyBondCrossingCount ?? 0) + 2 &&
    (candidateAudit.ringSubstituentReadabilityFailureCount ?? 0) <= (baseAudit.ringSubstituentReadabilityFailureCount ?? 0) + 1 &&
    (candidateAudit.inwardRingSubstituentCount ?? 0) <= (baseAudit.inwardRingSubstituentCount ?? 0) + 1 &&
    (candidateAudit.outwardAxisRingSubstituentFailureCount ?? 0) <= (baseAudit.outwardAxisRingSubstituentFailureCount ?? 0) + 1
  );
}

function hasAuditCleanMixedFinalBranchState(audit) {
  return (
    audit?.ok === true &&
    (audit.severeOverlapCount ?? 0) === 0 &&
    (audit.visibleHeavyBondCrossingCount ?? 0) === 0 &&
    (audit.labelOverlapCount ?? 0) === 0 &&
    (audit.bondLengthFailureCount ?? 0) === 0 &&
    (audit.ringSubstituentReadabilityFailureCount ?? 0) === 0 &&
    (audit.inwardRingSubstituentCount ?? 0) === 0 &&
    (audit.outwardAxisRingSubstituentFailureCount ?? 0) === 0 &&
    (audit.stereoContradiction ?? false) === false &&
    audit.fallback?.mode == null
  );
}

/**
 * Returns whether a rigid final-orientation candidate preserves all audited
 * layout counts, including axis-aligned label boxes after fragment repacking.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} baseCoords - Pre-orientation coordinates.
 * @param {Map<string, {x: number, y: number}>} candidateCoords - Candidate oriented coordinates.
 * @param {object} placement - Placement result containing validation classes.
 * @param {number} bondLength - Target bond length.
 * @returns {boolean} True when orientation can be accepted safely.
 */
function finalOrientationAuditCountsDoNotWorsen(layoutGraph, baseCoords, candidateCoords, placement, bondLength) {
  const baseAudit = auditLayout(layoutGraph, baseCoords, {
    bondLength,
    bondValidationClasses: placement.bondValidationClasses
  });
  const candidateAudit = auditLayout(layoutGraph, candidateCoords, {
    bondLength,
    bondValidationClasses: placement.bondValidationClasses
  });
  return finalAuditCountsDoNotWorsen(candidateAudit, baseAudit);
}

/**
 * Audits late final-retouch coordinates with fresh stereo metadata so final
 * presentation tweaks cannot silently flip accepted E/Z or wedge assignments.
 * @param {object} molecule - Molecule-like graph.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinates.
 * @param {object} placement - Placement result containing validation classes.
 * @param {number} bondLength - Target bond length.
 * @returns {object} Final-retouch audit with stereo contradiction state.
 */
function auditFinalRetouchCoords(molecule, layoutGraph, coords, placement, bondLength) {
  const { stereo } = runStereoPhase(molecule, layoutGraph, coords);
  return auditLayout(layoutGraph, coords, {
    bondLength,
    bondValidationClasses: placement.bondValidationClasses,
    stereo
  });
}

function maybeApplyFinalStereoRescue(molecule, layoutGraph, coords, placement, bondLength) {
  if (layoutGraph._hasStereoTargets !== true) {
    return { changed: false, coords, currentStereo: null, currentAudit: null, candidateStereo: null, candidateAudit: null, reflections: 0 };
  }

  const currentEZ = inspectEZStereo(layoutGraph, coords);
  if ((currentEZ.violationCount ?? 0) === 0) {
    return {
      changed: false,
      coords,
      currentStereo: { ezViolationCount: currentEZ.violationCount },
      currentAudit: null,
      candidateStereo: null,
      candidateAudit: null,
      reflections: 0
    };
  }

  const { stereo: currentStereo } = runStereoPhase(molecule, layoutGraph, coords);
  if ((currentStereo.ezViolationCount ?? 0) === 0) {
    return { changed: false, coords, currentStereo, currentAudit: null, candidateStereo: null, candidateAudit: null, reflections: 0 };
  }
  const currentAudit = auditLayout(layoutGraph, coords, {
    bondLength,
    bondValidationClasses: placement.bondValidationClasses,
    stereo: currentStereo
  });
  if (currentAudit.stereoContradiction !== true) {
    return { changed: false, coords, currentStereo, currentAudit, candidateStereo: null, candidateAudit: null, reflections: 0 };
  }

  const rescued = enforceAcyclicEZStereo(layoutGraph, coords, { bondLength });
  if ((rescued.reflections ?? 0) <= 0) {
    return { changed: false, coords, currentStereo, currentAudit, candidateStereo: null, candidateAudit: null, reflections: 0 };
  }

  const { stereo: candidateStereo } = runStereoPhase(molecule, layoutGraph, rescued.coords);
  const candidateAudit = auditLayout(layoutGraph, rescued.coords, {
    bondLength,
    bondValidationClasses: placement.bondValidationClasses,
    stereo: candidateStereo
  });
  if (
    candidateAudit.stereoContradiction === false &&
    (candidateStereo.ezViolationCount ?? 0) < (currentStereo.ezViolationCount ?? 0) &&
    finalAuditCountsDoNotWorsen(candidateAudit, currentAudit)
  ) {
    return {
      changed: true,
      coords: rescued.coords,
      currentStereo,
      currentAudit,
      candidateStereo,
      candidateAudit,
      reflections: rescued.reflections ?? 0
    };
  }

  return { changed: false, coords, currentStereo, currentAudit, candidateStereo, candidateAudit, reflections: rescued.reflections ?? 0 };
}

function ringInternalAngle(coords, atomIds, index) {
  const atomId = atomIds[index];
  const previousAtomId = atomIds[(index - 1 + atomIds.length) % atomIds.length];
  const nextAtomId = atomIds[(index + 1) % atomIds.length];
  const position = coords.get(atomId);
  const previousPosition = coords.get(previousAtomId);
  const nextPosition = coords.get(nextAtomId);
  if (!position || !previousPosition || !nextPosition) {
    return null;
  }
  const first = sub(previousPosition, position);
  const second = sub(nextPosition, position);
  const firstLength = Math.hypot(first.x, first.y);
  const secondLength = Math.hypot(second.x, second.y);
  if (firstLength <= 1e-9 || secondLength <= 1e-9) {
    return null;
  }
  const cosine = Math.max(-1, Math.min(1, (first.x * second.x + first.y * second.y) / (firstLength * secondLength)));
  return Math.acos(cosine);
}

function smallRingAngleDeviation(coords, ring) {
  if (!ring || ring.atomIds.length !== 4) {
    return Number.POSITIVE_INFINITY;
  }
  let maxDeviation = 0;
  for (let index = 0; index < ring.atomIds.length; index++) {
    const angle = ringInternalAngle(coords, ring.atomIds, index);
    if (angle == null) {
      return Number.POSITIVE_INFINITY;
    }
    maxDeviation = Math.max(maxDeviation, Math.abs(angle - Math.PI / 2));
  }
  return maxDeviation;
}

function regularSmallRingTargets(coords, ring, bondLength) {
  const atomIds = ring?.atomIds ?? [];
  if (atomIds.length !== 4 || !Number.isFinite(bondLength) || bondLength <= 0) {
    return null;
  }
  const positions = atomIds.map(atomId => coords.get(atomId));
  if (positions.some(position => !position)) {
    return null;
  }
  const center = centroid(positions);
  const radius = bondLength / Math.sqrt(2);
  const step = Math.PI / 2;
  let bestTargets = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const direction of [1, -1]) {
    for (let anchorIndex = 0; anchorIndex < atomIds.length; anchorIndex++) {
      const anchorAngle = angleOf(sub(positions[anchorIndex], center));
      const baseAngle = anchorAngle - direction * step * anchorIndex;
      const targets = new Map();
      let score = 0;
      for (let index = 0; index < atomIds.length; index++) {
        const target = add(center, {
          x: Math.cos(baseAngle + direction * step * index) * radius,
          y: Math.sin(baseAngle + direction * step * index) * radius
        });
        targets.set(atomIds[index], target);
        const current = positions[index];
        score += (current.x - target.x) ** 2 + (current.y - target.y) ** 2;
      }
      if (score < bestScore) {
        bestScore = score;
        bestTargets = targets;
      }
    }
  }
  return bestTargets;
}

function regularSmallRingEdgeTargetCandidates(coords, ring, bondLength) {
  const atomIds = ring?.atomIds ?? [];
  if (atomIds.length !== 4 || !Number.isFinite(bondLength) || bondLength <= 0) {
    return [];
  }
  const candidates = [];
  for (let edgeIndex = 0; edgeIndex < atomIds.length; edgeIndex++) {
    const firstAtomId = atomIds[edgeIndex];
    const secondAtomId = atomIds[(edgeIndex + 1) % atomIds.length];
    const firstPosition = coords.get(firstAtomId);
    const secondPosition = coords.get(secondAtomId);
    if (!firstPosition || !secondPosition) {
      continue;
    }
    const edge = sub(secondPosition, firstPosition);
    const edgeLength = Math.hypot(edge.x, edge.y);
    if (edgeLength <= 1e-9) {
      continue;
    }
    const targetEdge = {
      x: (edge.x / edgeLength) * bondLength,
      y: (edge.y / edgeLength) * bondLength
    };
    for (const side of [1, -1]) {
      const perpendicular = rotate(targetEdge, (side * Math.PI) / 2);
      const targets = new Map();
      targets.set(firstAtomId, firstPosition);
      targets.set(secondAtomId, add(firstPosition, targetEdge));
      targets.set(atomIds[(edgeIndex + 2) % atomIds.length], add(add(firstPosition, targetEdge), perpendicular));
      targets.set(atomIds[(edgeIndex + 3) % atomIds.length], add(firstPosition, perpendicular));
      candidates.push(targets);
    }
  }
  return candidates;
}

function maybeSnapFinalSmallFourRings(molecule, layoutGraph, finalCoords, placement, bondLength) {
  let currentCoords = finalCoords;
  let currentAudit = auditFinalRetouchCoords(molecule, layoutGraph, currentCoords, placement, bondLength);
  let snappedRingCount = 0;
  for (const ring of layoutGraph.rings ?? []) {
    if (ring.aromatic || ring.atomIds.length !== 4 || ring.atomIds.some(atomId => layoutGraph.fixedCoords?.has(atomId))) {
      continue;
    }
    const currentDeviation = smallRingAngleDeviation(currentCoords, ring);
    if (currentDeviation <= PRESENTATION_METRIC_EPSILON || currentDeviation > FINAL_SMALL_RING_SNAP_MAX_ANGLE_DEVIATION) {
      continue;
    }
    let bestCandidate = null;
    const targetCandidates = [regularSmallRingTargets(currentCoords, ring, bondLength), ...regularSmallRingEdgeTargetCandidates(currentCoords, ring, bondLength)].filter(Boolean);
    for (const targets of targetCandidates) {
      const candidateCoords = cloneCoords(currentCoords);
      for (const [atomId, position] of targets) {
        candidateCoords.set(atomId, position);
      }
      const candidateDeviation = smallRingAngleDeviation(candidateCoords, ring);
      if (candidateDeviation > currentDeviation - FINAL_SMALL_RING_SNAP_MIN_ANGLE_IMPROVEMENT) {
        continue;
      }
      const candidateAudit = auditFinalRetouchCoords(molecule, layoutGraph, candidateCoords, placement, bondLength);
      if (!finalAuditCountsDoNotWorsen(candidateAudit, currentAudit)) {
        continue;
      }
      const move = ring.atomIds.reduce((total, atomId) => {
        const before = currentCoords.get(atomId);
        const after = candidateCoords.get(atomId);
        return before && after ? total + Math.hypot(after.x - before.x, after.y - before.y) : total;
      }, 0);
      if (
        !bestCandidate ||
        candidateDeviation < bestCandidate.deviation - PRESENTATION_METRIC_EPSILON ||
        (Math.abs(candidateDeviation - bestCandidate.deviation) <= PRESENTATION_METRIC_EPSILON && move < bestCandidate.move)
      ) {
        bestCandidate = { coords: candidateCoords, audit: candidateAudit, deviation: candidateDeviation, move };
      }
    }
    if (!bestCandidate) {
      continue;
    }
    currentCoords = bestCandidate.coords;
    currentAudit = bestCandidate.audit;
    snappedRingCount++;
  }
  return {
    changed: snappedRingCount > 0,
    coords: currentCoords,
    snappedRingCount
  };
}

function finalThreeHeavyFanDescriptors(layoutGraph, coords) {
  const descriptors = [];
  if (layoutGraph.options.suppressH !== true) {
    return descriptors;
  }
  for (const [centerAtomId, centerPosition] of coords) {
    const centerAtom = layoutGraph.atoms.get(centerAtomId);
    if (!centerAtom || centerAtom.element !== 'C' || centerAtom.aromatic || centerAtom.heavyDegree !== 3 || centerAtom.degree !== 4) {
      continue;
    }
    const neighbors = [];
    for (const bond of layoutGraph.bondsByAtomId.get(centerAtomId) ?? []) {
      if (!bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) !== 1) {
        continue;
      }
      const neighborAtomId = bond.a === centerAtomId ? bond.b : bond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      const neighborPosition = coords.get(neighborAtomId);
      if (!neighborAtom || neighborAtom.element === 'H' || !neighborPosition) {
        continue;
      }
      neighbors.push({
        atomId: neighborAtomId,
        angle: angleOf(sub(neighborPosition, centerPosition))
      });
    }
    if (neighbors.length === 3) {
      descriptors.push({ centerAtomId, centerPosition, neighbors });
    }
  }
  return descriptors;
}

function rotatedFinalThreeHeavyFanCandidate(layoutGraph, coords, descriptor, fixedNeighbor, assignments) {
  const candidateCoords = cloneCoords(coords);
  const movedAtomIds = new Set();
  for (const assignment of assignments) {
    if (assignment.atomId === fixedNeighbor.atomId) {
      continue;
    }
    const rotation = assignment.targetAngle - assignment.angle;
    if (Math.abs(rotation) <= PRESENTATION_METRIC_EPSILON) {
      continue;
    }
    const subtreeAtomIds = collectCutSubtree(layoutGraph, assignment.atomId, descriptor.centerAtomId);
    for (const atomId of subtreeAtomIds) {
      if (layoutGraph.fixedCoords?.has(atomId)) {
        return null;
      }
    }
    for (const atomId of subtreeAtomIds) {
      const position = coords.get(atomId);
      if (!position) {
        continue;
      }
      candidateCoords.set(atomId, add(descriptor.centerPosition, rotate(sub(position, descriptor.centerPosition), rotation)));
      movedAtomIds.add(atomId);
    }
  }
  return movedAtomIds.size > 0 ? { coords: candidateCoords, movedAtomIds } : null;
}

function finalThreeHeavyFanCandidateAssignments(neighbors, fixedNeighbor, direction) {
  const movingNeighbors = neighbors.filter(neighbor => neighbor.atomId !== fixedNeighbor.atomId);
  return [
    [
      { ...fixedNeighbor, targetAngle: fixedNeighbor.angle },
      { ...movingNeighbors[0], targetAngle: fixedNeighbor.angle + direction * EXACT_TRIGONAL_CONTINUATION_ANGLE },
      { ...movingNeighbors[1], targetAngle: fixedNeighbor.angle - direction * EXACT_TRIGONAL_CONTINUATION_ANGLE }
    ],
    [
      { ...fixedNeighbor, targetAngle: fixedNeighbor.angle },
      { ...movingNeighbors[0], targetAngle: fixedNeighbor.angle - direction * EXACT_TRIGONAL_CONTINUATION_ANGLE },
      { ...movingNeighbors[1], targetAngle: fixedNeighbor.angle + direction * EXACT_TRIGONAL_CONTINUATION_ANGLE }
    ]
  ];
}

function maybeRetouchFinalThreeHeavyContinuationFans(molecule, layoutGraph, finalCoords, placement, bondLength) {
  let currentCoords = finalCoords;
  let currentPenalty = measureThreeHeavyContinuationDistortion(layoutGraph, currentCoords);
  if (currentPenalty.maxDeviation <= PRESENTATION_METRIC_EPSILON) {
    return { changed: false, coords: finalCoords, movedAtomIds: [], maxDeviationBefore: currentPenalty.maxDeviation, maxDeviationAfter: currentPenalty.maxDeviation };
  }
  let currentAudit = auditFinalRetouchCoords(molecule, layoutGraph, currentCoords, placement, bondLength);
  const movedAtomIds = new Set();
  let changed = false;
  for (const descriptor of finalThreeHeavyFanDescriptors(layoutGraph, currentCoords)) {
    let bestCandidate = null;
    for (const fixedNeighbor of descriptor.neighbors) {
      for (const direction of [1, -1]) {
        for (const assignments of finalThreeHeavyFanCandidateAssignments(descriptor.neighbors, fixedNeighbor, direction)) {
          const candidate = rotatedFinalThreeHeavyFanCandidate(layoutGraph, currentCoords, descriptor, fixedNeighbor, assignments);
          if (!candidate) {
            continue;
          }
          if ([...candidate.movedAtomIds].some(atomId => movedAtomIds.has(atomId))) {
            continue;
          }
          const candidatePenalty = measureThreeHeavyContinuationDistortion(layoutGraph, candidate.coords);
          if (
            candidatePenalty.maxDeviation > currentPenalty.maxDeviation - PRESENTATION_METRIC_EPSILON &&
            candidatePenalty.totalDeviation > currentPenalty.totalDeviation - PRESENTATION_METRIC_EPSILON
          ) {
            continue;
          }
          let candidateCoords = candidate.coords;
          let candidateAudit = auditFinalRetouchCoords(molecule, layoutGraph, candidateCoords, placement, bondLength);
          let candidatePenaltyAfterCleanup = candidatePenalty;
          if (!finalAuditCountsDoNotWorsen(candidateAudit, currentAudit)) {
            const frozenAtomIds = new Set([...(placement.frozenAtomIds ?? []), descriptor.centerAtomId, ...descriptor.neighbors.map(neighbor => neighbor.atomId)]);
            for (const neighbor of descriptor.neighbors) {
              for (const bond of layoutGraph.bondsByAtomId.get(neighbor.atomId) ?? []) {
                if (!bond || bond.kind !== 'covalent') {
                  continue;
                }
                const adjacentAtomId = bond.a === neighbor.atomId ? bond.b : bond.a;
                const adjacentAtom = layoutGraph.atoms.get(adjacentAtomId);
                if (adjacentAtom && adjacentAtom.element !== 'H') {
                  frozenAtomIds.add(adjacentAtomId);
                }
              }
            }
            const cleanup = runUnifiedCleanup(layoutGraph, candidateCoords, {
              bondLength,
              epsilon: bondLength * 0.001,
              maxPasses: 2,
              protectBondIntegrity: true,
              frozenAtomIds
            });
            if (cleanup.passes <= 0) {
              continue;
            }
            candidateCoords = cleanup.coords;
            candidateAudit = auditFinalRetouchCoords(molecule, layoutGraph, candidateCoords, placement, bondLength);
            candidatePenaltyAfterCleanup = measureThreeHeavyContinuationDistortion(layoutGraph, candidateCoords);
            if (candidatePenaltyAfterCleanup.maxDeviation > candidatePenalty.maxDeviation + PRESENTATION_METRIC_EPSILON || !finalAuditCountsDoNotWorsen(candidateAudit, currentAudit)) {
              continue;
            }
          }
          const candidateMove = [...candidate.movedAtomIds].reduce((total, atomId) => {
            const before = currentCoords.get(atomId);
            const after = candidateCoords.get(atomId);
            return before && after ? total + Math.hypot(after.x - before.x, after.y - before.y) : total;
          }, 0);
          const candidateSnapshot = {
            ...candidate,
            coords: candidateCoords,
            penalty: candidatePenaltyAfterCleanup,
            audit: candidateAudit,
            move: candidateMove
          };
          if (
            !bestCandidate ||
            candidatePenalty.maxDeviation < bestCandidate.penalty.maxDeviation - PRESENTATION_METRIC_EPSILON ||
            (Math.abs(candidatePenalty.maxDeviation - bestCandidate.penalty.maxDeviation) <= PRESENTATION_METRIC_EPSILON && candidateMove < bestCandidate.move)
          ) {
            bestCandidate = candidateSnapshot;
          }
        }
      }
    }
    if (bestCandidate) {
      currentCoords = bestCandidate.coords;
      currentPenalty = bestCandidate.penalty;
      currentAudit = bestCandidate.audit;
      for (const atomId of bestCandidate.movedAtomIds) {
        movedAtomIds.add(atomId);
      }
      changed = true;
    }
  }
  return {
    changed,
    coords: currentCoords,
    movedAtomIds: [...movedAtomIds],
    maxDeviationBefore: measureThreeHeavyContinuationDistortion(layoutGraph, finalCoords).maxDeviation,
    maxDeviationAfter: currentPenalty.maxDeviation
  };
}

/**
 * Runs the existing label-clearance nudge as a final guarded polish after late
 * retouches that can trade severe-contact fixes for label-box contacts.
 * @param {object} molecule - Molecule-like graph.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {object} placement - Placement result containing validation classes.
 * @param {number} bondLength - Target bond length.
 * @param {object|null} labelMetrics - Optional renderer-supplied label metrics.
 * @returns {{changed: boolean, coords: Map<string, {x: number, y: number}>, nudges: number, currentAudit: object, candidateAudit: object|null}} Guarded label-clearance result.
 */
function maybeApplyGuardedFinalLabelClearance(molecule, layoutGraph, coords, placement, bondLength, labelMetrics) {
  const preliminaryAudit = auditLayout(layoutGraph, coords, {
    bondLength,
    bondValidationClasses: placement.bondValidationClasses
  });
  if ((preliminaryAudit.labelOverlapCount ?? 0) === 0) {
    return {
      changed: false,
      coords,
      nudges: 0,
      currentAudit: preliminaryAudit,
      candidateAudit: null
    };
  }

  const labelClearance = applyLabelClearance(layoutGraph, coords, {
    bondLength,
    labelMetrics,
    allowTerminalLeafRotation: true,
    allowTerminalMultipleBondLeafRotation: true
  });
  if ((labelClearance.nudges ?? 0) === 0) {
    return {
      changed: false,
      coords,
      nudges: 0,
      currentAudit: preliminaryAudit,
      candidateAudit: null
    };
  }

  const currentAudit = auditFinalRetouchCoords(molecule, layoutGraph, coords, placement, bondLength);
  const candidateAudit = auditFinalRetouchCoords(molecule, layoutGraph, labelClearance.coords, placement, bondLength);
  const labelClearanceAccepted =
    finalAuditCountsDoNotWorsen(candidateAudit, currentAudit) || finalDirtyLargeLabelClearanceTradeoffIsAcceptable(layoutGraph, candidateAudit, currentAudit);
  if ((candidateAudit.labelOverlapCount ?? 0) >= (currentAudit.labelOverlapCount ?? 0) || !labelClearanceAccepted) {
    return {
      changed: false,
      coords,
      nudges: 0,
      currentAudit,
      candidateAudit
    };
  }

  return {
    changed: true,
    coords: labelClearance.coords,
    nudges: labelClearance.nudges,
    currentAudit,
    candidateAudit
  };
}

/**
 * Returns bounded connector-label subtree rotations for a residual label atom.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} labelAtomId - Labeled atom whose connector side may move.
 * @returns {Array<{pivotAtomId: string, subtreeAtomIds: Set<string>, pivot: {x: number, y: number}}>} Connector rotation descriptors.
 */
function finalConnectorLabelRotationDescriptors(layoutGraph, coords, labelAtomId) {
  const descriptors = [];
  const labelAtom = layoutGraph.atoms.get(labelAtomId);
  if (!labelAtom || labelAtom.element === 'H' || (labelAtom.heavyDegree ?? 0) < 2 || layoutGraph.fixedCoords?.has(labelAtomId)) {
    return descriptors;
  }

  for (const bond of layoutGraph.bondsByAtomId.get(labelAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const pivotAtomId = bond.a === labelAtomId ? bond.b : bond.a;
    const pivot = coords.get(pivotAtomId);
    if (!pivot || layoutGraph.fixedCoords?.has(pivotAtomId)) {
      continue;
    }
    const subtreeAtomIds = collectCutSubtree(layoutGraph, labelAtomId, pivotAtomId);
    if (subtreeAtomIds.size <= 1 || subtreeAtomIds.size > FINAL_CONNECTOR_LABEL_MAX_SUBTREE_ATOMS) {
      continue;
    }
    let hasFixedAtom = false;
    for (const atomId of subtreeAtomIds) {
      if (layoutGraph.fixedCoords?.has(atomId)) {
        hasFixedAtom = true;
        break;
      }
    }
    if (hasFixedAtom) {
      continue;
    }
    descriptors.push({
      pivotAtomId,
      subtreeAtomIds,
      pivot
    });
  }
  return descriptors;
}

/**
 * Rotates a connector-side subtree around one adjacent pivot atom.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {Set<string>} subtreeAtomIds - Atoms on the moved connector side.
 * @param {{x: number, y: number}} pivot - Fixed pivot position.
 * @param {number} rotation - Rotation angle in radians.
 * @returns {Map<string, {x: number, y: number}>} Candidate coordinates.
 */
function rotateFinalConnectorLabelSubtree(coords, subtreeAtomIds, pivot, rotation) {
  const candidateCoords = cloneCoords(coords);
  for (const atomId of subtreeAtomIds) {
    const position = coords.get(atomId);
    if (!position) {
      continue;
    }
    candidateCoords.set(atomId, add(pivot, rotate(sub(position, pivot), rotation)));
  }
  return candidateCoords;
}

function finalConnectorCandidateLabelBox(baseLabelBox, candidateCoords) {
  if (!baseLabelBox) {
    return null;
  }
  const position = candidateCoords.get(baseLabelBox.atomId);
  if (!position) {
    return null;
  }
  return {
    ...baseLabelBox,
    x: position.x,
    y: position.y
  };
}

/**
 * Clears stubborn residual label-box overlaps by trying tiny rotations of a
 * connector-side subtree, accepting only audited non-worsening candidates.
 * @param {object} molecule - Molecule-like graph.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {object} placement - Placement result containing validation classes.
 * @param {number} bondLength - Target bond length.
 * @param {object|null} labelMetrics - Optional renderer-supplied label metrics.
 * @returns {{changed: boolean, coords: Map<string, {x: number, y: number}>, rotations: number, movedAtomCount: number, currentAudit: object, candidateAudit: object|null}} Guarded connector-label clearance result.
 */
function maybeApplyGuardedConnectorLabelClearance(molecule, layoutGraph, coords, placement, bondLength, labelMetrics) {
  const currentAudit = auditFinalRetouchCoords(molecule, layoutGraph, coords, placement, bondLength);
  if ((currentAudit.labelOverlapCount ?? 0) === 0) {
    return {
      changed: false,
      coords,
      rotations: 0,
      movedAtomCount: 0,
      currentAudit,
      candidateAudit: null
    };
  }

  const labelPadding = bondLength * 0.08;
  const labelBoxes = collectLabelBoxes(layoutGraph, coords, bondLength, { labelMetrics });
  const labelBoxByAtomId = new Map(labelBoxes.map(labelBox => [labelBox.atomId, labelBox]));
  const overlaps = findLabelOverlaps(layoutGraph, coords, bondLength, { labelMetrics, labelBoxes });
  const heavyAtomCount = layoutGraph.traits?.heavyAtomCount ?? layoutGraph.atoms?.size ?? 0;
  const useWideRotations =
    heavyAtomCount >= 250 && ((currentAudit.severeOverlapCount ?? 0) > 0 || (currentAudit.visibleHeavyBondCrossingCount ?? 0) > 0);
  const connectorRotations = useWideRotations
    ? [...FINAL_CONNECTOR_LABEL_ROTATIONS, ...FINAL_CONNECTOR_LABEL_WIDE_ROTATIONS]
    : FINAL_CONNECTOR_LABEL_ROTATIONS;
  for (const overlap of overlaps) {
    for (const labelAtomId of [overlap.firstAtomId, overlap.secondAtomId]) {
      const descriptors = finalConnectorLabelRotationDescriptors(layoutGraph, coords, labelAtomId);
      for (const descriptor of descriptors) {
        for (const rotation of connectorRotations) {
          const candidateCoords = rotateFinalConnectorLabelSubtree(coords, descriptor.subtreeAtomIds, descriptor.pivot, rotation);
          const firstCandidateBox = finalConnectorCandidateLabelBox(labelBoxByAtomId.get(overlap.firstAtomId), candidateCoords);
          const secondCandidateBox = finalConnectorCandidateLabelBox(labelBoxByAtomId.get(overlap.secondAtomId), candidateCoords);
          if (firstCandidateBox && secondCandidateBox && labelBoxesOverlap(firstCandidateBox, secondCandidateBox, labelPadding)) {
            continue;
          }
          const candidateLabelOverlapCount = findLabelOverlaps(layoutGraph, candidateCoords, bondLength, { labelMetrics }).length;
          if (candidateLabelOverlapCount >= (currentAudit.labelOverlapCount ?? 0)) {
            continue;
          }
          const candidateAudit = auditFinalRetouchCoords(molecule, layoutGraph, candidateCoords, placement, bondLength);
          const connectorClearanceAccepted =
            finalAuditCountsDoNotWorsen(candidateAudit, currentAudit) || finalDirtyLargeLabelClearanceTradeoffIsAcceptable(layoutGraph, candidateAudit, currentAudit);
          if (!connectorClearanceAccepted) {
            continue;
          }
          return {
            changed: true,
            coords: candidateCoords,
            rotations: 1,
            movedAtomCount: descriptor.subtreeAtomIds.size,
            currentAudit,
            candidateAudit
          };
        }
      }
    }
  }

  return {
    changed: false,
    coords,
    rotations: 0,
    movedAtomCount: 0,
    currentAudit,
    candidateAudit: null
  };
}

function terminalLabelLeafDescriptor(layoutGraph, coords, atomId) {
  const atom = layoutGraph.atoms.get(atomId);
  if (!atom || atom.element === 'H' || (atom.heavyDegree ?? 0) !== 1 || layoutGraph.fixedCoords?.has(atomId)) {
    return null;
  }

  let anchorAtomId = null;
  for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H' || !coords.has(neighborAtomId)) {
      continue;
    }
    if (anchorAtomId != null) {
      return null;
    }
    anchorAtomId = neighborAtomId;
  }
  if (anchorAtomId == null || layoutGraph.fixedCoords?.has(anchorAtomId)) {
    return null;
  }

  const subtreeAtomIds = collectCutSubtree(layoutGraph, atomId, anchorAtomId);
  const subtreeHeavyAtomCount = [...subtreeAtomIds].filter(subtreeAtomId => layoutGraph.atoms.get(subtreeAtomId)?.element !== 'H').length;
  if (subtreeHeavyAtomCount !== 1) {
    return null;
  }

  return {
    atomId,
    anchorAtomId,
    subtreeAtomIds,
    pivot: coords.get(anchorAtomId)
  };
}

function rotateTerminalLabelLeaf(coords, descriptor, rotation) {
  const candidateCoords = cloneCoords(coords);
  for (const atomId of descriptor.subtreeAtomIds) {
    const position = candidateCoords.get(atomId);
    if (!position) {
      continue;
    }
    candidateCoords.set(atomId, rotateAround(position, descriptor.pivot, rotation));
  }
  return candidateCoords;
}

function terminalLabelLeafCandidateScore(audit) {
  return (
    (audit.labelOverlapCount ?? 0) * 1_000_000 +
    (audit.severeOverlapCount ?? 0) * 10_000 +
    (audit.visibleHeavyBondCrossingCount ?? 0) * 1_000 +
    (audit.ringSubstituentReadabilityFailureCount ?? 0) * 100 +
    (audit.severeOverlapPenalty ?? 0)
  );
}

function maybeApplyGuardedTerminalLabelLeafClearance(molecule, layoutGraph, coords, placement, bondLength, labelMetrics) {
  let currentCoords = coords;
  let currentAudit = auditFinalRetouchCoords(molecule, layoutGraph, currentCoords, placement, bondLength);
  if ((currentAudit.labelOverlapCount ?? 0) === 0) {
    return {
      changed: false,
      coords,
      rotations: 0,
      movedAtomCount: 0,
      currentAudit,
      candidateAudit: null
    };
  }

  const movedAtomIds = new Set();
  let changed = false;
  let rotations = 0;
  let startingAudit = currentAudit;

  for (let pass = 0; pass < 4 && (currentAudit.labelOverlapCount ?? 0) > 0; pass++) {
    const labelBoxes = collectLabelBoxes(layoutGraph, currentCoords, bondLength, { labelMetrics });
    const overlaps = findLabelOverlaps(layoutGraph, currentCoords, bondLength, { labelMetrics, labelBoxes });
    if (overlaps.length === 0) {
      break;
    }

    let bestCandidate = null;
    for (const overlap of overlaps) {
      for (const atomId of [overlap.firstAtomId, overlap.secondAtomId]) {
        const descriptor = terminalLabelLeafDescriptor(layoutGraph, currentCoords, atomId);
        if (!descriptor) {
          continue;
        }
        for (const rotation of FINAL_TERMINAL_LABEL_LEAF_ROTATIONS) {
          const candidateCoords = rotateTerminalLabelLeaf(currentCoords, descriptor, rotation);
          const candidateLabelOverlapCount = findLabelOverlaps(layoutGraph, candidateCoords, bondLength, { labelMetrics }).length;
          if (candidateLabelOverlapCount >= (currentAudit.labelOverlapCount ?? 0)) {
            continue;
          }
          const candidateAudit = auditFinalRetouchCoords(molecule, layoutGraph, candidateCoords, placement, bondLength);
          if (!finalAuditCountsDoNotWorsen(candidateAudit, currentAudit)) {
            continue;
          }
          const score = terminalLabelLeafCandidateScore(candidateAudit);
          if (!bestCandidate || score < bestCandidate.score - PRESENTATION_METRIC_EPSILON) {
            bestCandidate = {
              coords: candidateCoords,
              audit: candidateAudit,
              descriptor,
              score
            };
          }
        }
      }
    }

    if (!bestCandidate) {
      break;
    }
    currentCoords = bestCandidate.coords;
    currentAudit = bestCandidate.audit;
    for (const atomId of bestCandidate.descriptor.subtreeAtomIds) {
      movedAtomIds.add(atomId);
    }
    changed = true;
    rotations++;
  }

  return {
    changed,
    coords: currentCoords,
    rotations,
    movedAtomCount: movedAtomIds.size,
    currentAudit: startingAudit,
    candidateAudit: changed ? currentAudit : null
  };
}

function collectFinalTerminalCarbonLeafSubtreeAtomIds(layoutGraph, rootAtomId, blockedAtomId, coords) {
  const visited = new Set([blockedAtomId]);
  const stack = [rootAtomId];
  const atomIds = [];
  while (stack.length > 0) {
    const atomId = stack.pop();
    if (visited.has(atomId)) {
      continue;
    }
    visited.add(atomId);
    if (coords.has(atomId)) {
      atomIds.push(atomId);
    }
    for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
      if (!visited.has(neighborAtomId)) {
        stack.push(neighborAtomId);
      }
    }
  }
  return atomIds;
}

/**
 * Returns whether a terminal atom can be locally rotated as a one-atom final
 * contact-relief leaf without moving its parent branch.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {object|null} atom - Candidate atom descriptor.
 * @param {string} atomId - Candidate atom ID.
 * @returns {boolean} True when the terminal leaf is safe to rotate locally.
 */
function isRetouchableFinalTerminalContactLeafAtom(layoutGraph, atom, atomId) {
  return Boolean(
    layoutGraph &&
    atom &&
    FINAL_TERMINAL_CONTACT_LEAF_ELEMENTS.has(atom.element) &&
    !atom.aromatic &&
    (atom.element !== 'C' || !atom.chirality) &&
    atom.heavyDegree === 1 &&
    !layoutGraph.ringAtomIdSet.has(atomId)
  );
}

function finalTerminalCarbonLeafContactDescriptor(layoutGraph, coords, atomId) {
  const atom = layoutGraph.atoms.get(atomId);
  if (!isRetouchableFinalTerminalContactLeafAtom(layoutGraph, atom, atomId) || !coords.has(atomId)) {
    return null;
  }

  const heavyNeighborIds = (layoutGraph.bondsByAtomId.get(atomId) ?? [])
    .filter(bond => bond?.kind === 'covalent' && !bond.aromatic && !bond.inRing)
    .map(bond => (bond.a === atomId ? bond.b : bond.a))
    .filter(neighborAtomId => layoutGraph.atoms.get(neighborAtomId)?.element !== 'H' && coords.has(neighborAtomId));
  if (heavyNeighborIds.length !== 1) {
    return null;
  }

  const anchorAtomId = heavyNeighborIds[0];
  const movedAtomIds = collectFinalTerminalCarbonLeafSubtreeAtomIds(layoutGraph, atomId, anchorAtomId, coords);
  const movedHeavyAtomIds = movedAtomIds.filter(movedAtomId => layoutGraph.atoms.get(movedAtomId)?.element !== 'H');
  if (movedHeavyAtomIds.length !== 1 || movedHeavyAtomIds[0] !== atomId) {
    return null;
  }
  return {
    anchorAtomId,
    leafAtomId: atomId,
    movedAtomIds
  };
}

function finalTerminalCarbonLeafContactClearance(layoutGraph, coords, descriptor) {
  const leafPosition = coords.get(descriptor.leafAtomId);
  if (!leafPosition) {
    return Number.POSITIVE_INFINITY;
  }
  const movedAtomIds = new Set(descriptor.movedAtomIds);
  let clearance = Number.POSITIVE_INFINITY;
  for (const [atomId, atom] of layoutGraph.atoms) {
    if (
      atomId === descriptor.leafAtomId ||
      movedAtomIds.has(atomId) ||
      !atom ||
      atom.element === 'H' ||
      !coords.has(atomId) ||
      layoutGraph.bondedPairSet.has(atomPairKey(descriptor.leafAtomId, atomId))
    ) {
      continue;
    }
    clearance = Math.min(clearance, Math.hypot(leafPosition.x - coords.get(atomId).x, leafPosition.y - coords.get(atomId).y));
  }
  return clearance;
}

function finalTerminalCarbonLeafNearContactDescriptors(layoutGraph, coords, bondLength) {
  const clearanceThreshold = bondLength * FINAL_TERMINAL_LEAF_CONTACT_CLEARANCE_FACTOR;
  const descriptors = [];
  for (const atomId of coords.keys()) {
    const descriptor = finalTerminalCarbonLeafContactDescriptor(layoutGraph, coords, atomId);
    if (!descriptor) {
      continue;
    }
    const clearance = finalTerminalCarbonLeafContactClearance(layoutGraph, coords, descriptor);
    if (clearance < clearanceThreshold - PRESENTATION_METRIC_EPSILON) {
      descriptors.push({ ...descriptor, clearance, clearanceThreshold });
    }
  }
  return descriptors;
}

/**
 * Finds terminal carbon leaf descriptors for bonds participating in visible
 * heavy-bond crossings, allowing the existing leaf rotation retouch to clear
 * local crossings without moving ring atoms or larger substituent branches.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @returns {Array<object>} Terminal carbon leaf descriptors touching crossings.
 */
function finalTerminalCarbonLeafCrossingDescriptors(layoutGraph, coords) {
  const descriptors = [];
  for (const crossing of findVisibleHeavyBondCrossings(layoutGraph, coords)) {
    for (const atomId of [...crossing.firstAtomIds, ...crossing.secondAtomIds]) {
      const descriptor = finalTerminalCarbonLeafContactDescriptor(layoutGraph, coords, atomId);
      if (descriptor) {
        descriptors.push(descriptor);
      }
    }
  }
  return descriptors;
}

function rotateFinalTerminalCarbonLeafContactCandidate(coords, descriptor, rotationOffset) {
  const anchorPosition = coords.get(descriptor.anchorAtomId);
  if (!anchorPosition) {
    return null;
  }
  const candidateCoords = cloneCoords(coords);
  for (const atomId of descriptor.movedAtomIds) {
    const position = coords.get(atomId);
    if (!position) {
      continue;
    }
    const dx = position.x - anchorPosition.x;
    const dy = position.y - anchorPosition.y;
    const nextAngle = Math.atan2(dy, dx) + rotationOffset;
    const radius = Math.hypot(dx, dy);
    candidateCoords.set(atomId, {
      x: anchorPosition.x + Math.cos(nextAngle) * radius,
      y: anchorPosition.y + Math.sin(nextAngle) * radius
    });
  }
  return candidateCoords;
}

function finalTerminalCarbonLeafContactCandidateMove(coords, candidateCoords, atomIds) {
  return atomIds.reduce((totalMove, atomId) => {
    const position = coords.get(atomId);
    const candidatePosition = candidateCoords.get(atomId);
    return position && candidatePosition ? totalMove + Math.hypot(candidatePosition.x - position.x, candidatePosition.y - position.y) : totalMove;
  }, 0);
}

function finalTerminalCarbonLeafContactAuditCanReplace(
  candidateAudit,
  baseAudit,
  candidateClearance = Number.POSITIVE_INFINITY,
  baseClearance = Number.POSITIVE_INFINITY,
  clearanceThreshold = Number.POSITIVE_INFINITY
) {
  if (!candidateAudit || !baseAudit || (baseAudit.ok === true && candidateAudit.ok !== true)) {
    return false;
  }
  for (const key of [
    'bondLengthFailureCount',
    'mildBondLengthFailureCount',
    'severeBondLengthFailureCount',
    'collapsedMacrocycleCount',
    'ringSubstituentReadabilityFailureCount',
    'inwardRingSubstituentCount',
    'outwardAxisRingSubstituentFailureCount',
    'visibleHeavyBondCrossingCount',
    'labelOverlapCount'
  ]) {
    if ((candidateAudit[key] ?? 0) > (baseAudit[key] ?? 0)) {
      return false;
    }
  }
  if ((candidateAudit.stereoContradiction ?? false) && !(baseAudit.stereoContradiction ?? false)) {
    return false;
  }
  const clearanceImproves =
    Number.isFinite(baseClearance) && candidateClearance > baseClearance + PRESENTATION_METRIC_EPSILON && candidateClearance >= clearanceThreshold - PRESENTATION_METRIC_EPSILON;
  const crossingImproves = (candidateAudit.visibleHeavyBondCrossingCount ?? 0) < (baseAudit.visibleHeavyBondCrossingCount ?? 0);
  return (
    crossingImproves ||
    (candidateAudit.severeOverlapCount ?? 0) < (baseAudit.severeOverlapCount ?? 0) ||
    ((candidateAudit.severeOverlapCount ?? 0) === (baseAudit.severeOverlapCount ?? 0) &&
      (candidateAudit.severeOverlapPenalty ?? 0) < (baseAudit.severeOverlapPenalty ?? 0) - PRESENTATION_METRIC_EPSILON) ||
    clearanceImproves
  );
}

function compareFinalTerminalCarbonLeafContactCandidates(candidate, incumbent) {
  if (!incumbent) {
    return -1;
  }
  for (const key of ['severeOverlapCount', 'visibleHeavyBondCrossingCount', 'bondLengthFailureCount', 'labelOverlapCount']) {
    if ((candidate.audit[key] ?? 0) !== (incumbent.audit[key] ?? 0)) {
      return (candidate.audit[key] ?? 0) - (incumbent.audit[key] ?? 0);
    }
  }
  if (Math.abs((candidate.audit.severeOverlapPenalty ?? 0) - (incumbent.audit.severeOverlapPenalty ?? 0)) > PRESENTATION_METRIC_EPSILON) {
    return (candidate.audit.severeOverlapPenalty ?? 0) - (incumbent.audit.severeOverlapPenalty ?? 0);
  }
  const candidateClearanceThreshold = candidate.clearanceThreshold ?? Number.POSITIVE_INFINITY;
  const incumbentClearanceThreshold = incumbent.clearanceThreshold ?? Number.POSITIVE_INFINITY;
  const candidateClears = (candidate.clearance ?? Number.POSITIVE_INFINITY) >= candidateClearanceThreshold - PRESENTATION_METRIC_EPSILON;
  const incumbentClears = (incumbent.clearance ?? Number.POSITIVE_INFINITY) >= incumbentClearanceThreshold - PRESENTATION_METRIC_EPSILON;
  if (candidateClears !== incumbentClears) {
    return candidateClears ? -1 : 1;
  }
  if (!candidateClears && Math.abs((candidate.clearance ?? 0) - (incumbent.clearance ?? 0)) > PRESENTATION_METRIC_EPSILON) {
    return (incumbent.clearance ?? 0) - (candidate.clearance ?? 0);
  }
  if (Math.abs(candidate.totalMove - incumbent.totalMove) > PRESENTATION_METRIC_EPSILON) {
    return candidate.totalMove - incumbent.totalMove;
  }
  if (Math.abs(candidate.rotationMagnitude - incumbent.rotationMagnitude) > PRESENTATION_METRIC_EPSILON) {
    return candidate.rotationMagnitude - incumbent.rotationMagnitude;
  }
  return candidate.leafAtomId.localeCompare(incumbent.leafAtomId, 'en', { numeric: true });
}

function shouldUseCoarseDirtyLargeTerminalLeafContactRotations(layoutGraph, audit) {
  const heavyAtomCount = layoutGraph.traits?.heavyAtomCount ?? layoutGraph.atoms?.size ?? 0;
  return heavyAtomCount >= 400 && ((audit?.severeOverlapCount ?? 0) > 0 || (audit?.visibleHeavyBondCrossingCount ?? 0) > 0);
}

function shouldSkipDirtyUltraLargeFinalPresentationRetouches(layoutGraph, familySummary, audit) {
  const heavyAtomCount = layoutGraph.traits?.heavyAtomCount ?? layoutGraph.atoms?.size ?? 0;
  return (
    familySummary.primaryFamily === 'large-molecule' &&
    heavyAtomCount >= 400 &&
    audit?.fallback?.mode === 'generic-scaffold' &&
    (audit.severeOverlapCount ?? 0) >= 4 &&
    (audit.visibleHeavyBondCrossingCount ?? 0) >= 8 &&
    (audit.bondLengthFailureCount ?? 0) === 0 &&
    (audit.collapsedMacrocycleCount ?? 0) === 0 &&
    (audit.stereoContradiction ?? false) === false
  );
}

function maybeRetouchFinalTerminalCarbonLeafSevereContacts(layoutGraph, finalCoords, placement, bondLength) {
  let currentCoords = finalCoords;
  let baseAudit = auditLayout(layoutGraph, currentCoords, {
    bondLength,
    bondValidationClasses: placement.bondValidationClasses
  });
  const rotationOffsets = shouldUseCoarseDirtyLargeTerminalLeafContactRotations(layoutGraph, baseAudit)
    ? FINAL_TERMINAL_LEAF_CONTACT_DIRTY_LARGE_ROTATIONS
    : FINAL_TERMINAL_LEAF_CONTACT_ROTATIONS;
  if (
    (baseAudit.severeOverlapCount ?? 0) === 0 &&
    finalTerminalCarbonLeafNearContactDescriptors(layoutGraph, currentCoords, bondLength).length === 0 &&
    finalTerminalCarbonLeafCrossingDescriptors(layoutGraph, currentCoords).length === 0
  ) {
    return { coords: finalCoords, changed: false, movedAtomIds: [] };
  }

  const movedAtomIds = new Set();
  let changed = false;
  for (let passIndex = 0; passIndex < FINAL_TERMINAL_LEAF_CONTACT_MAX_PASSES; passIndex++) {
    const descriptorByKey = new Map();
    for (const overlap of findSevereOverlaps(layoutGraph, currentCoords, bondLength)) {
      for (const atomId of [overlap.firstAtomId, overlap.secondAtomId]) {
        const descriptor = finalTerminalCarbonLeafContactDescriptor(layoutGraph, currentCoords, atomId);
        if (!descriptor) {
          continue;
        }
        descriptorByKey.set(`${descriptor.anchorAtomId}:${descriptor.leafAtomId}`, descriptor);
      }
    }
    for (const descriptor of finalTerminalCarbonLeafNearContactDescriptors(layoutGraph, currentCoords, bondLength)) {
      descriptorByKey.set(`${descriptor.anchorAtomId}:${descriptor.leafAtomId}`, descriptor);
    }
    for (const descriptor of finalTerminalCarbonLeafCrossingDescriptors(layoutGraph, currentCoords)) {
      descriptorByKey.set(`${descriptor.anchorAtomId}:${descriptor.leafAtomId}`, descriptor);
    }
    if (descriptorByKey.size === 0) {
      break;
    }

    let bestCandidate = null;
    for (const descriptor of descriptorByKey.values()) {
      for (const rotationOffset of rotationOffsets) {
        const candidateCoords = rotateFinalTerminalCarbonLeafContactCandidate(currentCoords, descriptor, rotationOffset);
        if (!candidateCoords) {
          continue;
        }
        const candidateAudit = auditLayout(layoutGraph, candidateCoords, {
          bondLength,
          bondValidationClasses: placement.bondValidationClasses
        });
        const clearsCountedContact =
          (candidateAudit.severeOverlapCount ?? 0) < (baseAudit.severeOverlapCount ?? 0) || (candidateAudit.visibleHeavyBondCrossingCount ?? 0) < (baseAudit.visibleHeavyBondCrossingCount ?? 0);
        if (!clearsCountedContact) {
          const baseTrigonalPenalty = measureTrigonalDistortion(layoutGraph, currentCoords);
          const candidateTrigonalPenalty = measureTrigonalDistortion(layoutGraph, candidateCoords);
          const baseOmittedHydrogenPenalty = measureThreeHeavyContinuationDistortion(layoutGraph, currentCoords);
          const candidateOmittedHydrogenPenalty = measureThreeHeavyContinuationDistortion(layoutGraph, candidateCoords);
          if (
            candidateTrigonalPenalty.maxDeviation > baseTrigonalPenalty.maxDeviation + PRESENTATION_METRIC_EPSILON ||
            candidateTrigonalPenalty.totalDeviation > baseTrigonalPenalty.totalDeviation + PRESENTATION_METRIC_EPSILON ||
            candidateOmittedHydrogenPenalty.maxDeviation > baseOmittedHydrogenPenalty.maxDeviation + PRESENTATION_METRIC_EPSILON ||
            candidateOmittedHydrogenPenalty.totalDeviation > baseOmittedHydrogenPenalty.totalDeviation + PRESENTATION_METRIC_EPSILON
          ) {
            continue;
          }
        }
        const candidateClearance = Number.isFinite(descriptor.clearance) ? finalTerminalCarbonLeafContactClearance(layoutGraph, candidateCoords, descriptor) : Number.POSITIVE_INFINITY;
        if (!finalTerminalCarbonLeafContactAuditCanReplace(candidateAudit, baseAudit, candidateClearance, descriptor.clearance, descriptor.clearanceThreshold)) {
          continue;
        }
        const candidate = {
          coords: candidateCoords,
          audit: candidateAudit,
          clearance: candidateClearance,
          clearanceThreshold: descriptor.clearanceThreshold,
          leafAtomId: descriptor.leafAtomId,
          movedAtomIds: descriptor.movedAtomIds,
          rotationMagnitude: Math.abs(rotationOffset),
          totalMove: finalTerminalCarbonLeafContactCandidateMove(currentCoords, candidateCoords, descriptor.movedAtomIds)
        };
        if (compareFinalTerminalCarbonLeafContactCandidates(candidate, bestCandidate) < 0) {
          bestCandidate = candidate;
        }
      }
    }
    if (!bestCandidate) {
      break;
    }
    currentCoords = bestCandidate.coords;
    baseAudit = bestCandidate.audit;
    for (const atomId of bestCandidate.movedAtomIds) {
      movedAtomIds.add(atomId);
    }
    changed = true;
    if (
      (baseAudit.severeOverlapCount ?? 0) === 0 &&
      finalTerminalCarbonLeafNearContactDescriptors(layoutGraph, currentCoords, bondLength).length === 0 &&
      finalTerminalCarbonLeafCrossingDescriptors(layoutGraph, currentCoords).length === 0
    ) {
      break;
    }
  }

  return {
    coords: currentCoords,
    changed,
    movedAtomIds: [...movedAtomIds],
    audit: baseAudit
  };
}

/**
 * Returns the center/leaf pair for a terminal hetero atom joined by a multiple bond.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} bond - Candidate covalent bond descriptor.
 * @returns {{leafAtomId: string, centerAtomId: string}|null} Terminal multiple-bond endpoint pair.
 */
function terminalMultipleBondLeafEndpoint(layoutGraph, bond) {
  if (!bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) < 2) {
    return null;
  }
  const firstAtom = layoutGraph.atoms.get(bond.a);
  const secondAtom = layoutGraph.atoms.get(bond.b);
  if (!firstAtom || !secondAtom) {
    return null;
  }
  const firstIsLeaf = firstAtom.element !== 'C' && firstAtom.element !== 'H' && firstAtom.heavyDegree === 1;
  const secondIsLeaf = secondAtom.element !== 'C' && secondAtom.element !== 'H' && secondAtom.heavyDegree === 1;
  if (firstIsLeaf === secondIsLeaf) {
    return null;
  }
  return firstIsLeaf ? { leafAtomId: bond.a, centerAtomId: bond.b } : { leafAtomId: bond.b, centerAtomId: bond.a };
}

function terminalMultipleBondLeafEndpoints(layoutGraph) {
  if (Array.isArray(layoutGraph._terminalMultipleBondLeafEndpoints)) {
    return layoutGraph._terminalMultipleBondLeafEndpoints;
  }
  const endpoints = [];
  for (const bond of layoutGraph.bonds.values()) {
    const endpoint = terminalMultipleBondLeafEndpoint(layoutGraph, bond);
    if (endpoint) {
      endpoints.push(endpoint);
    }
  }
  layoutGraph._terminalMultipleBondLeafEndpoints = endpoints;
  return endpoints;
}

function normalizeFullAngle(angle) {
  return ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
}

function angleSeparation(firstAngle, secondAngle) {
  const difference = Math.abs(normalizeFullAngle(firstAngle - secondAngle));
  return difference > Math.PI ? 2 * Math.PI - difference : difference;
}

function uniqueCandidateAngles(angles) {
  const uniqueAngles = [];
  for (const angle of angles) {
    const normalizedAngle = normalizeFullAngle(angle);
    if (!uniqueAngles.some(candidateAngle => angleSeparation(candidateAngle, normalizedAngle) < 1e-9)) {
      uniqueAngles.push(normalizedAngle);
    }
  }
  return uniqueAngles;
}

function terminalMultipleBondLeafCandidateAngles(coords, centerAtomId, neighborAtomIds) {
  const centerPosition = coords.get(centerAtomId);
  if (!centerPosition || neighborAtomIds.length !== 2) {
    return [];
  }
  const neighborAngles = neighborAtomIds
    .map(neighborAtomId => angleOf(sub(coords.get(neighborAtomId), centerPosition)))
    .map(normalizeFullAngle)
    .sort((firstAngle, secondAngle) => firstAngle - secondAngle);
  const [firstAngle, secondAngle] = neighborAngles;
  const directGap = secondAngle - firstAngle;
  const wrappedGap = 2 * Math.PI - directGap;
  const directGapBisector = firstAngle + directGap / 2;
  const wrappedGapBisector = secondAngle + wrappedGap / 2;

  return uniqueCandidateAngles([
    directGapBisector,
    wrappedGapBisector,
    firstAngle + (2 * Math.PI) / 3,
    firstAngle - (2 * Math.PI) / 3,
    secondAngle + (2 * Math.PI) / 3,
    secondAngle - (2 * Math.PI) / 3
  ]);
}

function terminalMultipleBondLeafAngleDeviation(coords, centerAtomId, leafAtomId, neighborAtomIds) {
  const centerPosition = coords.get(centerAtomId);
  const leafPosition = coords.get(leafAtomId);
  if (!centerPosition || !leafPosition || neighborAtomIds.length !== 2) {
    return Infinity;
  }
  const leafAngle = angleOf(sub(leafPosition, centerPosition));
  let maxDeviation = 0;
  for (const neighborAtomId of neighborAtomIds) {
    const neighborPosition = coords.get(neighborAtomId);
    if (!neighborPosition) {
      return Infinity;
    }
    const neighborAngle = angleOf(sub(neighborPosition, centerPosition));
    maxDeviation = Math.max(maxDeviation, Math.abs((Math.PI * 2) / 3 - angleSeparation(leafAngle, neighborAngle)));
  }
  return maxDeviation;
}

function compareTerminalMultipleBondLeafCrossingCandidates(firstCandidate, secondCandidate) {
  if (!secondCandidate) {
    return -1;
  }
  for (const key of ['visibleHeavyBondCrossingCount', 'severeOverlapCount', 'bondLengthFailureCount', 'labelOverlapCount']) {
    const difference = (firstCandidate.audit[key] ?? 0) - (secondCandidate.audit[key] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  if (Math.abs(firstCandidate.angleDeviation - secondCandidate.angleDeviation) > PRESENTATION_METRIC_EPSILON) {
    return firstCandidate.angleDeviation - secondCandidate.angleDeviation;
  }
  if (Math.abs(firstCandidate.movement - secondCandidate.movement) > PRESENTATION_METRIC_EPSILON) {
    return firstCandidate.movement - secondCandidate.movement;
  }
  return firstCandidate.leafAtomId.localeCompare(secondCandidate.leafAtomId);
}

/**
 * Repositions terminal multiple-bond leaves when their current slot creates a
 * visible heavy-bond crossing. The move is intentionally accepted only when it
 * lowers the final crossing count without worsening other audit counts.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} finalCoords - Final coordinate map.
 * @param {object} placement - Placement result with bond-validation classes.
 * @param {number} bondLength - Target bond length.
 * @returns {{coords: Map<string, {x: number, y: number}>, changed: boolean}} Retouch result.
 */
function maybeRepositionCrossingTerminalMultipleBondLeaves(layoutGraph, finalCoords, placement, bondLength) {
  let coords = finalCoords;
  let changed = false;

  for (let passIndex = 0; passIndex < 2; passIndex++) {
    const baseAudit = auditLayout(layoutGraph, coords, {
      bondLength,
      bondValidationClasses: placement.bondValidationClasses
    });
    if ((baseAudit.visibleHeavyBondCrossingCount ?? 0) === 0) {
      break;
    }

    let bestCandidate = null;
    for (const endpoint of terminalMultipleBondLeafEndpoints(layoutGraph)) {
      const centerAtom = layoutGraph.atoms.get(endpoint.centerAtomId);
      if (!centerAtom || centerAtom.heavyDegree !== 3 || !coords.has(endpoint.centerAtomId) || !coords.has(endpoint.leafAtomId)) {
        continue;
      }
      const neighborAtomIds = (layoutGraph.bondsByAtomId.get(endpoint.centerAtomId) ?? [])
        .map(candidateBond => (candidateBond.a === endpoint.centerAtomId ? candidateBond.b : candidateBond.a))
        .filter(neighborAtomId => neighborAtomId !== endpoint.leafAtomId && layoutGraph.atoms.get(neighborAtomId)?.element !== 'H' && coords.has(neighborAtomId));
      if (neighborAtomIds.length !== 2) {
        continue;
      }

      const centerPosition = coords.get(endpoint.centerAtomId);
      const leafPosition = coords.get(endpoint.leafAtomId);
      const baseAngleDeviation = terminalMultipleBondLeafAngleDeviation(coords, endpoint.centerAtomId, endpoint.leafAtomId, neighborAtomIds);
      for (const candidateAngle of terminalMultipleBondLeafCandidateAngles(coords, endpoint.centerAtomId, neighborAtomIds)) {
        const candidateCoords = cloneCoords(coords);
        candidateCoords.set(endpoint.leafAtomId, {
          x: centerPosition.x + Math.cos(candidateAngle) * bondLength,
          y: centerPosition.y + Math.sin(candidateAngle) * bondLength
        });
        const candidateAudit = auditLayout(layoutGraph, candidateCoords, {
          bondLength,
          bondValidationClasses: placement.bondValidationClasses
        });
        if (!finalAuditCountsDoNotWorsen(candidateAudit, baseAudit) || (candidateAudit.visibleHeavyBondCrossingCount ?? 0) >= (baseAudit.visibleHeavyBondCrossingCount ?? 0)) {
          continue;
        }
        const angleDeviation = terminalMultipleBondLeafAngleDeviation(candidateCoords, endpoint.centerAtomId, endpoint.leafAtomId, neighborAtomIds);
        if (angleDeviation > baseAngleDeviation + PRESENTATION_METRIC_EPSILON) {
          continue;
        }
        const movement = Math.hypot(candidateCoords.get(endpoint.leafAtomId).x - leafPosition.x, candidateCoords.get(endpoint.leafAtomId).y - leafPosition.y);
        const candidate = {
          audit: candidateAudit,
          angleDeviation,
          coords: candidateCoords,
          leafAtomId: endpoint.leafAtomId,
          movement
        };
        if (compareTerminalMultipleBondLeafCrossingCandidates(candidate, bestCandidate) < 0) {
          bestCandidate = candidate;
        }
      }
    }

    if (!bestCandidate) {
      break;
    }
    coords = bestCandidate.coords;
    changed = true;
  }

  return { coords, changed };
}

/**
 * Shortens stretched terminal multiple-bond leaves along their current bond axis.
 * The move is accepted only when final audit metrics do not worsen and the
 * bond-length deviation improves, so compressed clearance fixes remain intact.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} finalCoords - Final coordinate map.
 * @param {object} placement - Placement result with bond-validation classes.
 * @param {number} bondLength - Target bond length.
 * @returns {{coords: Map<string, {x: number, y: number}>, changed: boolean}} Retouch result.
 */
function maybeSnapStretchedTerminalMultipleBondLeaves(layoutGraph, finalCoords, placement, bondLength) {
  let candidateCoords = null;
  for (const endpoint of terminalMultipleBondLeafEndpoints(layoutGraph)) {
    const coords = candidateCoords ?? finalCoords;
    const centerPosition = coords.get(endpoint.centerAtomId);
    const leafPosition = coords.get(endpoint.leafAtomId);
    if (!centerPosition || !leafPosition) {
      continue;
    }
    const dx = leafPosition.x - centerPosition.x;
    const dy = leafPosition.y - centerPosition.y;
    const currentLength = Math.hypot(dx, dy);
    if (currentLength <= bondLength * 1.05 || currentLength <= 1e-9) {
      continue;
    }
    candidateCoords ??= cloneCoords(finalCoords);
    candidateCoords.set(endpoint.leafAtomId, {
      x: centerPosition.x + (dx / currentLength) * bondLength,
      y: centerPosition.y + (dy / currentLength) * bondLength
    });
  }
  if (!candidateCoords) {
    return { coords: finalCoords, changed: false };
  }

  const baseAudit = auditLayout(layoutGraph, finalCoords, {
    bondLength,
    bondValidationClasses: placement.bondValidationClasses
  });
  const candidateAudit = auditLayout(layoutGraph, candidateCoords, {
    bondLength,
    bondValidationClasses: placement.bondValidationClasses
  });
  if (!finalAuditCountsDoNotWorsen(candidateAudit, baseAudit)) {
    return { coords: finalCoords, changed: false };
  }
  const improvesFailureCount = candidateAudit.bondLengthFailureCount < baseAudit.bondLengthFailureCount;
  const improvesDeviation = candidateAudit.maxBondLengthDeviation < baseAudit.maxBondLengthDeviation - PRESENTATION_METRIC_EPSILON;
  if (!improvesFailureCount && !improvesDeviation) {
    return { coords: finalCoords, changed: false };
  }
  return { coords: candidateCoords, changed: true };
}

function finalCompressedPairedTerminalHeteroLeafFanCandidate(layoutGraph, coords, centerAtomId, targetAngles, factors, leafEntries) {
  const centerPosition = coords.get(centerAtomId);
  if (!centerPosition) {
    return null;
  }
  const candidateCoords = cloneCoords(coords);
  let movement = 0;
  let compression = 0;

  for (let index = 0; index < leafEntries.length; index++) {
    const leafEntry = leafEntries[index];
    const leafPosition = coords.get(leafEntry.atomId);
    if (!leafPosition) {
      return null;
    }
    const currentRadius = Math.hypot(leafPosition.x - centerPosition.x, leafPosition.y - centerPosition.y);
    if (currentRadius <= PRESENTATION_METRIC_EPSILON) {
      return null;
    }
    const targetRadius = currentRadius * factors[index];
    const targetPosition = {
      x: centerPosition.x + Math.cos(targetAngles[index]) * targetRadius,
      y: centerPosition.y + Math.sin(targetAngles[index]) * targetRadius
    };
    const delta = {
      x: targetPosition.x - leafPosition.x,
      y: targetPosition.y - leafPosition.y
    };
    candidateCoords.set(leafEntry.atomId, targetPosition);
    movement += Math.hypot(delta.x, delta.y);
    compression += Math.abs(1 - factors[index]);

    for (const hydrogenAtomId of leafEntry.hydrogenAtomIds) {
      const hydrogenPosition = coords.get(hydrogenAtomId);
      if (hydrogenPosition) {
        candidateCoords.set(hydrogenAtomId, {
          x: hydrogenPosition.x + delta.x,
          y: hydrogenPosition.y + delta.y
        });
      }
    }
  }

  return { coords: candidateCoords, movement, compression };
}

function compareFinalCompressedPairedTerminalHeteroFanCandidates(candidate, incumbent) {
  if (!incumbent) {
    return -1;
  }
  for (const key of ['severeOverlapCount', 'visibleHeavyBondCrossingCount', 'bondLengthFailureCount', 'labelOverlapCount']) {
    const difference = (candidate.audit[key] ?? 0) - (incumbent.audit[key] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  if (Math.abs(candidate.penalty.maxDeviation - incumbent.penalty.maxDeviation) > PRESENTATION_METRIC_EPSILON) {
    return candidate.penalty.maxDeviation - incumbent.penalty.maxDeviation;
  }
  if (Math.abs(candidate.penalty.totalDeviation - incumbent.penalty.totalDeviation) > PRESENTATION_METRIC_EPSILON) {
    return candidate.penalty.totalDeviation - incumbent.penalty.totalDeviation;
  }
  if (Math.abs((candidate.audit.maxBondLengthDeviation ?? 0) - (incumbent.audit.maxBondLengthDeviation ?? 0)) > PRESENTATION_METRIC_EPSILON) {
    return (candidate.audit.maxBondLengthDeviation ?? 0) - (incumbent.audit.maxBondLengthDeviation ?? 0);
  }
  if (Math.abs(candidate.compression - incumbent.compression) > PRESENTATION_METRIC_EPSILON) {
    return candidate.compression - incumbent.compression;
  }
  return candidate.movement - incumbent.movement;
}

function maybeRetouchFinalCompressedPairedTerminalHeteroLeafFans(layoutGraph, finalCoords, placement, bondLength, basePenalty, baseAudit, candidateCenterIds = null) {
  let bestCandidate = null;
  const centerAtomIds = Array.isArray(candidateCenterIds) ? [...new Set(candidateCenterIds)] : finalCoords.keys();

  for (const centerAtomId of centerAtomIds) {
    const centerAtom = layoutGraph.atoms.get(centerAtomId);
    const centerPosition = finalCoords.get(centerAtomId);
    if (!centerAtom || centerAtom.element === 'H' || centerAtom.aromatic || !centerPosition) {
      continue;
    }

    const heavyBonds = (layoutGraph.bondsByAtomId.get(centerAtomId) ?? [])
      .filter(bond => bond?.kind === 'covalent' && !bond.aromatic)
      .map(bond => {
        const neighborAtomId = bond.a === centerAtomId ? bond.b : bond.a;
        const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
        return {
          bond,
          neighborAtomId,
          neighborAtom
        };
      })
      .filter(({ neighborAtomId, neighborAtom }) => neighborAtom && neighborAtom.element !== 'H' && finalCoords.has(neighborAtomId));
    if (heavyBonds.length !== 3) {
      continue;
    }

    const terminalMultipleLeaves = heavyBonds.filter(
      ({ bond, neighborAtomId, neighborAtom }) =>
        (bond.order ?? 1) >= 2 && neighborAtom.element !== 'C' && neighborAtom.heavyDegree === 1 && !(placement.frozenAtomIds instanceof Set && placement.frozenAtomIds.has(neighborAtomId))
    );
    const terminalSingleHeteroLeaves = heavyBonds.filter(
      ({ bond, neighborAtomId, neighborAtom }) =>
        (bond.order ?? 1) === 1 &&
        neighborAtom.element !== 'C' &&
        neighborAtom.element !== 'H' &&
        neighborAtom.heavyDegree === 1 &&
        !(placement.frozenAtomIds instanceof Set && placement.frozenAtomIds.has(neighborAtomId))
    );
    if (terminalMultipleLeaves.length !== 1 || terminalSingleHeteroLeaves.length !== 1) {
      continue;
    }

    const leafAtomIds = new Set([terminalMultipleLeaves[0].neighborAtomId, terminalSingleHeteroLeaves[0].neighborAtomId]);
    const fixedBonds = heavyBonds.filter(({ neighborAtomId }) => !leafAtomIds.has(neighborAtomId));
    if (fixedBonds.length !== 1) {
      continue;
    }
    const fixedNeighborPosition = finalCoords.get(fixedBonds[0].neighborAtomId);
    if (!fixedNeighborPosition) {
      continue;
    }

    const fixedAngle = angleOf(sub(fixedNeighborPosition, centerPosition));
    const leafEntries = [terminalMultipleLeaves[0], terminalSingleHeteroLeaves[0]].map(({ neighborAtomId }) => ({
      atomId: neighborAtomId,
      hydrogenAtomIds: (layoutGraph.bondsByAtomId.get(neighborAtomId) ?? [])
        .filter(bond => bond?.kind === 'covalent')
        .map(bond => (bond.a === neighborAtomId ? bond.b : bond.a))
        .filter(atomId => layoutGraph.atoms.get(atomId)?.element === 'H' && finalCoords.has(atomId))
    }));

    for (const targetAngles of [
      [fixedAngle + (2 * Math.PI) / 3, fixedAngle - (2 * Math.PI) / 3],
      [fixedAngle - (2 * Math.PI) / 3, fixedAngle + (2 * Math.PI) / 3]
    ]) {
      for (const firstFactor of FINAL_COMPRESSED_PAIRED_TERMINAL_HETERO_COMPRESSION_FACTORS) {
        for (const secondFactor of FINAL_COMPRESSED_PAIRED_TERMINAL_HETERO_COMPRESSION_FACTORS) {
          const retouch = finalCompressedPairedTerminalHeteroLeafFanCandidate(layoutGraph, finalCoords, centerAtomId, targetAngles, [firstFactor, secondFactor], leafEntries);
          if (!retouch) {
            continue;
          }
          const candidatePenalty = measureTerminalMultipleBondLeafFanPenalty(layoutGraph, retouch.coords);
          if (
            (candidatePenalty.maxDeviation ?? Number.POSITIVE_INFINITY) >= (basePenalty.maxDeviation ?? Number.POSITIVE_INFINITY) - PRESENTATION_METRIC_EPSILON &&
            (candidatePenalty.totalDeviation ?? Number.POSITIVE_INFINITY) >= (basePenalty.totalDeviation ?? Number.POSITIVE_INFINITY) - PRESENTATION_METRIC_EPSILON
          ) {
            continue;
          }

          const candidateAudit = auditLayout(layoutGraph, retouch.coords, {
            bondLength,
            bondValidationClasses: placement.bondValidationClasses
          });
          if (!finalAuditCountsDoNotWorsen(candidateAudit, baseAudit)) {
            continue;
          }

          const candidate = {
            ...retouch,
            audit: candidateAudit,
            penalty: candidatePenalty
          };
          if (compareFinalCompressedPairedTerminalHeteroFanCandidates(candidate, bestCandidate) < 0) {
            bestCandidate = candidate;
          }
        }
      }
    }
  }

  return bestCandidate
    ? {
        coords: bestCandidate.coords,
        changed: true,
        nudges: 1,
        maxDeviationBefore: basePenalty.maxDeviation,
        maxDeviationAfter: bestCandidate.penalty.maxDeviation
      }
    : { coords: finalCoords, changed: false };
}

function maybeRetouchFinalTerminalMultipleBondLeafFans(layoutGraph, finalCoords, placement, bondLength) {
  const retouchPlan = collectTerminalMultipleBondLeafFanRetouchCenters(layoutGraph, finalCoords, {
    frozenAtomIds: placement.frozenAtomIds
  });
  const basePenalty = {
    totalDeviation: retouchPlan.totalDeviation,
    maxDeviation: retouchPlan.maxDeviation
  };
  if ((basePenalty.maxDeviation ?? 0) <= PRESENTATION_METRIC_EPSILON) {
    return { coords: finalCoords, changed: false };
  }
  if (
    retouchPlan.candidateCenterIds.length === 0 &&
    retouchPlan.hiddenHydrogenCandidateCenterIds.length === 0 &&
    retouchPlan.pairedTerminalHeteroCandidateCenterIds.length === 0
  ) {
    return { coords: finalCoords, changed: false };
  }
  const baseAudit = auditLayout(layoutGraph, finalCoords, {
    bondLength,
    bondValidationClasses: placement.bondValidationClasses
  });

  const retouch = runTerminalMultipleBondLeafFanTidy(layoutGraph, finalCoords, {
    bondLength,
    bondValidationClasses: placement.bondValidationClasses,
    frozenAtomIds: placement.frozenAtomIds,
    candidateCenterIds: retouchPlan.candidateCenterIds,
    hiddenHydrogenCandidateCenterIds: retouchPlan.hiddenHydrogenCandidateCenterIds
  });
  const pairedTerminalHeteroRetouch = runPairedTerminalHeteroLeafFanTidy(layoutGraph, retouch.coords, {
    bondLength,
    bondValidationClasses: placement.bondValidationClasses,
    candidateCenterIds: retouchPlan.pairedTerminalHeteroCandidateCenterIds
  });
  const retouchedCoords = (pairedTerminalHeteroRetouch.nudges ?? 0) > 0 ? pairedTerminalHeteroRetouch.coords : retouch.coords;
  const nudgeCount = (retouch.nudges ?? 0) + (pairedTerminalHeteroRetouch.nudges ?? 0);
  if (nudgeCount <= 0) {
    return maybeRetouchFinalCompressedPairedTerminalHeteroLeafFans(layoutGraph, finalCoords, placement, bondLength, basePenalty, baseAudit, retouchPlan.pairedTerminalHeteroCandidateCenterIds);
  }

  const candidatePenalty = measureTerminalMultipleBondLeafFanPenalty(layoutGraph, retouchedCoords);
  if (
    (candidatePenalty.maxDeviation ?? Number.POSITIVE_INFINITY) >= (basePenalty.maxDeviation ?? Number.POSITIVE_INFINITY) - PRESENTATION_METRIC_EPSILON &&
    (candidatePenalty.totalDeviation ?? Number.POSITIVE_INFINITY) >= (basePenalty.totalDeviation ?? Number.POSITIVE_INFINITY) - PRESENTATION_METRIC_EPSILON
  ) {
    return { coords: finalCoords, changed: false };
  }

  const candidateAudit = auditLayout(layoutGraph, retouchedCoords, {
    bondLength,
    bondValidationClasses: placement.bondValidationClasses
  });
  const candidateFanMaxImproves = (candidatePenalty.maxDeviation ?? Number.POSITIVE_INFINITY) < (basePenalty.maxDeviation ?? Number.POSITIVE_INFINITY) - PRESENTATION_METRIC_EPSILON;
  const candidateBondDeviationWorsens = (candidateAudit.maxBondLengthDeviation ?? 0) > (baseAudit.maxBondLengthDeviation ?? 0) + PRESENTATION_METRIC_EPSILON;
  if (!finalAuditCountsDoNotWorsen(candidateAudit, baseAudit) || (candidateBondDeviationWorsens && !candidateFanMaxImproves)) {
    return maybeRetouchFinalCompressedPairedTerminalHeteroLeafFans(layoutGraph, finalCoords, placement, bondLength, basePenalty, baseAudit, retouchPlan.pairedTerminalHeteroCandidateCenterIds);
  }

  return {
    coords: retouchedCoords,
    changed: true,
    nudges: nudgeCount,
    maxDeviationBefore: basePenalty.maxDeviation,
    maxDeviationAfter: candidatePenalty.maxDeviation
  };
}

function isPreferredFinalHypervalentRetouch(candidateAudit, candidateDeviation, candidateRingBranchDeviation, incumbentAudit, incumbentDeviation, incumbentRingBranchDeviation) {
  for (const key of ['severeOverlapCount', 'visibleHeavyBondCrossingCount', 'bondLengthFailureCount', 'labelOverlapCount']) {
    const candidateValue = candidateAudit[key] ?? 0;
    const incumbentValue = incumbentAudit[key] ?? 0;
    if (candidateValue !== incumbentValue) {
      return candidateValue < incumbentValue;
    }
  }
  if (Math.abs(candidateDeviation - incumbentDeviation) > PRESENTATION_METRIC_EPSILON) {
    return candidateDeviation < incumbentDeviation;
  }
  if (Math.abs(candidateRingBranchDeviation.totalDeviation - incumbentRingBranchDeviation.totalDeviation) > PRESENTATION_METRIC_EPSILON) {
    return candidateRingBranchDeviation.totalDeviation < incumbentRingBranchDeviation.totalDeviation;
  }
  return candidateRingBranchDeviation.maxDeviation < incumbentRingBranchDeviation.maxDeviation - PRESENTATION_METRIC_EPSILON;
}

/**
 * Re-applies the hypervalent angle specialist after post-stage retouches that
 * can resolve large-molecule overlaps outside the normal cleanup graph. The
 * candidate is accepted only when it improves S/P/Se/As/Si presentation while
 * preserving the externally visible final audit counts.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} finalCoords - Current final coordinate map.
 * @param {object} placement - Placement result with bond-validation classes.
 * @param {number} bondLength - Target layout bond length.
 * @param {((label: string, description: string, coords: Map<string, {x: number, y: number}>, metrics?: object) => void)|null} [onStep] - Optional debug callback.
 * @returns {{coords: Map<string, {x: number, y: number}>, changed: boolean}} Retouch result.
 */
function maybeRetouchFinalHypervalentAngles(layoutGraph, finalCoords, placement, bondLength, onStep = null) {
  if (!hasHypervalentAngleTidyNeed(layoutGraph, finalCoords)) {
    return { coords: finalCoords, changed: false };
  }

  let currentCoords = finalCoords;
  let currentDeviation = measureOrthogonalHypervalentDeviation(layoutGraph, currentCoords);
  let currentRingBranchDeviation = measureRingAnchoredHypervalentBranchDeviation(layoutGraph, currentCoords);
  let nudges = 0;
  let changed = false;

  for (let passIndex = 0; passIndex < 3; passIndex++) {
    const currentHasNeed = hasHypervalentAngleTidyNeed(layoutGraph, currentCoords);
    if (!currentHasNeed) {
      break;
    }

    const baseAudit = auditLayout(layoutGraph, currentCoords, {
      bondLength,
      bondValidationClasses: placement.bondValidationClasses
    });
    const retouchCandidates = [runHypervalentAngleTidy(layoutGraph, currentCoords), runHypervalentConnectorSubtreeRotationTidy(layoutGraph, currentCoords)];
    let selectedRetouch = null;
    let selectedAudit = null;
    let selectedDeviation = null;
    let selectedRingBranchDeviation = null;
    for (const retouch of retouchCandidates) {
      if (!retouch || !(retouch.coords instanceof Map) || (retouch.nudges ?? 0) <= 0) {
        continue;
      }

      const candidateDeviation = measureOrthogonalHypervalentDeviation(layoutGraph, retouch.coords);
      const candidateHasNeed = hasHypervalentAngleTidyNeed(layoutGraph, retouch.coords);
      const candidateRingBranchDeviation = measureRingAnchoredHypervalentBranchDeviation(layoutGraph, retouch.coords);
      const improvesDeviation = candidateDeviation < currentDeviation - PRESENTATION_METRIC_EPSILON;
      const clearsResidualNeed = currentHasNeed && !candidateHasNeed && candidateDeviation <= currentDeviation + PRESENTATION_METRIC_EPSILON;
      if (!improvesDeviation && !clearsResidualNeed) {
        continue;
      }

      const candidateAudit = auditLayout(layoutGraph, retouch.coords, {
        bondLength,
        bondValidationClasses: placement.bondValidationClasses
      });
      if (
        !finalAuditCountsDoNotWorsen(candidateAudit, {
          ...baseAudit,
          labelOverlapCount: (baseAudit.labelOverlapCount ?? 0) + 1
        })
      ) {
        continue;
      }
      if (candidateRingBranchDeviation.branchCount > 0 && candidateRingBranchDeviation.totalDeviation > currentRingBranchDeviation.totalDeviation + PRESENTATION_METRIC_EPSILON) {
        continue;
      }
      if (selectedRetouch && !isPreferredFinalHypervalentRetouch(candidateAudit, candidateDeviation, candidateRingBranchDeviation, selectedAudit, selectedDeviation, selectedRingBranchDeviation)) {
        continue;
      }
      selectedRetouch = retouch;
      selectedAudit = candidateAudit;
      selectedDeviation = candidateDeviation;
      selectedRingBranchDeviation = candidateRingBranchDeviation;
    }

    if (!selectedRetouch) {
      break;
    }

    currentCoords = selectedRetouch.coords;
    currentDeviation = selectedDeviation;
    currentRingBranchDeviation = selectedRingBranchDeviation;
    nudges += selectedRetouch.nudges ?? 0;
    changed = true;
  }

  if (!changed) {
    return { coords: finalCoords, changed: false };
  }

  onStep?.('Hypervalent Angle Final Touchup', 'S/P/Se/As and tetraaryl Si center angles re-orthogonalized after final retouches.', cloneCoords(currentCoords), {
    nudges,
    hypervalentDeviationBefore: measureOrthogonalHypervalentDeviation(layoutGraph, finalCoords),
    hypervalentDeviationAfter: currentDeviation,
    ringBranchDeviationBefore: measureRingAnchoredHypervalentBranchDeviation(layoutGraph, finalCoords).totalDeviation,
    ringBranchDeviationAfter: currentRingBranchDeviation.totalDeviation
  });
  return { coords: currentCoords, changed: true };
}

function isPreferredFinalDivalentContinuationRetouch(layoutGraph, baseCoords, candidateCoords, baseAudit, candidateAudit) {
  if (!finalAuditCountsDoNotWorsen(candidateAudit, baseAudit)) {
    return false;
  }
  const basePenalty = measureRingAdjacentTerminalDivalentContinuationDistortion(layoutGraph, baseCoords);
  const candidatePenalty = measureRingAdjacentTerminalDivalentContinuationDistortion(layoutGraph, candidateCoords);
  if (candidatePenalty.maxDeviation < basePenalty.maxDeviation - PRESENTATION_METRIC_EPSILON) {
    return true;
  }
  if (candidatePenalty.maxDeviation > basePenalty.maxDeviation + PRESENTATION_METRIC_EPSILON) {
    return false;
  }
  return candidatePenalty.totalDeviation < basePenalty.totalDeviation - PRESENTATION_METRIC_EPSILON;
}

function maybeRetouchFinalDivalentContinuations(layoutGraph, finalCoords, placement, familySummary, bondLength, onStep = null) {
  const basePenalty = measureRingAdjacentTerminalDivalentContinuationDistortion(layoutGraph, finalCoords);
  if (basePenalty.distortedCenterCount !== 1 || basePenalty.maxDeviation < FINAL_DIVALENT_CONTINUATION_RETOUCH_MIN_DEVIATION) {
    return { coords: finalCoords, changed: false };
  }

  const retouch = runDivalentContinuationTidy(layoutGraph, finalCoords, {
    bondLength,
    frozenAtomIds: placement.frozenAtomIds,
    allowAuditWorsening: true
  });
  if ((retouch.nudges ?? 0) <= 0) {
    return { coords: finalCoords, changed: false };
  }

  const cleanup = runUnifiedCleanup(layoutGraph, retouch.coords, {
    epsilon: bondLength * 0.001,
    bondLength,
    protectLargeMoleculeBackbone: placement.placedFamilies.includes('large-molecule'),
    cleanupRigidSubtreesByAtomId: placement.cleanupRigidSubtreesByAtomId,
    maxPasses: 1,
    protectBondIntegrity: shouldProtectCleanupBondIntegrity(familySummary, placement),
    frozenAtomIds: placement.frozenAtomIds
  });
  const candidateCoords = cleanup.passes > 0 ? cleanup.coords : retouch.coords;
  if (familySummary.mixedMode === true) {
    resolveMixedAcylBranchSevereContacts(layoutGraph, candidateCoords, placement.bondValidationClasses, bondLength);
  }
  const baseAudit = auditLayout(layoutGraph, finalCoords, {
    bondLength,
    bondValidationClasses: placement.bondValidationClasses
  });
  const candidateAudit = auditLayout(layoutGraph, candidateCoords, {
    bondLength,
    bondValidationClasses: placement.bondValidationClasses
  });
  if (!isPreferredFinalDivalentContinuationRetouch(layoutGraph, finalCoords, candidateCoords, baseAudit, candidateAudit)) {
    return { coords: finalCoords, changed: false };
  }

  onStep?.('Divalent Continuation Tidy', 'Post-orientation compact terminal continuations snapped back to exact 120-degree slots.', cloneCoords(candidateCoords), {
    nudges: retouch.nudges,
    cleanupPasses: cleanup.passes,
    finalRetouch: true
  });
  return { coords: candidateCoords, changed: true };
}

function maybeRetouchProjectedRingChain(layoutGraph, finalCoords, placement, bondLength, onStep = null) {
  const baseAspect = pathLikeRingChainAspect(layoutGraph, finalCoords);
  if (!Number.isFinite(baseAspect) || baseAspect >= MIN_PROJECTED_RING_CHAIN_ASPECT) {
    return { coords: finalCoords, changed: false };
  }

  const baseAudit = auditLayout(layoutGraph, finalCoords, {
    bondLength,
    bondValidationClasses: placement.bondValidationClasses
  });
  const projection = runRingChainUnitProjectionRetouch(layoutGraph, finalCoords, {
    bondLength,
    bondValidationClasses: placement.bondValidationClasses
  });
  if (!projection.changed) {
    return { coords: finalCoords, changed: false };
  }

  let candidateCoords = projection.coords;
  let movedAtomCount = projection.movedAtomIds.length;
  const projectedHypervalentRetouch = runRingChainHypervalentBranchRetouch(layoutGraph, candidateCoords, {
    bondLength,
    bondValidationClasses: placement.bondValidationClasses
  });
  if (projectedHypervalentRetouch.changed) {
    candidateCoords = projectedHypervalentRetouch.coords;
    movedAtomCount += projectedHypervalentRetouch.movedAtomIds.length;
  }
  const projectedTerminalRetouch = runTerminalAcyclicChainRetouch(layoutGraph, candidateCoords, {
    bondLength,
    bondValidationClasses: placement.bondValidationClasses
  });
  if (projectedTerminalRetouch.changed) {
    candidateCoords = projectedTerminalRetouch.coords;
    movedAtomCount += projectedTerminalRetouch.movedAtomIds.length;
  }
  const projectedSideBranchRetouch = runRingChainSideBranchExitRetouch(layoutGraph, candidateCoords, {
    bondLength,
    bondValidationClasses: placement.bondValidationClasses
  });
  if (projectedSideBranchRetouch.changed) {
    candidateCoords = projectedSideBranchRetouch.coords;
    movedAtomCount += projectedSideBranchRetouch.movedAtomIds.length;
  }

  const candidateAudit = auditLayout(layoutGraph, candidateCoords, {
    bondLength,
    bondValidationClasses: placement.bondValidationClasses
  });
  if (!finalAuditCountsDoNotWorsen(candidateAudit, baseAudit)) {
    return { coords: finalCoords, changed: false };
  }

  const candidateAspect = pathLikeRingChainAspect(layoutGraph, candidateCoords);
  if (candidateAspect < Math.max(MIN_PROJECTED_RING_CHAIN_ASPECT, baseAspect * 1.5)) {
    return { coords: finalCoords, changed: false };
  }

  onStep?.('Ring Chain Unit Projection', 'Path-like isolated ring chain rebuilt as aligned ring units with glycosidic linkers re-solved at bond length.', cloneCoords(candidateCoords), {
    movedAtomCount,
    previousAspect: baseAspect,
    projectedAspect: candidateAspect
  });
  return { coords: candidateCoords, changed: true };
}

/**
 * Returns a timing accumulator when enabled.
 * @param {boolean} enabled - Whether timing should be recorded.
 * @returns {{enabled: boolean, startTime: number, placementMs: number, cleanupMs: number, finalRetouchMs: number, finalRetouchBreakdownMs: Record<string, number>, labelClearanceMs: number, stereoMs: number, auditMs: number}|null} Timing accumulator.
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
    finalRetouchMs: 0,
    finalRetouchBreakdownMs: {},
    labelClearanceMs: 0,
    stereoMs: 0,
    auditMs: 0
  };
}

function timeNamedTimingBucket(timingState, totalKey, breakdownKey, name, fn) {
  if (!timingState) {
    return fn();
  }
  const startTime = nowMs();
  try {
    return fn();
  } finally {
    const elapsedMs = nowMs() - startTime;
    timingState[totalKey] = (timingState[totalKey] ?? 0) + elapsedMs;
    const breakdown = (timingState[breakdownKey] ??= {});
    breakdown[name] = (breakdown[name] ?? 0) + elapsedMs;
  }
}

const CLEANUP_BOND_PROTECTED_PRIMARY_FAMILIES = new Set(['large-molecule', 'macrocycle', 'bridged', 'fused', 'organometallic']);
const CLEAN_PLACEMENT_FAST_PATH_SUPPORTED_PRIMARY_FAMILIES = new Set(['acyclic', 'isolated-ring']);
const CLEAN_PLACEMENT_FAST_PATH_SUPPORTED_HOOKS = new Set(['ring-substituent-tidy']);
const CLEAN_PLACEMENT_FAST_PATH_SKIPPED_STAGES = Object.freeze([
  ['coreGeometryCleanup', null],
  ['stereoRescueCleanup', 'selectedGeometryCheckpoint'],
  ['stereoProtectedTouchup', ['stereoRescueCleanup', 'selectedGeometryCheckpoint']],
  ['stereoTouchup', ['stereoRescueCleanup', 'selectedGeometryCheckpoint']],
  ['postTouchupStereo', 'stereoTouchup'],
  ['presentationCleanup', 'best'],
  ['specialistCleanup', 'best'],
  ['stabilizeAfterCleanup', 'best'],
  ['ringTerminalHeteroFinalRetouch', 'best'],
  ['terminalMultipleBondLeafFinalRetouch', 'best'],
  ['terminalAlkeneContinuationFinalRetouch', 'best'],
  ['divalentContinuationFinalRetouch', 'best'],
  ['ringTerminalRootExactFinalRetouch', 'best'],
  ['omittedHydrogenCollateralRootFinalRetouch', 'best']
]);

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

function hasOnlyCleanPlacementFastPathHooks(policy) {
  return (policy.postCleanupHooks ?? []).every(hookName => CLEAN_PLACEMENT_FAST_PATH_SUPPORTED_HOOKS.has(hookName));
}

function hasCleanPlacementFastPathAudit(audit) {
  return (
    audit?.ok === true &&
    (audit.severeOverlapCount ?? 0) === 0 &&
    (audit.visibleHeavyBondCrossingCount ?? 0) === 0 &&
    (audit.labelOverlapCount ?? 0) === 0 &&
    (audit.bondLengthFailureCount ?? 0) === 0 &&
    (audit.mildBondLengthFailureCount ?? 0) === 0 &&
    (audit.severeBondLengthFailureCount ?? 0) === 0 &&
    (audit.collapsedMacrocycleCount ?? 0) === 0 &&
    (audit.ringSubstituentReadabilityFailureCount ?? 0) === 0 &&
    (audit.inwardRingSubstituentCount ?? 0) === 0 &&
    (audit.outwardAxisRingSubstituentFailureCount ?? 0) === 0 &&
    (audit.stereoContradiction ?? false) === false
  );
}

function hasTerminalAlkeneContinuationCandidate(layoutGraph, coords) {
  for (const centerAtomId of coords.keys()) {
    const centerAtom = layoutGraph.atoms.get(centerAtomId);
    if (!centerAtom || centerAtom.element !== 'C' || centerAtom.aromatic) {
      continue;
    }
    const heavyBonds = visibleHeavyCovalentBonds(layoutGraph, coords, centerAtomId);
    if (heavyBonds.length !== 2) {
      continue;
    }
    const parentBond = heavyBonds.find(({ bond }) => !bond.aromatic && (bond.order ?? 1) === 1);
    const leafBond = heavyBonds.find(({ bond, neighborAtomId }) => {
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      return !bond.aromatic && (bond.order ?? 1) >= 2 && neighborAtom?.element === 'C' && (neighborAtom.heavyDegree ?? 0) === 1;
    });
    if (!parentBond || !leafBond) {
      continue;
    }
    const hasGrandParent = visibleHeavyCovalentBonds(layoutGraph, coords, parentBond.neighborAtomId).some(({ neighborAtomId }) => neighborAtomId !== centerAtomId);
    if (hasGrandParent) {
      return true;
    }
  }
  return false;
}

function hasCleanPlacementFastPathPresentationNeed(layoutGraph, coords, placementStage, bondLength) {
  const presentationPenalty = measureCleanupStagePresentationPenalty(layoutGraph, coords);
  if (presentationPenalty > PRESENTATION_METRIC_EPSILON) {
    return true;
  }

  const terminalMultipleBondLeafFanPenalty = measureTerminalMultipleBondLeafFanPenalty(layoutGraph, coords);
  if (terminalMultipleBondLeafFanPenalty.maxDeviation > PRESENTATION_METRIC_EPSILON || terminalMultipleBondLeafFanPenalty.totalDeviation > PRESENTATION_METRIC_EPSILON) {
    return true;
  }

  const ringAdjacentDivalentPenalty = measureRingAdjacentTerminalDivalentContinuationDistortion(layoutGraph, coords);
  if (
    ringAdjacentDivalentPenalty.distortedCenterCount > 0 ||
    ringAdjacentDivalentPenalty.maxDeviation > PRESENTATION_METRIC_EPSILON ||
    ringAdjacentDivalentPenalty.totalDeviation > PRESENTATION_METRIC_EPSILON
  ) {
    return true;
  }

  const trigonalDistortionPenalty = measureTrigonalDistortion(layoutGraph, coords);
  if (
    trigonalDistortionPenalty.distortedCenterCount > 0 ||
    trigonalDistortionPenalty.maxDeviation > PRESENTATION_METRIC_EPSILON ||
    trigonalDistortionPenalty.totalDeviation > PRESENTATION_METRIC_EPSILON
  ) {
    return true;
  }

  const omittedHydrogenTrigonalPenalty = measureThreeHeavyContinuationDistortion(layoutGraph, coords);
  if (
    omittedHydrogenTrigonalPenalty.distortedCenterCount > 0 ||
    omittedHydrogenTrigonalPenalty.maxDeviation > PRESENTATION_METRIC_EPSILON ||
    omittedHydrogenTrigonalPenalty.totalDeviation > PRESENTATION_METRIC_EPSILON
  ) {
    return true;
  }

  const terminalHeteroOutwardPenalty = measureRingTerminalHeteroOutwardPenalty(layoutGraph, coords);
  if (
    terminalHeteroOutwardPenalty.maxDeviation > PRESENTATION_METRIC_EPSILON ||
    terminalHeteroOutwardPenalty.totalDeviation > PRESENTATION_METRIC_EPSILON ||
    hasRingTerminalHeteroTidyNeed(layoutGraph, coords, { bondLength })
  ) {
    return true;
  }

  const hypervalentDeviation = measureOrthogonalHypervalentDeviation(layoutGraph, coords);
  const ringAnchoredHypervalentDeviation = measureRingAnchoredHypervalentBranchDeviation(layoutGraph, coords);
  if (
    hypervalentDeviation > PRESENTATION_METRIC_EPSILON ||
    ringAnchoredHypervalentDeviation.maxDeviation > PRESENTATION_METRIC_EPSILON ||
    ringAnchoredHypervalentDeviation.totalDeviation > PRESENTATION_METRIC_EPSILON ||
    hasHypervalentAngleTidyNeed(layoutGraph, coords, {
      angleThreshold: PRESENTATION_METRIC_EPSILON,
      ringAnchoredAngleThreshold: PRESENTATION_METRIC_EPSILON
    })
  ) {
    return true;
  }

  return (
    hasOutstandingRingPresentationNeed(layoutGraph, {
      coords,
      audit: placementStage.audit,
      presentationPenalty,
      terminalMultipleBondLeafFanPenalty: terminalMultipleBondLeafFanPenalty.totalDeviation
    }) || hasTerminalAlkeneContinuationCandidate(layoutGraph, coords)
  );
}

function shouldUseCleanPlacementFastPath(layoutGraph, placementStage, familySummary, policy, normalizedOptions) {
  return (
    layoutGraph._hasStereoTargets !== true &&
    normalizedOptions.existingCoords.size === 0 &&
    normalizedOptions.fixedCoords.size === 0 &&
    placementStage.coords instanceof Map &&
    CLEAN_PLACEMENT_FAST_PATH_SUPPORTED_PRIMARY_FAMILIES.has(familySummary.primaryFamily) &&
    hasOnlyCleanPlacementFastPathHooks(policy) &&
    hasCleanPlacementFastPathAudit(placementStage.audit) &&
    !hasCleanPlacementFastPathPresentationNeed(layoutGraph, placementStage.coords, placementStage, normalizedOptions.bondLength)
  );
}

function buildCleanPlacementFastPathTelemetry(placementStage, selectedGeometryCheckpointStage) {
  const stageResults = new Map([
    ['placement', placementStage],
    ['selectedGeometryCheckpoint', selectedGeometryCheckpointStage]
  ]);
  const stageExecutions = new Map([
    [
      'placement',
      createStageExecutionEntry('placement', null, {
        ran: true,
        materialized: true,
        accepted: true,
        audit: placementStage.audit ?? null
      })
    ]
  ]);

  stageExecutions.set('coreGeometryCleanup', createStageExecutionEntry('coreGeometryCleanup', null));
  stageExecutions.set(
    'selectedGeometryCheckpoint',
    createStageExecutionEntry('selectedGeometryCheckpoint', 'best', {
      ran: true,
      materialized: true,
      accepted: true,
      won: true,
      audit: selectedGeometryCheckpointStage.audit ?? null
    })
  );

  for (const [stageName, parentStage] of CLEAN_PLACEMENT_FAST_PATH_SKIPPED_STAGES) {
    if (stageExecutions.has(stageName)) {
      continue;
    }
    stageExecutions.set(stageName, createStageExecutionEntry(stageName, parentStage));
  }

  return buildCleanupTelemetry(stageExecutions, stageResults, 'placement', selectedGeometryCheckpointStage.name);
}

function buildCleanPlacementFastPathResult(layoutGraph, placementStage, includeStageTelemetry) {
  const selectedGeometryCheckpointStage = {
    name: 'selectedGeometryCheckpoint',
    coords: placementStage.coords,
    stereo: layoutGraph._emptyStereoSummary,
    audit: placementStage.audit ?? null
  };
  const cleanupTelemetry = includeStageTelemetry ? buildCleanPlacementFastPathTelemetry(placementStage, selectedGeometryCheckpointStage) : null;

  return {
    coords: placementStage.coords,
    passes: 0,
    improvement: 0,
    overlapMoves: 0,
    labelNudges: 0,
    symmetrySnaps: 0,
    junctionSnaps: 0,
    stereoReflections: 0,
    postHookNudges: 0,
    finalStageStereo: selectedGeometryCheckpointStage.stereo,
    finalStageAudit: selectedGeometryCheckpointStage.audit,
    finalStageName: selectedGeometryCheckpointStage.name,
    cleanPlacementFastPath: true,
    ...(includeStageTelemetry
      ? {
          placementAudit: placementStage.audit,
          stageTelemetry: buildStageTelemetryFromCleanupTelemetry(cleanupTelemetry),
          cleanupTelemetry
        }
      : {})
  };
}

function shouldUseLargeDirtyFallbackFastPath(layoutGraph, placementStage, familySummary, normalizedOptions) {
  const audit = placementStage?.audit ?? null;
  const heavyAtomCount = layoutGraph.traits?.heavyAtomCount ?? layoutGraph.atoms?.size ?? 0;
  return (
    normalizedOptions.existingCoords.size === 0 &&
    normalizedOptions.fixedCoords.size === 0 &&
    familySummary.primaryFamily === 'large-molecule' &&
    familySummary.mixedMode === true &&
    heavyAtomCount >= LARGE_DIRTY_FALLBACK_FAST_PATH_MIN_HEAVY_ATOMS &&
    (layoutGraph.ringSystems?.length ?? 0) >= LARGE_DIRTY_FALLBACK_FAST_PATH_MIN_RING_SYSTEMS &&
    audit?.ok !== true &&
    audit?.fallback?.mode === 'generic-scaffold' &&
    (audit.severeOverlapCount ?? 0) > 0 &&
    (audit.bondLengthFailureCount ?? 0) === 0 &&
    (audit.collapsedMacrocycleCount ?? 0) === 0 &&
    (audit.stereoContradiction ?? false) === false &&
    (audit.maxBondLengthDeviation ?? 0) <= normalizedOptions.bondLength * 0.02
  );
}

function buildLargeDirtyFallbackFastPathTelemetry(placementStage, fallbackStage) {
  const stageResults = new Map([
    ['placement', placementStage],
    ['largeDirtyFallbackFastPath', fallbackStage]
  ]);
  const stageExecutions = new Map([
    [
      'placement',
      createStageExecutionEntry('placement', null, {
        ran: true,
        materialized: true,
        accepted: true,
        audit: placementStage.audit ?? null
      })
    ],
    [
      'largeDirtyFallbackFastPath',
      createStageExecutionEntry('largeDirtyFallbackFastPath', 'placement', {
        ran: true,
        materialized: true,
        accepted: true,
        won: true,
        audit: fallbackStage.audit ?? null
      })
    ]
  ]);
  return buildCleanupTelemetry(stageExecutions, stageResults, 'placement', fallbackStage.name);
}

function buildLargeDirtyFallbackFastPathResult(layoutGraph, placementStage, includeStageTelemetry) {
  const fallbackStage = {
    name: 'largeDirtyFallbackFastPath',
    coords: placementStage.coords,
    stereo: layoutGraph._emptyStereoSummary,
    audit: placementStage.audit ?? null
  };
  const cleanupTelemetry = includeStageTelemetry ? buildLargeDirtyFallbackFastPathTelemetry(placementStage, fallbackStage) : null;

  return {
    coords: placementStage.coords,
    passes: 0,
    improvement: 0,
    overlapMoves: 0,
    labelNudges: 0,
    symmetrySnaps: 0,
    junctionSnaps: 0,
    stereoReflections: 0,
    postHookNudges: 0,
    finalStageStereo: fallbackStage.stereo,
    finalStageAudit: fallbackStage.audit,
    finalStageName: fallbackStage.name,
    largeDirtyFallbackFastPath: true,
    ...(includeStageTelemetry
      ? {
          placementAudit: placementStage.audit,
          stageTelemetry: buildStageTelemetryFromCleanupTelemetry(cleanupTelemetry),
          cleanupTelemetry
        }
      : {})
  };
}

function shouldUseDirtyGenericFinalRetouchFastPath(cleanup, familySummary, normalizedOptions) {
  const audit = cleanup?.finalStageAudit ?? null;
  return (
    normalizedOptions.existingCoords.size === 0 &&
    normalizedOptions.fixedCoords.size === 0 &&
    familySummary.primaryFamily === 'organometallic' &&
    audit?.fallback?.mode === 'generic-scaffold' &&
    (audit.severeOverlapCount ?? 0) > 0 &&
    (audit.bondLengthFailureCount ?? 0) === 0 &&
    (audit.collapsedMacrocycleCount ?? 0) === 0 &&
    (audit.stereoContradiction ?? false) === false &&
    (audit.maxBondLengthDeviation ?? 0) > normalizedOptions.bondLength * 0.25
  );
}

function shouldAttemptCleanLargeMoleculeFinalRetouchFastPath(layoutGraph, cleanup, familySummary, normalizedOptions) {
  const heavyAtomCount = layoutGraph.traits?.heavyAtomCount ?? layoutGraph.atoms?.size ?? 0;
  const audit = cleanup?.finalStageAudit ?? null;
  return (
    normalizedOptions.existingCoords.size === 0 &&
    normalizedOptions.fixedCoords.size === 0 &&
    layoutGraph.components.length <= 1 &&
    familySummary.primaryFamily === 'large-molecule' &&
    heavyAtomCount >= LARGE_CLEAN_FINAL_RETOUCH_FAST_PATH_MIN_HEAVY_ATOMS &&
    cleanup?.finalStageName === 'selectedGeometryCheckpoint' &&
    hasCleanPlacementFastPathAudit(audit) &&
    audit?.fallback?.mode == null
  );
}

function shouldConsiderSkippingDirtyLargeMoleculeThreeHeavyRetouch(layoutGraph, familySummary) {
  const heavyAtomCount = layoutGraph.traits?.heavyAtomCount ?? layoutGraph.atoms?.size ?? 0;
  return familySummary.primaryFamily === 'large-molecule' && heavyAtomCount >= LARGE_DIRTY_THREE_HEAVY_RETOUCH_SKIP_MIN_HEAVY_ATOMS;
}

function shouldSkipCleanLargeMacrocycleRingFanPolish(layoutGraph, familySummary, audit) {
  const heavyAtomCount = layoutGraph.traits?.heavyAtomCount ?? layoutGraph.atoms?.size ?? 0;
  const ringCount = layoutGraph.traits?.ringCount ?? layoutGraph.rings?.length ?? 0;
  return (
    familySummary.primaryFamily === 'macrocycle' &&
    familySummary.mixedMode === true &&
    heavyAtomCount >= CLEAN_LARGE_MACROCYCLE_RING_FAN_SKIP_MIN_HEAVY_ATOMS &&
    ringCount >= CLEAN_LARGE_MACROCYCLE_RING_FAN_SKIP_MIN_RINGS &&
    audit != null &&
    (audit.severeOverlapCount ?? 0) === 0 &&
    (audit.labelOverlapCount ?? 0) === 0 &&
    (audit.bondLengthFailureCount ?? 0) === 0 &&
    (audit.collapsedMacrocycleCount ?? 0) === 0 &&
    (audit.stereoContradiction ?? false) === false &&
    (audit.visibleHeavyBondCrossingCount ?? 0) <= 1
  );
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
      cleanupStageBudget: null,
      ...(includeStageTelemetry
        ? {
            placementAudit: null,
            stageTelemetry: createEmptyStageTelemetry(),
            cleanupTelemetry: createEmptyCleanupTelemetry()
          }
        : {})
    };
  }

  const cleanupStart = nowMs();
  const protectBondIntegrity = shouldProtectCleanupBondIntegrity(familySummary, placement);
  const cleanupMaxPasses = normalizedOptions.maxCleanupPasses;
  const placementStage = {
    name: 'placement',
    coords: placement.coords,
    audit: auditCleanupStage(layoutGraph, placement.coords, placement, normalizedOptions.bondLength)
  };
  if (shouldUseCleanPlacementFastPath(layoutGraph, placementStage, familySummary, policy, normalizedOptions)) {
    if (timingState) {
      timingState.cleanupMs = nowMs() - cleanupStart;
    }
    return buildCleanPlacementFastPathResult(layoutGraph, placementStage, includeStageTelemetry);
  }
  if (shouldUseLargeDirtyFallbackFastPath(layoutGraph, placementStage, familySummary, normalizedOptions)) {
    if (timingState) {
      timingState.cleanupMs = nowMs() - cleanupStart;
    }
    return buildLargeDirtyFallbackFastPathResult(layoutGraph, placementStage, includeStageTelemetry);
  }
  const cleanupContext = {
    layoutGraph,
    placement,
    familySummary,
    policy,
    normalizedOptions,
    cleanupMaxPasses,
    protectBondIntegrity,
    cleanupStageBudget: createCleanupStageBudget(layoutGraph, familySummary, cleanupStart),
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
  const { bestStage, geometryCheckpointStage, allStageResults, accumulatedSidecars, accumulatedStabilizationRequest, stageExecutions, stageEntries } = runStageGraph(
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
  const finalRunnerState = runStageGraph(cleanupStagePlan.finalStages, selectedGeometryCheckpointStage, cleanupContext, stereoRunnerState);
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
  const cleanupStageBudget = finalizeCleanupStageBudgetTelemetry(cleanupContext.cleanupStageBudget, nowMs());
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
    ? buildCleanupTelemetry(finalStageExecutions, finalStageResults, finalGeometryCheckpointStage.name, finalBestStage.name, finalAccumulatedStabilizationRequest, cleanupStageBudget)
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
    finalStageName: finalBestStage.name,
    cleanupStageBudget,
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
  const audit =
    cachedAudit ??
    auditLayout(layoutGraph, coords, {
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
  const mixedAttachedBlockScoring = layoutGraph._mixedAttachedBlockScoringTelemetry
    ? {
        ...layoutGraph._mixedAttachedBlockScoringTelemetry,
        bailoutReasons: { ...layoutGraph._mixedAttachedBlockScoringTelemetry.bailoutReasons }
      }
    : null;
  const cleanupStageBudget = cleanup.cleanupStageBudget ?? null;

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
      cleanupFastPath: cleanup.cleanPlacementFastPath === true || cleanup.largeDirtyFallbackFastPath === true,
      cleanupLargeDirtyFallbackFastPath: cleanup.largeDirtyFallbackFastPath === true,
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
              finalRetouchMs: timingState.finalRetouchMs,
              finalRetouchBreakdownMs: { ...timingState.finalRetouchBreakdownMs },
              labelClearanceMs: timingState.labelClearanceMs,
              stereoMs: timingState.stereoMs,
              auditMs: timingState.auditMs,
              ...(cleanupStageBudget ? { cleanupStageBudget } : {}),
              ...(mixedAttachedBlockScoring ? { mixedAttachedBlockScoring } : {})
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
  const ringAtomIdSet = layoutGraph.ringAtomIdSet ?? new Set((layoutGraph.rings ?? []).flatMap(ring => ring.atomIds));
  const hasNonRingHeavyAtoms = [...layoutGraph.atoms.values()].some(atom => atom.element !== 'H' && !ringAtomIdSet.has(atom.id));
  const exceedsLargeThreshold =
    exceedsLargeMoleculeThreshold(layoutGraph.traits, threshold, layoutGraph.components.length) || layoutGraph.components.some(component => exceedsLargeComponentThreshold(layoutGraph, component));
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
  const timeFinalRetouch = (name, fn) => timeNamedTimingBucket(timingState, 'finalRetouchMs', 'finalRetouchBreakdownMs', name, fn);
  for (const [atomId, position] of cleanup.coords) {
    coords.set(atomId, position);
  }
  const repackedCoords = repackFinalDisconnectedComponents(layoutGraph, coords, placement, policy, normalizedOptions.bondLength);
  if (onStep && layoutGraph.components.length > 1) {
    onStep('Fragment Packing', 'Multiple disconnected fragments arranged into a unified 2D layout.', cloneCoords(repackedCoords), { componentCount: layoutGraph.components.length });
  }
  const { shouldOrient, wedges: preOrientWedges } = shouldAutoOrientFinalCoords(layoutGraph, repackedCoords, normalizedOptions);
  let finalCoords = repackedCoords;
  let finalCoordsModified = false;
  let orientationApplied = false;
  let landscapeApplied = false;
  if (shouldOrient) {
    finalCoords = orientFinalCoords(repackedCoords, workingMolecule);
    finalCoordsModified = true;
    orientationApplied = true;
  }
  if (shouldEnsureLandscapeFinalCoords(normalizedOptions, policy) || shouldAutoLandscapeLargeDirtyLabelLayout(layoutGraph, normalizedOptions, policy, cleanup)) {
    const landscapeCoords = cloneCoords(finalCoords);
    landscapeApplied = ensureLandscapeOrientation(landscapeCoords, workingMolecule);
    if (landscapeApplied) {
      finalCoords = landscapeCoords;
      finalCoordsModified = true;
    }
  }
  if (finalCoordsModified) {
    const orientedRepackedCoords = repackFinalDisconnectedComponents(layoutGraph, finalCoords, placement, policy, normalizedOptions.bondLength);
    if (finalOrientationAuditCountsDoNotWorsen(layoutGraph, repackedCoords, orientedRepackedCoords, placement, normalizedOptions.bondLength)) {
      finalCoords = orientedRepackedCoords;
      if (onStep && landscapeApplied && !orientationApplied) {
        onStep('Final Orientation', 'Whole-molecule landscape leveling to keep the final layout broad and exactly aligned to its preferred horizontal frame.', cloneCoords(finalCoords), {});
      }
      if (onStep && orientationApplied) {
        onStep('Final Orientation', 'Whole-molecule rotation for optimal page orientation of ring-junction stereocenters.', cloneCoords(finalCoords), {});
      }
    } else {
      finalCoords = repackedCoords;
      finalCoordsModified = false;
      orientationApplied = false;
      landscapeApplied = false;
    }
  }
  if (cleanup.largeDirtyFallbackFastPath === true) {
    snapTinyCoordinateNoise(finalCoords);
    onStep?.('Final Result', 'Complete 2D layout with all pipeline optimizations applied.', cloneCoords(finalCoords), { stage: 'complete' });
    const canReuseFallbackAudit = layoutGraph.components.length <= 1 && finalCoordsModified === false && cleanup.finalStageAudit != null && cleanup.finalStageStereo != null;
    const { ringDependency, stereo } = canReuseFallbackAudit
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
      canReuseFallbackAudit ? cleanup.finalStageAudit : null
    );
  }
  if (shouldUseDirtyGenericFinalRetouchFastPath(cleanup, familySummary, normalizedOptions)) {
    snapTinyCoordinateNoise(finalCoords);
    onStep?.('Final Result', 'Complete 2D layout with all pipeline optimizations applied.', cloneCoords(finalCoords), { stage: 'complete', dirtyGenericFinalRetouchFastPath: true });
    const canReuseFallbackAudit = layoutGraph.components.length <= 1 && finalCoordsModified === false && cleanup.finalStageAudit != null && cleanup.finalStageStereo != null;
    const { ringDependency, stereo } = canReuseFallbackAudit
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
      canReuseFallbackAudit ? cleanup.finalStageAudit : null
    );
  }
  if (shouldAttemptCleanLargeMoleculeFinalRetouchFastPath(layoutGraph, cleanup, familySummary, normalizedOptions)) {
    const canReuseFinalStageStereo = finalCoordsModified === false && cleanup.finalStageAudit != null && cleanup.finalStageStereo != null;
    const { ringDependency, stereo } = canReuseFinalStageStereo
      ? {
          ringDependency: getRingDependencySummary(workingMolecule, layoutGraph),
          stereo: cleanup.finalStageStereo
        }
      : runStereoPhase(workingMolecule, layoutGraph, finalCoords, timingState, finalCoordsModified ? null : preOrientWedges);
    const audit = canReuseFinalStageStereo
      ? cleanup.finalStageAudit
      : auditLayout(layoutGraph, finalCoords, {
          bondLength: normalizedOptions.bondLength,
          bondValidationClasses: placement.bondValidationClasses,
          stereo
        });
    if (hasCleanPlacementFastPathAudit(audit) && audit?.fallback?.mode == null) {
      snapTinyCoordinateNoise(finalCoords);
      onStep?.('Final Result', 'Complete 2D layout with all pipeline optimizations applied.', cloneCoords(finalCoords), {
        stage: 'complete',
        cleanLargeMoleculeFinalRetouchFastPath: true
      });
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
        audit
      );
    }
  }
  if (cleanup.finalStageName === 'selectedGeometryCheckpoint') {
    const finalDivalentContinuationRetouch = timeFinalRetouch('finalDivalentContinuationRetouch', () =>
      maybeRetouchFinalDivalentContinuations(layoutGraph, finalCoords, placement, familySummary, normalizedOptions.bondLength, onStep)
    );
    if (finalDivalentContinuationRetouch.changed) {
      finalCoords = finalDivalentContinuationRetouch.coords;
      finalCoordsModified = true;
    }
  }
  const ringChainLinearRetouch = timeFinalRetouch('ringChainLinearRetouch', () =>
    runRingChainLinearRetouch(layoutGraph, finalCoords, {
      bondLength: normalizedOptions.bondLength,
      bondValidationClasses: placement.bondValidationClasses
    })
  );
  if (ringChainLinearRetouch.changed) {
    finalCoords = ringChainLinearRetouch.coords;
    finalCoordsModified = true;
    onStep?.('Ring Chain Linear Retouch', 'Path-like isolated ring systems straightened into a left-to-right chain.', cloneCoords(finalCoords), {
      movedAtomCount: ringChainLinearRetouch.movedAtomIds.length,
      linearityScore: ringChainLinearRetouch.linearityScore
    });
  }
  const ringChainHypervalentRetouch = timeFinalRetouch('ringChainHypervalentRetouch', () =>
    runRingChainHypervalentBranchRetouch(layoutGraph, finalCoords, {
      bondLength: normalizedOptions.bondLength,
      bondValidationClasses: placement.bondValidationClasses
    })
  );
  if (ringChainHypervalentRetouch.changed) {
    finalCoords = ringChainHypervalentRetouch.coords;
    finalCoordsModified = true;
    onStep?.('Ring Chain Hypervalent Retouch', 'Small hypervalent side branches rotated away from path-like isolated ring chain crossings.', cloneCoords(finalCoords), {
      movedAtomCount: ringChainHypervalentRetouch.movedAtomIds.length
    });
  }
  const terminalChainRetouch = timeFinalRetouch('terminalChainRetouch', () =>
    runTerminalAcyclicChainRetouch(layoutGraph, finalCoords, {
      bondLength: normalizedOptions.bondLength,
      bondValidationClasses: placement.bondValidationClasses
    })
  );
  if (terminalChainRetouch.changed) {
    finalCoords = terminalChainRetouch.coords;
    finalCoordsModified = true;
    onStep?.('Terminal Chain Retouch', 'Long terminal acyclic chain rerouted away from the path-like isolated ring chain.', cloneCoords(finalCoords), {
      movedAtomCount: terminalChainRetouch.movedAtomIds.length
    });
  }
  const projectedRingChainRetouch = timeFinalRetouch('projectedRingChainRetouch', () => maybeRetouchProjectedRingChain(layoutGraph, finalCoords, placement, normalizedOptions.bondLength, onStep));
  if (projectedRingChainRetouch.changed) {
    finalCoords = projectedRingChainRetouch.coords;
    finalCoordsModified = true;
  }
  const pathRingChainOrientation = timeFinalRetouch('pathRingChainOrientation', () => orientPathLikeRingChainCoords(layoutGraph, finalCoords));
  if (pathRingChainOrientation.changed) {
    finalCoords = pathRingChainOrientation.coords;
    finalCoordsModified = true;
    onStep?.('Ring Chain Orientation', 'Path-like isolated ring chain rotated so terminal ring systems read left-to-right.', cloneCoords(finalCoords), {});
  }
  let largeMoleculeResidualChanged = false;
  if (placement.placedFamilies.includes('large-molecule') || familySummary.primaryFamily === 'large-molecule') {
    const largeMoleculeResidualRetouch = timeFinalRetouch('largeMoleculeResidualRetouch', () =>
      runLargeMoleculeResidualRetouch(layoutGraph, finalCoords, {
        bondLength: normalizedOptions.bondLength
      })
    );
    if (largeMoleculeResidualRetouch.changed) {
      finalCoords = largeMoleculeResidualRetouch.coords;
      finalCoordsModified = true;
      largeMoleculeResidualChanged = true;
      onStep?.('Large Molecule Residual Retouch', 'Local branches rotated away from remaining large-molecule overlap, crossing, and angle residuals.', cloneCoords(finalCoords), {
        movedAtomCount: largeMoleculeResidualRetouch.movedAtomIds.length,
        angleReliefPasses: largeMoleculeResidualRetouch.angleReliefPasses,
        finalAnglePolishPasses: largeMoleculeResidualRetouch.finalAnglePolishPasses,
        severeOverlapCountBefore: largeMoleculeResidualRetouch.severeOverlapCountBefore,
        severeOverlapCountAfter: largeMoleculeResidualRetouch.severeOverlapCountAfter,
        visibleHeavyBondCrossingCountBefore: largeMoleculeResidualRetouch.visibleHeavyBondCrossingCountBefore,
        visibleHeavyBondCrossingCountAfter: largeMoleculeResidualRetouch.visibleHeavyBondCrossingCountAfter
      });
    }
  }
  if (largeMoleculeResidualChanged) {
    const restoredProjectedRingChainRetouch = maybeRetouchProjectedRingChain(layoutGraph, finalCoords, placement, normalizedOptions.bondLength, onStep);
    if (restoredProjectedRingChainRetouch.changed) {
      finalCoords = restoredProjectedRingChainRetouch.coords;
      finalCoordsModified = true;
    }
  }
  const macrocycleRingFanAudit =
    familySummary.primaryFamily === 'macrocycle' && familySummary.mixedMode
      ? auditLayout(layoutGraph, finalCoords, {
          bondLength: normalizedOptions.bondLength,
          bondValidationClasses: placement.bondValidationClasses
        })
      : null;
  const macrocycleRingFanHasHardResiduals =
    (macrocycleRingFanAudit?.severeOverlapCount ?? 0) > 0 && (macrocycleRingFanAudit?.visibleHeavyBondCrossingCount ?? 0) > 0;
  const shouldSkipHardDirtyLargeMacrocycleRingFanPolish =
    macrocycleRingFanHasHardResiduals && (layoutGraph.traits.heavyAtomCount ?? 0) >= 150 && (layoutGraph.traits.ringCount ?? 0) >= 8;
  const shouldSkipCleanLargeMacrocycleRingFanPolishForTimeout =
    shouldSkipCleanLargeMacrocycleRingFanPolish(layoutGraph, familySummary, macrocycleRingFanAudit);
  const shouldRunMacrocycleRingFanAngleRetouch =
    familySummary.primaryFamily === 'macrocycle' &&
    familySummary.mixedMode &&
    !shouldSkipHardDirtyLargeMacrocycleRingFanPolish &&
    !shouldSkipCleanLargeMacrocycleRingFanPolishForTimeout &&
    (layoutGraph.traits.ringCount ?? 0) >= 6 &&
    (((layoutGraph.traits.heavyAtomCount ?? 0) >= 100 && (layoutGraph.traits.ringCount ?? 0) >= 8) || (macrocycleRingFanAudit?.severeOverlapCount ?? 0) > 0);
  if (shouldRunMacrocycleRingFanAngleRetouch) {
    const macrocycleRingFanAngleRetouch = timeFinalRetouch('macrocycleRingFanAngleRetouch', () =>
      runMacrocycleRingFanAngleRetouch(layoutGraph, finalCoords, {
        bondLength: normalizedOptions.bondLength,
        bondValidationClasses: placement.bondValidationClasses
      })
    );
    if (macrocycleRingFanAngleRetouch.changed) {
      finalCoords = macrocycleRingFanAngleRetouch.coords;
      finalCoordsModified = true;
      onStep?.('Macrocycle Ring Fan Angle Retouch', 'Tiny ring-atom nudges reduce distorted macrocycle junction fans while preserving final audit quality.', cloneCoords(finalCoords), {
        movedAtomCount: macrocycleRingFanAngleRetouch.movedAtomIds.length,
        passes: macrocycleRingFanAngleRetouch.passes,
        maxDeviationBefore: macrocycleRingFanAngleRetouch.maxDeviationBefore,
        maxDeviationAfter: macrocycleRingFanAngleRetouch.maxDeviationAfter
      });

      const attachedRingAfterFanRetouch = timeFinalRetouch('macrocycleAttachedRingRetouch', () =>
        runAttachedRingRotationTouchup(layoutGraph, finalCoords, {
          bondLength: normalizedOptions.bondLength,
          bondValidationClasses: placement.bondValidationClasses,
          maxHeavyAtomCount: 90,
          maxPasses: 2
        })
      );
      if ((attachedRingAfterFanRetouch.nudges ?? 0) > 0) {
        const currentAudit = auditFinalRetouchCoords(workingMolecule, layoutGraph, finalCoords, placement, normalizedOptions.bondLength);
        const candidateAudit = auditFinalRetouchCoords(workingMolecule, layoutGraph, attachedRingAfterFanRetouch.coords, placement, normalizedOptions.bondLength);
        if (
          (candidateAudit.bondLengthFailureCount ?? 0) <= (currentAudit.bondLengthFailureCount ?? 0) &&
          (candidateAudit.mildBondLengthFailureCount ?? 0) <= (currentAudit.mildBondLengthFailureCount ?? 0) &&
          (candidateAudit.severeBondLengthFailureCount ?? 0) <= (currentAudit.severeBondLengthFailureCount ?? 0) &&
          (candidateAudit.severeOverlapCount ?? 0) <= (currentAudit.severeOverlapCount ?? 0) &&
          (candidateAudit.visibleHeavyBondCrossingCount ?? 0) <= (currentAudit.visibleHeavyBondCrossingCount ?? 0) &&
          (candidateAudit.ringSubstituentReadabilityFailureCount ?? 0) <= (currentAudit.ringSubstituentReadabilityFailureCount ?? 0) &&
          (candidateAudit.labelOverlapCount ?? 0) <= (currentAudit.labelOverlapCount ?? 0) + 1 &&
          !((candidateAudit.stereoContradiction ?? false) && !(currentAudit.stereoContradiction ?? false))
        ) {
          finalCoords = attachedRingAfterFanRetouch.coords;
          finalCoordsModified = true;
          onStep?.('Macrocycle Attached Ring Retouch', 'Attached ring subtree rotated after macrocycle fan polish to clear residual severe overlap.', cloneCoords(finalCoords), {
            nudges: attachedRingAfterFanRetouch.nudges,
            severeOverlapCountBefore: currentAudit.severeOverlapCount,
            severeOverlapCountAfter: candidateAudit.severeOverlapCount
          });
        }
      }
    }
  }
  if (familySummary.primaryFamily === 'organometallic') {
    const organometallicAromaticRingRetouch = timeFinalRetouch('organometallicAromaticRingRetouch', () =>
      runOrganometallicAromaticRingRetouch(layoutGraph, finalCoords, {
        bondLength: normalizedOptions.bondLength,
        bondValidationClasses: placement.bondValidationClasses
      })
    );
    if (organometallicAromaticRingRetouch.changed) {
      finalCoords = organometallicAromaticRingRetouch.coords;
      finalCoordsModified = true;
      onStep?.('Organometallic Aromatic Ring Retouch', 'Coordinate-bound aromatic ligand rings regularized while preserving their bidentate linker pose.', cloneCoords(finalCoords), {
        movedAtomCount: organometallicAromaticRingRetouch.movedAtomIds.length,
        maxDeviationBefore: organometallicAromaticRingRetouch.maxDeviationBefore,
        maxDeviationAfter: organometallicAromaticRingRetouch.maxDeviationAfter
      });
    }
  }
  const dirtyUltraLargeFinalPresentationAudit =
    familySummary.primaryFamily === 'large-molecule' && (layoutGraph.traits?.heavyAtomCount ?? layoutGraph.atoms?.size ?? 0) >= 400
      ? timeFinalRetouch('dirtyUltraLargeFinalPresentationAudit', () =>
          auditLayout(layoutGraph, finalCoords, {
            bondLength: normalizedOptions.bondLength,
            bondValidationClasses: placement.bondValidationClasses
          })
        )
      : null;
  const skipDirtyUltraLargeFinalPresentationRetouches = shouldSkipDirtyUltraLargeFinalPresentationRetouches(layoutGraph, familySummary, dirtyUltraLargeFinalPresentationAudit);
  if (!skipDirtyUltraLargeFinalPresentationRetouches) {
    const finalHypervalentRetouch = timeFinalRetouch('finalHypervalentRetouch', () => maybeRetouchFinalHypervalentAngles(layoutGraph, finalCoords, placement, normalizedOptions.bondLength, onStep));
    if (finalHypervalentRetouch.changed) {
      finalCoords = finalHypervalentRetouch.coords;
      finalCoordsModified = true;
    }
    if (familySummary.primaryFamily === 'large-molecule') {
      const largePhosphateLinkerContinuationRetouch = timeFinalRetouch('largePhosphateLinkerContinuationRetouch', () =>
        runLargePhosphateLinkerContinuationTidy(layoutGraph, finalCoords, {
          bondLength: normalizedOptions.bondLength,
          bondValidationClasses: placement.bondValidationClasses,
          frozenAtomIds: placement.frozenAtomIds
        })
      );
      if (largePhosphateLinkerContinuationRetouch.changed) {
        finalCoords = largePhosphateLinkerContinuationRetouch.coords;
        finalCoordsModified = true;
        onStep?.('Large Phosphate Linker Continuation Retouch', 'Phosphate ester P-O-C linkers softly rotated toward exact continuation while preserving clean final audit counts.', cloneCoords(finalCoords), {
          nudges: largePhosphateLinkerContinuationRetouch.nudges,
          movedAtomCount: largePhosphateLinkerContinuationRetouch.movedAtomIds.length,
          totalDeviationBefore: largePhosphateLinkerContinuationRetouch.totalDeviationBefore,
          totalDeviationAfter: largePhosphateLinkerContinuationRetouch.totalDeviationAfter,
          maxDeviationBefore: largePhosphateLinkerContinuationRetouch.maxDeviationBefore,
          maxDeviationAfter: largePhosphateLinkerContinuationRetouch.maxDeviationAfter
        });
      }
      const largeAcyclicEtherLinkerContinuationRetouch = timeFinalRetouch('largeAcyclicEtherLinkerContinuationRetouch', () =>
        runLargeAcyclicEtherLinkerContinuationTidy(layoutGraph, finalCoords, {
          bondLength: normalizedOptions.bondLength,
          bondValidationClasses: placement.bondValidationClasses,
          frozenAtomIds: placement.frozenAtomIds
        })
      );
      if (largeAcyclicEtherLinkerContinuationRetouch.changed) {
        finalCoords = largeAcyclicEtherLinkerContinuationRetouch.coords;
        finalCoordsModified = true;
        onStep?.('Large Acyclic Ether Linker Continuation Retouch', 'Large non-aromatic ether exits softly rotated toward exact continuation while preserving clean final audit counts.', cloneCoords(finalCoords), {
          nudges: largeAcyclicEtherLinkerContinuationRetouch.nudges,
          movedAtomCount: largeAcyclicEtherLinkerContinuationRetouch.movedAtomIds.length,
          totalDeviationBefore: largeAcyclicEtherLinkerContinuationRetouch.totalDeviationBefore,
          totalDeviationAfter: largeAcyclicEtherLinkerContinuationRetouch.totalDeviationAfter,
          maxDeviationBefore: largeAcyclicEtherLinkerContinuationRetouch.maxDeviationBefore,
          maxDeviationAfter: largeAcyclicEtherLinkerContinuationRetouch.maxDeviationAfter
        });
      }
    }
  }
  const stretchedTerminalMultipleBondSnap = timeFinalRetouch('stretchedTerminalMultipleBondSnap', () =>
    maybeSnapStretchedTerminalMultipleBondLeaves(layoutGraph, finalCoords, placement, normalizedOptions.bondLength)
  );
  if (stretchedTerminalMultipleBondSnap.changed) {
    finalCoords = stretchedTerminalMultipleBondSnap.coords;
    finalCoordsModified = true;
  }
  const crossingTerminalMultipleBondRetouch = timeFinalRetouch('crossingTerminalMultipleBondRetouch', () =>
    maybeRepositionCrossingTerminalMultipleBondLeaves(layoutGraph, finalCoords, placement, normalizedOptions.bondLength)
  );
  if (crossingTerminalMultipleBondRetouch.changed) {
    finalCoords = crossingTerminalMultipleBondRetouch.coords;
    finalCoordsModified = true;
  }
  if (!skipDirtyUltraLargeFinalPresentationRetouches) {
    const finalTerminalMultipleBondFanRetouch = timeFinalRetouch('finalTerminalMultipleBondFanRetouch', () =>
      maybeRetouchFinalTerminalMultipleBondLeafFans(layoutGraph, finalCoords, placement, normalizedOptions.bondLength)
    );
    if (finalTerminalMultipleBondFanRetouch.changed) {
      finalCoords = finalTerminalMultipleBondFanRetouch.coords;
      finalCoordsModified = true;
      onStep?.('Final Terminal Multiple-Bond Fan Retouch', 'Residual terminal multiple-bond fans snapped back to trigonal slots after late macrocycle retouches.', cloneCoords(finalCoords), {
        nudges: finalTerminalMultipleBondFanRetouch.nudges,
        maxDeviationBefore: finalTerminalMultipleBondFanRetouch.maxDeviationBefore,
        maxDeviationAfter: finalTerminalMultipleBondFanRetouch.maxDeviationAfter
      });
    }
  }
  const finalTerminalCarbonLeafContactRetouch = timeFinalRetouch('finalTerminalCarbonLeafContactRetouch', () =>
    maybeRetouchFinalTerminalCarbonLeafSevereContacts(layoutGraph, finalCoords, placement, normalizedOptions.bondLength)
  );
  if (finalTerminalCarbonLeafContactRetouch.changed) {
    const currentAudit = auditLayout(layoutGraph, finalCoords, {
      bondLength: normalizedOptions.bondLength,
      bondValidationClasses: placement.bondValidationClasses
    });
    finalCoords = finalTerminalCarbonLeafContactRetouch.coords;
    finalCoordsModified = true;
    onStep?.('Final Terminal Leaf Retouch', 'Terminal carbon and halogen leaves rotated out of residual severe contacts and crossings without moving ring atoms.', cloneCoords(finalCoords), {
      movedAtomCount: finalTerminalCarbonLeafContactRetouch.movedAtomIds.length,
      severeOverlapCountBefore: currentAudit.severeOverlapCount,
      severeOverlapCountAfter: finalTerminalCarbonLeafContactRetouch.audit?.severeOverlapCount ?? null,
      visibleHeavyBondCrossingCountBefore: currentAudit.visibleHeavyBondCrossingCount,
      visibleHeavyBondCrossingCountAfter: finalTerminalCarbonLeafContactRetouch.audit?.visibleHeavyBondCrossingCount ?? null
    });
  }
  let skipFinalThreeHeavyContinuationRetouch = false;
  if (shouldConsiderSkippingDirtyLargeMoleculeThreeHeavyRetouch(layoutGraph, familySummary)) {
    const currentAudit = timeFinalRetouch('finalThreeHeavyDirtyAudit', () =>
      auditLayout(layoutGraph, finalCoords, {
        bondLength: normalizedOptions.bondLength,
        bondValidationClasses: placement.bondValidationClasses
      })
    );
    skipFinalThreeHeavyContinuationRetouch = (currentAudit.severeOverlapCount ?? 0) > 0 || (currentAudit.visibleHeavyBondCrossingCount ?? 0) > 0;
  }
  if (!skipFinalThreeHeavyContinuationRetouch) {
    const finalThreeHeavyContinuationRetouch = timeFinalRetouch('finalThreeHeavyContinuationRetouch', () => {
      return maybeRetouchFinalThreeHeavyContinuationFans(workingMolecule, layoutGraph, finalCoords, placement, normalizedOptions.bondLength);
    });
    if (finalThreeHeavyContinuationRetouch.changed) {
      finalCoords = finalThreeHeavyContinuationRetouch.coords;
      finalCoordsModified = true;
      onStep?.('Final Three-Heavy Fan Retouch', 'Suppressed-hydrogen three-heavy centers restored to exact trigonal presentation after late cleanup.', cloneCoords(finalCoords), {
        movedAtomCount: finalThreeHeavyContinuationRetouch.movedAtomIds.length,
        maxDeviationBefore: finalThreeHeavyContinuationRetouch.maxDeviationBefore,
        maxDeviationAfter: finalThreeHeavyContinuationRetouch.maxDeviationAfter
      });
    }
  }
  const finalSmallRingSnap = timeFinalRetouch('finalSmallRingSnap', () => {
    return maybeSnapFinalSmallFourRings(workingMolecule, layoutGraph, finalCoords, placement, normalizedOptions.bondLength);
  });
  if (finalSmallRingSnap.changed) {
    finalCoords = finalSmallRingSnap.coords;
    finalCoordsModified = true;
    onStep?.('Final Small-Ring Snap', 'Near-regular four-membered rings snapped back to exact square presentation after cleanup.', cloneCoords(finalCoords), {
      snappedRingCount: finalSmallRingSnap.snappedRingCount
    });
  }
  if (familySummary.mixedMode === true) {
    timeFinalRetouch('mixedFinalBranchRetouches', () => {
      const currentAudit = auditLayout(layoutGraph, finalCoords, {
        bondLength: normalizedOptions.bondLength,
        bondValidationClasses: placement.bondValidationClasses
      });
      if (hasAuditCleanMixedFinalBranchState(currentAudit)) {
        return;
      }
      if ((currentAudit.severeOverlapCount ?? 0) > 0 || (currentAudit.visibleHeavyBondCrossingCount ?? 0) > 0) {
        const candidateCoords = cloneCoords(finalCoords);
        const mixedAcylBranchContactRetouch = resolveMixedAcylBranchSevereContacts(layoutGraph, candidateCoords, placement.bondValidationClasses, normalizedOptions.bondLength, {
          allowRelaxedAcylFan: true
        });
        if (mixedAcylBranchContactRetouch.changed) {
          const candidateAudit = auditLayout(layoutGraph, candidateCoords, {
            bondLength: normalizedOptions.bondLength,
            bondValidationClasses: placement.bondValidationClasses
          });
          if (finalAuditCountsDoNotWorsen(candidateAudit, currentAudit)) {
            finalCoords = candidateCoords;
            finalCoordsModified = true;
            onStep?.(
              'Final Mixed Acyl Branch Retouch',
              'Residual mixed acyl branches retouched after final cleanup to clear bond crossings while leaving ring systems fixed.',
              cloneCoords(finalCoords),
              {
                severeOverlapCountBefore: currentAudit.severeOverlapCount,
                severeOverlapCountAfter: candidateAudit.severeOverlapCount,
                visibleHeavyBondCrossingCountBefore: currentAudit.visibleHeavyBondCrossingCount,
                visibleHeavyBondCrossingCountAfter: candidateAudit.visibleHeavyBondCrossingCount
              }
            );
          }
        }
      }
      let postAcylAudit = auditLayout(layoutGraph, finalCoords, {
        bondLength: normalizedOptions.bondLength,
        bondValidationClasses: placement.bondValidationClasses
      });
      if ((postAcylAudit.ringSubstituentReadabilityFailureCount ?? 0) > 0) {
        const candidateCoords = cloneCoords(finalCoords);
        const boundedRingSubstituentRetouch = resolveRingSubstituentBoundedReadability(layoutGraph, candidateCoords, placement.bondValidationClasses, normalizedOptions.bondLength);
        if (boundedRingSubstituentRetouch.changed) {
          const candidateAudit = auditLayout(layoutGraph, candidateCoords, {
            bondLength: normalizedOptions.bondLength,
            bondValidationClasses: placement.bondValidationClasses
          });
          if (finalAuditCountsDoNotWorsen(candidateAudit, postAcylAudit)) {
            finalCoords = candidateCoords;
            finalCoordsModified = true;
            onStep?.(
              'Final Ring Substituent Readability Retouch',
              'Bounded ring substituent exits nudged toward exterior axes after final cleanup without reopening contacts.',
              cloneCoords(finalCoords),
              {
                ringSubstituentReadabilityFailureCountBefore: postAcylAudit.ringSubstituentReadabilityFailureCount,
                ringSubstituentReadabilityFailureCountAfter: candidateAudit.ringSubstituentReadabilityFailureCount,
                labelOverlapCountBefore: postAcylAudit.labelOverlapCount,
                labelOverlapCountAfter: candidateAudit.labelOverlapCount
              }
            );
            postAcylAudit = candidateAudit;
          }
        }
      }
      if ((postAcylAudit.visibleHeavyBondCrossingCount ?? 0) > 0 || (postAcylAudit.ringSubstituentReadabilityFailureCount ?? 0) > 0 || (postAcylAudit.inwardRingSubstituentCount ?? 0) > 0) {
        const candidateCoords = cloneCoords(finalCoords);
        const ringSubstituentBranchRetouch = resolveRingSubstituentBranchCrossings(layoutGraph, candidateCoords, placement.bondValidationClasses, normalizedOptions.bondLength);
        if (ringSubstituentBranchRetouch.changed) {
          const candidateAudit = auditLayout(layoutGraph, candidateCoords, {
            bondLength: normalizedOptions.bondLength,
            bondValidationClasses: placement.bondValidationClasses
          });
          if (finalAuditCountsDoNotWorsen(candidateAudit, postAcylAudit)) {
            finalCoords = candidateCoords;
            finalCoordsModified = true;
            postAcylAudit = candidateAudit;
            onStep?.(
              'Final Ring Substituent Branch Retouch',
              'Small ring substituent branches rotated after final cleanup to clear residual inward exits while preserving ring geometry.',
              cloneCoords(finalCoords),
              {
                visibleHeavyBondCrossingCountBefore: postAcylAudit.visibleHeavyBondCrossingCount,
                visibleHeavyBondCrossingCountAfter: candidateAudit.visibleHeavyBondCrossingCount,
                ringSubstituentReadabilityFailureCountBefore: postAcylAudit.ringSubstituentReadabilityFailureCount,
                ringSubstituentReadabilityFailureCountAfter: candidateAudit.ringSubstituentReadabilityFailureCount
              }
            );
          }
        }
      }
      if (
        (postAcylAudit.severeOverlapCount ?? 0) === 0 &&
        (postAcylAudit.visibleHeavyBondCrossingCount ?? 0) === 0 &&
        (postAcylAudit.labelOverlapCount ?? 0) === 0 &&
        (postAcylAudit.bondLengthFailureCount ?? 0) === 0 &&
        (postAcylAudit.ringSubstituentReadabilityFailureCount ?? 0) > 0
      ) {
        const candidateCoords = cloneCoords(finalCoords);
        const boundedRingSubstituentRetouch = resolveRingSubstituentBoundedReadability(layoutGraph, candidateCoords, placement.bondValidationClasses, normalizedOptions.bondLength);
        if (boundedRingSubstituentRetouch.changed) {
          const candidateAudit = auditLayout(layoutGraph, candidateCoords, {
            bondLength: normalizedOptions.bondLength,
            bondValidationClasses: placement.bondValidationClasses
          });
          if (finalAuditCountsDoNotWorsen(candidateAudit, postAcylAudit)) {
            finalCoords = candidateCoords;
            finalCoordsModified = true;
            onStep?.(
              'Final Ring Substituent Readability Retouch',
              'Bounded ring substituent exits nudged toward exterior axes after final branch retouch without reopening contacts.',
              cloneCoords(finalCoords),
              {
                ringSubstituentReadabilityFailureCountBefore: postAcylAudit.ringSubstituentReadabilityFailureCount,
                ringSubstituentReadabilityFailureCountAfter: candidateAudit.ringSubstituentReadabilityFailureCount,
                labelOverlapCountBefore: postAcylAudit.labelOverlapCount,
                labelOverlapCountAfter: candidateAudit.labelOverlapCount
              }
            );
          }
        }
      }
    });
  }
  if (shouldEnsureLandscapeFinalCoords(normalizedOptions, policy) && shouldReapplyLandscapeAfterFinalRetouches(layoutGraph, finalCoords)) {
    const landscapeCoords = cloneCoords(finalCoords);
    const landscapeApplied = ensureLandscapeOrientation(landscapeCoords, workingMolecule);
    if (landscapeApplied && finalOrientationAuditCountsDoNotWorsen(layoutGraph, finalCoords, landscapeCoords, placement, normalizedOptions.bondLength)) {
      finalCoords = landscapeCoords;
      finalCoordsModified = true;
      onStep?.('Final Landscape Orientation', 'Whole-molecule landscape leveling reapplied after final presentation retouches.', cloneCoords(finalCoords), {});
    }
  }
  const finalLabelClearance = timeFinalRetouch('finalLabelClearance', () =>
    maybeApplyGuardedFinalLabelClearance(workingMolecule, layoutGraph, finalCoords, placement, normalizedOptions.bondLength, normalizedOptions.labelMetrics)
  );
  if (finalLabelClearance.changed) {
    finalCoords = finalLabelClearance.coords;
    finalCoordsModified = true;
    onStep?.('Final Label Clearance', 'Residual terminal labels rotated after final retouches while preserving audited layout quality.', cloneCoords(finalCoords), {
      nudges: finalLabelClearance.nudges,
      labelOverlapCountBefore: finalLabelClearance.currentAudit.labelOverlapCount,
      labelOverlapCountAfter: finalLabelClearance.candidateAudit?.labelOverlapCount ?? null
    });
  }
  const finalConnectorLabelClearance = timeFinalRetouch('finalConnectorLabelClearance', () =>
    maybeApplyGuardedConnectorLabelClearance(workingMolecule, layoutGraph, finalCoords, placement, normalizedOptions.bondLength, normalizedOptions.labelMetrics)
  );
  if (finalConnectorLabelClearance.changed) {
    finalCoords = finalConnectorLabelClearance.coords;
    finalCoordsModified = true;
    onStep?.('Final Connector Label Clearance', 'Residual connector labels rotated as bounded subtrees while preserving audited layout quality.', cloneCoords(finalCoords), {
      rotations: finalConnectorLabelClearance.rotations,
      movedAtomCount: finalConnectorLabelClearance.movedAtomCount,
      labelOverlapCountBefore: finalConnectorLabelClearance.currentAudit.labelOverlapCount,
      labelOverlapCountAfter: finalConnectorLabelClearance.candidateAudit?.labelOverlapCount ?? null
    });
  }
  const finalTerminalLabelLeafClearance = timeFinalRetouch('finalTerminalLabelLeafClearance', () =>
    maybeApplyGuardedTerminalLabelLeafClearance(workingMolecule, layoutGraph, finalCoords, placement, normalizedOptions.bondLength, normalizedOptions.labelMetrics)
  );
  if (finalTerminalLabelLeafClearance.changed) {
    finalCoords = finalTerminalLabelLeafClearance.coords;
    finalCoordsModified = true;
    onStep?.('Final Terminal Label Leaf Clearance', 'Residual terminal label leaves rotated around their heavy anchor while preserving audited layout quality.', cloneCoords(finalCoords), {
      rotations: finalTerminalLabelLeafClearance.rotations,
      movedAtomCount: finalTerminalLabelLeafClearance.movedAtomCount,
      labelOverlapCountBefore: finalTerminalLabelLeafClearance.currentAudit.labelOverlapCount,
      labelOverlapCountAfter: finalTerminalLabelLeafClearance.candidateAudit?.labelOverlapCount ?? null
    });
  }
  if (familySummary.primaryFamily === 'acyclic') {
    timeFinalRetouch('acyclicFinalAcylBranchRetouch', () => {
      const currentAudit = auditLayout(layoutGraph, finalCoords, {
        bondLength: normalizedOptions.bondLength,
        bondValidationClasses: placement.bondValidationClasses
      });
      if ((currentAudit.severeOverlapCount ?? 0) > 0 || (currentAudit.visibleHeavyBondCrossingCount ?? 0) > 0) {
        const candidateCoords = cloneCoords(finalCoords);
        const acyclicAcylBranchContactRetouch = resolveMixedAcylBranchSevereContacts(layoutGraph, candidateCoords, placement.bondValidationClasses, normalizedOptions.bondLength, {
          allowRelaxedAcylFan: true
        });
        if (acyclicAcylBranchContactRetouch.changed) {
          const candidateAudit = auditLayout(layoutGraph, candidateCoords, {
            bondLength: normalizedOptions.bondLength,
            bondValidationClasses: placement.bondValidationClasses
          });
          if (finalAuditCountsDoNotWorsen(candidateAudit, currentAudit)) {
            finalCoords = candidateCoords;
            finalCoordsModified = true;
            onStep?.(
              'Final Acyclic Acyl Branch Retouch',
              'Residual acyclic acyl and carboxyl branches retouched after final label clearance to clear contacts and crossings.',
              cloneCoords(finalCoords),
              {
                severeOverlapCountBefore: currentAudit.severeOverlapCount,
                severeOverlapCountAfter: candidateAudit.severeOverlapCount,
                visibleHeavyBondCrossingCountBefore: currentAudit.visibleHeavyBondCrossingCount,
                visibleHeavyBondCrossingCountAfter: candidateAudit.visibleHeavyBondCrossingCount
              }
            );
          }
        }
      }
    });
  }
  const finalStereoRescue = timeFinalRetouch('finalStereoRescue', () =>
    maybeApplyFinalStereoRescue(workingMolecule, layoutGraph, finalCoords, placement, normalizedOptions.bondLength)
  );
  if (finalStereoRescue.changed) {
    finalCoords = finalStereoRescue.coords;
    finalCoordsModified = true;
    onStep?.('Final EZ Stereo Rescue', 'Late retouches rechecked against annotated E/Z geometry and corrected when audit counts stayed bounded.', cloneCoords(finalCoords), {
      reflections: finalStereoRescue.reflections,
      ezViolationCountBefore: finalStereoRescue.currentStereo?.ezViolationCount ?? null,
      ezViolationCountAfter: finalStereoRescue.candidateStereo?.ezViolationCount ?? null
    });
  }
  snapTinyCoordinateNoise(finalCoords);
  onStep?.('Final Result', 'Complete 2D layout with all pipeline optimizations applied.', cloneCoords(finalCoords), { stage: 'complete' });
  const canReuseFinalStageStereo = layoutGraph.components.length <= 1 && finalCoordsModified === false && cleanup.finalStageAudit != null && cleanup.finalStageStereo != null;
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
