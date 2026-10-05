import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../../src/io/smiles.js';
import { generateCoords } from '../../../../src/layout/engine/api.js';
import { auditLayout } from '../../../../src/layout/engine/audit/audit.js';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { layoutOrganometallicFamily } from '../../../../src/layout/engine/families/organometallic.js';

const SILANE_FAN = 'CCCCC=CC1=CC=CC2=C1C=C(C2[Zr](Cl)(Cl)(C1C2=C(C=C1C1=CC=CC=C1)C(C=CCCCC)=CC=C2)[SiH](C)C)C1=CC=CC=C1';

/**
 * Checks geometry without weakening the planar bond/crossing requirements.
 * @param {object} audit - Layout audit.
 * @returns {void}
 */
function assertClean(audit) {
  assert.equal(audit.severeOverlapCount, 0);
  assert.equal(audit.visibleHeavyBondCrossingCount, 0);
  assert.equal(audit.bondLengthFailureCount, 0);
  assert.equal(audit.ringSubstituentReadabilityFailureCount, 0);
  assert.equal(audit.labelOverlapCount, 0);
  assert.equal(audit.stereoContradiction, false);
  assert.equal(audit.ok, true);
}

describe('generic organometallic ligand packing', () => {
  for (const element of ['Zr', 'Ti', 'Hf']) {
    for (const bondLength of [0.75, 1.5, 3]) {
      it(`separates bulky ${element} ligands at scale ${bondLength} before and after cleanup`, () => {
        const smiles = SILANE_FAN.replace('[Zr]', `[${element}]`);
        const graph = createLayoutGraph(parseSMILES(smiles), { bondLength });
        const placement = layoutOrganometallicFamily(graph, graph.components[0], bondLength);
        const audit = auditLayout(graph, placement.coords, { bondLength, bondValidationClasses: placement.bondValidationClasses });
        assertClean(audit);
        assert.ok(audit.maxBondLengthDeviation < 1e-9);
        assert.ok([...placement.bondValidationClasses.values()].every(value => value === 'planar'));

        // Slot reassignment must preserve the original regular fivefold fan.
        const metal = [...graph.atoms.values()].find(atom => atom.element === element);
        const center = placement.coords.get(metal.id);
        const angles = graph.sourceMolecule.atoms.get(metal.id).bonds.map(bondId => {
          const neighborId = graph.sourceMolecule.bonds.get(bondId).getOtherAtom(metal.id);
          const point = placement.coords.get(neighborId);
          assert.ok(Math.abs(Math.hypot(point.x - center.x, point.y - center.y) - bondLength) < 1e-9);
          return Math.atan2(point.y - center.y, point.x - center.x);
        }).sort((first, second) => first - second);
        assert.equal(angles.length, 5);
        for (let index = 0; index < angles.length; index++) {
          const gap = (angles[(index + 1) % angles.length] - angles[index] + 2 * Math.PI) % (2 * Math.PI);
          assert.ok(Math.abs(gap - 2 * Math.PI / 5) < 1e-9);
        }

        const result = generateCoords(parseSMILES(smiles), { bondLength });
        assertClean(result.metadata.audit);
        for (const atom of result.layoutGraph.atoms.values()) {
          if (atom.visible) {
            const point = result.coords.get(atom.id);
            assert.ok(point && Number.isFinite(point.x) && Number.isFinite(point.y));
          }
        }
      });
    }
  }

  it('is deterministic across fresh molecule instances', () => {
    const first = generateCoords(parseSMILES(SILANE_FAN));
    const second = generateCoords(parseSMILES(SILANE_FAN));
    assert.deepEqual(second.coords, first.coords);
    assert.deepEqual(second.metadata.audit, first.metadata.audit);
  });

  it('retains a clean simple generic fan', () => {
    const graph = createLayoutGraph(parseSMILES('[Zr](Cl)(Cl)(F)(Br)I'));
    const placement = layoutOrganometallicFamily(graph, graph.components[0], graph.options.bondLength);
    assertClean(auditLayout(graph, placement.coords, { bondValidationClasses: placement.bondValidationClasses }));
    assert.equal(placement.displayAssignments.length, 0);
  });

  it('preserves configured double-bond stereochemistry', () => {
    const smiles = SILANE_FAN.replace('CCCCC=CC1', 'CCCC/C=C/C1');
    const result = generateCoords(parseSMILES(smiles));
    assertClean(result.metadata.audit);
    assert.equal(result.metadata.stereo.ezCheckedBondCount, 1);
    assert.equal(result.metadata.stereo.ezViolationCount, 0);
  });

  it('does not displace an explicitly fixed metal center', () => {
    const molecule = parseSMILES(SILANE_FAN);
    const metal = [...molecule.atoms.values()].find(atom => atom.name === 'Zr');
    const fixedCoords = new Map([[metal.id, { x: 10, y: -4 }]]);
    const before = structuredClone(fixedCoords);
    const result = generateCoords(molecule, { fixedCoords });
    assert.deepEqual(result.coords.get(metal.id), before.get(metal.id));
    assert.equal(result.metadata.audit.fixedCoordinateViolationCount, 0);
    assert.deepEqual(fixedCoords, before);
  });
});
