/** @module cleanup/subtree-utils */

const CUT_SUBTREE_CACHE_MAX_ENTRIES = 4096;

/**
 * Collects a covalently connected side of the graph while treating one bond as cut.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} startAtomId - Starting atom on the candidate subtree side.
 * @param {string} blockedAtomId - Atom across the cut bond to exclude from traversal.
 * @returns {Set<string>} Connected atoms reachable from the start atom without crossing the cut bond.
 */
export function collectCutSubtree(layoutGraph, startAtomId, blockedAtomId) {
  const cacheKey = `${startAtomId}\u0000${blockedAtomId}`;
  const cache = layoutGraph ? (layoutGraph._cutSubtreeCache ?? (layoutGraph._cutSubtreeCache = new Map())) : null;
  if (cache) {
    const cachedAtomIds = cache.get(cacheKey);
    if (cachedAtomIds) {
      return cachedAtomIds;
    }
  }

  const subtreeAtomIds = new Set([startAtomId]);
  const stack = [startAtomId];

  while (stack.length > 0) {
    const atomId = stack.pop();
    for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
      if ((atomId === startAtomId && neighborAtomId === blockedAtomId) || (atomId === blockedAtomId && neighborAtomId === startAtomId)) {
        continue;
      }
      if (subtreeAtomIds.has(neighborAtomId)) {
        continue;
      }
      subtreeAtomIds.add(neighborAtomId);
      stack.push(neighborAtomId);
    }
  }

  if (cache) {
    if (cache.size >= CUT_SUBTREE_CACHE_MAX_ENTRIES) {
      cache.delete(cache.keys().next().value);
    }
    cache.set(cacheKey, subtreeAtomIds);
  }
  return subtreeAtomIds;
}
