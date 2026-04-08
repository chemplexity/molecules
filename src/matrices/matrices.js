/** @module matrices */

/**
 * Builds the adjacency matrix of a molecule (hydrogen-suppressed).
 *
 * Hydrogen atoms are excluded; only heavy atoms appear as rows/columns.
 * A[i][j] = 1 if heavy atoms i and j share a bond, 0 otherwise.
 * Atoms are indexed in insertion order.
 * @param {import('../core/Molecule.js').Molecule} molecule - The molecule graph.
 * @returns {number[][]} The n×n adjacency matrix over heavy atoms.
 */
export function adjacencyMatrix(molecule) {
  if (!molecule || !(molecule.atoms instanceof Map) || !(molecule.bonds instanceof Map)) {
    throw new TypeError('Invalid molecule object for adjacency matrix');
  }
  const atomIds = [...molecule.atoms.keys()].filter(id => molecule.atoms.get(id).name !== 'H');
  const n = atomIds.length;
  const index = new Map(atomIds.map((id, i) => [id, i]));
  const matrix = Array.from({ length: n }, () => new Array(n).fill(0));

  for (const bond of molecule.bonds.values()) {
    const i = index.get(bond.atoms[0]);
    const j = index.get(bond.atoms[1]);
    if (i === undefined || j === undefined) {
      continue;
    }
    matrix[i][j] = 1;
    matrix[j][i] = 1;
  }

  return matrix;
}

/**
 * Builds the degree matrix from an adjacency matrix.
 *
 * DEG is a diagonal matrix where DEG[i][i] = sum of row i in A (the vertex degree).
 * @param {number[][]} A - Square adjacency matrix.
 * @returns {number[][]} The n×n diagonal degree matrix.
 */
export function degreeMatrix(A) {
  if (!Array.isArray(A)) {
    throw new TypeError('Invalid adjacency matrix for degree matrix');
  }
  const n = A.length;
  const DEG = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    DEG[i][i] = A[i].reduce((sum, val) => sum + val, 0);
  }
  return DEG;
}

/**
 * Builds the distance matrix from an adjacency matrix using Floyd-Warshall.
 *
 * D[i][j] = shortest path length between atom i and atom j.
 * @param {number[][]} A - Square adjacency matrix.
 * @returns {number[][]} The n×n distance matrix.
 */
export function distanceMatrix(A) {
  if (!Array.isArray(A)) {
    throw new TypeError('Invalid adjacency matrix for distance matrix');
  }
  const n = A.length;
  const D = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (__, j) => {
      if (i === j) {
        return 0;
      }
      return A[i][j] === 1 ? 1 : Infinity;
    })
  );

  for (let k = 0; k < n; k++) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (D[i][k] + D[k][j] < D[i][j]) {
          D[i][j] = D[i][k] + D[k][j];
        }
      }
    }
  }

  return D;
}

/**
 * Builds the Laplacian matrix L = DEG - A.
 * @param {number[][]} A - Square adjacency matrix.
 * @param {number[][]} DEG - Diagonal degree matrix.
 * @returns {number[][]} The n×n Laplacian matrix.
 */
export function laplacianMatrix(A, DEG) {
  if (!Array.isArray(A) || !Array.isArray(DEG)) {
    throw new TypeError('Invalid matrices for Laplacian matrix');
  }
  const n = A.length;
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (__, j) => DEG[i][j] - A[i][j]));
}

/**
 * Builds the Randić matrix.
 *
 * R[i][j] = 1 / sqrt(deg(i) * deg(j)) if atoms i and j are bonded, 0 otherwise.
 * @param {number[][]} A - Square adjacency matrix.
 * @param {number[][]} DEG - Diagonal degree matrix.
 * @returns {number[][]} The n×n Randić matrix.
 */
export function randicMatrix(A, DEG) {
  if (!Array.isArray(A) || !Array.isArray(DEG)) {
    throw new TypeError('Invalid matrices for Randic matrix');
  }
  const n = A.length;
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (__, j) => {
      if (A[i][j] === 0) {
        return 0;
      }
      const di = DEG[i][i];
      const dj = DEG[j][j];
      return di === 0 || dj === 0 ? 0 : 1 / Math.sqrt(di * dj);
    })
  );
}

/**
 * Builds the reciprocal distance matrix.
 *
 * RD[i][j] = 1 / D[i][j] for i ≠ j, 0 for i = j.
 * @param {number[][]} D - Square distance matrix.
 * @returns {number[][]} The n×n reciprocal distance matrix.
 */
export function reciprocalMatrix(D) {
  if (!Array.isArray(D)) {
    throw new TypeError('Invalid distance matrix for reciprocal matrix');
  }
  const n = D.length;
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (__, j) => {
      if (i === j || D[i][j] === 0 || D[i][j] === Infinity) {
        return 0;
      }
      return 1 / D[i][j];
    })
  );
}

/**
 * Computes all standard matrices for a molecule in a single pass.
 * @param {import('../core/Molecule.js').Molecule} molecule - The molecule graph.
 * @returns {{
 *   atomIds:    string[],
 *   adjacency:  number[][],
 *   degree:     number[][],
 *   distance:   number[][],
 *   laplacian:  number[][],
 *   randic:     number[][],
 *   reciprocal: number[][]
 * }} The result object.
 *   `atomIds` maps matrix index → atom ID.
 */
export function allMatrices(molecule) {
  const atomIds = [...molecule.atoms.keys()].filter(id => molecule.atoms.get(id).name !== 'H');
  const adjacency = adjacencyMatrix(molecule);
  const degree = degreeMatrix(adjacency);
  const distance = distanceMatrix(adjacency);
  const laplacian = laplacianMatrix(adjacency, degree);
  const randic = randicMatrix(adjacency, degree);
  const reciprocal = reciprocalMatrix(distance);
  return { atomIds, adjacency, degree, distance, laplacian, randic, reciprocal };
}
