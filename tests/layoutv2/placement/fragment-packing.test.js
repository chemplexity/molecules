import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { packComponentPlacements } from '../../../src/layoutv2/placement/fragment-packing.js';

describe('layoutv2/placement/fragment-packing', () => {
  it('packs unanchored components to the right of anchored ones', () => {
    const packed = packComponentPlacements([
      {
        componentId: 'principal',
        atomIds: ['a0'],
        coords: new Map([['a0', { x: 0, y: 0 }]]),
        anchored: true,
        role: 'principal'
      },
      {
        componentId: 'spectator',
        atomIds: ['b0'],
        coords: new Map([['b0', { x: 0, y: 1 }]]),
        anchored: false,
        role: 'spectator'
      }
    ], 1.5);
    assert.deepEqual(packed.get('a0'), { x: 0, y: 0 });
    assert.ok(packed.get('b0').x > 0);
    assert.equal(packed.get('b0').y, 0);
  });

  it('can pack auxiliary fragments below the principal component when policy requests it', () => {
    const packed = packComponentPlacements([
      {
        componentId: 'principal',
        atomIds: ['a0', 'a1'],
        coords: new Map([
          ['a0', { x: 0, y: 0 }],
          ['a1', { x: 0.5, y: 4 }]
        ]),
        anchored: true,
        role: 'principal'
      },
      {
        componentId: 'spectator',
        atomIds: ['b0'],
        coords: new Map([['b0', { x: 0, y: 0 }]]),
        anchored: false,
        role: 'spectator'
      }
    ], 1.5, { fragmentPackingMode: 'principal-below' });

    assert.equal(packed.get('b0').x, 0);
    assert.ok(packed.get('b0').y < 0);
  });

  it('packs counter-ions before other auxiliary fragments on the chosen side', () => {
    const packed = packComponentPlacements([
      {
        componentId: 'principal',
        atomIds: ['a0'],
        coords: new Map([['a0', { x: 0, y: 0 }]]),
        anchored: false,
        role: 'principal'
      },
      {
        componentId: 'spectator',
        atomIds: ['c0'],
        coords: new Map([['c0', { x: 0, y: 0 }]]),
        anchored: false,
        role: 'spectator'
      },
      {
        componentId: 'counter',
        atomIds: ['b0'],
        coords: new Map([['b0', { x: 0, y: 0 }]]),
        anchored: false,
        role: 'counter-ion'
      }
    ], 1.5, { fragmentPackingMode: 'principal-right' });

    assert.ok(packed.get('b0').x > packed.get('a0').x);
    assert.ok(packed.get('c0').x > packed.get('b0').x);
  });
});
