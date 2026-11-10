import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Molecule } from '../../../../src/core/Molecule.js';
import { generateCoords, refineCoords } from '../../../../src/layout/engine/api.js';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { layoutIsolatedRingFamily } from '../../../../src/layout/engine/families/isolated-ring.js';
import { parseSMILES } from '../../../../src/io/smiles.js';

{
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
        const fixedCoords = new Map([
          ['C1', { x: 0, y: 0 }],
          ['C2', { x: 1.5, y: 0 }],
          ['C3', { x: 1.5, y: 1.5 }]
        ]);
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
      const fixedCoords = new Map([
        ['a0', { x: 0, y: 0 }],
        ['a1', { x: 1.5, y: 0 }],
        ['a2', { x: 1.5, y: 1.5 }]
      ]);
      const base = generateCoords(molecule);
      const disabled = generateCoords(molecule, { fixedCoords, preserveFixed: false });
      assert.deepEqual(disabled.coords, base.coords);
    });

    it('retains incompatible anchors and reports bad geometry instead of silently fitting them', () => {
      const molecule = ringMolecule(6);
      const fixedCoords = new Map([
        ['a0', { x: 0, y: 0 }],
        ['a1', { x: 5, y: 0 }],
        ['a2', { x: 5, y: 5 }]
      ]);
      const result = generateCoords(molecule, { fixedCoords });
      for (const [id, position] of fixedCoords) {
        assert.deepEqual(result.coords.get(id), position);
      }
      assert.equal(result.metadata.audit.ok, false);
      assert.ok(result.metadata.audit.bondLengthFailureCount > 0);
      assert.ok([...result.coords.values()].every(position => Number.isFinite(position.x) && Number.isFinite(position.y)));
    });

    it('is deterministic and does not mutate the graph anchors during family placement', () => {
      const fixedCoords = new Map([
        ['a0', { x: 0, y: 0 }],
        ['a1', { x: 1.5, y: 0 }],
        ['a2', { x: 1.5, y: 1.5 }]
      ]);
      const graph = createLayoutGraph(ringMolecule(6), { fixedCoords });
      const before = structuredClone(graph.fixedCoords);
      const first = layoutIsolatedRingFamily(graph.rings[0], 1.5, { layoutGraph: graph });
      const second = layoutIsolatedRingFamily(graph.rings[0], 1.5, { layoutGraph: graph });
      assert.deepEqual(first.coords, second.coords);
      assert.deepEqual(graph.fixedCoords, before);
    });
  });
}

{
  describe('partially fixed fused rings', () => {
    for (const smiles of ['C1CCC2CCCCC2C1', 'C1CC2CCCC2C1', 'C1CCC2CC3CCCCC3CC2C1']) {
      for (const bondLength of [0.75, 1.5, 3]) {
        for (const entrypoint of [generateCoords, refineCoords]) {
          it(`${entrypoint.name} closes shared edges for ${smiles} at scale ${bondLength}`, () => {
            const molecule = parseSMILES(smiles);
            const fixedCoords = new Map([
              ['C1', { x: 10, y: -4 }],
              ['C2', { x: 10 + bondLength, y: -4 }],
              ['C3', { x: 10 + bondLength, y: -4 + bondLength }]
            ]);
            const before = structuredClone(fixedCoords);
            const options = entrypoint === refineCoords ? { existingCoords: generateCoords(molecule).coords, touchedAtoms: new Set(molecule.atoms.keys()) } : {};
            const result = entrypoint(molecule, { ...options, fixedCoords, bondLength });
            for (const [id, position] of fixedCoords) {
              assert.deepEqual(result.coords.get(id), position);
            }
            assert.deepEqual(fixedCoords, before);
            assert.equal(result.metadata.audit.ok, true);
            assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
            assert.equal(result.metadata.audit.severeOverlapCount, 0);
            for (const bond of molecule.bonds.values()) {
              if (bond.atoms.some(id => molecule.atoms.get(id).name === 'H')) {
                continue;
              }
              const [a, b] = bond.atoms.map(id => result.coords.get(id));
              assert.ok(Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - bondLength) < bondLength * 1e-7);
            }
          });
        }
      }
    }

    for (const smiles of ['C1CCC2CCCCC2C1C', 'C1CCC2CCCCC2C1.CC']) {
      it(`preserves anchors with branches or fragments: ${smiles}`, () => {
        const fixedCoords = new Map([
          ['C1', { x: 0, y: 0 }],
          ['C2', { x: 1.5, y: 0 }],
          ['C3', { x: 1.5, y: 1.5 }]
        ]);
        const result = generateCoords(parseSMILES(smiles), { fixedCoords });
        for (const [id, position] of fixedCoords) {
          assert.deepEqual(result.coords.get(id), position);
        }
        assert.equal(result.metadata.audit.ok, true);
        assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
      });
    }

    it('leaves disabled preservation unchanged and is deterministic', () => {
      const molecule = parseSMILES('C1CCC2CCCCC2C1');
      const fixedCoords = new Map([
        ['C1', { x: 0, y: 0 }],
        ['C2', { x: 1.5, y: 0 }],
        ['C3', { x: 1.5, y: 1.5 }]
      ]);
      assert.deepEqual(generateCoords(molecule, { fixedCoords, preserveFixed: false }).coords, generateCoords(molecule).coords);
      assert.deepEqual(generateCoords(molecule, { fixedCoords }).coords, generateCoords(molecule, { fixedCoords }).coords);
    });

    it('retains infeasible anchors and exposes bond failures', () => {
      const fixedCoords = new Map([
        ['C1', { x: 0, y: 0 }],
        ['C2', { x: 5, y: 0 }],
        ['C3', { x: 5, y: 5 }]
      ]);
      const result = generateCoords(parseSMILES('C1CCC2CCCCC2C1'), { fixedCoords });
      for (const [id, position] of fixedCoords) {
        assert.deepEqual(result.coords.get(id), position);
      }
      assert.equal(result.metadata.audit.ok, false);
      assert.ok(result.metadata.audit.bondLengthFailureCount > 0);
      assert.ok([...result.coords.values()].every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
    });
  });
}

{
  describe('partially fixed bridged rings', () => {
    for (const smiles of ['C1CC2CCC1C2', 'C1CC2CCC1CC2', 'C1C2CC3CC1CC(C2)C3']) {
      for (const bondLength of [0.75, 1.5, 3]) {
        for (const entrypoint of [generateCoords, refineCoords]) {
          it(`${entrypoint.name} preserves projected closure for ${smiles} at ${bondLength}`, () => {
            const molecule = parseSMILES(smiles);
            const fixedCoords = new Map([
              ['C1', { x: 10, y: -4 }],
              ['C2', { x: 10 + bondLength, y: -4 }],
              ['C3', { x: 10 + bondLength, y: -4 + bondLength }]
            ]);
            const before = structuredClone(fixedCoords);
            const options = entrypoint === refineCoords ? { existingCoords: generateCoords(molecule).coords, touchedAtoms: new Set(molecule.atoms.keys()) } : {};
            const result = entrypoint(molecule, { ...options, fixedCoords, bondLength });
            for (const [id, position] of fixedCoords) {
              assert.deepEqual(result.coords.get(id), position);
            }
            assert.deepEqual(fixedCoords, before);
            assert.equal(result.metadata.audit.ok, true);
            assert.equal(result.metadata.audit.severeOverlapCount, 0);
            assert.equal(result.metadata.audit.visibleHeavyBondCrossingFailureCount, 0);
            assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
            for (const bond of molecule.bonds.values()) {
              if (bond.atoms.some(id => molecule.atoms.get(id).name === 'H')) {
                continue;
              }
              const [a, b] = bond.atoms.map(id => result.coords.get(id));
              const ratio = Math.hypot(a.x - b.x, a.y - b.y) / bondLength;
              assert.ok(ratio >= 0.7 - 1e-8 && ratio <= 1.4 + 1e-8);
            }
          });
        }
      }
    }

    for (const smiles of ['C1CC2CCC1C2C', 'C1CC2CCC1C2.CC']) {
      it(`preserves anchors with branches/fragments: ${smiles}`, () => {
        const fixedCoords = new Map([
          ['C1', { x: 0, y: 0 }],
          ['C2', { x: 1.5, y: 0 }],
          ['C3', { x: 1.5, y: 1.5 }]
        ]);
        const result = generateCoords(parseSMILES(smiles), { fixedCoords });
        for (const [id, position] of fixedCoords) {
          assert.deepEqual(result.coords.get(id), position);
        }
        assert.equal(result.metadata.audit.ok, true);
      });
    }

    it('is deterministic and leaves disabled preservation unchanged', () => {
      const molecule = parseSMILES('C1CC2CCC1C2');
      const fixedCoords = new Map([
        ['C1', { x: 0, y: 0 }],
        ['C2', { x: 1.5, y: 0 }],
        ['C3', { x: 1.5, y: 1.5 }]
      ]);
      assert.deepEqual(generateCoords(molecule, { fixedCoords }).coords, generateCoords(molecule, { fixedCoords }).coords);
      assert.deepEqual(generateCoords(molecule, { fixedCoords, preserveFixed: false }).coords, generateCoords(molecule).coords);
    });

    it('retains infeasible anchors and reports bad geometry', () => {
      const fixedCoords = new Map([
        ['C1', { x: 0, y: 0 }],
        ['C2', { x: 5, y: 0 }],
        ['C3', { x: 5, y: 5 }]
      ]);
      const result = generateCoords(parseSMILES('C1CC2CCC1C2'), { fixedCoords });
      for (const [id, position] of fixedCoords) {
        assert.deepEqual(result.coords.get(id), position);
      }
      assert.equal(result.metadata.audit.ok, false);
      assert.ok(result.metadata.audit.bondLengthFailureCount > 0);
    });
  });
}

{
  describe('partially fixed single-ring macrocycles', () => {
    for (const size of [12, 14, 24]) {
      for (const bondLength of [0.75, 1.5, 3]) {
        for (const entrypoint of [generateCoords, refineCoords]) {
          it(`${entrypoint.name} preserves anchors and closes a ${size}-ring at scale ${bondLength}`, () => {
            const molecule = parseSMILES(`C1${'C'.repeat(size - 1)}1`);
            const fixedCoords = new Map([
              ['C1', { x: 10, y: -4 }],
              ['C2', { x: 10 + bondLength, y: -4 }],
              ['C3', { x: 10 + bondLength, y: -4 + bondLength }]
            ]);
            const before = structuredClone(fixedCoords);
            const options = entrypoint === refineCoords ? { existingCoords: generateCoords(molecule).coords, touchedAtoms: new Set(molecule.atoms.keys()) } : {};
            const result = entrypoint(molecule, { ...options, fixedCoords, bondLength });
            for (const [id, position] of fixedCoords) {
              assert.deepEqual(result.coords.get(id), position);
            }
            assert.deepEqual(fixedCoords, before);
            assert.equal(result.metadata.audit.ok, true);
            assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
            assert.equal(result.metadata.audit.severeOverlapCount, 0);
            for (let index = 1; index <= size; index++) {
              const a = result.coords.get(`C${index}`);
              const b = result.coords.get(`C${(index % size) + 1}`);
              assert.ok(Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - bondLength) < bondLength * 1e-7);
            }
          });
        }
      }
    }

    for (const smiles of ['C1CCCCCCCCCCC1C', 'C1CCCCCCCCCCC1.CC']) {
      it(`retains anchors with branches or disconnected fragments: ${smiles}`, () => {
        const fixedCoords = new Map([
          ['C1', { x: 0, y: 0 }],
          ['C2', { x: 1.5, y: 0 }],
          ['C3', { x: 1.5, y: 1.5 }]
        ]);
        const result = generateCoords(parseSMILES(smiles), { fixedCoords });
        for (const [id, position] of fixedCoords) {
          assert.deepEqual(result.coords.get(id), position);
        }
        assert.equal(result.metadata.audit.ok, true);
        assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
      });
    }

    it('leaves disabled preservation unchanged and produces deterministic constrained output', () => {
      const molecule = parseSMILES('C1CCCCCCCCCCC1');
      const fixedCoords = new Map([
        ['C1', { x: 0, y: 0 }],
        ['C2', { x: 1.5, y: 0 }],
        ['C3', { x: 1.5, y: 1.5 }]
      ]);
      assert.deepEqual(generateCoords(molecule, { fixedCoords, preserveFixed: false }).coords, generateCoords(molecule).coords);
      assert.deepEqual(generateCoords(molecule, { fixedCoords }).coords, generateCoords(molecule, { fixedCoords }).coords);
    });

    it('retains infeasible anchors and reports bond failures', () => {
      const fixedCoords = new Map([
        ['C1', { x: 0, y: 0 }],
        ['C2', { x: 5, y: 0 }],
        ['C3', { x: 5, y: 5 }]
      ]);
      const result = generateCoords(parseSMILES('C1CCCCCCCCCCC1'), { fixedCoords });
      for (const [id, position] of fixedCoords) {
        assert.deepEqual(result.coords.get(id), position);
      }
      assert.equal(result.metadata.audit.ok, false);
      assert.ok(result.metadata.audit.bondLengthFailureCount > 0);
      assert.ok([...result.coords.values()].every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
    });
  });
}
