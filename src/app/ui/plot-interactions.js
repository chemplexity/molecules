/** @module app/ui/plot-interactions */

/**
 * Attaches all mouse and pointer event handlers to the plot element for selection, drawing, and tooltip interactions.
 * @param {object} deps - Flat app context providing plotEl, document, state, tooltip, options, analysis, and helper accessors.
 */
export function initPlotInteractions(deps) {
  const win = deps.window ?? deps.document?.defaultView ?? null;
  const docEl = deps.document?.documentElement ?? null;
  const bodyEl = deps.document?.body ?? null;

  function isChargeModeActive() {
    return deps.state.isRenderableMode() && !!deps.state.getChargeTool?.();
  }

  function suppressChargeModeSecondaryEvent(event) {
    if (!isChargeModeActive()) {
      return;
    }
    event.preventDefault();
    event.stopPropagation?.();
    event.stopImmediatePropagation?.();
  }

  function installLegacySecondarySuppressors(target) {
    if (!target) {
      return;
    }

    const previousMouseDown = target.onmousedown;
    target.onmousedown = event => {
      if (isChargeModeActive() && (event?.button === 2 || event?.ctrlKey)) {
        suppressChargeModeSecondaryEvent(event);
        return false;
      }
      if (typeof previousMouseDown === 'function') {
        return previousMouseDown.call(target, event);
      }
      return true;
    };

    const previousContextMenu = target.oncontextmenu;
    target.oncontextmenu = event => {
      if (isChargeModeActive()) {
        suppressChargeModeSecondaryEvent(event);
        return false;
      }
      if (typeof previousContextMenu === 'function') {
        return previousContextMenu.call(target, event);
      }
      return true;
    };
  }

  deps.plotEl.addEventListener('selectstart', event => {
    event.preventDefault();
  });

  deps.plotEl.addEventListener('mousedown', event => {
    if (event.button === 2 || event.ctrlKey) {
      suppressChargeModeSecondaryEvent(event);
    }
  });

  deps.plotEl.addEventListener('contextmenu', event => {
    suppressChargeModeSecondaryEvent(event);
  });

  deps.document.addEventListener(
    'mousedown',
    event => {
      if (event.button === 2 || event.ctrlKey) {
        suppressChargeModeSecondaryEvent(event);
      }
    },
    true
  );

  deps.document.addEventListener(
    'contextmenu',
    event => {
      suppressChargeModeSecondaryEvent(event);
    },
    true
  );

  win?.addEventListener(
    'mousedown',
    event => {
      if (event.button === 2 || event.ctrlKey) {
        suppressChargeModeSecondaryEvent(event);
      }
    },
    true
  );

  win?.addEventListener(
    'auxclick',
    event => {
      if (event.button === 2 || event.ctrlKey) {
        suppressChargeModeSecondaryEvent(event);
      }
    },
    true
  );

  win?.addEventListener(
    'contextmenu',
    event => {
      suppressChargeModeSecondaryEvent(event);
    },
    true
  );

  installLegacySecondarySuppressors(win);
  installLegacySecondarySuppressors(deps.document);
  installLegacySecondarySuppressors(docEl);
  installLegacySecondarySuppressors(bodyEl);
  installLegacySecondarySuppressors(deps.plotEl);

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
