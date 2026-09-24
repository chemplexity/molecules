import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Molecule } from '../../../src/core/Molecule.js';
import { generateCoords, refineCoords } from '../../../src/layout/engine/api.js';
import { createLayoutGraph } from '../../../src/layout/engine/model/layout-graph.js';
import { layoutIsolatedRingFamily } from '../../../src/layout/engine/families/isolated-ring.js';
import { parseSMILES } from '../../../src/io/smiles.js';

/**
 * Builds a carbon ring with no implicit hydrogen coordinates.
 * @param {number} size - Ring size.
 * @returns {Molecule} Test ring.
 */
function ringMolecule(size) {
  const molecule = new Molecule();
  for (let index = 0; index < size; index++) {
    molecule.addAtom(`a${index}`, 'C');
  }
  for (let index = 0; index < size; index++) {
    molecule.addBond(`b${index}`, `a${index}`, `a${(index + 1) % size}`, {}, false);
  }
  return molecule;
}

describe('partially fixed isolated rings', () => {
  for (const smiles of ['C1CCCCC1C', 'C1CCCCC1.CC']) {
    it(`preserves ring anchors with branches or disconnected fragments: ${smiles}`, () => {
      const fixedCoords = new Map([['C1', { x: 0, y: 0 }], ['C2', { x: 1.5, y: 0 }], ['C3', { x: 1.5, y: 1.5 }]]);
      const molecule = parseSMILES(smiles);
      const result = generateCoords(molecule, { fixedCoords });
      for (const [id, position] of fixedCoords) {
        assert.deepEqual(result.coords.get(id), position);
      }
      assert.equal(result.metadata.audit.ok, true);
      assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    });
  }

  for (const size of [4, 5, 6, 7]) {
    for (const bondLength of [0.75, 1.5, 3]) {
      for (const entrypoint of [generateCoords, refineCoords]) {
        it(`${entrypoint.name} closes a ${size}-ring at scale ${bondLength} without moving three anchors`, () => {
          const molecule = ringMolecule(size);
          const fixedCoords = new Map([
            ['a0', { x: 10, y: -4 }],
            ['a1', { x: 10 + bondLength, y: -4 }],
            ['a2', { x: 10 + bondLength, y: -4 + bondLength }]
          ]);
          const before = structuredClone(fixedCoords);
          const options = entrypoint === refineCoords ? { existingCoords: generateCoords(molecule).coords, touchedAtoms: new Set(molecule.atoms.keys()) } : {};
          const result = entrypoint(molecule, { ...options, fixedCoords, bondLength });
          for (const [id, position] of fixedCoords) {
            assert.deepEqual(result.coords.get(id), position);
          }
          assert.deepEqual(fixedCoords, before);
          assert.equal(result.coords.size, size);
          assert.equal(result.metadata.audit.ok, true);
          assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
          for (const bond of molecule.bonds.values()) {
            const [a, b] = bond.atoms.map(id => result.coords.get(id));
            assert.ok(Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - bondLength) < bondLength * 1e-7);
          }
        });
      }
    }
  }

  it('leaves unconstrained template placement unchanged when preservation is disabled', () => {
    const molecule = ringMolecule(6);
    const fixedCoords = new Map([['a0', { x: 0, y: 0 }], ['a1', { x: 1.5, y: 0 }], ['a2', { x: 1.5, y: 1.5 }]]);
    const base = generateCoords(molecule);
    const disabled = generateCoords(molecule, { fixedCoords, preserveFixed: false });
    assert.deepEqual(disabled.coords, base.coords);
  });

  it('retains incompatible anchors and reports bad geometry instead of silently fitting them', () => {
    const molecule = ringMolecule(6);
    const fixedCoords = new Map([['a0', { x: 0, y: 0 }], ['a1', { x: 5, y: 0 }], ['a2', { x: 5, y: 5 }]]);
    const result = generateCoords(molecule, { fixedCoords });
    for (const [id, position] of fixedCoords) {
      assert.deepEqual(result.coords.get(id), position);
    }
    assert.equal(result.metadata.audit.ok, false);
    assert.ok(result.metadata.audit.bondLengthFailureCount > 0);
    assert.ok([...result.coords.values()].every(position => Number.isFinite(position.x) && Number.isFinite(position.y)));
  });

  it('is deterministic and does not mutate the graph anchors during family placement', () => {
    const fixedCoords = new Map([['a0', { x: 0, y: 0 }], ['a1', { x: 1.5, y: 0 }], ['a2', { x: 1.5, y: 1.5 }]]);
    const graph = createLayoutGraph(ringMolecule(6), { fixedCoords });
    const before = structuredClone(graph.fixedCoords);
    const first = layoutIsolatedRingFamily(graph.rings[0], 1.5, { layoutGraph: graph });
    const second = layoutIsolatedRingFamily(graph.rings[0], 1.5, { layoutGraph: graph });
    assert.deepEqual(first.coords, second.coords);
    assert.deepEqual(graph.fixedCoords, before);
  });
});
