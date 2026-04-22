import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../src/io/smiles.js';
import { generateCoords } from '../../src/layout/public-api.js';
import { angleOf, angularDifference, centroid, sub } from '../../src/layout/engine/geometry/vec2.js';

function bondAngleAtAtom(molecule, centerAtomId, firstNeighborAtomId, secondNeighborAtomId) {
  const center = molecule.atoms.get(centerAtomId);
  const first = molecule.atoms.get(firstNeighborAtomId);
  const second = molecule.atoms.get(secondNeighborAtomId);
  return angularDifference(
    angleOf(sub(first, center)),
    angleOf(sub(second, center))
  );
}

describe('layout/public-api', () => {
  it('keeps hidden-h benzylic amino-alcohol centers trigonal when generating suppressed-h coordinates', () => {
    const molecule = parseSMILES('CC(COC1=CC=CC=C1)NC(C)C(O)C1=CC=C(O)C=C1');

    generateCoords(molecule, { suppressH: true, bondLength: 1.5 });

    for (const [firstNeighborAtomId, secondNeighborAtomId] of [
      ['C1', 'N11'],
      ['C1', 'C3'],
      ['N11', 'C3']
    ]) {
      const angle = bondAngleAtAtom(molecule, 'C2', firstNeighborAtomId, secondNeighborAtomId);
      assert.ok(
        Math.abs(angle - ((2 * Math.PI) / 3)) < 1e-6,
        `expected ${firstNeighborAtomId}-C2-${secondNeighborAtomId} to stay at 120 degrees, got ${((angle * 180) / Math.PI).toFixed(2)}`
      );
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
      assert.ok(
        Math.abs(angle - ((2 * Math.PI) / 3)) < 1e-6,
        `expected ${firstNeighborAtomId}-C4-${secondNeighborAtomId} to stay at 120 degrees, got ${((angle * 180) / Math.PI).toFixed(2)}`
      );
    }
    assert.equal([...molecule.atoms.values()].filter(atom => atom.name === 'H' && atom.visible !== false).length, 0);
  });

  it('keeps benzylic attached phenyl exits exact when suppressed hydrogens are hidden after layout', () => {
    const molecule = parseSMILES('CC(COC1=CC=CC=C1)NC(C)C(O)C1=CC=C(O)C=C1');

    generateCoords(molecule, { suppressH: true, bondLength: 1.5 });

    const phenylRingAtomIds = ['C16', 'C17', 'C18', 'C19', 'C21', 'C22'];
    const outwardAngle = angleOf(sub(
      molecule.atoms.get('C16'),
      centroid(phenylRingAtomIds.map(atomId => molecule.atoms.get(atomId)))
    ));
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
        Math.abs(angle - ((2 * Math.PI) / 3)) < 1e-6,
        `expected ${firstNeighborAtomId}-${centerAtomId}-${secondNeighborAtomId} to stay at 120 degrees, got ${((angle * 180) / Math.PI).toFixed(2)}`
      );
    }
    assert.equal([...molecule.atoms.values()].filter(atom => atom.name === 'H' && atom.visible !== false).length, 0);
  });
});
