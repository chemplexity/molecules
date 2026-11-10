import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Molecule } from '../../../../src/core/Molecule.js';
import { parseSMILES } from '../../../../src/io/smiles.js';
import { generateCoords, refineCoords } from '../../../../src/layout/engine/api.js';
import { auditFinalLayout } from '../../../../src/layout/engine/audit/audit.js';

{
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
      const fixedCoords = new Map([
        ['a0', { x: 10, y: 10 }],
        ['a1', { x: 11.5, y: 10 }],
        ['a2', { x: 11.5, y: 11.5 }]
      ]);
      const result = generateCoords(chain(3), { fixedCoords, preserveFixed: false });
      assert.notDeepEqual(result.coords.get('a1'), fixedCoords.get('a1'));
      assert.equal(result.metadata.audit.ok, true);
    });

    it('reports incompatible fixed bond lengths without moving their endpoints', () => {
      const fixedCoords = new Map([
        ['a0', { x: 0, y: 0 }],
        ['a1', { x: 5, y: 0 }],
        ['a2', { x: 5, y: 5 }]
      ]);
      const result = generateCoords(chain(3), { fixedCoords });
      assert.deepEqual(result.coords, fixedCoords);
      assert.equal(result.metadata.audit.ok, false);
      assert.ok(result.metadata.audit.bondLengthFailureCount > 0);
    });

    it('retains a fully fixed ring instead of rebuilding its template', () => {
      const molecule = chain(4);
      molecule.addBond('closure', 'a3', 'a0', {}, false);
      const fixedCoords = new Map([
        ['a0', { x: 0, y: 0 }],
        ['a1', { x: 1.5, y: 0 }],
        ['a2', { x: 1.5, y: 1.5 }],
        ['a3', { x: 0, y: 1.5 }]
      ]);
      const result = generateCoords(molecule, { fixedCoords });
      assert.deepEqual(result.coords, fixedCoords);
      assert.equal(result.metadata.audit.ok, true);
    });
  });
}

{
  const CAGE = 'CC1(O)CC2CC(N)C1(C)C1OCCC21';

  /**
   * Copies heavy coordinates into a translated/rotated constraint frame.
   * @param {object} result - Initial generated layout.
   * @param {number} angle - Rotation in radians.
   * @returns {Map<string, {x: number, y: number}>} Explicit anchors.
   */
  function heavyAnchors(result, angle = 0) {
    return new Map(
      [...result.coords]
        .filter(([id]) => result.layoutGraph.atoms.get(id).element !== 'H')
        .map(([id, p]) => [
          id,
          {
            x: 13 + p.x * Math.cos(angle) - p.y * Math.sin(angle),
            y: -7 + p.x * Math.sin(angle) + p.y * Math.cos(angle)
          }
        ])
    );
  }

  /**
   * Verifies actual coordinates as well as the final audit.
   * @param {object} result - Layout result.
   * @param {Map<string, {x: number, y: number}>} fixedCoords - Requested anchors.
   * @returns {void}
   */
  function assertAnchors(result, fixedCoords) {
    for (const [id, p] of fixedCoords) {
      assert.deepEqual(result.coords.get(id), p, id);
    }
    assert.equal(result.metadata.audit.fixedCoordinateViolationCount, 0);
    assert.equal(result.metadata.audit.missingCoordinateCount, 0);
    assert.equal(result.metadata.audit.nonfiniteCoordinateCount, 0);
  }

  describe('fixed branches of an anchored mixed scaffold', () => {
    for (const [name, smiles] of [
      ['bridged amino cage', CAGE],
      ['aromatic ring', 'Cc1ccc(O)cc1'],
      ['spiro system', 'CC1CCC2(CC1)CCCC2O']
    ]) {
      for (const bondLength of [0.75, 1.5, 3]) {
        for (const angle of [0, 0.63]) {
          it(`preserves every fixed heavy atom in ${name} at scale ${bondLength}, angle ${angle}`, () => {
            const initial = generateCoords(parseSMILES(smiles), { bondLength });
            assert.equal(initial.metadata.audit.ok, true);
            const fixedCoords = heavyAnchors(initial, angle);
            const before = structuredClone(fixedCoords);
            const result = generateCoords(parseSMILES(smiles), { bondLength, fixedCoords });
            assertAnchors(result, fixedCoords);
            assert.equal(result.metadata.audit.ok, true);
            assert.deepEqual(fixedCoords, before);
          });
        }
      }
    }

    it('also retains all anchors during touched-atom refinement', () => {
      const initial = generateCoords(parseSMILES(CAGE));
      const fixedCoords = heavyAnchors(initial, 0.63);
      const result = refineCoords(parseSMILES(CAGE), { existingCoords: initial.coords, fixedCoords, touchedAtoms: new Set(fixedCoords.keys()) });
      assertAnchors(result, fixedCoords);
      assert.equal(result.metadata.audit.ok, true);
    });

    it('grows a free branch without moving the fixed scaffold and sibling leaves', () => {
      const initial = generateCoords(parseSMILES(CAGE));
      const fixedCoords = heavyAnchors(initial, 0.63);
      fixedCoords.delete('C1');
      const before = structuredClone(fixedCoords);
      const result = generateCoords(parseSMILES(CAGE), { fixedCoords });
      assertAnchors(result, fixedCoords);
      assert.equal(result.metadata.audit.ok, true);
      assert.ok(result.coords.has('C1'));
      assert.deepEqual(fixedCoords, before);
    });

    it('keeps an incompatible fixed leaf in place and reports the bad bond', () => {
      const initial = generateCoords(parseSMILES(CAGE));
      const fixedCoords = heavyAnchors(initial);
      fixedCoords.set('C10', { x: 100, y: 100 });
      const before = structuredClone(fixedCoords);
      const result = generateCoords(parseSMILES(CAGE), { fixedCoords });
      assertAnchors(result, fixedCoords);
      assert.equal(result.metadata.audit.ok, false);
      assert.ok(result.metadata.audit.bondLengthFailureCount > 0);
      assert.deepEqual(fixedCoords, before);
    });

    it('does not pin supplied coordinates when preservation is disabled', () => {
      const initial = generateCoords(parseSMILES(CAGE));
      const fixedCoords = heavyAnchors(initial, 0.63);
      const before = structuredClone(fixedCoords);
      const result = generateCoords(parseSMILES(CAGE), { fixedCoords, preserveFixed: false });
      assert.equal(result.metadata.audit.fixedCoordinateViolationCount, 0);
      assert.equal(result.metadata.audit.nonfiniteCoordinateCount, 0);
      assert.notDeepEqual(result.coords.get('C1'), fixedCoords.get('C1'));
      assert.deepEqual(fixedCoords, before);
    });
  });
}

{
  /**
   * Hides all hydrogens and selects a stereochemical hydrogen when available.
   * @param {string} smiles - Fixture SMILES.
   * @returns {{molecule: object, hydrogen: object}} Hidden-H fixture and anchor.
   */
  function hiddenFixture(smiles) {
    const molecule = parseSMILES(smiles);
    const hydrogens = [...molecule.atoms.values()].filter(atom => atom.name === 'H');
    for (const atom of hydrogens) {
      atom.visible = false;
    }
    const hydrogen = hydrogens.find(atom => atom.getNeighbors(molecule).some(parent => parent.getChirality())) ?? hydrogens[0];
    return { molecule, hydrogen };
  }

  /**
   * Requires the reported audit and quality result to match the returned state.
   * These acyclic fixtures do not need projected-bond validation overrides.
   * @param {object} result - Engine result.
   * @returns {void}
   */
  function assertConsistentAudit(result) {
    const actual = auditFinalLayout(result.layoutGraph, result.coords, { stereo: result.metadata.stereo });
    assert.deepEqual(result.metadata.audit, actual);
    assert.deepEqual(result.metadata.qualityReport.audit, actual);
    assert.equal(result.metadata.qualityReport.ok, actual.ok);
  }

  describe('fixed hidden hydrogen coordinates', () => {
    for (const entrypoint of [generateCoords, refineCoords]) {
      for (const smiles of ['C', 'CC', '[H]O[H]', 'C[C@H](O)F']) {
        for (const bondLength of [0.75, 1.5, 3]) {
          it(`${entrypoint.name} retains the hidden anchor in ${smiles} at ${bondLength}`, () => {
            const { molecule, hydrogen } = hiddenFixture(smiles);
            const fixedCoords = new Map([[hydrogen.id, { x: 10, y: -4 }]]);
            const beforeAtoms = structuredClone([...molecule.atoms]);
            const beforeFixed = structuredClone(fixedCoords);
            const existingCoords = entrypoint === refineCoords ? generateCoords(molecule, { bondLength }).coords : undefined;
            const beforeExisting = structuredClone(existingCoords);
            const result = entrypoint(molecule, { fixedCoords, bondLength, existingCoords });
            assert.deepEqual(result.coords.get(hydrogen.id), fixedCoords.get(hydrogen.id));
            assert.equal(result.layoutGraph.atoms.get(hydrogen.id).visible, false);
            for (const atom of molecule.atoms.values()) {
              if (atom.name === 'H' && atom.id !== hydrogen.id) {
                assert.equal(result.coords.has(atom.id), false);
              }
            }
            assert.equal(result.metadata.audit.ok, true);
            assert.equal(result.metadata.audit.fixedCoordinateViolationCount, 0);
            assertConsistentAudit(result);
            assert.deepEqual(structuredClone([...molecule.atoms]), beforeAtoms);
            assert.deepEqual(fixedCoords, beforeFixed);
            assert.deepEqual(existingCoords, beforeExisting);
          });
        }
      }

      it(`${entrypoint.name} still suppresses ordinary and disabled anchors`, () => {
        for (const options of [{}, { preserveFixed: false }]) {
          const { molecule, hydrogen } = hiddenFixture('CC');
          const result = entrypoint(molecule, {
            ...options,
            ...(options.preserveFixed === false ? { fixedCoords: new Map([[hydrogen.id, { x: 10, y: 10 }]]) } : {})
          });
          for (const atom of molecule.atoms.values()) {
            if (atom.name === 'H') {
              assert.equal(result.coords.has(atom.id), false);
            }
          }
          assertConsistentAudit(result);
          assert.equal(result.metadata.audit.ok, true);
        }
      });

      it(`${entrypoint.name} keeps explicit-hydrogen placement with suppression disabled`, () => {
        const { molecule, hydrogen } = hiddenFixture('CC');
        const target = { x: 10, y: 10 };
        const result = entrypoint(molecule, { suppressH: false, fixedCoords: new Map([[hydrogen.id, target]]) });
        assert.deepEqual(result.coords.get(hydrogen.id), target);
        assert.equal(result.coords.size, molecule.atoms.size);
        assertConsistentAudit(result);
      });

      it(`${entrypoint.name} does not turn existing-coordinate hints into protected anchors`, () => {
        const { molecule, hydrogen } = hiddenFixture('CC');
        const result = entrypoint(molecule, { existingCoords: new Map([[hydrogen.id, { x: 10, y: 10 }]]) });
        assert.equal(result.coords.has(hydrogen.id), false);
        assertConsistentAudit(result);
      });

      it(`${entrypoint.name} does not hide genuinely invalid fixed geometry`, () => {
        const { molecule, hydrogen } = hiddenFixture('CC');
        const fixedCoords = new Map([
          ['C1', { x: 0, y: 0 }],
          ['C2', { x: 10, y: 0 }],
          [hydrogen.id, { x: 0, y: 1.5 }]
        ]);
        const result = entrypoint(molecule, { fixedCoords });
        assert.deepEqual(result.coords.get(hydrogen.id), fixedCoords.get(hydrogen.id));
        assert.equal(result.metadata.audit.ok, false);
        assertConsistentAudit(result);
      });
    }
  });
}
