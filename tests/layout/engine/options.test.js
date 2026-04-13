import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLargeMoleculeThreshold, normalizeOptions } from '../../../src/layout/engine/options.js';

describe('layout/engine/options', () => {
  it('returns a normalized default option bag', () => {
    const options = normalizeOptions();
    assert.equal(options.bondLength, 1.5);
    assert.equal(options.suppressH, true);
    assert.equal(options.profile, 'organic-publication');
    assert.equal(options.fixedCoords instanceof Map, true);
    assert.equal(options.existingCoords instanceof Map, true);
    assert.equal(options.fixedCoords.size, 0);
    assert.equal(options.existingCoords.size, 0);
    assert.equal(options.timing, false);
    assert.equal(options.touchedAtoms, null);
    assert.equal(options.touchedBonds, null);
  });

  it('clones coordinate maps and touched-id sets', () => {
    const fixedCoords = new Map([['a0', { x: 1, y: 2 }]]);
    const existingCoords = new Map([['a1', { x: -1, y: 3 }]]);
    const touchedAtoms = new Set(['a0']);
    const touchedBonds = new Set(['b0']);
    const options = normalizeOptions({
      bondLength: 2,
      fixedCoords,
      existingCoords,
      touchedAtoms,
      touchedBonds,
      largeMoleculeThreshold: { heavyAtomCount: 200 }
    });

    assert.notEqual(options.fixedCoords, fixedCoords);
    assert.notEqual(options.existingCoords, existingCoords);
    assert.notEqual(options.touchedAtoms, touchedAtoms);
    assert.notEqual(options.touchedBonds, touchedBonds);
    assert.deepEqual(options.fixedCoords.get('a0'), { x: 1, y: 2 });
    assert.deepEqual(options.existingCoords.get('a1'), { x: -1, y: 3 });
    assert.deepEqual(options.largeMoleculeThreshold, {
      heavyAtomCount: 200,
      ringSystemCount: 10,
      blockCount: 16
    });

    fixedCoords.get('a0').x = 99;
    existingCoords.set('a2', { x: 0, y: 0 });
    touchedAtoms.add('a9');
    assert.deepEqual(options.fixedCoords.get('a0'), { x: 1, y: 2 });
    assert.equal(options.existingCoords.has('a2'), false);
    assert.equal(options.touchedAtoms.has('a9'), false);
  });

  it('normalizes the large-molecule thresholds independently', () => {
    assert.deepEqual(normalizeLargeMoleculeThreshold(), {
      heavyAtomCount: 120,
      ringSystemCount: 10,
      blockCount: 16
    });
    assert.deepEqual(normalizeLargeMoleculeThreshold({ ringSystemCount: 3 }), {
      heavyAtomCount: 120,
      ringSystemCount: 3,
      blockCount: 16
    });
  });

  it('rejects invalid option values', () => {
    assert.throws(() => normalizeOptions(null), TypeError);
    assert.throws(() => normalizeOptions({ bondLength: 0 }), RangeError);
    assert.throws(() => normalizeOptions({ fixedCoords: { a0: { x: 0, y: 0 } } }), TypeError);
    assert.throws(() => normalizeOptions({ existingCoords: new Map([['a0', { x: Infinity, y: 1 }]]) }), TypeError);
    assert.throws(() => normalizeOptions({ touchedAtoms: ['a0'] }), TypeError);
    assert.throws(() => normalizeOptions({ timing: 'yes' }), TypeError);
    assert.throws(() => normalizeLargeMoleculeThreshold({ heavyAtomCount: 0 }), RangeError);
  });
});
