import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { initializeInteractionRuntime } from '../../../src/app/bootstrap/interaction-runtime.js';

describe('interaction runtime bootstrap', () => {
  it('creates actions in order and keeps lazy cross-references intact', () => {
    const created = [];
    const depBuilders = {
      createNavigationActionDeps: ctx => ctx,
      createSelectionActionDeps: ctx => ctx,
      createEditingActionDeps: ctx => ctx,
      createDragGestureActionDeps: ctx => ctx,
      createDrawBondPreviewActionDeps: ctx => ctx,
      createDrawBondCommitActionDeps: ctx => ctx,
      createPrimitiveSelectionActionDeps: ctx => ctx,
      createPrimitiveEventHandlerDeps: ctx => ctx
    };
    const factories = {
      createNavigationActions: deps => {
        created.push('navigation');
        return { kind: 'navigation', deps };
      },
      createSelectionActions: deps => {
        created.push('selection');
        return { kind: 'selection', deps };
      },
      createEditingActions: deps => {
        created.push('editing');
        return { kind: 'editing', deps, deleteSelection() {}, eraseItem() {} };
      },
      createDragGestureActions: deps => {
        created.push('drag');
        return { kind: 'drag', deps };
      },
      createDrawBondPreviewActions: deps => {
        created.push('preview');
        return {
          kind: 'preview',
          deps,
          cancel() {
            return 'cancelled';
          },
          clearArtifacts() {
            return 'cleared';
          },
          resetHover() {
            return 'reset';
          },
          start() {
            return 'started';
          }
        };
      },
      createDrawBondCommitActions: deps => {
        created.push('commit');
        return { kind: 'commit', deps };
      },
      createPrimitiveSelectionActions: deps => {
        created.push('primitive-selection');
        return { kind: 'primitive-selection', deps };
      },
      createPrimitiveEventHandlers: deps => {
        created.push('primitive-events');
        return { kind: 'primitive-events', deps };
      }
    };

    const runtime = initializeInteractionRuntime(
      {
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
          return function fitCurrent2dView() {};
        },
        getZoomTransform() {},
        setZoomTransform() {},
        makeZoomIdentity() {},
        syncStereoMap2d() {},
        flipStereoMap2d() {},
        setPreserveSelectionOnNextRender() {},
        scale: 60,
        patchForceNodePositions() {},
        forceFitTransform() {},
        forceFitPad: 12,
        forceInitialZoomMultiplier: 1.2,
        zoomTransformsDiffer() {},
        parseSMILES() {},
        parseINCHI() {},
        simulation: { id: 'sim' },
        plotEl: { id: 'plot' },
        clean2dButton: { id: 'clean2d' },
        cleanForceButton: { id: 'cleanForce' },
        updateModeChrome() {},
        getDraw2D() {
          return function draw2d() {};
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
          return new Set();
        },
        getCurrentMolecule() {
          return null;
        },
        setAutoFitEnabled() {},
        disableKeepInView() {},
        refresh2dSelection() {},
        hideTooltip() {},
        setElementCursor() {},
        g: { id: 'g' },
        getMode: () => '2d',
        getDrawBondElement: () => 'C',
        getDrawElemProtons: () => ({ C: 6 }),
        isReactionPreviewEditableAtomId: () => false,
        getDrawBondState: () => null,
        setDrawBondState() {},
        clearHoveredAtomIds() {},
        clearHoveredBondIds() {},
        addHoveredAtomId() {},
        redraw2dSelection() {},
        getPlotSize: () => ({ width: 1, height: 1 }),
        getForceNodeById() {
          return null;
        },
        getForceNodes() {
          return [];
        },
        get2DAtomById() {
          return null;
        },
        get2DAtoms() {
          return [];
        },
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
        getActiveMolecule() {
          return null;
        },
        ensureActiveMolecule() {},
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
      },
      { factories, depBuilders }
    );

    assert.deepEqual(created, [
      'navigation',
      'selection',
      'editing',
      'drag',
      'preview',
      'commit',
      'primitive-selection',
      'primitive-events'
    ]);
    assert.equal(runtime.selectionActions.deps.getEditingActions().kind, 'editing');
    assert.equal(runtime.selectionActions.deps.getDrawBondPreviewActions().kind, 'preview');
    assert.equal(runtime.drawBondCommitActions.deps.cancelPreview(), 'cancelled');
    assert.equal(runtime.primitiveEventHandlers.deps.resetDrawBondHover(), 'reset');
    assert.equal(runtime.primitiveEventHandlers.deps.eraseItem([], []), undefined);
    assert.equal(runtime.navigationActions.kind, 'navigation');
  });
});
