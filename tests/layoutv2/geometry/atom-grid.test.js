import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { AtomGrid } from '../../../src/layoutv2/geometry/atom-grid.js';

describe('layoutv2/geometry/atom-grid', () => {
  it('inserts, queries, and removes atom ids by spatial neighborhood', () => {
    const atomGrid = new AtomGrid(1.5);
    atomGrid.insert('a0', { x: 0, y: 0 });
    atomGrid.insert('a1', { x: 0.8, y: 0.1 });
    atomGrid.insert('a2', { x: 4, y: 4 });

    assert.deepEqual(
      atomGrid.queryRadius({ x: 0.2, y: 0.1 }, 0.9).sort(),
      ['a0', 'a1']
    );

    atomGrid.remove('a1', { x: 0.8, y: 0.1 });
    assert.deepEqual(atomGrid.queryRadius({ x: 0.2, y: 0.1 }, 0.9), ['a0']);
  });

  it('deep-clones cell membership so later edits do not affect the source grid', () => {
    const atomGrid = new AtomGrid(1.5);
    atomGrid.insert('a0', { x: 0, y: 0 });
    const clone = atomGrid.clone();

    clone.insert('a1', { x: 0.5, y: 0 });

    assert.deepEqual(atomGrid.queryRadius({ x: 0, y: 0 }, 1).sort(), ['a0']);
    assert.deepEqual(clone.queryRadius({ x: 0, y: 0 }, 1).sort(), ['a0', 'a1']);
  });
});
