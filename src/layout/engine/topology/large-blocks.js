/** @module topology/large-blocks */

/**
 * Returns whether the current traits exceed the large-molecule threshold.
 * @param {{heavyAtomCount: number, ringSystemCount: number}} traits - Layout traits.
 * @param {{heavyAtomCount: number, ringSystemCount: number, blockCount: number}} threshold - Large-molecule threshold.
 * @param {number} componentCount - Current connected-component or block count.
 * @returns {boolean} True when the threshold is exceeded.
 */
export function exceedsLargeMoleculeThreshold(traits, threshold, componentCount) {
  return traits.heavyAtomCount > threshold.heavyAtomCount || traits.ringSystemCount > threshold.ringSystemCount || componentCount > threshold.blockCount;
}
