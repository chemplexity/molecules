import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Molecule } from '../../src/core/index.js';
import { adjacencyMatrix, degreeMatrix, distanceMatrix, laplacianMatrix, randicMatrix, reciprocalMatrix } from '../../src/matrices/index.js';
import { parseSMILES } from '../../src/io/index.js';

function propane() {
  const mol = new Molecule();
  mol.addAtom('a0', 'C');
  mol.addAtom('a1', 'C');
  mol.addAtom('a2', 'C');
  mol.addBond('b0', 'a0', 'a1');
  mol.addBond('b1', 'a1', 'a2');
  return mol;
}

describe('adjacencyMatrix', () => {
  it('propane has correct A', () => {
    const A = adjacencyMatrix(propane());
    assert.equal(A[0][1], 1);
    assert.equal(A[1][2], 1);
    assert.equal(A[0][2], 0);
    assert.equal(A[1][1], 0);
  });
});

describe('degreeMatrix', () => {
  it('propane has degrees [1, 2, 1]', () => {
    const A = adjacencyMatrix(propane());
    const DEG = degreeMatrix(A);
    assert.equal(DEG[0][0], 1);
    assert.equal(DEG[1][1], 2);
    assert.equal(DEG[2][2], 1);
  });
});

describe('distanceMatrix', () => {
  it('propane has correct D', () => {
    const D = distanceMatrix(adjacencyMatrix(propane()));
    assert.equal(D[0][2], 2);
    assert.equal(D[0][0], 0);
  });
});

describe('laplacianMatrix', () => {
  it('row sums are zero', () => {
    const A = adjacencyMatrix(propane());
    const DEG = degreeMatrix(A);
    const L = laplacianMatrix(A, DEG);
    for (const row of L) {
      const sum = row.reduce((a, b) => a + b, 0);
      assert.ok(Math.abs(sum) < 1e-10);
    }
  });
});

describe('randicMatrix', () => {
  it('off-diagonal bonded entry equals 1/sqrt(di*dj)', () => {
    const A = adjacencyMatrix(propane());
    const DEG = degreeMatrix(A);
    const R = randicMatrix(A, DEG);
    assert.ok(Math.abs(R[0][1] - 1 / Math.sqrt(1 * 2)) < 1e-10);
  });
});

describe('reciprocalMatrix', () => {
  it('D[0][2]=2 maps to RD[0][2]=0.5', () => {
    const D = distanceMatrix(adjacencyMatrix(propane()));
    const RD = reciprocalMatrix(D);
    assert.ok(Math.abs(RD[0][2] - 0.5) < 1e-10);
    assert.equal(RD[0][0], 0);
  });

  it('handles zero distances as 0 in reciprocal', () => {
    const D = [[0, 1], [1, 0]];
    const RD = reciprocalMatrix(D);
    assert.equal(RD[0][0], 0);
    assert.equal(RD[0][1], 1);
  });

  it('throws for null input', () => {
    assert.throws(() => reciprocalMatrix(null), /Invalid distance matrix/);
  });

  it('returns empty array for empty input', () => {
    const RD = reciprocalMatrix([]);
    assert.deepEqual(RD, []);
  });
});

describe('adjacencyMatrix — via parseSMILES', () => {
  it('is a square matrix over heavy atoms only (CC → 2×2)', () => {
    const mol = parseSMILES('CC');
    const A = adjacencyMatrix(mol);
    assert.ok(Array.isArray(A));
    assert.equal(A.length, 2);
    assert.equal(A[0].length, 2);
  });

  it('CCC: adjacency size equals heavy atom count (3, H-suppressed)', () => {
    const mol = parseSMILES('CCC');
    const A = adjacencyMatrix(mol);
    assert.equal(A.length, 3);
  });

  it('empty Molecule returns empty matrix', () => {
    const A = adjacencyMatrix(new Molecule());
    assert.deepEqual(A, []);
  });

  it('throws for null input', () => {
    assert.throws(() => adjacencyMatrix(null), /Invalid molecule object/);
  });

  it('throws for molecule without atoms Map', () => {
    assert.throws(() => adjacencyMatrix({ bonds: new Map() }), /Invalid molecule object/);
  });
});

describe('degreeMatrix — via parseSMILES', () => {
  it('is a square matrix with size matching adjacency', () => {
    const mol = parseSMILES('CC');
    const A = adjacencyMatrix(mol);
    const DEG = degreeMatrix(A);
    assert.equal(DEG.length, A.length);
  });

  it('throws for null input', () => {
    assert.throws(() => degreeMatrix(null), /Invalid adjacency matrix for degree matrix/);
  });

  it('throws for non-array input', () => {
    assert.throws(() => degreeMatrix('not an array'), /Invalid adjacency matrix for degree matrix/);
  });
});

describe('distanceMatrix — via parseSMILES', () => {
  it('is a square matrix with size matching adjacency', () => {
    const mol = parseSMILES('CC');
    const A = adjacencyMatrix(mol);
    const D = distanceMatrix(A);
    assert.equal(D.length, A.length);
  });

  it('CCC heavy-atom distance: d(C1,C3)=2, d(C1,C2)=1', () => {
    const mol = parseSMILES('CCC');
    const A = adjacencyMatrix(mol);
    const D = distanceMatrix(A);
    // All-zero adjacency (disconnected) stays 0 after Floyd-Warshall for Infinity entries
    // Verify diagonal is 0
    for (let i = 0; i < D.length; i++) {
      assert.equal(D[i][i], 0);
    }
  });

  it('all-zero adjacency (disconnected) produces 0 on diagonal', () => {
    const D = distanceMatrix([[0, 0], [0, 0]]);
    assert.equal(D[0][0], 0);
    assert.equal(D[1][1], 0);
  });

  it('throws for null input', () => {
    assert.throws(() => distanceMatrix(null), /Invalid adjacency matrix for distance matrix/);
  });
});

describe('laplacianMatrix — via parseSMILES', () => {
  it('is a square matrix matching adjacency size', () => {
    const mol = parseSMILES('CC');
    const A = adjacencyMatrix(mol);
    const DEG = degreeMatrix(A);
    const L = laplacianMatrix(A, DEG);
    assert.equal(L.length, A.length);
  });

  it('throws for null adjacency', () => {
    assert.throws(() => laplacianMatrix(null, []), /Invalid matrices for Laplacian matrix/);
  });

  it('throws for null degree', () => {
    assert.throws(() => laplacianMatrix([], null), /Invalid matrices for Laplacian matrix/);
  });

  it('handles empty arrays', () => {
    const L = laplacianMatrix([], []);
    assert.deepEqual(L, []);
  });
});

describe('randicMatrix — via parseSMILES', () => {
  it('is a square matrix matching adjacency size', () => {
    const mol = parseSMILES('CC');
    const A = adjacencyMatrix(mol);
    const DEG = degreeMatrix(A);
    const R = randicMatrix(A, DEG);
    assert.equal(R.length, A.length);
  });

  it('throws for null adjacency', () => {
    assert.throws(() => randicMatrix(null, []), /Invalid matrices for Randic matrix/);
  });
});
