import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Molecule } from '../../../src/core/index.js';
import { placeRemainingBranches } from '../../../src/layoutv2/placement/branch-placement.js';
import { createLayoutGraph } from '../../../src/layoutv2/model/layout-graph.js';
import { computeCanonicalAtomRanks } from '../../../src/layoutv2/topology/canonical-order.js';
import { makeChain, makeDimethylSulfone } from '../support/molecules.js';

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

  it('places double-bond children from sp2 centers on the exterior trigonal bisector', () => {
    const molecule = new Molecule();
    molecule.addAtom('a0', 'C');
    molecule.addAtom('a1', 'C');
    molecule.addAtom('a2', 'C');
    molecule.addAtom('a3', 'C');
    molecule.addBond('b0', 'a0', 'a1', {}, false);
    molecule.addBond('b1', 'a1', 'a2', {}, false);
    molecule.addBond('b2', 'a1', 'a3', { order: 2 }, false);
    const graph = createLayoutGraph(molecule);
    const adjacency = new Map([
      ['a0', ['a1']],
      ['a1', ['a0', 'a2', 'a3']],
      ['a2', ['a1']],
      ['a3', ['a1']]
    ]);
    const coords = new Map([
      ['a0', { x: -0.75, y: -1.299038105676658 }],
      ['a1', { x: 0, y: 0 }],
      ['a2', { x: -0.75, y: 1.299038105676658 }]
    ]);

    placeRemainingBranches(adjacency, graph.canonicalAtomRank, coords, new Set(['a0', 'a1', 'a2', 'a3']), ['a0', 'a1', 'a2'], 1.5, graph);

    assert.ok(Math.abs(coords.get('a3').x - 1.5) < 1e-6);
    assert.ok(Math.abs(coords.get('a3').y) < 1e-6);
  });

  it('prefers a cross-like spread for hypervalent sulfur centers with one placed single bond', () => {
    const molecule = new Molecule();
    molecule.addAtom('c0', 'C');
    molecule.addAtom('s0', 'S');
    molecule.addAtom('o0', 'O');
    molecule.addAtom('o1', 'O');
    molecule.addAtom('n0', 'N');
    molecule.addBond('b0', 'c0', 's0', {}, false);
    molecule.addBond('b1', 's0', 'o0', { order: 2 }, false);
    molecule.addBond('b2', 's0', 'o1', { order: 2 }, false);
    molecule.addBond('b3', 's0', 'n0', {}, false);
    const graph = createLayoutGraph(molecule, { suppressH: true });
    const adjacency = new Map([
      ['c0', ['s0']],
      ['s0', ['c0', 'o0', 'o1', 'n0']],
      ['o0', ['s0']],
      ['o1', ['s0']],
      ['n0', ['s0']]
    ]);
    const coords = new Map([
      ['c0', { x: 0, y: 0 }],
      ['s0', { x: 1.5, y: 0 }]
    ]);

    placeRemainingBranches(adjacency, graph.canonicalAtomRank, coords, new Set(['c0', 's0', 'o0', 'o1', 'n0']), ['c0', 's0'], 1.5, graph);

    const sulfurPosition = coords.get('s0');
    const nitrogenAngle = ((Math.atan2(coords.get('n0').y - sulfurPosition.y, coords.get('n0').x - sulfurPosition.x) * 180) / Math.PI + 360) % 360;
    const firstOxoAngle = ((Math.atan2(coords.get('o0').y - sulfurPosition.y, coords.get('o0').x - sulfurPosition.x) * 180) / Math.PI + 360) % 360;
    const secondOxoAngle = ((Math.atan2(coords.get('o1').y - sulfurPosition.y, coords.get('o1').x - sulfurPosition.x) * 180) / Math.PI + 360) % 360;
    const oxoSeparation = Math.min(
      Math.abs(firstOxoAngle - secondOxoAngle),
      360 - Math.abs(firstOxoAngle - secondOxoAngle)
    );

    assert.ok(Math.abs(nitrogenAngle) < 1e-6 || Math.abs(nitrogenAngle - 360) < 1e-6);
    assert.equal(oxoSeparation, 180);
    assert.ok([90, 270].includes(firstOxoAngle));
    assert.ok([90, 270].includes(secondOxoAngle));
  });

  it('places sulfone oxygens perpendicular to opposing single-bond substituents', () => {
    const graph = createLayoutGraph(makeDimethylSulfone(), { suppressH: true });
    const adjacency = new Map([
      ['c0', ['s0']],
      ['s0', ['c0', 'o0', 'o1', 'c1']],
      ['o0', ['s0']],
      ['o1', ['s0']],
      ['c1', ['s0']]
    ]);
    const coords = new Map([
      ['c0', { x: 0, y: 0 }],
      ['s0', { x: 1.5, y: 0 }],
      ['c1', { x: 3, y: 0 }]
    ]);

    placeRemainingBranches(adjacency, graph.canonicalAtomRank, coords, new Set(['c0', 's0', 'o0', 'o1', 'c1']), ['c0', 's0', 'c1'], 1.5, graph);

    const sulfurPosition = coords.get('s0');
    const firstOxoAngle = ((Math.atan2(coords.get('o0').y - sulfurPosition.y, coords.get('o0').x - sulfurPosition.x) * 180) / Math.PI + 360) % 360;
    const secondOxoAngle = ((Math.atan2(coords.get('o1').y - sulfurPosition.y, coords.get('o1').x - sulfurPosition.x) * 180) / Math.PI + 360) % 360;
    const oxoSeparation = Math.min(
      Math.abs(firstOxoAngle - secondOxoAngle),
      360 - Math.abs(firstOxoAngle - secondOxoAngle)
    );

    assert.equal(oxoSeparation, 180);
    assert.ok([90, 270].includes(firstOxoAngle));
    assert.ok([90, 270].includes(secondOxoAngle));
  });
});
