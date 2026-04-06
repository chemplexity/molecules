/** @module app/bootstrap/deps/app-runtime-call-deps */

export function createAppRuntimeCallDeps(ctx) {
  return {
    Molecule: ctx.Molecule,
    document: ctx.document,
    window: ctx.window,
    runtimeState: ctx.runtimeState,
    inputEl: ctx.inputEl,
    getInputMode: () => ctx.getInputMode(),
    setInputMode: value => {
      ctx.setInputMode(value);
    },
    domElements: ctx.domElements,
    plotEl: ctx.plotEl,
    toSMILES: ctx.toSMILES,
    toInChI: ctx.toInChI,
    appState: ctx.appState,
    getSelectedAtomIds: () => ctx.getSelectedAtomIds(),
    getSelectedBondIds: () => ctx.getSelectedBondIds(),
    setSelectedAtomIds: value => {
      ctx.setSelectedAtomIds(value);
    },
    setSelectedBondIds: value => {
      ctx.setSelectedBondIds(value);
    },
    getSelectMode: () => ctx.getSelectMode(),
    setSelectMode: value => {
      ctx.setSelectMode(value);
    },
    getDrawBondMode: () => ctx.getDrawBondMode(),
    setDrawBondMode: value => {
      ctx.setDrawBondMode(value);
    },
    getEraseMode: () => ctx.getEraseMode(),
    setEraseMode: value => {
      ctx.setEraseMode(value);
    },
    getDrawBondElement: () => ctx.getDrawBondElement(),
    setDrawBondElement: value => {
      ctx.setDrawBondElement(value);
    },
    clearSelection: () => {
      ctx.clearSelection();
    },
    clearHovered: () => {
      ctx.clearHovered();
    },
    clearHoveredAtomIds: () => ctx.clearHoveredAtomIds(),
    clearHoveredBondIds: () => ctx.clearHoveredBondIds(),
    setSelectionModifierActive: value => {
      ctx.setSelectionModifierActive(value);
    },
    setErasePainting: value => {
      ctx.setErasePainting(value);
    },
    syncToolButtonsFromState: () => ctx.syncToolButtonsFromState(),
    refreshSelectionOverlay: () => ctx.refreshSelectionOverlay(),
    setDrawBondState: value => {
      ctx.setDrawBondState(value);
    },
    setDrawBondHoverSuppressed: value => {
      ctx.setDrawBondHoverSuppressed(value);
    },
    clearDrawBondArtifacts: () => ctx.clearDrawBondArtifacts(),
    getForceAutoFitEnabled: () => ctx.getForceAutoFitEnabled(),
    setForceAutoFitEnabled: value => {
      ctx.setForceAutoFitEnabled(value);
    },
    getForceKeepInView: () => ctx.getForceKeepInView(),
    setForceKeepInView: value => {
      ctx.setForceKeepInView(value);
    },
    getForceKeepInViewTicks: () => ctx.getForceKeepInViewTicks(),
    setForceKeepInViewTicks: value => {
      ctx.setForceKeepInViewTicks(value);
    },
    disableForceKeepInView: () => ctx.disableForceKeepInView(),
    simulation: ctx.simulation,
    isHydrogenNode: ctx.isHydrogenNode,
    forceHelpers: ctx.forceHelpers,
    g: ctx.g,
    getDraw2D: () => ctx.getDraw2D(),
    forceSceneRenderer: ctx.forceSceneRenderer,
    resetForceRenderCaches: () => {
      ctx.resetForceRenderCaches();
    },
    syncInputField: mol => ctx.syncInputField(mol),
    captureAppSnapshot: options => ctx.captureAppSnapshot(options),
    restoreSnapshot: snap => ctx.restoreSnapshot(snap),
    inputFlowRenderers: ctx.inputFlowRenderers,
    renderRuntime: ctx.renderRuntime,
    updateFunctionalGroups: mol => ctx.updateFunctionalGroups(mol),
    updateFormula: mol => ctx.updateFormula(mol),
    updateDescriptors: mol => ctx.updateDescriptors(mol),
    updateAnalysisPanels: (mol, options = {}) => ctx.updateAnalysisPanels(mol, options),
    updateReactionTemplatesPanel: () => ctx.updateReactionTemplatesPanel(),
    updateResonancePanel: (mol, options = {}) => ctx.updateResonancePanel(mol, options),
    clearResonancePanelState: () => ctx.clearResonancePanelState(),
    updateBondEnPanel: mol => ctx.updateBondEnPanel(mol),
    clearBondEnPanel: () => ctx.clearBondEnPanel(),
    captureReactionPreviewSnapshot: () => ctx.captureReactionPreviewSnapshot(),
    restoreReactionPreviewSnapshot: snap => ctx.restoreReactionPreviewSnapshot(snap),
    clearReactionPreviewState: () => ctx.clearReactionPreviewState(),
    reapplyActiveReactionPreview: () => ctx.reapplyActiveReactionPreview(),
    hasReactionPreview: () => ctx.hasReactionPreview(),
    prepareReactionPreviewBondEditTarget: bondId => ctx.prepareReactionPreviewBondEditTarget(bondId),
    prepareReactionPreviewEditTargets: payload => ctx.prepareReactionPreviewEditTargets(payload),
    prepareResonanceUndoSnapshot: mol => ctx.prepareResonanceUndoSnapshot(mol),
    restoreResonanceViewSnapshot: (mol, snap) => ctx.restoreResonanceViewSnapshot(mol, snap),
    prepareResonanceStructuralEdit: mol => ctx.prepareResonanceStructuralEdit(mol),
    prepareResonanceStateForStructuralEdit: mol => ctx.prepareResonanceStateForStructuralEdit(mol),
    captureHighlightSnapshot: () => ctx.captureHighlightSnapshot(),
    clearHighlightState: () => ctx.clearHighlightState(),
    restoreHighlightSnapshot: (snapshot, mol) => ctx.restoreHighlightSnapshot(snapshot, mol),
    restorePhyschemHighlightSnapshot: snapshot => ctx.restorePhyschemHighlightSnapshot(snapshot),
    restorePersistentHighlight: () => ctx.restorePersistentHighlight(),
    takeSnapshot: options => ctx.takeSnapshot(options),
    updateModeChrome: nextMode => ctx.updateModeChrome(nextMode),
    restoreZoomTransformSnapshot: snapshot => ctx.restoreZoomTransformSnapshot(snapshot),
    captureZoomTransformSnapshot: () => ctx.captureZoomTransformSnapshot(),
    zoomTransformHelpers: ctx.zoomTransformHelpers,
    zoomToFitIf2d: () => ctx.zoomToFitIf2d(),
    tooltip: ctx.tooltip,
    parseSMILES: ctx.parseSMILES,
    parseINCHI: ctx.parseINCHI,
    detectChemicalStringFormat: ctx.detectChemicalStringFormat,
    kekulize: ctx.kekulize,
    refreshAromaticity: ctx.refreshAromaticity,
    navigationActions: ctx.navigationActions,
    exampleMolecules: ctx.exampleMolecules,
    moleculeCatalog: ctx.moleculeCatalog,
    forceBondLength: ctx.forceBondLength
  };
}
