/** @module app/interactions/primitive-events */

import { atomDisplayColor, atomDisplayOpacity, atomRadius, getRenderOptions, singleBondWidth, strokeColor } from '../render/helpers.js';

const RING_TEMPLATE_ROTATION_SNAP = Math.PI / 6;
const RING_TEMPLATE_DRAG_THRESHOLD_PX = 3;
const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Creates event handler functions for all atom and bond mouse interactions in both 2D and force-layout modes.
 * @param {object} context - Dependency context providing state, view, selection, actions, drawBond, overlays, tooltip, tooltipState, formatters, options, pointer, and dom.
 * @returns {object} Object with handlers for 2D/force bond and atom click, double-click, mouse-over, mouse-move, mouse-out, and draw-bond mouse-down events.
 */
export function createPrimitiveEventHandlers(context) {
  let pendingRingTemplate = null;
  let suppressNextRingTemplateClick = false;

  function getChargeTool() {
    return context.state.overlayState.getChargeTool?.() ?? null;
  }

  function getPaintStyle() {
    return {
      color: context.state.overlayState.getPaintColor?.() ?? '#3366ff',
      opacity: context.state.overlayState.getPaintOpacity?.() ?? 1
    };
  }

  function isPaintMode() {
    return context.state.overlayState.getPaintMode?.() ?? false;
  }

  function isRingTemplateMode() {
    return context.state.overlayState.getRingTemplateMode?.() ?? false;
  }

  function getRingTemplateBondLength() {
    return context.state.viewState.getMode() === 'force' ? (context.constants?.forceBondLength ?? 30) : (context.constants?.scale ?? 40) * 1.5;
  }

  function normalizePreviewAngle(angle) {
    const normalized = angle % (Math.PI * 2);
    return normalized < 0 ? normalized + Math.PI * 2 : normalized;
  }

  function snapRingTemplateAngle(angle) {
    return normalizePreviewAngle(Math.round(angle / RING_TEMPLATE_ROTATION_SNAP) * RING_TEMPLATE_ROTATION_SNAP);
  }

  function previewRingPositions(size, anchorPoint, bondLength, centerAngle) {
    const radius = bondLength / (2 * Math.sin(Math.PI / size));
    const center = {
      x: anchorPoint.x + Math.cos(centerAngle) * radius,
      y: anchorPoint.y + Math.sin(centerAngle) * radius
    };
    const anchorAngleFromCenter = centerAngle + Math.PI;
    const positions = [{ x: anchorPoint.x, y: anchorPoint.y }];
    for (let index = 1; index < size; index++) {
      const angle = anchorAngleFromCenter + (index * Math.PI * 2) / size;
      positions.push({
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius
      });
    }
    return positions;
  }

  function removeRingTemplatePreview() {
    context.dom.gNode?.()?.querySelector?.('g.ring-template-preview')?.remove?.();
  }

  function renderRingTemplatePreview(state, centerAngle) {
    const gNode = context.dom.gNode?.();
    if (!gNode?.appendChild || !gNode.ownerDocument) {
      return;
    }
    removeRingTemplatePreview();
    const group = gNode.ownerDocument.createElementNS(SVG_NS, 'g');
    group.setAttribute('class', 'ring-template-preview');
    group.setAttribute('pointer-events', 'none');
    const positions = previewRingPositions(state.size, state.anchorPoint, getRingTemplateBondLength(), centerAngle);
    const mode = context.state.viewState.getMode();
    const isForce = mode === 'force';
    const bondStrokeWidth = isForce ? singleBondWidth(1) : `${getRenderOptions().twoDBondThickness}px`;

    for (let index = 0; index < positions.length; index++) {
      const start = positions[index];
      const end = positions[(index + 1) % positions.length];
      const line = gNode.ownerDocument.createElementNS(SVG_NS, 'line');
      line.setAttribute('class', isForce ? 'link' : 'bond');
      line.setAttribute('x1', String(start.x));
      line.setAttribute('y1', String(start.y));
      line.setAttribute('x2', String(end.x));
      line.setAttribute('y2', String(end.y));
      line.setAttribute('stroke-width', bondStrokeWidth);
      line.setAttribute('pointer-events', 'none');
      group.appendChild(line);
    }

    if (isForce) {
      const previewCarbon = { name: 'C', properties: {} };
      for (let index = 1; index < positions.length; index++) {
        const point = positions[index];
        const circle = gNode.ownerDocument.createElementNS(SVG_NS, 'circle');
        circle.setAttribute('class', 'node');
        circle.setAttribute('cx', String(point.x));
        circle.setAttribute('cy', String(point.y));
        circle.setAttribute('r', String(atomRadius(6)));
        circle.setAttribute('fill', atomDisplayColor(previewCarbon, 'force'));
        circle.setAttribute('fill-opacity', String(atomDisplayOpacity(previewCarbon)));
        circle.setAttribute('stroke', strokeColor('C'));
        circle.setAttribute('stroke-opacity', String(atomDisplayOpacity(previewCarbon)));
        circle.setAttribute('stroke-width', '1');
        circle.setAttribute('pointer-events', 'none');
        group.appendChild(circle);
      }
    }
    gNode.appendChild(group);
  }

  function clearPendingRingTemplateListeners(state) {
    state?.document?.removeEventListener?.('mousemove', state.handleMove, true);
    state?.document?.removeEventListener?.('mouseup', state.handleUp, true);
  }

  function commitPendingRingTemplate(state) {
    const options = { anchorAtomId: state.atomId };
    if (state.dragged && Number.isFinite(state.currentGraphAngle)) {
      options.anchorForceCenterAngle = state.currentGraphAngle;
      options.anchorCenterAngle = -state.currentGraphAngle;
    }
    context.actions.placeRingTemplate?.(state.size, state.anchorPoint.x, state.anchorPoint.y, options);
  }

  function updatePendingRingTemplate(event, state) {
    const [gX, gY] = context.pointer(event, context.dom.gNode());
    const dx = gX - state.anchorPoint.x;
    const dy = gY - state.anchorPoint.y;
    const distance = Math.hypot(dx, dy);
    if (!state.dragged && distance < RING_TEMPLATE_DRAG_THRESHOLD_PX) {
      return;
    }
    state.dragged = true;
    state.currentGraphAngle = snapRingTemplateAngle(Math.atan2(dy, dx));
    renderRingTemplatePreview(state, state.currentGraphAngle);
  }

  function startRingTemplateOnAtom(event, atomId) {
    if (!isRingTemplateMode()) {
      return false;
    }
    if (event.button != null && event.button !== 0) {
      return false;
    }
    event.preventDefault?.();
    event.stopPropagation?.();
    const [gX, gY] = context.pointer(event, context.dom.gNode());
    const doc = event.currentTarget?.ownerDocument ?? context.document ?? globalThis.document ?? null;
    const state = {
      atomId,
      size: context.state.overlayState.getRingTemplateSize?.() ?? 6,
      anchorPoint: { x: gX, y: gY },
      currentGraphAngle: null,
      dragged: false,
      document: doc,
      handleMove: null,
      handleUp: null
    };
    state.handleMove = moveEvent => {
      if (pendingRingTemplate !== state) {
        return;
      }
      moveEvent.preventDefault?.();
      updatePendingRingTemplate(moveEvent, state);
    };
    state.handleUp = upEvent => {
      if (pendingRingTemplate !== state) {
        return;
      }
      upEvent.preventDefault?.();
      upEvent.stopPropagation?.();
      clearPendingRingTemplateListeners(state);
      removeRingTemplatePreview();
      pendingRingTemplate = null;
      suppressNextRingTemplateClick = true;
      commitPendingRingTemplate(state);
      setTimeout(() => {
        suppressNextRingTemplateClick = false;
      }, 0);
    };
    clearPendingRingTemplateListeners(pendingRingTemplate);
    removeRingTemplatePreview();
    pendingRingTemplate = state;
    doc?.addEventListener?.('mousemove', state.handleMove, true);
    doc?.addEventListener?.('mouseup', state.handleUp, true);
    return true;
  }

  function placeRingTemplateOnAtomClick(event, atomId) {
    if (!isRingTemplateMode()) {
      return false;
    }
    event.preventDefault?.();
    event.stopPropagation?.();
    if (suppressNextRingTemplateClick) {
      suppressNextRingTemplateClick = false;
      return true;
    }
    const [gX, gY] = context.pointer(event, context.dom.gNode());
    context.actions.placeRingTemplate?.(context.state.overlayState.getRingTemplateSize?.() ?? 6, gX, gY, {
      anchorAtomId: atomId
    });
    return true;
  }

  function isPaintBrushMode() {
    return isPaintMode() && (context.state.overlayState.getPaintTool?.() ?? 'brush') === 'brush';
  }

  function isPaintEraserMode() {
    return isPaintMode() && context.state.overlayState.getPaintTool?.() === 'eraser';
  }

  function suppressPaintModeTooltip() {
    if (!isPaintMode()) {
      return false;
    }
    context.tooltip.hide();
    return true;
  }

  function showPrimitiveHover(atomIds = [], bondIds = []) {
    if (context.view.isPrimitiveHoverSuppressed?.()) {
      context.view.setPrimitiveHoverSuppressed?.(false);
    }
    context.view.showPrimitiveHover(atomIds, bondIds);
    return true;
  }

  function maybeRefreshDrawBondHover(id, kind) {
    if (!context.state.overlayState.getDrawBondMode() || context.view.isDrawBondHoverSuppressed()) {
      return;
    }
    if (kind === 'atom') {
      context.state.overlayState.getHoveredAtomIds().add(id);
    } else {
      context.state.overlayState.getHoveredBondIds().add(id);
    }
    context.view.refreshSelectionOverlay();
  }

  function clearHoverOnExit() {
    if (context.drawBond.hasDrawBondState()) {
      context.drawBond.resetHover();
    } else {
      context.view.clearPrimitiveHover();
      context.view.refreshSelectionOverlay();
    }
  }

  function handle2dBondClick(event, bondId) {
    if (isRingTemplateMode()) {
      return;
    }
    if (context.state.overlayState.getDrawBondMode()) {
      context.actions.promoteBondOrder(bondId, { drawBondType: context.drawBond.getType?.() ?? 'single' });
      return;
    }
    if (isPaintBrushMode()) {
      context.actions.paintStyleTargets([], [bondId], getPaintStyle());
      return;
    }
    if (isPaintEraserMode()) {
      context.actions.paintStyleTargets([], [bondId], null);
      return;
    }
    if (context.state.overlayState.getEraseMode()) {
      context.actions.eraseItem([], [bondId]);
      return;
    }
    context.selection.handle2dPrimitiveClick(event, [], [bondId]);
  }

  function handle2dBondDblClick(event, atomIds) {
    context.selection.handle2dComponentDblClick(event, atomIds);
  }

  function handle2dBondMouseOver(event, bond, atom1, atom2) {
    const chargeTool = getChargeTool();
    if (chargeTool) {
      return;
    }
    if (context.state.overlayState.getEraseMode() && context.state.overlayState.getErasePainting()) {
      showPrimitiveHover([], [bond.id]);
      return;
    }
    if (!showPrimitiveHover([], [bond.id])) {
      return;
    }
    maybeRefreshDrawBondHover(bond.id, 'bond');
    const paintTooltipSuppressed = suppressPaintModeTooltip();
    if (isRingTemplateMode() || paintTooltipSuppressed || context.state.overlayState.getSelectMode() || context.state.overlayState.getDrawBondMode() || context.state.overlayState.getEraseMode()) {
      if (!paintTooltipSuppressed) {
        context.tooltip.hide();
      }
      return;
    }
    context.tooltip.showDelayed(context.formatters.bondTooltipHtml(bond, atom1, atom2), event, 150);
  }

  function handle2dBondMouseMove(event) {
    context.tooltip.move(event);
  }

  function handle2dBondMouseOut() {
    clearHoverOnExit();
    context.tooltip.hide();
  }

  function handle2dAtomMouseDownDrawBond(event, atomId) {
    if (startRingTemplateOnAtom(event, atomId)) {
      return;
    }
    if (!context.state.overlayState.getDrawBondMode() || context.state.viewState.getMode() !== '2d' || !context.state.documentState.getMol2d()) {
      return;
    }
    if (!context.overlays.isReactionPreviewEditableAtomId(atomId)) {
      return;
    }
    event.stopPropagation();
    const [gX, gY] = context.pointer(event, context.dom.gNode());
    context.drawBond.start(atomId, gX, gY);
  }

  function handle2dAtomClick(event, atomId) {
    if (placeRingTemplateOnAtomClick(event, atomId)) {
      return;
    }
    if (context.state.overlayState.getDrawBondMode()) {
      return;
    }
    if (isPaintBrushMode()) {
      context.actions.paintStyleTargets([atomId], [], getPaintStyle());
      return;
    }
    if (isPaintEraserMode()) {
      context.actions.paintStyleTargets([atomId], [], null);
      return;
    }
    const chargeTool = getChargeTool();
    if (chargeTool) {
      context.actions.changeAtomCharge(atomId, {
        chargeTool,
        decrement: false
      });
      return;
    }
    if (context.state.overlayState.getEraseMode()) {
      context.actions.eraseItem([atomId], []);
      return;
    }
    context.selection.handle2dPrimitiveClick(event, [atomId], []);
  }

  function handle2dAtomContextMenu(event, atom) {
    const chargeTool = getChargeTool();
    if (!chargeTool) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    context.actions.changeAtomCharge(atom.id ?? atom, {
      chargeTool,
      decrement: true
    });
  }

  function handle2dAtomDblClick(event, atomId) {
    context.selection.handle2dComponentDblClick(event, [atomId]);
  }

  function handle2dAtomMouseOver(event, atom, mol, valenceWarning) {
    const chargeTool = getChargeTool();
    if (context.state.overlayState.getEraseMode() && context.state.overlayState.getErasePainting()) {
      showPrimitiveHover([atom.id], []);
      return;
    }
    if (!showPrimitiveHover([atom.id], [])) {
      return;
    }
    maybeRefreshDrawBondHover(atom.id, 'atom');
    const showAtomTooltips = context.options.getRenderOptions().showAtomTooltips;
    if (
      chargeTool ||
      isRingTemplateMode() ||
      suppressPaintModeTooltip() ||
      !showAtomTooltips ||
      (context.state.overlayState.getEraseMode() && !valenceWarning) ||
      ((context.state.overlayState.getSelectMode() || context.state.overlayState.getDrawBondMode()) && !valenceWarning)
    ) {
      return;
    }
    if ((context.state.overlayState.getSelectMode() || context.state.overlayState.getDrawBondMode() || context.state.overlayState.getEraseMode()) && valenceWarning) {
      context.tooltipState.setSelectionValenceTooltipAtomId(atom.id);
      context.tooltip.showImmediate(context.formatters.atomTooltipHtml(atom, mol, valenceWarning, '2d'), event);
      return;
    }
    context.tooltip.showDelayed(context.formatters.atomTooltipHtml(atom, mol, valenceWarning, '2d'), event, 150);
  }

  function handle2dAtomMouseMove(event) {
    context.tooltip.move(event);
  }

  function handle2dAtomMouseOut(atomId) {
    if (context.state.overlayState.getSelectMode() && context.tooltipState.getSelectionValenceTooltipAtomId() === atomId) {
      return;
    }
    clearHoverOnExit();
    context.tooltip.hide();
  }

  function handleForceBondClick(event, bondId, molecule) {
    if (isRingTemplateMode()) {
      return;
    }
    if (context.state.overlayState.getDrawBondMode()) {
      context.actions.promoteBondOrder(bondId, { drawBondType: context.drawBond.getType?.() ?? 'single' });
      return;
    }
    if (isPaintBrushMode()) {
      context.actions.paintStyleTargets([], [bondId], getPaintStyle());
      return;
    }
    if (isPaintEraserMode()) {
      context.actions.paintStyleTargets([], [bondId], null);
      return;
    }
    if (context.state.overlayState.getEraseMode()) {
      const bond = molecule.bonds.get(bondId);
      if (bond?.atoms.some(id => molecule.atoms.get(id)?.name === 'H')) {
        return;
      }
      context.actions.eraseItem([], [bondId]);
      return;
    }
    context.selection.handleForcePrimitiveClick(event, [], [bondId]);
  }

  function handleForceBondDblClick(event, atomIds) {
    context.selection.handleForceComponentDblClick(event, atomIds);
  }

  function handleForceBondMouseOver(event, bondId, molecule) {
    const chargeTool = getChargeTool();
    if (chargeTool) {
      return;
    }
    if (context.state.overlayState.getEraseMode() && context.state.overlayState.getErasePainting()) {
      const bond = molecule.bonds.get(bondId);
      if (bond?.atoms.some(id => molecule.atoms.get(id)?.name === 'H')) {
        return;
      }
      showPrimitiveHover([], [bondId]);
      return;
    }
    if (!showPrimitiveHover([], [bondId])) {
      return;
    }
    maybeRefreshDrawBondHover(bondId, 'bond');
    const paintTooltipSuppressed = suppressPaintModeTooltip();
    if (isRingTemplateMode() || paintTooltipSuppressed || context.state.overlayState.getSelectMode() || context.state.overlayState.getDrawBondMode() || context.state.overlayState.getEraseMode()) {
      if (!paintTooltipSuppressed) {
        context.tooltip.hide();
      }
      return;
    }
    const bond = molecule.bonds.get(bondId);
    if (!bond) {
      return;
    }
    const atom1 = molecule.atoms.get(bond.atoms[0]);
    const atom2 = molecule.atoms.get(bond.atoms[1]);
    if (!atom1 || !atom2) {
      return;
    }
    context.tooltip.showDelayed(context.formatters.bondTooltipHtml(bond, atom1, atom2), event, 150);
  }

  function handleForceBondMouseMove(event) {
    context.tooltip.move(event);
  }

  function handleForceBondMouseOut() {
    clearHoverOnExit();
    context.tooltip.hide();
  }

  function handleForceAtomMouseDownDrawBond(event, atom) {
    if (startRingTemplateOnAtom(event, atom.id)) {
      return;
    }
    if (!context.state.overlayState.getDrawBondMode() || context.state.viewState.getMode() !== 'force' || !context.state.documentState.getCurrentMol()) {
      return;
    }
    if (atom.name === 'H') {
      return;
    }
    if (!context.overlays.isReactionPreviewEditableAtomId(atom.id)) {
      return;
    }
    event.stopPropagation();
    const [gX, gY] = context.pointer(event, context.dom.gNode());
    context.drawBond.start(atom.id, gX, gY);
  }

  function handleForceAtomClick(event, atom, molecule) {
    if (placeRingTemplateOnAtomClick(event, atom.id)) {
      return;
    }
    if (context.state.overlayState.getDrawBondMode()) {
      if (!context.overlays.isReactionPreviewEditableAtomId(atom.id)) {
        event.stopPropagation();
        return;
      }
      if (atom.name === 'H' && atom.name !== context.drawBond.getElement()) {
        event.stopPropagation();
        const drawType = context.drawBond.getType?.() ?? 'single';
        if (drawType === 'wedge' || drawType === 'dash') {
          const molAtom = molecule.atoms.get(atom.id);
          const parentAtom = molAtom?.getNeighbors(molecule).find(n => n.name !== 'H');
          if (parentAtom) {
            const [gX, gY] = context.pointer(event, context.dom.gNode());
            context.actions.autoPlaceBond(parentAtom.id, gX, gY);
            return;
          }
        }
        context.actions.replaceForceHydrogenAtom(atom.id, molecule);
      }
      return;
    }
    const chargeTool = getChargeTool();
    if (isPaintBrushMode()) {
      context.actions.paintStyleTargets([atom.id], [], getPaintStyle());
      return;
    }
    if (isPaintEraserMode()) {
      context.actions.paintStyleTargets([atom.id], [], null);
      return;
    }
    if (chargeTool) {
      if (atom.name === 'H') {
        return;
      }
      context.actions.changeAtomCharge(atom.id, {
        chargeTool,
        decrement: false
      });
      return;
    }
    if (context.state.overlayState.getEraseMode()) {
      if (atom.name === 'H') {
        return;
      }
      context.actions.eraseItem([atom.id], []);
      return;
    }
    context.selection.handleForcePrimitiveClick(event, [atom.id], []);
  }

  function handleForceAtomContextMenu(event, atom) {
    const chargeTool = getChargeTool();
    if (!chargeTool) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (atom.name === 'H') {
      return;
    }
    context.actions.changeAtomCharge(atom.id, {
      chargeTool,
      decrement: true
    });
  }

  function handleForceAtomDblClick(event, atomId) {
    context.selection.handleForceComponentDblClick(event, [atomId]);
  }

  function handleForceAtomMouseOver(event, atomNode, molecule, valenceWarning) {
    const chargeTool = getChargeTool();
    if (chargeTool && atomNode.name === 'H') {
      return;
    }
    if (context.state.overlayState.getEraseMode() && context.state.overlayState.getErasePainting()) {
      if (atomNode.name === 'H') {
        return;
      }
      showPrimitiveHover([atomNode.id], []);
      return;
    }
    if (!showPrimitiveHover([atomNode.id], [])) {
      return;
    }
    maybeRefreshDrawBondHover(atomNode.id, 'atom');
    const atom = molecule.atoms.get(atomNode.id);
    if (!atom) {
      return;
    }
    const showAtomTooltips = context.options.getRenderOptions().showAtomTooltips;
    if (
      chargeTool ||
      isRingTemplateMode() ||
      suppressPaintModeTooltip() ||
      !showAtomTooltips ||
      (context.state.overlayState.getEraseMode() && !valenceWarning) ||
      ((context.state.overlayState.getSelectMode() || context.state.overlayState.getDrawBondMode()) && !valenceWarning)
    ) {
      return;
    }
    if ((context.state.overlayState.getSelectMode() || context.state.overlayState.getDrawBondMode() || context.state.overlayState.getEraseMode()) && valenceWarning) {
      context.tooltipState.setSelectionValenceTooltipAtomId(atomNode.id);
      context.tooltip.showImmediate(context.formatters.atomTooltipHtml(atom, molecule, valenceWarning, 'force'), event);
      return;
    }
    context.tooltip.showDelayed(context.formatters.atomTooltipHtml(atom, molecule, valenceWarning, 'force'), event, 200);
  }

  function handleForceAtomMouseMove(event) {
    context.tooltip.move(event);
  }

  function handleForceAtomMouseOut(atomId) {
    if (context.state.overlayState.getSelectMode() && context.tooltipState.getSelectionValenceTooltipAtomId() === atomId) {
      return;
    }
    clearHoverOnExit();
    context.tooltip.hide();
  }

  return {
    handle2dBondClick,
    handle2dBondDblClick,
    handle2dBondMouseOver,
    handle2dBondMouseMove,
    handle2dBondMouseOut,
    handle2dAtomMouseDownDrawBond,
    handle2dAtomClick,
    handle2dAtomContextMenu,
    handle2dAtomDblClick,
    handle2dAtomMouseOver,
    handle2dAtomMouseMove,
    handle2dAtomMouseOut,
    handleForceBondClick,
    handleForceBondDblClick,
    handleForceBondMouseOver,
    handleForceBondMouseMove,
    handleForceBondMouseOut,
    handleForceAtomMouseDownDrawBond,
    handleForceAtomClick,
    handleForceAtomContextMenu,
    handleForceAtomDblClick,
    handleForceAtomMouseOver,
    handleForceAtomMouseMove,
    handleForceAtomMouseOut
  };
}
