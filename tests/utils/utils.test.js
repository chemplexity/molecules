import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  zeros,
  ones,
  identity,
  addMatrices,
  subtractMatrices,
  multiplyMatrices,
  scalarMultiply,
  transposeMatrix,
  factorial,
  binomial,
  combinations,
  computeEigenvalues
} from '../../src/utils/index.js';

describe('zeros / ones / identity', () => {
  it('zeros creates all-zero matrix', () => {
    const M = zeros(2, 3);
    assert.deepEqual(M, [
      [0, 0, 0],
      [0, 0, 0]
    ]);
  });

  it('ones creates all-one matrix', () => {
    assert.deepEqual(ones(2, 2), [
      [1, 1],
      [1, 1]
    ]);
  });

  it('identity creates n×n identity', () => {
    assert.deepEqual(identity(3), [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1]
    ]);
  });
});

describe('matrix arithmetic', () => {
  it('addMatrices', () => {
    const A = [
      [1, 2],
      [3, 4]
    ];
    const B = [
      [5, 6],
      [7, 8]
    ];
    assert.deepEqual(addMatrices(A, B), [
      [6, 8],
      [10, 12]
    ]);
  });

  it('subtractMatrices', () => {
    const A = [
      [5, 6],
      [7, 8]
    ];
    const B = [
      [1, 2],
      [3, 4]
    ];
    assert.deepEqual(subtractMatrices(A, B), [
      [4, 4],
      [4, 4]
    ]);
  });

  it('multiplyMatrices 2×2', () => {
    const A = [
      [1, 2],
      [3, 4]
    ];
    const B = [
      [1, 0],
      [0, 1]
    ];
    assert.deepEqual(multiplyMatrices(A, B), A);
  });

  it('scalarMultiply', () => {
    assert.deepEqual(
      scalarMultiply(
        [
          [1, 2],
          [3, 4]
        ],
        2
      ),
      [
        [2, 4],
        [6, 8]
      ]
    );
  });

  it('transposeMatrix', () => {
    assert.deepEqual(
      transposeMatrix([
        [1, 2, 3],
        [4, 5, 6]
      ]),
      [
        [1, 4],
        [2, 5],
        [3, 6]
      ]
    );
  });
});

describe('combinatorics', () => {
  it('factorial', () => {
    assert.equal(factorial(5), 120);
    assert.equal(factorial(0), 1);
  });

  it('binomial', () => {
    assert.equal(binomial(5, 2), 10);
    assert.equal(binomial(0, 0), 1);
  });

  it('combinations', () => {
    const result = combinations([1, 2, 3], 2);
    assert.equal(result.length, 3);
  });
});

describe('computeEigenvalues', () => {
  it('2×2 symmetric matrix has correct eigenvalues', () => {
    // [[2, 1], [1, 2]] has eigenvalues 3 and 1
    const ev = computeEigenvalues([
      [2, 1],
      [1, 2]
    ]).sort((a, b) => b - a);
    assert.ok(Math.abs(ev[0] - 3) < 1e-8);
    assert.ok(Math.abs(ev[1] - 1) < 1e-8);
  });
});

// ---------------------------------------------------------------------------
// v1-ported tests — detailed arithmetic cases
// ---------------------------------------------------------------------------

describe('zeros — detailed', () => {
  it('creates 1×1 matrix of zeros by default', () => {
    const M = zeros(1, 1);
    assert.equal(M.length, 1);
    assert.equal(M[0][0], 0);
  });

  it('creates 3×4 matrix of zeros', () => {
    const M = zeros(3, 4);
    assert.equal(M.length, 3);
    assert.equal(M[0].length, 4);
    assert.equal(M[2][3], 0);
  });
});

describe('ones — detailed', () => {
  it('creates 2×3 matrix of ones', () => {
    const M = ones(2, 3);
    assert.equal(M.length, 2);
    assert.equal(M[0].length, 3);
    assert.equal(M[1][2], 1);
  });
});

describe('addMatrices — detailed', () => {
  it('zero matrix + B = B', () => {
    const A = [
      [0, 0],
      [0, 0]
    ];
    const B = [
      [1, 2],
      [3, 4]
    ];
    assert.deepEqual(addMatrices(A, B), B);
  });
});

describe('subtractMatrices — detailed', () => {
  it('produces negative results correctly', () => {
    const A = [
      [1, 2],
      [3, 4]
    ];
    const B = [
      [5, 6],
      [7, 8]
    ];
    const R = subtractMatrices(A, B);
    assert.equal(R[0][0], -4);
    assert.equal(R[1][1], -4);
  });
});

describe('multiplyMatrices — detailed', () => {
  it('general 2×2 multiplication', () => {
    const A = [
      [1, 2],
      [3, 4]
    ];
    const B = [
      [5, 6],
      [7, 8]
    ];
    const R = multiplyMatrices(A, B);
    assert.equal(R[0][0], 19);
    assert.equal(R[0][1], 22);
    assert.equal(R[1][0], 43);
    assert.equal(R[1][1], 50);
  });

  it('identity matrix multiplication leaves A unchanged', () => {
    const A = [
      [1, 2],
      [3, 4]
    ];
    const I = [
      [1, 0],
      [0, 1]
    ];
    assert.deepEqual(multiplyMatrices(A, I), A);
  });
});

describe('scalarMultiply — detailed', () => {
  it('multiplying by 2', () => {
    const R = scalarMultiply(
      [
        [1, 2],
        [3, 4]
      ],
      2
    );
    assert.equal(R[0][0], 2);
    assert.equal(R[1][1], 8);
  });
});
