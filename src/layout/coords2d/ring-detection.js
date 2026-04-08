/** @module layout/coords2d/ring-detection */

/**
 * Groups the output of `molecule.getRings()` into ring systems.
 * Two rings belong to the same system if they share at least one atom.
 * @param {string[][]} rings - Array of ring atom ID arrays.
 * @returns {{ atomIds: string[], ringIds: number[] }[]} Array of results.
 */
export function detectRingSystems(rings) {
  if (rings.length === 0) {
    return [];
  }

  // Union-Find
  const parent = rings.map((_, i) => i);
  function find(i) {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }
  function union(i, j) {
    parent[find(i)] = find(j);
  }

  // Build atomId → [ringIdx, …] map
  const atomToRings = new Map();
  for (let ri = 0; ri < rings.length; ri++) {
    for (const atomId of rings[ri]) {
      if (!atomToRings.has(atomId)) {
        atomToRings.set(atomId, []);
      }
      atomToRings.get(atomId).push(ri);
    }
  }

  // Union rings that share an atom
  for (const ringIndices of atomToRings.values()) {
    for (let k = 1; k < ringIndices.length; k++) {
      union(ringIndices[0], ringIndices[k]);
    }
  }

  // Collect into systems
  const systemMap = new Map();
  for (let ri = 0; ri < rings.length; ri++) {
    const root = find(ri);
    if (!systemMap.has(root)) {
      systemMap.set(root, { atomIds: new Set(), ringIds: [] });
    }
    const sys = systemMap.get(root);
    sys.ringIds.push(ri);
    for (const atomId of rings[ri]) {
      sys.atomIds.add(atomId);
    }
  }

  return [...systemMap.values()].map(s => ({ atomIds: [...s.atomIds], ringIds: s.ringIds }));
}

/**
 * Returns atom IDs shared between two rings (as arrays).
 * @param {string[]} ringA - First ring as atom ID array.
 * @param {string[]} ringB - Second ring as atom ID array.
 * @returns {string[]} Array of shared atom IDs.
 */
export function findSharedAtoms(ringA, ringB) {
  const setA = new Set(ringA);
  return ringB.filter(id => setA.has(id));
}
