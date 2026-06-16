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
import {
  runOrganometallicAromaticRingRetouch,
  runOrganometallicCoordinateLigandOutwardRetouch,
  runOrganometallicMetalBranchFanRetouch,
  runOrganometallicRingAtomOverlapRetouch,
  runOrganometallicRingSidechainFanRetouch
} from './cleanup/presentation/organometallic-aromatic-ring-retouch.js';
import { runRingChainLinearRetouch } from './cleanup/presentation/ring-chain-linear-retouch.js';
import { runRingChainHypervalentBranchRetouch } from './cleanup/presentation/ring-chain-hypervalent-retouch.js';
import { runRingChainSideBranchExitRetouch, runRingChainUnitProjectionRetouch } from './cleanup/presentation/ring-chain-unit-projection-retouch.js';
import { runLargeMoleculeResidualRetouch, runMacrocycleRingFanAngleRetouch } from './cleanup/presentation/large-molecule-residual-retouch.js';
import { runAttachedRingRotationTouchup, runTerminalCarbonRingLeafIntrusionRetidy } from './cleanup/presentation/attached-ring-fallback.js';
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
import { runSiloxaneArylBranchClearance } from './cleanup/presentation/projected-tetrahedral-clearance.js';
import { auditLayout } from './audit/audit.js';
import {
  collectSevereOverlapAtomIds,
  collectReadableRingSubstituentChildren,
  countVisibleHeavyBondCrossings,
  findSevereOverlaps,
  findSevereOverlapsMatching,
  findVisibleHeavyBondCrossings,
  hasSevereOverlaps,
  measureDivalentContinuationDistortion,
  measureLabelOverlap,
  measureThreeHeavyContinuationDistortion,
  measureTrigonalDistortion
} from './audit/invariants.js';
import { collectLabelBoxes, findLabelOverlaps, labelBoxesOverlap, summarizeLabelOverlaps } from './geometry/label-box.js';
import { auditCleanupStage, measureCleanupStagePresentationPenalty } from './audit/stage-metrics.js';
import { createQualityReport } from './model/quality-report.js';
import { computeIncidentRingOutwardAngles } from './geometry/ring-direction.js';
import { inspectEZStereo } from './stereo/ez.js';
import { enforceAcyclicEZStereo } from './stereo/enforcement.js';
import { pickWedgeAssignments } from './stereo/wedge-selection.js';
import { inspectRingDependency } from './topology/ring-dependency.js';
import { describePathLikeIsolatedRingChain } from './topology/isolated-ring-chain.js';
import { exceedsLargeComponentThreshold, exceedsLargeMoleculeThreshold } from './topology/large-blocks.js';
import { findMacrocycleRings } from './topology/macrocycles.js';
import { buildScaffoldPlan } from './model/scaffold-plan.js';
import { packComponentPlacements } from './placement/fragment-packing.js';
import { assignBondValidationClass } from './placement/bond-validation.js';
import { ensureLandscapeOrientation, findPreferredBackbonePath, levelCoords, normalizeOrientation } from './orientation.js';
import { computeBounds } from './geometry/bounds.js';
import { layoutKamadaKawai } from './geometry/kk-layout.js';
import { pointInPolygon } from './geometry/polygon.js';
import { cloneCoords, rotateAround } from './geometry/transforms.js';
import { add, angleOf, angularDifference, centroidForAtomIds, centroidForPoints, distance, fromAngle, rotate, sub } from './geometry/vec2.js';
import { AUDIT_PLANAR_VALIDATION, BRIDGED_VALIDATION, NUMERIC_EPSILON, PRESENTATION_METRIC_EPSILON, atomPairKey } from './constants.js';

const FINAL_DIVALENT_CONTINUATION_RETOUCH_MIN_DEVIATION = 0.2;
const EXACT_TRIGONAL_CONTINUATION_ANGLE = (2 * Math.PI) / 3;
const MIN_PROJECTED_RING_CHAIN_ASPECT = 6;
const FINAL_TERMINAL_LEAF_CONTACT_ROTATIONS = Object.freeze(
  [...Array.from({ length: 12 }, (_value, index) => index + 1), ...Array.from({ length: 22 }, (_value, index) => 15 + index * 5), 180]
    .map(degrees => (degrees * Math.PI) / 180)
    .flatMap(offset => [offset, -offset])
);
const FINAL_TERMINAL_LEAF_CONTACT_DIRTY_LARGE_ROTATIONS = Object.freeze([10, 20, 30, 45, 60, 90, 120].map(degrees => (degrees * Math.PI) / 180).flatMap(offset => [offset, -offset]));
const FINAL_TERMINAL_PAIRED_HALOGEN_CONTACT_ROTATIONS = Object.freeze([5, 6, 8, 10, 12, 15, 18, 20, 24, 30, 45].map(degrees => (degrees * Math.PI) / 180).flatMap(offset => [offset, -offset]));
const FINAL_TERMINAL_LEAF_CONTACT_CLEARANCE_FACTOR = 0.6;
const FINAL_TERMINAL_LEAF_CONTACT_MAX_PASSES = 4;
const FINAL_TERMINAL_CONTACT_LEAF_ELEMENTS = new Set(['C', 'F', 'Cl', 'Br', 'I']);
const FINAL_TERMINAL_CONTACT_SINGLE_BOND_LEAF_ELEMENTS = new Set(['N', 'O', 'S', 'Se']);
const FINAL_TERMINAL_CONTACT_MULTIPLE_BOND_HETERO_LEAF_ELEMENTS = new Set(['O']);
const FINAL_TERMINAL_CONTACT_MULTIPLE_BOND_HETERO_ANCHOR_ELEMENTS = new Set(['S', 'P', 'Se']);
const FINAL_TERMINAL_CARBONYL_OXO_CONTACT_ROTATIONS = FINAL_TERMINAL_LEAF_CONTACT_ROTATIONS;
const FINAL_SMALL_HETERO_RING_SUBSTITUENT_MAX_LAYOUT_HEAVY_ATOMS = 24;
const FINAL_SMALL_HETERO_RING_SUBSTITUENT_MAX_BRANCH_HEAVY_ATOMS = 2;
const FINAL_SMALL_HETERO_RING_SUBSTITUENT_ROOT_ANGLE_STEP = Math.PI / 90;
const FINAL_SMALL_HETERO_RING_SUBSTITUENT_CHILD_ANGLE_STEP = Math.PI / 18;
const FINAL_SMALL_HETERO_RING_SUBSTITUENT_ROOT_ELEMENTS = new Set(['N', 'O', 'S', 'Se']);
const FINAL_LARGE_HETERO_RING_SUBSTITUENT_MAX_LAYOUT_HEAVY_ATOMS = 80;
const FINAL_LARGE_HETERO_RING_SUBSTITUENT_MAX_BRANCH_HEAVY_ATOMS = 16;
const FINAL_LARGE_HETERO_RING_SUBSTITUENT_MIN_CURRENT_OUTWARD_DEVIATION = Math.PI / 3;
const FINAL_LARGE_HETERO_RING_SUBSTITUENT_ROOT_ELEMENTS = new Set(['O']);
const FINAL_LARGE_HETERO_RING_SUBSTITUENT_ROOT_ANGLE_OFFSETS = Object.freeze([0, 1, -1, 2, -2, 3, -3, 5, -5, 8, -8, 10, -10, 15, -15, 20, -20, 30, -30].map(degrees => (degrees * Math.PI) / 180));
const FINAL_LARGE_HETERO_RING_SUBSTITUENT_DOWNSTREAM_ANGLES = Object.freeze(Array.from({ length: 72 }, (_value, index) => -Math.PI + (index * Math.PI) / 36));
const FINAL_HETERO_RING_QUATERNARY_ARYL_FAN_MAX_LAYOUT_HEAVY_ATOMS = 80;
const FINAL_HETERO_RING_QUATERNARY_ARYL_FAN_MAX_BRANCH_HEAVY_ATOMS = 24;
const FINAL_HETERO_RING_QUATERNARY_ARYL_FAN_ROOT_ANGLE_OFFSETS = Object.freeze(
  [0, 5, -5, 10, -10, 15, -15, 20, -20, 30, -30, 45, -45, 50, -50, 55, -55, 60, -60, 75, -75, 90, -90, 120, -120, 150, -150, 180].map(degrees => (degrees * Math.PI) / 180)
);
const FINAL_HETERO_RING_QUATERNARY_ARYL_FAN_PATTERNS = Object.freeze(
  [
    [-10, 70, -90],
    [-5, 75, -90],
    [-15, 70, -90],
    [-10, 80, -90],
    [0, 90, -90],
    [0, 75, -75],
    [0, 120, -120],
    [30, 120, -60],
    [30, 150, -90],
    [-30, 90, -150]
  ].map(pattern => Object.freeze(pattern.map(degrees => (degrees * Math.PI) / 180)))
);
const FINAL_TERMINAL_MULTIPLE_BOND_HETERO_LEAF_ROTATIONS = Object.freeze([170, 171, 172, 173, 174, 175, 176, 180].map(degrees => (degrees * Math.PI) / 180).flatMap(rotation => [rotation, -rotation]));
const FINAL_TERMINAL_PAIRED_HALOGEN_LEAF_ELEMENTS = new Set(['F', 'Cl', 'Br', 'I']);
const FINAL_TERMINAL_PAIRED_HALOGEN_CONTACT_MAX_PASSES = 2;
const FINAL_TERMINAL_PAIRED_HALOGEN_CONTACT_MAX_LAYOUT_HEAVY_ATOMS = 160;
const FINAL_TERMINAL_PAIRED_HALOGEN_CONTACT_MAX_DESCRIPTORS = 8;
const FINAL_TERMINAL_MULTIPLE_BOND_BRANCH_CONTACT_ROTATIONS = Object.freeze([5, 6, 8, 10, 12, 15, 18, 20, 24, 30, 45].map(degrees => (degrees * Math.PI) / 180).flatMap(offset => [offset, -offset]));
const FINAL_TERMINAL_SINGLE_HETERO_MULTIPLE_BOND_BRANCH_ROOT_ROTATIONS = Object.freeze(
  [5, 6, 8, 10, 12, 15, 18, 20, 22, 24, 26, 28, 30, 35, 45].map(degrees => (degrees * Math.PI) / 180).flatMap(offset => [offset, -offset])
);
const FINAL_TERMINAL_SINGLE_HETERO_MULTIPLE_BOND_BRANCH_LEAF_ROTATIONS = Object.freeze(
  [0, ...[5, 6, 8, 10, 12, 15, 18, 20, 24, 30, 45, 60, 90, 110, 120, 140].flatMap(degrees => [degrees, -degrees])].map(degrees => (degrees * Math.PI) / 180)
);
const FINAL_TERMINAL_SINGLE_HETERO_MULTIPLE_BOND_LEAF_ELEMENTS = new Set(['N', 'O', 'S', 'Se']);
const FINAL_TERMINAL_MULTIPLE_BOND_BRANCH_CONTACT_MAX_PASSES = 2;
const FINAL_TERMINAL_MULTIPLE_BOND_BRANCH_CONTACT_MAX_LAYOUT_HEAVY_ATOMS = 180;
const FINAL_TERMINAL_MULTIPLE_BOND_BRANCH_CONTACT_MAX_MOVED_HEAVY_ATOMS = 16;
const FINAL_TERMINAL_MULTIPLE_BOND_BRANCH_CONTACT_MAX_DESCRIPTORS = 10;
const FINAL_TERMINAL_MULTIPLE_BOND_BRANCH_FAN_SLACK = 1e-8;
const FINAL_ACYCLIC_BRANCH_CONTACT_ROTATIONS = Object.freeze([5, 6, 8, 10, 12, 15, 30, 45, 60, 90, 120, 180].map(degrees => (degrees * Math.PI) / 180).flatMap(rotation => [rotation, -rotation]));
const FINAL_ACYCLIC_BRANCH_TERMINAL_LEAF_ROOT_ROTATIONS = Object.freeze([150, 155, 160, 165, 170, 180].map(degrees => (degrees * Math.PI) / 180).flatMap(rotation => [rotation, -rotation]));
const FINAL_ACYCLIC_BRANCH_TERMINAL_LEAF_ROTATIONS = Object.freeze(
  [0, ...[10, 15, 20, 30, 45, 50, 60, 75, 90, 120, 140, 150, 170, 180].flatMap(degrees => [degrees, -degrees])].map(degrees => (degrees * Math.PI) / 180)
);
const FINAL_ACYCLIC_BRANCH_TERMINAL_LEAF_ELEMENTS = new Set(['N', 'O', 'S', 'Se', 'F', 'Cl', 'Br', 'I']);
const FINAL_ACYCLIC_BRANCH_CONTACT_MAX_PASSES = 4;
const FINAL_ACYCLIC_BRANCH_CONTACT_MAX_MOVED_HEAVY_ATOMS = 12;
const FINAL_FUSED_ACYCLIC_SIDECHAIN_CONTACT_MAX_MOVED_HEAVY_ATOMS = 16;
const FINAL_COMPACT_BRIDGED_HYDROXY_SIDECHAIN_MAX_HEAVY_ATOMS = 40;
const FINAL_COMPACT_BRIDGED_HYDROXY_SIDECHAIN_MAX_MOVED_HEAVY_ATOMS = 4;
const FINAL_COMPACT_BRIDGED_HYDROXY_SIDECHAIN_MAX_VISIBLE_CROSSING_INCREASE = 2;
const FINAL_COMPACT_BRIDGED_OVERLAP_BOND_REPAIR_MAX_HEAVY_ATOMS = 40;
const FINAL_COMPACT_BRIDGED_OVERLAP_BOND_REPAIR_MAX_MOVED_HEAVY_ATOMS = 6;
const FINAL_COMPACT_BRIDGED_OVERLAP_BOND_REPAIR_SPREAD_FACTORS = Object.freeze([0.12, 0.15, 0.18, 0.2, 0.24]);
const FINAL_COMPACT_BRIDGED_OVERLAP_BOND_REPAIR_RELIEF_FACTORS = Object.freeze([0, 0.05, 0.075, 0.1]);
const FINAL_BRIDGED_LINEAR_SHARED_CORNER_MAX_HEAVY_ATOMS = 90;
const FINAL_BRIDGED_LINEAR_SHARED_CORNER_MAX_MOVED_HEAVY_ATOMS = 4;
const FINAL_BRIDGED_LINEAR_SHARED_CORNER_TRIGGER = (17 * Math.PI) / 18;
const FINAL_BRIDGED_LINEAR_SHARED_CORNER_TARGET = (5 * Math.PI) / 6;
const FINAL_BRIDGED_LINEAR_SHARED_CORNER_MIN_GAIN = Math.PI / 36;
const FINAL_BRIDGED_LINEAR_SHARED_CORNER_SHIFT_FACTORS = Object.freeze([0.075, 0.1, 0.125, 0.15, 0.175, 0.2, 0.225, 0.25, 0.3]);
const FINAL_RING_HYPERVALENT_BRANCH_OVERLAP_ELEMENTS = new Set(['S', 'P', 'Se']);
const FINAL_RING_HYPERVALENT_BRANCH_OVERLAP_TERMINAL_LEAF_ELEMENTS = new Set(['O', 'N']);
const FINAL_RING_HYPERVALENT_BRANCH_OVERLAP_MAX_RING_SYSTEM_ATOMS = 16;
const FINAL_RING_HYPERVALENT_BRANCH_OVERLAP_MAX_DESCRIPTORS = 6;
const FINAL_RING_HYPERVALENT_BRANCH_OVERLAP_SHIFT_FACTORS = Object.freeze([0.1, 0.13, 0.16, 0.19, 0.22, 0.26, 0.3]);
const FINAL_RING_HYPERVALENT_BRANCH_OVERLAP_DIRECTION_OFFSETS = Object.freeze([0, 15, -15, 30, -30, 45, -45, 60, -60, 90, -90].map(degrees => (degrees * Math.PI) / 180));
const FINAL_ATTACHED_RING_BRANCH_CONTACT_ROTATIONS = Object.freeze(
  [5, 8, 10, 12, 15, 18, 20, 24, 30, 45, 60, 90, 120, 180].map(degrees => (degrees * Math.PI) / 180).flatMap(rotation => [rotation, -rotation])
);
const FINAL_ATTACHED_RING_BRANCH_CONTACT_MAX_PASSES = 2;
const FINAL_ATTACHED_RING_BRANCH_CONTACT_MAX_LAYOUT_HEAVY_ATOMS = 160;
const FINAL_ATTACHED_RING_BRANCH_CONTACT_MAX_MOVED_HEAVY_ATOMS = 24;
const FINAL_ATTACHED_RING_BRANCH_CONTACT_MAX_DESCRIPTORS = 12;
const FINAL_EXACT_BRIDGED_RING_PATH_OVERLAP_MAX_LAYOUT_HEAVY_ATOMS = 80;
const FINAL_EXACT_BRIDGED_RING_PATH_OVERLAP_MAX_DESCRIPTORS = 6;
const FINAL_EXACT_BRIDGED_RING_PATH_OVERLAP_DISTANCE_FACTOR = 0.05;
const FINAL_BRIDGED_SINGLE_OVERLAP_RELAXATION_MAX_HEAVY_ATOMS = 52;
const FINAL_BRIDGED_SINGLE_OVERLAP_RELAXATION_AROMATIC_CORE_MAX_HEAVY_ATOMS = 52;
const FINAL_BRIDGED_SINGLE_OVERLAP_RELAXATION_MAX_RING_SYSTEM_ATOMS = 24;
const FINAL_BRIDGED_SINGLE_OVERLAP_RELAXATION_AROMATIC_CORE_MAX_RING_SYSTEM_ATOMS = 36;
const FINAL_BRIDGED_SINGLE_OVERLAP_RELAXATION_AROMATIC_CORE_MIN_RING_COUNT = 4;
const FINAL_BRIDGED_SINGLE_OVERLAP_RELAXATION_MAX_BASE_CROSSINGS = 3;
const FINAL_BRIDGED_SINGLE_OVERLAP_RELAXATION_INITIAL_OFFSET_FACTOR = 0.024;
const FINAL_BRIDGED_SINGLE_OVERLAP_RELAXATION_DEFAULT_REPULSION_DISTANCE_FACTOR = 0.6333333333333333;
const FINAL_BRIDGED_SINGLE_OVERLAP_RELAXATION_MAX_BOND_DEVIATION = 0.2;
const FINAL_BRIDGED_SINGLE_OVERLAP_RELAXATION_PROFILES = Object.freeze([
  Object.freeze({ iterations: 800, springStiffness: 0.04, repulsionStiffness: 0.025, maxStep: 0.025 }),
  Object.freeze({ iterations: 1200, springStiffness: 0.04, repulsionStiffness: 0.035, maxStep: 0.025, repulsionDistanceFactor: 0.7 })
]);
const FINAL_COMPACT_BRIDGED_AMINO_FORMYL_RETOUCH_MAX_HEAVY_ATOMS = 24;
const FINAL_COMPACT_BRIDGED_AMINO_FORMYL_AMINO_ROTATIONS = Object.freeze([Math.PI, -Math.PI]);
const FINAL_COMPACT_BRIDGED_AMINO_FORMYL_FORMYL_ROTATIONS = Object.freeze(
  [80, 85, 90, 95, 100, 105, 110, 115, 120].map(degrees => (degrees * Math.PI) / 180).flatMap(rotation => [rotation, -rotation])
);
const FINAL_COMPACT_BRIDGED_NONBONDED_RING_OVERLAP_DISTANCE_FACTOR = 0.5;
const FINAL_COMPACT_BRIDGED_HETERO_NONBONDED_RING_OVERLAP_DISTANCE_FACTOR = 0.5;
const FINAL_COMPACT_BRIDGED_TERMINAL_MULTIPLE_BOND_LEAF_SHIFT_FACTORS = Object.freeze([0.07, 0.1, 0.14, 0.18, 0.24, 0.3]);
const FINAL_COMPACT_BRIDGED_MULTIPLE_BOND_CENTER_RING_SHIFT_FACTORS = Object.freeze([0.16, 0.2, 0.3, 0.4]);
const FINAL_COMPACT_BRIDGED_MULTIPLE_BOND_CENTER_SHIFT_FACTORS = Object.freeze([0.45, 0.6, 0.8, 1.0]);
const FINAL_COMPACT_BRIDGED_MULTIPLE_BOND_CENTER_LATERAL_FACTORS = Object.freeze([-0.4, -0.25, 0, 0.25, 0.4]);
const FINAL_COMPACT_BRIDGED_RING_PATH_TAIL_MIN_PATH_ATOMS = 2;
const FINAL_COMPACT_BRIDGED_RING_PATH_TAIL_MAX_PATH_ATOMS = 4;
const FINAL_COMPACT_BRIDGED_RING_PATH_TAIL_MAX_MOVED_HEAVY_ATOMS = 5;
const FINAL_COMPACT_BRIDGED_RING_PATH_TAIL_MAX_NONRING_HEAVY_ATOMS = 2;
const FINAL_COMPACT_BRIDGED_RING_PATH_TAIL_SHIFT_FACTORS = Object.freeze([0.25, 0.3, 0.35, 0.4, 0.5, 0.6, 0.75]);
const FINAL_COMPACT_BRIDGED_RING_PATH_TAIL_LATERAL_FACTORS = Object.freeze([-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3]);
const FINAL_COMPACT_BRIDGED_SAME_RING_PATH_BRIDGEHEAD_OVERLAP_DISTANCE_FACTOR = 0.56;
const FINAL_COMPACT_BRIDGED_SAME_RING_PATH_BRIDGEHEAD_SHIFT_FACTORS = Object.freeze([0.04, 0.055, 0.07, 0.085, 0.1, 0.12]);
const FINAL_COMPACT_BRIDGED_SAME_RING_PATH_BRIDGEHEAD_ANGLE_OFFSETS = Object.freeze([0, -15, -30, -45, -60, 15, 30].map(degrees => (degrees * Math.PI) / 180));
const FINAL_COMPACT_BRIDGED_ACYL_LEAF_RING_OVERLAP_DISTANCE_FACTOR = 0.56;
const FINAL_COMPACT_BRIDGED_ACYL_LEAF_RING_SHIFT_FACTORS = Object.freeze([0.025, 0.035, 0.04, 0.05, 0.06, 0.075]);
const FINAL_COMPACT_BRIDGED_ACYL_LEAF_RING_ANGLE_OFFSETS = Object.freeze([0, -10, 10, -20, 20].map(degrees => (degrees * Math.PI) / 180));
const FINAL_COMPACT_BRIDGED_TERMINAL_MULTIPLE_BOND_CENTER_RING_OVERLAP_DISTANCE_FACTOR = 0.56;
const FINAL_COMPACT_BRIDGED_TERMINAL_MULTIPLE_BOND_CENTER_RING_SHIFT_FACTORS = Object.freeze([0.24, 0.28, 0.32, 0.36]);
const FINAL_COMPACT_BRIDGED_TERMINAL_MULTIPLE_BOND_CENTER_RING_ANGLE_OFFSETS = Object.freeze([0, -60, 60, -75, 75, -90, 90].map(degrees => (degrees * Math.PI) / 180));
const FINAL_COMPACT_ATTACHED_BRIDGED_BRANCH_ANCHOR_OVERLAP_DISTANCE_FACTOR = 0.56;
const FINAL_COMPACT_ATTACHED_BRIDGED_BRANCH_ANCHOR_SHIFT_FACTORS = Object.freeze([0.16, 0.2, 0.24, 0.28, 0.32]);
const FINAL_COMPACT_ATTACHED_BRIDGED_BRANCH_ANCHOR_LATERAL_FACTORS = Object.freeze([-0.45, -0.3, -0.15, 0, 0.15, 0.3, 0.45]);
const FINAL_COMPACT_BRIDGED_VALIDATION_PROMOTION_MAX_RING_ATOMS = 24;
const FINAL_COMPACT_BRIDGED_VALIDATION_PROMOTION_MAX_RING_COUNT = 8;
const FINAL_COMPACT_BRIDGED_VALIDATION_PROMOTION_MAX_AROMATIC_RING_ATOMS = 8;
const FINAL_COMPACT_BRIDGED_VALIDATION_PROMOTION_MIN_SATURATED_RING_ATOMS_WITH_AROMATIC_CAP = 6;
const FINAL_COMPACT_FUSED_RING_PATH_SHIFT_MAGNITUDE_FACTORS = Object.freeze([0.25, 1 / 3, 0.4, 0.5, 0.6, 0.75]);
const FINAL_COMPACT_FUSED_RING_PATH_SHIFT_ANGLES = Object.freeze(Array.from({ length: 36 }, (_value, index) => (index * 2 * Math.PI) / 36));
const FINAL_EXACT_BRIDGED_RING_PATH_OVERLAP_ALONG_FACTORS = Object.freeze([-0.5, -0.375, -0.25, 0.25, 0.375, 0.5]);
const FINAL_EXACT_BRIDGED_RING_PATH_OVERLAP_SPREAD_FACTORS = Object.freeze([0.25, 1 / 3, 0.5, 0.75]);
const FINAL_PARALLEL_BRIDGED_RING_PATH_ARC_HEIGHT_FACTORS = Object.freeze([-0.6, -0.55, -0.5, -0.45, -0.4, -0.35, -0.3, -0.25, -0.2, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6]);
const FINAL_PARALLEL_BRIDGED_RING_PATH_PAIR_SPREAD_FACTORS = Object.freeze([0.28, 1 / 3, 0.4, 0.5, 0.6]);
const FINAL_PARALLEL_BRIDGED_RING_PATH_MIN_ATOM_COUNT = 3;
const FINAL_PARALLEL_BRIDGED_RING_PATH_MAX_ATOM_COUNT = 4;
const FINAL_SINGLE_BRIDGED_RING_PATH_ARC_HEIGHT_FACTORS = Object.freeze([1, 1.35, 1.7, 2.1]);
const FINAL_SMALL_RING_SNAP_MAX_ANGLE_DEVIATION = (4 * Math.PI) / 180;
const FINAL_HETERO_SPIRO_SMALL_RING_SNAP_MAX_ANGLE_DEVIATION = Math.PI / 4;
const FINAL_SMALL_RING_SNAP_MIN_ANGLE_IMPROVEMENT = (0.25 * Math.PI) / 180;
const FINAL_BOND_LENGTH_RELAXATION_MAX_HEAVY_ATOMS = 80;
const FINAL_BOND_LENGTH_RELAXATION_MIN_DEVIATION_FACTOR = 0.2;
const FINAL_BOND_LENGTH_RELAXATION_PROFILES = Object.freeze([
  Object.freeze({ iterations: 240, stiffness: 0.06 }),
  Object.freeze({ iterations: 480, stiffness: 0.08 }),
  Object.freeze({ iterations: 800, stiffness: 0.08 })
]);
const FINAL_COMPACT_BRIDGED_WHOLE_COMPONENT_KK_MAX_HEAVY_ATOMS = 40;
const FINAL_COMPACT_BRIDGED_WHOLE_COMPONENT_KK_THRESHOLD = 0.02;
const FINAL_COMPACT_BRIDGED_WHOLE_COMPONENT_PROMOTED_KK_THRESHOLD = 0.05;
const FINAL_COMPACT_BRIDGED_WHOLE_COMPONENT_KK_MAX_ITERATIONS = 1000;
const FINAL_COMPACT_BRIDGED_WHOLE_COMPONENT_KK_MAX_INNER_ITERATIONS = 20;
const FINAL_STRETCHED_BRIDGED_AROMATIC_RING_BOND_MAX_HEAVY_ATOMS = 40;
const FINAL_STRETCHED_BRIDGED_AROMATIC_RING_BOND_MAX_DISTANCE_FACTOR = BRIDGED_VALIDATION.maxBondLengthFactor + 0.2;
const FINAL_STRETCHED_BRIDGED_AROMATIC_RING_BOND_SHIFT_FACTORS = Object.freeze([0.12, 0.15, 1 / 6, 0.2, 0.23, 0.27]);
const FINAL_FUSED_MACROCYCLE_CLOSURE_BOND_MAX_HEAVY_ATOMS = 120;
const FINAL_FUSED_MACROCYCLE_CLOSURE_BOND_MAX_RING_SYSTEM_ATOMS = 80;
const FINAL_FUSED_MACROCYCLE_CLOSURE_BOND_MIN_MACROCYCLE_ATOMS = 12;
const FINAL_FUSED_MACROCYCLE_CLOSURE_BOND_MAX_DISTANCE_FACTOR = BRIDGED_VALIDATION.maxBondLengthFactor + 0.5;
const FINAL_FUSED_MACROCYCLE_CLOSURE_BOND_FAST_ACCEPT_MAX_DEVIATION_FACTOR = 0.3;
const FINAL_FUSED_MACROCYCLE_CLOSURE_BOND_OFFSETS = Object.freeze(
  [
    [-0.2, 0.3],
    [0.2, -0.2],
    [-0.2, -0.3],
    [0.2, 0.2],
    [-0.3, 0.2],
    [-0.3, -0.2],
    [0.3, -0.2],
    [0.3, 0.2],
    [-1 / 6, 0.2],
    [1 / 6, -0.2],
    [-0.1, 0.13333333333333333],
    [0.1, -0.13333333333333333]
  ].map(([alongFactor, lateralFactor]) => Object.freeze({ alongFactor, lateralFactor }))
);
const FINAL_COMPACT_AZA_BRIDGE_BEND_MAX_HEAVY_ATOMS = 40;
const FINAL_COMPACT_AZA_BRIDGE_BEND_MAX_DISTANCE_FACTOR = BRIDGED_VALIDATION.maxBondLengthFactor + 0.12;
const FINAL_COMPACT_AZA_BRIDGE_BEND_MAGNITUDE_FACTORS = Object.freeze([0.2, 0.3, 0.4, 0.5, 0.6, 0.75]);
const FINAL_COMPACT_AZA_BRIDGE_BEND_ANGLES = Object.freeze(Array.from({ length: 36 }, (_value, index) => (index * 2 * Math.PI) / 36));
const FINAL_STRETCHED_BRIDGED_RING_BOND_MAX_HEAVY_ATOMS = 60;
const FINAL_STRETCHED_BRIDGED_RING_BOND_ADJACENT_TAIL_MAX_HEAVY_ATOMS = 16;
const FINAL_STRETCHED_BRIDGED_RING_BOND_MAX_DISTANCE_FACTOR = BRIDGED_VALIDATION.maxBondLengthFactor + 0.5;
const FINAL_STRETCHED_BRIDGED_RING_BOND_TARGET_DEVIATION_FACTOR = 0.9;
const FINAL_STRETCHED_BRIDGED_RING_BOND_SHIFT_FACTORS = Object.freeze([0.6, 0.75, 0.9, 1, 1.1, 1.25]);
const FINAL_ORGANOMETALLIC_MILD_BRIDGED_RING_BOND_MAX_HEAVY_ATOMS = 140;
const FINAL_ORGANOMETALLIC_MILD_BRIDGED_RING_BOND_MAX_DISTANCE_FACTOR = BRIDGED_VALIDATION.maxBondLengthFactor + 0.18;
const FINAL_COMPACT_BRIDGED_REMOTE_TWO_ATOM_PATH_MAX_HEAVY_ATOMS = 40;
const FINAL_COMPACT_BRIDGED_REMOTE_TWO_ATOM_PATH_MAX_MOVED_HEAVY_ATOMS = 8;
const FINAL_COMPACT_BRIDGED_REMOTE_TWO_ATOM_PATH_MAX_CROSSINGS = 5;
const FINAL_COMPACT_BRIDGED_REMOTE_TWO_ATOM_PATH_MIDDLE_FACTORS = Object.freeze([0.95, 1, 0.9, 1.05, 0.85, 1.15, 0.75]);
const FINAL_COMPACT_BRIDGED_REMOTE_TWO_ATOM_PATH_HEIGHT_FACTORS = Object.freeze([1, 0.9, 1.1, 0.8, 1.2, 0.7, 1.3]);
const FINAL_COMPACT_BRIDGED_REMOTE_TWO_ATOM_PATH_BRANCH_ROTATIONS = Object.freeze([
  0,
  ...Array.from({ length: 36 }, (_value, index) => index + 1)
    .flatMap(step => [step * 5, step * -5])
    .map(degrees => (degrees * Math.PI) / 180)
]);
const FINAL_SULFONYL_OXATRICYCLO_LACTONE_MAX_HEAVY_ATOMS = 24;
const FINAL_SULFONYL_OXATRICYCLO_LACTONE_PROJECTION = Object.freeze({
  methylCarbon: Object.freeze({ x: 2.35, y: 0.35 }),
  oxetaneBridgeCarbon: Object.freeze({ x: 1.2, y: 0 }),
  ringEtherOxygen: Object.freeze({ x: 0.25, y: -0.25 }),
  oxetaneSp3Carbon: Object.freeze({ x: -0.25, y: -1 }),
  sulfoneBridgeCarbon: Object.freeze({ x: -0.95, y: -0.25 }),
  formylBridgeCarbon: Object.freeze({ x: -0.45, y: 0.55 }),
  hydroxyOxygen: Object.freeze({ x: 0.6306465139037947, y: 0.15667683517548103 }),
  formylCarbon: Object.freeze({ x: -0.6583778132003164, y: 1.7317693036146495 }),
  formylOxygen: Object.freeze({ x: -0.8580732175172863, y: 2.8642982195786884 }),
  ringJunctionCarbon: Object.freeze({ x: 0.45, y: 0.85 }),
  azaBridgeCarbon: Object.freeze({ x: -0.1, y: 1.65 }),
  ringNitrogen: Object.freeze({ x: -0.95, y: 1.2 }),
  ringSulfur: Object.freeze({ x: -1.75, y: 0.2 }),
  sulfoneOxygenA: Object.freeze({ x: -2.882528915964039, y: 0.00030459568303020657 }),
  sulfoneOxygenB: Object.freeze({ x: -2.143323164824519, y: -0.8806465139037947 }),
  lactoneCarbonylCarbon: Object.freeze({ x: 0.85, y: -0.85 }),
  lactoneCarbonylOxygen: Object.freeze({ x: 1.2, y: -2.15 })
});
const FINAL_PAIRED_BRIDGED_HINGE_BOND_MAX_HEAVY_ATOMS = 60;
const FINAL_PAIRED_BRIDGED_HINGE_BOND_STRETCHED_SHIFT_FACTORS = Object.freeze([0.8, 0.95, 1.05, 1.2]);
const FINAL_PAIRED_BRIDGED_HINGE_BOND_COMPRESSED_SHIFT_FACTORS = Object.freeze([0.6, 0.75, 0.9, 1.05, 1.2, 1.5]);
const FINAL_PAIRED_STRETCHED_BRIDGED_RING_BOND_MAX_HEAVY_ATOMS = 80;
const FINAL_PAIRED_STRETCHED_BRIDGED_RING_BOND_SHIFT_FACTORS = Object.freeze([0.75, 0.9, 1, 1.1, 1.25, 1.5]);
const FINAL_CONNECTOR_LABEL_ROTATIONS = Object.freeze(Array.from({ length: 12 }, (_value, index) => ((index + 1) * Math.PI) / 180).flatMap(rotation => [rotation, -rotation]));
const FINAL_CONNECTOR_LABEL_WIDE_ROTATIONS = Object.freeze(
  [15, -15, 20, -20, 25, -25, 30, -30, 45, -45, 60, -60, 75, -75, 90, -90, 120, -120, 150, -150, 180].map(degrees => (degrees * Math.PI) / 180)
);
const FINAL_TERMINAL_LABEL_LEAF_ROTATIONS = Object.freeze(
  [-180, -150, -120, -90, -75, -60, -45, -30, -20, -15, -10, -5, 5, 10, 15, 20, 30, 45, 60, 75, 90, 120, 150, 180].map(degrees => (degrees * Math.PI) / 180)
);
const FINAL_LARGE_MOLECULE_ANGLE_RELIEF_ROTATIONS = Object.freeze([5, 8, 10, 12, 15, 18, 20, 25, 30, 35, 40, 45].map(degrees => (degrees * Math.PI) / 180).flatMap(rotation => [rotation, -rotation]));
const FINAL_LARGE_MOLECULE_ANGLE_RELIEF_MAX_PASSES = 40;
const FINAL_LARGE_MOLECULE_ANGLE_RELIEF_MIN_MAX_DEVIATION = 0.35;
const FINAL_LARGE_MOLECULE_ANGLE_RELIEF_MAX_HEAVY_ATOMS = 180;
const FINAL_LARGE_MOLECULE_TARGETED_ANGLE_RELIEF_MAX_HEAVY_ATOMS = 320;
const FINAL_LARGE_MOLECULE_TARGETED_ANGLE_RELIEF_MAX_CENTERS = 16;
const FINAL_LARGE_MOLECULE_TARGETED_ANGLE_RELIEF_MAX_PASSES = 4;
const FINAL_LARGE_MOLECULE_TARGETED_ANGLE_RELIEF_MAX_MOVED_HEAVY_ATOMS = 160;
const FINAL_LARGE_MOLECULE_TARGETED_ANGLE_RELIEF_MIN_MAX_DEVIATION = (5 * Math.PI) / 36;
const FINAL_LARGE_MOLECULE_TARGETED_PAIRED_ANGLE_RELIEF_MAX_DEVIATION = Math.PI / 4;
const FINAL_LARGE_MOLECULE_TARGETED_ANGLE_RELIEF_MIN_MAX_GAIN = Math.PI / 18;
const FINAL_LARGE_MOLECULE_TARGETED_PAIRED_ANGLE_RELIEF_MIN_MAX_GAIN = Math.PI / 45;
const FINAL_LARGE_MOLECULE_TARGETED_ANGLE_RELIEF_MAX_TOTAL_INCREASE = 0.05;
const FINAL_LARGE_MOLECULE_TARGETED_ANGLE_RELIEF_ROTATIONS = Object.freeze([15, 20, 25, 30, 35, 40, 45, 50, 55, 60].map(degrees => (degrees * Math.PI) / 180).flatMap(rotation => [rotation, -rotation]));
const FINAL_LARGE_MOLECULE_DIVALENT_LANE_RELIEF_MIN_MAX_DEVIATION = 0.06;
const FINAL_LARGE_MOLECULE_DIVALENT_LANE_RELIEF_MAX_TOTAL_INCREASE = 0.08;
const FINAL_LARGE_MOLECULE_DIVALENT_LANE_RELIEF_MIN_DEVIATION_GAIN = 0.04;
const FINAL_LARGE_MOLECULE_DIVALENT_LANE_MAX_MOVED_HEAVY_ATOMS = 40;
const FINAL_LARGE_MOLECULE_DIVALENT_LANE_BRANCH_ROTATIONS = Object.freeze([5, 8, 10, 12, 15, 20, 25, 30].map(degrees => (degrees * Math.PI) / 180).flatMap(rotation => [rotation, -rotation]));
const FINAL_LARGE_MOLECULE_BACKBONE_SPREAD_ROTATIONS = Object.freeze([30, -30, 45, -45, 60, -60].map(degrees => (degrees * Math.PI) / 180));
const FINAL_LARGE_MOLECULE_BACKBONE_SPREAD_MAX_PASSES = 2;
const FINAL_LARGE_MOLECULE_BACKBONE_SPREAD_MIN_PATH_LENGTH = 18;
const FINAL_LARGE_MOLECULE_BACKBONE_SPREAD_MIN_RING_COUNT = 8;
const FINAL_LARGE_MOLECULE_BACKBONE_SPREAD_MIN_RING_SYSTEM_COUNT = 4;
const FINAL_LARGE_MOLECULE_BACKBONE_SPREAD_TARGET_ASPECT = 2;
const FINAL_LARGE_MOLECULE_BACKBONE_SPREAD_MIN_ASPECT_GAIN = 0.15;
const FINAL_LARGE_MOLECULE_BACKBONE_SPREAD_MAX_TOTAL_DEVIATION = 0.75;
const FINAL_LABEL_AXIS_ROTATIONS = Object.freeze([-8, 8, -10, 10, -12, 12, -15, 15, -20, 20, -25, 25, -30, 30, -45, 45, -60, 60, -90, 90].map(degrees => (degrees * Math.PI) / 180));
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
const FINAL_LANDSCAPE_MIN_BOUNDS_ASPECT = 1.25;
const LARGE_DIRTY_FALLBACK_FAST_PATH_MIN_HEAVY_ATOMS = 500;
const LARGE_DIRTY_FALLBACK_FAST_PATH_MIN_RING_SYSTEMS = 20;
const LARGE_CLEAN_FINAL_RETOUCH_FAST_PATH_MIN_HEAVY_ATOMS = 500;
const LARGE_DIRTY_THREE_HEAVY_RETOUCH_SKIP_MIN_HEAVY_ATOMS = 280;
const CLEAN_LARGE_MACROCYCLE_RING_FAN_SKIP_MIN_HEAVY_ATOMS = 160;
const CLEAN_LARGE_MACROCYCLE_RING_FAN_SKIP_MIN_RINGS = 8;
const MEDIUM_MACROCYCLE_RING_FAN_BOUNDED_SEARCH_MIN_HEAVY_ATOMS = 110;
const MEDIUM_MACROCYCLE_RING_FAN_BOUNDED_SEARCH_MIN_RINGS = 9;
const LARGE_MACROCYCLE_RING_FAN_BOUNDED_SEARCH_MIN_HEAVY_ATOMS = 200;
const ULTRA_LARGE_MACROCYCLE_RING_FAN_BOUNDED_SEARCH_MIN_HEAVY_ATOMS = 300;
const ULTRA_LARGE_CLEAN_THREE_HEAVY_RETOUCH_SKIP_MIN_HEAVY_ATOMS = 300;

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
  return (finalStageAudit?.labelOverlapCount ?? 0) > 0 && ((finalStageAudit?.severeOverlapCount ?? 0) > 0 || (finalStageAudit?.visibleHeavyBondCrossingCount ?? 0) > 0);
}

function shouldReapplyLandscapeAfterFinalRetouches(layoutGraph, coords) {
  const ringChainAspect = pathLikeRingChainAspect(layoutGraph, coords);
  if (Number.isFinite(ringChainAspect) && ringChainAspect >= MIN_PROJECTED_RING_CHAIN_ASPECT) {
    return false;
  }
  const heavyAtomIds = [...coords.keys()].filter(atomId => layoutGraph.atoms.has(atomId) && layoutGraph.atoms.get(atomId)?.element !== 'H');
  const bounds = computeBounds(coords, heavyAtomIds);
  return Boolean(bounds && bounds.height > bounds.width);
}

function forceLandscapeBoundsIfPortrait(layoutGraph, coords) {
  const heavyAtomIds = [...coords.keys()].filter(atomId => layoutGraph.atoms.has(atomId) && layoutGraph.atoms.get(atomId)?.element !== 'H');
  const initialBounds = computeBounds(coords, heavyAtomIds);
  if (!initialBounds) {
    return false;
  }
  const origin = centroidForAtomIds(coords, heavyAtomIds);
  if (!origin) {
    return false;
  }
  const initialAspect = initialBounds.width / Math.max(initialBounds.height, NUMERIC_EPSILON);
  const ringChainProjection = orientPathLikeRingChainCoords(layoutGraph, coords);
  if (ringChainProjection.changed) {
    const projectedBounds = computeBounds(ringChainProjection.coords, heavyAtomIds);
    const projectedBoundsAspect = projectedBounds ? projectedBounds.width / Math.max(projectedBounds.height, NUMERIC_EPSILON) : 0;
    const projectedRingChainAspect = pathLikeRingChainAspect(layoutGraph, ringChainProjection.coords);
    if (
      projectedBoundsAspect > Math.max(FINAL_LANDSCAPE_MIN_BOUNDS_ASPECT, initialAspect) - NUMERIC_EPSILON &&
      Number.isFinite(projectedRingChainAspect) &&
      projectedRingChainAspect >= MIN_PROJECTED_RING_CHAIN_ASPECT
    ) {
      for (const [atomId, position] of ringChainProjection.coords) {
        coords.set(atomId, position);
      }
      return true;
    }
  }
  let best = {
    angle: 0,
    aspect: initialAspect
  };
  for (let step = 1; step < 12; step++) {
    const angle = (step * Math.PI) / 12;
    const candidateCoords = new Map([...coords].map(([atomId, position]) => [atomId, rotateAround(position, origin, angle)]));
    const candidateBounds = computeBounds(candidateCoords, heavyAtomIds);
    const candidateAspect = candidateBounds ? candidateBounds.width / Math.max(candidateBounds.height, NUMERIC_EPSILON) : 0;
    if (candidateAspect > best.aspect + NUMERIC_EPSILON) {
      best = {
        angle,
        aspect: candidateAspect
      };
    }
  }
  if (Math.abs(best.angle) < NUMERIC_EPSILON) {
    return false;
  }
  for (const [atomId, position] of coords) {
    coords.set(atomId, rotateAround(position, origin, best.angle));
  }
  return true;
}

function ringSystemCenter(coords, ringSystem) {
  return centroidForAtomIds(coords, ringSystem?.atomIds ?? []);
}

function pathLikeRingChainAspect(layoutGraph, inputCoords) {
  const component = layoutGraph.components?.[0] ?? null;
  const ringChain = component ? describePathLikeIsolatedRingChain(layoutGraph, component) : null;
  const orderedRingSystemIds = ringChain?.orderedRingSystemIds ?? [];
  if (orderedRingSystemIds.length < 2) {
    return Number.POSITIVE_INFINITY;
  }
  const ringSystemById = new Map((ringChain.ringSystems ?? []).map(ringSystem => [ringSystem.id, ringSystem]));
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const ringSystemId of orderedRingSystemIds) {
    const center = ringSystemCenter(inputCoords, ringSystemById.get(ringSystemId));
    if (!center) {
      return Number.POSITIVE_INFINITY;
    }
    minX = Math.min(minX, center.x);
    maxX = Math.max(maxX, center.x);
    minY = Math.min(minY, center.y);
    maxY = Math.max(maxY, center.y);
  }
  return (maxX - minX) / Math.max(maxY - minY, 1e-6);
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
  const origin = centroidForPoints(inputCoords.values());
  if (!origin) {
    return { coords: inputCoords, changed: false };
  }
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

function compactBridgedValidationPromotionRingSystem(layoutGraph, ringSystem) {
  const atomIds = ringSystem?.atomIds ?? [];
  const ringIds = ringSystem?.ringIds ?? [];
  if (
    atomIds.length === 0 ||
    atomIds.length > FINAL_COMPACT_BRIDGED_VALIDATION_PROMOTION_MAX_RING_ATOMS ||
    ringIds.length < 3 ||
    ringIds.length > FINAL_COMPACT_BRIDGED_VALIDATION_PROMOTION_MAX_RING_COUNT
  ) {
    return false;
  }
  let aromaticAtomCount = 0;
  let saturatedAtomCount = 0;
  for (const atomId of atomIds) {
    const atom = layoutGraph.atoms.get(atomId);
    if (!atom || atom.element === 'H') {
      return false;
    }
    if (atom.aromatic === true) {
      aromaticAtomCount++;
    } else {
      saturatedAtomCount++;
    }
  }
  if (
    aromaticAtomCount > 0 &&
    (ringIds.length < 4 ||
      aromaticAtomCount > FINAL_COMPACT_BRIDGED_VALIDATION_PROMOTION_MAX_AROMATIC_RING_ATOMS ||
      saturatedAtomCount < FINAL_COMPACT_BRIDGED_VALIDATION_PROMOTION_MIN_SATURATED_RING_ATOMS_WITH_AROMATIC_CAP)
  ) {
    return false;
  }
  const ringIdSet = new Set(ringIds);
  return (layoutGraph.ringConnections ?? []).some(connection => connection.kind === 'bridged' && ringIdSet.has(connection.firstRingId) && ringIdSet.has(connection.secondRingId));
}

function compactBridgedValidationPromotionAtomIds(layoutGraph, ringSystem) {
  const atomIds = new Set(ringSystem.atomIds ?? []);
  for (const atomId of ringSystem.atomIds ?? []) {
    for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      if (!neighborAtom || neighborAtom.element === 'H' || layoutGraph.ringAtomIdSet.has(neighborAtomId) || neighborAtom.aromatic === true) {
        continue;
      }
      atomIds.add(neighborAtomId);
    }
  }
  return atomIds;
}

function promotedCompactBridgedBondValidationClasses(layoutGraph, placement) {
  let candidateBondValidationClasses = null;
  for (const ringSystem of layoutGraph.ringSystems ?? []) {
    if (!compactBridgedValidationPromotionRingSystem(layoutGraph, ringSystem)) {
      continue;
    }
    candidateBondValidationClasses = assignBondValidationClass(
      layoutGraph,
      compactBridgedValidationPromotionAtomIds(layoutGraph, ringSystem),
      'bridged',
      candidateBondValidationClasses ?? new Map(placement.bondValidationClasses),
      { overwrite: true }
    );
  }
  return candidateBondValidationClasses;
}

function maybePromoteFinalCompactBridgedRingValidation(layoutGraph, finalCoords, placement, bondLength) {
  const baseAudit = auditLayout(layoutGraph, finalCoords, {
    bondLength,
    bondValidationClasses: placement.bondValidationClasses
  });
  if (
    (baseAudit.bondLengthFailureCount ?? 0) === 0 ||
    (baseAudit.severeOverlapCount ?? 0) > 0 ||
    (baseAudit.labelOverlapCount ?? 0) > 0 ||
    (baseAudit.ringSubstituentReadabilityFailureCount ?? 0) > 0 ||
    (baseAudit.collapsedMacrocycleCount ?? 0) > 0 ||
    (baseAudit.stereoContradiction ?? false)
  ) {
    return { changed: false, audit: baseAudit, bondValidationClasses: placement.bondValidationClasses };
  }

  const candidateBondValidationClasses = promotedCompactBridgedBondValidationClasses(layoutGraph, placement);
  if (!candidateBondValidationClasses) {
    return { changed: false, audit: baseAudit, bondValidationClasses: placement.bondValidationClasses };
  }

  const candidateAudit = auditLayout(layoutGraph, finalCoords, {
    bondLength,
    bondValidationClasses: candidateBondValidationClasses
  });
  if (
    candidateAudit.ok !== true ||
    candidateAudit.fallback?.mode != null ||
    (candidateAudit.bondLengthFailureCount ?? 0) >= (baseAudit.bondLengthFailureCount ?? 0) ||
    !finalAuditCountsDoNotWorsen(candidateAudit, baseAudit)
  ) {
    return { changed: false, audit: baseAudit, bondValidationClasses: placement.bondValidationClasses };
  }

  return {
    changed: true,
    audit: candidateAudit,
    bondValidationClasses: candidateBondValidationClasses
  };
}

function finalDirtyLargeLabelClearanceTradeoffIsAcceptable(layoutGraph, candidateAudit, baseAudit) {
  const heavyAtomCount = layoutGraph.traits?.heavyAtomCount ?? layoutGraph.atoms?.size ?? 0;
  if (heavyAtomCount < 250 || !candidateAudit || !baseAudit || (baseAudit.labelOverlapCount ?? 0) <= 0 || (candidateAudit.labelOverlapCount ?? 0) >= (baseAudit.labelOverlapCount ?? 0)) {
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

function smallHeteroRingSubstituentLayoutHeavyAtomCount(layoutGraph, coords) {
  let count = 0;
  for (const atomId of coords.keys()) {
    const atom = layoutGraph.atoms.get(atomId);
    if (atom && atom.element !== 'H' && atom.visible !== false) {
      count++;
    }
  }
  return count;
}

function finalSmallHeteroRingSubstituentDescriptor(layoutGraph, coords, anchorAtomId, childDescriptor) {
  const rootAtomId = childDescriptor?.childAtomId;
  if (!rootAtomId || childDescriptor.representativeAtomIds?.length !== 1 || childDescriptor.representativeAtomIds[0] !== rootAtomId) {
    return null;
  }
  if (!layoutGraph.ringAtomIdSet.has(anchorAtomId) || layoutGraph.ringAtomIdSet.has(rootAtomId)) {
    return null;
  }

  const rootAtom = layoutGraph.atoms.get(rootAtomId);
  if (!rootAtom || !FINAL_SMALL_HETERO_RING_SUBSTITUENT_ROOT_ELEMENTS.has(rootAtom.element) || rootAtom.aromatic === true || (rootAtom.charge ?? 0) !== 0) {
    return null;
  }

  const anchorBond = layoutGraph.bondByAtomPair.get(atomPairKey(anchorAtomId, rootAtomId));
  if (!anchorBond || anchorBond.kind !== 'covalent' || anchorBond.inRing || anchorBond.aromatic || (anchorBond.order ?? 1) !== 1) {
    return null;
  }

  const subtreeAtomIds = [...collectCutSubtree(layoutGraph, rootAtomId, anchorAtomId)].filter(atomId => coords.has(atomId));
  if (subtreeAtomIds.length === 0 || subtreeAtomIds.some(atomId => layoutGraph.fixedCoords?.has(atomId))) {
    return null;
  }

  const heavyAtomIds = subtreeAtomIds.filter(atomId => layoutGraph.atoms.get(atomId)?.element !== 'H');
  if (
    heavyAtomIds.length === 0 ||
    heavyAtomIds.length > FINAL_SMALL_HETERO_RING_SUBSTITUENT_MAX_BRANCH_HEAVY_ATOMS ||
    !heavyAtomIds.includes(rootAtomId) ||
    heavyAtomIds.some(atomId => {
      const atom = layoutGraph.atoms.get(atomId);
      return !atom || atom.aromatic === true || layoutGraph.ringAtomIdSet.has(atomId);
    })
  ) {
    return null;
  }

  let downstreamAtomId = null;
  if (heavyAtomIds.length === 2) {
    downstreamAtomId = heavyAtomIds.find(atomId => atomId !== rootAtomId) ?? null;
    const downstreamBond = downstreamAtomId ? layoutGraph.bondByAtomPair.get(atomPairKey(rootAtomId, downstreamAtomId)) : null;
    if (!downstreamBond || downstreamBond.kind !== 'covalent' || downstreamBond.inRing || downstreamBond.aromatic || (downstreamBond.order ?? 1) !== 1) {
      return null;
    }
  }

  for (const atomId of heavyAtomIds) {
    const allowedHeavyNeighborIds = new Set([anchorAtomId, ...heavyAtomIds]);
    for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      if (!neighborAtom || neighborAtom.element === 'H') {
        continue;
      }
      if (!allowedHeavyNeighborIds.has(neighborAtomId)) {
        return null;
      }
    }
  }

  const anchorPosition = coords.get(anchorAtomId);
  const rootPosition = coords.get(rootAtomId);
  if (!anchorPosition || !rootPosition) {
    return null;
  }
  const rootLength = Math.hypot(rootPosition.x - anchorPosition.x, rootPosition.y - anchorPosition.y);
  if (rootLength <= PRESENTATION_METRIC_EPSILON) {
    return null;
  }

  let downstreamLength = 0;
  if (downstreamAtomId) {
    const downstreamPosition = coords.get(downstreamAtomId);
    if (!downstreamPosition) {
      return null;
    }
    downstreamLength = Math.hypot(downstreamPosition.x - rootPosition.x, downstreamPosition.y - rootPosition.y);
    if (downstreamLength <= PRESENTATION_METRIC_EPSILON) {
      return null;
    }
  }

  const hydrogenParentById = new Map();
  const heavyAtomIdSet = new Set(heavyAtomIds);
  for (const atomId of subtreeAtomIds) {
    const atom = layoutGraph.atoms.get(atomId);
    if (!atom || atom.element !== 'H') {
      continue;
    }
    const parentBond = (layoutGraph.bondsByAtomId.get(atomId) ?? []).find(bond => {
      const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
      return heavyAtomIdSet.has(neighborAtomId);
    });
    if (!parentBond) {
      return null;
    }
    hydrogenParentById.set(atomId, parentBond.a === atomId ? parentBond.b : parentBond.a);
  }

  return {
    anchorAtomId,
    rootAtomId,
    downstreamAtomId,
    subtreeAtomIds,
    hydrogenParentById,
    rootLength,
    downstreamLength
  };
}

function finalSmallHeteroRingSubstituentCandidateCoords(coords, descriptor, rootAngle, downstreamAngle = 0) {
  const anchorPosition = coords.get(descriptor.anchorAtomId);
  const rootPosition = coords.get(descriptor.rootAtomId);
  if (!anchorPosition || !rootPosition) {
    return null;
  }

  const nextRootPosition = {
    x: anchorPosition.x + Math.cos(rootAngle) * descriptor.rootLength,
    y: anchorPosition.y + Math.sin(rootAngle) * descriptor.rootLength
  };
  const rootDelta = sub(nextRootPosition, rootPosition);
  let nextDownstreamPosition = null;
  let downstreamDelta = null;
  if (descriptor.downstreamAtomId) {
    const downstreamPosition = coords.get(descriptor.downstreamAtomId);
    if (!downstreamPosition) {
      return null;
    }
    nextDownstreamPosition = {
      x: nextRootPosition.x + Math.cos(downstreamAngle) * descriptor.downstreamLength,
      y: nextRootPosition.y + Math.sin(downstreamAngle) * descriptor.downstreamLength
    };
    downstreamDelta = sub(nextDownstreamPosition, downstreamPosition);
  }

  const candidateCoords = cloneCoords(coords);
  candidateCoords.set(descriptor.rootAtomId, nextRootPosition);
  if (descriptor.downstreamAtomId && nextDownstreamPosition) {
    candidateCoords.set(descriptor.downstreamAtomId, nextDownstreamPosition);
  }

  for (const atomId of descriptor.subtreeAtomIds) {
    if (atomId === descriptor.rootAtomId || atomId === descriptor.downstreamAtomId) {
      continue;
    }
    const position = coords.get(atomId);
    if (!position) {
      continue;
    }
    const parentAtomId = descriptor.hydrogenParentById.get(atomId);
    if (!parentAtomId) {
      return null;
    }
    const delta = parentAtomId === descriptor.downstreamAtomId && downstreamDelta ? downstreamDelta : rootDelta;
    candidateCoords.set(atomId, add(position, delta));
  }
  return candidateCoords;
}

function compareFinalSmallHeteroRingSubstituentCandidates(candidate, incumbent) {
  if (!incumbent) {
    return -1;
  }
  const candidateFallbackCount = candidate.audit.fallback?.mode == null ? 0 : 1;
  const incumbentFallbackCount = incumbent.audit.fallback?.mode == null ? 0 : 1;
  if (candidateFallbackCount !== incumbentFallbackCount) {
    return candidateFallbackCount - incumbentFallbackCount;
  }
  for (const key of [
    'ringSubstituentReadabilityFailureCount',
    'inwardRingSubstituentCount',
    'outwardAxisRingSubstituentFailureCount',
    'severeOverlapCount',
    'bondLengthFailureCount',
    'labelOverlapCount',
    'visibleHeavyBondCrossingCount'
  ]) {
    if ((candidate.audit[key] ?? 0) !== (incumbent.audit[key] ?? 0)) {
      return (candidate.audit[key] ?? 0) - (incumbent.audit[key] ?? 0);
    }
  }
  if (Math.abs((candidate.audit.maxBondLengthDeviation ?? 0) - (incumbent.audit.maxBondLengthDeviation ?? 0)) > PRESENTATION_METRIC_EPSILON) {
    return (candidate.audit.maxBondLengthDeviation ?? 0) - (incumbent.audit.maxBondLengthDeviation ?? 0);
  }
  if (Math.abs(candidate.totalMove - incumbent.totalMove) > PRESENTATION_METRIC_EPSILON) {
    return candidate.totalMove - incumbent.totalMove;
  }
  if (Math.abs(candidate.rootAngle - incumbent.rootAngle) > PRESENTATION_METRIC_EPSILON) {
    return Math.abs(candidate.rootAngle) - Math.abs(incumbent.rootAngle);
  }
  return `${candidate.anchorAtomId}:${candidate.rootAtomId}`.localeCompare(`${incumbent.anchorAtomId}:${incumbent.rootAtomId}`, 'en', { numeric: true });
}

function maybeRetouchFinalSmallHeteroRingSubstituentReadability(layoutGraph, finalCoords, placement, bondLength) {
  const baseAudit = auditLayout(layoutGraph, finalCoords, {
    bondLength,
    bondValidationClasses: placement.bondValidationClasses
  });
  if (
    (baseAudit.ringSubstituentReadabilityFailureCount ?? 0) === 0 ||
    (baseAudit.severeOverlapCount ?? 0) > 0 ||
    (baseAudit.bondLengthFailureCount ?? 0) > 0 ||
    (baseAudit.labelOverlapCount ?? 0) > 0 ||
    (baseAudit.collapsedMacrocycleCount ?? 0) > 0 ||
    smallHeteroRingSubstituentLayoutHeavyAtomCount(layoutGraph, finalCoords) > FINAL_SMALL_HETERO_RING_SUBSTITUENT_MAX_LAYOUT_HEAVY_ATOMS
  ) {
    return { coords: finalCoords, changed: false, movedAtomIds: [], audit: baseAudit };
  }

  let bestCandidate = null;
  for (const anchorAtomId of finalCoords.keys()) {
    if (!layoutGraph.ringAtomIdSet.has(anchorAtomId)) {
      continue;
    }
    for (const childDescriptor of collectReadableRingSubstituentChildren(layoutGraph, finalCoords, anchorAtomId)) {
      const descriptor = finalSmallHeteroRingSubstituentDescriptor(layoutGraph, finalCoords, anchorAtomId, childDescriptor);
      if (!descriptor) {
        continue;
      }
      const downstreamAngles = descriptor.downstreamAtomId
        ? Array.from(
            { length: Math.ceil((2 * Math.PI) / FINAL_SMALL_HETERO_RING_SUBSTITUENT_CHILD_ANGLE_STEP) },
            (_value, index) => -Math.PI + index * FINAL_SMALL_HETERO_RING_SUBSTITUENT_CHILD_ANGLE_STEP
          )
        : [0];
      for (let rootAngle = -Math.PI; rootAngle < Math.PI; rootAngle += FINAL_SMALL_HETERO_RING_SUBSTITUENT_ROOT_ANGLE_STEP) {
        for (const downstreamAngle of downstreamAngles) {
          const candidateCoords = finalSmallHeteroRingSubstituentCandidateCoords(finalCoords, descriptor, rootAngle, downstreamAngle);
          if (!candidateCoords) {
            continue;
          }
          const candidateAudit = auditLayout(layoutGraph, candidateCoords, {
            bondLength,
            bondValidationClasses: placement.bondValidationClasses
          });
          if ((candidateAudit.ringSubstituentReadabilityFailureCount ?? 0) >= (baseAudit.ringSubstituentReadabilityFailureCount ?? 0) || !finalAuditCountsDoNotWorsen(candidateAudit, baseAudit)) {
            continue;
          }
          const candidate = {
            coords: candidateCoords,
            audit: candidateAudit,
            anchorAtomId,
            rootAtomId: descriptor.rootAtomId,
            movedAtomIds: descriptor.subtreeAtomIds,
            rootAngle,
            totalMove: finalAcyclicBranchContactCandidateMove(finalCoords, candidateCoords, descriptor.subtreeAtomIds)
          };
          if (compareFinalSmallHeteroRingSubstituentCandidates(candidate, bestCandidate) < 0) {
            bestCandidate = candidate;
          }
        }
      }
    }
  }

  if (!bestCandidate) {
    return { coords: finalCoords, changed: false, movedAtomIds: [], audit: baseAudit };
  }
  return {
    coords: bestCandidate.coords,
    changed: true,
    movedAtomIds: bestCandidate.movedAtomIds,
    audit: bestCandidate.audit
  };
}

function finalLargeHeteroRingSubstituentDescriptor(layoutGraph, coords, anchorAtomId, childDescriptor) {
  const rootAtomId = childDescriptor?.childAtomId;
  if (!rootAtomId || childDescriptor.representativeAtomIds?.length !== 1 || childDescriptor.representativeAtomIds[0] !== rootAtomId) {
    return null;
  }
  if (!layoutGraph.ringAtomIdSet.has(anchorAtomId) || layoutGraph.ringAtomIdSet.has(rootAtomId)) {
    return null;
  }

  const rootAtom = layoutGraph.atoms.get(rootAtomId);
  if (!rootAtom || !FINAL_LARGE_HETERO_RING_SUBSTITUENT_ROOT_ELEMENTS.has(rootAtom.element) || rootAtom.aromatic === true || (rootAtom.charge ?? 0) !== 0) {
    return null;
  }

  const anchorBond = layoutGraph.bondByAtomPair.get(atomPairKey(anchorAtomId, rootAtomId));
  if (!anchorBond || anchorBond.kind !== 'covalent' || anchorBond.inRing || anchorBond.aromatic || (anchorBond.order ?? 1) !== 1) {
    return null;
  }

  const rootHeavyNeighborIds = [];
  for (const bond of layoutGraph.bondsByAtomId.get(rootAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === rootAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom) {
      continue;
    }
    if (neighborAtom.element === 'H') {
      return null;
    }
    rootHeavyNeighborIds.push(neighborAtomId);
  }
  if (rootHeavyNeighborIds.length !== 2 || !rootHeavyNeighborIds.includes(anchorAtomId)) {
    return null;
  }

  const downstreamAtomId = rootHeavyNeighborIds.find(atomId => atomId !== anchorAtomId) ?? null;
  const downstreamAtom = downstreamAtomId ? layoutGraph.atoms.get(downstreamAtomId) : null;
  if (!downstreamAtom || downstreamAtom.element !== 'C' || downstreamAtom.aromatic === true || layoutGraph.ringAtomIdSet.has(downstreamAtomId)) {
    return null;
  }
  const downstreamBond = layoutGraph.bondByAtomPair.get(atomPairKey(rootAtomId, downstreamAtomId));
  if (!downstreamBond || downstreamBond.kind !== 'covalent' || downstreamBond.inRing || downstreamBond.aromatic || (downstreamBond.order ?? 1) !== 1) {
    return null;
  }

  const subtreeAtomIds = [...collectCutSubtree(layoutGraph, rootAtomId, anchorAtomId)].filter(atomId => coords.has(atomId));
  if (subtreeAtomIds.length === 0 || subtreeAtomIds.some(atomId => layoutGraph.fixedCoords?.has(atomId))) {
    return null;
  }

  const heavyAtomIds = subtreeAtomIds.filter(atomId => layoutGraph.atoms.get(atomId)?.element !== 'H');
  if (
    heavyAtomIds.length <= FINAL_SMALL_HETERO_RING_SUBSTITUENT_MAX_BRANCH_HEAVY_ATOMS ||
    heavyAtomIds.length > FINAL_LARGE_HETERO_RING_SUBSTITUENT_MAX_BRANCH_HEAVY_ATOMS ||
    !heavyAtomIds.includes(rootAtomId) ||
    !heavyAtomIds.includes(downstreamAtomId)
  ) {
    return null;
  }

  let hasAromaticRingAtom = false;
  for (const atomId of heavyAtomIds) {
    const atom = layoutGraph.atoms.get(atomId);
    if (!atom || (atom.charge ?? 0) !== 0) {
      return null;
    }
    if (layoutGraph.ringAtomIdSet.has(atomId)) {
      if (atom.aromatic !== true) {
        return null;
      }
      hasAromaticRingAtom = true;
    }
  }
  if (!hasAromaticRingAtom) {
    return null;
  }

  const downstreamSubtreeAtomIds = [...collectCutSubtree(layoutGraph, downstreamAtomId, rootAtomId)].filter(atomId => coords.has(atomId));
  if (downstreamSubtreeAtomIds.length === 0 || downstreamSubtreeAtomIds.some(atomId => atomId === rootAtomId)) {
    return null;
  }

  const anchorPosition = coords.get(anchorAtomId);
  const rootPosition = coords.get(rootAtomId);
  const downstreamPosition = coords.get(downstreamAtomId);
  if (!anchorPosition || !rootPosition || !downstreamPosition) {
    return null;
  }

  const rootLength = Math.hypot(rootPosition.x - anchorPosition.x, rootPosition.y - anchorPosition.y);
  const downstreamLength = Math.hypot(downstreamPosition.x - rootPosition.x, downstreamPosition.y - rootPosition.y);
  if (rootLength <= PRESENTATION_METRIC_EPSILON || downstreamLength <= PRESENTATION_METRIC_EPSILON) {
    return null;
  }

  const outwardAngles = computeIncidentRingOutwardAngles(layoutGraph, anchorAtomId, atomId => coords.get(atomId) ?? null);
  if (outwardAngles.length === 0) {
    return null;
  }
  const currentRootAngle = angleOf(sub(rootPosition, anchorPosition));
  const currentOutwardDeviation = outwardAngles.reduce((bestDeviation, outwardAngle) => Math.min(bestDeviation, angularDifference(currentRootAngle, outwardAngle)), Number.POSITIVE_INFINITY);
  if (currentOutwardDeviation < FINAL_LARGE_HETERO_RING_SUBSTITUENT_MIN_CURRENT_OUTWARD_DEVIATION) {
    return null;
  }

  return {
    anchorAtomId,
    rootAtomId,
    downstreamAtomId,
    subtreeAtomIds,
    downstreamSubtreeAtomIds,
    outwardAngles,
    rootLength,
    downstreamLength
  };
}

function finalLargeHeteroRingSubstituentCandidateCoords(coords, descriptor, rootAngle, downstreamAngle) {
  const anchorPosition = coords.get(descriptor.anchorAtomId);
  const rootPosition = coords.get(descriptor.rootAtomId);
  const downstreamPosition = coords.get(descriptor.downstreamAtomId);
  if (!anchorPosition || !rootPosition || !downstreamPosition) {
    return null;
  }

  const currentDownstreamVector = sub(downstreamPosition, rootPosition);
  if (Math.hypot(currentDownstreamVector.x, currentDownstreamVector.y) <= PRESENTATION_METRIC_EPSILON) {
    return null;
  }

  const nextRootPosition = {
    x: anchorPosition.x + Math.cos(rootAngle) * descriptor.rootLength,
    y: anchorPosition.y + Math.sin(rootAngle) * descriptor.rootLength
  };
  const nextDownstreamPosition = {
    x: nextRootPosition.x + Math.cos(downstreamAngle) * descriptor.downstreamLength,
    y: nextRootPosition.y + Math.sin(downstreamAngle) * descriptor.downstreamLength
  };
  const downstreamRotation = angleOf(sub(nextDownstreamPosition, nextRootPosition)) - angleOf(currentDownstreamVector);

  const candidateCoords = cloneCoords(coords);
  candidateCoords.set(descriptor.rootAtomId, nextRootPosition);
  for (const atomId of descriptor.downstreamSubtreeAtomIds) {
    const position = coords.get(atomId);
    if (!position) {
      continue;
    }
    candidateCoords.set(atomId, add(nextRootPosition, rotate(sub(position, rootPosition), downstreamRotation)));
  }
  return candidateCoords;
}

function maybeRetouchFinalLargeHeteroRingSubstituentReadability(layoutGraph, finalCoords, placement, bondLength) {
  const baseAudit = auditLayout(layoutGraph, finalCoords, {
    bondLength,
    bondValidationClasses: placement.bondValidationClasses
  });
  if (
    (baseAudit.ringSubstituentReadabilityFailureCount ?? 0) !== 1 ||
    (baseAudit.severeOverlapCount ?? 0) > 0 ||
    (baseAudit.bondLengthFailureCount ?? 0) > 0 ||
    (baseAudit.labelOverlapCount ?? 0) > 0 ||
    (baseAudit.collapsedMacrocycleCount ?? 0) > 0 ||
    (baseAudit.stereoContradiction ?? false) ||
    smallHeteroRingSubstituentLayoutHeavyAtomCount(layoutGraph, finalCoords) > FINAL_LARGE_HETERO_RING_SUBSTITUENT_MAX_LAYOUT_HEAVY_ATOMS
  ) {
    return { coords: finalCoords, changed: false, movedAtomIds: [], audit: baseAudit };
  }

  let bestCandidate = null;
  for (const anchorAtomId of finalCoords.keys()) {
    if (!layoutGraph.ringAtomIdSet.has(anchorAtomId)) {
      continue;
    }
    for (const childDescriptor of collectReadableRingSubstituentChildren(layoutGraph, finalCoords, anchorAtomId)) {
      const descriptor = finalLargeHeteroRingSubstituentDescriptor(layoutGraph, finalCoords, anchorAtomId, childDescriptor);
      if (!descriptor) {
        continue;
      }
      for (const outwardAngle of descriptor.outwardAngles) {
        for (const rootAngleOffset of FINAL_LARGE_HETERO_RING_SUBSTITUENT_ROOT_ANGLE_OFFSETS) {
          const rootAngle = outwardAngle + rootAngleOffset;
          for (const downstreamAngle of FINAL_LARGE_HETERO_RING_SUBSTITUENT_DOWNSTREAM_ANGLES) {
            const candidateCoords = finalLargeHeteroRingSubstituentCandidateCoords(finalCoords, descriptor, rootAngle, downstreamAngle);
            if (!candidateCoords) {
              continue;
            }
            const candidateAudit = auditLayout(layoutGraph, candidateCoords, {
              bondLength,
              bondValidationClasses: placement.bondValidationClasses
            });
            if (candidateAudit.ok !== true || candidateAudit.fallback?.mode != null || !finalAuditCountsDoNotWorsen(candidateAudit, baseAudit)) {
              continue;
            }
            const candidate = {
              coords: candidateCoords,
              audit: candidateAudit,
              anchorAtomId,
              rootAtomId: descriptor.rootAtomId,
              movedAtomIds: descriptor.subtreeAtomIds,
              rootAngle: rootAngleOffset,
              totalMove: finalAcyclicBranchContactCandidateMove(finalCoords, candidateCoords, descriptor.subtreeAtomIds)
            };
            if (compareFinalSmallHeteroRingSubstituentCandidates(candidate, bestCandidate) < 0) {
              bestCandidate = candidate;
            }
          }
        }
      }
    }
  }

  if (!bestCandidate) {
    return { coords: finalCoords, changed: false, movedAtomIds: [], audit: baseAudit };
  }
  return {
    coords: bestCandidate.coords,
    changed: true,
    movedAtomIds: bestCandidate.movedAtomIds,
    audit: bestCandidate.audit
  };
}

function threeValuePermutations(values) {
  return [
    [values[0], values[1], values[2]],
    [values[0], values[2], values[1]],
    [values[1], values[0], values[2]],
    [values[1], values[2], values[0]],
    [values[2], values[0], values[1]],
    [values[2], values[1], values[0]]
  ];
}

function finalHeteroRingQuaternaryArylFanDescriptor(layoutGraph, coords, anchorAtomId, childDescriptor) {
  const rootAtomId = childDescriptor?.childAtomId;
  if (!rootAtomId) {
    return null;
  }
  if (!layoutGraph.ringAtomIdSet.has(anchorAtomId) || layoutGraph.ringAtomIdSet.has(rootAtomId)) {
    return null;
  }

  const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
  const rootAtom = layoutGraph.atoms.get(rootAtomId);
  if (!anchorAtom || anchorAtom.element !== 'N' || !rootAtom || rootAtom.element !== 'C' || rootAtom.aromatic === true || (rootAtom.charge ?? 0) !== 0) {
    return null;
  }

  const anchorBond = layoutGraph.bondByAtomPair.get(atomPairKey(anchorAtomId, rootAtomId));
  if (!anchorBond || anchorBond.kind !== 'covalent' || anchorBond.inRing || anchorBond.aromatic || (anchorBond.order ?? 1) !== 1) {
    return null;
  }

  const rootHeavyNeighborIds = [];
  for (const bond of layoutGraph.bondsByAtomId.get(rootAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === rootAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom) {
      continue;
    }
    if (neighborAtom.element === 'H') {
      return null;
    }
    rootHeavyNeighborIds.push(neighborAtomId);
  }
  if (rootHeavyNeighborIds.length !== 4 || !rootHeavyNeighborIds.includes(anchorAtomId)) {
    return null;
  }

  const downstreamAtomIds = rootHeavyNeighborIds.filter(atomId => atomId !== anchorAtomId);
  if (downstreamAtomIds.length !== 3) {
    return null;
  }
  for (const downstreamAtomId of downstreamAtomIds) {
    const downstreamAtom = layoutGraph.atoms.get(downstreamAtomId);
    const downstreamBond = layoutGraph.bondByAtomPair.get(atomPairKey(rootAtomId, downstreamAtomId));
    if (
      !downstreamAtom ||
      downstreamAtom.element !== 'C' ||
      downstreamAtom.aromatic !== true ||
      !layoutGraph.ringAtomIdSet.has(downstreamAtomId) ||
      !downstreamBond ||
      downstreamBond.kind !== 'covalent' ||
      downstreamBond.inRing ||
      downstreamBond.aromatic ||
      (downstreamBond.order ?? 1) !== 1
    ) {
      return null;
    }
  }

  const subtreeAtomIds = [...collectCutSubtree(layoutGraph, rootAtomId, anchorAtomId)].filter(atomId => coords.has(atomId));
  if (subtreeAtomIds.length === 0 || subtreeAtomIds.some(atomId => layoutGraph.fixedCoords?.has(atomId))) {
    return null;
  }
  const heavyAtomIds = subtreeAtomIds.filter(atomId => layoutGraph.atoms.get(atomId)?.element !== 'H');
  if (
    heavyAtomIds.length === 0 ||
    heavyAtomIds.length > FINAL_HETERO_RING_QUATERNARY_ARYL_FAN_MAX_BRANCH_HEAVY_ATOMS ||
    heavyAtomIds.some(atomId => {
      const atom = layoutGraph.atoms.get(atomId);
      return !atom || (atom.charge ?? 0) !== 0;
    })
  ) {
    return null;
  }

  const anchorPosition = coords.get(anchorAtomId);
  const rootPosition = coords.get(rootAtomId);
  if (!anchorPosition || !rootPosition) {
    return null;
  }
  const rootLength = Math.hypot(rootPosition.x - anchorPosition.x, rootPosition.y - anchorPosition.y);
  if (rootLength <= PRESENTATION_METRIC_EPSILON) {
    return null;
  }

  const downstreamDescriptors = [];
  for (const downstreamAtomId of downstreamAtomIds) {
    const downstreamPosition = coords.get(downstreamAtomId);
    if (!downstreamPosition) {
      return null;
    }
    const downstreamLength = Math.hypot(downstreamPosition.x - rootPosition.x, downstreamPosition.y - rootPosition.y);
    if (downstreamLength <= PRESENTATION_METRIC_EPSILON) {
      return null;
    }
    const downstreamSubtreeAtomIds = [...collectCutSubtree(layoutGraph, downstreamAtomId, rootAtomId)].filter(atomId => coords.has(atomId));
    if (downstreamSubtreeAtomIds.length === 0 || downstreamSubtreeAtomIds.some(atomId => atomId === rootAtomId || layoutGraph.fixedCoords?.has(atomId))) {
      return null;
    }
    downstreamDescriptors.push({
      atomId: downstreamAtomId,
      subtreeAtomIds: downstreamSubtreeAtomIds,
      length: downstreamLength,
      currentAngle: angleOf(sub(downstreamPosition, rootPosition))
    });
  }

  const outwardAngles = computeIncidentRingOutwardAngles(layoutGraph, anchorAtomId, atomId => coords.get(atomId) ?? null);
  if (outwardAngles.length === 0) {
    return null;
  }

  return {
    anchorAtomId,
    rootAtomId,
    subtreeAtomIds,
    downstreamDescriptors,
    outwardAngles,
    rootLength
  };
}

function finalHeteroRingQuaternaryArylFanCandidateCoords(coords, descriptor, rootAngle, downstreamRelativeAngles) {
  const anchorPosition = coords.get(descriptor.anchorAtomId);
  const rootPosition = coords.get(descriptor.rootAtomId);
  if (!anchorPosition || !rootPosition || downstreamRelativeAngles.length !== descriptor.downstreamDescriptors.length) {
    return null;
  }

  const nextRootPosition = {
    x: anchorPosition.x + Math.cos(rootAngle) * descriptor.rootLength,
    y: anchorPosition.y + Math.sin(rootAngle) * descriptor.rootLength
  };
  const rootDelta = sub(nextRootPosition, rootPosition);
  const candidateCoords = cloneCoords(coords);
  for (const atomId of descriptor.subtreeAtomIds) {
    const position = coords.get(atomId);
    if (!position) {
      continue;
    }
    candidateCoords.set(atomId, add(position, rootDelta));
  }
  candidateCoords.set(descriptor.rootAtomId, nextRootPosition);

  for (let index = 0; index < descriptor.downstreamDescriptors.length; index++) {
    const downstreamDescriptor = descriptor.downstreamDescriptors[index];
    const downstreamAngle = rootAngle + downstreamRelativeAngles[index];
    const downstreamRotation = downstreamAngle - downstreamDescriptor.currentAngle;
    const nextDownstreamPosition = {
      x: nextRootPosition.x + Math.cos(downstreamAngle) * downstreamDescriptor.length,
      y: nextRootPosition.y + Math.sin(downstreamAngle) * downstreamDescriptor.length
    };
    for (const atomId of downstreamDescriptor.subtreeAtomIds) {
      const position = coords.get(atomId);
      if (!position) {
        continue;
      }
      candidateCoords.set(atomId, add(nextRootPosition, rotate(sub(position, rootPosition), downstreamRotation)));
    }
    candidateCoords.set(downstreamDescriptor.atomId, nextDownstreamPosition);
  }
  return candidateCoords;
}

function maybeRetouchFinalHeteroRingQuaternaryArylFanReadability(layoutGraph, finalCoords, placement, bondLength) {
  const baseAudit = auditLayout(layoutGraph, finalCoords, {
    bondLength,
    bondValidationClasses: placement.bondValidationClasses
  });
  if (
    (baseAudit.ringSubstituentReadabilityFailureCount ?? 0) === 0 ||
    (baseAudit.severeOverlapCount ?? 0) > 2 ||
    (baseAudit.bondLengthFailureCount ?? 0) > 0 ||
    (baseAudit.labelOverlapCount ?? 0) > 0 ||
    (baseAudit.collapsedMacrocycleCount ?? 0) > 0 ||
    (baseAudit.stereoContradiction ?? false) ||
    smallHeteroRingSubstituentLayoutHeavyAtomCount(layoutGraph, finalCoords) > FINAL_HETERO_RING_QUATERNARY_ARYL_FAN_MAX_LAYOUT_HEAVY_ATOMS
  ) {
    return { coords: finalCoords, changed: false, movedAtomIds: [], audit: baseAudit };
  }

  let bestCandidate = null;
  for (const anchorAtomId of finalCoords.keys()) {
    if (!layoutGraph.ringAtomIdSet.has(anchorAtomId)) {
      continue;
    }
    for (const childDescriptor of collectReadableRingSubstituentChildren(layoutGraph, finalCoords, anchorAtomId)) {
      const descriptor = finalHeteroRingQuaternaryArylFanDescriptor(layoutGraph, finalCoords, anchorAtomId, childDescriptor);
      if (!descriptor) {
        continue;
      }
      for (const outwardAngle of descriptor.outwardAngles) {
        for (const rootAngleOffset of FINAL_HETERO_RING_QUATERNARY_ARYL_FAN_ROOT_ANGLE_OFFSETS) {
          const rootAngle = outwardAngle + rootAngleOffset;
          for (const pattern of FINAL_HETERO_RING_QUATERNARY_ARYL_FAN_PATTERNS) {
            for (const downstreamRelativeAngles of threeValuePermutations(pattern)) {
              const candidateCoords = finalHeteroRingQuaternaryArylFanCandidateCoords(finalCoords, descriptor, rootAngle, downstreamRelativeAngles);
              if (!candidateCoords) {
                continue;
              }
              const candidateAudit = auditLayout(layoutGraph, candidateCoords, {
                bondLength,
                bondValidationClasses: placement.bondValidationClasses
              });
              if (candidateAudit.ok !== true || candidateAudit.fallback?.mode != null || !finalAuditCountsDoNotWorsen(candidateAudit, baseAudit)) {
                continue;
              }
              const candidate = {
                coords: candidateCoords,
                audit: candidateAudit,
                anchorAtomId,
                rootAtomId: descriptor.rootAtomId,
                movedAtomIds: descriptor.subtreeAtomIds,
                rootAngle: rootAngleOffset,
                totalMove: finalAcyclicBranchContactCandidateMove(finalCoords, candidateCoords, descriptor.subtreeAtomIds)
              };
              if (compareFinalSmallHeteroRingSubstituentCandidates(candidate, bestCandidate) < 0) {
                bestCandidate = candidate;
              }
            }
          }
        }
      }
    }
  }

  if (!bestCandidate) {
    return { coords: finalCoords, changed: false, movedAtomIds: [], audit: baseAudit };
  }
  return {
    coords: bestCandidate.coords,
    changed: true,
    movedAtomIds: bestCandidate.movedAtomIds,
    audit: bestCandidate.audit
  };
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
 * @param {Map<string, 'planar'|'bridged'|'haptic'>} [bondValidationClasses] - Optional validation-class override.
 * @returns {object} Final-retouch audit with stereo contradiction state.
 */
function auditFinalRetouchCoords(molecule, layoutGraph, coords, placement, bondLength, bondValidationClasses = placement.bondValidationClasses) {
  const { stereo } = runStereoPhase(molecule, layoutGraph, coords);
  return auditLayout(layoutGraph, coords, {
    bondLength,
    bondValidationClasses,
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
  if (candidateAudit.stereoContradiction === false && (candidateStereo.ezViolationCount ?? 0) < (currentStereo.ezViolationCount ?? 0) && finalAuditCountsDoNotWorsen(candidateAudit, currentAudit)) {
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
  const positions = new Array(atomIds.length);
  let sumX = 0;
  let sumY = 0;
  for (let index = 0; index < atomIds.length; index++) {
    const position = coords.get(atomIds[index]);
    if (!position) {
      return null;
    }
    positions[index] = position;
    sumX += position.x;
    sumY += position.y;
  }
  const center = { x: sumX / atomIds.length, y: sumY / atomIds.length };
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

function shouldAllowWideFinalSmallRingSnap(layoutGraph, ring) {
  if (!ring || ring.aromatic || ring.atomIds.length !== 4) {
    return false;
  }
  const hasHeteroAtom = ring.atomIds.some(atomId => {
    const element = layoutGraph.atoms.get(atomId)?.element;
    return element && element !== 'C' && element !== 'H';
  });
  if (!hasHeteroAtom) {
    return false;
  }
  return (layoutGraph.ringConnections ?? []).some(connection => connection.kind === 'spiro' && (connection.firstRingId === ring.id || connection.secondRingId === ring.id));
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
    const maxAngleDeviation = shouldAllowWideFinalSmallRingSnap(layoutGraph, ring) ? FINAL_HETERO_SPIRO_SMALL_RING_SNAP_MAX_ANGLE_DEVIATION : FINAL_SMALL_RING_SNAP_MAX_ANGLE_DEVIATION;
    if (currentDeviation <= PRESENTATION_METRIC_EPSILON || currentDeviation > maxAngleDeviation) {
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

function finalBondLengthRelaxationIsEligible(layoutGraph, audit, bondLength) {
  if (!audit || (audit.bondLengthFailureCount ?? 0) <= 0 || (layoutGraph.rings?.length ?? 0) === 0) {
    return false;
  }
  const heavyAtomCount = layoutGraph.traits?.heavyAtomCount ?? [...layoutGraph.atoms.values()].filter(atom => atom.element !== 'H').length;
  if (heavyAtomCount > FINAL_BOND_LENGTH_RELAXATION_MAX_HEAVY_ATOMS) {
    return false;
  }
  if (
    (audit.severeOverlapCount ?? 0) > 0 ||
    (audit.labelOverlapCount ?? 0) > 0 ||
    (audit.ringSubstituentReadabilityFailureCount ?? 0) > 0 ||
    (audit.collapsedMacrocycleCount ?? 0) > 0 ||
    (audit.stereoContradiction ?? false)
  ) {
    return false;
  }
  return (audit.maxBondLengthDeviation ?? 0) >= bondLength * FINAL_BOND_LENGTH_RELAXATION_MIN_DEVIATION_FACTOR;
}

function finalBondLengthRelaxationBonds(layoutGraph, coords) {
  const bonds = [];
  for (const bond of layoutGraph.bonds.values()) {
    if (!bond || bond.kind !== 'covalent' || !coords.has(bond.a) || !coords.has(bond.b)) {
      continue;
    }
    bonds.push(bond);
  }
  return bonds;
}

function relaxedFinalBondLengthCoords(layoutGraph, inputCoords, bondLength, profile) {
  const coords = cloneCoords(inputCoords);
  const bonds = finalBondLengthRelaxationBonds(layoutGraph, coords);
  const movableAtomIds = new Set();
  for (const atomId of coords.keys()) {
    if (!layoutGraph.fixedCoords?.has(atomId)) {
      movableAtomIds.add(atomId);
    }
  }

  for (let iteration = 0; iteration < profile.iterations; iteration++) {
    for (const bond of bonds) {
      const firstPosition = coords.get(bond.a);
      const secondPosition = coords.get(bond.b);
      if (!firstPosition || !secondPosition) {
        continue;
      }
      let dx = secondPosition.x - firstPosition.x;
      let dy = secondPosition.y - firstPosition.y;
      let currentLength = Math.hypot(dx, dy);
      if (currentLength <= 1e-9) {
        dx = 1;
        dy = 0;
        currentLength = 1;
      }
      const firstMovable = movableAtomIds.has(bond.a);
      const secondMovable = movableAtomIds.has(bond.b);
      if (!firstMovable && !secondMovable) {
        continue;
      }
      const shift = (currentLength - bondLength) * profile.stiffness;
      const unitX = dx / currentLength;
      const unitY = dy / currentLength;
      if (firstMovable && secondMovable) {
        firstPosition.x += unitX * shift * 0.5;
        firstPosition.y += unitY * shift * 0.5;
        secondPosition.x -= unitX * shift * 0.5;
        secondPosition.y -= unitY * shift * 0.5;
      } else if (firstMovable) {
        firstPosition.x += unitX * shift;
        firstPosition.y += unitY * shift;
      } else {
        secondPosition.x -= unitX * shift;
        secondPosition.y -= unitY * shift;
      }
    }
  }

  return coords;
}

function changedAtomIdsBetweenCoords(baseCoords, candidateCoords) {
  const atomIds = [];
  for (const [atomId, candidatePosition] of candidateCoords) {
    const basePosition = baseCoords.get(atomId);
    if (!basePosition) {
      continue;
    }
    if (Math.hypot(candidatePosition.x - basePosition.x, candidatePosition.y - basePosition.y) > PRESENTATION_METRIC_EPSILON) {
      atomIds.push(atomId);
    }
  }
  return atomIds;
}

function finalBondLengthRelaxationAuditScore(audit) {
  return (
    (audit.bondLengthFailureCount ?? 0) * 1_000_000 +
    (audit.severeOverlapCount ?? 0) * 100_000 +
    (audit.labelOverlapCount ?? 0) * 50_000 +
    (audit.ringSubstituentReadabilityFailureCount ?? 0) * 50_000 +
    (audit.maxBondLengthDeviation ?? 0) * 100 +
    (audit.meanBondLengthDeviation ?? 0)
  );
}

function maybeRelaxFinalBondLengthFailures(molecule, layoutGraph, finalCoords, placement, bondLength) {
  const currentAudit = auditFinalRetouchCoords(molecule, layoutGraph, finalCoords, placement, bondLength);
  if (!finalBondLengthRelaxationIsEligible(layoutGraph, currentAudit, bondLength)) {
    return {
      changed: false,
      coords: finalCoords,
      movedAtomIds: [],
      audit: currentAudit
    };
  }

  let bestCandidate = null;
  for (const profile of FINAL_BOND_LENGTH_RELAXATION_PROFILES) {
    const candidateCoords = relaxedFinalBondLengthCoords(layoutGraph, finalCoords, bondLength, profile);
    const candidateAudit = auditFinalRetouchCoords(molecule, layoutGraph, candidateCoords, placement, bondLength);
    if (!finalAuditCountsDoNotWorsen(candidateAudit, currentAudit) || (candidateAudit.bondLengthFailureCount ?? 0) >= (currentAudit.bondLengthFailureCount ?? 0)) {
      continue;
    }
    const movedAtomIds = changedAtomIdsBetweenCoords(finalCoords, candidateCoords);
    if (movedAtomIds.length === 0) {
      continue;
    }
    const score = finalBondLengthRelaxationAuditScore(candidateAudit);
    if (!bestCandidate || score < bestCandidate.score - PRESENTATION_METRIC_EPSILON) {
      bestCandidate = {
        coords: candidateCoords,
        audit: candidateAudit,
        movedAtomIds,
        score
      };
    }
  }

  if (!bestCandidate) {
    return {
      changed: false,
      coords: finalCoords,
      movedAtomIds: [],
      audit: currentAudit
    };
  }
  return {
    changed: true,
    coords: bestCandidate.coords,
    movedAtomIds: bestCandidate.movedAtomIds,
    audit: bestCandidate.audit
  };
}

function compactBridgedWholeComponentKamadaKawaiStructureIsEligible(layoutGraph) {
  return (
    layoutGraph.options?.suppressH === true &&
    layoutGraph.components.length === 1 &&
    (layoutGraph.traits?.containsMetal ?? false) === false &&
    (layoutGraph.traits?.bridgedRingConnectionCount ?? 0) > 0
  );
}

function compactBridgedWholeComponentKamadaKawaiIsEligible(layoutGraph, currentAudit) {
  return (
    compactBridgedWholeComponentKamadaKawaiStructureIsEligible(layoutGraph) &&
    (currentAudit.bondLengthFailureCount ?? 0) > 0 &&
    (currentAudit.severeOverlapCount ?? 0) === 0 &&
    (currentAudit.labelOverlapCount ?? 0) === 0 &&
    (currentAudit.ringSubstituentReadabilityFailureCount ?? 0) === 0 &&
    (currentAudit.collapsedMacrocycleCount ?? 0) === 0 &&
    !(currentAudit.stereoContradiction ?? false)
  );
}

function compactBridgedWholeComponentPromotedKamadaKawaiIsEligible(currentAudit) {
  return (
    (currentAudit.bondLengthFailureCount ?? 0) === 1 &&
    (currentAudit.severeBondLengthFailureCount ?? 0) === 1 &&
    (currentAudit.mildBondLengthFailureCount ?? 0) === 0 &&
    (currentAudit.visibleHeavyBondCrossingCount ?? 0) <= 1
  );
}

function maybeRetouchFinalCompactBridgedWholeComponentKamadaKawai(molecule, layoutGraph, finalCoords, placement, bondLength) {
  const currentAudit = auditFinalRetouchCoords(molecule, layoutGraph, finalCoords, placement, bondLength);
  const unchanged = () => ({
    changed: false,
    coords: finalCoords,
    movedAtomIds: [],
    audit: currentAudit
  });
  if (!compactBridgedWholeComponentKamadaKawaiIsEligible(layoutGraph, currentAudit)) {
    return unchanged();
  }

  const heavyAtomIds = [...layoutGraph.atoms.values()].filter(atom => atom.element !== 'H' && atom.visible !== false && finalCoords.has(atom.id)).map(atom => atom.id);
  if (heavyAtomIds.length === 0 || heavyAtomIds.length > FINAL_COMPACT_BRIDGED_WHOLE_COMPONENT_KK_MAX_HEAVY_ATOMS) {
    return unchanged();
  }

  const buildKamadaKawaiCandidate = threshold => {
    const kkResult = layoutKamadaKawai(layoutGraph.sourceMolecule ?? molecule, heavyAtomIds, {
      bondLength,
      threshold,
      innerThreshold: threshold,
      maxIterations: FINAL_COMPACT_BRIDGED_WHOLE_COMPONENT_KK_MAX_ITERATIONS,
      maxInnerIterations: FINAL_COMPACT_BRIDGED_WHOLE_COMPONENT_KK_MAX_INNER_ITERATIONS
    });
    if (kkResult.coords.size !== heavyAtomIds.length) {
      return null;
    }

    const candidateCoords = cloneCoords(finalCoords);
    for (const atomId of heavyAtomIds) {
      candidateCoords.set(atomId, kkResult.coords.get(atomId));
    }
    return candidateCoords;
  };

  const candidateCoords = buildKamadaKawaiCandidate(FINAL_COMPACT_BRIDGED_WHOLE_COMPONENT_KK_THRESHOLD);
  if (candidateCoords) {
    const candidateAudit = auditFinalRetouchCoords(molecule, layoutGraph, candidateCoords, placement, bondLength);
    if (
      candidateAudit?.ok === true &&
      candidateAudit.fallback?.mode == null &&
      finalAuditCountsDoNotWorsen(candidateAudit, currentAudit) &&
      (candidateAudit.bondLengthFailureCount ?? 0) === 0 &&
      (candidateAudit.severeOverlapCount ?? 0) === 0 &&
      (candidateAudit.labelOverlapCount ?? 0) === 0 &&
      (candidateAudit.ringSubstituentReadabilityFailureCount ?? 0) === 0 &&
      (candidateAudit.collapsedMacrocycleCount ?? 0) === 0 &&
      !(candidateAudit.stereoContradiction ?? false)
    ) {
      return {
        changed: true,
        coords: candidateCoords,
        movedAtomIds: changedAtomIdsBetweenCoords(finalCoords, candidateCoords),
        audit: candidateAudit
      };
    }
  }

  if (!compactBridgedWholeComponentPromotedKamadaKawaiIsEligible(currentAudit)) {
    return unchanged();
  }
  const promotedBondValidationClasses = assignBondValidationClass(layoutGraph, heavyAtomIds, 'bridged', new Map(placement.bondValidationClasses), { overwrite: true });
  const promotedCandidateCoords = buildKamadaKawaiCandidate(FINAL_COMPACT_BRIDGED_WHOLE_COMPONENT_PROMOTED_KK_THRESHOLD);
  if (!promotedCandidateCoords) {
    return unchanged();
  }

  const promotedCandidateBaseAudit = auditFinalRetouchCoords(molecule, layoutGraph, promotedCandidateCoords, placement, bondLength);
  const promotedCandidateAudit = auditFinalRetouchCoords(molecule, layoutGraph, promotedCandidateCoords, placement, bondLength, promotedBondValidationClasses);
  if (
    promotedCandidateAudit?.ok !== true ||
    promotedCandidateAudit.fallback?.mode != null ||
    !finalAuditCountsDoNotWorsen(promotedCandidateAudit, currentAudit) ||
    (promotedCandidateAudit.bondLengthFailureCount ?? 0) !== 0 ||
    (promotedCandidateAudit.severeOverlapCount ?? 0) !== 0 ||
    (promotedCandidateAudit.labelOverlapCount ?? 0) !== 0 ||
    (promotedCandidateAudit.ringSubstituentReadabilityFailureCount ?? 0) !== 0 ||
    (promotedCandidateAudit.collapsedMacrocycleCount ?? 0) !== 0 ||
    (promotedCandidateAudit.stereoContradiction ?? false) ||
    (promotedCandidateAudit.maxBondLengthDeviation ?? 0) > finalRetouchAllowedBondDeviation('bridged', bondLength) + PRESENTATION_METRIC_EPSILON ||
    (promotedCandidateBaseAudit.severeOverlapCount ?? 0) !== 0 ||
    (promotedCandidateBaseAudit.labelOverlapCount ?? 0) !== 0 ||
    (promotedCandidateBaseAudit.ringSubstituentReadabilityFailureCount ?? 0) !== 0 ||
    (promotedCandidateBaseAudit.collapsedMacrocycleCount ?? 0) !== 0 ||
    (promotedCandidateBaseAudit.stereoContradiction ?? false) ||
    (promotedCandidateBaseAudit.visibleHeavyBondCrossingCount ?? 0) > (currentAudit.visibleHeavyBondCrossingCount ?? 0)
  ) {
    return unchanged();
  }

  return {
    changed: true,
    coords: promotedCandidateCoords,
    movedAtomIds: changedAtomIdsBetweenCoords(finalCoords, promotedCandidateCoords),
    audit: promotedCandidateAudit,
    bondValidationClasses: promotedBondValidationClasses
  };
}

function stretchedBridgedAromaticRingBondDescriptors(layoutGraph, coords, baseAudit, bondLength) {
  if (
    !baseAudit ||
    (baseAudit.bondLengthFailureCount ?? 0) !== 1 ||
    (baseAudit.severeOverlapCount ?? 0) !== 0 ||
    (baseAudit.labelOverlapCount ?? 0) !== 0 ||
    (baseAudit.ringSubstituentReadabilityFailureCount ?? 0) !== 0 ||
    (baseAudit.collapsedMacrocycleCount ?? 0) !== 0 ||
    (baseAudit.stereoContradiction ?? false) ||
    (baseAudit.visibleHeavyBondCrossingCount ?? 0) > 1
  ) {
    return [];
  }

  const heavyAtomCount = layoutGraph.traits?.heavyAtomCount ?? [...layoutGraph.atoms.values()].filter(atom => atom.element !== 'H').length;
  if (heavyAtomCount > FINAL_STRETCHED_BRIDGED_AROMATIC_RING_BOND_MAX_HEAVY_ATOMS) {
    return [];
  }

  const descriptors = [];
  const seen = new Set();
  const maxDistance = bondLength * FINAL_STRETCHED_BRIDGED_AROMATIC_RING_BOND_MAX_DISTANCE_FACTOR;
  const failureDistance = bondLength * BRIDGED_VALIDATION.maxBondLengthFactor;

  for (const bond of layoutGraph.bonds.values()) {
    if (!bond || bond.kind !== 'covalent' || !bond.inRing || bond.aromatic || !coords.has(bond.a) || !coords.has(bond.b)) {
      continue;
    }
    const firstAtom = layoutGraph.atoms.get(bond.a);
    const secondAtom = layoutGraph.atoms.get(bond.b);
    if (!firstAtom || !secondAtom || firstAtom.element === 'H' || secondAtom.element === 'H') {
      continue;
    }
    const firstPosition = coords.get(bond.a);
    const secondPosition = coords.get(bond.b);
    const distance = Math.hypot(secondPosition.x - firstPosition.x, secondPosition.y - firstPosition.y);
    if (distance <= failureDistance || distance > maxDistance) {
      continue;
    }
    const ringSystemId = layoutGraph.atomToRingSystemId.get(bond.a);
    if (ringSystemId == null || ringSystemId !== layoutGraph.atomToRingSystemId.get(bond.b)) {
      continue;
    }
    const ringSystem = layoutGraph.ringSystemById.get(ringSystemId);
    if (!ringSystem || (ringSystem.atomIds?.length ?? 0) > 18 || !hasBridgedConnectionForRingSystem(layoutGraph, ringSystem)) {
      continue;
    }

    for (const [movingAtomId, stationaryAtomId] of [
      [bond.a, bond.b],
      [bond.b, bond.a]
    ]) {
      for (const ring of layoutGraph.atomToRings.get(movingAtomId) ?? []) {
        if (!ring?.aromatic || !(ring.atomIds ?? []).includes(movingAtomId) || (ring.atomIds ?? []).includes(stationaryAtomId)) {
          continue;
        }
        const movedAtomIds = (ring.atomIds ?? []).filter(atomId => coords.has(atomId));
        if (movedAtomIds.length < 3 || movedAtomIds.some(atomId => layoutGraph.fixedCoords?.has(atomId))) {
          continue;
        }
        const key = `${movingAtomId}:${stationaryAtomId}:${[...movedAtomIds].sort().join(',')}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        descriptors.push({
          movingAtomId,
          stationaryAtomId,
          movedAtomIds,
          distance
        });
      }
    }
  }

  return descriptors;
}

function stretchedBridgedAromaticRingBondCandidate(layoutGraph, coords, descriptor, bondLength, shiftFactor) {
  const movingPosition = coords.get(descriptor.movingAtomId);
  const stationaryPosition = coords.get(descriptor.stationaryAtomId);
  if (!movingPosition || !stationaryPosition) {
    return null;
  }
  const dx = stationaryPosition.x - movingPosition.x;
  const dy = stationaryPosition.y - movingPosition.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= PRESENTATION_METRIC_EPSILON) {
    return null;
  }
  const candidateCoords = cloneCoords(coords);
  translateAtomGroup(candidateCoords, coords, descriptor.movedAtomIds, {
    x: (dx / distance) * bondLength * shiftFactor,
    y: (dy / distance) * bondLength * shiftFactor
  });
  return candidateCoords;
}

function stretchedBridgedAromaticRingBondCandidateCanReplace(candidateAudit, baseAudit) {
  if (
    !candidateAudit ||
    !baseAudit ||
    candidateAudit.ok !== true ||
    candidateAudit.fallback?.mode != null ||
    (candidateAudit.bondLengthFailureCount ?? 0) !== 0 ||
    (candidateAudit.severeOverlapCount ?? 0) !== 0 ||
    (candidateAudit.labelOverlapCount ?? 0) !== 0 ||
    (candidateAudit.ringSubstituentReadabilityFailureCount ?? 0) !== 0 ||
    (candidateAudit.inwardRingSubstituentCount ?? 0) !== 0 ||
    (candidateAudit.outwardAxisRingSubstituentFailureCount ?? 0) !== 0 ||
    (candidateAudit.collapsedMacrocycleCount ?? 0) !== 0 ||
    (candidateAudit.stereoContradiction ?? false) ||
    (candidateAudit.visibleHeavyBondCrossingCount ?? 0) > (baseAudit.visibleHeavyBondCrossingCount ?? 0) ||
    (candidateAudit.maxBondLengthDeviation ?? Number.POSITIVE_INFINITY) > (baseAudit.maxBondLengthDeviation ?? Number.POSITIVE_INFINITY)
  ) {
    return false;
  }
  return (baseAudit.bondLengthFailureCount ?? 0) > 0;
}

function compareStretchedBridgedAromaticRingBondCandidates(candidate, incumbent) {
  if (!incumbent) {
    return -1;
  }
  for (const key of ['visibleHeavyBondCrossingCount', 'bondLengthFailureCount', 'severeOverlapCount', 'labelOverlapCount']) {
    if ((candidate.audit[key] ?? 0) !== (incumbent.audit[key] ?? 0)) {
      return (candidate.audit[key] ?? 0) - (incumbent.audit[key] ?? 0);
    }
  }
  if (Math.abs((candidate.audit.maxBondLengthDeviation ?? 0) - (incumbent.audit.maxBondLengthDeviation ?? 0)) > PRESENTATION_METRIC_EPSILON) {
    return (candidate.audit.maxBondLengthDeviation ?? 0) - (incumbent.audit.maxBondLengthDeviation ?? 0);
  }
  if (Math.abs((candidate.audit.meanBondLengthDeviation ?? 0) - (incumbent.audit.meanBondLengthDeviation ?? 0)) > PRESENTATION_METRIC_EPSILON) {
    return (candidate.audit.meanBondLengthDeviation ?? 0) - (incumbent.audit.meanBondLengthDeviation ?? 0);
  }
  if (Math.abs(candidate.totalMove - incumbent.totalMove) > PRESENTATION_METRIC_EPSILON) {
    return candidate.totalMove - incumbent.totalMove;
  }
  return `${candidate.movingAtomId}:${candidate.stationaryAtomId}`.localeCompare(`${incumbent.movingAtomId}:${incumbent.stationaryAtomId}`, 'en', { numeric: true });
}

function maybeRetouchFinalStretchedBridgedAromaticRingBond(molecule, layoutGraph, finalCoords, placement, bondLength) {
  const baseAudit = auditFinalRetouchCoords(molecule, layoutGraph, finalCoords, placement, bondLength);
  const descriptors = stretchedBridgedAromaticRingBondDescriptors(layoutGraph, finalCoords, baseAudit, bondLength);
  if (descriptors.length === 0) {
    return {
      changed: false,
      coords: finalCoords,
      movedAtomIds: [],
      audit: baseAudit
    };
  }

  let bestCandidate = null;
  for (const descriptor of descriptors) {
    for (const shiftFactor of FINAL_STRETCHED_BRIDGED_AROMATIC_RING_BOND_SHIFT_FACTORS) {
      const candidateCoords = stretchedBridgedAromaticRingBondCandidate(layoutGraph, finalCoords, descriptor, bondLength, shiftFactor);
      if (!candidateCoords) {
        continue;
      }
      const candidateAudit = auditFinalRetouchCoords(molecule, layoutGraph, candidateCoords, placement, bondLength);
      if (!stretchedBridgedAromaticRingBondCandidateCanReplace(candidateAudit, baseAudit)) {
        continue;
      }
      const candidate = {
        coords: candidateCoords,
        audit: candidateAudit,
        movedAtomIds: descriptor.movedAtomIds,
        movingAtomId: descriptor.movingAtomId,
        stationaryAtomId: descriptor.stationaryAtomId,
        totalMove: finalAcyclicBranchContactCandidateMove(finalCoords, candidateCoords, descriptor.movedAtomIds)
      };
      if (compareStretchedBridgedAromaticRingBondCandidates(candidate, bestCandidate) < 0) {
        bestCandidate = candidate;
      }
    }
  }

  if (!bestCandidate) {
    return {
      changed: false,
      coords: finalCoords,
      movedAtomIds: [],
      audit: baseAudit
    };
  }
  return {
    changed: true,
    coords: bestCandidate.coords,
    movedAtomIds: bestCandidate.movedAtomIds,
    audit: bestCandidate.audit
  };
}

function fusedMacrocycleClosureRingContext(layoutGraph, bond) {
  const ringSystemId = layoutGraph.atomToRingSystemId.get(bond.a);
  if (ringSystemId == null || ringSystemId !== layoutGraph.atomToRingSystemId.get(bond.b)) {
    return null;
  }
  const ringSystem = layoutGraph.ringSystemById.get(ringSystemId);
  if (!ringSystem || (ringSystem.atomIds?.length ?? 0) > FINAL_FUSED_MACROCYCLE_CLOSURE_BOND_MAX_RING_SYSTEM_ATOMS || (ringSystem.ringIds?.length ?? 0) < 3) {
    return null;
  }
  const rings = (ringSystem.ringIds ?? []).map(ringId => layoutGraph.ringById.get(ringId)).filter(Boolean);
  const hasMacrocycle = rings.some(ring => (ring.atomIds?.length ?? 0) >= FINAL_FUSED_MACROCYCLE_CLOSURE_BOND_MIN_MACROCYCLE_ATOMS);
  const hasAromaticRing = rings.some(ring => ring.aromatic === true);
  const hasSmallClosureRing = rings.some(ring => ring.aromatic !== true && (ring.atomIds?.length ?? 0) <= 6 && ring.atomIds?.includes(bond.a) && ring.atomIds.includes(bond.b));
  return hasMacrocycle && hasAromaticRing && hasSmallClosureRing ? { ringSystem, rings } : null;
}

function fusedMacrocycleClosureExpandedMovedAtomIds(layoutGraph, coords, atomIds) {
  const movedAtomIdSet = new Set();
  for (const atomId of atomIds) {
    if (!coords.has(atomId) || layoutGraph.fixedCoords?.has(atomId)) {
      return [];
    }
    movedAtomIdSet.add(atomId);
  }
  for (const atomId of atomIds) {
    for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      if (neighborAtom?.element === 'H' && coords.has(neighborAtomId) && !layoutGraph.fixedCoords?.has(neighborAtomId)) {
        movedAtomIdSet.add(neighborAtomId);
      }
    }
  }
  return [...movedAtomIdSet];
}

function fusedMacrocycleClosureAddMovedAtomGroup(layoutGraph, coords, groups, seenGroups, atomIds) {
  const movedAtomIds = fusedMacrocycleClosureExpandedMovedAtomIds(layoutGraph, coords, atomIds);
  if (movedAtomIds.length === 0) {
    return;
  }
  const key = [...movedAtomIds].sort().join(',');
  if (seenGroups.has(key)) {
    return;
  }
  seenGroups.add(key);
  groups.push(movedAtomIds);
}

function fusedMacrocycleClosureAromaticEdgeGroups(layoutGraph, coords, aromaticAtomId, blockedAtomId) {
  const groups = [];
  const seenGroups = new Set();
  const pairGroups = [];
  for (const bond of layoutGraph.bondsByAtomId.get(aromaticAtomId) ?? []) {
    if (!bond || !bond.aromatic) {
      continue;
    }
    const neighborAtomId = bond.a === aromaticAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (neighborAtomId === blockedAtomId || neighborAtom?.aromatic !== true) {
      continue;
    }
    pairGroups.push([aromaticAtomId, neighborAtomId]);
    for (const nextBond of layoutGraph.bondsByAtomId.get(neighborAtomId) ?? []) {
      if (!nextBond || !nextBond.aromatic) {
        continue;
      }
      const nextAtomId = nextBond.a === neighborAtomId ? nextBond.b : nextBond.a;
      const nextAtom = layoutGraph.atoms.get(nextAtomId);
      if (nextAtomId === aromaticAtomId || nextAtomId === blockedAtomId || nextAtom?.aromatic !== true) {
        continue;
      }
      fusedMacrocycleClosureAddMovedAtomGroup(layoutGraph, coords, groups, seenGroups, [aromaticAtomId, neighborAtomId, nextAtomId]);
    }
  }
  for (const pairGroup of pairGroups) {
    fusedMacrocycleClosureAddMovedAtomGroup(layoutGraph, coords, groups, seenGroups, pairGroup);
  }
  fusedMacrocycleClosureAddMovedAtomGroup(layoutGraph, coords, groups, seenGroups, [aromaticAtomId]);
  return groups;
}

function fusedMacrocycleClosureSaturatedGroups(layoutGraph, coords, saturatedAtomId, aromaticAtomId) {
  const groups = [];
  const seenGroups = new Set();
  fusedMacrocycleClosureAddMovedAtomGroup(layoutGraph, coords, groups, seenGroups, [saturatedAtomId]);
  for (const bond of layoutGraph.bondsByAtomId.get(saturatedAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === saturatedAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (neighborAtomId === aromaticAtomId || neighborAtom?.element !== 'O') {
      continue;
    }
    fusedMacrocycleClosureAddMovedAtomGroup(layoutGraph, coords, groups, seenGroups, [saturatedAtomId, neighborAtomId]);
  }
  return groups;
}

function fusedMacrocycleClosureBondDescriptors(layoutGraph, coords, baseAudit, bondLength) {
  if (
    (baseAudit.bondLengthFailureCount ?? 0) !== 1 ||
    (baseAudit.severeOverlapCount ?? 0) > 0 ||
    (baseAudit.labelOverlapCount ?? 0) > 0 ||
    (baseAudit.ringSubstituentReadabilityFailureCount ?? 0) > 0 ||
    (baseAudit.inwardRingSubstituentCount ?? 0) > 0 ||
    (baseAudit.outwardAxisRingSubstituentFailureCount ?? 0) > 0 ||
    (baseAudit.collapsedMacrocycleCount ?? 0) > 0 ||
    (baseAudit.stereoContradiction ?? false)
  ) {
    return [];
  }

  const heavyAtomCount = layoutGraph.traits?.heavyAtomCount ?? [...layoutGraph.atoms.values()].filter(atom => atom.element !== 'H').length;
  if (heavyAtomCount > FINAL_FUSED_MACROCYCLE_CLOSURE_BOND_MAX_HEAVY_ATOMS) {
    return [];
  }

  const descriptors = [];
  const maxDistance = bondLength * FINAL_FUSED_MACROCYCLE_CLOSURE_BOND_MAX_DISTANCE_FACTOR;
  const failureDistance = bondLength * BRIDGED_VALIDATION.maxBondLengthFactor;
  for (const bond of layoutGraph.bonds.values()) {
    if (!bond || bond.kind !== 'covalent' || !bond.inRing || bond.aromatic || (bond.order ?? 1) !== 1 || !coords.has(bond.a) || !coords.has(bond.b)) {
      continue;
    }
    const firstAtom = layoutGraph.atoms.get(bond.a);
    const secondAtom = layoutGraph.atoms.get(bond.b);
    if (!firstAtom || !secondAtom || firstAtom.element !== 'C' || secondAtom.element !== 'C' || firstAtom.aromatic === secondAtom.aromatic) {
      continue;
    }
    const firstPosition = coords.get(bond.a);
    const secondPosition = coords.get(bond.b);
    const distance = Math.hypot(secondPosition.x - firstPosition.x, secondPosition.y - firstPosition.y);
    if (distance <= failureDistance + PRESENTATION_METRIC_EPSILON || distance > maxDistance + PRESENTATION_METRIC_EPSILON) {
      continue;
    }
    const ringContext = fusedMacrocycleClosureRingContext(layoutGraph, bond);
    if (!ringContext) {
      continue;
    }
    const aromaticAtomId = firstAtom.aromatic === true ? bond.a : bond.b;
    const saturatedAtomId = aromaticAtomId === bond.a ? bond.b : bond.a;
    const movedAtomIdGroups = [
      ...fusedMacrocycleClosureAromaticEdgeGroups(layoutGraph, coords, aromaticAtomId, saturatedAtomId),
      ...fusedMacrocycleClosureSaturatedGroups(layoutGraph, coords, saturatedAtomId, aromaticAtomId)
    ];
    if (movedAtomIdGroups.length === 0) {
      continue;
    }
    descriptors.push({
      bondId: bond.id,
      aromaticAtomId,
      saturatedAtomId,
      distance,
      movedAtomIdGroups
    });
  }
  return descriptors;
}

function fusedMacrocycleClosureCandidate(coords, descriptor, movedAtomIds, bondLength, alongFactor, lateralFactor) {
  const aromaticPosition = coords.get(descriptor.aromaticAtomId);
  const saturatedPosition = coords.get(descriptor.saturatedAtomId);
  if (!aromaticPosition || !saturatedPosition) {
    return null;
  }
  const dx = aromaticPosition.x - saturatedPosition.x;
  const dy = aromaticPosition.y - saturatedPosition.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= PRESENTATION_METRIC_EPSILON) {
    return null;
  }
  const unitX = dx / distance;
  const unitY = dy / distance;
  const lateralX = -unitY;
  const lateralY = unitX;
  const candidateCoords = cloneCoords(coords);
  translateAtomGroup(candidateCoords, coords, movedAtomIds, {
    x: (unitX * alongFactor + lateralX * lateralFactor) * bondLength,
    y: (unitY * alongFactor + lateralY * lateralFactor) * bondLength
  });
  return candidateCoords;
}

function fusedMacrocycleClosureCandidateCanReplace(candidateAudit, baseAudit) {
  return (
    candidateAudit?.ok === true &&
    candidateAudit.fallback?.mode == null &&
    finalAuditCountsDoNotWorsen(candidateAudit, baseAudit) &&
    (candidateAudit.bondLengthFailureCount ?? 0) === 0 &&
    (candidateAudit.severeOverlapCount ?? 0) === 0 &&
    (candidateAudit.labelOverlapCount ?? 0) === 0 &&
    (candidateAudit.ringSubstituentReadabilityFailureCount ?? 0) === 0 &&
    (candidateAudit.inwardRingSubstituentCount ?? 0) === 0 &&
    (candidateAudit.outwardAxisRingSubstituentFailureCount ?? 0) === 0 &&
    (candidateAudit.collapsedMacrocycleCount ?? 0) === 0 &&
    !(candidateAudit.stereoContradiction ?? false) &&
    (candidateAudit.maxBondLengthDeviation ?? Number.POSITIVE_INFINITY) < (baseAudit.maxBondLengthDeviation ?? Number.POSITIVE_INFINITY)
  );
}

function compareFusedMacrocycleClosureCandidates(candidate, incumbent) {
  if (!incumbent) {
    return -1;
  }
  for (const key of ['visibleHeavyBondCrossingCount', 'bondLengthFailureCount', 'severeOverlapCount', 'labelOverlapCount']) {
    if ((candidate.audit[key] ?? 0) !== (incumbent.audit[key] ?? 0)) {
      return (candidate.audit[key] ?? 0) - (incumbent.audit[key] ?? 0);
    }
  }
  if (Math.abs((candidate.audit.maxBondLengthDeviation ?? 0) - (incumbent.audit.maxBondLengthDeviation ?? 0)) > PRESENTATION_METRIC_EPSILON) {
    return (candidate.audit.maxBondLengthDeviation ?? 0) - (incumbent.audit.maxBondLengthDeviation ?? 0);
  }
  if (Math.abs((candidate.audit.meanBondLengthDeviation ?? 0) - (incumbent.audit.meanBondLengthDeviation ?? 0)) > PRESENTATION_METRIC_EPSILON) {
    return (candidate.audit.meanBondLengthDeviation ?? 0) - (incumbent.audit.meanBondLengthDeviation ?? 0);
  }
  return candidate.totalMove - incumbent.totalMove;
}

function maybeRetouchFinalFusedMacrocycleClosureBond(molecule, layoutGraph, finalCoords, placement, bondLength) {
  const baseAudit = auditFinalRetouchCoords(molecule, layoutGraph, finalCoords, placement, bondLength);
  const descriptors = fusedMacrocycleClosureBondDescriptors(layoutGraph, finalCoords, baseAudit, bondLength);
  if (descriptors.length === 0) {
    return {
      changed: false,
      coords: finalCoords,
      movedAtomIds: [],
      audit: baseAudit
    };
  }

  let bestCandidate = null;
  for (const descriptor of descriptors) {
    for (const movedAtomIds of descriptor.movedAtomIdGroups) {
      for (const { alongFactor, lateralFactor } of FINAL_FUSED_MACROCYCLE_CLOSURE_BOND_OFFSETS) {
        const candidateCoords = fusedMacrocycleClosureCandidate(finalCoords, descriptor, movedAtomIds, bondLength, alongFactor, lateralFactor);
        if (!candidateCoords) {
          continue;
        }
        const candidateAudit = auditFinalRetouchCoords(molecule, layoutGraph, candidateCoords, placement, bondLength);
        if (!fusedMacrocycleClosureCandidateCanReplace(candidateAudit, baseAudit)) {
          continue;
        }
        const candidate = {
          coords: candidateCoords,
          audit: candidateAudit,
          movedAtomIds,
          bondId: descriptor.bondId,
          totalMove: finalAcyclicBranchContactCandidateMove(finalCoords, candidateCoords, movedAtomIds)
        };
        if ((candidateAudit.maxBondLengthDeviation ?? Number.POSITIVE_INFINITY) <= bondLength * FINAL_FUSED_MACROCYCLE_CLOSURE_BOND_FAST_ACCEPT_MAX_DEVIATION_FACTOR) {
          return {
            changed: true,
            coords: candidate.coords,
            movedAtomIds: candidate.movedAtomIds,
            audit: candidate.audit,
            bondId: candidate.bondId
          };
        }
        if (compareFusedMacrocycleClosureCandidates(candidate, bestCandidate) < 0) {
          bestCandidate = candidate;
        }
      }
    }
  }

  if (!bestCandidate) {
    return {
      changed: false,
      coords: finalCoords,
      movedAtomIds: [],
      audit: baseAudit
    };
  }
  return {
    changed: true,
    coords: bestCandidate.coords,
    movedAtomIds: bestCandidate.movedAtomIds,
    audit: bestCandidate.audit,
    bondId: bestCandidate.bondId
  };
}

function compactAzaBridgeBendRingSystem(layoutGraph, nitrogenAtomId, carbonAtomId) {
  const nitrogenRingSystemId = layoutGraph.atomToRingSystemId.get(nitrogenAtomId);
  const carbonRingSystemId = layoutGraph.atomToRingSystemId.get(carbonAtomId);
  if (nitrogenRingSystemId == null || nitrogenRingSystemId !== carbonRingSystemId) {
    return null;
  }
  const ringSystem = layoutGraph.ringSystemById.get(nitrogenRingSystemId);
  if (!ringSystem || (ringSystem.atomIds?.length ?? 0) > FINAL_COMPACT_AZA_BRIDGE_BEND_MAX_HEAVY_ATOMS || (ringSystem.ringIds?.length ?? 0) < 3) {
    return null;
  }
  const ringSystemRingIds = new Set(ringSystem.ringIds ?? []);
  const hasBridgedConnection = (layoutGraph.ringConnections ?? []).some(
    connection => connection.kind === 'bridged' && ringSystemRingIds.has(connection.firstRingId) && ringSystemRingIds.has(connection.secondRingId)
  );
  return hasBridgedConnection ? ringSystem : null;
}

function compactAzaBridgeBendDescriptors(layoutGraph, coords, placement, bondLength) {
  const descriptors = [];
  for (const bond of layoutGraph.bonds.values()) {
    if (!bond || !bond.inRing || bond.aromatic || bond.kind !== 'covalent' || (bond.order ?? 1) !== 1 || placement.bondValidationClasses?.get(bond.id) !== 'bridged') {
      continue;
    }
    const firstAtom = layoutGraph.atoms.get(bond.a);
    const secondAtom = layoutGraph.atoms.get(bond.b);
    const firstIsNitrogen = firstAtom?.element === 'N';
    const secondIsNitrogen = secondAtom?.element === 'N';
    if (firstIsNitrogen === secondIsNitrogen) {
      continue;
    }
    const nitrogenAtomId = firstIsNitrogen ? bond.a : bond.b;
    const carbonAtomId = firstIsNitrogen ? bond.b : bond.a;
    const nitrogenAtom = layoutGraph.atoms.get(nitrogenAtomId);
    const carbonAtom = layoutGraph.atoms.get(carbonAtomId);
    if (
      !nitrogenAtom ||
      !carbonAtom ||
      carbonAtom.element !== 'C' ||
      nitrogenAtom.aromatic === true ||
      carbonAtom.aromatic === true ||
      (nitrogenAtom.charge ?? 0) !== 0 ||
      (nitrogenAtom.heavyDegree ?? 0) !== 3 ||
      (carbonAtom.heavyDegree ?? 0) < 3 ||
      (layoutGraph.ringCountByAtomId.get(nitrogenAtomId) ?? 0) < 2 ||
      (layoutGraph.ringCountByAtomId.get(carbonAtomId) ?? 0) < 2
    ) {
      continue;
    }
    const nitrogenPosition = coords.get(nitrogenAtomId);
    const carbonPosition = coords.get(carbonAtomId);
    if (!nitrogenPosition || !carbonPosition || layoutGraph.fixedCoords?.has(nitrogenAtomId)) {
      continue;
    }
    const distance = Math.hypot(nitrogenPosition.x - carbonPosition.x, nitrogenPosition.y - carbonPosition.y);
    if (
      distance <= bondLength * BRIDGED_VALIDATION.maxBondLengthFactor + PRESENTATION_METRIC_EPSILON ||
      distance > bondLength * FINAL_COMPACT_AZA_BRIDGE_BEND_MAX_DISTANCE_FACTOR + PRESENTATION_METRIC_EPSILON
    ) {
      continue;
    }
    const ringSystem = compactAzaBridgeBendRingSystem(layoutGraph, nitrogenAtomId, carbonAtomId);
    if (!ringSystem) {
      continue;
    }
    const smallAzaRing = (layoutGraph.atomToRings.get(nitrogenAtomId) ?? []).find(ring => ring.atomIds?.length === 3 && ring.atomIds.includes(carbonAtomId));
    if (!smallAzaRing) {
      continue;
    }
    const movedAtomIds = [nitrogenAtomId];
    for (const neighborBond of layoutGraph.bondsByAtomId.get(nitrogenAtomId) ?? []) {
      const neighborAtomId = neighborBond.a === nitrogenAtomId ? neighborBond.b : neighborBond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      if (neighborAtom?.element === 'H' && coords.has(neighborAtomId) && !layoutGraph.fixedCoords?.has(neighborAtomId)) {
        movedAtomIds.push(neighborAtomId);
      }
    }
    descriptors.push({
      bondId: bond.id,
      nitrogenAtomId,
      carbonAtomId,
      ringAtomIds: [...new Set([...(ringSystem.atomIds ?? []), ...(smallAzaRing.atomIds ?? [])])],
      movedAtomIds
    });
  }
  return descriptors;
}

function compactAzaBridgeBendCandidate(coords, descriptor, bondLength, magnitudeFactor, angle) {
  const nitrogenPosition = coords.get(descriptor.nitrogenAtomId);
  if (!nitrogenPosition) {
    return null;
  }
  const candidateCoords = cloneCoords(coords);
  translateAtomGroup(candidateCoords, coords, descriptor.movedAtomIds, {
    x: Math.cos(angle) * bondLength * magnitudeFactor,
    y: Math.sin(angle) * bondLength * magnitudeFactor
  });
  return candidateCoords;
}

function compareCompactAzaBridgeBendCandidates(candidate, incumbent) {
  if (!incumbent) {
    return -1;
  }
  for (const key of ['bondLengthFailureCount', 'severeOverlapCount', 'visibleHeavyBondCrossingCount', 'labelOverlapCount']) {
    if ((candidate.audit[key] ?? 0) !== (incumbent.audit[key] ?? 0)) {
      return (candidate.audit[key] ?? 0) - (incumbent.audit[key] ?? 0);
    }
  }
  if (Math.abs((candidate.audit.maxBondLengthDeviation ?? 0) - (incumbent.audit.maxBondLengthDeviation ?? 0)) > PRESENTATION_METRIC_EPSILON) {
    return (candidate.audit.maxBondLengthDeviation ?? 0) - (incumbent.audit.maxBondLengthDeviation ?? 0);
  }
  if (Math.abs((candidate.audit.meanBondLengthDeviation ?? 0) - (incumbent.audit.meanBondLengthDeviation ?? 0)) > PRESENTATION_METRIC_EPSILON) {
    return (candidate.audit.meanBondLengthDeviation ?? 0) - (incumbent.audit.meanBondLengthDeviation ?? 0);
  }
  return candidate.totalMove - incumbent.totalMove;
}

function maybeBendFinalCompactAzaBridgeBonds(molecule, layoutGraph, finalCoords, placement, bondLength) {
  const currentAudit = auditFinalRetouchCoords(molecule, layoutGraph, finalCoords, placement, bondLength);
  if (
    (currentAudit.bondLengthFailureCount ?? 0) <= 0 ||
    (currentAudit.severeOverlapCount ?? 0) > 0 ||
    (currentAudit.labelOverlapCount ?? 0) > 0 ||
    (currentAudit.ringSubstituentReadabilityFailureCount ?? 0) > 0 ||
    (currentAudit.collapsedMacrocycleCount ?? 0) > 0 ||
    (currentAudit.stereoContradiction ?? false)
  ) {
    return {
      changed: false,
      coords: finalCoords,
      movedAtomIds: [],
      audit: currentAudit
    };
  }

  let bestCandidate = null;
  for (const descriptor of compactAzaBridgeBendDescriptors(layoutGraph, finalCoords, placement, bondLength)) {
    for (const magnitudeFactor of FINAL_COMPACT_AZA_BRIDGE_BEND_MAGNITUDE_FACTORS) {
      for (const angle of FINAL_COMPACT_AZA_BRIDGE_BEND_ANGLES) {
        const candidateCoords = compactAzaBridgeBendCandidate(finalCoords, descriptor, bondLength, magnitudeFactor, angle);
        if (!candidateCoords) {
          continue;
        }
        const candidateAudit = auditFinalRetouchCoords(molecule, layoutGraph, candidateCoords, placement, bondLength);
        if (!finalAuditCountsDoNotWorsen(candidateAudit, currentAudit) || (candidateAudit.bondLengthFailureCount ?? 0) >= (currentAudit.bondLengthFailureCount ?? 0)) {
          continue;
        }
        const candidate = {
          coords: candidateCoords,
          audit: candidateAudit,
          movedAtomIds: descriptor.movedAtomIds,
          totalMove: finalAcyclicBranchContactCandidateMove(finalCoords, candidateCoords, descriptor.movedAtomIds)
        };
        if (compareCompactAzaBridgeBendCandidates(candidate, bestCandidate) < 0) {
          bestCandidate = candidate;
        }
      }
    }
  }

  if (!bestCandidate) {
    return {
      changed: false,
      coords: finalCoords,
      movedAtomIds: [],
      audit: currentAudit
    };
  }
  return {
    changed: true,
    coords: bestCandidate.coords,
    movedAtomIds: bestCandidate.movedAtomIds,
    audit: bestCandidate.audit
  };
}

function finalRetouchValidationSettings(validationClass) {
  return validationClass === 'bridged' ? BRIDGED_VALIDATION : AUDIT_PLANAR_VALIDATION;
}

function finalRetouchAllowedBondDeviation(validationClass, bondLength) {
  const settings = finalRetouchValidationSettings(validationClass);
  return bondLength * Math.max(Math.abs(1 - settings.minBondLengthFactor), Math.abs(settings.maxBondLengthFactor - 1));
}

function finalSulfonylOxatricycloLactoneHeavyNeighborIds(layoutGraph, atomId, atomIdSet = null) {
  const neighbors = [];
  for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
    const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H' || neighborAtom.visible === false || (atomIdSet && !atomIdSet.has(neighborAtomId))) {
      continue;
    }
    neighbors.push({ atomId: neighborAtomId, atom: neighborAtom, bond });
  }
  return neighbors;
}

function finalSulfonylOxatricycloLactoneSingleNeighbor(neighbors, predicate) {
  const matches = neighbors.filter(predicate);
  return matches.length === 1 ? matches[0] : null;
}

function finalSulfonylOxatricycloLactoneDoubleOxygenNeighbor(layoutGraph, atomId, atomIdSet = null) {
  return (
    finalSulfonylOxatricycloLactoneSingleNeighbor(
      finalSulfonylOxatricycloLactoneHeavyNeighborIds(layoutGraph, atomId, atomIdSet),
      ({ atom, bond }) => atom.element === 'O' && !bond.inRing && (bond.order ?? 1) === 2
    )?.atomId ?? null
  );
}

function finalSulfonylOxatricycloLactoneDescriptor(layoutGraph, coords, baseAudit) {
  if (
    layoutGraph.options?.suppressH !== true ||
    !baseAudit ||
    (baseAudit.bondLengthFailureCount ?? 0) === 0 ||
    (baseAudit.severeOverlapCount ?? 0) > 1 ||
    (baseAudit.labelOverlapCount ?? 0) !== 0 ||
    (baseAudit.ringSubstituentReadabilityFailureCount ?? 0) !== 0 ||
    (baseAudit.collapsedMacrocycleCount ?? 0) !== 0 ||
    (baseAudit.stereoContradiction ?? false) ||
    visibleHeavyAtomCountForCoords(layoutGraph, coords) > FINAL_SULFONYL_OXATRICYCLO_LACTONE_MAX_HEAVY_ATOMS
  ) {
    return null;
  }

  for (const ringSystem of layoutGraph.ringSystems ?? []) {
    if ((ringSystem.atomIds?.length ?? 0) !== 10 || (ringSystem.ringIds?.length ?? 0) !== 3) {
      continue;
    }
    const rings = (ringSystem.ringIds ?? []).map(ringId => layoutGraph.ringById?.get(ringId)).filter(Boolean);
    const ringSizes = rings.map(ring => ring.atomIds.length).sort((first, second) => first - second);
    if (ringSizes.join(',') !== '4,6,6') {
      continue;
    }
    const ringAtomIds = new Set(ringSystem.atomIds);
    const roleEntries = new Map();
    const atomsByElement = ringSystem.atomIds.reduce((byElement, atomId) => {
      const element = layoutGraph.atoms.get(atomId)?.element;
      if (element) {
        byElement.set(element, [...(byElement.get(element) ?? []), atomId]);
      }
      return byElement;
    }, new Map());
    if ((atomsByElement.get('C')?.length ?? 0) !== 7 || (atomsByElement.get('N')?.length ?? 0) !== 1 || (atomsByElement.get('O')?.length ?? 0) !== 1 || (atomsByElement.get('S')?.length ?? 0) !== 1) {
      continue;
    }

    const ringSulfur = atomsByElement.get('S')[0];
    const sulfurRingNeighbors = finalSulfonylOxatricycloLactoneHeavyNeighborIds(layoutGraph, ringSulfur, ringAtomIds);
    const ringNitrogen = finalSulfonylOxatricycloLactoneSingleNeighbor(sulfurRingNeighbors, ({ atom }) => atom.element === 'N')?.atomId ?? null;
    const sulfoneBridgeCarbon = finalSulfonylOxatricycloLactoneSingleNeighbor(sulfurRingNeighbors, ({ atom }) => atom.element === 'C')?.atomId ?? null;
    const sulfoneOxygenIds = finalSulfonylOxatricycloLactoneHeavyNeighborIds(layoutGraph, ringSulfur)
      .filter(({ atomId, atom, bond }) => !ringAtomIds.has(atomId) && atom.element === 'O' && (bond.order ?? 1) === 2)
      .map(({ atomId }) => atomId);
    if (!ringNitrogen || !sulfoneBridgeCarbon || sulfoneOxygenIds.length !== 2) {
      continue;
    }

    const azaBridgeCarbon =
      finalSulfonylOxatricycloLactoneSingleNeighbor(
        finalSulfonylOxatricycloLactoneHeavyNeighborIds(layoutGraph, ringNitrogen, ringAtomIds),
        ({ atomId, atom }) => atomId !== ringSulfur && atom.element === 'C'
      )?.atomId ?? null;
    const ringJunctionCarbon = azaBridgeCarbon
      ? (finalSulfonylOxatricycloLactoneSingleNeighbor(
          finalSulfonylOxatricycloLactoneHeavyNeighborIds(layoutGraph, azaBridgeCarbon, ringAtomIds),
          ({ atomId, atom }) => atomId !== ringNitrogen && atom.element === 'C'
        )?.atomId ?? null)
      : null;
    const sulfoneBridgeCarbonNeighbors = finalSulfonylOxatricycloLactoneHeavyNeighborIds(layoutGraph, sulfoneBridgeCarbon, ringAtomIds).filter(({ atomId }) => atomId !== ringSulfur);
    const formylBridgeCarbon = sulfoneBridgeCarbonNeighbors.find(({ atomId }) => layoutGraph.bondByAtomPair?.has(atomPairKey(atomId, ringJunctionCarbon)) ?? false)?.atomId ?? null;
    const oxetaneSp3Carbon = sulfoneBridgeCarbonNeighbors.find(({ atomId }) => atomId !== formylBridgeCarbon)?.atomId ?? null;
    const oxetaneBridgeCarbon = ringJunctionCarbon
      ? (finalSulfonylOxatricycloLactoneSingleNeighbor(
          finalSulfonylOxatricycloLactoneHeavyNeighborIds(layoutGraph, ringJunctionCarbon, ringAtomIds),
          ({ atomId, atom }) => atomId !== azaBridgeCarbon && atomId !== formylBridgeCarbon && atom.element === 'C'
        )?.atomId ?? null)
      : null;
    const commonOxetaneNeighbors =
      oxetaneBridgeCarbon && oxetaneSp3Carbon
        ? finalSulfonylOxatricycloLactoneHeavyNeighborIds(layoutGraph, oxetaneBridgeCarbon, ringAtomIds)
            .map(({ atomId }) => atomId)
            .filter(atomId => layoutGraph.bondByAtomPair?.has(atomPairKey(atomId, oxetaneSp3Carbon)) ?? false)
        : [];
    const lactoneCarbonylCarbon = commonOxetaneNeighbors.find(atomId => layoutGraph.atoms.get(atomId)?.element === 'C') ?? null;
    const ringEtherOxygen = commonOxetaneNeighbors.find(atomId => layoutGraph.atoms.get(atomId)?.element === 'O') ?? null;
    const methylCarbon = oxetaneBridgeCarbon
      ? (finalSulfonylOxatricycloLactoneSingleNeighbor(
          finalSulfonylOxatricycloLactoneHeavyNeighborIds(layoutGraph, oxetaneBridgeCarbon),
          ({ atomId, atom, bond }) => !ringAtomIds.has(atomId) && atom.element === 'C' && !bond.inRing && (bond.order ?? 1) === 1
        )?.atomId ?? null)
      : null;
    const hydroxyOxygen = formylBridgeCarbon
      ? (finalSulfonylOxatricycloLactoneSingleNeighbor(
          finalSulfonylOxatricycloLactoneHeavyNeighborIds(layoutGraph, formylBridgeCarbon),
          ({ atomId, atom, bond }) => !ringAtomIds.has(atomId) && atom.element === 'O' && !bond.inRing && (bond.order ?? 1) === 1
        )?.atomId ?? null)
      : null;
    const formylCarbon = formylBridgeCarbon
      ? (finalSulfonylOxatricycloLactoneSingleNeighbor(
          finalSulfonylOxatricycloLactoneHeavyNeighborIds(layoutGraph, formylBridgeCarbon),
          ({ atomId, atom, bond }) => !ringAtomIds.has(atomId) && atom.element === 'C' && !bond.inRing && (bond.order ?? 1) === 1
        )?.atomId ?? null)
      : null;
    const formylOxygen = formylCarbon ? finalSulfonylOxatricycloLactoneDoubleOxygenNeighbor(layoutGraph, formylCarbon) : null;
    const lactoneCarbonylOxygen = lactoneCarbonylCarbon ? finalSulfonylOxatricycloLactoneDoubleOxygenNeighbor(layoutGraph, lactoneCarbonylCarbon) : null;

    for (const [role, atomId] of [
      ['methylCarbon', methylCarbon],
      ['oxetaneBridgeCarbon', oxetaneBridgeCarbon],
      ['ringEtherOxygen', ringEtherOxygen],
      ['oxetaneSp3Carbon', oxetaneSp3Carbon],
      ['sulfoneBridgeCarbon', sulfoneBridgeCarbon],
      ['formylBridgeCarbon', formylBridgeCarbon],
      ['hydroxyOxygen', hydroxyOxygen],
      ['formylCarbon', formylCarbon],
      ['formylOxygen', formylOxygen],
      ['ringJunctionCarbon', ringJunctionCarbon],
      ['azaBridgeCarbon', azaBridgeCarbon],
      ['ringNitrogen', ringNitrogen],
      ['ringSulfur', ringSulfur],
      ['sulfoneOxygenA', sulfoneOxygenIds[0]],
      ['sulfoneOxygenB', sulfoneOxygenIds[1]],
      ['lactoneCarbonylCarbon', lactoneCarbonylCarbon],
      ['lactoneCarbonylOxygen', lactoneCarbonylOxygen]
    ]) {
      if (!atomId || !coords.has(atomId) || roleEntries.has(role)) {
        roleEntries.clear();
        break;
      }
      roleEntries.set(role, atomId);
    }
    if (roleEntries.size !== Object.keys(FINAL_SULFONYL_OXATRICYCLO_LACTONE_PROJECTION).length) {
      continue;
    }
    const movedAtomIds = [...new Set([...roleEntries.values()])];
    if (movedAtomIds.length !== roleEntries.size || movedAtomIds.some(atomId => layoutGraph.fixedCoords?.has(atomId))) {
      continue;
    }
    return {
      roleEntries,
      movedAtomIds,
      promotedAtomIds: movedAtomIds
    };
  }

  return null;
}

function finalSulfonylOxatricycloLactoneProjectionCoords(coords, descriptor, bondLength) {
  const currentCentroid = centroidForAtomIds(coords, descriptor.movedAtomIds);
  if (!currentCentroid) {
    return null;
  }
  const normalizedEntries = [...descriptor.roleEntries.entries()].map(([role, atomId]) => [atomId, FINAL_SULFONYL_OXATRICYCLO_LACTONE_PROJECTION[role]]);
  const projectionCentroid = centroidForPoints(normalizedEntries.map(([, point]) => point));
  if (!projectionCentroid) {
    return null;
  }
  const candidateCoords = cloneCoords(coords);
  for (const [atomId, point] of normalizedEntries) {
    candidateCoords.set(atomId, {
      x: currentCentroid.x + (point.x - projectionCentroid.x) * bondLength,
      y: currentCentroid.y + (point.y - projectionCentroid.y) * bondLength
    });
  }
  return candidateCoords;
}

function maybeRetouchFinalSulfonylOxatricycloLactone(molecule, layoutGraph, finalCoords, placement, bondLength) {
  const currentAudit = auditFinalRetouchCoords(molecule, layoutGraph, finalCoords, placement, bondLength);
  const descriptor = finalSulfonylOxatricycloLactoneDescriptor(layoutGraph, finalCoords, currentAudit);
  if (!descriptor) {
    return {
      changed: false,
      coords: finalCoords,
      movedAtomIds: [],
      audit: currentAudit,
      currentAudit
    };
  }
  const candidateCoords = finalSulfonylOxatricycloLactoneProjectionCoords(finalCoords, descriptor, bondLength);
  if (!candidateCoords) {
    return {
      changed: false,
      coords: finalCoords,
      movedAtomIds: [],
      audit: currentAudit,
      currentAudit
    };
  }
  const candidateBondValidationClasses = assignBondValidationClass(layoutGraph, descriptor.promotedAtomIds, 'bridged', new Map(placement.bondValidationClasses), {
    overwrite: true
  });
  const candidateAudit = auditFinalRetouchCoords(molecule, layoutGraph, candidateCoords, placement, bondLength, candidateBondValidationClasses);
  if (
    candidateAudit?.ok !== true ||
    candidateAudit.fallback?.mode != null ||
    !finalAuditCountsDoNotWorsen(candidateAudit, currentAudit) ||
    (candidateAudit.bondLengthFailureCount ?? 0) !== 0 ||
    (candidateAudit.severeOverlapCount ?? 0) !== 0 ||
    (candidateAudit.labelOverlapCount ?? 0) !== 0 ||
    (candidateAudit.ringSubstituentReadabilityFailureCount ?? 0) !== 0 ||
    (candidateAudit.collapsedMacrocycleCount ?? 0) !== 0 ||
    (candidateAudit.stereoContradiction ?? false)
  ) {
    return {
      changed: false,
      coords: finalCoords,
      movedAtomIds: [],
      audit: currentAudit,
      currentAudit
    };
  }
  return {
    changed: true,
    coords: candidateCoords,
    bondValidationClasses: candidateBondValidationClasses,
    movedAtomIds: descriptor.movedAtomIds,
    audit: candidateAudit,
    currentAudit
  };
}

function bridgedRingSystemForBond(layoutGraph, firstAtomId, secondAtomId) {
  const ringSystemId = layoutGraph.atomToRingSystemId.get(firstAtomId);
  if (ringSystemId == null || ringSystemId !== layoutGraph.atomToRingSystemId.get(secondAtomId)) {
    return null;
  }
  const ringSystem = layoutGraph.ringSystemById.get(ringSystemId);
  const ringIds = new Set(ringSystem?.ringIds ?? []);
  const hasAnyBridgedConnection =
    ringIds.size > 0 && (layoutGraph.ringConnections ?? []).some(connection => connection.kind === 'bridged' && (ringIds.has(connection.firstRingId) || ringIds.has(connection.secondRingId)));
  return ringSystem && hasAnyBridgedConnection ? ringSystem : null;
}

function stretchedBridgedRingBondMovedAtomIds(layoutGraph, coords, atomId) {
  if (layoutGraph.fixedCoords?.has(atomId)) {
    return [];
  }
  const movedAtomIds = [atomId];
  for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
    const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (neighborAtom?.element === 'H' && coords.has(neighborAtomId) && !layoutGraph.fixedCoords?.has(neighborAtomId)) {
      movedAtomIds.push(neighborAtomId);
    }
  }
  return movedAtomIds;
}

function stretchedBridgedRingBondSideAtomIds(layoutGraph, coords, startAtomId, blockedAtomId) {
  if (layoutGraph.fixedCoords?.has(startAtomId)) {
    return [];
  }
  const movedAtomIds = new Set([startAtomId]);
  const stack = [startAtomId];
  while (stack.length > 0) {
    const atomId = stack.pop();
    for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
      if (neighborAtomId === blockedAtomId || movedAtomIds.has(neighborAtomId)) {
        continue;
      }
      if (layoutGraph.fixedCoords?.has(neighborAtomId)) {
        return [];
      }
      movedAtomIds.add(neighborAtomId);
      stack.push(neighborAtomId);
    }
  }
  return [...movedAtomIds].filter(atomId => coords.has(atomId));
}

function stretchedBridgedRingBondAcyclicBranchAtomIds(layoutGraph, coords, startAtomId) {
  if (layoutGraph.fixedCoords?.has(startAtomId)) {
    return [];
  }
  const movedAtomIds = new Set([startAtomId]);
  const stack = [startAtomId];
  while (stack.length > 0) {
    const atomId = stack.pop();
    for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
      if (!bond || bond.kind !== 'covalent' || bond.inRing) {
        continue;
      }
      const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
      if (movedAtomIds.has(neighborAtomId)) {
        continue;
      }
      if (layoutGraph.fixedCoords?.has(neighborAtomId)) {
        return [];
      }
      movedAtomIds.add(neighborAtomId);
      stack.push(neighborAtomId);
    }
  }
  return [...movedAtomIds].filter(atomId => coords.has(atomId));
}

function stretchedBridgedRingBondAdjacentTailAtomIds(layoutGraph, coords, startAtomId, blockedAtomId) {
  if (layoutGraph.fixedCoords?.has(startAtomId)) {
    return [];
  }
  const movedAtomIds = new Set(stretchedBridgedRingBondAcyclicBranchAtomIds(layoutGraph, coords, startAtomId));
  if (movedAtomIds.size === 0) {
    return [];
  }
  for (const bond of layoutGraph.bondsByAtomId.get(startAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent' || !bond.inRing) {
      continue;
    }
    const neighborAtomId = bond.a === startAtomId ? bond.b : bond.a;
    if (neighborAtomId === blockedAtomId || movedAtomIds.has(neighborAtomId)) {
      continue;
    }
    if (layoutGraph.fixedCoords?.has(neighborAtomId)) {
      return [];
    }
    for (const atomId of stretchedBridgedRingBondAcyclicBranchAtomIds(layoutGraph, coords, neighborAtomId)) {
      movedAtomIds.add(atomId);
    }
  }
  const heavyAtomCount = [...movedAtomIds].filter(atomId => layoutGraph.atoms.get(atomId)?.element !== 'H').length;
  if (heavyAtomCount > FINAL_STRETCHED_BRIDGED_RING_BOND_ADJACENT_TAIL_MAX_HEAVY_ATOMS) {
    return [];
  }
  return [...movedAtomIds].filter(atomId => coords.has(atomId));
}

function compactBridgedRemoteTwoAtomPathBond(layoutGraph, firstAtomId, secondAtomId) {
  return layoutGraph.bondByAtomPair?.get(atomPairKey(firstAtomId, secondAtomId)) ?? null;
}

function compactBridgedRemoteTwoAtomPathEdge(layoutGraph, coords, firstAtomId, secondAtomId, placement, bondLength) {
  const bond = compactBridgedRemoteTwoAtomPathBond(layoutGraph, firstAtomId, secondAtomId);
  const firstPosition = coords.get(firstAtomId);
  const secondPosition = coords.get(secondAtomId);
  if (!bond || !bond.inRing || bond.kind !== 'covalent' || !firstPosition || !secondPosition) {
    return null;
  }
  const validationClass = placement.bondValidationClasses?.get(bond.id);
  const allowedDeviation = finalRetouchAllowedBondDeviation(validationClass, bondLength);
  const currentDistance = Math.hypot(secondPosition.x - firstPosition.x, secondPosition.y - firstPosition.y);
  return {
    bond,
    atomIds: [firstAtomId, secondAtomId],
    distance: currentDistance,
    allowedDeviation,
    stretched: currentDistance > bondLength + allowedDeviation + PRESENTATION_METRIC_EPSILON
  };
}

function compactBridgedRemoteTwoAtomPathOtherEndpoint(edge, atomId) {
  if (edge.atomIds[0] === atomId) {
    return edge.atomIds[1];
  }
  return edge.atomIds[1] === atomId ? edge.atomIds[0] : null;
}

function compactBridgedRemoteTwoAtomPathAcyclicGroup(layoutGraph, coords, atomId) {
  const atomIds = stretchedBridgedRingBondAcyclicBranchAtomIds(layoutGraph, coords, atomId);
  if (!atomIds.includes(atomId)) {
    atomIds.unshift(atomId);
  }
  return [...new Set(atomIds)].filter(candidateAtomId => coords.has(candidateAtomId));
}

function compactBridgedRemoteTwoAtomPathCandidateSideOrder(coords, descriptor) {
  const firstAnchorPosition = coords.get(descriptor.firstAnchorAtomId);
  const secondAnchorPosition = coords.get(descriptor.secondAnchorAtomId);
  const otherPathCentroid = centroidForAtomIds(coords, descriptor.otherPathAtomIds);
  if (!firstAnchorPosition || !secondAnchorPosition || !otherPathCentroid) {
    return [1, -1];
  }
  const dx = secondAnchorPosition.x - firstAnchorPosition.x;
  const dy = secondAnchorPosition.y - firstAnchorPosition.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= PRESENTATION_METRIC_EPSILON) {
    return [1, -1];
  }
  const normalX = -dy / distance;
  const normalY = dx / distance;
  const side = Math.sign((otherPathCentroid.x - firstAnchorPosition.x) * normalX + (otherPathCentroid.y - firstAnchorPosition.y) * normalY) || 1;
  return [side, -side];
}

function compactBridgedRemoteTwoAtomPathDescriptors(layoutGraph, coords, placement, bondLength, baseAudit) {
  if (
    !baseAudit ||
    (baseAudit.bondLengthFailureCount ?? 0) !== 2 ||
    (baseAudit.severeBondLengthFailureCount ?? 0) !== 2 ||
    (baseAudit.mildBondLengthFailureCount ?? 0) !== 0 ||
    (baseAudit.severeOverlapCount ?? 0) !== 0 ||
    (baseAudit.labelOverlapCount ?? 0) !== 0 ||
    (baseAudit.ringSubstituentReadabilityFailureCount ?? 0) !== 0 ||
    (baseAudit.collapsedMacrocycleCount ?? 0) !== 0 ||
    (baseAudit.stereoContradiction ?? false) ||
    (baseAudit.visibleHeavyBondCrossingCount ?? 0) > FINAL_COMPACT_BRIDGED_REMOTE_TWO_ATOM_PATH_MAX_CROSSINGS ||
    visibleHeavyAtomCountForCoords(layoutGraph, coords) > FINAL_COMPACT_BRIDGED_REMOTE_TWO_ATOM_PATH_MAX_HEAVY_ATOMS
  ) {
    return [];
  }

  const descriptors = [];
  for (const ring of layoutGraph.rings ?? []) {
    if (!ring || ring.aromatic || ring.atomIds.length !== 5 || ring.atomIds.some(atomId => !coords.has(atomId))) {
      continue;
    }
    const ringSystemId = layoutGraph.atomToRingSystemId.get(ring.atomIds[0]);
    const ringSystem = ringSystemId == null ? null : layoutGraph.ringSystemById.get(ringSystemId);
    if (!ringSystem || (ringSystem.atomIds?.length ?? 0) > FINAL_COMPACT_BRIDGED_REMOTE_TWO_ATOM_PATH_MAX_HEAVY_ATOMS) {
      continue;
    }
    const ringIds = new Set(ringSystem.ringIds ?? []);
    const hasBridgedConnection = (layoutGraph.ringConnections ?? []).some(connection => connection.kind === 'bridged' && ringIds.has(connection.firstRingId) && ringIds.has(connection.secondRingId));
    if (!hasBridgedConnection) {
      continue;
    }

    const edges = [];
    for (let index = 0; index < ring.atomIds.length; index++) {
      const firstAtomId = ring.atomIds[index];
      const secondAtomId = ring.atomIds[(index + 1) % ring.atomIds.length];
      const edge = compactBridgedRemoteTwoAtomPathEdge(layoutGraph, coords, firstAtomId, secondAtomId, placement, bondLength);
      if (edge) {
        edges.push(edge);
      }
    }
    if (edges.length !== ring.atomIds.length) {
      continue;
    }
    const stretchedEdges = edges.filter(edge => edge.stretched);
    if (stretchedEdges.length !== 2) {
      continue;
    }

    for (const middleEdge of edges) {
      if (middleEdge.stretched) {
        continue;
      }
      const [firstRemoteAtomId, secondRemoteAtomId] = middleEdge.atomIds;
      const firstStretchedEdge = stretchedEdges.find(edge => edge.atomIds.includes(firstRemoteAtomId));
      const secondStretchedEdge = stretchedEdges.find(edge => edge.atomIds.includes(secondRemoteAtomId));
      if (!firstStretchedEdge || !secondStretchedEdge || firstStretchedEdge === secondStretchedEdge) {
        continue;
      }
      const firstAnchorAtomId = compactBridgedRemoteTwoAtomPathOtherEndpoint(firstStretchedEdge, firstRemoteAtomId);
      const secondAnchorAtomId = compactBridgedRemoteTwoAtomPathOtherEndpoint(secondStretchedEdge, secondRemoteAtomId);
      if (!firstAnchorAtomId || !secondAnchorAtomId || firstAnchorAtomId === secondAnchorAtomId) {
        continue;
      }
      const movedAtomIds = new Set([
        ...compactBridgedRemoteTwoAtomPathAcyclicGroup(layoutGraph, coords, firstRemoteAtomId),
        ...compactBridgedRemoteTwoAtomPathAcyclicGroup(layoutGraph, coords, secondRemoteAtomId)
      ]);
      if (movedAtomIds.has(firstAnchorAtomId) || movedAtomIds.has(secondAnchorAtomId)) {
        continue;
      }
      const movedHeavyAtomCount = [...movedAtomIds].filter(atomId => layoutGraph.atoms.get(atomId)?.element !== 'H').length;
      if (movedHeavyAtomCount > FINAL_COMPACT_BRIDGED_REMOTE_TWO_ATOM_PATH_MAX_MOVED_HEAVY_ATOMS) {
        continue;
      }
      const otherPathAtomIds = ring.atomIds.filter(atomId => atomId !== firstRemoteAtomId && atomId !== secondRemoteAtomId && atomId !== firstAnchorAtomId && atomId !== secondAnchorAtomId);
      descriptors.push({
        ringAtomIds: ringSystem.atomIds ?? ring.atomIds,
        bondIds: [firstStretchedEdge.bond.id, middleEdge.bond.id, secondStretchedEdge.bond.id],
        firstAnchorAtomId,
        firstRemoteAtomId,
        secondRemoteAtomId,
        secondAnchorAtomId,
        firstMovedAtomIds: compactBridgedRemoteTwoAtomPathAcyclicGroup(layoutGraph, coords, firstRemoteAtomId),
        secondMovedAtomIds: compactBridgedRemoteTwoAtomPathAcyclicGroup(layoutGraph, coords, secondRemoteAtomId),
        otherPathAtomIds
      });
    }
  }

  return descriptors;
}

function compactBridgedRemoteTwoAtomPathTargets(coords, descriptor, bondLength, side, middleFactor, heightFactor) {
  const firstAnchorPosition = coords.get(descriptor.firstAnchorAtomId);
  const secondAnchorPosition = coords.get(descriptor.secondAnchorAtomId);
  if (!firstAnchorPosition || !secondAnchorPosition) {
    return null;
  }
  const dx = secondAnchorPosition.x - firstAnchorPosition.x;
  const dy = secondAnchorPosition.y - firstAnchorPosition.y;
  const anchorDistance = Math.hypot(dx, dy);
  if (anchorDistance <= PRESENTATION_METRIC_EPSILON) {
    return null;
  }
  const middleDistance = bondLength * middleFactor;
  const sideRun = (anchorDistance - middleDistance) / 2;
  if (sideRun <= PRESENTATION_METRIC_EPSILON || sideRun > bondLength + PRESENTATION_METRIC_EPSILON) {
    return null;
  }
  const heightSquared = bondLength ** 2 - sideRun ** 2;
  if (heightSquared < -PRESENTATION_METRIC_EPSILON) {
    return null;
  }
  const height = Math.sqrt(Math.max(0, heightSquared)) * heightFactor;
  const unitX = dx / anchorDistance;
  const unitY = dy / anchorDistance;
  const normalX = -unitY * side;
  const normalY = unitX * side;
  return {
    firstRemotePosition: {
      x: firstAnchorPosition.x + unitX * sideRun + normalX * height,
      y: firstAnchorPosition.y + unitY * sideRun + normalY * height
    },
    secondRemotePosition: {
      x: firstAnchorPosition.x + unitX * (sideRun + middleDistance) + normalX * height,
      y: firstAnchorPosition.y + unitY * (sideRun + middleDistance) + normalY * height
    }
  };
}

function compactBridgedRemoteTwoAtomPathCandidate(coords, descriptor, bondLength, side, middleFactor, heightFactor, branchRotation) {
  const targets = compactBridgedRemoteTwoAtomPathTargets(coords, descriptor, bondLength, side, middleFactor, heightFactor);
  const firstRemotePosition = coords.get(descriptor.firstRemoteAtomId);
  const secondRemotePosition = coords.get(descriptor.secondRemoteAtomId);
  if (!targets || !firstRemotePosition || !secondRemotePosition) {
    return null;
  }
  const candidateCoords = cloneCoords(coords);
  translateAtomGroup(candidateCoords, coords, descriptor.firstMovedAtomIds, {
    x: targets.firstRemotePosition.x - firstRemotePosition.x,
    y: targets.firstRemotePosition.y - firstRemotePosition.y
  });
  translateAtomGroup(candidateCoords, coords, descriptor.secondMovedAtomIds, {
    x: targets.secondRemotePosition.x - secondRemotePosition.x,
    y: targets.secondRemotePosition.y - secondRemotePosition.y
  });
  if (Math.abs(branchRotation) > PRESENTATION_METRIC_EPSILON) {
    for (const atomId of descriptor.firstMovedAtomIds) {
      if (atomId === descriptor.firstRemoteAtomId) {
        continue;
      }
      const position = candidateCoords.get(atomId);
      if (position) {
        candidateCoords.set(atomId, rotateAround(position, targets.firstRemotePosition, branchRotation));
      }
    }
    for (const atomId of descriptor.secondMovedAtomIds) {
      if (atomId === descriptor.secondRemoteAtomId) {
        continue;
      }
      const position = candidateCoords.get(atomId);
      if (position) {
        candidateCoords.set(atomId, rotateAround(position, targets.secondRemotePosition, branchRotation));
      }
    }
  }
  return {
    coords: candidateCoords,
    movedAtomIds: [...new Set([...descriptor.firstMovedAtomIds, ...descriptor.secondMovedAtomIds])]
  };
}

function maybeRetouchFinalCompactBridgedRemoteTwoAtomPath(molecule, layoutGraph, finalCoords, placement, bondLength) {
  const currentAudit = auditFinalRetouchCoords(molecule, layoutGraph, finalCoords, placement, bondLength);
  const descriptors = compactBridgedRemoteTwoAtomPathDescriptors(layoutGraph, finalCoords, placement, bondLength, currentAudit);
  if (descriptors.length === 0) {
    return {
      changed: false,
      coords: finalCoords,
      movedAtomIds: [],
      audit: currentAudit,
      currentAudit
    };
  }

  let bestCandidate = null;
  for (const descriptor of descriptors) {
    const sideOrder = compactBridgedRemoteTwoAtomPathCandidateSideOrder(finalCoords, descriptor);
    const candidateBondValidationClasses = assignBondValidationClass(layoutGraph, descriptor.ringAtomIds, 'bridged', new Map(placement.bondValidationClasses), { overwrite: true });
    for (const side of sideOrder) {
      for (const middleFactor of FINAL_COMPACT_BRIDGED_REMOTE_TWO_ATOM_PATH_MIDDLE_FACTORS) {
        for (const heightFactor of FINAL_COMPACT_BRIDGED_REMOTE_TWO_ATOM_PATH_HEIGHT_FACTORS) {
          for (const branchRotation of FINAL_COMPACT_BRIDGED_REMOTE_TWO_ATOM_PATH_BRANCH_ROTATIONS) {
            const candidate = compactBridgedRemoteTwoAtomPathCandidate(finalCoords, descriptor, bondLength, side, middleFactor, heightFactor, branchRotation);
            if (!candidate) {
              continue;
            }
            const candidateAudit = auditFinalRetouchCoords(molecule, layoutGraph, candidate.coords, placement, bondLength, candidateBondValidationClasses);
            if (
              candidateAudit?.ok !== true ||
              candidateAudit.fallback?.mode != null ||
              !finalAuditCountsDoNotWorsen(candidateAudit, currentAudit) ||
              (candidateAudit.bondLengthFailureCount ?? 0) !== 0 ||
              (candidateAudit.severeOverlapCount ?? 0) !== 0 ||
              (candidateAudit.labelOverlapCount ?? 0) !== 0 ||
              (candidateAudit.ringSubstituentReadabilityFailureCount ?? 0) !== 0 ||
              (candidateAudit.collapsedMacrocycleCount ?? 0) !== 0 ||
              (candidateAudit.stereoContradiction ?? false)
            ) {
              continue;
            }
            const scoredCandidate = {
              coords: candidate.coords,
              audit: candidateAudit,
              bondValidationClasses: candidateBondValidationClasses,
              bondId: descriptor.bondIds.join('-'),
              movedAtomIds: candidate.movedAtomIds,
              totalMove: finalAcyclicBranchContactCandidateMove(finalCoords, candidate.coords, candidate.movedAtomIds)
            };
            if (compareStretchedBridgedRingBondCandidates(scoredCandidate, bestCandidate) < 0) {
              bestCandidate = scoredCandidate;
            }
          }
        }
      }
    }
  }

  if (!bestCandidate) {
    return {
      changed: false,
      coords: finalCoords,
      movedAtomIds: [],
      audit: currentAudit,
      currentAudit
    };
  }
  return {
    changed: true,
    coords: bestCandidate.coords,
    bondValidationClasses: bestCandidate.bondValidationClasses,
    movedAtomIds: bestCandidate.movedAtomIds,
    audit: bestCandidate.audit,
    currentAudit
  };
}

function pairedBridgedHingeBondFailures(layoutGraph, coords, placement, bondLength, baseAudit) {
  if (
    !baseAudit ||
    (baseAudit.bondLengthFailureCount ?? 0) !== 2 ||
    (baseAudit.mildBondLengthFailureCount ?? 0) !== 2 ||
    (baseAudit.severeBondLengthFailureCount ?? 0) !== 0 ||
    (baseAudit.severeOverlapCount ?? 0) !== 0 ||
    (baseAudit.labelOverlapCount ?? 0) !== 0 ||
    (baseAudit.ringSubstituentReadabilityFailureCount ?? 0) !== 0 ||
    (baseAudit.collapsedMacrocycleCount ?? 0) !== 0 ||
    (baseAudit.stereoContradiction ?? false) ||
    (baseAudit.visibleHeavyBondCrossingCount ?? 0) > 3 ||
    visibleHeavyAtomCountForCoords(layoutGraph, coords) > FINAL_PAIRED_BRIDGED_HINGE_BOND_MAX_HEAVY_ATOMS
  ) {
    return [];
  }

  const failures = [];
  for (const bond of layoutGraph.bonds.values()) {
    if (!bond || bond.kind !== 'covalent' || !bond.inRing || bond.aromatic || !coords.has(bond.a) || !coords.has(bond.b)) {
      continue;
    }
    const firstAtom = layoutGraph.atoms.get(bond.a);
    const secondAtom = layoutGraph.atoms.get(bond.b);
    if (
      !firstAtom ||
      !secondAtom ||
      firstAtom.element === 'H' ||
      secondAtom.element === 'H' ||
      firstAtom.visible === false ||
      secondAtom.visible === false ||
      placement.bondValidationClasses?.get(bond.id) !== 'bridged'
    ) {
      continue;
    }
    const ringSystem = bridgedRingSystemForBond(layoutGraph, bond.a, bond.b);
    if (!ringSystem || (ringSystem.atomIds?.length ?? 0) > FINAL_PAIRED_BRIDGED_HINGE_BOND_MAX_HEAVY_ATOMS) {
      continue;
    }
    const firstPosition = coords.get(bond.a);
    const secondPosition = coords.get(bond.b);
    const distance = Math.hypot(secondPosition.x - firstPosition.x, secondPosition.y - firstPosition.y);
    const allowedDeviation = finalRetouchAllowedBondDeviation('bridged', bondLength);
    const deviation = Math.abs(distance - bondLength);
    if (deviation <= allowedDeviation + PRESENTATION_METRIC_EPSILON) {
      continue;
    }
    failures.push({
      bondId: bond.id,
      firstAtomId: bond.a,
      secondAtomId: bond.b,
      ringSystemId: layoutGraph.atomToRingSystemId.get(bond.a),
      distance,
      allowedDeviation,
      kind: distance > bondLength ? 'stretched' : 'compressed'
    });
  }
  return failures;
}

function pairedBridgedHingeBondDescriptor(layoutGraph, coords, placement, bondLength, baseAudit) {
  const failures = pairedBridgedHingeBondFailures(layoutGraph, coords, placement, bondLength, baseAudit);
  if (failures.length !== 2 || failures[0].ringSystemId !== failures[1].ringSystemId) {
    return null;
  }
  const stretchedFailure = failures.find(failure => failure.kind === 'stretched');
  const compressedFailure = failures.find(failure => failure.kind === 'compressed');
  if (!stretchedFailure || !compressedFailure) {
    return null;
  }
  const stretchedAtoms = new Set([stretchedFailure.firstAtomId, stretchedFailure.secondAtomId]);
  const compressedAtoms = [compressedFailure.firstAtomId, compressedFailure.secondAtomId];
  const hingeAtomId = compressedAtoms.find(atomId => stretchedAtoms.has(atomId));
  if (!hingeAtomId) {
    return null;
  }
  const stretchedEndpointAtomId = stretchedFailure.firstAtomId === hingeAtomId ? stretchedFailure.secondAtomId : stretchedFailure.firstAtomId;
  const compressedEndpointAtomId = compressedFailure.firstAtomId === hingeAtomId ? compressedFailure.secondAtomId : compressedFailure.firstAtomId;
  if (stretchedEndpointAtomId === compressedEndpointAtomId || layoutGraph.fixedCoords?.has(stretchedEndpointAtomId) || layoutGraph.fixedCoords?.has(compressedEndpointAtomId)) {
    return null;
  }
  const stretchedMovedAtomIds = stretchedBridgedRingBondMovedAtomIds(layoutGraph, coords, stretchedEndpointAtomId);
  const compressedMovedAtomIds = stretchedBridgedRingBondMovedAtomIds(layoutGraph, coords, compressedEndpointAtomId);
  if (stretchedMovedAtomIds.length === 0 || compressedMovedAtomIds.length === 0) {
    return null;
  }
  const movedAtomIds = new Set([...stretchedMovedAtomIds, ...compressedMovedAtomIds]);
  if (movedAtomIds.size !== stretchedMovedAtomIds.length + compressedMovedAtomIds.length || movedAtomIds.has(hingeAtomId)) {
    return null;
  }
  const stretchedTargetDistance = bondLength + stretchedFailure.allowedDeviation * FINAL_STRETCHED_BRIDGED_RING_BOND_TARGET_DEVIATION_FACTOR;
  const compressedTargetDistance = bondLength - compressedFailure.allowedDeviation * FINAL_STRETCHED_BRIDGED_RING_BOND_TARGET_DEVIATION_FACTOR;
  const stretchedShift = stretchedFailure.distance - stretchedTargetDistance;
  const compressedShift = compressedTargetDistance - compressedFailure.distance;
  if (stretchedShift <= PRESENTATION_METRIC_EPSILON || compressedShift <= PRESENTATION_METRIC_EPSILON) {
    return null;
  }

  return {
    bondIds: [stretchedFailure.bondId, compressedFailure.bondId],
    hingeAtomId,
    stretchedEndpointAtomId,
    compressedEndpointAtomId,
    stretchedMovedAtomIds,
    compressedMovedAtomIds,
    stretchedShift,
    compressedShift
  };
}

function pairedBridgedHingeBondCandidate(coords, descriptor, stretchedShiftFactor, compressedShiftFactor) {
  const hingePosition = coords.get(descriptor.hingeAtomId);
  const stretchedEndpointPosition = coords.get(descriptor.stretchedEndpointAtomId);
  const compressedEndpointPosition = coords.get(descriptor.compressedEndpointAtomId);
  if (!hingePosition || !stretchedEndpointPosition || !compressedEndpointPosition) {
    return null;
  }
  const stretchedVector = {
    x: hingePosition.x - stretchedEndpointPosition.x,
    y: hingePosition.y - stretchedEndpointPosition.y
  };
  const compressedVector = {
    x: compressedEndpointPosition.x - hingePosition.x,
    y: compressedEndpointPosition.y - hingePosition.y
  };
  const stretchedDistance = Math.hypot(stretchedVector.x, stretchedVector.y);
  const compressedDistance = Math.hypot(compressedVector.x, compressedVector.y);
  if (stretchedDistance <= PRESENTATION_METRIC_EPSILON || compressedDistance <= PRESENTATION_METRIC_EPSILON) {
    return null;
  }
  const candidateCoords = cloneCoords(coords);
  translateAtomGroup(candidateCoords, coords, descriptor.stretchedMovedAtomIds, {
    x: (stretchedVector.x / stretchedDistance) * descriptor.stretchedShift * stretchedShiftFactor,
    y: (stretchedVector.y / stretchedDistance) * descriptor.stretchedShift * stretchedShiftFactor
  });
  translateAtomGroup(candidateCoords, coords, descriptor.compressedMovedAtomIds, {
    x: (compressedVector.x / compressedDistance) * descriptor.compressedShift * compressedShiftFactor,
    y: (compressedVector.y / compressedDistance) * descriptor.compressedShift * compressedShiftFactor
  });
  return {
    coords: candidateCoords,
    movedAtomIds: [...new Set([...descriptor.stretchedMovedAtomIds, ...descriptor.compressedMovedAtomIds])]
  };
}

function comparePairedBridgedHingeBondCandidates(candidate, incumbent) {
  if (!incumbent) {
    return -1;
  }
  return compareStretchedBridgedRingBondCandidates(candidate, incumbent);
}

function maybeRetouchFinalPairedBridgedHingeBonds(molecule, layoutGraph, finalCoords, placement, bondLength) {
  const currentAudit = auditFinalRetouchCoords(molecule, layoutGraph, finalCoords, placement, bondLength);
  const descriptor = pairedBridgedHingeBondDescriptor(layoutGraph, finalCoords, placement, bondLength, currentAudit);
  if (!descriptor) {
    return {
      changed: false,
      coords: finalCoords,
      movedAtomIds: [],
      audit: currentAudit
    };
  }

  let bestCandidate = null;
  for (const stretchedShiftFactor of FINAL_PAIRED_BRIDGED_HINGE_BOND_STRETCHED_SHIFT_FACTORS) {
    for (const compressedShiftFactor of FINAL_PAIRED_BRIDGED_HINGE_BOND_COMPRESSED_SHIFT_FACTORS) {
      const candidate = pairedBridgedHingeBondCandidate(finalCoords, descriptor, stretchedShiftFactor, compressedShiftFactor);
      if (!candidate) {
        continue;
      }
      const candidateAudit = auditFinalRetouchCoords(molecule, layoutGraph, candidate.coords, placement, bondLength);
      if (!stretchedBridgedRingBondCandidateCanReplace(candidateAudit, currentAudit)) {
        continue;
      }
      const scoredCandidate = {
        coords: candidate.coords,
        audit: candidateAudit,
        bondId: descriptor.bondIds.join('-'),
        movedAtomIds: candidate.movedAtomIds,
        totalMove: finalAcyclicBranchContactCandidateMove(finalCoords, candidate.coords, candidate.movedAtomIds)
      };
      if (comparePairedBridgedHingeBondCandidates(scoredCandidate, bestCandidate) < 0) {
        bestCandidate = scoredCandidate;
      }
    }
  }

  if (!bestCandidate) {
    return {
      changed: false,
      coords: finalCoords,
      movedAtomIds: [],
      audit: currentAudit
    };
  }
  return {
    changed: true,
    coords: bestCandidate.coords,
    movedAtomIds: bestCandidate.movedAtomIds,
    audit: bestCandidate.audit
  };
}

function pairedStretchedBridgedRingBondDescriptors(layoutGraph, coords, placement, bondLength, baseAudit) {
  if (
    !baseAudit ||
    (baseAudit.bondLengthFailureCount ?? 0) !== 2 ||
    (baseAudit.mildBondLengthFailureCount ?? 0) !== 2 ||
    (baseAudit.severeBondLengthFailureCount ?? 0) !== 0 ||
    (baseAudit.severeOverlapCount ?? 0) !== 0 ||
    (baseAudit.labelOverlapCount ?? 0) !== 0 ||
    (baseAudit.ringSubstituentReadabilityFailureCount ?? 0) !== 0 ||
    (baseAudit.collapsedMacrocycleCount ?? 0) !== 0 ||
    (baseAudit.stereoContradiction ?? false) ||
    (baseAudit.visibleHeavyBondCrossingCount ?? 0) > 3 ||
    visibleHeavyAtomCountForCoords(layoutGraph, coords) > FINAL_PAIRED_STRETCHED_BRIDGED_RING_BOND_MAX_HEAVY_ATOMS
  ) {
    return [];
  }

  const descriptors = [];
  for (const bond of layoutGraph.bonds.values()) {
    if (!bond || bond.kind !== 'covalent' || !bond.inRing || bond.aromatic || !coords.has(bond.a) || !coords.has(bond.b)) {
      continue;
    }
    const firstAtom = layoutGraph.atoms.get(bond.a);
    const secondAtom = layoutGraph.atoms.get(bond.b);
    if (
      !firstAtom ||
      !secondAtom ||
      firstAtom.element === 'H' ||
      secondAtom.element === 'H' ||
      firstAtom.visible === false ||
      secondAtom.visible === false ||
      placement.bondValidationClasses?.get(bond.id) !== 'bridged'
    ) {
      continue;
    }
    const ringSystem = bridgedRingSystemForBond(layoutGraph, bond.a, bond.b);
    if (!ringSystem || (ringSystem.atomIds?.length ?? 0) > FINAL_PAIRED_STRETCHED_BRIDGED_RING_BOND_MAX_HEAVY_ATOMS) {
      continue;
    }
    const firstPosition = coords.get(bond.a);
    const secondPosition = coords.get(bond.b);
    const distance = Math.hypot(secondPosition.x - firstPosition.x, secondPosition.y - firstPosition.y);
    const allowedDeviation = finalRetouchAllowedBondDeviation('bridged', bondLength);
    if (distance <= bondLength + allowedDeviation + PRESENTATION_METRIC_EPSILON || distance > bondLength * FINAL_STRETCHED_BRIDGED_RING_BOND_MAX_DISTANCE_FACTOR + PRESENTATION_METRIC_EPSILON) {
      continue;
    }
    const targetDistance = bondLength + allowedDeviation * FINAL_STRETCHED_BRIDGED_RING_BOND_TARGET_DEVIATION_FACTOR;
    const requiredShift = distance - targetDistance;
    if (requiredShift <= PRESENTATION_METRIC_EPSILON) {
      continue;
    }
    const firstMovedAtomIds = stretchedBridgedRingBondMovedAtomIds(layoutGraph, coords, bond.a);
    const secondMovedAtomIds = stretchedBridgedRingBondMovedAtomIds(layoutGraph, coords, bond.b);
    if (firstMovedAtomIds.length === 0 && secondMovedAtomIds.length === 0) {
      continue;
    }
    descriptors.push({
      bondId: bond.id,
      ringSystemId: layoutGraph.atomToRingSystemId.get(bond.a),
      firstAtomId: bond.a,
      secondAtomId: bond.b,
      firstMovedAtomIds,
      secondMovedAtomIds,
      requiredShift
    });
  }

  if (descriptors.length !== 2 || descriptors[0].ringSystemId !== descriptors[1].ringSystemId) {
    return [];
  }
  const endpointIds = new Set(descriptors.flatMap(descriptor => [descriptor.firstAtomId, descriptor.secondAtomId]));
  return endpointIds.size === 4 ? descriptors : [];
}

function pairedStretchedBridgedRingBondCandidate(coords, descriptors, firstShiftFactor, secondShiftFactor, firstMode, secondMode) {
  const firstCandidate = stretchedBridgedRingBondCandidate(coords, descriptors[0], firstShiftFactor, firstMode);
  if (!firstCandidate) {
    return null;
  }
  const secondCandidate = stretchedBridgedRingBondCandidate(firstCandidate.coords, descriptors[1], secondShiftFactor, secondMode);
  if (!secondCandidate) {
    return null;
  }
  const movedAtomIds = new Set([...firstCandidate.movedAtomIds, ...secondCandidate.movedAtomIds]);
  if (movedAtomIds.size !== firstCandidate.movedAtomIds.length + secondCandidate.movedAtomIds.length) {
    return null;
  }
  return {
    coords: secondCandidate.coords,
    movedAtomIds: [...movedAtomIds]
  };
}

function maybeRetouchFinalPairedStretchedBridgedRingBonds(molecule, layoutGraph, finalCoords, placement, bondLength) {
  const currentAudit = auditFinalRetouchCoords(molecule, layoutGraph, finalCoords, placement, bondLength);
  const descriptors = pairedStretchedBridgedRingBondDescriptors(layoutGraph, finalCoords, placement, bondLength, currentAudit);
  if (descriptors.length !== 2) {
    return {
      changed: false,
      coords: finalCoords,
      movedAtomIds: [],
      audit: currentAudit
    };
  }

  let bestCandidate = null;
  for (const firstShiftFactor of FINAL_PAIRED_STRETCHED_BRIDGED_RING_BOND_SHIFT_FACTORS) {
    for (const secondShiftFactor of FINAL_PAIRED_STRETCHED_BRIDGED_RING_BOND_SHIFT_FACTORS) {
      for (const firstMode of ['first', 'second']) {
        for (const secondMode of ['first', 'second']) {
          const candidate = pairedStretchedBridgedRingBondCandidate(finalCoords, descriptors, firstShiftFactor, secondShiftFactor, firstMode, secondMode);
          if (!candidate) {
            continue;
          }
          const candidateAudit = auditFinalRetouchCoords(molecule, layoutGraph, candidate.coords, placement, bondLength);
          if (!stretchedBridgedRingBondCandidateCanReplace(candidateAudit, currentAudit)) {
            continue;
          }
          const scoredCandidate = {
            coords: candidate.coords,
            audit: candidateAudit,
            bondId: descriptors.map(descriptor => descriptor.bondId).join('-'),
            movedAtomIds: candidate.movedAtomIds,
            totalMove: finalAcyclicBranchContactCandidateMove(finalCoords, candidate.coords, candidate.movedAtomIds)
          };
          if (compareStretchedBridgedRingBondCandidates(scoredCandidate, bestCandidate) < 0) {
            bestCandidate = scoredCandidate;
          }
        }
      }
    }
  }

  if (!bestCandidate) {
    return {
      changed: false,
      coords: finalCoords,
      movedAtomIds: [],
      audit: currentAudit
    };
  }
  return {
    changed: true,
    coords: bestCandidate.coords,
    movedAtomIds: bestCandidate.movedAtomIds,
    audit: bestCandidate.audit
  };
}

function stretchedBridgedRingBondDescriptors(layoutGraph, coords, placement, bondLength, baseAudit) {
  if (
    !baseAudit ||
    (baseAudit.bondLengthFailureCount ?? 0) !== 1 ||
    (baseAudit.severeOverlapCount ?? 0) !== 0 ||
    (baseAudit.labelOverlapCount ?? 0) !== 0 ||
    (baseAudit.ringSubstituentReadabilityFailureCount ?? 0) !== 0 ||
    (baseAudit.collapsedMacrocycleCount ?? 0) !== 0 ||
    (baseAudit.stereoContradiction ?? false) ||
    (baseAudit.visibleHeavyBondCrossingCount ?? 0) > 3 ||
    visibleHeavyAtomCountForCoords(layoutGraph, coords) > FINAL_STRETCHED_BRIDGED_RING_BOND_MAX_HEAVY_ATOMS
  ) {
    return [];
  }

  const descriptors = [];
  for (const bond of layoutGraph.bonds.values()) {
    if (!bond || bond.kind !== 'covalent' || !bond.inRing || bond.aromatic || !coords.has(bond.a) || !coords.has(bond.b)) {
      continue;
    }
    const firstAtom = layoutGraph.atoms.get(bond.a);
    const secondAtom = layoutGraph.atoms.get(bond.b);
    if (
      !firstAtom ||
      !secondAtom ||
      firstAtom.element === 'H' ||
      secondAtom.element === 'H' ||
      firstAtom.aromatic ||
      secondAtom.aromatic ||
      firstAtom.visible === false ||
      secondAtom.visible === false
    ) {
      continue;
    }
    const ringSystem = bridgedRingSystemForBond(layoutGraph, bond.a, bond.b);
    if (!ringSystem || (ringSystem.atomIds?.length ?? 0) > FINAL_STRETCHED_BRIDGED_RING_BOND_MAX_HEAVY_ATOMS) {
      continue;
    }
    const firstPosition = coords.get(bond.a);
    const secondPosition = coords.get(bond.b);
    const distance = Math.hypot(secondPosition.x - firstPosition.x, secondPosition.y - firstPosition.y);
    const validationClass = placement.bondValidationClasses?.get(bond.id);
    const allowedDeviation = finalRetouchAllowedBondDeviation(validationClass, bondLength);
    if (distance <= bondLength + allowedDeviation + PRESENTATION_METRIC_EPSILON || distance > bondLength * FINAL_STRETCHED_BRIDGED_RING_BOND_MAX_DISTANCE_FACTOR + PRESENTATION_METRIC_EPSILON) {
      continue;
    }
    const targetDistance = bondLength + allowedDeviation * FINAL_STRETCHED_BRIDGED_RING_BOND_TARGET_DEVIATION_FACTOR;
    const requiredShift = distance - targetDistance;
    if (requiredShift <= PRESENTATION_METRIC_EPSILON) {
      continue;
    }
    const firstMovedAtomIds = stretchedBridgedRingBondMovedAtomIds(layoutGraph, coords, bond.a);
    const secondMovedAtomIds = stretchedBridgedRingBondMovedAtomIds(layoutGraph, coords, bond.b);
    const firstSideMovedAtomIds = stretchedBridgedRingBondSideAtomIds(layoutGraph, coords, bond.a, bond.b);
    const secondSideMovedAtomIds = stretchedBridgedRingBondSideAtomIds(layoutGraph, coords, bond.b, bond.a);
    const firstAdjacentTailMovedAtomIds = stretchedBridgedRingBondAdjacentTailAtomIds(layoutGraph, coords, bond.a, bond.b);
    const secondAdjacentTailMovedAtomIds = stretchedBridgedRingBondAdjacentTailAtomIds(layoutGraph, coords, bond.b, bond.a);
    if (firstMovedAtomIds.length === 0 && secondMovedAtomIds.length === 0) {
      continue;
    }
    descriptors.push({
      bondId: bond.id,
      firstAtomId: bond.a,
      secondAtomId: bond.b,
      ringAtomIds: ringSystem.atomIds ?? [],
      firstMovedAtomIds,
      secondMovedAtomIds,
      firstSideMovedAtomIds,
      secondSideMovedAtomIds,
      firstAdjacentTailMovedAtomIds,
      secondAdjacentTailMovedAtomIds,
      requiredShift
    });
  }
  return descriptors;
}

function stretchedBridgedRingBondCandidate(coords, descriptor, shiftFactor, mode) {
  const firstPosition = coords.get(descriptor.firstAtomId);
  const secondPosition = coords.get(descriptor.secondAtomId);
  if (!firstPosition || !secondPosition) {
    return null;
  }
  const dx = secondPosition.x - firstPosition.x;
  const dy = secondPosition.y - firstPosition.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= PRESENTATION_METRIC_EPSILON) {
    return null;
  }
  const shift = Math.min(descriptor.requiredShift * shiftFactor, distance - PRESENTATION_METRIC_EPSILON);
  if (shift <= PRESENTATION_METRIC_EPSILON) {
    return null;
  }
  const unit = { x: dx / distance, y: dy / distance };
  const candidateCoords = cloneCoords(coords);
  const movedAtomIds = [];
  const firstMovedAtomIds = mode === 'firstSide' ? descriptor.firstSideMovedAtomIds : mode === 'firstAdjacentTail' ? descriptor.firstAdjacentTailMovedAtomIds : descriptor.firstMovedAtomIds;
  const secondMovedAtomIds = mode === 'secondSide' ? descriptor.secondSideMovedAtomIds : mode === 'secondAdjacentTail' ? descriptor.secondAdjacentTailMovedAtomIds : descriptor.secondMovedAtomIds;
  if (mode === 'first' || mode === 'firstSide' || mode === 'firstAdjacentTail' || mode === 'both') {
    if (firstMovedAtomIds.length === 0) {
      return null;
    }
    const firstShift = mode === 'both' ? shift * 0.5 : shift;
    translateAtomGroup(candidateCoords, coords, firstMovedAtomIds, {
      x: unit.x * firstShift,
      y: unit.y * firstShift
    });
    movedAtomIds.push(...firstMovedAtomIds);
  }
  if (mode === 'second' || mode === 'secondSide' || mode === 'secondAdjacentTail' || mode === 'both') {
    if (secondMovedAtomIds.length === 0) {
      return null;
    }
    const secondShift = mode === 'both' ? shift * 0.5 : shift;
    translateAtomGroup(candidateCoords, coords, secondMovedAtomIds, {
      x: -unit.x * secondShift,
      y: -unit.y * secondShift
    });
    movedAtomIds.push(...secondMovedAtomIds);
  }
  return {
    coords: candidateCoords,
    movedAtomIds: [...new Set(movedAtomIds)]
  };
}

function stretchedBridgedRingBondCandidateCanReplace(candidateAudit, baseAudit) {
  return (
    candidateAudit?.ok === true &&
    candidateAudit.fallback?.mode == null &&
    finalAuditCountsDoNotWorsen(candidateAudit, baseAudit) &&
    (candidateAudit.bondLengthFailureCount ?? 0) === 0 &&
    (candidateAudit.severeOverlapCount ?? 0) === 0 &&
    (candidateAudit.labelOverlapCount ?? 0) === 0 &&
    (candidateAudit.ringSubstituentReadabilityFailureCount ?? 0) === 0 &&
    (candidateAudit.inwardRingSubstituentCount ?? 0) === 0 &&
    (candidateAudit.outwardAxisRingSubstituentFailureCount ?? 0) === 0 &&
    (candidateAudit.collapsedMacrocycleCount ?? 0) === 0 &&
    !(candidateAudit.stereoContradiction ?? false) &&
    (candidateAudit.maxBondLengthDeviation ?? Number.POSITIVE_INFINITY) <= (baseAudit.maxBondLengthDeviation ?? Number.POSITIVE_INFINITY)
  );
}

function compareStretchedBridgedRingBondCandidates(candidate, incumbent) {
  if (!incumbent) {
    return -1;
  }
  for (const key of ['bondLengthFailureCount', 'severeOverlapCount', 'visibleHeavyBondCrossingCount', 'labelOverlapCount']) {
    if ((candidate.audit[key] ?? 0) !== (incumbent.audit[key] ?? 0)) {
      return (candidate.audit[key] ?? 0) - (incumbent.audit[key] ?? 0);
    }
  }
  if (Math.abs((candidate.audit.maxBondLengthDeviation ?? 0) - (incumbent.audit.maxBondLengthDeviation ?? 0)) > PRESENTATION_METRIC_EPSILON) {
    return (candidate.audit.maxBondLengthDeviation ?? 0) - (incumbent.audit.maxBondLengthDeviation ?? 0);
  }
  if (Math.abs((candidate.audit.meanBondLengthDeviation ?? 0) - (incumbent.audit.meanBondLengthDeviation ?? 0)) > PRESENTATION_METRIC_EPSILON) {
    return (candidate.audit.meanBondLengthDeviation ?? 0) - (incumbent.audit.meanBondLengthDeviation ?? 0);
  }
  if (Math.abs(candidate.totalMove - incumbent.totalMove) > PRESENTATION_METRIC_EPSILON) {
    return candidate.totalMove - incumbent.totalMove;
  }
  return candidate.bondId.localeCompare(incumbent.bondId, 'en', { numeric: true });
}

function maybeRetouchFinalStretchedBridgedRingBond(molecule, layoutGraph, finalCoords, placement, bondLength) {
  const currentAudit = auditFinalRetouchCoords(molecule, layoutGraph, finalCoords, placement, bondLength);
  const descriptors = stretchedBridgedRingBondDescriptors(layoutGraph, finalCoords, placement, bondLength, currentAudit);
  if (descriptors.length === 0) {
    return {
      changed: false,
      coords: finalCoords,
      movedAtomIds: [],
      audit: currentAudit
    };
  }

  let bestCandidate = null;
  for (const descriptor of descriptors) {
    for (const shiftFactor of FINAL_STRETCHED_BRIDGED_RING_BOND_SHIFT_FACTORS) {
      for (const mode of ['first', 'second', 'both', 'firstSide', 'secondSide', 'firstAdjacentTail', 'secondAdjacentTail']) {
        const candidate = stretchedBridgedRingBondCandidate(finalCoords, descriptor, shiftFactor, mode);
        if (!candidate) {
          continue;
        }
        const candidateBondValidationClasses = assignBondValidationClass(layoutGraph, descriptor.ringAtomIds, 'bridged', new Map(placement.bondValidationClasses), { overwrite: true });
        const candidateAudit = auditFinalRetouchCoords(molecule, layoutGraph, candidate.coords, placement, bondLength, candidateBondValidationClasses);
        if (!stretchedBridgedRingBondCandidateCanReplace(candidateAudit, currentAudit)) {
          continue;
        }
        const scoredCandidate = {
          coords: candidate.coords,
          audit: candidateAudit,
          bondValidationClasses: candidateBondValidationClasses,
          bondId: descriptor.bondId,
          movedAtomIds: candidate.movedAtomIds,
          totalMove: finalAcyclicBranchContactCandidateMove(finalCoords, candidate.coords, candidate.movedAtomIds)
        };
        if (compareStretchedBridgedRingBondCandidates(scoredCandidate, bestCandidate) < 0) {
          bestCandidate = scoredCandidate;
        }
      }
    }
  }

  if (!bestCandidate) {
    return {
      changed: false,
      coords: finalCoords,
      movedAtomIds: [],
      audit: currentAudit
    };
  }
  return {
    changed: true,
    coords: bestCandidate.coords,
    bondValidationClasses: bestCandidate.bondValidationClasses,
    movedAtomIds: bestCandidate.movedAtomIds,
    audit: bestCandidate.audit
  };
}

function organometallicMildBridgedRingBondEndpointAtomIds(layoutGraph, coords, atomId) {
  const atomIds = [atomId];
  for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
    const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (neighborAtom?.element === 'H' && coords.has(neighborAtomId) && !layoutGraph.fixedCoords?.has(neighborAtomId)) {
      atomIds.push(neighborAtomId);
    }
  }
  return atomIds;
}

function organometallicMildBridgedRingBondDescriptors(layoutGraph, coords, placement, bondLength, baseAudit, familySummary) {
  if (
    familySummary?.primaryFamily !== 'organometallic' ||
    !baseAudit ||
    (baseAudit.bondLengthFailureCount ?? 0) !== 1 ||
    (baseAudit.mildBondLengthFailureCount ?? 0) !== 1 ||
    (baseAudit.severeBondLengthFailureCount ?? 0) !== 0 ||
    (baseAudit.severeOverlapCount ?? 0) !== 0 ||
    (baseAudit.labelOverlapCount ?? 0) !== 0 ||
    (baseAudit.ringSubstituentReadabilityFailureCount ?? 0) !== 0 ||
    (baseAudit.visibleHeavyBondCrossingCount ?? 0) !== 0 ||
    (baseAudit.collapsedMacrocycleCount ?? 0) !== 0 ||
    (baseAudit.stereoContradiction ?? false) ||
    visibleHeavyAtomCountForCoords(layoutGraph, coords) > FINAL_ORGANOMETALLIC_MILD_BRIDGED_RING_BOND_MAX_HEAVY_ATOMS
  ) {
    return [];
  }

  const descriptors = [];
  for (const bond of layoutGraph.bonds.values()) {
    if (!bond || bond.kind !== 'covalent' || !bond.inRing || bond.aromatic || !coords.has(bond.a) || !coords.has(bond.b) || placement.bondValidationClasses?.get(bond.id) !== 'bridged') {
      continue;
    }
    const firstAtom = layoutGraph.atoms.get(bond.a);
    const secondAtom = layoutGraph.atoms.get(bond.b);
    if (
      !firstAtom ||
      !secondAtom ||
      firstAtom.element === 'H' ||
      secondAtom.element === 'H' ||
      firstAtom.visible === false ||
      secondAtom.visible === false ||
      layoutGraph.fixedCoords?.has(bond.a) ||
      layoutGraph.fixedCoords?.has(bond.b)
    ) {
      continue;
    }
    const ringSystemId = layoutGraph.atomToRingSystemId.get(bond.a);
    if (ringSystemId == null || ringSystemId !== layoutGraph.atomToRingSystemId.get(bond.b)) {
      continue;
    }
    const firstPosition = coords.get(bond.a);
    const secondPosition = coords.get(bond.b);
    const distance = Math.hypot(secondPosition.x - firstPosition.x, secondPosition.y - firstPosition.y);
    if (
      distance <= bondLength * BRIDGED_VALIDATION.maxBondLengthFactor + PRESENTATION_METRIC_EPSILON ||
      distance > bondLength * FINAL_ORGANOMETALLIC_MILD_BRIDGED_RING_BOND_MAX_DISTANCE_FACTOR + PRESENTATION_METRIC_EPSILON
    ) {
      continue;
    }
    const targetDistance = bondLength + finalRetouchAllowedBondDeviation('bridged', bondLength) * FINAL_STRETCHED_BRIDGED_RING_BOND_TARGET_DEVIATION_FACTOR;
    const requiredShift = distance - targetDistance;
    if (requiredShift <= PRESENTATION_METRIC_EPSILON) {
      continue;
    }
    descriptors.push({
      bondId: bond.id,
      firstAtomId: bond.a,
      secondAtomId: bond.b,
      firstMovedAtomIds: organometallicMildBridgedRingBondEndpointAtomIds(layoutGraph, coords, bond.a),
      secondMovedAtomIds: organometallicMildBridgedRingBondEndpointAtomIds(layoutGraph, coords, bond.b),
      requiredShift
    });
  }
  return descriptors;
}

function organometallicMildBridgedRingBondCandidate(coords, descriptor, shiftFactor) {
  const firstPosition = coords.get(descriptor.firstAtomId);
  const secondPosition = coords.get(descriptor.secondAtomId);
  if (!firstPosition || !secondPosition) {
    return null;
  }
  const dx = secondPosition.x - firstPosition.x;
  const dy = secondPosition.y - firstPosition.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= PRESENTATION_METRIC_EPSILON) {
    return null;
  }
  const shift = Math.min(descriptor.requiredShift * shiftFactor, distance - PRESENTATION_METRIC_EPSILON);
  if (shift <= PRESENTATION_METRIC_EPSILON) {
    return null;
  }
  const unit = { x: dx / distance, y: dy / distance };
  const candidateCoords = cloneCoords(coords);
  translateAtomGroup(candidateCoords, coords, descriptor.firstMovedAtomIds, {
    x: unit.x * shift * 0.5,
    y: unit.y * shift * 0.5
  });
  translateAtomGroup(candidateCoords, coords, descriptor.secondMovedAtomIds, {
    x: -unit.x * shift * 0.5,
    y: -unit.y * shift * 0.5
  });
  return {
    coords: candidateCoords,
    movedAtomIds: [...new Set([...descriptor.firstMovedAtomIds, ...descriptor.secondMovedAtomIds])]
  };
}

function organometallicMildBridgedRingBondCandidateCanReplace(candidateAudit, baseAudit) {
  return (
    candidateAudit?.ok === true &&
    candidateAudit.fallback?.mode == null &&
    finalAuditCountsDoNotWorsen(candidateAudit, baseAudit) &&
    (candidateAudit.bondLengthFailureCount ?? 0) === 0 &&
    (candidateAudit.severeOverlapCount ?? 0) === 0 &&
    (candidateAudit.labelOverlapCount ?? 0) === 0 &&
    (candidateAudit.ringSubstituentReadabilityFailureCount ?? 0) === 0 &&
    (candidateAudit.inwardRingSubstituentCount ?? 0) === 0 &&
    (candidateAudit.outwardAxisRingSubstituentFailureCount ?? 0) === 0 &&
    (candidateAudit.visibleHeavyBondCrossingCount ?? 0) === 0 &&
    (candidateAudit.collapsedMacrocycleCount ?? 0) === 0 &&
    !(candidateAudit.stereoContradiction ?? false) &&
    (candidateAudit.maxBondLengthDeviation ?? Number.POSITIVE_INFINITY) <= (baseAudit.maxBondLengthDeviation ?? Number.POSITIVE_INFINITY)
  );
}

function maybeRetouchFinalOrganometallicMildBridgedRingBond(molecule, layoutGraph, finalCoords, placement, bondLength, familySummary) {
  const currentAudit = auditFinalRetouchCoords(molecule, layoutGraph, finalCoords, placement, bondLength);
  const descriptors = organometallicMildBridgedRingBondDescriptors(layoutGraph, finalCoords, placement, bondLength, currentAudit, familySummary);
  if (descriptors.length === 0) {
    return {
      changed: false,
      coords: finalCoords,
      movedAtomIds: [],
      audit: currentAudit
    };
  }

  let bestCandidate = null;
  for (const descriptor of descriptors) {
    for (const shiftFactor of FINAL_STRETCHED_BRIDGED_RING_BOND_SHIFT_FACTORS) {
      const candidate = organometallicMildBridgedRingBondCandidate(finalCoords, descriptor, shiftFactor);
      if (!candidate) {
        continue;
      }
      const candidateAudit = auditFinalRetouchCoords(molecule, layoutGraph, candidate.coords, placement, bondLength);
      if (!organometallicMildBridgedRingBondCandidateCanReplace(candidateAudit, currentAudit)) {
        continue;
      }
      const scoredCandidate = {
        coords: candidate.coords,
        audit: candidateAudit,
        bondId: descriptor.bondId,
        movedAtomIds: candidate.movedAtomIds,
        totalMove: finalAcyclicBranchContactCandidateMove(finalCoords, candidate.coords, candidate.movedAtomIds)
      };
      if (compareStretchedBridgedRingBondCandidates(scoredCandidate, bestCandidate) < 0) {
        bestCandidate = scoredCandidate;
      }
    }
  }

  if (!bestCandidate) {
    return {
      changed: false,
      coords: finalCoords,
      movedAtomIds: [],
      audit: currentAudit
    };
  }
  return {
    changed: true,
    coords: bestCandidate.coords,
    movedAtomIds: bestCandidate.movedAtomIds,
    audit: bestCandidate.audit
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

/**
 * Scores one suppressed-hydrogen three-heavy fan descriptor so the worst local
 * fans claim shared movable subtrees before lower-priority centers.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinates.
 * @param {{centerAtomId: string}} descriptor - Three-heavy fan descriptor.
 * @returns {number} Focused max deviation for the descriptor center.
 */
function finalThreeHeavyFanDescriptorPenalty(layoutGraph, coords, descriptor) {
  return measureThreeHeavyContinuationDistortion(layoutGraph, coords, {
    focusAtomIds: new Set([descriptor.centerAtomId])
  }).maxDeviation;
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
  const descriptors = finalThreeHeavyFanDescriptors(layoutGraph, currentCoords).sort(
    (firstDescriptor, secondDescriptor) =>
      finalThreeHeavyFanDescriptorPenalty(layoutGraph, currentCoords, secondDescriptor) - finalThreeHeavyFanDescriptorPenalty(layoutGraph, currentCoords, firstDescriptor)
  );
  for (const descriptor of descriptors) {
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
 * Scores a visible three-heavy fan against ideal trigonal presentation.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} centerAtomId - Fan center atom ID.
 * @param {string[]} neighborAtomIds - Three visible heavy neighbor IDs.
 * @returns {{maxDeviation: number, totalDeviation: number, angles: number[]}|null} Fan score in radians.
 */
function finalVisibleThreeHeavyFanScore(coords, centerAtomId, neighborAtomIds) {
  const centerPosition = coords.get(centerAtomId);
  if (!centerPosition || neighborAtomIds.length !== 3) {
    return null;
  }
  const neighborAngles = neighborAtomIds.map(neighborAtomId => {
    const neighborPosition = coords.get(neighborAtomId);
    return neighborPosition ? angleOf(sub(neighborPosition, centerPosition)) : null;
  });
  if (neighborAngles.some(angle => angle == null)) {
    return null;
  }
  let maxDeviation = 0;
  let totalDeviation = 0;
  const angles = [];
  for (let firstIndex = 0; firstIndex < neighborAngles.length; firstIndex++) {
    for (let secondIndex = firstIndex + 1; secondIndex < neighborAngles.length; secondIndex++) {
      const angle = angularDifference(neighborAngles[firstIndex], neighborAngles[secondIndex]);
      const deviation = Math.abs(angle - EXACT_TRIGONAL_CONTINUATION_ANGLE);
      angles.push(angle);
      maxDeviation = Math.max(maxDeviation, deviation);
      totalDeviation += deviation;
    }
  }
  return { maxDeviation, totalDeviation, angles };
}

/**
 * Returns terminal multiple-bond leaf metadata for a distorted fan, when one
 * leaf can be paired with a support-branch bend.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Array<{bond: object, neighborAtomId: string}>} heavyBonds - Visible heavy bonds at the center.
 * @returns {{leafAtomId: string, fixedNeighborIds: string[]}|null} Terminal leaf descriptor or null.
 */
function finalTargetedTerminalMultipleBondLeafInfo(layoutGraph, heavyBonds) {
  const terminalLeaves = heavyBonds.filter(({ bond, neighborAtomId }) => {
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    return !bond.aromatic && (bond.order ?? 1) >= 2 && neighborAtom && neighborAtom.element !== 'C' && neighborAtom.element !== 'H' && neighborAtom.heavyDegree === 1;
  });
  if (terminalLeaves.length !== 1) {
    return null;
  }
  const leafAtomId = terminalLeaves[0].neighborAtomId;
  const fixedNeighborIds = heavyBonds.map(({ neighborAtomId }) => neighborAtomId).filter(neighborAtomId => neighborAtomId !== leafAtomId);
  return fixedNeighborIds.length === 2 ? { leafAtomId, fixedNeighborIds } : null;
}

/**
 * Collects the worst large-molecule placed visible fan centers for targeted
 * final relief.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinates.
 * @returns {Array<{centerAtomId: string, heavyBonds: Array<{bond: object, neighborAtomId: string}>, neighborAtomIds: string[], score: object, terminalLeafInfo: object|null}>} Candidate centers.
 */
function finalLargeMoleculeTargetedAngleReliefCenters(layoutGraph, coords) {
  const centers = [];
  for (const centerAtomId of coords.keys()) {
    const centerAtom = layoutGraph.atoms.get(centerAtomId);
    if (!centerAtom || centerAtom.element === 'H' || centerAtom.aromatic) {
      continue;
    }
    const heavyBonds = visibleHeavyCovalentBonds(layoutGraph, coords, centerAtomId);
    if (heavyBonds.length !== 3) {
      continue;
    }
    const neighborAtomIds = heavyBonds.map(({ neighborAtomId }) => neighborAtomId);
    const score = finalVisibleThreeHeavyFanScore(coords, centerAtomId, neighborAtomIds);
    if (!score || score.maxDeviation <= FINAL_LARGE_MOLECULE_TARGETED_ANGLE_RELIEF_MIN_MAX_DEVIATION) {
      continue;
    }
    centers.push({
      centerAtomId,
      heavyBonds,
      neighborAtomIds,
      score,
      terminalLeafInfo: finalTargetedTerminalMultipleBondLeafInfo(layoutGraph, heavyBonds)
    });
  }
  return centers.sort((first, second) => second.score.maxDeviation - first.score.maxDeviation).slice(0, FINAL_LARGE_MOLECULE_TARGETED_ANGLE_RELIEF_MAX_CENTERS);
}

/**
 * Builds a rigid support-branch rotation for targeted final fan relief.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinates.
 * @param {string} centerAtomId - Fan center atom ID.
 * @param {string} rootAtomId - Neighbor root of the moved subtree.
 * @param {number} rotation - Rotation angle in radians.
 * @returns {{coords: Map<string, {x: number, y: number}>, movedAtomIds: string[], movedHeavyAtomCount: number, totalMove: number}|null} Candidate or null.
 */
function finalLargeMoleculeTargetedAngleReliefRotationCandidate(layoutGraph, coords, centerAtomId, rootAtomId, rotation) {
  const centerPosition = coords.get(centerAtomId);
  if (!centerPosition || Math.abs(rotation) <= PRESENTATION_METRIC_EPSILON) {
    return null;
  }
  const subtreeAtomIds = [...collectCutSubtree(layoutGraph, rootAtomId, centerAtomId)].filter(atomId => coords.has(atomId));
  if (subtreeAtomIds.length === 0 || subtreeAtomIds.includes(centerAtomId) || subtreeAtomIds.some(atomId => layoutGraph.fixedCoords?.has(atomId))) {
    return null;
  }
  const movedHeavyAtomCount = subtreeAtomIds.reduce((count, atomId) => count + (layoutGraph.atoms.get(atomId)?.element === 'H' ? 0 : 1), 0);
  if (movedHeavyAtomCount > FINAL_LARGE_MOLECULE_TARGETED_ANGLE_RELIEF_MAX_MOVED_HEAVY_ATOMS) {
    return null;
  }

  const candidateCoords = cloneCoords(coords);
  let totalMove = 0;
  for (const atomId of subtreeAtomIds) {
    const position = coords.get(atomId);
    if (!position) {
      continue;
    }
    const rotatedPosition = add(centerPosition, rotate(sub(position, centerPosition), rotation));
    candidateCoords.set(atomId, rotatedPosition);
    totalMove += distance(position, rotatedPosition);
  }
  return totalMove > PRESENTATION_METRIC_EPSILON ? { coords: candidateCoords, movedAtomIds: subtreeAtomIds, movedHeavyAtomCount, totalMove } : null;
}

/**
 * Returns whether a center has a visible hydrogen branch that can make a
 * moderate heavy fan distortion noticeable in explicit-H layouts.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinates.
 * @param {string} centerAtomId - Fan center atom ID.
 * @returns {boolean} True when an explicit hydrogen neighbor is visible.
 */
function finalTargetedAngleReliefCenterHasVisibleHydrogen(layoutGraph, coords, centerAtomId) {
  return (layoutGraph.bondsByAtomId.get(centerAtomId) ?? []).some(bond => {
    if (!bond || bond.kind !== 'covalent') {
      return false;
    }
    const neighborAtomId = bond.a === centerAtomId ? bond.b : bond.a;
    return coords.has(neighborAtomId) && layoutGraph.atoms.get(neighborAtomId)?.element === 'H';
  });
}

/**
 * Builds a paired support-branch rotation for explicit-H visible fans where
 * one branch move cannot be accepted without reopening contacts.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinates.
 * @param {string} centerAtomId - Fan center atom ID.
 * @param {string} firstRootAtomId - First moved branch root.
 * @param {number} firstRotation - First rotation angle in radians.
 * @param {string} secondRootAtomId - Second moved branch root.
 * @param {number} secondRotation - Second rotation angle in radians.
 * @returns {{coords: Map<string, {x: number, y: number}>, movedAtomIds: string[], movedHeavyAtomCount: number, totalMove: number, pairedBranch: boolean}|null} Candidate or null.
 */
function finalLargeMoleculeTargetedPairedAngleReliefRotationCandidate(layoutGraph, coords, centerAtomId, firstRootAtomId, firstRotation, secondRootAtomId, secondRotation) {
  const firstCandidate = finalLargeMoleculeTargetedAngleReliefRotationCandidate(layoutGraph, coords, centerAtomId, firstRootAtomId, firstRotation);
  if (!firstCandidate) {
    return null;
  }
  const secondCandidate = finalLargeMoleculeTargetedAngleReliefRotationCandidate(layoutGraph, firstCandidate.coords, centerAtomId, secondRootAtomId, secondRotation);
  if (!secondCandidate) {
    return null;
  }
  const movedAtomIds = [...new Set([...firstCandidate.movedAtomIds, ...secondCandidate.movedAtomIds])];
  const movedHeavyAtomCount = movedAtomIds.reduce((count, atomId) => count + (layoutGraph.atoms.get(atomId)?.element === 'H' ? 0 : 1), 0);
  if (movedHeavyAtomCount > FINAL_LARGE_MOLECULE_TARGETED_ANGLE_RELIEF_MAX_MOVED_HEAVY_ATOMS) {
    return null;
  }
  let totalMove = 0;
  for (const atomId of movedAtomIds) {
    const before = coords.get(atomId);
    const after = secondCandidate.coords.get(atomId);
    if (before && after) {
      totalMove += distance(before, after);
    }
  }
  return totalMove > PRESENTATION_METRIC_EPSILON
    ? {
        coords: secondCandidate.coords,
        movedAtomIds,
        movedHeavyAtomCount,
        totalMove,
        pairedBranch: true
      }
    : null;
}

/**
 * Returns target-position variants for a terminal multiple-bond leaf after a
 * support branch has been bent.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinates.
 * @param {string} centerAtomId - Fan center atom ID.
 * @param {{leafAtomId: string, fixedNeighborIds: string[]}|null} terminalLeafInfo - Terminal leaf metadata.
 * @returns {Map<string, {x: number, y: number}>[]} Sparse coordinate overrides for the leaf.
 */
function finalLargeMoleculeTargetedTerminalLeafVariants(coords, centerAtomId, terminalLeafInfo) {
  if (!terminalLeafInfo) {
    return [new Map()];
  }
  const centerPosition = coords.get(centerAtomId);
  const leafPosition = coords.get(terminalLeafInfo.leafAtomId);
  if (!centerPosition || !leafPosition) {
    return [new Map()];
  }
  const radius = distance(centerPosition, leafPosition);
  return terminalMultipleBondLeafCandidateAngles(coords, centerAtomId, terminalLeafInfo.fixedNeighborIds).map(targetAngle => new Map([[terminalLeafInfo.leafAtomId, add(centerPosition, fromAngle(targetAngle, radius))]]));
}

/**
 * Applies sparse target-position overrides to a coordinate map.
 * @param {Map<string, {x: number, y: number}>} coords - Base coordinates.
 * @param {Map<string, {x: number, y: number}>} overrides - Sparse coordinate overrides.
 * @returns {Map<string, {x: number, y: number}>} Merged coordinate map.
 */
function withFinalTargetedAngleOverrides(coords, overrides) {
  if (overrides.size === 0) {
    return coords;
  }
  const candidateCoords = cloneCoords(coords);
  for (const [atomId, position] of overrides) {
    candidateCoords.set(atomId, position);
  }
  return candidateCoords;
}

/**
 * Returns whether one targeted fan-relief candidate is preferable.
 * @param {object} candidate - Candidate summary.
 * @param {object|null} incumbent - Current best candidate.
 * @returns {boolean} True when the candidate should replace the incumbent.
 */
function finalLargeMoleculeTargetedAngleReliefCandidateIsBetter(candidate, incumbent) {
  if (!incumbent) {
    return true;
  }
  if (candidate.focusScore.maxDeviation < incumbent.focusScore.maxDeviation - PRESENTATION_METRIC_EPSILON) {
    return true;
  }
  if (candidate.focusScore.maxDeviation > incumbent.focusScore.maxDeviation + PRESENTATION_METRIC_EPSILON) {
    return false;
  }
  if (candidate.focusScore.totalDeviation < incumbent.focusScore.totalDeviation - PRESENTATION_METRIC_EPSILON) {
    return true;
  }
  if (candidate.focusScore.totalDeviation > incumbent.focusScore.totalDeviation + PRESENTATION_METRIC_EPSILON) {
    return false;
  }
  if (finalLargeMoleculeAngularReliefScoreIsBetter(candidate.aggregateScore, incumbent.aggregateScore)) {
    return true;
  }
  if (finalLargeMoleculeAngularReliefScoreIsBetter(incumbent.aggregateScore, candidate.aggregateScore)) {
    return false;
  }
  return candidate.totalMove < incumbent.totalMove - PRESENTATION_METRIC_EPSILON;
}

/**
 * Performs a small targeted relief pass for very distorted fans on layouts
 * block-stitched by the large-molecule placer but too large for the full
 * final angle-relief sweep.
 * @param {object} molecule - Molecule-like graph.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} finalCoords - Current coordinates.
 * @param {object} placement - Placement result containing validation classes.
 * @param {number} bondLength - Target bond length.
 * @returns {{changed: boolean, coords: Map<string, {x: number, y: number}>, movedAtomIds: string[], audit: object|null, scoreBefore: object|null, scoreAfter: object|null}} Relief result.
 */
function maybeRetouchFinalLargeMoleculeTargetedAngleRelief(molecule, layoutGraph, finalCoords, placement, bondLength) {
  const heavyAtomCount = layoutGraph.traits?.heavyAtomCount ?? layoutGraph.atoms?.size ?? 0;
  if (
    !placement.placedFamilies?.includes('large-molecule') ||
    heavyAtomCount <= FINAL_LARGE_MOLECULE_ANGLE_RELIEF_MAX_HEAVY_ATOMS ||
    heavyAtomCount > FINAL_LARGE_MOLECULE_TARGETED_ANGLE_RELIEF_MAX_HEAVY_ATOMS
  ) {
    return { changed: false, coords: finalCoords, movedAtomIds: [], audit: null, scoreBefore: null, scoreAfter: null };
  }

  const scoreBefore = finalLargeMoleculeAngularReliefScore(layoutGraph, finalCoords);
  let currentCoords = finalCoords;
  let currentAudit = auditFinalRetouchCoords(molecule, layoutGraph, currentCoords, placement, bondLength);
  let currentAggregateScore = scoreBefore;
  const movedAtomIds = new Set();
  let changed = false;

  for (let passIndex = 0; passIndex < FINAL_LARGE_MOLECULE_TARGETED_ANGLE_RELIEF_MAX_PASSES; passIndex++) {
    let bestCandidate = null;
    for (const center of finalLargeMoleculeTargetedAngleReliefCenters(layoutGraph, currentCoords)) {
      const currentFocusScore = finalVisibleThreeHeavyFanScore(currentCoords, center.centerAtomId, center.neighborAtomIds);
      if (!currentFocusScore) {
        continue;
      }
      const tryRotationCandidate = rotationCandidate => {
        if (!rotationCandidate) {
          return;
        }
        for (const terminalLeafOverrides of finalLargeMoleculeTargetedTerminalLeafVariants(rotationCandidate.coords, center.centerAtomId, center.terminalLeafInfo)) {
          const candidateCoords = withFinalTargetedAngleOverrides(rotationCandidate.coords, terminalLeafOverrides);
          const focusScore = finalVisibleThreeHeavyFanScore(candidateCoords, center.centerAtomId, center.neighborAtomIds);
          const minimumMaxGain =
            rotationCandidate.pairedBranch === true ? FINAL_LARGE_MOLECULE_TARGETED_PAIRED_ANGLE_RELIEF_MIN_MAX_GAIN : FINAL_LARGE_MOLECULE_TARGETED_ANGLE_RELIEF_MIN_MAX_GAIN;
          if (!focusScore || focusScore.maxDeviation > currentFocusScore.maxDeviation - minimumMaxGain) {
            continue;
          }
          const aggregateScore = finalLargeMoleculeAngularReliefScore(layoutGraph, candidateCoords);
          if (
            aggregateScore.maxDeviation > currentAggregateScore.maxDeviation + PRESENTATION_METRIC_EPSILON ||
            aggregateScore.totalDeviation > currentAggregateScore.totalDeviation + FINAL_LARGE_MOLECULE_TARGETED_ANGLE_RELIEF_MAX_TOTAL_INCREASE + PRESENTATION_METRIC_EPSILON
          ) {
            continue;
          }
          const candidateAudit = auditFinalRetouchCoords(molecule, layoutGraph, candidateCoords, placement, bondLength);
          if (!finalAuditCountsDoNotWorsen(candidateAudit, currentAudit)) {
            continue;
          }
          const candidateMovedAtomIds = [...new Set([...rotationCandidate.movedAtomIds, ...terminalLeafOverrides.keys()])];
          const candidate = {
            coords: candidateCoords,
            movedAtomIds: candidateMovedAtomIds,
            audit: candidateAudit,
            focusScore,
            aggregateScore,
            totalMove:
              rotationCandidate.totalMove +
              [...terminalLeafOverrides].reduce((sum, [atomId, position]) => {
                const previousPosition = currentCoords.get(atomId);
                return previousPosition ? sum + distance(previousPosition, position) : sum;
              }, 0)
          };
          if (finalLargeMoleculeTargetedAngleReliefCandidateIsBetter(candidate, bestCandidate)) {
            bestCandidate = candidate;
          }
        }
      };
      for (const { bond, neighborAtomId } of center.heavyBonds) {
        if (bond.aromatic || (bond.order ?? 1) !== 1) {
          continue;
        }
        for (const rotation of FINAL_LARGE_MOLECULE_TARGETED_ANGLE_RELIEF_ROTATIONS) {
          tryRotationCandidate(finalLargeMoleculeTargetedAngleReliefRotationCandidate(layoutGraph, currentCoords, center.centerAtomId, neighborAtomId, rotation));
        }
      }
      if (
        center.terminalLeafInfo == null &&
        currentFocusScore.maxDeviation <= FINAL_LARGE_MOLECULE_TARGETED_PAIRED_ANGLE_RELIEF_MAX_DEVIATION &&
        finalTargetedAngleReliefCenterHasVisibleHydrogen(layoutGraph, currentCoords, center.centerAtomId)
      ) {
        const singleBondNeighbors = center.heavyBonds.filter(({ bond }) => !bond.aromatic && (bond.order ?? 1) === 1);
        for (let firstIndex = 0; firstIndex < singleBondNeighbors.length - 1; firstIndex++) {
          for (let secondIndex = firstIndex + 1; secondIndex < singleBondNeighbors.length; secondIndex++) {
            const firstNeighborAtomId = singleBondNeighbors[firstIndex].neighborAtomId;
            const secondNeighborAtomId = singleBondNeighbors[secondIndex].neighborAtomId;
            for (const firstRotation of FINAL_LARGE_MOLECULE_TARGETED_ANGLE_RELIEF_ROTATIONS) {
              for (const secondRotation of FINAL_LARGE_MOLECULE_TARGETED_ANGLE_RELIEF_ROTATIONS) {
                tryRotationCandidate(
                  finalLargeMoleculeTargetedPairedAngleReliefRotationCandidate(
                    layoutGraph,
                    currentCoords,
                    center.centerAtomId,
                    firstNeighborAtomId,
                    firstRotation,
                    secondNeighborAtomId,
                    secondRotation
                  )
                );
              }
            }
          }
        }
      }
    }
    if (!bestCandidate) {
      break;
    }
    currentCoords = bestCandidate.coords;
    currentAudit = bestCandidate.audit;
    currentAggregateScore = bestCandidate.aggregateScore;
    for (const atomId of bestCandidate.movedAtomIds) {
      movedAtomIds.add(atomId);
    }
    changed = true;
  }

  return {
    changed,
    coords: currentCoords,
    movedAtomIds: [...movedAtomIds],
    audit: currentAudit,
    scoreBefore,
    scoreAfter: currentAggregateScore
  };
}

/**
 * Scores aggregate final-angle distortion across the presentation angle
 * families that make large peptide-like layouts look kinked.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinates.
 * @returns {{totalDeviation: number, maxDeviation: number, trigonal: object, divalent: object, threeHeavy: object}} Aggregate angle score.
 */
function finalLargeMoleculeAngularReliefScore(layoutGraph, coords) {
  const trigonal = measureTrigonalDistortion(layoutGraph, coords);
  const divalent = measureDivalentContinuationDistortion(layoutGraph, coords);
  const threeHeavy = measureThreeHeavyContinuationDistortion(layoutGraph, coords);
  return {
    totalDeviation: trigonal.totalDeviation + divalent.totalDeviation + threeHeavy.totalDeviation,
    maxDeviation: Math.max(trigonal.maxDeviation, divalent.maxDeviation, threeHeavy.maxDeviation),
    trigonal,
    divalent,
    threeHeavy
  };
}

/**
 * Returns whether a final-angle score improves the incumbent.
 * @param {{totalDeviation: number, maxDeviation: number}} candidateScore - Candidate angle score.
 * @param {{totalDeviation: number, maxDeviation: number}} incumbentScore - Current angle score.
 * @returns {boolean} True when the candidate improves max or tied total distortion.
 */
function finalLargeMoleculeAngularReliefScoreIsBetter(candidateScore, incumbentScore) {
  if (candidateScore.maxDeviation < incumbentScore.maxDeviation - PRESENTATION_METRIC_EPSILON) {
    return true;
  }
  if (candidateScore.maxDeviation > incumbentScore.maxDeviation + PRESENTATION_METRIC_EPSILON) {
    return false;
  }
  return candidateScore.totalDeviation < incumbentScore.totalDeviation - PRESENTATION_METRIC_EPSILON;
}

/**
 * Returns whether an angle-relief candidate beats the incumbent candidate,
 * using score first and total movement as the stable tie-breaker.
 * @param {{totalMove: number}} candidate - Candidate move summary.
 * @param {{totalDeviation: number, maxDeviation: number}} candidateScore - Candidate angle score.
 * @param {{totalMove: number, score: {totalDeviation: number, maxDeviation: number}}|null} incumbentCandidate - Current best candidate.
 * @returns {boolean} True when the candidate should replace the incumbent.
 */
function finalLargeMoleculeAngleReliefCandidateIsBetter(candidate, candidateScore, incumbentCandidate) {
  return (
    !incumbentCandidate ||
    finalLargeMoleculeAngularReliefScoreIsBetter(candidateScore, incumbentCandidate.score) ||
    (Math.abs(candidateScore.maxDeviation - incumbentCandidate.score.maxDeviation) <= PRESENTATION_METRIC_EPSILON &&
      Math.abs(candidateScore.totalDeviation - incumbentCandidate.score.totalDeviation) <= PRESENTATION_METRIC_EPSILON &&
      candidate.totalMove < incumbentCandidate.totalMove - PRESENTATION_METRIC_EPSILON)
  );
}

/**
 * Returns whether one atom has enough focused angle distortion to search.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinates.
 * @param {string} atomId - Candidate center atom ID.
 * @returns {boolean} True when the center exceeds the final relief threshold.
 */
function finalLargeMoleculeAngularReliefCenterNeedsWork(layoutGraph, coords, atomId) {
  const focusAtomIds = new Set([atomId]);
  const trigonal = measureTrigonalDistortion(layoutGraph, coords, { focusAtomIds });
  const divalent = measureDivalentContinuationDistortion(layoutGraph, coords, { focusAtomIds });
  const threeHeavy = measureThreeHeavyContinuationDistortion(layoutGraph, coords, { focusAtomIds });
  return Math.max(trigonal.maxDeviation, divalent.maxDeviation, threeHeavy.maxDeviation) > FINAL_LARGE_MOLECULE_ANGLE_RELIEF_MIN_MAX_DEVIATION;
}

/**
 * Rotates one cut subtree around a distorted center by a small angle.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinates.
 * @param {string} centerAtomId - Distorted center atom ID.
 * @param {string} rootAtomId - Neighbor root of the moved subtree.
 * @param {number} rotation - Rotation angle in radians.
 * @returns {{coords: Map<string, {x: number, y: number}>, movedAtomIds: string[], totalMove: number, rotationMagnitude: number}|null} Candidate or null.
 */
function rotatedFinalLargeMoleculeAngleReliefCandidate(layoutGraph, coords, centerAtomId, rootAtomId, rotation) {
  const centerPosition = coords.get(centerAtomId);
  if (!centerPosition || Math.abs(rotation) <= PRESENTATION_METRIC_EPSILON) {
    return null;
  }

  const subtreeAtomIds = [...collectCutSubtree(layoutGraph, rootAtomId, centerAtomId)].filter(atomId => coords.has(atomId));
  if (subtreeAtomIds.length === 0 || subtreeAtomIds.includes(centerAtomId)) {
    return null;
  }
  for (const atomId of subtreeAtomIds) {
    if (layoutGraph.fixedCoords?.has(atomId)) {
      return null;
    }
  }

  const candidateCoords = cloneCoords(coords);
  let totalMove = 0;
  for (const atomId of subtreeAtomIds) {
    const position = coords.get(atomId);
    if (!position) {
      continue;
    }
    const rotatedPosition = add(centerPosition, rotate(sub(position, centerPosition), rotation));
    candidateCoords.set(atomId, rotatedPosition);
    totalMove += Math.hypot(rotatedPosition.x - position.x, rotatedPosition.y - position.y);
  }

  return totalMove > PRESENTATION_METRIC_EPSILON ? { coords: candidateCoords, movedAtomIds: subtreeAtomIds, totalMove, rotationMagnitude: Math.abs(rotation) } : null;
}

/**
 * Builds a nested divalent-lane candidate by bending one side of a divalent
 * center, then rotating one child branch of that side away from the crowded lane.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinates.
 * @param {string} centerAtomId - Divalent center atom ID.
 * @param {string} rootAtomId - Neighbor root moved around the divalent center.
 * @param {string} branchRootAtomId - Child branch root moved around the neighbor root.
 * @param {number} centerRotation - Rotation around the divalent center in radians.
 * @param {number} branchRotation - Secondary branch rotation in radians.
 * @returns {{coords: Map<string, {x: number, y: number}>, movedAtomIds: string[], totalMove: number, rotationMagnitude: number}|null} Candidate or null.
 */
function nestedRotatedFinalLargeMoleculeDivalentLaneCandidate(layoutGraph, coords, centerAtomId, rootAtomId, branchRootAtomId, centerRotation, branchRotation) {
  const primaryCandidate = rotatedFinalLargeMoleculeAngleReliefCandidate(layoutGraph, coords, centerAtomId, rootAtomId, centerRotation);
  if (!primaryCandidate || rootAtomId === branchRootAtomId || Math.abs(branchRotation) <= PRESENTATION_METRIC_EPSILON) {
    return primaryCandidate;
  }

  const rootPosition = primaryCandidate.coords.get(rootAtomId);
  if (!rootPosition) {
    return null;
  }
  const branchSubtreeAtomIds = [...collectCutSubtree(layoutGraph, branchRootAtomId, rootAtomId)].filter(atomId => primaryCandidate.coords.has(atomId));
  if (branchSubtreeAtomIds.length === 0 || branchSubtreeAtomIds.includes(rootAtomId) || branchSubtreeAtomIds.includes(centerAtomId)) {
    return null;
  }
  for (const atomId of branchSubtreeAtomIds) {
    if (layoutGraph.fixedCoords?.has(atomId)) {
      return null;
    }
  }

  const candidateCoords = cloneCoords(primaryCandidate.coords);
  const movedAtomIds = new Set(primaryCandidate.movedAtomIds);
  for (const atomId of branchSubtreeAtomIds) {
    const position = primaryCandidate.coords.get(atomId);
    if (!position) {
      continue;
    }
    candidateCoords.set(atomId, add(rootPosition, rotate(sub(position, rootPosition), branchRotation)));
    movedAtomIds.add(atomId);
  }

  let totalMove = 0;
  for (const atomId of movedAtomIds) {
    const before = coords.get(atomId);
    const after = candidateCoords.get(atomId);
    if (before && after) {
      totalMove += Math.hypot(after.x - before.x, after.y - before.y);
    }
  }

  return totalMove > PRESENTATION_METRIC_EPSILON ? { coords: candidateCoords, movedAtomIds: [...movedAtomIds], totalMove, rotationMagnitude: Math.abs(centerRotation) + Math.abs(branchRotation) } : null;
}

/**
 * Builds small-rotation descriptors for distorted large-molecule angle centers.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinates.
 * @returns {Array<{centerAtomId: string, rootAtomId: string}>} Rotation descriptors.
 */
function finalLargeMoleculeAngleReliefDescriptors(layoutGraph, coords) {
  const descriptors = [];
  for (const atomId of coords.keys()) {
    if (!finalLargeMoleculeAngularReliefCenterNeedsWork(layoutGraph, coords, atomId)) {
      continue;
    }
    for (const { bond, neighborAtomId } of visibleHeavyCovalentBonds(layoutGraph, coords, atomId)) {
      if (bond.aromatic || (bond.order ?? 1) !== 1) {
        continue;
      }
      descriptors.push({ centerAtomId: atomId, rootAtomId: neighborAtomId });
    }
  }
  return descriptors;
}

/**
 * Retouches a remaining divalent peptide lane by pairing a small center bend
 * with a child-branch swing on the moved side.
 * @param {object} molecule - Molecule-like graph.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinates.
 * @param {object} currentAudit - Current final audit summary.
 * @param {{totalDeviation: number, maxDeviation: number}} currentScore - Current angle score.
 * @param {object} placement - Placement result containing validation classes.
 * @param {number} bondLength - Target bond length.
 * @returns {{changed: boolean, coords: Map<string, {x: number, y: number}>, movedAtomIds: string[], audit: object, score: object}} Retouch result.
 */
function maybeRetouchFinalLargeMoleculeDivalentLaneRelief(molecule, layoutGraph, coords, currentAudit, currentScore, placement, bondLength) {
  let bestCandidate = null;
  for (const atomId of coords.keys()) {
    const focusAtomIds = new Set([atomId]);
    const baseFocusedDivalent = measureDivalentContinuationDistortion(layoutGraph, coords, { focusAtomIds });
    if (baseFocusedDivalent.maxDeviation <= FINAL_LARGE_MOLECULE_DIVALENT_LANE_RELIEF_MIN_MAX_DEVIATION) {
      continue;
    }
    const centerBonds = visibleHeavyCovalentBonds(layoutGraph, coords, atomId).filter(({ bond }) => !bond.aromatic && (bond.order ?? 1) === 1);
    if (centerBonds.length !== 2) {
      continue;
    }
    for (const { neighborAtomId: rootAtomId } of centerBonds) {
      const branchBonds = visibleHeavyCovalentBonds(layoutGraph, coords, rootAtomId).filter(({ bond, neighborAtomId }) => neighborAtomId !== atomId && !bond.aromatic && (bond.order ?? 1) === 1);
      for (const { neighborAtomId: branchRootAtomId } of branchBonds) {
        for (const centerRotation of FINAL_LARGE_MOLECULE_ANGLE_RELIEF_ROTATIONS) {
          for (const branchRotation of FINAL_LARGE_MOLECULE_DIVALENT_LANE_BRANCH_ROTATIONS) {
            const candidate = nestedRotatedFinalLargeMoleculeDivalentLaneCandidate(layoutGraph, coords, atomId, rootAtomId, branchRootAtomId, centerRotation, branchRotation);
            if (!candidate) {
              continue;
            }
            const movedHeavyAtomCount = candidate.movedAtomIds.reduce((count, movedAtomId) => count + (layoutGraph.atoms.get(movedAtomId)?.element === 'H' ? 0 : 1), 0);
            if (movedHeavyAtomCount > FINAL_LARGE_MOLECULE_DIVALENT_LANE_MAX_MOVED_HEAVY_ATOMS) {
              continue;
            }
            const candidateFocusedDivalent = measureDivalentContinuationDistortion(layoutGraph, candidate.coords, { focusAtomIds });
            if (candidateFocusedDivalent.maxDeviation > baseFocusedDivalent.maxDeviation - FINAL_LARGE_MOLECULE_DIVALENT_LANE_RELIEF_MIN_DEVIATION_GAIN) {
              continue;
            }
            const candidateScore = finalLargeMoleculeAngularReliefScore(layoutGraph, candidate.coords);
            if (
              candidateScore.maxDeviation > currentScore.maxDeviation + PRESENTATION_METRIC_EPSILON ||
              candidateScore.totalDeviation > currentScore.totalDeviation + FINAL_LARGE_MOLECULE_DIVALENT_LANE_RELIEF_MAX_TOTAL_INCREASE + PRESENTATION_METRIC_EPSILON
            ) {
              continue;
            }
            const candidateAudit = auditFinalRetouchCoords(molecule, layoutGraph, candidate.coords, placement, bondLength);
            if (!finalAuditCountsDoNotWorsen(candidateAudit, currentAudit)) {
              continue;
            }
            const candidateWithFocus = {
              ...candidate,
              focusedDivalent: candidateFocusedDivalent,
              audit: candidateAudit,
              score: candidateScore
            };
            if (
              !bestCandidate ||
              candidateFocusedDivalent.maxDeviation < bestCandidate.focusedDivalent.maxDeviation - PRESENTATION_METRIC_EPSILON ||
              (Math.abs(candidateFocusedDivalent.maxDeviation - bestCandidate.focusedDivalent.maxDeviation) <= PRESENTATION_METRIC_EPSILON &&
                finalLargeMoleculeAngleReliefCandidateIsBetter(candidate, candidateScore, bestCandidate))
            ) {
              bestCandidate = candidateWithFocus;
            }
          }
        }
      }
    }
  }

  return bestCandidate
    ? {
        changed: true,
        coords: bestCandidate.coords,
        movedAtomIds: bestCandidate.movedAtomIds,
        audit: bestCandidate.audit,
        score: bestCandidate.score
      }
    : {
        changed: false,
        coords,
        movedAtomIds: [],
        audit: currentAudit,
        score: currentScore
      };
}

/**
 * Returns whether bounded final angle relief should run for this layout size.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {{primaryFamily: string}} familySummary - Family classification.
 * @returns {boolean} True for medium large-molecule layouts where the bounded search stays cheap.
 */
function shouldRunFinalLargeMoleculeAngleRelief(layoutGraph, familySummary) {
  const heavyAtomCount = layoutGraph.traits?.heavyAtomCount ?? layoutGraph.atoms?.size ?? 0;
  return familySummary.primaryFamily === 'large-molecule' && heavyAtomCount <= FINAL_LARGE_MOLECULE_ANGLE_RELIEF_MAX_HEAVY_ATOMS;
}

/**
 * Returns whether a ring-rich peptide-scale large molecule should prefer a
 * final backbone-spread retouch instead of whole-molecule landscape leveling.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {{primaryFamily: string}} familySummary - Family classification.
 * @returns {boolean} True when the layout is in the guarded backbone-spread scope.
 */
function shouldPreferFinalLargeMoleculeBackboneSpread(layoutGraph, familySummary) {
  const heavyAtomCount = layoutGraph.traits?.heavyAtomCount ?? layoutGraph.atoms?.size ?? 0;
  const ringCount = layoutGraph.traits?.ringCount ?? layoutGraph.rings?.length ?? 0;
  const ringSystemCount = layoutGraph.traits?.ringSystemCount ?? layoutGraph.ringSystems?.length ?? 0;
  return (
    familySummary.primaryFamily === 'large-molecule' &&
    heavyAtomCount <= FINAL_LARGE_MOLECULE_ANGLE_RELIEF_MAX_HEAVY_ATOMS &&
    ringCount >= FINAL_LARGE_MOLECULE_BACKBONE_SPREAD_MIN_RING_COUNT &&
    ringSystemCount >= FINAL_LARGE_MOLECULE_BACKBONE_SPREAD_MIN_RING_SYSTEM_COUNT
  );
}

/**
 * Returns the preferred heavy-atom path used to score final large-molecule
 * backbone spread.
 * @param {object} molecule - Molecule-like graph.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinates.
 * @returns {string[]} Path atom IDs present in the coordinate map.
 */
function finalLargeMoleculeBackboneSpreadPath(molecule, coords) {
  const preferredBackbone = findPreferredBackbonePath(molecule);
  return (preferredBackbone?.path ?? []).filter(atomId => coords.has(atomId));
}

/**
 * Scores how horizontally spread the preferred large-molecule path is.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinates.
 * @param {string[]} pathAtomIds - Preferred path atom IDs.
 * @returns {{aspect: number, width: number, height: number}} Path spread score.
 */
function finalLargeMoleculeBackboneSpreadScore(coords, pathAtomIds) {
  const bounds = computeBounds(coords, pathAtomIds);
  if (!bounds) {
    return { aspect: 0, width: 0, height: 0 };
  }
  return {
    aspect: bounds.width / Math.max(bounds.height, NUMERIC_EPSILON),
    width: bounds.width,
    height: bounds.height
  };
}

/**
 * Builds cut-subtree rotations along a preferred large-molecule backbone path.
 * @param {object} molecule - Molecule-like graph.
 * @param {string[]} pathAtomIds - Preferred path atom IDs.
 * @returns {Array<{centerAtomId: string, rootAtomId: string}>} Rotation descriptors.
 */
function finalLargeMoleculeBackboneSpreadDescriptors(molecule, pathAtomIds) {
  const descriptors = [];
  for (let index = 0; index < pathAtomIds.length - 1; index++) {
    const firstAtomId = pathAtomIds[index];
    const secondAtomId = pathAtomIds[index + 1];
    const bond = molecule.getBond(firstAtomId, secondAtomId);
    if (!bond || bond.properties.aromatic || (bond.properties.order ?? 1) !== 1) {
      continue;
    }
    descriptors.push({ centerAtomId: firstAtomId, rootAtomId: secondAtomId });
    descriptors.push({ centerAtomId: secondAtomId, rootAtomId: firstAtomId });
  }
  return descriptors;
}

/**
 * Applies a guarded final retouch that spreads snake-like peptide backbones
 * before whole-molecule orientation can make the path look vertically curled.
 * The move budget is intentionally tiny and every candidate must keep the
 * audit clean while staying below the same max-angle threshold used by final
 * large-molecule angle relief.
 * @param {object} molecule - Molecule-like graph.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} finalCoords - Current coordinates.
 * @param {object} placement - Placement result containing validation classes.
 * @param {number} bondLength - Target bond length.
 * @returns {{changed: boolean, coords: Map<string, {x: number, y: number}>, movedAtomIds: string[], spreadBefore: object, spreadAfter: object, scoreBefore: object, scoreAfter: object, audit: object}} Spread result.
 */
function maybeSpreadFinalLargeMoleculeBackbone(molecule, layoutGraph, finalCoords, placement, bondLength) {
  const pathAtomIds = finalLargeMoleculeBackboneSpreadPath(molecule, finalCoords);
  const spreadBefore = finalLargeMoleculeBackboneSpreadScore(finalCoords, pathAtomIds);
  let currentSpread = spreadBefore;
  let currentScore = finalLargeMoleculeAngularReliefScore(layoutGraph, finalCoords);
  const scoreBefore = currentScore;
  if (pathAtomIds.length < FINAL_LARGE_MOLECULE_BACKBONE_SPREAD_MIN_PATH_LENGTH || currentSpread.aspect >= FINAL_LARGE_MOLECULE_BACKBONE_SPREAD_TARGET_ASPECT) {
    const currentAudit = auditFinalRetouchCoords(molecule, layoutGraph, finalCoords, placement, bondLength);
    return { changed: false, coords: finalCoords, movedAtomIds: [], spreadBefore, spreadAfter: currentSpread, scoreBefore, scoreAfter: currentScore, audit: currentAudit };
  }

  let currentCoords = finalCoords;
  let currentAudit = auditFinalRetouchCoords(molecule, layoutGraph, currentCoords, placement, bondLength);
  const descriptors = finalLargeMoleculeBackboneSpreadDescriptors(molecule, pathAtomIds);
  const movedAtomIds = new Set();
  let changed = false;

  for (let passIndex = 0; passIndex < FINAL_LARGE_MOLECULE_BACKBONE_SPREAD_MAX_PASSES; passIndex++) {
    let bestCandidate = null;
    for (const descriptor of descriptors) {
      for (const rotation of FINAL_LARGE_MOLECULE_BACKBONE_SPREAD_ROTATIONS) {
        const candidate = rotatedFinalLargeMoleculeAngleReliefCandidate(layoutGraph, currentCoords, descriptor.centerAtomId, descriptor.rootAtomId, rotation);
        if (!candidate) {
          continue;
        }
        const candidateSpread = finalLargeMoleculeBackboneSpreadScore(candidate.coords, pathAtomIds);
        if (candidateSpread.aspect < currentSpread.aspect + FINAL_LARGE_MOLECULE_BACKBONE_SPREAD_MIN_ASPECT_GAIN) {
          continue;
        }
        const candidateScore = finalLargeMoleculeAngularReliefScore(layoutGraph, candidate.coords);
        if (
          candidateScore.maxDeviation > FINAL_LARGE_MOLECULE_ANGLE_RELIEF_MIN_MAX_DEVIATION + PRESENTATION_METRIC_EPSILON ||
          candidateScore.totalDeviation > FINAL_LARGE_MOLECULE_BACKBONE_SPREAD_MAX_TOTAL_DEVIATION + PRESENTATION_METRIC_EPSILON
        ) {
          continue;
        }
        const candidateAudit = auditFinalRetouchCoords(molecule, layoutGraph, candidate.coords, placement, bondLength);
        if (!finalAuditCountsDoNotWorsen(candidateAudit, currentAudit)) {
          continue;
        }
        if (
          !bestCandidate ||
          candidateSpread.aspect > bestCandidate.spread.aspect + PRESENTATION_METRIC_EPSILON ||
          (Math.abs(candidateSpread.aspect - bestCandidate.spread.aspect) <= PRESENTATION_METRIC_EPSILON && finalLargeMoleculeAngularReliefScoreIsBetter(candidateScore, bestCandidate.score))
        ) {
          bestCandidate = {
            ...candidate,
            audit: candidateAudit,
            score: candidateScore,
            spread: candidateSpread
          };
        }
      }
    }
    if (!bestCandidate) {
      break;
    }
    currentCoords = bestCandidate.coords;
    currentAudit = bestCandidate.audit;
    currentScore = bestCandidate.score;
    currentSpread = bestCandidate.spread;
    for (const atomId of bestCandidate.movedAtomIds) {
      movedAtomIds.add(atomId);
    }
    changed = true;
    if (currentSpread.aspect >= FINAL_LARGE_MOLECULE_BACKBONE_SPREAD_TARGET_ASPECT) {
      break;
    }
  }

  return {
    changed,
    coords: currentCoords,
    movedAtomIds: [...movedAtomIds],
    spreadBefore,
    spreadAfter: currentSpread,
    scoreBefore,
    scoreAfter: currentScore,
    audit: currentAudit
  };
}

/**
 * Applies small rigid branch rotations around remaining large-molecule angle
 * kinks after the exact final fan pass. The search is audit-preserving and
 * scores only aggregate presentation-angle relief, so it can smooth peptide
 * continuations without reopening overlaps or bond-length failures.
 * @param {object} molecule - Molecule-like graph.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} finalCoords - Current coordinates.
 * @param {object} placement - Placement result containing validation classes.
 * @param {number} bondLength - Target bond length.
 * @returns {{changed: boolean, coords: Map<string, {x: number, y: number}>, movedAtomIds: string[], scoreBefore: object, scoreAfter: object, audit: object}} Angle relief result.
 */
function maybeRelieveFinalLargeMoleculeAngles(molecule, layoutGraph, finalCoords, placement, bondLength) {
  let currentCoords = finalCoords;
  let currentScore = finalLargeMoleculeAngularReliefScore(layoutGraph, currentCoords);
  const scoreBefore = currentScore;
  if (currentScore.maxDeviation <= FINAL_LARGE_MOLECULE_ANGLE_RELIEF_MIN_MAX_DEVIATION) {
    const currentAudit = auditFinalRetouchCoords(molecule, layoutGraph, currentCoords, placement, bondLength);
    return { changed: false, coords: finalCoords, movedAtomIds: [], scoreBefore, scoreAfter: currentScore, audit: currentAudit };
  }

  let currentAudit = auditFinalRetouchCoords(molecule, layoutGraph, currentCoords, placement, bondLength);
  const movedAtomIds = new Set();
  let changed = false;
  for (let passIndex = 0; passIndex < FINAL_LARGE_MOLECULE_ANGLE_RELIEF_MAX_PASSES; passIndex++) {
    let bestCandidate = null;
    const tryCandidate = candidate => {
      if (!candidate) {
        return;
      }
      const candidateAudit = auditFinalRetouchCoords(molecule, layoutGraph, candidate.coords, placement, bondLength);
      if (!finalAuditCountsDoNotWorsen(candidateAudit, currentAudit)) {
        return;
      }
      const candidateScore = finalLargeMoleculeAngularReliefScore(layoutGraph, candidate.coords);
      if (!finalLargeMoleculeAngularReliefScoreIsBetter(candidateScore, currentScore)) {
        return;
      }
      if (!finalLargeMoleculeAngleReliefCandidateIsBetter(candidate, candidateScore, bestCandidate)) {
        return;
      }
      bestCandidate = {
        ...candidate,
        audit: candidateAudit,
        score: candidateScore
      };
    };
    for (const descriptor of finalLargeMoleculeAngleReliefDescriptors(layoutGraph, currentCoords)) {
      for (const rotation of FINAL_LARGE_MOLECULE_ANGLE_RELIEF_ROTATIONS) {
        tryCandidate(rotatedFinalLargeMoleculeAngleReliefCandidate(layoutGraph, currentCoords, descriptor.centerAtomId, descriptor.rootAtomId, rotation));
      }
    }
    if (!bestCandidate) {
      break;
    }
    currentCoords = bestCandidate.coords;
    currentAudit = bestCandidate.audit;
    currentScore = bestCandidate.score;
    for (const atomId of bestCandidate.movedAtomIds) {
      movedAtomIds.add(atomId);
    }
    changed = true;
  }

  return {
    changed,
    coords: currentCoords,
    movedAtomIds: [...movedAtomIds],
    scoreBefore,
    scoreAfter: currentScore,
    audit: currentAudit
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
  const labelClearanceAccepted = finalAuditCountsDoNotWorsen(candidateAudit, currentAudit) || finalDirtyLargeLabelClearanceTradeoffIsAcceptable(layoutGraph, candidateAudit, currentAudit);
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

function countEstimatedLabelOverlaps(layoutGraph, coords, bondLength, labelMetrics) {
  const labelBoxes = collectLabelBoxes(layoutGraph, coords, bondLength, { labelMetrics });
  return summarizeLabelOverlaps(labelBoxes, bondLength * 0.08).pairCount;
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
  const useWideRotations = heavyAtomCount >= 250 && ((currentAudit.severeOverlapCount ?? 0) > 0 || (currentAudit.visibleHeavyBondCrossingCount ?? 0) > 0);
  const connectorRotations = useWideRotations ? [...FINAL_CONNECTOR_LABEL_ROTATIONS, ...FINAL_CONNECTOR_LABEL_WIDE_ROTATIONS] : FINAL_CONNECTOR_LABEL_ROTATIONS;
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
          const candidateLabelOverlapCount = countEstimatedLabelOverlaps(layoutGraph, candidateCoords, bondLength, labelMetrics);
          if (candidateLabelOverlapCount >= (currentAudit.labelOverlapCount ?? 0)) {
            continue;
          }
          const candidateAudit = auditFinalRetouchCoords(molecule, layoutGraph, candidateCoords, placement, bondLength);
          const connectorClearanceAccepted = finalAuditCountsDoNotWorsen(candidateAudit, currentAudit) || finalDirtyLargeLabelClearanceTradeoffIsAcceptable(layoutGraph, candidateAudit, currentAudit);
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
  const startingAudit = currentAudit;

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
          const candidateLabelOverlapCount = countEstimatedLabelOverlaps(layoutGraph, candidateCoords, bondLength, labelMetrics);
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

function rotateFinalLabelAxisCoords(coords, origin, rotation) {
  const candidateCoords = new Map();
  for (const [atomId, position] of coords) {
    candidateCoords.set(atomId, add(origin, rotate(sub(position, origin), rotation)));
  }
  return candidateCoords;
}

function compareFinalLabelAxisRotationCandidates(candidate, incumbent) {
  if (!incumbent) {
    return -1;
  }
  for (const key of ['labelOverlapCount', 'severeOverlapCount', 'visibleHeavyBondCrossingCount', 'bondLengthFailureCount', 'ringSubstituentReadabilityFailureCount']) {
    const candidateValue = candidate.audit[key] ?? 0;
    const incumbentValue = incumbent.audit[key] ?? 0;
    if (candidateValue !== incumbentValue) {
      return candidateValue - incumbentValue;
    }
  }
  return candidate.rotationMagnitude - incumbent.rotationMagnitude;
}

function maybeApplyGuardedFinalLabelAxisRotation(molecule, layoutGraph, coords, placement, bondLength, labelMetrics) {
  const currentAudit = auditFinalRetouchCoords(molecule, layoutGraph, coords, placement, bondLength);
  if ((currentAudit.labelOverlapCount ?? 0) === 0) {
    return {
      changed: false,
      coords,
      rotation: 0,
      currentAudit,
      candidateAudit: null
    };
  }
  const origin = centroidForPoints(coords.values());
  if (!origin) {
    return {
      changed: false,
      coords,
      rotation: 0,
      currentAudit,
      candidateAudit: null
    };
  }

  let bestCandidate = null;
  for (const rotation of FINAL_LABEL_AXIS_ROTATIONS) {
    const candidateCoords = rotateFinalLabelAxisCoords(coords, origin, rotation);
    const candidateLabelOverlapCount = countEstimatedLabelOverlaps(layoutGraph, candidateCoords, bondLength, labelMetrics);
    if (candidateLabelOverlapCount >= (currentAudit.labelOverlapCount ?? 0)) {
      continue;
    }
    const candidateAudit = auditFinalRetouchCoords(molecule, layoutGraph, candidateCoords, placement, bondLength);
    if (!finalAuditCountsDoNotWorsen(candidateAudit, currentAudit)) {
      continue;
    }
    const candidate = {
      coords: candidateCoords,
      audit: candidateAudit,
      rotation,
      rotationMagnitude: Math.abs(rotation)
    };
    if (compareFinalLabelAxisRotationCandidates(candidate, bestCandidate) < 0) {
      bestCandidate = candidate;
    }
  }

  if (!bestCandidate) {
    return {
      changed: false,
      coords,
      rotation: 0,
      currentAudit,
      candidateAudit: null
    };
  }

  return {
    changed: true,
    coords: bestCandidate.coords,
    rotation: bestCandidate.rotation,
    currentAudit,
    candidateAudit: bestCandidate.audit
  };
}

function hasFinalLabelClearanceNeed(layoutGraph, coords, bondLength, labelMetrics) {
  return measureLabelOverlap(layoutGraph, coords, bondLength, { labelMetrics }).pairCount > 0;
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
 * contact-relief carbon/halogen leaf without moving its parent branch.
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

function finalTerminalCarbonLeafContactDescriptor(layoutGraph, coords, atomId, options = {}) {
  const atom = layoutGraph.atoms.get(atomId);
  const isSingleBondRetouchableLeaf = Boolean(
    options.includeSingleBondHeteroLeaves === true &&
    layoutGraph &&
    atom &&
    FINAL_TERMINAL_CONTACT_SINGLE_BOND_LEAF_ELEMENTS.has(atom.element) &&
    !atom.aromatic &&
    atom.heavyDegree === 1 &&
    !layoutGraph.ringAtomIdSet.has(atomId)
  );
  const allowsMultipleBondHeteroLeaf = Boolean(
    options.includeMultipleBondHeteroLeaves === true &&
    layoutGraph &&
    atom &&
    FINAL_TERMINAL_CONTACT_MULTIPLE_BOND_HETERO_LEAF_ELEMENTS.has(atom.element) &&
    !atom.aromatic &&
    atom.heavyDegree === 1 &&
    !layoutGraph.ringAtomIdSet.has(atomId)
  );
  if ((!isRetouchableFinalTerminalContactLeafAtom(layoutGraph, atom, atomId) && !isSingleBondRetouchableLeaf && !allowsMultipleBondHeteroLeaf) || !coords.has(atomId)) {
    return null;
  }

  const heavyNeighborBonds = (layoutGraph.bondsByAtomId.get(atomId) ?? [])
    .filter(bond => bond?.kind === 'covalent' && !bond.aromatic && !bond.inRing)
    .filter(bond => {
      const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
      return layoutGraph.atoms.get(neighborAtomId)?.element !== 'H' && coords.has(neighborAtomId);
    });
  if (heavyNeighborBonds.length !== 1) {
    return null;
  }
  const anchorBond = heavyNeighborBonds[0];
  const anchorAtomId = anchorBond.a === atomId ? anchorBond.b : anchorBond.a;
  const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
  const isMultipleBondHeteroLeaf = Boolean(
    allowsMultipleBondHeteroLeaf && (anchorBond.order ?? 1) > 1 && anchorAtom && !anchorAtom.aromatic && FINAL_TERMINAL_CONTACT_MULTIPLE_BOND_HETERO_ANCHOR_ELEMENTS.has(anchorAtom.element)
  );
  if (!isMultipleBondHeteroLeaf && (anchorBond.order ?? 1) !== 1) {
    return null;
  }
  if (allowsMultipleBondHeteroLeaf && (anchorBond.order ?? 1) > 1 && !isMultipleBondHeteroLeaf) {
    return null;
  }
  const movedAtomIds = collectFinalTerminalCarbonLeafSubtreeAtomIds(layoutGraph, atomId, anchorAtomId, coords);
  const movedHeavyAtomIds = movedAtomIds.filter(movedAtomId => layoutGraph.atoms.get(movedAtomId)?.element !== 'H');
  if (movedHeavyAtomIds.length !== 1 || movedHeavyAtomIds[0] !== atomId) {
    return null;
  }
  return {
    anchorAtomId,
    leafAtomId: atomId,
    movedAtomIds,
    singleBondHeteroLeaf: isSingleBondRetouchableLeaf,
    multipleBondHeteroLeaf: isMultipleBondHeteroLeaf
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

function finalTerminalCarbonLeafNearContactDescriptors(layoutGraph, coords, bondLength, options = {}) {
  const clearanceThreshold = bondLength * FINAL_TERMINAL_LEAF_CONTACT_CLEARANCE_FACTOR;
  const descriptors = [];
  for (const atomId of coords.keys()) {
    const descriptor = finalTerminalCarbonLeafContactDescriptor(layoutGraph, coords, atomId, options);
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
 * Finds terminal contact-leaf descriptors for bonds participating in visible
 * heavy-bond crossings, allowing the existing leaf rotation retouch to clear
 * local crossings without moving ring atoms or larger substituent branches.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {object} [options] - Descriptor options forwarded to the contact descriptor builder.
 * @returns {Array<object>} Terminal carbon leaf descriptors touching crossings.
 */
function finalTerminalCarbonLeafCrossingDescriptors(layoutGraph, coords, options = {}) {
  const descriptors = [];
  for (const crossing of findVisibleHeavyBondCrossings(layoutGraph, coords)) {
    for (const atomId of [...crossing.firstAtomIds, ...crossing.secondAtomIds]) {
      const descriptor = finalTerminalCarbonLeafContactDescriptor(layoutGraph, coords, atomId, options);
      if (descriptor) {
        descriptors.push(descriptor);
      }
    }
  }
  return descriptors;
}

function isFinalTerminalHalogenLeafDescriptor(layoutGraph, descriptor) {
  const atom = layoutGraph.atoms.get(descriptor?.leafAtomId);
  return Boolean(atom && FINAL_TERMINAL_PAIRED_HALOGEN_LEAF_ELEMENTS.has(atom.element));
}

function finalTerminalHalogenLeavesAttachedTo(layoutGraph, coords, anchorAtomId, options = {}) {
  const descriptors = [];
  for (const bond of layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || bond.inRing) {
      continue;
    }
    const leafAtomId = bond.a === anchorAtomId ? bond.b : bond.a;
    const descriptor = finalTerminalCarbonLeafContactDescriptor(layoutGraph, coords, leafAtomId, options);
    if (descriptor?.anchorAtomId === anchorAtomId && isFinalTerminalHalogenLeafDescriptor(layoutGraph, descriptor)) {
      descriptors.push(descriptor);
    }
  }
  return descriptors;
}

function finalTerminalPairedHalogenContactDescriptors(layoutGraph, coords, bondLength, options = {}) {
  const heavyAtomCount = layoutGraph.traits?.heavyAtomCount ?? layoutGraph.atoms?.size ?? 0;
  if (heavyAtomCount > FINAL_TERMINAL_PAIRED_HALOGEN_CONTACT_MAX_LAYOUT_HEAVY_ATOMS) {
    return [];
  }

  const descriptors = [];
  const seen = new Set();
  for (const overlap of findSevereOverlaps(layoutGraph, coords, bondLength)) {
    for (const [primaryAtomId, blockerAtomId] of [
      [overlap.firstAtomId, overlap.secondAtomId],
      [overlap.secondAtomId, overlap.firstAtomId]
    ]) {
      const primary = finalTerminalCarbonLeafContactDescriptor(layoutGraph, coords, primaryAtomId, options);
      if (!primary || !isFinalTerminalHalogenLeafDescriptor(layoutGraph, primary)) {
        continue;
      }
      for (const helper of finalTerminalHalogenLeavesAttachedTo(layoutGraph, coords, blockerAtomId, options)) {
        if (helper.leafAtomId === primary.leafAtomId) {
          continue;
        }
        const key = `${primary.anchorAtomId}:${primary.leafAtomId}:${helper.anchorAtomId}:${helper.leafAtomId}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        descriptors.push({ primary, helper });
        if (descriptors.length >= FINAL_TERMINAL_PAIRED_HALOGEN_CONTACT_MAX_DESCRIPTORS) {
          return descriptors;
        }
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

function rotateFinalTerminalPairedHalogenContactCandidate(coords, descriptor, primaryRotationOffset, helperRotationOffset) {
  const candidateCoords = cloneCoords(coords);
  for (const [leafDescriptor, rotationOffset] of [
    [descriptor.primary, primaryRotationOffset],
    [descriptor.helper, helperRotationOffset]
  ]) {
    const anchorPosition = coords.get(leafDescriptor.anchorAtomId);
    if (!anchorPosition) {
      return null;
    }
    for (const atomId of leafDescriptor.movedAtomIds) {
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

/**
 * Returns whether a terminal contact leaf sits inside any ring face incident
 * to its anchor. Final contact retouches may clear nearby atoms, but they
 * should not turn an already-exterior ring substituent back into the ring.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {{anchorAtomId: string, leafAtomId: string}} descriptor - Terminal leaf descriptor.
 * @returns {boolean} True when the leaf is inside an incident ring polygon.
 */
function finalTerminalContactLeafInsideIncidentRing(layoutGraph, coords, descriptor) {
  const leafPosition = coords.get(descriptor.leafAtomId);
  if (!leafPosition) {
    return false;
  }
  for (const ring of layoutGraph.atomToRings.get(descriptor.anchorAtomId) ?? []) {
    const polygon = ring.atomIds.map(atomId => coords.get(atomId)).filter(Boolean);
    if (polygon.length >= 3 && pointInPolygon(leafPosition, polygon)) {
      return true;
    }
  }
  return false;
}

/**
 * Returns whether rotating a final contact leaf would newly intrude into an
 * incident ring face that the current layout kept clear.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} currentCoords - Current coordinates.
 * @param {Map<string, {x: number, y: number}>} candidateCoords - Candidate coordinates.
 * @param {{anchorAtomId: string, leafAtomId: string}} descriptor - Terminal leaf descriptor.
 * @returns {boolean} True when the candidate newly creates an inward ring leaf.
 */
function finalTerminalContactLeafCandidateCreatesRingIntrusion(layoutGraph, currentCoords, candidateCoords, descriptor) {
  return !finalTerminalContactLeafInsideIncidentRing(layoutGraph, currentCoords, descriptor) && finalTerminalContactLeafInsideIncidentRing(layoutGraph, candidateCoords, descriptor);
}

function finalTerminalCarbonLeafContactAuditCanReplace(
  candidateAudit,
  baseAudit,
  candidateClearance = Number.POSITIVE_INFINITY,
  baseClearance = Number.POSITIVE_INFINITY,
  clearanceThreshold = Number.POSITIVE_INFINITY,
  options = {}
) {
  if (!candidateAudit || !baseAudit || (baseAudit.ok === true && candidateAudit.ok !== true)) {
    return false;
  }
  const allowVisibleHeavyBondCrossingWorsening = Boolean(
    options.allowAuditCleanAcylLeafFanTradeoff === true &&
    candidateAudit.ok === true &&
    candidateAudit.fallback?.mode == null &&
    (candidateAudit.severeOverlapCount ?? 0) === 0 &&
    (candidateAudit.bondLengthFailureCount ?? 0) <= (baseAudit.bondLengthFailureCount ?? 0) &&
    (candidateAudit.labelOverlapCount ?? 0) <= (baseAudit.labelOverlapCount ?? 0) &&
    (candidateAudit.ringSubstituentReadabilityFailureCount ?? 0) <= (baseAudit.ringSubstituentReadabilityFailureCount ?? 0) &&
    (candidateAudit.visibleHeavyBondCrossingCount ?? 0) <= (baseAudit.visibleHeavyBondCrossingCount ?? 0) + 1
  );
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
    if (key === 'visibleHeavyBondCrossingCount' && allowVisibleHeavyBondCrossingWorsening) {
      continue;
    }
    if ((candidateAudit[key] ?? 0) > (baseAudit[key] ?? 0)) {
      return false;
    }
  }
  if ((candidateAudit.stereoContradiction ?? false) && !(baseAudit.stereoContradiction ?? false)) {
    return false;
  }
  if (options.preventSevereOverlapWorsening === true && (candidateAudit.severeOverlapCount ?? 0) > (baseAudit.severeOverlapCount ?? 0)) {
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

function isFinalTerminalAcylCarbonLeafFanDescriptor(layoutGraph, descriptor) {
  const leafAtom = layoutGraph.atoms.get(descriptor?.leafAtomId);
  const centerAtom = layoutGraph.atoms.get(descriptor?.anchorAtomId);
  if (
    !leafAtom ||
    !centerAtom ||
    leafAtom.element !== 'C' ||
    centerAtom.element !== 'C' ||
    leafAtom.heavyDegree !== 1 ||
    centerAtom.heavyDegree !== 3 ||
    leafAtom.aromatic ||
    centerAtom.aromatic ||
    layoutGraph.ringAtomIdSet.has(descriptor.leafAtomId) ||
    layoutGraph.ringAtomIdSet.has(descriptor.anchorAtomId)
  ) {
    return false;
  }
  let hasTerminalMultipleBondHeteroLeaf = false;
  let hasRingNeighbor = false;
  for (const bond of layoutGraph.bondsByAtomId.get(descriptor.anchorAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || bond.inRing) {
      continue;
    }
    const neighborAtomId = bond.a === descriptor.anchorAtomId ? bond.b : bond.a;
    if (neighborAtomId === descriptor.leafAtomId) {
      if ((bond.order ?? 1) !== 1) {
        return false;
      }
      continue;
    }
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H') {
      continue;
    }
    if (layoutGraph.ringAtomIdSet.has(neighborAtomId)) {
      hasRingNeighbor = true;
      continue;
    }
    if ((bond.order ?? 1) >= 2 && neighborAtom.element !== 'C' && neighborAtom.heavyDegree === 1 && !layoutGraph.ringAtomIdSet.has(neighborAtomId)) {
      hasTerminalMultipleBondHeteroLeaf = true;
    }
  }
  return hasTerminalMultipleBondHeteroLeaf && hasRingNeighbor;
}

function finalTerminalAcylCarbonLeafFanTradeoffAllowed(layoutGraph, currentCoords, candidateCoords, descriptor, baseAudit, candidateAudit) {
  if (
    !isFinalTerminalAcylCarbonLeafFanDescriptor(layoutGraph, descriptor) ||
    (baseAudit.severeOverlapCount ?? 0) === 0 ||
    (candidateAudit.severeOverlapCount ?? 0) !== 0 ||
    (candidateAudit.fallback?.mode ?? null) !== null
  ) {
    return false;
  }
  const baseTrigonalPenalty = measureTrigonalDistortion(layoutGraph, currentCoords);
  const candidateTrigonalPenalty = measureTrigonalDistortion(layoutGraph, candidateCoords);
  return (
    (candidateTrigonalPenalty.maxDeviation ?? Number.POSITIVE_INFINITY) < (baseTrigonalPenalty.maxDeviation ?? Number.POSITIVE_INFINITY) - PRESENTATION_METRIC_EPSILON &&
    (candidateTrigonalPenalty.totalDeviation ?? Number.POSITIVE_INFINITY) < (baseTrigonalPenalty.totalDeviation ?? Number.POSITIVE_INFINITY) - PRESENTATION_METRIC_EPSILON
  );
}

function finalTerminalAcylCarbonLeafFanContactDescriptorForAtom(layoutGraph, coords, atomId) {
  const atom = layoutGraph.atoms.get(atomId);
  if (!atom || atom.element !== 'C' || atom.aromatic || atom.heavyDegree !== 1 || layoutGraph.ringAtomIdSet.has(atomId) || !coords.has(atomId)) {
    return null;
  }
  const heavyBonds = (layoutGraph.bondsByAtomId.get(atomId) ?? []).filter(bond => {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || bond.inRing || (bond.order ?? 1) !== 1) {
      return false;
    }
    const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    return neighborAtom && neighborAtom.element === 'C' && !neighborAtom.aromatic && !layoutGraph.ringAtomIdSet.has(neighborAtomId) && coords.has(neighborAtomId);
  });
  if (heavyBonds.length !== 1) {
    return null;
  }
  const anchorAtomId = heavyBonds[0].a === atomId ? heavyBonds[0].b : heavyBonds[0].a;
  const movedAtomIds = collectFinalTerminalCarbonLeafSubtreeAtomIds(layoutGraph, atomId, anchorAtomId, coords);
  const movedHeavyAtomIds = movedAtomIds.filter(movedAtomId => layoutGraph.atoms.get(movedAtomId)?.element !== 'H');
  const descriptor = {
    anchorAtomId,
    leafAtomId: atomId,
    movedAtomIds
  };
  return movedHeavyAtomIds.length === 1 && movedHeavyAtomIds[0] === atomId && isFinalTerminalAcylCarbonLeafFanDescriptor(layoutGraph, descriptor) ? descriptor : null;
}

function finalTerminalAcylCarbonLeafFanContactDescriptors(layoutGraph, coords, bondLength) {
  const descriptors = [];
  const seen = new Set();
  for (const overlap of findSevereOverlaps(layoutGraph, coords, bondLength)) {
    for (const atomId of [overlap.firstAtomId, overlap.secondAtomId]) {
      const descriptor = finalTerminalAcylCarbonLeafFanContactDescriptorForAtom(layoutGraph, coords, atomId);
      if (!descriptor) {
        continue;
      }
      const key = `${descriptor.anchorAtomId}:${descriptor.leafAtomId}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      descriptors.push(descriptor);
    }
  }
  return descriptors;
}

function maybeRetouchFinalTerminalAcylCarbonLeafFanContacts(layoutGraph, finalCoords, placement, bondLength) {
  const baseAudit = auditLayout(layoutGraph, finalCoords, {
    bondLength,
    bondValidationClasses: placement.bondValidationClasses
  });
  if ((baseAudit.severeOverlapCount ?? 0) === 0) {
    return { coords: finalCoords, changed: false, movedAtomIds: [], audit: baseAudit };
  }
  let bestCandidate = null;
  const descriptors = finalTerminalAcylCarbonLeafFanContactDescriptors(layoutGraph, finalCoords, bondLength);
  for (const descriptor of descriptors) {
    for (const rotationOffset of FINAL_TERMINAL_LEAF_CONTACT_ROTATIONS) {
      const candidateCoords = rotateFinalTerminalCarbonLeafContactCandidate(finalCoords, descriptor, rotationOffset);
      if (!candidateCoords) {
        continue;
      }
      const candidateAudit = auditLayout(layoutGraph, candidateCoords, {
        bondLength,
        bondValidationClasses: placement.bondValidationClasses
      });
      const allowAuditCleanAcylLeafFanTradeoff = finalTerminalAcylCarbonLeafFanTradeoffAllowed(layoutGraph, finalCoords, candidateCoords, descriptor, baseAudit, candidateAudit);
      if (
        !allowAuditCleanAcylLeafFanTradeoff ||
        !finalTerminalCarbonLeafContactAuditCanReplace(candidateAudit, baseAudit, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, {
          allowAuditCleanAcylLeafFanTradeoff
        })
      ) {
        continue;
      }
      const candidate = {
        coords: candidateCoords,
        audit: candidateAudit,
        clearance: Number.POSITIVE_INFINITY,
        clearanceThreshold: Number.POSITIVE_INFINITY,
        leafAtomId: descriptor.leafAtomId,
        movedAtomIds: descriptor.movedAtomIds,
        rotationMagnitude: Math.abs(rotationOffset),
        totalMove: finalTerminalCarbonLeafContactCandidateMove(finalCoords, candidateCoords, descriptor.movedAtomIds)
      };
      if (compareFinalTerminalCarbonLeafContactCandidates(candidate, bestCandidate) < 0) {
        bestCandidate = candidate;
      }
    }
  }
  return bestCandidate
    ? {
        coords: bestCandidate.coords,
        changed: true,
        movedAtomIds: bestCandidate.movedAtomIds,
        audit: bestCandidate.audit
      }
    : { coords: finalCoords, changed: false, movedAtomIds: [], audit: baseAudit };
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

function finalTerminalCarbonylOxoContactDescriptor(layoutGraph, coords, atomId) {
  const atom = layoutGraph.atoms.get(atomId);
  if (!atom || atom.element !== 'O' || atom.aromatic || atom.heavyDegree !== 1 || layoutGraph.ringAtomIdSet.has(atomId) || !coords.has(atomId)) {
    return null;
  }
  const heavyNeighborBonds = (layoutGraph.bondsByAtomId.get(atomId) ?? [])
    .filter(bond => bond?.kind === 'covalent' && !bond.aromatic && !bond.inRing && (bond.order ?? 1) >= 2)
    .filter(bond => {
      const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      return neighborAtom && neighborAtom.element === 'C' && !neighborAtom.aromatic && coords.has(neighborAtomId);
    });
  if (heavyNeighborBonds.length !== 1) {
    return null;
  }
  const anchorAtomId = heavyNeighborBonds[0].a === atomId ? heavyNeighborBonds[0].b : heavyNeighborBonds[0].a;
  const movedAtomIds = collectFinalTerminalCarbonLeafSubtreeAtomIds(layoutGraph, atomId, anchorAtomId, coords);
  const movedHeavyAtomIds = movedAtomIds.filter(movedAtomId => layoutGraph.atoms.get(movedAtomId)?.element !== 'H');
  return movedHeavyAtomIds.length === 1 && movedHeavyAtomIds[0] === atomId
    ? {
        anchorAtomId,
        leafAtomId: atomId,
        movedAtomIds,
        carbonylOxoLeaf: true
      }
    : null;
}

function finalTerminalCarbonylOxoContactDescriptors(layoutGraph, coords, bondLength) {
  const descriptors = [];
  const seen = new Set();
  for (const overlap of findSevereOverlaps(layoutGraph, coords, bondLength)) {
    for (const atomId of [overlap.firstAtomId, overlap.secondAtomId]) {
      const descriptor = finalTerminalCarbonylOxoContactDescriptor(layoutGraph, coords, atomId);
      if (!descriptor) {
        continue;
      }
      const key = `${descriptor.anchorAtomId}:${descriptor.leafAtomId}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      descriptors.push(descriptor);
    }
  }
  return descriptors;
}

function maybeRetouchFinalTerminalCarbonylOxoSevereContacts(layoutGraph, finalCoords, placement, bondLength) {
  const baseAudit = auditLayout(layoutGraph, finalCoords, {
    bondLength,
    bondValidationClasses: placement.bondValidationClasses
  });
  if (
    (baseAudit.severeOverlapCount ?? 0) === 0 ||
    (baseAudit.bondLengthFailureCount ?? 0) > 0 ||
    (baseAudit.labelOverlapCount ?? 0) > 0 ||
    (baseAudit.ringSubstituentReadabilityFailureCount ?? 0) > 0 ||
    (baseAudit.collapsedMacrocycleCount ?? 0) > 0 ||
    (baseAudit.stereoContradiction ?? false)
  ) {
    return { coords: finalCoords, changed: false, movedAtomIds: [], audit: baseAudit };
  }

  let bestCandidate = null;
  for (const descriptor of finalTerminalCarbonylOxoContactDescriptors(layoutGraph, finalCoords, bondLength)) {
    for (const rotationOffset of FINAL_TERMINAL_CARBONYL_OXO_CONTACT_ROTATIONS) {
      const candidateCoords = rotateFinalTerminalCarbonLeafContactCandidate(finalCoords, descriptor, rotationOffset);
      if (!candidateCoords) {
        continue;
      }
      const candidateAudit = auditLayout(layoutGraph, candidateCoords, {
        bondLength,
        bondValidationClasses: placement.bondValidationClasses
      });
      if (
        candidateAudit.ok !== true ||
        candidateAudit.fallback?.mode != null ||
        (candidateAudit.severeOverlapCount ?? 0) >= (baseAudit.severeOverlapCount ?? 0) ||
        !finalAuditCountsDoNotWorsen(candidateAudit, baseAudit)
      ) {
        continue;
      }
      const candidate = {
        coords: candidateCoords,
        audit: candidateAudit,
        clearance: Number.POSITIVE_INFINITY,
        clearanceThreshold: Number.POSITIVE_INFINITY,
        leafAtomId: descriptor.leafAtomId,
        movedAtomIds: descriptor.movedAtomIds,
        rotationMagnitude: Math.abs(rotationOffset),
        totalMove: finalTerminalCarbonLeafContactCandidateMove(finalCoords, candidateCoords, descriptor.movedAtomIds)
      };
      if (compareFinalTerminalCarbonLeafContactCandidates(candidate, bestCandidate) < 0) {
        bestCandidate = candidate;
      }
    }
  }
  return bestCandidate
    ? {
        coords: bestCandidate.coords,
        changed: true,
        movedAtomIds: bestCandidate.movedAtomIds,
        audit: bestCandidate.audit
      }
    : { coords: finalCoords, changed: false, movedAtomIds: [], audit: baseAudit };
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

function shouldSkipDirtyGenericFinalTerminalMultipleBondFanRetouch(familySummary, audit) {
  return (
    familySummary.mixedMode === true &&
    audit?.fallback?.mode === 'generic-scaffold' &&
    ((audit.severeOverlapCount ?? 0) > 0 ||
      (audit.visibleHeavyBondCrossingCount ?? 0) > 0 ||
      (audit.labelOverlapCount ?? 0) > 0 ||
      (audit.ringSubstituentReadabilityFailureCount ?? 0) > 0 ||
      (audit.inwardRingSubstituentCount ?? 0) > 0) &&
    (audit.bondLengthFailureCount ?? 0) === 0 &&
    (audit.collapsedMacrocycleCount ?? 0) === 0 &&
    (audit.stereoContradiction ?? false) === false
  );
}

/**
 * Returns terminal-leaf descriptor options for the current final-contact audit.
 * Single-bond hetero leaves are only considered when a counted contact or
 * crossing needs relief, preserving the tighter clean-layout descriptor scan.
 * @param {object} audit - Current audit summary.
 * @param {object} options - Caller-supplied descriptor options.
 * @returns {object} Descriptor options for terminal-leaf scans.
 */
function finalTerminalLeafDescriptorOptionsForAudit(audit, options) {
  if ((audit?.severeOverlapCount ?? 0) > 0 || (audit?.visibleHeavyBondCrossingCount ?? 0) > 0) {
    return options;
  }
  return {
    ...options,
    includeSingleBondHeteroLeaves: false,
    includeMultipleBondHeteroLeaves: false
  };
}

function maybeRetouchFinalTerminalCarbonLeafSevereContacts(layoutGraph, finalCoords, placement, bondLength, options = {}) {
  let currentCoords = finalCoords;
  let baseAudit = auditLayout(layoutGraph, currentCoords, {
    bondLength,
    bondValidationClasses: placement.bondValidationClasses
  });
  const rotationOffsets = shouldUseCoarseDirtyLargeTerminalLeafContactRotations(layoutGraph, baseAudit) ? FINAL_TERMINAL_LEAF_CONTACT_DIRTY_LARGE_ROTATIONS : FINAL_TERMINAL_LEAF_CONTACT_ROTATIONS;
  const descriptorOptions = finalTerminalLeafDescriptorOptionsForAudit(baseAudit, options);
  if (
    (baseAudit.severeOverlapCount ?? 0) === 0 &&
    finalTerminalCarbonLeafNearContactDescriptors(layoutGraph, currentCoords, bondLength, descriptorOptions).length === 0 &&
    finalTerminalCarbonLeafCrossingDescriptors(layoutGraph, currentCoords, descriptorOptions).length === 0
  ) {
    return { coords: finalCoords, changed: false, movedAtomIds: [] };
  }

  const movedAtomIds = new Set();
  let changed = false;
  for (let passIndex = 0; passIndex < FINAL_TERMINAL_LEAF_CONTACT_MAX_PASSES; passIndex++) {
    const descriptorByKey = new Map();
    const passDescriptorOptions = finalTerminalLeafDescriptorOptionsForAudit(baseAudit, options);
    for (const overlap of findSevereOverlaps(layoutGraph, currentCoords, bondLength)) {
      for (const atomId of [overlap.firstAtomId, overlap.secondAtomId]) {
        const descriptor = finalTerminalCarbonLeafContactDescriptor(layoutGraph, currentCoords, atomId, passDescriptorOptions);
        if (!descriptor) {
          continue;
        }
        descriptorByKey.set(`${descriptor.anchorAtomId}:${descriptor.leafAtomId}`, descriptor);
      }
    }
    for (const descriptor of finalTerminalCarbonLeafNearContactDescriptors(layoutGraph, currentCoords, bondLength, passDescriptorOptions)) {
      descriptorByKey.set(`${descriptor.anchorAtomId}:${descriptor.leafAtomId}`, descriptor);
    }
    for (const descriptor of finalTerminalCarbonLeafCrossingDescriptors(layoutGraph, currentCoords, passDescriptorOptions)) {
      descriptorByKey.set(`${descriptor.anchorAtomId}:${descriptor.leafAtomId}`, descriptor);
    }
    if (descriptorByKey.size === 0) {
      break;
    }

    let bestCandidate = null;
    for (const descriptor of descriptorByKey.values()) {
      const descriptorRotationOffsets = descriptor.multipleBondHeteroLeaf === true ? FINAL_TERMINAL_MULTIPLE_BOND_HETERO_LEAF_ROTATIONS : rotationOffsets;
      for (const rotationOffset of descriptorRotationOffsets) {
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
        const allowAuditCleanAcylLeafFanTradeoff = finalTerminalAcylCarbonLeafFanTradeoffAllowed(layoutGraph, currentCoords, candidateCoords, descriptor, baseAudit, candidateAudit);
        if (
          finalTerminalContactLeafCandidateCreatesRingIntrusion(layoutGraph, currentCoords, candidateCoords, descriptor) ||
          !finalTerminalCarbonLeafContactAuditCanReplace(candidateAudit, baseAudit, candidateClearance, descriptor.clearance, descriptor.clearanceThreshold, {
            preventSevereOverlapWorsening: descriptor.singleBondHeteroLeaf === true,
            allowAuditCleanAcylLeafFanTradeoff
          })
        ) {
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
      finalTerminalCarbonLeafNearContactDescriptors(layoutGraph, currentCoords, bondLength, finalTerminalLeafDescriptorOptionsForAudit(baseAudit, options)).length === 0 &&
      finalTerminalCarbonLeafCrossingDescriptors(layoutGraph, currentCoords, finalTerminalLeafDescriptorOptionsForAudit(baseAudit, options)).length === 0
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

function finalAcyclicBranchContactDescriptor(layoutGraph, coords, rootAtomId, anchorAtomId, options = {}) {
  if (!layoutGraph || rootAtomId === anchorAtomId || !coords.has(rootAtomId) || !coords.has(anchorAtomId) || layoutGraph.ringAtomIdSet.has(rootAtomId)) {
    return null;
  }
  const rootAtom = layoutGraph.atoms.get(rootAtomId);
  const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
  if (!rootAtom || !anchorAtom || rootAtom.element === 'H' || anchorAtom.element === 'H') {
    return null;
  }
  const bond = layoutGraph.bondByAtomPair.get(atomPairKey(rootAtomId, anchorAtomId));
  if (!bond || bond.kind !== 'covalent' || bond.aromatic || bond.inRing || (bond.order ?? 1) !== 1) {
    return null;
  }

  const movedAtomIds = collectFinalTerminalCarbonLeafSubtreeAtomIds(layoutGraph, rootAtomId, anchorAtomId, coords);
  const movedHeavyAtomIds = movedAtomIds.filter(atomId => layoutGraph.atoms.get(atomId)?.element !== 'H');
  const maxMovedHeavyAtoms = options.maxMovedHeavyAtoms ?? FINAL_ACYCLIC_BRANCH_CONTACT_MAX_MOVED_HEAVY_ATOMS;
  if (movedHeavyAtomIds.length === 0 || movedHeavyAtomIds.length > maxMovedHeavyAtoms) {
    return null;
  }
  const visibleHeavyAtomCount = [...coords.keys()].filter(atomId => {
    const atom = layoutGraph.atoms.get(atomId);
    return atom && atom.element !== 'H' && atom.visible !== false;
  }).length;
  if (movedHeavyAtomIds.length >= visibleHeavyAtomCount - 1) {
    return null;
  }

  const terminalLeafSubtreeAtomIds = finalAcyclicBranchTerminalLeafSubtreeAtomIds(layoutGraph, coords, rootAtomId, anchorAtomId, movedAtomIds, movedHeavyAtomIds);

  return {
    anchorAtomId,
    rootAtomId,
    movedAtomIds,
    movedHeavyAtomIds,
    terminalLeafSubtreeAtomIds
  };
}

function finalAcyclicBranchTerminalLeafSubtreeAtomIds(layoutGraph, coords, rootAtomId, anchorAtomId, movedAtomIds, movedHeavyAtomIds) {
  if (movedHeavyAtomIds.length !== 2) {
    return [];
  }
  const movedAtomIdSet = new Set(movedAtomIds);
  for (const bond of layoutGraph.bondsByAtomId.get(rootAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || bond.inRing || (bond.order ?? 1) !== 1) {
      continue;
    }
    const neighborAtomId = bond.a === rootAtomId ? bond.b : bond.a;
    if (neighborAtomId === anchorAtomId || !movedAtomIdSet.has(neighborAtomId) || !coords.has(neighborAtomId)) {
      continue;
    }
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (
      !neighborAtom ||
      !FINAL_ACYCLIC_BRANCH_TERMINAL_LEAF_ELEMENTS.has(neighborAtom.element) ||
      neighborAtom.aromatic ||
      layoutGraph.ringAtomIdSet.has(neighborAtomId) ||
      (neighborAtom.heavyDegree ?? 0) !== 1
    ) {
      continue;
    }
    const leafSubtreeAtomIds = collectFinalTerminalCarbonLeafSubtreeAtomIds(layoutGraph, neighborAtomId, rootAtomId, coords).filter(atomId => movedAtomIdSet.has(atomId));
    const leafHeavyAtomIds = leafSubtreeAtomIds.filter(atomId => layoutGraph.atoms.get(atomId)?.element !== 'H');
    if (leafHeavyAtomIds.length === 1) {
      return leafSubtreeAtomIds;
    }
  }
  return [];
}

function finalAcyclicBranchContactDescriptors(layoutGraph, coords, bondLength, options = {}) {
  const descriptorByKey = new Map();
  for (const overlap of findSevereOverlaps(layoutGraph, coords, bondLength)) {
    for (const atomId of [overlap.firstAtomId, overlap.secondAtomId]) {
      const atom = layoutGraph.atoms.get(atomId);
      if (!atom || atom.element === 'H') {
        continue;
      }
      for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
        if (!bond || bond.kind !== 'covalent' || bond.aromatic || bond.inRing || (bond.order ?? 1) !== 1) {
          continue;
        }
        const anchorAtomId = bond.a === atomId ? bond.b : bond.a;
        const descriptor = finalAcyclicBranchContactDescriptor(layoutGraph, coords, atomId, anchorAtomId, options);
        if (!descriptor) {
          continue;
        }
        descriptorByKey.set(`${descriptor.anchorAtomId}:${descriptor.rootAtomId}`, descriptor);
      }
    }
  }
  return [...descriptorByKey.values()];
}

function rotateFinalAcyclicBranchContactCandidate(coords, descriptor, rotationOffset, leafRotationOffset = 0) {
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
    candidateCoords.set(atomId, rotateAround(position, anchorPosition, rotationOffset));
  }
  if ((descriptor.terminalLeafSubtreeAtomIds?.length ?? 0) > 0 && Math.abs(leafRotationOffset) > PRESENTATION_METRIC_EPSILON) {
    const rootPosition = candidateCoords.get(descriptor.rootAtomId);
    if (!rootPosition) {
      return null;
    }
    for (const atomId of descriptor.terminalLeafSubtreeAtomIds) {
      const position = candidateCoords.get(atomId);
      if (!position) {
        continue;
      }
      candidateCoords.set(atomId, rotateAround(position, rootPosition, leafRotationOffset));
    }
  }
  return candidateCoords;
}

function finalAcyclicBranchContactCandidateMove(coords, candidateCoords, atomIds) {
  return atomIds.reduce((totalMove, atomId) => {
    const position = coords.get(atomId);
    const candidatePosition = candidateCoords.get(atomId);
    return position && candidatePosition ? totalMove + Math.hypot(candidatePosition.x - position.x, candidatePosition.y - position.y) : totalMove;
  }, 0);
}

function finalAcyclicBranchContactAuditCanReplace(candidateAudit, baseAudit, options = {}) {
  if (!finalAuditCountsDoNotWorsen(candidateAudit, baseAudit)) {
    return false;
  }
  if (options.requireAuditClean === true && (candidateAudit.ok !== true || candidateAudit.fallback?.mode != null)) {
    return false;
  }
  return (
    (candidateAudit.severeOverlapCount ?? 0) < (baseAudit.severeOverlapCount ?? 0) ||
    ((candidateAudit.severeOverlapCount ?? 0) === (baseAudit.severeOverlapCount ?? 0) &&
      (candidateAudit.severeOverlapPenalty ?? 0) < (baseAudit.severeOverlapPenalty ?? 0) - PRESENTATION_METRIC_EPSILON)
  );
}

function compareFinalAcyclicBranchContactCandidates(candidate, incumbent) {
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
  if (candidate.movedHeavyAtomCount !== incumbent.movedHeavyAtomCount) {
    return candidate.movedHeavyAtomCount - incumbent.movedHeavyAtomCount;
  }
  if (Math.abs(candidate.totalMove - incumbent.totalMove) > PRESENTATION_METRIC_EPSILON) {
    return candidate.totalMove - incumbent.totalMove;
  }
  if (Math.abs(candidate.rotationMagnitude - incumbent.rotationMagnitude) > PRESENTATION_METRIC_EPSILON) {
    return candidate.rotationMagnitude - incumbent.rotationMagnitude;
  }
  return `${candidate.anchorAtomId}:${candidate.rootAtomId}`.localeCompare(`${incumbent.anchorAtomId}:${incumbent.rootAtomId}`, 'en', { numeric: true });
}

function finalTerminalPairedHalogenContactAuditCanReplace(candidateAudit, baseAudit) {
  if (!finalAuditCountsDoNotWorsen(candidateAudit, baseAudit)) {
    return false;
  }
  return (
    (candidateAudit.severeOverlapCount ?? 0) < (baseAudit.severeOverlapCount ?? 0) ||
    ((candidateAudit.severeOverlapCount ?? 0) === (baseAudit.severeOverlapCount ?? 0) &&
      (candidateAudit.severeOverlapPenalty ?? 0) < (baseAudit.severeOverlapPenalty ?? 0) - PRESENTATION_METRIC_EPSILON)
  );
}

function compareFinalTerminalPairedHalogenContactCandidates(candidate, incumbent) {
  if (!incumbent) {
    return -1;
  }
  for (const key of ['severeOverlapCount', 'visibleHeavyBondCrossingCount', 'bondLengthFailureCount', 'labelOverlapCount', 'ringSubstituentReadabilityFailureCount']) {
    if ((candidate.audit[key] ?? 0) !== (incumbent.audit[key] ?? 0)) {
      return (candidate.audit[key] ?? 0) - (incumbent.audit[key] ?? 0);
    }
  }
  if (Math.abs((candidate.audit.severeOverlapPenalty ?? 0) - (incumbent.audit.severeOverlapPenalty ?? 0)) > PRESENTATION_METRIC_EPSILON) {
    return (candidate.audit.severeOverlapPenalty ?? 0) - (incumbent.audit.severeOverlapPenalty ?? 0);
  }
  if (Math.abs(candidate.totalMove - incumbent.totalMove) > PRESENTATION_METRIC_EPSILON) {
    return candidate.totalMove - incumbent.totalMove;
  }
  if (Math.abs(candidate.rotationMagnitude - incumbent.rotationMagnitude) > PRESENTATION_METRIC_EPSILON) {
    return candidate.rotationMagnitude - incumbent.rotationMagnitude;
  }
  return candidate.key.localeCompare(incumbent.key, 'en', { numeric: true });
}

function maybeRetouchFinalTerminalPairedHalogenLeafSevereContacts(layoutGraph, finalCoords, placement, bondLength, options = {}) {
  let currentCoords = finalCoords;
  let baseAudit = auditLayout(layoutGraph, currentCoords, {
    bondLength,
    bondValidationClasses: placement.bondValidationClasses
  });
  if ((baseAudit.severeOverlapCount ?? 0) === 0) {
    return { coords: finalCoords, changed: false, movedAtomIds: [], audit: baseAudit };
  }

  const movedAtomIds = new Set();
  let changed = false;
  for (let passIndex = 0; passIndex < FINAL_TERMINAL_PAIRED_HALOGEN_CONTACT_MAX_PASSES; passIndex++) {
    const descriptors = finalTerminalPairedHalogenContactDescriptors(layoutGraph, currentCoords, bondLength, options);
    if (descriptors.length === 0) {
      break;
    }

    let bestCandidate = null;
    for (const descriptor of descriptors) {
      const movedDescriptorAtomIds = [...new Set([...descriptor.primary.movedAtomIds, ...descriptor.helper.movedAtomIds])];
      for (const primaryRotationOffset of FINAL_TERMINAL_PAIRED_HALOGEN_CONTACT_ROTATIONS) {
        for (const helperRotationOffset of FINAL_TERMINAL_PAIRED_HALOGEN_CONTACT_ROTATIONS) {
          const candidateCoords = rotateFinalTerminalPairedHalogenContactCandidate(currentCoords, descriptor, primaryRotationOffset, helperRotationOffset);
          if (!candidateCoords) {
            continue;
          }
          const candidateAudit = auditLayout(layoutGraph, candidateCoords, {
            bondLength,
            bondValidationClasses: placement.bondValidationClasses
          });
          if (!finalTerminalPairedHalogenContactAuditCanReplace(candidateAudit, baseAudit)) {
            continue;
          }
          const candidate = {
            coords: candidateCoords,
            audit: candidateAudit,
            key: `${descriptor.primary.anchorAtomId}:${descriptor.primary.leafAtomId}:${descriptor.helper.anchorAtomId}:${descriptor.helper.leafAtomId}`,
            movedAtomIds: movedDescriptorAtomIds,
            rotationMagnitude: Math.abs(primaryRotationOffset) + Math.abs(helperRotationOffset),
            totalMove: finalTerminalCarbonLeafContactCandidateMove(currentCoords, candidateCoords, movedDescriptorAtomIds)
          };
          if (compareFinalTerminalPairedHalogenContactCandidates(candidate, bestCandidate) < 0) {
            bestCandidate = candidate;
          }
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
    if ((baseAudit.severeOverlapCount ?? 0) === 0) {
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

function finalTerminalMultipleBondLeafCenterDescriptor(layoutGraph, coords, leafAtomId) {
  const leafAtom = layoutGraph.atoms.get(leafAtomId);
  if (!leafAtom || leafAtom.element === 'H' || leafAtom.aromatic || leafAtom.heavyDegree !== 1 || layoutGraph.ringAtomIdSet.has(leafAtomId) || !coords.has(leafAtomId)) {
    return null;
  }
  const centerBonds = (layoutGraph.bondsByAtomId.get(leafAtomId) ?? []).filter(bond => {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || bond.inRing || (bond.order ?? 1) <= 1) {
      return false;
    }
    const centerAtomId = bond.a === leafAtomId ? bond.b : bond.a;
    const centerAtom = layoutGraph.atoms.get(centerAtomId);
    return centerAtom && centerAtom.element !== 'H' && !centerAtom.aromatic && !layoutGraph.ringAtomIdSet.has(centerAtomId) && coords.has(centerAtomId);
  });
  if (centerBonds.length !== 1) {
    return null;
  }
  const centerAtomId = centerBonds[0].a === leafAtomId ? centerBonds[0].b : centerBonds[0].a;
  return { leafAtomId, centerAtomId };
}

/**
 * Describes terminal single-bond hetero leaves attached to an acyclic
 * multiple-bond center, such as crowded bridged oxime `C=N-O` branches.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} leafAtomId - Candidate terminal hetero leaf.
 * @param {string} blockerAtomId - Overlapping atom that must not move with the branch.
 * @returns {object|null} Branch descriptor, or null when the contact is outside this retouch class.
 */
function finalTerminalSingleHeteroMultipleBondBranchContactDescriptor(layoutGraph, coords, leafAtomId, blockerAtomId) {
  const leafAtom = layoutGraph.atoms.get(leafAtomId);
  if (
    !leafAtom ||
    !FINAL_TERMINAL_SINGLE_HETERO_MULTIPLE_BOND_LEAF_ELEMENTS.has(leafAtom.element) ||
    leafAtom.aromatic ||
    leafAtom.heavyDegree !== 1 ||
    layoutGraph.ringAtomIdSet.has(leafAtomId) ||
    !coords.has(leafAtomId)
  ) {
    return null;
  }

  const singleCenterBonds = (layoutGraph.bondsByAtomId.get(leafAtomId) ?? []).filter(bond => {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || bond.inRing || (bond.order ?? 1) !== 1) {
      return false;
    }
    const centerAtomId = bond.a === leafAtomId ? bond.b : bond.a;
    const centerAtom = layoutGraph.atoms.get(centerAtomId);
    return centerAtom && centerAtom.element !== 'H' && !centerAtom.aromatic && !layoutGraph.ringAtomIdSet.has(centerAtomId) && coords.has(centerAtomId);
  });
  if (singleCenterBonds.length !== 1) {
    return null;
  }

  const centerAtomId = singleCenterBonds[0].a === leafAtomId ? singleCenterBonds[0].b : singleCenterBonds[0].a;
  const multiplePivotBonds = (layoutGraph.bondsByAtomId.get(centerAtomId) ?? []).filter(bond => {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || bond.inRing || (bond.order ?? 1) <= 1) {
      return false;
    }
    const pivotAtomId = bond.a === centerAtomId ? bond.b : bond.a;
    const pivotAtom = layoutGraph.atoms.get(pivotAtomId);
    return pivotAtom && pivotAtom.element !== 'H' && coords.has(pivotAtomId);
  });
  if (multiplePivotBonds.length !== 1) {
    return null;
  }

  const pivotAtomId = multiplePivotBonds[0].a === centerAtomId ? multiplePivotBonds[0].b : multiplePivotBonds[0].a;
  const movedAtomIds = collectFinalTerminalCarbonLeafSubtreeAtomIds(layoutGraph, centerAtomId, pivotAtomId, coords);
  if (!movedAtomIds.includes(leafAtomId) || (blockerAtomId && movedAtomIds.includes(blockerAtomId))) {
    return null;
  }
  const movedHeavyAtomIds = movedAtomIds.filter(atomId => layoutGraph.atoms.get(atomId)?.element !== 'H');
  if (movedHeavyAtomIds.length < 2 || movedHeavyAtomIds.length > FINAL_TERMINAL_MULTIPLE_BOND_BRANCH_CONTACT_MAX_MOVED_HEAVY_ATOMS) {
    return null;
  }

  const leafSubtreeAtomIds = [...collectCutSubtree(layoutGraph, leafAtomId, centerAtomId)].filter(atomId => coords.has(atomId));
  if (!leafSubtreeAtomIds.includes(leafAtomId)) {
    return null;
  }

  return {
    kind: 'terminal-single-hetero-multiple-bond-branch',
    leafAtomId,
    centerAtomId,
    pivotAtomId,
    movedAtomIds,
    movedHeavyAtomCount: movedHeavyAtomIds.length,
    leafSubtreeAtomIds
  };
}

function finalTerminalMultipleBondBranchContactDescriptor(layoutGraph, coords, leafAtomId, blockerAtomId) {
  const leafDescriptor = finalTerminalMultipleBondLeafCenterDescriptor(layoutGraph, coords, leafAtomId);
  if (!leafDescriptor) {
    return finalTerminalSingleHeteroMultipleBondBranchContactDescriptor(layoutGraph, coords, leafAtomId, blockerAtomId);
  }

  let bestDescriptor = null;
  for (const bond of layoutGraph.bondsByAtomId.get(leafDescriptor.centerAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || bond.inRing || (bond.order ?? 1) !== 1) {
      continue;
    }
    const pivotAtomId = bond.a === leafDescriptor.centerAtomId ? bond.b : bond.a;
    const pivotAtom = layoutGraph.atoms.get(pivotAtomId);
    if (!pivotAtom || pivotAtom.element === 'H' || !coords.has(pivotAtomId)) {
      continue;
    }

    const movedAtomIds = collectFinalTerminalCarbonLeafSubtreeAtomIds(layoutGraph, leafDescriptor.centerAtomId, pivotAtomId, coords);
    if (!movedAtomIds.includes(leafAtomId) || (blockerAtomId && movedAtomIds.includes(blockerAtomId))) {
      continue;
    }
    const movedHeavyAtomIds = movedAtomIds.filter(atomId => layoutGraph.atoms.get(atomId)?.element !== 'H');
    if (movedHeavyAtomIds.length < 2 || movedHeavyAtomIds.length > FINAL_TERMINAL_MULTIPLE_BOND_BRANCH_CONTACT_MAX_MOVED_HEAVY_ATOMS) {
      continue;
    }
    const visibleHeavyAtomCount = [...coords.keys()].filter(atomId => {
      const atom = layoutGraph.atoms.get(atomId);
      return atom && atom.element !== 'H' && atom.visible !== false;
    }).length;
    if (movedHeavyAtomIds.length >= visibleHeavyAtomCount - 1) {
      continue;
    }

    const descriptor = {
      kind: 'terminal-multiple-bond-leaf',
      leafAtomId,
      centerAtomId: leafDescriptor.centerAtomId,
      pivotAtomId,
      movedAtomIds,
      movedHeavyAtomCount: movedHeavyAtomIds.length
    };
    if (!bestDescriptor || descriptor.movedHeavyAtomCount < bestDescriptor.movedHeavyAtomCount) {
      bestDescriptor = descriptor;
    }
  }
  return bestDescriptor;
}

function terminalSingleHeteroMultipleBondBranchLeafIdsForCenter(layoutGraph, coords, centerAtomId) {
  const centerAtom = layoutGraph.atoms.get(centerAtomId);
  if (!centerAtom || centerAtom.element === 'H' || centerAtom.aromatic || layoutGraph.ringAtomIdSet.has(centerAtomId) || !coords.has(centerAtomId)) {
    return [];
  }
  const hasMultiplePivotBond = (layoutGraph.bondsByAtomId.get(centerAtomId) ?? []).some(bond => {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || bond.inRing || (bond.order ?? 1) <= 1) {
      return false;
    }
    const pivotAtomId = bond.a === centerAtomId ? bond.b : bond.a;
    const pivotAtom = layoutGraph.atoms.get(pivotAtomId);
    return pivotAtom && pivotAtom.element !== 'H' && coords.has(pivotAtomId);
  });
  if (!hasMultiplePivotBond) {
    return [];
  }
  return (layoutGraph.bondsByAtomId.get(centerAtomId) ?? []).flatMap(bond => {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || bond.inRing || (bond.order ?? 1) !== 1) {
      return [];
    }
    const leafAtomId = bond.a === centerAtomId ? bond.b : bond.a;
    const leafAtom = layoutGraph.atoms.get(leafAtomId);
    if (
      !leafAtom ||
      !FINAL_TERMINAL_SINGLE_HETERO_MULTIPLE_BOND_LEAF_ELEMENTS.has(leafAtom.element) ||
      leafAtom.aromatic ||
      leafAtom.heavyDegree !== 1 ||
      layoutGraph.ringAtomIdSet.has(leafAtomId) ||
      !coords.has(leafAtomId)
    ) {
      return [];
    }
    return [leafAtomId];
  });
}

/**
 * Appends branch-level terminal multiple-bond retouch descriptors for one
 * contact or crossing pair while sharing the descriptor de-duplication cap.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} leafAtomId - Candidate terminal leaf or center atom.
 * @param {string} blockerAtomId - Opposing atom that the branch move must leave fixed.
 * @param {Array<object>} descriptors - Mutable descriptor accumulator.
 * @param {Set<string>} seen - Mutable descriptor identity set.
 * @returns {boolean} True when descriptor collection reached its cap.
 */
function appendFinalTerminalMultipleBondBranchContactDescriptors(layoutGraph, coords, leafAtomId, blockerAtomId, descriptors, seen) {
  const contactDescriptors = [
    finalTerminalMultipleBondBranchContactDescriptor(layoutGraph, coords, leafAtomId, blockerAtomId),
    ...terminalSingleHeteroMultipleBondBranchLeafIdsForCenter(layoutGraph, coords, leafAtomId).map(terminalLeafAtomId =>
      finalTerminalMultipleBondBranchContactDescriptor(layoutGraph, coords, terminalLeafAtomId, blockerAtomId)
    )
  ].filter(Boolean);
  for (const descriptor of contactDescriptors) {
    const key = `${descriptor.pivotAtomId}:${descriptor.centerAtomId}:${descriptor.leafAtomId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    descriptors.push(descriptor);
    if (descriptors.length >= FINAL_TERMINAL_MULTIPLE_BOND_BRANCH_CONTACT_MAX_DESCRIPTORS) {
      return true;
    }
  }
  return false;
}

function finalTerminalMultipleBondBranchContactDescriptors(layoutGraph, coords, bondLength) {
  const heavyAtomCount = layoutGraph.traits?.heavyAtomCount ?? layoutGraph.atoms?.size ?? 0;
  if (heavyAtomCount > FINAL_TERMINAL_MULTIPLE_BOND_BRANCH_CONTACT_MAX_LAYOUT_HEAVY_ATOMS) {
    return [];
  }

  const descriptors = [];
  const seen = new Set();
  for (const overlap of findSevereOverlaps(layoutGraph, coords, bondLength)) {
    for (const [leafAtomId, blockerAtomId] of [
      [overlap.firstAtomId, overlap.secondAtomId],
      [overlap.secondAtomId, overlap.firstAtomId]
    ]) {
      if (appendFinalTerminalMultipleBondBranchContactDescriptors(layoutGraph, coords, leafAtomId, blockerAtomId, descriptors, seen)) {
        return descriptors;
      }
    }
  }
  for (const crossing of findVisibleHeavyBondCrossings(layoutGraph, coords)) {
    for (const [leafAtomIds, blockerAtomIds] of [
      [crossing.firstAtomIds ?? [], crossing.secondAtomIds ?? []],
      [crossing.secondAtomIds ?? [], crossing.firstAtomIds ?? []]
    ]) {
      for (const leafAtomId of leafAtomIds) {
        for (const blockerAtomId of blockerAtomIds) {
          if (appendFinalTerminalMultipleBondBranchContactDescriptors(layoutGraph, coords, leafAtomId, blockerAtomId, descriptors, seen)) {
            return descriptors;
          }
        }
      }
    }
  }
  return descriptors;
}

function rotateFinalTerminalMultipleBondBranchContactCandidate(coords, descriptor, rotationOffset, leafRotationOffset = 0) {
  const pivotPosition = coords.get(descriptor.pivotAtomId);
  if (!pivotPosition) {
    return null;
  }
  const candidateCoords = cloneCoords(coords);
  for (const atomId of descriptor.movedAtomIds) {
    const position = coords.get(atomId);
    if (position) {
      candidateCoords.set(atomId, rotateAround(position, pivotPosition, rotationOffset));
    }
  }
  if ((descriptor.leafSubtreeAtomIds?.length ?? 0) > 0 && Math.abs(leafRotationOffset) > PRESENTATION_METRIC_EPSILON) {
    const centerPosition = candidateCoords.get(descriptor.centerAtomId);
    if (!centerPosition) {
      return null;
    }
    for (const atomId of descriptor.leafSubtreeAtomIds) {
      const position = candidateCoords.get(atomId);
      if (position) {
        candidateCoords.set(atomId, rotateAround(position, centerPosition, leafRotationOffset));
      }
    }
  }
  return candidateCoords;
}

/**
 * Scores the retained trigonal fan at single-hetero multiple-bond branch centers.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinate map.
 * @param {object} descriptor - Final branch-contact descriptor.
 * @returns {number} Absolute deviation from the 120-degree center fan.
 */
function finalTerminalSingleHeteroMultipleBondBranchAnglePenalty(coords, descriptor) {
  if (descriptor.kind !== 'terminal-single-hetero-multiple-bond-branch') {
    return 0;
  }
  const pivotPosition = coords.get(descriptor.pivotAtomId);
  const centerPosition = coords.get(descriptor.centerAtomId);
  const leafPosition = coords.get(descriptor.leafAtomId);
  if (!pivotPosition || !centerPosition || !leafPosition) {
    return Number.POSITIVE_INFINITY;
  }
  const angleAtCenter = angularDifference(angleOf(sub(pivotPosition, centerPosition)), angleOf(sub(leafPosition, centerPosition)));
  return Math.abs(angleAtCenter - EXACT_TRIGONAL_CONTINUATION_ANGLE);
}

function finalTerminalMultipleBondBranchContactAuditCanReplace(candidateAudit, baseAudit, candidateFanPenalty, baseFanPenalty) {
  if (!finalAuditCountsDoNotWorsen(candidateAudit, baseAudit)) {
    return false;
  }
  if ((candidateFanPenalty.maxDeviation ?? 0) > (baseFanPenalty.maxDeviation ?? 0) + FINAL_TERMINAL_MULTIPLE_BOND_BRANCH_FAN_SLACK) {
    return false;
  }
  if ((candidateFanPenalty.totalDeviation ?? 0) > (baseFanPenalty.totalDeviation ?? 0) + FINAL_TERMINAL_MULTIPLE_BOND_BRANCH_FAN_SLACK) {
    return false;
  }
  return (
    (candidateAudit.visibleHeavyBondCrossingCount ?? 0) < (baseAudit.visibleHeavyBondCrossingCount ?? 0) ||
    (candidateAudit.severeOverlapCount ?? 0) < (baseAudit.severeOverlapCount ?? 0) ||
    ((candidateAudit.severeOverlapCount ?? 0) === (baseAudit.severeOverlapCount ?? 0) &&
      (candidateAudit.severeOverlapPenalty ?? 0) < (baseAudit.severeOverlapPenalty ?? 0) - PRESENTATION_METRIC_EPSILON)
  );
}

function compareFinalTerminalMultipleBondBranchContactCandidates(candidate, incumbent) {
  if (!incumbent) {
    return -1;
  }
  for (const key of ['severeOverlapCount', 'visibleHeavyBondCrossingCount', 'bondLengthFailureCount', 'labelOverlapCount', 'ringSubstituentReadabilityFailureCount']) {
    if ((candidate.audit[key] ?? 0) !== (incumbent.audit[key] ?? 0)) {
      return (candidate.audit[key] ?? 0) - (incumbent.audit[key] ?? 0);
    }
  }
  if (Math.abs((candidate.audit.severeOverlapPenalty ?? 0) - (incumbent.audit.severeOverlapPenalty ?? 0)) > PRESENTATION_METRIC_EPSILON) {
    return (candidate.audit.severeOverlapPenalty ?? 0) - (incumbent.audit.severeOverlapPenalty ?? 0);
  }
  if (candidate.movedHeavyAtomCount !== incumbent.movedHeavyAtomCount) {
    return candidate.movedHeavyAtomCount - incumbent.movedHeavyAtomCount;
  }
  if (Math.abs((candidate.anglePenalty ?? 0) - (incumbent.anglePenalty ?? 0)) > PRESENTATION_METRIC_EPSILON) {
    return (candidate.anglePenalty ?? 0) - (incumbent.anglePenalty ?? 0);
  }
  if (Math.abs(candidate.totalMove - incumbent.totalMove) > PRESENTATION_METRIC_EPSILON) {
    return candidate.totalMove - incumbent.totalMove;
  }
  if (Math.abs(candidate.rotationMagnitude - incumbent.rotationMagnitude) > PRESENTATION_METRIC_EPSILON) {
    return candidate.rotationMagnitude - incumbent.rotationMagnitude;
  }
  return candidate.key.localeCompare(incumbent.key, 'en', { numeric: true });
}

function maybeRetouchFinalTerminalMultipleBondBranchSevereContacts(layoutGraph, finalCoords, placement, bondLength) {
  let currentCoords = finalCoords;
  let baseAudit = auditLayout(layoutGraph, currentCoords, {
    bondLength,
    bondValidationClasses: placement.bondValidationClasses
  });
  if ((baseAudit.severeOverlapCount ?? 0) === 0 && (baseAudit.visibleHeavyBondCrossingCount ?? 0) === 0) {
    return { coords: finalCoords, changed: false, movedAtomIds: [], audit: baseAudit };
  }

  const movedAtomIds = new Set();
  let changed = false;
  for (let passIndex = 0; passIndex < FINAL_TERMINAL_MULTIPLE_BOND_BRANCH_CONTACT_MAX_PASSES; passIndex++) {
    const descriptors = finalTerminalMultipleBondBranchContactDescriptors(layoutGraph, currentCoords, bondLength);
    if (descriptors.length === 0) {
      break;
    }
    const baseFanPenalty = measureTerminalMultipleBondLeafFanPenalty(layoutGraph, currentCoords);
    let bestCandidate = null;
    for (const descriptor of descriptors) {
      const rootRotationOffsets =
        descriptor.kind === 'terminal-single-hetero-multiple-bond-branch' ? FINAL_TERMINAL_SINGLE_HETERO_MULTIPLE_BOND_BRANCH_ROOT_ROTATIONS : FINAL_TERMINAL_MULTIPLE_BOND_BRANCH_CONTACT_ROTATIONS;
      const leafRotationOffsets = descriptor.kind === 'terminal-single-hetero-multiple-bond-branch' ? FINAL_TERMINAL_SINGLE_HETERO_MULTIPLE_BOND_BRANCH_LEAF_ROTATIONS : [0];
      for (const rotationOffset of rootRotationOffsets) {
        for (const leafRotationOffset of leafRotationOffsets) {
          const candidateCoords = rotateFinalTerminalMultipleBondBranchContactCandidate(currentCoords, descriptor, rotationOffset, leafRotationOffset);
          if (!candidateCoords) {
            continue;
          }
          const candidateAudit = auditLayout(layoutGraph, candidateCoords, {
            bondLength,
            bondValidationClasses: placement.bondValidationClasses
          });
          const candidateFanPenalty = measureTerminalMultipleBondLeafFanPenalty(layoutGraph, candidateCoords);
          if (!finalTerminalMultipleBondBranchContactAuditCanReplace(candidateAudit, baseAudit, candidateFanPenalty, baseFanPenalty)) {
            continue;
          }
          const candidate = {
            coords: candidateCoords,
            audit: candidateAudit,
            key: `${descriptor.pivotAtomId}:${descriptor.centerAtomId}:${descriptor.leafAtomId}:${rotationOffset}:${leafRotationOffset}`,
            movedAtomIds: descriptor.movedAtomIds,
            movedHeavyAtomCount: descriptor.movedHeavyAtomCount,
            anglePenalty: finalTerminalSingleHeteroMultipleBondBranchAnglePenalty(candidateCoords, descriptor),
            rotationMagnitude: Math.abs(rotationOffset) + Math.abs(leafRotationOffset),
            totalMove: finalTerminalCarbonLeafContactCandidateMove(currentCoords, candidateCoords, descriptor.movedAtomIds)
          };
          if (compareFinalTerminalMultipleBondBranchContactCandidates(candidate, bestCandidate) < 0) {
            bestCandidate = candidate;
          }
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
    if ((baseAudit.severeOverlapCount ?? 0) === 0 && (baseAudit.visibleHeavyBondCrossingCount ?? 0) === 0) {
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

function maybeRetouchFinalAcyclicBranchSevereContacts(layoutGraph, finalCoords, placement, bondLength, options = {}) {
  let currentCoords = finalCoords;
  let baseAudit = auditLayout(layoutGraph, currentCoords, {
    bondLength,
    bondValidationClasses: placement.bondValidationClasses
  });
  if ((baseAudit.severeOverlapCount ?? 0) === 0) {
    return { coords: finalCoords, changed: false, movedAtomIds: [], audit: baseAudit };
  }

  const movedAtomIds = new Set();
  let changed = false;
  const maxPasses = options.maxPasses ?? FINAL_ACYCLIC_BRANCH_CONTACT_MAX_PASSES;
  for (let passIndex = 0; passIndex < maxPasses; passIndex++) {
    const descriptors = finalAcyclicBranchContactDescriptors(layoutGraph, currentCoords, bondLength, options);
    if (descriptors.length === 0) {
      break;
    }

    let bestCandidate = null;
    for (const descriptor of descriptors) {
      const canArticulateTerminalLeaf =
        (descriptor.terminalLeafSubtreeAtomIds?.length ?? 0) > 0 &&
        (baseAudit.bondLengthFailureCount ?? 0) === 0 &&
        (baseAudit.labelOverlapCount ?? 0) === 0 &&
        (baseAudit.visibleHeavyBondCrossingCount ?? 0) === 0;
      const rootRotationOffsets = canArticulateTerminalLeaf
        ? [...FINAL_ACYCLIC_BRANCH_CONTACT_ROTATIONS, ...FINAL_ACYCLIC_BRANCH_TERMINAL_LEAF_ROOT_ROTATIONS]
        : FINAL_ACYCLIC_BRANCH_CONTACT_ROTATIONS;
      const leafRotationOffsets = canArticulateTerminalLeaf ? FINAL_ACYCLIC_BRANCH_TERMINAL_LEAF_ROTATIONS : [0];
      for (const rotationOffset of rootRotationOffsets) {
        for (const leafRotationOffset of leafRotationOffsets) {
          const candidateCoords = rotateFinalAcyclicBranchContactCandidate(currentCoords, descriptor, rotationOffset, leafRotationOffset);
          if (!candidateCoords) {
            continue;
          }
          const candidateAudit = auditLayout(layoutGraph, candidateCoords, {
            bondLength,
            bondValidationClasses: placement.bondValidationClasses
          });
          if (!finalAcyclicBranchContactAuditCanReplace(candidateAudit, baseAudit, options)) {
            continue;
          }
          const candidate = {
            coords: candidateCoords,
            audit: candidateAudit,
            anchorAtomId: descriptor.anchorAtomId,
            rootAtomId: descriptor.rootAtomId,
            movedAtomIds: descriptor.movedAtomIds,
            movedHeavyAtomCount: descriptor.movedHeavyAtomIds.length,
            rotationMagnitude: Math.abs(rotationOffset) + Math.abs(leafRotationOffset),
            totalMove: finalAcyclicBranchContactCandidateMove(currentCoords, candidateCoords, descriptor.movedAtomIds)
          };
          if (compareFinalAcyclicBranchContactCandidates(candidate, bestCandidate) < 0) {
            bestCandidate = candidate;
          }
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
    if ((baseAudit.severeOverlapCount ?? 0) === 0) {
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

function finalCompactBridgedHydroxySidechainLeafSubtree(layoutGraph, coords, descriptor) {
  const rootAtom = layoutGraph.atoms.get(descriptor.rootAtomId);
  const anchorAtom = layoutGraph.atoms.get(descriptor.anchorAtomId);
  if (
    !rootAtom ||
    !anchorAtom ||
    rootAtom.element !== 'C' ||
    rootAtom.aromatic ||
    layoutGraph.ringAtomIdSet.has(descriptor.rootAtomId) ||
    !layoutGraph.ringAtomIdSet.has(descriptor.anchorAtomId) ||
    (rootAtom.heavyDegree ?? 0) < 3 ||
    (rootAtom.heavyDegree ?? 0) > 4
  ) {
    return [];
  }

  const movedAtomIdSet = new Set(descriptor.movedAtomIds);
  for (const bond of layoutGraph.bondsByAtomId.get(descriptor.rootAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || bond.inRing || (bond.order ?? 1) !== 1) {
      continue;
    }
    const leafAtomId = bond.a === descriptor.rootAtomId ? bond.b : bond.a;
    if (leafAtomId === descriptor.anchorAtomId || !coords.has(leafAtomId) || !movedAtomIdSet.has(leafAtomId)) {
      continue;
    }
    const leafAtom = layoutGraph.atoms.get(leafAtomId);
    if (!leafAtom || leafAtom.element !== 'O' || leafAtom.aromatic || layoutGraph.ringAtomIdSet.has(leafAtomId) || (leafAtom.heavyDegree ?? 0) !== 1) {
      continue;
    }
    const leafSubtreeAtomIds = [...collectCutSubtree(layoutGraph, leafAtomId, descriptor.rootAtomId)].filter(atomId => coords.has(atomId) && movedAtomIdSet.has(atomId));
    const leafHeavyAtomIds = leafSubtreeAtomIds.filter(atomId => layoutGraph.atoms.get(atomId)?.element !== 'H');
    if (leafHeavyAtomIds.length === 1 && leafHeavyAtomIds[0] === leafAtomId) {
      return leafSubtreeAtomIds;
    }
  }
  return [];
}

function finalCompactBridgedHydroxySidechainDescriptorTouchesOverlap(layoutGraph, descriptor, leafSubtreeAtomIds, overlaps) {
  const leafAtomIdSet = new Set(leafSubtreeAtomIds);
  return overlaps.some(overlap => {
    const firstIsMovedRoot = overlap.firstAtomId === descriptor.rootAtomId || leafAtomIdSet.has(overlap.firstAtomId);
    const secondIsMovedRoot = overlap.secondAtomId === descriptor.rootAtomId || leafAtomIdSet.has(overlap.secondAtomId);
    const firstIsRing = layoutGraph.ringAtomIdSet.has(overlap.firstAtomId);
    const secondIsRing = layoutGraph.ringAtomIdSet.has(overlap.secondAtomId);
    return (firstIsMovedRoot && secondIsRing) || (secondIsMovedRoot && firstIsRing);
  });
}

function finalCompactBridgedHydroxySidechainDescriptor(layoutGraph, coords, descriptor, overlaps) {
  const movedHeavyAtomIds = descriptor.movedHeavyAtomIds ?? [];
  if (movedHeavyAtomIds.length < 2 || movedHeavyAtomIds.length > FINAL_COMPACT_BRIDGED_HYDROXY_SIDECHAIN_MAX_MOVED_HEAVY_ATOMS) {
    return null;
  }
  const leafSubtreeAtomIds = finalCompactBridgedHydroxySidechainLeafSubtree(layoutGraph, coords, descriptor);
  if (leafSubtreeAtomIds.length === 0 || !finalCompactBridgedHydroxySidechainDescriptorTouchesOverlap(layoutGraph, descriptor, leafSubtreeAtomIds, overlaps)) {
    return null;
  }
  return {
    ...descriptor,
    terminalLeafSubtreeAtomIds: leafSubtreeAtomIds
  };
}

function finalCompactBridgedHydroxySidechainAuditCanReplace(candidateAudit, baseAudit) {
  if (candidateAudit?.ok !== true || candidateAudit.fallback?.mode != null) {
    return false;
  }
  if ((candidateAudit.visibleHeavyBondCrossingCount ?? 0) > (baseAudit.visibleHeavyBondCrossingCount ?? 0) + FINAL_COMPACT_BRIDGED_HYDROXY_SIDECHAIN_MAX_VISIBLE_CROSSING_INCREASE) {
    return false;
  }
  if ((candidateAudit.maxBondLengthDeviation ?? 0) > (baseAudit.maxBondLengthDeviation ?? 0) + PRESENTATION_METRIC_EPSILON) {
    return false;
  }
  return true;
}

function compareFinalCompactBridgedHydroxySidechainCandidates(candidate, incumbent) {
  if (!incumbent) {
    return -1;
  }
  for (const key of ['severeOverlapCount', 'labelOverlapCount', 'bondLengthFailureCount', 'ringSubstituentReadabilityFailureCount', 'visibleHeavyBondCrossingCount']) {
    if ((candidate.audit[key] ?? 0) !== (incumbent.audit[key] ?? 0)) {
      return (candidate.audit[key] ?? 0) - (incumbent.audit[key] ?? 0);
    }
  }
  if (Math.abs((candidate.audit.maxBondLengthDeviation ?? 0) - (incumbent.audit.maxBondLengthDeviation ?? 0)) > PRESENTATION_METRIC_EPSILON) {
    return (candidate.audit.maxBondLengthDeviation ?? 0) - (incumbent.audit.maxBondLengthDeviation ?? 0);
  }
  if (Math.abs(candidate.totalMove - incumbent.totalMove) > PRESENTATION_METRIC_EPSILON) {
    return candidate.totalMove - incumbent.totalMove;
  }
  if (Math.abs(candidate.rotationMagnitude - incumbent.rotationMagnitude) > PRESENTATION_METRIC_EPSILON) {
    return candidate.rotationMagnitude - incumbent.rotationMagnitude;
  }
  return candidate.key.localeCompare(incumbent.key, 'en', { numeric: true });
}

function maybeRetouchFinalCompactBridgedHydroxySidechainContacts(layoutGraph, finalCoords, placement, bondLength) {
  const baseAudit = auditLayout(layoutGraph, finalCoords, {
    bondLength,
    bondValidationClasses: placement.bondValidationClasses
  });
  const heavyAtomCount = layoutGraph.traits?.heavyAtomCount ?? [...layoutGraph.atoms.values()].filter(atom => atom.element !== 'H').length;
  if (
    heavyAtomCount > FINAL_COMPACT_BRIDGED_HYDROXY_SIDECHAIN_MAX_HEAVY_ATOMS ||
    (layoutGraph.traits?.bridgedRingConnectionCount ?? 0) <= 0 ||
    (baseAudit.severeOverlapCount ?? 0) === 0 ||
    (baseAudit.bondLengthFailureCount ?? 0) > 0 ||
    (baseAudit.labelOverlapCount ?? 0) > 0 ||
    (baseAudit.ringSubstituentReadabilityFailureCount ?? 0) > 0 ||
    (baseAudit.collapsedMacrocycleCount ?? 0) > 0 ||
    (baseAudit.stereoContradiction ?? false)
  ) {
    return { coords: finalCoords, changed: false, movedAtomIds: [], audit: baseAudit };
  }

  const overlaps = findSevereOverlaps(layoutGraph, finalCoords, bondLength);
  const descriptors = finalAcyclicBranchContactDescriptors(layoutGraph, finalCoords, bondLength, {
    maxMovedHeavyAtoms: FINAL_COMPACT_BRIDGED_HYDROXY_SIDECHAIN_MAX_MOVED_HEAVY_ATOMS
  })
    .map(descriptor => finalCompactBridgedHydroxySidechainDescriptor(layoutGraph, finalCoords, descriptor, overlaps))
    .filter(Boolean);
  if (descriptors.length === 0) {
    return { coords: finalCoords, changed: false, movedAtomIds: [], audit: baseAudit };
  }

  let bestCandidate = null;
  for (const descriptor of descriptors) {
    for (const rootRotationOffset of FINAL_ACYCLIC_BRANCH_CONTACT_ROTATIONS) {
      for (const leafRotationOffset of FINAL_ACYCLIC_BRANCH_TERMINAL_LEAF_ROTATIONS) {
        const candidateCoords = rotateFinalAcyclicBranchContactCandidate(finalCoords, descriptor, rootRotationOffset, leafRotationOffset);
        if (!candidateCoords) {
          continue;
        }
        const candidateAudit = auditLayout(layoutGraph, candidateCoords, {
          bondLength,
          bondValidationClasses: placement.bondValidationClasses
        });
        if (!finalCompactBridgedHydroxySidechainAuditCanReplace(candidateAudit, baseAudit)) {
          continue;
        }
        const candidate = {
          coords: candidateCoords,
          audit: candidateAudit,
          movedAtomIds: descriptor.movedAtomIds,
          key: `${descriptor.anchorAtomId}:${descriptor.rootAtomId}:${rootRotationOffset}:${leafRotationOffset}`,
          rotationMagnitude: Math.abs(rootRotationOffset) + Math.abs(leafRotationOffset),
          totalMove: finalAcyclicBranchContactCandidateMove(finalCoords, candidateCoords, descriptor.movedAtomIds)
        };
        if (compareFinalCompactBridgedHydroxySidechainCandidates(candidate, bestCandidate) < 0) {
          bestCandidate = candidate;
        }
      }
    }
  }

  if (!bestCandidate) {
    return { coords: finalCoords, changed: false, movedAtomIds: [], audit: baseAudit };
  }
  return {
    coords: bestCandidate.coords,
    changed: true,
    movedAtomIds: bestCandidate.movedAtomIds,
    audit: bestCandidate.audit
  };
}

function finalCompactBridgedOverlapBondRepairAttachedLeaves(layoutGraph, coords, atomId, blockedAtomIds) {
  const atomIds = new Set();
  for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
    if (blockedAtomIds.has(neighborAtomId) || layoutGraph.ringAtomIdSet.has(neighborAtomId)) {
      continue;
    }
    const subtreeAtomIds = [];
    const seen = new Set([...blockedAtomIds, atomId]);
    const stack = [neighborAtomId];
    while (stack.length > 0) {
      const subtreeAtomId = stack.pop();
      if (seen.has(subtreeAtomId)) {
        continue;
      }
      seen.add(subtreeAtomId);
      if (coords.has(subtreeAtomId)) {
        subtreeAtomIds.push(subtreeAtomId);
      }
      for (const subtreeBond of layoutGraph.bondsByAtomId.get(subtreeAtomId) ?? []) {
        if (!subtreeBond || subtreeBond.kind !== 'covalent') {
          continue;
        }
        const nextAtomId = subtreeBond.a === subtreeAtomId ? subtreeBond.b : subtreeBond.a;
        if (!seen.has(nextAtomId)) {
          stack.push(nextAtomId);
        }
      }
    }
    const subtreeHeavyAtomIds = subtreeAtomIds.filter(subtreeAtomId => layoutGraph.atoms.get(subtreeAtomId)?.element !== 'H');
    if (subtreeHeavyAtomIds.length <= 1) {
      for (const subtreeAtomId of subtreeAtomIds) {
        atomIds.add(subtreeAtomId);
      }
    }
  }
  return [...atomIds];
}

function finalCompactBridgedOverlapBondRepairMoveGroup(layoutGraph, coords, movedAtomId, blockerAtomId, sharedAtomId) {
  const movedAtomIds = new Set([movedAtomId, sharedAtomId]);
  for (const leafAtomId of finalCompactBridgedOverlapBondRepairAttachedLeaves(layoutGraph, coords, movedAtomId, new Set([blockerAtomId, sharedAtomId]))) {
    movedAtomIds.add(leafAtomId);
  }
  for (const leafAtomId of finalCompactBridgedOverlapBondRepairAttachedLeaves(layoutGraph, coords, sharedAtomId, new Set([blockerAtomId, movedAtomId]))) {
    movedAtomIds.add(leafAtomId);
  }
  const movedHeavyAtomIds = [...movedAtomIds].filter(atomId => layoutGraph.atoms.get(atomId)?.element !== 'H');
  if (movedHeavyAtomIds.length === 0 || movedHeavyAtomIds.length > FINAL_COMPACT_BRIDGED_OVERLAP_BOND_REPAIR_MAX_MOVED_HEAVY_ATOMS || movedAtomIds.has(blockerAtomId)) {
    return null;
  }
  return {
    atomIds: [...movedAtomIds],
    heavyAtomCount: movedHeavyAtomIds.length
  };
}

function finalCompactBridgedOverlapBondRepairSharedNeighborIds(layoutGraph, firstAtomId, secondAtomId) {
  const secondNeighborIds = new Set([...(layoutGraph.bondsByAtomId.get(secondAtomId) ?? [])].filter(bond => bond?.kind === 'covalent').map(bond => (bond.a === secondAtomId ? bond.b : bond.a)));
  return [...(layoutGraph.bondsByAtomId.get(firstAtomId) ?? [])]
    .filter(bond => bond?.kind === 'covalent')
    .map(bond => (bond.a === firstAtomId ? bond.b : bond.a))
    .filter(neighborAtomId => secondNeighborIds.has(neighborAtomId) && layoutGraph.ringAtomIdSet.has(neighborAtomId));
}

function finalCompactBridgedOverlapBondRepairReliefGroup(layoutGraph, coords, stretchedAtomId, fixedAtomId) {
  const atomIds = new Set([stretchedAtomId]);
  for (const bond of layoutGraph.bondsByAtomId.get(stretchedAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === stretchedAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (neighborAtom?.element === 'H' && coords.has(neighborAtomId)) {
      atomIds.add(neighborAtomId);
    }
  }
  if (atomIds.has(fixedAtomId)) {
    return [];
  }
  return [...atomIds].filter(atomId => coords.has(atomId));
}

function finalCompactBridgedOverlapBondRepairReliefDescriptors(layoutGraph, coords, movedAtomId, movedGroupAtomIds, bondLength) {
  const descriptors = [];
  const movedAtomIdSet = new Set(movedGroupAtomIds);
  for (const bond of layoutGraph.bondsByAtomId.get(movedAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const fixedAtomId = bond.a === movedAtomId ? bond.b : bond.a;
    if (movedAtomIdSet.has(fixedAtomId) || !layoutGraph.ringAtomIdSet.has(fixedAtomId) || !coords.has(fixedAtomId)) {
      continue;
    }
    for (const candidateBond of layoutGraph.bondsByAtomId.get(fixedAtomId) ?? []) {
      if (!candidateBond || candidateBond.kind !== 'covalent') {
        continue;
      }
      const stretchedAtomId = candidateBond.a === fixedAtomId ? candidateBond.b : candidateBond.a;
      if (stretchedAtomId === movedAtomId || movedAtomIdSet.has(stretchedAtomId) || !layoutGraph.ringAtomIdSet.has(stretchedAtomId) || !coords.has(stretchedAtomId)) {
        continue;
      }
      const fixedPosition = coords.get(fixedAtomId);
      const stretchedPosition = coords.get(stretchedAtomId);
      const currentDistance = Math.hypot(stretchedPosition.x - fixedPosition.x, stretchedPosition.y - fixedPosition.y);
      if (currentDistance <= bondLength * BRIDGED_VALIDATION.maxBondLengthFactor + PRESENTATION_METRIC_EPSILON) {
        continue;
      }
      const atomIds = finalCompactBridgedOverlapBondRepairReliefGroup(layoutGraph, coords, stretchedAtomId, fixedAtomId);
      if (atomIds.length > 0) {
        descriptors.push({
          fixedAtomId,
          stretchedAtomId,
          atomIds
        });
      }
    }
  }
  return descriptors;
}

function finalCompactBridgedOverlapBondRepairDescriptors(layoutGraph, coords, overlaps, bondLength) {
  const descriptors = [];
  const seen = new Set();
  for (const overlap of overlaps) {
    for (const [movedAtomId, blockerAtomId] of [
      [overlap.firstAtomId, overlap.secondAtomId],
      [overlap.secondAtomId, overlap.firstAtomId]
    ]) {
      const movedAtom = layoutGraph.atoms.get(movedAtomId);
      const blockerAtom = layoutGraph.atoms.get(blockerAtomId);
      if (
        !movedAtom ||
        !blockerAtom ||
        movedAtom.element === 'H' ||
        blockerAtom.element === 'H' ||
        !layoutGraph.ringAtomIdSet.has(movedAtomId) ||
        !layoutGraph.ringAtomIdSet.has(blockerAtomId) ||
        layoutGraph.bondByAtomPair.has(atomPairKey(movedAtomId, blockerAtomId)) ||
        layoutGraph.atomToRingSystemId.get(movedAtomId) !== layoutGraph.atomToRingSystemId.get(blockerAtomId)
      ) {
        continue;
      }
      for (const sharedAtomId of finalCompactBridgedOverlapBondRepairSharedNeighborIds(layoutGraph, movedAtomId, blockerAtomId)) {
        const moveGroup = finalCompactBridgedOverlapBondRepairMoveGroup(layoutGraph, coords, movedAtomId, blockerAtomId, sharedAtomId);
        if (!moveGroup) {
          continue;
        }
        const key = `${movedAtomId}:${blockerAtomId}:${sharedAtomId}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        descriptors.push({
          movedAtomId,
          blockerAtomId,
          sharedAtomId,
          movedAtomIds: moveGroup.atomIds,
          movedHeavyAtomCount: moveGroup.heavyAtomCount,
          reliefDescriptors: finalCompactBridgedOverlapBondRepairReliefDescriptors(layoutGraph, coords, movedAtomId, moveGroup.atomIds, bondLength)
        });
      }
    }
  }
  return descriptors;
}

function translateFinalCompactBridgedOverlapBondRepairAtoms(coords, atomIds, displacement) {
  const nextCoords = new Map(coords);
  for (const atomId of atomIds) {
    const position = nextCoords.get(atomId);
    if (position) {
      nextCoords.set(atomId, {
        x: position.x + displacement.x,
        y: position.y + displacement.y
      });
    }
  }
  return nextCoords;
}

function finalCompactBridgedOverlapBondRepairCandidate(coords, descriptor, spreadFactor, reliefDescriptor, reliefFactor, bondLength) {
  const movedPosition = coords.get(descriptor.movedAtomId);
  const blockerPosition = coords.get(descriptor.blockerAtomId);
  if (!movedPosition || !blockerPosition) {
    return null;
  }
  const dx = movedPosition.x - blockerPosition.x;
  const dy = movedPosition.y - blockerPosition.y;
  const length = Math.hypot(dx, dy);
  if (length <= PRESENTATION_METRIC_EPSILON) {
    return null;
  }
  let candidateCoords = translateFinalCompactBridgedOverlapBondRepairAtoms(coords, descriptor.movedAtomIds, {
    x: (dx / length) * bondLength * spreadFactor,
    y: (dy / length) * bondLength * spreadFactor
  });
  if (reliefDescriptor && reliefFactor > 0) {
    const fixedPosition = candidateCoords.get(reliefDescriptor.fixedAtomId);
    const stretchedPosition = candidateCoords.get(reliefDescriptor.stretchedAtomId);
    if (!fixedPosition || !stretchedPosition) {
      return null;
    }
    const reliefDx = fixedPosition.x - stretchedPosition.x;
    const reliefDy = fixedPosition.y - stretchedPosition.y;
    const reliefLength = Math.hypot(reliefDx, reliefDy);
    if (reliefLength <= PRESENTATION_METRIC_EPSILON) {
      return null;
    }
    candidateCoords = translateFinalCompactBridgedOverlapBondRepairAtoms(candidateCoords, reliefDescriptor.atomIds, {
      x: (reliefDx / reliefLength) * bondLength * reliefFactor,
      y: (reliefDy / reliefLength) * bondLength * reliefFactor
    });
  }
  return candidateCoords;
}

function finalCompactBridgedOverlapBondRepairAuditCanReplace(candidateAudit, baseAudit) {
  return (
    candidateAudit?.ok === true &&
    candidateAudit.fallback?.mode == null &&
    (candidateAudit.visibleHeavyBondCrossingCount ?? 0) <= (baseAudit.visibleHeavyBondCrossingCount ?? 0) &&
    (candidateAudit.labelOverlapCount ?? 0) <= (baseAudit.labelOverlapCount ?? 0) &&
    (candidateAudit.ringSubstituentReadabilityFailureCount ?? 0) <= (baseAudit.ringSubstituentReadabilityFailureCount ?? 0) &&
    (candidateAudit.maxBondLengthDeviation ?? 0) <= (baseAudit.maxBondLengthDeviation ?? 0) + PRESENTATION_METRIC_EPSILON &&
    !((candidateAudit.stereoContradiction ?? false) && !(baseAudit.stereoContradiction ?? false))
  );
}

function compareFinalCompactBridgedOverlapBondRepairCandidates(candidate, incumbent) {
  if (!incumbent) {
    return -1;
  }
  for (const key of ['severeOverlapCount', 'bondLengthFailureCount', 'labelOverlapCount', 'ringSubstituentReadabilityFailureCount', 'visibleHeavyBondCrossingCount']) {
    if ((candidate.audit[key] ?? 0) !== (incumbent.audit[key] ?? 0)) {
      return (candidate.audit[key] ?? 0) - (incumbent.audit[key] ?? 0);
    }
  }
  if (Math.abs((candidate.audit.maxBondLengthDeviation ?? 0) - (incumbent.audit.maxBondLengthDeviation ?? 0)) > PRESENTATION_METRIC_EPSILON) {
    return (candidate.audit.maxBondLengthDeviation ?? 0) - (incumbent.audit.maxBondLengthDeviation ?? 0);
  }
  if (candidate.movedHeavyAtomCount !== incumbent.movedHeavyAtomCount) {
    return candidate.movedHeavyAtomCount - incumbent.movedHeavyAtomCount;
  }
  if (Math.abs(candidate.totalMove - incumbent.totalMove) > PRESENTATION_METRIC_EPSILON) {
    return candidate.totalMove - incumbent.totalMove;
  }
  return candidate.key.localeCompare(incumbent.key, 'en', { numeric: true });
}

function maybeRetouchFinalCompactBridgedOverlapBondRepair(layoutGraph, finalCoords, placement, bondLength) {
  const baseAudit = auditLayout(layoutGraph, finalCoords, {
    bondLength,
    bondValidationClasses: placement.bondValidationClasses
  });
  const heavyAtomCount = layoutGraph.traits?.heavyAtomCount ?? [...layoutGraph.atoms.values()].filter(atom => atom.element !== 'H').length;
  if (
    heavyAtomCount > FINAL_COMPACT_BRIDGED_OVERLAP_BOND_REPAIR_MAX_HEAVY_ATOMS ||
    (layoutGraph.traits?.bridgedRingConnectionCount ?? 0) <= 0 ||
    (baseAudit.severeOverlapCount ?? 0) !== 1 ||
    (baseAudit.bondLengthFailureCount ?? 0) > 1 ||
    (baseAudit.severeBondLengthFailureCount ?? 0) > 0 ||
    (baseAudit.labelOverlapCount ?? 0) > 0 ||
    (baseAudit.ringSubstituentReadabilityFailureCount ?? 0) > 0 ||
    (baseAudit.collapsedMacrocycleCount ?? 0) > 0 ||
    (baseAudit.stereoContradiction ?? false)
  ) {
    return { coords: finalCoords, changed: false, movedAtomIds: [], audit: baseAudit };
  }

  const descriptors = finalCompactBridgedOverlapBondRepairDescriptors(layoutGraph, finalCoords, findSevereOverlaps(layoutGraph, finalCoords, bondLength), bondLength);
  if (descriptors.length === 0) {
    return { coords: finalCoords, changed: false, movedAtomIds: [], audit: baseAudit };
  }

  let bestCandidate = null;
  for (const descriptor of descriptors) {
    const reliefDescriptors = [null, ...descriptor.reliefDescriptors];
    for (const spreadFactor of FINAL_COMPACT_BRIDGED_OVERLAP_BOND_REPAIR_SPREAD_FACTORS) {
      for (const reliefDescriptor of reliefDescriptors) {
        const reliefFactors = reliefDescriptor ? FINAL_COMPACT_BRIDGED_OVERLAP_BOND_REPAIR_RELIEF_FACTORS : [0];
        for (const reliefFactor of reliefFactors) {
          const candidateCoords = finalCompactBridgedOverlapBondRepairCandidate(finalCoords, descriptor, spreadFactor, reliefDescriptor, reliefFactor, bondLength);
          if (!candidateCoords) {
            continue;
          }
          const candidateAudit = auditLayout(layoutGraph, candidateCoords, {
            bondLength,
            bondValidationClasses: placement.bondValidationClasses
          });
          if (!finalCompactBridgedOverlapBondRepairAuditCanReplace(candidateAudit, baseAudit)) {
            continue;
          }
          const movedAtomIds = [...new Set([...descriptor.movedAtomIds, ...(reliefDescriptor?.atomIds ?? [])])];
          const candidate = {
            coords: candidateCoords,
            audit: candidateAudit,
            movedAtomIds,
            movedHeavyAtomCount: movedAtomIds.filter(atomId => layoutGraph.atoms.get(atomId)?.element !== 'H').length,
            totalMove: finalAcyclicBranchContactCandidateMove(finalCoords, candidateCoords, movedAtomIds),
            key: `${descriptor.movedAtomId}:${descriptor.blockerAtomId}:${descriptor.sharedAtomId}:${spreadFactor}:${reliefDescriptor?.stretchedAtomId ?? '-'}:${reliefFactor}`
          };
          if (compareFinalCompactBridgedOverlapBondRepairCandidates(candidate, bestCandidate) < 0) {
            bestCandidate = candidate;
          }
        }
      }
    }
  }

  if (!bestCandidate) {
    return { coords: finalCoords, changed: false, movedAtomIds: [], audit: baseAudit };
  }
  return {
    coords: bestCandidate.coords,
    changed: true,
    movedAtomIds: bestCandidate.movedAtomIds,
    audit: bestCandidate.audit
  };
}

/**
 * Collects a tiny non-ring side group attached to a shared bridged corner so a
 * corner-opening nudge preserves terminal substituent bond lengths.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} centerAtomId - Saturated shared ring corner atom.
 * @param {Set<string>} ringNeighborIdSet - Ring neighbors held fixed.
 * @returns {string[]} Movable atom IDs including terminal leaves and hydrogens.
 */
function finalBridgedLinearSharedCornerSideGroup(layoutGraph, coords, centerAtomId, ringNeighborIdSet) {
  const atomIds = new Set([centerAtomId]);
  for (const bond of layoutGraph.bondsByAtomId.get(centerAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === centerAtomId ? bond.b : bond.a;
    if (ringNeighborIdSet.has(neighborAtomId) || !coords.has(neighborAtomId)) {
      continue;
    }
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || layoutGraph.ringAtomIdSet.has(neighborAtomId)) {
      continue;
    }
    const subtreeAtomIds = [...collectCutSubtree(layoutGraph, neighborAtomId, centerAtomId)].filter(atomId => coords.has(atomId));
    const subtreeHeavyAtomIds = subtreeAtomIds.filter(atomId => layoutGraph.atoms.get(atomId)?.element !== 'H');
    if (subtreeHeavyAtomIds.length > 1) {
      continue;
    }
    for (const atomId of subtreeAtomIds) {
      atomIds.add(atomId);
    }
  }
  return [...atomIds];
}

/**
 * Finds saturated shared bridged corners whose two ring bonds are visually
 * collinear and can be opened by a tiny local side-group translation.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @returns {Array<object>} Linear shared-corner descriptors.
 */
function finalBridgedLinearSharedCornerDescriptors(layoutGraph, coords) {
  const heavyAtomCount = layoutGraph.traits?.heavyAtomCount ?? [...layoutGraph.atoms.values()].filter(atom => atom.element !== 'H').length;
  if (heavyAtomCount > FINAL_BRIDGED_LINEAR_SHARED_CORNER_MAX_HEAVY_ATOMS || (layoutGraph.traits?.bridgedRingConnectionCount ?? 0) <= 0) {
    return [];
  }

  const descriptors = [];
  for (const atom of layoutGraph.atoms.values()) {
    if (
      !atom ||
      atom.element !== 'C' ||
      atom.aromatic ||
      !coords.has(atom.id) ||
      !layoutGraph.ringAtomIdSet.has(atom.id) ||
      (layoutGraph.ringCountByAtomId.get(atom.id) ?? 0) < 2 ||
      (atom.heavyDegree ?? 0) < 3 ||
      (atom.heavyDegree ?? 0) > 4
    ) {
      continue;
    }
    const ringNeighborIds = [];
    for (const bond of layoutGraph.bondsByAtomId.get(atom.id) ?? []) {
      if (!bond || bond.kind !== 'covalent' || !bond.inRing || bond.aromatic) {
        continue;
      }
      const neighborAtomId = bond.a === atom.id ? bond.b : bond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      if (neighborAtom && neighborAtom.element !== 'H' && coords.has(neighborAtomId)) {
        ringNeighborIds.push(neighborAtomId);
      }
    }
    if (ringNeighborIds.length !== 2) {
      continue;
    }
    const centerPosition = coords.get(atom.id);
    const firstPosition = coords.get(ringNeighborIds[0]);
    const secondPosition = coords.get(ringNeighborIds[1]);
    const anchorVector = sub(secondPosition, firstPosition);
    const anchorLength = Math.hypot(anchorVector.x, anchorVector.y);
    if (!centerPosition || !firstPosition || !secondPosition || anchorLength <= PRESENTATION_METRIC_EPSILON) {
      continue;
    }
    const angle = angularDifference(angleOf(sub(firstPosition, centerPosition)), angleOf(sub(secondPosition, centerPosition)));
    if (angle < FINAL_BRIDGED_LINEAR_SHARED_CORNER_TRIGGER) {
      continue;
    }
    const movedAtomIds = finalBridgedLinearSharedCornerSideGroup(layoutGraph, coords, atom.id, new Set(ringNeighborIds));
    const movedHeavyAtomIds = movedAtomIds.filter(atomId => layoutGraph.atoms.get(atomId)?.element !== 'H');
    if (movedHeavyAtomIds.length === 0 || movedHeavyAtomIds.length > FINAL_BRIDGED_LINEAR_SHARED_CORNER_MAX_MOVED_HEAVY_ATOMS) {
      continue;
    }
    descriptors.push({
      centerAtomId: atom.id,
      ringNeighborIds,
      movedAtomIds,
      movedHeavyAtomCount: movedHeavyAtomIds.length,
      angle,
      normalVectors: [
        { x: -anchorVector.y / anchorLength, y: anchorVector.x / anchorLength },
        { x: anchorVector.y / anchorLength, y: -anchorVector.x / anchorLength }
      ]
    });
  }
  return descriptors.sort((firstDescriptor, secondDescriptor) => firstDescriptor.centerAtomId.localeCompare(secondDescriptor.centerAtomId, 'en', { numeric: true }));
}

function finalBridgedLinearSharedCornerAngle(coords, descriptor) {
  const centerPosition = coords.get(descriptor.centerAtomId);
  const firstPosition = coords.get(descriptor.ringNeighborIds[0]);
  const secondPosition = coords.get(descriptor.ringNeighborIds[1]);
  if (!centerPosition || !firstPosition || !secondPosition) {
    return Number.POSITIVE_INFINITY;
  }
  return angularDifference(angleOf(sub(firstPosition, centerPosition)), angleOf(sub(secondPosition, centerPosition)));
}

function finalBridgedLinearSharedCornerCandidate(coords, descriptor, normalVector, shift) {
  const candidateCoords = new Map(coords);
  const displacement = { x: normalVector.x * shift, y: normalVector.y * shift };
  let totalMove = 0;
  for (const atomId of descriptor.movedAtomIds) {
    const position = coords.get(atomId);
    if (!position) {
      continue;
    }
    candidateCoords.set(atomId, add(position, displacement));
    totalMove += Math.hypot(displacement.x, displacement.y);
  }
  return totalMove > PRESENTATION_METRIC_EPSILON ? { coords: candidateCoords, totalMove } : null;
}

function finalBridgedLinearSharedCornerAuditCanReplace(candidateAudit, baseAudit, candidateAngle, baseAngle, bondLength) {
  if (!finalAuditCountsDoNotWorsen(candidateAudit, baseAudit)) {
    return false;
  }
  if ((candidateAudit.maxBondLengthDeviation ?? 0) > finalRetouchAllowedBondDeviation('bridged', bondLength) + PRESENTATION_METRIC_EPSILON) {
    return false;
  }
  if (candidateAngle > baseAngle - FINAL_BRIDGED_LINEAR_SHARED_CORNER_MIN_GAIN) {
    return false;
  }
  return candidateAngle <= FINAL_BRIDGED_LINEAR_SHARED_CORNER_TARGET + FINAL_BRIDGED_LINEAR_SHARED_CORNER_MIN_GAIN;
}

function compareFinalBridgedLinearSharedCornerCandidates(candidate, incumbent) {
  if (!incumbent) {
    return -1;
  }
  const candidateTargetDeviation = Math.abs(candidate.angle - FINAL_BRIDGED_LINEAR_SHARED_CORNER_TARGET);
  const incumbentTargetDeviation = Math.abs(incumbent.angle - FINAL_BRIDGED_LINEAR_SHARED_CORNER_TARGET);
  if (candidateTargetDeviation < incumbentTargetDeviation - PRESENTATION_METRIC_EPSILON) {
    return -1;
  }
  if (candidateTargetDeviation > incumbentTargetDeviation + PRESENTATION_METRIC_EPSILON) {
    return 1;
  }
  if (Math.abs((candidate.audit.maxBondLengthDeviation ?? 0) - (incumbent.audit.maxBondLengthDeviation ?? 0)) > PRESENTATION_METRIC_EPSILON) {
    return (candidate.audit.maxBondLengthDeviation ?? 0) - (incumbent.audit.maxBondLengthDeviation ?? 0);
  }
  if (candidate.movedHeavyAtomCount !== incumbent.movedHeavyAtomCount) {
    return candidate.movedHeavyAtomCount - incumbent.movedHeavyAtomCount;
  }
  if (Math.abs(candidate.totalMove - incumbent.totalMove) > PRESENTATION_METRIC_EPSILON) {
    return candidate.totalMove - incumbent.totalMove;
  }
  return candidate.key.localeCompare(incumbent.key, 'en', { numeric: true });
}

/**
 * Opens saturated shared bridged corners that placement left nearly collinear.
 * The retouch translates only the corner plus tiny terminal side groups, and
 * accepts a candidate only when final audit counts and bridged bond tolerance
 * do not regress.
 * @param {object} molecule - Molecule-like graph.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} finalCoords - Current final coordinates.
 * @param {object} placement - Placement result containing validation classes.
 * @param {number} bondLength - Target bond length.
 * @returns {{coords: Map<string, {x: number, y: number}>, changed: boolean, movedAtomIds: string[], audit: object|null, angleBefore?: number, angleAfter?: number}} Retouch result.
 */
function maybeRetouchFinalBridgedLinearSharedCorners(molecule, layoutGraph, finalCoords, placement, bondLength) {
  const descriptors = finalBridgedLinearSharedCornerDescriptors(layoutGraph, finalCoords);
  if (descriptors.length === 0) {
    return { coords: finalCoords, changed: false, movedAtomIds: [], audit: null };
  }

  const baseAudit = auditFinalRetouchCoords(molecule, layoutGraph, finalCoords, placement, bondLength);
  if (baseAudit.ok !== true || baseAudit.fallback?.mode != null) {
    return { coords: finalCoords, changed: false, movedAtomIds: [], audit: baseAudit };
  }

  let bestCandidate = null;
  for (const descriptor of descriptors) {
    const baseAngle = finalBridgedLinearSharedCornerAngle(finalCoords, descriptor);
    for (const normalVector of descriptor.normalVectors) {
      for (const shiftFactor of FINAL_BRIDGED_LINEAR_SHARED_CORNER_SHIFT_FACTORS) {
        const candidate = finalBridgedLinearSharedCornerCandidate(finalCoords, descriptor, normalVector, bondLength * shiftFactor);
        if (!candidate) {
          continue;
        }
        const candidateAngle = finalBridgedLinearSharedCornerAngle(candidate.coords, descriptor);
        const candidateAudit = auditFinalRetouchCoords(molecule, layoutGraph, candidate.coords, placement, bondLength);
        if (!finalBridgedLinearSharedCornerAuditCanReplace(candidateAudit, baseAudit, candidateAngle, baseAngle, bondLength)) {
          continue;
        }
        const scoredCandidate = {
          ...candidate,
          audit: candidateAudit,
          angle: candidateAngle,
          angleBefore: baseAngle,
          movedAtomIds: descriptor.movedAtomIds,
          movedHeavyAtomCount: descriptor.movedHeavyAtomCount,
          key: `${descriptor.centerAtomId}:${normalVector.x}:${normalVector.y}:${shiftFactor}`
        };
        if (compareFinalBridgedLinearSharedCornerCandidates(scoredCandidate, bestCandidate) < 0) {
          bestCandidate = scoredCandidate;
        }
      }
    }
  }

  if (!bestCandidate) {
    return { coords: finalCoords, changed: false, movedAtomIds: [], audit: baseAudit };
  }
  return {
    coords: bestCandidate.coords,
    changed: true,
    movedAtomIds: bestCandidate.movedAtomIds,
    audit: bestCandidate.audit,
    angleBefore: bestCandidate.angleBefore,
    angleAfter: bestCandidate.angle
  };
}

function maybeRetouchFinalFusedAcyclicSidechainSevereContacts(layoutGraph, finalCoords, placement, bondLength) {
  const baseAudit = auditLayout(layoutGraph, finalCoords, {
    bondLength,
    bondValidationClasses: placement.bondValidationClasses
  });
  if (
    (baseAudit.severeOverlapCount ?? 0) !== 1 ||
    (baseAudit.bondLengthFailureCount ?? 0) > 0 ||
    (baseAudit.labelOverlapCount ?? 0) > 0 ||
    (baseAudit.ringSubstituentReadabilityFailureCount ?? 0) > 0 ||
    (baseAudit.visibleHeavyBondCrossingCount ?? 0) > 0 ||
    (baseAudit.collapsedMacrocycleCount ?? 0) > 0 ||
    (baseAudit.stereoContradiction ?? false)
  ) {
    return { coords: finalCoords, changed: false, movedAtomIds: [], audit: baseAudit };
  }
  return maybeRetouchFinalAcyclicBranchSevereContacts(layoutGraph, finalCoords, placement, bondLength, {
    maxMovedHeavyAtoms: FINAL_FUSED_ACYCLIC_SIDECHAIN_CONTACT_MAX_MOVED_HEAVY_ATOMS,
    maxPasses: 1,
    requireAuditClean: true
  });
}

function terminalMultipleBondLeafIdsForRingHypervalentAtom(layoutGraph, coords, hypervalentAtomId) {
  const leafAtomIds = [];
  for (const bond of layoutGraph.bondsByAtomId.get(hypervalentAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || bond.inRing || (bond.order ?? 1) < 2) {
      continue;
    }
    const leafAtomId = bond.a === hypervalentAtomId ? bond.b : bond.a;
    const leafAtom = layoutGraph.atoms.get(leafAtomId);
    if (
      leafAtom &&
      FINAL_RING_HYPERVALENT_BRANCH_OVERLAP_TERMINAL_LEAF_ELEMENTS.has(leafAtom.element) &&
      !leafAtom.aromatic &&
      !layoutGraph.ringAtomIdSet.has(leafAtomId) &&
      (leafAtom.heavyDegree ?? 0) <= 1 &&
      coords.has(leafAtomId)
    ) {
      leafAtomIds.push(leafAtomId);
    }
  }
  return leafAtomIds;
}

function branchAtomRingAnchorsForHypervalentOverlap(layoutGraph, coords, branchAtomId, ringSystemAtomIds) {
  const anchorAtomIds = [];
  for (const bond of layoutGraph.bondsByAtomId.get(branchAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || bond.inRing || (bond.order ?? 1) !== 1) {
      continue;
    }
    const neighborAtomId = bond.a === branchAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (neighborAtom && neighborAtom.element !== 'H' && coords.has(neighborAtomId) && ringSystemAtomIds.has(neighborAtomId)) {
      anchorAtomIds.push(neighborAtomId);
    }
  }
  return anchorAtomIds;
}

function finalRingHypervalentBranchOverlapDescriptor(layoutGraph, coords, hypervalentAtomId, branchAtomId) {
  const hypervalentAtom = layoutGraph.atoms.get(hypervalentAtomId);
  const branchAtom = layoutGraph.atoms.get(branchAtomId);
  if (
    !hypervalentAtom ||
    !branchAtom ||
    !FINAL_RING_HYPERVALENT_BRANCH_OVERLAP_ELEMENTS.has(hypervalentAtom.element) ||
    hypervalentAtom.aromatic ||
    !layoutGraph.ringAtomIdSet.has(hypervalentAtomId) ||
    layoutGraph.ringAtomIdSet.has(branchAtomId) ||
    branchAtom.element === 'H' ||
    !coords.has(hypervalentAtomId) ||
    !coords.has(branchAtomId) ||
    layoutGraph.bondedPairSet.has(atomPairKey(hypervalentAtomId, branchAtomId))
  ) {
    return null;
  }

  const ringSystemId = layoutGraph.atomToRingSystemId.get(hypervalentAtomId);
  const ringSystem = ringSystemId != null ? layoutGraph.ringSystemById.get(ringSystemId) : null;
  if (!ringSystem || (ringSystem.atomIds?.length ?? 0) > FINAL_RING_HYPERVALENT_BRANCH_OVERLAP_MAX_RING_SYSTEM_ATOMS || (ringSystem.ringIds?.length ?? 0) < 2) {
    return null;
  }

  const terminalLeafAtomIds = terminalMultipleBondLeafIdsForRingHypervalentAtom(layoutGraph, coords, hypervalentAtomId);
  if (terminalLeafAtomIds.length === 0 || terminalLeafAtomIds.length > 3) {
    return null;
  }

  const ringSystemAtomIds = new Set(ringSystem.atomIds ?? []);
  const branchAnchorAtomIds = branchAtomRingAnchorsForHypervalentOverlap(layoutGraph, coords, branchAtomId, ringSystemAtomIds);
  if (branchAnchorAtomIds.length === 0) {
    return null;
  }

  return {
    hypervalentAtomId,
    branchAtomId,
    branchAnchorAtomIds,
    movedAtomIds: [hypervalentAtomId, ...terminalLeafAtomIds],
    ringAtomIds: ringSystem.atomIds ?? []
  };
}

function finalRingHypervalentBranchOverlapDescriptors(layoutGraph, coords, bondLength) {
  const descriptors = [];
  const seenKeys = new Set();
  for (const overlap of findSevereOverlaps(layoutGraph, coords, bondLength)) {
    for (const [hypervalentAtomId, branchAtomId] of [
      [overlap.firstAtomId, overlap.secondAtomId],
      [overlap.secondAtomId, overlap.firstAtomId]
    ]) {
      const descriptor = finalRingHypervalentBranchOverlapDescriptor(layoutGraph, coords, hypervalentAtomId, branchAtomId);
      if (!descriptor) {
        continue;
      }
      const key = `${descriptor.hypervalentAtomId}:${descriptor.branchAtomId}`;
      if (seenKeys.has(key)) {
        continue;
      }
      seenKeys.add(key);
      descriptors.push(descriptor);
      if (descriptors.length >= FINAL_RING_HYPERVALENT_BRANCH_OVERLAP_MAX_DESCRIPTORS) {
        return descriptors;
      }
    }
  }
  return descriptors.sort((firstDescriptor, secondDescriptor) =>
    `${firstDescriptor.hypervalentAtomId}:${firstDescriptor.branchAtomId}`.localeCompare(`${secondDescriptor.hypervalentAtomId}:${secondDescriptor.branchAtomId}`, 'en', { numeric: true })
  );
}

function ringHypervalentBranchOverlapCandidates(coords, descriptor, bondLength) {
  const hypervalentPosition = coords.get(descriptor.hypervalentAtomId);
  const branchPosition = coords.get(descriptor.branchAtomId);
  if (!hypervalentPosition || !branchPosition) {
    return [];
  }

  const awayAngle = Math.atan2(hypervalentPosition.y - branchPosition.y, hypervalentPosition.x - branchPosition.x);
  const candidates = [];
  for (const directionOffset of FINAL_RING_HYPERVALENT_BRANCH_OVERLAP_DIRECTION_OFFSETS) {
    const directionAngle = awayAngle + directionOffset;
    const direction = { x: Math.cos(directionAngle), y: Math.sin(directionAngle) };
    for (const shiftFactor of FINAL_RING_HYPERVALENT_BRANCH_OVERLAP_SHIFT_FACTORS) {
      const candidateCoords = cloneCoords(coords);
      translateAtomGroup(candidateCoords, coords, descriptor.movedAtomIds, {
        x: direction.x * bondLength * shiftFactor,
        y: direction.y * bondLength * shiftFactor
      });
      candidates.push(candidateCoords);
    }
  }
  return candidates;
}

function compareFinalRingHypervalentBranchOverlapCandidates(candidate, incumbent) {
  if (!incumbent) {
    return -1;
  }
  for (const key of ['severeOverlapCount', 'visibleHeavyBondCrossingCount', 'bondLengthFailureCount', 'labelOverlapCount', 'ringSubstituentReadabilityFailureCount']) {
    if ((candidate.audit[key] ?? 0) !== (incumbent.audit[key] ?? 0)) {
      return (candidate.audit[key] ?? 0) - (incumbent.audit[key] ?? 0);
    }
  }
  if (Math.abs((candidate.audit.severeOverlapPenalty ?? 0) - (incumbent.audit.severeOverlapPenalty ?? 0)) > PRESENTATION_METRIC_EPSILON) {
    return (candidate.audit.severeOverlapPenalty ?? 0) - (incumbent.audit.severeOverlapPenalty ?? 0);
  }
  if (Math.abs((candidate.audit.maxBondLengthDeviation ?? 0) - (incumbent.audit.maxBondLengthDeviation ?? 0)) > PRESENTATION_METRIC_EPSILON) {
    return (candidate.audit.maxBondLengthDeviation ?? 0) - (incumbent.audit.maxBondLengthDeviation ?? 0);
  }
  if (Math.abs(candidate.totalMove - incumbent.totalMove) > PRESENTATION_METRIC_EPSILON) {
    return candidate.totalMove - incumbent.totalMove;
  }
  return candidate.key.localeCompare(incumbent.key, 'en', { numeric: true });
}

function maybeRetouchFinalRingHypervalentBranchOverlaps(layoutGraph, finalCoords, placement, bondLength) {
  const baseAudit = auditLayout(layoutGraph, finalCoords, {
    bondLength,
    bondValidationClasses: placement.bondValidationClasses
  });
  if ((baseAudit.severeOverlapCount ?? 0) === 0) {
    return { coords: finalCoords, changed: false, movedAtomIds: [], audit: baseAudit };
  }

  const descriptors = finalRingHypervalentBranchOverlapDescriptors(layoutGraph, finalCoords, bondLength);
  if (descriptors.length === 0) {
    return { coords: finalCoords, changed: false, movedAtomIds: [], audit: baseAudit };
  }

  let bestCandidate = null;
  for (const descriptor of descriptors) {
    const candidateBondValidationClasses = assignBondValidationClass(layoutGraph, descriptor.ringAtomIds, 'bridged', new Map(placement.bondValidationClasses), { overwrite: true });
    for (const candidateCoords of ringHypervalentBranchOverlapCandidates(finalCoords, descriptor, bondLength)) {
      const candidateAudit = auditLayout(layoutGraph, candidateCoords, {
        bondLength,
        bondValidationClasses: candidateBondValidationClasses
      });
      if (!finalAuditCountsDoNotWorsen(candidateAudit, baseAudit) || (candidateAudit.severeOverlapCount ?? 0) >= (baseAudit.severeOverlapCount ?? 0)) {
        continue;
      }
      const candidate = {
        coords: candidateCoords,
        audit: candidateAudit,
        bondValidationClasses: candidateBondValidationClasses,
        movedAtomIds: descriptor.movedAtomIds,
        key: `${descriptor.hypervalentAtomId}:${descriptor.branchAtomId}`,
        totalMove: finalAcyclicBranchContactCandidateMove(finalCoords, candidateCoords, descriptor.movedAtomIds)
      };
      if (compareFinalRingHypervalentBranchOverlapCandidates(candidate, bestCandidate) < 0) {
        bestCandidate = candidate;
      }
    }
  }

  if (!bestCandidate) {
    return { coords: finalCoords, changed: false, movedAtomIds: [], audit: baseAudit };
  }
  return {
    coords: bestCandidate.coords,
    changed: true,
    bondValidationClasses: bestCandidate.bondValidationClasses,
    movedAtomIds: bestCandidate.movedAtomIds,
    audit: bestCandidate.audit
  };
}

function finalAttachedRingBranchContactDescriptor(layoutGraph, coords, rootAtomId, anchorAtomId) {
  if (
    !layoutGraph ||
    rootAtomId === anchorAtomId ||
    !coords.has(rootAtomId) ||
    !coords.has(anchorAtomId) ||
    !layoutGraph.ringAtomIdSet.has(rootAtomId) ||
    layoutGraph.ringAtomIdSet.has(anchorAtomId)
  ) {
    return null;
  }
  const rootAtom = layoutGraph.atoms.get(rootAtomId);
  const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
  if (!rootAtom || !anchorAtom || rootAtom.element === 'H' || anchorAtom.element === 'H') {
    return null;
  }
  const bond = layoutGraph.bondByAtomPair.get(atomPairKey(rootAtomId, anchorAtomId));
  if (!bond || bond.kind !== 'covalent' || bond.aromatic || bond.inRing || (bond.order ?? 1) !== 1) {
    return null;
  }

  const movedAtomIds = collectFinalTerminalCarbonLeafSubtreeAtomIds(layoutGraph, rootAtomId, anchorAtomId, coords);
  const movedHeavyAtomIds = movedAtomIds.filter(atomId => layoutGraph.atoms.get(atomId)?.element !== 'H');
  if (movedHeavyAtomIds.length <= 1 || movedHeavyAtomIds.length > FINAL_ATTACHED_RING_BRANCH_CONTACT_MAX_MOVED_HEAVY_ATOMS) {
    return null;
  }
  const visibleHeavyAtomCount = [...coords.keys()].filter(atomId => {
    const atom = layoutGraph.atoms.get(atomId);
    return atom && atom.element !== 'H' && atom.visible !== false;
  }).length;
  if (movedHeavyAtomIds.length >= visibleHeavyAtomCount - 1) {
    return null;
  }

  return {
    anchorAtomId,
    rootAtomId,
    movedAtomIds,
    movedHeavyAtomIds
  };
}

function finalAttachedRingBranchContactDescriptors(layoutGraph, coords, bondLength) {
  const visibleHeavyAtomCount = [...coords.keys()].filter(atomId => {
    const atom = layoutGraph.atoms.get(atomId);
    return atom && atom.element !== 'H' && atom.visible !== false;
  }).length;
  if (visibleHeavyAtomCount > FINAL_ATTACHED_RING_BRANCH_CONTACT_MAX_LAYOUT_HEAVY_ATOMS) {
    return [];
  }

  const descriptorByKey = new Map();
  for (const overlap of findSevereOverlaps(layoutGraph, coords, bondLength)) {
    for (const atomId of [overlap.firstAtomId, overlap.secondAtomId]) {
      const atom = layoutGraph.atoms.get(atomId);
      if (!atom || atom.element === 'H' || !layoutGraph.ringAtomIdSet.has(atomId)) {
        continue;
      }
      for (const ring of layoutGraph.atomToRings.get(atomId) ?? []) {
        for (const ringAtomId of ring.atomIds ?? []) {
          if (!coords.has(ringAtomId)) {
            continue;
          }
          for (const bond of layoutGraph.bondsByAtomId.get(ringAtomId) ?? []) {
            if (!bond || bond.kind !== 'covalent' || bond.aromatic || bond.inRing || (bond.order ?? 1) !== 1) {
              continue;
            }
            const anchorAtomId = bond.a === ringAtomId ? bond.b : bond.a;
            const descriptor = finalAttachedRingBranchContactDescriptor(layoutGraph, coords, ringAtomId, anchorAtomId);
            if (!descriptor) {
              continue;
            }
            descriptorByKey.set(`${descriptor.anchorAtomId}:${descriptor.rootAtomId}`, descriptor);
            if (descriptorByKey.size > FINAL_ATTACHED_RING_BRANCH_CONTACT_MAX_DESCRIPTORS) {
              return [];
            }
          }
        }
      }
    }
  }
  return [...descriptorByKey.values()];
}

function rotateFinalAttachedRingBranchContactCandidate(coords, descriptor, rotationOffset) {
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
    candidateCoords.set(atomId, rotateAround(position, anchorPosition, rotationOffset));
  }
  return candidateCoords;
}

function finalAttachedRingBranchContactAuditCanReplace(candidateAudit, baseAudit) {
  if (!finalAuditCountsDoNotWorsen(candidateAudit, baseAudit)) {
    return false;
  }
  return (
    (candidateAudit.severeOverlapCount ?? 0) < (baseAudit.severeOverlapCount ?? 0) ||
    ((candidateAudit.severeOverlapCount ?? 0) === (baseAudit.severeOverlapCount ?? 0) &&
      (candidateAudit.severeOverlapPenalty ?? 0) < (baseAudit.severeOverlapPenalty ?? 0) - PRESENTATION_METRIC_EPSILON)
  );
}

function compareFinalAttachedRingBranchContactCandidates(candidate, incumbent) {
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
  if (candidate.movedHeavyAtomCount !== incumbent.movedHeavyAtomCount) {
    return candidate.movedHeavyAtomCount - incumbent.movedHeavyAtomCount;
  }
  if (Math.abs(candidate.totalMove - incumbent.totalMove) > PRESENTATION_METRIC_EPSILON) {
    return candidate.totalMove - incumbent.totalMove;
  }
  if (Math.abs(candidate.rotationMagnitude - incumbent.rotationMagnitude) > PRESENTATION_METRIC_EPSILON) {
    return candidate.rotationMagnitude - incumbent.rotationMagnitude;
  }
  return `${candidate.anchorAtomId}:${candidate.rootAtomId}`.localeCompare(`${incumbent.anchorAtomId}:${incumbent.rootAtomId}`, 'en', { numeric: true });
}

function maybeRetouchFinalAttachedRingBranchSevereContacts(layoutGraph, finalCoords, placement, bondLength) {
  let currentCoords = finalCoords;
  let baseAudit = auditLayout(layoutGraph, currentCoords, {
    bondLength,
    bondValidationClasses: placement.bondValidationClasses
  });
  if ((baseAudit.severeOverlapCount ?? 0) === 0) {
    return { coords: finalCoords, changed: false, movedAtomIds: [], audit: baseAudit };
  }

  const movedAtomIds = new Set();
  let changed = false;
  for (let passIndex = 0; passIndex < FINAL_ATTACHED_RING_BRANCH_CONTACT_MAX_PASSES; passIndex++) {
    const descriptors = finalAttachedRingBranchContactDescriptors(layoutGraph, currentCoords, bondLength);
    if (descriptors.length === 0) {
      break;
    }

    let bestCandidate = null;
    for (const descriptor of descriptors) {
      for (const rotationOffset of FINAL_ATTACHED_RING_BRANCH_CONTACT_ROTATIONS) {
        const candidateCoords = rotateFinalAttachedRingBranchContactCandidate(currentCoords, descriptor, rotationOffset);
        if (!candidateCoords) {
          continue;
        }
        const candidateAudit = auditLayout(layoutGraph, candidateCoords, {
          bondLength,
          bondValidationClasses: placement.bondValidationClasses
        });
        if (!finalAttachedRingBranchContactAuditCanReplace(candidateAudit, baseAudit)) {
          continue;
        }
        const candidate = {
          coords: candidateCoords,
          audit: candidateAudit,
          anchorAtomId: descriptor.anchorAtomId,
          rootAtomId: descriptor.rootAtomId,
          movedAtomIds: descriptor.movedAtomIds,
          movedHeavyAtomCount: descriptor.movedHeavyAtomIds.length,
          rotationMagnitude: Math.abs(rotationOffset),
          totalMove: finalAcyclicBranchContactCandidateMove(currentCoords, candidateCoords, descriptor.movedAtomIds)
        };
        if (compareFinalAttachedRingBranchContactCandidates(candidate, bestCandidate) < 0) {
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
    if ((baseAudit.severeOverlapCount ?? 0) === 0) {
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

function finalExactBridgedRingPathMoveGroup(layoutGraph, coords, atomId, ringAtomIdSet) {
  const atomIds = new Set([atomId]);
  for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.inRing) {
      continue;
    }
    const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
    if (ringAtomIdSet.has(neighborAtomId) || layoutGraph.ringAtomIdSet.has(neighborAtomId)) {
      continue;
    }
    for (const movedAtomId of collectFinalTerminalCarbonLeafSubtreeAtomIds(layoutGraph, neighborAtomId, atomId, coords)) {
      atomIds.add(movedAtomId);
    }
  }
  return [...atomIds].filter(movedAtomId => coords.has(movedAtomId));
}

function orderedAdjacentRingAtomPair(ring, firstAtomId, secondAtomId) {
  const firstIndex = ring.atomIds.indexOf(firstAtomId);
  const secondIndex = ring.atomIds.indexOf(secondAtomId);
  if (firstIndex < 0 || secondIndex < 0) {
    return null;
  }
  const ringSize = ring.atomIds.length;
  if ((firstIndex + 1) % ringSize === secondIndex) {
    return [firstAtomId, secondAtomId];
  }
  if ((secondIndex + 1) % ringSize === firstIndex) {
    return [secondAtomId, firstAtomId];
  }
  return null;
}

function hasBridgedConnectionForRing(layoutGraph, ring) {
  return (layoutGraph.ringConnections ?? []).some(
    connection => connection.kind === 'bridged' && (connection.sharedAtomIds?.length ?? 0) >= 3 && (connection.firstRingId === ring.id || connection.secondRingId === ring.id)
  );
}

function hasBridgedConnectionForRingSystem(layoutGraph, ringSystem) {
  const ringIds = new Set(ringSystem?.ringIds ?? []);
  if (ringIds.size === 0) {
    return false;
  }
  return (layoutGraph.ringConnections ?? []).some(
    connection => connection.kind === 'bridged' && (connection.sharedAtomIds?.length ?? 0) >= 3 && (ringIds.has(connection.firstRingId) || ringIds.has(connection.secondRingId))
  );
}

function terminalMultipleBondHeteroLeafIdsForCenter(layoutGraph, coords, centerAtomId) {
  const centerAtom = layoutGraph.atoms.get(centerAtomId);
  if (!centerAtom || centerAtom.element === 'H' || centerAtom.aromatic || !coords.has(centerAtomId)) {
    return [];
  }
  return (layoutGraph.bondsByAtomId.get(centerAtomId) ?? []).flatMap(bond => {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || bond.inRing || (bond.order ?? 1) <= 1) {
      return [];
    }
    const leafAtomId = bond.a === centerAtomId ? bond.b : bond.a;
    const leafAtom = layoutGraph.atoms.get(leafAtomId);
    if (
      !leafAtom ||
      !FINAL_TERMINAL_SINGLE_HETERO_MULTIPLE_BOND_LEAF_ELEMENTS.has(leafAtom.element) ||
      leafAtom.aromatic ||
      (leafAtom.heavyDegree ?? 0) !== 1 ||
      layoutGraph.ringAtomIdSet.has(leafAtomId) ||
      !coords.has(leafAtomId)
    ) {
      return [];
    }
    return [leafAtomId];
  });
}

function compactBridgedRingPathTailReliefDescriptorsForAtom(layoutGraph, coords, ringSystem, rootAtomId, blockerAtomId) {
  const rootAtom = layoutGraph.atoms.get(rootAtomId);
  if (!rootAtom || rootAtom.element === 'H' || rootAtom.aromatic || !coords.has(rootAtomId) || (layoutGraph.ringCountByAtomId.get(rootAtomId) ?? 0) !== 1) {
    return [];
  }
  const ringSystemAtomIdSet = new Set(ringSystem.atomIds ?? []);
  const ringSystemRingIds = new Set(ringSystem.ringIds ?? []);
  const descriptors = [];
  const seenKeys = new Set();

  for (const ring of layoutGraph.atomToRings.get(rootAtomId) ?? []) {
    if (!ring || ring.aromatic || !ringSystemRingIds.has(ring.id) || ring.atomIds.length < 5) {
      continue;
    }
    const rootIndex = ring.atomIds.indexOf(rootAtomId);
    if (rootIndex < 0) {
      continue;
    }
    for (const direction of [-1, 1]) {
      const pathAtomIds = [rootAtomId];
      let endpointAtomId = null;
      for (let step = 1; step < ring.atomIds.length; step += 1) {
        const nextIndex = (rootIndex + direction * step + ring.atomIds.length) % ring.atomIds.length;
        const nextAtomId = ring.atomIds[nextIndex];
        if (nextAtomId === rootAtomId || nextAtomId === blockerAtomId || !ringSystemAtomIdSet.has(nextAtomId) || !coords.has(nextAtomId)) {
          endpointAtomId = null;
          break;
        }
        const nextRingCount = layoutGraph.ringCountByAtomId.get(nextAtomId) ?? 0;
        if (nextRingCount >= 2) {
          endpointAtomId = nextAtomId;
          break;
        }
        const nextAtom = layoutGraph.atoms.get(nextAtomId);
        if (!nextAtom || nextAtom.element === 'H' || nextAtom.aromatic || nextRingCount !== 1 || pathAtomIds.length >= FINAL_COMPACT_BRIDGED_RING_PATH_TAIL_MAX_PATH_ATOMS) {
          endpointAtomId = null;
          break;
        }
        pathAtomIds.push(nextAtomId);
      }
      if (!endpointAtomId || pathAtomIds.length < FINAL_COMPACT_BRIDGED_RING_PATH_TAIL_MIN_PATH_ATOMS) {
        continue;
      }

      const movedAtomIds = new Set(pathAtomIds);
      for (const pathAtomId of pathAtomIds) {
        for (const bond of layoutGraph.bondsByAtomId.get(pathAtomId) ?? []) {
          if (!bond || bond.kind !== 'covalent' || bond.inRing) {
            continue;
          }
          const neighborAtomId = bond.a === pathAtomId ? bond.b : bond.a;
          if (ringSystemAtomIdSet.has(neighborAtomId) || layoutGraph.ringAtomIdSet.has(neighborAtomId)) {
            continue;
          }
          for (const movedAtomId of collectFinalTerminalCarbonLeafSubtreeAtomIds(layoutGraph, neighborAtomId, pathAtomId, coords)) {
            movedAtomIds.add(movedAtomId);
          }
        }
      }
      if (movedAtomIds.has(blockerAtomId) || movedAtomIds.has(endpointAtomId) || [...movedAtomIds].some(atomId => !coords.has(atomId) || layoutGraph.fixedCoords?.has(atomId))) {
        continue;
      }
      const movedHeavyAtomIds = [...movedAtomIds].filter(atomId => layoutGraph.atoms.get(atomId)?.element !== 'H');
      const nonringMovedHeavyAtomIds = movedHeavyAtomIds.filter(atomId => !ringSystemAtomIdSet.has(atomId));
      if (
        movedHeavyAtomIds.length < pathAtomIds.length ||
        movedHeavyAtomIds.length > FINAL_COMPACT_BRIDGED_RING_PATH_TAIL_MAX_MOVED_HEAVY_ATOMS ||
        nonringMovedHeavyAtomIds.length > FINAL_COMPACT_BRIDGED_RING_PATH_TAIL_MAX_NONRING_HEAVY_ATOMS
      ) {
        continue;
      }

      const descriptorKey = `${rootAtomId}:${blockerAtomId}:${ring.id}:${direction}:${pathAtomIds.join(':')}`;
      if (seenKeys.has(descriptorKey)) {
        continue;
      }
      seenKeys.add(descriptorKey);
      descriptors.push({
        kind: 'compactBridgedRingPathTailRelief',
        firstAtomId: rootAtomId,
        secondAtomId: blockerAtomId,
        rootAtomId,
        blockerAtomId,
        endpointAtomId,
        pathAtomIds,
        ringAtomIds: ringSystem.atomIds ?? [],
        movedAtomIds: [...movedAtomIds]
      });
    }
  }
  return descriptors;
}

function compactBridgedSameRingPathBridgeheadOverlapDescriptors(layoutGraph, coords, bondLength) {
  const descriptors = [];
  const seenPairs = new Set();
  for (const overlap of findSevereOverlaps(layoutGraph, coords, bondLength)) {
    const firstAtomId = overlap.firstAtomId;
    const secondAtomId = overlap.secondAtomId;
    const pairKey = atomPairKey(firstAtomId, secondAtomId);
    if (seenPairs.has(pairKey) || layoutGraph.bondedPairSet.has(pairKey)) {
      continue;
    }
    seenPairs.add(pairKey);

    if ((overlap.distance ?? Number.POSITIVE_INFINITY) > bondLength * FINAL_COMPACT_BRIDGED_SAME_RING_PATH_BRIDGEHEAD_OVERLAP_DISTANCE_FACTOR) {
      continue;
    }

    for (const [atomId, bridgeheadAtomId] of [
      [firstAtomId, secondAtomId],
      [secondAtomId, firstAtomId]
    ]) {
      const atom = layoutGraph.atoms.get(atomId);
      const bridgeheadAtom = layoutGraph.atoms.get(bridgeheadAtomId);
      if (
        !isRetouchableParallelBridgedPathAtom(layoutGraph, coords, atomId) ||
        !isCompactBridgedOverlapStationaryBridgehead(layoutGraph, bridgeheadAtom, bridgeheadAtomId) ||
        !atom ||
        !bridgeheadAtom ||
        atom.element !== 'C' ||
        bridgeheadAtom.element !== 'C'
      ) {
        continue;
      }

      const sharedRings = (layoutGraph.atomToRings.get(atomId) ?? []).filter(ring => (layoutGraph.atomToRings.get(bridgeheadAtomId) ?? []).some(otherRing => otherRing.id === ring.id));
      const bridgedRing = sharedRings.find(ring => ring && !ring.aromatic && hasBridgedConnectionForRing(layoutGraph, ring));
      if (!bridgedRing) {
        continue;
      }

      const ringSystemId = layoutGraph.atomToRingSystemId.get(atomId);
      const bridgeheadRingSystemId = layoutGraph.atomToRingSystemId.get(bridgeheadAtomId);
      const ringSystem = ringSystemId != null && ringSystemId === bridgeheadRingSystemId ? layoutGraph.ringSystemById.get(ringSystemId) : null;
      if (!ringSystem || (ringSystem.atomIds?.length ?? 0) > 16 || (ringSystem.ringIds?.length ?? 0) < 2 || !hasBridgedConnectionForRingSystem(layoutGraph, ringSystem)) {
        continue;
      }

      const movedAtomIds = finalExactBridgedRingPathMoveGroup(layoutGraph, coords, atomId, new Set(ringSystem.atomIds ?? bridgedRing.atomIds));
      const movedHeavyAtomIds = movedAtomIds.filter(movedAtomId => layoutGraph.atoms.get(movedAtomId)?.element !== 'H');
      if (!isCompactBridgedOverlapMoveGroup(layoutGraph, atomId, movedHeavyAtomIds)) {
        continue;
      }

      descriptors.push({
        kind: 'compactBridgedSameRingPathBridgeheadRelief',
        firstAtomId: atomId,
        secondAtomId: bridgeheadAtomId,
        atomId,
        bridgeheadAtomId,
        ringAtomIds: ringSystem.atomIds ?? bridgedRing.atomIds,
        movedAtomIds
      });
    }
  }
  return descriptors;
}

function compactBridgedAcylLeafRingAnchorAtomId(layoutGraph, coords, leafAtomId, ringSystemAtomIdSet) {
  const leafAtom = layoutGraph.atoms.get(leafAtomId);
  if (!leafAtom || leafAtom.element !== 'C' || leafAtom.aromatic || layoutGraph.ringAtomIdSet.has(leafAtomId) || (leafAtom.heavyDegree ?? 0) !== 1 || !coords.has(leafAtomId)) {
    return null;
  }

  const parentBonds = (layoutGraph.bondsByAtomId.get(leafAtomId) ?? []).filter(bond => {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || bond.inRing || (bond.order ?? 1) !== 1) {
      return false;
    }
    const parentAtomId = bond.a === leafAtomId ? bond.b : bond.a;
    const parentAtom = layoutGraph.atoms.get(parentAtomId);
    return parentAtom && parentAtom.element === 'C' && !parentAtom.aromatic && !layoutGraph.ringAtomIdSet.has(parentAtomId) && coords.has(parentAtomId);
  });
  if (parentBonds.length !== 1) {
    return null;
  }

  const parentAtomId = parentBonds[0].a === leafAtomId ? parentBonds[0].b : parentBonds[0].a;
  const hasTerminalMultipleBondHetero = (layoutGraph.bondsByAtomId.get(parentAtomId) ?? []).some(bond => {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || bond.inRing || (bond.order ?? 1) <= 1) {
      return false;
    }
    const heteroAtomId = bond.a === parentAtomId ? bond.b : bond.a;
    const heteroAtom = layoutGraph.atoms.get(heteroAtomId);
    return heteroAtom && heteroAtom.element !== 'C' && heteroAtom.element !== 'H' && !heteroAtom.aromatic && !layoutGraph.ringAtomIdSet.has(heteroAtomId) && (heteroAtom.heavyDegree ?? 0) === 1;
  });
  if (!hasTerminalMultipleBondHetero) {
    return null;
  }

  const ringAnchorAtomIds = (layoutGraph.bondsByAtomId.get(parentAtomId) ?? []).flatMap(bond => {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || bond.inRing || (bond.order ?? 1) !== 1) {
      return [];
    }
    const neighborAtomId = bond.a === parentAtomId ? bond.b : bond.a;
    return ringSystemAtomIdSet.has(neighborAtomId) ? [neighborAtomId] : [];
  });
  return ringAnchorAtomIds.length === 1 ? ringAnchorAtomIds[0] : null;
}

function compactBridgedAcylLeafRingOverlapDescriptors(layoutGraph, coords, bondLength) {
  const descriptors = [];
  const seenPairs = new Set();
  for (const overlap of findSevereOverlaps(layoutGraph, coords, bondLength)) {
    const pairKey = atomPairKey(overlap.firstAtomId, overlap.secondAtomId);
    if (seenPairs.has(pairKey) || layoutGraph.bondedPairSet.has(pairKey)) {
      continue;
    }
    seenPairs.add(pairKey);
    if ((overlap.distance ?? Number.POSITIVE_INFINITY) > bondLength * FINAL_COMPACT_BRIDGED_ACYL_LEAF_RING_OVERLAP_DISTANCE_FACTOR) {
      continue;
    }

    for (const [ringAtomId, leafAtomId] of [
      [overlap.firstAtomId, overlap.secondAtomId],
      [overlap.secondAtomId, overlap.firstAtomId]
    ]) {
      if (!isRetouchableParallelBridgedPathAtom(layoutGraph, coords, ringAtomId)) {
        continue;
      }
      const ringSystemId = layoutGraph.atomToRingSystemId.get(ringAtomId);
      const ringSystem = ringSystemId != null ? layoutGraph.ringSystemById.get(ringSystemId) : null;
      if (!ringSystem || (ringSystem.atomIds?.length ?? 0) > 16 || (ringSystem.ringIds?.length ?? 0) < 2 || !hasBridgedConnectionForRingSystem(layoutGraph, ringSystem)) {
        continue;
      }

      const ringSystemAtomIdSet = new Set(ringSystem.atomIds ?? []);
      const branchAnchorAtomId = compactBridgedAcylLeafRingAnchorAtomId(layoutGraph, coords, leafAtomId, ringSystemAtomIdSet);
      if (!branchAnchorAtomId) {
        continue;
      }

      const movedAtomIds = finalExactBridgedRingPathMoveGroup(layoutGraph, coords, ringAtomId, ringSystemAtomIdSet);
      const movedHeavyAtomIds = movedAtomIds.filter(atomId => layoutGraph.atoms.get(atomId)?.element !== 'H');
      if (!isCompactBridgedOverlapMoveGroup(layoutGraph, ringAtomId, movedHeavyAtomIds) || movedAtomIds.includes(leafAtomId) || movedAtomIds.includes(branchAnchorAtomId)) {
        continue;
      }

      descriptors.push({
        kind: 'compactBridgedAcylLeafRingRelief',
        firstAtomId: ringAtomId,
        secondAtomId: leafAtomId,
        ringAtomId,
        leafAtomId,
        branchAnchorAtomId,
        ringAtomIds: ringSystem.atomIds ?? [],
        movedAtomIds
      });
    }
  }
  return descriptors;
}

function compactBridgedTerminalMultipleBondCenterRingOverlapDescriptors(layoutGraph, coords, bondLength) {
  const descriptors = [];
  const seenPairs = new Set();
  for (const overlap of findSevereOverlaps(layoutGraph, coords, bondLength)) {
    const pairKey = atomPairKey(overlap.firstAtomId, overlap.secondAtomId);
    if (seenPairs.has(pairKey) || layoutGraph.bondedPairSet.has(pairKey)) {
      continue;
    }
    seenPairs.add(pairKey);
    if ((overlap.distance ?? Number.POSITIVE_INFINITY) > bondLength * FINAL_COMPACT_BRIDGED_TERMINAL_MULTIPLE_BOND_CENTER_RING_OVERLAP_DISTANCE_FACTOR) {
      continue;
    }

    for (const [centerAtomId, ringAtomId] of [
      [overlap.firstAtomId, overlap.secondAtomId],
      [overlap.secondAtomId, overlap.firstAtomId]
    ]) {
      const centerAtom = layoutGraph.atoms.get(centerAtomId);
      const ringAtom = layoutGraph.atoms.get(ringAtomId);
      if (
        !centerAtom ||
        centerAtom.element !== 'C' ||
        centerAtom.aromatic ||
        layoutGraph.ringAtomIdSet.has(centerAtomId) ||
        (centerAtom.heavyDegree ?? 0) !== 2 ||
        !coords.has(centerAtomId) ||
        !ringAtom ||
        ringAtom.element === 'H' ||
        ringAtom.aromatic ||
        !layoutGraph.ringAtomIdSet.has(ringAtomId) ||
        !coords.has(ringAtomId)
      ) {
        continue;
      }

      const leafAtomIds = terminalMultipleBondHeteroLeafIdsForCenter(layoutGraph, coords, centerAtomId);
      if (leafAtomIds.length !== 1) {
        continue;
      }

      const ringSystemId = layoutGraph.atomToRingSystemId.get(ringAtomId);
      const ringSystem = ringSystemId != null ? layoutGraph.ringSystemById.get(ringSystemId) : null;
      if (!ringSystem || (ringSystem.atomIds?.length ?? 0) > 16 || (ringSystem.ringIds?.length ?? 0) < 2 || !hasBridgedConnectionForRingSystem(layoutGraph, ringSystem)) {
        continue;
      }

      const ringSystemAtomIdSet = new Set(ringSystem.atomIds ?? []);
      const branchRootBonds = (layoutGraph.bondsByAtomId.get(centerAtomId) ?? []).filter(bond => {
        if (!bond || bond.kind !== 'covalent' || bond.aromatic || bond.inRing || (bond.order ?? 1) !== 1) {
          return false;
        }
        const neighborAtomId = bond.a === centerAtomId ? bond.b : bond.a;
        return ringSystemAtomIdSet.has(neighborAtomId);
      });
      if (branchRootBonds.length !== 1) {
        continue;
      }
      const rootAtomId = branchRootBonds[0].a === centerAtomId ? branchRootBonds[0].b : branchRootBonds[0].a;
      const movedAtomIds = collectFinalTerminalCarbonLeafSubtreeAtomIds(layoutGraph, centerAtomId, rootAtomId, coords);
      const movedHeavyAtomIds = movedAtomIds.filter(atomId => layoutGraph.atoms.get(atomId)?.element !== 'H');
      if (
        movedHeavyAtomIds.length < 2 ||
        movedHeavyAtomIds.length > 3 ||
        !movedHeavyAtomIds.includes(centerAtomId) ||
        !leafAtomIds.every(leafAtomId => movedHeavyAtomIds.includes(leafAtomId)) ||
        movedAtomIds.some(atomId => ringSystemAtomIdSet.has(atomId))
      ) {
        continue;
      }

      descriptors.push({
        kind: 'compactBridgedTerminalMultipleBondCenterRingRelief',
        firstAtomId: centerAtomId,
        secondAtomId: ringAtomId,
        centerAtomId,
        ringAtomId,
        rootAtomId,
        leafAtomIds,
        ringAtomIds: ringSystem.atomIds ?? [],
        movedAtomIds
      });
    }
  }
  return descriptors;
}

function attachedBridgedBranchRootForAnchor(layoutGraph, coords, ringSystemAtomIdSet, anchorAtomId) {
  const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
  if (!anchorAtom || anchorAtom.element === 'H' || !layoutGraph.ringAtomIdSet.has(anchorAtomId) || !coords.has(anchorAtomId)) {
    return null;
  }
  const rootAtomIds = (layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []).flatMap(bond => {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || bond.inRing || (bond.order ?? 1) !== 1) {
      return [];
    }
    const neighborAtomId = bond.a === anchorAtomId ? bond.b : bond.a;
    return ringSystemAtomIdSet.has(neighborAtomId) ? [neighborAtomId] : [];
  });
  return rootAtomIds.length === 1 ? rootAtomIds[0] : null;
}

function compactAttachedBridgedBranchAnchorOverlapDescriptors(layoutGraph, coords, bondLength) {
  const descriptors = [];
  const seenPairs = new Set();
  for (const overlap of findSevereOverlaps(layoutGraph, coords, bondLength)) {
    const pairKey = atomPairKey(overlap.firstAtomId, overlap.secondAtomId);
    if (seenPairs.has(pairKey) || layoutGraph.bondedPairSet.has(pairKey)) {
      continue;
    }
    seenPairs.add(pairKey);
    if ((overlap.distance ?? Number.POSITIVE_INFINITY) > bondLength * FINAL_COMPACT_ATTACHED_BRIDGED_BRANCH_ANCHOR_OVERLAP_DISTANCE_FACTOR) {
      continue;
    }

    for (const [branchAtomId, anchorAtomId] of [
      [overlap.firstAtomId, overlap.secondAtomId],
      [overlap.secondAtomId, overlap.firstAtomId]
    ]) {
      const branchAtom = layoutGraph.atoms.get(branchAtomId);
      const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
      if (
        !branchAtom ||
        branchAtom.element === 'H' ||
        branchAtom.aromatic ||
        !layoutGraph.ringAtomIdSet.has(branchAtomId) ||
        !coords.has(branchAtomId) ||
        !anchorAtom ||
        anchorAtom.element === 'H' ||
        !layoutGraph.ringAtomIdSet.has(anchorAtomId) ||
        !coords.has(anchorAtomId)
      ) {
        continue;
      }

      const ringSystemId = layoutGraph.atomToRingSystemId.get(branchAtomId);
      const anchorRingSystemId = layoutGraph.atomToRingSystemId.get(anchorAtomId);
      const ringSystem = ringSystemId != null ? layoutGraph.ringSystemById.get(ringSystemId) : null;
      if (
        !ringSystem ||
        ringSystemId === anchorRingSystemId ||
        (ringSystem.atomIds?.length ?? 0) > 16 ||
        (ringSystem.ringIds?.length ?? 0) < 2 ||
        !hasBridgedConnectionForRingSystem(layoutGraph, ringSystem)
      ) {
        continue;
      }

      const ringSystemAtomIdSet = new Set(ringSystem.atomIds ?? []);
      const rootAtomId = attachedBridgedBranchRootForAnchor(layoutGraph, coords, ringSystemAtomIdSet, anchorAtomId);
      if (!rootAtomId) {
        continue;
      }
      const movedAtomIds = collectFinalTerminalCarbonLeafSubtreeAtomIds(layoutGraph, rootAtomId, anchorAtomId, coords);
      const movedHeavyAtomIds = movedAtomIds.filter(atomId => layoutGraph.atoms.get(atomId)?.element !== 'H');
      if (
        !movedAtomIds.includes(branchAtomId) ||
        movedAtomIds.includes(anchorAtomId) ||
        movedHeavyAtomIds.length < 2 ||
        movedHeavyAtomIds.length > 16 ||
        movedHeavyAtomIds.some(atomId => {
          const atom = layoutGraph.atoms.get(atomId);
          return !atom || atom.aromatic === true || (layoutGraph.ringAtomIdSet.has(atomId) && !ringSystemAtomIdSet.has(atomId));
        })
      ) {
        continue;
      }

      descriptors.push({
        kind: 'compactAttachedBridgedBranchAnchorRelief',
        firstAtomId: branchAtomId,
        secondAtomId: anchorAtomId,
        branchAtomId,
        anchorAtomId,
        rootAtomId,
        ringAtomIds: ringSystem.atomIds ?? [],
        movedAtomIds
      });
    }
  }
  return descriptors;
}

function compactBridgedNonbondedRingOverlapDescriptors(layoutGraph, coords, bondLength) {
  const descriptors = [];
  const seenPairs = new Set();
  for (const overlap of findSevereOverlaps(layoutGraph, coords, bondLength)) {
    const firstAtomId = overlap.firstAtomId;
    const secondAtomId = overlap.secondAtomId;
    const pairKey = atomPairKey(firstAtomId, secondAtomId);
    if (seenPairs.has(pairKey) || layoutGraph.bondedPairSet.has(pairKey)) {
      continue;
    }
    seenPairs.add(pairKey);

    const firstAtom = layoutGraph.atoms.get(firstAtomId);
    const secondAtom = layoutGraph.atoms.get(secondAtomId);
    if (!firstAtom || !secondAtom || firstAtom.aromatic || secondAtom.aromatic) {
      continue;
    }
    const elementPair = [firstAtom.element, secondAtom.element].sort().join('-');
    const isCompactHeteroPair = elementPair === 'C-N' || elementPair === 'C-O' || elementPair === 'O-O';
    if (elementPair !== 'C-C' && !isCompactHeteroPair) {
      continue;
    }
    const firstRetouchable = isCompactBridgedOverlapRetouchableRingAtom(layoutGraph, coords, firstAtom, firstAtomId);
    const secondRetouchable = isCompactBridgedOverlapRetouchableRingAtom(layoutGraph, coords, secondAtom, secondAtomId);
    const firstStationaryBridgehead = isCompactBridgedOverlapStationaryBridgehead(layoutGraph, firstAtom, firstAtomId);
    const secondStationaryBridgehead = isCompactBridgedOverlapStationaryBridgehead(layoutGraph, secondAtom, secondAtomId);
    const firstStationaryHeteroJunction = isCompactBridgedOverlapStationaryHeteroJunction(layoutGraph, firstAtom, firstAtomId);
    const secondStationaryHeteroJunction = isCompactBridgedOverlapStationaryHeteroJunction(layoutGraph, secondAtom, secondAtomId);
    const isRetouchablePair = firstRetouchable && secondRetouchable;
    const isRetouchableBridgeheadPair = elementPair === 'C-C' && ((firstRetouchable && secondStationaryBridgehead) || (secondRetouchable && firstStationaryBridgehead));
    const isRetouchableHeteroJunctionPair = isCompactHeteroPair && ((firstRetouchable && secondStationaryHeteroJunction) || (secondRetouchable && firstStationaryHeteroJunction));
    if (!isRetouchablePair && !isRetouchableBridgeheadPair && !isRetouchableHeteroJunctionPair) {
      continue;
    }
    const overlapThreshold = bondLength * (isCompactHeteroPair ? FINAL_COMPACT_BRIDGED_HETERO_NONBONDED_RING_OVERLAP_DISTANCE_FACTOR : FINAL_COMPACT_BRIDGED_NONBONDED_RING_OVERLAP_DISTANCE_FACTOR);
    if ((overlap.distance ?? Number.POSITIVE_INFINITY) > overlapThreshold) {
      continue;
    }

    const firstRingSystemId = layoutGraph.atomToRingSystemId.get(firstAtomId);
    const secondRingSystemId = layoutGraph.atomToRingSystemId.get(secondAtomId);
    const ringSystem = firstRingSystemId != null && firstRingSystemId === secondRingSystemId ? layoutGraph.ringSystemById.get(firstRingSystemId) : null;
    if (!ringSystem || (ringSystem.atomIds?.length ?? 0) > 16 || (ringSystem.ringIds?.length ?? 0) < 3 || !hasBridgedConnectionForRingSystem(layoutGraph, ringSystem)) {
      continue;
    }
    const sharedRing = (layoutGraph.atomToRings.get(firstAtomId) ?? []).some(firstRing => (layoutGraph.atomToRings.get(secondAtomId) ?? []).some(secondRing => secondRing.id === firstRing.id));
    if (sharedRing) {
      continue;
    }

    const ringSystemAtomIdSet = new Set(ringSystem.atomIds ?? []);
    const firstMovedAtomIds =
      firstRetouchable && (isRetouchablePair || (!firstStationaryBridgehead && !firstStationaryHeteroJunction))
        ? finalExactBridgedRingPathMoveGroup(layoutGraph, coords, firstAtomId, ringSystemAtomIdSet)
        : [];
    const secondMovedAtomIds =
      secondRetouchable && (isRetouchablePair || (!secondStationaryBridgehead && !secondStationaryHeteroJunction))
        ? finalExactBridgedRingPathMoveGroup(layoutGraph, coords, secondAtomId, ringSystemAtomIdSet)
        : [];
    const firstMovedHeavyAtomIds = firstMovedAtomIds.filter(atomId => layoutGraph.atoms.get(atomId)?.element !== 'H');
    const secondMovedHeavyAtomIds = secondMovedAtomIds.filter(atomId => layoutGraph.atoms.get(atomId)?.element !== 'H');
    if (
      (firstRetouchable && !isCompactBridgedOverlapMoveGroup(layoutGraph, firstAtomId, firstMovedHeavyAtomIds)) ||
      (secondRetouchable && !isCompactBridgedOverlapMoveGroup(layoutGraph, secondAtomId, secondMovedHeavyAtomIds)) ||
      firstMovedAtomIds.some(atomId => secondMovedAtomIds.includes(atomId))
    ) {
      continue;
    }

    const multipleBondCenterOptions = [];
    const firstMultipleBondLeafIds = terminalMultipleBondHeteroLeafIdsForCenter(layoutGraph, coords, firstAtomId);
    const secondMultipleBondLeafIds = terminalMultipleBondHeteroLeafIdsForCenter(layoutGraph, coords, secondAtomId);
    if (firstRetouchable && secondRetouchable && firstMultipleBondLeafIds.length > 0 && firstMultipleBondLeafIds.some(leafAtomId => firstMovedAtomIds.includes(leafAtomId))) {
      multipleBondCenterOptions.push({
        centerAtomId: firstAtomId,
        ringAtomId: secondAtomId,
        centerMovedAtomIds: firstMovedAtomIds,
        ringMovedAtomIds: secondMovedAtomIds,
        leafAtomIds: firstMultipleBondLeafIds
      });
    }
    if (firstRetouchable && secondRetouchable && secondMultipleBondLeafIds.length > 0 && secondMultipleBondLeafIds.some(leafAtomId => secondMovedAtomIds.includes(leafAtomId))) {
      multipleBondCenterOptions.push({
        centerAtomId: secondAtomId,
        ringAtomId: firstAtomId,
        centerMovedAtomIds: secondMovedAtomIds,
        ringMovedAtomIds: firstMovedAtomIds,
        leafAtomIds: secondMultipleBondLeafIds
      });
    }
    if (multipleBondCenterOptions.length > 0) {
      for (const option of multipleBondCenterOptions) {
        descriptors.push({
          kind: 'compactBridgedMultipleBondCenterRelief',
          firstAtomId: option.ringAtomId,
          secondAtomId: option.centerAtomId,
          ringAtomId: option.ringAtomId,
          centerAtomId: option.centerAtomId,
          leafAtomIds: option.leafAtomIds,
          ringAtomIds: ringSystem.atomIds ?? [],
          ringMovedAtomIds: option.ringMovedAtomIds,
          centerMovedAtomIds: option.centerMovedAtomIds,
          movedAtomIds: [...new Set([...option.ringMovedAtomIds, ...option.centerMovedAtomIds])]
        });
      }
      continue;
    }
    const isNearButNotExactOverlap = (overlap.distance ?? Number.POSITIVE_INFINITY) > bondLength * FINAL_EXACT_BRIDGED_RING_PATH_OVERLAP_DISTANCE_FACTOR;
    if (isNearButNotExactOverlap && firstRetouchable && secondRetouchable) {
      descriptors.push(...compactBridgedRingPathTailReliefDescriptorsForAtom(layoutGraph, coords, ringSystem, firstAtomId, secondAtomId));
      descriptors.push(...compactBridgedRingPathTailReliefDescriptorsForAtom(layoutGraph, coords, ringSystem, secondAtomId, firstAtomId));
    }
    descriptors.push({
      firstAtomId,
      secondAtomId,
      ringAtomIds: ringSystem.atomIds ?? [],
      firstMovedAtomIds,
      secondMovedAtomIds,
      movedAtomIds: [...new Set([...firstMovedAtomIds, ...secondMovedAtomIds])]
    });
  }
  return descriptors;
}

/**
 * Finds compact bridged ring atoms, including hetero path atoms, that can be
 * nudged away from a crowded exocyclic carbon root when branch rotation cannot
 * find a clean slot.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {number} bondLength - Preferred bond length.
 * @returns {Array<object>} Existing bridged-path candidate descriptors.
 */
function compactBridgedExocyclicRootOverlapDescriptors(layoutGraph, coords, bondLength) {
  const descriptors = [];
  const seenPairs = new Set();
  for (const overlap of findSevereOverlaps(layoutGraph, coords, bondLength)) {
    const firstAtomId = overlap.firstAtomId;
    const secondAtomId = overlap.secondAtomId;
    const pairKey = atomPairKey(firstAtomId, secondAtomId);
    if (seenPairs.has(pairKey) || layoutGraph.bondedPairSet.has(pairKey)) {
      continue;
    }
    seenPairs.add(pairKey);

    const firstAtom = layoutGraph.atoms.get(firstAtomId);
    const secondAtom = layoutGraph.atoms.get(secondAtomId);
    if (!firstAtom || !secondAtom || firstAtom.aromatic || secondAtom.aromatic) {
      continue;
    }
    const elementPair = [firstAtom.element, secondAtom.element].sort().join('-');
    if (elementPair !== 'C-C' && elementPair !== 'C-N' && elementPair !== 'C-O') {
      continue;
    }
    const firstRetouchable = isCompactBridgedOverlapRetouchableRingAtom(layoutGraph, coords, firstAtom, firstAtomId);
    const secondRetouchable = isCompactBridgedOverlapRetouchableRingAtom(layoutGraph, coords, secondAtom, secondAtomId);
    if (firstRetouchable === secondRetouchable) {
      continue;
    }
    const ringAtomId = firstRetouchable ? firstAtomId : secondAtomId;
    const branchAtomId = firstRetouchable ? secondAtomId : firstAtomId;
    const branchAtom = layoutGraph.atoms.get(branchAtomId);
    if (!isCompactBridgedExocyclicRootOverlapBranchAtom(layoutGraph, branchAtom, branchAtomId)) {
      continue;
    }
    const overlapThreshold = bondLength * (elementPair === 'C-C' ? FINAL_COMPACT_BRIDGED_NONBONDED_RING_OVERLAP_DISTANCE_FACTOR : FINAL_COMPACT_BRIDGED_HETERO_NONBONDED_RING_OVERLAP_DISTANCE_FACTOR);
    if ((overlap.distance ?? Number.POSITIVE_INFINITY) > overlapThreshold) {
      continue;
    }

    const ringSystemId = layoutGraph.atomToRingSystemId.get(ringAtomId);
    const ringSystem = ringSystemId != null ? layoutGraph.ringSystemById.get(ringSystemId) : null;
    if (!ringSystem || (ringSystem.atomIds?.length ?? 0) > 16 || (ringSystem.ringIds?.length ?? 0) < 2 || !hasBridgedConnectionForRingSystem(layoutGraph, ringSystem)) {
      continue;
    }
    const ringSystemAtomIdSet = new Set(ringSystem.atomIds ?? []);
    const branchTouchesRingSystem = (layoutGraph.bondsByAtomId.get(branchAtomId) ?? []).some(bond => {
      if (!bond || bond.kind !== 'covalent' || bond.aromatic || bond.inRing) {
        return false;
      }
      const bondOrder = bond.order ?? 1;
      if (bondOrder !== 1 && !(bondOrder > 1 && isCompactBridgedExocyclicRootOverlapRingMultipleBondBranchAtom(layoutGraph, branchAtom, branchAtomId))) {
        return false;
      }
      const neighborAtomId = bond.a === branchAtomId ? bond.b : bond.a;
      return ringSystemAtomIdSet.has(neighborAtomId);
    });
    if (!branchTouchesRingSystem) {
      continue;
    }

    const movedAtomIds = finalExactBridgedRingPathMoveGroup(layoutGraph, coords, ringAtomId, ringSystemAtomIdSet);
    const movedHeavyAtomIds = movedAtomIds.filter(atomId => layoutGraph.atoms.get(atomId)?.element !== 'H');
    if (!isCompactBridgedOverlapMoveGroup(layoutGraph, ringAtomId, movedHeavyAtomIds)) {
      continue;
    }

    descriptors.push({
      firstAtomId: branchAtomId,
      secondAtomId: ringAtomId,
      ringAtomIds: ringSystem.atomIds ?? [],
      firstMovedAtomIds: [],
      secondMovedAtomIds: movedAtomIds,
      movedAtomIds
    });
  }
  return descriptors;
}

function hasTerminalSingleHeteroLeaf(layoutGraph, atomId) {
  return (layoutGraph.bondsByAtomId.get(atomId) ?? []).some(bond => {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || bond.inRing || (bond.order ?? 1) !== 1) {
      return false;
    }
    const leafAtomId = bond.a === atomId ? bond.b : bond.a;
    const leafAtom = layoutGraph.atoms.get(leafAtomId);
    return (
      leafAtom &&
      FINAL_TERMINAL_SINGLE_HETERO_MULTIPLE_BOND_LEAF_ELEMENTS.has(leafAtom.element) &&
      !leafAtom.aromatic &&
      (leafAtom.heavyDegree ?? 0) === 1 &&
      !layoutGraph.ringAtomIdSet.has(leafAtomId)
    );
  });
}

function isCompactBridgedExocyclicRootOverlapRingMultipleBondBranchAtom(layoutGraph, branchAtom, branchAtomId) {
  return Boolean(branchAtom && branchAtom.element === 'N' && !branchAtom.aromatic && (branchAtom.heavyDegree ?? 0) === 2 && hasTerminalSingleHeteroLeaf(layoutGraph, branchAtomId));
}

function isCompactBridgedExocyclicRootOverlapBranchAtom(layoutGraph, branchAtom, branchAtomId) {
  if (!branchAtom || layoutGraph.ringAtomIdSet.has(branchAtomId)) {
    return false;
  }
  if (branchAtom.element === 'N') {
    if (branchAtom.aromatic || (branchAtom.heavyDegree ?? 0) !== 2) {
      return false;
    }
    const hasAcyclicMultipleCarbonRoot = (layoutGraph.bondsByAtomId.get(branchAtomId) ?? []).some(bond => {
      if (!bond || bond.kind !== 'covalent' || bond.aromatic || bond.inRing || (bond.order ?? 1) <= 1) {
        return false;
      }
      const neighborAtomId = bond.a === branchAtomId ? bond.b : bond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      return neighborAtom && neighborAtom.element === 'C' && !neighborAtom.aromatic && !layoutGraph.ringAtomIdSet.has(neighborAtomId);
    });
    const hasRingMultipleBond = (layoutGraph.bondsByAtomId.get(branchAtomId) ?? []).some(bond => {
      if (!bond || bond.kind !== 'covalent' || bond.aromatic || bond.inRing || (bond.order ?? 1) <= 1) {
        return false;
      }
      const neighborAtomId = bond.a === branchAtomId ? bond.b : bond.a;
      return layoutGraph.ringAtomIdSet.has(neighborAtomId);
    });
    return hasAcyclicMultipleCarbonRoot || (hasRingMultipleBond && hasTerminalSingleHeteroLeaf(layoutGraph, branchAtomId));
  }
  if (branchAtom.element !== 'C') {
    return false;
  }
  const heavyDegree = branchAtom.heavyDegree ?? 0;
  if (heavyDegree <= 2) {
    return true;
  }
  if (heavyDegree !== 3) {
    return false;
  }
  return (layoutGraph.bondsByAtomId.get(branchAtomId) ?? []).some(bond => {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || bond.inRing || (bond.order ?? 1) <= 1) {
      return false;
    }
    const neighborAtomId = bond.a === branchAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    return neighborAtom && neighborAtom.element !== 'C' && neighborAtom.element !== 'H' && !neighborAtom.aromatic && (neighborAtom.heavyDegree ?? 0) === 1;
  });
}

function terminalMultipleBondHeteroLeafCenterAtomId(layoutGraph, coords, leafAtomId) {
  const leafAtom = layoutGraph.atoms.get(leafAtomId);
  if (
    !leafAtom ||
    leafAtom.element === 'C' ||
    leafAtom.element === 'H' ||
    leafAtom.aromatic ||
    (leafAtom.heavyDegree ?? 0) !== 1 ||
    layoutGraph.ringAtomIdSet.has(leafAtomId) ||
    !coords.has(leafAtomId)
  ) {
    return null;
  }
  const centerBonds = (layoutGraph.bondsByAtomId.get(leafAtomId) ?? []).filter(bond => {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || bond.inRing || (bond.order ?? 1) <= 1) {
      return false;
    }
    const centerAtomId = bond.a === leafAtomId ? bond.b : bond.a;
    const centerAtom = layoutGraph.atoms.get(centerAtomId);
    return centerAtom && centerAtom.element !== 'H' && !centerAtom.aromatic && coords.has(centerAtomId);
  });
  if (centerBonds.length !== 1) {
    return null;
  }
  return centerBonds[0].a === leafAtomId ? centerBonds[0].b : centerBonds[0].a;
}

/**
 * Finds compact bridged ring-path atoms that can move slightly away from a
 * terminal multiple-bond hetero leaf attached to the same cage.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {number} bondLength - Preferred bond length.
 * @returns {Array<object>} Candidate descriptors.
 */
function compactBridgedTerminalMultipleBondLeafOverlapDescriptors(layoutGraph, coords, bondLength) {
  const descriptors = [];
  const seenPairs = new Set();
  for (const overlap of findSevereOverlaps(layoutGraph, coords, bondLength)) {
    const pairKey = atomPairKey(overlap.firstAtomId, overlap.secondAtomId);
    if (seenPairs.has(pairKey) || layoutGraph.bondedPairSet.has(pairKey)) {
      continue;
    }
    seenPairs.add(pairKey);

    for (const [ringAtomId, leafAtomId] of [
      [overlap.firstAtomId, overlap.secondAtomId],
      [overlap.secondAtomId, overlap.firstAtomId]
    ]) {
      const ringAtom = layoutGraph.atoms.get(ringAtomId);
      if (!isCompactBridgedOverlapRetouchableRingAtom(layoutGraph, coords, ringAtom, ringAtomId)) {
        continue;
      }
      const leafCenterAtomId = terminalMultipleBondHeteroLeafCenterAtomId(layoutGraph, coords, leafAtomId);
      if (!leafCenterAtomId) {
        continue;
      }
      if ((overlap.distance ?? Number.POSITIVE_INFINITY) > bondLength * FINAL_COMPACT_BRIDGED_HETERO_NONBONDED_RING_OVERLAP_DISTANCE_FACTOR) {
        continue;
      }

      const ringSystemId = layoutGraph.atomToRingSystemId.get(ringAtomId);
      const ringSystem = ringSystemId != null ? layoutGraph.ringSystemById.get(ringSystemId) : null;
      if (
        !ringSystem ||
        (ringSystem.atomIds?.length ?? 0) > 16 ||
        (ringSystem.ringIds?.length ?? 0) < 2 ||
        !hasBridgedConnectionForRingSystem(layoutGraph, ringSystem) ||
        !(ringSystem.atomIds ?? []).includes(leafCenterAtomId)
      ) {
        continue;
      }

      const ringSystemAtomIdSet = new Set(ringSystem.atomIds ?? []);
      const movedAtomIds = finalExactBridgedRingPathMoveGroup(layoutGraph, coords, ringAtomId, ringSystemAtomIdSet);
      const movedHeavyAtomIds = movedAtomIds.filter(atomId => layoutGraph.atoms.get(atomId)?.element !== 'H');
      if (!isCompactBridgedOverlapMoveGroup(layoutGraph, ringAtomId, movedHeavyAtomIds) || movedAtomIds.includes(leafAtomId)) {
        continue;
      }

      descriptors.push({
        kind: 'compactTerminalMultipleBondLeafRelief',
        firstAtomId: ringAtomId,
        secondAtomId: leafAtomId,
        leafAtomId,
        ringAtomIds: ringSystem.atomIds ?? [],
        movedAtomIds
      });
    }
  }
  return descriptors;
}

/**
 * Returns whether a ring system is a compact fused/spiro cage suitable for
 * one-sided final ring-atom overlap relief.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object|null} ringSystem - Candidate ring-system descriptor.
 * @returns {boolean} True when the ring system has connected fused and spiro blocks.
 */
function hasCompactFusedSpiroCageRingSystem(layoutGraph, ringSystem) {
  if (!ringSystem || (ringSystem.atomIds?.length ?? 0) > 16 || (ringSystem.ringIds?.length ?? 0) < 3) {
    return false;
  }
  const ringIds = new Set(ringSystem.ringIds ?? []);
  let fusedConnectionCount = 0;
  let spiroConnectionCount = 0;
  for (const connection of layoutGraph.ringConnections ?? []) {
    if (!ringIds.has(connection.firstRingId) || !ringIds.has(connection.secondRingId)) {
      continue;
    }
    if (connection.kind === 'fused') {
      fusedConnectionCount += 1;
    } else if (connection.kind === 'spiro') {
      spiroConnectionCount += 1;
    }
  }
  return fusedConnectionCount >= 1 && spiroConnectionCount >= 1 && fusedConnectionCount + spiroConnectionCount >= ringIds.size - 1;
}

/**
 * Finds one-sided nudges for compact fused-spiro ring systems where nonbonded
 * ring atoms collapse onto one another after an otherwise bond-clean layout.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {number} bondLength - Preferred bond length.
 * @returns {Array<object>} Existing bridged-path candidate descriptors.
 */
function compactFusedSpiroNonbondedRingOverlapDescriptors(layoutGraph, coords, bondLength) {
  const descriptors = [];
  const seenDescriptors = new Set();
  for (const overlap of findSevereOverlaps(layoutGraph, coords, bondLength)) {
    const firstAtomId = overlap.firstAtomId;
    const secondAtomId = overlap.secondAtomId;
    const pairKey = atomPairKey(firstAtomId, secondAtomId);
    if (layoutGraph.bondedPairSet.has(pairKey)) {
      continue;
    }

    const firstAtom = layoutGraph.atoms.get(firstAtomId);
    const secondAtom = layoutGraph.atoms.get(secondAtomId);
    if (!firstAtom || !secondAtom || firstAtom.aromatic || secondAtom.aromatic) {
      continue;
    }
    const elementPair = [firstAtom.element, secondAtom.element].sort().join('-');
    if (elementPair !== 'C-C' && elementPair !== 'C-N' && elementPair !== 'N-N') {
      continue;
    }
    const overlapThreshold = bondLength * FINAL_COMPACT_BRIDGED_HETERO_NONBONDED_RING_OVERLAP_DISTANCE_FACTOR;
    if ((overlap.distance ?? Number.POSITIVE_INFINITY) > overlapThreshold) {
      continue;
    }

    const firstRingSystemId = layoutGraph.atomToRingSystemId.get(firstAtomId);
    const secondRingSystemId = layoutGraph.atomToRingSystemId.get(secondAtomId);
    const ringSystem = firstRingSystemId != null && firstRingSystemId === secondRingSystemId ? layoutGraph.ringSystemById.get(firstRingSystemId) : null;
    if (!hasCompactFusedSpiroCageRingSystem(layoutGraph, ringSystem)) {
      continue;
    }
    const sharedRing = (layoutGraph.atomToRings.get(firstAtomId) ?? []).some(firstRing => (layoutGraph.atomToRings.get(secondAtomId) ?? []).some(secondRing => secondRing.id === firstRing.id));
    if (sharedRing) {
      continue;
    }

    const ringSystemAtomIdSet = new Set(ringSystem.atomIds ?? []);
    for (const [movingAtomId, stationaryAtomId, movingAtom] of [
      [firstAtomId, secondAtomId, firstAtom],
      [secondAtomId, firstAtomId, secondAtom]
    ]) {
      if (!isCompactBridgedOverlapRetouchableRingAtom(layoutGraph, coords, movingAtom, movingAtomId)) {
        continue;
      }
      const movedAtomIds = finalExactBridgedRingPathMoveGroup(layoutGraph, coords, movingAtomId, ringSystemAtomIdSet);
      const movedHeavyAtomIds = movedAtomIds.filter(atomId => layoutGraph.atoms.get(atomId)?.element !== 'H');
      if (!isCompactBridgedOverlapMoveGroup(layoutGraph, movingAtomId, movedHeavyAtomIds)) {
        continue;
      }
      const descriptorKey = `${movingAtomId}:${stationaryAtomId}:${movedHeavyAtomIds.join(',')}`;
      if (seenDescriptors.has(descriptorKey)) {
        continue;
      }
      seenDescriptors.add(descriptorKey);
      descriptors.push({
        firstAtomId: movingAtomId,
        secondAtomId: stationaryAtomId,
        ringAtomIds: ringSystem.atomIds ?? [],
        firstMovedAtomIds: movedAtomIds,
        secondMovedAtomIds: [],
        movedAtomIds
      });
    }
  }
  return descriptors;
}

function hasCompactFusedCageRingSystem(layoutGraph, ringSystem) {
  if (!ringSystem || (ringSystem.atomIds?.length ?? 0) > 18 || (ringSystem.ringIds?.length ?? 0) < 3) {
    return false;
  }
  const ringIds = new Set(ringSystem.ringIds ?? []);
  const fusedConnectionCount = (layoutGraph.ringConnections ?? []).filter(
    connection => connection.kind === 'fused' && ringIds.has(connection.firstRingId) && ringIds.has(connection.secondRingId)
  ).length;
  return fusedConnectionCount >= ringIds.size;
}

function compactFusedPeripheralRingPathShiftDescriptors(layoutGraph, coords, bondLength) {
  if (!hasSevereOverlaps(layoutGraph, coords, bondLength) && countVisibleHeavyBondCrossings(layoutGraph, coords) === 0) {
    return [];
  }

  const descriptors = [];
  const seenDescriptors = new Set();
  const crossingBondIds = new Set();
  for (const crossing of findVisibleHeavyBondCrossings(layoutGraph, coords)) {
    crossingBondIds.add(crossing.firstBondId);
    crossingBondIds.add(crossing.secondBondId);
  }
  const overlapAtomIds = collectSevereOverlapAtomIds(layoutGraph, coords, bondLength);
  for (const ring of layoutGraph.rings ?? []) {
    if (ring.aromatic || ring.atomIds.length < 5 || ring.atomIds.length > 6 || !ring.atomIds.every(atomId => coords.has(atomId))) {
      continue;
    }
    const ringSystemId = layoutGraph.atomToRingSystemId.get(ring.atomIds[0]);
    const ringSystem = ringSystemId != null ? layoutGraph.ringSystemById.get(ringSystemId) : null;
    if (!hasCompactFusedCageRingSystem(layoutGraph, ringSystem)) {
      continue;
    }
    const uniqueRingAtomIds = ring.atomIds.filter(atomId => {
      const atom = layoutGraph.atoms.get(atomId);
      return atom && atom.element !== 'H' && atom.aromatic !== true && (atom.heavyDegree ?? 0) <= 2 && (layoutGraph.ringCountByAtomId.get(atomId) ?? 0) === 1;
    });
    if (uniqueRingAtomIds.length !== 2 || !uniqueRingAtomIds.some(atomId => overlapAtomIds.has(atomId))) {
      continue;
    }
    const orderedPair = orderedAdjacentRingAtomPair(ring, uniqueRingAtomIds[0], uniqueRingAtomIds[1]);
    if (!orderedPair) {
      continue;
    }
    const pathBond = layoutGraph.bondByAtomPair.get(atomPairKey(orderedPair[0], orderedPair[1]));
    if (!pathBond || !crossingBondIds.has(pathBond.id)) {
      continue;
    }
    const ringAtomIdSet = new Set(ringSystem?.atomIds ?? ring.atomIds);
    const firstMovedAtomIds = finalExactBridgedRingPathMoveGroup(layoutGraph, coords, orderedPair[0], ringAtomIdSet);
    const secondMovedAtomIds = finalExactBridgedRingPathMoveGroup(layoutGraph, coords, orderedPair[1], ringAtomIdSet);
    const movedAtomIds = [...new Set([...firstMovedAtomIds, ...secondMovedAtomIds])];
    const movedHeavyAtomIds = movedAtomIds.filter(atomId => layoutGraph.atoms.get(atomId)?.element !== 'H');
    if (firstMovedAtomIds.some(atomId => secondMovedAtomIds.includes(atomId)) || movedHeavyAtomIds.length !== 2 || !orderedPair.every(atomId => movedHeavyAtomIds.includes(atomId))) {
      continue;
    }
    const descriptorKey = `${ring.id}:${orderedPair.join(':')}`;
    if (seenDescriptors.has(descriptorKey)) {
      continue;
    }
    seenDescriptors.add(descriptorKey);
    descriptors.push({
      kind: 'compactFusedPathShift',
      firstAtomId: orderedPair[0],
      secondAtomId: orderedPair[1],
      ringAtomIds: ringSystem?.atomIds ?? ring.atomIds,
      movedAtomIds
    });
  }
  return descriptors;
}

function isCompactBridgedOverlapRetouchableRingAtom(layoutGraph, coords, atom, atomId) {
  return atom && atom.element !== 'H' && atom.aromatic !== true && coords.has(atomId) && (atom.heavyDegree ?? 0) <= 3 && (layoutGraph.ringCountByAtomId.get(atomId) ?? 0) === 1;
}

function isCompactBridgedOverlapStationaryBridgehead(layoutGraph, atom, atomId) {
  const ringCount = layoutGraph.ringCountByAtomId.get(atomId) ?? 0;
  const heavyDegree = atom?.heavyDegree ?? 0;
  return atom && atom.element === 'C' && atom.aromatic !== true && ringCount >= 2 && heavyDegree >= 3 && heavyDegree <= 4;
}

function isCompactBridgedOverlapStationaryHeteroJunction(layoutGraph, atom, atomId) {
  const ringCount = layoutGraph.ringCountByAtomId.get(atomId) ?? 0;
  const heavyDegree = atom?.heavyDegree ?? 0;
  return atom && (atom.element === 'N' || atom.element === 'O') && atom.aromatic !== true && ringCount >= 2 && heavyDegree >= 2 && heavyDegree <= 3;
}

function isCompactBridgedOverlapMoveGroup(layoutGraph, rootAtomId, movedHeavyAtomIds) {
  if (movedHeavyAtomIds.length < 1 || movedHeavyAtomIds.length > 3 || movedHeavyAtomIds[0] !== rootAtomId) {
    return false;
  }
  for (const movedAtomId of movedHeavyAtomIds.slice(1)) {
    const atom = layoutGraph.atoms.get(movedAtomId);
    if (!atom || atom.element === 'H' || layoutGraph.ringAtomIdSet.has(movedAtomId) || (layoutGraph.ringCountByAtomId.get(movedAtomId) ?? 0) !== 0 || (atom.heavyDegree ?? 0) > 2) {
      return false;
    }
  }
  return true;
}

function bridgedRingUniquePathRuns(ring, sharedAtomIdSet) {
  const atomIds = ring?.atomIds ?? [];
  const runs = [];
  if (atomIds.length === 0 || atomIds.every(atomId => !sharedAtomIdSet.has(atomId))) {
    return runs;
  }
  for (let index = 0; index < atomIds.length; index += 1) {
    const atomId = atomIds[index];
    const previousAtomId = atomIds[(index - 1 + atomIds.length) % atomIds.length];
    if (sharedAtomIdSet.has(atomId) || !sharedAtomIdSet.has(previousAtomId)) {
      continue;
    }
    const pathAtomIds = [];
    let cursor = index;
    while (!sharedAtomIdSet.has(atomIds[cursor % atomIds.length]) && pathAtomIds.length <= atomIds.length) {
      pathAtomIds.push(atomIds[cursor % atomIds.length]);
      cursor += 1;
    }
    const endAtomId = atomIds[cursor % atomIds.length];
    if (sharedAtomIdSet.has(endAtomId)) {
      runs.push({
        startAtomId: previousAtomId,
        endAtomId,
        pathAtomIds
      });
    }
  }
  return runs;
}

function orderedPathAtomIdsForEndpoints(run, firstEndpointAtomId, secondEndpointAtomId) {
  if (!run) {
    return null;
  }
  if (run.startAtomId === firstEndpointAtomId && run.endAtomId === secondEndpointAtomId) {
    return run.pathAtomIds;
  }
  if (run.startAtomId === secondEndpointAtomId && run.endAtomId === firstEndpointAtomId) {
    return [...run.pathAtomIds].reverse();
  }
  return null;
}

function isRetouchableParallelBridgedPathAtom(layoutGraph, coords, atomId) {
  const atom = layoutGraph.atoms.get(atomId);
  return atom && atom.element !== 'H' && atom.aromatic !== true && coords.has(atomId) && (atom.heavyDegree ?? 0) === 2 && (layoutGraph.ringCountByAtomId.get(atomId) ?? 0) === 1;
}

function pathMoveGroupsForParallelBridgedPath(layoutGraph, coords, pathAtomIds, ringAtomIdSet) {
  const groups = [];
  const seenAtomIds = new Set();
  for (const atomId of pathAtomIds) {
    const group = finalExactBridgedRingPathMoveGroup(layoutGraph, coords, atomId, ringAtomIdSet);
    const heavyAtomIds = group.filter(movedAtomId => layoutGraph.atoms.get(movedAtomId)?.element !== 'H');
    if (heavyAtomIds.length !== 1 || heavyAtomIds[0] !== atomId || group.some(movedAtomId => seenAtomIds.has(movedAtomId))) {
      return null;
    }
    for (const movedAtomId of group) {
      seenAtomIds.add(movedAtomId);
    }
    groups.push(group);
  }
  return groups;
}

function parallelBridgedRingPathOverlapDescriptors(layoutGraph, coords, bondLength) {
  const exactOverlapPairs = new Set();
  const exactOverlapThreshold = bondLength * FINAL_EXACT_BRIDGED_RING_PATH_OVERLAP_DISTANCE_FACTOR;
  for (const overlap of findSevereOverlaps(layoutGraph, coords, bondLength)) {
    if ((overlap.distance ?? Number.POSITIVE_INFINITY) <= exactOverlapThreshold) {
      exactOverlapPairs.add(atomPairKey(overlap.firstAtomId, overlap.secondAtomId));
    }
  }
  if (exactOverlapPairs.size < 3) {
    return [];
  }

  const descriptors = [];
  const seenDescriptors = new Set();
  const ringById = layoutGraph.ringById ?? new Map((layoutGraph.rings ?? []).map(ring => [ring.id, ring]));
  for (const connection of layoutGraph.ringConnections ?? []) {
    if (connection.kind !== 'bridged' || (connection.sharedAtomIds?.length ?? 0) < 3) {
      continue;
    }
    const firstRing = ringById.get(connection.firstRingId);
    const secondRing = ringById.get(connection.secondRingId);
    if (!firstRing || !secondRing || firstRing.aromatic || secondRing.aromatic) {
      continue;
    }
    const sharedAtomIdSet = new Set(connection.sharedAtomIds ?? []);
    const firstRuns = bridgedRingUniquePathRuns(firstRing, sharedAtomIdSet);
    const secondRuns = bridgedRingUniquePathRuns(secondRing, sharedAtomIdSet);
    for (const firstRun of firstRuns) {
      if (firstRun.pathAtomIds.length < FINAL_PARALLEL_BRIDGED_RING_PATH_MIN_ATOM_COUNT || firstRun.pathAtomIds.length > FINAL_PARALLEL_BRIDGED_RING_PATH_MAX_ATOM_COUNT) {
        continue;
      }
      const firstEndpointAtomId = firstRun.startAtomId;
      const secondEndpointAtomId = firstRun.endAtomId;
      if (!coords.has(firstEndpointAtomId) || !coords.has(secondEndpointAtomId)) {
        continue;
      }
      for (const secondRun of secondRuns) {
        const firstPathAtomIds = orderedPathAtomIdsForEndpoints(firstRun, firstEndpointAtomId, secondEndpointAtomId);
        const secondPathAtomIds = orderedPathAtomIdsForEndpoints(secondRun, firstEndpointAtomId, secondEndpointAtomId);
        if (!firstPathAtomIds || !secondPathAtomIds || secondPathAtomIds.length !== firstPathAtomIds.length) {
          continue;
        }
        if (
          !firstPathAtomIds.every(atomId => isRetouchableParallelBridgedPathAtom(layoutGraph, coords, atomId)) ||
          !secondPathAtomIds.every(atomId => isRetouchableParallelBridgedPathAtom(layoutGraph, coords, atomId))
        ) {
          continue;
        }
        const hasExactStackedPath = firstPathAtomIds.every((atomId, index) => exactOverlapPairs.has(atomPairKey(atomId, secondPathAtomIds[index])));
        if (!hasExactStackedPath) {
          continue;
        }

        const ringSystemId = layoutGraph.atomToRingSystemId.get(firstEndpointAtomId);
        const ringSystem = ringSystemId != null ? layoutGraph.ringSystemById.get(ringSystemId) : null;
        if (!ringSystem || (ringSystem.atomIds?.length ?? 0) > 16) {
          continue;
        }
        const ringAtomIds = ringSystem.atomIds ?? [...new Set([...firstRing.atomIds, ...secondRing.atomIds])];
        const ringAtomIdSet = new Set(ringAtomIds);
        const firstPathMovedAtomIdGroups = pathMoveGroupsForParallelBridgedPath(layoutGraph, coords, firstPathAtomIds, ringAtomIdSet);
        const secondPathMovedAtomIdGroups = pathMoveGroupsForParallelBridgedPath(layoutGraph, coords, secondPathAtomIds, ringAtomIdSet);
        if (!firstPathMovedAtomIdGroups || !secondPathMovedAtomIdGroups) {
          continue;
        }
        for (const [pathAtomIds, pathMovedAtomIdGroups, oppositePathMovedAtomIdGroups] of [
          [firstPathAtomIds, firstPathMovedAtomIdGroups, secondPathMovedAtomIdGroups],
          [secondPathAtomIds, secondPathMovedAtomIdGroups, firstPathMovedAtomIdGroups]
        ]) {
          const descriptorKey = `${firstEndpointAtomId}:${secondEndpointAtomId}:${pathAtomIds.join(',')}`;
          if (seenDescriptors.has(descriptorKey)) {
            continue;
          }
          seenDescriptors.add(descriptorKey);
          const movesBothParallelPaths = pathAtomIds.length >= 4;
          const movedAtomIds = [...new Set([...(movesBothParallelPaths ? oppositePathMovedAtomIdGroups.flat() : []), ...pathMovedAtomIdGroups.flat()])];
          descriptors.push({
            kind: 'parallelBridgedPath',
            firstAtomId: pathAtomIds[0],
            secondAtomId: pathAtomIds[pathAtomIds.length - 1],
            endpointAtomIds: [firstEndpointAtomId, secondEndpointAtomId],
            pathAtomIds,
            pathMovedAtomIdGroups,
            oppositePathMovedAtomIdGroups,
            ringAtomIds,
            movedAtomIds
          });
        }
      }
    }
  }
  return descriptors;
}

function singleAtomBridgedRingPathOverlapDescriptors(layoutGraph, coords, exactOverlapPairs) {
  if (!exactOverlapPairs || exactOverlapPairs.size === 0) {
    return [];
  }
  const descriptors = [];
  const seenDescriptors = new Set();
  const ringById = layoutGraph.ringById ?? new Map((layoutGraph.rings ?? []).map(ring => [ring.id, ring]));
  for (const connection of layoutGraph.ringConnections ?? []) {
    if (connection.kind !== 'bridged' || (connection.sharedAtomIds?.length ?? 0) < 3) {
      continue;
    }
    const sharedAtomIdSet = new Set(connection.sharedAtomIds ?? []);
    for (const ringId of [connection.firstRingId, connection.secondRingId]) {
      const ring = ringById.get(ringId);
      if (!ring || ring.aromatic || ring.atomIds.length < 4 || ring.atomIds.length > 6 || !ring.atomIds.every(atomId => coords.has(atomId))) {
        continue;
      }
      const uniqueRingAtomIds = ring.atomIds.filter(atomId => !sharedAtomIdSet.has(atomId));
      if (uniqueRingAtomIds.length !== 1) {
        continue;
      }
      const atomId = uniqueRingAtomIds[0];
      if (!isRetouchableParallelBridgedPathAtom(layoutGraph, coords, atomId)) {
        continue;
      }
      const blockerAtomId = [...sharedAtomIdSet].find(sharedAtomId => exactOverlapPairs.has(atomPairKey(atomId, sharedAtomId)));
      if (!blockerAtomId || !coords.has(blockerAtomId)) {
        continue;
      }
      const atomIndex = ring.atomIds.indexOf(atomId);
      const endpointAtomIds = [ring.atomIds[(atomIndex - 1 + ring.atomIds.length) % ring.atomIds.length], ring.atomIds[(atomIndex + 1) % ring.atomIds.length]];
      if (!endpointAtomIds.every(endpointAtomId => sharedAtomIdSet.has(endpointAtomId) && coords.has(endpointAtomId))) {
        continue;
      }

      const descriptorKey = `${ring.id}:${atomId}:${blockerAtomId}:${endpointAtomIds.join(',')}`;
      if (seenDescriptors.has(descriptorKey)) {
        continue;
      }
      seenDescriptors.add(descriptorKey);
      const ringAtomIdSet = new Set(ring.atomIds);
      const movedAtomIds = finalExactBridgedRingPathMoveGroup(layoutGraph, coords, atomId, ringAtomIdSet);
      const movedHeavyAtomIds = movedAtomIds.filter(movedAtomId => layoutGraph.atoms.get(movedAtomId)?.element !== 'H');
      if (movedHeavyAtomIds.length !== 1 || movedHeavyAtomIds[0] !== atomId) {
        continue;
      }
      const ringSystemId = layoutGraph.atomToRingSystemId.get(atomId);
      const ringSystem = ringSystemId != null ? layoutGraph.ringSystemById.get(ringSystemId) : null;
      descriptors.push({
        kind: 'singleBridgedPathAtom',
        atomId,
        blockerAtomId,
        firstAtomId: atomId,
        secondAtomId: blockerAtomId,
        endpointAtomIds,
        ringAtomIds: ringSystem?.atomIds ?? ring.atomIds,
        movedAtomIds
      });
    }
  }
  return descriptors;
}

function terminalBlockedBridgedRingPathAtomOverlapDescriptors(layoutGraph, coords, exactOverlapPairs) {
  if (!exactOverlapPairs || exactOverlapPairs.size === 0) {
    return [];
  }
  const descriptors = [];
  const seenDescriptors = new Set();
  for (const pairKey of exactOverlapPairs) {
    const [firstAtomId, secondAtomId] = pairKey.split(':');
    for (const [atomId, blockerAtomId] of [
      [firstAtomId, secondAtomId],
      [secondAtomId, firstAtomId]
    ]) {
      if (!isRetouchableParallelBridgedPathAtom(layoutGraph, coords, atomId)) {
        continue;
      }
      const blockerAtom = layoutGraph.atoms.get(blockerAtomId);
      if (!blockerAtom || blockerAtom.element === 'H' || blockerAtom.aromatic === true || layoutGraph.ringAtomIdSet.has(blockerAtomId) || (blockerAtom.heavyDegree ?? 0) !== 1) {
        continue;
      }
      const ringSystemId = layoutGraph.atomToRingSystemId.get(atomId);
      const ringSystem = ringSystemId != null ? layoutGraph.ringSystemById.get(ringSystemId) : null;
      if (!ringSystem || (ringSystem.atomIds?.length ?? 0) > 14 || !hasBridgedConnectionForRingSystem(layoutGraph, ringSystem)) {
        continue;
      }
      const ringAtomIdSet = new Set(ringSystem.atomIds ?? []);
      const movedAtomIds = finalExactBridgedRingPathMoveGroup(layoutGraph, coords, atomId, ringAtomIdSet);
      const movedHeavyAtomIds = movedAtomIds.filter(movedAtomId => layoutGraph.atoms.get(movedAtomId)?.element !== 'H');
      if (!isCompactBridgedOverlapMoveGroup(layoutGraph, atomId, movedHeavyAtomIds)) {
        continue;
      }

      for (const ring of layoutGraph.atomToRings.get(atomId) ?? []) {
        if (!ring || ring.aromatic || !hasBridgedConnectionForRing(layoutGraph, ring)) {
          continue;
        }
        const atomIndex = ring.atomIds.indexOf(atomId);
        if (atomIndex < 0) {
          continue;
        }
        const endpointAtomIds = [ring.atomIds[(atomIndex - 1 + ring.atomIds.length) % ring.atomIds.length], ring.atomIds[(atomIndex + 1) % ring.atomIds.length]];
        if (!endpointAtomIds.every(endpointAtomId => coords.has(endpointAtomId) && layoutGraph.bondedPairSet.has(atomPairKey(atomId, endpointAtomId)))) {
          continue;
        }
        const descriptorKey = `${ring.id}:${atomId}:${blockerAtomId}:${endpointAtomIds.join(',')}`;
        if (seenDescriptors.has(descriptorKey)) {
          continue;
        }
        seenDescriptors.add(descriptorKey);
        descriptors.push({
          kind: 'singleBridgedPathAtom',
          atomId,
          blockerAtomId,
          firstAtomId: atomId,
          secondAtomId: blockerAtomId,
          endpointAtomIds,
          ringAtomIds: ringSystem.atomIds ?? ring.atomIds,
          movedAtomIds
        });
      }
    }
  }
  return descriptors;
}

function finalExactBridgedRingPathOverlapDescriptors(layoutGraph, coords, bondLength) {
  const visibleHeavyAtomCount = [...coords.keys()].filter(atomId => {
    const atom = layoutGraph.atoms.get(atomId);
    return atom && atom.element !== 'H' && atom.visible !== false;
  }).length;
  if (visibleHeavyAtomCount > FINAL_EXACT_BRIDGED_RING_PATH_OVERLAP_MAX_LAYOUT_HEAVY_ATOMS) {
    return [];
  }

  const exactOverlapAtomIds = new Set();
  const exactOverlapPairs = new Set();
  const exactOverlapThreshold = bondLength * FINAL_EXACT_BRIDGED_RING_PATH_OVERLAP_DISTANCE_FACTOR;
  for (const overlap of findSevereOverlaps(layoutGraph, coords, bondLength)) {
    if ((overlap.distance ?? Number.POSITIVE_INFINITY) > exactOverlapThreshold) {
      continue;
    }
    exactOverlapPairs.add(atomPairKey(overlap.firstAtomId, overlap.secondAtomId));
    exactOverlapAtomIds.add(overlap.firstAtomId);
    exactOverlapAtomIds.add(overlap.secondAtomId);
  }
  if (exactOverlapAtomIds.size === 0) {
    return [
      ...compactBridgedSameRingPathBridgeheadOverlapDescriptors(layoutGraph, coords, bondLength),
      ...compactBridgedAcylLeafRingOverlapDescriptors(layoutGraph, coords, bondLength),
      ...compactBridgedTerminalMultipleBondCenterRingOverlapDescriptors(layoutGraph, coords, bondLength),
      ...compactAttachedBridgedBranchAnchorOverlapDescriptors(layoutGraph, coords, bondLength),
      ...compactBridgedNonbondedRingOverlapDescriptors(layoutGraph, coords, bondLength),
      ...compactBridgedExocyclicRootOverlapDescriptors(layoutGraph, coords, bondLength),
      ...compactBridgedTerminalMultipleBondLeafOverlapDescriptors(layoutGraph, coords, bondLength),
      ...compactFusedSpiroNonbondedRingOverlapDescriptors(layoutGraph, coords, bondLength),
      ...compactFusedPeripheralRingPathShiftDescriptors(layoutGraph, coords, bondLength)
    ];
  }

  const descriptors = [];
  for (const ring of layoutGraph.rings ?? []) {
    if (ring.aromatic || ring.atomIds.length < 5 || ring.atomIds.length > 6 || !hasBridgedConnectionForRing(layoutGraph, ring)) {
      continue;
    }
    const uniqueRingAtomIds = ring.atomIds.filter(atomId => {
      const atom = layoutGraph.atoms.get(atomId);
      return atom && atom.element !== 'H' && atom.aromatic !== true && (layoutGraph.ringCountByAtomId.get(atomId) ?? 0) === 1 && coords.has(atomId);
    });
    if (uniqueRingAtomIds.length !== 2 || !uniqueRingAtomIds.every(atomId => exactOverlapAtomIds.has(atomId))) {
      continue;
    }
    const orderedPair = orderedAdjacentRingAtomPair(ring, uniqueRingAtomIds[0], uniqueRingAtomIds[1]);
    if (!orderedPair || !layoutGraph.bondedPairSet.has(atomPairKey(orderedPair[0], orderedPair[1]))) {
      continue;
    }
    const ringAtomIdSet = new Set(ring.atomIds);
    const firstMovedAtomIds = finalExactBridgedRingPathMoveGroup(layoutGraph, coords, orderedPair[0], ringAtomIdSet);
    const secondMovedAtomIds = finalExactBridgedRingPathMoveGroup(layoutGraph, coords, orderedPair[1], ringAtomIdSet);
    if (firstMovedAtomIds.some(atomId => secondMovedAtomIds.includes(atomId))) {
      continue;
    }
    descriptors.push({
      firstAtomId: orderedPair[0],
      secondAtomId: orderedPair[1],
      ringAtomIds: ring.atomIds,
      firstMovedAtomIds,
      secondMovedAtomIds,
      movedAtomIds: [...new Set([...firstMovedAtomIds, ...secondMovedAtomIds])]
    });
    if (descriptors.length > FINAL_EXACT_BRIDGED_RING_PATH_OVERLAP_MAX_DESCRIPTORS) {
      return [];
    }
  }

  for (const descriptor of singleAtomBridgedRingPathOverlapDescriptors(layoutGraph, coords, exactOverlapPairs)) {
    descriptors.push(descriptor);
    if (descriptors.length > FINAL_EXACT_BRIDGED_RING_PATH_OVERLAP_MAX_DESCRIPTORS) {
      return [];
    }
  }
  for (const descriptor of terminalBlockedBridgedRingPathAtomOverlapDescriptors(layoutGraph, coords, exactOverlapPairs)) {
    descriptors.push(descriptor);
    if (descriptors.length > FINAL_EXACT_BRIDGED_RING_PATH_OVERLAP_MAX_DESCRIPTORS) {
      return [];
    }
  }
  for (const descriptor of compactBridgedSameRingPathBridgeheadOverlapDescriptors(layoutGraph, coords, bondLength)) {
    descriptors.push(descriptor);
    if (descriptors.length > FINAL_EXACT_BRIDGED_RING_PATH_OVERLAP_MAX_DESCRIPTORS) {
      return [];
    }
  }
  for (const descriptor of compactBridgedAcylLeafRingOverlapDescriptors(layoutGraph, coords, bondLength)) {
    descriptors.push(descriptor);
    if (descriptors.length > FINAL_EXACT_BRIDGED_RING_PATH_OVERLAP_MAX_DESCRIPTORS) {
      return [];
    }
  }
  for (const descriptor of compactBridgedTerminalMultipleBondCenterRingOverlapDescriptors(layoutGraph, coords, bondLength)) {
    descriptors.push(descriptor);
    if (descriptors.length > FINAL_EXACT_BRIDGED_RING_PATH_OVERLAP_MAX_DESCRIPTORS) {
      return [];
    }
  }
  for (const descriptor of compactAttachedBridgedBranchAnchorOverlapDescriptors(layoutGraph, coords, bondLength)) {
    descriptors.push(descriptor);
    if (descriptors.length > FINAL_EXACT_BRIDGED_RING_PATH_OVERLAP_MAX_DESCRIPTORS) {
      return [];
    }
  }
  for (const descriptor of compactBridgedNonbondedRingOverlapDescriptors(layoutGraph, coords, bondLength)) {
    descriptors.push(descriptor);
    if (descriptors.length > FINAL_EXACT_BRIDGED_RING_PATH_OVERLAP_MAX_DESCRIPTORS) {
      return [];
    }
  }
  for (const descriptor of compactBridgedExocyclicRootOverlapDescriptors(layoutGraph, coords, bondLength)) {
    descriptors.push(descriptor);
    if (descriptors.length > FINAL_EXACT_BRIDGED_RING_PATH_OVERLAP_MAX_DESCRIPTORS) {
      return [];
    }
  }
  for (const descriptor of compactBridgedTerminalMultipleBondLeafOverlapDescriptors(layoutGraph, coords, bondLength)) {
    descriptors.push(descriptor);
    if (descriptors.length > FINAL_EXACT_BRIDGED_RING_PATH_OVERLAP_MAX_DESCRIPTORS) {
      return [];
    }
  }
  for (const descriptor of compactFusedSpiroNonbondedRingOverlapDescriptors(layoutGraph, coords, bondLength)) {
    descriptors.push(descriptor);
    if (descriptors.length > FINAL_EXACT_BRIDGED_RING_PATH_OVERLAP_MAX_DESCRIPTORS) {
      return [];
    }
  }
  for (const descriptor of compactFusedPeripheralRingPathShiftDescriptors(layoutGraph, coords, bondLength)) {
    descriptors.push(descriptor);
    if (descriptors.length > FINAL_EXACT_BRIDGED_RING_PATH_OVERLAP_MAX_DESCRIPTORS) {
      return [];
    }
  }
  for (const descriptor of parallelBridgedRingPathOverlapDescriptors(layoutGraph, coords, bondLength)) {
    descriptors.push(descriptor);
    if (descriptors.length > FINAL_EXACT_BRIDGED_RING_PATH_OVERLAP_MAX_DESCRIPTORS) {
      return [];
    }
  }
  return descriptors;
}

function singleBridgedRingPathAtomOverlapCandidates(coords, descriptor, bondLength) {
  const atomPosition = coords.get(descriptor.atomId);
  const firstEndpoint = coords.get(descriptor.endpointAtomIds?.[0]);
  const secondEndpoint = coords.get(descriptor.endpointAtomIds?.[1]);
  if (!atomPosition || !firstEndpoint || !secondEndpoint) {
    return [];
  }
  const dx = secondEndpoint.x - firstEndpoint.x;
  const dy = secondEndpoint.y - firstEndpoint.y;
  const endpointDistance = Math.hypot(dx, dy);
  if (endpointDistance <= PRESENTATION_METRIC_EPSILON || endpointDistance > bondLength * 2 + PRESENTATION_METRIC_EPSILON) {
    return [];
  }
  const halfDistance = endpointDistance / 2;
  const heightSquared = bondLength * bondLength - halfDistance * halfDistance;
  if (heightSquared < -PRESENTATION_METRIC_EPSILON) {
    return [];
  }
  const exactHeight = Math.sqrt(Math.max(0, heightSquared));
  const maxBridgedHeightSquared = (bondLength * BRIDGED_VALIDATION.maxBondLengthFactor) ** 2 - halfDistance * halfDistance;
  if (maxBridgedHeightSquared < -PRESENTATION_METRIC_EPSILON) {
    return [];
  }
  const maxBridgedHeight = Math.sqrt(Math.max(0, maxBridgedHeightSquared));
  const unit = { x: dx / endpointDistance, y: dy / endpointDistance };
  const midpoint = { x: (firstEndpoint.x + secondEndpoint.x) / 2, y: (firstEndpoint.y + secondEndpoint.y) / 2 };
  const perpendicular = { x: -unit.y, y: unit.x };
  const targets = [];
  const seenTargets = new Set();
  for (const sign of [1, -1]) {
    const heightCandidates = [...FINAL_SINGLE_BRIDGED_RING_PATH_ARC_HEIGHT_FACTORS.map(heightFactor => Math.min(maxBridgedHeight, exactHeight * heightFactor)), maxBridgedHeight];
    for (const height of heightCandidates) {
      const target = {
        x: midpoint.x + perpendicular.x * height * sign,
        y: midpoint.y + perpendicular.y * height * sign
      };
      const targetKey = `${target.x.toFixed(6)}:${target.y.toFixed(6)}`;
      if (seenTargets.has(targetKey)) {
        continue;
      }
      seenTargets.add(targetKey);
      targets.push(target);
    }
  }
  const blockerPosition = coords.get(descriptor.blockerAtomId);
  if (blockerPosition) {
    targets.sort((first, second) => Math.hypot(second.x - blockerPosition.x, second.y - blockerPosition.y) - Math.hypot(first.x - blockerPosition.x, first.y - blockerPosition.y));
  }

  return targets.map(target => {
    const candidateCoords = cloneCoords(coords);
    translateAtomGroup(candidateCoords, coords, descriptor.movedAtomIds, {
      x: target.x - atomPosition.x,
      y: target.y - atomPosition.y
    });
    return candidateCoords;
  });
}

function translateAtomGroup(candidateCoords, sourceCoords, atomIds, offset) {
  for (const atomId of atomIds) {
    const position = sourceCoords.get(atomId);
    if (!position) {
      continue;
    }
    candidateCoords.set(atomId, {
      x: position.x + offset.x,
      y: position.y + offset.y
    });
  }
}

function finalExactBridgedRingPathOverlapCandidate(coords, descriptor, bondLength, alongFactor, spreadFactor, sign) {
  const firstPosition = coords.get(descriptor.firstAtomId);
  const secondPosition = coords.get(descriptor.secondAtomId);
  if (!firstPosition || !secondPosition) {
    return null;
  }
  const axisLength = Math.hypot(secondPosition.x - firstPosition.x, secondPosition.y - firstPosition.y);
  if (axisLength <= PRESENTATION_METRIC_EPSILON) {
    return null;
  }
  const axis = {
    x: (secondPosition.x - firstPosition.x) / axisLength,
    y: (secondPosition.y - firstPosition.y) / axisLength
  };
  const perpendicular = { x: -axis.y, y: axis.x };
  const along = alongFactor * bondLength;
  const spread = spreadFactor * bondLength * sign;
  const firstOffset = {
    x: axis.x * along + perpendicular.x * spread,
    y: axis.y * along + perpendicular.y * spread
  };
  const secondOffset = {
    x: axis.x * along - perpendicular.x * spread,
    y: axis.y * along - perpendicular.y * spread
  };
  const candidateCoords = cloneCoords(coords);
  translateAtomGroup(candidateCoords, coords, descriptor.firstMovedAtomIds, firstOffset);
  translateAtomGroup(candidateCoords, coords, descriptor.secondMovedAtomIds, secondOffset);
  return candidateCoords;
}

function parallelBridgedRingPathOverlapCandidates(coords, descriptor, bondLength) {
  const pathAtomIds = descriptor.pathAtomIds ?? [];
  const pathMovedAtomIdGroups = descriptor.pathMovedAtomIdGroups ?? [];
  if (
    pathAtomIds.length < FINAL_PARALLEL_BRIDGED_RING_PATH_MIN_ATOM_COUNT ||
    pathAtomIds.length > FINAL_PARALLEL_BRIDGED_RING_PATH_MAX_ATOM_COUNT ||
    pathMovedAtomIdGroups.length !== pathAtomIds.length
  ) {
    return [];
  }
  const firstEndpoint = coords.get(descriptor.endpointAtomIds?.[0]);
  const secondEndpoint = coords.get(descriptor.endpointAtomIds?.[1]);
  if (!firstEndpoint || !secondEndpoint) {
    return [];
  }
  const axisLength = Math.hypot(secondEndpoint.x - firstEndpoint.x, secondEndpoint.y - firstEndpoint.y);
  if (axisLength <= PRESENTATION_METRIC_EPSILON || axisLength >= bondLength * 4 - PRESENTATION_METRIC_EPSILON) {
    return [];
  }
  const axis = {
    x: (secondEndpoint.x - firstEndpoint.x) / axisLength,
    y: (secondEndpoint.y - firstEndpoint.y) / axisLength
  };
  const perpendicular = { x: -axis.y, y: axis.x };
  const candidates = [];

  if (pathAtomIds.length === 3) {
    const midpointAlong = axisLength / 2;
    for (const heightFactor of FINAL_PARALLEL_BRIDGED_RING_PATH_ARC_HEIGHT_FACTORS) {
      const firstHeight = heightFactor * bondLength;
      const firstAlongSquared = bondLength * bondLength - firstHeight * firstHeight;
      if (firstAlongSquared <= PRESENTATION_METRIC_EPSILON) {
        continue;
      }
      const firstAlong = Math.sqrt(firstAlongSquared);
      const secondDeltaAlong = midpointAlong - firstAlong;
      const secondHeightDeltaSquared = bondLength * bondLength - secondDeltaAlong * secondDeltaAlong;
      if (secondHeightDeltaSquared < -PRESENTATION_METRIC_EPSILON) {
        continue;
      }
      const secondHeightDelta = Math.sqrt(Math.max(0, secondHeightDeltaSquared));
      for (const secondHeight of [firstHeight - secondHeightDelta, firstHeight + secondHeightDelta]) {
        const pathPositions = [
          { along: firstAlong, height: firstHeight },
          { along: midpointAlong, height: secondHeight },
          { along: axisLength - firstAlong, height: firstHeight }
        ];
        const candidateCoords = cloneCoords(coords);
        let valid = true;
        for (let index = 0; index < pathAtomIds.length; index += 1) {
          const atomId = pathAtomIds[index];
          const currentPosition = coords.get(atomId);
          if (!currentPosition) {
            valid = false;
            break;
          }
          const targetPosition = {
            x: firstEndpoint.x + axis.x * pathPositions[index].along + perpendicular.x * pathPositions[index].height,
            y: firstEndpoint.y + axis.y * pathPositions[index].along + perpendicular.y * pathPositions[index].height
          };
          translateAtomGroup(candidateCoords, coords, pathMovedAtomIdGroups[index], {
            x: targetPosition.x - currentPosition.x,
            y: targetPosition.y - currentPosition.y
          });
        }
        if (valid) {
          candidates.push(candidateCoords);
        }
      }
    }
  }

  const oppositePathMovedAtomIdGroups = descriptor.oppositePathMovedAtomIdGroups ?? [];
  if (pathAtomIds.length >= 4 && oppositePathMovedAtomIdGroups.length === pathAtomIds.length) {
    for (const spreadFactor of FINAL_PARALLEL_BRIDGED_RING_PATH_PAIR_SPREAD_FACTORS) {
      const spread = spreadFactor * bondLength;
      for (const sign of [1, -1]) {
        const pathOffset = {
          x: perpendicular.x * spread * sign,
          y: perpendicular.y * spread * sign
        };
        const oppositeOffset = {
          x: -pathOffset.x,
          y: -pathOffset.y
        };
        const candidateCoords = cloneCoords(coords);
        for (let index = 0; index < pathMovedAtomIdGroups.length; index += 1) {
          translateAtomGroup(candidateCoords, coords, pathMovedAtomIdGroups[index], pathOffset);
          translateAtomGroup(candidateCoords, coords, oppositePathMovedAtomIdGroups[index], oppositeOffset);
        }
        candidates.push(candidateCoords);
      }
    }
  }
  return candidates;
}

function compactFusedRingPathShiftCandidates(coords, descriptor, bondLength) {
  const candidates = [];
  for (const magnitudeFactor of FINAL_COMPACT_FUSED_RING_PATH_SHIFT_MAGNITUDE_FACTORS) {
    const magnitude = magnitudeFactor * bondLength;
    for (const angle of FINAL_COMPACT_FUSED_RING_PATH_SHIFT_ANGLES) {
      const candidateCoords = cloneCoords(coords);
      translateAtomGroup(candidateCoords, coords, descriptor.movedAtomIds, {
        x: Math.cos(angle) * magnitude,
        y: Math.sin(angle) * magnitude
      });
      candidates.push(candidateCoords);
    }
  }
  return candidates;
}

function compactTerminalMultipleBondLeafReliefCandidates(coords, descriptor, bondLength) {
  const ringPosition = coords.get(descriptor.firstAtomId);
  const leafPosition = coords.get(descriptor.leafAtomId);
  if (!ringPosition || !leafPosition) {
    return [];
  }
  const dx = ringPosition.x - leafPosition.x;
  const dy = ringPosition.y - leafPosition.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= PRESENTATION_METRIC_EPSILON) {
    return [];
  }
  const unit = {
    x: dx / distance,
    y: dy / distance
  };
  return FINAL_COMPACT_BRIDGED_TERMINAL_MULTIPLE_BOND_LEAF_SHIFT_FACTORS.map(shiftFactor => {
    const candidateCoords = cloneCoords(coords);
    translateAtomGroup(candidateCoords, coords, descriptor.movedAtomIds, {
      x: unit.x * bondLength * shiftFactor,
      y: unit.y * bondLength * shiftFactor
    });
    return candidateCoords;
  });
}

function compactBridgedMultipleBondCenterReliefCandidates(coords, descriptor, bondLength) {
  const ringPosition = coords.get(descriptor.ringAtomId);
  const centerPosition = coords.get(descriptor.centerAtomId);
  if (!ringPosition || !centerPosition) {
    return [];
  }
  const dx = ringPosition.x - centerPosition.x;
  const dy = ringPosition.y - centerPosition.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= PRESENTATION_METRIC_EPSILON) {
    return [];
  }
  const unit = {
    x: dx / distance,
    y: dy / distance
  };
  const perpendicular = {
    x: -unit.y,
    y: unit.x
  };
  const candidates = [];
  for (const ringShiftFactor of FINAL_COMPACT_BRIDGED_MULTIPLE_BOND_CENTER_RING_SHIFT_FACTORS) {
    const ringOffset = {
      x: unit.x * ringShiftFactor * bondLength,
      y: unit.y * ringShiftFactor * bondLength
    };
    for (const centerShiftFactor of FINAL_COMPACT_BRIDGED_MULTIPLE_BOND_CENTER_SHIFT_FACTORS) {
      for (const lateralFactor of FINAL_COMPACT_BRIDGED_MULTIPLE_BOND_CENTER_LATERAL_FACTORS) {
        const centerOffset = {
          x: (-unit.x * centerShiftFactor + perpendicular.x * lateralFactor) * bondLength,
          y: (-unit.y * centerShiftFactor + perpendicular.y * lateralFactor) * bondLength
        };
        const candidateCoords = cloneCoords(coords);
        translateAtomGroup(candidateCoords, coords, descriptor.ringMovedAtomIds ?? [], ringOffset);
        translateAtomGroup(candidateCoords, coords, descriptor.centerMovedAtomIds ?? [], centerOffset);
        candidates.push(candidateCoords);
      }
    }
  }
  return candidates;
}

function compactBridgedRingPathTailReliefCandidates(coords, descriptor, bondLength) {
  const rootPosition = coords.get(descriptor.rootAtomId);
  const blockerPosition = coords.get(descriptor.blockerAtomId);
  if (!rootPosition || !blockerPosition) {
    return [];
  }
  const dx = rootPosition.x - blockerPosition.x;
  const dy = rootPosition.y - blockerPosition.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= PRESENTATION_METRIC_EPSILON) {
    return [];
  }
  const unit = {
    x: dx / distance,
    y: dy / distance
  };
  const perpendicular = {
    x: -unit.y,
    y: unit.x
  };
  const candidates = [];
  for (const shiftFactor of FINAL_COMPACT_BRIDGED_RING_PATH_TAIL_SHIFT_FACTORS) {
    for (const lateralFactor of FINAL_COMPACT_BRIDGED_RING_PATH_TAIL_LATERAL_FACTORS) {
      const candidateCoords = cloneCoords(coords);
      translateAtomGroup(candidateCoords, coords, descriptor.movedAtomIds, {
        x: (unit.x * shiftFactor + perpendicular.x * lateralFactor) * bondLength,
        y: (unit.y * shiftFactor + perpendicular.y * lateralFactor) * bondLength
      });
      candidates.push(candidateCoords);
    }
  }
  return candidates;
}

function compactBridgedSameRingPathBridgeheadReliefCandidates(coords, descriptor, bondLength) {
  const atomPosition = coords.get(descriptor.atomId);
  const bridgeheadPosition = coords.get(descriptor.bridgeheadAtomId);
  if (!atomPosition || !bridgeheadPosition) {
    return [];
  }
  const dx = atomPosition.x - bridgeheadPosition.x;
  const dy = atomPosition.y - bridgeheadPosition.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= PRESENTATION_METRIC_EPSILON) {
    return [];
  }
  const baseAngle = Math.atan2(dy, dx);
  const candidates = [];
  for (const offset of FINAL_COMPACT_BRIDGED_SAME_RING_PATH_BRIDGEHEAD_ANGLE_OFFSETS) {
    const angle = baseAngle + offset;
    for (const shiftFactor of FINAL_COMPACT_BRIDGED_SAME_RING_PATH_BRIDGEHEAD_SHIFT_FACTORS) {
      const candidateCoords = cloneCoords(coords);
      translateAtomGroup(candidateCoords, coords, descriptor.movedAtomIds, {
        x: Math.cos(angle) * shiftFactor * bondLength,
        y: Math.sin(angle) * shiftFactor * bondLength
      });
      candidates.push(candidateCoords);
    }
  }
  return candidates;
}

function compactBridgedAcylLeafRingReliefCandidates(coords, descriptor, bondLength) {
  const ringPosition = coords.get(descriptor.ringAtomId);
  const leafPosition = coords.get(descriptor.leafAtomId);
  if (!ringPosition || !leafPosition) {
    return [];
  }
  const dx = ringPosition.x - leafPosition.x;
  const dy = ringPosition.y - leafPosition.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= PRESENTATION_METRIC_EPSILON) {
    return [];
  }
  const baseAngle = Math.atan2(dy, dx);
  const candidates = [];
  for (const offset of FINAL_COMPACT_BRIDGED_ACYL_LEAF_RING_ANGLE_OFFSETS) {
    const angle = baseAngle + offset;
    for (const shiftFactor of FINAL_COMPACT_BRIDGED_ACYL_LEAF_RING_SHIFT_FACTORS) {
      const candidateCoords = cloneCoords(coords);
      translateAtomGroup(candidateCoords, coords, descriptor.movedAtomIds, {
        x: Math.cos(angle) * shiftFactor * bondLength,
        y: Math.sin(angle) * shiftFactor * bondLength
      });
      candidates.push(candidateCoords);
    }
  }
  return candidates;
}

function compactBridgedTerminalMultipleBondCenterRingReliefCandidates(coords, descriptor, bondLength) {
  const centerPosition = coords.get(descriptor.centerAtomId);
  const ringPosition = coords.get(descriptor.ringAtomId);
  if (!centerPosition || !ringPosition) {
    return [];
  }
  const dx = centerPosition.x - ringPosition.x;
  const dy = centerPosition.y - ringPosition.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= PRESENTATION_METRIC_EPSILON) {
    return [];
  }
  const baseAngle = Math.atan2(dy, dx);
  const candidates = [];
  for (const offset of FINAL_COMPACT_BRIDGED_TERMINAL_MULTIPLE_BOND_CENTER_RING_ANGLE_OFFSETS) {
    const angle = baseAngle + offset;
    for (const shiftFactor of FINAL_COMPACT_BRIDGED_TERMINAL_MULTIPLE_BOND_CENTER_RING_SHIFT_FACTORS) {
      const candidateCoords = cloneCoords(coords);
      translateAtomGroup(candidateCoords, coords, descriptor.movedAtomIds, {
        x: Math.cos(angle) * shiftFactor * bondLength,
        y: Math.sin(angle) * shiftFactor * bondLength
      });
      candidates.push(candidateCoords);
    }
  }
  return candidates;
}

function compactAttachedBridgedBranchAnchorReliefCandidates(coords, descriptor, bondLength) {
  const branchPosition = coords.get(descriptor.branchAtomId);
  const anchorPosition = coords.get(descriptor.anchorAtomId);
  if (!branchPosition || !anchorPosition) {
    return [];
  }
  const dx = branchPosition.x - anchorPosition.x;
  const dy = branchPosition.y - anchorPosition.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= PRESENTATION_METRIC_EPSILON) {
    return [];
  }
  const unit = {
    x: dx / distance,
    y: dy / distance
  };
  const perpendicular = {
    x: -unit.y,
    y: unit.x
  };
  const candidates = [];
  for (const shiftFactor of FINAL_COMPACT_ATTACHED_BRIDGED_BRANCH_ANCHOR_SHIFT_FACTORS) {
    for (const lateralFactor of FINAL_COMPACT_ATTACHED_BRIDGED_BRANCH_ANCHOR_LATERAL_FACTORS) {
      const candidateCoords = cloneCoords(coords);
      translateAtomGroup(candidateCoords, coords, descriptor.movedAtomIds, {
        x: (unit.x * shiftFactor + perpendicular.x * lateralFactor) * bondLength,
        y: (unit.y * shiftFactor + perpendicular.y * lateralFactor) * bondLength
      });
      candidates.push(candidateCoords);
    }
  }
  return candidates;
}

function compareFinalExactBridgedRingPathOverlapCandidates(candidate, incumbent) {
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
  if (Math.abs((candidate.audit.maxBondLengthDeviation ?? 0) - (incumbent.audit.maxBondLengthDeviation ?? 0)) > PRESENTATION_METRIC_EPSILON) {
    return (candidate.audit.maxBondLengthDeviation ?? 0) - (incumbent.audit.maxBondLengthDeviation ?? 0);
  }
  if (Math.abs(candidate.totalMove - incumbent.totalMove) > PRESENTATION_METRIC_EPSILON) {
    return candidate.totalMove - incumbent.totalMove;
  }
  return `${candidate.firstAtomId}:${candidate.secondAtomId}`.localeCompare(`${incumbent.firstAtomId}:${incumbent.secondAtomId}`, 'en', { numeric: true });
}

function maybeRetouchFinalExactBridgedRingPathOverlaps(layoutGraph, finalCoords, placement, bondLength) {
  const baseAudit = auditLayout(layoutGraph, finalCoords, {
    bondLength,
    bondValidationClasses: placement.bondValidationClasses
  });
  if ((baseAudit.severeOverlapCount ?? 0) === 0) {
    return { coords: finalCoords, changed: false, movedAtomIds: [], audit: baseAudit };
  }

  const descriptors = finalExactBridgedRingPathOverlapDescriptors(layoutGraph, finalCoords, bondLength);
  if (descriptors.length === 0) {
    return { coords: finalCoords, changed: false, movedAtomIds: [], audit: baseAudit };
  }

  let bestCandidate = null;
  for (const descriptor of descriptors) {
    if (descriptor.kind === 'singleBridgedPathAtom') {
      for (const candidateCoords of singleBridgedRingPathAtomOverlapCandidates(finalCoords, descriptor, bondLength)) {
        const candidateBondValidationClasses = assignBondValidationClass(layoutGraph, descriptor.ringAtomIds, 'bridged', new Map(placement.bondValidationClasses), { overwrite: true });
        const candidateAudit = auditLayout(layoutGraph, candidateCoords, {
          bondLength,
          bondValidationClasses: candidateBondValidationClasses
        });
        if (!finalAuditCountsDoNotWorsen(candidateAudit, baseAudit) || (candidateAudit.severeOverlapCount ?? 0) >= (baseAudit.severeOverlapCount ?? 0)) {
          continue;
        }
        const candidate = {
          coords: candidateCoords,
          audit: candidateAudit,
          firstAtomId: descriptor.firstAtomId,
          secondAtomId: descriptor.secondAtomId,
          bondValidationClasses: candidateBondValidationClasses,
          movedAtomIds: descriptor.movedAtomIds,
          totalMove: finalAcyclicBranchContactCandidateMove(finalCoords, candidateCoords, descriptor.movedAtomIds)
        };
        if (compareFinalExactBridgedRingPathOverlapCandidates(candidate, bestCandidate) < 0) {
          bestCandidate = candidate;
        }
      }
      continue;
    }
    if (descriptor.kind === 'parallelBridgedPath') {
      for (const candidateCoords of parallelBridgedRingPathOverlapCandidates(finalCoords, descriptor, bondLength)) {
        const candidateBondValidationClasses = assignBondValidationClass(layoutGraph, descriptor.ringAtomIds, 'bridged', new Map(placement.bondValidationClasses), { overwrite: true });
        const candidateAudit = auditLayout(layoutGraph, candidateCoords, {
          bondLength,
          bondValidationClasses: candidateBondValidationClasses
        });
        if (!finalAuditCountsDoNotWorsen(candidateAudit, baseAudit) || (candidateAudit.severeOverlapCount ?? 0) >= (baseAudit.severeOverlapCount ?? 0)) {
          continue;
        }
        const candidate = {
          coords: candidateCoords,
          audit: candidateAudit,
          firstAtomId: descriptor.firstAtomId,
          secondAtomId: descriptor.secondAtomId,
          bondValidationClasses: candidateBondValidationClasses,
          movedAtomIds: descriptor.movedAtomIds,
          totalMove: finalAcyclicBranchContactCandidateMove(finalCoords, candidateCoords, descriptor.movedAtomIds)
        };
        if (compareFinalExactBridgedRingPathOverlapCandidates(candidate, bestCandidate) < 0) {
          bestCandidate = candidate;
        }
      }
      continue;
    }
    if (descriptor.kind === 'compactFusedPathShift') {
      for (const candidateCoords of compactFusedRingPathShiftCandidates(finalCoords, descriptor, bondLength)) {
        const candidateBondValidationClasses = assignBondValidationClass(layoutGraph, descriptor.ringAtomIds, 'bridged', new Map(placement.bondValidationClasses), { overwrite: true });
        const candidateAudit = auditLayout(layoutGraph, candidateCoords, {
          bondLength,
          bondValidationClasses: candidateBondValidationClasses
        });
        if (!finalAuditCountsDoNotWorsen(candidateAudit, baseAudit) || (candidateAudit.severeOverlapCount ?? 0) >= (baseAudit.severeOverlapCount ?? 0)) {
          continue;
        }
        const candidate = {
          coords: candidateCoords,
          audit: candidateAudit,
          firstAtomId: descriptor.firstAtomId,
          secondAtomId: descriptor.secondAtomId,
          bondValidationClasses: candidateBondValidationClasses,
          movedAtomIds: descriptor.movedAtomIds,
          totalMove: finalAcyclicBranchContactCandidateMove(finalCoords, candidateCoords, descriptor.movedAtomIds)
        };
        if (compareFinalExactBridgedRingPathOverlapCandidates(candidate, bestCandidate) < 0) {
          bestCandidate = candidate;
        }
      }
      continue;
    }
    if (descriptor.kind === 'compactTerminalMultipleBondLeafRelief') {
      for (const candidateCoords of compactTerminalMultipleBondLeafReliefCandidates(finalCoords, descriptor, bondLength)) {
        const candidateBondValidationClasses = assignBondValidationClass(layoutGraph, descriptor.ringAtomIds, 'bridged', new Map(placement.bondValidationClasses), { overwrite: true });
        const candidateAudit = auditLayout(layoutGraph, candidateCoords, {
          bondLength,
          bondValidationClasses: candidateBondValidationClasses
        });
        if (!finalAuditCountsDoNotWorsen(candidateAudit, baseAudit) || (candidateAudit.severeOverlapCount ?? 0) >= (baseAudit.severeOverlapCount ?? 0)) {
          continue;
        }
        const candidate = {
          coords: candidateCoords,
          audit: candidateAudit,
          firstAtomId: descriptor.firstAtomId,
          secondAtomId: descriptor.secondAtomId,
          bondValidationClasses: candidateBondValidationClasses,
          movedAtomIds: descriptor.movedAtomIds,
          totalMove: finalAcyclicBranchContactCandidateMove(finalCoords, candidateCoords, descriptor.movedAtomIds)
        };
        if (compareFinalExactBridgedRingPathOverlapCandidates(candidate, bestCandidate) < 0) {
          bestCandidate = candidate;
        }
      }
      continue;
    }
    if (descriptor.kind === 'compactBridgedMultipleBondCenterRelief') {
      for (const candidateCoords of compactBridgedMultipleBondCenterReliefCandidates(finalCoords, descriptor, bondLength)) {
        const candidateBondValidationClasses = assignBondValidationClass(layoutGraph, descriptor.ringAtomIds, 'bridged', new Map(placement.bondValidationClasses), { overwrite: true });
        const candidateAudit = auditLayout(layoutGraph, candidateCoords, {
          bondLength,
          bondValidationClasses: candidateBondValidationClasses
        });
        if (!finalAuditCountsDoNotWorsen(candidateAudit, baseAudit) || (candidateAudit.severeOverlapCount ?? 0) >= (baseAudit.severeOverlapCount ?? 0)) {
          continue;
        }
        const candidate = {
          coords: candidateCoords,
          audit: candidateAudit,
          firstAtomId: descriptor.firstAtomId,
          secondAtomId: descriptor.secondAtomId,
          bondValidationClasses: candidateBondValidationClasses,
          movedAtomIds: descriptor.movedAtomIds,
          totalMove: finalAcyclicBranchContactCandidateMove(finalCoords, candidateCoords, descriptor.movedAtomIds)
        };
        if (compareFinalExactBridgedRingPathOverlapCandidates(candidate, bestCandidate) < 0) {
          bestCandidate = candidate;
        }
      }
      continue;
    }
    if (descriptor.kind === 'compactBridgedRingPathTailRelief') {
      for (const candidateCoords of compactBridgedRingPathTailReliefCandidates(finalCoords, descriptor, bondLength)) {
        const candidateBondValidationClasses = assignBondValidationClass(layoutGraph, descriptor.ringAtomIds, 'bridged', new Map(placement.bondValidationClasses), { overwrite: true });
        const candidateAudit = auditLayout(layoutGraph, candidateCoords, {
          bondLength,
          bondValidationClasses: candidateBondValidationClasses
        });
        if (!finalAuditCountsDoNotWorsen(candidateAudit, baseAudit) || (candidateAudit.severeOverlapCount ?? 0) >= (baseAudit.severeOverlapCount ?? 0)) {
          continue;
        }
        const candidate = {
          coords: candidateCoords,
          audit: candidateAudit,
          firstAtomId: descriptor.firstAtomId,
          secondAtomId: descriptor.secondAtomId,
          bondValidationClasses: candidateBondValidationClasses,
          movedAtomIds: descriptor.movedAtomIds,
          totalMove: finalAcyclicBranchContactCandidateMove(finalCoords, candidateCoords, descriptor.movedAtomIds)
        };
        if (compareFinalExactBridgedRingPathOverlapCandidates(candidate, bestCandidate) < 0) {
          bestCandidate = candidate;
        }
      }
      continue;
    }
    if (descriptor.kind === 'compactBridgedSameRingPathBridgeheadRelief') {
      for (const candidateCoords of compactBridgedSameRingPathBridgeheadReliefCandidates(finalCoords, descriptor, bondLength)) {
        const candidateBondValidationClasses = assignBondValidationClass(layoutGraph, descriptor.ringAtomIds, 'bridged', new Map(placement.bondValidationClasses), { overwrite: true });
        const candidateAudit = auditLayout(layoutGraph, candidateCoords, {
          bondLength,
          bondValidationClasses: candidateBondValidationClasses
        });
        if (!finalAuditCountsDoNotWorsen(candidateAudit, baseAudit) || (candidateAudit.severeOverlapCount ?? 0) >= (baseAudit.severeOverlapCount ?? 0)) {
          continue;
        }
        const candidate = {
          coords: candidateCoords,
          audit: candidateAudit,
          firstAtomId: descriptor.firstAtomId,
          secondAtomId: descriptor.secondAtomId,
          bondValidationClasses: candidateBondValidationClasses,
          movedAtomIds: descriptor.movedAtomIds,
          totalMove: finalAcyclicBranchContactCandidateMove(finalCoords, candidateCoords, descriptor.movedAtomIds)
        };
        if (compareFinalExactBridgedRingPathOverlapCandidates(candidate, bestCandidate) < 0) {
          bestCandidate = candidate;
        }
      }
      continue;
    }
    if (descriptor.kind === 'compactBridgedAcylLeafRingRelief') {
      for (const candidateCoords of compactBridgedAcylLeafRingReliefCandidates(finalCoords, descriptor, bondLength)) {
        const candidateBondValidationClasses = assignBondValidationClass(layoutGraph, descriptor.ringAtomIds, 'bridged', new Map(placement.bondValidationClasses), { overwrite: true });
        const candidateAudit = auditLayout(layoutGraph, candidateCoords, {
          bondLength,
          bondValidationClasses: candidateBondValidationClasses
        });
        if (!finalAuditCountsDoNotWorsen(candidateAudit, baseAudit) || (candidateAudit.severeOverlapCount ?? 0) >= (baseAudit.severeOverlapCount ?? 0)) {
          continue;
        }
        const candidate = {
          coords: candidateCoords,
          audit: candidateAudit,
          firstAtomId: descriptor.firstAtomId,
          secondAtomId: descriptor.secondAtomId,
          bondValidationClasses: candidateBondValidationClasses,
          movedAtomIds: descriptor.movedAtomIds,
          totalMove: finalAcyclicBranchContactCandidateMove(finalCoords, candidateCoords, descriptor.movedAtomIds)
        };
        if (compareFinalExactBridgedRingPathOverlapCandidates(candidate, bestCandidate) < 0) {
          bestCandidate = candidate;
        }
      }
      continue;
    }
    if (descriptor.kind === 'compactBridgedTerminalMultipleBondCenterRingRelief') {
      for (const candidateCoords of compactBridgedTerminalMultipleBondCenterRingReliefCandidates(finalCoords, descriptor, bondLength)) {
        const candidateBondValidationClasses = assignBondValidationClass(
          layoutGraph,
          [...new Set([...(descriptor.ringAtomIds ?? []), ...(descriptor.movedAtomIds ?? [])])],
          'bridged',
          new Map(placement.bondValidationClasses),
          { overwrite: true }
        );
        const candidateAudit = auditLayout(layoutGraph, candidateCoords, {
          bondLength,
          bondValidationClasses: candidateBondValidationClasses
        });
        if (!finalAuditCountsDoNotWorsen(candidateAudit, baseAudit) || (candidateAudit.severeOverlapCount ?? 0) >= (baseAudit.severeOverlapCount ?? 0)) {
          continue;
        }
        const candidate = {
          coords: candidateCoords,
          audit: candidateAudit,
          firstAtomId: descriptor.firstAtomId,
          secondAtomId: descriptor.secondAtomId,
          bondValidationClasses: candidateBondValidationClasses,
          movedAtomIds: descriptor.movedAtomIds,
          totalMove: finalAcyclicBranchContactCandidateMove(finalCoords, candidateCoords, descriptor.movedAtomIds)
        };
        if (compareFinalExactBridgedRingPathOverlapCandidates(candidate, bestCandidate) < 0) {
          bestCandidate = candidate;
        }
      }
      continue;
    }
    if (descriptor.kind === 'compactAttachedBridgedBranchAnchorRelief') {
      for (const candidateCoords of compactAttachedBridgedBranchAnchorReliefCandidates(finalCoords, descriptor, bondLength)) {
        const candidateBondValidationClasses = assignBondValidationClass(
          layoutGraph,
          [...new Set([descriptor.anchorAtomId, ...(descriptor.ringAtomIds ?? []), ...(descriptor.movedAtomIds ?? [])])],
          'bridged',
          new Map(placement.bondValidationClasses),
          { overwrite: true }
        );
        const candidateAudit = auditLayout(layoutGraph, candidateCoords, {
          bondLength,
          bondValidationClasses: candidateBondValidationClasses
        });
        if (!finalAuditCountsDoNotWorsen(candidateAudit, baseAudit) || (candidateAudit.severeOverlapCount ?? 0) >= (baseAudit.severeOverlapCount ?? 0)) {
          continue;
        }
        const candidate = {
          coords: candidateCoords,
          audit: candidateAudit,
          firstAtomId: descriptor.firstAtomId,
          secondAtomId: descriptor.secondAtomId,
          bondValidationClasses: candidateBondValidationClasses,
          movedAtomIds: descriptor.movedAtomIds,
          totalMove: finalAcyclicBranchContactCandidateMove(finalCoords, candidateCoords, descriptor.movedAtomIds)
        };
        if (compareFinalExactBridgedRingPathOverlapCandidates(candidate, bestCandidate) < 0) {
          bestCandidate = candidate;
        }
      }
      continue;
    }
    for (const alongFactor of FINAL_EXACT_BRIDGED_RING_PATH_OVERLAP_ALONG_FACTORS) {
      for (const spreadFactor of FINAL_EXACT_BRIDGED_RING_PATH_OVERLAP_SPREAD_FACTORS) {
        for (const sign of [1, -1]) {
          const candidateCoords = finalExactBridgedRingPathOverlapCandidate(finalCoords, descriptor, bondLength, alongFactor, spreadFactor, sign);
          if (!candidateCoords) {
            continue;
          }
          const candidateBondValidationClasses = assignBondValidationClass(layoutGraph, descriptor.ringAtomIds, 'bridged', new Map(placement.bondValidationClasses), { overwrite: true });
          const candidateAudit = auditLayout(layoutGraph, candidateCoords, {
            bondLength,
            bondValidationClasses: candidateBondValidationClasses
          });
          if (!finalAuditCountsDoNotWorsen(candidateAudit, baseAudit) || (candidateAudit.severeOverlapCount ?? 0) >= (baseAudit.severeOverlapCount ?? 0)) {
            continue;
          }
          const candidate = {
            coords: candidateCoords,
            audit: candidateAudit,
            firstAtomId: descriptor.firstAtomId,
            secondAtomId: descriptor.secondAtomId,
            bondValidationClasses: candidateBondValidationClasses,
            movedAtomIds: descriptor.movedAtomIds,
            totalMove: finalAcyclicBranchContactCandidateMove(finalCoords, candidateCoords, descriptor.movedAtomIds)
          };
          if (compareFinalExactBridgedRingPathOverlapCandidates(candidate, bestCandidate) < 0) {
            bestCandidate = candidate;
          }
        }
      }
    }
  }
  if (!bestCandidate) {
    return { coords: finalCoords, changed: false, movedAtomIds: [], audit: baseAudit };
  }
  return {
    coords: bestCandidate.coords,
    changed: true,
    bondValidationClasses: bestCandidate.bondValidationClasses,
    movedAtomIds: bestCandidate.movedAtomIds,
    audit: bestCandidate.audit
  };
}

function visibleHeavyAtomIdsForCoords(layoutGraph, coords) {
  return [...coords.keys()].filter(atomId => {
    const atom = layoutGraph.atoms.get(atomId);
    return atom && atom.element !== 'H' && atom.visible !== false;
  });
}

function visibleHeavyAtomCountForCoords(layoutGraph, coords) {
  let count = 0;
  for (const atomId of coords.keys()) {
    const atom = layoutGraph.atoms.get(atomId);
    if (atom && atom.element !== 'H' && atom.visible !== false) {
      count++;
    }
  }
  return count;
}

function exactBridgedTerminalMultipleBondCenterOverlapDescriptors(layoutGraph, coords, bondLength, baseAudit) {
  if (
    (baseAudit?.severeOverlapCount ?? 0) !== 1 ||
    (baseAudit.visibleHeavyBondCrossingCount ?? 0) > 1 ||
    (baseAudit.bondLengthFailureCount ?? 0) !== 0 ||
    (baseAudit.labelOverlapCount ?? 0) !== 0 ||
    (baseAudit.ringSubstituentReadabilityFailureCount ?? 0) !== 0 ||
    visibleHeavyAtomCountForCoords(layoutGraph, coords) > FINAL_BRIDGED_SINGLE_OVERLAP_RELAXATION_MAX_HEAVY_ATOMS
  ) {
    return [];
  }

  const overlaps = findSevereOverlapsMatching(layoutGraph, coords, bondLength, (firstAtomId, secondAtomId) => !layoutGraph.bondedPairSet.has(atomPairKey(firstAtomId, secondAtomId)));
  if (overlaps.length !== 1 || (overlaps[0].distance ?? Number.POSITIVE_INFINITY) > bondLength * FINAL_COMPACT_BRIDGED_HETERO_NONBONDED_RING_OVERLAP_DISTANCE_FACTOR) {
    return [];
  }

  const descriptors = [];
  for (const [ringAtomId, centerAtomId] of [
    [overlaps[0].firstAtomId, overlaps[0].secondAtomId],
    [overlaps[0].secondAtomId, overlaps[0].firstAtomId]
  ]) {
    const ringAtom = layoutGraph.atoms.get(ringAtomId);
    const centerAtom = layoutGraph.atoms.get(centerAtomId);
    if (
      !isCompactBridgedOverlapRetouchableRingAtom(layoutGraph, coords, ringAtom, ringAtomId) ||
      !centerAtom ||
      centerAtom.element !== 'C' ||
      centerAtom.aromatic ||
      layoutGraph.ringAtomIdSet.has(centerAtomId) ||
      (centerAtom.heavyDegree ?? 0) !== 2 ||
      !coords.has(centerAtomId)
    ) {
      continue;
    }

    const ringSystemId = layoutGraph.atomToRingSystemId.get(ringAtomId);
    const ringSystem = ringSystemId != null ? layoutGraph.ringSystemById.get(ringSystemId) : null;
    if (!ringSystem || (ringSystem.atomIds?.length ?? 0) > 16 || (ringSystem.ringIds?.length ?? 0) < 2 || !hasBridgedConnectionForRingSystem(layoutGraph, ringSystem)) {
      continue;
    }

    const leafAtomIds = terminalMultipleBondHeteroLeafIdsForCenter(layoutGraph, coords, centerAtomId);
    if (leafAtomIds.length !== 1) {
      continue;
    }

    const ringSystemAtomIdSet = new Set(ringSystem.atomIds ?? []);
    const branchRootBond = (layoutGraph.bondsByAtomId.get(centerAtomId) ?? []).find(bond => {
      if (!bond || bond.kind !== 'covalent' || bond.aromatic || bond.inRing || (bond.order ?? 1) !== 1) {
        return false;
      }
      const neighborAtomId = bond.a === centerAtomId ? bond.b : bond.a;
      return ringSystemAtomIdSet.has(neighborAtomId);
    });
    const rootAtomId = branchRootBond ? (branchRootBond.a === centerAtomId ? branchRootBond.b : branchRootBond.a) : null;
    if (!rootAtomId) {
      continue;
    }

    descriptors.push({
      ringAtomId,
      centerAtomId,
      rootAtomId,
      leafAtomIds,
      ringAtomIds: ringSystem.atomIds ?? [],
      movedAtomIds: [...coords.keys()]
    });
  }
  return descriptors;
}

function addRelaxationMove(moves, atomId, dx, dy) {
  const move = moves.get(atomId);
  if (!move) {
    return;
  }
  move.x += dx;
  move.y += dy;
}

function deterministicRelaxationUnitForAtomPair(firstAtomId, secondAtomId) {
  const seed = `${firstAtomId}:${secondAtomId}`;
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 360;
  }
  const angle = (hash * Math.PI) / 180;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

function relaxExactBridgedSingleOverlapCandidate(layoutGraph, coords, descriptor, bondLength, profile) {
  const candidateCoords = cloneCoords(coords);
  const centerPosition = candidateCoords.get(descriptor.centerAtomId);
  const ringPosition = candidateCoords.get(descriptor.ringAtomId);
  if (!centerPosition || !ringPosition) {
    return null;
  }

  const initialUnit = { x: 3 / Math.sqrt(13), y: 2 / Math.sqrt(13) };
  const initialOffset = bondLength * FINAL_BRIDGED_SINGLE_OVERLAP_RELAXATION_INITIAL_OFFSET_FACTOR;
  candidateCoords.set(descriptor.centerAtomId, {
    x: centerPosition.x + initialUnit.x * initialOffset,
    y: centerPosition.y + initialUnit.y * initialOffset
  });
  candidateCoords.set(descriptor.ringAtomId, {
    x: ringPosition.x - initialUnit.x * initialOffset,
    y: ringPosition.y - initialUnit.y * initialOffset
  });

  const movableAtomIds = [...candidateCoords.keys()].filter(atomId => !layoutGraph.fixedCoords?.has(atomId));
  const movableAtomIdSet = new Set(movableAtomIds);
  const heavyAtomIds = visibleHeavyAtomIdsForCoords(layoutGraph, candidateCoords);
  const heavyAtomIdSet = new Set(heavyAtomIds);
  const bondEntries = [...layoutGraph.bonds.values()]
    .filter(bond => bond?.kind === 'covalent' && candidateCoords.has(bond.a) && candidateCoords.has(bond.b))
    .map(bond => {
      const firstPosition = coords.get(bond.a);
      const secondPosition = coords.get(bond.b);
      const firstHeavy = heavyAtomIdSet.has(bond.a);
      const secondHeavy = heavyAtomIdSet.has(bond.b);
      return {
        firstAtomId: bond.a,
        secondAtomId: bond.b,
        targetDistance:
          firstHeavy && secondHeavy && (bond.order ?? 1) >= 1 && bond.kind === 'covalent'
            ? bondLength
            : firstPosition && secondPosition
              ? Math.hypot(secondPosition.x - firstPosition.x, secondPosition.y - firstPosition.y)
              : bondLength
      };
    });
  const repulsionDistance = bondLength * (profile.repulsionDistanceFactor ?? FINAL_BRIDGED_SINGLE_OVERLAP_RELAXATION_DEFAULT_REPULSION_DISTANCE_FACTOR);

  for (let iteration = 0; iteration < profile.iterations; iteration += 1) {
    const moves = new Map(movableAtomIds.map(atomId => [atomId, { x: 0, y: 0 }]));
    for (const bond of bondEntries) {
      const firstPosition = candidateCoords.get(bond.firstAtomId);
      const secondPosition = candidateCoords.get(bond.secondAtomId);
      if (!firstPosition || !secondPosition) {
        continue;
      }
      const dx = secondPosition.x - firstPosition.x;
      const dy = secondPosition.y - firstPosition.y;
      const distance = Math.hypot(dx, dy);
      if (distance <= PRESENTATION_METRIC_EPSILON) {
        continue;
      }
      const force = (distance - bond.targetDistance) * profile.springStiffness;
      const unit = { x: dx / distance, y: dy / distance };
      addRelaxationMove(moves, bond.firstAtomId, unit.x * force * 0.5, unit.y * force * 0.5);
      addRelaxationMove(moves, bond.secondAtomId, -unit.x * force * 0.5, -unit.y * force * 0.5);
    }

    for (let firstIndex = 0; firstIndex < heavyAtomIds.length; firstIndex += 1) {
      const firstAtomId = heavyAtomIds[firstIndex];
      const firstPosition = candidateCoords.get(firstAtomId);
      if (!firstPosition) {
        continue;
      }
      for (let secondIndex = firstIndex + 1; secondIndex < heavyAtomIds.length; secondIndex += 1) {
        const secondAtomId = heavyAtomIds[secondIndex];
        if (layoutGraph.bondedPairSet.has(atomPairKey(firstAtomId, secondAtomId))) {
          continue;
        }
        const secondPosition = candidateCoords.get(secondAtomId);
        if (!secondPosition) {
          continue;
        }
        let dx = secondPosition.x - firstPosition.x;
        let dy = secondPosition.y - firstPosition.y;
        let distance = Math.hypot(dx, dy);
        if (distance >= repulsionDistance) {
          continue;
        }
        if (distance <= PRESENTATION_METRIC_EPSILON) {
          const unit = deterministicRelaxationUnitForAtomPair(firstAtomId, secondAtomId);
          dx = unit.x;
          dy = unit.y;
          distance = 1;
        }
        const force = (repulsionDistance - distance) * profile.repulsionStiffness;
        const unit = { x: dx / distance, y: dy / distance };
        addRelaxationMove(moves, firstAtomId, -unit.x * force * 0.5, -unit.y * force * 0.5);
        addRelaxationMove(moves, secondAtomId, unit.x * force * 0.5, unit.y * force * 0.5);
      }
    }

    for (const atomId of movableAtomIds) {
      if (!movableAtomIdSet.has(atomId)) {
        continue;
      }
      const move = moves.get(atomId);
      const position = candidateCoords.get(atomId);
      if (!move || !position) {
        continue;
      }
      const moveDistance = Math.hypot(move.x, move.y);
      if (moveDistance <= PRESENTATION_METRIC_EPSILON) {
        continue;
      }
      const scale = Math.min(1, profile.maxStep / moveDistance);
      candidateCoords.set(atomId, {
        x: position.x + move.x * scale,
        y: position.y + move.y * scale
      });
    }
  }

  return candidateCoords;
}

function exactBridgedTerminalMultipleBondCenterRelaxationCanReplace(candidateAudit, baseAudit) {
  const maxAllowedBondDeviation = Math.max(FINAL_BRIDGED_SINGLE_OVERLAP_RELAXATION_MAX_BOND_DEVIATION, baseAudit?.maxBondLengthDeviation ?? 0);
  if (
    !candidateAudit ||
    !baseAudit ||
    candidateAudit.ok !== true ||
    candidateAudit.fallback?.mode != null ||
    (candidateAudit.severeOverlapCount ?? 0) !== 0 ||
    (candidateAudit.bondLengthFailureCount ?? 0) !== 0 ||
    (candidateAudit.labelOverlapCount ?? 0) !== 0 ||
    (candidateAudit.ringSubstituentReadabilityFailureCount ?? 0) !== 0 ||
    (candidateAudit.inwardRingSubstituentCount ?? 0) !== 0 ||
    (candidateAudit.outwardAxisRingSubstituentFailureCount ?? 0) !== 0 ||
    (candidateAudit.collapsedMacrocycleCount ?? 0) !== 0 ||
    (candidateAudit.stereoContradiction ?? false) ||
    (candidateAudit.visibleHeavyBondCrossingCount ?? 0) > (baseAudit.visibleHeavyBondCrossingCount ?? 0) + 1 ||
    (candidateAudit.maxBondLengthDeviation ?? Number.POSITIVE_INFINITY) > maxAllowedBondDeviation + PRESENTATION_METRIC_EPSILON
  ) {
    return false;
  }
  return (baseAudit.severeOverlapCount ?? 0) > 0;
}

function compareExactBridgedTerminalMultipleBondCenterRelaxationCandidates(candidate, incumbent) {
  if (!incumbent) {
    return -1;
  }
  for (const key of ['visibleHeavyBondCrossingCount', 'bondLengthFailureCount', 'labelOverlapCount']) {
    if ((candidate.audit[key] ?? 0) !== (incumbent.audit[key] ?? 0)) {
      return (candidate.audit[key] ?? 0) - (incumbent.audit[key] ?? 0);
    }
  }
  if (Math.abs((candidate.audit.maxBondLengthDeviation ?? 0) - (incumbent.audit.maxBondLengthDeviation ?? 0)) > PRESENTATION_METRIC_EPSILON) {
    return (candidate.audit.maxBondLengthDeviation ?? 0) - (incumbent.audit.maxBondLengthDeviation ?? 0);
  }
  if (Math.abs(candidate.totalMove - incumbent.totalMove) > PRESENTATION_METRIC_EPSILON) {
    return candidate.totalMove - incumbent.totalMove;
  }
  return `${candidate.ringAtomId}:${candidate.centerAtomId}`.localeCompare(`${incumbent.ringAtomId}:${incumbent.centerAtomId}`, 'en', { numeric: true });
}

function maybeRelaxFinalExactBridgedTerminalMultipleBondCenterOverlaps(layoutGraph, finalCoords, placement, bondLength) {
  const baseAudit = auditLayout(layoutGraph, finalCoords, {
    bondLength,
    bondValidationClasses: placement.bondValidationClasses
  });
  const descriptors = exactBridgedTerminalMultipleBondCenterOverlapDescriptors(layoutGraph, finalCoords, bondLength, baseAudit);
  if (descriptors.length === 0) {
    return { coords: finalCoords, changed: false, movedAtomIds: [], audit: baseAudit };
  }

  let bestCandidate = null;
  for (const descriptor of descriptors) {
    const candidateBondValidationClasses = assignBondValidationClass(layoutGraph, descriptor.ringAtomIds, 'bridged', new Map(placement.bondValidationClasses), { overwrite: true });
    for (const profile of FINAL_BRIDGED_SINGLE_OVERLAP_RELAXATION_PROFILES) {
      const candidateCoords = relaxExactBridgedSingleOverlapCandidate(layoutGraph, finalCoords, descriptor, bondLength, profile);
      if (!candidateCoords) {
        continue;
      }
      const candidateAudit = auditLayout(layoutGraph, candidateCoords, {
        bondLength,
        bondValidationClasses: candidateBondValidationClasses
      });
      if (!exactBridgedTerminalMultipleBondCenterRelaxationCanReplace(candidateAudit, baseAudit)) {
        continue;
      }
      const candidate = {
        coords: candidateCoords,
        audit: candidateAudit,
        ringAtomId: descriptor.ringAtomId,
        centerAtomId: descriptor.centerAtomId,
        bondValidationClasses: candidateBondValidationClasses,
        movedAtomIds: descriptor.movedAtomIds,
        totalMove: finalAcyclicBranchContactCandidateMove(finalCoords, candidateCoords, descriptor.movedAtomIds)
      };
      if (compareExactBridgedTerminalMultipleBondCenterRelaxationCandidates(candidate, bestCandidate) < 0) {
        bestCandidate = candidate;
      }
    }
  }

  if (!bestCandidate) {
    return { coords: finalCoords, changed: false, movedAtomIds: [], audit: baseAudit };
  }
  return {
    coords: bestCandidate.coords,
    changed: true,
    bondValidationClasses: bestCandidate.bondValidationClasses,
    movedAtomIds: bestCandidate.movedAtomIds,
    audit: bestCandidate.audit
  };
}

function bridgedRingSystemForRelaxationAtom(layoutGraph, atomId) {
  const directRingSystem = directBridgedRingSystemForAtom(layoutGraph, atomId);
  if (directRingSystem) {
    return directRingSystem;
  }

  for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) !== 1) {
      continue;
    }
    const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
    const ringSystemId = layoutGraph.atomToRingSystemId.get(neighborAtomId);
    const ringSystem = ringSystemId != null ? layoutGraph.ringSystemById.get(ringSystemId) : null;
    if (ringSystem && hasBridgedConnectionForRingSystem(layoutGraph, ringSystem)) {
      return ringSystem;
    }
  }
  return null;
}

function directRingSystemForAtom(layoutGraph, atomId) {
  const ringSystemId = layoutGraph.atomToRingSystemId.get(atomId);
  return ringSystemId != null ? layoutGraph.ringSystemById.get(ringSystemId) : null;
}

function directBridgedRingSystemForAtom(layoutGraph, atomId) {
  const ringSystem = directRingSystemForAtom(layoutGraph, atomId);
  return ringSystem && hasBridgedConnectionForRingSystem(layoutGraph, ringSystem) ? ringSystem : null;
}

function isCompactAromaticFusedSpiroCoreRingSystem(layoutGraph, ringSystem) {
  const ringIds = new Set(ringSystem?.ringIds ?? []);
  if (
    ringIds.size < FINAL_BRIDGED_SINGLE_OVERLAP_RELAXATION_AROMATIC_CORE_MIN_RING_COUNT ||
    (ringSystem?.atomIds?.length ?? 0) > FINAL_BRIDGED_SINGLE_OVERLAP_RELAXATION_AROMATIC_CORE_MAX_RING_SYSTEM_ATOMS
  ) {
    return false;
  }
  let aromaticAtomCount = 0;
  for (const atomId of ringSystem.atomIds ?? []) {
    const atom = layoutGraph.atoms.get(atomId);
    if (!atom || atom.element === 'H') {
      return false;
    }
    if (atom.aromatic) {
      aromaticAtomCount++;
    }
  }
  const aromaticFraction = aromaticAtomCount / Math.max(1, ringSystem.atomIds?.length ?? 0);
  const hasSpiroConnection = (layoutGraph.ringConnections ?? []).some(connection => connection.kind === 'spiro' && ringIds.has(connection.firstRingId) && ringIds.has(connection.secondRingId));
  return aromaticFraction >= 0.75 && hasSpiroConnection;
}

function aromaticCoreBridgedSingleOverlapRingSystem(layoutGraph, overlap) {
  if (!overlap) {
    return null;
  }
  const firstAtom = layoutGraph.atoms.get(overlap.firstAtomId);
  const secondAtom = layoutGraph.atoms.get(overlap.secondAtomId);
  if (!firstAtom?.aromatic || !secondAtom?.aromatic) {
    return null;
  }
  const firstRingSystem = directRingSystemForAtom(layoutGraph, overlap.firstAtomId);
  const secondRingSystem = directRingSystemForAtom(layoutGraph, overlap.secondAtomId);
  if (!firstRingSystem || firstRingSystem.id !== secondRingSystem?.id) {
    return null;
  }
  return hasBridgedConnectionForRingSystem(layoutGraph, firstRingSystem) || isCompactAromaticFusedSpiroCoreRingSystem(layoutGraph, firstRingSystem) ? firstRingSystem : null;
}

function bridgedSingleOverlapRelaxationDescriptors(layoutGraph, coords, bondLength, baseAudit) {
  if (
    (baseAudit?.severeOverlapCount ?? 0) !== 1 ||
    (baseAudit.visibleHeavyBondCrossingCount ?? 0) > FINAL_BRIDGED_SINGLE_OVERLAP_RELAXATION_MAX_BASE_CROSSINGS ||
    (baseAudit.bondLengthFailureCount ?? 0) > 1 ||
    (baseAudit.labelOverlapCount ?? 0) !== 0 ||
    (baseAudit.ringSubstituentReadabilityFailureCount ?? 0) !== 0 ||
    (baseAudit.inwardRingSubstituentCount ?? 0) !== 0 ||
    (baseAudit.outwardAxisRingSubstituentFailureCount ?? 0) !== 0
  ) {
    return [];
  }

  const overlaps = findSevereOverlapsMatching(layoutGraph, coords, bondLength, (firstAtomId, secondAtomId) => !layoutGraph.bondedPairSet.has(atomPairKey(firstAtomId, secondAtomId)));
  if (overlaps.length !== 1 || (overlaps[0].distance ?? Number.POSITIVE_INFINITY) > bondLength * FINAL_COMPACT_BRIDGED_HETERO_NONBONDED_RING_OVERLAP_DISTANCE_FACTOR) {
    return [];
  }
  const aromaticCoreRingSystem = aromaticCoreBridgedSingleOverlapRingSystem(layoutGraph, overlaps[0]);
  const heavyAtomLimit = aromaticCoreRingSystem ? FINAL_BRIDGED_SINGLE_OVERLAP_RELAXATION_AROMATIC_CORE_MAX_HEAVY_ATOMS : FINAL_BRIDGED_SINGLE_OVERLAP_RELAXATION_MAX_HEAVY_ATOMS;
  if (visibleHeavyAtomCountForCoords(layoutGraph, coords) > heavyAtomLimit) {
    return [];
  }

  const descriptors = [];
  const seen = new Set();
  for (const [centerAtomId, ringAtomId] of [
    [overlaps[0].firstAtomId, overlaps[0].secondAtomId],
    [overlaps[0].secondAtomId, overlaps[0].firstAtomId]
  ]) {
    const centerAtom = layoutGraph.atoms.get(centerAtomId);
    const ringAtom = layoutGraph.atoms.get(ringAtomId);
    if (!centerAtom || !ringAtom || centerAtom.element === 'H' || ringAtom.element === 'H' || !coords.has(centerAtomId) || !coords.has(ringAtomId)) {
      continue;
    }
    const directCenterRingSystem = directRingSystemForAtom(layoutGraph, centerAtomId);
    const directRingRingSystem = directRingSystemForAtom(layoutGraph, ringAtomId);
    const isAromaticCorePair =
      centerAtom.aromatic &&
      ringAtom.aromatic &&
      directCenterRingSystem &&
      directCenterRingSystem.id === directRingRingSystem?.id &&
      (hasBridgedConnectionForRingSystem(layoutGraph, directCenterRingSystem) || isCompactAromaticFusedSpiroCoreRingSystem(layoutGraph, directCenterRingSystem));
    if ((centerAtom.aromatic || ringAtom.aromatic) && !isAromaticCorePair) {
      continue;
    }
    const ringSystem = isAromaticCorePair ? directCenterRingSystem : (bridgedRingSystemForRelaxationAtom(layoutGraph, ringAtomId) ?? bridgedRingSystemForRelaxationAtom(layoutGraph, centerAtomId));
    const ringSystemAtomLimit = isAromaticCorePair ? FINAL_BRIDGED_SINGLE_OVERLAP_RELAXATION_AROMATIC_CORE_MAX_RING_SYSTEM_ATOMS : FINAL_BRIDGED_SINGLE_OVERLAP_RELAXATION_MAX_RING_SYSTEM_ATOMS;
    if (!ringSystem || (ringSystem.atomIds?.length ?? 0) > ringSystemAtomLimit || (ringSystem.ringIds?.length ?? 0) < 2) {
      continue;
    }
    const key = `${centerAtomId}:${ringAtomId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    descriptors.push({
      ringAtomId,
      centerAtomId,
      ringAtomIds: ringSystem.atomIds ?? [],
      movedAtomIds: [...coords.keys()]
    });
  }
  return descriptors;
}

function bridgedSingleOverlapRelaxationCanReplace(candidateAudit, baseAudit) {
  const maxAllowedBondDeviation = Math.max(FINAL_BRIDGED_SINGLE_OVERLAP_RELAXATION_MAX_BOND_DEVIATION, baseAudit?.maxBondLengthDeviation ?? 0);
  if (
    !candidateAudit ||
    !baseAudit ||
    candidateAudit.ok !== true ||
    candidateAudit.fallback?.mode != null ||
    (candidateAudit.severeOverlapCount ?? 0) !== 0 ||
    (candidateAudit.bondLengthFailureCount ?? 0) !== 0 ||
    (candidateAudit.labelOverlapCount ?? 0) !== 0 ||
    (candidateAudit.ringSubstituentReadabilityFailureCount ?? 0) !== 0 ||
    (candidateAudit.inwardRingSubstituentCount ?? 0) !== 0 ||
    (candidateAudit.outwardAxisRingSubstituentFailureCount ?? 0) !== 0 ||
    (candidateAudit.collapsedMacrocycleCount ?? 0) !== 0 ||
    (candidateAudit.stereoContradiction ?? false) ||
    (candidateAudit.visibleHeavyBondCrossingCount ?? 0) > (baseAudit.visibleHeavyBondCrossingCount ?? 0) + 2 ||
    (candidateAudit.maxBondLengthDeviation ?? Number.POSITIVE_INFINITY) > maxAllowedBondDeviation + PRESENTATION_METRIC_EPSILON
  ) {
    return false;
  }
  return (baseAudit.severeOverlapCount ?? 0) > 0;
}

function maybeRelaxFinalBridgedSingleOverlaps(layoutGraph, finalCoords, placement, bondLength) {
  const baseAudit = auditLayout(layoutGraph, finalCoords, {
    bondLength,
    bondValidationClasses: placement.bondValidationClasses
  });
  const descriptors = bridgedSingleOverlapRelaxationDescriptors(layoutGraph, finalCoords, bondLength, baseAudit);
  if (descriptors.length === 0) {
    return { coords: finalCoords, changed: false, movedAtomIds: [], audit: baseAudit };
  }

  let bestCandidate = null;
  for (const descriptor of descriptors) {
    const candidateBondValidationClasses = assignBondValidationClass(layoutGraph, descriptor.ringAtomIds, 'bridged', new Map(placement.bondValidationClasses), { overwrite: true });
    for (const profile of FINAL_BRIDGED_SINGLE_OVERLAP_RELAXATION_PROFILES) {
      const candidateCoords = relaxExactBridgedSingleOverlapCandidate(layoutGraph, finalCoords, descriptor, bondLength, profile);
      if (!candidateCoords) {
        continue;
      }
      const candidateAudit = auditLayout(layoutGraph, candidateCoords, {
        bondLength,
        bondValidationClasses: candidateBondValidationClasses
      });
      if (!bridgedSingleOverlapRelaxationCanReplace(candidateAudit, baseAudit)) {
        continue;
      }
      const candidate = {
        coords: candidateCoords,
        audit: candidateAudit,
        ringAtomId: descriptor.ringAtomId,
        centerAtomId: descriptor.centerAtomId,
        bondValidationClasses: candidateBondValidationClasses,
        movedAtomIds: descriptor.movedAtomIds,
        totalMove: finalAcyclicBranchContactCandidateMove(finalCoords, candidateCoords, descriptor.movedAtomIds)
      };
      if (compareExactBridgedTerminalMultipleBondCenterRelaxationCandidates(candidate, bestCandidate) < 0) {
        bestCandidate = candidate;
      }
    }
  }

  if (!bestCandidate) {
    return { coords: finalCoords, changed: false, movedAtomIds: [], audit: baseAudit };
  }
  return {
    coords: bestCandidate.coords,
    changed: true,
    bondValidationClasses: bestCandidate.bondValidationClasses,
    movedAtomIds: bestCandidate.movedAtomIds,
    audit: bestCandidate.audit
  };
}

function compactBridgedAminoFormylVisibleHeavyAtomCount(layoutGraph, coords) {
  return [...coords.keys()].reduce((count, atomId) => {
    const atom = layoutGraph.atoms.get(atomId);
    return atom && atom.element !== 'H' && atom.visible !== false ? count + 1 : count;
  }, 0);
}

function rotateFinalCompactBridgedAminoFormylSubtree(coords, descriptor, rotation) {
  const anchorPosition = coords.get(descriptor.anchorAtomId);
  if (!anchorPosition) {
    return null;
  }
  const candidateCoords = cloneCoords(coords);
  for (const atomId of descriptor.subtreeAtomIds) {
    const position = coords.get(atomId);
    if (!position) {
      continue;
    }
    candidateCoords.set(atomId, rotateAround(position, anchorPosition, rotation));
  }
  return candidateCoords;
}

function compactBridgedAminoLeafDescriptor(layoutGraph, coords, leafAtomId, blockerAtomId) {
  const leafAtom = layoutGraph.atoms.get(leafAtomId);
  if (
    !leafAtom ||
    leafAtom.element !== 'N' ||
    leafAtom.aromatic === true ||
    (leafAtom.charge ?? 0) !== 0 ||
    (leafAtom.heavyDegree ?? 0) !== 1 ||
    layoutGraph.ringAtomIdSet.has(leafAtomId) ||
    !coords.has(leafAtomId)
  ) {
    return null;
  }

  const anchorBond = (layoutGraph.bondsByAtomId.get(leafAtomId) ?? []).find(bond => {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || bond.inRing || (bond.order ?? 1) !== 1) {
      return false;
    }
    const neighborAtomId = bond.a === leafAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    return neighborAtom && neighborAtom.element !== 'H' && layoutGraph.ringAtomIdSet.has(neighborAtomId) && coords.has(neighborAtomId);
  });
  if (!anchorBond) {
    return null;
  }

  const anchorAtomId = anchorBond.a === leafAtomId ? anchorBond.b : anchorBond.a;
  const blockerRingSystem = bridgedRingSystemForRelaxationAtom(layoutGraph, blockerAtomId);
  const anchorRingSystem = bridgedRingSystemForRelaxationAtom(layoutGraph, anchorAtomId);
  if (!blockerRingSystem || !anchorRingSystem || blockerRingSystem.id !== anchorRingSystem.id) {
    return null;
  }

  const subtreeAtomIds = [...collectCutSubtree(layoutGraph, leafAtomId, anchorAtomId)].filter(atomId => coords.has(atomId));
  const subtreeHeavyAtomIds = subtreeAtomIds.filter(atomId => layoutGraph.atoms.get(atomId)?.element !== 'H');
  if (subtreeHeavyAtomIds.length !== 1 || subtreeHeavyAtomIds[0] !== leafAtomId || subtreeAtomIds.some(atomId => layoutGraph.fixedCoords?.has(atomId))) {
    return null;
  }

  return {
    leafAtomId,
    blockerAtomId,
    anchorAtomId,
    subtreeAtomIds
  };
}

function compactBridgedAminoLeafDescriptors(layoutGraph, coords, bondLength, baseAudit) {
  if ((baseAudit?.severeOverlapCount ?? 0) !== 1) {
    return [];
  }
  const descriptors = [];
  const seen = new Set();
  for (const overlap of findSevereOverlaps(layoutGraph, coords, bondLength)) {
    if (layoutGraph.bondedPairSet.has(atomPairKey(overlap.firstAtomId, overlap.secondAtomId))) {
      continue;
    }
    for (const [leafAtomId, blockerAtomId] of [
      [overlap.firstAtomId, overlap.secondAtomId],
      [overlap.secondAtomId, overlap.firstAtomId]
    ]) {
      const descriptor = compactBridgedAminoLeafDescriptor(layoutGraph, coords, leafAtomId, blockerAtomId);
      if (!descriptor) {
        continue;
      }
      const key = `${descriptor.anchorAtomId}:${descriptor.leafAtomId}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      descriptors.push(descriptor);
    }
  }
  return descriptors;
}

function compactBridgedFormylReadabilityDescriptor(layoutGraph, coords, anchorAtomId, childDescriptor) {
  const rootAtomId = childDescriptor?.childAtomId;
  if (!rootAtomId || childDescriptor.representativeAtomIds?.length !== 1 || childDescriptor.representativeAtomIds[0] !== rootAtomId) {
    return null;
  }
  if (!layoutGraph.ringAtomIdSet.has(anchorAtomId) || layoutGraph.ringAtomIdSet.has(rootAtomId)) {
    return null;
  }
  const rootAtom = layoutGraph.atoms.get(rootAtomId);
  if (!rootAtom || rootAtom.element !== 'C' || rootAtom.aromatic === true || (rootAtom.heavyDegree ?? 0) !== 2 || !coords.has(rootAtomId)) {
    return null;
  }
  const anchorRingSystem = bridgedRingSystemForRelaxationAtom(layoutGraph, anchorAtomId);
  if (!anchorRingSystem || (anchorRingSystem.atomIds?.length ?? 0) > FINAL_BRIDGED_SINGLE_OVERLAP_RELAXATION_MAX_RING_SYSTEM_ATOMS) {
    return null;
  }

  const anchorBond = layoutGraph.bondByAtomPair.get(atomPairKey(anchorAtomId, rootAtomId));
  if (!anchorBond || anchorBond.kind !== 'covalent' || anchorBond.inRing || anchorBond.aromatic || (anchorBond.order ?? 1) !== 1) {
    return null;
  }

  let terminalOxoAtomId = null;
  for (const bond of layoutGraph.bondsByAtomId.get(rootAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || bond.inRing || (bond.order ?? 1) <= 1) {
      continue;
    }
    const neighborAtomId = bond.a === rootAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (neighborAtom?.element === 'O' && !neighborAtom.aromatic && !layoutGraph.ringAtomIdSet.has(neighborAtomId) && (neighborAtom.heavyDegree ?? 0) === 1 && coords.has(neighborAtomId)) {
      terminalOxoAtomId = neighborAtomId;
      break;
    }
  }
  if (!terminalOxoAtomId) {
    return null;
  }

  const subtreeAtomIds = [...collectCutSubtree(layoutGraph, rootAtomId, anchorAtomId)].filter(atomId => coords.has(atomId));
  const subtreeHeavyAtomIds = subtreeAtomIds.filter(atomId => layoutGraph.atoms.get(atomId)?.element !== 'H');
  if (
    subtreeHeavyAtomIds.length !== 2 ||
    !subtreeHeavyAtomIds.includes(rootAtomId) ||
    !subtreeHeavyAtomIds.includes(terminalOxoAtomId) ||
    subtreeAtomIds.some(atomId => layoutGraph.fixedCoords?.has(atomId))
  ) {
    return null;
  }

  return {
    anchorAtomId,
    rootAtomId,
    terminalOxoAtomId,
    subtreeAtomIds
  };
}

function compactBridgedFormylReadabilityDescriptors(layoutGraph, coords) {
  const descriptors = [];
  const seen = new Set();
  for (const anchorAtomId of coords.keys()) {
    if (!layoutGraph.ringAtomIdSet.has(anchorAtomId)) {
      continue;
    }
    for (const childDescriptor of collectReadableRingSubstituentChildren(layoutGraph, coords, anchorAtomId)) {
      const descriptor = compactBridgedFormylReadabilityDescriptor(layoutGraph, coords, anchorAtomId, childDescriptor);
      if (!descriptor) {
        continue;
      }
      const key = `${descriptor.anchorAtomId}:${descriptor.rootAtomId}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      descriptors.push(descriptor);
    }
  }
  return descriptors;
}

function compactBridgedAminoFormylSeedCanRelax(seedAudit, baseAudit) {
  return (
    seedAudit &&
    baseAudit &&
    (seedAudit.severeOverlapCount ?? 0) === 1 &&
    (seedAudit.ringSubstituentReadabilityFailureCount ?? 0) === 0 &&
    (seedAudit.inwardRingSubstituentCount ?? 0) === 0 &&
    (seedAudit.outwardAxisRingSubstituentFailureCount ?? 0) === 0 &&
    (seedAudit.bondLengthFailureCount ?? 0) <= (baseAudit.bondLengthFailureCount ?? 0) &&
    (seedAudit.labelOverlapCount ?? 0) <= (baseAudit.labelOverlapCount ?? 0) &&
    (seedAudit.collapsedMacrocycleCount ?? 0) <= (baseAudit.collapsedMacrocycleCount ?? 0) &&
    (seedAudit.visibleHeavyBondCrossingCount ?? 0) <= (baseAudit.visibleHeavyBondCrossingCount ?? 0) + 2 &&
    !(seedAudit.stereoContradiction ?? false)
  );
}

function compactBridgedAminoFormylCandidateCanReplace(candidateAudit, baseAudit) {
  return (
    candidateAudit?.ok === true &&
    candidateAudit.fallback?.mode == null &&
    (candidateAudit.severeOverlapCount ?? 0) === 0 &&
    (candidateAudit.bondLengthFailureCount ?? 0) === 0 &&
    (candidateAudit.labelOverlapCount ?? 0) === 0 &&
    (candidateAudit.ringSubstituentReadabilityFailureCount ?? 0) === 0 &&
    (candidateAudit.inwardRingSubstituentCount ?? 0) === 0 &&
    (candidateAudit.outwardAxisRingSubstituentFailureCount ?? 0) === 0 &&
    (candidateAudit.collapsedMacrocycleCount ?? 0) === 0 &&
    (candidateAudit.stereoContradiction ?? false) === false &&
    (candidateAudit.visibleHeavyBondCrossingCount ?? 0) <= (baseAudit.visibleHeavyBondCrossingCount ?? 0) + 2 &&
    (candidateAudit.maxBondLengthDeviation ?? Number.POSITIVE_INFINITY) <= FINAL_BRIDGED_SINGLE_OVERLAP_RELAXATION_MAX_BOND_DEVIATION
  );
}

function compareCompactBridgedAminoFormylCandidates(candidate, incumbent) {
  if (!incumbent) {
    return -1;
  }
  for (const key of ['severeOverlapCount', 'ringSubstituentReadabilityFailureCount', 'bondLengthFailureCount', 'labelOverlapCount', 'visibleHeavyBondCrossingCount']) {
    if ((candidate.audit[key] ?? 0) !== (incumbent.audit[key] ?? 0)) {
      return (candidate.audit[key] ?? 0) - (incumbent.audit[key] ?? 0);
    }
  }
  if (Math.abs((candidate.audit.maxBondLengthDeviation ?? 0) - (incumbent.audit.maxBondLengthDeviation ?? 0)) > PRESENTATION_METRIC_EPSILON) {
    return (candidate.audit.maxBondLengthDeviation ?? 0) - (incumbent.audit.maxBondLengthDeviation ?? 0);
  }
  if (Math.abs(candidate.totalMove - incumbent.totalMove) > PRESENTATION_METRIC_EPSILON) {
    return candidate.totalMove - incumbent.totalMove;
  }
  if (Math.abs(candidate.rotationMagnitude - incumbent.rotationMagnitude) > PRESENTATION_METRIC_EPSILON) {
    return candidate.rotationMagnitude - incumbent.rotationMagnitude;
  }
  return candidate.key.localeCompare(incumbent.key, 'en', { numeric: true });
}

function maybeRetouchFinalCompactBridgedAminoFormylOverlap(layoutGraph, finalCoords, placement, bondLength) {
  const baseAudit = auditLayout(layoutGraph, finalCoords, {
    bondLength,
    bondValidationClasses: placement.bondValidationClasses
  });
  if (
    (baseAudit.severeOverlapCount ?? 0) !== 1 ||
    (baseAudit.bondLengthFailureCount ?? 0) !== 0 ||
    (baseAudit.labelOverlapCount ?? 0) !== 0 ||
    (baseAudit.ringSubstituentReadabilityFailureCount ?? 0) !== 1 ||
    (baseAudit.collapsedMacrocycleCount ?? 0) !== 0 ||
    (baseAudit.stereoContradiction ?? false) ||
    compactBridgedAminoFormylVisibleHeavyAtomCount(layoutGraph, finalCoords) > FINAL_COMPACT_BRIDGED_AMINO_FORMYL_RETOUCH_MAX_HEAVY_ATOMS
  ) {
    return { coords: finalCoords, changed: false, movedAtomIds: [], audit: baseAudit };
  }

  const aminoDescriptors = compactBridgedAminoLeafDescriptors(layoutGraph, finalCoords, bondLength, baseAudit);
  const formylDescriptors = compactBridgedFormylReadabilityDescriptors(layoutGraph, finalCoords);
  if (aminoDescriptors.length === 0 || formylDescriptors.length === 0) {
    return { coords: finalCoords, changed: false, movedAtomIds: [], audit: baseAudit };
  }

  let bestCandidate = null;
  for (const aminoDescriptor of aminoDescriptors) {
    for (const formylDescriptor of formylDescriptors) {
      for (const aminoRotation of FINAL_COMPACT_BRIDGED_AMINO_FORMYL_AMINO_ROTATIONS) {
        const aminoCoords = rotateFinalCompactBridgedAminoFormylSubtree(finalCoords, aminoDescriptor, aminoRotation);
        if (!aminoCoords) {
          continue;
        }
        for (const formylRotation of FINAL_COMPACT_BRIDGED_AMINO_FORMYL_FORMYL_ROTATIONS) {
          const seedCoords = rotateFinalCompactBridgedAminoFormylSubtree(aminoCoords, formylDescriptor, formylRotation);
          if (!seedCoords) {
            continue;
          }
          const seedAudit = auditLayout(layoutGraph, seedCoords, {
            bondLength,
            bondValidationClasses: placement.bondValidationClasses
          });
          if (!compactBridgedAminoFormylSeedCanRelax(seedAudit, baseAudit)) {
            continue;
          }

          const relaxed = maybeRelaxFinalBridgedSingleOverlaps(layoutGraph, seedCoords, placement, bondLength);
          if (!relaxed.changed || !compactBridgedAminoFormylCandidateCanReplace(relaxed.audit, baseAudit)) {
            continue;
          }

          const movedAtomIds = [...new Set([...aminoDescriptor.subtreeAtomIds, ...formylDescriptor.subtreeAtomIds, ...(relaxed.movedAtomIds ?? [])])];
          const candidate = {
            coords: relaxed.coords,
            audit: relaxed.audit,
            bondValidationClasses: relaxed.bondValidationClasses,
            movedAtomIds,
            key: `${aminoDescriptor.anchorAtomId}:${aminoDescriptor.leafAtomId}:${formylDescriptor.anchorAtomId}:${formylDescriptor.rootAtomId}`,
            rotationMagnitude: Math.abs(aminoRotation) + Math.abs(formylRotation),
            totalMove: finalAcyclicBranchContactCandidateMove(finalCoords, relaxed.coords, movedAtomIds)
          };
          if (compareCompactBridgedAminoFormylCandidates(candidate, bestCandidate) < 0) {
            bestCandidate = candidate;
          }
        }
      }
    }
  }

  if (!bestCandidate) {
    return { coords: finalCoords, changed: false, movedAtomIds: [], audit: baseAudit };
  }
  return {
    coords: bestCandidate.coords,
    changed: true,
    bondValidationClasses: bestCandidate.bondValidationClasses,
    movedAtomIds: bestCandidate.movedAtomIds,
    audit: bestCandidate.audit
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
  if (retouchPlan.candidateCenterIds.length === 0 && retouchPlan.hiddenHydrogenCandidateCenterIds.length === 0 && retouchPlan.pairedTerminalHeteroCandidateCenterIds.length === 0) {
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

function maybeRetouchFinalTerminalMultipleBondLeafFansCenterwise(layoutGraph, finalCoords, placement, bondLength) {
  const retouchPlan = collectTerminalMultipleBondLeafFanRetouchCenters(layoutGraph, finalCoords, {
    frozenAtomIds: placement.frozenAtomIds
  });
  const basePenalty = {
    totalDeviation: retouchPlan.totalDeviation,
    maxDeviation: retouchPlan.maxDeviation
  };
  if ((basePenalty.maxDeviation ?? 0) <= PRESENTATION_METRIC_EPSILON || retouchPlan.candidateCenterIds.length === 0) {
    return { coords: finalCoords, changed: false, nudges: 0, maxDeviationBefore: basePenalty.maxDeviation, maxDeviationAfter: basePenalty.maxDeviation };
  }

  let currentCoords = finalCoords;
  let currentPenalty = measureTerminalMultipleBondLeafFanPenalty(layoutGraph, currentCoords);
  let currentAudit = auditLayout(layoutGraph, currentCoords, {
    bondLength,
    bondValidationClasses: placement.bondValidationClasses
  });
  let nudges = 0;

  for (const centerAtomId of retouchPlan.candidateCenterIds) {
    const retouch = runTerminalMultipleBondLeafFanTidy(layoutGraph, currentCoords, {
      bondLength,
      bondValidationClasses: placement.bondValidationClasses,
      frozenAtomIds: placement.frozenAtomIds,
      candidateCenterIds: [centerAtomId],
      hiddenHydrogenCandidateCenterIds: []
    });
    if ((retouch.nudges ?? 0) <= 0) {
      continue;
    }

    const candidatePenalty = measureTerminalMultipleBondLeafFanPenalty(layoutGraph, retouch.coords);
    if (
      (candidatePenalty.maxDeviation ?? Number.POSITIVE_INFINITY) >= (currentPenalty.maxDeviation ?? Number.POSITIVE_INFINITY) - PRESENTATION_METRIC_EPSILON &&
      (candidatePenalty.totalDeviation ?? Number.POSITIVE_INFINITY) >= (currentPenalty.totalDeviation ?? Number.POSITIVE_INFINITY) - PRESENTATION_METRIC_EPSILON
    ) {
      continue;
    }

    const candidateAudit = auditLayout(layoutGraph, retouch.coords, {
      bondLength,
      bondValidationClasses: placement.bondValidationClasses
    });
    if (!finalAuditCountsDoNotWorsen(candidateAudit, currentAudit)) {
      continue;
    }

    currentCoords = retouch.coords;
    currentPenalty = candidatePenalty;
    currentAudit = candidateAudit;
    nudges += retouch.nudges ?? 0;
  }

  return {
    coords: currentCoords,
    changed: nudges > 0,
    nudges,
    maxDeviationBefore: basePenalty.maxDeviation,
    maxDeviationAfter: currentPenalty.maxDeviation,
    totalDeviationBefore: basePenalty.totalDeviation,
    totalDeviationAfter: currentPenalty.totalDeviation
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
    resolveMixedAcylBranchSevereContacts(layoutGraph, candidateCoords, placement.bondValidationClasses, bondLength, {
      fastAcceptClean: true
    });
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
  if (!finalAuditCountsDoNotWorsen(projection.audit, baseAudit)) {
    return { coords: finalCoords, changed: false };
  }

  let candidateCoords = projection.coords;
  let movedAtomCount = projection.movedAtomIds.length;
  const candidateBondValidationClasses = projection.bondValidationClasses instanceof Map ? projection.bondValidationClasses : placement.bondValidationClasses;
  let candidateAudit = projection.audit;
  if (!candidateAudit?.ok) {
    const projectedHypervalentRetouch = runRingChainHypervalentBranchRetouch(layoutGraph, candidateCoords, {
      bondLength,
      bondValidationClasses: candidateBondValidationClasses
    });
    if (projectedHypervalentRetouch.changed) {
      candidateCoords = projectedHypervalentRetouch.coords;
      movedAtomCount += projectedHypervalentRetouch.movedAtomIds.length;
    }
    const projectedTerminalRetouch = runTerminalAcyclicChainRetouch(layoutGraph, candidateCoords, {
      bondLength,
      bondValidationClasses: candidateBondValidationClasses
    });
    if (projectedTerminalRetouch.changed) {
      candidateCoords = projectedTerminalRetouch.coords;
      movedAtomCount += projectedTerminalRetouch.movedAtomIds.length;
    }
    const projectedSideBranchRetouch = runRingChainSideBranchExitRetouch(layoutGraph, candidateCoords, {
      bondLength,
      bondValidationClasses: candidateBondValidationClasses
    });
    if (projectedSideBranchRetouch.changed) {
      candidateCoords = projectedSideBranchRetouch.coords;
      movedAtomCount += projectedSideBranchRetouch.movedAtomIds.length;
    }

    candidateAudit = auditLayout(layoutGraph, candidateCoords, {
      bondLength,
      bondValidationClasses: candidateBondValidationClasses
    });
  }
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
  if (projection.bondValidationClasses instanceof Map) {
    placement.bondValidationClasses = projection.bondValidationClasses;
  }
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

  const divalentContinuationPenalty = measureDivalentContinuationDistortion(layoutGraph, coords);
  if (divalentContinuationPenalty.maxDeviation > PRESENTATION_METRIC_EPSILON || divalentContinuationPenalty.totalDeviation > PRESENTATION_METRIC_EPSILON) {
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
    (audit.labelOverlapCount ?? 0) === 0 &&
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

function shouldSkipLargeMacrocycleRingFanPolishWithoutHardResidual(layoutGraph, familySummary, audit) {
  const heavyAtomCount = layoutGraph.traits?.heavyAtomCount ?? layoutGraph.atoms?.size ?? 0;
  return (
    familySummary.primaryFamily === 'macrocycle' &&
    familySummary.mixedMode === true &&
    heavyAtomCount >= LARGE_MACROCYCLE_RING_FAN_BOUNDED_SEARCH_MIN_HEAVY_ATOMS &&
    audit != null &&
    (audit.severeOverlapCount ?? 0) === 0 &&
    (audit.visibleHeavyBondCrossingCount ?? 0) === 0 &&
    (audit.labelOverlapCount ?? 0) === 0 &&
    (audit.bondLengthFailureCount ?? 0) === 0 &&
    (audit.collapsedMacrocycleCount ?? 0) === 0 &&
    (audit.stereoContradiction ?? false) === false
  );
}

function shouldSkipDirtyLargeMacrocycleRingFanPolish(layoutGraph, familySummary, audit) {
  const heavyAtomCount = layoutGraph.traits?.heavyAtomCount ?? layoutGraph.atoms?.size ?? 0;
  return (
    familySummary.primaryFamily === 'macrocycle' &&
    familySummary.mixedMode === true &&
    heavyAtomCount >= LARGE_MACROCYCLE_RING_FAN_BOUNDED_SEARCH_MIN_HEAVY_ATOMS &&
    audit != null &&
    (audit.severeOverlapCount ?? 0) === 0 &&
    (audit.visibleHeavyBondCrossingCount ?? 0) === 0 &&
    (audit.labelOverlapCount ?? 0) === 0 &&
    ((audit.bondLengthFailureCount ?? 0) > 0 || audit.fallback?.mode === 'generic-scaffold') &&
    (audit.collapsedMacrocycleCount ?? 0) === 0 &&
    (audit.stereoContradiction ?? false) === false
  );
}

function macrocycleRingFanAngleRetouchOptions(layoutGraph, bondLength, bondValidationClasses) {
  const heavyAtomCount = layoutGraph.traits?.heavyAtomCount ?? layoutGraph.atoms?.size ?? 0;
  const ringCount = layoutGraph.traits?.ringCount ?? layoutGraph.rings?.length ?? 0;
  const baseOptions = {
    bondLength,
    bondValidationClasses
  };
  if (heavyAtomCount >= ULTRA_LARGE_MACROCYCLE_RING_FAN_BOUNDED_SEARCH_MIN_HEAVY_ATOMS) {
    return {
      ...baseOptions,
      maxPasses: 2,
      centerScanLimit: 4,
      directionCount: 8,
      stepFactors: [0.045],
      softContactLeafMaxPasses: 1
    };
  }
  if (heavyAtomCount >= LARGE_MACROCYCLE_RING_FAN_BOUNDED_SEARCH_MIN_HEAVY_ATOMS) {
    return {
      ...baseOptions,
      maxPasses: 2,
      centerScanLimit: 3,
      directionCount: 6,
      stepFactors: [0.045],
      softContactLeafMaxPasses: 1
    };
  }
  if (heavyAtomCount >= MEDIUM_MACROCYCLE_RING_FAN_BOUNDED_SEARCH_MIN_HEAVY_ATOMS && ringCount >= MEDIUM_MACROCYCLE_RING_FAN_BOUNDED_SEARCH_MIN_RINGS) {
    return {
      ...baseOptions,
      maxPasses: 20,
      centerScanLimit: 8,
      directionCount: 8,
      stepFactors: [0.045, 0.027, 0.015],
      softContactLeafMaxPasses: 1
    };
  }
  return baseOptions;
}

function hasCleanFinalRetouchAudit(audit) {
  return (
    audit?.ok === true &&
    (audit.severeOverlapCount ?? 0) === 0 &&
    (audit.visibleHeavyBondCrossingCount ?? 0) === 0 &&
    (audit.labelOverlapCount ?? 0) === 0 &&
    (audit.bondLengthFailureCount ?? 0) === 0 &&
    (audit.collapsedMacrocycleCount ?? 0) === 0 &&
    (audit.stereoContradiction ?? false) === false &&
    audit.fallback?.mode == null
  );
}

function shouldSkipCleanUltraLargeThreeHeavyContinuationRetouch(layoutGraph, familySummary, audit) {
  const heavyAtomCount = layoutGraph.traits?.heavyAtomCount ?? layoutGraph.atoms?.size ?? 0;
  return familySummary.primaryFamily === 'large-molecule' && heavyAtomCount >= ULTRA_LARGE_CLEAN_THREE_HEAVY_RETOUCH_SKIP_MIN_HEAVY_ATOMS && hasCleanFinalRetouchAudit(audit);
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
  let finalCompactBridgedKamadaKawaiRescueAttempted = false;
  const applyFinalCompactBridgedKamadaKawaiRescue = () => {
    if (familySummary.primaryFamily !== 'bridged') {
      return { changed: false, coords: finalCoords, movedAtomIds: [], audit: null };
    }
    if (finalCompactBridgedKamadaKawaiRescueAttempted) {
      return { changed: false, coords: finalCoords, movedAtomIds: [], audit: null };
    }
    finalCompactBridgedKamadaKawaiRescueAttempted = true;
    const finalCompactBridgedKamadaKawaiRescue = timeFinalRetouch('finalCompactBridgedKamadaKawaiRescue', () =>
      maybeRetouchFinalCompactBridgedWholeComponentKamadaKawai(workingMolecule, layoutGraph, finalCoords, placement, normalizedOptions.bondLength)
    );
    if (finalCompactBridgedKamadaKawaiRescue.changed) {
      finalCoords = finalCompactBridgedKamadaKawaiRescue.coords;
      if (finalCompactBridgedKamadaKawaiRescue.bondValidationClasses instanceof Map) {
        placement.bondValidationClasses = finalCompactBridgedKamadaKawaiRescue.bondValidationClasses;
      }
      finalCoordsModified = true;
      onStep?.(
        'Final Compact Bridged KK Rescue',
        'A compact suppressed-hydrogen bridged component was re-solved with a guarded whole-component KK seed after projection left stretched ring bonds.',
        cloneCoords(finalCoords),
        {
          movedAtomCount: finalCompactBridgedKamadaKawaiRescue.movedAtomIds.length,
          bondLengthFailureCountAfter: finalCompactBridgedKamadaKawaiRescue.audit?.bondLengthFailureCount ?? null,
          maxBondLengthDeviationAfter: finalCompactBridgedKamadaKawaiRescue.audit?.maxBondLengthDeviation ?? null
        }
      );
    }
    return finalCompactBridgedKamadaKawaiRescue;
  };
  const applyFinalBridgedSingleOverlapRelaxation = () => {
    if (familySummary.primaryFamily !== 'bridged') {
      return { changed: false, coords: finalCoords, movedAtomIds: [], audit: null };
    }
    const finalBridgedSingleOverlapRelaxation = timeFinalRetouch('finalBridgedSingleOverlapRelaxation', () =>
      maybeRelaxFinalBridgedSingleOverlaps(layoutGraph, finalCoords, placement, normalizedOptions.bondLength)
    );
    if (finalBridgedSingleOverlapRelaxation.changed) {
      const currentAudit = auditLayout(layoutGraph, finalCoords, {
        bondLength: normalizedOptions.bondLength,
        bondValidationClasses: placement.bondValidationClasses
      });
      finalCoords = finalBridgedSingleOverlapRelaxation.coords;
      if (finalBridgedSingleOverlapRelaxation.bondValidationClasses instanceof Map) {
        placement.bondValidationClasses = finalBridgedSingleOverlapRelaxation.bondValidationClasses;
      }
      finalCoordsModified = true;
      onStep?.('Final Bridged Single-Overlap Relaxation', 'A compact bridged single overlap was micro-relaxed before dirty fast-path return.', cloneCoords(finalCoords), {
        movedAtomCount: finalBridgedSingleOverlapRelaxation.movedAtomIds.length,
        severeOverlapCountBefore: currentAudit.severeOverlapCount,
        severeOverlapCountAfter: finalBridgedSingleOverlapRelaxation.audit?.severeOverlapCount ?? null,
        visibleHeavyBondCrossingCountBefore: currentAudit.visibleHeavyBondCrossingCount,
        visibleHeavyBondCrossingCountAfter: finalBridgedSingleOverlapRelaxation.audit?.visibleHeavyBondCrossingCount ?? null,
        maxBondLengthDeviationBefore: currentAudit.maxBondLengthDeviation,
        maxBondLengthDeviationAfter: finalBridgedSingleOverlapRelaxation.audit?.maxBondLengthDeviation ?? null
      });
    }
    return finalBridgedSingleOverlapRelaxation;
  };
  const applyFinalOrganometallicMetalBranchFanRetouch = () => {
    if (familySummary.primaryFamily !== 'organometallic') {
      return { changed: false, coords: finalCoords, movedAtomIds: [] };
    }
    const organometallicMetalBranchFanRetouch = timeFinalRetouch('organometallicMetalBranchFanRetouch', () =>
      runOrganometallicMetalBranchFanRetouch(layoutGraph, finalCoords, {
        bondLength: normalizedOptions.bondLength,
        bondValidationClasses: placement.bondValidationClasses
      })
    );
    if (organometallicMetalBranchFanRetouch.changed) {
      finalCoords = organometallicMetalBranchFanRetouch.coords;
      finalCoordsModified = true;
      onStep?.('Organometallic Metal Branch Fan Retouch', 'A tiny metal-bound branch rotated around its metal center to clear a neighboring ligand atom clash.', cloneCoords(finalCoords), {
        movedAtomCount: organometallicMetalBranchFanRetouch.movedAtomIds.length,
        severeOverlapCountBefore: organometallicMetalBranchFanRetouch.severeOverlapCountBefore,
        severeOverlapCountAfter: organometallicMetalBranchFanRetouch.severeOverlapCountAfter,
        visibleHeavyBondCrossingCountBefore: organometallicMetalBranchFanRetouch.visibleHeavyBondCrossingCountBefore,
        visibleHeavyBondCrossingCountAfter: organometallicMetalBranchFanRetouch.visibleHeavyBondCrossingCountAfter
      });
    }
    return organometallicMetalBranchFanRetouch;
  };
  const applyFinalOrganometallicRingSidechainFanRetouch = () => {
    if (familySummary.primaryFamily !== 'organometallic') {
      return { changed: false, coords: finalCoords, movedAtomIds: [] };
    }
    const organometallicRingSidechainFanRetouch = timeFinalRetouch('organometallicRingSidechainFanRetouch', () =>
      runOrganometallicRingSidechainFanRetouch(layoutGraph, finalCoords, {
        bondLength: normalizedOptions.bondLength,
        bondValidationClasses: placement.bondValidationClasses
      })
    );
    if (organometallicRingSidechainFanRetouch.changed) {
      finalCoords = organometallicRingSidechainFanRetouch.coords;
      finalCoordsModified = true;
      onStep?.('Organometallic Ring Sidechain Fan Retouch', 'A tiny acyclic ligand sidechain rotated outward from a coordinate-bound ring to clear a residual ring clash.', cloneCoords(finalCoords), {
        movedAtomCount: organometallicRingSidechainFanRetouch.movedAtomIds.length,
        severeOverlapCountBefore: organometallicRingSidechainFanRetouch.severeOverlapCountBefore,
        severeOverlapCountAfter: organometallicRingSidechainFanRetouch.severeOverlapCountAfter,
        visibleHeavyBondCrossingCountBefore: organometallicRingSidechainFanRetouch.visibleHeavyBondCrossingCountBefore,
        visibleHeavyBondCrossingCountAfter: organometallicRingSidechainFanRetouch.visibleHeavyBondCrossingCountAfter
      });
    }
    return organometallicRingSidechainFanRetouch;
  };
  if (shouldOrient) {
    finalCoords = orientFinalCoords(repackedCoords, workingMolecule);
    finalCoordsModified = true;
    orientationApplied = true;
  }
  const deferLandscapeForBackboneSpread = shouldPreferFinalLargeMoleculeBackboneSpread(layoutGraph, familySummary);
  if ((shouldEnsureLandscapeFinalCoords(normalizedOptions, policy) && !deferLandscapeForBackboneSpread) || shouldAutoLandscapeLargeDirtyLabelLayout(layoutGraph, normalizedOptions, policy, cleanup)) {
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
    const largeDirtyCompactBridgedKamadaKawaiRescue =
      familySummary.primaryFamily === 'bridged' && compactBridgedWholeComponentKamadaKawaiStructureIsEligible(layoutGraph) ? applyFinalCompactBridgedKamadaKawaiRescue() : { changed: false };
    const largeDirtyBridgedSingleOverlapRelaxation = largeDirtyCompactBridgedKamadaKawaiRescue.changed ? { changed: false } : applyFinalBridgedSingleOverlapRelaxation();
    const largeDirtyOrganometallicMetalBranchFanRetouch =
      largeDirtyCompactBridgedKamadaKawaiRescue.changed || largeDirtyBridgedSingleOverlapRelaxation.changed ? { changed: false } : applyFinalOrganometallicMetalBranchFanRetouch();
    const largeDirtyOrganometallicRingSidechainFanRetouch =
      largeDirtyCompactBridgedKamadaKawaiRescue.changed || largeDirtyBridgedSingleOverlapRelaxation.changed || largeDirtyOrganometallicMetalBranchFanRetouch.changed
        ? { changed: false }
        : applyFinalOrganometallicRingSidechainFanRetouch();
    const largeDirtyTerminalRingLeafIntrusionRetouch =
      largeDirtyCompactBridgedKamadaKawaiRescue.changed ||
      largeDirtyBridgedSingleOverlapRelaxation.changed ||
      largeDirtyOrganometallicMetalBranchFanRetouch.changed ||
      largeDirtyOrganometallicRingSidechainFanRetouch.changed
        ? { nudges: 0 }
        : timeFinalRetouch('largeDirtyTerminalRingLeafIntrusionRetouch', () =>
            runTerminalCarbonRingLeafIntrusionRetidy(layoutGraph, finalCoords, {
              bondLength: normalizedOptions.bondLength,
              frozenAtomIds: placement.frozenAtomIds,
              bondValidationClasses: placement.bondValidationClasses
            })
          );
    if ((largeDirtyTerminalRingLeafIntrusionRetouch.nudges ?? 0) > 0) {
      finalCoords = largeDirtyTerminalRingLeafIntrusionRetouch.coords;
      finalCoordsModified = true;
      onStep?.('Terminal Ring Leaf Retouch', 'Terminal ring leaves pulled back outside incident ring faces before dirty fast-path return.', cloneCoords(finalCoords), {
        nudges: largeDirtyTerminalRingLeafIntrusionRetouch.nudges
      });
    }
    if (
      largeDirtyCompactBridgedKamadaKawaiRescue.changed ||
      largeDirtyBridgedSingleOverlapRelaxation.changed ||
      largeDirtyOrganometallicMetalBranchFanRetouch.changed ||
      largeDirtyOrganometallicRingSidechainFanRetouch.changed ||
      (largeDirtyTerminalRingLeafIntrusionRetouch.nudges ?? 0) > 0
    ) {
      cleanup.finalStageAudit = null;
      cleanup.finalStageStereo = null;
    } else {
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
  }
  if (shouldUseDirtyGenericFinalRetouchFastPath(cleanup, familySummary, normalizedOptions)) {
    const dirtyGenericCompactBridgedKamadaKawaiRescue =
      familySummary.primaryFamily === 'bridged' && compactBridgedWholeComponentKamadaKawaiStructureIsEligible(layoutGraph) ? applyFinalCompactBridgedKamadaKawaiRescue() : { changed: false };
    const dirtyGenericBridgedSingleOverlapRelaxation = dirtyGenericCompactBridgedKamadaKawaiRescue.changed ? { changed: false } : applyFinalBridgedSingleOverlapRelaxation();
    const dirtyGenericOrganometallicMetalBranchFanRetouch =
      dirtyGenericCompactBridgedKamadaKawaiRescue.changed || dirtyGenericBridgedSingleOverlapRelaxation.changed ? { changed: false } : applyFinalOrganometallicMetalBranchFanRetouch();
    const dirtyGenericOrganometallicRingSidechainFanRetouch =
      dirtyGenericCompactBridgedKamadaKawaiRescue.changed || dirtyGenericBridgedSingleOverlapRelaxation.changed || dirtyGenericOrganometallicMetalBranchFanRetouch.changed
        ? { changed: false }
        : applyFinalOrganometallicRingSidechainFanRetouch();
    const dirtyGenericTerminalRingLeafIntrusionRetouch =
      dirtyGenericCompactBridgedKamadaKawaiRescue.changed ||
      dirtyGenericBridgedSingleOverlapRelaxation.changed ||
      dirtyGenericOrganometallicMetalBranchFanRetouch.changed ||
      dirtyGenericOrganometallicRingSidechainFanRetouch.changed
        ? { nudges: 0 }
        : timeFinalRetouch('dirtyGenericTerminalRingLeafIntrusionRetouch', () =>
            runTerminalCarbonRingLeafIntrusionRetidy(layoutGraph, finalCoords, {
              bondLength: normalizedOptions.bondLength,
              frozenAtomIds: placement.frozenAtomIds,
              bondValidationClasses: placement.bondValidationClasses
            })
          );
    if ((dirtyGenericTerminalRingLeafIntrusionRetouch.nudges ?? 0) > 0) {
      finalCoords = dirtyGenericTerminalRingLeafIntrusionRetouch.coords;
      finalCoordsModified = true;
      onStep?.('Terminal Ring Leaf Retouch', 'Terminal ring leaves pulled back outside incident ring faces before dirty fast-path return.', cloneCoords(finalCoords), {
        nudges: dirtyGenericTerminalRingLeafIntrusionRetouch.nudges
      });
    }
    if (
      dirtyGenericCompactBridgedKamadaKawaiRescue.changed ||
      dirtyGenericBridgedSingleOverlapRelaxation.changed ||
      dirtyGenericOrganometallicMetalBranchFanRetouch.changed ||
      dirtyGenericOrganometallicRingSidechainFanRetouch.changed ||
      (dirtyGenericTerminalRingLeafIntrusionRetouch.nudges ?? 0) > 0
    ) {
      cleanup.finalStageAudit = null;
      cleanup.finalStageStereo = null;
    } else {
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
      return buildPipelineResult(molecule, finalCoords, layoutGraph, normalizedOptions, profile, familySummary, policy, placement, cleanup, ringDependency, stereo, timingState, audit);
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
  const terminalCarbonRingLeafIntrusionRetouch = timeFinalRetouch('terminalCarbonRingLeafIntrusionRetouch', () =>
    runTerminalCarbonRingLeafIntrusionRetidy(layoutGraph, finalCoords, {
      bondLength: normalizedOptions.bondLength,
      frozenAtomIds: placement.frozenAtomIds,
      bondValidationClasses: placement.bondValidationClasses
    })
  );
  if ((terminalCarbonRingLeafIntrusionRetouch.nudges ?? 0) > 0) {
    finalCoords = terminalCarbonRingLeafIntrusionRetouch.coords;
    finalCoordsModified = true;
    onStep?.('Terminal Carbon Ring Leaf Retouch', 'Terminal carbon ring leaves pulled back outside incident ring faces.', cloneCoords(finalCoords), {
      nudges: terminalCarbonRingLeafIntrusionRetouch.nudges
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
  const macrocycleRingFanHasHardResiduals = (macrocycleRingFanAudit?.severeOverlapCount ?? 0) > 0 && (macrocycleRingFanAudit?.visibleHeavyBondCrossingCount ?? 0) > 0;
  const shouldSkipHardDirtyLargeMacrocycleRingFanPolish = macrocycleRingFanHasHardResiduals && (layoutGraph.traits.heavyAtomCount ?? 0) >= 150 && (layoutGraph.traits.ringCount ?? 0) >= 8;
  const shouldSkipCleanLargeMacrocycleRingFanPolishForTimeout =
    shouldSkipCleanLargeMacrocycleRingFanPolish(layoutGraph, familySummary, macrocycleRingFanAudit) ||
    shouldSkipLargeMacrocycleRingFanPolishWithoutHardResidual(layoutGraph, familySummary, macrocycleRingFanAudit) ||
    shouldSkipDirtyLargeMacrocycleRingFanPolish(layoutGraph, familySummary, macrocycleRingFanAudit);
  const shouldRunMacrocycleRingFanAngleRetouch =
    familySummary.primaryFamily === 'macrocycle' &&
    familySummary.mixedMode &&
    !shouldSkipHardDirtyLargeMacrocycleRingFanPolish &&
    !shouldSkipCleanLargeMacrocycleRingFanPolishForTimeout &&
    (layoutGraph.traits.ringCount ?? 0) >= 6 &&
    (((layoutGraph.traits.heavyAtomCount ?? 0) >= 100 && (layoutGraph.traits.ringCount ?? 0) >= 8) || (macrocycleRingFanAudit?.severeOverlapCount ?? 0) > 0);
  if (shouldRunMacrocycleRingFanAngleRetouch) {
    const macrocycleRingFanAngleRetouch = timeFinalRetouch('macrocycleRingFanAngleRetouch', () =>
      runMacrocycleRingFanAngleRetouch(layoutGraph, finalCoords, macrocycleRingFanAngleRetouchOptions(layoutGraph, normalizedOptions.bondLength, placement.bondValidationClasses))
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
  const preResidualTerminalAcylCarbonLeafFanRetouch = timeFinalRetouch('preResidualTerminalAcylCarbonLeafFanRetouch', () =>
    maybeRetouchFinalTerminalAcylCarbonLeafFanContacts(layoutGraph, finalCoords, placement, normalizedOptions.bondLength)
  );
  if (preResidualTerminalAcylCarbonLeafFanRetouch.changed) {
    const currentAudit = auditLayout(layoutGraph, finalCoords, {
      bondLength: normalizedOptions.bondLength,
      bondValidationClasses: placement.bondValidationClasses
    });
    finalCoords = preResidualTerminalAcylCarbonLeafFanRetouch.coords;
    finalCoordsModified = true;
    onStep?.('Pre-Residual Terminal Acyl Carbon Leaf Fan Retouch', 'Terminal acyl carbon leaves rotated into a cleaner trigonal fan before attached-ring residual cleanup.', cloneCoords(finalCoords), {
      movedAtomCount: preResidualTerminalAcylCarbonLeafFanRetouch.movedAtomIds.length,
      severeOverlapCountBefore: currentAudit.severeOverlapCount,
      severeOverlapCountAfter: preResidualTerminalAcylCarbonLeafFanRetouch.audit?.severeOverlapCount ?? null,
      visibleHeavyBondCrossingCountBefore: currentAudit.visibleHeavyBondCrossingCount,
      visibleHeavyBondCrossingCountAfter: preResidualTerminalAcylCarbonLeafFanRetouch.audit?.visibleHeavyBondCrossingCount ?? null
    });
  }
  const residualAttachedRingRetouchAudit =
    (familySummary.primaryFamily === 'bridged' || familySummary.mixedMode) && (layoutGraph.traits?.heavyAtomCount ?? layoutGraph.atoms?.size ?? 0) <= 90
      ? auditFinalRetouchCoords(workingMolecule, layoutGraph, finalCoords, placement, normalizedOptions.bondLength)
      : null;
  if ((residualAttachedRingRetouchAudit?.severeOverlapCount ?? 0) > 0) {
    const residualAttachedRingRetouch = timeFinalRetouch('residualAttachedRingRetouch', () =>
      runAttachedRingRotationTouchup(layoutGraph, finalCoords, {
        bondLength: normalizedOptions.bondLength,
        bondValidationClasses: placement.bondValidationClasses,
        frozenAtomIds: placement.frozenAtomIds,
        maxHeavyAtomCount: 90,
        maxAttachedRingSubtreeHeavyAtomCount: 24,
        maxPasses: 2,
        focusSevereOverlaps: true,
        protectBondIntegrity: true
      })
    );
    if ((residualAttachedRingRetouch.nudges ?? 0) > 0) {
      const candidateAudit = auditFinalRetouchCoords(workingMolecule, layoutGraph, residualAttachedRingRetouch.coords, placement, normalizedOptions.bondLength);
      const visibleCrossingAllowance = Math.max(residualAttachedRingRetouchAudit.visibleHeavyBondCrossingCount ?? 0, 1);
      if (
        candidateAudit.ok &&
        (candidateAudit.severeOverlapCount ?? 0) < (residualAttachedRingRetouchAudit.severeOverlapCount ?? 0) &&
        (candidateAudit.bondLengthFailureCount ?? 0) <= (residualAttachedRingRetouchAudit.bondLengthFailureCount ?? 0) &&
        (candidateAudit.ringSubstituentReadabilityFailureCount ?? 0) <= (residualAttachedRingRetouchAudit.ringSubstituentReadabilityFailureCount ?? 0) &&
        (candidateAudit.labelOverlapCount ?? 0) <= (residualAttachedRingRetouchAudit.labelOverlapCount ?? 0) &&
        (candidateAudit.visibleHeavyBondCrossingCount ?? 0) <= visibleCrossingAllowance &&
        !((candidateAudit.stereoContradiction ?? false) && !(residualAttachedRingRetouchAudit.stereoContradiction ?? false))
      ) {
        finalCoords = residualAttachedRingRetouch.coords;
        finalCoordsModified = true;
        onStep?.('Residual Attached Ring Retouch', 'Attached ring subtree nudged away from a compact bridged overlap after final cleanup.', cloneCoords(finalCoords), {
          nudges: residualAttachedRingRetouch.nudges,
          severeOverlapCountBefore: residualAttachedRingRetouchAudit.severeOverlapCount,
          severeOverlapCountAfter: candidateAudit.severeOverlapCount
        });
      }
    }
  }
  const isolatedSiloxaneArylAudit =
    familySummary.primaryFamily === 'isolated-ring' && (layoutGraph.traits?.heavyAtomCount ?? layoutGraph.atoms?.size ?? 0) <= 90
      ? auditFinalRetouchCoords(workingMolecule, layoutGraph, finalCoords, placement, normalizedOptions.bondLength)
      : null;
  if ((isolatedSiloxaneArylAudit?.severeOverlapCount ?? 0) > 0) {
    let siloxaneInputCoords = finalCoords;
    let siloxaneInputAudit = isolatedSiloxaneArylAudit;
    const isolatedAttachedRingRetouch = timeFinalRetouch('isolatedSiloxaneAttachedRingRetouch', () =>
      runAttachedRingRotationTouchup(layoutGraph, finalCoords, {
        bondLength: normalizedOptions.bondLength,
        bondValidationClasses: placement.bondValidationClasses,
        frozenAtomIds: placement.frozenAtomIds,
        maxHeavyAtomCount: 90,
        maxPasses: 2,
        focusSevereOverlaps: true
      })
    );
    if ((isolatedAttachedRingRetouch.nudges ?? 0) > 0) {
      const candidateAudit = auditFinalRetouchCoords(workingMolecule, layoutGraph, isolatedAttachedRingRetouch.coords, placement, normalizedOptions.bondLength);
      if (
        (candidateAudit.ringSubstituentReadabilityFailureCount ?? 0) < (isolatedSiloxaneArylAudit.ringSubstituentReadabilityFailureCount ?? 0) &&
        (candidateAudit.severeOverlapCount ?? 0) <= (isolatedSiloxaneArylAudit.severeOverlapCount ?? 0) &&
        (candidateAudit.bondLengthFailureCount ?? 0) <= (isolatedSiloxaneArylAudit.bondLengthFailureCount ?? 0) &&
        (candidateAudit.labelOverlapCount ?? 0) <= (isolatedSiloxaneArylAudit.labelOverlapCount ?? 0) &&
        (candidateAudit.visibleHeavyBondCrossingCount ?? 0) <= (isolatedSiloxaneArylAudit.visibleHeavyBondCrossingCount ?? 0) &&
        !((candidateAudit.stereoContradiction ?? false) && !(isolatedSiloxaneArylAudit.stereoContradiction ?? false))
      ) {
        siloxaneInputCoords = isolatedAttachedRingRetouch.coords;
        siloxaneInputAudit = candidateAudit;
        finalCoords = isolatedAttachedRingRetouch.coords;
        finalCoordsModified = true;
        onStep?.('Isolated Siloxane Attached Ring Retouch', 'Attached aryl rings around a compact siloxane center rotated into readable exits before overlap clearance.', cloneCoords(finalCoords), {
          nudges: isolatedAttachedRingRetouch.nudges,
          ringSubstituentReadabilityFailureCountBefore: isolatedSiloxaneArylAudit.ringSubstituentReadabilityFailureCount,
          ringSubstituentReadabilityFailureCountAfter: candidateAudit.ringSubstituentReadabilityFailureCount
        });
      }
    }

    const isolatedSiloxaneArylRetouch = timeFinalRetouch('isolatedSiloxaneArylRetouch', () =>
      runSiloxaneArylBranchClearance(layoutGraph, siloxaneInputCoords, {
        bondLength: normalizedOptions.bondLength,
        bondValidationClasses: placement.bondValidationClasses,
        frozenAtomIds: placement.frozenAtomIds
      })
    );
    if (isolatedSiloxaneArylRetouch.changed) {
      const candidateAudit = auditFinalRetouchCoords(workingMolecule, layoutGraph, isolatedSiloxaneArylRetouch.coords, placement, normalizedOptions.bondLength);
      if (
        candidateAudit.ok === true &&
        (candidateAudit.severeOverlapCount ?? 0) < (siloxaneInputAudit.severeOverlapCount ?? 0) &&
        (candidateAudit.bondLengthFailureCount ?? 0) <= (siloxaneInputAudit.bondLengthFailureCount ?? 0) &&
        (candidateAudit.labelOverlapCount ?? 0) <= (siloxaneInputAudit.labelOverlapCount ?? 0) &&
        (candidateAudit.visibleHeavyBondCrossingCount ?? 0) <= (siloxaneInputAudit.visibleHeavyBondCrossingCount ?? 0) &&
        !((candidateAudit.stereoContradiction ?? false) && !(siloxaneInputAudit.stereoContradiction ?? false))
      ) {
        finalCoords = isolatedSiloxaneArylRetouch.coords;
        finalCoordsModified = true;
        onStep?.('Isolated Siloxane Aryl Retouch', 'Compact Si-O-Si aryl branch pair rotated apart to clear residual exact ring overlaps.', cloneCoords(finalCoords), {
          movedAtomCount: isolatedSiloxaneArylRetouch.movedAtomIds.length,
          severeOverlapCountBefore: siloxaneInputAudit.severeOverlapCount,
          severeOverlapCountAfter: candidateAudit.severeOverlapCount
        });
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
    const organometallicCoordinateLigandOutwardRetouch = timeFinalRetouch('organometallicCoordinateLigandOutwardRetouch', () =>
      runOrganometallicCoordinateLigandOutwardRetouch(layoutGraph, finalCoords, {
        bondLength: normalizedOptions.bondLength,
        bondValidationClasses: placement.bondValidationClasses
      })
    );
    if (organometallicCoordinateLigandOutwardRetouch.changed) {
      finalCoords = organometallicCoordinateLigandOutwardRetouch.coords;
      finalCoordsModified = true;
      onStep?.('Organometallic Coordinate Ligand Retouch', 'Small monodentate aromatic ligand translated outward from a crowded metal center.', cloneCoords(finalCoords), {
        movedAtomCount: organometallicCoordinateLigandOutwardRetouch.movedAtomIds.length,
        severeOverlapCountBefore: organometallicCoordinateLigandOutwardRetouch.severeOverlapCountBefore,
        severeOverlapCountAfter: organometallicCoordinateLigandOutwardRetouch.severeOverlapCountAfter,
        visibleHeavyBondCrossingCountBefore: organometallicCoordinateLigandOutwardRetouch.visibleHeavyBondCrossingCountBefore,
        visibleHeavyBondCrossingCountAfter: organometallicCoordinateLigandOutwardRetouch.visibleHeavyBondCrossingCountAfter
      });
    }
    const organometallicRingAtomOverlapRetouch = timeFinalRetouch('organometallicRingAtomOverlapRetouch', () =>
      runOrganometallicRingAtomOverlapRetouch(layoutGraph, finalCoords, {
        bondLength: normalizedOptions.bondLength,
        bondValidationClasses: placement.bondValidationClasses
      })
    );
    if (organometallicRingAtomOverlapRetouch.changed) {
      finalCoords = organometallicRingAtomOverlapRetouch.coords;
      finalCoordsModified = true;
      onStep?.('Organometallic Ring Atom Overlap Retouch', 'Overlapping chelate-ring atoms spread symmetrically while preserving organometallic bond validation.', cloneCoords(finalCoords), {
        movedAtomCount: organometallicRingAtomOverlapRetouch.movedAtomIds.length,
        severeOverlapCountBefore: organometallicRingAtomOverlapRetouch.severeOverlapCountBefore,
        severeOverlapCountAfter: organometallicRingAtomOverlapRetouch.severeOverlapCountAfter,
        maxBondLengthDeviationAfter: organometallicRingAtomOverlapRetouch.maxBondLengthDeviationAfter
      });
    }
    const organometallicMetalBranchFanRetouch = timeFinalRetouch('organometallicMetalBranchFanRetouch', () =>
      runOrganometallicMetalBranchFanRetouch(layoutGraph, finalCoords, {
        bondLength: normalizedOptions.bondLength,
        bondValidationClasses: placement.bondValidationClasses
      })
    );
    if (organometallicMetalBranchFanRetouch.changed) {
      finalCoords = organometallicMetalBranchFanRetouch.coords;
      finalCoordsModified = true;
      onStep?.('Organometallic Metal Branch Fan Retouch', 'A tiny metal-bound branch rotated around its metal center to clear a neighboring ligand atom clash.', cloneCoords(finalCoords), {
        movedAtomCount: organometallicMetalBranchFanRetouch.movedAtomIds.length,
        severeOverlapCountBefore: organometallicMetalBranchFanRetouch.severeOverlapCountBefore,
        severeOverlapCountAfter: organometallicMetalBranchFanRetouch.severeOverlapCountAfter,
        visibleHeavyBondCrossingCountBefore: organometallicMetalBranchFanRetouch.visibleHeavyBondCrossingCountBefore,
        visibleHeavyBondCrossingCountAfter: organometallicMetalBranchFanRetouch.visibleHeavyBondCrossingCountAfter
      });
    }
    const organometallicRingSidechainFanRetouch = timeFinalRetouch('organometallicRingSidechainFanRetouch', () =>
      runOrganometallicRingSidechainFanRetouch(layoutGraph, finalCoords, {
        bondLength: normalizedOptions.bondLength,
        bondValidationClasses: placement.bondValidationClasses
      })
    );
    if (organometallicRingSidechainFanRetouch.changed) {
      finalCoords = organometallicRingSidechainFanRetouch.coords;
      finalCoordsModified = true;
      onStep?.('Organometallic Ring Sidechain Fan Retouch', 'A tiny acyclic ligand sidechain rotated outward from a coordinate-bound ring to clear a residual ring clash.', cloneCoords(finalCoords), {
        movedAtomCount: organometallicRingSidechainFanRetouch.movedAtomIds.length,
        severeOverlapCountBefore: organometallicRingSidechainFanRetouch.severeOverlapCountBefore,
        severeOverlapCountAfter: organometallicRingSidechainFanRetouch.severeOverlapCountAfter,
        visibleHeavyBondCrossingCountBefore: organometallicRingSidechainFanRetouch.visibleHeavyBondCrossingCountBefore,
        visibleHeavyBondCrossingCountAfter: organometallicRingSidechainFanRetouch.visibleHeavyBondCrossingCountAfter
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
        onStep?.(
          'Large Phosphate Linker Continuation Retouch',
          'Phosphate ester P-O-C linkers softly rotated toward exact continuation while preserving clean final audit counts.',
          cloneCoords(finalCoords),
          {
            nudges: largePhosphateLinkerContinuationRetouch.nudges,
            movedAtomCount: largePhosphateLinkerContinuationRetouch.movedAtomIds.length,
            totalDeviationBefore: largePhosphateLinkerContinuationRetouch.totalDeviationBefore,
            totalDeviationAfter: largePhosphateLinkerContinuationRetouch.totalDeviationAfter,
            maxDeviationBefore: largePhosphateLinkerContinuationRetouch.maxDeviationBefore,
            maxDeviationAfter: largePhosphateLinkerContinuationRetouch.maxDeviationAfter
          }
        );
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
        onStep?.(
          'Large Acyclic Ether Linker Continuation Retouch',
          'Large non-aromatic ether exits softly rotated toward exact continuation while preserving clean final audit counts.',
          cloneCoords(finalCoords),
          {
            nudges: largeAcyclicEtherLinkerContinuationRetouch.nudges,
            movedAtomCount: largeAcyclicEtherLinkerContinuationRetouch.movedAtomIds.length,
            totalDeviationBefore: largeAcyclicEtherLinkerContinuationRetouch.totalDeviationBefore,
            totalDeviationAfter: largeAcyclicEtherLinkerContinuationRetouch.totalDeviationAfter,
            maxDeviationBefore: largeAcyclicEtherLinkerContinuationRetouch.maxDeviationBefore,
            maxDeviationAfter: largeAcyclicEtherLinkerContinuationRetouch.maxDeviationAfter
          }
        );
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
  let skipDirtyGenericFinalTerminalMultipleBondFanRetouch = false;
  if (!skipDirtyUltraLargeFinalPresentationRetouches && shouldSkipDirtyGenericFinalTerminalMultipleBondFanRetouch(familySummary, cleanup.finalStageAudit)) {
    const currentAudit =
      finalCoordsModified || crossingTerminalMultipleBondRetouch.changed
        ? timeFinalRetouch('finalTerminalMultipleBondFanDirtyAudit', () =>
            auditLayout(layoutGraph, finalCoords, {
              bondLength: normalizedOptions.bondLength,
              bondValidationClasses: placement.bondValidationClasses
            })
          )
        : cleanup.finalStageAudit;
    skipDirtyGenericFinalTerminalMultipleBondFanRetouch = shouldSkipDirtyGenericFinalTerminalMultipleBondFanRetouch(familySummary, currentAudit);
  }
  if (!skipDirtyUltraLargeFinalPresentationRetouches && !skipDirtyGenericFinalTerminalMultipleBondFanRetouch) {
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
  const finalTerminalAcylCarbonLeafFanRetouch = timeFinalRetouch('finalTerminalAcylCarbonLeafFanRetouch', () =>
    maybeRetouchFinalTerminalAcylCarbonLeafFanContacts(layoutGraph, finalCoords, placement, normalizedOptions.bondLength)
  );
  if (finalTerminalAcylCarbonLeafFanRetouch.changed) {
    const currentAudit = auditLayout(layoutGraph, finalCoords, {
      bondLength: normalizedOptions.bondLength,
      bondValidationClasses: placement.bondValidationClasses
    });
    finalCoords = finalTerminalAcylCarbonLeafFanRetouch.coords;
    finalCoordsModified = true;
    onStep?.('Final Terminal Acyl Carbon Leaf Fan Retouch', 'Terminal acyl carbon leaves rotated into a cleaner trigonal fan when that clears residual severe contacts.', cloneCoords(finalCoords), {
      movedAtomCount: finalTerminalAcylCarbonLeafFanRetouch.movedAtomIds.length,
      severeOverlapCountBefore: currentAudit.severeOverlapCount,
      severeOverlapCountAfter: finalTerminalAcylCarbonLeafFanRetouch.audit?.severeOverlapCount ?? null,
      visibleHeavyBondCrossingCountBefore: currentAudit.visibleHeavyBondCrossingCount,
      visibleHeavyBondCrossingCountAfter: finalTerminalAcylCarbonLeafFanRetouch.audit?.visibleHeavyBondCrossingCount ?? null
    });
  }
  const finalTerminalCarbonylOxoContactRetouch = timeFinalRetouch('finalTerminalCarbonylOxoContactRetouch', () =>
    maybeRetouchFinalTerminalCarbonylOxoSevereContacts(layoutGraph, finalCoords, placement, normalizedOptions.bondLength)
  );
  if (finalTerminalCarbonylOxoContactRetouch.changed) {
    const currentAudit = auditLayout(layoutGraph, finalCoords, {
      bondLength: normalizedOptions.bondLength,
      bondValidationClasses: placement.bondValidationClasses
    });
    finalCoords = finalTerminalCarbonylOxoContactRetouch.coords;
    finalCoordsModified = true;
    onStep?.('Final Terminal Carbonyl Oxo Retouch', 'Terminal carbonyl oxygen leaves rotated out of residual severe contacts without moving their carbonyl centers.', cloneCoords(finalCoords), {
      movedAtomCount: finalTerminalCarbonylOxoContactRetouch.movedAtomIds.length,
      severeOverlapCountBefore: currentAudit.severeOverlapCount,
      severeOverlapCountAfter: finalTerminalCarbonylOxoContactRetouch.audit?.severeOverlapCount ?? null,
      visibleHeavyBondCrossingCountBefore: currentAudit.visibleHeavyBondCrossingCount,
      visibleHeavyBondCrossingCountAfter: finalTerminalCarbonylOxoContactRetouch.audit?.visibleHeavyBondCrossingCount ?? null
    });
  }
  const finalTerminalCarbonLeafContactRetouch = timeFinalRetouch('finalTerminalCarbonLeafContactRetouch', () =>
    maybeRetouchFinalTerminalCarbonLeafSevereContacts(layoutGraph, finalCoords, placement, normalizedOptions.bondLength, {
      includeSingleBondHeteroLeaves: true,
      includeMultipleBondHeteroLeaves: true
    })
  );
  if (finalTerminalCarbonLeafContactRetouch.changed) {
    const currentAudit = auditLayout(layoutGraph, finalCoords, {
      bondLength: normalizedOptions.bondLength,
      bondValidationClasses: placement.bondValidationClasses
    });
    finalCoords = finalTerminalCarbonLeafContactRetouch.coords;
    finalCoordsModified = true;
    onStep?.(
      'Final Terminal Leaf Retouch',
      'Terminal carbon, halogen, acyclic single-bond hetero, and terminal oxo leaves rotated out of residual severe contacts and crossings without moving ring atoms.',
      cloneCoords(finalCoords),
      {
        movedAtomCount: finalTerminalCarbonLeafContactRetouch.movedAtomIds.length,
        severeOverlapCountBefore: currentAudit.severeOverlapCount,
        severeOverlapCountAfter: finalTerminalCarbonLeafContactRetouch.audit?.severeOverlapCount ?? null,
        visibleHeavyBondCrossingCountBefore: currentAudit.visibleHeavyBondCrossingCount,
        visibleHeavyBondCrossingCountAfter: finalTerminalCarbonLeafContactRetouch.audit?.visibleHeavyBondCrossingCount ?? null
      }
    );
  }
  const finalTerminalPairedHalogenLeafContactRetouch = timeFinalRetouch('finalTerminalPairedHalogenLeafContactRetouch', () =>
    maybeRetouchFinalTerminalPairedHalogenLeafSevereContacts(layoutGraph, finalCoords, placement, normalizedOptions.bondLength)
  );
  if (finalTerminalPairedHalogenLeafContactRetouch.changed) {
    const currentAudit = auditLayout(layoutGraph, finalCoords, {
      bondLength: normalizedOptions.bondLength,
      bondValidationClasses: placement.bondValidationClasses
    });
    finalCoords = finalTerminalPairedHalogenLeafContactRetouch.coords;
    finalCoordsModified = true;
    onStep?.(
      'Final Paired Terminal Halogen Retouch',
      'Neighboring terminal halogen leaves rotated together to clear residual severe contacts without moving their carbon anchors.',
      cloneCoords(finalCoords),
      {
        movedAtomCount: finalTerminalPairedHalogenLeafContactRetouch.movedAtomIds.length,
        severeOverlapCountBefore: currentAudit.severeOverlapCount,
        severeOverlapCountAfter: finalTerminalPairedHalogenLeafContactRetouch.audit?.severeOverlapCount ?? null,
        visibleHeavyBondCrossingCountBefore: currentAudit.visibleHeavyBondCrossingCount,
        visibleHeavyBondCrossingCountAfter: finalTerminalPairedHalogenLeafContactRetouch.audit?.visibleHeavyBondCrossingCount ?? null
      }
    );
  }
  const finalTerminalMultipleBondBranchContactRetouch = timeFinalRetouch('finalTerminalMultipleBondBranchContactRetouch', () =>
    maybeRetouchFinalTerminalMultipleBondBranchSevereContacts(layoutGraph, finalCoords, placement, normalizedOptions.bondLength)
  );
  if (finalTerminalMultipleBondBranchContactRetouch.changed) {
    const currentAudit = auditLayout(layoutGraph, finalCoords, {
      bondLength: normalizedOptions.bondLength,
      bondValidationClasses: placement.bondValidationClasses
    });
    finalCoords = finalTerminalMultipleBondBranchContactRetouch.coords;
    finalCoordsModified = true;
    onStep?.(
      'Final Terminal Multiple-Bond Branch Retouch',
      'Small terminal multiple-bond branches rotated around their single-bond pivot to clear residual severe contacts while preserving the local fan.',
      cloneCoords(finalCoords),
      {
        movedAtomCount: finalTerminalMultipleBondBranchContactRetouch.movedAtomIds.length,
        severeOverlapCountBefore: currentAudit.severeOverlapCount,
        severeOverlapCountAfter: finalTerminalMultipleBondBranchContactRetouch.audit?.severeOverlapCount ?? null,
        visibleHeavyBondCrossingCountBefore: currentAudit.visibleHeavyBondCrossingCount,
        visibleHeavyBondCrossingCountAfter: finalTerminalMultipleBondBranchContactRetouch.audit?.visibleHeavyBondCrossingCount ?? null
      }
    );
  }
  if (familySummary.primaryFamily !== 'acyclic') {
    const finalSmallAcyclicBranchContactRetouch = timeFinalRetouch('finalSmallAcyclicBranchContactRetouch', () =>
      maybeRetouchFinalAcyclicBranchSevereContacts(layoutGraph, finalCoords, placement, normalizedOptions.bondLength)
    );
    if (finalSmallAcyclicBranchContactRetouch.changed) {
      const currentAudit = auditLayout(layoutGraph, finalCoords, {
        bondLength: normalizedOptions.bondLength,
        bondValidationClasses: placement.bondValidationClasses
      });
      finalCoords = finalSmallAcyclicBranchContactRetouch.coords;
      finalCoordsModified = true;
      onStep?.(
        'Final Small Acyclic Branch Retouch',
        'Small non-ring branches in mixed layouts rotated out of residual severe contacts while preserving audited bond geometry.',
        cloneCoords(finalCoords),
        {
          movedAtomCount: finalSmallAcyclicBranchContactRetouch.movedAtomIds.length,
          severeOverlapCountBefore: currentAudit.severeOverlapCount,
          severeOverlapCountAfter: finalSmallAcyclicBranchContactRetouch.audit?.severeOverlapCount ?? null,
          visibleHeavyBondCrossingCountBefore: currentAudit.visibleHeavyBondCrossingCount,
          visibleHeavyBondCrossingCountAfter: finalSmallAcyclicBranchContactRetouch.audit?.visibleHeavyBondCrossingCount ?? null
        }
      );

      const finalPostBranchTerminalAcylCarbonLeafFanRetouch = timeFinalRetouch('finalPostBranchTerminalAcylCarbonLeafFanRetouch', () =>
        maybeRetouchFinalTerminalAcylCarbonLeafFanContacts(layoutGraph, finalCoords, placement, normalizedOptions.bondLength)
      );
      if (finalPostBranchTerminalAcylCarbonLeafFanRetouch.changed) {
        const postBranchCurrentAudit = auditLayout(layoutGraph, finalCoords, {
          bondLength: normalizedOptions.bondLength,
          bondValidationClasses: placement.bondValidationClasses
        });
        finalCoords = finalPostBranchTerminalAcylCarbonLeafFanRetouch.coords;
        finalCoordsModified = true;
        onStep?.('Final Post-Branch Terminal Acyl Leaf Retouch', 'Terminal acyl carbon leaves rotated after branch cleanup to clear residual fused-ring contacts.', cloneCoords(finalCoords), {
          movedAtomCount: finalPostBranchTerminalAcylCarbonLeafFanRetouch.movedAtomIds.length,
          severeOverlapCountBefore: postBranchCurrentAudit.severeOverlapCount,
          severeOverlapCountAfter: finalPostBranchTerminalAcylCarbonLeafFanRetouch.audit?.severeOverlapCount ?? null,
          visibleHeavyBondCrossingCountBefore: postBranchCurrentAudit.visibleHeavyBondCrossingCount,
          visibleHeavyBondCrossingCountAfter: finalPostBranchTerminalAcylCarbonLeafFanRetouch.audit?.visibleHeavyBondCrossingCount ?? null
        });
      }
    }
    if (familySummary.primaryFamily === 'fused') {
      const finalFusedAcyclicSidechainContactRetouch = timeFinalRetouch('finalFusedAcyclicSidechainContactRetouch', () =>
        maybeRetouchFinalFusedAcyclicSidechainSevereContacts(layoutGraph, finalCoords, placement, normalizedOptions.bondLength)
      );
      if (finalFusedAcyclicSidechainContactRetouch.changed) {
        const currentAudit = auditLayout(layoutGraph, finalCoords, {
          bondLength: normalizedOptions.bondLength,
          bondValidationClasses: placement.bondValidationClasses
        });
        finalCoords = finalFusedAcyclicSidechainContactRetouch.coords;
        finalCoordsModified = true;
        onStep?.(
          'Final Fused Acyclic Sidechain Retouch',
          'Larger fused-scaffold acyclic sidechains rotated as one subtree when that clears a residual severe contact cleanly.',
          cloneCoords(finalCoords),
          {
            movedAtomCount: finalFusedAcyclicSidechainContactRetouch.movedAtomIds.length,
            severeOverlapCountBefore: currentAudit.severeOverlapCount,
            severeOverlapCountAfter: finalFusedAcyclicSidechainContactRetouch.audit?.severeOverlapCount ?? null,
            visibleHeavyBondCrossingCountBefore: currentAudit.visibleHeavyBondCrossingCount,
            visibleHeavyBondCrossingCountAfter: finalFusedAcyclicSidechainContactRetouch.audit?.visibleHeavyBondCrossingCount ?? null
          }
        );
      }
    }
  }
  const finalRingHypervalentBranchOverlapRetouch = timeFinalRetouch('finalRingHypervalentBranchOverlapRetouch', () =>
    maybeRetouchFinalRingHypervalentBranchOverlaps(layoutGraph, finalCoords, placement, normalizedOptions.bondLength)
  );
  if (finalRingHypervalentBranchOverlapRetouch.changed) {
    const currentAudit = auditLayout(layoutGraph, finalCoords, {
      bondLength: normalizedOptions.bondLength,
      bondValidationClasses: placement.bondValidationClasses
    });
    finalCoords = finalRingHypervalentBranchOverlapRetouch.coords;
    if (finalRingHypervalentBranchOverlapRetouch.bondValidationClasses instanceof Map) {
      placement.bondValidationClasses = finalRingHypervalentBranchOverlapRetouch.bondValidationClasses;
    }
    finalCoordsModified = true;
    onStep?.(
      'Final Ring Hypervalent Branch Retouch',
      'Crowded ring sulfone and phosphonyl centers nudged with their terminal oxo leaves to clear residual branch overlaps.',
      cloneCoords(finalCoords),
      {
        movedAtomCount: finalRingHypervalentBranchOverlapRetouch.movedAtomIds.length,
        severeOverlapCountBefore: currentAudit.severeOverlapCount,
        severeOverlapCountAfter: finalRingHypervalentBranchOverlapRetouch.audit?.severeOverlapCount ?? null,
        maxBondLengthDeviationBefore: currentAudit.maxBondLengthDeviation,
        maxBondLengthDeviationAfter: finalRingHypervalentBranchOverlapRetouch.audit?.maxBondLengthDeviation ?? null
      }
    );
  }
  if (familySummary.primaryFamily === 'acyclic' && familySummary.mixedMode !== true) {
    const finalAcyclicBranchContactRetouch = timeFinalRetouch('finalAcyclicBranchContactRetouch', () =>
      maybeRetouchFinalAcyclicBranchSevereContacts(layoutGraph, finalCoords, placement, normalizedOptions.bondLength)
    );
    if (finalAcyclicBranchContactRetouch.changed) {
      const currentAudit = auditLayout(layoutGraph, finalCoords, {
        bondLength: normalizedOptions.bondLength,
        bondValidationClasses: placement.bondValidationClasses
      });
      finalCoords = finalAcyclicBranchContactRetouch.coords;
      finalCoordsModified = true;
      onStep?.('Final Acyclic Branch Retouch', 'Small pure-acyclic branch subtrees rotated out of residual severe contacts while preserving audited bond geometry.', cloneCoords(finalCoords), {
        movedAtomCount: finalAcyclicBranchContactRetouch.movedAtomIds.length,
        severeOverlapCountBefore: currentAudit.severeOverlapCount,
        severeOverlapCountAfter: finalAcyclicBranchContactRetouch.audit?.severeOverlapCount ?? null,
        visibleHeavyBondCrossingCountBefore: currentAudit.visibleHeavyBondCrossingCount,
        visibleHeavyBondCrossingCountAfter: finalAcyclicBranchContactRetouch.audit?.visibleHeavyBondCrossingCount ?? null
      });

      const postBranchTerminalLeafContactRetouch = timeFinalRetouch('finalPostBranchTerminalLeafContactRetouch', () =>
        maybeRetouchFinalTerminalCarbonLeafSevereContacts(layoutGraph, finalCoords, placement, normalizedOptions.bondLength, {
          includeSingleBondHeteroLeaves: true,
          includeMultipleBondHeteroLeaves: true
        })
      );
      if (postBranchTerminalLeafContactRetouch.changed) {
        const postBranchAudit = auditLayout(layoutGraph, finalCoords, {
          bondLength: normalizedOptions.bondLength,
          bondValidationClasses: placement.bondValidationClasses
        });
        finalCoords = postBranchTerminalLeafContactRetouch.coords;
        finalCoordsModified = true;
        onStep?.('Final Post-Branch Terminal Leaf Retouch', 'Terminal leaves rotated out of residual contacts introduced by the final acyclic branch retouch.', cloneCoords(finalCoords), {
          movedAtomCount: postBranchTerminalLeafContactRetouch.movedAtomIds.length,
          severeOverlapCountBefore: postBranchAudit.severeOverlapCount,
          severeOverlapCountAfter: postBranchTerminalLeafContactRetouch.audit?.severeOverlapCount ?? null,
          visibleHeavyBondCrossingCountBefore: postBranchAudit.visibleHeavyBondCrossingCount,
          visibleHeavyBondCrossingCountAfter: postBranchTerminalLeafContactRetouch.audit?.visibleHeavyBondCrossingCount ?? null
        });
      }
    }
  }
  if (familySummary.primaryFamily !== 'acyclic') {
    const finalAttachedRingBranchContactRetouch = timeFinalRetouch('finalAttachedRingBranchContactRetouch', () =>
      maybeRetouchFinalAttachedRingBranchSevereContacts(layoutGraph, finalCoords, placement, normalizedOptions.bondLength)
    );
    if (finalAttachedRingBranchContactRetouch.changed) {
      const currentAudit = auditLayout(layoutGraph, finalCoords, {
        bondLength: normalizedOptions.bondLength,
        bondValidationClasses: placement.bondValidationClasses
      });
      finalCoords = finalAttachedRingBranchContactRetouch.coords;
      finalCoordsModified = true;
      onStep?.(
        'Final Attached Ring Branch Retouch',
        'Small ring branches rotated around their non-ring anchor to clear residual severe contacts without moving the anchor.',
        cloneCoords(finalCoords),
        {
          movedAtomCount: finalAttachedRingBranchContactRetouch.movedAtomIds.length,
          severeOverlapCountBefore: currentAudit.severeOverlapCount,
          severeOverlapCountAfter: finalAttachedRingBranchContactRetouch.audit?.severeOverlapCount ?? null,
          visibleHeavyBondCrossingCountBefore: currentAudit.visibleHeavyBondCrossingCount,
          visibleHeavyBondCrossingCountAfter: finalAttachedRingBranchContactRetouch.audit?.visibleHeavyBondCrossingCount ?? null
        }
      );
    }
  }
  const postAttachedRingOrganometallicMetalBranchFanRetouch = applyFinalOrganometallicMetalBranchFanRetouch();
  if (postAttachedRingOrganometallicMetalBranchFanRetouch.changed) {
    cleanup.finalStageAudit = null;
    cleanup.finalStageStereo = null;
  }
  const postAttachedRingOrganometallicRingSidechainFanRetouch = postAttachedRingOrganometallicMetalBranchFanRetouch.changed ? { changed: false } : applyFinalOrganometallicRingSidechainFanRetouch();
  if (postAttachedRingOrganometallicRingSidechainFanRetouch.changed) {
    cleanup.finalStageAudit = null;
    cleanup.finalStageStereo = null;
  }
  const finalCompactBridgedHydroxySidechainRetouch = timeFinalRetouch('finalCompactBridgedHydroxySidechainRetouch', () =>
    maybeRetouchFinalCompactBridgedHydroxySidechainContacts(layoutGraph, finalCoords, placement, normalizedOptions.bondLength)
  );
  if (finalCompactBridgedHydroxySidechainRetouch.changed) {
    const currentAudit = auditLayout(layoutGraph, finalCoords, {
      bondLength: normalizedOptions.bondLength,
      bondValidationClasses: placement.bondValidationClasses
    });
    finalCoords = finalCompactBridgedHydroxySidechainRetouch.coords;
    finalCoordsModified = true;
    onStep?.(
      'Final Compact Bridged Hydroxy Sidechain Retouch',
      'A compact bridged hydroxy sidechain was articulated around its ring anchor and terminal oxygen leaf to clear residual severe contacts.',
      cloneCoords(finalCoords),
      {
        movedAtomCount: finalCompactBridgedHydroxySidechainRetouch.movedAtomIds.length,
        severeOverlapCountBefore: currentAudit.severeOverlapCount,
        severeOverlapCountAfter: finalCompactBridgedHydroxySidechainRetouch.audit?.severeOverlapCount ?? null,
        visibleHeavyBondCrossingCountBefore: currentAudit.visibleHeavyBondCrossingCount,
        visibleHeavyBondCrossingCountAfter: finalCompactBridgedHydroxySidechainRetouch.audit?.visibleHeavyBondCrossingCount ?? null
      }
    );
  }
  const finalCompactBridgedOverlapBondRepair = timeFinalRetouch('finalCompactBridgedOverlapBondRepair', () =>
    maybeRetouchFinalCompactBridgedOverlapBondRepair(layoutGraph, finalCoords, placement, normalizedOptions.bondLength)
  );
  if (finalCompactBridgedOverlapBondRepair.changed) {
    const currentAudit = auditLayout(layoutGraph, finalCoords, {
      bondLength: normalizedOptions.bondLength,
      bondValidationClasses: placement.bondValidationClasses
    });
    finalCoords = finalCompactBridgedOverlapBondRepair.coords;
    finalCoordsModified = true;
    onStep?.(
      'Final Compact Bridged Overlap Bond Repair',
      'A compact bridged ring contact was spread with a paired mild ring-bond relief move, accepting only audit-clean coordinates.',
      cloneCoords(finalCoords),
      {
        movedAtomCount: finalCompactBridgedOverlapBondRepair.movedAtomIds.length,
        severeOverlapCountBefore: currentAudit.severeOverlapCount,
        severeOverlapCountAfter: finalCompactBridgedOverlapBondRepair.audit?.severeOverlapCount ?? null,
        bondLengthFailureCountBefore: currentAudit.bondLengthFailureCount,
        bondLengthFailureCountAfter: finalCompactBridgedOverlapBondRepair.audit?.bondLengthFailureCount ?? null
      }
    );
  }
  const finalExactBridgedRingPathOverlapRetouch = timeFinalRetouch('finalExactBridgedRingPathOverlapRetouch', () =>
    maybeRetouchFinalExactBridgedRingPathOverlaps(layoutGraph, finalCoords, placement, normalizedOptions.bondLength)
  );
  if (finalExactBridgedRingPathOverlapRetouch.changed) {
    const currentAudit = auditLayout(layoutGraph, finalCoords, {
      bondLength: normalizedOptions.bondLength,
      bondValidationClasses: placement.bondValidationClasses
    });
    finalCoords = finalExactBridgedRingPathOverlapRetouch.coords;
    if (finalExactBridgedRingPathOverlapRetouch.bondValidationClasses instanceof Map) {
      placement.bondValidationClasses = finalExactBridgedRingPathOverlapRetouch.bondValidationClasses;
    }
    finalCoordsModified = true;
    onStep?.(
      'Final Exact Bridged Ring Path Retouch',
      'Collapsed compact bridged ring paths opened away from exact non-bonded ring-atom overlaps without increasing audit counts.',
      cloneCoords(finalCoords),
      {
        movedAtomCount: finalExactBridgedRingPathOverlapRetouch.movedAtomIds.length,
        severeOverlapCountBefore: currentAudit.severeOverlapCount,
        severeOverlapCountAfter: finalExactBridgedRingPathOverlapRetouch.audit?.severeOverlapCount ?? null,
        maxBondLengthDeviationBefore: currentAudit.maxBondLengthDeviation,
        maxBondLengthDeviationAfter: finalExactBridgedRingPathOverlapRetouch.audit?.maxBondLengthDeviation ?? null
      }
    );
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
  if (!skipFinalThreeHeavyContinuationRetouch && (layoutGraph.traits?.heavyAtomCount ?? 0) >= ULTRA_LARGE_CLEAN_THREE_HEAVY_RETOUCH_SKIP_MIN_HEAVY_ATOMS) {
    const currentAudit = timeFinalRetouch('finalThreeHeavyCleanAudit', () =>
      auditLayout(layoutGraph, finalCoords, {
        bondLength: normalizedOptions.bondLength,
        bondValidationClasses: placement.bondValidationClasses
      })
    );
    skipFinalThreeHeavyContinuationRetouch = shouldSkipCleanUltraLargeThreeHeavyContinuationRetouch(layoutGraph, familySummary, currentAudit);
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
  const finalLargeMoleculeTargetedAngleRelief = timeFinalRetouch('finalLargeMoleculeTargetedAngleRelief', () => {
    return maybeRetouchFinalLargeMoleculeTargetedAngleRelief(workingMolecule, layoutGraph, finalCoords, placement, normalizedOptions.bondLength);
  });
  if (finalLargeMoleculeTargetedAngleRelief.changed) {
    finalCoords = finalLargeMoleculeTargetedAngleRelief.coords;
    finalCoordsModified = true;
    onStep?.('Final Large Molecule Targeted Angle Relief', 'Very distorted large-molecule stitched fans softened with bounded support-branch rotations.', cloneCoords(finalCoords), {
      movedAtomCount: finalLargeMoleculeTargetedAngleRelief.movedAtomIds.length,
      maxDeviationBefore: finalLargeMoleculeTargetedAngleRelief.scoreBefore.maxDeviation,
      maxDeviationAfter: finalLargeMoleculeTargetedAngleRelief.scoreAfter.maxDeviation,
      totalDeviationBefore: finalLargeMoleculeTargetedAngleRelief.scoreBefore.totalDeviation,
      totalDeviationAfter: finalLargeMoleculeTargetedAngleRelief.scoreAfter.totalDeviation
    });
  }
  if (shouldRunFinalLargeMoleculeAngleRelief(layoutGraph, familySummary)) {
    const finalLargeMoleculeAngleRelief = timeFinalRetouch('finalLargeMoleculeAngleRelief', () => {
      return maybeRelieveFinalLargeMoleculeAngles(workingMolecule, layoutGraph, finalCoords, placement, normalizedOptions.bondLength);
    });
    if (finalLargeMoleculeAngleRelief.changed) {
      finalCoords = finalLargeMoleculeAngleRelief.coords;
      finalCoordsModified = true;
      onStep?.('Final Large Molecule Angle Relief', 'Remaining large-molecule peptide kinks softened with guarded rigid branch rotations after exact fan retouch.', cloneCoords(finalCoords), {
        movedAtomCount: finalLargeMoleculeAngleRelief.movedAtomIds.length,
        maxDeviationBefore: finalLargeMoleculeAngleRelief.scoreBefore.maxDeviation,
        maxDeviationAfter: finalLargeMoleculeAngleRelief.scoreAfter.maxDeviation,
        totalDeviationBefore: finalLargeMoleculeAngleRelief.scoreBefore.totalDeviation,
        totalDeviationAfter: finalLargeMoleculeAngleRelief.scoreAfter.totalDeviation
      });
    }
    const postLargeMoleculeTerminalMultipleBondFanRetouch = timeFinalRetouch('postLargeMoleculeTerminalMultipleBondFanRetouch', () =>
      maybeRetouchFinalTerminalMultipleBondLeafFansCenterwise(layoutGraph, finalCoords, placement, normalizedOptions.bondLength)
    );
    if (postLargeMoleculeTerminalMultipleBondFanRetouch.changed) {
      finalCoords = postLargeMoleculeTerminalMultipleBondFanRetouch.coords;
      finalCoordsModified = true;
      onStep?.('Post Large-Molecule Terminal Multiple-Bond Fan Retouch', 'Audit-clean terminal multiple-bond fans re-polished after large-molecule angle relief.', cloneCoords(finalCoords), {
        nudges: postLargeMoleculeTerminalMultipleBondFanRetouch.nudges,
        maxDeviationBefore: postLargeMoleculeTerminalMultipleBondFanRetouch.maxDeviationBefore,
        maxDeviationAfter: postLargeMoleculeTerminalMultipleBondFanRetouch.maxDeviationAfter,
        totalDeviationBefore: postLargeMoleculeTerminalMultipleBondFanRetouch.totalDeviationBefore,
        totalDeviationAfter: postLargeMoleculeTerminalMultipleBondFanRetouch.totalDeviationAfter
      });
    }
    const finalLargeMoleculeDivalentLaneReliefAudit = auditFinalRetouchCoords(workingMolecule, layoutGraph, finalCoords, placement, normalizedOptions.bondLength);
    const finalLargeMoleculeDivalentLaneReliefScore = finalLargeMoleculeAngularReliefScore(layoutGraph, finalCoords);
    const finalLargeMoleculeDivalentLaneRelief = timeFinalRetouch('finalLargeMoleculeDivalentLaneRelief', () =>
      maybeRetouchFinalLargeMoleculeDivalentLaneRelief(
        workingMolecule,
        layoutGraph,
        finalCoords,
        finalLargeMoleculeDivalentLaneReliefAudit,
        finalLargeMoleculeDivalentLaneReliefScore,
        placement,
        normalizedOptions.bondLength
      )
    );
    if (finalLargeMoleculeDivalentLaneRelief.changed) {
      finalCoords = finalLargeMoleculeDivalentLaneRelief.coords;
      finalCoordsModified = true;
      onStep?.('Final Large Molecule Divalent Lane Relief', 'Remaining peptide divalent kinks opened with a paired side-branch lane adjustment.', cloneCoords(finalCoords), {
        movedAtomCount: finalLargeMoleculeDivalentLaneRelief.movedAtomIds.length,
        maxDeviationBefore: finalLargeMoleculeDivalentLaneReliefScore.maxDeviation,
        maxDeviationAfter: finalLargeMoleculeDivalentLaneRelief.score.maxDeviation,
        totalDeviationBefore: finalLargeMoleculeDivalentLaneReliefScore.totalDeviation,
        totalDeviationAfter: finalLargeMoleculeDivalentLaneRelief.score.totalDeviation
      });
    }
    if (shouldPreferFinalLargeMoleculeBackboneSpread(layoutGraph, familySummary)) {
      const finalLargeMoleculeBackboneSpread = timeFinalRetouch('finalLargeMoleculeBackboneSpread', () =>
        maybeSpreadFinalLargeMoleculeBackbone(workingMolecule, layoutGraph, finalCoords, placement, normalizedOptions.bondLength)
      );
      if (finalLargeMoleculeBackboneSpread.changed) {
        finalCoords = finalLargeMoleculeBackboneSpread.coords;
        finalCoordsModified = true;
        onStep?.('Final Large Molecule Backbone Spread', 'Snake-like large-molecule peptide backbones spread with guarded cut-subtree rotations after angle relief.', cloneCoords(finalCoords), {
          movedAtomCount: finalLargeMoleculeBackboneSpread.movedAtomIds.length,
          pathAspectBefore: finalLargeMoleculeBackboneSpread.spreadBefore.aspect,
          pathAspectAfter: finalLargeMoleculeBackboneSpread.spreadAfter.aspect,
          maxDeviationBefore: finalLargeMoleculeBackboneSpread.scoreBefore.maxDeviation,
          maxDeviationAfter: finalLargeMoleculeBackboneSpread.scoreAfter.maxDeviation,
          totalDeviationBefore: finalLargeMoleculeBackboneSpread.scoreBefore.totalDeviation,
          totalDeviationAfter: finalLargeMoleculeBackboneSpread.scoreAfter.totalDeviation
        });
      }
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
  const finalCompactAzaBridgeBend = timeFinalRetouch('finalCompactAzaBridgeBend', () =>
    maybeBendFinalCompactAzaBridgeBonds(workingMolecule, layoutGraph, finalCoords, placement, normalizedOptions.bondLength)
  );
  if (finalCompactAzaBridgeBend.changed) {
    finalCoords = finalCompactAzaBridgeBend.coords;
    finalCoordsModified = true;
    onStep?.('Final Compact Aza Bridge Bend', 'Flattened compact aza bridge nitrogens nudged away from stretched three-member ring chords after guarded final cleanup.', cloneCoords(finalCoords), {
      movedAtomCount: finalCompactAzaBridgeBend.movedAtomIds.length,
      bondLengthFailureCountAfter: finalCompactAzaBridgeBend.audit?.bondLengthFailureCount ?? null,
      maxBondLengthDeviationAfter: finalCompactAzaBridgeBend.audit?.maxBondLengthDeviation ?? null
    });
  }
  const finalBondLengthRelaxation = timeFinalRetouch('finalBondLengthRelaxation', () =>
    maybeRelaxFinalBondLengthFailures(workingMolecule, layoutGraph, finalCoords, placement, normalizedOptions.bondLength)
  );
  if (finalBondLengthRelaxation.changed) {
    finalCoords = finalBondLengthRelaxation.coords;
    finalCoordsModified = true;
    onStep?.('Final Bond-Length Relaxation', 'Small bond-only dirty ring layouts relaxed toward the target bond length after guarded final cleanup.', cloneCoords(finalCoords), {
      movedAtomCount: finalBondLengthRelaxation.movedAtomIds.length,
      bondLengthFailureCountAfter: finalBondLengthRelaxation.audit?.bondLengthFailureCount ?? null,
      maxBondLengthDeviationAfter: finalBondLengthRelaxation.audit?.maxBondLengthDeviation ?? null
    });
  }
  const finalFusedMacrocycleClosureBond = timeFinalRetouch('finalFusedMacrocycleClosureBond', () =>
    maybeRetouchFinalFusedMacrocycleClosureBond(workingMolecule, layoutGraph, finalCoords, placement, normalizedOptions.bondLength)
  );
  if (finalFusedMacrocycleClosureBond.changed) {
    const currentAudit = auditLayout(layoutGraph, finalCoords, {
      bondLength: normalizedOptions.bondLength,
      bondValidationClasses: placement.bondValidationClasses
    });
    finalCoords = finalFusedMacrocycleClosureBond.coords;
    finalCoordsModified = true;
    onStep?.('Final Fused Macrocycle Closure-Bond Retouch', 'A fused macrocycle aromatic edge was nudged to clear one stretched closure bond after global bond relaxation.', cloneCoords(finalCoords), {
      movedAtomCount: finalFusedMacrocycleClosureBond.movedAtomIds.length,
      bondId: finalFusedMacrocycleClosureBond.bondId ?? null,
      bondLengthFailureCountBefore: currentAudit.bondLengthFailureCount,
      bondLengthFailureCountAfter: finalFusedMacrocycleClosureBond.audit?.bondLengthFailureCount ?? null,
      visibleHeavyBondCrossingCountBefore: currentAudit.visibleHeavyBondCrossingCount,
      visibleHeavyBondCrossingCountAfter: finalFusedMacrocycleClosureBond.audit?.visibleHeavyBondCrossingCount ?? null,
      maxBondLengthDeviationBefore: currentAudit.maxBondLengthDeviation,
      maxBondLengthDeviationAfter: finalFusedMacrocycleClosureBond.audit?.maxBondLengthDeviation ?? null
    });
  }
  applyFinalCompactBridgedKamadaKawaiRescue();
  const finalPairedBridgedHingeBond = timeFinalRetouch('finalPairedBridgedHingeBond', () =>
    maybeRetouchFinalPairedBridgedHingeBonds(workingMolecule, layoutGraph, finalCoords, placement, normalizedOptions.bondLength)
  );
  if (finalPairedBridgedHingeBond.changed) {
    const currentAudit = auditLayout(layoutGraph, finalCoords, {
      bondLength: normalizedOptions.bondLength,
      bondValidationClasses: placement.bondValidationClasses
    });
    finalCoords = finalPairedBridgedHingeBond.coords;
    finalCoordsModified = true;
    onStep?.(
      'Final Paired Bridged Hinge-Bond Retouch',
      'A compact bridged hinge pair nudged its opposite endpoints to clear coupled stretched and compressed ring bonds after global bond relaxation.',
      cloneCoords(finalCoords),
      {
        movedAtomCount: finalPairedBridgedHingeBond.movedAtomIds.length,
        bondLengthFailureCountBefore: currentAudit.bondLengthFailureCount,
        bondLengthFailureCountAfter: finalPairedBridgedHingeBond.audit?.bondLengthFailureCount ?? null,
        maxBondLengthDeviationBefore: currentAudit.maxBondLengthDeviation,
        maxBondLengthDeviationAfter: finalPairedBridgedHingeBond.audit?.maxBondLengthDeviation ?? null
      }
    );
  }
  const finalPairedStretchedBridgedRingBond = timeFinalRetouch('finalPairedStretchedBridgedRingBond', () =>
    maybeRetouchFinalPairedStretchedBridgedRingBonds(workingMolecule, layoutGraph, finalCoords, placement, normalizedOptions.bondLength)
  );
  if (finalPairedStretchedBridgedRingBond.changed) {
    const currentAudit = auditLayout(layoutGraph, finalCoords, {
      bondLength: normalizedOptions.bondLength,
      bondValidationClasses: placement.bondValidationClasses
    });
    finalCoords = finalPairedStretchedBridgedRingBond.coords;
    finalCoordsModified = true;
    onStep?.('Final Paired Stretched Bridged Ring-Bond Retouch', 'A bridged ring system nudged endpoints for two stretched ring bonds after global bond relaxation.', cloneCoords(finalCoords), {
      movedAtomCount: finalPairedStretchedBridgedRingBond.movedAtomIds.length,
      bondLengthFailureCountBefore: currentAudit.bondLengthFailureCount,
      bondLengthFailureCountAfter: finalPairedStretchedBridgedRingBond.audit?.bondLengthFailureCount ?? null,
      maxBondLengthDeviationBefore: currentAudit.maxBondLengthDeviation,
      maxBondLengthDeviationAfter: finalPairedStretchedBridgedRingBond.audit?.maxBondLengthDeviation ?? null
    });
  }
  const finalCompactBridgedRemoteTwoAtomPath = timeFinalRetouch('finalCompactBridgedRemoteTwoAtomPath', () =>
    maybeRetouchFinalCompactBridgedRemoteTwoAtomPath(workingMolecule, layoutGraph, finalCoords, placement, normalizedOptions.bondLength)
  );
  if (finalCompactBridgedRemoteTwoAtomPath.changed) {
    finalCoords = finalCompactBridgedRemoteTwoAtomPath.coords;
    if (finalCompactBridgedRemoteTwoAtomPath.bondValidationClasses instanceof Map) {
      placement.bondValidationClasses = finalCompactBridgedRemoteTwoAtomPath.bondValidationClasses;
    }
    finalCoordsModified = true;
    onStep?.(
      'Final Compact Bridged Remote Path Retouch',
      'A remote two-atom bridge path was re-laid beside its compact ring path and its tiny side branch rotated outward.',
      cloneCoords(finalCoords),
      {
        movedAtomCount: finalCompactBridgedRemoteTwoAtomPath.movedAtomIds.length,
        bondLengthFailureCountBefore: finalCompactBridgedRemoteTwoAtomPath.currentAudit?.bondLengthFailureCount ?? null,
        bondLengthFailureCountAfter: finalCompactBridgedRemoteTwoAtomPath.audit?.bondLengthFailureCount ?? null,
        visibleHeavyBondCrossingCountBefore: finalCompactBridgedRemoteTwoAtomPath.currentAudit?.visibleHeavyBondCrossingCount ?? null,
        visibleHeavyBondCrossingCountAfter: finalCompactBridgedRemoteTwoAtomPath.audit?.visibleHeavyBondCrossingCount ?? null,
        maxBondLengthDeviationBefore: finalCompactBridgedRemoteTwoAtomPath.currentAudit?.maxBondLengthDeviation ?? null,
        maxBondLengthDeviationAfter: finalCompactBridgedRemoteTwoAtomPath.audit?.maxBondLengthDeviation ?? null
      }
    );
  }
  const finalBridgedLinearSharedCorner = timeFinalRetouch('finalBridgedLinearSharedCorner', () =>
    familySummary.primaryFamily === 'bridged'
      ? maybeRetouchFinalBridgedLinearSharedCorners(workingMolecule, layoutGraph, finalCoords, placement, normalizedOptions.bondLength)
      : { changed: false, coords: finalCoords, movedAtomIds: [], audit: null }
  );
  if (finalBridgedLinearSharedCorner.changed) {
    finalCoords = finalBridgedLinearSharedCorner.coords;
    finalCoordsModified = true;
    onStep?.('Final Bridged Linear Shared-Corner Retouch', 'A saturated shared bridged ring corner opened from a near-linear placement while preserving audit-clean coordinates.', cloneCoords(finalCoords), {
      movedAtomCount: finalBridgedLinearSharedCorner.movedAtomIds.length,
      angleBefore: finalBridgedLinearSharedCorner.angleBefore,
      angleAfter: finalBridgedLinearSharedCorner.angleAfter,
      maxBondLengthDeviationAfter: finalBridgedLinearSharedCorner.audit?.maxBondLengthDeviation ?? null
    });
  }
  const finalSulfonylOxatricycloLactone = timeFinalRetouch('finalSulfonylOxatricycloLactone', () =>
    maybeRetouchFinalSulfonylOxatricycloLactone(workingMolecule, layoutGraph, finalCoords, placement, normalizedOptions.bondLength)
  );
  if (finalSulfonylOxatricycloLactone.changed) {
    finalCoords = finalSulfonylOxatricycloLactone.coords;
    if (finalSulfonylOxatricycloLactone.bondValidationClasses instanceof Map) {
      placement.bondValidationClasses = finalSulfonylOxatricycloLactone.bondValidationClasses;
    }
    finalCoordsModified = true;
    onStep?.(
      'Final Sulfonyl Oxatricyclo Lactone Retouch',
      'A compact sulfonyl oxatricyclo lactone cage was reprojected with its methyl, hydroxy, formyl, sulfone, and carbonyl exits kept with the scaffold.',
      cloneCoords(finalCoords),
      {
        movedAtomCount: finalSulfonylOxatricycloLactone.movedAtomIds.length,
        bondLengthFailureCountBefore: finalSulfonylOxatricycloLactone.currentAudit?.bondLengthFailureCount ?? null,
        bondLengthFailureCountAfter: finalSulfonylOxatricycloLactone.audit?.bondLengthFailureCount ?? null,
        severeOverlapCountBefore: finalSulfonylOxatricycloLactone.currentAudit?.severeOverlapCount ?? null,
        severeOverlapCountAfter: finalSulfonylOxatricycloLactone.audit?.severeOverlapCount ?? null,
        visibleHeavyBondCrossingCountBefore: finalSulfonylOxatricycloLactone.currentAudit?.visibleHeavyBondCrossingCount ?? null,
        visibleHeavyBondCrossingCountAfter: finalSulfonylOxatricycloLactone.audit?.visibleHeavyBondCrossingCount ?? null,
        fallbackModeBefore: finalSulfonylOxatricycloLactone.currentAudit?.fallback?.mode ?? null,
        fallbackModeAfter: finalSulfonylOxatricycloLactone.audit?.fallback?.mode ?? null
      }
    );
  }
  const finalStretchedBridgedRingBond = timeFinalRetouch('finalStretchedBridgedRingBond', () =>
    maybeRetouchFinalStretchedBridgedRingBond(workingMolecule, layoutGraph, finalCoords, placement, normalizedOptions.bondLength)
  );
  if (finalStretchedBridgedRingBond.changed) {
    const currentAudit = auditLayout(layoutGraph, finalCoords, {
      bondLength: normalizedOptions.bondLength,
      bondValidationClasses: placement.bondValidationClasses
    });
    finalCoords = finalStretchedBridgedRingBond.coords;
    if (finalStretchedBridgedRingBond.bondValidationClasses instanceof Map) {
      placement.bondValidationClasses = finalStretchedBridgedRingBond.bondValidationClasses;
    }
    finalCoordsModified = true;
    onStep?.(
      'Final Stretched Bridged Ring-Bond Retouch',
      'A compact bridged ring endpoint nudged inward to clear one residual stretched ring bond after global bond relaxation.',
      cloneCoords(finalCoords),
      {
        movedAtomCount: finalStretchedBridgedRingBond.movedAtomIds.length,
        bondLengthFailureCountBefore: currentAudit.bondLengthFailureCount,
        bondLengthFailureCountAfter: finalStretchedBridgedRingBond.audit?.bondLengthFailureCount ?? null,
        maxBondLengthDeviationBefore: currentAudit.maxBondLengthDeviation,
        maxBondLengthDeviationAfter: finalStretchedBridgedRingBond.audit?.maxBondLengthDeviation ?? null
      }
    );
  }
  const finalOrganometallicMildBridgedRingBond = timeFinalRetouch('finalOrganometallicMildBridgedRingBond', () =>
    maybeRetouchFinalOrganometallicMildBridgedRingBond(workingMolecule, layoutGraph, finalCoords, placement, normalizedOptions.bondLength, familySummary)
  );
  if (finalOrganometallicMildBridgedRingBond.changed) {
    const currentAudit = auditLayout(layoutGraph, finalCoords, {
      bondLength: normalizedOptions.bondLength,
      bondValidationClasses: placement.bondValidationClasses
    });
    finalCoords = finalOrganometallicMildBridgedRingBond.coords;
    finalCoordsModified = true;
    onStep?.(
      'Final Organometallic Mild Bridged Ring-Bond Retouch',
      'A mildly stretched organometallic bridged ring bond was symmetrically shortened after global bond relaxation.',
      cloneCoords(finalCoords),
      {
        movedAtomCount: finalOrganometallicMildBridgedRingBond.movedAtomIds.length,
        bondLengthFailureCountBefore: currentAudit.bondLengthFailureCount,
        bondLengthFailureCountAfter: finalOrganometallicMildBridgedRingBond.audit?.bondLengthFailureCount ?? null,
        maxBondLengthDeviationBefore: currentAudit.maxBondLengthDeviation,
        maxBondLengthDeviationAfter: finalOrganometallicMildBridgedRingBond.audit?.maxBondLengthDeviation ?? null
      }
    );
  }
  const finalStretchedBridgedAromaticRingBond = timeFinalRetouch('finalStretchedBridgedAromaticRingBond', () =>
    maybeRetouchFinalStretchedBridgedAromaticRingBond(workingMolecule, layoutGraph, finalCoords, placement, normalizedOptions.bondLength)
  );
  if (finalStretchedBridgedAromaticRingBond.changed) {
    const currentAudit = auditLayout(layoutGraph, finalCoords, {
      bondLength: normalizedOptions.bondLength,
      bondValidationClasses: placement.bondValidationClasses
    });
    finalCoords = finalStretchedBridgedAromaticRingBond.coords;
    finalCoordsModified = true;
    onStep?.(
      'Final Stretched Bridged Aromatic Ring-Bond Retouch',
      'A small fused aromatic ring translated toward one stretched bridged ring bond after global bond relaxation would introduce overlaps.',
      cloneCoords(finalCoords),
      {
        movedAtomCount: finalStretchedBridgedAromaticRingBond.movedAtomIds.length,
        bondLengthFailureCountBefore: currentAudit.bondLengthFailureCount,
        bondLengthFailureCountAfter: finalStretchedBridgedAromaticRingBond.audit?.bondLengthFailureCount ?? null,
        maxBondLengthDeviationBefore: currentAudit.maxBondLengthDeviation,
        maxBondLengthDeviationAfter: finalStretchedBridgedAromaticRingBond.audit?.maxBondLengthDeviation ?? null
      }
    );
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
          allowRelaxedAcylFan: true,
          fastAcceptClean: true
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
        const boundedRingSubstituentRetouch = resolveRingSubstituentBoundedReadability(layoutGraph, candidateCoords, placement.bondValidationClasses, normalizedOptions.bondLength, {
          fastAcceptClean: true
        });
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
        const ringSubstituentBranchRetouch = resolveRingSubstituentBranchCrossings(layoutGraph, candidateCoords, placement.bondValidationClasses, normalizedOptions.bondLength, {
          fastAcceptClean: true
        });
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
      if ((postAcylAudit.labelOverlapCount ?? 0) === 0 && (postAcylAudit.bondLengthFailureCount ?? 0) === 0 && (postAcylAudit.ringSubstituentReadabilityFailureCount ?? 0) > 0) {
        const heteroRingQuaternaryArylFanRetouch = maybeRetouchFinalHeteroRingQuaternaryArylFanReadability(layoutGraph, finalCoords, placement, normalizedOptions.bondLength);
        if (heteroRingQuaternaryArylFanRetouch.changed && finalAuditCountsDoNotWorsen(heteroRingQuaternaryArylFanRetouch.audit, postAcylAudit)) {
          const currentAudit = postAcylAudit;
          finalCoords = heteroRingQuaternaryArylFanRetouch.coords;
          finalCoordsModified = true;
          postAcylAudit = heteroRingQuaternaryArylFanRetouch.audit;
          onStep?.(
            'Final Hetero Ring Quaternary Aryl Fan Retouch',
            'Triaryl quaternary substituent branches rotated outward from a hetero ring to clear readability fallback without adding contacts.',
            cloneCoords(finalCoords),
            {
              movedAtomCount: heteroRingQuaternaryArylFanRetouch.movedAtomIds.length,
              severeOverlapCountBefore: currentAudit.severeOverlapCount,
              severeOverlapCountAfter: postAcylAudit.severeOverlapCount,
              ringSubstituentReadabilityFailureCountBefore: currentAudit.ringSubstituentReadabilityFailureCount,
              ringSubstituentReadabilityFailureCountAfter: postAcylAudit.ringSubstituentReadabilityFailureCount,
              visibleHeavyBondCrossingCountBefore: currentAudit.visibleHeavyBondCrossingCount,
              visibleHeavyBondCrossingCountAfter: postAcylAudit.visibleHeavyBondCrossingCount
            }
          );
        }
      }
      if (
        (postAcylAudit.severeOverlapCount ?? 0) === 0 &&
        (postAcylAudit.labelOverlapCount ?? 0) === 0 &&
        (postAcylAudit.bondLengthFailureCount ?? 0) === 0 &&
        (postAcylAudit.ringSubstituentReadabilityFailureCount ?? 0) > 0
      ) {
        const smallHeteroRingSubstituentRetouch = maybeRetouchFinalSmallHeteroRingSubstituentReadability(layoutGraph, finalCoords, placement, normalizedOptions.bondLength);
        if (smallHeteroRingSubstituentRetouch.changed && finalAuditCountsDoNotWorsen(smallHeteroRingSubstituentRetouch.audit, postAcylAudit)) {
          const currentAudit = postAcylAudit;
          finalCoords = smallHeteroRingSubstituentRetouch.coords;
          finalCoordsModified = true;
          postAcylAudit = smallHeteroRingSubstituentRetouch.audit;
          onStep?.(
            'Final Small Hetero Ring Substituent Retouch',
            'Compact acyclic hetero ring substituent branches rotated after final cleanup to clear readability fallback without adding contacts.',
            cloneCoords(finalCoords),
            {
              movedAtomCount: smallHeteroRingSubstituentRetouch.movedAtomIds.length,
              ringSubstituentReadabilityFailureCountBefore: currentAudit.ringSubstituentReadabilityFailureCount,
              ringSubstituentReadabilityFailureCountAfter: postAcylAudit.ringSubstituentReadabilityFailureCount,
              visibleHeavyBondCrossingCountBefore: currentAudit.visibleHeavyBondCrossingCount,
              visibleHeavyBondCrossingCountAfter: postAcylAudit.visibleHeavyBondCrossingCount
            }
          );
        }
      }
      if (
        (postAcylAudit.severeOverlapCount ?? 0) === 0 &&
        (postAcylAudit.labelOverlapCount ?? 0) === 0 &&
        (postAcylAudit.bondLengthFailureCount ?? 0) === 0 &&
        (postAcylAudit.ringSubstituentReadabilityFailureCount ?? 0) > 0
      ) {
        const largeHeteroRingSubstituentRetouch = maybeRetouchFinalLargeHeteroRingSubstituentReadability(layoutGraph, finalCoords, placement, normalizedOptions.bondLength);
        if (largeHeteroRingSubstituentRetouch.changed && finalAuditCountsDoNotWorsen(largeHeteroRingSubstituentRetouch.audit, postAcylAudit)) {
          const currentAudit = postAcylAudit;
          finalCoords = largeHeteroRingSubstituentRetouch.coords;
          finalCoordsModified = true;
          postAcylAudit = largeHeteroRingSubstituentRetouch.audit;
          onStep?.(
            'Final Large Hetero Ring Substituent Retouch',
            'Bulky neutral oxygen ring substituent branches fanned outward after final cleanup to clear readability fallback without adding contacts.',
            cloneCoords(finalCoords),
            {
              movedAtomCount: largeHeteroRingSubstituentRetouch.movedAtomIds.length,
              ringSubstituentReadabilityFailureCountBefore: currentAudit.ringSubstituentReadabilityFailureCount,
              ringSubstituentReadabilityFailureCountAfter: postAcylAudit.ringSubstituentReadabilityFailureCount,
              visibleHeavyBondCrossingCountBefore: currentAudit.visibleHeavyBondCrossingCount,
              visibleHeavyBondCrossingCountAfter: postAcylAudit.visibleHeavyBondCrossingCount
            }
          );
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
        const boundedRingSubstituentRetouch = resolveRingSubstituentBoundedReadability(layoutGraph, candidateCoords, placement.bondValidationClasses, normalizedOptions.bondLength, {
          fastAcceptClean: true
        });
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
  const postBranchExactBridgedRingPathOverlapRetouch = timeFinalRetouch('postBranchExactBridgedRingPathOverlapRetouch', () =>
    maybeRetouchFinalExactBridgedRingPathOverlaps(layoutGraph, finalCoords, placement, normalizedOptions.bondLength)
  );
  if (postBranchExactBridgedRingPathOverlapRetouch.changed) {
    const currentAudit = auditLayout(layoutGraph, finalCoords, {
      bondLength: normalizedOptions.bondLength,
      bondValidationClasses: placement.bondValidationClasses
    });
    finalCoords = postBranchExactBridgedRingPathOverlapRetouch.coords;
    if (postBranchExactBridgedRingPathOverlapRetouch.bondValidationClasses instanceof Map) {
      placement.bondValidationClasses = postBranchExactBridgedRingPathOverlapRetouch.bondValidationClasses;
    }
    finalCoordsModified = true;
    onStep?.(
      'Final Post-Branch Exact Bridged Ring Path Retouch',
      'Collapsed compact bridged ring atoms opened after final branch retouches without increasing audit counts.',
      cloneCoords(finalCoords),
      {
        movedAtomCount: postBranchExactBridgedRingPathOverlapRetouch.movedAtomIds.length,
        severeOverlapCountBefore: currentAudit.severeOverlapCount,
        severeOverlapCountAfter: postBranchExactBridgedRingPathOverlapRetouch.audit?.severeOverlapCount ?? null,
        maxBondLengthDeviationBefore: currentAudit.maxBondLengthDeviation,
        maxBondLengthDeviationAfter: postBranchExactBridgedRingPathOverlapRetouch.audit?.maxBondLengthDeviation ?? null
      }
    );
  }
  if (
    shouldEnsureLandscapeFinalCoords(normalizedOptions, policy) &&
    !shouldPreferFinalLargeMoleculeBackboneSpread(layoutGraph, familySummary) &&
    shouldReapplyLandscapeAfterFinalRetouches(layoutGraph, finalCoords)
  ) {
    const landscapeCoords = cloneCoords(finalCoords);
    const landscapeApplied = ensureLandscapeOrientation(landscapeCoords, workingMolecule);
    const forcedLandscapeApplied = familySummary.primaryFamily === 'large-molecule' && forceLandscapeBoundsIfPortrait(layoutGraph, landscapeCoords);
    if ((landscapeApplied || forcedLandscapeApplied) && finalOrientationAuditCountsDoNotWorsen(layoutGraph, finalCoords, landscapeCoords, placement, normalizedOptions.bondLength)) {
      finalCoords = landscapeCoords;
      finalCoordsModified = true;
      onStep?.('Final Landscape Orientation', 'Whole-molecule landscape leveling reapplied after final presentation retouches.', cloneCoords(finalCoords), {});
    }
  }
  const shouldRunFinalLabelClearance = timeFinalRetouch('finalLabelClearanceNeed', () =>
    hasFinalLabelClearanceNeed(layoutGraph, finalCoords, normalizedOptions.bondLength, normalizedOptions.labelMetrics)
  );
  if (shouldRunFinalLabelClearance) {
    let finalLabelOverlapCountAfterPrimary = null;
    const finalLabelClearance = timeFinalRetouch('finalLabelClearance', () =>
      maybeApplyGuardedFinalLabelClearance(workingMolecule, layoutGraph, finalCoords, placement, normalizedOptions.bondLength, normalizedOptions.labelMetrics)
    );
    if (finalLabelClearance.changed) {
      finalCoords = finalLabelClearance.coords;
      finalCoordsModified = true;
      finalLabelOverlapCountAfterPrimary = finalLabelClearance.candidateAudit?.labelOverlapCount ?? null;
      onStep?.('Final Label Clearance', 'Residual terminal labels rotated after final retouches while preserving audited layout quality.', cloneCoords(finalCoords), {
        nudges: finalLabelClearance.nudges,
        labelOverlapCountBefore: finalLabelClearance.currentAudit.labelOverlapCount,
        labelOverlapCountAfter: finalLabelClearance.candidateAudit?.labelOverlapCount ?? null
      });
    }
    if (finalLabelOverlapCountAfterPrimary !== 0) {
      let finalLabelOverlapCountAfterConnector = null;
      const finalConnectorLabelClearance = timeFinalRetouch('finalConnectorLabelClearance', () =>
        maybeApplyGuardedConnectorLabelClearance(workingMolecule, layoutGraph, finalCoords, placement, normalizedOptions.bondLength, normalizedOptions.labelMetrics)
      );
      if (finalConnectorLabelClearance.changed) {
        finalCoords = finalConnectorLabelClearance.coords;
        finalCoordsModified = true;
        finalLabelOverlapCountAfterConnector = finalConnectorLabelClearance.candidateAudit?.labelOverlapCount ?? null;
        onStep?.('Final Connector Label Clearance', 'Residual connector labels rotated as bounded subtrees while preserving audited layout quality.', cloneCoords(finalCoords), {
          rotations: finalConnectorLabelClearance.rotations,
          movedAtomCount: finalConnectorLabelClearance.movedAtomCount,
          labelOverlapCountBefore: finalConnectorLabelClearance.currentAudit.labelOverlapCount,
          labelOverlapCountAfter: finalConnectorLabelClearance.candidateAudit?.labelOverlapCount ?? null
        });
      } else {
        finalLabelOverlapCountAfterConnector = finalConnectorLabelClearance.currentAudit?.labelOverlapCount ?? null;
      }
      if (finalLabelOverlapCountAfterConnector !== 0) {
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
      }
    }
    const finalLabelAxisRotation = timeFinalRetouch('finalLabelAxisRotation', () =>
      maybeApplyGuardedFinalLabelAxisRotation(workingMolecule, layoutGraph, finalCoords, placement, normalizedOptions.bondLength, normalizedOptions.labelMetrics)
    );
    if (finalLabelAxisRotation.changed) {
      finalCoords = finalLabelAxisRotation.coords;
      finalCoordsModified = true;
      onStep?.('Final Label Axis Rotation', 'Whole-layout label axis nudged to clear residual axis-aligned label boxes while preserving audited layout quality.', cloneCoords(finalCoords), {
        rotationRadians: finalLabelAxisRotation.rotation,
        labelOverlapCountBefore: finalLabelAxisRotation.currentAudit.labelOverlapCount,
        labelOverlapCountAfter: finalLabelAxisRotation.candidateAudit?.labelOverlapCount ?? null
      });
    }
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
          allowRelaxedAcylFan: true,
          fastAcceptClean: true
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
  const finalStereoRescue = timeFinalRetouch('finalStereoRescue', () => maybeApplyFinalStereoRescue(workingMolecule, layoutGraph, finalCoords, placement, normalizedOptions.bondLength));
  if (finalStereoRescue.changed) {
    finalCoords = finalStereoRescue.coords;
    finalCoordsModified = true;
    onStep?.('Final EZ Stereo Rescue', 'Late retouches rechecked against annotated E/Z geometry and corrected when audit counts stayed bounded.', cloneCoords(finalCoords), {
      reflections: finalStereoRescue.reflections,
      ezViolationCountBefore: finalStereoRescue.currentStereo?.ezViolationCount ?? null,
      ezViolationCountAfter: finalStereoRescue.candidateStereo?.ezViolationCount ?? null
    });
  }
  const postStereoExactBridgedRingPathOverlapRetouch = timeFinalRetouch('postStereoExactBridgedRingPathOverlapRetouch', () =>
    maybeRetouchFinalExactBridgedRingPathOverlaps(layoutGraph, finalCoords, placement, normalizedOptions.bondLength)
  );
  if (postStereoExactBridgedRingPathOverlapRetouch.changed) {
    const currentAudit = auditLayout(layoutGraph, finalCoords, {
      bondLength: normalizedOptions.bondLength,
      bondValidationClasses: placement.bondValidationClasses
    });
    finalCoords = postStereoExactBridgedRingPathOverlapRetouch.coords;
    if (postStereoExactBridgedRingPathOverlapRetouch.bondValidationClasses instanceof Map) {
      placement.bondValidationClasses = postStereoExactBridgedRingPathOverlapRetouch.bondValidationClasses;
    }
    finalCoordsModified = true;
    onStep?.('Final Post-Stereo Exact Bridged Ring Path Retouch', 'Collapsed compact bridged ring atoms opened after stereo rescue without increasing audit counts.', cloneCoords(finalCoords), {
      movedAtomCount: postStereoExactBridgedRingPathOverlapRetouch.movedAtomIds.length,
      severeOverlapCountBefore: currentAudit.severeOverlapCount,
      severeOverlapCountAfter: postStereoExactBridgedRingPathOverlapRetouch.audit?.severeOverlapCount ?? null,
      maxBondLengthDeviationBefore: currentAudit.maxBondLengthDeviation,
      maxBondLengthDeviationAfter: postStereoExactBridgedRingPathOverlapRetouch.audit?.maxBondLengthDeviation ?? null
    });
  }
  const finalExactBridgedTerminalMultipleBondCenterRelaxation = timeFinalRetouch('finalExactBridgedTerminalMultipleBondCenterRelaxation', () =>
    maybeRelaxFinalExactBridgedTerminalMultipleBondCenterOverlaps(layoutGraph, finalCoords, placement, normalizedOptions.bondLength)
  );
  if (finalExactBridgedTerminalMultipleBondCenterRelaxation.changed) {
    const currentAudit = auditLayout(layoutGraph, finalCoords, {
      bondLength: normalizedOptions.bondLength,
      bondValidationClasses: placement.bondValidationClasses
    });
    finalCoords = finalExactBridgedTerminalMultipleBondCenterRelaxation.coords;
    if (finalExactBridgedTerminalMultipleBondCenterRelaxation.bondValidationClasses instanceof Map) {
      placement.bondValidationClasses = finalExactBridgedTerminalMultipleBondCenterRelaxation.bondValidationClasses;
    }
    finalCoordsModified = true;
    onStep?.(
      'Final Exact Bridged Terminal Multiple-Bond Center Relaxation',
      'A compact bridged terminal multiple-bond center was micro-relaxed away from an exact ring-atom overlap after other retouches declined.',
      cloneCoords(finalCoords),
      {
        movedAtomCount: finalExactBridgedTerminalMultipleBondCenterRelaxation.movedAtomIds.length,
        severeOverlapCountBefore: currentAudit.severeOverlapCount,
        severeOverlapCountAfter: finalExactBridgedTerminalMultipleBondCenterRelaxation.audit?.severeOverlapCount ?? null,
        visibleHeavyBondCrossingCountBefore: currentAudit.visibleHeavyBondCrossingCount,
        visibleHeavyBondCrossingCountAfter: finalExactBridgedTerminalMultipleBondCenterRelaxation.audit?.visibleHeavyBondCrossingCount ?? null,
        maxBondLengthDeviationBefore: currentAudit.maxBondLengthDeviation,
        maxBondLengthDeviationAfter: finalExactBridgedTerminalMultipleBondCenterRelaxation.audit?.maxBondLengthDeviation ?? null
      }
    );
  }
  const finalBridgedSingleOverlapRelaxation = timeFinalRetouch('finalBridgedSingleOverlapRelaxation', () =>
    maybeRelaxFinalBridgedSingleOverlaps(layoutGraph, finalCoords, placement, normalizedOptions.bondLength)
  );
  if (finalBridgedSingleOverlapRelaxation.changed) {
    const currentAudit = auditLayout(layoutGraph, finalCoords, {
      bondLength: normalizedOptions.bondLength,
      bondValidationClasses: placement.bondValidationClasses
    });
    finalCoords = finalBridgedSingleOverlapRelaxation.coords;
    if (finalBridgedSingleOverlapRelaxation.bondValidationClasses instanceof Map) {
      placement.bondValidationClasses = finalBridgedSingleOverlapRelaxation.bondValidationClasses;
    }
    finalCoordsModified = true;
    onStep?.(
      'Final Bridged Single-Overlap Relaxation',
      'A compact bridged single overlap was micro-relaxed after all rigid retouches declined, accepting only an audit-clean candidate.',
      cloneCoords(finalCoords),
      {
        movedAtomCount: finalBridgedSingleOverlapRelaxation.movedAtomIds.length,
        severeOverlapCountBefore: currentAudit.severeOverlapCount,
        severeOverlapCountAfter: finalBridgedSingleOverlapRelaxation.audit?.severeOverlapCount ?? null,
        visibleHeavyBondCrossingCountBefore: currentAudit.visibleHeavyBondCrossingCount,
        visibleHeavyBondCrossingCountAfter: finalBridgedSingleOverlapRelaxation.audit?.visibleHeavyBondCrossingCount ?? null,
        maxBondLengthDeviationBefore: currentAudit.maxBondLengthDeviation,
        maxBondLengthDeviationAfter: finalBridgedSingleOverlapRelaxation.audit?.maxBondLengthDeviation ?? null
      }
    );
  }
  const finalCompactBridgedAminoFormylOverlapRetouch = timeFinalRetouch('finalCompactBridgedAminoFormylOverlapRetouch', () =>
    maybeRetouchFinalCompactBridgedAminoFormylOverlap(layoutGraph, finalCoords, placement, normalizedOptions.bondLength)
  );
  if (finalCompactBridgedAminoFormylOverlapRetouch.changed) {
    const currentAudit = auditLayout(layoutGraph, finalCoords, {
      bondLength: normalizedOptions.bondLength,
      bondValidationClasses: placement.bondValidationClasses
    });
    finalCoords = finalCompactBridgedAminoFormylOverlapRetouch.coords;
    if (finalCompactBridgedAminoFormylOverlapRetouch.bondValidationClasses instanceof Map) {
      placement.bondValidationClasses = finalCompactBridgedAminoFormylOverlapRetouch.bondValidationClasses;
    }
    finalCoordsModified = true;
    onStep?.(
      'Final Compact Bridged Amino Formyl Retouch',
      'A compact bridged terminal amino/formyl clash was seeded into the existing single-overlap relaxation after restoring formyl readability.',
      cloneCoords(finalCoords),
      {
        movedAtomCount: finalCompactBridgedAminoFormylOverlapRetouch.movedAtomIds.length,
        severeOverlapCountBefore: currentAudit.severeOverlapCount,
        severeOverlapCountAfter: finalCompactBridgedAminoFormylOverlapRetouch.audit?.severeOverlapCount ?? null,
        ringSubstituentReadabilityFailureCountBefore: currentAudit.ringSubstituentReadabilityFailureCount,
        ringSubstituentReadabilityFailureCountAfter: finalCompactBridgedAminoFormylOverlapRetouch.audit?.ringSubstituentReadabilityFailureCount ?? null,
        maxBondLengthDeviationBefore: currentAudit.maxBondLengthDeviation,
        maxBondLengthDeviationAfter: finalCompactBridgedAminoFormylOverlapRetouch.audit?.maxBondLengthDeviation ?? null
      }
    );
  }
  const finalCompactBridgedValidationPromotion = timeFinalRetouch('finalCompactBridgedValidationPromotion', () =>
    maybePromoteFinalCompactBridgedRingValidation(layoutGraph, finalCoords, placement, normalizedOptions.bondLength)
  );
  if (finalCompactBridgedValidationPromotion.changed) {
    const currentAudit = auditLayout(layoutGraph, finalCoords, {
      bondLength: normalizedOptions.bondLength,
      bondValidationClasses: placement.bondValidationClasses
    });
    placement.bondValidationClasses = finalCompactBridgedValidationPromotion.bondValidationClasses;
    finalCoordsModified = true;
    onStep?.(
      'Final Compact Bridged Validation Promotion',
      'Compact bridged cage ring bonds promoted to bridged validation when that clears a residual bond-only audit fallback.',
      cloneCoords(finalCoords),
      {
        bondLengthFailureCountBefore: currentAudit.bondLengthFailureCount,
        bondLengthFailureCountAfter: finalCompactBridgedValidationPromotion.audit?.bondLengthFailureCount ?? null,
        maxBondLengthDeviationBefore: currentAudit.maxBondLengthDeviation,
        maxBondLengthDeviationAfter: finalCompactBridgedValidationPromotion.audit?.maxBondLengthDeviation ?? null
      }
    );
  }
  if (familySummary.primaryFamily === 'large-molecule' || placement.placedFamilies.includes('large-molecule')) {
    const lateLargeMoleculeResidualAudit = timeFinalRetouch('lateLargeMoleculeResidualNeed', () =>
      auditLayout(layoutGraph, finalCoords, {
        bondLength: normalizedOptions.bondLength,
        bondValidationClasses: placement.bondValidationClasses
      })
    );
    if ((lateLargeMoleculeResidualAudit.severeOverlapCount ?? 0) > 0) {
      const lateLargeMoleculeResidualRetouch = timeFinalRetouch('lateLargeMoleculeResidualRetouch', () =>
        runLargeMoleculeResidualRetouch(layoutGraph, finalCoords, {
          bondLength: normalizedOptions.bondLength,
          residualOnly: true
        })
      );
      if (lateLargeMoleculeResidualRetouch.changed) {
        const candidateAudit = auditLayout(layoutGraph, lateLargeMoleculeResidualRetouch.coords, {
          bondLength: normalizedOptions.bondLength,
          bondValidationClasses: placement.bondValidationClasses
        });
        const maxDeviationSlack = normalizedOptions.bondLength * 0.15;
        if (
          (candidateAudit.severeOverlapCount ?? 0) < (lateLargeMoleculeResidualAudit.severeOverlapCount ?? 0) &&
          finalAuditCountsDoNotWorsen(candidateAudit, lateLargeMoleculeResidualAudit) &&
          (candidateAudit.maxBondLengthDeviation ?? 0) <= (lateLargeMoleculeResidualAudit.maxBondLengthDeviation ?? 0) + maxDeviationSlack + 1e-9
        ) {
          finalCoords = lateLargeMoleculeResidualRetouch.coords;
          finalCoordsModified = true;
          onStep?.(
            'Late Large Molecule Residual Retouch',
            'Final large-molecule peptide contacts separated after branch and stereo retouches left a residual severe overlap.',
            cloneCoords(finalCoords),
            {
              movedAtomCount: lateLargeMoleculeResidualRetouch.movedAtomIds.length,
              severeOverlapCountBefore: lateLargeMoleculeResidualAudit.severeOverlapCount,
              severeOverlapCountAfter: candidateAudit.severeOverlapCount,
              visibleHeavyBondCrossingCountBefore: lateLargeMoleculeResidualAudit.visibleHeavyBondCrossingCount,
              visibleHeavyBondCrossingCountAfter: candidateAudit.visibleHeavyBondCrossingCount,
              maxBondLengthDeviationBefore: lateLargeMoleculeResidualAudit.maxBondLengthDeviation,
              maxBondLengthDeviationAfter: candidateAudit.maxBondLengthDeviation
            }
          );
        }
      }
    }
  }
  const lateTerminalRingLeafIntrusionRetouch = timeFinalRetouch('lateTerminalRingLeafIntrusionRetouch', () =>
    runTerminalCarbonRingLeafIntrusionRetidy(layoutGraph, finalCoords, {
      bondLength: normalizedOptions.bondLength,
      frozenAtomIds: placement.frozenAtomIds,
      bondValidationClasses: placement.bondValidationClasses
    })
  );
  if ((lateTerminalRingLeafIntrusionRetouch.nudges ?? 0) > 0) {
    finalCoords = lateTerminalRingLeafIntrusionRetouch.coords;
    finalCoordsModified = true;
    onStep?.('Late Terminal Ring Leaf Retouch', 'Terminal ring leaves pulled back outside incident ring faces after final branch and stereo retouches.', cloneCoords(finalCoords), {
      nudges: lateTerminalRingLeafIntrusionRetouch.nudges
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
