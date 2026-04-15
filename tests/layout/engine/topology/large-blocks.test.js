import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { exceedsLargeComponentThreshold, exceedsLargeMoleculeThreshold } from '../../../../src/layout/engine/topology/large-blocks.js';

describe('layout/engine/topology/large-blocks', () => {
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

  it('detects chain-heavy mixed components below the raw heavy-atom cutoff', () => {
    const ringAtomIds = Array.from({ length: 30 }, (_, index) => `r${index}`);
    const chainAtomIds = Array.from({ length: 58 }, (_, index) => `c${index}`);
    const atomIds = [...ringAtomIds, ...chainAtomIds];
    const atoms = new Map(atomIds.map(atomId => [atomId, { id: atomId, name: 'C' }]));
    const layoutGraph = {
      options: {
        largeMoleculeThreshold: {
          heavyAtomCount: 120,
          ringSystemCount: 10,
          blockCount: 16
        }
      },
      sourceMolecule: { atoms },
      ringSystems: [
        { atomIds: ringAtomIds.slice(0, 6) },
        { atomIds: ringAtomIds.slice(6, 12) },
        { atomIds: ringAtomIds.slice(12, 18) },
        { atomIds: ringAtomIds.slice(18, 24) },
        { atomIds: ringAtomIds.slice(24, 30) }
      ]
    };
    const component = {
      atomIds,
      heavyAtomCount: atomIds.length
    };

    assert.equal(exceedsLargeComponentThreshold(layoutGraph, component), true);
  });
});
