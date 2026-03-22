import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Molecule } from '../../src/core/index.js';
import { adjacencyMatrix, distanceMatrix } from '../../src/matrices/index.js';
import { parseSMILES } from '../../src/io/smiles.js';
import { graphEntropy, topologicalEntropy } from '../../src/descriptors/information.js';

describe('graphEntropy', () => {
  it('single atom has entropy 0', () => {
    const mol = new Molecule();
    mol.addAtom('a0', 'C');
    assert.equal(graphEntropy(mol), 0);
  });

  it('propane has non-zero entropy (two degree classes)', () => {
    const mol = new Molecule();
    mol.addAtom('a0', 'C');
    mol.addAtom('a1', 'C');
    mol.addAtom('a2', 'C');
    mol.addBond('b0', 'a0', 'a1');
    mol.addBond('b1', 'a1', 'a2');
    const h = graphEntropy(mol);
    assert.ok(h > 0);
  });

  it('parsed benzene has entropy 0 on the heavy-atom graph', () => {
    assert.equal(graphEntropy(parseSMILES('c1ccccc1')), 0);
  });
});

describe('topologicalEntropy', () => {
  it('returns a non-negative number for propane', () => {
    const mol = new Molecule();
    mol.addAtom('a0', 'C');
    mol.addAtom('a1', 'C');
    mol.addAtom('a2', 'C');
    mol.addBond('b0', 'a0', 'a1');
    mol.addBond('b1', 'a1', 'a2');
    const D = distanceMatrix(adjacencyMatrix(mol));
    const h = topologicalEntropy(D);
    assert.ok(h >= 0);
  });

  it('rejects disconnected distance matrices', () => {
    const mol = parseSMILES('[NH4+].[Cl-]');
    const D = distanceMatrix(adjacencyMatrix(mol));
    assert.throws(() => topologicalEntropy(D), /connected graph/);
  });
});
