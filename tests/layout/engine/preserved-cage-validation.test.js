import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../src/io/smiles.js';
import { generateCoords, refineCoords } from '../../../src/layout/engine/api.js';
import { createLayoutGraph } from '../../../src/layout/engine/model/layout-graph.js';
import { assignPreservedBondValidationClasses } from '../../../src/layout/engine/placement/bond-validation.js';
import { auditLayout } from '../../../src/layout/engine/audit/audit.js';
import { AUDIT_CORPUS } from './support/audit-corpus.js';

const SUBSTITUTED_QUATERNARY_CAGE = 'CC[N+]12CCC(CC1)CC2OC1(CCCN(C1)C(=O)CC1=CC=CC(OC(C)C)=C1)C1=CC=C(Cl)C(Cl)=C1';

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

describe('preserved whole-component projected cage validation', () => {
  for (const bondLength of [0.75, 1.5, 3]) {
    it(`preserves the clean substituted cage exactly at bond length ${bondLength}`, () => {
      const generated = generateCoords(parseSMILES(SUBSTITUTED_QUATERNARY_CAGE), {
        bondLength,
        suppressH: true,
        auditTelemetry: true
      });
      const existingCoords = structuredClone(generated.coords);
      const before = structuredClone(existingCoords);
      const refined = refineCoords(parseSMILES(SUBSTITUTED_QUATERNARY_CAGE), {
        bondLength,
        suppressH: true,
        existingCoords,
        auditTelemetry: true
      });

      assert.equal(generated.metadata.audit.ok, true);
      assert.deepEqual(existingCoords, before);
      assert.deepEqual(refined.coords, before);
      assert.equal(refined.metadata.audit.ok, true);
      assert.equal(refined.metadata.audit.bondLengthFailureCount, 0);
      assert.equal(refined.metadata.audit.severeOverlapCount, 0);
      assert.equal(refined.metadata.audit.visibleHeavyBondCrossingFailureCount, 0);
      assert.equal(refined.metadata.audit.stereoContradiction, false);
      assert.equal(refined.metadata.audit.missingCoordinateCount, 0);
      assert.equal(refined.metadata.audit.nonfiniteCoordinateCount, 0);
      assert.equal(refined.metadata.cleanupFastPath, true);
    });
  }

  it('reconstructs whole-component projected validation only for the large-scale fallback geometry', () => {
    const largeGenerated = generateCoords(parseSMILES(SUBSTITUTED_QUATERNARY_CAGE), { bondLength: 3, suppressH: true });
    const largeGraph = createLayoutGraph(parseSMILES(SUBSTITUTED_QUATERNARY_CAGE), { bondLength: 3, suppressH: true });
    const largeClasses = assignPreservedBondValidationClasses(largeGraph, largeGraph.components[0], new Map(), largeGenerated.coords);
    const externalHeavyBonds = [...largeGraph.bonds.values()].filter(bond => {
      const firstAtom = largeGraph.atoms.get(bond.a);
      const secondAtom = largeGraph.atoms.get(bond.b);
      const firstRingSystemId = largeGraph.atomToRingSystemId.get(bond.a);
      const secondRingSystemId = largeGraph.atomToRingSystemId.get(bond.b);
      return (
        bond.kind === 'covalent' && firstAtom?.element !== 'H' && secondAtom?.element !== 'H' && (firstRingSystemId == null || secondRingSystemId == null || firstRingSystemId !== secondRingSystemId)
      );
    });
    assert.ok(externalHeavyBonds.length > 0);
    assert.ok(externalHeavyBonds.every(bond => largeClasses.get(bond.id) === 'bridged'));

    const ordinaryGenerated = generateCoords(parseSMILES(SUBSTITUTED_QUATERNARY_CAGE), { bondLength: 1.5, suppressH: true });
    const ordinaryGraph = createLayoutGraph(parseSMILES(SUBSTITUTED_QUATERNARY_CAGE), { bondLength: 1.5, suppressH: true });
    const ordinaryClasses = assignPreservedBondValidationClasses(ordinaryGraph, ordinaryGraph.components[0], new Map(), ordinaryGenerated.coords);
    const ordinaryExternalBond = [...ordinaryGraph.bonds.values()].find(bond => {
      const firstAtom = ordinaryGraph.atoms.get(bond.a);
      const secondAtom = ordinaryGraph.atoms.get(bond.b);
      const firstRingSystemId = ordinaryGraph.atomToRingSystemId.get(bond.a);
      const secondRingSystemId = ordinaryGraph.atomToRingSystemId.get(bond.b);
      return (
        bond.kind === 'covalent' && firstAtom?.element !== 'H' && secondAtom?.element !== 'H' && (firstRingSystemId == null || secondRingSystemId == null || firstRingSystemId !== secondRingSystemId)
      );
    });
    assert.ok(ordinaryExternalBond);
    assert.equal(ordinaryClasses.get(ordinaryExternalBond.id), 'planar');
  });

  it('does not promote malformed or uniformly expanded preserved branches', () => {
    const generated = generateCoords(parseSMILES(SUBSTITUTED_QUATERNARY_CAGE), { bondLength: 3, suppressH: true });
    const graph = createLayoutGraph(parseSMILES(SUBSTITUTED_QUATERNARY_CAGE), { bondLength: 3, suppressH: true });
    const malformed = structuredClone(generated.coords);
    const externalBond = [...graph.bonds.values()].find(bond => {
      const firstAtom = graph.atoms.get(bond.a);
      const secondAtom = graph.atoms.get(bond.b);
      return bond.kind === 'covalent' && !bond.inRing && firstAtom?.element !== 'H' && secondAtom?.element !== 'H' && !graph.ringAtomIdSet.has(bond.a) && !graph.ringAtomIdSet.has(bond.b);
    });
    assert.ok(externalBond);
    const firstPosition = malformed.get(externalBond.a);
    malformed.set(externalBond.b, { x: firstPosition.x + 10, y: firstPosition.y });
    const malformedClasses = assignPreservedBondValidationClasses(graph, graph.components[0], new Map(), malformed);
    assert.equal(malformedClasses.get(externalBond.id), 'planar');
    assert.equal(auditLayout(graph, malformed, { bondLength: 3, bondValidationClasses: malformedClasses }).ok, false);

    const ordinaryGenerated = generateCoords(parseSMILES(SUBSTITUTED_QUATERNARY_CAGE), { bondLength: 1.5, suppressH: true });
    const ordinaryGraph = createLayoutGraph(parseSMILES(SUBSTITUTED_QUATERNARY_CAGE), { bondLength: 1.5, suppressH: true });
    const expanded = new Map([...ordinaryGenerated.coords].map(([atomId, position]) => [atomId, { x: position.x * 1.2, y: position.y * 1.2 }]));
    const expandedClasses = assignPreservedBondValidationClasses(ordinaryGraph, ordinaryGraph.components[0], new Map(), expanded);
    assert.equal(expandedClasses.get(externalBond.id), 'planar');
    assert.equal(auditLayout(ordinaryGraph, expanded, { bondLength: 1.5, bondValidationClasses: expandedClasses }).ok, false);
  });

  it('preserves an exact fixed anchor and deterministic refinement output', () => {
    const generated = generateCoords(parseSMILES(SUBSTITUTED_QUATERNARY_CAGE), { bondLength: 3, suppressH: true });
    const existingCoords = structuredClone(generated.coords);
    const fixedCoords = new Map([['O11', { ...existingCoords.get('O11') }]]);
    const fixedBefore = structuredClone(fixedCoords);
    const first = refineCoords(parseSMILES(SUBSTITUTED_QUATERNARY_CAGE), {
      bondLength: 3,
      suppressH: true,
      existingCoords,
      fixedCoords
    });
    const second = refineCoords(parseSMILES(SUBSTITUTED_QUATERNARY_CAGE), {
      bondLength: 3,
      suppressH: true,
      existingCoords,
      fixedCoords
    });

    assert.equal(first.metadata.audit.ok, true);
    assert.deepEqual(first.coords, existingCoords);
    assert.deepEqual(second.coords, first.coords);
    assert.deepEqual(fixedCoords, fixedBefore);
    assert.deepEqual(first.coords.get('O11'), fixedBefore.get('O11'));
  });
});
