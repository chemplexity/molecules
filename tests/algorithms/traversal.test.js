import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Molecule } from '../../src/core/index.js';
import { bfs, dfs } from '../../src/algorithms/traversal.js';

function propane() {
  const mol = new Molecule();
  mol.addAtom('a0', 'C');
  mol.addAtom('a1', 'C');
  mol.addAtom('a2', 'C');
  mol.addBond('b0', 'a0', 'a1', {}, false);
  mol.addBond('b1', 'a1', 'a2', {}, false);
  return mol;
}

describe('bfs', () => {
  it('visits all atoms', () => {
    const mol = propane();
    const { visited } = bfs(mol, 'a0');
    assert.deepEqual(visited.sort(), ['a0', 'a1', 'a2']);
  });

  it('records correct depths', () => {
    const mol = propane();
    const { depth } = bfs(mol, 'a0');
    assert.equal(depth.get('a0'), 0);
    assert.equal(depth.get('a1'), 1);
    assert.equal(depth.get('a2'), 2);
  });

  it('returns an empty traversal for an unknown start atom', () => {
    const mol = propane();
    const result = bfs(mol, 'missing');
    assert.deepEqual(result.visited, []);
    assert.equal(result.parent.size, 0);
    assert.equal(result.depth.size, 0);
  });
});

describe('dfs', () => {
  it('visits all atoms', () => {
    const mol = propane();
    const { visited } = dfs(mol, 'a0');
    assert.deepEqual(visited.sort(), ['a0', 'a1', 'a2']);
  });

  it('returns an empty traversal for an unknown start atom', () => {
    const mol = propane();
    const result = dfs(mol, 'missing');
    assert.deepEqual(result.visited, []);
    assert.equal(result.parent.size, 0);
    assert.deepEqual(result.finishOrder, []);
  });
});
