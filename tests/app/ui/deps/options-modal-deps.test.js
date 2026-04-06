import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createOptionsModalDeps } from '../../../../src/app/ui/deps/options-modal-deps.js';

describe('createOptionsModalDeps', () => {
  it('builds the options modal dependency bridge from live callbacks', () => {
    const deps = createOptionsModalDeps({
      doc: { id: 'doc' },
      dom: {
        getOverlayElement: () => 'overlay',
        getShowValenceWarningsElement: () => 'valence',
        getShowAtomTooltipsElement: () => 'tooltips',
        getShowLonePairsElement: () => 'lonePairs',
        get2DAtomColoringElement: () => 'atomColoring',
        get2DAtomFontSizeElement: () => 'fontSize',
        get2DBondThicknessElement: () => 'bondThickness',
        getForceAtomSizeElement: () => 'forceAtomSize',
        getForceBondThicknessElement: () => 'forceBondThickness',
        getResetButtonElement: () => 'reset',
        getCancelButtonElement: () => 'cancel',
        getApplyButtonElement: () => 'apply'
      },
      options: {
        limits: { foo: 'bar' },
        getRenderOptions: () => 'renderOptions',
        getDefaultRenderOptions: () => 'defaultOptions',
        updateRenderOptions: next => ({ next })
      },
      state: {
        getMode: () => '2d',
        getCurrentMol: () => 'currentMol',
        getMol2d: () => 'mol2d'
      },
      view: {
        setFontSize: value => value,
        hideTooltip: () => 'hidden'
      },
      renderers: {
        draw2d: () => 'draw2d',
        updateForce: () => 'updateForce'
      }
    });

    assert.equal(deps.doc.id, 'doc');
    assert.equal(deps.dom.getOverlayElement(), 'overlay');
    assert.equal(deps.options.getRenderOptions(), 'renderOptions');
    assert.deepEqual(deps.options.updateRenderOptions('x'), { next: 'x' });
    assert.equal(deps.state.getMode(), '2d');
    assert.equal(deps.state.getCurrentMol(), 'currentMol');
    assert.equal(deps.state.getMol2d(), 'mol2d');
    assert.equal(deps.view.hideTooltip(), 'hidden');
    assert.equal(deps.renderers.draw2d(), 'draw2d');
  });
});
