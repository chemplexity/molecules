/** @module app/bootstrap/runtime-state */

export const VALENCE_WARNING_FILL = 'rgba(214, 48, 49, 0.3)';

export function createRuntimeState({ getRenderOptions, validateValence }) {
  const runtimeState = {
    mode: '2d',
    currentMol: null,
    currentSmiles: null,
    currentInchi: null,
    rotationDeg: 0,
    flipH: false,
    flipV: false,
    fontSize: getRenderOptions().twoDAtomFontSize,
    appController: null,
    structuralEditActions: null,
    sessionUiState: null,
    sessionRuntimeBridge: null,
    sessionSnapshotManager: null,
    mol2d: null,
    hCounts2d: null,
    cx2d: 0,
    cy2d: 0,
    stereoMap2d: null,
    activeValenceWarningMap: new Map(),
    selectionValenceTooltipAtomId: null,
    selectedAtomIds: new Set(),
    selectedBondIds: new Set(),
    hoveredAtomIds: new Set(),
    hoveredBondIds: new Set(),
    selectionModifierActive: false,
    selectMode: false,
    drawBondMode: false,
    eraseMode: false,
    erasePainting: false,
    forceSelectionLines: null,
    forceSelectionCircles: null,
    forceValenceWarningCircles: null,
    functionalGroupHighlightLines: null,
    functionalGroupHighlightCircles: null,
    drawBondElement: 'C',
    drawBondState: null,
    drawBondHoverSuppressed: false,
    primitiveHoverSuppressed: false,
    preserveSelectionOnNextRender: false,
    forceAutoFitEnabled: true,
    forceKeepInView: false,
    forceKeepInViewTicks: 0,
    capturePhyschemHighlightSnapshot: () => null,
    restorePhyschemHighlightSnapshot: () => false
  };

  runtimeState.valenceWarningMapFor = molecule => {
    if (!getRenderOptions().showValenceWarnings) {
      return new Map();
    }
    return new Map(validateValence(molecule).map(warning => [warning.atomId, warning]));
  };

  runtimeState.resetValenceWarnings = () => {
    runtimeState.activeValenceWarningMap = new Map();
    runtimeState.selectionValenceTooltipAtomId = null;
  };

  return runtimeState;
}
