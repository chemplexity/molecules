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
  const n = molecule.atomCount;
  if (n === 0) {
    return 0;
  }

  const degreeCounts = new Map();
  for (const id of molecule.atoms.keys()) {
    const deg = molecule.getDegree(id);
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
