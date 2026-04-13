/** @module standards/defaults */

/**
 * Returns the default standards-inspired policy bundle.
 * @returns {object} Default policy values.
 */
export function defaultPolicy() {
  return {
    preferredBondAngleFamily: 'standard',
    allowRingDistortion: false,
    bridgedMode: 'template-first',
    macrocycleMode: 'ellipse',
    orientationBias: 'horizontal',
    labelClearanceMode: 'estimate',
    stereoPriority: 'readability',
    fragmentPackingMode: 'principal-right',
    organometallicMode: 'ligand-first',
    postCleanupHooks: []
  };
}
