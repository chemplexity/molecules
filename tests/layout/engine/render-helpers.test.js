import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseSMILES } from '../../../src/io/smiles.js';
import { atomColor, formatChargeLabel, kekulize } from '../../../src/layout/engine/render-helpers.js';

describe('layout/engine/render-helpers', () => {
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

  it('localizes fluorene aromatic bonds without turning the bridge into an exocyclic double', () => {
    const molecule = parseSMILES('c1ccc2c(c1)Cc1ccccc1-2');
    kekulize(molecule);

    const bridgeBond = [...molecule.bonds.values()].find(bond => {
      const atomIds = [...bond.atoms].sort();
      return atomIds[0] === 'C13' && atomIds[1] === 'C4';
    });
    assert.ok(bridgeBond, 'expected fluorene bridge bond');
    assert.equal(bridgeBond.properties.order, 1);
    assert.equal(bridgeBond.properties.aromatic ?? false, false);

    const localizedDoubleCount = [...molecule.bonds.values()].filter(bond => (bond.properties.aromatic ?? false) && bond.properties.localizedOrder === 2).length;
    assert.equal(localizedDoubleCount, 6);
  });
});
