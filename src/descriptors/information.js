/** @module descriptors/information */

/**
 * Computes the graph entropy based on vertex degree partitioning (Mowshowitz 1968).
 *
 * H = -Σ (nk/n) * log2(nk/n), where nk = number of atoms with degree k.
 *
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @returns {number}
 */
export function graphEntropy(molecule) {
  const heavyIds = [...molecule.atoms.keys()].filter(id => molecule.atoms.get(id)?.name !== 'H');
  const n = heavyIds.length;
  if (n === 0) {
    return 0;
  }

  const degreeCounts = new Map();
  for (const id of heavyIds) {
    const deg = molecule.getNeighbors(id)
      .filter(neighborId => molecule.atoms.get(neighborId)?.name !== 'H').length;
    degreeCounts.set(deg, (degreeCounts.get(deg) ?? 0) + 1);
  }

  let entropy = 0;
  for (const count of degreeCounts.values()) {
    const p = count / n;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * Computes the topological information index based on distance sums (Bonchev-Trinajstić).
 *
 * Uses the row sums of the distance matrix as the partition criterion.
 *
 * @param {number[][]} D - All-pairs shortest-path distance matrix.
 * @returns {number}
 */
export function topologicalEntropy(D) {
  if (!Array.isArray(D) || D.length === 0 || !Array.isArray(D[0])) {
    throw new TypeError('D must be a non-empty 2D array.');
  }
  const n = D.length;
  for (let i = 0; i < n; i++) {
    if (!Array.isArray(D[i]) || D[i].length !== n) {
      throw new TypeError(`D must be a square (n×n) matrix — row ${i} has length ${D[i]?.length ?? 'undefined'}, expected ${n}.`);
    }
    for (let j = 0; j < n; j++) {
      if (!Number.isFinite(D[i][j])) {
        throw new TypeError(`D must represent a connected graph with finite distances — found ${D[i][j]} at [${i}][${j}].`);
      }
    }
  }
  const totalSum = D.reduce((s, row) => s + row.reduce((a, b) => a + b, 0), 0);
  if (totalSum === 0) {
    return 0;
  }

  let entropy = 0;
  for (const row of D) {
    const rowSum = row.reduce((a, b) => a + b, 0);
    if (rowSum > 0) {
      const p = rowSum / totalSum;
      entropy -= p * Math.log2(p);
    }
  }
  return entropy;
}
