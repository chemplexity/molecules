/** @module utils/combinatorics */

/**
 * Computes n! (factorial).
 * @param {number} n - Non-negative integer.
 * @returns {number}
 */
export function factorial(n) {
  let result = 1;
  for (let i = 2; i <= n; i++) {
    result *= i;
  }
  return result;
}

/**
 * Computes the binomial coefficient C(n, k).
 * @param {number} n
 * @param {number} k
 * @returns {number}
 */
export function binomial(n, k) {
  if (k < 0 || k > n) {
    return 0;
  }
  if (k === 0 || k === n) {
    return 1;
  }
  const kk = Math.min(k, n - k);
  let result = 1;
  for (let i = 0; i < kk; i++) {
    result = (result * (n - i)) / (i + 1);
  }
  return Math.round(result);
}

/**
 * Returns all k-element combinations of an array.
 * @template T
 * @param {T[]} arr
 * @param {number} k
 * @returns {T[][]}
 */
export function combinations(arr, k) {
  if (k === 0) {
    return [[]];
  }
  if (arr.length < k) {
    return [];
  }
  const [first, ...rest] = arr;
  const withFirst = combinations(rest, k - 1).map(c => [first, ...c]);
  const withoutFirst = combinations(rest, k);
  return [...withFirst, ...withoutFirst];
}
