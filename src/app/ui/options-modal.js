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
  const layoutBondLengthEl = context.dom.getLayoutBondLengthElement();
  const twoDAtomColoringEl = context.dom.get2DAtomColoringElement();
  const twoDAtomFontSizeEl = context.dom.get2DAtomFontSizeElement();
  const atomNumberingFontSizeEl = context.dom.getAtomNumberingFontSizeElement();
  const bondEnFontSizeEl = context.dom.getBondEnFontSizeElement();
  const bondLengthFontSizeEl = context.dom.getBondLengthFontSizeElement();
  const twoDBondThicknessEl = context.dom.get2DBondThicknessElement();
  const forceAtomSizeEl = context.dom.getForceAtomSizeElement();
  const forceBondThicknessEl = context.dom.getForceBondThicknessElement();
  const showReactionReagentsEl = context.dom.getShowReactionReagentsElement();
  const showReactionConditionsEl = context.dom.getShowReactionConditionsElement();
  const reactionFontSizeEl = context.dom.getReactionFontSizeElement();
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
    layoutBondLengthEl.value = formatOptionNumber(options.layoutBondLength);
    twoDAtomColoringEl.value = options.twoDColorStyle ?? 'color-atoms';
    twoDAtomFontSizeEl.value = formatOptionNumber(options.twoDAtomFontSize);
    atomNumberingFontSizeEl.value = formatOptionNumber(options.atomNumberingFontSize);
    bondEnFontSizeEl.value = formatOptionNumber(options.bondEnFontSize);
    bondLengthFontSizeEl.value = formatOptionNumber(options.bondLengthFontSize);
    twoDBondThicknessEl.value = formatOptionNumber(options.twoDBondThickness);
    forceAtomSizeEl.value = formatOptionNumber(options.forceAtomSizeMultiplier);
    forceBondThicknessEl.value = formatOptionNumber(options.forceBondThicknessMultiplier);
    showReactionReagentsEl.checked = options.showReactionReagents !== false;
    showReactionConditionsEl.checked = options.showReactionConditions === true;
    reactionFontSizeEl.value = formatOptionNumber(options.reactionFontSize);
  }

  function close() {
    overlayEl.hidden = true;
  }

  function open() {
    syncForm();
    overlayEl.hidden = false;
  }

  function apply() {
    const currentOptions = context.options.getRenderOptions();
    const layoutBondLength = clampOptionInputValue(layoutBondLengthEl, context.options.limits.layoutBondLength, currentOptions.layoutBondLength);
    const layoutBondLengthChanged = Math.abs(layoutBondLength - currentOptions.layoutBondLength) > 1e-6;
    const nextOptions = context.options.updateRenderOptions({
      showValenceWarnings: showValenceWarningsEl.checked,
      showAtomTooltips: showAtomTooltipsEl.checked,
      layoutBondLength,
      twoDColorStyle: twoDAtomColoringEl.value,
      twoDAtomFontSize: clampOptionInputValue(twoDAtomFontSizeEl, context.options.limits.twoDAtomFontSize, currentOptions.twoDAtomFontSize),
      atomNumberingFontSize: clampOptionInputValue(atomNumberingFontSizeEl, context.options.limits.atomNumberingFontSize, currentOptions.atomNumberingFontSize),
      bondEnFontSize: clampOptionInputValue(bondEnFontSizeEl, context.options.limits.bondEnFontSize, currentOptions.bondEnFontSize),
      bondLengthFontSize: clampOptionInputValue(bondLengthFontSizeEl, context.options.limits.bondLengthFontSize, currentOptions.bondLengthFontSize),
      twoDBondThickness: clampOptionInputValue(twoDBondThicknessEl, context.options.limits.twoDBondThickness, currentOptions.twoDBondThickness),
      forceAtomSizeMultiplier: clampOptionInputValue(forceAtomSizeEl, context.options.limits.forceAtomSizeMultiplier, currentOptions.forceAtomSizeMultiplier),
      forceBondThicknessMultiplier: clampOptionInputValue(forceBondThicknessEl, context.options.limits.forceBondThicknessMultiplier, currentOptions.forceBondThicknessMultiplier),
      showReactionReagents: showReactionReagentsEl.checked,
      showReactionConditions: showReactionConditionsEl.checked,
      reactionFontSize: clampOptionInputValue(reactionFontSizeEl, context.options.limits.reactionFontSize, currentOptions.reactionFontSize)
    });
    context.view.setFontSize(nextOptions.twoDAtomFontSize);
    if (!nextOptions.showAtomTooltips) {
      context.view.hideTooltip();
    }

    if (context.state.getMode() === 'force' && context.state.getCurrentMol()) {
      context.renderers.updateForce(
        context.state.getCurrentMol(),
        layoutBondLengthChanged
          ? { preservePositions: false, preserveView: false }
          : { preservePositions: true, preserveView: true }
      );
      if (layoutBondLengthChanged) {
        context.navigation?.autoZoom?.();
        context.navigation?.autoZoomAfterRender?.();
      }
    } else if (context.state.getMode() === '2d' && context.state.getMol2d()) {
      if (layoutBondLengthChanged) {
        context.renderers.renderMol(context.state.getMol2d(), {
          preserveHistory: true
        });
        context.navigation?.autoZoom?.();
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
    if (overlayEl.hidden) {
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault?.();
      close();
    } else if (event.key === 'Enter') {
      event.preventDefault?.();
      apply();
    }
  });

  return {
    open,
    close,
    syncForm,
    apply
  };
}
