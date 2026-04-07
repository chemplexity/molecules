import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { initializeRuntimeBridges } from '../../../src/app/bootstrap/runtime-bridges.js';

describe('runtime bridge bootstrap', () => {
  it('wires runtime ui, app state, and render runtime together', () => {
    const runtimeState = {
      mode: '2d',
      currentMol: null,
      currentSmiles: null,
      currentInchi: null,
      rotationDeg: 15,
      flipH: true,
      flipV: false,
      cx2d: 0,
      cy2d: 0,
      stereoMap2d: null,
      selectedAtomIds: new Set([1]),
      selectedBondIds: new Set([2]),
      hoveredAtomIds: new Set([3]),
      hoveredBondIds: new Set([4]),
      selectionModifierActive: false,
      selectMode: false,
      drawBondMode: false,
      eraseMode: false,
      erasePainting: false,
      drawBondElement: 'C',
      drawBondType: 'single',
      preserveSelectionOnNextRender: false,
      sessionRuntimeBridge: {
        syncInputField(mol) {
          return `synced:${mol}`;
        }
      },
      sessionUiState: {
        serializeSnapshotMol(mol) {
          return { mol };
        },
        updateAnalysisPanels(mol, options = {}) {
          return { mol, options };
        },
        restorePanelState(panelState) {
          return panelState;
        },
        restoreInteractionState(snap) {
          return snap;
        }
      },
      sessionSnapshotManager: {
        capture(options) {
          return { options };
        },
        restore(snap) {
          return snap;
        }
      }
    };

    let highlightCleared = false;
    let historyCleared = false;
    let simulationStopped = false;
    let drew = false;
    let rendered = false;

    const bridges = initializeRuntimeBridges({
      runtimeState,
      domElements: {
        getToggleButtonElement: () => ({ textContent: '' }),
        getRotateControlsElement: () => ({ style: {} }),
        getCleanControlsElement: () => ({ style: {} }),
        getClean2dButtonElement: () => ({ style: {} }),
        getCleanForceButtonElement: () => ({ style: {} }),
        getDrawToolsElement: () => ({ style: {} }),
        getForceControlsElement: () => ({ style: {} })
      },
      render2DHelpers: {
        sync2dDerivedState(mol) {
          return `derived:${mol}`;
        }
      },
      captureZoomTransformSnapshot: () => ({ k: 2 }),
      restoreZoomTransformSnapshot() {},
      restore2dEditViewport() {},
      pickStereoWedgesPreserving2dChoice: () => new Map(),
      clearPrimitiveHover() {},
      setPrimitiveHover() {},
      setDrawBondHoverSuppressed() {},
      setPrimitiveHoverSuppressed() {},
      restorePersistentHighlight() {},
      fitCurrent2dView() {},
      enableForceKeepInView() {},
      getZoomTransform: () => ({ k: 1 }),
      setZoomTransform() {},
      makeZoomIdentity: (x, y, k) => ({ x, y, k }),
      scale: 60,
      clearUndoHistory() {
        historyCleared = true;
      },
      clearHighlightState() {
        highlightCleared = true;
      },
      kekulize() {},
      stopSimulation() {
        simulationStopped = true;
      },
      getDraw2D: () => () => {
        drew = true;
      },
      getRender2D: () => () => {
        rendered = true;
      },
      forceSceneRenderer: {
        updateForce() {}
      },
      updateFormula() {},
      updateDescriptors() {},
      updateAnalysisPanels(mol, options = {}) {
        return { mol, options };
      }
    });

    assert.equal(bridges.syncInputField('mol'), 'synced:mol');
    assert.deepEqual(bridges.serializeSnapshotMol('mol'), { mol: 'mol' });
    assert.deepEqual(bridges.captureAppSnapshot({ clearReactionPreview: false }), {
      options: { clearReactionPreview: false }
    });

    bridges.appState.documentState.setActiveMolecule('next');
    assert.equal(runtimeState.mol2d, 'next');

    bridges.renderRuntime.draw2d();
    bridges.renderRuntime.renderMol('mol');

    assert.equal(drew, true);
    assert.equal(rendered, true);

    bridges.renderRuntime.renderMol('mol');
    assert.equal(runtimeState.rotationDeg, 0);
    assert.equal(runtimeState.flipH, false);
    assert.equal(runtimeState.flipV, false);

    assert.equal(historyCleared, true);
    assert.equal(highlightCleared, true);
    assert.equal(simulationStopped, true);
  });
});
