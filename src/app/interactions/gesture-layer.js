/** @module app/interactions/gesture-layer */

/**
 * Returns true when the event's modifier keys indicate an additive (extend) selection gesture.
 * @param {MouseEvent} event - The mouse event to test.
 * @returns {boolean} True if the Meta or Ctrl key is held.
 */
export function isAdditiveSelectionEvent(event) {
  return !!(event.metaKey || event.ctrlKey);
}

/**
 * Attaches all SVG and document-level gesture event listeners for selection drag, draw-bond, and erase-paint interactions.
 * @param {object} context - Dependency context providing svg, g, state, simulation, view, drawBond, selection, renderers, actions, helpers, overlays, pointer, schedule, and dom.
 */
export function initGestureInteractions(context) {
  const { svg, g, doc = document } = context;

  const selectionRect = svg
    .append('rect')
    .attr('class', 'selection-rect')
    .attr('fill', 'rgba(100, 160, 255, 0.12)')
    .attr('stroke', 'rgb(80, 140, 255)')
    .attr('stroke-width', 1.5)
    .attr('stroke-dasharray', '5,3')
    .attr('pointer-events', 'none')
    .style('display', 'none');

  let selectionDragging = false;
  let selectionStart = null;
  let selectionAdditive = false;
  let suppressForceSelectionClearClick = false;
  let lastEraseHitElement = null;

  function selectionEventPoint(event, clampToPlot = false) {
    const rect = svg.node().getBoundingClientRect();
    let x = event.clientX - rect.left;
    let y = event.clientY - rect.top;
    if (clampToPlot) {
      x = Math.max(0, Math.min(rect.width, x));
      y = Math.max(0, Math.min(rect.height, y));
    }
    return [x, y];
  }

  function updateSelectionRect(x, y) {
    const rx = Math.min(selectionStart.x, x);
    const ry = Math.min(selectionStart.y, y);
    selectionRect.attr('x', rx).attr('y', ry).attr('width', Math.abs(x - selectionStart.x)).attr('height', Math.abs(y - selectionStart.y));
  }

  function finishSelectionDrag(event) {
    if (!selectionDragging) {
      return;
    }

    selectionDragging = false;
    selectionRect.style('display', 'none');

    const mode = context.state.viewState.getMode();
    if (mode !== '2d' && mode !== 'force') {
      return;
    }
    if (mode === '2d' && !context.state.documentState.getMol2d()) {
      return;
    }
    if (mode === 'force' && !context.state.documentState.getCurrentMol()) {
      return;
    }

    const [x, y] = selectionEventPoint(event, true);
    const rw = Math.abs(x - selectionStart.x);
    const rh = Math.abs(y - selectionStart.y);
    const additive = selectionAdditive;
    selectionAdditive = false;

    if (rw < 5 && rh < 5) {
      if (additive) {
        context.renderers.applySelectionOverlay();
        return;
      }
      context.view.clearPrimitiveHover();
      context.state.overlayState.getSelectedAtomIds().clear();
      context.state.overlayState.getSelectedBondIds().clear();
      context.renderers.applySelectionOverlay();
      return;
    }

    const rx = Math.min(selectionStart.x, x);
    const ry = Math.min(selectionStart.y, y);
    const transform = context.view.getZoomTransform();
    const selectedAtomIds = context.state.overlayState.getSelectedAtomIds();
    const selectedBondIds = context.state.overlayState.getSelectedBondIds();

    if (!additive) {
      selectedAtomIds.clear();
      selectedBondIds.clear();
    }
    context.view.clearPrimitiveHover();

    if (mode === 'force') {
      const nodes = context.simulation.nodes();
      for (const node of nodes) {
        const sx = transform.applyX(node.x);
        const sy = transform.applyY(node.y);
        if (sx >= rx && sx <= rx + rw && sy >= ry && sy <= ry + rh) {
          if (additive) {
            if (selectedAtomIds.has(node.id)) {
              selectedAtomIds.delete(node.id);
            } else {
              selectedAtomIds.add(node.id);
            }
          } else {
            selectedAtomIds.add(node.id);
          }
        }
      }

      for (const link of context.simulation.force('link').links()) {
        if (additive) {
          if (selectedBondIds.has(link.id) && (!selectedAtomIds.has(link.source.id) || !selectedAtomIds.has(link.target.id))) {
            selectedBondIds.delete(link.id);
          } else if (selectedAtomIds.has(link.source.id) && selectedAtomIds.has(link.target.id)) {
            selectedBondIds.add(link.id);
          }
        } else if (selectedAtomIds.has(link.source.id) && selectedAtomIds.has(link.target.id)) {
          selectedBondIds.add(link.id);
        }
      }

      suppressForceSelectionClearClick = true;
      context.renderers.applySelectionOverlay();
      return;
    }

    const mol2d = context.state.documentState.getMol2d();
    const atoms = [...mol2d.atoms.values()].filter(atom => atom.x != null && atom.visible !== false);
    for (const atom of atoms) {
      const { x: gX, y: gY } = context.helpers.toSVGPt2d(atom);
      const sx = transform.applyX(gX);
      const sy = transform.applyY(gY);
      if (sx >= rx && sx <= rx + rw && sy >= ry && sy <= ry + rh) {
        if (additive) {
          if (selectedAtomIds.has(atom.id)) {
            selectedAtomIds.delete(atom.id);
          } else {
            selectedAtomIds.add(atom.id);
          }
        } else {
          selectedAtomIds.add(atom.id);
        }
      }
    }

    for (const bond of mol2d.bonds.values()) {
      const [a1, a2] = bond.getAtomObjects(mol2d);
      if (!a1 || !a2 || a1.visible === false || a2.visible === false) {
        continue;
      }
      if (additive) {
        if (selectedBondIds.has(bond.id) && (!selectedAtomIds.has(a1.id) || !selectedAtomIds.has(a2.id))) {
          selectedBondIds.delete(bond.id);
        } else if (selectedAtomIds.has(a1.id) && selectedAtomIds.has(a2.id)) {
          selectedBondIds.add(bond.id);
        }
      } else if (selectedAtomIds.has(a1.id) && selectedAtomIds.has(a2.id)) {
        selectedBondIds.add(bond.id);
      }
    }

    context.renderers.applySelectionOverlay();
  }

  function handleErasePaintMove(event) {
    const cursor = context.dom.getEraseCursorElement();
    if (context.state.overlayState.getErasePainting()) {
      cursor.style.left = `${event.clientX}px`;
      cursor.style.top = `${event.clientY}px`;
    }
    if (!context.state.overlayState.getEraseMode() || !context.state.overlayState.getErasePainting()) {
      return;
    }

    const ERASE_R = 14;
    const cx = event.clientX;
    const cy = event.clientY;
    const seen = new Set();
    const candidates = [];
    const addIfUnseen = element => {
      if (!seen.has(element)) {
        seen.add(element);
        candidates.push(element);
      }
    };

    const perimeterAngles = [0, 45, 90, 135, 180, 225, 270, 315];
    for (const element of doc.elementsFromPoint(cx, cy)) {
      if (!element.classList.contains('atom-hit') && !element.classList.contains('bond-hit')) {
        addIfUnseen(element);
      }
    }
    for (const angle of perimeterAngles) {
      const rad = (angle * Math.PI) / 180;
      const px = cx + ERASE_R * Math.cos(rad);
      const py = cy + ERASE_R * Math.sin(rad);
      for (const element of doc.elementsFromPoint(px, py)) {
        if (element.classList.contains('node') || element.classList.contains('bond-hover-target')) {
          addIfUnseen(element);
        }
      }
    }

    const svgPtToScreen = (svgEl, x, y) => {
      const root = svgEl.ownerSVGElement;
      if (!root) {
        return null;
      }
      const point = root.createSVGPoint();
      point.x = x;
      point.y = y;
      const ctm = svgEl.getScreenCTM();
      return ctm ? point.matrixTransform(ctm) : null;
    };
    const distToSegment = (px, py, ax, ay, bx, by) => {
      const dx = bx - ax;
      const dy = by - ay;
      const lenSq = dx * dx + dy * dy;
      if (lenSq < 1e-10) {
        return Math.hypot(px - ax, py - ay);
      }
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
      return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    };

    for (const element of context.dom.plotEl.querySelectorAll('.atom-hit')) {
      if (seen.has(element)) {
        continue;
      }
      const box = element.getBoundingClientRect();
      const acx = (box.left + box.right) / 2;
      const acy = (box.top + box.bottom) / 2;
      if (Math.hypot(cx - acx, cy - acy) <= ERASE_R) {
        addIfUnseen(element);
      }
    }

    for (const element of context.dom.plotEl.querySelectorAll('.bond-hit')) {
      if (seen.has(element)) {
        continue;
      }
      const p1 = svgPtToScreen(element, parseFloat(element.getAttribute('x1')), parseFloat(element.getAttribute('y1')));
      const p2 = svgPtToScreen(element, parseFloat(element.getAttribute('x2')), parseFloat(element.getAttribute('y2')));
      if (!p1 || !p2) {
        continue;
      }
      if (distToSegment(cx, cy, p1.x, p1.y, p2.x, p2.y) <= ERASE_R) {
        addIfUnseen(element);
      }
    }

    for (const element of candidates) {
      if (element === lastEraseHitElement) {
        return;
      }
      if (element.classList.contains('node')) {
        const datum = context.helpers.getDatum(element);
        if (!datum || datum.name === 'H') {
          continue;
        }
        lastEraseHitElement = element;
        context.view.showPrimitiveHover([datum.id], []);
        context.schedule(() => {
          if (context.state.overlayState.getEraseMode() && context.state.overlayState.getErasePainting()) {
            context.actions.eraseItem([datum.id], []);
          }
        });
        return;
      }
      if (element.classList.contains('bond-hover-target')) {
        const datum = context.helpers.getDatum(element);
        if (!datum) {
          continue;
        }
        const currentMol = context.state.documentState.getCurrentMol();
        const bond = currentMol?.bonds.get(datum.id);
        if (bond?.atoms.some(id => currentMol.atoms.get(id)?.name === 'H')) {
          continue;
        }
        lastEraseHitElement = element;
        context.view.showPrimitiveHover([], [datum.id]);
        context.schedule(() => {
          if (context.state.overlayState.getEraseMode() && context.state.overlayState.getErasePainting()) {
            context.actions.eraseItem([], [datum.id]);
          }
        });
        return;
      }
      if (element.classList.contains('atom-hit')) {
        const group = element.closest('[data-atom-id]');
        if (!group) {
          continue;
        }
        const atomId = group.getAttribute('data-atom-id');
        lastEraseHitElement = element;
        context.view.showPrimitiveHover([atomId], []);
        context.schedule(() => {
          if (context.state.overlayState.getEraseMode() && context.state.overlayState.getErasePainting()) {
            context.actions.eraseItem([atomId], []);
          }
        });
        return;
      }
      if (element.classList.contains('bond-hit')) {
        const group = element.closest('[data-bond-id]');
        if (!group) {
          continue;
        }
        const bondId = group.getAttribute('data-bond-id');
        lastEraseHitElement = element;
        context.view.showPrimitiveHover([], [bondId]);
        context.schedule(() => {
          if (context.state.overlayState.getEraseMode() && context.state.overlayState.getErasePainting()) {
            context.actions.eraseItem([], [bondId]);
          }
        });
        return;
      }
    }

    lastEraseHitElement = null;
  }

  svg.on('mousedown.selection', event => {
    const mode = context.state.viewState.getMode();
    if (!context.state.overlayState.getSelectMode()) {
      return;
    }
    if (mode === '2d' && !context.state.documentState.getMol2d()) {
      return;
    }
    if (mode === 'force' && !context.state.documentState.getCurrentMol()) {
      return;
    }
    if (mode !== '2d' && mode !== 'force') {
      return;
    }
    if (event.button !== 0) {
      return;
    }
    if (event.target.closest('.atom-hit, .bond-hit, .node, .bond-hover-target')) {
      return;
    }

    const [x, y] = selectionEventPoint(event, true);
    selectionDragging = true;
    selectionStart = { x, y };
    selectionAdditive = isAdditiveSelectionEvent(event);
    selectionRect.attr('x', x).attr('y', y).attr('width', 0).attr('height', 0).style('display', null);
    event.preventDefault();
  });

  svg.on('mousemove.selection', event => {
    if (!selectionDragging) {
      return;
    }
    const [x, y] = selectionEventPoint(event, true);
    updateSelectionRect(x, y);
  });

  svg.on('mouseup.selection', event => {
    finishSelectionDrag(event);
  });

  svg.on('mousedown.drawbond', event => {
    const mode = context.state.viewState.getMode();
    if (!context.state.overlayState.getDrawBondMode()) {
      return;
    }
    if (mode !== '2d' && mode !== 'force') {
      return;
    }
    if (event.button !== 0) {
      return;
    }
    if (context.overlays.hasReactionPreview()) {
      return;
    }
    if (event.target.closest('.atom-hit, .bond-hit, .node, .bond-hover-target')) {
      return;
    }

    event.stopPropagation();
    const [gX, gY] = context.pointer(event, g.node());
    context.drawBond.start(null, gX, gY);
  });

  svg.on('mousedown.erase', event => {
    if (!context.state.overlayState.getEraseMode() || event.button !== 0) {
      return;
    }
    context.state.overlayState.setErasePainting(true);
    const cursor = context.dom.getEraseCursorElement();
    cursor.style.left = `${event.clientX}px`;
    cursor.style.top = `${event.clientY}px`;
    cursor.style.display = 'block';
  });

  svg.on('dblclick.select-all', event => {
    if (context.state.overlayState.getDrawBondMode() || context.drawBond.hasDrawBondState() || context.state.overlayState.getEraseMode()) {
      return;
    }
    const mol = context.state.viewState.getMode() === 'force' ? context.state.documentState.getCurrentMol() : context.state.documentState.getMol2d();
    if (!mol) {
      return;
    }
    if (event.target.closest('.node, .bond-hover-target, .atom-hit, .bond-hit')) {
      return;
    }
    if (!context.state.overlayState.getSelectMode()) {
      context.selection.toggleSelectMode();
    }
    for (const [id] of mol.atoms) {
      context.state.overlayState.getSelectedAtomIds().add(id);
    }
    for (const [id] of mol.bonds) {
      context.state.overlayState.getSelectedBondIds().add(id);
    }
    context.renderers.applySelectionOverlay();
  });

  svg.on('click.force-selection-clear', event => {
    if (!context.state.overlayState.getSelectMode() || context.state.viewState.getMode() !== 'force') {
      return;
    }
    if (suppressForceSelectionClearClick) {
      suppressForceSelectionClearClick = false;
      return;
    }
    if (event.target.closest('.node, .bond-hover-target')) {
      return;
    }
    if (isAdditiveSelectionEvent(event)) {
      return;
    }
    context.state.overlayState.getSelectedAtomIds().clear();
    context.state.overlayState.getSelectedBondIds().clear();
    context.renderers.applySelectionOverlay();
  });

  doc.addEventListener('mousemove', event => {
    context.view.setDrawBondHoverSuppressed(false);
    if (context.drawBond.hasDrawBondState()) {
      context.drawBond.markDragged();
      context.drawBond.updatePreview(context.pointer(event, g.node()));
      return;
    }
    if (!selectionDragging) {
      return;
    }
    const [x, y] = selectionEventPoint(event, true);
    updateSelectionRect(x, y);
  });

  doc.addEventListener('mousemove', handleErasePaintMove);

  doc.addEventListener('mouseup', event => {
    if (event.button === 0) {
      context.state.overlayState.setErasePainting(false);
      lastEraseHitElement = null;
      context.dom.getEraseCursorElement().style.display = 'none';
    }
    if (context.drawBond.hasDrawBondState()) {
      if (event.button === 0) {
        context.drawBond.commit();
      }
      return;
    }
    finishSelectionDrag(event);
  });
}
