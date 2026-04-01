import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Molecule } from '../../src/core/index.js';
import {
  adjacencyMatrix,
  degreeMatrix,
  distanceMatrix,
  reciprocalMatrix,
  randicMatrix
} from '../../src/matrices/index.js';
import { parseSMILES } from '../../src/io/index.js';
import {
  wienerIndex,
  hyperWienerIndex,
  balabanIndex,
  randicIndex,
  zagreb1,
  zagreb2,
  hararyIndex,
  plattIndex,
  szegedIndex,
  hosoyaIndex,
  abcIndex,
  gaIndex,
  harmonicIndex,
  sumConnectivityIndex,
  eccentricConnectivityIndex,
  wienerPolarityIndex,
  schultzIndex,
  gutmanIndex,
  forgottenIndex,
  narumiKatayamaIndex
} from '../../src/descriptors/topological.js';

function propane() {
  const mol = new Molecule();
  mol.addAtom('a0', 'C');
  mol.addAtom('a1', 'C');
  mol.addAtom('a2', 'C');
  mol.addBond('b0', 'a0', 'a1', {}, false);
  mol.addBond('b1', 'a1', 'a2', {}, false);
  return mol;
}

describe('wienerIndex', () => {
  it('propane W = 4', () => {
    const D = distanceMatrix(adjacencyMatrix(propane()));
    assert.equal(wienerIndex(D), 4);
  });
});

describe('hyperWienerIndex', () => {
  it('propane WW = (1+1 + 2+4)/2 = 4', () => {
    const D = distanceMatrix(adjacencyMatrix(propane()));
    // pairs (0,1)=1, (0,2)=2, (1,2)=1 → (1+1)+(2+4)+(1+1) = 2+6+2=10, /2=5
    assert.equal(hyperWienerIndex(D), 5);
  });
});

describe('randicIndex', () => {
  it('propane χ = 1/sqrt(2) + 1/sqrt(2)', () => {
    const mol = propane();
    const A = adjacencyMatrix(mol);
    const DEG = degreeMatrix(A);
    const expected = 2 / Math.sqrt(1 * 2);
    assert.ok(Math.abs(randicIndex(A, DEG) - expected) < 1e-10);
  });
});

describe('zagreb1', () => {
  it('propane M1 = 1²+2²+1² = 6', () => {
    const A = adjacencyMatrix(propane());
    const DEG = degreeMatrix(A);
    assert.equal(zagreb1(DEG), 6);
  });
});

describe('zagreb2', () => {
  it('propane M2 = 1*2 + 2*1 = 4', () => {
    const mol = propane();
    const A = adjacencyMatrix(mol);
    const DEG = degreeMatrix(A);
    assert.equal(zagreb2(A, DEG), 4);
  });
});

describe('hararyIndex', () => {
  it('propane H = 1 + 0.5 + 1 = 2.5', () => {
    const D = distanceMatrix(adjacencyMatrix(propane()));
    const RD = reciprocalMatrix(D);
    assert.ok(Math.abs(hararyIndex(RD) - 2.5) < 1e-10);
  });
});

describe('hosoyaIndex', () => {
  it('propane Z = 3 (0 matchings: 1, 1 matching: 2 options, so Z = 1+2=3)', () => {
    assert.equal(hosoyaIndex(propane()), 3);
  });
});

// ---------------------------------------------------------------------------
// v1-ported tests — using parseSMILES and error throwing
// ---------------------------------------------------------------------------

describe('wienerIndex — via parseSMILES', () => {
  it('returns a non-negative number for ethane CC', () => {
    const mol = parseSMILES('CC');
    const D = distanceMatrix(adjacencyMatrix(mol));
    const W = wienerIndex(D);
    assert.equal(typeof W, 'number');
    assert.ok(W >= 0);
  });

  it('single atom: W = 0', () => {
    const mol = new Molecule();
    mol.addAtom('C1', 'C');
    const D = distanceMatrix(adjacencyMatrix(mol));
    assert.equal(wienerIndex(D), 0);
  });

  it('throws for null input', () => {
    assert.throws(() => wienerIndex(null), /non-empty 2D array/);
  });

  it('CCC W > 0', () => {
    const mol = parseSMILES('CCC');
    const D = distanceMatrix(adjacencyMatrix(mol));
    assert.ok(wienerIndex(D) > 0);
  });
});

describe('hararyIndex — via parseSMILES', () => {
  it('returns a non-negative number for ethane CC', () => {
    const mol = parseSMILES('CC');
    const D = distanceMatrix(adjacencyMatrix(mol));
    const RD = reciprocalMatrix(D);
    const H = hararyIndex(RD);
    assert.equal(typeof H, 'number');
    assert.ok(H >= 0);
  });

  it('throws for null input', () => {
    assert.throws(() => hararyIndex(null), /non-empty 2D array/);
  });
});

describe('balabanIndex — via parseSMILES', () => {
  it('returns a non-negative number for ethane CC', () => {
    const mol = parseSMILES('CC');
    const D = distanceMatrix(adjacencyMatrix(mol));
    const A = adjacencyMatrix(mol);
    const J = balabanIndex(D, A);
    assert.equal(typeof J, 'number');
    assert.ok(J >= 0);
  });

  it('throws for null distance matrix', () => {
    assert.throws(() => balabanIndex(null, []), /non-empty 2D array/);
  });
});

describe('hyperWienerIndex — via parseSMILES', () => {
  it('returns a non-negative number for ethane CC', () => {
    const mol = parseSMILES('CC');
    const D = distanceMatrix(adjacencyMatrix(mol));
    const WW = hyperWienerIndex(D);
    assert.equal(typeof WW, 'number');
    assert.ok(WW >= 0);
  });

  it('throws for null input', () => {
    assert.throws(() => hyperWienerIndex(null), /non-empty 2D array/);
  });
});

describe('randicIndex — via parseSMILES', () => {
  it('returns a number for ethane CC', () => {
    const mol = parseSMILES('CC');
    const A = adjacencyMatrix(mol);
    const DEG = degreeMatrix(A);
    const chi = randicIndex(A, DEG);
    assert.equal(typeof chi, 'number');
  });

  it('randicMatrix for propane has correct off-diagonal values', () => {
    const mol = propane();
    const A = adjacencyMatrix(mol);
    const DEG = degreeMatrix(A);
    const R = randicMatrix(A, DEG);
    // bonded pair (0,1): di=1, dj=2 → 1/sqrt(2)
    assert.ok(Math.abs(R[0][1] - 1 / Math.sqrt(1 * 2)) < 1e-10);
  });
});

// ---------------------------------------------------------------------------
// Known reference values — H-suppressed graphs
// ---------------------------------------------------------------------------
// n-Butane  (P4 path): a0-a1-a2-a3
// Isobutane (K1,3 star): c connected to a, b, d
// Benzene   (C6 ring):  c0-c1-c2-c3-c4-c5-c0

function butane() {
  const mol = new Molecule();
  mol.addAtom('a0', 'C');
  mol.addAtom('a1', 'C');
  mol.addAtom('a2', 'C');
  mol.addAtom('a3', 'C');
  mol.addBond('b0', 'a0', 'a1', {}, false);
  mol.addBond('b1', 'a1', 'a2', {}, false);
  mol.addBond('b2', 'a2', 'a3', {}, false);
  return mol;
}

function isobutane() {
  const mol = new Molecule();
  mol.addAtom('c', 'C');
  mol.addAtom('a', 'C');
  mol.addAtom('b', 'C');
  mol.addAtom('d', 'C');
  mol.addBond('b0', 'c', 'a', {}, false);
  mol.addBond('b1', 'c', 'b', {}, false);
  mol.addBond('b2', 'c', 'd', {}, false);
  return mol;
}

function benzene() {
  const mol = new Molecule();
  for (let i = 0; i < 6; i++) {
    mol.addAtom(`c${i}`, 'C');
  }
  for (let i = 0; i < 6; i++) {
    mol.addBond(`e${i}`, `c${i}`, `c${(i + 1) % 6}`, {}, false);
  }
  return mol;
}

describe('wienerIndex — known values', () => {
  it('n-butane W = 10', () => {
    const D = distanceMatrix(adjacencyMatrix(butane()));
    assert.equal(wienerIndex(D), 10);
  });
  it('isobutane W = 9', () => {
    const D = distanceMatrix(adjacencyMatrix(isobutane()));
    assert.equal(wienerIndex(D), 9);
  });
  it('benzene W = 27', () => {
    const D = distanceMatrix(adjacencyMatrix(benzene()));
    assert.equal(wienerIndex(D), 27);
  });
});

describe('hyperWienerIndex — known values', () => {
  it('n-butane WW = 15', () => {
    const D = distanceMatrix(adjacencyMatrix(butane()));
    assert.equal(hyperWienerIndex(D), 15);
  });
  it('isobutane WW = 12', () => {
    const D = distanceMatrix(adjacencyMatrix(isobutane()));
    assert.equal(hyperWienerIndex(D), 12);
  });
  it('benzene WW = 42', () => {
    const D = distanceMatrix(adjacencyMatrix(benzene()));
    assert.equal(hyperWienerIndex(D), 42);
  });
});

describe('zagreb1 — known values', () => {
  it('n-butane M1 = 10', () => {
    const DEG = degreeMatrix(adjacencyMatrix(butane()));
    assert.equal(zagreb1(DEG), 10);
  });
  it('isobutane M1 = 12', () => {
    const DEG = degreeMatrix(adjacencyMatrix(isobutane()));
    assert.equal(zagreb1(DEG), 12);
  });
  it('benzene M1 = 24', () => {
    const DEG = degreeMatrix(adjacencyMatrix(benzene()));
    assert.equal(zagreb1(DEG), 24);
  });
});

describe('zagreb2 — known values', () => {
  it('n-butane M2 = 8', () => {
    const A = adjacencyMatrix(butane());
    assert.equal(zagreb2(A, degreeMatrix(A)), 8);
  });
  it('isobutane M2 = 9', () => {
    const A = adjacencyMatrix(isobutane());
    assert.equal(zagreb2(A, degreeMatrix(A)), 9);
  });
  it('benzene M2 = 24', () => {
    const A = adjacencyMatrix(benzene());
    assert.equal(zagreb2(A, degreeMatrix(A)), 24);
  });
});

describe('randicIndex — known values', () => {
  // n-butane: edges (1,2),(2,2),(2,1) → 1/√2 + 1/2 + 1/√2 = √2 + 0.5
  it('n-butane χ = √2 + 0.5', () => {
    const A = adjacencyMatrix(butane());
    assert.ok(Math.abs(randicIndex(A, degreeMatrix(A)) - (Math.SQRT2 + 0.5)) < 1e-10);
  });
  // isobutane: three edges (3,1) → 3/√3 = √3
  it('isobutane χ = √3', () => {
    const A = adjacencyMatrix(isobutane());
    assert.ok(Math.abs(randicIndex(A, degreeMatrix(A)) - Math.sqrt(3)) < 1e-10);
  });
  // benzene: six edges (2,2) → 6/√4 = 3
  it('benzene χ = 3', () => {
    const A = adjacencyMatrix(benzene());
    assert.ok(Math.abs(randicIndex(A, degreeMatrix(A)) - 3) < 1e-10);
  });
});

describe('hararyIndex — known values', () => {
  it('n-butane H = 13/3', () => {
    const D = distanceMatrix(adjacencyMatrix(butane()));
    assert.ok(Math.abs(hararyIndex(reciprocalMatrix(D)) - 13 / 3) < 1e-10);
  });
  it('isobutane H = 4.5', () => {
    const D = distanceMatrix(adjacencyMatrix(isobutane()));
    assert.ok(Math.abs(hararyIndex(reciprocalMatrix(D)) - 4.5) < 1e-10);
  });
  it('benzene H = 10', () => {
    const D = distanceMatrix(adjacencyMatrix(benzene()));
    assert.ok(Math.abs(hararyIndex(reciprocalMatrix(D)) - 10) < 1e-10);
  });
});

describe('balabanIndex — known values', () => {
  // benzene: n=6, m=6, μ=2, all row sums=9 → J = (6/2)*(6/9) = 2
  it('benzene J = 2', () => {
    const mol = benzene();
    const A = adjacencyMatrix(mol);
    const D = distanceMatrix(A);
    assert.ok(Math.abs(balabanIndex(D, A) - 2) < 1e-10);
  });
  // n-butane: n=4, m=3, μ=1, row sums [6,4,4,6]
  // edgeSum = 1/√(6×4) + 1/√(4×4) + 1/√(4×6) = 2/√24 + 1/4
  it('n-butane J = 3*(2/√24 + 1/4)', () => {
    const mol = butane();
    const A = adjacencyMatrix(mol);
    const D = distanceMatrix(A);
    const expected = 3 * (2 / Math.sqrt(24) + 0.25);
    assert.ok(Math.abs(balabanIndex(D, A) - expected) < 1e-10);
  });
});

describe('hosoyaIndex — known values', () => {
  it('n-butane Z = 5', () => {
    assert.equal(hosoyaIndex(butane()), 5);
  });
  it('isobutane Z = 4', () => {
    assert.equal(hosoyaIndex(isobutane()), 4);
  });
  it('benzene Z = 18', () => {
    assert.equal(hosoyaIndex(benzene()), 18);
  });

  it('parseSMILES benzene still uses the hydrogen-suppressed graph', () => {
    assert.equal(hosoyaIndex(parseSMILES('c1ccccc1')), 18);
  });
});

describe('plattIndex — known values', () => {
  // propane: edges (1,2),(2,1) → (1+2-2)+(2+1-2) = 2
  it('propane F = 2', () => {
    const A = adjacencyMatrix(propane());
    assert.equal(plattIndex(A, degreeMatrix(A)), 2);
  });
  // n-butane: edges (1,2),(2,2),(2,1) → 1+2+1 = 4
  it('n-butane F = 4', () => {
    const A = adjacencyMatrix(butane());
    assert.equal(plattIndex(A, degreeMatrix(A)), 4);
  });
  // isobutane: three edges (3,1) → 3×2 = 6
  it('isobutane F = 6', () => {
    const A = adjacencyMatrix(isobutane());
    assert.equal(plattIndex(A, degreeMatrix(A)), 6);
  });
  // benzene: six edges (2,2) → 6×2 = 12
  it('benzene F = 12', () => {
    const A = adjacencyMatrix(benzene());
    assert.equal(plattIndex(A, degreeMatrix(A)), 12);
  });
});

describe('szegedIndex — known values', () => {
  // trees: Sz = W
  it('propane Sz = W = 4', () => {
    const A = adjacencyMatrix(propane());
    assert.equal(szegedIndex(distanceMatrix(A), A), 4);
  });
  it('n-butane Sz = W = 10', () => {
    const A = adjacencyMatrix(butane());
    assert.equal(szegedIndex(distanceMatrix(A), A), 10);
  });
  it('isobutane Sz = W = 9', () => {
    const A = adjacencyMatrix(isobutane());
    assert.equal(szegedIndex(distanceMatrix(A), A), 9);
  });
  // ring: Sz > W; benzene C6 → each edge splits 3/3, Sz = 6×9 = 54
  it('benzene Sz = 54', () => {
    const A = adjacencyMatrix(benzene());
    assert.equal(szegedIndex(distanceMatrix(A), A), 54);
  });
});

// ---------------------------------------------------------------------------
// CSV reference molecules (test-molecules.csv)
// W and WW are exact integers; H, J, χ are rounded to 2 d.p. → tolerance 0.005
// Platt and Szeged are exact integers.
// ---------------------------------------------------------------------------

function checkIndices(smiles, { W, WW, H, J, chi, platt, sz }) {
  const mol = parseSMILES(smiles);
  const A = adjacencyMatrix(mol);
  const D = distanceMatrix(A);
  const DEG = degreeMatrix(A);
  const RD = reciprocalMatrix(D);
  if (W !== undefined) {
    assert.equal(wienerIndex(D), W);
  }
  if (WW !== undefined) {
    assert.equal(hyperWienerIndex(D), WW);
  }
  if (H !== undefined) {
    assert.ok(Math.abs(hararyIndex(RD) - H) < 0.005, `Harary: expected ${H}, got ${hararyIndex(RD)}`);
  }
  if (J !== undefined) {
    assert.ok(Math.abs(balabanIndex(D, A) - J) < 0.005, `Balaban: expected ${J}, got ${balabanIndex(D, A)}`);
  }
  if (chi !== undefined) {
    assert.ok(Math.abs(randicIndex(A, DEG) - chi) < 0.005, `Randic: expected ${chi}, got ${randicIndex(A, DEG)}`);
  }
  if (platt !== undefined) {
    assert.equal(plattIndex(A, DEG), platt);
  }
  if (sz !== undefined) {
    assert.equal(szegedIndex(D, A), sz);
  }
}

function checkNewIndices(smiles, { abc, ga, harmonic, sc, ecc, wp, schultz, gutman, forgotten, nk } = {}) {
  const mol = parseSMILES(smiles);
  const A = adjacencyMatrix(mol);
  const D = distanceMatrix(A);
  const DEG = degreeMatrix(A);
  const tol = 1e-8;
  if (abc !== undefined) {
    assert.ok(Math.abs(abcIndex(A, DEG) - abc) < tol, `ABC: expected ${abc}, got ${abcIndex(A, DEG)}`);
  }
  if (ga !== undefined) {
    assert.ok(Math.abs(gaIndex(A, DEG) - ga) < tol, `GA: expected ${ga}, got ${gaIndex(A, DEG)}`);
  }
  if (harmonic !== undefined) {
    assert.ok(
      Math.abs(harmonicIndex(A, DEG) - harmonic) < tol,
      `Harmonic: expected ${harmonic}, got ${harmonicIndex(A, DEG)}`
    );
  }
  if (sc !== undefined) {
    assert.ok(
      Math.abs(sumConnectivityIndex(A, DEG) - sc) < tol,
      `SC: expected ${sc}, got ${sumConnectivityIndex(A, DEG)}`
    );
  }
  if (ecc !== undefined) {
    assert.equal(eccentricConnectivityIndex(A, DEG, D), ecc);
  }
  if (wp !== undefined) {
    assert.equal(wienerPolarityIndex(D), wp);
  }
  if (schultz !== undefined) {
    assert.equal(schultzIndex(DEG, D), schultz);
  }
  if (gutman !== undefined) {
    assert.equal(gutmanIndex(DEG, D), gutman);
  }
  if (forgotten !== undefined) {
    assert.equal(forgottenIndex(DEG), forgotten);
  }
  if (nk !== undefined) {
    assert.equal(narumiKatayamaIndex(DEG), nk);
  }
}

describe('topological indices — CSV reference molecules', () => {
  it('CCCCC (n-pentane)', () => {
    checkIndices('CCCCC', { W: 20, WW: 35, H: 6.42, J: 2.19, chi: 2.41, platt: 6, sz: 20 });
  });
  it('CC(C)CC (isopentane)', () => {
    checkIndices('CC(C)CC', { W: 18, WW: 28, H: 6.67, J: 2.54, chi: 2.27, platt: 8, sz: 18 });
  });
  it('CC(C)(C)C (neopentane)', () => {
    checkIndices('CC(C)(C)C', { W: 16, WW: 22, H: 7.0, J: 3.02, chi: 2.0 });
  });
  it('CC=CC (2-butene)', () => {
    checkIndices('CC=CC', { W: 10, WW: 15, H: 4.33, J: 1.97, chi: 1.91 });
  });
  it('C=CCC (1-butene)', () => {
    checkIndices('C=CCC', { W: 10, WW: 15, H: 4.33, J: 1.97, chi: 1.91 });
  });
  it('C/C=C\\C (Z-2-butene)', () => {
    checkIndices('C/C=C\\C', { W: 10, WW: 15, H: 4.33, J: 1.97, chi: 1.91 });
  });
  it('C/C=C/C (E-2-butene)', () => {
    checkIndices('C/C=C/C', { W: 10, WW: 15, H: 4.33, J: 1.97, chi: 1.91 });
  });
  it('C=CC=C (1,3-butadiene)', () => {
    checkIndices('C=CC=C', { W: 10, WW: 15, H: 4.33, J: 1.97, chi: 1.91 });
  });
  it('C=C=CC (1,2-butadiene)', () => {
    checkIndices('C=C=CC', { W: 10, WW: 15, H: 4.33, J: 1.97, chi: 1.91 });
  });
  it('CC#CC (2-butyne)', () => {
    checkIndices('CC#CC', { W: 10, WW: 15, H: 4.33, J: 1.97, chi: 1.91 });
  });
  it('C#CCC (1-butyne)', () => {
    checkIndices('C#CCC', { W: 10, WW: 15, H: 4.33, J: 1.97, chi: 1.91 });
  });
  it('OCCCC (1-butanol)', () => {
    checkIndices('OCCCC', { W: 20, WW: 35, H: 6.42, J: 2.19, chi: 2.41 });
  });
  it('CC(O)CC (2-butanol)', () => {
    checkIndices('CC(O)CC', { W: 18, WW: 28, H: 6.67, J: 2.54, chi: 2.27 });
  });
  it('CC(O)(C)C (tert-butanol)', () => {
    checkIndices('CC(O)(C)C', { W: 16, WW: 22, H: 7.0, J: 3.02, chi: 2.0 });
  });
  it('C(=O)CCC (butanal)', () => {
    checkIndices('C(=O)CCC', { W: 20, WW: 35, H: 6.42, J: 2.19, chi: 2.41 });
  });
  it('CC(=O)CC (butanone)', () => {
    checkIndices('CC(=O)CC', { W: 18, WW: 28, H: 6.67, J: 2.54, chi: 2.27 });
  });
  it('C1CCCCC1 (cyclohexane)', () => {
    checkIndices('C1CCCCC1', { W: 27, WW: 42, H: 10.0, J: 2.0, chi: 3.0 });
  });
  it('[C@H]1=[C@@H][C@@H]=[C@@H][C@@H]=[C@@H][C@@H]=[C@@H]1 (cyclooctatetraene)', () => {
    checkIndices('[C@H]1=[C@@H][C@@H]=[C@@H][C@@H]=[C@@H][C@@H]=[C@@H]1', {
      W: 64,
      WW: 120,
      H: 15.67,
      J: 2.0,
      chi: 4.0
    });
  });
  it('c1ccccc1 (benzene)', () => {
    checkIndices('c1ccccc1', { W: 27, WW: 42, H: 10.0, J: 2.0, chi: 3.0 });
  });
  it('C12=CC=CC=C1C3=C(C=CC=C3)C=C2 (anthracene)', () => {
    checkIndices('C12=CC=CC=C1C3=C(C=CC=C3)C=C2', { W: 271, WW: 636, H: 41.14, J: 1.74, chi: 6.95 });
  });
  it('c1occc1 (furan)', () => {
    checkIndices('c1occc1', { W: 15, WW: 20, H: 7.5, J: 2.08, chi: 2.5 });
  });
  it('NC(CCCNC(N)=N)C(O)=O (arginine)', () => {
    checkIndices('NC(CCCNC(N)=N)C(O)=O', { W: 247, WW: 739, H: 26.92, J: 3.2, chi: 5.54 });
  });
  it('CC(=O)C(Cl)CC(C(C)C)C=C', () => {
    checkIndices('CC(=O)C(Cl)CC(C(C)C)C=C', { W: 211, WW: 523, H: 28.42, J: 3.85, chi: 5.49, platt: 28, sz: 211 });
  });
  it('C2C(=O)C1COCCC1CC2', () => {
    checkIndices('C2C(=O)C1COCCC1CC2', { W: 140, WW: 285, H: 27.85, J: 1.99, chi: 5.38, platt: 32, sz: 300 });
  });
  it('CC(CC(Cl)CCO)C', () => {
    checkIndices('CC(CC(Cl)CCO)C', { W: 102, WW: 234, H: 17.52, J: 3.15, chi: 4.16, platt: 18, sz: 102 });
  });
  it('CC1C(CC(CC1C)CCO)=O', () => {
    checkIndices('CC1C(CC(CC1C)CCO)=O', { W: 197, WW: 468, H: 30.09, J: 2.42, chi: 5.65, platt: 32, sz: 303 });
  });
  it('NC(C(CC)C)C(O)=O', () => {
    checkIndices('NC(C(CC)C)C(O)=O', { W: 92, WW: 188, H: 18.23, J: 3.58, chi: 4.09, platt: 20, sz: 92 });
  });
});

// ---------------------------------------------------------------------------
// New descriptors: ABC, GA, Harmonic, Sum-Connectivity, ECC, WP, Schultz,
// Gutman, Forgotten, Narumi-Katayama
// ---------------------------------------------------------------------------

describe('abcIndex — known values', () => {
  // propane: 2 edges (d=1,d=2) → 2·√(1/2) = √2
  it('propane ABC = √2', () => {
    const A = adjacencyMatrix(propane());
    const DEG = degreeMatrix(A);
    assert.ok(Math.abs(abcIndex(A, DEG) - Math.SQRT2) < 1e-10);
  });
  // n-butane: edges (1,2),(2,2),(2,1) → 3·√(1/2) = 3√2/2
  it('n-butane ABC = 3√2/2', () => {
    const A = adjacencyMatrix(butane());
    const DEG = degreeMatrix(A);
    assert.ok(Math.abs(abcIndex(A, DEG) - (3 * Math.SQRT2) / 2) < 1e-10);
  });
  // isobutane: 3 edges (3,1) → 3·√(2/3) = √6
  it('isobutane ABC = √6', () => {
    const A = adjacencyMatrix(isobutane());
    const DEG = degreeMatrix(A);
    assert.ok(Math.abs(abcIndex(A, DEG) - Math.sqrt(6)) < 1e-10);
  });
  // benzene: 6 edges (2,2) → 6·√(2/4) = 3√2
  it('benzene ABC = 3√2', () => {
    const A = adjacencyMatrix(benzene());
    const DEG = degreeMatrix(A);
    assert.ok(Math.abs(abcIndex(A, DEG) - 3 * Math.SQRT2) < 1e-10);
  });
});

describe('gaIndex — known values', () => {
  // propane: 2 edges (1,2) → 2·(2√2/3) = 4√2/3
  it('propane GA = 4√2/3', () => {
    const A = adjacencyMatrix(propane());
    const DEG = degreeMatrix(A);
    assert.ok(Math.abs(gaIndex(A, DEG) - (4 * Math.SQRT2) / 3) < 1e-10);
  });
  // isobutane: 3 edges (3,1) → 3·(2√3/4) = 3√3/2
  it('isobutane GA = 3√3/2', () => {
    const A = adjacencyMatrix(isobutane());
    const DEG = degreeMatrix(A);
    assert.ok(Math.abs(gaIndex(A, DEG) - (3 * Math.sqrt(3)) / 2) < 1e-10);
  });
  // benzene: 6 edges (2,2) → 6·1 = 6
  it('benzene GA = 6', () => {
    const A = adjacencyMatrix(benzene());
    const DEG = degreeMatrix(A);
    assert.ok(Math.abs(gaIndex(A, DEG) - 6) < 1e-10);
  });
});

describe('harmonicIndex — known values', () => {
  // propane: 2 edges (1,2) → 2·(2/3) = 4/3
  it('propane Harmonic = 4/3', () => {
    const A = adjacencyMatrix(propane());
    const DEG = degreeMatrix(A);
    assert.ok(Math.abs(harmonicIndex(A, DEG) - 4 / 3) < 1e-10);
  });
  // isobutane: 3 edges (3,1) → 3·(2/4) = 3/2
  it('isobutane Harmonic = 3/2', () => {
    const A = adjacencyMatrix(isobutane());
    const DEG = degreeMatrix(A);
    assert.ok(Math.abs(harmonicIndex(A, DEG) - 3 / 2) < 1e-10);
  });
  // benzene: 6 edges (2,2) → 6·(2/4) = 3
  it('benzene Harmonic = 3', () => {
    const A = adjacencyMatrix(benzene());
    const DEG = degreeMatrix(A);
    assert.ok(Math.abs(harmonicIndex(A, DEG) - 3) < 1e-10);
  });
});

describe('sumConnectivityIndex — known values', () => {
  // propane: 2 edges (1,2) → 2/√3
  it('propane SC = 2/√3', () => {
    const A = adjacencyMatrix(propane());
    const DEG = degreeMatrix(A);
    assert.ok(Math.abs(sumConnectivityIndex(A, DEG) - 2 / Math.sqrt(3)) < 1e-10);
  });
  // isobutane: 3 edges (3,1) → 3/√4 = 3/2
  it('isobutane SC = 3/2', () => {
    const A = adjacencyMatrix(isobutane());
    const DEG = degreeMatrix(A);
    assert.ok(Math.abs(sumConnectivityIndex(A, DEG) - 3 / 2) < 1e-10);
  });
  // benzene: 6 edges (2,2) → 6/√4 = 3
  it('benzene SC = 3', () => {
    const A = adjacencyMatrix(benzene());
    const DEG = degreeMatrix(A);
    assert.ok(Math.abs(sumConnectivityIndex(A, DEG) - 3) < 1e-10);
  });
});

describe('eccentricConnectivityIndex — known values', () => {
  // propane: ecc=[2,1,2], deg=[1,2,1] → 1·2+2·1+1·2 = 6
  it('propane ξ = 6', () => {
    const A = adjacencyMatrix(propane());
    const DEG = degreeMatrix(A);
    const D = distanceMatrix(A);
    assert.equal(eccentricConnectivityIndex(A, DEG, D), 6);
  });
  // n-butane: ecc=[3,2,2,3], deg=[1,2,2,1] → 3+4+4+3 = 14
  it('n-butane ξ = 14', () => {
    const A = adjacencyMatrix(butane());
    const DEG = degreeMatrix(A);
    const D = distanceMatrix(A);
    assert.equal(eccentricConnectivityIndex(A, DEG, D), 14);
  });
  // isobutane: ecc=[1,2,2,2], deg=[3,1,1,1] → 3+2+2+2 = 9
  it('isobutane ξ = 9', () => {
    const A = adjacencyMatrix(isobutane());
    const DEG = degreeMatrix(A);
    const D = distanceMatrix(A);
    assert.equal(eccentricConnectivityIndex(A, DEG, D), 9);
  });
  // benzene: all ecc=3, all deg=2 → 6·(2·3) = 36
  it('benzene ξ = 36', () => {
    const A = adjacencyMatrix(benzene());
    const DEG = degreeMatrix(A);
    const D = distanceMatrix(A);
    assert.equal(eccentricConnectivityIndex(A, DEG, D), 36);
  });
});

describe('wienerPolarityIndex — known values', () => {
  // propane: max dist = 2, no pairs at dist 3 → 0
  it('propane Wp = 0', () => {
    const D = distanceMatrix(adjacencyMatrix(propane()));
    assert.equal(wienerPolarityIndex(D), 0);
  });
  // isobutane: max dist = 2, no pairs at dist 3 → 0
  it('isobutane Wp = 0', () => {
    const D = distanceMatrix(adjacencyMatrix(isobutane()));
    assert.equal(wienerPolarityIndex(D), 0);
  });
  // n-butane: pair (0,3) at dist 3 → 1
  it('n-butane Wp = 1', () => {
    const D = distanceMatrix(adjacencyMatrix(butane()));
    assert.equal(wienerPolarityIndex(D), 1);
  });
  // benzene: pairs at dist 3 → (0,3),(1,4),(2,5) → 3
  it('benzene Wp = 3', () => {
    const D = distanceMatrix(adjacencyMatrix(benzene()));
    assert.equal(wienerPolarityIndex(D), 3);
  });
});

describe('schultzIndex — known values', () => {
  // propane: (1+2)·1 + (1+1)·2 + (2+1)·1 = 3+4+3 = 10
  it('propane MTI = 10', () => {
    const A = adjacencyMatrix(propane());
    assert.equal(schultzIndex(degreeMatrix(A), distanceMatrix(A)), 10);
  });
  // n-butane: 3+6+6+4+6+3 = 28
  it('n-butane MTI = 28', () => {
    const A = adjacencyMatrix(butane());
    assert.equal(schultzIndex(degreeMatrix(A), distanceMatrix(A)), 28);
  });
  // isobutane: 4+4+4+4+4+4 = 24
  it('isobutane MTI = 24', () => {
    const A = adjacencyMatrix(isobutane());
    assert.equal(schultzIndex(degreeMatrix(A), distanceMatrix(A)), 24);
  });
  // benzene: 24+48+36 = 108
  it('benzene MTI = 108', () => {
    const A = adjacencyMatrix(benzene());
    assert.equal(schultzIndex(degreeMatrix(A), distanceMatrix(A)), 108);
  });
});

describe('gutmanIndex — known values', () => {
  // propane: 1·2·1 + 1·1·2 + 2·1·1 = 2+2+2 = 6
  it('propane Gut = 6', () => {
    const A = adjacencyMatrix(propane());
    assert.equal(gutmanIndex(degreeMatrix(A), distanceMatrix(A)), 6);
  });
  // n-butane: 2+4+3+4+4+2 = 19
  it('n-butane Gut = 19', () => {
    const A = adjacencyMatrix(butane());
    assert.equal(gutmanIndex(degreeMatrix(A), distanceMatrix(A)), 19);
  });
  // isobutane: 3+3+3+2+2+2 = 15
  it('isobutane Gut = 15', () => {
    const A = adjacencyMatrix(isobutane());
    assert.equal(gutmanIndex(degreeMatrix(A), distanceMatrix(A)), 15);
  });
  // benzene: 24+48+36 = 108
  it('benzene Gut = 108', () => {
    const A = adjacencyMatrix(benzene());
    assert.equal(gutmanIndex(degreeMatrix(A), distanceMatrix(A)), 108);
  });
});

describe('forgottenIndex — known values', () => {
  // propane: 1³+2³+1³ = 10
  it('propane F = 10', () => {
    const DEG = degreeMatrix(adjacencyMatrix(propane()));
    assert.equal(forgottenIndex(DEG), 10);
  });
  // n-butane: 1³+2³+2³+1³ = 18
  it('n-butane F = 18', () => {
    const DEG = degreeMatrix(adjacencyMatrix(butane()));
    assert.equal(forgottenIndex(DEG), 18);
  });
  // isobutane: 3³+1³+1³+1³ = 30
  it('isobutane F = 30', () => {
    const DEG = degreeMatrix(adjacencyMatrix(isobutane()));
    assert.equal(forgottenIndex(DEG), 30);
  });
  // benzene: 6·2³ = 48
  it('benzene F = 48', () => {
    const DEG = degreeMatrix(adjacencyMatrix(benzene()));
    assert.equal(forgottenIndex(DEG), 48);
  });
});

describe('narumiKatayamaIndex — known values', () => {
  // propane: 1·2·1 = 2
  it('propane NK = 2', () => {
    const DEG = degreeMatrix(adjacencyMatrix(propane()));
    assert.equal(narumiKatayamaIndex(DEG), 2);
  });
  // n-butane: 1·2·2·1 = 4
  it('n-butane NK = 4', () => {
    const DEG = degreeMatrix(adjacencyMatrix(butane()));
    assert.equal(narumiKatayamaIndex(DEG), 4);
  });
  // isobutane: 3·1·1·1 = 3
  it('isobutane NK = 3', () => {
    const DEG = degreeMatrix(adjacencyMatrix(isobutane()));
    assert.equal(narumiKatayamaIndex(DEG), 3);
  });
  // benzene: 2^6 = 64
  it('benzene NK = 64', () => {
    const DEG = degreeMatrix(adjacencyMatrix(benzene()));
    assert.equal(narumiKatayamaIndex(DEG), 64);
  });
});

// ---------------------------------------------------------------------------
// New descriptors — additional SMILES reference molecules
// Ethane (P2):       2 carbons, 1 edge (1,1) — ABC = 0 edge case
// n-Pentane (P5):    chain of 5, degrees [1,2,2,2,1]
// Neopentane (K1,4): star, centre degree 4 and 4 leaves of degree 1
// Cyclopentane (C5): 5-ring, all degrees 2
// ---------------------------------------------------------------------------

describe('new descriptors — additional molecules', () => {
  // Ethane (P2): one edge (d=1, d=1)
  // ABC = √((1+1-2)/(1·1)) = 0; GA = 2·1/2 = 1; H = 2/2 = 1; SC = 1/√2
  // ECC = 2·(1·1) = 2; WP = 0; MTI = (1+1)·1 = 2; Gut = 1·1·1 = 1
  // Forgotten = 2·1³ = 2; NK = 1·1 = 1
  it('ethane CC', () => {
    checkNewIndices('CC', {
      abc: 0,
      ga: 1,
      harmonic: 1,
      sc: 1 / Math.SQRT2,
      ecc: 2,
      wp: 0,
      schultz: 2,
      gutman: 1,
      forgotten: 2,
      nk: 1
    });
  });

  // n-Pentane (P5): edges (1,2),(2,2),(2,2),(2,1)
  // ABC = 4·1/√2 = 2√2; GA = 2·(2√2/3) + 2·1 = 4√2/3+2
  // H = 2·(2/3) + 2·(1/2) = 7/3; SC = 2/√3 + 2·(1/2) = 2/√3+1
  // ECC: eccs=[4,3,2,3,4], degs=[1,2,2,2,1] → 4+6+4+6+4=24; WP: pairs@3=(0,3),(1,4)→2
  // MTI = 60; Gut = 44; Forgotten = 2·1³+3·2³ = 26; NK = 1·2·2·2·1 = 8
  it('n-pentane CCCCC', () => {
    checkNewIndices('CCCCC', {
      abc: 2 * Math.SQRT2,
      ga: (4 * Math.SQRT2) / 3 + 2,
      harmonic: 7 / 3,
      sc: 2 / Math.sqrt(3) + 1,
      ecc: 24,
      wp: 2,
      schultz: 60,
      gutman: 44,
      forgotten: 26,
      nk: 8
    });
  });

  // Neopentane (K1,4): centre degree 4, 4 leaves degree 1
  // ABC = 4·√(3/4) = 2√3; GA = 4·(4/5) = 16/5
  // H = 4·(2/5) = 8/5; SC = 4/√5
  // ECC: centre ecc=1 d=4→4, 4 leaves ecc=2 d=1→2 each → 12; WP = 0
  // MTI = 4·(4+1)·1 + 6·(1+1)·2 = 20+24 = 44
  // Gut = 4·4·1·1 + 6·1·1·2 = 16+12 = 28
  // Forgotten = 4³ + 4·1³ = 68; NK = 4·1^4 = 4
  it('neopentane CC(C)(C)C', () => {
    checkNewIndices('CC(C)(C)C', {
      abc: 2 * Math.sqrt(3),
      ga: 16 / 5,
      harmonic: 8 / 5,
      sc: 4 / Math.sqrt(5),
      ecc: 12,
      wp: 0,
      schultz: 44,
      gutman: 28,
      forgotten: 68,
      nk: 4
    });
  });

  // Cyclopentane (C5): 5-ring, all degrees 2, max dist = 2
  // 5 edges (2,2): ABC = 5/√2; GA = 5; H = 5/2; SC = 5/2
  // ECC: 5·(2·2) = 20; WP = 0 (no dist-3 pairs in C5)
  // MTI: 5 pairs@1: 4·1=20; 5 pairs@2: 4·2=40 → 60
  // Gut: 5 pairs@1: 4·1=20; 5 pairs@2: 4·2=40 → 60
  // Forgotten = 5·2³ = 40; NK = 2^5 = 32
  it('cyclopentane C1CCCC1', () => {
    checkNewIndices('C1CCCC1', {
      abc: (5 * Math.SQRT2) / 2,
      ga: 5,
      harmonic: 5 / 2,
      sc: 5 / 2,
      ecc: 20,
      wp: 0,
      schultz: 60,
      gutman: 60,
      forgotten: 40,
      nk: 32
    });
  });
});

describe('distance-based indices reject disconnected graphs', () => {
  it('Wiener/hyper-Wiener/Balaban/Schultz/Gutman reject salts', () => {
    const mol = parseSMILES('[NH4+].[Cl-]');
    const A = adjacencyMatrix(mol);
    const D = distanceMatrix(A);
    const DEG = degreeMatrix(A);
    assert.throws(() => wienerIndex(D), /connected graph/);
    assert.throws(() => hyperWienerIndex(D), /connected graph/);
    assert.throws(() => balabanIndex(D, A), /connected graph/);
    assert.throws(() => schultzIndex(DEG, D), /connected graph/);
    assert.throws(() => gutmanIndex(DEG, D), /connected graph/);
  });
});
