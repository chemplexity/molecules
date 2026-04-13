import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Molecule } from '../../../../src/core/index.js';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { collectCutSubtree } from '../../../../src/layout/engine/cleanup/subtree-utils.js';

describe('layout/engine/cleanup/subtree-utils', () => {
  it('collects only the connected side of a covalent cut bond', () => {
    const molecule = new Molecule();
    molecule.addAtom('a0', 'C');
    molecule.addAtom('a1', 'C');
    molecule.addAtom('a2', 'C');
    molecule.addAtom('a3', 'C');
    molecule.addBond('b0', 'a0', 'a1', {}, false);
    molecule.addBond('b1', 'a1', 'a2', {}, false);
    molecule.addBond('b2', 'a2', 'a3', {}, false);
    const layoutGraph = createLayoutGraph(molecule);

    const subtreeAtomIds = collectCutSubtree(layoutGraph, 'a2', 'a1');

    assert.deepEqual([...subtreeAtomIds].sort(), ['a2', 'a3']);
  });

  it('includes attached hydrogens and side branches on the traversed side only', () => {
    const molecule = new Molecule();
    molecule.addAtom('a0', 'C');
    molecule.addAtom('a1', 'C');
    molecule.addAtom('a2', 'C');
    molecule.addAtom('h3', 'H');
    molecule.addAtom('a4', 'C');
    molecule.addBond('b0', 'a0', 'a1', {}, false);
    molecule.addBond('b1', 'a1', 'a2', {}, false);
    molecule.addBond('b2', 'a2', 'h3', {}, false);
    molecule.addBond('b3', 'a2', 'a4', {}, false);
    const layoutGraph = createLayoutGraph(molecule);

    const subtreeAtomIds = collectCutSubtree(layoutGraph, 'a2', 'a1');

    assert.deepEqual([...subtreeAtomIds].sort(), ['a2', 'a4', 'h3']);
  });
});
