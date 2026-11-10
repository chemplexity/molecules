import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bugMolecules } from '../../../../examples/bug-molecules.js';
import { parseSMILES } from '../../../../src/io/smiles.js';
import { generateCoords, refineCoords } from '../../../../src/layout/engine/api.js';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { layoutKamadaKawai } from '../../../../src/layout/engine/geometry/kk-layout.js';
import { enumerateBridgePaths, orientBridgedSeed, projectBridgePaths } from '../../../../src/layout/engine/families/bridge-projection.js';
import { assertFiniteHeavyCoordinates } from '../support/layout-assertions.js';

{
  const AMINO_CAGE = 'CC1(O)CC2CC(N)C1(C)C1OCCC21';

  /**
   * Checks an outward-readable compact cage without relaxing projected validation.
   * @param {object} result - Generated layout.
   * @param {number} bondLength - Requested scale.
   * @returns {void}
   */
  function assertCleanCage(result, bondLength) {
    const audit = result.metadata.audit;
    assert.equal(audit.ok, true);
    for (const key of [
      'severeOverlapCount',
      'bondLengthFailureCount',
      'visibleHeavyBondCrossingFailureCount',
      'labelOverlapCount',
      'ringSubstituentReadabilityFailureCount',
      'missingCoordinateCount',
      'nonfiniteCoordinateCount'
    ]) {
      assert.equal(audit[key], 0, key);
    }
    assert.equal(audit.stereoContradiction, false);
    assert.equal(audit.fallback.mode, null);
    assert.ok(audit.maxBondLengthDeviation <= bondLength * 0.25 + 1e-8);
    assert.ok(audit.visibleHeavyBondCrossingCount <= 2);
  }

  describe('compact hybrid scaffold branch exits', () => {
    for (const substituent of ['N', 'O', 'F', '[NH3+]', 'NC']) {
      for (const bondLength of [0.75, 1.5, 3]) {
        it(`keeps the ${substituent} exit readable at scale ${bondLength}`, () => {
          const smiles = AMINO_CAGE.replace('(N)', `(${substituent})`);
          const result = generateCoords(parseSMILES(smiles), { bondLength, auditTelemetry: true });
          assertCleanCage(result, bondLength);
          assert.equal(result.metadata.placementAudit.ringSubstituentReadabilityFailureCount, 0);
          assert.equal(result.metadata.placementAudit.bondLengthFailureCount, 0);
        });
      }
    }

    it('is deterministic and does not mutate the input molecule', () => {
      const molecule = parseSMILES(AMINO_CAGE);
      const before = [...molecule.atoms].map(([id, atom]) => [id, atom.x, atom.y]);
      const first = generateCoords(molecule);
      const second = generateCoords(parseSMILES(AMINO_CAGE));
      assertCleanCage(first, 1.5);
      assert.deepEqual(second.coords, first.coords);
      assert.deepEqual(
        [...molecule.atoms].map(([id, atom]) => [id, atom.x, atom.y]),
        before
      );
    });

    it('also repairs unanchored layouts with fixed preservation disabled', () => {
      assertCleanCage(generateCoords(parseSMILES(AMINO_CAGE), { preserveFixed: false }), 1.5);
    });

    for (const bondLength of [0.75, 1.5, 3]) {
      it(`preserves the stereochemical cage's bond quality at scale ${bondLength}`, () => {
        const smiles = 'CCN1C(=O)NC(=O)[C@@]12CC[C@@]3(O)[C@H]4Cc5ccc(O)cc5[C@@]3(CCN4CC6CC6)C2';
        const result = generateCoords(parseSMILES(smiles), { bondLength });
        const audit = result.metadata.audit;
        assert.equal(audit.ok, true);
        assert.equal(audit.severeOverlapCount, 0);
        assert.equal(audit.bondLengthFailureCount, 0);
        assert.equal(audit.visibleHeavyBondCrossingFailureCount, 0);
        assert.equal(audit.ringSubstituentReadabilityFailureCount, 0);
        assert.equal(audit.stereoContradiction, false);
        assert.ok(audit.maxBondLengthDeviation <= (0.5784 / 1.5) * bondLength);
        assert.ok(audit.meanBondLengthDeviation <= (0.1832 / 1.5) * bondLength);
      });
    }

    it('does not mutate supplied fixed-coordinate constraints', () => {
      const molecule = parseSMILES(AMINO_CAGE);
      const generated = generateCoords(molecule);
      const fixedCoords = new Map([...generated.coords].filter(([id]) => molecule.atoms.get(id).name !== 'H'));
      const before = structuredClone(fixedCoords);
      const result = generateCoords(parseSMILES(AMINO_CAGE), { fixedCoords });
      assert.deepEqual(fixedCoords, before);
      assert.deepEqual(result.layoutGraph.fixedCoords, before);
    });

    it('keeps ordinary ring, spiro, and projected cage controls clean', () => {
      for (const smiles of ['NC1CCCCC1', 'OC1CCC2(CC1)CCCC2', 'C1CC2CCC1C2', 'CC12C3C4C1C5C2C3C45', 'CC']) {
        const result = generateCoords(parseSMILES(smiles));
        assert.equal(result.metadata.audit.ok, true, smiles);
        assert.equal(result.metadata.audit.bondLengthFailureCount, 0, smiles);
        assert.equal(result.metadata.audit.visibleHeavyBondCrossingFailureCount, 0, smiles);
      }
    });
  });
}

{
  const BRIDGED_CARBAMATE = 'CCC1(O)C2CC(C#C)C(=O)C1NC(=O)OC2';
  const METHYL_CONTROL = 'CC1(O)C2CC(C#C)C(=O)C1NC(=O)OC2';
  const UNBRANCHED_CONTROL = 'C1(O)C2CC(C#C)C(=O)C1NC(=O)OC2';
  const DEOXY_CONTROL = 'CCC1C2CC(C#C)C(=O)C1NC(=O)OC2';

  /**
   * Asserts that a layout is complete and free of audit failures.
   * @param {object} result - Generated or refined layout result.
   * @returns {void}
   */
  function assertCleanCompleteLayout(result) {
    const audit = result.metadata.audit;
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingFailureCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.labelOverlapCount, 0);
    assert.equal(audit.missingCoordinateCount, 0);
    assert.equal(audit.nonfiniteCoordinateCount, 0);
    assert.equal(audit.stereoContradiction, false);
    assert.equal(audit.fallback.mode, null);
    assertFiniteHeavyCoordinates(result);
  }

  describe('bridged carbamate branch clearance', () => {
    for (const bondLength of [0.75, 1.5, 3]) {
      for (const suppressH of [true, false]) {
        it(`keeps the ethyl and hydroxyl branches outside the cage at scale ${bondLength} with suppressH=${suppressH}`, () => {
          const molecule = parseSMILES(BRIDGED_CARBAMATE);
          const generated = generateCoords(molecule, { bondLength, suppressH, auditTelemetry: true });
          const generatedBefore = structuredClone(generated.coords);
          const refined = refineCoords(molecule, {
            bondLength,
            suppressH,
            existingCoords: generated.coords,
            auditTelemetry: true
          });

          assertCleanCompleteLayout(generated);
          assertCleanCompleteLayout(refined);
          assert.deepEqual(generated.coords, generatedBefore);
        });
      }
    }

    it('keeps nearby branch and heteroatom controls clean', () => {
      for (const smiles of [METHYL_CONTROL, UNBRANCHED_CONTROL, DEOXY_CONTROL]) {
        assertCleanCompleteLayout(generateCoords(parseSMILES(smiles), { auditTelemetry: true }));
      }
    });

    it('preserves a fixed cage anchor without mutating the constraint map', () => {
      const initial = generateCoords(parseSMILES(BRIDGED_CARBAMATE));
      const fixedCoords = new Map([['C12', { ...initial.coords.get('C12') }]]);
      const before = structuredClone(fixedCoords);
      const anchored = generateCoords(parseSMILES(BRIDGED_CARBAMATE), { fixedCoords, auditTelemetry: true });

      assertCleanCompleteLayout(anchored);
      assert.deepEqual(fixedCoords, before);
      assert.deepEqual(anchored.layoutGraph.fixedCoords, before);
      assert.deepEqual(anchored.coords.get('C12'), before.get('C12'));
    });

    it('is cataloged and deterministic across fresh parses', () => {
      assert.ok(bugMolecules.includes(BRIDGED_CARBAMATE));
      const first = generateCoords(parseSMILES(BRIDGED_CARBAMATE));
      const second = generateCoords(parseSMILES(BRIDGED_CARBAMATE));

      assertCleanCompleteLayout(first);
      assert.deepEqual(second.coords, first.coords);
    });
  });
}

{
  const CAGE = 'CC1C2C(N)=C(C=O)C(CNC2=O)C11CN1';

  /**
   * Checks bond quality and readable exits without exempting projected geometry.
   * @param {object} result - Generated coordinates and audits.
   * @param {number} bondLength - Requested bond length.
   * @returns {void}
   */
  function assertCleanCage(result, bondLength) {
    for (const audit of [result.metadata.audit, result.metadata.placementAudit]) {
      assert.equal(audit.ok, true);
      for (const key of ['severeOverlapCount', 'bondLengthFailureCount', 'visibleHeavyBondCrossingFailureCount', 'labelOverlapCount', 'ringSubstituentReadabilityFailureCount']) {
        assert.equal(audit[key], 0, key);
      }
      assert.equal(audit.stereoContradiction, false);
      assert.equal(audit.fallback.mode, null);
      assert.ok(audit.maxBondLengthDeviation <= bondLength * 0.025);
      assert.ok(audit.visibleHeavyBondCrossingCount <= 2);
    }
    assert.ok(result.metadata.audit.visibleHeavyBondCrossingCount <= 1);
    assert.equal(result.metadata.audit.missingCoordinateCount, 0);
    assert.equal(result.metadata.audit.nonfiniteCoordinateCount, 0);
  }

  describe('bridged spiro scaffold exits', () => {
    for (const [name, smiles] of [
      ['amino/formyl cage', CAGE],
      ['ethyl branch', `C${CAGE}`],
      ['oxygen spiro ring', CAGE.replace('C11CN1', 'C11CO1')],
      ['carbon spiro ring', CAGE.replace('C11CN1', 'C11CC1')]
    ]) {
      for (const bondLength of [0.75, 1.5, 3]) {
        it(`places ${name} with sound bonds and readable exits at scale ${bondLength}`, () => {
          assertCleanCage(generateCoords(parseSMILES(smiles), { bondLength, auditTelemetry: true }), bondLength);
        });
      }
    }

    it('is deterministic without mutating source atoms', () => {
      const molecule = parseSMILES(CAGE);
      const before = [...molecule.atoms].map(([id, atom]) => [id, atom.x, atom.y, atom.chirality]);
      const first = generateCoords(molecule, { auditTelemetry: true });
      assertCleanCage(first, 1.5);
      assert.deepEqual(generateCoords(parseSMILES(CAGE)).coords, first.coords);
      assert.deepEqual(
        [...molecule.atoms].map(([id, atom]) => [id, atom.x, atom.y, atom.chirality]),
        before
      );
    });

    it('does not require user fixed-coordinate preservation', () => {
      assertCleanCage(generateCoords(parseSMILES(CAGE), { preserveFixed: false, auditTelemetry: true }), 1.5);
    });

    it('keeps simple chains, planar rings and projected cages clean', () => {
      for (const smiles of ['CC', 'C1CCCCC1', 'c1ccc2ccccc2c1', 'C1CC2CCC1C2', 'C1CCC2(CC1)CC2']) {
        assert.equal(generateCoords(parseSMILES(smiles)).metadata.audit.ok, true, smiles);
      }
    });

    for (const bondLength of [0.75, 1.5, 3]) {
      it(`does not crowd the expanded-ring analogue at scale ${bondLength}`, () => {
        const result = generateCoords(parseSMILES('CC1C2C(N)=CC(C=O)C(CNC2=O)C11CN1'), { bondLength });
        const audit = result.metadata.audit;
        assert.equal(audit.ok, true);
        for (const key of ['severeOverlapCount', 'labelOverlapCount', 'bondLengthFailureCount', 'visibleHeavyBondCrossingFailureCount', 'ringSubstituentReadabilityFailureCount']) {
          assert.equal(audit[key], 0, key);
        }
        assert.equal(audit.stereoContradiction, false);
        assert.ok(audit.maxBondLengthDeviation <= bondLength * 0.37);
      });
    }
  });

  describe('bridge projection carries spiro side rings', () => {
    for (const [name, smiles, pathLengths] of [
      ['balanced projection', CAGE, [3, 3, 4]],
      ['exact theta projection', 'CC1C2C(N)=CC(C=O)C(CNC2=O)C11CN1', [3, 4, 4]]
    ]) {
      for (const bondLength of [0.75, 1.5, 3]) {
        it(`preserves all side-ring vectors in ${name} at scale ${bondLength}`, () => {
          const graph = createLayoutGraph(parseSMILES(smiles), { bondLength });
          const atomIds = graph.ringSystems[0].atomIds;
          const seed = layoutKamadaKawai(graph.sourceMolecule, atomIds, { bondLength }).coords;
          const before = structuredClone(seed);
          const projected = projectBridgePaths(graph, atomIds, seed, bondLength);
          assert.equal(projected.translatedSideAtomCount, 2);
          const paths = enumerateBridgePaths(graph, atomIds, projected.bridgeheadAtomIds);
          assert.deepEqual(paths.map(path => path.length - 1).sort(), pathLengths);
          const pathAtoms = new Set(paths.flat());
          const ring = graph.rings.find(candidate => candidate.size === 3);
          const anchor = ring.atomIds.find(id => pathAtoms.has(id));
          const oriented = orientBridgedSeed(seed, projected.bridgeheadAtomIds).coords;
          assert.ok(Math.hypot(projected.coords.get(anchor).x - oriented.get(anchor).x, projected.coords.get(anchor).y - oriented.get(anchor).y) > bondLength * 0.1);
          for (const id of ring.atomIds) {
            for (const axis of ['x', 'y']) {
              const oldVector = oriented.get(id)[axis] - oriented.get(anchor)[axis];
              const newVector = projected.coords.get(id)[axis] - projected.coords.get(anchor)[axis];
              assert.ok(Math.abs(newVector - oldVector) < bondLength * 1e-9);
            }
          }
          assert.deepEqual(seed, before);
        });
      }
    }

    it('does not translate a side component containing a fixed atom', () => {
      const graph = createLayoutGraph(parseSMILES(CAGE), {});
      const atomIds = graph.ringSystems[0].atomIds;
      const seed = layoutKamadaKawai(graph.sourceMolecule, atomIds, { bondLength: 1.5 }).coords;
      const fixedCoords = new Map([['N16', seed.get('N16')]]);
      const projected = projectBridgePaths({ ...graph, fixedCoords }, atomIds, seed, 1.5);
      assert.equal(projected.translatedSideAtomCount, 0);
      const oriented = orientBridgedSeed(seed, projected.bridgeheadAtomIds).coords;
      for (const id of ['N16', 'C15']) {
        assert.deepEqual(projected.coords.get(id), oriented.get(id));
      }
      assert.deepEqual(fixedCoords, new Map([['N16', seed.get('N16')]]));
    });
  });
}
