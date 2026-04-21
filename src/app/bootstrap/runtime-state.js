/** @module app/bootstrap/runtime-state */

export const VALENCE_WARNING_FILL = 'rgba(214, 48, 49, 0.3)';

/**
 * Allocates and returns the mutable runtime state object that holds the current molecule, view mode, selection, and render state.
 * @param {object} params - Runtime state initialization parameters.
 * @param {() => object} params.getRenderOptions - Returns the current render options object (used to seed the initial font size).
 * @param {(mol: object) => object[]} params.validateValence - Returns an array of valence warnings for a given molecule.
 * @returns {object} Mutable runtime state object shared across the application.
 */
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
    chargeTool: null,
    forceSelectionLines: null,
    forceSelectionCircles: null,
    forceValenceWarningCircles: null,
    functionalGroupHighlightLines: null,
    functionalGroupHighlightCircles: null,
    drawBondElement: 'C',
    drawBondType: 'single',
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

  runtimeState.clearSelection = () => {
    runtimeState.selectedAtomIds.clear();
    runtimeState.selectedBondIds.clear();
  };

  runtimeState.resetRenderCaches = () => {
    runtimeState.forceSelectionLines = null;
    runtimeState.forceSelectionCircles = null;
    runtimeState.forceValenceWarningCircles = null;
    runtimeState.functionalGroupHighlightLines = null;
    runtimeState.functionalGroupHighlightCircles = null;
  };

  return runtimeState;
}
