import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Molecule } from '../../../../src/core/index.js';
import {
  buildRingConnections,
  classifyRingConnection,
  getRingConnection,
  isBridgedConnection,
  isFusedConnection,
  isSpiroConnection
} from '../../../../src/layout/engine/topology/ring-connections.js';
import { makeBridgedConnectionFixture, makeNaphthalene, makeSpiro } from '../support/molecules.js';

/**
 * Creates a fixture whose bridge path spans multiple non-ring atoms.
 * @returns {{molecule: Molecule, rings: {id: number, atomIds: string[]}[]}} Bridged connection fixture.
 */
function makeLongBridgeConnectionFixture() {
  const molecule = new Molecule();
  for (let index = 0; index < 12; index++) {
    molecule.addAtom(`a${index}`, 'C');
  }
  molecule.addBond('b0', 'a0', 'a2', {}, false);
  molecule.addBond('b1', 'a2', 'a3', {}, false);
  molecule.addBond('b2', 'a3', 'a1', {}, false);
  molecule.addBond('b3', 'a1', 'a6', {}, false);
  molecule.addBond('b4', 'a6', 'a7', {}, false);
  molecule.addBond('b5', 'a7', 'a8', {}, false);
  molecule.addBond('b6', 'a8', 'a0', {}, false);
  molecule.addBond('b7', 'a0', 'a4', {}, false);
  molecule.addBond('b8', 'a4', 'a5', {}, false);
  molecule.addBond('b9', 'a5', 'a1', {}, false);
  molecule.addBond('b10', 'a1', 'a9', {}, false);
  molecule.addBond('b11', 'a9', 'a10', {}, false);
  molecule.addBond('b12', 'a10', 'a11', {}, false);
  molecule.addBond('b13', 'a11', 'a0', {}, false);
  return {
    molecule,
    rings: [
      { id: 0, atomIds: ['a0', 'a2', 'a3', 'a1', 'a6', 'a7', 'a8'] },
      { id: 1, atomIds: ['a0', 'a4', 'a5', 'a1', 'a9', 'a10', 'a11'] }
    ]
  };
}

describe('layout/engine/topology/ring-connections', () => {
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

  it('classifies bridged connections when the bridge path spans multiple atoms', () => {
    const { molecule, rings } = makeLongBridgeConnectionFixture();
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
