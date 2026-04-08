/** @module app/bootstrap/app-bootstrap */

/**
 * Wires together all post-bootstrap factories and initializes the full application shell,
 * including delegates, undo, highlights, export, panels, interaction layers, options modal, and the app shell.
 * @param {object} ctx - Structured dependency context assembled by `createFinalizeAppBootstrapDeps`.
 * @returns {object} Object containing `appDelegates`, `appShell`, `optionsModal`, and `physchemPanel`.
 */
export function finalizeAppBootstrap(ctx) {
  const appDelegates = ctx.factories.createAppDelegates({
    state: {
      getMode: ctx.state.getMode,
      getCurrentMol: ctx.state.getCurrentMol,
      setCurrentMol: ctx.state.setCurrentMol,
      getMol2d: ctx.state.getMol2d,
      setMol2d: ctx.state.setMol2d,
      clear2dDerivedState: ctx.state.clear2dDerivedState,
      getStereoMap2d: ctx.state.getStereoMap2d
    },
    primitiveSelection: ctx.actions.primitiveSelection,
    render2DHelpers: ctx.render.render2DHelpers,
    highlight2DRenderer: ctx.render.highlight2DRenderer,
    structuralEditActions: ctx.actions.structuralEditActions,
    drawBondPreviewActions: ctx.actions.drawBondPreviewActions,
    drawBondCommitActions: ctx.actions.drawBondCommitActions,
    scene2DRenderer: ctx.render.scene2DRenderer,
    editingActions: ctx.actions.editingActions,
    zoomTransformHelpers: ctx.render.zoomTransformHelpers,
    stereo: {
      syncDisplayStereo: ctx.stereo.syncDisplayStereo
    },
    renderRuntime: ctx.render.renderRuntime,
    inputFlowManager: ctx.input.inputFlowManager
  });

  ctx.setDelegates?.(appDelegates);

  const { changeAtomElements, draw2d, captureZoomTransformSnapshot, restoreZoomTransformSnapshot, commitDrawBond, render2d } = appDelegates;

  ctx.factories.initUndo({
    captureAppSnapshot: options => ctx.controller.captureAppSnapshot(options),
    clearReactionPreviewState: () => ctx.overlays.clearReactionPreviewState(),
    restoreReactionPreviewSource: () => ctx.overlays.restoreReactionPreviewSource(),
    restoreAppSnapshot: snap => ctx.controller.restoreAppSnapshot(snap)
  });

  ctx.factories.initHighlights({
    get mode() {
      return ctx.state.getMode();
    },
    get _mol2d() {
      return ctx.state.getMol2d();
    },
    draw2d: () => draw2d(),
    applyForceHighlights: () => ctx.render.applyForceHighlights()
  });

  ctx.factories.initExport({
    g: ctx.dom.g,
    simulation: ctx.dom.simulation,
    get _mol2d() {
      return ctx.state.getMol2d();
    },
    prepare2dExport: () => ctx.highlights.prepare2dExportHighlightState()
  });

  ctx.factories.initReaction2d(
    ctx.factories.createReaction2dDeps({
      g: ctx.dom.g,
      plotEl: ctx.dom.plotEl,
      state: {
        getMode: ctx.state.getMode,
        getCurrentMol: ctx.state.getCurrentMol,
        getMol2d: ctx.state.getMol2d
      },
      renderers: {
        draw2d: () => draw2d(),
        applyForceHighlights: () => ctx.render.applyForceHighlights(),
        renderMol: ctx.render.renderRuntime.renderMol
      },
      view: {
        captureZoomTransform: () => captureZoomTransformSnapshot(),
        restoreZoomTransform: snapshot => restoreZoomTransformSnapshot(snapshot)
      },
      force: {
        captureNodePositions: () =>
          ctx.dom.simulation.nodes().map(node => [
            node.id,
            {
              x: node.x,
              y: node.y,
              vx: node.vx,
              vy: node.vy,
              anchorX: node.anchorX,
              anchorY: node.anchorY
            }
          ]),
        restoreNodePositions: positionEntries => {
          const positionMap = positionEntries instanceof Map ? positionEntries : new Map(positionEntries ?? []);
          for (const node of ctx.dom.simulation.nodes()) {
            const position = positionMap.get(node.id);
            if (!position) {
              continue;
            }
            node.x = position.x;
            node.y = position.y;
            node.vx = Number.isFinite(position.vx) ? position.vx : 0;
            node.vy = Number.isFinite(position.vy) ? position.vy : 0;
            node.anchorX = Number.isFinite(position.anchorX) ? position.anchorX : node.anchorX;
            node.anchorY = Number.isFinite(position.anchorY) ? position.anchorY : node.anchorY;
          }
        },
        restart: () => {
          ctx.dom.simulation.alpha(0.18).restart();
        }
      },
      history: {
        captureAppSnapshot: options => ctx.controller.captureAppSnapshot(options),
        takeSnapshot: options => ctx.history.takeSnapshot(options)
      }
    })
  );

  ctx.factories.initResonancePanel(
    ctx.factories.createResonancePanelDeps({
      state: {
        getMode: ctx.state.getMode,
        getCurrentMol: ctx.state.getCurrentMol,
        getMol2d: ctx.state.getMol2d
      },
      renderers: {
        draw2d: () => draw2d(),
        updateForce: ctx.render.renderRuntime.updateForce
      },
      options: {
        getRenderOptions: () => ctx.options.getRenderOptions(),
        updateRenderOptions: nextOptions => ctx.options.updateRenderOptions(nextOptions)
      },
      overlays: {
        hasReactionPreview: () => ctx.overlays.hasReactionPreview(),
        restoreReactionPreviewSource: options => ctx.overlays.restoreReactionPreviewSource(options)
      },
      history: {
        takeSnapshot: options => ctx.history.takeSnapshot(options)
      }
    })
  );

  ctx.factories.initBondEnPanel(
    ctx.factories.createBondEnPanelDeps({
      state: {
        getMode: ctx.state.getMode,
        getCurrentMol: ctx.state.getCurrentMol,
        getMol2d: ctx.state.getMol2d
      },
      renderers: {
        draw2d: () => draw2d(),
        updateForce: ctx.render.renderRuntime.updateForce
      }
    })
  );

  ctx.factories.initAtomNumberingPanel(
    ctx.factories.createAtomNumberingPanelDeps({
      state: {
        getMode: ctx.state.getMode,
        getCurrentMol: ctx.state.getCurrentMol,
        getMol2d: ctx.state.getMol2d
      },
      renderers: {
        draw2d: () => draw2d(),
        updateForce: ctx.render.renderRuntime.updateForce
      },
      options: {
        getRenderOptions: () => ctx.options.getRenderOptions(),
        updateRenderOptions: nextOptions => ctx.options.updateRenderOptions(nextOptions)
      },
      overlays: {
        hasReactionPreview: () => ctx.overlays.hasReactionPreview(),
        getReactionPreviewMappedAtomPairs: () => ctx.overlays.getReactionPreviewMappedAtomPairs(),
        getReactionPreviewReactantAtomIds: () => ctx.overlays.getReactionPreviewReactantAtomIds()
      }
    })
  );

  ctx.factories.initNavigationInteractions({
    controller: ctx.controller
  });

  ctx.factories.initKeyboardInteractions({
    state: ctx.state.appState,
    selection: ctx.actions.selectionActions,
    drawBond: {
      hasDrawBondState: () => ctx.state.hasDrawBondState(),
      cancelDrawBond: () => ctx.actions.drawBondPreviewActions.cancel()
    },
    overlays: {
      isReactionPreviewEditableAtomId: id => ctx.overlays.isReactionPreviewEditableAtomId(id)
    },
    actions: {
      deleteSelection: () => ctx.actions.editingActions.deleteSelection(),
      deleteTargets: (atomIds, bondIds, options = {}) => ctx.actions.editingActions.deleteTargets(atomIds, bondIds, options),
      changeAtomElements: (atomIds, newEl) => changeAtomElements(atomIds, newEl)
    },
    history: {
      undo: () => ctx.history.undoAction(),
      redo: () => ctx.history.redoAction()
    },
    view: {
      getZoomTransform: () => ctx.view.getZoomTransform(),
      setZoomTransform: transform => ctx.view.setZoomTransform(transform),
      makeZoomIdentity: (x, y, k) => ctx.view.makeZoomIdentity(x, y, k),
      applySelectionOverlay: () => ctx.render.applySelectionOverlay(),
      refreshSelectionOverlay: () => ctx.render.refreshSelectionOverlay(),
      clearPrimitiveHover: () => ctx.view.clearPrimitiveHover()
    }
  });

  ctx.factories.initGestureInteractions({
    state: ctx.state.appState,
    selection: ctx.actions.selectionActions,
    renderers: {
      applySelectionOverlay: () => ctx.render.applySelectionOverlay()
    },
    overlays: {
      hasReactionPreview: () => ctx.overlays.hasReactionPreview()
    },
    drawBond: {
      hasDrawBondState: () => ctx.state.hasDrawBondState(),
      start: (atomId, gX, gY) => ctx.actions.drawBondPreviewActions.start(atomId, gX, gY),
      markDragged: () => ctx.actions.drawBondPreviewActions.markDragged(),
      updatePreview: point => ctx.actions.drawBondPreviewActions.update(point),
      commit: () => commitDrawBond()
    },
    actions: {
      eraseItem: (atomIds, bondIds) => ctx.actions.editingActions.eraseItem(atomIds, bondIds)
    },
    view: {
      getZoomTransform: () => ctx.view.getZoomTransform(),
      clearPrimitiveHover: () => ctx.view.clearPrimitiveHover(),
      showPrimitiveHover: (atomIds = [], bondIds = []) => ctx.view.showPrimitiveHover(atomIds, bondIds),
      setDrawBondHoverSuppressed: value => ctx.state.setDrawBondHoverSuppressed(value)
    },
    helpers: {
      toSVGPt2d: atom => ctx.render.render2DHelpers.toSVGPt2d(atom),
      getDatum: element => ctx.helpers.getDatum(element)
    },
    simulation: ctx.dom.simulation,
    svg: ctx.dom.svg,
    g: ctx.dom.g,
    d3: ctx.dom.d3,
    pointer: (event, node) => ctx.helpers.pointer(event, node),
    schedule: callback => ctx.helpers.schedule(callback),
    dom: {
      plotEl: ctx.dom.plotEl,
      getEraseCursorElement: () => ctx.dom.getEraseCursorElement()
    }
  });

  const optionsModal = ctx.factories.initOptionsModal(
    ctx.factories.createOptionsModalDeps({
      doc: ctx.dom.document,
      dom: {
        getOverlayElement: () => ctx.dom.getOptionsOverlayElement(),
        getShowValenceWarningsElement: () => ctx.dom.getShowValenceWarningsElement(),
        getShowAtomTooltipsElement: () => ctx.dom.getShowAtomTooltipsElement(),
        get2DAtomColoringElement: () => ctx.dom.get2DAtomColoringElement(),
        get2DAtomFontSizeElement: () => ctx.dom.get2DAtomFontSizeElement(),
        getAtomNumberingFontSizeElement: () => ctx.dom.getAtomNumberingFontSizeElement(),
        get2DBondThicknessElement: () => ctx.dom.get2DBondThicknessElement(),
        getForceAtomSizeElement: () => ctx.dom.getForceAtomSizeElement(),
        getForceBondThicknessElement: () => ctx.dom.getForceBondThicknessElement(),
        getResetButtonElement: () => ctx.dom.getOptionsResetButtonElement(),
        getCancelButtonElement: () => ctx.dom.getOptionsCancelButtonElement(),
        getApplyButtonElement: () => ctx.dom.getOptionsApplyButtonElement()
      },
      options: {
        limits: ctx.options.renderOptionLimits,
        getRenderOptions: () => ctx.options.getRenderOptions(),
        getDefaultRenderOptions: () => ctx.options.getDefaultRenderOptions(),
        updateRenderOptions: nextOptions => ctx.options.updateRenderOptions(nextOptions)
      },
      state: {
        getMode: ctx.state.getMode,
        getCurrentMol: ctx.state.getCurrentMol,
        getMol2d: ctx.state.getMol2d
      },
      view: {
        setFontSize: value => ctx.state.setFontSize(value),
        hideTooltip: () => ctx.view.hideTooltip()
      },
      renderers: {
        draw2d: () => draw2d(),
        updateForce: (mol, options = {}) => ctx.render.updateForce(mol, options)
      }
    })
  );

  ctx.factories.initPlotInteractions({
    plotEl: ctx.dom.plotEl,
    document: ctx.dom.document,
    state: {
      getSelectMode: () => ctx.state.getSelectMode(),
      getDrawBondMode: () => ctx.state.getDrawBondMode(),
      hasDrawBondState: () => ctx.state.hasDrawBondState(),
      getEraseMode: () => ctx.state.getEraseMode(),
      isRenderableMode: () => ctx.state.isRenderableMode(),
      getActiveMolecule: () => ctx.state.getActiveMolecule(),
      getTooltipMode: () => ctx.state.getTooltipMode()
    },
    options: {
      getShowAtomTooltips: () => ctx.options.getRenderOptions().showAtomTooltips
    },
    analysis: {
      getActiveValenceWarningMap: () => ctx.analysis.getActiveValenceWarningMap()
    },
    tooltipState: {
      getSelectionValenceTooltipAtomId: () => ctx.state.getSelectionValenceTooltipAtomId(),
      setSelectionValenceTooltipAtomId: value => ctx.state.setSelectionValenceTooltipAtomId(value)
    },
    tooltip: {
      hide: () => ctx.view.hideTooltip(),
      show: (html, event) => ctx.view.showTooltip(html, event)
    },
    helpers: {
      getNodeDatum: element => ctx.helpers.getNodeDatum(element)
    },
    molecule: {
      getAtomById: (atomId, mol) => ctx.molecule.getAtomById(atomId, mol)
    },
    formatters: {
      atomTooltipHtml: ctx.formatters.atomTooltipHtml
    }
  });

  ctx.factories.initTabPanels({ doc: ctx.dom.document });
  ctx.analysis.updatePanels(ctx.state.getCurrentMol() ?? ctx.state.getMol2d());

  const physchemPanel = ctx.factories.initPhyschemPanel(
    ctx.factories.createPhyschemPanelDeps({
      dom: {
        getTableElement: () => ctx.dom.getPhyschemTableElement()
      },
      tooltip: ctx.dom.tooltip,
      highlights: {
        setHighlight: (mappings, options = {}) => ctx.highlights.setHighlight(mappings, options),
        restorePersistentHighlight: () => ctx.highlights.restorePersistentHighlight(),
        setPersistentHighlightFallback: (fn, options) => ctx.highlights.setPersistentHighlightFallback(fn, options)
      }
    })
  );
  ctx.state.setCapturePhyschemHighlightSnapshot(() => physchemPanel.captureSnapshot());
  ctx.state.setRestorePhyschemHighlightSnapshot(snapshot => physchemPanel.restoreSnapshot(snapshot));

  ctx.input.inputControls.bind();

  const appShell = ctx.factories.initAppShell(
    ctx.factories.createAppShellDeps({
      win: ctx.dom.window,
      dom: {
        getPlotElement: () => ctx.dom.getSvgPlotElement(),
        getLabelToggleElement: () => ctx.dom.getLabelToggleElement()
      },
      history: {
        undo: () => ctx.history.undoAction(),
        redo: () => ctx.history.redoAction()
      },
      exportActions: {
        copyForcePng: () => ctx.export.copyForcePng(),
        copyForceSvg: () => ctx.export.copyForceSvg(),
        copySvg2d: () => ctx.export.copySvg2d(),
        savePng2d: () => ctx.export.savePng2d()
      },
      options: {
        open: () => optionsModal.open()
      },
      navigation: {
        cleanLayout2d: () => ctx.controller.performViewAction('clean-layout-2d'),
        cleanLayoutForce: () => ctx.controller.performViewAction('clean-layout-force'),
        toggleMode: () => ctx.controller.performViewAction('toggle-mode')
      },
      selection: {
        togglePanMode: () => ctx.actions.selectionActions.togglePanMode(),
        toggleSelectMode: () => ctx.actions.selectionActions.toggleSelectMode(),
        toggleDrawBondMode: () => ctx.actions.selectionActions.toggleDrawBondMode(),
        handleDrawBondButtonClick: () => ctx.actions.selectionActions.handleDrawBondButtonClick(),
        openDrawBondDrawer: () => ctx.actions.selectionActions.openDrawBondDrawer(),
        closeDrawBondDrawer: () => ctx.actions.selectionActions.closeDrawBondDrawer(),
        toggleEraseMode: () => ctx.actions.selectionActions.toggleEraseMode(),
        setDrawElement: el => ctx.actions.selectionActions.setDrawElement(el),
        setDrawBondType: type => ctx.actions.selectionActions.setDrawBondType(type)
      },
      editing: {
        deleteSelection: () => ctx.actions.editingActions.deleteSelection()
      },
      state: {
        hasLoadedInput: () => ctx.state.hasLoadedInput(),
        getMode: () => ctx.state.getMode()
      },
      view: {
        handleForceResize: () => ctx.view.handleForceResize(),
        handle2DResize: () => {
          if (ctx.overlays.hasReactionPreview()) {
            if (ctx.overlays.reapplyActiveReactionPreview()) {
              ctx.render.scene2DRenderer.fitCurrent2dView();
              return;
            }
            return;
          }
          ctx.view.resetOrientation();
          const mol = ctx.state.getCurrentInchi() ? ctx.parsers.parseINCHI(ctx.state.getCurrentInchi()) : ctx.parsers.parseSMILES(ctx.state.getCurrentSmiles());
          render2d(mol);
        }
      },
      input: {
        parseSmiles: smiles => ctx.input.inputFlowManager.parseAndRenderSmiles(smiles),
        parseInchi: inchi => ctx.input.inputFlowManager.parseAndRenderInchi(inchi),
        parseInput: value => ctx.input.inputFlowManager.parseInput(value),
        setInputFormat: (fmt, options = {}) => ctx.input.inputFlowManager.setInputFormat(fmt, options),
        renderExamples: () => ctx.input.inputControls.renderExamples(),
        pickRandomMolecule: () => ctx.input.inputControls.pickRandomMolecule(),
        getCanonicalMol: () => ctx.overlays.getReactionPreviewSourceMol() ?? ctx.state.getCurrentMol(),
        toSmiles: mol => ctx.io.toSMILES(mol),
        toInchi: mol => ctx.io.toInChI(mol),
        takeInputFormatSnapshot: payload => ctx.input.inputFlowManager.takeInputFormatSnapshot(payload)
      },
      initialState: {
        getInitialSmiles: () => ctx.state.getInitialSmiles(),
        setInputValue: value => ctx.dom.setInputValue(value),
        syncCollectionPicker: value => ctx.input.inputControls.syncCollectionPickerForInputValue(value)
      }
    })
  );

  appShell.bootstrap();

  return {
    appDelegates,
    appShell,
    optionsModal,
    physchemPanel
  };
}
