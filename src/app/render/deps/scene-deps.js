/** @module app/render/deps/scene-deps */

export function create2DHighlightRendererDeps(ctx) {
  return {
    view: {
      getGraphSelection: () => ctx.getGraphSelection()
    },
    state: {
      getMol: () => ctx.getMol(),
      getHCounts: () => ctx.getHCounts()
    },
    helpers: {
      toSVGPt: atom => ctx.toSVGPt(atom)
    },
    constants: {
      getFontSize: () => ctx.getFontSize()
    }
  };
}

export function createForceHighlightRendererDeps(ctx) {
  return {
    view: {
      getGraphSelection: () => ctx.getGraphSelection()
    },
    force: {
      getNodes: () => ctx.getNodes(),
      getLinks: () => ctx.getLinks()
    },
    cache: {
      setHighlightLines: value => ctx.setHighlightLines(value),
      setHighlightCircles: value => ctx.setHighlightCircles(value)
    },
    constants: {
      getHighlightRadius: () => ctx.getHighlightRadius(),
      getOutlineWidth: () => ctx.getOutlineWidth()
    },
    helpers: {
      atomRadius: ctx.atomRadius
    }
  };
}

export function createForceViewportStateDeps(ctx) {
  return {
    state: {
      setKeepInView: value => ctx.setKeepInView(value),
      setKeepInViewTicks: value => ctx.setKeepInViewTicks(value)
    },
    constants: {
      getDefaultKeepInViewTicks: () => ctx.getDefaultKeepInViewTicks()
    }
  };
}

export function createForceSceneRendererDeps(ctx) {
  return {
    d3: ctx.d3,
    svg: ctx.svg,
    zoom: ctx.zoom,
    g: ctx.g,
    plotEl: ctx.plotEl,
    simulation: ctx.simulation,
    constants: {
      bondOffset: ctx.bondOffset,
      valenceWarningFill: ctx.valenceWarningFill,
      forceLayoutHeavyRepulsion: ctx.forceLayoutHeavyRepulsion,
      forceLayoutHRepulsion: ctx.forceLayoutHRepulsion,
      forceLayoutInitialFitPad: ctx.forceLayoutInitialFitPad,
      forceLayoutInitialHRadiusScale: ctx.forceLayoutInitialHRadiusScale,
      forceLayoutInitialZoomMultiplier: ctx.forceLayoutInitialZoomMultiplier,
      forceLayoutInitialKeepInViewTicks: ctx.forceLayoutInitialKeepInViewTicks,
      forceLayoutFitPad: ctx.forceLayoutFitPad,
      forceLayoutKeepInViewAlphaMin: ctx.forceLayoutKeepInViewAlphaMin
    },
    state: {
      setActiveValenceWarningMap: map => ctx.setActiveValenceWarningMap(map),
      setForceAutoFitEnabled: value => ctx.setForceAutoFitEnabled(value),
      isForceAutoFitEnabled: () => ctx.isForceAutoFitEnabled(),
      enableKeepInView: ticks => ctx.enableKeepInView(ticks),
      disableKeepInView: () => ctx.disableKeepInView(),
      isKeepInViewEnabled: () => ctx.isKeepInViewEnabled(),
      getKeepInViewTicks: () => ctx.getKeepInViewTicks(),
      setKeepInViewTicks: value => ctx.setKeepInViewTicks(value),
      getPreserveSelectionOnNextRender: () => ctx.getPreserveSelectionOnNextRender(),
      setPreserveSelectionOnNextRender: value => ctx.setPreserveSelectionOnNextRender(value),
      syncSelectionToMolecule: mol => ctx.syncSelectionToMolecule(mol),
      clearSelection: () => ctx.clearSelection()
    },
    cache: {
      reset: () => ctx.resetCache(),
      setValenceWarningCircles: selection => ctx.setValenceWarningCircles(selection),
      getValenceWarningCircles: () => ctx.getValenceWarningCircles(),
      getHighlightLines: () => ctx.getHighlightLines(),
      getHighlightCircles: () => ctx.getHighlightCircles(),
      getSelectionLines: () => ctx.getSelectionLines(),
      getSelectionCircles: () => ctx.getSelectionCircles()
    },
    helpers: {
      valenceWarningMapFor: molecule => ctx.valenceWarningMapFor(molecule),
      buildForceAnchorLayout: molecule => ctx.buildForceAnchorLayout(molecule),
      convertMolecule: molecule => ctx.convertMolecule(molecule),
      seedForceNodePositions: (graph, molecule, anchorLayout, options) => ctx.seedForceNodePositions(graph, molecule, anchorLayout, options),
      patchForceNodePositions: (patchPos, options = {}) => ctx.patchForceNodePositions(patchPos, options),
      reseatHydrogensAroundPatched: (patchPos, options = {}) => ctx.reseatHydrogensAroundPatched(patchPos, options),
      forceLinkDistance: link => ctx.forceLinkDistance(link),
      forceAnchorRadius: () => ctx.forceAnchorRadius(),
      forceHydrogenRepulsion: () => ctx.forceHydrogenRepulsion(),
      forceFitTransform: (nodes, pad, options) => ctx.forceFitTransform(nodes, pad, options),
      isHydrogenNode: node => ctx.isHydrogenNode(node),
      enLabelColor: value => ctx.enLabelColor(value),
      renderReactionPreviewArrowForce: nodes => ctx.renderReactionPreviewArrowForce(nodes),
      generateAndRefine2dCoords: (mol, options) => ctx.generateAndRefine2dCoords(mol, options),
      alignReaction2dProductOrientation: mol => ctx.alignReaction2dProductOrientation(mol)
    },
    events: {
      handleForceBondClick: (event, bondId, molecule) => ctx.handleForceBondClick(event, bondId, molecule),
      handleForceBondDblClick: (event, atomIds) => ctx.handleForceBondDblClick(event, atomIds),
      handleForceBondMouseOver: (event, bondId, molecule) => ctx.handleForceBondMouseOver(event, bondId, molecule),
      handleForceBondMouseMove: event => ctx.handleForceBondMouseMove(event),
      handleForceBondMouseOut: () => ctx.handleForceBondMouseOut(),
      handleForceAtomMouseDownDrawBond: (event, datum) => ctx.handleForceAtomMouseDownDrawBond(event, datum),
      handleForceAtomClick: (event, datum, molecule) => ctx.handleForceAtomClick(event, datum, molecule),
      handleForceAtomDblClick: (event, atomId) => ctx.handleForceAtomDblClick(event, atomId),
      handleForceAtomMouseOver: (event, datum, molecule, warning) => ctx.handleForceAtomMouseOver(event, datum, molecule, warning),
      handleForceAtomMouseMove: event => ctx.handleForceAtomMouseMove(event),
      handleForceAtomMouseOut: atomId => ctx.handleForceAtomMouseOut(atomId)
    },
    drag: {
      createForceAtomDrag: sim => ctx.createForceAtomDrag(sim),
      createForceBondDrag: (sim, molecule) => ctx.createForceBondDrag(sim, molecule)
    },
    callbacks: {
      hasHighlights: () => ctx.hasHighlights(),
      hasSelection: () => ctx.hasSelection(),
      applyForceHighlights: () => ctx.applyForceHighlights(),
      applyForceSelection: () => ctx.applyForceSelection()
    }
  };
}

export function create2DSceneRendererDeps(ctx) {
  return {
    d3: ctx.d3,
    svg: ctx.svg,
    zoom: ctx.zoom,
    g: ctx.g,
    plotEl: ctx.plotEl,
    constants: {
      scale: ctx.scale,
      getFontSize: () => ctx.getFontSize(),
      valenceWarningFill: ctx.valenceWarningFill
    },
    state: {
      getMol: () => ctx.getMol(),
      getHCounts: () => ctx.getHCounts(),
      getStereoMap: () => ctx.getStereoMap(),
      setScene: value => ctx.setScene(value),
      setCenter: (cx, cy) => ctx.setCenter(cx, cy),
      setActiveValenceWarningMap: map => ctx.setActiveValenceWarningMap(map),
      getPreserveSelectionOnNextRender: () => ctx.getPreserveSelectionOnNextRender(),
      setPreserveSelectionOnNextRender: value => ctx.setPreserveSelectionOnNextRender(value)
    },
    cache: {
      reset: () => ctx.resetCache()
    },
    selection: {
      syncSelectionToMolecule: mol => ctx.syncSelectionToMolecule(mol),
      clearSelection: () => ctx.clearSelection()
    },
    overlay: {
      getDrawBondMode: () => ctx.getDrawBondMode(),
      getDrawBondType: () => ctx.getDrawBondType?.()
    },
    helpers: {
      valenceWarningMapFor: molecule => ctx.valenceWarningMapFor(molecule),
      toSVGPt: atom => ctx.toSVGPt(atom),
      secondaryDir: ctx.secondaryDir,
      getSelectedDragAtomIds: (mol, atomIds = [], bondIds = []) => ctx.getSelectedDragAtomIds(mol, atomIds, bondIds),
      drawBond: (container, bond, a1, a2, mol, toSVGPt, stereoType = null) => ctx.drawBond(container, bond, a1, a2, mol, toSVGPt, stereoType),
      redrawHighlights: () => ctx.redrawHighlights(),
      redrawSelection: () => ctx.redrawSelection(),
      generateAndRefine2dCoords: (mol, options = {}) => ctx.generateAndRefine2dCoords(mol, options),
      alignReaction2dProductOrientation: mol => ctx.alignReaction2dProductOrientation(mol),
      spreadReaction2dProductComponents: (mol, spacing) => ctx.spreadReaction2dProductComponents(mol, spacing),
      centerReaction2dPairCoords: (mol, spacing) => ctx.centerReaction2dPairCoords(mol, spacing),
      drawReactionPreviewArrow2d: (toSVGPt, atoms) => ctx.drawReactionPreviewArrow2d(toSVGPt, atoms),
      viewportFitPadding: pad => ctx.viewportFitPadding(pad),
      hasReactionPreview: () => ctx.hasReactionPreview(),
      enLabelColor: value => ctx.enLabelColor(value)
    },
    events: {
      handle2dBondClick: (event, bondId) => ctx.handle2dBondClick(event, bondId),
      handle2dBondDblClick: (event, atomIds) => ctx.handle2dBondDblClick(event, atomIds),
      handle2dBondMouseOver: (event, bond, a1, a2) => ctx.handle2dBondMouseOver(event, bond, a1, a2),
      handle2dBondMouseMove: event => ctx.handle2dBondMouseMove(event),
      handle2dBondMouseOut: () => ctx.handle2dBondMouseOut(),
      handle2dAtomMouseDownDrawBond: (event, atomId) => ctx.handle2dAtomMouseDownDrawBond(event, atomId),
      handle2dAtomClick: (event, atomId) => ctx.handle2dAtomClick(event, atomId),
      handle2dAtomDblClick: (event, atomId) => ctx.handle2dAtomDblClick(event, atomId),
      handle2dAtomMouseOver: (event, atom, mol, warning) => ctx.handle2dAtomMouseOver(event, atom, mol, warning),
      handle2dAtomMouseMove: event => ctx.handle2dAtomMouseMove(event),
      handle2dAtomMouseOut: atomId => ctx.handle2dAtomMouseOut(atomId)
    },
    drag: {
      create2dBondDrag: (mol, bondId, options) => ctx.create2dBondDrag(mol, bondId, options),
      create2dAtomDrag: (mol, atomId, options) => ctx.create2dAtomDrag(mol, atomId, options)
    },
    actions: {
      promoteBondOrder: (bondId, options = {}) => ctx.promoteBondOrder(bondId, options)
    },
    view: {
      getOrientation: () => ctx.getOrientation()
    },
    analysis: {
      updateFormula: mol => ctx.updateFormula(mol),
      updateDescriptors: mol => ctx.updateDescriptors(mol),
      updatePanels: (mol, options = {}) => ctx.updatePanels(mol, options)
    }
  };
}

export function createSelectionOverlayManagerDeps(ctx) {
  return {
    scheduler: {
      requestAnimationFrame: callback => ctx.requestAnimationFrame(callback)
    },
    state: {
      getMode: () => ctx.getMode(),
      getSelectMode: () => ctx.getSelectMode(),
      getDrawBondMode: () => ctx.getDrawBondMode(),
      getEraseMode: () => ctx.getEraseMode(),
      getSelectionModifierActive: () => ctx.getSelectionModifierActive(),
      getSelectedAtomIds: () => ctx.getSelectedAtomIds(),
      getSelectedBondIds: () => ctx.getSelectedBondIds(),
      getHoveredAtomIds: () => ctx.getHoveredAtomIds(),
      getHoveredBondIds: () => ctx.getHoveredBondIds()
    },
    molecule: {
      getForceMol: () => ctx.getForceMol(),
      getMol2D: () => ctx.getMol2D()
    },
    view2D: {
      getHCounts: () => ctx.getHCounts(),
      getStereoMap: () => ctx.getStereoMap(),
      toSVGPt: atom => ctx.toSVGPt(atom)
    },
    view: {
      getGraphSelection: () => ctx.getGraphSelection()
    },
    renderers: {
      applyForceSelection: () => ctx.applyForceSelection()
    },
    constants: {
      getFontSize: () => ctx.getFontSize()
    }
  };
}

export function createForceSelectionRendererDeps(ctx) {
  return {
    view: {
      getGraphSelection: () => ctx.getGraphSelection()
    },
    selection: {
      getRenderableSelectionIds: () => ctx.getRenderableSelectionIds()
    },
    force: {
      getNodes: () => ctx.getNodes(),
      getLinks: () => ctx.getLinks()
    },
    cache: {
      setSelectionLines: value => ctx.setSelectionLines(value),
      setSelectionCircles: value => ctx.setSelectionCircles(value)
    },
    constants: {
      getSelectionColor: () => ctx.getSelectionColor(),
      getSelectionOutline: () => ctx.getSelectionOutline(),
      getBondSelectionRadius: () => ctx.getBondSelectionRadius(),
      getAtomSelectionRadius: () => ctx.getAtomSelectionRadius(),
      getOutlineWidth: () => ctx.getOutlineWidth()
    },
    helpers: {
      atomRadius: ctx.atomRadius
    }
  };
}
