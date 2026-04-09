import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createRingConnection, ringConnectionKey } from '../../../src/layoutv2/model/ring-connection.js';

describe('layoutv2/model/ring-connection', () => {
  it('creates a deterministic ring-connection descriptor and key', () => {
    const connection = createRingConnection(4, 7, 2, ['a1', 'a2'], 'fused');
    assert.equal(ringConnectionKey(7, 2), '2:7');
    assert.deepEqual(connection, {
      id: 4,
      firstRingId: 7,
      secondRingId: 2,
      sharedAtomIds: ['a1', 'a2'],
      kind: 'fused'
    });
  });
});
