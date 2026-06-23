/** @module app/ui/app-shell */

function bindGlobal(win, name, handler) {
  win[name] = handler;
  return handler;
}

function serializeCurrentMol(getMol, serialize) {
  const mol = getMol();
  if (!mol) {
    return null;
  }
  try {
    return serialize(mol);
  } catch {
    return null;
  }
}

const MAIN_SIDEBAR_WIDTH_STORAGE_KEY = 'molecules.mainSidebarWidthPx';
const MIN_MAIN_DRAWING_WIDTH_PX = 320;
const MIN_SIDEBAR_WIDTH_PX = 220;
const MAX_SIDEBAR_WIDTH_PX = 640;
const SIDEBAR_KEYBOARD_STEP_PX = 24;

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampSidebarWidth(width, contentWidth) {
  if (!Number.isFinite(width) || !Number.isFinite(contentWidth) || contentWidth <= 0) {
    return null;
  }
  const maxWidth = Math.max(MIN_SIDEBAR_WIDTH_PX, Math.min(MAX_SIDEBAR_WIDTH_PX, contentWidth - MIN_MAIN_DRAWING_WIDTH_PX));
  const minWidth = Math.min(MIN_SIDEBAR_WIDTH_PX, maxWidth);
  return Math.max(minWidth, Math.min(maxWidth, width));
}

function storageForWindow(win) {
  try {
    return win?.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Binds the draggable main/sidebar splitter.
 * @param {object} context - App shell context.
 * @param {object} [options] - Optional callbacks.
 * @param {() => void} [options.onResize] - Called after the panel width changes.
 * @returns {{clampToContainer: () => void, destroy: () => void}} Splitter controller.
 */
export function initMainSidebarResizer(context, { onResize = () => {} } = {}) {
  const { win = window } = context;
  const contentMain = context.dom.getContentMainElement?.();
  const sidebar = context.dom.getSidebarElement?.();
  const splitter = context.dom.getMainSidebarSplitterElement?.();
  const doc = context.dom.getDocument?.() ?? win.document ?? null;
  const storage = storageForWindow(win);

  if (!contentMain || !splitter || typeof contentMain.getBoundingClientRect !== 'function') {
    return {
      clampToContainer() {},
      destroy() {}
    };
  }

  let hasCustomWidth = false;
  let dragging = false;

  function containerRect() {
    return contentMain.getBoundingClientRect();
  }

  function currentSidebarWidth() {
    const styleWidth = contentMain.style?.getPropertyValue?.('--sidebar-width') ?? '';
    const styleMatch = /^([\d.]+)px$/.exec(styleWidth.trim());
    if (styleMatch) {
      return Number(styleMatch[1]);
    }
    if (sidebar && typeof sidebar.getBoundingClientRect === 'function') {
      const rect = sidebar.getBoundingClientRect();
      if (Number.isFinite(rect.width) && rect.width > 0) {
        return rect.width;
      }
    }
    const rect = containerRect();
    return rect.width * 0.29;
  }

  function syncSplitterA11y(width, contentWidth) {
    const maxWidth = clampSidebarWidth(MAX_SIDEBAR_WIDTH_PX, contentWidth) ?? MAX_SIDEBAR_WIDTH_PX;
    const minWidth = Math.min(MIN_SIDEBAR_WIDTH_PX, maxWidth);
    splitter.setAttribute?.('aria-valuemin', String(Math.round(minWidth)));
    splitter.setAttribute?.('aria-valuemax', String(Math.round(maxWidth)));
    splitter.setAttribute?.('aria-valuenow', String(Math.round(width)));
  }

  function applyWidth(width, { persist = false, notify = false } = {}) {
    const rect = containerRect();
    const clamped = clampSidebarWidth(width, rect.width);
    if (clamped == null) {
      return null;
    }
    hasCustomWidth = true;
    contentMain.style?.setProperty?.('--sidebar-width', `${Math.round(clamped)}px`);
    syncSplitterA11y(clamped, rect.width);
    if (persist) {
      try {
        storage?.setItem?.(MAIN_SIDEBAR_WIDTH_STORAGE_KEY, String(Math.round(clamped)));
      } catch {
        // Ignore storage failures; resizing should keep working for the session.
      }
    }
    if (notify) {
      onResize();
    }
    return clamped;
  }

  function widthFromPointer(event) {
    const rect = containerRect();
    return rect.right - event.clientX;
  }

  function stopDragging() {
    dragging = false;
    doc?.removeEventListener?.('pointermove', handlePointerMove);
    doc?.removeEventListener?.('pointerup', handlePointerUp);
    doc?.removeEventListener?.('pointercancel', handlePointerUp);
    doc?.body?.classList?.remove?.('resizing-main-sidebar');
  }

  function handlePointerMove(event) {
    if (!dragging) {
      return;
    }
    event.preventDefault?.();
    applyWidth(widthFromPointer(event), { notify: true });
  }

  function handlePointerUp(event) {
    if (dragging) {
      event.preventDefault?.();
      applyWidth(widthFromPointer(event), { persist: true, notify: true });
    }
    stopDragging();
  }

  function handlePointerDown(event) {
    if (event.button != null && event.button !== 0) {
      return;
    }
    event.preventDefault?.();
    dragging = true;
    splitter.setPointerCapture?.(event.pointerId);
    doc?.body?.classList?.add?.('resizing-main-sidebar');
    doc?.addEventListener?.('pointermove', handlePointerMove);
    doc?.addEventListener?.('pointerup', handlePointerUp);
    doc?.addEventListener?.('pointercancel', handlePointerUp);
  }

  function handleKeyDown(event) {
    let nextWidth = null;
    if (event.key === 'ArrowLeft') {
      nextWidth = currentSidebarWidth() + SIDEBAR_KEYBOARD_STEP_PX;
    } else if (event.key === 'ArrowRight') {
      nextWidth = currentSidebarWidth() - SIDEBAR_KEYBOARD_STEP_PX;
    } else if (event.key === 'Home') {
      nextWidth = MIN_SIDEBAR_WIDTH_PX;
    } else if (event.key === 'End') {
      nextWidth = MAX_SIDEBAR_WIDTH_PX;
    }
    if (nextWidth == null) {
      return;
    }
    event.preventDefault?.();
    applyWidth(nextWidth, { persist: true, notify: true });
  }

  const storedWidth = finiteNumber(storage?.getItem?.(MAIN_SIDEBAR_WIDTH_STORAGE_KEY));
  if (storedWidth != null) {
    applyWidth(storedWidth);
  } else {
    syncSplitterA11y(currentSidebarWidth(), containerRect().width);
  }

  splitter.addEventListener?.('pointerdown', handlePointerDown);
  splitter.addEventListener?.('keydown', handleKeyDown);

  return {
    clampToContainer() {
      if (hasCustomWidth) {
        applyWidth(currentSidebarWidth());
      }
    },
    destroy() {
      stopDragging();
      splitter.removeEventListener?.('pointerdown', handlePointerDown);
      splitter.removeEventListener?.('keydown', handleKeyDown);
    }
  };
}

/**
 * Binds all global window action handlers required by the application shell.
 * @param {object} context - Flat app context providing DOM, history, export, options, and navigation accessors.
 * @returns {void}
 */
export function initAppShell(context) {
  const { win = window } = context;

  bindGlobal(win, 'undoAction', () => context.history.undo());
  bindGlobal(win, 'redoAction', () => context.history.redo());

  bindGlobal(win, 'copyForcePng', () => context.exportActions.copyForcePng());
  bindGlobal(win, 'copyForceSvg', () => context.exportActions.copyForceSvg());
  bindGlobal(win, 'copySvg2d', () => context.exportActions.copySvg2d());
  bindGlobal(win, 'savePng2d', () => context.exportActions.savePng2d());

  bindGlobal(win, 'openOptionsModal', () => context.options.open());

  bindGlobal(win, 'toggleLabels', () => {
    const svgEl = context.dom.getPlotElement();
    svgEl.classList.toggle('labels-hidden');
    const btn = context.dom.getLabelToggleElement();
    btn.classList.toggle('active', !svgEl.classList.contains('labels-hidden'));
  });

  bindGlobal(win, 'autoZoomView', () => context.navigation.autoZoom());
  bindGlobal(win, 'cleanLayout2d', () => context.navigation.cleanLayout2d());
  bindGlobal(win, 'cleanLayoutForce', () => context.navigation.cleanLayoutForce());
  bindGlobal(win, 'togglePanMode', () => context.selection.togglePanMode());
  bindGlobal(win, 'toggleSelectMode', () => context.selection.toggleSelectMode());
  bindGlobal(win, 'togglePaintMode', () => context.selection.togglePaintMode());
  bindGlobal(win, 'setPaintTool', tool => context.selection.setPaintTool(tool));
  bindGlobal(win, 'setPaintColor', color => context.selection.setPaintColor(color));
  bindGlobal(win, 'setPaintBrushSize', size => context.selection.setPaintBrushSize(size));
  bindGlobal(win, 'setPaintOpacity', opacity => context.selection.setPaintOpacity(opacity));
  bindGlobal(win, 'toggleDrawBondMode', () => context.selection.toggleDrawBondMode());
  bindGlobal(win, 'handleDrawBondButtonClick', () => context.selection.handleDrawBondButtonClick());
  bindGlobal(win, 'handleRingTemplateButtonClick', () => context.selection.handleRingTemplateButtonClick());
  bindGlobal(win, 'setRingTemplateSize', size => context.selection.setRingTemplateSize(size));
  bindGlobal(win, 'openDrawBondDrawer', () => context.selection.openDrawBondDrawer());
  bindGlobal(win, 'closeDrawBondDrawer', () => context.selection.closeDrawBondDrawer());
  bindGlobal(win, 'toggleEraseMode', () => context.selection.toggleEraseMode());
  bindGlobal(win, 'setChargeTool', tool => context.selection.setChargeTool(tool));
  bindGlobal(win, 'setDrawElement', el => context.selection.setDrawElement(el));
  bindGlobal(win, 'togglePeriodicTablePicker', () => context.selection.togglePeriodicTablePicker());
  bindGlobal(win, 'selectPeriodicElement', el => context.selection.selectPeriodicElement(el));
  bindGlobal(win, 'setDrawBondType', type => context.selection.setDrawBondType(type));
  bindGlobal(win, 'toggleMode', () => context.navigation.toggleMode());

  bindGlobal(win, '_parseSmiles', smiles => context.input.parseSmiles(smiles));
  bindGlobal(win, '_parseInchi', inchi => context.input.parseInchi(inchi));
  bindGlobal(win, '_parseInput', value => context.input.parseInput(value));
  bindGlobal(win, '_setInputFormat', (fmt, options = {}) => context.input.setInputFormat(fmt, options));
  bindGlobal(win, '_renderExamples', () => context.input.renderExamples());
  bindGlobal(win, '_pickRandomMolecule', () => context.input.pickRandomMolecule());
  bindGlobal(win, '_pickDebugMolecule', () => context.input.pickDebugMolecule());
  bindGlobal(win, '_getMolSmiles', () => serializeCurrentMol(context.input.getCanonicalMol, context.input.toSmiles));
  bindGlobal(win, '_getMolInchi', () => serializeCurrentMol(context.input.getCanonicalMol, context.input.toInchi));
  bindGlobal(win, '_takeInputFormatSnapshot', payload => context.input.takeInputFormatSnapshot(payload));
  bindGlobal(win, 'deleteSelection', () => context.editing.deleteSelection());

  let mainSidebarResizer = null;
  const handleResize = () => {
    mainSidebarResizer?.clampToContainer();
    if (!context.state.hasLoadedInput()) {
      return;
    }
    if (context.state.getMode() === 'force') {
      context.view.handleForceResize();
      return;
    }
    context.view.handle2DResize();
  };

  mainSidebarResizer = initMainSidebarResizer(context, { onResize: handleResize });
  win.addEventListener('resize', handleResize);

  function bootstrap() {
    context.input.renderExamples();
    const initialSmiles = context.initialState.getInitialSmiles();
    context.initialState.setInputValue(initialSmiles);
    context.initialState.syncCollectionPicker(initialSmiles);
    context.input.parseSmiles(initialSmiles);
  }

  return {
    bootstrap,
    handleResize
  };
}
