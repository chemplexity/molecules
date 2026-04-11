import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../src/io/smiles.js';
import { classifyFamily, runPipeline } from '../../src/layoutv2/pipeline.js';
import {
  makeDisconnectedEthanes,
  makeLargePolyaryl,
  makeMacrocycle,
  makeMacrocycleWithSubstituent,
  makeMethylbenzene,
  makeNorbornane,
  makeOrganometallic,
  makeUnmatchedBridgedCage
} from './support/molecules.js';

/**
 * Returns the interior angles for an ordered ring path.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string[]} atomIds - Ordered ring atom IDs.
 * @returns {number[]} Interior angles in degrees.
 */
function ringAngles(coords, atomIds) {
  return atomIds.map((atomId, index) => {
    const previous = coords.get(atomIds[(index - 1 + atomIds.length) % atomIds.length]);
    const current = coords.get(atomId);
    const next = coords.get(atomIds[(index + 1) % atomIds.length]);
    const firstVector = {
      x: previous.x - current.x,
      y: previous.y - current.y
    };
    const secondVector = {
      x: next.x - current.x,
      y: next.y - current.y
    };
    const dot = (firstVector.x * secondVector.x) + (firstVector.y * secondVector.y);
    const firstMagnitude = Math.hypot(firstVector.x, firstVector.y);
    const secondMagnitude = Math.hypot(secondVector.x, secondVector.y);
    return Math.acos(Math.max(-1, Math.min(1, dot / (firstMagnitude * secondMagnitude)))) * (180 / Math.PI);
  });
}

describe('layoutv2/pipeline', () => {
  it('classifies primary families across the milestone-1 family boundary', () => {
    assert.deepEqual(classifyFamily({
      options: { largeMoleculeThreshold: { heavyAtomCount: 100, ringSystemCount: 10, blockCount: 16 } },
      traits: { heavyAtomCount: 2, containsMetal: false, ringSystemCount: 0 },
      components: [{}],
      rings: [],
      ringSystems: [],
      ringConnections: [],
      atoms: new Map([
        ['a0', { id: 'a0', element: 'C' }],
        ['a1', { id: 'a1', element: 'C' }]
      ])
    }), { primaryFamily: 'acyclic', mixedMode: false });

    assert.equal(classifyFamily({
      options: { largeMoleculeThreshold: { heavyAtomCount: 100, ringSystemCount: 10, blockCount: 16 } },
      traits: { heavyAtomCount: 2, containsMetal: true, ringSystemCount: 0 },
      components: [{}],
      rings: [],
      ringSystems: [],
      ringConnections: [],
      atoms: new Map()
    }).primaryFamily, 'organometallic');

    assert.equal(classifyFamily({
      options: { largeMoleculeThreshold: { heavyAtomCount: 100, ringSystemCount: 10, blockCount: 16 } },
      traits: { heavyAtomCount: 12, containsMetal: false, ringSystemCount: 1 },
      components: [{}],
      rings: [{ atomIds: ['a0'], size: 12 }],
      ringSystems: [{ ringIds: [0] }],
      ringConnections: [],
      atoms: new Map([['a0', { id: 'a0', element: 'C' }]])
    }).primaryFamily, 'macrocycle');

    assert.equal(classifyFamily({
      options: { largeMoleculeThreshold: { heavyAtomCount: 5, ringSystemCount: 10, blockCount: 16 } },
      traits: { heavyAtomCount: 6, containsMetal: false, ringSystemCount: 0 },
      components: [{}],
      rings: [],
      ringSystems: [],
      ringConnections: [],
      atoms: new Map()
    }).primaryFamily, 'large-molecule');
  });

  it('marks mixed mode when a ring scaffold carries non-ring heavy atoms', () => {
    const result = runPipeline(makeMethylbenzene());
    assert.equal(result.metadata.primaryFamily, 'isolated-ring');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.coords.has('a6'), true);
  });

  it('runs the milestone-1 pipeline shell and seeds incoming coordinates', () => {
    const molecule = makeOrganometallic();
    const result = runPipeline(molecule, {
      existingCoords: new Map([['n1', { x: 1, y: 2 }]]),
      fixedCoords: new Map([['ru', { x: 0, y: 0 }]])
    });
    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.primaryFamily, 'organometallic');
    assert.equal(result.metadata.fixedAtomCount, 1);
    assert.equal(result.metadata.existingCoordCount, 1);
    assert.equal(result.metadata.placedComponentCount, 1);
    assert.equal(result.metadata.unplacedComponentCount, 0);
    assert.ok(result.coords.has('ru'));
    assert.ok(result.coords.has('n1'));
    assert.equal(result.metadata.policy.organometallicMode, 'ligand-first');
    assert.equal(result.metadata.ringDependency.ok, true);
    assert.equal(typeof result.metadata.stereo.ezViolationCount, 'number');
    assert.equal(Array.isArray(result.metadata.stereo.assignments), true);
    assert.equal(typeof result.metadata.cleanupPasses, 'number');
    assert.equal(typeof result.metadata.cleanupImprovement, 'number');
    assert.equal(typeof result.metadata.audit.ok, 'boolean');
  });

  it('advances bridged molecules to coordinates-ready when a template exists', () => {
    const result = runPipeline(makeNorbornane());
    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.placedComponentCount, 1);
    assert.equal(result.coords.size, 7);
  });

  it('also advances unmatched bridged cages through the KK fallback path', () => {
    const result = runPipeline(makeUnmatchedBridgedCage());
    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.placedComponentCount, 1);
    assert.equal(result.coords.size, 6);
  });

  it('routes exact cubane cage matches through the bridged template path', () => {
    const result = runPipeline(parseSMILES('C12C3C4C1C5C4C3C25'));
    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, false);
    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.deepEqual(result.metadata.placedFamilies, ['bridged']);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
  });

  it('snaps constructed fused junction bonds onto an axis for anthracene-like systems', () => {
    const result = runPipeline(parseSMILES('c1ccc2cc3ccccc3cc2c1'));
    const fusedConnections = result.layoutGraph.ringConnections.filter(connection => connection.kind === 'fused');

    assert.equal(result.metadata.primaryFamily, 'fused');
    assert.equal(typeof result.metadata.cleanupJunctionSnaps, 'number');
    for (const connection of fusedConnections) {
      const [firstAtomId, secondAtomId] = connection.sharedAtomIds;
      const firstPosition = result.coords.get(firstAtomId);
      const secondPosition = result.coords.get(secondAtomId);
      assert.ok(
        Math.abs(firstPosition.x - secondPosition.x) < 1e-6
        || Math.abs(firstPosition.y - secondPosition.y) < 1e-6
      );
    }
  });

  it('advances macrocycles to coordinates-ready through the ellipse placer', () => {
    const result = runPipeline(makeMacrocycle());
    assert.equal(result.metadata.primaryFamily, 'macrocycle');
    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.placedComponentCount, 1);
    assert.equal(result.coords.size, 12);
  });

  it('keeps suppressed-h simple rings audit-clean when explicit hydrogens overlap only off-screen', () => {
    const result = runPipeline(parseSMILES('C1CCCCC1'), {
      suppressH: true
    });

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('treats macrocycles with substituents as mixed but still places them completely', () => {
    const result = runPipeline(makeMacrocycleWithSubstituent());
    assert.equal(result.metadata.primaryFamily, 'macrocycle');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.placedComponentCount, 1);
    assert.equal(result.coords.size, 13);
  });

  it('uses the porphine macrocycle template to avoid collapsed porphyrin-core layouts', () => {
    const result = runPipeline(parseSMILES('C1=CC2=CC3=CC=C(N3)C=C4C=CC(=N4)C=C5C=CC(=N5)C=C1N2'));
    assert.equal(result.metadata.primaryFamily, 'macrocycle');
    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.deepEqual(result.metadata.placedFamilies, ['macrocycle']);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.collapsedMacrocycleCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
  });

  it('keeps medium and large simple macrocycles within bond-length audit tolerance', () => {
    const mediumResult = runPipeline(parseSMILES('C1CCCCCCCCCCCCCCO1'), {
      suppressH: true
    });
    const largeResult = runPipeline(parseSMILES('C1CCCCCCCCCCCCCCCCCCCCCCC1'), {
      suppressH: true
    });

    assert.equal(mediumResult.metadata.primaryFamily, 'macrocycle');
    assert.equal(mediumResult.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(mediumResult.metadata.audit.ok, true);
    assert.equal(largeResult.metadata.primaryFamily, 'macrocycle');
    assert.equal(largeResult.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(largeResult.metadata.audit.ok, true);
  });

  it('routes large components through block partitioning and stitching', () => {
    const result = runPipeline(makeLargePolyaryl(), {
      largeMoleculeThreshold: {
        heavyAtomCount: 12,
        ringSystemCount: 2,
        blockCount: 16
      }
    });
    assert.equal(result.metadata.primaryFamily, 'large-molecule');
    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.placedComponentCount, 1);
    assert.equal(result.coords.size, 34);
    assert.deepEqual(result.metadata.placedFamilies, ['large-molecule']);
  });

  it('reports preserved disconnected components during refinement-aware pipeline runs', () => {
    const result = runPipeline(makeDisconnectedEthanes(), {
      existingCoords: new Map([
        ['a0', { x: 0, y: 0 }],
        ['a1', { x: 1.5, y: 0 }],
        ['c0', { x: 10, y: 3 }],
        ['c1', { x: 11.5, y: 3 }]
      ]),
      touchedAtoms: new Set(['a0'])
    });

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.preservedComponentCount, 1);
    assert.deepEqual(result.coords.get('c0'), { x: 10, y: 3 });
    assert.deepEqual(result.coords.get('c1'), { x: 11.5, y: 3 });
  });

  it('avoids severe overlaps for phosphono amino-acid mixed layouts', () => {
    const result = runPipeline(parseSMILES('C1=CC=C(C=C1)C(C(=O)O)(N)P(=O)(O)O'), {
      suppressH: true
    });

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('keeps steroid mixed layouts audit-clean without stretching the fused scaffold during overlap cleanup', () => {
    const result = runPipeline(parseSMILES('CC(C)CCCC(C)C1CCC2C3C(CC=C4C3(CCC5C4CCC(C5)O)C)CC2C1C(=O)OC'), {
      suppressH: true
    });

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('relaxes cyclic fused mixed scaffolds so re-entrant fused edges do not overstretch aromatic bonds', () => {
    const result = runPipeline(parseSMILES('CCN(CC)C(=O)C1CN(C2CC3=CNC4=CC=CC(=C34)C2=C1)C'), {
      suppressH: true
    });
    const aromaticSixRing = ['C17', 'C18', 'C19', 'C20', 'C21', 'C16'];
    const aromaticAngles = ringAngles(result.coords, aromaticSixRing);

    assert.equal(result.metadata.primaryFamily, 'fused');
    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.ok, true);
    assert.ok(Math.max(...aromaticAngles) - Math.min(...aromaticAngles) < 12);
  });

});
