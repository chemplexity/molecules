import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Molecule } from '../../src/core/index.js';
import { adjacencyMatrix, degreeMatrix, laplacianMatrix } from '../../src/matrices/index.js';
import { adjacencySpectrum, laplacianSpectrum, spectralRadius, estradaIndex } from '../../src/descriptors/spectral.js';

function propane() {
  const mol = new Molecule();
  mol.addAtom('a0', 'C');
  mol.addAtom('a1', 'C');
  mol.addAtom('a2', 'C');
  mol.addBond('b0', 'a0', 'a1');
  mol.addBond('b1', 'a1', 'a2');
  return mol;
}

describe('adjacencySpectrum', () => {
  it('propane has 3 eigenvalues', () => {
    const A = adjacencyMatrix(propane());
    const ev = adjacencySpectrum(A);
    assert.equal(ev.length, 3);
  });

  it('spectral radius is sqrt(2) for propane', () => {
    const A = adjacencyMatrix(propane());
    const ev = adjacencySpectrum(A);
    assert.ok(Math.abs(ev[0] - Math.sqrt(2)) < 1e-6);
  });
});

describe('laplacianSpectrum', () => {
  it('smallest eigenvalue is ~0 (connected graph)', () => {
    const A = adjacencyMatrix(propane());
    const DEG = degreeMatrix(A);
    const L = laplacianMatrix(A, DEG);
    const ev = laplacianSpectrum(L);
    assert.ok(Math.abs(ev[0]) < 1e-8);
  });
});

describe('spectralRadius', () => {
  it('equals first eigenvalue of adjacency spectrum', () => {
    const A = adjacencyMatrix(propane());
    const ev = adjacencySpectrum(A);
    assert.ok(Math.abs(spectralRadius(A) - ev[0]) < 1e-10);
  });
});

describe('estradaIndex', () => {
  // propane (P3): eigenvalues √2, 0, -√2
  // EE = e^√2 + e^0 + e^(-√2) = e^√2 + 1 + e^(-√2)
  it('propane EE = e^√2 + 1 + e^(-√2)', () => {
    const A = adjacencyMatrix(propane());
    const expected = Math.exp(Math.SQRT2) + 1 + Math.exp(-Math.SQRT2);
    assert.ok(Math.abs(estradaIndex(A) - expected) < 1e-6);
  });

  // benzene (C6): eigenvalues 2, 1, 1, -1, -1, -2
  // EE = e^2 + 2e^1 + 2e^(-1) + e^(-2)
  it('benzene EE = e^2 + 2e + 2/e + 1/e^2', () => {
    const mol = new Molecule();
    for (let i = 0; i < 6; i++) {
      mol.addAtom(`c${i}`, 'C');
    }
    for (let i = 0; i < 6; i++) {
      mol.addBond(`e${i}`, `c${i}`, `c${(i + 1) % 6}`);
    }
    const A = adjacencyMatrix(mol);
    const expected = Math.exp(2) + 2 * Math.exp(1) + 2 * Math.exp(-1) + Math.exp(-2);
    assert.ok(Math.abs(estradaIndex(A) - expected) < 1e-6);
  });

  // ethane (P2): eigenvalues 1, -1 → EE = e + 1/e
  it('ethane EE = e + 1/e', () => {
    const mol = new Molecule();
    mol.addAtom('c0', 'C');
    mol.addAtom('c1', 'C');
    mol.addBond('e0', 'c0', 'c1');
    const A = adjacencyMatrix(mol);
    const expected = Math.exp(1) + Math.exp(-1);
    assert.ok(Math.abs(estradaIndex(A) - expected) < 1e-6);
  });

  // neopentane (K1,4): eigenvalues 2, -2, 0, 0, 0 → EE = e^2 + e^(-2) + 3
  it('neopentane (K1,4) EE = e^2 + e^-2 + 3', () => {
    const mol = new Molecule();
    mol.addAtom('c', 'C');
    for (const id of ['a', 'b', 'd', 'e']) {
      mol.addAtom(id, 'C');
    }
    for (const [bi, id] of [['b0', 'a'], ['b1', 'b'], ['b2', 'd'], ['b3', 'e']]) {
      mol.addBond(bi, 'c', id);
    }
    const A = adjacencyMatrix(mol);
    const expected = Math.exp(2) + Math.exp(-2) + 3;
    assert.ok(Math.abs(estradaIndex(A) - expected) < 1e-6);
  });

  // cyclopentane (C5): eigenvalues 2, 1/φ, 1/φ, −φ, −φ  (φ = golden ratio = (1+√5)/2)
  // EE = e^2 + 2·e^(1/φ) + 2·e^(-φ)
  it('cyclopentane EE = e^2 + 2·e^(1/φ) + 2·e^(-φ)', () => {
    const mol = new Molecule();
    for (let i = 0; i < 5; i++) {
      mol.addAtom(`c${i}`, 'C');
    }
    for (let i = 0; i < 5; i++) {
      mol.addBond(`e${i}`, `c${i}`, `c${(i + 1) % 5}`);
    }
    const A = adjacencyMatrix(mol);
    const phi = (1 + Math.sqrt(5)) / 2;
    const expected = Math.exp(2) + 2 * Math.exp(1 / phi) + 2 * Math.exp(-phi);
    assert.ok(Math.abs(estradaIndex(A) - expected) < 1e-6);
  });
});
