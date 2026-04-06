import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createRuntimeUi } from '../../../src/app/ui/runtime-ui.js';

function makeDisplayElement() {
  return { style: { display: '' }, textContent: '' };
}

describe('createRuntimeUi', () => {
  it('delegates session/runtime helpers and updates mode chrome', () => {
    const records = [];
    const toggleBtn = makeDisplayElement();
    const rotateCtrls = makeDisplayElement();
    const cleanCtrls = makeDisplayElement();
    const clean2dBtn = makeDisplayElement();
    const cleanForceBtn = makeDisplayElement();
    const drawTools = makeDisplayElement();
    const forceCtrls = makeDisplayElement();

    const runtimeUi = createRuntimeUi({
      sessionRuntimeBridge: {
        syncInputField: mol => ['syncInputField', mol]
      },
      render2DHelpers: {
        sync2dDerivedState: mol => ['sync2dDerivedState', mol]
      },
      getSessionUiState: () => ({
        serializeSnapshotMol: mol => ['serializeSnapshotMol', mol],
        updateAnalysisPanels: (mol, options = {}) => ['updateAnalysisPanels', mol, options],
        restorePanelState: panelState => ['restorePanelState', panelState],
        restoreInteractionState: snap => ['restoreInteractionState', snap]
      }),
      getSessionSnapshotManager: () => ({
        capture: options => ['capture', options],
        restore: snap => ['restore', snap]
      }),
      dom: {
        getToggleButtonElement: () => toggleBtn,
        getRotateControlsElement: () => rotateCtrls,
        getCleanControlsElement: () => cleanCtrls,
        getClean2dButtonElement: () => clean2dBtn,
        getCleanForceButtonElement: () => cleanForceBtn,
        getDrawToolsElement: () => drawTools,
        getForceControlsElement: () => forceCtrls
      }
    });

    assert.deepEqual(runtimeUi.syncInputField('mol'), ['syncInputField', 'mol']);
    assert.deepEqual(runtimeUi.sync2dDerivedState('mol2d'), ['sync2dDerivedState', 'mol2d']);
    assert.deepEqual(runtimeUi.serializeSnapshotMol('mol3'), ['serializeSnapshotMol', 'mol3']);
    assert.deepEqual(runtimeUi.captureAppSnapshot({ foo: 'bar' }), ['capture', { foo: 'bar' }]);
    assert.deepEqual(runtimeUi.updateAnalysisPanels('mol4', { recomputeResonance: false }), ['updateAnalysisPanels', 'mol4', { recomputeResonance: false }]);
    assert.deepEqual(runtimeUi.restorePanelState('panel'), ['restorePanelState', 'panel']);
    assert.deepEqual(runtimeUi.restoreInteractionState('snap'), ['restoreInteractionState', 'snap']);
    assert.deepEqual(runtimeUi.restoreSnapshot('snap2'), ['restore', 'snap2']);

    runtimeUi.updateModeChrome('force');
    records.push([
      toggleBtn.textContent,
      rotateCtrls.style.display,
      cleanCtrls.style.display,
      clean2dBtn.style.display,
      cleanForceBtn.style.display,
      drawTools.style.display,
      forceCtrls.style.display
    ]);

    runtimeUi.updateModeChrome('2d');
    records.push([
      toggleBtn.textContent,
      rotateCtrls.style.display,
      cleanCtrls.style.display,
      clean2dBtn.style.display,
      cleanForceBtn.style.display,
      drawTools.style.display,
      forceCtrls.style.display
    ]);

    assert.deepEqual(records, [
      ['⬡ 2D Structure', 'none', 'flex', 'none', 'flex', 'flex', 'flex'],
      ['⚡ Force Layout', 'flex', 'flex', 'flex', 'none', 'flex', 'none']
    ]);
  });

  it('resolves the session runtime bridge lazily', () => {
    let sessionRuntimeBridge = null;
    const runtimeUi = createRuntimeUi({
      getSessionRuntimeBridge: () => sessionRuntimeBridge,
      render2DHelpers: {
        sync2dDerivedState: mol => mol
      },
      getSessionUiState: () => ({
        serializeSnapshotMol: mol => mol,
        updateAnalysisPanels: mol => mol,
        restorePanelState: panelState => panelState,
        restoreInteractionState: snap => snap
      }),
      getSessionSnapshotManager: () => ({
        capture: options => options,
        restore: snap => snap
      }),
      dom: {
        getToggleButtonElement: () => makeDisplayElement(),
        getRotateControlsElement: () => makeDisplayElement(),
        getCleanControlsElement: () => makeDisplayElement(),
        getClean2dButtonElement: () => makeDisplayElement(),
        getCleanForceButtonElement: () => makeDisplayElement(),
        getDrawToolsElement: () => makeDisplayElement(),
        getForceControlsElement: () => makeDisplayElement()
      }
    });

    sessionRuntimeBridge = {
      syncInputField: mol => ['lazySyncInputField', mol]
    };

    assert.deepEqual(runtimeUi.syncInputField('mol'), ['lazySyncInputField', 'mol']);
  });
});
