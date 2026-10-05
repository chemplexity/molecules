import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../src/io/smiles.js';
import { generateCoords, refineCoords } from '../../../src/layout/engine/api.js';
import { auditFinalLayout } from '../../../src/layout/engine/audit/audit.js';

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
      const fixedCoords = new Map([['C1', { x: 0, y: 0 }], ['C2', { x: 10, y: 0 }], [hydrogen.id, { x: 0, y: 1.5 }]]);
      const result = entrypoint(molecule, { fixedCoords });
      assert.deepEqual(result.coords.get(hydrogen.id), fixedCoords.get(hydrogen.id));
      assert.equal(result.metadata.audit.ok, false);
      assertConsistentAudit(result);
    });
  }
});
