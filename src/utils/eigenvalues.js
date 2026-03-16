/** @module utils/eigenvalues */

/**
 * Computes all eigenvalues of a real symmetric matrix using the Jacobi eigenvalue algorithm.
 *
 * Iteratively zeroes the largest off-diagonal element via Givens rotations until
 * all off-diagonal elements are below a tolerance.
 *
 * @param {number[][]} M - Real symmetric n×n matrix.
 * @returns {number[]} Array of n eigenvalues (unordered).
 */
export function computeEigenvalues(M) {
  const n = M.length;
  if (n === 0) {
    return [];
  }
  if (n === 1) {
    return [M[0][0]];
  }

  const A = M.map((row) => [...row]);
  const MAX_SWEEPS = 100 * n * n;

  for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
    // Find the largest off-diagonal element
    let maxVal = 0;
    let p = 0;
    let q = 1;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (Math.abs(A[i][j]) > maxVal) {
          maxVal = Math.abs(A[i][j]);
          p = i;
          q = j;
        }
      }
    }

    if (maxVal < 1e-12) {
      break;
    }

    // Compute the Givens rotation angle that zeroes A[p][q]
    const theta = 0.5 * Math.atan2(2 * A[p][q], A[q][q] - A[p][p]);
    const c = Math.cos(theta);
    const s = Math.sin(theta);

    // Apply rotation: A <- G^T * A * G  (similarity transform)
    const app = c * c * A[p][p] - 2 * s * c * A[p][q] + s * s * A[q][q];
    const aqq = s * s * A[p][p] + 2 * s * c * A[p][q] + c * c * A[q][q];

    for (let r = 0; r < n; r++) {
      if (r === p || r === q) {
        continue;
      }
      const apr = c * A[p][r] - s * A[q][r];
      const aqr = s * A[p][r] + c * A[q][r];
      A[p][r] = apr;
      A[r][p] = apr;
      A[q][r] = aqr;
      A[r][q] = aqr;
    }

    A[p][p] = app;
    A[q][q] = aqq;
    A[p][q] = 0;
    A[q][p] = 0;
  }

  return A.map((row, i) => row[i]);
}
