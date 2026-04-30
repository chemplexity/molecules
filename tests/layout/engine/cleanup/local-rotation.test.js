import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Molecule } from '../../../../src/core/index.js';
import { parseSMILES } from '../../../../src/io/smiles.js';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { computeRotatableSubtrees, runLocalCleanup } from '../../../../src/layout/engine/cleanup/local-rotation.js';
import { buildAtomGrid, findSevereOverlaps, measureLayoutCost } from '../../../../src/layout/engine/audit/invariants.js';
import { angleOf, angularDifference, centroid, sub } from '../../../../src/layout/engine/geometry/vec2.js';
import { generateCoords, refineCoords } from '../../../../src/layout/engine/api.js';
import { layoutSupportedComponents } from '../../../../src/layout/engine/placement/component-layout.js';

function makeBranchedFixture() {
  const molecule = new Molecule();
  molecule.addAtom('a0', 'C');
  molecule.addAtom('a1', 'C');
  molecule.addAtom('a2', 'C');
  molecule.addBond('b0', 'a0', 'a1', {}, false);
  molecule.addBond('b1', 'a1', 'a2', {}, false);
  return molecule;
}

/**
 * Computes the dot product between a ring anchor's inward centroid vector and
 * its substituent vector.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} anchorAtomId - Ring-anchor atom id.
 * @param {string} substituentAtomId - Substituent atom id.
 * @returns {number} Signed inwardness score; positive means toward the ring interior.
 */
function ringInteriorDot(layoutGraph, coords, anchorAtomId, substituentAtomId) {
  const anchorPosition = coords.get(anchorAtomId);
  const substituentPosition = coords.get(substituentAtomId);
  const anchorRings = layoutGraph.atomToRings.get(anchorAtomId) ?? [];
  if (!anchorPosition || !substituentPosition || anchorRings.length === 0) {
    return 0;
  }

  let inwardX = 0;
  let inwardY = 0;
  for (const ring of anchorRings) {
    let centroidX = 0;
    let centroidY = 0;
    let countedAtoms = 0;
    for (const ringAtomId of ring.atomIds) {
      const ringPosition = coords.get(ringAtomId);
      if (!ringPosition) {
        continue;
      }
      centroidX += ringPosition.x;
      centroidY += ringPosition.y;
      countedAtoms++;
    }
    if (countedAtoms === 0) {
      continue;
    }
    inwardX += centroidX / countedAtoms - anchorPosition.x;
    inwardY += centroidY / countedAtoms - anchorPosition.y;
  }

  const rootX = substituentPosition.x - anchorPosition.x;
  const rootY = substituentPosition.y - anchorPosition.y;
  return inwardX * rootX + inwardY * rootY;
}

/**
 * Returns the smaller bond angle at a center atom in degrees.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} centerAtomId - Center atom ID.
 * @param {string} firstNeighborAtomId - First neighbor atom ID.
 * @param {string} secondNeighborAtomId - Second neighbor atom ID.
 * @returns {number} Bond angle in degrees.
 */
function bondAngleDegrees(coords, centerAtomId, firstNeighborAtomId, secondNeighborAtomId) {
  const centerPosition = coords.get(centerAtomId);
  const firstAngle = angleOf(sub(coords.get(firstNeighborAtomId), centerPosition));
  const secondAngle = angleOf(sub(coords.get(secondNeighborAtomId), centerPosition));
  return angularDifference(firstAngle, secondAngle) * (180 / Math.PI);
}

describe('layout/engine/cleanup/local-rotation', () => {
  it('rotates a leaf atom when doing so lowers overlap cost', () => {
    const graph = createLayoutGraph(makeBranchedFixture());
    const coords = new Map([
      ['a0', { x: 0, y: 0 }],
      ['a1', { x: 1.5, y: 0 }],
      ['a2', { x: 0.2, y: 0 }]
    ]);
    const before = measureLayoutCost(graph, coords, 1.5);
    const result = runLocalCleanup(graph, coords, { maxPasses: 2, bondLength: 1.5 });
    const after = measureLayoutCost(graph, result.coords, 1.5);
    assert.ok(after < before);
    assert.ok(result.improvement > 0);
    assert.ok(result.passes > 0);
  });

  it('rotates a terminal heavy-atom subtree instead of only lone leaf atoms', () => {
    const molecule = parseSMILES('OP(O)O');
    const graph = createLayoutGraph(molecule, { suppressH: true });
    const coords = new Map([
      ['O1', { x: 0, y: 0 }],
      ['P2', { x: 1.5, y: 0 }],
      ['O3', { x: 2.1, y: 0.1 }],
      ['O4', { x: 2.15, y: -0.1 }],
      ['H5', { x: 2.7, y: 0.1 }],
      ['H6', { x: 2.75, y: -0.1 }]
    ]);
    const before = measureLayoutCost(graph, coords, 1.5);
    const result = runLocalCleanup(graph, coords, { maxPasses: 6, bondLength: 1.5 });
    const after = measureLayoutCost(graph, result.coords, 1.5);

    assert.ok(after < before);
    assert.ok(result.passes > 0);
  });

  it('detects and rotates short saturated terminal subtrees as one cleanup unit', () => {
    const graph = createLayoutGraph(parseSMILES('CCC(C)(C)C'), { suppressH: true });
    const coords = new Map([
      ['C3', { x: 0, y: 0 }],
      ['C2', { x: 1.2, y: 0 }],
      ['C1', { x: 2.7, y: 0 }],
      ['C4', { x: 1.2, y: 0.2 }],
      ['C5', { x: 1.2, y: -0.2 }],
      ['C6', { x: -1.5, y: 0 }]
    ]);
    const rotatableSubtrees = computeRotatableSubtrees(graph, coords);
    const before = measureLayoutCost(graph, coords, 1.5);
    const result = runLocalCleanup(graph, coords, { maxPasses: 6, bondLength: 1.5 });
    const after = measureLayoutCost(graph, result.coords, 1.5);

    assert.ok(rotatableSubtrees.terminalSubtrees.some(
      descriptor => descriptor.atomId === 'C2'
        && descriptor.anchorAtomId === 'C3'
        && descriptor.subtreeAtomIds.includes('C1')
    ));
    assert.ok(after < before);
    assert.ok(result.passes > 0);
    assert.notDeepEqual(result.coords.get('C2'), coords.get('C2'));
    assert.notDeepEqual(result.coords.get('C1'), coords.get('C1'));
  });

  it('rotates terminal ketone groups as rigid subtrees without bending carbonyl leaves', () => {
    const graph = createLayoutGraph(parseSMILES('CC(C=O)C(O)C(C)(C(O)CO)C(C)C(C)=O'), { suppressH: true });
    const placement = layoutSupportedComponents(graph);
    const rotatableSubtrees = computeRotatableSubtrees(graph, placement.coords);
    const result = runLocalCleanup(graph, placement.coords, {
      maxPasses: 3,
      bondLength: graph.options.bondLength,
      overlapPairs: findSevereOverlaps(graph, placement.coords, graph.options.bondLength)
    });

    assert.ok(rotatableSubtrees.terminalSubtrees.some(
      descriptor => descriptor.atomId === 'C15'
        && descriptor.anchorAtomId === 'C13'
        && descriptor.subtreeAtomIds.includes('C16')
        && descriptor.subtreeAtomIds.includes('O17')
    ));
    assert.ok(rotatableSubtrees.terminalSubtrees.some(
      descriptor => descriptor.atomId === 'C13'
        && descriptor.anchorAtomId === 'C7'
        && descriptor.subtreeAtomIds.includes('C14')
        && descriptor.subtreeAtomIds.includes('C15')
        && descriptor.subtreeAtomIds.includes('O17')
    ));
    assert.equal(findSevereOverlaps(graph, result.coords, graph.options.bondLength).length, 0);
    assert.ok(Math.abs(bondAngleDegrees(result.coords, 'C13', 'C7', 'C14') - 120) < 1e-6);
    assert.ok(Math.abs(bondAngleDegrees(result.coords, 'C13', 'C7', 'C15') - 120) < 1e-6);
    assert.ok(Math.abs(bondAngleDegrees(result.coords, 'C13', 'C14', 'C15') - 120) < 1e-6);
    assert.ok(Math.abs(bondAngleDegrees(result.coords, 'C15', 'C13', 'C16') - 120) < 1e-6);
    assert.ok(Math.abs(bondAngleDegrees(result.coords, 'C15', 'C13', 'O17') - 120) < 1e-6);
    assert.ok(Math.abs(bondAngleDegrees(result.coords, 'C15', 'C16', 'O17') - 120) < 1e-6);
  });

  it('rotates a linear terminal subgroup around a single bond when that improves trigonal readability', () => {
    const molecule = parseSMILES('N#CC(C#N)=C(C#N)C#N');
    const graph = createLayoutGraph(molecule, { suppressH: true });
    const coords = new Map([
      ['C2', { x: 5.196152422706632, y: -1.1250000000000002 }],
      ['C4', { x: 3.897114317029974, y: 1.125 }],
      ['C7', { x: 1.299038105676658, y: -1.875 }],
      ['C9', { x: 1.8480762113533165, y: 0.174038105676658 }],
      ['C3', { x: 3.897114317029974, y: -0.3750000000000002 }],
      ['C6', { x: 2.598076211353316, y: -1.125 }],
      ['N1', { x: 6.49519052838329, y: -1.875 }],
      ['N5', { x: 3.897114317029974, y: 2.625 }],
      ['N8', { x: 0, y: -2.625 }],
      ['N10', { x: 1.098076211353317, y: 1.473076211353316 }]
    ]);
    const before = measureLayoutCost(graph, coords, 1.5);
    const result = runLocalCleanup(graph, coords, { maxPasses: 8, bondLength: 1.5 });
    const after = measureLayoutCost(graph, result.coords, 1.5);

    assert.ok(after < before);
    assert.ok(result.passes > 0);
    assert.notDeepEqual(result.coords.get('C7'), coords.get('C7'));
  });

  it('tries the exact ideal angle first for terminal multiple-bond leaves even when it is off the cleanup lattice', () => {
    const graph = createLayoutGraph(parseSMILES('NC(=O)C'), { suppressH: true });
    const coords = new Map([
      ['N1', { x: -1.35, y: 0.2 }],
      ['C2', { x: 0, y: 0 }],
      ['O3', { x: 0.2, y: -1.35 }],
      ['C4', { x: 0.9, y: 1.1 }]
    ]);
    const idealAngle = angleOf(sub(
      coords.get('C2'),
      centroid([coords.get('N1'), coords.get('C4')])
    ));
    const beforeAngle = angleOf(sub(coords.get('O3'), coords.get('C2')));
    const result = runLocalCleanup(graph, coords, { maxPasses: 4, bondLength: 1.5 });
    const afterAngle = angleOf(sub(result.coords.get('O3'), result.coords.get('C2')));

    assert.ok(angularDifference(beforeAngle, idealAngle) > 0.1);
    assert.ok(angularDifference(afterAngle, idealAngle) < 1e-6);
    assert.ok(result.passes > 0);
  });

  it('tries the exact ideal angle first for terminal single-bond trigonal substituents when the carbonyl center is constrained', () => {
    const graph = createLayoutGraph(parseSMILES('NC(=O)C'), { suppressH: true });
    const coords = new Map([
      ['N1', { x: -0.2, y: 1.35 }],
      ['C2', { x: 0, y: 0 }],
      ['O3', { x: 0.2, y: -1.35 }],
      ['C4', { x: 0.9, y: 1.1 }]
    ]);
    const idealAngle = angleOf(sub(
      coords.get('C2'),
      centroid([coords.get('O3'), coords.get('C4')])
    ));
    const beforeAngle = angleOf(sub(coords.get('N1'), coords.get('C2')));
    const result = runLocalCleanup(graph, coords, {
      maxPasses: 2,
      bondLength: 1.5,
      frozenAtomIds: new Set(['O3', 'C4'])
    });
    const afterAngle = angleOf(sub(result.coords.get('N1'), result.coords.get('C2')));

    assert.ok(angularDifference(beforeAngle, idealAngle) > 0.1);
    assert.ok(angularDifference(afterAngle, idealAngle) < 1e-6);
    assert.ok(result.passes > 0);
  });

  it('can jointly fan apart geminal neopentane methyl groups from a symmetric clump', () => {
    const graph = createLayoutGraph(parseSMILES('CC(C)(C)C'), { suppressH: true });
    const coords = new Map([
      ['C2', { x: 0, y: 0 }],
      ['C1', { x: -1.5, y: 0 }],
      ['C3', { x: 1.2, y: 0.2 }],
      ['C4', { x: 1.2, y: -0.2 }],
      ['C5', { x: 1.5, y: 0 }]
    ]);
    const before = measureLayoutCost(graph, coords, 1.5);
    const result = runLocalCleanup(graph, coords, { maxPasses: 8, bondLength: 1.5 });
    const after = measureLayoutCost(graph, result.coords, 1.5);

    assert.ok(after < before);
    assert.ok(result.passes > 0);
    assert.notDeepEqual(result.coords.get('C3'), coords.get('C3'));
    assert.notDeepEqual(result.coords.get('C4'), coords.get('C4'));
  });

  it('keeps crowded tetra-substituted cleanup local without collapsing a downstream tertiary amine', () => {
    const graph = createLayoutGraph(parseSMILES('CCC1(C)OC2=C3C(NCC13N(C)C)=C(O)N2'), { suppressH: true });
    const coords = new Map([
      ['C1', { x: 9.58546311899896, y: -0.7137933725524175 }],
      ['C2', { x: 8.625698119051489, y: 0.40840886152091305 }],
      ['C3', { x: 7.44737796884149, y: 1.3438884206473585 }],
      ['C4', { x: 8.5076145164303, y: 2.4092324455942435 }],
      ['O5', { x: 6.505670171976132, y: 2.506479032840155 }],
      ['C6', { x: 5.270357137186049, y: 1.657666186557635 }],
      ['C7', { x: 3.928023184388554, y: 2.324967501571681 }],
      ['C8', { x: 4.374290724432267, y: 3.756677887733303 }],
      ['C9', { x: 6.153859916328592, y: 4.490822159305653 }],
      ['C10', { x: 7.486573680739315, y: 3.812968026703332 }],
      ['C11', { x: 6.615197041532712, y: 0.022919867403651928 }],
      ['N12', { x: 8.016226434343773, y: -0.5129127934891562 }],
      ['C13', { x: 8.252696434238718, y: -1.9941561695586274 }],
      ['C14', { x: 9.18078582725989, y: 0.4324979216875058 }],
      ['O15', { x: 3.062491247178739, y: 1.2196421109696807 }]
    ]);
    const result = runLocalCleanup(graph, coords, { maxPasses: 1, bondLength: 1.5 });

    const movedAtomIds = [...result.coords.entries()]
      .filter(([atomId, position]) => Math.hypot(position.x - coords.get(atomId).x, position.y - coords.get(atomId).y) > 1e-6)
      .map(([atomId]) => atomId);
    const amineAngles = ['C11', 'C13', 'C14']
      .map(atomId => angleOf(sub(result.coords.get(atomId), result.coords.get('N12'))))
      .sort((firstAngle, secondAngle) => firstAngle - secondAngle);
    const amineSeparations = amineAngles.map((angle, index) => {
      const nextAngle = amineAngles[(index + 1) % amineAngles.length];
      const rawGap = nextAngle - angle;
      return (rawGap > 0 ? rawGap : rawGap + Math.PI * 2) * (180 / Math.PI);
    });

    assert.ok(movedAtomIds.length > 0);
    assert.ok(movedAtomIds.every(atomId => ['C1', 'C2', 'C4'].includes(atomId)));
    assert.ok(!movedAtomIds.includes('N12'));
    assert.ok(!movedAtomIds.includes('C13'));
    assert.ok(!movedAtomIds.includes('C14'));
    assert.ok(amineSeparations.every(separation => separation >= 100 && separation <= 150));
  });

  it('clears nearby branch overlap without collapsing a ring-bound tertiary amine fan', () => {
    const graph = createLayoutGraph(parseSMILES('CN1CC=C2CCC3OCC1(C(O)C=O)C23'), { suppressH: true });
    const placement = layoutSupportedComponents(graph);
    const initialOverlaps = findSevereOverlaps(graph, placement.coords, graph.options.bondLength);
    const result = runLocalCleanup(graph, placement.coords, {
      maxPasses: 1,
      bondLength: graph.options.bondLength,
      overlapPairs: initialOverlaps
    });
    const n2Angles = [
      bondAngleDegrees(result.coords, 'N2', 'C11', 'C1'),
      bondAngleDegrees(result.coords, 'N2', 'C11', 'C3'),
      bondAngleDegrees(result.coords, 'N2', 'C1', 'C3')
    ];

    assert.ok(initialOverlaps.some(overlap => (
      (overlap.firstAtomId === 'C1' && overlap.secondAtomId === 'C14')
      || (overlap.firstAtomId === 'C14' && overlap.secondAtomId === 'C1')
    )));
    assert.equal(findSevereOverlaps(graph, result.coords, graph.options.bondLength).length, 0);
    for (const angle of n2Angles) {
      assert.ok(Math.abs(angle - 120) < 3, `expected N2 fan near 120 degrees, got ${angle.toFixed(2)}`);
    }
  });

  it('can jointly rotate geminal cyclohexane methyls outward from the ring interior', () => {
    const graph = createLayoutGraph(parseSMILES('CC1(C)CCCCC1'), { suppressH: true });
    const coords = new Map([
      ['C2', { x: 0, y: 0 }],
      ['C4', { x: 1.5, y: 0 }],
      ['C5', { x: 2.25, y: -1.299038105676658 }],
      ['C6', { x: 3.75, y: -1.299038105676658 }],
      ['C7', { x: 4.5, y: 0 }],
      ['C8', { x: 3.75, y: 1.299038105676658 }],
      ['C1', { x: 1.3, y: 0.25 }],
      ['C3', { x: 1.3, y: -0.25 }]
    ]);
    const before = measureLayoutCost(graph, coords, 1.5);
    const result = runLocalCleanup(graph, coords, { maxPasses: 8, bondLength: 1.5 });
    const after = measureLayoutCost(graph, result.coords, 1.5);

    assert.ok(after < before);
    assert.ok(result.passes > 0);
    assert.ok(ringInteriorDot(graph, result.coords, 'C2', 'C1') <= 0);
    assert.ok(ringInteriorDot(graph, result.coords, 'C2', 'C3') <= 0);
  });

  it('does not flip fused-ring bridgehead substituents inward during cleanup-only refinement', () => {
    const smiles = 'CC(C)CCCC(C)C1CCC2C3C(CC=C4C3(CCC5C4CCC(C5)O)C)CC2C1';
    const initial = generateCoords(parseSMILES(smiles), { suppressH: true });
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const result = runLocalCleanup(graph, new Map(initial.coords), { maxPasses: 6, bondLength: 1.5 });

    assert.ok(ringInteriorDot(graph, initial.coords, 'C18', 'C28') <= 0);
    assert.ok(ringInteriorDot(graph, result.coords, 'C18', 'C28') <= 0);
  });

  it('keeps the steroid bridgehead substituent outside the fused ring after refineCoords', () => {
    const smiles = 'CC(C)CCCC(C)C1CCC2C3C(CC=C4C3(CCC5C4CCC(C5)O)C)CC2C1';
    const initial = generateCoords(parseSMILES(smiles), { suppressH: true });
    const refined = refineCoords(parseSMILES(smiles), {
      suppressH: true,
      existingCoords: new Map(initial.coords)
    });
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });

    assert.ok(ringInteriorDot(graph, refined.coords, 'C18', 'C28') <= 0);
  });

  it('accepts a reusable base atom grid without changing the chosen cleanup result', () => {
    const graph = createLayoutGraph(parseSMILES('CC(C)(C)C'), { suppressH: true });
    const coords = new Map([
      ['C2', { x: 0, y: 0 }],
      ['C1', { x: -1.5, y: 0 }],
      ['C3', { x: 1.2, y: 0.2 }],
      ['C4', { x: 1.2, y: -0.2 }],
      ['C5', { x: 1.5, y: 0 }]
    ]);
    const bondLength = 1.5;
    const rebuiltResult = runLocalCleanup(graph, coords, { maxPasses: 2, bondLength });
    const reusedGridResult = runLocalCleanup(graph, coords, {
      maxPasses: 2,
      bondLength,
      baseAtomGrid: buildAtomGrid(graph, coords, bondLength)
    });

    assert.deepEqual([...reusedGridResult.coords.entries()], [...rebuiltResult.coords.entries()]);
    assert.equal(reusedGridResult.passes, rebuiltResult.passes);
    assert.equal(reusedGridResult.improvement, rebuiltResult.improvement);
  });

  it('accepts reusable rotatable subtree descriptors without changing the chosen cleanup result', () => {
    const graph = createLayoutGraph(parseSMILES('CC(C)(C)C'), { suppressH: true });
    const coords = new Map([
      ['C2', { x: 0, y: 0 }],
      ['C1', { x: -1.5, y: 0 }],
      ['C3', { x: 1.2, y: 0.2 }],
      ['C4', { x: 1.2, y: -0.2 }],
      ['C5', { x: 1.5, y: 0 }]
    ]);
    const rebuiltResult = runLocalCleanup(graph, coords, { maxPasses: 2, bondLength: 1.5 });
    const reusable = computeRotatableSubtrees(graph, coords);
    const reusedResult = runLocalCleanup(graph, coords, {
      maxPasses: 2,
      bondLength: 1.5,
      baseTerminalSubtrees: reusable.terminalSubtrees,
      baseGeminalPairs: reusable.geminalPairs
    });

    assert.deepEqual([...reusedResult.coords.entries()], [...rebuiltResult.coords.entries()]);
    assert.equal(reusedResult.passes, rebuiltResult.passes);
    assert.equal(reusedResult.improvement, rebuiltResult.improvement);
  });

  it('accepts overlap-aware descriptor filtering without changing the chosen one-step cleanup move', () => {
    const graph = createLayoutGraph(parseSMILES('CC(C)(C)C'), { suppressH: true });
    const coords = new Map([
      ['C2', { x: 0, y: 0 }],
      ['C1', { x: -1.5, y: 0 }],
      ['C3', { x: 1.2, y: 0.2 }],
      ['C4', { x: 1.2, y: -0.2 }],
      ['C5', { x: 1.5, y: 0 }]
    ]);
    const overlaps = findSevereOverlaps(graph, coords, 1.5);
    const directResult = runLocalCleanup(graph, coords, { maxPasses: 1, bondLength: 1.5 });
    const overlapAwareResult = runLocalCleanup(graph, coords, {
      maxPasses: 1,
      bondLength: 1.5,
      overlapPairs: overlaps
    });

    assert.deepEqual([...overlapAwareResult.coords.entries()], [...directResult.coords.entries()]);
    assert.equal(overlapAwareResult.passes, directResult.passes);
    assert.equal(overlapAwareResult.improvement, directResult.improvement);
  });
});
