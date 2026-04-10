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
  it('falls back to v2 when the current renderer version is missing', () => {
    const overlayEl = {
      hidden: true,
      listeners: new Map(),
      addEventListener(type, handler) {
        this.listeners.set(type, handler);
      }
    };
    const showValenceWarningsEl = makeCheckbox();
    const showAtomTooltipsEl = makeCheckbox();
    const twoDRendererVersionEl = makeInput();
    const twoDAtomColoringEl = makeCheckbox();
    const twoDAtomFontSizeEl = makeInput();
    const atomNumberingFontSizeEl = makeInput();
    const twoDBondThicknessEl = makeInput();
    const forceAtomSizeEl = makeInput();
    const forceBondThicknessEl = makeInput();
    const resetBtnEl = makeButton();
    const cancelBtnEl = makeButton();
    const applyBtnEl = makeButton();

    const modal = initOptionsModal({
      doc: {
        addEventListener() {}
      },
      dom: {
        getOverlayElement: () => overlayEl,
        getShowValenceWarningsElement: () => showValenceWarningsEl,
        getShowAtomTooltipsElement: () => showAtomTooltipsEl,
        get2DRendererVersionElement: () => twoDRendererVersionEl,
        get2DAtomColoringElement: () => twoDAtomColoringEl,
        get2DAtomFontSizeElement: () => twoDAtomFontSizeEl,
        getAtomNumberingFontSizeElement: () => atomNumberingFontSizeEl,
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
          twoDBondThickness: { min: 0.8, max: 4 },
          forceAtomSizeMultiplier: { min: 0.5, max: 2.5 },
          forceBondThicknessMultiplier: { min: 0.5, max: 2.5 }
        },
        getRenderOptions: () => ({
          showValenceWarnings: true,
          showAtomTooltips: true,
          twoDAtomColoring: true,
          twoDAtomFontSize: 14,
          atomNumberingFontSize: 10,
          twoDBondThickness: 1.6,
          forceAtomSizeMultiplier: 1,
          forceBondThicknessMultiplier: 1
        }),
        getDefaultRenderOptions: () => ({
          showValenceWarnings: true,
          showAtomTooltips: true,
          twoDRendererVersion: 'v2',
          twoDAtomColoring: true,
          twoDAtomFontSize: 14,
          atomNumberingFontSize: 10,
          twoDBondThickness: 1.6,
          forceAtomSizeMultiplier: 1,
          forceBondThicknessMultiplier: 1
        }),
        updateRenderOptions: nextOptions => nextOptions
      },
      state: {
        getMode: () => '2d',
        getCurrentMol: () => null,
        getMol2d: () => null
      },
      view: {
        setFontSize() {},
        hideTooltip() {}
      },
      renderers: {
        draw2d() {},
        render2d() {},
        renderMol() {},
        updateForce() {}
      },
      parsers: {}
    });

    modal.open();
    assert.equal(twoDRendererVersionEl.value, 'v2');
  });

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
      twoDRendererVersion: 'v1',
      twoDAtomColoring: true,
      twoDAtomFontSize: 14,
      atomNumberingFontSize: 10,
      twoDBondThickness: 1.6,
      forceAtomSizeMultiplier: 1,
      forceBondThicknessMultiplier: 1
    };
    const defaultOptions = {
      ...currentOptions,
      twoDAtomFontSize: 18,
      atomNumberingFontSize: 12
    };

    const showValenceWarningsEl = makeCheckbox();
    const showAtomTooltipsEl = makeCheckbox();
    const twoDRendererVersionEl = makeInput();
    const twoDAtomColoringEl = makeCheckbox();
    const twoDAtomFontSizeEl = makeInput();
    const atomNumberingFontSizeEl = makeInput();
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
        get2DRendererVersionElement: () => twoDRendererVersionEl,
        get2DAtomColoringElement: () => twoDAtomColoringEl,
        get2DAtomFontSizeElement: () => twoDAtomFontSizeEl,
        getAtomNumberingFontSizeElement: () => atomNumberingFontSizeEl,
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
        getMol2d: () => ({ id: 'mol2d' }),
        getInputMode: () => 'smiles',
        getCurrentSmiles: () => 'CCO',
        getCurrentInchi: () => null
      },
      view: {
        setFontSize: value => calls.push(['setFontSize', value]),
        hideTooltip: () => calls.push(['hideTooltip'])
      },
      renderers: {
        draw2d: () => calls.push(['draw2d']),
        render2d: (...args) => calls.push(['render2d', ...args]),
        renderMol: (...args) => calls.push(['renderMol', ...args]),
        updateForce: (...args) => calls.push(['updateForce', ...args])
      },
      parsers: {
        parseSMILES: value => ({ id: `parsed:${value}`, atoms: new Map([['a1', {}]]) }),
        parseINCHI: value => ({ id: `parsed:${value}`, atoms: new Map([['a1', {}]]) })
      }
    });

    modal.open();
    assert.equal(overlayEl.hidden, false);
    assert.equal(showValenceWarningsEl.checked, true);
    assert.equal(showAtomTooltipsEl.checked, true);
    assert.equal(twoDRendererVersionEl.value, 'v1');
    assert.equal(twoDAtomFontSizeEl.value, '14');
    assert.equal(atomNumberingFontSizeEl.value, '10');

    resetBtnEl.trigger('click');
    assert.equal(twoDAtomFontSizeEl.value, '18');
    assert.equal(atomNumberingFontSizeEl.value, '12');

    showAtomTooltipsEl.checked = false;
    twoDAtomFontSizeEl.value = '30';
    atomNumberingFontSizeEl.value = '30';
    applyBtnEl.trigger('click');

    assert.equal(overlayEl.hidden, true);
    assert.deepEqual(calls, [
      [
        'updateRenderOptions',
        {
          showValenceWarnings: true,
          showAtomTooltips: false,
          twoDRendererVersion: 'v1',
          twoDAtomColoring: true,
          twoDAtomFontSize: 24,
          atomNumberingFontSize: 24,
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

  it('rerenders through the active input format when the 2d renderer version changes', () => {
    const calls = [];
    const overlayEl = {
      hidden: true,
      listeners: new Map(),
      addEventListener(type, handler) {
        this.listeners.set(type, handler);
      }
    };
    const showValenceWarningsEl = makeCheckbox();
    const showAtomTooltipsEl = makeCheckbox();
    const twoDRendererVersionEl = makeInput();
    const twoDAtomColoringEl = makeCheckbox();
    const twoDAtomFontSizeEl = makeInput();
    const atomNumberingFontSizeEl = makeInput();
    const twoDBondThicknessEl = makeInput();
    const forceAtomSizeEl = makeInput();
    const forceBondThicknessEl = makeInput();
    const resetBtnEl = makeButton();
    const cancelBtnEl = makeButton();
    const applyBtnEl = makeButton();
    const mol2d = { id: 'mol2d' };
    const reparsedMol = { id: 'parsed-inchi', atoms: new Map([['a1', {}]]) };
    const currentOptions = {
      showValenceWarnings: true,
      showAtomTooltips: true,
      twoDRendererVersion: 'v1',
      twoDAtomColoring: true,
      twoDAtomFontSize: 14,
      atomNumberingFontSize: 10,
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
        get2DRendererVersionElement: () => twoDRendererVersionEl,
        get2DAtomColoringElement: () => twoDAtomColoringEl,
        get2DAtomFontSizeElement: () => twoDAtomFontSizeEl,
        getAtomNumberingFontSizeElement: () => atomNumberingFontSizeEl,
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
          twoDBondThickness: { min: 0.8, max: 4 },
          forceAtomSizeMultiplier: { min: 0.5, max: 2.5 },
          forceBondThicknessMultiplier: { min: 0.5, max: 2.5 }
        },
        getRenderOptions: () => currentOptions,
        getDefaultRenderOptions: () => currentOptions,
        updateRenderOptions: nextOptions => ({ ...currentOptions, ...nextOptions })
      },
      state: {
        getMode: () => '2d',
        getCurrentMol: () => null,
        getMol2d: () => mol2d,
        getInputMode: () => 'inchi',
        getCurrentSmiles: () => 'fallback-smiles',
        getCurrentInchi: () => 'InChI=1S/test'
      },
      view: {
        setFontSize: value => calls.push(['setFontSize', value]),
        hideTooltip: () => calls.push(['hideTooltip'])
      },
      renderers: {
        draw2d: () => calls.push(['draw2d']),
        render2d: (...args) => calls.push(['render2d', ...args]),
        renderMol: (...args) => calls.push(['renderMol', ...args]),
        updateForce: (...args) => calls.push(['updateForce', ...args])
      },
      parsers: {
        parseSMILES: value => ({ id: `parsed:${value}`, atoms: new Map([['a1', {}]]) }),
        parseINCHI: value => {
          calls.push(['parseINCHI', value]);
          return reparsedMol;
        }
      }
    });

    modal.open();
    twoDRendererVersionEl.value = 'v2';
    applyBtnEl.trigger('click');

    assert.deepEqual(calls, [
      ['setFontSize', 14],
      ['parseINCHI', 'InChI=1S/test'],
      ['renderMol', reparsedMol, { preserveHistory: true, preserveAnalysis: true }]
    ]);
  });

  it('falls back to rerendering the current 2D molecule when reparsing is unavailable', () => {
    const calls = [];
    const overlayEl = {
      hidden: true,
      listeners: new Map(),
      addEventListener(type, handler) {
        this.listeners.set(type, handler);
      }
    };
    const showValenceWarningsEl = makeCheckbox();
    const showAtomTooltipsEl = makeCheckbox();
    const twoDRendererVersionEl = makeInput();
    const twoDAtomColoringEl = makeCheckbox();
    const twoDAtomFontSizeEl = makeInput();
    const atomNumberingFontSizeEl = makeInput();
    const twoDBondThicknessEl = makeInput();
    const forceAtomSizeEl = makeInput();
    const forceBondThicknessEl = makeInput();
    const resetBtnEl = makeButton();
    const cancelBtnEl = makeButton();
    const applyBtnEl = makeButton();
    const mol2d = { id: 'mol2d' };
    const currentOptions = {
      showValenceWarnings: true,
      showAtomTooltips: true,
      twoDRendererVersion: 'v1',
      twoDAtomColoring: true,
      twoDAtomFontSize: 14,
      atomNumberingFontSize: 10,
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
        get2DRendererVersionElement: () => twoDRendererVersionEl,
        get2DAtomColoringElement: () => twoDAtomColoringEl,
        get2DAtomFontSizeElement: () => twoDAtomFontSizeEl,
        getAtomNumberingFontSizeElement: () => atomNumberingFontSizeEl,
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
          twoDBondThickness: { min: 0.8, max: 4 },
          forceAtomSizeMultiplier: { min: 0.5, max: 2.5 },
          forceBondThicknessMultiplier: { min: 0.5, max: 2.5 }
        },
        getRenderOptions: () => currentOptions,
        getDefaultRenderOptions: () => currentOptions,
        updateRenderOptions: nextOptions => ({ ...currentOptions, ...nextOptions })
      },
      state: {
        getMode: () => '2d',
        getCurrentMol: () => null,
        getMol2d: () => mol2d,
        getInputMode: () => 'inchi',
        getCurrentSmiles: () => null,
        getCurrentInchi: () => ''
      },
      view: {
        setFontSize: value => calls.push(['setFontSize', value]),
        hideTooltip: () => calls.push(['hideTooltip'])
      },
      renderers: {
        draw2d: () => calls.push(['draw2d']),
        render2d: (...args) => calls.push(['render2d', ...args]),
        renderMol: (...args) => calls.push(['renderMol', ...args]),
        updateForce: (...args) => calls.push(['updateForce', ...args])
      },
      parsers: {
        parseSMILES: value => ({ id: `parsed:${value}`, atoms: new Map([['a1', {}]]) }),
        parseINCHI: () => {
          throw new Error('parse failed');
        }
      }
    });

    modal.open();
    twoDRendererVersionEl.value = 'v2';
    applyBtnEl.trigger('click');

    assert.deepEqual(calls, [
      ['setFontSize', 14],
      ['render2d', mol2d, { preserveAnalysis: true }]
    ]);
  });
});
