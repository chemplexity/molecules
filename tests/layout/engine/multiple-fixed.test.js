import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Molecule } from '../../../src/core/Molecule.js';
import { generateCoords, refineCoords } from '../../../src/layout/engine/api.js';

/**
 * Creates a heavy-atom chain without implicit hydrogen placement side effects.
 * @param {number} count - Number of carbon atoms.
 * @returns {Molecule} Chain fixture.
 */
function chain(count) {
  const molecule = new Molecule();
  for (let index = 0; index < count; index++) {
    molecule.addAtom(`a${index}`, 'C');
    if (index > 0) {
      molecule.addBond(`b${index}`, `a${index - 1}`, `a${index}`, {}, false);
    }
  }
  return molecule;
}

describe('multiple fixed coordinate placement', () => {
  for (const entrypoint of [generateCoords, refineCoords]) {
    for (const count of [3, 4, 5]) {
      for (const bondLength of [0.75, 1.5, 3]) {
        it(`${entrypoint.name} preserves three anchors with ${count} atoms at scale ${bondLength}`, () => {
          const molecule = chain(count);
          const fixedCoords = new Map([
            ['a0', { x: 10, y: -4 }],
            ['a1', { x: 10 + bondLength, y: -4 }],
            ['a2', { x: 10 + bondLength, y: -4 + bondLength }]
          ]);
          const before = structuredClone(fixedCoords);
          const initial = generateCoords(molecule);
          const options = entrypoint === refineCoords ? { existingCoords: initial.coords, touchedAtoms: new Set([...molecule.atoms.keys()]) } : {};
          const result = entrypoint(molecule, { ...options, fixedCoords, bondLength });
          for (const [id, position] of fixedCoords) {
            assert.deepEqual(result.coords.get(id), position);
          }
          assert.deepEqual(fixedCoords, before);
          assert.equal(result.coords.size, count);
          assert.equal(result.metadata.audit.ok, true);
          for (const bond of molecule.bonds.values()) {
            const [a, b] = bond.atoms.map(id => result.coords.get(id));
            assert.ok(Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - bondLength) < 1e-9);
          }
        });
      }
    }
  }

  it('honors preserveFixed=false rather than seeding the supplied shape', () => {
    const fixedCoords = new Map([['a0', { x: 10, y: 10 }], ['a1', { x: 11.5, y: 10 }], ['a2', { x: 11.5, y: 11.5 }]]);
    const result = generateCoords(chain(3), { fixedCoords, preserveFixed: false });
    assert.notDeepEqual(result.coords.get('a1'), fixedCoords.get('a1'));
    assert.equal(result.metadata.audit.ok, true);
  });

  it('reports incompatible fixed bond lengths without moving their endpoints', () => {
    const fixedCoords = new Map([['a0', { x: 0, y: 0 }], ['a1', { x: 5, y: 0 }], ['a2', { x: 5, y: 5 }]]);
    const result = generateCoords(chain(3), { fixedCoords });
    assert.deepEqual(result.coords, fixedCoords);
    assert.equal(result.metadata.audit.ok, false);
    assert.ok(result.metadata.audit.bondLengthFailureCount > 0);
  });

  it('retains a fully fixed ring instead of rebuilding its template', () => {
    const molecule = chain(4);
    molecule.addBond('closure', 'a3', 'a0', {}, false);
    const fixedCoords = new Map([['a0', { x: 0, y: 0 }], ['a1', { x: 1.5, y: 0 }], ['a2', { x: 1.5, y: 1.5 }], ['a3', { x: 0, y: 1.5 }]]);
    const result = generateCoords(molecule, { fixedCoords });
    assert.deepEqual(result.coords, fixedCoords);
    assert.equal(result.metadata.audit.ok, true);
  });
});
