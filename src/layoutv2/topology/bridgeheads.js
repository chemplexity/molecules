/** @module topology/bridgeheads */

import { compareCanonicalAtomIds } from './canonical-order.js';

/**
 * Picks the canonical bridgehead pair for a bridged atom set.
 * Prefers highest heavy degree, then canonical atom ordering.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string[]} atomIds - Bridged component atom IDs.
 * @returns {[string, string]|null} Bridgehead atom IDs.
 */
export function pickBridgeheads(layoutGraph, atomIds) {
  const rankedAtomIds = [...atomIds].sort((firstAtomId, secondAtomId) => {
    const firstAtom = layoutGraph.atoms.get(firstAtomId);
    const secondAtom = layoutGraph.atoms.get(secondAtomId);
    const firstDegree = firstAtom?.heavyDegree ?? 0;
    const secondDegree = secondAtom?.heavyDegree ?? 0;
    if (firstDegree !== secondDegree) {
      return secondDegree - firstDegree;
    }
    return compareCanonicalAtomIds(firstAtomId, secondAtomId, layoutGraph.canonicalAtomRank);
  });

  if (rankedAtomIds.length < 2) {
    return null;
  }
  return [rankedAtomIds[0], rankedAtomIds[1]];
}
