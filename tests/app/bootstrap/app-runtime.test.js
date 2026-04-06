import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createAppRuntime } from '../../../src/app/bootstrap/app-runtime.js';

function noop() {}

describe('app-runtime bootstrap helpers', () => {
  it('builds the runtime managers and stores them on runtime state', () => {
    const runtimeState = {
      mode: '2d',
      currentMol: null,
      currentSmiles: null,
      currentInchi: null,
      rotationDeg: 0,
      flipH: false,
      flipV: false,
      mol2d: null,
      hCounts2d: null,
      stereoMap2d: null,
      cx2d: 0,
      cy2d: 0,
      selectionValenceTooltipAtomId: null,
      resetValenceWarnings: noop
    };

    const inputFlowManager = {
      setInputFormat: noop,
      parseInput: noop,
      parseInputWithAutoFormat: noop
    };
    const inputControls = {
      getCollectionInputValue: () => '',
      syncCollectionPickerForInputValue: noop,
      renderExamples: noop
    };
    const appController = {
      performStructuralEdit: noop
    };
    const structuralEditActions = {};

    const result = createAppRuntime({
      Molecule: class Molecule {},
      document: {},
      window: {},
      runtimeState,
      factories: {
        createSessionUiStateBridge: config => ({ type: 'session-ui', config }),
        createSessionRuntimeBridge: config => ({ type: 'session-runtime', config }),
        createSessionSnapshotDeps: config => config,
        createSessionSnapshotManager: config => ({ type: 'session-snapshot', config }),
        createInputFlowDeps: config => config,
        createInputFlowManager: config => ({ ...inputFlowManager, config }),
        createInputControlsDeps: config => config,
        createInputControls: config => ({ ...inputControls, config }),
        createAppControllerDeps: config => config,
        createAppController: config => ({ ...appController, config }),
        createStructuralEditActions: config => ({ ...structuralEditActions, config })
      },
      input: {
        getInputMode: () => 'smiles',
        setInputMode: noop,
        getInputValue: () => ''
      },
      dom: {
        getInputElement: () => ({}),
        getCollectionSelectElement: () => ({}),
        getExamplesElement: () => ({}),
        setInputFormatButtons: noop,
        setInputLabel: noop,
        setInputValue: noop,
        clearFormula: noop,
        clearWeight: noop,
        clearDescriptors: noop,
        clearFunctionalGroups: noop,
        clearSummary: noop,
        plotEl: {}
      },
      io: {
        toSMILES: () => '',
        toInChI: () => ''
      },
      state: {
        appState: {}
      },
      selection: {
        getSelectedAtomIds: () => new Set(),
        getSelectedBondIds: () => new Set(),
        setSelectedAtomIds: noop,
        setSelectedBondIds: noop,
        getSelectMode: () => false,
        setSelectMode: noop,
        getDrawBondMode: () => false,
        setDrawBondMode: noop,
        getEraseMode: () => false,
        setEraseMode: noop,
        getDrawBondElement: () => 'C',
        setDrawBondElement: noop,
        clearSelection: noop,
        clearHovered: noop,
        clearHoveredAtomIds: noop,
        clearHoveredBondIds: noop,
        setSelectionModifierActive: noop,
        setErasePainting: noop,
        syncToolButtonsFromState: noop,
        refreshSelectionOverlay: noop
      },
      drawBond: {
        setDrawBondState: noop,
        setDrawBondHoverSuppressed: noop,
        clearArtifacts: noop
      },
      force: {
        getAutoFitEnabled: () => false,
        setAutoFitEnabled: noop,
        getKeepInView: () => false,
        setKeepInView: noop,
        getKeepInViewTicks: () => 0,
        setKeepInViewTicks: noop,
        disableKeepInView: noop,
        getNodePositions: () => [],
        clearGraph: noop,
        stop: noop,
        restoreNodePositions: noop,
        restart: noop,
        clearIfActive: noop,
        structuralEdit: {
          getSimulation: () => ({}),
          isHydrogenNode: () => false,
          placeHydrogensAroundParent: noop,
          patchNodePositions: noop,
          reseatHydrogensAroundPatched: noop
        }
      },
      scene: {
        clear: noop,
        draw2d: noop,
        updateForce: noop
      },
      cache: {
        reset: noop
      },
      runtime: {
        syncInputField: noop,
        captureAppSnapshot: () => null,
        restoreSnapshot: noop
      },
      renderers: {
        inputFlow: {},
        renderRuntime: {}
      },
      analysis: {
        updateFunctionalGroups: noop,
        updateFormula: noop,
        updateDescriptors: noop,
        updatePanels: noop,
        updatePanelsForController: noop,
        clearFormula: noop,
        clearWeight: noop,
        clearDescriptors: noop,
        clearFunctionalGroups: noop,
        clearSummary: noop,
        clearSelectionValenceTooltip: noop
      },
      overlays: {
        updateReactionTemplatesPanel: noop,
        updateResonancePanel: noop,
        clearResonancePanelState: noop,
        updateBondEnPanel: noop,
        clearBondEnPanel: noop,
        captureReactionPreviewSnapshot: () => null,
        restoreReactionPreviewSnapshot: noop,
        clearReactionPreviewState: noop,
        reapplyActiveReactionPreview: noop,
        hasReactionPreview: () => false,
        prepareReactionPreviewBondEditTarget: () => null,
        prepareReactionPreviewEditTargets: () => null
      },
      resonance: {
        prepareResonanceUndoSnapshot: noop,
        restoreResonanceViewSnapshot: noop,
        prepareResonanceStructuralEdit: noop,
        prepareResonanceStateForStructuralEdit: noop
      },
      highlights: {
        captureHighlightSnapshot: () => null,
        clearHighlightState: noop,
        restoreFunctionalGroupHighlightSnapshot: noop,
        restorePhyschemHighlightSnapshot: noop,
        restorePersistentHighlight: noop
      },
      history: {
        takeSnapshot: noop
      },
      view: {
        updateModeChrome: noop,
        restoreZoomTransformSnapshot: noop,
        captureZoomTransformSnapshot: () => null,
        restoreZoomTransform: noop,
        captureZoomTransform: () => null,
        zoomToFitIf2d: noop,
        hideTooltip: noop
      },
      molecule: {
        getMolSmiles: () => null,
        getMolInchi: () => null
      },
      parsers: {
        parseSMILES: noop,
        parseINCHI: noop,
        detectChemicalStringFormat: () => null
      },
      chemistry: {
        kekulize: noop,
        refreshAromaticity: noop
      },
      actions: {
        navigationActions: {}
      },
      data: {
        exampleMolecules: [],
        randomMolecule: [],
        moleculeCatalog: []
      },
      constants: {
        forceBondLength: 42
      }
    });

    assert.equal(result.inputFlowManager.parseInput, inputFlowManager.parseInput);
    assert.equal(result.inputControls.renderExamples, inputControls.renderExamples);
    assert.equal(runtimeState.sessionUiState.type, 'session-ui');
    assert.equal(runtimeState.sessionRuntimeBridge.type, 'session-runtime');
    assert.equal(runtimeState.sessionSnapshotManager.type, 'session-snapshot');
    assert.equal(runtimeState.appController.performStructuralEdit, appController.performStructuralEdit);
    assert.deepEqual(runtimeState.structuralEditActions, { ...structuralEditActions, config: runtimeState.structuralEditActions.config });
  });
});
