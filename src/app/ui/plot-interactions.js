/** @module app/ui/plot-interactions */

/**
 * Attaches all mouse and pointer event handlers to the plot element for selection, drawing, and tooltip interactions.
 * @param {object} deps - Flat app context providing plotEl, document, state, tooltip, options, analysis, and helper accessors.
 */
export function initPlotInteractions(deps) {
  deps.plotEl.addEventListener('selectstart', event => {
    event.preventDefault();
  });

  deps.document.addEventListener('mousemove', event => {
    const warningHoverMode =
      deps.state.getSelectMode() ||
      (deps.state.getDrawBondMode() && !deps.state.hasDrawBondState()) ||
      deps.state.getEraseMode();
    if (!warningHoverMode || !deps.state.isRenderableMode()) {
      if (deps.tooltipState.getSelectionValenceTooltipAtomId() !== null) {
        deps.tooltipState.setSelectionValenceTooltipAtomId(null);
        deps.tooltip.hide();
      }
      return;
    }

    const mol = deps.state.getActiveMolecule();
    if (!deps.options.getShowAtomTooltips() || !mol || deps.analysis.getActiveValenceWarningMap().size === 0) {
      if (deps.tooltipState.getSelectionValenceTooltipAtomId() !== null) {
        deps.tooltipState.setSelectionValenceTooltipAtomId(null);
        deps.tooltip.hide();
      }
      return;
    }

    let atomId = null;
    for (const element of deps.document.elementsFromPoint(event.clientX, event.clientY)) {
      if (element.classList?.contains('node')) {
        const datum = deps.helpers.getNodeDatum(element);
        atomId = datum?.id ?? null;
        if (atomId) {
          break;
        }
      }
      const atomHitGroup = element.classList?.contains('atom-hit') ? element.closest('[data-atom-id]') : element.closest?.('[data-atom-id]');
      atomId = atomHitGroup?.getAttribute?.('data-atom-id') ?? null;
      if (atomId) {
        break;
      }
    }

    const valenceWarning = atomId ? deps.analysis.getActiveValenceWarningMap().get(atomId) ?? null : null;
    const atom = atomId ? deps.molecule.getAtomById(atomId, mol) : null;
    if (!atom || !valenceWarning) {
      if (deps.tooltipState.getSelectionValenceTooltipAtomId() !== null) {
        deps.tooltipState.setSelectionValenceTooltipAtomId(null);
        deps.tooltip.hide();
      }
      return;
    }

    deps.tooltipState.setSelectionValenceTooltipAtomId(atomId);
    deps.tooltip.show(deps.formatters.atomTooltipHtml(atom, mol, valenceWarning, deps.state.getTooltipMode()), event);
  });
}
