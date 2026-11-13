import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../src/io/smiles.js';
import { generateCoords, refineCoords } from '../../../src/layout/engine/api.js';
import { createLayoutGraph } from '../../../src/layout/engine/model/layout-graph.js';
import { assignPreservedBondValidationClasses } from '../../../src/layout/engine/placement/bond-validation.js';
import { auditLayout } from '../../../src/layout/engine/audit/audit.js';
import { AUDIT_CORPUS } from './support/audit-corpus.js';

describe('preserved projected metal-macrocycle validation', () => {
  for (const sourceIndex of [21728, 10515]) {
    for (const bondLength of [0.75, 1.5, 3]) {
      for (const suppressH of [true, false]) {
        it(`retains cobalt corrin ${sourceIndex} at ${bondLength} with suppressH=${suppressH}`, () => {
          const smiles = AUDIT_CORPUS.find(entry => entry.sourceIndex === sourceIndex).smiles;
          const generated = generateCoords(parseSMILES(smiles), { bondLength, suppressH });
          assert.equal(generated.metadata.audit.ok, true);
          const existingCoords = new Map([...generated.coords].map(([id, point]) => [id, { x: 10 - point.y, y: point.x - 4 }]));
          const before = structuredClone(existingCoords);
          const refined = refineCoords(parseSMILES(smiles), { bondLength, suppressH, existingCoords });
          assert.deepEqual(existingCoords, before);
          for (const result of [generated, refined]) {
            const audit = result.metadata.audit;
            assert.equal(audit.ok, true);
            assert.equal(audit.bondLengthFailureCount, 0);
            assert.equal(audit.severeOverlapCount, 0);
            assert.equal(audit.visibleHeavyBondCrossingFailureCount, 0);
            assert.equal(audit.stereoContradiction, false);
            assert.equal(audit.missingCoordinateCount, 0);
            assert.equal(audit.nonfiniteCoordinateCount, 0);
          }

          const malformed = structuredClone(existingCoords);
          const graph = createLayoutGraph(parseSMILES(smiles), { bondLength, suppressH });
          const classes = assignPreservedBondValidationClasses(graph, graph.components[0], new Map(), malformed);
          const branchBond = [...graph.bonds.values()].find(bond => bond.kind === 'covalent' && !bond.inRing && graph.atoms.get(bond.a).element !== 'H' && graph.atoms.get(bond.b).element !== 'H');
          assert.equal(classes.get(branchBond.id), 'planar');
          malformed.set(branchBond.b, { x: 1000, y: -1000 });
          assert.equal(auditLayout(graph, malformed, { bondLength, bondValidationClasses: classes }).ok, false);
          const distorted = new Map([...before].map(([id, point]) => [id, { x: point.x * 2, y: point.y * 2 }]));
          const distortedClasses = assignPreservedBondValidationClasses(graph, graph.components[0], new Map(), distorted);
          assert.equal(auditLayout(graph, distorted, { bondLength, bondValidationClasses: distortedClasses }).ok, false);
        });
      }
    }
  }
});

describe('preserved projected-cage validation', () => {
  for (const smiles of ['C1CC2CCC1C2', 'C1CC2CCC1CC2', 'C12C3C4C1C5C4C3C25', 'C1C2CC3CC1CC(C2)C3', 'C1CCC2CCC1C2']) {
    for (const bondLength of [0.75, 1.5, 3]) {
      it(`retains valid projected geometry for ${smiles} at ${bondLength}`, () => {
        const molecule = parseSMILES(smiles);
        const generated = generateCoords(molecule, { bondLength });
        assert.equal(generated.metadata.audit.ok, true);
        const existingCoords = new Map([...generated.coords].map(([id, p]) => [id, { x: 10 - p.y, y: p.x - 4 }]));
        const before = structuredClone(existingCoords);
        const result = refineCoords(molecule, { existingCoords, bondLength });
        assert.deepEqual(existingCoords, before);
        assert.deepEqual(result.coords, before);
        assert.equal(result.metadata.audit.ok, true);
        assert.equal(result.metadata.qualityReport.ok, true);
        assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
        assert.equal(result.metadata.audit.visibleHeavyBondCrossingFailureCount, 0);
        assert.equal(result.metadata.audit.severeOverlapCount, 0);
        assert.deepEqual(refineCoords(molecule, { existingCoords: result.coords, bondLength }).coords, result.coords);
      });
    }
  }

  for (const suppressH of [true, false]) {
    it(`retains a mixed fused-cage projection with suppressH=${suppressH}`, () => {
      const molecule = parseSMILES('CC12N=CN3C4CC4C1C23C(=NO)C#C');
      const generated = generateCoords(molecule, { bondLength: 0.75, suppressH });
      assert.equal(generated.metadata.audit.ok, true);
      assert.equal(generated.metadata.audit.visibleHeavyBondCrossingCount, 3);

      const existingCoords = new Map([...generated.coords].map(([id, position]) => [id, { x: 10 - position.y, y: position.x - 4 }]));
      const before = structuredClone(existingCoords);
      const result = refineCoords(molecule, { existingCoords, bondLength: 0.75, suppressH });

      assert.deepEqual(existingCoords, before);
      assert.deepEqual(result.coords, before);
      assert.equal(result.metadata.audit.ok, true);
      assert.equal(result.metadata.qualityReport.ok, true);
      assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
      assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 3);
      assert.equal(result.metadata.audit.visibleHeavyBondCrossingFailureCount, 0);
      assert.equal(result.metadata.audit.severeOverlapCount, 0);
      for (const atom of molecule.atoms.values()) {
        if (atom.name === 'H') {
          continue;
        }
        const position = result.coords.get(atom.id);
        assert.ok(position && Number.isFinite(position.x) && Number.isFinite(position.y), `expected finite coordinates for ${atom.id}`);
      }
    });
  }

  for (const bondLength of [0.75, 1.5, 3]) {
    it(`reconstructs projected validation for a compact fused-cage fallback at ${bondLength}`, () => {
      const molecule = parseSMILES('C1(C2(C3(C4(C1C5(C2C3C45)))))');
      const generated = generateCoords(molecule, { bondLength });
      assert.equal(generated.metadata.audit.ok, true);

      const existingCoords = new Map(generated.coords);
      const result = refineCoords(molecule, { existingCoords, bondLength });

      assert.deepEqual(result.coords, existingCoords);
      assert.equal(result.metadata.audit.ok, true);
      assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
      assert.equal(result.metadata.audit.visibleHeavyBondCrossingFailureCount, 0);
    });
  }

  for (const smiles of ['C1CCCCC1', 'c1ccccc1', 'C1CCC2CCCCC2C1', 'C1CCC2C(C1)CCC1CCCCC12']) {
    it(`does not relax deformed planar geometry: ${smiles}`, () => {
      const molecule = parseSMILES(smiles);
      const generated = generateCoords(molecule);
      const existingCoords = new Map([...generated.coords].map(([id, p]) => [id, { x: p.x * 1.2, y: p.y * 1.2 }]));
      const result = refineCoords(molecule, { existingCoords });
      assert.equal(result.metadata.audit.ok, false);
      assert.ok(result.metadata.audit.bondLengthFailureCount > 0);
    });
  }

  it('still rejects cage bonds outside projected limits', () => {
    const molecule = parseSMILES('C1CC2CCC1C2');
    const generated = generateCoords(molecule);
    const existingCoords = new Map([...generated.coords].map(([id, p]) => [id, { x: p.x * 3, y: p.y * 3 }]));
    const result = refineCoords(molecule, { existingCoords });
    assert.equal(result.metadata.audit.ok, false);
    assert.ok(result.metadata.audit.bondLengthFailureCount > 0);
  });

  it('still rejects a distorted compact fused cage outside projected limits', () => {
    const molecule = parseSMILES('CC12N=CN3C4CC4C1C23C(=NO)C#C');
    const generated = generateCoords(molecule, { bondLength: 0.75 });
    const existingCoords = new Map([...generated.coords].map(([id, position]) => [id, { x: position.x * 1.5, y: position.y * 1.5 }]));
    const result = refineCoords(molecule, { existingCoords, bondLength: 0.75 });
    assert.equal(result.metadata.audit.ok, false);
    assert.ok(result.metadata.audit.bondLengthFailureCount > 0);
  });

  it('limits reconstructed fused-cage validation to the cage interior', () => {
    const molecule = parseSMILES('CC12N=CN3C4CC4C1C23C(=NO)C#C');
    const generated = generateCoords(molecule, { bondLength: 0.75 });
    const graph = createLayoutGraph(molecule, { bondLength: 0.75 });
    const classes = assignPreservedBondValidationClasses(graph, graph.components[0], new Map(), generated.coords);
    const ringAtomIds = new Set(graph.ringSystems[0].atomIds);

    for (const bond of graph.bonds.values()) {
      const expected = ringAtomIds.has(bond.a) && ringAtomIds.has(bond.b) ? 'bridged' : 'planar';
      assert.equal(classes.get(bond.id), expected);
    }
  });

  it('restricts projected classes to cage interiors, not branches or planar rings', () => {
    const graph = createLayoutGraph(parseSMILES('C1CC2CCC1C2CCc1ccccc1.CC'), {});
    const classes = new Map();
    for (const component of graph.components) {
      assignPreservedBondValidationClasses(graph, component, classes);
    }
    const cage = graph.ringSystems.find(system => system.atomIds.includes('C1'));
    const cageIds = new Set(cage.atomIds);
    for (const bond of graph.bonds.values()) {
      const expected = cageIds.has(bond.a) && cageIds.has(bond.b) ? 'bridged' : 'planar';
      assert.equal(classes.get(bond.id), expected);
    }
  });

  it('does not hide a crossing between unrelated planar fragments', () => {
    const molecule = parseSMILES('C1CC2CCC1C2.CC.CC');
    const generated = generateCoords(molecule);
    const graph = generated.layoutGraph;
    const classes = new Map();
    for (const component of graph.components) {
      assignPreservedBondValidationClasses(graph, component, classes);
    }
    const coords = new Map(generated.coords);
    const ethanes = graph.components.filter(component => component.heavyAtomCount === 2);
    for (const [index, component] of ethanes.entries()) {
      const ids = component.atomIds.filter(id => graph.atoms.get(id).element !== 'H');
      coords.set(ids[0], index === 0 ? { x: 100, y: 100 } : { x: 100.75, y: 99.25 });
      coords.set(ids[1], index === 0 ? { x: 101.5, y: 100 } : { x: 100.75, y: 100.75 });
    }
    const audit = auditLayout(graph, coords, { bondValidationClasses: classes });
    assert.equal(audit.ok, false);
    assert.equal(audit.visibleHeavyBondCrossingFailureCount, 1);
  });
});
