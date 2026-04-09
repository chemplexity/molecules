import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { atomColor, formatChargeLabel } from '../../src/layoutv2/render-helpers.js';

describe('layoutv2/render-helpers', () => {
  it('uses the subdued metallic palette for selected metals', () => {
    assert.equal(atomColor('Mg'), '#5E636B');
    assert.equal(atomColor('Ag'), '#C0C0C0');
    assert.equal(atomColor('Au'), '#D4AF37');
    assert.equal(atomColor('Pt'), '#C9CDD2');
    assert.equal(atomColor('Hg'), '#B8C3CF');
  });

  it('formats positive and negative charge labels for display', () => {
    assert.equal(formatChargeLabel(0), '');
    assert.equal(formatChargeLabel(1), '+');
    assert.equal(formatChargeLabel(2), '2+');
    assert.equal(formatChargeLabel(-1), '−');
    assert.equal(formatChargeLabel(-2), '2−');
  });
});
