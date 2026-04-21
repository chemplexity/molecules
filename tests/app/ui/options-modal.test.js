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
  it('opens with current values and applies updated 2d options through draw2d', () => {
    const calls = [];
    const overlayEl = makeOverlay();
    const docListeners = new Map();
    const showValenceWarningsEl = makeCheckbox();
    const showAtomTooltipsEl = makeCheckbox();
    const twoDAtomColoringEl = makeCheckbox();
    const twoDAtomFontSizeEl = makeInput();
    const atomNumberingFontSizeEl = makeInput();
    const bondEnFontSizeEl = makeInput();
    const bondLengthFontSizeEl = makeInput();
    const twoDBondThicknessEl = makeInput();
    const forceAtomSizeEl = makeInput();
    const forceBondThicknessEl = makeInput();
    const resetBtnEl = makeButton();
    const cancelBtnEl = makeButton();
    const applyBtnEl = makeButton();
    const currentOptions = {
      showValenceWarnings: true,
      showAtomTooltips: true,
      twoDColorStyle: 'color-atoms',
      twoDAtomFontSize: 14,
      atomNumberingFontSize: 10,
      bondEnFontSize: 10,
      bondLengthFontSize: 10,
      twoDBondThickness: 1.6,
      forceAtomSizeMultiplier: 1,
      forceBondThicknessMultiplier: 1
    };
    const defaultOptions = {
      ...currentOptions,
      twoDAtomFontSize: 18,
      atomNumberingFontSize: 12,
      bondEnFontSize: 11,
      bondLengthFontSize: 12
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
        get2DAtomColoringElement: () => twoDAtomColoringEl,
        get2DAtomFontSizeElement: () => twoDAtomFontSizeEl,
        getAtomNumberingFontSizeElement: () => atomNumberingFontSizeEl,
        getBondEnFontSizeElement: () => bondEnFontSizeEl,
        getBondLengthFontSizeElement: () => bondLengthFontSizeEl,
        get2DBondThicknessElement: () => twoDBondThicknessEl,
        getForceAtomSizeElement: () => forceAtomSizeEl,
        getForceBondThicknessElement: () => forceBondThicknessEl,
        getResetButtonElement: () => resetBtnEl,
        getCancelButtonElement: () => cancelBtnEl,
        getApplyButtonElement: () => applyBtnEl
      },
      options: {
        limits: {
          twoDAtomFontSize: { min: 10, max: 24 },
          atomNumberingFontSize: { min: 8, max: 24 },
          bondEnFontSize: { min: 8, max: 24 },
          bondLengthFontSize: { min: 8, max: 24 },
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
        getMol2d: () => ({ id: 'mol2d' })
      },
      view: {
        setFontSize: value => calls.push(['setFontSize', value]),
        hideTooltip: () => calls.push(['hideTooltip'])
      },
      renderers: {
        draw2d: () => calls.push(['draw2d']),
        render2d() {},
        renderMol() {},
        updateForce() {}
      },
      parsers: {}
    });

    modal.open();
    assert.equal(overlayEl.hidden, false);
    assert.equal(showValenceWarningsEl.checked, true);
    assert.equal(showAtomTooltipsEl.checked, true);
    assert.equal(twoDAtomFontSizeEl.value, '14');
    assert.equal(atomNumberingFontSizeEl.value, '10');
    assert.equal(bondEnFontSizeEl.value, '10');
    assert.equal(bondLengthFontSizeEl.value, '10');

    resetBtnEl.trigger('click');
    assert.equal(twoDAtomFontSizeEl.value, '18');
    assert.equal(atomNumberingFontSizeEl.value, '12');
    assert.equal(bondEnFontSizeEl.value, '11');
    assert.equal(bondLengthFontSizeEl.value, '12');

    showAtomTooltipsEl.checked = false;
    twoDAtomFontSizeEl.value = '30';
    atomNumberingFontSizeEl.value = '30';
    bondEnFontSizeEl.value = '30';
    bondLengthFontSizeEl.value = '30';
    applyBtnEl.trigger('click');

    assert.equal(overlayEl.hidden, true);
    assert.deepEqual(calls, [
      [
        'updateRenderOptions',
        {
          showValenceWarnings: true,
          showAtomTooltips: false,
          twoDColorStyle: 'color-atoms',
          twoDAtomFontSize: 24,
          atomNumberingFontSize: 24,
          bondEnFontSize: 24,
          bondLengthFontSize: 24,
          twoDBondThickness: 1.6,
          forceAtomSizeMultiplier: 1,
          forceBondThicknessMultiplier: 1
        }
      ],
      ['setFontSize', 24],
      ['hideTooltip'],
      ['draw2d']
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

  it('applies updated force-layout options through updateForce', () => {
    const calls = [];
    const overlayEl = makeOverlay();
    const showValenceWarningsEl = makeCheckbox(true);
    const showAtomTooltipsEl = makeCheckbox(true);
    const twoDAtomColoringEl = makeCheckbox(true);
    const twoDAtomFontSizeEl = makeInput('14');
    const atomNumberingFontSizeEl = makeInput('10');
    const bondEnFontSizeEl = makeInput('10');
    const bondLengthFontSizeEl = makeInput('10');
    const twoDBondThicknessEl = makeInput('1.6');
    const forceAtomSizeEl = makeInput('2.8');
    const forceBondThicknessEl = makeInput('0.4');
    const applyBtnEl = makeButton();
    const noopButton = makeButton();
    const currentMol = { id: 'force-mol' };
    const currentOptions = {
      showValenceWarnings: true,
      showAtomTooltips: true,
      twoDColorStyle: 'color-atoms',
      twoDAtomFontSize: 14,
      atomNumberingFontSize: 10,
      bondEnFontSize: 10,
      bondLengthFontSize: 10,
      twoDBondThickness: 1.6,
      forceAtomSizeMultiplier: 1,
      forceBondThicknessMultiplier: 1
    };

    const modal = initOptionsModal({
      doc: {
        addEventListener() {}
      },
      dom: {
        getOverlayElement: () => overlayEl,
        getShowValenceWarningsElement: () => showValenceWarningsEl,
        getShowAtomTooltipsElement: () => showAtomTooltipsEl,
        get2DAtomColoringElement: () => twoDAtomColoringEl,
        get2DAtomFontSizeElement: () => twoDAtomFontSizeEl,
        getAtomNumberingFontSizeElement: () => atomNumberingFontSizeEl,
        getBondEnFontSizeElement: () => bondEnFontSizeEl,
        getBondLengthFontSizeElement: () => bondLengthFontSizeEl,
        get2DBondThicknessElement: () => twoDBondThicknessEl,
        getForceAtomSizeElement: () => forceAtomSizeEl,
        getForceBondThicknessElement: () => forceBondThicknessEl,
        getResetButtonElement: () => noopButton,
        getCancelButtonElement: () => noopButton,
        getApplyButtonElement: () => applyBtnEl
      },
      options: {
        limits: {
          twoDAtomFontSize: { min: 10, max: 24 },
          atomNumberingFontSize: { min: 8, max: 24 },
          bondEnFontSize: { min: 8, max: 24 },
          bondLengthFontSize: { min: 8, max: 24 },
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
      renderers: {
        draw2d() {},
        render2d() {},
        renderMol() {},
        updateForce: (...args) => calls.push(['updateForce', ...args])
      },
      parsers: {}
    });

    modal.open();
    forceAtomSizeEl.value = '2.8';
    forceBondThicknessEl.value = '0.4';

    applyBtnEl.trigger('click');

    assert.deepEqual(calls, [
      [
        'updateRenderOptions',
        {
          showValenceWarnings: true,
          showAtomTooltips: true,
          twoDColorStyle: 'color-atoms',
          twoDAtomFontSize: 14,
          atomNumberingFontSize: 10,
          bondEnFontSize: 10,
          bondLengthFontSize: 10,
          twoDBondThickness: 1.6,
          forceAtomSizeMultiplier: 2.5,
          forceBondThicknessMultiplier: 0.5
        }
      ],
      ['setFontSize', 14],
      ['updateForce', currentMol, { preservePositions: true, preserveView: true }]
    ]);
  });
});
