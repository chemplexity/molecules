import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRingConnections,
  classifyRingConnection,
  getRingConnection,
  isBridgedConnection,
  isFusedConnection,
  isSpiroConnection
} from '../../../src/layoutv2/topology/ring-connections.js';
import { makeBridgedConnectionFixture, makeNaphthalene, makeSpiro } from '../support/molecules.js';

describe('layoutv2/topology/ring-connections', () => {
  it('classifies shared-atom counts as spiro or fused where appropriate', () => {
    assert.equal(isSpiroConnection(['a4']), true);
    assert.equal(isFusedConnection(['a4', 'a5']), true);
    assert.equal(isFusedConnection(['a4']), false);
  });

  it('classifies a fused naphthalene connection', () => {
    const molecule = makeNaphthalene();
    const rings = [
      { id: 0, atomIds: ['a0', 'a1', 'a2', 'a3', 'a4', 'a5'] },
      { id: 1, atomIds: ['a4', 'a5', 'a9', 'a8', 'a7', 'a6'] }
    ];
    assert.equal(classifyRingConnection(molecule, rings, 0, 1), 'fused');
  });

  it('classifies a spiro connection', () => {
    const molecule = makeSpiro();
    const rings = [
      { id: 0, atomIds: ['a0', 'a1', 'a2', 'a3', 'a4'] },
      { id: 1, atomIds: ['a4', 'a5', 'a6', 'a7', 'a8'] }
    ];
    assert.equal(classifyRingConnection(molecule, rings, 0, 1), 'spiro');
  });

  it('classifies a bridged connection when the shared pair has an interior common neighbor', () => {
    const { molecule, rings } = makeBridgedConnectionFixture();
    const sharedAtomIds = ['a0', 'a1'];
    assert.equal(isBridgedConnection(molecule, rings, 0, 1, sharedAtomIds), true);
    assert.equal(classifyRingConnection(molecule, rings, 0, 1, sharedAtomIds), 'bridged');
  });

  it('builds pair-indexed connection descriptors', () => {
    const molecule = makeNaphthalene();
    const rings = [
      { id: 0, atomIds: ['a0', 'a1', 'a2', 'a3', 'a4', 'a5'] },
      { id: 1, atomIds: ['a4', 'a5', 'a9', 'a8', 'a7', 'a6'] }
    ];
    const result = buildRingConnections(molecule, rings);
    assert.equal(result.connections.length, 1);
    assert.deepEqual(result.ringAdj.get(0), [1]);
    assert.deepEqual(result.ringAdj.get(1), [0]);
    assert.equal(getRingConnection(result.connectionByPair, 0, 1)?.kind, 'fused');
  });
});
