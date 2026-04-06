/** @module app/bootstrap/app-runtime */

import { createAppController } from '../core/app-controller.js';
import { createAppControllerDeps } from '../core/deps/app-controller-deps.js';
import { createInputFlowDeps } from '../core/deps/input-flow-deps.js';
import { createInputFlowManager } from '../core/input-flow.js';
import { createSessionSnapshotManager } from '../core/session-snapshot.js';
import { createSessionSnapshotDeps } from '../core/deps/session-snapshot-deps.js';
import { createSessionRuntimeBridge } from '../core/session-runtime-bridge.js';
import { createSessionUiStateBridge } from '../core/session-ui-state.js';
import { createInputControls } from '../interactions/input-controls.js';
import { createInputControlsDeps } from '../interactions/deps/input-controls-deps.js';
import { createStructuralEditActions } from '../interactions/structural-edit-actions.js';

export function createAppRuntime(deps) {
  const managers = {
    inputFlowManager: null,
    inputControls: null
  };

  deps.runtimeState.sessionUiState = deps.factories.createSessionUiStateBridge({
    document: deps.document,
    updateFunctionalGroups: deps.analysis.updateFunctionalGroups,
    updateReactionTemplatesPanel: deps.overlays.updateReactionTemplatesPanel,
    updateResonancePanel: deps.overlays.updateResonancePanel,
    clearResonancePanelState: deps.overlays.clearResonancePanelState,
    updateBondEnPanel: deps.overlays.updateBondEnPanel,
    clearBondEnPanel: deps.overlays.clearBondEnPanel,
    getSelectedAtomIds: deps.selection.getSelectedAtomIds,
    getSelectedBondIds: deps.selection.getSelectedBondIds,
    getSelectMode: deps.selection.getSelectMode,
    getDrawBondMode: deps.selection.getDrawBondMode,
    getEraseMode: deps.selection.getEraseMode,
    getDrawBondElement: deps.selection.getDrawBondElement,
    getForceAutoFitEnabled: deps.force.getAutoFitEnabled,
    getForceKeepInView: deps.force.getKeepInView,
    getForceKeepInViewTicks: deps.force.getKeepInViewTicks,
    setSelectedAtomIds: deps.selection.setSelectedAtomIds,
    setSelectedBondIds: deps.selection.setSelectedBondIds,
    clearHoveredAtomIds: deps.selection.clearHoveredAtomIds,
    clearHoveredBondIds: deps.selection.clearHoveredBondIds,
    setSelectionModifierActive: deps.selection.setSelectionModifierActive,
    setDrawBondState: deps.drawBond.setDrawBondState,
    setDrawBondHoverSuppressed: deps.drawBond.setDrawBondHoverSuppressed,
    setErasePainting: deps.selection.setErasePainting,
    setDrawBondElement: deps.selection.setDrawBondElement,
    setSelectMode: deps.selection.setSelectMode,
    setDrawBondMode: deps.selection.setDrawBondMode,
    setEraseMode: deps.selection.setEraseMode,
    setForceAutoFitEnabled: deps.force.setAutoFitEnabled,
    setForceKeepInView: deps.force.setKeepInView,
    setForceKeepInViewTicks: deps.force.setKeepInViewTicks,
    clearDrawBondArtifacts: deps.drawBond.clearArtifacts,
    hideTooltip: deps.view.hideTooltip,
    clearSelectionValenceTooltip: deps.analysis.clearSelectionValenceTooltip,
    syncToolButtonsFromState: deps.selection.syncToolButtonsFromState,
    refreshSelectionOverlay: deps.selection.refreshSelectionOverlay
  });

  deps.runtimeState.sessionRuntimeBridge = deps.factories.createSessionRuntimeBridge({
    io: deps.io,
    state: {
      getInputMode: deps.input.getInputMode,
      setCurrentSmiles: value => {
        deps.runtimeState.currentSmiles = value;
      },
      setCurrentInchi: value => {
        deps.runtimeState.currentInchi = value;
      }
    },
    dom: {
      setInputValue: deps.dom.setInputValue
    },
    view: {
      getMode: () => deps.runtimeState.mode,
      captureZoomTransform: deps.view.captureZoomTransform,
      restoreZoomTransform: deps.view.restoreZoomTransform,
      getRotationDeg: () => deps.runtimeState.rotationDeg,
      getFlipH: () => deps.runtimeState.flipH,
      getFlipV: () => deps.runtimeState.flipV,
      getCx2d: () => deps.runtimeState.cx2d,
      getCy2d: () => deps.runtimeState.cy2d,
      getHCounts2d: () => deps.runtimeState.hCounts2d,
      getStereoMap2d: () => deps.runtimeState.stereoMap2d,
      setCx2d: value => {
        deps.runtimeState.cx2d = value;
      },
      setCy2d: value => {
        deps.runtimeState.cy2d = value;
      },
      setHCounts2d: value => {
        deps.runtimeState.hCounts2d = value;
      },
      setStereoMap2d: value => {
        deps.runtimeState.stereoMap2d = value;
      }
    },
    force: {
      getNodePositions: deps.force.getNodePositions,
      clearGraph: deps.force.clearGraph,
      stop: deps.force.stop,
      setAutoFitEnabled: deps.force.setAutoFitEnabled,
      disableKeepInView: deps.force.disableKeepInView,
      restoreNodePositions: deps.force.restoreNodePositions,
      restart: deps.force.restart
    },
    scene: {
      clear: deps.scene.clear,
      draw2d: deps.scene.draw2d,
      updateForce: deps.scene.updateForce
    },
    cache: {
      reset: deps.cache.reset
    },
    selection: {
      clearValenceWarnings: () => deps.runtimeState.resetValenceWarnings()
    },
    analysis: {
      clearFormula: deps.analysis.clearFormula,
      clearWeight: deps.analysis.clearWeight,
      clearDescriptors: deps.analysis.clearDescriptors,
      clearFunctionalGroups: deps.analysis.clearFunctionalGroups
    },
    document: {
      setCurrentMol: value => {
        deps.runtimeState.currentMol = value;
      },
      setMol2d: value => {
        deps.runtimeState.mol2d = value;
      }
    }
  });

  deps.runtimeState.sessionSnapshotManager = deps.factories.createSessionSnapshotManager(
    deps.factories.createSessionSnapshotDeps({
      Molecule: deps.Molecule,
      state: {
        getMode: () => deps.runtimeState.mode,
        setMode: nextMode => {
          deps.runtimeState.mode = nextMode;
        },
        getActiveMolecule: () => (deps.runtimeState.mode === 'force' ? deps.runtimeState.currentMol : deps.runtimeState.mol2d),
        getCurrentMol: () => deps.runtimeState.currentMol,
        setCurrentMol: value => {
          deps.runtimeState.currentMol = value;
        },
        getMol2d: () => deps.runtimeState.mol2d,
        setMol2d: value => {
          deps.runtimeState.mol2d = value;
        },
        getCurrentSmiles: () => deps.runtimeState.currentSmiles,
        setCurrentSmiles: value => {
          deps.runtimeState.currentSmiles = value;
        },
        getCurrentInchi: () => deps.runtimeState.currentInchi,
        setCurrentInchi: value => {
          deps.runtimeState.currentInchi = value;
        }
      },
      input: {
        getInputMode: deps.input.getInputMode,
        getInputValue: deps.input.getInputValue,
        setInputFormat: (fmt, options = {}) => managers.inputFlowManager.setInputFormat(fmt, options)
      },
      dom: {
        updateModeChrome: deps.view.updateModeChrome
      },
      runtime: {
        syncInputField: deps.runtime.syncInputField,
        captureViewState: () => deps.runtimeState.sessionRuntimeBridge.captureViewState(),
        clearForceState: () => deps.runtimeState.sessionRuntimeBridge.clearForceState(),
        clear2dState: () => deps.runtimeState.sessionRuntimeBridge.clear2dState(),
        clearAnalysisState: () => deps.runtimeState.sessionRuntimeBridge.clearAnalysisState(),
        restore2dState: (displayMol, snap) => deps.runtimeState.sessionRuntimeBridge.restore2dState(displayMol, snap),
        restoreForceState: (displayMol, snap) => deps.runtimeState.sessionRuntimeBridge.restoreForceState(displayMol, snap),
        redrawRestoredResonanceView: (mol, snap) => deps.runtimeState.sessionRuntimeBridge.redrawRestoredResonanceView(mol, snap)
      },
      sessionUi: {
        serializeSnapshotMol: mol => deps.runtimeState.sessionUiState.serializeSnapshotMol(mol),
        captureInteractionState: () => deps.runtimeState.sessionUiState.captureInteractionState(),
        capturePanelState: () => deps.runtimeState.sessionUiState.capturePanelState(),
        restorePanelState: panelState => deps.runtimeState.sessionUiState.restorePanelState(panelState),
        restoreInteractionState: snap => deps.runtimeState.sessionUiState.restoreInteractionState(snap)
      },
      overlays: {
        captureReactionPreviewSnapshot: deps.overlays.captureReactionPreviewSnapshot,
        restoreReactionPreviewSnapshot: deps.overlays.restoreReactionPreviewSnapshot,
        clearReactionPreviewState: deps.overlays.clearReactionPreviewState,
        reapplyActiveReactionPreview: deps.overlays.reapplyActiveReactionPreview,
        updateReactionTemplatesPanel: deps.overlays.updateReactionTemplatesPanel
      },
      resonance: {
        prepareResonanceUndoSnapshot: deps.resonance.prepareResonanceUndoSnapshot,
        restoreResonanceViewSnapshot: deps.resonance.restoreResonanceViewSnapshot
      },
      highlights: {
        captureHighlightSnapshot: deps.highlights.captureHighlightSnapshot,
        clearHighlightState: deps.highlights.clearHighlightState,
        restoreFunctionalGroupHighlightSnapshot: deps.highlights.restoreFunctionalGroupHighlightSnapshot,
        restorePhyschemHighlightSnapshot: deps.highlights.restorePhyschemHighlightSnapshot,
        restorePersistentHighlight: deps.highlights.restorePersistentHighlight
      },
      view: {
        setRotationDeg: value => {
          deps.runtimeState.rotationDeg = value;
        },
        setFlipH: value => {
          deps.runtimeState.flipH = value;
        },
        setFlipV: value => {
          deps.runtimeState.flipV = value;
        },
        restoreZoomTransform: deps.view.restoreZoomTransformSnapshot
      },
      analysis: {
        updateFormula: deps.analysis.updateFormula,
        updateDescriptors: deps.analysis.updateDescriptors,
        updatePanels: deps.analysis.updatePanels
      }
    })
  );

  managers.inputFlowManager = deps.factories.createInputFlowManager(
    deps.factories.createInputFlowDeps({
      state: {
        getInputMode: deps.input.getInputMode,
        setInputMode: deps.input.setInputMode,
        getCurrentSmiles: () => deps.runtimeState.currentSmiles,
        setCurrentSmiles: value => {
          deps.runtimeState.currentSmiles = value;
        },
        getCurrentInchi: () => deps.runtimeState.currentInchi,
        setCurrentInchi: value => {
          deps.runtimeState.currentInchi = value;
        },
        getCurrentMol: () => deps.runtimeState.currentMol,
        setCurrentMol: value => {
          deps.runtimeState.currentMol = value;
        },
        getMol2d: () => deps.runtimeState.mol2d,
        setMol2d: value => {
          deps.runtimeState.mol2d = value;
        },
        getMode: () => deps.runtimeState.mode,
        clear2dDerivedState: () => {
          deps.runtimeState.hCounts2d = null;
          deps.runtimeState.stereoMap2d = null;
        },
        clearSelection: deps.selection.clearSelection,
        clearHovered: deps.selection.clearHovered,
        clearForceRenderCaches: deps.cache.reset,
        resetValenceWarnings: () => deps.runtimeState.resetValenceWarnings()
      },
      dom: {
        getInputElement: deps.dom.getInputElement,
        setInputFormatButtons: deps.dom.setInputFormatButtons,
        setInputLabel: deps.dom.setInputLabel
      },
      history: {
        takeSnapshot: deps.history.takeSnapshot
      },
      snapshot: {
        capture: deps.runtime.captureAppSnapshot
      },
      molecule: {
        getMolSmiles: deps.molecule.getMolSmiles,
        getMolInchi: deps.molecule.getMolInchi
      },
      collection: {
        getInputValue: fmt => managers.inputControls?.getCollectionInputValue(fmt) ?? '',
        syncPickerForInputValue: value => managers.inputControls?.syncCollectionPickerForInputValue(value)
      },
      examples: {
        render: () => managers.inputControls?.renderExamples()
      },
      parsers: deps.parsers,
      overlays: {
        hasReactionPreview: deps.overlays.hasReactionPreview,
        clearReactionPreviewState: deps.overlays.clearReactionPreviewState
      },
      renderers: deps.renderers.inputFlow,
      highlights: {
        clear: deps.highlights.clearHighlightState
      },
      force: {
        clearIfActive: deps.force.clearIfActive
      },
      analysis: {
        updatePanels: deps.analysis.updatePanels,
        clearSummary: deps.analysis.clearSummary
      }
    })
  );

  managers.inputControls = deps.factories.createInputControls(
    deps.factories.createInputControlsDeps({
      data: deps.data,
      state: {
        getInputMode: deps.input.getInputMode
      },
      dom: {
        getInputElement: deps.dom.getInputElement,
        getCollectionSelectElement: deps.dom.getCollectionSelectElement,
        getExamplesElement: deps.dom.getExamplesElement
      },
      actions: {
        parseInput: value => managers.inputFlowManager.parseInput(value),
        parseInputWithAutoFormat: value => managers.inputFlowManager.parseInputWithAutoFormat(value)
      }
    })
  );

  deps.runtimeState.appController = deps.factories.createAppController(
    deps.factories.createAppControllerDeps({
      state: deps.state.appState,
      renderers: deps.renderers.renderRuntime,
      history: {
        takeSnapshot: deps.history.takeSnapshot,
        captureSnapshot: deps.runtime.captureAppSnapshot
      },
      panels: {},
      analysis: {
        syncInputField: deps.runtime.syncInputField,
        updateFormula: deps.analysis.updateFormula,
        updateDescriptors: deps.analysis.updateDescriptors,
        updatePanels: deps.analysis.updatePanelsForController
      },
      dom: {
        plotEl: deps.dom.plotEl
      },
      overlays: {
        hasReactionPreview: deps.overlays.hasReactionPreview,
        prepareReactionPreviewBondEditTarget: deps.overlays.prepareReactionPreviewBondEditTarget,
        prepareReactionPreviewEditTargets: deps.overlays.prepareReactionPreviewEditTargets,
        prepareResonanceStructuralEdit: deps.resonance.prepareResonanceStructuralEdit
      },
      snapshot: {
        capture: deps.runtime.captureAppSnapshot,
        restore: deps.runtime.restoreSnapshot
      },
      navigation: deps.actions.navigationActions
    })
  );

  deps.runtimeState.structuralEditActions = deps.factories.createStructuralEditActions({
    controller: {
      performStructuralEdit: (...args) => deps.runtimeState.appController.performStructuralEdit(...args)
    },
    getMode: () => deps.runtimeState.mode,
    getDrawBondElement: deps.selection.getDrawBondElement,
    molecule: {
      getActive: () => (deps.runtimeState.mode === 'force' ? deps.runtimeState.currentMol : deps.runtimeState.mol2d),
      getCurrentForceMol: () => deps.runtimeState.currentMol
    },
    view: {
      captureZoomTransformSnapshot: deps.view.captureZoomTransformSnapshot,
      restoreZoomTransformSnapshot: deps.view.restoreZoomTransformSnapshot,
      zoomToFitIf2d: deps.view.zoomToFitIf2d
    },
    resonance: {
      prepareResonanceStateForStructuralEdit: deps.resonance.prepareResonanceStateForStructuralEdit
    },
    chemistry: deps.chemistry,
    force: deps.force.structuralEdit,
    constants: deps.constants
  });

  return {
    inputFlowManager: managers.inputFlowManager,
    inputControls: managers.inputControls
  };
}

export function initializeAppRuntime(deps) {
  return createAppRuntime({
    ...deps,
    factories: {
      createAppController,
      createAppControllerDeps,
      createInputFlowDeps,
      createInputFlowManager,
      createSessionSnapshotManager,
      createSessionSnapshotDeps,
      createSessionRuntimeBridge,
      createSessionUiStateBridge,
      createInputControls,
      createInputControlsDeps,
      createStructuralEditActions
    }
  });
}
