import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../src/io/smiles.js';
import { generateCoords, refineExistingCoords, generateAndRefine2dCoords } from '../../src/layout/public-api.js';
import { normalizeOptions } from '../../src/layout/engine/options.js';
import { createLayoutGraph } from '../../src/layout/engine/model/layout-graph.js';
import { enforceAcyclicEZStereo } from '../../src/layout/engine/stereo/enforcement.js';
import { inspectEZStereo } from '../../src/layout/engine/stereo/ez.js';

const CROWDED_RING = 'COC1=CC=CC(=C1)S(=O)(=O)N1C=C(CN(CC(C)(C)C)C([O-])=O)C(F)=C1C1=CC=CN=C1C#N';

/**
 * Measures which side of the attachment axis contains the nitrile-bearing ring edge.
 * @param {Map<string, {x: number, y: number}>} coords - Placed coordinates.
 * @returns {number} Signed cross product, invariant under rigid rotation/translation.
 */
function ringSide(coords) {
  const a = coords.get('C27');
  const b = coords.get('C28');
  const c = coords.get('C33');
  return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
}

describe('allowBranchReflect', () => {
  it('defaults to enabled and rejects nonboolean values', () => {
    assert.equal(normalizeOptions().allowBranchReflect, true);
    assert.equal(normalizeOptions({ allowBranchReflect: false }).allowBranchReflect, false);
    assert.throws(() => normalizeOptions({ allowBranchReflect: 'false' }), TypeError);
    const molecule = parseSMILES('CC');
    generateCoords(molecule);
    assert.throws(() => refineExistingCoords(molecule, { allowBranchReflect: 0 }), TypeError);
  });

  for (const mode of ['generate', 'refine']) {
    it(`excludes the optional pyridyl branch mirror during ${mode}`, () => {
      const results = [];
      for (const allowBranchReflect of [false, true, undefined]) {
        const molecule = parseSMILES(CROWDED_RING);
        let coords;
        if (mode === 'refine') {
          // A partially placed input exercises refinement without inferring a
          // full fixed ring from an already-clean generated drawing.
          for (const atom of molecule.atoms.values()) {
            atom.x = NaN;
            atom.y = NaN;
          }
          molecule.atoms.get('C1').x = 0;
          molecule.atoms.get('C1').y = 0;
          coords = refineExistingCoords(molecule, { allowBranchReflect });
        } else {
          coords = generateCoords(molecule, { allowBranchReflect });
        }
        for (const atom of molecule.atoms.values()) {
          if (atom.visible) {
            assert.ok(Number.isFinite(coords.get(atom.id)?.x));
            assert.ok(Number.isFinite(coords.get(atom.id)?.y));
          }
        }
        for (const bond of molecule.bonds.values()) {
          const a = coords.get(bond.atoms[0]);
          const b = coords.get(bond.atoms[1]);
          if (a && b) {
            assert.ok(Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - 1.5) < 0.15);
          }
        }
        results.push(coords);
      }
      assert.ok(ringSide(results[0]) > 1);
      assert.ok(ringSide(results[1]) < -1);
      assert.deepEqual(results[1], results[2]);
    });
  }

  it('forwards the combined API option to its refinement step', () => {
    const actual = parseSMILES(CROWDED_RING);
    const expected = parseSMILES(CROWDED_RING);
    const result = generateAndRefine2dCoords(actual, { allowBranchReflect: false });
    generateCoords(expected);
    const coords = refineExistingCoords(expected, { allowBranchReflect: false, freezeRings: true });
    assert.deepEqual(result, coords);
  });

  it('leaves ordinary acyclic layouts unchanged', () => {
    assert.deepEqual(generateCoords(parseSMILES('CCCO'), { allowBranchReflect: false }), generateCoords(parseSMILES('CCCO')));
  });

  it('still corrects required E/Z geometry when optional reflections are disabled', () => {
    const graph = createLayoutGraph(parseSMILES('F/C=C/F'), { allowBranchReflect: false });
    const input = new Map([
      ['F1', { x: -0.75, y: Math.sqrt(3) * 0.75 }],
      ['C2', { x: 0, y: 0 }],
      ['C3', { x: 1.5, y: 0 }],
      ['F4', { x: 2.25, y: Math.sqrt(3) * 0.75 }]
    ]);
    const before = structuredClone(input);
    assert.equal(inspectEZStereo(graph, input).violationCount, 1);
    const result = enforceAcyclicEZStereo(graph, input);
    assert.equal(inspectEZStereo(graph, result.coords).violationCount, 0);
    assert.deepEqual(input, before);
  });
});
