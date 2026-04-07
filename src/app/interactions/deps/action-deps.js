/** @module app/interactions/deps/action-deps */

export function createNavigationActionDeps(ctx) {
  return {
    state: ctx.appState,
    history: {
      takeSnapshot: options => ctx.takeSnapshot(options),
      captureSnapshot: options => ctx.captureAppSnapshot(options),
      discardLastSnapshot: () => ctx.discardLastSnapshot()
    },
    renderers: ctx.renderRuntime,
    overlays: {
      hasReactionPreview: () => ctx.hasReactionPreview(),
      reapplyActiveReactionPreview: () => ctx.reapplyActiveReactionPreview(),
      resetActiveResonanceView: mol => ctx.resetActiveResonanceView(mol),
      alignReaction2dProductOrientation: mol => ctx.alignReaction2dProductOrientation(mol),
      spreadReaction2dProductComponents: (mol, bondLength) => ctx.spreadReaction2dProductComponents(mol, bondLength),
      centerReaction2dPairCoords: (mol, bondLength) => ctx.centerReaction2dPairCoords(mol, bondLength),
      viewportFitPadding: pad => ctx.viewportFitPadding(pad)
    },
    helpers: {
      generateAndRefine2dCoords: ctx.generateAndRefine2dCoords,
      refineExistingCoords: ctx.refineExistingCoords,
      atomBBox: ctx.atomBBox,
      flipDisplayStereo: mol => ctx.flipDisplayStereo(mol)
    },
    view: {
      clearPrimitiveHover: () => ctx.clearPrimitiveHover(),
      restorePersistentHighlight: () => ctx.restorePersistentHighlight(),
      fitCurrent2dView: () => ctx.getFitCurrent2dView()(),
      getZoomTransform: () => ctx.getZoomTransform(),
      setZoomTransform: transform => ctx.setZoomTransform(transform),
      makeZoomIdentity: (x, y, k) => ctx.makeZoomIdentity(x, y, k),
      syncStereoMap2d: mol => {
        ctx.syncStereoMap2d(mol);
      },
      flipStereoMap2d: mol => {
        ctx.flipStereoMap2d(mol);
      },
      setPreserveSelectionOnNextRender: value => {
        ctx.setPreserveSelectionOnNextRender(value);
      },
      scale: ctx.scale
    },
    force: {
      patchForceNodePositions: (patchPos, options = {}) => ctx.patchForceNodePositions(patchPos, options),
      forceFitTransform: (nodes, pad, options = {}) => ctx.forceFitTransform(nodes, pad, options),
      fitPad: ctx.forceFitPad,
      initialZoomMultiplier: ctx.forceInitialZoomMultiplier,
      zoomTransformsDiffer: (a, b, epsilon) => ctx.zoomTransformsDiffer(a, b, epsilon)
    },
    parsers: {
      parseSMILES: ctx.parseSMILES,
      parseINCHI: ctx.parseINCHI
    },
    simulation: ctx.simulation,
    dom: {
      plotEl: ctx.plotEl,
      clean2dButton: ctx.clean2dButton,
      cleanForceButton: ctx.cleanForceButton,
      updateModeChrome: ctx.updateModeChrome
    }
  };
}

export function createSelectionActionDeps(ctx) {
  return {
    state: ctx.appState,
    renderers: {
      draw2d: () => ctx.getDraw2D()(),
      applyForceSelection: () => ctx.applyForceSelection()
    },
    view: {
      clearPrimitiveHover: () => ctx.clearPrimitiveHover()
    },
    drawBond: {
      cancelDrawBond: () => ctx.getDrawBondPreviewActions().cancel()
    },
    actions: {
      deleteSelection: () => ctx.getEditingActions().deleteSelection()
    },
    dom: {
      panButton: ctx.panButton,
      selectButton: ctx.selectButton,
      drawBondButton: ctx.drawBondButton,
      eraseButton: ctx.eraseButton,
      getElementButton: element => ctx.getElementButton(element)
    }
  };
}

export function createEditingActionDeps(ctx) {
  return {
    state: ctx.appState,
    actions: {
      performStructuralEdit: (...args) => ctx.performStructuralEdit(...args)
    },
    overlays: {
      hasReactionPreview: () => ctx.hasReactionPreview(),
      prepareReactionPreviewEraseTargets: (atomIds, bondIds) => ctx.prepareReactionPreviewEraseTargets(atomIds, bondIds)
    },
    policies: {
      reactionPreview: {
        block: ctx.reactionPreviewBlock
      },
      resonance: {
        normalizeForEdit: ctx.normalizeResonanceForEdit
      },
      snapshot: {
        take: ctx.takeSnapshotPolicy
      },
      viewport: {
        none: ctx.viewportNonePolicy
      }
    },
    chemistry: {
      clearStereoAnnotations: (mol, affectedIds) => ctx.clearStereoAnnotations(mol, affectedIds),
      kekulize: ctx.kekulize,
      refreshAromaticity: ctx.refreshAromaticity
    },
    force: {
      getSimulation: () => ctx.simulation,
      patchNodePositions: patchPos => ctx.patchNodePositions(patchPos),
      reseatHydrogensAroundPatched: patchPos => ctx.reseatHydrogensAroundPatched(patchPos)
    },
    view2D: {
      fitCurrentView: () => ctx.getFitCurrent2dView()()
    },
    view: {
      refreshSelectionOverlay: () => ctx.refreshSelectionOverlay()
    },
    dom: {
      flashEraseButton: () => ctx.flashEraseButton()
    }
  };
}

export function createDragGestureActionDeps(ctx) {
  return {
    d3: {
      createDrag: () => ctx.createDrag()
    },
    state: {
      getDrawBondMode: () => ctx.getDrawBondMode(),
      getEraseMode: () => ctx.getEraseMode()
    },
    history: {
      captureSnapshot: () => ctx.captureSnapshot(),
      takeSnapshot: options => ctx.takeSnapshot(options)
    },
    selection: {
      getSelectedDragAtomIds: (mol, atomIds = [], bondIds = []) => ctx.getSelectedDragAtomIds(mol, atomIds, bondIds)
    },
    molecule: {
      getCurrent: () => ctx.getCurrentMolecule()
    },
    force: {
      setAutoFitEnabled: value => {
        ctx.setAutoFitEnabled(value);
      },
      disableKeepInView: () => ctx.disableKeepInView()
    },
    view: {
      clearPrimitiveHover: () => ctx.clearPrimitiveHover(),
      refresh2dSelection: () => ctx.refresh2dSelection(),
      hideTooltip: () => ctx.hideTooltip(),
      setElementCursor: (element, value) => {
        ctx.setElementCursor(element, value);
      }
    }
  };
}

export function createDrawBondPreviewActionDeps(ctx) {
  return {
    g: ctx.g,
    getMode: () => ctx.getMode(),
    getDrawBondElement: () => ctx.getDrawBondElement(),
    getDrawElemProtons: () => ctx.getDrawElemProtons(),
    overlays: {
      isReactionPreviewEditableAtomId: id => ctx.isReactionPreviewEditableAtomId(id)
    },
    state: {
      getDrawBondState: () => ctx.getDrawBondState(),
      setDrawBondState: value => {
        ctx.setDrawBondState(value);
      },
      clearHoveredAtomIds: () => ctx.clearHoveredAtomIds(),
      clearHoveredBondIds: () => ctx.clearHoveredBondIds(),
      addHoveredAtomId: atomId => ctx.addHoveredAtomId(atomId)
    },
    view: {
      clearPrimitiveHover: () => ctx.clearPrimitiveHover()
    },
    renderers: {
      applyForceSelection: () => ctx.applyForceSelection(),
      redraw2dSelection: () => ctx.redraw2dSelection()
    },
    plot: {
      getSize: () => ctx.getPlotSize()
    },
    force: {
      getNodeById: atomId => ctx.getForceNodeById(atomId),
      getNodes: () => ctx.getForceNodes()
    },
    view2D: {
      getAtomById: atomId => ctx.get2DAtomById(atomId),
      getAtoms: () => ctx.get2DAtoms(),
      getCenterX: () => ctx.get2DCenterX(),
      getCenterY: () => ctx.get2DCenterY()
    },
    constants: {
      scale: ctx.scale,
      forceBondLength: ctx.forceBondLength,
      strokeWidth: ctx.strokeWidth,
      fontSize: ctx.fontSize
    },
    helpers: {
      atomRadius: ctx.atomRadius,
      atomColor: ctx.atomColor,
      strokeColor: ctx.strokeColor,
      singleBondWidth: ctx.singleBondWidth,
      labelHalfW: ctx.labelHalfW
    }
  };
}

export function createDrawBondCommitActionDeps(ctx) {
  return {
    getMode: () => ctx.getMode(),
    getDrawBondElement: () => ctx.getDrawBondElement(),
    preview: {
      clearArtifacts: () => ctx.clearPreviewArtifacts(),
      cancel: () => ctx.cancelPreview()
    },
    state: {
      getDrawBondState: () => ctx.getDrawBondState(),
      setDrawBondState: value => {
        ctx.setDrawBondState(value);
      }
    },
    view: {
      clearPrimitiveHover: () => ctx.clearPrimitiveHover(),
      setDrawBondHoverSuppressed: value => {
        ctx.setDrawBondHoverSuppressed(value);
      },
      captureZoomTransform: () => ctx.captureZoomTransform(),
      restore2dEditViewport: (zoomSnapshot, options = {}) => ctx.restore2dEditViewport(zoomSnapshot, options)
    },
    plot: {
      getSize: () => ctx.getPlotSize()
    },
    constants: {
      scale: ctx.scale,
      forceScale: ctx.forceScale
    },
    snapshot: {
      capture: options => ctx.captureSnapshot(options),
      restore: snap => ctx.restoreSnapshot(snap)
    },
    history: {
      takeSnapshot: options => ctx.takeSnapshot(options)
    },
    overlays: {
      prepareReactionPreviewEditTargets: payload => ctx.prepareReactionPreviewEditTargets(payload),
      prepareResonanceStructuralEdit: mol => ctx.prepareResonanceStructuralEdit(mol)
    },
    molecule: {
      getActive: () => ctx.getActiveMolecule(),
      ensureActive: () => ctx.ensureActiveMolecule()
    },
    force: {
      getNodeById: atomId => ctx.getForceNodeById(atomId),
      getNodes: () => ctx.getForceNodes(),
      patchNodePositions: patchPos => ctx.patchNodePositions(patchPos),
      reseatHydrogensAroundPatched: patchPos => ctx.reseatHydrogensAroundPatched(patchPos),
      enableKeepInView: () => ctx.enableKeepInView()
    },
    view2D: {
      getCenterX: () => ctx.get2DCenterX(),
      getCenterY: () => ctx.get2DCenterY(),
      syncDerivedState: mol => ctx.sync2DDerivedState(mol)
    },
    chemistry: {
      kekulize: ctx.kekulize,
      refreshAromaticity: ctx.refreshAromaticity
    },
    analysis: {
      syncInputField: mol => ctx.syncInputField(mol),
      updateFormula: mol => ctx.updateFormula(mol),
      updateDescriptors: mol => ctx.updateDescriptors(mol),
      updatePanels: mol => ctx.updatePanels(mol)
    },
    renderers: {
      draw2d: ctx.draw2d,
      updateForce: ctx.updateForce
    },
    selection: {
      clearSelection: () => ctx.clearSelection()
    },
    actions: {
      changeAtomElements: (atomIds, newEl, options = {}) => ctx.changeAtomElements(atomIds, newEl, options),
      promoteBondOrder: (bondId, options = {}) => ctx.promoteBondOrder(bondId, options)
    }
  };
}

export function createPrimitiveSelectionActionDeps(ctx) {
  return {
    state: ctx.appState,
    renderers: {
      draw2d: () => ctx.getDraw2D()(),
      applyForceSelection: () => ctx.applyForceSelection()
    },
    view: {
      clearPrimitiveHover: () => ctx.clearPrimitiveHover()
    },
    helpers: {
      isAdditiveSelectionEvent: event => ctx.isAdditiveSelectionEvent(event),
      hasVisibleStereoBond: bondId => !!ctx.hasVisibleStereoBond(bondId)
    }
  };
}

export function createPrimitiveEventHandlerDeps(ctx) {
  return {
    state: ctx.appState,
    selection: ctx.primitiveSelectionActions,
    overlays: {
      isReactionPreviewEditableAtomId: id => ctx.isReactionPreviewEditableAtomId(id)
    },
    drawBond: {
      hasDrawBondState: () => !!ctx.getDrawBondState(),
      start: (atomId, gX, gY) => ctx.startDrawBond(atomId, gX, gY),
      resetHover: () => ctx.resetDrawBondHover(),
      getElement: () => ctx.getDrawBondElement()
    },
    actions: {
      promoteBondOrder: bondId => ctx.promoteBondOrder(bondId),
      eraseItem: (atomIds, bondIds) => ctx.eraseItem(atomIds, bondIds),
      replaceForceHydrogenAtom: (atomId, mol) => ctx.replaceForceHydrogenAtom(atomId, mol)
    },
    view: {
      showPrimitiveHover: (atomIds = [], bondIds = []) => ctx.showPrimitiveHover(atomIds, bondIds),
      clearPrimitiveHover: () => ctx.clearPrimitiveHover(),
      refreshSelectionOverlay: () => ctx.refreshSelectionOverlay(),
      isDrawBondHoverSuppressed: () => ctx.isDrawBondHoverSuppressed(),
      isPrimitiveHoverSuppressed: () => ctx.isPrimitiveHoverSuppressed(),
      setPrimitiveHoverSuppressed: value => {
        ctx.setPrimitiveHoverSuppressed(value);
      }
    },
    tooltip: {
      showDelayed: (html, event, delay = 150) => ctx.showDelayedTooltip(html, event, delay),
      showImmediate: (html, event) => ctx.showImmediateTooltip(html, event),
      move: event => ctx.moveTooltip(event),
      hide: () => ctx.hideTooltip()
    },
    tooltipState: {
      getSelectionValenceTooltipAtomId: () => ctx.getSelectionValenceTooltipAtomId(),
      setSelectionValenceTooltipAtomId: value => {
        ctx.setSelectionValenceTooltipAtomId(value);
      }
    },
    options: {
      getRenderOptions: () => ctx.getRenderOptions()
    },
    formatters: {
      atomTooltipHtml: ctx.atomTooltipHtml,
      bondTooltipHtml: ctx.bondTooltipHtml
    },
    pointer: (event, node) => ctx.pointer(event, node),
    dom: {
      gNode: () => ctx.getGNode()
    }
  };
}
