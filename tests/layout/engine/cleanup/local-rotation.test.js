import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Molecule } from '../../../../src/core/index.js';
import { parseSMILES } from '../../../../src/io/smiles.js';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { computeRotatableSubtrees, runLocalCleanup } from '../../../../src/layout/engine/cleanup/local-rotation.js';
import { buildAtomGrid, measureLayoutCost } from '../../../../src/layout/engine/audit/invariants.js';
import { generateCoords, refineCoords } from '../../../../src/layout/engine/api.js';

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
});
