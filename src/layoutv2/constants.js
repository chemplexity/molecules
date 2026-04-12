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

/** Character-count width multipliers for multi-character atom labels. */
export const LABEL_WIDTH_FACTORS = new Map([
  [1, 1.0],
  [2, 1.6],
  [3, 2.1]
]);

/** Supported depiction profiles. */
export const LAYOUT_PROFILES = Object.freeze([
  'organic-publication',
  'macrocycle',
  'organometallic',
  'large-molecule',
  'reaction-fragment'
]);

/** Component roles used by fragment packing and metadata. */
export const COMPONENT_ROLE_ORDER = Object.freeze({
  principal: 0,
  'counter-ion': 1,
  spectator: 2,
  'solvent-like': 3
});
