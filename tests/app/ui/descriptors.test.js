import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseSMILES } from '../../../src/io/smiles.js';
import { topologicalDescriptorRows } from '../../../src/app/ui/descriptors.js';

describe('topologicalDescriptorRows', () => {
  it('includes every available topological index in the panel', () => {
    const rows = topologicalDescriptorRows(parseSMILES('CCCC'));
    const values = new Map(rows);

    for (const label of [
      'Atom-Bond Connectivity (ABC)',
      'Geometric-Arithmetic (GA)',
      'Harmonic Index',
      'Sum-Connectivity (χs)',
      'Eccentric Connectivity (ξ)',
      'Wiener Polarity (Wp)',
      'Schultz Index (MTI)',
      'Gutman Index (Gut)',
      'Forgotten Index (F₃)',
      'Narumi-Katayama (NK)',
      'Hosoya Index (Z)'
    ]) {
      assert.equal(values.has(label), true, `missing ${label}`);
      assert.equal(Number.isFinite(values.get(label)), true, `${label} should be finite`);
    }
  });

  it('skips the exponential Hosoya calculation above the panel safety limit', () => {
    const rows = topologicalDescriptorRows(parseSMILES('C'.repeat(19)));
    assert.equal(new Map(rows).get('Hosoya Index (Z)'), null);
  });
});
