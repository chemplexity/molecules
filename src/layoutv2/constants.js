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
