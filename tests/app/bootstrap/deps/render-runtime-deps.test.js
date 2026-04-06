import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createRenderRuntimeDeps } from '../../../../src/app/bootstrap/deps/render-runtime-deps.js';

describe('render-runtime dependency builder', () => {
  it('resets orientation and delegates scene rendering lazily', () => {
    const runtimeState = {
      mode: '2d',
      currentMol: null,
      rotationDeg: 15,
      flipH: true,
      flipV: true
    };
    let drew = false;
    let rendered = false;

    const deps = createRenderRuntimeDeps({
      runtimeState,
      captureZoomTransform: () => ({ k: 1 }),
      restoreZoomTransform() {},
      clearUndoHistory() {},
      clearHighlightState() {},
      kekulize() {},
      stopSimulation() {},
      getDraw2D: () => () => {
        drew = true;
      },
      getRender2D: () => () => {
        rendered = true;
      },
      forceSceneRenderer: { updateForce() {} },
      updateFormula() {},
      updateDescriptors() {},
      updateAnalysisPanels() {}
    });

    deps.view.resetOrientation();
    deps.scene.draw2d();
    deps.scene.render2d();

    assert.equal(runtimeState.rotationDeg, 0);
    assert.equal(runtimeState.flipH, false);
    assert.equal(runtimeState.flipV, false);
    assert.equal(drew, true);
    assert.equal(rendered, true);
  });
});
