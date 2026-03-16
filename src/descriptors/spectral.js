/** @module descriptors/spectral */

import { computeEigenvalues } from '../utils/index.js';

/**
 * Computes the eigenvalues of the adjacency matrix, sorted in descending order.
 *
 * @param {number[][]} A - Square symmetric adjacency matrix.
 * @returns {number[]} Eigenvalues sorted descending.
 */
export function adjacencySpectrum(A) {
  return computeEigenvalues(A).sort((a, b) => b - a);
}

/**
 * Computes the eigenvalues of the Laplacian matrix, sorted in ascending order.
 *
 * The second-smallest eigenvalue (algebraic connectivity / Fiedler value) indicates
 * graph connectivity strength.
 *
 * @param {number[][]} L - Square symmetric Laplacian matrix.
 * @returns {number[]} Eigenvalues sorted ascending.
 */
export function laplacianSpectrum(L) {
  return computeEigenvalues(L).sort((a, b) => a - b);
}

/**
 * Returns the spectral radius (largest eigenvalue of the adjacency matrix).
 *
 * @param {number[][]} A - Square symmetric adjacency matrix.
 * @returns {number}
 */
export function spectralRadius(A) {
  return adjacencySpectrum(A)[0] ?? 0;
}

/**
 * Computes the Estrada index.
 *
 * EE = Σ e^λᵢ for all eigenvalues λᵢ of the adjacency matrix.
 *
 * @param {number[][]} A - Square symmetric adjacency matrix.
 * @returns {number}
 */
export function estradaIndex(A) {
  const eigenvalues = computeEigenvalues(A);
  return eigenvalues.reduce((sum, λ) => sum + Math.exp(λ), 0);
}
