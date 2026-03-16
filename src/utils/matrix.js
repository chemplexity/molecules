/** @module utils/matrix */

/**
 * Creates an n×m matrix filled with zeros.
 * @param {number} n - Number of rows.
 * @param {number} m - Number of columns.
 * @returns {number[][]}
 */
export function zeros(n, m) {
  return Array.from({ length: n }, () => new Array(m).fill(0));
}

/**
 * Creates an n×m matrix filled with ones.
 * @param {number} n - Number of rows.
 * @param {number} m - Number of columns.
 * @returns {number[][]}
 */
export function ones(n, m) {
  return Array.from({ length: n }, () => new Array(m).fill(1));
}

/**
 * Creates an n×n identity matrix.
 * @param {number} n - Matrix size.
 * @returns {number[][]}
 */
export function identity(n) {
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (__, j) => (i === j ? 1 : 0))
  );
}

/**
 * Adds two matrices element-wise.
 * @param {number[][]} A
 * @param {number[][]} B
 * @returns {number[][]}
 */
export function addMatrices(A, B) {
  return A.map((row, i) => row.map((val, j) => val + B[i][j]));
}

/**
 * Subtracts matrix B from A element-wise.
 * @param {number[][]} A
 * @param {number[][]} B
 * @returns {number[][]}
 */
export function subtractMatrices(A, B) {
  return A.map((row, i) => row.map((val, j) => val - B[i][j]));
}

/**
 * Multiplies two matrices.
 * @param {number[][]} A - n×m matrix.
 * @param {number[][]} B - m×p matrix.
 * @returns {number[][]} n×p matrix.
 */
export function multiplyMatrices(A, B) {
  const n = A.length;
  const m = B.length;
  const p = B[0].length;
  const C = zeros(n, p);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < m; k++) {
      if (A[i][k] === 0) {
        continue;
      }
      for (let j = 0; j < p; j++) {
        C[i][j] += A[i][k] * B[k][j];
      }
    }
  }
  return C;
}

/**
 * Multiplies a matrix by a scalar.
 * @param {number[][]} A
 * @param {number} k - Scalar multiplier.
 * @returns {number[][]}
 */
export function scalarMultiply(A, k) {
  return A.map((row) => row.map((val) => val * k));
}

/**
 * Transposes a matrix.
 * @param {number[][]} A - n×m matrix.
 * @returns {number[][]} m×n matrix.
 */
export function transposeMatrix(A) {
  return A[0].map((_, j) => A.map((row) => row[j]));
}
