import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Molecule } from '../../src/core/index.js';
import { allPairsShortestPaths } from '../../src/algorithms/paths.js';

describe('allPairsShortestPaths', () => {
  it('propane (C-C-C) has correct distances', () => {
    const mol = new Molecule();
    mol.addAtom('a0', 'C');
    mol.addAtom('a1', 'C');
    mol.addAtom('a2', 'C');
    mol.addBond('b0', 'a0', 'a1');
    mol.addBond('b1', 'a1', 'a2');

    const { matrix } = allPairsShortestPaths(mol);
    assert.equal(matrix[0][0], 0);
    assert.equal(matrix[0][1], 1);
    assert.equal(matrix[0][2], 2);
    assert.equal(matrix[1][2], 1);
  });
});
