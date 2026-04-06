import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createAppRuntimeCallDeps } from '../../../../src/app/bootstrap/deps/app-runtime-call-deps.js';

describe('app-runtime call dependency builder', () => {
  it('builds the runtime bootstrap context with live wrappers', () => {
    let inputMode = 'smiles';
    let selectionModifierActive = false;
    let forceKeepInViewDisabled = false;
    let reactionTemplatesUpdated = false;

    const deps = createAppRuntimeCallDeps({
      Molecule: class Molecule {},
      document: {},
      window: {},
      runtimeState: {},
      inputEl: { value: 'CCO' },
      getInputMode: () => inputMode,
      setInputMode: value => {
        inputMode = value;
      },
      domElements: {},
      plotEl: {},
      toSMILES() {},
      toInChI() {},
      appState: { id: 'app-state' },
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
      setSelectionModifierActive(value) {
        selectionModifierActive = value;
      },
      setErasePainting() {},
      syncToolButtonsFromState() {},
      refreshSelectionOverlay() {},
      setDrawBondState() {},
      setDrawBondHoverSuppressed() {},
      clearDrawBondArtifacts() {},
      getForceAutoFitEnabled: () => true,
      setForceAutoFitEnabled() {},
      getForceKeepInView: () => true,
      setForceKeepInView() {},
      getForceKeepInViewTicks: () => 2,
      setForceKeepInViewTicks() {},
      disableForceKeepInView() {
        forceKeepInViewDisabled = true;
      },
      simulation: {},
      isHydrogenNode: () => false,
      forceHelpers: {},
      g: {},
      getDraw2D() {
        return 'draw2d';
      },
      forceSceneRenderer: {},
      resetForceRenderCaches() {},
      syncInputField() {},
      captureAppSnapshot() {},
      restoreSnapshot() {},
      inputFlowRenderers: { id: 'input-renderers' },
      renderRuntime: { id: 'render-runtime' },
      updateFunctionalGroups() {},
      updateFormula() {},
      updateDescriptors() {},
      updateAnalysisPanels() {},
      updateReactionTemplatesPanel() {
        reactionTemplatesUpdated = true;
      },
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
      zoomTransformHelpers: {},
      zoomToFitIf2d() {},
      tooltip: {},
      parseSMILES() {},
      parseINCHI() {},
      detectChemicalStringFormat() {},
      kekulize() {},
      refreshAromaticity() {},
      navigationActions: { id: 'nav' },
      exampleMolecules: [{ smiles: 'CCO' }],
      moleculeCatalog: [{ name: 'ethanol' }],
      forceBondLength: 80
    });

    deps.setInputMode('inchi');
    deps.setSelectionModifierActive(true);
    deps.disableForceKeepInView();
    deps.updateReactionTemplatesPanel();

    assert.equal(deps.getInputMode(), 'inchi');
    assert.equal(selectionModifierActive, true);
    assert.equal(forceKeepInViewDisabled, true);
    assert.equal(reactionTemplatesUpdated, true);
    assert.equal(deps.getDraw2D(), 'draw2d');
    assert.equal(deps.renderRuntime.id, 'render-runtime');
    assert.equal(deps.appState.id, 'app-state');
  });
});
