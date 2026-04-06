import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createFinalizeAppBootstrapDeps } from '../../../../src/app/bootstrap/deps/finalize-bootstrap-deps.js';

describe('finalize-bootstrap dependency builder', () => {
  it('builds finalize deps with delegated runtime hooks', () => {
    const runtimeState = {
      mode: '2d',
      currentMol: null,
      mol2d: null,
      stereoMap2d: new Map(),
      currentSmiles: 'CCO',
      currentInchi: null,
      fontSize: 18,
      selectionValenceTooltipAtomId: null,
      activeValenceWarningMap: new Map(),
      structuralEditActions: {}
    };
    let drawBondHoverSuppressed = false;
    let tookSnapshot = false;

    const deps = createFinalizeAppBootstrapDeps({
      createAppDelegates() {},
      createUndoDeps() {},
      createReaction2dDeps() {},
      createResonancePanelDeps() {},
      createBondEnPanelDeps() {},
      createOptionsModalDeps() {},
      createPhyschemPanelDeps() {},
      createAppShellDeps() {},
      initUndo() {},
      initHighlights() {},
      initExport() {},
      initReaction2d() {},
      initResonancePanel() {},
      initBondEnPanel() {},
      initNavigationInteractions() {},
      initKeyboardInteractions() {},
      initGestureInteractions() {},
      initOptionsModal() {},
      initPlotInteractions() {},
      initTabPanels() {},
      initPhyschemPanel() {},
      initAppShell() {},
      setDelegates() {},
      appController: {},
      runtimeState,
      appState: {},
      getDrawBondState: () => ({ atomId: 1 }),
      setDrawBondHoverSuppressed: value => {
        drawBondHoverSuppressed = value;
      },
      getSelectMode: () => false,
      getDrawBondMode: () => true,
      getEraseMode: () => false,
      setCapturePhyschemHighlightSnapshot() {},
      setRestorePhyschemHighlightSnapshot() {},
      getInitialSmiles: () => 'CCO',
      primitiveSelectionActions: {},
      drawBondPreviewActions: {},
      drawBondCommitActions: {},
      editingActions: {},
      selectionActions: {},
      render2DHelpers: {},
      highlight2DRenderer: {},
      scene2DRenderer: {},
      zoomTransformHelpers: {},
      renderRuntime: {},
      applyForceHighlights() {},
      refreshSelectionOverlay() {},
      applyForceSelection() {},
      selectionOverlayManager: { redraw2dSelection() {} },
      forceSceneRenderer: { updateForce() {} },
      syncDisplayStereo() {},
      clearReactionPreviewState() {},
      restoreReactionPreviewSource() {},
      hasReactionPreview: () => false,
      isReactionPreviewEditableAtomId: () => false,
      getReactionPreviewSourceMol: () => null,
      takeSnapshot() {
        tookSnapshot = true;
      },
      undoAction() {},
      redoAction() {},
      d3: {
        zoomTransform: () => ({}),
        zoomIdentity: { translate: () => ({ scale: () => ({}) }) },
        select: element => ({ datum: () => element })
      },
      svg: {
        node: () => ({}),
        call() {}
      },
      zoom: {},
      g: {},
      plotEl: {},
      simulation: { alpha: () => ({ restart() {} }) },
      document: {},
      window: {},
      tooltip: {
        interrupt() {
          return {
            style() {
              return {
                html() {
                  return { style() {} };
                }
              };
            },
            html() {
              return { style() {} };
            }
          };
        }
      },
      domElements: {
        setInputValue() {}
      },
      clearPrimitiveHover() {},
      showPrimitiveHover() {},
      updateAnalysisPanels() {},
      prepare2dExportHighlightState() {},
      setHighlight() {},
      restorePersistentHighlight() {},
      setPersistentHighlightFallback() {},
      renderOptionLimits: {},
      getRenderOptions: () => ({}),
      getDefaultRenderOptions: () => ({}),
      updateRenderOptions() {},
      inputControls: {},
      inputFlowManager: {},
      parseSMILES() {},
      parseINCHI() {},
      copyForcePng() {},
      copyForceSvg() {},
      copySvg2d() {},
      savePng2d() {},
      atomTooltipHtml() {},
      toSMILES() {},
      toInChI() {}
    });

    assert.equal(deps.state.hasDrawBondState(), true);
    deps.state.setDrawBondHoverSuppressed(true);
    deps.history.takeSnapshot();
    assert.equal(drawBondHoverSuppressed, true);
    assert.equal(tookSnapshot, true);
  });
});
