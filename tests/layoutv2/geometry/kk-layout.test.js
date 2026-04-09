import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { layoutKamadaKawai, isKamadaKawaiLayoutAcceptable } from '../../../src/layoutv2/geometry/kk-layout.js';
import { makeUnmatchedBridgedCage } from '../support/molecules.js';

describe('layoutv2/geometry/kk-layout', () => {
  it('lays out a small unmatched bridged cage with finite coordinates', () => {
    const molecule = makeUnmatchedBridgedCage();
    const atomIds = [...molecule.atoms.keys()];
    const result = layoutKamadaKawai(molecule, atomIds, { bondLength: 1.5 });
    assert.equal(result.coords.size, atomIds.length);
    assert.equal(result.skipped, false);
    assert.equal(result.ok, true);
  });

  it('flags obviously bad coordinate sets as unacceptable', () => {
    const molecule = makeUnmatchedBridgedCage();
    const coords = new Map([...molecule.atoms.keys()].map(atomId => [atomId, { x: 0, y: 0 }]));
    assert.equal(isKamadaKawaiLayoutAcceptable(molecule, [...molecule.atoms.keys()], coords, 1.5), false);
  });
});
