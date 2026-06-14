/** @module app/interactions/selection */

const DRAW_ELEMENTS = ['C', 'N', 'O', 'S', 'P', 'F', 'Cl', 'Br', 'I'];
const DRAW_BOND_TYPES = ['single', 'double', 'triple', 'aromatic', 'wedge', 'dash'];
const RING_TEMPLATE_SIZES = [3, 4, 5, 6, 7];
const CHARGE_TOOLS = ['positive', 'negative'];
const PAINT_TOOLS = ['brush', 'bucket', 'eraser'];
const DEFAULT_PAINT_COLOR = '#3366ff';
const DEFAULT_PAINT_OPACITY = 1;
const PAINT_CURSOR_SIZE = 24;
const PAINT_CURSOR_CENTER = PAINT_CURSOR_SIZE / 2;
const PAINT_CURSOR_RADIUS = 11;
const PAINT_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

function normalizePaintColor(value) {
  return PAINT_COLOR_PATTERN.test(value ?? '') ? value.toLowerCase() : DEFAULT_PAINT_COLOR;
}

function normalizePaintOpacity(value) {
  const opacity = Number(value);
  if (!Number.isFinite(opacity)) {
    return DEFAULT_PAINT_OPACITY;
  }
  return Math.round(Math.min(1, Math.max(0, opacity)) * 100) / 100;
}

function paintSwatchColor(color, opacity = DEFAULT_PAINT_OPACITY) {
  const normalizedColor = normalizePaintColor(color);
  const normalizedOpacity = normalizePaintOpacity(opacity);
  const red = Number.parseInt(normalizedColor.slice(1, 3), 16);
  const green = Number.parseInt(normalizedColor.slice(3, 5), 16);
  const blue = Number.parseInt(normalizedColor.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${normalizedOpacity})`;
}

function paintCursorValue(color, opacity = DEFAULT_PAINT_OPACITY, tool = 'brush') {
  const fill = tool === 'eraser' ? 'none' : encodeURIComponent(normalizePaintColor(color));
  const fillOpacity = tool === 'eraser' ? '' : ` fill-opacity='${normalizePaintOpacity(opacity)}'`;
  return `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${PAINT_CURSOR_SIZE}' height='${PAINT_CURSOR_SIZE}' viewBox='0 0 ${PAINT_CURSOR_SIZE} ${PAINT_CURSOR_SIZE}'%3E%3Ccircle cx='${PAINT_CURSOR_CENTER}' cy='${PAINT_CURSOR_CENTER}' r='${PAINT_CURSOR_RADIUS}' fill='${fill}'${fillOpacity} stroke='black' stroke-width='2'/%3E%3C/svg%3E") ${PAINT_CURSOR_CENTER} ${PAINT_CURSOR_CENTER}, crosshair`;
}

/**
 * Creates a small active-button synchronizer for toolbar controls.
 * @param {string[]} items - Supported toolbar item values.
 * @param {(item: string) => HTMLElement|HTMLElement[]|null} getButton - Button lookup callback.
 * @returns {{sync: (activeValue: string) => void, clear: () => void}} Synchronizer helpers.
 */
function createButtonSynchronizer(items, getButton) {
  function forEachButton(item, callback) {
    const buttons = getButton(item);
    const list = Array.isArray(buttons) ? buttons : [buttons];
    for (const button of list) {
      if (button) {
        callback(button);
      }
    }
  }

  return {
    sync(activeValue) {
      for (const item of items) {
        forEachButton(item, button => {
          button.classList.toggle('active', item === activeValue);
        });
      }
    },
    clear() {
      for (const item of items) {
        forEachButton(item, button => {
          button.classList.remove('active');
        });
      }
    }
  };
}

/**
 * Creates selection action handlers for tool-mode toggling, element/bond-type
 * switching, and toolbar button synchronization.
 * @param {object} context - Dependency context providing state, view, DOM, renderers, and actions.
 * @returns {object} Selection action API and sync/clear button helpers.
 */
export function createSelectionActions(context) {
  function setDrawBondDrawerHoverSuppressed(value) {
    context.dom.drawTools?.classList?.toggle?.('drawer-hover-suppressed', value);
  }

  function setRingTemplateDrawerHoverSuppressed(value) {
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
        const hasOpenDrawer =
          context.dom.drawTools?.classList?.contains?.('drawer-open') || context.dom.drawTools?.classList?.contains?.('ring-template-drawer-open');
        if (!hasOpenDrawer) {
          return;
        }
        if (typeof event?.target?.closest === 'function' && event.target.closest('#draw-tools')) {
          return;
        }
        closeDrawBondDrawer();
        closeRingTemplateDrawer();
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

  function syncRingTemplateButtonIcon() {
    const activeSize = context.state.overlayState.getRingTemplateSize?.() ?? 6;
    const sourceButton = context.dom.getRingTemplateSizeButton?.(activeSize);
    const ringTemplateButton = context.dom.ringTemplateButton;
    if (!sourceButton || !ringTemplateButton || typeof sourceButton.innerHTML !== 'string') {
      return;
    }
    ringTemplateButton.innerHTML = sourceButton.innerHTML;
  }

  function openDrawBondDrawer() {
    setDrawBondDrawerHoverSuppressed(false);
    context.dom.drawTools?.classList?.add('drawer-open');
  }

  function closeDrawBondDrawer() {
    context.dom.drawTools?.classList?.remove('drawer-open');
  }

  function openRingTemplateDrawer() {
    setRingTemplateDrawerHoverSuppressed(false);
    context.dom.drawTools?.classList?.add('ring-template-drawer-open');
  }

  function closeRingTemplateDrawer() {
    context.dom.drawTools?.classList?.remove('ring-template-drawer-open');
  }

  function toggleRingTemplateDrawer() {
    if (!context.dom.drawTools?.classList) {
      return;
    }
    context.dom.drawTools.classList.toggle('ring-template-drawer-open');
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
    const ringTemplateMode = context.state.overlayState.getRingTemplateMode?.() ?? false;
    const eraseMode = context.state.overlayState.getEraseMode();
    const paintMode = context.state.overlayState.getPaintMode?.() ?? false;
    const chargeTool = context.state.overlayState.getChargeTool?.() ?? null;
    const panMode = !selectMode && !drawBondMode && !ringTemplateMode && !eraseMode && !paintMode && chargeTool == null;

    context.dom.panButton.classList.toggle('active', panMode);
    context.dom.selectButton.classList.toggle('active', selectMode);
    context.dom.drawBondButton.classList.toggle('active', drawBondMode);
    context.dom.ringTemplateButton?.classList?.toggle('active', ringTemplateMode);
    context.dom.eraseButton.classList.toggle('active', eraseMode);
    syncPaintButtons(paintMode);
    syncPaintCursor(paintMode);
    syncPaintButtonIcon();
    syncPaintToolButtons(paintMode);
    syncPaintToolStyles();
    syncPaintColorSelectors();
    syncPaintOpacitySelectors();
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

    if (ringTemplateMode) {
      syncRingTemplateSizeButtons();
      syncRingTemplateButtonIcon();
    } else {
      clearRingTemplateSizeButtons();
      closeRingTemplateDrawer();
    }
  }

  const chargeSync = createButtonSynchronizer(CHARGE_TOOLS, tool => context.dom.getChargeToolButton?.(tool));
  const elementSync = createButtonSynchronizer(DRAW_ELEMENTS, element => context.dom.getElementButton(element));
  const bondTypeSync = createButtonSynchronizer(DRAW_BOND_TYPES, type => context.dom.getBondDrawTypeButton?.(type));
  const ringTemplateSizeSync = createButtonSynchronizer(RING_TEMPLATE_SIZES, size => context.dom.getRingTemplateSizeButton?.(size));
  const paintToolSync = createButtonSynchronizer(PAINT_TOOLS, tool => context.dom.getPaintToolButtons?.(tool) ?? []);
  bindPaintColorSelectors();
  bindPaintOpacitySelectors();

  function syncChargeButtons() {
    chargeSync.sync(context.state.overlayState.getChargeTool?.() ?? null);
  }
  function clearChargeButtons() {
    chargeSync.clear();
  }
  function syncPaintButtons(active = context.state.overlayState.getPaintMode?.() ?? false) {
    for (const button of context.dom.getStyleBrushButtons?.() ?? []) {
      button?.classList?.toggle?.('active', active);
    }
  }
  function syncPaintCursor(
    active = context.state.overlayState.getPaintMode?.() ?? false,
    color = context.state.overlayState.getPaintColor?.() ?? DEFAULT_PAINT_COLOR,
    opacity = context.state.overlayState.getPaintOpacity?.() ?? DEFAULT_PAINT_OPACITY,
    tool = context.state.overlayState.getPaintTool?.() ?? 'brush'
  ) {
    context.dom.plotElement?.style?.setProperty?.('--paint-mode-cursor', paintCursorValue(color, opacity, tool));
    context.dom.plotElement?.classList?.toggle?.('paint-mode-cursor', active);
  }
  function syncPaintButtonIcon(tool = context.state.overlayState.getPaintTool?.() ?? 'brush') {
    const sourceButtons = context.dom.getPaintToolButtons?.(tool) ?? [];
    const sourceButton = Array.isArray(sourceButtons) ? sourceButtons.find(button => typeof button?.innerHTML === 'string') : sourceButtons;
    if (!sourceButton || typeof sourceButton.innerHTML !== 'string') {
      return;
    }
    for (const button of context.dom.getStyleBrushButtons?.() ?? []) {
      if (button && typeof button.innerHTML === 'string') {
        button.innerHTML = sourceButton.innerHTML;
      }
    }
  }
  function syncPaintToolStyles(tool = context.state.overlayState.getPaintTool?.() ?? 'brush') {
    const eraserTool = tool === 'eraser';
    for (const button of context.dom.getStyleBrushButtons?.() ?? []) {
      button?.classList?.toggle?.('paint-eraser-tool', eraserTool);
    }
    syncPaintCursor(
      context.state.overlayState.getPaintMode?.() ?? false,
      context.state.overlayState.getPaintColor?.() ?? DEFAULT_PAINT_COLOR,
      context.state.overlayState.getPaintOpacity?.() ?? DEFAULT_PAINT_OPACITY,
      tool
    );
  }
  function syncPaintColorSelectors(color = normalizePaintColor(context.state.overlayState.getPaintColor?.() ?? DEFAULT_PAINT_COLOR)) {
    const normalizedColor = normalizePaintColor(color);
    const normalizedOpacity = normalizePaintOpacity(context.state.overlayState.getPaintOpacity?.() ?? DEFAULT_PAINT_OPACITY);
    const swatchColor = paintSwatchColor(normalizedColor, normalizedOpacity);
    for (const selector of context.dom.getPaintColorSelectors?.() ?? []) {
      if (!selector) {
        continue;
      }
      if ('value' in selector) {
        selector.value = normalizedColor;
      }
      selector.style?.setProperty?.('--paint-color', normalizedColor);
      selector.style?.setProperty?.('--paint-opacity', String(normalizedOpacity));
      selector.style?.setProperty?.('--paint-swatch-color', swatchColor);
      if (selector.style) {
        selector.style.backgroundColor = swatchColor;
      }
    }
    for (const selector of context.dom.getPaintOpacitySelectors?.() ?? []) {
      selector?.style?.setProperty?.('--paint-color', normalizedColor);
    }
    syncPaintCursor(
      context.state.overlayState.getPaintMode?.() ?? false,
      normalizedColor,
      context.state.overlayState.getPaintOpacity?.() ?? DEFAULT_PAINT_OPACITY,
      context.state.overlayState.getPaintTool?.() ?? 'brush'
    );
  }
  function setPaintColor(color) {
    const normalizedColor = normalizePaintColor(color);
    context.state.overlayState.setPaintColor?.(normalizedColor);
    syncPaintColorSelectors(normalizedColor);
  }
  function syncPaintOpacitySelectors(opacity = normalizePaintOpacity(context.state.overlayState.getPaintOpacity?.() ?? DEFAULT_PAINT_OPACITY)) {
    const normalizedOpacity = normalizePaintOpacity(opacity);
    const normalizedColor = normalizePaintColor(context.state.overlayState.getPaintColor?.() ?? DEFAULT_PAINT_COLOR);
    const swatchColor = paintSwatchColor(normalizedColor, normalizedOpacity);
    for (const selector of context.dom.getPaintOpacitySelectors?.() ?? []) {
      if (!selector) {
        continue;
      }
      if ('value' in selector) {
        selector.value = String(normalizedOpacity);
      }
      selector.style?.setProperty?.('--paint-opacity', String(normalizedOpacity));
      selector.style?.setProperty?.('--paint-color', normalizedColor);
    }
    for (const selector of context.dom.getPaintColorSelectors?.() ?? []) {
      selector?.style?.setProperty?.('--paint-opacity', String(normalizedOpacity));
      selector?.style?.setProperty?.('--paint-swatch-color', swatchColor);
      if (selector?.style) {
        selector.style.backgroundColor = swatchColor;
      }
    }
    syncPaintCursor(
      context.state.overlayState.getPaintMode?.() ?? false,
      context.state.overlayState.getPaintColor?.() ?? DEFAULT_PAINT_COLOR,
      normalizedOpacity,
      context.state.overlayState.getPaintTool?.() ?? 'brush'
    );
  }
  function setPaintOpacity(opacity) {
    const normalizedOpacity = normalizePaintOpacity(opacity);
    context.state.overlayState.setPaintOpacity?.(normalizedOpacity);
    syncPaintOpacitySelectors(normalizedOpacity);
  }
  function bindPaintColorSelectors() {
    for (const selector of context.dom.getPaintColorSelectors?.() ?? []) {
      if (!selector || typeof selector.addEventListener !== 'function' || selector.__paintColorSyncBound) {
        continue;
      }
      const handleColorInput = () => {
        setPaintColor(selector.value);
      };
      selector.addEventListener('input', handleColorInput);
      selector.addEventListener('change', handleColorInput);
      selector.__paintColorSyncBound = true;
    }
  }
  function bindPaintOpacitySelectors() {
    for (const selector of context.dom.getPaintOpacitySelectors?.() ?? []) {
      if (!selector || typeof selector.addEventListener !== 'function' || selector.__paintOpacitySyncBound) {
        continue;
      }
      const handleOpacityInput = () => {
        setPaintOpacity(selector.value);
      };
      selector.addEventListener('input', handleOpacityInput);
      selector.addEventListener('change', handleOpacityInput);
      selector.__paintOpacitySyncBound = true;
    }
  }
  function setPaintMode(value) {
    context.state.overlayState.setPaintMode?.(value);
    syncPaintButtons(value);
    syncPaintCursor(value);
    syncPaintButtonIcon();
    syncPaintToolButtons(value);
    syncPaintToolStyles();
    syncPaintColorSelectors();
    syncPaintOpacitySelectors();
  }
  function syncPaintToolButtons(active = context.state.overlayState.getPaintMode?.() ?? false) {
    if (active) {
      paintToolSync.sync(context.state.overlayState.getPaintTool?.() ?? 'brush');
    } else {
      paintToolSync.clear();
    }
  }
  function syncElementButtons() {
    elementSync.sync(context.state.overlayState.getDrawBondElement());
  }
  function clearElementButtons() {
    elementSync.clear();
  }
  function syncBondDrawTypeButtons() {
    bondTypeSync.sync(context.state.overlayState.getDrawBondType?.() ?? 'single');
  }
  function clearBondDrawTypeButtons() {
    bondTypeSync.clear();
  }
  function syncRingTemplateSizeButtons() {
    ringTemplateSizeSync.sync(context.state.overlayState.getRingTemplateSize?.() ?? 6);
  }
  function clearRingTemplateSizeButtons() {
    ringTemplateSizeSync.clear();
  }

  function rerenderToolOverlay() {
    if (context.state.viewState.getMode() === 'force') {
      context.renderers.applyForceSelection();
    } else if (context.state.documentState.getMol2d()) {
      context.renderers.draw2d();
    }
  }

  function enterPaintMode() {
    setPaintMode(true);
    context.state.overlayState.setSelectMode(false);
    context.state.overlayState.setDrawBondMode(false);
    context.state.overlayState.setRingTemplateMode?.(false);
    context.state.overlayState.setEraseMode(false);
    context.state.overlayState.setErasePainting(false);
    context.state.overlayState.setChargeTool?.(null);
    context.drawBond.cancelDrawBond();
    context.view.clearPrimitiveHover();
    clearElementButtons();
    clearBondDrawTypeButtons();
    clearChargeButtons();
    closeDrawBondDrawer();
    closeRingTemplateDrawer();
    context.dom.panButton.classList.remove('active');
    context.dom.selectButton.classList.remove('active');
    context.dom.drawBondButton.classList.remove('active');
    context.dom.ringTemplateButton?.classList?.remove('active');
    context.dom.eraseButton.classList.remove('active');
  }

  function togglePanMode() {
    if (
      !context.state.overlayState.getSelectMode() &&
      !context.state.overlayState.getDrawBondMode() &&
      !(context.state.overlayState.getRingTemplateMode?.() ?? false) &&
      !context.state.overlayState.getEraseMode() &&
      !(context.state.overlayState.getPaintMode?.() ?? false) &&
      (context.state.overlayState.getChargeTool?.() ?? null) == null
    ) {
      return;
    }
    context.state.overlayState.setSelectMode(false);
    context.state.overlayState.setDrawBondMode(false);
    context.state.overlayState.setRingTemplateMode?.(false);
    context.state.overlayState.setEraseMode(false);
    setPaintMode(false);
    context.state.overlayState.setChargeTool?.(null);
    context.drawBond.cancelDrawBond();
    context.view.clearPrimitiveHover();
    clearElementButtons();
    clearBondDrawTypeButtons();
    clearChargeButtons();
    closeDrawBondDrawer();
    closeRingTemplateDrawer();
    context.dom.panButton.classList.add('active');
    context.dom.selectButton.classList.remove('active');
    context.dom.drawBondButton.classList.remove('active');
    context.dom.ringTemplateButton?.classList?.remove('active');
    context.dom.eraseButton.classList.remove('active');
    rerenderToolOverlay();
  }

  function toggleSelectMode() {
    if (context.state.overlayState.getSelectMode()) {
      return;
    }
    context.state.overlayState.setSelectMode(true);
    context.state.overlayState.setDrawBondMode(false);
    context.state.overlayState.setRingTemplateMode?.(false);
    context.state.overlayState.setEraseMode(false);
    setPaintMode(false);
    context.state.overlayState.setChargeTool?.(null);
    context.drawBond.cancelDrawBond();
    context.view.clearPrimitiveHover();
    clearElementButtons();
    clearBondDrawTypeButtons();
    clearChargeButtons();
    closeDrawBondDrawer();
    closeRingTemplateDrawer();
    context.dom.selectButton.classList.add('active');
    context.dom.panButton.classList.remove('active');
    context.dom.drawBondButton.classList.remove('active');
    context.dom.ringTemplateButton?.classList?.remove('active');
    context.dom.eraseButton.classList.remove('active');
  }

  function togglePaintMode() {
    const next = !(context.state.overlayState.getPaintMode?.() ?? false);
    if (next) {
      enterPaintMode();
    } else {
      setPaintMode(false);
      context.view.clearPrimitiveHover();
      context.dom.panButton.classList.add('active');
      clearChargeButtons();
    }
    rerenderToolOverlay();
  }

  function setPaintTool(tool) {
    if (!PAINT_TOOLS.includes(tool)) {
      return;
    }
    context.state.overlayState.setPaintTool?.(tool);
    if (!(context.state.overlayState.getPaintMode?.() ?? false)) {
      enterPaintMode();
      rerenderToolOverlay();
      return;
    }
    syncPaintButtonIcon(tool);
    syncPaintToolButtons(true);
    syncPaintToolStyles(tool);
    syncPaintColorSelectors();
    syncPaintOpacitySelectors();
  }

  function toggleDrawBondMode() {
    const next = !context.state.overlayState.getDrawBondMode();
    context.state.overlayState.setDrawBondMode(next);
    const btn = context.dom.drawBondButton;
    if (next) {
      context.state.overlayState.setSelectMode(false);
      context.state.overlayState.setRingTemplateMode?.(false);
      context.state.overlayState.setEraseMode(false);
      setPaintMode(false);
      context.state.overlayState.setChargeTool?.(null);
      context.drawBond.cancelDrawBond();
      context.view.clearPrimitiveHover();
      context.dom.panButton.classList.remove('active');
      context.dom.selectButton.classList.remove('active');
      context.dom.eraseButton.classList.remove('active');
      clearChargeButtons();
      clearRingTemplateSizeButtons();
      closeRingTemplateDrawer();
      context.dom.ringTemplateButton?.classList?.remove('active');
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
      closeRingTemplateDrawer();
    }
    rerenderToolOverlay();
  }

  function toggleRingTemplateMode() {
    const next = !(context.state.overlayState.getRingTemplateMode?.() ?? false);
    context.state.overlayState.setRingTemplateMode?.(next);
    const btn = context.dom.ringTemplateButton;
    if (next) {
      context.state.overlayState.setSelectMode(false);
      context.state.overlayState.setDrawBondMode(false);
      context.state.overlayState.setEraseMode(false);
      setPaintMode(false);
      context.state.overlayState.setChargeTool?.(null);
      context.drawBond.cancelDrawBond();
      context.view.clearPrimitiveHover();
      context.dom.panButton.classList.remove('active');
      context.dom.selectButton.classList.remove('active');
      context.dom.drawBondButton.classList.remove('active');
      context.dom.eraseButton.classList.remove('active');
      clearElementButtons();
      clearBondDrawTypeButtons();
      clearChargeButtons();
      closeDrawBondDrawer();
      btn?.classList?.add('active');
      syncRingTemplateSizeButtons();
      syncRingTemplateButtonIcon();
    } else {
      context.view.clearPrimitiveHover();
      context.dom.panButton.classList.add('active');
      btn?.classList?.remove('active');
      clearRingTemplateSizeButtons();
      clearChargeButtons();
      closeRingTemplateDrawer();
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
      context.state.overlayState.setRingTemplateMode?.(false);
      setPaintMode(false);
      context.state.overlayState.setChargeTool?.(null);
      context.drawBond.cancelDrawBond();
      clearElementButtons();
      clearBondDrawTypeButtons();
      clearChargeButtons();
      closeDrawBondDrawer();
      closeRingTemplateDrawer();
      context.dom.panButton.classList.remove('active');
      context.dom.selectButton.classList.remove('active');
      context.dom.drawBondButton.classList.remove('active');
      context.dom.ringTemplateButton?.classList?.remove('active');
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
    context.state.overlayState.setRingTemplateMode?.(false);
    context.state.overlayState.setEraseMode(false);
    setPaintMode(false);
    context.drawBond.cancelDrawBond();
    context.view.clearPrimitiveHover();
    clearElementButtons();
    clearBondDrawTypeButtons();
    closeDrawBondDrawer();
    closeRingTemplateDrawer();
    context.dom.selectButton.classList.remove('active');
    context.dom.drawBondButton.classList.remove('active');
    context.dom.ringTemplateButton?.classList?.remove('active');
    context.dom.eraseButton.classList.remove('active');
    context.dom.panButton.classList.toggle('active', nextTool == null);
    syncChargeButtons();
    rerenderToolOverlay();
  }

  function setRingTemplateSize(size) {
    const normalizedSize = Number(size);
    if (!RING_TEMPLATE_SIZES.includes(normalizedSize)) {
      return;
    }
    context.state.overlayState.setRingTemplateSize?.(normalizedSize);
    if (!(context.state.overlayState.getRingTemplateMode?.() ?? false)) {
      toggleRingTemplateMode();
    } else {
      syncRingTemplateSizeButtons();
    }
    syncRingTemplateButtonIcon();
    closeRingTemplateDrawer();
    setRingTemplateDrawerHoverSuppressed(true);
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
    toggleDrawBondMode();
  }

  function handleRingTemplateButtonClick() {
    toggleRingTemplateMode();
    if (context.state.overlayState.getRingTemplateMode?.() ?? false) {
      toggleRingTemplateDrawer();
    }
  }

  return {
    togglePanMode,
    toggleSelectMode,
    togglePaintMode,
    setPaintTool,
    setPaintColor,
    setPaintOpacity,
    toggleDrawBondMode,
    toggleRingTemplateMode,
    setRingTemplateSize,
    toggleEraseMode,
    setChargeTool,
    setDrawElement,
    setDrawBondType,
    handleDrawBondButtonClick,
    handleRingTemplateButtonClick,
    openDrawBondDrawer,
    closeDrawBondDrawer,
    openRingTemplateDrawer,
    closeRingTemplateDrawer,
    toggleDrawBondDrawer,
    toggleRingTemplateDrawer,
    syncToolButtonsFromState,
    syncElementButtons,
    clearElementButtons,
    syncBondDrawTypeButtons,
    clearBondDrawTypeButtons,
    syncRingTemplateSizeButtons,
    clearRingTemplateSizeButtons,
    syncRingTemplateButtonIcon,
    syncChargeButtons,
    clearChargeButtons,
    syncDrawBondButtonIcon
  };
}
