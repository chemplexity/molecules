import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseSMILES } from '../../../src/io/smiles.js';
import { tidySymmetry } from '../../../src/layoutv2/cleanup/symmetry-tidy.js';
import { createLayoutGraph } from '../../../src/layoutv2/model/layout-graph.js';
import { placeTemplateCoords } from '../../../src/layoutv2/templates/placement.js';
import { centroid, rotate, sub } from '../../../src/layoutv2/geometry/vec2.js';

describe('layoutv2/cleanup/symmetry-tidy', () => {
  it('snaps tiny near-axis noise back to exact zero', () => {
    const result = tidySymmetry(new Map([
      ['a0', { x: 1e-7, y: -1e-7 }],
      ['a1', { x: 1, y: 2 }]
    ]), { epsilon: 1e-6 });
    assert.deepEqual(result.coords.get('a0'), { x: 0, y: 0 });
    assert.ok(result.snappedCount >= 2);
  });

  it('rotates tilted fused systems so their shared junction bond becomes axis-aligned', () => {
    const graph = createLayoutGraph(parseSMILES('c1ccc2ccccc2c1'));
    const placed = placeTemplateCoords(graph, 'naphthalene', graph.ringSystems[0].atomIds, graph.options.bondLength);
    const center = centroid([...placed.values()]);
    const tilted = new Map();

    for (const [atomId, position] of placed) {
      const rotated = rotate(sub(position, center), Math.PI / 18);
      tilted.set(atomId, {
        x: center.x + rotated.x,
        y: center.y + rotated.y
      });
    }

    const result = tidySymmetry(tilted, {
      epsilon: 1e-6,
      layoutGraph: graph
    });
    const fusedConnection = graph.ringConnections.find(connection => connection.kind === 'fused');
    const [firstAtomId, secondAtomId] = fusedConnection.sharedAtomIds;
    const firstPosition = result.coords.get(firstAtomId);
    const secondPosition = result.coords.get(secondAtomId);

    assert.equal(result.junctionSnapCount, 1);
    assert.ok(
      Math.abs(firstPosition.x - secondPosition.x) < 1e-6
      || Math.abs(firstPosition.y - secondPosition.y) < 1e-6
    );
  });
});
