import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../../src/io/smiles.js';
import { generateCoords, refineCoords } from '../../../../src/layout/engine/api.js';
import { inspectEZStereo } from '../../../../src/layout/engine/stereo/ez.js';

const FIXTURES = [
  { name: 'fused aryl phosphate', smiles: 'CN(C)CCC1=CNC2=C1C(=CC=C2)OP(=O)(O)O', anchors: ['C1', 'O19'], adjacent: ['C1', 'N2'] },
  { name: 'linked aromatic cyclohexene', smiles: 'Oc1c(c(O)cc(c1)CCCCC)C2C=C(/CCC2C(=C)C)C', anchors: ['O1', 'C23'], adjacent: ['O1', 'C2'] },
  {
    name: 'fused heterocyclic sulfonamide',
    smiles: 'CCCC1=NN(C)C2=C1NC(=NC2=O)C1=C(OCC)C=CC(=C1)S(=O)(=O)N1CCN(C)CC1',
    anchors: ['C1', 'C31'],
    adjacent: ['C1', 'C2']
  },
  {
    name: 'stereogenic prostaglandin-like chain',
    smiles: 'CC(C)OC(=O)CCC\\C=C/C[C@H]1[C@@H](O)C[C@@H](O)[C@@H]1\\C=C\\[C@@H](O)COC1=CC=CC(=C1)C(F)(F)F',
    anchors: ['C1', 'F38'],
    adjacent: ['C1', 'C2'],
    expectedStereo: { ez: 2, chiral: 5 }
  }
];

/**
 * Checks semantic geometry and explicit constraints after a two-anchor fit.
 * @param {object} result - Generated or refined result.
 * @param {Map<string, object>} fixedCoords - Requested anchor coordinates.
 * @param {{ez: number, chiral: number}|null} [expectedStereo] - Expected supported stereo counts.
 */
function assertClean(result, fixedCoords, expectedStereo = null) {
  const audit = result.metadata.audit;
  assert.equal(audit.ok, true);
  for (const key of [
    'bondLengthFailureCount',
    'severeOverlapCount',
    'visibleHeavyBondCrossingFailureCount',
    'labelOverlapCount',
    'ringSubstituentReadabilityFailureCount',
    'missingCoordinateCount',
    'nonfiniteCoordinateCount'
  ]) {
    assert.equal(audit[key], 0, key);
  }
  assert.equal(audit.stereoContradiction, false);
  const ez = inspectEZStereo(result.layoutGraph, result.coords);
  assert.equal(ez.violationCount, 0);
  if (expectedStereo) {
    assert.equal(ez.supportedCheckCount, expectedStereo.ez);
    assert.equal(result.metadata.stereo.chiralCenterCount, expectedStereo.chiral);
    assert.equal(result.metadata.stereo.assignedCenterCount, expectedStereo.chiral);
    assert.equal(result.metadata.stereo.unassignedCenterCount, 0);
  }
  for (const [id, atom] of result.layoutGraph.atoms) {
    if (atom.element === 'H') {
      continue;
    }
    const position = result.coords.get(id);
    assert.ok(position && Number.isFinite(position.x) && Number.isFinite(position.y), id);
  }
  for (const [id, target] of fixedCoords) {
    const position = result.coords.get(id);
    assert.ok(Math.hypot(position.x - target.x, position.y - target.y) < result.layoutGraph.options.bondLength * 1e-10, id);
  }
}

describe('two-anchor rigid branch fitting', () => {
  for (const fixture of FIXTURES) {
    for (const bondLength of [0.75, 1.5, 3]) {
      for (const mode of ['anchors', 'adjacent']) {
        it(`keeps ${fixture.name} clean with ${mode} at scale ${bondLength}`, () => {
          const generated = generateCoords(parseSMILES(fixture.smiles), { bondLength });
          assertClean(generated, new Map(), fixture.expectedStereo);
          const fixedCoords = new Map(fixture[mode].map(id => [id, { ...generated.coords.get(id) }]));
          const before = structuredClone(fixedCoords);
          const result = generateCoords(parseSMILES(fixture.smiles), { bondLength, fixedCoords, auditTelemetry: true });
          const refined = refineCoords(parseSMILES(fixture.smiles), { bondLength, fixedCoords, existingCoords: result.coords });
          assertClean(result, fixedCoords, fixture.expectedStereo);
          assertClean(refined, fixedCoords, fixture.expectedStereo);
          assert.deepEqual(fixedCoords, before);
          if (mode === 'anchors') {
            for (const [id, target] of fixedCoords) {
              assert.deepEqual(result.coords.get(id), target);
            }
          }
        });
      }
    }

    it(`is deterministic in a rotated and translated anchor frame for ${fixture.name}`, () => {
      const generated = generateCoords(parseSMILES(fixture.smiles));
      const fixedCoords = new Map(
        fixture.anchors.map(id => {
          const p = generated.coords.get(id);
          return [id, { x: 12 - p.y, y: p.x - 7 }];
        })
      );
      const first = generateCoords(parseSMILES(fixture.smiles), { fixedCoords });
      const second = generateCoords(parseSMILES(fixture.smiles), { fixedCoords });
      assertClean(first, fixedCoords, fixture.expectedStereo);
      assert.deepEqual(first.coords, second.coords);
    });

    it(`leaves infeasible anchors explicit for ${fixture.name}`, () => {
      const fixedCoords = new Map([
        [fixture.anchors[0], { x: 0, y: 0 }],
        [fixture.anchors[1], { x: 1000, y: 0 }]
      ]);
      const before = structuredClone(fixedCoords);
      const result = generateCoords(parseSMILES(fixture.smiles), { fixedCoords });
      assert.equal(result.metadata.audit.ok, false);
      assert.ok(result.metadata.audit.bondLengthFailureCount > 0);
      for (const [id, target] of fixedCoords) {
        const p = result.coords.get(id);
        assert.ok(Math.hypot(p.x - target.x, p.y - target.y) < 1e-8);
      }
      assert.deepEqual(fixedCoords, before);
      const disabled = generateCoords(parseSMILES(fixture.smiles), { fixedCoords, preserveFixed: false });
      assertClean(disabled, new Map());
    });
  }
});
