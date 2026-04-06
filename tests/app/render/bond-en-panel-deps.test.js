import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createBondEnPanelDeps } from '../../../src/app/render/bond-en-panel-deps.js';

describe('createBondEnPanelDeps', () => {
  it('groups bond electronegativity panel wiring without changing behavior', () => {
    const records = [];
    const deps = createBondEnPanelDeps({
      state: {
        getMode: () => '2d',
        getCurrentMol: () => 'current-mol',
        getMol2d: () => 'mol2d'
      },
      renderers: {
        draw2d: () => records.push(['draw2d']),
        updateForce: (mol, options) => records.push(['updateForce', mol, options])
      }
    });

    assert.equal(deps.mode, '2d');
    assert.equal(deps.currentMol, 'current-mol');
    assert.equal(deps._mol2d, 'mol2d');

    deps.draw2d();
    deps.updateForce('mol', { preserveView: true });

    assert.deepEqual(records, [
      ['draw2d'],
      ['updateForce', 'mol', { preserveView: true }]
    ]);
  });
});
