import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { placeRemainingBranches } from '../../../src/layoutv2/placement/branch-placement.js';
import { createLayoutGraph } from '../../../src/layoutv2/model/layout-graph.js';
import { computeCanonicalAtomRanks } from '../../../src/layoutv2/topology/canonical-order.js';
import { makeChain } from '../support/molecules.js';

describe('layoutv2/placement/branch-placement', () => {
  it('places remaining branch atoms away from an existing backbone', () => {
    const molecule = makeChain(3);
    molecule.addAtom('a3', 'C');
    molecule.addBond('b3', 'a1', 'a3', {}, false);
    const adjacency = new Map([
      ['a0', ['a1']],
      ['a1', ['a0', 'a2', 'a3']],
      ['a2', ['a1']],
      ['a3', ['a1']]
    ]);
    const coords = new Map([
      ['a0', { x: 0, y: 0 }],
      ['a1', { x: 1.5, y: 0 }],
      ['a2', { x: 3, y: 0 }]
    ]);
    placeRemainingBranches(adjacency, computeCanonicalAtomRanks(molecule), coords, new Set(['a0', 'a1', 'a2', 'a3']), ['a0', 'a1', 'a2'], 1.5);
    assert.equal(coords.has('a3'), true);
    assert.notDeepEqual(coords.get('a3'), { x: 1.5, y: 0 });
    assert.notEqual(coords.get('a3').y, 0);
  });

  it('falls back to a nonpreferred continuation angle when both zig-zag slots are blocked', () => {
    const molecule = makeChain(3);
    molecule.addAtom('b1', 'C');
    molecule.addAtom('b2', 'C');
    const adjacency = new Map([
      ['a0', ['a1']],
      ['a1', ['a0', 'a2']],
      ['a2', ['a1']]
    ]);
    const coords = new Map([
      ['a0', { x: 0, y: 0 }],
      ['a1', { x: 1.5, y: 0 }],
      ['b1', { x: 2.25, y: 1.299038105676658 }],
      ['b2', { x: 2.25, y: -1.299038105676658 }]
    ]);

    placeRemainingBranches(adjacency, computeCanonicalAtomRanks(molecule), coords, new Set(['a0', 'a1', 'a2']), ['a0', 'a1'], 1.5);

    assert.deepEqual(coords.get('a2'), { x: 3, y: 0 });
  });

  it('uses the seeded placement CoM to steer continuation away from fixed refinement anchors', () => {
    const molecule = makeChain(3);
    molecule.addAtom('x0', 'C');
    molecule.addAtom('x1', 'C');
    const graph = createLayoutGraph(molecule, {
      fixedCoords: new Map([
        ['x0', { x: 1.5, y: 3 }]
      ])
    });
    const adjacency = new Map([
      ['a0', ['a1']],
      ['a1', ['a0', 'a2']],
      ['a2', ['a1']]
    ]);
    const coords = new Map([
      ['a0', { x: 0, y: 0 }],
      ['a1', { x: 1.5, y: 0 }],
      ['x1', { x: 6, y: 0 }]
    ]);

    placeRemainingBranches(adjacency, graph.canonicalAtomRank, coords, new Set(['a0', 'a1', 'a2']), ['a0', 'a1'], 1.5, graph);

    assert.ok(coords.get('a2').y < 0, 'expected continuation to bend away from the fixed CoM anchor above the chain');
  });
});
