import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCanonicalComponentSignature,
  buildCanonicalRingSignature,
  compareCanonicalAtomIds,
  computeCanonicalAtomRanks,
  sortAtomIdsCanonical
} from '../../../../src/layout/engine/topology/canonical-order.js';
import { makeBenzene, makeEthane } from '../support/molecules.js';

describe('layout/engine/topology/canonical-order', () => {
  it('computes heavy-atom ranks and omits hydrogens', () => {
    const molecule = makeEthane();
    molecule.addAtom('h0', 'H');
    molecule.addBond('bh0', 'a0', 'h0', {}, false);
    const ranks = computeCanonicalAtomRanks(molecule);
    assert.equal(ranks.has('h0'), false);
    assert.equal(ranks.size, 2);
    assert.deepEqual([...ranks.keys()].sort(), ['a0', 'a1']);
  });

  it('sorts atom IDs by canonical rank before lexical fallback', () => {
    const ranks = new Map([
      ['a2', 2],
      ['a0', 0],
      ['a1', 1]
    ]);
    assert.deepEqual(sortAtomIdsCanonical(['a2', 'h0', 'a1', 'a0'], ranks), ['a0', 'a1', 'a2', 'h0']);
    assert.ok(compareCanonicalAtomIds('a0', 'h0', ranks) < 0);
  });

  it('builds a ring signature that is invariant to rotation and reversal', () => {
    const ranks = new Map([
      ['a0', 2],
      ['a1', 0],
      ['a2', 1]
    ]);
    const first = buildCanonicalRingSignature(['a0', 'a1', 'a2'], ranks);
    const second = buildCanonicalRingSignature(['a1', 'a2', 'a0'], ranks);
    const third = buildCanonicalRingSignature(['a0', 'a2', 'a1'], ranks);
    assert.equal(first, second);
    assert.equal(first, third);
  });

  it('builds deterministic component signatures independent of input atom order', () => {
    const molecule = makeBenzene();
    const ranks = computeCanonicalAtomRanks(molecule);
    const first = buildCanonicalComponentSignature(['a5', 'a2', 'a0'], ranks, molecule);
    const second = buildCanonicalComponentSignature(['a0', 'a5', 'a2'], ranks, molecule);
    assert.equal(first, second);
  });
});
