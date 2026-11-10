import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../../src/io/smiles.js';
import { generateCoords, refineCoords } from '../../../../src/layout/engine/api.js';
import { auditLayout } from '../../../../src/layout/engine/audit/audit.js';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { regularizeFusedAromaticCyclohexaneCores } from '../../../../src/layout/engine/families/bridged.js';
import { layoutFusedFamily } from '../../../../src/layout/engine/families/fused.js';
import { layoutKamadaKawai } from '../../../../src/layout/engine/geometry/kk-layout.js';
import { distance } from '../../../../src/layout/engine/geometry/vec2.js';
import { assignBondValidationClass } from '../../../../src/layout/engine/placement/bond-validation.js';
import { AUDIT_CORPUS } from '../support/audit-corpus.js';
import { assertFiniteHeavyCoordinates } from '../support/layout-assertions.js';

{
  const ATTACHED_BRIDGED_IMIDE = 'Cl.FC(F)(F)c1ccc(nc1)N2CCN(CCCCN3C(=O)C4C5CCCC(CC5)C4C3=O)CC2';
  const BRIDGED_IMIDE_CASES = [ATTACHED_BRIDGED_IMIDE, 'FC(F)(F)c1ccc(nc1)N2CCN(CCCCN3C(=O)C4C5CCCC(CC5)C4C3=O)CC2', 'N1C(=O)C2C3CCCC(CC3)C2C1=O', 'N1C(=O)C2C3CCCC(C3)C2C1=O', 'N1C(=O)CCC1=O'];

  function assertCompleteCleanLayout(result) {
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingFailureCount, 0);
    assertFiniteHeavyCoordinates(result);
  }

  describe('compact bridged imide retension', () => {
    for (const smiles of BRIDGED_IMIDE_CASES) {
      for (const bondLength of [0.75, 1.5, 3]) {
        it(`keeps ${smiles} clean at bond length ${bondLength} before and after refinement`, () => {
          const molecule = parseSMILES(smiles);
          const generated = generateCoords(molecule, { bondLength });
          assertCompleteCleanLayout(generated);

          const refined = refineCoords(molecule, {
            existingCoords: generated.coords,
            touchedAtoms: new Set(molecule.atoms.keys()),
            bondLength
          });
          assertCompleteCleanLayout(refined);
        });
      }
    }

    it('preserves explicit cage anchors and does not mutate the fixed-coordinate map', () => {
      const smiles = 'N1C(=O)C2C3CCCC(CC3)C2C1=O';
      const initial = generateCoords(parseSMILES(smiles));
      const fixedCoords = new Map(['C10', 'C11'].map(atomId => [atomId, { ...initial.coords.get(atomId) }]));
      const before = structuredClone(fixedCoords);
      const molecule = parseSMILES(smiles);
      const result = generateCoords(molecule, { fixedCoords });

      assertCompleteCleanLayout(result);
      assert.deepEqual(fixedCoords, before);
      for (const [atomId, position] of fixedCoords) {
        assert.deepEqual(result.coords.get(atomId), position);
      }
    });

    it('is deterministic for the attached bridged imide', () => {
      const first = generateCoords(parseSMILES(ATTACHED_BRIDGED_IMIDE));
      const second = generateCoords(parseSMILES(ATTACHED_BRIDGED_IMIDE));
      assert.deepEqual(first.coords, second.coords);
    });
  });
}

{
  const CAGE = AUDIT_CORPUS.find(entry => entry.sourceIndex === 29465).smiles;

  /**
   * Checks complete cage geometry using the existing projected interpretation.
   * @param {object} result - Generated layout.
   * @param {number} [bondLength] - Target length.
   * @returns {void}
   */
  function assertClean(result, bondLength = 1.5) {
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
    // One internal bridge crossing is part of this cage's projection, not a
    // newly exempted planar branch. Preserve the existing corpus deviation cap.
    assert.ok(audit.visibleHeavyBondCrossingCount <= 1);
    assert.ok(audit.maxBondLengthDeviation <= (0.53 * bondLength) / 1.5);
    assert.equal(audit.stereoContradiction, false);
  }

  /**
   * Produces an unregularized, independently computed compact cage seed.
   * @returns {{graph: object, rings: object[], ids: string[], seed: Map<string, {x: number, y: number}>, classes: Map<string, string>}} Fixture.
   */
  function seedFixture() {
    const graph = createLayoutGraph(parseSMILES(CAGE), { suppressH: true });
    const rings = graph.ringSystems[0].ringIds.map(id => graph.ringById.get(id));
    const ids = [...new Set(rings.flatMap(ring => ring.atomIds))];
    const seed = layoutKamadaKawai(graph.sourceMolecule, ids, { bondLength: 1.5 }).coords;
    return { graph, rings, ids, seed, classes: assignBondValidationClass(graph, ids, 'bridged') };
  }

  describe('coupled bridge closure around a fused aromatic core', () => {
    for (const [name, sourceIndex, maxDeviations] of [
      ['stereochemical morphinan dimer', 382, [0.29700001, 0.59400001, 1.18800001]],
      ['amide-substituted morphinan', 34041, [0.29324334, 0.41152695, 0.82305388]]
    ]) {
      for (const [scaleIndex, bondLength] of [0.75, 1.5, 3].entries()) {
        it(`preserves the existing sound ${name} layout at scale ${bondLength}`, () => {
          const fixture = AUDIT_CORPUS.find(entry => entry.sourceIndex === sourceIndex);
          const result = generateCoords(parseSMILES(fixture.smiles), { bondLength });
          const audit = result.metadata.audit;
          assert.equal(audit.ok, true);
          assert.equal(audit.bondLengthFailureCount, 0);
          assert.equal(audit.severeOverlapCount, 0);
          assert.equal(audit.visibleHeavyBondCrossingFailureCount, 0);
          assert.equal(audit.ringSubstituentReadabilityFailureCount, 0);
          assert.equal(audit.missingCoordinateCount, 0);
          assert.equal(audit.nonfiniteCoordinateCount, 0);
          assert.equal(audit.stereoContradiction, false);
          // Preserve measured pre-repair geometry at each scale: the pipeline's
          // absolute tolerances can select different poses at the smallest size.
          assert.ok(audit.maxBondLengthDeviation <= maxDeviations[scaleIndex]);
        });
      }
    }

    for (const bondLength of [0.75, 1.5, 3]) {
      it(`preserves cage bonds at scale ${bondLength}`, () => {
        assertClean(generateCoords(parseSMILES(CAGE), { bondLength }), bondLength);
      });
    }

    it('retains the substantial strain reduction for a mildly strained phenol cage', () => {
      const fixture = AUDIT_CORPUS.find(entry => entry.sourceIndex === 32719);
      const audit = generateCoords(parseSMILES(fixture.smiles)).metadata.audit;
      assert.equal(audit.ok, true);
      assert.equal(audit.bondLengthFailureCount, 0);
      assert.equal(audit.severeOverlapCount, 0);
      assert.equal(audit.visibleHeavyBondCrossingFailureCount, 0);
      assert.ok(audit.maxBondLengthDeviation <= fixture.expected.maxBondLengthDeviation);
    });

    it('does not introduce contacts while selecting a repaired ammonium cage pose', () => {
      const fixture = AUDIT_CORPUS.find(entry => entry.sourceIndex === 32378);
      const audit = generateCoords(parseSMILES(fixture.smiles)).metadata.audit;
      assert.equal(audit.ok, true);
      assert.equal(audit.severeOverlapCount, 0);
      assert.equal(audit.bondLengthFailureCount, 0);
      assert.equal(audit.visibleHeavyBondCrossingFailureCount, 0);
      // This preserves the pre-repair geometry; the stricter opt-in corpus
      // ceiling is an outstanding issue and is deliberately not changed here.
      assert.ok(audit.maxBondLengthDeviation <= 0.55816242);
    });

    for (const [name, smiles] of [
      ['short phenol tail', `O${CAGE.slice(CAGE.indexOf('C1=CC='))}`],
      ['ethyl ammonium branch', CAGE.replace('[N+]3(C)', '[N+]3(CC)')],
      ['stereochemical side chain', CAGE.replace('CC(NC', 'C[C@H](NC')]
    ]) {
      it(`keeps the cage sound with a ${name}`, () => {
        const result = generateCoords(parseSMILES(smiles));
        assertClean(result);
        if (name === 'stereochemical side chain') {
          assert.equal(result.metadata.stereo.unassignedCenterCount, 0);
          assert.ok(result.metadata.stereo.assignedCenterCount > 0);
        }
      });
    }

    it('is deterministic with fresh molecules', () => {
      const first = generateCoords(parseSMILES(CAGE));
      const second = generateCoords(parseSMILES(CAGE));
      assertClean(first);
      assertClean(second);
      assert.deepEqual(second.coords, first.coords);
    });

    it('regularizes the fused pair without breaking coupled closure edges or mutating input', () => {
      const { graph, rings, ids, seed, classes } = seedFixture();
      const original = structuredClone(seed);
      const originalClasses = new Map(classes);
      const coords = regularizeFusedAromaticCyclohexaneCores(graph, rings, ids, seed, 1.5);
      const audit = auditLayout(graph, coords, { bondLength: 1.5, bondValidationClasses: classes });
      assert.equal(audit.ok, true);
      assert.ok(audit.maxBondLengthDeviation <= 0.37500001);
      assert.deepEqual(seed, original);
      assert.deepEqual(classes, originalClasses);
      assert.equal(graph.fixedCoords.size, 0);
      assert.equal(coords.size, seed.size);
      const aromatic = rings.find(ring => ring.aromatic);
      const fused = rings.find(ring => !ring.aromatic && ring.size === 6 && ring.atomIds.filter(id => aromatic.atomIds.includes(id)).length === 2);
      assert.ok(fused);
      for (const ring of [aromatic, fused]) {
        for (let i = 0; i < ring.atomIds.length; i++) {
          const a = coords.get(ring.atomIds[i]);
          const b = coords.get(ring.atomIds[(i + 1) % ring.atomIds.length]);
          assert.ok(Math.abs(distance(a, b) - 1.5) < 1e-8);
        }
      }
    });

    it('leaves explicitly fixed cage coordinates untouched', () => {
      const { graph, rings, ids, seed } = seedFixture();
      const original = structuredClone(seed);
      for (const [id, position] of seed) {
        graph.fixedCoords.set(id, { ...position });
      }
      const coords = regularizeFusedAromaticCyclohexaneCores(graph, rings, ids, seed, 1.5);
      assert.deepEqual(coords, original);
      assert.deepEqual(graph.fixedCoords, original);
    });

    it('keeps ordinary fused and simple projected-ring controls clean', () => {
      for (const smiles of ['c1ccc2c(c1)CCCC2', 'C1CC2CCC1C2', 'CC']) {
        const result = generateCoords(parseSMILES(smiles));
        assert.equal(result.metadata.audit.ok, true);
        assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
      }
    });
  });
}

{
  const CAGE = AUDIT_CORPUS.find(entry => entry.sourceIndex === 11708).smiles;

  /**
   * Checks the repaired cage without weakening projected or planar validation.
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
    assert.ok(audit.maxBondLengthDeviation <= bondLength * 0.32);
    assert.ok(audit.visibleHeavyBondCrossingCount <= 2);
  }

  /**
   * Places the first cage directly so aromatic-core geometry can be compared.
   * @param {object} graph - Layout graph.
   * @returns {{coords: Map, audit: object, aromaticIds: string[]}} Scaffold geometry.
   */
  function placeFirstCage(graph) {
    const system = graph.ringSystemById.get(graph.atomToRingSystemId.get('N10'));
    const rings = system.ringIds.map(id => graph.ringById.get(id));
    const ids = new Set(system.ringIds);
    const adjacency = new Map(rings.map(ring => [ring.id, []]));
    const connections = new Map();
    for (const connection of graph.ringConnections) {
      const a = connection.firstRingId;
      const b = connection.secondRingId;
      if (!ids.has(a) || !ids.has(b)) {
        continue;
      }
      adjacency.get(a).push(b);
      adjacency.get(b).push(a);
      connections.set(a < b ? `${a}:${b}` : `${b}:${a}`, connection);
    }
    const placement = layoutFusedFamily(rings, adjacency, connections, graph.options.bondLength, { layoutGraph: graph });
    return {
      coords: placement.coords,
      audit: auditLayout(graph, placement.coords, { bondLength: graph.options.bondLength, bondValidationClasses: assignBondValidationClass(graph, system.atomIds, 'bridged') }),
      aromaticIds: system.atomIds.filter(id => graph.atoms.get(id).aromatic)
    };
  }

  describe('pericondensed projected bond retension', () => {
    for (const [name, smiles] of [
      ['original', CAGE],
      ['ethyl ester', CAGE.replace('C(=O)OC', 'C(=O)OCC')],
      ['propyl branch', CAGE.replace('[C@H](CC)', '[C@H](CCC)')]
    ]) {
      for (const bondLength of [0.75, 1.5, 3]) {
        it(`clears ${name} bond and oxo defects at scale ${bondLength}`, () => {
          const result = generateCoords(parseSMILES(smiles), { bondLength, auditTelemetry: true });
          assertCleanCage(result, bondLength);
          assert.equal(result.metadata.placementAudit.bondLengthFailureCount, 0);
        });
      }
    }

    it('preserves every aromatic-core distance while repairing cage closures', () => {
      const graph = createLayoutGraph(parseSMILES(CAGE), {});
      // A real anchor on the other cage excludes automatic seed retension.
      const fixedCoords = new Map([['C25', { x: 0, y: 0 }]]);
      const before = placeFirstCage({ ...graph, fixedCoords });
      const after = placeFirstCage(graph);
      assert.equal(after.audit.bondLengthFailureCount, 0);
      assert.equal(after.audit.severeOverlapCount, 0);
      assert.ok(after.audit.maxBondLengthDeviation <= before.audit.maxBondLengthDeviation);
      for (const a of after.aromaticIds) {
        for (const b of after.aromaticIds) {
          const distance = coords => Math.hypot(coords.get(a).x - coords.get(b).x, coords.get(a).y - coords.get(b).y);
          assert.ok(Math.abs(distance(before.coords) - distance(after.coords)) < 1e-8);
        }
      }
      assert.deepEqual(fixedCoords, new Map([['C25', { x: 0, y: 0 }]]));
    });

    it('is deterministic and does not mutate source atom coordinates', () => {
      const molecule = parseSMILES(CAGE);
      const before = [...molecule.atoms].map(([id, atom]) => [id, atom.x, atom.y, atom.chirality]);
      const first = generateCoords(molecule);
      assertCleanCage(first, 1.5);
      assert.deepEqual(generateCoords(parseSMILES(CAGE)).coords, first.coords);
      assert.deepEqual(
        [...molecule.atoms].map(([id, atom]) => [id, atom.x, atom.y, atom.chirality]),
        before
      );
    });

    it('also repairs layouts with fixed preservation disabled', () => {
      assertCleanCage(generateCoords(parseSMILES(CAGE), { preserveFixed: false }), 1.5);
    });

    it('keeps planar aromatic and simple projected controls clean', () => {
      for (const smiles of ['CC', 'c1ccc2ccccc2c1', 'c1cc2ccc3cccc4ccc(c1)c2c34', 'C1CC2CCC1C2']) {
        assert.equal(generateCoords(parseSMILES(smiles)).metadata.audit.ok, true, smiles);
      }
    });
  });
}
