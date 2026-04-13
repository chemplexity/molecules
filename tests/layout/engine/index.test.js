import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as layout from '../../../src/layout/engine/index.js';

describe('layout/engine/index', () => {
  it('re-exports the milestone-1 public surface', () => {
    assert.equal(typeof layout.generateCoords, 'function');
    assert.equal(typeof layout.refineCoords, 'function');
    assert.equal(typeof layout.applyCoords, 'function');
    assert.equal(typeof layout.renderMolSVG, 'function');
    assert.equal(typeof layout.createLayoutGraph, 'function');
    assert.equal(typeof layout.runPipeline, 'function');
    assert.equal(typeof layout.computeCanonicalAtomRanks, 'function');
    assert.ok(layout.LAYOUT_PROFILES.includes('organometallic'));
    assert.equal(layout.DEFAULT_BOND_LENGTH, 1.5);
  });
});
