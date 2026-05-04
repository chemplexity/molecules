/** @module constants */

/** Default 2D bond length in Angstroms. */
export const DEFAULT_BOND_LENGTH = 1.5;

/** Default profile name used by the layout engine. */
export const DEFAULT_PROFILE = 'organic-publication';

/** Default cleanup pass budget for later refinement phases. */
export const DEFAULT_MAX_CLEANUP_PASSES = 6;

/** Default threshold that activates large-molecule handling. */
export const DEFAULT_LARGE_MOLECULE_THRESHOLD = Object.freeze({
  heavyAtomCount: 120,
  ringSystemCount: 10,
  blockCount: 16
});

/** Epsilon for distance comparisons at layout scale. */
export const DISTANCE_EPSILON = 1e-6;

/** Epsilon for angle comparisons in radians. */
export const ANGLE_EPSILON = 1e-9;

/** Epsilon for presentation penalty and audit metric floating-point comparisons. */
export const PRESENTATION_METRIC_EPSILON = 1e-9;

/** Epsilon for general cleanup-improvement comparisons. */
export const IMPROVEMENT_EPSILON = 1e-6;

/** Epsilon for numerical-stability guards such as determinants and zero-length vectors. */
export const NUMERIC_EPSILON = 1e-12;

/** Default cleanup-improvement threshold. */
export const CLEANUP_EPSILON = 1e-3;

/** Tunable thresholds used by the unified cleanup arbitration loop. */
export const UNIFIED_CLEANUP_LIMITS = Object.freeze({
  overlapPriorityAtomCount: 24,
  largeMoleculeBlockAwareOverlapFloor: 4,
  moderateLayoutRotationProbeAtomCount: 64,
  smallLayoutRotationProbeOverlapCount: 2,
  smallLayoutRotationProbeMaxPasses: 3
});

/** Tunable tolerances for protected-family cleanup stage selection. */
export const PROTECTED_CLEANUP_STAGE_LIMITS = Object.freeze({
  maxBondFailureIncreaseForOverlapWin: 1,
  maxBondDeviationIncrease: 1e-6,
  maxFusedMixedBondDeviationForOverlapWin: 0.06,
  maxFusedMixedMeanDeviationForOverlapWin: 0.01
});

/** Heuristics for protected-family rigid cleanup subtree descriptors. */
export const PROTECTED_FAMILY_RIGID_SUBTREE_LIMITS = Object.freeze({
  maxHeavyAtomCount: 28,
  maxAtomCount: 40,
  maxComponentFraction: 0.8
});

/** Severe-overlap threshold as a fraction of target bond length. */
export const SEVERE_OVERLAP_FACTOR = 0.55;

/** Tunable audit thresholds for ring-substituent readability checks. */
export const RING_SUBSTITUENT_READABILITY_LIMITS = Object.freeze({
  maxOutwardDeviation: 1.0,
  maxSevereImmediateOutwardDeviation: 1.3
});

/** Minimum candidate clearance accepted by branch placement. */
export const BRANCH_CLEARANCE_FLOOR_FACTOR = SEVERE_OVERLAP_FACTOR;

/** Label-box padding as a fraction of target bond length. */
export const LABEL_CLEARANCE_PADDING_FACTOR = 0.08;

/** Outward label nudge distance as a fraction of target bond length. */
export const LABEL_CLEARANCE_NUDGE_FACTOR = 0.2;

/** Maximum macrocycle perimeter drift tolerated before correction. */
export const RING_PERIMETER_MAX_DEVIATION_FACTOR = 0.15;

/** Audit bond validation used for ordinary planar placed bonds. */
export const AUDIT_PLANAR_VALIDATION = Object.freeze({
  minBondLengthFactor: 0.95,
  maxBondLengthFactor: 1.05,
  maxMeanDeviation: 0.05,
  maxSevereOverlapCount: 0
});

/** Template geometry validation used for standard planar scaffold templates. */
export const TEMPLATE_PLANAR_VALIDATION = Object.freeze({
  minBondLengthFactor: 0.98,
  maxBondLengthFactor: 1.02,
  maxMeanDeviation: 0.02,
  maxSevereOverlapCount: 0
});

/** Shared relaxed validation used for bridged template and audit geometry. */
export const BRIDGED_VALIDATION = Object.freeze({
  minBondLengthFactor: 0.7,
  maxBondLengthFactor: 1.4,
  maxMeanDeviation: 0.35,
  maxSevereOverlapCount: 0
});

/** Tuned Kamada-Kawai budgets for unmatched bridged/caged systems. */
export const BRIDGED_KK_LIMITS = Object.freeze({
  threshold: 0.2,
  baseMaxIterations: 1000,
  baseMaxInnerIterations: 20,
  fastAtomLimit: 24,
  mediumAtomLimit: 40,
  mediumMaxIterations: 1500,
  largeMaxIterations: 2500,
  largeMaxInnerIterations: 24
});

/** Diagonal angle used for projected octahedral front/back ligand pairs. */
export const OCTAHEDRAL_PROJECTED_EQUATOR_ANGLE = Math.PI / 6;

/** Lateral angle used for projected trigonal-bipyramidal equatorial ligands. */
export const TRIGONAL_BIPYRAMIDAL_EQUATOR_ANGLE = Math.PI / 6;

/** Character-count width multipliers for multi-character atom labels. */
export const LABEL_WIDTH_FACTORS = new Map([
  [1, 1.0],
  [2, 1.6],
  [3, 2.1]
]);

/** Supported depiction profiles. */
export const LAYOUT_PROFILES = Object.freeze(['organic-publication', 'macrocycle', 'organometallic', 'large-molecule', 'reaction-fragment']);

/** Component roles used by fragment packing and metadata. */
export const COMPONENT_ROLE_ORDER = Object.freeze({
  principal: 0,
  'counter-ion': 1,
  spectator: 2,
  'solvent-like': 3
});

/** Guard rails for family-specific ring-system rescue placement. */
export const RING_SYSTEM_RESCUE_LIMITS = Object.freeze({
  compactBridgedAtomCount: 32,
  compactBridgedRingCount: 8,
  bridgedTemplateMissAtomCount: 40,
  bridgedTemplateMissRingCount: 12
});

/**
 * Returns a stable, order-independent key for an unordered atom pair.
 * @param {string} firstAtomId - First atom ID.
 * @param {string} secondAtomId - Second atom ID.
 * @returns {string} Canonical pair key.
 */
export function atomPairKey(firstAtomId, secondAtomId) {
  return firstAtomId < secondAtomId
    ? `${firstAtomId}:${secondAtomId}`
    : `${secondAtomId}:${firstAtomId}`;
}

/** Rescue/tuning knobs for multi-metal organometallic cluster placement. */
export const ORGANOMETALLIC_RESCUE_LIMITS = Object.freeze({
  frameworkMinMetalCount: 4,
  maxLigandFragmentAtomCount: 1,
  maxAnchorMetalCount: 2,
  singleAnchorSpreadStep: Math.PI / 6,
  mixedRingSystemRescueMinAtomCount: 40,
  mixedRingSystemRescueMinRingCount: 8,
  polyoxoMinMetalCount: 4,
  polyoxoMaxAnchorMetalCount: 3,
  polyoxoFrameworkBondLengthFactor: 2,
  polyoxoPairBridgeOffsetFactor: 0.25,
  polyoxoTerminalSlotCount: 12,
  polyoxoTerminalMinSlotSeparation: Math.PI / 6,
  polyoxoRescueMaxSevereOverlapCount: 6
});
