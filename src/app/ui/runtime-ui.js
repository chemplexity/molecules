/** @module app/ui/runtime-ui */

export function createRuntimeUi(deps) {
  function getSessionRuntimeBridge() {
    return deps.getSessionRuntimeBridge ? deps.getSessionRuntimeBridge() : deps.sessionRuntimeBridge;
  }

  function getSessionUiState() {
    return deps.getSessionUiState ? deps.getSessionUiState() : deps.sessionUiState;
  }

  function getSessionSnapshotManager() {
    return deps.getSessionSnapshotManager ? deps.getSessionSnapshotManager() : deps.sessionSnapshotManager;
  }

  function updateModeChrome(nextMode) {
    const btn = deps.dom.getToggleButtonElement();
    const rotateCtrls = deps.dom.getRotateControlsElement();
    const cleanCtrls = deps.dom.getCleanControlsElement();
    const clean2dBtn = deps.dom.getClean2dButtonElement();
    const cleanForceBtn = deps.dom.getCleanForceButtonElement();
    const drawTools = deps.dom.getDrawToolsElement();
    const forceCtrls = deps.dom.getForceControlsElement();
    if (nextMode === 'force') {
      btn.textContent = '⬡ 2D Structure';
      rotateCtrls.style.display = 'none';
      cleanCtrls.style.display = 'flex';
      clean2dBtn.style.display = 'none';
      cleanForceBtn.style.display = 'flex';
      drawTools.style.display = 'flex';
      forceCtrls.style.display = 'flex';
      return;
    }
    btn.textContent = '⚡ Force Layout';
    rotateCtrls.style.display = 'flex';
    cleanCtrls.style.display = 'flex';
    clean2dBtn.style.display = 'flex';
    cleanForceBtn.style.display = 'none';
    drawTools.style.display = 'flex';
    forceCtrls.style.display = 'none';
  }

  return {
    syncInputField: mol => getSessionRuntimeBridge().syncInputField(mol),
    sync2dDerivedState: mol => deps.render2DHelpers.sync2dDerivedState(mol),
    serializeSnapshotMol: mol => getSessionUiState().serializeSnapshotMol(mol),
    captureAppSnapshot: options => getSessionSnapshotManager().capture(options),
    updateAnalysisPanels: (mol, options = {}) => getSessionUiState().updateAnalysisPanels(mol, options),
    restorePanelState: panelState => getSessionUiState().restorePanelState(panelState),
    restoreInteractionState: snap => getSessionUiState().restoreInteractionState(snap),
    restoreSnapshot: snap => getSessionSnapshotManager().restore(snap),
    updateModeChrome
  };
}
