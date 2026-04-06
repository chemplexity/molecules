import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createAppRuntimeDeps } from '../../../../src/app/bootstrap/deps/app-runtime-deps.js';

describe('app-runtime dependency builder', () => {
  it('builds runtime deps with live state callbacks', () => {
    let inputMode = 'smiles';
    const runtimeState = { mode: 'force', selectionValenceTooltipAtomId: null };
    const simulation = {
      _nodes: [{ id: 1, x: 2, y: 3, vx: 4, vy: 5, anchorX: 6, anchorY: 7 }],
      nodes(value) {
        if (value) {
          this._nodes = value;
        }
        return this._nodes;
      },
      force() {
        return {
          links() {}
        };
      },
      stop() {},
      alpha() {
        return { restart() {} };
      }
    };
    let artifactsCleared = false;
    let keepInViewDisabled = false;

    const deps = createAppRuntimeDeps({
      Molecule: class Molecule {},
      document: {},
      window: {},
      runtimeState,
      inputEl: { value: 'CCO' },
      getInputMode: () => inputMode,
      setInputMode: value => {
        inputMode = value;
      },
      domElements: { clearFormula() {}, clearWeight() {}, clearDescriptors() {}, clearFunctionalGroups() {}, clearSummary() {} },
      plotEl: {},
      toSMILES: () => 'CCO',
      toInChI: () => 'InChI=1S/C2H6O',
      appState: {},
      getSelectedAtomIds: () => new Set([1]),
      getSelectedBondIds: () => new Set([2]),
      setSelectedAtomIds() {},
      setSelectedBondIds() {},
      getSelectMode: () => true,
      setSelectMode() {},
      getDrawBondMode: () => false,
      setDrawBondMode() {},
      getEraseMode: () => false,
      setEraseMode() {},
      getDrawBondElement: () => 'C',
      setDrawBondElement() {},
      clearSelection() {},
      clearHovered() {},
      clearHoveredAtomIds() {},
      clearHoveredBondIds() {},
      setSelectionModifierActive() {},
      setErasePainting() {},
      syncToolButtonsFromState() {},
      refreshSelectionOverlay() {},
      setDrawBondState() {},
      setDrawBondHoverSuppressed() {},
      clearDrawBondArtifacts: () => {
        artifactsCleared = true;
      },
      getForceAutoFitEnabled: () => true,
      setForceAutoFitEnabled() {},
      getForceKeepInView: () => true,
      setForceKeepInView() {},
      getForceKeepInViewTicks: () => 3,
      setForceKeepInViewTicks() {},
      disableForceKeepInView: () => {
        keepInViewDisabled = true;
      },
      simulation,
      isHydrogenNode: () => false,
      forceHelpers: {
        placeHydrogensAroundParent() {},
        patchForceNodePositions() {},
        reseatHydrogensAroundPatched() {}
      },
      g: { selectAll: () => ({ remove() {} }) },
      draw2d() {},
      forceSceneRenderer: { updateForce() {} },
      resetForceRenderCaches() {},
      syncInputField() {},
      captureAppSnapshot() {},
      restoreSnapshot() {},
      inputFlowRenderers: {},
      renderRuntime: {},
      updateFunctionalGroups() {},
      updateFormula() {},
      updateDescriptors() {},
      updateAnalysisPanels() {},
      updateReactionTemplatesPanel() {},
      updateResonancePanel() {},
      clearResonancePanelState() {},
      updateBondEnPanel() {},
      clearBondEnPanel() {},
      captureReactionPreviewSnapshot() {},
      restoreReactionPreviewSnapshot() {},
      clearReactionPreviewState() {},
      reapplyActiveReactionPreview() {},
      hasReactionPreview: () => false,
      prepareReactionPreviewBondEditTarget() {},
      prepareReactionPreviewEditTargets() {},
      prepareResonanceUndoSnapshot() {},
      restoreResonanceViewSnapshot() {},
      prepareResonanceStructuralEdit() {},
      prepareResonanceStateForStructuralEdit() {},
      captureHighlightSnapshot() {},
      clearHighlightState() {},
      restoreHighlightSnapshot() {},
      restorePhyschemHighlightSnapshot() {},
      restorePersistentHighlight() {},
      takeSnapshot() {},
      updateModeChrome() {},
      restoreZoomTransformSnapshot() {},
      captureZoomTransformSnapshot() {},
      zoomTransformHelpers: {
        restoreZoomTransformSnapshot() {},
        captureZoomTransformSnapshot() {}
      },
      zoomToFitIf2d() {},
      tooltip: {
        interrupt() {
          return { style() {} };
        }
      },
      parseSMILES() {},
      parseINCHI() {},
      detectChemicalStringFormat() {},
      kekulize() {},
      refreshAromaticity() {},
      navigationActions: {},
      exampleMolecules: [{ smiles: 'CCO' }],
      moleculeCatalog: [],
      forceBondLength: 80
    });

    assert.equal(deps.input.getInputMode(), 'smiles');
    deps.input.setInputMode('inchi');
    assert.equal(deps.input.getInputMode(), 'inchi');
    assert.deepEqual(deps.force.getNodePositions(), [{ id: 1, x: 2, y: 3, vx: 4, vy: 5, anchorX: 6, anchorY: 7 }]);
    deps.drawBond.clearArtifacts();
    deps.force.disableKeepInView();
    assert.equal(artifactsCleared, true);
    assert.equal(keepInViewDisabled, true);
  });
});
