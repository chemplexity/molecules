import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../src/io/smiles.js';
import { generateCoords, refineCoords } from '../../../src/layout/engine/api.js';

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
