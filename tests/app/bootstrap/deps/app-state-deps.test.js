import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createAppStateBridgeDeps } from '../../../../src/app/bootstrap/deps/app-state-deps.js';

describe('app-state dependency builder', () => {
  it('routes active molecule writes through the current mode', () => {
    const runtimeState = {
      mode: 'force',
      currentMol: null,
      mol2d: null,
      currentSmiles: 'CCO',
      currentInchi: null,
      rotationDeg: 0,
      flipH: false,
      flipV: false,
      cx2d: 0,
      cy2d: 0,
      stereoMap2d: null
    };
    let primitiveHoverSuppressed = false;
    let drawBondHoverSuppressed = false;

    const deps = createAppStateBridgeDeps({
      runtimeState,
      captureZoomTransformSnapshot: () => ({ k: 1 }),
      restore2dEditViewport() {},
      render2DHelpers: { sync2dDerivedState() {} },
      pickStereoWedgesPreserving2dChoice: () => new Map([['a', 'wedge']]),
      clearPrimitiveHover() {},
      setPrimitiveHover() {},
      setDrawBondHoverSuppressed: value => {
        drawBondHoverSuppressed = value;
      },
      setPrimitiveHoverSuppressed: value => {
        primitiveHoverSuppressed = value;
      },
      restorePersistentHighlight() {},
      fitCurrent2dView() {},
      enableForceKeepInView() {},
      getZoomTransform: () => ({ k: 1 }),
      setZoomTransform() {},
      makeZoomIdentity: (x, y, k) => ({ x, y, k }),
      setPreserveSelectionOnNextRender() {},
      scale: 60,
      getSelectedAtomIds: () => new Set([1]),
      getSelectedBondIds: () => new Set([2]),
      getHoveredAtomIds: () => new Set([3]),
      getHoveredBondIds: () => new Set([4]),
      getSelectionModifierActive: () => false,
      setSelectionModifierActive() {},
      getSelectMode: () => true,
      setSelectMode() {},
      getDrawBondMode: () => false,
      setDrawBondMode() {},
      getEraseMode: () => false,
      setEraseMode() {},
      getErasePainting: () => false,
      getDrawBondElement: () => 'C',
      setDrawBondElement() {},
      setErasePainting() {}
    });

    deps.documentState.setActiveMolecule('force-mol');
    assert.equal(runtimeState.currentMol, 'force-mol');
    runtimeState.mode = '2d';
    deps.documentState.setActiveMolecule('2d-mol');
    assert.equal(runtimeState.mol2d, '2d-mol');

    deps.viewState.setPrimitiveHoverSuppressed(true);
    deps.viewState.setDrawBondHoverSuppressed(true);
    assert.equal(primitiveHoverSuppressed, true);
    assert.equal(drawBondHoverSuppressed, true);
  });
});
