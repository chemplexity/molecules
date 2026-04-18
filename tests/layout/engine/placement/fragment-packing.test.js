import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { packComponentPlacements } from '../../../../src/layout/engine/placement/fragment-packing.js';

describe('layout/engine/placement/fragment-packing', () => {
  it('packs unanchored components to the right of anchored ones', () => {
    const packed = packComponentPlacements(
      [
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
      ],
      1.5
    );
    assert.deepEqual(packed.get('a0'), { x: 0, y: 0 });
    assert.ok(packed.get('b0').x > 0);
    assert.equal(packed.get('b0').y, 0);
  });

  it('can pack auxiliary fragments below the principal component when policy requests it', () => {
    const packed = packComponentPlacements(
      [
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
      ],
      1.5,
      { fragmentPackingMode: 'principal-below' }
    );

    assert.equal(packed.get('b0').x, 0);
    assert.ok(packed.get('b0').y < 0);
  });

  it('packs counter-ions before other auxiliary fragments on the chosen side', () => {
    const packed = packComponentPlacements(
      [
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
      ],
      1.5,
      { fragmentPackingMode: 'principal-right' }
    );

    assert.ok(packed.get('b0').x > packed.get('a0').x);
    assert.ok(packed.get('c0').x > packed.get('b0').x);
  });

  it('uses a charged metal counter-ion as the visual hub when balancing two oppositely charged fragments', () => {
    const packed = packComponentPlacements(
      [
        {
          componentId: 'anion-a',
          atomIds: ['a0', 'a1'],
          coords: new Map([
            ['a0', { x: 0, y: 0 }],
            ['a1', { x: 2, y: 0 }]
          ]),
          anchored: false,
          role: 'principal',
          heavyAtomCount: 9,
          netCharge: -1,
          containsMetal: false
        },
        {
          componentId: 'anion-b',
          atomIds: ['b0', 'b1'],
          coords: new Map([
            ['b0', { x: 0, y: 0 }],
            ['b1', { x: 2, y: 0 }]
          ]),
          anchored: false,
          role: 'spectator',
          heavyAtomCount: 9,
          netCharge: -1,
          containsMetal: false
        },
        {
          componentId: 'metal',
          atomIds: ['m0'],
          coords: new Map([['m0', { x: 0, y: 0 }]]),
          anchored: false,
          role: 'counter-ion',
          heavyAtomCount: 1,
          netCharge: 2,
          containsMetal: true
        }
      ],
      1.5,
      { fragmentPackingMode: 'principal-right' }
    );

    assert.deepEqual(packed.get('m0'), { x: 0, y: 0 });
    assert.ok(packed.get('a0').x > 0);
    assert.ok(packed.get('b1').x < 0);
  });

  it('does not overcount a principal fragment offset when packing a detached spectator to the right', () => {
    const packed = packComponentPlacements(
      [
        {
          componentId: 'principal',
          atomIds: ['a0', 'a1'],
          coords: new Map([
            ['a0', { x: -8, y: 0 }],
            ['a1', { x: 2, y: 0 }]
          ]),
          anchored: false,
          role: 'principal'
        },
        {
          componentId: 'spectator',
          atomIds: ['b0'],
          coords: new Map([['b0', { x: 0, y: 0 }]]),
          anchored: false,
          role: 'solvent-like'
        }
      ],
      1.5,
      { fragmentPackingMode: 'principal-right' }
    );

    assert.deepEqual(packed.get('a0'), { x: 0, y: 0 });
    assert.deepEqual(packed.get('a1'), { x: 10, y: 0 });
    assert.deepEqual(packed.get('b0'), { x: 13, y: 0 });
  });
});
