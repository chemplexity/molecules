import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createRingSystem } from '../../../../src/layout/engine/model/ring-system.js';

describe('layout/engine/model/ring-system', () => {
  it('creates a deterministic ring-system descriptor', () => {
    const rings = [
      { signature: 'r0' },
      { signature: 'r1' }
    ];
    const canonicalAtomRank = new Map([
      ['a2', 2],
      ['a0', 0],
      ['a1', 1]
    ]);
    const system = createRingSystem({
      atomIds: ['a2', 'a0', 'a1'],
      ringIds: [1, 0]
    }, rings, canonicalAtomRank, 3);

    assert.equal(system.id, 3);
    assert.deepEqual(system.atomIds, ['a0', 'a1', 'a2']);
    assert.deepEqual(system.ringIds, [0, 1]);
    assert.equal(system.signature, '3|r0#r1');
  });
});
