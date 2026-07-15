import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { initOptionsModal } from '../../../src/app/ui/options-modal.js';

function makeCheckbox(checked = false) {
  return { checked };
}

function makeInput(value = '') {
  return { value };
}

function makeButton() {
  const listeners = new Map();
  return {
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    trigger(type, event = {}) {
      listeners.get(type)?.(event);
    }
  };
}

function makeOverlay() {
  return {
    hidden: true,
    listeners: new Map(),
    addEventListener(type, handler) {
      this.listeners.set(type, handler);
    }
  };
}

describe('initOptionsModal', () => {
  it('opens with current values and reapplies changed 2d bond length through renderMol', () => {
    const calls = [];
    const overlayEl = makeOverlay();
    const docListeners = new Map();
    const showValenceWarningsEl = makeCheckbox();
    const showAtomTooltipsEl = makeCheckbox();
    const layoutBondLengthEl = makeInput();
    const selectionHighlightColorEl = makeInput();
    const functionalGroupHighlightColorEl = makeInput();
    const physicochemicalHighlightColorEl = makeInput();
    const twoDAtomColoringEl = makeCheckbox();
    const twoDAtomFontSizeEl = makeInput();
    const atomNumberingFontSizeEl = makeInput();
    const bondEnFontSizeEl = makeInput();
    const bondLengthFontSizeEl = makeInput();
    const twoDBondThicknessEl = makeInput();
    const forceAtomSizeEl = makeInput();
    const forceBondThicknessEl = makeInput();
    const showReactionReagentsEl = makeCheckbox();
    const showReactionConditionsEl = makeCheckbox();
    const reactionFontSizeEl = makeInput();
    const resetBtnEl = makeButton();
    const cancelBtnEl = makeButton();
    const applyBtnEl = makeButton();
    const mol2d = { id: 'mol2d' };
    const currentOptions = {
      showValenceWarnings: true,
      showAtomTooltips: true,
      layoutBondLength: 1.5,
      selectionHighlightColor: '#96c8ff',
      functionalGroupHighlightColor: '#82d250',
      physicochemicalHighlightColor: '#f6e36e',
      twoDColorStyle: 'color-atoms',
      twoDAtomFontSize: 14,
      atomNumberingFontSize: 10,
      bondEnFontSize: 10,
      bondLengthFontSize: 10,
      twoDBondThickness: 1.8,
      forceAtomSizeMultiplier: 1,
      forceBondThicknessMultiplier: 1,
      showReactionReagents: true,
      showReactionConditions: false,
      reactionFontSize: 14
    };
    const defaultOptions = {
      ...currentOptions,
      twoDAtomFontSize: 18,
      layoutBondLength: 1.7,
      selectionHighlightColor: '#111111',
      functionalGroupHighlightColor: '#222222',
      physicochemicalHighlightColor: '#333333',
      atomNumberingFontSize: 12,
      bondEnFontSize: 11,
      bondLengthFontSize: 12,
      reactionFontSize: 16
    };

    const modal = initOptionsModal({
      doc: {
        addEventListener(type, handler) {
          docListeners.set(type, handler);
        }
      },
      dom: {
        getOverlayElement: () => overlayEl,
        getShowValenceWarningsElement: () => showValenceWarningsEl,
        getShowAtomTooltipsElement: () => showAtomTooltipsEl,
        getLayoutBondLengthElement: () => layoutBondLengthEl,
        getSelectionHighlightColorElement: () => selectionHighlightColorEl,
        getFunctionalGroupHighlightColorElement: () => functionalGroupHighlightColorEl,
        getPhysicochemicalHighlightColorElement: () => physicochemicalHighlightColorEl,
        get2DAtomColoringElement: () => twoDAtomColoringEl,
        get2DAtomFontSizeElement: () => twoDAtomFontSizeEl,
        getAtomNumberingFontSizeElement: () => atomNumberingFontSizeEl,
        getBondEnFontSizeElement: () => bondEnFontSizeEl,
        getBondLengthFontSizeElement: () => bondLengthFontSizeEl,
        get2DBondThicknessElement: () => twoDBondThicknessEl,
        getForceAtomSizeElement: () => forceAtomSizeEl,
        getForceBondThicknessElement: () => forceBondThicknessEl,
        getShowReactionReagentsElement: () => showReactionReagentsEl,
        getShowReactionConditionsElement: () => showReactionConditionsEl,
        getReactionFontSizeElement: () => reactionFontSizeEl,
        getResetButtonElement: () => resetBtnEl,
        getCancelButtonElement: () => cancelBtnEl,
        getApplyButtonElement: () => applyBtnEl
      },
      options: {
        limits: {
          layoutBondLength: { min: 0.5, max: 3 },
          twoDAtomFontSize: { min: 10, max: 24 },
          atomNumberingFontSize: { min: 8, max: 24 },
          bondEnFontSize: { min: 8, max: 24 },
          bondLengthFontSize: { min: 8, max: 24 },
          reactionFontSize: { min: 8, max: 24 },
          twoDBondThickness: { min: 0.8, max: 4 },
          forceAtomSizeMultiplier: { min: 0.5, max: 2.5 },
          forceBondThicknessMultiplier: { min: 0.5, max: 2.5 }
        },
        getRenderOptions: () => currentOptions,
        getDefaultRenderOptions: () => defaultOptions,
        updateRenderOptions: nextOptions => {
          calls.push(['updateRenderOptions', nextOptions]);
          return { ...currentOptions, ...nextOptions };
        }
      },
      state: {
        getMode: () => '2d',
        getCurrentMol: () => null,
        getMol2d: () => mol2d
      },
      view: {
        setFontSize: value => calls.push(['setFontSize', value]),
        hideTooltip: () => calls.push(['hideTooltip'])
      },
      navigation: {
        autoZoom: () => calls.push(['autoZoom']),
        autoZoomAfterRender: () => calls.push(['autoZoomAfterRender'])
      },
      renderers: {
        draw2d: () => calls.push(['draw2d']),
        render2d: mol => calls.push(['render2d', mol]),
        renderMol: (mol, options = {}) => calls.push(['renderMol', mol, options]),
        updateForce() {}
      },
      parsers: {}
    });

    modal.open();
    assert.equal(overlayEl.hidden, false);
    assert.equal(showValenceWarningsEl.checked, true);
    assert.equal(showAtomTooltipsEl.checked, true);
    assert.equal(layoutBondLengthEl.value, '1.5');
    assert.equal(selectionHighlightColorEl.value, '#96c8ff');
    assert.equal(functionalGroupHighlightColorEl.value, '#82d250');
    assert.equal(physicochemicalHighlightColorEl.value, '#f6e36e');
    assert.equal(twoDAtomFontSizeEl.value, '14');
    assert.equal(atomNumberingFontSizeEl.value, '10');
    assert.equal(bondEnFontSizeEl.value, '10');
    assert.equal(bondLengthFontSizeEl.value, '10');
    assert.equal(showReactionReagentsEl.checked, true);
    assert.equal(showReactionConditionsEl.checked, false);
    assert.equal(reactionFontSizeEl.value, '14');

    resetBtnEl.trigger('click');
    assert.equal(layoutBondLengthEl.value, '1.7');
    assert.equal(selectionHighlightColorEl.value, '#111111');
    assert.equal(functionalGroupHighlightColorEl.value, '#222222');
    assert.equal(physicochemicalHighlightColorEl.value, '#333333');
    assert.equal(twoDAtomFontSizeEl.value, '18');
    assert.equal(atomNumberingFontSizeEl.value, '12');
    assert.equal(bondEnFontSizeEl.value, '11');
    assert.equal(bondLengthFontSizeEl.value, '12');
    assert.equal(reactionFontSizeEl.value, '16');

    showAtomTooltipsEl.checked = false;
    showReactionReagentsEl.checked = false;
    showReactionConditionsEl.checked = true;
    layoutBondLengthEl.value = '3';
    twoDAtomFontSizeEl.value = '30';
    atomNumberingFontSizeEl.value = '30';
    bondEnFontSizeEl.value = '30';
    bondLengthFontSizeEl.value = '30';
    reactionFontSizeEl.value = '30';
    applyBtnEl.trigger('click');

    assert.equal(overlayEl.hidden, true);
    assert.deepEqual(calls, [
      [
        'updateRenderOptions',
        {
          showValenceWarnings: true,
          showAtomTooltips: false,
          layoutBondLength: 3,
          selectionHighlightColor: '#111111',
          functionalGroupHighlightColor: '#222222',
          physicochemicalHighlightColor: '#333333',
          twoDColorStyle: 'color-atoms',
          twoDAtomFontSize: 24,
          atomNumberingFontSize: 24,
          bondEnFontSize: 24,
          bondLengthFontSize: 24,
          twoDBondThickness: 1.8,
          forceAtomSizeMultiplier: 1,
          forceBondThicknessMultiplier: 1,
          showReactionReagents: false,
          showReactionConditions: true,
          reactionFontSize: 24
        }
      ],
      ['setFontSize', 24],
      ['hideTooltip'],
      ['renderMol', mol2d, { preserveHistory: true }],
      ['autoZoom']
    ]);

    modal.open();
    cancelBtnEl.trigger('click');
    assert.equal(overlayEl.hidden, true);

    modal.open();
    overlayEl.listeners.get('mousedown')({ target: overlayEl });
    assert.equal(overlayEl.hidden, true);

    modal.open();
    docListeners.get('keydown')({ key: 'Escape' });
    assert.equal(overlayEl.hidden, true);
  });

  it('applies changes when Enter is pressed while the modal is open', () => {
    const calls = [];
    const overlayEl = makeOverlay();
    const docListeners = new Map();
    const showValenceWarningsEl = makeCheckbox(true);
    const showAtomTooltipsEl = makeCheckbox(true);
    const layoutBondLengthEl = makeInput('1.5');
    const selectionHighlightColorEl = makeInput('#96c8ff');
    const functionalGroupHighlightColorEl = makeInput('#82d250');
    const physicochemicalHighlightColorEl = makeInput('#f6e36e');
    const twoDAtomColoringEl = makeInput('color-atoms');
    const twoDAtomFontSizeEl = makeInput('14');
    const atomNumberingFontSizeEl = makeInput('10');
    const bondEnFontSizeEl = makeInput('10');
    const bondLengthFontSizeEl = makeInput('10');
    const twoDBondThicknessEl = makeInput('1.8');
    const forceAtomSizeEl = makeInput('1');
    const forceBondThicknessEl = makeInput('1');
    const showReactionReagentsEl = makeCheckbox(true);
    const showReactionConditionsEl = makeCheckbox(false);
    const reactionFontSizeEl = makeInput('14');
    const noopButton = makeButton();
    const enterEvent = {
      key: 'Enter',
      preventDefault() {
        calls.push(['preventDefault']);
      }
    };

    initOptionsModal({
      doc: {
        addEventListener(type, handler) {
          docListeners.set(type, handler);
        }
      },
      dom: {
        getOverlayElement: () => overlayEl,
        getShowValenceWarningsElement: () => showValenceWarningsEl,
        getShowAtomTooltipsElement: () => showAtomTooltipsEl,
        getLayoutBondLengthElement: () => layoutBondLengthEl,
        getSelectionHighlightColorElement: () => selectionHighlightColorEl,
        getFunctionalGroupHighlightColorElement: () => functionalGroupHighlightColorEl,
        getPhysicochemicalHighlightColorElement: () => physicochemicalHighlightColorEl,
        get2DAtomColoringElement: () => twoDAtomColoringEl,
        get2DAtomFontSizeElement: () => twoDAtomFontSizeEl,
        getAtomNumberingFontSizeElement: () => atomNumberingFontSizeEl,
        getBondEnFontSizeElement: () => bondEnFontSizeEl,
        getBondLengthFontSizeElement: () => bondLengthFontSizeEl,
        get2DBondThicknessElement: () => twoDBondThicknessEl,
        getForceAtomSizeElement: () => forceAtomSizeEl,
        getForceBondThicknessElement: () => forceBondThicknessEl,
        getShowReactionReagentsElement: () => showReactionReagentsEl,
        getShowReactionConditionsElement: () => showReactionConditionsEl,
        getReactionFontSizeElement: () => reactionFontSizeEl,
        getResetButtonElement: () => noopButton,
        getCancelButtonElement: () => noopButton,
        getApplyButtonElement: () => noopButton
      },
      options: {
        limits: {
          layoutBondLength: { min: 0.5, max: 3 },
          twoDAtomFontSize: { min: 10, max: 24 },
          atomNumberingFontSize: { min: 8, max: 24 },
          bondEnFontSize: { min: 8, max: 24 },
          bondLengthFontSize: { min: 8, max: 24 },
          reactionFontSize: { min: 8, max: 24 },
          twoDBondThickness: { min: 0.8, max: 4 },
          forceAtomSizeMultiplier: { min: 0.5, max: 2.5 },
          forceBondThicknessMultiplier: { min: 0.5, max: 2.5 }
        },
        getRenderOptions: () => ({
          showValenceWarnings: true,
          showAtomTooltips: true,
          layoutBondLength: 1.5,
          selectionHighlightColor: '#96c8ff',
          functionalGroupHighlightColor: '#82d250',
          physicochemicalHighlightColor: '#f6e36e',
          twoDColorStyle: 'color-atoms',
          twoDAtomFontSize: 14,
          atomNumberingFontSize: 10,
          bondEnFontSize: 10,
          bondLengthFontSize: 10,
          twoDBondThickness: 1.8,
          forceAtomSizeMultiplier: 1,
          forceBondThicknessMultiplier: 1,
          showReactionReagents: true,
          showReactionConditions: false,
          reactionFontSize: 14
        }),
        getDefaultRenderOptions() {},
        updateRenderOptions: nextOptions => {
          calls.push(['updateRenderOptions', nextOptions]);
          return nextOptions;
        }
      },
      state: {
        getMode: () => '2d',
        getCurrentMol: () => null,
        getMol2d: () => ({ id: 'mol2d' })
      },
      view: {
        setFontSize: value => calls.push(['setFontSize', value]),
        hideTooltip() {}
      },
      navigation: {},
      renderers: {
        draw2d: () => calls.push(['draw2d']),
        renderMol() {},
        updateForce() {}
      },
      parsers: {}
    }).open();

    twoDAtomFontSizeEl.value = '18';
    docListeners.get('keydown')(enterEvent);

    assert.equal(overlayEl.hidden, true);
    assert.equal(calls[0][0], 'preventDefault');
    assert.equal(calls[1][0], 'updateRenderOptions');
    assert.equal(calls[1][1].twoDAtomFontSize, 18);
    assert.deepEqual(calls.slice(2), [['setFontSize', 18], ['draw2d']]);

    docListeners.get('keydown')({ key: 'Enter', preventDefault: () => calls.push(['hiddenPreventDefault']) });
    assert.equal(
      calls.some(call => call[0] === 'hiddenPreventDefault'),
      false
    );
  });

  it('applies updated force-layout options through updateForce', () => {
    const calls = [];
    const overlayEl = makeOverlay();
    const showValenceWarningsEl = makeCheckbox(true);
    const showAtomTooltipsEl = makeCheckbox(true);
    const layoutBondLengthEl = makeInput('1.5');
    const selectionHighlightColorEl = makeInput('#96c8ff');
    const functionalGroupHighlightColorEl = makeInput('#82d250');
    const physicochemicalHighlightColorEl = makeInput('#f6e36e');
    const twoDAtomColoringEl = makeCheckbox(true);
    const twoDAtomFontSizeEl = makeInput('14');
    const atomNumberingFontSizeEl = makeInput('10');
    const bondEnFontSizeEl = makeInput('10');
    const bondLengthFontSizeEl = makeInput('10');
    const twoDBondThicknessEl = makeInput('1.8');
    const forceAtomSizeEl = makeInput('2.8');
    const forceBondThicknessEl = makeInput('0.4');
    const showReactionReagentsEl = makeCheckbox(false);
    const showReactionConditionsEl = makeCheckbox(true);
    const reactionFontSizeEl = makeInput('14');
    const applyBtnEl = makeButton();
    const noopButton = makeButton();
    const currentMol = { id: 'force-mol' };
    const currentOptions = {
      showValenceWarnings: true,
      showAtomTooltips: true,
      layoutBondLength: 1.5,
      selectionHighlightColor: '#96c8ff',
      functionalGroupHighlightColor: '#82d250',
      physicochemicalHighlightColor: '#f6e36e',
      twoDColorStyle: 'color-atoms',
      twoDAtomFontSize: 14,
      atomNumberingFontSize: 10,
      bondEnFontSize: 10,
      bondLengthFontSize: 10,
      twoDBondThickness: 1.8,
      forceAtomSizeMultiplier: 1,
      forceBondThicknessMultiplier: 1,
      showReactionReagents: true,
      showReactionConditions: false,
      reactionFontSize: 14
    };

    const modal = initOptionsModal({
      doc: {
        addEventListener() {}
      },
      dom: {
        getOverlayElement: () => overlayEl,
        getShowValenceWarningsElement: () => showValenceWarningsEl,
        getShowAtomTooltipsElement: () => showAtomTooltipsEl,
        getLayoutBondLengthElement: () => layoutBondLengthEl,
        getSelectionHighlightColorElement: () => selectionHighlightColorEl,
        getFunctionalGroupHighlightColorElement: () => functionalGroupHighlightColorEl,
        getPhysicochemicalHighlightColorElement: () => physicochemicalHighlightColorEl,
        get2DAtomColoringElement: () => twoDAtomColoringEl,
        get2DAtomFontSizeElement: () => twoDAtomFontSizeEl,
        getAtomNumberingFontSizeElement: () => atomNumberingFontSizeEl,
        getBondEnFontSizeElement: () => bondEnFontSizeEl,
        getBondLengthFontSizeElement: () => bondLengthFontSizeEl,
        get2DBondThicknessElement: () => twoDBondThicknessEl,
        getForceAtomSizeElement: () => forceAtomSizeEl,
        getForceBondThicknessElement: () => forceBondThicknessEl,
        getShowReactionReagentsElement: () => showReactionReagentsEl,
        getShowReactionConditionsElement: () => showReactionConditionsEl,
        getReactionFontSizeElement: () => reactionFontSizeEl,
        getResetButtonElement: () => noopButton,
        getCancelButtonElement: () => noopButton,
        getApplyButtonElement: () => applyBtnEl
      },
      options: {
        limits: {
          layoutBondLength: { min: 0.5, max: 3 },
          twoDAtomFontSize: { min: 10, max: 24 },
          atomNumberingFontSize: { min: 8, max: 24 },
          bondEnFontSize: { min: 8, max: 24 },
          bondLengthFontSize: { min: 8, max: 24 },
          reactionFontSize: { min: 8, max: 24 },
          twoDBondThickness: { min: 0.8, max: 4 },
          forceAtomSizeMultiplier: { min: 0.5, max: 2.5 },
          forceBondThicknessMultiplier: { min: 0.5, max: 2.5 }
        },
        getRenderOptions: () => currentOptions,
        getDefaultRenderOptions: () => currentOptions,
        updateRenderOptions: nextOptions => {
          calls.push(['updateRenderOptions', nextOptions]);
          return { ...currentOptions, ...nextOptions };
        }
      },
      state: {
        getMode: () => 'force',
        getCurrentMol: () => currentMol,
        getMol2d: () => null
      },
      view: {
        setFontSize: value => calls.push(['setFontSize', value]),
        hideTooltip() {}
      },
      navigation: {
        autoZoom: () => calls.push(['autoZoom']),
        autoZoomAfterRender: () => calls.push(['autoZoomAfterRender'])
      },
      renderers: {
        draw2d() {},
        render2d() {},
        renderMol() {},
        updateForce: (...args) => calls.push(['updateForce', ...args])
      },
      parsers: {}
    });

    modal.open();
    layoutBondLengthEl.value = '2';
    forceAtomSizeEl.value = '2.8';
    forceBondThicknessEl.value = '0.4';
    reactionFontSizeEl.value = '6';
    showReactionReagentsEl.checked = false;
    showReactionConditionsEl.checked = true;

    applyBtnEl.trigger('click');

    assert.deepEqual(calls, [
      [
        'updateRenderOptions',
        {
          showValenceWarnings: true,
          showAtomTooltips: true,
          layoutBondLength: 2,
          selectionHighlightColor: '#96c8ff',
          functionalGroupHighlightColor: '#82d250',
          physicochemicalHighlightColor: '#f6e36e',
          twoDColorStyle: 'color-atoms',
          twoDAtomFontSize: 14,
          atomNumberingFontSize: 10,
          bondEnFontSize: 10,
          bondLengthFontSize: 10,
          twoDBondThickness: 1.8,
          forceAtomSizeMultiplier: 2.5,
          forceBondThicknessMultiplier: 0.5,
          showReactionReagents: false,
          showReactionConditions: true,
          reactionFontSize: 8
        }
      ],
      ['setFontSize', 14],
      ['updateForce', currentMol, { preservePositions: false, preserveView: false }],
      ['autoZoom'],
      ['autoZoomAfterRender']
    ]);
  });
});
