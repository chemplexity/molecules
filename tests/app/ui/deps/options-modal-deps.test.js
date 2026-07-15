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
        getLayoutBondLengthElement: () => 'layoutBondLength',
        getSelectionHighlightColorElement: () => 'selectionHighlightColor',
        getFunctionalGroupHighlightColorElement: () => 'functionalGroupHighlightColor',
        getPhysicochemicalHighlightColorElement: () => 'physicochemicalHighlightColor',
        get2DAtomColoringElement: () => 'atomColoring',
        get2DAtomFontSizeElement: () => 'fontSize',
        getAtomNumberingFontSizeElement: () => 'atomNumberingFontSize',
        get2DBondThicknessElement: () => 'bondThickness',
        getForceAtomSizeElement: () => 'forceAtomSize',
        getForceBondThicknessElement: () => 'forceBondThickness',
        getShowReactionReagentsElement: () => 'reactionReagents',
        getShowReactionConditionsElement: () => 'reactionConditions',
        getReactionFontSizeElement: () => 'reactionFontSize',
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
      navigation: {
        autoZoom: () => 'autoZoom',
        autoZoomAfterRender: () => 'autoZoomAfterRender'
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
    assert.equal(deps.dom.getLayoutBondLengthElement(), 'layoutBondLength');
    assert.equal(deps.dom.getSelectionHighlightColorElement(), 'selectionHighlightColor');
    assert.equal(deps.dom.getFunctionalGroupHighlightColorElement(), 'functionalGroupHighlightColor');
    assert.equal(deps.dom.getPhysicochemicalHighlightColorElement(), 'physicochemicalHighlightColor');
    assert.equal(deps.dom.getAtomNumberingFontSizeElement(), 'atomNumberingFontSize');
    assert.equal(deps.dom.getShowReactionReagentsElement(), 'reactionReagents');
    assert.equal(deps.dom.getShowReactionConditionsElement(), 'reactionConditions');
    assert.equal(deps.dom.getReactionFontSizeElement(), 'reactionFontSize');
    assert.equal(deps.options.getRenderOptions(), 'renderOptions');
    assert.deepEqual(deps.options.updateRenderOptions('x'), { next: 'x' });
    assert.equal(deps.state.getMode(), '2d');
    assert.equal(deps.state.getCurrentMol(), 'currentMol');
    assert.equal(deps.state.getMol2d(), 'mol2d');
    assert.equal(deps.state.getInputMode(), 'inchi');
    assert.equal(deps.state.getCurrentSmiles(), 'smiles');
    assert.equal(deps.state.getCurrentInchi(), 'inchi');
    assert.equal(deps.view.hideTooltip(), 'hidden');
    assert.equal(deps.navigation.autoZoom(), 'autoZoom');
    assert.equal(deps.navigation.autoZoomAfterRender(), 'autoZoomAfterRender');
    assert.equal(deps.renderers.draw2d(), 'draw2d');
    assert.equal(deps.renderers.render2d(), 'render2d');
    assert.equal(deps.renderers.renderMol(), 'renderMol');
    assert.deepEqual(deps.parsers.parseSMILES('CCO'), { smiles: 'CCO' });
    assert.deepEqual(deps.parsers.parseINCHI('InChI=1S/test'), { inchi: 'InChI=1S/test' });
  });
});
