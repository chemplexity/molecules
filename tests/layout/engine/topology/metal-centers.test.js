import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { findMetalCenterIds, isMetalAtom } from '../../../../src/layout/engine/topology/metal-centers.js';
import { makeOrganometallic } from '../support/molecules.js';

describe('layout/engine/topology/metal-centers', () => {
  it('detects transition-metal atoms', () => {
    assert.equal(isMetalAtom({ name: 'Ru', properties: { group: 8 } }), true);
    assert.equal(isMetalAtom({ name: 'C', properties: { group: 14 } }), false);
  });

  it('finds metal center ids in a molecule graph', () => {
    assert.deepEqual(findMetalCenterIds(makeOrganometallic()), ['ru']);
  });
});
