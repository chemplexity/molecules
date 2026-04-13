import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { evaluateRingDependencyCorpus, inspectRingDependency } from '../../../../src/layout/engine/topology/ring-dependency.js';
import { makeAdamantane, makeBicyclo222, makeNaphthalene, makeNorbornane, makeSpiro, makeUnmatchedBridgedCage } from '../support/molecules.js';

describe('layout/engine/topology/ring-dependency', () => {
  it('reports the current adapter as adequate for a simple fused system', () => {
    const dependency = inspectRingDependency(makeNaphthalene());

    assert.equal(dependency.ok, true);
    assert.equal(dependency.requiresDedicatedRingEngine, false);
    assert.equal(dependency.suspiciousSystemCount, 0);
    assert.deepEqual(dependency.systems[0].connectionKinds, ['fused']);
  });

  it('can run the curated bridged and fused corpus checkpoint', () => {
    const result = evaluateRingDependencyCorpus([
      {
        id: 'naphthalene',
        molecule: makeNaphthalene(),
        expectedConnectionKinds: ['fused'],
        expectedRingCount: 2
      },
      {
        id: 'spiro',
        molecule: makeSpiro(),
        expectedConnectionKinds: ['spiro'],
        expectedRingCount: 2
      },
      {
        id: 'norbornane',
        molecule: makeNorbornane(),
        expectedConnectionKinds: ['bridged']
      },
      {
        id: 'bicyclo-2-2-2',
        molecule: makeBicyclo222(),
        expectedConnectionKinds: ['bridged']
      },
      {
        id: 'adamantane',
        molecule: makeAdamantane()
      },
      {
        id: 'unmatched-bridged-cage',
        molecule: makeUnmatchedBridgedCage()
      }
    ]);

    assert.equal(result.ok, true);
    assert.equal(result.mismatchCount, 0);
    assert.equal(result.requiresDedicatedRingEngine, false);
  });
});
