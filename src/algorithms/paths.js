/** @module algorithms/paths */

import { bfs } from './traversal.js';

/**
 * Computes the all-pairs shortest-path distance matrix for a molecule using BFS.
 *
 * Returns a 2D array D where D[i][j] is the shortest path length between
 * atom i and atom j. Atoms are indexed in insertion order.
 *
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @returns {{ matrix: number[][], atomIds: string[] }}
 *   `matrix` is the n×n distance matrix; `atomIds` maps row/column index to atom ID.
 */
export function allPairsShortestPaths(molecule) {
  const atomIds = [...molecule.atoms.keys()];
  const n = atomIds.length;
  const matrix = Array.from({ length: n }, () => new Array(n).fill(Infinity));

  for (let i = 0; i < n; i++) {
    matrix[i][i] = 0;
    const { depth } = bfs(molecule, atomIds[i]);
    for (let j = 0; j < n; j++) {
      const d = depth.get(atomIds[j]);
      if (d !== undefined) {
        matrix[i][j] = d;
      }
    }
  }

  return { matrix, atomIds };
}
