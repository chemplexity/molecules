/** @module app/ui/app-shell-deps */

/**
 * Builds the structured dependency object for the AppShell factory,
 * mapping flat dependency properties into named sub-objects (win, dom, history, exportActions, options, navigation, selection, editing, state, view, input, initialState).
 * @param {object} deps - Flat app context providing AppShell-related methods and values.
 * @returns {object} Dependency object consumed by `createAppShell`.
 */
export function createAppShellDeps(deps) {
  return {
    win: deps.win,
    dom: {
      getDocument: deps.dom.getDocument,
      getPlotElement: deps.dom.getPlotElement,
      getLabelToggleElement: deps.dom.getLabelToggleElement,
      getContentMainElement: deps.dom.getContentMainElement,
      getSidebarElement: deps.dom.getSidebarElement,
      getMainSidebarSplitterElement: deps.dom.getMainSidebarSplitterElement
    },
    history: {
      undo: deps.history.undo,
      redo: deps.history.redo
    },
    exportActions: {
      copyForcePng: deps.exportActions.copyForcePng,
      copyForceSvg: deps.exportActions.copyForceSvg,
      copySvg2d: deps.exportActions.copySvg2d,
      savePng2d: deps.exportActions.savePng2d
    },
    options: {
      open: deps.options.open
    },
    navigation: {
      autoZoom: deps.navigation.autoZoom,
      cleanLayout2d: deps.navigation.cleanLayout2d,
      cleanLayoutForce: deps.navigation.cleanLayoutForce,
      toggleMode: deps.navigation.toggleMode
    },
    selection: {
      togglePanMode: deps.selection.togglePanMode,
      toggleSelectMode: deps.selection.toggleSelectMode,
      togglePaintMode: deps.selection.togglePaintMode,
      setPaintTool: deps.selection.setPaintTool,
      setPaintColor: deps.selection.setPaintColor,
      setPaintBrushSize: deps.selection.setPaintBrushSize,
      setPaintOpacity: deps.selection.setPaintOpacity,
      toggleDrawBondMode: deps.selection.toggleDrawBondMode,
      handleDrawBondButtonClick: deps.selection.handleDrawBondButtonClick,
      handleRingTemplateButtonClick: deps.selection.handleRingTemplateButtonClick,
      setRingTemplateSize: deps.selection.setRingTemplateSize,
      openDrawBondDrawer: deps.selection.openDrawBondDrawer,
      closeDrawBondDrawer: deps.selection.closeDrawBondDrawer,
      toggleEraseMode: deps.selection.toggleEraseMode,
      setChargeTool: deps.selection.setChargeTool,
      setDrawElement: deps.selection.setDrawElement,
      togglePeriodicTablePicker: deps.selection.togglePeriodicTablePicker,
      selectPeriodicElement: deps.selection.selectPeriodicElement,
      setDrawBondType: deps.selection.setDrawBondType
    },
    editing: {
      deleteSelection: deps.editing.deleteSelection
    },
    state: {
      hasLoadedInput: deps.state.hasLoadedInput,
      getMode: deps.state.getMode
    },
    view: {
      handleForceResize: deps.view.handleForceResize,
      handle2DResize: deps.view.handle2DResize
    },
    input: {
      parseSmiles: deps.input.parseSmiles,
      parseInchi: deps.input.parseInchi,
      parseInput: deps.input.parseInput,
      setInputFormat: deps.input.setInputFormat,
      renderExamples: deps.input.renderExamples,
      pickRandomMolecule: deps.input.pickRandomMolecule,
      pickDebugMolecule: deps.input.pickDebugMolecule,
      getCanonicalMol: deps.input.getCanonicalMol,
      toSmiles: deps.input.toSmiles,
      toInchi: deps.input.toInchi,
      takeInputFormatSnapshot: deps.input.takeInputFormatSnapshot
    },
    initialState: {
      getInitialSmiles: deps.initialState.getInitialSmiles,
      setInputValue: deps.initialState.setInputValue,
      syncCollectionPicker: deps.initialState.syncCollectionPicker
    }
  };
}
