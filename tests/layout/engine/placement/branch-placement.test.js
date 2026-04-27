import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Molecule } from '../../../../src/core/index.js';
import { computeMacrocycleAngularBudgets, layoutMacrocycleFamily } from '../../../../src/layout/engine/families/macrocycle.js';
import { placeRemainingBranches } from '../../../../src/layout/engine/placement/branch-placement.js';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { computeCanonicalAtomRanks } from '../../../../src/layout/engine/topology/canonical-order.js';
import { angleOf, angularDifference } from '../../../../src/layout/engine/geometry/vec2.js';
import { makeChain, makeDimethylSulfone, makeMacrocycle, makeMacrocycleWithSubstituent } from '../support/molecules.js';

describe('layout/engine/placement/branch-placement', () => {
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

  it('keeps fluorinated chain centers on projected-tetrahedral quadrants', () => {
    const molecule = new Molecule();
    molecule.addAtom('a0', 'C');
    molecule.addAtom('a1', 'C');
    molecule.addAtom('a2', 'C');
    molecule.addAtom('a3', 'C');
    molecule.addAtom('f0', 'F');
    molecule.addAtom('f1', 'F');
    molecule.addBond('b0', 'a0', 'a1', {}, false);
    molecule.addBond('b1', 'a1', 'a2', {}, false);
    molecule.addBond('b2', 'a2', 'a3', {}, false);
    molecule.addBond('b3', 'a2', 'f0', {}, false);
    molecule.addBond('b4', 'a2', 'f1', {}, false);
    const graph = createLayoutGraph(molecule, { suppressH: true });
    const adjacency = new Map([
      ['a0', ['a1']],
      ['a1', ['a0', 'a2']],
      ['a2', ['a1', 'a3', 'f0', 'f1']],
      ['a3', ['a2']],
      ['f0', ['a2']],
      ['f1', ['a2']]
    ]);
    const coords = new Map([
      ['a0', { x: 0, y: 0 }],
      ['a1', { x: 1.5, y: 0 }],
      ['a2', { x: 2.25, y: 1.299038105676658 }]
    ]);

    placeRemainingBranches(adjacency, graph.canonicalAtomRank, coords, new Set(['a0', 'a1', 'a2', 'a3', 'f0', 'f1']), ['a0', 'a1', 'a2'], 1.5, graph);

    const anchorPosition = coords.get('a2');
    const neighborAngles = ['a1', 'a3', 'f0', 'f1']
      .map(neighborAtomId => Math.atan2(
        coords.get(neighborAtomId).y - anchorPosition.y,
        coords.get(neighborAtomId).x - anchorPosition.x
      ))
      .sort((firstAngle, secondAngle) => firstAngle - secondAngle);
    const separations = neighborAngles.map((currentAngle, index) => {
      const nextAngle = neighborAngles[(index + 1) % neighborAngles.length];
      const rawGap = nextAngle - currentAngle;
      return rawGap > 0 ? rawGap : rawGap + (2 * Math.PI);
    });
    const incomingAngle = Math.atan2(coords.get('a1').y - anchorPosition.y, coords.get('a1').x - anchorPosition.x);
    const continuationAngle = Math.atan2(coords.get('a3').y - anchorPosition.y, coords.get('a3').x - anchorPosition.x);

    assert.ok(
      separations.every(separation => Math.abs(separation - (Math.PI / 2)) < 1e-6),
      `expected projected-tetrahedral quadrants, got ${separations.map(separation => ((separation * 180) / Math.PI).toFixed(2)).join(', ')} degrees`
    );
    assert.ok(Math.abs(angularDifference(incomingAngle, continuationAngle) - (Math.PI / 2)) < 1e-6);
  });

  it('uses the seeded placement CoM to steer continuation away from fixed refinement anchors', () => {
    const molecule = makeChain(3);
    molecule.addAtom('x0', 'C');
    molecule.addAtom('x1', 'C');
    const graph = createLayoutGraph(molecule, {
      fixedCoords: new Map([['x0', { x: 1.5, y: 3 }]])
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

  it('snaps terminal alkene carbon leaves to the exact safe trigonal bisector even when it is off the 30-degree lattice', () => {
    const molecule = new Molecule();
    molecule.addAtom('a0', 'C');
    molecule.addAtom('a1', 'C');
    molecule.addAtom('a2', 'C');
    molecule.addAtom('a3', 'C');
    molecule.addBond('b0', 'a0', 'a1', {}, false);
    molecule.addBond('b1', 'a1', 'a2', {}, false);
    molecule.addBond('b2', 'a1', 'a3', { order: 2 }, false);
    const graph = createLayoutGraph(molecule, { suppressH: true });
    const adjacency = new Map([
      ['a0', ['a1']],
      ['a1', ['a0', 'a2', 'a3']],
      ['a2', ['a1']],
      ['a3', ['a1']]
    ]);
    const coords = new Map([
      ['a1', { x: 0, y: 0 }],
      ['a0', { x: 1.299038105676658, y: -0.75 }],
      ['a2', { x: -1.299038105676658, y: -0.75 }]
    ]);

    placeRemainingBranches(adjacency, graph.canonicalAtomRank, coords, new Set(['a0', 'a1', 'a2', 'a3']), ['a0', 'a1', 'a2'], 1.5, graph);

    assert.ok(Math.abs(coords.get('a3').x) < 1e-6);
    assert.ok(Math.abs(coords.get('a3').y - 1.5) < 1e-6);
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
    const oxoSeparation = Math.min(Math.abs(firstOxoAngle - secondOxoAngle), 360 - Math.abs(firstOxoAngle - secondOxoAngle));

    assert.ok(Math.abs(nitrogenAngle) < 1e-6 || Math.abs(nitrogenAngle - 360) < 1e-6);
    assert.equal(oxoSeparation, 180);
    assert.ok([90, 270].includes(firstOxoAngle));
    assert.ok([90, 270].includes(secondOxoAngle));
  });

  it('uses sulfur hydrogens as single-bond ligands for terminal sulfonyl crosses', () => {
    const molecule = new Molecule();
    molecule.addAtom('n0', 'N');
    molecule.addAtom('s0', 'S');
    molecule.addAtom('o0', 'O');
    molecule.addAtom('o1', 'O');
    molecule.addAtom('h0', 'H');
    molecule.addBond('b0', 'n0', 's0', {}, false);
    molecule.addBond('b1', 's0', 'o0', { order: 2 }, false);
    molecule.addBond('b2', 's0', 'o1', { order: 2 }, false);
    molecule.addBond('b3', 's0', 'h0', {}, false);
    const graph = createLayoutGraph(molecule, { suppressH: true });
    const adjacency = new Map([
      ['n0', ['s0']],
      ['s0', ['n0', 'o0', 'o1', 'h0']],
      ['o0', ['s0']],
      ['o1', ['s0']],
      ['h0', ['s0']]
    ]);
    const coords = new Map([
      ['n0', { x: 0, y: 0 }],
      ['s0', { x: 1.5, y: 0 }]
    ]);

    placeRemainingBranches(adjacency, graph.canonicalAtomRank, coords, new Set(['n0', 's0', 'o0', 'o1', 'h0']), ['n0', 's0'], 1.5, graph);

    const sulfurPosition = coords.get('s0');
    const nitrogenAngle = angleOf({ x: coords.get('n0').x - sulfurPosition.x, y: coords.get('n0').y - sulfurPosition.y });
    const hydrogenAngle = angleOf({ x: coords.get('h0').x - sulfurPosition.x, y: coords.get('h0').y - sulfurPosition.y });
    const firstOxoAngle = angleOf({ x: coords.get('o0').x - sulfurPosition.x, y: coords.get('o0').y - sulfurPosition.y });
    const secondOxoAngle = angleOf({ x: coords.get('o1').x - sulfurPosition.x, y: coords.get('o1').y - sulfurPosition.y });

    assert.ok(Math.abs(angularDifference(nitrogenAngle, hydrogenAngle) - Math.PI) < 1e-6);
    assert.ok(Math.abs(angularDifference(firstOxoAngle, secondOxoAngle) - Math.PI) < 1e-6);
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
    const oxoSeparation = Math.min(Math.abs(firstOxoAngle - secondOxoAngle), 360 - Math.abs(firstOxoAngle - secondOxoAngle));

    assert.equal(oxoSeparation, 180);
    assert.ok([90, 270].includes(firstOxoAngle));
    assert.ok([90, 270].includes(secondOxoAngle));
  });

  it('honors an anchor angular budget when placing a macrocycle substituent', () => {
    const graph = createLayoutGraph(makeMacrocycleWithSubstituent(), { suppressH: true });
    const ringLayout = layoutMacrocycleFamily(graph.rings, graph.options.bondLength);
    const adjacency = new Map(graph.components[0].atomIds.map(atomId => [atomId, []]));
    for (const bond of graph.bonds.values()) {
      if (!adjacency.has(bond.a) || !adjacency.has(bond.b)) {
        continue;
      }
      adjacency.get(bond.a).push(bond.b);
      adjacency.get(bond.b).push(bond.a);
    }
    const coords = new Map(ringLayout.coords);
    const branchConstraints = {
      angularBudgets: computeMacrocycleAngularBudgets(graph.rings, ringLayout.coords, graph, new Set(graph.components[0].atomIds))
    };

    placeRemainingBranches(
      adjacency,
      graph.canonicalAtomRank,
      coords,
      new Set(graph.components[0].atomIds),
      graph.rings[0].atomIds,
      graph.options.bondLength,
      graph,
      branchConstraints
    );
    const budget = branchConstraints.angularBudgets.get('a0');
    const placedAngle = angleOf({
      x: coords.get('a12').x - coords.get('a0').x,
      y: coords.get('a12').y - coords.get('a0').y
    });
    const offset = Math.atan2(Math.sin(placedAngle - budget.centerAngle), Math.cos(placedAngle - budget.centerAngle));

    assert.ok(budget, 'expected a computed macrocycle angular budget for a0');
    assert.ok(offset >= budget.minOffset - 1e-6, 'expected substituent angle to stay above the macrocycle budget floor');
    assert.ok(offset <= budget.maxOffset + 1e-6, 'expected substituent angle to stay below the macrocycle budget ceiling');
  });

  it('uses macrocycle preferred budget angles so adjacent dense substituents do not collapse onto one discrete ray', () => {
    const denseMolecule = makeMacrocycle();
    denseMolecule.addAtom('x0', 'C');
    denseMolecule.addAtom('x1', 'C');
    denseMolecule.addBond('x0b', 'a0', 'x0', {}, false);
    denseMolecule.addBond('x1b', 'a1', 'x1', {}, false);
    const graph = createLayoutGraph(denseMolecule, { suppressH: true });
    const ringLayout = layoutMacrocycleFamily(graph.rings, graph.options.bondLength);
    const adjacency = new Map(graph.components[0].atomIds.map(atomId => [atomId, []]));
    for (const bond of graph.bonds.values()) {
      if (!adjacency.has(bond.a) || !adjacency.has(bond.b)) {
        continue;
      }
      adjacency.get(bond.a).push(bond.b);
      adjacency.get(bond.b).push(bond.a);
    }
    const coords = new Map(ringLayout.coords);
    const branchConstraints = {
      angularBudgets: computeMacrocycleAngularBudgets(graph.rings, ringLayout.coords, graph, new Set(graph.components[0].atomIds))
    };

    placeRemainingBranches(
      adjacency,
      graph.canonicalAtomRank,
      coords,
      new Set(graph.components[0].atomIds),
      graph.rings[0].atomIds,
      graph.options.bondLength,
      graph,
      branchConstraints
    );

    const firstBudget = branchConstraints.angularBudgets.get('a0');
    const secondBudget = branchConstraints.angularBudgets.get('a1');
    const firstAngle = angleOf({
      x: coords.get('x0').x - coords.get('a0').x,
      y: coords.get('x0').y - coords.get('a0').y
    });
    const secondAngle = angleOf({
      x: coords.get('x1').x - coords.get('a1').x,
      y: coords.get('x1').y - coords.get('a1').y
    });

    assert.ok(angularDifference(firstAngle, firstBudget.preferredAngle) < 0.2, 'expected a0 substituent to follow its preferred dense-site macrocycle angle');
    assert.ok(angularDifference(secondAngle, secondBudget.preferredAngle) < 0.2, 'expected a1 substituent to follow its preferred dense-site macrocycle angle');
    assert.ok(angularDifference(firstAngle, secondAngle) > 0.3, 'expected adjacent dense macrocycle substituents to diverge instead of sharing one discrete ray');
  });

  it('keeps large budget-constrained macrocycle branch centers placeable without exhaustive sibling search', () => {
    const molecule = makeMacrocycle();
    molecule.addAtom('x0', 'C');
    molecule.addAtom('x1', 'C');
    molecule.addBond('x0b', 'a0', 'x0', {}, false);
    molecule.addBond('x1b', 'a0', 'x1', {}, false);
    for (let index = 0; index < 12; index++) {
      molecule.addAtom(`t${index}`, 'C');
      molecule.addBond(`tb${index}`, index === 0 ? 'a6' : `t${index - 1}`, `t${index}`, {}, false);
    }

    const graph = createLayoutGraph(molecule, { suppressH: true });
    const ringLayout = layoutMacrocycleFamily(graph.rings, graph.options.bondLength);
    const adjacency = new Map(graph.components[0].atomIds.map(atomId => [atomId, []]));
    for (const bond of graph.bonds.values()) {
      if (!adjacency.has(bond.a) || !adjacency.has(bond.b)) {
        continue;
      }
      adjacency.get(bond.a).push(bond.b);
      adjacency.get(bond.b).push(bond.a);
    }
    const coords = new Map(ringLayout.coords);
    const participantAtomIds = new Set(graph.components[0].atomIds);
    const branchConstraints = {
      angularBudgets: computeMacrocycleAngularBudgets(graph.rings, ringLayout.coords, graph, participantAtomIds)
    };

    placeRemainingBranches(adjacency, graph.canonicalAtomRank, coords, participantAtomIds, graph.rings[0].atomIds, graph.options.bondLength, graph, branchConstraints);

    assert.equal(coords.has('x0'), true);
    assert.equal(coords.has('x1'), true);
    assert.notDeepEqual(coords.get('x0'), coords.get('x1'));
  });
});
