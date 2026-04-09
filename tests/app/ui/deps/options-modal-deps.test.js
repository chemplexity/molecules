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
        get2DRendererVersionElement: () => 'rendererVersion',
        get2DAtomColoringElement: () => 'atomColoring',
        get2DAtomFontSizeElement: () => 'fontSize',
        getAtomNumberingFontSizeElement: () => 'atomNumberingFontSize',
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
        getMol2d: () => 'mol2d',
        getInputMode: () => 'inchi',
        getCurrentSmiles: () => 'smiles',
        getCurrentInchi: () => 'inchi'
      },
      view: {
        setFontSize: value => value,
        hideTooltip: () => 'hidden'
      },
      renderers: {
        draw2d: () => 'draw2d',
        render2d: () => 'render2d',
        renderMol: () => 'renderMol',
        updateForce: () => 'updateForce'
      },
      parsers: {
        parseSMILES: value => ({ smiles: value }),
        parseINCHI: value => ({ inchi: value })
      }
    });

    assert.equal(deps.doc.id, 'doc');
    assert.equal(deps.dom.getOverlayElement(), 'overlay');
    assert.equal(deps.dom.get2DRendererVersionElement(), 'rendererVersion');
    assert.equal(deps.dom.getAtomNumberingFontSizeElement(), 'atomNumberingFontSize');
    assert.equal(deps.options.getRenderOptions(), 'renderOptions');
    assert.deepEqual(deps.options.updateRenderOptions('x'), { next: 'x' });
    assert.equal(deps.state.getMode(), '2d');
    assert.equal(deps.state.getCurrentMol(), 'currentMol');
    assert.equal(deps.state.getMol2d(), 'mol2d');
    assert.equal(deps.state.getInputMode(), 'inchi');
    assert.equal(deps.state.getCurrentSmiles(), 'smiles');
    assert.equal(deps.state.getCurrentInchi(), 'inchi');
    assert.equal(deps.view.hideTooltip(), 'hidden');
    assert.equal(deps.renderers.draw2d(), 'draw2d');
    assert.equal(deps.renderers.render2d(), 'render2d');
    assert.equal(deps.renderers.renderMol(), 'renderMol');
    assert.deepEqual(deps.parsers.parseSMILES('CCO'), { smiles: 'CCO' });
    assert.deepEqual(deps.parsers.parseINCHI('InChI=1S/test'), { inchi: 'InChI=1S/test' });
  });
});
