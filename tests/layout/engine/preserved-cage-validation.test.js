import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../src/io/smiles.js';
import { generateCoords, refineCoords } from '../../../src/layout/engine/api.js';
import { createLayoutGraph } from '../../../src/layout/engine/model/layout-graph.js';
import { assignPreservedBondValidationClasses } from '../../../src/layout/engine/placement/bond-validation.js';
import { auditLayout } from '../../../src/layout/engine/audit/audit.js';

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

  for (const smiles of ['C1CCCCC1', 'c1ccccc1', 'C1CCC2CCCCC2C1']) {
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
