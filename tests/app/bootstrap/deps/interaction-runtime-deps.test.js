import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { DRAW_ELEM_PROTONS, createInteractionRuntimeDeps } from '../../../../src/app/bootstrap/deps/interaction-runtime-deps.js';

describe('interaction-runtime dependency builder', () => {
  it('exposes the draw element proton map and preserves lazy runtime delegates', () => {
    let autoFitEnabled = false;
    const deps = createInteractionRuntimeDeps({
      appState: { id: 'app-state' },
      takeSnapshot() {},
      captureAppSnapshot() {},
      discardLastSnapshot() {},
      renderRuntime: { id: 'render-runtime' },
      hasReactionPreview: () => false,
      reapplyActiveReactionPreview() {},
      resetActiveResonanceView() {},
      alignReaction2dProductOrientation() {},
      spreadReaction2dProductComponents() {},
      centerReaction2dPairCoords() {},
      viewportFitPadding() {},
      refineExistingCoords() {},
      atomBBox() {},
      flipDisplayStereo() {},
      clearPrimitiveHover() {},
      restorePersistentHighlight() {},
      getFitCurrent2dView() {
        return 'fit-current';
      },
      getZoomTransform() {
        return { k: 1 };
      },
      setZoomTransform() {},
      makeZoomIdentity: (x, y, k) => ({ x, y, k }),
      syncStereoMap2d() {},
      flipStereoMap2d() {},
      setPreserveSelectionOnNextRender() {},
      scale: 60,
      patchForceNodePositions() {},
      forceFitTransform() {},
      forceFitPad: 12,
      forceInitialZoomMultiplier: 1.1,
      zoomTransformsDiffer() {},
      parseSMILES() {},
      parseINCHI() {},
      simulation: {},
      plotEl: {},
      clean2dButton: {},
      cleanForceButton: {},
      updateModeChrome() {},
      getDraw2D() {
        return 'draw2d';
      },
      applyForceSelection() {},
      panButton: {},
      selectButton: {},
      drawBondButton: {},
      eraseButton: {},
      getElementButton() {
        return {};
      },
      performStructuralEdit() {},
      prepareReactionPreviewEraseTargets() {},
      reactionPreviewBlock: {},
      normalizeResonanceForEdit: {},
      takeSnapshotPolicy: {},
      viewportNonePolicy: {},
      clearStereoAnnotations() {},
      kekulize() {},
      refreshAromaticity() {},
      patchNodePositions() {},
      reseatHydrogensAroundPatched() {},
      refreshSelectionOverlay() {},
      flashEraseButton() {},
      createDrag() {},
      getDrawBondMode: () => false,
      getEraseMode: () => false,
      captureSnapshot() {},
      getSelectedDragAtomIds() {
        return new Set([1]);
      },
      getCurrentMolecule: () => 'mol',
      setAutoFitEnabled(value) {
        autoFitEnabled = value;
      },
      disableKeepInView() {},
      refresh2dSelection() {},
      hideTooltip() {},
      setElementCursor() {},
      g: {},
      getMode: () => '2d',
      getDrawBondElement: () => 'C',
      getDrawElemProtons: () => DRAW_ELEM_PROTONS,
      isReactionPreviewEditableAtomId: () => false,
      getDrawBondState: () => null,
      setDrawBondState() {},
      clearHoveredAtomIds() {},
      clearHoveredBondIds() {},
      addHoveredAtomId() {},
      redraw2dSelection() {},
      getPlotSize: () => ({ width: 1, height: 1 }),
      getForceNodeById: () => null,
      getForceNodes: () => [],
      get2DAtomById: () => null,
      get2DAtoms: () => [],
      get2DCenterX: () => 0,
      get2DCenterY: () => 0,
      forceBondLength: 25,
      strokeWidth: 2,
      fontSize: 16,
      atomRadius() {},
      atomColor() {},
      strokeColor() {},
      singleBondWidth() {},
      labelHalfW() {},
      setDrawBondHoverSuppressed() {},
      captureZoomTransform() {},
      restore2dEditViewport() {},
      forceScale: 25,
      restoreSnapshot() {},
      prepareReactionPreviewEditTargets() {},
      prepareResonanceStructuralEdit() {},
      getActiveMolecule: () => 'active-mol',
      ensureActiveMolecule: () => 'ensured-mol',
      enableKeepInView() {},
      sync2DDerivedState() {},
      syncInputField() {},
      updateFormula() {},
      updateDescriptors() {},
      updatePanels() {},
      draw2d() {},
      updateForce() {},
      clearSelection() {},
      changeAtomElements() {},
      promoteBondOrder() {},
      isAdditiveSelectionEvent: () => false,
      hasVisibleStereoBond: () => false,
      replaceForceHydrogenAtom() {},
      showPrimitiveHover() {},
      isDrawBondHoverSuppressed: () => false,
      isPrimitiveHoverSuppressed: () => false,
      setPrimitiveHoverSuppressed() {},
      showDelayedTooltip() {},
      showImmediateTooltip() {},
      moveTooltip() {},
      getSelectionValenceTooltipAtomId: () => null,
      setSelectionValenceTooltipAtomId() {},
      getRenderOptions() {
        return {};
      },
      atomTooltipHtml() {},
      bondTooltipHtml() {},
      pointer() {},
      getGNode() {
        return {};
      }
    });

    assert.equal(DRAW_ELEM_PROTONS.C, 6);
    assert.equal(deps.getDrawElemProtons().Cl, 17);
    assert.equal(deps.getDraw2D(), 'draw2d');
    assert.equal(deps.getFitCurrent2dView(), 'fit-current');
    deps.setAutoFitEnabled(true);
    assert.equal(autoFitEnabled, true);
    assert.deepEqual(deps.getSelectedDragAtomIds('mol'), new Set([1]));
    assert.equal(deps.getActiveMolecule(), 'active-mol');
    assert.equal(deps.ensureActiveMolecule(), 'ensured-mol');
  });
});
