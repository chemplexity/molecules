import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createDragGestureActionDeps,
  createDrawBondCommitActionDeps,
  createDrawBondPreviewActionDeps,
  createEditingActionDeps,
  createNavigationActionDeps,
  createPrimitiveEventHandlerDeps,
  createPrimitiveSelectionActionDeps,
  createSelectionActionDeps
} from '../../../../src/app/interactions/deps/action-deps.js';

describe('interaction action deps builders', () => {
  it('builds navigation deps with lazy view accessors', () => {
    let fitCalls = 0;
    const deps = createNavigationActionDeps({
      appState: {},
      takeSnapshot: () => {},
      captureAppSnapshot: () => {},
      discardLastSnapshot: () => {},
      renderRuntime: {},
      hasReactionPreview: () => false,
      reapplyActiveReactionPreview: () => {},
      resetActiveResonanceView: () => {},
      alignReaction2dProductOrientation: () => {},
      spreadReaction2dProductComponents: () => {},
      centerReaction2dPairCoords: () => {},
      viewportFitPadding: () => 24,
      refineExistingCoords: () => {},
      atomBBox: () => ({ width: 1, height: 1 }),
      flipDisplayStereo: mol => mol,
      clearPrimitiveHover: () => {},
      restorePersistentHighlight: () => {},
      getFitCurrent2dView: () => () => {
        fitCalls += 1;
      },
      getZoomTransform: () => ({ x: 1 }),
      setZoomTransform: () => {},
      makeZoomIdentity: (x, y, k) => ({ x, y, k }),
      syncStereoMap2d: () => {},
      flipStereoMap2d: () => {},
      setPreserveSelectionOnNextRender: () => {},
      scale: 40,
      patchForceNodePositions: () => {},
      forceFitTransform: () => ({}),
      forceFitPad: 10,
      forceInitialZoomMultiplier: 1.1,
      zoomTransformsDiffer: () => false,
      parseSMILES: () => {},
      parseINCHI: () => {},
      simulation: {},
      plotEl: {},
      clean2dButton: {},
      cleanForceButton: {},
      updateModeChrome: () => {}
    });

    deps.view.fitCurrent2dView();

    assert.equal(fitCalls, 1);
    assert.equal(deps.force.fitPad, 10);
    assert.equal(deps.view.scale, 40);
  });

  it('builds selection and primitive selection deps with lazy draw2d access', () => {
    let drawCalls = 0;
    let cancelCalls = 0;
    let deleteCalls = 0;
    const selectionDeps = createSelectionActionDeps({
      document: { id: 'doc' },
      appState: {},
      getDraw2D: () => () => {
        drawCalls += 1;
      },
      applyForceSelection: () => {},
      clearPrimitiveHover: () => {},
      getDrawBondPreviewActions: () => ({
        cancel: () => {
          cancelCalls += 1;
        }
      }),
      getEditingActions: () => ({
        deleteSelection: () => {
          deleteCalls += 1;
        }
      }),
      panButton: {},
      selectButton: {},
      drawBondButton: {},
      eraseButton: {},
      getElementButton: element => ({ element })
    });
    const primitiveSelectionDeps = createPrimitiveSelectionActionDeps({
      appState: {},
      getDraw2D: () => () => {
        drawCalls += 1;
      },
      applyForceSelection: () => {},
      clearPrimitiveHover: () => {},
      isAdditiveSelectionEvent: event => event.shiftKey,
      hasVisibleStereoBond: bondId => bondId === 7
    });

    selectionDeps.renderers.draw2d();
    selectionDeps.drawBond.cancelDrawBond();
    selectionDeps.actions.deleteSelection();
    primitiveSelectionDeps.renderers.draw2d();

    assert.equal(drawCalls, 2);
    assert.equal(cancelCalls, 1);
    assert.equal(deleteCalls, 1);
    assert.deepEqual(selectionDeps.document, { id: 'doc' });
    assert.equal(primitiveSelectionDeps.helpers.isAdditiveSelectionEvent({ shiftKey: true }), true);
    assert.equal(primitiveSelectionDeps.helpers.hasVisibleStereoBond(7), true);
  });

  it('builds editing, drag, and draw-bond deps without changing behavior', () => {
    const records = [];
    const editingDeps = createEditingActionDeps({
      appState: {},
      performStructuralEdit: (...args) => records.push(['edit', ...args]),
      hasReactionPreview: () => true,
      prepareReactionPreviewEraseTargets: (...args) => records.push(['eraseTargets', ...args]),
      reactionPreviewBlock: Symbol('block'),
      normalizeResonanceForEdit: Symbol('normalize'),
      takeSnapshotPolicy: Symbol('snap'),
      viewportNonePolicy: Symbol('none'),
      clearStereoAnnotations: (...args) => records.push(['clearStereo', ...args]),
      kekulize: mol => mol,
      refreshAromaticity: mol => mol,
      simulation: { id: 'sim' },
      patchNodePositions: patch => records.push(['patch', patch]),
      reseatHydrogensAroundPatched: patch => records.push(['reseat', patch]),
      getFitCurrent2dView: () => () => records.push(['fit2d']),
      refreshSelectionOverlay: () => records.push(['refresh']),
      flashEraseButton: () => records.push(['flash'])
    });
    const dragDeps = createDragGestureActionDeps({
      createDrag: () => ({ type: 'drag' }),
      getDrawBondMode: () => true,
      getEraseMode: () => false,
      captureSnapshot: () => records.push(['capture']),
      takeSnapshot: options => records.push(['take', options]),
      getSelectedDragAtomIds: () => [1, 2],
      getCurrentMolecule: () => ({ id: 'mol' }),
      setAutoFitEnabled: value => records.push(['autofit', value]),
      disableKeepInView: () => records.push(['disableKeep']),
      clearPrimitiveHover: () => records.push(['clearHover']),
      refresh2dSelection: () => records.push(['refresh2d']),
      hideTooltip: () => records.push(['hideTooltip']),
      setElementCursor: (element, value) => records.push(['cursor', element, value])
    });
    const previewDeps = createDrawBondPreviewActionDeps({
      g: { id: 'g' },
      getMode: () => '2d',
      getDrawBondElement: () => 'C',
      getDrawElemProtons: () => 0,
      isReactionPreviewEditableAtomId: () => true,
      getDrawBondState: () => null,
      setDrawBondState: value => records.push(['setState', value]),
      clearHoveredAtomIds: () => records.push(['clearAtoms']),
      clearHoveredBondIds: () => records.push(['clearBonds']),
      addHoveredAtomId: atomId => records.push(['hoverAtom', atomId]),
      clearPrimitiveHover: () => records.push(['clearPrimitive']),
      applyForceSelection: () => records.push(['applyForceSelection']),
      redraw2dSelection: () => records.push(['redraw2d']),
      getPlotSize: () => ({ width: 10, height: 20 }),
      getForceNodeById: atomId => ({ id: atomId }),
      getForceNodes: () => [],
      get2DAtomById: atomId => ({ id: atomId }),
      get2DAtoms: () => [],
      get2DCenterX: () => 5,
      get2DCenterY: () => 6,
      scale: 40,
      forceBondLength: 30,
      strokeWidth: 2,
      fontSize: 12,
      atomRadius: () => 4,
      atomColor: () => '#000',
      strokeColor: () => '#111',
      singleBondWidth: () => 1,
      labelHalfW: () => 3
    });
    const commitDeps = createDrawBondCommitActionDeps({
      getMode: () => 'force',
      getDrawBondElement: () => 'C',
      clearPreviewArtifacts: () => records.push(['clearPreview']),
      cancelPreview: () => records.push(['cancelPreview']),
      getDrawBondState: () => ({ atomId: 1 }),
      setDrawBondState: value => records.push(['setCommitState', value]),
      clearPrimitiveHover: () => records.push(['clearPrimitiveHover']),
      setDrawBondHoverSuppressed: value => records.push(['suppressHover', value]),
      captureZoomTransform: () => ({ k: 1 }),
      restore2dEditViewport: (snapshot, options) => records.push(['restoreViewport', snapshot, options]),
      getPlotSize: () => ({ width: 100, height: 80 }),
      scale: 40,
      forceScale: 25,
      captureSnapshot: options => ({ options }),
      restoreSnapshot: snap => records.push(['restoreSnapshot', snap]),
      takeSnapshot: options => records.push(['takeSnapshot', options]),
      prepareReactionPreviewEditTargets: payload => records.push(['reactionTargets', payload]),
      prepareResonanceStructuralEdit: mol => records.push(['resonanceEdit', mol]),
      getActiveMolecule: () => ({ id: 'active' }),
      ensureActiveMolecule: () => ({ id: 'ensured' }),
      getForceNodeById: atomId => ({ id: atomId }),
      getForceNodes: () => [],
      patchNodePositions: patch => records.push(['patchNodes', patch]),
      reseatHydrogensAroundPatched: patch => records.push(['reseatHydrogens', patch]),
      enableKeepInView: () => records.push(['enableKeep']),
      get2DCenterX: () => 11,
      get2DCenterY: () => 22,
      sync2DDerivedState: mol => records.push(['sync2d', mol]),
      kekulize: mol => mol,
      refreshAromaticity: mol => mol,
      syncInputField: mol => records.push(['syncInput', mol]),
      updateFormula: mol => records.push(['formula', mol]),
      updateDescriptors: mol => records.push(['descriptors', mol]),
      updatePanels: mol => records.push(['panels', mol]),
      draw2d: () => records.push(['draw2d']),
      updateForce: () => records.push(['updateForce']),
      clearSelection: () => records.push(['clearSelection']),
      changeAtomElements: (...args) => records.push(['changeAtomElements', ...args]),
      promoteBondOrder: (...args) => records.push(['promoteBondOrder', ...args])
    });

    editingDeps.actions.performStructuralEdit('a', 'b');
    dragDeps.view.setElementCursor('node', 'move');
    previewDeps.state.addHoveredAtomId(9);
    commitDeps.actions.changeAtomElements([1], 'N');

    assert.deepEqual(records.slice(0, 4), [
      ['edit', 'a', 'b'],
      ['cursor', 'node', 'move'],
      ['hoverAtom', 9],
      ['changeAtomElements', [1], 'N', {}]
    ]);
    assert.equal(editingDeps.force.getSimulation().id, 'sim');
    assert.equal(dragDeps.selection.getSelectedDragAtomIds().length, 2);
    assert.equal(previewDeps.constants.forceBondLength, 30);
    assert.equal(commitDeps.constants.forceScale, 25);
  });

  it('builds primitive event handler deps and forwards tooltip callbacks', () => {
    const records = [];
    const deps = createPrimitiveEventHandlerDeps({
      appState: {},
      primitiveSelectionActions: { id: 'selection' },
      isReactionPreviewEditableAtomId: id => id === 1,
      getDrawBondState: () => ({ atomId: 2 }),
      startDrawBond: (atomId, x, y) => records.push(['start', atomId, x, y]),
      resetDrawBondHover: () => records.push(['reset']),
      getDrawBondElement: () => 'O',
      promoteBondOrder: bondId => records.push(['promote', bondId]),
      eraseItem: (atomIds, bondIds) => records.push(['erase', atomIds, bondIds]),
      replaceForceHydrogenAtom: (atomId, mol) => records.push(['replaceH', atomId, mol]),
      showPrimitiveHover: (atomIds, bondIds) => records.push(['showHover', atomIds, bondIds]),
      clearPrimitiveHover: () => records.push(['clearHover']),
      refreshSelectionOverlay: () => records.push(['refreshSelection']),
      isDrawBondHoverSuppressed: () => false,
      isPrimitiveHoverSuppressed: () => true,
      setPrimitiveHoverSuppressed: value => records.push(['setHoverSuppressed', value]),
      showDelayedTooltip: (html, event, delay) => records.push(['delayTooltip', html, event, delay]),
      showImmediateTooltip: (html, event) => records.push(['immediateTooltip', html, event]),
      moveTooltip: event => records.push(['moveTooltip', event]),
      hideTooltip: () => records.push(['hideTooltip']),
      getSelectionValenceTooltipAtomId: () => 12,
      setSelectionValenceTooltipAtomId: value => records.push(['setTooltipAtom', value]),
      getRenderOptions: () => ({ mode: '2d' }),
      atomTooltipHtml: atom => `atom:${atom.id}`,
      bondTooltipHtml: bond => `bond:${bond.id}`,
      pointer: (event, node) => [event.x, node.y],
      getGNode: () => ({ id: 'g' })
    });

    deps.drawBond.start(4, 5, 6);
    deps.tooltip.showImmediate('hello', { clientX: 1 });
    deps.tooltipState.setSelectionValenceTooltipAtomId(99);

    assert.equal(deps.selection.id, 'selection');
    assert.equal(deps.overlays.isReactionPreviewEditableAtomId(1), true);
    assert.equal(deps.drawBond.getElement(), 'O');
    assert.equal(deps.tooltipState.getSelectionValenceTooltipAtomId(), 12);
    assert.deepEqual(deps.pointer({ x: 7 }, { y: 8 }), [7, 8]);
    assert.deepEqual(records, [
      ['start', 4, 5, 6],
      ['immediateTooltip', 'hello', { clientX: 1 }],
      ['setTooltipAtom', 99]
    ]);
  });
});
