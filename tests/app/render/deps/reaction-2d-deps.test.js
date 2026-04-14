import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createReaction2dDeps } from '../../../../src/app/render/deps/reaction-2d-deps.js';

describe('createReaction2dDeps', () => {
  it('groups reaction-preview panel wiring without changing behavior', () => {
    const records = [];
    const deps = createReaction2dDeps({
      g: { id: 'g' },
      plotEl: { id: 'plot' },
      state: {
        getMode: () => '2d',
        getCurrentMol: () => 'force-mol',
        getMol2d: () => 'mol2d'
      },
      renderers: {
        draw2d: () => records.push(['draw2d']),
        applyForceHighlights: () => records.push(['applyForceHighlights']),
        renderMol: (mol, options) => records.push(['renderMol', mol, options])
      },
      view: {
        captureZoomTransform: () => ({ x: 1, y: 2, k: 3 }),
        restoreZoomTransform: snapshot => records.push(['restoreZoomTransform', snapshot])
      },
      history: {
        captureAppSnapshot: options => ({ captured: options }),
        takeSnapshot: options => records.push(['takeSnapshot', options])
      }
    });

    assert.equal(deps.g.id, 'g');
    assert.equal(deps.plotEl.id, 'plot');
    assert.equal(deps.mode, '2d');
    assert.equal(deps.currentMol, 'force-mol');
    assert.equal(deps._mol2d, 'mol2d');
    assert.deepEqual(deps.captureAppSnapshot({ foo: 'bar' }), { captured: { foo: 'bar' } });
    assert.deepEqual(deps.captureZoomTransform(), { x: 1, y: 2, k: 3 });

    deps.draw2d();
    deps.restoreZoomTransform({ x: 0, y: 0, k: 1 });

    assert.deepEqual(records, [['draw2d'], ['restoreZoomTransform', { x: 0, y: 0, k: 1 }]]);
  });
});
