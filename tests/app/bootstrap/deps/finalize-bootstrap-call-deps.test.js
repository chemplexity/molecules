import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createFinalizeBootstrapCallDeps } from '../../../../src/app/bootstrap/deps/finalize-bootstrap-call-deps.js';

describe('finalize-bootstrap call dependency builder', () => {
  it('builds the final bootstrap context with live callback wrappers', () => {
    let delegatedValue = null;
    let drawBondHoverSuppressed = false;
    let appliedForceHighlights = false;
    let restoredReactionPreviewSourceOptions = null;

    const deps = createFinalizeBootstrapCallDeps({
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
      setDelegates(appDelegates) {
        delegatedValue = appDelegates;
      },
      appController: { id: 'controller' },
      runtimeState: { mode: '2d' },
      appState: { id: 'app-state' },
      getDrawBondState: () => ({ atomId: 7 }),
      setDrawBondHoverSuppressed(value) {
        drawBondHoverSuppressed = value;
      },
      getSelectMode: () => false,
      getDrawBondMode: () => true,
      getEraseMode: () => false,
      setCapturePhyschemHighlightSnapshot() {},
      setRestorePhyschemHighlightSnapshot() {},
      getInitialSmiles: () => 'CCO',
      primitiveSelectionActions: { id: 'primitive-selection' },
      drawBondPreviewActions: { id: 'draw-preview' },
      drawBondCommitActions: { id: 'draw-commit' },
      editingActions: { id: 'editing' },
      selectionActions: { id: 'selection' },
      render2DHelpers: { id: 'render-2d-helpers' },
      highlight2DRenderer: { id: 'highlight-2d' },
      scene2DRenderer: { id: 'scene-2d' },
      zoomTransformHelpers: { id: 'zoom' },
      renderRuntime: { id: 'render-runtime' },
      applyForceHighlights() {
        appliedForceHighlights = true;
      },
      refreshSelectionOverlay() {},
      applyForceSelection() {},
      selectionOverlayManager: { id: 'overlay-manager' },
      forceSceneRenderer: { id: 'force-scene' },
      syncDisplayStereo() {},
      clearReactionPreviewState() {},
      restoreReactionPreviewSource(options) {
        restoredReactionPreviewSourceOptions = options;
      },
      hasReactionPreview: () => false,
      isReactionPreviewEditableAtomId: () => false,
      getReactionPreviewSourceMol: () => null,
      takeSnapshot() {},
      undoAction() {},
      redoAction() {},
      d3: {},
      svg: {},
      zoom: {},
      g: {},
      plotEl: {},
      simulation: {},
      document: {},
      window: {},
      tooltip: {},
      domElements: {},
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
      inputControls: { id: 'input-controls' },
      inputFlowManager: { id: 'input-flow' },
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

    deps.setDelegates('delegates');
    deps.setDrawBondHoverSuppressed(true);
    deps.applyForceHighlights();
    deps.restoreReactionPreviewSource({ preserveView: true });

    assert.equal(delegatedValue, 'delegates');
    assert.equal(drawBondHoverSuppressed, true);
    assert.equal(appliedForceHighlights, true);
    assert.deepEqual(restoredReactionPreviewSourceOptions, { preserveView: true });
    assert.deepEqual(deps.getDrawBondState(), { atomId: 7 });
    assert.equal(deps.getInitialSmiles(), 'CCO');
    assert.equal(deps.renderRuntime.id, 'render-runtime');
    assert.equal(deps.inputFlowManager.id, 'input-flow');
  });
});
