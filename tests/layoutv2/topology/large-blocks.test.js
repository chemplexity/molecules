import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { exceedsLargeMoleculeThreshold } from '../../../src/layoutv2/topology/large-blocks.js';

describe('layoutv2/topology/large-blocks', () => {
  it('detects when traits exceed the large-molecule threshold', () => {
    const threshold = {
      heavyAtomCount: 120,
      ringSystemCount: 10,
      blockCount: 16
    };

    assert.equal(exceedsLargeMoleculeThreshold({ heavyAtomCount: 121, ringSystemCount: 1 }, threshold, 1), true);
    assert.equal(exceedsLargeMoleculeThreshold({ heavyAtomCount: 10, ringSystemCount: 11 }, threshold, 1), true);
    assert.equal(exceedsLargeMoleculeThreshold({ heavyAtomCount: 10, ringSystemCount: 1 }, threshold, 17), true);
    assert.equal(exceedsLargeMoleculeThreshold({ heavyAtomCount: 10, ringSystemCount: 1 }, threshold, 1), false);
  });
});
