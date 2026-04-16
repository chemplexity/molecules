import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseSMILES } from '../../../../src/io/smiles.js';
import { runHypervalentAngleTidy } from '../../../../src/layout/engine/cleanup/hypervalent-angle-tidy.js';
import { angleOf, angularDifference, sub } from '../../../../src/layout/engine/geometry/vec2.js';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';

function angleAt(coords, centerAtomId, ligandAtomId) {
  return angleOf(sub(coords.get(ligandAtomId), coords.get(centerAtomId)));
}

describe('layout/engine/cleanup/hypervalent-angle-tidy', () => {
  it('snaps monoxo phosphonate leaf ligands onto an orthogonal cross around the anchored single bond', () => {
    const graph = createLayoutGraph(parseSMILES('CP(=O)(O)O'), { suppressH: true });
    const coords = new Map([
      ['C1', { x: 0, y: 0 }],
      ['P2', { x: 1.5, y: 0 }],
      ['O3', { x: 2.45, y: 1.15 }],
      ['O4', { x: 2.2, y: 0.18 }],
      ['O5', { x: 2.2, y: -0.12 }]
    ]);

    const result = runHypervalentAngleTidy(graph, coords);
    const oxoAngle = angleAt(result.coords, 'P2', 'O3');
    const singleAngles = [angleAt(result.coords, 'P2', 'C1'), angleAt(result.coords, 'P2', 'O4'), angleAt(result.coords, 'P2', 'O5')];
    const axialSingleAngle = [...singleAngles].sort(
      (firstAngle, secondAngle) =>
        Math.abs(angularDifference(firstAngle, oxoAngle) - Math.PI) - Math.abs(angularDifference(secondAngle, oxoAngle) - Math.PI)
    )[0];
    const flankAngles = singleAngles.filter(singleAngle => singleAngle !== axialSingleAngle);

    assert.ok(result.nudges >= 3);
    assert.equal(flankAngles.length, 2);
    assert.ok(Math.abs(angularDifference(axialSingleAngle, oxoAngle) - Math.PI) < 1e-6);
    assert.ok(Math.abs(angularDifference(flankAngles[0], flankAngles[1]) - Math.PI) < 1e-6);
    assert.ok(Math.abs(angularDifference(axialSingleAngle, flankAngles[0]) - Math.PI / 2) < 1e-6);
    assert.ok(Math.abs(angularDifference(axialSingleAngle, flankAngles[1]) - Math.PI / 2) < 1e-6);
  });
});
