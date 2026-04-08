/** @module app/bootstrap/interaction-runtime */

import { createDrawBondCommitActions } from '../interactions/draw-bond-commit.js';
import { createDrawBondPreviewActions } from '../interactions/draw-bond-preview.js';
import { createEditingActions } from '../interactions/editing.js';
import { createDragGestureActions } from '../interactions/drag-gestures.js';
import { createNavigationActions } from '../interactions/navigation.js';
import { createPrimitiveEventHandlers } from '../interactions/primitive-events.js';
import { createPrimitiveSelectionActions } from '../interactions/primitives.js';
import { createSelectionActions } from '../interactions/selection.js';
import {
  createDragGestureActionDeps,
  createDrawBondCommitActionDeps,
  createDrawBondPreviewActionDeps,
  createEditingActionDeps,
  createNavigationActionDeps,
  createPrimitiveEventHandlerDeps,
  createPrimitiveSelectionActionDeps,
  createSelectionActionDeps
} from '../interactions/deps/action-deps.js';

const defaultFactories = {
  createNavigationActions,
  createSelectionActions,
  createEditingActions,
  createDragGestureActions,
  createDrawBondPreviewActions,
  createDrawBondCommitActions,
  createPrimitiveSelectionActions,
  createPrimitiveEventHandlers
};

const defaultDepBuilders = {
  createNavigationActionDeps,
  createSelectionActionDeps,
  createEditingActionDeps,
  createDragGestureActionDeps,
  createDrawBondPreviewActionDeps,
  createDrawBondCommitActionDeps,
  createPrimitiveSelectionActionDeps,
  createPrimitiveEventHandlerDeps
};

/**
 * Wires up all interaction subsystems (navigation, selection, editing, drag,
 * draw-bond preview/commit, primitive selection, and primitive event handlers)
 * using the provided app context. Factories and dep-builders can be overridden
 * via `options` for testing.
 * @param {object} ctx - App context supplying state, render runtime, and all
 *   delegate methods used by the interaction subsystems.
 * @param {object} [options] - Optional overrides.
 * @param {object} [options.factories] - Action-factory overrides (defaults to
 *   the standard `createXxxActions` imports).
 * @param {object} [options.depBuilders] - Dep-builder overrides (defaults to
 *   the standard `createXxxActionDeps` imports).
 * @returns {{ navigationActions, selectionActions, editingActions,
 *   dragGestureActions, drawBondPreviewActions, drawBondCommitActions,
 *   primitiveSelectionActions, primitiveEventHandlers }} Initialized action
 *   objects for each interaction subsystem.
 */
export function initializeInteractionRuntime(ctx, options = {}) {
  const factories = options.factories ?? defaultFactories;
  const depBuilders = options.depBuilders ?? defaultDepBuilders;

  const navigationActions = factories.createNavigationActions(
    depBuilders.createNavigationActionDeps({
      appState: ctx.appState,
      takeSnapshot: options => ctx.takeSnapshot(options),
      captureAppSnapshot: options => ctx.captureAppSnapshot(options),
      discardLastSnapshot: () => ctx.discardLastSnapshot(),
      renderRuntime: ctx.renderRuntime,
      hasReactionPreview: () => ctx.hasReactionPreview(),
      reapplyActiveReactionPreview: () => ctx.reapplyActiveReactionPreview(),
      resetActiveResonanceView: ctx.resetActiveResonanceView,
      alignReaction2dProductOrientation: ctx.alignReaction2dProductOrientation,
      spreadReaction2dProductComponents: ctx.spreadReaction2dProductComponents,
      centerReaction2dPairCoords: ctx.centerReaction2dPairCoords,
      viewportFitPadding: ctx.viewportFitPadding,
      refineExistingCoords: ctx.refineExistingCoords,
      atomBBox: ctx.atomBBox,
      flipDisplayStereo: ctx.flipDisplayStereo,
      clearPrimitiveHover: () => ctx.clearPrimitiveHover(),
      restorePersistentHighlight: () => ctx.restorePersistentHighlight(),
      getFitCurrent2dView: () => ctx.getFitCurrent2dView(),
      getZoomTransform: () => ctx.getZoomTransform(),
      setZoomTransform: transform => ctx.setZoomTransform(transform),
      makeZoomIdentity: (x, y, k) => ctx.makeZoomIdentity(x, y, k),
      syncStereoMap2d: mol => ctx.syncStereoMap2d(mol),
      flipStereoMap2d: mol => ctx.flipStereoMap2d(mol),
      setPreserveSelectionOnNextRender: value => {
        ctx.setPreserveSelectionOnNextRender(value);
      },
      scale: ctx.scale,
      patchForceNodePositions: (patchPos, patchOptions = {}) => ctx.patchForceNodePositions(patchPos, patchOptions),
      forceFitTransform: (nodes, pad, fitOptions = {}) => ctx.forceFitTransform(nodes, pad, fitOptions),
      forceFitPad: ctx.forceFitPad,
      forceInitialZoomMultiplier: ctx.forceInitialZoomMultiplier,
      zoomTransformsDiffer: (a, b, epsilon) => ctx.zoomTransformsDiffer(a, b, epsilon),
      parseSMILES: ctx.parseSMILES,
      parseINCHI: ctx.parseINCHI,
      simulation: ctx.simulation,
      plotEl: ctx.plotEl,
      clean2dButton: ctx.clean2dButton,
      cleanForceButton: ctx.cleanForceButton,
      updateModeChrome: ctx.updateModeChrome
    })
  );

  const selectionActions = factories.createSelectionActions(
    depBuilders.createSelectionActionDeps({
      appState: ctx.appState,
      getDraw2D: () => ctx.getDraw2D(),
      applyForceSelection: () => ctx.applyForceSelection(),
      clearPrimitiveHover: () => ctx.clearPrimitiveHover(),
      getDrawBondPreviewActions: () => drawBondPreviewActions,
      getEditingActions: () => editingActions,
      panButton: ctx.panButton,
      selectButton: ctx.selectButton,
      drawBondButton: ctx.drawBondButton,
      drawTools: ctx.drawTools,
      eraseButton: ctx.eraseButton,
      getChargeToolButton: tool => ctx.getChargeToolButton(tool),
      getElementButton: element => ctx.getElementButton(element),
      getBondDrawTypeButton: type => ctx.getBondDrawTypeButton(type)
    })
  );

  const editingActions = factories.createEditingActions(
    depBuilders.createEditingActionDeps({
      appState: ctx.appState,
      performStructuralEdit: (...args) => ctx.performStructuralEdit(...args),
      hasReactionPreview: () => ctx.hasReactionPreview(),
      prepareReactionPreviewEraseTargets: (atomIds, bondIds) => ctx.prepareReactionPreviewEraseTargets(atomIds, bondIds),
      reactionPreviewBlock: ctx.reactionPreviewBlock,
      normalizeResonanceForEdit: ctx.normalizeResonanceForEdit,
      takeSnapshotPolicy: ctx.takeSnapshotPolicy,
      viewportNonePolicy: ctx.viewportNonePolicy,
      clearStereoAnnotations: (mol, affectedIds) => ctx.clearStereoAnnotations(mol, affectedIds),
      kekulize: ctx.kekulize,
      refreshAromaticity: ctx.refreshAromaticity,
      simulation: ctx.simulation,
      patchNodePositions: patchPos => ctx.patchNodePositions(patchPos),
      reseatHydrogensAroundPatched: patchPos => ctx.reseatHydrogensAroundPatched(patchPos),
      getFitCurrent2dView: () => ctx.getFitCurrent2dView(),
      refreshSelectionOverlay: () => ctx.refreshSelectionOverlay(),
      flashEraseButton: () => ctx.flashEraseButton()
    })
  );

  const dragGestureActions = factories.createDragGestureActions(
    depBuilders.createDragGestureActionDeps({
      createDrag: () => ctx.createDrag(),
      getDrawBondMode: () => ctx.getDrawBondMode(),
      getEraseMode: () => ctx.getEraseMode(),
      getChargeTool: () => ctx.getChargeTool?.() ?? null,
      captureSnapshot: () => ctx.captureSnapshot(),
      takeSnapshot: options => ctx.takeSnapshot(options),
      getSelectedDragAtomIds: (mol, atomIds = [], bondIds = []) => ctx.getSelectedDragAtomIds(mol, atomIds, bondIds),
      getCurrentMolecule: () => ctx.getCurrentMolecule(),
      setAutoFitEnabled: value => {
        ctx.setAutoFitEnabled(value);
      },
      disableKeepInView: () => ctx.disableKeepInView(),
      clearPrimitiveHover: () => ctx.clearPrimitiveHover(),
      refresh2dSelection: () => ctx.refresh2dSelection(),
      hideTooltip: () => ctx.hideTooltip(),
      setElementCursor: (element, value) => {
        ctx.setElementCursor(element, value);
      }
    })
  );

  const drawBondPreviewActions = factories.createDrawBondPreviewActions(
    depBuilders.createDrawBondPreviewActionDeps({
      g: ctx.g,
      getMode: () => ctx.getMode(),
      getDrawBondElement: () => ctx.getDrawBondElement(),
      getDrawBondType: () => ctx.getDrawBondType(),
      getDrawElemProtons: () => ctx.getDrawElemProtons(),
      isReactionPreviewEditableAtomId: id => ctx.isReactionPreviewEditableAtomId(id),
      getDrawBondState: () => ctx.getDrawBondState(),
      setDrawBondState: value => {
        ctx.setDrawBondState(value);
      },
      clearHoveredAtomIds: () => ctx.clearHoveredAtomIds(),
      clearHoveredBondIds: () => ctx.clearHoveredBondIds(),
      addHoveredAtomId: atomId => ctx.addHoveredAtomId(atomId),
      clearPrimitiveHover: () => ctx.clearPrimitiveHover(),
      applyForceSelection: () => ctx.applyForceSelection(),
      redraw2dSelection: () => ctx.redraw2dSelection(),
      getPlotSize: () => ctx.getPlotSize(),
      getForceNodeById: atomId => ctx.getForceNodeById(atomId),
      getForceNodes: () => ctx.getForceNodes(),
      get2DAtomById: atomId => ctx.get2DAtomById(atomId),
      get2DAtoms: () => ctx.get2DAtoms(),
      get2DCenterX: () => ctx.get2DCenterX(),
      get2DCenterY: () => ctx.get2DCenterY(),
      scale: ctx.scale,
      forceBondLength: ctx.forceBondLength,
      bondOffset2d: ctx.bondOffset2d,
      strokeWidth: ctx.strokeWidth,
      fontSize: ctx.fontSize,
      atomRadius: ctx.atomRadius,
      atomColor: ctx.atomColor,
      strokeColor: ctx.strokeColor,
      singleBondWidth: ctx.singleBondWidth,
      labelHalfW: ctx.labelHalfW
    })
  );

  const drawBondCommitActions = factories.createDrawBondCommitActions(
    depBuilders.createDrawBondCommitActionDeps({
      getMode: () => ctx.getMode(),
      getDrawBondElement: () => ctx.getDrawBondElement(),
      getDrawBondType: () => ctx.getDrawBondType(),
      clearPreviewArtifacts: () => drawBondPreviewActions.clearArtifacts(),
      cancelPreview: () => drawBondPreviewActions.cancel(),
      getDrawBondState: () => ctx.getDrawBondState(),
      setDrawBondState: value => {
        ctx.setDrawBondState(value);
      },
      clearPrimitiveHover: () => ctx.clearPrimitiveHover(),
      setDrawBondHoverSuppressed: value => {
        ctx.setDrawBondHoverSuppressed(value);
      },
      captureZoomTransform: () => ctx.captureZoomTransform(),
      restore2dEditViewport: (zoomSnapshot, restoreOptions = {}) => ctx.restore2dEditViewport(zoomSnapshot, restoreOptions),
      getPlotSize: () => ctx.getPlotSize(),
      scale: ctx.scale,
      forceScale: ctx.forceScale,
      captureSnapshot: options => ctx.captureSnapshot(options),
      restoreSnapshot: snap => ctx.restoreSnapshot(snap),
      takeSnapshot: options => ctx.takeSnapshot(options),
      prepareReactionPreviewEditTargets: payload => ctx.prepareReactionPreviewEditTargets(payload),
      prepareResonanceStructuralEdit: mol => ctx.prepareResonanceStructuralEdit(mol),
      getActiveMolecule: () => ctx.getActiveMolecule(),
      ensureActiveMolecule: () => ctx.ensureActiveMolecule(),
      getForceNodeById: atomId => ctx.getForceNodeById(atomId),
      getForceNodes: () => ctx.getForceNodes(),
      patchNodePositions: patchPos => ctx.patchNodePositions(patchPos),
      reseatHydrogensAroundPatched: patchPos => ctx.reseatHydrogensAroundPatched(patchPos),
      enableKeepInView: () => ctx.enableKeepInView(),
      get2DCenterX: () => ctx.get2DCenterX(),
      get2DCenterY: () => ctx.get2DCenterY(),
      sync2DDerivedState: mol => ctx.sync2DDerivedState(mol),
      kekulize: ctx.kekulize,
      refreshAromaticity: ctx.refreshAromaticity,
      syncInputField: mol => ctx.syncInputField(mol),
      updateFormula: mol => ctx.updateFormula(mol),
      updateDescriptors: mol => ctx.updateDescriptors(mol),
      updatePanels: mol => ctx.updatePanels(mol),
      draw2d: () => ctx.draw2d(),
      updateForce: (mol, renderOptions = {}) => ctx.updateForce(mol, renderOptions),
      clearSelection: () => ctx.clearSelection(),
      changeAtomElements: (atomIds, newEl, changeOptions = {}) => ctx.changeAtomElements(atomIds, newEl, changeOptions),
      promoteBondOrder: (bondId, promoteOptions = {}) => ctx.promoteBondOrder(bondId, promoteOptions)
    })
  );

  const primitiveSelectionActions = factories.createPrimitiveSelectionActions(
    depBuilders.createPrimitiveSelectionActionDeps({
      appState: ctx.appState,
      getDraw2D: () => ctx.getDraw2D(),
      applyForceSelection: () => ctx.applyForceSelection(),
      clearPrimitiveHover: () => ctx.clearPrimitiveHover(),
      isAdditiveSelectionEvent: event => ctx.isAdditiveSelectionEvent(event),
      hasVisibleStereoBond: bondId => ctx.hasVisibleStereoBond(bondId)
    })
  );

  const primitiveEventHandlers = factories.createPrimitiveEventHandlers(
    depBuilders.createPrimitiveEventHandlerDeps({
      appState: ctx.appState,
      primitiveSelectionActions,
      isReactionPreviewEditableAtomId: id => ctx.isReactionPreviewEditableAtomId(id),
      getDrawBondState: () => ctx.getDrawBondState(),
      startDrawBond: (atomId, gX, gY) => drawBondPreviewActions.start(atomId, gX, gY),
      resetDrawBondHover: () => drawBondPreviewActions.resetHover(),
      getDrawBondElement: () => ctx.getDrawBondElement(),
      getDrawBondType: () => ctx.getDrawBondType(),
      promoteBondOrder: (bondId, promoteOptions = {}) => ctx.promoteBondOrder(bondId, promoteOptions),
      eraseItem: (atomIds, bondIds) => editingActions.eraseItem(atomIds, bondIds),
      changeAtomCharge: (atomId, changeOptions = {}) => ctx.changeAtomCharge(atomId, changeOptions),
      replaceForceHydrogenAtom: (atomId, mol) => ctx.replaceForceHydrogenAtom(atomId, mol),
      autoPlaceBond: (atomId, ox, oy) => drawBondCommitActions.autoPlaceBond(atomId, ox, oy),
      showPrimitiveHover: (atomIds = [], bondIds = []) => ctx.showPrimitiveHover(atomIds, bondIds),
      clearPrimitiveHover: () => ctx.clearPrimitiveHover(),
      refreshSelectionOverlay: () => ctx.refreshSelectionOverlay(),
      isDrawBondHoverSuppressed: () => ctx.isDrawBondHoverSuppressed(),
      isPrimitiveHoverSuppressed: () => ctx.isPrimitiveHoverSuppressed(),
      setPrimitiveHoverSuppressed: value => {
        ctx.setPrimitiveHoverSuppressed(value);
      },
      showDelayedTooltip: (html, event, delay = 150) => ctx.showDelayedTooltip(html, event, delay),
      showImmediateTooltip: (html, event) => ctx.showImmediateTooltip(html, event),
      moveTooltip: event => ctx.moveTooltip(event),
      hideTooltip: () => ctx.hideTooltip(),
      getSelectionValenceTooltipAtomId: () => ctx.getSelectionValenceTooltipAtomId(),
      setSelectionValenceTooltipAtomId: value => {
        ctx.setSelectionValenceTooltipAtomId(value);
      },
      getRenderOptions: ctx.getRenderOptions,
      atomTooltipHtml: ctx.atomTooltipHtml,
      bondTooltipHtml: ctx.bondTooltipHtml,
      pointer: (event, node) => ctx.pointer(event, node),
      getGNode: () => ctx.getGNode()
    })
  );

  return {
    navigationActions,
    selectionActions,
    editingActions,
    dragGestureActions,
    drawBondPreviewActions,
    drawBondCommitActions,
    primitiveSelectionActions,
    primitiveEventHandlers
  };
}
