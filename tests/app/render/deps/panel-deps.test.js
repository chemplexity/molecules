import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createAtomNumberingPanelDeps, createBondEnPanelDeps, createResonancePanelDeps } from '../../../../src/app/render/deps/panel-deps.js';

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

    assert.deepEqual(records, [['draw2d'], ['updateForce', 'mol', { preserveView: true }]]);
  });
});

describe('createResonancePanelDeps', () => {
  it('groups resonance panel wiring without changing behavior', () => {
    const records = [];
    const deps = createResonancePanelDeps({
      state: {
        getMode: () => 'force',
        getCurrentMol: () => 'current-mol',
        getMol2d: () => 'mol2d'
      },
      renderers: {
        draw2d: () => records.push(['draw2d']),
        render2d: (mol, options) => records.push(['render2d', mol, options]),
        updateForce: (mol, options) => records.push(['updateForce', mol, options])
      },
      view: {
        resetOrientation: () => records.push(['resetOrientation'])
      },
      force: {
        getNodes: () => [{ id: 'a1', x: 1, y: 2 }]
      },
      dom: {
        plotEl: { id: 'plot' }
      },
      overlays: {
        hasReactionPreview: () => true,
        restoreReactionPreviewSource: options => ({ restored: options })
      },
      history: {
        takeSnapshot: options => records.push(['takeSnapshot', options])
      }
    });

    assert.equal(deps.mode, 'force');
    assert.equal(deps.currentMol, 'current-mol');
    assert.equal(deps._mol2d, 'mol2d');
    assert.deepEqual(deps.plotEl, { id: 'plot' });
    assert.deepEqual(deps.getForceNodes(), [{ id: 'a1', x: 1, y: 2 }]);
    assert.equal(deps.hasReactionPreview(), true);
    assert.deepEqual(deps.restoreReactionPreviewSource({ restoreEntryZoom: true }), { restored: { restoreEntryZoom: true } });

    deps.resetOrientation();
    deps.updateForce('mol', { preserveView: true });
    deps.takeSnapshot({ clearReactionPreview: false });

    assert.deepEqual(records, [
      ['resetOrientation'],
      ['updateForce', 'mol', { preserveView: true }],
      ['takeSnapshot', { clearReactionPreview: false }]
    ]);
  });
});

describe('createAtomNumberingPanelDeps', () => {
  it('groups other-panel wiring including render options', () => {
    const records = [];
    const deps = createAtomNumberingPanelDeps({
      state: {
        getMode: () => '2d',
        getCurrentMol: () => 'current-mol',
        getMol2d: () => 'mol2d'
      },
      renderers: {
        draw2d: () => records.push(['draw2d']),
        updateForce: (mol, options) => records.push(['updateForce', mol, options])
      },
      options: {
        getRenderOptions: () => ({ showLonePairs: false }),
        updateRenderOptions: nextOptions => records.push(['updateRenderOptions', nextOptions])
      },
      overlays: {
        hasReactionPreview: () => true,
        getReactionPreviewMappedAtomPairs: () => [['r1', 'p1']],
        getReactionPreviewReactantAtomIds: () => new Set(['r1'])
      }
    });

    assert.equal(deps.mode, '2d');
    assert.equal(deps.currentMol, 'current-mol');
    assert.equal(deps._mol2d, 'mol2d');
    assert.deepEqual(deps.getRenderOptions(), { showLonePairs: false });
    assert.equal(deps.hasReactionPreview(), true);
    assert.deepEqual(deps.getReactionPreviewMappedAtomPairs(), [['r1', 'p1']]);
    assert.deepEqual([...deps.getReactionPreviewReactantAtomIds()], ['r1']);

    deps.draw2d();
    deps.updateRenderOptions({ showLonePairs: true });

    assert.deepEqual(records, [['draw2d'], ['updateRenderOptions', { showLonePairs: true }]]);
  });
});
