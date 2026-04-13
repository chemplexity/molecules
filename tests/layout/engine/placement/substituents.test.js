import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../../src/io/index.js';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { angularDifference } from '../../../../src/layout/engine/geometry/vec2.js';

import {
  chooseAttachmentAngle,
  placeRemainingBranches
} from '../../../../src/layout/engine/placement/substituents.js';

describe('layout/engine/placement/substituents', () => {
  it('chooses an outward attachment angle and places remaining branch atoms', () => {
    const adjacency = new Map([
      ['a0', ['a1', 'a2']],
      ['a1', ['a0']],
      ['a2', ['a0']]
    ]);
    const coords = new Map([
      ['a0', { x: 0, y: 0 }],
      ['a1', { x: 1.5, y: 0 }]
    ]);
    const rank = new Map([['a0', 0], ['a1', 1], ['a2', 2]]);
    const angle = chooseAttachmentAngle(adjacency, coords, 'a0', new Set(['a0', 'a1', 'a2']));
    assert.ok(Number.isFinite(angle));

    placeRemainingBranches(adjacency, rank, coords, new Set(['a0', 'a1', 'a2']), ['a0', 'a1'], 1.5);
    assert.equal(coords.has('a2'), true);
  });

  it('keeps pending alkene attachments on trigonal continuation angles instead of the widest open gap', () => {
    const graph = createLayoutGraph(parseSMILES('CC=C'));
    const adjacency = new Map([
      ['C1', ['C2']],
      ['C2', ['C1', 'C3', 'H7']],
      ['C3', ['C2', 'H8', 'H9']],
      ['H7', ['C2']],
      ['H8', ['C3']],
      ['H9', ['C3']]
    ]);
    const coords = new Map([
      ['C1', { x: 0, y: 0 }],
      ['C2', { x: 1.5, y: 0 }]
    ]);
    const angle = chooseAttachmentAngle(adjacency, coords, 'C2', new Set(adjacency.keys()), null, graph, 'C3');

    assert.ok(
      angularDifference(angle, Math.PI / 3) < 1e-6 || angularDifference(angle, (5 * Math.PI) / 3) < 1e-6,
      `expected trigonal alkene continuation, got ${(angle * 180 / Math.PI).toFixed(2)}°`
    );
  });
});
