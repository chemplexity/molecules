/** @module app/bootstrap/runtime-bridges */

import { createAppStateBridge } from '../core/app-state-bridge.js';
import { createRenderRuntime } from '../render/render-runtime.js';
import { createRuntimeUi } from '../ui/runtime-ui.js';
import { createAppStateBridgeDeps } from './deps/app-state-deps.js';
import { createRenderRuntimeDeps } from './deps/render-runtime-deps.js';

/**
 * Instantiates and connects the runtime UI, app state bridge, and render runtime from the provided dependencies.
 * @param {object} deps - Flat dependency object providing runtimeState, render helpers, zoom utilities, and analysis updaters.
 * @returns {object} Object exposing `appState`, `renderRuntime`, and convenience methods for input sync, snapshots, analysis panels, and mode chrome.
 */
export function initializeRuntimeBridges(deps) {
  const runtimeUi = createRuntimeUi({
    getSessionRuntimeBridge: () => deps.runtimeState.sessionRuntimeBridge,
    render2DHelpers: deps.render2DHelpers,
    getSessionUiState: () => deps.runtimeState.sessionUiState,
    getSessionSnapshotManager: () => deps.runtimeState.sessionSnapshotManager,
    dom: deps.domElements
  });

  const appState = createAppStateBridge(
    createAppStateBridgeDeps({
      runtimeState: deps.runtimeState,
      captureZoomTransformSnapshot: () => deps.captureZoomTransformSnapshot(),
      restore2dEditViewport: (zoomSnapshot, options) => deps.restore2dEditViewport(zoomSnapshot, options),
      render2DHelpers: deps.render2DHelpers,
      pickStereoWedgesPreserving2dChoice: mol => deps.pickStereoWedgesPreserving2dChoice(mol),
      clearPrimitiveHover: () => deps.clearPrimitiveHover(),
      setPrimitiveHover: (atomIds = [], bondIds = []) => deps.setPrimitiveHover(atomIds, bondIds),
      setDrawBondHoverSuppressed: value => {
        deps.setDrawBondHoverSuppressed(value);
      },
      setPrimitiveHoverSuppressed: value => {
        deps.setPrimitiveHoverSuppressed(value);
      },
      restorePersistentHighlight: () => deps.restorePersistentHighlight(),
      fitCurrent2dView: () => deps.fitCurrent2dView(),
      enableForceKeepInView: () => deps.enableForceKeepInView(),
      getZoomTransform: () => deps.getZoomTransform(),
      setZoomTransform: transform => deps.setZoomTransform(transform),
      makeZoomIdentity: (x, y, k) => deps.makeZoomIdentity(x, y, k),
      setPreserveSelectionOnNextRender: value => {
        deps.setPreserveSelectionOnNextRender(value);
      },
      scale: deps.scale,
      getSelectedAtomIds: () => deps.runtimeState.selectedAtomIds,
      getSelectedBondIds: () => deps.runtimeState.selectedBondIds,
      getHoveredAtomIds: () => deps.runtimeState.hoveredAtomIds,
      getHoveredBondIds: () => deps.runtimeState.hoveredBondIds,
      getSelectionModifierActive: () => deps.runtimeState.selectionModifierActive,
      setSelectionModifierActive: value => {
        deps.runtimeState.selectionModifierActive = value;
      },
      getSelectMode: () => deps.runtimeState.selectMode,
      setSelectMode: value => {
        deps.runtimeState.selectMode = value;
      },
      getDrawBondMode: () => deps.runtimeState.drawBondMode,
      setDrawBondMode: value => {
        deps.runtimeState.drawBondMode = value;
      },
      getEraseMode: () => deps.runtimeState.eraseMode,
      setEraseMode: value => {
        deps.runtimeState.eraseMode = value;
      },
      getChargeTool: () => deps.runtimeState.chargeTool ?? null,
      setChargeTool: value => {
        deps.runtimeState.chargeTool = value ?? null;
      },
      getErasePainting: () => deps.runtimeState.erasePainting,
      setErasePainting: value => {
        deps.runtimeState.erasePainting = value;
      },
      getDrawBondElement: () => deps.runtimeState.drawBondElement,
      setDrawBondElement: value => {
        deps.runtimeState.drawBondElement = value;
      },
      getDrawBondType: () => deps.runtimeState.drawBondType,
      setDrawBondType: value => {
        deps.runtimeState.drawBondType = value;
      }
    })
  );

  const renderRuntime = createRenderRuntime(
    createRenderRuntimeDeps({
      runtimeState: deps.runtimeState,
      captureZoomTransform: () => deps.captureZoomTransformSnapshot(),
      restoreZoomTransform: snapshot => deps.restoreZoomTransformSnapshot(snapshot),
      clearUndoHistory: () => deps.clearUndoHistory(),
      clearHighlightState: () => deps.clearHighlightState(),
      kekulize: deps.kekulize,
      stopSimulation: () => deps.stopSimulation(),
      getDraw2D: () => deps.getDraw2D(),
      getRender2D: () => deps.getRender2D(),
      forceSceneRenderer: deps.forceSceneRenderer,
      updateFormula: mol => deps.updateFormula(mol),
      updateDescriptors: mol => deps.updateDescriptors(mol),
      updateAnalysisPanels: (mol, options = {}) => deps.updateAnalysisPanels(mol, options)
    })
  );

  return {
    appState,
    renderRuntime,
    syncInputField: mol => runtimeUi.syncInputField(mol),
    sync2dDerivedState: mol => runtimeUi.sync2dDerivedState(mol),
    serializeSnapshotMol: mol => runtimeUi.serializeSnapshotMol(mol),
    captureAppSnapshot: options => runtimeUi.captureAppSnapshot(options),
    updateAnalysisPanels: (mol, options = {}) => runtimeUi.updateAnalysisPanels(mol, options),
    restorePanelState: panelState => runtimeUi.restorePanelState(panelState),
    restoreInteractionState: snap => runtimeUi.restoreInteractionState(snap),
    restoreSnapshot: snap => runtimeUi.restoreSnapshot(snap),
    updateModeChrome: nextMode => runtimeUi.updateModeChrome(nextMode)
  };
}
