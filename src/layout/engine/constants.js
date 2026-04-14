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

/** Epsilon for general cleanup-improvement comparisons. */
export const IMPROVEMENT_EPSILON = 1e-6;

/** Epsilon for numerical-stability guards such as determinants and zero-length vectors. */
export const NUMERIC_EPSILON = 1e-12;

/** Default cleanup-improvement threshold. */
export const CLEANUP_EPSILON = 1e-3;

/** Severe-overlap threshold as a fraction of target bond length. */
export const SEVERE_OVERLAP_FACTOR = 0.55;

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

/** Publication-style projection tuning for bridged fallback geometry. */
export const BRIDGE_PROJECTION_FACTORS = Object.freeze({
  maxProjectedPathCount: 12,
  singleAtomClampMarginFactor: 0.35,
  layerSpacingFactor: 0.45,
  singleAtomBaseHeightFactor: 0.9,
  pathArcBaseAmplitudeFactor: 0.95,
  meanSeedBiasFactor: 0.3,
  meanSeedBiasClampFactor: 0.5
});

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
