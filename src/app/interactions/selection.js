/** @module app/interactions/selection */

const DRAW_ELEMENTS = ['C', 'N', 'O', 'S', 'P', 'F', 'Cl', 'Br', 'I'];
const DRAW_BOND_TYPES = ['single', 'double', 'triple', 'aromatic', 'wedge', 'dash'];
const CHARGE_TOOLS = ['positive', 'negative'];

/**
 * Creates selection action handlers for tool-mode toggling (pan, select, draw-bond, erase), element/bond-type switching, and toolbar button synchronization.
 * @param {object} context - Dependency context providing state, view, dom, drawBond, renderers, and actions.
 * @returns {object} Object with `togglePanMode`, `toggleSelectMode`, `toggleDrawBondMode`, `toggleEraseMode`, `setDrawElement`, `setDrawBondType`, `handleDrawBondButtonClick`, `openDrawBondDrawer`, `closeDrawBondDrawer`, `toggleDrawBondDrawer`, and sync/clear button helpers.
 */
export function createSelectionActions(context) {
  function setDrawBondDrawerHoverSuppressed(value) {
    context.dom.drawTools?.classList?.toggle?.('drawer-hover-suppressed', value);
  }

  const doc = context.document ?? globalThis.document ?? null;

  if (context.dom.drawTools && typeof context.dom.drawTools.addEventListener === 'function' && !context.dom.drawTools.__bondDrawerHoverSuppressBound) {
    context.dom.drawTools.addEventListener('mouseleave', () => {
      setDrawBondDrawerHoverSuppressed(false);
    });
    context.dom.drawTools.__bondDrawerHoverSuppressBound = true;
  }

  if (doc && context.dom.drawTools && typeof doc.addEventListener === 'function' && !context.dom.drawTools.__bondDrawerOutsideCloseBound) {
    doc.addEventListener(
      'pointerdown',
      event => {
        if (!context.dom.drawTools?.classList?.contains?.('drawer-open')) {
          return;
        }
        if (typeof event?.target?.closest === 'function' && event.target.closest('#draw-tools')) {
          return;
        }
        closeDrawBondDrawer();
      },
      true
    );
    context.dom.drawTools.__bondDrawerOutsideCloseBound = true;
  }

  function syncDrawBondButtonIcon() {
    const activeType = context.state.overlayState.getDrawBondType?.() ?? 'single';
    const sourceButton = context.dom.getBondDrawTypeButton?.(activeType);
    const drawBondButton = context.dom.drawBondButton;
    if (!sourceButton || !drawBondButton || typeof sourceButton.innerHTML !== 'string') {
      return;
    }
    drawBondButton.innerHTML = sourceButton.innerHTML;
  }

  function openDrawBondDrawer() {
    setDrawBondDrawerHoverSuppressed(false);
    context.dom.drawTools?.classList?.add('drawer-open');
  }

  function closeDrawBondDrawer() {
    context.dom.drawTools?.classList?.remove('drawer-open');
  }

  function toggleDrawBondDrawer() {
    if (!context.dom.drawTools?.classList) {
      return;
    }
    context.dom.drawTools.classList.toggle('drawer-open');
  }

  function syncToolButtonsFromState() {
    const selectMode = context.state.overlayState.getSelectMode();
    const drawBondMode = context.state.overlayState.getDrawBondMode();
    const eraseMode = context.state.overlayState.getEraseMode();
    const chargeTool = context.state.overlayState.getChargeTool?.() ?? null;
    const panMode = !selectMode && !drawBondMode && !eraseMode && chargeTool == null;

    context.dom.panButton.classList.toggle('active', panMode);
    context.dom.selectButton.classList.toggle('active', selectMode);
    context.dom.drawBondButton.classList.toggle('active', drawBondMode);
    context.dom.eraseButton.classList.toggle('active', eraseMode);
    syncChargeButtons();

    if (drawBondMode) {
      syncElementButtons();
      syncBondDrawTypeButtons();
      syncDrawBondButtonIcon();
    } else {
      clearElementButtons();
      clearBondDrawTypeButtons();
      closeDrawBondDrawer();
    }
  }

  function syncChargeButtons() {
    const activeTool = context.state.overlayState.getChargeTool?.() ?? null;
    for (const tool of CHARGE_TOOLS) {
      const btn = context.dom.getChargeToolButton?.(tool);
      if (btn) {
        btn.classList.toggle('active', tool === activeTool);
      }
    }
  }

  function clearChargeButtons() {
    for (const tool of CHARGE_TOOLS) {
      const btn = context.dom.getChargeToolButton?.(tool);
      if (btn) {
        btn.classList.remove('active');
      }
    }
  }

  function syncElementButtons() {
    const activeElement = context.state.overlayState.getDrawBondElement();
    for (const element of DRAW_ELEMENTS) {
      const btn = context.dom.getElementButton(element);
      if (btn) {
        btn.classList.toggle('active', element === activeElement);
      }
    }
  }

  function clearElementButtons() {
    for (const element of DRAW_ELEMENTS) {
      const btn = context.dom.getElementButton(element);
      if (btn) {
        btn.classList.remove('active');
      }
    }
  }

  function syncBondDrawTypeButtons() {
    const activeType = context.state.overlayState.getDrawBondType?.() ?? 'single';
    for (const type of DRAW_BOND_TYPES) {
      const btn = context.dom.getBondDrawTypeButton?.(type);
      if (btn) {
        btn.classList.toggle('active', type === activeType);
      }
    }
  }

  function clearBondDrawTypeButtons() {
    for (const type of DRAW_BOND_TYPES) {
      const btn = context.dom.getBondDrawTypeButton?.(type);
      if (btn) {
        btn.classList.remove('active');
      }
    }
  }

  function rerenderToolOverlay() {
    if (context.state.viewState.getMode() === 'force') {
      context.renderers.applyForceSelection();
    } else if (context.state.documentState.getMol2d()) {
      context.renderers.draw2d();
    }
  }

  function togglePanMode() {
    if (
      !context.state.overlayState.getSelectMode() &&
      !context.state.overlayState.getDrawBondMode() &&
      !context.state.overlayState.getEraseMode() &&
      (context.state.overlayState.getChargeTool?.() ?? null) == null
    ) {
      return;
    }
    context.state.overlayState.setSelectMode(false);
    context.state.overlayState.setDrawBondMode(false);
    context.state.overlayState.setEraseMode(false);
    context.state.overlayState.setChargeTool?.(null);
    context.drawBond.cancelDrawBond();
    context.view.clearPrimitiveHover();
    clearElementButtons();
    clearBondDrawTypeButtons();
    clearChargeButtons();
    closeDrawBondDrawer();
    context.dom.panButton.classList.add('active');
    context.dom.selectButton.classList.remove('active');
    context.dom.drawBondButton.classList.remove('active');
    context.dom.eraseButton.classList.remove('active');
    rerenderToolOverlay();
  }

  function toggleSelectMode() {
    if (context.state.overlayState.getSelectMode()) {
      return;
    }
    context.state.overlayState.setSelectMode(true);
    context.state.overlayState.setDrawBondMode(false);
    context.state.overlayState.setEraseMode(false);
    context.state.overlayState.setChargeTool?.(null);
    context.drawBond.cancelDrawBond();
    context.view.clearPrimitiveHover();
    clearElementButtons();
    clearBondDrawTypeButtons();
    clearChargeButtons();
    closeDrawBondDrawer();
    context.dom.selectButton.classList.add('active');
    context.dom.panButton.classList.remove('active');
    context.dom.drawBondButton.classList.remove('active');
    context.dom.eraseButton.classList.remove('active');
  }

  function toggleDrawBondMode() {
    const next = !context.state.overlayState.getDrawBondMode();
    context.state.overlayState.setDrawBondMode(next);
    const btn = context.dom.drawBondButton;
    if (next) {
      context.state.overlayState.setSelectMode(false);
      context.state.overlayState.setEraseMode(false);
      context.state.overlayState.setChargeTool?.(null);
      context.drawBond.cancelDrawBond();
      context.view.clearPrimitiveHover();
      context.dom.panButton.classList.remove('active');
      context.dom.selectButton.classList.remove('active');
      context.dom.eraseButton.classList.remove('active');
      clearChargeButtons();
      btn.classList.add('active');
      syncElementButtons();
      syncBondDrawTypeButtons();
      syncDrawBondButtonIcon();
    } else {
      context.drawBond.cancelDrawBond();
      context.view.clearPrimitiveHover();
      context.dom.panButton.classList.add('active');
      btn.classList.remove('active');
      clearElementButtons();
      clearBondDrawTypeButtons();
      clearChargeButtons();
      closeDrawBondDrawer();
    }
    rerenderToolOverlay();
  }

  function toggleEraseMode() {
    const next = !context.state.overlayState.getEraseMode();
    context.state.overlayState.setEraseMode(next);
    const btn = context.dom.eraseButton;
    if (next) {
      context.state.overlayState.setSelectMode(false);
      context.state.overlayState.setDrawBondMode(false);
      context.state.overlayState.setChargeTool?.(null);
      context.drawBond.cancelDrawBond();
      clearElementButtons();
      clearBondDrawTypeButtons();
      clearChargeButtons();
      closeDrawBondDrawer();
      context.dom.panButton.classList.remove('active');
      context.dom.selectButton.classList.remove('active');
      context.dom.drawBondButton.classList.remove('active');
      btn.classList.add('active');
      if (context.state.overlayState.getSelectedAtomIds().size > 0 || context.state.overlayState.getSelectedBondIds().size > 0) {
        context.actions.deleteSelection();
        return;
      }
      context.view.clearPrimitiveHover();
    } else {
      context.state.overlayState.setErasePainting(false);
      context.view.clearPrimitiveHover();
      context.dom.panButton.classList.add('active');
      btn.classList.remove('active');
      clearChargeButtons();
    }
    rerenderToolOverlay();
  }

  function setChargeTool(tool) {
    if (!CHARGE_TOOLS.includes(tool)) {
      return;
    }
    const currentTool = context.state.overlayState.getChargeTool?.() ?? null;
    const nextTool = currentTool === tool ? null : tool;
    context.state.overlayState.setChargeTool?.(nextTool);
    context.state.overlayState.setSelectMode(false);
    context.state.overlayState.setDrawBondMode(false);
    context.state.overlayState.setEraseMode(false);
    context.drawBond.cancelDrawBond();
    context.view.clearPrimitiveHover();
    clearElementButtons();
    clearBondDrawTypeButtons();
    closeDrawBondDrawer();
    context.dom.selectButton.classList.remove('active');
    context.dom.drawBondButton.classList.remove('active');
    context.dom.eraseButton.classList.remove('active');
    context.dom.panButton.classList.toggle('active', nextTool == null);
    syncChargeButtons();
    rerenderToolOverlay();
  }

  function setDrawElement(element) {
    context.state.overlayState.setDrawBondElement(element);
    if (!context.state.overlayState.getDrawBondMode()) {
      toggleDrawBondMode();
    } else {
      syncElementButtons();
    }
  }

  function setDrawBondType(type) {
    if (!DRAW_BOND_TYPES.includes(type)) {
      return;
    }
    context.state.overlayState.setDrawBondType?.(type);
    if (!context.state.overlayState.getDrawBondMode()) {
      toggleDrawBondMode();
    } else {
      syncBondDrawTypeButtons();
    }
    syncDrawBondButtonIcon();
    closeDrawBondDrawer();
    setDrawBondDrawerHoverSuppressed(true);
  }

  function handleDrawBondButtonClick() {
    if (!context.state.overlayState.getDrawBondMode()) {
      toggleDrawBondMode();
      return;
    }
    toggleDrawBondDrawer();
  }

  return {
    togglePanMode,
    toggleSelectMode,
    toggleDrawBondMode,
    toggleEraseMode,
    setChargeTool,
    setDrawElement,
    setDrawBondType,
    handleDrawBondButtonClick,
    openDrawBondDrawer,
    closeDrawBondDrawer,
    toggleDrawBondDrawer,
    syncToolButtonsFromState,
    syncElementButtons,
    clearElementButtons,
    syncBondDrawTypeButtons,
    clearBondDrawTypeButtons,
    syncChargeButtons,
    clearChargeButtons,
    syncDrawBondButtonIcon
  };
}
