import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../src/io/smiles.js';
import { generateCoords, refineExistingCoords } from '../../src/layout/public-api.js';
import { angleOf, angularDifference, centroid, sub } from '../../src/layout/engine/geometry/vec2.js';

function bondAngleAtAtom(molecule, centerAtomId, firstNeighborAtomId, secondNeighborAtomId) {
  const center = molecule.atoms.get(centerAtomId);
  const first = molecule.atoms.get(firstNeighborAtomId);
  const second = molecule.atoms.get(secondNeighborAtomId);
  return angularDifference(angleOf(sub(first, center)), angleOf(sub(second, center)));
}

describe('layout/public-api', () => {
  for (const update of [generateCoords, refineExistingCoords]) {
    it(`${update.name} reverses repeated suppression without revealing manually hidden hydrogens`, () => {
      const molecule = parseSMILES('CC');
      const hydrogens = [...molecule.atoms.values()].filter(atom => atom.name === 'H');
      const manuallyHidden = hydrogens[0];
      manuallyHidden.visible = false;
      for (let cycle = 0; cycle < 2; cycle++) {
        generateCoords(molecule, { suppressH: true });
        update(molecule, { suppressH: true });
        assert.ok(hydrogens.every(atom => atom.visible === false));
        const coords = update(molecule, { suppressH: false });
        assert.equal(manuallyHidden.visible, false);
        for (const atom of hydrogens.slice(1)) {
          assert.equal(atom.visible, true);
          assert.ok(coords.has(atom.id));
          const parent = atom.getNeighbors(molecule)[0];
          assert.ok(Math.hypot(atom.x - parent.x, atom.y - parent.y) > 0.5, 'restored H must not remain coincident');
        }
      }
    });

    it(`${update.name} restores all six ethane hydrogens like a fresh unsuppressed molecule`, () => {
      const molecule = parseSMILES('CC');
      generateCoords(molecule, { suppressH: true });
      update(molecule, { suppressH: false });
      const fresh = parseSMILES('CC');
      generateCoords(fresh, { suppressH: false });
      assert.deepEqual([...molecule.atoms.values()].map(atom => atom.visible), [...fresh.atoms.values()].map(atom => atom.visible));
      assert.equal([...molecule.atoms.values()].filter(atom => atom.name === 'H' && atom.visible).length, 6);
    });
  }

  it('keeps metal hydrogens explicit when generating suppressed-h coordinates', () => {
    const molecule = parseSMILES('[FeH]');

    generateCoords(molecule, { suppressH: true, bondLength: 1.5 });

    const iron = molecule.atoms.get('Fe1');
    const hydrogen = molecule.atoms.get('H2');
    assert.equal(iron?.visible, true);
    assert.equal(hydrogen?.visible, true);
    assert.equal(Number.isFinite(hydrogen?.x), true);
    assert.equal(Number.isFinite(hydrogen?.y), true);
    assert.ok(Math.hypot(hydrogen.x - iron.x, hydrogen.y - iron.y) > 0.5, 'expected Fe-H to be laid out as an explicit bond');
  });

  it('keeps hidden-h benzylic amino-alcohol centers trigonal when generating suppressed-h coordinates', () => {
    const molecule = parseSMILES('CC(COC1=CC=CC=C1)NC(C)C(O)C1=CC=C(O)C=C1');

    generateCoords(molecule, { suppressH: true, bondLength: 1.5 });

    for (const [firstNeighborAtomId, secondNeighborAtomId] of [
      ['C1', 'N11'],
      ['C1', 'C3'],
      ['N11', 'C3']
    ]) {
      const angle = bondAngleAtAtom(molecule, 'C2', firstNeighborAtomId, secondNeighborAtomId);
      assert.ok(Math.abs(angle - (2 * Math.PI) / 3) < 1e-6, `expected ${firstNeighborAtomId}-C2-${secondNeighborAtomId} to stay at 120 degrees, got ${((angle * 180) / Math.PI).toFixed(2)}`);
    }
    assert.equal([...molecule.atoms.values()].filter(atom => atom.name === 'H' && atom.visible !== false).length, 0);
  });

  it('keeps visible halogen trigonal slots exact when suppressed hydrogens are hidden after layout', () => {
    const molecule = parseSMILES('CC(=O)C(Cl)CC(C(C)C)C=C');

    generateCoords(molecule, { suppressH: true, bondLength: 1.5 });

    for (const [firstNeighborAtomId, secondNeighborAtomId] of [
      ['C2', 'Cl5'],
      ['Cl5', 'C6'],
      ['C2', 'C6']
    ]) {
      const angle = bondAngleAtAtom(molecule, 'C4', firstNeighborAtomId, secondNeighborAtomId);
      assert.ok(Math.abs(angle - (2 * Math.PI) / 3) < 1e-6, `expected ${firstNeighborAtomId}-C4-${secondNeighborAtomId} to stay at 120 degrees, got ${((angle * 180) / Math.PI).toFixed(2)}`);
    }
    assert.equal([...molecule.atoms.values()].filter(atom => atom.name === 'H' && atom.visible !== false).length, 0);
  });

  it('keeps benzylic attached phenyl exits exact when suppressed hydrogens are hidden after layout', () => {
    const molecule = parseSMILES('CC(COC1=CC=CC=C1)NC(C)C(O)C1=CC=C(O)C=C1');

    generateCoords(molecule, { suppressH: true, bondLength: 1.5 });

    const phenylRingAtomIds = ['C16', 'C17', 'C18', 'C19', 'C21', 'C22'];
    const outwardAngle = angleOf(sub(molecule.atoms.get('C16'), centroid(phenylRingAtomIds.map(atomId => molecule.atoms.get(atomId)))));
    const exitAngle = angleOf(sub(molecule.atoms.get('C14'), molecule.atoms.get('C16')));
    assert.ok(
      angularDifference(outwardAngle, exitAngle) < 1e-6,
      `expected C16-C14 to stay on the exact local aromatic outward axis, got ${((angularDifference(outwardAngle, exitAngle) * 180) / Math.PI).toFixed(2)}`
    );
    for (const [centerAtomId, firstNeighborAtomId, secondNeighborAtomId] of [
      ['C2', 'C1', 'N11'],
      ['C2', 'C1', 'C3'],
      ['C2', 'N11', 'C3'],
      ['C12', 'C13', 'N11'],
      ['C12', 'C13', 'C14'],
      ['C12', 'N11', 'C14'],
      ['C14', 'C12', 'O15'],
      ['C14', 'C12', 'C16'],
      ['C14', 'O15', 'C16']
    ]) {
      const angle = bondAngleAtAtom(molecule, centerAtomId, firstNeighborAtomId, secondNeighborAtomId);
      assert.ok(
        Math.abs(angle - (2 * Math.PI) / 3) < 1e-6,
        `expected ${firstNeighborAtomId}-${centerAtomId}-${secondNeighborAtomId} to stay at 120 degrees, got ${((angle * 180) / Math.PI).toFixed(2)}`
      );
    }
    assert.equal([...molecule.atoms.values()].filter(atom => atom.name === 'H' && atom.visible !== false).length, 0);
  });
});
