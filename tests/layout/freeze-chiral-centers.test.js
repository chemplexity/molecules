import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../src/io/smiles.js';
import { generateCoords, refineExistingCoords, generateAndRefine2dCoords } from '../../src/layout/public-api.js';

describe('freezeChiralCenters', () => {
  for (const smiles of ['C[C@H](F)Cl', 'CC(F)Cl', 'N[C@@H](C)C(=O)O']) {
    it(`freezes center positions but permits neighbor movement for ${smiles}`, () => {
      const molecule = parseSMILES(smiles);
      generateCoords(molecule);
      const center = [...molecule.atoms.values()].find(atom => atom.isChiralCenter(molecule));
      const chirality = center.getChirality();
      const neighbor = center.getNeighbors(molecule).find(atom => atom.name !== 'H');
      const neighborBefore = { x: neighbor.x, y: neighbor.y };
      center.x += 0.3;
      center.y += 0.2;
      const position = { x: center.x, y: center.y };
      refineExistingCoords(molecule, { freezeChiralCenters: true, freezeRings: false });
      assert.deepEqual({ x: center.x, y: center.y }, position);
      assert.equal(center.getChirality(), chirality);
      assert.notDeepEqual({ x: neighbor.x, y: neighbor.y }, neighborBefore);
      for (const atom of center.getNeighbors(molecule).filter(atom => atom.visible)) {
        assert.ok(Math.abs(Math.hypot(atom.x - center.x, atom.y - center.y) - 1.5) < 1e-8);
      }
    });
  }

  it('does not freeze centers when the option is omitted or false', () => {
    for (const options of [{}, { freezeChiralCenters: false }]) {
      const molecule = parseSMILES('C[C@H](F)Cl');
      generateCoords(molecule);
      const center = [...molecule.atoms.values()].find(atom => atom.isChiralCenter(molecule));
      center.x += 0.3;
      center.y += 0.2;
      const position = { x: center.x, y: center.y };
      refineExistingCoords(molecule, options);
      assert.notDeepEqual({ x: center.x, y: center.y }, position);
    }
  });

  it('preserves the center during localized touched-atom refinement', () => {
    const molecule = parseSMILES('C[C@H](F)Cl');
    generateCoords(molecule);
    const center = [...molecule.atoms.values()].find(atom => atom.isChiralCenter(molecule));
    center.x += 0.3;
    center.y += 0.2;
    const position = { x: center.x, y: center.y };
    refineExistingCoords(molecule, {
      freezeChiralCenters: true,
      freezeRings: false,
      touchedAtoms: new Set([center.id])
    });
    assert.deepEqual({ x: center.x, y: center.y }, position);
  });

  it('gives explicit fixed coordinates precedence without mutating the map', () => {
    const molecule = parseSMILES('C[C@H](F)Cl');
    generateCoords(molecule);
    const center = [...molecule.atoms.values()].find(atom => atom.isChiralCenter(molecule));
    const fixedCoords = new Map([[center.id, { x: 10, y: -4 }]]);
    const before = structuredClone(fixedCoords);
    refineExistingCoords(molecule, { freezeChiralCenters: true, fixedCoords });
    assert.deepEqual({ x: center.x, y: center.y }, fixedCoords.get(center.id));
    assert.deepEqual(fixedCoords, before);
  });

  it('leaves achiral molecules unaffected', () => {
    const a = parseSMILES('CC(O)C');
    const b = parseSMILES('CC(O)C');
    generateCoords(a);
    generateCoords(b);
    assert.deepEqual(refineExistingCoords(a, { freezeChiralCenters: true }), refineExistingCoords(b));
  });

  it('freezes generation-stage center positions in the combined API', () => {
    const smiles = 'C[C@H](F)[C@@H](Cl)Br';
    const baseline = parseSMILES(smiles);
    generateCoords(baseline);
    const molecule = parseSMILES(smiles);
    generateAndRefine2dCoords(molecule, { freezeChiralCenters: true });
    for (const center of molecule.atoms.values()) {
      if (center.isChiralCenter(molecule)) {
        const expected = baseline.atoms.get(center.id);
        assert.deepEqual({ x: center.x, y: center.y }, { x: expected.x, y: expected.y });
      }
    }
  });
});
