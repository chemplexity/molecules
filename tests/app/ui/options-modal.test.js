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

describe('initOptionsModal', () => {
  it('opens with current option values and applies updated options through the active renderer', () => {
    const calls = [];
    const overlayEl = {
      hidden: true,
      listeners: new Map(),
      addEventListener(type, handler) {
        this.listeners.set(type, handler);
      }
    };
    const docListeners = new Map();
    const currentOptions = {
      showValenceWarnings: true,
      showAtomTooltips: true,
      showLonePairs: false,
      twoDAtomColoring: true,
      twoDAtomFontSize: 14,
      twoDBondThickness: 1.6,
      forceAtomSizeMultiplier: 1,
      forceBondThicknessMultiplier: 1
    };
    const defaultOptions = {
      ...currentOptions,
      showLonePairs: true,
      twoDAtomFontSize: 18
    };

    const showValenceWarningsEl = makeCheckbox();
    const showAtomTooltipsEl = makeCheckbox();
    const showLonePairsEl = makeCheckbox();
    const twoDAtomColoringEl = makeCheckbox();
    const twoDAtomFontSizeEl = makeInput();
    const twoDBondThicknessEl = makeInput();
    const forceAtomSizeEl = makeInput();
    const forceBondThicknessEl = makeInput();
    const resetBtnEl = makeButton();
    const cancelBtnEl = makeButton();
    const applyBtnEl = makeButton();

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
        getShowLonePairsElement: () => showLonePairsEl,
        get2DAtomColoringElement: () => twoDAtomColoringEl,
        get2DAtomFontSizeElement: () => twoDAtomFontSizeEl,
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
        updateForce: (...args) => calls.push(['updateForce', ...args])
      }
    });

    modal.open();
    assert.equal(overlayEl.hidden, false);
    assert.equal(showValenceWarningsEl.checked, true);
    assert.equal(showAtomTooltipsEl.checked, true);
    assert.equal(showLonePairsEl.checked, false);
    assert.equal(twoDAtomFontSizeEl.value, '14');

    resetBtnEl.trigger('click');
    assert.equal(showLonePairsEl.checked, true);
    assert.equal(twoDAtomFontSizeEl.value, '18');

    showAtomTooltipsEl.checked = false;
    twoDAtomFontSizeEl.value = '30';
    applyBtnEl.trigger('click');

    assert.equal(overlayEl.hidden, true);
    assert.deepEqual(calls, [
      [
        'updateRenderOptions',
        {
          showValenceWarnings: true,
          showAtomTooltips: false,
          showLonePairs: true,
          twoDAtomColoring: true,
          twoDAtomFontSize: 24,
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
});
