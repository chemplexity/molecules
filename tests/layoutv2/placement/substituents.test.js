import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  chooseAttachmentAngle,
  placeRemainingBranches
} from '../../../src/layoutv2/placement/substituents.js';

describe('layoutv2/placement/substituents', () => {
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
});
