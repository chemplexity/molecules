import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { DRAW_ELEM_PROTONS, createInteractionRuntimeCallDeps } from '../../../../src/app/bootstrap/deps/interaction-runtime-call-deps.js';

describe('interaction-runtime call dependency builder', () => {
  it('builds the interaction bootstrap context with live wrappers', () => {
    let autoFitEnabled = false;
    let primitiveHoverCleared = false;
    let delayedTooltipArgs = null;

    const deps = createInteractionRuntimeCallDeps({
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
      viewportFitPadding: 42,
      refineExistingCoords() {},
      atomBBox() {},
      flipDisplayStereo() {},
      clearPrimitiveHover() {
        primitiveHoverCleared = true;
      },
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
      showDelayedTooltip(html, event, delay) {
        delayedTooltipArgs = { html, event, delay };
      },
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

    deps.clearPrimitiveHover();
    deps.setAutoFitEnabled(true);
    deps.showDelayedTooltip('tip', { x: 1 }, 150);

    assert.equal(DRAW_ELEM_PROTONS.C, 6);
    assert.equal(deps.getDrawElemProtons().Cl, 17);
    assert.equal(deps.getDraw2D(), 'draw2d');
    assert.equal(deps.getFitCurrent2dView(), 'fit-current');
    assert.equal(primitiveHoverCleared, true);
    assert.equal(autoFitEnabled, true);
    assert.deepEqual(delayedTooltipArgs, { html: 'tip', event: { x: 1 }, delay: 150 });
    assert.equal(deps.viewportFitPadding, 42);
    assert.equal(deps.getActiveMolecule(), 'active-mol');
    assert.equal(deps.ensureActiveMolecule(), 'ensured-mol');
  });
});
