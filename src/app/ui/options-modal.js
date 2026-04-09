/** @module app/ui/options-modal */

/**
 * Initialises the options modal, binding all input elements and button handlers to app context.
 * @param {object} context - Flat app context providing DOM accessors, option readers/writers, and modal state.
 * @returns {void}
 */
export function initOptionsModal(context) {
  const { doc = document } = context;

  const overlayEl = context.dom.getOverlayElement();
  const showValenceWarningsEl = context.dom.getShowValenceWarningsElement();
  const showAtomTooltipsEl = context.dom.getShowAtomTooltipsElement();
  const twoDRendererVersionEl = context.dom.get2DRendererVersionElement();
  const twoDAtomColoringEl = context.dom.get2DAtomColoringElement();
  const twoDAtomFontSizeEl = context.dom.get2DAtomFontSizeElement();
  const atomNumberingFontSizeEl = context.dom.getAtomNumberingFontSizeElement();
  const twoDBondThicknessEl = context.dom.get2DBondThicknessElement();
  const forceAtomSizeEl = context.dom.getForceAtomSizeElement();
  const forceBondThicknessEl = context.dom.getForceBondThicknessElement();
  const resetBtnEl = context.dom.getResetButtonElement();
  const cancelBtnEl = context.dom.getCancelButtonElement();
  const applyBtnEl = context.dom.getApplyButtonElement();

  function formatOptionNumber(value) {
    return Number(value).toFixed(1).replace(/\.0$/, '');
  }

  function clampOptionInputValue(inputEl, limits, fallbackValue) {
    const parsed = Number(inputEl.value);
    if (!Number.isFinite(parsed)) {
      inputEl.value = formatOptionNumber(fallbackValue);
      return fallbackValue;
    }
    const clamped = Math.min(limits.max, Math.max(limits.min, parsed));
    inputEl.value = formatOptionNumber(clamped);
    return clamped;
  }

  function syncForm(options = context.options.getRenderOptions()) {
    showValenceWarningsEl.checked = options.showValenceWarnings;
    showAtomTooltipsEl.checked = options.showAtomTooltips;
    twoDRendererVersionEl.value = options.twoDRendererVersion ?? 'v1';
    twoDAtomColoringEl.checked = options.twoDAtomColoring;
    twoDAtomFontSizeEl.value = formatOptionNumber(options.twoDAtomFontSize);
    atomNumberingFontSizeEl.value = formatOptionNumber(options.atomNumberingFontSize);
    twoDBondThicknessEl.value = formatOptionNumber(options.twoDBondThickness);
    forceAtomSizeEl.value = formatOptionNumber(options.forceAtomSizeMultiplier);
    forceBondThicknessEl.value = formatOptionNumber(options.forceBondThicknessMultiplier);
  }

  function close() {
    overlayEl.hidden = true;
  }

  function open() {
    syncForm();
    overlayEl.hidden = false;
  }

  function rerenderWithActiveInput() {
    const renderMol = context.renderers?.renderMol;
    if (typeof renderMol !== 'function') {
      return false;
    }

    const inputMode = context.state.getInputMode?.() === 'inchi' ? 'inchi' : 'smiles';
    const candidates = inputMode === 'inchi'
      ? [
        { value: context.state.getCurrentInchi?.(), parser: context.parsers?.parseINCHI },
        { value: context.state.getCurrentSmiles?.(), parser: context.parsers?.parseSMILES }
      ]
      : [
        { value: context.state.getCurrentSmiles?.(), parser: context.parsers?.parseSMILES },
        { value: context.state.getCurrentInchi?.(), parser: context.parsers?.parseINCHI }
      ];

    for (const candidate of candidates) {
      if (typeof candidate.value !== 'string' || candidate.value.length === 0 || typeof candidate.parser !== 'function') {
        continue;
      }
      try {
        const mol = candidate.parser(candidate.value);
        if (!mol || !(mol.atoms instanceof Map) || mol.atoms.size === 0) {
          continue;
        }
        renderMol(mol, { preserveHistory: true, preserveAnalysis: true });
        return true;
      } catch {
        /* fall back to direct rerender below */
      }
    }

    return false;
  }

  function apply() {
    const currentOptions = context.options.getRenderOptions();
    const currentRendererVersion = currentOptions.twoDRendererVersion ?? 'v1';
    const nextOptions = context.options.updateRenderOptions({
      showValenceWarnings: showValenceWarningsEl.checked,
      showAtomTooltips: showAtomTooltipsEl.checked,
      twoDRendererVersion: twoDRendererVersionEl.value === 'v2' ? 'v2' : 'v1',
      twoDAtomColoring: twoDAtomColoringEl.checked,
      twoDAtomFontSize: clampOptionInputValue(twoDAtomFontSizeEl, context.options.limits.twoDAtomFontSize, currentOptions.twoDAtomFontSize),
      atomNumberingFontSize: clampOptionInputValue(atomNumberingFontSizeEl, context.options.limits.atomNumberingFontSize, currentOptions.atomNumberingFontSize),
      twoDBondThickness: clampOptionInputValue(twoDBondThicknessEl, context.options.limits.twoDBondThickness, currentOptions.twoDBondThickness),
      forceAtomSizeMultiplier: clampOptionInputValue(forceAtomSizeEl, context.options.limits.forceAtomSizeMultiplier, currentOptions.forceAtomSizeMultiplier),
      forceBondThicknessMultiplier: clampOptionInputValue(forceBondThicknessEl, context.options.limits.forceBondThicknessMultiplier, currentOptions.forceBondThicknessMultiplier)
    });
    context.view.setFontSize(nextOptions.twoDAtomFontSize);
    if (!nextOptions.showAtomTooltips) {
      context.view.hideTooltip();
    }

    if (context.state.getMode() === 'force' && context.state.getCurrentMol()) {
      context.renderers.updateForce(context.state.getCurrentMol(), { preservePositions: true, preserveView: true });
    } else if (context.state.getMode() === '2d' && context.state.getMol2d()) {
      if (currentRendererVersion !== nextOptions.twoDRendererVersion && typeof context.renderers.render2d === 'function') {
        if (!rerenderWithActiveInput()) {
          context.renderers.render2d(context.state.getMol2d(), { preserveAnalysis: true });
        }
      } else {
        context.renderers.draw2d();
      }
    }

    syncForm(nextOptions);
    close();
    return nextOptions;
  }

  resetBtnEl.addEventListener('click', () => {
    syncForm(context.options.getDefaultRenderOptions());
  });
  cancelBtnEl.addEventListener('click', () => {
    close();
  });
  applyBtnEl.addEventListener('click', () => {
    apply();
  });
  overlayEl.addEventListener('mousedown', event => {
    if (event.target === overlayEl) {
      close();
    }
  });
  doc.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !overlayEl.hidden) {
      close();
    }
  });

  return {
    open,
    close,
    syncForm,
    apply
  };
}
