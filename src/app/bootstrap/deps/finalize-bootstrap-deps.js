/** @module app/bootstrap/deps/finalize-bootstrap-deps */

export function createFinalizeAppBootstrapDeps(ctx) {
  return {
    factories: {
      createAppDelegates: ctx.createAppDelegates,
      createUndoDeps: ctx.createUndoDeps,
      createReaction2dDeps: ctx.createReaction2dDeps,
      createResonancePanelDeps: ctx.createResonancePanelDeps,
      createBondEnPanelDeps: ctx.createBondEnPanelDeps,
      createOptionsModalDeps: ctx.createOptionsModalDeps,
      createPhyschemPanelDeps: ctx.createPhyschemPanelDeps,
      createAppShellDeps: ctx.createAppShellDeps,
      initUndo: ctx.initUndo,
      initHighlights: ctx.initHighlights,
      initExport: ctx.initExport,
      initReaction2d: ctx.initReaction2d,
      initResonancePanel: ctx.initResonancePanel,
      initBondEnPanel: ctx.initBondEnPanel,
      initNavigationInteractions: ctx.initNavigationInteractions,
      initKeyboardInteractions: ctx.initKeyboardInteractions,
      initGestureInteractions: ctx.initGestureInteractions,
      initOptionsModal: ctx.initOptionsModal,
      initPlotInteractions: ctx.initPlotInteractions,
      initTabPanels: ctx.initTabPanels,
      initPhyschemPanel: ctx.initPhyschemPanel,
      initAppShell: ctx.initAppShell
    },
    setDelegates: appDelegates => {
      ctx.setDelegates(appDelegates);
    },
    controller: ctx.appController,
    state: {
      getMode: () => ctx.runtimeState.mode,
      getCurrentMol: () => ctx.runtimeState.currentMol,
      setCurrentMol: value => {
        ctx.runtimeState.currentMol = value;
      },
      getMol2d: () => ctx.runtimeState.mol2d,
      setMol2d: value => {
        ctx.runtimeState.mol2d = value;
      },
      clear2dDerivedState: () => {
        ctx.runtimeState.hCounts2d = new Map();
        ctx.runtimeState.stereoMap2d = new Map();
      },
      getStereoMap2d: () => ctx.runtimeState.stereoMap2d,
      appState: ctx.appState,
      hasDrawBondState: () => !!ctx.getDrawBondState(),
      setDrawBondHoverSuppressed: value => {
        ctx.setDrawBondHoverSuppressed(value);
      },
      getSelectMode: () => ctx.getSelectMode(),
      getDrawBondMode: () => ctx.getDrawBondMode(),
      getEraseMode: () => ctx.getEraseMode(),
      isRenderableMode: () => ctx.runtimeState.mode === '2d' || ctx.runtimeState.mode === 'force',
      getActiveMolecule: () => (ctx.runtimeState.mode === 'force' ? ctx.runtimeState.currentMol : ctx.runtimeState.mol2d),
      getTooltipMode: () => (ctx.runtimeState.mode === 'force' ? 'force' : '2d'),
      getSelectionValenceTooltipAtomId: () => ctx.runtimeState.selectionValenceTooltipAtomId,
      setSelectionValenceTooltipAtomId: value => {
        ctx.runtimeState.selectionValenceTooltipAtomId = value;
      },
      setCapturePhyschemHighlightSnapshot: fn => {
        ctx.setCapturePhyschemHighlightSnapshot(fn);
      },
      setRestorePhyschemHighlightSnapshot: fn => {
        ctx.setRestorePhyschemHighlightSnapshot(fn);
      },
      hasLoadedInput: () => !!(ctx.runtimeState.currentSmiles || ctx.runtimeState.currentInchi),
      getCurrentSmiles: () => ctx.runtimeState.currentSmiles,
      getCurrentInchi: () => ctx.runtimeState.currentInchi,
      setFontSize: value => {
        ctx.runtimeState.fontSize = value;
      },
      getInitialSmiles: () => ctx.getInitialSmiles()
    },
    actions: {
      primitiveSelection: ctx.primitiveSelectionActions,
      structuralEditActions: ctx.runtimeState.structuralEditActions,
      drawBondPreviewActions: ctx.drawBondPreviewActions,
      drawBondCommitActions: ctx.drawBondCommitActions,
      editingActions: ctx.editingActions,
      selectionActions: ctx.selectionActions
    },
    render: {
      render2DHelpers: ctx.render2DHelpers,
      highlight2DRenderer: ctx.highlight2DRenderer,
      scene2DRenderer: ctx.scene2DRenderer,
      zoomTransformHelpers: ctx.zoomTransformHelpers,
      renderRuntime: ctx.renderRuntime,
      applyForceHighlights: () => ctx.applyForceHighlights(),
      refreshSelectionOverlay: () => ctx.refreshSelectionOverlay(),
      applySelectionOverlay: () => (ctx.runtimeState.mode === 'force' ? ctx.applyForceSelection() : ctx.selectionOverlayManager.redraw2dSelection()),
      updateForce: (mol, options = {}) => ctx.forceSceneRenderer.updateForce(mol, options)
    },
    stereo: {
      syncDisplayStereo: ctx.syncDisplayStereo
    },
    overlays: {
      clearReactionPreviewState: () => ctx.clearReactionPreviewState(),
      restoreReactionPreviewSource: options => ctx.restoreReactionPreviewSource(options),
      hasReactionPreview: () => ctx.hasReactionPreview(),
      isReactionPreviewEditableAtomId: id => ctx.isReactionPreviewEditableAtomId(id),
      getReactionPreviewSourceMol: () => ctx.getReactionPreviewSourceMol()
    },
    history: {
      takeSnapshot: options => ctx.takeSnapshot(options),
      undoAction: () => ctx.undoAction(),
      redoAction: () => ctx.redoAction()
    },
    dom: {
      d3: ctx.d3,
      svg: ctx.svg,
      g: ctx.g,
      plotEl: ctx.plotEl,
      simulation: ctx.simulation,
      document: ctx.document,
      window: ctx.window,
      tooltip: ctx.tooltip,
      ...ctx.domElements,
      setInputValue: value => ctx.domElements.setInputValue(value)
    },
    view: {
      clearPrimitiveHover: () => ctx.clearPrimitiveHover(),
      showPrimitiveHover: (atomIds = [], bondIds = []) => ctx.showPrimitiveHover(atomIds, bondIds),
      getZoomTransform: () => ctx.d3.zoomTransform(ctx.svg.node()),
      setZoomTransform: transform => ctx.svg.call(ctx.zoom.transform, transform),
      makeZoomIdentity: (x, y, k) => ctx.d3.zoomIdentity.translate(x, y).scale(k),
      hideTooltip: () => {
        ctx.runtimeState.selectionValenceTooltipAtomId = null;
        ctx.tooltip.interrupt().style('opacity', 0);
      },
      showTooltip: (html, event) => {
        ctx.tooltip.interrupt().style('opacity', 0.9).html(html).style('left', `${event.clientX + 13}px`).style('top', `${event.clientY - 20}px`);
      },
      handleForceResize: () => ctx.simulation.alpha(0.3).restart(),
      resetOrientation: () => {
        ctx.runtimeState.rotationDeg = 0;
        ctx.runtimeState.flipH = false;
        ctx.runtimeState.flipV = false;
      }
    },
    analysis: {
      getActiveValenceWarningMap: () => ctx.runtimeState.activeValenceWarningMap,
      updatePanels: (mol, options = {}) => ctx.updateAnalysisPanels(mol, options)
    },
    highlights: {
      prepare2dExportHighlightState: () => ctx.prepare2dExportHighlightState(),
      setHighlight: (mappings, options = {}) => ctx.setHighlight(mappings, options),
      restorePersistentHighlight: () => ctx.restorePersistentHighlight(),
      setPersistentHighlightFallback: (fn, options) => ctx.setPersistentHighlightFallback(fn, options)
    },
    options: {
      renderOptionLimits: ctx.renderOptionLimits,
      getRenderOptions: () => ctx.getRenderOptions(),
      getDefaultRenderOptions: () => ctx.getDefaultRenderOptions(),
      updateRenderOptions: nextOptions => ctx.updateRenderOptions(nextOptions)
    },
    input: {
      inputControls: ctx.inputControls,
      inputFlowManager: ctx.inputFlowManager
    },
    parsers: {
      parseSMILES: ctx.parseSMILES,
      parseINCHI: ctx.parseINCHI
    },
    export: {
      copyForcePng: ctx.copyForcePng,
      copyForceSvg: ctx.copyForceSvg,
      copySvg2d: ctx.copySvg2d,
      savePng2d: ctx.savePng2d
    },
    helpers: {
      getDatum: element => ctx.d3.select(element).datum(),
      pointer: (event, node) => ctx.d3.pointer(event, node),
      schedule: callback => requestAnimationFrame(callback),
      getNodeDatum: element => ctx.d3.select(element).datum()
    },
    molecule: {
      getAtomById: (atomId, mol) => mol.atoms.get(atomId) ?? null
    },
    formatters: {
      atomTooltipHtml: ctx.atomTooltipHtml
    },
    io: {
      toSMILES: ctx.toSMILES,
      toInChI: ctx.toInChI
    }
  };
}
