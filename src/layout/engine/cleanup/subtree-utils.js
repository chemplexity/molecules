/** @module cleanup/subtree-utils */

const CUT_SUBTREE_CACHE_MAX_ENTRIES = 4096;

function getCutSubtreeCache(layoutGraph) {
  if (!layoutGraph) {
    return null;
  }
  const cache = layoutGraph._cutSubtreeCache;
  if (cache?.byStartAtomId) {
    return cache;
  }
  const nextCache = {
    byStartAtomId: new Map(),
    insertionOrder: [],
    size: 0
  };
  layoutGraph._cutSubtreeCache = nextCache;
  return nextCache;
}

function cachedCutSubtree(cache, startAtomId, blockedAtomId) {
  return cache?.byStartAtomId.get(startAtomId)?.get(blockedAtomId) ?? null;
}

function rememberCutSubtree(cache, startAtomId, blockedAtomId, subtreeAtomIds) {
  if (!cache) {
    return;
  }
  let blockedAtomCache = cache.byStartAtomId.get(startAtomId);
  if (!blockedAtomCache) {
    blockedAtomCache = new Map();
    cache.byStartAtomId.set(startAtomId, blockedAtomCache);
  }
  if (!blockedAtomCache.has(blockedAtomId)) {
    cache.size++;
    cache.insertionOrder.push([startAtomId, blockedAtomId]);
  }
  blockedAtomCache.set(blockedAtomId, subtreeAtomIds);

  while (cache.size > CUT_SUBTREE_CACHE_MAX_ENTRIES) {
    const [oldStartAtomId, oldBlockedAtomId] = cache.insertionOrder.shift() ?? [];
    const oldBlockedAtomCache = cache.byStartAtomId.get(oldStartAtomId);
    if (!oldBlockedAtomCache?.delete(oldBlockedAtomId)) {
      continue;
    }
    cache.size--;
    if (oldBlockedAtomCache.size === 0) {
      cache.byStartAtomId.delete(oldStartAtomId);
    }
  }
}

/**
 * Collects a covalently connected side of the graph while treating one bond as cut.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} startAtomId - Starting atom on the candidate subtree side.
 * @param {string} blockedAtomId - Atom across the cut bond to exclude from traversal.
 * @returns {Set<string>} Connected atoms reachable from the start atom without crossing the cut bond.
 */
export function collectCutSubtree(layoutGraph, startAtomId, blockedAtomId) {
  const cache = getCutSubtreeCache(layoutGraph);
  const cachedAtomIds = cachedCutSubtree(cache, startAtomId, blockedAtomId);
  if (cachedAtomIds) {
    return cachedAtomIds;
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

  rememberCutSubtree(cache, startAtomId, blockedAtomId, subtreeAtomIds);
  return subtreeAtomIds;
}
